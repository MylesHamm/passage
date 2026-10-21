import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadExpectations,normalizeHistory,yesTokenId} from '../lib/expectations.mjs';
import {SourceError} from '../lib/source-runtime.mjs';

// Real trimmed Gamma search and CLOB history captured 2026-10-21; see fixtures/polymarket/provenance.json.
const fixture=name=>readFile(new URL(`./fixtures/polymarket/${name}`,import.meta.url),'utf8');
const search=await fixture('public-search-hormuz.json'),historyBody=await fixture('prices-history.json');
const captured=Date.parse('2026-10-21T14:52:21Z'),HOUR=3600000;
const markets=JSON.parse(search).events.flatMap(event=>event.markets);
const token=id=>JSON.parse(markets.find(market=>market.id===id).clobTokenIds)[0];
const DECEMBER='83783489454659420807679723574840032660002326710045123865554753994450797728825';

// Injected fetch only: Gamma returns the fixture for each query; CLOB answers per token.
function harness(clob,{body=search}={}){
 const clock={now:captured},calls={gamma:0,clob:[]};
 const runtime={now:()=>clock.now,get:async(id,interval,loader)=>{assert.equal(id,'polymarket');return loader({fetchText:async input=>{
  const url=new URL(input);
  if(url.origin==='https://gamma-api.polymarket.com'){calls.gamma++;return body;}
  assert.equal(url.origin,'https://clob.polymarket.com');assert.equal(url.pathname,'/prices-history');
  assert.equal(url.searchParams.get('interval'),'max');assert.equal(url.searchParams.get('fidelity'),'1440');
  const market=url.searchParams.get('market');calls.clob.push(market);return clob(market);
 }});}};
 return {clock,calls,load:()=>loadExpectations(runtime,{entryPoint:'expectations'})};
}
const byId=(result,id)=>result.markets.find(market=>market.id===id);

test('Yes token comes from Gamma clobTokenIds already in the search payload',()=>{
 assert.equal(yesTokenId(markets.find(market=>market.id==='2176270')),DECEMBER);
 for(const clobTokenIds of [undefined,null,'','not json','[]','["1"]','["1","2","3"]','[1,2]','["0x12","3"]','{"0":"1"}',[DECEMBER]])
  assert.equal(yesTokenId({clobTokenIds}),null,JSON.stringify(clobTokenIds));
 assert.equal(yesTokenId({clobTokenIds:['12','34']}),'12');
});

test('history is daily, sorted, bounded, and rejects invalid points without filling gaps',()=>{
 const real=normalizeHistory(JSON.parse(historyBody),captured);
 // 45 real points; the 00:00:37Z and 14:49:27Z points share 21 October, so the later one stays.
 assert.equal(real.length,44);
 assert.deepEqual(real.at(-1),[1792594167,0.115]);assert.ok(!real.some(([t])=>t===1792540837));
 assert.ok(real.every(([t,p],i)=>Number.isInteger(t)&&p>=0&&p<=1&&(i===0||Math.floor(t/86400)>Math.floor(real[i-1][0]/86400))));
 const day=86400,base=1790000000;
 assert.deepEqual(normalizeHistory({history:[
  {t:base+2*day,p:0.3},{t:base,p:0.2},{t:base+day,p:Number.NaN},{t:base+day,p:1.2},{t:base+day,p:-0.01},{t:base+day,p:'0.5'},
  {t:String(base+day),p:0.5},{t:base+day+0.5,p:0.5},{t:base+day,p:Infinity},{t:1000,p:0.5},{t:Math.floor(captured/1000)+3600,p:0.5},null,'x',[base,0.4],
  {t:base+3*day,p:0},{t:base+4*day,p:1},
 ]},captured),[[base,0.2],[base+2*day,0.3],[base+3*day,0],[base+4*day,1]]);
 const long=Array.from({length:450},(_,i)=>({t:base-(449-i)*day,p:0.5}));
 const bounded=normalizeHistory({history:long.toReversed()},captured);
 assert.equal(bounded.length,400);assert.equal(bounded[0][0],long[50].t);assert.equal(bounded.at(-1)[0],base);
 for(const payload of [null,[],{},{history:{}},{history:'[]'},{history:Array(20001).fill({t:base,p:0.5})}])assert.equal(normalizeHistory(payload,captured),null);
 assert.deepEqual(normalizeHistory({history:[]},captured),[]);
});

