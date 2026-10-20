import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegionalTerrain} from '../dist/terrain/controller.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};

// Run the actual controller, asset loader and renderers. The stand-ins provide
// DOM ownership, asset settlement and animation frames, without a browser/GPU.
async function harness(t, {webgl=true, reducedMotion=true}={}) {
  const document = Object.assign(new EventTarget(), {hidden:false, activeElement:null});
  const matrices = [], frames = new Map(), requests = [], responses = new Map();
  let nextFrame = 0, controller, destroyed = false;
  const gl = new Proxy({
    getShaderParameter:() => true, getProgramParameter:() => true,
    createShader:() => ({}), createProgram:() => ({}), createBuffer:() => ({}), createTexture:() => ({}),
    getAttribLocation:() => 0, getUniformLocation:(_, name) => name,
    uniformMatrix4fv:(_, transpose, matrix) => matrices.push([...matrix]),
  }, {get:(target, key) => target[key] ?? (/^[A-Z_0-9]+$/.test(key) ? 0 : () => {})});
  const context = {setTransform(){}, fillRect(){}, drawImage(){}};
  const dataKey = name => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

  class Node extends EventTarget {
    constructor(tag='div') {
      super();this.tagName=tag;this.ownerDocument=document;this.children=[];this.parentNode=null;
      this.dataset={};this.style={};this.attributes=new Map();this.className='';this.id='';
      this.hidden=false;this.disabled=false;this.textContent='';
      this.classList={
        add:(...names) => {this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' ');},
        remove:(...names) => {this.className=this.className.split(/\s+/).filter(name => !names.includes(name)).join(' ');},
        toggle:(name,force) => {const active=force??!this.className.split(/\s+/).includes(name);this.classList[active?'add':'remove'](name);return active;},
      };
    }
    matches(selector) {
      if(selector.startsWith('#')) return this.id===selector.slice(1);
      if(selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
      if(selector.startsWith('[data-')) return Object.hasOwn(this.dataset, dataKey(selector.slice(6,-1)));
      return this.tagName===selector;
    }
    querySelectorAll(selector) {return this.children.flatMap(child => [...(child.matches(selector)?[child]:[]), ...child.querySelectorAll(selector)]);}
    querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
    append(...nodes) {for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
    replaceChildren(...nodes) {for(const child of [...this.children])child.remove();this.append(...nodes);}
    before(node) {const parent=this.parentNode;if(!parent)return;node.remove();node.parentNode=parent;parent.children.splice(parent.children.indexOf(this),0,node);}
    after(node) {const parent=this.parentNode;if(!parent)return;node.remove();node.parentNode=parent;parent.children.splice(parent.children.indexOf(this)+1,0,node);}
    replaceWith(node) {this.before(node);this.remove();}
    remove() {if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}}
    cloneNode() {const copy=new Node(this.tagName);copy.className=this.className;copy.id=this.id;return copy;}
    setAttribute(name,value) {this.attributes.set(name,String(value));}
    getAttribute(name) {return this.attributes.get(name) ?? null;}
    get firstElementChild() {return this.children[0] || null;}
    get lastElementChild() {return this.children.at(-1) || null;}
    set innerHTML(value) {
      this.replaceChildren();
      for(const [,tag,attrs,text] of value.matchAll(/<([a-z][\w-]*)\b([^>]*)>([^<]*)/g)){
        const child=new Node(tag);child.className=attrs.match(/class="([^"]*)"/)?.[1] || '';
        child.textContent=text;this.append(child);
      }
    }
    getBoundingClientRect() {
      for(let node=this;node;node=node.parentNode)if(node.hidden)return {width:0,height:0};
      return {width:960,height:this.matches('.both-overview-surface')?190:360};
    }
    get clientWidth() {return this.getBoundingClientRect().width;}
    get clientHeight() {return this.getBoundingClientRect().height;}
    getContext(type) {return type==='webgl'?(webgl?gl:null):type==='2d'?context:null;}
    focus() {document.activeElement=this;}
    setPointerCapture() {}
    hasPointerCapture() {return false;}
    releasePointerCapture() {}
  }

  document.createElement=tag=>new Node(tag);
  const root=new Node(), surface=new Node(), canvas=new Node('canvas'), loading=new Node();
  surface.className='globe-surface';loading.className='globe-loading';surface.append(canvas,loading);root.append(surface);
  for(const id of ['globe-mode','globe-motion','terrain-wider','zoom-in','zoom-out']){
    const node=new Node('button');node.id=id;root.append(node);
  }
  const heading=new Node('h2');heading.id='map-heading';document.querySelector=selector=>selector==='#map-heading'?heading:null;
  const successful = filename => ({
    ok:true,
    blob:async()=>({filename}),
    arrayBuffer:async()=>new ArrayBuffer(256*256*2),
  });
  const globals = {
    document, devicePixelRatio:1,
    matchMedia:()=>Object.assign(new EventTarget(), {matches:reducedMotion}),
    ResizeObserver:class {observe(){} disconnect(){}},
    IntersectionObserver:class {observe(){} disconnect(){}},
    requestAnimationFrame:callback=>{const id=++nextFrame;frames.set(id,callback);return id;},
    cancelAnimationFrame:id=>frames.delete(id),
    createImageBitmap:async blob=>({filename:blob.filename,width:1024,height:1024,close(){}}),
    fetch:async url=>{
      const filename=new URL(url).pathname.split('/').at(-1);requests.push(filename);
      const queue=responses.get(filename), response=queue?.shift();
      if(typeof response==='function')return response();
      return response ?? successful(filename);
    },
  };
  const previous=Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  t.after(()=>{
    if(!destroyed)controller?.destroy();
    for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  });
  const regions=[];
  controller=await createRegionalTerrain(root,{onRegionChange:region=>regions.push(region)});
  const labels=root.querySelector('.terrain-labels'), focus=root.querySelector('.terrain-geographic-focus');
  const flushFrames=()=>{
    let remaining=10;
    while(frames.size && remaining--){const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(performance.now()+1000);}
    assert.equal(frames.size,0,'camera work must settle instead of scheduling indefinitely');
  };
  return {
    controller, root, loading, labels, focus, heading, regions, matrices, requests, frames, flushFrames,
    queue(filename,...values){responses.set(filename,values);},
    success:successful,
    fail(filename){responses.set(filename,[{ok:false,status:503}]);},
    pendingFallback(region){
      const entered=deferred(), pending=deferred(), filename=region+'-plan.webp';
      responses.set(region+'-height.png',[{ok:false,status:503}]);
      responses.set(filename,[successful(filename),()=>{entered.resolve();return pending.promise;}]);
      return {...pending,entered:entered.promise};
    },
    click(selector){const node=root.querySelector(selector);if(!node.disabled)node.dispatchEvent(new Event('click'));},
    snapshot(){return {
      dataset:{...root.dataset},loadingHidden:loading.hidden,loadingText:loading.textContent,
      labelsHidden:labels.hidden,focusHidden:focus.hidden,heading:heading.textContent,
      error:controller.getDiagnostics().error,regions:[...regions],
    };},
    destroy(){controller.destroy();destroyed=true;},
  };
}

