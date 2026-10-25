// Checks the curated war-event list the way the live collector will: run it
// before every commit of dist/data/war-events.json. Exits non-zero on failure.
import {readFile} from 'node:fs/promises';
import {parseCuratedEvents} from '../lib/curated-events.mjs';
import {figureWarnings} from '../lib/event-lint.mjs';

const text=await readFile(new URL('../dist/data/war-events.json',import.meta.url),'utf8');
let parsed;
try{parsed=parseCuratedEvents(text);}
catch{console.error('The collector would reject this list: check the schema, the review time and each event.');process.exit(1);}
if(parsed.rejected){console.error(`${parsed.rejected} event(s) break the list rules and would be dropped. Fix or remove them.`);process.exit(1);}
console.log(`Curated list OK: ${parsed.events.length} events, ${parsed.missions.length} missions, reviewed ${parsed.reviewedAt}.`);
// Advisory only, for events from the last week of the review: a headline casualty
// figure the summary never mentions. Check the article body; if it gives a later
// or different figure, the summary should say who gave which.
const since=new Date(Date.parse(parsed.reviewedAt.length===10?parsed.reviewedAt+'T00:00:00Z':parsed.reviewedAt)-7*86_400_000).toISOString().slice(0,10);
for(const warning of parsed.events.filter(e=>e.date>=since).flatMap(figureWarnings))
  console.warn(`Check ${warning.id}: "${warning.publisher}" headline gives ${warning.missing.join(', ')}, which the title and summary do not mention.`);
