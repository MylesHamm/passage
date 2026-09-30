import {MONITORING_STORAGE_KEY,THEATER_NAMES,WATCH_ACTORS,createMonitoringSession,filterMonitoringReports,sinceLastLook,groupReporting,replayReporting,watchMatches,buildBrief} from './monitoring-model.mjs';
import {reportTime,reportTimeLabel} from './reporting-view.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC':'Unknown';
const publication=row=>row.publicationPrecision==='day'||row.publishedDate?(row.publishedDate||row.publishedAt?.slice(0,10)||'Unknown'):date(reportTime(row));
const plural=(count,word)=>`${count} ${count===1?word:word+'s'}`;

/** The host owns fetching and calls ingestNews before assigning state.news.
 * onAccept receives the complete accepted snapshot; update is safe on every render.
 */
export function createMonitoringView({mount,getState,onAccept=()=>{},onReport=()=>{},onFilter=()=>{},onSources=()=>{},storage,now=Date.now}={}){
  let stored,storageFailed=false;
  try{storage=storage===undefined?globalThis.localStorage:storage;stored=JSON.parse(storage?.getItem(MONITORING_STORAGE_KEY)||'null');}catch{storageFailed=true;}
  const session=createMonitoringSession({stored,now});
  let tab='since',limit=8,replayAt=null,message='',lastBody='',speaking=false,destroyed=false;
  const settings=()=>session.settings();
  function persist(){try{if(!storage)throw Error();storage.setItem(MONITORING_STORAGE_KEY,JSON.stringify(settings()));}catch{storageFailed=true;}}
  function scoped(rows){const state=getState?.()||{};return filterMonitoringReports(state.view==='saved'?rows.filter(row=>state.saved?.[row.id]):rows,state,now());}
  function reportList(rows,{labels=new Map(),replay=false}={}){
    const accepted=new Set(session.news()?.items.map(row=>row.url)||[]);
    return `<ol class="monitor-report-list">${rows.slice(0,limit).map(row=>`<li><div class="monitor-report-copy">${accepted.has(row.url)?`<button type="button" class="monitor-headline" data-monitor-report="${escape(row.id)}">${escape(row.title)}</button>`:`<a class="monitor-headline" href="${escape(row.url)}" target="_blank" rel="noopener noreferrer">${escape(row.title)} ↗</a>`}<p>${escape(row.source||row.publisher||'Publisher')}${row.type==='Independent energy analysis'?' · Analysis':''} · ${escape(reportTimeLabel(row))}: ${escape(publication(row))}</p>${labels.has(row.url)?`<span class="monitor-clock">${escape(labels.get(row.url))}</span>`:''}${replay?`<span class="monitor-clock">First retrieved ${escape(date(row.firstSeenAt))}</span>`:''}${row.retainedForReading?'<span class="monitor-clock">Held from prior snapshot · not present in latest retrieval</span>':''}</div><a class="monitor-source" href="${escape(row.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open original source: ${escape(row.title)}">Source ↗</a></li>`).join('')}</ol>${rows.length>limit?`<button type="button" class="monitor-more" data-monitor-action="more">Show ${Math.min(20,rows.length-limit)} more · ${rows.length-limit} remaining</button>`:''}`;
  }
  function sincePanel(){
    const saved=settings(),rows=scoped(session.news()?.items||[]),changes=sinceLastLook(rows,saved,now());
    if(!saved.acknowledgedAt)return `<div class="monitor-intro"><div><h3>Pick up where you leave off.</h3><p>Set a reading checkpoint for the ${plural(session.news()?.items.length||0,'loaded report')}. Future visits compare links against that checkpoint. Refreshing never marks reporting as reviewed.</p></div><button type="button" class="monitor-primary" data-monitor-action="review" ${session.news()?.items.length?'':'disabled'}>Start tracking</button></div>`;
    const matches=groupReporting(changes.map(change=>change.report)).filter(group=>group.reports.length>1);
    return `<div class="monitor-panel-heading"><div><h3>Since you last looked <span>${changes.length}</span></h3><p>Last checkpoint ${escape(date(saved.acknowledgedAt))} · current theatre, actor and time filters.</p></div><button type="button" data-monitor-action="review">Mark loaded reports reviewed</button></div>${changes.length?reportList(changes.map(change=>change.report),{labels:new Map(changes.map(change=>[change.report.url,change.label]))}):'<p class="monitor-empty">No unreviewed links match this view. This is a reading checkpoint, not confirmation that no events occurred.</p>'}${matches.length?`<details class="monitor-grouping"><summary>${plural(matches.length,'group')} of matching headline text</summary><p>Matching headline text · common origin/event unverified. Known different publication days remain separate; discovery times are not substituted for publication dates.</p>${matches.map(group=>`<h3>${escape(group.title)}</h3>${reportList(group.reports)}`).join('')}</details>`:''}`;
  }
  function watchPanel(){
    const saved=settings(),state=getState?.()||{},defaultValue=state.actor&&state.actor!=='All'?'actor:'+state.actor:'theater:'+(state.theater==='bab'?'bab':'hormuz');
    return `<div class="monitor-panel-heading"><div><h3>Your watchlist</h3><p>New matching reporting appears here while Passage is open. Watch matches use publisher-text tags; a mention is not responsibility or verified location.</p></div></div><form class="monitor-watch-form" data-monitor-form="watch"><label for="monitor-watch-choice">Theatre or actor</label><select id="monitor-watch-choice">${[['theater:bab','Bab el-Mandeb'],['theater:hormuz','Strait of Hormuz'],...WATCH_ACTORS.map(actor=>['actor:'+actor,actor])].map(([value,label])=>`<option value="${escape(value)}" ${value===defaultValue?'selected':''}>${escape(label)}</option>`).join('')}</select><button id="monitor-add-watch" type="submit">Add watch</button></form><div class="monitor-watches">${saved.watches.map(watch=>{const matches=watchMatches(session.all(),watch,saved),label=watch.type==='theater'?THEATER_NAMES[watch.value]:watch.value;return `<article class="monitor-watch"><div><button type="button" class="monitor-watch-name" data-monitor-watch="${escape(watch.id)}">${escape(label)} <span>${matches.length}</span></button><p>${matches.length?plural(matches.length,'unreviewed match'):'No new matching links since this watch was added.'}</p></div><button type="button" class="monitor-remove" data-monitor-remove="${escape(watch.id)}" aria-label="Remove ${escape(label)} watch">Remove</button>${matches.length?reportList(matches.slice(0,3)):''}</article>`;}).join('')||'<p class="monitor-empty">Choose a theatre or actor to start a local watch. Reports already loaded when you add it become its baseline.</p>'}</div><p class="monitor-footnote">Saved in this browser. No push notifications, paid alert service or background browser permission is required.</p>`;
  }
  function storyPanel(){
    const groups=groupReporting(scoped(session.news()?.items||[])),matches=groups.filter(group=>group.reports.length>1);
    return `<div class="monitor-panel-heading"><div><h3>Story groups</h3><p>Browse matching canonical links or exact normalized long headlines. Each report keeps its own source link and date.</p></div></div><p class="monitor-replay-scope">Matching headline text · common origin/event unverified. Matching wording does not establish syndication, the same event or independent confirmation. Known different publication days remain separate; reports with unknown dates are matched by text alone.</p>${matches.length?matches.slice(0,limit).map(group=>`<details class="monitor-grouping"><summary>${escape(group.title)} · ${plural(group.reports.length,'report')}</summary><p>${group.kind==='same-link'?'Matching canonical link':'Matching headline text · common origin/event unverified'}</p>${reportList(group.reports)}</details>`).join(''):'<p class="monitor-empty">No exact long headline matches appear in this view. Similar topics and different headlines remain separate.</p>'}${matches.length>limit?`<button type="button" class="monitor-more" data-monitor-action="more">Show more groups · ${matches.length-limit} remaining</button>`:''}<p class="monitor-footnote">${plural(groups.filter(group=>group.reports.length===1).length,'report')} remain separate. New arrivals enter these groups only after you apply them.</p>`;
  }
  function briefPanel(){
    const brief=buildBrief({...getState?.(),news:session.news()},now());
    return `<div class="monitor-panel-heading"><div><h3>Brief me · ${escape(brief.scope)}</h3><p>A source-linked selection of up to five headlines matching the current filters.</p></div>${globalThis.speechSynthesis&&globalThis.SpeechSynthesisUtterance?`<button type="button" data-monitor-action="${speaking?'stop':'speak'}">${speaking?'Stop reading':'Read aloud'}</button>`:''}</div>${brief.reports.length?reportList(brief.reports):'<p class="monitor-empty">No retrieved reporting matches this selection. Try a wider reporting window or inspect Sources.</p>'}<div class="monitor-price-strip">${brief.prices.map(price=>`<div><span>${escape(price.name)} · daily spot</span><strong>$${price.value.toFixed(2)} <small>USD/bbl</small></strong><p>${escape(price.date)}${price.change!==null?` · ${price.change>=0?'+':'−'}$${Math.abs(price.change).toFixed(2)} from ${escape(price.previousDate)}`:''}</p>${price.url?`<a href="${escape(price.url)}" target="_blank" rel="noopener noreferrer">EIA source ↗</a>`:''}<span class="monitor-price-state">${escape(price.status)}</span></div>`).join('')||'<p>No daily oil observations are available.</p>'}</div><p class="monitor-footnote">Compiled from retrieved headlines and delayed daily observations. It does not generate claims, independently verify events, or infer that reporting caused a price move. <button type="button" data-monitor-action="sources">Inspect source health</button></p>`;
  }
  function replayPanel(){
    const rows=scoped(session.all()),clocks=[...new Set(rows.map(row=>row.firstSeenAt).filter(value=>value&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now()))].sort();
    const at=replayAt||clocks.at(-1)||new Date(now()).toISOString(),result=replayReporting(rows,at,now()),index=Math.max(0,clocks.findLastIndex(clock=>clock<=at));
    return `<div class="monitor-panel-heading"><div><h3>Reporting replay</h3><p>Explore when retained links first entered Passage’s local archive.</p></div><button type="button" data-monitor-action="latest">Latest archive</button></div><p class="monitor-replay-scope">${escape(result.scope)}</p>${clocks.length?`<label class="monitor-replay-label" for="monitor-replay-range">Archive arrivals through <strong>${escape(date(result.at))}</strong></label><input id="monitor-replay-range" type="range" min="0" max="${Math.max(0,clocks.length-1)}" value="${index}" ${clocks.length<2?'disabled':''} aria-valuetext="${escape(date(result.at))}"><div class="monitor-replay-endpoints"><span>${escape(date(clocks[0]))}</span><span>${escape(date(clocks.at(-1)))}</span></div><p class="monitor-footnote">${plural(result.items.length,'retained link')} by this point · ${result.laterCount} arrived later · ${result.excludedWithoutRetrieval} without a first-retrieved timestamp excluded. Current reporting filters apply.</p>${reportList(result.items,{replay:true})}`:'<p class="monitor-empty">The current selection has no recorded first-retrieved timestamps yet. Publication dates and discovery dates cannot substitute for archive arrival time.</p>'}<p class="monitor-footnote">Archive retention and capacity limits apply; removed records cannot be reconstructed. The globe and prices remain current snapshots while you explore this list.</p>`;
  }
  function render(){
    if(!mount||destroyed)return;
    const saved=settings(),pending=session.pending().length,retained=session.retained().length,changes=scoped(session.news()?.items||[]),unseen=sinceLastLook(changes,saved,now()).length;
    if(!mount.querySelector('.monitor-shell'))mount.innerHTML='<section class="monitor-shell" aria-label="Monitoring workspace"><div class="monitor-toolbar"><div><span class="monitor-eyebrow">PERSONAL WATCH</span><h2>Stay with the story.</h2></div><nav class="monitor-tabs" aria-label="Monitoring tools"></nav></div><div class="monitor-arrivals" role="status" aria-live="polite"></div><div class="monitor-body"></div><p class="monitor-status" role="status" aria-live="polite"></p></section>';
    const active=mount.ownerDocument.activeElement,activeId=mount.contains(active)?active.id:null,activeAction=mount.contains(active)?active.getAttribute('data-monitor-action'):null;
    const activeRemove=mount.contains(active)?active.getAttribute('data-monitor-remove'):null,removeIndex=activeRemove?[...mount.querySelectorAll('[data-monitor-remove]')].indexOf(active):-1;
    const tabs=mount.querySelector('.monitor-tabs');
    const tabsHTML=[['since','Since last look'+(unseen?' · '+unseen:'')],['watch','Watchlist'+(saved.watches.length?' · '+saved.watches.length:'')],['brief','Brief me'],['stories','Story groups'],['replay','Replay']].map(([id,label])=>`<button type="button" data-monitor-tab="${id}" aria-pressed="${tab===id}" aria-controls="monitor-panel">${label}</button>`).join('');
    if(tabs.innerHTML!==tabsHTML)tabs.innerHTML=tabsHTML;
    const arrivals=mount.querySelector('.monitor-arrivals'),arrivalHTML=pending||retained?`<span><strong>${pending?plural(pending,'new report')+' waiting. ':''}${retained?plural(retained,'prior report')+' held for reading.':''}</strong> Your reading stream stays in place. Source status has refreshed.${retained?' Held reports are absent from the latest snapshot; their retrieval clocks have not advanced.':''}</span><button type="button" class="monitor-primary" data-monitor-action="accept">${retained?'Apply refreshed snapshot':'Apply arrivals'}</button>`:'<span>New report links wait here before entering your reading stream.</span>';
    if(arrivals.innerHTML!==arrivalHTML)arrivals.innerHTML=arrivalHTML;
    arrivals.classList.toggle('has-arrivals',pending>0||retained>0);
    const body=mount.querySelector('.monitor-body'),html=({since:sincePanel,watch:watchPanel,brief:briefPanel,stories:storyPanel,replay:replayPanel}[tab])();
    if(html!==lastBody){
      const watchValue=mount.querySelector('#monitor-watch-choice')?.value,opened=[...body.querySelectorAll('details')].map(detail=>detail.open);
      body.innerHTML=html;body.id='monitor-panel';lastBody=html;
      if(watchValue&&mount.querySelector('#monitor-watch-choice'))mount.querySelector('#monitor-watch-choice').value=watchValue;
      [...body.querySelectorAll('details')].forEach((detail,index)=>{detail.open=opened[index]||false;});
    }
    mount.querySelector('.monitor-status').textContent=[message,storageFailed?'Browser storage unavailable. Your checkpoint and watchlist last only for this session.':''].filter(Boolean).join(' ');
    if(activeId)mount.querySelector('#'+activeId)?.focus({preventScroll:true});
    else if(activeRemove){const controls=[...mount.querySelectorAll('[data-monitor-remove]')];(controls.find(button=>button.dataset.monitorRemove===activeRemove)||controls[Math.min(removeIndex,controls.length-1)]||mount.querySelector('#monitor-add-watch'))?.focus({preventScroll:true});}
    else if(activeAction&&mount.ownerDocument.activeElement!==active)mount.querySelector(`[data-monitor-action="${activeAction}"]`)?.focus({preventScroll:true});
  }
  function stopSpeech(){globalThis.speechSynthesis?.cancel();speaking=false;}
  function click(event){
    const button=event.target.closest('button');if(!button||!mount.contains(button))return;
    if(button.dataset.monitorTab){tab=button.dataset.monitorTab;limit=8;stopSpeech();message='';render();mount.querySelector(`[data-monitor-tab="${tab}"]`)?.focus();return;}
    if(button.dataset.monitorReport){onReport(button.dataset.monitorReport);return;}
    if(button.dataset.monitorRemove){session.removeWatch(button.dataset.monitorRemove);persist();render();return;}
    if(button.dataset.monitorWatch){const watch=settings().watches.find(row=>row.id===button.dataset.monitorWatch);if(watch)onFilter({[watch.type==='theater'?'theater':'actor']:watch.value});return;}
    switch(button.dataset.monitorAction){
      case 'accept':{const count=session.pending().length,removed=session.retained().length;onAccept(session.acceptPending());message=`Latest snapshot applied: ${plural(count,'arrival')} added${removed?`, ${plural(removed,'prior report')} no longer in the reading stream`:''}. Your reading checkpoint has not changed.`;break;}
      case 'review':session.acknowledge();persist();message='Checkpoint saved for loaded reporting. Waiting arrivals remain unreviewed.';break;
      case 'more':limit+=20;break;
      case 'latest':replayAt=null;break;
      case 'sources':onSources();return;
      case 'speak':if(globalThis.speechSynthesis&&globalThis.SpeechSynthesisUtterance){stopSpeech();const utterance=new globalThis.SpeechSynthesisUtterance(buildBrief({...getState?.(),news:session.news()},now()).speech);utterance.rate=.96;utterance.onend=utterance.onerror=()=>{speaking=false;render();};speaking=true;globalThis.speechSynthesis.speak(utterance);}break;
      case 'stop':stopSpeech();break;
      default:return;
    }
    render();
  }
  function input(event){
    if(event.target.id!=='monitor-replay-range')return;
    const clocks=[...new Set(scoped(session.all()).map(row=>row.firstSeenAt).filter(value=>value&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now()))].sort();
    replayAt=clocks[Number(event.target.value)]||null;render();
  }
  function submit(event){
    if(event.target.dataset.monitorForm!=='watch')return;event.preventDefault();
    const [type,...parts]=mount.querySelector('#monitor-watch-choice').value.split(':');session.addWatch(type,parts.join(':'));persist();message='Watch saved on this browser. Only new matching links will count.';render();
  }
  mount?.addEventListener('click',click);mount?.addEventListener('input',input);mount?.addEventListener('submit',submit);render();
  return {ingestNews:incoming=>session.ingestNews(incoming),pendingCount:()=>session.pending().length,retainedCount:()=>session.retained().length,acceptArrivals:()=>{onAccept(session.acceptPending());render();},update:render,destroy(){destroyed=true;stopSpeech();mount?.removeEventListener('click',click);mount?.removeEventListener('input',input);mount?.removeEventListener('submit',submit);}};
}
