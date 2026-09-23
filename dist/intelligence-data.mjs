import {ACTORS,cleanText,dateOnly,publicUrl} from './research-data.mjs';
import {MECHANISMS,oilMechanisms} from './situation-data.mjs';
import {MARKET_CONTEXT} from './energy-context.mjs';
import {COVERAGE_NOTES,COVERAGE_REVIEW_DATE,ENERGY_ASSETS} from './intelligence-context.mjs';

export const INTELLIGENCE_SCHEMA='passage-evidence/v1';
const DAY=86400000;
const EXTRA_ACTORS=[
  {id:'us-government',label:'U.S. government',pattern:/\b(?:trump|white house|u\.s\. government|state department)\b/ig},
  {id:'iraq',label:'Iraq',pattern:/\b(?:iraq|iraqi|basra)\b/ig},
  {id:'kuwait',label:'Kuwait',pattern:/\b(?:kuwait|kuwaiti)\b/ig},
  {id:'qatar',label:'Qatar',pattern:/\b(?:qatar|qatari)\b/ig},
  {id:'egypt',label:'Egypt',pattern:/\b(?:egypt|egyptian)\b/ig},
  {id:'opec',label:'OPEC / OPEC+',pattern:/\bopec(?:\+)?/ig},
];
const ACTOR_CATALOG=[...ACTORS.filter(a=>a.id!=='other-forces').map(a=>({...a,pattern:new RegExp('\\b(?:'+a.pattern.source+')\\b','ig')})),...EXTRA_ACTORS];
const DIPLOMACY={id:'diplomacy',name:'Diplomacy & restrictions',explanation:'Negotiations, sanctions and navigation agreements can change access expectations. An announcement is not an implemented agreement or measured oil effect.',basis:'Potential channel; effect not measured'};
const validInstant=(value,now)=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&dateOnly(value.slice(0,10))&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now+300000?new Date(value).toISOString():null;

export function canonicalReportUrl(value) {
  const safe=publicUrl(value);if(!safe)return null;
  const url=new URL(safe);
  if(!url.hostname.includes('.')||/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname))return null;
  if(/^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname)||[...url.searchParams.keys()].some(k=>/^(api[_-]?key|access[_-]?token|token|password|secret|authorization|signature|key)$/i.test(k)))return null;
  url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_|^(?:fbclid|gclid|mc_cid|mc_eid|lctg|user_email)$/i.test(key))url.searchParams.delete(key);
  return url.href;
}

function validDay(value,now){const day=dateOnly(value);return day&&Date.parse(day+'T00:00:00Z')<=now?day:null;}
export function reportClock(record){
  if(record.publicationPrecision==='day'&&(record.publishedDate||record.publicationDate||record.publishedAt))return {value:record.publishedDate||record.publicationDate||record.publishedAt.slice(0,10),label:'Publication date'};
  if(record.publishedAt)return {value:record.publishedAt,label:'Published'};
  if(record.publishedDate)return {value:record.publishedDate,label:'Publication date'};
  if(record.discoveredAt)return {value:record.discoveredAt,label:'Discovered · publication unknown'};
  return {value:null,label:'Date unknown'};
}

const ANALYSIS_TYPE='Independent energy analysis';
function analysisPublisher(record){
  const url=canonicalReportUrl(record?.url);
  return url&&new URL(url).hostname==='newsletter.doomberg.com'?'Doomberg':null;
}
// Editorial category and retrieval access are separate: a known analysis URL
// stays analysis in an index, but its direct publisher record is richer evidence.
export function analysisRecordPriority(record){
  if(!record||record.manual||record.type!==ANALYSIS_TYPE&&!analysisPublisher(record))return 0;
  return record.contentAccess==='discovery-metadata'||String(record.sourceId||'').startsWith('gdelt-')?1:2;
}
export function analysisLabels(...records){
  const record=records.reduce((best,value)=>analysisRecordPriority(value)>analysisRecordPriority(best)?value:best,null);
  if(!record)return {};
  const publisher=analysisPublisher(record);
  return {type:ANALYSIS_TYPE,evidenceStatus:(record.type===ANALYSIS_TYPE?cleanText(record.evidenceStatus,160):'')||'Independent energy analysis; not incident verification',...(publisher?{source:publisher,publisher}:{})};
}

