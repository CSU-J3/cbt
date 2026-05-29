import Link from "next/link";

// HO 153 — extracted from HomeHeader's inline `Congress Terminal:\>`
// prompt so /reports can wear the `Reports:\>` spec-6 masthead style
// without duplicating CSS. Same `.terminal-prompt` / `.prompt-accent`
// classes (HO 150 styling: mono 18px --text-primary with :\> in
// --accent-amber). The optional `href` lets the prompt double as a
// click-to-home affordance — HomeHeader uses `/` so it routes back to
// the dashboard; /reports omits `href` so the masthead is decorative.
export function TerminalPrompt({
  name,
  href,
  ariaLabel,
}: {
  name: string;
  href?: string;
  ariaLabel?: string;
}) {
  const inner = (
    <>
      {name}
      <span className="prompt-accent">{":\\>"}</span>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="terminal-prompt"
        aria-label={ariaLabel ?? `${name} home`}
      >
        {inner}
      </Link>
    );
  }
  return (
    <span className="terminal-prompt" aria-label={ariaLabel}>
      {inner}
    </span>
  );
}
