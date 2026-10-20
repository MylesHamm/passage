// Syntax-checks every shipped and server-side script, so the list can never
// drift from the files that actually exist.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const skip = new Set(['node_modules', 'vendor', 'build', 'test', '.wrangler']);
function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return skip.has(name) ? [] : walk(path);
    return /\.(?:mjs|js)$/.test(name) ? [path] : [];
  });
}
const files = ['server.mjs', ...['dist', 'lib', 'cloud', 'scripts'].flatMap(dir => walk(join(root, dir)).map(file => relative(root, file)))];
const failed = files.filter(file => spawnSync(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit' }).status !== 0);
console.log(`${files.length - failed.length} of ${files.length} files passed node --check`);
if (failed.length) { console.error('Failed:', failed.join(', ')); process.exitCode = 1; }
