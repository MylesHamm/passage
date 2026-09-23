import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIntelligence,normalizeManualReport,mergeManualEvidence,reportClock,canonicalReportUrl} from '../dist/intelligence-data.mjs';
import {inReportingWindow,matchesTheater,reportRelevant,reportTimeLabel} from '../dist/reporting-view.mjs';
import {COVERAGE_NOTES} from '../dist/intelligence-context.mjs';
const now=Date.parse('2026-09-17T18:00:00Z');
const make=(fields={})=>({title:'Saudi oil exports via Yanbu',url:'https://example.com/article',source:'Example publisher',publishedAt:null,discoveredAt:'2026-09-17T04:00:00Z',theaters:[],relevanceScopes:['regional-energy'],...fields});
test('regional energy and discovery remain visible without inventing a theater or publication date',()=>{
 const item=make();assert.ok(reportRelevant(item));assert.ok(matchesTheater(item,'hormuz'));assert.ok(inReportingWindow(item,24,now));assert.match(reportTimeLabel(item),/publication unknown/);
 const g=buildIntelligence({news:{items:[item]},now});const r=g.nodes.find(n=>n.sourceUrl===item.url);
 assert.equal(r.publishedAt,null);assert.deepEqual(r.record.theaters,[]);assert.deepEqual(r.record.relevanceScopes,['regional-energy']);assert.equal(r.discoveredAt,item.discoveredAt.replace('Z','.000Z'));
 assert.ok(g.edges.some(e=>e.from===r.id&&e.to==='actor:saudi-arabia'&&e.relation==='MENTIONS'));
 assert.ok(g.edges.filter(e=>e.from===r.id&&e.relation==='POTENTIAL_CHANNEL').every(e=>/effect not measured/.test(e.basis)));
 assert.equal(g.edges.some(e=>/CAUSE|ATTACK|ALLIANCE/.test(e.relation)),false);
});
test('source graph does not invent Oman from woman, Romania or an unrelated peaceful protest',()=>{
 const report=make({title:'Roman woman describes peaceful protest',summary:'No energy infrastructure mentioned'});
 const g=buildIntelligence({news:{items:[report]},acled:{events:[{id:'peace',title:'Peaceful protest in Tehran',eventDate:'2026-09-15',url:'https://acleddata.com/'}]},now});
 assert.ok(!g.edges.some(e=>e.from==='report:'+report.url&&e.to==='actor:oman'));
 assert.ok(!g.nodes.some(n=>n.id==='event:acled:peace'));
 assert.equal(g.coverage.omittedNonOilContextEvents,1);
});
test('daily observations use immutable dates and no price reaction is assigned to a report',()=>{
 const g=buildIntelligence({news:{items:[make()]},oil:{series:[{id:'brent',name:'Brent',url:'https://www.eia.gov/',observations:[{date:'2026-09-16',value:102},{date:'2026-09-18',value:105}]}]},now});
 const m=g.nodes.find(n=>n.type==='market');assert.equal(m.id,'market:eia:brent:2026-09-16');assert.equal(m.record.value,102);
 assert.ok(g.edges.filter(e=>e.to===m.id).every(e=>e.relation==='CONTEXT_FOR'&&/no causal attribution/.test(e.basis)));
});
test('publication-only statements are reports; an incident keeps its event clock and source edge',()=>{
 const g=buildIntelligence({maritime:{events:[{id:'event1',title:'Vessel attack',eventDate:'2026-09-15',url:'https://www.imo.org/incidents',source:'IMO'},{id:'statement1',title:'Shipping warning',publishedDate:'2026-09-16',url:'https://www.imo.org/statement'}]},now});
 const event=g.nodes.find(n=>n.id==='event:imo:event1');assert.equal(event.eventDate,'2026-09-15');assert.equal(event.record.publishedAt,null);
 assert.ok(g.edges.some(e=>e.to===event.id&&e.relation==='REPORTS_EVENT'));
 assert.ok(g.nodes.some(n=>n.type==='report'&&n.sourceUrl==='https://www.imo.org/statement'));
 assert.ok(!g.nodes.some(n=>n.type==='event'&&n.sourceUrl==='https://www.imo.org/statement'));
});
test('manual source records retain addedAt and cannot introduce credential or private links',()=>{
 for(const url of ['javascript:alert(1)','https://user:pass@example.com/','http://172.16.1.2/','http://127.0.0.1/','https://example.com/?signature=private','https://example.com/?api-key=secret'])assert.equal(canonicalReportUrl(url),null);
 const record=normalizeManualReport({url:'https://example.com/path?utm_source=test#hash',title:'Saudi exports',note:'Analyst context'},now);
 assert.equal(record.url,'https://example.com/path');assert.equal(record.publishedAt,null);assert.equal(record.publishedDate,null);
 assert.equal(normalizeManualReport(record,now+86400000).addedAt,record.addedAt);
 const base=buildIntelligence({now});const g=mergeManualEvidence(base,[record,{url:'bad',title:'bad'}],now+60000);
 assert.equal(g.manualRejected,1);assert.ok(g.nodes.some(n=>n.record?.manual));assert.equal(base.nodes.some(n=>n.record?.manual),false);
});
test('CENTCOM day precision stays a calendar date and unknown dates remain visible',()=>{
 const r=make({publishedAt:'2026-09-17T00:00:00Z',publicationDate:'2026-09-17',publicationPrecision:'day'});
 const g=buildIntelligence({news:{items:[r]},now}),record=g.nodes.find(n=>n.sourceUrl===r.url).record;
 assert.deepEqual(reportClock(record),{value:'2026-09-17',label:'Publication date'});
 assert.equal(reportTimeLabel(r),'Publication date');assert.ok(inReportingWindow(make({discoveredAt:null}),24,now));
});
test('later feed metadata augments a reviewed URL without deleting its attribution or short review',()=>{
 const g=buildIntelligence({news:{items:[make({url:'https://www.eia.gov/outlooks/steo/report/global_oil.php',title:'EIA outlook',publishedAt:'2026-09-09T14:00:00Z',summary:'Publisher summary',provenance:[{sourceId:'eia-news',publisher:'EIA',url:'https://www.eia.gov/outlooks/steo/report/global_oil.php'}]})]},now});
 const r=g.nodes.find(n=>n.sourceUrl==='https://www.eia.gov/outlooks/steo/report/global_oil.php').record;
 assert.equal(r.publishedAt,'2026-09-09T14:00:00.000Z');assert.ok(r.reviewedContext.summary);assert.equal(r.summary,'Publisher summary');assert.equal(r.reviewedContext.readAt,'2026-09-17');assert.equal(r.reviewedContext.publishedDate,'2026-09-09');assert.equal(r.provenance.length,1);
});

