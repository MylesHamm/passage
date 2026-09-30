import test from 'node:test';import assert from 'node:assert/strict';
import {collectSources,coverage,statusSummary,panelNotice,sourceHealth,ageSeconds,SOURCE_DEFINITIONS} from '../dist/source-health.mjs';
const now=Date.parse('2026-09-13T18:00:00Z');
const connected={connection:'connected',retrievedAt:'2026-09-13T17:00:00Z'};
test('source inventory stays stable through first load and configuration',()=>{
 const loading=collectSources({},now);assert.equal(loading.length,28);assert.equal(statusSummary(loading),'Checking source coverage');
 const configured=collectSources({config:{aisstream:true,reliefweb:false}},now);assert.equal(configured.length,28);assert.equal(statusSummary(configured),'Checking source coverage');assert.equal(configured.find(s=>s.id==='reliefweb').label,'Not configured');
});
test('free regional publisher sources have unique public health identities',()=>{
 assert.equal(new Set(SOURCE_DEFINITIONS.map(source=>source.id)).size,SOURCE_DEFINITIONS.length);
 for(const [id,name] of [['mee','Middle East Eye'],['memo','Middle East Monitor'],['france24','France 24 Middle East']]){
  const source=collectSources({},now).find(source=>source.id===id);
  assert.ok(source,id);assert.equal(source.name,name);assert.equal(source.group,'news');
  assert.equal(source.interval,300);assert.equal(source.configured,true);assert.equal(source.status,'loading');
 }
});
test('cold failures are unknown coverage, not successful empty reporting',()=>{
 const sources=collectSources({config:{aisstream:false,reliefweb:false},failures:{news:true}},now);const c=coverage(sources);assert.equal(c.unknown,true);assert.equal(c.empty,false);assert.equal(c.label,'Reporting unavailable');assert.match(panelNotice(sources,'news'),/No usable data/);
});
test('warm failures preserve readable data and identify incomplete coverage',()=>{
 const state={config:{reliefweb:false},news:{items:[{sourceId:'bbc',publishedAt:'2026-09-13T17:00:00Z'}],sources:[{id:'bbc',...connected}]},failures:{news:true}};
 const sources=collectSources(state,now),bbc=sources.find(s=>s.id==='bbc');assert.equal(bbc.status,'retained');assert.equal(bbc.hasData,true);assert.equal(coverage(sources).unknown,false);assert.equal(coverage(sources).incomplete,true);assert.match(panelNotice(sources,'news'),/Previously retrieved/);
});
test('successful empty feeds and all-empty outage have distinct states',()=>{
 const news={items:[],sources:SOURCE_DEFINITIONS.filter(s=>['news','discovery'].includes(s.group)&&s.id!=='reliefweb').map(({id})=>({id,...connected,recordCount:0,latest:'2026-09-13T17:00:00Z',retrievedAt:'2026-09-13T17:59:00Z'}))};const sources=collectSources({config:{reliefweb:false},news},now);assert.equal(coverage(sources).empty,true);assert.equal(coverage(sources).unknown,false);
});
test('relevant publication ages independently from newest general feed item',()=>{
 const state={news:{items:[{sourceId:'un',publishedAt:'2026-09-10T12:00:00Z'}],sources:[{id:'un',...connected,latest:'2026-09-13T17:00:00Z'}]}};
 const un=collectSources(state,now).find(s=>s.id==='un');assert.equal(un.freshness,'stale');assert.equal(un.latest,'2026-09-13T17:00:00Z');assert.equal(un.latestRelevant,'2026-09-10T12:00:00Z');
});
test('AIS missing provider time is unknown even if receipt is recent',()=>{
 const s=sourceHealth({id:'aisstream',group:'vessels',configured:true,...connected,latest:'2026-09-13T17:59:00Z',timestampBasis:'received',recordCount:1},now);assert.equal(s.freshness,'unknown');assert.equal(s.attention,true);
});
test('empty AIS is an explicit reception gap, not healthy usable data',()=>{
 const sources=collectSources({vessels:{configured:true,vessels:[],source:{id:'aisstream',...connected,frames:1,positionFrames:0}}},now);const ais=sources.find(s=>s.id==='aisstream');assert.equal(ais.status,'empty');assert.equal(ais.attention,true);assert.match(ais.label,/no vessel positions received/);
});
test('AIS with position frames but no retained vessel keeps the usable-position warning',()=>{
 const sources=collectSources({vessels:{configured:true,vessels:[],source:{id:'aisstream',...connected,frames:4,positionFrames:3}}},now);const ais=sources.find(s=>s.id==='aisstream');assert.equal(ais.status,'empty');assert.match(ais.label,/No usable positions/);
});
test('Open Waters fallback is reported as its own current vessel source',()=>{
 const sources=collectSources({vessels:{configured:true,vessels:[{provider:'Open Waters',latitude:25,longitude:55,positionTime:'2026-09-13T17:59:00Z',sourceAt:'2026-09-13T17:59:00Z',timestampBasis:'provider'}],source:{id:'aisstream',...connected},fallback:{id:'openwaters',...connected,recordCount:2,latest:'2026-09-13T17:59:00Z',timestampBasis:'provider'}}},now);const open=sources.find(s=>s.id==='openwaters');assert.equal(open.status,'current');assert.equal(open.hasData,true);assert.match(open.label,/Data available/);
});
test('ages advance from the clock without refreshing retained source objects',()=>{
 const s={id:'bbc',group:'news',configured:true,...connected,retrievedAt:'2026-09-13T17:59:00Z',recordCount:1,latestRelevant:'2026-09-10T18:00:01Z'};assert.equal(sourceHealth(s,now).status,'current');assert.equal(sourceHealth(s,now+2000).status,'stale');assert.equal(s.freshness,undefined);
});
test('a partial failure does not describe other fresh sources as cached',()=>{
 const state={config:{reliefweb:false},news:{items:[{sourceId:'aj',publishedAt:'2026-09-13T17:00:00Z'}],sources:[{id:'bbc',connection:'unavailable'},{id:'aj',...connected}]}};const message=panelNotice(collectSources(state,now),'news');assert.match(message,/Available source data/);assert.ok(!message.includes('Previously retrieved'));
});

