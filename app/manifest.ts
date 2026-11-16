import type { MetadataRoute } from "next";

// HO 819 — CT's web app manifest, served at /manifest.webmanifest and linked from
// every page's head. Ruled by Corey, 11:24 AM MST 2026-11-16, on
// docs/design/mock-819-icon.html: "C (:\), amber ground, labelled CT, opens
// standalone". So `short_name` is CT, the label under the icon on a home screen;
// `name` stays the full one; and `display` opens it in its own window, with no
// address bar. With a name, a 192 and a 512, a start_url and that display, Chrome
// offers Install app. There is no service worker, and this doesn't need one.
//
// The icons are scripts/render-icons.ts's output. One 512 serves both purposes:
// the ground is full-bleed and the mark sits inside the maskable safe circle, so
// a launcher's crop shows ground around it (the smoke spec's I5 holds that).
//
// The two colours are LITERALS, like the layout's `themeColor`, which is
// `--bg-base`. The smoke spec's I4 holds them to the served theme-color, and the
// touch gate holds that to `--bg-base`, so the chain is gated.
//
// No `description`: it would be a second home for the layout's.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Congressional Terminal",
    short_name: "CT",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0e14",
    theme_color: "#0a0e14",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
