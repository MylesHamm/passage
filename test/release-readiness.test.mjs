import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCES} from '../lib/feeds.mjs';
import {assessReportingReadiness,assessPassageReadiness} from '../lib/release-readiness.mjs';
import {checkHostedApi} from '../scripts/check-hosted-api.mjs';
import {backendFixture} from './fixtures/release-backend.mjs';

const NOW=Date.parse('2026-09-28T19:00:00Z');
const health={application:'passage-maritime-watch',status:'ready'};
const core=SOURCES.filter(source=>source.type==='Reporting');
function fixture(){return {health,now:NOW,diagnostics:{sources:core.map(source=>({
  id:source.id,configured:true,connection:'connected',status:'current',hasData:true,
  recordCount:3,retrievedAt:'2026-09-28T18:59:00Z',latestRelevant:'2026-09-28T18:00:00Z',
}))}};}
function changeFirst(changes){const input=fixture();Object.assign(input.diagnostics.sources[0],changes);return input;}

test('ready collector cannot release with a rejected core feed despite fresh retained metadata',()=>{
  const input=changeFirst({connection:'cached',error:'Request rejected.',errorCategory:'http',httpStatus:403});
  const result=assessReportingReadiness(input);
  assert.equal(result.ready,false);
  assert.equal(result.failures[0].id,core[0].id);
  assert.match(result.failures[0].reasons.join(' '),/connection|update/i);
});

test('fresh heartbeat and precomputed age cannot conceal stale successful retrieval',()=>{
  const result=assessReportingReadiness(changeFirst({checkedAt:'2026-09-28T19:00:00Z',retrievalAgeSeconds:0,retrievedAt:'2026-09-28T17:00:00Z'}));
  assert.equal(result.ready,false);
  assert.match(result.failures[0].reasons.join(' '),/retrieval.*old/i);
});

test('all current direct reporting feeds pass even when auxiliary feeds fail or are disabled',()=>{
  const input=fixture();
  input.diagnostics.sources.push(
    {id:'gdelt-hormuz',configured:true,connection:'cached',errorCategory:'rate_limit'},
    {id:'centcom',configured:true,connection:'unavailable',httpStatus:403},
    {id:'reliefweb',configured:false,connection:'not configured'},
  );
  const result=assessReportingReadiness(input);
  assert.equal(result.ready,true);
  assert.deepEqual(result.requiredSourceIds,core.map(source=>source.id));
  assert.equal(result.verifiedCount,core.length);
  assert.deepEqual(result.failures,[]);
});

test('missing, disabled, unavailable, unknown and inconsistent core reporting fail closed',()=>{
  const missing=fixture();missing.diagnostics.sources.shift();
  assert.equal(assessReportingReadiness(missing).ready,false);
  for(const changes of [
    {configured:false},{configured:null},{connection:'unavailable'},{status:'unknown'},
    {recordCount:0},{recordCount:null},{recordCount:'3'},{hasData:false},
    {error:'Update failed.'},{errorCategory:'network'},{cacheIssue:'Cache write failed.'},
    {httpStatus:503},
  ])assert.equal(assessReportingReadiness(changeFirst(changes)).ready,false,JSON.stringify(changes));
});

test('required successful retrieval and relevant publication dates must be valid and within their future tolerances',()=>{
  for(const field of ['retrievedAt','latestRelevant'])for(const value of [null,undefined,'','not a date','2026-02-30T12:00:00Z','2026-09-28T19:06:00Z']){
    assert.equal(assessReportingReadiness(changeFirst({[field]:value})).ready,false,`${field}: ${value}`);
  }
  assert.equal(assessReportingReadiness(changeFirst({latestRelevant:'2026-09-28T19:05:00Z'})).ready,true);
  assert.equal(assessReportingReadiness(changeFirst({retrievedAt:'2026-09-28T19:01:01Z'})).ready,false);
});

