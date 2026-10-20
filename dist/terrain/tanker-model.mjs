import * as anatomy from '../vendor/anatomy/iso-kit.mjs';
import {normalizeVesselTypeCode, isSnapshotVessel, POSITION_STALE_MS, POSITION_EXPIRE_MS, TYPE_EXPIRE_MS} from '../vessel-data.mjs';

const time = value => typeof value === 'string' && value.trim()
  && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const angle = value => Number.isFinite(value) && value >= 0 && value < 360 ? value : null;

function typeStatus(vessel, now) {
  const code = normalizeVesselTypeCode(vessel.shipTypeCode);
  if (code === null) return 'unreported';
  if (code < 80 || code > 89) return 'not_tanker';
  if (vessel.shipTypeObservedAt != null) {
    const at = time(vessel.shipTypeObservedAt);
    if (at === null) return 'invalid_time';
    if (at > now) return 'future';
    if (now - at >= TYPE_EXPIRE_MS) return 'expired';
  } else if (vessel.shipTypeProvider && vessel.shipTypeProvider !== vessel.provider) {
    return 'undated_other_provider';
  }
  return 'reported';
}

/** Pure presentation for a normalized AIS record. Does not establish display rights. */
export function tankerPresentation(vessel, now) {
  vessel = vessel && typeof vessel === 'object' ? vessel : {};
  const clockValid = Number.isFinite(now);
  const at = time(vessel.positionTime);
  const age = clockValid && at !== null ? now - at : null;
  const expired = age !== null && age >= POSITION_EXPIRE_MS;
  const coordinatesValid = Number.isFinite(vessel.latitude) && Math.abs(vessel.latitude) <= 90
    && Number.isFinite(vessel.longitude) && Math.abs(vessel.longitude) <= 180;
  const positionValid = !isSnapshotVessel(vessel) && age !== null && age >= 0 && !expired && coordinatesValid;
  const category = clockValid ? typeStatus(vessel, now) : 'invalid_clock';
  const heading = angle(vessel.headingDegrees);
  const course = angle(vessel.courseDegrees);
  const bearingDegrees = heading ?? course;
  const bearingBasis = heading !== null ? 'heading' : course !== null ? 'course' : 'unavailable';
  const visible = positionValid && category === 'reported';
  const timestampBasis = ['provider', 'received'].includes(vessel.timestampBasis)
    ? vessel.timestampBasis : 'unknown';
  const expiryDate = at === null ? null : new Date(at + POSITION_EXPIRE_MS);
  return {
    visible,
    marker: !visible ? 'none' : bearingDegrees === null ? 'neutral' : 'tanker',
    point: positionValid ? [vessel.longitude, vessel.latitude] : null,
    bearingDegrees, bearingBasis,
    orientationLabel: bearingBasis === 'heading' ? `Reported heading ${heading}°`
      : bearingBasis === 'course' ? `Course over ground ${course}°; heading unavailable`
        : 'Heading and course unavailable; direction not shown',
    ageSeconds: age === null || age < 0 ? null : Math.floor(age / 1000),
    stale: age !== null && age >= POSITION_STALE_MS,
    expired,
    positionTime: at === null ? null : vessel.positionTime,
    expiresAt: expiryDate && Number.isFinite(expiryDate.getTime()) ? expiryDate.toISOString() : null,
    timestampBasis,
    timestampLabel: timestampBasis === 'provider'
      ? 'Provider timestamp; its observation or last-heard basis requires source verification'
      : timestampBasis === 'received'
        ? 'Original receipt time; upstream observation time unavailable'
        : 'Position timestamp basis unavailable',
    typeStatus: category,
  };
}

// Figure concept and parts list precede this geometry in docs/TANKER-MODEL.md.
// This is a fixed-size oriented map symbol, not a vessel's measured footprint.
// Bow is -y, projected vertically up. Its origin is the geographic marker anchor.
const projection = Object.freeze({origin: [0, 0], scale: 1, azimuth: 90, elevation: 70});
const fill = 'var(--tanker-face, #bfcfd5)';
const top = 'var(--tanker-top, #eef4f5)';
const ink = 'var(--tanker-ink, #163441)';
const shades = [
  'var(--tanker-shade-0, #819ca8)', 'var(--tanker-shade-1, #93acb6)',
  'var(--tanker-shade-2, #a7bdc5)', 'var(--tanker-shade-3, #c0d1d7)',
];

