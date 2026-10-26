// Regional war theatre: 3D terrain from the Gulf to the Red Sea with dated,
// source-linked events and approximate naval mission areas.
import { SCENES, geographicPoint, cameraMatrix, project as projectPoint } from '../terrain/geometry.mjs';
import { createTerrainView } from './terrain-view.mjs';
import { esc, dayLabel } from './panels.mjs';
import { createEventMarkers } from './markers.mjs';
export { GROUP_PX, groupMarkers, groupAction } from './markers.mjs';

const SCENE = SCENES.theatre;
const FRAME_CENTER = [46.2, 20.6];
/** The theatre zooms out further than the Hormuz map, far enough to see every front. */
export const MIN_ZOOM = .32;
/** A gentler look around than Hormuz, so the framed events stay on screen as it turns. */
export const SWAY = .12;
/** Day and month, plus the year when it is not the current one (Aspides began in 2024). */
const missionDay = day => day.slice(0, 4) === String(new Date().getUTCFullYear()) ? dayLabel(day) : `${dayLabel(day)} ${day.slice(0, 4)}`;
export function theatrePose() {
  const [x, , z] = geographicPoint(FRAME_CENTER, SCENE);
  return { zoom: .92, tilt: .72, yaw: -.1, panX: x, panZ: z, topDown: false };
}
/**
 * The opening view: centred on the events and as close as it can be while
 * every one stays on screen, clear of the overlays at the top and bottom.
 */
export function fitPose(points, width, height, { base = theatrePose(), margins = null } = {}) {
  const located = (Array.isArray(points) ? points : []).filter(p => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
  if (!located.length || !(width > 1) || !(height > 1)) return base;
  // On a phone the zoom buttons stand down the right edge, so keep clear of them too.
  const m = margins || { top: Math.min(110, height * .24), bottom: Math.min(56, height * .14), left: Math.min(24, width * .06), right: width < 640 ? 60 : Math.min(24, width * .06) };
  const lons = located.map(p => p[0]), lats = located.map(p => p[1]);
  const [cx, , cz] = geographicPoint([(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2], SCENE);
  const world = located.map(p => geographicPoint(p, SCENE, 0));
  // The camera sways by SWAY either side of its yaw, so the fit must hold across the swing.
  const fits = pose => [-SWAY, 0, SWAY].every(turn => {
    const { matrix } = cameraMatrix({ ...pose, yaw: pose.yaw + turn }, SCENE, width, height);
    return world.every(w => { const p = projectPoint(w, matrix, width, height); return p.x >= m.left && p.x <= width - m.right && p.y >= m.top && p.y <= height - m.bottom; });
  });
  // The top overlay is taller than the bottom one, so also try nudging the
  // centre north, which moves the events down the screen.
  for (let zoom = 1.6; zoom >= MIN_ZOOM; zoom *= .97) {
    const span = SCENE.extent / zoom;
    for (const shift of [0, -.03, -.06, -.09, .03]) {
      const pose = { ...base, zoom, panX: cx, panZ: cz + shift * span };
      if (fits(pose)) return pose;
    }
  }
  return { ...base, zoom: MIN_ZOOM, panX: cx, panZ: cz };
}
/** Zoom used when "show me" flies to an event: closer for precise places. */
export const focusZoom = event => event.precision === 'facility' || event.precision === 'city' ? 3.3 : 2.7;
/** The two fronts the map can jump to. */
export const FRONTS = Object.freeze({
  hormuz: Object.freeze({ center: [55.4, 26.2], zoom: 3.1 }),
  'red-sea': Object.freeze({ center: [44.2, 14.4], zoom: 2.3 }),
});

export async function createTheatreMap(root, { onSelect, onGroup } = {}) {
  let missions = [], view = null, showMissions = true, fitPoints = null;
  const markers = createEventMarkers({ view: () => view, onSelect, onGroup });
  // Frame every event once they arrive, and again on resize until the reader moves the camera.
  function fit() {
    const box = root.getBoundingClientRect();
    view.home(fitPose(fitPoints, box.width, box.height), { move: !view.interacted });
  }

  function place({ project, overlay, svg }) {
    const shapes = [];
    if (showMissions) for (const m of missions) {
      const pts = m.polygon.map(p => project(p, .05));
      if (pts.every(p => !p.visible)) continue;
      shapes.push(`<path class="mission-area" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')}Z"/>`);
      const c = project(m.labelAt, .05);
      if (!c.visible) continue;
      const x = c.x.toFixed(1), dates = m.end ? `${missionDay(m.start)} to ${missionDay(m.end)}` : `Since ${missionDay(m.start)}`;
      shapes.push(`<text class="mission-label" x="${x}" y="${c.y.toFixed(1)}">${esc(m.name)}<tspan class="mission-dates" x="${x}" dy="12">${esc(dates)}</tspan></text>`);
    }
    markers.place({ project, overlay, shapes });
    svg.innerHTML = shapes.join('');
  }

  view = await createTerrainView(root, { scene: SCENE, pose: theatrePose(), minZoom: MIN_ZOOM, swayAmplitude: SWAY, labels: SCENE.labels, onPlace: place });
  new ResizeObserver(() => { if (fitPoints && !view.interacted) fit(); }).observe(root);
  const api = {
    mode: view.mode,
    setEvents(list) {
      markers.setEvents(list);
      if (!fitPoints && markers.events.length) { fitPoints = markers.events.map(e => [e.lon, e.lat]); fit(); }
    },
    setMissions(list, visible = showMissions) { missions = Array.isArray(list) ? list : []; showMissions = visible; view.invalidate(); },
    setShowMissions(value) { showMissions = Boolean(value); view.invalidate(); },
    /** Selects an event and flies to it; `zoom` overrides the close-up zoom for its precision. */
    select(id, { fly = true, zoom = null } = {}) {
      markers.select(id);
      const event = markers.events.find(e => e.id === id);
      if (event && fly) view.flyTo(event.layer === 'shipping' ? view.seaPoint([event.lon, event.lat]) : [event.lon, event.lat], { zoom: zoom ?? focusZoom(event) });
    },
    /** Jumps to one of the two fronts: Hormuz, or the Red Sea and Yemen. */
    front(name) { const front = FRONTS[name]; if (front) view.flyTo(front.center, { zoom: front.zoom }); },
    setPaused: value => view.setPaused(value),
    zoom: factor => view.zoom(factor),
    reset: () => view.reset(),
    toggleTopDown: () => view.toggleTopDown(),
    destroy: () => view.destroy(),
  };
  return api;
}
