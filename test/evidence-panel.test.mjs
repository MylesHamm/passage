import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceClockRows,evidencePanelMarkup,safeEvidenceUrl} from '../dist/evidence-panel.mjs';

const source={name:'IMO',retrievedAt:'2026-10-19T16:40:00Z',checkedAt:'2026-10-20T08:00:00Z',label:'Official source available'};
const incident={id:'st3',source:'IMO',sourceId:'imo-hormuz',url:'https://www.imo.org/en/mediacentre/hottopics/pages/middle-east-highlighted-incidents.aspx',recordType:'incident',evidenceStatus:'confirmed-by-source',eventDate:'2026-10-16',eventDatePrecision:'day',publishedDate:null,sourceUpdatedDate:'2026-10-19',locationText:'68 NM from Al Jubail',locationPrecision:'reported-area'};

test('official evidence separates event, page-update and source-success dates without inventing record retrieval',()=>{
  const rows=evidenceClockRows(incident,source),original=structuredClone(incident);
  assert.deepEqual(rows.map(row=>[row.label,row.value]),[
    ['Event','2026-10-16'],['Source page update','2026-10-19'],['Source retrieval',source.retrievedAt],
  ]);
  const html=evidencePanelMarkup(incident,{source});
  assert.match(html,/16 Oct 2026 · date only/);assert.match(html,/19 Oct 2026 · date only/);
  assert.match(html,/68 NM from Al Jubail/);assert.match(html,/Reported area; precise coordinates are not supplied/);
  assert.match(html,/Listed as confirmed by the original source/);
  assert.match(html,/has not independently verified/);
  assert.doesNotMatch(html,/<dt>Publication|<dt>Record retrieval|20 Oct 2026/);
  assert.deepEqual(incident,original);
});

test('missing and invalid dates stay absent and source attempts never become successful retrievals',()=>{
  const record={url:'https://publisher.example/story',publishedAt:'2026-02-30T10:00:00Z',discoveredAt:'not-a-date',theaters:['hormuz']};
  assert.deepEqual(evidenceClockRows(record,{checkedAt:source.checkedAt}),[]);
  const html=evidencePanelMarkup(record,{source:{checkedAt:source.checkedAt}});
  assert.match(html,/No event, publication, discovery or retrieval clock was supplied/);
  assert.match(html,/Event date not established/);assert.match(html,/No event location supplied/);
  assert.doesNotMatch(html,/Invalid Date|20 Oct 2026|<dt>Event|<dt>Publication/);
});

test('retained records preserve their own retrieval and disclose later source success separately',()=>{
  const record={source:'Publisher',retainedFromHistory:true,lastSeenAt:'2026-10-17T08:00:00Z',publishedDate:'2026-10-16',publicationPrecision:'day'};
  const rows=evidenceClockRows(record,source);
  assert.equal(rows.find(row=>row.label==='Record retrieval').value,record.lastSeenAt);
  assert.equal(rows.find(row=>row.label==='Source retrieval').value,source.retrievedAt);
  const html=evidencePanelMarkup(record,{source});
  assert.match(html,/Retained from earlier retrieval/);assert.match(html,/later source checks do not update this clock/);
  const missing={...record,lastSeenAt:null};
  assert.equal(evidenceClockRows(missing,source).some(row=>row.label==='Record retrieval'),false);
  assert.match(evidencePanelMarkup(missing,{source}),/Record retrieval time is not supplied/);
  assert.match(evidencePanelMarkup({retainedForReading:true}),/Held for reading/);
  for(const failure of [{connection:'cached'},{status:'unavailable'},{localFailure:true}])assert.match(evidencePanelMarkup(incident,{source:failure}),/Source update unavailable/);
});

test('ACLED event-date aliases are not publication clocks and provider precision remains explicit',()=>{
  const event={sourceId:'acled',recordType:'acled-event',eventDate:'2026-10-16',publishedAt:'2026-10-16T00:00:00.000Z',publishedAtBasis:'event_date',updatedAt:'2026-10-18T07:00:00Z',location:'Reported town',admin1:'Region',country:'Yemen',latitude:15.3,longitude:44.2,geoPrecision:2,timePrecision:1,url:'https://acleddata.com/api/acled/read?event_id_cnty=YEM1'};
  const rows=evidenceClockRows(event,source);
  assert.equal(rows.some(row=>row.label==='Publication'),false);
  assert.equal(rows.find(row=>row.label==='Event').value,event.eventDate);
  assert.equal(rows.find(row=>row.label==='Source record update').value,event.updatedAt);
  const html=evidencePanelMarkup(event,{source});
  assert.match(html,/Structured event record/);assert.match(html,/Provider time-precision code: 1/);
  assert.match(html,/Provider geo-precision code: 2/);assert.match(html,/15.3, 44.2/);
  assert.match(html,/Country\/theatre scope is not a maritime incident position/);
  assert.doesNotMatch(html,/<dt>Publication/);
});

test('official statements and retired advisories do not imply incidents or current safe passage',()=>{
  const statement={recordType:'statement',publishedDate:'2026-10-18',publicationPrecision:'day',locationText:'Red Sea area (statement scope)',locationPrecision:'region-only'};
  const html=evidencePanelMarkup(statement);
  assert.match(html,/Official statement/);assert.match(html,/Regional scope; not an incident position/);
  assert.match(html,/Event date not established/);assert.match(html,/not independent confirmation of every claim/);
  const advisory=evidencePanelMarkup({recordType:'advisory',effectiveDate:'2026-09-01',expiresDate:'2026-12-01'},{source:{...source,retired:true}});
  assert.match(advisory,/Collection retired/);assert.match(advisory,/Archived validity dates do not establish current conditions or safe passage/);
  assert.doesNotMatch(advisory,/<dt>Event|<dt>Publication|1 Sep 2026|1 Dec 2026/);
});

test('source links reject unsafe destinations and all supplied display text is escaped',()=>{
  for(const value of ['javascript:alert(1)','https://user:secret@example.com/a','http://127.0.0.1/a','https://example.com/a?token=secret'])assert.equal(safeEvidenceUrl(value),null);
  assert.equal(safeEvidenceUrl('https://example.com/a?utm_source=feed'),'https://example.com/a');
  const html=evidencePanelMarkup({url:'javascript:alert(1)',source:'<script>x</script>',locationText:'<img src=x onerror=alert(1)>',type:'Publisher opinion'},{source:{label:'<b>Unavailable</b>'}});
  assert.match(html,/Original URL unavailable/);assert.match(html,/Publisher opinion/);
  assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.match(html,/&lt;b&gt;/);
  assert.doesNotMatch(html,/<script|<img|href="javascript:/);
});
