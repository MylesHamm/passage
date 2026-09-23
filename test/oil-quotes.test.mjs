import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the real browser controller without making market-data requests.
async function harness({online=true,paused=false}={}) {
  const events=new EventTarget(), timers=new Map();let sequence=0,createdFrames=0,Element;
  class Node extends EventTarget {
    dataset={};children=[];textContent='';hidden=false;attributes={};
    hasAttribute(k){return Object.hasOwn(this.attributes,k);}
    getAttribute(k){return this.hasAttribute(k)?this.attributes[k]:null;}
    setAttribute(k,v){const old=this.getAttribute(k);this.attributes[k]=String(v);if(this.constructor.observedAttributes?.includes(k))this.attributeChangedCallback(k,old,String(v));}
    removeAttribute(k){if(!this.hasAttribute(k))return;const old=this.attributes[k];delete this.attributes[k];if(this.constructor.observedAttributes?.includes(k))this.attributeChangedCallback(k,old,null);}
    replaceChildren(...children){this.children=children;}
  }
  class Host extends Node {
    nodes=new Map(['[data-quote-frame]','[data-quote-status]','[data-quote-retry]'].map(k=>[k,new Node()]));
    querySelector(k){return this.nodes.get(k);}
  }
  const navigator={onLine:online};
  const context=vm.createContext({HTMLElement:Host,customElements:{define(name,type){assert.equal(name,'passage-oil-quotes');Element=type;}},
    document:{createElement:()=>{createdFrames++;return new Node();}},window:events,navigator,URL,JSON,
    setTimeout(fn){const id=++sequence;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}});
  vm.runInContext(await readFile(new URL('../dist/oil-quotes.js',import.meta.url),'utf8'),context);
  const el=new Element();if(paused)el.setAttribute('paused','');el.connectedCallback();
  return {el,navigator,events,timers,createdFrames:()=>createdFrames,frame:()=>el.querySelector('[data-quote-frame]').children[0],
    status:()=>el.querySelector('[data-quote-status]').textContent,retry:()=>el.querySelector('[data-quote-retry]').dispatchEvent(new Event('click'))};
}

test('intraday embed uses fixed Brent/WTI symbols, an intraday range and provider attribution',async()=>{
  const h=await harness(),url=new URL(h.frame().src),config=JSON.parse(decodeURIComponent(url.hash.slice(1)));
  assert.equal(url.origin,'https://www.tradingview-widget.com');
  assert.equal(url.pathname,'/embed-widget/symbol-overview/');
  assert.deepEqual(config.symbols,[['Brent','TVC:UKOIL|1D'],['WTI','TVC:USOIL|1D']]);
  assert.equal(config.dateRanges[0],'1d|1');assert.equal(config.hideMarketStatus,false);
  assert.match(h.frame().title,/Brent and WTI/);assert.equal(h.frame().referrerPolicy,'no-referrer');
  assert.match(h.el.innerHTML,/by TradingView/);assert.match(h.el.innerHTML,/CFD/);
  assert.match(h.el.innerHTML,/not included in Passage alerts or exports/);
});

test('opening a frame never claims that prices or quote freshness have been verified',async()=>{
  const h=await harness();assert.match(h.status(),/Opening/);
  h.frame().dispatchEvent(new Event('load'));
  assert.match(h.status(),/Check the chart/);assert.doesNotMatch(h.status(),/Live|Connected|Updated|fresh/i);
  assert.equal(h.timers.size,0);
});

test('slow loading offers recovery; retry replaces the frame and ignores a previous attempt',async()=>{
  const h=await harness(),old=h.frame();[...h.timers.values()][0]();
  assert.match(h.status(),/longer than usual/);
  h.retry();assert.notEqual(h.frame(),old);assert.match(h.status(),/Opening/);
  old.dispatchEvent(new Event('load'));assert.match(h.status(),/Opening/);
  h.frame().dispatchEvent(new Event('error'));assert.match(h.status(),/could not open/);
  assert.equal(h.el.querySelector('[data-quote-frame]').children.length,0);
});

