// Hormuz hero map: WebGL terrain with received vessels, last-hour tracks and a
// replay of received positions. Nothing is extrapolated between reports.
import { SCENES, geographicPoint, clamp } from '../terrain/geometry.mjs';
import { shipSprite, localView } from '../terrain/ship-sprites.mjs';
import { createTerrainView } from './terrain-view.mjs';
import { isCurrentVesselPosition, POSITION_STALE_MS } from '../vessel-data.mjs';
import { isTanker, esc } from './panels.mjs';

const SCENE = SCENES.hormuz;
// The free feed's receivers sit along the Dubai and Sharjah coast, so the
// default frame runs from those anchorages to the strait and Iran beyond.
const FRAME_CENTER = [55.55, 25.8];
// Reference places only; their coordinates are static, not vessel data.
const HERO_LABELS = [
  { name: 'UAE', point: [55.6, 24.85], kind: 'country' },
  { name: 'Dubai', point: [55.27, 25.2], kind: 'place' },
  { name: 'Jebel Ali', point: [55.06, 25.01], kind: 'place' },
  { name: 'Sharjah', point: [55.39, 25.35], kind: 'place' },
  { name: 'Fujairah', point: [56.33, 25.12], kind: 'place' },
  { name: 'STRAIT OF HORMUZ', point: [56.55, 26.45], kind: 'water' },
];
export const REPLAY_WINDOW_MS = 60 * 60_000;
export const REPLAY_DURATION_MS = 12_000;

const ms = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
export function heroPose() {
  const [x, , z] = geographicPoint(FRAME_CENTER, SCENE);
  return { zoom: 1.05, tilt: .92, yaw: -.72, panX: x, panZ: z, topDown: false };
}

/** Initial bearing from one received position to the next, in degrees. */
export function segmentBearing([lon1, lat1], [lon2, lat2]) {
  const r = Math.PI / 180, y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

/** A received track plus the current position, oldest first, inside the window. */
export function trackPoints(vessel, now = Date.now(), windowMs = REPLAY_WINDOW_MS) {
  const points = (Array.isArray(vessel?.track) ? vessel.track : [])
    .filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && ms(p[2]) !== null && now - ms(p[2]) <= windowMs && ms(p[2]) <= now)
    .map(p => [p[0], p[1], ms(p[2])]);
  const current = ms(vessel?.positionTime);
  if (current !== null && Number.isFinite(vessel.longitude) && Number.isFinite(vessel.latitude) && (!points.length || current > points.at(-1)[2])) points.push([vessel.longitude, vessel.latitude, current]);
  return points.sort((a, b) => a[2] - b[2]);
}

/**
 * Where a vessel was at time t, between two received positions. Before its
 * first received point it is absent; it never moves past its latest report.
 */
export function positionAt(points, t) {
  if (!points.length || t < points[0][2]) return null;
  if (t >= points.at(-1)[2]) {
    const last = points.at(-1), prev = points.at(-2);
    return { longitude: last[0], latitude: last[1], bearing: prev ? segmentBearing(prev, last) : null };
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (t <= b[2]) {
      const k = b[2] === a[2] ? 1 : (t - a[2]) / (b[2] - a[2]);
      return { longitude: a[0] + (b[0] - a[0]) * k, latitude: a[1] + (b[1] - a[1]) * k, bearing: segmentBearing(a, b) };
    }
  }
  return null;
}

/** Screen angle, clockwise from up, of a compass bearing at a point on the map. */
export function projectedVesselAngle(vessel, degrees, project) {
  if (!Number.isFinite(degrees)) return null;
  const radians = degrees * Math.PI / 180, latitude = vessel.latitude;
  const start = project([vessel.longitude, latitude]);
  const end = project([vessel.longitude + Math.sin(radians) * .02 / Math.cos(latitude * Math.PI / 180), latitude + Math.cos(radians) * .02]);
  if (![start?.x, start?.y, end?.x, end?.y].every(Number.isFinite)) return null;
  return Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI + 90;
}

