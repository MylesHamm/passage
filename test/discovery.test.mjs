import test from 'node:test';
import assert from 'node:assert/strict';
import {DISCOVERY_SOURCES,discoveryUrl,parseDiscovery,loadDiscovery} from '../lib/discovery.mjs';
import {SourceRuntime} from '../lib/source-runtime.mjs';

const now=Date.parse('2026-09-17T12:00:00Z'),feed=DISCOVERY_SOURCES[0];
test('fixed discovery requests stay bounded on the documented API',()=>{
  assert.equal(DISCOVERY_SOURCES.length,5);
  for(const source of DISCOVERY_SOURCES){const u=discoveryUrl(source);assert.equal(u.origin,'https://api.gdeltproject.org');assert.equal(u.searchParams.get('mode'),'artlist');assert.equal(u.searchParams.get('maxrecords'),'250');assert.equal(u.searchParams.get('timespan'),'7d');assert.equal(source.interval,900);}
  assert.throws(()=>discoveryUrl({id:'arbitrary',query:'secret'}),/Unknown/);
});
test('GDELT index time is not promoted to publication or event time',()=>{
  const payload={articles:[{url:'https://www.reuters.com/world/story',title:'Saudi export pipeline faces disruption',seendate:'20260917T111500Z',domain:'evil.example',language:'English',sourcecountry:'United Kingdom'}]};
  const [row]=parseDiscovery(payload,feed,now);assert.equal(row.publishedAt,null);assert.equal(row.eventDate,null);assert.equal(row.discoveredAt,'2026-09-17T11:15:00.000Z');assert.equal(row.dateBasis,'discovery');assert.equal(row.contentAccess,'discovery-metadata');assert.equal(row.publisher,'Reuters');assert.deepEqual(row.theaters,[]);assert.ok(row.relevanceScopes.includes('regional-energy'));assert.equal(row.summary,null);
});
test('bad dates, sensitive URLs and schema errors do not appear as verified metadata',()=>{
  assert.throws(()=>parseDiscovery({error:'Rate limited'},feed,now),/schema/);
  assert.equal(parseDiscovery({articles:[]},feed,now).length,0);
  const rows=parseDiscovery({articles:[{title:'Iran war',url:'https://x.example/?token=private',seendate:'20260917T110000Z'},{title:'Iran war',url:'https://x.example/a',seendate:'20260999T110000Z'},{title:'Iran war',url:'https://x.example/b',seendate:'20260918T110000Z'}]},feed,now);assert.equal(rows.length,0);
});
test('serialized background discovery returns truthful loading before results and refresh joins',async()=>{
  const values=new Map();let active=0,peak=0,calls=0;
  const runtime={now:()=>now,peek:id=>values.get(id),get:async(id,interval,loader)=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));const data=await loader({fetchText:async()=>JSON.stringify({articles:[]})});active--;const value={...data,id,connection:'connected',retrievedAt:new Date(now).toISOString()};values.set(id,value);return value;}};
  const early=await loadDiscovery(runtime,{}, {waitMs:0,spacingMs:0});assert.ok(early.every(s=>s.connection==='loading'));
  const final=await loadDiscovery(runtime,{}, {waitMs:200,spacingMs:0});assert.ok(final.every(s=>s.connection==='connected'));assert.equal(peak,1);assert.equal(calls,5);
});
test('a provider rate limit stops the remaining query families until a later poll',async()=>{
 const values=new Map();let calls=0;const runtime={now:()=>now,peek:id=>values.get(id),get:async(id)=>{calls++;const result={id,connection:'unavailable',errorCategory:'rate_limit',nextRetryAt:'2026-09-17T12:05:00Z'};values.set(id,result);return result;}};
 const rows=await loadDiscovery(runtime,{}, {waitMs:100,spacingMs:0});assert.equal(calls,1);assert.ok(rows.every(x=>x.errorCategory==='rate_limit'&&x.delayed===true));assert.ok(rows.slice(1).every(x=>x.connection==='unavailable'));
});
test('a rate limit in a later family delays every family through the shared deadline without losing cached data',async()=>{
 let clock=now,blocked=true;const requests=[];
 const storage={readFile:async()=>{throw Object.assign(Error(),{code:'ENOENT'});},mkdir:async()=>{},writeFile:async()=>{}};
 const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>clock,fetchImpl:async url=>{
   const query=new URL(url).searchParams.get('query');requests.push(query);
   if(blocked&&query.startsWith('(Houthi'))return new Response('Rate limited',{status:429,headers:{'retry-after':'7200'}});
   return new Response(JSON.stringify({articles:[{url:'https://example.com/hormuz',title:'Hormuz oil exports',seendate:'20260917T110000Z'}]}));
 }});
 const options={waitMs:100,spacingMs:0};
 const first=await loadDiscovery(runtime,{},options);assert.equal(requests.length,2);assert.equal(first[0].items.length,1);assert.equal(first[0].connection,'cached');assert.equal(first[0].delayed,true);
 const checkedAt=first[0].checkedAt,deadline='2026-09-17T14:00:00.000Z';assert.ok(first.every(row=>row.nextRetryAt===deadline));
 clock+=901000;
 const delayed=await loadDiscovery(runtime,{},options);assert.equal(requests.length,2);assert.equal(delayed[0].items.length,1);assert.equal(delayed[0].checkedAt,checkedAt);assert.match(delayed[0].error,/provider.*rate limit/i);
 clock=Date.parse(deadline);blocked=false;
 const resumed=await loadDiscovery(runtime,{},options);assert.equal(requests.length,7);assert.ok(resumed.every(row=>row.connection==='connected'&&!row.delayed));
});

