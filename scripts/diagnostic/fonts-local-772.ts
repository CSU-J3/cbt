// HO 772 — legs A, B1 and C: the two IBM Plex faces leave next/font/google for
// files in the repo (app/fonts/), so no build asks Google for anything.
//
//   npx tsx scripts/diagnostic/fonts-local-772.ts capture --base <origin> --label <name>
//       [--expect-sha <sha>] [--share <url>] [--drop-subsets] [--write] [--shots] [--out <dir>]
//   npx tsx scripts/diagnostic/fonts-local-772.ts compare <a.json> <b.json> [--control <c.json>] [--self]
//   npx tsx scripts/diagnostic/fonts-local-772.ts built <capture.json> [--dir .next/static]
//
// capture (legs A and C). Opens <origin>/ in Chromium at 1440×900, DPR 1, reduced motion. Records
//   every @font-face of the families the two variables name (--font-plex-sans and
//   --font-plex-mono, read computed off <html>), in stylesheet order: the family, every
//   descriptor as served, the unicode-range as written and as a code-point set, and the src.
//   Downloads each distinct src once (sha256, size, the faces it serves). Reads the font preloads
//   from the document's Link header, where Production sends them, and from any
//   <link rel=preload as=font>. Then injects the specimen block (one span per stack, weight and
//   specimen), waits for every load it triggers, and records each span's width as the full float,
//   the loaded FontFaces, each font request's host and a PNG of the block.
//     --write (leg A, Production only) checks the set has the handoff's shape (HALT, exit 3, if
//       not), vendors the files into app/fonts/ibm-plex-<sans|mono>/, writes
//       app/fonts/ibm-plex.css, and prints the two localFont calls' src arrays and declarations.
//     --drop-subsets (leg C's control) strips the Subsets family from both variables first.
//     --share visits a Vercel share link first: Previews sit behind Vercel Authentication.
//     --shots adds viewport PNGs of / and /electoral, for the eye, not a gate.
// compare (leg C). C1 the faces, C2 the preloads, C3 the stack (read off b), C4 the specimen.
//   Production against a second read of itself (--self, where C3 does not apply) is the
//   determinism control. --control reads b's drop-subsets capture against b: every cell whose
//   text resolves to a non-latin face must change width, and every other cell must not.
// built (leg B1). The CSS under .next/static against a capture: the 38 web faces and 2 fallbacks
//   with Production's descriptors, the media files' bytes, and no Google font host in the dir.
//
// Exit 0: every check passed. 1: a check failed. 3: HALT, Production's set has another shape.
import { chromium, type Page, type Request } from "playwright";
import postcss from "postcss";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";

const VIEWPORT = { width: 1440, height: 900 };
const DEFAULT_OUT = "docs/handoffs/772-artifacts";
const GOOGLE_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

// The handoff's six specimens, verbatim.
const SPECIMENS: { key: string; text: string }[] = [
  { key: "latin", text: "Hamburgefonstiv 0123456789 “quotes” – — ½ ©" },
  { key: "latin-ext", text: "Łódź Erdoğan Babiš Ţară Őr" },
  { key: "greek", text: "ΔΣΩ αβγδε" },
  { key: "cyrillic", text: "Жизнь Москва Ёё" },
  { key: "vietnamese", text: "Nguyễn Việt Ơ ư" },
  { key: "outside", text: "→ ★ ✓ ∞" },
];

type StackName = "sans" | "mono";
const STACKS: { stack: StackName; cssVar: string; weights: string[]; subsets: string[] }[] = [
  {
    stack: "sans",
    cssVar: "var(--sans)",
    weights: ["400", "500", "600"],
    subsets: ["cyrillic-ext", "cyrillic", "greek", "vietnamese", "latin-ext", "latin"],
  },
  {
    stack: "mono",
    cssVar: "var(--font-mono)",
    weights: ["400", "500", "600", "700"],
    subsets: ["cyrillic-ext", "cyrillic", "vietnamese", "latin-ext", "latin"],
  },
];

// A subset is named by its range's first code point. Code points, not strings: the minifier may
// drop leading zeros.
const SUBSET_BY_FIRST = new Map<number, string>([
  [0x0000, "latin"],
  [0x0100, "latin-ext"],
  [0x0102, "vietnamese"],
  [0x0301, "cyrillic"],
  [0x0370, "greek"],
  [0x0460, "cyrillic-ext"],
]);

type Range = [number, number];
type Face = {
  order: number;
  sheet: string;
  family: string;
  stack: StackName;
  kind: "web" | "fallback";
  decls: [string, string][];
  weight: string;
  style: string;
  display: string;
  stretch: string;
  unicodeRange: string;
  ranges: Range[];
  cps: string;
  subset: string;
  src: string;
  url: string | null;
  sha256: string | null;
  bytes: number | null;
};
type Cell = { stack: string; weight: string; specimen: string; text: string; width: number };
type Loaded = { family: string; weight: string; style: string; stretch: string; unicodeRange: string; display: string };
type FontRequest = { phase: "page" | "block"; url: string; host: string; status: number | null; failure: string | null };
type Capture = {
  label: string;
  base: string;
  host: string;
  takenAt: string;
  sha: string;
  browser: string;
  userAgent: string;
  dropSubsets: boolean;
  variables: { sans: string; mono: string };
  variablesAtSpecimen: { sans: string; mono: string };
  stacks: { sans: string[]; mono: string[] };
  stylesheets: string[];
  faces: Face[];
  files: { url: string; sha256: string; bytes: number; faces: number[] }[];
  preloads: { source: "link-header" | "dom"; url: string; sha256: string; bytes: number }[];
  cells: Cell[];
  loadedBefore: Loaded[];
  loadedAfter: Loaded[];
  fontRequests: FontRequest[];
  png: string;
  pngSha256: string;
};

