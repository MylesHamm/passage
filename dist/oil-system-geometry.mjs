import * as anatomy from './vendor/anatomy/iso-kit.mjs';

// Keep the accepted Passage camera exactly, using Anatomy for the actual
// projection and solids. These are drawing units, never vessel specifications.
const elevation = Math.asin(0.42 / 0.9) * 180 / Math.PI;
export const OIL_SYSTEM_PROJECTION = Object.freeze({
  origin: Object.freeze([0, -6]), scale: 0.9 * Math.sqrt(2 / 1.6),
  azimuth: 45, elevation,
});
const heightScale = 1 / (0.9 * Math.sqrt(2) * Math.cos(elevation * Math.PI / 180));

export function systemGeometry() {
  const point = (x, y, z = 0) => anatomy.iso([x, y, z * heightScale], OIL_SYSTEM_PROJECTION);
  const path = points => anatomy.pathOf(points);
  const face = (points, style) => `<path class="${style}" d="${anatomy.pathOf(points, true)}"/>`;
  const line = (points, style = 'system-object-detail') => `<path class="${style}" d="${path(points)}"/>`;
  const plan = (points, z) => points.map(([x, y]) => point(x, y, z));
  const box = (x, y, w, d, z, h, style = 'system-object-cabin') => anatomy.solidSvg(
    anatomy.slabOf({ x, y, w, d, r: Math.min(.3, w / 5, d / 5) }, z * heightScale, h * heightScale, OIL_SYSTEM_PROJECTION, 2, Math.min(.22, h / 4)),
    { className: style, tone: 'mid', crease: 'faint' },
  );
  const hatch = (x, y, r, z, h) => anatomy.solidSvg(
    anatomy.cylinder(x, y, r, z * heightScale, h * heightScale, OIL_SYSTEM_PROJECTION, r > 3 ? 32 : 20, Math.min(.15, h / 3)),
    { className: 'system-object-fitting system-object-hatch-solid', tone: 'mid', crease: 'faint' },
  );
  const cylinder = (x, y, r, z, h, inner = '') => anatomy.solidSvg(
    anatomy.cylinder(x, y, r, z * heightScale, h * heightScale, OIL_SYSTEM_PROJECTION, 64, .35),
    { className: 'system-object-tank-shell', tone: 'mid', crease: 'faint', inner },
  );
  const seam = (x, y, r, z) => anatomy.lineSvg(anatomy.sideArc(x, y, r, z * heightScale, OIL_SYSTEM_PROJECTION, 40), { tone: 'faint' });
  return { point, path, face, line, plan, box, hatch, cylinder, seam };
}
