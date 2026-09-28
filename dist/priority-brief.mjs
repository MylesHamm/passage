import {canonicalReportUrl} from './intelligence-data.mjs';

const WINDOW_HOURS=72,MAX_RECORDS=2000,MAX_PER_CARD=4;
const THEATRES=[{id:'hormuz',title:'Strait of Hormuz'},{id:'bab',title:'Bab el-Mandeb'}];
const HORMUZ=/\b(?:hormuz|iran|iranian|tehran|irgc|(?:islamic )?revolutionary guards?|persian gulf|arabian gulf|gulf of oman|fujairah|bandar)\b/i;
const BAB=/\b(?:bab[ -]?(?:el|al)[ -]?mand[ae]b|red sea|yemen|yemeni|houthis?|ansar[ -]?allah|aden|djibouti|suez)\b/i;
const REGION=/\b(?:saudi|aramco|yanbu|uae|emirati|united arab emirates|oman|omani|duqm|iraq|iraqi|basra|kuwait|qatar|bahrain|egypt|sumed|gulf|middle east)\b/i;
const MARITIME=/\b(?:ships?|shipping|vessels?|tankers?|maritime|seafarers?|crew|freight|navigation|transits?|chokepoints?|ports?|terminals?)\b/i;
const ENERGY=/\b(?:oil|crude|petroleum|brent|wti|opec|lng|diesel|gasoil|gasoline|natural gas|refiner\w*|pipeline\w*)\b/i;
const INFRASTRUCTURE=/\b(?:ports?|terminals?|pipeline\w*|refiner\w*|exports?|production|suppl\w*|loadings?|output|storage|inventor\w*)\b/i;
const DISRUPTION=/\b(?:halt\w*|suspend\w*|clos(?:e[ds]?|ure)|block(?:ed|ade|ades|ading)|disrupt\w*|outage\w*|damag\w*|rerout\w*|divert\w*|delay\w*|seiz\w*|seized|hijack\w*|sink\w*|sunk|sank|stranded)\b/i;
const SECURITY=/\b(?:attack\w*|missiles?|drones?|strikes?|struck|airstrikes?|bomb\w*|intercept\w*|seiz\w*|seized|hijack\w*|explosion\w*|(?:military|naval) (?:operations?|drills?|exercises?)|(?:military|forces) (?:target(?:s|ed|ing)?|mobili[sz](?:e[sd]?|ing)|advanc(?:e[sd]?|ing))|incidents?|security alerts?|missile alerts?)\b/i;
const POLICY=/\b(?:sanctions?|ceasefire|cease-fire|truce|peace (?:talks?|negotiat\w*)|nuclear (?:talks?|negotiat\w*|deal)|arming|disarm\w*|weapons?|arms embargo|military aid|war|blockade)\b/i;
const MARKET=/\b(?:(?:oil|crude|diesel|petroleum|gasoline|natural gas) (?:prices?|markets?|suppl\w*|demand|inventor\w*|stocks?)|brent|wti|opec|refining margins)\b/i;
const normalizedTitle=title=>title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const petroleumText=title=>title.replace(/\b(?:crude\s+)?(?:palm|olive|soy(?:bean)?|sunflower|coconut|cooking|vegetable|edible)\s+oil\b/gi,'food commodity');

