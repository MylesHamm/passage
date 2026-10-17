import {physicalClaimText} from './report-semantics.mjs';
// Shared, dependency-free research records. Also used by the server and integrity tests.
export const ACTORS = [
  {id:'houthis',label:'Houthis',pattern:/houthi\w*|ansar.?allah/ig},
  {id:'iran',label:'Iran',pattern:/iran\w*|irgc|tehran/ig},
  {id:'irgc',label:'IRGC',pattern:/irgc|islamic revolutionary guard|revolutionary guard/ig},
  {id:'us-military',label:'U.S. military',pattern:/u\.?s\.? (?:navy|military|forces|army|air force)|american (?:military|forces)|centcom|pentagon|united states (?:military|forces)|uss\s+\w+/ig},
  {id:'saudi-arabia',label:'Saudi Arabia',pattern:/saudi(?: arabia|an)?|aramco|east-west pipeline|yanbu/ig},
  {id:'uae',label:'UAE',pattern:/uae|united arab emirates|emirati|fujairah/ig},
  {id:'oman',label:'Oman',pattern:/oman(?:i)?|duqm/ig},
  {id:'israel',label:'Israel',pattern:/israel\w*|israeli/ig},
  {id:'maritime-coalitions',label:'Maritime coalitions',pattern:/eunavfor|aspides|combined maritime forces|coalition|royal navy|jmic|ukmto|mscio/ig},
  {id:'merchant-shipping',label:'Merchant shipping',pattern:/merchant ship\w*|commercial ship\w*|cargo ship\w*|tanker\w*|vessel\w*|seafarer\w*|mariner\w*|crew/ig},
  {id:'civilians',label:'Civilians',pattern:/civilian\w*|seafarer\w*|crew|humanitarian|\baid\b|displace\w*|refugee\w*|hunger|hospital\w*|children|killed|injur\w*/ig},
  {id:'other-forces',label:'Other forces',pattern:/hezbollah|pakistan|bahrain|egypt|somalia|djibouti/ig},
];
export const THEATER_NAMES = {both:'Both theaters',bab:'Bab el-Mandeb',hormuz:'Strait of Hormuz'};
export const PLACES = [
  {id:'bab-chokepoint',label:'Bab el-Mandeb',type:'chokepoint',theater:'bab',lat:12.58,lon:43.33,pattern:/bab[\s-]*(?:el|al)[\s-]*mand[ae]b/ig},
  {id:'hormuz-chokepoint',label:'Strait of Hormuz',type:'chokepoint',theater:'hormuz',lat:26.57,lon:56.25,pattern:/(?:strait of )?hormuz/ig},
  {id:'red-sea',label:'Red Sea',type:'waterway',theater:'bab',pattern:/red sea/ig},
  {id:'gulf-aden',label:'Gulf of Aden',type:'waterway',theater:'bab',pattern:/gulf of aden/ig},
  {id:'gulf-oman',label:'Gulf of Oman',type:'waterway',theater:'hormuz',pattern:/gulf of oman/ig},
  {id:'suez',label:'Suez',type:'maritime-port',theater:'bab',lat:29.97,lon:32.55,pattern:/\bsuez\b/ig},
  {id:'jeddah',label:'Jeddah',type:'maritime-port',theater:'bab',lat:21.48,lon:39.17,pattern:/\bjeddah\b/ig},
  {id:'hodeidah',label:'Hodeidah',type:'maritime-port',theater:'bab',lat:14.79,lon:42.94,pattern:/\b(?:hodeidah|hudaydah|hudaidah)\b/ig},
  {id:'aden',label:'Aden',type:'maritime-port',theater:'bab',lat:12.78,lon:45.03,pattern:/\baden\b/ig},
  {id:'djibouti',label:'Djibouti',type:'maritime-port',theater:'bab',lat:11.6,lon:43.14,pattern:/\bdjibouti\b/ig},
  {id:'salalah',label:'Salalah',type:'maritime-port',theater:'bab',lat:16.95,lon:54.01,pattern:/\bsalalah\b/ig},
  {id:'fujairah',label:'Fujairah',type:'maritime-port',theater:'hormuz',lat:25.13,lon:56.36,pattern:/\bfujairah\b/ig},
  {id:'bandar-abbas',label:'Bandar Abbas',type:'maritime-port',theater:'hormuz',lat:27.18,lon:56.28,pattern:/\bbandar abbas\b/ig},
];
const DISRUPTION = /attack\w*|strike\w*|seiz\w*|closure\w*|closed|rerout\w*|disrupt\w*|blockad\w*|sink\w*|sunk|damag\w*|hijack\w*|missile\w*|drone\w*|shipping warning\w*|pipeline/ig;
export const cleanText = (value,max=1000) => typeof value==='string'?value.replace(/[\x00-\x1f]/g,' ').trim().slice(0,max):'';
export function publicUrl(value) {
  try { const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.href.length>4096)return null;
    if([...url.searchParams.keys()].some(k=>/^(api_?key|access_token|token|password|secret)$/i.test(k)))return null;
    return url.href;
  } catch {return null;}
}
export function dateOnly(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const ms=Date.parse(value+'T00:00:00Z');return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value?value:null;
}
// A day-precision clock has a UTC comparison anchor, not a known publication time.
// Discovery timestamps never substitute for a publisher's publication date.
export function reportPublication(report) {
  if(!report||typeof report!=='object')return null;
  const value=report.publishedAt;
  const exact=typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&dateOnly(value.slice(0,10))&&Number.isFinite(Date.parse(value));
  if(exact&&report.publicationPrecision!=='day')return {value,precision:'timestamp',at:Date.parse(value),date:new Date(value).toISOString().slice(0,10)};
  const date=dateOnly(report.publishedDate)||dateOnly(report.publicationDate)||dateOnly(value)||(exact?value.slice(0,10):null);
  return date?{value:date,precision:'day',at:Date.parse(date+'T00:00:00Z'),date}:null;
}
export function deriveContext(title='',description='') {
  const mentions=[];
  for(const entity of [...ACTORS.map(a=>({...a,type:'actor'})),...PLACES]) {
    for(const [field,body] of [['headline',title],['feed text',description]]) {
      const match=cleanText(body,20000).match(entity.pattern)?.[0];
      if(match){mentions.push({entityId:entity.id,label:entity.label,type:entity.type,field,matchedText:match});break;}
    }
  }
  const disruptionMatches=[...new Set(physicalClaimText(title+' '+description).match(DISRUPTION)||[])].map(s=>s.toLowerCase());
  return {mentions,disruptionMatches};
}
export function reportMentions(report) {
  const known=new Map([...ACTORS.map(a=>({...a,type:'actor'})),...PLACES].map(e=>[e.id,e]));
  const mentions=deriveContext(report.title).mentions;
  for(const m of Array.isArray(report.mentions)?report.mentions:[]) {
    const entity=known.get(m.entityId);if(!entity||mentions.some(x=>x.entityId===m.entityId))continue;
    mentions.push({entityId:entity.id,label:entity.label,type:entity.type,field:m.field==='headline'?'headline':'feed text',matchedText:cleanText(m.matchedText,100)});
  }
  for(const actor of ACTORS)if(report.actors?.includes(actor.label)&&!mentions.some(m=>m.entityId===actor.id)) {
    mentions.push({entityId:actor.id,label:actor.label,type:'actor',field:'feed classification',matchedText:null});
  }
  return mentions;
}
function reportInventory(records,now=Date.now()) {
  const input=Array.isArray(records)?records:[],byUrl=new Map();
  let invalidReportCount=0,futurePublicationCount=0,duplicateReportCount=0;
  for(const r of input) {
    const url=publicUrl(r?.url), publication=reportPublication(r);
    if(!url||!r?.id||!cleanText(r.title)){invalidReportCount++;continue;}
    if(publication&&publication.at>now+300000){futurePublicationCount++;continue;}
    if(byUrl.has(url)){
      duplicateReportCount++;
      // A duplicate with an actual publication clock can resolve an undated link.
      if(publication&&!reportPublication(byUrl.get(url)))byUrl.set(url,{...r,url});
      continue;
    }
    byUrl.set(url,{...r,url});
  }
  // Undated evidence remains browsable. Its position in this list is not a time claim.
  const reports=[...byUrl.values()].sort((a,b)=>{
    const aTime=reportPublication(a)?.at,bTime=reportPublication(b)?.at;
    return aTime===undefined?(bTime===undefined?0:1):bTime===undefined?-1:bTime-aTime;
  });
  return {reports,inputReportCount:input.length,invalidReportCount,futurePublicationCount,duplicateReportCount,uniqueReportCount:reports.length};
}
export function uniqueReports(records,now=Date.now()) {
  return reportInventory(records,now).reports;
}
export function buildEvidenceGraph(records,{limit=12,offset=0,entityId=null,now=Date.now()}={}) {
  const {reports:all,...inventory}=reportInventory(records,now), entities=new Map(), allEdges=[];
  for(const report of all) {
    const publication=reportPublication(report),clock={publishedAt:publication?.precision==='timestamp'?publication.value:null,publishedDate:publication?.date??null,publicationPrecision:publication?.precision??'unknown'};
    for(const mention of reportMentions(report)) {
      entities.set(mention.entityId,{id:mention.entityId,type:mention.type,label:mention.label});
      allEdges.push({id:report.url+'::'+mention.entityId,from:'report:'+report.url,to:mention.entityId,relation:'MENTIONS',reportId:report.id,sourceUrl:report.url,...clock,basis:mention.field,matchedText:mention.matchedText});
    }
    for(const theater of report.theaters||[])if(THEATER_NAMES[theater]&&theater!=='both') {
      const id='theater:'+theater;entities.set(id,{id,type:'theater',label:THEATER_NAMES[theater]});
      allEdges.push({id:report.url+'::'+id,from:'report:'+report.url,to:id,relation:'TAGGED_TO_THEATER',reportId:report.id,sourceUrl:report.url,...clock,basis:'feed classification',matchedText:null});
    }
  }
  const matching=entityId?all.filter(r=>allEdges.some(e=>e.reportId===r.id&&e.to===entityId)):all;
  const start=Math.max(0,Math.min(offset,Math.max(0,Math.ceil(matching.length/limit)-1)*limit));
  const page=matching.slice(start,start+limit), urls=new Set(page.map(r=>'report:'+r.url));
  const edges=allEdges.filter(e=>urls.has(e.from)), ids=new Set(edges.map(e=>e.to));
  return {...inventory,reports:page,totalReports:matching.length,unknownPublicationCount:matching.filter(report=>!reportPublication(report)).length,offset:start,entities:[...entities.values()].filter(e=>ids.has(e.id)),allEntities:[...entities.values()],edges};
}
export function normalizeProfile(input,now=new Date().toISOString()) {
  const mmsi=cleanText(String(input?.mmsi??''),20);
  if(!/^[1-9]\d{8}$/.test(mmsi))throw new Error('Enter a nine-digit MMSI.');
  const imo=cleanText(input.imo,20);if(imo&&!/^\d{7}$/.test(imo))throw new Error('Use seven digits for the optional IMO number.');
  const links=[];
  for(const link of Array.isArray(input.links)?input.links.slice(0,50):[]) {
    const url=publicUrl(link.url);if(!url||links.some(l=>l.url===url))continue;
    links.push({url,title:cleanText(link.title,200)||new URL(url).hostname,attachedAt:Number.isFinite(Date.parse(link.attachedAt))?link.attachedAt:now,reportId:cleanText(link.reportId,200),basis:'analyst attached'});
  }
  let snapshot=null;
  const v=input.snapshot;
  if(v&&String(v.mmsi)===mmsi&&Number.isFinite(v.latitude)&&Number.isFinite(v.longitude)&&Math.abs(v.latitude)<=90&&Math.abs(v.longitude)<=180&&Number.isFinite(Date.parse(v.positionTime))) {
    snapshot={mmsi,name:cleanText(v.name,80),latitude:v.latitude,longitude:v.longitude,theater:['bab','hormuz'].includes(v.theater)?v.theater:'both',positionTime:v.positionTime,receivedAt:v.receivedAt,sourceAt:v.sourceAt||null,speedKnots:Number.isFinite(v.speedKnots)?v.speedKnots:null,courseDegrees:Number.isFinite(v.courseDegrees)?v.courseDegrees:null,timestampBasis:v.sourceAt?'provider':'received'};
  }
  return {mmsi,name:cleanText(input.name,80),imo,theater:['bab','hormuz'].includes(input.theater)?input.theater:'both',notes:cleanText(input.notes,10000),links,snapshot,createdAt:Number.isFinite(Date.parse(input.createdAt))?input.createdAt:now,updatedAt:now};
}
export function vesselMatches(profile,records) {
  const name=cleanText(profile.name,80).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const validName=name.length>=5&&!['unknown','unknown vessel','test vessel','name not reported','vessel','ship','tanker'].includes(name);
  return uniqueReports(records).flatMap(report=> {
    const body=report.title.toLowerCase();
    const identifier=body.match(/\b\d{7,9}\b/g)||[];
    let basis=identifier.includes(profile.mmsi)?'MMSI mention':profile.imo&&identifier.includes(profile.imo)?'IMO mention':null;
    if(!basis&&validName&&(' '+body.replace(/[^a-z0-9]+/g,' ')+' ').includes(' '+name+' '))basis='Name match — review needed';
    return basis?[{report,basis}]:[];
  });
}
export function disruptionMatches(report) {return deriveContext(report.title,report.summary||'').disruptionMatches;}
export function buildTimeline(records,series,{days=30,theater='both',actor='All',query='',onlyDisruptions=true,basis='publication',annotations={},now=Date.now()}={}) {
  days=[7,30,90,180,365].includes(Number(days))?Number(days):30;
  basis=basis==='event'?'event':'publication';
  const end=Date.parse(new Date(now).toISOString().slice(0,10)+'T00:00:00Z');
  // Null remains the table's missing value. priceStatus distinguishes provider-null
  // observations from omitted calendar days for the shared four-day line policy.
  const rows=Array.from({length:days},(_,i)=>({date:new Date(end-(days-1-i)*86400000).toISOString().slice(0,10),prices:{brent:null,wti:null},priceStatus:{brent:'omitted',wti:'omitted'},reports:[]}));
  const map=new Map(rows.map(r=>[r.date,r]));
  for(const s of Array.isArray(series)?series:[])if(['brent','wti'].includes(s?.id))for(const p of Array.isArray(s.observations)?s.observations:[])if(map.has(p?.date)) {
    const row=map.get(p.date),observed=Number.isFinite(p.value);
    row.prices[s.id]=observed?p.value:null;
    row.priceStatus[s.id]=observed?'observed':'missing';
  }
  const {reports,...inventory}=reportInventory(records,now),omittedReports=[];
  const omissionCounts={'publication-date-unknown':0,'event-date-missing':0,'event-date-invalid':0,'event-date-future':0,'outside-window':0};
  let eligibleReportCount=0,unknownPublicationCount=0;
  const labels={'publication-date-unknown':'Publication date unknown','event-date-missing':'Analyst event date missing','event-date-invalid':'Analyst event date invalid','event-date-future':'Analyst event date is in the future','outside-window':'Selected date is outside this window'};
  for(const report of reports) {
    if(theater!=='both'&&!report.theaters?.includes(theater))continue;
    if(actor!=='All'&&!report.actors?.includes(actor))continue;
    if(query&&!(`${report.title} ${report.source}`).toLowerCase().includes(query.toLowerCase()))continue;
    const terms=disruptionMatches(report);if(onlyDisruptions&&!terms.length)continue;
    eligibleReportCount++;
    const publication=reportPublication(report),annotation=annotations?.[report.id];
    if(!publication)unknownPublicationCount++;
    const day=basis==='event'?dateOnly(annotation?.eventDate):publication?.date??null;
    const reason=!day?(basis==='publication'?'publication-date-unknown':annotation?.eventDate?'event-date-invalid':'event-date-missing')
      :basis==='event'&&Date.parse(day+'T00:00:00Z')>now?'event-date-future':!map.has(day)?'outside-window':null;
    if(reason){omissionCounts[reason]++;omittedReports.push({report,reason,label:labels[reason],date:day});continue;}
    map.get(day).reports.push({report,terms,basis:basis==='event'?'Analyst-entered event date':'Publication date',eventDate:annotation?.eventDate||null});
  }
  const reportCount=rows.reduce((n,r)=>n+r.reports.length,0),outsideWindowCount=omissionCounts['outside-window'];
  return {...inventory,rows,basis,missingEventDates:omissionCounts['event-date-missing']+omissionCounts['event-date-invalid'],missingPublicationDates:omissionCounts['publication-date-unknown'],unknownPublicationCount,
    omittedReports,omissionCounts,omittedReportCount:omittedReports.length,unplacedReportCount:omittedReports.length-outsideWindowCount,outsideWindowCount,
    eligibleReportCount,filteredOutCount:reports.length-eligibleReportCount,reportCount,start:rows[0].date,end:rows.at(-1).date};
}
export function normalizeAnnotation(input,report,now=Date.now()) {
  const eventDate=input.eventDate?dateOnly(input.eventDate):null;
  if(input.eventDate&&!eventDate)throw new Error('Enter a valid event date.');
  if(eventDate&&Date.parse(eventDate+'T00:00:00Z')>now)throw new Error('Use an event date that has already occurred.');
  const cleaned=uniqueReports([report],now)[0];if(!cleaned)throw new Error('This source report could not be saved.');
  return {report:cleaned,eventDate,note:cleanText(input.note,5000),basis:'analyst annotation',updatedAt:new Date(now).toISOString()};
}
