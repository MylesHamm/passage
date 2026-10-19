import test from 'node:test';
import assert from 'node:assert/strict';
import {briefCoverage,createPriorityView} from '../dist/priority-view.mjs';

const now=Date.parse('2026-09-28T18:00:00Z');
const healthySource=(id='bbc')=>({id,configured:true,connection:'connected',retrievedAt:'2026-09-28T17:58:00Z',latestRelevant:'2026-09-28T17:00:00Z',recordCount:1});
test('recent failed attempts and a healthy collector never replace source success clocks',()=>{
  const news={coverage:{collection:{lastCompletedAt:new Date(now).toISOString()},archive:{truncated:true}},sources:[
    {id:'bbc',name:'BBC',lastSuccessAt:'2026-09-28T17:58:00Z'},
    {id:'gdelt-hormuz',lastSuccessAt:'2026-09-27T17:00:00Z',checkedAt:'2026-09-28T17:59:00Z',errorCategory:'rate_limit',error:'Rate limited'},
    {id:'centcom',checkedAt:'2026-09-28T17:59:00Z'},
    {id:'reliefweb',configured:false},
  ]};
  const result=briefCoverage(news,{now});
  assert.deepEqual(result.delayed.map(source=>source.id),[]);
  assert.ok(!result.sources.some(source=>source.id==='gdelt-hormuz'));
  assert.equal(result.direct.length,1);assert.equal(result.truncated,true);
  assert.equal(briefCoverage(null,{now,failed:true}).checking,false);
});

test('working reporting remains primary while technical outage details stay in diagnostics',()=>{
 const news={sources:[
  {id:'mee',name:'Middle East Eye',retrievedAt:'2026-09-28T17:58:00Z'},
  {id:'memo',name:'Middle East Monitor',retrievedAt:'2026-09-28T17:59:00Z'},
  {id:'france24',name:'France 24 Middle East',retrievedAt:'2026-09-28T16:00:00Z',error:'Unavailable'},
  {id:'gdelt-hormuz',error:'Rate limited'},
 ]};
 const result=briefCoverage(news,{now});
 assert.deepEqual(result.direct.map(source=>source.id),['mee','memo']);
 assert.deepEqual(result.delayed.map(source=>source.id),['france24']);
 const mount={innerHTML:'',ownerDocument:{activeElement:null},contains:()=>false,querySelectorAll:()=>[],addEventListener:()=>{}};
 createPriorityView({mount,getState:()=>({news,actor:'All',theater:'both',auto:true}),now:()=>now}).update();
 assert.match(mount.innerHTML,/Reporting coverage is partial/);
 assert.match(mount.innerHTML,/data-priority-sources/);
 assert.doesNotMatch(mount.innerHTML,/retrieved 2m ago|source updates need attention|Rate limited|GDELT|France 24/);
});

test('new briefing arrivals appear before applying the reading snapshot; official records keep their dates',()=>{
  const old={id:'old',title:'Iran holds nuclear talks',url:'https://example.com/old',source:'Publisher',sourceId:'bbc',publishedAt:'2026-09-28T16:00:00Z',actors:['Iran']};
  const added={...old,id:'new',title:'Iran tanker attack closes Strait of Hormuz',url:'https://example.com/new',publishedAt:'2026-09-28T17:55:00Z'};
  const state={news:{items:[old],sources:[healthySource()]},theater:'both',actor:'All',auto:true,maritime:{events:[{id:'imo-old',title:'CAPE DAO · maritime incident',theaters:['hormuz'],eventDate:'2026-09-23',recordType:'incident',sourceUpdatedDate:'2026-09-24'}]}};
  const mount={innerHTML:'',ownerDocument:{activeElement:null},contains:()=>false,querySelectorAll:()=>[],addEventListener:()=>{}};
  const view=createPriorityView({mount,getState:()=>state,getArrivalCount:()=>state.latestNews?1:0,now:()=>now});view.update();
  assert.doesNotMatch(mount.innerHTML,/Iran tanker attack/);
  state.latestNews={items:[added,old],sources:[healthySource()]};view.update();
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
  const state={news:{items:[]},latestNews:{items:[{id:'raw-extra',title:'Iran tanker attack',sourceId:'bbc',url:'https://example.com/raw',publishedAt:'2026-09-28T17:00:00Z'}],sources:[healthySource()]},theater:'both',actor:'All',auto:true};
  const mount={innerHTML:'',ownerDocument:{activeElement:null},contains:()=>false,querySelectorAll:()=>[],addEventListener:()=>{}};
  createPriorityView({mount,getState:()=>state,getArrivalCount:()=>0,now:()=>now}).update();
  assert.doesNotMatch(mount.innerHTML,/data-priority-arrivals/);
  assert.match(mount.innerHTML,/Iran tanker attack/);
});

