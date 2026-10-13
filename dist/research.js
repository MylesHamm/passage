import {apiFetch,runtime,LIVE_REFRESH_MS} from './runtime-config.mjs';
import {buildEvidenceGraph,buildTimeline,normalizeAnnotation,normalizeProfile,reportPublication,vesselMatches} from './research-data.mjs';
import {buildResearchGraphSvg,buildResearchTimelineSvg} from './research-charts.mjs';

const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const names={both:'Both theatres',bab:'Bab el-Mandeb',hormuz:'Strait of Hormuz'};
const actors=['All','Houthis','Iran','IRGC','U.S. military','Saudi Arabia','UAE','Oman','Israel','Maritime coalitions','Merchant shipping','Civilians','Other forces'];
const fmtDate=value=>value?new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):'Not available';
const fmtTime=value=>value?new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}):'—';
const relative=value=>{if(!value)return'Unknown';const mins=Math.max(0,(Date.now()-Date.parse(value))/60000);return mins<1?'Just now':mins<60?`${Math.floor(mins)}m ago`:mins<1440?`${Math.floor(mins/60)}h ago`:`${Math.floor(mins/1440)}d ago`;};
const money=value=>Number.isFinite(value)?'$'+value.toFixed(2):'—';
const local={get(key,fallback){try{return JSON.parse(localStorage.getItem('passage-'+key))??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem('passage-'+key,JSON.stringify(value));return true;}catch{return false;}}};
const state={news:null,acled:null,oil:null,vessels:null,theater:'both',actor:'All',days:30,query:'',basis:'publication',onlyDisruptions:true,graphEntity:null,graphOffset:0,annotations:local.get('timeline-annotations',{}),profiles:local.get('vessel-profiles',{}),errors:{}};

