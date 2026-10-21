import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDataService,PUBLIC_API_PATHS} from '../lib/data-service.mjs';
import {SourceRuntime} from '../lib/source-runtime.mjs';
import {ReportArchive} from '../lib/report-archive.mjs';
import {SOURCE_CAPABILITIES} from '../dist/source-policy.mjs';
import {assessBackendReadiness} from '../lib/backend-readiness.mjs';

const NOW=Date.parse('2026-10-20T21:00:00Z');
const secret='PRIVATE_TEST_KEY_NEVER_PUBLIC';
const fixture=name=>readFile(new URL('./fixtures/'+name,import.meta.url),'utf8');
const [daily,hormuzBase,babBase,eiaToday]=await Promise.all(['portwatch/daily-2026-10-05-to-10-18.json','portwatch/baseline-hormuz-2025.json','portwatch/baseline-bab-2023-jan-oct.json','eia-today/prices-2026-10-20.html'].map(fixture));
const rss='<rss><channel><item><title>Saudi oil exports and Red Sea tanker routes</title><link>https://example.com/oil-report</link><pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate><description>Saudi crude exports use regional routes.</description></item></channel></rss>';
const eiaApi=url=>({request:{params:{api_key:secret}},response:{frequency:'daily',data:[{series:url.pathname.split('.')[1],units:'$/BBL',period:'2026-10-14',value:101.25}]}});
const ais={
  snapshot:()=>({configured:true,vessels:[{mmsi:'123456789',theater:'hormuz'}],source:{connection:'connected',recordCount:1}}),
  diagnostics:()=>({configured:true,connection:'connected'}),
};

function provider(requests=[]){
  return async input=>{
    const url=new URL(input);requests.push(url);
    if(url.hostname==='api.eia.gov')return Response.json(eiaApi(url));
    if(url.hostname==='www.eia.gov'&&url.pathname==='/todayinenergy/prices.php')return new Response(eiaToday);
    if(url.hostname==='services9.arcgis.com'){
      const stats=url.searchParams.get('outStatistics');
      if(!stats)return new Response(daily);
      return new Response(/chokepoint6/.test(url.searchParams.get('where'))?hormuzBase:babBase);
    }
    if(url.hostname==='feeds.bbci.co.uk')return new Response(rss);
    return new Response(secret,{status:503});
  };
}
async function service(t,fetchImpl,settings={}){
  const dir=await mkdtemp(path.join(tmpdir(),'passage-service-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let clock=NOW;const logs=[];
  const runtime=new SourceRuntime({cacheDir:path.join(dir,'cache'),fetchImpl,now:()=>clock,log:event=>logs.push(event)});
  const reportArchive=new ReportArchive({file:path.join(dir,'reports.json'),now:()=>clock});
  return {service:createDataService({runtime,reportArchive,settings:{hosted:true,...settings},ais,version:'service-test'}),logs,advance:ms=>{clock+=ms;}};
}

test('the public API is exactly the dashboard endpoints and removed routes return nothing',async t=>{
  assert.deepEqual([...PUBLIC_API_PATHS].sort(),['/api/config','/api/diagnostics','/api/expectations','/api/maritime','/api/news','/api/oil','/api/transits','/api/vessels']);
  const {service:s}=await service(t,provider());
  for(const removed of ['/api/weather','/api/intelligence','/api/market-context','/api/acled','/api/acled/events','/api/acled/connect'])assert.equal(await s.get(removed),null,removed);
});

test('hosted responses never expose configured secrets and keep the frontend contract',async t=>{
  const requests=[],f=await service(t,provider(requests),{eiaApiKey:secret,aisstream:secret,unexpectedSecret:secret});
  const outputs={};
  for(const endpoint of PUBLIC_API_PATHS)outputs[endpoint]=await f.service.get(endpoint);
  assert.deepEqual({...outputs['/api/config']},{aisstream:true,eia:true,version:'service-test',hosted:true,capabilities:SOURCE_CAPABILITIES});
  assert.ok(requests.some(url=>url.hostname==='api.eia.gov'&&url.searchParams.get('api_key')===secret),'the key is used server-side');
  assert.equal(JSON.stringify({outputs,logs:f.logs}).includes(secret),false);
  const backend=assessBackendReadiness({config:outputs['/api/config'],diagnostics:outputs['/api/diagnostics'],news:outputs['/api/news'],maritime:outputs['/api/maritime'],transits:outputs['/api/transits'],oil:outputs['/api/oil']});
  assert.equal(backend.compatible,true,'the real service matches the publish gate even when supporting providers fail');
  assert.equal(outputs['/api/vessels'].vessels.length,1);
});

test('transits carry PortWatch daily counts and labelled baselines, cached between checks',async t=>{
  const requests=[],f=await service(t,provider(requests));
  const transits=await f.service.get('/api/transits');
  const hormuz=transits.daily.filter(row=>row.chokepoint==='hormuz');
  assert.equal(hormuz.at(-1).date,'2026-10-18');assert.equal(hormuz.at(-1).total,4);assert.equal(hormuz.at(-1).tankers,2);
  assert.equal(transits.baselines.hormuz.label,'2025 daily average');
  assert.ok(Math.abs(transits.baselines.hormuz.total-85.53)<.01&&Math.abs(transits.baselines.hormuz.tankers-48.18)<.01);
  assert.match(transits.baselines.bab.label,/before the Red Sea attacks/);
  assert.match(transits.attribution,/IMF PortWatch/);
  assert.equal(transits.source.id,'portwatch');
  const first=requests.length;
  await f.service.get('/api/transits');
  assert.equal(requests.length,first,'a repeat read within the hour is served from cache');
  f.advance(3601_000);await f.service.get('/api/transits');
  const refreshed=requests.slice(first);
  assert.ok(refreshed.length>=1&&refreshed.every(url=>!url.searchParams.get('outStatistics')),'baselines are reused for a day');
});

test('oil adds next-day closes and keeps daily history when the close page fails',async t=>{
  const f=await service(t,provider(),{eiaApiKey:'k'});
  const oil=await f.service.get('/api/oil');
  assert.deepEqual(oil.latestCloses.map(c=>[c.id,c.value,c.date]),[['brent',118.82,'2026-10-19'],['wti',110.01,'2026-10-19']]);
  assert.ok(oil.series.every(series=>series.observations.length===1));
  const broken=await service(t,async input=>{const url=new URL(input);if(url.hostname==='www.eia.gov')return new Response('<html>changed</html>');return provider()(input);},{eiaApiKey:'k'});
  const degraded=await broken.service.get('/api/oil');
  assert.deepEqual(degraded.latestCloses,[]);
  assert.ok(degraded.series.every(series=>series.observations.length===1),'history is independent of the close page');
});

test('register incidents carry an approximate position only when their location text can be placed',async t=>{
  const html=await fixture('imo/middle-east-highlighted-incidents.html');
  const f=await service(t,async input=>{const url=new URL(input);if(url.hostname==='www.imo.org')return new Response(html);return provider()(input);});
  const maritime=await f.service.get('/api/maritime');
  const placed=maritime.events.filter(e=>e.location),unplaced=maritime.events.filter(e=>!e.location);
  assert.ok(placed.length>0&&unplaced.length>0,'some register text is deliberately left unplaced');
  assert.ok(placed.every(e=>e.location.precision==='approximate'&&Number.isFinite(e.location.radiusNm)));
  assert.ok(placed.every(e=>e.location.lon>22.5&&e.location.lon<67.5&&e.location.lat>0&&e.location.lat<41),'positions stay in the theatre');
});
