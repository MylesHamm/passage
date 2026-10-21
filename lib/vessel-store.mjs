import { classifyVesselType, normalizeVesselTypeCode } from './vessel-types.mjs';

export const AIS_AREAS = [
  // Passage keeps south/west then north/east bounds for local filtering.
  // AISStream's documented example sends the north-west corner first and
  // the south-east corner second, so providerBounds follows that convention.
  { id: 'bab', bounds: [[11, 41], [16, 47.5]], providerBounds: [[16, 41], [11, 47.5]] },
  { id: 'hormuz', bounds: [[23, 52], [28, 60]], providerBounds: [[28, 52], [23, 60]] },
];
export const STALE_MS = 10 * 60_000;
export const EXPIRE_MS = 30 * 60_000;
// Passage retention policy; static data cannot refresh a position clock.
export const STATIC_EXPIRE_MS = 24 * 60 * 60_000;
// Recent received track: at most one point a minute for an hour. Tracks are
// a record of received positions, never extrapolated between reports.
export const TRACK_WINDOW_MS = 60 * 60_000;
export const TRACK_STEP_MS = 60_000;
export const TRACK_MAX_POINTS = 60;
// A jump that would need more than 60 knots is a receiver or decoding glitch,
// not a voyage, so the track restarts instead of drawing across land.
export const TRACK_MAX_KNOTS = 60;
export const TYPES = ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'];
export const SUBSCRIPTION_TYPES = [...TYPES, 'ShipStaticData', 'StaticDataReport'];
const text = value => typeof value === 'string' ? value.replace(/[@\x00-\x1f]/g, '').trim().slice(0, 80) : '';
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const bounded = (value, max) => number(value) !== null && value >= 0 && value < max ? value : null;
const isTankerCode = code => Number.isInteger(code) && code >= 80 && code <= 89;
export function nauticalMiles([lon1, lat1], [lon2, lat2]) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function sourceTimestamp(value, now) {
  if (typeof value !== 'string') return null;
  // AISStream may use Go's UTC timestamp format, including fractional seconds.
  const normalized = value.replace(' ', 'T').replace(/\s+\+0000 UTC$/, 'Z');
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) && ms <= now + 60_000 ? new Date(ms).toISOString() : null;
}

// Only these schema fields carry ship type. Standard position reports do not.
// https://github.com/aisstream/ais-message-models/blob/master/type-definition.yaml
function staticFields(type, report) {
  if (type === 'ShipStaticData' || type === 'ExtendedClassBPositionReport') {
    return { name: text(report.Name), code: report.Type };
  }
  if (type === 'StaticDataReport') {
    return {
      name: report.ReportA?.Valid === true ? text(report.ReportA.Name) : '',
      code: report.ReportB?.Valid === true ? report.ReportB.ShipType : undefined,
    };
  }
  return null;
}

export class VesselStore {
  constructor({ limit = 2000 } = {}) {
    this.vessels = new Map(); this.static = new Map(); this.tracks = new Map(); this.limit = limit;
  }

  /** Append a received position to the vessel's recent track. */
  addTrackPoint(mmsi, longitude, latitude, positionTime) {
    const at = Date.parse(positionTime);
    let points = (this.tracks.get(mmsi) || []).filter(p => at - Date.parse(p[2]) < TRACK_WINDOW_MS && Date.parse(p[2]) <= at);
    const last = points.at(-1);
    if (last) {
      const hours = (at - Date.parse(last[2])) / 3_600_000;
      if (hours > 0 && nauticalMiles(last, [longitude, latitude]) / hours > TRACK_MAX_KNOTS) points = [];
      else if (at - Date.parse(last[2]) < TRACK_STEP_MS) { this.tracks.set(mmsi, points); return; }
    }
    points.push([longitude, latitude, positionTime]);
    this.tracks.set(mmsi, points.slice(-TRACK_MAX_POINTS));
  }

  trackFor(mmsi, now) {
    const points = (this.tracks.get(mmsi) || []).filter(p => now - Date.parse(p[2]) < TRACK_WINDOW_MS);
    if (points.length) this.tracks.set(mmsi, points); else this.tracks.delete(mmsi);
    return points;
  }

  metadata(mmsi, now) {
    const info = this.static.get(mmsi);
    if (!info) return {};
    if (now - Date.parse(info.nameAt) >= STATIC_EXPIRE_MS) { delete info.name; delete info.nameAt; }
    if (now - Date.parse(info.shipTypeObservedAt) >= STATIC_EXPIRE_MS) {
      for (const field of ['shipTypeCode', 'shipTypeObservedAt', 'shipTypeTimestampBasis', 'shipTypeMessage']) delete info[field];
    }
    if (!info.nameAt && !info.shipTypeObservedAt) this.static.delete(mmsi);
    return info;
  }

  ingestMetadata(mmsi, type, report, sourceAt, now) {
    const fields = staticFields(type, report);
    if (!fields) return;
    const observedAt = sourceAt || new Date(now).toISOString(), observedMs = Date.parse(observedAt);
    if (now - observedMs >= STATIC_EXPIRE_MS) return;
    const info = { ...this.metadata(mmsi, now) };
    if (fields.name && (!info.nameAt || observedMs >= Date.parse(info.nameAt))) {
      info.name = fields.name; info.nameAt = observedAt;
    }
    // Zero explicitly clears an unavailable type. Missing/malformed fields do
    // not erase a previous typed report, nor prolong its independent lifetime.
    if (Number.isInteger(fields.code) && fields.code >= 0 && fields.code <= 99 && (!info.shipTypeObservedAt || observedMs >= Date.parse(info.shipTypeObservedAt))) {
      info.shipTypeCode = normalizeVesselTypeCode(fields.code);
      info.shipTypeObservedAt = observedAt;
      info.shipTypeTimestampBasis = sourceAt ? 'provider' : 'received';
      info.shipTypeMessage = type;
    }
    if (!info.nameAt && !info.shipTypeObservedAt) return;
    this.static.delete(mmsi); this.static.set(mmsi, info);
    while (this.static.size > this.limit) this.static.delete(this.static.keys().next().value);
  }

