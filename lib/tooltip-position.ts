// HO 147 — tooltip positioning. Pure math, no DOM. Computes top/left for
// a panel placed against a trigger rect, flipping below when above has no
// room and clamping horizontally so the panel never clips off-screen.
// Coordinates are viewport-relative (panel uses position:fixed).

export type TooltipPlacement = "top" | "bottom";

export type TooltipPosition = {
  top: number;
  left: number;
  placement: TooltipPlacement;
  // Caret horizontal center, in pixels measured from the panel's left edge.
  // Tracks the trigger center after horizontal clamping so the caret keeps
  // pointing at the trigger even when the panel is shoved away from it.
  caretLeft: number;
};

export type TriggerRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const GAP = 8;
const EDGE_PAD = 8;

export function computeTooltipPosition({
  trigger,
  panelWidth,
  panelHeight,
  viewportWidth,
  viewportHeight,
}: {
  trigger: TriggerRect;
  panelWidth: number;
  panelHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): TooltipPosition {
  // Vertical: default above, flip below when above can't fit.
  const wantedTopAbove = trigger.top - panelHeight - GAP;
  const fitsAbove = wantedTopAbove >= EDGE_PAD;
  const placement: TooltipPlacement = fitsAbove ? "top" : "bottom";
  const top =
    placement === "top"
      ? wantedTopAbove
      : trigger.top + trigger.height + GAP;

  // Horizontal: center on the trigger, then clamp inside [EDGE_PAD,
  // viewportWidth - panelWidth - EDGE_PAD]. Caret tracks the trigger center
  // even after clamping so it still points at the source.
  const triggerCenterX = trigger.left + trigger.width / 2;
  const idealLeft = triggerCenterX - panelWidth / 2;
  const maxLeft = Math.max(EDGE_PAD, viewportWidth - panelWidth - EDGE_PAD);
  const left = Math.max(EDGE_PAD, Math.min(idealLeft, maxLeft));
  // Clamp the caret within the panel so it never overshoots when the
  // trigger is near a viewport edge and the panel got pushed away from it.
  const caretLeft = Math.max(8, Math.min(triggerCenterX - left, panelWidth - 8));

  return { top, left, placement, caretLeft };
}