test('both vessel sources become stale after ten minutes and always have a label',()=>{
 for(const id of ['aisstream','openwaters']) {
  const s=sourceHealth({id,group:'vessels',configured:true,...connected,latest:'2026-09-13T17:50:00Z',timestampBasis:'provider',recordCount:1},now);
  assert.equal(s.status,'stale');assert.equal(s.attention,true);assert.equal(s.label,'Position data over 10 minutes old');
 }
});
test('empty labels identify the relevant feed rather than describing every source as vessels',()=>{
 const labels={news:'Source checked · no relevant reports',oil:'No usable price observations',weather:'No usable forecast data',maritime:'Source checked · no listed records'};
 for(const [group,label] of Object.entries(labels)) assert.equal(sourceHealth({id:'example',group,configured:true,...connected,retrievedAt:'2026-09-13T17:59:00Z',recordCount:0},now).label,label);
});
test('incident register freshness follows retrieval while retaining event age independently',()=>{
 const source={id:'imo-hormuz',...connected,latest:'2026-08-01',recordCount:2};
 const s=collectSources({maritime:{sources:[source]}},now).find(s=>s.id===source.id);
 assert.equal(s.status,'current');assert.equal(s.contentAgeSeconds,43.75*86400);assert.equal(s.retrievalAgeSeconds,3600);assert.equal(s.label,'Official source available');
 const stale=sourceHealth({...s,retrievedAt:'2026-09-12T18:00:00Z'},now);
 assert.equal(stale.status,'stale');assert.equal(stale.label,'Source check over 24 hours old');
 const failed=collectSources({maritime:{sources:[source]},failures:{maritime:true}},now).find(s=>s.id===source.id);
 assert.equal(failed.status,'retained');assert.equal(failed.hasData,true);
});