test('a successful check with only older relevant reporting is a coverage limitation, not a failed publisher',()=>{
  const input=changeFirst({status:'stale',latestRelevant:'2026-09-25T18:59:59Z'}),result=assessReportingReadiness(input);
  assert.equal(result.ready,true);assert.equal(result.verifiedCount,core.length);assert.equal(result.recentReportingCount,core.length-1);
  assert.equal(result.warnings[0].category,'reporting-coverage');assert.match(result.warnings[0].reasons[0],/check succeeded/);
  assert.equal(assessReportingReadiness(changeFirst({latestRelevant:'2026-09-25T19:00:00Z'})).ready,true);
});
test('a checked feed with no relevant matches stays supported without becoming an all-clear',()=>{
  const result=assessReportingReadiness(changeFirst({status:'empty',recordCount:0,hasData:false,latestRelevant:null}));
  assert.equal(result.ready,true);assert.equal(result.verifiedCount,core.length);assert.equal(result.recentReportingCount,core.length-1);
  assert.match(result.warnings[0].reasons[0],/no relevant reports matched/);
});
test('a live briefing still requires recent direct reporting collectively',()=>{
  const input=fixture();for(const source of input.diagnostics.sources)Object.assign(source,{status:'stale',latestRelevant:'2026-09-25T18:59:59Z'});
  const result=assessReportingReadiness(input);assert.equal(result.ready,false);assert.equal(result.recentReportingCount,0);assert.equal(result.failures[0].id,'briefing');
  for(const source of input.diagnostics.sources)Object.assign(source,{status:'empty',recordCount:0,hasData:false,latestRelevant:null});
  assert.equal(assessReportingReadiness(input).ready,false);
});

test('retrieval deadline derives from configured interval with two minutes of scheduling grace',()=>{
  const source={id:'test-reporting',name:'Test reporting',type:'Reporting',interval:600};
  const input=fixture();input.requiredSources=[source];
  input.diagnostics.sources=[{...input.diagnostics.sources[0],id:source.id,retrievedAt:'2026-09-28T18:38:00Z'}];
  assert.equal(assessReportingReadiness(input).ready,true);
  input.diagnostics.sources[0].retrievedAt='2026-09-28T18:37:59Z';
  assert.equal(assessReportingReadiness(input).ready,false);
});

test('wrong service, malformed diagnostics and an empty required set cannot pass',()=>{
  for(const overrides of [{health:{...health,status:'starting'}},{health:null},{health:{...health,application:'other'}},{diagnostics:{}},{diagnostics:null},{requiredSources:[]}]){
    assert.equal(assessReportingReadiness({...fixture(),...overrides}).ready,false);
  }
});

test('hosted check reads existing public source contracts with the Pages origin and no forced refresh',async()=>{
  const requests=[],input=coreFixture(),backend=backendFixture(NOW);
  input.diagnostics.sources.push(...backend.diagnostics.sources);
  const payloads={...backend,...input};
  const result=await checkHostedApi({base:'https://live.example.com/',now:()=>NOW,fetchImpl:async(url,options)=>{
    requests.push({url:String(url),options});
    return Response.json(payloads[new URL(url).pathname.split('/').at(-1)],{headers:{'Access-Control-Allow-Origin':'https://myleshamm.github.io'}});
  }});
  assert.equal(result.ready,true);
  assert.deepEqual(requests.map(request=>request.url),['health','config','news','maritime','diagnostics'].map(endpoint=>'https://live.example.com/api/'+endpoint));
  assert.ok(requests.every(({options})=>options.headers.Origin==='https://myleshamm.github.io'&&options.redirect==='error'));
});

test('hosted check blocks publishing on actual diagnostics failure or core rejection',async()=>{
  const input=changeFirst({connection:'unavailable',httpStatus:403,error:'Request rejected.'});
  for(const mode of ['http','cors','source']){
    await assert.rejects(checkHostedApi({base:'https://live.example.com/',now:()=>NOW,fetchImpl:async url=>{
      const isHealth=new URL(url).pathname==='/api/health';
      if(!isHealth&&mode==='http')return new Response('Unavailable',{status:503});
      return Response.json(isHealth?health:input.diagnostics,{headers:{'Access-Control-Allow-Origin':!isHealth&&mode==='cors'?'https://other.example':'https://myleshamm.github.io'}});
    }}),mode==='http'?/config.*503/i:mode==='cors'?/origin/i:/not ready for publication/i);
  }
});

