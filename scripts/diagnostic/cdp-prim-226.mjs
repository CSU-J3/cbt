// HO 226 verification (scratch). Checks: (A) /races map unaffected by the
// primaries-gated CartogramShell edits; (B) single-list TX-Sen two-★ runoff
// unchanged; (C) primaries map recency colors + ●N badge; (D) modal three card
// states incl. the headline TX-Sen two-column (D decided | R runoff ★★).
import { writeFileSync } from "node:fs";
const BASE = "http://localhost:9225";
const mk = async (url) => {
  const tab = await (await fetch(`${BASE}/json/new?${encodeURIComponent(url)}`, { method: "PUT" }))
    .json().catch(async () => (await fetch(`${BASE}/json/new?${encodeURIComponent(url)}`)).json());
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const p = new Map();
  const send = (m, pr = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: pr })); });
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } };
  const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r?.result?.value; };
  await send("Page.enable"); await send("Runtime.enable");
  return { ws, send, ev, tab };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

// ── A: /races map unaffected ──────────────────────────────────────────────
{
  const { ws, send, ev } = await mk("http://localhost:3000/races");
  await send("Page.navigate", { url: "http://localhost:3000/races" }); await sleep(4000);
  out.races = await ev(`(() => {
    const gs = [...document.querySelectorAll('.us-map svg > g')];
    const anyOpacity = gs.some(g => g.hasAttribute('opacity'));
    const fills = new Set([...document.querySelectorAll('.us-map-state')].map(p => p.getAttribute('fill')));
    const anyDotLabel = [...document.querySelectorAll('.us-map-label,.us-map-leaderlabel')].some(t => t.textContent.includes('●'));
    const legend = document.querySelector('.cart-legend')?.innerText.replace(/\\n/g,' ');
    return { anyOpacityAttr: anyOpacity, fillsSample: [...fills].slice(0,6), anyDotLabel, legend };
  })()`);
  ws.close();
}

// ── B: /primaries single-list TX-Sen runoff (LIST view) ───────────────────
{
  const { ws, send, ev } = await mk("http://localhost:3000/primaries");
  await send("Page.navigate", { url: "http://localhost:3000/primaries" }); await sleep(4000);
  // switch to LIST
  await ev(`[...document.querySelectorAll('.cart-viewtoggle-btn')].find(b=>b.textContent.trim()==='LIST')?.click()`);
  await sleep(600);
  // find a TX senate REP row's share bar (Cornyn ★ + Paxton ★)
  out.singleList = await ev(`(() => {
    const rows=[...document.querySelectorAll('.cart-listslot [class*="flex items-center"]')];
    // simpler: scan all share-bar segments text for Cornyn/Paxton ★
    const segs=[...document.querySelectorAll('.cart-listslot span[title]')].map(s=>s.textContent.trim()).filter(t=>/Cornyn|Paxton/.test(t));
    const stars = segs.filter(t=>t.includes('★'));
    return { found: segs.slice(0,4), starCount: stars.length };
  })()`);
  // primaries map colors + ●N (switch back to MAP)
  await ev(`[...document.querySelectorAll('.cart-viewtoggle-btn')].find(b=>b.textContent.trim()==='MAP')?.click()`);
  await sleep(600);
  out.primMap = await ev(`(() => {
    const fills=[...new Set([...document.querySelectorAll('.us-map-state')].map(p=>p.getAttribute('fill')))];
    const dotLabels=[...document.querySelectorAll('.us-map-label,.us-map-leaderlabel')].filter(t=>t.textContent.includes('●')).map(t=>t.textContent.trim());
    const legend=document.querySelector('.cart-legend')?.innerText.replace(/\\n/g,' ');
    const scrubber=!!document.querySelector('.prim-scrubber');
    return { fills, dotLabelSample: dotLabels.slice(0,6), legend, scrubber };
  })()`);
  // scrubber dims: click JUN, check some states got opacity
  await ev(`[...document.querySelectorAll('.prim-scrub-seg')].find(b=>b.textContent.trim()==='JUN')?.click()`);
  await sleep(400);
  out.scrubberDim = await ev(`[...document.querySelectorAll('.us-map svg > g')].filter(g=>g.getAttribute('opacity')==='0.28').length`);
  ws.close();
}

// ── D: modal card states ──────────────────────────────────────────────────
async function modalCard(stateName, chipLabel, shot) {
  const { ws, send, ev } = await mk("http://localhost:3000/primaries");
  await send("Page.navigate", { url: "http://localhost:3000/primaries" }); await sleep(3500);
  await ev(`document.querySelector('path[aria-label="${stateName}"]')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await sleep(900);
  await ev(`[...document.querySelectorAll('.rdm-chip')].find(x=>x.textContent.trim()==='${chipLabel}')?.click()`);
  await sleep(500);
  const card = await ev(`(() => {
    const c=document.querySelector('.pdc'); if(!c) return null;
    return { head: c.querySelector('.pdc-head')?.innerText, cols: c.querySelector('.pdc-cols')?.getAttribute('data-cols'),
      columns: [...c.querySelectorAll('.pdc-col')].map(col => ({
        head: col.querySelector('.pdc-col-head')?.innerText,
        bar: col.querySelector('.pdc-barwrap')?.innerText.replace(/\\s+/g,' ').trim() || null,
        sched: col.querySelector('.pdc-sched')?.innerText || null,
        roster: [...col.querySelectorAll('.pdc-cand')].map(x=>x.innerText.replace(/\\s+/g,' ').trim()).slice(0,3),
        footer: col.querySelector('.pdc-col-footer')?.innerText,
        footerState: col.querySelector('.pdc-col-footer')?.getAttribute('data-state'),
      })) };
  })()`);
  if (shot) { const s=await send("Page.captureScreenshot",{format:"png"}); writeFileSync(`scripts/diagnostic/${shot}`, Buffer.from(s.data,"base64")); }
  ws.close();
  return card;
}
out.txSen = await modalCard("Texas", "TX SEN", "prim-226-txsen.png"); // headline: D decided | R runoff ★★
out.njDecided = await modalCard("New Jersey", "NJ-02", null);
out.alTwoCol = await modalCard("Alabama", "AL-01", null);
out.okNotYet = await modalCard("Oklahoma", "OK-01", null);

console.log(JSON.stringify(out, null, 2));
process.exit(0);
