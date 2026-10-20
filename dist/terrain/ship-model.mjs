/*
 * PASSAGE · Anatomy tanker figure for the live Hormuz map
 * ========================================================
 *
 * Concept (written before the geometry)
 * -------------------------------------
 * Figure tier: one subject. A generic laden VLCC crude carrier, built as a
 * solid Anatomy isometric object. It can be posed at any camera-relative
 * heading (kit azimuth 0–360°) and look-down angle (kit elevation 15–90°), so
 * a received AIS position on the tilted, turning terrain map can carry a ship
 * that sits in the same perspective as the land around it. Nothing in the
 * drawing moves, implies speed, or describes the particular vessel: it is an
 * illustrative generic tanker, enlarged for visibility.
 *
 * At a glance the reader sees a long, low, dark hull on a red boot-top, a
 * green cargo deck with its pipe spine, a manifold and two hose cranes
 * amidships, a raised forecastle, and a pale accommodation block aft with a
 * tall funnel behind it. The bridge glass is the one lit accent. At 4× the
 * deck shows its hatch rows, tank-cleaning fittings, rails, valves, flanges,
 * windlasses, bitts, lifeboats in davits, radar scanners and load-line marks.
 *
 * World: 1 unit = 1 m. x runs aft → fore (bow at +x), y runs port →
 * starboard (starboard at +y), z runs up from the waterline. In the kit's
 * projection this is an unmirrored picture: kit +y lies 90° clockwise of kit
 * +x seen from above, as starboard lies from the bow.
 *
 * Proportions (VLCC): LOA 330 m, beam 60 m (5.5 : 1). Main deck 11 m above
 * the waterline, red boot-top 2.2 m, forecastle deck 14.4 m, poop deck 13.8 m,
 * wheelhouse roof 34.5 m, funnel top 45 m, air draft about 47 m. Raked stem
 * 5.6 m, transom overhang 7 m, blunt VLCC bow.
 *
 * Colour is used only as real ships use it, tuned for #071a2c water. The
 * hull is near-black slate with a pale rim, over an oxide-red boot-top. The
 * deck is green, pipes and machinery are grey, and the superstructure is
 * pale. The funnel has a black cap band and the lifeboats are orange. The
 * lit tone appears only on the bridge glass.
 *
 * Parts list (76 parts at full detail; `data-part` ids)
 * -----------------------------------------------------
 * Hull and decks (5)   boot-top · topsides (with sheer seam, deck seams,
 *                      gutter bars, tank-cleaning fittings in rows, Plimsoll
 *                      disc and deck line, draught marks, anchor pockets) ·
 *                      bulb (bulbous-bow hint breaking the waterline) ·
 *                      forecastle (hawse pipes) · poop
 * Edges (4)            rail-P · rail-S (main-deck rails with stanchions and
 *                      knee rails) · forecastle-rail · poop-rail
 * Forecastle (7)       windlass-P/S (bed, gypsy, brake housing, cable, chain
 *                      stopper) · bitts-P/S (base, two posts) · bow-chock
 *                      (Panama chock with its opening, two SPM chain
 *                      stoppers) · foremast (base, pole, lamp) · bosun-hatch
 * Cargo deck (29)      cargo-line-1/2/3 · stripping-line · rack-frame-1…6
 *                      (pipe saddle + catwalk post) · catwalk (plate with
 *                      handrails) · hatch-1…15 (coaming, lid rim and hinge;
 *                      5 rows of port wing, centre and starboard wing) ·
 *                      mast-riser (vent riser and cap) · foam-monitor-P/S
 * Manifold (10)        manifold-P/S (three crossovers each, saddle) ·
 *                      manifold-valves-P/S (bodies + actuators) ·
 *                      manifold-flanges-P/S (stubs + flanges) · drip-tray-P/S ·
 *                      hose-crane-P/S (pedestal, slewing house with cab window,
 *                      jib, jib rest)
 * Accommodation (12)   house-lower (4 tiers, windows) · house-upper (2 tiers,
 *                      windows) · wheelhouse (lit bridge glass, the accent) ·
 *                      bridge-wing-P/S (deck plate, bulwark, console,
 *                      brackets) · bridge-roof (sun visor, monkey-island rail,
 *                      whip aerials) · radar-mast (pole split at its
 *                      platform) · radar-x · radar-s · funnel (raked) ·
 *                      funnel-band (black cap band) · exhausts
 * Life-saving (4)      lifeboat-P/S (hull + canopy) · davits-P/S (boat deck
 *                      platform + two gravity-davit frames), on the aft quarters
 * Stern (5)            winch-P/S (mooring winch bed + drum) · stern-bitts-P/S ·
 *                      provision-crane (pedestal, jib, rest)
 *
 * Detail levels. `full` draws every part (76, about 200 sorted items, ~160 KB).
 * `mid` (56–130 px) keeps 31 parts that stay wider than about a pixel (~32 KB):
 * hull with bulb, decks, windlasses, foremast, the pipe spine and catwalk,
 * manifold crossovers, hose cranes, the house stack, radars, funnel and
 * lifeboats. `low` (under 56 px) keeps a 16-part silhouette (~15 KB): hull,
 * decks, one pipe-rack strip, manifold strips, the house stack and wings, funnel
 * and mast. Mid and low also square off sub-pixel corner radii, drop creases,
 * and soften edges on everything but the hull, so small parts read as their
 * own colour rather than as ink. The hull keeps its pale rim at every size.
 *
 * Shading. Boxes and decks come from the vendored kit's `extrude` and `slabOf`,
 * which give four side tones by facing plus a lighter top. The kit only extrudes
 * straight up, so the lofted hull, raked funnel, drums and horizontal sweeps
 * (pipes, gypsies, jibs, scanners) use `polySolid` below. It applies the same
 * rule: convex hull fill, the kit's camera-left light (−sin A, cos A), four
 * buckets by horizontal facing, a top tone for faces that point up, top-edge
 * creases and a silhouette outline. Neighbouring loft facets that share a
 * tone are merged into one strip.
 *
 * Painter's order. Every drawn item records its axis-aligned box in ship
 * coordinates. For each pair whose screen boxes overlap, a separating axis
 * (x, y or z) and the view vector say which one cannot hide the other. A
 * topological sort with a far-to-near tie-break then orders all items at
 * every azimuth and elevation. Long things that wrap around others, such as
 * the forecastle and poop rails, are cut into one item per hull station.
 * Through-parts (the radar pole through its platform, crossovers through
 * valves) are split at the part they pass. `diagnostics.unresolved` lists
 * any overlapping pair with no separating axis; the tests require none.
 *
 * Camera relation (map ↔ kit)
 * ---------------------------
 * The terrain camera (geometry.mjs `cameraMatrix`) orbits the scene with
 *   eye = centre + d·(sin yaw·sin tilt, cos tilt, cos yaw·sin tilt)
 * in world X east, Y up, Z south. Screen right is cos(yaw)·east +
 * sin(yaw)·north, and screen up (far) is compass bearing −yaw. A ship with
 * compass heading H therefore points h = H + yaw clockwise from screen up.
 * The kit draws its +x axis at 180° − A clockwise from up and foreshortens the
 * floor by sin E, as the map does by cos(tilt). So
 *   kit azimuth   A = (180° − H − yaw) mod 360°
 *   kit elevation E = 90° − tilt
 * This is exact at the view centre (checked with `project` in
 * test/ship-model.test.mjs). Off centre, the 40° perspective changes the local
 * angles. Pass `localView()` from ship-sprites.mjs for exact ones.
 *
 * Rendering limits
 * ----------------
 * - Local orthographic picture. The terrain is a 40° perspective, so the
 *   sprite is exact only for the view direction it is given. Pass localView()
 *   and the projected heading (ship-sprites.mjs) for off-centre vessels.
 * - Light is camera-fixed (the kit's rule: from screen left), not the terrain
 *   shader's north-west sun. At the default yaw the two agree. Within the
 *   ±34° yaw range they differ by up to the yaw.
 * - Only the hull above the waterline is drawn. There is no wake, spray or
 *   motion, and the generic VLCC shape is not the reported vessel's dimensions.
 * - Painter's order uses axis-aligned boxes, which is exact for these convex,
 *   separable parts. The boot-top, bulb and topsides overlap by design and are
 *   drawn in fixed layers instead.
 * - Strokes use vector-effect: non-scaling-stroke (CSS px) and the halo uses
 *   an SVG blur, so the SVG needs a renderer that supports both. Every
 *   current browser does, in <img> and inline.
 */
