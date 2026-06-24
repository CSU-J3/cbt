import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // HO 361 — metadataBase so /welcome's OG card resolves to an absolute URL.
  // Points at the branded host congressional-terminal-chi-silk.vercel.app, which
  // is a live attached production domain on the Vercel project (verified against
  // the project's domains list — the OAuth callback runs through it). cbt-chi-silk
  // is the legacy alias, also attached; the broader brand/URL rename (README,
  // verify:deploy host, in-app strings) is a separate sweep, out of scope here.
  metadataBase: new URL("https://congressional-terminal-chi-silk.vercel.app"),
  title: "CBT — Congress Bill Terminal",
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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
