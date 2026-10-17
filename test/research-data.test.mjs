import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEvidenceGraph,buildTimeline,dateOnly,deriveContext,normalizeAnnotation,normalizeProfile,publicUrl,vesselMatches} from '../dist/research-data.mjs';
import * as researchData from '../dist/research-data.mjs';

const NOW=Date.parse('2026-09-13T18:00:00Z');
const report=(id,title,publishedAt='2026-09-12T10:00:00Z',extra={})=>({id,title,url:`https://example.test/${id}`,source:'Fixture',publishedAt,theaters:['bab'],actors:[],...extra});
test('date and public URL helpers reject malformed or credential-bearing values',()=>{
  assert.equal(dateOnly('2026-09-01'),'2026-09-01');assert.equal(dateOnly('2026-02-31'),null);assert.equal(publicUrl('https://example.test/story'),'https://example.test/story');assert.equal(publicUrl('javascript:alert(1)'),null);assert.equal(publicUrl('https://example.test/?access_token=secret'),null);assert.equal(publicUrl('https://user:pass@example.test/story'),null);
});
test('context extraction records actors, places and disruption terms without attribution',()=>{
  const context=deriveContext('Houthi drone attack near Bab el-Mandeb','Civilian crew rerouted from Aden');const ids=context.mentions.map(item=>item.entityId);assert.ok(ids.includes('houthis'));assert.ok(ids.includes('bab-chokepoint'));assert.ok(ids.includes('civilians'));assert.ok(ids.includes('aden'));assert.deepEqual(context.disruptionMatches.sort(),['attack','drone','rerouted'].sort());
});
test('evidence graph keeps source URL and matching field provenance',()=>{
  const item=report('one','Iran and Houthi forces discuss shipping attack near Hormuz','2026-09-12T10:00:00Z',{theaters:['hormuz'],actors:['Iran','Houthis']});const graph=buildEvidenceGraph([item]);assert.equal(graph.reports.length,1);assert.ok(graph.edges.length>=3);assert.ok(graph.edges.every(edge=>edge.sourceUrl===item.url));assert.ok(graph.edges.some(edge=>edge.basis==='headline'));assert.ok(graph.allEntities.some(entity=>entity.label==='Strait of Hormuz'));
});
test('evidence graph pagination and entity filtering are bounded',()=>{
  const items=Array.from({length:25},(_,i)=>report(String(i),`Houthi disruption ${i}`,'2026-09-12T10:00:00Z'));const page=buildEvidenceGraph(items,{limit:12,offset:12});assert.equal(page.reports.length,12);assert.equal(page.totalReports,25);const filtered=buildEvidenceGraph(items,{entityId:'houthis'});assert.equal(filtered.totalReports,25);assert.ok(filtered.edges.every(edge=>['houthis','theater:bab'].includes(edge.to)));
});
test('timeline retains price gaps and only disruption headlines',()=>{
  const records=[report('attack','Ship attack reported','2026-09-12T10:00:00Z'),report('quiet','Routine shipping update','2026-09-12T11:00:00Z')];const series=[{id:'brent',observations:[{date:'2026-09-12',value:80}]},{id:'wti',observations:[]}];const timeline=buildTimeline(records,series,{days:7,now:NOW,onlyDisruptions:true});assert.equal(timeline.rows.length,7);assert.equal(timeline.reportCount,1);assert.equal(timeline.rows.at(-2).prices.brent,80);assert.equal(timeline.rows.at(-1).prices.brent,null);
});
test('event-basis timeline counts an analyst date and reports missing annotations',()=>{
  const item=report('one','Missile strike reported','2026-09-12T10:00:00Z');const timeline=buildTimeline([item],[],{days:30,now:NOW,basis:'event',annotations:{one:{eventDate:'2026-09-10'}}});assert.equal(timeline.reportCount,1);assert.equal(timeline.rows.find(row=>row.date==='2026-09-10').reports[0].basis,'Analyst-entered event date');const missing=buildTimeline([item],[],{days:30,now:NOW,basis:'event'});assert.equal(missing.reportCount,0);assert.equal(missing.missingEventDates,1);
});
test('vessel profile validation preserves safe links and snapshots',()=>{
  const profile=normalizeProfile({mmsi:'123456789',name:'MV Example',imo:'1234567',theater:'hormuz',notes:'review',links:[{url:'https://example.test/story',title:'Story'},{url:'https://example.test/story',title:'Duplicate'},{url:'https://example.test/?token=x'}],snapshot:{mmsi:'123456789',name:'MV Example',latitude:26,longitude:56,theater:'hormuz',positionTime:'2026-09-13T17:00:00Z',receivedAt:'2026-09-13T17:01:00Z',sourceAt:'2026-09-13T17:00:30Z'}},new Date(NOW).toISOString());assert.equal(profile.links.length,1);assert.equal(profile.snapshot.timestampBasis,'provider');assert.equal(profile.theater,'hormuz');assert.throws(()=>normalizeProfile({mmsi:'123'}));
});
test('vessel name matches are review leads and identifier matches are explicit',()=>{
  const records=[report('one','MV Example rerouted'),report('two','MMSI 123456789 appears')];const matches=vesselMatches({mmsi:'123456789',name:'MV Example'},records);assert.equal(matches.length,2);assert.ok(matches.some(match=>match.basis==='MMSI mention'));assert.ok(matches.some(match=>match.basis.includes('Name match')));
});
test('publication clocks preserve day precision and never substitute discovery dates',()=>{
  const publication=researchData.reportPublication;
  assert.equal(typeof publication,'function');
  for(const row of [
    {publishedDate:'2026-09-12',publishedAt:null},
    {publicationDate:'2026-09-12',publishedAt:'2026-09-12T00:00:00.000Z',publicationPrecision:'day'},
    {publishedAt:'2026-09-12',publicationPrecision:'day'},
  ])assert.deepEqual(publication(row),{value:'2026-09-12',precision:'day',at:Date.parse('2026-09-12T00:00:00Z'),date:'2026-09-12'});
  const exact='2026-09-12T01:00:00+03:00';
  assert.deepEqual(publication({publishedAt:exact}),{value:exact,precision:'timestamp',at:Date.parse(exact),date:'2026-09-11'});
  for(const row of [{discoveredAt:'2026-09-12T10:00:00Z'},{publishedAt:'2026-02-30T10:00:00Z'},{publishedDate:'2026-02-30'},{publishedAt:'2026-09-12T10:00:00'}])assert.equal(publication(row),null);
});
test('date-only reports remain in research and annotations without invented publication timestamps',()=>{
  const day=report('day','Houthi shipping attack',null,{publishedDate:'2026-09-12',publicationPrecision:'day',discoveredAt:'2026-09-13T10:00:00Z'}),before=structuredClone(day);
  const unknown=report('unknown','Houthi shipping attack',null,{discoveredAt:'2026-09-13T10:00:00Z'});
  const future=report('future','Houthi shipping attack',null,{publishedDate:'2026-09-14',publicationPrecision:'day'});
  assert.deepEqual(researchData.uniqueReports([day,unknown,future],NOW),[day,unknown]);
  const graph=buildEvidenceGraph([day]);assert.equal(graph.reports.length,1);assert.equal(graph.reports[0].publishedAt,null);
  assert.ok(graph.edges.every(edge=>edge.publishedAt===null&&edge.publishedDate==='2026-09-12'&&edge.publicationPrecision==='day'));
  const timeline=buildTimeline([day,unknown,future],[],{days:7,now:NOW});assert.equal(timeline.reportCount,1);assert.equal(timeline.rows.find(row=>row.reports.length).date,'2026-09-12');
  assert.equal(normalizeAnnotation({eventDate:'2026-09-11',note:'Dated source'},day,NOW).report.publishedAt,null);
  assert.deepEqual(day,before);
});
test('every offered timeline window is honored, including 365 days',()=>{
  const old=report('old','Shipping attack','2026-03-01T10:00:00Z');
  for(const days of [7,30,90,180,365])assert.equal(buildTimeline([old],[],{days,now:NOW}).rows.length,days);
  assert.equal(buildTimeline([old],[],{days:365,now:NOW}).reportCount,1);
  assert.equal(buildTimeline([old],[],{days:30,now:NOW}).reportCount,0);
});

