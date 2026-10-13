import { exportTerminal, insuranceOffice } from './oil-system-facilities.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// Original schematic artwork. These assemblies represent mechanisms, never the
// operating state of a particular terminal, vessel, route or market instrument.
const base = `<path class="system-art-shadow" d="M-85 12 0-27 85 12 0 51Z"/>
  <path class="system-art-side" d="M-76 0 0 35 76 0V10L0 45-76 10Z"/>
  <path class="system-art-base" d="M-76 0 0-35 76 0 0 35Z"/>
  <path class="system-art-ring" d="M-84 1 0-38 84 1 0 40Z"/>`;

// Anatomy craft: a long hull silhouette and purposeful fittings, all projected
// from the same coordinates. Drawing units are not a particular ship's specs.
function systemGeometry() {
  const point = (x, y, z = 0) => [0.9 * (x - y), 0.42 * (x + y) - z - 6];
  const path = points => points.map((p, i) => `${i ? 'L' : 'M'}${p.map(n => Number(n.toFixed(2))).join(' ')}`).join('');
  const face = (points, style) => `<path class="${style}" d="${path(points)}Z"/>`;
  const line = (points, style = 'system-object-detail') => `<path class="${style}" d="${path(points)}"/>`;
  const plan = (points, z) => points.map(([x, y]) => point(x, y, z));
  const box = (x, y, w, d, z, h, style = 'system-object-cabin') => {
    const a = point(x, y, z + h), b = point(x + w, y, z + h);
    const c = point(x + w, y + d, z + h), e = point(x, y + d, z + h);
    return face([b, c, point(x + w, y + d, z), point(x + w, y, z)], `${style} system-object-side`)
      + face([c, e, point(x, y + d, z), point(x + w, y + d, z)], `${style} system-object-end`)
      + face([a, b, c, e], `${style} system-object-top`);
  };
  const hatch = (x, y, r, z, h) => {
    const ring = Array.from({ length: 16 }, (_, i) => [x + r * Math.cos(i * Math.PI / 8), y + r * Math.sin(i * Math.PI / 8)]);
    return face([...plan(ring.slice(0, 9), z + h), ...plan(ring.slice(0, 9).reverse(), z)], 'system-object-fitting')
      + face(plan(ring, z + h), 'system-object-hatch');
  };
  return { point, path, face, line, plan, box, hatch };
}

