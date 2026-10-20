import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSources,sourceHealth} from '../dist/source-health.mjs';
import {availableSources,sourceRosterMarkup} from '../dist/source-roster.mjs';
import {isActivePublisherReport} from '../dist/reporting-view.mjs';
const now=Date.parse('2026-10-19T16:00:00Z');
const source=sourceHealth({id:'bbc',name:'BBC Middle East',home:'https://www.bbc.com/news/world/middle_east',group:'news',configured:true,connection:'connected',recordCount:1,retrievedAt:'2026-10-19T15:59:00Z',latestRelevant:'2026-10-16T05:00:17Z'},now);
test('source roster includes responding publishers without treating older stories as an outage',()=>{
 const failed=sourceHealth({...source,id:'aj',connection:'cached',errorCategory:'network'},now),retired={...source,id:'marad-advisories',configured:false,retired:true};
 assert.deepEqual(availableSources([source,failed,retired]).map(s=>s.id),['bbc']);
 const html=sourceRosterMarkup([source,failed,retired]);assert.match(html,/BBC Middle East/);assert.match(html,/No recent relevant reports/);assert.doesNotMatch(html,/failed|network|MARAD|marad-advisories/);
});
test('a fully unavailable roster does not imply no events or complete coverage',()=>{
 assert.match(sourceRosterMarkup([]),/No current source updates/);assert.match(sourceRosterMarkup([]),/does not establish that no events occurred/i);
 assert.doesNotMatch(sourceRosterMarkup([]),/Historical evidence|archive|Checking/);
});
test('an empty roster describes pending source checks and configuration as checking',()=>{
 const initial=collectSources({},now);
 for(const sources of [initial,initial.filter(s=>s.configured===true),initial.filter(s=>s.configured===null)]){
  const html=sourceRosterMarkup(sources);
  assert.match(html,/Checking source updates/);assert.match(html,/Coverage is not yet established/);
  assert.doesNotMatch(html,/No current source updates/);
 }
});
test('failed unknown configuration does not keep the roster in a loading state',()=>{
 const sources=collectSources({failures:{config:true}},now).filter(s=>s.optional);
 const html=sourceRosterMarkup(sources);
 assert.match(html,/No current source updates/);assert.doesNotMatch(html,/Checking/);
 assert.ok(sources.every(s=>s.configured===null));
});
test('available sources remain visible while other sources are pending',()=>{
 const pending=collectSources({},now).find(s=>s.id==='aj');
 const html=sourceRosterMarkup([source,pending]);
 assert.match(html,/BBC Middle East/);assert.doesNotMatch(html,/Checking source updates/);
});
test('default reporting excludes retired and discovery-only links while allowing verified publisher matches with historical provenance',()=>{
 const report={sourceId:'bbc',type:'Reporting',publishedAt:'2026-10-19T14:00:00Z'};
 assert.equal(isActivePublisherReport(report,[source]),true);
 assert.equal(isActivePublisherReport({...report,sourceId:'gdelt-hormuz'},[source]),false);
 for(const flags of [{retainedFromHistory:true},{collectionRetired:true},{retainedForReading:true},{dateBasis:'discovery'},{discoveryProvider:'GDELT'},{type:'Discovered reporting'},{contentAccess:'discovery-metadata'}])assert.equal(isActivePublisherReport({...report,...flags},[source]),false);
 assert.equal(isActivePublisherReport({...report,provenance:[{sourceId:'gdelt-hormuz',retrievedAt:'2026-10-18T12:00:00Z'}]},[source]),true);
 assert.equal(isActivePublisherReport(report,[{...source,retired:true}]),false);
});
