import test from 'node:test';
import assert from 'node:assert/strict';
import {advisoryCoverageMarkup,createSituationView,evidenceLedgerState} from '../dist/situation-view.mjs';

const retired={id:'marad-advisories',configured:false,retired:true,connection:'unavailable',label:'HTTP 403 · access refused',retrievedAt:'2026-09-28T17:58:00Z'};
const advisory={id:'marad-011',sourceId:'marad-advisories',source:'U.S. Maritime Advisories',title:'2026-011 Red Sea advisory',recordType:'advisory',theaters:['bab'],url:'https://www.maritime.dot.gov/msci-advisories/2026-011',effectiveDate:'2026-09-01',expiresDate:'2026-12-01',validityState:'active',sourceStatus:'active'};

test('Evidence distinguishes pending, first-load failure and a successful empty response',()=>{
  const pending=evidenceLedgerState();
  assert.match(pending.basis,/Checking official records/);
  assert.match(pending.empty,/Waiting for official-source responses/);
  assert.doesNotMatch(pending.empty,/No retrieved evidence matches/);
  assert.equal(pending.canReview,false);
  const failed=evidenceLedgerState({failed:true});
  assert.match(failed.basis,/Official records are unavailable/);
  assert.doesNotMatch(failed.basis+failed.empty,/Checking|retained|previously retrieved/);
  assert.equal(failed.canReview,false);
  const empty=evidenceLedgerState({maritime:{events:[]}});
  assert.match(empty.empty,/No retrieved evidence matches/);
  assert.doesNotMatch(empty.basis,/Checking|unavailable/);
  assert.equal(empty.canReview,false);
});

test('Evidence preserves actual retained records and does not describe local context as retrieved',()=>{
  const record={id:'imo-1',recordType:'incident',eventDate:'2026-10-18',retrievedAt:'2026-10-19T10:00:00Z'};
  const maritime={events:[record]},original=structuredClone(maritime);
  const retained=evidenceLedgerState({records:[record],maritime,failed:true});
  assert.match(retained.basis,/1 incident entries.*previously retrieved evidence/);
  assert.equal(retained.canReview,true);
  assert.deepEqual(maritime,original);
  const context=evidenceLedgerState({records:[{id:'curated',recordType:'assessment',reviewedAt:'2026-09-10'}],failed:true});
  assert.match(context.basis,/Dated reference context/);
  assert.doesNotMatch(context.basis,/previously retrieved|retained/);
  const filtered=evidenceLedgerState({maritime,failed:true});
  assert.equal(filtered.canReview,false);
  assert.doesNotMatch(filtered.basis,/previously retrieved/);
});

test('Evidence recognizes provider failures in a returned payload and preserves partial coverage warnings',()=>{
  const source={id:'imo-hormuz',group:'maritime',configured:true,status:'unavailable',attention:true};
  const failed=evidenceLedgerState({maritime:{events:[]},sources:[source]});
  assert.match(failed.basis,/Official records are unavailable/);
  const partial=evidenceLedgerState({maritime:{events:[]},sources:[source,{...source,id:'imo-redsea',status:'empty',successfulCheck:true,attention:false}]});
  assert.match(partial.basis,/some official-source updates need attention/);
  const unconfigured=evidenceLedgerState({unconfigured:true});
  assert.match(unconfigured.basis,/not configured/);
  assert.doesNotMatch(unconfigured.basis,/Checking|dated reference/);
});

test('unavailable advisory category has one concise disclosure without an empty feed panel',()=>{
 const html=advisoryCoverageMarkup({theater:'both',maritime:{advisories:[]}},[retired]);
 assert.match(html,/Current maritime advisories are unavailable/);
 assert.match(html,/not an all-clear/);
 assert.doesNotMatch(html,/advisory-register|<h3>|<details|MARAD|HTTP 403|access refused|No source status/);
});

test('retired advisory evidence remains collapsed with original validity and retrieval dates',()=>{
 const html=advisoryCoverageMarkup({theater:'both',maritime:{advisories:[advisory]}},[retired]);
 assert.match(html,/<details class="ledger-source-notes advisory-archive">/);
 assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
 assert.match(html,/1 archived advisory/);
 assert.match(html,/Current validity has not been verified/);
 assert.match(html,/Source status at retrieval: active/);
 assert.match(html,/Effective Sep 1, 2026 · expires Dec 1, 2026/);
 assert.match(html,/Retrieved Sep 28, 2026, 17:58 UTC/);
 assert.match(html,/data-evidence="marad-011"/);
 assert.equal(advisory.validityState,'active');
 const otherTheater=advisoryCoverageMarkup({theater:'hormuz',maritime:{advisories:[advisory]}},[retired]);
 assert.doesNotMatch(otherTheater,/2026-011|archived advisory/);
});

