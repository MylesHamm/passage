import {SourceError,fetchText} from './source-runtime.mjs';

// IMF PortWatch daily chokepoint transits: a keyless public ArcGIS table that
// returns at most 1,000 records per query. Verified 2026-10-20 against the layer
// metadata and live queries: `date` is esriFieldTypeDateOnly and arrives as a
// 'YYYY-MM-DD' string, the total-capacity field is `capacity`, and a rejected
// query can come back as HTTP 200 with an ArcGIS {error:{code}} envelope.
// Counts are PortWatch's vessel-transit estimates; they are not observed crude
// cargo or barrels per day and must not be relabeled as such.
const ENDPOINT='https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';
const MAX_RECORDS=1000,MAX_BYTES=2000000,DAY=86400000,TIMEOUT_MS=20000;
const DAILY_FIELDS=['date','portid','portname','n_tanker','n_total','capacity_tanker','capacity'];

export const PORTWATCH_SOURCE=Object.freeze({
  id:'portwatch',name:'IMF PortWatch',home:'https://portwatch.imf.org',url:ENDPOINT,
  dataset:'Daily_Chokepoints_Data',
  attribution:'Sources: UN Global Platform; IMF PortWatch (portwatch.imf.org)',
  cadence:'Weekly release; daily values',
  access:'Keyless public ArcGIS table',
});

// portname is checked as well as portid so a renumbered table cannot silently
// relabel another strait as Hormuz or Bab el-Mandeb.
const CHOKEPOINTS=Object.freeze([
  Object.freeze({chokepoint:'bab',portid:'chokepoint4',portname:/^bab[\s-]?el[\s-]?mandeb\b/i}),
  Object.freeze({chokepoint:'hormuz',portid:'chokepoint6',portname:/^strait of hormuz$/i}),
]);
export const PORTWATCH_CHOKEPOINTS=Object.freeze(Object.fromEntries(CHOKEPOINTS.map(c=>[c.chokepoint,c.portid])));

// Baselines are fixed historical windows; they change only if PortWatch revises
// history, so callers should cache fetchPortWatchBaselines() for a day or more.
export const PORTWATCH_BASELINE_TTL_SECONDS=86400;
export const PORTWATCH_BASELINES=Object.freeze({
  hormuz:Object.freeze({chokepoint:'hormuz',portid:'chokepoint6',label:'2025 daily average',startDate:'2025-01-01',endDate:'2025-12-31'}),
  bab:Object.freeze({chokepoint:'bab',portid:'chokepoint4',label:'Jan–Oct 2023 daily average (before the Red Sea attacks)',startDate:'2023-01-01',endDate:'2023-10-31'}),
});
const STATISTICS=Object.freeze([
  ['avg','n_tanker','avg_n_tanker'],['avg','n_total','avg_n_total'],
  ['count','n_tanker','count_n_tanker'],['count','n_total','count_n_total'],
  ['min','date','min_date'],['max','date','max_date'],
].map(([statisticType,onStatisticField,outStatisticFieldName])=>({statisticType,onStatisticField,outStatisticFieldName})));

const iso=ms=>new Date(ms).toISOString();
const clockOf=now=>typeof now==='function'?now:()=>now;
function calendarDate(value) {
  let date=null;
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const ms=Date.parse(value+'T00:00:00Z');
    if(Number.isFinite(ms)&&iso(ms).slice(0,10)===value)date=value;
  // A legacy esriFieldTypeDate is epoch ms; only an exact UTC midnight is a day.
  } else if(Number.isSafeInteger(value)&&value%DAY===0&&Math.abs(value)<=8640000000000000)date=iso(value).slice(0,10);
  return date&&date>='2000-01-01'&&date<='2200-12-31'?date:null;
}
function count(value) {
  const n=typeof value==='number'?value:typeof value==='string'&&/^\s*\d+\s*$/.test(value)?Number(value):NaN;
  return Number.isSafeInteger(n)&&n>=0?n:null;
}
const average=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
function query(params) {
  const url=new URL(ENDPOINT);
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  return url.href;
}
function features(json) {
  if(!json||typeof json!=='object'||Array.isArray(json))throw new SourceError('schema');
  if(json.error!==undefined) {
    const code=Number(json.error?.code);
    throw new SourceError([401,403,498,499].includes(code)?'auth':code===429?'rate_limit':'upstream_http',{status:Number.isInteger(code)?code:null});
  }
  // A truncated page would silently drop days, so it is a schema failure.
  if(!Array.isArray(json.features)||json.features.length>MAX_RECORDS||json.exceededTransferLimit===true)throw new SourceError('schema');
  return json.features;
}
async function getJson(url,{fetchImpl,clock,timeoutMs}) {
  const text=await fetchText(url,{fetchImpl,timeoutMs,now:clock,maxBytes:MAX_BYTES});
  try{return JSON.parse(text);}catch{throw new SourceError('schema');}
}

