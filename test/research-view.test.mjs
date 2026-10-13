import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as researchData from '../dist/research-data.mjs';
import * as researchCharts from '../dist/research-charts.mjs';

// Run the actual page handlers with isolated browser storage and the small DOM
// surface they use. Data normalization and rendering remain the real modules.
const source=(await readFile(new URL('../dist/research.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const now=Date.parse('2026-09-28T18:00:00Z');
const report={id:'source-report',title:'Tanker attack in the Strait of Hormuz',url:'https://example.com/report',source:'Test source',publishedAt:'2026-09-27T12:00:00Z',theaters:['hormuz']};
const profile=researchData.normalizeProfile({mmsi:'123456789',name:'Retained vessel',notes:'Original research'},new Date(now).toISOString());
const annotation=researchData.normalizeAnnotation({eventDate:'2026-09-26',note:'Original annotation'},report,now);

function storage(initial={}) {
  const data=new Map(Object.entries(initial).map(([key,value])=>['passage-'+key,JSON.stringify(value)]));
  return {
    fail:null,writes:0,
    getItem:key=>data.get(key)??null,
    setItem(key,value){this.writes++;if(this.fail)throw Object.assign(new Error(this.fail),{name:this.fail});data.set(key,value);},
    read:key=>JSON.parse(data.get('passage-'+key)??'null'),
  };
}

async function page(localStorage=storage(),{reports=[report],series=[],width=900,height=268}={}) {
  const nodes=new Map(),lists=new Map(),alerts=[],answers=[],prompts=[],requests=[],observers=[];
  const fields=['mmsi','name','imo','theatre','notes'];
  const dynamic={
    '#graph-entities':['data-graph-entity','graphEntity'],
    '#timeline-table':['data-annotate','annotate'],
    '#profile-list':['data-delete-profile','deleteProfile'],
  };
  function node(selector) {
    if(!nodes.has(selector)){
      let html='';
      nodes.set(selector,{
        value:selector==='#profile-theatre'?'both':'',textContent:'',dataset:{},resets:0,
        attributes:{},style:{},hidden:false,scrollLeft:0,htmlWrites:0,
        clientWidth:width,clientHeight:height,
        setAttribute(name,value){this.attributes[name]=String(value);},
        getAttribute(name){return this.attributes[name]??null;},
        removeAttribute(name){delete this.attributes[name];},classList:{toggle(){}},
        get innerHTML(){return html;},
        set innerHTML(value){
          this.htmlWrites++;html=value;
          if(dynamic[selector]){
            const [attribute,key]=dynamic[selector];
            lists.set(`[${attribute}]`,[...value.matchAll(new RegExp(`${attribute}="([^"]*)"`,'g'))].map(match=>({dataset:{[key]:match[1]}})));
          }
        },
        reset(){this.resets++;for(const field of fields)node('#profile-'+field).value=field==='theatre'?'both':'';},
      });
    }
    return nodes.get(selector);
  }
  const document={querySelector:node,querySelectorAll:selector=>lists.get(selector)||[],activeElement:null,hidden:false,addEventListener(){}};
  const responses={'/api/news':{items:reports},'/api/acled/events?days=365':{events:[],configured:false},'/api/oil':{series},'/api/vessels':{vessels:[]}};
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  vm.runInNewContext(source,{
    ...researchData,...researchCharts,document,localStorage,Date:Clock,URL,AbortSignal,setInterval(){},
    ResizeObserver:class{constructor(callback){observers.push(callback);}observe(){}},
    runtime:{},LIVE_REFRESH_MS:60000,
    apiFetch:async url=>{requests.push(url);return{ok:true,json:async()=>responses[url]};},
    window:{alert:message=>alerts.push(message),prompt:(message,value)=>{prompts.push({message,value});return answers.shift()??null;}},
  },{filename:'dist/research.js'});
  await new Promise(resolve=>setImmediate(resolve));
  return {
    q:node,all:selector=>lists.get(selector)||[],localStorage,alerts,answers,prompts,document,requests,
    resize(nextWidth,nextHeight=height){
      node('#graph-viewport').clientWidth=nextWidth;
      node('#timeline-viewport').clientWidth=nextWidth;node('#timeline-viewport').clientHeight=nextHeight;
      for(const callback of observers)callback();
    },
    fill(values){for(const [key,value] of Object.entries(values))node('#profile-'+key).value=value;},
    submit(){node('#profile-form').onsubmit({preventDefault(){}});},
    refresh(){node('#research-query').oninput({target:{value:''}});node('#research-actor').onchange({target:{value:'All'}});},
    eventDates(){node('#timeline-basis').onchange({target:{value:'event'}});},
  };
}

test('a failed new card save keeps form entries and never displays a saved card or success',async()=>{
  const saved=storage();saved.fail='QuotaExceededError';const h=await page(saved);
  h.fill({mmsi:'123456789',name:'Unsaved vessel',notes:'Keep these notes',theatre:'hormuz'});h.submit();
  assert.equal(h.q('#profile-form').resets,0);
  assert.equal(h.q('#profile-notes').value,'Keep these notes');
  assert.equal(h.q('#profile-theatre').value,'hormuz');
  assert.match(h.q('#profile-feedback').textContent,/could not save/i);
  assert.doesNotMatch(h.q('#profile-list').innerHTML,/Unsaved vessel/);
  h.refresh();assert.doesNotMatch(h.q('#profile-list').innerHTML,/Unsaved vessel/);
  assert.equal(saved.read('vessel-profiles'),null);
});

test('a failed card update preserves the previously saved record in memory and after reload',async()=>{
  const saved=storage({'vessel-profiles':{[profile.mmsi]:profile}}),h=await page(saved);saved.fail='SecurityError';
  h.fill({mmsi:profile.mmsi,name:'Unsaved replacement',notes:'Keep this edit'});h.submit();h.refresh();
  assert.match(h.q('#profile-list').innerHTML,/Retained vessel/);
  assert.doesNotMatch(h.q('#profile-list').innerHTML,/Unsaved replacement/);
  assert.equal(h.q('#profile-notes').value,'Keep this edit');
  assert.deepEqual(saved.read('vessel-profiles'),{[profile.mmsi]:profile});
  const reloaded=await page(saved);assert.match(reloaded.q('#profile-list').innerHTML,/Original research/);
});

test('a failed card deletion retains the card; a successful retry persists across reload',async()=>{
  const saved=storage({'vessel-profiles':{[profile.mmsi]:profile}}),h=await page(saved);saved.fail='QuotaExceededError';
  h.all('[data-delete-profile]')[0].onclick();h.refresh();
  assert.match(h.q('#profile-list').innerHTML,/Retained vessel/);
  assert.match(h.q('#profile-feedback').textContent,/could not delete/i);
  assert.deepEqual(saved.read('vessel-profiles'),{[profile.mmsi]:profile});
  saved.fail=null;h.all('[data-delete-profile]')[0].onclick();
  assert.match(h.q('#profile-feedback').textContent,/deleted from this device/i);
  assert.deepEqual(saved.read('vessel-profiles'),{});
  const reloaded=await page(saved);assert.equal(reloaded.all('[data-delete-profile]').length,0);
});

test('a failed annotation update keeps the previous date and note for the next edit and reload',async()=>{
  const saved=storage({'timeline-annotations':{[report.id]:annotation}}),h=await page(saved);saved.fail='SecurityError';
  h.answers.push('2026-09-25','Unsaved note');h.all('[data-annotate]')[0].onclick();h.eventDates();
  assert.match(h.q('#timeline-table').innerHTML,/datetime="2026-09-26"/);
  assert.doesNotMatch(h.q('#timeline-table').innerHTML,/datetime="2026-09-25"/);
  assert.match(h.alerts[0]||'',/could not save/i);
  assert.deepEqual(saved.read('timeline-annotations'),{[report.id]:annotation});
  h.answers.push('2026-09-26',null);h.all('[data-annotate]')[0].onclick();
  assert.equal(h.prompts.at(-1).value,'Original annotation');
  const reloaded=await page(saved);reloaded.eventDates();assert.match(reloaded.q('#timeline-table').innerHTML,/datetime="2026-09-26"/);
});

test('successful card saves clear the form only after persistence and reload with the saved content',async()=>{
  const h=await page();h.fill({mmsi:'123456789',name:'Saved vessel',notes:'Saved research'});h.submit();
  assert.equal(h.q('#profile-form').resets,1);
  assert.equal(h.q('#profile-notes').value,'');
  assert.equal(h.q('#profile-feedback').textContent,'Saved on this device');
  assert.equal(h.localStorage.read('vessel-profiles')['123456789'].notes,'Saved research');
  const reloaded=await page(h.localStorage);assert.match(reloaded.q('#profile-list').innerHTML,/Saved research/);
});

test('successful annotations persist and reappear on the selected event date after reload',async()=>{
  const h=await page();h.answers.push('2026-09-25','Saved annotation');h.all('[data-annotate]')[0].onclick();
  assert.equal(h.localStorage.read('timeline-annotations')[report.id].note,'Saved annotation');
  const reloaded=await page(h.localStorage);reloaded.eventDates();assert.match(reloaded.q('#timeline-table').innerHTML,/datetime="2026-09-25"/);
});

test('canceling the note prompt leaves the existing annotation untouched',async()=>{
  const saved=storage({'timeline-annotations':{[report.id]:annotation}}),h=await page(saved);
  h.answers.push('2026-09-25',null);h.all('[data-annotate]')[0].onclick();h.eventDates();
  assert.equal(saved.writes,0);
  assert.deepEqual(saved.read('timeline-annotations'),{[report.id]:annotation});
  assert.match(h.q('#timeline-table').innerHTML,/datetime="2026-09-26"/);
});

test('day-only publication records remain in research without an invented midnight time',async()=>{
  for(const publication of [
    {publishedAt:undefined,publishedDate:'2026-09-27'},
    {publishedAt:'2026-09-27T00:00:00Z',publicationPrecision:'day'},
  ]){
    const h=await page(storage(),{reports:[{...report,...publication}]});
    assert.match(h.q('#graph-list').innerHTML,/Tanker attack in the Strait of Hormuz/);
    assert.match(h.q('#graph-list').innerHTML,/published Sep 27, 2026/);
    assert.match(h.q('#graph-list').innerHTML,/time not supplied/);
    assert.doesNotMatch(h.q('#graph-list').innerHTML,/00:00 UTC|at — UTC/);
  }
});

test('precise publication records retain their supplied clock in research',async()=>{
  const h=await page();
  assert.match(h.q('#graph-list').innerHTML,/published Sep 27, 2026 at 12:00 UTC/);
  assert.doesNotMatch(h.q('#graph-list').innerHTML,/time not supplied/);
});

test('Research renders native chart dimensions with an accessible graph scroll hint only when needed',async()=>{
  const series=[{id:'brent',observations:[{date:'2026-09-27',value:80}]}];
  for(const width of [249,319,359,900]){
    const h=await page(storage(),{width,height:228,series}),graph=h.q('#graph-svg'),timeline=h.q('#timeline-svg');
    const graphWidth=Math.max(640,width);
    assert.equal(graph.style.width,graphWidth+'px');
    assert.equal(graph.getAttribute('viewBox'),`0 0 ${graphWidth} 240`);
    assert.equal(graph.style.height,'240px','native height must not scale graph text into its wrapper');
    assert.equal(timeline.style.width,width+'px');assert.equal(timeline.style.height,'228px');
    assert.equal(timeline.getAttribute('viewBox'),`0 0 ${width} 228`);
    assert.equal(h.q('#graph-scroll-hint').hidden,width>=640);
    assert.equal(h.q('#graph-viewport').tabIndex,width<640?0:-1);
    assert.equal(h.q('#graph-viewport').getAttribute('aria-describedby'),width<640?'graph-scroll-hint':null);
  }
});

test('resizing only redraws chart SVGs and preserves the selected entity, page, focus, scroll and dates',async()=>{
  const reports=Array.from({length:25},(_,index)=>({...report,id:'source-'+index,url:`https://example.com/${index}`,title:`Houthi tanker attack ${index}`,actors:['Houthis']}));
  const series=[{id:'brent',observations:[{date:'2026-09-27',value:80}]}];
  const h=await page(storage(),{reports,series,width:319,height:228});
  h.all('[data-graph-entity]').find(button=>button.dataset.graphEntity==='houthis').onclick();
  h.q('#graph-next').onclick();h.q('#research-days').onchange({target:{value:'365'}});
  const entity=h.all('[data-graph-entity]').find(button=>button.dataset.graphEntity==='houthis');
  h.document.activeElement=entity;h.q('#graph-viewport').scrollLeft=135;
  const stableSelectors=['#graph-entities','#graph-list','#timeline-table','#profile-list'];
  const before=stableSelectors.map(selector=>({html:h.q(selector).innerHTML,writes:h.q(selector).htmlWrites}));
  const pageLabel=h.q('#graph-page').textContent,requests=h.requests.length;
  assert.match(pageLabel,/Page 2/);
  h.resize(359,228);
  assert.equal(h.document.activeElement,entity);assert.equal(h.q('#graph-viewport').scrollLeft,135);
  assert.equal(h.q('#graph-page').textContent,pageLabel);
  stableSelectors.forEach((selector,index)=>{
    assert.equal(h.q(selector).innerHTML,before[index].html);assert.equal(h.q(selector).htmlWrites,before[index].writes);
  });
  assert.equal(h.requests.length,requests);assert.equal(h.localStorage.writes,0);
  assert.match(h.q('#timeline-svg').innerHTML,/Sep 29, 2025/);
  assert.equal((h.q('#timeline-svg').innerHTML.match(/timeline-date/g)||[]).length,2);
  h.resize(900,268);
  assert.equal(h.q('#graph-svg').style.width,'900px');assert.equal(h.q('#graph-scroll-hint').hidden,true);
  assert.equal((h.q('#timeline-svg').innerHTML.match(/timeline-date/g)||[]).length,4);
  const writes=h.q('#graph-svg').htmlWrites;h.resize(900,268);
  assert.equal(h.q('#graph-svg').htmlWrites,writes,'height notifications must not cause graph redraw loops');
});

test('a hidden Research chart lays out when shown without rerendering its reading list',async()=>{
  const h=await page(storage(),{width:0,height:228});
  assert.equal(h.q('#graph-svg').htmlWrites,0);
  const reading=h.q('#graph-list').innerHTML,writes=h.q('#graph-list').htmlWrites;
  h.resize(319,228);
  assert.equal(h.q('#graph-svg').style.width,'640px');
  assert.equal(h.q('#graph-list').innerHTML,reading);assert.equal(h.q('#graph-list').htmlWrites,writes);
});

test('data changes while charts are hidden redraw when their previous width returns',async()=>{
  const series=[{id:'brent',observations:[{date:'2026-09-27',value:80}]}];
  const h=await page(storage(),{width:319,height:228,series});
  assert.match(h.q('#graph-svg').innerHTML,/Test source/);
  assert.match(h.q('#timeline-svg').innerHTML,/Aug 30, 2026/);
  h.resize(0,0);
  h.q('#research-query').oninput({target:{value:'unmatched source'}});
  h.q('#research-days').onchange({target:{value:'365'}});
  h.resize(319,228);
  assert.doesNotMatch(h.q('#graph-svg').innerHTML,/Test source/);
  assert.match(h.q('#graph-svg').innerHTML,/No source-linked headlines/);
  assert.match(h.q('#timeline-svg').innerHTML,/Sep 29, 2025/);
  assert.equal(h.q('#graph-scroll-hint').hidden,true);
});