function tanker() {
  const { point, face, line, plan, box, hatch } = systemGeometry();
  const hull = [[0, -87], [8, -76], [14, -62], [18, -42], [18, 60], [16, 67], [11, 72], [-11, 72], [-16, 67], [-18, 60], [-18, -42], [-14, -62], [-8, -76]];
  const bottom = hull.map(([x, y]) => [x * 0.83, y * 0.95]);
  const out = ['<g class="system-object system-tanker" transform="scale(.82)" aria-hidden="true">'];
  // The water plinth follows the vessel's long axis, so the bow remains supported.
  const water = [[-28, -97], [28, -97], [28, 80], [-28, 80]];
  out.push(face(plan([[-33, -102], [33, -102], [33, 85], [-33, 85]], -8), 'system-art-shadow'));
  out.push(face([point(28, -97, -2), point(28, 80, -2), point(28, 80, -7), point(28, -97, -7)], 'system-art-side'));
  out.push(face([point(28, 80, -2), point(-28, 80, -2), point(-28, 80, -7), point(28, 80, -7)], 'system-art-side'));
  out.push(face(plan(water, -2), 'system-art-base'));
  out.push(face(plan([[-31, -100], [31, -100], [31, 83], [-31, 83]], -1), 'system-art-ring'));
  out.push(line(plan([[-23, -70], [-23, -25]], -1), 'system-art-water'));
  out.push(line(plan([[23, -38], [23, 30]], -1), 'system-art-water'));
  out.push(face(plan(hull, -2), 'system-art-shadow'));
  // The visible hull faces and flush deck share one outline, with no inset well.
  for (let i = 0; i < 7; i++) out.push(face([point(...hull[i], 12), point(...hull[i + 1], 12), point(...bottom[i + 1], 0), point(...bottom[i], 0)], 'system-object-hull'));
  out.push(face(plan(hull, 12), 'system-object-deck'));
  const waterline = hull.slice(0, 8).map(([x, y], i) => [bottom[i][0] * .75 + x * .25, bottom[i][1] * .75 + y * .25]);
  out.push(line(plan(waterline, 3), 'system-object-waterline'));
  // Low cargo-tank covers leave an open working deck rather than container stacks.
  for (const y of [-48, -32, -16, 0, 16, 32]) for (const x of [-10, 10]) {
    out.push(hatch(x, y, 3.4, 12, 1), hatch(x, y, 2.7, 13, 0.5));
  }
  for (const y of [-45, -15, 15]) out.push(box(-5, y, 10, 1.4, 12, 1.4, 'system-object-fitting'));
  out.push(box(-15, -7, 30, 2, 12, 1.4, 'system-object-fitting'));
  for (const x of [-15, 13]) for (const y of [-7, -3]) out.push(box(x, y, 2, 2, 13.4, 1.3, 'system-object-pipe'));
  for (const x of [-3, 2]) out.push(box(x, -57, 1, 94, 13.4, 1, 'system-object-pipe'));
  out.push(box(-5, -69, 10, 7, 12, 1.3, 'system-object-fitting'));
  for (const x of [-3, 3]) out.push(hatch(x, -66, 1, 13.3, 1.8));
  const rail = [[-14, -55], [-10, -68], [0, -84], [10, -68], [14, -55]];
  out.push(line(plan(rail, 15.5), 'system-object-rail'));
  for (const [x, y] of rail) out.push(line([point(x, y, 12), point(x, y, 15.5)], 'system-object-rail'));
  // Taller accommodation, bridge wings and glazing establish the stern.
  out.push(box(-13, 43, 26, 22, 12, 3));
  out.push(box(-10, 46, 20, 19, 15, 14));
  out.push(box(-16, 44, 32, 13, 29, 1.8));
  out.push(box(-12, 45, 24, 11, 30.8, 6));
  for (const x of [-10, -6, -2, 2, 6]) out.push(face([point(x, 56, 32.3), point(x + 2.6, 56, 32.3), point(x + 2.6, 56, 35.4), point(x, 56, 35.4)], 'system-object-window'));
  out.push(face([point(12, 47, 32.3), point(12, 54, 32.3), point(12, 54, 35.4), point(12, 47, 35.4)], 'system-object-window'));
  out.push(box(-13, 44, 26, 13, 36.8, 1.2));
  for (const z of [19, 24]) out.push(line([point(10, 46, z), point(10, 65, z), point(-10, 65, z)]));
  out.push(box(-4, 60, 8, 5, 29, 12, 'system-object-funnel'));
  out.push(box(-4.5, 59.5, 9, 6, 41, 1.2, 'system-object-pipe'));
  out.push(line([point(0, 49, 38), point(0, 49, 49)], 'system-object-mast'));
  out.push(line([point(-4, 49, 45), point(4, 49, 45)], 'system-object-mast'));
  out.push(box(-4, 48, 8, 2, 49, 1, 'system-object-fitting'));
  for (const x of [-9, 9]) out.push(hatch(x, 68, 1.2, 12, 1.6));
  out.push('</g>');
  return out.join('');
}