test('failed, retired and unverified sources cannot appear as current Watch developments',()=>{
 const item=(id,sourceId)=>({id,sourceId,title:`Iran tanker attack ${id}`,source:'Publisher',url:`https://example.com/${id}`,publishedAt:'2026-09-28T17:00:00Z'});
 const news={items:[item('active','bbc'),item('failed','aj'),item('retired','centcom'),item('discovery','gdelt-hormuz'),item('missing','unknown')],sources:[healthySource(),{...healthySource('aj'),connection:'cached',error:'Provider refused access'},healthySource('centcom'),healthySource('gdelt-hormuz')]};
 const mount={innerHTML:'',ownerDocument:{activeElement:null},contains:()=>false,querySelectorAll:()=>[],addEventListener:()=>{}};
 createPriorityView({mount,getState:()=>({news,actor:'All',theater:'both'}),now:()=>now}).update();
 assert.match(mount.innerHTML,/Iran tanker attack active/);
 assert.doesNotMatch(mount.innerHTML,/Iran tanker attack (failed|retired|discovery|missing)/);
 assert.equal(news.items.length,5,'historical evidence remains in the source snapshot');
});

test('working publishers do not promote retained history, retired collection or reading holds on Watch',()=>{
 const item=(id,extra={})=>({id,sourceId:'bbc',title:`Iran tanker attack ${id}`,source:'BBC',url:`https://example.com/${id}`,publishedAt:'2026-09-28T17:00:00Z',...extra});
 const current=item('current',{provenance:[{sourceId:'gdelt-hormuz',contentAccess:'discovery-metadata'},{sourceId:'bbc',contentAccess:'headline-only'}]});
 const news={items:[current,item('history',{retainedFromHistory:true}),item('retired',{collectionRetired:true}),item('reading',{retainedForReading:true})],sources:[healthySource()]};
 const mount={innerHTML:'',ownerDocument:{activeElement:null},contains:()=>false,querySelectorAll:()=>[],addEventListener:()=>{}};
 createPriorityView({mount,getState:()=>({news,actor:'All',theater:'both'}),now:()=>now}).update();
 assert.match(mount.innerHTML,/Iran tanker attack current/);
 assert.doesNotMatch(mount.innerHTML,/Iran tanker attack (history|retired|reading)/);
 assert.equal(news.items.length,4,'archive evidence is preserved without being promoted');
 assert.equal(current.provenance[0].sourceId,'gdelt-hormuz','mixed historical provenance remains intact');
});

test('successful publisher with no recent relevant publication is a neutral empty selection',()=>{
 const sources=['bbc','aj','mee','memo','france24'].map(id=>({...healthySource(id),latestRelevant:'2026-09-20T10:00:00Z'}));
 const news={items:[],sources};
 const mount={innerHTML:'',ownerDocument:{activeElement:null},contains:()=>false,querySelectorAll:()=>[],addEventListener:()=>{}};
 createPriorityView({mount,getState:()=>({news,actor:'All',theater:'both'}),now:()=>now}).update();
 assert.match(mount.innerHTML,/No recent matching headline from active publishers/);
 assert.doesNotMatch(mount.innerHTML,/coverage is partial|Current reporting unavailable|source updates need attention/);
 assert.match(mount.innerHTML,/does not mean no events occurred/);
});

test('all publisher checks overdue means current reporting is unavailable, not a neutral no-match state',()=>{
 const sources=['bbc','aj','mee','memo','france24'].map(id=>({...healthySource(id),retrievedAt:'2026-09-28T15:00:00Z'}));
 const news={items:[],sources};
 assert.equal(briefCoverage(news,{now}).unknown,true);
 const mount={innerHTML:'',ownerDocument:{activeElement:null},contains:()=>false,querySelectorAll:()=>[],addEventListener:()=>{}};
 createPriorityView({mount,getState:()=>({news,actor:'All',theater:'both'}),now:()=>now}).update();
 assert.match(mount.innerHTML,/Current reporting is unavailable/);
 assert.doesNotMatch(mount.innerHTML,/No recent matching headline from active publishers/);
});

test('Watch preserves publisher opinion and analysis labels and regional context limits',()=>{
 for(const type of ['Publisher opinion','Publisher analysis','Independent energy analysis']){
  const report={id:'genre',sourceId:'bbc',source:'BBC',type,title:'Iran oil exports need a new strategy',url:'https://example.com/genre',publishedAt:'2026-09-28T17:00:00Z'};
  const mount={innerHTML:'',ownerDocument:{activeElement:null},contains:()=>false,querySelectorAll:()=>[],addEventListener:()=>{}};
  createPriorityView({mount,getState:()=>({news:{items:[report],sources:[healthySource()]},actor:'All',theater:'both'}),now:()=>now}).update();
  assert.ok(mount.innerHTML.includes('BBC · '+type+' · Published'));
  assert.match(mount.innerHTML,/Iran &amp; Gulf context/);
  assert.match(mount.innerHTML,/Regional labels describe headline context, not incident locations/);
 }
});

test('Watch discloses missing advisory coverage once and links to Evidence',()=>{
 const news={items:[],sources:['bbc','aj','mee','memo','france24'].map(healthySource)};
 const mount={innerHTML:'',ownerDocument:{activeElement:null},contains:()=>false,querySelectorAll:()=>[],addEventListener:()=>{}};
 const state={news,actor:'All',theater:'both',maritime:{coverage:{advisories:{status:'unavailable',collection:'retired'}}}};
 createPriorityView({mount,getState:()=>state,now:()=>now}).update();
 assert.equal(mount.innerHTML.match(/Current maritime advisories unavailable\./g).length,1);
 assert.match(mount.innerHTML,/data-workspace-view="evidence"/);
 assert.doesNotMatch(mount.innerHTML,/MARAD|HTTP 403|access refused/);
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
