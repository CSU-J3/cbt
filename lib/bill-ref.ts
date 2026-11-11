import { BILL_TYPE_LABELS } from "./enums";

// HO 813: a bill reference typed into search, read as its bill_type and number,
// so /search can send "HR 3978" straight to its bill page. bills_fts indexes the
// title, summary and sponsor name, not the number (scripts/migrate.ts:1660), so
// without this a bare number finds nothing useful.
//
// The printed forms, dots and spaces optional and any case: H.R. 3978, HR3978,
// hr 3978, S. 1, H.J.Res. 12, S.Res. 5, H.Con.Res. 1, S.Con.Res. 2. The type is
// the prefix with its dots and spaces dropped, and it has to be one of the eight
// bill_type values (BILL_TYPE_LABELS' keys); the number is 1 to 5 digits, unbroken.
// Anything else is null and the search runs as it always has.
//
// Imported relatively, not through "@/", because e2e/smoke.spec.ts imports this
// file directly (HO 813's lib test).
export type BillRef = { type: string; number: number };

const BILL_TYPES = new Set(Object.keys(BILL_TYPE_LABELS));
const REF_RE = /^([a-z][a-z.\s]*?)\.?\s*(\d{1,5})$/i;

export function parseBillRef(q: string): BillRef | null {
  const m = REF_RE.exec(q.trim());
  if (!m) return null;
  const type = (m[1] ?? "").replace(/[.\s]/g, "").toLowerCase();
  if (!BILL_TYPES.has(type)) return null;
  const number = Number(m[2]);
  return number > 0 ? { type, number } : null;
}