import * as kit from '../vendor/anatomy/iso-kit.mjs';

const DEG = Math.PI / 180;
const LOA = 330;
const DECK = 11;
const BOOT = 2.2;
const FC = 14.4;
const PP = 13.8;

export const TANKER = Object.freeze({
  lengthOverall: LOA, beam: 60, mainDeck: DECK, bootTop: BOOT,
  forecastleDeck: FC, poopDeck: PP, wheelhouseRoof: 34.45, funnelTop: 45, airDraft: 47,
});
export const DETAILS = Object.freeze(['low', 'mid', 'full']);
const RANK = Object.freeze({ low: 0, mid: 1, full: 2 });
/** Screen units per metre, measured across the screen, for the figure's kit scale of 1. */
export const UNITS_PER_METRE = Math.sqrt(1.6);

const mod360 = (value) => ((value % 360) + 360) % 360;
const finite = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Kit azimuth that shows compass heading H under a camera yaw (both degrees). */
export function kitAzimuthFor({ headingDegrees, cameraYawDegrees = 0 }) {
  return mod360(180 - headingDegrees - cameraYawDegrees);
}
/** Kit elevation for the terrain camera tilt (degrees from straight down). */
export const kitElevationFor = (cameraTiltDegrees) => clamp(90 - cameraTiltDegrees, 0, 90);
/** Clockwise-from-screen-up angle at which a figure drawn at (A, E) shows its bow. */
export function screenBowDegrees(azimuth, elevation) {
  const a = azimuth * DEG;
  const e = elevation * DEG;
  return Math.atan2(Math.sin(a), -Math.cos(a) * Math.sin(e)) / DEG;
}
/** Detail level that stays legible at a broadside on-screen length in CSS px. */
export function detailForLength(lengthPx) {
  const px = finite(lengthPx, 64);
  return px < 56 ? 'low' : px < 130 ? 'mid' : 'full';
}

// ---------------------------------------------------------------- hull lines
// Starboard half, stern centreline → stem: [deck x, deck y, waterline x, waterline y].
const STATIONS = [
  [-165, 0, -158, 0], [-165, 16, -158, 11], [-164, 20, -157.2, 15], [-162, 24, -155.5, 19.5],
  [-158.5, 27.2, -152.5, 23.8], [-153, 29.2, -148, 27.2], [-145, 30, -141, 29.3], [-132, 30, -130, 30],
  [105, 30, 105, 30], [122, 29.5, 120, 29.5], [134, 28, 131.5, 27.6], [144, 24.8, 141, 23.8],
  [151.5, 20.6, 148, 19], [157, 15.6, 153.5, 13.5], [161, 10.4, 157, 8.2], [163.8, 5.2, 159.2, 3.8],
  [165.6, 0, 160, 0],
];
const mirror = (half) => [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [x, -y])];
const DECK_RING = mirror(STATIONS.map(([x, y]) => [x, y]));
const WL_RING = mirror(STATIONS.map(([, , x, y]) => [x, y]));
const ringAt = (z) => {
  const t = z / DECK;
  return DECK_RING.map(([x, y], i) => [WL_RING[i][0] + (x - WL_RING[i][0]) * t, WL_RING[i][1] + (y - WL_RING[i][1]) * t, z]);
};
const STARBOARD_DECK = STATIONS.slice(1).map(([x, y]) => [x, y]);
/** Deck half-breadth at station x (m). */
function halfBreadth(x) {
  const pts = STARBOARD_DECK;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (x <= x1) return x1 === x0 ? Math.max(y0, y1) : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return 0;
}
const FC_RING = [...STATIONS.slice(10).map(([x, y]) => [x, y]), ...STATIONS.slice(10, -1).reverse().map(([x, y]) => [x, -y])];
const POOP_FRONT = -124;
const POOP_RING = [
  ...STATIONS.slice(0, 8).map(([x, y]) => [x, y]), [POOP_FRONT, 30], [POOP_FRONT, -30],
  ...STATIONS.slice(1, 8).reverse().map(([x, y]) => [x, -y]),
];
const CARGO_AFT = POOP_FRONT;
const CARGO_FWD = 134;
const BULKHEADS = [134, 83, 32, -19, -70, -112];

// ---------------------------------------------------------------- materials
// Four side tones (darkest → lightest), a lighter top, paper fill, edge and crease inks.
const MAT = {
  // `rim` keeps a crisp pale silhouette at every size: it is what separates the hull from the water.
  hull: { paper: '#1a2129', shades: ['#11171d', '#171e26', '#1e2730', '#26303a'], top: '#4f6d55', edge: '#7f909d', crease: '#33443a', rim: true },
  boot: { paper: '#7a2a24', shades: ['#5a1e1a', '#6f2621', '#842e28', '#97372f'], top: '#a03d33', edge: '#c45d50', crease: '#5a1e1a', rim: true },
  house: { paper: '#b8bdba', shades: ['#848b8a', '#979e9c', '#aab0ad', '#bcc1be'], top: '#dfe2dc', edge: '#4d575c', crease: '#8f9693' },
  pipe: { paper: '#8f9994', shades: ['#5f6965', '#717b77', '#848d89', '#97a09b'], top: '#bec6c1', edge: '#2f3c38', crease: '#68726e' },
  machine: { paper: '#7c8682', shades: ['#525b58', '#626b68', '#727b78', '#838c88'], top: '#a6afab', edge: '#262f2c', crease: '#5a6360' },
  fitting: { paper: '#6c8570', shades: ['#485c4c', '#536956', '#5e7561', '#69816c'], top: '#8aa38d', edge: '#26362a', crease: '#485c4c' },
  black: { paper: '#15191c', shades: ['#0c0f11', '#111417', '#161a1e', '#1c2125'], top: '#262c31', edge: '#6b757c', crease: '#0c0f11' },
  boat: { paper: '#c35f2a', shades: ['#88401c', '#9d4a20', '#b15525', '#c2602a'], top: '#df7b3d', edge: '#5b2b12', crease: '#88401c' },
};
const INK = {
  seam: '#2f3b46', deckSeam: '#43604a', fitting: '#344a3a', fittingDot: '#a9bdab', mark: '#c9d1d0',
  rail: '#a7b1ad', catwalkRail: '#5d6864', houseRail: '#d3d7d2', glass: '#27333c', bridgeGlass: '#18222a', lit: '#ffe4a3',
  chain: '#2b3331', recess: '#0d1216', recessEdge: '#3a4853', anchor: '#5a6770', antenna: '#cfd4cf',
};
const STROKES = {
  full: { edge: 0.6, crease: 0.4, fine: 0.4, soft: false },
  mid: { edge: 0.55, crease: 0, fine: 0.4, soft: true },
  low: { edge: 0.6, crease: 0, fine: 0.45, soft: true },
};

