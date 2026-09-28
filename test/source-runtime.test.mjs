import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {SourceRuntime,SourceError,fetchText,retryAfter} from '../lib/source-runtime.mjs';
function fixture(){const files=new Map(),logs=[];let clock=Date.parse('2026-09-13T18:00:00Z');const storage={readFile:async name=>{if(!files.has(name))throw Object.assign(new Error(),{code:'ENOENT'});return files.get(name);},writeFile:async(name,value)=>{files.set(name,value);},mkdir:async()=>{}};const runtime=new SourceRuntime({cacheDir:'/cache',storage,now:()=>clock,log:e=>logs.push(e),historyLimit:8});return {runtime,storage,files,logs,advance:ms=>clock+=ms};}
const data={items:[{title:'public example'}],recordCount:1,latest:'2026-09-13T17:00:00Z'};
test('HTTP failures have safe distinct categories and honor retry metadata',async()=>{
 for(const [status,category] of [[401,'auth'],[403,'auth'],[429,'rate_limit'],[503,'upstream_http']])await assert.rejects(fetchText('https://provider.test/?api_key=SECRET',{fetchImpl:async()=>new Response('SECRET',{status,headers:{'retry-after':'120'}})}),e=>e.category===category&&e.retryAfterMs===120000&&!e.message.includes('SECRET'));
 for(const [name,category] of [['TimeoutError','timeout'],['TypeError','network']])await assert.rejects(fetchText('https://provider.test',{fetchImpl:async()=>{throw Object.assign(new Error('SECRET'),{name});}}),e=>e.category===category);
});
test('Retry-After supports seconds and HTTP dates, rejecting invalid values',()=>{const now=Date.parse('2026-09-13T18:00:00Z');assert.equal(retryAfter('120',now),120000);assert.equal(retryAfter('Sun, 13 Sep 2026 18:02:00 GMT',now),120000);assert.equal(retryAfter('bad',now),null);});
test('upstream body size is bounded while streaming and correlation is forwarded',async()=>{
 const op=randomUUID();let headers;await assert.rejects(fetchText('https://provider.test',{maxBytes:4,operationId:op,fetchImpl:async(u,o)=>{headers=o.headers;return new Response('12345');}}),e=>e.category==='schema');assert.equal(headers['X-Request-ID'],op);
});
test('coalesced requests create one upstream operation with both request IDs',async()=>{
 const {runtime,logs}=fixture();let resolve,entered;const ready=new Promise(r=>entered=r),block=new Promise(r=>resolve=r);const a=randomUUID(),b=randomUUID();let count=0;
 const first=runtime.get('bbc',300,async()=>{count++;entered();await block;return data;},{requestId:a,entryPoint:'news'});await ready;
 const second=runtime.get('bbc',300,async()=>{throw Error('must not run');},{requestId:b,entryPoint:'news'});resolve();assert.deepEqual(await first,await second);assert.equal(count,1);
 const start=logs.find(e=>e.event==='source_started'),joined=logs.find(e=>e.event==='source_joined');assert.equal(joined.operationId,start.operationId);assert.equal(start.requestId,a);assert.equal(joined.requestId,b);
});
test('cache persistence failure preserves valid new data and separate storage diagnosis',async()=>{
 const {runtime,storage,logs}=fixture();storage.writeFile=async()=>{throw new Error('SECRET full path');};const value=await runtime.get('bbc',300,async()=>data);assert.equal(value.connection,'connected');assert.equal(value.items.length,1);assert.equal(value.error,null);assert.match(value.cacheIssue,/Local cache/);assert.ok(logs.some(e=>e.event==='cache_failed'));assert.ok(!JSON.stringify(runtime.snapshot()).includes('SECRET'));
});
test('a failed atomic cache replacement preserves the previous on-disk snapshot',async()=>{
 const {runtime,storage,files,advance}=fixture();await runtime.get('bbc',1,async()=>data);const original=files.get('/cache/bbc.json');
 storage.rename=async()=>{throw Error('Disk replacement failed');};storage.rm=async file=>files.delete(file);advance(1000);
 const result=await runtime.get('bbc',1,async()=>({...data,recordCount:2}));assert.equal(result.recordCount,2);assert.match(result.cacheIssue,/Local cache/);assert.equal(files.get('/cache/bbc.json'),original);assert.equal(files.size,1);
});
test('warm failure keeps original success, waits Retry-After, then records recovery',async()=>{
 const {runtime,advance}=fixture();const first=await runtime.get('bbc',1,async()=>data);advance(1100);
 const failed=await runtime.get('bbc',1,async()=>{throw new SourceError('rate_limit',{status:429,retryAfterMs:120000});});assert.equal(failed.connection,'cached');assert.equal(failed.retrievedAt,first.retrievedAt);advance(60000);
 let calls=0;assert.equal((await runtime.get('bbc',1,async()=>{calls++;return data;})).connection,'cached');assert.equal(calls,0);advance(60000);
 assert.equal((await runtime.get('bbc',1,async()=>data)).connection,'connected');const m=runtime.snapshot().metrics[0];assert.equal(m.attempts,3);assert.equal(m.successes,2);assert.equal(m.outcomes.rate_limit,1);assert.equal(m.duration.count,3);
});
test('cold schema failure is safe and history and metric labels stay bounded',async()=>{
 const {runtime,advance}=fixture();for(let i=0;i<15;i++){await runtime.get('bbc',1,async()=>{throw Error('SECRET URL payload');});advance(900000);}
 const d=runtime.snapshot();assert.equal(d.events.length,8);assert.equal(d.metrics[0].outcomes.schema,15);assert.ok(!JSON.stringify(d).includes('SECRET'));assert.equal(d.metrics.length,1);await assert.rejects(runtime.get('arbitrary-user-id',1,async()=>data));
});
test('disk warm start retains a valid success when upstream fails',async()=>{
 const {runtime,files}=fixture();files.set('/cache/bbc.json',JSON.stringify({...data,checkedAt:'2026-09-01T00:00:00Z',retrievedAt:'2026-09-01T00:00:00Z'}));const d=await runtime.get('bbc',300,async()=>{throw new SourceError('network');});assert.equal(d.connection,'cached');assert.equal(d.recordCount,1);assert.equal(d.retrievedAt,'2026-09-01T00:00:00Z');
});
test('repeated failures back off, persist their retry deadline, and reset after recovery',async()=>{
 const {runtime,storage,files,advance}=fixture();let calls=0;
 const fail=async()=>{calls++;throw new SourceError('network');};
 const first=await runtime.get('bbc',300,fail);assert.equal(first.consecutiveFailures,1);
 advance(60000);const second=await runtime.get('bbc',300,fail);assert.equal(second.consecutiveFailures,2);assert.equal(Date.parse(second.nextRetryAt)-runtime.now(),120000);
 const restarted=new SourceRuntime({cacheDir:'/cache',storage,now:runtime.now});
 advance(60000);const retained=await restarted.get('bbc',300,fail);assert.equal(calls,2);assert.equal(retained.connection,'unavailable');assert.equal(retained.nextRetryAt,second.nextRetryAt);
 advance(60000);const recovered=await restarted.get('bbc',300,async()=>data);assert.equal(recovered.consecutiveFailures,0);assert.equal(recovered.error,null);
 assert.equal(JSON.parse(files.get('/cache/bbc.json')).error,null);
});
test('a source retry policy sets a longer floor without shortening Retry-After',async()=>{
 const {runtime,advance}=fixture(),policy={retryBaseMs:300000,retryMaxMs:3600000};
 const first=await runtime.get('gdelt-hormuz',900,async()=>{throw new SourceError('rate_limit',{status:429,retryAfterMs:30000});},{},'gdelt-hormuz-metadata',policy);
 assert.equal(Date.parse(first.nextRetryAt)-runtime.now(),300000);
 advance(300000);const second=await runtime.get('gdelt-hormuz',900,async()=>{throw new SourceError('rate_limit',{status:429,retryAfterMs:7200000});},{},'gdelt-hormuz-metadata',policy);
 assert.equal(Date.parse(second.nextRetryAt)-runtime.now(),7200000);
});
test('failed refresh persists retained records without advancing their successful retrieval clock',async()=>{
 const {runtime,storage,advance}=fixture();const original=await runtime.get('bbc',1,async()=>data);advance(1000);
 const failed=await runtime.get('bbc',1,async()=>{throw new SourceError('network');});
 let requests=0;const restarted=new SourceRuntime({cacheDir:'/cache',storage,now:runtime.now});const result=await restarted.get('bbc',1,async()=>{requests++;throw Error('must use the saved retry deadline');});assert.equal(requests,0);
 assert.equal(result.retrievedAt,original.retrievedAt);assert.equal(result.checkedAt,failed.checkedAt);assert.equal(result.connection,'cached');assert.deepEqual(result.items,data.items);
});
test('request histograms use bounded entry points and never accept arbitrary text',()=>{
 const {runtime}=fixture();runtime.event('request_finished',null,{entryPoint:'news',requestId:randomUUID()},{durationMs:150,httpStatus:500});runtime.event('request_finished',null,{entryPoint:'SECRET URL'},{durationMs:40,httpStatus:200});const d=runtime.snapshot();assert.equal(d.requests.find(x=>x.entryPoint==='news').errors,1);assert.equal(d.requests.find(x=>x.entryPoint==='news').bucketCounts[1],1);assert.ok(!JSON.stringify(d).includes('SECRET'));assert.ok(d.requests.some(x=>x.entryPoint==='background'));
});
test('registered digit-bearing publisher IDs persist and restore their own cache',async()=>{
 const {runtime,storage,files}=fixture();
 const original=await runtime.get('france24',300,async()=>data);
 assert.equal(original.connection,'connected');assert.ok(files.has('/cache/france24.json'));
 const restarted=new SourceRuntime({cacheDir:'/cache',storage,now:runtime.now});
 const restored=await restarted.restore('france24');
 assert.deepEqual(restored.value.items,data.items);assert.equal(restored.value.retrievedAt,original.retrievedAt);
 let requests=0;const cached=await restarted.get('france24',300,async()=>{requests++;return data;});
 assert.equal(requests,0);assert.equal(cached.retrievedAt,original.retrievedAt);
});
test('digit-bearing cache support still rejects path traversal and unknown source IDs',async()=>{
 const {runtime,files}=fixture();
 for(const key of ['../france24','france24/child','/tmp/france24','france24.json','france24%2f..','france24\\child']){
  await assert.rejects(runtime.get('france24',300,async()=>data,{},key),/Invalid cache key/);
  await assert.rejects(runtime.restore('france24',key),/Invalid cache key/);
 }
 await assert.rejects(runtime.get('unknown24',300,async()=>data),/Unknown source ID/);
 await assert.rejects(runtime.restore('unknown24'),/Unknown source ID/);
 assert.equal(files.size,0);
});
