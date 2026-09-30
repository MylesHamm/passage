import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {plain,publisherSummary,publisherDateMillis,safeUrl,classifyReport} from './feeds.mjs';

export const AL_JAZEERA_INDEX='https://www.aljazeera.com/middle-east/';
// Public index metadata verified on 2026-09-30. This is not a documented API.
// Read only the regional article references delivered in the public HTML;
// never execute its scripts or fetch article bodies, images or private data.
export function parseAlJazeeraIndex(html,now=Date.now()){
 const encoded=String(html).match(/window\.__APOLLO_STATE__\s*=\s*["']([A-Za-z0-9+/=]+)["']/)?.[1];
 if(!encoded||encoded.length>2000000)throw Error('Al Jazeera regional index markup changed');
 let state;try{state=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));}catch{throw Error('Al Jazeera regional index metadata is invalid');}
 const references=[];
 for(const [key,value] of Object.entries(state?.ROOT_QUERY||{})){
  const query=key.match(/^posts\((\{.*\})\)$/);if(!query)continue;
  let args;try{args=JSON.parse(query[1]);}catch{continue;}
  if(args.category!=='middle-east'||args.categoryType!=='where')continue;
  if(!Array.isArray(value))throw Error('Al Jazeera regional index metadata changed');
  references.push(...value);
 }
 if(!references.length||references.length>100)throw Error('Al Jazeera regional index article list changed');
 const items=[];
 for(const ref of references){
  const post=typeof ref?.__ref==='string'&&/^Post:\d+$/.test(ref.__ref)?state[ref.__ref]:null;
  if(!post||post.__typename!=='Post'||typeof post.title!=='string'||typeof post.link!=='string'||typeof post.date!=='string')throw Error('Al Jazeera regional index article metadata changed');
  const title=plain(post.title).slice(0,500),summary=publisherSummary(post.excerpt||'');
  let url;try{url=safeUrl(new URL(post.link,AL_JAZEERA_INDEX).href);}catch{}
  if(!title||!url||new URL(url).origin!=='https://www.aljazeera.com'||!/^\/(?:[a-z-]+\/){1,3}\d{4}\/\d{1,2}\/\d{1,2}\/[^/]+\/?$/.test(new URL(url).pathname))throw Error('Al Jazeera regional index article metadata is invalid');
  if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(post.date))throw Error('Al Jazeera regional index date metadata is invalid');
  const hasZone=/(?:Z|[+-]\d{2}:\d{2})$/.test(post.date),ms=publisherDateMillis(post.date+(hasZone?'':'Z'));
  const day=post.date.slice(0,10),dayMs=publisherDateMillis(day+'T00:00:00Z');
  if(!Number.isFinite(ms)||!Number.isFinite(dayMs)||(hasZone?ms:dayMs)>now+300000)throw Error('Al Jazeera regional index date metadata is invalid');
  const record={id:createHash('sha256').update(url).digest('hex').slice(0,18),title,url,summary:summary||null,
   publishedAt:new Date(hasZone?ms:dayMs).toISOString(),
   ...(hasZone?{}:{publishedDate:day,publicationDate:day,dateNote:'Publisher index supplies no timezone. Shown as a publication date; the stored midnight value is not an observed publication time.'}),
   publicationPrecision:hasZone?'timestamp':'day',dateBasis:hasZone?'publisher-publication':'publisher-date',discoveredAt:null,eventDate:null,
   source:'Al Jazeera',publisher:'Al Jazeera',sourceId:'aj',type:'Reporting',contentAccess:summary?'publisher-summary':'headline-only'};
  items.push({...record,...classifyReport(record)});
 }
 return [...new Map(items.map(item=>[item.url,item])).values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)||a.url.localeCompare(b.url));
}
