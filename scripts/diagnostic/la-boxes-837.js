// HO 837: the Louisiana hand route. Run in the Claude desktop app's built-in browser,
// on a ballotpedia.org tab, through the browser's javascript tool: same-origin GETs of
// six public pages in the browser's own session, read-only. It returns each seat's 2026
// boxes (the Dec 12 general and the Nov 3 jungle), outermost box elements only, with
// whitespace collapsed. Paste the JSON into the record with its `read` times.
const out = {};
for (const d of [1, 2, 3, 4, 5, 6]) {
  const sfx = { 1: "st", 2: "nd", 3: "rd" }[d] || "th";
  const url = `https://ballotpedia.org/Louisiana%27s_${d}${sfx}_Congressional_District_election,_2026`;
  const r = await fetch(url, { credentials: "include" });
  const html = await r.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const all = [...doc.querySelectorAll(".results_table_container, .votebox")];
  const top = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
  const boxes = top
    .map((b) => b.innerText.replace(/\s+/g, " ").trim().replace(/ = candidate completed.*$/, ""))
    .filter((t) => /, 2026\./.test(t));
  out[`LA-${String(d).padStart(2, "0")}`] = { status: r.status, bytes: html.length, read: new Date().toISOString(), boxes };
}
out;
