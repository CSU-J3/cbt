// HO 385 — computeStage unit suite. No test runner is installed; this is a
// standalone assertion script (the project idiom). Run:
//   npx tsx scripts/diagnostic/computestage-tests-385.ts
//
// Covers the 383 baseline cases (regression guard — none must change) plus one
// case per HO 385 pattern, each asserting the expected rung. Exit 0 = all pass.
import { computeStage, type Stage } from "../../lib/enums";

type Case = { text: string | null; want: Stage; note: string };

const cases: Case[] = [
  // ---- 383 baseline (regression guard: these must not change) ----
  { text: null, want: "introduced", note: "383: null → introduced" },
  { text: "", want: "introduced", note: "383: empty → introduced" },
  { text: "Introduced in the House.", want: "introduced", note: "383: bare intro" },
  { text: "Became Public Law No: 119-93.", want: "enacted", note: "383: public law" },
  { text: "Became Private Law No: 119-1.", want: "enacted", note: "385: private law is enacted" },
  { text: "Signed by President.", want: "enacted", note: "383: signed" },
  { text: "Presented to President.", want: "president", note: "383: presented" },
  { text: "Message sent to the President for signature.", want: "president", note: "383: 'to the President' alt branch" },
  { text: "Notification sent to the President of the Senate.", want: "introduced", note: "383 guard: 'to the President' but President OF THE SENATE → NOT president" },
  { text: "Message to the President pro tempore of the Senate.", want: "introduced", note: "383 guard: 'to the President' but pro tempore → NOT president" },
  { text: "Passed Senate without amendment. Passed House.", want: "other_chamber", note: "383: both chambers" },
  { text: "Passed Senate with an amendment by Unanimous Consent.", want: "floor", note: "383: passed one chamber (senate)" },
  { text: "Passed House.", want: "floor", note: "383: passed one chamber (house)" },
  { text: "Motion to reconsider laid on the table Agreed to without objection.", want: "floor", note: "383 guard (b): post-passage procedural" },
  { text: "Committee on Finance. Reported by Senator Crapo with an amendment.", want: "committee", note: "383: reported" },
  { text: "Committee Consideration and Mark Up Session Held.", want: "committee", note: "383: committee consideration" },
  { text: "Referred to the House Committee on Financial Services.", want: "committee", note: "383: referred to" },

  // ---- HO 385: cross-chamber receipt → other_chamber ----
  { text: "Received in the Senate and Read twice and referred to the Committee on Finance.", want: "other_chamber", note: "385: received in senate (+ referral) → other_chamber, not committee" },
  { text: "Received in the House.", want: "other_chamber", note: "385: received in house" },

  // ---- HO 385: floor-stage dispositions ----
  { text: "Submitted in the Senate, considered, and agreed to with an amendment and a preamble by Unanimous Consent.", want: "floor", note: "385: considered, and agreed to" },
  { text: "Resolution agreed to in Senate without amendment and with a preamble by Unanimous Consent.", want: "floor", note: "385: agreed to in senate" },
  { text: "On motion to suspend the rules and pass the bill Agreed to by the Yeas and Nays.", want: "floor", note: "385: suspend the rules" },
  { text: "Cloture on the motion to proceed to the measure not invoked in Senate by Yea-Nay Vote.", want: "floor", note: "385: cloture / motion to proceed" },
  { text: "Failed of passage in Senate by Yea-Nay Vote.", want: "floor", note: "385: failed of passage" },
  { text: "On agreeing to the resolution Agreed to by the Yeas and Nays: 220 - 211.", want: "floor", note: "385: on agreeing to (floor vote)" },
  { text: "Held at the desk.", want: "floor", note: "385: held at the desk → conservative floor" },

  // ---- HO 385: committee-activity → committee ----
  { text: "Placed on the Union Calendar, Calendar No. 536.", want: "committee", note: "385: calendar placement → committee (floor-rung decision)" },
  { text: "Placed on Senate Legislative Calendar under General Orders. Calendar No. 210.", want: "committee", note: "385: senate legislative calendar" },
  { text: "Subcommittee Hearings Held.", want: "committee", note: "385: hearings held" },
  { text: "Committee on Veterans' Affairs. Hearings held.", want: "committee", note: "385: named committee + hearings" },
  { text: "Forwarded by Subcommittee to Full Committee by Voice Vote.", want: "committee", note: "385: subcommittee" },
  { text: "Committee on Indian Affairs. Business meeting held.", want: "committee", note: "385: committee on (no other verb)" },
  { text: "Open Markup Session held.", want: "committee", note: "385: markup" },
  { text: "Motion to Discharge Committee filed by Mr. Smith.", want: "committee", note: "385: motion to discharge (still in committee)" },

  // ---- HO 385: ordering guards (higher signal must win over new committee/floor rules) ----
  { text: "Passed Senate. Placed on the Union Calendar.", want: "floor", note: "385 guard: passage beats calendar" },
  { text: "Received in the Senate and referred to the Committee on Energy and Natural Resources.", want: "other_chamber", note: "385 guard: receipt beats committee-on" },
  { text: "Became Public Law No: 119-1. Committee on Appropriations.", want: "enacted", note: "385 guard: enacted beats committee-on" },
];

let pass = 0;
const fails: { note: string; text: string | null; want: Stage; got: Stage }[] = [];
for (const c of cases) {
  const got = computeStage(c.text);
  if (got === c.want) pass++;
  else fails.push({ note: c.note, text: c.text, want: c.want, got });
}

console.log(`computeStage suite: ${pass}/${cases.length} passed`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) {
    console.log(`  ✗ ${f.note}\n     text: ${JSON.stringify(f.text)}\n     want ${f.want}, got ${f.got}`);
  }
  process.exit(1);
}
console.log("all green ✓");
process.exit(0);
