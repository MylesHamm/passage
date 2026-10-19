import test from 'node:test';
import assert from 'node:assert/strict';
import {advisoryCoverageMarkup,createSituationView} from '../dist/situation-view.mjs';

const retired={id:'marad-advisories',configured:false,retired:true,connection:'unavailable',label:'HTTP 403 · access refused',retrievedAt:'2026-09-28T17:58:00Z'};
const advisory={id:'marad-011',sourceId:'marad-advisories',source:'U.S. Maritime Advisories',title:'2026-011 Red Sea advisory',recordType:'advisory',theaters:['bab'],url:'https://www.maritime.dot.gov/msci-advisories/2026-011',effectiveDate:'2026-09-01',expiresDate:'2026-12-01',validityState:'active',sourceStatus:'active'};

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
 assert.match(inspected,/Sep 28/);
});
