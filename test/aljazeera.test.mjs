import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAlJazeeraIndex} from '../lib/aljazeera.mjs';
import {reportRelevant} from '../lib/feeds.mjs';

const now=Date.parse('2026-09-30T18:00:00Z');
const post=(overrides={})=>({__typename:'Post',title:'Iran discusses oil shipments through Hormuz',excerpt:'Officials discuss crude tanker access.',date:'2026-09-30T12:05:45',link:'/news/2026/9/30/fixture-hormuz',...overrides});
function page(posts,extra={}){
 const state={ROOT_QUERY:{'posts({"category":"middle-east","categoryType":"where","first":10})':posts.map((_,i)=>({__ref:'Post:'+i}))},...Object.fromEntries(posts.map((value,i)=>['Post:'+i,value])),...extra};
 return `<html><script>window.__APOLLO_STATE__="${Buffer.from(JSON.stringify(state)).toString('base64')}";</script></html>`;
}
test('regional index recovers attributed reporting outside the global RSS window',()=>{
 const [row]=parseAlJazeeraIndex(page([post()],{'Post:unlisted':post({title:'Unlisted Iran headline'})}),now);
 assert.equal(row.title,post().title);assert.equal(row.sourceId,'aj');assert.equal(row.publisher,'Al Jazeera');
 assert.equal(row.summary,post().excerpt);assert.equal(row.url,'https://www.aljazeera.com/news/2026/9/30/fixture-hormuz');
 assert.ok(reportRelevant(row));assert.deepEqual(row.theaters,['hormuz']);assert.ok(row.actors.includes('Iran'));
 assert.equal(row.publishedDate,'2026-09-30');assert.equal(row.publishedAt,'2026-09-30T00:00:00.000Z');
 assert.equal(row.publicationPrecision,'day');assert.equal(row.dateBasis,'publisher-date');assert.match(row.dateNote,/timezone/);
 assert.equal(row.eventDate,null);assert.equal(row.discoveredAt,null);assert.equal(row.contentAccess,'publisher-summary');
});
test('explicit provider timezone retains an exact timestamp without guessing the timezone of local dates',()=>{
 const [row]=parseAlJazeeraIndex(page([post({date:'2026-09-30T15:05:45+03:00'})]),now);
 assert.equal(row.publishedAt,'2026-09-30T12:05:45.000Z');assert.equal(row.publicationPrecision,'timestamp');assert.equal(row.dateBasis,'publisher-publication');
 assert.equal(row.publishedDate,undefined);
});
test('regional index does not widen relevance or read unrelated embedded state',()=>{
 const rows=parseAlJazeeraIndex(page([post({title:'Local gardening exhibition opens',excerpt:'Community gardens.'})],{'Post:unlisted':post()}),now);
 assert.equal(rows.length,1);assert.equal(reportRelevant(rows[0]),false);
});
test('missing or changed regional index markup fails visibly instead of succeeding empty',()=>{
 for(const html of ['<html>Blocked</html>','<script>window.__APOLLO_STATE__="e30=";</script>',page([]),page([post()],{ROOT_QUERY:{'posts({"category":"sports","categoryType":"where"})':[{__ref:'Post:0'}]}})])assert.throws(()=>parseAlJazeeraIndex(html,now),/index|metadata/);
 const missing=page([post()],{'Post:0':null});assert.throws(()=>parseAlJazeeraIndex(missing,now),/metadata/);
});
test('invalid dates, future publications and unsafe or off-publisher links are rejected',()=>{
 for(const date of ['2026-02-30T12:00:00','2026-10-01T01:00:00','2026-09-30T25:00:00','not-a-date'])assert.throws(()=>parseAlJazeeraIndex(page([post({date})]),now),/metadata/);
 for(const link of ['https://example.com/news/2026/9/30/foo','https://user:password@www.aljazeera.com/news/2026/9/30/foo','javascript:alert(1)','/middle-east/'])assert.throws(()=>parseAlJazeeraIndex(page([post({link})]),now),/metadata/);
});
test('index metadata is bounded, deduplicated and strips markup without fetching article bodies',()=>{
 const row=post({title:'<b>Iran</b> &amp; Hormuz',excerpt:'<script>doSomething()</script><p>Public oil preview.</p>',featuredImage:{url:'https://example.com/image'}});
 const rows=parseAlJazeeraIndex(page([row,row]),now);assert.equal(rows.length,1);assert.equal(rows[0].title,'Iran & Hormuz');assert.equal(rows[0].summary,'Public oil preview.');
 assert.ok(!JSON.stringify(rows).includes('featuredImage'));assert.throws(()=>parseAlJazeeraIndex(page(Array.from({length:101},()=>row)),now),/index/);
});
