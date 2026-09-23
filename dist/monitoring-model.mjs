import {canonicalReportUrl} from './intelligence-data.mjs';
import {inReportingWindow,matchesTheater,reportRelevant,sortReports} from './reporting-view.mjs';

export const MONITORING_STORAGE_KEY='passage-monitoring-v1';
export const THEATER_NAMES={both:'Both theatres',bab:'Bab el-Mandeb',hormuz:'Strait of Hormuz'};
export const WATCH_ACTORS=['Houthis','Iran','IRGC','U.S. military','Saudi Arabia','UAE','Oman','Iraq','Kuwait','Qatar','Egypt','Israel','Maritime coalitions','Merchant shipping','Civilians','Other forces'];
const IMPACT_RULES=[
  ['vessel attack',/attack\w*|missile\w*|drone\w*|seiz\w*|hijack\w*|board\w*|explosion\w*/i],
  ['rerouting & time',/rerout\w*|cape of good hope|divert\w*|delay\w*|transit time/i],
  ['route exposure',/shipping lane|merchant ship\w*|commercial ship\w*|cargo ship\w*|transit\w*|chokepoint/i],
  ['port / terminal',/port\w*|terminal\w*|anchorage|refiner\w*|storage\w*/i],
  ['pipeline bypass',/pipeline|east-west|sumed/i],
  ['insurance & freight',/insurance|premium|freight|war risk|shipping cost/i],
  ['production / exports',/production|export\w*|supply|outage|opec|crude|tanker|oil price|brent|wti/i],
  ['crew & civilian safety',/civilian|seafarer|crew|mariner|humanitarian|aid|injur\w*|killed|fatalit\w*/i],
];
export function impactTags(text=''){return IMPACT_RULES.filter(([,pattern])=>pattern.test(text)).map(([label])=>label);}
const LIMIT=1200,SEEN_LIMIT=5000;
const day=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&day(value.slice(0,10))&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const urlOf=report=>canonicalReportUrl(report?.url);
const cleanRows=rows=>{
  const unique=new Map();
  for(const row of Array.isArray(rows)?rows:[]){const url=urlOf(row);if(url&&typeof row.title==='string'&&!unique.has(url))unique.set(url,{...row,url});if(unique.size>=LIMIT)break;}
  return [...unique.values()];
};
const validWatch=(type,value)=>type==='theater'?['bab','hormuz'].includes(value):type==='actor'&&WATCH_ACTORS.includes(value);
const cleanSeen=value=>Object.fromEntries(Object.entries(value&&typeof value==='object'?value:{}).map(([url,at])=>[canonicalReportUrl(url),timestamp(at)]).filter(([url,at])=>url&&at).sort((a,b)=>b[1].localeCompare(a[1])).slice(0,SEEN_LIMIT));
export function normalizeMonitoringSettings(stored={}){
  if(!stored||typeof stored!=='object')stored={};
  const watches=new Map();
  for(const watch of Array.isArray(stored.watches)?stored.watches.slice(0,30):[]){
    if(!validWatch(watch?.type,watch?.value))continue;
    const id=watch.type+':'+watch.value;
    watches.set(id,{id,type:watch.type,value:watch.value,createdAt:timestamp(watch.createdAt),knownUrls:[...new Set((Array.isArray(watch.knownUrls)?watch.knownUrls:[]).slice(0,LIMIT).map(canonicalReportUrl).filter(Boolean))]});
  }
  return {version:1,acknowledgedAt:timestamp(stored.acknowledgedAt),seen:cleanSeen(stored.seen),watches:[...watches.values()]};
}

