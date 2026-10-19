import {buildPriorityBrief} from './priority-brief.mjs';
import {SOURCE_DEFINITIONS,sourceHealth,coverage,isActiveReportingSource} from './source-health.mjs';
import {isActivePublisherReport} from './reporting-view.mjs';
import {CORE_REPORTING_IDS} from './source-policy.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const instant=value=>Number.isFinite(Date.parse(value))?Date.parse(value):null;
const date=value=>instant(value)!==null?new Date(value).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}):'Unknown date';
const clock=value=>instant(value)!==null?new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC':'Unknown time';

// A recent request is not a successful retrieval. Use source success clocks,
// never collector heartbeat or publication timestamps, to describe feed health.
export function briefCoverage(news,{now=Date.now(),failed=false,inputTruncated=false}={}){
  const sources=(news?.sources||[]).map(source=>{
    const def=SOURCE_DEFINITIONS.find(value=>value.id===source.id)||{group:'news'};
    const retrievedAt=source.lastSuccessAt||source.retrievedAt;
    return sourceHealth({...def,...source,retrievedAt,configured:def.retired?false:source.configured??true,connection:source.connection||(retrievedAt?'connected':'loading'),localFailure:failed||source.localFailure},now);
  }).filter(source=>source.configured!==false&&source.configured!==null);
  const missingCore=CORE_REPORTING_IDS.filter(id=>!sources.some(source=>source.id===id)).map(id=>{
    const definition=SOURCE_DEFINITIONS.find(source=>source.id===id);
    return {...definition,configured:true,connection:'unknown',status:'unknown',coverageStatus:'unknown',checkStatus:'missing',missingMetadata:true,hasData:false,recordCount:null,label:'No source status received'};
  });
  const aggregate=coverage([...sources,...missingCore]);
  const delayed=sources.filter(source=>source.attention||source.error||source.delayed||source.checkStatus==='missing'||source.checkStatus==='overdue');
  const direct=sources.filter(source=>CORE_REPORTING_IDS.includes(source.id)&&source.successfulCheck&&!delayed.includes(source));
  const delayGroups=[...new Map(delayed.map(source=>source.group==='discovery'?['gdelt',{...source,name:'GDELT discovery',familyCount:delayed.filter(row=>row.group==='discovery').length}]:[source.id,source])).values()];
  const truncated=Boolean(inputTruncated||news?.coverage?.archive?.truncated||news?.coverage?.possiblyTruncatedFamilies?.length||aggregate.truncated);
  const unknown=!sources.some(isActiveReportingSource);
  return {sources,missingCore,delayed,delayGroups,direct,checking:!news&&!failed,failed,unknown,truncated,limited:missingCore.length>0||truncated||aggregate.clockUnknown||Boolean(news?.coverage?.publicationUnknown),
    publicationUnknown:news?.coverage?.publicationUnknown||0,retainedCount:news?.coverage?.retainedCount??news?.coverage?.archive?.retainedCount??0,aggregate};
}

