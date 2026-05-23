import Link from "next/link";
import { BILL_TYPE_LABELS } from "@/lib/enums";
import { formatBillId, formatDateShort } from "@/lib/format";
import type { VotePosition, VoteWithMemberPosition } from "@/lib/queries";

const POSITION_LABEL: Record<VotePosition, string> = {
  yea: "YEA",
  nay: "NAY",
  present: "PRES",
  not_voting: "N/V",
};

// HO 123: full-name tooltip for the abbreviated position chip. "N/V" and
// "PRES" are not immediately decodable to a non-Hill reader.
const POSITION_FULL_LABEL: Record<VotePosition, string> = {
  yea: "Voted yea",
  nay: "Voted nay",
  present: "Voted present (declined to vote yea or nay)",
  not_voting: "Did not vote",
};

const POSITION_COLOR: Record<VotePosition, string> = {
  yea: "var(--vote-yea)",
  nay: "var(--vote-nay)",
  present: "var(--vote-present)",
  not_voting: "var(--vote-not-voting)",
};

// Parse bills.id ('119-hr-1234') back into (type, number) for the
// canonical "HR 1234" label. The id format is stable from `lib/sync.ts`,
// so a missing third segment means we've been handed something malformed
// and we render the raw id as the fallback.
function parseBillRef(
  billId: string,
): { label: string; href: string; billType: string | null } {
  const parts = billId.split("-");
  if (parts.length !== 3) {
    return { label: billId, href: `/bill/${billId}`, billType: null };
  }
  const [, type, num] = parts;
  return {
    label: formatBillId(type ?? billId, Number(num)),
    href: `/bill/${billId}`,
    billType: type ?? null,
  };
}

export function MemberVoteRow({ vote }: { vote: VoteWithMemberPosition }) {
  const label = POSITION_LABEL[vote.position];
  const color = POSITION_COLOR[vote.position];

  const question = vote.question ?? "—";
  const result = vote.result ?? null;
  const questionLine = result ? `${question} · ${result}` : question;

  const billRef = vote.billId ? parseBillRef(vote.billId) : null;

  return (
    <div className="vote-row">
      <span
        className="position-chip"
        style={{ color }}
        title={POSITION_FULL_LABEL[vote.position]}
      >
        [{label}]
      </span>
      <span className="vote-date">{formatDateShort(vote.voteDate)}</span>
      <span className="vote-bill">
        {billRef ? (
          <Link
            href={billRef.href}
            title={
              billRef.billType
                ? BILL_TYPE_LABELS[billRef.billType]
                : undefined
            }
          >
            {billRef.label}
          </Link>
        ) : vote.amendmentDesignation ? (
          vote.amendmentDesignation
        ) : (
          "—"
        )}
      </span>
      <span className="vote-question" title={questionLine}>
        {questionLine}
      </span>
      <span className="vote-roll">#{vote.rollCall}</span>
    </div>
  );
}
