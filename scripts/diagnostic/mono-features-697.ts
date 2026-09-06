/**
 * HO 697 row 2 — does `font-feature-settings: "ss01", "cv02"` do anything to
 * IBM Plex Mono?
 *
 * `app/globals.css:190` sets those two stylistic tags on `html, body`, and row 3
 * measured them computing onto 33,964 of 33,966 mono text elements. They were
 * chosen for a face the repo never loaded (see the C2 commit), so what they do to
 * Plex Mono is unmeasured — and "it inherits everywhere" is exactly why guessing
 * is not good enough.
 *
 * Renders one specimen line twice in the SAME box, Plex Mono, one span with the
 * declaration and one without, screenshots each span and compares the PNG bytes.
 * Identical bytes = the declaration is inert on this face.
 *
 * Font comes from Google Fonts over the network, which is the same source
 * `next/font/google` fetches at build time — so this measures the face that will
 * ship, not a system substitute. It asserts the face actually loaded before
 * measuring; without that check a failed font load renders both spans in the
 * fallback and reports a confident, meaningless "identical".
 *
 * READING, 2026-09-05, IBM Plex Mono loaded (control TRUE):
 *   specimen "ag l0O1I{}[]<>=!- 0123456789"
 *   with "ss01","cv02" 7794 bytes · with normal 7794 bytes · identical TRUE
 *   text advance width  on 571.203125 · off 571.203125
 * VERDICT inert. C2 dropped the declaration. Inert FOR THOSE GLYPHS — they are
 * the ones a stylistic set would target, which is why the string is recorded.
 */
import { chromium } from "playwright";

const SPECIMEN = "ag l0O1I{}[]<>=!- 0123456789";

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=block" rel="stylesheet">
<style>
  body { margin: 0; background: #0a0e14; }
  span { display: block; width: 620px; padding: 14px 10px; font-size: 34px;
         color: #e5e7eb; font-family: "IBM Plex Mono", monospace; }
  #on  { font-feature-settings: "ss01", "cv02"; }
  #off { font-feature-settings: normal; }
</style></head><body>
<span id="on">${SPECIMEN}</span>
<span id="off">${SPECIMEN}</span>
</body></html>`;

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 700, height: 300 } });
  await page.setContent(PAGE, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);

  // Control first: if the face did not load, both spans are the fallback and any
  // "identical" verdict below is about the fallback, not about Plex Mono.
  const loaded = await page.evaluate(() =>
    document.fonts.check('34px "IBM Plex Mono"'),
  );
  console.log(`IBM Plex Mono loaded: ${loaded}`);
  if (!loaded) {
    console.error(
      "FACE DID NOT LOAD — refusing to report a diff. Any verdict here would be " +
        "about the fallback face. Re-run with network access to fonts.gstatic.com.",
    );
    await browser.close();
    process.exit(1);
  }

  const onEl = page.locator("#on");
  const offEl = page.locator("#off");
  const a = await onEl.screenshot();
  const b = await offEl.screenshot();

  const same = a.equals(b);
  console.log(`specimen: ${JSON.stringify(SPECIMEN)}`);
  console.log(`  with "ss01","cv02" : ${a.length} bytes`);
  console.log(`  with normal        : ${b.length} bytes`);
  console.log(`  PNG bytes identical: ${same}`);

  // A byte compare can differ for encoder reasons; confirm with a pixel-level
  // read of the two boxes' widths, which any glyph substitution would move.
  // NB: no nested named function inside evaluate — tsx injects a `__name`
  // helper that does not exist in the page context and the call throws there.
  const widths = await page.evaluate(() => {
    const out: Record<string, number> = {};
    for (const id of ["on", "off"]) {
      const el = document.getElementById(id);
      if (!el) continue;
      const r = document.createRange();
      r.selectNodeContents(el);
      out[id] = r.getBoundingClientRect().width;
    }
    return out;
  });
  console.log(`  text advance width : on ${widths.on} · off ${widths.off}`);

  console.log(
    same
      ? "\nVERDICT: the declaration is INERT on IBM Plex Mono — it selects no\n" +
          "alternate this face carries. C2 drops it, and says so."
      : "\nVERDICT: the declaration CHANGES a glyph. That is a design choice, not a\n" +
          "cleanup — HALT and put both captures in front of Corey.",
  );
  await browser.close();
}

main();