test('an old empty incident register still needs a new source check',()=>{
 const s=sourceHealth({id:'imo-redsea',group:'maritime',configured:true,...connected,retrievedAt:'2026-09-12T17:00:00Z',recordCount:0},now);
 assert.equal(s.status,'stale');assert.equal(s.hasData,false);assert.equal(s.attention,true);
});
test('materially future timestamps do not look like fresh observations',()=>{
 assert.equal(ageSeconds('2026-09-14T18:00:00Z',now),null);
 assert.equal(ageSeconds('2026-09-13T18:00:30Z',now),0);
 const s=sourceHealth({id:'openwaters',group:'vessels',configured:true,...connected,recordCount:1,latest:'2026-09-14T18:00:00Z'},now);
 assert.equal(s.freshness,'unknown');assert.equal(s.attention,true);
});

test('expired cached vessel counts cannot claim currently usable provider positions',()=>{
 const state={vessels:{configured:true,vessels:[{provider:'Open Waters',latitude:25,longitude:55,positionTime:'2026-09-13T17:20:00Z',sourceAt:'2026-09-13T17:20:00Z'}],fallback:{id:'openwaters',...connected,recordCount:1,latest:'2026-09-13T17:20:00Z'}}};
 const s=collectSources(state,now).find(s=>s.id==='openwaters');assert.equal(s.recordCount,0);assert.equal(s.hasData,false);assert.equal(s.latest,null);
});

