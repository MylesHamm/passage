// AIS ship and cargo codes: https://www.navcen.uscg.gov/ais-class-a-reports
// A tanker code describes the vessel category, not its cargo or loading state.
export function normalizeVesselTypeCode(code) {
  if (typeof code !== 'number' && (typeof code !== 'string' || !/^\d{1,2}$/.test(code.trim()))) return null;
  const value = Number(code);
  return Number.isInteger(value) && value >= 1 && value <= 99 ? value : null;
}

export function classifyVesselType(code) {
  const value = normalizeVesselTypeCode(code);
  if (value === null) return 'unknown';
  if (value >= 80 && value <= 89) return 'tanker';
  if (value >= 70 && value <= 79) return 'cargo';
  if (value >= 60 && value <= 69) return 'passenger';
  if (value >= 50 && value <= 59) return 'service';
  if (value === 35) return 'military';
  if (value === 30) return 'fishing';
  if (value === 36 || value === 37) return 'leisure';
  return 'other';
}

export const VESSEL_TYPE_LABELS = Object.freeze({
  tanker: 'Tanker', cargo: 'Cargo', passenger: 'Passenger', service: 'Service',
  military: 'Military', fishing: 'Fishing', leisure: 'Leisure', other: 'Other', unknown: 'Type not reported',
});

export function vesselTypeLabel(type) {
  return Object.hasOwn(VESSEL_TYPE_LABELS, type) ? VESSEL_TYPE_LABELS[type] : VESSEL_TYPE_LABELS.unknown;
}

export const POSITION_STALE_MS = 10 * 60_000;
export const POSITION_EXPIRE_MS = 30 * 60_000;
export const TYPE_EXPIRE_MS = 24 * 60 * 60_000;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

export function isCurrentVesselPosition(vessel, now = Date.now()) {
  const at = timestamp(vessel?.positionTime);
  return at !== null && at <= now && now - at < POSITION_EXPIRE_MS
    && Number.isFinite(vessel.latitude) && Math.abs(vessel.latitude) <= 90
    && Number.isFinite(vessel.longitude) && Math.abs(vessel.longitude) <= 180;
}

function typedMetadata(vessel, now) {
  const code = normalizeVesselTypeCode(vessel.shipTypeCode);
  if (code === null) return null;
  const at = timestamp(vessel.shipTypeObservedAt);
  // An undated category is useful only with its own provider's current
  // snapshot. It cannot be transplanted onto a different provider's position.
  if (vessel.shipTypeObservedAt && (at === null || at > now || now - at >= TYPE_EXPIRE_MS)) return null;
  return {
    shipTypeCode: code, shipType: classifyVesselType(code),
    shipTypeObservedAt: at === null ? null : new Date(at).toISOString(),
    shipTypeTimestampBasis: at === null ? null : vessel.shipTypeTimestampBasis || 'unknown',
    shipTypeProvider: vessel.shipTypeProvider || vessel.provider || null,
    shipTypeMessage: vessel.shipTypeMessage || null,
  };
}

// Keep one freshest valid position per MMSI. A separately dated category may
// survive a provider switch, but never carries coordinates or renews a clock.
export function mergeVesselPositions(records, now = Date.now()) {
  const byIdentity = new Map();
  for (const vessel of (records || []).slice(0, 10000)) {
    const mmsi = String(vessel?.mmsi ?? '');
    if (!/^[1-9]\d{8}$/.test(mmsi)) continue;
    if (!byIdentity.has(mmsi)) byIdentity.set(mmsi, []);
    byIdentity.get(mmsi).push({ ...vessel, mmsi });
  }
  const result = [];
  for (const candidates of byIdentity.values()) {
    const position = candidates.filter(v => isCurrentVesselPosition(v, now))
      .sort((a, b) => timestamp(b.positionTime) - timestamp(a.positionTime) || String(a.provider || '').localeCompare(String(b.provider || '')))[0];
    if (!position) continue;
    let metadata = typedMetadata(position, now);
    const datedOther = candidates.filter(v => v.provider && v.provider !== position.provider)
      .map(v => typedMetadata(v, now)).filter(m => m?.shipTypeObservedAt && m.shipTypeProvider)
      .sort((a, b) => timestamp(b.shipTypeObservedAt) - timestamp(a.shipTypeObservedAt))[0];
    if (datedOther && (!metadata || metadata.shipTypeObservedAt && timestamp(datedOther.shipTypeObservedAt) > timestamp(metadata.shipTypeObservedAt))) metadata = datedOther;
    const ageSeconds = Math.floor((now - timestamp(position.positionTime)) / 1000);
    result.push({
      ...position,
      ...(metadata || {shipTypeCode:null,shipType:'unknown',shipTypeObservedAt:null,shipTypeTimestampBasis:null,shipTypeProvider:null,shipTypeMessage:null}),
      ageSeconds, stale: ageSeconds >= POSITION_STALE_MS / 1000,
    });
  }
  return result.sort((a, b) => timestamp(b.positionTime) - timestamp(a.positionTime) || a.mmsi.localeCompare(b.mmsi));
}
