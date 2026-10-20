import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SourceError} from '../lib/source-runtime.mjs';
import {
  PORTWATCH_SOURCE,PORTWATCH_BASELINES,PORTWATCH_CHOKEPOINTS,PORTWATCH_BASELINE_TTL_SECONDS,
  dailyQueryUrl,baselineQueryUrl,parsePortWatchDaily,parsePortWatchBaseline,fetchPortWatch,fetchPortWatchBaselines,
} from '../lib/portwatch.mjs';

const fixture=name=>readFile(new URL(`./fixtures/portwatch/${name}`,import.meta.url),'utf8');
const dailyText=await fixture('daily-2026-10-05-to-10-18.json');
const hormuzText=await fixture('baseline-hormuz-2025.json');
const babText=await fixture('baseline-bab-2023-jan-oct.json');
const now=Date.parse('2026-10-20T20:47:10Z');
const ENDPOINT='https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';
const DAILY_URL=ENDPOINT+'?where=portid+IN+%28%27chokepoint4%27%2C%27chokepoint6%27%29+AND+date+%3E%3D+DATE+%272026-08-21%27&outFields=date%2Cportid%2Cportname%2Cn_tanker%2Cn_total%2Ccapacity_tanker%2Ccapacity&orderByFields=date+ASC&returnGeometry=false&f=json';
const STATS='outStatistics=%5B%7B%22statisticType%22%3A%22avg%22%2C%22onStatisticField%22%3A%22n_tanker%22%2C%22outStatisticFieldName%22%3A%22avg_n_tanker%22%7D%2C%7B%22statisticType%22%3A%22avg%22%2C%22onStatisticField%22%3A%22n_total%22%2C%22outStatisticFieldName%22%3A%22avg_n_total%22%7D%2C%7B%22statisticType%22%3A%22count%22%2C%22onStatisticField%22%3A%22n_tanker%22%2C%22outStatisticFieldName%22%3A%22count_n_tanker%22%7D%2C%7B%22statisticType%22%3A%22count%22%2C%22onStatisticField%22%3A%22n_total%22%2C%22outStatisticFieldName%22%3A%22count_n_total%22%7D%2C%7B%22statisticType%22%3A%22min%22%2C%22onStatisticField%22%3A%22date%22%2C%22outStatisticFieldName%22%3A%22min_date%22%7D%2C%7B%22statisticType%22%3A%22max%22%2C%22onStatisticField%22%3A%22date%22%2C%22outStatisticFieldName%22%3A%22max_date%22%7D%5D';
const HORMUZ_URL=ENDPOINT+'?where=portid+%3D+%27chokepoint6%27+AND+date+%3E%3D+DATE+%272025-01-01%27+AND+date+%3C%3D+DATE+%272025-12-31%27&'+STATS+'&returnGeometry=false&f=json';
const BAB_URL=ENDPOINT+'?where=portid+%3D+%27chokepoint4%27+AND+date+%3E%3D+DATE+%272023-01-01%27+AND+date+%3C%3D+DATE+%272023-10-31%27&'+STATS+'&returnGeometry=false&f=json';

const envelope=attributes=>({...JSON.parse(dailyText),features:attributes.map(a=>({attributes:a}))});
const row=(overrides={})=>({date:'2026-10-10',portid:'chokepoint6',portname:'Strait of Hormuz',n_tanker:3,n_total:9,capacity_tanker:120000,capacity:300000,...overrides});
const rejected=attributes=>parsePortWatchDaily(envelope([attributes]),now).length===0;
function routes(map,requested=[]) {
  return async(url,options)=>{
    // Tests never touch the network: every request must be a known, exact URL.
    assert.ok(options.signal instanceof AbortSignal);
    requested.push(String(url));
    const body=map.get(String(url));
    assert.ok(body!==undefined,`unexpected request ${url}`);
    return typeof body==='function'?body():new Response(body,{status:200,headers:{'content-type':'application/json; charset=utf-8'}});
  };
}
const allRoutes=()=>new Map([[DAILY_URL,dailyText],[HORMUZ_URL,hormuzText],[BAB_URL,babText]]);
const isCategory=(category,status=null)=>error=>error instanceof SourceError&&error.category===category&&error.status===status;