export function normalizeManualReport(input,now=Date.now()) {
  const url=canonicalReportUrl(input?.url),title=cleanText(input?.title,400);
  if(!url)throw new Error('Enter a public article URL without credentials or secret parameters.');
  if(!title)throw new Error('Add a title so you can find this source again.');
  const publishedDate=input.publishedDate?validDay(input.publishedDate,now):null;
  if(input.publishedDate&&!publishedDate)throw new Error('Use a valid publication date that is not in the future.');
  return {id:'manual:'+url,url,title,source:cleanText(input.publisher||input.source,100)||new URL(url).hostname,
    publishedAt:null,publishedDate,discoveredAt:null,addedAt:validInstant(input.addedAt,now)||new Date(now).toISOString(),
    summary:cleanText(input.note||input.summary,1000),contentAccess:'User-supplied link and note; article not fetched',
    dateBasis:publishedDate?'User-entered publication date':'Publication date unknown',evidenceStatus:'User-supplied context',
    relevanceScope:'analyst-included',theaters:[],manual:true};
}

function normalizeReport(input,now) {
  const url=canonicalReportUrl(input?.url),title=cleanText(input?.title,500);if(!url||!title)return null;
  const publishedAt=validInstant(input.publishedAt,now),publishedDate=validDay(input.publishedDate||input.publicationDate,now),discoveredAt=validInstant(input.discoveredAt,now);
  if(input.publishedAt&&!publishedAt||input.publishedDate&&!publishedDate||input.discoveredAt&&!discoveredAt)return null;
  return {id:cleanText(input.id,600)||url,url,title,source:cleanText(input.source||input.publisher,120)||new URL(url).hostname,
    sourceId:cleanText(input.sourceId,100),type:cleanText(input.type,100),publishedAt,publishedDate,discoveredAt,publicationPrecision:cleanText(input.publicationPrecision,30)|| (publishedAt?'timestamp':publishedDate?'day':'unknown'),
    provenance:(input.provenance||[]).slice(0,12).map(p=>({sourceId:cleanText(p.sourceId,100),publisher:cleanText(p.publisher,120),url:canonicalReportUrl(p.url),publishedAt:validInstant(p.publishedAt,now),discoveredAt:validInstant(p.discoveredAt,now),dateBasis:cleanText(p.dateBasis,100)})).filter(p=>p.url),
    matchEvidence:(input.matchEvidence||[]).slice(0,40).map(m=>({kind:cleanText(m.kind,50),value:cleanText(m.value,100),field:cleanText(m.field,50),basis:cleanText(m.basis,200)})),
    updatedAt:validInstant(input.updatedAt,now),retrievedAt:validInstant(input.retrievedAt,now),addedAt:validInstant(input.addedAt,now),
    firstSeenAt:validInstant(input.firstSeenAt,now),lastSeenAt:validInstant(input.lastSeenAt,now),retainedFromHistory:input.retainedFromHistory===true,
    summary:cleanText(input.summary,1000),watch:cleanText(input.watch,600),
    discoveryProvider:cleanText(input.discoveryProvider,80),discoveryUrl:canonicalReportUrl(input.discoveryUrl),
    contentAccess:cleanText(input.contentAccess,200)||'Headline metadata only',
    evidenceStatus:cleanText(input.evidenceStatus,160)||'Publisher reporting; not independently verified',...analysisLabels(input),
    dateBasis:cleanText(input.dateBasis,150)||(!publishedAt&&!publishedDate?'Publication time unknown':'Publisher date'),
    theaters:(input.theaters||[]).filter(x=>['bab','hormuz'].includes(x)),
    relevanceScopes:(input.relevanceScopes||[input.relevanceScope||'theater']).filter(x=>['theater','regional-energy','global-energy','analyst-included'].includes(x)),
    relevanceScope:cleanText(input.relevanceScope,60)||input.relevanceScopes?.[0]||'theater',manual:input.manual===true,
    originatingWire:cleanText(input.originatingWire,100)||null,accessedVia:canonicalReportUrl(input.accessedVia),
    attributionNote:cleanText(input.attributionNote,400),readAt:validDay(input.readAt,now),forecastCompleted:validDay(input.forecastCompleted,now)};
}

