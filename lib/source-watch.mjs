import {classify,plain,publisherDateMillis} from './feeds.mjs';
import {SourceError} from './source-runtime.mjs';

const SOURCE_ID='hormuz-letter';
const PROFILE_URL='https://x.com/HormuzLetter';
// Explicitly reviewed links only. oEmbed checks a known post; it cannot discover
// new posts. https://docs.x.com/x-for-websites/oembed-api
const TRACKED_POSTS=Object.freeze([
 'https://x.com/HormuzLetter/status/2105318283024961949',
 'https://x.com/HormuzLetter/status/2105353196432679349',
]);
const coverage=()=>({mode:'tracked-posts',automaticDiscovery:false,profileUrl:PROFILE_URL,trackedCount:TRACKED_POSTS.length,limitation:'Only explicitly tracked posts are checked; new posts are not discovered automatically.'});
const invalid=()=>{throw new SourceError('schema');};

function accountUrl(value,{post=false}={}){
 try{
  const u=new URL(value);
  if(u.protocol!=='https:'||!['x.com','twitter.com'].includes(u.hostname)||u.port||u.username||u.password||u.hash)return null;
  if(post){
   if(!/^\/HormuzLetter\/status\/\d+\/?$/i.test(u.pathname))return null;
   if([...u.searchParams.keys()].some(key=>key!=='ref_src'))return null;
   return PROFILE_URL+'/status/'+u.pathname.split('/')[3];
  }
  return /^\/HormuzLetter\/?$/i.test(u.pathname)&&!u.search?PROFILE_URL:null;
 }catch{return null;}
}

function excerptText(value){
 // The return value is text, never provider HTML. Remove media placeholders;
 // keep the publisher's words, including qualifiers and source truncation.
 const withoutMedia=value.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi,(_,label)=>/^pic\.(?:twitter|x)\.com\//i.test(plain(label))?'':label);
 return plain(plain(withoutMedia)).replace(/<[^>]*>/g,' ').replace(/[<>]/g,'').replace(/\s+/g,' ').trim();
}

export function parseSourceWatchPost(payload,trackedUrl,now=Date.now()){
 if(!TRACKED_POSTS.includes(trackedUrl)||!payload||typeof payload!=='object')return invalid();
 if(payload.author_name!=='The Hormuz Letter'||accountUrl(payload.author_url)!==PROFILE_URL||accountUrl(payload.url,{post:true})!==trackedUrl)return invalid();
 if(payload.type!=='rich'||!['X','Twitter'].includes(payload.provider_name)||!['https://x.com','https://twitter.com'].includes(payload.provider_url))return invalid();
 const html=payload.html;
 if(typeof html!=='string'||html.length>65536||/<(?:script|style|iframe|object|embed)\b/i.test(html))return invalid();
 const block=html.match(/^\s*<blockquote\b([^>]*)>([\s\S]*?)<\/blockquote>\s*$/i);
 if(!block||!/\bclass\s*=\s*(['"])[^'"]*\btwitter-tweet\b[^'"]*\1/i.test(block[1])||(html.match(/<blockquote\b/gi)||[]).length!==1)return invalid();
 const paragraphs=[...block[2].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
 if(paragraphs.length!==1)return invalid();
 const summary=excerptText(paragraphs[0][1]);
 if(!summary||summary.length>1200)return invalid();
 // Only the date anchor for this exact post supplies the publication date.
 // oEmbed has day precision; UTC midnight is storage normalization, not a
 // claimed posting time. Relative dates and invalid calendars are rejected.
 const dates=[...block[2].replace(paragraphs[0][0],'').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(([,attrs])=>{
  const href=attrs.match(/\bhref\s*=\s*(['"])(.*?)\1/i)?.[2];
  return accountUrl(plain(href||''),{post:true})===trackedUrl;
 });
 if(dates.length!==1)return invalid();
 const date=plain(dates[0][2]);
 if(!/^(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}$/.test(date))return invalid();
 const stamp=publisherDateMillis(date+' 00:00:00 GMT');
 if(!Number.isFinite(stamp)||!Number.isFinite(now)||stamp>now)return invalid();
 const classification=classify(summary,summary);
 return {
  id:SOURCE_ID+'-'+trackedUrl.split('/').at(-1),url:trackedUrl,title:'The Hormuz Letter · source update',summary,
  source:'The Hormuz Letter',publisher:'The Hormuz Letter',sourceId:SOURCE_ID,type:'Source report',
  publishedAt:new Date(stamp).toISOString(),publicationPrecision:'day',dateBasis:'publisher-date',eventDate:null,discoveredAt:null,
  contentAccess:'Public X post excerpt',evidenceStatus:'Reported by The Hormuz Letter',
  ...classification,matchEvidence:classification.matchEvidence.map(match=>({...match,field:'public post excerpt'})),
 };
}

export async function loadSourceWatch(runtime,context={}){
 const data=await runtime.get(SOURCE_ID,300,async({fetchText})=>{
  const items=await Promise.all(TRACKED_POSTS.map(async trackedUrl=>{
   const endpoint=new URL('https://publish.x.com/oembed');
   endpoint.searchParams.set('url',trackedUrl);endpoint.searchParams.set('omit_script','true');
   return parseSourceWatchPost(JSON.parse(await fetchText(endpoint)),trackedUrl,runtime.now());
  }));
  const latest=items.map(item=>item.publishedAt).sort().at(-1)||null;
  return {items,recordCount:items.length,latest,latestRelevant:latest,publicationPrecision:'day',access:'Official X oEmbed · explicitly tracked posts',coverage:coverage()};
 },context);
 return {...data,items:data.items||[],recordCount:data.items?.length||0,latest:data.latest||null,coverage:coverage()};
}
