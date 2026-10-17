import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeOilObservations} from '../dist/oil-chart-view.mjs';
import {renderMarketPulse} from '../dist/market-pulse.mjs';
import {renderMarketContext} from '../dist/market-view.mjs';
import {buildOilSystemState} from '../dist/oil-system-model.mjs';
import {reportTime,reportTimeLabel} from '../dist/reporting-view.mjs';

const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const section=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
function harness(){
  let now=Date.parse('2026-10-11T23:59:00Z');
  const nodes=new Map(),chartUpdates=[],systemUpdates=[];
  const document={hidden:false,activeElement:null};
  const $=selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',scrollTop:90,contains:()=>false});return nodes.get(selector);};
  const state={auto:false,period:90,theater:'both',failures:{},oil:{series:[{id:'brent',name:'Brent',connection:'connected',retrievedAt:'2026-10-11T20:00:00Z',observations:[{date:'2026-10-02',value:100}]}]},market:{series:[{id:'crude-stocks',name:'Crude stocks',connection:'connected',retrievedAt:'2026-10-11T20:00:00Z',observations:[{date:'2026-09-28',value:420000}],scale:.001,units:'MBBL',displayUnit:'million barrels',url:'https://www.eia.gov/'}]}};
  class Clock extends Date {static now(){return now;}}
  const context=vm.createContext({state,document,$,$$:()=>[],Date:Clock,normalizeOilObservations,renderMarketPulse,renderMarketContext,reportTime,reportTimeLabel,
    preserveViewFocus:()=>()=>{},oilChart:{update:(...args)=>chartUpdates.push(args)},oilSystem:{update:input=>systemUpdates.push(buildOilSystemState({...input,selected:'transport',expanded:true}))},
    esc:String,money:value=>String(value),fmtDate:value=>value,relative:value=>`${Math.floor((now-Date.parse(value))/86400000)}d ago`,allSourceStates:()=>[],
    renderExposureBaseline(){},renderReports(){},renderWeather(){},renderStatus(){},inspectorMode:null,selectedMmsi:null});
  const oilStart=app.includes('function renderOilContext(')?'function renderOilContext(':'function renderOil(';
  vm.runInContext(section(oilStart,'function renderWeather('),context);
  vm.runInContext(section('function renderMarket(','\nrenderMarket();'),context);
  vm.runInContext(section('function refreshAges(','\nlet reportingPollBusy='),context);
  if(app.includes('function reportAge('))vm.runInContext(section('function reportAge(','function toast('),context);
  return {context,$,state,chartUpdates,systemUpdates,setTime(value){now=Date.parse(value);}};
}

test('the normal age tick refreshes pulse, oil-system and weekly freshness while auto refresh is paused',()=>{
  const h=harness();h.context.renderOil();h.context.renderMarket();
  assert.match(h.$('#market-pulse').innerHTML,/data-state="available"/);
  assert.equal(h.systemUpdates.at(-1).prices[0].status,'available');
  assert.doesNotMatch(h.$('#market-context').innerHTML,/Older weekly/);
  const chartCount=h.chartUpdates.length;
  h.setTime('2026-10-12T00:01:00Z');h.context.refreshAges();
  assert.match(h.$('#market-pulse').innerHTML,/data-state="stale"/);
  assert.equal(h.systemUpdates.at(-1).prices[0].status,'stale');
  assert.equal(h.systemUpdates.at(-1).selected,'transport');
  assert.match(h.$('#market-context').innerHTML,/Older weekly/);
  assert.equal(h.chartUpdates.length,chartCount,'age updates must not rebuild the historical chart');
  assert.equal(h.$('#feed').scrollTop,90);
});

test('the app passes weekly request failures through with retained values and dates',()=>{
  const h=harness();h.state.failures.market=true;h.context.renderMarket();
  assert.match(h.$('#market-context').innerHTML,/Update failed.*retained/);
  assert.match(h.$('#market-context').innerHTML,/420\.0/);
  h.state.failures.market=false;h.context.renderMarket();
  assert.doesNotMatch(h.$('#market-context').innerHTML,/Update failed/);
});

test('the app distinguishes pending, failed, empty and retained chart input',()=>{
  const h=harness();h.state.oil=null;h.context.renderOil();
  assert.equal(h.chartUpdates.at(-1)[1].loading,true);
  assert.match(h.$('#oil-summary').innerHTML,/Checking daily/);
  h.state.failures.oil=true;h.context.renderOil();
  assert.equal(h.chartUpdates.at(-1)[1].failed,true);
  assert.equal(h.chartUpdates.at(-1)[1].loading,false);
  assert.match(h.$('#oil-summary').innerHTML,/unavailable/);
  h.state.failures.oil=false;h.state.oil={series:[]};h.context.renderOil();
  assert.equal(h.chartUpdates.at(-1)[1].loading,false);
  assert.equal(h.chartUpdates.at(-1)[1].failed,false);
  assert.match(h.$('#oil-summary').innerHTML,/No daily observations/);
  assert.doesNotMatch(h.$('#oil-summary').innerHTML,/Checking/);
});

test('publication dates never acquire a discovery label or an invented clock precision',()=>{
  const h=harness();
  assert.equal(h.context.reportAge({publishedDate:'2026-10-09',publicationPrecision:'day',discoveredAt:'2026-10-11T12:00:00Z'}),'2026-10-09');
  assert.equal(h.context.reportAge({publishedAt:'2026-10-09T12:00:00Z',discoveredAt:'2026-10-11T12:00:00Z'}),'2d ago');
  assert.equal(h.context.reportAge({discoveredAt:'2026-10-09T12:00:00Z'}),'Discovered 2d ago');
});

test('Energy quote header shares future and missing-observation filtering with the chart',()=>{
 const h=harness();h.state.oil.series[0].observations.push({date:'2026-10-10',value:null},{date:'2026-10-20',value:999});h.context.renderOil();
 assert.match(h.$('#oil-summary').innerHTML,/>100</);assert.match(h.$('#oil-summary').innerHTML,/2026-10-02/);assert.doesNotMatch(h.$('#oil-summary').innerHTML,/999|2026-10-20/);
});