class Halt extends Error {}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const hex = (n: number) => n.toString(16).toUpperCase();
const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2");
const splitFamilies = (v: string) => v.split(",").map(unquote).filter((s) => s.length > 0);
const covers = (r: Range[], cp: number) => r.some(([a, b]) => cp >= a && cp <= b);
const cpsOf = (r: Range[]) => r.map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join(",");
const short = (s: string | null) => (s ? s.slice(0, 12) : "-");
const base_ = (u: string | null) => (u ? u.split("/").pop() ?? u : "-");

function parseRanges(ur: string): Range[] {
  const out: Range[] = [];
  for (const raw of ur.split(",")) {
    const t = raw.trim().replace(/^u\+/i, "");
    if (!t) continue;
    let a: number;
    let b: number;
    if (t.includes("?")) {
      a = parseInt(t.replace(/\?/g, "0"), 16);
      b = parseInt(t.replace(/\?/g, "F"), 16);
    } else if (t.includes("-")) {
      const [x = "", y = ""] = t.split("-");
      a = parseInt(x, 16);
      b = parseInt(y, 16);
    } else {
      a = b = parseInt(t, 16);
    }
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) throw new Error(`unparseable unicode-range token "${raw}"`);
    out.push([a, b]);
  }
  out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const merged: Range[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

// Every @font-face of the stacks' families in `css`, in rule order. `resolve` turns a url() into
// an absolute URL (capture) or a file path (built).
function readFaces(
  css: string,
  sheet: string,
  resolve: (ref: string) => string,
  stacks: { sans: string[]; mono: string[] },
  start: number,
): Face[] {
  const faces: Face[] = [];
  postcss.parse(css).walkAtRules((at) => {
    if (at.name.toLowerCase() !== "font-face") return;
    const decls: [string, string][] = [];
    at.each((n) => {
      if (n.type === "decl") decls.push([n.prop.toLowerCase(), n.value.trim()]);
    });
    const get = (p: string) => decls.find(([k]) => k === p)?.[1] ?? "";
    const family = unquote(get("font-family"));
    const stack: StackName | null = stacks.sans.includes(family) ? "sans" : stacks.mono.includes(family) ? "mono" : null;
    if (!stack) return;
    const src = get("src");
    const unicodeRange = get("unicode-range");
    const ranges = unicodeRange ? parseRanges(unicodeRange) : [];
    const ref = /url\(\s*(["']?)([^"')]+)\1\s*\)/i.exec(src)?.[2] ?? null;
    const first = ranges[0]?.[0];
    faces.push({
      order: start + faces.length,
      sheet,
      family,
      stack,
      kind: ref ? "web" : "fallback",
      decls,
      weight: get("font-weight"),
      style: get("font-style"),
      display: get("font-display"),
      stretch: get("font-stretch"),
      unicodeRange,
      ranges,
      cps: cpsOf(ranges),
      subset: first === undefined ? "" : SUBSET_BY_FIRST.get(first) ?? `U+${hex(first)}`,
      src,
      url: ref ? resolve(ref) : null,
      sha256: null,
      bytes: null,
    });
  });
  return faces;
}

// `</a.woff2>; rel=preload; as="font", </b.css>; rel=preload; as="style"` → the font hrefs.
function linkHeaderFonts(header: string): string[] {
  const out: string[] = [];
  for (const entry of header.split(/,(?=\s*<)/)) {
    const href = /<([^>]+)>/.exec(entry)?.[1];
    if (href && /;\s*rel="?preload"?/i.test(entry) && /;\s*as="?font"?/i.test(entry)) out.push(href);
  }
  return out;
}

const readLoaded = (page: Page): Promise<Loaded[]> =>
  page.evaluate(() =>
    Array.from(document.fonts)
      .filter((f) => f.status === "loaded")
      .map((f) => ({
        family: f.family.replace(/^["']|["']$/g, ""),
        weight: f.weight,
        style: f.style,
        stretch: f.stretch,
        unicodeRange: f.unicodeRange,
        display: f.display,
      })),
  );

const readVariables = (page: Page) =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { sans: cs.getPropertyValue("--font-plex-sans").trim(), mono: cs.getPropertyValue("--font-plex-mono").trim() };
  });

// Until the FontFaceSet is quiet: no face loading, status loaded, the same statuses three frames
// running.
const settle = (page: Page) =>
  page.evaluate(async () => {
    let stable = 0;
    let last = "";
    for (let i = 0; i < 400 && stable < 3; i++) {
      await document.fonts.ready;
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const faces = Array.from(document.fonts);
      const sig = faces.map((f) => f.status).join(",");
      const quiet = document.fonts.status === "loaded" && !faces.some((f) => f.status === "loading");
      stable = quiet && sig === last ? stable + 1 : 0;
      last = sig;
    }
    return stable >= 3;
  });

type Opts = {
  base: string;
  label: string;
  expectSha?: string;
  share?: string;
  drop: boolean;
  write: boolean;
  shots: boolean;
  out: string;
};

async function capture(o: Opts): Promise<Capture> {
  const base = new URL(o.base).origin;
  mkdirSync(o.out, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "reduce" });
    if (o.share) {
      const p0 = await context.newPage();
      const r0 = await p0.goto(o.share, { waitUntil: "load" });
      console.log(`share link: ${r0?.status() ?? "no response"}, landed on ${new URL(p0.url()).origin}`);
      await p0.close();
    }
    const ver = await context.request.get(`${base}/api/version`);
    if (!ver.ok()) throw new Error(`${base}/api/version answered ${ver.status()}`);
    const sha = String(((await ver.json()) as { sha?: unknown }).sha ?? "");
    console.log(`${base} serves ${sha}`);
    if (o.expectSha && !sha.startsWith(o.expectSha)) throw new Halt(`${base} serves ${sha}, not ${o.expectSha}`);

    const page = await context.newPage();
    let phase: FontRequest["phase"] = "page";
    const reqs: { phase: FontRequest["phase"]; req: Request }[] = [];
    const pending = new Set<Request>();
    page.on("request", (r) => {
      if (r.resourceType() !== "font") return;
      reqs.push({ phase, req: r });
      pending.add(r);
    });
    page.on("requestfinished", (r) => pending.delete(r));
    page.on("requestfailed", (r) => pending.delete(r));
    const drain = async () => {
      for (let i = 0; i < 400 && pending.size > 0; i++) await page.waitForTimeout(50);
    };

    const res = await page.goto(`${base}/`, { waitUntil: "load" });
    if (!res || res.status() !== 200) throw new Error(`${base}/ answered ${res?.status() ?? "nothing"}`);
    const linkHeader = (await res.allHeaders())["link"] ?? "";
    await settle(page);
    await drain();
    const variables = await readVariables(page);
    const stacks = { sans: splitFamilies(variables.sans), mono: splitFamilies(variables.mono) };
    const stylesheets = await page.evaluate(() =>
      Array.from(document.styleSheets)
        .map((s) => s.href)
        .filter((h): h is string => !!h),
    );
    const domPreloads = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="font"]')).map((l) => l.href),
    );
    const loadedBefore = await readLoaded(page);

    const faces: Face[] = [];
    for (const href of stylesheets) {
      const r = await context.request.get(href);
      if (!r.ok()) throw new Error(`${href} answered ${r.status()}`);
      faces.push(...readFaces(await r.text(), new URL(href).pathname, (ref) => new URL(ref, href).toString(), stacks, faces.length));
    }
    const bodies = new Map<string, Buffer>();
    const files = new Map<string, Capture["files"][number]>();
    const fetchFile = async (url: string) => {
      let f = files.get(url);
      if (!f) {
        const r = await context.request.get(url);
        if (!r.ok()) throw new Error(`${url} answered ${r.status()}`);
        const body = await r.body();
        bodies.set(url, body);
        f = { url, sha256: sha256(body), bytes: body.length, faces: [] };
        files.set(url, f);
      }
      return f;
    };
    for (const face of faces) {
      if (!face.url) continue;
      const f = await fetchFile(face.url);
      f.faces.push(face.order);
      face.sha256 = f.sha256;
      face.bytes = f.bytes;
    }
    const preloads: Capture["preloads"] = [];
    for (const href of linkHeaderFonts(linkHeader)) {
      const url = new URL(href, base).toString();
      const f = await fetchFile(url);
      preloads.push({ source: "link-header", url, sha256: f.sha256, bytes: f.bytes });
    }
    for (const url of domPreloads) {
      const f = await fetchFile(url);
      preloads.push({ source: "dom", url, sha256: f.sha256, bytes: f.bytes });
    }

    let drop = "";
    if (o.drop) {
      const isSub = (n: string) => / Subsets$/.test(n);
      if (!stacks.sans.some(isSub) || !stacks.mono.some(isSub)) {
        throw new Error(`--drop-subsets: no Subsets family to drop in ${JSON.stringify(stacks)}`);
      }
      const keep = (names: string[]) => names.filter((n) => !isSub(n)).map((n) => JSON.stringify(n)).join(", ");
      drop = `html{--font-plex-sans:${keep(stacks.sans)} !important;--font-plex-mono:${keep(stacks.mono)} !important}`;
    }
    phase = "block";
    await page.evaluate(
      ({ specimens, stacks: st, drop: css }) => {
        if (css) {
          const style = document.createElement("style");
          style.id = "fonts-772-drop";
          style.textContent = css;
          document.head.appendChild(style);
        }
        const box = document.createElement("div");
        box.id = "fonts-772-specimen";
        box.setAttribute(
          "style",
          "all: initial; display: block; position: absolute; left: 0; top: 0; z-index: 2147483647;" +
            " background: #ffffff; color: #000000; padding: 8px; font-size: 20px; line-height: 32px;",
        );
        for (const s of st) {
          for (const w of s.weights) {
            for (const sp of specimens) {
              const row = document.createElement("div");
              row.setAttribute("style", "display: block; white-space: nowrap;");
              const span = document.createElement("span");
              span.dataset.stack = s.stack;
              span.dataset.weight = w;
              span.dataset.specimen = sp.key;
              span.setAttribute(
                "style",
                `font-family: ${s.cssVar}; font-weight: ${w}; font-style: normal; display: inline-block; white-space: pre;`,
              );
              span.textContent = sp.text;
              row.appendChild(span);
              box.appendChild(row);
            }
          }
        }
        document.body.appendChild(box);
        void box.getBoundingClientRect();
      },
      { specimens: SPECIMENS, stacks: STACKS.map((s) => ({ stack: s.stack, cssVar: s.cssVar, weights: s.weights })), drop },
    );
    const quiet = (await settle(page)) && (await drain(), await settle(page));
    if (!quiet) throw new Error("the FontFaceSet never went quiet after the block");
    if (pending.size > 0) throw new Error(`${pending.size} font requests still pending`);
    const variablesAtSpecimen = await readVariables(page);
    const cells = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("#fonts-772-specimen [data-specimen]")).map((s) => ({
        stack: s.dataset.stack ?? "",
        weight: s.dataset.weight ?? "",
        specimen: s.dataset.specimen ?? "",
        text: s.textContent ?? "",
        width: s.getBoundingClientRect().width,
      })),
    );
    const loadedAfter = await readLoaded(page);
    const png = await page.locator("#fonts-772-specimen").screenshot({ animations: "disabled" });
    const pngName = `specimen-${o.label}.png`;
    writeFileSync(path.join(o.out, pngName), png);
    const fontRequests: FontRequest[] = [];
    for (const { phase: ph, req } of reqs) {
      const resp = await req.response();
      fontRequests.push({ phase: ph, url: req.url(), host: new URL(req.url()).host, status: resp?.status() ?? null, failure: req.failure()?.errorText ?? null });
    }

    if (o.shots) {
      for (const [name, route] of [["home", "/"], ["electoral", "/electoral"]] as const) {
        const p = await context.newPage();
        await p.goto(`${base}${route}`, { waitUntil: "load" });
        await settle(p);
        await p.screenshot({ path: path.join(o.out, `shot-${o.label}-${name}.png`), animations: "disabled" });
        await p.close();
      }
    }

    const cap: Capture = {
      label: o.label,
      base,
      host: new URL(base).host,
      takenAt: new Date().toISOString(),
      sha,
      browser: `chromium ${browser.version()}`,
      userAgent: await page.evaluate(() => navigator.userAgent),
      dropSubsets: o.drop,
      variables,
      variablesAtSpecimen,
      stacks,
      stylesheets,
      faces,
      files: [...files.values()],
      preloads,
      cells,
      loadedBefore,
      loadedAfter,
      fontRequests,
      png: pngName,
      pngSha256: sha256(png),
    };
    writeFileSync(path.join(o.out, `capture-${o.label}.json`), JSON.stringify(cap, null, 2) + "\n");
    report(cap);
    if (o.write) vendor(cap, bodies, o.out);
    return cap;
  } finally {
    await browser.close();
  }
}

