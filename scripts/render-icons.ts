/**
 * HO 819 — CT's icon set, drawn from the ruled mark.
 *
 * The ruling, Corey, 11:24 AM MST 2026-11-16, on mock-819 v1:
 *   "C (:\), amber ground, labelled CT, opens standalone"
 * The ruled mock is docs/design/mock-819-icon.html (v2). This script copies its
 * draw() and run() for C on amber: the masthead's `:\` in IBM Plex Mono 600, in
 * CT's base #0a0e14, centred on a full square of #d97706, cut about a fifth
 * larger (k = 1.22) at 32px and under.
 *
 * Run from the repo root:  npx tsx scripts/render-icons.ts
 *
 * THE FILES IT WRITES ARE ITS OUTPUT, committed beside it, and Next serves them
 * by convention:
 *   app/favicon.ico            16, 32 and 48, PNG-in-ICO   → /favicon.ico
 *   app/icon.png               32                          → <link rel="icon">
 *   app/apple-icon.png         180                         → <link rel="apple-touch-icon">
 *   public/icons/icon-192.png  192                         → app/manifest.ts
 *   public/icons/icon-512.png  512 (any and maskable)      → app/manifest.ts
 * To change the mark, change this script, run it again, and commit both. Don't
 * edit the files by hand. The text is pixels in every file, so no device needs
 * the font.
 *
 * It opens headless Chromium on a page whose only content is an @font-face for
 * IBM Plex Mono 600, read off disk from app/fonts/ibm-plex-mono/latin-600.woff2
 * as a data URL. Every network request is aborted, so it fetches nothing, and
 * it fails if the face didn't load. Each size is drawn on a canvas of S × S
 * device pixels (deviceScaleFactor 1). The ICO is assembled here, with no
 * dependency: a 6-byte ICONDIR, a 16-byte ICONDIRENTRY per image, then the PNGs.
 * The gate is e2e/smoke.spec.ts's "icon and manifest (HO 819)".
 */
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const FONT_FILE = "app/fonts/ibm-plex-mono/latin-600.woff2";
const GROUND = "#d97706";
const MARK = "#0a0e14";

const PNGS: [path: string, size: number][] = [
  ["app/icon.png", 32],
  ["app/apple-icon.png", 180],
  ["public/icons/icon-192.png", 192],
  ["public/icons/icon-512.png", 512],
];
const ICO_FILE = "app/favicon.ico";
const ICO_SIZES = [16, 32, 48];

function pngBytes(dataUrl: string, size: number): Buffer {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) throw new Error(`not a PNG data URL at ${size}`);
  const buf = Buffer.from(dataUrl.slice(prefix.length), "base64");
  // The IHDR's width and height, at bytes 16 and 20.
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== size || h !== size) throw new Error(`drew ${w}x${h}, wanted ${size}x${size}`);
  return buf;
}

function icoOf(images: [size: number, png: Buffer][]): Buffer {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type 1, an icon
  dir.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = dir.length + entries.length;
  images.forEach(([size, png], i) => {
    const e = 16 * i;
    entries.writeUInt8(size >= 256 ? 0 : size, e); // width
    entries.writeUInt8(size >= 256 ? 0 : size, e + 1); // height
    entries.writeUInt8(0, e + 2); // palette colours
    entries.writeUInt8(0, e + 3); // reserved
    entries.writeUInt16LE(1, e + 4); // planes
    entries.writeUInt16LE(32, e + 6); // bit count
    entries.writeUInt32LE(png.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([dir, entries, ...images.map(([, png]) => png)]);
}

async function main(): Promise<void> {
  if (!existsSync(FONT_FILE)) throw new Error(`${FONT_FILE} not found: run from the repo root`);
  const font = readFileSync(FONT_FILE).toString("base64");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1 });
    const page = await context.newPage();
    const fetched: string[] = [];
    await page.route("**/*", (route) => {
      fetched.push(route.request().url());
      return route.abort();
    });
    await page.setContent(
      `<!doctype html><style>@font-face{font-family:"IBM Plex Mono";font-weight:600;font-style:normal;` +
        `src:url(data:font/woff2;base64,${font}) format("woff2")}</style>`,
    );
    const face = await page.evaluate(async () => {
      const faces = await document.fonts.load('600 64px "IBM Plex Mono"');
      return {
        loaded: faces.filter((f) => f.status === "loaded").length,
        check: document.fonts.check('600 64px "IBM Plex Mono"'),
      };
    });
    if (face.loaded < 1 || !face.check)
      throw new Error(`IBM Plex Mono 600 didn't load (faces loaded ${face.loaded}, check ${face.check})`);

    // mock-819's draw() for C on amber, with its run() inlined for one part.
    const draw = async (S: number): Promise<Buffer> =>
      pngBytes(
        await page.evaluate(
          ({ S, ground, mark }) => {
            const cv = document.createElement("canvas");
            cv.width = S;
            cv.height = S;
            const ctx = cv.getContext("2d")!;
            const k = S <= 32 ? 1.22 : 1;
            ctx.fillStyle = ground;
            ctx.fillRect(0, 0, S, S);
            const em = S * 0.4667 * k;
            ctx.font = "600 " + em + 'px "IBM Plex Mono"';
            ctx.textBaseline = "alphabetic";
            const x = (S - ctx.measureText(":\\").width) / 2;
            const y = S / 2 + (em * 0.698) / 2;
            ctx.fillStyle = mark;
            ctx.fillText(":\\", x, y);
            return cv.toDataURL("image/png");
          },
          { S, ground: GROUND, mark: MARK },
        ),
        S,
      );

    const out: [path: string, bytes: Buffer][] = [];
    for (const [path, S] of PNGS) out.push([path, await draw(S)]);
    const icoImages: [number, Buffer][] = [];
    for (const S of ICO_SIZES) icoImages.push([S, await draw(S)]);
    out.push([ICO_FILE, icoOf(icoImages)]);
    if (fetched.length) throw new Error(`the page asked the network for ${fetched.join(", ")}`);

    for (const [path, bytes] of out) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      const sha = createHash("sha256").update(bytes).digest("hex");
      console.log(`${path}  ${bytes.length} bytes  sha256 ${sha}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
