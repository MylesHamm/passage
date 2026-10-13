import {vesselTypeLabel} from '../vessel-data.mjs';
import { THEATRES, ROUTES, LANDMARKS, visiblePoint } from './geometry.mjs';

// Keep near-boundary samples in the exact check despite floating-point noise.
const BOUNDS_MARGIN = 1e-4;

function usableBounds(bounds) {
  return Array.isArray(bounds) && bounds.length === 2
    && bounds.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))
    && bounds.every(([longitude, latitude]) => Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90)
    && bounds[0][1] <= bounds[1][1];
}

function withinLandBounds(bounds, [longitude, latitude]) {
  if (!bounds) return true;
  const [[west, south], [east, north]] = bounds;
  if (latitude < south - BOUNDS_MARGIN || latitude > north + BOUNDS_MARGIN) return false;
  if (west > east) return longitude >= west - BOUNDS_MARGIN || longitude <= east + BOUNDS_MARGIN;
  return longitude >= west - BOUNDS_MARGIN && longitude <= east + BOUNDS_MARGIN
    || longitude >= 180 - BOUNDS_MARGIN && west <= -180 + BOUNDS_MARGIN
    || longitude <= -180 + BOUNDS_MARGIN && east >= 180 - BOUNDS_MARGIN;
}

export function createLandTester(landFeatures, d3) {
  const entries = landFeatures.map(feature => {
    const type = feature.type === 'Feature' ? feature.geometry?.type : feature.type;
    let bounds = null;
    // Spherical bounds include curved edges, poles and antimeridian crossings.
    // They only reject distant samples; geoContains still decides land contact.
    // Unknown geometry or unusable bounds retain the original exact check.
    if (['Polygon', 'MultiPolygon'].includes(type) && typeof d3.geoBounds === 'function') {
      try { const candidate = d3.geoBounds(feature); if (usableBounds(candidate)) bounds = candidate; } catch {}
    }
    return {feature, bounds};
  });
  return point => entries.some(({feature, bounds}) => withinLandBounds(bounds, point) && d3.geoContains(feature, point));
}

export function waterSafeSegments(route, landFeatures, d3, containsLand = createLandTester(landFeatures, d3)) {
  const segments = [];
  for (let i = 0; i < route.length - 1; i++) {
    const start = route[i], end = route[i + 1], interpolate = d3.geoInterpolate(start, end);
    // geoPath resamples geographic lines along the sphere. Check the same
    // interior of each leg against Natural Earth land before drawing it.
    // Endpoints may sit on a port or coastline, so only interior samples are
    // tested; a leg that touches land is omitted rather than drawn through it.
    let clear = true;
    // Use enough samples to catch narrow coastal projections and island
    // crossings before geoPath adds its own adaptive resampling.
    for (let sample = 1; sample < 129; sample++) {
      if (containsLand(interpolate(sample / 128))) {
        clear = false;
        break;
      }
    }
    if (clear) segments.push({ type: 'LineString', coordinates: [start, end] });
  }
  return segments;
}

