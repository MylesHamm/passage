import {open,mkdir,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {canonicalReportUrl,analysisLabels,analysisRecordPriority} from '../dist/intelligence-data.mjs';

const SCHEMA='passage-report-archive/v1',DAY=86400000,MAX_BYTES=10*1024*1024,MAX_ROWS=5000;
const text=(value,limit)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,limit):'';
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
function day(value){
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value))return null;
  const date=new Date(value+'T00:00:00Z');return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value?value:null;
}
function instant(value,now){
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value)||!day(value.slice(0,10)))return null;
  const ms=Date.parse(value);return Number.isFinite(ms)&&ms<=now+300000?new Date(ms).toISOString():null;
}
const strings=(value,count,length)=>Array.isArray(value)?[...new Set(value.slice(0,count).map(x=>text(x,length)).filter(Boolean))]:[];
function provenance(value,now){
  if(!object(value))return null;
  const url=canonicalReportUrl(value.url),sourceId=text(value.sourceId,100);if(!url||!sourceId)return null;
  return {sourceId,publisher:text(value.publisher||value.source,120),url,publishedAt:instant(value.publishedAt,now),discoveredAt:instant(value.discoveredAt,now),dateBasis:text(value.dateBasis,100),contentAccess:text(value.contentAccess,200)};
}
function mergeProvenance(...lists){
  const values=new Map();for(const p of lists.flat()){const key=p.sourceId+'\n'+p.url;const old=values.get(key);values.set(key,old?{...old,...p,publishedAt:p.publishedAt||old.publishedAt,discoveredAt:p.discoveredAt||old.discoveredAt}:p);}
  return [...values.values()].slice(0,16);
}
// The allowlist deliberately excludes article bodies, cookies, raw responses,
// unknown nested fields and any caller-supplied history/retention timestamps.
function normalize(value,now){
  if(!object(value))return null;
  const url=canonicalReportUrl(value.url),title=text(value.title,500),sourceId=text(value.sourceId,100);
  if(!url||!title||!sourceId||value.manual===true)return null;
  const publishedAt=instant(value.publishedAt,now),publishedDate=day(value.publishedDate||value.publicationDate);
  const own=provenance({...value,url},now),entries=Array.isArray(value.provenance)?value.provenance.slice(0,16).map(p=>provenance(p,now)).filter(Boolean):[];
  return {id:text(value.id,600)||url,url,title,sourceId,source:text(value.source||value.publisher,120),publisher:text(value.publisher||value.source,120),type:text(value.type,100),
    // Optional so existing v1 archives retain their exact validated shape.
    ...(text(value.evidenceStatus,160)?{evidenceStatus:text(value.evidenceStatus,160)}:{}),
    summary:text(value.summary,value.type==='Independent energy analysis'?600:280)||null,publishedAt,publishedDate,publicationPrecision:publishedAt?(value.publicationPrecision==='day'?'day':'timestamp'):publishedDate?'day':'unknown',
    discoveredAt:instant(value.discoveredAt,now),eventDate:day(value.eventDate),dateBasis:text(value.dateBasis,150),dateNote:text(value.dateNote,300),contentAccess:text(value.contentAccess,200),
    discoveryProvider:text(value.discoveryProvider,80),discoveryUrl:canonicalReportUrl(value.discoveryUrl),
    energy:value.energy===true,theaters:strings(value.theaters,2,20).filter(x=>['bab','hormuz'].includes(x)),actors:strings(value.actors,40,120),
    relevanceScopes:strings(value.relevanceScopes,8,60),matchEvidence:Array.isArray(value.matchEvidence)?value.matchEvidence.slice(0,40).filter(object).map(m=>({kind:text(m.kind,50),value:text(m.value,100),field:text(m.field,50),basis:text(m.basis,200)})):[],
    provenance:mergeProvenance(own&&!entries.some(p=>p.sourceId===own.sourceId&&p.url===own.url)?[own]:[],entries)};
}
function observation(record,map,now){
  const ids=new Set([record.sourceId,...record.provenance.map(p=>p.sourceId)]);
  const values=[...ids].map(id=>instant(map?.[id],now)).filter(Boolean);
  return values.length?values.sort().at(-1):null;
}
function combine(previous,incoming,seenAt){
  // Index-only metadata must not attach a revised headline to an older known
  // publication clock. Keep the publisher record and enrich its discovery data.
  const newer=seenAt&&seenAt>=previous.lastSeenAt&&(incoming.publishedAt||incoming.publishedDate||!(previous.publishedAt||previous.publishedDate));
  const previousPriority=analysisRecordPriority(previous),incomingPriority=analysisRecordPriority(incoming),mixedAnalysis=previousPriority!==incomingPriority;
  const primary=mixedAnalysis?(incomingPriority>previousPriority?incoming:previous):(newer?incoming:previous),other=primary===incoming?previous:incoming;
  // A publisher preview and access label belong to that publisher record.
  // An index's publication claim must not supply the preview's missing clock.
  return {...primary,...analysisLabels(primary,other),publishedAt:primary.publishedAt||(mixedAnalysis?null:other.publishedAt),publishedDate:primary.publishedDate||(mixedAnalysis?null:other.publishedDate),
    publicationPrecision:mixedAnalysis||primary.publishedAt||primary.publishedDate?primary.publicationPrecision:other.publicationPrecision,
    discoveredAt:primary.discoveredAt||other.discoveredAt,provenance:mergeProvenance(previous.provenance,incoming.provenance),
    firstSeenAt:seenAt&&seenAt<previous.firstSeenAt?seenAt:previous.firstSeenAt,lastSeenAt:seenAt&&seenAt>previous.lastSeenAt?seenAt:previous.lastSeenAt};
}
const newestFirst=(a,b)=>b.lastSeenAt.localeCompare(a.lastSeenAt)||a.url.localeCompare(b.url);
const displayFirst=(a,b)=>(b.publishedAt||b.publishedDate||b.discoveredAt||b.lastSeenAt||'').localeCompare(a.publishedAt||a.publishedDate||a.discoveredAt||a.lastSeenAt||'')||a.url.localeCompare(b.url);
const LOAD_WARNING='The reporting archive could not be restored. New metadata is available only in memory; the existing archive has not been overwritten.';
const SAVE_WARNING='The reporting archive could not be saved. New metadata may be lost when the collector restarts.';

