import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceHealth,coverage,statusSummary,panelNotice,collectSources} from '../dist/source-health.mjs';
import {buildPriorityBrief} from '../dist/priority-brief.mjs';
import {briefCoverage,createPriorityView} from '../dist/priority-view.mjs';
import {buildTimeline,buildEvidenceGraph,reportPublication} from '../dist/research-data.mjs';
import {buildIntelligence} from '../dist/intelligence-data.mjs';
import {evidenceKind,evidenceKindLabel} from '../dist/evidence-kind.mjs';
import {buildBrief,groupReporting,replayReporting} from '../dist/monitoring-model.mjs';
import {buildOilSystemState} from '../dist/oil-system-model.mjs';
import {reportImpactMarkup} from '../dist/report-impact.mjs';
import {reportInspectorMarkup} from '../dist/report-inspector.mjs';
import {summarizeGraphNode} from '../dist/investigate-model.mjs';
import {priceComparison} from '../dist/situation-data.mjs';
import {segmentOilObservations,normalizeOilObservations} from '../dist/oil-chart-view.mjs';
import {ReportArchive} from '../lib/report-archive.mjs';

const NOW=Date.parse('2026-10-17T04:00:00Z'),STAMP='2026-10-17T03:59:00Z';
const row=(id='a',extra={})=>({id,url:`https://publisher.example/${id}`,title:'Iran oil exports continue through Hormuz',source:'Publisher',sourceId:'bbc',publishedAt:'2026-10-17T03:00:00Z',theaters:['hormuz'],actors:['Iran'],energy:true,...extra});
const source=extra=>sourceHealth({id:'bbc',name:'BBC',group:'news',configured:true,connection:'connected',recordCount:1,retrievedAt:STAMP,latestRelevant:'2026-10-17T03:00:00Z',...extra},NOW);
const mount=()=>({innerHTML:'',ownerDocument:{activeElement:null},contains:()=>false,querySelectorAll:()=>[],addEventListener:()=>{}});

