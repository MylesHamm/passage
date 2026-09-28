import test from 'node:test';
import assert from 'node:assert/strict';
import {briefCoverage,createPriorityView} from '../dist/priority-view.mjs';

const now=Date.parse('2026-09-28T18:00:00Z');
test('recent failed attempts and a healthy collector never replace source success clocks',()=>{
  const news={coverage:{collection:{lastCompletedAt:new Date(now).toISOString()},archive:{truncated:true}},sources:[
    {id:'bbc',name:'BBC',lastSuccessAt:'2026-09-28T17:58:00Z'},
    {id:'gdelt-hormuz',lastSuccessAt:'2026-09-27T17:00:00Z',checkedAt:'2026-09-28T17:59:00Z',errorCategory:'rate_limit',error:'Rate limited'},
    {id:'centcom',checkedAt:'2026-09-28T17:59:00Z'},
    {id:'reliefweb',configured:false},
  ]};
  const result=briefCoverage(news,{now});
  assert.deepEqual(result.delayed.map(source=>source.id),['gdelt-hormuz','centcom']);
  assert.equal(result.direct.length,1);assert.equal(result.truncated,true);
  assert.equal(briefCoverage(null,{now,failed:true}).checking,false);
});

test('working direct regional feeds show their success clocks while outages stay visible',()=>{
 const news={sources:[
  {id:'mee',name:'Middle East Eye',retrievedAt:'2026-09-28T17:58:00Z'},
  {id:'memo',name:'Middle East Monitor',retrievedAt:'2026-09-28T17:59:00Z'},
  {id:'france24',name:'France 24 Middle East',retrievedAt:'2026-09-28T16:00:00Z',error:'Unavailable'},
  {id:'gdelt-hormuz',error:'Rate limited'},
 ]};
 const result=briefCoverage(news,{now});
 assert.deepEqual(result.direct.map(source=>source.id),['mee','memo']);
 assert.deepEqual(result.delayed.map(source=>source.id),['france24','gdelt-hormuz']);
 const mount={innerHTML:'',ownerDocument:{activeElement:null},contains:()=>false,querySelectorAll:()=>[],addEventListener:()=>{}};
 createPriorityView({mount,getState:()=>({news,actor:'All',theater:'both',auto:true}),now:()=>now}).update();
 assert.match(mount.innerHTML,/Middle East Eye retrieved 2m ago/);assert.match(mount.innerHTML,/Middle East Monitor retrieved 1m ago/);assert.match(mount.innerHTML,/Reporting coverage delayed/);
});

test('new briefing arrivals appear before applying the reading snapshot; official records keep their dates',()=>{
  const old={id:'old',title:'Iran holds nuclear talks',url:'https://example.com/old',source:'Publisher',publishedAt:'2026-09-28T16:00:00Z',actors:['Iran']};
  const added={...old,id:'new',title:'Iran tanker attack closes Strait of Hormuz',url:'https://example.com/new',publishedAt:'2026-09-28T17:55:00Z'};
  const state={news:{items:[old]},theater:'both',actor:'All',auto:true,maritime:{events:[{id:'imo-old',title:'CAPE DAO · maritime incident',theaters:['hormuz'],eventDate:'2026-09-23',recordType:'incident',sourceUpdatedDate:'2026-09-24'}]}};
  const mount={innerHTML:'',ownerDocument:{activeElement:null},contains:()=>false,querySelectorAll:()=>[],addEventListener:()=>{}};
  const view=createPriorityView({mount,getState:()=>state,getArrivalCount:()=>state.latestNews?1:0,now:()=>now});view.update();
  assert.doesNotMatch(mount.innerHTML,/Iran tanker attack/);
  state.latestNews={items:[added,old]};view.update();
  assert.match(mount.innerHTML,/Iran tanker attack closes Strait of Hormuz/);
  assert.match(mount.innerHTML,/1 new link · update reading list/);
  assert.deepEqual(state.news.items,[old]);
  assert.match(mount.innerHTML,/Latest retrieved IMO incident · 23 Sept/);
  assert.match(mount.innerHTML,/no current operating status or attacker inferred/);
  assert.match(mount.innerHTML,/Source page updated 24 Sept/);
});

// The reading model imposes its own validated/canonical capacity. Extra raw
// records are not pending arrivals and must not produce a useless Apply button.
test('briefing arrivals use the reading-session count rather than raw snapshot difference',()=>{
  const state={news:{items:[]},latestNews:{items:[{id:'raw-extra',title:'Iran tanker attack',url:'https://example.com/raw',publishedAt:'2026-09-28T17:00:00Z'}]},theater:'both',actor:'All',auto:true};
  const mount={innerHTML:'',ownerDocument:{activeElement:null},contains:()=>false,querySelectorAll:()=>[],addEventListener:()=>{}};
  createPriorityView({mount,getState:()=>state,getArrivalCount:()=>0,now:()=>now}).update();
  assert.doesNotMatch(mount.innerHTML,/data-priority-arrivals/);
  assert.match(mount.innerHTML,/Iran tanker attack/);
});

test('a lead moved into a closed disclosure returns focus to the briefing rather than hidden content',()=>{
  for(const visible of [false,true]){
    const active={dataset:{priorityKey:'bab:old'}};let mountFocused=false,targetFocused=false;
    const target={dataset:{priorityKey:'bab:old'},getClientRects:()=>visible?[{}]:[],focus:()=>{targetFocused=true;}};
    const mount={innerHTML:'',ownerDocument:{activeElement:active},contains:()=>true,querySelectorAll:selector=>selector==='[data-priority-key]'?[target]:[],addEventListener:()=>{},focus:()=>{mountFocused=true;}};
    createPriorityView({mount,getState:()=>({actor:'All',theater:'both',auto:true}),now:()=>now}).update();
    assert.equal(targetFocused,visible);assert.equal(mountFocused,!visible);
  }
});
