import {SCENES,sceneFor,defaultPose,clamp,eligibleVessels,isCoordinate} from './geometry.mjs';
import {createWebGLRenderer,createPlanRenderer,loadSceneAssets} from './renderer.mjs';

/** Regional geographic reference. No location is inferred from a headline. */
export async function createRegionalTerrain(root,callbacks={}){
 if(!root)return null;
 let canvas=root.querySelector('canvas');const surface=root.querySelector('.globe-surface')||root;
 const status=root.querySelector('#globe-mode'),motion=root.querySelector('#globe-motion'),wider=root.querySelector('#terrain-wider');
 const zoomIn=root.querySelector('#zoom-in'),zoomOut=root.querySelector('#zoom-out'),loading=root.querySelector('.globe-loading');
 const heading=document.querySelector('#map-heading');const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let renderer,scene=SCENES.hormuz,scope='both',pose=defaultPose(),assets=null,frame=0,transition=null,drag=null,sequence=0,destroyed=false,inView=true,expiry=0;
 let vessels=[],events=[],infrastructure=[],showVessels=false,layerNodes=[],labels=[];
 const boundCanvases=new WeakSet();
 const cache=new Map(),abort=new AbortController(),listeners=[];
 const stats={mode:'loading',frames:0,drawMilliseconds:[],sceneLoads:[],deviceValidation:'No device or GPU performance certification. drawMilliseconds measures CPU submission and labels, not completed GPU time.'};
 const listen=(node,type,fn,options)=>{if(!node)return;node.addEventListener(type,fn,options);listeners.push(()=>node.removeEventListener(type,fn,options));};
 const element=(tag,className,text)=>{const node=document.createElement(tag);node.className=className;if(text)node.textContent=text;return node;};
 root.classList.add('regional-terrain');surface.classList.add('regional-terrain-surface');
 root.querySelectorAll('[data-globe-theatre]').forEach(node=>{node.hidden=true;});
 const mapLabels=element('div','terrain-labels');mapLabels.setAttribute('aria-hidden','true');
 const dynamicLayer=element('div','terrain-object-layer');dynamicLayer.setAttribute('aria-label','Received positions and infrastructure references');
 const focus=element('div','terrain-geographic-focus');focus.innerHTML='<span class="terrain-focus-kicker">GEOGRAPHIC FOCUS</span><strong></strong><span class="terrain-focus-coordinate"></span>';
 const foot=element('div','terrain-map-footer');
 const scale=element('div','terrain-scale');scale.innerHTML='<i></i><span>50 km at scene centre</span>';
 const note=element('span','terrain-reference-note','Static elevation · relief ×4');
 foot.append(scale,note);surface.append(mapLabels,dynamicLayer,focus,foot);
 const north=surface.querySelector('.terrain-north');
 const caption=surface.querySelector('.globe-caption');if(caption)caption.textContent='Drag to tilt · Shift-drag to pan · R to reset';
 canvas.tabIndex=0;canvas.setAttribute('aria-describedby','terrain-keyboard-help');
 const help=element('span','terrain-sr-only','Use left and right arrow keys to turn, up and down to tilt. Plus and minus zoom. Shift with arrow keys pans. T toggles top-down. R resets the camera. Terrain is static reference geography, not current conditions.');help.id='terrain-keyboard-help';root.append(help);
 const attribution=document.querySelector('#terrain-attribution');if(attribution){attribution.textContent='Mapzen Terrain Tiles · SRTM/GMTED2010: U.S. Geological Survey · ETOPO1: NOAA. Downloaded 17 October 2026; source tile modifications are from 2017, not survey dates. 4× vertical exaggeration. 1024-pixel source texture, about 0.55–0.60 km source spacing; 256-pixel display mesh, about 2.2–2.4 km. Designed elevation colors, not satellite imagery. Mixed-age source artifacts may remain. Water is flat; no bathymetry or navigable clearance. ';const link=element('a','','Sources & processing details ↗');link.href=new URL('./assets/provenance.json',import.meta.url).href;link.target='_blank';link.rel='noopener noreferrer';attribution.append(link);}
 function controls(){
  const fallback=renderer?.mode==='plan';root.dataset.terrainMode=renderer?.mode||'loading';root.dataset.terrainScene=scene.id;
  if(motion){motion.textContent=fallback?'Plan fallback':pose.topDown?'3D terrain':'Top-down';motion.setAttribute('aria-pressed',String(pose.topDown||fallback));motion.disabled=fallback;motion.title=fallback?'2D geographic reference is shown because GPU terrain is unavailable.':'Switch between a tilted regional scene and a plan view';}
  if(wider){wider.textContent=pose.zoom<.92?'Focused':'Wider';wider.setAttribute('aria-pressed',String(pose.zoom<.92));}
  if(zoomIn)zoomIn.disabled=pose.zoom>=2.4;if(zoomOut)zoomOut.disabled=pose.zoom<=.76;
  root.querySelectorAll('[data-terrain-region]').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.terrainRegion===scene.id)));
  if(status)status.textContent=`${scene.shortName} · ${fallback?'2D reference fallback':pose.topDown?'plan view':'3D reference'}`;
  if(heading)heading.textContent=scene.name;
  if(north)north.style.transform=`rotate(${fallback?0:-pose.yaw*180/Math.PI}deg)`;
  if(caption)caption.textContent=fallback||pose.topDown?'Drag to pan · + / − zoom · R to reset':'Drag to tilt · Shift-drag to pan · R to reset';
  canvas.setAttribute('aria-label',`${scene.name}. ${fallback?'2D fallback map. Arrow keys and dragging pan; plus and minus zoom; R resets.':pose.topDown?'Top-down terrain. Arrow keys and dragging pan; plus and minus zoom; T returns to 3D; R resets.':'GPU-shaded reference terrain. Arrow keys adjust the camera; plus and minus zoom; T switches to top-down; R resets.'} Relief exaggerated four times. No incident coordinates inferred.`);
  help.textContent=fallback?'Use arrow keys or drag to pan the 2D reference map. Plus and minus zoom. R resets. The 3D toggle is unavailable because WebGL is unavailable. Terrain is static reference geography, not current conditions.':pose.topDown?'Use arrow keys or drag to pan the top-down terrain. Plus and minus zoom. T returns to 3D. R resets. Terrain is static reference geography, not current conditions.':'Use left and right arrow keys to turn, up and down to tilt. Plus and minus zoom. Shift with arrow keys pans. T toggles top-down. R resets the camera. Terrain is static reference geography, not current conditions.';
 }
 function layoutLabels(){
  mapLabels.hidden=false;mapLabels.replaceChildren();labels=scene.labels.map(label=>{const node=element('span',`terrain-place terrain-place--${label.kind}`,label.name);mapLabels.append(node);return{...label,node};});
  focus.querySelector('strong').textContent=scene.name;focus.querySelector('.terrain-focus-coordinate').textContent=scene.coordinates;
 }
 function layerData(){
  const list=[];
  for(const v of showVessels?eligibleVessels(vessels,scene):[]){const age=Date.now()-Date.parse(v.positionTime);list.push({...v,point:[v.longitude,v.latitude],kind:'vessel',id:v.mmsi||v.id,label:v.name||'Vessel name not reported',basis:'Received AIS position',older:age>=600000});}
  for(const item of infrastructure.filter(p=>isCoordinate(p)&&(!p.theaters||p.theaters.includes(scene.id))))list.push({...item,point:[item.longitude,item.latitude],kind:'infrastructure',label:item.name,basis:item.basis||'Approximate infrastructure reference'});
  for(const item of events.filter(isCoordinate))list.push({...item,point:[item.longitude,item.latitude],kind:'event',label:item.title||'Structured source record',basis:'Source-provided event coordinate'});
  return list.slice(0,250);
 }
 function rebuildLayers(){
  if(destroyed)return;
  dynamicLayer.replaceChildren();layerNodes=layerData().map(item=>{
   const button=element('button',`terrain-object terrain-object--${item.kind}${item.older?' terrain-object--older':''}`);button.type='button';button.setAttribute('aria-label',`${item.label}. ${item.basis}${item.positionTime?`. Position time ${item.positionTime}`:''}`);button.title=`${item.label} · ${item.basis}`;
   const symbol=element('span','',item.kind==='vessel'?(Number.isFinite(item.courseDegrees)||Number.isFinite(item.headingDegrees)?'▲':'●'):item.kind==='infrastructure'?'□':'○');symbol.setAttribute('aria-hidden','true');button.append(symbol);
   button.addEventListener('click',()=>{callbacks[item.kind==='vessel'?'onVessel':item.kind==='event'?'onEvent':'onInfrastructure']?.(item.id);});
   button.addEventListener('pointerenter',()=>{const p=renderer?.point(item.point);if(p)callbacks.onHover?.({...item,x:p.x,y:p.y});});button.addEventListener('pointerleave',()=>callbacks.onHover?.(null));
   dynamicLayer.append(button);return{...item,node:button};
  });
  clearTimeout(expiry);if(showVessels&&vessels.length){const next=vessels.flatMap(v=>[600000,1800000].map(age=>Date.parse(v.positionTime)+age-Date.now())).filter(n=>n>0);if(next.length)expiry=setTimeout(()=>{rebuildLayers();requestDraw();},Math.min(...next)+50);}
 }
 function draw(){
  if(!renderer||!assets||destroyed)return;
  const t=performance.now();renderer.draw(pose);
  const w=surface.clientWidth,h=surface.clientHeight;
  const focusPoint=renderer.point(scene.center,.3);
  const occupied=focusPoint.visible?[{x:focusPoint.x-104,y:focusPoint.y+6,w:208,h:73}]:[];
  for(const item of labels){const p=renderer.point(item.point,.9),width=item.name.length*(item.kind==='country'?8.5:6.7),box={x:p.x-width/2,y:p.y-8,w:width,h:18};const collides=occupied.some(b=>box.x<b.x+b.w&&box.x+box.w>b.x&&box.y<b.y+b.h&&box.y+box.h>b.y);item.node.hidden=!p.visible||collides||p.y<47||p.y>h-62||p.x<32||p.x>w-32;if(!item.node.hidden){item.node.style.transform=`translate(${p.x}px,${p.y}px) translate(-50%,-50%)`;occupied.push(box);}}
  const p=renderer.point(scene.center,.3);focus.hidden=!p.visible;focus.style.transform=`translate(${p.x}px,${p.y+16}px) translate(-50%,0)`;
  for(const item of layerNodes){const p=renderer.point(item.point,.55);item.node.hidden=!p.visible;item.node.style.transform=`translate(${p.x}px,${p.y}px) translate(-50%,-50%)`;if(item.kind==='vessel'&&(Number.isFinite(item.courseDegrees)||Number.isFinite(item.headingDegrees))){const bearing=(item.courseDegrees??item.headingDegrees)*Math.PI/180;const next=renderer.point([item.longitude+Math.sin(bearing)*.02/Math.cos(item.latitude*Math.PI/180),item.latitude+Math.cos(bearing)*.02],.55);item.node.firstElementChild.style.transform=`rotate(${Math.atan2(next.y-p.y,next.x-p.x)*180/Math.PI+90}deg)`;}}
  let km=50;let a=renderer.localPoint([-km/2,0,0]),b=renderer.localPoint([km/2,0,0]);if(Math.hypot(a.x-b.x,a.y-b.y)>Math.min(180,w*.4)){km=20;a=renderer.localPoint([-10,0,0]);b=renderer.localPoint([10,0,0]);}scale.querySelector('i').style.width=`${Math.hypot(a.x-b.x,a.y-b.y)}px`;scale.querySelector('span').textContent=`${km} km at scene centre`;
  controls();stats.frames++;stats.mode=renderer.mode;stats.triangles=renderer.triangleCount;stats.renderPixels=renderer.pixelCount;stats.drawMilliseconds.push(Math.round((performance.now()-t)*100)/100);if(stats.drawMilliseconds.length>120)stats.drawMilliseconds.shift();
 }
 function requestDraw(){if(frame||destroyed||document.hidden||!inView)return;frame=requestAnimationFrame(tick);}
 function tick(now){frame=0;if(transition){const t=clamp((now-transition.start)/320,0,1),ease=t*t*(3-2*t);for(const key of ['zoom','tilt','yaw','panX','panZ'])pose[key]=transition.from[key]+(transition.to[key]-transition.from[key])*ease;pose.topDown=transition.to.topDown;if(t===1){pose={...transition.to};transition=null;}}draw();if(transition)requestDraw();}
 function move(next,animate=true){transition=null;if(animate&&!reduced.matches&&renderer?.mode!=='plan'&&!document.hidden){transition={from:{...pose},to:{...pose,...next},start:performance.now()};}else pose={...pose,...next};requestDraw();}
 function reset(){move({...defaultPose(),topDown:renderer?.mode==='plan'});}
 function zoom(amount){move({zoom:clamp(pose.zoom*amount,.76,2.4)},false);}
 function togglePlan(){if(renderer?.mode==='plan')return;move({topDown:!pose.topDown},false);}
 function resize(){const {width,height}=surface.getBoundingClientRect();if(width&&height&&renderer){renderer.resize(width,height);requestDraw();}}
 function bindCanvas(){
  if(boundCanvases.has(canvas))return;boundCanvases.add(canvas);
  listen(canvas,'pointerdown',e=>{if(e.button!==0)return;transition=null;drag={x:e.clientX,y:e.clientY,pose:{...pose},pan:e.shiftKey||pose.topDown||renderer?.mode==='plan'};canvas.setPointerCapture(e.pointerId);canvas.classList.add('is-dragging');callbacks.onHover?.(null);});
  listen(canvas,'pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(drag.pan){const scale=(renderer?.span||300)/Math.max(1,surface.clientWidth);pose.panX=clamp(drag.pose.panX-dx*scale,-70,70);pose.panZ=clamp(drag.pose.panZ-dy*scale,-70,70);}else{pose.yaw=clamp(drag.pose.yaw-dx*.003,-.6,.6);pose.tilt=clamp(drag.pose.tilt+dy*.002,.35,.95);}requestDraw();});
  const finish=e=>{drag=null;canvas.classList.remove('is-dragging');if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);};
  listen(canvas,'pointerup',finish);listen(canvas,'pointercancel',finish);listen(canvas,'lostpointercapture',()=>{drag=null;canvas.classList.remove('is-dragging');});
  listen(canvas,'keydown',e=>{
   const k=e.key.toLowerCase();if(['arrowleft','arrowright','arrowup','arrowdown'].includes(k)){e.preventDefault();transition=null;const pan=e.shiftKey||pose.topDown||renderer?.mode==='plan';if(pan){pose.panX=clamp(pose.panX+(k==='arrowleft'?-10:k==='arrowright'?10:0),-70,70);pose.panZ=clamp(pose.panZ+(k==='arrowup'?-10:k==='arrowdown'?10:0),-70,70);}else{pose.yaw=clamp(pose.yaw+(k==='arrowleft'?-.08:k==='arrowright'?.08:0),-.6,.6);pose.tilt=clamp(pose.tilt+(k==='arrowup'?-.07:k==='arrowdown'?.07:0),.35,.95);}requestDraw();}
   else if(['+','=','-','t','r','home'].includes(k)){e.preventDefault();if(k==='t')togglePlan();else if(k==='r'||k==='home')reset();else zoom(k==='-'?1/1.15:1.15);}
  });
  listen(canvas,'webglcontextlost',e=>{e.preventDefault();useFallback('GPU context was lost; plan reference remains available.');});
 }
 function useFallback(reason){
  if(renderer?.mode==='plan')return;renderer?.destroy();const replacement=canvas.cloneNode(false);canvas.replaceWith(replacement);canvas=replacement;renderer=createPlanRenderer(canvas);pose.topDown=true;transition=null;if(assets)renderer.setScene(scene,assets);bindCanvas();resize();stats.fallbackReason=reason;controls();
 }
 async function select(theatre){
  if(destroyed||!['both','hormuz','bab'].includes(theatre))return;
  const next=sceneFor(theatre);scope=theatre;
  if(scene.id===next.id&&assets){controls();requestDraw();return;}
  const token=++sequence,start=performance.now();scene=next;assets=null;transition=null;pose=defaultPose();layoutLabels();rebuildLayers();controls();
  loading.hidden=false;loading.textContent=`Preparing ${scene.shortName} reference terrain…`;root.dataset.terrainLoading='true';
  try{
   if(!cache.has(scene.id))cache.set(scene.id,loadSceneAssets(scene,{signal:abort.signal,planOnly:renderer.mode==='plan'}).catch(error=>{cache.delete(next.id);throw error;}));
   const data=await cache.get(scene.id);if(token!==sequence||destroyed)return;assets=data;renderer.setScene(scene,assets);if(renderer.mode==='plan')pose.topDown=true;loading.hidden=true;delete root.dataset.terrainLoading;resize();callbacks.onRegionChange?.(scene.id);stats.sceneLoads.push({scene:scene.id,milliseconds:Math.round(performance.now()-start)});
  }catch(error){
   if(token!==sequence||destroyed)return;
   try{
    const img=new Image();img.src=new URL(`./assets/${scene.id}-plan.webp`,import.meta.url).href;await img.decode();if(token!==sequence||destroyed)return;assets={planImage:img};useFallback('Detailed terrain could not load; bundled plan reference shown.');renderer.setScene(scene,assets);loading.hidden=true;delete root.dataset.terrainLoading;resize();
   }catch{loading.hidden=false;loading.textContent=`${scene.shortName} terrain could not load. Reporting and evidence remain available.`;stats.error=String(error.message);root.dataset.terrainMode='unavailable';focus.hidden=true;mapLabels.hidden=true;}
  }
 }
 try{renderer=createWebGLRenderer(canvas);}catch(error){useFallback(error.message);}
 bindCanvas();layoutLabels();
 listen(motion,'click',togglePlan);listen(wider,'click',()=>move({zoom:pose.zoom<.92?1:.76,panX:0,panZ:0}));listen(zoomIn,'click',()=>zoom(1.15));listen(zoomOut,'click',()=>zoom(1/1.15));
 root.querySelectorAll('[data-terrain-region]').forEach(node=>listen(node,'click',()=>select(node.dataset.terrainRegion)));
 listen(document,'visibilitychange',()=>{if(document.hidden){if(frame)cancelAnimationFrame(frame);frame=0;if(transition){pose=transition.to;transition=null;}}else requestDraw();});
 listen(reduced,'change',()=>{if(reduced.matches&&transition){pose=transition.to;transition=null;}requestDraw();});
 const observer=new ResizeObserver(resize);observer.observe(surface);
 const visibility=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;if(inView)requestDraw();else if(frame){cancelAnimationFrame(frame);frame=0;}},{threshold:.01}):null;visibility?.observe(surface);
 await select('both');
 return {select,reset,topDown:togglePlan,wider:()=>move({zoom:.76,panX:0,panZ:0}),pause(){if(transition){pose=transition.to;transition=null;}requestDraw();},setVessels(list,show){vessels=Array.isArray(list)?list:[];showVessels=Boolean(show);rebuildLayers();requestDraw();},setEvents(list){events=Array.isArray(list)?list:[];rebuildLayers();requestDraw();},setInfrastructure(list){infrastructure=Array.isArray(list)?list:[];rebuildLayers();requestDraw();},getDiagnostics(){return {...stats,scene:scene.id,scope,pose:{...pose},continuousAnimation:false,reducedMotion:reduced.matches,visibleVesselCount:layerNodes.filter(n=>n.kind==='vessel').length};},destroy(){destroyed=true;abort.abort();clearTimeout(expiry);if(frame)cancelAnimationFrame(frame);listeners.forEach(remove=>remove());observer.disconnect();visibility?.disconnect();renderer?.destroy();for(const promise of cache.values())promise.then(data=>['heightImage','normalImage','planImage'].forEach(key=>data[key]?.close?.())).catch(()=>{});cache.clear();mapLabels.remove();dynamicLayer.remove();focus.remove();foot.remove();help.remove();}};
}
export const createGlobe=createRegionalTerrain;
