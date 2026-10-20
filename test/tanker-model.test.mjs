import test from 'node:test';
import assert from 'node:assert/strict';
import {tankerPresentation, tankerSvg} from '../dist/terrain/tanker-model.mjs';

// Synthetic normalized records exercise presentation only; never live AIS evidence.
const now = Date.parse('2026-10-20T12:00:00Z');
const record = Object.freeze({
  mmsi:'123456789', provider:'Synthetic test source',
  longitude:56.5, latitude:26.3, shipTypeCode:80,
  positionTime:'2026-10-20T11:59:00Z', timestampBasis:'provider',
  shipTypeObservedAt:'2026-10-20T11:50:00Z',
  headingDegrees:0, courseDegrees:85,
});

test('only explicitly reported tanker codes qualify; names and classification strings do not', () => {
  for (const code of [80,89,'81']) {
    assert.equal(tankerPresentation({...record,shipTypeCode:code},now).visible,true);
  }
  for (const code of [undefined,null,0,79,90,80.1,'8e1',true]) {
    const state = tankerPresentation({...record,shipTypeCode:code,shipType:'tanker',name:'OIL TANKER'},now);
    assert.equal(state.visible,false);
    assert.equal(state.marker,'none');
    assert.equal(tankerSvg(state),'');
  }
});

test('valid true heading including north wins over course, and course is a labeled fallback', () => {
  const north = tankerPresentation(record,now);
  assert.equal(north.bearingDegrees,0);
  assert.equal(north.bearingBasis,'heading');
  assert.match(north.orientationLabel,/Reported heading 0°/);
  for (const heading of [null,undefined,511,360,-1,NaN,Infinity,'90',true]) {
    const state = tankerPresentation({...record,headingDegrees:heading},now);
    assert.equal(state.bearingDegrees,85);
    assert.equal(state.bearingBasis,'course');
    assert.match(state.orientationLabel,/Course over ground 85°; heading unavailable/);
  }
  assert.equal(tankerPresentation({...record,headingDegrees:359.9},now).bearingDegrees,359.9);
});

test('unknown or unavailable directions keep a neutral position, never a north-facing ship', () => {
  for (const direction of [null,undefined,360,511,-1,NaN,Infinity,'0',false]) {
    const state = tankerPresentation({...record,headingDegrees:direction,courseDegrees:direction},now);
    assert.equal(state.visible,true);
    assert.equal(state.marker,'neutral');
    assert.equal(state.bearingDegrees,null);
    assert.equal(state.bearingBasis,'unavailable');
    assert.deepEqual(state.point,[56.5,26.3]);
    assert.match(state.orientationLabel,/direction not shown/);
    const svg = tankerSvg(state);
    assert.match(svg,/data-tanker-symbol="neutral"/);
    assert.doesNotMatch(svg,/data-tanker-part="hull"|rotate|polygon/);
  }
});

test('position time alone controls exact stale and expiry boundaries', () => {
  for (const [age,stale,expired,visible] of [
    [0,false,false,true],[599999,false,false,true],[600000,true,false,true],
    [1799999,true,false,true],[1800000,true,true,false],
  ]) {
    const positionTime = new Date(now-age).toISOString();
    const state = tankerPresentation({...record,positionTime,ageSeconds:0,stale:false,receivedAt:new Date(now).toISOString()},now);
    assert.equal(state.stale,stale);
    assert.equal(state.expired,expired);
    assert.equal(state.visible,visible);
    assert.equal(state.ageSeconds,Math.floor(age/1000));
    assert.equal(state.expiresAt,new Date(now-age+1800000).toISOString());
  }
});

test('missing, malformed, future or geographically invalid positions are not drawn', () => {
  const patches = [
    {positionTime:undefined},{positionTime:null},{positionTime:''},{positionTime:'bad'},
    {positionTime:new Date(now+1).toISOString()},
    {latitude:91},{latitude:-91},{latitude:NaN},{latitude:'26.3'},
    {longitude:181},{longitude:Infinity},{longitude:null},
  ];
  for (const patch of patches) {
    const state = tankerPresentation({...record,...patch},now);
    assert.equal(state.visible,false);
    assert.equal(state.point,null);
    assert.equal(tankerSvg(state),'');
  }
  for (const invalid of [null,undefined,{},NaN,Infinity]) {
    assert.equal(tankerPresentation(record,invalid).visible,false);
  }
  assert.equal(tankerPresentation(null,now).visible,false);
});

