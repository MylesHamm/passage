import {loadExpectations} from './expectations.mjs';
import {loadSourceWatch} from './source-watch.mjs';
import {diagnosticSource} from './diagnostics.mjs';
import {mergeVesselPositions,isCurrentVesselPosition} from '../dist/vessel-data.mjs';
import {MARITIME_FEEDS,parseMaritimePage} from './maritime.mjs';
import {loadReporting} from './reporting.mjs';
import {discoverySnapshot,waitForDiscovery} from './discovery.mjs';
import {loadMarketContext} from './market-context.mjs';
import {buildIntelligence} from '../dist/intelligence-data.mjs';
import {normalizeWeather} from './weather.mjs';
import {parseEIAApi} from './eia.mjs';
import {OPENWATERS_URL,parseOpenWaters} from './openwaters.mjs';
import {SourceError} from './source-runtime.mjs';
import {SOURCE_DEFINITIONS,sourceHealth} from '../dist/source-health.mjs';
import {THEATERS,parseEIA} from './feeds.mjs';

export const PUBLIC_API_PATHS = new Set(['/api/expectations','/api/source-watch','/api/news','/api/intelligence','/api/maritime','/api/oil','/api/market-context','/api/weather','/api/vessels','/api/acled','/api/acled/events','/api/config','/api/diagnostics']);
const disabledAcled = {
  configured: false,
  snapshot: () => ({connection:'not configured',recordCount:0,access:'Account-backed conflict data is available only in the local workspace.'}),
  async check(){return this.snapshot();},
  async events(){return {...this.snapshot(),events:[],countries:[]};},
};

// Hosts supply persistence, streaming transport and secrets. Public responses
// use an explicit config allowlist, never the host's environment object.
export function createDataService({runtime,reportArchive,acled=disabledAcled,settings={},ais,version,collection={}}) {
if(settings.hosted)acled=disabledAcled;
const config={reliefweb:!!settings.reliefwebAppname,aisstream:!!settings.aisstream,eia:!!settings.eiaApiKey,get acled(){return !!acled.configured;},version,hosted:!!settings.hosted};
const newest=items=>items.map(x=>x.publishedAt).filter(x=>typeof x==='string'&&Number.isFinite(Date.parse(x))).sort().at(-1)||null;
const metadata=id=>SOURCE_DEFINITIONS.find(s=>s.id===id);
function health(id,data={}){const def=metadata(id);data={...data};if(id==='acled')delete data.countries;if(def.group==='news'&&data.items){data.recordCount=data.items.length;data.latestRelevant=newest(data.items);}if(data.observations){data.recordCount=data.observations.length;data.latest=data.observations.at(-1)?.date||null;}if(data.models)data.recordCount=data.models.length;for(const field of ['items','observations','models','events','vessels','countries','markets','notes','coverage'])delete data[field];return sourceHealth({...def,...data,name:def.name,configured:def.optional?config[def.optional]:true,connection:data.connection||'loading'});}
async function news(context) {
  const data=await loadReporting(runtime,{...config,reportArchive,reliefwebAppname:settings.reliefwebAppname,includeReviewedContext:!settings.hosted},context);
  return {...data,coverage:{...data.coverage,collection:(typeof collection==='function'?collection():collection)}};
}
async function expectations(context){const data=await loadExpectations(runtime,context);return {...data,markets:data.markets||[],source:health('polymarket',data)};}
async function sourceWatch(context){const data=await loadSourceWatch(runtime,context);return {...data,items:data.items||[],source:health('hormuz-letter',data)};}
async function conflictEvents(context,days=365) {
  const end=new Date().toISOString().slice(0,10),from=new Date(Date.now()-days*86400000).toISOString().slice(0,10);
  const result=await acled.events({from,to:end,limit:500,context});
  const {events,...meta}=result;
  return {configured:acled.configured,source:health('acled',{...meta,latest:events?.map(e=>e.eventDate).sort().at(-1)||null,recordCount:events?.length||0}),events:events||[],countries:result.countries||[],from,to:end,truncated:!!result.truncated};
}
async function intelligence(context) {
  const [reporting,incidents,prices,conflict]=await Promise.all([news(context),maritime(context),oil(context),conflictEvents(context).catch(error=>({events:[],source:health('acled',{connection:'unavailable',recordCount:0,error:error instanceof SourceError?error.message:'Structured event update failed.'})}))]);
  return buildIntelligence({news:reporting,maritime:incidents,oil:prices,acled:conflict,includeReviewedContext:!settings.hosted});
}
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
  return {events:results.flatMap(r=>r.events),sources:results.map(r=>r.source),generatedAt:new Date().toISOString()};
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
  return {series,unit:'USD per barrel',basis:'Daily spot prices',source:'U.S. Energy Information Administration'};
}
async function weather(context){
  const query='latitude=12.58,26.57&longitude=43.33,56.25&timezone=GMT&forecast_days=3&cell_selection=sea';
  const modelLoader=async(remote,url,kind)=>{const models=normalizeWeather(JSON.parse(await remote(url)),kind);return {models,recordCount:models.length,modelRunAt:null,gridSelection:'sea',validThrough:models.map(m=>m.validThrough).sort().at(0)};};
  const [marine,wind]=await Promise.all([
    runtime.get('marine',1800,({fetchText:remote})=>modelLoader(remote,`https://marine-api.open-meteo.com/v1/marine?${query}&hourly=wave_height,wave_period,sea_surface_temperature`,'marine'),context,'marine-validated'),
    runtime.get('wind',1800,({fetchText:remote})=>modelLoader(remote,`https://api.open-meteo.com/v1/forecast?${query}&current=temperature_2m,wind_speed_10m,wind_direction_10m&hourly=wind_speed_10m`,'wind'),context,'wind-validated')
  ]);
  return {theaters:THEATERS.map((t,i)=>({...t,marine:marine.models?.[i]||null,wind:wind.models?.[i]||null})),sources:[['marine',marine],['wind',wind]].map(([id,{models,...s}])=>health(id,{...s,recordCount:models?.length||0}))};
}
async function openWaters(context){
  const data=await runtime.get('openwaters',10,async({fetchText:remote})=>{
    const payload=JSON.parse(await remote(OPENWATERS_URL)),vessels=parseOpenWaters(payload,Date.now());
    return {vessels,recordCount:vessels.length,latest:vessels.map(v=>v.sourceAt).filter(Boolean).sort().at(-1)||null,access:'Anonymous GeoJSON snapshot',observationBasis:'Received AIS positions; source and station metadata retained'};
  },context,'openwaters-vessels');
  return {vessels:data.vessels||[],source:health('openwaters',{...data,recordCount:data.vessels?.length||0,latest:data.latest||null})};
}
function mergeVessels(aisData,openData){
  const records=[...(openData.vessels||[]),...(aisData.vessels||[]).map(v=>({...v,provider:'AISStream',providerSource:'AISStream'}))];
  const vessels=mergeVesselPositions(records);
  const validOpen=(openData.vessels||[]).filter(v=>isCurrentVesselPosition(v));
  return {...aisData,vessels,fallback:health('openwaters',{...openData.source,recordCount:validOpen.length,latest:validOpen.map(v=>v.sourceAt).filter(Boolean).sort().at(-1)||null})};
}
function diagnosticSnapshot(){
  const discovery=new Map(discoverySnapshot(runtime).map(s=>[s.id,s]));
  const sources=SOURCE_DEFINITIONS.map(s=>s.id==='aisstream'?health(s.id,ais.snapshot({touch:false}).source):s.id==='acled'?health(s.id,acled.snapshot()):health(s.id,discovery.get(s.id)||runtime.peek(s.id)));
  const enabled=sources.filter(s=>s.configured);return {...runtime.snapshot(),version,readiness:enabled.some(s=>s.attention)?'degraded':enabled.some(s=>s.status==='loading')?'checking':'available',sources:sources.map(diagnosticSource),ais:ais.diagnostics()};
}

