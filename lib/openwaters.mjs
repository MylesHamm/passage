import { AIS_AREAS, EXPIRE_MS } from './ais.mjs';
import { classifyVesselType } from './vessel-types.mjs';

export const OPENWATERS_URL = 'https://ais.openwaters.io/v1/vessels?bbox=11,41,16,47.5&bbox=23,52,28,60';
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' ? value.replace(/[@\x00-\x1f]/g, '').trim().slice(0, 80) : '';
const bounded = (value, max) => number(value) !== null && value >= 0 && value < max ? value : null;
const areaFor = (latitude, longitude) => AIS_AREAS.find(({ bounds: [[south, west], [north, east]] }) => latitude >= south && latitude <= north && longitude >= west && longitude <= east);

// Open Waters returns a GeoJSON snapshot. Keep the output in Passage's vessel
// shape so the map, list, exports, and freshness rules remain consistent.
export function parseOpenWaters(payload, now = Date.now()) {
  if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) throw new Error('Unexpected Open Waters schema');
  const vessels = [];
  for (const feature of payload.features.slice(0, 2000)) {
    const properties = feature?.properties || {}, coordinates = feature?.geometry?.coordinates;
    const mmsi = String(properties.mmsi ?? feature?.id ?? '');
    const longitude = number(coordinates?.[0]), latitude = number(coordinates?.[1]);
    if (!/^[1-9]\d{8}$/.test(mmsi) || latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    const area = areaFor(latitude, longitude); if (!area) continue;
    const seenMs = typeof properties.seen === 'string' && Number.isFinite(Date.parse(properties.seen)) ? Date.parse(properties.seen) : null;
    const sourceAt = seenMs !== null && seenMs <= now + 60_000 ? new Date(seenMs).toISOString() : null;
    const positionTime = sourceAt || new Date(now).toISOString();
    if (now - Date.parse(positionTime) >= EXPIRE_MS) continue;
    vessels.push({
      mmsi, name: text(properties.name), provider: 'Open Waters', providerSource: text(properties.source) || 'Open Waters aiscast', theater: area.id,
      latitude, longitude, shipTypeCode: bounded(properties.type, 100), shipType: classifyVesselType(properties.type), speedKnots: bounded(properties.sog, 102.3), courseDegrees: bounded(properties.cog, 360), headingDegrees: bounded(properties.heading, 360),
      positionTime, sourceAt, receivedAt: new Date(now).toISOString(), timestampBasis: sourceAt ? 'provider' : 'received',
      timestampNote: sourceAt ? null : 'Provider time missing or invalid; age uses receipt time.'
    });
  }
  return vessels;
}
