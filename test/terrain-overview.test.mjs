import test from 'node:test';
import assert from 'node:assert/strict';
import {SCENES} from '../dist/terrain/geometry.mjs';
import {createPlanRenderer} from '../dist/terrain/renderer.mjs';
import {OVERVIEW_REGIONS, OVERVIEW_POSE, overviewLayers, nextOverviewVesselChange, overviewReadiness, overviewVesselCaption, loadOverviewPlans} from '../dist/terrain/overview.mjs';

const NOW = Date.parse('2026-10-20T18:00:00Z');
const position = (id, scene, age=60000, extra={}) => ({
  mmsi:id, name:'Received '+id, longitude:scene.center[0], latitude:scene.center[1],
  theater:scene.id, positionTime:new Date(NOW-age).toISOString(), ...extra,
});
function plan(scene, width=600, height=190){
  const ctx = {setTransform(){}, fillRect(){}, drawImage(){}};
  const canvas = {getContext:type => type === '2d' ? ctx : null};
  const renderer = createPlanRenderer(canvas);
  renderer.setScene(scene, {planImage:{}});renderer.resize(width, height);renderer.draw(OVERVIEW_POSE);
  return renderer;
}

test('Both provides two distinct regional frames with both centres inside desktop and mobile panes', () => {
  assert.deepEqual(OVERVIEW_REGIONS, ['hormuz', 'bab']);
  for(const [width, height] of [[640,190], [356,128], [286,128]]){
    for(const id of OVERVIEW_REGIONS){
      const scene = SCENES[id], renderer = plan(scene, width, height), centre = renderer.point(scene.center);
      assert.equal(centre.visible, true, `${id} centre visible at ${width}px`);
      assert.equal(centre.x, width/2);assert.equal(centre.y, height/2);
      const other = SCENES[id === 'hormuz' ? 'bab' : 'hormuz'];
      assert.equal(renderer.point(other.center).visible, false, 'the other region belongs in its own pane');
    }
  }
});

test('received vessel markers use each frame, reject invalid times and retain the ten-minute age distinction', () => {
  const scene = SCENES.hormuz, renderer = plan(scene);
  const vessels = [
    position('current', scene, 599999, {courseDegrees:0}),
    position('older', scene, 600000, {headingDegrees:90}),
    position('last-minute', scene, 1799999),
    position('expired', scene, 1800000),
    position('future', scene, -1),
    position('missing-time', scene, 1, {positionTime:null}),
    position('invalid-coordinate', scene, 1, {latitude:NaN}),
    position('wrong-region', scene, 1, {theater:'bab'}),
    position('off-map', scene, 1, {longitude:0, latitude:0}),
    position('other-pane', SCENES.bab),
  ];
  const layers = overviewLayers({scene, project:point => renderer.point(point), vessels, showVessels:true, now:NOW});
  assert.deepEqual(layers.map(item => item.id), ['current', 'older', 'last-minute']);
  assert.deepEqual(layers.map(item => item.older), [false, true, true]);
  assert.equal(layers[0].bearing, 0);assert.equal(layers[1].bearing, 90);
  assert.equal(layers[2].bearing, undefined, 'missing direction must remain missing');
  const bab = plan(SCENES.bab);
  assert.deepEqual(overviewLayers({scene:SCENES.bab, project:point => bab.point(point), vessels, showVessels:true, now:NOW}).map(item => item.id), ['other-pane']);
  assert.deepEqual(overviewLayers({scene, project:point => renderer.point(point), vessels, showVessels:false, now:NOW}), []);
});

test('unknown vessel direction is not invented and duplicate source identities produce one marker', () => {
  const scene = SCENES.hormuz, renderer = plan(scene);
  const vessels = [position('unknown', scene, 500, {courseDegrees:360, headingDegrees:511}), position('unknown', scene)];
  const rows = overviewLayers({scene, project:point => renderer.point(point), vessels, showVessels:true, now:NOW});
  assert.equal(rows.length, 1);assert.equal(rows[0].bearing, undefined);
});