// Audit acceptance scenarios are run through the shared contracts rather than
// merely asserting a fixture's own labels. Additional detailed UI/storage tests
// remain in the existing focused suites.
test('audit 01 · cold failure and absent inventory never claim checked-empty or refreshed',()=>{
 for(const sources of [[],[source({connection:'unavailable',recordCount:0,retrievedAt:null,latestRelevant:null})]]){
  const news={items:[],sources},summary=coverage(sources),target=mount();
  assert.equal(summary.empty,false);assert.equal(summary.unknown,true);assert.equal(summary.incomplete,true);
  createPriorityView({mount:target,getState:()=>({news,actor:'All'}),now:()=>NOW}).update();
  assert.doesNotMatch(target.innerHTML,/Source headlines refreshed/);
 }
});
test('audit 02 · warm failure retains separate success and attempt clocks in coverage and brief',()=>{
 const old='2026-10-16T02:00:00Z',news={items:[row()],sources:[source({connection:'cached',retrievedAt:old,checkedAt:STAMP})]};
 assert.equal(news.sources[0].status,'retained');assert.equal(news.sources[0].retrievedAt,old);assert.equal(news.sources[0].lastAttemptAt,STAMP);
 assert.equal(coverage(news.sources).retained,true);const target=mount();
 createPriorityView({mount:target,getState:()=>({news,actor:'All'}),now:()=>NOW}).update();assert.match(target.innerHTML,/retained after failed update/);
});
test('audit 03 · successful empty requires a valid successful source check',()=>{
 const checked=source({recordCount:0,latestRelevant:null});assert.equal(coverage([checked]).empty,true);
 const unclocked=source({recordCount:0,retrievedAt:null,latestRelevant:null});assert.equal(coverage([unclocked]).empty,false);
 assert.notEqual(checked.label,unclocked.label);assert.equal(checked.clockCompleteness,'not-applicable');
});
test('audit 04 · unknown publication is readable, unplaced and propagated as coverage uncertainty',()=>{
 const unknown=row('unknown',{publishedAt:null,discoveredAt:STAMP,publicationPrecision:'unknown'});
 assert.equal(reportPublication(unknown),null);assert.equal(buildEvidenceGraph([unknown]).totalReports,1);
 const timeline=buildTimeline([unknown],[],{days:7,now:NOW,onlyDisruptions:false});assert.equal(timeline.reportCount,0);assert.equal(timeline.missingPublicationDates,1);assert.equal(timeline.omittedReports[0].report.id,unknown.id);
 const health=source({latestRelevant:null});assert.equal(health.coverageStatus,'unknown');assert.equal(coverage([health]).incomplete,true);assert.match(statusSummary([health]),/dates incomplete/);
});
test('audit 05 · day-only publication retains its precision rather than inventing an hour',()=>{
 const report=row('day',{publishedAt:null,publishedDate:'2026-10-16',publicationPrecision:'day'}),brief=buildPriorityBrief({items:[report]},{now:NOW});
 assert.equal(brief.cards[0].items[0].clock.value,'2026-10-16');assert.equal(brief.cards[0].items[0].clock.precision,'day');
 const graph=buildIntelligence({news:{items:[report]},now:NOW,includeReviewedContext:false});assert.equal(graph.nodes.find(node=>node.type==='report').record.publishedAt,null);
});
test('audit 06 · denials, hypotheticals and financial metaphors cannot assert physical disruption',()=>{
 const titles=['Iran says oil exports continue without disruption','Iran may suspend oil exports','Iran denies closure of shipping routes','Rumors of Iran oil export suspension remain unconfirmed','Iran plans to suspend oil exports next year','Iran recounts historic oil export closure','Iran cancels planned shipping closure','Correction: Iran oil pipeline was not damaged','U.S. stocks sink amid tech sell-off, surging oil prices','U . S . stocks sink amid tech sell - off , surging oil prices','Oil prices plunge as market rout continues'];
 for(const [index,title] of titles.entries()){
  const report=row(String(index),{title}),brief=buildPriorityBrief({items:[report]},{now:NOW}),selected=brief.cards.flatMap(card=>card.items)[0];
  assert.ok(selected,title);assert.equal(selected.title,title);assert.doesNotMatch(selected.category,/^(?:Energy|Shipping) disruption$/);
  if(/stocks sink|prices plunge/.test(title))assert.equal(selected.category,'Oil & market context');
 }
});
test('audit 07 · repeated reporting remains copies without corroboration or extra event weight',()=>{
 const reports=[row('a'),row('b')],groups=groupReporting(reports),brief=buildPriorityBrief({items:reports},{now:NOW});
 assert.equal(groups.length,1);assert.equal(groups[0].independentConfirmation,false);assert.equal(brief.uniqueGroupCount,1);assert.equal(brief.cards[0].items[0].copyCount,2);
});
test('audit 08 · source, archive and local selection caps survive aggregate and rendered coverage',()=>{
 const capped=source({possiblyTruncated:true});assert.equal(coverage([capped]).truncated,true);assert.equal(coverage([capped]).incomplete,true);assert.match(panelNotice([capped],'news'),/bounded/);
 const news={items:Array.from({length:2001},(_,i)=>row(String(i))),sources:[source({})],coverage:{archive:{truncated:true,maxRecords:1200,retainedCount:800}}};
 assert.equal(briefCoverage(news,{now:NOW,inputTruncated:true}).truncated,true);const target=mount();createPriorityView({mount:target,getState:()=>({news,actor:'All'}),now:()=>NOW}).update();assert.match(target.innerHTML,/selection limits/);assert.match(target.innerHTML,/800 links are retained/);
 assert.equal(coverage(collectSources({news},NOW)).truncated,true);
 const graph=buildIntelligence({news,now:NOW,includeReviewedContext:false});assert.equal(graph.coverage.bounded,true);assert.equal(graph.coverage.archive.truncated,true);
});
test('audit 09 · sparse prices use explicit missing observations and ordinary weekend policy',()=>{
 const segments=segmentOilObservations(normalizeOilObservations([{date:'2026-10-09',value:80},{date:'2026-10-12',value:81},{date:'2026-10-13',value:null},{date:'2026-10-14',value:82},{date:'2026-10-20',value:83}],{now:Date.parse('2026-10-21T00:00:00Z')}));
 assert.deepEqual(segments.map(segment=>segment.map(point=>point.value)),[[80,81],[82],[83]]);
});
test('audit 10 · no event date means no event-day price attribution',()=>{
 const observations=[{date:'2026-10-15',value:80},{date:'2026-10-16',value:81}];assert.equal(priceComparison(observations,null,NOW).onDate,null);
 assert.equal(priceComparison(observations,'2026-10-16',NOW).delta,1);assert.equal(row().eventDate,undefined);
});
test('audit 11 · evidence kinds survive graph, ledger label, export JSON and spoken brief',()=>{
 for(const [recordKind,label] of Object.entries({'official-statement':'Official statement','agency-assessment':'Agency assessment','independent-analysis':'Independent analysis','forecast':'Forecast','user-note':'User note'})){
  const report=row(recordKind,{recordKind,forecastCompleted:'2026-10-01'}),graph=buildIntelligence({news:{items:[report]},now:NOW,includeReviewedContext:false});
  const retained=JSON.parse(JSON.stringify(graph)).nodes.find(node=>node.type==='report').record;assert.equal(evidenceKind(retained),recordKind);assert.equal(evidenceKindLabel(retained),label);assert.equal(retained.forecastCompleted,'2026-10-01');
  assert.match(buildBrief({news:{items:[report]},hours:'all',theater:'both'},NOW).speech,new RegExp(label));
 }
 assert.equal(evidenceKindLabel({evidenceStatus:'Agency assessment'}),'Agency assessment');
});
test('audit 12 · connected AIS with no positions remains a reception gap',()=>{
 const ais=sourceHealth({id:'aisstream',group:'vessels',configured:true,connection:'connected',recordCount:0,positionFrames:0,retrievedAt:STAMP},NOW);
 assert.equal(ais.attentionReason,'reception');assert.equal(ais.coverageStatus,'limited');assert.match(panelNotice([ais],'vessels'),/not evidence.*empty/);
});
test('audit 13 · archive arrivals use first retrieval and do not claim historical prices',()=>{
 const before=row('before',{firstSeenAt:'2026-10-16T00:00:00Z',lastSeenAt:STAMP}),later=row('later',{firstSeenAt:STAMP});
 const replay=replayReporting([before,later],'2026-10-16T23:00:00Z',NOW);assert.deepEqual(replay.items.map(item=>item.id),['before']);assert.match(replay.scope,/market|vessel/);assert.equal(replay.items[0].lastSeenAt,STAMP);
});
test('audit 14 · local archive persistence failure retains usable state and never claims saved',async()=>{
 let writes=0;const archive=new ReportArchive({file:'/fixture/history.json',now:()=>NOW,storage:{open:async(_path,mode)=>{if(mode==='wx'){writes++;throw Error('disk full');}throw Object.assign(Error('new file'),{code:'ENOENT'});},mkdir:async()=>{},rename:async()=>{throw Error('must not rename');},unlink:async()=>{}}});
 const result=await archive.merge([row()],{observedAtBySource:{bbc:STAMP}});assert.equal(writes,1);assert.equal(result.items.length,1);assert.equal(result.archive.storageStatus,'memory-only');assert.match(result.archive.error,/could not be saved/);
});

