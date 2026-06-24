import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getCurrentCongress } from "@/lib/congress";

// Bill IDs in report prose and lists are emitted by formatBillId — uppercase
// type, single space, number ("HR 2702", "HJRES 140", "S 4465"). HO 113 turns
// them into links to /bill/[id]. Match the 8 bill types longest-first so HRES
// wins over HR and the *CONRES/*JRES forms win over a bare S; require a word
// boundary before the type and reject a preceding `[` so an ID the LLM may
// have already linked is not double-wrapped; `(?!\d)` ends the number cleanly
// while leaving a trailing possessive/plural ("HR 2702's") outside the link.
const BILL_ID_RE =
  /(?<!\[)\b(HCONRES|HJRES|HRES|HR|SCONRES|SJRES|SRES|S) (\d{1,5})(?!\d)/g;

// Rewrites bare bill IDs into markdown links. The corpus is current-Congress-
// only, so getCurrentCongress() supplies the id prefix. The lowercased type is
// already the bills.id billType segment (hr/s/hjres/...). The historical
// reports render through this same component, so they get linking for free.
function linkifyBillIds(md: string): string {
  const congress = getCurrentCongress();
  return md.replace(
    BILL_ID_RE,
    (full, type: string, num: string) =>
      `[${full}](/bill/${congress}-${type.toLowerCase()}-${num})`,
  );
}

// HO 360 — floor-vote outcome verbs get an outcome color on the WEB render only.
// A `<strong>` whose text is EXACTLY one of these tokens is mapped; everything
// else (the default below) stays --text-secondary, so a bolded prose word never
// false-matches. content_md carries no color/HTML — just `**FAILED**` — so the
// `.md` download is plain bold. Reuses the red party token for "decided no"
// semantics; safe because the party-split labels render as plain text, never a
// colored `R`, so a red FAILED never sits beside a red party label.
const OUTCOME_COLOR: Record<string, string> = {
  PASSED: "var(--stage-enacted)",
  CONFIRMED: "var(--stage-enacted)",
  ADVANCED: "var(--stage-floor)",
  FAILED: "var(--party-republican)",
  BLOCKED: "var(--party-republican)",
  REJECTED: "var(--party-republican)",
};

// Exact text of a `<strong>` node, only when it's a single plain-text child.
function strongText(children: React.ReactNode): string | null {
  if (typeof children === "string") return children;
  if (
    Array.isArray(children) &&
    children.length === 1 &&
    typeof children[0] === "string"
  ) {
    return children[0];
  }
  return null;
}

// Renders a report's Markdown body with terminal-aesthetic overrides.
// Server component — react-markdown renders fine without client JS.
export function ReportMarkdown({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1
            className="mb-4 border-b pb-2 text-[16px] uppercase tracking-[0.5px]"
            style={{
              color: "var(--text-primary)",
              borderColor: "var(--border-soft)",
            }}
          >
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2
            className="mt-6 mb-3 text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {children}
          </h2>
        ),
        p: ({ children }) => (
          <p
            className="mb-3 text-[14px] leading-[1.6]"
            style={{ color: "var(--text-primary)" }}
          >
            {children}
          </p>
        ),
        ul: ({ children }) => (
          <ul
            className="mb-3 list-none text-[14px]"
            style={{ color: "var(--text-primary)" }}
          >
            {children}
          </ul>
        ),
        li: ({ children }) => (
          <li className="mb-1 before:mr-2 before:content-['·'] before:text-[var(--text-dim)]">
            {children}
          </li>
        ),
        // Bill-ID links (HO 113). Amber at rest, brighter on hover, no
        // underline — matches the link treatment on /bill/[id] and the feed,
        // so 40+ links in a dense report don't read as a wall of underlines.
        a: ({ href, children }) => (
          <Link
            href={href ?? "#"}
            className="transition hover:text-[var(--accent-amber-bright)]"
            style={{ color: "var(--accent-amber)" }}
          >
            {children}
          </Link>
        ),
        code: ({ children }) => (
          <code style={{ color: "var(--accent-amber)" }}>{children}</code>
        ),
        table: ({ children }) => (
          <table className="my-3 w-full border-collapse text-[14px]">
            {children}
          </table>
        ),
        th: ({ children }) => (
          <th
            className="border-b p-2 text-left uppercase tracking-[0.5px]"
            style={{
              borderColor: "var(--border-soft)",
              color: "var(--text-secondary)",
            }}
          >
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td
            className="border-b p-2"
            style={{ borderColor: "var(--border-soft)" }}
          >
            {children}
          </td>
        ),
        em: ({ children }) => (
          <em className="italic" style={{ color: "var(--text-muted)" }}>
            {children}
          </em>
        ),
        strong: ({ children }) => {
          const token = strongText(children);
          const color =
            (token && OUTCOME_COLOR[token]) || "var(--text-secondary)";
          return <strong style={{ color }}>{children}</strong>;
        },
      }}
    >
      {linkifyBillIds(content)}
    </Markdown>
  );
}