function report(c: Capture) {
  console.log(`\n== capture ${c.label}: ${c.base} at ${c.sha.slice(0, 7)}, ${c.takenAt}, ${c.browser}`);
  console.log(`--font-plex-sans: ${c.variables.sans}`);
  console.log(`--font-plex-mono: ${c.variables.mono}`);
  if (c.dropSubsets) console.log(`at the specimen (dropped): ${c.variablesAtSpecimen.sans} | ${c.variablesAtSpecimen.mono}`);
  console.log(`stylesheets: ${c.stylesheets.map((s) => new URL(s).pathname).join(", ")}`);
  console.log(`\nfaces (${c.faces.length}): # family | weight style stretch display | subset | unicode-range | file sha256 bytes`);
  for (const f of c.faces) {
    if (f.kind === "fallback") {
      console.log(`  ${f.order} ${f.family} | FALLBACK | ${f.decls.map(([k, v]) => `${k}:${v}`).join("; ")}`);
    } else {
      console.log(
        `  ${f.order} ${f.family} | ${f.weight} ${f.style} ${f.stretch || "-"} ${f.display} | ${f.subset} | ${f.unicodeRange} | ${base_(f.url)} ${short(f.sha256)} ${f.bytes}`,
      );
    }
  }
  console.log(`\ndistinct files (${c.files.length}): file | sha256 | bytes | faces`);
  for (const f of c.files) console.log(`  ${base_(f.url)} | ${f.sha256} | ${f.bytes} | ${f.faces.join(",") || "(preload only)"}`);
  console.log(`\npreloads (${c.preloads.length}): source | file | sha256`);
  for (const p of c.preloads) console.log(`  ${p.source} | ${base_(p.url)} | ${p.sha256}`);
  console.log(`\nspecimen: ${c.cells.length} cells, png ${c.png} (sha256 ${c.pngSha256})`);
  for (const x of c.cells) console.log(`  ${x.stack} ${x.weight} ${x.specimen.padEnd(10)} ${x.width}`);
  console.log(`loaded faces: ${c.loadedBefore.length} before the block, ${c.loadedAfter.length} after`);
  const hosts = new Map<string, number>();
  for (const r of c.fontRequests) hosts.set(`${r.phase} ${r.host} ${r.status ?? r.failure}`, (hosts.get(`${r.phase} ${r.host} ${r.status ?? r.failure}`) ?? 0) + 1);
  console.log(`font requests (${c.fontRequests.length}): ${[...hosts].map(([k, n]) => `${k} ×${n}`).join("; ")}`);
}

