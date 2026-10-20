import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { iso } from '../dist/vendor/anatomy/iso-kit.mjs';
import {
  tankerFigure, tankerItems, kitAzimuthFor, kitElevationFor, screenBowDegrees, detailForLength,
  TANKER, UNITS_PER_METRE, DETAILS,
} from '../dist/terrain/ship-model.mjs';
import {
  shipSprite, localView, validHeading, spriteTransform, clearShipSprites, shipSpriteCacheSize, stepAzimuth,
  ELEVATION_BANDS, AZIMUTH_STEPS, DEFAULT_TILT_DEGREES,
} from '../dist/terrain/ship-sprites.mjs';
import { cameraMatrix, project, SCENES, defaultPose } from '../dist/terrain/geometry.mjs';

const AZIMUTHS = Array.from({ length: 24 }, (_, i) => i * 15);
const wrap = (deg) => ((deg % 360) + 540) % 360 - 180;
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(wrap(actual - expected)) <= tolerance, `${message}: ${actual} vs ${expected}`);

/** Minimal XML well-formedness: balanced tags, quoted attributes, nothing active. */
function assertWellFormedSvg(svg) {
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]* viewBox="0 0 \d+ \d+"/);
  assert.ok(svg.endsWith('</svg>'));
  assert.doesNotMatch(svg, /NaN|undefined|Infinity|null/);
  assert.doesNotMatch(svg, /<script|<foreignObject|\son[a-z]+=|href="(?!#)|url\((?!#)/i);
  const stack = [];
  for (const [tag, close, name, attrs, self] of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g)) {
    void tag;
    if (close) assert.equal(stack.pop(), name, `closing </${name}>`);
    else if (!self) stack.push(name);
    void attrs;
  }
  assert.deepEqual(stack, [], 'every element is closed');
  const stripped = svg.replace(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g, '').replace(/\.passage-ship [^<]*/, '');
  assert.doesNotMatch(stripped, /[<>]/, 'no malformed markup outside tags');
}

/** All drawn screen coordinates of a figure, in viewBox units. */
function drawnPoints(figure) {
  const [, tx, ty] = figure.svg.match(/<g transform="translate\((-?[\d.]+) (-?[\d.]+)\)"/).map(Number);
  const out = [];
  for (const [, d] of figure.svg.matchAll(/ d="([^"]*)"/g)) {
    for (const [, x, y] of d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) out.push([Number(x) + tx, Number(y) + ty]);
  }
  return out;
}

test('figures and sprites are deterministic', () => {
  for (const detail of DETAILS) {
    const a = tankerFigure({ azimuth: 37, elevation: 41, detail });
    const b = tankerFigure({ azimuth: 37, elevation: 41, detail });
    assert.equal(a.svg, b.svg);
    assert.deepEqual(a.anchor, b.anchor);
    assert.deepEqual(a.order, b.order);
  }
  clearShipSprites();
  const first = shipSprite({ headingDegrees: 123, cameraYawDegrees: 8, cameraTiltDegrees: 40, lengthPx: 72 });
  clearShipSprites();
  const second = shipSprite({ headingDegrees: 123, cameraYawDegrees: 8, cameraTiltDegrees: 40, lengthPx: 72 });
  assert.deepEqual(first, second);
});

test('figures are well-formed, self-contained SVG with no active content', () => {
  for (const [azimuth, elevation, detail] of [[45, 30, 'full'], [200, 70, 'mid'], [310, 20, 'low'], [0, 90, 'full']]) {
    const figure = tankerFigure({ azimuth, elevation, detail });
    assertWellFormedSvg(figure.svg);
    assert.match(figure.svg, new RegExp(`viewBox="0 0 ${figure.width} ${figure.height}"`));
    assert.match(figure.svg, /aria-hidden="true"/);
    assert.ok(figure.svg.includes(`data-detail="${detail}"`));
  }
});

