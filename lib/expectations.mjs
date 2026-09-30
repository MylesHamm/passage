import {SourceError} from './source-runtime.mjs';

const QUERIES=['Hormuz','Houthis','Iran oil','Iran ceasefire'];
const LIMIT=5,MIN_LIQUIDITY=1000;
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const cleanText=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max?value.trim():null;
const number=(value,max=Infinity)=>['number','string'].includes(typeof value)&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=max?Number(value):null;
function date(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const [year,month,day]=value.slice(0,10).split('-').map(Number),ms=Date.parse(value);
 if(!Number.isFinite(ms)||new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10)!==value.slice(0,10))return null;
 return new Date(ms).toISOString();
}
function expiredQuestion(question,endDate,now){
 // Gamma can retain active=true after a question's deadline. Allow the entire named
 // calendar day worldwide before excluding it; the provider's exact endDate is also checked.
 const match=question.match(/\b(?:by|before|end of|end-of)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s*(?:(\d{1,2})(?:st|nd|rd|th)?\b)?(?:\s*,?\s*(20\d{2}))?/i);
 if(!match)return false;
 const month=MONTHS.indexOf(match[1].toLowerCase()),end=new Date(endDate);
 let year=match[3]?Number(match[3]):end.getUTCFullYear();
 if(!match[3]&&month===11&&end.getUTCMonth()===0)year--;
 const day=match[2]?Number(match[2]):new Date(Date.UTC(year,month+1,0)).getUTCDate();
 return Date.UTC(year,month,day+1,12)<now;
}
function classify(question){
 if(/\b(?:football|basketball|world cup|nba|nfl|soccer|championship|election|presiden(?:t|cy))\b/i.test(question))return null;
 if(/\bhormuz\b/i.test(question)&&/\b(?:traffic|transits?|(?:war)?ships?|shipping|tankers?|open|close|closure|normal|control|blockade)\b/i.test(question)){
  return {theater:'hormuz',topic:/\b(?:normal|reopen|restor|resume)/i.test(question)?'Shipping recovery':'Hormuz access'};
 }
 if(/\b(?:houthis?|houthi|red sea|bab.el.mandeb)\b/i.test(question)&&/\b(?:ships?|shipping|tankers?|transit|vessels?)\b/i.test(question)){
  return {theater:'bab',topic:/\b(?:seize|seizure|capture|hijack)\b/i.test(question)?'Tanker seizure':'Shipping attacks'};
 }
 if(/\b(?:iran|saudi|abqaiq|ras tanura|yemen|houthi|houthis|uae|qatar|gulf)\b/i.test(question)&&/\b(?:oil|crude|refiner(?:y|ies)|pipeline|lng|gas|export terminals?)\b/i.test(question))return {theater:'both',topic:'Oil supply'};
 if(/\biran\b/i.test(question)&&/\b(?:ceasefire|peace|war ends?|war end|end the war)\b/i.test(question))return {theater:'hormuz',topic:'Diplomacy'};
 return null;
}

// Public Gamma metadata fields and search parameters:
// https://docs.polymarket.com/api-reference/search/search-markets-events-and-profiles
export function normalizeExpectation(market,event={},now=Date.now()){
 if(!market||typeof market!=='object'||market.active!==true||market.closed===true||market.archived===true||market.acceptingOrders===false||market.umaResolutionStatus==='resolved'||event.closed===true||event.archived===true||event.active===false)return null;
 const question=cleanText(market.question,1000),description=cleanText(market.description,20000),endDate=date(market.endDate);
 const slug=cleanText(market.slug,300),eventSlug=cleanText(event.slug,300),id=cleanText(market.id,100);
 if(!question||!description||!endDate||Date.parse(endDate)<=now||!slug||!eventSlug||!id||![slug,eventSlug,id].every(s=>/^[a-z\d_-]+$/i.test(s))||expiredQuestion(question,endDate,now))return null;
 const classification=classify(question);if(!classification)return null;
 let outcomes;try{outcomes=typeof market.outcomes==='string'?JSON.parse(market.outcomes):market.outcomes;}catch{return null;}
 // Gamma bid/ask fields are for the first outcome. Require Yes first to avoid
 // displaying a No quote as a Yes probability or guessing an undocumented mapping.
 if(!Array.isArray(outcomes)||outcomes.length!==2||outcomes[0]!=='Yes'||outcomes[1]!=='No')return null;
 const liquidityUsd=number(market.liquidityNum??market.liquidity);
 if(liquidityUsd===null||liquidityUsd<MIN_LIQUIDITY)return null;
 let bestBid=number(market.bestBid,1),bestAsk=number(market.bestAsk,1);
 if(bestBid!==null&&bestAsk!==null&&bestBid>bestAsk){bestBid=null;bestAsk=null;}
 const spread=bestBid!==null&&bestAsk!==null?Number((bestAsk-bestBid).toFixed(8)):null,last=number(market.lastTradePrice,1);
 // Polymarket displays midpoint unless spread exceeds $0.10, then last trade.
 // These quotes are the Gamma snapshot, not a direct streaming CLOB quote.
 // https://docs.polymarket.com/concepts/prices-orderbook
 const midpoint=spread!==null&&spread<=0.1;
 const probability=midpoint?Number(((bestBid+bestAsk)/2).toFixed(8)):last;
 const updated=date(market.updatedAt);
 return {id,question,url:`https://polymarket.com/event/${eventSlug}/${slug}`,...classification,probability,
  priceBasis:probability===null?'No valid quote':midpoint?'Gamma order-book midpoint':'Gamma last trade',
  bestBid,bestAsk,spread,liquidityUsd,volume24hUsd:number(market.volume24hr),endDate,
  updatedAt:updated&&Date.parse(updated)<=now?updated:null,description};
}