test('undated evidence remains browsable, linkable and eligible for vessel matching without borrowing discovery time',()=>{
  const unknown=report('undated','MV Example Houthi shipping report',null,{discoveredAt:'2026-09-13T11:00:00Z'});
  const dated=report('dated','MV Example Iran shipping report');
  const before=structuredClone(unknown);
  const graph=buildEvidenceGraph([unknown,dated],{now:NOW});
  assert.deepEqual(graph.reports.map(item=>item.id),['dated','undated']);
  assert.equal(graph.unknownPublicationCount,1);
  assert.ok(graph.edges.some(edge=>edge.reportId==='undated'));
  assert.ok(graph.edges.filter(edge=>edge.reportId==='undated').every(edge=>edge.publishedAt===null&&edge.publishedDate===null&&edge.publicationPrecision==='unknown'));
  assert.equal(vesselMatches({mmsi:'123456789',name:'MV Example'},[unknown]).length,1);
  assert.equal(normalizeAnnotation({eventDate:'2026-09-10'},unknown,NOW).report.publishedAt,null);
  const timeline=buildTimeline([unknown],[],{days:7,now:NOW,onlyDisruptions:false});
  assert.equal(timeline.reportCount,0);
  assert.equal(timeline.missingPublicationDates,1);
  assert.equal(timeline.missingEventDates,0);
  assert.deepEqual(timeline.omittedReports,[{report:unknown,reason:'publication-date-unknown',label:'Publication date unknown',date:null}]);
  assert.ok(timeline.rows.every(row=>!row.reports.length));
  assert.deepEqual(unknown,before);
});

