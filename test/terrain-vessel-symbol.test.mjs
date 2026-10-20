import test from 'node:test';
import assert from 'node:assert/strict';
import {vesselDirection, vesselSymbol, projectedVesselAngle} from '../dist/terrain/vessel-symbol.mjs';
import {SCENES, cameraMatrix, defaultPose, geographicPoint, project} from '../dist/terrain/geometry.mjs';

const now = Date.parse('2026-10-20T18:00:00Z');
const vessel = {mmsi:'999000001', name:'Test only', shipTypeCode:80, shipType:'tanker',
  latitude:26.57, longitude:56.25, theater:'hormuz', positionTime:new Date(now-60000).toISOString(),
  headingDegrees:90, courseDegrees:100};

test('model rendering stays disabled unless explicitly supplied by the review harness', () => {
  const normal = vesselSymbol(vessel, {now});
  assert.equal(normal.model, false);assert.equal(normal.svg, '');assert.equal(normal.glyph, '▲');
  assert.equal(vesselSymbol(vessel, {now, tankerModels:true}).model, true);
});

test('dense maps reuse static image data without copying detailed SVG DOM per vessel', () => {
  const first=vesselSymbol(vessel,{now,tankerModels:true}).svg;
  assert.match(first,/^<img /);assert.doesNotMatch(first,/<path|<g /);
  for(let i=0;i<250;i++)assert.equal(vesselSymbol({...vessel,mmsi:String(999000001+i),headingDegrees:i%360},{now,tankerModels:true}).svg,first);
});

test('heading wins; unavailable AIS heading uses disclosed course and never a sentinel direction', () => {
  assert.deepEqual(vesselDirection(vessel), {degrees:90,basis:'heading'});
  assert.deepEqual(vesselDirection({...vessel,headingDegrees:511}), {degrees:100,basis:'course'});
  const fallback = vesselSymbol({...vessel,headingDegrees:511}, {now});
  assert.match(fallback.description, /Course over ground; heading unavailable/);
  for(const value of [null,undefined,NaN,-1,360,511,'90']){
    const result = vesselSymbol({...vessel,headingDegrees:value,courseDegrees:360}, {now});
    assert.equal(result.bearing, null);assert.equal(result.glyph, '●');
  }
  assert.equal(vesselDirection({...vessel,headingDegrees:0}).degrees, 0);
});

test('orientation follows projected geography as the terrain camera turns', () => {
  for(const yaw of [-.6,0,.6]){
    const scene=SCENES.hormuz, matrix=cameraMatrix({...defaultPose(),yaw},scene,800,280).matrix;
    const point=coordinates=>project(geographicPoint(coordinates,scene,.55),matrix,800,280);
    const east=projectedVesselAngle(vessel,90,point),north=projectedVesselAngle(vessel,0,point);
    assert.ok(Number.isFinite(east));assert.ok(Number.isFinite(north));
    assert.ok(Math.abs(east-north)>30, 'north and east remain distinguishable');
  }
  assert.equal(projectedVesselAngle(vessel,null,()=>{throw Error('must not invent a point');}),null);
});
