import {readFileSync} from 'node:fs';
import {SCENES} from '../dist/terrain/geometry.mjs';
import {atSea} from '../dist/terrain/sea.mjs';
import {locateIncident} from './imo-places.mjs';

// The position a report gives for a ship attack: "about 11 nm west of Bukha",
// even inside longer place text such as "Strait of Hormuz, about 20 nm
// northeast of Khasab". The maps then draw ship attacks at the nearest water.
const OFFSET=/(\d+(?:\.\d+)?)\s*(?:nm|nautical miles?)\s+((?:north|south)(?:[- ]?(?:east|west))?|east|west|[NSEW]{1,3})\s+of\s+([A-Z][A-Za-z'’. -]+?)(?=,|\(|$)/i;
const grids=Object.fromEntries(['hormuz','theatre'].map(id=>[id,{scene:SCENES[id],heights:new Uint16Array(readFileSync(new URL(`../dist/terrain/assets/${id}-dem.bin`,import.meta.url)).buffer.slice(0))}]));
const round=value=>Math.round(value*1e4)/1e4;

/** The bearing-and-distance position stated in the place text, or null. */
export function statedPosition(place){
  const offset=typeof place==='string'?place.match(OFFSET):null;
  if(!offset)return null;
  const located=locateIncident(`${offset[1]} NM ${offset[2]} of ${offset[3].trim()}`);
  return located?.basis==='bearing-distance'?{lat:round(located.lat),lon:round(located.lon),reference:located.reference}:null;
}
/** Maps on which the point falls on land. */
export const landOn=point=>Object.entries(grids).filter(([,g])=>atSea(point,g.scene,g.heights)===false).map(([id])=>id);
