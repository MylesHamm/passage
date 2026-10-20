/*
 * Ship sprites for the live terrain map: a small memo of Anatomy tanker figures
 * (ship-model.mjs) at quantized camera-relative azimuths and elevation bands:
 * 24 steps per band, evenly spaced in drawn bow angle (see stepAzimuth), and
 * six bands (20, 35, 50, 65, 80 and 90° kit elevation).
 * Each vessel gets one cached SVG string (or data URL) plus a small residual
 * rotation. The map overlay can place a single <img> or an inline SVG per
 * vessel without rebuilding geometry every frame.
 *
 * Pure functions plus a bounded memo; no DOM, so everything runs in Node.
 *
 * Angles
 *   headingDegrees      compass heading of the bow, [0, 360). Anything else
 *                       (null, NaN, 360, AIS 511, strings) returns null, and the
 *                       caller shows a neutral marker instead of guessing a bow.
 *   cameraYawDegrees    terrain pose.yaw in degrees (pose.yaw · 180/π).
 *   cameraTiltDegrees   terrain pose.tilt in degrees from straight down
 *                       (pose.tilt · 180/π; use 0 in top-down mode).
 *   camera-relative heading h = H + yaw; kit azimuth A = 180 − h;
 *   kit elevation E = 90 − tilt (ship-model.mjs has the derivation).
 *
 * Size
 *   lengthPx is the on-screen length the hull would have lying across the
 *   screen, so it is the map scale of the symbol. A ship heading toward or away
 *   from the camera is foreshortened, as it would be in the terrain. The detail
 *   level follows lengthPx unless `detail` is given.
 *
 * Placement (CSS px, relative to the projected position p of the AIS point):
 *   el.style.transformOrigin = `${anchor.x}px ${anchor.y}px`
 *   el.style.transform = `translate(${p.x - anchor.x}px, ${p.y - anchor.y}px) rotate(${rotationDeg}deg)`
 * `spriteTransform(sprite, p)` returns both strings.
 *
 * Perspective: the terrain camera has a 40° field of view, so a ship near the
 * top or bottom edge is seen up to ~20° shallower or steeper than pose.tilt.
 * For exact local angles pass localView({eye, point}) (eye from geometry.mjs
 * cameraMatrix, point from geographicPoint). Also pass screenBowDegrees: the
 * projected heading from ops/hero-map.mjs projectedVesselAngle, measured
 * clockwise from screen up. Then rotationDeg makes the drawn bow match the
 * terrain exactly.
 */
import { tankerFigure, screenBowDegrees as figureBow, detailForLength, kitAzimuthFor, kitElevationFor, UNITS_PER_METRE, TANKER } from './ship-model.mjs';

export const AZIMUTH_STEPS = 24;
export const ELEVATION_BANDS = Object.freeze([20, 35, 50, 65, 80, 90]);
/** defaultPose().tilt (0.72 rad) in degrees. */
export const DEFAULT_TILT_DEGREES = 0.72 * 180 / Math.PI;
const CACHE_LIMIT = 160;
const cache = new Map();

const wrap180 = (deg) => { const d = ((deg % 360) + 540) % 360 - 180; return d === -180 ? 180 : d; };
const finite = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** A usable compass heading, or null. Never coerces strings or AIS "not available" (511). */
export function validHeading(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 360 ? value : null;
}

/** Local camera angles for a world point, from the terrain camera eye (both [X east, Y up, Z south]). */
export function localView({ eye, point }) {
  const dx = eye[0] - point[0]; const dy = eye[1] - point[1]; const dz = eye[2] - point[2];
  return {
    cameraYawDegrees: (Math.atan2(dx, dz) * 180) / Math.PI,
    cameraTiltDegrees: (Math.atan2(Math.hypot(dx, dz), dy) * 180) / Math.PI,
  };
}

/**
 * Kit azimuth of step k in an elevation band. Steps are evenly spaced in the drawn bow
 * angle on screen (every 360/steps degrees), not in kit azimuth. Near bow-on views the
 * foreshortened floor magnifies an azimuth step by 1/sin E, and even screen spacing keeps
 * the residual rotation within half a step.
 * Inverse of screenBowDegrees: A = atan2(sin ψ · sin E, −cos ψ).
 */
export function stepAzimuth(k, band, steps = AZIMUTH_STEPS) {
  const psi = (k * 360 / steps) * Math.PI / 180;
  const a = Math.atan2(Math.sin(psi) * Math.sin(band * Math.PI / 180), -Math.cos(psi)) * 180 / Math.PI;
  return Math.round((((a % 360) + 360) % 360) * 1000) / 1000;
}

