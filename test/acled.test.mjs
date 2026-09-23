import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {AcledConnection,parseAcledSample,parseAcledEvents,isLocalMutation,readLocalJson} from '../lib/acled.mjs';
import {SourceRuntime} from '../lib/source-runtime.mjs';
import {sourceHealth} from '../dist/source-health.mjs';

const NOW=Date.parse('2026-09-13T18:00:00Z');
const row=country=>({event_id_cnty:country+'001',country,event_date:'2026-09-01',event_type:'Battles',sub_event_type:'Armed clash',actor1:'Fixture actor',actor2:'',source:'Fixture source',time_precision:'2',civilian_targeting:'',unexpected_secret:'must-not-survive'});
const sample=country=>({success:true,data:[row(country)]});
const token=(suffix='one')=>({access_token:'fake-access-'+suffix,refresh_token:'fake-refresh-'+suffix,expires_in:86400});
const response=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers});
async function fixture(t,replies){
  const root=await mkdtemp(path.join(os.tmpdir(),'passage-acled-test-'));t.after(()=>rm(root,{recursive:true,force:true}));let now=NOW;
  const calls=[],events=[];const runtime=new SourceRuntime({cacheDir:path.join(root,'.cache'),now:()=>now,log:e=>events.push(e)});
  const connection=new AcledConnection({root,runtime,now:()=>now,fetchImpl:async(url,options)=>{calls.push({url:String(url),options});const reply=replies.shift();if(reply instanceof Error)throw reply;if(!reply)throw Error('Missing test response');return reply;}});
  await connection.initialize();return {root,connection,runtime,calls,events,advance:ms=>{now+=ms;}};
}
test('no configured account makes no upstream requests and writes no files',async t=>{
  const f=await fixture(t,[]);const result=await f.connection.check();assert.equal(f.connection.configured,false);assert.equal(result.connection,'not configured');assert.equal(f.calls.length,0);
});
test('documented OAuth handshake verifies samples before saving only private tokens',async t=>{
  const f=await fixture(t,[response(token()),response(sample('Yemen')),response(sample('Iran'))]);
  const result=await f.connection.connect('fixture@example.test','private-fixture-password',{requestId:'12345678-1234-1234-1234-123456789012',entryPoint:'acled-connect'});
  assert.equal(result.recordCount,2);assert.equal(result.newestSampleEventDate,'2026-09-01');assert.equal(result.sampleOnly,true);
  assert.equal(f.calls[0].url,'https://acleddata.com/oauth/token');assert.equal(f.calls[0].options.body.get('grant_type'),'password');assert.equal(f.calls[0].options.body.get('scope'),'authenticated');assert.equal(f.calls[0].options.redirect,'error');
  assert.equal(new URL(f.calls[1].url).searchParams.get('limit'),'5');assert.equal(f.calls[1].options.headers.Authorization,'Bearer fake-access-one');
  const saved=await readFile(f.connection.file,'utf8');assert.deepEqual(Object.keys(JSON.parse(saved)).sort(),['accessToken','expiresAt','refreshToken']);assert.equal((await stat(f.connection.file)).mode&0o777,0o600);assert.equal((await stat(f.connection.dir)).mode&0o777,0o700);
  const cache=await readFile(f.connection.cache,'utf8');const diagnostics=JSON.stringify(f.runtime.snapshot());
  for(const secret of ['private-fixture-password','fixture@example.test','fake-access-one','fake-refresh-one','must-not-survive']){assert.ok(!cache.includes(secret));assert.ok(!diagnostics.includes(secret));}
  assert.ok(!saved.includes('private-fixture-password'));assert.ok(f.events.some(e=>e.entryPoint==='acled-connect'&&e.requestId));
  await f.connection.check();assert.equal(f.calls.length,3,'hourly checks reuse the sample');
});
test('failed login does not store credentials and upstream messages are sanitized',async t=>{
  const f=await fixture(t,[response({error:'invalid_grant',message:'echo-private-password'},400)]);
  await assert.rejects(f.connection.connect('fixture@example.test','private-password'),e=>e.category==='auth'&&!e.message.includes('echo'));
  assert.equal(f.connection.configured,false);await assert.rejects(stat(f.connection.file),e=>e.code==='ENOENT');assert.ok(!JSON.stringify(f.events).includes('password'));
});
test('token success plus denied event access does not create a connected account',async t=>{
  const f=await fixture(t,[response(token()),response({error:'Access denied'},403)]);
  await assert.rejects(f.connection.connect('fixture@example.test','password'),e=>e.category==='auth'&&e.status===403);assert.equal(f.connection.configured,false);
});
test('empty successful data verifies access without claiming conflict is absent',async t=>{
  const f=await fixture(t,[response(token()),response({success:true,data:[]}),response({success:true,data:[]})]);
  const result=await f.connection.connect('fixture@example.test','password');assert.equal(result.recordCount,0);assert.equal(f.connection.configured,true);
  const health=sourceHealth({...result,group:'acled',configured:true},NOW);assert.equal(health.label,'Access verified · empty sample');
});
test('expired access token is refreshed without needing the password',async t=>{
  const f=await fixture(t,[response(token()),response(sample('Yemen')),response(sample('Iran')),response(token('two')),response(sample('Yemen')),response(sample('Iran'))]);
  await f.connection.connect('fixture@example.test','password');f.advance(86400000);await f.connection.check();
  assert.equal(f.calls[3].options.body.get('grant_type'),'refresh_token');assert.equal(f.calls[3].options.body.has('password'),false);assert.equal(f.calls[4].options.headers.Authorization,'Bearer fake-access-two');
});
test('401 retries once with refresh; failed updates retain timestamped sample',async t=>{
  const f=await fixture(t,[response(token()),response(sample('Yemen')),response(sample('Iran')),response({},401),response(token('two')),response({},401)]);
  const original=await f.connection.connect('fixture@example.test','password');f.advance(3600001);const result=await f.connection.check();
  assert.equal(result.connection,'cached');assert.equal(result.errorCategory,'auth');assert.equal(result.retrievedAt,original.retrievedAt);assert.equal(result.recordCount,2);assert.equal(f.calls.length,6);
  assert.match(sourceHealth({...result,configured:true,group:'acled'}).label,/Cached data/);
});
test('rate limits delay another login and provider checks honor retry-after',async t=>{
  const f=await fixture(t,[response({},429,{'Retry-After':'120'})]);await assert.rejects(f.connection.connect('fixture@example.test','password'),e=>e.category==='rate_limit'&&e.retryAfterMs===120000);
  f.advance(16000);await assert.rejects(f.connection.connect('fixture@example.test','password'),e=>e.category==='rate_limit');assert.equal(f.calls.length,1);
});
test('disconnect removes saved session, cached sample and in-memory sample',async t=>{
  const f=await fixture(t,[response(token()),response(sample('Yemen')),response(sample('Iran'))]);await f.connection.connect('fixture@example.test','password');await f.connection.disconnect();
  assert.equal(f.connection.configured,false);assert.equal(f.runtime.peek('acled'),undefined);for(const file of [f.connection.file,f.connection.cache])await assert.rejects(stat(file),e=>e.code==='ENOENT');assert.equal((await f.connection.check()).countries.length,0);
});
test('session can be loaded after restart and malformed private state is visible',async t=>{
  const f=await fixture(t,[response(token()),response(sample('Yemen')),response(sample('Iran'))]);await f.connection.connect('fixture@example.test','password');
  const restarted=new AcledConnection({root:f.root,runtime:f.runtime,now:()=>NOW});await restarted.initialize();assert.equal(restarted.configured,true);
  await writeFile(f.connection.file,'invalid');const broken=new AcledConnection({root:f.root,runtime:f.runtime});await broken.initialize();assert.equal(broken.configured,false);assert.equal((await broken.check()).storageIssue,true);
});
test('schema checks reject impossible or future dates and mixed country data',()=>{
  for(const record of [{...row('Yemen'),event_date:'2026-02-31'},{...row('Yemen'),event_date:'2099-01-01'},row('Iran')])assert.throws(()=>parseAcledSample({success:true,data:[record]},'Yemen',NOW));
  assert.throws(()=>parseAcledSample({success:false,data:[]},'Yemen',NOW));assert.equal(parseAcledSample(sample('Yemen'),'Yemen',NOW).records[0].time_precision,2);
});
test('structured event parser preserves event and source clocks with contextual theatre scope',()=>{
  const parsed=parseAcledEvents({success:true,data:[{event_id_cnty:'YEM001',country:'Yemen',event_date:'2026-09-01',timestamp:'1788223200',event_type:'Battles',sub_event_type:'Armed clash',actor1:'Houthi forces',actor2:'United States Navy',civilian_targeting:'Civilian targeting',latitude:'14.79',longitude:'42.94',geo_precision:'2',time_precision:'1',location:'Hodeidah',fatalities:'',notes:'Fixture note'}]},'Yemen',NOW);
  assert.equal(parsed.length,1);assert.equal(parsed[0].eventDate,'2026-09-01');assert.equal(parsed[0].publishedAtBasis,'event_date');assert.equal(parsed[0].updatedAt,'2026-09-01T00:40:00.000Z');assert.deepEqual(parsed[0].theaters,['bab']);assert.equal(parsed[0].theaterBasis,'country scope · not maritime geocoding');assert.deepEqual(parsed[0].actors,['Houthis','U.S. military','Civilians']);assert.equal(parsed[0].fatalities,null);
});
test('structured event parser rejects invalid coordinates, precision and future records',()=>{
  const base={event_id_cnty:'IRN001',country:'Iran',event_date:'2026-09-01',latitude:'0',longitude:'0',geo_precision:'1',time_precision:'1'};
  for(const change of [{latitude:'91'},{geo_precision:'4'},{event_date:'2099-01-01'}])assert.throws(()=>parseAcledEvents({success:true,data:[{...base,...change}]},'Iran',NOW));
});
test('event retrieval uses documented country/date filters and cursor pagination',async t=>{
  const pages=[response({success:true,data:[{...row('Yemen'),event_id_cnty:'YEM001',latitude:'14',longitude:'43',geo_precision:'1',time_precision:'1'}],next_cursor:'next',total_count:2}),response({success:true,data:[{...row('Yemen'),event_id_cnty:'YEM002',latitude:'15',longitude:'44',geo_precision:'1',time_precision:'1'}]}),response({success:true,data:[]}),response({success:true,data:[]})];
  const f=await fixture(t,pages);f.connection.tokens={accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:NOW+86400000};const result=await f.connection.events({from:'2026-08-01',to:'2026-09-13',limit:2,context:{entryPoint:'acled-events'}});
  assert.equal(result.events.length,2);assert.equal(f.calls.length,3);const first=new URL(f.calls[0].url);assert.equal(first.searchParams.get('country'),'Yemen');assert.equal(first.searchParams.get('event_date'),'2026-08-01|2026-09-13');assert.equal(first.searchParams.get('event_date_where'),'BETWEEN');assert.equal(first.searchParams.get('with_total'),'true');assert.equal(first.searchParams.get('cursor'),'0');assert.equal(new URL(f.calls[1].url).searchParams.get('cursor'),'next');
});
test('structured events refresh an expired session before querying and save only renewed tokens',async t=>{
  const f=await fixture(t,[response(token('renewed')),response(sample('Yemen')),response(sample('Iran'))]);
  f.connection.tokens={accessToken:'expired-fixture',refreshToken:'fixture-refresh',expiresAt:NOW};
  const result=await f.connection.events({from:'2026-08-01',to:'2026-09-13'});
  assert.equal(result.recordCount,2);assert.equal(result.connection,'connected');
  assert.equal(f.calls[0].options.body.get('grant_type'),'refresh_token');assert.equal(f.calls[0].options.body.has('password'),false);
  assert.equal(f.calls[1].options.headers.Authorization,'Bearer fake-access-renewed');
  const saved=JSON.parse(await readFile(f.connection.file,'utf8'));assert.equal(saved.accessToken,'fake-access-renewed');
  const publicData=JSON.stringify([result,f.connection.snapshot(),f.runtime.snapshot()]);
  for(const secret of ['expired-fixture','fixture-refresh','fake-access-renewed','fake-refresh-renewed','must-not-survive'])assert.ok(!publicData.includes(secret));
});
test('structured events recover from one 401 and expose repeated rejection in diagnostics',async t=>{
  const f=await fixture(t,[response({},401),response(token('renewed')),response({},401)]);
  f.connection.tokens={accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:NOW+86400000};
  await assert.rejects(f.connection.events(),e=>e.category==='auth'&&e.status===401);
  assert.equal(f.calls.length,3,'one refresh and one retry, with no unbounded loop');
  const state=f.connection.snapshot();assert.equal(state.connection,'unavailable');assert.equal(state.errorCategory,'auth');assert.equal(state.httpStatus,401);assert.equal(state.recordCount,0);
  assert.equal(sourceHealth({...state,group:'acled',configured:true}).status,'unavailable');
});
test('structured events retry a rejected token once and then return the requested countries',async t=>{
  const f=await fixture(t,[response({},401),response(token('renewed')),response(sample('Yemen')),response(sample('Iran'))]);
  f.connection.tokens={accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:NOW+86400000};
  const result=await f.connection.events({from:'2026-08-01',to:'2026-09-13'});
  assert.deepEqual(result.countries.map(c=>c.country),['Yemen','Iran']);assert.equal(result.recordCount,2);
  assert.equal(f.calls.length,4);assert.equal(f.calls[2].options.headers.Authorization,'Bearer fake-access-renewed');
});
test('structured events do not refresh on forbidden access or retry a newly refreshed rejected token',async t=>{
  for(const expired of [false,true]){
    const replies=expired?[response(token('renewed')),response({},401)]:[response({},403)];
    const f=await fixture(t,replies);f.connection.tokens={accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:expired?NOW:NOW+86400000};
    await assert.rejects(f.connection.events(),e=>e.category==='auth');assert.equal(f.calls.length,expired?2:1);
  }
});
test('structured event cache uses its ISO clock and the injected clock for the 15-minute TTL',async t=>{
  const f=await fixture(t,[response(sample('Yemen')),response(sample('Iran')),response({success:true,data:[]}),response({success:true,data:[]})]);
  f.connection.tokens={accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:NOW+86400000};
  const query={from:'2026-08-01',to:'2026-09-13',limit:2},first=await f.connection.events(query);
  f.advance(899999);const cached=await f.connection.events(query);assert.equal(cached.recordCount,2);assert.equal(cached.retrievedAt,first.retrievedAt);assert.equal(f.calls.length,2);
  f.advance(1);const updated=await f.connection.events(query);assert.equal(updated.recordCount,0);assert.equal(f.calls.length,4);assert.notEqual(updated.retrievedAt,first.retrievedAt);
});
test('structured event cache is scoped by date range and requested record limit',async t=>{
  const f=await fixture(t,Array.from({length:6},()=>response({success:true,data:[]})));
  f.connection.tokens={accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:NOW+86400000};
  await f.connection.events({from:'2026-08-01',to:'2026-09-13',limit:1});
  await f.connection.events({from:'2026-08-01',to:'2026-09-13',limit:2});
  await f.connection.events({from:'2026-09-01',to:'2026-09-13',limit:2});
  assert.equal(f.calls.length,6);
});
test('event diagnostics retain the last retrieval on failure and omit event payloads',async t=>{
  const f=await fixture(t,[response(sample('Yemen')),response(sample('Iran')),response({},503)]);
  f.connection.tokens={accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:NOW+86400000};
  const query={from:'2026-08-01',to:'2026-09-13'},original=await f.connection.events(query);
  let state=f.connection.snapshot();assert.equal(state.sampleOnly,false);assert.equal(state.latest,'2026-09-01');assert.equal(state.recordCount,2);assert.equal(state.events,undefined);assert.equal(state.countries,undefined);
  f.advance(900000);const retained=await f.connection.events(query);state=f.connection.snapshot();
  assert.equal(retained.connection,'cached');assert.equal(state.connection,'cached');assert.equal(state.retrievedAt,original.retrievedAt);assert.equal(state.errorCategory,'upstream_http');assert.equal(state.httpStatus,503);
  assert.equal(sourceHealth({...state,group:'acled',configured:true}).status,'retained');
});
test('a failed query never reuses events from a different date range',async t=>{
  const f=await fixture(t,[response(sample('Yemen')),response(sample('Iran')),response({},503)]);
  f.connection.tokens={accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:NOW+86400000};
  await f.connection.events({from:'2026-08-01',to:'2026-09-13'});
  await assert.rejects(f.connection.events({from:'2026-09-10',to:'2026-09-13'}),e=>e.status===503);
  const state=f.connection.snapshot();assert.equal(state.connection,'unavailable');assert.equal(state.recordCount,0);assert.equal(state.from,'2026-09-10');assert.equal(state.retrievedAt,null);
});
test('a bounded event page can exceed the small account-response cap without dropping valid records',async t=>{
  const records=Array.from({length:350},(_,i)=>({...row('Yemen'),event_id_cnty:'YEM'+i,notes:'Fixture context '.repeat(70)}));
  const payload={success:true,data:records,next_cursor:null,total_count:350};assert.ok(Buffer.byteLength(JSON.stringify(payload))>300000);
  const f=await fixture(t,[response(payload),response({success:true,data:[]})]);
  f.connection.tokens={accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:NOW+86400000};
  const result=await f.connection.events({from:'2026-08-01',to:'2026-09-13'});assert.equal(result.recordCount,350);assert.equal(result.truncated,false);
});
test('event pages still enforce a streaming size bound while account replies retain their smaller cap',async t=>{
  const f=await fixture(t,[response({data:'x'.repeat(4000001)})]);f.connection.tokens={accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:NOW+86400000};
  await assert.rejects(f.connection.events(),e=>e.category==='schema');assert.equal(f.connection.snapshot().connection,'unavailable');
  const small=await fixture(t,[response({data:'x'.repeat(300001)})]);await assert.rejects(small.connection.connect('fixture@example.test','password'),e=>e.category==='schema');assert.equal(small.connection.configured,false);
});
test('country totals repeated on every ACLED page are counted once per country',async t=>{
 const f=await fixture(t,[response({success:true,data:[{...row('Yemen'),event_id_cnty:'Y1'}],next_cursor:'next',total_count:2}),response({success:true,data:[{...row('Yemen'),event_id_cnty:'Y2'}],next_cursor:null,total_count:2}),response({success:true,data:[row('Iran')],next_cursor:null,total_count:1})]);
 f.connection.tokens={accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:NOW+86400000};
 const result=await f.connection.events({from:'2026-08-01',to:'2026-09-13',limit:2});assert.equal(result.recordCount,3);assert.equal(result.totalCount,3);
});
test('mutating routes reject cross-origin, form-encoded, missing-origin and wrong-port requests',()=>{
  const headers={host:'127.0.0.1:4189',origin:'http://127.0.0.1:4189','content-type':'application/json'};assert.equal(isLocalMutation({headers},4189),true);
  for(const changes of [{origin:'https://evil.example'},{origin:undefined},{'content-type':'application/x-www-form-urlencoded'},{host:'127.0.0.1:4190'}])assert.equal(!!isLocalMutation({headers:{...headers,...changes}},4189),false);
});
test('local request bodies have a small size bound',async()=>{
  assert.deepEqual(await readLocalJson(Readable.from([Buffer.from('{"email":"a"}')])),{email:'a'});await assert.rejects(readLocalJson(Readable.from([Buffer.alloc(8193)])));
});