async function collect(context={}) {
  // The runtime coalesces in-flight requests and enforces each provider's TTL
  // and retry deadline across both visitors and scheduled collection.
  await Promise.all([
    news(context),maritime(context),oil(context),weather(context),openWaters(context),expectations(context),sourceWatch(context),
    loadMarketContext(runtime,{apiKey:settings.eiaApiKey,health,context}),
  ]);
  await waitForDiscovery(runtime);
  // Merge the discovery results that arrived after the interactive wait window.
  const reporting=await news(context);
  await waitForDiscovery(runtime);
  return {completedAt:new Date(runtime.now()).toISOString(),reports:reporting.items.length,diagnostics:diagnosticSnapshot()};
}

async function get(pathname,searchParams=new URLSearchParams(),context={}) {
let data;
      if(pathname==='/api/news')data=await news(context);
      else if(pathname==='/api/intelligence')data=await intelligence(context);
      else if(pathname==='/api/maritime')data=await maritime(context);
      else if(pathname==='/api/expectations')data=await expectations(context);
      else if(pathname==='/api/source-watch')data=await sourceWatch(context);
      else if(pathname==='/api/oil')data=await oil(context);
      else if(pathname==='/api/market-context')data=await loadMarketContext(runtime,{apiKey:settings.eiaApiKey,health,context});
      else if(pathname==='/api/weather')data=await weather(context);
      else if(pathname==='/api/vessels'){const [aisData,openData]=await Promise.all([Promise.resolve(ais.snapshot({context})),openWaters(context)]);data=mergeVessels(aisData,openData);}
      else if(pathname==='/api/acled'){const sample=await acled.check(context);const {countries,...meta}=sample;data={configured:acled.configured,source:health('acled',meta),countries:countries||[]};}
      else if(pathname==='/api/acled/events'){
        const days=[30,90,180,365,730].includes(Number(searchParams.get('days')))?Number(searchParams.get('days')):365;
        data=await conflictEvents(context,days);
      }
      else if(pathname==='/api/config')data=config;
      else if(pathname==='/api/diagnostics')data=diagnosticSnapshot();
      else return null;
      return data;
}
return {get,news,expectations,sourceWatch,collect,diagnostics:diagnosticSnapshot,health,config};
}
