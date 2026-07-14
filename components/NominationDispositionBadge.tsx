import type { NominationDisposition } from "@/lib/nominations-sync";

// HO 456 — the nomination disposition as a colored badge. Reuses the vote-outcome
// palette (the same green/red the amendments disposition dot uses — confirmed is a
// positive Senate vote outcome, returned/withdrawn negative) + amber for the
// in-pipeline stages. Exported label/color maps so the /nominations disposition
// strip renders the same vocabulary without a second source of truth.
export const DISPOSITION_LABEL: Record<NominationDisposition, string> = {
  confirmed: "Confirmed",
  returned: "Returned to president",
  withdrawn: "Withdrawn",
  calendar: "On calendar",
  reported: "Reported",
  hearings: "Hearings held",
  referred: "In committee",
  received: "Received",
};

export function dispositionColor(d: NominationDisposition): string {
  if (d === "confirmed") return "var(--vote-yea)";
  if (d === "returned" || d === "withdrawn") return "var(--vote-nay)";
  return "var(--accent-amber)"; // calendar / reported / hearings / referred / received
}

export function NominationDispositionBadge({ disposition }: { disposition: NominationDisposition }) {
  const c = dispositionColor(disposition);
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.5px]"
      style={{ color: c }}
    >
      <span
        aria-hidden
        style={{ width: 6, height: 6, flexShrink: 0, borderRadius: "50%", backgroundColor: c }}
      />
      {DISPOSITION_LABEL[disposition]}
    </span>
  );
}
