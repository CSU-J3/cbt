"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { getCurrentCongress } from "@/lib/congress";
import { formatDateLong, formatRelativeAge, ordinal } from "@/lib/format";

// HO 821 — THE DASHBOARD'S SEARCH. Corey, 12:47 PM MST 2026-11-16: "Dashboard
// needs a search bar in a good location both on mobile and web. and when you
// search, have it activity pulling stuff and when selecting, it stays on the
// dashboard displaying whatever info we selected, with a button to go to
// whatever that page is." Ruled on mock-821 v2, kept under docs/design, 1:15 PM
// MST: A · C · Z.
// - A: the bar sits under the masthead, above the first panel, the column's width.
// - C: on a phone (a coarse pointer, 700px and under) there's no bar until the
//   masthead's ⌕ (components/MastheadFold.tsx) asks for it: in the page under an
//   open masthead, pinned under HO 820's strip when folded. Any coarse pointer's
//   folded strip has the ⌕ too.
// - Z: a pick opens as a card directly under the bar, in the page's flow.
//
// RESULTS AS TYPED: from 2 characters, 200 ms after the last key, one request to
// /api/search/suggest; the request before it is aborted, and an answer for an
// older `q` is dropped. `.ds-pull`, the amber run under the bar, shows while one
// is in flight, and the last results stay up while the next load. /search owns
// the matching: the groups are the heads of its tabs and their counts its counts.
//
// THE PICK lives in the URL as `?pick=<kind>:<key>` (`bill:119-s-4964`), written
// with `history.replaceState` and every other parameter kept, so Back from the
// page a card opens brings the card back and a link carries it. It's written
// when the reader chooses, never when the card answers (see `writePick`), and
// the island follows the URL's `pick`, so a navigation back to / that drops it
// drops the card. The server render of / never reads it: the card is fetched
// (/api/search/card) and drawn here, after mount.
//
// THE PHONE'S OPEN STATE is `html[data-search="open"]`, which the CSS reads. A
// `cbt:search-toggle` event on `window` (the ⌕) toggles it, focusing the input
// inside the tap so iOS raises its keyboard; each change dispatches
// `cbt:search-state` with `{ open }`, which keeps the ⌕'s `aria-expanded`.
//
// NO STORAGE, CLOCK OR `window` READ DURING RENDER (`lib/prefs.ts`' header). The
// URL is read in effects and through the router's `useSearchParams`; the time a
// card's or a row's age is measured from is taken when its answer arrives and
// kept in state.

type Counts = { bills: number; members: number; news: number; reports: number };
type BillRow = {
  id: string;
  label: string;
  title: string;
  sponsor: string;
  party: string | null;
  state: string | null;
};
type MemberRow = {
  bioguide: string;
  name: string;
  party: string | null;
  state: string | null;
  chamber: string | null;
};
type NewsRow = {
  id: number;
  headline: string;
  source: string;
  publishedAt: string;
  bill: { id: string; label: string };
};
type ReportRow = { slug: string; label: string };
type Suggest = {
  q: string;
  ref: string | null;
  counts: Counts;
  bills: BillRow[];
  members: MemberRow[];
  news: NewsRow[];
  reports: ReportRow[];
};
type Results = { q: string; at: number; data: Suggest | null };

type BillCard = {
  kind: "bill";
  id: string;
  label: string;
  title: string;
  chamber: string | null;
  stage: string | null;
  stages: string[];
  sponsor: { name: string; party: string | null; state: string | null } | null;
  cosponsors: number | null;
  introduced: string | null;
  lastAction: { date: string | null; text: string | null } | null;
  summary: string | null;
  topics: { key: string; label: string }[];
  href: string;
};
type MemberCard = {
  kind: "member";
  bioguide: string;
  name: string;
  party: string | null;
  state: string | null;
  chamber: string | null;
  sponsored: number;
  enacted: number;
  missedPct: number | null;
  href: string;
};
type NewsCard = {
  kind: "news";
  id: number;
  headline: string;
  source: string;
  publishedAt: string;
  url: string;
  bill: { id: string; label: string; title: string; href: string };
};
type ReportCard = {
  kind: "report";
  slug: string;
  label: string;
  excerpt: string;
  href: string;
};
type Card = (BillCard | MemberCard | NewsCard | ReportCard) & { at: number };

