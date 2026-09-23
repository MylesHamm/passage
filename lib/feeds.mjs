import { createHash } from 'node:crypto';

export const SOURCES = [
  { id: 'bbc', name: 'BBC Middle East', type: 'Reporting', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', home: 'https://www.bbc.com/news/world/middle_east', interval: 300 },
  { id: 'aj', name: 'Al Jazeera', type: 'Reporting', url: 'https://www.aljazeera.com/xml/rss/all.xml', home: 'https://www.aljazeera.com/middle-east/', interval: 300 },
  { id: 'un', name: 'UN News', type: 'UN reporting', url: 'https://news.un.org/feed/subscribe/en/news/region/middle-east/feed/rss.xml', home: 'https://news.un.org/en/news/region/middle-east', interval: 600 },
  { id: 'centcom', name: 'CENTCOM', type: 'Official statement', url: 'https://www.centcom.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=808&max=30', home: 'https://www.centcom.mil/MEDIA/PRESS-RELEASES/', interval: 900 },
  // Publisher-advertised RSS: https://www.eia.gov/tools/rssfeeds/
  { id: 'eia-news', name: 'EIA · Today in Energy', type: 'Official energy analysis', url: 'https://www.eia.gov/rss/todayinenergy.xml', home: 'https://www.eia.gov/todayinenergy/', interval: 900 },
  // Public Substack RSS: https://support.substack.com/hc/en-us/articles/360038239391-Is-there-an-RSS-feed-for-my-publication
  // Doomberg describes free previews at https://newsletter.doomberg.com/about.
  { id: 'doomberg', name: 'Doomberg', type: 'Independent energy analysis', url: 'https://newsletter.doomberg.com/feed', home: 'https://newsletter.doomberg.com/', interval: 3600, publicPreviewOnly:true },
];
export const THEATERS = [{ id:'bab', name:'Bab el-Mandeb', lat:12.58, lon:43.33 }, {id:'hormuz',name:'Strait of Hormuz',lat:26.57,lon:56.25}];

export function plain(value='') {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi,e=>{
    const map={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};
    if(map[e]) return map[e];
    const n=e.startsWith('&#x')?parseInt(e.slice(3),16):parseInt(e.slice(2),10);
    return Number.isFinite(n)&&n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
  }).replace(/\s+/g,' ').trim();
}
export function safeUrl(value) {
  try {
    const u=new URL(plain(value));
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.href.length>4096||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[::1\])/i.test(u.hostname)||/^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname))return null;
    if([...u.searchParams.keys()].some(k=>/^(api[_-]?key|access[_-]?token|token|password|secret|authorization|signature|key)$/i.test(k)))return null;
    u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_|^(?:fbclid|gclid|mc_cid|mc_eid|lctg|user_email)$/i.test(key))u.searchParams.delete(key);
    return u.href;
  }catch{return null;}
}
export function publisherSummary(value='',maxLength=280) {
  const clean=plain(String(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,''));
  const lead=clean.split(/(?:\b(?:read more|also read|related (?:stories|articles)|more stories|read the full (?:story|article))\s*[:→↗]|\bThe post .+ appeared first on\b)/i)[0].trim();
  const limit=Math.max(1,Math.min(600,maxLength));
  return lead.length>limit?lead.slice(0,limit-1).trimEnd()+'…':lead;
}
const MONTH_NAMES='Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const MONTH_INDEX=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const DAY_FIRST=new RegExp(`\\b(\\d{1,2})[\\s-]+(${MONTH_NAMES})\\.?[\\s,-]+(\\d{4}|\\d{2})(?![\\d:])`,'i');
const MONTH_FIRST=new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})[,\\s]+(\\d{4}|\\d{2})(?![\\d:])`,'i');
// Date.parse accepts normal RFC feed dates and their timezone offsets, but it
// silently rolls February 30 into March. Check the supplied calendar before
// converting its timestamp, rather than comparing the resulting UTC date (which
// can legitimately cross midnight). The first calendar date in the input wins.
export function publisherDateMillis(value) {
  const raw=String(value||''),ms=Date.parse(raw);if(!Number.isFinite(ms))return NaN;
  const candidates=[];
  const iso=raw.match(/\b(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  if(iso)candidates.push({index:iso.index,year:Number(iso[1]),month:Number(iso[2])-1,day:Number(iso[3])});
  const dayFirst=raw.match(DAY_FIRST),monthFirst=raw.match(MONTH_FIRST);
  for(const [match,year,month,day] of [[dayFirst,3,2,1],[monthFirst,3,1,2]])if(match){
    const suppliedYear=Number(match[year]),resolvedYear=match[year].length===2?suppliedYear+(suppliedYear<50?2000:1900):suppliedYear;
    candidates.push({index:match.index,year:resolvedYear,month:MONTH_INDEX.indexOf(match[month].slice(0,3).toLowerCase()),day:Number(match[day])});
  }
  const calendar=candidates.sort((a,b)=>a.index-b.index)[0];
  if(calendar){const check=new Date(0);check.setUTCFullYear(calendar.year,calendar.month,calendar.day);if(check.getUTCFullYear()!==calendar.year||check.getUTCMonth()!==calendar.month||check.getUTCDate()!==calendar.day)return NaN;}
  return ms;
}
const ACTOR_RULES=[
  ['Houthis',/\b(?:houthis?|ansar.?allah)\b/i],['Iran',/\b(?:iran|iranian|tehran)\b/i],['IRGC',/\b(?:irgc|islamic revolutionary guard|revolutionary guard)\b/i],
  ['U.S. military',/\b(?:u\.?s\.? (?:navy|military|forces|army|air force)|american (?:military|forces)|centcom|pentagon|united states (?:military|forces)|uss)\b/i],
  ['Saudi Arabia',/\b(?:saudi|aramco|east[-– ]west pipeline|yanbu)\b/i],['UAE',/\b(?:uae|united arab emirates|emirati|fujairah)\b/i],['Oman',/\b(?:oman|omani|duqm)\b/i],
  ['Iraq',/\b(?:iraq|iraqi|basra)\b/i],['Kuwait',/\b(?:kuwait|kuwaiti)\b/i],['Qatar',/\b(?:qatar|qatari|ras laffan)\b/i],['Bahrain',/\b(?:bahrain|bahraini)\b/i],['Egypt',/\b(?:egypt|egyptian|suez|sumed)\b/i],['Israel',/\b(?:israel|israeli)\b/i],
  ['Maritime coalitions',/\b(?:eunavfor|aspides|combined maritime forces|coalition|royal navy|jmic|ukmto|mscio)\b/i],['Merchant shipping',/\b(?:merchant ship|commercial ship|cargo ship|tanker|seafarer|mariner|crew|vessel)s?\b/i],
  ['Civilians',/\b(?:civilian|seafarer|crew|humanitarian|aid|displace\w*|refugee|hunger|hospital|children|killed|injur\w*)\b/i],['Other forces',/\b(?:hezbollah|pakistan|somalia)\b/i],
];
const ENERGY=/\b(?:oil|brent|wti|crude|tankers?|energy|opec|petroleum|lng|diesel|gasoil|refiner\w*|gas prices?)\b/i;
const REGIONAL=/\b(?:saudi|aramco|yanbu|east[-– ]west pipeline|uae|emirati|united arab emirates|fujairah|oman|omani|duqm|iraq|iraqi|basra|kuwait|qatar|bahrain|egypt|sumed|gulf|middle east)\b/i;
const CHANNEL=/\b(?:oil|crude|energy|tankers?|petroleum|lng|diesel|refiner\w*|pipeline|export|shipping|port|sanctions?|ceasefire|war|peace|talks?|negotiat\w*|diplomac\w*|blockade)\b/i;
const MARKET=/\b(?:(?:oil|crude|diesel|petroleum|gasoline) (?:prices?|suppl\w*|demand|inventor\w*|stocks?|markets?)|global oil|brent|wti|opec|refining margins)\b/i;
const petroleumText=text=>text.replace(/\b(?:crude\s+)?(?:palm|olive|soy(?:bean)?|sunflower|coconut|cooking|vegetable|edible)\s+oil\b/gi,'food commodity');
export function classify(text,title=text) {
  const theaters=[],actors=[],matchEvidence=[],relevanceScopes=[];
  // Feed descriptions often contain unrelated “more stories” links. Use the
  // publisher headline for geography so a Guyana or generic oil article is not
  // accidentally placed in a Gulf theatre because of description boilerplate.
  if(/\b(?:bab.?el|bab.?al|mand[ae]b|red sea|yemen|houthis?|aden|djibouti|suez)\b/i.test(title))theaters.push('bab');
  if(/\b(?:hormuz|iran|iranian|persian gulf|arabian gulf|gulf of oman|fujairah|bandar)\b/i.test(title))theaters.push('hormuz');
  for(const value of theaters)matchEvidence.push({kind:'theater',value,field:'headline',basis:'Text mention; not an event location'});
  const summary=text.startsWith(title)?text.slice(title.length).trim():text===title?'':text;
  for(const [value,pattern] of ACTOR_RULES){if(pattern.test(text)){actors.push(value);for(const [field,valueText] of [['headline',title],['summary',summary]])if(pattern.test(valueText))matchEvidence.push({kind:'actor',value,field,basis:'Text mention; role not established'});}}
  const energy=ENERGY.test(petroleumText(text));
  if(theaters.length)relevanceScopes.push('theater');
  // Relevance and geography are separate. Only the headline determines broad
  // regional relevance; unrelated RSS footer text cannot pull in other stories.
  if(REGIONAL.test(title)&&CHANNEL.test(petroleumText(title)))relevanceScopes.push('regional-energy');
  if(MARKET.test(petroleumText(title)))relevanceScopes.push('global-energy');
  for(const value of relevanceScopes.filter(x=>x!=='theater'))matchEvidence.push({kind:'relevance',value,field:'headline',basis:'Monitoring context; not a location or measured oil effect'});
  return {theaters,actors,energy,relevanceScopes,matchEvidence};
}
export function reportRelevant(record){return !!(record?.theaters?.length||record?.relevanceScopes?.some(x=>['regional-energy','global-energy'].includes(x)));}
export function classifyReport(record){
  const title=record.title||'',summary=record.summary||'',result=classify(title+' '+summary,title);
  // Analysis headlines can be figurative. Only the displayed public preview may
  // extend energy relevance; it never supplies invented event coordinates.
  if(record.type==='Independent energy analysis'&&/\b(?:oil|crude|petroleum|diesel|gasoline|refiner\w*|brent|wti|opec|lng|natural gas|tankers?|strategic (?:petroleum )?reserves?)\b/i.test(petroleumText(title+' '+summary))){
    result.energy=true;
    if(!result.relevanceScopes.includes('global-energy'))result.relevanceScopes.push('global-energy');
    result.matchEvidence.push({kind:'relevance',value:'global-energy',field:summary?'headline and public preview':'headline',basis:'Energy analysis text; not a verified event or measured oil effect'});
  }
  return result;
}
export function parseRSS(xml, source, now=Date.now()) {
  const raw=(s,t)=>s.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}>`,'i'))?.[1]||'';
  const get=(s,t)=>plain(raw(s,t));
  const blocks=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)];
  if(!/<rss\b|<rdf:RDF\b/i.test(xml)) throw new Error('Unexpected feed format');
  return blocks.map(([,b])=>{
    const title=get(b,'title').slice(0,500),url=safeUrl(get(b,'link'));
    // Consume only a bounded preview from the anonymous feed, never fetch the
    // article body or retain content:encoded HTML, embeds, images or audio.
    const description=source.publicPreviewOnly?publisherSummary(raw(b,'description')+' '+raw(b,'content:encoded'),600):publisherSummary(raw(b,'description'));
    const rawDate=get(b,'pubDate')||get(b,'dc:date'),ms=publisherDateMillis(rawDate);
    if(!title||!url||rawDate&&(!Number.isFinite(ms)||ms>now+300000))return null;
    const record={id:createHash('sha256').update(url).digest('hex').slice(0,18),title,url,summary:description||null,publishedAt:Number.isFinite(ms)?new Date(ms).toISOString():null,discoveredAt:null,dateBasis:Number.isFinite(ms)?'publisher-publication':'publication-unknown',publicationPrecision:Number.isFinite(ms)?'timestamp':'unknown',eventDate:null,source:source.name,sourceId:source.id,publisher:source.name,type:source.type,contentAccess:source.publicPreviewOnly?'Public RSS preview · full article may require a subscription':description?'publisher-summary':'headline-only',...(source.publicPreviewOnly?{evidenceStatus:'Independent energy analysis · claims not independently verified'}:{})};
    return {...record,...classifyReport(record)};
  }).filter(Boolean);
}
export function parseEIA(html, now=Date.now(),limit=180) {
  const result=[];const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for(const [,row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const label=row.match(/class=['"]B6['"][^>]*>([\s\S]*?)<\/td>/i)?.[1];
    const match=plain(label||'').match(/(\d{4})\s+([A-Z][a-z]{2})-\s*(\d{1,2})\s+to/);
    if(!match)continue;
    const start=Date.UTC(+match[1],months.indexOf(match[2]),+match[3]);
    const cells=[...row.matchAll(/class=['"]B3['"][^>]*>([\s\S]*?)<\/td>/gi)].map(x=>plain(x[1]));
    cells.forEach((v,i)=>{const date=start+i*86400000;if(/^\d+(\.\d+)?$/.test(v)&&date<=now)result.push({date:new Date(date).toISOString().slice(0,10),value:Number(v)});});
  }
  if(!result.length)throw new Error('EIA table format changed or no observations returned');
  return {observations:result.slice(-Math.max(1,Math.min(800,limit))),releaseDate:html.match(/Release Date:\s*([\d/]+)/)?.[1]||null};
}
export function freshness(latest, now=Date.now(), hours=72) {return !latest?'unknown':now-Date.parse(latest)>hours*3600000?'stale':'current';}
