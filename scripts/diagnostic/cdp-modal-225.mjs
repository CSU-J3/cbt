// HO 225 verification (scratch): drive the /races district modal through all
// three card cases + pick-chip↔map + hover-popover-survives. Node global WS/fetch.
import { writeFileSync } from "node:fs";
const BASE = "http://localhost:9224";
const URL = "http://localhost:3000/races";
const tab = await (await fetch(`${BASE}/json/new?${encodeURIComponent(URL)}`, { method: "PUT" }))
  .json().catch(async () => (await fetch(`${BASE}/json/new?${encodeURIComponent(URL)}`)).json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0; const p = new Map();
const send = (m, pr = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: pr })); });
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r?.result?.value; };

await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: URL }); await sleep(4000);

// helpers injected into the page
const HELPERS = `
window.__clickState = (name) => { const el = document.querySelector('path[aria-label="'+name+'"]'); if(!el) return 'no path '+name; el.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 'clicked '+name; };
window.__clickChip = (label) => { const b=[...document.querySelectorAll('.rdm-chip')].find(x=>x.textContent.trim()===label); if(!b) return 'no chip '+label; b.click(); return 'chip '+label; };
window.__readModal = () => { const pnl=document.querySelector('.rdm-panel'); if(!pnl) return null; return { title: pnl.querySelector('.rdm-title')?.innerText, sub: pnl.querySelector('.rdm-sub')?.innerText, chips: [...pnl.querySelectorAll('.rdm-chip')].map(c=>c.textContent.trim()), districtPaths: pnl.querySelectorAll('.rdm-map path').length }; };
window.__readCard = () => { const c=document.querySelector('.rdc'); if(!c) return null; return { role: c.querySelector('.rdc-role')?.innerText||null, name: c.querySelector('.rdc-name')?.innerText||null, meta: c.querySelector('.rdc-meta')?.innerText||null, bio: c.querySelector('.rdc-bio')?.innerText||null, stats: [...c.querySelectorAll('.rdc-stat')].map(s=>s.innerText.replace(/\\n/g,'=')), noopp: !!c.querySelector('.rdc-noopp'), challengers: [...c.querySelectorAll('.rdc-chal')].map(x=>x.innerText.replace(/\\s+/g,' ').trim()), openHead: c.querySelector('.rdc-open-head')?.innerText||null, openExplain: c.querySelector('.rdc-open-explain')?.innerText||null }; };
window.__close = () => { const b=document.querySelector('.rdm-close'); if(b){b.click(); return 'closed';} return 'noclose'; };
window.__exportEnabled = () => { const b=[...document.querySelectorAll('.rdm-action')].find(x=>x.textContent.includes('EXPORT')); return b ? !b.disabled : null; };
window.__hoverPeek = () => { const el=document.querySelector('path[aria-label="Texas"]'); if(!el) return 'no tx'; el.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true})); return 'hovered'; };
true;
`;
await ev(HELPERS);

const out = {};

// CASE 1 — CA-22 (no challenger)
await ev(`window.__clickState('California')`); await sleep(900);
out.ca_modal = await ev(`window.__readModal()`);
await ev(`window.__clickChip('CA-22')`); await sleep(500);
out.ca22_card = await ev(`window.__readCard()`);
out.ca22_exportEnabled = await ev(`window.__exportEnabled()`);
// screenshot the CA modal with CA-22 selected
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("scripts/diagnostic/modal-225.png", Buffer.from(shot.data, "base64"));
await ev(`window.__close()`); await sleep(400);

// CASE 2 harvested — TX-35
await ev(`window.__clickState('Texas')`); await sleep(900);
await ev(`window.__clickChip('TX-35')`); await sleep(500);
out.tx35_card = await ev(`window.__readCard()`);
await ev(`window.__close()`); await sleep(400);

// CASE 2 hand-seeded — NJ-07
await ev(`window.__clickState('New Jersey')`); await sleep(900);
out.nj_modal_chips = (await ev(`window.__readModal()`))?.chips;
await ev(`window.__clickChip('NJ-07')`); await sleep(500);
out.nj07_card = await ev(`window.__readCard()`);
await ev(`window.__close()`); await sleep(400);

// CASE 3 open — KY-06
await ev(`window.__clickState('Kentucky')`); await sleep(900);
await ev(`window.__clickChip('KY-06')`); await sleep(500);
out.ky06_card = await ev(`window.__readCard()`);
await ev(`window.__close()`); await sleep(400);

// hover popover survives (national map)
out.hoverPeek = await ev(`window.__hoverPeek()`); await sleep(400);
out.peekVisible = await ev(`!!document.querySelector('.us-map-peek')`);

console.log(JSON.stringify(out, null, 2));
ws.close(); process.exit(0);
