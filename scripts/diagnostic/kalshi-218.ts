// HO 218 Phase 1 — Kalshi per-seat cross-join + shape confirm. Read-only.
// Pulls the live 137 rated seats from getRacesIndex's query, scans the Kalshi
// open-events feed (nested markets, throttled), parses House/Senate -26 markets,
// and cross-joins. Reports coverage, unmapped seats, parse oddballs, the
// name-vs-party label split, and one raw market dump.
// Run: `npx tsx scripts/diagnostic/kalshi-218.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";

const BASE = "https://external-api.kalshi.com/trade-api/v2";

type KMarket = {
  ticker: string;
  last_price_dollars?: string | null;
  yes_sub_title?: string | null;
  no_sub_title?: string | null;
  open_interest_fp?: string | number | null;
  close_time?: string | null;
  status?: string | null;
};
type KEvent = { event_ticker: string; title?: string; markets?: KMarket[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url: string): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(6000);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`429 exhausted: ${url}`);
}

// favorite = nested market with the highest implied prob
function favorite(ev: KEvent): {
  pct: number;
  label: string;
  isParty: boolean;
  oi: number;
  close: string | null;
  status: string | null;
  raw: KMarket;
} | null {
  const ms = (ev.markets ?? []).filter(
    (m) => m.last_price_dollars != null && m.last_price_dollars !== "",
  );
  if (ms.length === 0) return null;
  let best = ms[0]!;
  let bestP = parseFloat(best.last_price_dollars as string);
  for (const m of ms) {
    const p = parseFloat(m.last_price_dollars as string);
    if (p > bestP) {
      best = m;
      bestP = p;
    }
  }
  const label = (best.yes_sub_title || best.no_sub_title || "").trim();
  const isParty = /party$|^(democrat|republican|democratic|gop)$/i.test(label);
  return {
    pct: Math.round(bestP * 100),
    label,
    isParty,
    oi: Math.round(Number(best.open_interest_fp ?? 0)),
    close: best.close_time ?? null,
    status: best.status ?? null,
    raw: best,
  };
}

const houseRace = (st: string, ddRaw: string) => {
  const dd = ddRaw === "AL" ? "AL" : String(parseInt(ddRaw, 10)).padStart(2, "0");
  return { raceId: `${st}-${dd}-2026`, chamber: "house" as const };
};

// Kalshi event_ticker -> our raceId, or null. Tries ALL observed House/Senate
// general-seat schemes (Phase 1 discovered the competitive seats are scattered
// across multiple ticker namespaces, not just KXHOUSERACE).
function tickerToRaceId(et: string): { raceId: string; chamber: "house" | "senate" } | null {
  let m: RegExpMatchArray | null;
  // ── House schemes ──
  if ((m = et.match(/^KXHOUSERACE-([A-Z]{2})(\d{1,2}|AL)-26$/))) return houseRace(m[1]!, m[2]!);
  if ((m = et.match(/^HOUSEPARTY-?([A-Z]{2})(\d{1,2}|AL)-26$/))) return houseRace(m[1]!, m[2]!);
  if ((m = et.match(/^KXHOUSE([A-Z]{2})(\d{1,2}|AL)-26$/))) return houseRace(m[1]!, m[2]!);
  if ((m = et.match(/^HOUSE([A-Z]{2})(\d{1,2}|AL)-26$/))) return houseRace(m[1]!, m[2]!);
  // ── Senate schemes ── specials first (FL/OH carry an S suffix)
  if ((m = et.match(/^(?:KX)?SENATE(FL|OH)S-26$/))) return { raceId: `S-${m[1]}-2026`, chamber: "senate" };
  if ((m = et.match(/^(?:KX)?SENATE([A-Z]{2})-26(?:NOV)?$/))) return { raceId: `S-${m[1]}-2026`, chamber: "senate" };
  return null;
}

