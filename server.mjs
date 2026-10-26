import {createDataService} from './lib/data-service.mjs';
import {startLocalServer} from './lib/local-launch.mjs';
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import {ReportArchive} from './lib/report-archive.mjs';
import {renderShell} from './lib/site-pages.mjs';
import { AisFeed } from './lib/ais.mjs';
import { SourceRuntime } from './lib/source-runtime.mjs';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=path.dirname(fileURLToPath(import.meta.url));
const instanceId=createHash('sha256').update(root).digest('hex').slice(0,16);
const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
const runtime=new SourceRuntime({cacheDir:path.join(root,'.cache'),log:event=>{if(['source_finished','cache_failed','ais_state'].includes(event.event))console.log(JSON.stringify(event));}});
const reportArchive=new ReportArchive({file:path.join(root,'.cache','reporting-history.json')});
let reportingTimer,reportingStopped=false,reportingCollectorActive=false;
async function collectReporting() {
  if(reportingStopped)return;
  // Received AIS positions stream separately; this cycle refreshes the dated sources.
  try {
    const results=await Promise.allSettled([service.collect({entryPoint:'background'})]);
    if(results.some(result=>result.status==='rejected'))throw Error('Background source failed');
  }
  catch { console.warn('Background collection could not complete. Previously retained data remains available.'); }
  finally { if(!reportingStopped){reportingTimer=setTimeout(collectReporting,300000);reportingTimer.unref();} }
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png','.md':'text/plain; charset=utf-8'};
let port=Number(process.env.PORT)||4173;
const ais = new AisFeed({ apiKey: process.env.AISSTREAM_API_KEY, onEvent:(event,context)=>runtime.event('ais_state','aisstream',context,event) });
const service=createDataService({runtime,reportArchive,ais,version,
  // Locally the curated list comes from the working copy, so unmerged edits show here first.
  settings:{eiaApiKey:process.env.EIA_API_KEY,aisstream:!!process.env.AISSTREAM_API_KEY,get curatedEventsUrl(){return process.env.PASSAGE_EVENTS_URL||`http://127.0.0.1:${port}/data/war-events.json`;}},
  collection:()=>({active:reportingCollectorActive,intervalSeconds:300,basis:'Reporting, oil, transits and market odds collect at startup and every five minutes while this local process is running; no collection while it is stopped.'}),
});
const server=http.createServer(async(req,res)=>{
  const requestId=randomUUID(),requestStart=Date.now();res.setHeader('X-Request-ID',requestId);
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const host=req.headers.host?.split(':')[0];if(!['127.0.0.1','localhost','[::1]'].includes(host)){res.writeHead(403);return res.end('Local access only');}
  try{
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end('Method not allowed');}
    if(url.pathname.startsWith('/api/')){
      let data;const entryPoint=url.pathname.slice(5),context={requestId,entryPoint};
      res.once('finish',()=>runtime.event('request_finished',null,context,{durationMs:Date.now()-requestStart,httpStatus:res.statusCode}));
      if(url.pathname==='/api/health')data={application:'passage-maritime-watch',status:'ready',instanceId,meaning:'Local process is running; source availability is separate.',version};
      else data=await service.get(url.pathname,url.searchParams,context);
      if(data===null){res.writeHead(404);return res.end('Unknown endpoint');}
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(data));
    }
    // Pages live at directory paths (/hormuz/); a path without its slash is redirected, as GitHub Pages does.
    const requested=decodeURIComponent(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname);
    const file=path.resolve(root,'dist','.'+requested);
    if(!file.startsWith(path.join(root,'dist')+path.sep)){res.writeHead(403);return res.end('Forbidden');}
    if(!path.extname(file)&&(await stat(file).catch(()=>null))?.isDirectory()){res.writeHead(301,{Location:url.pathname+'/'+url.search});return res.end();}
    try{
      const body=await readFile(file),type=mime[path.extname(file)]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});
      res.end(req.method==='HEAD'?undefined:type.startsWith('text/html')?renderShell(body.toString('utf8'),url.pathname):body);
    }catch(error){
      // A missing page gets the site's own 404 page; a missing asset stays a plain 404.
      if(error.code!=='ENOENT'||(path.extname(file)&&path.extname(file)!=='.html'))throw error;
      const body=renderShell(await readFile(path.join(root,'dist','404.html'),'utf8'),'/404');
      res.writeHead(404,{'Content-Type':mime['.html'],'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:body);
    }
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
