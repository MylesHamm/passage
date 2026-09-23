import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startLocalServer} from '../lib/local-launch.mjs';

const identity={instanceId:'fixture-passage-folder',version:'review-fixture.1'};
const health=(overrides={})=>({application:'passage-maritime-watch',status:'ready',...identity,...overrides});
function createServer(body={application:'unrelated-fixture'},onRequest=()=>{}) {
  return http.createServer((req,res)=>{
    onRequest(req);
    res.writeHead(200,{'Content-Type':'application/json','Connection':'close'});
    res.end(JSON.stringify(body));
  });
}
function listen(server,port) {
  return new Promise((resolve,reject)=>{
    const clean=()=>{server.off('error',failed);server.off('listening',ready);};
    const failed=error=>{clean();reject(error);};
    const ready=()=>{clean();resolve(server.address().port);};
    server.once('error',failed);server.once('listening',ready);
    server.listen(port,'127.0.0.1');
  });
}
async function close(server) {
  if(!server.listening)return;
  await new Promise((resolve,reject)=>{
    server.close(error=>error?reject(error):resolve());
    server.closeAllConnections();
  });
}
// Reserve adjacent ports until the test releases its intended free slots.
// The OS chooses the first port, avoiding fixed local service assumptions.
async function reserveRange(count) {
  for(let attempt=0;attempt<50;attempt++) {
    const servers=[createServer()];
    try {
      const first=await listen(servers[0],0);
      if(first+count>65536){await close(servers[0]);continue;}
      for(let offset=1;offset<count;offset++) {
        const server=createServer();servers.push(server);await listen(server,first+offset);
      }
      return {first,servers};
    } catch(error) {
      await Promise.all(servers.map(close));
      if(error.code!=='EADDRINUSE')throw error;
    }
  }
  throw new Error('Could not reserve an adjacent port range for launcher fixtures.');
}
async function fixture(t,count=3) {
  const dir=await mkdtemp(path.join(tmpdir(),'passage-local-launch-'));
  const owned=new Set();
  t.after(async()=>{await Promise.all([...owned].map(close));await rm(dir,{recursive:true,force:true});});
  const range=await reserveRange(count);for(const server of range.servers)owned.add(server);
  return {...range,portFile:path.join(dir,'launch.json'),
    server(body=health(),onRequest){const server=createServer(body,onRequest);owned.add(server);return server;},
    async release(offset){await close(range.servers[offset]);},
  };
}
const readHealth=async port=>(await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(2000)})).json();

