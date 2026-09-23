import {PUBLIC_API_PATHS} from '../lib/data-service.mjs';

export function configuredOrigin(value) {
  if(typeof value!=='string')return null;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.origin===value?value:null;}catch{return null;}
}
export function allowedRoute(url) {
  if(!PUBLIC_API_PATHS.has(url.pathname)&&url.pathname!=='/api/health')return false;
  if(url.pathname!=='/api/acled/events')return !url.search;
  const entries=[...url.searchParams];
  return entries.length===0||entries.length===1&&entries[0][0]==='days'&&['30','90','180','365','730'].includes(entries[0][1]);
}
export function json(data,status=200,extra={}) {
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer','Strict-Transport-Security':'max-age=31536000',...extra}});
}
function withCors(response,origin) {
  const headers=new Headers(response.headers);headers.set('Vary','Origin');
  if(origin)headers.set('Access-Control-Allow-Origin',origin);
  return new Response(response.body,{status:response.status,headers});
}
// CORS is a browser boundary, not authentication. The returned metadata is
// intentionally public. No caller URL, cookie, credentials or headers reach DO.
export async function handlePublic(request,env,forward) {
  const configured=configuredOrigin(env.ALLOWED_ORIGIN);
  if(!configured)return json({error:'The dashboard origin has not been configured.'},503);
  const origin=request.headers.get('origin'),url=new URL(request.url);
  if(origin&&origin!==configured)return json({error:'Origin not allowed.'},403,{'Vary':'Origin'});
  const respond=value=>withCors(value,origin);
  if(!allowedRoute(url))return respond(json({error:'Not found.'},404));
  if(request.method==='OPTIONS'){
    if(!origin||request.headers.get('access-control-request-method')!=='GET'||request.headers.get('access-control-request-headers'))return respond(json({error:'Preflight not allowed.'},403));
    return respond(new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET','Access-Control-Max-Age':'600','Cache-Control':'no-store'}}));
  }
  if(request.method!=='GET')return respond(json({error:'Only GET requests are supported.'},405,{'Allow':'GET, OPTIONS'}));
  try{return respond(await forward(new Request('https://collector.internal'+url.pathname+url.search)));}
  catch{return respond(json({error:'The live collector is temporarily unavailable. Existing observations retain their original times.'},503,{'Retry-After':'30'}));}
}