test('offline state removes potentially stale quotes and reconnect opens a fresh frame',async()=>{
  const h=await harness({online:false});assert.equal(h.frame(),undefined);assert.match(h.status(),/Offline/);
  h.navigator.onLine=true;h.events.dispatchEvent(new Event('online'));assert.ok(h.frame());
  h.frame().dispatchEvent(new Event('load'));h.navigator.onLine=false;h.events.dispatchEvent(new Event('offline'));
  assert.equal(h.frame(),undefined);assert.match(h.status(),/Offline/);
  assert.equal(h.timers.size,0);
});

test('blocked embeds explain the problem and removal releases listeners and timers',async()=>{
  const h=await harness(),blocked=new Event('securitypolicyviolation');
  Object.assign(blocked,{effectiveDirective:'frame-src',blockedURI:'https://www.tradingview-widget.com'});
  h.events.dispatchEvent(blocked);assert.match(h.status(),/blocked/);assert.equal(h.frame(),undefined);
  h.retry();h.el.disconnectedCallback();assert.equal(h.timers.size,0);
  h.events.dispatchEvent(new Event('online'));assert.equal(h.frame(),undefined);
});

test('a paused attribute present before connection never opens a quote frame',async()=>{
  const h=await harness({paused:true});
  assert.equal(h.createdFrames(),0);assert.equal(h.frame(),undefined);assert.equal(h.timers.size,0);
  assert.equal(h.el.dataset.quoteState,'paused');assert.match(h.status(),/Auto refresh/);
  h.retry();h.events.dispatchEvent(new Event('online'));
  assert.equal(h.createdFrames(),0);assert.match(h.status(),/paused/i);
});

test('pause discards quotes and ignores reload, reconnect and stale callbacks until resumed',async()=>{
  const h=await harness(),old=h.frame(),lateTimeout=[...h.timers.values()][0];
  h.el.setAttribute('paused','');
  assert.equal(h.frame(),undefined);assert.equal(h.timers.size,0);assert.equal(h.el.dataset.quoteState,'paused');
  old.dispatchEvent(new Event('load'));old.dispatchEvent(new Event('error'));lateTimeout();
  h.navigator.onLine=false;h.events.dispatchEvent(new Event('offline'));
  h.navigator.onLine=true;h.events.dispatchEvent(new Event('online'));h.retry();
  const blocked=new Event('securitypolicyviolation');
  Object.assign(blocked,{effectiveDirective:'frame-src',blockedURI:'https://www.tradingview-widget.com'});
  h.events.dispatchEvent(blocked);
  assert.equal(h.createdFrames(),1);assert.equal(h.frame(),undefined);assert.equal(h.el.dataset.quoteState,'paused');
  assert.match(h.status(),/paused/i);
  h.el.removeAttribute('paused');
  assert.notEqual(h.frame(),old);assert.equal(h.createdFrames(),2);assert.equal(h.timers.size,1);assert.match(h.status(),/Opening/);
  h.frame().dispatchEvent(new Event('load'));assert.equal(h.el.dataset.quoteState,'display');
});

test('disconnect cleanup is repeatable and attribute changes do not reopen a detached chart',async()=>{
  const h=await harness();h.el.disconnectedCallback();h.el.disconnectedCallback();
  h.el.setAttribute('paused','');h.el.removeAttribute('paused');h.retry();h.events.dispatchEvent(new Event('online'));
  assert.equal(h.frame(),undefined);assert.equal(h.createdFrames(),1);assert.equal(h.timers.size,0);
  h.el.setAttribute('paused','');h.el.connectedCallback();
  assert.equal(h.frame(),undefined);assert.equal(h.createdFrames(),1);assert.equal(h.el.dataset.quoteState,'paused');
  h.el.removeAttribute('paused');assert.equal(h.createdFrames(),2);assert.equal(h.timers.size,1);
  h.el.disconnectedCallback();assert.equal(h.timers.size,0);
});
