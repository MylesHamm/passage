import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceHealth} from '../dist/source-health.mjs';
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
 assert.match(sourceRosterMarkup([]),/No current source updates/);assert.match(sourceRosterMarkup([]),/does not establish that no events occurred/);
});
test('default reporting excludes retired and discovery-only links while allowing verified publisher matches with historical provenance',()=>{
 const report={sourceId:'bbc',type:'Reporting',publishedAt:'2026-10-19T14:00:00Z'};
 assert.equal(isActivePublisherReport(report,[source]),true);
 assert.equal(isActivePublisherReport({...report,sourceId:'gdelt-hormuz'},[source]),false);
 for(const flags of [{retainedFromHistory:true},{collectionRetired:true},{retainedForReading:true},{dateBasis:'discovery'},{discoveryProvider:'GDELT'},{type:'Discovered reporting'},{contentAccess:'discovery-metadata'}])assert.equal(isActivePublisherReport({...report,...flags},[source]),false);
 assert.equal(isActivePublisherReport({...report,provenance:[{sourceId:'gdelt-hormuz',retrievedAt:'2026-10-18T12:00:00Z'}]},[source]),true);
 assert.equal(isActivePublisherReport(report,[{...source,retired:true}]),false);
});