test('type metadata has its own clock and cannot refresh a position', () => {
  for (const [at,status] of [
    ['bad','invalid_time'],['','invalid_time'],
    [new Date(now+1).toISOString(),'future'],
    [new Date(now-86400000).toISOString(),'expired'],
  ]) {
    const state = tankerPresentation({...record,shipTypeObservedAt:at},now);
    assert.equal(state.visible,false);
    assert.equal(state.typeStatus,status);
    assert.equal(state.ageSeconds,60);
  }
  assert.equal(tankerPresentation({...record,shipTypeObservedAt:new Date(now-86399999).toISOString()},now).visible,true);
  const expired = tankerPresentation({...record,positionTime:new Date(now-1800000).toISOString(),shipTypeObservedAt:new Date(now).toISOString()},now);
  assert.equal(expired.visible,false);
  assert.equal(expired.expired,true);
});

test('undated same-provider type is usable but undated cross-provider type is not', () => {
  const same = {...record,shipTypeObservedAt:null,shipTypeProvider:record.provider};
  assert.equal(tankerPresentation(same,now).visible,true);
  const cross = tankerPresentation({...same,shipTypeProvider:'Other synthetic source'},now);
  assert.equal(cross.visible,false);
  assert.equal(cross.typeStatus,'undated_other_provider');
  const dated = tankerPresentation({...record,shipTypeProvider:'Other synthetic source'},now);
  assert.equal(dated.visible,true);
});

test('receipt and unverified provider timestamps are disclosed without claiming live observation', () => {
  const received = tankerPresentation({...record,timestampBasis:'received'},now);
  assert.equal(received.timestampBasis,'received');
  assert.match(received.timestampLabel,/Original receipt time; upstream observation time unavailable/);
  const provider = tankerPresentation(record,now);
  assert.match(provider.timestampLabel,/observation or last-heard basis requires source verification/);
  const unknown = tankerPresentation({...record,timestampBasis:'guessed'},now);
  assert.equal(unknown.timestampBasis,'unknown');
  assert.match(unknown.timestampLabel,/basis unavailable/);
});

test('fresh static metadata or a repeated coordinate does not imply movement', () => {
  const first = tankerPresentation(record,now);
  const staticUpdate = tankerPresentation({...record,shipTypeObservedAt:new Date(now).toISOString(),receivedAt:new Date(now).toISOString()},now);
  assert.deepEqual(staticUpdate,first);
  const repeat = tankerPresentation({...record,positionTime:new Date(now).toISOString()},now);
  assert.deepEqual(repeat.point,first.point);
  assert.equal(repeat.bearingDegrees,first.bearingDegrees);
  assert.equal(tankerSvg(repeat),tankerSvg(first));
  assert.equal(repeat.ageSeconds,0);
  const moved = tankerPresentation({...record,longitude:56.51,positionTime:new Date(now).toISOString()},now);
  assert.deepEqual(moved.point,[56.51,26.3]);
  assert.deepEqual(first.point,[56.5,26.3]);
});

test('presentation is deterministic, does not mutate input, and returns independent coordinates', () => {
  const first = tankerPresentation(record,now);
  assert.deepEqual(first,tankerPresentation(record,now));
  first.point[0] = 1;
  assert.equal(record.longitude,56.5);
  assert.deepEqual(tankerPresentation(record,now).point,[56.5,26.3]);
});

test('SVG stays within a fixed illustrative size and has no active content or vessel text', () => {
  const state = tankerPresentation({...record,name:'<script>alert(1)</script>'},now);
  const svg = tankerSvg(state);
  assert.equal(svg,tankerSvg(state));
  assert.match(svg,/width="32" height="32"/);
  assert.match(svg,/viewBox="-112 -112 224 224"/);
  assert.match(svg,/data-illustrative-scale="true"/);
  assert.match(svg,/data-tanker-part="hull"/);
  assert.match(svg,/data-tanker-part="wheelhouse"/);
  assert.match(svg,/aria-hidden="true" focusable="false"/);
  assert.doesNotMatch(svg,/NaN|Infinity|undefined|<script|<animate|animateMotion|<foreignObject|\son\w+=|href=|alert/);
  for (const [size,expected] of [[1,24],[99,36],[24,24],[36,36],[NaN,32],['30',32]]) {
    assert.match(tankerSvg(state,{size}),new RegExp(`width="${expected}" height="${expected}"`));
  }
  assert.equal(tankerSvg(null),'');
});

test('stale appearance changes without altering position or orientation', () => {
  const current = tankerPresentation(record,now);
  const stale = tankerPresentation(record,now+600000);
  assert.deepEqual(stale.point,current.point);
  assert.equal(stale.bearingDegrees,current.bearingDegrees);
  assert.match(tankerSvg(stale),/data-stale="true"/);
  assert.match(tankerSvg(stale),/opacity="0.62"/);
  assert.match(tankerSvg(current),/data-stale="false"/);
});


test('last-message snapshots never become moving tanker models despite fresh clocks and valid heading',()=>{
 for(const input of [{...record,provider:'Open Waters'},{...record,positionEvidence:'snapshot'}]){
  const state=tankerPresentation(input,now);assert.equal(state.visible,false);assert.equal(state.point,null);assert.equal(tankerSvg(state),'');
 }
});