function setStatus(message){$('#research-status').textContent=message;}
function updateClock(){$('#utc-clock').textContent=new Date().toLocaleTimeString('en-GB',{hour12:false,timeZone:'UTC'})+' UTC';}
function filteredEvents(){
  const today=Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z'),cutoff=today-state.days*86400000;
  return (state.acled?.events||[]).filter(event=>(state.theater==='both'||event.theaters?.includes(state.theater))&&(state.actor==='All'||event.actors?.includes(state.actor))&&Date.parse(event.eventDate+'T00:00:00Z')>=cutoff).sort((a,b)=>b.eventDate.localeCompare(a.eventDate));
}
function renderEvents(){
  const events=filteredEvents(),source=state.acled?.source;
  $('#event-count').textContent=state.acled?`${events.length} shown`:'—';
  $('#event-summary').innerHTML=runtime.configurationError?esc(runtime.configurationNotice):state.errors.acled?'<strong>ACLED update failed.</strong> The previous event layer, if present, is retained. Check Sources for the connection state.':!state.acled?'<strong>Waiting for ACLED.</strong>':state.acled.configured===false?(runtime.privateConnectionsAllowed?'<strong>ACLED is not connected.</strong> <a href="./connections/acled.html">Manage the local connection →</a>':'<strong>Private ACLED access is local only.</strong> Personal account records are not published here.'):`<strong>${esc(source?.label||'ACLED')}</strong> · ${esc(names[state.theater])} · event dates in the last ${state.days} days. ${state.acled.truncated?'The result is capped; narrow the date window.':''} Country scope supplies context; records are not maritime geocoding.`;
  $('#event-list').innerHTML=events.length?events.map(event=>`<details class="event-card"><summary><h3>${esc(event.title)}</h3><div class="event-meta">${esc(fmtDate(event.eventDate+'T00:00:00Z'))} · ${esc(event.country)} · ${esc(event.actors?.join(' · ')||'No classified actor')} · ${Number.isFinite(event.latitude)?'map-ready coordinates':'country scope'}</div></summary><dl class="event-facts"><div><dt>Event type</dt><dd>${esc(event.eventType||'Not reported')}${event.subEventType?' · '+esc(event.subEventType):''}</dd></div><div><dt>Civilian targeting</dt><dd>${esc(event.civilianTargeting||'Not reported')}</dd></div><div><dt>Location</dt><dd>${esc([event.location,event.admin1,event.admin2].filter(Boolean).join(' · ')||'Not reported')}</dd></div><div><dt>Coordinates</dt><dd>${Number.isFinite(event.latitude)?esc(`${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)}`):'Not returned'} · precision ${esc(event.geoPrecision??'not reported')}</dd></div><div><dt>Source update</dt><dd>${event.updatedAt?esc(fmtDate(event.updatedAt)+' · '+fmtTime(event.updatedAt)+' UTC'):'Not reported'}</dd></div><div><dt>Fatalities field</dt><dd>${event.fatalities==null?'Not reported':esc(event.fatalities)}</dd></div></dl><p class="event-note">${event.notes?esc(event.notes):'No event note returned.'}</p><p class="event-note"><a href="${esc(event.url)}" target="_blank" rel="noopener noreferrer">Open ACLED record ↗</a> · <a href="${esc(event.sourceUrl)}" target="_blank" rel="noopener noreferrer">Field documentation ↗</a></p></details>`).join(''):'<p class="empty">No structured records match this theatre, actor, or date window. This does not establish that no conflict event occurred.</p>';
}
let displayedGraph=null,displayedTimeline=null,graphWidth=0,timelineSize='';
function setChart(svg,chart){
  svg.setAttribute('viewBox',`0 0 ${chart.width} ${chart.height}`);
  svg.style.width=chart.width+'px';svg.style.height=chart.height+'px';
  svg.innerHTML=chart.markup;
}
function renderGraphSvg(){
  const viewport=$('#graph-viewport'),width=viewport.clientWidth;
  if(!displayedGraph||!width){graphWidth=0;return;}
  graphWidth=width;
  const chart=buildResearchGraphSvg(displayedGraph,width),scrollable=chart.width>width;
  setChart($('#graph-svg'),chart);
  viewport.tabIndex=scrollable?0:-1;
  $('#graph-scroll-hint').hidden=!scrollable;
  if(scrollable)viewport.setAttribute('aria-describedby','graph-scroll-hint');else viewport.removeAttribute('aria-describedby');
}
function renderTimelineSvg(){
  const viewport=$('#timeline-viewport'),width=viewport.clientWidth,height=viewport.clientHeight;
  if(!displayedTimeline||!width||!height){timelineSize='';return;}
  timelineSize=width+'x'+height;
  setChart($('#timeline-svg'),buildResearchTimelineSvg(displayedTimeline,width,height));
}
function resizeCharts(){
  const graphViewport=$('#graph-viewport'),timelineViewport=$('#timeline-viewport');
  if(graphViewport.clientWidth!==graphWidth)renderGraphSvg();
  if(timelineViewport.clientWidth+'x'+timelineViewport.clientHeight!==timelineSize)renderTimelineSvg();
}
function renderGraph(){
  const cutoff=Date.now()-state.days*86400000;
  const records=(state.news?.items||[]).filter(report=>{
    const publication=reportPublication(report);
    return publication&&publication.at>=cutoff&&report.theaters?.length>0&&(state.theater==='both'||report.theaters?.includes(state.theater))&&(state.actor==='All'||report.actors?.includes(state.actor))&&(!state.query||`${report.title} ${report.source}`.toLowerCase().includes(state.query.toLowerCase()));
  });
  const graph=buildEvidenceGraph(records,{limit:12,offset:state.graphOffset,entityId:state.graphEntity});
  $('#graph-entities').innerHTML=[{id:null,label:'All entities'},...graph.allEntities.filter(entity=>entity.type!=='theater').slice(0,14)].map(entity=>`<button class="${state.graphEntity===entity.id?'active':''}" data-graph-entity="${esc(entity.id||'')}">${esc(entity.label)}</button>`).join('');
  $$('[data-graph-entity]').forEach(button=>button.onclick=()=>{state.graphEntity=button.dataset.graphEntity||null;state.graphOffset=0;renderGraph();});
  displayedGraph=graph;renderGraphSvg();
  $('#graph-list').innerHTML=graph.reports.length?graph.reports.map(report=>{const edges=graph.edges.filter(edge=>edge.reportId===report.id),publication=reportPublication(report);return `<article class="evidence-card"><h3><a href="${esc(report.url)}" target="_blank" rel="noopener noreferrer">${esc(report.title)} ↗</a></h3><div class="evidence-meta">${esc(report.source||'Source')} · published ${esc(fmtDate(publication.value))}${publication.precision==='timestamp'?' at '+esc(fmtTime(publication.value))+' UTC':' · time not supplied'} · ${edges.length} linked ${edges.length===1?'entity':'entities'}</div><div>${edges.slice(0,5).map(edge=>`<span class="evidence-basis">${esc(edge.relation==='TAGGED_TO_THEATER'?'theatre tag':edge.basis)}${edge.matchedText?' · '+esc(edge.matchedText):''}</span>`).join(' ')}</div><div class="evidence-meta">Source URL: <a href="${esc(report.url)}" target="_blank" rel="noopener noreferrer">${esc(new URL(report.url).hostname)} ↗</a></div></article>`;}).join(''):'<p class="empty">No source-linked headlines match this entity and date scope.</p>';
  const page=graph.totalReports?Math.floor(graph.offset/12)+1:1;$('#graph-page').textContent=`Page ${page} · ${graph.totalReports} reports`;$('#graph-prev').disabled=graph.offset===0;$('#graph-next').disabled=graph.offset+12>=graph.totalReports;$('#graph-prev').onclick=()=>{state.graphOffset=Math.max(0,graph.offset-12);renderGraph();};$('#graph-next').onclick=()=>{state.graphOffset=graph.offset+12;renderGraph();};
}
function timelineRows(){return buildTimeline(state.news?.items||[],state.oil?.series||[],{days:state.days,theater:state.theater,actor:state.actor,query:state.query,onlyDisruptions:state.onlyDisruptions,basis:state.basis,annotations:state.annotations,now:Date.now()});}
function annotate(report){
  const eventDate=window.prompt('Event date (YYYY-MM-DD). Leave blank to use publication date.',state.annotations[report.id]?.eventDate||'');if(eventDate===null)return;
  const note=window.prompt('Optional analyst note.',state.annotations[report.id]?.note||'');if(note===null)return;
  try{
    const annotations={...state.annotations,[report.id]:normalizeAnnotation({eventDate:eventDate.trim(),note},report,Date.now())};
    if(!local.set('timeline-annotations',annotations))throw Error('Could not save the annotation on this device. Browser storage may be full or unavailable. Existing annotations are unchanged.');
    state.annotations=annotations;renderTimeline();
  }catch(error){window.alert(error.message);}
}
function renderTimeline(){
  const timeline=timelineRows(),rows=timeline.rows;
  displayedTimeline=timeline;renderTimelineSvg();
  const content=rows.filter(row=>row.reports.length||Number.isFinite(row.prices.brent)||Number.isFinite(row.prices.wti));
  $('#timeline-table').innerHTML=content.length?content.reverse().map(row=>`<div class="timeline-row"><time datetime="${esc(row.date)}">${esc(fmtDate(row.date+'T00:00:00Z'))}</time><div class="timeline-reports">${row.reports.map(item=>`<div><a href="${esc(item.report.url)}" target="_blank" rel="noopener noreferrer">${esc(item.report.title)} ↗</a><button class="annotation-button" data-annotate="${esc(item.report.id)}">${state.annotations[item.report.id]?'Edit date':'Add event date'}</button><small class="evidence-meta">${esc(item.basis)}${item.terms.length?' · '+esc(item.terms.join(', ')):''}</small></div>`).join('')||'<span class="muted">No disruption headline</span>'}</div><div class="timeline-prices">${Number.isFinite(row.prices.brent)?'Brent '+money(row.prices.brent):''}${Number.isFinite(row.prices.brent)&&Number.isFinite(row.prices.wti)?' · ':''}${Number.isFinite(row.prices.wti)?'WTI '+money(row.prices.wti):''}</div></div>`).join(''):`<p class="empty">No disruption terms or daily price observations are available for this window. Missing observations remain gaps.</p>`;
  $$('[data-annotate]').forEach(button=>button.onclick=()=>{const report=(state.news?.items||[]).find(item=>item.id===button.dataset.annotate);if(report)annotate(report);});
}
function renderProfiles(){
  const profiles=Object.values(state.profiles);$('#profile-list').innerHTML=profiles.length?profiles.map(profile=>{const matches=vesselMatches(profile,state.news?.items||[]),snapshot=profile.snapshot;return `<article class="profile-card"><h3>${esc(profile.name||'Unnamed vessel')} <span class="muted">· MMSI ${esc(profile.mmsi)}</span></h3><p>${esc(names[profile.theater]||'Both theatres')}${profile.imo?' · IMO '+esc(profile.imo):''}<br>${snapshot?`Snapshot ${esc(fmtDate(snapshot.positionTime))} · ${esc(snapshot.latitude.toFixed(3))}, ${esc(snapshot.longitude.toFixed(3))}`:'No retained AIS snapshot'}<br>${matches.length} source headline ${matches.length===1?'match':'matches'} · review needed</p><p>${esc(profile.notes||'No analyst note')}</p><div class="profile-actions"><button class="text-button" data-delete-profile="${esc(profile.mmsi)}">Delete card</button>${matches.slice(0,2).map(match=>`<a class="profile-link" href="${esc(match.report.url)}" target="_blank" rel="noopener noreferrer">${esc(match.basis)} ↗</a>`).join('')}</div></article>`;}).join(''):'<p class="empty">No vessel research cards saved on this device.</p>';
  $$('[data-delete-profile]').forEach(button=>button.onclick=()=>{
    const profiles={...state.profiles};delete profiles[button.dataset.deleteProfile];
    if(!local.set('vessel-profiles',profiles)){$('#profile-feedback').textContent='Could not delete this card on this device. Browser storage may be unavailable. The saved card is unchanged.';return;}
    state.profiles=profiles;$('#profile-feedback').textContent='Deleted from this device';renderProfiles();
  });
}
function renderAll(){renderEvents();renderGraph();renderTimeline();renderProfiles();}
async function fetchJSON(key,url){try{const response=await apiFetch(url,{signal:AbortSignal.timeout(35000)});if(!response.ok)throw Error('request failed');const data=await response.json();state[key]=data;delete state.errors[key];return data;}catch{state.errors[key]=true;return null;}}
let loading=false;
async function load(){
  if(loading)return;loading=true;$('#refresh-research').disabled=true;
  setStatus('Checking reporting, ACLED, EIA, and AIS layers…');
  await Promise.all([fetchJSON('news','/api/news'),fetchJSON('acled','/api/acled/events?days=365'),fetchJSON('oil','/api/oil'),fetchJSON('vessels','/api/vessels')]);
  const failed=Object.keys(state.errors);setStatus(runtime.configurationError?'Live data is not configured for this public site.':failed.length?`Updated with source gaps · ${failed.join(', ')}`:`Updated ${fmtTime(new Date().toISOString())} UTC · source clocks retained`);loading=false;$('#refresh-research').disabled=false;renderAll();
}