test('timeline accounting reconciles source input, eligibility, placed reports and reasoned omissions',()=>{
  const dated=report('dated','Ship attack reported'),undated=report('unknown','Ship attack reported',null,{discoveredAt:'2026-09-12T10:00:00Z'});
  const old=report('old','Ship attack reported','2026-08-01T10:00:00Z'),filtered=report('filtered','Routine shipping update',null);
  const future=report('future','Ship attack reported','2026-09-15T10:00:00Z');
  const timeline=buildTimeline([dated,undated,old,filtered,future,{...dated,id:'duplicate'},{id:'invalid',title:'Ship attack reported',url:'javascript:alert(1)'},null],[],{days:7,now:NOW});
  assert.equal(timeline.inputReportCount,8);
  assert.equal(timeline.invalidReportCount,2);
  assert.equal(timeline.futurePublicationCount,1);
  assert.equal(timeline.duplicateReportCount,1);
  assert.equal(timeline.uniqueReportCount,4);
  assert.equal(timeline.filteredOutCount,1);
  assert.equal(timeline.eligibleReportCount,3);
  assert.equal(timeline.reportCount,1);
  assert.equal(timeline.unplacedReportCount,1);
  assert.equal(timeline.outsideWindowCount,1);
  assert.equal(timeline.omittedReportCount,2);
  assert.equal(timeline.inputReportCount,timeline.invalidReportCount+timeline.futurePublicationCount+timeline.duplicateReportCount+timeline.uniqueReportCount);
  assert.equal(timeline.uniqueReportCount,timeline.filteredOutCount+timeline.eligibleReportCount);
  assert.equal(timeline.eligibleReportCount,timeline.reportCount+timeline.omittedReportCount);
  assert.equal(Object.values(timeline.omissionCounts).reduce((sum,count)=>sum+count,0),timeline.omittedReportCount);
  assert.deepEqual(timeline.omittedReports.map(item=>[item.report.id,item.reason]),[['old','outside-window'],['unknown','publication-date-unknown']]);
});

