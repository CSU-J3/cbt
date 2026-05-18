// scripts/resolve-caucus-bioguide-ids.ts
//
// One-shot resolver: takes hand-curated caucus roster name lists (sourced
// from Wikipedia, May 2026), fuzzy-matches names against the `members`
// table, and writes data/affiliations-seed.json with bioguide_id arrays.
//
// Ambiguous (multiple matches) and unmatched names are logged so you can
// spot-fix the JSON before running `pnpm seed:affiliations`.
//
// Run: pnpm tsx scripts/resolve-caucus-bioguide-ids.ts

import 'dotenv/config';
import { getDb } from '../lib/db';
import * as fs from 'fs';
import * as path from 'path';

interface MemberRow {
  bioguide_id: string;
  name: string;
  state: string | null;
}

const SOURCE_URLS: Record<string, string> = {
  freedom_caucus: 'https://en.wikipedia.org/wiki/Freedom_Caucus',
  rsc: 'https://en.wikipedia.org/wiki/Republican_Study_Committee',
  progressive_caucus: 'https://en.wikipedia.org/wiki/List_of_members_of_the_Congressional_Progressive_Caucus',
  new_dem: 'https://en.wikipedia.org/wiki/New_Democrat_Coalition',
};

const ROSTERS: Record<string, string[]> = {
  // ~31 members. Wikipedia "Freedom Caucus" current members section.
  freedom_caucus: [
    'Barry Moore', 'Gary Palmer', 'Eli Crane', 'Andy Biggs', 'Paul Gosar',
    'Lauren Boebert', 'Greg Steube', 'Byron Donalds', 'Andrew Clyde',
    'Mike Collins', 'Russ Fulcher', 'Mary Miller', 'Marlin Stutzman',
    'Clay Higgins', 'Andy Harris', 'Eric Burlison', 'Jim Jordan',
    'Josh Brecheen', 'Scott Perry', 'Ralph Norman', 'Diana Harshbarger',
    'Scott DesJarlais', 'Andy Ogles', 'Keith Self', 'Chip Roy',
    'Brandon Gill', 'Michael Cloud', 'Ben Cline', 'Morgan Griffith',
    'Tom Tiffany', 'Harriet Hageman',
  ],

  // ~145 of ~188 named on Wikipedia "Republican Study Committee".
  // Caucus stopped publishing official roster Jan 2025, so this is the
  // best-known public list. Spot-check freshmen who joined in 2025.
  rsc: [
    'Barry Moore', 'Mike Rogers', 'Robert Aderholt', 'Dale Strong', 'Gary Palmer',
    'David Schweikert', 'Juan Ciscomani', 'Paul Gosar', 'French Hill',
    'Bruce Westerman', 'Doug LaMalfa', 'Kevin Kiley', 'Tom McClintock',
    'Jay Obernolte', 'Darrell Issa', 'Lauren Boebert', 'Neal Dunn',
    'Kat Cammack', 'Aaron Bean', 'Mike Waltz', 'Cory Mills', 'Daniel Webster',
    'Gus Bilirakis', 'Anna Paulina Luna', 'Laurel Lee', 'Vern Buchanan',
    'Greg Steube', 'Scott Franklin', 'Byron Donalds', 'Brian Mast',
    'Carlos Gimenez', 'Buddy Carter', 'Drew Ferguson', 'Rich McCormick',
    'Austin Scott', 'Andrew Clyde', 'Mike Collins', 'Barry Loudermilk',
    'Rick Allen', 'Marjorie Taylor Greene', 'Russ Fulcher', 'Mike Bost',
    'Mary Miller', 'Darin LaHood', 'Rudy Yakym', 'Jim Baird', 'Victoria Spartz',
    'Erin Houchin', 'Ashley Hinson', 'Zach Nunn', 'Randy Feenstra',
    'Tracey Mann', 'Ron Estes', 'James Comer', 'Brett Guthrie', 'Andy Barr',
    'Steve Scalise', 'Clay Higgins', 'Mike Johnson', 'Julia Letlow',
    'Jack Bergman', 'John Moolenaar', 'Bill Huizenga', 'Tim Walberg',
    'Lisa McClain', 'John James', 'Brad Finstad', 'Tom Emmer',
    'Michelle Fischbach', 'Pete Stauber', 'Trent Kelly', 'Michael Guest',
    'Mike Ezell', 'Ann Wagner', 'Mark Alford', 'Eric Burlison', 'Jason Smith',
    'Ryan Zinke', 'Mike Flood', 'Don Bacon', 'Adrian Smith', 'Jeff Van Drew',
    'Chris Smith', 'Nick LaLota', 'Nicole Malliotakis', 'Elise Stefanik',
    'Nick Langworthy', 'Claudia Tenney', 'Greg Murphy', 'Virginia Foxx',
    'David Rouzer', 'Dan Bishop', 'Richard Hudson', 'Patrick McHenry',
    'Chuck Edwards', 'Bob Latta', 'Bill Johnson', 'Max Miller',
    'Warren Davidson', 'Mike Turner', 'Troy Balderson', 'Mike Carey',
    'Kevin Hern', 'Josh Brecheen', 'Tom Cole', 'Stephanie Bice', 'Cliff Bentz',
    'Dan Meuser', 'Lloyd Smucker', 'Guy Reschenthaler', 'Mike Kelly',
    'Joe Wilson', 'William Timmons', 'Ralph Norman', 'Russell Fry',
    'Dusty Johnson', 'Diana Harshbarger', 'Chuck Fleischmann', 'Scott DesJarlais',
    'Andy Ogles', 'John Rose', 'Mark Green', 'David Kustoff', 'Nathaniel Moran',
    'Dan Crenshaw', 'Keith Self', 'Pat Fallon', 'Lance Gooden', 'Jake Ellzey',
    'Morgan Luttrell', 'Michael McCaul', 'August Pfluger', 'Ronny Jackson',
    'Randy Weber', 'Monica De La Cruz', 'Pete Sessions', 'Jodey Arrington',
    'Chip Roy', 'Troy Nehls', 'Tony Gonzales', 'Beth Van Duyne',
    'Roger Williams', 'Michael Burgess', 'Michael Cloud', 'John Carter',
    'Brian Babin', 'Blake Moore', 'Chris Stewart', 'Burgess Owens',
    'Rob Wittman', 'Ben Cline', 'Dan Newhouse', 'Cathy McMorris Rodgers',
    'Bryan Steil', 'Scott Fitzgerald', 'Glenn Grothman', 'Tom Tiffany',
    'Harriet Hageman', 'James Moylan',
  ],

  // ~95 members. Wikipedia "List of members of the Congressional Progressive Caucus".
  progressive_caucus: [
    'Bernie Sanders', 'Yassamin Ansari', 'Jared Huffman', 'John Garamendi',
    'Mark DeSaulnier', 'Lateefah Simon', 'Ro Khanna', 'Jimmy Panetta', 'Judy Chu',
    'Luz Rivas', 'Laura Friedman', 'Brad Sherman', 'Jimmy Gomez', 'Ted Lieu',
    'Sydney Kamlager-Dove', 'Linda Sanchez', 'Mark Takano', 'Robert Garcia',
    'Maxine Waters', 'Nanette Barragan', 'Dave Min', 'Mike Levin', 'Sara Jacobs',
    'Juan Vargas', 'Diana DeGette', 'Joe Neguse', 'Rosa DeLauro', 'Sarah McBride',
    'Darren Soto', 'Maxwell Frost', 'Sheila Cherfilus-McCormick', 'Frederica Wilson',
    'Hank Johnson', 'Nikema Williams', 'Jill Tokuda', 'Jonathan Jackson',
    'Delia Ramirez', 'Jesus Garcia', 'Danny Davis', 'Jan Schakowsky',
    'Andre Carson', 'Morgan McGarvey', 'Troy Carter', 'Chellie Pingree',
    'Kweisi Mfume', 'Jamie Raskin', 'Jim McGovern', 'Lori Trahan',
    'Ayanna Pressley', 'Debbie Dingell', 'Rashida Tlaib', 'Shri Thanedar',
    'Ilhan Omar', 'Steven Horsford', 'Donald Norcross', 'Frank Pallone',
    'Nellie Pou', 'LaMonica McIver', 'Bonnie Watson Coleman', 'Melanie Stansbury',
    'Teresa Leger Fernandez', 'Grace Meng', 'Nydia Velazquez', 'Yvette Clarke',
    'Dan Goldman', 'Jerrold Nadler', 'Adriano Espaillat', 'Alexandria Ocasio-Cortez',
    'Paul Tonko', 'Valerie Foushee', 'Alma Adams', 'Shontel Brown',
    'Suzanne Bonamici', 'Maxine Dexter', 'Val Hoyle', 'Andrea Salinas',
    'Brendan Boyle', 'Dwight Evans', 'Madeleine Dean', 'Mary Gay Scanlon',
    'Summer Lee', 'Chris Deluzio', 'Veronica Escobar', 'Joaquin Castro',
    'Jasmine Crockett', 'Greg Casar', 'Lloyd Doggett', 'Becca Balint',
    'Jennifer McClellan', 'Don Beyer', 'Emily Randall', 'Pramila Jayapal',
    'Adam Smith', 'Mark Pocan', 'Gwen Moore', 'Eleanor Holmes Norton',
  ],

  // ~115 members. Wikipedia "New Democrat Coalition" current members section.
  new_dem: [
    'Shomari Figures', 'Terri Sewell', 'Greg Stanton', 'Ami Bera', 'Josh Harder',
    'Adam Gray', 'Kevin Mullin', 'Sam Liccardo', 'Jimmy Panetta', 'Jim Costa',
    'Salud Carbajal', 'Raul Ruiz', 'Julia Brownley', 'George Whitesides',
    'Gil Cisneros', 'Brad Sherman', 'Pete Aguilar', 'Norma Torres', 'Derek Tran',
    'Lou Correa', 'Mike Levin', 'Scott Peters', 'Sara Jacobs', 'Juan Vargas',
    'Jason Crow', 'Brittany Pettersen', 'Joe Courtney', 'Jim Himes',
    'Jahana Hayes', 'Sarah McBride', 'Darren Soto', 'Jared Moskowitz',
    'Debbie Wasserman Schultz', 'Nikema Williams', 'Lucy McBath', 'David Scott',
    'Ed Case', 'Mike Quigley', 'Sean Casten', 'Raja Krishnamoorthi',
    'Brad Schneider', 'Bill Foster', 'Nikki Budzinski', 'Eric Sorensen',
    'Frank Mrvan', 'Andre Carson', 'Sharice Davids', 'Morgan McGarvey',
    'Troy Carter', 'Johnny Olszewski', 'Sarah Elfreth', 'Glenn Ivey',
    'April McClain Delaney', 'Lori Trahan', 'Seth Moulton', 'Bill Keating',
    'Hillary Scholten', 'Kristen McDonald Rivet', 'Haley Stevens', 'Shri Thanedar',
    'Angie Craig', 'Kelly Morrison', 'Wesley Bell', 'Susie Lee', 'Steven Horsford',
    'Chris Pappas', 'Maggie Goodlander', 'Donald Norcross', 'Herb Conaway',
    'Josh Gottheimer', 'Nellie Pou', 'Mikie Sherrill', 'Gabe Vasquez',
    'Tom Suozzi', 'Laura Gillen', 'Gregory Meeks', 'Dan Goldman', 'George Latimer',
    'Pat Ryan', 'Josh Riley', 'John Mannion', 'Joseph Morelle', 'Tim Kennedy',
    'Don Davis', 'Deborah Ross', 'Valerie Foushee', 'Greg Landsman',
    'Shontel Brown', 'Emilia Sykes', 'Val Hoyle', 'Janelle Bynum',
    'Andrea Salinas', 'Brendan Boyle', 'Madeleine Dean', 'Mary Gay Scanlon',
    'Chrissy Houlahan', 'Seth Magaziner', 'Lizzie Fletcher', 'Veronica Escobar',
    'Joaquin Castro', 'Henry Cuellar', 'Julie Johnson', 'Marc Veasey',
    'Vicente Gonzalez', 'Jennifer McClellan', 'Eugene Vindman', 'Don Beyer',
    'Suhas Subramanyam', 'James Walkinshaw', 'Suzan DelBene', 'Rick Larsen',
    'Emily Randall', 'Kim Schrier', 'Adam Smith', 'Marilyn Strickland',
    'Stacey Plaskett', 'Pablo Hernandez Rivera',
  ],
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z\s-]/g, '')        // drop punctuation except hyphen
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  // Split on space + hyphen so "Ocasio-Cortez" matches "Ocasio Cortez" if needed
  return normalize(s).split(/[\s-]+/).filter(Boolean);
}

