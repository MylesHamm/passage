import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {workspaceFor} from '../dist/workspace-view.mjs';
import {vesselAvailability} from '../dist/vessel-availability.mjs';
import {vesselTypeLabel,isSnapshotVessel} from '../dist/vessel-data.mjs';
import {evidencePanelMarkup,safeEvidenceUrl} from '../dist/evidence-panel.mjs';

const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const section=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
function harness(){
  const nodes=new Map(),label={hidden:false};
  const $=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{textContent:'',value:'',checked:true,closest:()=>label});
    return nodes.get(selector);
  };
  const state={view:'reporting',theater:'hormuz',actor:'Iran',hours:'24',query:'tanker',includeArchive:true,showVessels:false,showInfrastructure:false};
  const context=vm.createContext({state,$,workspaceFor,names:{both:'Both theatres',hormuz:'Strait of Hormuz',bab:'Bab el-Mandeb'},
    currentVesselLayer:()=>({detail:'Tankers'}),setTheater:theater=>{state.theater=theater;context.renderScope();}});
  vm.runInContext(section('function resetFilters(', 'function storyById('),context);
  vm.runInContext(section('function renderScope(', 'function setView('),context);
  vm.runInContext(section('function renderMapLayerState(', 'function renderVessels('),context);
  return {state,context,$,label};
}

test('reset restores reporting filters without changing the selected workspace',()=>{
  for(const view of ['reporting','saved','civilian','overview']){
    const h=harness();h.state.view=view;h.context.resetFilters();
    assert.equal(h.state.view,view);
    assert.equal(h.state.hours,'72');assert.equal(h.$('#time-window').value,'72');
    assert.equal(h.state.actor,'All');assert.equal(h.state.theater,'both');
    assert.equal(h.state.query,'');assert.equal(h.$('#search').value,'');
    assert.equal(h.state.includeArchive,false);assert.equal(h.$('#include-archive').checked,false);
  }
});

test('scope text exposes the filters actually applied to each workspace',()=>{
  const h=harness();h.context.renderScope();
  assert.match(h.$('#workspace-filter-note').textContent,/Actor: Iran.*Search: tanker.*Historical archive included/);
  assert.equal(h.label.hidden,false);assert.equal(h.$('#time-window').value,'24');
  h.state.view='overview';h.context.renderScope();
  assert.match(h.$('#workspace-filter-note').textContent,/Active publisher feeds.*reading search and archive filters apply in Reporting/);
  assert.doesNotMatch(h.$('#workspace-filter-note').textContent,/Search: tanker|Historical archive included/);
  assert.equal(h.label.hidden,false);
  h.state.view='energy';h.context.renderScope();
  assert.match(h.$('#workspace-filter-note').textContent,/observation dates and chart period/);
  assert.equal(h.label.hidden,true);
  h.state.view='evidence';h.context.renderScope();
  assert.match(h.$('#workspace-filter-note').textContent,/dates and windows are shown in each ledger/);
  assert.equal(h.label.hidden,true);
});

test('visible map layer state names active layers and the received-position scope',()=>{
  const h=harness();h.context.renderMapLayerState();
  assert.equal(h.$('#map-layer-state').textContent,'AIS layer off · Infrastructure references off');
  h.state.showVessels=true;h.state.showInfrastructure=true;h.context.renderMapLayerState();
  assert.match(h.$('#map-layer-state').textContent,/AIS: Tankers · Strait of Hormuz · received positions under 30 min/);
  assert.match(h.$('#map-layer-state').textContent,/Infrastructure references on/);
  assert.doesNotMatch(h.$('#map-layer-state').textContent,/live traffic|historical positions/i);
});

test('both infrastructure entry points update the visible layer state immediately',()=>{
  const h=harness();let options;
  Object.assign(h.context,{INFRASTRUCTURE:[{id:'asset',name:'Reference asset'}],esc:String,
    globe:{setInfrastructure(){}},allSourceStates:()=>[],openDialog(){},openInspector(){},showSources(){},
    createSituationView:value=>{options=value;return {showAsset(){}};}});
  vm.runInContext(section('const situation=createSituationView(', 'monitoring=createMonitoringView('),h.context);
  options.onInfrastructure();
  assert.equal(h.state.showInfrastructure,true);
  assert.equal(h.$('#show-infrastructure').checked,true);
  assert.match(h.$('#map-layer-state').textContent,/Infrastructure references on/);
  h.state.showInfrastructure=false;h.context.renderMapLayerState();
  vm.runInContext(section("const assetSelect=$('#asset-select');", "$$('.secondary-nav"),h.context);
  h.$('#asset-select').value='asset';h.$('#asset-select').onchange();
  assert.equal(h.state.showInfrastructure,true);
  assert.match(h.$('#map-layer-state').textContent,/Infrastructure references on/);
});

