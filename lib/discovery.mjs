import {createHash} from 'node:crypto';
import {classifyReport,plain,safeUrl,reportRelevant} from './feeds.mjs';
import {analysisLabels} from '../dist/intelligence-data.mjs';

// GDELT collection is retired after persistent production rate limits. The
// parser remains for historical metadata and fixtures, never for active polling.
export const DISCOVERY_SOURCES=Object.freeze([]);
export const RETIRED_DISCOVERY_SOURCES=Object.freeze(['gdelt-hormuz','gdelt-redsea','gdelt-exports','gdelt-energy','gdelt-reuters']);
export const DISCOVERY_LIMIT=250;
const publisherNames={'reuters.com':'Reuters','apnews.com':'Associated Press','bbc.com':'BBC','bbc.co.uk':'BBC','aljazeera.com':'Al Jazeera','eia.gov':'EIA','iea.org':'IEA','spa.gov.sa':'Saudi Press Agency','centcom.mil':'CENTCOM','aol.com':'AOL','jpost.com':'The Jerusalem Post','investing.com':'Investing.com'};

function seenDate(value,now){
  if(typeof value!=='string'||!/^\d{8}T\d{6}Z$/.test(value))return null;
  const iso=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(9,11)}:${value.slice(11,13)}:${value.slice(13,15)}.000Z`;
  const ms=Date.parse(iso);return Number.isFinite(ms)&&ms<=now+60000&&new Date(ms).toISOString()===iso?iso:null;
}
export function parseDiscovery(payload,source,now=Date.now()){
  if(!payload||!Array.isArray(payload.articles)||payload.articles.length>DISCOVERY_LIMIT)throw Error('Unexpected discovery schema');
  const result=[];
  for(const article of payload.articles.slice(0,DISCOVERY_LIMIT)){
    if(!article||typeof article.title!=='string'||typeof article.url!=='string')continue;
    const title=plain(article.title).slice(0,500),url=safeUrl(article.url),discoveredAt=seenDate(article.seendate,now);
    if(!title||!url||!discoveredAt)continue;
    const hostname=new URL(url).hostname.replace(/^www\./,'');
    if(source.domain&&hostname!==source.domain)continue;
    const publisher=publisherNames[hostname]||hostname;
    const record={id:createHash('sha256').update(url).digest('hex').slice(0,18),title,url,summary:null,publishedAt:null,publicationPrecision:'unknown',eventDate:null,discoveredAt,dateBasis:'discovery',dateNote:'GDELT index time; publisher publication time and event time are unknown.',source:publisher,publisher,sourceId:source.id,type:'Discovered reporting',contentAccess:'discovery-metadata',discoveryProvider:'GDELT',discoveryUrl:'https://www.gdeltproject.org/',discoveryFamily:source.id,language:typeof article.language==='string'?plain(article.language).slice(0,50):null};
    Object.assign(record,analysisLabels(record));
    const tags=classifyReport(record);
    // Query matches may come from article bodies; results that cannot establish
    // relevance from the available metadata stay out of the analytical view.
    if(!reportRelevant(tags)||!tags.theaters.includes(source.id==='gdelt-hormuz'?'hormuz':'bab')||! /\b(?:ships?|shipping|vessels?|tankers?|maritime|ports?|seafarers?|navigation|transits?)\b/i.test(title))continue;
    result.push({...record,...tags});
  }
  return [...new Map(result.map(item=>[item.url,item])).values()];
}
