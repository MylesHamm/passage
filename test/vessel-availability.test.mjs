import test from 'node:test';
import assert from 'node:assert/strict';
import {vesselAvailability} from '../dist/vessel-availability.mjs';

const openWaters = Object.freeze({id:'openwaters',group:'vessels',configured:true,connection:'connected'});
const aisDisabled = Object.freeze({id:'aisstream',group:'vessels',configured:false,connection:'not configured',status:'disabled'});
const available = {hasSnapshot:true,sources:[openWaters],scopeLabel:'Hormuz',layerLabel:'tankers',typeFiltered:true};

test('initial and pending checks show unknown availability, not a zero or an invented alternative',()=>{
  for (const options of [{}, {sources:[{...openWaters,connection:'loading'}]},
    {hasSnapshot:true,sources:[aisDisabled,{...openWaters,connection:'connecting'}]},
    {hasSnapshot:true,sources:[{id:'aisstream',configured:null,status:'disabled',connection:'loading'}]}]) {
    const result=vesselAvailability(options);
    assert.equal(result.status,'checking');
    assert.equal(result.count,null);
    assert.equal(result.canShowAll,false);
    assert.equal(result.showAllLabel,null);
    assert.match(result.detail,/has not been established/);
    assert.doesNotMatch(result.detail,/Choose All received|other positions|previously received/);
  }
});

test('a failed initial request stays unavailable even if old metadata says connected',()=>{
  const result=vesselAvailability({...available,hasSnapshot:false,requestFailed:true});
  assert.equal(result.status,'unavailable');
  assert.equal(result.heading,'Vessel update unavailable');
  assert.equal(result.count,null);
  assert.equal(result.retained,false);
  assert.match(result.detail,/request failed/);
  assert.match(result.detail,/No retained positions/);
  assert.doesNotMatch(result.detail,/Choose All received/);
});

test('request failure discloses only the actual unexpired records retained in scope',()=>{
  const result=vesselAvailability({...available,requestFailed:true,allCount:3,matchingCount:2,
    sources:[{...openWaters,recordCount:900}]});
  assert.equal(result.status,'unavailable');
  assert.equal(result.count,2);
  assert.equal(result.retained,true);
  assert.match(result.detail,/3 previously received positions remain for Hormuz/);
  assert.match(result.detail,/2 received positions match tankers in Hormuz/);
  assert.match(result.detail,/Original position timestamps are preserved/);
  assert.doesNotMatch(result.detail,/900/);
});

test('failure and a type filter can coexist without hiding either explanation',()=>{
  const result=vesselAvailability({...available,requestFailed:true,allCount:4,matchingCount:0});
  assert.equal(result.status,'unavailable');
  assert.equal(result.count,0);
  assert.equal(result.canShowAll,true);
  assert.match(result.detail,/request failed/);
  assert.match(result.detail,/No received positions match tankers/);
  assert.match(result.detail,/Choose All received to inspect 4 received positions/);
});

test('a successful empty snapshot is a coverage gap, not a traffic count or failed request',()=>{
  const result=vesselAvailability(available);
  assert.equal(result.status,'empty');
  assert.equal(result.count,0);
  assert.equal(result.retained,false);
  assert.equal(result.canShowAll,false);
  assert.match(result.detail,/coverage gap, not evidence that the waterway is empty/);
  assert.doesNotMatch(result.detail,/request failed|Choose All received/);
});

test('All received is offered only when the type filter actually hides records',()=>{
  const result=vesselAvailability({...available,allCount:5,matchingCount:0});
  assert.equal(result.status,'filtered');
  assert.equal(result.count,0);
  assert.equal(result.canShowAll,true);
  assert.equal(result.showAllLabel,'Show all 5 received positions');
  assert.match(result.detail,/5 received positions are hidden/);
  for (const options of [
    {allCount:0,matchingCount:0,typeFiltered:true},
    {allCount:5,matchingCount:5,typeFiltered:true},
    {allCount:5,matchingCount:0,typeFiltered:false},
  ]) {
    const unchanged=vesselAvailability({...available,...options});
    assert.equal(unchanged.canShowAll,false);
    assert.equal(unchanged.showAllLabel,null);
    assert.doesNotMatch(unchanged.detail,/Choose All received/);
  }
});

test('disabled AISStream never suppresses a working public fallback',()=>{
  const result=vesselAvailability({...available,sources:[aisDisabled,openWaters],allCount:1,matchingCount:1});
  assert.equal(result.status,'available');
  assert.equal(result.heading,'1 received position');
  assert.equal(result.count,1);
  assert.equal(result.retained,false);
  assert.doesNotMatch(result.detail,/not enabled|checking|unavailable/);
});

test('all explicitly disabled sources are distinct from unconfirmed configuration',()=>{
  const result=vesselAvailability({sources:[aisDisabled,{...openWaters,configured:false,status:'disabled'}]});
  assert.equal(result.status,'disabled');
  assert.equal(result.count,null);
  assert.match(result.detail,/No vessel sources are enabled/);
  assert.equal(vesselAvailability({sources:[]}).status,'checking');
});

