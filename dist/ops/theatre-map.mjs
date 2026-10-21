// Regional war theatre: 3D terrain from the Gulf to the Red Sea with dated,
// source-linked events and approximate naval mission areas.
import { SCENES, geographicPoint } from '../terrain/geometry.mjs';
import { createTerrainView } from './terrain-view.mjs';
import { esc, dayLabel } from './panels.mjs';

const SCENE = SCENES.theatre;
const FRAME_CENTER = [46.2, 20.6];
const RECENT_MS = 7 * 86_400_000;
/** Day and month, plus the year when it is not the current one (Aspides began in 2024). */
const missionDay = day => day.slice(0, 4) === String(new Date().getUTCFullYear()) ? dayLabel(day) : `${dayLabel(day)} ${day.slice(0, 4)}`;
export function theatrePose() {
  const [x, , z] = geographicPoint(FRAME_CENTER, SCENE);
  return { zoom: .92, tilt: .72, yaw: -.1, panX: x, panZ: z, topDown: false };
}
/** Zoom used when "show me" flies to an event: closer for precise places. */
export const focusZoom = event => event.precision === 'facility' || event.precision === 'city' ? 4.2 : 3.2;

const destination = ([lon, lat], bearing, nmDistance) => {
  const r = Math.PI / 180, d = nmDistance / 3440.065, b = bearing * r, p1 = lat * r, l1 = lon * r;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [l2 / r, p2 / r];
};

export async function createTheatreMap(root, { onSelect } = {}) {
  let events = [], missions = [], selected = null, view = null, showMissions = true;
  const nodes = new Map();

  function node(event, overlay) {
    let el = nodes.get(event.id);
    if (!el) {
      el = Object.assign(document.createElement('button'), { type: 'button', className: 'event' });
      el.dataset.id = event.id;
      el.addEventListener('click', () => { const next = selected === event.id ? null : event.id; api.select(next, { fly: false }); onSelect?.(next ? events.find(e => e.id === next) : null); });
      overlay.append(el); nodes.set(event.id, el);
    }
    return el;
  }

  function place({ project, overlay, svg }) {
    const now = Date.now(), shapes = [];
    if (showMissions) for (const m of missions) {
      const pts = m.polygon.map(p => project(p, .05));
      if (pts.every(p => !p.visible)) continue;
      shapes.push(`<path class="mission-area" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')}Z"/>`);
      const c = project(m.labelAt, .05);
      if (!c.visible) continue;
      const x = c.x.toFixed(1), dates = m.end ? `${missionDay(m.start)} – ${missionDay(m.end)}` : `Since ${missionDay(m.start)}`;
      shapes.push(`<text class="mission-label" x="${x}" y="${c.y.toFixed(1)}">${esc(m.name)}<tspan class="mission-dates" x="${x}" dy="12">${esc(dates)}</tspan></text>`);
    }
    const seen = new Set();
    for (const e of events) {
      const el = node(e, overlay), p = project([e.lon, e.lat], .3);
      seen.add(e.id); el.hidden = !p.visible;
      if (!p.visible) continue;
      el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
      el.dataset.layer = e.layer; el.dataset.confidence = e.confidence;
      el.dataset.recent = String(now - Date.parse(e.date + 'T12:00:00Z') <= RECENT_MS);
      el.setAttribute('aria-pressed', String(selected === e.id));
      const label = `${e.title}. ${e.date}. ${e.place}${e.confidence === 'claimed' ? '. Claimed' : ''}`;
      if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
      if (selected === e.id && Number.isFinite(e.radiusNm) && e.radiusNm > 0) {
        const edge = project(destination([e.lon, e.lat], 90, e.radiusNm), .3);
        if (edge.visible) shapes.push(`<circle class="event-radius" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${Math.hypot(edge.x - p.x, edge.y - p.y).toFixed(1)}"/>`);
      }
    }
    for (const [id, el] of nodes) if (!seen.has(id)) el.hidden = true;
    svg.innerHTML = shapes.join('');
  }

  view = await createTerrainView(root, { scene: SCENE, pose: theatrePose(), labels: SCENE.labels, onPlace: place });
  const api = {
    mode: view.mode,
    setEvents(list) { events = Array.isArray(list) ? list : []; if (selected && !events.some(e => e.id === selected)) selected = null; view.invalidate(); },
    setMissions(list, visible = showMissions) { missions = Array.isArray(list) ? list : []; showMissions = visible; view.invalidate(); },
    setShowMissions(value) { showMissions = Boolean(value); view.invalidate(); },
    select(id, { fly = true } = {}) {
      selected = id || null;
      const event = events.find(e => e.id === selected);
      if (event && fly) view.flyTo([event.lon, event.lat], { zoom: focusZoom(event) });
      view.invalidate();
    },
    setPaused: value => view.setPaused(value),
    zoom: factor => view.zoom(factor),
    reset: () => view.reset(),
    toggleTopDown: () => view.toggleTopDown(),
    destroy: () => view.destroy(),
  };
  return api;
}
