// Purposeful physical assemblies for the conceptual oil-system illustration.
// All dimensions use the same projection as the tanker; none are live readings.
const wrap = parts => `<g class="system-object system-facility" transform="translate(0 6)" aria-hidden="true">${parts.join('')}</g>`;

function circle(x, y, radius, start = 0, sweep = Math.PI * 2, steps = 48) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = start + sweep * index / steps;
    return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)];
  });
}

function storageTank(g, x, y, radius, height) {
  const out = [], bottom = 2, top = bottom + height;
  const footing = circle(x, y, radius + 1.4, -Math.PI / 4, Math.PI, 32);
  out.push(g.face([...g.plan(footing, bottom), ...g.plan([...footing].reverse(), 0)], 'system-object-fitting'));
  out.push(g.face(g.plan(circle(x, y, radius + 1.4), bottom), 'system-object-hatch'));
  // The kit owns the cylinder's volume and four-tone facing, with seams drawn
  // under its outline so they terminate on the true silhouette.
  out.push(g.cylinder(x, y, radius, bottom, height,
    [bottom + height / 3, bottom + 2 * height / 3].map(z => g.seam(x, y, radius, z)).join('')));
  out.push(g.line(g.plan(circle(x, y, radius - 1), top + .2)));
  out.push(g.hatch(x - 2, y - 1, 3.3, top, 1.2));
  out.push(g.hatch(x + 3.5, y - 2, 1.2, top, 2.2));
  out.push(g.hatch(x + 3.5, y - 2, 1.8, top + 2.2, .6));
  // A ladder is supported against the near wall, reaching the roof platform.
  const ladderY = y + radius + .7;
  for (const dx of [-2, 2]) out.push(g.line([g.point(x + dx, ladderY, bottom), g.point(x + dx, ladderY, top + 2)], 'system-object-rail'));
  for (let z = bottom + 3; z < top; z += 4) out.push(g.line([g.point(x - 2, ladderY, z), g.point(x + 2, ladderY, z)], 'system-object-rail'));
  out.push(g.box(x - 3, ladderY - 3, 6, 4, top, .8, 'system-object-fitting'));
  return out.join('');
}

function pipe(g, points) {
  const projected = points.map(point => g.point(...point));
  return g.line(projected, 'system-facility-pipe')
    + g.line(projected, 'system-facility-pipe-highlight');
}

export function exportTerminal(g) {
  const out = [];
  // Two storage vessels define the silhouette; fittings occupy the clear apron.
  out.push(storageTank(g, -19, 4, 12, 31));
  out.push(storageTank(g, 11, -18, 14, 40));
  // Saddle supports sit below the two manifold runs, away from the tank walls.
  for (const x of [-13, 0, 27.5]) out.push(g.box(x - 1, 21.5, 2, 3, 0, 4.5, 'system-object-fitting'));
  out.push(g.box(27.5, -7, 3, 2, 0, 4.5, 'system-object-fitting'));
  out.push(pipe(g, [[-19, 16, 6], [-19, 23, 6], [8, 23, 6]]));
  out.push(pipe(g, [[25, -18, 6], [29, -18, 6], [29, 23, 6], [22, 23, 6]]));
  // Short valve bodies, stems and closed handwheels belong to the pipe runs.
  for (const x of [-8, 27]) {
    out.push(g.box(x - 2, 21.5, 4, 3, 4.5, 3, 'system-object-fitting'));
    out.push(g.hatch(x, 23, .65, 7.5, 3));
    out.push(g.line(g.plan(circle(x, 23, 2.3, 0, Math.PI * 2, 24), 10.5), 'system-object-rail'));
    out.push(g.line([g.point(x - 2.3, 23, 10.5), g.point(x + 2.3, 23, 10.5)], 'system-object-rail'));
    out.push(g.line([g.point(x, 20.7, 10.5), g.point(x, 25.3, 10.5)], 'system-object-rail'));
  }
  out.push('<g class="system-mechanism-focus">');
  // A mounted pump and motor terminate the pipes; the outlet faces the apron.
  out.push(g.box(6, 16, 18, 15, 0, 1.6, 'system-object-fitting'));
  out.push(g.box(8, 18, 14, 10, 1.6, 7.3, 'system-object-fitting'));
  out.push(g.box(9, 18.6, 5, 8.8, 8.9, 1.3, 'system-object-pipe'));
  out.push(g.hatch(18, 23, 3.6, 8.9, 2));
  out.push(g.hatch(18, 23, 1.2, 10.9, .7));
  for (const x of [10, 11.7, 13.4]) out.push(g.line([g.point(x, 18.6, 10.2), g.point(x, 27.4, 10.2)]));
  for (const [x, y] of [[7.2, 17.3], [22.8, 17.3], [7.2, 29.7], [22.8, 29.7]]) out.push(g.hatch(x, y, .55, 1.6, .4));
  out.push(pipe(g, [[18, 28, 6], [18, 35, 6]]));
  out.push(g.box(16, 34, 4, 2.4, 4, 4, 'system-object-fitting'));
  out.push('</g>');
  // The blank service cabinet has a recessed door and grille, not a status screen.
  out.push(g.box(-31, 26, 9, 8, 0, 14));
  out.push(g.face([g.point(-29.7, 34.1, 2), g.point(-23.3, 34.1, 2), g.point(-23.3, 34.1, 12), g.point(-29.7, 34.1, 12)], 'system-object-fitting'));
  for (const z of [8, 9.7, 11.4]) out.push(g.line([g.point(-28.5, 34.2, z), g.point(-24.5, 34.2, z)]));
  out.push(g.line([g.point(-24, 34.2, 3.5), g.point(-24, 34.2, 5.5)], 'system-object-rail'));
  return wrap(out);
}