// ---------------------------------------------------------------- vectors
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mean = (points) => scale3(points.reduce((s, p) => add3(s, p), [0, 0, 0]), 1 / points.length);
const pointKey = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)},${Math.round(p[2] * 1000)}`;

function viewOf(P) {
  const c = kit.cameraOf(P);
  return { V: [c.cosA * c.cosE, c.sinA * c.cosE, c.sinE], L: [-c.sinA, c.cosA] };
}
function newell(face) {
  let nx = 0; let ny = 0; let nz = 0;
  for (let i = 0; i < face.length; i++) {
    const [x1, y1, z1] = face[i];
    const [x2, y2, z2] = face[(i + 1) % face.length];
    nx += (y1 - y2) * (z1 + z2); ny += (z1 - z2) * (x1 + x2); nz += (x1 - x2) * (y1 + y2);
  }
  return [nx, ny, nz];
}
function hull2(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = []; const upper = [];
  for (const p of sorted) { while (lower.length > 1 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = sorted.length - 1; i >= 0; i--) { const p = sorted[i]; while (upper.length > 1 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function chainSegments(segments, project) {
  const ends = new Map();
  segments.forEach((s, i) => { for (const p of [s.a, s.b]) { const k = pointKey(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
  const used = new Set(); const out = [];
  const grow = (line, atEnd) => {
    for (;;) {
      const tip = atEnd ? line[line.length - 1] : line[0];
      const k = pointKey(tip);
      const next = (ends.get(k) || []).find((j) => !used.has(j));
      if (next === undefined) return;
      used.add(next);
      const s = segments[next];
      const other = pointKey(s.a) === k ? s.b : s.a;
      if (atEnd) line.push(other); else line.unshift(other);
    }
  };
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const line = [segments[i].a, segments[i].b];
    grow(line, true); grow(line, false);
    out.push(kit.pathOf(line.map(project)));
  }
  return out.join('');
}

/**
 * A convex solid from its faces, painted with the kit's rule: paper fill (hull),
 * four side tones by horizontal facing to the camera-left light, a lighter top
 * for faces that point up, creases where tops meet sides, silhouette outline.
 */
export function polySolid(faces, P, { loft = false } = {}) {
  const { V, L } = viewOf(P);
  const all = faces.flat();
  const centre = mean(all);
  const meta = [];
  for (const face of faces) {
    let n = newell(face);
    const length = Math.hypot(n[0], n[1], n[2]);
    if (length < 1e-9) continue;
    n = scale3(n, 1 / length);
    if (dot(n, sub(mean(face), centre)) < 0) n = scale3(n, -1);
    const facing = dot(n, V) > 1e-9;
    const top = n[2] > 0.62;
    let shade = 0;
    const flat = Math.hypot(n[0], n[1]);
    if (!top && flat > 1e-6 && n[2] > -0.62) {
      const lit = ((n[0] * L[0] + n[1] * L[1]) / flat + 1) / 2;
      shade = clamp(Math.floor(lit * 4), 0, 3);
    }
    meta.push({ face, facing, top, shade, index: meta.length });
  }
  const edges = new Map();
  meta.forEach((m, index) => m.face.forEach((p, j) => {
    const q = m.face[(j + 1) % m.face.length];
    const ka = pointKey(p); const kb = pointKey(q);
    if (ka === kb) return;
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (!edges.has(key)) edges.set(key, { a: p, b: q, faces: [] });
    edges.get(key).faces.push(index);
  }));
  const outline = []; const crease = [];
  for (const edge of edges.values()) {
    const adjacent = edge.faces.map((i) => meta[i]);
    const facing = adjacent.filter((m) => m.facing);
    if (adjacent.length === 1) { if (facing.length) outline.push(edge); continue; }
    if (facing.length === 1) outline.push(edge);
    else if (facing.length >= 2 && facing.some((m) => m.top) && facing.some((m) => !m.top)) crease.push(edge);
  }
  const project = (p) => kit.iso(p, P);
  const shades = [[], [], [], []]; const tops = [];
  const sides = loft && meta.length === faces.length ? meta.slice(2) : [];
  for (const m of meta) if (m.facing && (m.top || !sides.length || m.index < 2)) (m.top ? tops : shades[m.shade]).push(kit.pathOf(m.face.map(project), true));
  if (sides.length) {
    // Loft sides [lower_k, lower_k+1, upper_k+1, upper_k]: merge runs of neighbours that share a tone into one strip.
    const count = sides.length;
    const key = (m) => (m.facing && !m.top ? m.shade : -1);
    let start = sides.findIndex((m, k) => key(m) !== key(sides[(k + count - 1) % count]));
    if (start < 0) start = 0;
    for (let k = 0; k < count;) {
      const first = sides[(start + k) % count];
      let length = 1;
      while (k + length < count && key(sides[(start + k + length) % count]) === key(first)) length++;
      if (key(first) >= 0) {
        const run = Array.from({ length }, (_, j) => sides[(start + k + j) % count].face);
        const lower = [run[0][0], ...run.map((f) => f[1])];
        const upper = [run[0][3], ...run.map((f) => f[2])];
        shades[first.shade].push(kit.pathOf([...lower, ...upper.reverse()].map(project), true));
      }
      k += length;
    }
  }
  return {
    fill: kit.pathOf(hull2(all.map(project)), true),
    outline: chainSegments(outline, project),
    crease: chainSegments(crease, project),
    top: tops.join(''),
    shades: shades.map((list) => list.join('')),
  };
}

const loftFaces = (lower, upper) => [lower, upper, ...lower.map((p, i) => [p, lower[(i + 1) % lower.length], upper[(i + 1) % upper.length], upper[i]])];
/** A prism swept along a → b with a convex cross-section [[u, w]] (w is "up" across the axis). */
function sweepFaces(a, b, profile) {
  const axis = unit(sub(b, a));
  let w = sub([0, 0, 1], scale3(axis, axis[2]));
  if (Math.hypot(w[0], w[1], w[2]) < 1e-6) w = [0, 1, 0];
  w = unit(w);
  const u = unit(cross(w, axis));
  const ring = (o) => profile.map(([pu, pw]) => add3(o, add3(scale3(u, pu), scale3(w, pw))));
  return loftFaces(ring(a), ring(b));
}
const roundProfile = (r, n) => Array.from({ length: n }, (_, i) => { const t = Math.PI / 2 - Math.PI / n + (i / n) * Math.PI * 2; return [r * Math.cos(t), r * Math.sin(t)]; });
const boxProfile = (hu, hw) => [[-hu, -hw], [hu, -hw], [hu, hw], [-hu, hw]];
const ellipseRing = (cx, cy, rx, ry, z, n) => Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return [cx + rx * Math.cos(t), cy + ry * Math.sin(t), z]; });

function boxOf(points) {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const [x, y, z] of points) {
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.min(box[2], z);
    box[3] = Math.max(box[3], x); box[4] = Math.max(box[4], y); box[5] = Math.max(box[5], z);
  }
  return box;
}
const ringBox = (ring, z0, z1) => boxOf([...ring.map(([x, y]) => [x, y, z0]), [ring[0][0], ring[0][1], z1]]);
const across = (s, a, b) => (s > 0 ? { y: a, d: b - a } : { y: -b, d: b - a });
const SIDES = [[-1, 'P'], [1, 'S']];

function mix(a, b, t) {
  const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t).toString(16).padStart(2, '0')).join('')}`;
}
function paint(paths, m, { inner = '', crease = true, widths }) {
  let out = `<path fill="${m.paper}" d="${paths.fill}"/>`;
  paths.shades.forEach((d, i) => { if (d) out += `<path fill="${m.shades[i]}" d="${d}"/>`; });
  if (paths.top) out += `<path fill="${m.top}" d="${paths.top}"/>`;
  if (crease && widths.crease > 0) {
    const d = (paths.crease || '') + (paths.bevel || '');
    if (d) out += `<path class="l" stroke="${m.crease}" stroke-width="${widths.crease}" d="${d}"/>`;
  }
  out += inner;
  // At map sizes a dark ink edge would swallow a part a few pixels wide; soften it to the part's own shade.
  const edge = widths.soft && !m.rim ? mix(m.edge, m.shades[1], 0.65) : m.edge;
  if (paths.outline) out += `<path class="l" stroke="${edge}" d="${paths.outline}"/>`;
  return out;
}

