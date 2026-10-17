import test from 'node:test';
import assert from 'node:assert/strict';
import {assessBackendReadiness} from '../lib/backend-readiness.mjs';
import {SOURCE_CAPABILITIES,RETIRED_SOURCE_IDS,sourceConfigured} from '../dist/source-policy.mjs';
import {SOURCE_DEFINITIONS} from '../dist/source-health.mjs';
import {DISCOVERY_SOURCES,RETIRED_DISCOVERY_SOURCES} from '../lib/discovery.mjs';
import {SOURCES} from '../lib/feeds.mjs';
import {backendFixture} from './fixtures/release-backend.mjs';

const assess=input=>assessBackendReadiness(input);
test('reviewed collection policy enables exactly two maritime discovery families and retires the old collectors',()=>{
  const expected=['gdelt-hormuz','gdelt-redsea'];
  assert.deepEqual(SOURCE_CAPABILITIES.discovery.sourceIds,expected);
  assert.deepEqual(DISCOVERY_SOURCES.map(source=>source.id),expected);
  assert.ok(DISCOVERY_SOURCES.every(source=>source.interval===1800));
  assert.deepEqual(RETIRED_SOURCE_IDS,['centcom','gdelt-exports','gdelt-energy','gdelt-reuters']);
  assert.deepEqual(RETIRED_DISCOVERY_SOURCES,RETIRED_SOURCE_IDS.slice(1));
  assert.ok(!SOURCES.some(source=>RETIRED_SOURCE_IDS.includes(source.id)));
  for(const id of RETIRED_SOURCE_IDS)assert.equal(sourceConfigured(SOURCE_DEFINITIONS.find(source=>source.id===id)),false);
  assert.deepEqual(SOURCE_CAPABILITIES.advisories.sourceIds,['marad-advisories']);
});

test('aligned existing public schema passes without a new backend version field',()=>{
  const input=backendFixture(),before=structuredClone(input),result=assess(input);
  assert.equal(result.ready,true);assert.equal(result.compatible,true);assert.equal(result.coverageEstablished,true);
  assert.deepEqual(result.warnings,[]);assert.deepEqual(input,before);
});

test('previous backend is rejected even if all nine core feeds are healthy',()=>{
  const input=backendFixture();delete input.config.capabilities;delete input.news.capabilities;
  input.diagnostics.sources=input.diagnostics.sources.filter(source=>source.id!=='marad-advisories');
  delete input.maritime.advisories;delete input.maritime.coverage;
  for(const payload of [input.diagnostics,input.news])for(const source of payload.sources){if(RETIRED_SOURCE_IDS.includes(source.id)){source.configured=true;delete source.retired;}if(source.id.startsWith('gdelt-'))source.interval=900;}
  const result=assess(input);assert.equal(result.ready,false);assert.equal(result.compatible,false);
  for(const id of ['marad-advisories',...RETIRED_SOURCE_IDS,'discovery'])assert.ok(result.capabilityFailures.some(failure=>failure.id===id),id);
});

test('capability declarations alone cannot conceal active retired collectors or extra discovery families',()=>{
  for(const endpoint of ['diagnostics','news'])for(const id of RETIRED_SOURCE_IDS){
    const input=backendFixture();input[endpoint].sources.find(source=>source.id===id).configured=true;
    assert.equal(assess(input).compatible,false,`${endpoint}:${id}`);
  }
  for(const endpoint of ['diagnostics','news']){
    const input=backendFixture();input[endpoint].sources.push({...input.news.sources[0],id:'gdelt-extra'});
    assert.equal(assess(input).compatible,false);
  }
  for(const value of [false,null,undefined]){
    const input=backendFixture();input.news.sources.find(source=>source.id==='gdelt-redsea').configured=value;assert.equal(assess(input).compatible,false);
  }
});

test('required declarations, retirement semantics and polling policy fail closed',()=>{
  const mutations=[
    input=>{input.config.capabilities.advisories.sourceIds=[];},
    input=>{input.news.capabilities.discovery.sourceIds.push('gdelt-energy');},
    input=>{input.config.capabilities.advisories.core=true;},
    input=>{input.diagnostics.sources.find(source=>source.id==='centcom').retired=false;},
    input=>{input.news.sources.find(source=>source.id==='gdelt-hormuz').interval=900;},
    input=>{input.news.coverage.discoveryFamilies=5;},
    input=>{input.news.coverage.retiredSources=[];},
    input=>{input.news.coverage.reuters.mode='discovery';},
  ];
  for(const mutate of mutations){const input=backendFixture();mutate(input);assert.equal(assess(input).compatible,false,mutate.toString());}
});