test('successful ACLED access does not hide a stale event window',()=>{
 const state=sourceHealth({id:'acled',group:'acled',configured:true,connection:'connected',recordCount:22,sampleOnly:false,retrievedAt:'2026-09-13T10:00:00Z',latest:'2025-09-14'},Date.parse('2026-09-13T12:00:00Z'));
 assert.equal(state.status,'stale');assert.match(state.label,/Older/);
});
test('discovery health separates retrieval freshness from unknown publication dates',()=>{
 const s=sourceHealth({...SOURCE_DEFINITIONS.find(x=>x.id==='gdelt-hormuz'),configured:true,connection:'connected',retrievedAt:'2026-09-13T17:59:00Z',recordCount:2,latestDiscoveredAt:'2026-09-13T16:00:00Z'},now);
 assert.equal(s.status,'current');assert.equal(s.contentAgeSeconds,null);assert.equal(s.discoveryAgeSeconds,7200);assert.match(s.label,/publication dates unknown/);
 const failed=sourceHealth({...s,connection:'cached'},now);assert.equal(failed.status,'retained');assert.match(failed.label,/Retained discovery/);
 const stale=sourceHealth({...s,recordCount:0,retrievedAt:'2026-09-13T16:00:00Z'},now);assert.equal(stale.status,'stale');
});
test('deduplicated reports do not erase successful individual source counts',()=>{
 const sources=collectSources({news:{items:[{sourceId:'bbc',publishedAt:'2026-09-13T17:59:00Z'}],sources:[{id:'aj',...connected,recordCount:1,latestRelevant:'2026-09-13T17:59:00Z'}]}},now);
 assert.equal(sources.find(s=>s.id==='aj').hasData,true);
});
test('older publication dates are visible without being classified as broken transport',()=>{
 for(const group of ['news','acled']){
  const old=sourceHealth({id:group==='news'?'centcom':'acled',group,configured:true,...connected,retrievedAt:'2026-09-13T17:59:00Z',recordCount:4,latestRelevant:'2026-09-01',latest:'2026-09-01',sampleOnly:false},now);
  assert.equal(old.status,'stale');assert.equal(old.freshness,'stale');assert.equal(old.attention,false);assert.equal(old.attentionReason,null);assert.equal(old.coverageStatus,'limited');
  assert.match(old.label,/older/i);assert.equal(statusSummary([old]),'Sources responding · older material available');
  const failed=sourceHealth({...old,connection:'cached',errorCategory:'network'},now);assert.equal(failed.attention,true);assert.equal(failed.attentionReason,'update');assert.match(statusSummary([failed]),/updates incomplete/);
 }
});
test('source summary describes reception gaps and preserves other available vessel coverage',()=>{
 const gap=sourceHealth({id:'aisstream',group:'vessels',configured:true,...connected,recordCount:0,positionFrames:0},now);
 const available=sourceHealth({id:'openwaters',group:'vessels',configured:true,...connected,recordCount:20,latest:'2026-09-13T17:59:00Z'},now);
 assert.equal(gap.attentionReason,'reception');assert.equal(gap.coverageStatus,'limited');assert.equal(available.coverageStatus,'available');
 assert.equal(statusSummary([gap,available]),'Vessel reception limited');assert.match(panelNotice([gap,available],'vessels'),/responding feeds/);assert.match(panelNotice([gap,available],'vessels'),/not.*complete traffic census/);
});
test('failed checks and cache problems remain explicit even with recent records',()=>{
 const source=sourceHealth({id:'bbc',group:'news',configured:true,...connected,retrievedAt:'2026-09-13T17:59:00Z',recordCount:1,latestRelevant:'2026-09-13T17:59:00Z',cacheIssue:'Local cache could not be saved.'},now);
 assert.equal(source.attention,true);assert.equal(source.attentionReason,'cache');assert.match(statusSummary([source]),/cache needs attention/);
 const overdue=sourceHealth({id:'imo-hormuz',group:'maritime',configured:true,...connected,retrievedAt:'2026-09-11T17:00:00Z',recordCount:1,latest:'2026-09-13'},now);
 assert.equal(overdue.attentionReason,'check');assert.equal(statusSummary([overdue]),'Some source checks are overdue');
});
test('weekly market observations use their own dates and configured EIA connection',()=>{
 const market={series:[{id:'crude-stocks',...connected,observations:[{date:'2026-09-04',value:1}]},{id:'refinery-use',...connected,observations:[{date:'2026-09-04',value:2}]}]};
 const sources=collectSources({config:{eia:true},market},now).filter(s=>s.group==='market');
 assert.equal(sources.length,2);assert.ok(sources.every(s=>s.configured&&s.status==='current'&&s.recordCount===1&&s.latest==='2026-09-04'));
 const failed=collectSources({config:{eia:true},market,failures:{market:true}},now).filter(s=>s.group==='market');assert.ok(failed.every(s=>s.status==='retained'&&s.attentionReason==='update'));
 const disabled=collectSources({config:{eia:false},market},now).filter(s=>s.group==='market');assert.ok(disabled.every(s=>s.status==='disabled'&&!s.hasData));
});
test('a deliberately idle AIS feed is paused, not a failed refresh',()=>{
 const paused=sourceHealth({id:'aisstream',group:'vessels',configured:true,connection:'idle',recordCount:3,retrievedAt:'2026-09-13T17:59:00Z',latest:'2026-09-13T17:59:00Z',timestampBasis:'provider'},now);
 assert.equal(paused.status,'paused');assert.equal(paused.attention,false);assert.equal(paused.coverageStatus,'limited');assert.match(paused.label,/paused/);assert.ok(!paused.label.includes('failed'));assert.equal(statusSummary([paused]),'Vessel reception paused');
 const reconnecting=sourceHealth({...paused,connection:'connecting'},now);assert.equal(reconnecting.status,'loading');assert.equal(reconnecting.attention,false);
});
test('publication-age exemption requires a recent successful source check',()=>{
 const old=sourceHealth({...SOURCE_DEFINITIONS.find(s=>s.id==='centcom'),configured:true,connection:'connected',recordCount:3,retrievedAt:'2026-09-13T16:59:59Z',latestRelevant:'2026-09-01'},now);
 assert.equal(old.status,'stale');assert.equal(old.attentionReason,'check');assert.equal(old.checkOverdue,true);assert.match(old.label,/check.*overdue/i);assert.equal(statusSummary([old]),'Some source checks are overdue');
 const recent=sourceHealth({...old,retrievedAt:'2026-09-13T17:59:00Z'},now);assert.equal(recent.checkOverdue,false);assert.equal(recent.attention,false);assert.match(recent.label,/older relevant reports/);
});
test('ACLED health explicitly names the date of its latest accessible event',()=>{
 const s=sourceHealth({...SOURCE_DEFINITIONS.find(s=>s.id==='acled'),configured:true,connection:'connected',sampleOnly:false,recordCount:51,retrievedAt:'2026-09-13T17:59:00Z',latest:'2025-09-22'},now);
 assert.match(s.label,/Older structured events/);assert.match(s.label,/2025-09-22/);assert.equal(s.attention,false);
 const overdue=sourceHealth({...s,retrievedAt:'2026-09-13T14:00:00Z'},now);assert.equal(overdue.attentionReason,'check');assert.match(overdue.label,/check.*overdue/i);assert.match(overdue.label,/2025-09-22/);
});
test('shared discovery pause is one brief provider notice while other failures keep their names',()=>{
 const delayed=SOURCE_DEFINITIONS.filter(s=>s.group==='discovery').map(s=>sourceHealth({...s,configured:true,connection:'cached',errorCategory:'rate_limit',recordCount:3,retrievedAt:'2026-09-13T17:59:00Z'},now));
 const notice=panelNotice(delayed,'news');assert.equal(notice,'GDELT discovery: update delayed. Retained reporting is shown. Inspect Sources.');assert.ok(!notice.includes('Hormuz'));
 const failed=sourceHealth({id:'bbc',name:'BBC Middle East',group:'news',configured:true,connection:'unavailable',recordCount:0},now);
 const mixed=panelNotice([...delayed,failed],'news');assert.match(mixed,/GDELT discovery, BBC Middle East/);assert.ok(!mixed.includes('Red Sea discovery'));
});
test('Doomberg publishing cadence is separate from source checks and failed transport',()=>{
 const def=SOURCE_DEFINITIONS.find(s=>s.id==='doomberg');
 const recent=sourceHealth({...def,configured:true,...connected,recordCount:2,retrievedAt:'2026-09-13T17:59:00Z',latestRelevant:'2026-09-06'},now);
 assert.equal(recent.status,'current');assert.match(recent.limitations,/previews only/);
 const old=sourceHealth({...recent,latestRelevant:'2026-08-20'},now);assert.equal(old.status,'stale');assert.equal(old.attention,false);
 const failed=sourceHealth({...recent,connection:'cached'},now);assert.equal(failed.status,'retained');assert.equal(failed.attention,true);
 const overdue=sourceHealth({...recent,retrievedAt:'2026-09-13T14:59:59Z'},now);assert.equal(overdue.checkOverdue,true);assert.equal(overdue.attention,true);
});


test('preferred-source checks disclose new-post discovery gap and expectations preserve failures',()=>{
 const state={sourceWatch:{source:{id:'hormuz-letter',connection:'connected',recordCount:2,retrievedAt:'2026-09-13T17:59:00Z'}},expectations:{source:{id:'polymarket',connection:'connected',recordCount:5,retrievedAt:'2026-09-13T17:59:00Z'}}};
 const sources=collectSources(state,now),watch=sources.find(s=>s.id==='hormuz-letter');
 assert.equal(watch.coverageStatus,'limited');assert.match(watch.label,/new-post discovery unavailable/);assert.equal(watch.attention,false);
 const failed=collectSources({...state,failures:{expectations:true}},now).find(s=>s.id==='polymarket');
 assert.equal(failed.status,'retained');assert.equal(failed.recordCount,5);assert.equal(failed.retrievedAt,'2026-09-13T17:59:00Z');
});