test('launcher skips an older build and another folder without stopping either',async t=>{
  const f=await fixture(t),old=f.server(health({version:'previous-fixture'})),other=f.server(health({instanceId:'other-folder'}));
  await f.release(0);await listen(old,f.first);await f.release(1);await listen(other,f.first+1);await f.release(2);
  const selected=[],candidate=f.server();
  const result=await startLocalServer({server:candidate,preferredPort:f.first,portFile:f.portFile,identity,maxAttempts:3,onPort:port=>selected.push(port)});
  assert.equal(result.port,f.first+2);assert.equal(result.reused,false);
  assert.equal(result.url,`http://127.0.0.1:${f.first+2}`);assert.equal(selected.at(-1),f.first+2);
  assert.equal((await readHealth(f.first)).version,'previous-fixture');
  assert.equal((await readHealth(f.first+1)).instanceId,'other-folder');
});
test('launcher reuses a matching ready server and sets its origin before probing',async t=>{
  const f=await fixture(t,1);await f.release(0);
  let activePort=null,probeSawCorrectPort=false;
  const existing=f.server(health(),()=>{probeSawCorrectPort=activePort===f.first;});await listen(existing,f.first);
  const candidate=f.server();
  const result=await startLocalServer({server:candidate,preferredPort:f.first,portFile:f.portFile,identity,maxAttempts:1,onPort:port=>{activePort=port;}});
  assert.equal(result.port,f.first);assert.equal(result.reused,true);assert.equal(candidate.listening,false);
  assert.equal(existing.listening,true);assert.equal(probeSawCorrectPort,true);
});
test('a matching identity that is not ready is not reused',async t=>{
  const f=await fixture(t,2);await f.release(0);await f.release(1);
  const existing=f.server(health({status:'starting'}));await listen(existing,f.first);
  const result=await startLocalServer({server:f.server(),preferredPort:f.first,portFile:f.portFile,identity,maxAttempts:2});
  assert.equal(result.port,f.first+1);assert.equal(result.reused,false);assert.equal(existing.listening,true);
});
test('remembered fallback stays stable after the original port becomes free',async t=>{
  const f=await fixture(t,2);await f.release(1);const firstServer=f.server();
  const first=await startLocalServer({server:firstServer,preferredPort:f.first,portFile:f.portFile,identity,maxAttempts:2});
  assert.equal(first.port,f.first+1);
  assert.deepEqual(JSON.parse(await readFile(f.portFile,'utf8')),{preferredPort:f.first,port:f.first+1});
  await f.release(0);await close(firstServer);
  const second=await startLocalServer({server:f.server(),preferredPort:f.first,portFile:f.portFile,identity,maxAttempts:2});
  assert.equal(second.port,f.first+1);assert.equal(second.reused,false);
  const thirdServer=f.server(),third=await startLocalServer({server:thirdServer,preferredPort:f.first,portFile:f.portFile,identity,maxAttempts:2});
  assert.equal(third.port,f.first+1);assert.equal(third.reused,true);assert.equal(thirdServer.listening,false);
});
test('malformed remembered JSON permits startup and sets the origin before listening',async t=>{
  const f=await fixture(t,1);await f.release(0);await writeFile(f.portFile,'{unfinished');
  let activePort=null,portWasSetBeforeListening=false;
  const candidate=f.server();candidate.once('listening',()=>{portWasSetBeforeListening=activePort===candidate.address().port;});
  const result=await startLocalServer({server:candidate,preferredPort:f.first,portFile:f.portFile,identity,maxAttempts:1,onPort:port=>{activePort=port;}});
  assert.equal(result.port,f.first);assert.equal(result.reused,false);assert.equal(portWasSetBeforeListening,true);
});
test('memory from a different configured port is ignored',async t=>{
  const f=await fixture(t,2);await f.release(0);await f.release(1);
  const remembered=f.server();await listen(remembered,f.first+1);
  await writeFile(f.portFile,JSON.stringify({preferredPort:f.first+10,port:f.first+1}));
  const result=await startLocalServer({server:f.server(),preferredPort:f.first,portFile:f.portFile,identity,maxAttempts:2});
  assert.equal(result.port,f.first);assert.equal(result.reused,false);
});
test('invalid remembered port values are ignored',async t=>{
  for(const port of [0,-1,65536,1.5,'4192',null])await t.test(String(port),async child=>{
    const f=await fixture(child,1);await f.release(0);
    await writeFile(f.portFile,JSON.stringify({preferredPort:f.first,port}));
    const result=await startLocalServer({server:f.server(),preferredPort:f.first,portFile:f.portFile,identity,maxAttempts:1});
    assert.equal(result.port,f.first);assert.equal(result.reused,false);
  });
});
test('simultaneous launches converge on one server',async t=>{
  const f=await fixture(t,2);await f.release(0);await f.release(1);
  const servers=[f.server(),f.server()];
  const results=await Promise.all(servers.map(server=>startLocalServer({server,preferredPort:f.first,portFile:f.portFile,identity,maxAttempts:2})));
  assert.deepEqual(results.map(r=>r.port),[f.first,f.first]);assert.equal(results.filter(r=>r.reused).length,1);
  assert.equal(servers.filter(server=>server.listening).length,1);
  assert.deepEqual(JSON.parse(await readFile(f.portFile,'utf8')),{preferredPort:f.first,port:f.first});
});
test('bounded exhaustion keeps existing listeners intact and opens no new server',async t=>{
  const f=await fixture(t),candidate=f.server();
  await assert.rejects(startLocalServer({server:candidate,preferredPort:f.first,portFile:f.portFile,identity,maxAttempts:3}));
  assert.equal(candidate.listening,false);
  for(let offset=0;offset<3;offset++)assert.equal((await readHealth(f.first+offset)).application,'unrelated-fixture');
});
