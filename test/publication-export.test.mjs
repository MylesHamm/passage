import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,chmod,stat,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {exportPublication} from '../scripts/export-publication.mjs';

async function fixture(t) {
  const directory=await realpath(await mkdtemp(resolve(tmpdir(),'passage-publication-')));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const source=resolve(directory,'source'),output=resolve(directory,'publication');
  const put=async(name,data='safe fixture')=>{const file=resolve(source,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,data);return file;};
  for(const name of ['package.json','package-lock.json','server.mjs','.gitignore'])await put(name,'{}');
  await chmod(await put('start.command','#!/bin/zsh\nnode server.mjs\n'),0o755);
  await put('.env.example','# Private server-side credentials\nAISSTREAM_API_KEY=\nEIA_API_KEY=\nRELIEFWEB_APPNAME=\nPORT=4173\n');
  await put('THIRD-PARTY-NOTICES.md',"# Third party notices\n\n2026-09-11 · Classification: Internal\n\nThe font uses the SIL Open Font License. Keep its attribution.\n\nClassification: Internal\n\nD3 uses ISC; ws uses MIT.\n\nThe user's earlier Red Sea dashboard informed the interaction direction. The supplied Sonder design notes informed hierarchy. No thesis records were imported.\n\nWorld Monitor design attribution remains.\n");
  await put('docs/PUBLIC-README.md','# Public Passage\n\nSee docs/HOSTING.md.\n');
  await put('docs/HOSTING.md','# Hosting\nOnly public configuration belongs here.\n');
  await put('lib/feed.mjs','export const example=true;');
  await put('dist/index.html','<title>Passage</title>');
  await put('dist/assets/font.ttf',Buffer.from([0,1,0,0,255,32,200]));
  await put('dist/vendor/d3.min.js','/* D3 ISC attribution */');
  await put('cloud/worker.mjs','export default {};');
  await put('cloud/wrangler.jsonc','{"vars":{"ALLOWED_ORIGIN":"https://example.github.io"}}');
  await put('test/example.test.mjs','// Safe regression fixture');
  await put('scripts/example.mjs','// Safe build helper');
  await put('.github/workflows/check.yml','name: Check\n');
  await put('licenses/d3-ISC.txt','Permission to use, copy, modify, and/or distribute.');
  return {directory,source,output,put};
}
async function list(directory,prefix='') {
  const names=[];
  for(const item of await readdir(directory,{withFileTypes:true})){
    const name=prefix+item.name;
    names.push(...(item.isDirectory()?await list(resolve(directory,item.name),name+'/'):[name]));
  }
  return names.sort();
}

test('publication export includes runnable sources and exact binary assets while excluding private state at every depth',async t=>{
  const f=await fixture(t);
  for(const name of ['.env','.env.local','.dev.vars','.git/config','.private/acled.json','.cache/reporting.json','node_modules/package/index.js','build/pages/index.html','README.md','docs/review.md','thesis.pdf','lib/.env','dist/.env.production','cloud/.dev.vars','lib/.private/account.json','test/.cache/saved.json','cloud/.wrangler/state.json','dist/node_modules/ignored.js','scripts/build/generated.mjs'])await f.put(name,'PRIVATE_FIXTURE_CONTENT');
  const result=await exportPublication({sourceDir:f.source,outputDir:f.output});
  const files=await list(f.output);
  assert.deepEqual(files,['.env.example','.github/workflows/check.yml','.gitignore','README.md','THIRD-PARTY-NOTICES.md','cloud/worker.mjs','cloud/wrangler.jsonc','dist/assets/font.ttf','dist/index.html','dist/vendor/d3.min.js','docs/HOSTING.md','docs/PUBLIC-README.md','lib/feed.mjs','licenses/d3-ISC.txt','package-lock.json','package.json','scripts/example.mjs','server.mjs','start.command','test/example.test.mjs'].sort());
  assert.equal(result.files,files.length);
  assert.equal(await readFile(resolve(f.output,'README.md'),'utf8'),await readFile(resolve(f.source,'docs/PUBLIC-README.md'),'utf8'));
  assert.equal(await readFile(resolve(f.output,'docs/PUBLIC-README.md'),'utf8'),await readFile(resolve(f.output,'README.md'),'utf8'));
  assert.deepEqual(await readFile(resolve(f.output,'dist/assets/font.ttf')),await readFile(resolve(f.source,'dist/assets/font.ttf')));
  assert.equal((await stat(resolve(f.output,'start.command'))).mode&0o111,0o111);
  for(const name of files)assert.equal((await readFile(resolve(f.output,name))).includes(Buffer.from('PRIVATE_FIXTURE_CONTENT')),false,name);
  const notices=await readFile(resolve(f.output,'THIRD-PARTY-NOTICES.md'),'utf8');
  assert.doesNotMatch(notices,/Classification: Internal|Red Sea dashboard|Sonder|thesis/);
  assert.match(notices,/SIL Open Font License/);assert.match(notices,/D3 uses ISC; ws uses MIT/);assert.match(notices,/World Monitor design attribution/);
  // The local input and its classification remain untouched.
  assert.match(await readFile(resolve(f.source,'THIRD-PARTY-NOTICES.md'),'utf8'),/Classification: Internal/);
});

