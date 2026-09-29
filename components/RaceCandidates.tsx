import Link from "next/link";
import type { RosterCandidate, RosterPartyKey } from "@/lib/queries";

// HO 757: the others on the ballot (L Libertarian, G Green, O any other party)
// take the independent purple, as I does.
function partyColor(party: RosterPartyKey | null): string {
  if (party === "R") return "var(--party-republican)";
  if (party === "D") return "var(--party-democrat)";
  if (party === "I" || party === "L" || party === "G" || party === "O")
    return "var(--party-independent)";
  return "var(--text-dim)";
}

// NOTE: the `default:` below renders the RAW status string, so a status added
// to the vocabulary without a case here ships as its raw value: the span's
// `uppercase` class shows `on_ballot` as ON_BALLOT, underscore and all, beside
// WITHDREW (HO 757 corrected "lowercase"). Add the case when you add the status.
function statusLabel(status: string | null): string {
  switch (status) {
    case "won_primary":
      return "Won primary";
    // HO 638: convention / ballot-vacancy replacement nominee. Deliberately NOT
    // labelled "Won primary" — a convention nominee never ran in one.
    case "nominee":
      return "Nominee";
    // HO 736: a top-four / top-two advancer. Same reasoning one step over — an
    // advancer never won a party primary either, and four of them advance from
    // one contest. The `default:` above would have shipped it lowercase.
    case "advanced":
      return "Advanced";
    case "running":
      return "Running";
    case "declared":
      return "Declared";
    case "withdrew":
      return "Withdrew";
    // HO 757: a non-major candidate printed on a party-primary state's November
    // ballot. On the ballot, not nominated.
    case "on_ballot":
      return "On ballot";
    default:
      return status ?? "—";
  }
}

// HO 757 (ruled C): the others show three before the fold.
const OTHERS_BEFORE_FOLD = 3;

function CandidateRow({ c }: { c: RosterCandidate }) {
  const color = partyColor(c.party);
  const dimmed = c.status === "withdrew";
  return (
    <li
      className="flex items-center gap-3 py-2 text-[length:var(--fs-14)]"
      style={{
        color: dimmed ? "var(--text-dim)" : "var(--text-primary)",
        borderTop: "0.5px solid var(--border-soft)",
        opacity: dimmed ? 0.7 : 1,
      }}
    >
      <span aria-hidden style={{ color }}>
        ●
      </span>
      <span
        className="w-6 text-[length:var(--fs-12)] uppercase tracking-[0.5px] tabular-nums"
        style={{ color }}
      >
        {c.party ?? "—"}
      </span>
      <span className="flex-1">
        {c.bioguide_id ? (
          <Link
            href={`/members/${c.bioguide_id}`}
            className="transition hover:text-[var(--accent-amber)]"
          >
            {c.name}
          </Link>
        ) : (
          c.name
        )}
        {/* HO 757: the ballot's print, whole: a fusion print, or an O row's
            single-line party (the architect's amendment), so an unusual party
            isn't a bare letter. */}
        {c.printed_party ? (
          <span style={{ color: "var(--text-muted)" }}>
            {" · "}
            {c.printed_party}
          </span>
        ) : null}
      </span>
      <span
        className="text-[length:var(--fs-12)] uppercase tracking-[0.5px]"
        style={{ color: "var(--text-muted)" }}
      >
        {statusLabel(c.status)}
      </span>
    </li>
  );
}

export function RaceCandidates({
  candidates,
}: {
  candidates: RosterCandidate[];
}) {
  if (candidates.length === 0) {
    return (
      <p
        className="py-3 text-[length:var(--fs-13)]"
        style={{ color: "var(--text-muted)" }}
      >
        Candidate filings forthcoming.
      </p>
    );
  }

  // HO 757 (ruled C): the majors as before, in getRaceRoster's order (withdrew
  // last among them), then the others on the ballot by name, three before a
  // native <details> whose summary counts the rest.
  const majors = candidates.filter((c) => c.status !== "on_ballot");
  const others = candidates.filter((c) => c.status === "on_ballot");
  const shown = others.slice(0, OTHERS_BEFORE_FOLD);
  const folded = others.slice(OTHERS_BEFORE_FOLD);

  return (
    <>
      {majors.length > 0 ? (
        <ul className="flex flex-col">
          {majors.map((c) => (
            <CandidateRow key={c.name} c={c} />
          ))}
        </ul>
      ) : null}
      {others.length > 0 ? (
        <div data-roster-others>
          <p
            className="pt-3 pb-2 text-[length:var(--fs-12)] uppercase tracking-[0.5px]"
            style={{
              color: "var(--text-dim)",
              borderTop:
                majors.length > 0 ? "0.5px solid var(--border-soft)" : undefined,
            }}
          >
            Also on the ballot
          </p>
          <ul className="flex flex-col">
            {shown.map((c) => (
              <CandidateRow key={c.name} c={c} />
            ))}
          </ul>
          {folded.length > 0 ? (
            <details className="group">
              <summary
                className="flex cursor-pointer list-none items-center gap-2 py-2 text-[length:var(--fs-12)] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber)] [&::-webkit-details-marker]:hidden"
                style={{
                  color: "var(--text-muted)",
                  borderTop: "0.5px solid var(--border-soft)",
                }}
              >
                <span aria-hidden className="group-open:hidden">
                  ▸
                </span>
                <span aria-hidden className="hidden group-open:inline">
                  ▾
                </span>
                +{folded.length} more on the ballot
              </summary>
              <ul className="flex flex-col">
                {folded.map((c) => (
                  <CandidateRow key={c.name} c={c} />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
