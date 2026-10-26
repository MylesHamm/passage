import {SOURCE_CAPABILITIES,sourceConfigured} from '../dist/source-policy.mjs';
import {loadExpectations} from './expectations.mjs';
import {diagnosticSource} from './diagnostics.mjs';
import {MARITIME_FEEDS,parseMaritimePage} from './maritime.mjs';
import {loadReporting} from './reporting.mjs';
import {parseEIAApi} from './eia.mjs';
import {SOURCE_DEFINITIONS,sourceHealth} from '../dist/source-health.mjs';
import {parseEIA} from './feeds.mjs';
import {fetchPortWatch,PORTWATCH_BASELINE_TTL_SECONDS} from './portwatch.mjs';
import {fetchEiaToday} from './eia-today.mjs';
import {locateIncident} from './imo-places.mjs';
import {CURATED_EVENTS_URL,parseCuratedEvents} from './curated-events.mjs';

export const PUBLIC_API_PATHS = new Set(['/api/expectations','/api/news','/api/maritime','/api/oil','/api/transits','/api/events','/api/vessels','/api/config','/api/diagnostics']);

// Hosts supply persistence, streaming transport and secrets. Public responses
// use an explicit config allowlist, never the host's environment object.
export function createDataService({runtime,reportArchive,settings={},ais,version,collection={}}) {
const config={aisstream:!!settings.aisstream,openwaters:!!settings.openwaters,eia:!!settings.eiaApiKey,version,hosted:!!settings.hosted,capabilities:SOURCE_CAPABILITIES};
const newest=items=>items.map(x=>x.publishedAt).filter(x=>typeof x==='string'&&Number.isFinite(Date.parse(x))).sort().at(-1)||null;
const metadata=id=>SOURCE_DEFINITIONS.find(s=>s.id===id);
function health(id,data={}){
  const def=metadata(id);data={...data};
  if(def.group==='news'&&data.items){data.recordCount=data.items.length;data.latestRelevant=newest(data.items);}
  if(data.observations){data.recordCount=data.observations.length;data.latest=data.observations.at(-1)?.date||null;}
  for(const field of ['items','observations','events','advisories','vessels','markets','notes','coverage'])delete data[field];
  return sourceHealth({...def,...data,name:def.name,configured:sourceConfigured(def,config),connection:data.connection||'loading'});
}
async function news(context) {
  const data=await loadReporting(runtime,{...config,reportArchive},context);
  return {...data,coverage:{...data.coverage,collection:(typeof collection==='function'?collection():collection)}};
}
async function expectations(context){const data=await loadExpectations(runtime,context);return {...data,markets:data.markets||[],source:health('polymarket',data)};}
async function maritime(context) {
  const results=await Promise.all(MARITIME_FEEDS.map(async feed=>{
    const data=await runtime.get(feed.id,feed.interval,async({fetchText})=>{
      const events=parseMaritimePage(await fetchText(feed.url),feed);
      return {events,recordCount:events.length,latest:events.map(e=>e.eventDate||e.publishedDate).filter(Boolean).sort().at(-1)||null,
        sourceUpdatedDate:events.map(e=>e.sourceUpdatedDate).filter(Boolean).sort().at(-1)||null,
        access:'Official public HTML index',publicationPrecision:'day',url:feed.url};
    },context);
    const {events,...meta}=data;
    return {events:events||[],source:health(feed.id,meta)};
  }));
  // Register locations are free text; only parsed, in-region places gain an approximate position.
  const events=results.flatMap(r=>r.events).map(event=>({...event,location:locateIncident(event.locationText)}));
  return {events,sources:results.map(r=>r.source),generatedAt:new Date(runtime.now()).toISOString(),
    coverage:{complete:false,incidentBasis:'IMO source-confirmed register; not comprehensive incident coverage'}};
}
async function oil(context) {
  const keyed=config.eia;
  const series=await Promise.all([{id:'brent',name:'Brent',slug:'RBRTEd',seriesId:'RBRTE'},{id:'wti',name:'WTI',slug:'RWTCd',seriesId:'RWTC'}].map(async s=>{
    const url=`https://www.eia.gov/dnav/pet/hist/${s.slug}.htm`;
    const data=await runtime.get(s.id,3600,async({fetchText:remote})=>{
      let parsed;
      if(keyed){const api=new URL(`https://api.eia.gov/v2/seriesid/PET.${s.seriesId}.D`);api.searchParams.set('api_key',settings.eiaApiKey);parsed=parseEIAApi(JSON.parse(await remote(api)),s.seriesId,Date.now(),800);}
      else parsed=parseEIA(await remote(url),Date.now(),800);
      // EIA echoes the key in its envelope. Only the parser's allowlisted data survives.
      return {url,access:keyed?'EIA API':'EIA public table',observationBasis:'Daily spot observation; publication time unknown',...parsed,recordCount:parsed.observations.length,latest:parsed.observations.at(-1)?.date||null};
    },context,s.id+(keyed?'-api-history':'-history'));
    return {...data,...health(s.id,{...data,latest:data.observations?.at(-1)?.date||null,recordCount:data.observations?.length||0}),name:s.name,url};
  }));
  const today=await latestCloses(context);
  return {series,latestCloses:today.closes,closeSource:today.source,unit:'USD per barrel',basis:'Daily spot prices',source:'U.S. Energy Information Administration'};
}
// PortWatch baselines are fixed historical windows: two statistics queries a day.
let portwatchBaselines=null;
async function transits(context){
  const data=await runtime.get('portwatch',3600,async()=>{
    const cached=portwatchBaselines&&runtime.now()-Date.parse(portwatchBaselines.retrievedAt)<PORTWATCH_BASELINE_TTL_SECONDS*1000?portwatchBaselines:null;
    const result=await fetchPortWatch({fetchImpl:runtime.fetchImpl||fetch,now:()=>runtime.now(),days:60,baselines:cached||true});
    if(result.baselines&&!cached)portwatchBaselines={baselines:result.baselines,retrievedAt:result.baselinesRetrievedAt};
    const latest=Object.values(result.latestDate).filter(Boolean).sort().at(-1)||null;
    return {...result,latest,access:'Keyless public ArcGIS table',observationBasis:'Daily transit counts derived from satellite AIS; weekly release'};
  },context);
  const baselines=Object.fromEntries(Object.entries(data.baselines||{}).map(([id,b])=>[id,{label:b.label,window:b.windowLabel,total:b.avgTotal,tankers:b.avgTankers,complete:b.complete}]));
  return {daily:data.items||[],latestDate:data.latestDate||{},baselines,source:health('portwatch',data),attribution:data.source?.attribution||'Sources: UN Global Platform; IMF PortWatch (portwatch.imf.org)'};
}
async function latestCloses(context){
  try{
    const data=await runtime.get('eia-today',3600,async()=>{
      const result=await fetchEiaToday({fetchImpl:runtime.fetchImpl||fetch,now:()=>runtime.now()});
      return {...result,latest:result.series.map(s=>s.date).filter(Boolean).sort().at(-1)||null};
    },context);
    return {closes:(data.series||[]).filter(s=>Number.isFinite(s.value)&&s.date).map(s=>({id:s.id,value:s.value,date:s.date,basis:s.basis||'EIA spot close'})),source:health('eia-today',data)};
  }catch{return {closes:[],source:health('eia-today',runtime.peek('eia-today'))};}
}
// The curated list is read from the repository every ten minutes. A list that
// fails its rules is rejected and the last good copy stays in service.
async function events(context){
  const url=settings.curatedEventsUrl||CURATED_EVENTS_URL;
  const data=await runtime.get('curated-events',600,async({fetchText})=>{
    const parsed=parseCuratedEvents(await fetchText(url),{now:runtime.now()});
    return {...parsed,latest:parsed.reviewedAt,recordCount:parsed.events.length,access:'Public repository file',url};
  },context);
  const {events:list,missions,schema,reviewedAt,basis,...meta}=data;
  return {schema:schema||null,reviewedAt:reviewedAt||null,basis:basis||'',events:list||[],missions:missions||[],source:health('curated-events',meta)};
}
function vessels(context){return ais.snapshot({context});}
function diagnosticSnapshot(){
  const feed=ais.snapshot({touch:false});
  const sources=SOURCE_DEFINITIONS.map(s=>s.id==='aisstream'?health(s.id,feed.source):s.id==='openwaters'?health(s.id,feed.relays?.find(r=>r.id==='openwaters')||{connection:'not configured'}):health(s.id,runtime.peek(s.id)));
  const enabled=sources.filter(s=>s.configured);
  return {...runtime.snapshot(),version,readiness:enabled.some(s=>s.attention)?'degraded':enabled.some(s=>s.status==='loading')?'checking':'available',sources:sources.map(diagnosticSource),ais:ais.diagnostics()};
}

async function collect(context={}) {
  // The runtime coalesces in-flight requests and enforces each provider's TTL
  // and retry deadline across both visitors and scheduled collection.
  const [reporting]=await Promise.all([news(context),maritime(context),oil(context),expectations(context),transits(context).catch(()=>null),events(context).catch(()=>null)]);
  return {completedAt:new Date(runtime.now()).toISOString(),reports:reporting.items.length,diagnostics:diagnosticSnapshot()};
}

async function get(pathname,searchParams=new URLSearchParams(),context={}) {
  if(pathname==='/api/news')return news(context);
  if(pathname==='/api/maritime')return maritime(context);
  if(pathname==='/api/expectations')return expectations(context);
  if(pathname==='/api/oil')return oil(context);
  if(pathname==='/api/vessels')return vessels(context);
  if(pathname==='/api/transits')return transits(context);
  if(pathname==='/api/events')return events(context);
  if(pathname==='/api/config')return config;
  if(pathname==='/api/diagnostics')return diagnosticSnapshot();
  return null;
}
return {get,news,expectations,collect,diagnostics:diagnosticSnapshot,health,config};
}