test('real PortWatch fixture parses to sorted, typed daily rows for both chokepoints',()=>{
  const rows=parsePortWatchDaily(JSON.parse(dailyText),now);
  assert.equal(rows.length,28);
  assert.equal(rows.filter(r=>r.chokepoint==='hormuz').length,14);
  assert.equal(rows.filter(r=>r.chokepoint==='bab').length,14);
  assert.deepEqual(rows[0],{chokepoint:'bab',portid:'chokepoint4',date:'2026-10-05',tankers:13,total:28,tankerCapacity:841422,totalCapacity:1301061});
  assert.deepEqual(rows.at(-1),{chokepoint:'hormuz',portid:'chokepoint6',date:'2026-10-18',tankers:2,total:4,tankerCapacity:19163,totalCapacity:125163});
  assert.deepEqual(rows.at(-2),{chokepoint:'bab',portid:'chokepoint4',date:'2026-10-18',tankers:17,total:32,tankerCapacity:740408,totalCapacity:1055547});
  // A real zero-transit day is data, not a missing value.
  assert.deepEqual(rows.find(r=>r.chokepoint==='hormuz'&&r.date==='2026-10-17'),{chokepoint:'hormuz',portid:'chokepoint6',date:'2026-10-17',tankers:0,total:0,tankerCapacity:0,totalCapacity:0});
  for(let i=1;i<rows.length;i++)assert.ok(rows[i-1].date<rows[i].date||rows[i-1].date===rows[i].date&&rows[i-1].chokepoint<rows[i].chokepoint);
  assert.deepEqual(PORTWATCH_CHOKEPOINTS,{bab:'chokepoint4',hormuz:'chokepoint6'});
});

test('rows with invalid dates, non-finite or inconsistent counts, or unknown identity are rejected, never coerced to zero',()=>{
  for(const n_tanker of [null,undefined,'',' ','abc',Number.NaN,Infinity,-1,2.5,'3.5',true,{}])assert.ok(rejected(row({n_tanker})),`n_tanker ${String(n_tanker)}`);
  for(const n_total of [null,Number.NaN,-Infinity,'',-4])assert.ok(rejected(row({n_total})),`n_total ${String(n_total)}`);
  assert.ok(rejected(row({n_tanker:10,n_total:9})),'tankers cannot exceed total transits');
  for(const date of [null,'','2026-02-30','2026-10-1','10/10/2026','2026-10-10T00:00:00Z',Date.UTC(2026,9,10,12),Number.NaN,'2026-10-21','2099-01-01'])assert.ok(rejected(row({date})),`date ${String(date)}`);
  assert.ok(rejected(row({portid:'chokepoint1'})));
  assert.ok(rejected(row({portname:'Bab el-Mandeb Strait'})),'portid/portname mismatch must not be relabeled');
  assert.ok(rejected(row({portname:null})));
  assert.equal(parsePortWatchDaily({...envelope([]),features:[null,{},{attributes:null},{attributes:[]}]},now).length,0);
});

test('accepted value shapes stay exact; capacities that are unusable become null rather than zero',()=>{
  const [legacy]=parsePortWatchDaily(envelope([row({date:Date.UTC(2026,9,10),n_tanker:'3',n_total:' 9 '})]),now);
  assert.deepEqual(legacy,{chokepoint:'hormuz',portid:'chokepoint6',date:'2026-10-10',tankers:3,total:9,tankerCapacity:120000,totalCapacity:300000});
  const [noCapacity]=parsePortWatchDaily(envelope([row({capacity_tanker:null,capacity:-1})]),now);
  assert.equal(noCapacity.tankerCapacity,null);assert.equal(noCapacity.totalCapacity,null);
  assert.equal(noCapacity.tankers,3);
  const [bab]=parsePortWatchDaily(envelope([row({portid:'chokepoint4',portname:'Bab el-Mandeb Strait'})]),now);
  assert.equal(bab.chokepoint,'bab');
});

