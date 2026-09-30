import test from 'node:test';
import assert from 'node:assert/strict';
import {expectationsModel,renderExpectations,createExpectationsView} from '../dist/expectations-view.mjs';

const now=Date.parse('2026-09-30T15:45:00Z');
const market=(id,extra={})=>({id,question:`Will shipping return through the Strait of Hormuz by October 31? ${id}`,url:`https://polymarket.com/event/market-${id}`,theater:'hormuz',probability:.423,priceBasis:'midpoint',bestBid:.42,bestAsk:.426,liquidityUsd:100000,volume24hUsd:12345,endDate:'2026-11-01T03:59:00Z',updatedAt:'2026-09-30T15:41:00Z',description:'Resolves under the named source and market rules.',...extra});
const payload=(markets=[market('one')],source={})=>({markets,source:{connection:'connected',status:'current',freshness:'current',retrievedAt:'2026-09-30T15:44:00Z',interval:300,...source},notes:['Selected active shipping markets.']});

test('market probabilities retain exact questions, YES meaning, financial context and rule links',()=>{
  const row=market('one'),html=renderExpectations(payload([row]),{now});
  assert.ok(html.includes(row.question));assert.match(html,/42\.3%/);assert.match(html,/>YES</);assert.match(html,/not event confirmation/);
  assert.match(html,/\$100,000/);assert.match(html,/\$12,345/);assert.match(html,/Bid\/ask midpoint/);
  assert.match(html,/Retrieved 30 Sept 2026, 15:44 UTC/);assert.match(html,/Read full resolution rules/);assert.match(html,/Market updated/);
});

test('theatre selection and deadlines exclude irrelevant, ended and undated contracts',()=>{
  const data=payload([market('hormuz'),market('bab',{theater:'bab'}),market('regional',{theater:'both'}),market('ended',{endDate:'2026-09-30T15:45:00Z'}),market('unknown',{endDate:null})]);
  assert.deepEqual(expectationsModel(data,{now,theater:'hormuz'}).markets.map(row=>row.id),['hormuz','regional']);
  assert.deepEqual(expectationsModel(data,{now,theater:'bab'}).markets.map(row=>row.id),['bab','regional']);
  assert.deepEqual(expectationsModel(data,{now}).markets.map(row=>row.id),['hormuz','bab','regional']);
});

test('missing and out of range prices never masquerade as a zero probability',()=>{
  for(const probability of [null,undefined,NaN,-1,1.1,'0.5']){
    const html=renderExpectations(payload([market('one',{probability})]),{now});
    assert.match(html,/>—<\/strong>/);assert.match(html,/No price/);assert.doesNotMatch(html,/>0%<\/strong>/);
  }
  assert.match(renderExpectations(payload([market('one',{probability:.00001})]),{now}),/&lt;0\.1%/);
  assert.match(renderExpectations(payload([market('one',{probability:.99999})]),{now}),/&gt;99\.9%/);
});

test('loading, failure, retained and overdue states remain distinct with original retrieval times',()=>{
  assert.equal(expectationsModel(null,{now}).status,'loading');
  assert.equal(expectationsModel(null,{now,failed:true}).status,'unavailable');
  const data=payload();
  assert.equal(expectationsModel(data,{now,failed:true}).status,'retained');
  assert.equal(expectationsModel(payload([market('one')],{connection:'cached'}),{now}).status,'retained');
  assert.equal(expectationsModel(payload([market('one')],{retrievedAt:'2026-09-30T15:00:00Z'}),{now}).status,'stale');
  assert.equal(expectationsModel(payload([market('one')],{retrievedAt:null}),{now}).status,'unknown');
  const html=renderExpectations(data,{now,failed:true});
  assert.match(html,/Update failed · retained prices/);assert.match(html,/Retrieved 30 Sept 2026, 15:44 UTC/);assert.doesNotMatch(html,/15:45/);
});

test('empty selection explains coverage without asserting absence of activity',()=>{
  const html=renderExpectations(payload([market('one')]),{now,theater:'bab'});
  assert.match(html,/No active markets retrieved for Bab el-Mandeb/);assert.match(html,/not evidence of calm/);
  assert.equal(expectationsModel(payload([]),{now}).status,'empty');
});

test('provider content is escaped and only official HTTPS market URLs become links',()=>{
  for(const url of ['javascript:alert(1)','https://evil.example/event/one','https://polymarket.com.evil.example/event/one','https://user@polymarket.com/event/one','http://polymarket.com/event/one']){
    const html=renderExpectations(payload([market('one',{question:'<img src=x onerror=alert(1)>',description:'<script>alert(2)</script>',url})]),{now});
    assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.doesNotMatch(html,/<img|<script|href="javascript|href="http:\/\/|href="https:\/\/evil/);
    assert.doesNotMatch(html,/Read full resolution rules/);
  }
});

test('first three markets are primary and remaining markets are in an accessible disclosure',()=>{
  const html=renderExpectations(payload(Array.from({length:5},(_,i)=>market(String(i)))),{now});
  assert.match(html,/<details class="expectations-more"/);assert.match(html,/2 more markets/);
  assert.equal(html.match(/class="expectation-row"/g).length,5);
  assert.ok(html.indexOf('market-2')<html.indexOf('class="expectations-more"'));
  assert.ok(html.indexOf('market-3')>html.indexOf('class="expectations-more"'));
});

test('unchanged updates leave the DOM and keyboard focus untouched',()=>{
  let replacements=0;
  const host={querySelectorAll:()=>[],querySelector:()=>null,ownerDocument:{activeElement:null},contains:()=>false,set innerHTML(value){replacements++;}};
  const state={expectations:payload(),theater:'both',failures:{}};
  const view=createExpectationsView(host,{getState:()=>state,now:()=>now});
  view.update();view.update();assert.equal(replacements,1);
  state.failures.expectations=true;view.update();assert.equal(replacements,2);
});

test('client ages market retrieval at the same ten-minute threshold as source health',()=>{
 const model=expectationsModel({markets:[],source:{status:'current',retrievedAt:'2026-09-30T10:00:00Z',interval:60,freshnessAfterSeconds:600}},{now:Date.parse('2026-09-30T10:10:10Z')});
 assert.equal(model.status,'stale');
});