test('fresh snapshot message clocks cannot place last-known coordinates on current regional maps', () => {
  const scene=SCENES.hormuz,renderer=plan(scene);
  const vessels=[position('legacy-snapshot',scene,1000,{provider:'Open Waters'}),
    position('explicit-snapshot',scene,1000,{provider:'Test snapshot',positionEvidence:'snapshot'})];
  assert.deepEqual(overviewLayers({scene,project:p=>renderer.point(p),vessels,showVessels:true,now:NOW}),[]);
});
test('off-frame positions do not consume the marker display limit', () => {
  const scene = SCENES.hormuz, renderer = plan(scene);
  const outside = Array.from({length:300}, (_,i) => position('outside-'+i, scene, 1000, {longitude:0, latitude:0}));
  const visible = Array.from({length:260}, (_,i) => position('visible-'+i, scene));
  const rows = overviewLayers({scene, project:point => renderer.point(point), vessels:[...outside, ...visible], showVessels:true, now:NOW});
  assert.equal(rows.length, 250);
  assert.equal(rows[0].id, 'visible-0');assert.equal(rows.at(-1).id, 'visible-249');
});

test('infrastructure and events require genuine coordinates, matching region and visible projection', () => {
  const scene = SCENES.bab, renderer = plan(scene);
  const location = {longitude:scene.center[0], latitude:scene.center[1]};
  const infrastructure = [
    {id:'port', name:'Reference port', ...location, theaters:['bab']},
    {id:'wrong-port', ...location, theaters:['hormuz']},
    {id:'missing-coordinate', name:'Text-only place', theaters:['bab']},
    {id:'distant-port', longitude:0, latitude:0},
  ];
  const events = [
    {id:'event', title:'Provider event', ...location, theaters:['bab']},
    {id:'wrong-event', ...location, theater:'hormuz'},
    {id:'headline', title:'Mentions Bab el-Mandeb without a position'},
  ];
  const layers = overviewLayers({scene, project:point => renderer.point(point), infrastructure, events, now:NOW});
  assert.deepEqual(layers.map(item => [item.kind, item.id]), [['infrastructure','port'], ['event','event']]);
});

test('age boundary scheduling turns markers hollow and removes expired positions without polling', () => {
  const scene = SCENES.hormuz;
  assert.equal(nextOverviewVesselChange([position('a', scene, 599999)], NOW), 2);
  assert.equal(nextOverviewVesselChange([position('a', scene, 600000)], NOW), 1200001);
  assert.equal(nextOverviewVesselChange([position('a', scene, 1799999)], NOW), 2);
  assert.equal(nextOverviewVesselChange([position('expired', scene, 1800000), position('future', scene, -1)], NOW), null);
  assert.equal(nextOverviewVesselChange([], NOW), null);
});

test('a failed regional asset leaves the other plan usable and reports partial availability', async () => {
  const calls = [], delivered = [];
  const results = await loadOverviewPlans({load:async (scene, options) => {
    calls.push({id:scene.id, planOnly:options.planOnly});
    if(scene.id === 'bab') throw Error('Reference image unavailable');
    return {planImage:{label:scene.name}};
  }, onRegion:result => delivered.push(result.id)});
  assert.deepEqual(calls, [{id:'hormuz',planOnly:true}, {id:'bab',planOnly:true}]);
  assert.deepEqual(new Set(delivered), new Set(OVERVIEW_REGIONS));
  assert.equal(results[0].status, 'ready');assert.equal(results[0].assets.planImage.label, 'Strait of Hormuz');
  assert.equal(results[1].status, 'unavailable');assert.match(results[1].error, /unavailable/);
  assert.equal(overviewReadiness(results), 'partial');
});

test('overview readiness distinguishes pending, complete and completely unavailable reference maps', () => {
  assert.equal(overviewReadiness([{status:'ready'}, {status:'loading'}]), 'loading');
  assert.equal(overviewReadiness([{status:'ready'}, {status:'ready'}]), 'ready');
  assert.equal(overviewReadiness([{status:'unavailable'}, {status:'unavailable'}]), 'unavailable');
});


test('frame reception caption distinguishes failures, pending and paused data from an empty result', () => {
  assert.equal(overviewVesselCaption(), 'Received AIS layer off');
  assert.match(overviewVesselCaption({showVessels:true}), /Checking vessel reception.*not established/);
  for(const [status, heading] of [['unavailable','Vessel update unavailable'], ['paused','Vessel refresh paused'], ['disabled','Vessel sources not enabled']]){
    assert.match(overviewVesselCaption({showVessels:true, availability:{status,heading}}), new RegExp(heading));
    assert.match(overviewVesselCaption({showVessels:true, count:2, availability:{status,heading}}), /2 previously received/);
  }
  assert.equal(overviewVesselCaption({showVessels:true, availability:{status:'available'}}), 'No matching received positions in this frame');
  assert.match(overviewVesselCaption({showVessels:true, count:1, availability:{status:'available'}}), /^1 received position in this frame/);
});