  vesselMetadata(mmsi, now) {
    const info = this.metadata(mmsi, now);
    return {
      shipTypeCode: info.shipTypeCode ?? null,
      shipType: classifyVesselType(info.shipTypeCode),
      shipTypeObservedAt: info.shipTypeObservedAt || null,
      shipTypeTimestampBasis: info.shipTypeTimestampBasis || null,
      shipTypeMessage: info.shipTypeMessage || null,
      shipTypeProvider: info.shipTypeObservedAt ? 'AISStream' : null,
    };
  }

  ingest(envelope, now = Date.now()) {
    const type = envelope?.MessageType, report = envelope?.Message?.[type], meta = envelope?.MetaData;
    this.lastOutcome = 'invalid_message';
    if (!report || report.Valid === false) return false;
    const mmsi = String(meta?.MMSI ?? report.UserID ?? '');
    this.lastOutcome = 'identity';
    if (!/^[1-9]\d{8}$/.test(mmsi) || (report.UserID !== undefined && String(report.UserID) !== mmsi)) return false;
    const old = this.vessels.get(mmsi), sourceAt = sourceTimestamp(meta?.time_utc, now);
    if (!TYPES.includes(type)) {
      if (['ShipStaticData', 'StaticDataReport'].includes(type)) {
        this.ingestMetadata(mmsi, type, report, sourceAt, now);
        if (old) this.vessels.set(mmsi, { ...old, name: this.metadata(mmsi, now).name || old.name, ...this.vesselMetadata(mmsi, now) });
      }
      this.lastOutcome = ['ShipStaticData', 'StaticDataReport'].includes(type) ? 'static' : 'unsupported';
      return false;
    }
    // Only the decoded position payload establishes a coordinate update.
    // Envelope metadata can describe a cached location, so it must never fill
    // missing or unavailable coordinates in a newer position report.
    const latitude = number(report.Latitude);
    const longitude = number(report.Longitude);
    this.lastOutcome = 'coordinates';
    if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false;
    const area = AIS_AREAS.find(({ bounds: [[s, w], [n, e]] }) => latitude >= s && latitude <= n && longitude >= w && longitude <= e);
    const positionTime = sourceAt || new Date(now).toISOString();
    this.lastOutcome = 'expired'; if (now - Date.parse(positionTime) >= EXPIRE_MS) return false;
    this.lastOutcome = 'out_of_order'; if (old && Date.parse(old.positionTime) > Date.parse(positionTime)) return false;
    if (!area) { this.lastOutcome = 'outside_area'; this.vessels.delete(mmsi); this.tracks.delete(mmsi); return false; }
    this.ingestMetadata(mmsi, type, report, sourceAt, now);
    const name = this.metadata(mmsi, now).name || text(meta?.ShipName) || old?.name || '';
    this.vessels.delete(mmsi);
    this.vessels.set(mmsi, {
      mmsi, name, theater: area.id, latitude, longitude, ...this.vesselMetadata(mmsi, now),
      speedKnots: bounded(report.Sog, 102.3), courseDegrees: bounded(report.Cog, 360), headingDegrees: bounded(report.TrueHeading, 360),
      positionTime, sourceAt, providerReportAt: sourceAt, positionEvidence: 'position-report',
      receivedAt: new Date(now).toISOString(),
      // This is the provider's report timestamp, not independently verified
      // onboard/GNSS observation time. Receipt remains a separate clock.
      timestampBasis: sourceAt ? 'provider' : 'received',
      timestampNote: sourceAt ? null : meta?.time_utc ? 'Provider time invalid or in the future; age uses receipt time.' : 'Provider time missing; age uses receipt time.',
    });
    this.addTrackPoint(mmsi, longitude, latitude, positionTime);
    while (this.vessels.size > this.limit) { const oldest = this.vessels.keys().next().value; this.vessels.delete(oldest); this.tracks.delete(oldest); }
    this.lastOutcome = sourceAt ? 'accepted' : 'accepted_receipt_time'; return true;
  }

  snapshot(now = Date.now()) {
    const result = [];
    for (const id of this.static.keys()) this.metadata(id, now);
    for (const [id, vessel] of this.vessels) {
      const ageSeconds = Math.max(0, Math.floor((now - Date.parse(vessel.positionTime)) / 1000));
      if (ageSeconds >= EXPIRE_MS / 1000) { this.vessels.delete(id); this.tracks.delete(id); continue; }
      const metadata = this.vesselMetadata(id, now), track = this.trackFor(id, now);
      // Tracks travel with tankers only, which keeps the ten-second poll small.
      result.push({ ...vessel, ...metadata, ageSeconds, stale: ageSeconds >= STALE_MS / 1000, ...(isTankerCode(metadata.shipTypeCode) && track.length > 1 ? { track } : {}) });
    }
    return result.sort((a, b) => a.ageSeconds - b.ageSeconds || a.mmsi.localeCompare(b.mmsi));
  }
}

// Heartbeat pattern: https://github.com/websockets/ws/tree/8.21.3#how-to-detect-and-close-broken-connections
// The 30s ping / 15s reply deadline is Passage policy, not an AISStream SLA.
