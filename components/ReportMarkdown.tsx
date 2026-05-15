import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
        strong: ({ children }) => (
          <strong style={{ color: "var(--text-secondary)" }}>
            {children}
          </strong>
        ),
      }}
    >
      {content}
    </Markdown>
  );
}