test('impossible publisher dates do not silently roll into a different day',()=>{
 const item=make({publishedAt:'2026-02-30T10:00:00Z'});const g=buildIntelligence({news:{items:[item]},now});assert.ok(!g.nodes.some(n=>n.sourceUrl===item.url));
});

test('land violence without an energy or shipping connection stays outside the oil-focused event graph',()=>{
 const events=[{id:'land',title:'Airstrike in rural district',summary:'Armed forces struck positions',eventDate:'2026-09-15',url:'https://acleddata.com/land'},{id:'energy',title:'Attack on oil pipeline',eventDate:'2026-09-15',url:'https://acleddata.com/energy'}];
 const g=buildIntelligence({acled:{events},now});assert.ok(!g.nodes.some(n=>n.id==='event:acled:land'));assert.ok(g.nodes.some(n=>n.id==='event:acled:energy'));
});

test('report cap counts canonical URLs and still merges metadata beyond the input boundary',()=>{
 const clock=Date.parse('2026-09-22T12:00:00Z'),contextCount=buildIntelligence({now:clock}).stats.reports;
 const reports=Array.from({length:1200},(_,i)=>make({url:'https://example.com/record/'+i,title:'Oil shipping '+i,publishedAt:'2026-09-22T09:00:00Z',discoveredAt:null}));
 const updated={...reports[0],url:reports[0].url+'?utm_source=duplicate',title:'Updated oil shipping report',publishedAt:'2026-09-22T10:00:00Z'};
 const graph=buildIntelligence({news:{items:[...COVERAGE_NOTES,...reports,updated]},now:clock});
 assert.equal(graph.stats.reports,1200);assert.equal(graph.coverage.omittedReports,contextCount);assert.equal(graph.coverage.bounded,true);
 const selected=graph.nodes.find(node=>node.sourceUrl===reports[0].url);assert.equal(selected.label,updated.title);assert.equal(selected.publishedAt,'2026-09-22T10:00:00.000Z');
 assert.equal(graph.nodes.filter(node=>node.sourceUrl===reports[0].url).length,1);
});

