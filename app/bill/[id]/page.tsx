import { notFound } from "next/navigation";
import { HeaderBar } from "@/components/HeaderBar";
import { PartyTag } from "@/components/PartyTag";
import { StageIndicator } from "@/components/StageIndicator";
import { TopicTags } from "@/components/TopicTags";
import { WatchlistToggle } from "@/components/WatchlistToggle";
import {
  congressGovUrl,
  formatBillId,
  formatDateLong,
  parseTopics,
} from "@/lib/format";
import { getBillById, isInWatchlist } from "@/lib/queries";

const labelStyle: React.CSSProperties = {
  color: "var(--text-dim)",
  letterSpacing: "0.5px",
};
const valueStyle: React.CSSProperties = {
  color: "var(--text-secondary)",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[124px_1fr] gap-x-4 py-1.5 text-[13px]">
      <dt className="text-[12px] uppercase" style={labelStyle}>
        {label}
      </dt>
      <dd style={valueStyle}>{children}</dd>
    </div>
  );
}

function Divider() {
  return (
    <div
      className="my-4 border-t"
      style={{ borderColor: "var(--border-strong)" }}
    />
  );
}

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bill = await getBillById(id);
  if (!bill) notFound();

  const onWatchlist = await isInWatchlist(bill.id);
  const url = congressGovUrl(bill.congress, bill.bill_type, bill.bill_number);
  const topics = parseTopics(bill.topics);
  let formattedRaw = bill.raw_json;
  try {
    formattedRaw = JSON.stringify(JSON.parse(bill.raw_json), null, 2);
  } catch {
    // leave raw on parse failure
  }

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar />

      <main className="w-full flex-1 px-4 py-4">
        <div
          className="border p-5"
          style={{
            backgroundColor: "var(--bg-row-hover)",
            borderColor: "var(--border-strong)",
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-3">
                <span
                  className="text-[16px] font-medium"
                  style={{ color: "var(--accent-amber)" }}
                >
                  {formatBillId(bill.bill_type, bill.bill_number)}
                </span>
                <h1
                  className="text-[15px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  {bill.title}
                </h1>
              </div>
            </div>
            <WatchlistToggle billId={bill.id} initial={onWatchlist} />
          </div>

          <div className="mt-4">
            {bill.sponsor_name ? (
              <Field label="Sponsor">
                <span style={{ color: "var(--text-secondary)" }}>
                  {bill.sponsor_name}
                </span>{" "}
                <PartyTag
                  party={bill.sponsor_party}
                  state={bill.sponsor_state}
                />
              </Field>
            ) : null}
            {bill.introduced_date ? (
              <Field label="Introduced">
                {formatDateLong(bill.introduced_date)}
              </Field>
            ) : null}
            {bill.latest_action_date ? (
              <Field label="Last action">
                {formatDateLong(bill.latest_action_date)}
              </Field>
            ) : null}
            {bill.stage ? (
              <Field label="Stage">
                <StageIndicator stage={bill.stage} />
              </Field>
            ) : null}
            {topics.length > 0 ? (
              <Field label="Topics">
                <TopicTags topics={topics} />
              </Field>
            ) : null}
          </div>

          {bill.summary ? (
            <>
              <Divider />
              <div
                className="mb-2 text-[12px] uppercase tracking-[0.5px]"
                style={labelStyle}
              >
                Summary
              </div>
              <p
                className="max-w-[80ch] text-[14px] leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {bill.summary}
              </p>
            </>
          ) : null}

          {bill.latest_action_text ? (
            <>
              <Divider />
              <div
                className="mb-2 text-[12px] uppercase tracking-[0.5px]"
                style={labelStyle}
              >
                Latest action
              </div>
              <p
                className="max-w-[80ch] text-[14px] leading-relaxed"
                style={{ color: "var(--text-muted)" }}
              >
                {bill.latest_action_text}
              </p>
            </>
          ) : null}

          <Divider />

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="border px-2.5 py-1 text-[12px] font-medium uppercase tracking-[0.5px] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-secondary)]"
              style={{
                color: "var(--text-dim)",
                borderColor: "var(--border-strong)",
              }}
            >
              Congress.gov ↗
            </a>
            <a
              href="/"
              className="border px-2.5 py-1 text-[12px] font-medium uppercase tracking-[0.5px] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-secondary)]"
              style={{
                color: "var(--text-dim)",
                borderColor: "var(--border-strong)",
              }}
            >
              ← Back to feed
            </a>
          </div>

          <details
            className="mt-4 border"
            style={{
              backgroundColor: "var(--bg-base)",
              borderColor: "var(--border-strong)",
            }}
          >
            <summary
              className="cursor-pointer select-none px-3 py-2 text-[12px] font-medium uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              ▾ Raw JSON
            </summary>
            <pre
              className="overflow-auto border-t px-3 py-2 text-[12px] leading-snug"
              style={{
                borderColor: "var(--border-strong)",
                color: "var(--text-muted)",
              }}
            >
              {formattedRaw}
            </pre>
          </details>

          {bill.summary_model ? (
            <p
              className="mt-3 text-[12px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              Summary by {bill.summary_model}
              {bill.summary_updated_at
                ? ` · ${formatDateLong(bill.summary_updated_at)}`
                : null}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