function solid(paths, part) {
  return `<g data-tanker-part="${part}"><path fill="${fill}" d="${paths.fill}"/>`
    + paths.shades.map((d, i) => d ? `<path fill="${shades[i]}" d="${d}"/>` : '').join('')
    + `<path fill="${top}" d="${paths.top}"/>`
    + `<path fill="none" stroke="${ink}" stroke-width=".9" stroke-linejoin="round" d="${paths.outline}"/></g>`;
}

function buildTanker() {
  // Original Passage hull and deck proportions, adapted without its water plinth.
  const hull = [[0,-87],[8,-76],[14,-62],[18,-42],[18,60],[16,67],[11,72],[-11,72],[-16,67],[-18,60],[-18,-42],[-14,-62],[-8,-76]];
  const out = [solid(anatomy.extrude(hull, 0, 10, projection), 'hull'),
    solid(anatomy.extrude(hull, 10, 2, projection), 'deck')];
  const parts = [];
  const add = (paths, part, center) => parts.push({svg: solid(paths, part), depth: anatomy.depthOf(center, projection)});
  const box = (x, y, w, d, z, h, part) => add(
    anatomy.slabOf({x,y,w,d,r:Math.min(.4,w/5,d/5)},z,h,projection,2,.15),
    part, [x+w/2,y+d/2,z+h/2]);
  const round = (x, y, r, z, h, part) => add(
    anatomy.cylinder(x,y,r,z,h,projection,20,.1),part,[x,y,z+h/2]);
  for (const y of [-48,-32,-16,0,16,32]) for (const x of [-10,10]) {
    round(x,y,3.4,12,1,'hatch-base');
    round(x,y,2.7,13,.5,'hatch-cover');
  }
  // Manifold runs sit on the deck. Their junctions are schematic fittings.
  for (const y of [-45,-15,15]) box(-5,y,10,1.4,12,1.4,'cross-manifold');
  box(-15,-7,30,2,12,1.4,'main-manifold');
  for (const x of [-15,13]) for (const y of [-7,-3]) box(x,y,2,2,13.4,1.3,'flange');
  for (const x of [-3,2]) box(x,-57,1,94,13.4,1,'deck-run');
  box(-5,-69,10,7,12,1.3,'windlass-base');
  for (const x of [-3,3]) round(x,-66,1,13.3,1.8,'windlass-drum');
  for (const x of [-10,10]) round(x,-58,1.2,12,1.6,'bow-bollard');
  for (const x of [-9,9]) round(x,68,1.2,12,1.6,'stern-bollard');
  box(-13,43,26,22,12,3,'accommodation-base');
  box(-10,46,20,19,15,14,'accommodation');
  box(-16,44,32,13,29,1.8,'bridge-wings');
  box(-12,45,24,11,30.8,6,'wheelhouse');
  box(-13,44,26,13,36.8,1.2,'bridge-roof');
  box(-4,60,8,5,29,12,'funnel');
  box(-4.5,59.5,9,6,41,1.2,'funnel-cap');
  round(0,49,.7,38,11,'mast');
  box(-4,48,8,2,49,1,'radar');
  for (const x of [-10,-6,-2,2,6]) {
    const points = [[x,56,32.3],[x+2.6,56,32.3],[x+2.6,56,35.4],[x,56,35.4]];
    parts.push({depth:anatomy.depthOf([x+1.3,56,33.85],projection),
      svg:`<path data-tanker-part="window" fill="${ink}" d="${anatomy.pathOf(points.map(p=>anatomy.iso(p,projection)),true)}"/>`});
  }
  parts.sort((a,b)=>a.depth-b.depth);
  return out.join('')+parts.map(part=>part.svg).join('');
}

const tankerArt = buildTanker();
const neutralArt = `<circle cx="0" cy="0" r="35" fill="${top}" stroke="${ink}" stroke-width="7"/><circle cx="0" cy="0" r="11" fill="${ink}"/>`;

/** Decorative SVG for an accessible map button. Parent projects the bearing. */
export function tankerSvg(presentation, {size = 32} = {}) {
  if (!presentation?.visible) return '';
  const pixels = Number.isFinite(size) ? Math.max(24,Math.min(36,size)) : 32;
  const directional = presentation.marker === 'tanker' && angle(presentation.bearingDegrees) !== null;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="passage-tanker-svg" viewBox="-112 -112 224 224" width="${pixels}" height="${pixels}" aria-hidden="true" focusable="false" data-tanker-symbol="${directional?'tanker':'neutral'}" data-illustrative-scale="true" data-stale="${Boolean(presentation.stale)}"><g opacity="${presentation.stale ? .62 : 1}">${directional?tankerArt:neutralArt}</g></svg>`;
}
