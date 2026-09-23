import {mkdir,readFile,writeFile,rename,rm,chmod} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {SourceError,retryAfter} from './source-runtime.mjs';

const TOKEN_URL='https://acleddata.com/oauth/token';
const DATA_URL='https://acleddata.com/api/acled/read';
// Event pages include notes and up to 500 rows; authentication and the small
// account check keep their original 300 KB bound. Both bounds apply in-stream.
const EVENT_RESPONSE_MAX_BYTES=4000000;
const FIELDS=['event_id_cnty','event_date','country','event_type','sub_event_type','actor1','actor2','civilian_targeting','time_precision','source'];
const EVENT_FIELDS=['event_id_cnty','event_date','country','admin1','admin2','location','latitude','longitude','geo_precision','time_precision','event_type','sub_event_type','actor1','actor2','assoc_actor_1','assoc_actor_2','civilian_targeting','source','notes','fatalities','timestamp'];
const iso=ms=>new Date(ms).toISOString();
const safeText=v=>typeof v==='string'?v.slice(0,1000):'';
const dateOnly=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(Date.parse(value+'T00:00:00Z')).toISOString().slice(0,10)===value?value:null;

// Deliberately a bounded access sample, not a complete incident dataset or a
// guarantee of the newest available event. No undocumented sort parameter.
// https://acleddata.com/api-documentation/acled-endpoint
// https://acleddata.com/api-documentation/elements-acleds-api
export function parseAcledSample(payload,country,now=Date.now()){
  if(payload?.success!==true||!Array.isArray(payload.data)||payload.data.length>5)throw new SourceError('schema');
  const records=payload.data.map(row=>{
    const date=row.event_date;
    if(!row.event_id_cnty||row.country!==country||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||iso(Date.parse(date)).slice(0,10)!==date||date>iso(now).slice(0,10))throw new SourceError('schema');
    return Object.fromEntries(FIELDS.map(key=>[key,key==='time_precision'?[1,2,3].includes(Number(row[key]))?Number(row[key]):null:safeText(row[key])]));
  });
  return {country,records,recordCount:records.length,newestSampleEventDate:records.map(r=>r.event_date).sort().at(-1)||null};
}

function actorLabels(row){
  const text=[row.actor1,row.actor2,row.assoc_actor_1,row.assoc_actor_2].filter(Boolean).join(' ');
  const labels=[];
  if(/houth|ansar.?allah/i.test(text))labels.push('Houthis');
  if(/iran|tehran/i.test(text))labels.push('Iran');
  if(/irgc|islamic revolutionary|revolutionary guard/i.test(text))labels.push('IRGC');
  if(/united states|u\.s\.|american|centcom|navy|military forces of the united states/i.test(text))labels.push('U.S. military');
  if(/saudi|aramco|east-west pipeline|yanbu/i.test(text))labels.push('Saudi Arabia');
  if(/uae|united arab emirates|emirati|fujairah/i.test(text))labels.push('UAE');
  if(/oman|omani|duqm/i.test(text))labels.push('Oman');
  if(/israel/i.test(text))labels.push('Israel');
  if(/merchant|commercial|cargo|tanker|vessel|seafarer|mariner|crew/i.test(text))labels.push('Merchant shipping');
  if(/civilian/i.test(text)||row.civilian_targeting)labels.push('Civilians');
  if(!labels.length&&text)labels.push('Other forces');
  return [...new Set(labels)];
}