export function createRenderer(canvas, world) {
  const d3 = window.d3, ctx = canvas.getContext('2d');
  if (!d3 || !ctx) throw new Error('Globe drawing unavailable');
  const projection = d3.geoOrthographic().clipAngle(90).precision(0.7);
  const path = d3.geoPath(projection, ctx), grid = d3.geoGraticule().step([15,15])();
  const landFeatures = world.type === 'FeatureCollection' ? world.features : [world];
  const containsLand = createLandTester(landFeatures, d3);
  const lines = ROUTES.map(route => waterSafeSegments(route.coordinates, landFeatures, d3, containsLand));
  let width=1,height=1,hitPoints=[];
  const colors={ocean:'#071A2C',land:'#344652',coast:'#8396A3',grid:'#243743',mint:'#D9FDD9',sky:'#44ACE9',text:'#C9D3E0'};
  function resize(w,h) {
    width=w;height=h;const ratio=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);
    ctx.setTransform(ratio,0,0,ratio,0,0);
  }
  function stroke(geometry,color,lineWidth=1) {
    ctx.beginPath();path(geometry);ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.stroke();
  }
  function draw(pose,phase,vessels,showVessels,theatre,events=[],infrastructure=[]) {
    const radius=Math.min(width*.42,height*.43)*pose.zoom,cx=width/2,cy=height/2;
    projection.rotate(pose.rotation).translate([cx,cy]).scale(radius);
    ctx.clearRect(0,0,width,height);ctx.save();
    // The rim remains restrained so coastlines and selected points carry emphasis.
    ctx.beginPath();ctx.arc(cx,cy,radius+3,0,Math.PI*2);ctx.strokeStyle='#8BA6B633';ctx.lineWidth=1;ctx.stroke();
    ctx.beginPath();path({type:'Sphere'});ctx.fillStyle=colors.ocean;ctx.fill();ctx.clip();
    const shade=ctx.createRadialGradient(cx-radius*.3,cy-radius*.5,0,cx,cy,radius*1.2);
    shade.addColorStop(0,'#102939');shade.addColorStop(1,colors.ocean);ctx.fillStyle=shade;ctx.fillRect(0,0,width,height);
    stroke(grid,colors.grid,.6);
    ctx.beginPath();path(world);ctx.fillStyle=colors.land;ctx.fill();ctx.strokeStyle=colors.coast;ctx.lineWidth=.7;ctx.stroke();
    hitPoints=[];
    lines.forEach((segments,i)=>{
      ctx.setLineDash(i===2?[3,7]:[]);segments.forEach(segment=>stroke(segment,i===2?'#C9D3E080':'#44ACE970',1));
      // A reference corridor has no observed direction or speed. Keep it static
      // so motion cannot be mistaken for reported vessel movements.
      // Hit targets follow only visible, rendered water segments. Sampling
      // the projected leg makes the entire corridor explainable on hover.
      segments.forEach(segment=>{
        const interpolate=d3.geoInterpolate(...segment.coordinates);
        for(let step=0;step<=48;step++){
          const point=interpolate(step/48);if(!visiblePoint(point,pose.rotation))continue;
          const [x,y]=projection(point);
          if(x>=0&&x<=width&&y>=0&&y<=height)hitPoints.push({x,y,id:ROUTES[i].name,kind:'route',label:ROUTES[i].name,basis:'Illustrative reference corridor'});
        }
      });
    });ctx.setLineDash([]);ctx.lineDashOffset=0;
    if(pose.zoom>1.8){
      ctx.font='11px "IBM Plex Sans",sans-serif';ctx.textBaseline='middle';
      LANDMARKS.forEach(([name,lon,lat])=>{
        if(!visiblePoint([lon,lat],pose.rotation))return;
        const [x,y]=projection([lon,lat]);ctx.fillStyle=colors.sky;ctx.fillRect(x-2,y-2,4,4);
        const dy=['Fujairah','Djibouti'].includes(name)?15:-12;
        ctx.lineWidth=3;ctx.strokeStyle=colors.ocean;ctx.strokeText(name,x+6,y+dy);ctx.fillStyle=colors.text;ctx.fillText(name,x+6,y+dy);
      });
    }
    if(showVessels)vessels.forEach(v=>{
      const point=[v.longitude,v.latitude];if(!visiblePoint(point,pose.rotation))return;
      const [x,y]=projection(point);if(x<0||x>width||y<0||y>height)return;
      const age=Date.now()-Date.parse(v.positionTime),stale=age>=600000;
      // Project a short course segment so the symbol follows the local globe orientation.
      const bearing=(v.courseDegrees??v.headingDegrees??0)*Math.PI/180;
      const next=projection([v.longitude+Math.sin(bearing)*.02/Math.max(.1,Math.cos(v.latitude*Math.PI/180)),v.latitude+Math.cos(bearing)*.02]);
      ctx.save();ctx.translate(x,y);ctx.rotate(Math.atan2(next[1]-y,next[0]-x)+Math.PI/2);
      ctx.beginPath();if(Number.isFinite(v.courseDegrees)||Number.isFinite(v.headingDegrees)){ctx.moveTo(0,-5);ctx.lineTo(4,4);ctx.lineTo(0,2);ctx.lineTo(-4,4);ctx.closePath();}else{ctx.arc(0,0,3.5,0,Math.PI*2);}
      ctx.strokeStyle=stale?colors.text:colors.mint;ctx.fillStyle=stale?colors.ocean:colors.mint;ctx.lineWidth=1;ctx.fill();ctx.stroke();ctx.restore();
      const typeLabel=vesselTypeLabel(v.shipType);
      hitPoints.push({x,y,id:v.mmsi,kind:'vessel',label:v.name||'Name not reported',vesselType:typeLabel,provider:v.provider,positionTime:v.positionTime,basis:'Received AIS position'});
    });
    infrastructure.filter(p=>theatre==='both'||p.theaters.includes(theatre)).forEach(point=>{
      if(!visiblePoint([point.longitude,point.latitude],pose.rotation))return;
      const [x,y]=projection([point.longitude,point.latitude]);if(x<8||x>width-8||y<8||y>height-8)return;
      ctx.fillStyle=colors.ocean;ctx.strokeStyle=colors.mint;ctx.lineWidth=1.4;
      ctx.fillRect(x-4,y-4,8,8);ctx.strokeRect(x-4,y-4,8,8);
      if(pose.zoom>1.7){ctx.font='11px "IBM Plex Sans",sans-serif';ctx.lineWidth=3;ctx.strokeStyle=colors.ocean;ctx.strokeText(point.name,x+9,y-9);ctx.fillStyle=colors.mint;ctx.fillText(point.name,x+9,y-9);}
      hitPoints.push({x,y,id:point.id,actorId:point.actorId,kind:'infrastructure',label:point.name,basis:point.basis});
    });
    events.forEach(event=>{
      if(!Number.isFinite(event.latitude)||!Number.isFinite(event.longitude)||!visiblePoint([event.longitude,event.latitude],pose.rotation))return;
      const [x,y]=projection([event.longitude,event.latitude]);if(x<0||x>width||y<0||y>height)return;
      const civilian=event.actors?.includes('Civilians')||event.civilianTargeting;
      ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle=civilian?'#D9FDD9':'#44ACE9';ctx.globalAlpha=.86;ctx.fill();ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.strokeStyle=civilian?'#D9FDD9':'#44ACE9';ctx.globalAlpha=.34;ctx.stroke();ctx.globalAlpha=1;
      hitPoints.push({x,y,id:event.id,kind:'event',label:event.title,basis:'Structured ACLED event'});
    });
    ctx.restore();
    return Object.entries(THEATRES).filter(([,t])=>t.point).map(([id,t])=>{
      const [x,y]=projection(t.point);return {id,x,y,visible:visiblePoint(t.point,pose.rotation)&&x>25&&x<width-25&&y>28&&y<height-35,selected:theatre===id};
    });
  }
  function hit(x,y){const close=hitPoints.map(p=>({...p,distance:Math.hypot(x-p.x,y-p.y)})).filter(p=>p.distance<(p.kind==='route'?9:16));return close.sort((a,b)=>(a.kind==='route')-(b.kind==='route')||a.distance-b.distance)[0]||null;}
  return {resize,draw,hit};
}