// Leg A's --write: the handoff's shape or HALT, then the files, ibm-plex.css and the layout's calls.
function vendor(cap: Capture, bodies: Map<string, Buffer>, out: string) {
  const problems: string[] = [];
  const plan: { stack: StackName; subset: string; weight: string; face: Face; file: string }[] = [];
  for (const S of STACKS) {
    const names = cap.stacks[S.stack];
    const web = cap.faces.filter((f) => f.stack === S.stack && f.kind === "web");
    const fb = cap.faces.filter((f) => f.stack === S.stack && f.kind === "fallback");
    if (names.length !== 2) problems.push(`${S.stack}: the variable names ${names.length} families (${names.join(" | ")})`);
    if (web.length !== S.subsets.length * S.weights.length) {
      problems.push(`${S.stack}: ${web.length} web faces, not ${S.subsets.length} subsets × ${S.weights.length} weights`);
    }
    if (fb.length !== 1 || !/^local\(/i.test(fb[0]?.src ?? "")) problems.push(`${S.stack}: ${fb.length} fallback faces, src ${fb[0]?.src}`);
    for (const f of web) {
      if (f.family !== names[0]) problems.push(`${S.stack} face ${f.order}: family ${f.family}, not ${names[0]}`);
      if (f.style !== "normal" || f.display !== "swap" || !f.unicodeRange) {
        problems.push(`${S.stack} face ${f.order}: style ${f.style}, display ${f.display}, range "${f.unicodeRange}"`);
      }
      if (!S.subsets.includes(f.subset)) problems.push(`${S.stack} face ${f.order}: subset ${f.subset}`);
      if (!S.weights.includes(f.weight)) problems.push(`${S.stack} face ${f.order}: weight ${f.weight}`);
    }
    for (const sub of S.subsets) {
      for (const w of S.weights) {
        const n = web.filter((f) => f.subset === sub && f.weight === w).length;
        if (n !== 1) problems.push(`${S.stack} ${sub} ${w}: ${n} faces`);
      }
      const fs = web.filter((f) => f.subset === sub);
      const urls = new Set(fs.map((f) => f.url));
      if (urls.size === 1) for (const f of fs) plan.push({ stack: S.stack, subset: sub, weight: f.weight, face: f, file: `${sub}.woff2` });
      else if (urls.size === fs.length) for (const f of fs) plan.push({ stack: S.stack, subset: sub, weight: f.weight, face: f, file: `${sub}-${f.weight}.woff2` });
      else problems.push(`${S.stack} ${sub}: ${fs.length} faces on ${urls.size} files`);
    }
    const latin = web.filter((f) => f.subset === "latin");
    if (new Set(latin.map((f) => f.unicodeRange)).size !== 1) problems.push(`${S.stack}: the latin faces carry different ranges`);
    if (new Set(latin.map((f) => f.stretch)).size !== 1) problems.push(`${S.stack}: the latin faces carry different font-stretch`);
  }
  const latinUrls = new Set(plan.filter((p) => p.subset === "latin").map((p) => p.face.url ?? ""));
  const preUrls = new Set(cap.preloads.map((p) => p.url));
  if (latinUrls.size !== preUrls.size || [...latinUrls].some((u) => !preUrls.has(u))) {
    problems.push(`the preloads (${[...preUrls].map(base_).join(", ")}) are not the latin files (${[...latinUrls].map(base_).join(", ")})`);
  }
  if (problems.length > 0) throw new Halt(`Production's set has another shape:\n  ${problems.join("\n  ")}`);

  const written = new Map<string, string>();
  for (const p of plan) {
    const rel = `ibm-plex-${p.stack}/${p.file}`;
    const body = bodies.get(p.face.url ?? "");
    if (!body) throw new Error(`no body for ${p.face.url}`);
    if (written.has(rel)) continue;
    mkdirSync(path.join("app/fonts", `ibm-plex-${p.stack}`), { recursive: true });
    writeFileSync(path.join("app/fonts", rel), body);
    written.set(rel, sha256(body));
  }

  const fileOf = new Map(plan.map((p) => [p.face.order, `ibm-plex-${p.stack}/${p.file}`]));
  const block = (family: string, decls: [string, string][], src?: string) =>
    "@font-face {\n" +
    decls
      .map(([k, v]) => (k === "font-family" ? `  font-family: ${JSON.stringify(family)};` : k === "src" && src ? `  src: ${src};` : `  ${k}: ${v};`))
      .join("\n") +
    "\n}\n";
  const parts: string[] = [
    "/* HO 772: IBM Plex Sans and IBM Plex Mono, every face but the latin cut, and both metric\n" +
      "   fallbacks. The latin cut is the localFont calls in app/layout.tsx, which keep Next's\n" +
      "   preload. These are the files and descriptors Production served at 3785c41, in its order:\n" +
      "   the web families are renamed IBM Plex Sans Subsets and IBM Plex Mono Subsets, and the\n" +
      "   fallbacks keep Production's names and values. Written by\n" +
      "   scripts/diagnostic/fonts-local-772.ts capture --write. License: app/fonts/OFL.txt. */\n",
  ];
  for (const f of cap.faces) {
    const names = cap.stacks[f.stack];
    if (f.kind === "fallback") parts.push(block(f.family, f.decls));
    else if (f.subset !== "latin") {
      const fmt = /format\([^)]*\)/i.exec(f.src)?.[0];
      parts.push(block(`${names[0]} Subsets`, f.decls, `url("./${fileOf.get(f.order)}")${fmt ? ` ${fmt}` : ""}`));
    }
  }
  writeFileSync("app/fonts/ibm-plex.css", parts.join("\n"));

  const lines: string[] = [];
  for (const S of STACKS) {
    const names = cap.stacks[S.stack];
    const latin = plan.filter((p) => p.stack === S.stack && p.subset === "latin").sort((a, b) => Number(a.weight) - Number(b.weight));
    const first = latin[0]?.face;
    if (!first) continue;
    lines.push(`// ${S.stack}`);
    lines.push("src: [");
    for (const p of latin) lines.push(`  { path: "./fonts/ibm-plex-${S.stack}/${p.file}", weight: "${p.weight}", style: "normal" },`);
    lines.push("],");
    const decl = [`{ prop: "unicode-range", value: ${JSON.stringify(first.unicodeRange)} }`];
    if (first.stretch) decl.push(`{ prop: "font-stretch", value: ${JSON.stringify(first.stretch)} }`);
    lines.push(`declarations: [${decl.join(", ")}],`);
    // Single quotes inside: Turbopack's next/font/local writes the list into a double-quoted JS
    // string without escaping it, so '"…"' fails the build (Expected ',', got 'ident').
    lines.push(`fallback: ["'${names[0]} Subsets'", "'${names[1]}'"],`);
    lines.push("");
  }
  const snippet = lines.join("\n");
  writeFileSync(path.join(out, "layout-snippet.txt"), snippet + "\n");
  console.log(`\n== vendored ${written.size} files into app/fonts/, wrote app/fonts/ibm-plex.css`);
  for (const [rel, h] of written) console.log(`  app/fonts/${rel} ${h}`);
  console.log(`\n== for app/layout.tsx (also ${path.join(out, "layout-snippet.txt")}):\n${snippet}`);
}