export class ReportArchive {
  constructor({file,now=Date.now,maxRecords=1200,retentionDays=30,storage={open,mkdir,rename,unlink}}){
    if(typeof file!=='string'||!file)throw new TypeError('An archive file is required.');
    if(!Number.isInteger(maxRecords)||maxRecords<1||maxRecords>MAX_ROWS)throw new RangeError('Archive capacity must be 1–5000 records.');
    if(!Number.isFinite(retentionDays)||retentionDays<=0||retentionDays>365)throw new RangeError('Archive retention must be greater than zero and at most 365 days.');
    this.storage=storage;this.file=file;this.now=now;this.maxRecords=maxRecords;this.retentionDays=retentionDays;
    this.records=new Map();this.truncated=false;this.error=null;this.blocked=false;this.loaded=false;this.requests=[];this.draining=false;this.lastSaved=null;
  }

  merge(items,{observedAtBySource={}}={}){
    const now=this.now(),rows=Array.isArray(items)?items.slice(0,10000).map(item=>normalize({...item,...analysisLabels(item)},now)).filter(Boolean):[];
    const observations=Object.fromEntries(Object.entries(observedAtBySource||{}).slice(0,100).map(([id,time])=>[id,instant(time,now)]));
    return new Promise((resolve,reject)=>{
      this.requests.push({rows,observations,inputTruncated:Array.isArray(items)&&items.length>10000,resolve,reject});
      if(!this.draining){this.draining=true;queueMicrotask(()=>this.drain());}
    });
  }

  async load(){
    if(this.loaded)return;this.loaded=true;
    let handle;
    try{
      handle=await this.storage.open(this.file,constants.O_RDONLY|constants.O_NOFOLLOW);
      const info=await handle.stat();if(!info.isFile()||info.size>MAX_BYTES)throw Error('Invalid archive size');
      // A bounded read also protects against a file growing after stat().
      const bytes=Buffer.alloc(MAX_BYTES+1);let length=0;
      while(length<bytes.length){const read=await handle.read(bytes,length,bytes.length-length,null);if(!read.bytesRead)break;length+=read.bytesRead;}
      if(length>MAX_BYTES)throw Error('Archive too large');
      const saved=JSON.parse(bytes.subarray(0,length).toString('utf8'));
      if(!object(saved)||saved.schema!==SCHEMA||!Array.isArray(saved.items)||saved.items.length>MAX_ROWS||typeof saved.truncated!=='boolean')throw Error('Invalid archive');
      const restored=new Map(),now=this.now();
      for(const raw of saved.items){
        const row=normalize(raw,now),firstSeenAt=instant(raw?.firstSeenAt,now),lastSeenAt=instant(raw?.lastSeenAt,now);
        if(!row||!firstSeenAt||!lastSeenAt||firstSeenAt>lastSeenAt||restored.has(row.url))throw Error('Invalid stored record');
        // Every persisted field must match the bounded metadata schema. Extra
        // fields and overlong or malformed values are not silently trusted.
        const expected={...row,firstSeenAt,lastSeenAt};
        if(Object.keys(raw).length!==Object.keys(expected).length||Object.keys(expected).some(key=>JSON.stringify(raw[key])!==JSON.stringify(expected[key])))throw Error('Invalid stored metadata');
        restored.set(row.url,expected);
      }
      this.records=restored;this.truncated=saved.truncated;
    }catch(error){
      if(error.code!=='ENOENT'){this.blocked=true;this.error=LOAD_WARNING;}
    }finally{await handle?.close().catch(()=>{});}
  }

