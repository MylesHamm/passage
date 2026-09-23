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
export const TYPES = ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'];
export const SUBSCRIPTION_TYPES = [...TYPES, 'ShipStaticData', 'StaticDataReport'];
const text = value => typeof value === 'string' ? value.replace(/[@\x00-\x1f]/g, '').trim().slice(0, 80) : '';
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const bounded = (value, max) => number(value) !== null && value >= 0 && value < max ? value : null;

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
    this.vessels = new Map(); this.static = new Map(); this.limit = limit;
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
    const latitude = number(report.Latitude ?? meta?.latitude ?? meta?.Latitude);
    const longitude = number(report.Longitude ?? meta?.longitude ?? meta?.Longitude);
    this.lastOutcome = 'coordinates';
    if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false;
    const area = AIS_AREAS.find(({ bounds: [[s, w], [n, e]] }) => latitude >= s && latitude <= n && longitude >= w && longitude <= e);
    const positionTime = sourceAt || new Date(now).toISOString();
    this.lastOutcome = 'expired'; if (now - Date.parse(positionTime) >= EXPIRE_MS) return false;
    this.lastOutcome = 'out_of_order'; if (old && Date.parse(old.positionTime) > Date.parse(positionTime)) return false;
    if (!area) { this.lastOutcome = 'outside_area'; this.vessels.delete(mmsi); return false; }
    this.ingestMetadata(mmsi, type, report, sourceAt, now);
    const name = this.metadata(mmsi, now).name || text(meta?.ShipName) || old?.name || '';
    this.vessels.delete(mmsi);
    this.vessels.set(mmsi, {
      mmsi, name, theater: area.id, latitude, longitude, ...this.vesselMetadata(mmsi, now),
      speedKnots: bounded(report.Sog, 102.3), courseDegrees: bounded(report.Cog, 360), headingDegrees: bounded(report.TrueHeading, 360),
      positionTime, sourceAt, receivedAt: new Date(now).toISOString(),
      timestampBasis: sourceAt ? 'provider' : 'received',
      timestampNote: sourceAt ? null : meta?.time_utc ? 'Provider time invalid or in the future; age uses receipt time.' : 'Provider time missing; age uses receipt time.',
    });
    while (this.vessels.size > this.limit) this.vessels.delete(this.vessels.keys().next().value);
    this.lastOutcome = sourceAt ? 'accepted' : 'accepted_receipt_time'; return true;
  }

  snapshot(now = Date.now()) {
    const result = [];
    for (const id of this.static.keys()) this.metadata(id, now);
    for (const [id, vessel] of this.vessels) {
      const ageSeconds = Math.max(0, Math.floor((now - Date.parse(vessel.positionTime)) / 1000));
      if (ageSeconds >= EXPIRE_MS / 1000) this.vessels.delete(id);
      else result.push({ ...vessel, ...this.vesselMetadata(id, now), ageSeconds, stale: ageSeconds >= STALE_MS / 1000 });
    }
    return result.sort((a, b) => a.ageSeconds - b.ageSeconds || a.mmsi.localeCompare(b.mmsi));
  }
}

// Heartbeat pattern: https://github.com/websockets/ws/tree/8.21.3#how-to-detect-and-close-broken-connections
// The 30s ping / 15s reply deadline is Passage policy, not an AISStream SLA.