$$('[data-theatre]').forEach(button=>button.onclick=()=>{state.theater=button.dataset.theatre;$$('[data-theatre]').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-pressed',String(item===button));});state.graphOffset=0;renderAll();});
$('#research-actor').onchange=event=>{state.actor=event.target.value;state.graphOffset=0;renderAll();};
$('#research-days').onchange=event=>{state.days=Number(event.target.value);renderAll();};
$('#research-query').oninput=event=>{state.query=event.target.value;state.graphOffset=0;renderGraph();renderTimeline();};
$('#timeline-basis').onchange=event=>{state.basis=event.target.value;renderTimeline();};
$('#only-disruptions').onchange=event=>{state.onlyDisruptions=event.target.checked;renderTimeline();};
$('#refresh-research').onclick=()=>{load();};
$('#profile-form').onsubmit=event=>{
  event.preventDefault();const mmsi=$('#profile-mmsi').value.trim();
  try{
    const current=state.vessels?.vessels?.find(v=>v.mmsi===mmsi),matches=vesselMatches({mmsi,name:$('#profile-name').value},state.news?.items||[]);
    const profile=normalizeProfile({mmsi,name:$('#profile-name').value,imo:$('#profile-imo').value,theater:$('#profile-theatre').value,notes:$('#profile-notes').value,links:matches.slice(0,10).map(match=>({url:match.report.url,title:match.report.title,reportId:match.report.id})),snapshot:current},new Date().toISOString());
    const profiles={...state.profiles,[mmsi]:profile};
    if(!local.set('vessel-profiles',profiles))throw Error('Could not save on this device. Browser storage may be full or unavailable. Your entries are still in the form.');
    state.profiles=profiles;$('#profile-form').reset();$('#profile-feedback').textContent='Saved on this device';renderProfiles();
  }catch(error){$('#profile-feedback').textContent=error.message;}
};

updateClock();setInterval(updateClock,1000);renderAll();load();
if(typeof ResizeObserver==='function'){
  const chartObserver=new ResizeObserver(resizeCharts);
  chartObserver.observe($('#graph-viewport'));chartObserver.observe($('#timeline-viewport'));
}else window.addEventListener('resize',resizeCharts);

setInterval(()=>{if(!document.hidden)load();},LIVE_REFRESH_MS);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
