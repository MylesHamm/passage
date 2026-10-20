const abortError=()=>new DOMException('Terrain loading cancelled','AbortError');

// One deadline covers fetching, body reads and decoding, including decoders
// that do not accept an AbortSignal. Late bitmap results are closed below.
export async function loadSceneAssets(scene,{signal,planOnly=false,timeoutMs=12000}={}){
 const controller=new AbortController(),images=new Set();
 const abort=()=>controller.abort(signal?.reason||abortError());
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(new DOMException('Terrain loading timed out','TimeoutError')),timeoutMs);
 let interrupted;
 const cancellation=new Promise((_,reject)=>{
  interrupted=()=>reject(controller.signal.reason||abortError());
  if(controller.signal.aborted)interrupted();else controller.signal.addEventListener('abort',interrupted,{once:true});
 });
 const base=new URL(`./assets/${scene.id}-`,import.meta.url).href;
 const keep=image=>{
  if(controller.signal.aborted){image.close?.();throw controller.signal.reason;}
  images.add(image);return image;
 };
 const imageElement=blob=>new Promise((resolve,reject)=>{
  const img=new Image(),url=URL.createObjectURL(blob);
  const finish=()=>{img.onload=null;img.onerror=null;controller.signal.removeEventListener('abort',cancel);URL.revokeObjectURL(url);};
  const cancel=()=>{finish();img.src='';reject(controller.signal.reason||abortError());};
  img.onload=()=>{finish();resolve(img);};
  img.onerror=()=>{finish();reject(new Error('Terrain image decode failed'));};
  controller.signal.addEventListener('abort',cancel,{once:true});
  if(controller.signal.aborted)cancel();else img.src=url;
 });
 const response=async suffix=>{
  controller.signal.throwIfAborted();
  const result=await fetch(base+suffix,{signal:controller.signal});
  controller.signal.throwIfAborted();
  if(!result.ok)throw new Error(`Terrain asset ${result.status}`);
  return result;
 };
 const image=async suffix=>{
  const blob=await (await response(suffix)).blob();
  controller.signal.throwIfAborted();
  const decoded=globalThis.createImageBitmap
   ? await createImageBitmap(blob,{premultiplyAlpha:'none',colorSpaceConversion:'none'})
   : await imageElement(blob);
  return keep(decoded);
 };
 const load=async()=>{
  controller.signal.throwIfAborted();
  if(!planOnly&&!globalThis.createImageBitmap)throw new Error('Safe raw terrain texture decoding unavailable');
  if(planOnly)return {planImage:await image('plan.webp')};
  const [heightImage,normalImage,planImage,buffer]=await Promise.all([
   image('height.png'),image('normal.png'),image('plan.webp'),response('dem.bin').then(result=>result.arrayBuffer()),
  ]);
  if(buffer.byteLength!==256*256*2)throw new Error('Terrain grid has unexpected length');
  return {heightImage,normalImage,planImage,heights:new Uint16Array(buffer)};
 };
 try{return await Promise.race([load(),cancellation]);}
 catch(error){
  controller.abort(error);
  for(const image of images)image.close?.();
  throw error;
 }finally{
  clearTimeout(timer);signal?.removeEventListener('abort',abort);
  controller.signal.removeEventListener('abort',interrupted);
 }
}
