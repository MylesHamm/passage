import test from 'node:test';
import assert from 'node:assert/strict';
import { groupMarkers, groupAction, GROUP_PX, FRONTS } from '../dist/ops/theatre-map.mjs';

const point = (id, x, y, date = '2026-10-01') => ({ event: { id, date }, x, y });

test('markers that would overlap on screen form one group led by the newest event', () => {
  const groups = groupMarkers([point('a', 100, 100, '2026-10-01'), point('b', 108, 104, '2026-10-05'), point('c', 300, 100)]);
  assert.equal(groups.length, 2);
  const [first] = groups;
  assert.deepEqual(first.members.map(m => m.event.id), ['b', 'a'], 'the newest event leads');
  assert.equal(first.x, 108);
});

test('the selected event always stands alone', () => {
  const groups = groupMarkers([point('a', 100, 100), point('b', 101, 100), point('c', 102, 100)], { selected: 'a' });
  const solo = groups.find(g => g.members.some(m => m.event.id === 'a'));
  assert.equal(solo.members.length, 1);
  assert.equal(groups.find(g => g !== solo).members.length, 2, 'the others still group with each other');
});

test('a tap also zooms in when that separates the markers, but not when they share one place', () => {
  const spread = { x: 100, y: 100, members: [point('a', 100, 100), point('b', 104, 100)] };
  const zoom = groupAction(spread, 1);
  assert.equal(zoom.kind, 'zoom'); assert.ok(zoom.zoom * 4 >= GROUP_PX, 'far enough to separate');
  assert.deepEqual(groupAction({ x: 0, y: 0, members: [point('a', 0, 0), point('b', 0, 0)] }, 1), { kind: 'list' }, 'one place cannot separate');
  assert.deepEqual(groupAction(spread, 7.5), { kind: 'list' }, 'already close: list instead of zooming past the limit');
  assert.ok(FRONTS.hormuz && FRONTS['red-sea']);
});

test('the opening view frames every event clear of the overlays, on a desktop and a phone', async () => {
  const { fitPose, MIN_ZOOM } = await import('../dist/ops/theatre-map.mjs');
  const { SCENES, geographicPoint, cameraMatrix, project } = await import('../dist/terrain/geometry.mjs');
  // The outermost events: Tel Aviv, the Caspian coast, the northern Arabian Sea and Bab el-Mandeb.
  const points = [[34.78, 32.09], [49.46, 37.47], [62.32, 18], [43.33, 12.58], [56.3, 26.5]];
  for (const [width, height] of [[999, 552], [1400, 720], [353, 568]]) {
    const pose = fitPose(points, width, height);
    assert.ok(pose.zoom >= MIN_ZOOM, `${width}×${height} zoom ${pose.zoom}`);
    const { matrix } = cameraMatrix(pose, SCENES.theatre, width, height);
    for (const p of points) {
      const s = project(geographicPoint(p, SCENES.theatre, 0), matrix, width, height);
      assert.ok(s.x > 0 && s.x < width && s.y > Math.min(110, height * .24) - 1 && s.y < height, `${p} on screen at ${width}×${height}`);
    }
  }
  assert.equal(fitPose([], 999, 552).zoom, .92, 'no events keeps the default view');
});

test('the Hormuz map shows only the last week of events inside its own terrain', async () => {
  const { recentHormuzEvents, inHormuzScene } = await import('../dist/ops/hero-map.mjs');
  assert.equal(inHormuzScene([56.3, 26.5]), true, 'the strait');
  assert.equal(inHormuzScene([49.66, 27.0]), false, 'Jubail is on the regional map only');
  const now = Date.parse('2026-10-22T18:00:00Z');
  const event = (id, date, lon, lat) => ({ id, date, lon, lat });
  const shown = recentHormuzEvents([event('new', '2026-10-21', 56.15, 26.14), event('week', '2026-10-15', 56.35, 25.33), event('old', '2026-10-11', 56.3, 26.5), event('far', '2026-10-21', 49.8, 26.47), event('unplaced', '2026-10-21', null, null)], { now });
  assert.deepEqual(shown.map(e => e.id), ['new', 'week']);
});
