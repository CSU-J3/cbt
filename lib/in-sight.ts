// HO 768 — is an element in sight: inside the window, and, when it sits in a
// scrolling box (`[data-scroll-box]`), inside that box below its pinned column
// heads (`[data-sticky-heads]`). Moved whole out of the grade card's
// `chipVisible` (components/GradeCard.tsx, HO 767), so the card and the Tooltip
// primitive (components/Tooltip.tsx) close on one rule as their trigger scrolls
// away. A zero-width element (detached from layout) is out of sight.
export function inSight(el: HTMLElement | null): boolean {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.bottom <= 0 || r.top >= window.innerHeight || r.width === 0) return false;
  const box = el.closest<HTMLElement>("[data-scroll-box]");
  if (!box || box.scrollHeight <= box.clientHeight) return true;
  const b = box.getBoundingClientRect();
  const heads = box.querySelector<HTMLElement>("[data-sticky-heads]");
  return r.bottom > b.top + (heads?.offsetHeight ?? 0) && r.top < b.bottom;
}
