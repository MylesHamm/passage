// Land and sea on a scene's elevation grid: the same 256 × 256 samples the maps
// draw, where sea is stored as 0. Ship attacks are drawn in the water, so a
// position that falls on land is moved to the nearest sea sample.
import { longitudeLatitudeToUV } from './geometry.mjs';

const SIZE = 256;
const NM_KM = 1.852;

/** Longitude and latitude of a scene grid sample. */
export function sampleLongitudeLatitude(column, row, scene) {
  const n = 2 ** scene.zoom, x = scene.tileOrigin[0] + column / (SIZE - 1) * scene.tileSpan, y = scene.tileOrigin[1] + row / (SIZE - 1) * scene.tileSpan;
  return [x / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI];
}
const sampleOf = (point, scene) => {
  const [u, v] = longitudeLatitudeToUV(point, scene);
  return u < 0 || u > 1 || v < 0 || v > 1 ? null : [Math.round(u * (SIZE - 1)), Math.round(v * (SIZE - 1))];
};
const distanceNm = ([lon1, lat1], [lon2, lat2]) => {
  const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
};

/** True when the point is at sea on this grid, null when the grid does not cover it. */
export function atSea(point, scene, heights) {
  const sample = sampleOf(point, scene);
  return sample ? heights[sample[1] * SIZE + sample[0]] === 0 : null;
}

/**
 * The nearest sea sample within `maxNm`, or the point itself when it is
 * already at sea. A moved point also keeps `clearanceKm` of water around it, so
 * its marker sits in open water rather than on the shoreline. Null when the
 * grid does not cover the point or no sea is close.
 */
export function nearestSea(point, scene, heights, { maxNm = 15, clearanceKm = 0 } = {}) {
  const sample = sampleOf(point, scene);
  if (!sample || !heights?.length) return null;
  if (heights[sample[1] * SIZE + sample[0]] === 0) return { point, moved: false, distanceNm: 0 };
  const sampleKm = 40075.016686 * Math.cos(point[1] * Math.PI / 180) * scene.tileSpan / 2 ** scene.zoom / (SIZE - 1);
  const reach = Math.ceil(maxNm * NM_KM / sampleKm) + 1, margin = Math.floor(clearanceKm / sampleKm);
  const open = (column, row) => {
    for (let dy = -margin; dy <= margin; dy++) for (let dx = -margin; dx <= margin; dx++) {
      const c = column + dx, r = row + dy;
      if (c >= 0 && r >= 0 && c < SIZE && r < SIZE && heights[r * SIZE + c] !== 0) return false;
    }
    return true;
  };
  let best = null;
  for (let ring = 1; ring <= reach; ring++) {
    for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const column = sample[0] + dx, row = sample[1] + dy;
      if (column < 0 || row < 0 || column >= SIZE || row >= SIZE || heights[row * SIZE + column] !== 0 || !open(column, row)) continue;
      const candidate = sampleLongitudeLatitude(column, row, scene), distance = distanceNm(point, candidate);
      if (distance <= maxNm && (!best || distance < best.distanceNm)) best = { point: candidate, moved: true, distanceNm: distance };
    }
    // Samples on a later ring can still be nearer by a little; stop once they cannot be.
    if (best && best.distanceNm < ring * sampleKm / NM_KM * .7) break;
  }
  return best;
}
