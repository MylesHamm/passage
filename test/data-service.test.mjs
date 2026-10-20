import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDataService,PUBLIC_API_PATHS} from '../lib/data-service.mjs';
import {SourceRuntime} from '../lib/source-runtime.mjs';
import {ReportArchive} from '../lib/report-archive.mjs';
import {SOURCE_CAPABILITIES} from '../dist/source-policy.mjs';
import {loadMaradAdvisories} from '../lib/marad.mjs';
import {assessBackendReadiness} from '../lib/backend-readiness.mjs';

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

test('public vessel output preserves snapshot credits and counts without exposing snapshots as current positions',async t=>{
  const seen=new Date().toISOString();
  const f=await fixture(t,async input=>{
    assert.equal(new URL(input).hostname,'ais.openwaters.io');
    return Response.json({type:'FeatureCollection',attribution:{kystverket:'Kystverket · NLOD 2.0'},features:[
      {type:'Feature',geometry:{type:'Point',coordinates:[56.25,26.57]},properties:{mmsi:999000001,seen,source:'kystverket',station:'test',msg_type:'PositionReport',type:80}}
    ]});
  });
  const output=await f.service.get('/api/vessels');
  assert.deepEqual(output.vessels,[]);
  assert.equal(output.fallback.recordCount,0);
  assert.equal(output.fallback.snapshotCount,1);
  assert.equal(output.fallback.latest,null);
  assert.equal(output.fallback.lastMessageAt,seen);
  assert.deepEqual(output.fallback.attribution,{kystverket:'Kystverket · NLOD 2.0'});
  assert.match(output.fallback.observationBasis,/position time and source unavailable/);
});

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
  assert.deepEqual({...outputs['/api/config']},{reliefweb:true,aisstream:true,eia:true,acled:false,version:'service-test',hosted:true,capabilities:SOURCE_CAPABILITIES});
  const backend=assessBackendReadiness({config:outputs['/api/config'],diagnostics:outputs['/api/diagnostics'],news:outputs['/api/news'],maritime:outputs['/api/maritime'],now:NOW});
  assert.equal(backend.compatible,true,'actual service schemas align even when supporting providers are unavailable');
  assert.equal(backend.coverageEstablished,false,'retirement must never claim current advisory coverage');
  assert.ok(backend.warnings.some(warning=>warning.id==='marad-advisories'));
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
  assert.equal(requests.filter(url=>['api.gdeltproject.org','www.maritime.dot.gov'].includes(url.hostname)).length,0,'retired providers must never be polled');
  assert.equal(JSON.stringify({outputs,logs:f.logs}).includes(secret),false);
  for(const endpoint of ['/api/acled/credentials','/api/connections/acled','/api/config/save'])assert.equal(await service.get(endpoint),null);
});

