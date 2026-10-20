import {EXPOSURE_BASELINE,CONTEXT_SOURCES} from './energy-context.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceLink=(source,label)=>`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(label)} <span aria-hidden="true">↗</span></a>`;
const isFlow=item=>/^\d+(?:\.\d+)?M b\/d$/.test(item.value);

function flowMarkup(item){
  const number=item.value.replace('M b/d',''),[measure,period,...definition]=item.detail.split(' · ');
  return `<article class="exposure-flow"><h4>${esc(item.label.replace(' · historical flow',''))}</h4><p class="exposure-quantity"><strong>${esc(number)}</strong> <span>million barrels per day</span></p><p class="exposure-period"><span>Baseline period</span> <strong>${esc(period)}</strong></p><p class="exposure-description">${esc(measure)} · ${esc(definition.join(' · '))}.</p><p class="exposure-source">${sourceLink(CONTEXT_SOURCES.eia,'EIA · source tables')}</p></article>`;
}

function routeMarkup(item){
  // The public build removes private dated assessments from the source data.
  // Never recreate a date or an operating claim independently of that data.
  const [route,...details]=item.detail.split(' · '),context=details.join(' · ');
  const datedStatement=context.includes('shutdown reported');
  const unavailable=/current (?:operating status|throughput) not connected/i.test(context);
  const outlet=item.value==='Status matters'?'':`${item.value} · `;
  const status=unavailable?'<p class="exposure-route-status" data-state="unavailable">Current status unavailable</p>':datedStatement?`<p class="exposure-route-status" data-state="historical">Dated statement · ${esc(context)}.</p>`:'';
  return `<article class="exposure-route"><h4>${esc(item.label)}</h4><p class="exposure-route-value">${esc(outlet+route)}</p>${status}${!datedStatement&&context?`<p class="exposure-description">${esc(context)}.</p>`:''}<p class="exposure-source">${sourceLink(CONTEXT_SOURCES.eia,'EIA · route background')}${datedStatement?sourceLink(CONTEXT_SOURCES.saudi,'Saudi Ministry · dated statement'):''}</p></article>`;
}

export function renderExposureBaselineMarkup({theater='both'}={}){
  const items=EXPOSURE_BASELINE.filter(item=>theater==='both'||item.scope.includes(theater));
  const flows=items.filter(isFlow),routes=items.filter(item=>!isFlow(item));
  if(!items.length)return '<div class="exposure-baseline"><p class="exposure-description">No historical exposure baseline is listed for this scope.</p></div>';
  return `<div class="exposure-baseline"><section class="exposure-flows" aria-labelledby="exposure-flows-heading"><div class="exposure-intro"><h3 id="exposure-flows-heading">Historical oil flows</h3><p>EIA baseline · historical flows, not current throughput.</p></div><div class="exposure-flow-grid">${flows.map(flowMarkup).join('')}</div></section><section class="exposure-routes" aria-labelledby="exposure-routes-heading"><div class="exposure-intro"><h3 id="exposure-routes-heading">Bypass route context</h3><p>A route around a chokepoint does not establish its current operating status or available capacity.</p></div><div class="exposure-route-grid">${routes.map(routeMarkup).join('')}</div></section></div>`;
}
