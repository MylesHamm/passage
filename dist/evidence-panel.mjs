import {canonicalReportUrl} from './intelligence-data.mjs';
import {evidenceKind,evidenceKindLabel} from './evidence-kind.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const validDate=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)||!Number.isFinite(Date.parse(value)))return false;
  const day=value.slice(0,10);
  return new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
};
const firstDate=(...values)=>values.find(validDate);
const isAcled=record=>record.sourceId==='acled'||record.recordType==='acled-event';
const retainedRecord=record=>Boolean(record.retainedFromHistory||record.collectionRetired||record.retainedForReading);
const clock=(value,precision)=>{
  const date=new Date(value).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  return date+(precision==='day'||value.length===10?' · date only':' · '+new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC');
};
export function safeEvidenceUrl(value){return canonicalReportUrl(value);}

// Only supplied, valid clocks become rows. A source check never supplies a
// missing record retrieval, event, publication or provider-update timestamp.
export function evidenceClockRows(record={},source={}){
  const publication=record.publishedAtBasis==='event_date'
    ?firstDate(record.publishedDate,record.publicationDate)
    :firstDate(record.publishedAt,record.publishedDate,record.publicationDate);
  return [
    {label:'Event',value:record.eventDate,precision:record.eventDatePrecision||record.eventPrecision||'day',note:isAcled(record)&&record.timePrecision!=null?`Provider time-precision code: ${record.timePrecision}; this is not an exact event time.`:'Reported event date; publication is not substituted.'},
    {label:'Publication',value:publication,precision:record.publicationPrecision,note:'Publisher-supplied date; not an event timestamp.'},
    {label:'Discovery',value:record.discoveredAt,precision:record.discoveryPrecision,note:'Index discovery is not a publication or event date.'},
    {label:'Source page update',value:record.sourceUpdatedDate,precision:'day',note:'Date stated on the source page; not the date of every listed event.'},
    {label:'Source record update',value:record.updatedAt,precision:'timestamp',note:'Provider record-update time; not the event time.'},
    {label:'Record retrieval',value:firstDate(record.retrievedAt,record.lastSeenAt),precision:'timestamp',note:'Last recorded retrieval of this record; later source checks do not update this clock.'},
    {label:'Source retrieval',value:firstDate(source.lastSuccessAt,source.retrievedAt),precision:'timestamp',note:'Latest successful source check, not the most recent attempt or a record-level retrieval.'},
    {label:'Curated review',value:firstDate(record.reviewedAt,record.readAt),precision:'day',note:'Dated human source review; automatic checks do not update it.'},
  ].filter(row=>validDate(row.value));
}

function locationFacts(record){
  if(isAcled(record)){
    const location=[record.location,record.admin1,record.admin2,record.country].filter(Boolean).join(' · ');
    const coordinates=Number.isFinite(record.latitude)&&Math.abs(record.latitude)<=90&&Number.isFinite(record.longitude)&&Math.abs(record.longitude)<=180;
    return [
      {label:'Reported location',value:location||'No location supplied.'},
      ...(coordinates?[{label:'Provider coordinates',value:`${record.latitude}, ${record.longitude}`}]:[]),
      {label:'Location precision',value:(record.geoPrecision!=null?`Provider geo-precision code: ${record.geoPrecision}. `:'Provider geographic precision not supplied. ')+'Country/theatre scope is not a maritime incident position.'},
    ];
  }
  const precision=record.locationPrecision==='reported-area'?'Reported area; precise coordinates are not supplied by this record.':record.locationPrecision==='region-only'?'Regional scope; not an incident position.':record.locationPrecision?`Source precision: ${record.locationPrecision}. Passage does not infer coordinates.`:'Precise event location is not established by this record.';
  return [
    {label:'Reported location',value:record.locationText||'No event location supplied. Theatre and actor tags describe text relevance.'},
    {label:'Location precision',value:precision},
  ];
}
function verificationNote(record){
  if(isAcled(record))return 'Provider-coded structured event. Passage has not independently verified its location, responsibility or reported impacts.';
  const kind=evidenceKind(record);
  if(kind==='official-incident')return (record.evidenceStatus==='confirmed-by-source'?'Listed as confirmed by the original source. ':'Official incident record. ')+'Passage has not independently verified the incident, location or responsibility.';
  if(kind==='official-statement')return 'An official statement is an attributed account, not independent confirmation of every claim.';
  if(kind==='official-advisory')return 'Official advisory metadata. Archived validity dates do not establish current conditions or safe passage.';
  if(['agency-assessment','independent-analysis','forecast'].includes(kind))return 'Source assessment or analysis. Its conclusions have not been independently verified by Passage.';
  return 'Publisher account. Claims have not been independently verified by Passage; matching headlines do not establish independent confirmation.';
}
export function evidencePanelMarkup(record={}, {source={}}={}){
  const url=safeEvidenceUrl(record.url),clocks=evidenceClockRows(record,source),location=locationFacts(record);
  const retired=Boolean(record.collectionRetired||source.retired),retained=retainedRecord(record);
  const updateUnavailable=Boolean(source.localFailure)||['cached','unavailable','disconnected'].includes(source.connection)||['retained','unavailable'].includes(source.status);
  const status=retired?'Collection retired. This is dated historical evidence; current coverage is unavailable.':record.retainedFromHistory?'Retained from earlier retrieval; absent from the current source snapshot.':record.retainedForReading?'Held for reading until refreshed results are accepted.':updateUnavailable?'Source update unavailable; this record remains previously retrieved evidence.':'';
  return `<section aria-label="Source and evidence"><h3>Source &amp; evidence</h3><p class="detail-meta">${escape(record.source||source.name||'Source not supplied')} · ${escape(isAcled(record)?'Structured event record':evidenceKindLabel(record))}</p><div class="detail-actions">${url?`<a class="primary-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Open original source ↗</a>`:'<span class="evidence-watch">Original URL unavailable</span>'}</div>${status?`<p class="evidence-watch">${escape(status)}</p>`:''}${source.label||source.status?`<p class="detail-meta">Source state: ${escape(source.label||source.status)}. Source availability is not verification.</p>`:''}${clocks.length?`<dl class="vessel-facts">${clocks.map(row=>`<div><dt>${escape(row.label)}</dt><dd>${escape(clock(row.value,row.precision))}<br><small>${escape(row.note)}</small></dd></div>`).join('')}</dl>`:'<p class="detail-meta">No event, publication, discovery or retrieval clock was supplied.</p>'}${!validDate(record.eventDate)?'<p class="detail-meta">Event date not established. Publication and discovery are not substituted.</p>':''}${(retained||retired)&&!clocks.some(row=>row.label==='Record retrieval')?'<p class="detail-meta">Record retrieval time is not supplied; a later source check does not establish it.</p>':''}<dl class="vessel-facts">${location.map(row=>`<div><dt>${escape(row.label)}</dt><dd>${escape(row.value)}</dd></div>`).join('')}</dl><h3>Verification limits</h3><p>${escape(verificationNote(record))}</p><p class="muted">Possible oil-market connections are interpretation, not evidence of a measured effect or current operating status.</p></section>`;
}