// ACLED publishes event date and location precision separately from its upload
// timestamp. A country-scoped record is contextual evidence, not a maritime
// incident geocode. See the documented returned columns:
// https://acleddata.com/api-documentation/acled-endpoint
export function parseAcledEvents(payload,country,now=Date.now()){
  if(payload?.success!==true||!Array.isArray(payload.data)||payload.data.length>5000)throw new SourceError('schema');
  const events=[];
  for(const row of payload.data){
    const eventId=safeText(row.event_id_cnty,80),eventDate=safeText(row.event_date,20);
    if(!eventId||row.country!==country||!dateOnly(eventDate)||Date.parse(eventDate+'T00:00:00Z')>now)throw new SourceError('schema');
    const latitude=row.latitude===''||row.latitude==null?null:Number(row.latitude),longitude=row.longitude===''||row.longitude==null?null:Number(row.longitude);
    if(latitude!==null&&(!Number.isFinite(latitude)||Math.abs(latitude)>90)||longitude!==null&&(!Number.isFinite(longitude)||Math.abs(longitude)>180))throw new SourceError('schema');
    const precision=row.geo_precision===''||row.geo_precision==null?null:Number(row.geo_precision),timePrecision=row.time_precision===''||row.time_precision==null?null:Number(row.time_precision);
    if(precision!==null&&!([1,2,3].includes(precision))||timePrecision!==null&&!([1,2,3].includes(timePrecision)))throw new SourceError('schema');
    const updated=Number(row.timestamp);events.push({
      id:'acled-'+eventId,recordId:eventId,recordType:'acled-event',title:`${safeText(row.sub_event_type||row.event_type,120)||'Recorded event'} · ${country}`,
      url:`https://acleddata.com/api/acled/read?event_id_cnty=${encodeURIComponent(eventId)}`,sourceUrl:'https://acleddata.com/api-documentation/acled-endpoint',source:'ACLED',sourceId:'acled',type:'Structured event',
      country,eventDate,publishedAt:eventDate+'T00:00:00.000Z',publishedAtBasis:'event_date',updatedAt:Number.isFinite(updated)&&updated>0?new Date(updated*1000).toISOString():null,
      theaters:[country==='Yemen'?'bab':'hormuz'],theaterBasis:'country scope · not maritime geocoding',actors:actorLabels(row),actor1:safeText(row.actor1,240),actor2:safeText(row.actor2,240),
      eventType:safeText(row.event_type,120),subEventType:safeText(row.sub_event_type,120),civilianTargeting:safeText(row.civilian_targeting,120),
      location:safeText(row.location,180),admin1:safeText(row.admin1,180),admin2:safeText(row.admin2,180),latitude,longitude,geoPrecision:precision,timePrecision,
      sourceDetail:safeText(row.source,500),notes:safeText(row.notes,2000),fatalities:row.fatalities===''||row.fatalities==null?null:Number.isFinite(Number(row.fatalities))?Number(row.fatalities):null,
    });
  }
  return events;
}

