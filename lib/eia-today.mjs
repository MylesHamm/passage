import {plain} from './feeds.mjs';
import {SourceError,fetchText} from './source-runtime.mjs';

// EIA "Today in Energy" daily prices: public, server-rendered HTML, not a
// documented API. Verified 2026-10-20: the "Wholesale Spot Petroleum Prices,
// MM/DD/YY Close" table lists WTI and Brent under "Crude Oil ($/barrel)", and the
// page states the spot petroleum prices are republished from Refinitiv. EIA data
// is public domain; EIA asks to be credited. The parser refuses to guess: any
// layout change, missing date or unusable value yields null for that series,
// never a stale, cached or invented number.
const URL_PRICES='https://www.eia.gov/todayinenergy/prices.php';
const MAX_HTML=2000000,DAY=86400000,TIMEOUT_MS=20000,MIN_USD=10,MAX_USD=400,MAX_AGE_DAYS=7;
const HEADER=['product','area','price','percent change*'];
const CRUDE=/^crude oil \(\$\/barrel\)$/i;
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const SERIES=Object.freeze([
  Object.freeze({id:'brent',name:'Brent',area:'brent'}),
  Object.freeze({id:'wti',name:'WTI',area:'wti'}),
]);

export const EIA_TODAY_SOURCE=Object.freeze({
  id:'eia-today',name:'EIA · Today in Energy daily prices',home:URL_PRICES,url:URL_PRICES,
  attribution:'Source: U.S. Energy Information Administration (EIA), Today in Energy daily prices',
  cadence:'Updated weekdays except federal holidays; prior business day close',
  access:'Public HTML page',
});

