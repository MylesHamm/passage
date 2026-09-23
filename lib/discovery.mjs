import {createHash} from 'node:crypto';
import {classifyReport,plain,safeUrl,reportRelevant} from './feeds.mjs';
import {analysisLabels} from '../dist/intelligence-data.mjs';

// Fixed, bounded DOC 2.0 discovery. These are headline/link results, not licensed
// article bodies or verified events. GDELT attribution remains in every record.
// https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
// https://www.gdeltproject.org/about.html#termsofuse
export const DISCOVERY_SOURCES=Object.freeze([
  {id:'gdelt-hormuz',name:'GDELT · Hormuz discovery',query:'(Hormuz OR "Gulf of Oman")'},
  {id:'gdelt-redsea',name:'GDELT · Red Sea discovery',query:'(Houthi OR Houthis OR "Red Sea" OR "Bab el-Mandeb" OR "Bab al-Mandab")'},
  {id:'gdelt-exports',name:'GDELT · Regional exports',query:'(Saudi OR Aramco OR Yanbu OR Fujairah OR Oman OR UAE) (oil OR crude OR pipeline OR export OR shipping OR tanker)'},
  {id:'gdelt-energy',name:'GDELT · Energy and diplomacy',query:'(Iran OR "Middle East" OR Gulf) (Brent OR WTI OR "oil prices" OR sanctions OR negotiations OR ceasefire)'},
  {id:'gdelt-reuters',name:'GDELT · Reuters topic discovery',domain:'reuters.com',query:'domainis:reuters.com (Houthi OR Houthis OR Yemen OR Hormuz OR Iran OR Saudi OR Aramco OR UAE OR Oman OR Fujairah OR "Red Sea" OR "Middle East")'},
].map(source=>Object.freeze({...source,group:'discovery',interval:900,home:'https://www.gdeltproject.org/'})));
// DOC 2.0 supports at most 250 ArtList records; this remains a bounded index.
export const DISCOVERY_LIMIT=250;
const runs=new WeakMap(),lastRequests=new WeakMap();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const elapsedNow=()=>performance.now();
const publisherNames={'reuters.com':'Reuters','apnews.com':'Associated Press','bbc.com':'BBC','bbc.co.uk':'BBC','aljazeera.com':'Al Jazeera','eia.gov':'EIA','iea.org':'IEA','spa.gov.sa':'Saudi Press Agency','centcom.mil':'CENTCOM','aol.com':'AOL','jpost.com':'The Jerusalem Post','investing.com':'Investing.com'};