// ---- compare (leg C) -------------------------------------------------------

function decodePng(buf: Buffer): { width: number; height: number; rgba: Buffer } {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data.readUInt8(8);
      color = data.readUInt8(9);
      interlace = data.readUInt8(12);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) {
    throw new Error(`unsupported PNG: depth ${depth}, color type ${color}, interlace ${interlace}`);
  }
  const bpp = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw.readUInt8(y * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const v = raw.readUInt8(y * (stride + 1) + 1 + x);
      const a = x >= bpp ? px.readUInt8(y * stride + x - bpp) : 0;
      const b = y > 0 ? px.readUInt8((y - 1) * stride + x) : 0;
      const c = x >= bpp && y > 0 ? px.readUInt8((y - 1) * stride + x - bpp) : 0;
      let r: number;
      if (filter === 0) r = v;
      else if (filter === 1) r = v + a;
      else if (filter === 2) r = v + b;
      else if (filter === 3) r = v + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`PNG filter ${filter}`);
      px.writeUInt8(r & 0xff, y * stride + x);
    }
  }
  if (bpp === 4) return { width, height, rgba: px };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba.writeUInt8(px.readUInt8(i * 3), i * 4);
    rgba.writeUInt8(px.readUInt8(i * 3 + 1), i * 4 + 1);
    rgba.writeUInt8(px.readUInt8(i * 3 + 2), i * 4 + 2);
    rgba.writeUInt8(255, i * 4 + 3);
  }
  return { width, height, rgba };
}