test('discovery and day-only archive clocks enrich reviewed sources without changing review vintage',()=>{
 const url='https://www.eia.gov/outlooks/steo/report/global_oil.php',firstSeenAt='2026-09-16T10:00:00.000Z',lastSeenAt='2026-09-17T10:00:00.000Z';
 for(const dates of [{publishedAt:null,discoveredAt:'2026-09-17T09:00:00Z'},{publishedAt:null,publishedDate:'2026-09-16',publicationPrecision:'day'}]){
   const graph=buildIntelligence({news:{items:[make({...dates,url,title:'Index headline',firstSeenAt,lastSeenAt,retainedFromHistory:true})]},now});
   const record=graph.nodes.find(node=>node.sourceUrl===url).record;
   assert.equal(record.firstSeenAt,firstSeenAt);assert.equal(record.lastSeenAt,lastSeenAt);assert.equal(record.retainedFromHistory,true);
   assert.equal(record.readAt,'2026-09-17');assert.equal(record.publishedDate,'2026-09-09');assert.notEqual(record.title,'Index headline');
 }
});

test('older publication metadata preserves archive clocks independently of publisher replacement',()=>{
 const url='https://www.eia.gov/outlooks/steo/report/global_oil.php',firstSeenAt='2026-09-15T10:00:00.000Z',lastSeenAt='2026-09-17T10:00:00.000Z';
 const latest=make({url,title:'Current publisher headline',publishedAt:'2026-09-17T08:00:00Z',discoveredAt:null,firstSeenAt:'2026-09-16T10:00:00.000Z',lastSeenAt:'2026-09-16T10:00:00.000Z',retainedFromHistory:false});
 const older=make({url,title:'Older publisher headline',publishedAt:'2026-09-15T08:00:00Z',discoveredAt:null,firstSeenAt,lastSeenAt,retainedFromHistory:true});
 const graph=buildIntelligence({news:{items:[latest,older]},now}),record=graph.nodes.find(node=>node.sourceUrl===url).record;
 assert.equal(record.title,latest.title);assert.equal(record.publishedAt,'2026-09-17T08:00:00.000Z');
 assert.equal(record.firstSeenAt,firstSeenAt);assert.equal(record.lastSeenAt,lastSeenAt);assert.equal(record.retainedFromHistory,true);
 assert.equal(record.reviewedContext.readAt,'2026-09-17');assert.equal(record.reviewedContext.publishedDate,'2026-09-09');
});

test('a publisher update without archive fields cannot erase known observation clocks',()=>{
 const url='https://example.com/rolling',firstSeenAt='2026-09-15T10:00:00.000Z',lastSeenAt='2026-09-17T10:00:00.000Z';
 const retained=make({url,publishedAt:'2026-09-15T08:00:00Z',firstSeenAt,lastSeenAt,retainedFromHistory:true});
 const updated=make({url,title:'New publisher version',publishedAt:'2026-09-17T09:00:00Z'});
 const graph=buildIntelligence({news:{items:[retained,updated]},now}),record=graph.nodes.find(node=>node.sourceUrl===url).record;
 assert.equal(record.title,updated.title);assert.equal(record.firstSeenAt,firstSeenAt);assert.equal(record.lastSeenAt,lastSeenAt);assert.equal(record.retainedFromHistory,true);
});

test('graph preserves analysis type and status while keeping generic defaults unchanged',()=>{
 const analysis=make({type:'Independent energy analysis',evidenceStatus:'Independent energy analysis; publisher interpretation'});
 const generic=make({url:'https://example.com/generic',type:'Reporting'});
 const graph=buildIntelligence({news:{items:[analysis,generic]},now});
 const record=graph.nodes.find(node=>node.sourceUrl===analysis.url).record;
 assert.equal(record.type,analysis.type);assert.equal(record.evidenceStatus,analysis.evidenceStatus);
 const other=graph.nodes.find(node=>node.sourceUrl===generic.url).record;
 assert.equal(other.type,'Reporting');assert.equal(other.evidenceStatus,'Publisher reporting; not independently verified');
});

test('graph labels an explicit analysis source even when no custom status is supplied',()=>{
 const analysis=make({type:'Independent energy analysis'}),graph=buildIntelligence({news:{items:[analysis]},now});
 const record=graph.nodes.find(node=>node.sourceUrl===analysis.url).record;
 assert.equal(record.type,analysis.type);assert.match(record.evidenceStatus,/Independent energy analysis/);
 assert.doesNotMatch(record.evidenceStatus,/^Publisher reporting/);
});

