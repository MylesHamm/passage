import test from 'node:test';
import assert from 'node:assert/strict';
import { visiblePoint, poseBetween, eligibleVessels, THEATRES, ROUTES } from '../dist/globe/geometry.mjs';
import { waterSafeSegments } from '../dist/globe/renderer.mjs';

test('globe hides the far hemisphere and keeps selected chokepoints visible',()=>{
  for(const id of ['bab','hormuz'])assert.equal(visiblePoint(THEATRES[id].point,THEATRES[id].rotation),true);
  assert.equal(visiblePoint([-136.67,-12.58],THEATRES.bab.rotation),false);
});
test('camera returns across the shortest longitude arc without a full-world spin',()=>{
  const from={rotation:[179,0,0],zoom:1},to={rotation:[-179,-10,0],zoom:3};
  const mid=poseBetween(from,to,.5);assert.equal(mid.rotation[0],180);assert.equal(mid.zoom,2);
  assert.equal(poseBetween(from,to,1).rotation[0],181);
  assert.deepEqual(poseBetween(from,to,-1),from);
  assert.equal(poseBetween({rotation:[1080,0,0],zoom:1},{rotation:[-45,0,0],zoom:1},1).rotation[0],1035);
});
test('globe never adds expired, invalid, future or out-of-theatre vessel positions',()=>{
  const now=Date.parse('2026-09-13T20:00:00Z'),base={latitude:12.58,longitude:43.33,theater:'bab',positionTime:'2026-09-13T19:50:00Z'};
  const list=[{...base,mmsi:'fresh'},{...base,mmsi:'expired',positionTime:'2026-09-13T19:30:00Z'},
    {...base,mmsi:'future',positionTime:'2026-09-13T20:01:00Z'},{...base,mmsi:'bad',latitude:NaN},
    {...base,mmsi:'missing',positionTime:null},{...base,mmsi:'other',theater:'hormuz'}];
  assert.deepEqual(eligibleVessels(list,'bab',now).map(v=>v.mmsi),['fresh']);
  assert.deepEqual(eligibleVessels(list,'both',now).map(v=>v.mmsi),['fresh','other']);
});
test('reference corridors use coastal waypoints around the two chokepoints',()=>{
  assert.deepEqual(ROUTES[0].coordinates.slice(0,6),[[32.6,29.2],[32.8,28.8],[33,28.3],[33.2,28],[33.6,27.5],[34,26.8]]);
  assert.deepEqual(ROUTES[1].coordinates.slice(2,8),[[52.5,26.7],[54,26.4],[56.25,26.57],[57,26],[58,24],[59.5,24]]);
});
test('globe omits a route leg when its interior intersects land',()=>{
  const d3={geoInterpolate:(a,b)=>t=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],geoContains:(_,point)=>point[0]>4&&point[0]<6&&point[1]>-1&&point[1]<1};
  assert.deepEqual(waterSafeSegments([[0,0],[10,0],[20,0]],[{}],d3),[{type:'LineString',coordinates:[[10,0],[20,0]]}]);
});
