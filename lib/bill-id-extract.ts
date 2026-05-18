// Regex-based bill ID extraction from article titles + summaries (handoff
// 64). Permissive on whitespace and dots: matches "HR 1234", "H.R. 1234",
// "H. R. 1234", "hr1234", "S.Res. 5", etc. Returns canonical
// "{congress}-{type}-{number}" ids matching the bills.id format.
//
// Designed for high recall, accepting moderate false-positive rate. The
// regex is anchored on bill-type prefixes (HR, S, HRes, etc.) followed by
// 1-5 digits. Handoff 65 will measure precision against a labeled sample
// and tighten if needed (e.g., disallow comma-after-number, prefer
// adjacent "bill" / "act" / "legislation" keywords, etc.).
import { getCurrentCongress } from "./congress";

// Order matters: longer prefixes first so the regex doesn't lazily match
// "H" before trying "H.J.Res." or "HConRes". Bill type alternation is
// captured in group 1, the bill number in group 2.
const BILL_ID_REGEX =
  /\b(H\s*\.?\s*J\s*\.?\s*Res\s*\.?|H\s*\.?\s*Con\s*\.?\s*Res\s*\.?|H\s*\.?\s*Res\s*\.?|H\s*\.?\s*R\s*\.?|S\s*\.?\s*J\s*\.?\s*Res\s*\.?|S\s*\.?\s*Con\s*\.?\s*Res\s*\.?|S\s*\.?\s*Res\s*\.?|S\s*\.?)\s*(\d{1,5})\b/gi;

function normalizeType(raw: string): string | null {
  const t = raw.toLowerCase().replace(/[\s.]/g, "");
  switch (t) {
    case "hr":
      return "hr";
    case "hres":
      return "hres";
    case "hjres":
      return "hjres";
    case "hconres":
      return "hconres";
    case "s":
      return "s";
    case "sres":
      return "sres";
    case "sjres":
      return "sjres";
    case "sconres":
      return "sconres";
    default:
      return null;
  }
}

// Skip plain-"S" matches whose surrounding text suggests they're not a
// senate bill citation — "S 5" alone is too ambiguous (could be jersey
// number, section reference, footnote, etc.). Heuristic: only accept
// when the prefix has at least one dot OR follows clear bill-context
// words. Cheap pre-filter to cut the false-positive rate before handoff
// 65 does formal validation.
function plausibleSenateBill(prefix: string, leftContext: string): boolean {
  if (/\./.test(prefix)) return true;
  const tail = leftContext.slice(-32).toLowerCase();
  return /\b(bill|senate|legislation|act|amendment|measure)\b/.test(tail);
}

export function extractBillIds(text: string): string[] {
  if (!text) return [];
  const ids = new Set<string>();
  const congress = getCurrentCongress();
  for (const m of text.matchAll(BILL_ID_REGEX)) {
    const rawPrefix = m[1];
    const rawNumber = m[2];
    if (!rawPrefix || !rawNumber) continue;
    const billType = normalizeType(rawPrefix);
    if (!billType) continue;
    if (billType === "s") {
      const left = text.slice(0, m.index ?? 0);
      if (!plausibleSenateBill(rawPrefix, left)) continue;
    }
    ids.add(`${congress}-${billType}-${rawNumber}`);
  }
  return Array.from(ids);
}
