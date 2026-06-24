import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // HO 361 — metadataBase so /welcome's OG card resolves to an absolute URL.
  // Points at the ACTUAL live host (the one verify:deploy + every cron workflow
  // hit), NOT the aspirational congressional-terminal-* rename the handoff named
  // — that host doesn't serve today, so an OG card there would 404. The broader
  // brand/URL rename is a separate sweep (out of scope here).
  metadataBase: new URL("https://cbt-chi-silk.vercel.app"),
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
