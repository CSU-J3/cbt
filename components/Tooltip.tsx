"use client";

// HO 147 — rich-content tooltip primitive. Two trigger affordances
// (dotted-underline inline term + boxed `?` panel badge), one panel with
// label + body, and an optional data variant for chart-element hovers
// (count + share + click hint). Hand-rolled positioning via
// lib/tooltip-position. Coexists with HO 123's native `title` attributes
// during the cleanup-audit window (HO 154 migrates the rest).
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  type TooltipPosition,
  computeTooltipPosition,
} from "@/lib/tooltip-position";

const HOVER_IN_DELAY_MS = 400;

export type TooltipContent =
  | {
      kind: "text";
      label?: string;
      body: string;
      /** HO 187: color the body text (e.g. a topic acronym's full name in that
       *  topic's color). Defaults to the panel's --text-secondary. */
      bodyColor?: string;
    }
  | {
      kind: "data";
      label?: string;
      count: number;
      share?: number; // 0..1
      clickHint?: string;
    };

type CommonProps = {
  content: TooltipContent;
  /** Pre-rendered label fallback when content carries no label. */
  ariaLabel?: string;
};

type TermProps = CommonProps & {
  variant: "term";
  /** The inline text being marked. Keeps its own color; only gains the
   *  dotted underline. */
  children: ReactNode;
};

type BadgeProps = CommonProps & {
  variant: "badge";
  /** Visible glyph; defaults to `?`. */
  glyph?: string;
};

export type TooltipProps = TermProps | BadgeProps;

function formatShare(share: number): string {
  if (share <= 0) return "0%";
  if (share < 0.01) return "<1%";
  return `${Math.round(share * 100)}%`;
}

function TooltipPanel({
  panelId,
  content,
  position,
  panelRef,
}: {
  panelId: string;
  content: TooltipContent;
  position: TooltipPosition;
  panelRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={panelRef}
      id={panelId}
      role="tooltip"
      className="tooltip-panel"
      data-placement={position.placement}
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      {content.label ? (
        <div className="tooltip-panel-label">{content.label}</div>
      ) : null}
      {content.kind === "text" ? (
        <div
          className="tooltip-panel-body"
          style={content.bodyColor ? { color: content.bodyColor } : undefined}
        >
          {content.body}
        </div>
      ) : (
        <div className="tooltip-panel-body tooltip-panel-data">
          <span className="tabular-nums">
            {content.count.toLocaleString()} bill
            {content.count === 1 ? "" : "s"}
          </span>
          {content.share !== undefined ? (
            <>
              <span className="tooltip-panel-data-sep"> · </span>
              <span className="tabular-nums">{formatShare(content.share)}</span>
            </>
          ) : null}
          {content.clickHint ? (
            <div className="tooltip-panel-data-hint">{content.clickHint}</div>
          ) : null}
        </div>
      )}
      <span
        aria-hidden
        className="tooltip-caret"
        style={{ left: position.caretLeft }}
      />
    </div>
  );
}

export function Tooltip(props: TooltipProps) {
  const panelId = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const handleEnter = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setOpen(true);
    }, HOVER_IN_DELAY_MS);
  }, [clearHoverTimer]);

  const handleLeave = useCallback(() => {
    clearHoverTimer();
    setOpen(false);
  }, [clearHoverTimer]);

  const handleFocus = useCallback(() => {
    clearHoverTimer();
    setOpen(true);
  }, [clearHoverTimer]);

  const handleBlur = useCallback(() => {
    clearHoverTimer();
    setOpen(false);
  }, [clearHoverTimer]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.blur();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const tr = trigger.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    const pos = computeTooltipPosition({
      trigger: {
        top: tr.top,
        left: tr.left,
        width: tr.width,
        height: tr.height,
      },
      panelWidth: pr.width,
      panelHeight: pr.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setPosition(pos);
  }, [open]);

  const sharedTriggerProps = {
    ref: triggerRef,
    tabIndex: 0 as const,
    "aria-describedby": open ? panelId : undefined,
    onMouseEnter: handleEnter,
    onMouseLeave: handleLeave,
    onFocus: handleFocus,
    onBlur: handleBlur,
  };

  // Initial render of the panel is invisible (position null) so we can
  // measure it before placing it; the next layout effect computes the real
  // position. Visibility flip is data-position not opacity — no fade.
  const panelNode =
    open && mounted ? (
      <TooltipPanel
        panelId={panelId}
        content={props.content}
        position={
          position ?? {
            top: -9999,
            left: -9999,
            placement: "top",
            caretLeft: 0,
          }
        }
        panelRef={panelRef}
      />
    ) : null;

  const portal =
    panelNode && typeof document !== "undefined"
      ? createPortal(panelNode, document.body)
      : null;

  if (props.variant === "term") {
    return (
      <>
        <span
          {...sharedTriggerProps}
          className="tooltip-term"
          aria-label={props.ariaLabel}
        >
          {props.children}
        </span>
        {portal}
      </>
    );
  }

  return (
    <>
      <span
        {...sharedTriggerProps}
        className="tooltip-badge"
        role="button"
        aria-label={props.ariaLabel ?? "More info"}
      >
        {props.glyph ?? "?"}
      </span>
      {portal}
    </>
  );
}