function collectGraph(now) {
  const nodes=new Map(),edges=new Map();
  const node=(value)=>{if(!nodes.has(value.id))nodes.set(value.id,value);return nodes.get(value.id);};
  const edge=(from,to,relation,meta={})=>{const id=JSON.stringify([from,to,relation,meta.sourceUrl||'']);if(!edges.has(id))edges.set(id,{id,from,to,relation,...meta});};
  function context(sourceNode,record,{event=false}={}) {
    const fields=[['headline',record.title],['summary',record.summary]];
    const meta={sourceUrl:record.url,evidenceStatus:event?'Source event record':record.evidenceStatus,publishedAt:record.publishedAt||null,publishedDate:record.publishedDate||null,discoveredAt:record.discoveredAt||null,eventDate:record.eventDate||null};
    for(const actor of ACTOR_CATALOG) {
      const hit=fields.map(([field,text])=>({field,text:cleanText(text,2000).match(actor.pattern)?.[0]})).find(x=>x.text);
      if(!hit)continue;
      const target=node({id:'actor:'+actor.id,type:'actor',label:actor.label,record:{actorId:actor.id,kind:'Mentioned actor or group',basis:'Text mention; no affiliation or responsibility inferred'}});
      edge(sourceNode.id,target.id,'MENTIONS',{...meta,basis:record.manual?'user note · unverified':hit.field+' text match',matchedText:hit.text});
    }
    for(const asset of ENERGY_ASSETS) {
      const hit=fields.map(([field,text])=>({field,text:cleanText(text,2000).match(asset.pattern)?.[0]})).find(x=>x.text);
      if(!hit)continue;
      const target=node({id:'asset:'+asset.id,type:'asset',label:asset.label,record:{assetId:asset.id,kind:asset.kind,basis:asset.basis,theaters:asset.theaters}});
      edge(sourceNode.id,target.id,'MENTIONS',{...meta,basis:hit.field+' text match',matchedText:hit.text});
    }
    const channels=oilMechanisms(record);
    if(/\b(?:talks|negotiat\w*|diploma\w*|sanction\w*|ceasefire|agreement|blockade)\b/i.test(record.title+' '+record.summary))channels.push(DIPLOMACY);
    for(const channel of channels) {
      const target=node({id:'channel:'+channel.id,type:'channel',label:channel.name,record:{channelId:channel.id,summary:channel.explanation,basis:channel.basis||'Potential channel; effect not measured'}});
      edge(sourceNode.id,target.id,'POTENTIAL_CHANNEL',{...meta,basis:'Rule-based mechanism to examine; effect not measured'});
    }
  }
  function report(input) {
    const record=normalizeReport(input,now);if(!record)return null;
    const id='report:'+record.url;
    const existing=nodes.get(id);
    if(existing){
      // Keep local annotations as annotations, rather than replacing publisher metadata.
      if(record.manual)existing.record.analystNote=record.summary;
      else {
        const previous=existing.record;
        // Archive observation clocks describe retrieval, independent of which
        // publisher version or reviewed assessment supplies the displayed text.
        const firstSeenAt=[previous.firstSeenAt,record.firstSeenAt].filter(Boolean).sort()[0]||null;
        const lastSeenAt=[previous.lastSeenAt,record.lastSeenAt].filter(Boolean).sort().at(-1)||null;
        const latestObservation=record.lastSeenAt&&(!previous.lastSeenAt||record.lastSeenAt>=previous.lastSeenAt)?record:previous;
        const retainedFromHistory=latestObservation.retainedFromHistory;
        const reviewedContext=previous.reviewedContext||(previous.readAt?{title:previous.title,summary:previous.summary,watch:previous.watch,publishedDate:previous.publishedDate,readAt:previous.readAt,attributionNote:previous.attributionNote}:null);
        // A rolling publisher URL can acquire new material; never attach the new
        // clock to a previous forecast or analyst summary.
        const provenance=[...previous.provenance,...record.provenance].filter((p,i,a)=>a.findIndex(x=>x.sourceId===p.sourceId&&x.url===p.url)===i);
        const firstDiscovery=[previous.discoveredAt,record.discoveredAt].filter(Boolean).sort()[0]||null;
        const previousPriority=analysisRecordPriority(previous),incomingPriority=analysisRecordPriority(record);
        const replacePublisher=incomingPriority!==previousPriority?incomingPriority>previousPriority:record.publishedAt&&(!previous.publishedAt||record.publishedAt>=previous.publishedAt);
        if(replacePublisher) {
          existing.record={...record,reviewedContext,provenance,relevanceScopes:[...new Set([...previous.relevanceScopes,...record.relevanceScopes])]};
          existing.label=record.title;existing.publishedAt=record.publishedAt;
        }else {previous.provenance=provenance;if(record.discoveredAt)previous.discoveredAt=record.discoveredAt;}
        const labels=analysisLabels(existing.record,previous,record);
        Object.assign(existing.record,{firstSeenAt,lastSeenAt,retainedFromHistory},labels);
        if(labels.type)existing.record.discoveredAt=firstDiscovery;
        existing.discoveredAt=existing.record.discoveredAt;
        if(labels.type){
          // Keep text matches and clocks attached to the retained preview, not
          // to a different headline supplied by a generic discovery index.
          const oldTargets=new Set();
          for(const [edgeId,connection] of edges)if(connection.from===existing.id&&['MENTIONS','POTENTIAL_CHANNEL'].includes(connection.relation)){oldTargets.add(connection.to);edges.delete(edgeId);}
          context(existing,existing.record);
          for(const target of oldTargets)if(![...edges.values()].some(connection=>connection.to===target||connection.from===target))nodes.delete(target);
        }else context(existing,record);
      }
      return existing;
    }
    const added=node({id,type:'report',label:record.title,sourceUrl:record.url,publishedAt:record.publishedAt,discoveredAt:record.discoveredAt,record});
    context(added,record);return added;
  }
  return {nodes,edges,node,edge,context,report};
}

