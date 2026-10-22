import {SourceError} from './source-runtime.mjs';
import {curatedEvents,curatedMissions} from '../dist/ops/events.mjs';

// The curated war-event list lives in the repository. The collector reads the
// published file, so an update reaches the page without republishing the site.
export const CURATED_EVENTS_URL='https://raw.githubusercontent.com/MylesHamm/passage/main/dist/data/war-events.json';
export const CURATED_EVENTS_SCHEMA='passage-war-events/v1';
// A list in which more than this share of events fails the rules is rejected
// whole, and the last good copy stays in service.
const MAX_REJECTED_SHARE=.1;

const reviewTime=(value,now)=>{
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d(?:\.\d+)?)?Z)?$/.test(value))return null;
  const ms=Date.parse(value.length===10?value+'T00:00:00Z':value);
  return Number.isFinite(ms)&&ms<=now+300000?value:null;
};

/** Checks a published list before it replaces the last good copy. */
export function parseCuratedEvents(text,{now=Date.now()}={}){
  let json;
  try{json=JSON.parse(text);}catch{throw new SourceError('schema');}
  const reviewedAt=reviewTime(json?.reviewedAt,now);
  if(json?.schema!==CURATED_EVENTS_SCHEMA||!reviewedAt||!Array.isArray(json.events)||!json.events.length)throw new SourceError('schema');
  const today=new Date(now).toISOString().slice(0,10);
  const events=json.events.filter(e=>curatedEvents({events:[e]},{today}).length===1);
  const missions=(Array.isArray(json.missions)?json.missions:[]).filter(m=>curatedMissions({missions:[m]}).length===1);
  if(!events.length||(json.events.length-events.length)/json.events.length>MAX_REJECTED_SHARE)throw new SourceError('schema');
  return {schema:CURATED_EVENTS_SCHEMA,reviewedAt,basis:typeof json.basis==='string'?json.basis.slice(0,240):'',events,missions,rejected:json.events.length-events.length};
}
