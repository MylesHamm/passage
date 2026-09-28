import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCES} from '../lib/feeds.mjs';
import {assessReportingReadiness} from '../lib/release-readiness.mjs';
import {checkHostedApi} from '../scripts/check-hosted-api.mjs';

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

test('missing, disabled, unavailable, unknown and empty core reporting fail closed',()=>{
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

test('a newly fetched feed of only old relevant publications cannot satisfy the 72-hour briefing window',()=>{
  assert.equal(assessReportingReadiness(changeFirst({latestRelevant:'2026-09-25T18:59:59Z'})).ready,false);
  assert.equal(assessReportingReadiness(changeFirst({latestRelevant:'2026-09-25T19:00:00Z'})).ready,true);
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

test('hosted check requests only public health and diagnostics with the Pages origin and no refresh',async()=>{
  const requests=[],input=fixture();
  const result=await checkHostedApi({base:'https://live.example.com/',now:()=>NOW,fetchImpl:async(url,options)=>{
    requests.push({url:String(url),options});
    return Response.json(requests.length===1?input.health:input.diagnostics,{headers:{'Access-Control-Allow-Origin':'https://myleshamm.github.io'}});
  }});
  assert.equal(result.ready,true);
  assert.deepEqual(requests.map(request=>request.url),['https://live.example.com/api/health','https://live.example.com/api/diagnostics']);
  assert.ok(requests.every(({options})=>options.headers.Origin==='https://myleshamm.github.io'&&options.redirect==='error'));
});

test('hosted check blocks publishing on actual diagnostics failure or core rejection',async()=>{
  const input=changeFirst({connection:'unavailable',httpStatus:403,error:'Request rejected.'});
  for(const mode of ['http','cors','source']){
    await assert.rejects(checkHostedApi({base:'https://live.example.com/',now:()=>NOW,fetchImpl:async url=>{
      const isHealth=new URL(url).pathname==='/api/health';
      if(!isHealth&&mode==='http')return new Response('Unavailable',{status:503});
      return Response.json(isHealth?health:input.diagnostics,{headers:{'Access-Control-Allow-Origin':!isHealth&&mode==='cors'?'https://other.example':'https://myleshamm.github.io'}});
    }}),mode==='http'?/diagnostics.*503/i:mode==='cors'?/origin/i:/reporting.*not ready/i);
  }
});