const webKey = (f: { stack: string; weight: string; style: string; cps: string }) => `${f.stack} ${f.weight} ${f.style} ${f.cps}`;
const cellKey = (x: Cell) => `${x.stack} ${x.weight} ${x.specimen}`;
const sortedDecls = (d: [string, string][]) => JSON.stringify([...d].sort((p, q) => p[0].localeCompare(q[0])));

function loadedKeys(c: Capture): string[] {
  return c.loadedAfter
    .map((l) => {
      const stack = c.stacks.sans.includes(l.family) ? "sans" : c.stacks.mono.includes(l.family) ? "mono" : null;
      if (!stack) return `other ${l.family}`;
      const fallback = c.faces.some((f) => f.kind === "fallback" && f.family === l.family);
      if (fallback) return `${stack} fallback`;
      const ranges = l.unicodeRange && l.unicodeRange !== "U+0-10FFFF" ? parseRanges(l.unicodeRange) : [];
      return webKey({ stack, weight: l.weight, style: l.style, cps: cpsOf(ranges) });
    })
    .sort();
}

// The subsets a cell's text resolves to, read off Production's faces: of the faces of the cell's
// stack and weight whose range covers a code point, the last one defined answers it (CSS Fonts 4,
// unicode-range overlap), as in Production's single family.
function nonLatinSubsets(prod: Capture, x: Cell): string[] {
  const faces = prod.faces.filter((f) => f.kind === "web" && f.stack === x.stack && f.weight === x.weight);
  const used = new Set<string>();
  for (const ch of x.text) {
    const cp = ch.codePointAt(0) ?? 0;
    let chosen: Face | undefined;
    for (const f of faces) if (covers(f.ranges, cp)) chosen = f;
    if (chosen && chosen.subset !== "latin") used.add(chosen.subset);
  }
  return [...used];
}