test('duplicate dates collapse when identical and drop when conflicting, independent of input order',()=>{
  const same=parsePortWatchDaily(envelope([row(),row(),row({date:'2026-10-11'})]),now);
  assert.deepEqual(same.map(r=>r.date),['2026-10-10','2026-10-11']);
  const input=[row({date:'2026-10-11'}),row({n_tanker:4}),row(),row({portid:'chokepoint4',portname:'Bab el-Mandeb Strait'})];
  const forward=parsePortWatchDaily(envelope(input),now),reverse=parsePortWatchDaily(envelope([...input].reverse()),now);
  assert.deepEqual(forward,reverse);
  assert.deepEqual(forward.map(r=>[r.chokepoint,r.date]),[['bab','2026-10-10'],['hormuz','2026-10-11']]);
  const real=JSON.parse(dailyText);real.features=[...real.features,...real.features];
  assert.deepEqual(parsePortWatchDaily(real,now),parsePortWatchDaily(JSON.parse(dailyText),now));
});

test('ArcGIS envelopes fail with categorized errors instead of returning partial or empty data',()=>{
  assert.throws(()=>parsePortWatchDaily({error:{code:400,message:'',details:["'where' parameter is invalid"]}},now),isCategory('upstream_http',400));
  assert.throws(()=>parsePortWatchDaily({error:{code:498,message:'Invalid token'}},now),isCategory('auth',498));
  assert.throws(()=>parsePortWatchDaily({error:{code:429}},now),isCategory('rate_limit',429));
  assert.throws(()=>parsePortWatchDaily({...JSON.parse(dailyText),exceededTransferLimit:true},now),isCategory('schema'));
  for(const bad of [null,[],'text',{features:null},{features:{}},{features:Array(1001).fill({attributes:row()})}])assert.throws(()=>parsePortWatchDaily(bad,now),isCategory('schema'));
});

test('real baseline fixtures parse to server-side averages with their coverage',()=>{
  assert.deepEqual(parsePortWatchBaseline(JSON.parse(hormuzText)),{avgTankers:48.178082191780824,avgTotal:85.52876712328766,tankerDays:365,totalDays:365,firstDate:'2025-01-01',lastDate:'2025-12-31'});
  assert.deepEqual(parsePortWatchBaseline(JSON.parse(babText)),{avgTankers:26.154605263157894,avgTotal:74.58552631578948,tankerDays:304,totalDays:304,firstDate:'2023-01-01',lastDate:'2023-10-31'});
});

test('empty, ambiguous or malformed baseline statistics are rejected rather than reported as zero',()=>{
  const base=JSON.parse(hormuzText),attrs=base.features[0].attributes;
  const with_=changes=>({...base,features:[{attributes:{...attrs,...changes}}]});
  for(const changes of [{avg_n_tanker:null,avg_n_total:null,count_n_tanker:0,count_n_total:0,min_date:null,max_date:null},{avg_n_tanker:'48.1'},{avg_n_total:Number.NaN},{count_n_total:0},{min_date:'2025-13-01'},{min_date:'2026-01-01'},{avg_n_tanker:90}]) {
    assert.throws(()=>parsePortWatchBaseline(with_(changes)),isCategory('schema'),JSON.stringify(changes));
  }
  assert.throws(()=>parsePortWatchBaseline({...base,features:[...base.features,...base.features]}),isCategory('schema'));
  assert.throws(()=>parsePortWatchBaseline({...base,features:[]}),isCategory('schema'));
  assert.throws(()=>parsePortWatchBaseline({error:{code:400}}),isCategory('upstream_http',400));
});