/** Nearest elevation band for a kit elevation. */
export function elevationBand(elevation) {
  let best = ELEVATION_BANDS[0];
  for (const band of ELEVATION_BANDS) if (Math.abs(band - elevation) < Math.abs(best - elevation)) best = band;
  return best;
}

function entry(azimuth, elevation, detail) {
  const key = `${detail}|${azimuth}|${elevation}`;
  let found = cache.get(key);
  if (found) { cache.delete(key); cache.set(key, found); return found; }
  const figure = tankerFigure({ azimuth, elevation, detail });
  found = Object.freeze({
    key,
    svg: figure.svg,
    dataUrl: `data:image/svg+xml,${encodeURIComponent(figure.svg)}`,
    width: figure.width,
    height: figure.height,
    anchor: Object.freeze({ ...figure.anchor }),
    bowScreenDegrees: figure.bowScreenDegrees,
    partCount: figure.partCount,
  });
  cache.set(key, found);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return found;
}

/**
 * A cached tanker sprite for one vessel, or null when the heading is unknown.
 * @returns {null | {svg, dataUrl, width, height, anchor: {x, y}, rotationDeg, azimuth, elevation,
 *   detail, key, cameraRelativeHeading, bowScreenDegrees, pxPerMetre}}
 */
export function shipSprite({
  headingDegrees, cameraYawDegrees = 0, cameraTiltDegrees = DEFAULT_TILT_DEGREES,
  lengthPx = 64, screenBowDegrees, detail, azimuthSteps = AZIMUTH_STEPS,
} = {}) {
  const heading = validHeading(headingDegrees);
  if (heading === null) return null;
  const yaw = finite(cameraYawDegrees, 0);
  const elevation = kitElevationFor(Math.min(90, Math.max(0, finite(cameraTiltDegrees, DEFAULT_TILT_DEGREES))));
  const length = Math.min(1200, Math.max(8, finite(lengthPx, 64)));
  const steps = Math.max(4, Math.round(finite(azimuthSteps, AZIMUTH_STEPS)));
  const level = ['low', 'mid', 'full'].includes(detail) ? detail : detailForLength(length);
  const ideal = kitAzimuthFor({ headingDegrees: heading, cameraYawDegrees: yaw });
  const target = finite(screenBowDegrees, figureBow(ideal, elevation));
  const band = elevationBand(elevation);
  // Of the two neighbouring screen-spaced steps, use the one whose drawn bow needs the least rotation.
  const step = 360 / steps;
  const bow = ((target % 360) + 360) % 360;
  const candidates = [Math.floor(bow / step), Math.ceil(bow / step)].map((k) => stepAzimuth(((k % steps) + steps) % steps, band, steps));
  let azimuth = candidates[0]; let residual = wrap180(target - figureBow(azimuth, band));
  for (const candidate of candidates.slice(1)) {
    const r = wrap180(target - figureBow(candidate, band));
    if (Math.abs(r) < Math.abs(residual) - 1e-9) { azimuth = candidate; residual = r; }
  }
  const sprite = entry(azimuth, band, level);
  const scale = length / (TANKER.lengthOverall * UNITS_PER_METRE);
  return {
    svg: sprite.svg,
    dataUrl: sprite.dataUrl,
    width: sprite.width * scale,
    height: sprite.height * scale,
    anchor: { x: sprite.anchor.x * scale, y: sprite.anchor.y * scale },
    rotationDeg: Math.round(residual * 100) / 100,
    azimuth, elevation: band, detail: level, key: sprite.key,
    cameraRelativeHeading: ((heading + yaw) % 360 + 360) % 360,
    bowScreenDegrees: sprite.bowScreenDegrees,
    pxPerMetre: length / TANKER.lengthOverall,
  };
}

/** CSS transform strings that put the sprite's waterline anchor on a projected point. */
export function spriteTransform(sprite, point) {
  return {
    transformOrigin: `${sprite.anchor.x}px ${sprite.anchor.y}px`,
    transform: `translate(${point.x - sprite.anchor.x}px, ${point.y - sprite.anchor.y}px) rotate(${sprite.rotationDeg}deg)`,
  };
}

export const shipSpriteCacheSize = () => cache.size;
export function clearShipSprites() { cache.clear(); }
