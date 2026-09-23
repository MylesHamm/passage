import {createHash} from 'node:crypto';
import {plain} from './feeds.mjs';

// Public HTML indexes, not documented APIs. Verified against both pages on
// 2026-09-13. Changed/empty schemas throw so SourceRuntime retains its last good
// response. A source-confirmed incident is not independent verification by Passage.
export const MARITIME_FEEDS=Object.freeze([
  Object.freeze({
    id:'imo-hormuz',name:'IMO · Hormuz & Middle East',theater:'hormuz',interval:1800,
    url:'https://www.imo.org/en/mediacentre/hottopics/pages/middle-east-highlighted-incidents.aspx',
  }),
  Object.freeze({
    id:'imo-redsea',name:'IMO · Red Sea statements',theater:'bab',interval:1800,
    url:'https://www.imo.org/en/mediacentre/hottopics/pages/red-sea.aspx',
  }),
]);

const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const text=value=>plain(value).replace(/[\u200b-\u200d\ufeff]/g,'').trim();
const identity=parts=>createHash('sha256').update(parts.join('|')).digest('hex').slice(0,20);
const failure=detail=>{throw new Error(`IMO maritime ${detail}`);};

function calendarDate(label,year=null) {
  const match=text(label).match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/i);
  if(!match)failure('date format changed');
  const day=Number(match[1]),month=MONTHS.indexOf(match[2].toLowerCase()),resolvedYear=Number(match[3]||year);
  if(month<0||resolvedYear<2000||resolvedYear>2200)failure('date is invalid');
  const date=new Date(Date.UTC(resolvedYear,month,day));
  if(date.getUTCFullYear()!==resolvedYear||date.getUTCMonth()!==month||date.getUTCDate()!==day)failure('date is invalid');
  return date.toISOString().slice(0,10);
}

function bounded(value,max,label) {
  const result=text(value);
  if(!result||result.length>max)failure(`${label} format changed`);
  return result;
}

function common(feed) {
  return {
    sourceId:feed.id,source:feed.name,theaters:[feed.theater],
    // The source does not establish an event-to-price causal estimate or cargo.
    mechanisms:[],
  };
}

function parseConfirmedTable(html,feed,today) {
  // The date rows omit the year. Only the publisher's explicit dated update can
  // supply that year; today's year would silently re-date old incidents.
  const updateLabel=text(html).match(/Number of confirmed incidents as at\s+(\d{1,2}\s+[a-z]+\s+\d{4})\s*:/i)?.[1];
  if(!updateLabel)failure('source update date missing');
  const sourceUpdatedDate=calendarDate(updateLabel);
  if(sourceUpdatedDate>today)failure('source update date is in the future');
  const year=Number(sourceUpdatedDate.slice(0,4));
  const tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  const headers=['date','ship name (imo number)','location','description'];
  let rows;
  for(const [,table] of tables) {
    const matches=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    const candidate=matches
      .map(([,row])=>[...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([,cell])=>text(cell)));
    if(candidate[0]?.length===4&&candidate[0].every((cell,i)=>cell.toLowerCase()===headers[i])) {
      if(rows)failure('incident table is ambiguous');
      if([...table.matchAll(/<tr\b/gi)].length!==matches.length)failure('incident table is truncated');
      rows=candidate.slice(1);
    }
  }
  if(!rows?.length||rows.length>500)failure('incident table missing or empty');
  const events=rows.map(cells=>{
    if(cells.length!==4)failure('incident row format changed');
    const [dateLabel,shipLabel,location,description]=cells;
    const eventDate=calendarDate(dateLabel,year);
    // Do not guess a previous year when an undated-year row would fall after
    // the update. Explicitly dated rows can safely span calendar years.
    if(eventDate>sourceUpdatedDate)failure('incident date exceeds source update date');
    const label=bounded(shipLabel,240,'ship'),locationText=bounded(location,600,'location');
    const summary=bounded(description,1600,'description');
    const imo=label.match(/\bIMO\s*(\d{7})\b/i)?.[1]||null;
    const shipName=label.replace(/\(\s*IMO\s*\d{7}\s*\)/gi,'').replace(/\s+/g,' ').trim();
    if(!shipName)failure('ship name missing');
    return {
      ...common(feed),id:identity([feed.id,eventDate,imo||shipName,locationText]),
      title:`${shipName} · maritime incident`,shipName,...(imo?{imo}:{}),
      url:feed.url,recordType:'incident',evidenceStatus:'confirmed-by-source',
      eventDate,eventDatePrecision:'day',publishedDate:null,publicationPrecision:'unknown',
      sourceUpdatedDate,locationText,locationPrecision:'reported-area',summary,
    };
  });
  return [...new Map(events.map(event=>[event.id,event])).values()]
    .sort((a,b)=>b.eventDate.localeCompare(a.eventDate)||a.id.localeCompare(b.id));
}

