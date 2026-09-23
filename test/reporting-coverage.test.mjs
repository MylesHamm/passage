import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SourceRuntime} from '../lib/source-runtime.mjs';
import {ReportArchive} from '../lib/report-archive.mjs';
import {loadReporting,deduplicateReports} from '../lib/reporting.mjs';
import {buildIntelligence,canonicalReportUrl} from '../dist/intelligence-data.mjs';
import {reportTime,reportRelevant,inReportingWindow} from '../dist/reporting-view.mjs';

const NOW=Date.parse('2026-09-22T12:00:00Z');
const ARTICLE='https://www.reuters.com/world/middle-east/houthis-push-control-yemen-highlands-trump-reported-have-called-off-airstrikes-2026-09-21/';
const CONFIG={discoveryWaitMs:30000,discoverySpacingMs:0};
const xmlEscape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const rss=records=>'<rss><channel>'+records.map(row=>'<item><title>'+xmlEscape(row.title)+'</title><link>'+xmlEscape(row.url)+'</link>'+(row.date?'<pubDate>'+row.date+'</pubDate>':'')+'</item>').join('')+'</channel></rss>';

async function setup(t,{now=NOW}={}){
  const dir=await mkdtemp(path.join(tmpdir(),'passage-reporting-coverage-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let time=now,records=[],discovery=[];const cache=new Map(),requests=[];
  const storage={mkdir:async()=>{},readFile:async file=>{if(cache.has(file))return cache.get(file);throw Object.assign(Error('Missing fixture cache'),{code:'ENOENT'});},writeFile:async(file,value)=>{cache.set(file,value);}};
  const runtime=new SourceRuntime({cacheDir:'/fixture-report-cache',storage,now:()=>time,fetchImpl:async value=>{
    const url=new URL(value);requests.push(url);
    if(url.hostname==='api.gdeltproject.org')return new Response(JSON.stringify({articles:discovery}));
    if(url.hostname==='feeds.bbci.co.uk')return new Response(rss(records));
    if(url.hostname==='www.centcom.mil')return new Response('Unavailable',{status:503});
    return new Response(rss([]));
  }});
  const file=path.join(dir,'report-history.json');
  return {runtime,file,requests,now:()=>time,setTime:value=>{time=value;},setRecords:value=>{records=value;},setDiscovery:value=>{discovery=value;},archive:()=>new ReportArchive({file,now:()=>time})};
}

test('reporting payload and Investigate retain a publisher article after feed rollover and restart',async t=>{
  const f=await setup(t),archive=f.archive(),firstUrl='https://example.com/houthi-oil-route';
  f.setRecords([{title:'Houthis threaten oil shipping route',url:firstUrl,date:'Tue, 22 Sep 2026 10:00:00 GMT'}]);
  const first=await loadReporting(f.runtime,{...CONFIG,reportArchive:archive});
  const original=first.items.find(row=>row.url===firstUrl);assert.ok(original);assert.equal(original.retainedFromHistory,false);
  assert.equal(original.firstSeenAt,new Date(NOW).toISOString());assert.equal(original.lastSeenAt,original.firstSeenAt);
  f.setTime(NOW+6*60000);f.setRecords([{title:'Saudi oil exports update',url:'https://example.com/next',date:'Tue, 22 Sep 2026 11:00:00 GMT'}]);
  const rolled=await loadReporting(f.runtime,{...CONFIG,reportArchive:archive}),retained=rolled.items.find(row=>row.url===firstUrl);
  assert.ok(retained);assert.equal(retained.retainedFromHistory,true);assert.equal(retained.firstSeenAt,original.firstSeenAt);assert.equal(retained.lastSeenAt,original.lastSeenAt);
  assert.equal(rolled.coverage.archive.retainedCount,1);assert.equal(rolled.coverage.archive.storageStatus,'ready');
  const graph=buildIntelligence({news:rolled,now:f.now()}),node=graph.nodes.find(row=>row.sourceUrl===firstUrl);
  assert.ok(node);assert.equal(node.record.retainedFromHistory,true);assert.equal(node.record.firstSeenAt,original.firstSeenAt);assert.equal(node.record.lastSeenAt,original.lastSeenAt);
  f.setTime(NOW+7*60000);
  const restarted=await loadReporting(f.runtime,{...CONFIG,reportArchive:f.archive()}),saved=restarted.items.find(row=>row.url===firstUrl);
  assert.ok(saved);assert.equal(saved.lastSeenAt,original.lastSeenAt);assert.equal(saved.retainedFromHistory,true);
  const current=restarted.items.find(row=>row.url==='https://example.com/next');assert.equal(current.lastSeenAt,new Date(NOW+6*60000).toISOString());
  const disk=JSON.parse(await readFile(f.file,'utf8'));assert.equal(disk.items.length,2);assert.ok(disk.items.every(row=>row.sourceId!=='reviewed-reporting'));
});

test('an outage check does not turn retained feed metadata into a fresh observation',async t=>{
  const f=await setup(t),archive=f.archive(),url='https://example.com/dated-shipping';
  f.setRecords([{title:'Houthi Red Sea shipping update',url,date:'Tue, 22 Sep 2026 09:00:00 GMT'}]);
  const first=await loadReporting(f.runtime,{...CONFIG,reportArchive:archive});
  f.setTime(NOW+6*60000);f.runtime.fetchImpl=async()=>new Response('Unavailable',{status:503});
  const failed=await loadReporting(f.runtime,{...CONFIG,reportArchive:archive}),record=failed.items.find(row=>row.url===url);
  assert.ok(record);assert.equal(failed.sources.find(row=>row.id==='bbc').connection,'cached');
  assert.equal(record.firstSeenAt,first.items.find(row=>row.url===url).firstSeenAt);assert.equal(record.lastSeenAt,new Date(NOW).toISOString());
});

test('the September 21 Reuters note is dated, attributed oil context on Watch and Investigate',async t=>{
  const f=await setup(t),news=await loadReporting(f.runtime,{...CONFIG,reportArchive:f.archive()}),article=news.items.find(row=>row.url===ARTICLE);
  assert.ok(article);assert.equal(article.type,'Reviewed context');assert.equal(article.energy,true);assert.ok(reportRelevant(article));
  assert.deepEqual(article.theaters,['bab','hormuz']);
  assert.equal(article.source,'Reuters');assert.equal(article.originatingWire,'Reuters');assert.match(article.attributionNote,/syndicated|StreetInsider/i);
  assert.equal(article.publishedAt,null);assert.equal(article.publishedDate,'2026-09-21');assert.equal(article.publicationPrecision,'day');
  assert.equal(reportTime(article),'2026-09-21');assert.equal(inReportingWindow(article,48,NOW),true);
  assert.ok(!article.retrievedAt);assert.ok(!article.firstSeenAt);assert.ok(!article.lastSeenAt);assert.ok(!article.discoveredAt);
  const graph=buildIntelligence({news,now:NOW}),node=graph.nodes.find(row=>row.sourceUrl===ARTICLE);
  assert.ok(node);assert.equal(node.record.source,'Reuters');assert.equal(node.record.originatingWire,'Reuters');assert.equal(node.record.publishedDate,'2026-09-21');
  assert.match(node.record.attributionNote,/syndicated|StreetInsider/i);assert.ok(!node.record.retrievedAt);
  assert.ok(graph.edges.some(edge=>edge.from===node.id&&edge.relation==='POTENTIAL_CHANNEL'));
  assert.equal(graph.nodes.filter(row=>row.sourceUrl===ARTICLE).length,1);
  assert.equal(news.coverage.reuters.mode,'public-discovery');assert.equal(news.coverage.reuters.directFeedConnected,false);assert.equal(news.coverage.reuters.topicPreferencesConnected,false);
  assert.equal(news.coverage.discoveryFamilies,5);assert.equal(news.coverage.discoveryLimitPerFamily,250);
});

test('reviewed reports are excluded before their publication or review date',async t=>{
  for(const date of ['2026-09-17T18:00:00Z','2026-09-21T18:00:00Z']){
    const now=Date.parse(date),f=await setup(t,{now}),news=await loadReporting(f.runtime,CONFIG);
    assert.ok(!news.items.some(row=>row.url===ARTICLE));assert.ok(!buildIntelligence({news,now}).nodes.some(row=>row.sourceUrl===ARTICLE));
  }
});

test('discovery, archived metadata and graph provenance contain only canonical public article URLs',async t=>{
  const f=await setup(t),clean='https://www.reuters.com/world/middle-east/iran-oil-shipping-fixture/';
  f.setDiscovery([
    {title:'Iran oil shipping report',url:clean+'?utm_source=Newsletter&user_email=recipient-hash&lctg=tracking-id',seendate:'20260922T100000Z'},
    ...['http://127.0.0.1/oil','https://example.com/oil?api_key=secret','https://person:password@example.com/oil'].map(url=>({title:'Iran oil shipping report',url,seendate:'20260922T100000Z'})),
  ]);
  const news=await loadReporting(f.runtime,{...CONFIG,reportArchive:f.archive()}),record=news.items.find(row=>row.url===clean);
  assert.ok(record);assert.equal(record.publishedAt,null);assert.equal(record.discoveredAt,'2026-09-22T10:00:00.000Z');
  assert.ok(record.provenance.length);assert.ok(record.provenance.every(p=>p.url===clean));
  for(const row of news.items){assert.equal(canonicalReportUrl(row.url),row.url);for(const p of row.provenance||[])assert.equal(canonicalReportUrl(p.url),p.url);}
  const graph=buildIntelligence({news,now:NOW});for(const row of graph.nodes.filter(row=>row.type==='report')){assert.equal(canonicalReportUrl(row.sourceUrl),row.sourceUrl);for(const p of row.record.provenance||[])assert.equal(canonicalReportUrl(p.url),p.url);}
  const raw=await readFile(f.file,'utf8');assert.ok(!raw.includes('recipient-hash'));assert.ok(!raw.includes('tracking-id'));assert.ok(!raw.includes('api_key'));
});

test('deduplication sanitizes inherited provenance without dropping distinct source attribution',()=>{
  const url='https://www.reuters.com/world/middle-east/iran-oil-fixture/';
  const records=deduplicateReports([{title:'Iran oil report',url:url+'?utm_source=mail',sourceId:'gdelt-reuters',provenance:[
    {sourceId:'gdelt-reuters',url:url+'?user_email=recipient-hash&lctg=tracking-id'},
    {sourceId:'gdelt-hormuz',url},
    {sourceId:'bad',url:'http://192.168.1.1/private'},
  ]}]);
  assert.equal(records.length,1);assert.equal(records[0].url,url);assert.deepEqual(records[0].provenance.map(p=>p.sourceId),['gdelt-reuters','gdelt-hormuz']);
  assert.ok(records[0].provenance.every(p=>p.url===url));
});

test('a live publisher match retains separately dated oil context and observed history clocks',()=>{
  const review={url:ARTICLE,title:'Reviewed Saudi oil context',summary:'Saudi oil export exposure',publishedDate:'2026-09-21',readAt:'2026-09-22',sourceId:'reviewed-reporting',source:'Reuters',energy:true,actors:['Saudi Arabia'],relevanceScopes:['regional-energy']};
  const observed={url:ARTICLE,title:'Updated Houthi report',summary:'Current publisher summary',publishedAt:'2026-09-22T10:00:00Z',sourceId:'bbc',firstSeenAt:'2026-09-21T12:00:00Z',lastSeenAt:'2026-09-22T12:00:00Z',retainedFromHistory:false,energy:false,actors:['Houthis'],relevanceScopes:['theater']};
  const [row]=deduplicateReports([observed,review]);
  assert.equal(row.title,observed.title);assert.equal(row.summary,observed.summary);assert.equal(row.publishedAt,observed.publishedAt);
  assert.equal(row.reviewedContext.summary,review.summary);assert.equal(row.reviewedContext.publishedDate,review.publishedDate);assert.equal(row.reviewedContext.readAt,review.readAt);
  assert.equal(row.energy,true);assert.equal(row.firstSeenAt,observed.firstSeenAt);assert.equal(row.lastSeenAt,observed.lastSeenAt);assert.equal(row.retainedFromHistory,false);
  const [indexed]=deduplicateReports([{...observed,publishedAt:null,summary:null},review]);
  assert.equal(indexed.sourceId,'reviewed-reporting');assert.equal(indexed.publishedAt,undefined);assert.equal(indexed.publishedDate,review.publishedDate);assert.equal(indexed.lastSeenAt,observed.lastSeenAt);
});
