import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarketPulse} from '../dist/market-pulse.mjs';

const now=Date.parse('2026-09-30T16:00:00Z');
const series=(observations,extra={})=>({id:'brent',name:'Brent',connection:'connected',retrievedAt:'2026-09-30T15:30:00Z',observations,...extra});
const row=(date,value)=>({date,value});
const render=(observations,extra={},options={})=>renderMarketPulse({series:[series(observations,extra)]},{now,...options});

test('pulse sorts dates and compares the previous available daily observation without changing input',()=>{
  const observations=[row('2026-09-29',101),row('2026-09-25',97),row('2026-09-28',100)];
  const html=render(observations);
  assert.match(html,/\$101\.00/);
  assert.match(html,/\+\$1\.00/);
  assert.match(html,/vs 28 Sep 2026/);
  assert.match(html,/datetime="2026-09-29"/);
  assert.deepEqual(observations.map(point=>point.date),['2026-09-29','2026-09-25','2026-09-28']);
  assert.match(html,/data-workspace-view="energy"/);
  assert.match(html,/Daily spot.*publication lag/);
});

test('sparkline uses thirty calendar days, real dated points and gaps for unreported days',()=>{
  const html=render([row('2026-08-30',800),row('2026-08-31',90),row('2026-09-01',91),row('2026-09-29',100)]);
  assert.match(html,/30 calendar days through 29 Sep 2026/);
  assert.match(html,/Range \$90\.00 to \$100\.00/);
  assert.match(html,/3 reported observations/);
  assert.doesNotMatch(html,/\$800/);
  const path=html.match(/<path[^>]+d="([^"]+)"/)[1];
  assert.equal((path.match(/M/g)||[]).length,2,'unreported calendar dates break the line');
  assert.equal((html.match(/class="pulse-point"/g)||[]).length,3,'only reported observations get a point');
});

test('missing, nonfinite, invalid dates and future observations are never rendered as a zero price',()=>{
  const html=render([row('2026-09-29',null),row('2026-09-28',NaN),row('2026-09-27',Infinity),row('2026-09-26','100'),row('2026-09-31',110),row('2026-10-01',115)]);
  assert.match(html,/No daily observations/);
  assert.doesNotMatch(html,/<svg|\$0\.00|NaN|Infinity/);
});

test('zero and negative finite prices remain valid and no percentage division is invented',()=>{
  const html=render([row('2026-09-28',0),row('2026-09-29',-3)]);
  assert.match(html,/-\$3\.00/);
  assert.match(html,/2 reported observations/);
  assert.doesNotMatch(html,/NaN|Infinity|%/);
});

test('loading, empty, failed and retained prices have distinct states',()=>{
  assert.match(renderMarketPulse(null,{now}),/Checking daily prices/);
  assert.match(renderMarketPulse(null,{now,failed:true}),/Daily prices unavailable/);
  assert.match(render([]),/No daily observations/);
  const retained=render([row('2026-09-29',101)],{}, {failed:true});
  assert.match(retained,/data-state="retained"/);
  assert.match(retained,/Update failed · retained observation/);
  assert.match(retained,/datetime="2026-09-29"/);
  assert.match(render([row('2026-09-29',101)],{connection:'cached'}),/Update failed · retained observation/);
});

test('stale source states and aging observations cannot look current',()=>{
  assert.match(render([row('2026-09-29',101)],{freshness:'stale'}),/Older observation/);
  assert.match(render([row('2026-09-10',101)]),/Older observation/);
  assert.match(render([row('2026-09-29',101)],{retrievedAt:null}),/Retrieval time unknown/);
});

test('each known series appears once, duplicate dates do not add synthetic points and provider text cannot inject HTML',()=>{
  const malicious={...series([row('2026-09-29',101),row('2026-09-29',102)]),name:'<img src=x onerror=alert(1)>',error:'<script>alert(1)</script>'};
  const html=renderMarketPulse({series:[malicious,malicious,series([row('2026-09-29',95)],{id:'wti',name:'WTI'})]},{now});
  assert.equal((html.match(/data-market-series="brent"/g)||[]).length,1);
  assert.equal((html.match(/data-market-series="wti"/g)||[]).length,1);
  assert.equal((html.match(/class="pulse-point"/g)||[]).length,2);
  assert.doesNotMatch(html,/<img|<script|onerror/);
});
