import {tankerPresentation, tankerSvg} from './tanker-model.mjs';

const modelImages = new Map();
function modelImage(presentation){
  const key = `${presentation.marker}:${presentation.stale}`;
  if(!modelImages.has(key)){
    // One reusable browser-decoded SVG image per appearance, not hundreds of
    // copies of the detailed geometry in the interactive DOM.
    const source = encodeURIComponent(tankerSvg(presentation, {size:32}));
    modelImages.set(key, `<img alt="" draggable="false" width="32" height="32" src="data:image/svg+xml,${source}">`);
  }
  return modelImages.get(key);
}

export function vesselDirection(vessel){
  for(const [field, basis] of [['headingDegrees', 'heading'], ['courseDegrees', 'course']]){
    const value = vessel?.[field];
    if(Number.isFinite(value) && value >= 0 && value < 360) return {degrees:value, basis};
  }
  return {degrees:null, basis:'unavailable'};
}

// Model presentation is an explicit renderer dependency for local review.
// The application does not enable it: data permissions/provenance remain a gate.
export function vesselSymbol(vessel, {tankerModels=false, now=Date.now()}={}){
  const direction = vesselDirection(vessel);
  const presentation = tankerModels ? tankerPresentation(vessel, now) : null;
  const svg = presentation?.visible ? modelImage(presentation) : '';
  return {
    svg,
    glyph:direction.degrees === null ? '●' : '▲',
    bearing:direction.degrees,
    basis:direction.basis,
    model:Boolean(svg),
    description:svg
      ? `Generic tanker model at reported coordinates; illustrative scale, not the vessel's measured shape. ${presentation.orientationLabel}. ${presentation.timestampLabel}. ${presentation.stale ? 'Older than ten minutes. ' : ''}No predicted motion.`
      : direction.basis === 'heading' ? 'Reported heading'
        : direction.basis === 'course' ? 'Course over ground; heading unavailable'
          : 'Direction unavailable',
  };
}

const renderedSvg = new WeakMap();
export function paintVesselSymbol(node, vessel, options){
  const symbol = vesselSymbol(vessel, options);
  if(symbol.svg){
    if(renderedSvg.get(node) !== symbol.svg){
      node.innerHTML = symbol.svg;
      // Only generated static markup is assigned; vessel text is never HTML.
      renderedSvg.set(node, symbol.svg);
    }
  }else{
    if(node.textContent !== symbol.glyph) node.textContent = symbol.glyph;renderedSvg.delete(node);
  }
  node.classList.toggle('terrain-tanker-symbol', symbol.model);
  node.dataset.orientationBasis = symbol.basis;
  return symbol;
}

export function projectedVesselAngle(vessel, degrees, project){
  if(!Number.isFinite(degrees)) return null;
  const radians = degrees*Math.PI/180, latitude = vessel.latitude;
  const start = project([vessel.longitude, latitude]);
  const end = project([vessel.longitude+Math.sin(radians)*.02/Math.cos(latitude*Math.PI/180), latitude+Math.cos(radians)*.02]);
  if(![start?.x, start?.y, end?.x, end?.y].every(Number.isFinite)) return null;
  return Math.atan2(end.y-start.y, end.x-start.x)*180/Math.PI+90;
}