// ---------------------------------------------------------------- the build
function buildItems(P, detail) {
  const rank = RANK[detail];
  const full = rank >= 2;
  const mid = rank >= 1;
  const widths = STROKES[detail];
  const { V } = viewOf(P);
  const items = [];
  const at = (p) => kit.iso(p, P);
  const path = (points, closed = false) => kit.pathOf(points.map(at), closed);
  const sees = (n) => dot(n, V) > 1e-6;
  const line = (d, stroke, width = widths.fine) => (d ? `<path class="l" stroke="${stroke}" stroke-width="${width}" d="${d}"/>` : '');
  const area = (d, fill) => (d ? `<path fill="${fill}" d="${d}"/>` : '');
  const dots = (points, fill, r) => points.map((p) => { const [x, y] = at(p); return `<circle fill="${fill}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>`; }).join('');

  const put = (part, box, body, layer = 2) => items.push({ part, box, layer, svg: `<g data-part="${part}">${body}</g>` });
  const solid = (part, paths, box, m, opts = {}) => put(part, box, paint(paths, m, { ...opts, widths }), opts.layer);
  // Mid and low sizes square off corner radii that would be far under a pixel.
  const slab = (part, plan, z, h, m, opts = {}) => solid(part, kit.slabOf(full ? plan : { ...plan, r: 0 }, z, h, P, opts.steps ?? 2, full ? opts.bevel ?? 0 : 0), [plan.x, plan.y, z, plan.x + plan.w, plan.y + plan.d, z + h], m, opts);
  // Vertical drums are lofted so neighbouring facets of one tone merge into one strip.
  const cyl = (part, cx, cy, r, z, h, m, opts = {}) => {
    const n = full ? opts.steps ?? 16 : Math.min(opts.steps ?? 10, 10);
    poly(part, loftFaces(ellipseRing(cx, cy, r, r, z, n), ellipseRing(cx, cy, r, r, z + h, n)), m, opts);
  };
  const prism = (part, ring, z, h, m, opts = {}) => solid(part, kit.extrude(ring, z, h, P, { convex: true }), ringBox(ring, z, z + h), m, opts);
  const poly = (part, faces, m, opts = {}) => solid(part, polySolid(faces, P, { loft: true }), boxOf(faces.flat()), m, opts);
  const bar = (part, a, b, profile, m, opts) => poly(part, sweepFaces(a, b, profile), m, opts);
  const facets = full ? 10 : 6;

  // Hull: boot-top band, bulbous-bow hint, lofted topsides with the green main deck.
  const waterline = WL_RING.map(([x, y]) => [x, y, 0]);
  const bootRing = ringAt(BOOT);
  const deckRing = DECK_RING.map(([x, y]) => [x, y, DECK]);
  poly('boot-top', loftFaces(waterline, bootRing), MAT.boot, { layer: 0 });
  if (mid) poly('bulb', loftFaces(ellipseRing(161.4, 0, 3.6, 2.4, 0, 14), ellipseRing(160.9, 0, 2.6, 1.6, 1.3, 14)), MAT.boot, { layer: 1 });
  poly('topsides', loftFaces(bootRing, deckRing), MAT.hull, { inner: hullMarks() + deckMarks() });

  function sideFacing(i) {
    // Outward horizontal normal of hull face i (between ring vertices i and i + 1).
    const a = DECK_RING[i]; const b = DECK_RING[(i + 1) % DECK_RING.length];
    const n = newell([[...WL_RING[i], 0], [...WL_RING[(i + 1) % WL_RING.length], 0], [...b, DECK], [...a, DECK]]);
    const mid3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0];
    return dot(n, mid3) < 0 ? scale3(unit(n), -1) : unit(n);
  }
  function hullPoint(s, x, z) {
    const ring = ringAt(z).slice(0, STATIONS.length);
    for (let i = 1; i < ring.length; i++) {
      const [x0, y0] = ring[i - 1]; const [x1, y1] = ring[i];
      if (x >= x0 && x <= x1 && x1 > x0) { const t = (x - x0) / (x1 - x0); return [x, s * (y0 + (y1 - y0) * t), z]; }
    }
    return [x, s * halfBreadth(x), z];
  }
  function hullMarks() {
    let out = '';
    // Sheer-strake seam: the visible run of the hull ring 1.5 m under the deck edge.
    const seamRing = ringAt(DECK - 1.5);
    const facing = DECK_RING.map((_, i) => sees(sideFacing(i)));
    const runs = [];
    let run = [];
    const count = seamRing.length;
    const start = facing.findIndex((f, i) => f && !facing[(i + count - 1) % count]);
    if (start >= 0) {
      for (let k = 0; k <= count; k++) {
        const i = (start + k) % count;
        if (facing[i]) { if (!run.length) run.push(seamRing[i]); run.push(seamRing[(i + 1) % count]); }
        else if (run.length) { runs.push(run); run = []; }
      }
      if (run.length) runs.push(run);
    }
    if (mid) out += line(runs.map((r) => path(r)).join(''), INK.seam);
    if (!full) return out;
    // Load-line (Plimsoll) disc, deck line and amidships draught marks, painted on the side that faces the camera.
    for (const [s] of SIDES) {
      if (!sees([0, s, 0])) continue;
      const y = s * 30;
      const cx = 8; const cz = 3.1; const r = 1.4;
      const disc = Array.from({ length: 24 }, (_, i) => { const t = (i / 24) * Math.PI * 2; return [cx + r * Math.cos(t), y, cz + r * Math.sin(t)]; });
      let marks = path(disc, true) + path([[cx - r - 0.7, y, cz], [cx + r + 0.7, y, cz]]) + path([[cx - 2.6, y, DECK - 0.45], [cx + 2.6, y, DECK - 0.45]]);
      marks += path([[cx + 4.2, y, 1.6], [cx + 4.2, y, 4.4]]) + [1.8, 2.6, 3.4, 4.2].map((z) => path([[cx + 4.2, y, z], [cx + 5.2, y, z]])).join('');
      for (let z = 3; z <= 9; z += 1) marks += path([[-2.6, y, z], [-2, y, z]]);
      out += line(marks, INK.mark, 0.35);
    }
    // Anchor pockets in the bow flare, with the stowed anchor crown.
    for (const [s] of SIDES) {
      const i = s > 0 ? 12 : DECK_RING.length - 13;
      if (!sees(sideFacing(i))) continue;
      const corners = [hullPoint(s, 152.6, 6.9), hullPoint(s, 155.4, 6.9), hullPoint(s, 155.6, 9.3), hullPoint(s, 152.9, 9.3)];
      out += area(path(corners, true), INK.recess) + line(path(corners, true), INK.recessEdge, 0.35);
      const shank = [hullPoint(s, 154.1, 9.0), hullPoint(s, 154.1, 7.4)];
      out += line(path(shank) + path([hullPoint(s, 153.2, 7.8), hullPoint(s, 154.1, 7.25), hullPoint(s, 155.0, 7.8)]), INK.anchor, 0.4);
    }
    return out;
  }
  function deckMarks() {
    if (!mid) return '';
    let out = '';
    // Plate seams at the tank bulkheads run edge to edge; gutter bars end on the poop and forecastle faces.
    const seams = BULKHEADS.slice(1).map((x) => path([[x, -halfBreadth(x), DECK], [x, halfBreadth(x), DECK]])).join('');
    const gutter = SIDES.map(([s]) => path([CARGO_AFT, 105, 122, CARGO_FWD].map((x) => [x, s * (halfBreadth(x) - 0.9), DECK]))).join('');
    out += line(seams + (full ? gutter : ''), INK.deckSeam, full ? 0.35 : 0.3);
    if (!full) return out;
    const longitudinal = [-12.5, 12.5].map((y) => path([[CARGO_AFT, y, DECK], [CARGO_FWD, y, DECK]])).join('');
    out += line(longitudinal, INK.deckSeam, 0.3);
    // Tank-cleaning fittings in rows: two per wing tank, inboard of the hatch rows.
    const rings = []; const centres = [];
    for (let k = 0; k < 5; k++) {
      const mid1 = (BULKHEADS[k] + BULKHEADS[k + 1]) / 2;
      for (const x of [mid1 - 11, mid1 + 11]) for (const y of [-15, 15]) { rings.push(kit.ring(x, y, 0.5, DECK, P, 10)); centres.push([x, y, DECK]); }
    }
    out += line(rings.join(''), INK.fitting, 0.35) + dots(centres, INK.fittingDot, 0.18);
    return out;
  }

  // Raised forecastle and poop decks continue the hull sides above the main deck.
  const fcInner = () => {
    if (!full) return '';
    const hawse = SIDES.map(([s]) => kit.ring(158.2, s * 6.5, 0.75, FC, P, 14)).join('');
    const seam = path([[148, -halfBreadth(148), FC], [148, halfBreadth(148), FC]]);
    return line(seam, INK.deckSeam, 0.3) + area(hawse, INK.recess) + line(hawse, INK.recessEdge, 0.35);
  };
  prism('forecastle', FC_RING, DECK, FC - DECK, MAT.hull, { inner: fcInner() });
  prism('poop', POOP_RING, DECK, PP - DECK, MAT.hull, {
    inner: full ? line(path([[-140, -30, PP], [-140, 30, PP]]) + path([[-158, -halfBreadth(-158), PP], [-158, halfBreadth(-158), PP]]), INK.deckSeam, 0.3) : '',
  });

  // Edge rails: one item per hull station span, so each rail chunk sorts on its own.
  function rail(part, points, z, height) {
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1]; const [x1, y1] = points[i];
      const length = Math.hypot(x1 - x0, y1 - y0);
      if (length < 0.05) continue;
      const posts = []; const steps = Math.max(1, Math.round(length / 5));
      for (let k = 0; k <= steps; k++) {
        if (k === steps && i < points.length - 1) continue;
        const t = k / steps; const x = x0 + (x1 - x0) * t; const y = y0 + (y1 - y0) * t;
        posts.push(path([[x, y, z], [x, y, z + height]]));
      }
      const d = path([[x0, y0, z + height], [x1, y1, z + height]]) + path([[x0, y0, z + height / 2], [x1, y1, z + height / 2]]) + posts.join('');
      put(part, boxOf([[x0, y0, z], [x1, y1, z + height]]), line(d, INK.rail, 0.35));
    }
  }
  if (full) {
    for (const [s, tag] of SIDES) rail(`rail-${tag}`, [CARGO_AFT, 105, 122, CARGO_FWD].map((x) => [x, s * (halfBreadth(x) - 0.35)]), DECK, 1);
    const fcEdge = [...STATIONS.slice(10).map(([x, y]) => [x, y]), ...STATIONS.slice(10, -1).reverse().map(([x, y]) => [x, -y])];
    rail('forecastle-rail', fcEdge.map(([x, y]) => (y === 0 ? [x - 0.35, 0] : [x, y - Math.sign(y) * 0.35])), FC, 1);
    const poopEdge = [[POOP_FRONT, 29.65], ...STATIONS.slice(1, 8).reverse().map(([x, y]) => [x + (x <= -164.9 ? 0.35 : 0), y - 0.35]), [-164.65, 0],
      ...STATIONS.slice(1, 8).map(([x, y]) => [x + (x <= -164.9 ? 0.35 : 0), -(y - 0.35)]), [POOP_FRONT, -29.65]];
    rail('poop-rail', poopEdge, PP, 1);
  }

  // Forecastle machinery.
  for (const [s, tag] of SIDES) {
    if (mid) {
      slab(`windlass-${tag}`, { x: 148.6, ...across(s, 4.2, 8.8), w: 4, r: 0.3 }, FC, 0.6, MAT.fitting, { bevel: 0.2 });
      bar(`windlass-${tag}`, [150.6, s * 5.1, FC + 1.65], [150.6, s * 7.9, FC + 1.65], roundProfile(1.05, facets), MAT.machine);
    }
    if (full) {
      slab(`windlass-${tag}`, { x: 149.4, ...across(s, 2.6, 4.2), w: 2.4, r: 0.3 }, FC, 1.7, MAT.machine);
      slab(`windlass-${tag}`, { x: 154, ...across(s, 5.8, 7.2), w: 1.4, r: 0 }, FC, 0.8, MAT.machine);
      for (const [x0, x1] of [[152.6, 154], [155.4, 157.45]]) put(`windlass-${tag}`, [x0, s * 6.5 - 0.3, FC, x1, s * 6.5 + 0.3, FC + 0.45], line(path([[x0, s * 6.5, FC + 0.32], [x1, s * 6.5, FC + 0.12]]), INK.chain, 0.9));
      slab(`bitts-${tag}`, { x: 138.4, ...across(s, 20.2, 21.8), w: 3.2, r: 0.3 }, FC, 0.25, MAT.machine);
      for (const x of [139.2, 140.8]) {
        cyl(`bitts-${tag}`, x, s * 21, 0.5, FC + 0.25, 1.4, MAT.machine, { steps: 10, inner: line(kit.ring(x, s * 21, 0.32, FC + 1.65, P, 10), MAT.machine.crease, 0.3) });
      }
    }
  }
  if (full) {
    const chockFace = sees([1, 0, 0]) ? (() => { const o = Array.from({ length: 16 }, (_, i) => { const t = (i / 16) * Math.PI * 2; return [163.4, 0.95 * Math.cos(t), FC + 0.85 + 0.42 * Math.sin(t)]; }); return area(path(o, true), INK.recess) + line(path(o, true), INK.recessEdge, 0.3); })() : '';
    slab('bow-chock', { x: 161.2, y: -1.8, w: 2.2, d: 3.6, r: 0.4 }, FC, 1.5, MAT.machine, { inner: chockFace });
    for (const [s] of SIDES) slab('bow-chock', { x: 158.6, ...across(s, 1.2, 2.4), w: 1.6, r: 0 }, FC, 0.9, MAT.machine);
    slab('bosun-hatch', { x: 137.5, y: 3, w: 3, d: 3, r: 0.3 }, FC, 0.7, MAT.fitting, { bevel: 0.25 });
    cyl('foremast', 146.5, 0, 0.8, FC, 0.5, MAT.machine, { steps: 12 });
  }
  if (mid) cyl('foremast', 146.5, 0, 0.35, full ? FC + 0.5 : FC, full ? 7.5 : 8, MAT.house, { steps: 8 });
  if (full) cyl('foremast', 146.5, 0, 0.45, FC + 8, 0.6, MAT.machine, { steps: 10 });

  // Cargo deck: the pipe spine, rack frames, catwalk, hatch rows, riser.
  const lineZ = DECK + 1.12;
  if (mid) {
    for (const [k, y] of [[1, -7.4], [2, -5.2], [3, -3.0]]) bar(`cargo-line-${k}`, [CARGO_AFT, y, lineZ], [CARGO_FWD, y, lineZ], roundProfile(0.52, facets), MAT.pipe);
    bar('stripping-line', [CARGO_AFT, -1.2, DECK + 0.92], [CARGO_FWD, -1.2, DECK + 0.92], roundProfile(0.32, full ? 8 : 6), MAT.pipe);
    const rails = full ? line(SIDES.map(([s]) => {
      const y = 1.6 + s * 0.65;
      let d = path([[CARGO_AFT, y, DECK + 3.5], [CARGO_FWD, y, DECK + 3.5]]) + path([[CARGO_AFT, y, DECK + 3.0], [CARGO_FWD, y, DECK + 3.0]]);
      for (let x = CARGO_AFT; x <= CARGO_FWD + 1e-6; x += 6.45) d += path([[x, y, DECK + 2.5], [x, y, DECK + 3.5]]);
      return d;
    }).join(''), INK.catwalkRail, 0.35) : '';
    const plan = { x: CARGO_AFT, y: 0.85, w: CARGO_FWD - CARGO_AFT, d: 1.5, r: 0 };
    solid('catwalk', kit.slabOf(plan, DECK + 2.3, 0.2, P, 2), [plan.x, plan.y, DECK + 2.3, plan.x + plan.w, plan.y + plan.d, DECK + (full ? 3.5 : 2.5)], MAT.pipe, { inner: rails });
  } else {
    slab('pipe-rack', { x: CARGO_AFT, y: -8, w: CARGO_FWD - CARGO_AFT, d: 7.4, r: 0.4 }, DECK, 1.6, MAT.pipe);
  }
  if (full) {
    [-110, -70, -32, 22, 62, 104].forEach((x, k) => {
      slab(`rack-frame-${k + 1}`, { x: x - 0.35, y: -8.3, w: 0.7, d: 7.8, r: 0 }, DECK, 0.6, MAT.machine);
      slab(`rack-frame-${k + 1}`, { x: x - 0.2, y: 1.1, w: 0.4, d: 1, r: 0 }, DECK, 2.3, MAT.machine);
    });
    let n = 0;
    for (let k = 0; k < 5; k++) {
      const x = BULKHEADS[k + 1] + 5;
      for (const y of [-21, 10, 21]) {
        n++;
        // Raised coaming with its lid: one drum, the lid's rim and hinge drawn on top.
        cyl(`hatch-${n}`, x, y, 0.95, DECK, 0.9, MAT.fitting, {
          steps: 12,
          inner: line(kit.ring(x, y, 0.7, DECK + 0.9, P, 12), MAT.fitting.crease, 0.3) + dots([[x - 0.95, y, DECK + 0.9]], MAT.fitting.edge, 0.22),
        });
      }
    }
    cyl('mast-riser', 127, -12, 0.4, DECK, 8, MAT.pipe, { steps: 10 });
    cyl('mast-riser', 127, -12, 0.7, DECK + 8, 0.7, MAT.machine, { steps: 12 });
    for (const [s, tag] of SIDES) {
      cyl(`foam-monitor-${tag}`, -125.4, s * 12, 0.3, PP, 1.4, MAT.boot, { steps: 8 });
      bar(`foam-monitor-${tag}`, [-125.06, s * 12, PP + 1.55], [-123.5, s * 12, PP + 1.78], roundProfile(0.2, 6), MAT.boot);
    }
  }

  // Manifold amidships: three crossovers a side with valves, flanges, drip trays; hose cranes.
  for (const [s, tag] of SIDES) {
    if (!mid) { slab(`manifold-${tag}`, { x: -4.4, ...across(s, s < 0 ? 8 : 0.6, 26), w: 8.8, r: 0.3 }, DECK, 1.3, MAT.pipe); continue; }
    for (const x of [-3.6, 0, 3.6]) {
      // Starboard crossovers pass under the catwalk: cut them there so each piece sorts on its own.
      const y0 = s < 0 ? -7.92 : -0.88;
      const yEnd = s * (full ? 21.6 : 25.6);
      if (s > 0) {
        bar(`manifold-${tag}`, [x, y0, lineZ], [x, 3, lineZ], roundProfile(0.42, facets), MAT.pipe);
        bar(`manifold-${tag}`, [x, 3, lineZ], [x, yEnd, lineZ], roundProfile(0.42, facets), MAT.pipe);
      } else {
        bar(`manifold-${tag}`, [x, y0, lineZ], [x, yEnd, lineZ], roundProfile(0.42, facets), MAT.pipe);
      }
      if (full) {
        slab(`manifold-valves-${tag}`, { x: x - 0.65, ...across(s, 21.6, 23), w: 1.3, r: 0 }, DECK + 0.55, 1.2, MAT.machine);
        cyl(`manifold-valves-${tag}`, x, s * 22.3, 0.42, DECK + 1.75, 0.85, MAT.machine, { steps: 10 });
        bar(`manifold-flanges-${tag}`, [x, s * 23, lineZ], [x, s * 25.6, lineZ], roundProfile(0.42, facets), MAT.pipe);
        bar(`manifold-flanges-${tag}`, [x, s * 25.6, lineZ], [x, s * 26, lineZ], roundProfile(0.66, facets), MAT.machine);
      }
    }
    if (full) {
      const tray = { x: -6.4, ...across(s, 23.6, 28.8), w: 12.8, r: 0.4 };
      slab(`drip-tray-${tag}`, tray, DECK, 0.45, MAT.fitting, { inner: line(kit.planOutline(kit.insetPlan(tray, 0.35), DECK + 0.45, P, 2), MAT.fitting.crease, 0.3) });
      slab(`manifold-${tag}`, { x: -4.6, y: s * 14 - 0.35, w: 9.2, d: 0.7, r: 0 }, DECK, 0.7, MAT.machine);
    }
    // Hose-handling crane: pedestal, slewing house, jib stowed forward on its rest.
    cyl(`hose-crane-${tag}`, 9, s * 17, 1.25, DECK, 6.4, MAT.house, { steps: full ? 16 : 10 });
    slab(`hose-crane-${tag}`, { x: 7.3, y: s * 17 - 1.5, w: 4.4, d: 3, r: 0.4 }, DECK + 6.4, 2.2, MAT.house, {
      bevel: 0.2,
      inner: full && sees([1, 0, 0]) ? area(path([[11.7, s * 17 - 0.9, DECK + 7.5], [11.7, s * 17 + 0.9, DECK + 7.5], [11.7, s * 17 + 0.9, DECK + 8.25], [11.7, s * 17 - 0.9, DECK + 8.25]], true), INK.glass) : '',
    });
    const jibA = [11.75, s * 17, DECK + 8.0]; const jibB = [33, s * 17, DECK + 5.9];
    const jib = sweepFaces(jibA, jibB, boxProfile(0.45, 0.4));
    poly(`hose-crane-${tag}`, jib, MAT.house);
    if (full) {
      const rest = boxOf(jib.flat())[2] - 0.02;
      slab(`hose-crane-${tag}`, { x: 31.6, y: s * 17 - 0.5, w: 1, d: 1, r: 0 }, DECK, rest - DECK, MAT.machine);
    }
  }

  // Accommodation, bridge, mast and funnel on the poop deck.
  const houseWindows = (box, floors, opts = {}) => {
    if (!full) return '';
    const [x0, y0, x1, y1] = box;
    let d = '';
    const across1 = (a, b, gap) => { const out = []; for (let t = a; t <= b - 1.1 + 1e-6; t += gap) out.push(t); return out; };
    for (const z0 of floors) {
      const z1 = z0 + 0.95;
      if (sees([1, 0, 0])) for (const y of across1(y0 + 1.6, y1 - 1.6, 2.6)) d += path([[x1, y, z0], [x1, y + 1.1, z0], [x1, y + 1.1, z1], [x1, y, z1]], true);
      if (opts.aft && sees([-1, 0, 0])) for (const y of across1(y0 + 1.6, y1 - 1.6, 3.4)) d += path([[x0, y, z0], [x0, y + 1.1, z0], [x0, y + 1.1, z1], [x0, y, z1]], true);
      for (const [s] of SIDES) {
        if (!sees([0, s, 0])) continue;
        const y = s > 0 ? y1 : y0;
        for (const x of across1(x0 + 1.6, x1 - 1.6, 2.6)) d += path([[x, y, z0], [x + 1.1, y, z0], [x + 1.1, y, z1], [x, y, z1]], true);
      }
    }
    return area(d, INK.glass);
  };
  const tierSeams = (plan, zs, steps) => (full ? line(zs.map((z) => kit.sideSeam(plan, z, P, steps)).join(''), MAT.house.crease, 0.3) : '');
  const lower = { x: -151, y: -19, w: 22, d: 38, r: 0.8 };
  slab('house-lower', lower, PP, 25 - PP, MAT.house, { steps: 3, bevel: 0.3, inner: tierSeams(lower, [16.6, 19.4, 22.2], 3) + houseWindows([-151, -19, -129, 19], [17.5, 20.3, 23.1]) });
  const upper = { x: -150, y: -17, w: 20, d: 34, r: 0.8 };
  slab('house-upper', upper, 25, 5.6, MAT.house, { steps: 3, bevel: 0.3, inner: tierSeams(upper, [27.8], 3) + houseWindows([-150, -17, -130, 17], [25.9, 28.7], { aft: true }) });

  const bridgeGlass = () => {
    const [x0, y0, x1, y1] = [-146, -15, -132.5, 15];
    const z0 = 31.6; const z1 = 33.55;
    let band = ''; let panes = '';
    const faces = [];
    if (sees([1, 0, 0])) faces.push({ edge: (t, z) => [x1, t, z], from: y0 + 0.9, to: y1 - 0.9, panes: 12 });
    if (sees([-1, 0, 0])) faces.push({ edge: (t, z) => [x0, t, z], from: y0 + 0.9, to: y1 - 0.9, panes: 7 });
    for (const [s] of SIDES) if (sees([0, s, 0])) faces.push({ edge: (t, z) => [t, s > 0 ? y1 : y0, z], from: x0 + 0.9, to: x1 - 0.9, panes: 5 });
    for (const f of faces) {
      band += path([f.edge(f.from, z0), f.edge(f.to, z0), f.edge(f.to, z1), f.edge(f.from, z1)], true);
      if (!full) {
        panes += path([f.edge(f.from + 0.2, z0 + 0.3), f.edge(f.to - 0.2, z0 + 0.3), f.edge(f.to - 0.2, z1 - 0.25), f.edge(f.from + 0.2, z1 - 0.25)], true);
        continue;
      }
      const gap = 0.28; const width = (f.to - f.from - gap * (f.panes + 1)) / f.panes;
      for (let k = 0; k < f.panes; k++) {
        const a = f.from + gap + k * (width + gap);
        panes += path([f.edge(a, z0 + 0.22), f.edge(a + width, z0 + 0.22), f.edge(a + width, z1 - 0.18), f.edge(a, z1 - 0.18)], true);
      }
    }
    return area(band, INK.bridgeGlass) + area(panes, INK.lit);
  };
  slab('wheelhouse', { x: -146, y: -15, w: 13.5, d: 30, r: 0.6 }, 30.6, 3.4, MAT.house, { steps: 3, bevel: 0.25, inner: bridgeGlass() });
  // Bridge wings: an open deck plate out to the ship's side with a bulwark lip and a console.
  for (const [s, tag] of SIDES) {
    slab(`bridge-wing-${tag}`, { x: -139, ...across(s, 15, 29.6), w: 6.5, r: 0.3 }, 30.6, 0.5, MAT.house, { bevel: 0.15 });
    slab(`bridge-wing-${tag}`, { x: -133.1, ...across(s, 15, 29.6), w: 0.6, r: 0 }, 31.1, 1.1, MAT.house);
    if (full) {
      slab(`bridge-wing-${tag}`, { x: -139, ...across(s, 29.1, 29.6), w: 5.9, r: 0 }, 31.1, 1.1, MAT.house);
      slab(`bridge-wing-${tag}`, { x: -135.2, ...across(s, 27.2, 28.4), w: 1.2, r: 0 }, 31.1, 1.2, MAT.machine);
    }
    // Brackets under the cantilever: diagonal struts from the house side to the wing.
    if (full) put(`bridge-wing-${tag}`, [-138.6, s > 0 ? 17 : -29.2, 25.4, -133.4, s > 0 ? 29.2 : -17, 30.6], line(
      [-138.2, -133.8].map((x) => path([[x, s * 17, 25.4], [x, s * 29.0, 30.6]])).join(''), MAT.house.crease, 0.35));
  }
  slab('bridge-roof', { x: -146.6, y: -15.6, w: 14.8, d: 31.2, r: 0.5 }, 34, 0.45, MAT.house, { steps: 3, bevel: 0.25 });
  if (full) {
    // Monkey-island rail: four edge chunks so the mast between them sorts cleanly.
    const z = 34.45; const h = 1;
    const [x0, y0, x1, y1] = [-146.2, -15.2, -132.2, 15.2];
    const edges = [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]];
    for (const [a, b] of edges) {
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3.5));
      let d = path([[...a, z + h], [...b, z + h]]);
      for (let k = 0; k <= n; k++) { const t = k / n; d += path([[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z], [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z + h]]); }
      put('bridge-roof', boxOf([[...a, z], [...b, z + h]]), line(d, INK.houseRail, 0.3));
    }
    cyl('bridge-roof', -144.6, 9, 0.12, z, 3.4, MAT.house, { steps: 6 });
    cyl('bridge-roof', -144.6, -9, 0.12, z, 3.4, MAT.house, { steps: 6 });
  }
  // Radar mast: the pole is split at its platform so each piece sorts against it.
  const poleX = -139.6;
  if (mid) {
    cyl('radar-mast', poleX, 0, 0.5, 34.45, 40.2 - 34.45, MAT.house, { steps: full ? 12 : 8 });
    slab('radar-mast', { x: -141.3, y: -4.6, w: 3.8, d: 9.2, r: 0.3 }, 40.2, 0.35, MAT.house);
    cyl('radar-mast', poleX, 0, 0.4, 40.55, 45.2 - 40.55, MAT.house, { steps: full ? 12 : 8 });
    if (full) cyl('radar-x', -138.1, 0, 0.35, 40.55, 0.35, MAT.machine, { steps: 10 });
    bar('radar-x', [-138.1, -3.4, 41.05], [-138.1, 3.4, 41.05], boxProfile(0.25, 0.15), MAT.black);
    if (full) cyl('radar-s', poleX, 0, 0.3, 45.2, 0.35, MAT.machine, { steps: 10 });
    bar('radar-s', [poleX, -2.9, 45.7], [poleX, 2.9, 45.7], boxProfile(0.3, 0.15), MAT.black);
  } else {
    cyl('radar-mast', poleX, 0, 0.55, 34.45, 10.8, MAT.house, { steps: 8 });
  }
  // Raked funnel with its black cap band and three exhaust pipes.
  const rake = -2.6 / (42 - PP);
  const funnelPlan = kit.ringOf({ x: -159, y: -5.6, w: 7.6, d: 11.2, r: 2.4 }, 4);
  const funnelRing = (z) => funnelPlan.map(([x, y]) => [x + rake * (z - PP), y, z]);
  poly('funnel', loftFaces(funnelRing(PP), funnelRing(42)), MAT.house);
  poly('funnel-band', loftFaces(funnelRing(42), funnelRing(45)), MAT.black);
  const exhaustX = -159 + 3.8 + rake * (45 - PP);
  if (mid) for (const y of full ? [-2.4, 0, 2.4] : [-1.6, 1.6]) cyl('exhausts', exhaustX, y, 0.55, 45, 2, MAT.black, { steps: 10 });

  // Lifeboats in gravity davits on the aft quarters, at boat-deck level.
  for (const [s, tag] of SIDES) {
    if (!mid) continue;
    const boat = { x: -147.2, ...across(s, 20.7, 23.7), w: 9.4, r: 1.4 };
    if (full) {
      slab(`davits-${tag}`, { x: -148.6, ...across(s, 19, 25.2), w: 12.4, r: 0.3 }, 19, 0.4, MAT.house);
      for (const x of [-148, -137.8]) slab(`davits-${tag}`, { x, ...across(s, 19.3, 24.9), w: 0.8, r: 0 }, 19.4, 4, MAT.machine);
      slab(`lifeboat-${tag}`, boat, 19.9, 1.5, MAT.boat, { steps: 4 });
      slab(`lifeboat-${tag}`, kit.insetPlan(boat, 0.35), 21.4, 1.1, MAT.boat, { steps: 4, bevel: 0.2 });
    } else {
      slab(`lifeboat-${tag}`, boat, 19.9, 2.4, MAT.boat, { steps: 3 });
    }
  }

  // Stern: mooring winches, bitts and the provision crane.
  if (full) {
    for (const [s, tag] of SIDES) {
      slab(`winch-${tag}`, { x: -158.4, ...across(s, 10, 14), w: 3, r: 0.3 }, PP, 0.5, MAT.fitting);
      bar(`winch-${tag}`, [-156.9, s * 10.4, PP + 1.4], [-156.9, s * 13.6, PP + 1.4], roundProfile(0.9, facets), MAT.machine);
      slab(`stern-bitts-${tag}`, { x: -162, ...across(s, 18.2, 19.8), w: 3, r: 0.3 }, PP, 0.25, MAT.machine);
      for (const x of [-161.2, -159.8]) {
        cyl(`stern-bitts-${tag}`, x, s * 19, 0.48, PP + 0.25, 1.4, MAT.machine, { steps: 10, inner: line(kit.ring(x, s * 19, 0.3, PP + 1.65, P, 10), MAT.machine.crease, 0.3) });
      }
    }
    cyl('provision-crane', -126.6, 23.2, 0.7, PP, 4.4, MAT.house, { steps: 12 });
    const pjib = sweepFaces([-126.6, 22.44, PP + 4.15], [-126.6, 10.6, PP + 3.55], boxProfile(0.3, 0.28));
    poly('provision-crane', pjib, MAT.house);
    slab('provision-crane', { x: -126.9, y: 10.9, w: 0.6, d: 0.6, r: 0 }, PP, boxOf(pjib.flat())[2] - 0.02 - PP, MAT.machine);
  }
  return items;
}

