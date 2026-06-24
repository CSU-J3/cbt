import type { Metadata } from "next";
import { LandingCTAs } from "@/components/LandingCTAs";
import { topicColor, topicLabel } from "@/lib/topic-colors";
import styles from "./landing.module.css";

// HO 361 (B1, the last piece of the multi-user arc) — the split-layout landing.
// Built from the signed-off mock docs/design/landing.html. Static server
// component (no DB, no auth, no searchParams) so the most-hit anonymous URL
// prerenders. The cursor blink, live-dot, and tape marquee are pure CSS; the
// only client JS is the two CTA buttons (components/LandingCTAs.tsx).
//
// Proof-of-life is STATIC by design (HO 361 decision) — the rows/tape/breaking
// strip are a presentational replica, NOT the live BillRow/MarketsTape (that
// would import the star→signIn path + cron-flake risk onto the landing for no
// gain). The ONE thing sourced live: chip colors + labels, pulled from
// lib/topic-colors.ts so they match the real feed.

const SUBLINE =
  "A live feed of the current Congress: every bill summarized and staged, every member tracked, every competitive race rated.";

export const metadata: Metadata = {
  title: "Congressional Terminal",
  description: SUBLINE,
  openGraph: {
    title: "Congressional Terminal",
    description: SUBLINE,
    url: "/welcome",
    type: "website",
  },
};

type Party = "r" | "d" | "i";
type Stage = "cmte" | "floor" | "enacted";

const ROWS: {
  id: string;
  title: string;
  sponsor: string;
  party: Party;
  partyTag: string;
  topics: string[];
  stage: Stage;
  stageLabel: string;
  age: string;
}[] = [
  {
    id: "HR 4521",
    title: "American Innovation and Competitiveness Act of 2025",
    sponsor: "LOFGREN",
    party: "d",
    partyTag: "[D-CA]",
    topics: ["technology", "financial_services"],
    stage: "floor",
    stageLabel: "FLOOR",
    age: "2h",
  },
  {
    id: "S 1020",
    title: "Veterans Health Care Improvement Act",
    sponsor: "MORAN",
    party: "r",
    partyTag: "[R-KS]",
    topics: ["veterans", "healthcare"],
    stage: "enacted",
    stageLabel: "ENACTED",
    age: "1d",
  },
  {
    id: "HR 138",
    title: "Lowering Costs for Caregivers Act of 2025",
    sponsor: "STEFANIK",
    party: "r",
    partyTag: "[R-NY]",
    topics: ["healthcare", "labor"],
    stage: "cmte",
    stageLabel: "CMTE",
    age: "4h",
  },
  {
    id: "HR 2890",
    title: "Federal Permitting Modernization Act",
    sponsor: "GREEN",
    party: "r",
    partyTag: "[R-TN]",
    topics: ["government_operations", "environment"],
    stage: "floor",
    stageLabel: "FLOOR",
    age: "8h",
  },
  {
    id: "S 4483",
    title:
      "A bill to streamline agricultural permit applications and reduce processing time",
    sponsor: "SMITH",
    party: "d",
    partyTag: "[D-MN]",
    topics: ["agriculture"],
    stage: "cmte",
    stageLabel: "CMTE",
    age: "6h",
  },
  {
    id: "S 770",
    title: "Rural Broadband Access Act",
    sponsor: "KLOBUCHAR",
    party: "d",
    partyTag: "[D-MN]",
    topics: ["technology"],
    stage: "cmte",
    stageLabel: "CMTE",
    age: "11h",
  },
  {
    id: "HR 901",
    title: "Small Business Tax Relief and Simplification Act",
    sponsor: "FITZPATRICK",
    party: "r",
    partyTag: "[R-PA]",
    topics: ["financial_services"],
    stage: "cmte",
    stageLabel: "CMTE",
    age: "14h",
  },
];

type TapeItem = { l: string; v?: string; k: "up" | "dn" | "odds" | "badge"; c: string };

const TAPE: TapeItem[] = [
  { l: "S&P 500", v: "6,412.88", k: "up", c: "▲0.38%" },
  { l: "NASDAQ", v: "21,030.44", k: "up", c: "▲0.61%" },
  { l: "10Y", v: "4.21%", k: "dn", c: "▼0.03" },
  { l: "CPI", v: "4.2%", k: "badge", c: "MO" },
  { l: "UNEMP", v: "4.3%", k: "badge", c: "MO" },
  { l: "SHUTDOWN", k: "odds", c: "49%" },
  { l: "FED CUT", k: "odds", c: "62%" },
  { l: "WTI", v: "78.40", k: "up", c: "▲1.10%" },
];

