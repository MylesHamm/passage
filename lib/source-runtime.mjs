import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {SOURCE_DEFINITIONS} from '../dist/source-health.mjs';
const IDS=new Set(SOURCE_DEFINITIONS.map(s=>s.id));
const CATEGORIES=['timeout','network','auth','rate_limit','upstream_http','schema','cache_io'];
const MESSAGES={timeout:'Source timed out.',network:'Source connection failed.',auth:'Source rejected access. Check local configuration.',rate_limit:'Source rate limit reached. Waiting before retry.',upstream_http:'Source returned an unsuccessful HTTP response.',schema:'Source returned data in an unexpected format.',cache_io:'Local cache could not be read or saved.'};
const BOUNDS=[100,250,500,1000,2500,5000,10000,30000];
const iso=ms=>new Date(ms).toISOString();
export class SourceError extends Error {
  constructor(category,{status=null,retryAfterMs=null}={}) { const safe=CATEGORIES.includes(category)?category:'schema';super(MESSAGES[safe]);this.name='SourceError';this.category=safe;this.status=Number.isInteger(status)&&status>=100&&status<=599?status:null;this.retryAfterMs=Number.isFinite(retryAfterMs)&&retryAfterMs>=0?retryAfterMs:null; }
}
// RFC 9110 Retry-After supports a delay in seconds or an HTTP date.
// https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after
export function retryAfter(value,now=Date.now()) {
  if(typeof value!=='string'||!value.trim())return null;
  const ms=/^\d+$/.test(value.trim())?Number(value)*1000:Date.parse(value)-now;
  return Number.isFinite(ms)&&ms>=0&&now+ms<=8640000000000000?ms:null;
}
// Node 24 timeout signal: https://nodejs.org/docs/latest-v24.x/api/globals.html#static-method-abortsignaltimeoutdelay
export async function fetchText(url,{fetchImpl=fetch,timeoutMs=28000,operationId,now=Date.now,maxBytes=6000000}={}) {
  let response;
  try {
    response=await fetchImpl(url,{signal:AbortSignal.timeout(timeoutMs),headers:{'User-Agent':'PassageLocal/0.3 (public-source research dashboard)','Accept':'application/json, application/rss+xml, text/html, */*',...(operationId?{'X-Request-ID':operationId}:{})}});
    if(!response.ok){const category=[401,403].includes(response.status)?'auth':response.status===429?'rate_limit':'upstream_http';await response.body?.cancel();throw new SourceError(category,{status:response.status,retryAfterMs:retryAfter(response.headers.get('retry-after'),now())});}
    // Enforce the bound while reading; never retain an unbounded provider payload.
    const reader=response.body?.getReader();if(!reader)return '';
    const decoder=new TextDecoder();let size=0,text='';
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new SourceError('schema');}text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}finally{reader.releaseLock();}
  } catch(error) {if(error instanceof SourceError)throw error;throw new SourceError(error?.name==='TimeoutError'||error?.name==='AbortError'?'timeout':'network');}
}
function metric(){return {attempts:0,successes:0,failures:0,cacheHits:0,coalesced:0,cacheErrors:0,recordsAccepted:0,outcomes:Object.fromEntries(CATEGORIES.map(c=>[c,0])),duration:{boundsMs:BOUNDS,bucketCounts:BOUNDS.map(()=>0),aboveMax:0,count:0},lastSuccessAt:null};}
export class SourceRuntime {
  constructor({cacheDir,now=Date.now,fetchImpl=fetch,storage={readFile,writeFile,mkdir,rename,rm},log=()=>{},historyLimit=200}={}) {
    this.cacheDir=cacheDir;this.now=now;this.fetchImpl=fetchImpl;this.storage=storage;this.log=log;this.limit=Math.min(500,Math.max(1,historyLimit));
    this.memory=new Map();this.pending=new Map();this.restores=new Map();this.events=[];this.metrics=new Map();this.requestMetrics=new Map();this.startedAt=iso(now());
  }
  counters(id){if(!IDS.has(id))throw new Error('Unknown source ID');if(!this.metrics.has(id))this.metrics.set(id,metric());return this.metrics.get(id);}
  event(event,id,ctx={},fields={}) {
    // Fixed events + allowlisted fields: never copy request URLs, error messages or payloads.
    if(!['source_started','source_finished','source_joined','cache_hit','cache_failed','request_finished','ais_state'].includes(event))return;
    const value={at:iso(this.now()),event,sourceId:IDS.has(id)?id:undefined,entryPoint:['news','intelligence','maritime','oil','market-context','weather','vessels','diagnostics','health','config','acled','acled-connect','acled-disconnect'].includes(ctx.entryPoint)?ctx.entryPoint:'background',requestId:/^[a-f\d-]{36}$/.test(ctx.requestId||'')?ctx.requestId:undefined,operationId:/^[a-f\d-]{36}$/.test(ctx.operationId||'')?ctx.operationId:undefined};
    for(const key of ['durationMs','httpStatus','accepted','count'])if(Number.isFinite(fields[key]))value[key]=Math.max(0,Math.round(fields[key]));
    if(CATEGORIES.includes(fields.category))value.category=fields.category;
    if(['success','failure','connected','disconnected','idle','connecting','heartbeat_timeout'].includes(fields.outcome))value.outcome=fields.outcome;
    if(event==='request_finished'){const key=value.entryPoint;if(!this.requestMetrics.has(key))this.requestMetrics.set(key,{count:0,errors:0,boundsMs:BOUNDS,bucketCounts:BOUNDS.map(()=>0),aboveMax:0});const m=this.requestMetrics.get(key);m.count++;if(value.httpStatus>=400)m.errors++;const i=BOUNDS.findIndex(b=>value.durationMs<=b);if(i<0)m.aboveMax++;else m.bucketCounts[i]++;}
    this.events.push(value);if(this.events.length>this.limit)this.events.shift();
    try{this.log(value);}catch{/* Observability must not interrupt data delivery. */}
  }
  async get(id,interval,loader,ctx={},cacheKey=id,retryPolicy={}) {
    const counters=this.counters(id);
    if(!/^[a-z0-9-]+$/.test(cacheKey))throw new Error('Invalid cache key');
    if(this.pending.has(id)){const p=this.pending.get(id);counters.coalesced++;this.event('source_joined',id,{...ctx,operationId:p.operationId});return p.promise;}
    const operationId=randomUUID(),operation={...ctx,operationId};
    const promise=this.load(id,cacheKey,interval,loader,operation,counters,retryPolicy);
    this.pending.set(id,{promise,operationId});
    try{return await promise;}finally{this.pending.delete(id);}
  }
  async restore(id,cacheKey=id,ctx={}) {
    const counters=this.counters(id);
    if(!/^[a-z0-9-]+$/.test(cacheKey))throw new Error('Invalid cache key');
    if(this.memory.has(id))return {value:this.memory.get(id),cacheIssue:null};
    if(!this.restores.has(id))this.restores.set(id,(async()=>{
      try {
        const saved=JSON.parse(await this.storage.readFile(path.join(this.cacheDir,cacheKey+'.json'),'utf8'));
        const hasSuccess=Number.isFinite(Date.parse(saved?.retrievedAt));
        const hasFailure=CATEGORIES.includes(saved?.errorCategory)&&Number.isFinite(Date.parse(saved?.checkedAt))&&Number.isFinite(Date.parse(saved?.nextRetryAt));
        if(!saved||typeof saved!=='object'||!hasSuccess&&!hasFailure)throw new Error('Invalid cache');
        counters.lastSuccessAt=hasSuccess?saved.retrievedAt:null;this.memory.set(id,saved);
        return {value:saved,cacheIssue:null};
      } catch(error) {
        if(error.code!=='ENOENT'){counters.cacheErrors++;this.event('cache_failed',id,ctx,{category:'cache_io'});return {value:undefined,cacheIssue:MESSAGES.cache_io};}
        return {value:undefined,cacheIssue:null};
      }
    })());
    return this.restores.get(id);
  }
  async persist(id,cacheKey,value,ctx,counters){
    let temporary;
    try{
      await this.storage.mkdir(this.cacheDir,{recursive:true});
      const target=path.join(this.cacheDir,cacheKey+'.json'),serialized=JSON.stringify({...value,cacheIssue:null});
      if(this.storage.rename){temporary=target+'.'+randomUUID()+'.tmp';await this.storage.writeFile(temporary,serialized,{flag:'wx'});await this.storage.rename(temporary,target);temporary=null;}
      else await this.storage.writeFile(target,serialized);
      value.cacheIssue=null;
    }
    catch{value.cacheIssue=MESSAGES.cache_io;counters.cacheErrors++;this.event('cache_failed',id,ctx,{category:'cache_io'});}
    finally{if(temporary&&this.storage.rm)await this.storage.rm(temporary,{force:true}).catch(()=>{});}
  }
  async load(id,cacheKey,interval,loader,ctx,counters,retryPolicy={}) {
    const restored=await this.restore(id,cacheKey,ctx),old=this.memory.get(id)||restored.value,cacheIssue=restored.cacheIssue;
    const eligible=old?.nextRetryAt?Date.parse(old.nextRetryAt):Date.parse(old?.checkedAt)+(old?.error?60:interval)*1000;
    if(old&&Number.isFinite(eligible)&&this.now()<eligible){counters.cacheHits++;this.event('cache_hit',id,ctx);return old;}
    const start=this.now();counters.attempts++;this.event('source_started',id,ctx);
    try {
      const data=await loader({operationId:ctx.operationId,fetchText:url=>fetchText(url,{fetchImpl:this.fetchImpl,operationId:ctx.operationId,now:this.now})});
      if(!data||typeof data!=='object')throw new SourceError('schema');
      const stamp=iso(this.now());const value={...data,id,checkedAt:stamp,retrievedAt:stamp,lastSuccessAt:stamp,nextRetryAt:iso(this.now()+interval*1000),connection:'connected',error:null,errorCategory:null,httpStatus:null,consecutiveFailures:0,operationId:ctx.operationId,cacheIssue};
      counters.successes++;counters.lastSuccessAt=stamp;counters.recordsAccepted+=Math.max(0,data.recordCount||0);
      this.memory.set(id,value);
      await this.persist(id,cacheKey,value,ctx,counters);
      this.finish(id,counters,start,ctx,{outcome:'success',accepted:data.recordCount||0});return value;
    } catch(error) {
      const safe=error instanceof SourceError?error:new SourceError('schema');counters.failures++;counters.outcomes[safe.category]++;
      const consecutiveFailures=Math.min(32,(Number.isInteger(old?.consecutiveFailures)?Math.max(0,old.consecutiveFailures):0)+1);
      const base=Math.max(60000,Math.min(3600000,Number(retryPolicy.retryBaseMs)||60000));
      const cap=Math.max(base,Math.min(86400000,Number(retryPolicy.retryMaxMs)||900000));
      // Local exponential backoff never shortens the provider's Retry-After.
      const delay=Math.max(Math.min(cap,base*2**(consecutiveFailures-1)),safe.retryAfterMs||0);
      const value={...(old||{}),id,checkedAt:iso(this.now()),nextRetryAt:iso(this.now()+delay),connection:old?.retrievedAt?'cached':'unavailable',error:safe.message,errorCategory:safe.category,httpStatus:safe.status,consecutiveFailures,operationId:ctx.operationId,cacheIssue:cacheIssue||old?.cacheIssue||null};
      this.memory.set(id,value);await this.persist(id,cacheKey,value,ctx,counters);this.finish(id,counters,start,ctx,{outcome:'failure',category:safe.category,httpStatus:safe.status});return value;
    }
  }
  finish(id,counters,start,ctx,fields){const durationMs=Math.max(0,this.now()-start),hist=counters.duration;hist.count++;const bucket=BOUNDS.findIndex(b=>durationMs<=b);if(bucket<0)hist.aboveMax++;else hist.bucketCounts[bucket]++;this.event('source_finished',id,ctx,{...fields,durationMs});}
  peek(id){return this.memory.get(id);}
  snapshot(){return {startedAt:this.startedAt,generatedAt:iso(this.now()),retention:`Last ${this.limit} events in memory; counters reset on restart.`,requests:[...this.requestMetrics].map(([entryPoint,m])=>({entryPoint,...structuredClone(m)})),metrics:[...this.metrics].map(([id,m])=>({id,...structuredClone(m),lastSuccessAgeSeconds:m.lastSuccessAt?Math.max(0,Math.floor((this.now()-Date.parse(m.lastSuccessAt))/1000)):null})),events:structuredClone(this.events)};}
}
