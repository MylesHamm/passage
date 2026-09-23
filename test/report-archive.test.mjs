import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ReportArchive} from '../lib/report-archive.mjs';

const DAY=86400000,START=Date.parse('2026-09-01T12:00:00Z');
const stamp=time=>new Date(time).toISOString();
const report=(name,extra={})=>({id:name,title:'Houthi shipping '+name,url:'https://example.com/'+name,sourceId:'bbc',source:'BBC',publishedAt:null,summary:null,theaters:['bab'],actors:['Houthis'],...extra});
async function fixture(t,options={}){
  const dir=await mkdtemp(path.join(tmpdir(),'passage-archive-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let time=START;const file=path.join(dir,'archive','reports.json');
  return {file,dir,setTime:value=>{time=value;},create:()=>new ReportArchive({file,now:()=>time,...options}),observation:()=>({observedAtBySource:{bbc:stamp(time)}})};
}
test('retains a report after a successful feed rolls over and across a restart',async t=>{
  const f=await fixture(t),archive=f.create();
  await archive.merge([report('first')],f.observation());f.setTime(START+DAY);
  const result=await archive.merge([report('second')],f.observation());
  assert.equal(result.items.find(x=>x.id==='first').retainedFromHistory,true);
  assert.equal(result.items.find(x=>x.id==='second').retainedFromHistory,false);
  assert.equal(result.archive.retainedCount,1);assert.equal(result.archive.storageStatus,'ready');
  const restored=await f.create().merge([],f.observation());assert.equal(restored.items.length,2);
  assert.ok(restored.items.every(x=>x.retainedFromHistory));assert.equal(restored.items.find(x=>x.id==='first').lastSeenAt,stamp(START));
  assert.equal(restored.items[0].resolved,undefined);assert.equal(restored.items[0].retracted,undefined);
  assert.equal((await stat(f.file)).mode&0o777,0o600);assert.equal((await stat(path.dirname(f.file))).mode&0o777,0o700);
});
test('unchanged cached retrieval cannot extend retention or revive expired history',async t=>{
  const f=await fixture(t,{retentionDays:2}),archive=f.create(),observation=f.observation();
  await archive.merge([report('old')],observation);f.setTime(START+DAY);
  let result=await archive.merge([report('old')],observation);assert.equal(result.items[0].lastSeenAt,stamp(START));
  f.setTime(START+2*DAY+1);result=await archive.merge([report('old')],observation);assert.equal(result.items.length,0);
  result=await f.create().merge([report('old')],observation);assert.equal(result.items.length,0);
});
test('a new source retrieval extends last seen without changing first seen or publication',async t=>{
  const f=await fixture(t),archive=f.create();await archive.merge([report('a')],f.observation());
  f.setTime(START+DAY);const result=await archive.merge([report('a')],f.observation());
  const row=result.items[0];assert.equal(row.firstSeenAt,stamp(START));assert.equal(row.lastSeenAt,stamp(START+DAY));
  assert.equal(row.publishedAt,null);assert.equal(row.discoveredAt,null);assert.equal(row.publicationPrecision,'unknown');
});
test('canonical duplicates merge source provenance and retain known publication metadata',async t=>{
  const f=await fixture(t),archive=f.create(),publishedAt=stamp(START-1000);
  await archive.merge([report('a',{publishedAt,url:'https://example.com/a?utm_source=rss'})],f.observation());
  f.setTime(START+DAY);
  const result=await archive.merge([report('a',{sourceId:'gdelt-redsea',discoveredAt:stamp(START+5000),provenance:[{sourceId:'gdelt-redsea',url:'https://example.com/a',publishedAt:null,discoveredAt:stamp(START+5000)}]})],{observedAtBySource:{'gdelt-redsea':stamp(START+DAY)}});
  assert.equal(result.items.length,1);assert.equal(result.items[0].url,'https://example.com/a');assert.equal(result.items[0].publishedAt,publishedAt);
  assert.equal(result.items[0].lastSeenAt,stamp(START+DAY));assert.equal(result.items[0].provenance.length,2);
  const restored=await f.create().merge([]);assert.equal(restored.archive.storageStatus,'ready');assert.equal(restored.items[0].provenance.length,2);
});
test('discovery enrichment cannot attach a changed headline to an older publication clock',async t=>{
  const f=await fixture(t),archive=f.create();
  await archive.merge([report('a',{title:'Publisher headline',publishedAt:stamp(START-1000)})],f.observation());f.setTime(START+DAY);
  const result=await archive.merge([report('a',{title:'Different index headline',sourceId:'gdelt-redsea',discoveredAt:stamp(START+DAY)})],{observedAtBySource:{'gdelt-redsea':stamp(START+DAY)}});
  assert.equal(result.items[0].title,'Publisher headline');assert.equal(result.items[0].sourceId,'bbc');assert.equal(result.items[0].discoveredAt,stamp(START+DAY));
});
test('older concurrent snapshot does not replace newer report metadata',async t=>{
  const f=await fixture(t),archive=f.create();f.setTime(START+DAY);
  await archive.merge([report('a',{title:'New headline'})],f.observation());
  const result=await archive.merge([report('a',{title:'Old headline'})],{observedAtBySource:{bbc:stamp(START)}});
  assert.equal(result.items[0].title,'New headline');assert.equal(result.items[0].lastSeenAt,stamp(START+DAY));
});
test('bounded history evicts oldest observed records and reports truncation',async t=>{
  const f=await fixture(t,{maxRecords:2}),archive=f.create();
  await archive.merge([report('a')],f.observation());f.setTime(START+DAY);await archive.merge([report('b')],f.observation());
  f.setTime(START+2*DAY);const result=await archive.merge([report('c')],f.observation());
  assert.deepEqual(result.items.map(x=>x.id).sort(),['b','c']);assert.equal(result.archive.recordCount,2);assert.equal(result.archive.truncated,true);
  assert.equal((await f.create().merge([],f.observation())).archive.truncated,true);
});
test('corrupt archive is not overwritten or represented as durable',async t=>{
  const f=await fixture(t);await mkdir(path.dirname(f.file));await writeFile(f.file,'not json');
  const result=await f.create().merge([report('a')],f.observation());
  assert.equal(result.items.length,1);assert.equal(result.archive.storageStatus,'memory-only');assert.match(result.archive.error,/archive/i);
  assert.equal(await readFile(f.file,'utf8'),'not json');
});
test('invalid stored shape is rejected rather than partly claiming restored history',async t=>{
  const f=await fixture(t),archive=f.create();await archive.merge([report('a')],f.observation());
  const saved=JSON.parse(await readFile(f.file,'utf8'));saved.items[0].title={body:'wrong'};await writeFile(f.file,JSON.stringify(saved));
  const result=await f.create().merge([],f.observation());assert.equal(result.items.length,0);assert.equal(result.archive.storageStatus,'memory-only');
});
test('oversized local archive is not loaded',async t=>{
  const f=await fixture(t);await mkdir(path.dirname(f.file));await writeFile(f.file,' '.repeat(10*1024*1024+1));
  const result=await f.create().merge([],f.observation());assert.equal(result.items.length,0);assert.equal(result.archive.storageStatus,'memory-only');
});
test('I/O failure retains reports in memory and emits a sanitized warning',async t=>{
  const f=await fixture(t);await writeFile(path.join(f.dir,'blocked'),'parent is a file');
  const archive=new ReportArchive({file:path.join(f.dir,'blocked','reports.json'),now:()=>START});
  const result=await archive.merge([report('a')],f.observation());assert.equal(result.items.length,1);assert.equal(result.archive.storageStatus,'memory-only');
  assert.ok(!result.archive.error.includes(f.dir));assert.equal((await archive.merge([],f.observation())).items.length,1);
});
test('private, credential and secret query URLs are excluded, extra bodies are never persisted',async t=>{
  const f=await fixture(t),archive=f.create();
  const result=await archive.merge([
    report('a',{body:'unlicensed full article',html:'<article>private</article>',summary:'x'.repeat(1000)}),
    ...['http://127.0.0.1/story','http://192.168.0.1/story','https://user:pass@example.com/story','https://example.com/story?api_key=secret'].map(url=>report('bad',{url})),
  ],f.observation());
  assert.equal(result.items.length,1);assert.equal(result.items[0].summary.length,280);
  const raw=await readFile(f.file,'utf8');assert.ok(!raw.includes('unlicensed'));assert.ok(!raw.includes('<article>'));assert.ok(!raw.includes('api_key'));
});
test('records without a retrieval clock remain visible but do not invent durable history',async t=>{
  const f=await fixture(t),archive=f.create(),result=await archive.merge([report('a')]);
  assert.equal(result.items.length,1);assert.equal(result.items[0].firstSeenAt,null);assert.equal(result.items[0].lastSeenAt,null);
  assert.equal(result.items[0].retainedFromHistory,false);assert.equal(result.archive.recordCount,0);
  assert.equal((await f.create().merge([])).items.length,0);
});
test('concurrent mutations preserve all records in memory and on disk',async t=>{
  const f=await fixture(t),archive=f.create();
  await Promise.all(Array.from({length:12},(_,i)=>archive.merge([report('a'+i)],f.observation())));
  const result=await f.create().merge([],f.observation());assert.equal(result.items.length,12);
  assert.equal(new Set(result.items.map(x=>x.url)).size,12);
  const raw=JSON.parse(await readFile(f.file,'utf8'));assert.equal(raw.items.length,12);
});

test('independent analysis labels survive archive retention and restart',async t=>{
  const f=await fixture(t),archive=f.create(),evidenceStatus='Independent energy analysis; publisher interpretation';
  await archive.merge([report('analysis',{type:'Independent energy analysis',evidenceStatus})],f.observation());
  const result=await f.create().merge([]),row=result.items[0];
  assert.equal(result.archive.storageStatus,'ready');assert.equal(row.type,'Independent energy analysis');
  assert.equal(row.evidenceStatus,evidenceStatus);assert.equal(row.retainedFromHistory,true);
});

test('generic discovery cannot erase an analysis classification in either merge order',async t=>{
  for(const analysisFirst of [true,false]){
    const f=await fixture(t),archive=f.create(),evidenceStatus='Independent energy analysis; publisher interpretation';
    const analysis=report('same',{type:'Independent energy analysis',evidenceStatus});
    const discovery=report('same',{sourceId:'gdelt-energy',type:'Discovered reporting',evidenceStatus:'Indexed headline only',url:analysis.url+'?utm_source=index'});
    const records=analysisFirst?[analysis,discovery]:[discovery,analysis];
    for(const [i,row] of records.entries()){
      f.setTime(START+i*DAY);
      await archive.merge([row],{observedAtBySource:{[row.sourceId]:stamp(START+i*DAY)}});
    }
    const result=await f.create().merge([]),row=result.items[0];
    assert.equal(result.items.length,1);assert.equal(row.type,'Independent energy analysis');assert.equal(row.evidenceStatus,evidenceStatus);
    assert.equal(row.provenance.length,2);assert.equal(result.archive.storageStatus,'ready');
  }
});

test('existing v1 metadata without evidence status remains loadable',async t=>{
  const f=await fixture(t);await f.create().merge([report('legacy',{type:'Reporting'})],f.observation());
  const stored=JSON.parse(await readFile(f.file,'utf8'));delete stored.items[0].evidenceStatus;await writeFile(f.file,JSON.stringify(stored));
  const restored=await f.create().merge([]);
  assert.equal(restored.archive.storageStatus,'ready');assert.equal(restored.items.length,1);assert.equal(restored.items[0].type,'Reporting');
});

test('analysis previews retain up to 600 characters while generic summaries keep their 280-character bound',async t=>{
  const f=await fixture(t),summary='x'.repeat(330)+' Diesel refining margins and oil inventories. '+'y'.repeat(500);
  await f.create().merge([report('analysis',{type:'Independent energy analysis',summary}),report('generic',{type:'Reporting',summary})],f.observation());
  const restored=await f.create().merge([]),analysis=restored.items.find(row=>row.id==='analysis'),generic=restored.items.find(row=>row.id==='generic');
  assert.equal(analysis.summary.length,600);assert.match(analysis.summary,/Diesel refining margins/);
  assert.equal(generic.summary.length,280);assert.equal(restored.archive.storageStatus,'ready');
});

test('analysis preview and access stay with their own publication clock when discovery also names the URL',async t=>{
  for(const analysisFirst of [true,false]){
    const f=await fixture(t),archive=f.create();
    const analysis=report('same',{title:'Publisher title',type:'Independent energy analysis',summary:'Free preview about refining and diesel.',contentAccess:'Free preview; full article may require subscription'});
    const discovery=report('same',{title:'Different indexed title',sourceId:'gdelt-energy',type:'Discovered reporting',summary:null,contentAccess:'Indexed headline only',publishedAt:stamp(START-1000),discoveredAt:stamp(START)});
    const rows=analysisFirst?[analysis,discovery]:[discovery,analysis];
    for(const [i,row] of rows.entries()){
      f.setTime(START+i*DAY);
      await archive.merge([row],{observedAtBySource:{[row.sourceId]:stamp(START+i*DAY)}});
    }
    const restored=await f.create().merge([]),row=restored.items[0];
    assert.equal(row.title,analysis.title);assert.equal(row.summary,analysis.summary);assert.equal(row.contentAccess,analysis.contentAccess);assert.equal(row.sourceId,analysis.sourceId);
    assert.equal(row.publishedAt,null);assert.equal(row.publicationPrecision,'unknown');assert.equal(row.discoveredAt,discovery.discoveredAt);
    assert.equal(row.lastSeenAt,stamp(START+DAY));assert.equal(row.provenance.length,2);assert.equal(restored.archive.storageStatus,'ready');
  }
});
test('archive favors publisher preview over analysis-classified discovery in either arrival order',async t=>{
 for(const directFirst of [true,false]){
  const f=await fixture(t),archive=f.create(),url='https://newsletter.doomberg.com/p/example';
  const direct=report('preview',{url,type:'Independent energy analysis',summary:'Public refining preview.',contentAccess:'Public RSS preview',evidenceStatus:'Independent energy analysis; publisher interpretation'});
  const indexed=report('indexed',{url,sourceId:'gdelt-energy',type:'Independent energy analysis',contentAccess:'discovery-metadata',discoveredAt:stamp(START),publishedAt:stamp(START-1000)});
  for(const [i,row] of (directFirst?[direct,indexed]:[indexed,direct]).entries()){
   f.setTime(START+i*DAY);await archive.merge([row],{observedAtBySource:{[row.sourceId]:stamp(START+i*DAY)}});
  }
  const result=await f.create().merge([]),row=result.items[0];
  assert.equal(row.id,direct.id);assert.equal(row.summary,direct.summary);assert.equal(row.contentAccess,direct.contentAccess);assert.equal(row.publishedAt,null);assert.equal(row.evidenceStatus,direct.evidenceStatus);assert.equal(row.discoveredAt,indexed.discoveredAt);assert.equal(row.provenance.length,2);assert.equal(result.archive.storageStatus,'ready');
 }
});
test('legacy archived Doomberg metadata is relabeled without invalidating the stored v1 shape',async t=>{
 const f=await fixture(t),item=report('legacy-doomberg',{url:'https://newsletter.doomberg.com/p/old',type:'Discovered reporting',contentAccess:'discovery-metadata',sourceId:'gdelt-energy'});
 await f.create().merge([item],{observedAtBySource:{'gdelt-energy':stamp(START)}});
 const stored=JSON.parse(await readFile(f.file,'utf8'));stored.items[0].type='Discovered reporting';delete stored.items[0].evidenceStatus;await writeFile(f.file,JSON.stringify(stored));
 const result=await f.create().merge([]),row=result.items[0];
 assert.equal(result.archive.storageStatus,'ready');assert.equal(row.type,'Independent energy analysis');assert.equal(row.summary,null);assert.equal(row.publishedAt,null);assert.equal(row.contentAccess,'discovery-metadata');
});
