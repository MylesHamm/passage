import test from 'node:test';
import assert from 'node:assert/strict';
import {pooledFetch} from '../fetch-pool.mjs';

test('outbound slots remain held until response bodies finish or cancel',async()=>{
  let calls=0;const controllers=[];
  const pool=pooledFetch(async()=>{calls++;return new Response(new ReadableStream({start(c){controllers.push(c);c.enqueue(new Uint8Array([65]));}}));},2);
  const [a,b]=await Promise.all([pool('https://a'),pool('https://b')]);
  let third=false;const pending=pool('https://c').then(value=>{third=true;return value;});await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);assert.equal(third,false);
  await a.body.cancel();const c=await pending;assert.equal(calls,3);await b.body.cancel();await c.body.cancel();
});
test('queued abort and upstream failure release capacity without starting expired requests',async()=>{
  let calls=0;const pool=pooledFetch(async url=>{calls++;if(url.endsWith('fail'))throw Error('offline');return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([65]));}}));},1);
  const a=await pool('https://a'),controller=new AbortController();const blocked=pool('https://blocked',{signal:controller.signal});controller.abort();await assert.rejects(blocked);assert.equal(calls,1);await a.body.cancel();
  await assert.rejects(pool('https://fail'));const b=await pool('https://b');assert.equal(calls,3);await b.body.cancel();
});