function compare(a: Capture, b: Capture, control: Capture | null, dir: string, self: boolean): number {
  let fails = 0;
  const check = (ok: boolean, msg: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
    if (!ok) fails++;
  };
  console.log(`== compare ${a.label} (${a.host} ${a.sha.slice(0, 7)}) against ${b.label} (${b.host} ${b.sha.slice(0, 7)})`);

  const aw = a.faces.filter((f) => f.kind === "web");
  const bw = b.faces.filter((f) => f.kind === "web");
  const bByKey = new Map(bw.map((f) => [webKey(f), f]));
  check(new Set(aw.map(webKey)).size === aw.length && new Set(bw.map(webKey)).size === bw.length, `C1 keys unique: ${aw.length} and ${bw.length} web faces`);
  let paired = 0;
  let sameDisplay = 0;
  let sameBytes = 0;
  for (const f of aw) {
    const g = bByKey.get(webKey(f));
    if (!g) {
      console.log(`      unpaired in ${b.label}: ${f.stack} ${f.weight} ${f.subset} (${f.family})`);
      continue;
    }
    paired++;
    if (f.display === g.display) sameDisplay++;
    else console.log(`      display differs: ${f.stack} ${f.weight} ${f.subset}: ${f.display} / ${g.display}`);
    if (f.sha256 !== null && f.sha256 === g.sha256) sameBytes++;
    else console.log(`      bytes differ: ${f.stack} ${f.weight} ${f.subset}: ${short(f.sha256)} / ${short(g.sha256)}`);
    console.log(`      ${f.stack} ${f.weight} ${f.style} ${f.subset.padEnd(12)} ${f.family} → ${g.family} · ${f.display}/${g.display} · ${short(f.sha256)}/${short(g.sha256)}`);
  }
  check(paired === aw.length && paired === bw.length, `C1 the web faces pair one to one by role, weight, style and code-point set: ${paired} of ${aw.length} and ${bw.length}`);
  check(sameDisplay === paired, `C1 each pair has the same display: ${sameDisplay} of ${paired}`);
  check(sameBytes === paired, `C1 each pair's served bytes have the same sha256: ${sameBytes} of ${paired}`);
  for (const st of ["sans", "mono"] as const) {
    const fa = a.faces.filter((f) => f.stack === st && f.kind === "fallback");
    const fb = b.faces.filter((f) => f.stack === st && f.kind === "fallback");
    const da = fa[0] ? sortedDecls(fa[0].decls) : "";
    const db = fb[0] ? sortedDecls(fb[0].decls) : "";
    console.log(`      ${st} fallback ${a.label}: ${da}`);
    console.log(`      ${st} fallback ${b.label}: ${db}`);
    check(fa.length === 1 && fb.length === 1 && da === db, `C1 the ${st} fallback is equal in every descriptor`);
  }

  const ap = new Set(a.preloads.map((p) => p.sha256));
  const bp = new Set(b.preloads.map((p) => p.sha256));
  check(ap.size === bp.size && [...ap].every((h) => bp.has(h)), `C2 the same set of preloaded files by sha256: ${ap.size} and ${bp.size}`);
  for (const p of b.preloads) console.log(`      ${b.label} ${p.source} ${base_(p.url)} ${p.sha256}`);

  for (const st of ["sans", "mono"] as const) {
    if (self) {
      console.log(`n/a   C3 on a self-read: ${b.label} --font-plex-${st}: ${b.variables[st]}`);
      continue;
    }
    const latinFamily = b.faces.find((f) => f.stack === st && f.kind === "web" && f.subset === "latin")?.family ?? "(none)";
    const want = [latinFamily, `${a.stacks[st][0] ?? "?"} Subsets`, a.stacks[st][1] ?? "?"];
    check(JSON.stringify(b.stacks[st]) === JSON.stringify(want), `C3 ${b.label} --font-plex-${st}: ${b.variables[st]}`);
  }

  const bCells = new Map(b.cells.map((x) => [cellKey(x), x]));
  let same = 0;
  for (const x of a.cells) {
    const y = bCells.get(cellKey(x));
    if (y && Object.is(x.width, y.width)) same++;
    else console.log(`      width differs: ${cellKey(x)} ${x.width} / ${y?.width}`);
  }
  check(same === a.cells.length && a.cells.length === b.cells.length && a.cells.length > 0, `C4 every width equal to the bit: ${same} of ${a.cells.length} cells`);
  const la = loadedKeys(a);
  const lb = loadedKeys(b);
  check(JSON.stringify(la) === JSON.stringify(lb), `C4 the loaded faces pair one to one: ${la.length} and ${lb.length}`);
  if (JSON.stringify(la) !== JSON.stringify(lb)) {
    for (const k of la) if (!lb.includes(k)) console.log(`      only in ${a.label}: ${k}`);
    for (const k of lb) if (!la.includes(k)) console.log(`      only in ${b.label}: ${k}`);
  }
  const pa = decodePng(readFileSync(path.join(dir, a.png)));
  const pb = decodePng(readFileSync(path.join(dir, b.png)));
  let diff = 0;
  if (pa.width === pb.width && pa.height === pb.height) {
    for (let i = 0; i < pa.rgba.length; i += 4) if (pa.rgba.readUInt32BE(i) !== pb.rgba.readUInt32BE(i)) diff++;
  }
  check(pa.width === pb.width && pa.height === pb.height && diff === 0, `C4 the PNGs are pixel-identical: ${pa.width}×${pa.height} and ${pb.width}×${pb.height}, ${diff} pixels differ`);
  for (const c of [a, b]) {
    const off = c.fontRequests.filter((r) => r.host !== c.host || r.status !== 200);
    check(off.length === 0 && c.fontRequests.length > 0, `C4 ${c.label}: all ${c.fontRequests.length} font requests answered 200 from ${c.host}`);
    for (const r of off) console.log(`      ${r.phase} ${r.url} ${r.status ?? r.failure}`);
  }

  if (control) {
    console.log(`\n== the control: ${control.label} (Subsets dropped) against ${b.label}`);
    console.log(`      at the specimen: ${control.variablesAtSpecimen.sans} | ${control.variablesAtSpecimen.mono}`);
    check(
      !/Subsets/.test(control.variablesAtSpecimen.sans) && !/Subsets/.test(control.variablesAtSpecimen.mono),
      "the control's variables carry no Subsets family at the specimen",
    );
    const cCells = new Map(control.cells.map((x) => [cellKey(x), x]));
    let mustMove = 0;
    let moved = 0;
    let mustHold = 0;
    let held = 0;
    for (const x of b.cells) {
      const y = cCells.get(cellKey(x));
      const subs = nonLatinSubsets(a, x);
      const changed = !y || !Object.is(x.width, y.width);
      console.log(`      ${cellKey(x).padEnd(22)} ${subs.length ? `non-latin (${subs.join(",")})` : "latin only"}: ${x.width} → ${y?.width} ${changed ? "changed" : "equal"}`);
      if (subs.length) {
        mustMove++;
        if (changed) moved++;
      } else {
        mustHold++;
        if (!changed) held++;
      }
    }
    check(mustMove > 0 && moved === mustMove, `the control: every cell whose text resolves to a non-latin face changes width: ${moved} of ${mustMove}`);
    check(held === mustHold, `the control (added): every other cell holds its width: ${held} of ${mustHold}`);
  }
  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL`}`);
  return fails;
}