type Option = { pick: string; group: keyof Counts; row: BillRow | MemberRow | NewsRow | ReportRow };

const MIN_Q = 2;
const DEBOUNCE_MS = 200;
const NOTE_MS = 4_000;
const GROUPS: { key: keyof Counts; label: string }[] = [
  { key: "bills", label: "Legislation" },
  { key: "members", label: "Members" },
  { key: "news", label: "News" },
  { key: "reports", label: "Reports" },
];
// The stage order the card's track draws (lib/enums.ts' ALLOWED_STAGES), read by
// index against the route's six labels.
const STAGE_KEYS = ["introduced", "committee", "floor", "other_chamber", "president", "enacted"];

function optionsOf(data: Suggest | null): Option[] {
  if (!data) return [];
  return [
    ...data.bills.map((row) => ({ pick: `bill:${row.id}`, group: "bills" as const, row })),
    ...data.members.map((row) => ({ pick: `member:${row.bioguide}`, group: "members" as const, row })),
    ...data.news.map((row) => ({ pick: `news:${row.id}`, group: "news" as const, row })),
    ...data.reports.map((row) => ({ pick: `report:${row.slug}`, group: "reports" as const, row })),
  ];
}

// The match in amber-bright: the first place the typed text appears, as the mock
// draws it. A title the index matched another way (a stem, another column) draws
// plain.
function marked(text: string, q: string): ReactNode {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

const partyState = (party: string | null, state: string | null) =>
  party || state ? `[${party ?? "?"}-${state ?? "?"}]` : "";
const partyClass = (party: string | null) =>
  party === "R" ? "ds-r" : party === "D" ? "ds-d" : party === "I" ? "ds-i" : "";
const congressOf = (billId: string) => Number(billId.split("-")[0]) || null;

function editable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable
  );
}

// Next patches `history.replaceState` to sync its router, by an ACTION_RESTORE
// that can discard a client navigation still pending (HO 821's review). So the
// pick is written when the reader chooses (nothing is navigating then), not when
// the card's answer lands, and a URL that already reads the pick isn't written.
function writePick(pick: string | null) {
  const url = new URL(window.location.href);
  if ((url.searchParams.get("pick") ?? null) === pick) return;
  if (pick) url.searchParams.set("pick", pick);
  else url.searchParams.delete("pick");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
const urlPickIs = (pick: string) => new URL(window.location.href).searchParams.get("pick") === pick;

function Magnifier() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="5.8" cy="5.8" r="4.3" />
      <path d="M9 9l3.8 3.8" />
    </svg>
  );
}