test('viewBox is tight around the drawing and the anchor is the projected waterline centre', () => {
  for (const azimuth of [0, 45, 90, 180, 270]) {
    for (const elevation of [20, 50, 80]) {
      const figure = tankerFigure({ azimuth, elevation, detail: 'full' });
      const points = drawnPoints(figure);
      const xs = points.map(([x]) => x); const ys = points.map(([, y]) => y);
      assert.ok(Math.min(...xs) >= -0.2 && Math.max(...xs) <= figure.width + 0.2, 'drawing inside the viewBox (x)');
      assert.ok(Math.min(...ys) >= -0.2 && Math.max(...ys) <= figure.height + 0.2, 'drawing inside the viewBox (y)');
      // Only the pad and the halo's blur sit outside the drawn paths.
      assert.ok(Math.min(...xs) < 10 && figure.width - Math.max(...xs) < 10, 'tight horizontally');
      assert.ok(Math.min(...ys) < 10 && figure.height - Math.max(...ys) < 10, 'tight vertically');
      assert.ok(figure.anchor.x > 0 && figure.anchor.x < figure.width && figure.anchor.y > 0 && figure.anchor.y < figure.height, 'anchor inside');
      // The anchor is iso([0, 0, 0]) under the same translation as the drawing.
      const P = { origin: [figure.anchor.x, figure.anchor.y], scale: 1, azimuth, elevation };
      const bow = iso([165.6, 0, 11], P); const stern = iso([-165, 0, 11], P);
      const midpoint = [(bow[0] + stern[0]) / 2, (bow[1] + stern[1]) / 2];
      const deckCentre = iso([0.3, 0, 11], P);
      assert.ok(Math.hypot(midpoint[0] - deckCentre[0], midpoint[1] - deckCentre[1]) < 1, 'anchor lies under the middle of the hull');
    }
  }
  const broadside = tankerFigure({ azimuth: 90, elevation: 30 });
  assert.ok(Math.abs(broadside.anchor.x - broadside.width / 2) < broadside.width * 0.08, 'broadside anchor is centred along the hull');
  assert.ok(Math.abs(broadside.lengthUnits - TANKER.lengthOverall * UNITS_PER_METRE) < 1e-9);
});

test('part counts: 40–80 real parts at full detail, fewer at small sizes', () => {
  const full = tankerFigure({ azimuth: 45, elevation: 35, detail: 'full' });
  const mid = tankerFigure({ azimuth: 45, elevation: 35, detail: 'mid' });
  const low = tankerFigure({ azimuth: 45, elevation: 35, detail: 'low' });
  assert.ok(full.partCount >= 40 && full.partCount <= 80, `full has ${full.partCount} parts`);
  assert.ok(mid.partCount < full.partCount && low.partCount < mid.partCount, `${low.partCount} < ${mid.partCount} < ${full.partCount}`);
  assert.ok(low.partCount >= 10, 'low keeps a full silhouette');
  for (const part of ['boot-top', 'topsides', 'bulb', 'forecastle', 'poop', 'windlass-P', 'windlass-S', 'bitts-P', 'bow-chock', 'foremast',
    'cargo-line-1', 'stripping-line', 'catwalk', 'hatch-1', 'hatch-15', 'manifold-P', 'manifold-valves-S', 'hose-crane-P', 'hose-crane-S',
    'house-lower', 'house-upper', 'wheelhouse', 'bridge-wing-P', 'bridge-wing-S', 'bridge-roof', 'radar-mast', 'radar-x', 'radar-s',
    'funnel', 'funnel-band', 'exhausts', 'lifeboat-P', 'davits-S']) assert.ok(full.parts.includes(part), `full detail draws ${part}`);
  for (const part of ['boot-top', 'topsides', 'forecastle', 'poop', 'house-lower', 'wheelhouse', 'funnel', 'funnel-band', 'radar-mast'])
    assert.ok(low.parts.includes(part), `low detail keeps ${part}`);
  for (const part of ['hatch-1', 'rail-P', 'bitts-P']) assert.ok(!mid.parts.includes(part), `mid drops ${part}`);
  // Exactly one lit accent: the bridge glass, inside the wheelhouse only.
  for (const figure of [full, mid, low]) {
    const groups = [...figure.svg.matchAll(/<g data-part="([^"]+)">(.*?)<\/g>/g)];
    const lit = groups.filter(([, , body]) => body.includes('#ffe4a3')).map(([, part]) => part);
    assert.deepEqual([...new Set(lit)], ['wheelhouse']);
  }
  assert.equal(detailForLength(44), 'low');
  assert.equal(detailForLength(60), 'mid');
  assert.equal(detailForLength(90), 'mid');
  assert.equal(detailForLength(200), 'full');
});

