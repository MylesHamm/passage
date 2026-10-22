import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SCENES} from '../dist/terrain/geometry.mjs';
import {atSea,nearestSea,sampleLongitudeLatitude} from '../dist/terrain/sea.mjs';
import {statedPosition,landOn} from '../lib/sea-placement.mjs';

const heights=id=>new Uint16Array(readFileSync(new URL(`../dist/terrain/assets/${id}-dem.bin`,import.meta.url)).buffer.slice(0));
const hormuz={scene:SCENES.hormuz,heights:heights('hormuz')},theatre={scene:SCENES.theatre,heights:heights('theatre')};
const KHASAB=[56.2475,26.1797],STRAIT=[56.4,26.55];

test('grid samples map back to their own place',()=>{
  const [lon,lat]=sampleLongitudeLatitude(0,0,SCENES.hormuz);
  assert.ok(Math.abs(lon-(166/256*360-180))<1e-9&&lat>29&&lat<30);
});

test('a town on land moves to the nearest water; open water stays put',()=>{
  assert.equal(atSea(KHASAB,hormuz.scene,hormuz.heights),false);
  const moved=nearestSea(KHASAB,hormuz.scene,hormuz.heights);
  assert.equal(moved.moved,true);assert.ok(moved.distanceNm<5,`moved ${moved.distanceNm} nm`);
  assert.equal(atSea(moved.point,hormuz.scene,hormuz.heights),true);
  const clear=nearestSea([56.35,25.3333],hormuz.scene,hormuz.heights,{clearanceKm:4});
  assert.ok(clear.moved&&clear.distanceNm<8,'Khor Fakkan moves a few miles offshore, into open water');
  assert.deepEqual(nearestSea(STRAIT,hormuz.scene,hormuz.heights),{point:STRAIT,moved:false,distanceNm:0});
  assert.equal(nearestSea([40,15],hormuz.scene,hormuz.heights),null,'outside the grid');
  assert.equal(nearestSea([45,24],theatre.scene,theatre.heights,{maxNm:15}),null,'central Arabia has no sea nearby');
});

test('the stated bearing and distance is read from inside longer place text',()=>{
  const stated=statedPosition('Strait of Hormuz, about 20 nm northeast of Khasab');
  assert.equal(stated.reference,'Khasab');assert.ok(stated.lat>26.3&&stated.lon>56.4);
  assert.ok(statedPosition('About 11 nm west of Bukha, Musandam'));
  assert.equal(statedPosition('Strait of Hormuz off Khasab, Musandam'),null,'no distance, no position');
  assert.equal(statedPosition('Gulf of Oman north-east of Khor Fakkan'),null);
});

test('curated ship attacks use the position their report states',()=>{
  const data=JSON.parse(readFileSync(new URL('../dist/data/war-events.json',import.meta.url),'utf8'));
  for(const event of data.events.filter(e=>e.layer==='shipping')){
    const stated=statedPosition(event.place);
    if(stated)assert.ok(Math.abs(stated.lat-event.lat)<.01&&Math.abs(stated.lon-event.lon)<.01,`${event.id}: run node scripts/events/apply-offsets.mjs`);
  }
  assert.deepEqual(landOn(STRAIT),[]);
});
