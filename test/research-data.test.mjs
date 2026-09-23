import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEvidenceGraph,buildTimeline,dateOnly,deriveContext,normalizeAnnotation,normalizeProfile,publicUrl,vesselMatches} from '../dist/research-data.mjs';

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