test('azimuth sweep 0–345 by 15 at three elevations: finite coordinates, every overlap ordered', () => {
  for (const detail of DETAILS) {
    for (const elevation of [20, 50, 80]) {
      for (const azimuth of AZIMUTHS) {
        const figure = tankerFigure({ azimuth, elevation, detail });
        assert.doesNotMatch(figure.svg, /NaN|undefined|Infinity/, `${detail} A${azimuth} E${elevation}`);
        assert.ok(Number.isFinite(figure.width) && Number.isFinite(figure.height) && figure.width > 0 && figure.height > 0);
        assert.ok(drawnPoints(figure).every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
        assert.deepEqual(figure.diagnostics.unresolved, [], `${detail} A${azimuth} E${elevation} unresolved pairs`);
        assert.deepEqual(figure.diagnostics.cycles, [], `${detail} A${azimuth} E${elevation} order cycles`);
      }
    }
    // Every figure the sprite cache can produce: 24 screen-spaced steps in each elevation band.
    for (const band of ELEVATION_BANDS) {
      for (let k = 0; k < AZIMUTH_STEPS; k++) {
        const figure = tankerFigure({ azimuth: stepAzimuth(k, band), elevation: band, detail });
        assert.doesNotMatch(figure.svg, /NaN|undefined|Infinity/);
        assert.deepEqual(figure.diagnostics.unresolved, [], `${detail} step ${k} E${band} unresolved pairs`);
        assert.deepEqual(figure.diagnostics.cycles, [], `${detail} step ${k} E${band} order cycles`);
      }
    }
  }
});

test('painter order: hull before deck parts, superstructure after the decks it stands on', () => {
  for (const azimuth of [0, 45, 135, 180, 225, 315]) {
    for (const elevation of [25, 60]) {
      const { items } = tankerItems({ azimuth, elevation, detail: 'full' });
      const where = `A${azimuth} E${elevation}`;
      const overlap = (a, b) => a.rect[0] < b.rect[2] && b.rect[0] < a.rect[2] && a.rect[1] < b.rect[3] && b.rect[1] < a.rect[3];
      // Wherever a part of `upper` overlaps a part of `lower` on screen, it is painted later.
      const paintedOver = (upper, lower, pick = () => true) => {
        let pairs = 0;
        items.forEach((u, i) => {
          if (u.part !== upper) return;
          items.forEach((l, j) => {
            if (l.part !== lower || !pick(l) || !overlap(u, l)) return;
            pairs++;
            assert.ok(i > j, `${where}: ${upper} painted over ${lower}`);
          });
        });
        return pairs;
      };
      assert.equal(items[0].part, 'boot-top', where);
      assert.ok(items.findIndex((i) => i.part === 'bulb') < items.findIndex((i) => i.part === 'topsides'), `${where}: bulb under the topsides`);
      for (const part of new Set(items.map((i) => i.part))) if (!['boot-top', 'bulb', 'topsides'].includes(part)) paintedOver(part, 'topsides');
      assert.ok(paintedOver('house-lower', 'poop') > 0, `${where}: house overlaps the poop deck`);
      for (const part of ['funnel', 'winch-P', 'stern-bitts-S', 'foam-monitor-P', 'davits-P', 'provision-crane', 'lifeboat-S']) paintedOver(part, 'poop');
      for (const part of ['windlass-P', 'bitts-S', 'bow-chock', 'foremast', 'bosun-hatch']) assert.ok(paintedOver(part, 'forecastle') > 0, `${where}: ${part} stands on the forecastle`);
      assert.ok(paintedOver('house-upper', 'house-lower') > 0, `${where}: upper tiers on the lower house`);
      assert.ok(paintedOver('wheelhouse', 'house-upper') > 0, `${where}: wheelhouse on the upper house`);
      assert.ok(paintedOver('bridge-roof', 'wheelhouse') > 0, `${where}: roof on the wheelhouse`);
      // The mast stands on the roof slab; the monkey-island rail around it may pass in front.
      assert.ok(paintedOver('radar-mast', 'bridge-roof', (item) => item.box[2] >= 33.99 && item.box[5] <= 34.46) > 0, `${where}: mast on the roof`);
      assert.ok(paintedOver('funnel-band', 'funnel') > 0 && paintedOver('exhausts', 'funnel-band') > 0, `${where}: funnel band and exhausts`);
      // The boat sits above its boat-deck platform; the davit frames at its ends may stand in front of it.
      assert.ok(paintedOver('lifeboat-P', 'davits-P', (item) => item.box[5] <= 19.41) > 0, `${where}: boat over its boat deck`);
      for (const part of ['cargo-line-1', 'hatch-7', 'catwalk', 'hose-crane-S']) paintedOver(part, 'topsides');
    }
  }
});

test('painter order never draws a nearer part before a farther part it overlaps (independent check)', () => {
  // A part may cover another only if no separating plane puts it behind that part.
  const behind = (a, b, V) => {
    let verdict = 0;
    for (let k = 0; k < 3; k++) {
      const below = a[k + 3] <= b[k] + 1e-6; const above = b[k + 3] <= a[k] + 1e-6;
      if (!below && !above) continue;
      if (Math.abs(V[k]) < 1e-9) return false;
      const aFarther = below ? V[k] > 0 : V[k] < 0;
      if (verdict && verdict !== (aFarther ? 1 : -1)) return false;
      verdict = aFarther ? 1 : -1;
    }
    return verdict === 1;
  };
  for (const azimuth of [10, 75, 160, 250, 330]) {
    for (const elevation of [22, 48, 76]) {
      const { items, view } = tankerItems({ azimuth, elevation, detail: 'full' });
      let checked = 0;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const [a, b] = [items[i], items[j]];
          if (a.layer !== b.layer) continue;
          const overlap = a.rect[0] < b.rect[2] && b.rect[0] < a.rect[2] && a.rect[1] < b.rect[3] && b.rect[1] < a.rect[3];
          if (!overlap) continue;
          checked++;
          assert.ok(!behind(b.box, a.box, view), `A${azimuth} E${elevation}: ${b.part} is behind ${a.part} but drawn after it`);
        }
      }
      assert.ok(checked > 100, 'enough overlapping pairs were examined');
    }
  }
});

