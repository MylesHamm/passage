import {createWorkspaceView,workspaceFor} from './workspace-view.mjs';
import {enterSequence,bindDisclosures} from './motion.mjs';
import {renderMarketPulse} from './market-pulse.mjs';
import {createOilChart,normalizeOilObservations} from './oil-chart-view.mjs';
import {oilObservationTableMarkup} from './oil-table-view.mjs';
import {createOilSystemView} from './oil-system-view.mjs';
import {preserveViewFocus} from './view-focus.mjs';
import {createExpectationsView} from './expectations-view.mjs';
import {collectorHealth,collectorCard} from './collector-status.mjs';
import {apiFetch,siteUrl,runtime,LIVE_REFRESH_MS} from './runtime-config.mjs';
import {reportTime,reportTimeLabel,reportRelevant,matchesTheater,inReportingWindow,sortReports,reportingCoverageText,isActivePublisherReport} from './reporting-view.mjs';
import {createMonitoringView} from './monitoring-view.mjs';
import {impactTags,groupReporting} from './monitoring-model.mjs';
import {buildPriorityBrief} from './priority-brief.mjs';
import {createPriorityView} from './priority-view.mjs';
import {renderMarketContext} from './market-view.mjs';
import {createSituationView} from './situation-view.mjs';
import {EXPOSURE_BASELINE,INFRASTRUCTURE} from './energy-context.mjs';
import {vesselTypeLabel} from './vessel-data.mjs';
import {createRegionalTerrain} from './terrain/controller.mjs';
import {reportInspectorMarkup,bindInspectorTabs} from './report-inspector.mjs';
import {collectSources,coverage,panelNotice,ageSeconds,isActiveReportingSource} from './source-health.mjs';
import {sourceRosterMarkup} from './source-roster.mjs';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage={get(k,f){try{return JSON.parse(localStorage.getItem('passage-'+k))??f;}catch{return f;}},set(k,v){try{localStorage.setItem('passage-'+k,JSON.stringify(v));return true;}catch{toast('Browser storage is unavailable. Changes will last for this session.');return false;}}};
const state={config:null,diagnostics:null,diagnosticsError:false,news:null,latestNews:null,maritime:null,showEvents:false,showInfrastructure:false,acled:null,oil:null,market:null,expectations:null,weather:null,vessels:null,vesselsBusy:false,showVessels:false,vesselFilter:'oil',theater:'both',actor:'All',view:'overview',hours:'72',includeArchive:false,query:'',period:90,saved:storage.get('saved',{}),notes:storage.get('notes',{}),auto:true,map:{zoom:1,x:0,y:0},geo:null,failures:{},busy:false};
const actorNames=['All','Houthis','Iran','IRGC','U.S. military','Saudi Arabia','UAE','Oman','Iraq','Kuwait','Qatar','Egypt','Israel','Maritime coalitions','Merchant shipping','Civilians','Other forces'];
const names={bab:'Bab el-Mandeb',hormuz:'Strait of Hormuz',both:'Both theatres'};
const VESSEL_LAYERS={
  oil:{label:'Oil traffic',metricLabel:'tankers',detail:'Tankers',matches:['tanker']},
  commercial:{label:'Commercial traffic',metricLabel:'commercial vessels',detail:'Tankers + cargo',matches:['tanker','cargo']},
  security:{label:'Security & service',metricLabel:'security/service',detail:'Military + service',matches:['military','service']},
  all:{label:'All received',metricLabel:'vessels',detail:'All received positions',matches:null},
};
const fmtDate=value=>value?new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):'Not available';
const fmtTime=value=>value?new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}):'—';
const relative=value=>{if(!value)return'Unknown';const mins=Math.max(0,(Date.now()-Date.parse(value))/60000);return mins<1?'Just now':mins<60?`${Math.floor(mins)}m ago`:mins<1440?`${Math.floor(mins/60)}h ago`:`${Math.floor(mins/1440)}d ago`;};
const money=v=>Number.isFinite(v)?'$'+v.toFixed(2):'—';
const expectationsView=createExpectationsView($('#market-expectations'),{getState:()=>state});
const oilChart=createOilChart($('#oil-chart'));
const oilSystem=createOilSystemView($('#oil-system'));
$('#oil-system').addEventListener('click',event=>{if(event.target.closest('[data-system-clear]')){const selected=$('#energy-selection');selected.hidden=true;selected.innerHTML='';}});
function openOilSystem(report=null){
  if($('#context-inspector').open)closeInspector();
  if(report?.theaters?.length===1)setTheater(report.theaters[0]);
  setView('energy');oilSystem.open(report);
  const target=$('#energy-selection');
  target.hidden=!report;
  target.innerHTML=report?`<span>SELECTED SOURCE CLAIM</span><button class="energy-report-link" data-energy-report="${esc(report.id)}">${esc(report.title)}</button><small>${esc(report.source)} · ${esc(reportTimeLabel(report))}: ${esc(fmtDate(reportTime(report)))}</small>`:'';
  target.querySelector('[data-energy-report]')?.addEventListener('click',()=>showStory(report.id));
}
$$('[data-open-oil-system]').forEach(button=>button.onclick=()=>openOilSystem());
let toastTimer, globe, monitoring, priority, workspaceView;
let inspectorMode=null, inspectorReturn=null, selectedReport=null;
let selectedContext=null;

