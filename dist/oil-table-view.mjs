import {buildOilChartModel,oilReadout,OIL_GAP_POLICY} from './oil-chart-view.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value):'—';
export function oilObservationTableRows(series=[],options={}){
 const model=buildOilChartModel(series,options);
 return {model,rows:[...model.dates].reverse().map(date=>oilReadout(model,date))};
}
export function oilObservationTableMarkup(series=[],options={}){
 const {model,rows}=oilObservationTableRows(series,options);
 return `<h2>Brent &amp; WTI · USD/barrel</h2><p>${model.period} calendar-day window through the latest available observation, matching the chart. ${rows.length} dates with at least one observed value. Missing values stay unavailable.</p><table class="guide-table"><thead><tr><th scope="col">Date · UTC</th><th scope="col">Brent</th><th scope="col">WTI</th></tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${escape(row.label)}</th>${['brent','wti'].map(id=>`<td>${escape(money(row.values.find(value=>value.id===id)?.value))}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="3">No observations available.</td></tr>'}</tbody></table><p>${escape(OIL_GAP_POLICY)}</p>`;
}
