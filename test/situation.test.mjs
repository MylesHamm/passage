import test from 'node:test';
import assert from 'node:assert/strict';
import { selectEvidence, priceComparison, oilMechanisms, contextAge } from '../dist/situation-data.mjs';
const now=Date.parse('2026-09-13T12:00:00Z');
test('ledger keeps publication-only statements separate from dated incidents and excludes future records',()=>{
 const records=[{id:'old',eventDate:'2025-09-11',theaters:['bab']},{id:'day',eventDate:'2026-09-13',theaters:['hormuz']},{id:'statement',eventDate:null,publishedDate:'2026-09-12',theaters:['bab'],recordType:'statement'},{id:'future',eventDate:'2026-09-14',theaters:['bab']}];
 assert.deepEqual(selectEvidence(records,{days:30,theater:'both',now}).map(x=>x.id),['day','statement']);
 assert.deepEqual(selectEvidence(records,{days:30,theater:'bab',now}).map(x=>x.id),['statement']);
});
test('price comparisons use exact dates, show missing days, and never substitute a later observation',()=>{
 const series=[{date:'2026-09-10',value:100},{date:'2026-09-11',value:103},{date:'2026-09-14',value:105}];
 assert.deepEqual(priceComparison(series,'2026-09-11',now),{before:{date:'2026-09-10',value:100},onDate:{date:'2026-09-11',value:103},delta:3,percent:3});
 assert.equal(priceComparison(series,'2026-09-12',now).onDate,null);
 assert.equal(priceComparison(series,null,now).delta,null);
});
test('unrelated protest does not become an oil disruption and mechanism matches are explicitly hypotheses',()=>{
 assert.equal(oilMechanisms({title:'Peaceful demonstration in Tehran'}).length,0);
 const found=oilMechanisms({title:'Oil export pipeline shut after attack'});
 assert.ok(found.some(x=>x.id==='supply'));
 assert.ok(found.every(x=>x.basis==='Potential channel; effect not measured'));
});
test('curated context expires visibly without advancing its review clock',()=>{
 assert.equal(contextAge('2026-09-13',now).needsReview,false);
 assert.equal(contextAge('2026-09-01',now).needsReview,true);
 assert.equal(contextAge(null,now).label,'Review date unknown');
});
test('reporting wording cannot create a port match and shut-ins expose a supply channel',()=>{
 assert.equal(oilMechanisms({title:'Peaceful protest reported in Tehran'}).length,0);
 assert.ok(oilMechanisms({title:'Supply losses meet shrinking buffers',summary:'Gulf output shut-ins and inventory draws'}).some(m=>m.id==='supply'));
});
