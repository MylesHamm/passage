// Moves curated ship attacks to the position their report states ("about 11 nm
// west of Bukha") instead of the named town. Run before `npm run check:events`.
// Changes only dist/data/war-events.json; prints each change.
import {readFile,writeFile} from 'node:fs/promises';
import {statedPosition} from '../../lib/sea-placement.mjs';

const file=new URL('../../dist/data/war-events.json',import.meta.url);
const data=JSON.parse(await readFile(file,'utf8'));
let changed=0;
for(const event of data.events){
  if(event.layer!=='shipping')continue;
  const stated=statedPosition(event.place);
  if(!stated||(Math.abs(stated.lat-event.lat)<1e-4&&Math.abs(stated.lon-event.lon)<1e-4))continue;
  console.log(`${event.id}: ${event.lat},${event.lon} -> ${stated.lat},${stated.lon} (${event.place})`);
  Object.assign(event,{lat:stated.lat,lon:stated.lon,precision:'sea-area'});changed++;
}
if(changed)await writeFile(file,JSON.stringify(data,null,2)+'\n');
console.log(changed?`Moved ${changed} ship attack(s) to their stated positions.`:'Every ship attack with a stated position already uses it.');
