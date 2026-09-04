import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { prefBootScript } from "@/lib/prefs";
import "./globals.css";

// HO 633 — the sans face is IBM Plex Sans, self-hosted. Owner ruling off
// docs/design/mock-633-sans-specimen.html (a four-face knob on the real
// surfaces, not stills), superseding HO 257's "CBT has no --sans".
//
// WEIGHTS ARE MEASURED, NOT GREPPED, AND NOT TAKEN FROM THE SPECIMEN. A static
// grep cannot answer this — 10 of the 12 rules that set `font-family:
// var(--sans)` set no weight at all, so their weight arrives by inheritance or
// off a Tailwind class on the element. The authoritative reading is the
// COMPUTED weight of everything the browser actually renders in the sans stack,
// across the routes that use it, which is 400 / 500 / 600 with NO 700 consumer
// anywhere (docs/handoffs/633-artifacts/sans-weights.ts). Loading a weight
// nothing uses is payload on every page; MISSING one something uses is worse —
// the browser synthesises it, and a faux-bold is precisely what a specimen
// sign-off cannot catch, because the specimen declares its own weights and is
// therefore evidence about the specimen rather than about the product.
//
// The token stays the seam: `variable` goes on <html>, `--sans` is re-pointed in
// globals.css, and no consumer is edited — every `var(--sans)` site moves
// together by construction, which is why no per-route ruling was needed.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-sans",
});

// HO 633 C1b — THE PRELOAD IS ON AND WORKS IN PRODUCTION. DO NOT HAND-ROLL A
// <link rel="preload">, and do not "fix" this by adding one: it would double the
// preload on prod and paper over a defect that is not in this repo.
//
// next/font's preload is entirely build-time and needs no option here (preload
// defaults true). The loader marks the latin subset by emitting it as
// `*.p.woff2`; NextFontManifestPlugin collects those into
// .next/server/next-font-manifest.json; app-render's getPreloadableFonts reads
// that manifest and calls ReactDOM.preload. Every link in that chain is Next's.
//
// THE CHAIN BREAKS ON WINDOWS, AND ONLY ON WINDOWS. The plugin finds the font
// module with `mod.request.includes('/next-font-loader/index.js?')` — a
// forward-slash literal — while the loader path is built with path.join, which
// is backslash-separated here. The predicate never matches, the manifest ships
// as {"pages":{},"app":{}}, getPreloadableFonts returns null, and nothing is
// preloaded. Vercel builds on Linux, so prod is unaffected.
//
// The consequence that actually matters: A LOCAL FONT-TIMING MEASUREMENT ON
// WINDOWS MEASURES THE UN-PRELOADED PATH, and reads as a product defect that
// isn't there. Measured 2026-08-09 at this commit, 400kbps/150ms emulation, 3
// runs each — local build: woff2 starts 3240-4070ms, AFTER the CSS that
// discovers it, swap window +2776/+2783/+2798ms. Prod, identical source: woff2
// starts 360-422ms, ~1.9s BEFORE the CSS finishes, swap window
// +477/+543/+700ms. Unthrottled there is no flash either way (the font lands
// before FCP: local -11 to -15ms, prod -74 to -142ms). Instruments live in
// docs/handoffs/633-artifacts/ (flash-window, preload-check, zero-external);
// preload-check is the one that reads the <link> out of the DOM, which is what
// separates "we shipped it wrong" from "this build cannot emit it."

export const metadata: Metadata = {
  // HO 361/364 — metadataBase so /welcome's OG card resolves to an absolute URL.
  // Points at the branded host congressional-terminal-chi-silk.vercel.app, which
  // is a live attached production domain on the Vercel project (verified against
  // the project's domains list — the OAuth callback runs through it). cbt-chi-silk
  // is the legacy alias, also attached, and 307-redirects to this host.
  metadataBase: new URL("https://congressional-terminal-chi-silk.vercel.app"),
  title: "Congressional Terminal",
  description:
    "Personal feed of recent US Congress bills with plain-English summaries.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={plexSans.variable}>
      <head>
        {/* HO 690 — CLIENT UI PREFERENCES, APPLIED BEFORE FIRST PAINT.
            Parser-blocking by design: it must run before the browser paints, or
            a reader who collapsed a section sees it flash in on every visit,
            which is the entire defect the mechanism exists to remove. The body
            is GENERATED from the `PREFS` table in lib/prefs.ts, so the script
            and the consumers cannot drift; read that file for why it writes
            `data-*` and never `class`, and why the default is the attribute's
            ABSENCE. The layout stays a plain server component — no `cookies()`
            read, no render-mode change on any route. */}
        <script
          dangerouslySetInnerHTML={{ __html: prefBootScript() }}
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