export function dailyQueryUrl(startDate) {
  const start=calendarDate(startDate);
  if(!start)throw new TypeError('PortWatch start date must be a valid YYYY-MM-DD date');
  return query({
    where:`portid IN (${CHOKEPOINTS.map(c=>`'${c.portid}'`).join(',')}) AND date >= DATE '${start}'`,
    outFields:DAILY_FIELDS.join(','),orderByFields:'date ASC',returnGeometry:'false',f:'json',
  });
}

export function baselineQueryUrl(portid,startDate,endDate) {
  // Values are interpolated into an ArcGIS where clause, so accept only known shapes.
  if(typeof portid!=='string'||!/^chokepoint\d{1,3}$/.test(portid))throw new TypeError('PortWatch portid must look like chokepoint<N>');
  const start=calendarDate(startDate),end=calendarDate(endDate);
  if(!start||!end||start>end)throw new TypeError('PortWatch baseline window must be valid YYYY-MM-DD dates with start <= end');
  return query({
    where:`portid = '${portid}' AND date >= DATE '${start}' AND date <= DATE '${end}'`,
    outStatistics:JSON.stringify(STATISTICS),returnGeometry:'false',f:'json',
  });
}

function dailyRow(attributes,today) {
  if(!attributes||typeof attributes!=='object'||Array.isArray(attributes))return null;
  const known=CHOKEPOINTS.find(c=>c.portid===attributes.portid);
  if(!known||typeof attributes.portname!=='string'||!known.portname.test(attributes.portname.trim()))return null;
  const date=calendarDate(attributes.date);
  if(!date||date>today)return null;
  // Missing or non-finite counts are rejected, never coerced to zero.
  const tankers=count(attributes.n_tanker),total=count(attributes.n_total);
  if(tankers===null||total===null||tankers>total)return null;
  return {chokepoint:known.chokepoint,portid:known.portid,date,tankers,total,
    tankerCapacity:count(attributes.capacity_tanker),totalCapacity:count(attributes.capacity)};
}

function parseDaily(json,now) {
  const list=features(json);
  if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))throw new TypeError('PortWatch clock is invalid');
  const today=iso(now).slice(0,10),groups=new Map();let rejected=0;
  for(const feature of list) {
    const row=dailyRow(feature?.attributes,today);
    if(!row){rejected++;continue;}
    const key=row.chokepoint+'|'+row.date;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const rows=[];
  for(const group of groups.values()) {
    // Identical republished rows collapse. Conflicting values for one day are
    // dropped: ArcGIS response order is not a revision order, so either choice
    // would be a guess, and the outcome must not depend on input order.
    const first=JSON.stringify(group[0]);
    if(group.every(row=>JSON.stringify(row)===first))rows.push(group[0]);else rejected+=group.length;
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date)||a.chokepoint.localeCompare(b.chokepoint));
  return {rows,rejected};
}

export function parsePortWatchDaily(json,now=Date.now()) {
  return parseDaily(json,now).rows;
}

