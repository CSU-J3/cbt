// HO 394 — maps an ingested news article to one watchcore Observation and
// stores it (plus its flattened entities). This is the ADDITIVE dual-write; the
// existing news_mentions write stays untouched in lib/news-ingest.ts.
//
// The deterministic entity resolver is the precision gate: the LLM proposes raw
// people/org NAMES (it can't know bioguide_ids), and this code resolves them to
// canonical ids against the members/committees tables — precision over recall, a
// wrong id poisons the member→news / race→news joins. Unresolvable/ambiguous
// mentions are KEPT (value=null) so they stay auditable and the drop-rate is
// measurable. observations.entities (JSON) and observation_entities (table) are
// both produced from this ONE resolved pass, so they can't drift.
import { CAUCUS_CONFIG } from "./caucus-config";
import { getDb } from "./db";
import type { ExtractedNames } from "./news-matcher";
import {
  type Observation,
  type ObsEntity,
  type ObsSource,
  makeContentHash,
  makeObsId,
  makeObservation,
  normText,
  validateObservation,
} from "./observation";
import type { NewsSource } from "./news-sources";
import type { RssItem } from "./rss-parse";

type Db = ReturnType<typeof getDb>;

type MemberLite = { bioguide: string; firstNorm: string; lastNorm: string };
type CommitteeLite = {
  systemCode: string;
  chamber: string; // 'house' | 'senate' | 'joint'
  isParent: boolean;
  nameTokens: Set<string>;
};

export type EntityLookups = {
  membersBySurname: Map<string, MemberLite[]>;
  committees: CommitteeLite[];
  caucusByNorm: Map<string, string>; // normalized caucus fullName → slug
};