function coreFixture(){const input=fixture();input.diagnostics.sources.push(...['imo-hormuz','imo-redsea','brent','wti'].map(id=>({id,configured:true,connection:'connected',retrievedAt:'2026-09-28T18:59:00Z',recordCount:2,latest:id.startsWith('imo')?'2026-08-01':'2026-09-25'})));return input;}
test('core release checks official registers and prices while respecting event and weekend lag',()=>{
 const input=coreFixture();assert.equal(assessPassageReadiness(input).ready,true);
 for(const id of ['imo-hormuz','imo-redsea','brent','wti']){const failed=structuredClone(input);failed.diagnostics.sources.find(source=>source.id===id).connection='cached';assert.equal(assessPassageReadiness(failed).ready,false,id);}
 input.diagnostics.sources.push({id:'marad-advisories',configured:true,connection:'unavailable'});assert.equal(assessPassageReadiness(input).ready,true,'supporting advisory gap remains disclosed without claiming core shutdown');
});
test('core gate refuses missing timestamps and old price observations without requiring new incident dates',()=>{
 const input=coreFixture();const price=input.diagnostics.sources.find(source=>source.id==='brent');price.latest='2026-09-18';assert.equal(assessPassageReadiness(input).ready,false);price.latest='2026-09-25';price.retrievedAt=null;assert.equal(assessPassageReadiness(input).ready,false);
 const emptyOfficial=coreFixture();emptyOfficial.diagnostics.sources.find(source=>source.id==='imo-redsea').recordCount=0;assert.equal(assessPassageReadiness(emptyOfficial).ready,true);
});


test('hosted gate rejects the previous source rollout even when all nine core checks pass',async()=>{
  const input=coreFixture(),backend=backendFixture(NOW);delete backend.config.capabilities;delete backend.news.capabilities;
  delete backend.maritime.advisories;delete backend.maritime.coverage;
  input.diagnostics.sources.push(...backend.diagnostics.sources.filter(source=>source.id!=='marad-advisories'));
  for(const payload of [input.diagnostics,backend.news])for(const source of payload.sources)if(['centcom','gdelt-exports','gdelt-energy','gdelt-reuters'].includes(source.id))source.configured=true;
  assert.equal(assessPassageReadiness(input).ready,true,'this is the exact blind spot in the old core-only gate');
  const payloads={...backend,...input};
  await assert.rejects(checkHostedApi({base:'https://live.example.com/',now:()=>NOW,fetchImpl:async url=>Response.json(payloads[new URL(url).pathname.split('/').at(-1)],{headers:{'Access-Control-Allow-Origin':'https://myleshamm.github.io'}})}),error=>{
    assert.equal(error.result.verifiedCount,9);
    assert.equal(error.result.backend.compatible,false);
    assert.ok(error.result.failures.some(failure=>failure.id==='marad-advisories'&&failure.category==='capability'));
    assert.ok(error.result.failures.some(failure=>failure.id==='centcom'&&failure.category==='capability'));
    return true;
  });
});

test('every additional public contract endpoint retains HTTP and CORS enforcement',async()=>{
  const input=coreFixture(),backend=backendFixture(NOW);input.diagnostics.sources.push(...backend.diagnostics.sources);
  const payloads={...backend,...input};
  for(const endpoint of ['config','news','maritime','diagnostics'])for(const mode of ['http','cors']){
    await assert.rejects(checkHostedApi({base:'https://live.example.com/',now:()=>NOW,fetchImpl:async url=>{
      const route=new URL(url).pathname.split('/').at(-1),failed=route===endpoint;
      if(failed&&mode==='http')return new Response('Unavailable',{status:503});
      return Response.json(payloads[route],{headers:{'Access-Control-Allow-Origin':failed&&mode==='cors'?'https://other.example':'https://myleshamm.github.io'}});
    }}),new RegExp(endpoint+'.*'+(mode==='http'?'503':'origin'),'i'));
  }
});
