import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MARAD_SOURCE,parseMaradAdvisoriesIndex,parseMaradAdvisoryPage,loadMaradAdvisories,maradValidity} from '../lib/marad.mjs';

const fixture=name=>readFile(new URL(`./fixtures/marad/${name}`,import.meta.url),'utf8');
const index=await fixture('index.html');
const hormuz=await fixture('2026-011.html');
const redsea=await fixture('2026-013.html');
const cancelled=await fixture('cancelled-2026-006.html');
const now=Date.parse('2026-10-17T04:47:33Z');
const rows=()=>parseMaradAdvisoriesIndex(index,now);
const row=id=>rows().find(r=>r.advisoryId===id);
const pages=new Map([[MARAD_SOURCE.url,index],[row('2026-011').url,hormuz],[row('2026-013').url,redsea]]);

test('real sanitized index yields only relevant advisory metadata with independent date/status semantics',()=>{
  const records=rows();
  assert.equal(records.length,5);
  assert.deepEqual(records.filter(r=>r.sourceStatus==='active').map(r=>r.advisoryId),['2026-013','2026-011']);
  for(const record of records){
    assert.equal(record.recordKind,'official-advisory');assert.equal(record.recordType,'advisory');
    assert.equal(record.eventDate,null);assert.equal(record.publishedDate,null);assert.equal(record.sourceUpdatedDate,null);
    assert.equal(record.eventDatePrecision,'unknown');assert.equal(record.publicationPrecision,'unknown');
    assert.deepEqual(record.mechanisms,[]);
    for(const key of ['lat','lon','summary','description','body','publishedAt'])assert.equal(key in record,false);
  }
  assert.equal(row('2026-011').effectiveDate,'2026-09-09');
  assert.equal(row('2026-011').expiresDate,'2027-03-08');
  assert.equal(row('2026-011').validityState,'active');
  assert.equal(row('2026-006').validityState,'cancelled');
});

test('real detail fields preserve present and previous advisory IDs without returning guidance',()=>{
  const h=parseMaradAdvisoryPage(hormuz,row('2026-011'),now);
  const r=parseMaradAdvisoryPage(redsea,row('2026-013'),now);
  assert.deepEqual(h.supersedes,['2026-004']);assert.deepEqual(r.supersedes,['2026-006']);
  assert.equal(h.locationText,'Persian Gulf, Strait of Hormuz and Gulf of Oman');
  assert.equal(r.threatType,'Houthi Attacks on Commercial Vessels');
  assert.deepEqual(h.theaters,['hormuz']);assert.deepEqual(r.theaters,['bab']);
  assert.equal(h.effectiveDatePrecision,'day');assert.equal(h.expiryDatePrecision,'day');
  assert.ok(!JSON.stringify(h).includes('Description'));
});

test('real cancelled detail stays cancelled and preserves its own prior ID',()=>{
  const record=parseMaradAdvisoryPage(cancelled,row('2026-006'),now);
  assert.equal(record.sourceStatus,'cancelled');assert.equal(record.validityState,'cancelled');
  assert.deepEqual(record.supersedes,['2025-012']);
});

test('loader reads the fixed index and relevant active details only, then annotates explicit supersession',async()=>{
  const requested=[];
  const result=await loadMaradAdvisories(async url=>{requested.push(url);assert.ok(pages.has(url));return pages.get(url);},now);
  assert.equal(requested.length,3);assert.equal(requested[0],MARAD_SOURCE.url);
  assert.equal(result.recordCount,5);assert.equal(result.advisories.length,5);
  const previous=result.advisories.find(r=>r.advisoryId==='2026-006');
  assert.deepEqual(previous.supersededBy,['2026-013']);assert.equal(previous.validityState,'superseded');
  assert.equal(previous.sourceStatus,'cancelled');
  assert.equal(result.coverage.activeListedCount,2);assert.equal(result.coverage.incidentCoverage,false);
  assert.equal(result.coverage.cancelledArchiveComplete,false);assert.equal(result.latest,null);
  assert.equal('events' in result,false);
});

test('effective/expiry are day-precision validity, never refreshed publication or event dates',()=>{
  const record=row('2026-011');
  assert.equal(maradValidity(record,Date.parse('2026-09-08T23:59:59Z')),'not-yet-effective');
  assert.equal(maradValidity(record,Date.parse('2027-03-08T23:59:59Z')),'active');
  assert.equal(maradValidity(record,Date.parse('2027-03-09T00:00:00Z')),'expired');
  assert.equal(record.sourceStatus,'active');
  assert.equal(maradValidity({...record,effectiveDate:null},now),'unknown');
  assert.equal(maradValidity({...record,expiresDate:null},now),'unknown');
  assert.equal(maradValidity({...record,sourceStatus:'cancelled'},now),'cancelled');
});