let dialogMode=null,selectedMmsi=null,diagnosticsBusy=false;
const stamp=value=>value?`${fmtDate(value)} · ${fmtTime(value)} UTC (${Date.parse(value)>Date.now()?'in '+Math.max(1,Math.ceil((Date.parse(value)-Date.now())/60000))+' min':relative(value)})`:'Not available';
function reportAge(report){const label=reportTimeLabel(report),time=reportTime(report);return label==='Publication date'?fmtDate(time):(label.startsWith('Discovered')?'Discovered ':'')+relative(time);}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3300);}
function openDialog(kicker,content){dialogMode=null;$('#dialog-kicker').textContent=kicker;$('#dialog-content').innerHTML=content;if(!$('#detail-dialog').open)$('#detail-dialog').showModal();}
$('.workspace-tools').addEventListener('click',event=>{if(event.target.closest('button'))$('.workspace-tools').open=false;});
$('#dialog-close').onclick=()=>$('#detail-dialog').close();
$('#detail-dialog').addEventListener('click',e=>{if(e.target===$('#detail-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('#detail-dialog').addEventListener('close',()=>{dialogMode=null;if('speechSynthesis'in window)speechSynthesis.cancel();});
function reports({allTheaters=false}={}){
  let items=state.view==='saved'?Object.values(state.saved):state.news?.items||[];
  const sources=allSourceStates();
  const filtered=items.filter(x=>{
    if(state.view!=='saved'&&!state.includeArchive&&!isActivePublisherReport(x,sources))return false;
    return inReportingWindow(x,state.hours)&&(!state.query||(x.title+' '+(x.summary||'')+' '+(x.reviewedContext?.summary||'')+' '+x.source).toLowerCase().includes(state.query.toLowerCase()))&&((state.view==='saved')||reportRelevant(x))&&(allTheaters||matchesTheater(x,state.theater))&&(state.actor==='All'||x.actors.includes(state.actor))&&(state.view!=='civilian'||x.actors.includes('Civilians')||impactTags(x.title).length>0)&&(state.view!=='energy'||x.energy||x.relevanceScopes?.some(scope=>['regional-energy','global-energy'].includes(scope)));
  });return state.view==='saved'?filtered.sort(sortReports):filtered;
}
function renderActors(){
  const select=$('#actors');
  if(!select.dataset.ready){select.innerHTML=actorNames.map(name=>`<option value="${esc(name)}">${esc(name==='All'?'All actors':name)}</option>`).join('');select.dataset.ready='true';select.onchange=()=>{state.actor=select.value;renderReports();};}
  select.value=state.actor;
}
function markSelection(context){
  selectedContext=context;
  const caption=$('#selection-caption');
  caption.textContent=context?context.description:'Reference geography. Select a development to inspect its evidence.';
  caption.classList.toggle('has-selection',Boolean(context));
  $$('[data-story]').forEach(button=>{const selected=context?.kind==='report'&&button.dataset.story===context.id;button.setAttribute('aria-pressed',String(selected));button.closest('.feed-item')?.classList.toggle('is-selected',selected);});
  $$('[data-globe-theatre]').forEach(marker=>marker.classList.toggle('is-context',Boolean(context?.theaters?.includes(marker.dataset.globeTheatre))));
}
function openInspector(kicker,content,{refresh=false,context=null}={}){
  const inspector=$('#context-inspector'),body=$('#inspector-content'),active=document.activeElement;
  if(!refresh){
    if(!inspector.contains(active))inspectorReturn={node:active,reportId:active?.dataset.story||active?.dataset.monitorReport||active?.dataset.priorityReport,monitor:!!active?.dataset.monitorReport,priority:!!active?.dataset.priorityReport,priorityKey:active?.dataset.priorityKey};
    inspectorMode=null;selectedMmsi=null;
    if($('#detail-dialog').open)$('#detail-dialog').close();
    markSelection(context);
  }
  const scroll=body.scrollTop,restoreFocus=refresh?preserveViewFocus(body,$('#inspector-kicker')):null;
  $('#inspector-kicker').textContent=kicker;
  const wasOpen=inspector.open,changed=body.innerHTML!==content;
  if(changed)body.innerHTML=content;
  inspector.hidden=false;
  if(!inspector.open){
    if(typeof matchMedia==='undefined'||matchMedia('(max-width: 1000px)').matches)inspector.showModal();
    else inspector.show();
  }
  if(globalThis.document?.body)document.body.classList.add('inspector-open');
  $('.context-column').classList.add('has-selection');
  // A new selection in an open drawer swaps in; refreshed evidence stays still.
  if(!refresh&&wasOpen&&changed)enterSequence(body.children,{y:6});
  body.scrollTop=refresh?scroll:0;
  if(refresh&&context)markSelection(context);
  restoreFocus?.();
  if(!refresh){
    $('#inspector-kicker').focus({preventScroll:true});

  }
}
function closeInspector(){
  const origin=inspectorReturn;inspectorReturn=null;inspectorMode=null;selectedMmsi=null;
  $('#context-inspector').close();$('#context-inspector').hidden=true;$('.context-column').classList.remove('has-selection');document.body.classList.remove('inspector-open');
  markSelection(null);renderOil();
  const returnTo=origin?.node?.isConnected?origin.node:origin?.reportId?$$('[data-story], [data-monitor-report], [data-priority-report]').find(button=>(origin.priority?button.dataset.priorityKey:origin.monitor?button.dataset.monitorReport:button.dataset.story)===(origin.priority?origin.priorityKey:origin.reportId)):null;
  if(returnTo?.getClientRects().length)returnTo.focus({preventScroll:true});else $('#tab-'+workspaceFor(state.view)).focus({preventScroll:true});
}
$('#inspector-close').onclick=closeInspector;
$('#context-inspector').addEventListener('cancel',event=>{event.preventDefault();closeInspector();});
$('#context-inspector').addEventListener('click',event=>{if(event.target!==event.currentTarget)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeInspector();});
$('#context-inspector').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeInspector();}});
const inspectorMedia=matchMedia('(max-width: 1000px)');
inspectorMedia.addEventListener('change',()=>{
 const inspector=$('#context-inspector');if(!inspector.open)return;
 const active=document.activeElement;inspector.close();if(inspectorMedia.matches)inspector.showModal();else inspector.show();
 active?.focus({preventScroll:true});
});
function renderReports(){
  const feed=$('#feed'),scroll=feed.scrollTop,active=document.activeElement;
  const focusKey=active?.dataset.story?'story':active?.dataset.save?'save':active?.dataset.reportGroup?'reportGroup':null,focusId=focusKey?active.dataset[focusKey]:null;
  $('#reporting-coverage').textContent=runtime.configurationNotice||reportingCoverageText(state.news?.coverage,{hosted:runtime.hosted});
  renderActors();const sourceStates=allSourceStates(),links=reports(),groups=groupReporting(links),items=groups.map(group=>group.reports[0]),c=coverage(sourceStates),unconfigured=runtime.configurationError&&state.view!=='saved',unknown=state.view!=='saved'&&!items.length&&(state.includeArchive?c.unknown:!sourceStates.some(isActiveReportingSource));$('#feed-count').textContent=unknown?'—':`${items.length} groups`;$('#feed-count').title=`${items.length} headline groups · ${links.length} source links · not events`;
  $('#feed-heading').textContent=state.view==='saved'?'Saved reporting':state.includeArchive?'Reporting & historical archive':state.view==='civilian'?'Passage & civilian impact':state.view==='energy'?'Energy reporting':'Latest reporting';
  $('#feed').innerHTML=items.length?items.map((x,index)=>`<article class="feed-item"><div class="feed-meta"><span>${esc(x.source)}</span><span>·</span><span>${esc(x.type)}</span>${!isActivePublisherReport(x,sourceStates)?'<span>Historical archive</span>':''}<time ${reportTime(x)?`datetime="${esc(reportTime(x))}"`:""} title="${esc(reportTimeLabel(x)+' · '+fmtDate(reportTime(x)))}">${esc(isActivePublisherReport(x,sourceStates)?reportAge(x):reportTimeLabel(x)+' · '+fmtDate(reportTime(x)))}</time></div><button class="story-title" data-story="${x.id}">${esc(x.title)}</button>${groups[index].reports.length>1?`<button class="feed-group-button" data-report-group="${esc(x.id)}">${groups[index].reports.length} matching headlines · inspect links</button>`:''}${!isActivePublisherReport(x,sourceStates)?`<p class="archive-record-date">Historical record · last retrieved ${esc(stamp(x.retrievedAt||x.lastSeenAt))}</p>`:''}<div class="feed-tags">${x.type==='Independent energy analysis'?'<span class="tag mint">ANALYSIS</span>':''}${(x.theaters||[]).map(t=>`<span class="tag">${t==='bab'?'RED SEA':'HORMUZ'}</span>`).join('')}${x.relevanceScopes?.includes('regional-energy')?'<span class="tag mint">REGIONAL ENERGY</span>':x.relevanceScopes?.includes('global-energy')?'<span class="tag mint">MARKET CONTEXT</span>':''}${x.retainedForReading?'<span class="tag">KEPT FOR READING</span>':x.retainedFromHistory?'<span class="tag">RETAINED HISTORY</span>':''}${x.actors.includes('Civilians')?'<span class="tag mint">CIVILIAN IMPACT</span>':''}<button class="bookmark ${state.saved[x.id]?'saved':''}" data-save="${x.id}" aria-label="${state.saved[x.id]?'Unsave':'Save'} report" title="${state.saved[x.id]?'Unsave':'Save'} report">${state.saved[x.id]?'◆':'◇'}</button></div></article>`).join(''):`<div class="empty"><strong>${state.view==='saved'?'No saved reports match this view.':unconfigured?'Reporting is not configured.':unknown?(c.pending?'Checking reporting sources.':'Reporting is unavailable.'):'No current reports match these filters.'}</strong>${state.view==='saved'?'Saved reports remain on this browser.':unconfigured?esc(runtime.configurationNotice):unknown?'Current publisher reporting is unavailable. Coverage & sources has details; the historical archive remains accessible.':c.incomplete?'Try a wider date window or include the historical archive. No matching reports do not establish that no events occurred.':'Try a wider reporting window or reset the filters. Retrieved reports are not a complete account of events.'}<br>${unknown?'':'<button id="reset-filters" class="text-button">Reset filters</button>'}</div>`;
  $$('[data-story]').forEach(b=>b.onclick=()=>showStory(b.dataset.story));$$('[data-save]').forEach(b=>b.onclick=()=>toggleSave(b.dataset.save));if($('#reset-filters'))$('#reset-filters').onclick=resetFilters;
  $$('[data-report-group]').forEach(button=>button.onclick=()=>{const group=groups.find(group=>group.reports[0].id===button.dataset.reportGroup);if(!group)return;openDialog('MATCHING HEADLINES',`<h2>${esc(group.title)}</h2><p>Matching wording is not independent confirmation or a verified event count. Each link retains its own source and date.</p><ul class="brief-list">${group.reports.map(row=>`<li><a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">${esc(row.source)} ↗</a><small>${esc(reportTimeLabel(row))} · ${esc(stamp(reportTime(row)))}</small></li>`).join('')}</ul>`);});
  feed.scrollTop=scroll;
  if(focusKey){
    const target=$$(`[data-${focusKey==='reportGroup'?'report-group':focusKey}]`).find(button=>button.dataset[focusKey]===focusId),heading=$('#feed-heading');
    (target?.getClientRects().length?target:heading.getClientRects().length?heading:null)?.focus({preventScroll:true});
  }
  renderScope();markSelection(selectedContext);renderMetrics();renderTheaters();renderCivilianSummary();renderAcledSummary();monitoring?.update();priority?.update();renderArrivals();
}
function renderArrivals(){
  const incoming=monitoring?.pendingCount()||0,retained=monitoring?.retainedCount()||0;
  $('#reporting-arrivals').hidden=!incoming&&!retained;
  $('#reporting-arrivals-copy').textContent=`${incoming?`${incoming} new source links waiting. `:''}${retained?`${retained} prior links held for reading. `:''}Your reading position stays in place until you apply the refresh.`;
}
$('#reporting-apply').onclick=()=>{monitoring.acceptArrivals();$('#feed-heading').focus({preventScroll:true});};
function resetFilters(){state.theater='both';state.actor='All';state.query='';state.hours='72';$('#search').value='';$('#time-window').value='72';if(state.view!=='saved')setView('overview');setTheater('both');}
function storyById(id){return state.latestNews?.items.find(x=>x.id===id)||state.news?.items.find(x=>x.id===id)||state.saved[id]||(selectedReport?.id===id?selectedReport:null);}
function toggleSave(id){
  const story=storyById(id);if(!story)return;
  if(state.saved[id])delete state.saved[id];else state.saved[id]=story;
  const persisted=storage.set('saved',state.saved);renderReports();
  if(persisted)toast(state.saved[id]?'Report saved on this device':'Report removed from saved items');
}
function showStory(id){
  const x=storyById(id);if(!x)return;selectedReport=x;
  const source=allSourceStates().find(item=>item.id===x.sourceId)||{};
  if(x.theaters?.length===1)globe?.select(x.theaters[0]);
  openInspector('SOURCE RECORD',reportInspectorMarkup(x,{source,saved:Boolean(state.saved[id]),note:state.notes[id]||''}),{context:{kind:'report',id:x.id,theaters:x.theaters||[],description:`Selected reporting · ${(x.theaters||[]).map(t=>names[t]).join(' / ')||'Regional context'} · precise location not mapped`}});
  bindInspectorTabs($('#inspector-content'));
  $('#inspect-report-system').onclick=()=>openOilSystem(x);
  $('#inspect-official-records').onclick=()=>{closeInspector();setView('evidence');$('#incident-heading').focus({preventScroll:true});$('#incident-section').scrollIntoView({block:'start',behavior:'instant'});};
  $('#detail-save').onclick=()=>{toggleSave(id);$('#detail-save').textContent=state.saved[id]?'Saved ✓':'Save report';};
  $('#save-note').onclick=()=>{state.notes[id]=$('#analyst-note').value.slice(0,10000);if(storage.set('notes',state.notes))toast('Note saved on this device');};
}
// Counts of received positions and duplicated quotes are not headline indicators.
function renderMetrics(){}
function renderTheaters(){}
function setTheater(t){
  if(!names[t])return;state.theater=t;globe?.select(t);
  $$('[data-theater]').forEach(b=>{b.classList.toggle('active',b.dataset.theater===t);b.setAttribute('aria-pressed',String(b.dataset.theater===t));});
  expectationsView.update();renderReports();renderVessels();renderWeather();renderScope();renderExposureBaseline();situation.update();oilSystem.update({theater:state.theater});
  $('#console-response').textContent=t==='both'?'Overview of both theatres.':`Focused on ${names[t]}. Reporting, vessels and forecasts follow this selection. Oil prices provide shared market context.`;
}
function showOverview(){state.actor='All';state.query='';$('#search').value='';setView('overview');setTheater('both');}
function renderScope(){
  const overview=state.theater==='both',scene=workspaceFor(state.view);
  const titles={overview:overview?'The passage, in context.':names[state.theater],reporting:state.view==='saved'?'Your saved reporting':state.view==='civilian'?'Supply & crew impacts':'Follow the reporting',energy:'Read the energy market',evidence:'Understand the evidence'};
  const descriptions={overview:'Two chokepoints. Follow the source before the signal.',reporting:'A single stream of source-linked reporting. Search, filter and inspect.',energy:'Measured prices, historical exposure and market expectations — separately dated.',evidence:'Official records, regional connections and the limits of this watch.'};
  $('#view-title').textContent=titles[scene];$('#scope-subtitle').textContent=descriptions[scene];
  $('#workspace-filter-note').textContent=state.actor==='All'?'':`Reporting actor: ${state.actor}`;
  $('#oil-heading').textContent='Brent & WTI · daily spot';
}
function setView(view){
  if(!['overview','reporting','energy','evidence','civilian','saved'].includes(view))return;
  state.view=view;$('#workspace').className='view-'+view;workspaceView?.update(view);oilSystem.setActive(view==='energy');
  renderScope();renderReports();renderOil();
}
function impactRelevantEvent(event){
  const text=[event.eventType,event.subEventType,event.civilianTargeting,event.notes,event.actor1,event.actor2].filter(Boolean).join(' ');
  return !/peaceful protest|protest with intervention|protest without intervention|protest\b/i.test(text)&&(/violence against civilians|battle|armed clash|attack|explosion|abduction|maritime|port|pipeline|oil|tanker|missile|drone|civilian|fatal/i.test(text)||event.civilianTargeting);
}
function renderCivilianSummary(){}
function renderExposureBaseline(){const target=$('#oil-exposure');if(!target)return;const items=EXPOSURE_BASELINE.filter(x=>state.theater==='both'||x.scope.includes(state.theater));target.innerHTML=`<div class="exposure-heading"><span class="eyebrow">CHOKEPOINT EXPOSURE · EIA BASELINE</span><a href="https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/" target="_blank" rel="noopener noreferrer">EIA chokepoints ↗</a></div><div class="exposure-grid">${items.map(x=>`<article class="exposure-card"><span>${esc(x.label)}</span><strong>${esc(x.value)}</strong><small>${esc(x.detail)}</small></article>`).join('')}</div><p class="exposure-note">Historical flows are exposure baselines, not current throughput. Bypass operating status is separately dated in the situation evidence.</p>`;}
function renderOilContext(){
  const now=Date.now(),pulse=$('#market-pulse'),html=renderMarketPulse(state.oil,{failed:state.failures.oil,now});
  if(pulse.innerHTML!==html){const focused=pulse.contains(document.activeElement);pulse.innerHTML=html;if(focused)pulse.querySelector('button')?.focus({preventScroll:true});}
  oilSystem.update({oil:state.oil,oilFailed:state.failures.oil,theater:state.theater,now});
}
function renderOil(){
  renderExposureBaseline();
  renderOilContext();
  const series=state.oil?.series||[];
  $('#oil-summary').innerHTML=series.length?series.map(s=>{const p=normalizeOilObservations(s.observations,{now:Date.now()}).filter(point=>point.value!==null).at(-1);return `<div class="oil-quote"><span class="${s.id}-label">${s.id==='brent'?'━':'┄'} ${esc(s.name)}</span><strong>${money(p?.value)}</strong><small data-oil-state="${s.id}">${p?`${esc(fmtDate(p.date))} · ${esc(allSourceStates().find(x=>x.id===s.id)?.label||'daily spot')}`:'Source unavailable'}</small></div>`;}).join(''):`<p class="muted">${state.failures.oil?'Oil observations unavailable. Inspect Sources for the failed connection.':state.oil?'No daily observations were retrieved.':'Checking daily EIA observations…'}</p>`;
  oilChart.update(series,{period:state.period,loading:!state.oil&&!state.failures.oil,failed:Boolean(state.failures.oil)});
}
function renderWeather(){const data=state.weather;if(!data){if(state.failures.weather)$('#weather').innerHTML='<div class="empty">Marine data is unavailable. Check Sources for the live-data connection.</div>';return;}const now=Date.now();
  $('#weather').innerHTML=data.theaters.filter(t=>state.theater==='both'||t.id===state.theater).map(t=>{const wind=t.wind?.current,marine=t.marine?.hourly;let i=marine?.time.findIndex(d=>Date.parse(d+'Z')>=now)??-1;if(i>0)i--;const wave=i>=0?marine.wave_height[i]:null,period=i>=0?marine.wave_period[i]:null,stamp=marine?.time[i],stale=wind&&now-Date.parse(wind.time+'Z')>7200000;const val=(v,unit)=>v!==null&&v!==undefined?`${Number(v).toFixed(1)}<small> ${unit}</small>`:'—';return `<div class="weather-row"><div class="weather-top"><strong>${esc(t.name)}</strong><span>${stale?'Older model time':stamp?fmtDate(stamp+'Z')+' · '+fmtTime(stamp+'Z')+' UTC':'Unavailable'}</span></div><div class="weather-values"><div><strong>${val(wave,'m')}</strong><span>Wave height</span></div><div><strong>${val(wind?.wind_speed_10m,'km/h')}</strong><span>Wind at 10 m</span></div><div><strong>${val(period,'s')}</strong><span>Wave period</span></div></div></div>`;}).join('');
}
function acledEvents(){
  const cutoff=state.hours==='all'?0:Date.now()-Number(state.hours)*3600000;
  return (state.acled?.events||[]).filter(event=>(state.theater==='both'||event.theaters?.includes(state.theater))&&(state.actor==='All'||event.actors?.includes(state.actor))&&(!cutoff||Date.parse(event.eventDate+'T00:00:00Z')>=cutoff)&&(state.view!=='civilian'||impactRelevantEvent(event)));
}
function showAcledEvent(id){
  const event=(state.acled?.events||[]).find(x=>x.id===id);if(!event)return;
  const coords=Number.isFinite(event.latitude)&&Number.isFinite(event.longitude)?`${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)}`:'No coordinates returned';
  openInspector('ACLED STRUCTURED EVENT',`<h2>${esc(event.title)}</h2><div class="detail-meta">${esc(event.country)} · event date ${esc(fmtDate(event.eventDate+'T00:00:00Z'))} · record ${esc(event.recordId)}</div><dl class="vessel-facts"><div><dt>Actors</dt><dd>${esc(event.actors?.join(' · ')||'No classified actor')}</dd></div><div><dt>Event type</dt><dd>${esc(event.eventType||'Not reported')}${event.subEventType?' · '+esc(event.subEventType):''}</dd></div><div><dt>Location</dt><dd>${esc([event.location,event.admin1,event.admin2].filter(Boolean).join(' · ')||'Not reported')}</dd></div><div><dt>Coordinates</dt><dd>${esc(coords)} · geo precision ${esc(event.geoPrecision??'not reported')}</dd></div><div><dt>Time precision</dt><dd>${esc(event.timePrecision??'not reported')}</dd></div><div><dt>Updated in source</dt><dd>${esc(stamp(event.updatedAt))}</dd></div></dl><p>ACLED event date and location fields are preserved separately from the source upload time. This record is scoped to ${esc(event.country)} for theatre context; that country scope is not maritime geocoding. Civilian targeting and fatalities are reported fields when present, not independent verification.</p><div class="detail-actions"><a class="primary-link" href="${esc(event.url)}" target="_blank" rel="noopener noreferrer">Open ACLED record ↗</a><a class="text-button" href="${esc(event.sourceUrl)}" target="_blank" rel="noopener noreferrer">API field documentation ↗</a></div>`);
  inspectorMode='acled-event';markSelection({kind:'event',id:event.id,theaters:event.theaters,description:`${event.title} · reported event location and precision in details`});
}
function renderAcledSummary(){
  const target=$('#acled-summary');if(!target)return;
  if(runtime.configurationError){target.innerHTML=`<p class="empty">${esc(runtime.configurationNotice)}</p>`;return;}
  const source=allSourceStates().find(s=>s.id==='acled'),data=state.acled,events=acledEvents();
  globe?.setEvents(state.showEvents?events.filter(impactRelevantEvent):[]);
  if(!data){target.innerHTML=state.failures.acled?'<p class="empty">ACLED is unavailable. Open Sources for connection details; other reporting remains available.</p>':'<p class="empty">Checking ACLED event access…</p>';return;}
  if(data.configured===false){target.innerHTML=runtime.privateConnectionsAllowed?'<p class="empty"><strong>ACLED is not connected.</strong> Sign in through <a href="./connections/acled.html">Sources → ACLED</a> to load structured event records.</p>':'<p class="empty"><strong>Private ACLED access is local only.</strong> Personal account records are not published by this site.</p>';return;}
  const range=data.from&&data.to?`${esc(fmtDate(data.from+'T00:00:00Z'))} – ${esc(fmtDate(data.to+'T00:00:00Z'))}`:'Selected date window';
  const caveat=data.truncated?' Results are capped; narrow the date window in Research.':data.source?.connection==='cached'?' The last successful result is retained while the update is retried.':'';
  target.innerHTML=`<div class="acled-meta"><span>${esc(source?.label||'ACLED')}</span><span>${events.length} records · ${range}</span></div><p class="acled-basis">Country/date filtered records · theatre labels are contextual scopes, not maritime geocoding. Event date and source update time stay separate.${esc(caveat)}</p>${events.length?`<div class="acled-events">${events.slice(0,5).map(event=>`<button class="acled-event-row" data-acled-event="${esc(event.id)}"><span><strong>${esc(event.title)}</strong><small>${esc(fmtDate(event.eventDate+'T00:00:00Z'))} · ${esc(event.country)} · ${esc(event.actors?.join(' · ')||'No classified actor')}</small></span><span>${Number.isFinite(event.latitude)?'MAP':'SCOPE'} ↗</span></button>`).join('')}</div>${events.length>5?'<a class="dialog-source-link" href="./research.html">Open all records in Research ↗</a>':''}`:'<p class="empty">No ACLED records match this theatre, actor, and date window. This does not establish that no conflict event occurred.</p>'}`;
  $$('[data-acled-event]').forEach(button=>button.onclick=()=>showAcledEvent(button.dataset.acledEvent));
}
function renderGlobeHover(hit){
  const tip=$('#globe-tooltip');if(!tip)return;
  if(!hit){tip.hidden=true;tip.innerHTML='';return;}
  const kind=hit.kind==='infrastructure'?'ENERGY GEOGRAPHY':hit.kind==='route'?'REFERENCE CORRIDOR':hit.kind==='vessel'?'RECEIVED AIS POSITION':'STRUCTURED EVENT';
  const action=hit.kind==='infrastructure'?'Approximate reference · click for source context':hit.kind==='route'?'Reference corridor · not an observed vessel track':hit.kind==='vessel'?`${hit.vesselType||'Type not reported'} · ${hit.provider||'AIS'} · ${hit.positionTime?relative(hit.positionTime):'time unknown'} · click for details`:'Click for event fields, date precision, and source link';
  tip.innerHTML=`<strong>${esc(kind)}</strong><span>${esc(hit.label||hit.id)}</span><small>${esc(action)}</small>`;
  tip.hidden=false;
  const surface=$('.globe-surface'),maxX=Math.max(8,surface.clientWidth-tip.offsetWidth-8),maxY=Math.max(8,surface.clientHeight-tip.offsetHeight-8);
  tip.style.left=Math.min(maxX,Math.max(8,hit.x+14))+'px';tip.style.top=Math.min(maxY,Math.max(8,hit.y+14))+'px';
}
function backgroundCollection(){return runtime.hosted?collectorHealth(state.news?.coverage?.collection):null;}
function allSourceStates(){return collectSources(state);}
function notice(id,target,text){let el=$('#'+id);if(!el){el=document.createElement('p');el.id=id;el.className='source-notice';const anchor=$(target);if(!anchor)return;anchor.before(el);}if(el.textContent!==text)el.textContent=text;el.hidden=!text;}
function renderStatus(){
  const sources=allSourceStates(),collector=backgroundCollection();$('#source-status').textContent='Coverage & sources';
  if(collector){notice('collector-notice','#feed',!runtime.configurationError&&collector.attention?collector.notice+' Inspect Sources.':'');$('#collector-notice').setAttribute('role','status');$('#collector-notice').setAttribute('aria-live','polite');}
  $('#source-status').title='Coverage limits, available sources and diagnostics';
  notice('reporting-notice','#feed',runtime.configurationNotice|| (state.view==='saved'?'Saved reporting stays in this browser; source status describes the current feed.':panelNotice(sources,'news')));
  notice('oil-notice','#oil-summary',runtime.configurationNotice||panelNotice(sources,'oil'));notice('weather-notice','#weather',runtime.configurationNotice||panelNotice(sources,'weather'));
  notice('acled-notice','#acled-summary',runtime.configurationNotice||panelNotice(sources,'acled'));
  expectationsView.update();renderMetrics();renderAcledSummary();situation.update();
  if(dialogMode==='sources'){renderSourceCards();renderAvailableSources();}monitoring?.update();priority?.update();
}
function sourceCards(){if(runtime.configurationError)return `<section class="source-card"><div><strong>Live-data connection</strong><span>Not configured</span></div><p>${esc(runtime.configurationNotice)}</p><p>Provider connection states and background collection times will appear after this site is connected to its live-data service.</p></section>`;return (runtime.hosted?collectorCard(state.news?.coverage?.collection):'')+allSourceStates().filter(s=>s.configured!==false).map(s=>`<section class="source-card"><div><strong>${esc(s.name)}</strong><span class="source-state ${s.attention?'stale':s.connection==='connected'?'connected':''}">${esc(s.label)}</span></div><p>${s.configured===false?(s.id==='reliefweb'?'Requires a provider-approved appname.':s.id==='acled'?(runtime.privateConnectionsAllowed?'Sign in locally to check your account access.':'Personal ACLED records are not available on the public site.'):(runtime.hosted?'This source is not enabled by the live-data service.':'Add a local key to enable this source.')):`Connection: ${esc(s.connection)}${s.access?' · '+esc(s.access):''}<br>Last successful retrieval: ${esc(stamp(s.retrievedAt))}${s.group==='news'?`<br>Newest source publication: ${esc(stamp(s.latest))}<br>Newest relevant publication: ${esc(stamp(s.latestRelevant))}`:s.group==='discovery'?`<br>Newest index discovery: ${esc(stamp(s.latestDiscoveredAt))}<br>Publication and event dates are unknown unless supplied by the publisher.<br>Bounded ${Number.isFinite(s.windowDays)?s.windowDays:7}-day query · at most ${Number.isFinite(s.resultLimit)?s.resultLimit:250} results in this snapshot.${s.possiblyTruncated?' Result limit reached.':''}`:s.id==='acled'?(s.sampleOnly===false?`<br>Structured event layer · country/date filtered records.<br>Newest event date in window: ${esc(s.latest||'Not available')}`:`<br>Account access sample only; not a conflict feed.<br>Latest event date in sample: ${esc(s.newestSampleEventDate||'Not available')}`):s.group==='maritime'?`<br>Newest listed record date: ${esc(s.latest||'Not specified')}<br>Publisher page update: ${esc(s.sourceUpdatedDate||'Not specified')}<br>Record dates and source retrieval use separate clocks.`:s.group==='oil'?`<br>Daily observation date: ${esc(fmtDate(s.latest))} (date only)`:s.group==='expectations'?'<br>Quoted probability snapshot; provider metadata update is not a trade timestamp.':s.group==='market'?`<br>Weekly U.S. observation: ${esc(fmtDate(s.latest))} · not Middle East flows`:s.id==='openwaters'?`<br>Snapshot positions retained: ${Number.isFinite(s.recordCount)?s.recordCount:0}<br>Newest provider position: ${esc(stamp(s.latest))}<br>Anonymous read tier · source/station attribution retained`:s.group==='vessels'?`<br>Subscription accepted: ${esc(stamp(s.connectedAt))}<br>Latest provider position: ${esc(stamp(s.latestProviderPositionAt))}<br>Latest accepted position received: ${esc(stamp(s.lastPositionReceivedAt))}<br>Last frame received: ${esc(stamp(s.lastFrameAt))}<br>Frames observed: ${Number.isFinite(s.frames)?s.frames:0} · Position frames: ${Number.isFinite(s.positionFrames)?s.positionFrames:0}<br>Heartbeat: ${esc(s.heartbeat||'Not available')} · ${esc(stamp(s.lastHeartbeatAt))}<br>Position clock: ${esc(s.timestampBasis||'No retained position')}`:'<br>Forecast valid times appear in Marine conditions. Original model-run age is unknown.'}<br>${s.id==='aisstream'?'Continuous stream · local view every 10 seconds':`Provider check interval: ${s.interval<60?s.interval+' seconds':Math.round(s.interval/60)+' minutes'}`}${s.nextRetryAt?`<br>Next eligible check: ${esc(stamp(s.nextRetryAt))}`:''}${s.error?`<br>Issue: ${esc(s.error)}${s.httpStatus?' (HTTP '+s.httpStatus+')':''}`:''}${s.limitations?`<br>${esc(s.limitations)}`:''}${s.cacheIssue?`<br>Storage: ${esc(s.cacheIssue)}`:''}`}</p>${s.id==='doomberg'?'<button class="text-button" data-browse-source="doomberg" data-source-link="doomberg-browse">Browse free previews →</button><br>':''}${s.id==='acled'&&runtime.privateConnectionsAllowed?'<a class="dialog-source-link" href="./connections/acled.html">Manage ACLED connection →</a><br>':''}<a class="dialog-source-link" data-source-link="${s.id}" href="${esc(s.home)}" target="_blank" rel="noopener noreferrer">Open source ↗</a></section>`).join('');}

$('#detail-dialog').addEventListener('click',event=>{
  if(!event.target.closest('[data-browse-source="doomberg"]'))return;
  $('#detail-dialog').close();state.query='Doomberg';state.actor='All';state.hours='all';$('#search').value=state.query;$('#time-window').value='all';setView('reporting');setTheater('both');$('#search').focus();
});

function renderAvailableSources(){
  const target=$('#available-source-list');if(!target)return;
  const html=sourceRosterMarkup(allSourceStates());if(target.innerHTML===html)return;
  const focused=target.contains(document.activeElement)?document.activeElement?.dataset.availableSource:null;
  target.innerHTML=html;
  if(focused)([...target.querySelectorAll('[data-available-source]')].find(link=>link.dataset.availableSource===focused)||$('#dialog-close'))?.focus({preventScroll:true});
}
function renderSourceCards(){
  if(!$('#source-list'))return;const focus=document.activeElement?.dataset.sourceLink;$('#source-list').innerHTML=sourceCards();
  if(focus)$(`[data-source-link="${focus}"]`)?.focus({preventScroll:true});
}
function renderDiagnostics(){
  if(!$('#diagnostic-summary'))return;const d=state.diagnostics;
  $('#diagnostic-summary').textContent=runtime.configurationNotice|| (state.diagnosticsError?'Diagnostics request failed. The previous snapshot, if present, is retained.':d?`Passage ${d.version} · source readiness: ${d.readiness} · snapshot ${stamp(d.generatedAt)}. ${d.retention}`:'Checking source diagnostics…');
  $('#diagnostic-data').textContent=d?JSON.stringify({sources:d.sources,requests:d.requests,metrics:d.metrics,ais:d.ais,events:d.events},null,2):'No diagnostic snapshot yet.';
  $('#export-diagnostics').disabled=!d;
}
async function loadDiagnostics(){if(diagnosticsBusy||runtime.configurationError)return;diagnosticsBusy=true;try{const r=await apiFetch('/api/diagnostics',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error();state.diagnostics=await r.json();state.diagnosticsError=false;}catch{state.diagnosticsError=true;}finally{diagnosticsBusy=false;if(dialogMode==='sources')renderDiagnostics();}}
function showSources(){
  const retired=allSourceStates().filter(source=>source.retired);
  openDialog('COVERAGE & SOURCES',`<h2>Available sources.</h2><p>These sources have completed a successful update. Their records retain their own dates; availability does not mean complete coverage.</p><p class="coverage-category-note">Current maritime advisories are unavailable. IMO incident records have separate coverage; missing advisories do not mean there are no hazards.</p><div id="available-source-list">${sourceRosterMarkup(allSourceStates())}</div><details class="diagnostics source-diagnostics"><summary>Technical source diagnostics</summary><div id="source-list">${sourceCards()}</div><h3>Retired collection</h3><p>These collectors no longer make requests or contribute to the active source roster. Historical evidence remains separately dated in the archive.</p><ul>${retired.map(source=>`<li><strong>${esc(source.name)}</strong> — ${esc(source.retirementReason)}</li>`).join('')}</ul><p id="diagnostic-summary"></p><button class="text-button" id="export-diagnostics" disabled>Download diagnostics</button><details class="diagnostics"><summary>Inspect source attempts and reception</summary><pre id="diagnostic-data"></pre></details><p>Diagnostics include source status, timestamps and bounded counters. They exclude credentials, article bodies, analyst notes and vessel identifiers.</p></details>`);
  dialogMode='sources';$('#export-diagnostics').onclick=()=>downloadJSON({...state.diagnostics,exportedAt:new Date().toISOString(),snapshotRetainedAfterRequestFailure:state.diagnosticsError},'Passage_Diagnostics');renderDiagnostics();loadDiagnostics();
}
function downloadJSON(payload,name){const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=new Date().toISOString().slice(0,10)+'_'+name+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const designSources=[['Territory Studio / Avengers interface work','https://www.behance.net/gallery/26009421/AVENGERS-Age-of-Ultron-UI-Screen-Graphics'],['Nielsen Norman Group / Dashboard perception','https://www.nngroup.com/articles/dashboards-preattentive/'],['W3C / Contrast requirements','https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html'],['W3C / Animation from interactions','https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html'],['Natural Earth / Public domain map data','https://www.naturalearthdata.com/about/terms-of-use/']];
function showGuide(){
 openDialog('READING PASSAGE',`<h2>Follow the source before the signal.</h2><p>Watch orients you on a regional terrain scene and a small selection of reporting. Reporting is the searchable archive. Energy holds dated observations and the possible oil connection. Evidence keeps official records and coverage together.</p><h3>Three steps, one record</h3><p><strong>Claim:</strong> preserve the original headline and open its source. <strong>Confirm:</strong> distinguish the event, publication, discovery and retrieval clocks. <strong>Oil connection:</strong> explore a possible mechanism without treating it as a measured effect.</p><h3>Geography is reference</h3><p>The regional terrain is static source-derived elevation. Its source, resolution, processing and exaggeration are available below the scene. It is not a current operating picture or navigation aid. Use Top-down, Wider or Reset view; arrow keys adjust the camera and plus/minus zoom. There is no automatic orbit. Reduced-motion preferences are respected.</p><p>Optional vessel symbols show received positions with their own timestamps. They do not measure traffic, cargo or passage completion. Infrastructure is approximate reference geography. Headline relevance is never turned into an incident coordinate.</p><h3>Prices retain their own dates</h3><p>Brent and WTI are EIA daily spot observations with publication lag. Missing values are not filled. The chart explains its common gap policy. Neither shared timing nor a topic match establishes causation. Forecasts, expectations and historical exposure are separately disclosed.</p><h3>Personal reading tools</h3><p>Saved links and notes remain in this browser. Incoming reports wait for you to apply them so your reading position stays stable. The archive may be bounded or retained; no matches is not evidence that nothing happened.</p><h3>Keyboard commands</h3><div class="guide-options">${['focus Hormuz','focus Bab el-Mandeb','both theaters','show Iran','oil','saved','sources','brief','export','reset'].map(c=>`<button data-command="${c}">${c}</button>`).join('')}</div><p>These are local shortcuts. The brief selects existing source-linked headlines; it does not generate new claims.</p>`);
 $$('[data-command]').forEach(b=>b.onclick=()=>{$('#detail-dialog').close();runCommand(b.dataset.command);});
}
function showBrief(mode){
 const scope=['watch','reading'].includes(mode)?mode:workspaceFor(state.view)==='reporting'?'reading':'watch';
 const news=state.latestNews||state.news,sources=allSourceStates();
 const selection=buildPriorityBrief(news?{...news,items:news.items.filter(item=>isActivePublisherReport(item,sources))}:news,{theater:state.theater,actor:state.actor});
 const items=scope==='reading'?reports().slice(0,6):[...new Map(selection.cards.flatMap(card=>card.items.slice(0,2)).map(group=>[group.id,group.report])).values()];
 const description=scope==='reading'?`${items.length} source headlines in your current reading selection. Theatre, actor, search, date window and saved-only filters apply.`:`${items.length} selected publisher headlines from the latest loaded 72 hours. Theatre and actor apply; reading search and date filters do not.`;
 const c=coverage(allSourceStates());
 openDialog('SOURCE-LINKED BRIEF',`<h2>${esc(names[state.theater])}</h2><div class="segmented" role="group" aria-label="Brief scope"><button data-brief-scope="watch" aria-pressed="${scope==='watch'}" class="${scope==='watch'?'active':''}">Latest watch</button><button data-brief-scope="reading" aria-pressed="${scope==='reading'}" class="${scope==='reading'?'active':''}">Current reading</button></div><p>${esc(description)}</p><p class="record-limit">${c.unknown?'Source coverage is unknown.':c.incomplete?'Source coverage is incomplete.':'Successful source checks do not establish complete coverage.'} ${selection.inputTruncated||state.news?.coverage?.archive?.truncated?'Selection or archive limits can omit links. ':''}Publisher claims are not independently verified.</p><ul class="brief-list">${items.map(x=>`<li><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)} ↗</a><small>${esc(x.source)}${x.type==='Independent energy analysis'?' · Independent analysis':''} · ${esc(reportTimeLabel(x))}: ${esc(fmtDate(reportTime(x)))}</small></li>`).join('')||'<li>No retrieved reporting matches this selection. Check source coverage and filters.</li>'}</ul><p>Compare dated observations in Energy. Headline timing does not measure a price effect.</p><div class="detail-actions"><button id="read-brief" class="text-button">▷ Read aloud</button><button id="stop-brief" class="text-button">Stop audio</button><button id="brief-energy" class="text-button">Open Energy →</button></div>`);
 $$('[data-brief-scope]').forEach(button=>button.onclick=()=>showBrief(button.dataset.briefScope));
 $('#brief-energy').onclick=()=>{$('#detail-dialog').close();setView('energy');$('#view-title').focus({preventScroll:true});};
 $('#read-brief').onclick=()=>{if(!('speechSynthesis'in window)){toast('Read-aloud is unavailable in this browser');return;}speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(`${names[state.theater]}. ${description} Source coverage remains bounded and claims are not independently verified. ${items.map(x=>`${x.source} ${x.type==='Independent energy analysis'?'analysis':'reports'}: ${x.title}.`).join(' ')}`);u.rate=.96;speechSynthesis.speak(u);};
 $('#stop-brief').onclick=()=>window.speechSynthesis?.cancel();
}
function runCommand(raw){const c=raw.toLowerCase().trim();if(/hormuz/.test(c))setTheater('hormuz');else if(/bab|mandeb/.test(c))setTheater('bab');else if(/both/.test(c))setTheater('both');else if(/civilian|people/.test(c))setView('civilian');else if(/houthi|iran|us military|u\.s\./.test(c)){state.actor=/houthi/.test(c)?'Houthis':/iran/.test(c)?'Iran':'U.S. military';setView('overview');}else if(/oil|energy|brent/.test(c))setView('energy');else if(/^export/.test(c))exportView();else if(/saved|bookmark/.test(c))setView('saved');else if(/source/.test(c))showSources();else if(/brief/.test(c))showBrief();else if(/reset|overview/.test(c))resetFilters();else{showGuide();$('#console-response').textContent='Choose a supported command from the guide.';return;}$('#console-response').textContent=`Applied: ${raw}.`;}
async function loadAll(){
  loadVessels();if(state.busy)return;state.busy=true;$('#refresh').disabled=true;$('#refresh').textContent='…';
  const loaders=[['expectations','/api/expectations',35000],['config','/api/config',35000],['maritime','/api/maritime',35000],['news','/api/news',35000],['oil','/api/oil',35000],['market','/api/market-context',35000],['weather','/api/weather',35000],['acled','/api/acled/events?days=365',50000]];
  await Promise.all(loaders.map(async ([key,url,timeout])=>{
    try{const r=await apiFetch(url,{signal:AbortSignal.timeout(timeout)});if(!r.ok)throw Error();const incoming=await r.json();if(key==='news')state.latestNews=incoming;state[key]=key==='news'?monitoring.ingestNews(incoming):incoming;delete state.failures[key];}
    catch{state.failures[key]=true;}
    if(key==='expectations')expectationsView.update();if(key==='market')renderMarket();if(key==='news')renderReports();if(key==='oil'){renderOil();renderMetrics();renderCivilianSummary();}if(key==='weather')renderWeather();if(key==='acled'){renderAcledSummary();renderMetrics();}renderStatus();
  }));
  renderReports();renderOil();renderWeather();state.busy=false;$('#refresh').disabled=false;$('#refresh').textContent='↻';
  $('#last-refresh').textContent=runtime.configurationError?'Live data not configured':'View checked '+fmtTime(new Date().toISOString())+' UTC';renderStatus();
}
function exportView(){const items=reports(),layer=currentVesselLayer(),payload={exportedAt:new Date().toISOString(),version:state.config?.version||null,autoRefresh:state.auto,reportingCoverage:coverage(allSourceStates()),scope:{view:state.view,theater:state.theater,actor:state.actor,reportingWindowHours:state.hours,search:state.query,vesselLayer:layer.label},dataNotes:'Reporting records are not verified incident counts. Actor tags are text matches. EIA prices are delayed daily observations; shared timing does not establish causation. Oil prices provide shared market context. Regional reference routes are illustrative, not observed vessel tracks.',reports:items,notes:Object.fromEntries(items.filter(x=>state.notes[x.id]).map(x=>[x.id,state.notes[x.id]])),sourceStatus:allSourceStates().map(({items,models,observations,events,vessels,...meta})=>meta),maritime:situation.exportEvidence(),oil:state.oil,market:state.market,expectations:state.expectations,weather:state.weather?{...state.weather,theaters:state.weather.theaters.filter(t=>state.theater==='both'||t.id===state.theater)}:null,acled:state.acled?{...state.acled,events:acledEvents(),exportNote:'ACLED records are country/date filtered structured events. Theatre labels are contextual country scopes, not maritime geocoding; event date and source update time are separate.'}:null,vessels:state.vessels?{...state.vessels,vessels:visibleVessels(),scope:names[state.theater],snapshotNote:`Received AIS positions only; vessel layer is ${layer.label}. Incomplete reception, unverified identities. Age is based on provider time when supplied, otherwise receipt time.`}:null};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=new Date().toISOString().slice(0,10)+'_Passage_Watch-Export.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('View exported with source timestamps');}
const situation=createSituationView({getState:()=>state,getSources:allSourceStates,openDialog,openInspector,onSources:showSources,onFocus:theater=>{closeInspector();setView('overview');setTheater(theater);},onInfrastructure:()=>{state.showInfrastructure=true;const input=$('#show-infrastructure');if(input)input.checked=true;globe?.setInfrastructure(INFRASTRUCTURE);}});
monitoring=createMonitoringView({
  mount:$('#monitoring-dock'),getState:()=>state,
  onAccept:news=>{state.news=news;renderReports();renderStatus();},
  onReport:showStory,
  onFilter:({theater,actor})=>{if(actorNames.includes(actor))state.actor=actor;setView('reporting');if(theater&&names[theater])setTheater(theater);else renderReports();},
  onSources:showSources,
});
priority=createPriorityView({mount:$('#priority-watch'),getState:()=>state,onReport:showStory,onSources:showSources,onEvidence:situation.showEvidence,onArrivals:()=>monitoring.acceptArrivals(),getArrivalCount:()=>monitoring.pendingCount()});
function renderMarket(){
  const target=$('#market-context');if(!target)return;
  const html=renderMarketContext(state.market,{failed:Boolean(state.failures.market),now:Date.now()});
  if(target.innerHTML!==html){const restoreFocus=preserveViewFocus(target);target.innerHTML=html;restoreFocus();}
}
renderMarket();
const assetSelect=$('#asset-select');
assetSelect.innerHTML='<option value="">Choose a place…</option>'+INFRASTRUCTURE.map(asset=>`<option value="${esc(asset.id)}">${esc(asset.name)}</option>`).join('');
assetSelect.onchange=()=>{if(!assetSelect.value)return;state.showInfrastructure=true;$('#show-infrastructure').checked=true;globe?.setInfrastructure(INFRASTRUCTURE);situation.showAsset(assetSelect.value);};
$$('.secondary-nav a[href^="#"]').forEach(link=>link.onclick=event=>{const target=$(link.getAttribute('href'));if(!target)return;event.preventDefault();target.open=true;target.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});target.querySelector('summary')?.focus({preventScroll:true});});

situation.update();
workspaceView=createWorkspaceView({onNavigate:setView});bindDisclosures(document);$$('[data-theater]').forEach(b=>b.onclick=()=>setTheater(b.dataset.theater));$$('[data-period]').forEach(b=>b.onclick=()=>{state.period=+b.dataset.period;$$('[data-period]').forEach(x=>x.classList.toggle('active',x===b));renderOil();});$('#time-window').onchange=e=>{state.hours=e.target.value;renderReports();};$('#include-archive').onchange=e=>{state.includeArchive=e.target.checked;renderReports();};$('#search').oninput=e=>{state.query=e.target.value;renderReports();};$('#auto-refresh').onchange=e=>{state.auto=e.target.checked;$('passage-oil-quotes')?.toggleAttribute('paused',!state.auto);if(state.auto)loadVessels();renderVessels();renderStatus();toast(state.auto?'Automatic refresh enabled':'Automatic refresh paused');};$('#refresh').onclick=()=>{loadAll();toast('Checking sources; provider cache intervals still apply');};$('#show-vessels').onchange=e=>{state.showVessels=e.target.checked;renderVessels();};$('#vessel-filter').onchange=e=>{state.vesselFilter=e.target.value;renderVessels();renderMetrics();renderTheaters();};$('#show-infrastructure').onchange=e=>{state.showInfrastructure=e.target.checked;globe?.setInfrastructure(state.showInfrastructure?INFRASTRUCTURE:[]);};$('#map-layer-guide').onclick=()=>openDialog('MAP LAYERS',`<h2>Read the map</h2><dl class="vessel-facts"><div><dt>Arrows / circles</dt><dd>Received AIS positions. Arrows indicate reported direction; circles mean direction is missing. Hollow symbols are more than 10 minutes old.</dd></div><div><dt>Outlined squares</dt><dd>Approximate energy infrastructure references. Click for regional context; current operational status is not encoded.</dd></div><div><dt>Terrain &amp; coastline</dt><dd>Static elevation-derived geographic reference. Relief is exaggerated four times. This is not a navigable chart or a current operating-status layer.</dd></div></dl><p>The official IMO ledger preserves prose locations without placing invented coordinates on this regional map. Theater buttons, the vessel list and regional context provide keyboard-accessible details.</p>`);$('#price-table').onclick=()=>openDialog('DAILY OIL OBSERVATIONS',oilObservationTableMarkup(state.oil?.series,{period:state.period}));$('#vessel-list').onclick=showVesselList;$('#map-reset').onclick=()=>globe?.reset();$('#source-status').onclick=showSources;$('#sources-nav').onclick=showSources;$('#methodology').onclick=showGuide;$('#data-method').onclick=showGuide;$('#command-help').onclick=showGuide;$('#brief-button').onclick=showBrief;$('#export-button').onclick=exportView;$('#command-form').onsubmit=e=>{e.preventDefault();const raw=$('#command').value;runCommand(raw);$('#command').value='';};
function updateClock(){$('#utc-clock').textContent=new Date().toLocaleTimeString('en-GB',{hour12:false,timeZone:'UTC'})+' UTC';}updateClock();setInterval(updateClock,1000);setInterval(()=>{if(state.auto&&!document.hidden)loadAll();},LIVE_REFRESH_MS);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.auto)loadAll();});
setInterval(()=>{if(state.auto&&!document.hidden){loadVessels();if(dialogMode==='sources')loadDiagnostics();}else renderVessels();refreshAges();},10000);
$('passage-oil-quotes')?.toggleAttribute('paused',!state.auto);
$('.oil-spot-history')?.addEventListener('toggle',event=>{if(event.target.open)renderOil();});
if(location.hash){const target=document.getElementById(location.hash.slice(1));if(target?.matches('details.support-section')){setView('evidence');target.open=true;}else if(['market-expectations','oil-system'].includes(target?.id)){setView('energy');if(target.id==='oil-system')oilSystem.open();}}
// Preserve a direct diagram link after initial data changes the height above it.
// Any user input cancels this one-time alignment; refreshes never move the reader.
let initialAnchorUntouched=location.hash==='#oil-system';
const cancelInitialAnchor=()=>{initialAnchorUntouched=false;};
const anchorInputs=['pointerdown','keydown','wheel','touchstart','click'];
if(initialAnchorUntouched)anchorInputs.forEach(type=>window.addEventListener(type,cancelInitialAnchor,{passive:true}));
const pageLoaded=document.readyState==='complete'?Promise.resolve():new Promise(resolve=>window.addEventListener('load',resolve,{once:true}));
renderScope();renderActors();renderTheaters();renderStatus();renderOil();
Promise.all([loadAll(),pageLoaded]).then(()=>{if(initialAnchorUntouched&&location.hash==='#oil-system'&&state.view==='energy')oilSystem.open();anchorInputs.forEach(type=>window.removeEventListener(type,cancelInitialAnchor));});
createRegionalTerrain($('#globe'),{onSelect:setTheater,onVessel:showVessel,onEvent:showAcledEvent,onInfrastructure:hit=>situation.showAsset(hit),onHover:renderGlobeHover}).then(g=>{globe=g;globe.setInfrastructure(state.showInfrastructure?INFRASTRUCTURE:[]);globe.setEvents(state.showEvents?acledEvents().filter(impactRelevantEvent):[]);if(state.theater!=='both')globe.select(state.theater);renderVessels();});

