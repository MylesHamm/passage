import {SOURCES,parseRSS,classify,classifyReport,safeUrl,reportRelevant} from './feeds.mjs';
import {parseCentcomIndex,CENTCOM_INDEX} from './centcom.mjs';
import {loadDiscovery,DISCOVERY_SOURCES,DISCOVERY_LIMIT} from './discovery.mjs';
import {COVERAGE_NOTES} from '../dist/intelligence-context.mjs';
import {analysisLabels,analysisRecordPriority} from '../dist/intelligence-data.mjs';
import {SOURCE_DEFINITIONS,sourceHealth} from '../dist/source-health.mjs';
import {SourceError} from './source-runtime.mjs';

const newest=items=>items.map(x=>x.publishedAt).filter(x=>typeof x==='string'&&Number.isFinite(Date.parse(x))).sort().at(-1)||null;
const observed=item=>item.publishedAt||item.publishedDate||item.discoveredAt||'';
function health(id,data,config,now){
  const def=SOURCE_DEFINITIONS.find(source=>source.id===id),{items,...meta}=data;
  return sourceHealth({...def,...meta,name:def.name,configured:def.optional?!!config[def.optional]:true,connection:data.connection||'loading'},now);
}
function sourceSummary(items,all=items){return {recordCount:items.length,parsedCount:all.length,latest:newest(all),latestRelevant:newest(items)};}
export function deduplicateReports(records){
  const unique=new Map();
  for(const input of records){
    const item={...input,...analysisLabels(input)};
    const key=safeUrl(item.url);if(!key)continue;const old=unique.get(key);
    const provenance={sourceId:item.sourceId,publisher:item.publisher||item.source,contentAccess:item.contentAccess||'headline-only',dateBasis:item.dateBasis||'publisher-publication',publishedAt:item.publishedAt||null,discoveredAt:item.discoveredAt||null,url:key};
    const inherited=(item.provenance||[]).map(p=>({...p,url:safeUrl(p.url)})).filter(p=>p.url);
    if(!old){unique.set(key,{...item,url:key,provenance:inherited.length?inherited:[provenance]});continue;}
    const oldPriority=analysisRecordPriority(old),newPriority=analysisRecordPriority(item);
    const analysis=oldPriority||newPriority?(newPriority>oldPriority?item:old):null;
    const preferred=analysis||((item.publishedAt||item.publishedDate)&&!(old.publishedAt||old.publishedDate)?item:old);
    const entries=[...old.provenance,...inherited,provenance];
    const discoveredAt=entries.map(x=>x.discoveredAt).filter(Boolean).sort()[0]||null;
    const review=[old,item].find(x=>x.sourceId==='reviewed-reporting');
    const reviewedContext=preferred.sourceId==='reviewed-reporting'?null:old.reviewedContext||item.reviewedContext||(review?{title:review.title,summary:review.summary,watch:review.watch,publishedDate:review.publishedDate,readAt:review.readAt,attributionNote:review.attributionNote}:null);
    const firstSeenAt=[old.firstSeenAt,item.firstSeenAt].filter(Boolean).sort()[0];
    const lastSeenAt=[old.lastSeenAt,item.lastSeenAt].filter(Boolean).sort().at(-1);
    unique.set(key,{...preferred,...analysisLabels(old,item),url:key,discoveredAt,
      ...(firstSeenAt?{firstSeenAt,lastSeenAt,retainedFromHistory:[old,item].filter(x=>x.lastSeenAt).every(x=>x.retainedFromHistory===true)}:{}),
      ...(reviewedContext?{reviewedContext}:{}),
      energy:old.energy===true||item.energy===true,actors:[...new Set([...(old.actors||[]),...(item.actors||[])])],relevanceScopes:[...new Set([...(old.relevanceScopes||[]),...(item.relevanceScopes||[])])],
      provenance:entries.filter((x,i,a)=>a.findIndex(y=>y.sourceId===x.sourceId&&y.url===x.url)===i)});
  }
  return [...unique.values()].sort((a,b)=>observed(b).localeCompare(observed(a))||a.url.localeCompare(b.url));
}
function normalizeCentcom(record){
  return {...record,publisher:record.source,summary:null,discoveredAt:null,dateBasis:'publisher-date',eventDate:null,contentAccess:'headline-only',...classify(record.title+' CENTCOM',record.title)};
}
function upgradePublisherCache(source){
  // Keep the original cache paths so a first-run outage can still show the
  // previously retrieved publisher records. Old caches contained headlines only.
  const items=(source.items||[]).map(item=>{
    if(source.id==='centcom')return normalizeCentcom(item);
    const normalized={...item,publisher:item.publisher||item.source,summary:item.summary||null,discoveredAt:item.discoveredAt||null,eventDate:null,dateBasis:item.dateBasis||(item.publishedAt?'publisher-publication':'publication-unknown'),publicationPrecision:item.publicationPrecision||(item.publishedAt?'timestamp':'unknown'),contentAccess:item.contentAccess||(item.summary?'publisher-summary':'headline-only'),...analysisLabels(item)};
    return {...normalized,...classifyReport(normalized)};
  }).filter(item=>safeUrl(item.url)&&reportRelevant(item));
  return {...source,items,recordCount:items.length,latestRelevant:newest(items)};
}
async function loadReliefWeb(runtime,config,context){
  if(!config.reliefweb)return {id:'reliefweb',connection:'not configured',recordCount:0,items:[]};
  return runtime.get('reliefweb',900,async({fetchText})=>{
    const appname=config.reliefwebAppname||process.env.RELIEFWEB_APPNAME;if(!appname)throw new SourceError('auth');
    const u=new URL('https://api.reliefweb.int/v2/reports');
    // https://apidoc.reliefweb.int/parameters#appname — approved appname is a
    // server-side request parameter; it never becomes an article URL or log field.
    for(const [key,value] of Object.entries({appname,'query[value]':'Yemen OR Iran OR Hormuz OR "Red Sea" OR Saudi OR Oman OR UAE',limit:'30',preset:'latest',profile:'list'}))u.searchParams.set(key,value);
    const payload=JSON.parse(await fetchText(u));if(!Array.isArray(payload.data))throw new SourceError('schema');
    const all=payload.data.map(row=>{
      const fields=row?.fields;if(!fields||typeof fields.title!=='string')return null;
      const url=safeUrl(fields.url),ms=Date.parse(fields.date?.created);
      if(!url||!Number.isFinite(ms)||ms>runtime.now()+60000)return null;
      return {id:'rw-'+row.id,title:fields.title.slice(0,500),url,summary:null,publishedAt:new Date(ms).toISOString(),discoveredAt:null,publicationPrecision:'timestamp',dateBasis:'publisher-publication',eventDate:null,source:'ReliefWeb',publisher:'ReliefWeb',sourceId:'reliefweb',type:'Humanitarian report',contentAccess:'headline-only',...classify(fields.title)};
    }).filter(Boolean),items=all.filter(reportRelevant);
    return {type:'Humanitarian report',items,...sourceSummary(items,all),access:'ReliefWeb API · metadata only'};
  },context,'reliefweb');
}
export async function loadReporting(runtime,config={},context={}){
  // Discovery is coalesced and serialized in the background; slow discovery
  // cannot keep the established publisher feeds behind a 4-request timeout.
  const discovery=loadDiscovery(runtime,context,{waitMs:config.discoveryWaitMs??600,spacingMs:config.discoverySpacingMs??6000});
  const publishers=Promise.all(SOURCES.map(source=>runtime.get(source.id,source.interval,async({fetchText})=>{
    const all=source.id==='centcom'?parseCentcomIndex(await fetchText(CENTCOM_INDEX),runtime.now()).map(normalizeCentcom):parseRSS(await fetchText(source.url),source,runtime.now());
    const items=all.filter(reportRelevant);
    return {items,...sourceSummary(items,all),type:source.type,access:source.publicPreviewOnly?'Public RSS · free previews only':source.id==='centcom'?'Official public release index · dates only':'Publisher RSS',publicationPrecision:source.id==='centcom'?'day':'timestamp'};
  },context,source.id==='centcom'?'centcom-index':source.id)));
  const [feeds,reliefweb,indexes]=await Promise.all([publishers,loadReliefWeb(runtime,config,context),discovery]);
  const raw=[...feeds.map(upgradePublisherCache),upgradePublisherCache(reliefweb),...indexes.map(upgradePublisherCache)];
  const current=deduplicateReports(raw.flatMap(source=>source.items||[]));
  const history=config.reportArchive?await config.reportArchive.merge(current,{observedAtBySource:Object.fromEntries(raw.map(source=>[source.id,source.retrievedAt]))}):{items:current,archive:null};
  // Reviewed notes are explicitly dated context. They are not counted as live
  // source retrievals and cannot give an old publisher snapshot a new timestamp.
  const reviewed=(config.includeReviewedContext===false?[]:COVERAGE_NOTES).filter(item=>Date.parse(item.readAt+'T00:00:00Z')<=runtime.now()).map(item=>({
    ...classify(item.title+' '+item.summary,item.title),...item,publisher:item.source,type:'Reviewed context',publicationPrecision:item.publicationPrecision||'day',
  }));
  // Apply current relevance rules to retained metadata too, without changing
  // its publication or retrieval clocks or erasing the stored archive.
  const retained=history.items.map(item=>{const normalized={...item,...analysisLabels(item)};return {...normalized,...classifyReport(normalized)};}).filter(reportRelevant);
  const items=deduplicateReports([...retained,...reviewed]);
  const sources=raw.map(source=>health(source.id,source,config,runtime.now()));
  return {items,sources,generatedAt:new Date(runtime.now()).toISOString(),coverage:{complete:false,basis:config.includeReviewedContext===false?'Retrieved publisher metadata and retained history; not a complete event record':'Retrieved publisher metadata, retained history and dated reviewed context; not a complete event record',publisherSources:sources.filter(s=>s.group==='news'&&s.configured).length,discoveryFamilies:DISCOVERY_SOURCES.length,discoveryWindowDays:7,discoveryLimitPerFamily:DISCOVERY_LIMIT,discoveryPending:sources.some(s=>s.group==='discovery'&&s.status==='loading'),possiblyTruncatedFamilies:raw.filter(s=>s.possiblyTruncated).map(s=>s.id),publicationKnown:items.filter(x=>!!(x.publishedAt||x.publishedDate)).length,publicationUnknown:items.filter(x=>!x.publishedAt&&!x.publishedDate).length,nextDiscoveryPollSeconds:30,archive:history.archive,reviewedCount:reviewed.length,reuters:{mode:'public-discovery',directFeedConnected:false,topicPreferencesConnected:false},attribution:{label:'Discovery powered by The GDELT Project',url:'https://www.gdeltproject.org/'}}};
}