interface ResolveResult {
  bioguide: string | null;
  candidates: MemberRow[];
  matchType: 'exact' | 'first_last' | 'last_only' | 'ambiguous' | 'unmatched';
}

function resolveOne(name: string, members: MemberRow[]): ResolveResult {
  const targetTokens = tokenize(name);
  const targetFirst = targetTokens[0] ?? '';
  const targetLast = targetTokens[targetTokens.length - 1] ?? '';

  // 1. Exact normalized match
  const exact = members.filter(m => normalize(m.name) === normalize(name));
  if (exact.length === 1) return { bioguide: exact[0]!.bioguide_id, candidates: exact, matchType: 'exact' };

  // 2. First + last token match (ignore middle names/initials)
  const firstLast = members.filter(m => {
    const mt = tokenize(m.name);
    return mt[0] === targetFirst && mt[mt.length - 1] === targetLast;
  });
  if (firstLast.length === 1) return { bioguide: firstLast[0]!.bioguide_id, candidates: firstLast, matchType: 'first_last' };
  if (firstLast.length > 1) return { bioguide: null, candidates: firstLast, matchType: 'ambiguous' };

  // 3. Last-only match (catches name variants like "Jerry Nadler" vs "Jerrold Nadler")
  const lastOnly = members.filter(m => {
    const mt = tokenize(m.name);
    return mt[mt.length - 1] === targetLast;
  });
  if (lastOnly.length === 1) return { bioguide: lastOnly[0]!.bioguide_id, candidates: lastOnly, matchType: 'last_only' };
  if (lastOnly.length > 1) return { bioguide: null, candidates: lastOnly, matchType: 'ambiguous' };

  return { bioguide: null, candidates: [], matchType: 'unmatched' };
}

