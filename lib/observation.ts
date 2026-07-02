// HO 394 — the watchcore `Observation` contract, ported to TypeScript.
//
// This is a faithful port of watchcore/observation.py's shape + invariants, NOT
// an import of the Python runtime. We hand-roll the constructor/validator (no
// zod — noted as a possible later upgrade if we formalize). The naval-domain
// enums (obs_type, entity_type) are replaced with CBT's vocab; the schema doc
// calls those "controlled vocab, extensible", so this stays contract-compatible
// while the required fields, sub-objects, grade, hashing, and invariants match
// watchcore exactly.
//
// Reserved-but-unused for the news pilot (kept optional so the shape doesn't
// drift): geo, tags(see below), valid_from, valid_to, confidence. `tags` IS used
// — it carries HO 394's `no_llm_call` markers for the coverage diagnostic (the
// schema doc's intended use: "free-form labels for project-specific filtering").
import { createHash } from "node:crypto";

export const OBS_SCHEMA_VERSION = 1;

export type SourceType = "rss" | "api" | "ais" | "scrape" | "feed" | "manual";
// Extensible controlled vocab. The pilot only emits "news".
export type ObsType = "news";
export type Reliability = "A" | "B" | "C" | "D" | "E" | "F";
export type Credibility = 1 | 2 | 3 | 4 | 5 | 6;
export type Confidence = "high" | "moderate" | "low";
// CBT's entity vocab (HO 394 flattened set) — replaces watchcore's naval enum.
export type EntityType =
  | "bill"
  | "person"
  | "org"
  | "committee"
  | "location"
  | "other";

export interface ObsSource {
  collector: string;
  source_type: SourceType;
  publisher?: string | null;
  url?: string | null;
  native_id?: string | null;
}

export interface ObsEntity {
  type: EntityType;
  name: string; // display / raw-as-extracted name (always kept, even when unresolved)
  value?: string | null; // normalized id (bill_id / bioguide_id / system_code); null = no id / unresolved
  role?: string | null;
}

export interface ObsGeo {
  lat: number;
  lon: number;
  precision_m?: number | null;
  place_name?: string | null;
  geohash?: string | null;
}

export interface Observation {
  schema_version: number;
  obs_id: string;
  source: ObsSource;
  fetched_at: string; // UTC ISO 8601, tz-aware
  observed_at: string; // UTC ISO 8601, tz-aware — the time-series axis
  obs_type: ObsType;
  title: string;
  reliability: Reliability;
  credibility: Credibility;
  raw: unknown; // untouched source payload; written once, never mutated
  // optional
  summary?: string | null;
  entities?: ObsEntity[];
  geo?: ObsGeo | null; // reserved (no geo in news)
  tags?: string[];
  valid_from?: string | null; // reserved
  valid_to?: string | null; // reserved
  confidence?: Confidence | null; // reserved (detect-stage output, null at ingest)
  content_hash?: string | null;
  cluster_id?: string | null;
  first_seen?: string | null;
  last_seen?: string | null;
  supersedes?: string | null;
}

const RELIABILITY_SET = new Set<Reliability>(["A", "B", "C", "D", "E", "F"]);

// The full set of keys a valid Observation may carry — mirrors pydantic's
// extra="forbid". A typo'd field name raises here instead of silently writing a
// column nobody reads.
const OBSERVATION_KEYS = new Set<string>([
  "schema_version",
  "obs_id",
  "source",
  "fetched_at",
  "observed_at",
  "obs_type",
  "title",
  "reliability",
  "credibility",
  "raw",
  "summary",
  "entities",
  "geo",
  "tags",
  "valid_from",
  "valid_to",
  "confidence",
  "content_hash",
  "cluster_id",
  "first_seen",
  "last_seen",
  "supersedes",
]);

// Normalize text the same way watchcore's Observation._norm does: lowercase,
// strip anything that isn't [a-z0-9 ], collapse whitespace. Used for both the
// title-fallback id basis and the content hash.
export function normText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function blake2bHex(basis: string, digestBytes: number): string {
  // Node's OpenSSL exposes blake2b512; slice to the requested digest width. This
  // is NOT byte-identical to Python's blake2b(digest_size=N) — but the only
  // requirement is determinism WITHIN CBT (re-ingest → same id → upsert), which
  // a stable slice of a stable hash satisfies. sha256-slice is the noted fallback.
  return createHash("blake2b512").update(basis).digest("hex").slice(0, digestBytes * 2);
}

