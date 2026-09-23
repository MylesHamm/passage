import { THEATRES, poseBetween, eligibleVessels } from './geometry.mjs';
import { createRenderer } from './renderer.mjs';

export async function createGlobe(root, { onSelect, onVessel, onEvent, onInfrastructure, onHover }) {
  const canvas=root.querySelector('canvas'), status=root.querySelector('#globe-mode');
  const motion=root.querySelector('#globe-motion'), zoomIn=root.querySelector('#zoom-in'), zoomOut=root.querySelector('#zoom-out');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let renderer,pose={rotation:[...THEATRES.both.rotation],zoom:1},theatre='both',paused=false;
  let hovering=false,focused=false,drag=null,moved=false,transition=null,frame=0,last=0,phase=0,inView=true;
  let vessels=[],events=[],infrastructure=[],showVessels=true,failed=false;
  let lastHoverKey=null;
  const markers=[...root.querySelectorAll('[data-globe-theatre]')];
  function wantsMotion(){return !reduced.matches&&!paused;}
  function active(){return !failed&&!document.hidden&&inView&&(transition||(theatre==='both'&&wantsMotion()&&!hovering&&!focused&&!drag));}
  function controls(){
    motion.textContent=reduced.matches?'Motion off':theatre!=='both'?'Focused view':paused?'Resume rotation':'Pause rotation';
    motion.setAttribute('aria-pressed',String(paused||reduced.matches));
    motion.disabled=reduced.matches||failed||theatre!=='both';
    motion.title=reduced.matches?'Motion is off to match your reduced-motion preference.':theatre!=='both'?'Focused theaters stay still. Return to Overview for optional rotation.':'Pause or resume overview rotation. Rotation stops while you explore the globe.';
    status.textContent=failed?'Globe unavailable':reduced.matches?'Reduced motion':paused?'Motion paused':theatre!=='both'?'Theatre focused':hovering||focused||drag?'Exploring':'Overview · rotating';
    zoomOut.disabled=pose.zoom<=.8||failed;zoomIn.disabled=pose.zoom>=5||failed;
  }
  function draw(){
    if(!renderer)return;
    const dots=renderer.draw(pose,phase,eligibleVessels(vessels,theatre),showVessels,theatre,events,infrastructure);
    dots.forEach(dot=>{const b=markers.find(el=>el.dataset.globeTheatre===dot.id);
      b.hidden=!dot.visible;b.style.left=dot.x+'px';b.style.top=dot.y+'px';
      b.setAttribute('aria-pressed',String(dot.selected));
    });controls();
  }
  function schedule(){if(!frame&&active())frame=requestAnimationFrame(tick);}
  function tick(now){
    frame=0;const elapsed=last?Math.min(50,now-last):0;last=now;
    if(transition){const t=(now-transition.start)/850;pose=poseBetween(transition.from,transition.to,t);if(t>=1)transition=null;}
    else if(theatre==='both'&&wantsMotion()&&!hovering&&!focused&&!drag){pose.rotation[0]=(pose.rotation[0]+elapsed*.0003+180)%360-180;}
    draw();schedule();
  }
  function restart(){last=0;if(frame){cancelAnimationFrame(frame);frame=0;}draw();schedule();}
  function select(id){
    if(!THEATRES[id])return;theatre=id;
    const target={rotation:[...THEATRES[id].rotation],zoom:THEATRES[id].zoom};
    if(reduced.matches||paused||document.hidden){pose=target;transition=null;}
    else transition={from:{rotation:[...pose.rotation],zoom:pose.zoom},to:target,start:performance.now()};
    canvas.setAttribute('aria-label',`${THEATRES[id].name} globe. Arrow keys rotate, plus and minus zoom. Theatre buttons select a region. Reference corridors use water-safe waypoints and are illustrative.`);
    restart();
  }
  function zoom(amount){transition=null;pose.zoom=Math.max(.8,Math.min(5,pose.zoom*amount));paused=true;restart();}
  motion.onclick=()=>{paused=!paused;if(paused&&transition){pose=transition.to;transition=null;}restart();};
  zoomIn.onclick=()=>zoom(1.2);zoomOut.onclick=()=>zoom(1/1.2);
  markers.forEach(b=>{b.onclick=()=>onSelect(b.dataset.globeTheatre);});
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;transition=null;moved=false;drag={x:e.clientX,y:e.clientY,rotation:[...pose.rotation]};
    canvas.setPointerCapture(e.pointerId);restart();
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drag){
      if(e.pointerType!=='touch'&&renderer){const r=canvas.getBoundingClientRect(),hit=renderer.hit(e.clientX-r.left,e.clientY-r.top),key=hit?`${hit.kind}:${hit.id}`:null;
        if(key!==lastHoverKey){lastHoverKey=key;onHover?.(hit?{...hit,x:e.clientX-r.left,y:e.clientY-r.top}:null);}
      }
      return;
    }
    onHover?.(null);lastHoverKey=null;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(Math.hypot(dx,dy)>5)moved=true;
    pose.rotation=[drag.rotation[0]+dx*.22/pose.zoom,Math.max(-80,Math.min(80,drag.rotation[1]-dy*.22/pose.zoom)),0];draw();
  });
  const finish=e=>{if(!drag)return;drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);restart();};
  canvas.addEventListener('pointerup',e=>{
    if(!drag)return;const r=canvas.getBoundingClientRect(),id=!moved&&renderer?.hit(e.clientX-r.left,e.clientY-r.top);
    finish(e);if(id?.kind==='infrastructure')onInfrastructure?.(id.id);else if(id?.kind==='event')onEvent?.(id.id);else if(id?.kind==='vessel')onVessel?.(id.id);
  });
  canvas.addEventListener('pointercancel',finish);canvas.addEventListener('lostpointercapture',()=>{drag=null;restart();});
  canvas.addEventListener('pointerleave',()=>{lastHoverKey=null;onHover?.(null);});
  canvas.addEventListener('keydown',e=>{
    const keys={ArrowLeft:[-5,0],ArrowRight:[5,0],ArrowUp:[0,5],ArrowDown:[0,-5]};
    if(keys[e.key]){e.preventDefault();paused=true;transition=null;pose.rotation[0]+=keys[e.key][0];pose.rotation[1]=Math.max(-80,Math.min(80,pose.rotation[1]+keys[e.key][1]));restart();}
    else if(['+','=','-'].includes(e.key)){e.preventDefault();zoom(e.key==='-'?1/1.2:1.2);}
  });
  const surface=root.querySelector('.globe-surface');
  surface.addEventListener('pointerenter',e=>{if(e.pointerType!=='touch'){hovering=true;restart();}});
  surface.addEventListener('pointerleave',()=>{hovering=false;restart();});
  surface.addEventListener('focusin',()=>{focused=true;restart();});
  surface.addEventListener('focusout',e=>{focused=surface.contains(e.relatedTarget);restart();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&transition){pose=transition.to;transition=null;}restart();});
  reduced.addEventListener('change',()=>{if(reduced.matches&&transition){pose=transition.to;transition=null;}restart();});
  new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;restart();},{threshold:.05}).observe(root);
  const resize=()=>{const r=surface.getBoundingClientRect();if(renderer&&r.width&&r.height){renderer.resize(r.width,r.height);draw();}};
  new ResizeObserver(resize).observe(surface);
  try{
    const response=await fetch(new URL('../assets/world-land.json',import.meta.url),{signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error();const world=await response.json();
    if(world.type!=='FeatureCollection'||!world.features?.length)throw new Error();
    renderer=createRenderer(canvas,world);root.querySelector('.globe-loading').hidden=true;resize();restart();
  }catch{
    failed=true;canvas.hidden=true;markers.forEach(b=>b.hidden=true);
    root.querySelector('.globe-loading').textContent='Globe unavailable. Use the theatre buttons; reporting, prices and received-vessel details remain available.';controls();
  }
  return {select,setInfrastructure(list){infrastructure=Array.isArray(list)?list:[];draw();},setVessels(list,visible){vessels=list;showVessels=visible;draw();},setEvents(list){events=Array.isArray(list)?list:[];draw();},pause(){paused=true;restart();}};
}
