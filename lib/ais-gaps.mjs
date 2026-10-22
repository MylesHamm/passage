// AIS gaps: ships that stop reporting for three hours or more while moving deep
// inside reliable reception. A ship leaving range fades out at the edge of
// coverage; one that goes silent mid-coverage most likely stopped transmitting.
// That is evidence, not proof, and the public wording says so.

export const GAP_MIN_MS = 3 * 3_600_000;
export const GAP_MAX_MS = 7 * 24 * 3_600_000;
export const MOVING_KNOTS = 2;
const HOUR = 3_600_000, CELL_DEG = .1, RELIABLE_HOURS = 18, COMPLETED_KEEP_MS = 30 * 24 * HOUR;
const SEEN_LIMIT = 5000, COMPLETED_LIMIT = 1000, HISTORY_HOURS = 8 * 24;
// The feed counts as healthy in an hour when it delivered at least a quarter of
// its usual hourly volume; gaps that overlap an unhealthy hour are not counted.
const HEALTHY_SHARE = .25, MIN_BASELINE = 60;

const cellOf = (lon, lat) => `${Math.floor(lat / CELL_DEG)},${Math.floor(lon / CELL_DEG)}`;
const neighbours = key => { const [r, c] = key.split(',').map(Number); const out = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) out.push(`${r + dr},${c + dc}`); return out; };
const bits = mask => { let n = 0; while (mask) { n += mask & 1; mask >>>= 1; } return n; };
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;
const stamp = ms => new Date(ms).toISOString();
const nauticalMiles = ([lon1, lat1], [lon2, lat2]) => {
  const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
};

export class GapTracker {
  constructor() {
    // cell -> {hour, mask, first, counted}: bit 0 of mask is `hour`; a bit is set
    // only once two different ships were received in that cell in that hour.
    this.cells = new Map();
    this.hours = new Map();   // hour index -> accepted positions in the watch area
    this.seen = new Map();    // mmsi -> last sighting
    this.completed = [];      // finished gaps, newest last
    this.firstHour = null; this.cache = null;
  }

  cellMask(key, hour) {
    const cell = this.cells.get(key);
    if (!cell) return 0;
    const shift = hour - cell.hour;
    return shift >= 24 ? 0 : shift > 0 ? (cell.mask << shift) & 0xffffff : cell.mask;
  }
  reliable(key, hour) { return bits(this.cellMask(key, hour)) >= RELIABLE_HOURS; }
  /** Deep inside reliable coverage: the cell and all eight neighbours are reliable. */
  deep(lon, lat, hour) { return neighbours(cellOf(lon, lat)).every(key => this.reliable(key, hour)); }

  baseline(hour) {
    const counts = [];
    for (let h = hour - 24; h < hour; h++) if (this.hours.get(h) > 0) counts.push(this.hours.get(h));
    const value = counts.length >= 6 ? median(counts) : null;
    return value !== null && value >= MIN_BASELINE ? value : null;
  }
  healthyHour(hour, now) {
    const base = this.baseline(hour);
    if (base === null) return false;
    const count = this.hours.get(hour) || 0, current = Math.floor(now / HOUR);
    if (hour < current) return count >= HEALTHY_SHARE * base;
    const elapsed = (now - hour * HOUR) / HOUR;
    return elapsed < 1 / 6 ? this.healthyHour(hour - 1, now) : count / elapsed >= HEALTHY_SHARE * base;
  }
  /** True when the feed delivered its usual volume through every hour of the window. */
  healthyBetween(from, to, now) {
    for (let h = Math.floor(from / HOUR); h <= Math.floor(to / HOUR); h++) if (!this.healthyHour(h, now)) return false;
    return true;
  }

