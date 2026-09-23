import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCentcomIndex} from '../lib/centcom.mjs';
const now=Date.parse('2026-09-21T12:00:00Z');
const page=date=>`>Public Releases</span><b><a href="https://www.centcom.mil/MEDIA/PUBLIC-RELEASES/Article/12345/example/">Forces escort tanker in Hormuz</a></b> ${date}<br></div>`;
test('official release calendar dates reject rollover and retain day precision',()=>{
  assert.throws(()=>parseCentcomIndex(page('Feb. 30, 2026'),now),/Invalid release date/);
  assert.throws(()=>parseCentcomIndex(page('Feb. 29, 2026'),now),/Invalid release date/);
  for(const [date,expected] of [['Feb. 29, 2024','2024-02-29'],['Sept. 17, 2026','2026-09-17'],['September 17, 2026','2026-09-17']]){
    const [row]=parseCentcomIndex(page(date),now);assert.equal(row.publicationDate,expected);assert.equal(row.publicationPrecision,'day');
  }
});
