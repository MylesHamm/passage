import test from 'node:test';
import assert from 'node:assert/strict';
import {MARKET_SERIES,parseMarketContext,loadMarketContext} from '../lib/market-context.mjs';
import {renderMarketContext} from '../dist/market-view.mjs';
const now=Date.parse('2026-09-22T12:00:00Z'),definition=MARKET_SERIES[0];
const row=(period,value,other={})=>({period,value,series:'WCESTUS1',units:'MBBL',...other});
const payload=rows=>({response:{frequency:'weekly',data:rows},request:{api_key:'fixture-secret'}});

test('weekly EIA observations validate identity, preserve units and never expose the API envelope',()=>{
  const result=parseMarketContext(payload([row('2026-09-11','423429'),row('2026-09-04','424069'),row('2026-10-02','99'),row('2026-02-30','99'),row('2026-09-18','')]),definition,now);
  assert.deepEqual(result.observations,[{date:'2026-09-04',value:424069},{date:'2026-09-11',value:423429}]);
  assert.equal(result.units,'MBBL');assert.equal(result.frequency,'weekly');assert.ok(!JSON.stringify(result).includes('fixture-secret'));
  for(const bad of [{series:'OTHER'},{units:'BBL'}])assert.throws(()=>parseMarketContext(payload([row('2026-09-11','1',bad)]),definition,now));
  assert.throws(()=>parseMarketContext({response:{frequency:'daily',data:[]}},definition,now));
  assert.throws(()=>parseMarketContext(payload([row('2026-09-11',null)]),definition,now));
});
test('weekly display distinguishes percentage points, stock units and missing weeks',()=>{
  const series=[{...definition,observations:[{date:'2026-09-04',value:424069},{date:'2026-09-11',value:423429}],connection:'cached'},
    {...MARKET_SERIES[1],observations:[{date:'2026-08-28',value:97.8},{date:'2026-09-11',value:96.8}]}];
  const html=renderMarketContext({series});assert.match(html,/423\.4/);assert.match(html,/-0\.6 million barrels week over week/);assert.match(html,/-1\.0 percentage points since Aug 28/);assert.match(html,/Update failed/);assert.match(html,/do not measure Middle East flows/);
});
test('missing free EIA key makes no requests and preserves explicit configuration status',async()=>{
  const data=await loadMarketContext({get(){assert.fail('No request without key');}},{health:(id,s)=>({...s,configured:false})});
  assert.equal(data.series.length,2);assert.ok(data.series.every(s=>s.connection==='not configured'&&s.observations.length===0));
});
