import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as researchData from '../dist/research-data.mjs';

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

async function page(localStorage=storage(),{reports=[report]}={}) {
  const nodes=new Map(),lists=new Map(),alerts=[],answers=[],prompts=[];
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
        setAttribute(){},classList:{toggle(){}},
        get innerHTML(){return html;},
        set innerHTML(value){
          html=value;
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
  const document={querySelector:node,querySelectorAll:selector=>lists.get(selector)||[],hidden:false,addEventListener(){}};
  const responses={'/api/news':{items:reports},'/api/acled/events?days=365':{events:[],configured:false},'/api/oil':{series:[]},'/api/vessels':{vessels:[]}};
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  vm.runInNewContext(source,{
    ...researchData,document,localStorage,Date:Clock,URL,AbortSignal,setInterval(){},
    runtime:{},LIVE_REFRESH_MS:60000,
    apiFetch:async url=>({ok:true,json:async()=>responses[url]}),
    window:{alert:message=>alerts.push(message),prompt:(message,value)=>{prompts.push({message,value});return answers.shift()??null;}},
  },{filename:'dist/research.js'});
  await new Promise(resolve=>setImmediate(resolve));
  return {
    q:node,all:selector=>lists.get(selector)||[],localStorage,alerts,answers,prompts,
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
