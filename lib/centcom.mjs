import {createHash} from 'node:crypto';
import {plain,classify,publisherDateMillis} from './feeds.mjs';
export const CENTCOM_INDEX='https://www.centcom.mil/MEDIA/PRESS-RELEASES/';
// Public Releases block verified against three linked official statements.
// https://www.centcom.mil/MEDIA/PRESS-RELEASES/
// This HTML is a public index, not a documented API; changed markup fails closed.
export function parseCentcomIndex(html,now=Date.now()){
 const start=html.indexOf('>Public Releases</span>');if(start<0)throw Error('Public release index changed');
 const section=html.slice(start,html.indexOf('</div>',start)),items=[];
 const rows=[...section.matchAll(/<b>\s*<a href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>\s*<\/b>\s*([^<]+)<br\s*\/?\s*>/gi)];
 if(!rows.length||rows.length>100)throw Error('No structured release rows');
 for(const [,link,titleRaw,dateRaw] of rows){
  const url=new URL(link);if(url.origin!=='https://www.centcom.mil'||!/^\/MEDIA\/PUBLIC-RELEASES\/Article\/\d+\//i.test(url.pathname))throw Error('Unexpected statement link');
  const title=plain(titleRaw),label=plain(dateRaw),ms=publisherDateMillis(label.replace('Sept.','Sep.')+' 00:00:00 GMT');
  if(!title||!Number.isFinite(ms)||ms>now)throw Error('Invalid release date');
  const date=new Date(ms).toISOString().slice(0,10),context=classify(title+' CENTCOM');
  items.push({id:createHash('sha256').update(url.href).digest('hex').slice(0,18),title,url:url.href,publishedAt:date+'T00:00:00.000Z',publicationDate:date,publicationPrecision:'day',publicationNote:'Official index supplies a date; publication time and timezone are not supplied.',source:'CENTCOM',sourceId:'centcom',type:'Official statement',...context});
 }
 return [...new Map(items.map(x=>[x.url,x])).values()].sort((a,b)=>b.publicationDate.localeCompare(a.publicationDate));
}
