import {plain} from './feeds.mjs';
import {advisoryValidity} from '../dist/advisory-validity.mjs';

// Public, server-rendered MSCI metadata, verified 2026-10-17. These are U.S.
// government advisories hosted by MARAD, not MARAD-authored incident reports.
// Only bounded metadata is returned; source guidance/body text is never emitted.
export const MARAD_SOURCE=Object.freeze({
  id:'marad-advisories',name:'U.S. Maritime Advisories · MARAD host',interval:3600,
  url:'https://www.maritime.dot.gov/msci-advisories',
});
const ORIGIN='https://www.maritime.dot.gov';
const MAX_HTML=1000000,MAX_ROWS=100,MAX_DETAILS=12;
const HEADERS=['Title','Status','Effective Date','Expire Date'];
const fail=message=>{throw new Error(`MSCI advisory ${message}`);};
const text=value=>plain(value).replace(/[\u200b-\u200d\ufeff]/g,'').trim();
const bounded=(value,max,label)=>{
  const result=text(value);
  if(!result||result.length>max)fail(`${label} changed`);
  return result;
};
const cleanHtml=html=>{
  if(typeof html!=='string'||!html||html.length>MAX_HTML)fail('payload invalid');
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
};
function dateOnly(value) {
  const label=text(value);
  if(!label||/^(?:unknown|not available|n\/a|—|-)$/i.test(label))return null;
  const m=label.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m)fail('date format changed');
  const [,month,day,year]=m.map(Number),date=new Date(Date.UTC(year,month-1,day));
  if(year<2000||year>2200||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)fail('date invalid');
  return date.toISOString().slice(0,10);
}
function todayAt(now) {
  if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))fail('clock invalid');
  return new Date(now).toISOString().slice(0,10);
}
function advisoryUrl(value) {
  let url;try{url=new URL(text(value),MARAD_SOURCE.url);}catch{fail('URL invalid');}
  if(url.origin!==ORIGIN||url.username||url.password||url.search||url.hash||!/^\/msci\/\d{4}-\d{3}-[a-z0-9-]+$/.test(url.pathname))fail('URL not allowed');
  return url.href;
}
function advisoryId(title,url) {
  const id=title.match(/^(\d{4}-\d{3})-/)?.[1];
  if(!id||!new URL(url).pathname.startsWith(`/msci/${id}-`))fail('identity mismatch');
  return id;
}
function status(value) {
  const result=text(value).toLowerCase();
  if(!['active','cancelled'].includes(result))fail('status changed');
  return result;
}
function theaters(title) {
  const result=[];
  if(/\b(?:persian gulf|strait of hormuz|gulf of oman)\b/i.test(title))result.push('hormuz');
  if(/\b(?:red sea|bab el mandeb|bab el-mandeb)\b/i.test(title))result.push('bab');
  return result;
}
export function maradValidity(record,now=Date.now()) {
  todayAt(now); // Preserve parser clock validation.
  return advisoryValidity(record,now);
}
function recordFor({title,url,sourceStatus,effectiveDate,expiresDate},now) {
  if(effectiveDate&&expiresDate&&effectiveDate>expiresDate)fail('date range invalid');
  const number=advisoryId(title,url);
  const record={
    id:`marad-advisories:${number}`,advisoryId:number,title,url,
    sourceId:MARAD_SOURCE.id,source:MARAD_SOURCE.name,
    recordKind:'official-advisory',recordType:'advisory',evidenceStatus:'official-advisory',
    sourceStatus,effectiveDate,expiresDate,
    effectiveDatePrecision:effectiveDate?'day':'unknown',expiryDatePrecision:expiresDate?'day':'unknown',
    eventDate:null,eventDatePrecision:'unknown',publishedDate:null,publicationPrecision:'unknown',
    sourceUpdatedDate:null,theaters:theaters(title),mechanisms:[],
    locationPrecision:'advisory-region',supersedes:[],supersededBy:[],
  };
  return {...record,validityState:maradValidity(record,now)};
}
function readTable(section,expectedStatus,now) {
  const tables=[...section.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  if(tables.length!==1)fail(`${expectedStatus} table missing or ambiguous`);
  const table=tables[0][1],rows=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if([...table.matchAll(/<tr\b/gi)].length!==rows.length)fail('table truncated');
  if(rows.length<2||rows.length>MAX_ROWS+1)fail('table empty or exceeds bound');
  const header=[...rows[0][1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m=>text(m[1]));
  if(header.length!==4||header.some((value,i)=>value!==HEADERS[i]))fail('table columns changed');
  return rows.slice(1).map(([,row])=>{
    const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);
    if(cells.length!==4||[...row.matchAll(/<td\b/gi)].length!==4)fail('row changed');
    const links=[...cells[0].matchAll(/<a\b[^>]*\bhref=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi)];
    if(links.length!==1)fail('title link changed');
    const title=bounded(links[0][2],500,'title'),url=advisoryUrl(links[0][1]),sourceStatus=status(cells[1]);
    if(sourceStatus!==expectedStatus)fail('table status conflicts');
    return recordFor({title,url,sourceStatus,effectiveDate:dateOnly(cells[2]),expiresDate:dateOnly(cells[3])},now);
  });
}
export function parseMaradAdvisoriesIndex(html,now=Date.now()) {
  todayAt(now);const clean=cleanHtml(html);
  const headings=[...clean.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const active=headings.filter(m=>text(m[1])==='Active Advisories'),cancelled=headings.filter(m=>text(m[1])==='Cancelled Advisories');
  if(active.length!==1||cancelled.length!==1||active[0].index>=cancelled[0].index)fail('index sections changed');
  const afterCancelled=headings.find(m=>m.index>cancelled[0].index);
  const records=[
    ...readTable(clean.slice(active[0].index+active[0][0].length,cancelled[0].index),'active',now),
    ...readTable(clean.slice(cancelled[0].index+cancelled[0][0].length,afterCancelled?.index),'cancelled',now),
  ];
  if(new Set(records.map(r=>r.advisoryId)).size!==records.length)fail('duplicate or conflicting identity');
  const scoped=records.filter(r=>r.theaters.length);
  // There is no verified official zero-state markup. A successful HTTP fetch
  // with no matching active records is ambiguous, never an all-clear signal.
  if(!scoped.some(r=>r.sourceStatus==='active'))fail('scoped active list empty; coverage unknown');
  return scoped;
}
function field(html,className) {
  const tags=[...html.matchAll(/<\/?div\b[^>]*>/gi)];
  const starts=tags.map((m,i)=>({m,i})).filter(({m})=>!/^<\//.test(m[0])&&new RegExp(`\\bclass=['"][^'"]*\\b${className}\\b[^'"]*['"]`).test(m[0]));
  if(starts.length!==1)fail(`${className} missing or ambiguous`);
  const {m:start,i}=starts[0];let depth=1;
  for(let n=i+1;n<tags.length;n++){
    depth+=/^<\//.test(tags[n][0])?-1:1;
    if(depth===0)return html.slice(start.index+start[0].length,tags[n].index);
  }
  fail('detail field truncated');
}
export function parseMaradAdvisoryPage(html,indexRecord,now=Date.now()) {
  todayAt(now);const clean=cleanHtml(html),url=advisoryUrl(indexRecord?.url);
  const titles=[...clean.matchAll(/<h1\b[^>]*\bclass=['"][^'"]*\bnode__title\b[^'"]*['"][^>]*>([\s\S]*?)<\/h1>/gi)];
  if(titles.length!==1)fail('detail title changed');
  const title=bounded(titles[0][1],500,'title');
  if(advisoryId(title,url)!==indexRecord.advisoryId||title!==indexRecord.title)fail('index/detail title mismatch');
  // Ignore header/nav fields with the same Drupal class names.
  const detail=clean.slice(titles[0].index+titles[0][0].length);
  const sourceStatus=status(text(field(detail,'field--name-field-msci-status')).replace(/^Status:\s*/i,''));
  const dateField=field(detail,'field--name-field-msci-effective-date');
  const times=[...dateField.matchAll(/<time\b[^>]*>([\s\S]*?)<\/time>/gi)];
  let effectiveDate=null,expiresDate=null;
  if(times.length===2){
    [effectiveDate,expiresDate]=times.map(m=>dateOnly(m[1]));
    times.forEach((m,i)=>{
      const machine=m[0].match(/\bdatetime=['"]([^'"]+)['"]/)?.[1];
      if(machine&&machine.slice(0,10)!==[effectiveDate,expiresDate][i])fail('date label/machine mismatch');
    });
  }else if(times.length||!/^Effective Date:\s*(?:unknown|not available|n\/a|—|-)?$/i.test(text(dateField)))fail('detail date range changed');
  for(const [key,value] of Object.entries({sourceStatus,effectiveDate,expiresDate}))if(value!==indexRecord[key])fail(`index/detail ${key} mismatch`);
  const articleEnd=detail.indexOf('</article>');
  if(articleEnd<0)fail('detail article boundary missing');
  const body=text(field(detail.slice(0,articleEnd),'field--name-body'));
  if(!body||body.length>100000)fail('detail description missing or invalid');
  const supersedes=[...new Set([...body.matchAll(/\b(?:supersedes\s+and\s+cancels|supersedes|cancels)\s+(?:U\.S\.\s+)?Maritime Advisory\s+(\d{4}-\d{3})\b/gi)].map(m=>m[1]))];
  if(supersedes.length>10||supersedes.includes(indexRecord.advisoryId))fail('supersession invalid');
  const locationText=bounded(text(field(detail,'field--name-field-msci-geographic-location')).replace(/^Geographic Location:\s*/i,''),400,'geographic scope');
  const threatType=bounded(text(field(detail,'field--name-field-threat-type')).replace(/^Threat Type:\s*/i,''),300,'threat type');
  return {...recordFor({title,url,sourceStatus,effectiveDate,expiresDate},now),locationText,threatType,supersedes};
}
export async function loadMaradAdvisories(fetchText,now=Date.now()) {
  if(typeof fetchText!=='function')fail('fetch function missing');
  const records=parseMaradAdvisoriesIndex(await fetchText(MARAD_SOURCE.url),now);
  const active=records.filter(r=>r.sourceStatus==='active');
  if(active.length>MAX_DETAILS)fail('active detail bound exceeded');
  const detailed=[];
  // A detail failure fails the batch, retaining SourceRuntime's last good
  // snapshot instead of silently presenting partial advisory coverage.
  for(const record of active)detailed.push(parseMaradAdvisoryPage(await fetchText(record.url),record,now));
  const advisories=[...detailed,...records.filter(r=>r.sourceStatus==='cancelled')].map(record=>{
    const supersededBy=detailed.filter(r=>r.supersedes.includes(record.advisoryId)).map(r=>r.advisoryId);
    if(record.sourceStatus==='active'&&supersededBy.length)fail('active index contradicts supersession');
    return {...record,supersededBy,validityState:maradValidity({...record,supersededBy},now)};
  });
  return {
    advisories,recordCount:advisories.length,url:MARAD_SOURCE.url,
    access:'Official public HTML; bounded advisory metadata and source links',
    latest:null,sourceUpdatedDate:null,
    coverage:{
      scope:'Listed U.S. maritime advisories for Hormuz / Persian Gulf / Gulf of Oman and Red Sea / Bab el-Mandeb',
      recordKind:'official-advisory',incidentCoverage:false,
      activeListedCount:detailed.length,cancelledListedCount:advisories.length-detailed.length,
      cancelledArchiveComplete:false,publicationDateKnown:false,
      note:'Active advisory metadata, not an incident feed. Cancelled history is the first index page only. Superseded IDs may be outside that page. Absence is not cancellation or an all-clear.',
    },
  };
}
