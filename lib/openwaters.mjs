// Open Waters AIS (https://openwaters.io/ais/), a second free feed. Its native
// stream sends one event per decoded AIS message, each carrying its own
// coordinates, receive time, source (for example `aishub`), license and the
// credit line to display. Events go into the same VesselStore as AISStream's,
// through the same validation, so a position is accepted only from a decoded
// position payload and the newest report per ship wins.
//
// The /v1/vessels snapshot endpoint is deliberately not used: its `seen` time
// can belong to a later non-position message while the coordinates are older
// (docs/AIS-SNAPSHOT-PROVENANCE.md). The stream works without a token, but
// anonymous streams are limited to two per network address, which a shared
// hosting address can exhaust; a token (sent as `?key=`) moves the limit onto
// the token. The token never appears in status, errors or logs.
import { AIS_AREAS, TYPES } from './vessel-store.mjs';

export const OPENWATERS_URL = 'wss://ais.openwaters.io/v1/stream';
export const OPENWATERS_PROVIDER = 'Open Waters AIS';
const MESSAGE_TYPES = new Set([...TYPES, 'ShipStaticData', 'StaticDataReport']);
const LIMIT_BYTES = 1024 * 1024, ROTATE = 14 * 60_000, SILENCE = 180_000, CONFIRM = 20_000;
const stamp = value => value == null ? null : new Date(value).toISOString();
const text = (value, max) => typeof value === 'string' ? value.replace(/[\x00-\x1f]/g, '').trim().slice(0, max) : '';

/**
 * The subscription: Passage's areas as [minLat, minLon, maxLat, maxLon]. With
 * `snapshot`, each tracked ship's last messages come first, so names and types
 * arrive at once; every one is still a dated message checked like a live one.
 */
export const openWatersSubscription = (areas = AIS_AREAS) => ({ type: 'subscribe', bbox: areas.map(({ bounds: [[s, w], [n, e]] }) => [s, w, n, e]), snapshot: true });

/** Who to credit for one event: the upstream source named on it, relayed by Open Waters. */
export function openWatersOrigin(event) {
  const source = text(event?.source, 80);
  return {
    provider: OPENWATERS_PROVIDER,
    relaySource: source || null,
    license: text(event?.license, 80) || null,
    attribution: text(event?.attribution, 240) || 'Open Waters AIS (https://openwaters.io/ais/)',
  };
}

/**
 * One native event as an AISStream-shaped envelope, or null. Only the decoded
 * message travels; the event's own lat/lon are never used as coordinates.
 */
export function openWatersEnvelope(event) {
  if (event?.type !== 'event' || !MESSAGE_TYPES.has(event.msg_type) || !event.message || typeof event.message !== 'object') return null;
  if (!/^[1-9]\d{8}$/.test(String(event.mmsi ?? ''))) return null;
  return { MessageType: event.msg_type, MetaData: { MMSI: String(event.mmsi), ShipName: text(event.message.Name, 80), time_utc: typeof event.time === 'string' ? event.time : null }, Message: { [event.msg_type]: event.message } };
}

/**
 * The Open Waters subscription, supervised like AISStream's: it confirms on
 * the welcome frame, retries with backoff, rotates every 14 minutes and
 * reconnects after three silent minutes. Silence never means an empty sea.
 * With `idleMs`, it connects only while someone has looked recently.
 */