test('export requires a new explicit destination outside the source and never overwrites existing files',async t=>{
  const f=await fixture(t);
  await assert.rejects(exportPublication({sourceDir:f.source}),/explicit.*output|output.*required/i);
  for(const outputDir of [f.source,resolve(f.source,'build/publication'),f.directory])await assert.rejects(exportPublication({sourceDir:f.source,outputDir}),/separate|outside/i);
  await mkdir(f.output);await writeFile(resolve(f.output,'keep.txt'),'original');
  await assert.rejects(exportPublication({sourceDir:f.source,outputDir:f.output}),/already exists/i);
  assert.equal(await readFile(resolve(f.output,'keep.txt'),'utf8'),'original');
  assert.deepEqual(await list(f.output),['keep.txt']);
  const script=fileURLToPath(new URL('../scripts/export-publication.mjs',import.meta.url));
  const command=spawnSync(process.execPath,[script],{encoding:'utf8'});
  assert.notEqual(command.status,0);assert.match(command.stderr,/--out/);
});

test('source files and directories cannot use symbolic links to publish other content',async t=>{
  for(const kind of ['file','directory','docs']){
    const f=await fixture(t),outside=resolve(f.directory,'private-source');
    await mkdir(outside);await writeFile(resolve(outside,'secret.mjs'),'PRIVATE_FIXTURE_CONTENT');
    if(kind==='docs'){
      await writeFile(resolve(outside,'HOSTING.md'),'PRIVATE_FIXTURE_CONTENT');
      await rm(resolve(f.source,'docs'),{recursive:true});await symlink(outside,resolve(f.source,'docs'));
    }else await symlink(kind==='file'?resolve(outside,'secret.mjs'):outside,resolve(f.source,'lib',kind==='file'?'linked.mjs':'linked'));
    await assert.rejects(exportPublication({sourceDir:f.source,outputDir:f.output}),/symbolic link/i);
    await assert.rejects(stat(f.output),{code:'ENOENT'});
  }
});

test('destination symbolic links are refused and cannot alias the source or an unrelated directory',async t=>{
  const f=await fixture(t),unrelated=resolve(f.directory,'unrelated');
  await mkdir(unrelated);await writeFile(resolve(unrelated,'keep.txt'),'original');
  await symlink(unrelated,f.output);
  await assert.rejects(exportPublication({sourceDir:f.source,outputDir:f.output}),/already exists|symbolic link/i);
  await assert.rejects(exportPublication({sourceDir:f.source,outputDir:resolve(f.output,'child')}),/symbolic link/i);
  await mkdir(resolve(unrelated,'nested'));
  await assert.rejects(exportPublication({sourceDir:f.source,outputDir:resolve(f.output,'nested','child')}),/symbolic link/i);
  await symlink(f.source,resolve(f.directory,'source-alias'));
  await assert.rejects(exportPublication({sourceDir:f.source,outputDir:resolve(f.directory,'source-alias','child')}),/symbolic link|separate|outside/i);
  assert.deepEqual(await list(unrelated),['keep.txt']);
});

test('public export fails before writing when safe-template credentials, machine paths or private keys remain',async t=>{
  const cases=[
    ['.env.example','EIA_API_KEY=must-not-be-exported\n'],
    ['lib/accidental.mjs',`const machinePath='${'/'+'Users/'}someone/private/file';`],
    ['licenses/accidental.txt','-----BEGIN '+ 'PRIVATE KEY-----\nprivate material\n-----END '+ 'PRIVATE KEY-----\n'],
  ];
  for(const [name,content] of cases){
    const f=await fixture(t);await f.put(name,content);
    await assert.rejects(exportPublication({sourceDir:f.source,outputDir:f.output}),/credential|local.*path|private key/i);
    await assert.rejects(stat(f.output),{code:'ENOENT'});
  }
});
