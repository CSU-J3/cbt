import Link from "next/link";
import { getCurrentCongress, ordinal } from "@/lib/congress";

// HO 185 — the unified PowerShell-path masthead shown on every page (the
// dashboard via HomeHeader, all other pages via HeaderBar). Renders:
//   Congress Terminal:\ 119TH \ <segments> >_
// The path glyphs (`:\`, the ` \ ` separators, the trailing `>`) keep the
// --accent-amber treatment from HO 162 via `.prompt-accent`; segment text is
// --text-primary (inherited from `.terminal-prompt`); the blinking `_`
// (`.home-cursor-caret`) rides the end — the dashboard's named motion
// exception, now shared everywhere. Server-rendered: the caret is CSS, the
// congress root is computed, and the Bills↔News segment is chosen server-side
// from `?mode`, so there is no client JS here. The root links home.
//
// Sizing is contextual via CSS ancestry, not a prop: inside HomeHeader's
// `.home-header-prompt-row` the existing 36px desktop rule applies; in
// HeaderBar it renders at the default `.terminal-prompt` size.
export function BreadcrumbMasthead({ segments }: { segments: string[] }) {
  const congress = ordinal(getCurrentCongress()).toUpperCase(); // "119TH"
  const parts = [congress, ...segments];
  return (
    <span className="terminal-prompt breadcrumb-path">
      <Link
        href="/"
        className="breadcrumb-root"
        aria-label="Congress Terminal — dashboard"
      >
        Congress Terminal<span className="prompt-accent">{":\\"}</span>
      </Link>
      {parts.map((seg, i) => (
        <span key={`${i}-${seg}`}>
          <span className="prompt-accent" aria-hidden>
            {i === 0 ? " " : " \\ "}
          </span>
          <span className="breadcrumb-seg-label">{seg}</span>
        </span>
      ))}
      <span className="prompt-accent" aria-hidden>
        {" >"}
      </span>
      <span aria-hidden className="home-cursor-caret">
        _
      </span>
    </span>
  );
}
