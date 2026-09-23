import {lstat,realpath,readdir,open,mkdir,writeFile,chmod} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,basename,extname,sep,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const rootFiles=['package.json','package-lock.json','server.mjs','start.command','.env.example','.gitignore','THIRD-PARTY-NOTICES.md'];
const directories=['lib','dist','cloud','test','scripts','.github','licenses'];
const excluded=new Set(['.git','.cache','.private','.wrangler','node_modules','build','coverage','test-results','playwright-report','.sites-runtime']);
const extensions=new Set(['.mjs','.js','.cjs','.html','.css','.json','.jsonc','.svg','.txt','.md','.ttf','.woff','.woff2','.png','.jpg','.jpeg','.webp','.ico','.yml','.yaml','.sh','.command']);
const binaryExtensions=new Set(['.ttf','.woff','.woff2','.png','.jpg','.jpeg','.webp','.ico']);
const MAX_FILE=32*1024*1024,MAX_TOTAL=128*1024*1024;
const inside=(parent,child)=>parent===child||child.startsWith(parent+sep);
const excludedName=name=>excluded.has(name.toLowerCase())||name.startsWith('.')||/\.(?:log|tmp|bak|orig|swp)$/i.test(name)||name.endsWith('~');

async function destination(source,value) {
  if(typeof value!=='string'||!value.trim())throw Error('An explicit output directory is required (--out directory).');
  const requested=resolve(value);
  if(inside(source,requested)||inside(requested,source))throw Error('Publication output must be separate from and outside the source tree.');
  let cursor=requested;const missing=[];
  for(;;){
    let info;
    try{info=await lstat(cursor);}catch(error){if(error.code!=='ENOENT')throw error;missing.unshift(basename(cursor));cursor=dirname(cursor);continue;}
    for(let ancestor=cursor;;ancestor=dirname(ancestor)){
      if((await lstat(ancestor)).isSymbolicLink())throw Error('Refusing a symbolic link in the publication output path.');
      if(dirname(ancestor)===ancestor)break;
    }
    const output=resolve(await realpath(cursor),...missing);
    if(inside(source,output)||inside(output,source))throw Error('Publication output must be separate from and outside the source tree.');
    if(!missing.length)throw Error('Publication output already exists. Choose a new directory; nothing will be overwritten.');
    if(!info.isDirectory())throw Error('The publication output parent must be a directory.');
    return output;
  }
}