function TapeRun({ keyPrefix }: { keyPrefix: string }) {
  return (
    <>
      {TAPE.map((t, i) => (
        <span key={`${keyPrefix}-${i}`}>
          <span className={styles.ti}>
            <span className={styles.tl}>{t.l}</span>
            {t.v ? <span className={styles.tv}>{t.v}</span> : null}
            <span className={styles[t.k] ?? ""}>{t.c}</span>
          </span>
          <span className={styles.tsep}>·</span>
        </span>
      ))}
    </>
  );
}

export default function WelcomePage() {
  return (
    <div className={styles.split}>
      <section className={styles.pitch}>
        <div className={styles.prompt}>
          Congressional Terminal<b>:\&gt;</b>
        </div>
        <h1 className={styles.q}>
          WTF is going on in Congress?<span className={styles.cur}>_</span>
        </h1>
        <p className={styles.sub}>{SUBLINE}</p>
        <div className={styles.readout}>
          <div className={styles.stat}>
            <div className={styles.num}>15,903</div>
            <div className={styles.lbl}>Introduced</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.num}>91</div>
            <div className={styles.lbl}>
              Became law <span className={styles.pct}>0.6%</span>
            </div>
          </div>
          <div className={styles.stat}>
            <div className={styles.num}>448</div>
            <div className={styles.lbl}>Moved / 7d</div>
          </div>
        </div>
        <nav className={styles.cta}>
          <LandingCTAs
            primaryClassName={`${styles.btn} ${styles.primary}`}
            secondaryClassName={`${styles.btn} ${styles.secondary}`}
            arrowClassName={styles.arr ?? ""}
          />
          <span className={styles.reassure}>
            <span className={styles.b}>No account needed</span> to look around.
            Full read access.
          </span>
          <span className={styles.savenote}>unlocks saving · watchlist</span>
        </nav>
      </section>

      <aside className={styles.live}>
        <div className={styles.winbar}>
          <div className={styles.wl}>
            <span className={styles.livedot} />
            119TH CONGRESS · LIVE FEED
          </div>
          <div className={styles.wr}>
            <span className={styles.n}>12</span> IN LAST HR · SYNC 02:05 MT
          </div>
        </div>
        <div className={styles.breaking}>
          <span className={styles.tag}>BREAKING</span>
          <span className={styles.txt}>
            Government funding lapses in <span className={styles.cd}>14 days</span>{" "}
            · shutdown odds <span className={styles.odds}>49%</span> and climbing
          </span>
        </div>
        <div className={styles.tape}>
          <div className={styles.ttrack}>
            <TapeRun keyPrefix="a" />
            <TapeRun keyPrefix="b" />
          </div>
        </div>
        <div className={styles.feedhead}>
          <span className={`${styles.tab} ${styles.active}`}>
            MOVERS<span className={styles.ct}>(35)</span>
          </span>
          <span className={styles.tab}>
            TOP STALLS<span className={styles.ct}>(5)</span>
          </span>
          <span className={styles.tab}>
            NEW<span className={styles.ct}>(59)</span>
          </span>
        </div>
        <div className={styles.feed}>
          {ROWS.map((r) => (
            <div className={styles.row} key={r.id}>
              <span className={styles.idchip}>{r.id}</span>
              <div className={styles.main}>
                <div className={styles.title}>{r.title}</div>
                <div className={styles.subline}>
                  <span className={styles.sponsor}>{r.sponsor}</span>
                  <span className={`${styles.party} ${styles[r.party]}`}>
                    {r.partyTag}
                  </span>
                  <span className={styles.sep}>·</span>
                  {r.topics.map((t) => (
                    <span
                      key={t}
                      className={styles.chip}
                      style={{ ["--tc" as string]: topicColor(t) }}
                    >
                      {topicLabel(t)}
                    </span>
                  ))}
                </div>
              </div>
              <div className={styles.metric}>
                <span className={`${styles.st} ${styles[r.stage]}`}>
                  {r.stageLabel}
                </span>
                <span className={styles.age}> · {r.age}</span>
              </div>
              <span className={styles.caret}>▾</span>
            </div>
          ))}
          <div className={styles.fade} />
        </div>
      </aside>
    </div>
  );
}