test('camera relation: kit azimuth 180 − heading − yaw, elevation 90 − tilt, matches the terrain projection', () => {
  const scene = SCENES.hormuz;
  const [W, H] = [1000, 640];
  const angle = (a, b) => (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
  for (const yaw of [-34, -12, 0, 20, 34]) {
    for (const tilt of [20, 41.25, 54, 0.0057]) {
      const pose = { ...defaultPose(), yaw: (yaw * Math.PI) / 180, tilt: (tilt * Math.PI) / 180 };
      const { matrix } = cameraMatrix(pose, scene, W, H);
      for (const heading of [0, 33, 90, 145, 200, 271, 359]) {
        const h = (heading * Math.PI) / 180; const d = 0.4;
        // Terrain world: X east, Y up, Z south.
        const bow = project([Math.sin(h) * d, 0, -Math.cos(h) * d], matrix, W, H);
        const stern = project([-Math.sin(h) * d, 0, Math.cos(h) * d], matrix, W, H);
        const starboard = project([Math.cos(h) * d, 0, Math.sin(h) * d], matrix, W, H);
        const centre = project([0, 0, 0], matrix, W, H);
        const A = kitAzimuthFor({ headingDegrees: heading, cameraYawDegrees: yaw });
        const E = kitElevationFor(tilt);
        const where = `H${heading} yaw${yaw} tilt${tilt}`;
        near(screenBowDegrees(A, E), angle(stern, bow), 0.05, `${where} bow`);
        const P = { origin: [0, 0], scale: 1, azimuth: A, elevation: E };
        const k0 = iso([0, 0, 0], P); const ky = iso([0, 1, 0], P);
        if (tilt > 1) near((Math.atan2(ky[0] - k0[0], -(ky[1] - k0[1])) * 180) / Math.PI, angle(centre, starboard), 0.05, `${where} starboard (kit +y)`);
      }
    }
  }
});

test('a bow due north at camera yaw 0 points up the screen, and turning the camera turns the drawn bow', () => {
  assert.equal(kitAzimuthFor({ headingDegrees: 0, cameraYawDegrees: 0 }), 180);
  for (const tilt of [0, 20, 41.25, 54]) {
    const sprite = shipSprite({ headingDegrees: 0, cameraYawDegrees: 0, cameraTiltDegrees: tilt, lengthPx: 64 });
    assert.equal(sprite.azimuth, 180);
    near(sprite.bowScreenDegrees + sprite.rotationDeg, 0, 0.01, `north is up at tilt ${tilt}`);
  }
  // Top-down: the drawn bow turns clockwise by exactly the yaw, as the terrain does.
  const scene = SCENES.hormuz;
  for (const yaw of [-30, -10, 15, 30]) {
    const sprite = shipSprite({ headingDegrees: 0, cameraYawDegrees: yaw, cameraTiltDegrees: 0, lengthPx: 64 });
    near(sprite.bowScreenDegrees + sprite.rotationDeg, yaw, 0.01, `top-down yaw ${yaw}`);
    const { matrix } = cameraMatrix({ ...defaultPose(), yaw: (yaw * Math.PI) / 180, topDown: true }, scene, 900, 600);
    const s = project([0, 0, 0.3], matrix, 900, 600); const b = project([0, 0, -0.3], matrix, 900, 600);
    near((Math.atan2(b.x - s.x, -(b.y - s.y)) * 180) / Math.PI, yaw, 0.05, `terrain top-down yaw ${yaw}`);
  }
  // Tilted: kit azimuth falls as yaw rises, and the drawn bow follows the terrain projection.
  for (const [heading, yaw, tilt] of [[0, 20, 41.25], [90, -25, 30], [210, 10, 50], [300, 34, 20]]) {
    const pose = { ...defaultPose(), yaw: (yaw * Math.PI) / 180, tilt: (tilt * Math.PI) / 180 };
    const { matrix } = cameraMatrix(pose, scene, 900, 600);
    const h = (heading * Math.PI) / 180;
    const b = project([Math.sin(h) * 0.3, 0, -Math.cos(h) * 0.3], matrix, 900, 600);
    const s = project([-Math.sin(h) * 0.3, 0, Math.cos(h) * 0.3], matrix, 900, 600);
    const sprite = shipSprite({ headingDegrees: heading, cameraYawDegrees: yaw, cameraTiltDegrees: tilt, lengthPx: 64 });
    near(sprite.bowScreenDegrees + sprite.rotationDeg, (Math.atan2(b.x - s.x, -(b.y - s.y)) * 180) / Math.PI, 0.05, `H${heading} yaw${yaw} tilt${tilt}`);
    near(sprite.cameraRelativeHeading, heading + yaw, 1e-9, 'camera-relative heading');
  }
});

test('unknown heading returns null, never a guessed bow', () => {
  for (const heading of [null, undefined, NaN, Infinity, -Infinity, -1, 360, 511, 720, '90', '0', true, false, {}, []]) {
    assert.equal(shipSprite({ headingDegrees: heading, cameraYawDegrees: 0, cameraTiltDegrees: 40, lengthPx: 60 }), null, String(heading));
    assert.equal(validHeading(heading), null);
  }
  assert.equal(shipSprite(), null);
  for (const heading of [0, 0.5, 180, 359.9]) assert.ok(shipSprite({ headingDegrees: heading, lengthPx: 60 }));
});

test('sprites: quantized cache, size-based detail, small residual rotation, placement', () => {
  clearShipSprites();
  const a = shipSprite({ headingDegrees: 47, cameraYawDegrees: -6, cameraTiltDegrees: 41.25, lengthPx: 60 });
  const b = shipSprite({ headingDegrees: 49, cameraYawDegrees: -6, cameraTiltDegrees: 43, lengthPx: 60 });
  assert.equal(a.key, b.key, 'nearby views share one cached figure');
  assert.equal(a.svg, b.svg);
  assert.equal(shipSpriteCacheSize(), 1);
  assert.match(a.dataUrl, /^data:image\/svg\+xml,%3Csvg%20xmlns%3D/);
  assert.equal(decodeURIComponent(a.dataUrl.slice('data:image/svg+xml,'.length)), a.svg);
  assert.ok(ELEVATION_BANDS.includes(a.elevation));
  const steps = Array.from({ length: AZIMUTH_STEPS }, (_, k) => stepAzimuth(k, a.elevation));
  assert.ok(steps.includes(a.azimuth), 'azimuth is one of the band\'s quantized steps');
  assert.equal(new Set(steps).size, AZIMUTH_STEPS);
  steps.forEach((azimuth, k) => near(screenBowDegrees(azimuth, a.elevation), k * 360 / AZIMUTH_STEPS, 1e-3, `step ${k} is evenly spaced on screen`));
  assert.equal(stepAzimuth(0, 50), 180, 'step 0 draws the bow straight up');
  assert.equal(a.detail, 'mid');
  assert.equal(shipSprite({ headingDegrees: 47, lengthPx: 44 }).detail, 'low');
  assert.equal(shipSprite({ headingDegrees: 47, lengthPx: 200 }).detail, 'full');
  assert.equal(shipSprite({ headingDegrees: 47, lengthPx: 44, detail: 'full' }).detail, 'full');
  // Size: lengthPx is the broadside length, so all dimensions scale linearly with it.
  const small = shipSprite({ headingDegrees: 100, lengthPx: 60, detail: 'mid' });
  const large = shipSprite({ headingDegrees: 100, lengthPx: 120, detail: 'mid' });
  assert.equal(small.key, large.key);
  near(large.width / small.width, 2, 1e-9, 'width scales'); near(large.anchor.y / small.anchor.y, 2, 1e-9, 'anchor scales');
  const broadside = shipSprite({ headingDegrees: 90, cameraYawDegrees: 0, cameraTiltDegrees: 41.25, lengthPx: 80 });
  assert.ok(broadside.width > 80 && broadside.width < 80 * 1.12, `broadside sprite is about lengthPx wide (${broadside.width})`);
  // The residual rotation stays small over the camera range the terrain allows.
  let worst = 0;
  for (let heading = 0; heading < 360; heading += 7) {
    for (const yaw of [-34, -17, 0, 17, 34]) {
      for (const tilt of [20, 37, 54]) {
        const s = shipSprite({ headingDegrees: heading, cameraYawDegrees: yaw, cameraTiltDegrees: tilt, lengthPx: 64 });
        worst = Math.max(worst, Math.abs(s.rotationDeg));
        assert.ok(s.anchor.x > 0 && s.anchor.x < s.width && s.anchor.y > 0 && s.anchor.y < s.height);
      }
    }
  }
  assert.ok(worst <= 7.5 + 0.05, `largest residual rotation ${worst}° stays within half a step`);
  for (let heading = 0; heading < 360; heading += 5) {
    assert.ok(Math.abs(shipSprite({ headingDegrees: heading, cameraTiltDegrees: 0, lengthPx: 64 }).rotationDeg) <= 7.5 + 1e-9, 'top-down residual within half a step');
  }
  // An explicit projected bow angle is honoured exactly.
  const steered = shipSprite({ headingDegrees: 30, cameraYawDegrees: 0, cameraTiltDegrees: 41.25, lengthPx: 64, screenBowDegrees: 41 });
  near(steered.bowScreenDegrees + steered.rotationDeg, 41, 0.01, 'screenBowDegrees');
  const placed = spriteTransform(steered, { x: 300, y: 200 });
  assert.equal(placed.transformOrigin, `${steered.anchor.x}px ${steered.anchor.y}px`);
  assert.equal(placed.transform, `translate(${300 - steered.anchor.x}px, ${200 - steered.anchor.y}px) rotate(${steered.rotationDeg}deg)`);
  assert.ok(Math.abs(DEFAULT_TILT_DEGREES - (defaultPose().tilt * 180) / Math.PI) < 1e-9);
  clearShipSprites();
  assert.equal(shipSpriteCacheSize(), 0);
});

test('localView recovers the pose angles at the view centre and steepens toward the camera', () => {
  const scene = SCENES.hormuz;
  for (const [yaw, tilt] of [[0, 41.25], [-20, 30], [25, 54]]) {
    const pose = { ...defaultPose(), yaw: (yaw * Math.PI) / 180, tilt: (tilt * Math.PI) / 180, panX: 12, panZ: -8 };
    const { eye } = cameraMatrix(pose, scene, 1000, 600);
    const view = localView({ eye, point: [12, 0, -8] });
    near(view.cameraYawDegrees, yaw, 1e-6, 'yaw'); near(view.cameraTiltDegrees, tilt, 1e-6, 'tilt');
    const nearer = localView({ eye, point: [12 + Math.sin(pose.yaw) * 30, 0, -8 + Math.cos(pose.yaw) * 30] });
    assert.ok(nearer.cameraTiltDegrees < tilt, 'a point nearer the camera is seen from more directly above');
  }
});

test('runtime modules load only the vendored kit and each other', () => {
  const model = readFileSync(new URL('../dist/terrain/ship-model.mjs', import.meta.url), 'utf8');
  const sprites = readFileSync(new URL('../dist/terrain/ship-sprites.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...model.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]), ['../vendor/anatomy/iso-kit.mjs']);
  assert.deepEqual([...sprites.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]), ['./ship-model.mjs']);
  const code = (model + sprites).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\b(?:document|window|globalThis|navigator)\s*\.|\bfetch\s*\(|\bnew\s+(?:Image|DOMParser|XMLSerializer)\b/, 'no DOM or network use');
});