// ---------------------------------------------------------------- painter's order
const SEPARATION = 1e-6;
function screenRect(box, P) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const x of [box[0], box[3]]) for (const y of [box[1], box[4]]) for (const z of [box[2], box[5]]) {
    const [sx, sy] = kit.iso([x, y, z], P);
    x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
  }
  return [x0, y0, x1, y1];
}
const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
/**
 * −1: a cannot hide b (draw a first); 1: b first; 0: no separating axis;
 * null: separations disagree, so the two can never overlap on screen.
 */
export function separation(a, b, V) {
  let vote = 0;
  for (let k = 0; k < 3; k++) {
    const low = a[k + 3] <= b[k] + SEPARATION;
    const high = b[k + 3] <= a[k] + SEPARATION;
    if (!low && !high) continue;
    const v = V[k];
    // A separating plane that contains the view direction keeps the two apart on screen.
    if (Math.abs(v) < 1e-9) return null;
    const s = low ? (v > 0 ? -1 : 1) : (v > 0 ? 1 : -1);
    if (vote && s !== vote) return null;
    vote = s;
  }
  return vote;
}
function paintOrder(items, P) {
  const { V } = viewOf(P);
  const n = items.length;
  const rects = items.map((item) => screenRect(item.box, P));
  const depth = items.map((item) => kit.depthOf([(item.box[0] + item.box[3]) / 2, (item.box[1] + item.box[4]) / 2, (item.box[2] + item.box[5]) / 2], P));
  const next = Array.from({ length: n }, () => []);
  const indegree = new Array(n).fill(0);
  const unresolved = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (items[i].layer !== items[j].layer || !overlaps(rects[i], rects[j])) continue;
      const verdict = separation(items[i].box, items[j].box, V);
      if (verdict === null) continue;
      if (verdict === 0) { unresolved.push([items[i].part, items[j].part]); continue; }
      const [first, second] = verdict < 0 ? [i, j] : [j, i];
      next[first].push(second); indegree[second]++;
    }
  }
  const order = []; const done = new Array(n).fill(false);
  const cycles = [];
  const rank = (i) => items[i].layer * 1e6 + depth[i];
  while (order.length < n) {
    let pick = -1;
    for (let i = 0; i < n; i++) if (!done[i] && indegree[i] === 0 && (pick < 0 || rank(i) < rank(pick))) pick = i;
    if (pick < 0) {
      // A cycle of "cannot hide" constraints: break it at the farthest remaining item.
      for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || rank(i) < rank(pick))) pick = i;
      cycles.push(items[pick].part);
    }
    done[pick] = true; order.push(pick);
    for (const j of next[pick]) indegree[j]--;
  }
  return { order, unresolved, cycles };
}