test('configuration errors are unavailable rather than disabled or indefinitely pending',()=>{
  const result=vesselAvailability({sources:[{id:'aisstream',configured:null,configurationFailed:true,connection:'unknown'}]});
  assert.equal(result.status,'unavailable');
  assert.equal(result.count,null);
  assert.match(result.detail,/configuration could not be checked/);
});

test('a responding source does not conceal another provider failure',()=>{
  const result=vesselAvailability({...available,sources:[openWaters,
    {id:'aisstream',configured:true,connection:'disconnected'}],allCount:2,matchingCount:2});
  assert.equal(result.status,'available');
  assert.equal(result.count,2);
  assert.match(result.detail,/One vessel source is unavailable/);
  assert.doesNotMatch(result.detail,/previously received positions remain/);
});

test('a pending fallback does not conceal another provider failure',()=>{
  const result=vesselAvailability({hasSnapshot:true,sources:[
    {...openWaters,connection:'loading'},{id:'aisstream',configured:true,connection:'disconnected'}]});
  assert.equal(result.status,'checking');
  assert.equal(result.count,null);
  assert.match(result.detail,/One vessel source is unavailable/);
});

test('provider failure metadata takes precedence over a connected flag',()=>{
  for (const issue of [{error:'Provider unavailable'},{errorCategory:'provider'},{localFailure:true},
    {checkStatus:'failed'},{connection:'cached'},{connection:'unavailable'}]) {
    const result=vesselAvailability({...available,sources:[{...openWaters,...issue}]});
    assert.equal(result.status,'unavailable');
    assert.equal(result.count,null);
    assert.equal(result.retained,false);
  }
});

test('a subscription without position frames does not invent fallback reception or heartbeat verification',()=>{
  const result=vesselAvailability({...available,sources:[
    {id:'aisstream',configured:true,connection:'connected',positionFrames:0,heartbeat:'awaiting reply'},
    {...openWaters,connection:'unavailable'}]});
  assert.equal(result.status,'empty');
  assert.equal(result.count,0);
  assert.match(result.detail,/One vessel source is unavailable/);
  assert.doesNotMatch(result.detail,/quiet|heartbeat|verified|empty waterway/);
});

test('refresh pause retains actual positions and does not hide a failed request',()=>{
  const result=vesselAvailability({...available,autoRefresh:false,allCount:2,matchingCount:1});
  assert.equal(result.status,'paused');
  assert.equal(result.retained,true);
  assert.equal(result.count,1);
  assert.match(result.detail,/Automatic refresh is paused/);
  assert.equal(vesselAvailability({...available,autoRefresh:false}).count,null);
  assert.equal(vesselAvailability({...available,autoRefresh:false,requestFailed:true}).status,'unavailable');
});

test('an idle stream is paused, and retained records are counted only when supplied',()=>{
  const sources=[{id:'aisstream',configured:true,connection:'idle'}];
  assert.equal(vesselAvailability({hasSnapshot:true,sources}).status,'paused');
  assert.equal(vesselAvailability({hasSnapshot:true,sources}).count,null);
  const retained=vesselAvailability({hasSnapshot:true,sources,allCount:1});
  assert.equal(retained.retained,true);
  assert.equal(retained.count,1);
});

test('expired positions and provider totals do not create retained data or an All received action',()=>{
  const result=vesselAvailability({...available,requestFailed:true,allCount:0,matchingCount:0,
    sources:[{...openWaters,connection:'cached',recordCount:300}]});
  assert.equal(result.count,null);
  assert.equal(result.retained,false);
  assert.equal(result.canShowAll,false);
  assert.doesNotMatch(result.detail,/300|Choose All received|previously received/);
});

test('the helper ignores non-vessel health and does not mutate caller metadata',()=>{
  const sources=Object.freeze([aisDisabled,openWaters,Object.freeze({id:'bbc',group:'news',connection:'unavailable',error:'error'})]);
  const options=Object.freeze({...available,sources,allCount:1,matchingCount:1});
  assert.deepEqual(vesselAvailability(options),vesselAvailability(options));
  assert.doesNotMatch(vesselAvailability(options).detail,/unavailable/);
  assert.equal(sources[0].configured,false);
});

test('malformed or inconsistent counts cannot fabricate additional positions',()=>{
  for (const allCount of [undefined,-1,1.5,NaN,Infinity,'12']) {
    const result=vesselAvailability({...available,allCount,matchingCount:12});
    assert.equal(result.count,0);
    assert.equal(result.canShowAll,false);
  }
  const bounded=vesselAvailability({...available,allCount:2,matchingCount:20});
  assert.equal(bounded.count,2);
  assert.equal(bounded.canShowAll,false);
});