test('selected markets gain CLOB history from one request each; failures leave only that market without history',async()=>{
 const {calls,load}=harness(async market=>{
  if(market===DECEMBER)return historyBody;
  if(market===token('5645625'))throw new SourceError('upstream_http',{status:500});
  return '{"history":[]}';
 });
 const result=await load();
 assert.equal(calls.gamma,4);assert.deepEqual(calls.clob.toSorted(),[DECEMBER,token('5645625'),token('5645623')].toSorted());
 assert.deepEqual(result.markets.map(market=>market.id),['2176270','5645625','5645623']);
 assert.deepEqual(byId(result,'2176270').history,normalizeHistory(JSON.parse(historyBody),captured));
 assert.equal('history' in byId(result,'5645625'),false,'failed fetch must not invent history');
 assert.equal('history' in byId(result,'5645623'),false,'empty series is not shown as history');
 // Quotes and metadata are unchanged by the history join.
 assert.equal(byId(result,'2176270').probability,0.115);assert.equal(byId(result,'2176270').priceBasis,'Gamma order-book midpoint');
 assert.equal('yesTokenId' in byId(result,'2176270')||'clobTokenIds' in byId(result,'2176270'),false);
 assert.match(result.notes.join(' '),/Odds history is the public CLOB daily price series/);
});

test('history is cached per market for six hours and failed fetches back off for thirty minutes',async()=>{
 const {clock,calls,load}=harness(async market=>{if(market===DECEMBER)return historyBody;throw new SourceError('network');});
 await load();assert.equal(calls.clob.length,3);
 clock.now=captured+10*60000;
 let result=await load();
 assert.equal(calls.clob.length,3,'nothing refetched within the failure backoff or success TTL');
 assert.equal(byId(result,'2176270').history.length,44);assert.equal('history' in byId(result,'5645625'),false);
 clock.now=captured+31*60000;await load();
 assert.deepEqual(calls.clob.slice(3).toSorted(),[token('5645625'),token('5645623')].toSorted(),'only failures retry after 30 minutes');
 clock.now=captured+6*HOUR-1;await load();
 assert.ok(!calls.clob.slice(5).includes(DECEMBER),'successful history is reused until six hours');
 clock.now=captured+6*HOUR;await load();
 assert.ok(calls.clob.slice(5).includes(DECEMBER),'history refreshes after six hours');
});

test('a longer provider Retry-After extends the history backoff',async()=>{
 const {clock,calls,load}=harness(async()=>{throw new SourceError('rate_limit',{status:429,retryAfterMs:2*HOUR});});
 const first=await load();assert.equal(calls.clob.length,3);
 assert.ok(first.markets.every(market=>!('history' in market)));assert.doesNotMatch(first.notes.join(' '),/Odds history/);
 clock.now=captured+HOUR;await load();assert.equal(calls.clob.length,3);
 clock.now=captured+2*HOUR;await load();assert.equal(calls.clob.length,6);
});

test('malformed or invalid history never breaks expectations and never adds points',async()=>{
 for(const body of ['not json','null','[]','{}','{"history":"bad"}','{"history":[{"t":"1792540837","p":0.5},{"t":1792540837,"p":2}]}']) {
  const {calls,load}=harness(async()=>body);
  const result=await load();
  assert.equal(calls.clob.length,3);assert.equal(result.markets.length,3);
  assert.ok(result.markets.every(market=>!('history' in market)),body);
 }
 // A market without a usable Yes token makes no history request at all.
 const tokenless=JSON.stringify({events:JSON.parse(search).events.map(event=>({...event,markets:event.markets.map(({clobTokenIds,...market})=>market)}))});
 const {calls,load}=harness(async()=>historyBody,{body:tokenless});
 const result=await load();
 assert.equal(calls.clob.length,0);assert.equal(result.markets.length,3);assert.ok(result.markets.every(market=>!('history' in market)));
});