let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderOil,120);});

function allVisibleVessels() {
  return (state.vessels?.vessels || []).map(v => {
    const ageSeconds = Math.floor((Date.now() - Date.parse(v.positionTime)) / 1000);
    return { ...v, ageSeconds, stale: ageSeconds >= 600 };
  }).filter(v => Number.isFinite(v.ageSeconds) && v.ageSeconds >= 0 && v.ageSeconds < 1800 && (state.theater === 'both' || v.theater === state.theater));
}
function currentVesselLayer(){return VESSEL_LAYERS[state.vesselFilter]||VESSEL_LAYERS.oil;}
function vesselMatchesLayer(v){const matches=currentVesselLayer().matches;return !matches||matches.includes(v.shipType||'unknown');}
function visibleVessels(){return allVisibleVessels().filter(vesselMatchesLayer);}
function renderVesselFilter(){
  const select=$('#vessel-filter');if(!select)return;
  const all=allVisibleVessels();select.innerHTML=Object.entries(VESSEL_LAYERS).map(([id,layer])=>`<option value="${id}">${layer.label} · ${layer.matches?all.filter(v=>layer.matches.includes(v.shipType||'unknown')).length:all.length}</option>`).join('');select.value=state.vesselFilter;
}
function renderVessels() {
  const data = state.vessels, all = allVisibleVessels(), vessels = all.filter(vesselMatchesLayer), layer=currentVesselLayer(), source = allSourceStates().find(s=>s.id==='aisstream'), fallbackSource = allSourceStates().find(s=>s.id==='openwaters');
  const aisConnected = source?.connection === 'connected' && !state.failures.vessels;
  const fallbackConnected = fallbackSource?.connection === 'connected' && !state.failures.vessels;
  const connected = aisConnected || fallbackConnected;
  const providers = [...new Set(all.map(v=>v.provider).filter(Boolean))];
  const providerLabel = providers.length ? providers.join(' + ') : fallbackConnected ? 'Open Waters' : 'AISStream';
  const current = vessels.filter(v => !v.stale).length;
  const status = !data ? (state.failures.vessels ? 'Live-data connection unavailable' : 'Checking connection')
    : !data.configured ? 'Public fallback checking'
    : !state.auto ? `Refresh paused · ${vessels.length} ${layer.metricLabel} retained`
    : state.failures.vessels ? 'Live-data connection unavailable'
    : connected && !all.length && aisConnected && source?.positionFrames===0 && !fallbackConnected ? 'Connected · no vessel positions received'
    : connected && vessels.length ? `${layer.detail} · ${vessels.length} received · ${current} under 10 min`
    : connected && all.length ? `No ${layer.detail.toLowerCase()} in view`
    : connected ? 'No received positions in view'
    : `${source?.connection||'disconnected'} · ${vessels.length} retained`;
  $('#vessel-status').textContent = status;
  $('#vessel-status').classList.toggle('receiving', connected && current>0 && state.auto);
  renderVesselFilter();
  $('#vessel-note').textContent = !data?.configured && data ? 'Public Open Waters positions are used when available. Add AISStream locally for a second stream.'
    : vessels.length ? `${names[state.theater]} · ${layer.detail} layer · received from ${providerLabel}. ${all.length-vessels.length?`${all.length-vessels.length} other positions hidden. `:''}Positions expire after 30 minutes.`
    : all.length ? `${names[state.theater]} · No typed ${layer.detail.toLowerCase()} positions in this snapshot. ${all.length} other received positions are hidden; switch Layer to inspect them.`
    : connected && aisConnected && source?.positionFrames===0 && !fallbackConnected ? 'AISStream accepted the subscription and the heartbeat is verified, but no vessel positions have arrived. Open Waters is also quiet for the selected areas. That is a provider reception gap, not an empty waterway.'
    : connected ? `${names[state.theater]} · No provider positions are available in this snapshot. That is a coverage gap, not evidence that the waterway is empty.`
    : 'Awaiting AIS reception. Previously received positions, if any, retain their original timestamps.';
  if($('#vessel-count-summary')){$('#vessel-count-summary').textContent=!data||(!data.configured&&!all.length)?'—':vessels.length;$('#vessel-count-basis').textContent=!data?'Checking AIS':!data.configured?'Public fallback · incomplete coverage':connected?`${layer.detail} · ${providerLabel} · incomplete coverage`:'Retained · connection '+(source?.connection||'unknown');}
  globe?.setVessels(vessels,state.showVessels);
}
async function loadVessels() {
  if (state.vesselsBusy) return;
  state.vesselsBusy = true;
  try {
    const response = await apiFetch('/api/vessels', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Local request failed');
    state.vessels = await response.json(); delete state.failures.vessels;
  } catch { state.failures.vessels = true; }
  finally { state.vesselsBusy = false; renderVessels(); renderTheaters(); renderStatus(); }
}
function showVesselList() {
  const all=allVisibleVessels(),vessels = all.filter(vesselMatchesLayer),layer=currentVesselLayer(),providers=[...new Set(all.map(v=>v.provider).filter(Boolean))],providerLabel=providers.join(' + ')||'AIS provider',providerHref=providers.includes('Open Waters')?'https://openwaters.io/api/ais/':'https://aisstream.io/';
  openInspector(`RECEIVED ${layer.detail.toUpperCase()}`, `<h2>${esc(names[state.theater])}</h2><p>${vessels.length} ${esc(layer.detail.toLowerCase())} with received positions in the past 30 minutes. This list is a snapshot from ${fmtTime(new Date().toISOString())} UTC. ${all.length-vessels.length?`${all.length-vessels.length} other positions are hidden by the Layer filter. `:''}Reception is incomplete; provider positions are not a traffic count.</p><div class="vessel-list">${vessels.map(v => `<button class="vessel-row" data-vessel-detail="${esc(v.mmsi)}"><span><strong>${esc(v.name || 'Name not reported')}</strong><small>${esc(vesselTypeLabel(v.shipType))} · MMSI ${esc(v.mmsi)} · ${esc(names[v.theater])}</small></span><span>${esc(relative(v.positionTime))}<small>${v.stale ? 'Older position' : 'Under 10 minutes'}</small></span></button>`).join('') || `<p>No typed ${esc(layer.detail.toLowerCase())} positions are available in this theater right now. Switch Layer to All received to inspect ${all.length||'other'} positions.</p>`}</div><p><a href="${providerHref}" target="_blank" rel="noopener noreferrer">Source: ${esc(providerLabel)} ↗</a></p>`);
  $$('[data-vessel-detail]').forEach(b => b.onclick = () => showVessel(b.dataset.vesselDetail));
}
function showVessel(mmsi,{refresh=false}={}) {
  const vessel = visibleVessels().find(v => v.mmsi === mmsi);
  if (!vessel) { openInspector('AIS POSITION EXPIRED','<h2>Position no longer available.</h2><p>The received position has expired or is outside the selected theater. Open View vessels for the currently retained reports.</p>');return; }
  const v = vessel, timestamp = t => esc(fmtDate(t) + ' · ' + new Date(t).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC');
  const value = (n, unit) => Number.isFinite(n) ? n.toFixed(1) + unit : 'Not reported';
  const typeLabel=vesselTypeLabel(v.shipType);
  openInspector('AIS POSITION · ' + (v.stale ? 'OLDER THAN 10 MINUTES' : 'RECEIVED REPORT'), `<h2>${esc(v.name || 'Name not reported')}</h2><div class="detail-meta">MMSI ${esc(v.mmsi)} · ${esc(names[v.theater])}</div><dl class="vessel-facts"><div><dt>Vessel category</dt><dd>${esc(typeLabel)}${Number.isFinite(v.shipTypeCode)?` · AIS ${v.shipTypeCode}`:''}</dd></div><div><dt>Type metadata source</dt><dd>${esc(v.shipTypeProvider||v.provider||'Not reported')}${v.shipTypeObservedAt?' · '+timestamp(v.shipTypeObservedAt):''}</dd></div><div><dt>Reported coordinates</dt><dd>${v.latitude.toFixed(4)}° N, ${v.longitude.toFixed(4)}° E</dd></div><div><dt>Speed over ground</dt><dd>${value(v.speedKnots, ' knots')}</dd></div><div><dt>Course over ground</dt><dd>${value(v.courseDegrees, '°')}</dd></div><div><dt>Heading</dt><dd>${value(v.headingDegrees, '°')}</dd></div><div><dt>Provider timestamp</dt><dd>${v.sourceAt ? timestamp(v.sourceAt) : esc(v.timestampNote||'Not supplied; age uses local receipt time')}</dd></div><div><dt>Received by Passage</dt><dd>${timestamp(v.receivedAt)}</dd></div><div><dt>Position source</dt><dd>${esc(v.providerSource||v.provider||'AIS provider')}</dd></div></dl><p>This is a received position, not a predicted current location. AIS identity and position fields are unverified. Missing coverage and inaccurate reports are possible. A category comes from the provider’s AIS ship-type field when supplied; it does not identify cargo, affiliation, or intent. Not for navigation.</p><div class="detail-actions"><a class="primary-link" href="${v.provider==='Open Waters'?'https://openwaters.io/api/ais/':'https://aisstream.io/'}" target="_blank" rel="noopener noreferrer">Source: ${esc(v.provider||'AIS provider')} ↗</a><button id="back-vessels" class="text-button">All received vessels</button></div>`,{refresh,context:{kind:'vessel',id:mmsi,theaters:[v.theater],description:`${v.name||'Unnamed vessel'} · received position ${relative(v.positionTime)} · ${names[v.theater]}`}});
  inspectorMode='vessel';selectedMmsi=mmsi;$('#back-vessels').onclick = showVesselList;
}

function refreshAges(){
  if(document.hidden)return;
  const active=document.activeElement;const marker=['data-actor','data-story','data-save','data-focus','data-civilian-story'].find(k=>active?.hasAttribute(k));const value=marker?active.getAttribute(marker):null;
  const scroll=$('#feed').scrollTop;
  renderReports();$('#feed').scrollTop=scroll;
  if(marker){const target=$$(`[${marker}]`).find(el=>el.getAttribute(marker)===value);target?.focus({preventScroll:true});}
  renderWeather();
  renderOilContext();renderMarket();
  $$('[data-oil-state]').forEach(el=>{const source=allSourceStates().find(s=>s.id===el.dataset.oilState),p=state.oil?.series.find(s=>s.id===el.dataset.oilState)?.observations?.at(-1);el.textContent=p?`${fmtDate(p.date)} · ${source.label}`:'Source unavailable';});
  renderStatus();
  if(inspectorMode==='vessel'&&selectedMmsi){const selected=selectedMmsi,focused=document.activeElement?.id;showVessel(selected,{refresh:true});if(focused&&document.getElementById(focused))document.getElementById(focused).focus({preventScroll:true});}
}

let reportingPollBusy=false;
setInterval(async()=>{
  if(!state.auto||document.hidden||state.busy||reportingPollBusy||!state.news?.coverage?.discoveryPending)return;
  reportingPollBusy=true;
  try{const response=await apiFetch('/api/news',{signal:AbortSignal.timeout(35000)});if(!response.ok)throw Error();state.latestNews=await response.json();state.news=monitoring.ingestNews(state.latestNews);delete state.failures.news;renderReports();renderStatus();}catch{state.failures.news=true;renderStatus();}finally{reportingPollBusy=false;}
},30000);
