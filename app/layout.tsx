import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