// ---------------------------------------------------------------- figure
function bounds(markup) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const take = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const [, d] of markup.matchAll(/ d="([^"]*)"/g)) for (const [, x, y] of d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) take(Number(x), Number(y));
  for (const [, x, y] of markup.matchAll(/cx="(-?[\d.]+)" cy="(-?[\d.]+)"/g)) take(Number(x), Number(y));
  return [x0, y0, x1, y1];
}
const tidy = (value) => String(Math.round(value * 100) / 100);

/**
 * The tanker as a standalone SVG string.
 * @param {{azimuth?: number, elevation?: number, detail?: 'low'|'mid'|'full', halo?: boolean}} options
 *   azimuth and elevation are kit angles in degrees (see the camera relation above).
 * @returns {{svg: string, width: number, height: number, anchor: {x: number, y: number}, ...}}
 *   `anchor` is the waterline centre in viewBox units; the viewBox is `0 0 width height`.
 */
export function tankerFigure({ azimuth = 45, elevation = 30, detail = 'full', halo = true } = {}) {
  const A = mod360(finite(azimuth, 45));
  const E = clamp(finite(elevation, 30), 5, 90);
  const level = Object.hasOwn(RANK, detail) ? detail : 'full';
  const P = { origin: [0, 0], scale: 1, azimuth: A, elevation: E };
  const items = buildItems(P, level);
  const { order, unresolved, cycles } = paintOrder(items, P);
  const body = order.map((i) => items[i].svg).join('');
  const blur = 2.2;
  const haloPath = halo ? kit.pathOf(WL_RING.map(([x, y]) => kit.iso([x * 1.006, y * 1.06, 0], P)), true) : '';
  const [bx0, by0, bx1, by1] = bounds(body);
  const [hx0, hy0, hx1, hy1] = halo ? bounds(` d="${haloPath}"`).map((v, i) => v + (i < 2 ? -3 : 3) * blur) : [bx0, by0, bx1, by1];
  const pad = 1.5;
  const left = Math.min(bx0, hx0) - pad; const topEdge = Math.min(by0, hy0) - pad;
  const width = Math.ceil(Math.max(bx1, hx1) + pad - left);
  const height = Math.ceil(Math.max(by1, hy1) + pad - topEdge);
  const tx = -left; const ty = -topEdge;
  const id = `passage-ship-halo-${level}-${tidy(A).replace('.', '_')}-${tidy(E).replace('.', '_')}`;
  const defs = halo ? `<defs><filter id="${id}" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="${blur}"/></filter></defs>` : '';
  const shadow = halo ? `<path fill="#00060c" opacity=".55" filter="url(#${id})" d="${haloPath}"/>` : '';
  const style = '<style>.passage-ship .l{fill:none;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}</style>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="passage-ship" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false" data-azimuth="${tidy(A)}" data-elevation="${tidy(E)}" data-detail="${level}">${style}${defs}<g transform="translate(${tidy(tx)} ${tidy(ty)})" stroke-width="${STROKES[level].edge}">${shadow}${body}</g></svg>`;
  const parts = [...new Set(items.map((item) => item.part))];
  return {
    svg, width, height,
    anchor: { x: tx, y: ty },
    azimuth: A, elevation: E, detail: level,
    unitsPerMetre: UNITS_PER_METRE,
    lengthUnits: LOA * UNITS_PER_METRE,
    bowScreenDegrees: screenBowDegrees(A, E),
    partCount: parts.length,
    itemCount: items.length,
    parts,
    order: order.map((i) => items[i].part),
    diagnostics: { unresolved, cycles },
  };
}

/** Item boxes and draw order, for painter's-order checks (ship coordinates, metres). */
export function tankerItems({ azimuth = 45, elevation = 30, detail = 'full' } = {}) {
  const P = { origin: [0, 0], scale: 1, azimuth: mod360(finite(azimuth, 45)), elevation: clamp(finite(elevation, 30), 5, 90) };
  const items = buildItems(P, Object.hasOwn(RANK, detail) ? detail : 'full');
  const { order } = paintOrder(items, P);
  return { projection: P, view: viewOf(P).V, items: order.map((i) => ({ part: items[i].part, layer: items[i].layer, box: items[i].box, rect: screenRect(items[i].box, P) })) };
}
