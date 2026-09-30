import {isCurrentVesselPosition} from './vessel-data.mjs';
// Shared display policy. Transport success is separate from content availability.
export const SOURCE_DEFINITIONS = [
  {id:'polymarket',name:'Polymarket · expectations',group:'expectations',interval:60,freshnessBasis:'retrieval',freshnessAfterSeconds:600,home:'https://polymarket.com/',limitations:'Public market snapshots; probabilities express market expectations, not confirmation. Background checks run every five minutes; the open view checks each minute.'},
  {id:'hormuz-letter',name:'The Hormuz Letter · tracked posts',group:'sourceWatch',interval:300,freshnessBasis:'retrieval',freshnessAfterSeconds:900,home:'https://x.com/HormuzLetter',limitations:'Preferred source. Only explicitly tracked posts are checked through public X excerpts; automatic discovery of new posts is not connected.'},
  {id:'bbc',name:'BBC Middle East',group:'news',interval:300,home:'https://www.bbc.com/news/world/middle_east'},
  {id:'aj',name:'Al Jazeera',group:'news',interval:300,home:'https://www.aljazeera.com/middle-east/'},
  {id:'mee',name:'Middle East Eye',group:'news',interval:300,home:'https://www.middleeasteye.net/'},
  {id:'memo',name:'Middle East Monitor',group:'news',interval:300,home:'https://www.middleeastmonitor.com/'},
  {id:'france24',name:'France 24 Middle East',group:'news',interval:300,home:'https://www.france24.com/en/middle-east/'},
  {id:'un',name:'UN News',group:'news',interval:600,home:'https://news.un.org/en/news/region/middle-east'},
  {id:'centcom',name:'CENTCOM',group:'news',interval:900,home:'https://www.centcom.mil/MEDIA/PRESS-RELEASES/'},
  {id:'eia-news',name:'EIA · Today in Energy',group:'news',interval:900,home:'https://www.eia.gov/todayinenergy/'},
  {id:'doomberg',name:'Doomberg · energy analysis',group:'news',interval:3600,freshnessAfterSeconds:1209600,home:'https://newsletter.doomberg.com/',limitations:'Independent analysis · public previews only; full articles may require payment. Publisher expects 6–8 articles per month; this is not a breaking-news feed.'},
  ...[['gdelt-hormuz','Hormuz discovery'],['gdelt-redsea','Red Sea discovery'],['gdelt-exports','Regional exports'],['gdelt-energy','Energy and diplomacy'],['gdelt-reuters','Reuters topic discovery']].map(([id,name])=>({id,name:'GDELT · '+name,group:'discovery',interval:900,freshnessBasis:'retrieval',freshnessAfterSeconds:3600,home:'https://www.gdeltproject.org/'})),
  {id:'reliefweb',name:'ReliefWeb',group:'news',interval:900,optional:'reliefweb',home:'https://reliefweb.int/'},
  {id:'brent',name:'EIA Brent',group:'oil',interval:3600,home:'https://www.eia.gov/dnav/pet/hist/RBRTEd.htm'},
  {id:'wti',name:'EIA WTI',group:'oil',interval:3600,home:'https://www.eia.gov/dnav/pet/hist/RWTCd.htm'},
  {id:'crude-stocks',name:'EIA U.S. crude stocks',group:'market',interval:3600,freshnessAfterSeconds:1209600,optional:'eia',home:'https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=WCESTUS1&f=W'},
  {id:'refinery-use',name:'EIA U.S. refinery use',group:'market',interval:3600,freshnessAfterSeconds:1209600,optional:'eia',home:'https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=WPULEUS3&f=W'},
  {id:'marine',name:'Open-Meteo Marine',group:'weather',interval:1800,home:'https://open-meteo.com/en/docs/marine-weather-api'},
  {id:'wind',name:'Open-Meteo Weather',group:'weather',interval:1800,home:'https://open-meteo.com/en/docs'},
  {id:'aisstream',name:'AISStream',group:'vessels',interval:10,optional:'aisstream',home:'https://aisstream.io/'},
  {id:'openwaters',name:'Open Waters aiscast',group:'vessels',interval:10,home:'https://openwaters.io/api/ais/'},
  {id:'imo-hormuz',name:'IMO · Hormuz & Middle East',group:'maritime',interval:1800,freshnessAfterSeconds:86400,freshnessBasis:'retrieval',home:'https://www.imo.org/en/mediacentre/hottopics/pages/middle-east-highlighted-incidents.aspx'},
  {id:'imo-redsea',name:'IMO · Red Sea statements',group:'maritime',interval:1800,freshnessAfterSeconds:86400,freshnessBasis:'retrieval',home:'https://www.imo.org/en/mediacentre/hottopics/pages/red-sea.aspx'},
  {id:'acled',name:'ACLED',group:'acled',interval:3600,optional:'acled',home:'https://acleddata.com/'},
];
const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
export function ageSeconds(value, now=Date.now()) { const d=date(value); return d && Date.parse(d)<=now+60000 ? Math.max(0,Math.floor((now-Date.parse(d))/1000)) : null; }
export function sourceHealth(input, now=Date.now()) {
  const s={...input};
  s.retrievedAt=date(s.retrievedAt); s.latest=date(s.latest);
  s.latestRelevant=date(s.latestRelevant); s.nextRetryAt=date(s.nextRetryAt);
  s.latestDiscoveredAt=date(s.latestDiscoveredAt);
  s.discoveryAgeSeconds=ageSeconds(s.latestDiscoveredAt,now);
  s.retrievalAgeSeconds=ageSeconds(s.retrievedAt,now);
  s.contentAgeSeconds=ageSeconds(s.group==='news'?s.latestRelevant:s.latest,now);
  const enabled=s.configured!==false && s.configured!==null;
  const count=Number.isInteger(s.recordCount)?s.recordCount:null;
  s.hasData=enabled && count!==null && count>0;
  const failed=['cached','unavailable','disconnected'].includes(s.connection) || !!s.localFailure;
  const checkAfter=Math.max(3600,(Number.isFinite(s.interval)&&s.interval>0?s.interval:s.group==='acled'?3600:300)*3);
  s.checkOverdue=enabled&&['news','acled'].includes(s.group)&&s.connection==='connected'&&s.retrievalAgeSeconds!==null&&s.retrievalAgeSeconds>=checkAfter;
  // Incident registers are fresh when checked recently; event age describes
  // historical activity and must not masquerade as a failed source. The 24h
  // register and 10m vessel thresholds are Passage policy, not provider SLAs.
  const freshnessAge=s.freshnessBasis==='retrieval'||s.group==='maritime'?s.retrievalAgeSeconds:s.contentAgeSeconds;
  const freshnessAfter=s.freshnessAfterSeconds??(s.group==='vessels'?600:s.group==='oil'?864000:s.group==='maritime'?86400:259200);
  s.freshness=freshnessAge===null?'unknown':freshnessAge>=freshnessAfter?'stale':'current';
  if(s.id==='aisstream' && s.timestampBasis!=='provider')s.freshness='unknown';
  s.status=!enabled?'disabled':s.connection==='loading'?'loading':failed?(s.hasData?'retained':'unavailable'):['maritime','discovery'].includes(s.group)&&s.freshness==='stale'?'stale':count===0?'empty':s.freshness==='stale'?'stale':s.freshness==='unknown'?'unknown':'current';
  if(s.checkOverdue)s.status='stale';
  if(enabled && !s.retrievedAt && s.group!=='vessels' && s.connection!=='loading')s.status='unavailable';
  if(s.group==='vessels' && ['idle','connecting'].includes(s.connection))s.status=s.connection==='idle'?'paused':'loading';
  const emptyLabel=s.group==='vessels'?(s.id==='aisstream'&&s.positionFrames===0?'Connected · no vessel positions received':'No usable positions received'):s.group==='maritime'?'Source checked · no listed records':s.group==='discovery'?'Discovery checked · no matching metadata':s.group==='news'?'Source checked · no relevant reports':s.group==='oil'?'No usable price observations':s.group==='expectations'?'No eligible active markets':s.group==='sourceWatch'?'No tracked excerpts available':s.group==='market'?'No usable market observations':s.group==='acled'?'No matching structured events':'No usable forecast data';
  const staleLabel=s.checkOverdue?'Source check overdue':s.group==='vessels'?'Position data over 10 minutes old':s.group==='maritime'?'Source check over 24 hours old':s.group==='discovery'?'Discovery check over one hour old':s.group==='news'?'Source responding · older relevant reports':'Older observations available';
  s.label=({disabled:s.configured===null?'Checking configuration':'Not configured',loading:s.group==='discovery'?'Checking discovery index':'Checking source',paused:s.hasData?'Live reception paused · retained positions':'Live reception paused while view is closed',unavailable:s.group==='discovery'?'Discovery unavailable':'Unavailable',retained:s.group==='discovery'?'Retained discovery · update failed':'Cached data · update failed',empty:emptyLabel,stale:staleLabel,unknown:s.group==='weather'?'Model-run age unknown':'Observation age unknown',current:s.group==='maritime'?'Official source available':s.group==='discovery'?'Discovery checked · publication dates unknown':'Data available'})[s.status];
  if(s.id==='acled'&&s.connection==='connected'&&enabled){
    const latest=s.latest?' · latest '+new Date(s.latest).toISOString().slice(0,10):'';
    s.label=s.checkOverdue?'Source check overdue'+latest:s.sampleOnly===false?(s.hasData?(s.status==='stale'?'Older structured events':'Structured events available')+latest:'No matching structured events'):s.hasData?'Access verified · sample only':'Access verified · empty sample';
  }
  // Publication/event age is a coverage limitation, not evidence of a broken
  // connection. Vessel and price ages still identify unusably old observations.
  const olderContent=['news','acled'].includes(s.group)&&s.connection==='connected'&&s.status==='stale'&&!s.checkOverdue;
  s.attentionReason=!enabled?null:s.cacheIssue?'cache':['unavailable','retained'].includes(s.status)?'update':s.group==='vessels'&&['empty','unknown'].includes(s.status)?'reception':s.checkOverdue?'check':s.group==='vessels'&&s.freshness==='stale'?'observation':s.status==='stale'&&!olderContent?(['maritime','discovery'].includes(s.group)?'check':'observation'):null;
  s.attention=s.attentionReason!==null;
  s.coverageStatus=!enabled?'disabled':s.status==='loading'?'checking':s.status==='unavailable'?'unavailable':s.attention||['stale','paused'].includes(s.status)||s.possiblyTruncated?'limited':s.hasData?'available':'no-matches';
  if(s.id==='hormuz-letter'&&s.connection==='connected'){s.label=s.freshness==='stale'?'Tracked-post check overdue':'Tracked posts checked · new-post discovery unavailable';s.coverageStatus='limited';}
  return s;
}
export function collectSources(state,now=Date.now()) {
  const raw=[...(state.expectations?.source?[state.expectations.source]:[]),...(state.sourceWatch?.source?[state.sourceWatch.source]:[]),...(state.maritime?.sources||[]),...(state.news?.sources||[]),...[...(state.oil?.series||[]),...(state.market?.series||[])].map(s=>({...s,recordCount:s.observations?.length||0,latest:s.observations?.at(-1)?.date||null})),...(state.weather?.sources||[]),...(state.vessels?.source?[state.vessels.source]:[]),...(state.vessels?.fallback?[state.vessels.fallback]:[]),...(state.acled?.source?[state.acled.source]:[])];
  return SOURCE_DEFINITIONS.map(def=>{
    const value=raw.find(s=>s.id===def.id);
    let configured=def.optional?(state.config?!!state.config[def.optional]:null):true;
    if(value?.configured!==undefined)configured=value.configured;
    if(def.id==='aisstream' && state.vessels)configured=state.vessels.configured;
    const s={...def,...value,name:def.name,configured,connection:value?.connection||(configured===false?'not configured':'loading')};
    // Compatibility for a cache written before the source-health metadata existed.
    if(def.group==='news' && value&&!Number.isInteger(value.recordCount)){const matches=(state.news?.items||[]).filter(x=>x.sourceId===def.id);s.recordCount=matches.length;s.latestRelevant=matches.map(x=>x.publishedAt).filter(Boolean).sort().at(-1)||null;}
    if(def.group==='weather' && value)s.recordCount=state.weather.theaters?.filter(t=>t[def.id==='marine'?'marine':'wind']).length||0;
    if(def.group==='vessels' && state.vessels){
      const positions=(state.vessels.vessels||[]).filter(v=>(def.id==='openwaters'?v.provider==='Open Waters':v.provider!=='Open Waters')&&isCurrentVesselPosition(v,now));
      s.recordCount=positions.length;
      const newest=positions.slice().sort((a,b)=>b.positionTime.localeCompare(a.positionTime))[0];
      s.latest=newest?.sourceAt||null;s.timestampBasis=newest?.timestampBasis||null;
      if(def.id==='aisstream'){s.frames=state.vessels.source?.frames??0;s.positionFrames=state.vessels.source?.positionFrames??0;s.positionsAccepted=state.vessels.source?.positionsAccepted??positions.length;}
    }
    if(state.failures?.[def.group]||def.group==='discovery'&&state.failures?.news){s.localFailure=true;s.connection=s.retrievedAt?'cached':'unavailable';s.error='Local server request failed. Previously retrieved data is retained.';}
    return sourceHealth(s,now);
  });
}
export function coverage(sources,group='news') {
  const list=sources.filter(s=>(s.group===group||group==='news'&&s.group==='discovery') && s.configured!==false && s.configured!==null);
  const usable=list.some(s=>s.hasData);
  const pending=list.some(s=>s.status==='loading');
  const incomplete=list.some(s=>['unavailable','retained','stale','loading'].includes(s.status));
  const successful=list.some(s=>s.connection==='connected');
  return {usable,pending,incomplete,unknown:!usable&&!successful,empty:!usable&&successful&&!incomplete,
    label:!usable&&!successful?(pending?'Checking reporting sources':'Reporting unavailable'):incomplete?(usable?'Incomplete coverage · retrieved reports only':'Coverage incomplete · no usable reporting'):'Retrieved reports only'};
}
export function statusSummary(sources) {
  const enabled=sources.filter(s=>s.configured===true),checking=enabled.some(s=>s.status==='loading')||sources.some(s=>s.configured===null);
  const updates=enabled.some(s=>['retained','unavailable'].includes(s.status)),reception=enabled.some(s=>s.attentionReason==='reception');
  const messages=[];
  if(updates)messages.push('Source updates incomplete');
  if(reception)messages.push(messages.length?'vessel reception limited':'Vessel reception limited');
  if(messages.length)return messages.join(' · ');
  if(enabled.some(s=>s.cacheIssue))return 'Local cache needs attention';
  if(enabled.some(s=>s.attentionReason==='check'))return 'Some source checks are overdue';
  if(enabled.some(s=>s.attentionReason==='observation'))return 'Some observations need an update';
  if(checking)return 'Checking source coverage';
  if(!enabled.length)return 'No sources configured';
  if(enabled.some(s=>s.status==='paused'))return 'Vessel reception paused';
  if(enabled.some(s=>s.status==='stale'))return 'Sources responding · older material available';
  return enabled.some(s=>s.hasData)?'Sources responding':'Sources checked · no usable records';
}
export function panelNotice(sources,group) {
  const list=sources.filter(s=>(s.group===group||group==='news'&&s.group==='discovery')&&s.configured===true);
  if(!list.length)return '';
  const failed=list.filter(s=>['retained','unavailable'].includes(s.status));
  if(failed.length){
    const isDiscovery=s=>s.group==='discovery'&&s.id?.startsWith('gdelt-');
    const names=[...new Set(failed.map(s=>isDiscovery(s)?'GDELT discovery':s.name))];
    if(failed.every(isDiscovery))return `GDELT discovery: update delayed. ${failed.some(s=>s.hasData)?'Retained reporting is shown.':list.some(s=>s.hasData)?'Available reporting is shown.':'No usable reporting is available.'} Inspect Sources.`;
    return `${names.join(', ')}: update failed. ${failed.some(s=>s.hasData)?'Previously retrieved data is shown; coverage is incomplete.':list.some(s=>s.hasData)?'Available source data is shown; coverage is incomplete.':'No usable data is available.'}`;
  }
  if(list.some(s=>s.status==='loading'))return 'Checking sources. Coverage is not yet established.';
  if(group==='vessels'&&list.some(s=>s.attentionReason==='reception'))return list.some(s=>s.hasData)?'Some vessel feeds have a reception gap. Positions from responding feeds are shown; the map is not a complete traffic census.':'No usable vessel positions have been received. This is a reception gap, not evidence that the waters are empty.';
  if(group==='vessels'&&list.some(s=>s.status==='paused'))return 'Live vessel reception is paused while the view is closed. Retained positions keep their original observation times.';
  if(list.some(s=>s.status==='stale'))return 'Some sources contain older material. Check publication and observation dates in Sources.';
  if(list.some(s=>s.cacheIssue))return 'Data retrieved, but the local cache could not be saved. Open Sources for details.';
  return group==='weather'?'Forecast valid times are shown below. Original model-run age is unknown.':'';
}
