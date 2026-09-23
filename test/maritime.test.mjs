import test from 'node:test';
import assert from 'node:assert/strict';
import {MARITIME_FEEDS,parseMaritimePage} from '../lib/maritime.mjs';

const hormuz=MARITIME_FEEDS.find(feed=>feed.id==='imo-hormuz');
const redsea=MARITIME_FEEDS.find(feed=>feed.id==='imo-redsea');
const now=Date.parse('2026-09-13T12:00:00Z');
const row=(date='9 September',ship='TEST SHIP (IMO 1234567)',location='24NM northwest of a reported port',summary='Damaged. No pollution.')=>`<tr><td>${date}</td><td>${ship}</td><td>${location}</td><td>${summary}</td></tr>`;
const page=(rows=row(),updated='10 September 2026')=>`<h1>Middle East - Highlighted (Confirmed) incidents</h1><ul><li>Number of confirmed incidents as at <strong>${updated}</strong>: 1</li></ul><table><tbody><tr><td>Date</td><td>Ship Name (IMO Number)</td><td>Location</td><td>Description</td></tr>${rows}</tbody></table>`;
const statement=(date='12 August 2026',href='/en/mediacentre/pressbriefings/pages/example.aspx')=>`<li><a href="${href}">Statement on shipping in the Red Sea</a> (${date})</li>`;
const index=(rows=statement())=>`<h1>Red Sea area</h1><h3><span>Latest statements</span></h3><ul>${rows}</ul><h3>Confirmed incidents</h3><table><tr><td>Total incidents</td><td>61</td></tr></table><a href="/en/other.aspx">Unrelated link</a> (13 September 2026)`;

test('IMO row preserves source confirmation and day precision without invented coordinates, actors or casualty estimates',()=>{
  const [event]=parseMaritimePage(page(),hormuz,now);
  assert.equal(event.recordType,'incident');
  assert.equal(event.evidenceStatus,'confirmed-by-source');
  assert.equal(event.eventDate,'2026-09-09');
  assert.equal(event.eventDatePrecision,'day');
  assert.equal(event.sourceUpdatedDate,'2026-09-10');
  assert.equal(event.shipName,'TEST SHIP');
  assert.equal(event.imo,'1234567');
  assert.equal(event.locationText,'24NM northwest of a reported port');
  assert.equal(event.summary,'Damaged. No pollution.');
  assert.deepEqual(event.theaters,['hormuz']);
  assert.deepEqual(event.mechanisms,[]);
  assert.equal(event.publishedDate,null);
  for(const key of ['lat','lon','actors','fatalities'])assert.equal(key in event,false);
});

test('row year comes from the dated source, not the computer current year',()=>{
  const [event]=parseMaritimePage(page(),hormuz,Date.parse('2027-01-01T12:00:00Z'));
  assert.equal(event.eventDate,'2026-09-09');
});

test('explicit row years can cross a year boundary without guessing',()=>{
  const [event]=parseMaritimePage(page(row('31 December 2025'),'2 January 2026'),hormuz,now);
  assert.equal(event.eventDate,'2025-12-31');
  assert.throws(()=>parseMaritimePage(page(row('31 December'),'2 January 2026'),hormuz,now),/date/);
});

test('invalid calendar dates, future rows and future source dates fail closed',()=>{
  for(const date of ['31 February','99 March','13 September','1 January 2027'])assert.throws(()=>parseMaritimePage(page(row(date)),hormuz,now),/date/);
  assert.throws(()=>parseMaritimePage(page(row(),'14 September 2026'),hormuz,now),/date/);
});

test('malformed, empty or truncated incident tables cannot overwrite a good cache with zero events',()=>{
  assert.throws(()=>parseMaritimePage('<html>Access denied</html>',hormuz,now));
  assert.throws(()=>parseMaritimePage(page(''),hormuz,now));
  assert.throws(()=>parseMaritimePage(page(row()).replace('Ship Name (IMO Number)','Vessel reference'),hormuz,now));
  assert.throws(()=>parseMaritimePage(page(row()+row().replace('<td>Damaged. No pollution.</td>','')),hormuz,now));
  assert.throws(()=>parseMaritimePage(page(row()+row().replace('</tr>','')),hormuz,now),/truncated/);
  assert.throws(()=>parseMaritimePage(page(row()).replace('10 September 2026','September 2026'),hormuz,now));
});

test('entities and nested formatting are text and cannot introduce HTML into records',()=>{
  const [event]=parseMaritimePage(page(row('9&nbsp;September','<b>TEST &amp; SHIP</b> (IMO&#160;1234567)','<p>Near port</p>','<span>Damaged.</span> No pollution.')),hormuz,now);
  assert.equal(event.shipName,'TEST & SHIP');
  assert.equal(event.imo,'1234567');
  assert.equal(event.locationText,'Near port');
  assert.equal(event.summary,'Damaged. No pollution.');
});

test('duplicates collapse and source wording corrections retain an incident identity',()=>{
  const rows=parseMaritimePage(page(row()+row()),hormuz,now);
  assert.equal(rows.length,1);
  const [updated]=parseMaritimePage(page(row('9 September',undefined,undefined,'Damage updated by source.')),hormuz,now);
  assert.equal(rows[0].id,updated.id);
  const repeated=parseMaritimePage(page(row()+row('1 March')),hormuz,now);
  assert.equal(repeated.length,2);
  assert.notEqual(repeated[0].id,repeated[1].id);
});

test('Red Sea index yields official statements with publication dates, never inferred incident dates or aggregate events',()=>{
  const events=parseMaritimePage(index(statement()+statement('23 July 2026','/en/mediacentre/pressbriefings/pages/older.aspx')),redsea,now);
  assert.equal(events.length,2);
  assert.equal(events[0].recordType,'statement');
  assert.equal(events[0].evidenceStatus,'official-statement');
  assert.equal(events[0].eventDate,null);
  assert.equal(events[0].eventDatePrecision,'unknown');
  assert.equal(events[0].publishedDate,'2026-08-12');
  assert.equal(events[0].publicationPrecision,'day');
  assert.equal(events[0].sourceUpdatedDate,null);
  assert.equal(events[0].url,'https://www.imo.org/en/mediacentre/pressbriefings/pages/example.aspx');
  assert.deepEqual(events[0].theaters,['bab']);
});

test('statement parsing rejects undated, impossible, future, off-origin and unsafe links',()=>{
  for(const value of ['','31 February 2026','14 September 2026'])assert.throws(()=>parseMaritimePage(index(statement(value)),redsea,now));
  for(const href of ['https://example.org/story','javascript:alert(1)','//evil.example/en/mediacentre/story','https://www.imo.org/en/unrelated.aspx'])assert.throws(()=>parseMaritimePage(index(statement(undefined,href)),redsea,now));
  assert.throws(()=>parseMaritimePage(index(''),redsea,now));
  assert.throws(()=>parseMaritimePage(index(statement()+statement().replace('</li>','')),redsea,now),/truncated/);
});

test('feed config is fixed to public IMO sources and input bounds reject unsupported payloads',()=>{
  assert.equal(MARITIME_FEEDS.length,2);
  assert.ok(MARITIME_FEEDS.every(feed=>new URL(feed.url).origin==='https://www.imo.org'));
  assert.throws(()=>parseMaritimePage(page(),{...hormuz,id:'unknown'},now));
  assert.throws(()=>parseMaritimePage(null,hormuz,now));
  assert.throws(()=>parseMaritimePage('x'.repeat(6000001),hormuz,now));
});