function assertReady(h, region) {
  assert.equal(h.controller.getDiagnostics().scene,region);
  assert.equal(h.root.dataset.terrainScene,region);
  assert.notEqual(h.root.dataset.terrainMode,'unavailable');
  assert.equal(h.root.dataset.terrainLoading,undefined);
  assert.equal(h.loading.hidden,true);
  assert.equal(h.labels.hidden,false);
  assert.equal(h.focus.hidden,false);
}

test('a failed old fallback cannot overwrite the healthy scene selected while it was pending', {timeout:5000}, async t=>{
  const h=await harness(t), fallback=h.pendingFallback('hormuz');
  const oldSelection=h.controller.select('hormuz');
  await fallback.entered;
  await h.controller.select('bab');h.flushFrames();assertReady(h,'bab');
  const healthy=h.snapshot();

  fallback.reject(new Error('Old Hormuz fallback failed'));
  await oldSelection;h.flushFrames();

  assert.deepEqual(h.snapshot(),healthy,'late rejection must not change the active scene or overlay');
  assertReady(h,'bab');
});

test('failed detailed and fallback assets reach an explicit terminal state with no pending flag', {timeout:5000}, async t=>{
  const h=await harness(t);
  h.fail('hormuz-height.png');
  h.queue('hormuz-plan.webp',h.success('hormuz-plan.webp'),{ok:false,status:503});

  await h.controller.select('hormuz');h.flushFrames();

  assert.equal(h.root.dataset.terrainMode,'unavailable');
  assert.equal(h.root.dataset.terrainLoading,undefined,'a failed request is no longer pending');
  assert.equal(h.loading.hidden,false);
  assert.match(h.loading.textContent,/Hormuz terrain could not load/);
  assert.equal(h.labels.hidden,true);assert.equal(h.focus.hidden,true);
  assert.match(h.root.querySelector('.terrain-received').textContent,/Reference map unavailable/);
  assert.equal(h.frames.size,0);
});

