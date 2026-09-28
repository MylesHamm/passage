import {buildPriorityBrief} from './priority-brief.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const instant=value=>Number.isFinite(Date.parse(value))?Date.parse(value):null;
const date=value=>instant(value)!==null?new Date(value).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}):'Unknown date';
const clock=value=>instant(value)!==null?new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC':'Unknown time';
const age=(value,now)=>{const at=instant(value);if(at===null||at>now)return 'not recorded';const minutes=Math.floor((now-at)/60000);return minutes<1?'just now':minutes<60?`${minutes}m ago`:minutes<1440?`${Math.floor(minutes/60)}h ago`:`${Math.floor(minutes/1440)}d ago`;};

// A recent request is not a successful retrieval. Use source success clocks,
// never collector heartbeat or publication timestamps, to describe feed health.
export function briefCoverage(news,{now=Date.now(),failed=false}={}){
  const sources=(news?.sources||[]).filter(source=>source.configured!==false);
  const delayed=sources.filter(source=>{
    const at=instant(source.lastSuccessAt||source.retrievedAt);
    return source.attention||source.error||source.delayed||at===null||at>now||now-at>Math.max(3600,(source.interval||300)*2)*1000;
  });
  const direct=sources.filter(source=>['bbc','aj','france24','mee','memo'].includes(source.id)&&!delayed.includes(source));
  return {delayed,direct,checking:!news&&!failed,failed,truncated:Boolean(news?.coverage?.archive?.truncated||news?.coverage?.possiblyTruncatedFamilies?.length)};
}