test('graph duplicate discovery cannot replace the analysis label or evidence connection status',()=>{
 const analysis=make({type:'Independent energy analysis',evidenceStatus:'Independent energy analysis; publisher interpretation'});
 const discovery=make({url:analysis.url+'?utm_source=index',type:'Discovered reporting',evidenceStatus:'Indexed headline only',publishedAt:'2026-09-17T06:00:00Z'});
 for(const items of [[analysis,discovery],[discovery,analysis]]){
   const graph=buildIntelligence({news:{items},now}),report=graph.nodes.find(node=>node.sourceUrl===analysis.url);
   assert.equal(graph.nodes.filter(node=>node.sourceUrl===analysis.url).length,1);
   assert.equal(report.record.type,analysis.type);assert.equal(report.record.evidenceStatus,analysis.evidenceStatus);
   assert.ok(graph.edges.some(edge=>edge.from===report.id));
   assert.ok(graph.edges.filter(edge=>edge.from===report.id).every(edge=>edge.evidenceStatus===analysis.evidenceStatus));
 }
});

test('graph analysis keeps its own preview, access and unknown publication clock against generic metadata',()=>{
 const analysis=make({title:'Diesel refining and Saudi oil exports',type:'Independent energy analysis',summary:'Publisher preview about oil refining.',contentAccess:'Free preview; paid full article',discoveredAt:null});
 const discovery=make({title:'Iran pipeline headline from an index',summary:'Different indexed description.',type:'Discovered reporting',contentAccess:'Indexed headline only',publishedAt:'2026-09-17T06:00:00Z'});
 for(const items of [[analysis,discovery],[discovery,analysis]]){
   const graph=buildIntelligence({news:{items},now}),node=graph.nodes.find(value=>value.sourceUrl===analysis.url),record=node.record;
   assert.equal(node.label,analysis.title);assert.equal(record.title,analysis.title);assert.equal(record.summary,analysis.summary);assert.equal(record.contentAccess,analysis.contentAccess);
   assert.equal(record.publishedAt,null);assert.equal(node.publishedAt,null);assert.equal(record.publicationPrecision,'unknown');assert.equal(record.discoveredAt,'2026-09-17T04:00:00.000Z');
   const connections=graph.edges.filter(edge=>edge.from===node.id);
   assert.ok(connections.length);assert.ok(connections.every(edge=>edge.publishedAt===null));
   assert.ok(!connections.some(edge=>edge.to==='actor:iran'));
 }
});
test('graph favors a direct public preview when discovery carries the same analysis category',()=>{
 const url='https://newsletter.doomberg.com/p/example',direct=make({url,title:'Saudi diesel exports',sourceId:'doomberg',type:'Independent energy analysis',summary:'Public refining preview.',contentAccess:'Public RSS preview',discoveredAt:null});
 const indexed=make({url,title:'Iran oil production',sourceId:'gdelt-energy',type:'Independent energy analysis',summary:null,contentAccess:'discovery-metadata',publishedAt:'2026-09-17T06:00:00Z'});
 for(const items of [[direct,indexed],[indexed,direct]]){
  const graph=buildIntelligence({news:{items},now}),node=graph.nodes.find(value=>value.sourceUrl===url),row=node.record;
  assert.equal(row.title,direct.title);assert.equal(row.summary,direct.summary);assert.equal(row.contentAccess,direct.contentAccess);assert.equal(row.publishedAt,null);assert.equal(node.publishedAt,null);
  assert.equal(row.discoveredAt,'2026-09-17T04:00:00.000Z');assert.ok(graph.edges.filter(edge=>edge.from===node.id).every(edge=>edge.publishedAt===null));
 }
});
test('raw legacy Doomberg metadata gains analysis labels but manual notes retain their user-supplied status',()=>{
 const url='https://newsletter.doomberg.com/p/legacy',old=make({url,type:'Discovered reporting',sourceId:'gdelt-energy',contentAccess:'discovery-metadata'});
 const graph=buildIntelligence({news:{items:[old]},now}),row=graph.nodes.find(node=>node.sourceUrl===url).record;
 assert.equal(row.type,'Independent energy analysis');assert.match(row.evidenceStatus,/analysis/i);assert.equal(row.publishedAt,null);assert.equal(row.contentAccess,'discovery-metadata');assert.equal(row.summary,'');
 const manual=mergeManualEvidence(buildIntelligence({now}),[{url,title:'My reading note',note:'My interpretation'}],now).nodes.find(node=>node.sourceUrl===url).record;
 assert.equal(manual.evidenceStatus,'User-supplied context');assert.equal(manual.manual,true);assert.match(manual.contentAccess,/not fetched/);
});
