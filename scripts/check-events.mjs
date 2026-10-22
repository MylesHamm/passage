// Checks the curated war-event list the way the live collector will: run it
// before every commit of dist/data/war-events.json. Exits non-zero on failure.
import {readFile} from 'node:fs/promises';
import {parseCuratedEvents} from '../lib/curated-events.mjs';

const text=await readFile(new URL('../dist/data/war-events.json',import.meta.url),'utf8');
let parsed;
try{parsed=parseCuratedEvents(text);}
catch{console.error('The collector would reject this list: check the schema, the review time and each event.');process.exit(1);}
if(parsed.rejected){console.error(`${parsed.rejected} event(s) break the list rules and would be dropped. Fix or remove them.`);process.exit(1);}
console.log(`Curated list OK: ${parsed.events.length} events, ${parsed.missions.length} missions, reviewed ${parsed.reviewedAt}.`);
