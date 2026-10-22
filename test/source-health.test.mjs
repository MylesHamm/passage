import test from 'node:test';import assert from 'node:assert/strict';
import {coverage,sourceHealth,ageSeconds,SOURCE_DEFINITIONS} from '../dist/source-health.mjs';
const now=Date.parse('2026-09-13T18:00:00Z');
const connected={connection:'connected',retrievedAt:'2026-09-13T17:00:00Z'};
test('AIS missing provider time is unknown even if receipt is recent',()=>{
 const s=sourceHealth({id:'aisstream',group:'vessels',configured:true,...connected,latest:'2026-09-13T17:59:00Z',timestampBasis:'received',recordCount:1},now);assert.equal(s.freshness,'unknown');assert.equal(s.attention,true);
});
test('ages advance from the clock without refreshing retained source objects',()=>{
 const s={id:'bbc',group:'news',configured:true,...connected,retrievedAt:'2026-09-13T17:59:00Z',recordCount:1,latestRelevant:'2026-09-10T18:00:01Z'};assert.equal(sourceHealth(s,now).status,'current');assert.equal(sourceHealth(s,now+2000).status,'stale');assert.equal(s.freshness,undefined);
});
test('empty labels identify the relevant feed rather than describing every source as vessels',()=>{
 const labels={news:'Source checked · no relevant reports',oil:'No usable price observations',weather:'No usable forecast data',maritime:'Source checked · no listed records'};
 for(const [group,label] of Object.entries(labels)) assert.equal(sourceHealth({id:'example',group,configured:true,...connected,retrievedAt:'2026-09-13T17:59:00Z',recordCount:0},now).label,label);
});
test('an old empty incident register still needs a new source check',()=>{
 const s=sourceHealth({id:'imo-redsea',group:'maritime',configured:true,...connected,retrievedAt:'2026-09-12T17:00:00Z',recordCount:0},now);
 assert.equal(s.status,'stale');assert.equal(s.hasData,false);assert.equal(s.attention,true);
});
test('impossible source calendar dates cannot claim a successful or current check',()=>{const s=sourceHealth({id:'bbc',group:'news',configured:true,connection:'connected',retrievedAt:'2026-02-30T12:00:00Z',recordCount:0},Date.parse('2026-03-02T12:00:00Z'));assert.equal(s.successfulCheck,false);assert.equal(s.status,'unavailable');assert.equal(coverage([s]).empty,false);});

// Rule-level checks for the sources the operations center reads.
const at = Date.parse('2026-10-20T12:00:00Z');
const def = id => SOURCE_DEFINITIONS.find(s => s.id === id);
const iso = ms => new Date(ms).toISOString();
const health = (id, fields) => sourceHealth({ ...def(id), configured: true, connection: 'connected', retrievedAt: iso(at - 60000), recordCount: 5, ...fields }, at);

test('the source list holds exactly the dashboard sources', () => {
  assert.deepEqual(SOURCE_DEFINITIONS.map(s => s.id).sort(), ['aisstream', 'aj', 'bbc', 'brent', 'curated-events', 'eia-today', 'france24', 'imo-hormuz', 'imo-redsea', 'mee', 'memo', 'polymarket', 'portwatch', 'un', 'wti']);
});
test('AIS positions go stale after ten minutes and a missing provider clock is unknown, not current', () => {
  assert.equal(health('aisstream', { latest: iso(at - 5 * 60000), timestampBasis: 'provider' }).status, 'current');
  assert.equal(health('aisstream', { latest: iso(at - 11 * 60000), timestampBasis: 'provider' }).status, 'stale');
  assert.equal(health('aisstream', { latest: iso(at - 60000), timestampBasis: 'received' }).freshness, 'unknown');
  assert.equal(health('aisstream', { connection: 'idle', latest: iso(at - 60000), timestampBasis: 'provider' }).status, 'paused');
});
test('incident registers are fresh by retrieval, independent of how old their events are', () => {
  const recentCheck = health('imo-hormuz', { latest: '2026-09-01' });
  assert.equal(recentCheck.freshness, 'current');
  const oldCheck = health('imo-hormuz', { retrievedAt: iso(at - 25 * 3600000), latest: '2026-10-19' });
  assert.equal(oldCheck.status, 'stale');
});
test('oil and transit freshness follow their own publication cadence', () => {
  assert.equal(health('brent', { latest: '2026-10-14' }).status, 'current', 'a weekly EIA release is not stale at six days');
  assert.equal(health('brent', { latest: '2026-10-05' }).status, 'stale');
  assert.equal(health('portwatch', { latest: '2026-10-18' }).status, 'current');
  assert.equal(health('portwatch', { latest: '2026-10-08' }).status, 'stale', 'a missed weekly PortWatch release shows as delayed');
  assert.equal(health('eia-today', { latest: '2026-10-19' }).status, 'current');
  assert.equal(health('eia-today', { latest: '2026-10-15' }).status, 'stale');
});
test('a failed refresh keeps retained data visible but flagged, and without data is unavailable', () => {
  const retained = health('bbc', { connection: 'cached', latestRelevant: iso(at - 3600000), error: 'upstream' });
  assert.equal(retained.status, 'retained'); assert.equal(retained.attention, true);
  const down = health('bbc', { connection: 'unavailable', recordCount: 0, error: 'upstream' });
  assert.equal(down.status, 'unavailable');
});
test('future timestamps never count as fresh observations', () => {
  assert.equal(ageSeconds(iso(at + 3600000), at), null);
  assert.notEqual(health('brent', { latest: '2026-12-01' }).status, 'current');
});