test('audited production discovery headline cannot become a default physical-disruption lead',()=>{
 const financial=row('audit-stock-sink',{title:'U . S . stocks sink amid tech sell - off , surging oil prices',sourceId:'gdelt-energy',source:'bignewsnetwork.com',url:'http://www.bignewsnetwork.com/news/279380176/us-stocks-sink-amid-tech-sell-off-surging-oil-prices',publishedAt:null,publicationPrecision:'unknown',discoveredAt:'2026-10-16T23:15:00Z',contentAccess:'discovery-metadata',discoveryProvider:'GDELT',theaters:[]});
 const ordinary=buildPriorityBrief({items:[financial]},{now:NOW});assert.equal(ordinary.uniqueGroupCount,0);assert.equal(ordinary.discoveryExcluded,1);
 const expert=buildPriorityBrief({items:[financial]},{now:NOW,includeDiscovery:true}).cards.flatMap(card=>card.items)[0];assert.equal(expert.category,'Oil & market context');assert.equal(expert.title,financial.title);assert.equal(expert.clock.kind,'discovery');assert.equal(expert.report.publishedAt,null);
});
test('mixed publication clocks remain limited even when the newest dated report is recent',()=>{
 const mixed=source({publicationKnown:1,publicationUnknown:1,recordCount:2});assert.equal(mixed.status,'current');assert.equal(mixed.clockCompleteness,'partial');assert.equal(mixed.coverageStatus,'limited');assert.equal(coverage([mixed]).incomplete,true);assert.equal(coverage([mixed]).clockUnknown,true);
});

test('one fresh publisher cannot conceal four missing required publisher statuses',()=>{
 const news={items:[row()],sources:[source({})]},result=briefCoverage(news,{now:NOW}),target=mount();
 assert.equal(result.missingCore.length,4);assert.equal(result.limited,true);assert.equal(result.aggregate.incomplete,true);
 createPriorityView({mount:target,getState:()=>({news,actor:'All'}),now:()=>NOW}).update();assert.doesNotMatch(target.innerHTML,/Source headlines refreshed/);assert.match(target.innerHTML,/No source status received for/);assert.match(target.innerHTML,/Al Jazeera/);
});
test('cold failed request stops saying it is still waiting for reporting',()=>{
 const target=mount();createPriorityView({mount:target,getState:()=>({news:null,actor:'All',failures:{news:true}}),now:()=>NOW}).update();assert.doesNotMatch(target.innerHTML,/Waiting for retrieved reporting/);assert.match(target.innerHTML,/unavailable after a failed request/);
});

test('audited equity-stock headline remains market context through every surviving mechanism consumer',()=>{
 const report=row('cross-surface-stock',{title:'U . S . stocks sink amid tech sell - off , surging oil prices'});
 assert.deepEqual(buildOilSystemState({report,now:NOW}).context.matchedStageIds,[]);
 const graph=buildIntelligence({news:{items:[report]},now:NOW,includeReviewedContext:false});assert.equal(graph.edges.some(edge=>edge.relation==='POTENTIAL_CHANNEL'),false);
 assert.doesNotMatch(reportInspectorMarkup(report),/Inventories &amp; demand|Export availability|Security &amp; insurance/);
 assert.doesNotMatch(reportImpactMarkup(report,null),/Inventories &amp; demand|Export availability|Security &amp; insurance/);
 const title=report.title+' as investors continue to reassess the outlook for global financial markets';
 const summary=summarizeGraphNode({id:report.id,type:'report',label:title,record:report});
 assert.equal(summary.title,'Topic: Oil-market reporting');assert.equal(summary.fullTitle,title);
});
