import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteFiles,FILE_LIMIT} from '../sqlite-files.mjs';
import {sourceStorage} from '../source-storage.mjs';
import {SourceRuntime,SourceError} from '../../lib/source-runtime.mjs';
import {ReportArchive} from '../../lib/report-archive.mjs';
import {sqliteState} from './helpers.mjs';

test('SQLite files preserve multi-megabyte UTF-8 data in bounded chunks and atomically replace a target',async()=>{
  const state=sqliteState(),files=new SqliteFiles(state.storage),value='🚢'.repeat(700_000);
  await files.writeFile('/cache/source.json',value);
  assert.equal(await files.readFile('/cache/source.json','utf8'),value);
  const chunks=[...state.storage.sql.exec('SELECT length(data) AS size FROM passage_chunks')];
  assert.ok(chunks.length>8);assert.ok(chunks.every(row=>row.size<=256*1024));
  await assert.rejects(files.writeFile('/cache/source.json','bad',{flag:'wx'}),{code:'EEXIST'});
  await files.writeFile('/cache/new.tmp','new');
  state.fail=query=>query.startsWith('UPDATE passage_files');
  await assert.rejects(files.rename('/cache/new.tmp','/cache/source.json'));
  state.fail=null;
  assert.equal(await files.readFile('/cache/source.json','utf8'),value);
  await files.rename('/cache/new.tmp','/cache/source.json');
  assert.equal(await files.readFile('/cache/source.json','utf8'),'new');
  await assert.rejects(files.readFile('/cache/new.tmp'),{code:'ENOENT'});
  assert.equal(files.usage().logicalBytes,3);state.db.close();
});

test('SQLite adapter rejects path escape and oversize files and cleans unfinished temp files on restart',async()=>{
  const state=sqliteState(),files=new SqliteFiles(state.storage);
  await assert.rejects(files.writeFile('/cache/../secrets','x'),{code:'EINVAL'});
  await assert.rejects(files.writeFile('/cache/a.json',Buffer.alloc(FILE_LIMIT+1)),{code:'EFBIG'});
  await files.writeFile('/cache/orphan.tmp','x');await files.writeFile('/cache/saved.json','saved');
  const restarted=new SqliteFiles(state.storage);
  await assert.rejects(restarted.readFile('/cache/orphan.tmp'),{code:'ENOENT'});
  assert.equal(await restarted.readFile('/cache/saved.json','utf8'),'saved');state.db.close();
});

test('real SourceRuntime restores provider Retry-After and original data across SQLite restart',async()=>{
  let now=Date.parse('2026-09-23T00:00:00Z');const state=sqliteState(),files=new SqliteFiles(state.storage);
  const runtime=new SourceRuntime({cacheDir:'/cache',storage:files,now:()=>now});
  await runtime.get('brent',1,async()=>({observations:[{date:'2026-09-22',value:70}],recordCount:1}));
  now+=2000;
  const failed=await runtime.get('brent',1,async()=>{throw new SourceError('rate_limit',{status:429,retryAfterMs:3600000});});
  const restarted=new SourceRuntime({cacheDir:'/cache',storage:new SqliteFiles(state.storage),now:()=>now+5000});
  let loads=0;const cached=await restarted.get('brent',1,async()=>{loads++;return {};});
  assert.equal(loads,0);assert.equal(cached.nextRetryAt,failed.nextRetryAt);assert.equal(cached.retrievedAt,'2026-09-23T00:00:00.000Z');assert.equal(cached.observations[0].value,70);state.db.close();
});

test('actual ReportArchive can save and restore using fs-like SQLite handles',async()=>{
  const now=Date.parse('2026-09-23T00:00:00Z'),state=sqliteState(),files=new SqliteFiles(state.storage);
  const archive=new ReportArchive({file:'/cache/reporting-history.json',storage:files,now:()=>now});
  const input={title:'Saudi oil exports update',url:'https://example.org/report',sourceId:'reuters',publishedAt:'2026-09-22T00:00:00Z'};
  const saved=await archive.merge([input],{observedAtBySource:{reuters:new Date(now).toISOString()}});
  assert.equal(saved.items.length,1);
  const second=new ReportArchive({file:'/cache/reporting-history.json',storage:new SqliteFiles(state.storage),now:()=>now+60_000});
  const loaded=await second.merge([]);assert.equal(loaded.items.length,1);assert.equal(loaded.items[0].publishedAt,new Date(input.publishedAt).toISOString());assert.equal(loaded.items[0].firstSeenAt,new Date(now).toISOString());state.db.close();
});

test('ten-second Open Waters refreshes checkpoint at five-minute intervals without redating data',async()=>{
  let now=0;const state=sqliteState(),files=new SqliteFiles(state.storage),storage=sourceStorage(files,()=>now);
  const save=async value=>{const tmp='/cache/openwaters-vessels.json.abc.tmp';await storage.writeFile(tmp,value,{flag:'wx'});await storage.rename(tmp,'/cache/openwaters-vessels.json');};
  await save('old original time');now=10_000;await save('new original time');
  assert.equal(await files.readFile('/cache/openwaters-vessels.json','utf8'),'old original time');
  now=300_000;await save('new original time');assert.equal(await files.readFile('/cache/openwaters-vessels.json','utf8'),'new original time');state.db.close();
});

test('an Open Waters checkpoint failure keeps the prior file and the next fetch can recover',async()=>{
  let now=Date.parse('2026-09-23T00:00:00Z');const state=sqliteState(),files=new SqliteFiles(state.storage),storage=sourceStorage(files,()=>now);
  const runtime=new SourceRuntime({cacheDir:'/cache',storage,now:()=>now});
  await runtime.get('openwaters',10,async()=>({vessels:[],recordCount:0,original:'first'}),{},'openwaters-vessels');
  now+=300_000;state.fail=query=>query.startsWith('UPDATE passage_files');
  const failed=await runtime.get('openwaters',10,async()=>({vessels:[],recordCount:0,original:'second'}),{},'openwaters-vessels');assert.ok(failed.cacheIssue);
  state.fail=null;assert.equal(JSON.parse(await files.readFile('/cache/openwaters-vessels.json','utf8')).original,'first');
  now+=10_000;const recovered=await runtime.get('openwaters',10,async()=>({vessels:[],recordCount:0,original:'third'}),{},'openwaters-vessels');
  assert.equal(recovered.cacheIssue,null);assert.equal(JSON.parse(await files.readFile('/cache/openwaters-vessels.json','utf8')).original,'third');state.db.close();
});