export function insuranceOffice(g) {
  const out = [];
  // A low harbor office with an entrance, roof plant and a mounted cover plaque.
  out.push(g.box(-25, -23, 46, 36, 0, 2, 'system-object-fitting'));
  out.push(g.box(-24, -22, 44, 34, 2, 38));
  // Front glazing sits in the wall plane; each mullion reaches its frame.
  for (const [x, width] of [[-20, 10], [-5, 10], [10, 6]]) {
    out.push(g.face([g.point(x, 12.15, 26), g.point(x + width, 12.15, 26), g.point(x + width, 12.15, 35), g.point(x, 12.15, 35)], 'system-object-window'));
    out.push(g.line([g.point(x + width / 2, 12.3, 26), g.point(x + width / 2, 12.3, 35)], 'system-object-rail'));
    out.push(g.box(x - .6, 11.8, width + 1.2, 1.2, 25.2, .8, 'system-object-fitting'));
  }
  out.push(g.face([g.point(-17, 12.2, 2), g.point(-5, 12.2, 2), g.point(-5, 12.2, 22), g.point(-17, 12.2, 22)], 'system-object-window'));
  out.push(g.box(-18, 12, 14, 1.2, 21.5, 1.4, 'system-object-fitting'));
  out.push(g.line([g.point(-7, 12.5, 9), g.point(-7, 12.5, 13)], 'system-object-rail'));
  out.push(g.line([g.point(-17, 12.4, 7), g.point(-5, 12.4, 7)], 'system-object-rail'));
  out.push('<g class="system-mechanism-focus">');
  // A cover document in a physical frame: printed terms, never a live premium.
  out.push(g.box(4, 12, 12, 1.2, 7, 14, 'system-object-fitting'));
  out.push(g.face([g.point(5, 13.25, 8), g.point(15, 13.25, 8), g.point(15, 13.25, 20), g.point(5, 13.25, 20)], 'system-record-page'));
  for (const z of [11, 14, 17]) out.push(g.line([g.point(7, 13.4, z), g.point(13, 13.4, z)]));
  out.push('</g>');
  // Roof overhang, parapet and vent are seated on the building, not floating icons.
  out.push(g.box(-26, -24, 48, 38, 40, 2));
  out.push(g.box(-25, -23, 46, 1, 42, 2));
  out.push(g.box(-25, -22, 1, 34, 42, 2));
  out.push(g.box(20, -22, 1, 34, 42, 2));
  out.push(g.box(-25, 12, 46, 1, 42, 2));
  out.push(g.box(-12, -9, 13, 9, 42, 4, 'system-object-fitting'));
  for (const x of [-10, -7.5, -5, -2.5]) out.push(g.line([g.point(x, -8, 46.1), g.point(x, -1, 46.1)]));
  // The shield has thickness and sits directly against the visible side wall.
  const shield = [[-14, 30], [-7, 33], [2, 30], [2, 19], [0, 15], [-6, 10], [-12, 15], [-14, 19]];
  const shieldFace = x => shield.map(([y, z]) => g.point(x, y, z));
  const shieldBack = shieldFace(20), shieldFront = shieldFace(21.8);
  for (let index = 0; index < shield.length; index++) {
    const next = (index + 1) % shield.length;
    out.push(g.face([shieldBack[index], shieldBack[next], shieldFront[next], shieldFront[index]], 'system-object-fitting'));
  }
  out.push(g.face(shieldFace(21.8), 'system-art-shield'));
  out.push(g.line([g.point(22, -6, 31.5), g.point(22, -6, 11.5)], 'system-art-shield-seam'));
  // Doorstep, low handrails and quay bollards anchor the office to its apron.
  out.push(g.box(-19, 12, 16, 6, 0, 2, 'system-object-fitting'));
  out.push(g.box(-19, 18, 16, 5, 0, 1, 'system-object-fitting'));
  for (const x of [-20, -2]) {
    out.push(g.line([g.point(x, 13, 2), g.point(x, 13, 9), g.point(x, 23, 8), g.point(x, 23, 0)], 'system-object-rail'));
  }
  for (const x of [-28, 26]) {
    out.push(g.hatch(x, 25, 2.5, 0, .8));
    out.push(g.hatch(x, 25, 1.1, .8, 4.2));
    out.push(g.hatch(x, 25, 1.8, 5, .6));
  }
  return wrap(out);
}
