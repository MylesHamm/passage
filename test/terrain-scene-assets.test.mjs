import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSceneAssets} from '../dist/terrain/scene-assets.mjs';
import {SCENES} from '../dist/terrain/geometry.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function settle(){for(let i=0;i<16;i++)await Promise.resolve();}
function install(t,key,value){
 const previous=Object.getOwnPropertyDescriptor(globalThis,key);
 Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,key,previous);else delete globalThis[key];});
}
function harness(t){
 const timers=new Map(),requests=[],decoded=[];
 let timerId=0;
 const h={timers,requests,decoded,
  fetch:async url=>({ok:true,blob:async()=>({url}),arrayBuffer:async()=>new ArrayBuffer(256*256*2)}),
  decode:async blob=>{const image={url:blob.url,closed:0,close(){this.closed++;}};decoded.push(image);return image;},
  deadline(){assert.equal(timers.size,1);const callback=timers.values().next().value;callback();},
 };
 install(t,'fetch',(url,options)=>{requests.push({url,signal:options.signal});return h.fetch(url,options);});
 install(t,'createImageBitmap',blob=>h.decode(blob));
 install(t,'setTimeout',callback=>{timers.set(++timerId,callback);return timerId;});
 install(t,'clearTimeout',id=>timers.delete(id));
 return h;
}

test('a stalled asset fetch terminates at its deadline even when fetch ignores abort',async t=>{
 const h=harness(t);h.fetch=()=>new Promise(()=>{});
 const pending=loadSceneAssets(SCENES.hormuz,{planOnly:true});
 const rejected=assert.rejects(pending,{name:'TimeoutError'});
 h.deadline();await rejected;
 assert.equal(h.requests[0].signal.aborted,true);assert.equal(h.timers.size,0);
});

test('the same deadline covers a stalled response body',async t=>{
 const h=harness(t);h.fetch=async()=>({ok:true,blob:()=>new Promise(()=>{})});
 const pending=loadSceneAssets(SCENES.theatre,{planOnly:true});
 const rejected=assert.rejects(pending,{name:'TimeoutError'});
 await settle();h.deadline();await rejected;
 assert.equal(h.requests[0].signal.aborted,true);assert.equal(h.timers.size,0);
});

test('a timed-out bitmap decode cannot keep loading pending and its late bitmap is closed',async t=>{
 const h=harness(t),decode=deferred();h.decode=()=>decode.promise;
 const pending=loadSceneAssets(SCENES.hormuz,{planOnly:true});
 const rejected=assert.rejects(pending,{name:'TimeoutError'});
 await settle();h.deadline();await rejected;
 const late={closed:0,close(){this.closed++;}};decode.resolve(late);await settle();
 assert.equal(late.closed,1);assert.equal(h.timers.size,0);
});

test('aborting a full scene closes completed and late decodes and cancels its sibling requests',async t=>{
 const h=harness(t),parent=new AbortController(),late=deferred();
 h.decode=async blob=>{
  if(blob.url.endsWith('normal.png'))return late.promise;
  const image={closed:0,close(){this.closed++;}};h.decoded.push(image);return image;
 };
 const pending=loadSceneAssets(SCENES.theatre,{signal:parent.signal});
 const rejected=assert.rejects(pending,{name:'AbortError'});
 await settle();assert.equal(h.decoded.length,2);
 parent.abort();await rejected;
 assert.ok(h.requests.every(request=>request.signal.aborted));
 assert.ok(h.decoded.every(image=>image.closed===1));
 const image={closed:0,close(){this.closed++;}};late.resolve(image);await settle();
 assert.equal(image.closed,1);assert.equal(h.timers.size,0);
});

test('a failed scene aborts other assets and releases images decoded before the failure',async t=>{
 const h=harness(t),failure=deferred();
 h.fetch=async url=>({ok:true,blob:async()=>({url}),arrayBuffer:()=>failure.promise});
 const pending=loadSceneAssets(SCENES.hormuz);
 const rejected=assert.rejects(pending,/Grid read failed/);
 await settle();assert.equal(h.decoded.length,3);
 failure.reject(new Error('Grid read failed'));await rejected;
 assert.ok(h.requests.every(request=>request.signal.aborted));
 assert.ok(h.decoded.every(image=>image.closed===1));assert.equal(h.timers.size,0);
});

test('successful scene loading transfers usable images and clears its deadline',async t=>{
 const h=harness(t),assets=await loadSceneAssets(SCENES.hormuz);
 assert.equal(assets.heights.length,256*256);assert.equal(h.decoded.length,3);
 assert.ok(h.decoded.every(image=>image.closed===0));assert.equal(h.timers.size,0);
 assert.equal(assets.planImage,h.decoded.find(image=>image.url.endsWith('plan.webp')));
});

test('a signal cancelled before loading starts performs no request',async t=>{
 const h=harness(t),parent=new AbortController();parent.abort();
 await assert.rejects(loadSceneAssets(SCENES.theatre,{signal:parent.signal}),{name:'AbortError'});
 assert.equal(h.requests.length,0);assert.equal(h.timers.size,0);
});

test('the image-element fallback also times out and releases its object URL',async t=>{
 const h=harness(t),images=[],revoked=[];
 globalThis.createImageBitmap=undefined;
 install(t,'Image',class {constructor(){images.push(this);}set src(value){this.source=value;}});
 t.mock.method(URL,'createObjectURL',()=> 'blob:terrain-test');
 t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));
 const pending=loadSceneAssets(SCENES.theatre,{planOnly:true});
 const rejected=assert.rejects(pending,{name:'TimeoutError'});
 await settle();assert.equal(images[0].source,'blob:terrain-test');
 h.deadline();await rejected;
 assert.equal(images[0].source,'');assert.equal(images[0].onload,null);
 assert.deepEqual(revoked,['blob:terrain-test']);assert.equal(h.timers.size,0);
});
