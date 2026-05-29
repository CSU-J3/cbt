// HO 153 — derive a 1-2-line lead excerpt from a report's content_md at
// read time. Mirrors `reportSnippet` in lib/queries.ts (markdown noise
// stripped, whitespace collapsed) but anchored on the report's structural
// shape (HO 110): `# Title` → blank → lead paragraph → blank → first
// `## Section` heading. Returns the first prose paragraph before any
// `##` heading, truncated to ~180 chars. Empty string if the report has
// no body or no prose between the H1 and the first section.

const MAX_LEAD_CHARS = 180;

function stripMarkdownNoise(s: string): string {
  return s
    .replace(/^\s*[*+-]\s+/, "") // leading bullet
    .replace(/[#*_`]+/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // markdown link → label
    .replace(/\s+/g, " ")
    .trim();
}

export function extractReportLead(contentMd: string | null | undefined): string {
  if (!contentMd) return "";
  const lines = contentMd.split(/\r?\n/);
  const paragraphs: string[] = [];
  let buf: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    // First `##` (or deeper) heading ends the lead window — anything past
    // it is structured section content the snapshot shouldn't surface.
    if (/^##+\s/.test(line)) {
      if (buf.length > 0) paragraphs.push(buf.join(" "));
      break;
    }
    // The `#` title line is skipped (the snapshot displays the date and a
    // "Weekly Report" label separately).
    if (/^#\s/.test(line)) {
      if (buf.length > 0) {
        paragraphs.push(buf.join(" "));
        buf = [];
      }
      continue;
    }
    if (line.length === 0) {
      if (buf.length > 0) {
        paragraphs.push(buf.join(" "));
        buf = [];
      }
      continue;
    }
    buf.push(line);
  }
  if (buf.length > 0) paragraphs.push(buf.join(" "));

  for (const p of paragraphs) {
    const cleaned = stripMarkdownNoise(p);
    if (cleaned.length === 0) continue;
    if (cleaned.length <= MAX_LEAD_CHARS) return cleaned;
    return cleaned.slice(0, MAX_LEAD_CHARS).replace(/\s+\S*$/, "") + "…";
  }
  return "";
}
