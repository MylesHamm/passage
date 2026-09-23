import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDataService,PUBLIC_API_PATHS} from '../lib/data-service.mjs';
import {SourceRuntime} from '../lib/source-runtime.mjs';
import {ReportArchive} from '../lib/report-archive.mjs';
import {DISCOVERY_SOURCES} from '../lib/discovery.mjs';

const NOW=Date.parse('2026-09-22T12:00:00Z');
const secret='PRIVATE_TEST_KEY_NEVER_PUBLIC';
const rss='<rss><channel><item><title>Saudi oil exports and Red Sea tanker routes</title><link>https://example.com/oil-report</link><pubDate>Tue, 22 Sep 2026 10:00:00 GMT</pubDate><description>Saudi crude exports use regional tanker routes.</description></item></channel></rss>';
const ais={
  snapshot:()=>({configured:false,vessels:[],source:{connection:'not configured',recordCount:0}}),
  diagnostics:()=>({configured:false,connection:'not configured'}),
};
function eiaPayload(url,value=74.25) {
  const series=url.pathname.split('.')[1],weekly=url.pathname.endsWith('.W');
  // The real provider echoes request credentials outside its data rows.
  return {request:{params:{api_key:secret}},response:{frequency:weekly?'weekly':'daily',
    data:[{series,units:weekly?(series==='WCESTUS1'?'MBBL':'%'):'$/BBL',period:'2026-09-18',value}]}};
}
async function fixture(t,fetchImpl,settings={}) {
  const dir=await mkdtemp(path.join(tmpdir(),'passage-service-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let clock=NOW;
  const logs=[],archiveFile=path.join(dir,'reports.json');
  const runtime=new SourceRuntime({cacheDir:path.join(dir,'cache'),fetchImpl,now:()=>clock,log:event=>logs.push(event)});
  const reportArchive=new ReportArchive({file:archiveFile,now:()=>clock});
  const service=createDataService({runtime,reportArchive,settings:{hosted:true,...settings},ais,version:'service-test'});
  return {service,runtime,reportArchive,archiveFile,logs,setTime:value=>{clock=value;}};
}

test('hosted service isolates private account adapters and secrets across every public endpoint',async t=>{
  const requests=[];
  const f=await fixture(t,async input=>{
    const url=new URL(input);requests.push(url);
    if(url.hostname==='api.eia.gov')return Response.json(eiaPayload(url));
    if(url.hostname==='api.reliefweb.int')return Response.json({request:{appname:secret},data:[{id:1,fields:{title:'Yemen fuel imports through Red Sea ports',url:'https://reliefweb.int/report/yemen/fuel',date:{created:'2026-09-22T09:00:00Z'}}}]});
    if(url.hostname==='api.gdeltproject.org')return new Response(secret,{status:429,headers:{'Retry-After':'900'}});
    if(url.hostname==='feeds.bbci.co.uk')return new Response(rss);
    return new Response(secret,{status:503});
  });
  let privateCalls=0;
  const forbidden=()=>{privateCalls++;throw Error('The hosted service called a private account adapter');};
  const privateAdapter={configured:true,password:secret,snapshot:forbidden,check:forbidden,events:forbidden};
  const service=createDataService({runtime:f.runtime,reportArchive:f.reportArchive,ais,acled:privateAdapter,
    settings:{hosted:true,eiaApiKey:secret,reliefwebAppname:secret,aisstream:secret,acledPassword:secret,unexpectedSecret:secret},version:'service-test'});
  const outputs={};
  for(const endpoint of PUBLIC_API_PATHS)outputs[endpoint]=await service.get(endpoint);
  assert.deepEqual({...outputs['/api/config']},{reliefweb:true,aisstream:true,eia:true,acled:false,version:'service-test',hosted:true});
  assert.equal(privateCalls,0);
  assert.equal(outputs['/api/acled'].configured,false);
  assert.deepEqual(outputs['/api/acled/events'].events,[]);
  assert.deepEqual(outputs['/api/acled'].countries,[]);
  assert.equal(outputs['/api/diagnostics'].sources.find(s=>s.id==='acled').status,'disabled');
  assert.equal(outputs['/api/news'].coverage.reviewedCount,0);
  assert.ok(outputs['/api/news'].items.some(item=>item.sourceId==='reliefweb'));
  assert.ok(outputs['/api/oil'].series.every(series=>series.observations.length===1));
  assert.ok(outputs['/api/market-context'].series.every(series=>series.observations.length===1));
  assert.ok(requests.some(url=>url.hostname==='api.eia.gov'&&url.searchParams.get('api_key')===secret));
  assert.ok(requests.some(url=>url.hostname==='api.reliefweb.int'&&url.searchParams.get('appname')===secret));
  assert.equal(requests.filter(url=>url.hostname==='api.gdeltproject.org').length,1,'a provider 429 defers the remaining discovery families');
  assert.equal(JSON.stringify({outputs,logs:f.logs}).includes(secret),false);
  for(const endpoint of ['/api/acled/credentials','/api/connections/acled','/api/config/save'])assert.equal(await service.get(endpoint),null);
});

test('background collection waits for late discovery and persists metadata with its original clocks', {timeout:5000},async t=>{
  let release,started;
  const responseGate=new Promise(resolve=>{release=resolve;});
  const requestStarted=new Promise(resolve=>{started=resolve;});
  let discoveryRequests=0;
  const f=await fixture(t,async input=>{
    if(new URL(input).hostname==='api.gdeltproject.org'){
      discoveryRequests++;started();return responseGate;
    }
    return new Response('Temporarily unavailable',{status:503});
  });
  t.after(()=>release(new Response('{"articles":[]}')));
  // Other families are inside their real runtime TTL. Only Hormuz needs a
  // request, so the test does not wait through the provider spacing window.
  for(const source of DISCOVERY_SOURCES.filter(source=>source.id!=='gdelt-hormuz')){
    await f.runtime.get(source.id,source.interval,async()=>({items:[],recordCount:0,latest:null}),{},source.id+'-metadata');
  }
  let settled=false;
  const collection=f.service.collect().finally(()=>{settled=true;});
  await requestStarted;
  const interactive=await f.service.news();
  assert.equal(interactive.items.length,0);
  assert.equal(interactive.coverage.discoveryPending,true);
  assert.equal(settled,false,'the interactive response window must not end background collection');
  const reportUrl='https://example.com/late-hormuz-report';
  release(Response.json({articles:[{title:'Hormuz tanker disruption affects Iranian oil exports',url:reportUrl,seendate:'20260922T110000Z',language:'English'}]}));
  const result=await collection;
  assert.equal(result.reports,1);
  assert.equal(result.completedAt,new Date(NOW).toISOString());
  assert.equal(discoveryRequests,1);
  // Reopening the real archive proves collection saved the late result before
  // completing, rather than leaving it only in the in-memory source snapshot.
  const restored=await new ReportArchive({file:f.archiveFile,now:()=>NOW}).merge([]);
  assert.equal(restored.archive.storageStatus,'ready');
  assert.equal(restored.items.length,1);
  const report=restored.items[0];
  assert.equal(report.url,reportUrl);
  assert.equal(report.sourceId,'gdelt-hormuz');
  assert.equal(report.contentAccess,'discovery-metadata');
  assert.equal(report.publishedAt,null);
  assert.equal(report.publishedDate,null);
  assert.equal(report.publicationPrecision,'unknown');
  assert.equal(report.dateBasis,'discovery');
  assert.equal(report.discoveredAt,'2026-09-22T11:00:00.000Z');
  assert.equal(report.firstSeenAt,'2026-09-22T12:00:00.000Z');
  assert.equal(report.lastSeenAt,report.firstSeenAt);
  assert.equal(report.provenance[0].publishedAt,null);
  assert.equal(report.provenance[0].discoveredAt,report.discoveredAt);
  await f.service.news();
  assert.equal(discoveryRequests,1,'subsequent visitors reuse the collector result within its TTL');
});

test('oil responses retain observations and success clocks during failure and respect TTL and retry deadlines',async t=>{
  let failing=false,requests=0,value=74.25;
  const f=await fixture(t,async input=>{
    requests++;
    return failing?new Response(secret,{status:429,headers:{'Retry-After':'120'}}):Response.json(eiaPayload(new URL(input),value));
  },{eiaApiKey:secret});
  const initial=await f.service.get('/api/oil');
  assert.equal(requests,2);
  f.setTime(NOW+3599999);
  await f.service.get('/api/oil');
  assert.equal(requests,2);
  failing=true;f.setTime(NOW+3600000);
  const failed=await f.service.get('/api/oil');
  assert.equal(requests,4);
  for(const series of failed.series){
    const original=initial.series.find(row=>row.id===series.id);
    assert.equal(series.connection,'cached');
    assert.equal(series.status,'retained');
    assert.match(series.label,/update failed/);
    assert.equal(series.errorCategory,'rate_limit');
    assert.equal(series.retrievedAt,original.retrievedAt);
    assert.equal(series.lastSuccessAt,original.lastSuccessAt);
    assert.equal(series.checkedAt,'2026-09-22T13:00:00.000Z');
    assert.deepEqual(series.observations,original.observations);
  }
  const retryAt=Date.parse(failed.series[0].nextRetryAt);
  assert.equal(retryAt,NOW+3720000);
  f.setTime(retryAt-1);await f.service.get('/api/oil');
  assert.equal(requests,4);
  failing=false;value=75;f.setTime(retryAt);
  const recovered=await f.service.get('/api/oil');
  assert.equal(requests,6);
  assert.ok(recovered.series.every(series=>series.connection==='connected'&&series.error===null&&series.observations[0].value===75));
  assert.equal(JSON.stringify({initial,failed,recovered,logs:f.logs}).includes(secret),false);
});