const iso=ms=>new Date(ms).toISOString();
const clockOf=now=>typeof now==='function'?now:()=>now;
const text=value=>plain(value).replace(/[​-‍﻿]/g,'').trim();
function utcDate(year,month,day) {
  const date=new Date(Date.UTC(year,month-1,day));
  if(year<2000||year>2200||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
  return date.toISOString().slice(0,10);
}
function result(issue,{asOf=null,pageDate=null,values={}}={}) {
  return {asOf,pageDate,series:SERIES.map(s=>values[s.id]||{id:s.id,name:s.name,value:null,units:null,date:null,basis:null,vendor:null,issue})};
}
function cells(row) {
  return [...row.matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)].map(([,,attrs,cell])=>({
    text:text(cell),
    rowspan:Number(attrs.match(/\browspan\s*=\s*["']?(\d+)/i)?.[1]||1),
    colspan:Number(attrs.match(/\bcolspan\s*=\s*["']?(\d+)/i)?.[1]||1),
  }));
}
function pageDate(html) {
  const label=text(html.match(/<span\b[^>]*\bclass\s*=\s*["']date["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]||'');
  const m=label.match(/^([a-z]+)\s+(\d{1,2}),\s*(\d{4})$/i),month=m?MONTHS.indexOf(m[1].toLowerCase())+1:0;
  return month?utcDate(Number(m[3]),month,Number(m[2])):null;
}

export function parseEiaTodayPrices(html,now=Date.now(),{maxAgeDays=MAX_AGE_DAYS}={}) {
  if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))throw new TypeError('EIA Today clock is invalid');
  if(!Number.isFinite(maxAgeDays)||maxAgeDays<0)throw new RangeError('EIA Today maxAgeDays must be a non-negative number');
  if(typeof html!=='string'||!html||html.length>MAX_HTML)return result('payload-invalid');
  const clean=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  const today=iso(now).slice(0,10);

  const tables=[...clean.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m=>m[1]).filter(t=>/Wholesale Spot Petroleum Prices/i.test(text(t)));
  if(tables.length!==1)return result('layout-changed');
  const table=tables[0],rowMatches=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if(!rowMatches.length||[...table.matchAll(/<tr\b/gi)].length!==rowMatches.length)return result('layout-changed');
  const rows=rowMatches.map(m=>cells(m[1]));

  // The close date comes only from this table's own title. Without it the
  // values cannot be dated, so they are not returned.
  const titles=rows.map((r,i)=>[r,i]).filter(([r])=>r.length===1&&/^Wholesale Spot Petroleum Prices\b/i.test(r[0].text));
  if(titles.length!==1)return result('layout-changed');
  const [[[title],titleIndex]]=titles;
  if(!/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(title.text))return result('date-missing');
  const dated=title.text.match(/^Wholesale Spot Petroleum Prices,\s*(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(Close)$/i);
  if(!dated)return result('layout-changed');
  const year=Number(dated[3].length===2?'20'+dated[3]:dated[3]);
  const closeDate=utcDate(year,Number(dated[1]),Number(dated[2]));
  if(!closeDate)return result('date-invalid');
  const published=pageDate(clean);
  if(closeDate>today||published&&published>today)return result('date-in-future');
  if(published&&closeDate>published)return result('date-inconsistent',{pageDate:published});
  // A page that stopped updating must not present an old close as current.
  if(Date.parse(today)-Date.parse(closeDate)>maxAgeDays*DAY)return result('date-stale',{asOf:closeDate,pageDate:published});

  const headers=rows.map((r,i)=>r.length===HEADER.length&&r.every((c,j)=>c.text.toLowerCase()===HEADER[j])?i:-1).filter(i=>i>=0);
  if(headers.length!==1||headers[0]<=titleIndex)return result('layout-changed',{asOf:closeDate,pageDate:published});
  const headerIndex=headers[0];

  // Product labels span rows with rowspan. A row is attributed to a product only
  // while that rowspan is open; orphaned or hidden rows are ignored, and the
  // first full-width row ends the spot section.
  const entries=[];let product=null,remaining=0;
  for(const r of rows.slice(headerIndex+1)) {
    if(r.some(c=>c.colspan>1))break;
    let data;
    if(r.length===4&&r[0].rowspan>=1&&r[0].rowspan<=20){product=r[0].text;remaining=r[0].rowspan;data=r.slice(1);}
    else if(r.length===3&&remaining>0)data=r;
    else{product=null;remaining=0;continue;}
    entries.push({product,area:data[0].text,price:data[1].text});
    if(--remaining===0)product=null;
  }
  const crude=entries.filter(e=>CRUDE.test(e.product));
  if(!crude.length)return result('layout-changed',{asOf:closeDate,pageDate:published});
  const units=crude[0].product.match(/\(([^)]+)\)/)[1];

  // Vendor is reported only if the page names it for this table.
  const vendor=text(clean).match(/Wholesale Spot Petroleum Prices from\s+([A-Za-z][A-Za-z0-9&' -]{0,60}?)\s*[,;.]/)?.[1]?.trim()||null;
  const basis=`Wholesale spot ${dated[4].toLowerCase()}${vendor?` (${vendor})`:''}`;

  const values={};
  for(const s of SERIES) {
    const matches=crude.filter(e=>e.area.toLowerCase()===s.area);
    const fail=issue=>{values[s.id]={id:s.id,name:s.name,value:null,units:null,date:null,basis:null,vendor:null,issue};};
    if(matches.length!==1){fail(matches.length?'ambiguous':'layout-changed');continue;}
    const price=matches[0].price;
    if(/^(?:|na|n\/a|-+|—)$/i.test(price)){fail('value-missing');continue;}
    if(!/^\d{1,4}(?:\.\d{1,4})?$/.test(price)){fail('value-unparseable');continue;}
    const value=Number(price);
    if(!Number.isFinite(value)||value<MIN_USD||value>MAX_USD){fail('value-out-of-range');continue;}
    values[s.id]={id:s.id,name:s.name,value,units,date:closeDate,basis,vendor,issue:null};
  }
  return result(null,{asOf:closeDate,pageDate:published,values});
}

// Throws a categorized SourceError when nothing usable was parsed, so a caller's
// SourceRuntime keeps its last good, dated close instead of caching nulls.
export async function fetchEiaToday({fetchImpl=fetch,now=Date.now,timeoutMs=TIMEOUT_MS,maxAgeDays=MAX_AGE_DAYS}={}) {
  const clock=clockOf(now);
  const html=await fetchText(URL_PRICES,{fetchImpl,timeoutMs,now:clock,maxBytes:MAX_HTML});
  const parsed=parseEiaTodayPrices(html,clock(),{maxAgeDays});
  const recordCount=parsed.series.filter(s=>s.value!==null).length;
  if(!recordCount) {
    const error=new SourceError('schema');
    error.issues=[...new Set(parsed.series.map(s=>s.issue))];
    throw error;
  }
  return {...parsed,recordCount,retrievedAt:iso(clock()),source:{...EIA_TODAY_SOURCE}};
}
