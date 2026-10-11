import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { prefBootScript } from "@/lib/prefs";
import "./globals.css";
import "./fonts/ibm-plex.css";

// HO 772 — BOTH FACES ARE FILES IN THIS REPO, SO NO BUILD ASKS GOOGLE FOR
// ANYTHING. next/font/google fetched Google's stylesheet and files at build
// time, and since HO 768 every build is cold, so every build asked again; on
// 2026-10-10 a Preview of the commit Production had just built failed in
// next/font/google with 18 errors (docs/oddities.md, HO 772). The bytes are
// Production's own, as served at 3785c41: app/fonts/ibm-plex-sans/ and
// app/fonts/ibm-plex-mono/ hold the woff2 files, named by subset (and weight,
// where each weight is its own file). The two calls below carry the latin cut
// only, the one Next preloads, because next/font/local takes a unicode-range
// only for a whole call; every other subset, renamed IBM Plex Sans Subsets and
// IBM Plex Mono Subsets, and both metric fallbacks (Production's names and
// values) are in app/fonts/ibm-plex.css, in Production's order with its
// descriptors. Each variable reads the latin family, then Subsets, then
// Fallback, so every character gets the face Production gave it
// (scripts/diagnostic/fonts-local-772.ts measures that). adjustFontFallback is
// off because next/font/local would compute its fallback from a plain average
// advance, not capsize's weighted width, and the fallback has to stay
// Production's. The fallback names are single-quoted because Turbopack writes
// the list into a double-quoted JS string without escaping it. License:
// app/fonts/OFL.txt.
// DO NOT BRING BACK next/font/google: Turbopack can't carry a Google font URL
// that has its own query string, and one such answer failed a build.

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
const plexSans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans/latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans/latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans/latin.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--font-plex-sans",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+??,U+131,U+152-153,U+2BB-2BC,U+2C6,U+2DA,U+2DC,U+304,U+308,U+329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
    { prop: "font-stretch", value: "100%" },
  ],
  adjustFontFallback: false,
  fallback: ["'IBM Plex Sans Subsets'", "'IBM Plex Sans Fallback'"],
});

// HO 697 — the MONO half, and it is the same fix as the sans one above rather
// than a brand change dressed up. `--font-mono` was
// `ui-monospace, "JetBrains Mono", …` and NOTHING IN THIS REPO EVER LOADED ANY OF
// THOSE, so the app's default face was whatever the host happened to have:
// Consolas on the Windows box, SF Mono on the MacBook, DejaVu or Liberation on
// the Ubuntu runner. That is the mono half of the HO 694 host-dependence finding
// (docs/method.md § Environment — font metrics differ per host), and the entry's
// own name for it, "JetBrains -> IBM Plex Mono", is a misnomer: JetBrains Mono
// was never served anywhere it was not already installed.
//
// FOUR WEIGHTS BECAUSE FOUR ARE RENDERED, measured not assumed
// (scripts/diagnostic/mono-weights-697.ts, 2026-09-05, 36/36 routes at 1440,
// 33,966 mono text elements): 400 = 27,508 (81.0%) · 600 = 4,636 (13.6%) ·
// 500 = 1,549 (4.6%) · 700 = 273 (0.8%). 700 is small and real — /bills,
// /members, /changes, /stale, /president, report-detail — and a used weight that
// is not loaded gets synthesised, which is the faux-bold complaint HO 642
// answered on the sans side. A loaded weight nobody uses is bytes on every page,
// so the set is exactly what the probe saw.
//
// Ruled by Corey 2026-08-17 in the /welcome mock, which toggles the two faces via
// a `body.plexmono` class; backlog:137. Same preload caveat as the sans above —
// FONT TIMING IS MEASURED ON THE DEPLOY, NEVER ON THIS BOX.
const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono/latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono/latin-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono/latin-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-mono/latin-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-plex-mono",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+??,U+131,U+152-153,U+2BB-2BC,U+2C6,U+2DA,U+2DC,U+304,U+308,U+329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    },
  ],
  adjustFontFallback: false,
  fallback: ["'IBM Plex Mono Subsets'", "'IBM Plex Mono Fallback'"],
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
// HO 772: NextFontManifestPlugin above, and the Windows break below, are
// webpack's. CBT now builds with Turbopack, which doesn't run that plugin, and
// HO 772's local build on the Windows box preloaded all five latin files, in
// the Link header and as <link> elements
// (docs/handoffs/772-artifacts/dry/capture-local-dry.json). The two paragraphs
// below and their 2026-08-09 measurement stay as the webpack-era record.
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
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
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