export function selectExpectations(items){
 const unique=[...new Map(items.filter(Boolean).map(item=>[item.id,item])).values()];
 const ordered=unique.sort((a,b)=>Number(b.probability!==null)-Number(a.probability!==null)||b.liquidityUsd-a.liquidityUsd||a.id.localeCompare(b.id));
 const selected=[],topics=new Map(),events=new Map();
 function accept(item,firstPass){
  const key=`${item.theater}:${item.topic}`,eventKey=new URL(item.url).pathname.split('/')[2];
  if(selected.length>=LIMIT||selected.some(s=>s.id===item.id)||(topics.get(key)||0)>=(firstPass?1:2)||(events.get(eventKey)||0)>=2)return;
  selected.push(item);topics.set(key,(topics.get(key)||0)+1);events.set(eventKey,(events.get(eventKey)||0)+1);
 }
 ordered.forEach(item=>accept(item,true));ordered.forEach(item=>accept(item,false));return selected;
}

export async function loadExpectations(runtime,context={}){
 // SourceRuntime uses seconds and preserves the original retrieval clock on failure.
 return runtime.get('polymarket',60,async({fetchText})=>{
  const payloads=await Promise.all(QUERIES.map(async q=>{
   const url=new URL('https://gamma-api.polymarket.com/public-search');
   for(const [key,value]of Object.entries({q,events_status:'active',limit_per_type:'8',search_profiles:'false',search_tags:'false'}))url.searchParams.set(key,value);
   let data;try{data=JSON.parse(await fetchText(url));}catch(error){throw error instanceof SourceError?error:new SourceError('schema');}
   if(!data||typeof data!=='object'||Array.isArray(data)||!Object.hasOwn(data,'events')||(data.events!==null&&!Array.isArray(data.events))||data.events?.length>100)throw new SourceError('schema');
   return data.events||[];
  }));
  const now=runtime.now(),items=[];
  for(const event of payloads.flat()){
   if(!event||typeof event!=='object'||!Array.isArray(event.markets)||event.markets.length>500)throw new SourceError('schema');
   for(const market of event.markets){
    if(!market||typeof market!=='object'||Array.isArray(market)||typeof market.id!=='string'||typeof market.question!=='string')throw new SourceError('schema');
    const item=normalizeExpectation(market,event,now);if(item)items.push(item);
   }
  }
  const markets=selectExpectations(items);
  // Gamma updatedAt is metadata time, not a price observation or trade timestamp.
  return {source:'Polymarket',markets,recordCount:markets.length,latestPublishedAt:null,observationDate:null,limit:LIMIT,notes:[
   'Market prices express participants’ expectations; a market is not a confirmed event or an oil-price forecast.',
   'Quotes are public Gamma snapshots. Updated is provider market metadata time, not the time of the last trade. Retrieval time is tracked separately.',
   'Bounded discovery covers Hormuz, Houthis, Iran oil and Iran ceasefire markets; this is not an exhaustive market catalog. Markets need at least $1,000 reported liquidity.',
   ...(!markets.length?['No eligible active binary markets were returned by the current searches.']:[]),
  ]};
 },context);
}