export class OpenWatersFeed {
  constructor({ store, Socket = globalThis.WebSocket, now = Date.now, random = Math.random, idleMs = Infinity, enabled = true, token = '', url = OPENWATERS_URL } = {}) {
    Object.assign(this, { store, Socket, now, random, idleMs, enabled: Boolean(enabled && Socket), url });
    // Kept out of `this.url` so nothing that reports the address can carry the key.
    const key = typeof token === 'string' ? token.trim() : '';
    this.address = () => key ? `${url}?key=${encodeURIComponent(key)}` : url;
    this.tokened = Boolean(key);
    this.socket = null; this.connection = this.enabled ? 'idle' : 'not configured'; this.lastClientAt = now();
    this.openedAt = null; this.connectedAt = null; this.lastFrameAt = null; this.lastPositionAt = null; this.retryAt = null; this.attempt = 0; this.error = null; this.closed = false;
    this.limits = null;
    this.counts = { connections: 0, reconnects: 0, frames: 0, events: 0, positionFrames: 0, positionsAccepted: 0, staticMessages: 0, rejected: 0 };
  }
  active() { return this.enabled && !this.closed && this.now() - this.lastClientAt <= this.idleMs; }
  touch() { this.lastClientAt = this.now(); this.tick(); }
  connect() {
    if (!this.active() || this.socket || this.retryAt !== null && this.now() < this.retryAt) return;
    this.connection = 'connecting'; this.openedAt = this.now(); this.connectedAt = null; this.retryAt = null; this.error = null;
    this.counts.connections++; if (this.counts.connections > 1) this.counts.reconnects++;
    let socket;
    try { socket = new this.Socket(this.address()); } catch { this.failed(); return; }
    this.socket = socket; socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => { if (this.socket === socket) try { socket.send(JSON.stringify(openWatersSubscription())); } catch { this.failed(socket); } });
    socket.addEventListener('message', event => this.receive(socket, event.data));
    socket.addEventListener('error', () => { if (this.socket === socket) this.failed(socket); });
    socket.addEventListener('close', () => { if (this.socket === socket) this.failed(socket); });
  }
  receive(socket, data) {
    if (this.socket !== socket) return;
    this.counts.frames++; this.lastFrameAt = this.now();
    let message;
    try {
      const raw = typeof data === 'string' ? data : new TextDecoder().decode(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
      if (raw.length > LIMIT_BYTES) throw Error();
      message = JSON.parse(raw);
    } catch { this.counts.rejected++; return; }
    if (message?.type === 'welcome') {
      this.connection = 'connected'; this.connectedAt = this.now(); this.attempt = 0;
      this.limits = message.limits && typeof message.limits === 'object' ? { area: message.limits.area ?? null, rate: message.limits.rate ?? null } : null;
      return;
    }
    if (message?.type === 'error') { this.error = 'Open Waters rejected the subscription or reported a service error.'; this.failed(socket); return; }
    if (message?.type !== 'event') return;
    this.counts.events++;
    const envelope = openWatersEnvelope(message);
    if (!envelope) { this.counts.rejected++; return; }
    if (TYPES.includes(envelope.MessageType)) this.counts.positionFrames++;
    if (this.store.ingest(envelope, this.now(), openWatersOrigin(message))) { this.lastPositionAt = this.now(); this.counts.positionsAccepted++; }
    else if (this.store.lastOutcome === 'static') this.counts.staticMessages++;
    else this.counts.rejected++;
  }
  failed(socket = this.socket) {
    if (socket && this.socket !== socket) return;
    this.socket = null; try { socket?.close(1000, 'reconnect'); } catch {}
    this.connection = 'disconnected'; this.error ||= 'Open Waters transport unavailable; received positions remain separately dated.';
    this.retryAt = this.active() ? this.now() + Math.round(Math.min(300_000, 5000 * 2 ** Math.min(this.attempt++, 6)) * (0.8 + this.random() * 0.2)) : null;
  }
  disconnect(status = 'idle') {
    const socket = this.socket; this.socket = null; this.retryAt = null; this.connection = this.enabled ? status : 'not configured';
    try { socket?.close(1000, 'idle'); } catch {}
  }
  tick() {
    if (!this.active()) { if (this.socket || this.connection === 'connected') this.disconnect(); return; }
    if (!this.socket) { this.connect(); return; }
    const age = this.now() - this.openedAt;
    if (this.connection === 'connecting' && age >= CONFIRM) { this.error = 'Open Waters welcome timed out.'; this.failed(); }
    else if (age >= ROTATE) { this.error = 'Open Waters transport is rotating; positions retain their original times.'; this.failed(); }
    else if (this.now() - (this.lastFrameAt ?? this.openedAt) >= SILENCE) { this.error = 'No Open Waters frames received recently; transport will retry. This does not establish an empty waterway.'; this.failed(); }
  }
  /** Status for /api/vessels and the source table, in the same shape as AISStream's. */
  status(vessels = []) {
    const own = vessels.filter(v => v.provider === OPENWATERS_PROVIDER), newest = own[0];
    return {
      id: 'openwaters', name: 'Open Waters AIS', home: 'https://openwaters.io/ais/', configured: this.enabled, connection: this.connection,
      recordCount: own.length, frames: this.counts.frames, positionFrames: this.counts.positionFrames, positionsAccepted: this.counts.positionsAccepted,
      retrievedAt: stamp(this.lastPositionAt), latest: newest?.sourceAt || null, timestampBasis: newest?.timestampBasis || null,
      connectedAt: stamp(this.connectedAt), lastFrameAt: stamp(this.lastFrameAt), lastPositionReceivedAt: stamp(this.lastPositionAt), nextRetryAt: stamp(this.retryAt),
      error: this.error, interval: 10, limits: this.limits, access: this.tokened ? 'token' : 'anonymous', sources: [...new Set(own.map(v => v.relaySource).filter(Boolean))].sort(),
      attribution: [...new Set([...this.store.vessels.values()].filter(v => v.provider === OPENWATERS_PROVIDER).map(v => v.attribution).filter(Boolean))].slice(0, 5),
      relay: 'Background outbound connection to the Open Waters stream; it relays AISHub and volunteer receivers about a minute behind.',
      freshness: !newest ? 'unknown' : newest.stale ? 'stale' : 'current',
    };
  }
  close() { this.closed = true; this.disconnect('disconnected'); }
}