export function DashboardSearch() {
  const uid = useId();
  const listId = `${uid}-list`;
  const optId = (i: number) => `${uid}-opt-${i}`;

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestAbort = useRef<AbortController | null>(null);
  const cardAbort = useRef<AbortController | null>(null);
  const latestQ = useRef("");
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [failed, setFailed] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pulling, setPulling] = useState(false);
  const [cardPulling, setCardPulling] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const typed = q.trim();
  // A failed answer hides the groups, so it leaves no options to arrow through.
  const options = failed ? [] : optionsOf(results?.data ?? null);
  // The answer on screen is for what's typed now. Typing past an answer leaves
  // it up while the next loads (the handoff's call), but a `ref` from a shorter
  // bill number must not open on Enter: every prefix of one is a bill.
  const fresh = results !== null && results.q === typed && !failed;
  const dropShown = listOpen && typed.length >= MIN_Q && (results !== null || pulling || failed);

  // The phone's open state, on <html>, and its event out.
  const setBar = useCallback((open: boolean, focus: boolean) => {
    const root = document.documentElement;
    if (open) root.dataset.search = "open";
    else delete root.dataset.search;
    if (open && focus) inputRef.current?.focus();
    if (!open) setListOpen(false);
    window.dispatchEvent(new CustomEvent("cbt:search-state", { detail: { open } }));
  }, []);

  const showNote = useCallback((text: string) => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    setNote(text);
    noteTimer.current = setTimeout(() => setNote(null), NOTE_MS);
  }, []);

  // The pick the island last asked for or cleared. The URL's `pick` is followed
  // below, and this is what tells the island's own writes from a navigation's.
  const wantPick = useRef<string | null>(null);
  const shownPick = useRef<string | null>(null);

  const loadCard = useCallback(
    (pick: string) => {
      cardAbort.current?.abort();
      const ac = new AbortController();
      cardAbort.current = ac;
      setCardPulling(true);
      fetch(`/api/search/card?pick=${encodeURIComponent(pick)}`, { signal: ac.signal })
        .then(async (r) => {
          if (ac.signal.aborted) return;
          if (r.status === 404 || r.status === 400) {
            setCard(null);
            shownPick.current = null;
            wantPick.current = null;
            if (urlPickIs(pick)) writePick(null);
            showNote("That's no longer in CT");
            return;
          }
          if (!r.ok) throw new Error("card");
          const data = (await r.json()) as Card;
          if (ac.signal.aborted) return;
          setNote(null);
          setCard({ ...data, at: Date.now() });
          shownPick.current = pick;
        })
        .catch(() => {
          if (ac.signal.aborted) return;
          // The card that's up (if any) stays, and so the URL goes back to it.
          wantPick.current = shownPick.current;
          if (urlPickIs(pick)) writePick(shownPick.current);
          showNote("CT didn't answer. Try again in a moment.");
        })
        .finally(() => {
          if (cardAbort.current === ac) setCardPulling(false);
        });
    },
    [showNote],
  );

  const choose = useCallback(
    (pick: string) => {
      setListOpen(false);
      setActive(-1);
      wantPick.current = pick;
      writePick(pick);
      loadCard(pick);
    },
    [loadCard],
  );

  const clearCard = () => {
    cardAbort.current?.abort();
    setCard(null);
    setNote(null);
    shownPick.current = null;
    wantPick.current = null;
    writePick(null);
  };

  const fetchSuggest = useCallback((text: string) => {
    suggestAbort.current?.abort();
    const ac = new AbortController();
    suggestAbort.current = ac;
    latestQ.current = text;
    setPulling(true);
    fetch(`/api/search/suggest?q=${encodeURIComponent(text)}`, { signal: ac.signal })
      .then(async (r) => {
        const data = r.ok ? ((await r.json()) as Suggest) : null;
        if (ac.signal.aborted || latestQ.current !== text) return;
        setResults({ q: text, at: Date.now(), data });
        setFailed(!r.ok);
        setActive(-1);
      })
      .catch(() => {
        if (ac.signal.aborted || latestQ.current !== text) return;
        setFailed(true);
        setActive(-1);
      })
      .finally(() => {
        if (suggestAbort.current === ac) setPulling(false);
      });
  }, []);

  const onType = (value: string) => {
    setQ(value);
    setActive(-1);
    const text = value.trim();
    if (timerRef.current) clearTimeout(timerRef.current);
    if (text.length < MIN_Q) {
      suggestAbort.current?.abort();
      latestQ.current = "";
      setPulling(false);
      setListOpen(false);
      setResults(null);
      setFailed(false);
      return;
    }
    setListOpen(true);
    timerRef.current = setTimeout(() => fetchSuggest(text), DEBOUNCE_MS);
  };

  // The URL's `pick`, followed: on mount a pick draws its card and opens the bar,
  // so a phone reader coming Back sees it; after a navigation that keeps the
  // island mounted (a filter link drops `pick`), the card follows the URL. The
  // island's own writes read back as what it asked for, and are left alone.
  const urlPick = useSearchParams().get("pick");
  useEffect(() => {
    if (urlPick === wantPick.current) return;
    wantPick.current = urlPick;
    if (urlPick) {
      setBar(true, false);
      loadCard(urlPick);
    } else {
      cardAbort.current?.abort();
      shownPick.current = null;
      setCard(null);
    }
  }, [urlPick, setBar, loadCard]);

  // The toggle from the ⌕, and `/` under a fine pointer. On unmount the bar's
  // state leaves <html> with the page, and the pick is forgotten, so a remount
  // reads the URL again.
  useEffect(() => {
    const onToggle = () => setBar(document.documentElement.dataset.search !== "open", true);
    const onSlash = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!window.matchMedia("(pointer: fine)").matches) return;
      if (editable(document.activeElement)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("cbt:search-toggle", onToggle);
    document.addEventListener("keydown", onSlash);
    return () => {
      window.removeEventListener("cbt:search-toggle", onToggle);
      document.removeEventListener("keydown", onSlash);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (noteTimer.current) clearTimeout(noteTimer.current);
      suggestAbort.current?.abort();
      cardAbort.current?.abort();
      wantPick.current = null;
      shownPick.current = null;
      if (document.documentElement.dataset.search === "open") {
        delete document.documentElement.dataset.search;
        window.dispatchEvent(new CustomEvent("cbt:search-state", { detail: { open: false } }));
      }
    };
  }, [setBar]);

  // A press outside the search closes the list.
  useEffect(() => {
    if (!listOpen) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setListOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [listOpen]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!dropShown) {
        if (typed.length >= MIN_Q && results) setListOpen(true);
        return;
      }
      if (!options.length) return;
      e.preventDefault();
      setActive((a) =>
        e.key === "ArrowDown" ? Math.min(options.length - 1, a + 1) : Math.max(0, a - 1),
      );
      return;
    }
    if (e.key === "Enter") {
      // An option the reader arrowed to is one on screen, so it's picked. A
      // `ref` only from the answer for what's typed now; otherwise the form
      // submits to /search, whose fast path opens a bill number's page.
      const opt = dropShown && active >= 0 ? options[active] : undefined;
      const ref = dropShown && fresh ? results?.data?.ref : null;
      if (opt) {
        e.preventDefault();
        choose(opt.pick);
      } else if (ref) {
        e.preventDefault();
        choose(`bill:${ref}`);
      }
      return;
    }
    if (e.key === "Escape") {
      // A handled Esc stops here: the dashboard's own Esc listeners (an open
      // feed row, the MIA card's back) shouldn't act on the same press.
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
      };
      if (dropShown) {
        stop();
        setListOpen(false);
        setActive(-1);
      } else if (
        document.documentElement.dataset.search === "open" &&
        window.matchMedia("(pointer: coarse) and (max-width: 700px)").matches
      ) {
        stop();
        setBar(false, false);
        inputRef.current?.blur();
      }
    }
  };

  const data = results?.data ?? null;
  const total = data ? data.bills.length + data.members.length + data.news.length + data.reports.length : 0;
  const refLabel = fresh && data?.ref ? (data.bills.find((b) => b.id === data.ref)?.label ?? data.ref) : null;
  let optIndex = -1;

  return (
    <div className="ds" ref={rootRef}>
      <form
        role="search"
        action="/search"
        method="get"
        onSubmit={() => setListOpen(false)}
      >
        <span className="ds-prompt" aria-hidden="true">
          <Magnifier />
        </span>
        <input
          ref={inputRef}
          type="search"
          name="q"
          value={q}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (typed.length >= MIN_Q && results) setListOpen(true);
          }}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="Search bills, members, news, reports"
          aria-label="Search bills, members, news and reports"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={dropShown}
          aria-controls={listId}
          aria-activedescendant={dropShown && active >= 0 ? optId(active) : undefined}
        />
        {q ? (
          <button
            type="button"
            className="ds-x"
            aria-label="Clear the search"
            onClick={() => {
              onType("");
              inputRef.current?.focus();
            }}
          >
            ✕
          </button>
        ) : (
          <span className="ds-kbd" aria-hidden="true">
            /
          </span>
        )}
        <div className={`ds-pull${pulling || cardPulling ? " on" : ""}`} aria-hidden="true" />
        <div
          className="ds-drop"
          id={listId}
          role="listbox"
          aria-label="Search results"
          hidden={!dropShown}
        >
          {dropShown && refLabel ? (
            <div className="ds-stat" role="presentation">
              bill number: Enter opens <b>{refLabel}</b> here
            </div>
          ) : null}
          {dropShown && !data && !failed ? (
            <div className="ds-stat" role="presentation">
              searching bills, members, news and reports…
            </div>
          ) : null}
          {dropShown && failed ? (
            <div className="ds-empty" role="presentation">
              Search didn&apos;t answer. Enter opens /search.
            </div>
          ) : null}
          {dropShown && data && !failed
            ? GROUPS.map(({ key, label }) => {
                const rows = options.filter((o) => o.group === key);
                if (!rows.length) return null;
                const headId = `${uid}-g-${key}`;
                return (
                  <div className="ds-group" role="group" aria-labelledby={headId} key={key}>
                    <div className="ds-gh" id={headId} role="presentation">
                      <span>{label}</span>
                      <span className="ds-gc">{data.counts[key].toLocaleString()}</span>
                    </div>
                    {rows.map((o) => {
                      optIndex += 1;
                      const i = optIndex;
                      return (
                        <div
                          key={o.pick}
                          id={optId(i)}
                          role="option"
                          aria-selected={i === active}
                          className={`ds-opt${i === active ? " cur" : ""}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => choose(o.pick)}
                        >
                          <OptionRow option={o} q={results?.q ?? typed} at={results?.at ?? 0} />
                        </div>
                      );
                    })}
                  </div>
                );
              })
            : null}
          {dropShown && data && !failed && total === 0 ? (
            <div className="ds-empty" role="presentation">
              Nothing for &ldquo;{data.q}&rdquo;. Try a bill number, a member&apos;s last name or a topic.
            </div>
          ) : null}
          {dropShown ? (
            <div className="ds-foot" role="presentation">
              <span className="ds-foot-keys">top 4 a group · ↑ ↓ Enter · Esc</span>
              {/* No prefetch: the foot redraws on every answer, and a prefetch
                  a keystroke would ask /search for pages nobody opens. */}
              <Link href={`/search?q=${encodeURIComponent(typed)}`} prefetch={false}>
                all results in /search?q={typed} →
              </Link>
            </div>
          ) : null}
        </div>
      </form>
      {/* The note draws with or without a card: a new pick that fails while an
          older card is up still says so, above the card it left in place. */}
      {note ? (
        <div className="ds-note" role="status">
          {note}
        </div>
      ) : null}
      {card ? <PickCard card={card} onClear={clearCard} /> : null}
    </div>
  );
}

function OptionRow({ option, q, at }: { option: Option; q: string; at: number }) {
  if (option.group === "bills") {
    const b = option.row as BillRow;
    return (
      <>
        <span className="ds-id">{b.label}</span>
        <span className="ds-tt">{marked(b.title, q)}</span>
        <span className="ds-mt">
          {b.sponsor.toUpperCase()} {partyState(b.party, b.state)}
        </span>
      </>
    );
  }
  if (option.group === "members") {
    const m = option.row as MemberRow;
    return (
      <>
        <span className="ds-id">{m.chamber === "senate" ? "SEN" : m.chamber === "house" ? "REP" : "MEMBER"}</span>
        <span className="ds-tt">{marked(m.name, q)}</span>
        <span className="ds-mt">{partyState(m.party, m.state)}</span>
      </>
    );
  }
  if (option.group === "news") {
    const n = option.row as NewsRow;
    return (
      <>
        <span className="ds-id">{n.bill.label}</span>
        <span className="ds-tt">{marked(n.headline, q)}</span>
        <span className="ds-mt">
          {n.source} · {formatRelativeAge(n.publishedAt, at)}
        </span>
      </>
    );
  }
  const r = option.row as ReportRow;
  return (
    <>
      <span className="ds-id">REPORT</span>
      <span className="ds-tt">{marked(r.label, q)}</span>
      <span className="ds-mt">{r.slug}</span>
    </>
  );
}

function CardHead({ tag, line, onClear }: { tag: string; line: string; onClear: () => void }) {
  return (
    <div className="ds-card-h">
      <span className="ds-tag">{tag}</span>
      <span>{line}</span>
      <span className="ds-sp" />
      <button type="button" className="ds-card-clear" aria-label="Clear the pick" onClick={onClear}>
        ✕
      </button>
    </div>
  );
}

function PickCard({ card, onClear }: { card: Card; onClear: () => void }) {
  if (card.kind === "bill") {
    const cur = card.stage ? STAGE_KEYS.indexOf(card.stage) : -1;
    const congress = congressOf(card.id);
    const line = [card.chamber, congress ? ordinal(congress) : null].filter(Boolean).join(" · ");
    return (
      <div className="ds-card" data-kind="bill">
        <CardHead tag="BILL" line={line} onClear={onClear} />
        <div className="ds-card-t">
          <span className="ds-card-id">{card.label}</span>
          <span className="ds-card-title">{card.title}</span>
        </div>
        {cur >= 0 ? (
          <div className="ds-track" aria-label="Bill stage">
            {card.stages.map((s, i) => (
              <span key={s} className={i < cur ? "done" : i === cur ? "now" : undefined}>
                {s}
              </span>
            ))}
          </div>
        ) : null}
        <div className="ds-card-meta">
          {card.sponsor ? (
            <>
              Sponsor{" "}
              <span className={partyClass(card.sponsor.party)}>
                {card.sponsor.name} {partyState(card.sponsor.party, card.sponsor.state)}
              </span>
            </>
          ) : null}
          {card.cosponsors !== null ? (
            <>
              {card.sponsor ? " · " : ""}
              {card.cosponsors.toLocaleString()} cosponsor{card.cosponsors === 1 ? "" : "s"}
            </>
          ) : null}
          {card.introduced ? <> · introduced {formatDateLong(card.introduced)}</> : null}
          {card.lastAction ? (
            <>
              <br />
              Last action {formatDateLong(card.lastAction.date)}
              {card.lastAction.text ? ` ${card.lastAction.text}` : ""}
            </>
          ) : null}
        </div>
        {card.summary ? <p className="ds-card-sum">{card.summary}</p> : null}
        {card.topics.length ? (
          <div className="ds-chips">
            {card.topics.map((t) => (
              <span className="ds-chip" key={t.key}>
                {t.label}
              </span>
            ))}
          </div>
        ) : null}
        <div className="ds-go-row">
          <Link className="ds-go ds-card-open" href={card.href}>
            OPEN {card.label} →
          </Link>
          <span className="ds-go-path">{card.href}</span>
        </div>
      </div>
    );
  }
  if (card.kind === "member") {
    const line = [card.chamber, ordinal(getCurrentCongress(new Date(card.at)))].filter(Boolean).join(" · ");
    return (
      <div className="ds-card" data-kind="member">
        <CardHead tag="MEMBER" line={line} onClear={onClear} />
        <div className="ds-card-t">
          <span className="ds-card-title">{card.name}</span>{" "}
          <span className={`ds-card-ps ${partyClass(card.party)}`}>{partyState(card.party, card.state)}</span>
        </div>
        <div className="ds-stats">
          <span>
            <b>{card.sponsored.toLocaleString()}</b>bills sponsored
          </span>
          <span>
            <b>{card.enacted.toLocaleString()}</b>became law
          </span>
          {card.missedPct !== null ? (
            <span>
              <b>{card.missedPct}%</b>votes missed
            </span>
          ) : null}
        </div>
        <div className="ds-go-row">
          <Link className="ds-go ds-card-open" href={card.href}>
            OPEN MEMBER →
          </Link>
          <span className="ds-go-path">{card.href}</span>
        </div>
      </div>
    );
  }
  if (card.kind === "news") {
    return (
      <div className="ds-card" data-kind="news">
        <CardHead tag="NEWS" line={`${card.source} · ${formatRelativeAge(card.publishedAt, card.at)} ago`} onClear={onClear} />
        <div className="ds-card-t">
          <span className="ds-card-title">{card.headline}</span>
        </div>
        <div className="ds-chips">
          <span className="ds-chip b" title={card.bill.title}>
            {card.bill.label}
          </span>
        </div>
        <div className="ds-go-row">
          <a className="ds-go ds-card-open" href={card.url} target="_blank" rel="noopener noreferrer">
            OPEN ARTICLE ↗
          </a>
          <Link className="ds-go sec" href={card.bill.href}>
            OPEN {card.bill.label} →
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="ds-card" data-kind="report">
      <CardHead tag="REPORT" line="weekly" onClear={onClear} />
      <div className="ds-card-t">
        <span className="ds-card-title">{card.label}</span>
      </div>
      {card.excerpt ? <p className="ds-card-sum">{card.excerpt}</p> : null}
      <div className="ds-go-row">
        <Link className="ds-go ds-card-open" href={card.href}>
          OPEN REPORT →
        </Link>
        <span className="ds-go-path">{card.href}</span>
      </div>
    </div>
  );
}
