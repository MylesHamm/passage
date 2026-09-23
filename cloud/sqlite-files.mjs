import {Buffer} from 'node:buffer';
import {randomUUID} from 'node:crypto';

export const FILE_LIMIT = 10 * 1024 * 1024;
const CHUNK = 256 * 1024, TOTAL_LIMIT = 128 * 1024 * 1024, FILE_COUNT = 128;
const error = code => Object.assign(new Error('Persistent cache operation failed.'), {code});
const valid = path => {
  if(typeof path !== 'string' || !/^\/cache\/[a-z0-9][a-z0-9.-]{0,180}$/.test(path) || path.includes('..')) throw error('EINVAL');
  return path;
};

/** Bounded, parameterized SQLite files for the shared cache/archive contracts.
 * A rename replaces the file manifest atomically. Source timestamps are untouched.
 * Chunks stay below Cloudflare's 2 MB SQL row limit; no host filesystem is used.
 */
export class SqliteFiles {
  constructor(storage) {
    this.storage = storage;this.sqlUsage={available:false,read:0,written:0};
    this.sql = {exec:(query,...bindings)=>{
      const cursor=storage.sql.exec(query,...bindings),rows=[...cursor];
      if(Number.isFinite(cursor.rowsRead)&&Number.isFinite(cursor.rowsWritten)) {
        this.sqlUsage.available=true;this.sqlUsage.read+=cursor.rowsRead;this.sqlUsage.written+=cursor.rowsWritten;
      }
      return rows;
    }};
    this.sql.exec('CREATE TABLE IF NOT EXISTS passage_files (path TEXT PRIMARY KEY, file_id TEXT NOT NULL, size INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS passage_chunks (file_id TEXT NOT NULL, part INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(file_id, part))');
    storage.transactionSync(() => {
      for(const row of [...this.sql.exec("SELECT path FROM passage_files WHERE path LIKE '%.tmp'")]) this.remove(row.path);
    });
    // Methods are also passed as the fs-like storage interface.
    for(const name of ['readFile','writeFile','mkdir','rename','rm','unlink','open']) this[name] = this[name].bind(this);
  }
  find(path) { return [...this.sql.exec('SELECT file_id, size FROM passage_files WHERE path = ?', valid(path))][0]; }
  usage() {
    const row=[...this.sql.exec('SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM passage_files')][0];
    return {files:row.count,logicalBytes:row.bytes,logicalByteLimit:TOTAL_LIMIT,fileByteLimit:FILE_LIMIT,
      databaseBytes:Number.isFinite(this.storage.sql.databaseSize)?this.storage.sql.databaseSize:null,
      observedSqlRows:this.sqlUsage.available?{read:this.sqlUsage.read,written:this.sqlUsage.written,basis:'Since this collector started; excludes alarm bookkeeping and is not the account billing total.'}:null,
      basis:'Application file bytes only; Cloudflare billing includes SQL indices, system storage and operations. Check the Cloudflare dashboard for quota usage.'};
  }
  remove(path) {
    const old = this.find(path); if(!old) return false;
    this.sql.exec('DELETE FROM passage_chunks WHERE file_id = ?', old.file_id);
    this.sql.exec('DELETE FROM passage_files WHERE path = ?', path); return true;
  }
  async mkdir(path) { if(path !== '/cache') throw error('EINVAL'); }
  async readFile(path, encoding) {
    const row = this.find(path); if(!row) throw error('ENOENT');
    if(row.size > FILE_LIMIT) throw error('EFBIG');
    const chunks = [...this.sql.exec('SELECT data FROM passage_chunks WHERE file_id = ? ORDER BY part', row.file_id)].map(row => Buffer.from(row.data));
    const data = Buffer.concat(chunks); if(data.length !== row.size) throw error('EIO');
    return encoding === 'utf8' || encoding?.encoding === 'utf8' ? data.toString('utf8') : data;
  }
  async writeFile(path, value, options = {}) {
    valid(path); const data = Buffer.from(value); if(data.length > FILE_LIMIT) throw error('EFBIG');
    this.storage.transactionSync(() => {
      const old = this.find(path); if(options.flag === 'wx' && old) throw error('EEXIST');
      const totals = [...this.sql.exec('SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM passage_files')][0];
      if(totals.count + (old ? 0 : 1) > FILE_COUNT || totals.bytes - (old?.size || 0) + data.length > TOTAL_LIMIT) throw error('ENOSPC');
      this.remove(path); const id = randomUUID();
      this.sql.exec('INSERT INTO passage_files (path, file_id, size) VALUES (?, ?, ?)', path, id, data.length);
      for(let offset = 0, part = 0; offset < data.length; offset += CHUNK, part++) this.sql.exec('INSERT INTO passage_chunks (file_id, part, data) VALUES (?, ?, ?)', id, part, data.subarray(offset, offset + CHUNK));
    });
  }
  async rename(from, to) {
    valid(from); valid(to); if(from === to) { if(!this.find(from)) throw error('ENOENT'); return; }
    this.storage.transactionSync(() => {
      if(!this.find(from)) throw error('ENOENT');
      this.remove(to); this.sql.exec('UPDATE passage_files SET path = ? WHERE path = ?', to, from);
    });
  }
  async rm(path, {force = false} = {}) { this.storage.transactionSync(() => { if(!this.remove(path) && !force) throw error('ENOENT'); }); }
  async unlink(path) { return this.rm(path); }
  async open(path, flags) {
    const writing = flags === 'wx';
    if(writing) await this.writeFile(path, '', {flag:'wx'});
    else if(typeof flags !== 'number') throw error('EINVAL');
    const data = writing ? null : await this.readFile(path); let cursor = 0, closed = false;
    const check = () => { if(closed) throw error('EBADF'); };
    return {
      stat: async () => { check(); return {isFile:() => true, size:data?.length || 0}; },
      read: async (target, offset, length, position) => {
        check(); if(writing) throw error('EBADF'); const start = position ?? cursor;
        const count = Math.max(0, Math.min(length, data.length - start)); data.copy(target, offset, start, start + count);
        if(position === null) cursor += count; return {bytesRead:count, buffer:target};
      },
      writeFile: async value => { check(); if(!writing) throw error('EBADF'); await this.writeFile(path, value); },
      sync: async () => { check(); }, close: async () => { closed = true; },
    };
  }
}