test('archived advisory distinguishes recorded source status from computed expiry',()=>{
 const expired={...advisory,expiresDate:'2026-09-27',sourceStatus:'active',validityState:'expired'};
 const state={theater:'both',maritime:{advisories:[expired]}};
 const html=advisoryCoverageMarkup(state,[retired]);
 assert.match(html,/Source status at retrieval: active/);
 assert.match(html,/Validity from archived dates: expired/);
 assert.doesNotMatch(html,/Source status at retrieval: expired|Last recorded status: expired/);
 let inspected='';
 createSituationView({getState:()=>state,getSources:()=>[retired],openDialog:(_label,copy)=>{inspected=copy;}}).showEvidence(expired.id);
 assert.match(inspected,/<dt>Source status at retrieval<\/dt><dd>active<\/dd>/);
 assert.match(inspected,/<dt>Validity from archived dates<\/dt><dd>expired<\/dd>/);
});

test('advisories are exported separately from incidents and retain inspector provenance',()=>{
 let inspected='';
 const state={theater:'both',maritime:{events:[],advisories:[advisory]},oil:{series:[]}};
 const view=createSituationView({getState:()=>state,getSources:()=>[retired],openDialog:(_label,html)=>{inspected=html;}});
 const payload=view.exportEvidence();
 assert.ok(!payload.events.some(row=>row.id===advisory.id));
 assert.equal(payload.advisories[0].url,advisory.url);
 assert.equal(payload.advisories[0].effectiveDate,advisory.effectiveDate);
 view.showEvidence(advisory.id);
 assert.match(inspected,/2026-011 Red Sea advisory/);
 assert.match(inspected,/https:\/\/www.maritime.dot.gov\/msci-advisories\/2026-011/);
 assert.match(inspected,/Source retrieval/);
 assert.match(inspected,/28 Sep/);
});

test('failed refresh across expiry recomputes archived validity without changing source status or retrieval',()=>{
 const cached={...advisory,expiresDate:'2026-10-19',validityState:'active',retrievedAt:retired.retrievedAt};
 const original=structuredClone(cached);
 const state={theater:'both',failures:{maritime:true},maritime:{advisories:[cached]}};
 let tick=Date.parse('2026-10-19T23:59:59Z'),inspected='';
 const view=createSituationView({getState:()=>state,getSources:()=>[retired],now:()=>tick,openDialog:(_label,copy)=>{inspected=copy;}});
 assert.match(advisoryCoverageMarkup(state,[retired],tick),/Validity from archived dates: active/);
 tick=Date.parse('2026-10-20T00:00:00Z');
 const html=advisoryCoverageMarkup(state,[retired],tick);
 assert.match(html,/Validity from archived dates: expired/);
 assert.match(html,/Source status at retrieval: active/);
 assert.match(html,/Retrieved Sep 28, 2026, 17:58 UTC/);
 assert.match(html,/Current maritime advisories are unavailable/);
 view.showEvidence(cached.id);
 assert.match(inspected,/<dt>Validity from archived dates<\/dt><dd>expired<\/dd>/);
 assert.match(inspected,/<dt>Source status at retrieval<\/dt><dd>active<\/dd>/);
 assert.deepEqual(cached,original);
});

test('official inspector shares evidence facts while preserving source account and oil interpretation',()=>{
 const record={id:'st3',title:'ST3 · maritime incident',sourceId:'imo-hormuz',source:'IMO',recordType:'incident',evidenceStatus:'confirmed-by-source',eventDate:'2026-10-16',eventDatePrecision:'day',publishedDate:null,sourceUpdatedDate:'2026-10-19',locationText:'68 NM from Al Jubail',locationPrecision:'reported-area',summary:'Source description.',theaters:['hormuz'],url:'https://www.imo.org/en/mediacentre/hottopics/pages/middle-east-highlighted-incidents.aspx'};
 const state={theater:'both',maritime:{events:[record]},oil:{series:[]}},original=structuredClone(state);
 let inspected='';
 createSituationView({getState:()=>state,getSources:()=>[{id:'imo-hormuz',retrievedAt:'2026-10-19T16:40:00Z'}],openDialog:(_label,html)=>{inspected=html;}}).showEvidence(record.id);
 assert.match(inspected,/aria-label="Source and evidence"/);assert.match(inspected,/16 Oct 2026 · date only/);assert.match(inspected,/19 Oct 2026 · date only/);
 assert.match(inspected,/68 NM from Al Jubail/);assert.match(inspected,/Listed as confirmed by the original source/);
 assert.match(inspected,/<h3>Source account<\/h3><p>Source description/);
 assert.match(inspected,/Potential oil-market channels/);assert.match(inspected,/comparison does not measure causation/);
 assert.match(inspected,/Explore connections/);assert.doesNotMatch(inspected,/<dt>Publication|<dt>Record retrieval/);
 assert.deepEqual(state,original);
});

test('official inspector does not create a source link or borrowed review date when absent',()=>{
 const record={id:'unknown',title:'Undated statement',recordType:'statement',theaters:['bab'],url:'javascript:alert(1)'};
 let inspected='';
 createSituationView({getState:()=>({theater:'both',maritime:{events:[record]}}),getSources:()=>[],openDialog:(_label,html)=>{inspected=html;}}).showEvidence(record.id);
 assert.match(inspected,/Original URL unavailable/);assert.match(inspected,/Event date not established/);
 assert.doesNotMatch(inspected,/href="javascript:|Explore connections|<dt>Curated review|Curated source review/);
});