// Deterministic id. Strong case (a stable source id present): hash(collector |
// native_id) — observed_at is deliberately NOT folded in, so a re-published item
// with a corrected timestamp still upserts. Fallbacks: the canonical url, then
// (only when neither exists) the normalized title composited with observed_at.
export function makeObsId(args: {
  collector: string;
  nativeId?: string | null;
  url?: string | null;
  title?: string | null;
  observedAt: string;
}): string {
  const { collector, nativeId, url, title, observedAt } = args;
  let basis: string;
  if (nativeId) basis = `${collector}|${nativeId}`;
  else if (url) basis = `${collector}|${url}`;
  else basis = `${collector}|${normText(title ?? "")}|${observedAt}`;
  return blake2bHex(basis, 16); // 32 hex chars
}

// Stage-one near-dup key: hash of normalized title + summary. Equal hashes are
// the same item (two outlets, different wording share it) → shared cluster.
export function makeContentHash(title: string, summary?: string | null): string {
  return blake2bHex(normText(`${title} ${summary ?? ""}`), 8); // 16 hex chars
}

export function gradeCode(o: Pick<Observation, "reliability" | "credibility">): string {
  return `${o.reliability}${o.credibility}`;
}

// UTC ISO with an explicit tz marker (Z or ±HH:MM) AND a parseable instant.
function isUtcIso(s: unknown): s is string {
  if (typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s)) {
    return false;
  }
  return !Number.isNaN(Date.parse(s));
}

export type ObsValidation = {
  ok: boolean; // false → a HARD error (missing/invalid required field); do not store
  hardErrors: string[];
  softFlags: string[]; // e.g. fetched_at < observed_at — flag, don't silently drop
};

// Enforces the watchcore invariants. Required-field violations are HARD (skip
// the record). `fetched_at < observed_at` is a SOFT flag — the schema doc says
// "flagged, not silently stored", so the caller stores it (with a tag) and logs.
export function validateObservation(o: Observation): ObsValidation {
  const hardErrors: string[] = [];
  const softFlags: string[] = [];

  for (const k of Object.keys(o)) {
    if (!OBSERVATION_KEYS.has(k)) hardErrors.push(`unknown key: ${k}`);
  }
  if (o.schema_version !== OBS_SCHEMA_VERSION) {
    hardErrors.push(`schema_version must be ${OBS_SCHEMA_VERSION}`);
  }
  if (!o.obs_id) hardErrors.push("obs_id required");
  if (!o.source || !o.source.collector || !o.source.source_type) {
    hardErrors.push("source.collector + source.source_type required");
  }
  if (!o.title) hardErrors.push("title required");
  if (!RELIABILITY_SET.has(o.reliability)) {
    hardErrors.push(`reliability must be A–F (got ${String(o.reliability)})`);
  }
  if (!(Number.isInteger(o.credibility) && o.credibility >= 1 && o.credibility <= 6)) {
    hardErrors.push(`credibility must be 1–6 (got ${String(o.credibility)})`);
  }
  if (!isUtcIso(o.fetched_at)) hardErrors.push(`fetched_at not UTC ISO: ${o.fetched_at}`);
  if (!isUtcIso(o.observed_at)) hardErrors.push(`observed_at not UTC ISO: ${o.observed_at}`);
  if (isUtcIso(o.fetched_at) && isUtcIso(o.observed_at)) {
    if (Date.parse(o.fetched_at) < Date.parse(o.observed_at)) {
      softFlags.push("fetched_at < observed_at");
    }
  }
  return { ok: hardErrors.length === 0, hardErrors, softFlags };
}

// Constructor mirroring pydantic's model construction: fills schema_version,
// rejects unknown keys, returns the typed record. Takes the required fields plus
// any optionals; the core-derived fields (obs_id/content_hash/cluster_id/
// first_seen/last_seen) are set by the caller (the store path), matching the
// collector/core split.
export type MakeObservationInput = Omit<Observation, "schema_version"> &
  Partial<Pick<Observation, "schema_version">>;

export function makeObservation(input: MakeObservationInput): Observation {
  for (const k of Object.keys(input)) {
    if (!OBSERVATION_KEYS.has(k)) {
      throw new Error(`makeObservation: unknown key "${k}" (extra=forbid)`);
    }
  }
  return { schema_version: OBS_SCHEMA_VERSION, ...input };
}