export function buildIntelligence({news,maritime,acled,oil,now=Date.now(),includeReviewedContext=true}={}) {
  const g=collectGraph(now),sources=[...(news?.sources||[]),...(maritime?.sources||[]),...(acled?.source?[acled.source]:[]),...(oil?.series||[]).map(({observations,...meta})=>meta)];
  const reviewed=includeReviewedContext?[...COVERAGE_NOTES.filter(r=>Date.parse(r.readAt+'T00:00:00Z')<=now),...MARKET_CONTEXT.filter(r=>!COVERAGE_NOTES.some(c=>c.url===r.url)).map(r=>({...r,sourceId:'reviewed-reporting',publishedAt:null,contentAccess:'Curated source assessment',readAt:r.reviewedAt}))]:[];
  const mergedReports=[...reviewed,...(news?.items||[])];
  // Repeated URLs still merge evidence and provenance, but consume only one
  // report slot. Invalid records do not displace a valid report at the limit.
  const reportGroups=new Map();
  for(const report of mergedReports){const normalized=normalizeReport(report,now);if(!normalized)continue;if(!reportGroups.has(normalized.url))reportGroups.set(normalized.url,[]);reportGroups.get(normalized.url).push(report);}
  for(const group of [...reportGroups.values()].slice(0,1200))for(const report of group)g.report(report);
  const omittedReports=Math.max(0,reportGroups.size-1200);
  const conflict=(acled?.events||[]).filter(event=>/\b(?:oil|crude|petroleum|pipeline|refiner\w*|tankers?|ships?|shipping|vessels?|seafarers?|ports?|terminals?|hormuz|bab[ -](?:el|al)[ -]mand[ae]b|yanbu|fujairah|sumed|lng|diesel|fuel)\b/i.test([event.title,event.summary,event.notes,event.locationText].filter(Boolean).join(' ')));
  for(const [provider,list] of [['imo',maritime?.events||[]],['acled',conflict]])for(const event of [...list].sort((a,b)=>(b.eventDate||'').localeCompare(a.eventDate||'')).slice(0,500)) {
    const eventDate=validDay(event.eventDate,now),url=canonicalReportUrl(event.url);
    if(!url||!event.id||!eventDate)continue; // Statements without event dates become reports below.
    const id=`event:${provider}:${event.id}`,record={
      id:event.id,title:cleanText(event.title,500),summary:cleanText(event.summary||event.notes,1000),url,
      source:event.source|| (provider==='acled'?'ACLED':'IMO'),eventDate,eventDatePrecision:event.eventDatePrecision|| (event.timePrecision===1?'day':'Provider precision; see source'),
      evidenceStatus:event.evidenceStatus||'Structured source record',locationText:cleanText(event.locationText||[event.location,event.country].filter(Boolean).join(', '),600),
      locationPrecision:event.locationPrecision||'ACLED country context; not maritime geocoding',contentAccess:provider==='imo'?'Official source register':'Account-accessible structured record',
      theaters:(event.theaters||[]).filter(x=>['bab','hormuz'].includes(x)),publishedAt:null,
    };
    const n=g.node({id,type:'event',label:record.title||'Source event',sourceUrl:url,eventDate,record});g.context(n,record,{event:true});
    const source=g.report({id:'register:'+url,title:provider==='imo'?'IMO maritime incident register':'ACLED event source',url,source:record.source,sourceId:provider,contentAccess:'Source register; event dates are separate',theaters:[]});
    g.edge(source.id,n.id,'REPORTS_EVENT',{sourceUrl:url,basis:'Structured source record',eventDate,evidenceStatus:record.evidenceStatus});
  }
  for(const statement of maritime?.events||[])if(!statement.eventDate)g.report({...statement,publishedAt:null,contentAccess:'Official statement index; open source for details'});
  for(const series of oil?.series||[]) {
    const p=(series.observations||[]).filter(p=>validDay(p.date,now)&&Number.isFinite(p.value)).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
    if(!p||!['brent','wti'].includes(series.id))continue;
    const id=`market:eia:${series.id}:${p.date}`;
    g.node({id,type:'market',label:`${series.name||series.id} daily spot`,sourceUrl:series.url,record:{provider:'EIA',seriesId:series.id,observationDate:p.date,value:p.value,units:'USD/barrel',basis:'Daily spot observation; not intraday futures',summary:'Shared market context. Connections do not estimate the effect of an event.'}});
    for(const channel of [...MECHANISMS,DIPLOMACY])if(g.nodes.has('channel:'+channel.id))g.edge('channel:'+channel.id,id,'CONTEXT_FOR',{sourceUrl:series.url,basis:'Shared market context only; no causal attribution',evidenceStatus:'Observed daily price'});
  }
  return finishGraph(g,{sources,now,review:includeReviewedContext?undefined:null,coverage:{...news?.coverage,reportLimit:1200,omittedReports,eventLimitPerProvider:500,acledCountryScope:['Yemen','Iran'],omittedNonOilContextEvents:(acled?.events?.length||0)-conflict.length,bounded:omittedReports>0||conflict.length>500||!!acled?.truncated}});
}