function parseStatementIndex(html,feed,today) {
  // The Red Sea index has aggregate counts and dated statement links. It has
  // no row-level incident table, so a statement's publication date must never
  // be represented as the date of an incident or plotted as an event location.
  const headings=[...html.matchAll(/<h[2-6]\b[^>]*>([\s\S]*?)<\/h[2-6]>/gi)];
  const headingIndex=headings.findIndex(match=>text(match[1]).toLowerCase()==='latest statements');
  if(headingIndex<0)failure('statement section missing');
  const heading=headings[headingIndex],end=headings[headingIndex+1]?.index;
  if(end===undefined)failure('statement section boundary missing');
  const section=html.slice(heading.index+heading[0].length,end);
  const rows=[...section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
  if(!rows.length||rows.length>100)failure('statement list missing or empty');
  if([...section.matchAll(/<li\b/gi)].length!==rows.length)failure('statement list is truncated');
  const events=rows.map(([,row])=>{
    const links=[...row.matchAll(/<a\b[^>]*\bhref\s*=\s*['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi)];
    if(links.length!==1)failure('statement link format changed');
    const link=links[0],title=bounded(link[2],500,'statement title');
    let url;
    try{url=new URL(text(link[1]),feed.url);}catch{failure('statement URL invalid');}
    if(url.origin!=='https://www.imo.org'||!/^\/en\/mediacentre\/pressbriefings\/pages\/[a-z0-9-]+\.aspx$/i.test(url.pathname)||url.username||url.password)failure('statement URL not allowed');
    const dateLabel=text(row.slice(link.index+link[0].length)).match(/^\(\s*(\d{1,2}\s+[a-z]+\s+\d{4})\s*\)/i)?.[1];
    if(!dateLabel)failure('statement publication date missing');
    const publishedDate=calendarDate(dateLabel);
    if(publishedDate>today)failure('statement publication date is in the future');
    return {
      ...common(feed),id:identity([feed.id,url.href]),title,url:url.href,
      recordType:'statement',evidenceStatus:'official-statement',
      eventDate:null,eventDatePrecision:'unknown',publishedDate,publicationPrecision:'day',
      sourceUpdatedDate:null,locationText:'Red Sea area (statement scope)',locationPrecision:'region-only',
      summary:'IMO statement. Open the source for the reported circumstances and attribution; the index does not supply an incident date or exact location.',
    };
  });
  return [...new Map(events.map(event=>[event.id,event])).values()]
    .sort((a,b)=>b.publishedDate.localeCompare(a.publishedDate)||a.id.localeCompare(b.id));
}

export function parseMaritimePage(html,feed,now=Date.now()) {
  const config=MARITIME_FEEDS.find(item=>item.id===feed?.id);
  if(!config)failure('source is not supported');
  if(typeof html!=='string'||!html||html.length>6000000||!Number.isFinite(now))failure('payload is invalid');
  const today=new Date(now).toISOString().slice(0,10);
  const clean=html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  return config.id==='imo-hormuz'?parseConfirmedTable(clean,config,today):parseStatementIndex(clean,config,today);
}