test('a loading or failed region never retains the previous frame vessel count', {timeout:5000}, async t=>{
  const h=await harness(t);
  await h.controller.select('bab');
  h.controller.setVessels([{mmsi:'123456789',provider:'AISStream',theater:'bab',longitude:43.33,latitude:12.58,
    positionTime:new Date(Date.now()-1000).toISOString()}],true,{status:'available'});
  h.flushFrames();
  const caption=h.root.querySelector('.terrain-received'),layer=h.root.querySelector('.terrain-object-layer');
  assert.match(caption.textContent,/1 received position/);assert.equal(h.controller.getDiagnostics().visibleVesselCount,1);
  const fallback=h.pendingFallback('hormuz'),pending=h.controller.select('hormuz');
  await fallback.entered;
  assert.match(caption.textContent,/Preparing Hormuz/);assert.equal(layer.hidden,true);assert.equal(h.controller.getDiagnostics().visibleVesselCount,0);
  fallback.reject(new Error('Map asset unavailable'));await pending;h.flushFrames();
  assert.match(caption.textContent,/Reference map unavailable/);assert.equal(layer.hidden,true);assert.equal(h.controller.getDiagnostics().visibleVesselCount,0);
});

test('destroying the controller while a fallback is pending prevents later settlement writes', {timeout:5000}, async t=>{
  const h=await harness(t), fallback=h.pendingFallback('hormuz');
  const selection=h.controller.select('hormuz');await fallback.entered;
  h.destroy();const removed=h.snapshot();

  fallback.reject(new Error('Fallback failed after destruction'));
  await selection;

  assert.deepEqual(h.snapshot(),removed);
  assert.equal(h.frames.size,0);
});

test('a previously loaded scene recovers from another scene failure using cached assets', {timeout:5000}, async t=>{
  const h=await harness(t);
  await h.controller.select('bab');h.flushFrames();assertReady(h,'bab');
  const babRequests=h.requests.filter(name=>name.startsWith('bab-')).length;
  h.fail('hormuz-height.png');
  h.queue('hormuz-plan.webp',h.success('hormuz-plan.webp'),{ok:false,status:503});
  await h.controller.select('hormuz');h.flushFrames();
  assert.equal(h.loading.hidden,false);

  await h.controller.select('bab');h.flushFrames();

  assertReady(h,'bab');
  assert.equal(h.requests.filter(name=>name.startsWith('bab-')).length,babRequests,'recovery reuses the loaded scene');
  await h.controller.select('bab');h.flushFrames();assertReady(h,'bab');
});

for(const webgl of [true,false])for(const reducedMotion of [true,false]){
  test(`two zoom-out clicks settle at the minimum (${webgl?'WebGL':'plan'}, ${reducedMotion?'reduced':'normal'} motion)`,{timeout:5000},async t=>{
    const h=await harness(t,{webgl,reducedMotion});
    for(const region of ['hormuz','bab']){
      await h.controller.select(region);h.flushFrames();
      const requests=h.requests.length;
      h.click('#zoom-out');h.flushFrames();h.click('#zoom-out');h.flushFrames();
      assert.equal(h.controller.getDiagnostics().pose.zoom,.76);
      assert.equal(h.root.querySelector('#zoom-out').disabled,true);
      assert.equal(h.root.querySelector('#zoom-out').title,'Widest view reached');
      assert.match(h.root.querySelector('#globe-mode').textContent,/Widest view/);
      assertReady(h,region);
      assert.equal(h.requests.length,requests,'camera zoom must not reload geographic assets');
      assert.ok(h.matrices.every(matrix=>matrix.every(Number.isFinite)));
      assert.doesNotMatch(h.focus.style.transform,/NaN|Infinity/);
      const count=h.controller.getDiagnostics().frames;
      h.flushFrames();assert.equal(h.controller.getDiagnostics().frames,count);
      h.controller.reset();h.flushFrames();
      assert.equal(h.controller.getDiagnostics().pose.zoom,1);
    }
  });
}