function notices(text) {
  return text.replace(/^.*Classification:\s*Internal.*(?:\r?\n|$)/gmi,'')
    .split(/\r?\n\s*\r?\n/)
    .filter(paragraph=>!/^The user's earlier Red Sea dashboard\b/.test(paragraph.trim()))
    .join('\n\n').trim()+'\n';
}
function validateExample(text) {
  const allowed=new Set(['AISSTREAM_API_KEY','EIA_API_KEY','RELIEFWEB_APPNAME','PORT']);
  for(const line of text.split(/\r?\n/)){
    if(!line.trim()||line.trim().startsWith('#'))continue;
    const match=line.match(/^([A-Z_]+)=(.*)$/);
    if(!match||!allowed.has(match[1]))throw Error('Unexpected credential-template setting in .env.example.');
    const [,key,value]=match;
    if(key==='PORT'?(!/^\d{1,5}$/.test(value)||Number(value)<1||Number(value)>65535):value.trim()!=='')throw Error('Credential values must be blank in .env.example.');
  }
}
function validatePublicText(name,text) {
  // Reject machine-specific paths; do not rewrite executable source or tests.
  const privateRoots=[['Users'],['private','var','folders'],['var','folders']].map(parts=>'/'+parts.join('/')+'/');
  if(privateRoots.some(prefix=>text.includes(prefix)))throw Error(`A local machine path remains in public file: ${name}`);
  if(/^-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----\r?$/m.test(text))throw Error(`A private key remains in public file: ${name}`);
  if(name==='.env.example')validateExample(text);
}

/** Create a fresh source publication, never a copy of a private Git checkout.
 * Private state is excluded before reading, and every included file is checked
 * before any output is written. Actual configured key values require a separate
 * confidential release check; this scanner does not claim to identify all keys.
 */
export async function exportPublication({sourceDir=root,outputDir}={}) {
  const requestedSource=resolve(sourceDir),sourceInfo=await lstat(requestedSource);
  if(sourceInfo.isSymbolicLink()||!sourceInfo.isDirectory())throw Error('The publication source must be a directory, not a symbolic link.');
  const source=await realpath(requestedSource),output=await destination(source,outputDir),files=[];
  let bytes=0;
  async function include(name,target=name) {
    const file=resolve(source,name),info=await lstat(file);
    if(info.isSymbolicLink())throw Error(`Refusing to publish a symbolic link: ${name}`);
    if(await realpath(dirname(file))!==dirname(file))throw Error(`Refusing to publish through a symbolic link: ${name}`);
    if(!info.isFile())throw Error(`Expected a regular public file: ${name}`);
    if(info.size>MAX_FILE||bytes+info.size>MAX_TOTAL)throw Error('Publication source exceeds its bounded export size.');
    const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    let data;
    try{
      const current=await handle.stat();
      if(!current.isFile()||current.dev!==info.dev||current.ino!==info.ino||current.size!==info.size)throw Error('Publication source changed during inspection; retry after edits finish.');
      data=await handle.readFile();
      if(data.length!==info.size)throw Error('Publication source changed during inspection; retry after edits finish.');
    }finally{await handle.close();}
    if(!binaryExtensions.has(extname(name).toLowerCase())){
      let text=data.toString('utf8');
      if(name==='THIRD-PARTY-NOTICES.md')text=notices(text);
      validatePublicText(name,text);data=Buffer.from(text);
    }
    bytes+=data.length;files.push({name:target,data,mode:info.mode&0o777});
  }
  async function inventory(name) {
    const directory=resolve(source,name),info=await lstat(directory);
    if(info.isSymbolicLink())throw Error(`Refusing to publish a symbolic link: ${name}`);
    if(!info.isDirectory())throw Error(`Expected a public source directory: ${name}`);
    for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(excludedName(entry.name))continue;
      const child=name+'/'+entry.name;
      if(entry.isSymbolicLink())throw Error(`Refusing to publish a symbolic link: ${child}`);
      if(entry.isDirectory())await inventory(child);
      else if(entry.isFile()&&extensions.has(extname(entry.name).toLowerCase()))await include(child);
      else throw Error(`Unexpected public source file: ${child}`);
    }
  }
  for(const name of rootFiles)await include(name);
  for(const name of directories)await inventory(name);
  await include('docs/HOSTING.md');await include('docs/PUBLIC-README.md');await include('docs/PUBLIC-README.md','README.md');
  // Recheck immediately before creation. mkdir is exclusive at the output root;
  // wx writes also refuse existing files and final-component symbolic links.
  const checked=await destination(source,output);
  if(checked!==output)throw Error('Publication output changed during inspection.');
  await mkdir(dirname(output),{recursive:true});await mkdir(output);
  for(const file of files){
    const target=resolve(output,file.name),parent=dirname(target);
    await mkdir(parent,{recursive:true});
    if((await realpath(parent))!==parent)throw Error('Refusing a symbolic link in the publication output.');
    await writeFile(target,file.data,{flag:'wx',mode:file.mode});await chmod(target,file.mode);
  }
  return {outputDir:output,files:files.length,bytes,gitHistoryIncluded:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(process.argv.length!==4||process.argv[2]!=='--out'||!process.argv[3]?.trim()||process.argv[3].startsWith('--'))throw Error('Usage: node scripts/export-publication.mjs --out new-directory-outside-source');
    const result=await exportPublication({outputDir:process.argv[3]});
    console.log(`Prepared ${result.files} public source files in ${relative(process.cwd(),result.outputDir)}. No Git history or configured credentials were copied; complete the confidential known-secret release check before publishing.`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
