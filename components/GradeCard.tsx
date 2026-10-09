"use client";

// HO 767 — the grade's card (mock-767 v18, GRADE AS chip; v9 to v12). The chip
// is PalestineBadge; the card opens from it like the app's tooltip but can be
// used: the Tooltip primitive (components/Tooltip.tsx) is
// non-interactive by design — its panel is `pointer-events: none`
// (app/globals.css `.tooltip-panel`), `role="tooltip"`, and closes on
// mouseleave — so it cannot hold the tracker's link. This card can:
//   - it opens 400ms after the pointer arrives (the Tooltip's delay), or at
//     once on focus;
//   - leaving the chip gives the pointer 160ms to reach the card;
//   - a click, a tap or Enter pins it, and a second one closes it; a touch
//     never opens it by hover, so the tap that pins it is not undone by the
//     synthesized pointer leave that follows;
//   - Tab from the chip reaches the card's link, and Tab from the link moves on
//     past the chip; Shift+Tab goes back; Esc closes it and hands focus back;
//   - it follows the chip as the list's box scrolls and closes once the chip is
//     out of sight (lib/in-sight.ts, the rule the Tooltip shares since HO 768);
//     and the list closes it whenever it re-renders (GRADE_CARDS_CLOSE_EVENT).
// Placed by computeTooltipPosition, styled as `.tooltip-panel`.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { PalestineBadge } from "@/components/PalestineBadge";
import { inSight } from "@/lib/in-sight";
import {
  PALESTINE_TRACKER_NAME,
  isPalestineGrade,
  palestinePoolLabel,
  palestineTrackerHref,
} from "@/lib/palestine-config";
import {
  type TooltipPosition,
  computeTooltipPosition,
} from "@/lib/tooltip-position";

const OPEN_DELAY_MS = 400;
const GRACE_MS = 160;

// The list dispatches this on every re-render that moves its rows (a tab, a
// switch, a search, a row opened or closed); every open card closes.
export const GRADE_CARDS_CLOSE_EVENT = "gradecards:close";

type Mode = "hover" | "focus" | "pin";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

