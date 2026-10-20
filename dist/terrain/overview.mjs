import {SCENES, eligibleVessels, isCoordinate} from './geometry.mjs';
import {createPlanRenderer, loadSceneAssets} from './renderer.mjs';
import {paintVesselSymbol} from './vessel-symbol.mjs';

export const OVERVIEW_REGIONS = Object.freeze(['hormuz', 'bab']);
export const OVERVIEW_POSE = Object.freeze({zoom:.76, panX:0, panZ:0, topDown:true});
const TEN_MINUTES = 600000, THIRTY_MINUTES = 1800000;

const inRegion = (item, scene) => Array.isArray(item.theaters) && item.theaters.length
  ? item.theaters.includes(scene.id)
  : !item.theater || item.theater === scene.id;
const bearing = item => [item.headingDegrees, item.courseDegrees]
  .find(value => Number.isFinite(value) && value >= 0 && value < 360);

// Region membership, source time and the actual pane projection must all agree.
// An absent heading becomes a circle; neither a position nor direction is inferred.
export function overviewLayers({scene, project, vessels=[], showVessels=false, infrastructure=[], events=[], now=Date.now()}){
  const items = [
    ...(showVessels ? eligibleVessels(vessels, scene, now).map(item => ({
      ...item, kind:'vessel', id:item.mmsi || item.id, label:item.name || 'Vessel name not reported',
      older:now-Date.parse(item.positionTime) >= TEN_MINUTES, bearing:bearing(item),
    })) : []),
    ...infrastructure.filter(item => isCoordinate(item) && inRegion(item, scene))
      .map(item => ({...item, kind:'infrastructure', label:item.name || 'Infrastructure reference'})),
    ...events.filter(item => isCoordinate(item) && inRegion(item, scene))
      .map(item => ({...item, kind:'event', label:item.title || 'Structured source record'})),
  ];
  const seen = new Set(), result = [];
  for(const item of items){
    if(item.id === undefined || item.id === null || item.id === '') continue;
    const point = project([item.longitude, item.latitude]);
    const key = `${item.kind}:${item.id}`;
    if(!point?.visible || !Number.isFinite(point.x) || !Number.isFinite(point.y) || seen.has(key)) continue;
    seen.add(key);result.push({...item, key, x:point.x, y:point.y});
    if(result.length === 250) break;
  }
  return result;
}

export function nextOverviewVesselChange(vessels, now=Date.now()){
  const changes = (Array.isArray(vessels) ? vessels : []).flatMap(item => {
    const time = Date.parse(item.positionTime), age = now-time;
    if(!isCoordinate(item) || !Number.isFinite(time) || age < 0 || age >= THIRTY_MINUTES) return [];
    return [time+TEN_MINUTES, time+THIRTY_MINUTES].filter(change => change > now);
  });
  return changes.length ? Math.min(...changes)-now+1 : null;
}

export function overviewVesselCaption({showVessels=false, count=0, availability=null, mapStatus='ready'}={}){
  if(mapStatus === 'loading') return 'Preparing reference map · positions cannot be displayed yet';
  if(mapStatus !== 'ready') return 'Reference map unavailable · positions cannot be displayed in this frame';
  if(!showVessels) return 'Received AIS layer off';
  const healthy = ['available', 'empty', 'filtered'].includes(availability?.status);
  const countText = count ? `${count} ${healthy ? '' : 'previously '}received position${count === 1 ? '' : 's'} in this frame · partial reception` : 'No matching received positions in this frame';
  if(healthy){
    if(!count && availability?.status === 'filtered') return 'No received positions match the selected vessel type · choose All received to inspect other types';
    if(!count && availability?.count > 0) return `${availability.count} received position${availability.count === 1 ? ' matches' : 's match'} the selected reporting area; none are in this frame`;
    if(!count && availability?.status === 'empty') return 'No received positions in the selected reporting area · reception is incomplete';
    return countText;
  }
  return `${availability?.heading || 'Checking vessel reception'} · ${count ? countText : 'Position availability is not established for this frame'}`;
}

export function overviewReadiness(regions){
  if(regions.some(region => region.status === 'loading')) return 'loading';
  const available = regions.filter(region => region.status === 'ready').length;
  return available === OVERVIEW_REGIONS.length ? 'ready' : available ? 'partial' : 'unavailable';
}

// Each result is delivered separately: a failed map cannot hide the other strait.
export async function loadOverviewPlans({load=loadSceneAssets, signal, onRegion=()=>{}}={}){
  return Promise.all(OVERVIEW_REGIONS.map(async id => {
    let result;
    try{
      const assets = await load(SCENES[id], {signal, planOnly:true});
      result = {id, status:'ready', assets};
    }catch(error){
      result = {id, status:'unavailable', error:String(error?.message || 'Reference map unavailable')};
    }
    onRegion(result);
    return result;
  }));
}