// Honorifics + suffixes stripped from a proposed person name before matching.
const HONORIFICS = new Set([
  "sen", "senator", "rep", "representative", "congressman", "congresswoman",
  "dr", "mr", "mrs", "ms", "hon", "the",
]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
// Non-distinctive tokens dropped when comparing committee names.
const COMMITTEE_STOP = new Set([
  "committee", "subcommittee", "select", "joint", "permanent", "special",
  "on", "of", "the", "and", "for", "to", "a", "an", "us", "u", "s",
  "house", "senate", "congressional", "congress", "panel",
]);

function tokenizeName(raw: string): string[] {
  return normText(raw)
    .split(" ")
    .filter((t) => t && !HONORIFICS.has(t) && !SUFFIXES.has(t));
}

export async function loadEntityLookups(db: Db): Promise<EntityLookups> {
  const membersBySurname = new Map<string, MemberLite[]>();
  const mres = await db.execute(
    "SELECT bioguide_id, first_name, last_name FROM members WHERE is_current = 1",
  );
  for (const r of mres.rows) {
    const last = normText((r.last_name as string | null) ?? "");
    if (!last) continue;
    const lite: MemberLite = {
      bioguide: r.bioguide_id as string,
      firstNorm: normText((r.first_name as string | null) ?? ""),
      lastNorm: last,
    };
    const arr = membersBySurname.get(last);
    if (arr) arr.push(lite);
    else membersBySurname.set(last, [lite]);
  }

  const committees: CommitteeLite[] = [];
  const cres = await db.execute(
    "SELECT system_code, name, chamber, parent_system_code FROM committees WHERE is_current = 1",
  );
  for (const r of cres.rows) {
    const tokens = new Set(
      normText((r.name as string | null) ?? "")
        .split(" ")
        .filter((t) => t && !COMMITTEE_STOP.has(t)),
    );
    if (tokens.size === 0) continue;
    committees.push({
      systemCode: r.system_code as string,
      chamber: ((r.chamber as string | null) ?? "").toLowerCase(),
      isParent: (r.parent_system_code as string | null) == null,
      nameTokens: tokens,
    });
  }

  // Only the 4 config caucuses are joinable (decision 2 — no alias map); any
  // other caucus mention (CBC, etc.) resolves to an org with a null value.
  const caucusByNorm = new Map<string, string>();
  for (const [slug, info] of Object.entries(CAUCUS_CONFIG)) {
    caucusByNorm.set(normText(info.fullName), slug);
  }

  return { membersBySurname, committees, caucusByNorm };
}

// Resolve a proposed person name → bioguide_id, or null (dropped/ambiguous).
// Precision rules: a single-token surname resolves only when unique among
// current members; a multi-token name requires the FIRST name to be consistent
// with the member (exact, nickname prefix, or shared initial) — so a non-member
// who merely shares a surname ("Leon Black") is NOT mis-tagged onto a real member.
export function resolvePerson(raw: string, L: EntityLookups): string | null {
  const tokens = tokenizeName(raw);
  if (tokens.length === 0) return null;
  const last = tokens[tokens.length - 1]!;
  const first = tokens.length >= 2 ? tokens[0]! : null;
  const cands = L.membersBySurname.get(last);
  if (!cands || cands.length === 0) return null;
  if (first === null) return cands.length === 1 ? cands[0]!.bioguide : null;

  const exact = cands.filter((c) => c.firstNorm === first);
  if (exact.length === 1) return exact[0]!.bioguide;
  if (exact.length > 1) return null;
  const nick = cands.filter(
    (c) =>
      c.firstNorm &&
      (c.firstNorm.startsWith(first) ||
        first.startsWith(c.firstNorm) ||
        c.firstNorm[0] === first[0]),
  );
  return nick.length === 1 ? nick[0]!.bioguide : null;
}

// Resolve a proposed committee name → system_code, or null. All distinctive
// tokens of the mention must appear in the committee's name; a parent (standing)
// committee is preferred over its subcommittees, and the match must be unique.
export function resolveCommittee(raw: string, L: EntityLookups): string | null {
  const norm = normText(raw);
  let chamber: string | null = null;
  if (/\bhouse\b/.test(norm)) chamber = "house";
  else if (/\bsenate\b/.test(norm)) chamber = "senate";
  const tokens = norm.split(" ").filter((t) => t && !COMMITTEE_STOP.has(t));
  if (tokens.length === 0) return null;

  const matches = L.committees.filter((c) => {
    if (chamber && c.chamber !== chamber && c.chamber !== "joint") return false;
    return tokens.every((t) => c.nameTokens.has(t));
  });
  if (matches.length === 0) return null;
  const parents = matches.filter((m) => m.isParent);
  if (parents.length === 1) return parents[0]!.systemCode;
  if (parents.length === 0 && matches.length === 1) return matches[0]!.systemCode;
  return null; // ambiguous → drop (precision over recall)
}

function resolveOrgEntity(raw: string, L: EntityLookups): ObsEntity {
  const norm = normText(raw);
  const looksCaucus = /\bcaucus\b|\bcoalition\b/.test(norm);
  if (looksCaucus) {
    let slug: string | null = null;
    for (const [cnorm, s] of L.caucusByNorm) {
      if (norm === cnorm || norm.includes(cnorm) || cnorm.includes(norm)) {
        slug = s;
        break;
      }
    }
    return { type: "org", name: raw, value: slug, role: null };
  }
  return { type: "committee", name: raw, value: resolveCommittee(raw, L), role: null };
}

// The single resolved pass. Bill ids arrive already validated (regex / candidate
// match) — kept as-is. People/orgs are resolved; unresolved kept with value=null.
export function resolveEntities(
  billIds: string[],
  names: ExtractedNames,
  L: EntityLookups,
): ObsEntity[] {
  const out: ObsEntity[] = [];
  for (const id of billIds) {
    out.push({ type: "bill", name: id, value: id, role: "subject" });
  }
  for (const p of names.people) {
    out.push({ type: "person", name: p, value: resolvePerson(p, L), role: null });
  }
  for (const o of names.orgs) {
    out.push(resolveOrgEntity(o, L));
  }
  return out;
}

function articleToObservation(
  item: RssItem,
  source: NewsSource,
  entities: ObsEntity[],
  ingestedAt: string,
  tags: string[],
): Observation | null {
  const collector = `news_${source.slug}`;
  const src: ObsSource = {
    collector,
    source_type: "rss",
    publisher: source.display,
    url: item.url,
    native_id: item.nativeId,
  };
  const obsId = makeObsId({
    collector,
    nativeId: item.nativeId,
    url: item.url,
    title: item.title,
    observedAt: item.publishedAt,
  });
  const contentHash = makeContentHash(item.title, item.summary);
  const obs = makeObservation({
    obs_id: obsId,
    source: src,
    fetched_at: ingestedAt,
    observed_at: item.publishedAt, // already UTC ISO via rss-parse.toIso()
    obs_type: "news",
    title: item.title,
    reliability: source.reliability,
    credibility: source.credibility,
    // Best-available source payload (the parser doesn't retain raw XML). Written
    // once, never mutated.
    raw: {
      title: item.title,
      url: item.url,
      summary: item.summary,
      publishedAt: item.publishedAt,
      nativeId: item.nativeId,
      source: source.slug,
    },
    summary: item.summary,
    entities,
    tags: tags.length ? tags : undefined,
    content_hash: contentHash,
    cluster_id: contentHash, // stage-one: equal content_hash → shared cluster
    first_seen: ingestedAt,
    last_seen: ingestedAt,
  });
  const v = validateObservation(obs);
  if (!v.ok) {
    console.warn(`[obs] invalid, skipped ${obsId}: ${v.hardErrors.join("; ")}`);
    return null;
  }
  if (v.softFlags.length > 0) {
    // Flag, don't silently store (schema invariant #3).
    console.warn(`[obs] flag ${obsId}: ${v.softFlags.join("; ")}`);
    obs.tags = [...(obs.tags ?? []), "ts_violation"];
  }
  return obs;
}

async function storeObservation(
  db: Db,
  obs: Observation,
): Promise<"inserted" | "updated"> {
  const existing = await db.execute({
    sql: "SELECT 1 FROM observations WHERE obs_id = ? LIMIT 1",
    args: [obs.obs_id],
  });
  if (existing.rows.length > 0) {
    // Re-ingest of the same item: bump last_seen only. raw / first_seen /
    // entities are written once (schema invariant #2).
    await db.execute({
      sql: "UPDATE observations SET last_seen = ? WHERE obs_id = ?",
      args: [obs.fetched_at, obs.obs_id],
    });
    return "updated";
  }
  await db.execute({
    sql: `INSERT INTO observations (
            obs_id, schema_version, source, fetched_at, observed_at, obs_type,
            title, reliability, credibility, raw, summary, entities, geo, tags,
            valid_from, valid_to, confidence, content_hash, cluster_id,
            first_seen, last_seen, supersedes)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      obs.obs_id,
      obs.schema_version,
      JSON.stringify(obs.source),
      obs.fetched_at,
      obs.observed_at,
      obs.obs_type,
      obs.title,
      obs.reliability,
      obs.credibility,
      JSON.stringify(obs.raw),
      obs.summary ?? null,
      JSON.stringify(obs.entities ?? []),
      obs.geo ? JSON.stringify(obs.geo) : null,
      obs.tags ? JSON.stringify(obs.tags) : null,
      obs.valid_from ?? null,
      obs.valid_to ?? null,
      obs.confidence ?? null,
      obs.content_hash ?? null,
      obs.cluster_id ?? null,
      obs.first_seen ?? null,
      obs.last_seen ?? null,
      obs.supersedes ?? null,
    ],
  });
  // Flattened entities: delete-then-insert per obs_id (idempotent). Fresh insert
  // here, but the delete keeps a future re-extraction from duplicating rows.
  await db.execute({
    sql: "DELETE FROM observation_entities WHERE obs_id = ?",
    args: [obs.obs_id],
  });
  for (const e of obs.entities ?? []) {
    await db.execute({
      sql: `INSERT INTO observation_entities (obs_id, entity_type, entity_value, entity_name, role)
            VALUES (?,?,?,?,?)`,
      args: [obs.obs_id, e.type, e.value ?? null, e.name, e.role ?? null],
    });
  }
  return "inserted";
}

export type DualWriteResult = { stored: "inserted" | "updated" | "skipped" };

// The one entrypoint the ingest loop calls per article. Resolves entities,
// builds + validates the Observation, and stores it. Throws are the caller's to
// catch (the dual-write must never break the news cron — Gate C).
export async function dualWriteObservation(
  db: Db,
  item: RssItem,
  source: NewsSource,
  billIds: string[],
  extracted: ExtractedNames,
  lookups: EntityLookups,
  ingestedAt: string,
  tags: string[],
): Promise<DualWriteResult> {
  const entities = resolveEntities(billIds, extracted, lookups);
  const obs = articleToObservation(item, source, entities, ingestedAt, tags);
  if (!obs) return { stored: "skipped" };
  const stored = await storeObservation(db, obs);
  return { stored };
}
