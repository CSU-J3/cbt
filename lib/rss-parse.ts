// Minimal RSS 2.0 + Atom parser (handoff 64). Normalizes both shapes into
// a common { title, url, summary, publishedAt } record. Permissive on
// missing fields — items missing a title or url are dropped silently
// because there's nothing useful to write to the DB. HTML is stripped
// from summaries because the matcher only needs plain text.
import { XMLParser } from "fast-xml-parser";

export interface RssItem {
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string; // ISO 8601
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "_text",
  // Some publishers wrap fields like `<title>` and `<description>` in
  // CDATA. Parsing CDATA inline (not as a separate node) keeps the result
  // shape uniform across feeds.
  parseTagValue: true,
  trimValues: true,
});

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "object") {
    // fast-xml-parser may yield { _text: "...", ...attrs } for elements
    // that mix text and attributes.
    const o = value as Record<string, unknown>;
    if (typeof o._text === "string") return o._text;
    if (typeof o["#text"] === "string") return o["#text"] as string;
  }
  return "";
}

function stripHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function toIso(date: string | undefined | null): string {
  if (!date) return new Date().toISOString();
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

// Atom link can be a single element with attributes, or an array of them.
// "alternate" rel is the canonical article URL; first link is the
// fallback for feeds that don't bother labeling rel.
function pickAtomLink(link: unknown): string {
  if (!link) return "";
  if (typeof link === "string") return link;
  if (Array.isArray(link)) {
    const alt = link.find(
      (l): l is Record<string, unknown> =>
        typeof l === "object" &&
        l !== null &&
        (("rel" in l && (l as Record<string, unknown>).rel === "alternate") ||
          !("rel" in l)),
    );
    const first = link[0];
    const target = alt ?? (typeof first === "object" ? first : null);
    if (target && typeof target === "object") {
      const href = (target as Record<string, unknown>).href;
      return typeof href === "string" ? href : "";
    }
    return "";
  }
  if (typeof link === "object") {
    const href = (link as Record<string, unknown>).href;
    return typeof href === "string" ? href : "";
  }
  return "";
}

function parseRss2Items(parsed: Record<string, unknown>): RssItem[] {
  const rss = parsed.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  const item = channel?.item;
  if (!item) return [];
  const arr = Array.isArray(item) ? item : [item];
  const items: RssItem[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const title = asText(r.title);
    const url = asText(r.link);
    if (!title || !url) continue;
    const descRaw = asText(r.description);
    const summary = descRaw ? stripHtml(descRaw) : null;
    items.push({
      title: stripHtml(title),
      url,
      summary,
      publishedAt: toIso(asText(r.pubDate) || asText(r.date)),
    });
  }
  return items;
}

function parseAtomItems(parsed: Record<string, unknown>): RssItem[] {
  const feed = parsed.feed as Record<string, unknown> | undefined;
  const entry = feed?.entry;
  if (!entry) return [];
  const arr = Array.isArray(entry) ? entry : [entry];
  const items: RssItem[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const title = asText(e.title);
    const url = pickAtomLink(e.link);
    if (!title || !url) continue;
    const summary = asText(e.summary) || asText(e.content) || "";
    items.push({
      title: stripHtml(title),
      url,
      summary: summary ? stripHtml(summary) : null,
      publishedAt: toIso(asText(e.published) || asText(e.updated)),
    });
  }
  return items;
}

export async function fetchAndParseRss(
  url: string,
  timeoutMs = 10_000,
): Promise<RssItem[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let body: string;
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent": "CBT-news-ingest/0.1 (+https://github.com/mehidk69/cbt)",
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    body = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const parsed = parser.parse(body) as Record<string, unknown>;
  const rss2 = parseRss2Items(parsed);
  if (rss2.length > 0) return rss2;
  return parseAtomItems(parsed);
}
