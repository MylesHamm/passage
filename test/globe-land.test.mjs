import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLandTester, waterSafeSegments} from '../dist/globe/renderer.mjs';
import {ROUTES} from '../dist/globe/geometry.mjs';
import '../dist/vendor/d3-7.9.0.min.js';

const d3 = globalThis.d3;

test('spherical land bounds preserve exact containment at coastlines, poles and the antimeridian', () => {
  for (const center of [[179, 0], [0, 85], [0, -85], [45, 20]]) {
    const polygon = d3.geoCircle().center(center).radius(10).precision(2)();
    const feature = {type: 'Feature', geometry: polygon};
    const containsLand = createLandTester([feature], d3);
    const points = [[-180, 0], [180, 0], [0, -90], [0, 90]];
    for (let longitude = -180; longitude <= 180; longitude += 15) {
      for (let latitude = -90; latitude <= 90; latitude += 15) points.push([longitude, latitude]);
    }
    for (const [longitude, latitude] of polygon.coordinates[0]) {
      for (const delta of [-1e-4, -1e-6, 0, 1e-6, 1e-4]) {
        points.push([longitude + delta, latitude], [longitude, latitude + delta]);
      }
    }
    for (const point of points) {
      if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) continue;
      assert.equal(containsLand(point), d3.geoContains(feature, point), `${center}: ${point}`);
    }
  }
});

test('land bounds preserve MultiPolygon containment and both representations of the antimeridian', () => {
  const a = d3.geoCircle().center([179, 0]).radius(10)();
  const b = d3.geoCircle().center([45, 20]).radius(5)();
  const geometry = {type: 'MultiPolygon', coordinates: [a.coordinates, b.coordinates]};
  const containsLand = createLandTester([geometry], d3);
  for (const point of [[-180, 0], [180, 0], [-179, 0], [179, 0], [45, 20], [0, 0]]) {
    assert.equal(containsLand(point), d3.geoContains(geometry, point));
  }
});

test('unsupported geometry and invalid or unavailable bounds fall back to exact containment', () => {
  const polygon = {type: 'Polygon', coordinates: []};
  const invalidBounds = [null, [[NaN, 0], [1, 1]], [[0, 2], [1, 1]], [[-181, 0], [1, 1]], [[0, 0]]];
  for (const bounds of invalidBounds) {
    let calls = 0;
    const containsLand = createLandTester([polygon], {geoBounds: () => bounds, geoContains: () => { calls++; return true; }});
    assert.equal(containsLand([150, 50]), true);
    assert.equal(calls, 1);
  }
  for (const geometry of [polygon, {type: 'GeometryCollection', geometries: []}]) {
    const containsLand = createLandTester([geometry], {
      geoBounds: () => { throw new Error('Bounds unavailable'); }, geoContains: () => true,
    });
    assert.equal(containsLand([150, 50]), true);
  }
  assert.equal(createLandTester([polygon], {geoContains: () => true})([150, 50]), true);
});

test('route safety keeps all 128 samples and omits an interior land crossing', () => {
  const samples = [];
  const interpolate = {geoInterpolate: () => t => [t, 0]};
  assert.equal(waterSafeSegments([[0, 0], [1, 0]], [], interpolate, point => { samples.push(point[0]); return false; }).length, 1);
  assert.deepEqual(samples, Array.from({length: 128}, (_, i) => (i + 1) / 128));
  assert.deepEqual(waterSafeSegments([[0, 0], [1, 0]], [], interpolate, ([longitude]) => longitude === 47 / 128), []);
});

test('bounded route checks still omit land crossings including a wrapped route', () => {
  const island = d3.geoCircle().center([0, 0]).radius(2)();
  assert.deepEqual(waterSafeSegments([[-10, 0], [10, 0], [20, 0]], [island], d3), [
    {type: 'LineString', coordinates: [[10, 0], [20, 0]]},
  ]);
  const wrappedIsland = d3.geoCircle().center([179, 0]).radius(5)();
  assert.deepEqual(waterSafeSegments([[160, 0], [-160, 0]], [wrappedIsland], d3), []);
});

test('current reference routes keep exact land decisions within a bounded containment-call budget', async () => {
  const world = JSON.parse(await readFile(new URL('../dist/assets/world-land.json', import.meta.url), 'utf8'));
  let boundsCalls = 0, exactCalls = 0;
  const counted = {
    geoBounds(feature) { boundsCalls++; return d3.geoBounds(feature); },
    geoContains(feature, point) { exactCalls++; return d3.geoContains(feature, point); },
    geoInterpolate: d3.geoInterpolate,
  };
  const containsLand = createLandTester(world.features, counted);
  const actual = ROUTES.map(route => waterSafeSegments(route.coordinates, world.features, counted, containsLand));
  const expected = ROUTES.map(route => waterSafeSegments(route.coordinates, world.features, d3, point => world.features.some(feature => d3.geoContains(feature, point))));
  assert.deepEqual(actual, expected);
  assert.deepEqual(actual.map(segments => segments.length), [15, 11, 8]);
  assert.equal(boundsCalls, world.features.length);
  assert.ok(exactCalls < 10000, `Expected fewer than 10,000 exact containment checks, received ${exactCalls}`);
});
