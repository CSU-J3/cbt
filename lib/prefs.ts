// HO 690 — CLIENT UI PREFERENCES THAT SURVIVE A RELOAD AND DO NOT FLASH.
//
// The standing mechanism for a reader-set UI preference. Built here on the
// smaller consumer (the week summary's collapse); HO 692's odds toggle adds its
// own row to the table below and needs no new machinery.
//
// THE WHOLE POINT IS FIRST PAINT. A preference read in a `useEffect` is applied
// AFTER the browser has already painted the default, so a reader who collapsed a
// section watches it flash in and collapse on every visit. The fix is a
// parser-blocking script in <head> that sets an attribute on <html> before any
// paint, with CSS keyed on that attribute. Two properties make it safe:
//
//   1. IT TOUCHES `data-*` ATTRIBUTES ONLY, NEVER `class`. React does not
//      reconcile an attribute it never rendered, so the pre-paint write is
//      invisible to hydration and `suppressHydrationWarning` stays unused. Adding
//      a class here instead would put the value inside React's diff and
//      reintroduce the #418 class the clock work spent two arcs closing.
//   2. A NON-DEFAULT VALUE IS AN ATTRIBUTE; THE DEFAULT IS ITS ABSENCE. So CSS
//      only ever keys on the non-default state, and a browser that has never
//      stored anything renders byte-identically to one that has stored the
//      default. That also means the storage key is REMOVED when the reader
//      returns to the default rather than being set to it — one representation
//      of "default", not two.
//
// DO NOT READ localStorage DURING RENDER anywhere. A consumer reads the state
// post-mount (`useEffect` -> `setState`) for ARIA only; the VISIBLE state is CSS
// off the attribute and is already correct at first paint. Reading it during
// render is HO 490's class wearing a different costume — the server has no
// storage, so SSR and the first client render would disagree.
//
// No React import, no `next/*` import: this file is imported by the root layout
// (a server component) AND by client islands, so it must be safe in both.

export type PrefName = "weekSummary" | "odds";

export type PrefSpec = {
  /** localStorage key. Namespaced `cbt:pref:` so it is greppable and cannot
   *  collide with `cbt:racesLastView`, the only other key in the app. */
  key: string;
  /** Attribute set on <html> when the value is NOT the default. */
  attr: string;
  /** The complete value domain. Anything else is discarded on read — a hand-set
   *  key must not be able to put an arbitrary attribute on <html>. */
  values: readonly string[];
  /** Rendered as the attribute being ABSENT. */
  default: string;
};

/** ONE source of truth: the consumers, the writer and the pre-paint script all
 *  derive from this table, so a new preference is one row and nothing else. */
export const PREFS: Record<PrefName, PrefSpec> = {
  weekSummary: {
    key: "cbt:pref:weekSummary",
    attr: "data-week-summary",
    values: ["open", "collapsed"] as const,
    default: "open",
  },
  // HO 692 — prediction markets on/off, app-wide. Ruled by Corey 2026-09-03:
  // "yea that and everywhere else that those odds are being used, i.e. It needs
  // to propagate throughout the application."
  //
  // Fifteen render sites across nine components, and NOT ONE of them is threaded
  // a prop: every one is gated by CSS off `html[data-odds="off"]`. That is why
  // this is a row in a table rather than an arc — no cookie, no `cookies()` read,
  // no route going dynamic, no `router.refresh()`. `on` is the default, so the
  // attribute is ABSENT for every reader who never touches the toggle and the
  // page they get is byte-identical to the pre-692 one.
  odds: {
    key: "cbt:pref:odds",
    attr: "data-odds",
    values: ["on", "off"] as const,
    default: "on",
  },
};

/** The stored value, or the default when unset / unreadable / not in `values`.
 *  Client-only — calling this on the server returns the default. */
export function readPref(name: PrefName): string {
  const spec = PREFS[name];
  if (typeof window === "undefined") return spec.default;
  try {
    const v = window.localStorage.getItem(spec.key);
    return v !== null && spec.values.includes(v) ? v : spec.default;
  } catch {
    // Storage throws outright in some private modes. The default is the honest
    // answer: nothing is stored.
    return spec.default;
  }
}

/** Sets the attribute AND the stored value in one call, so the two can never
 *  disagree. The attribute is written FIRST and outside the try: if storage
 *  throws, the toggle must still work for this session — it just will not
 *  survive the reload. */
export function writePref(name: PrefName, value: string): void {
  const spec = PREFS[name];
  const v = spec.values.includes(value) ? value : spec.default;
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (v === spec.default) root.removeAttribute(spec.attr);
    else root.setAttribute(spec.attr, v);
  }
  if (typeof window === "undefined") return;
  try {
    if (v === spec.default) window.localStorage.removeItem(spec.key);
    else window.localStorage.setItem(spec.key, v);
  } catch {
    /* private mode — the attribute above still applied */
  }
}

/** The pre-paint script body, GENERATED FROM `PREFS` so it cannot drift from the
 *  table. Inlined into <head> by app/layout.tsx.
 *
 *  ES5-shaped and dependency-free on purpose: it runs before any bundle, in
 *  whatever the browser gives it, and a throw here would block the parser it is
 *  sitting in — hence the whole body inside one try/catch.
 *
 *  No user data reaches this string. Every value is a literal from the table
 *  above, so there is nothing to escape; if a preference ever needs a
 *  caller-supplied value, it does not belong in <head>. */
export function prefBootScript(): string {
  const table = Object.values(PREFS).map((p) => [p.key, p.attr, p.values, p.default]);
  return `(function(){try{var P=${JSON.stringify(table)},d=document.documentElement,i,p,v;for(i=0;i<P.length;i++){p=P[i];v=localStorage.getItem(p[0]);if(v&&p[2].indexOf(v)>-1&&v!==p[3]){d.setAttribute(p[1],v)}}}catch(e){}})();`;
}
