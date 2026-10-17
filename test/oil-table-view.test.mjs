import test from 'node:test';
import assert from 'node:assert/strict';
import {oilObservationTableRows,oilObservationTableMarkup} from '../dist/oil-table-view.mjs';
test('daily value table uses the chart calendar window, finite values and independent dates',()=>{
 const series=[{id:'brent',observations:[{date:'2026-09-01',value:1},{date:'2026-10-10',value:70},{date:'2026-10-12',value:null},{date:'2026-10-13',value:71},{date:'2026-10-20',value:999}]},{id:'wti',observations:[{date:'2026-10-12',value:-5}]}];
 const options={period:3,now:Date.parse('2026-10-17T00:00:00Z')};
 const {rows}=oilObservationTableRows(series,options);
 assert.deepEqual(rows.map(r=>r.date),['2026-10-13','2026-10-12']);
 assert.equal(rows[1].values.find(v=>v.id==='brent').value,null);
 const html=oilObservationTableMarkup(series,options);assert.match(html,/3 calendar-day window/);assert.match(html,/-\$5\.00/);assert.doesNotMatch(html,/999|\$0\.00/);
});
