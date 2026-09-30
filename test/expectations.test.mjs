import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeExpectation,selectExpectations,loadExpectations} from '../lib/expectations.mjs';
import {SourceError} from '../lib/source-runtime.mjs';

const now=Date.parse('2026-09-30T16:00:00Z');
const event={slug:'hormuz-traffic',active:true,closed:false,markets:[]};
const market=(extra={})=>({id:'101',slug:'hormuz-normal-october',question:'Strait of Hormuz traffic returns to normal by October 31?',active:true,closed:false,archived:false,acceptingOrders:true,endDate:'2026-11-01T03:59:00Z',outcomes:'["Yes","No"]',bestBid:0.34,bestAsk:0.40,lastTradePrice:0.39,liquidityNum:20000,volume24hr:1234,updatedAt:'2026-09-30T15:55:00Z',description:'Resolves Yes if traffic meets the specified threshold; see the source rules.',...extra});

test('market contract preserves exact wording, declared resolution deadline, and provider metadata clock',()=>{
 const item=normalizeExpectation(market(),event,now);
 assert.equal(item.question,market().question);assert.equal(item.description,market().description);
 assert.equal(item.url,'https://polymarket.com/event/hormuz-traffic/hormuz-normal-october');
 assert.equal(item.theater,'hormuz');assert.equal(item.topic,'Shipping recovery');
 assert.equal(item.probability,0.37);assert.equal(item.priceBasis,'Gamma order-book midpoint');
 assert.equal(item.endDate,'2026-11-01T03:59:00.000Z');assert.equal(item.updatedAt,'2026-09-30T15:55:00.000Z');
 assert.equal(item.liquidityUsd,20000);assert.equal(item.volume24hUsd,1234);
});
test('wide spreads use the reported last trade, never an invented midpoint or default zero',()=>{
 const wide=normalizeExpectation(market({bestBid:0.1,bestAsk:0.7,lastTradePrice:0.24}),event,now);
 assert.equal(wide.probability,0.24);assert.equal(wide.priceBasis,'Gamma last trade');
 assert.equal(normalizeExpectation(market({bestBid:null,bestAsk:'',lastTradePrice:null}),event,now).probability,null);
 for(const bad of ['',null,true,'NaN',2,-1,Infinity]){
  const result=normalizeExpectation(market({bestBid:bad,bestAsk:bad,lastTradePrice:bad}),event,now);
  assert.equal(result.probability,null);
 }
 const reversed=normalizeExpectation(market({outcomes:'["No","Yes"]'}),event,now);
 assert.equal(reversed,null,'Gamma quote outcome ambiguity must not invert a YES probability silently');
});
test('expired, closed, malformed, nonbinary, illiquid and irrelevant markets do not enter the panel',()=>{
 for(const extra of [
  {closed:true},{archived:true},{active:false},{acceptingOrders:false},{umaResolutionStatus:'resolved'},
  {endDate:'2026-09-29T23:59:00Z'},{endDate:'invalid'},{endDate:'2026-02-30T00:00:00Z'},
  {question:'Strait of Hormuz traffic returns to normal by September 23?'},
  {question:'Strait of Hormuz traffic returns to normal by September 2025?'},
  {outcomes:'["High","Low"]'},{outcomes:'["Yes","No","Maybe"]'},{outcomes:'bad'},
  {liquidityNum:null},{liquidityNum:-1},{liquidityNum:999},{liquidityNum:'NaN'},
  {question:'Will Brent win the football championship?'},{question:'Iran football team wins World Cup?'},
  {slug:'../../unsafe'},
 ])assert.equal(normalizeExpectation(market(extra),event,now),null,JSON.stringify(extra));
 assert.equal(normalizeExpectation(market(),{...event,closed:true},now),null);
 const unknown=normalizeExpectation(market({volume24hr:null,updatedAt:'tomorrow'}),event,now);
 assert.equal(unknown.volume24hUsd,null);assert.equal(unknown.updatedAt,null);
});
test('selection favors distinct shipping and oil scenarios over repeated deadline variants',()=>{
 const items=[
  ...Array.from({length:8},(_,i)=>normalizeExpectation(market({id:String(i),liquidityNum:900000-i}),event,now)),
  normalizeExpectation(market({id:'tanker',question:'Houthis seize an oil tanker by October 31?',slug:'tanker'}),{...event,slug:'tanker-event'},now),
  normalizeExpectation(market({id:'shipping',question:'Houthis successfully target shipping by October 31?',slug:'shipping'}),{...event,slug:'shipping-event'},now),
  normalizeExpectation(market({id:'diplomacy',question:'US-Iran ceasefire by October 31?',slug:'ceasefire'}),{...event,slug:'ceasefire-event'},now),
  normalizeExpectation(market({id:'oil',question:'Iran strikes Saudi oil facilities by October 31?',slug:'oil'}),{...event,slug:'oil-event'},now),
 ];
 const selected=selectExpectations(items);
 assert.equal(selected.length,5);assert.equal(new Set(selected.map(x=>x.topic)).size,5);
 assert.ok(selected.some(x=>x.theater==='bab'));assert.ok(selected.some(x=>x.theater==='hormuz'));
 assert.equal(selectExpectations([items[0],items[0]]).length,1);
});
function runtimeWith(fetchText){return {now:()=>now,get:async(id,interval,loader,context)=>{
 assert.equal(id,'polymarket');assert.equal(interval,60);assert.deepEqual(context,{entryPoint:'expectations'});
 return loader({fetchText});
}};}
test('collector performs bounded public GET discovery and reports source/observation clocks honestly',async()=>{
 const calls=[];
 const result=await loadExpectations(runtimeWith(async input=>{
  const url=new URL(input);calls.push(url);assert.equal(url.origin,'https://gamma-api.polymarket.com');
  assert.equal(url.pathname,'/public-search');assert.equal(url.searchParams.get('events_status'),'active');
  assert.equal(url.searchParams.get('limit_per_type'),'8');
  return JSON.stringify({events:[{...event,markets:[market()]}]});
 }),{entryPoint:'expectations'});
 assert.equal(calls.length,4);assert.equal(result.markets.length,1);assert.equal(result.recordCount,1);
 assert.equal(result.latestPublishedAt,null);assert.equal(result.observationDate,null);
 assert.equal(result.limit,5);assert.match(result.notes.join(' '),/not a confirmed event/);
 assert.match(result.notes.join(' '),/not the time of the last trade/);
});
test('malformed responses and provider failures propagate to runtime caching and backoff',async()=>{
 for(const body of ['not json','{}','[]','{"events":"wrong"}','{"events":[{"markets":[{}]}]}']){
  await assert.rejects(loadExpectations(runtimeWith(async()=>body),{entryPoint:'expectations'}),error=>error.category==='schema');
 }
 await assert.rejects(loadExpectations(runtimeWith(async()=>{throw new SourceError('rate_limit',{status:429});}),{entryPoint:'expectations'}),error=>error.category==='rate_limit');
 const empty=await loadExpectations(runtimeWith(async()=>'{"events":[]}'),{entryPoint:'expectations'});
 assert.equal(empty.recordCount,0);assert.equal(empty.observationDate,null);assert.match(empty.notes.join(' '),/No eligible/);
});