test('query URLs are built exactly, with an encoded where clause and server-side statistics',()=>{
  assert.equal(dailyQueryUrl('2026-08-21'),DAILY_URL);
  assert.equal(baselineQueryUrl('chokepoint6','2025-01-01','2025-12-31'),HORMUZ_URL);
  assert.equal(baselineQueryUrl('chokepoint4','2023-01-01','2023-10-31'),BAB_URL);
  const daily=new URL(DAILY_URL).searchParams;
  assert.equal(daily.get('where'),"portid IN ('chokepoint4','chokepoint6') AND date >= DATE '2026-08-21'");
  const params=new URL(HORMUZ_URL).searchParams;
  assert.equal(params.get('where'),"portid = 'chokepoint6' AND date >= DATE '2025-01-01' AND date <= DATE '2025-12-31'");
  assert.deepEqual(JSON.parse(params.get('outStatistics')).map(s=>[s.statisticType,s.onStatisticField,s.outStatisticFieldName]),[
    ['avg','n_tanker','avg_n_tanker'],['avg','n_total','avg_n_total'],['count','n_tanker','count_n_tanker'],
    ['count','n_total','count_n_total'],['min','date','min_date'],['max','date','max_date'],
  ]);
  assert.equal(params.has('outFields'),false);
  // Interpolated values cannot alter the where clause.
  for(const args of [["chokepoint6' OR '1'='1",'2025-01-01','2025-12-31'],['chokepoint6',"2025-01-01' OR 1=1 --",'2025-12-31'],['chokepoint6','2025-12-31','2025-01-01'],['chokepoint6','2025-02-30','2025-12-31'],[6,'2025-01-01','2025-12-31']]) {
    assert.throws(()=>baselineQueryUrl(...args),TypeError);
  }
  assert.throws(()=>dailyQueryUrl("2026-08-21' OR 1=1"),TypeError);
});

test('fetchPortWatch returns recent rows, latest dates, labelled baselines and source metadata through an injected fetch',async()=>{
  const requested=[];
  const result=await fetchPortWatch({fetchImpl:routes(allRoutes(),requested),now:()=>now});
  assert.deepEqual(requested.sort(),[DAILY_URL,HORMUZ_URL,BAB_URL].sort());
  assert.equal(result.items.length,28);assert.equal(result.recordCount,28);assert.equal(result.rejectedCount,0);
  assert.deepEqual(result.latestDate,{bab:'2026-10-18',hormuz:'2026-10-18'});
  assert.deepEqual(result.window,{startDate:'2026-08-21',days:60});
  assert.equal(result.retrievedAt,'2026-10-20T20:47:10.000Z');
  assert.equal(result.baselinesRetrievedAt,'2026-10-20T20:47:10.000Z');
  assert.equal(result.baselinesError,null);
  assert.deepEqual(result.baselines.hormuz,{chokepoint:'hormuz',portid:'chokepoint6',label:'2025 daily average',startDate:'2025-01-01',endDate:'2025-12-31',
    windowLabel:'2025-01-01 to 2025-12-31',expectedDays:365,avgTankers:48.178082191780824,avgTotal:85.52876712328766,tankerDays:365,totalDays:365,firstDate:'2025-01-01',lastDate:'2025-12-31',complete:true});
  assert.equal(result.baselines.bab.label,'Jan–Oct 2023 daily average (before the Red Sea attacks)');
  assert.equal(result.baselines.bab.windowLabel,'2023-01-01 to 2023-10-31');
  assert.equal(result.baselines.bab.expectedDays,304);assert.equal(result.baselines.bab.complete,true);
  assert.equal(result.baselines.bab.avgTankers,26.154605263157894);
  assert.deepEqual(result.source,{id:'portwatch',name:'IMF PortWatch',home:'https://portwatch.imf.org',url:ENDPOINT,dataset:'Daily_Chokepoints_Data',
    attribution:'Sources: UN Global Platform; IMF PortWatch (portwatch.imf.org)',cadence:'Weekly release; daily values',access:'Keyless public ArcGIS table'});
  assert.equal(result.source.url,PORTWATCH_SOURCE.url);
  // A numeric clock works as well as a function.
  assert.deepEqual((await fetchPortWatch({fetchImpl:routes(allRoutes()),now})).items,result.items);
});

test('baselines can be skipped or reused from a 24-hour cache without extra requests',async()=>{
  assert.equal(PORTWATCH_BASELINE_TTL_SECONDS>=86400,true);
  assert.deepEqual(Object.keys(PORTWATCH_BASELINES),['hormuz','bab']);
  const cachedRequests=[];
  const cached=await fetchPortWatchBaselines({fetchImpl:routes(allRoutes(),cachedRequests),now});
  assert.deepEqual(cachedRequests.sort(),[HORMUZ_URL,BAB_URL].sort());
  assert.equal(cached.cacheTtlSeconds,86400);assert.equal(cached.source.id,'portwatch');
  const skipped=[];
  const without=await fetchPortWatch({fetchImpl:routes(allRoutes(),skipped),now,baselines:false});
  assert.deepEqual(skipped,[DAILY_URL]);assert.equal(without.baselines,null);
  const reused=[];
  const withCache=await fetchPortWatch({fetchImpl:routes(allRoutes(),reused),now:now+3600000,baselines:cached});
  assert.equal(reused.length,1);
  assert.deepEqual(withCache.baselines,cached.baselines);
  assert.equal(withCache.baselinesRetrievedAt,cached.retrievedAt);
});

