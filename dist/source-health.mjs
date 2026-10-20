import {RETIRED_SOURCE_IDS,CORE_REPORTING_IDS} from './source-policy.mjs';
// Shared display policy. Transport success is separate from content availability.
export const SOURCE_DEFINITIONS = [
  {id:'polymarket',name:'Polymarket · expectations',group:'expectations',interval:60,freshnessBasis:'retrieval',freshnessAfterSeconds:600,home:'https://polymarket.com/',limitations:'Public market snapshots; probabilities express market expectations, not confirmation. Background checks run every five minutes; the open view checks each minute.'},
  {id:'bbc',name:'BBC Middle East',group:'news',interval:300,home:'https://www.bbc.com/news/world/middle_east'},
  {id:'aj',name:'Al Jazeera',group:'news',interval:300,home:'https://www.aljazeera.com/middle-east/'},
  {id:'mee',name:'Middle East Eye',group:'news',interval:300,home:'https://www.middleeasteye.net/'},
  {id:'memo',name:'Middle East Monitor',group:'news',interval:300,home:'https://www.middleeastmonitor.com/'},
  {id:'france24',name:'France 24 Middle East',group:'news',interval:300,home:'https://www.france24.com/en/middle-east/'},
  {id:'un',name:'UN News',group:'news',interval:600,home:'https://news.un.org/en/news/region/middle-east'},
  {id:'brent',name:'EIA Brent',group:'oil',interval:3600,home:'https://www.eia.gov/dnav/pet/hist/RBRTEd.htm'},
  {id:'wti',name:'EIA WTI',group:'oil',interval:3600,home:'https://www.eia.gov/dnav/pet/hist/RWTCd.htm'},
  {id:'eia-today',name:'EIA · next-day spot close',group:'oil',interval:3600,freshnessAfterSeconds:345600,home:'https://www.eia.gov/todayinenergy/prices.php',limitations:'Previous trading day close as republished on EIA Today in Energy.'},
  {id:'portwatch',name:'IMF PortWatch · transits',group:'transits',interval:3600,freshnessAfterSeconds:864000,home:'https://portwatch.imf.org/',limitations:'Daily chokepoint transits derived from satellite AIS; released weekly.'},
  {id:'aisstream',name:'AISStream',group:'vessels',interval:10,optional:'aisstream',home:'https://aisstream.io/'},
  {id:'imo-hormuz',name:'IMO · Hormuz & Middle East',group:'maritime',interval:1800,freshnessAfterSeconds:86400,freshnessBasis:'retrieval',home:'https://www.imo.org/en/mediacentre/hottopics/pages/middle-east-highlighted-incidents.aspx'},
  {id:'imo-redsea',name:'IMO · Red Sea statements',group:'maritime',interval:1800,freshnessAfterSeconds:86400,freshnessBasis:'retrieval',home:'https://www.imo.org/en/mediacentre/hottopics/pages/red-sea.aspx'},
].map(definition=>({...definition,capability:CORE_REPORTING_IDS.includes(definition.id)||['brent','wti','imo-hormuz','imo-redsea'].includes(definition.id)?'core':'supporting',...(RETIRED_SOURCE_IDS.includes(definition.id)?{defaultEnabled:false,retired:true,retirementReason:definition.id==='centcom'?'Collector retired after repeated schema failures; original evidence remains in the archive.':definition.id==='marad-advisories'?'Collection retired because the provider rejects access from this deployment. Current advisory coverage is unavailable.':'Discovery collection retired after persistent provider failures; dated historical metadata remains in the archive.'}:{})}));
const date = value => {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)||!Number.isFinite(Date.parse(value)))return null;const calendar=value.slice(0,10);return new Date(calendar+'T00:00:00Z').toISOString().slice(0,10)===calendar?value:null;};
export function ageSeconds(value, now=Date.now()) { const d=date(value); return d && Date.parse(d)<=now+60000 ? Math.max(0,Math.floor((now-Date.parse(d))/1000)) : null; }
export function sourceHealth(input, now=Date.now()) {
  const s={...input};
  s.retrievedAt=date(s.retrievedAt); s.latest=date(s.latest);
  s.latestRelevant=date(s.latestRelevant); s.nextRetryAt=date(s.nextRetryAt);
  s.latestDiscoveredAt=date(s.latestDiscoveredAt);
  s.discoveryAgeSeconds=ageSeconds(s.latestDiscoveredAt,now);
  s.retrievalAgeSeconds=ageSeconds(s.retrievedAt,now);
  s.lastAttemptAt=date(s.checkedAt);
  s.successfulCheck=s.connection==='connected'&&s.retrievalAgeSeconds!==null&&!s.localFailure&&!s.error&&!s.errorCategory;
  s.contentAgeSeconds=ageSeconds(s.group==='news'?s.latestRelevant:s.latest,now);
  const enabled=s.configured!==false && s.configured!==null;
  s.configurationFailed=s.configured===null && !!s.configurationFailed;
  const count=Number.isInteger(s.recordCount)?s.recordCount:null;
  s.hasData=enabled && count!==null && count>0;
  const failed=['cached','unavailable','disconnected'].includes(s.connection) || !!s.localFailure || !!s.error || !!s.errorCategory;
  const checkAfter=Math.max(3600,(Number.isFinite(s.interval)&&s.interval>0?s.interval:s.group==='acled'?3600:300)*3);
  s.checkOverdue=enabled&&['news','acled'].includes(s.group)&&s.connection==='connected'&&s.retrievalAgeSeconds!==null&&s.retrievalAgeSeconds>=checkAfter;
  // Incident registers are fresh when checked recently; event age describes
  // historical activity and must not masquerade as a failed source. The 24h
  // register and 10m vessel thresholds are Passage policy, not provider SLAs.
  const freshnessAge=s.freshnessBasis==='retrieval'||s.group==='maritime'?s.retrievalAgeSeconds:s.contentAgeSeconds;
  const freshnessAfter=s.freshnessAfterSeconds??(s.group==='vessels'?600:s.group==='oil'?864000:s.group==='maritime'?86400:259200);
  s.freshness=freshnessAge===null?'unknown':freshnessAge>=freshnessAfter?'stale':'current';
  if(s.id==='aisstream' && s.timestampBasis!=='provider')s.freshness='unknown';
  s.status=s.configurationFailed?'unavailable':!enabled?'disabled':s.connection==='loading'?'loading':failed?(s.hasData?'retained':'unavailable'):['maritime','discovery'].includes(s.group)&&s.freshness==='stale'?'stale':count===0?(s.connection==='connected'?'empty':'unknown'):s.freshness==='stale'?'stale':s.freshness==='unknown'?'unknown':'current';
  if(s.checkOverdue)s.status='stale';
  if(enabled && !s.retrievedAt && s.group!=='vessels' && s.connection!=='loading')s.status='unavailable';
  if(!s.configurationFailed && s.group==='vessels' && ['idle','connecting'].includes(s.connection))s.status=s.connection==='idle'?'paused':'loading';
  const emptyLabel=s.group==='vessels'?(s.id==='aisstream'&&s.positionFrames===0?'Connected · no vessel positions received':'No usable positions received'):s.group==='maritime'?'Source checked · no listed records':s.group==='discovery'?'Discovery checked · no matching metadata':s.group==='news'?'Source checked · no relevant reports':s.group==='oil'?'No usable price observations':s.group==='expectations'?'No eligible active markets':s.group==='market'?'No usable market observations':s.group==='acled'?'No matching structured events':'No usable forecast data';
  const staleLabel=s.checkOverdue?'Source check overdue':s.group==='vessels'?'Position data over 10 minutes old':s.group==='maritime'?'Source check over 24 hours old':s.group==='discovery'?'Discovery check over one hour old':s.group==='news'?'Source responding · older relevant reports':'Older observations available';
  s.label=({disabled:s.retired?'Collection retired · archive retained':s.configured===null?'Checking configuration':'Not configured',loading:s.group==='discovery'?'Checking discovery index':'Checking source',paused:s.hasData?'Live reception paused · retained positions':'Live reception paused while view is closed',unavailable:s.configurationFailed?'Configuration unavailable':s.group==='discovery'?'Discovery unavailable':'Unavailable',retained:s.group==='discovery'?'Retained discovery · update failed':'Cached data · update failed',empty:emptyLabel,stale:staleLabel,unknown:s.group==='weather'?'Model-run age unknown':'Observation age unknown',current:s.group==='maritime'?'Official source available':s.group==='discovery'?'Discovery checked · publication dates unknown':'Data available'})[s.status];
  if(s.id==='acled'&&s.connection==='connected'&&enabled){
    const latest=s.latest?' · latest '+new Date(s.latest).toISOString().slice(0,10):'';
    s.label=s.checkOverdue?'Source check overdue'+latest:s.sampleOnly===false?(s.hasData?(s.status==='stale'?'Older structured events':'Structured events available')+latest:'No matching structured events'):s.hasData?'Access verified · sample only':'Access verified · empty sample';
  }
  // Publication/event age is a coverage limitation, not evidence of a broken
  // connection. Vessel and price ages still identify unusably old observations.
  const olderContent=['news','acled'].includes(s.group)&&s.connection==='connected'&&s.status==='stale'&&!s.checkOverdue;
  s.attentionReason=s.configurationFailed?'configuration':!enabled?null:s.cacheIssue?'cache':['unavailable','retained'].includes(s.status)?'update':s.group==='vessels'&&['empty','unknown'].includes(s.status)?'reception':s.checkOverdue?'check':s.group==='vessels'&&s.freshness==='stale'?'observation':s.status==='stale'&&!olderContent?(['maritime','discovery'].includes(s.group)?'check':'observation'):null;
  const snapshotOnly=enabled&&s.id==='openwaters'&&s.snapshotCount>0;
  if(snapshotOnly&&!failed){s.status='unknown';s.freshness='unknown';s.label='Last-known snapshots · position time unavailable';s.attentionReason=s.cacheIssue?'cache':'provenance';}
  s.attention=s.attentionReason!==null;
  // Clocks, transport and bounds are independent. A successful fetch cannot
  // make unknown publication dates current or prove a complete result set.
  s.clockCompleteness=count===0?'not-applicable':Number.isInteger(s.publicationUnknown)&&s.publicationUnknown>0?(s.publicationKnown>0?'partial':'unknown'):s.group==='discovery'||s.hasData&&s.contentAgeSeconds===null&&!['expectations'].includes(s.group)?'unknown':s.hasData?'known':'unknown';
  if(snapshotOnly)s.clockCompleteness='unknown';
  s.checkStatus=s.configurationFailed?'missing':!enabled?'disabled':s.connection==='loading'?'checking':!s.retrievedAt||s.retrievalAgeSeconds===null?'missing':failed?'failed':s.checkOverdue||['maritime','discovery'].includes(s.group)&&s.freshness==='stale'?'overdue':'successful';
  s.scopeStatus=s.possiblyTruncated||s.truncated||s.archiveTruncated?'bounded':'retrieved-only';
  s.coverageStatus=s.configurationFailed?'unknown':!enabled?'disabled':s.status==='loading'?'checking':s.status==='unavailable'?'unavailable':s.attention||['stale','paused'].includes(s.status)||s.scopeStatus==='bounded'||s.clockCompleteness==='partial'||s.delayed?'limited':s.status==='unknown'||s.hasData&&s.clockCompleteness==='unknown'?'unknown':s.hasData?'available':s.successfulCheck&&count===0?'no-matches':'unknown';
  return s;
}
export function coverage(sources=[],group='news') {
  const list=sources.filter(s=>(s.group===group||group==='news'&&s.group==='discovery') && s.configured!==false && s.configured!==null);
  const usable=list.some(s=>s.hasData),pending=list.some(s=>s.status==='loading');
  const successful=list.filter(s=>s.successfulCheck===true||s.connection==='connected'&&date(s.retrievedAt)&&!s.localFailure);
  const clockUnknown=list.some(s=>s.hasData&&['unknown','partial'].includes(s.clockCompleteness)||s.coverageStatus==='unknown'||s.status==='unknown');
  const truncated=list.some(s=>s.possiblyTruncated||s.truncated||s.scopeStatus==='bounded');
  const retained=list.some(s=>s.status==='retained');
  const incomplete=!list.length||clockUnknown||truncated||list.some(s=>['unavailable','retained','stale','loading','paused'].includes(s.status)||['limited','unknown','unavailable','checking'].includes(s.coverageStatus));
  const unknown=!list.length||!usable&&!successful.length;
  const empty=!usable&&successful.length>0&&!incomplete&&list.every(s=>s.coverageStatus==='no-matches'||s.recordCount===0);
  return {usable,pending,incomplete,unknown,empty,clockUnknown,truncated,retained,sourceCount:list.length,successfulCount:successful.length,complete:false,
    label:!list.length?'Coverage unknown · no source status received':!usable&&!successful.length?(pending?'Checking reporting sources':'Reporting unavailable'):incomplete?(usable?'Incomplete coverage · retrieved reports only':'Coverage incomplete · no usable reporting'):'Retrieved reports only'};
}
