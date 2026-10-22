import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCuratedEvents,CURATED_EVENTS_URL} from '../lib/curated-events.mjs';

const NOW=Date.parse('2026-10-22T14:00:00Z');
const source={publisher:'Reuters',title:'Report',url:'https://www.reuters.com/x',date:'2026-10-21'};
const event=(id,fields={})=>({id,date:'2026-10-21',time:null,layer:'shipping',type:'shipping-attack',actor:'Unknown',target:'Tanker',place:'Strait of Hormuz',country:'',lat:26.5,lon:56.3,precision:'sea-area',confidence:'confirmed',title:'Tanker hit',summary:'A tanker was hit.',sources:[source],...fields});
const list=(events,fields={})=>JSON.stringify({schema:'passage-war-events/v1',reviewedAt:'2026-10-22T13:00:00Z',basis:'Curated',events,missions:[],...fields});

test('the collector reads the published file on main',()=>{
  assert.equal(CURATED_EVENTS_URL,'https://raw.githubusercontent.com/MylesHamm/passage/main/dist/data/war-events.json');
});

test('a valid list passes with a review time, date or date-time',()=>{
  const parsed=parseCuratedEvents(list([event('a'),event('b')]),{now:NOW});
  assert.equal(parsed.events.length,2);assert.equal(parsed.reviewedAt,'2026-10-22T13:00:00Z');assert.equal(parsed.rejected,0);
  assert.equal(parseCuratedEvents(list([event('a')],{reviewedAt:'2026-10-21'}),{now:NOW}).reviewedAt,'2026-10-21');
});

test('a few bad events are dropped, but a list that is mostly broken is rejected whole',()=>{
  const twenty=Array.from({length:20},(_,i)=>event('e'+i));
  const oneBad=[...twenty.slice(0,19),event('bad',{sources:[]})];
  assert.equal(parseCuratedEvents(list(oneBad),{now:NOW}).events.length,19);
  const manyBad=[...twenty.slice(0,15),...Array.from({length:5},(_,i)=>event('bad'+i,{lat:NaN}))];
  assert.throws(()=>parseCuratedEvents(list(manyBad),{now:NOW}),{name:'SourceError'});
});

test('wrong schema, a future or missing review time, no events or broken JSON are rejected',()=>{
  for(const text of [list([event('a')],{schema:'other'}),list([event('a')],{reviewedAt:'2026-10-23T00:00:00Z'}),list([event('a')],{reviewedAt:null}),list([]),'{nope'])
    assert.throws(()=>parseCuratedEvents(text,{now:NOW}),{name:'SourceError'},text.slice(0,40));
});
