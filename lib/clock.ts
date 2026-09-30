// HO 758 — THE ONE "NOW" THE ELECTION-DAY LOGIC READS. `daysToElection`
// (lib/format.ts), the battlefield band and the race page's decided state all
// ask this helper, so a leg can move every one of them together.
//
// THE SEAM: a leg sets CBT_CLOCK_NOW (an ISO time) on a local server. It is
// honoured ONLY when TURSO_DATABASE_URL is a `file:` URL, i.e. a legs copy:
// prod and every Preview read Turso (`libsql://`), so a stray variable in a
// deployed environment cannot move Production's clock. Production never sets
// it. In a client bundle neither variable exists (Next inlines only
// NEXT_PUBLIC_ ones), so this is always the real clock there.
export function clockNowMs(): number {
  const set = process.env.CBT_CLOCK_NOW;
  if (set && (process.env.TURSO_DATABASE_URL ?? "").startsWith("file:")) {
    const t = Date.parse(set);
    if (!Number.isNaN(t)) return t;
  }
  return Date.now();
}
