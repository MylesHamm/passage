import test from 'node:test';import assert from 'node:assert/strict';
import {SourceRuntime} from '../lib/source-runtime.mjs';
import {loadReporting,deduplicateReports} from '../lib/reporting.mjs';
import {SOURCE_DEFINITIONS} from '../dist/source-health.mjs';

const now=Date.parse('2026-09-17T12:00:00Z');
const storage={readFile:async()=>{throw Object.assign(Error(),{code:'ENOENT'});},mkdir:async()=>{},writeFile:async()=>{}};
const xml='<rss><channel><item><title>Saudi oil pipeline exports disrupted</title><link>https://example.com/pipeline</link><pubDate>Thu, 17 Sep 2026 10:00:00 GMT</pubDate><description>Aramco discusses crude deliveries.</description></item></channel></rss>';
test('aggregated reporting keeps regional context, source provenance and per-source failures',async()=>{
 const urls=[];const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>now,fetchImpl:async(url)=>{
   const u=new URL(url);urls.push(u.href);
   if(u.hostname==='api.gdeltproject.org')return new Response(JSON.stringify({articles:[{title:'Saudi oil pipeline exports disrupted',url:'https://example.com/pipeline',seendate:'20260917T110000Z'}]}));
   if(u.hostname==='www.centcom.mil')return new Response('>Public Releases</span><b><a href="https://www.centcom.mil/MEDIA/PUBLIC-RELEASES/Article/12345/example/">Forces escort tanker in Hormuz</a></b> Sept. 16, 2026<br></div>');
   if(u.hostname==='news.un.org')return new Response('Service unavailable',{status:503});
   return new Response(xml);
 }});
 let result=await loadReporting(runtime,{reliefweb:false,discoveryWaitMs:30000,discoverySpacingMs:0},{});
 assert.ok(result.items.some(x=>x.relevanceScopes.includes('regional-energy')&&x.theaters.length===0));
 assert.equal(result.sources.find(x=>x.id==='un').connection,'unavailable');
 assert.equal(result.sources.find(x=>x.id==='centcom').publicationPrecision,'day');
 assert.equal(result.sources.length,12);assert.equal(result.coverage.complete,false);
 assert.ok(result.items.find(x=>x.url==='https://example.com/pipeline').provenance.length>1);
 assert.ok(result.items.find(x=>x.url==='https://example.com/pipeline').publishedAt);
 assert.ok(result.sources.every(x=>!('items' in x)));assert.ok(urls.every(x=>!x.includes('example.com')));
 const previous=urls.length;result=await loadReporting(runtime,{reliefweb:false,discoveryWaitMs:30000,discoverySpacingMs:0},{});assert.equal(urls.length,previous);
});
test('deduplication preserves publication metadata over discovery without claiming independent confirmation',()=>{
 const a={id:'rss',url:'https://example.com/story?utm_source=rss',sourceId:'bbc',publisher:'BBC',publishedAt:'2026-09-17T10:00:00Z',discoveredAt:null,dateBasis:'publisher-publication'};
 const b={id:'index',url:'https://example.com/story',sourceId:'gdelt-hormuz',publisher:'example.com',publishedAt:null,discoveredAt:'2026-09-17T11:00:00Z',dateBasis:'discovery'};
 const [row]=deduplicateReports([b,a]);assert.equal(row.id,'rss');assert.equal(row.provenance.length,2);assert.equal(row.discoveredAt,b.discoveredAt);assert.equal(row.dateBasis,a.dateBasis);assert.equal(row.independentConfirmationCount,undefined);
});
test('ReliefWeb retains its configured appname path without returning credential-bearing URLs',async()=>{
 const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>now,fetchImpl:async(url)=>{
   const u=new URL(url);if(u.hostname==='api.reliefweb.int'){assert.equal(u.searchParams.get('appname'),'passage-test');return new Response(JSON.stringify({data:[{id:2,fields:{title:'Yemen fuel deliveries',url:'https://reliefweb.int/report/yemen/fuel',date:{created:'2026-09-17T09:00:00Z'}}}]}));}
   if(u.hostname==='api.gdeltproject.org')return new Response('{"articles":[]}');
   return new Response('Blocked',{status:403});
 }});
 const result=await loadReporting(runtime,{reliefweb:true,reliefwebAppname:'passage-test',discoveryWaitMs:30000,discoverySpacingMs:0},{});
 const rw=result.items.find(x=>x.sourceId==='reliefweb');assert.ok(rw);assert.equal(rw.dateBasis,'publisher-publication');assert.ok(!JSON.stringify(result).includes('passage-test'));assert.equal(SOURCE_DEFINITIONS.filter(s=>s.group==='discovery').length,5);
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
test('publisher analysis survives discovery dedup, caching and a later outage',async()=>{
 const xml='<rss><channel><item><title>A changing balance</title><link>https://newsletter.doomberg.com/p/example</link><pubDate>Thu, 17 Sep 2026 10:00:00 GMT</pubDate><description>Diesel and oil supplies are discussed.</description></item></channel></rss>';
 let clock=now,fail=false,doomRequests=0;const runtime=new SourceRuntime({cacheDir:'/unused',storage,now:()=>clock,fetchImpl:async url=>{
  if(new URL(url).hostname==='newsletter.doomberg.com'){doomRequests++;return new Response(fail?'Unavailable':xml,{status:fail?503:200});}
  return new Response('Unavailable',{status:503});
 }});
 const options={discoveryWaitMs:30000,discoverySpacingMs:0};const first=await loadReporting(runtime,options,{}),row=first.items.find(x=>x.sourceId==='doomberg');
 assert.ok(row);assert.match(row.evidenceStatus,/Independent energy analysis/);assert.equal(row.summary,'Diesel and oil supplies are discussed.');
 const indexed={...row,sourceId:'gdelt-energy',source:'Discovery',type:'Discovered headline',evidenceStatus:undefined,summary:null,publishedAt:null,discoveredAt:'2026-09-17T11:00:00Z'};
 for(const records of [[indexed,row],[row,indexed]]){const [merged]=deduplicateReports(records);assert.equal(merged.type,row.type);assert.equal(merged.evidenceStatus,row.evidenceStatus);assert.equal(merged.summary,row.summary);assert.equal(merged.sourceId,'doomberg');}
 await loadReporting(runtime,options,{});assert.equal(doomRequests,1);
 clock+=3601000;fail=true;const retained=await loadReporting(runtime,options,{}),source=retained.sources.find(x=>x.id==='doomberg');
 assert.equal(source.status,'retained');assert.equal(source.retrievedAt,first.sources.find(x=>x.id==='doomberg').retrievedAt);assert.equal(retained.items.find(x=>x.sourceId==='doomberg').publishedAt,row.publishedAt);
});
test('direct analysis preview outranks equally classified discovery in both dedup orders',()=>{
 const url='https://newsletter.doomberg.com/p/example';
 const direct={url,title:'Publisher title',sourceId:'doomberg',source:'Doomberg',type:'Independent energy analysis',evidenceStatus:'Independent energy analysis; publisher interpretation',summary:'Public diesel and refining preview.',contentAccess:'Public RSS preview',publishedAt:null,dateBasis:'publication-unknown'};
 const indexed={url,title:'Different indexed title',sourceId:'gdelt-energy',source:'Doomberg',type:'Independent energy analysis',evidenceStatus:'Independent energy analysis; index metadata',summary:null,contentAccess:'discovery-metadata',publishedAt:'2026-09-17T10:00:00Z',discoveredAt:'2026-09-17T11:00:00Z',dateBasis:'discovery'};
 for(const records of [[indexed,direct],[direct,indexed]]){
  const [row]=deduplicateReports(records);assert.equal(row.sourceId,'doomberg');assert.equal(row.title,direct.title);assert.equal(row.summary,direct.summary);assert.equal(row.contentAccess,direct.contentAccess);assert.equal(row.publishedAt,null);assert.equal(row.evidenceStatus,direct.evidenceStatus);assert.equal(row.discoveredAt,indexed.discoveredAt);assert.equal(row.provenance.length,2);
 }
});
test('legacy discovery caches and retained history gain analysis category without gaining preview access',async()=>{
 const item={id:'legacy-doomberg',title:'Iran oil supplies',url:'https://newsletter.doomberg.com/p/cache',source:'newsletter.doomberg.com',sourceId:'gdelt-energy',type:'Discovered reporting',publishedAt:null,discoveredAt:'2026-09-16T09:00:00Z',summary:null,contentAccess:'discovery-metadata',dateBasis:'discovery',discoveryProvider:'GDELT'};
 const cached={checkedAt:'2026-09-16T10:00:00Z',retrievedAt:'2026-09-16T10:00:00Z',items:[item]};
 const oldStorage={...storage,readFile:async file=>{if(file.endsWith('/gdelt-energy-metadata.json'))return JSON.stringify(cached);throw Object.assign(Error(),{code:'ENOENT'});}};
 for(const useArchive of [false,true]){
  const runtime=new SourceRuntime({cacheDir:'/unused',storage:useArchive?storage:oldStorage,now:()=>now,fetchImpl:async()=>new Response('Unavailable',{status:503})});
  const options={discoveryWaitMs:30000,discoverySpacingMs:0,...(useArchive?{reportArchive:{merge:async()=>({items:[item]})}}:{})};
  const result=await loadReporting(runtime,options,{}),row=result.items.find(record=>record.id===item.id);
  assert.ok(row);assert.equal(row.type,'Independent energy analysis');assert.equal(row.source,'Doomberg');assert.equal(row.contentAccess,'discovery-metadata');assert.equal(row.summary,null);assert.equal(row.publishedAt,null);assert.equal(row.discoveredAt,item.discoveredAt);assert.equal(row.dateBasis,'discovery');
  assert.ok(row.matchEvidence.every(match=>!match.field.includes('preview')));
 }
 assert.equal(item.type,'Discovered reporting');
});
