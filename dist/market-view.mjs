import {SOURCE_DEFINITIONS,sourceHealth} from './source-health.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>new Date(value+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});

export function renderMarketContext(data,{failed=false,now=Date.now()}={}) {
  if(!data)return failed?'<p class="empty">Weekly market context is unavailable. Other source observations remain visible.</p>':'<p class="muted">Checking weekly EIA observations…</p>';
  if(!data.series?.length)return `<p class="empty">${failed?'Weekly update failed. No retained weekly observations are available.':'No weekly observations were retrieved.'}</p>`;
  return `<p class="context-note">U.S. market backdrop · weekly surveys. These observations help describe market buffers; they do not measure Middle East flows.</p>${(data.series||[]).map(series=>{
    const last=series.observations?.at(-1),previous=series.observations?.at(-2);
    const health=sourceHealth({...SOURCE_DEFINITIONS.find(source=>source.id===series.id),...series,group:'market',recordCount:series.observations?.length||0,latest:last?.date,localFailure:failed||series.localFailure},now);
    if(!last)return `<article class="market-observation"><h3>${esc(series.name)}</h3><p>${series.configured===false?'Connect a free EIA key to retrieve this survey.':esc(health.label)}</p><a href="${esc(series.url)}" target="_blank" rel="noopener noreferrer">Official EIA series ↗</a></article>`;
    const scale=series.scale??1,value=last.value*scale,change=previous?(last.value-previous.value)*scale:null;
    const consecutive=previous&&Date.parse(last.date)-Date.parse(previous.date)===7*86400000;
    const delta=change===null?'No prior observation':`${change>0?'+':''}${change.toFixed(1)} ${series.units==='%'?'percentage points':'million barrels'} ${consecutive?'week over week':`since ${date(previous.date)}`}`;
    const issue=failed||['cached','unavailable','disconnected'].includes(series.connection)||series.localFailure?'<p class="source-notice">Update failed · last retrieved observations retained.</p>':health.freshness==='stale'?'<p class="source-notice">Older weekly observations · check the date below.</p>':['unavailable','unknown'].includes(health.status)?`<p class="source-notice">${esc(health.label)} · observations retain their original dates.</p>`:'';
    return `<article class="market-observation"><h3>${esc(series.name)}</h3><p><strong>${value.toFixed(1)}${series.units==='%'?'%':''}</strong>${series.units==='%'?'':` <span>${esc(series.displayUnit)}</span>`}</p><p>${esc(delta)}</p><small>Week ending ${esc(date(last.date))}</small>${issue}<p class="context-note">${esc(series.detail)}</p><a href="${esc(series.url)}" target="_blank" rel="noopener noreferrer">EIA · source & history ↗</a></article>`;
  }).join('')}`;
}