function vesselHarness(){
  const h=harness(),sources=[{id:'openwaters',group:'vessels',configured:true,connection:'connected'}];
  Object.assign(h.state,{vesselFilter:'oil',vessels:{vessels:[]},failures:{},auto:true});
  let inspector='';
  Object.assign(h.context,{sources,allSourceStates:()=>sources,vesselAvailability,vesselTypeLabel,isSnapshotVessel,evidencePanelMarkup,safeEvidenceUrl,
    esc:String,relative:value=>value,$$:()=>[],globe:null,inspectorMode:null,markSelection(){},
    openInspector:(_title,html)=>{inspector=html;}});
  for(const selector of ['#vessel-status','#vessel-note','#vessel-filter','#vessel-count-summary','#vessel-count-basis'])h.$(selector).classList={toggle(){}};
  vm.runInContext(section('const VESSEL_LAYERS=', 'const fmtDate='),h.context);
  vm.runInContext(section('function allVisibleVessels()', 'async function loadVessels()'),h.context);
  vm.runInContext(section('function showVesselList()', 'function showVessel('),h.context);
  vm.runInContext(section('function showAcledEvent(', 'function renderAcledSummary('),h.context);
  return {...h,sources,inspector:()=>inspector};
}

test('legacy Open Waters snapshots stay out of current positions with an explicit coverage explanation',()=>{
  const h=vesselHarness();
  h.state.vessels.vessels=[{mmsi:'999000001',provider:'Open Waters',theater:'hormuz',
    shipType:'tanker',positionTime:new Date().toISOString(),latitude:26.57,longitude:56.25}];
  assert.equal(h.context.allVisibleVessels().length,0);
  h.context.renderVessels();h.context.showVesselList();
  assert.match(h.$('#vessel-note').textContent,/last-known Open Waters snapshot.*excluded.*coordinate time and source are unavailable/);
  assert.match(h.inspector(),/last-known Open Waters snapshot/);
});

test('vessel panel and list agree about a failed feed and offer All received only for actual hidden positions',()=>{
  const h=vesselHarness();h.state.failures.vessels=true;
  h.context.renderVessels();h.context.showVesselList();
  assert.equal(h.$('#vessel-status').textContent,'Vessel update unavailable');
  assert.equal(h.$('#vessel-count-summary').textContent,'—');
  assert.match(h.inspector(),/latest vessel-data request failed/);
  assert.doesNotMatch(h.inspector(),/show-all-vessels|Switch Layer|Checking/);
  h.state.failures.vessels=false;
  h.state.vessels.vessels=[{mmsi:'123',name:'Cargo A',shipType:'cargo',theater:'hormuz',positionTime:new Date().toISOString(),provider:'AISStream'}];
  h.context.renderVessels();h.context.showVesselList();
  assert.equal(h.$('#vessel-status').textContent,'No matching received positions');
  assert.match(h.inspector(),/Show all 1 received position/);
  h.$('#show-all-vessels').onclick();
  assert.equal(h.state.vesselFilter,'all');
  assert.match(h.inspector(),/Cargo A/);
  assert.doesNotMatch(h.inspector(),/id="show-all-vessels"/);
});

test('ACLED inspector uses the shared evidence clocks and keeps event time distinct from publication',()=>{
  const h=vesselHarness();
  h.state.acled={events:[{id:'a',sourceId:'acled',recordId:'YEM1',title:'Provider event',eventDate:'2026-10-16',publishedAt:'2026-10-16T00:00:00Z',publishedAtBasis:'event_date',theaters:['bab'],actors:['Actor A'],geoPrecision:2,timePrecision:1,sourceUrl:'https://acleddata.com/api-documentation',url:'https://acleddata.com/record'}]};
  h.context.showAcledEvent('a');
  assert.match(h.inspector(),/aria-label="Source and evidence"/);
  assert.match(h.inspector(),/<dt>Event<\/dt>/);
  assert.match(h.inspector(),/Provider geo-precision code: 2/);
  assert.match(h.inspector(),/Actor A/);assert.match(h.inspector(),/API field documentation/);
  assert.doesNotMatch(h.inspector(),/<dt>Publication<\/dt>/);
});