export function createPriorityView({mount,getState,onReport,onSources,onEvidence,onArrivals,getArrivalCount=()=>0,now=Date.now}={}){
  let previous='';
  function reportMarkup(item,cardId){
    const {report,clock:stamp}=item;
    return `<button class="priority-headline" data-priority-report="${esc(report.id)}" data-priority-key="${esc(cardId+':'+report.id)}">${esc(item.title)}</button><p class="priority-byline">${esc(report.source||'Publisher')}${['Publisher opinion','Publisher analysis','Independent energy analysis','Official energy analysis'].includes(report.type)?' · '+esc(report.type):''} · ${stamp.kind==='discovery'?'Discovered':'Published'} ${esc(date(stamp.value))}${stamp.precision==='timestamp'?' · '+esc(clock(stamp.value)):''}${stamp.kind==='discovery'?' · publication unknown':''}${report.retainedFromHistory?' · retained archive link':''}</p>${item.copyCount>1?`<span class="priority-copies">${item.copyCount} links with matching headlines · not corroboration</span>`:''}`;
  }
  function update(){
    if(!mount)return;
    const state=getState(),news=state.latestNews||state.news,tick=now(),health=briefCoverage(news,{now:tick,failed:state.failures?.news});
    const brief=buildPriorityBrief({...news,items:(news?.items||[]).filter(report=>isActivePublisherReport(report,health.sources))},{now:tick,theater:state.theater,actor:state.actor});
    health.truncated ||= brief.inputTruncated;
    health.limited ||= brief.inputTruncated;
    const arrivals=getArrivalCount();
    const advisories=state.maritime?.coverage?.advisories,advisoriesUnavailable=advisories?.status==='unavailable'||advisories?.collection==='retired';
    const status=health.checking?'Checking reporting':health.failed?'Current reporting unavailable':health.unknown?'Current reporting unavailable':health.delayed.length||health.missingCore.length?'Reporting coverage is partial':'Selected publisher reporting';
    const html=`<div class="priority-heading"><div><span class="priority-kicker">Past 72 hours</span><p>Selected original headlines · maritime & oil${state.actor!=='All'?' · '+esc(state.actor):''}</p></div><span class="priority-refresh">${state.auto?'Auto refresh · 60s':'Auto refresh paused'}</span></div>
      <div class="priority-grid">${brief.cards.map(card=>{
        const lead=card.items[0],official=(state.maritime?.events||[]).filter(row=>row.theaters?.includes(card.id)&&instant(row.eventDate||row.publishedDate)!==null&&instant(row.eventDate||row.publishedDate)<=tick).sort((a,b)=>instant(b.eventDate||b.publishedDate)-instant(a.eventDate||a.publishedDate))[0];
        return `<article class="priority-card" aria-labelledby="priority-${card.id}"><h3 id="priority-${card.id}">${esc(card.title)}</h3>${lead?`<span class="priority-category">${esc(lead.category)}</span>${reportMarkup(lead,card.id,health)}`:`<p class="priority-empty">${health.checking?'Waiting for retrieved reporting…':health.failed||health.unknown?'Current reporting is unavailable. Historical reports remain in Reporting.':'No recent matching headline from active publishers. This does not mean no events occurred.'}</p>`}${card.items.length>1||official?`<details data-priority-section="${card.id}"><summary data-priority-key="more-${card.id}">${card.items.length>1?`${card.items.length-1} more headlines`:'Official source record'}${official&&card.items.length>1?' + official record':''}</summary><ol>${card.items.slice(1).map(item=>`<li><span class="priority-category">${esc(item.category)}</span>${reportMarkup(item,card.id,health)}</li>`).join('')}</ol>${official?`<div class="priority-official"><span>Latest retrieved IMO ${official.recordType==='incident'?'incident':'statement'} · ${esc(date(official.eventDate||official.publishedDate))}</span><button class="priority-headline" data-priority-evidence="${esc(official.id)}" data-priority-key="${esc(official.id)}">${esc(official.title)}</button><p>A dated record; no current operating status or attacker inferred.${official.sourceUpdatedDate?' Source page updated '+esc(date(official.sourceUpdatedDate))+'.':''}</p></div>`:''}</details>`:''}</article>`;
      }).join('')}</div>
      <div class="priority-bottom"><details class="priority-coverage" data-priority-section="coverage"><summary data-priority-key="coverage"><span class="priority-health" data-delayed="${Boolean(health.failed||health.unknown||health.delayed.length||health.missingCore.length)}">${esc(status)}</span><span>Dates & selection limits ▾</span></summary><div class="priority-coverage-body"><p>Recent headlines from active publishers. Missing coverage does not establish that no events occurred.${health.delayed.length||health.missingCore.length?' Some publisher reporting is currently unavailable.':''}</p><p>${health.truncated?'Archive or selection limits may omit relevant links. ':''}${health.publicationUnknown?health.publicationUnknown+' links have unknown publication dates and remain browsable in Reporting. ':''}${health.retainedCount?health.retainedCount+' links are retained from earlier retrievals. ':''}Regional labels describe headline context, not incident locations. Historical and discovery-only links remain in Reporting and Evidence. Ranking is editorial relevance, not severity or probability. Matching headlines do not establish independent confirmation.</p><button class="text-button" data-priority-sources data-priority-key="sources">Source diagnostics ↗</button></div></details>${arrivals?`<button class="priority-arrivals" data-priority-arrivals data-priority-key="arrivals">${arrivals} new ${arrivals===1?'link':'links'} · update reading list</button>`:'<span class="priority-scope">Source selection, not an event count</span>'}</div>${advisoriesUnavailable?'<p class="priority-coverage-gap"><span>Current maritime advisories unavailable.</span><button class="text-button" data-workspace-view="evidence" data-priority-key="advisory-coverage">Coverage details ↗</button></p>':''}`;
    if(html===previous)return;
    const open=new Set([...mount.querySelectorAll('details[open]')].map(node=>node.dataset.prioritySection)),active=mount.ownerDocument.activeElement,key=mount.contains(active)?active.dataset.priorityKey:null;
    mount.innerHTML=html;previous=html;
    for(const node of mount.querySelectorAll('details'))node.open=open.has(node.dataset.prioritySection);
    if(key){const target=[...mount.querySelectorAll('[data-priority-key]')].find(node=>node.dataset.priorityKey===key);(target?.getClientRects().length?target:mount).focus({preventScroll:true});}
  }
  mount?.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.priorityReport)onReport(button.dataset.priorityReport);else if(button.dataset.priorityEvidence)onEvidence(button.dataset.priorityEvidence);else if(button.hasAttribute('data-priority-sources'))onSources();else if(button.hasAttribute('data-priority-arrivals'))onArrivals();});
  return {update};
}
