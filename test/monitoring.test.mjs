import test from 'node:test';
import assert from 'node:assert/strict';
import {createMonitoringSession,sinceLastLook,groupReporting,replayReporting,watchMatches,createWatch,buildBrief,normalizeMonitoringSettings,filterMonitoringReports,impactTags} from '../dist/monitoring-model.mjs';

const NOW=Date.parse('2026-09-22T12:00:00Z');
const row=(id,extra={})=>({id,url:`https://example.com/${id}`,title:`Report ${id} about shipping through the Strait of Hormuz`,source:'Example',sourceId:'example',theaters:['hormuz'],actors:['Iran'],publishedAt:'2026-09-22T09:00:00Z',firstSeenAt:'2026-09-22T10:00:00Z',lastSeenAt:'2026-09-22T10:00:00Z',...extra});
test('new arrivals wait for explicit acceptance while existing records and source clocks refresh',()=>{
  const session=createMonitoringSession({now:()=>NOW});
  assert.deepEqual(session.ingestNews({items:[row('a')],sources:[{lastSuccess:'old'}]}).items.map(r=>r.id),['a']);
  const next=session.ingestNews({items:[row('b'),row('a',{lastSeenAt:'2026-09-22T11:00:00Z'})],sources:[{lastSuccess:'new'}]});
  assert.deepEqual(next.items.map(r=>r.id),['a']);assert.equal(next.items[0].lastSeenAt,'2026-09-22T11:00:00Z');assert.equal(next.sources[0].lastSuccess,'new');
  assert.deepEqual(session.pending().map(r=>r.id),['b']);
  session.ingestNews({items:[row('b'),row('a')]});assert.equal(session.pending().length,1);
  assert.deepEqual(session.acceptPending().items.map(r=>r.id),['b','a']);assert.equal(session.pending().length,0);
  assert.equal(session.settings().acknowledgedAt,null,'polling and accepting never mark articles read');
});
test('acknowledgment includes accepted reporting only; repeated URLs are not new',()=>{
  const session=createMonitoringSession({now:()=>NOW});session.ingestNews({items:[row('a')]});session.ingestNews({items:[row('a'),row('b')]});
  session.acknowledge();const saved=session.settings();assert.deepEqual(Object.keys(saved.seen),[row('a').url]);
  assert.equal(sinceLastLook([row('a',{url:row('a').url+'?utm_source=mail'}),row('b')],saved,NOW).length,1);
  const reopened=createMonitoringSession({stored:saved,now:()=>NOW});reopened.ingestNews({items:[row('a'),row('b')]});assert.equal(reopened.changes().length,1);
});
test('changes separate publication, older retrieval and unknown dates without inventing dates',()=>{
  const saved={acknowledgedAt:'2026-09-22T08:00:00Z',seen:{}};
  const changes=sinceLastLook([row('new'),row('old',{publishedAt:'2026-09-20T10:00:00Z'}),row('unknown',{publishedAt:null}),row('day',{publishedAt:null,publishedDate:'2026-09-22',publicationPrecision:'day'})],saved,NOW);
  assert.equal(changes.find(x=>x.report.id==='new').kind,'new-publication');
  assert.equal(changes.find(x=>x.report.id==='old').kind,'older-publication');
  assert.equal(changes.find(x=>x.report.id==='unknown').kind,'publication-unknown');
  assert.equal(changes.find(x=>x.report.id==='day').kind,'publication-day');
  assert.equal(sinceLastLook([row('a')],{},NOW).length,0);
});
test('story groups describe exact long headline matches without asserting common origin or event',()=>{
  const a=row('a',{title:'Iran opens shipping negotiations over the Strait of Hormuz',originatingWire:'Reuters'});
  const same=row('a-copy',{url:a.url+'?utm_source=x'});
  const syndicated=row('b',{title:a.title,originatingWire:'Reuters',source:'Other publication'});
  const other=row('c',{title:a.title,source:'Unrelated outlet'});
  const nextDay=row('d',{title:a.title,originatingWire:'Reuters',publishedAt:'2026-09-21T09:00:00Z'});
  const groups=groupReporting([a,same,syndicated,other,nextDay]);
  assert.equal(groups.length,2);assert.equal(groups.find(g=>g.reports.some(r=>r.id==='a')).reports.length,4);
  assert.equal(groups[0].kind,'matching-headlines');
  assert.ok(groups.every(g=>g.independentConfirmation===false));
  assert.equal(groupReporting([row('short1',{title:'Oil rises',originatingWire:'Reuters'}),row('short2',{title:'Oil rises',originatingWire:'Reuters'})]).length,2);
});
test('real retained feed headlines group across domains without wire metadata, preserving individual clocks and links',()=>{
  const records=[
    {id:'bbc',title:'Iran must stop arming Houthis in Yemen, G7 says ahead of UN General Assembly',url:'https://www.bbc.co.uk/news/articles/cwm2qpmepmlzo?at_medium=RSS&at_campaign=rss',publishedAt:'2026-09-22T13:39:09.000Z',publishedDate:null,discoveredAt:null,source:'BBC Middle East'},
    {id:'namibian',title:'Iran must stop arming Houthis in Yemen , G7 says ahead of UN General Assembly',url:'https://www.namibian.com.na/iran-must-stop-arming-houthis-in-yemen-g7-says-ahead-of-un-general-assembly/',publishedAt:null,publishedDate:null,discoveredAt:'2026-09-22T07:45:00.000Z',source:'namibian.com.na'},
  ];
  const session=createMonitoringSession();session.ingestNews({items:records});
  const groups=groupReporting(session.news().items);
  assert.equal(groups.length,1);assert.equal(groups[0].kind,'matching-headlines');assert.equal(groups[0].independentConfirmation,false);
  assert.deepEqual(groups[0].reports,records);assert.equal(groups[0].reports[1].publishedAt,null);
});
test('unknown publication clocks group by text alone but do not bridge known reports on different days',()=>{
  const title='G7 strongly condemns Houthi strikes on Saudi , calls on Iran to end support';
  const unknown=[row('u1',{title,publishedAt:null,discoveredAt:'2026-09-21T01:00:00Z'}),row('u2',{title,publishedAt:null,discoveredAt:'2026-09-22T01:00:00Z'})];
  assert.equal(groupReporting(unknown).length,1);
  const groups=groupReporting([...unknown,row('day1',{title,publishedAt:'2026-09-21T09:00:00Z'}),row('day2',{title,publishedAt:'2026-09-22T09:00:00Z'})]);
  assert.equal(groups.length,3);assert.equal(groups[0].reports.length,2);
  assert.equal(groupReporting([row('event1',{title:'Attack reported on a tanker near the Strait of Hormuz on Tuesday'}),row('event2',{title:'Attack reported on a tanker near the Strait of Hormuz on Wednesday'})]).length,2);
});
test('empty failed snapshots preserve reading positions and clocks until explicitly applied',()=>{
  const session=createMonitoringSession({now:()=>NOW});session.ingestNews({items:[row('a'),row('b')],sources:[{connection:'connected'}]});
  let next=session.ingestNews({items:[row('c'),row('b',{title:'Updated headline about shipping through Hormuz'})],sources:[{connection:'unavailable'}]});
  assert.deepEqual(next.items.map(r=>r.id),['a','b']);assert.equal(next.items[0].retainedForReading,true);assert.equal(next.items[0].lastSeenAt,row('a').lastSeenAt);assert.equal(next.items[1].title,'Updated headline about shipping through Hormuz');
  next=session.ingestNews({items:[],sources:[{connection:'unavailable',lastAttempt:'2026-09-22T12:00:00Z'}]});
  assert.deepEqual(next.items.map(r=>r.id),['a','b']);assert.ok(next.items.every(r=>r.retainedForReading));assert.equal(next.sources[0].lastAttempt,'2026-09-22T12:00:00Z');assert.equal(session.retained().length,2);
  assert.deepEqual(session.acceptPending().items,[]);assert.equal(session.retained().length,0);
});
test('the accepted reading snapshot stays bounded while missing reports and arrivals wait',()=>{
  const session=createMonitoringSession();session.ingestNews({items:Array.from({length:1205},(_,i)=>row('original-'+i))});
  const next=session.ingestNews({items:Array.from({length:1205},(_,i)=>row('new-'+i))});
  assert.equal(next.items.length,1200);assert.equal(session.pending().length,1200);assert.equal(next.items[0].id,'original-0');assert.equal(session.acceptPending().items[0].id,'new-0');
});
test('replay uses first retrieved timestamps and excludes undated archive membership',()=>{
  const result=replayReporting([row('a',{firstSeenAt:'2026-09-22T09:00:00Z'}),row('b',{publishedAt:'2026-09-01T09:00:00Z',firstSeenAt:'2026-09-22T11:00:00Z'}),row('c',{firstSeenAt:null,discoveredAt:'2026-09-21T00:00:00Z'})],'2026-09-22T10:00:00Z',NOW);
  assert.deepEqual(result.items.map(r=>r.id),['a']);assert.equal(result.excludedWithoutRetrieval,1);assert.equal(result.laterCount,1);
  assert.match(result.scope,/reporting archive only/i);assert.match(result.scope,/vessel|market/i);
});
test('watchlist matches exact source tags and excludes baseline articles and globally reviewed URLs',()=>{
  const watch=createWatch('theater','hormuz',[row('a')],NOW-3600000);
  const rows=[row('a'),row('b'),row('c',{theaters:['bab']}),row('d',{theaters:[],relevanceScopes:['global-energy']})];
  assert.deepEqual(watchMatches(rows,watch,{seen:{}}).map(r=>r.id),['b']);
  assert.equal(watchMatches(rows,watch,{seen:{[row('b').url]:'2026-09-22T12:00:00Z'}}).length,0);
  assert.equal(watchMatches([row('i',{actors:['IRGC']})],createWatch('actor','Iran',[],NOW),{}).length,0);
});
test('brief uses linked headlines and latest valid daily oil observations without treating them as live quotes',()=>{
  const brief=buildBrief({news:{items:[row('a')]},oil:{series:[{id:'brent',name:'Brent',url:'https://www.eia.gov/dnav/pet/hist/RBRTEd.htm',observations:[{date:'2026-09-21',value:70},{date:'2026-09-19',value:68},{date:'2026-09-23',value:999}]}]},theater:'hormuz',actor:'All',hours:'all'},NOW);
  assert.equal(brief.reports.length,1);assert.equal(brief.prices[0].date,'2026-09-21');assert.equal(brief.prices[0].value,70);assert.equal(brief.prices[0].change,2);assert.match(brief.speech,/daily spot/);assert.ok(!brief.speech.includes('999'));assert.equal(brief.reports[0].url,row('a').url);
});
test('energy filters keep tagged energy and market context while excluding other regional reporting',()=>{
  const reports=[row('direct',{energy:true}),row('global',{theaters:[],relevanceScopes:['global-energy']}),row('regional',{theaters:[],relevanceScopes:['regional-energy']}),row('other')];
  const state={view:'energy',theater:'hormuz',actor:'All',hours:'all'};
  assert.deepEqual(filterMonitoringReports(reports,state,NOW).map(row=>row.id),['direct','global','regional']);
  assert.deepEqual(buildBrief({...state,news:{items:reports}},NOW).reports.map(row=>row.id),['direct','global','regional']);
});
test('civilian filters use the same actor and headline impact rules as the reading stream',()=>{
  const reports=[row('actor',{title:'Talks continue in the region',actors:['Civilians']}),row('crew',{title:'Crew evacuated from a vessel after an incident'}),row('freight',{title:'Freight premiums climb through the strait'}),row('summary-only',{title:'Diplomats meet in the region',summary:'Crew safety was discussed.'}),row('other',{title:'Diplomats meet in the region'})];
  const state={view:'civilian',theater:'both',actor:'All',hours:'all'};
  assert.deepEqual(filterMonitoringReports(reports,state,NOW).map(row=>row.id),['actor','crew','freight']);
  assert.deepEqual(impactTags('A pipeline bypass could shorten transit time'),['rerouting & time','route exposure','pipeline bypass']);
});
test('searches include separately dated reviewed context and still respect actor and time filters',()=>{
  const reports=[row('review',{title:'Diplomatic discussions continue',reviewedContext:{summary:'The SUMED corridor remains part of the dated assessment.'}}),row('wrong-actor',{reviewedContext:{summary:'SUMED'},actors:['Houthis']}),row('old',{reviewedContext:{summary:'SUMED'},publishedAt:'2026-09-10T09:00:00Z'})];
  assert.deepEqual(filterMonitoringReports(reports,{theater:'both',actor:'Iran',hours:'24',query:'sumed'},NOW).map(row=>row.id),['review']);
});
test('saved briefs read saved rows even when absent from news and bypass only the relevance requirement',()=>{
  const saved=row('saved',{title:'Diplomatic discussions continue',theaters:[],actors:['Iran'],reviewedContext:{summary:'A dated corridor assessment'}});
  const state={view:'saved',theater:'both',actor:'Iran',hours:'24',query:'corridor',saved:{saved},news:{items:[row('news',{reviewedContext:{summary:'corridor'}})]}};
  assert.deepEqual(buildBrief(state,NOW).reports.map(row=>row.id),['saved']);
  assert.equal(filterMonitoringReports([saved],{...state,view:'overview'},NOW).length,0);
  assert.equal(buildBrief({...state,theater:'hormuz'},NOW).reports.length,0);
  assert.equal(buildBrief({...state,actor:'Houthis'},NOW).reports.length,0);
  assert.equal(buildBrief({...state,saved:{saved:{...saved,publishedAt:'2026-09-10T09:00:00Z'}}},NOW).reports.length,0);
  assert.equal(buildBrief({...state,saved:{}},NOW).reports.length,0);
});
test('stored data is bounded and invalid local values are discarded',()=>{
  const stored=normalizeMonitoringSettings({acknowledgedAt:'not-date',seen:{'javascript:alert(1)':'bad'},watches:[{type:'theater',value:'imaginary'}]});
  assert.equal(stored.acknowledgedAt,null);assert.deepEqual(stored.seen,{});assert.deepEqual(stored.watches,[]);
});
test('impossible or future clocks do not become evidence of a new publication or historical receipt',()=>{
  const settings={acknowledgedAt:'2026-09-22T08:00:00Z',seen:{}};
  const changes=sinceLastLook([row('future',{publishedAt:'2026-09-23T09:00:00Z'}),row('rollover',{publishedAt:'2026-02-30T09:00:00Z'})],settings,NOW);
  assert.ok(changes.every(change=>change.kind==='publication-unknown'));
  assert.equal(replayReporting([row('future',{firstSeenAt:'2026-09-23T09:00:00Z'}),row('rollover',{firstSeenAt:'2026-02-30T09:00:00Z'})],NOW,NOW).items.length,0);
});