// "May 2026": the month and year of the tracker's figures (v12: a day alone
// is ambiguous across the year).
function monthYear(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function GradeChip({
  name,
  grade,
  rank,
  total,
  sponsor,
  voting,
  chamber,
  pool,
  syncedAt,
}: {
  name: string;
  grade: string;
  rank: number | null;
  total: string | null;
  sponsor: string | null;
  voting: string | null;
  chamber: string | null;
  pool: number | null;
  syncedAt: string | null;
}) {
  const cardId = useId();
  const chipRef = useRef<HTMLSpanElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quietFocus = useRef(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [pos, setPos] = useState<TooltipPosition | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const clearOpen = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);
  const clearGrace = useCallback(() => {
    if (graceTimer.current) clearTimeout(graceTimer.current);
    graceTimer.current = null;
  }, []);
  const close = useCallback(
    (refocus = false) => {
      clearOpen();
      clearGrace();
      setMode(null);
      setPos(null);
      if (refocus && chipRef.current?.isConnected) {
        quietFocus.current = true;
        chipRef.current.focus({ preventScroll: true });
        quietFocus.current = false;
      }
    },
    [clearOpen, clearGrace],
  );
  const startGrace = useCallback(() => {
    clearGrace();
    graceTimer.current = setTimeout(() => close(), GRACE_MS);
  }, [clearGrace, close]);

  const place = useCallback(() => {
    const chip = chipRef.current;
    const card = cardRef.current;
    if (!chip || !card) return;
    // Is the chip in sight: inside the window, and inside the list's box below
    // its pinned column heads when it sits in one (lib/in-sight.ts, HO 768: the
    // Tooltip primitive closes on the same rule).
    if (!inSight(chip)) {
      close();
      return;
    }
    const tr = chip.getBoundingClientRect();
    const pr = card.getBoundingClientRect();
    setPos(
      computeTooltipPosition({
        trigger: { top: tr.top, left: tr.left, width: tr.width, height: tr.height },
        panelWidth: pr.width,
        panelHeight: pr.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    );
  }, [close]);

  useLayoutEffect(() => {
    if (mode) place();
  }, [mode, place]);

  // While open: follow the chip on any scroll (the box's or the page's), and
  // close on a focus or a press anywhere that is neither the chip nor the card.
  useEffect(() => {
    if (!mode) return;
    const inside = (n: EventTarget | null) =>
      n instanceof Node && (chipRef.current?.contains(n) || cardRef.current?.contains(n));
    const onScroll = () => place();
    const onFocusIn = (e: FocusEvent) => {
      if (!inside(e.target)) close();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!inside(e.target)) close();
    };
    const onCloseAll = () => close();
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener(GRADE_CARDS_CLOSE_EVENT, onCloseAll);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener(GRADE_CARDS_CLOSE_EVENT, onCloseAll);
    };
  }, [mode, place, close]);

  useEffect(() => () => {
    clearOpen();
    clearGrace();
  }, [clearOpen, clearGrace]);

  if (!isPalestineGrade(grade)) return null;

  const toggle = () => {
    clearOpen();
    clearGrace();
    if (mode === "pin") close();
    else setMode("pin");
  };

  // The element after the chip in the page's focus order, the card left out.
  const nextAfterChip = (): HTMLElement | null => {
    const all = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (n) => !cardRef.current?.contains(n) && n.getClientRects().length > 0,
    );
    const i = chipRef.current ? all.indexOf(chipRef.current) : -1;
    return i >= 0 ? (all[i + 1] ?? null) : null;
  };

  const trigger = {
    ref: chipRef,
    tabIndex: 0,
    role: "button",
    "aria-haspopup": "dialog" as const,
    "aria-expanded": mode != null,
    "aria-controls": mode ? cardId : undefined,
    "aria-label": `${PALESTINE_TRACKER_NAME} grade ${grade} for ${name}, details`,
    "data-grade-chip": "",
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (mode) {
        clearGrace();
        return;
      }
      clearOpen();
      openTimer.current = setTimeout(() => setMode("hover"), OPEN_DELAY_MS);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === "touch") return;
      clearOpen(); // brushed past: it never opens
      if (mode === "hover") startGrace();
    },
    onFocus: () => {
      if (quietFocus.current) return;
      clearOpen();
      if (!mode || mode === "hover") setMode("focus");
    },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      toggle();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      } else if (e.key === "Escape" && mode) {
        e.preventDefault();
        close(true);
      } else if (e.key === "Tab" && !e.shiftKey && mode) {
        e.preventDefault();
        linkRef.current?.focus();
      }
    },
  };

  const asOf = monthYear(syncedAt);
  const card =
    mode && mounted
      ? createPortal(
          <div
            ref={cardRef}
            id={cardId}
            role="dialog"
            aria-label={`${PALESTINE_TRACKER_NAME} grade`}
            className="tooltip-panel grade-card"
            data-placement={pos?.placement ?? "top"}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            onPointerEnter={(e) => {
              if (e.pointerType !== "touch") clearGrace();
            }}
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch" && mode === "hover") startGrace();
            }}
          >
            <div className="grade-card-l">
              <b>{PALESTINE_TRACKER_NAME}</b>
              {asOf ? ` · as of ${asOf}` : ""}
            </div>
            <div className="grade-card-f">
              <span>
                <PalestineBadge grade={grade} rank={rank} untitled />{" "}
                {total ? <span className="grade-card-sc">{total}</span> : null}
              </span>
              {rank != null ? (
                <span>
                  #{rank}
                  {pool ? ` of ${pool} ${palestinePoolLabel(chamber)}` : ""}
                </span>
              ) : null}
            </div>
            {sponsor || voting ? (
              <div className="grade-card-m">
                {[sponsor ? `Sponsorship ${sponsor}` : null, voting ? `Voting ${voting}` : null].filter(Boolean).join(" · ")}
              </div>
            ) : null}
            <div className="grade-card-m">Grade based on the USCPR metric.</div>
            <div className="grade-card-k">
              <a
                ref={linkRef}
                href={palestineTrackerHref(chamber)}
                target="_blank"
                rel="noopener noreferrer"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    close(true);
                  } else if (e.key === "Tab" && e.shiftKey) {
                    e.preventDefault();
                    quietFocus.current = true;
                    chipRef.current?.focus();
                    quietFocus.current = false;
                  } else if (e.key === "Tab") {
                    e.preventDefault();
                    const next = nextAfterChip();
                    close();
                    next?.focus();
                  }
                }}
              >
                View tracker ↗
              </a>
            </div>
            <span aria-hidden className="tooltip-caret" style={{ left: pos?.caretLeft ?? 0 }} />
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <PalestineBadge grade={grade} rank={rank} trigger={trigger} />
      {card}
    </>
  );
}
