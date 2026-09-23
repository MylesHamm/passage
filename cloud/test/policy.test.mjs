import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredOrigin,handlePublic,json} from '../policy.mjs';

const origin='https://example.github.io',env={ALLOWED_ORIGIN:origin};
const request=(path='/api/config',options={})=>new Request('https://passage.example'+path,{headers:{Origin:origin,...options.headers},...options});
test('origin is an exact canonical HTTPS origin, not a wildcard, suffix, path or credential URL',async()=>{
  for(const value of ['*','null','http://example.github.io',origin+'/',origin+'/passage','https://user:pass@example.github.io',origin+'?x=1'])assert.equal(configuredOrigin(value),null);
  for(const bad of [origin+'.evil.test','https://other.github.io','null']){let forwards=0;const response=await handlePublic(request('/api/config',{headers:{Origin:bad}}),env,()=>{forwards++;});assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal(forwards,0);}
});
test('fixed public GET routes reject credential mutation, arbitrary proxy and variable query inputs',async()=>{
  for(const path of ['/_collect','/api/acled/connect','/api/acled/disconnect','/api/proxy?url=https://example.com','/api/news?url=https://example.com','/api/acled/events?days=90&days=365','/api/acled/events?days=all']){
    let calls=0;assert.equal((await handlePublic(request(path),env,()=>{calls++;})).status,404);assert.equal(calls,0);
  }
  assert.equal((await handlePublic(request('/api/news',{method:'POST'}),env,()=>{})).status,405);
});
test('forwarding drops incoming credentials/headers and CORS never enables cookies',async()=>{
  const result=await handlePublic(request('/api/acled/events?days=90',{headers:{Origin:origin,Authorization:'Bearer secret',Cookie:'private=session'}}),env,internal=>{
    assert.equal(internal.url,'https://collector.internal/api/acled/events?days=90');assert.equal([...internal.headers].length,0);return json({configured:false});
  });
  assert.equal(result.status,200);assert.equal(result.headers.get('access-control-allow-origin'),origin);assert.equal(result.headers.get('access-control-allow-credentials'),null);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(result.headers.get('x-content-type-options'),'nosniff');
});
test('preflight permits only a simple GET from configured origin; no-origin public requests remain read-only',async()=>{
  const good=await handlePublic(request('/api/news',{method:'OPTIONS',headers:{Origin:origin,'access-control-request-method':'GET'}}),env,()=>assert.fail());assert.equal(good.status,204);
  const bad=await handlePublic(request('/api/news',{method:'OPTIONS',headers:{Origin:origin,'access-control-request-method':'GET','access-control-request-headers':'authorization'}}),env,()=>assert.fail());assert.equal(bad.status,403);
  const direct=await handlePublic(new Request('https://api.example/api/config'),env,()=>json({}));assert.equal(direct.status,200);assert.equal(direct.headers.get('access-control-allow-origin'),null);
});
test('unconfigured origin and upstream failures are generic and do not leak errors',async()=>{
  assert.equal((await handlePublic(request(),{},()=>assert.fail())).status,503);
  const response=await handlePublic(request(),env,()=>{throw new Error('EIA_API_KEY=secret internal stack');});assert.equal(response.status,503);assert.ok(!(await response.text()).includes('secret'));assert.equal(response.headers.get('retry-after'),'30');
});