export async function createHeroMap(root, { onSelect } = {}) {
  let vessels = [], showAll = true, selected = null, replay = null, view = null;
  const nodes = new Map();
  const sizeFor = pose => clamp(40 * Math.sqrt(pose.zoom), 34, 92);

  function vesselNode(vessel, overlay) {
    let node = nodes.get(vessel.mmsi);
    if (!node) {
      node = Object.assign(document.createElement('button'), { type: 'button', className: 'vessel' });
      node.dataset.mmsi = vessel.mmsi;
      node.addEventListener('click', () => { selected = selected === vessel.mmsi ? null : vessel.mmsi; view.invalidate(); onSelect?.(selected ? vessels.find(v => v.mmsi === selected) || null : null); });
      overlay.append(node); nodes.set(vessel.mmsi, node);
    }
    return node;
  }

  function paintVessel(node, vessel, at, bearing, now, { project, pose, eye, renderer }) {
    const tanker = isTanker(vessel), length = sizeFor(pose);
    const p = project([at.longitude, at.latitude], .25);
    node.hidden = !p.visible;
    if (!p.visible) return;
    const angle = projectedVesselAngle({ longitude: at.longitude, latitude: at.latitude }, bearing, point => project(point, .25));
    const kind = !tanker ? 'other' : angle === null ? 'tanker-marker' : 'tanker';
    if (node.dataset.kind !== kind) { node.dataset.kind = kind; node.innerHTML = ''; node.dataset.sprite = ''; }
    let transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`, origin = '';
    if (kind === 'tanker') {
      // The model is drawn from this vessel's own line of sight, so perspective
      // near the frame edges still shows the side of the hull the camera sees.
      const look = eye ? localView({ eye, point: geographicPoint([at.longitude, at.latitude], SCENE, .25) }) : { cameraYawDegrees: pose.yaw * 180 / Math.PI, cameraTiltDegrees: pose.tilt * 180 / Math.PI };
      const sprite = shipSprite({ headingDegrees: bearing, cameraYawDegrees: look.cameraYawDegrees, cameraTiltDegrees: pose.topDown || renderer.mode === 'plan' ? 0 : look.cameraTiltDegrees, lengthPx: length, screenBowDegrees: angle });
      if (sprite) {
        if (node.dataset.sprite !== sprite.key) { node.innerHTML = `<img alt="" draggable="false" src="${sprite.dataUrl}" width="${sprite.width}" height="${sprite.height}">`; node.dataset.sprite = sprite.key; }
        transform += ` translate(${(-sprite.anchor.x).toFixed(1)}px, ${(-sprite.anchor.y).toFixed(1)}px)` + (sprite.rotationDeg ? ` rotate(${sprite.rotationDeg.toFixed(2)}deg)` : '');
        origin = `${sprite.anchor.x}px ${sprite.anchor.y}px`;
      }
    }
    node.style.transformOrigin = origin;
    node.style.transform = transform;
    node.dataset.stale = String(!replay && now - (ms(vessel.positionTime) ?? now) >= POSITION_STALE_MS);
    node.setAttribute('aria-pressed', String(selected === vessel.mmsi));
    const speed = Number.isFinite(vessel.speedKnots) ? `, ${vessel.speedKnots.toFixed(0)} knots` : '';
    const label = `${tanker ? 'Tanker' : 'Vessel'} ${vessel.name || vessel.mmsi}${speed}${bearing === null ? ', heading not reported' : `, heading ${Math.round(bearing)} degrees`}`;
    if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label);
  }

  function place(ctx) {
    const { project, overlay, svg } = ctx, now = Date.now();
    const t = replay ? replay.from + replay.elapsed / REPLAY_DURATION_MS * (replay.to - replay.from) : now;
    const lines = [], seen = new Set();
    for (const vessel of vessels) {
      const tanker = isTanker(vessel);
      if (!replay && !tanker && !showAll) continue;
      const points = tanker ? trackPoints(vessel, now) : [];
      let at, bearing;
      if (replay) {
        if (!tanker || points.length < 2) continue;
        const where = positionAt(points, t); if (!where) continue;
        at = where; bearing = where.bearing;
      } else {
        at = vessel; bearing = Number.isFinite(vessel.headingDegrees) && vessel.headingDegrees < 360 ? vessel.headingDegrees : Number.isFinite(vessel.courseDegrees) && vessel.courseDegrees < 360 ? vessel.courseDegrees : null;
      }
      seen.add(vessel.mmsi);
      paintVessel(vesselNode(vessel, overlay), vessel, at, bearing, now, ctx);
      if (tanker && points.length > 1) {
        const shown = points.filter(p => p[2] <= t);
        for (let i = 1; i < shown.length; i++) {
          const a = project(shown[i - 1], .2), b = project(shown[i], .2);
          if (!a.visible && !b.visible) continue;
          const age = (t - shown[i][2]) / REPLAY_WINDOW_MS;
          lines.push(`<line class="map-track" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke-opacity="${(.85 - .7 * clamp(age, 0, 1)).toFixed(2)}"/>`);
        }
        if (replay && shown.length) {
          const a = project(shown.at(-1), .2), b = project([at.longitude, at.latitude], .2);
          lines.push(`<line class="map-track" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke-opacity=".85"/>`);
        }
      }
    }
    for (const [mmsi, node] of nodes) if (!seen.has(mmsi)) node.hidden = true;
    svg.innerHTML = lines.join('');
    if (replay) replay.onClock?.(t);
  }

  function stopReplay() { const done = replay?.onEnd; replay = null; view?.invalidate(); done?.(); }
  view = await createTerrainView(root, {
    scene: SCENE, pose: heroPose(),
    labels: [...SCENE.labels.filter(l => l.name !== 'UAE'), ...HERO_LABELS],
    onPlace: place,
    isAnimating: () => Boolean(replay),
    onTick: (dt, reduced) => {
      if (!replay) return;
      replay.elapsed = Math.min(REPLAY_DURATION_MS, replay.elapsed + (reduced ? REPLAY_DURATION_MS : dt));
      if (replay.elapsed >= REPLAY_DURATION_MS) queueMicrotask(stopReplay);
    },
  });

  return {
    mode: view.mode,
    setVessels(list) {
      vessels = (Array.isArray(list) ? list : []).filter(v => v?.theater === 'hormuz' && isCurrentVesselPosition(v));
      if (selected && !vessels.some(v => v.mmsi === selected)) { selected = null; onSelect?.(null); }
      view.invalidate();
    },
    vessel(mmsi) { return vessels.find(v => v.mmsi === mmsi) || null; },
    select(mmsi) { selected = mmsi; view.invalidate(); },
    setShowAll(value) { showAll = Boolean(value); view.invalidate(); },
    setPaused: value => view.setPaused(value),
    zoom: factor => view.zoom(factor),
    reset: () => view.reset(),
    toggleTopDown: () => view.toggleTopDown(),
    flyTo: (point, options) => view.flyTo(point, options),
    /** Replays received tanker positions from the last hour; returns false if none. */
    replay({ onClock, onEnd } = {}) {
      const now = Date.now(), withTracks = vessels.filter(v => isTanker(v) && trackPoints(v, now).length > 1);
      if (!withTracks.length) return false;
      const from = Math.min(...withTracks.map(v => trackPoints(v, now)[0][2]));
      replay = { from, to: now, elapsed: 0, onClock, onEnd }; view.invalidate();
      return true;
    },
    stopReplay,
    get replaying() { return Boolean(replay); },
    destroy: () => view.destroy(),
  };
}

export const vesselLabel = vessel => `${isTanker(vessel) ? 'Tanker' : 'Vessel'} ${vessel.name || vessel.mmsi}`;
export { esc };