function validDay(value){
  return typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
function validInstant(value){
  return typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&validDay(value.slice(0,10))&&Number.isFinite(Date.parse(value));
}
function clockFor(report){
  const day=report.publishedDate||report.publicationDate;
  if(report.publicationPrecision==='day'||!report.publishedAt&&day){
    const value=day||(typeof report.publishedAt==='string'?report.publishedAt.slice(0,10):null);
    return validDay(value)?{kind:'publication',value,precision:'day',label:'Publication date · exact time unknown'}:null;
  }
  if(report.publishedAt)return validInstant(report.publishedAt)?{kind:'publication',value:report.publishedAt,precision:'timestamp',label:'Published'}:null;
  return validInstant(report.discoveredAt)?{kind:'discovery',value:report.discoveredAt,precision:'timestamp',label:'Discovered · publication unknown'}:null;
}

// These are headline selection rules, not incident classification or geocoding.
// A topic tag supplied by a discovery query or RSS footer is never sufficient.
function headlineContext(title){
  const text=petroleumText(title),maritime=MARITIME.test(text),energy=ENERGY.test(text);
  const security=SECURITY.test(text),disruption=DISRUPTION.test(text),policy=POLICY.test(text);
  const infrastructure=INFRASTRUCTURE.test(text),market=MARKET.test(text);
  const theatres=[HORMUZ.test(text)?'hormuz':null,BAB.test(text)?'bab':null].filter(Boolean);
  const regional=REGION.test(text),energyContext=energy&&(infrastructure||market||disruption||security||policy);
  if(!theatres.length&&!(energyContext&&(regional||market)))return null;
  let importance=0,category='';
  if((maritime||energy)&&(disruption||security)){importance=5;category=disruption?(energy&&!maritime?'Energy disruption':'Shipping disruption'):'Shipping & energy security';}
  else if(infrastructure&&(energy||maritime)){importance=4;category='Ports, pipelines & supply';}
  else if(market){importance=3;category='Oil & market context';}
  else if(maritime){importance=3;category='Maritime access';}
  else if(security&&theatres.length){importance=2;category='Military & security';}
  else if(policy&&(theatres.length||regional)){importance=1;category='Conflict policy';}
  if(!importance)return null;
  return {theatres,importance,category,energyContext};
}
function directPublisher(report,clock){
  return clock.kind==='publication'&&report.dateBasis!=='discovery'&&report.type!=='Discovered reporting'&&!report.discoveryProvider&&report.contentAccess!=='discovery-metadata'&&!String(report.sourceId||'').startsWith('gdelt-');
}
// Copy count and outlet count deliberately play no part in ordering.
const compare=(a,b)=>b.context.importance-a.context.importance||Number(b.direct)-Number(a.direct)||Number(b.clock.kind==='publication')-Number(a.clock.kind==='publication')||b.time-a.time||a.canonical.localeCompare(b.canonical)||a.report.title.localeCompare(b.report.title);

/**
 * Select up to four recent headline groups per theatre, plus a separate energy
 * context card when needed. Copies match normalized headline text inside this
 * 72-hour window and publication day. Unknown publication dates join a known
 * day only when it is unambiguous; otherwise they remain a separate group.
 * Matching headlines are not assumed to describe one event or corroborate it.
 * Input records and their original titles, URLs, qualifiers and provenance are
 * retained unchanged as `report` and `copies`. No article bodies are generated.
 */
export function buildPriorityBrief(news,{now=Date.now(),theater='both',actor='all'}={}){
  const rows=Array.isArray(news)?news:Array.isArray(news?.items)?news.items:[];
  const validNow=Number.isFinite(now)&&Math.abs(now)<=8640000000000000;
  const groups=new Map(),selectedActor=String(actor||'all').toLowerCase();
  for(const report of rows.slice(0,MAX_RECORDS)){
    if(!validNow||!report||typeof report.title!=='string'||!report.title.trim()||report.title.length>2000||report.manual||report.type==='Reviewed context')continue;
    if(selectedActor!=='all'&&!(Array.isArray(report.actors)?report.actors:[]).some(value=>typeof value==='string'&&value.toLowerCase()===selectedActor))continue;
    const canonical=canonicalReportUrl(report.url),clock=clockFor(report),context=headlineContext(report.title);
    if(!canonical||!clock||!context)continue;
    const time=Date.parse(clock.value);
    if(time>now||time<now-WINDOW_HOURS*3600000)continue;
    const key=normalizedTitle(report.title),candidate={report,canonical,clock,context,time,direct:directPublisher(report,clock)};
    if(!key)continue;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(candidate);
  }
  const ranked=[...groups.entries()].flatMap(([key,matches])=>{
    const publicationDay=item=>item.clock.kind==='publication'?item.clock.value.slice(0,10):null;
    const knownDays=new Set(matches.map(publicationDay).filter(Boolean));
    const unknownGroup=knownDays.size===1?[...knownDays][0]:'unknown',byDay=new Map();
    for(const candidate of matches){
      const day=publicationDay(candidate)||unknownGroup;
      if(!byDay.has(day))byDay.set(day,[]);
      byDay.get(day).push(candidate);
    }
    return [...byDay.entries()].map(([day,candidates])=>{
      candidates.sort(compare);
      const best=candidates[0],sourceUrls=[...new Map(candidates.map(item=>[item.canonical,item.report.url])).values()];
      return {...best,group:{id:'headline:'+key+':'+day,title:best.report.title,url:best.report.url,report:best.report,clock:best.clock,category:best.context.category,copies:candidates.map(item=>item.report),sourceUrls,copyCount:sourceUrls.length,repeatedHeadline:sourceUrls.length>1,independentConfirmation:false}};
    });
  }).sort(compare);
  const requested=['hormuz','bab'].includes(theater)?theater:'both';
  const cards=THEATRES.filter(item=>requested==='both'||requested===item.id).map(definition=>{
    const matches=ranked.filter(item=>item.context.theatres.includes(definition.id));
    return {...definition,items:matches.slice(0,MAX_PER_CARD).map(item=>item.group),groupCount:matches.length,selectedCount:Math.min(matches.length,MAX_PER_CARD)};
  });
  // A regional export or oil-market headline is context, not an invented match
  // to either waterway. Theatre-specific energy reports remain in their card.
  const energy=ranked.filter(item=>!item.context.theatres.length&&item.context.energyContext);
  if(energy.length)cards.push({id:'energy',title:'Regional energy & exports',items:energy.slice(0,MAX_PER_CARD).map(item=>item.group),groupCount:energy.length,selectedCount:Math.min(energy.length,MAX_PER_CARD)});
  return {cards,uniqueGroupCount:new Set(cards.flatMap(item=>item.items.map(group=>group.id))).size,windowHours:WINDOW_HOURS,generatedAt:validNow?new Date(now).toISOString():null,inputTruncated:rows.length>MAX_RECORDS,scopeNote:'Selected recent source headlines; not a complete event record. Matching headlines are repeated coverage, not independent corroboration. Theatre labels indicate headline relevance, not incident location.'};
}
