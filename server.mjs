import {createDataService} from './lib/data-service.mjs';
import {startLocalServer} from './lib/local-launch.mjs';
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import {ReportArchive} from './lib/report-archive.mjs';
import { AisFeed } from './lib/ais.mjs';
import {AcledConnection,isLocalMutation,readLocalJson} from './lib/acled.mjs';
import {SourceError} from './lib/source-runtime.mjs';
import { SourceRuntime } from './lib/source-runtime.mjs';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=path.dirname(fileURLToPath(import.meta.url));
const instanceId=createHash('sha256').update(root).digest('hex').slice(0,16);
const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
const runtime=new SourceRuntime({cacheDir:path.join(root,'.cache'),log:event=>{if(['source_finished','cache_failed','ais_state'].includes(event.event))console.log(JSON.stringify(event));}});
const reportArchive=new ReportArchive({file:path.join(root,'.cache','reporting-history.json')});
const acled=new AcledConnection({root,runtime});await acled.initialize();
let reportingTimer,reportingStopped=false,reportingCollectorActive=false;
async function collectReporting() {
  if(reportingStopped)return;
  try { await service.news({entryPoint:'background'}); }
  catch { console.warn('Reporting collection could not complete. Previously retained history remains available.'); }
  finally { if(!reportingStopped){reportingTimer=setTimeout(collectReporting,300000);reportingTimer.unref();} }
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.ttf':'font/ttf','.png':'image/png','.md':'text/plain; charset=utf-8'};
let port=Number(process.env.PORT)||4173;
const ais = new AisFeed({ apiKey: process.env.AISSTREAM_API_KEY, onEvent:(event,context)=>runtime.event('ais_state','aisstream',context,event) });
const service=createDataService({runtime,reportArchive,acled,ais,version,
  settings:{eiaApiKey:process.env.EIA_API_KEY,reliefwebAppname:process.env.RELIEFWEB_APPNAME,aisstream:!!process.env.AISSTREAM_API_KEY},
  collection:()=>({active:reportingCollectorActive,intervalSeconds:300,basis:'Collects while this local Passage process is running; no collection while it is stopped.'}),
});
const {health}=service;
const server=http.createServer(async(req,res)=>{
  const requestId=randomUUID(),requestStart=Date.now();res.setHeader('X-Request-ID',requestId);
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self' https://www.tradingview-widget.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const host=req.headers.host?.split(':')[0];if(!['127.0.0.1','localhost','[::1]'].includes(host)){res.writeHead(403);return res.end('Local access only');}
  try{
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(req.method==='POST'&&['/api/acled/connect','/api/acled/disconnect'].includes(url.pathname)){
      const context={requestId,entryPoint:url.pathname.endsWith('/connect')?'acled-connect':'acled-disconnect'};
      res.once('finish',()=>runtime.event('request_finished',null,context,{durationMs:Date.now()-requestStart,httpStatus:res.statusCode}));
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
      if(!isLocalMutation(req,port)){res.writeHead(403);return res.end(JSON.stringify({error:'Open the ACLED connection page in Passage to make this change.'}));}
      let body;try{body=await readLocalJson(req);}catch{res.writeHead(400);return res.end(JSON.stringify({error:'The sign-in form could not be read. Please try again.'}));}
      try{
        if(url.pathname.endsWith('/disconnect')){const data=await acled.disconnect();res.writeHead(200);return res.end(JSON.stringify(data));}
        const data=await acled.connect(body?.email,body?.password,context);res.writeHead(200);return res.end(JSON.stringify({configured:acled.configured,source:health('acled',data),countries:data.countries||[]}));
      }catch(error){const safe=error instanceof SourceError?error:new SourceError('cache_io');res.writeHead(safe.category==='auth'?401:safe.category==='rate_limit'?429:502);return res.end(JSON.stringify({category:safe.category,error:safe.category==='auth'?'ACLED rejected access. Check your login, account profile, accepted terms and API access on acleddata.com.':safe.message, retryAfterSeconds:safe.retryAfterMs?Math.ceil(safe.retryAfterMs/1000):null}));}
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end('Method not allowed');}
    if(url.pathname.startsWith('/api/')){
      let data;const entryPoint=url.pathname.slice(5),context={requestId,entryPoint};
      res.once('finish',()=>runtime.event('request_finished',null,context,{durationMs:Date.now()-requestStart,httpStatus:res.statusCode}));
      if(url.pathname==='/api/health')data={application:'passage-maritime-watch',status:'ready',instanceId,meaning:'Local process is running; source availability is separate.',version};
      else data=await service.get(url.pathname,url.searchParams,context);
      if(data===null){res.writeHead(404);return res.end('Unknown endpoint');}
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(data));
    }
    const requested=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const file=path.resolve(root,'dist','.'+requested);
    if(!file.startsWith(path.join(root,'dist')+path.sep)){res.writeHead(403);return res.end('Forbidden');}
    const body=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:body);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:500,{'Content-Type':'text/plain'});res.end(error.code==='ENOENT'?'Not found':'Could not load this resource');}
});
server.requestTimeout=15000;
let localUrl = `http://127.0.0.1:${port}`;
const openOnStart = process.argv.includes('--open-firefox');

function openFirefox() {
  return new Promise((resolve, reject) => {
    const firefoxApp = ['/Applications/Firefox.app', path.join(homedir(), 'Applications', 'Firefox.app')].find(existsSync) || 'Firefox';
    const browser = spawn('/usr/bin/open', ['-a', firefoxApp, localUrl], { stdio: 'inherit' });
    browser.once('error', reject);
    browser.once('exit', code => code === 0 ? resolve() : reject(new Error(`Firefox could not be opened (exit ${code}).`)));
  });
}

try {
  const launch = await startLocalServer({
    server, preferredPort: port, identity: {instanceId, version},
    portFile: path.join(root, '.cache', 'launcher.json'),
    onPort: selected => { port = selected; localUrl = `http://127.0.0.1:${selected}`; },
  });
  if (launch.settingsWarning) console.warn(launch.settingsWarning);
  if (launch.reused) {
    ais.close();
    console.log(`Passage is already running at ${localUrl}.`);
  } else {
    reportingCollectorActive=true;void collectReporting();
    console.log(`PASSAGE: ${localUrl}`);
    console.log('Keep this window open while viewing Passage. Press Control-C here to stop the server.');
  }
  if (openOnStart) {
    console.log('Opening Passage in Firefox…');
    try { await openFirefox(); }
    catch (error) {
      console.error(`${error.message} Passage is running at ${localUrl}`);
      if (launch.reused) process.exitCode = 1;
    }
  }
} catch (error) {
  ais.close();
  console.error(`Passage could not start: ${error.message}`);
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { reportingStopped=true;clearTimeout(reportingTimer);ais.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
