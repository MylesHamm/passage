import test from 'node:test';
import assert from 'node:assert/strict';
import {DISCOVERY_SOURCES,RETIRED_DISCOVERY_SOURCES,parseDiscovery} from '../lib/discovery.mjs';
const now=Date.parse('2026-09-17T12:00:00Z'),feed={id:'gdelt-hormuz'};
test('all discovery families are historical identities, with no active collector definitions',()=>{
  assert.deepEqual(DISCOVERY_SOURCES,[]);
  assert.deepEqual(RETIRED_DISCOVERY_SOURCES,['gdelt-hormuz','gdelt-redsea','gdelt-exports','gdelt-energy','gdelt-reuters']);
});

test('GDELT index time is not promoted to publication or event time',()=>{
  const payload={articles:[{url:'https://www.reuters.com/world/story',title:'Saudi tanker exports through Hormuz face disruption',seendate:'20260917T111500Z',domain:'evil.example',language:'English',sourcecountry:'United Kingdom'}]};
  const [row]=parseDiscovery(payload,feed,now);assert.equal(row.publishedAt,null);assert.equal(row.eventDate,null);assert.equal(row.discoveredAt,'2026-09-17T11:15:00.000Z');assert.equal(row.dateBasis,'discovery');assert.equal(row.contentAccess,'discovery-metadata');assert.equal(row.publisher,'Reuters');assert.deepEqual(row.theaters,['hormuz']);assert.ok(row.relevanceScopes.includes('regional-energy'));assert.equal(row.summary,null);
});
test('bad dates, sensitive URLs and schema errors do not appear as verified metadata',()=>{
  assert.throws(()=>parseDiscovery({error:'Rate limited'},feed,now),/schema/);
  assert.equal(parseDiscovery({articles:[]},feed,now).length,0);
  const rows=parseDiscovery({articles:[{title:'Iran war',url:'https://x.example/?token=private',seendate:'20260917T110000Z'},{title:'Iran war',url:'https://x.example/a',seendate:'20260999T110000Z'},{title:'Iran war',url:'https://x.example/b',seendate:'20260918T110000Z'}]},feed,now);assert.equal(rows.length,0);
});
test('Doomberg discovery is analysis metadata without inventing a fetched preview or publication',()=>{
 const urls=['https://newsletter.doomberg.com/p/example','https://newsletter.doomberg.com.evil.example/p/example'];
 const rows=parseDiscovery({articles:urls.map(url=>({url,title:'Iran oil tanker supplies and diesel refining',seendate:'20260917T110000Z'}))},feed,now);
 const [analysis,other]=rows;
 assert.equal(analysis.type,'Independent energy analysis');assert.equal(analysis.publisher,'Doomberg');assert.match(analysis.evidenceStatus,/analysis/i);
 assert.equal(analysis.contentAccess,'discovery-metadata');assert.equal(analysis.summary,null);assert.equal(analysis.publishedAt,null);assert.equal(analysis.eventDate,null);
 assert.equal(analysis.discoveredAt,'2026-09-17T11:00:00.000Z');assert.equal(analysis.sourceId,feed.id);assert.equal(analysis.discoveryProvider,'GDELT');
 assert.equal(other.type,'Discovered reporting');
});
