import "dotenv/config";
import { getDb } from "../../lib/db";

const db = getDb();
const rs = await db.execute("SELECT value, updated_at FROM dashboard_state WHERE key = 'weekly_lead'");
const row = rs.rows[0];
if (!row) { console.log('NO LEAD'); process.exit(0); }
console.log('updated_at:', row.updated_at);
console.log('lead:', row.value);
const lower = String(row.value).toLowerCase();
const hits = ['bills tracked','non-ceremonial','non ceremonial','corpus'].filter(p => lower.includes(p));
console.log('forbidden-phrase hits:', hits.length ? hits : '(none — clean)');
