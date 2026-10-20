import { AIS_AREAS, EXPIRE_MS } from './ais.mjs';
import { classifyVesselType } from './vessel-types.mjs';

export const OPENWATERS_URL = 'https://ais.openwaters.io/v1/vessels?bbox=11,41,16,47.5&bbox=23,52,28,60';
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' ? value.replace(/[@\x00-\x1f]/g, '').trim().slice(0, 80) : '';
const bounded = (value, max) => number(value) !== null && value >= 0 && value < max ? value : null;
const areaFor = (latitude, longitude) => AIS_AREAS.find(({ bounds: [[south, west], [north, east]] }) => latitude >= south && latitude <= north && longitude >= west && longitude <= east);

// Credits describe the collection's contributing latest-message sources. They
// do not establish which source supplied a particular cached coordinate.
// Keep them once on the source envelope rather than repeating them per vessel.
export function parseOpenWatersAttribution(payload) {
  if (!payload?.attribution || typeof payload.attribution !== 'object' || Array.isArray(payload.attribution)) return {};
  const credits = {};
  for (const [key, value] of Object.entries(payload.attribution).slice(0, 32)) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(key)
      || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const credit = value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 2048);
    if (credit) credits[key] = credit;
  }
  return credits;
}

// Open Waters folds position and static messages into a GeoJSON snapshot.
// `seen`, `source`, `station` and `msg_type` describe the latest message, which
// can retain coordinates from an older, differently sourced position report.
// PosAt is internal and is not supplied by this endpoint. Even a latest-message
// PositionReport type cannot prove the cached coordinate's observation time.
// https://github.com/openwatersio/aiscast/blob/6439a98b2e8df94a2a416ada87ef4980ab4722b5/server/vessels.go
//
// positionTime/sourceAt remain compatibility aliases for retention ONLY; these
// snapshot records are not eligible as current position observations.
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
    const lastMessageAt = seenMs !== null && seenMs <= now ? new Date(seenMs).toISOString() : null;
    const receivedAt = new Date(now).toISOString();
    const retentionTime = lastMessageAt || receivedAt;
    if (now - Date.parse(retentionTime) >= EXPIRE_MS) continue;
    const lastMessageSource = text(properties.source) || null;
    const lastMessageStation = text(properties.station) || null;
    const lastMessageType = text(properties.msg_type) || null;
    vessels.push({
      mmsi, name: text(properties.name), provider: 'Open Waters',
      providerSource: lastMessageSource || 'Open Waters aiscast', theater: area.id,
      latitude, longitude, shipTypeCode: bounded(properties.type, 100), shipType: classifyVesselType(properties.type), speedKnots: bounded(properties.sog, 102.3), courseDegrees: bounded(properties.cog, 360), headingDegrees: bounded(properties.heading, 360),
      positionEvidence: 'snapshot', positionObservedAt: null, positionSource: null,
      lastMessageAt, lastMessageSource, lastMessageStation, lastMessageType,
      retentionTime, positionTime: retentionTime, sourceAt: lastMessageAt, receivedAt,
      timestampBasis: lastMessageAt ? 'provider-last-message' : 'snapshot-received',
      timestampNote: lastMessageAt
        ? 'Last-message time only. The snapshot does not supply the cached position observation time or source; it is not a current position observation.'
        : 'Last-message time missing, invalid or in the future; snapshot retention uses receipt time. Position observation time and source are unavailable.'
    });
  }
  return vessels;
}