test('Reuters topic discovery is exact-domain, keeps matching metadata and retains the documented 250-record bound',()=>{
 const source=DISCOVERY_SOURCES.find(row=>row.id==='gdelt-reuters');assert.ok(source);
 const query=discoveryUrl(source).searchParams.get('query');assert.match(query,/domainis:reuters\.com/);assert.match(query,/Houthis/);assert.match(query,/Yemen/);assert.match(query,/Iran/);
 const articles=Array.from({length:250},(_,index)=>({title:'Houthis and Yemen shipping report',url:`https://www.reuters.com/world/report-${index}/`,seendate:'20260917T110000Z'}));
 const rows=parseDiscovery({articles},source,now);assert.equal(rows.length,250);assert.equal(rows.at(-1).publisher,'Reuters');assert.ok(rows.every(row=>row.publicationPrecision==='unknown'&&row.theaters.includes('bab')));
 assert.throws(()=>parseDiscovery({articles:[...articles,articles[0]]},source,now),/schema/);
 assert.equal(parseDiscovery({articles:[{...articles[0],title:'Sports results'},{...articles[0],url:'https://notreuters.example/story'}]},source,now).length,0);
});
test('old 75-result snapshots keep their actual capacity until a successful refresh',async()=>{
 const stamp=new Date(now).toISOString();
 const saved={checkedAt:stamp,retrievedAt:stamp,nextRetryAt:new Date(now+900000).toISOString(),connection:'connected',items:[],recordCount:0,resultLimit:75,possiblyTruncated:true};
 const storage={readFile:async()=>JSON.stringify(saved),mkdir:async()=>{},writeFile:async()=>{}};
 const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>now,fetchImpl:async()=>{throw Error('Fresh cache should be used');}});
 const rows=await loadDiscovery(runtime,{}, {waitMs:100,spacingMs:0});
 assert.equal(rows.length,5);assert.ok(rows.every(row=>row.resultLimit===75&&row.possiblyTruncated===true));
});
test('after a shared rate limit expires, never-attempted families get a turn before recently attempted families',async()=>{
 let clock=now,blocked=true;const requests=[];
 const storage={readFile:async()=>{throw Object.assign(Error(),{code:'ENOENT'});},mkdir:async()=>{},writeFile:async()=>{}};
 const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>clock,fetchImpl:async url=>{
   const query=new URL(url).searchParams.get('query');requests.push(query);
   if(blocked)return new Response('Rate limited',{status:429,headers:{'retry-after':'60'}});
   return new Response(JSON.stringify({articles:[]}));
 }});
 const options={waitMs:100,spacingMs:0};
 await loadDiscovery(runtime,{},options);assert.equal(requests.length,1);
 clock+=30000;await loadDiscovery(runtime,{},options);assert.equal(requests.length,1);
 clock+=270000;blocked=false;
 const rows=await loadDiscovery(runtime,{},options);
 assert.equal(requests[1],DISCOVERY_SOURCES[1].query);assert.equal(requests.at(-1),DISCOVERY_SOURCES[0].query);
 assert.ok(rows.every(row=>row.connection==='connected'&&row.resultLimit===250));
});
test('discovery attempts oldest checked family first and rechecks spacing after early timer wakes',async()=>{
 let elapsed=0;const waits=[];
 const values=new Map(DISCOVERY_SOURCES.map((source,index)=>[source.id,{checkedAt:new Date(now-index*60000).toISOString()}]));const starts=[];
 const runtime={now:()=>now,peek:id=>values.get(id),get:async(id,interval,loader)=>{const data=await loader({fetchText:async()=>{starts.push({id,at:elapsed});return JSON.stringify({articles:[]});}});const value={...data,id,checkedAt:new Date(now).toISOString(),retrievedAt:new Date(now).toISOString(),connection:'connected'};values.set(id,value);return value;}};
 const timing={monotonicNow:()=>elapsed,sleep:async ms=>{waits.push(ms);elapsed+=ms>2?ms-2:ms;}};
 await loadDiscovery(runtime,{}, {waitMs:500,spacingMs:15,...timing});
 assert.deepEqual(starts.map(row=>row.id),DISCOVERY_SOURCES.map(row=>row.id).reverse());
 assert.ok(starts.slice(1).every((row,index)=>row.at-starts[index].at>=15));
 assert.deepEqual(waits,[15,2,15,2,15,2,15,2]);
});
test('discovery spacing survives consecutive polls independently of wall-clock corrections',async()=>{
 let elapsed=0,wall=now,lastId;const starts=[],values=new Map();
 const runtime={now:()=>wall,peek:id=>values.get(id),get:async(id,interval,loader)=>{
   const data=await loader({fetchText:async()=>{lastId=id;starts.push(elapsed);return JSON.stringify({articles:[]});}});
   const value={...data,id,checkedAt:new Date(wall).toISOString(),retrievedAt:new Date(wall).toISOString(),connection:'connected'};
   values.set(id,value);return value;
 }};
 const options={waitMs:500,spacingMs:6000,monotonicNow:()=>elapsed,sleep:async ms=>{elapsed+=ms;wall+=starts.length%2?3600000:-7200000;}};
 await loadDiscovery(runtime,{},options);
 await loadDiscovery(runtime,{},options);
 assert.equal(starts.length,10);
 assert.ok(starts.slice(1).every((at,index)=>at-starts[index]>=6000));
 assert.equal(elapsed,54000);
 assert.equal(values.get(lastId).retrievedAt,new Date(wall).toISOString());
});
test('restart restores every family cache before a shared provider limit can stop discovery',async()=>{
 const savedAt='2026-09-16T10:00:00.000Z',files=new Map(),reads=[],requests=[];
 for(const source of DISCOVERY_SOURCES.filter(source=>source.id!=='gdelt-reuters'))files.set('/cache/'+source.id+'-metadata.json',JSON.stringify({
   id:source.id,checkedAt:savedAt,retrievedAt:savedAt,nextRetryAt:'2026-09-16T10:15:00.000Z',connection:'connected',recordCount:1,
   items:[{title:'Iran oil shipping',url:'https://example.com/'+source.id,sourceId:source.id,discoveredAt:savedAt,publishedAt:null}],
 }));
 const storage={mkdir:async()=>{},writeFile:async()=>{},readFile:async file=>{reads.push(file);if(files.has(file))return files.get(file);throw Object.assign(Error(),{code:'ENOENT'});}};
 const runtime=new SourceRuntime({cacheDir:'/cache',storage,now:()=>now,fetchImpl:async url=>{requests.push(String(url));return new Response('Rate limited',{status:429,headers:{'Retry-After':'3600'}});}});
 const first=await loadDiscovery(runtime,{}, {waitMs:100,spacingMs:0});
 assert.equal(reads.length,5);assert.equal(requests.length,1);
 for(const row of first.filter(row=>row.id!=='gdelt-reuters')){assert.equal(row.connection,'cached');assert.equal(row.items.length,1);assert.equal(row.retrievedAt,savedAt);assert.equal(row.checkedAt,savedAt);assert.equal(row.delayed,true);}
 assert.equal(first.find(row=>row.id==='gdelt-reuters').connection,'unavailable');
 const second=await loadDiscovery(runtime,{}, {waitMs:100,spacingMs:0});assert.equal(requests.length,1);assert.equal(reads.length,5);
 assert.deepEqual(second.map(row=>row.items),first.map(row=>row.items));
});
test('network outage pauses the shared discovery endpoint and keeps its cause distinct from rate limiting',async()=>{
 let clock=now,calls=0;const files=new Map();
 const storage={mkdir:async()=>{},writeFile:async(file,value)=>files.set(file,value),readFile:async file=>{if(files.has(file))return files.get(file);throw Object.assign(Error(),{code:'ENOENT'});}};
 const fetchImpl=async()=>{calls++;throw new TypeError('private provider details');};
 const runtime=new SourceRuntime({cacheDir:'/cache',storage,now:()=>clock,fetchImpl});
 const rows=await loadDiscovery(runtime,{}, {waitMs:100,spacingMs:0});
 assert.equal(calls,1);assert.ok(rows.every(row=>row.delayed&&row.errorCategory==='network'));assert.ok(rows.every(row=>!row.error.includes('rate limit')));
 assert.equal(Date.parse(rows[0].nextRetryAt)-clock,300000);
 clock+=60000;const restarted=new SourceRuntime({cacheDir:'/cache',storage,now:()=>clock,fetchImpl});
 const retained=await loadDiscovery(restarted,{}, {waitMs:100,spacingMs:0});assert.equal(calls,1);assert.ok(retained.every(row=>row.delayed));
});
test('GDELT without Retry-After waits at least five minutes before another family is attempted',async()=>{
 let clock=now,calls=0;const storage={readFile:async()=>{throw Object.assign(Error(),{code:'ENOENT'});},mkdir:async()=>{},writeFile:async()=>{}};
 const runtime=new SourceRuntime({cacheDir:'/cache',storage,now:()=>clock,fetchImpl:async()=>{calls++;return new Response('',{status:429});}});
 const options={waitMs:100,spacingMs:0};await loadDiscovery(runtime,{},options);assert.equal(calls,1);
 clock+=299999;await loadDiscovery(runtime,{},options);assert.equal(calls,1);
 clock++;await loadDiscovery(runtime,{},options);assert.equal(calls,2);
});
test('Doomberg discovery is analysis metadata without inventing a fetched preview or publication',()=>{
 const urls=['https://newsletter.doomberg.com/p/example','https://newsletter.doomberg.com.evil.example/p/example'];
 const rows=parseDiscovery({articles:urls.map(url=>({url,title:'Iran oil supplies and diesel refining',seendate:'20260917T110000Z'}))},feed,now);
 const [analysis,other]=rows;
 assert.equal(analysis.type,'Independent energy analysis');assert.equal(analysis.publisher,'Doomberg');assert.match(analysis.evidenceStatus,/analysis/i);
 assert.equal(analysis.contentAccess,'discovery-metadata');assert.equal(analysis.summary,null);assert.equal(analysis.publishedAt,null);assert.equal(analysis.eventDate,null);
 assert.equal(analysis.discoveredAt,'2026-09-17T11:00:00.000Z');assert.equal(analysis.sourceId,feed.id);assert.equal(analysis.discoveryProvider,'GDELT');
 assert.equal(other.type,'Discovered reporting');
});
