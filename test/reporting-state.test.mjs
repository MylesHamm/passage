import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {reportingCoverageText,reportingEmptyState,isActivePublisherReport} from '../dist/reporting-view.mjs';
import {collectSources,coverage,isActiveReportingSource} from '../dist/source-health.mjs';

const now=Date.parse('2026-10-20T12:00:00Z');
const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const renderSource=app.slice(app.indexOf('function renderReports('),app.indexOf('function renderArrivals('));
function render(state={},runtime={}){
  state={view:'reporting',includeArchive:false,failures:{},...state};
  const nodes=new Map();
  const $=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',scrollTop:0});
    return nodes.get(selector);
  };
  const context=vm.createContext({state,runtime,$,$$:()=>[],document:{activeElement:null},
    reportingCoverageText,reportingEmptyState,isActivePublisherReport,isActiveReportingSource,coverage,
    allSourceStates:()=>collectSources(state,now),reports:()=>[],groupReporting:()=>[],esc:String,
    renderActors(){},resetFilters(){},renderScope(){},markSelection(){},selectedContext:null,
    renderMetrics(){},renderTheaters(){},renderCivilianSummary(){},renderAcledSummary(){},
    renderArrivals(){},monitoring:null,priority:null});
  vm.runInContext(renderSource,context);context.renderReports();
  return {feed:$('#feed').innerHTML,coverage:$('#reporting-coverage').textContent,count:$('#feed-count').textContent};
}

test('initial Reporting waits for responses without claiming failure or an available archive',()=>{
  const view=render();
  assert.match(view.feed,/Checking reporting sources/);
  assert.match(view.feed,/Coverage is not yet established/);
  assert.doesNotMatch(view.feed,/unavailable|archive|Reset filters/);
  assert.match(view.coverage,/Checking reporting coverage/);
  assert.equal(view.count,'—');
});

test('first-load failure ends pending copy without inventing retained reports',()=>{
  const view=render({failures:{news:true}});
  assert.match(view.feed,/Reporting is unavailable/);
  assert.match(view.coverage,/Reporting coverage is unavailable/);
  assert.doesNotMatch(view.feed+view.coverage,/Checking|Waiting|remain|retained|accessible/);
});

test('failed refresh describes actual historical records and the previous coverage snapshot',()=>{
  const news={items:[{id:'old',sourceId:'bbc'}],sources:[{id:'bbc',connection:'connected',recordCount:1,retrievedAt:'2026-10-20T11:59:00Z'}],coverage:{publicationUnknown:1}};
  const original=structuredClone(news);
  const view=render({news,failures:{news:true}});
  assert.match(view.feed,/Previously retrieved links remain in the historical archive/);
  assert.match(view.coverage,/last retrieved snapshot/);
  assert.doesNotMatch(view.feed+view.coverage,/Checking|Waiting/);
  assert.deepEqual(news,original);
});

test('responding publishers with no matches, saved items and unconfigured service stay distinct',()=>{
  const news={items:[],sources:[{id:'bbc',connection:'connected',recordCount:0,retrievedAt:'2026-10-20T11:59:00Z'}],coverage:{}};
  const empty=render({news});
  assert.match(empty.feed,/No current reports match these filters/);
  assert.match(empty.feed,/Reset filters/);
  assert.doesNotMatch(empty.feed,/Reporting is unavailable/);
  const saved=render({view:'saved',failures:{news:true}});
  assert.match(saved.feed,/No saved reports match this view/);
  assert.doesNotMatch(saved.feed,/Reporting is unavailable|Checking/);
  const unconfigured=render({}, {configurationError:true,configurationNotice:'Live data is not configured.'});
  assert.match(unconfigured.feed,/Reporting is not configured/);
  assert.doesNotMatch(unconfigured.feed,/Checking|Reset filters/);
});

test('empty reporting remains usable when archive metadata is only partially supplied',()=>{
  const news={items:[],sources:[{id:'bbc',connection:'connected',recordCount:0,retrievedAt:'2026-10-20T11:59:00Z'}],coverage:{archive:{recordCount:0,retainedCount:0}}};
  const view=render({news});
  assert.match(view.feed,/No current reports match these filters/);
  assert.match(view.coverage,/Local history: 0 reports\./);
  assert.match(view.coverage,/history retention limits are unavailable/);
  assert.match(view.coverage,/History storage status is unavailable/);
  assert.doesNotMatch(view.coverage,/undefined|NaN|up to|limited to|could not be saved|links are retained/);
});

test('invalid archive metadata cannot invent counts, retention limits or a storage failure',()=>{
  for(const archive of [{},{recordCount:-1,retainedCount:-1,retentionDays:null,maxRecords:null},{recordCount:'12',retainedCount:'8',retentionDays:'30',maxRecords:'1200',truncated:'false'},{recordCount:NaN,retentionDays:Infinity,maxRecords:0}]){
    const text=reportingCoverageText({archive});
    assert.match(text,/Local history: record count unavailable\./);
    assert.match(text,/history retention limits are unavailable/);
    assert.doesNotMatch(text,/undefined|NaN|Infinity|up to|limited to|could not be saved|were dropped|links are retained/);
  }
});

test('complete archive metadata preserves actual limits and explicit storage warnings',()=>{
  const archive={recordCount:10,retainedCount:3,retentionDays:30,maxRecords:1200,storageStatus:'ready'};
  const ready=reportingCoverageText({archive});
  assert.match(ready,/Local history: 10 reports; up to 30 days since last retrieval, limited to 1,200 records\./);
  assert.match(ready,/3 links are retained from earlier retrievals/);
  assert.doesNotMatch(ready,/unavailable|could not be saved/);
  const failed=reportingCoverageText({archive:{...archive,truncated:true,storageStatus:'memory-only',error:'History could not be saved; storage is unavailable.'}});
  assert.match(failed,/Some older records were dropped at the storage limit/);
  assert.match(failed,/History could not be saved; storage is unavailable/);
  assert.match(reportingCoverageText({archive:{...archive,storageStatus:'memory-only'}}),/History could not be saved to disk/);
});