// ---- built (leg B1) --------------------------------------------------------

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function built(prod: Capture, dir: string): number {
  let fails = 0;
  const check = (ok: boolean, msg: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
    if (!ok) fails++;
  };
  const all = walk(dir);
  const cssFiles = all.filter((p) => p.endsWith(".css"));
  const vars = new Map<string, Set<string>>();
  for (const p of cssFiles) {
    postcss.parse(readFileSync(p, "utf8")).walkDecls((d) => {
      if (d.prop !== "--font-plex-sans" && d.prop !== "--font-plex-mono") return;
      const s = vars.get(d.prop) ?? new Set<string>();
      s.add(d.value.trim());
      vars.set(d.prop, s);
    });
  }
  const one = (prop: string) => [...(vars.get(prop) ?? [])];
  console.log(`== built: ${dir}, ${cssFiles.length} CSS files`);
  console.log(`--font-plex-sans: ${one("--font-plex-sans").join(" || ")}`);
  console.log(`--font-plex-mono: ${one("--font-plex-mono").join(" || ")}`);
  check(one("--font-plex-sans").length === 1 && one("--font-plex-mono").length === 1, "each variable is declared with one value");
  const stacks = { sans: splitFamilies(one("--font-plex-sans")[0] ?? ""), mono: splitFamilies(one("--font-plex-mono")[0] ?? "") };
  const faces: Face[] = [];
  for (const p of cssFiles) faces.push(...readFaces(readFileSync(p, "utf8"), path.relative(dir, p), (ref) => path.resolve(path.dirname(p), ref.split(/[?#]/)[0] ?? ref), stacks, faces.length));
  const web = faces.filter((f) => f.kind === "web");
  const fbs = faces.filter((f) => f.kind === "fallback");
  check(web.length === 38 && fbs.length === 2, `the CSS holds ${web.length} web faces and ${fbs.length} fallbacks (38 and 2)`);
  const byKey = new Map(web.map((f) => [webKey(f), f]));
  let ok = 0;
  for (const f of prod.faces.filter((x) => x.kind === "web")) {
    const g = byKey.get(webKey(f));
    const bytes = g?.url && existsSync(g.url) ? sha256(readFileSync(g.url)) : null;
    const same = !!g && g.display === f.display && g.stretch === f.stretch && bytes === f.sha256;
    if (same) ok++;
    console.log(
      `      ${f.stack} ${f.weight} ${f.style} ${f.subset.padEnd(12)} ${g ? `${g.family} · ${g.display} · stretch ${g.stretch || "-"} · ${short(bytes)} ${bytes === f.sha256 ? "=" : "≠"} Production` : "MISSING"}`,
    );
  }
  check(ok === 38, `every Production web face has a built twin with its display, stretch, code points and bytes: ${ok} of 38`);
  for (const st of ["sans", "mono"] as const) {
    const pf = prod.faces.find((f) => f.stack === st && f.kind === "fallback");
    const bf = fbs.find((f) => f.stack === st);
    check(!!pf && !!bf && sortedDecls(pf.decls) === sortedDecls(bf.decls), `the ${st} fallback is Production's in every descriptor: ${bf ? sortedDecls(bf.decls) : "MISSING"}`);
  }
  const hits: string[] = [];
  for (const p of all) {
    const buf = readFileSync(p);
    for (const h of GOOGLE_HOSTS) if (buf.includes(h)) hits.push(`${path.relative(dir, p)}: ${h}`);
  }
  check(hits.length === 0, `no file under ${dir} names ${GOOGLE_HOSTS.join(" or ")}: ${all.length} files read, ${hits.length} hits`);
  for (const h of hits) console.log(`      ${h}`);
  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL`}`);
  return fails;
}

// ---- main ------------------------------------------------------------------

const VALUE_OPTS = new Set(["--base", "--label", "--expect-sha", "--share", "--out", "--control", "--dir"]);

async function main() {
  const argv = process.argv.slice(2);
  const mode = argv[0];
  const opt = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const positional = argv.slice(1).filter((a, i, arr) => !a.startsWith("--") && !(i > 0 && VALUE_OPTS.has(arr[i - 1] ?? "")));
  const out = opt("--out") ?? DEFAULT_OUT;
  try {
    if (mode === "capture") {
      const base = opt("--base");
      const label = opt("--label");
      if (!base || !label) throw new Error("capture needs --base and --label");
      await capture({
        base,
        label,
        expectSha: opt("--expect-sha"),
        share: opt("--share"),
        drop: argv.includes("--drop-subsets"),
        write: argv.includes("--write"),
        shots: argv.includes("--shots"),
        out,
      });
    } else if (mode === "compare") {
      const [pa, pb] = positional;
      if (!pa || !pb) throw new Error("compare needs two capture files");
      const load = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Capture;
      const ctl = opt("--control");
      const fails = compare(load(pa), load(pb), ctl ? load(ctl) : null, path.dirname(pa), argv.includes("--self"));
      process.exitCode = fails === 0 ? 0 : 1;
    } else if (mode === "built") {
      const [pc] = positional;
      if (!pc) throw new Error("built needs a capture file");
      process.exitCode = built(JSON.parse(readFileSync(pc, "utf8")) as Capture, opt("--dir") ?? ".next/static") === 0 ? 0 : 1;
    } else {
      console.log("usage: fonts-local-772.ts capture|compare|built …");
      process.exitCode = 2;
    }
  } catch (e) {
    if (e instanceof Halt) {
      console.log(`\nHALT: ${e.message}`);
      process.exitCode = 3;
    } else throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