function marketStation() {
  const { point, face, line, plan, box } = systemGeometry();
  const out = ['<g class="system-object system-market-station" transform="translate(0 6)" aria-hidden="true">'];
  // An analyst's physical two-screen station; the glass contains no invented
  // prices or trends. Actual dated observations remain in the adjacent readout.
  out.push(box(-32, -23, 64, 46, 0, 3, 'system-object-fitting'));
  out.push(box(-29, -20, 17, 37, 3, 26));
  out.push(box(17, -20, 12, 37, 3, 26));
  // Cabinet drawers and a recessed equipment bay keep the support legible.
  for (const z of [10, 18, 25]) {
    out.push(line([point(-29, 17, z), point(-12, 17, z)]));
    out.push(face([point(-24, 17.1, z - 3), point(-18, 17.1, z - 3), point(-18, 17.1, z - 1.8), point(-24, 17.1, z - 1.8)], 'system-object-window'));
  }
  out.push(face([point(29, -15, 8), point(29, 10, 8), point(29, 10, 24), point(29, -15, 24)], 'system-object-window'));
  for (const y of [-12, -6, 0, 6]) out.push(line([point(29.1, y, 10), point(29.1, y, 22)], 'system-market-vent'));
  out.push(box(-34, -25, 68, 50, 29, 2.4));
  for (const [x, y] of [[-31,-22],[31,-22],[31,22],[-31,22]]) {
    const [cx, cy] = point(x, y, 31.4);
    out.push(`<circle class="system-object-fitting" cx="${cx}" cy="${cy}" r=".65"/>`);
  }
  for (const x of [-17, 17]) {
    out.push(box(x - 6, -16, 12, 9, 31.4, 1.2, 'system-object-fitting'));
    out.push(box(x - 1.7, -14, 3.4, 3, 32.6, 8, 'system-object-fitting'));
    out.push(box(x - 14, -16, 28, 3, 40.6, 23));
    out.push(face([point(x - 11.5, -12.95, 43.1), point(x + 11.5, -12.95, 43.1), point(x + 11.5, -12.95, 61.1), point(x - 11.5, -12.95, 61.1)], 'system-object-window'));
    // One reflection plane distinguishes glass from an empty opening.
    out.push(face([point(x - 10, -12.9, 60), point(x - 2, -12.9, 60), point(x + 8, -12.9, 44.5), point(x, -12.9, 44.5)], 'system-market-reflection'));
    out.push(box(x + 8.8, -12.8, 1.4, .5, 41.5, .6, 'system-object-fitting'));
  }
  // Keyboard keys and pointer are mounted on the desk, not floating glyphs.
  out.push(box(-26, 4, 35, 12, 31.4, 1, 'system-object-fitting'));
  for (const y of [6, 9, 12]) for (const x of [-23, -18, -13, -8, -3, 2]) out.push(box(x, y, 3.5, 1.8, 32.4, .45));
  out.push(box(16, 6, 7, 11, 31.4, 1.5));
  out.push(line([point(19.5, 6, 32.9), point(19.5, 10, 32.9)]));
  out.push(box(-31, -5, 12, 7, 31.4, 1.4, 'system-object-fitting'));
  out.push(face(plan([[-30, -4], [-20, -4], [-20, 1], [-30, 1]], 33), 'system-object-top'));
  out.push('</g>');
  return out.join('');
}

const drawings = {
  supply: exportTerminal(systemGeometry()),
  transport: tanker(),
  risk: insuranceOffice(systemGeometry()),
  benchmarks: marketStation(),
};

const shortLabels = { supply: 'Exports', transport: 'Passage & freight', risk: 'Security & cover', benchmarks: 'Oil benchmarks' };

export function oilSystemArt(stages) {
  const parts = stages.map((stage, index) => `<g class="system-part${stage.selected ? ' is-selected' : ''}${stage.matched ? ' is-matched' : ''}" data-system-part="${escape(stage.id)}" style="transform:translate(${stage.position.x}px,${stage.position.y}px)">
    <title>${escape(stage.title)}. Select to inspect this conceptual part of the oil system.</title>
    ${stage.id === 'transport' ? '' : base}${drawings[stage.id] || ''}
    <g class="system-art-number" transform="translate(-62 -68)"><circle r="13"/><text text-anchor="middle" y="4">${index + 1}</text></g>
    <text class="system-art-label" x="0" y="68" text-anchor="middle">${escape(shortLabels[stage.id] || stage.title)}</text>
  </g>`).join('');
  return `<svg class="system-art" viewBox="0 0 720 370" role="img" aria-label="Conceptual oil system: export availability, passage and freight, security and insurance, and oil benchmarks. Select a part using the diagram or the numbered controls. The drawing is not live flow, a map, or a price forecast.">
    <path class="system-art-guide" d="M56 294 368 150 665 12M55 308 367 164 665 26"/>
    <path class="system-art-connector" d="M135 188 285 250 435 188 585 126"/>
    <g class="system-art-anchors"><circle cx="135" cy="188" r="3"/><circle cx="285" cy="250" r="3"/><circle cx="435" cy="188" r="3"/><circle cx="585" cy="126" r="3"/></g>
    ${parts}
  </svg>`;
}
