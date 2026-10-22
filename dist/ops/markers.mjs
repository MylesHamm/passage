// War-event markers shared by the regional map and the Hormuz map: one button
// per event, numbered groups where markers would overlap, and the selected
// event's likely radius.
const RECENT_MS = 7 * 86_400_000;
/** Markers closer than this on screen are drawn as one numbered group. */
export const GROUP_PX = 16;
const MAX_ZOOM = 8;

/**
 * Greedy screen-space grouping, newest first. The selected event always
 * stands alone so its marker and radius stay visible.
 */
export function groupMarkers(points, { selected = null, radius = GROUP_PX } = {}) {
  const order = [...points].sort((a, b) => (b.event.id === selected) - (a.event.id === selected) || b.event.date.localeCompare(a.event.date) || a.event.id.localeCompare(b.event.id));
  const groups = [];
  for (const point of order) {
    const solo = point.event.id === selected;
    const group = solo ? null : groups.find(g => !g.solo && Math.hypot(g.x - point.x, g.y - point.y) < radius);
    if (group) group.members.push(point); else groups.push({ x: point.x, y: point.y, solo, members: [point] });
  }
  return groups;
}
/**
 * Whether a tap on a group also flies in: only when that would separate its
 * markers. The group's events are listed either way.
 */
export function groupAction(group, zoom, { radius = GROUP_PX, maxZoom = MAX_ZOOM } = {}) {
  const spread = Math.max(...group.members.map(m => Math.hypot(m.x - group.x, m.y - group.y)));
  const needed = spread > 0 ? zoom * radius * 1.5 / spread : Infinity;
  return needed <= maxZoom ? { kind: 'zoom', zoom: Math.min(maxZoom, Math.max(needed, zoom * 1.6)) } : { kind: 'list' };
}

const destination = ([lon, lat], bearing, nmDistance) => {
  const r = Math.PI / 180, d = nmDistance / 3440.065, b = bearing * r, p1 = lat * r, l1 = lon * r;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [l2 / r, p2 / r];
};
const layerOf = members => {
  const counts = {};
  for (const m of members) counts[m.event.layer] = (counts[m.event.layer] || 0) + 1;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return ranked.length > 1 && ranked[0][1] === ranked[1][1] ? 'mixed' : ranked[0][0];
};

/**
 * One map's event markers. `view` returns the terrain view (for its zoom and
 * fly-to); `onSelect` gets the tapped event or null, `onGroup` a group's events.
 */
export function createEventMarkers({ view, onSelect, onGroup } = {}) {
  let events = [], selected = null;
  const nodes = new Map(), groupNodes = new Map(), groupMembers = new Map();

  function node(event, overlay) {
    let el = nodes.get(event.id);
    if (!el) {
      el = Object.assign(document.createElement('button'), { type: 'button', className: 'event' });
      el.dataset.id = event.id;
      el.addEventListener('click', () => { selected = selected === event.id ? null : event.id; view().invalidate(); onSelect?.(selected ? events.find(e => e.id === selected) : null); });
      overlay.append(el); nodes.set(event.id, el);
    }
    return el;
  }
  function groupNode(id, overlay) {
    let el = groupNodes.get(id);
    if (!el) {
      el = Object.assign(document.createElement('button'), { type: 'button', className: 'event-group' });
      el.addEventListener('click', () => {
        const group = groupMembers.get(id);
        if (!group) return;
        const action = groupAction(group, view().pose.zoom), n = group.members.length;
        const centre = [group.members.reduce((s, m) => s + m.event.lon, 0) / n, group.members.reduce((s, m) => s + m.event.lat, 0) / n];
        if (action.kind === 'zoom') view().flyTo(centre, { zoom: action.zoom });
        onGroup?.(group.members.map(m => m.event));
      });
      overlay.append(el); groupNodes.set(id, el);
    }
    return el;
  }

  /** Draws the markers; the selected event's radius circle is pushed onto `shapes`. */
  function place({ project, overlay, shapes }) {
    const now = Date.now(), points = [];
    for (const event of events) {
      const p = project([event.lon, event.lat], .3);
      if (p.visible) points.push({ event, x: p.x, y: p.y });
    }
    const shown = new Set(), shownGroups = new Set();
    groupMembers.clear();
    for (const group of groupMarkers(points, { selected })) {
      const [{ event: lead }] = group.members, translate = `translate3d(${group.x.toFixed(1)}px, ${group.y.toFixed(1)}px, 0)`;
      const recent = group.members.some(m => now - Date.parse(m.event.date + 'T12:00:00Z') <= RECENT_MS);
      if (group.members.length > 1) {
        const el = groupNode(lead.id, overlay), count = String(group.members.length);
        shownGroups.add(lead.id); groupMembers.set(lead.id, group);
        el.hidden = false; el.style.transform = translate;
        el.dataset.layer = layerOf(group.members); el.dataset.recent = String(recent);
        if (el.textContent !== count) el.textContent = count;
        const label = `${count} events here. Newest: ${lead.title}, ${lead.date}. ${groupAction(group, view().pose.zoom).kind === 'zoom' ? 'List them and zoom in' : 'List them'}`;
        if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
        continue;
      }
      const el = node(lead, overlay);
      shown.add(lead.id); el.hidden = false; el.style.transform = translate;
      el.dataset.layer = lead.layer; el.dataset.confidence = lead.confidence; el.dataset.recent = String(recent);
      el.setAttribute('aria-pressed', String(selected === lead.id));
      const label = `${lead.title}. ${lead.date}. ${lead.place}${lead.confidence === 'claimed' ? '. Claimed' : ''}`;
      if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
      if (selected === lead.id && Number.isFinite(lead.radiusNm) && lead.radiusNm > 0) {
        const edge = project(destination([lead.lon, lead.lat], 90, lead.radiusNm), .3);
        if (edge.visible) shapes.push(`<circle class="event-radius" cx="${group.x.toFixed(1)}" cy="${group.y.toFixed(1)}" r="${Math.hypot(edge.x - group.x, edge.y - group.y).toFixed(1)}"/>`);
      }
    }
    for (const [id, el] of nodes) if (!shown.has(id)) el.hidden = true;
    for (const [id, el] of groupNodes) if (!shownGroups.has(id)) el.hidden = true;
  }

  return {
    place,
    get events() { return events; },
    get selected() { return selected; },
    setEvents(list) { events = Array.isArray(list) ? list : []; if (selected && !events.some(e => e.id === selected)) selected = null; view()?.invalidate(); },
    select(id) { selected = id || null; view()?.invalidate(); },
  };
}