async function main() {
  const db = getDb();
  const res = await db.execute('SELECT bioguide_id, name, state FROM members');
  const members: MemberRow[] = res.rows.map(r => ({
    bioguide_id: r.bioguide_id as string,
    name: r.name as string,
    state: (r.state as string | null) ?? null,
  }));
  console.log(`Loaded ${members.length} members from DB\n`);

  const today = new Date().toISOString().slice(0, 10);
  const output = { caucuses: [] as any[] };

  for (const [org, names] of Object.entries(ROSTERS)) {
    const resolved = new Set<string>();
    const fuzzy: string[] = [];   // matched via last_only — worth eyeballing
    const ambiguous: { name: string; candidates: string[] }[] = [];
    const unmatched: string[] = [];

    for (const name of names) {
      const r = resolveOne(name, members);
      if (r.bioguide) {
        resolved.add(r.bioguide);
        if (r.matchType === 'last_only') fuzzy.push(`${name} → ${r.candidates[0]!.name}`);
      } else if (r.matchType === 'ambiguous') {
        ambiguous.push({
          name,
          candidates: r.candidates.map(c => `${c.bioguide_id} ${c.name}${c.state ? ' [' + c.state + ']' : ''}`),
        });
      } else {
        unmatched.push(name);
      }
    }

    console.log(`${org}: ${resolved.size}/${names.length} resolved`);
    if (fuzzy.length > 0) {
      console.log(`  fuzzy (last-name-only match, verify):`);
      for (const f of fuzzy) console.log(`    ${f}`);
    }
    if (ambiguous.length > 0) {
      console.log(`  ambiguous (multiple candidates, edit JSON manually):`);
      for (const a of ambiguous) {
        console.log(`    "${a.name}":`);
        for (const c of a.candidates) console.log(`      ${c}`);
      }
    }
    if (unmatched.length > 0) {
      console.log(`  unmatched (not in members table — recent freshman, former member, or name variant):`);
      for (const u of unmatched) console.log(`    "${u}"`);
    }
    console.log('');

    output.caucuses.push({
      org,
      category: 'caucus',
      source_url: SOURCE_URLS[org],
      last_verified: today,
      members: Array.from(resolved).sort(),
    });
  }

  const outPath = path.join('data', 'affiliations-seed.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`\nNext: pnpm seed:affiliations`);
}

main().catch(err => { console.error(err); process.exit(1); });