function finishGraph(g,{sources=[],now=Date.now(),coverage,review=COVERAGE_REVIEW_DATE?{date:COVERAGE_REVIEW_DATE,needsReview:now-Date.parse(COVERAGE_REVIEW_DATE+'T00:00:00Z')>3*DAY}:null}={}) {
  const nodes=[...g.nodes.values()],edges=[...g.edges.values()];
  return {schemaVersion:INTELLIGENCE_SCHEMA,generatedAt:new Date(now).toISOString(),nodes,edges,sources,coverage,
    stats:{reports:nodes.filter(n=>n.type==='report').length,events:nodes.filter(n=>n.type==='event').length,entities:nodes.filter(n=>['actor','asset'].includes(n.type)).length,connections:edges.length},
    review,
    limits:['Text matches are retrieval links, not proof of responsibility, alliance or damage.','Potential oil channels do not measure an event’s price effect.','Discovery dates are not publication or event dates.','Syndicated versions of a wire report are not independent corroboration.','Free feeds are bounded and incomplete; full Reuters content and physical cargo flows are not connected.']};
}

export function mergeManualEvidence(baseGraph,manualRecords,now=Date.now()) {
  const g=collectGraph(now);
  for(const n of baseGraph.nodes||[])g.nodes.set(n.id,{...n,record:{...n.record}});
  for(const e of baseGraph.edges||[])g.edges.set(e.id,{...e});
  let rejected=0;
  for(const input of (Array.isArray(manualRecords)?manualRecords:Object.values(manualRecords||{})).slice(0,200)) {
    try{g.report(normalizeManualReport(input,now));}catch{rejected++;}
  }
  return {...baseGraph,...finishGraph(g,{sources:baseGraph.sources,now,coverage:baseGraph.coverage,review:baseGraph.review??null}),manualRejected:rejected};
}