  /** One accepted position report inside the watch area. */
  observe({ mmsi, t, lon, lat, sog, tanker = false, name = '' }) {
    if (!Number.isFinite(t) || !Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const hour = Math.floor(t / HOUR), key = cellOf(lon, lat);
    this.firstHour ??= hour; this.cache = null;
    this.hours.set(hour, (this.hours.get(hour) || 0) + 1);
    let cell = this.cells.get(key);
    if (!cell) { cell = { hour, mask: 0, first: mmsi, counted: false }; this.cells.set(key, cell); }
    if (hour > cell.hour) { cell.mask = this.cellMask(key, hour); cell.hour = hour; cell.first = mmsi; cell.counted = false; }
    if (hour === cell.hour && !cell.counted && cell.first !== mmsi) { cell.mask |= 1; cell.counted = true; }
    const previous = this.seen.get(mmsi);
    if (previous && t - previous.t >= GAP_MIN_MS && t - previous.t <= GAP_MAX_MS && previous.moving && previous.deep && this.healthyBetween(previous.t, t, t)) {
      this.completed.push({ mmsi, name: name || previous.name, tanker: tanker || previous.tanker, from: { t: stamp(previous.t), lon: previous.lon, lat: previous.lat },
        to: { t: stamp(t), lon: round(lon), lat: round(lat) }, hours: round((t - previous.t) / HOUR, 2), distanceNm: round(nauticalMiles([previous.lon, previous.lat], [lon, lat]), 1) });
      if (this.completed.length > COMPLETED_LIMIT) this.completed.splice(0, this.completed.length - COMPLETED_LIMIT);
    }
    if (!previous || t >= previous.t) {
      this.seen.delete(mmsi);
      this.seen.set(mmsi, { t, lon: round(lon), lat: round(lat), name: name || previous?.name || '', tanker: tanker || previous?.tanker || false,
        moving: Number.isFinite(sog) && sog >= MOVING_KNOTS, deep: this.deep(lon, lat, hour) });
      while (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.keys().next().value);
    }
  }

  /** Public summary: ships dark now, gaps in the last week, and the coverage and feed state. */
  status(now = Date.now()) {
    if (this.cache && now - this.cache.at < 60_000) return this.cache.value;
    const hour = Math.floor(now / HOUR);
    for (const [h] of this.hours) if (h < hour - HISTORY_HOURS) this.hours.delete(h);
    for (const [id, s] of this.seen) if (now - s.t > GAP_MAX_MS) this.seen.delete(id);
    this.completed = this.completed.filter(g => now - Date.parse(g.to.t) <= COMPLETED_KEEP_MS);
    const learnedHours = this.firstHour === null ? 0 : hour - this.firstHour;
    const reliableCells = [...this.cells.keys()].filter(key => this.reliable(key, hour)).length;
    const ready = learnedHours >= 24 && reliableCells >= 9, healthy = this.healthyHour(hour, now);
    const darkNow = [];
    for (const [mmsi, s] of this.seen) {
      if (now - s.t < GAP_MIN_MS || !s.moving || !s.deep || !this.healthyBetween(s.t, now, now)) continue;
      darkNow.push({ mmsi, name: s.name, tanker: s.tanker, lastSeen: stamp(s.t), lon: s.lon, lat: s.lat, hours: round((now - s.t) / HOUR, 1) });
    }
    darkNow.sort((a, b) => b.hours - a.hours);
    const week = this.completed.filter(g => now - Date.parse(g.to.t) <= 7 * 24 * HOUR), durations = week.map(g => g.hours);
    const value = {
      basis: 'Ships that stopped reporting for at least three hours while moving deep inside reliable reception. Evidence of AIS being switched off, not proof; a ship leaving coverage is not counted.',
      minHours: GAP_MIN_MS / HOUR, learnedHours, reliableCells, ready, feedHealthy: healthy,
      darkNow: darkNow.slice(0, 40),
      completed: week.slice(-60).reverse(),
      summary: { darkNow: darkNow.length, darkNowTankers: darkNow.filter(d => d.tanker).length, completed7d: week.length, completed7dTankers: week.filter(g => g.tanker).length,
        medianHours: durations.length ? median(durations) : null, longestHours: durations.length ? Math.max(...durations) : null },
    };
    this.cache = { at: now, value };
    return value;
  }

  toJSON() { return { schema: 1, firstHour: this.firstHour, cells: [...this.cells], hours: [...this.hours], seen: [...this.seen], completed: this.completed }; }
  static from(value) {
    const tracker = new GapTracker();
    if (value?.schema !== 1) return tracker;
    const finite = x => Number.isFinite(x);
    tracker.firstHour = finite(value.firstHour) ? value.firstHour : null;
    for (const [key, cell] of Array.isArray(value.cells) ? value.cells : []) if (typeof key === 'string' && finite(cell?.hour) && Number.isInteger(cell?.mask)) tracker.cells.set(key, { hour: cell.hour, mask: cell.mask & 0xffffff, first: String(cell.first ?? ''), counted: cell.counted === true });
    for (const [hour, count] of Array.isArray(value.hours) ? value.hours : []) if (finite(hour) && finite(count)) tracker.hours.set(hour, count);
    for (const [mmsi, s] of (Array.isArray(value.seen) ? value.seen : []).slice(-SEEN_LIMIT)) if (/^[1-9]\d{8}$/.test(mmsi) && finite(s?.t) && finite(s?.lon) && finite(s?.lat)) tracker.seen.set(mmsi, { t: s.t, lon: s.lon, lat: s.lat, name: String(s.name ?? '').slice(0, 80), tanker: s.tanker === true, moving: s.moving === true, deep: s.deep === true });
    tracker.completed = (Array.isArray(value.completed) ? value.completed : []).filter(g => /^[1-9]\d{8}$/.test(g?.mmsi) && Number.isFinite(Date.parse(g?.to?.t)) && Number.isFinite(Date.parse(g?.from?.t)) && finite(g.hours)).slice(-COMPLETED_LIMIT);
    return tracker;
  }
}
