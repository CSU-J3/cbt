import { MARKET_SYMBOLS } from "../../lib/markets";
const derived = MARKET_SYMBOLS.filter((s) => s.source === "fmp" || s.source === "fred").map((s) => s.internal);
const header = ["SPX","NDQ","NVDA","AAPL","MSFT","GOOGL","LMT","TNX","WTI","CPI","UNEMP"];
console.log("derived  :", derived.join(" "));
console.log("header   :", header.join(" "));
console.log("same set :", derived.length === header.length && derived.every((s) => header.includes(s)));
console.log("kalshi   :", MARKET_SYMBOLS.filter((s) => s.source === "kalshi").map((s) => s.internal).join(" "));
console.log("poly     :", MARKET_SYMBOLS.filter((s) => s.source === "polymarket").map((s) => s.internal).join(" "));