export class AcledConnection{
  constructor({root,runtime,fetchImpl=fetch,now=Date.now}){
    this.runtime=runtime;this.fetch=fetchImpl;this.now=now;
    this.dir=path.join(root,'.private');this.file=path.join(this.dir,'acled-session.json');
    this.cache=path.join(root,'.cache','acled.json');this.tokens=null;this.tail=Promise.resolve();this.cooldownUntil=0;
    this.eventsCache=null;this.eventsState=null;
  }
  async initialize(){
    try{const saved=JSON.parse(await readFile(this.file,'utf8'));if(!this.validTokens(saved))throw Error();this.tokens=saved;}
    catch(e){if(e.code!=='ENOENT')this.storageIssue=true;}
  }
  validTokens(t){return typeof t?.accessToken==='string'&&!!t.accessToken&&typeof t.refreshToken==='string'&&!!t.refreshToken&&Number.isFinite(t.expiresAt);}
  get configured(){return !!this.tokens;}
  snapshot(){
    const state=this.eventsState||this.runtime.peek('acled')||{connection:this.configured?'loading':'not configured',recordCount:0};
    // Diagnostics describe the latest event query without exposing its records
    // or confusing a successful account sample with structured-event delivery.
    const fields=['connection','recordCount','checkedAt','retrievedAt','lastSuccessAt','latest','error','errorCategory','httpStatus','sampleOnly','from','to','truncated','nextRetryAt'];
    return Object.fromEntries(fields.filter(key=>Object.hasOwn(state,key)).map(key=>[key,state[key]]));
  }
  exclusive(fn){const result=this.tail.then(fn);this.tail=result.catch(()=>{});return result;}
  async request(url,options,context,maxBytes=300000){
    const start=this.now(),operationId=randomUUID(),ctx={...context,operationId};
    this.runtime.event('source_started','acled',ctx);
    try{
      const response=await this.fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json','X-Request-ID':operationId,...options?.headers}});
      if(!response.ok){await response.body?.cancel();throw new SourceError([401,403].includes(response.status)||url===TOKEN_URL&&response.status===400?'auth':response.status===429?'rate_limit':'upstream_http',{status:response.status,retryAfterMs:retryAfter(response.headers.get('retry-after'),this.now())});}
      const reader=response.body?.getReader();if(!reader)throw new SourceError('schema');
      let size=0,text='';const decoder=new TextDecoder();
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new SourceError('schema');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
      let data;try{data=JSON.parse(text);}catch{throw new SourceError('schema');}
      this.runtime.event('source_finished','acled',ctx,{outcome:'success',durationMs:this.now()-start,httpStatus:response.status});return data;
    }catch(error){const safe=error instanceof SourceError?error:new SourceError(['TimeoutError','AbortError'].includes(error?.name)?'timeout':'network');this.runtime.event('source_finished','acled',ctx,{outcome:'failure',durationMs:this.now()-start,category:safe.category,httpStatus:safe.status});throw safe;}
  }
  // ACLED's documented OAuth password grant; only returned tokens are saved.
  // https://acleddata.com/api-documentation/getting-started
  async exchange(fields,context){
    const data=await this.request(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:'acled',...fields})},context);
    const tokens={accessToken:data.access_token,refreshToken:data.refresh_token,expiresAt:this.now()+Number(data.expires_in)*1000};
    if(!this.validTokens(tokens)||Number(data.expires_in)<=0||Number(data.expires_in)>86400*30)throw new SourceError('schema');return tokens;
  }
  async save(tokens){
    // Private files are outside the static directory and ignored by Git.
    // https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromiseswritefilefile-data-options
    const temp=path.join(this.dir,randomUUID()+'.tmp');
    try{await mkdir(this.dir,{recursive:true,mode:0o700});await chmod(this.dir,0o700);await writeFile(temp,JSON.stringify(tokens),{mode:0o600,flag:'wx'});await rename(temp,this.file);this.tokens=tokens;this.storageIssue=false;}
    catch{await rm(temp,{force:true}).catch(()=>{});throw new SourceError('cache_io');}
  }
  async authorized(read,context){
    let refreshed=false;
    if(this.tokens.expiresAt<=this.now()+60000){await this.save(await this.exchange({grant_type:'refresh_token',refresh_token:this.tokens.refreshToken},context));refreshed=true;}
    try{return await read();}catch(error){
      if(error.category!=='auth'||error.status!==401||refreshed)throw error;
      await this.save(await this.exchange({grant_type:'refresh_token',refresh_token:this.tokens.refreshToken},context));
      return read();
    }
  }
  async sample(tokens,context){
    const countries=[];
    // Small account check, with an explicit date range so a delayed Research
    // account can still demonstrate access. These samples never feed map/counts.
    for(const country of ['Yemen','Iran']){
      const url=new URL(DATA_URL);url.search=new URLSearchParams({country,limit:'5',fields:FIELDS.join('|'),event_date:iso(this.now()-730*86400000).slice(0,10)+'|'+iso(this.now()).slice(0,10),event_date_where:'BETWEEN'});
      countries.push(parseAcledSample(await this.request(url.href,{headers:{Authorization:'Bearer '+tokens.accessToken}},context),country,this.now()));
    }
    return {countries,recordCount:countries.reduce((n,c)=>n+c.recordCount,0),sampleOnly:true,windowDays:730,access:'Account sample · up to 5 records per country',newestSampleEventDate:countries.map(c=>c.newestSampleEventDate).filter(Boolean).sort().at(-1)||null};
  }
  async events({from,to,limit=500,context={}}={}){
    return this.exclusive(async()=>{
      if(!this.tokens)return {connection:'not configured',events:[],countries:[],recordCount:0,truncated:false,from,to};
      const today=iso(this.now()).slice(0,10),end=dateOnly(to)||today,start=dateOnly(from)||iso(this.now()-730*86400000).slice(0,10),max=Math.max(1,Math.min(1000,Number(limit)||500));
      const matchingCache=this.eventsCache?.from===start&&this.eventsCache?.to===end&&this.eventsCache?.limit===max?this.eventsCache:null;
      if(matchingCache&&Date.parse(matchingCache.retrievedAt)>this.now()-900000){this.eventsState=matchingCache;return matchingCache;}
      try{
        const result=await this.authorized(async()=>{
        const countries=[];let truncated=false,totalCount=0;
        for(const country of ['Yemen','Iran']){
          const records=[];let cursor='0',seen=new Set(),countryTotal=0;
          for(let page=0;page<4&&records.length<max;page++){
            const url=new URL(DATA_URL);url.search=new URLSearchParams({country,limit:String(Math.min(500,max-records.length)),fields:EVENT_FIELDS.join('|'),event_date:start+'|'+end,event_date_where:'BETWEEN',with_total:'true',cursor});
            const payload=await this.request(url.href,{headers:{Authorization:'Bearer '+this.tokens.accessToken}},context,EVENT_RESPONSE_MAX_BYTES);
            const parsed=parseAcledEvents(payload,country,this.now());records.push(...parsed);
            const reportedTotal=Number(payload.total_count);if(Number.isSafeInteger(reportedTotal)&&reportedTotal>=0)countryTotal=Math.max(countryTotal,reportedTotal);
            const next=payload.next_cursor==null?null:String(payload.next_cursor);if(!next||seen.has(next)||parsed.length===0){cursor=null;break;}seen.add(next);cursor=next;
          }
          totalCount+=countryTotal||records.length;
          if(cursor)truncated=true;countries.push({country,events:records.slice(0,max),recordCount:records.length,newestEventDate:records.map(record=>record.eventDate).sort().at(-1)||null,truncated:!!cursor});
        }
        const events=countries.flatMap(c=>c.events).sort((a,b)=>a.eventDate.localeCompare(b.eventDate)||a.recordId.localeCompare(b.recordId));
        return {connection:'connected',events,countries,recordCount:events.length,totalCount:totalCount||events.length,truncated,from:start,to:end,limit:max,checkedAt:iso(this.now()),retrievedAt:iso(this.now()),latest:events.map(event=>event.eventDate).sort().at(-1)||null,sampleOnly:false,coverageBasis:'Country/date filtered ACLED records; theatre labels are contextual country scopes.'};
        },context);
        this.eventsState=this.eventsCache=result;return result;
      }catch(error){
        const safe=error instanceof SourceError?error:new SourceError('schema');
        this.eventsState={...(matchingCache||{recordCount:0,retrievedAt:null,latest:null,from:start,to:end,sampleOnly:false}),connection:matchingCache?'cached':'unavailable',error:safe.message,errorCategory:safe.category,httpStatus:safe.status,checkedAt:iso(this.now())};
        if(matchingCache)return this.eventsState;
        throw safe;
      }
    });
  }
  async clearSample(){this.runtime.memory.delete('acled');this.eventsCache=null;this.eventsState=null;await rm(this.cache,{force:true});}
  connect(email,password,context={}){return this.exclusive(async()=>{
    if(typeof email!=='string'||email.length>320||!email.includes('@')||typeof password!=='string'||!password.length||password.length>4096)throw new SourceError('auth');
    if(this.now()<this.cooldownUntil)throw new SourceError('rate_limit',{retryAfterMs:this.cooldownUntil-this.now()});
    this.cooldownUntil=this.now()+15000;
    try{
      const tokens=await this.exchange({grant_type:'password',scope:'authenticated',username:email.trim(),password},context);
      const sample=await this.sample(tokens,context);
      await this.clearSample();await this.save(tokens);
      return await this.runtime.get('acled',3600,async()=>sample,context);
    }catch(error){if(error.retryAfterMs)this.cooldownUntil=Math.max(this.cooldownUntil,this.now()+error.retryAfterMs);throw error;}
  });}
  check(context={}){return this.exclusive(async()=>{
    if(!this.tokens)return {id:'acled',connection:'not configured',recordCount:0,countries:[],storageIssue:!!this.storageIssue};
    return this.runtime.get('acled',3600,()=>this.authorized(()=>this.sample(this.tokens,context),context),context);
  });}
  disconnect(){return this.exclusive(async()=>{try{await rm(this.file,{force:true});await this.clearSample();this.tokens=null;this.storageIssue=false;return {disconnected:true};}catch{throw new SourceError('cache_io');}});}
}

// Mutating local routes require the page's exact Origin and JSON. A hostile
// website cannot submit credentials or remove this connection with a form.
// https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin
export function isLocalMutation(req,port){return ['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)&&req.headers.origin===`http://${req.headers.host}`&&req.headers['content-type']?.split(';')[0].trim()==='application/json';}
export async function readLocalJson(req){let size=0,body='';for await(const chunk of req){size+=chunk.length;if(size>8192)throw Error('body_limit');body+=chunk;}return JSON.parse(body);}
