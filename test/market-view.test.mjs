import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarketContext} from '../dist/market-view.mjs';

const NOW=Date.parse('2026-10-12T12:00:00Z');
const series=(extra={})=>({id:'crude-stocks',name:'U.S. crude stocks',configured:true,connection:'connected',freshness:'current',retrievedAt:'2026-10-12T11:00:00Z',url:'https://www.eia.gov/',scale:0.001,displayUnit:'million barrels',units:'MBBL',detail:'Weekly survey',observations:[{date:'2026-10-02',value:410000},{date:'2026-10-09',value:420000}],...extra});

test('a failed weekly refresh keeps values and dates with an explicit retained notice',()=>{
  const data={series:[series()]},before=structuredClone(data);
  assert.doesNotMatch(renderMarketContext(data,{now:NOW}),/Update failed/);
  const failed=renderMarketContext(data,{failed:true,now:NOW});
  assert.match(failed,/Update failed.*retained/);
  assert.match(failed,/420\.0/);assert.match(failed,/Oct 9, 2026/);
  assert.deepEqual(data,before,'display health must not mutate retained provider data');
  assert.doesNotMatch(renderMarketContext(data,{now:NOW}),/Update failed/);
});

test('weekly freshness advances from observation dates without another request',()=>{
  const data={series:[series({observations:[{date:'2026-10-01',value:420000}]})]},before=structuredClone(data);
  assert.doesNotMatch(renderMarketContext(data,{now:Date.parse('2026-10-14T23:59:00Z')}),/Older weekly/);
  assert.match(renderMarketContext(data,{now:Date.parse('2026-10-15T00:01:00Z')}),/Older weekly observations/);
  assert.deepEqual(data,before);
});

test('weekly loading, failed first load, successful empty and disabled access remain distinct',()=>{
  assert.match(renderMarketContext(null,{now:NOW}),/Checking/);
  assert.match(renderMarketContext(null,{failed:true,now:NOW}),/unavailable/i);
  assert.doesNotMatch(renderMarketContext(null,{failed:true,now:NOW}),/Checking/);
  assert.match(renderMarketContext({series:[]},{now:NOW}),/No weekly observations/);
  assert.match(renderMarketContext({series:[series({configured:false,observations:[]})]},{now:NOW}),/Connect a free EIA key/);
});