test('background collection restores retired discovery into history without new requests or observation clocks',async t=>{
  const requests=[],f=await fixture(t,async input=>{requests.push(new URL(input).hostname);return new Response('Unavailable',{status:503});});
  const savedAt='2026-09-21T10:00:00.000Z',reportUrl='https://example.com/historical-hormuz-report';
  const items=[{id:'historical-hormuz',title:'Hormuz tanker disruption affects Iranian oil exports',url:reportUrl,sourceId:'gdelt-hormuz',source:'Example',contentAccess:'discovery-metadata',publishedAt:null,discoveredAt:'2026-09-21T09:00:00.000Z',dateBasis:'discovery'}];
  await f.runtime.storage.mkdir(f.runtime.cacheDir,{recursive:true});
  await f.runtime.storage.writeFile(path.join(f.runtime.cacheDir,'gdelt-hormuz-metadata.json'),JSON.stringify({retrievedAt:savedAt,checkedAt:savedAt,connection:'cached',items,recordCount:1,resultLimit:75,possiblyTruncated:true}));
  const result=await f.service.collect(),news=await f.service.news(),report=news.items.find(row=>row.url===reportUrl);
  assert.equal(result.completedAt,new Date(NOW).toISOString());assert.ok(report);
  assert.equal(news.coverage.discoveryPending,false);assert.equal(news.coverage.discoveryFamilies,0);assert.equal(news.coverage.nextDiscoveryPollSeconds,null);
  assert.equal(report.collectionRetired,true);assert.equal(report.retainedFromHistory,true);assert.equal(report.lastSeenAt,savedAt);assert.equal(report.discoveredAt,items[0].discoveredAt);assert.equal(report.publishedAt,null);
  const source=news.sources.find(row=>row.id==='gdelt-hormuz');assert.equal(source.configured,false);assert.equal(source.retired,true);assert.equal(source.retrievedAt,savedAt);assert.equal(source.checkedAt,savedAt);assert.equal(source.resultLimit,75);
  assert.ok(!requests.includes('api.gdeltproject.org'));assert.ok(!requests.includes('www.maritime.dot.gov'));
  const restored=await new ReportArchive({file:f.archiveFile,now:()=>NOW}).merge([]);
  assert.equal(restored.items[0].lastSeenAt,savedAt);assert.equal(restored.items[0].provenance[0].discoveredAt,items[0].discoveredAt);
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

test('retired advisory metadata preserves provenance and expiry without a provider request or current coverage claim',async t=>{
  const index=await readFile(new URL('./fixtures/marad/index.html',import.meta.url),'utf8'),hormuz=await readFile(new URL('./fixtures/marad/2026-011.html',import.meta.url),'utf8'),redsea=await readFile(new URL('./fixtures/marad/2026-013.html',import.meta.url),'utf8');
  const savedAt='2026-10-17T04:00:00.000Z',now=Date.parse(savedAt),requests=[];
  const snapshot=await loadMaradAdvisories(async input=>{const url=new URL(input);return url.pathname==='/msci-advisories'?index:url.pathname.includes('2026-011')?hormuz:redsea;},now);
  const f=await fixture(t,async input=>{requests.push(new URL(input).hostname);return new Response('Unavailable',{status:503});});f.setTime(now);
  await f.runtime.storage.mkdir(f.runtime.cacheDir,{recursive:true});
  await f.runtime.storage.writeFile(path.join(f.runtime.cacheDir,'marad-advisories-v1.json'),JSON.stringify({...snapshot,checkedAt:savedAt,retrievedAt:savedAt,connection:'connected'}));
  const first=await f.service.get('/api/maritime');assert.equal(first.events.length,0);assert.equal(first.advisories.length,5);
  assert.ok(first.advisories.every(record=>record.collectionRetired&&record.retainedFromHistory&&record.recordType==='advisory'&&record.eventDate===null&&record.publishedDate===null&&!record.summary));
  const source=first.sources.find(source=>source.id==='marad-advisories');assert.equal(source.configured,false);assert.equal(source.retired,true);assert.equal(source.status,'disabled');assert.equal(source.retrievedAt,savedAt);assert.equal(source.checkedAt,savedAt);
  assert.equal(first.coverage.advisories.status,'unavailable');assert.equal(first.coverage.advisories.collection,'retired');assert.equal(first.coverage.advisories.complete,false);
  const backend=assessBackendReadiness({config:await f.service.get('/api/config'),diagnostics:await f.service.get('/api/diagnostics'),news:await f.service.get('/api/news'),maritime:first,now});
  assert.equal(backend.ready,true);assert.equal(backend.coverageEstablished,false);assert.equal(backend.retainedEvidenceEstablished,true);
  f.setTime(Date.parse('2027-03-23T04:00:00Z'));const later=await f.service.get('/api/maritime'),retained=later.sources.find(source=>source.id==='marad-advisories');
  assert.equal(retained.status,'disabled');assert.equal(retained.retrievedAt,savedAt);assert.equal(retained.checkedAt,savedAt);assert.equal(retained.activeAdvisoryCount,0);
  assert.ok(later.advisories.filter(record=>record.sourceStatus==='active').every(record=>record.validityState==='expired'));assert.equal(later.events.length,0);
  assert.ok(!requests.includes('www.maritime.dot.gov'));assert.ok(!requests.includes('api.gdeltproject.org'));
});
