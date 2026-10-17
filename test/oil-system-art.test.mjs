import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildOilSystemState } from '../dist/oil-system-model.mjs';
import { oilSystemArt } from '../dist/oil-system-art.mjs';
import { systemGeometry } from '../dist/oil-system-geometry.mjs';

test('Anatomy projection preserves the accepted common camera and finite geometry', () => {
  const g = systemGeometry();
  for (const [x, y, z] of [[0, 0, 0], [18, -87, 12], [-34, 25, 49], [0, 0, -8]]) {
    const [sx, sy] = g.point(x, y, z);
    assert.ok(Math.abs(sx - .9 * (x - y)) < 1e-10);
    assert.ok(Math.abs(sy - (.42 * (x + y) - z - 6)) < 1e-10);
  }
  const shapes = [g.box(-2, -3, 10, 12, 0, 8), g.hatch(2, 3, 4, 0, 2), g.cylinder(0, 0, 12, 2, 30)];
  for (const shape of shapes) {
    assert.doesNotMatch(shape, /NaN|Infinity|undefined/);
    assert.match(shape, /class="iso-solid/);
    assert.match(shape, /class="iso-shade"/);
    assert.match(shape, /class="iso-top"/);
  }
});

test('four conceptual objects have one stable hook each and no directional price connector', () => {
  const model = buildOilSystemState({ selected: 'transport' });
  const svg = oilSystemArt(model.stages);
  for (const id of ['supply', 'transport', 'risk', 'benchmarks']) {
    assert.equal((svg.match(new RegExp(`data-system-part="${id}"`, 'g')) || []).length, 1);
  }
  assert.equal((svg.match(/class="system-part is-selected/g) || []).length, 1);
  assert.match(svg, /Highlighting follows the reader.s selection, not source verification/);
  assert.match(svg, /not live flow or a price forecast/);
  assert.doesNotMatch(svg, /system-art-connector|marker-end|animateMotion|stroke-dasharray|USD\/barrel|\$\d/);
  assert.doesNotMatch(svg, /NaN|Infinity|undefined/);
});

test('cargo cutaway is schematic, deterministic and does not change observed prices', () => {
  const input = { selected: 'transport', oil: { series: [{ id: 'brent', observations: [{ date: '2026-10-01', value: 70 }] }] }, now: Date.parse('2026-10-03') };
  const closed = buildOilSystemState(input), open = buildOilSystemState({ ...input, expanded: true });
  const art = oilSystemArt(open.stages);
  assert.deepEqual(open.prices, closed.prices);
  assert.equal(art, oilSystemArt(open.stages));
  assert.match(art, /system-inspection-deck/);
  assert.match(art, /system-cargo-inside/);
  assert.equal((art.match(/class="system-cargo-cell"/g) || []).length, 12);
  assert.doesNotMatch(art, /fill-level|data-volume|barrels/);
  assert.doesNotMatch(art.replace(/<[^>]+>/g, ''), /\b70(?:\.00)?\b/);
});

test('titles are escaped and code is locally sourced with retained license', async () => {
  const stages = buildOilSystemState().stages.map(s => ({ ...s, title: '<script>"unsafe"</script>' }));
  assert.doesNotMatch(oilSystemArt(stages), /<script>|"unsafe"/);
  const core = await readFile(new URL('../dist/vendor/anatomy/iso-kit.mjs', import.meta.url));
  assert.equal(createHash('sha256').update(core).digest('hex'), '6d3ecc725d30c3b0346da309cf61dfa5a65017c23620bbd4093009d4fb104018');
  const license = await readFile(new URL('../dist/vendor/anatomy/LICENSE.txt', import.meta.url), 'utf8');
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Ryan/);
});

test('cutaway motion follows explicit separation and has a reduced-motion override', async () => {
  const css = await readFile(new URL('../dist/oil-system-anatomy.css', import.meta.url), 'utf8');
  assert.match(css, /:has\(\.system-toggle\[aria-pressed="true"\]\)/);
  assert.match(css, /\[data-motion="on"\] \.system-inspection-deck/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /transition: none/);
  assert.doesNotMatch(css, /@keyframes|animation:/);
});
