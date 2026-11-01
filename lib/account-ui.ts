// HO 796 — the account surfaces (GitHub sign-in on both mastheads and the
// landing, the watch star on every bill row, the WATCHLIST nav item and
// /watchlist itself) render only while this is true. Hidden on Corey's ruling
// of 2026-11-01, so a stranger following the site's link sees no login shape.
// auth.ts, /api/auth, /api/watchlist, the users and watchlist tables and every
// component stay; flip this to bring the arc back, nothing else changes.
export const ACCOUNT_UI = false;
