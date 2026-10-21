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
