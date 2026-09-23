/** Open Waters can refresh every ten seconds for viewers. Checkpoint it at
 * most every five minutes so frequent reads cannot exhaust daily SQL writes.
 * Source/receipt clocks are never changed when restoring the older checkpoint.
 */
export function sourceStorage(files,now=Date.now) {
  let temporary=null,lastSaved=-Infinity;
  const target='/cache/openwaters-vessels.json';
  const special=path=>path.startsWith(target+'.')&&path.endsWith('.tmp');
  return {
    readFile:files.readFile,mkdir:files.mkdir,
    async writeFile(path,value,options){
      if(!special(path))return files.writeFile(path,value,options);
      if(temporary)throw Object.assign(new Error('Cache checkpoint is pending.'),{code:'EEXIST'});
      // Runtime bounds the provider body before this already-normalized snapshot.
      if(typeof value!=='string'||new TextEncoder().encode(value).byteLength>10*1024*1024)throw Object.assign(new Error('Cache checkpoint too large.'),{code:'EFBIG'});
      temporary={path,value};
    },
    async rename(from,to){
      if(!special(from))return files.rename(from,to);
      if(to!==target||temporary?.path!==from)throw new Error('Invalid cache checkpoint.');
      if(now()-lastSaved>=300_000){await files.writeFile(from,temporary.value,{flag:'wx'});await files.rename(from,to);lastSaved=now();}
      temporary=null;
    },
    async rm(path,options){if(special(path)&&temporary?.path===path)temporary=null;return files.rm(path,options);},
  };
}
