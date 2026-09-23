import {randomUUID} from 'node:crypto';
import {SourceRuntime} from '../lib/source-runtime.mjs';
import {ReportArchive} from '../lib/report-archive.mjs';
import {createDataService} from '../lib/data-service.mjs';
import {waitForDiscovery} from '../lib/discovery.mjs';
import {SqliteFiles} from './sqlite-files.mjs';
import {sourceStorage} from './source-storage.mjs';
import {WorkerAisFeed} from './ais.mjs';
import {pooledFetch} from './fetch-pool.mjs';
import {allowedRoute,json} from './policy.mjs';

const INTERVAL=300_000,STATUS='/cache/collector.json',POSITIONS='/cache/ais-positions.json';
const stamp=ms=>ms==null?null:new Date(ms).toISOString();

/** The only collector instance is selected by the worker's fixed name.
 * A single alarm supervises AIS and scheduled source collection. Cron calls the
 * same instance as a recovery path, never creates another subscription.
 */
export class Collector {
  constructor(state,env,{now=Date.now,fetchImpl=fetch,Socket=globalThis.WebSocket,serviceFactory=createDataService}={}) {
    this.state=state;this.env=env;this.now=now;this.version=env.APP_VERSION||'0.8.0-preview.1';
    this.paused=env.COLLECTOR_PAUSED===true||env.COLLECTOR_PAUSED==='true';
    this.files=new SqliteFiles(state.storage);this.nextCollectionAt=now();this.collecting=null;this.alarmQueue=Promise.resolve();
    this.lastAttemptAt=null;this.lastCompletedAt=null;this.error=null;this.persistenceError=null;this.cycles=0;this.responses=new Map();this.pending=new Map();
    this.runtime=new SourceRuntime({cacheDir:'/cache',now,fetchImpl:pooledFetch(fetchImpl),storage:sourceStorage(this.files,now)});
    this.archive=new ReportArchive({file:'/cache/reporting-history.json',now,storage:this.files,maxRecords:1200,retentionDays:30});
    this.ais=new WorkerAisFeed({apiKey:this.paused?null:env.AISSTREAM_API_KEY,Socket,now,onEvent:(fields,context)=>this.runtime.event('ais_state','aisstream',context,fields),schedule:()=>{this.state.waitUntil(this.schedule().catch(()=>{this.persistenceError='Collector alarm could not be saved; cron will attempt recovery.';}));}});
    this.service=serviceFactory({runtime:this.runtime,reportArchive:this.archive,settings:{eiaApiKey:env.EIA_API_KEY,aisstream:!!env.AISSTREAM_API_KEY,reliefwebAppname:env.RELIEFWEB_APPNAME,hosted:true},ais:this.ais,version:this.version,collection:()=>this.status()});
  }
  async initialize() {
    try {
      const saved=JSON.parse(await this.files.readFile(STATUS,'utf8'));
      for(const key of ['lastAttemptAt','lastCompletedAt'])if(Number.isFinite(Date.parse(saved[key]))&&Date.parse(saved[key])<=this.now())this[key]=saved[key];
      if(Number.isSafeInteger(saved.cycles)&&saved.cycles>=0)this.cycles=saved.cycles;
      // At least once after cold start. SourceRuntime restores individual TTLs
      // and Retry-After deadlines before deciding which upstream work is due.
    }catch(error){if(error.code!=='ENOENT')this.persistenceError='Collector status could not be restored.';}
    try{this.ais.restore(JSON.parse(await this.files.readFile(POSITIONS,'utf8')));}catch(error){if(error.code!=='ENOENT')this.persistenceError='Retained AIS positions could not be restored; new observations will be collected.';}
    this.ais.tick();await this.schedule();
  }
  status() {
    return {active:!this.paused,intervalSeconds:INTERVAL/1000,basis:this.paused?'Background collection is paused by the owner.':'Scheduled background collector; source intervals, provider backoff and free hosting limits still apply.',
      lastAttemptAt:this.lastAttemptAt,lastCompletedAt:this.lastCompletedAt,nextAttemptAt:this.paused?null:stamp(this.nextCollectionAt),cycles:this.cycles,
      collecting:!!this.collecting,error:this.error,persistenceError:this.persistenceError,
      retention:'Up to 1,200 reporting metadata records for 30 days; AIS positions expire after 30 minutes, static ship metadata after 24 hours.'};
  }
  schedule() {
    // Serialize read/compare/set so concurrent requests cannot replace an early
    // collection alarm with a later AIS supervision tick.
    const operation=this.alarmQueue.then(async()=>{
      if(this.paused){this.ais.close();await this.state.storage.deleteAlarm();return;}
      const at=Math.max(this.now()+1000,Math.min(this.nextCollectionAt,this.ais.nextTick()??Infinity));
      const current=await this.state.storage.getAlarm();
      if(current===null||current>at)await this.state.storage.setAlarm(at);
    });
    this.alarmQueue=operation.catch(()=>{});return operation;
  }
  async checkpoint() {
    try {
      await this.files.writeFile(POSITIONS,JSON.stringify(this.ais.checkpoint()));
      await this.files.writeFile(STATUS,JSON.stringify({lastAttemptAt:this.lastAttemptAt,lastCompletedAt:this.lastCompletedAt,cycles:this.cycles}));
      this.persistenceError=null;
    }catch{this.persistenceError='Collector checkpoint could not be saved. In-memory observations remain dated; cron will retry.';}
  }
  collect() {
    if(this.paused)return Promise.resolve(false);
    if(this.collecting)return this.collecting;
    if(this.now()<this.nextCollectionAt)return Promise.resolve(false);
    this.lastAttemptAt=stamp(this.now());this.nextCollectionAt=this.now()+INTERVAL;
    this.collecting=(async()=>{
      try {
        await this.service.collect({entryPoint:'background',requestId:randomUUID()});
        this.lastCompletedAt=stamp(this.now());this.cycles++;this.error=null;
      }catch{this.error='Scheduled collection did not finish. Available source data retains its original timestamps.';}
      finally {
        // A slow cycle never triggers an immediate retry storm. Discovery and
        // all archive writes are awaited by service.collect before checkpoint.
        this.nextCollectionAt=Math.max(this.nextCollectionAt,this.now()+1000);
        await this.checkpoint();this.responses.clear();this.collecting=null;
      }
      return true;
    })();
    return this.collecting;
  }
  async alarm() {
    try{this.ais.tick();await this.collect();}
    finally{await this.schedule();}
  }
  async fetch(request) {
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/_collect'){
      await this.alarm();return json({collection:this.status()});
    }
    if(request.method!=='GET'||!allowedRoute(url))return json({error:'Not found.'},404);
    await this.schedule();
    if(url.pathname==='/api/health')return json({application:'passage-maritime-watch',status:this.paused?'paused':'ready',ready:!this.paused,version:this.version,hosted:true,collection:this.status(),storage:this.files.usage()},this.paused?503:200);
    if(this.paused)return json({error:'Background collection is paused by the owner.'},503);
    const key=url.pathname+url.search,cache=this.responses.get(key);
    if(cache&&this.now()-cache.at<5000)return json(cache.data);
    if(!this.pending.has(key)){
      const operation=(async()=>{
        const context={entryPoint:url.pathname.split('/')[2],requestId:randomUUID()};
        const data=await this.service.get(url.pathname,url.searchParams,context);
        if(data===null)return null;
        // Retain metadata on scheduled alarms even with no viewers. This extra
        // request lifetime is only a best-effort bridge to the next alarm.
        this.state.waitUntil(waitForDiscovery(this.runtime).catch(()=>{}));
        this.responses.set(key,{at:this.now(),data});return data;
      })();
      this.pending.set(key,operation);operation.finally(()=>this.pending.delete(key)).catch(()=>{});
    }
    try{const data=await this.pending.get(key);return data===null?json({error:'Not found.'},404):json(data);}
    catch{return json({error:'This live source view is temporarily unavailable; the collector will retry.'},503,{'Retry-After':'30'});}
  }
}