test('a baseline window answered with out-of-window statistics is a schema failure',async()=>{
  const shifted=JSON.parse(hormuzText);shifted.features[0].attributes.max_date='2026-01-05';
  const map=allRoutes();map.set(HORMUZ_URL,JSON.stringify(shifted));
  await assert.rejects(fetchPortWatchBaselines({fetchImpl:routes(map),now}),isCategory('schema'));
  const inflated=JSON.parse(babText);inflated.features[0].attributes.count_n_total=305;
  const map2=allRoutes();map2.set(BAB_URL,JSON.stringify(inflated));
  await assert.rejects(fetchPortWatchBaselines({fetchImpl:routes(map2),now}),isCategory('schema'));
});

test('fetch failures yield categorized SourceErrors',async()=>{
  const failing=response=>routes(new Map([[DAILY_URL,response]]));
  await assert.rejects(fetchPortWatch({fetchImpl:async()=>{throw new TypeError('fetch failed');},now,baselines:false}),isCategory('network'));
  await assert.rejects(fetchPortWatch({fetchImpl:async()=>{throw new DOMException('The operation timed out.','TimeoutError');},now,baselines:false}),isCategory('timeout'));
  await assert.rejects(fetchPortWatch({fetchImpl:failing(()=>new Response('busy',{status:503})),now,baselines:false}),isCategory('upstream_http',503));
  await assert.rejects(fetchPortWatch({fetchImpl:failing(()=>new Response('slow down',{status:429,headers:{'retry-after':'120'}})),now,baselines:false}),
    error=>isCategory('rate_limit',429)(error)&&error.retryAfterMs===120000);
  await assert.rejects(fetchPortWatch({fetchImpl:failing(JSON.stringify({error:{code:400,message:'',details:["'where' parameter is invalid"]}})),now,baselines:false}),isCategory('upstream_http',400));
  await assert.rejects(fetchPortWatch({fetchImpl:failing('<html>maintenance</html>'),now,baselines:false}),isCategory('schema'));
  await assert.rejects(fetchPortWatch({fetchImpl:failing(JSON.stringify(envelope([]))),now,baselines:false}),isCategory('schema'));
  await assert.rejects(fetchPortWatch({fetchImpl:failing(JSON.stringify(envelope([row({n_tanker:null})]))),now,baselines:false}),isCategory('schema'));
});

test('a failed baseline query keeps the daily rows and reports the baseline error category',async()=>{
  const map=allRoutes();map.set(BAB_URL,()=>new Response('down',{status:502}));
  const result=await fetchPortWatch({fetchImpl:routes(map),now});
  assert.equal(result.items.length,28);
  assert.equal(result.baselines,null);
  assert.deepEqual(result.baselinesError,{category:'upstream_http',status:502});
});

test('rows before the requested window are dropped and counted; invalid options are refused',async()=>{
  const old=envelope([row({date:'2026-08-20'}),row()]);
  const map=new Map([[DAILY_URL,JSON.stringify(old)]]);
  const result=await fetchPortWatch({fetchImpl:routes(map),now,baselines:false});
  assert.deepEqual(result.items.map(r=>r.date),['2026-10-10']);
  assert.equal(result.rejectedCount,1);
  assert.deepEqual(result.latestDate,{bab:null,hormuz:'2026-10-10'});
  for(const days of [0,401,1.5,'60'])await assert.rejects(fetchPortWatch({fetchImpl:routes(map),now,days,baselines:false}),RangeError);
  await assert.rejects(fetchPortWatch({fetchImpl:routes(map),now:Number.NaN,baselines:false}),TypeError);
});