/** Two independent, north-up regional frames. No continuous connecting map is implied. */
export function createBothOverview(root, callbacks={}, options={}){
  const document = root.ownerDocument;
  const abort = new AbortController(), panes = new Map(), listeners = [];
  let destroyed = false, expiry = 0, vessels = [], infrastructure = [], events = [], showVessels = false, availability = null;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);node.className = className;
    if(text !== undefined) node.textContent = text;
    return node;
  };
  const listen = (node, type, listener) => {
    node.addEventListener(type, listener);
    listeners.push(() => node.removeEventListener(type, listener));
  };
  root.classList.add('both-overview');
  root.setAttribute('aria-label', 'Both straits: separate regional reference maps');
  const note = element('p', 'both-overview-note', 'Separate regional views — not adjoining geography or a shared distance scale.');
  const grid = element('div', 'both-overview-grid');
  root.replaceChildren(note, grid);

  for(const id of OVERVIEW_REGIONS){
    const scene = SCENES[id], pane = element('section', 'both-overview-pane');
    pane.dataset.overviewRegion = id;pane.dataset.state = 'loading';
    pane.setAttribute('aria-label', scene.name+' regional reference');
    const header = element('header', 'both-overview-heading');
    const title = element('div', 'both-overview-title');
    title.append(element('h3', '', scene.name), element('p', '', scene.coordinates));
    const focus = element('button', 'both-overview-focus', 'Focus ↗');
    focus.type = 'button';focus.setAttribute('aria-label', 'Focus '+scene.name);
    listen(focus, 'click', () => callbacks.onSelect?.(id));
    header.append(title, focus);
    const surface = element('div', 'both-overview-surface');
    const canvas = element('canvas', 'both-overview-canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', scene.name+'. Static north-up terrain reference; not for navigation.');
    const layers = element('div', 'both-overview-layers');
    layers.setAttribute('aria-label', scene.name+' received positions and references');
    const labels = element('div', 'both-overview-labels');
    labels.setAttribute('aria-hidden', 'true');
    const centre = element('span', 'both-overview-centre');
    centre.title = scene.name+' reference coordinates';centre.setAttribute('aria-hidden', 'true');
    const north = element('span', 'both-overview-north', '↑ N');
    north.setAttribute('aria-hidden', 'true');
    const scale = element('div', 'both-overview-scale');
    scale.append(element('i', ''), element('span', ''));
    const message = element('p', 'both-overview-message', 'Loading '+scene.name+' reference…');
    message.setAttribute('role', 'status');
    const received = element('p', 'both-overview-received', 'Received AIS layer off');
    surface.append(canvas, labels, layers, centre, north, scale, message);
    pane.append(header, surface, received);grid.append(pane);
    const state = {id, scene, pane, surface, canvas, layers, labels, centre, scale, message, received,
      renderer:null, assets:null, status:'loading', error:null, markerNodes:new Map(), visibleVesselCount:0, visibleLayerCount:0};
    try{state.renderer = createPlanRenderer(canvas);}
    catch(error){state.status = 'unavailable';state.error = String(error.message);}
    panes.set(id, state);
  }

  function updateReadiness(){
    root.dataset.overviewState = overviewReadiness([...panes.values()]);
  }
  function markerLabel(item){
    if(item.kind === 'vessel') return `${item.label}. Received AIS position. Provider/receipt timestamp ${item.positionTime}.${item.provider ? ' Source: '+item.provider+'.' : ''}${item.older ? ' More than ten minutes old.' : ''}`;
    return `${item.label}. ${item.kind === 'infrastructure' ? item.basis || 'Approximate infrastructure reference' : 'Source-provided event coordinate'}`;
  }
  function markers(pane, rows){
    const retained = new Set();let modelCount = 0;
    for(const item of rows){
      retained.add(item.key);
      let entry = pane.markerNodes.get(item.key);
      if(!entry){
        const button = element('button', 'both-overview-marker'), symbol = element('span', '');
        button.type = 'button';symbol.setAttribute('aria-hidden', 'true');button.append(symbol);
        entry = {button, symbol, item};
        button.addEventListener('click', () => {
          const current = entry.item;
          callbacks[current.kind === 'vessel' ? 'onVessel' : current.kind === 'infrastructure' ? 'onInfrastructure' : 'onEvent']?.(current.id);
        });
        pane.layers.append(button);pane.markerNodes.set(item.key, entry);
      }
      entry.item = item;
      const {button, symbol} = entry;
      button.dataset.kind = item.kind;button.dataset.recordId = String(item.id);
      button.className = `both-overview-marker both-overview-marker--${item.kind}${item.older ? ' both-overview-marker--older' : ''}`;
      button.setAttribute('aria-label', markerLabel(item));button.title = markerLabel(item);
      button.style.transform = `translate(${item.x}px, ${item.y}px) translate(-50%, -50%)`;
      if(item.kind === 'vessel'){
        const appearance = paintVesselSymbol(symbol, item, {tankerModels:options.tankerModels===true && modelCount<8});
        button.dataset.model = String(appearance.model);if(appearance.model) modelCount++;
        button.setAttribute('aria-label', markerLabel(item)+' '+appearance.description);button.title=button.getAttribute('aria-label');
        symbol.style.transform = appearance.bearing === null ? '' : `rotate(${appearance.bearing}deg)`;
      }else{
        symbol.textContent = item.kind === 'infrastructure' ? '□' : '○';symbol.style.transform = '';
      }
    }
    for(const [key, entry] of pane.markerNodes) if(!retained.has(key)){
      entry.button.remove();pane.markerNodes.delete(key);
    }
  }
  function draw(pane){
    if(destroyed) return;
    if(pane.status !== 'ready'){pane.received.textContent=overviewVesselCaption({mapStatus:pane.status});return;}
    const {width, height} = pane.surface.getBoundingClientRect();
    if(!width || !height) return;
    const renderer = pane.renderer;
    renderer.resize(width, height);renderer.draw(OVERVIEW_POSE);
    const point = coordinates => {
      const projected = renderer.point(coordinates);
      return {...projected, visible:projected.visible && projected.x >= 16 && projected.x <= width-16
        && projected.y >= 16 && projected.y <= height-16};
    };
    const centre = renderer.point(pane.scene.center);
    pane.centre.style.transform = `translate(${centre.x}px, ${centre.y}px) translate(-50%, -50%)`;
    pane.centre.hidden = !centre.visible;
    pane.labels.replaceChildren();
    const occupied = [{x:centre.x-15, y:centre.y-15, width:30, height:30}];
    for(const label of pane.scene.labels){
      const p = point(label.point), box = {x:p.x, y:p.y, width:label.name.length*6+8, height:15};
      if(!p.visible || p.y < 25 || p.y > height-28 || p.x+box.width > width-8
        || occupied.some(other => box.x < other.x+other.width && box.x+box.width > other.x && box.y < other.y+other.height && box.y+box.height > other.y)) continue;
      const node = element('span', 'both-overview-place', label.name);
      node.style.transform = `translate(${p.x}px, ${p.y}px)`;pane.labels.append(node);occupied.push(box);
    }
    const rows = overviewLayers({scene:pane.scene, project:point, vessels, showVessels, infrastructure, events});
    markers(pane, rows);
    pane.visibleVesselCount = rows.filter(row => row.kind === 'vessel').length;pane.visibleLayerCount = rows.length;
    pane.received.textContent = overviewVesselCaption({showVessels, count:pane.visibleVesselCount, availability});
    const km = renderer.span >= 200 ? 50 : 20;
    const left = renderer.localPoint([-km/2, 0, 0]), right = renderer.localPoint([km/2, 0, 0]);
    pane.scale.firstElementChild.style.width = Math.abs(right.x-left.x)+'px';
    pane.scale.lastElementChild.textContent = km+' km';
  }
  function refresh(){
    if(destroyed) return;
    clearTimeout(expiry);
    for(const pane of panes.values()) draw(pane);
    const next = showVessels ? nextOverviewVesselChange(vessels) : null;
    if(next !== null) expiry = setTimeout(refresh, next);
  }
  const observer = new ResizeObserver(refresh);
  for(const pane of panes.values()) observer.observe(pane.surface);
  listen(document, 'visibilitychange', () => {if(!document.hidden) refresh();});
  updateReadiness();
  const ready = loadOverviewPlans({signal:abort.signal, onRegion:result => {
    const pane = panes.get(result.id);
    if(destroyed){result.assets?.planImage?.close?.();return;}
    if(result.status === 'ready' && pane.renderer){
      pane.assets = result.assets;pane.renderer.setScene(pane.scene, result.assets);
      pane.status = 'ready';pane.message.hidden = true;
    }else{
      result.assets?.planImage?.close?.();pane.status = 'unavailable';
      pane.error ||= result.error || 'Canvas rendering is unavailable';
      pane.message.textContent = pane.scene.name+' reference map unavailable. Reporting remains available.';
      pane.canvas.hidden = true;pane.centre.hidden = true;pane.scale.hidden = true;
    }
    pane.pane.dataset.state = pane.status;updateReadiness();refresh();
  }}).then(() => getDiagnostics());
  function getDiagnostics(){
    const regions = [...panes.values()].map(pane => ({
      id:pane.id, status:pane.status, error:pane.error,
      receivedCount:eligibleVessels(vessels, pane.scene).length, visibleCount:pane.visibleVesselCount,
      visibleVesselCount:pane.visibleVesselCount, visibleLayerCount:pane.visibleLayerCount,
      renderPixels:pane.renderer?.pixelCount || 0,
    }));
    return {mode:'both-plan', status:overviewReadiness(regions), regions, vesselLayerEnabled:showVessels, continuousAnimation:false};
  }
  return {
    ready, refresh,
    setVessels(list, show, status=null){vessels = Array.isArray(list) ? list : [];showVessels = Boolean(show);availability = status;refresh();},
    setInfrastructure(list){infrastructure = Array.isArray(list) ? list : [];refresh();},
    setEvents(list){events = Array.isArray(list) ? list : [];refresh();},
    getDiagnostics,
    destroy(){
      if(destroyed) return;destroyed = true;abort.abort();clearTimeout(expiry);observer.disconnect();
      listeners.forEach(remove => remove());
      for(const pane of panes.values()){pane.renderer?.destroy();pane.assets?.planImage?.close?.();pane.markerNodes.clear();}
      root.replaceChildren();
    },
  };
}
