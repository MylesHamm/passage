const DAY = 86400000;
const dayMs = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? Date.parse(value+'T00:00:00Z') : NaN;
export const evidenceDate = record => record.eventDate || record.publishedDate || null;
export function selectEvidence(records, { theater='both', days=30, now=Date.now(), mechanism='all' }={}) {
  const today=Math.floor(now/DAY)*DAY, cutoff=days==='all' ? -Infinity : today-(Number(days)-1)*DAY;
  return records.filter(record=>{
    const date=dayMs(evidenceDate(record));
    return Number.isFinite(date)&&date<=today&&date>=cutoff&&(theater==='both'||record.theaters?.includes(theater))&&(mechanism==='all'||oilMechanisms(record).some(m=>m.id===mechanism));
  }).sort((a,b)=>evidenceDate(b).localeCompare(evidenceDate(a))||a.id.localeCompare(b.id));
}
export function priceComparison(observations, eventDate, now=Date.now()) {
  const empty={before:null,onDate:null,delta:null,percent:null};
  const date=dayMs(eventDate); if(!Number.isFinite(date)||date>now)return empty;
  const valid=observations.filter(p=>Number.isFinite(p.value)&&dayMs(p.date)<=now).sort((a,b)=>a.date.localeCompare(b.date));
  const before=valid.filter(p=>p.date<eventDate).at(-1)||null, onDate=valid.find(p=>p.date===eventDate)||null;
  return {before,onDate,delta:before&&onDate?onDate.value-before.value:null,percent:before?.value&&onDate?(onDate.value-before.value)/before.value*100:null};
}
export const MECHANISMS = [
  {id:'products',name:'Refining & fuel supply',pattern:/\b(?:refiner\w*|diesel|gasoil|gasoline|jet fuel|refined products?|refining margins?)\b/i,explanation:'Crude availability and usable fuel supply can diverge. Refinery capacity, product exports and transport costs may tighten diesel or other fuels even when crude prices soften. No live product margin is measured here.'},
  {id:'supply',name:'Export availability',pattern:/\b(?:pipelines?|terminals?|refiner\w*|exports?|production|oil facilit\w*|storage|supply|output|shut[- ]?ins?)\b/i,explanation:'Damage or restrictions can reduce loadings. Confirm the affected volume, duration, available stocks, and alternative outlets before estimating an oil effect.'},
  {id:'transport',name:'Transit & freight',pattern:/\b(?:ships?|vessels?|tankers?|shipping|ports?|straits?|red sea|hormuz|rerout\w*|transit)\b/i,explanation:'Avoidance, waiting time and detours can tie up ships and raise delivered costs. A received AIS point does not establish cargo volume or completed transit.'},
  {id:'risk',name:'Security & insurance',pattern:/attack|strike|drone|missile|seiz|explos|damage|hostilit/i,explanation:'Perceived exposure may affect insurance terms and willingness to sail. This watch has no live war-risk premium or freight assessment.'},
  {id:'buffers',name:'Inventories & demand',pattern:/\b(?:inventor\w*|stocks?|demand|consumption|buffers?)\b/i,explanation:'Inventories and changes in demand can absorb or amplify a supply disruption. Monthly agency estimates have their own vintage and are not current tank measurements.'},
  {id:'people',name:'Crew & port safety',pattern:/seafarer|crew|fatal|injur|killed|missing|evacuat|civilian|humanitarian/i,explanation:'Harm to seafarers and port workers is a direct consequence. It can also interrupt operations; casualty reports alone do not quantify lost oil supply.'}
];
export function oilMechanisms(record) {
  const text=[record.title,record.summary,record.locationText].filter(Boolean).join(' ');
  return MECHANISMS.filter(m=>m.pattern.test(text)||(m.id==='transport'&&record.recordType==='incident')).map(({pattern,...m})=>({...m,basis:'Potential channel; effect not measured'}));
}
export function contextAge(reviewDate,now=Date.now()) {
  const time=dayMs(reviewDate);if(!Number.isFinite(time))return {needsReview:true,label:'Review date unknown'};
  const days=Math.max(0,Math.floor((now-time)/DAY));return {needsReview:days>3,label:days>3?`Review needed · checked ${reviewDate}`:`Reviewed ${reviewDate} · curated context`};
}