test('an installed MARAD adapter without any successful snapshot is coverage failure, not capability failure or an all-clear',()=>{
  const input=backendFixture();input.maritime.advisories=[];
  input.maritime.coverage.advisories={incidentCoverage:false,note:'No successful advisory source response is available.'};
  Object.assign(input.maritime.sources[0],{connection:'unavailable',retrievedAt:null,recordCount:0,errorCategory:'upstream_http',httpStatus:503});
  const result=assess(input);assert.equal(result.compatible,true);assert.equal(result.coverageEstablished,false);assert.equal(result.ready,false);
  assert.equal(result.coverageFailures[0].category,'coverage');assert.equal(result.warnings[0].httpStatus,503);
});

test('retained MARAD coverage and GDELT rate limits pass alignment but preserve outage warnings and original clocks',()=>{
  const input=backendFixture();
  const old='2026-09-25T10:00:00Z',retry='2026-09-28T20:00:00Z';
  Object.assign(input.maritime.sources[0],{connection:'cached',status:'retained',retrievedAt:old,errorCategory:'upstream_http',httpStatus:503});
  for(const source of input.news.sources.filter(source=>source.configured))Object.assign(source,{connection:'cached',status:'retained',retrievedAt:old,errorCategory:'rate_limit',httpStatus:429,nextRetryAt:retry});
  const before=structuredClone(input),result=assess(input);
  assert.equal(result.ready,true);assert.equal(result.coverageEstablished,true);assert.equal(result.warnings.length,3);
  assert.ok(result.warnings.every(warning=>warning.retrievedAt===old&&warning.category==='source-health'));
  assert.ok(result.warnings.filter(warning=>warning.id.startsWith('gdelt-')).every(warning=>warning.nextRetryAt===retry&&warning.httpStatus===429));
  assert.deepEqual(input,before);
});

test('successful supporting checks with overdue clocks are warnings, never silently healthy',()=>{
  const input=backendFixture();for(const source of [input.maritime.sources[0],...input.news.sources.filter(source=>source.configured)])source.retrievedAt='2026-09-25T10:00:00Z';
  const result=assess(input);assert.equal(result.ready,true);assert.equal(result.warnings.length,3);
});

test('MARAD retains non-incident evidence and bounded archive/count semantics',()=>{
  const mutations=[
    input=>{input.maritime.coverage.complete=true;},
    input=>{input.maritime.coverage.advisories.incidentCoverage=true;},
    input=>{input.maritime.coverage.advisories.cancelledArchiveComplete=true;},
    input=>{input.maritime.coverage.advisories.publicationDateKnown=true;},
    input=>{input.maritime.coverage.advisories.activeListedCount=2;},
    input=>{input.maritime.advisories[0].eventDate='2026-09-09';},
    input=>{input.maritime.advisories[0].publishedDate='2026-09-09';},
    input=>{input.maritime.advisories[0].recordType='incident';},
    input=>{input.maritime.advisories[0].validityState='clear';},
    input=>{input.maritime.events.push(input.maritime.advisories[0]);},
  ];
  for(const mutate of mutations){const input=backendFixture();mutate(input);assert.equal(assess(input).compatible,false,mutate.toString());}
});

test('no fixed advisory ID or positive active-warning count is required',()=>{
  const input=backendFixture();Object.assign(input.maritime.advisories[0],{id:'marad-advisories:2026-999',advisoryId:'2026-999',validityState:'expired'});
  assert.equal(assess(input).ready,true,'listed active status is distinct from current date validity');
});

test('missing, invalid or future successful clocks and inconsistent result counts cannot establish coverage',()=>{
  for(const value of [null,'','not a date','2026-02-30T00:00:00Z','2026-09-28T19:01:01Z']){
    const input=backendFixture();input.maritime.sources[0].retrievedAt=value;assert.equal(assess(input).coverageEstablished,false,String(value));
  }
  const input=backendFixture();input.maritime.sources[0].recordCount=0;assert.equal(assess(input).coverageEstablished,false);
});

test('malformed arrays, null rows and duplicate source identities fail without throwing',()=>{
  for(const endpoint of ['diagnostics','news','maritime'])for(const sources of [null,{},[null],[{}]]){
    const input=backendFixture();input[endpoint].sources=sources;assert.equal(assess(input).ready,false);
  }
  for(const endpoint of ['diagnostics','news','maritime']){
    const input=backendFixture();input[endpoint].sources.push({...input[endpoint].sources[0]});assert.equal(assess(input).ready,false);
  }
  for(const events of [null,{}]){const input=backendFixture();input.maritime.events=events;assert.equal(assess(input).ready,false);}
  assert.equal(assess({}).ready,false);
});