test('event timeline accepts an analyst event date on undated evidence and distinguishes missing, invalid and future dates',()=>{
  const records=['placed','missing','invalid','future'].map(id=>report(id,'Ship attack reported',null,{discoveredAt:'2026-09-12T10:00:00Z'}));
  const timeline=buildTimeline(records,[],{days:7,now:NOW,basis:'event',annotations:{placed:{eventDate:'2026-09-10'},invalid:{eventDate:'2026-02-30'},future:{eventDate:'2026-09-14'}}});
  assert.equal(timeline.reportCount,1);
  assert.equal(timeline.rows.find(row=>row.reports.length).date,'2026-09-10');
  assert.equal(timeline.rows.find(row=>row.reports.length).reports[0].report.publishedAt,null);
  assert.equal(timeline.unknownPublicationCount,4);
  assert.equal(timeline.missingPublicationDates,0,'publication is not the selected time axis');
  assert.equal(timeline.missingEventDates,2);
  assert.equal(timeline.unplacedReportCount,3);
  assert.deepEqual(timeline.omittedReports.map(item=>item.reason),['event-date-missing','event-date-invalid','event-date-future']);
});

test('price rows retain provider missingness separately from omitted dates, with last duplicate winning',()=>{
  const observations=[{date:'2026-09-09',value:80},{date:'2026-09-10',value:null},{date:'2026-09-12',value:81},{date:'2026-09-12',value:null},{date:'2026-09-13',value:0}];
  const timeline=buildTimeline([],[{id:'brent',observations}],{days:7,now:NOW});
  const row=date=>timeline.rows.find(row=>row.date===date);
  assert.equal(row('2026-09-09').priceStatus.brent,'observed');
  assert.equal(row('2026-09-10').priceStatus.brent,'missing');
  assert.equal(row('2026-09-11').priceStatus.brent,'omitted');
  assert.equal(row('2026-09-12').prices.brent,null);
  assert.equal(row('2026-09-12').priceStatus.brent,'missing');
  assert.equal(row('2026-09-13').prices.brent,0);
  assert.equal(row('2026-09-13').priceStatus.brent,'observed');
  assert.ok(timeline.rows.every(row=>row.priceStatus.wti==='omitted'));
});

test('a dated duplicate can resolve an undated link without using its discovery clock',()=>{
  const unknown=report('unknown','Houthi shipping report',null,{discoveredAt:'2026-09-13T11:00:00Z'});
  const dated={...unknown,id:'dated',publishedDate:'2026-09-12',publicationPrecision:'day'};
  for(const records of [[unknown,dated],[dated,unknown]]){
    const graph=buildEvidenceGraph(records,{now:NOW});
    assert.equal(graph.totalReports,1);
    assert.equal(graph.duplicateReportCount,1);
    assert.equal(graph.unknownPublicationCount,0);
    assert.equal(researchData.reportPublication(graph.reports[0]).date,'2026-09-12');
  }
});

test('audited financial metaphor is not a disruption keyword, including stale cached keyword tags',()=>{
 const title='U . S . stocks sink amid tech sell - off , surging oil prices';
 assert.deepEqual(deriveContext(title).disruptionMatches,[]);
 const row={id:'stock-sink',title,url:'https://example.com/stock-sink',publishedAt:'2026-09-13T10:00:00Z',disruptionMatches:['sink']};
 assert.equal(buildTimeline([row],[],{days:7,now:NOW}).reportCount,0);
 assert.equal(buildTimeline([row],[],{days:7,now:NOW,onlyDisruptions:false}).reportCount,1);
 assert.ok(deriveContext('Stocks sink after a tanker sinks in Hormuz').disruptionMatches.includes('sinks'));
});
