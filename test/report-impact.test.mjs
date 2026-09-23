import test from 'node:test';
import assert from 'node:assert/strict';
import {reportImpactMarkup} from '../dist/report-impact.mjs';
const oil={series:[{name:'Brent',observations:[{date:'2026-09-10',value:100},{date:'2026-09-11',value:101}]}]};
test('headline oil channels stay potential and publication dates do not become event dates',()=>{
  const html=reportImpactMarkup({title:'Saudi export pipeline update',publishedAt:'2026-09-11T12:00:00Z'},oil);
  assert.match(html,/Export availability/);assert.match(html,/effects are not measured/);assert.match(html,/event date is not established/);assert.match(html,/Latest available \$101\.00/);assert.doesNotMatch(html,/\+\$1\.00/);
});
test('known event dates use exact observations and source text is escaped',()=>{
  const html=reportImpactMarkup({title:'Tanker transit',eventDate:'2026-09-11',watch:'<script>bad</script>'},oil);
  assert.match(html,/Transit &amp; freight/);assert.match(html,/\+\$1\.00 from 2026-09-10/);assert.doesNotMatch(html,/<script>/);
});
test('regional politics without a supply channel does not receive an invented oil effect',()=>{
  assert.match(reportImpactMarkup({title:'Iran delegation attends annual assembly'},oil),/No direct oil-supply or transport channel/);
});