export function createPriorityView({mount,getState,onReport,onSources,onEvidence,onArrivals,getArrivalCount=()=>0,now=Date.now}={}){
  let previous='';
  function reportMarkup(item,cardId){
    const {report,clock:stamp}=item;
    return `<button class="priority-headline" data-priority-report="${esc(report.id)}" data-priority-key="${esc(cardId+':'+report.id)}">${esc(item.title)}</button><p class="priority-byline">${esc(report.source||'Publisher')} · ${stamp.kind==='discovery'?'Discovered':'Published'} ${esc(date(stamp.value))}${stamp.precision==='timestamp'?' · '+esc(clock(stamp.value)):''}${stamp.kind==='discovery'?' · publication unknown':''}</p>${item.copyCount>1?`<span class="priority-copies">${item.copyCount} links with matching headlines · not corroboration</span>`:''}`;
  }
  function update(){
    if(!mount)return;
    const state=getState(),news=state.latestNews||state.news,tick=now(),brief=buildPriorityBrief(news,{now:tick,theater:state.theater,actor:state.actor}),health=briefCoverage(news,{now:tick,failed:state.failures?.news});
    const arrivals=getArrivalCount();
    const status=health.checking?'Checking live reporting':health.failed?'Reporting refresh failed':health.delayed.length?'Reporting coverage delayed':health.truncated?'Reporting coverage limited':'Source headlines refreshed';
    const html=`<div class="priority-heading"><div><span class="priority-kicker">DEVELOPMENTS TO WATCH</span><p>Live selection · maritime & oil · past 72 hours${state.actor!=='All'?' · '+esc(state.actor):''}</p></div><span class="priority-refresh">${state.auto?'Auto refresh · 60s':'Auto refresh paused'}</span></div>
      <div class="priority-grid">${brief.cards.map(card=>{
        const lead=card.items[0],official=(state.maritime?.events||[]).filter(row=>row.theaters?.includes(card.id)&&instant(row.eventDate||row.publishedDate)!==null&&instant(row.eventDate||row.publishedDate)<=tick).sort((a,b)=>instant(b.eventDate||b.publishedDate)-instant(a.eventDate||a.publishedDate))[0];
        return `<article class="priority-card" aria-labelledby="priority-${card.id}"><h2 id="priority-${card.id}">${esc(card.title)}</h2>${lead?`<span class="priority-category">${esc(lead.category)}</span>${reportMarkup(lead,card.id)}`:`<p class="priority-empty">${news?'No recent matching headline retrieved. Check coverage before drawing conclusions.':'Waiting for retrieved reporting…'}</p>`}${card.items.length>1||official?`<details data-priority-section="${card.id}"><summary data-priority-key="more-${card.id}">${card.items.length>1?`${card.items.length-1} more developments`:'Official source record'}${official&&card.items.length>1?' + official record':''}</summary><ol>${card.items.slice(1).map(item=>`<li><span class="priority-category">${esc(item.category)}</span>${reportMarkup(item,card.id)}</li>`).join('')}</ol>${official?`<div class="priority-official"><span>Latest retrieved IMO ${official.recordType==='incident'?'incident':'statement'} · ${esc(date(official.eventDate||official.publishedDate))}</span><button class="priority-headline" data-priority-evidence="${esc(official.id)}" data-priority-key="${esc(official.id)}">${esc(official.title)}</button><p>A dated record; no current operating status or attacker inferred.${official.sourceUpdatedDate?' Source page updated '+esc(date(official.sourceUpdatedDate))+'.':''}</p></div>`:''}</details>`:''}</article>`;
      }).join('')}</div>
      <div class="priority-bottom"><details class="priority-coverage" data-priority-section="coverage"><summary data-priority-key="coverage"><span class="priority-health" data-delayed="${Boolean(health.failed||health.delayed.length)}">${esc(status)}</span><span>${health.delayed.length?health.delayed.length+' feeds need attention':'Dates & selection limits'} ▾</span></summary><div class="priority-coverage-body"><p>${health.failed?'The last dashboard request failed. Retained headlines keep their original dates. ':''}${health.direct.length?health.direct.map(source=>esc(source.name)+' retrieved '+esc(age(source.lastSuccessAt||source.retrievedAt,tick))).join(' · ')+'. ':''}Refresh success does not establish complete coverage.</p>${health.delayed.length?`<ul>${health.delayed.map(source=>`<li><strong>${esc(source.name)}</strong> · last successful retrieval ${esc(age(source.lastSuccessAt||source.retrievedAt,tick))}${source.errorCategory==='rate_limit'?' · provider rate limit':source.httpStatus===403?' · access refused':''}</li>`).join('')}</ul>`:''}<p>${health.truncated?'Discovery and archive limits may omit relevant links. ':''}Selected publisher headlines retain claims and attribution. Matching wording is not independent confirmation. Theatre labels show headline context, not a precise incident location. X posts are not ingested.</p><button class="text-button" data-priority-sources data-priority-key="sources">Inspect all sources ↗</button></div></details>${arrivals?`<button class="priority-arrivals" data-priority-arrivals data-priority-key="arrivals">${arrivals} new ${arrivals===1?'link':'links'} · update reading list</button>`:'<span class="priority-scope">Source selection, not an event count</span>'}</div>`;
    if(html===previous)return;
    const open=new Set([...mount.querySelectorAll('details[open]')].map(node=>node.dataset.prioritySection)),active=mount.ownerDocument.activeElement,key=mount.contains(active)?active.dataset.priorityKey:null;
    mount.innerHTML=html;previous=html;
    for(const node of mount.querySelectorAll('details'))node.open=open.has(node.dataset.prioritySection);
    if(key){const target=[...mount.querySelectorAll('[data-priority-key]')].find(node=>node.dataset.priorityKey===key);(target?.getClientRects().length?target:mount).focus({preventScroll:true});}
  }
  mount?.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.priorityReport)onReport(button.dataset.priorityReport);else if(button.dataset.priorityEvidence)onEvidence(button.dataset.priorityEvidence);else if(button.hasAttribute('data-priority-sources'))onSources();else if(button.hasAttribute('data-priority-arrivals'))onArrivals();});
  return {update};
}