test('explicitly unknown validity dates remain null in index and detail',()=>{
  const modified=index.replace('09/09/2026','Unknown').replace('03/08/2027','Unknown');
  const record=parseMaradAdvisoriesIndex(modified,now).find(r=>r.advisoryId==='2026-011');
  const detail=hormuz.replace(/<time\b[^>]*>09\/09\/2026<\/time>\s*-\s*<time\b[^>]*>03\/08\/2027<\/time>/,'Unknown');
  const parsed=parseMaradAdvisoryPage(detail,record,now);
  assert.equal(parsed.effectiveDate,null);assert.equal(parsed.expiresDate,null);
  assert.equal(parsed.validityState,'unknown');assert.equal(parsed.effectiveDatePrecision,'unknown');
});

test('calendar errors, reversed dates and unexpected date representations fail closed',()=>{
  for(const date of ['02/31/2026','13/01/2026','2026-09-09','09/09/1999']){
    assert.throws(()=>parseMaradAdvisoriesIndex(index.replace('09/09/2026',date),now),/date/);
  }
  assert.throws(()=>parseMaradAdvisoriesIndex(index.replace('09/09/2026','09/09/2028'),now),/date range/);
  assert.throws(()=>parseMaradAdvisoriesIndex(index,NaN),/clock/);
});

test('detail/index conflicts and conflicting machine date labels invalidate the entire observation',()=>{
  for(const detail of [
    hormuz.replace(/\bActive\b/,'Cancelled'),
    hormuz.replaceAll('09/09/2026','09/10/2026'),
    hormuz.replace('2026-09-09T12:00:00Z','2026-09-10T12:00:00Z'),
    hormuz.replace('2026-011-Persian','2026-099-Persian'),
  ])assert.throws(()=>parseMaradAdvisoryPage(detail,row('2026-011'),now));
});

test('zero-result, challenge, missing section and changed table schema are ambiguous failures',()=>{
  for(const html of ['','<html>Access denied</html>',index.replace('Active Advisories','Current messages'),index.replace('Effective Date','Published'),index.replace(/<tbody>[\s\S]*?<\/tbody>/,'<tbody></tbody>')]){
    assert.throws(()=>parseMaradAdvisoriesIndex(html,now));
  }
  const noRelevant=index.replace(/<h2>Active Advisories<\/h2>[\s\S]*?(?=<h2>Cancelled)/,match=>match.replace(/<tr>\s*<td[\s\S]*?<\/tr>/g,row=>/2026-011|2026-013/.test(row)?'':row));
  assert.throws(()=>parseMaradAdvisoriesIndex(noRelevant,now),/scoped active list empty/);
});

test('truncated/duplicate rows and contradictory statuses fail closed',()=>{
  const rowEnd=index.indexOf('</tr>',index.indexOf('<tbody>'));
  assert.throws(()=>parseMaradAdvisoriesIndex(index.slice(0,rowEnd)+index.slice(rowEnd+5),now),/truncated/);
  assert.throws(()=>parseMaradAdvisoriesIndex(index.replace('>Active\t','>Cancelled\t'),now),/status/);
  const first=index.match(/<tr>\s*<td[\s\S]*?<\/tr>/)[0];
  assert.throws(()=>parseMaradAdvisoriesIndex(index.replace(first,first+first),now),/duplicate/);
});

test('URL allowlist rejects non-official destinations, credentials, query and identity mismatch',()=>{
  const original=row('2026-013').url.replace('https://www.maritime.dot.gov','');
  for(const replacement of ['https://example.org'+original,'https://www.maritime.dot.gov.evil.test'+original,'https://user:pass@www.maritime.dot.gov'+original,original+'?x=1',original+'#fragment','javascript:alert(1)',original.replace('2026-013','2026-099')]){
    assert.throws(()=>parseMaradAdvisoriesIndex(index.replace(original,replacement),now));
  }
});

test('detail boundaries, absent metadata and self-supersession fail closed',()=>{
  for(const detail of [hormuz.replace('</article>',''),hormuz.replace('field--name-field-msci-status','different-status'),hormuz.replaceAll('2026-004','2026-011')]){
    assert.throws(()=>parseMaradAdvisoryPage(detail,row('2026-011'),now));
  }
});

test('loader propagates HTTP/access/network failures without fallback, retries or partial success',async()=>{
  for(const failure of [Object.assign(new Error('Forbidden'),{status:403}),new Error('Network failed')]){
    let calls=0;
    await assert.rejects(loadMaradAdvisories(async()=>{calls++;throw failure;},now),e=>e===failure);
    assert.equal(calls,1);
  }
  let calls=0;
  await assert.rejects(loadMaradAdvisories(async url=>{calls++;if(url===row('2026-011').url)throw Error('Detail failed');return pages.get(url);},now),/Detail failed/);
  assert.equal(calls,3);
});

test('malformed detail cannot silently degrade to index-only active records',async()=>{
  await assert.rejects(loadMaradAdvisories(async url=>url===MARAD_SOURCE.url?index:'<html>Challenge</html>',now));
});

test('bounds prevent unbounded HTML or arbitrary loader usage',()=>{
  assert.throws(()=>parseMaradAdvisoriesIndex('x'.repeat(1000001),now),/payload/);
  assert.throws(()=>parseMaradAdvisoryPage('x'.repeat(1000001),row('2026-011'),now),/payload/);
  assert.equal(MARAD_SOURCE.interval,3600);assert.equal(Object.isFrozen(MARAD_SOURCE),true);
});