async function main() {
  // ── 1. The live 137 rated seats (exactly getRacesIndex's set) ──
  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT r.id AS race_id, r.chamber, r.state, r.district
          FROM races r
          INNER JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = r.cycle
          WHERE r.cycle = 2026
          GROUP BY r.id`,
    args: [],
  });
  const seats = rs.rows.map((r) => ({
    raceId: r.race_id as string,
    chamber: r.chamber as string,
    state: r.state as string,
    district: r.district as number | null,
  }));
  const seatIds = new Set(seats.map((s) => s.raceId));
  const senateSeats = seats.filter((s) => s.chamber === "senate");
  const houseSeats = seats.filter((s) => s.chamber === "house");
  console.log(
    `Rated seats (getRacesIndex 2026): ${seats.length} (${senateSeats.length} senate, ${houseSeats.length} house)`,
  );

  // ── 2. Scan the open-events feed (nested markets, throttled) ──
  const kByRace = new Map<string, ReturnType<typeof favorite> & { et: string }>();
  const parseFails: string[] = [];
  let cursor = "";
  let pages = 0;
  let congEvents = 0;
  while (pages < 60) {
    const url = `${BASE}/events?status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${cursor}` : ""}`;
    const d = await getJSON(url);
    const evs: KEvent[] = d.events ?? [];
    pages++;
    for (const ev of evs) {
      const et = ev.event_ticker || "";
      const U = et.toUpperCase();
      // congressional House/Senate seat namespaces, -26 only
      if (!/^(KX)?(HOUSE|SENATE)/.test(U)) continue;
      if (!/-26($|[^0-9])/.test(et)) continue; // -26 only (drop -2028, no-year)
      // drop non-general / non-seat markets in the same namespace
      if (
        /POPVOTE|MARGIN|EXPEL|DEMLEAD|MINORITY|MAJORITY|SEATS|CONTROL|ADVANCE|PRIMARY|NOMIN|BALANCE|GOP|MOV|COMBO|SWEEP|LEAVE|SPEAKER|CHAIR|DELEGATE|STATE|DEM$|HOUSEDEM|HOUSERACE-26$|SENATERUN/.test(
          U,
        )
      )
        continue;
      congEvents++;
      const map = tickerToRaceId(et);
      if (!map) {
        parseFails.push(et);
        continue;
      }
      const fav = favorite(ev);
      if (!fav) continue;
      // keep the highest-OI market if duplicate tickers map to one race
      const prev = kByRace.get(map.raceId);
      if (!prev || fav.oi > prev.oi) kByRace.set(map.raceId, { ...fav, et });
    }
    cursor = d.cursor || "";
    if (!cursor) break;
    await sleep(1200);
  }
  console.log(
    `Feed scan: ${pages} pages, ${congEvents} congressional-seat -26 events, ${kByRace.size} distinct races priced, ${parseFails.length} parse-fails`,
  );

  // ── 3. Cross-join 137 seats <-> Kalshi ──
  const matched: typeof seats = [];
  const unmapped: typeof seats = [];
  for (const s of seats) {
    if (kByRace.has(s.raceId)) matched.push(s);
    else unmapped.push(s);
  }
  console.log(
    `\n=== COVERAGE: ${matched.length}/${seats.length} rated seats have a live Kalshi market ===`,
  );
  console.log(
    `  Senate: ${matched.filter((s) => s.chamber === "senate").length}/${senateSeats.length}` +
      ` · House: ${matched.filter((s) => s.chamber === "house").length}/${houseSeats.length}`,
  );

  console.log(`\n--- UNMAPPED rated seats (${unmapped.length}) — null-safe placeholder rows ---`);
  for (const s of unmapped.sort((a, b) => a.raceId.localeCompare(b.raceId)))
    console.log(`  ${s.raceId}`);

  // Kalshi-priced races that aren't in our rated set (informational)
  const extra = [...kByRace.keys()].filter((id) => !seatIds.has(id));
  console.log(
    `\n--- Kalshi-priced -26 races NOT in our rated set: ${extra.length} (info only; not enrichable) ---`,
  );
  console.log("  " + extra.sort().slice(0, 60).join(", ") + (extra.length > 60 ? " …" : ""));

  console.log(`\n--- PARSE FAILURES (ticker didn't match the scheme) ${parseFails.length} ---`);
  for (const t of [...new Set(parseFails)].sort()) console.log(`  ${t}`);

  // ── 4. name-vs-party label split in the MATCHED set ──
  let nameN = 0;
  let partyN = 0;
  const sampleName: string[] = [];
  const sampleParty: string[] = [];
  for (const s of matched) {
    const k = kByRace.get(s.raceId)!;
    if (k.isParty) {
      partyN++;
      if (sampleParty.length < 6) sampleParty.push(`${s.raceId}:${k.label} ${k.pct}%`);
    } else {
      nameN++;
      if (sampleName.length < 6) sampleName.push(`${s.raceId}:${k.label} ${k.pct}%`);
    }
  }
  console.log(`\n=== yes_sub_title split (matched set, ${matched.length}) ===`);
  console.log(`  candidate NAME: ${nameN}  | bare PARTY: ${partyN}`);
  console.log(`  name samples : ${sampleName.join(" · ")}`);
  console.log(`  party samples: ${sampleParty.join(" · ")}`);

  // closed/stale check
  const now = new Date().toISOString();
  const closed = matched.filter((s) => {
    const k = kByRace.get(s.raceId)!;
    return (k.close && k.close < now) || (k.status && k.status !== "active" && k.status !== "open");
  });
  console.log(
    `\n  matched markets already closed/non-active (must render nothing): ${closed.length}` +
      (closed.length ? " -> " + closed.map((s) => s.raceId).join(", ") : ""),
  );

  // ── 5. raw dump of one matched market ──
  const sampleSeat = matched.find((s) => !kByRace.get(s.raceId)!.isParty) ?? matched[0];
  if (sampleSeat) {
    const k = kByRace.get(sampleSeat.raceId)!;
    console.log(`\n=== RAW matched market for ${sampleSeat.raceId} (event ${k.et}) ===`);
    console.log(JSON.stringify(k.raw, null, 1));
  }
}

main().then(() => process.exit(0));