export function parsePortWatchBaseline(json) {
  const list=features(json);
  const attributes=list.length===1?list[0]?.attributes:null;
  if(!attributes||typeof attributes!=='object')throw new SourceError('schema');
  const avgTankers=average(attributes.avg_n_tanker),avgTotal=average(attributes.avg_n_total);
  const tankerDays=count(attributes.count_n_tanker),totalDays=count(attributes.count_n_total);
  const firstDate=calendarDate(attributes.min_date),lastDate=calendarDate(attributes.max_date);
  // An empty window returns null averages; never report that as a zero baseline.
  if(avgTankers===null||avgTotal===null||!tankerDays||!totalDays||!firstDate||!lastDate||firstDate>lastDate)throw new SourceError('schema');
  if(tankerDays===totalDays&&avgTankers>avgTotal)throw new SourceError('schema');
  return {avgTankers,avgTotal,tankerDays,totalDays,firstDate,lastDate};
}

export async function fetchPortWatchBaselines({fetchImpl=fetch,now=Date.now,timeoutMs=TIMEOUT_MS}={}) {
  const clock=clockOf(now);
  const entries=await Promise.all(Object.values(PORTWATCH_BASELINES).map(async definition=>{
    const stats=parsePortWatchBaseline(await getJson(baselineQueryUrl(definition.portid,definition.startDate,definition.endDate),{fetchImpl,clock,timeoutMs}));
    const expectedDays=(Date.parse(definition.endDate)-Date.parse(definition.startDate))/DAY+1;
    // Statistics from outside the requested window, or more rows than days,
    // mean the server did not apply the filter we asked for.
    if(stats.firstDate<definition.startDate||stats.lastDate>definition.endDate||stats.tankerDays>expectedDays||stats.totalDays>expectedDays)throw new SourceError('schema');
    return [definition.chokepoint,{...definition,windowLabel:`${definition.startDate} to ${definition.endDate}`,expectedDays,...stats,
      complete:stats.tankerDays===expectedDays&&stats.totalDays===expectedDays}];
  }));
  return {baselines:Object.fromEntries(entries),retrievedAt:iso(clock()),cacheTtlSeconds:PORTWATCH_BASELINE_TTL_SECONDS,source:{...PORTWATCH_SOURCE}};
}

// `baselines`: true fetches them (two small statistics queries), false skips
// them, or pass a previous fetchPortWatchBaselines() result to reuse a cache.
// A failed baseline fetch does not discard the daily rows: it is reported as
// baselinesError with its category. A failed daily fetch rejects with SourceError.
export async function fetchPortWatch({fetchImpl=fetch,now=Date.now,days=60,baselines=true,timeoutMs=TIMEOUT_MS}={}) {
  if(!Number.isInteger(days)||days<1||days>400)throw new RangeError('PortWatch days must be an integer from 1 to 400');
  const clock=clockOf(now),start=clock();
  if(!Number.isFinite(start))throw new TypeError('PortWatch clock is invalid');
  const startDate=iso(start-days*DAY).slice(0,10);
  let baselinesError=null;
  const [daily,base]=await Promise.all([
    getJson(dailyQueryUrl(startDate),{fetchImpl,clock,timeoutMs}).then(json=>parseDaily(json,start)),
    baselines===true
      ?fetchPortWatchBaselines({fetchImpl,now:clock,timeoutMs}).catch(error=>{
        if(!(error instanceof SourceError))throw error;
        baselinesError={category:error.category,status:error.status};return null;
      })
      :Promise.resolve(baselines&&typeof baselines==='object'?baselines:null),
  ]);
  const items=daily.rows.filter(row=>row.date>=startDate);
  if(!items.length)throw new SourceError('schema');
  const latestDate=Object.fromEntries(CHOKEPOINTS.map(c=>[c.chokepoint,items.findLast(row=>row.chokepoint===c.chokepoint)?.date??null]));
  return {
    items,latestDate,window:{startDate,days},
    baselines:base?.baselines??null,baselinesRetrievedAt:base?.retrievedAt??null,baselinesError,
    recordCount:items.length,rejectedCount:daily.rejected+daily.rows.length-items.length,
    retrievedAt:iso(clock()),source:{...PORTWATCH_SOURCE},
  };
}
