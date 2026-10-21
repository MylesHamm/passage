import test from 'node:test';import assert from 'node:assert/strict';
import {SourceRuntime} from '../lib/source-runtime.mjs';
import {ReportArchive} from '../lib/report-archive.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadReporting,deduplicateReports} from '../lib/reporting.mjs';
import {SOURCE_DEFINITIONS} from '../dist/source-health.mjs';
import {SOURCES} from '../lib/feeds.mjs';
import {AL_JAZEERA_INDEX} from '../lib/aljazeera.mjs';

const now=Date.parse('2026-09-17T12:00:00Z');
const storage={readFile:async()=>{throw Object.assign(Error(),{code:'ENOENT'});},mkdir:async()=>{},writeFile:async()=>{}};
const xml='<rss><channel><item><title>Saudi oil pipeline exports disrupted</title><link>https://example.com/pipeline</link><pubDate>Thu, 17 Sep 2026 10:00:00 GMT</pubDate><description>Aramco discusses crude deliveries.</description></item></channel></rss>';
const ajIndex=(posts)=>`<script>window.__APOLLO_STATE__="${Buffer.from(JSON.stringify({ROOT_QUERY:{'posts({"category":"middle-east","categoryType":"where"})':posts.map((_,i)=>({__ref:'Post:'+i}))},...Object.fromEntries(posts.map((p,i)=>['Post:'+i,{__typename:'Post',...p}]))})).toString('base64')}";</script>`;
test('Al Jazeera regional index supplies current reports after the global feed rotates past them',async()=>{
 const current=Date.parse('2026-09-30T18:00:00Z'),requests=[];
 const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>current,fetchImpl:async url=>{
  const address=new URL(url).href;requests.push(address);
  if(address===AL_JAZEERA_INDEX)return new Response(ajIndex([{title:'Iran reviews oil tanker access through Hormuz',excerpt:'Officials discuss shipping access.',link:'/news/2026/9/30/fixture-index',date:'2026-09-30T12:05:45'},{title:'Gaza hospital conditions',excerpt:'Public interactive preview.',link:'https://interactive.aljazeera.com/aje/2026/gaza-hospitals/',date:'2026-09-30T11:00:00'}]));
  if(address===SOURCES.find(source=>source.id==='aj').url)return new Response('<rss><channel><item><title>Local gardening exhibition opens</title><link>https://www.aljazeera.com/news/2026/9/30/fixture-gardens</link><pubDate>Wed, 30 Sep 2026 17:00:00 GMT</pubDate></item></channel></rss>');
  return new Response('Unavailable',{status:503});
 }});
 const result=await loadReporting(runtime,{includeReviewedContext:false,discoveryWaitMs:30000,discoverySpacingMs:0}),source=result.sources.find(s=>s.id==='aj');
 assert.equal(result.items.length,1);assert.equal(result.items[0].sourceId,'aj');assert.equal(result.items[0].publicationPrecision,'day');
 assert.equal(source.status,'current');assert.equal(source.recordCount,1);assert.equal(source.parsedCount,3);assert.equal(source.latestRelevant,'2026-09-30T00:00:00.000Z');
 assert.equal(source.access,'Publisher RSS + public regional index');assert.equal(source.publicationPrecision,'mixed');assert.equal(result.coverage.complete,false);
 assert.equal(requests.filter(url=>new URL(url).hostname==='www.aljazeera.com').length,2);
 assert.ok(!requests.some(url=>new URL(url).hostname==='interactive.aljazeera.com'));
});
for(const failure of ['index-http','index-markup','rss-http'])test(`Al Jazeera ${failure} failure retains the complete dated source snapshot`,async()=>{
 const current=Date.parse('2026-09-30T18:00:00Z');let clock=current,failed=false;
 const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>clock,fetchImpl:async url=>{
  const address=new URL(url).href;
  if(address===AL_JAZEERA_INDEX){
   if(failed&&failure==='index-http')return new Response('Unavailable',{status:503});
   if(failed&&failure==='index-markup')return new Response('<html>Changed markup</html>');
   return new Response(ajIndex([{title:'Iran discusses Hormuz shipping',excerpt:'Regional index preview.',link:'/news/2026/9/30/fixture-shared',date:'2026-09-30T12:05:45'},{title:'Houthis issue Red Sea shipping statement',excerpt:'The group issued a statement.',link:'/news/2026/9/30/fixture-regional',date:'2026-09-30T11:00:00'}]));
  }
  if(address===SOURCES.find(source=>source.id==='aj').url){
   if(failed&&failure==='rss-http')return new Response('Unavailable',{status:503});
   return new Response(`<rss><channel><item><title>Iran discusses Hormuz shipping</title><link>https://www.aljazeera.com/news/2026/9/30/fixture-shared</link><pubDate>Wed, 30 Sep 2026 ${failed?'18:01:00':'12:05:45'} GMT</pubDate><description>RSS preview with an exact timestamp.</description></item></channel></rss>`);
  }
  return new Response('Unavailable',{status:503});
 }});
 const options={includeReviewedContext:false,discoveryWaitMs:30000,discoverySpacingMs:0};
 const first=await loadReporting(runtime,options),shared=first.items.find(row=>row.url.endsWith('/fixture-shared'));
 assert.equal(first.items.length,2);assert.equal(shared.publishedAt,'2026-09-30T12:05:45.000Z');assert.equal(shared.publicationPrecision,'timestamp');assert.equal(shared.summary,'RSS preview with an exact timestamp.');
 assert.equal(first.sources.find(s=>s.id==='aj').recordCount,2);
 clock+=301000;failed=true;
 const next=await loadReporting(runtime,options),source=next.sources.find(s=>s.id==='aj');
 assert.equal(source.connection,'cached');assert.equal(source.status,'retained');assert.equal(source.attention,true);assert.equal(source.retrievedAt,new Date(current).toISOString());assert.equal(source.checkedAt,new Date(clock).toISOString());
 assert.equal(source.errorCategory,failure==='index-markup'?'schema':'upstream_http');
 assert.deepEqual(next.items,first.items);assert.equal(source.recordCount,2);
});
test('aggregated reporting keeps regional context, source provenance and per-source failures',async()=>{
 const urls=[];const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>now,fetchImpl:async(url)=>{
   const u=new URL(url);urls.push(u.href);
   if(u.hostname==='news.un.org')return new Response('Service unavailable',{status:503});
   return new Response(xml);
 }});
 let result=await loadReporting(runtime,{},{});
 assert.ok(result.items.some(x=>x.relevanceScopes.includes('regional-energy')&&x.theaters.length===0));
 assert.equal(result.sources.find(x=>x.id==='un').connection,'unavailable');
 assert.deepEqual(result.sources.map(x=>x.id).sort(),['aj','bbc','france24','mee','memo','un']);
 assert.ok(!urls.some(url=>/gdeltproject|centcom|reliefweb|doomberg/.test(url)),'retired sources are never requested');
 assert.equal(result.coverage.complete,false);
 const pipeline=result.items.find(x=>x.url==='https://example.com/pipeline');
 assert.ok(pipeline.provenance.length>1,'the same article from several publishers keeps each provenance entry');
 assert.ok(pipeline.publishedAt);
 assert.ok(result.sources.every(x=>!('items' in x)));assert.ok(urls.every(x=>!x.includes('example.com')));
 const previous=urls.length;result=await loadReporting(runtime,{},{});assert.equal(urls.length,previous,'a second call is served from cache');
});
test('regional publisher failure retains dated records without disguising an outage as fresh coverage',async()=>{
 const current=Date.parse('2026-09-28T18:00:00Z');let tick=current,failed=false;
 const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>tick,fetchImpl:async url=>{
  if(new URL(url).hostname!=='www.middleeasteye.net'||failed)return new Response('Unavailable',{status:503});
  return new Response('<rss><channel><item><title>Tehran says oil tanker seized</title><link>https://www.middleeasteye.net/news/fixture-retained</link><pubDate>Mon, 28 Sep 2026 17:30:00 GMT</pubDate><description>Authorities made the claim.</description></item></channel></rss>');
 }});
 const options={includeReviewedContext:false,discoveryWaitMs:30000,discoverySpacingMs:0};
 const first=await loadReporting(runtime,options),record=first.items.find(item=>item.sourceId==='mee');
 assert.ok(record);assert.equal(first.sources.find(source=>source.id==='mee').status,'current');
 tick+=3601000;failed=true;
 const retained=await loadReporting(runtime,options),source=retained.sources.find(source=>source.id==='mee');
 assert.equal(source.status,'retained');assert.equal(source.connection,'cached');assert.equal(source.retrievedAt,new Date(current).toISOString());assert.equal(source.checkedAt,new Date(tick).toISOString());
 assert.equal(retained.items.find(item=>item.id===record.id).publishedAt,record.publishedAt);assert.equal(retained.items.find(item=>item.id===record.id).title,record.title);
 assert.equal(source.attention,true);assert.equal(retained.coverage.complete,false);
});
test('deduplication preserves publication metadata over discovery without claiming independent confirmation',()=>{
 const a={id:'rss',url:'https://example.com/story?utm_source=rss',sourceId:'bbc',publisher:'BBC',publishedAt:'2026-09-17T10:00:00Z',discoveredAt:null,dateBasis:'publisher-publication'};
 const b={id:'index',url:'https://example.com/story',sourceId:'gdelt-hormuz',publisher:'example.com',publishedAt:null,discoveredAt:'2026-09-17T11:00:00Z',dateBasis:'discovery'};
 const [row]=deduplicateReports([b,a]);assert.equal(row.id,'rss');assert.equal(row.provenance.length,2);assert.equal(row.discoveredAt,b.discoveredAt);assert.equal(row.dateBasis,a.dateBasis);assert.equal(row.independentConfirmationCount,undefined);
});
test('upgrade keeps original cache keys and retains dated headlines during an outage',async()=>{
 const saved={checkedAt:'2026-09-16T10:00:00Z',retrievedAt:'2026-09-16T10:00:00Z',items:[{id:'legacy',title:'Houthi Red Sea shipping report',url:'https://example.com/old',publishedAt:'2026-09-16T09:00:00Z',source:'BBC Middle East',sourceId:'bbc',type:'Reporting',theaters:['bab'],actors:['Houthis'],energy:false}]};
 const legacyStorage={...storage,readFile:async(file)=>{if(file.endsWith('/bbc.json'))return JSON.stringify(saved);throw Object.assign(Error(),{code:'ENOENT'});}};
 const runtime=new SourceRuntime({cacheDir:'/unused',storage:legacyStorage,now:()=>now,fetchImpl:async()=>new Response('Unavailable',{status:503})});
 const result=await loadReporting(runtime,{discoveryWaitMs:30000,discoverySpacingMs:0},{});
 assert.equal(result.sources.find(s=>s.id==='bbc').status,'retained');const old=result.items.find(x=>x.id==='legacy');assert.ok(old);assert.equal(old.contentAccess,'headline-only');assert.equal(old.dateBasis,'publisher-publication');assert.ok(old.matchEvidence.length);
});
test('retained archive applies current petroleum relevance without changing evidence clocks',async()=>{
 const rows=[
  {id:'food',title:'Crude palm oil prices rise',url:'https://example.com/food',energy:true,relevanceScopes:['global-energy'],theaters:[],actors:[]},
  {id:'fuel',title:'Brent oil prices rise',url:'https://example.com/fuel',energy:true,relevanceScopes:['global-energy'],theaters:[],actors:[],firstSeenAt:'2026-09-15T10:00:00Z',lastSeenAt:'2026-09-16T10:00:00Z',publishedAt:'2026-09-15T09:00:00Z',retainedFromHistory:true},
 ];
 const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>now,fetchImpl:async()=>new Response('Unavailable',{status:503})});
 const result=await loadReporting(runtime,{discoveryWaitMs:30000,discoverySpacingMs:0,reportArchive:{merge:async()=>({items:rows,archive:{retainedCount:2}})}},{});
 assert.equal(result.items.some(row=>row.id==='food'),false);
 const fuel=result.items.find(row=>row.id==='fuel');assert.equal(fuel.firstSeenAt,rows[1].firstSeenAt);assert.equal(fuel.lastSeenAt,rows[1].lastSeenAt);assert.equal(fuel.publishedAt,rows[1].publishedAt);assert.equal(fuel.retainedFromHistory,true);
 assert.equal(rows[0].energy,true); // Display filtering does not erase the retained archive.
});
test('same publisher tracking aliases collapse to the exact RSS publication clock in either input order',()=>{
  const url='https://www.aljazeera.com/news/2026/10/19/shabwa',precise={id:'rss',url:url+'?traffic_source=rss',sourceId:'aj',source:'Al Jazeera',title:'Houthi attack kills at least 53: reports',publishedAt:'2026-10-19T12:51:46.000Z',publicationPrecision:'timestamp',dateBasis:'publisher-publication',summary:'Publisher RSS preview.',eventDate:null};
  const day={...precise,id:'index',url,title:'Houthi attack reportedly kills at least 53',publishedAt:'2026-10-19T00:00:00.000Z',publishedDate:'2026-10-19',publicationPrecision:'day',dateBasis:'publisher-date',summary:'Index preview.'};
  for(const records of [[precise,day],[day,precise]]){
    const rows=deduplicateReports(records),row=rows[0];assert.equal(rows.length,1);assert.equal(row.url,url);assert.equal(row.id,'rss');assert.equal(row.title,precise.title);assert.equal(row.publishedAt,precise.publishedAt);assert.equal(row.publicationPrecision,'timestamp');assert.equal(row.summary,precise.summary);assert.equal(row.eventDate,null);assert.equal(row.provenance.length,1);assert.equal(row.provenance[0].publishedAt,precise.publishedAt);
  }
});
test('cached and archived publisher markup is cleaned without inventing missing excerpt text or new clocks',async()=>{
  const savedAt='2026-09-16T10:00:00Z',base={id:'old',title:'Houthi shipping report',url:'https://example.com/old',sourceId:'bbc',source:'BBC',type:'Reporting',publishedAt:'2026-09-16T09:00:00Z',summary:'<article data-id="1"><a href="https://example.com/truncated…'};
  const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>now,fetchImpl:async()=>new Response('Unavailable',{status:503})});runtime.memory.set('bbc',{items:[base],retrievedAt:savedAt,checkedAt:savedAt,connection:'cached'});
  const result=await loadReporting(runtime,{includeReviewedContext:false,reportArchive:{merge:async items=>({items:[...items,{...base,id:'archive',url:'https://example.com/archive',summary:'&lt;p&gt;Older publisher text.&lt;/p&gt;',lastSeenAt:savedAt,retainedFromHistory:true}],archive:{}})}});
  const cached=result.items.find(row=>row.id==='old'),archived=result.items.find(row=>row.id==='archive');assert.equal(cached.summary,null);assert.equal(cached.publishedAt,base.publishedAt);assert.equal(result.sources.find(source=>source.id==='bbc').retrievedAt,savedAt);assert.equal(archived.summary,'Older publisher text.');assert.equal(archived.lastSeenAt,savedAt);
});