  apply({rows,observations,inputTruncated}){
    const now=this.now(),cutoff=now-this.retentionDays*DAY,current=new Set(),ephemeral=new Map();
    for(const [url,row] of this.records)if(Date.parse(row.lastSeenAt)<cutoff)this.records.delete(url);
    for(const row of rows){
      const seenAt=observation(row,observations,now),previous=this.records.get(row.url);
      // Repeating an old cached response is not another source observation.
      if(seenAt&&Date.parse(seenAt)<cutoff)continue;
      current.add(row.url);
      if(previous)this.records.set(row.url,combine(previous,row,seenAt));
      else if(seenAt)this.records.set(row.url,{...row,firstSeenAt:seenAt,lastSeenAt:seenAt});
      else ephemeral.set(row.url,{...row,firstSeenAt:null,lastSeenAt:null});
    }
    this.truncated ||= inputTruncated;
    const ordered=[...this.records.values()].sort(newestFirst);
    if(ordered.length>this.maxRecords){this.truncated=true;this.records=new Map(ordered.slice(0,this.maxRecords).map(row=>[row.url,row]));}
    return {current,ephemeral};
  }

  serialize(){return JSON.stringify({schema:SCHEMA,truncated:this.truncated,items:[...this.records.values()].sort(newestFirst)});}

  async save(){
    let content=this.serialize();
    while(Buffer.byteLength(content)>MAX_BYTES&&this.records.size){
      const oldest=[...this.records.values()].sort(newestFirst).at(-1);this.records.delete(oldest.url);this.truncated=true;content=this.serialize();
    }
    if(this.blocked||content===this.lastSaved)return;
    const temporary=this.file+'.'+randomUUID()+'.tmp';let handle;
    try{
      await this.storage.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
      handle=await this.storage.open(temporary,'wx',0o600);await handle.writeFile(content,'utf8');await handle.sync();await handle.close();handle=null;
      await this.storage.rename(temporary,this.file);this.lastSaved=content;this.error=null;
    }catch{this.error=SAVE_WARNING;}
    finally{await handle?.close().catch(()=>{});await this.storage.unlink(temporary).catch(()=>{});}
  }

  result({current,ephemeral}){
    const rows=new Map(this.records);
    for(const [url,row] of ephemeral)if(!rows.has(url))rows.set(url,row);
    // Relabel old metadata for display without invalidating its exact v1 disk
    // schema or inventing a new source observation merely by reading history.
    const items=[...rows.values()].map(row=>({...row,...analysisLabels(row),retainedFromHistory:!current.has(row.url)})).sort(displayFirst);
    return structuredClone({items,archive:{retentionDays:this.retentionDays,maxRecords:this.maxRecords,recordCount:this.records.size,retainedCount:items.filter(row=>row.retainedFromHistory).length,truncated:this.truncated,storageStatus:this.error?'memory-only':'ready',...(this.error?{error:this.error}:{})}});
  }

  async drain(){
    // Concurrent consumers share one load and one atomic save per batch; each
    // call retains its own current-snapshot markers. No mutation races a write.
    try{
      await this.load();
      while(this.requests.length){
        const batch=this.requests.splice(0),views=[];
        try{for(const request of batch)views.push(this.apply(request));await this.save();for(let i=0;i<batch.length;i++)batch[i].resolve(this.result(views[i]));}
        catch(error){for(const request of batch)request.reject(error);}
      }
    }finally{this.draining=false;}
  }
}
