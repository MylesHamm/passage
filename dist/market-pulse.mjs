import {sourceHealth,SOURCE_DEFINITIONS} from './source-health.mjs';
import {normalizeOilObservations,segmentOilObservations,OIL_GAP_POLICY} from './oil-chart-view.mjs';

const DAY=86400000;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const date=value=>{const [year,month,day]=value.split('-');return `${Number(day)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(month)-1]} ${year}`;};
function observationState(series,observations,{failed,now,loading}){
  const retained=failed||Boolean(series?.error||series?.localFailure)||['cached','unavailable','disconnected'].includes(series?.connection)||['retained','unavailable'].includes(series?.status);
  if(!observations.length)return retained?{id:'unavailable',label:'Daily prices unavailable'}:loading||series?.connection==='loading'?{id:'loading',label:'Checking daily prices'}:{id:'empty',label:'No daily observations'};
  if(retained)return {id:'retained',label:'Update failed · retained observation'};
  const health=sourceHealth({...SOURCE_DEFINITIONS.find(row=>row.id===series.id),...series,configured:true,latest:observations.at(-1).date,recordCount:observations.length},now);
  if(health.freshness==='stale'||series?.freshness==='stale'||series?.status==='stale')return {id:'stale',label:'Older observation · check source dates'};
  if(!health.retrievedAt||health.retrievalAgeSeconds===null)return {id:'unknown',label:'Retrieval time unknown'};
  return {id:'available',label:'Daily observation · publication lag'};
}
function sparkline(rows,observations,name){
  if(!observations.length)return '<span class="pulse-chart-empty">No price history</span>';
  const end=observations.at(-1).ms,start=end-29*DAY,segments=segmentOilObservations(rows,{begin:start,end}),points=segments.flat();
  const low=Math.min(...points.map(point=>point.value)),high=Math.max(...points.map(point=>point.value)),span=high-low;
  const x=point=>4+(point.ms-start)/(29*DAY)*136,y=point=>span?36-(point.value-low)/span*28:22;
  // Calendar spacing remains real; a missing day is never zero or an invented price.
  const path=segments.map(segment=>segment.map((point,index)=>`${index?'L':'M'}${x(point).toFixed(2)},${y(point).toFixed(2)}`).join(' ')).join(' ');
  const label=`${name} daily spot: 30 calendar days through ${date(observations.at(-1).date)}. Range ${money(low)} to ${money(high)} per barrel. ${points.length} reported observations. ${OIL_GAP_POLICY} Each series uses its own scale.`;
  return `<svg class="pulse-sparkline" viewBox="0 0 144 44" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><path d="${path}" class="pulse-line"/>${points.map(point=>`<circle class="pulse-point" cx="${x(point).toFixed(2)}" cy="${y(point).toFixed(2)}" r="1.6"/>`).join('')}</svg><span class="pulse-chart-caption">30 days · own scale</span>`;
}

/** Daily EIA observations only. This summary has no provider calls or motion. */
export function renderMarketPulse(oil,{failed=false,now=Date.now()}={}){
  const series=Array.isArray(oil?.series)?oil.series:[];
  return `<section class="market-pulse" aria-label="Daily oil market pulse"><header class="pulse-heading"><div><h2>Oil market pulse</h2><p>Daily spot · USD/barrel · publication lag</p></div><button type="button" class="pulse-open" data-workspace-view="energy" aria-label="Open full energy comparison">Compare <span aria-hidden="true">↗</span></button></header><div class="pulse-rows">${[['brent','Brent'],['wti','WTI']].map(([id,name])=>{
    const source=series.find(row=>row?.id===id),rows=normalizeOilObservations(source?.observations,{now}),observations=rows.filter(point=>point.value!==null),latest=observations.at(-1),previous=observations.at(-2);
    const status=observationState(source,observations,{failed,now,loading:!oil}),delta=latest&&previous?latest.value-previous.value:null;
    const difference=delta===null?'No prior observation':`${delta>0?'+':''}${money(delta)} vs ${date(previous.date)}`;
    return `<article class="pulse-row pulse-${id}" data-market-series="${id}" data-state="${status.id}"><div class="pulse-series"><h3>${name}</h3>${latest?`<time datetime="${esc(latest.date)}">${esc(date(latest.date))}</time>`:'<span>Observation pending</span>'}</div><div class="pulse-value"><strong>${latest?esc(money(latest.value)):'—'}</strong><span>${esc(difference)}</span></div><div class="pulse-history">${sparkline(rows,observations,name)}</div><p class="pulse-state">${esc(status.label)}</p></article>`;
  }).join('')}</div><p class="pulse-footnote">Price changes compare available daily observations. They do not measure an event’s effect.</p></section>`;
}