export function sinceLastLook(rows,settings,now=Date.now()){
  const baseline=timestamp(settings?.acknowledgedAt);if(!baseline)return [];
  return cleanRows(rows).filter(row=>!settings?.seen?.[row.url]).map(report=>{
    const published=report.publicationPrecision==='day'?null:timestamp(report.publishedAt);
    const publishedDay=day(report.publishedDate||report.publicationDate||report.publishedAt?.slice(0,10));
    const retrieved=timestamp(report.firstSeenAt),newRetrieval=retrieved&&retrieved>baseline&&Date.parse(retrieved)<=now;
    let kind='publication-unknown',label='New to this browser · publication unknown';
    if(published&&Date.parse(published)<=now+300000){
      kind=published>baseline?'new-publication':'older-publication';
      label=kind==='new-publication'?'Published since your last review':newRetrieval?'Newly retrieved · older publication':'New to this browser · older publication';
    }else if(publishedDay&&Date.parse(publishedDay)<=now&&(!published||Date.parse(published)<=now+300000)){
      kind=publishedDay>baseline.slice(0,10)?'new-publication':publishedDay===baseline.slice(0,10)?'publication-day':'older-publication';
      label=kind==='new-publication'?'Publication date after your last review':kind==='publication-day'?'Same publication day · exact time unknown':newRetrieval?'Newly retrieved · older publication date':'New to this browser · older publication date';
    }
    return {report,kind,label,firstRetrievedAt:retrieved};
  });
}

