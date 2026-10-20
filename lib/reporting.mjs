import {withEvidenceKind} from '../dist/evidence-kind.mjs';
import {SOURCES,parseRSS,classifyReport,safeUrl,reportRelevant,publisherSummary} from './feeds.mjs';
import {parseAlJazeeraIndex,AL_JAZEERA_INDEX} from './aljazeera.mjs';
import {SOURCE_CAPABILITIES,sourceConfigured} from '../dist/source-policy.mjs';
import {SOURCE_DEFINITIONS,sourceHealth,coverage} from '../dist/source-health.mjs';

// Publisher reporting: original RSS and the Al Jazeera regional index, merged
// with the retained archive. Records keep their publisher's own clocks.
const newest=items=>items.map(x=>x.publishedAt).filter(x=>typeof x==='string'&&Number.isFinite(Date.parse(x))).sort().at(-1)||null;
const observed=item=>item.publishedAt||item.publishedDate||item.discoveredAt||'';
function health(id,data,config,now){
  const def=SOURCE_DEFINITIONS.find(source=>source.id===id),{items,...meta}=data;
  return sourceHealth({...def,...meta,name:def.name,configured:sourceConfigured(def,config),connection:data.connection||'loading'},now);
}
function sourceSummary(items,all=items){const publicationKnown=items.filter(item=>item.publishedAt||item.publishedDate).length;return {recordCount:items.length,parsedCount:all.length,latest:newest(all),latestRelevant:newest(items),publicationKnown,publicationUnknown:items.length-publicationKnown};}
export function deduplicateReports(records){
  const unique=new Map();
  for(const item of records){
    const key=safeUrl(item.url);if(!key)continue;const old=unique.get(key);
    const provenance={sourceId:item.sourceId,publisher:item.publisher||item.source,contentAccess:item.contentAccess||'headline-only',dateBasis:item.dateBasis||'publisher-publication',publishedAt:item.publishedAt||null,discoveredAt:item.discoveredAt||null,url:key};
    const inherited=(item.provenance||[]).map(p=>({...p,url:safeUrl(p.url)})).filter(p=>p.url);
    if(!old){unique.set(key,{...item,url:key,provenance:inherited.length?inherited:[provenance]});continue;}
    const samePublisherDay=old.sourceId===item.sourceId&&(old.publishedDate||old.publishedAt?.slice(0,10))===(item.publishedDate||item.publishedAt?.slice(0,10));
    const exact=record=>record.publishedAt&&record.publicationPrecision!=='day';
    const precisionPreferred=samePublisherDay&&Boolean(exact(old))!==Boolean(exact(item))?(exact(item)?item:old):null;
    const preferred=precisionPreferred||((item.publishedAt||item.publishedDate)&&!(old.publishedAt||old.publishedDate)?item:old);
    const entries=preferred===item?[...inherited,provenance,...old.provenance]:[...old.provenance,...inherited,provenance];
    const discoveredAt=entries.map(x=>x.discoveredAt).filter(Boolean).sort()[0]||null;
    const firstSeenAt=[old.firstSeenAt,item.firstSeenAt].filter(Boolean).sort()[0];
    const lastSeenAt=[old.lastSeenAt,item.lastSeenAt].filter(Boolean).sort().at(-1);
    unique.set(key,{...preferred,url:key,discoveredAt,
      ...(firstSeenAt?{firstSeenAt,lastSeenAt,retainedFromHistory:[old,item].filter(x=>x.lastSeenAt).every(x=>x.retainedFromHistory===true)}:{}),
      energy:old.energy===true||item.energy===true,actors:[...new Set([...(old.actors||[]),...(item.actors||[])])],relevanceScopes:[...new Set([...(old.relevanceScopes||[]),...(item.relevanceScopes||[])])],
      provenance:entries.filter((x,i,a)=>a.findIndex(y=>y.sourceId===x.sourceId&&y.url===x.url)===i)});
  }
  return [...unique.values()].sort((a,b)=>observed(b).localeCompare(observed(a))||a.url.localeCompare(b.url));
}
function upgradePublisherCache(source){
  // Keep the original cache paths so a first-run outage can still show the
  // previously retrieved publisher records. Old caches contained headlines only.
  const items=(source.items||[]).map(item=>{
    const normalized={...item,publisher:item.publisher||item.source,summary:publisherSummary(item.summary||'',280)||null,discoveredAt:item.discoveredAt||null,eventDate:null,dateBasis:item.dateBasis||(item.publishedAt?'publisher-publication':'publication-unknown'),publicationPrecision:item.publicationPrecision||(item.publishedAt?'timestamp':'unknown'),contentAccess:item.contentAccess||(item.summary?'publisher-summary':'headline-only')};
    return {...normalized,...classifyReport(normalized)};
  }).filter(item=>safeUrl(item.url)&&reportRelevant(item));
  return {...source,items,recordCount:items.length,latestRelevant:newest(items)};
}
export async function loadReporting(runtime,config={},context={}){
  const feeds=await Promise.all(SOURCES.map(source=>runtime.get(source.id,source.interval,async({fetchText})=>{
    let all;
    if(source.id==='aj'){
      // The short global RSS window can rotate past current theatre reporting.
      // Refresh both publisher surfaces together; either failure retains the
      // previous complete snapshot with its original retrieval timestamp.
      const [rss,index]=await Promise.all([fetchText(source.url),fetchText(AL_JAZEERA_INDEX)]);
      // RSS comes first so its explicit publication timezone wins on duplicates.
      all=deduplicateReports([...parseRSS(rss,source,runtime.now()),...parseAlJazeeraIndex(index,runtime.now())]);
    }else all=parseRSS(await fetchText(source.url),source,runtime.now());
    const items=all.filter(reportRelevant);
    return {items,...sourceSummary(items,all),type:source.type,access:source.id==='aj'?'Publisher RSS + public regional index':'Publisher RSS',publicationPrecision:source.id==='aj'?'mixed':'timestamp'};
  },context,source.id)));
  const raw=feeds.map(upgradePublisherCache);
  const current=deduplicateReports(raw.flatMap(source=>source.items||[]));
  const history=config.reportArchive?await config.reportArchive.merge(current,{observedAtBySource:Object.fromEntries(raw.map(source=>[source.id,source.retrievedAt]))}):{items:current,archive:null};
  // Apply current relevance rules to retained metadata too, without changing
  // its publication or retrieval clocks or erasing the stored archive.
  const retained=history.items.map(item=>{const normalized={...item,summary:publisherSummary(item.summary||'',280)||null};return {...normalized,...classifyReport(normalized)};}).filter(reportRelevant);
  const items=deduplicateReports(retained).map(withEvidenceKind);
  const sources=raw.map(source=>health(source.id,source,config,runtime.now()));
  const summary=coverage(sources);
  summary.truncated ||= !!history.archive?.truncated;
  summary.incomplete ||= summary.truncated||!!history.archive?.error;
  summary.retainedCount=items.filter(item=>item.retainedFromHistory).length;
  summary.clockUnknown ||= items.some(item=>!item.publishedAt&&!item.publishedDate);
  summary.incomplete ||= summary.clockUnknown;
  if(summary.incomplete&&summary.usable)summary.label='Incomplete coverage · retrieved reports only';
  return {items,sources,generatedAt:new Date(runtime.now()).toISOString(),capabilities:SOURCE_CAPABILITIES,coverage:{...summary,complete:false,basis:'Retrieved publisher metadata and retained history; not a complete event record',publisherSources:sources.filter(s=>s.group==='news'&&s.configured).length,publicationKnown:items.filter(x=>!!(x.publishedAt||x.publishedDate)).length,publicationUnknown:items.filter(x=>!x.publishedAt&&!x.publishedDate).length,archive:history.archive}};
}