export function discoveryUrl(source){
  const known=DISCOVERY_SOURCES.find(s=>s.id===source?.id);if(!known)throw Error('Unknown discovery source');
  const u=new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  for(const [key,value] of Object.entries({query:known.query,mode:'artlist',format:'json',sort:'datedesc',timespan:'7d',maxrecords:String(DISCOVERY_LIMIT)}))u.searchParams.set(key,value);
  return u;
}
function seenDate(value,now){
  if(typeof value!=='string'||!/^\d{8}T\d{6}Z$/.test(value))return null;
  const iso=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(9,11)}:${value.slice(11,13)}:${value.slice(13,15)}.000Z`;
  const ms=Date.parse(iso);return Number.isFinite(ms)&&ms<=now+60000&&new Date(ms).toISOString()===iso?iso:null;
}
function sharedDelay(runtime){
  const delayed=DISCOVERY_SOURCES.map(source=>runtime.peek(source.id)).filter(value=>
    (['rate_limit','network','timeout'].includes(value?.errorCategory)||value?.errorCategory==='upstream_http'&&value.httpStatus>=500)&&Date.parse(value.nextRetryAt)>runtime.now());
  return delayed.sort((a,b)=>Date.parse(b.nextRetryAt)-Date.parse(a.nextRetryAt))[0]||null;
}
export function parseDiscovery(payload,source,now=Date.now()){
  if(!payload||!Array.isArray(payload.articles)||payload.articles.length>DISCOVERY_LIMIT)throw Error('Unexpected discovery schema');
  const result=[];
  for(const article of payload.articles.slice(0,DISCOVERY_LIMIT)){
    if(!article||typeof article.title!=='string'||typeof article.url!=='string')continue;
    const title=plain(article.title).slice(0,500),url=safeUrl(article.url),discoveredAt=seenDate(article.seendate,now);
    if(!title||!url||!discoveredAt)continue;
    const hostname=new URL(url).hostname.replace(/^www\./,'');
    if(source.domain&&hostname!==source.domain)continue;
    const publisher=publisherNames[hostname]||hostname;
    const record={id:createHash('sha256').update(url).digest('hex').slice(0,18),title,url,summary:null,publishedAt:null,publicationPrecision:'unknown',eventDate:null,discoveredAt,dateBasis:'discovery',dateNote:'GDELT index time; publisher publication time and event time are unknown.',source:publisher,publisher,sourceId:source.id,type:'Discovered reporting',contentAccess:'discovery-metadata',discoveryProvider:'GDELT',discoveryUrl:'https://www.gdeltproject.org/',discoveryFamily:source.id,language:typeof article.language==='string'?plain(article.language).slice(0,50):null};
    Object.assign(record,analysisLabels(record));
    const tags=classifyReport(record);
    // Query matches may come from article bodies; results that cannot establish
    // relevance from the available metadata stay out of the analytical view.
    if(!reportRelevant(tags))continue;
    result.push({...record,...tags});
  }
  return [...new Map(result.map(item=>[item.url,item])).values()];
}
function schedule(runtime,context,spacingMs,monotonicNow,sleep){
  if(runs.has(runtime))return runs.get(runtime);
  const work=(async()=>{
    // A provider outage may stop a cycle after one family. Give never-checked
    // and least-recently attempted families the next turn, including failures.
    const attemptedAt=source=>{const value=Date.parse(runtime.peek(source.id)?.checkedAt);return Number.isFinite(value)?value:-Infinity;};
    const ordered=[...DISCOVERY_SOURCES].sort((a,b)=>attemptedAt(a)-attemptedAt(b));
    for(const source of ordered){
      // Check every family before the first request, including a cached outage in
      // a later family. The provider deadline can outlive an earlier cache TTL.
      if(sharedDelay(runtime))break;
      await runtime.get(source.id,source.interval,async({fetchText})=>{
        const url=discoveryUrl(source),previous=lastRequests.get(runtime);
        // Timer callbacks are not exact deadlines. Recheck elapsed time after
        // each wake; wall-clock corrections must not shorten request spacing.
        // https://nodejs.org/api/timers.html#settimeoutcallback-delay-args
        // https://developers.cloudflare.com/workers/runtime-apis/performance/
        // Persisted provider retry and observation clocks still use runtime.now().
        if(previous!==undefined){
          const deadline=previous+spacingMs;let remaining;
          while((remaining=deadline-monotonicNow())>0)await sleep(Math.ceil(remaining));
        }
        const response=fetchText(url);
        // Anchor after dispatch, so synchronous preparation cannot consume the
        // minimum interval before the previous request has actually started.
        lastRequests.set(runtime,monotonicNow());
        const payload=JSON.parse(await response),items=parseDiscovery(payload,source,runtime.now());
        return {items,recordCount:items.length,parsedCount:payload.articles.length,latest:null,latestRelevant:null,latestDiscoveredAt:items.map(x=>x.discoveredAt).sort().at(-1)||null,access:'GDELT headline/link discovery',dateBasis:'discovery',publicationPrecision:'unknown',queryFamily:source.id,windowDays:7,resultLimit:DISCOVERY_LIMIT,possiblyTruncated:payload.articles.length>=DISCOVERY_LIMIT,contentAccess:'discovery-metadata'};
      },context,source.id+'-metadata',{retryBaseMs:300000,retryMaxMs:3600000});
      // Rate limits and connection failures affect the shared endpoint, not
      // merely one keyword family. Keep every retry behind the provider deadline.
      if(sharedDelay(runtime))break;
    }
  })();
  // SourceRuntime absorbs per-source upstream errors into sanitized source state.
  // A rejected orchestration promise is retained here for the caller, not hidden.
  const settled=work.finally(()=>runs.delete(runtime));runs.set(runtime,settled);return settled;
}
export async function loadDiscovery(runtime,context={}, {waitMs=600,spacingMs=6000,monotonicNow=elapsedNow,sleep=delay}={}){
  // Restore every disk snapshot independently of network eligibility. Otherwise
  // a first-family 429 after restart prevents later cache files being read at all.
  if(typeof runtime.restore==='function')await Promise.all(DISCOVERY_SOURCES.map(source=>runtime.restore(source.id,source.id+'-metadata',context)));
  const work=schedule(runtime,context,spacingMs,monotonicNow,sleep);
  if(waitMs>0){let timer;try{await Promise.race([work,new Promise(resolve=>{timer=setTimeout(resolve,Math.min(30000,waitMs));})]);}finally{clearTimeout(timer);}}
  else await Promise.resolve();
  // Requests continue in the local process and are coalesced across visitors.
  // An empty loading snapshot is not a successfully checked empty waterway/feed.
  return discoverySnapshot(runtime);
}
export function discoverySnapshot(runtime){
  const delayed=sharedDelay(runtime);
  return DISCOVERY_SOURCES.map(source=>{
    const previous=runtime.peek(source.id),snapshot={...source,...previous,connection:previous?.connection||'loading',items:previous?.items||[]};
    // Retain metadata and its actual check/retrieval clocks. This is a delayed
    // provider update, not an empty result or another attempted source request.
    const reason=delayed?.errorCategory==='rate_limit'?'a provider rate limit':'a provider connection problem';
    return delayed?{...snapshot,connection:previous?.retrievedAt?'cached':'unavailable',delayed:true,errorCategory:delayed.errorCategory,error:`Discovery delayed by ${reason}. Previously retrieved metadata is retained until retry.`,nextRetryAt:delayed.nextRetryAt}:snapshot;
  });
}

// Scheduled collectors must await the provider queue before their execution
// context ends. Interactive requests can still return existing metadata sooner.
export async function waitForDiscovery(runtime){
  await runs.get(runtime);
}