// Headline matches are a display aid, never an inference about a shared event,
// syndication or independent confirmation. Known publication days stay separate.
export function groupReporting(rows){
  const groups=[],urls=new Map(),headlines=new Map(),knownDays=new Map();
  const records=(Array.isArray(rows)?rows:[]).map(report=>{
    const title=String(report.title||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const date=day(report.publishedDate||report.publicationDate||report.publishedAt?.slice(0,10));
    if(date){if(!knownDays.has(title))knownDays.set(title,new Set());knownDays.get(title).add(date);}
    return {report,title,date,url:urlOf(report)};
  });
  for(const {report,title,date,url} of records){
    if(!url)continue;
    const dates=knownDays.get(title),dateGroup=date||(dates?.size===1?[...dates][0]:'unknown');
    const key=title.length>=40?JSON.stringify([title,dateGroup]):null;
    let group=urls.get(url)||(key&&headlines.get(key));
    if(!group){group={id:url,title:report.title,reports:[],kind:'single-report',independentConfirmation:false};groups.push(group);}
    if(group.reports.length)group.kind=group.reports.some(row=>urlOf(row)!==url)?'matching-headlines':'same-link';
    group.reports.push(report);urls.set(url,group);if(key)headlines.set(key,group);
  }
  return groups;
}

export function replayReporting(rows,at,now=Date.now()){
  const cutoff=typeof at==='number'?at:Date.parse(at),validCutoff=Number.isFinite(cutoff)?Math.min(cutoff,now):now;
  let excludedWithoutRetrieval=0,laterCount=0;
  const items=cleanRows(rows).filter(row=>{
    const retrieved=timestamp(row.firstSeenAt);
    if(!retrieved||Date.parse(retrieved)>now){excludedWithoutRetrieval++;return false;}
    if(Date.parse(retrieved)>validCutoff){laterCount++;return false;}return true;
  }).sort((a,b)=>a.firstSeenAt.localeCompare(b.firstSeenAt)||a.url.localeCompare(b.url));
  return {items,excludedWithoutRetrieval,laterCount,at:new Date(validCutoff).toISOString(),scope:'Retained reporting archive only. This shows when links first entered the local archive, using their latest retained metadata. It does not replay vessel positions, market prices or past source health.'};
}

export function createWatch(type,value,rows=[],now=Date.now()){
  if(!validWatch(type,value))return null;
  return {id:type+':'+value,type,value,createdAt:new Date(now).toISOString(),knownUrls:cleanRows(rows).map(row=>row.url)};
}
export function watchMatches(rows,watch,settings={}){
  if(!validWatch(watch?.type,watch?.value))return [];
  const baseline=new Set(watch.knownUrls||[]);
  return cleanRows(rows).filter(row=>!baseline.has(row.url)&&!settings.seen?.[row.url]&&(watch.type==='theater'?row.theaters?.includes(watch.value):row.actors?.includes(watch.value)));
}
export function filterMonitoringReports(rows,state={},now=Date.now()){
  return cleanRows(rows).filter(row=>
    (state.view==='saved'||reportRelevant(row))&&
    matchesTheater(row,state.theater||'both')&&
    (state.actor==='All'||!state.actor||row.actors?.includes(state.actor))&&
    inReportingWindow(row,state.hours||'all',now)&&
    (!state.query||[row.title,row.summary,row.reviewedContext?.summary,row.source].filter(Boolean).join(' ').toLowerCase().includes(state.query.toLowerCase()))&&
    (state.view!=='civilian'||row.actors?.includes('Civilians')||impactTags(row.title).length>0)&&
    (state.view!=='energy'||row.energy||row.relevanceScopes?.some(scope=>['regional-energy','global-energy'].includes(scope)))
  );
}
export function buildBrief(state={},now=Date.now()){
  const rows=state.view==='saved'?Object.values(state.saved||{}):state.news?.items;
  const reports=filterMonitoringReports(rows,state,now).sort(sortReports).slice(0,5);
  const prices=(state.oil?.series||[]).slice(0,4).map(series=>{
    const observations=(series.observations||[]).filter(p=>day(p.date)&&Date.parse(p.date)<=now&&Number.isFinite(p.value)).sort((a,b)=>a.date.localeCompare(b.date));
    const latest=observations.at(-1),previous=observations.at(-2);if(!latest)return null;
    return {id:series.id,name:series.name||series.id,...latest,change:previous?latest.value-previous.value:null,previousDate:previous?.date||null,url:canonicalReportUrl(series.url),status:series.label||series.connection||'Source status unavailable'};
  }).filter(Boolean);
  const scope=THEATER_NAMES[state.theater]||THEATER_NAMES.both;
  const speech=[`${scope}. Source-linked brief.`,...reports.map(row=>`${row.source||'Publisher'} ${row.type==='Independent energy analysis'?'analysis':'reports'}: ${row.title}.`),...prices.map(p=>`${p.name} daily spot observation: ${p.value.toFixed(2)} US dollars per barrel, for ${p.date}.`),'These are retrieved headlines and delayed daily observations, not independently verified events or live market quotes.'].join(' ');
  return {scope,reports,prices,speech,generatedAt:new Date(now).toISOString()};
}

export function createMonitoringSession({stored,now=Date.now}={}){
  let settings=normalizeMonitoringSettings(stored),news=null,latest=null;
  const pending=new Map();
  return {
    ingestNews(incoming){
      if(!incoming||!Array.isArray(incoming.items))return news||incoming;
      const items=cleanRows(incoming.items);latest={...incoming,items};
      if(!news){news=latest;return news;}
      const accepted=new Set(news.items.map(urlOf)),current=new Map(items.map(row=>[row.url,row]));
      pending.clear();for(const row of items)if(!accepted.has(row.url))pending.set(row.url,row);
      news={...incoming,items:news.items.slice(0,LIMIT).map(row=>current.get(row.url)||{...row,retainedForReading:true})};return news;
    },
    acceptPending(){if(latest)news={...latest,items:[...latest.items]};pending.clear();return news;},
    pending:()=>[...pending.values()],
    retained:()=>news?.items.filter(row=>row.retainedForReading)||[],
    news:()=>news,
    all:()=>latest?.items||news?.items||[],
    changes:()=>sinceLastLook(news?.items||[],settings,now()),
    settings:()=>structuredClone(settings),
    acknowledge(rows=news?.items||[]){const at=new Date(now()).toISOString();settings={...settings,acknowledgedAt:at,seen:cleanSeen({...settings.seen,...Object.fromEntries(cleanRows(rows).map(row=>[row.url,at]))})};return this.settings();},
    addWatch(type,value){const watch=createWatch(type,value,this.all(),now());if(watch&&!settings.watches.some(x=>x.id===watch.id)&&settings.watches.length<30)settings.watches.push(watch);return this.settings();},
    removeWatch(id){settings.watches=settings.watches.filter(watch=>watch.id!==id);return this.settings();},
  };
}
