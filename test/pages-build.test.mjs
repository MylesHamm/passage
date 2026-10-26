import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPages, normalizeBasePath } from '../scripts/build-pages.mjs';
import { PAGES } from '../lib/site-pages.mjs';
import { createRuntime } from '../dist/runtime-config.mjs';

async function withDirectory(run) {
  const directory = await mkdtemp(resolve(tmpdir(), 'passage-pages-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function list(directory, prefix = '') {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) files.push(...(item.isDirectory() ? await list(resolve(directory, item.name), prefix + item.name + '/') : [prefix + item.name]));
  return files;
}
test('Pages artifact resolves its real assets, imports and navigation under /passage/', async () => withDirectory(async directory => {
  const output = resolve(directory, 'pages');
  const result = await buildPages({ outputDir: output, apiBase: 'https://live.example.com/' });
  assert.equal(result.liveDataConfigured, true);
  const files = await list(output), origin = 'https://example.github.io', base = '/passage/';
  async function checkReference(reference, from) {
    const url = new URL(reference, origin + base + from);
    if (url.origin !== origin) return;
    assert.ok(url.pathname.startsWith(base), `${from} escapes project path: ${reference}`);
    // Pages live at directory paths, served from their index.html as GitHub Pages does.
    const path = decodeURIComponent(url.pathname.slice(base.length)), name = !path || path.endsWith('/') ? path + 'index.html' : path;
    assert.ok((await stat(resolve(output, name))).isFile(), `${from} missing local target: ${reference}`);
    if (url.hash && name.endsWith('.html')) {
      const target = await readFile(resolve(output, name), 'utf8');
      assert.ok(target.includes(`id="${url.hash.slice(1)}"`), `${from} missing page anchor: ${reference}`);
    }
  }
  for (const name of files) {
    if (!/\.(?:html|css|mjs|js)$/.test(name) || name.startsWith('vendor/')) continue;
    const source = await readFile(resolve(output, name), 'utf8');
    if (name.endsWith('.html')) {
      assert.match(source, /name="passage-api-base" content="https:\/\/live\.example\.com\/"/);
      assert.match(source, /name="passage-hosted" content="true"/);
      for (const match of source.matchAll(/(?:href|src)="([^"]+)"/g)) await checkReference(match[1].replaceAll('&amp;', '&'), name);
      assert.doesNotMatch(source, /connections\/acled|type=["']password/);
      assert.doesNotMatch(source, /<!-- (?:passage|icon):/, `${name} keeps an unexpanded include`);
      assert.match(source, /<nav class="nav-bar"/, `${name} has the shared navigation`);
    } else if (name.endsWith('.css')) {
      for (const match of source.matchAll(/url\(['"]?([^'"()]+)['"]?\)/g)) await checkReference(match[1], name);
    } else {
      for (const match of source.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]|new URL\(['"](\.[^'"]+)['"],\s*import\.meta\.url\)/g)) await checkReference(match[1] || match[2], name);
    }
  }
  assert.ok(files.includes('.nojekyll'));
  assert.deepEqual(files.filter(name => name.endsWith('.bin')).sort(), ['terrain/assets/hormuz-dem.bin', 'terrain/assets/theatre-dem.bin']);
  assert.ok(!files.some(name => name.startsWith('terrain/source/') || name.startsWith('terrain/test/') || /\.(py|headers)$/.test(name)));
  for(const name of ['terrain/assets/hormuz-dem.bin','terrain/assets/theatre-dem.bin'])assert.equal((await stat(resolve(output,name))).size,256*256*2);
  assert.ok(!files.some(name => name.startsWith('connections/') || /(?:\.env|server\.mjs|cache|node_modules)/.test(name)));
  assert.deepEqual(files.filter(name => name.endsWith('.json')).sort(), ['data/war-events.json', 'terrain/assets/provenance.json']);
  for (const name of [...PAGES.map(page => page.file), 'site.css', 'ops.css', 'site/shell.mjs', 'pages/home.mjs', 'ops/hero-map.mjs', 'ops/panels.mjs', 'assets/geist.woff2', 'assets/Geist-OFL.txt', 'vendor/anatomy/iso-kit.mjs', 'vendor/anatomy/LICENSE.txt']) assert.ok(files.includes(name), name);
  assert.ok(!files.includes('app.js'), 'the single-page script is gone');
  assert.ok(!files.some(name => /^(?:investigate|research|data-upgrades)\.html$|^globe\/|oil-system|monitoring|priority-/.test(name)), 'removed pages and modules stay out of the public artifact');
}));
test('unconfigured Pages preview remains public on localhost and cannot quietly call local /api', async () => withDirectory(async directory => {
  const output = resolve(directory, 'unconfigured');
  const result = await buildPages({ outputDir: output });
  assert.equal(result.liveDataConfigured, false);
  const html = await readFile(resolve(output, 'index.html'), 'utf8');
  const apiBase = html.match(/name="passage-api-base" content="([^"]*)"/)[1];
  const hosted = html.match(/name="passage-hosted" content="([^"]*)"/)[1] === 'true';
  let fetched = false;
  const runtime = createRuntime({ apiBase, hosted, pageUrl: 'http://localhost:8123/passage/', moduleUrl: 'http://localhost:8123/passage/runtime-config.mjs', fetchImpl: () => { fetched = true; } });
  await assert.rejects(runtime.apiFetch('/api/news'), /not configured/);
  assert.equal(fetched, false);
  assert.equal(runtime.privateConnectionsAllowed, false);
}));
test('Pages root and nested project paths are supported; malformed bases are rejected', async () => withDirectory(async directory => {
  for (const [index, basePath] of ['/', '/group/passage/'].entries()) {
    const outputDir = resolve(directory, String(index));
    await buildPages({ outputDir, basePath });
    const css = await readFile(resolve(outputDir, 'site.css'), 'utf8');
    assert.ok(css.includes(`url('${basePath}assets/geist.woff2')`));
    const html = await readFile(resolve(outputDir, 'war/index.html'), 'utf8');
    assert.ok(html.includes(`<a href="${basePath}war/" aria-current="page">Regional war</a>`), 'the current page is marked in the navigation');
  }
  for (const path of ['passage/', '/passage', '/../', '//', '/p?x/', '/p%20x/']) assert.throws(() => normalizeBasePath(path));
}));
test('build cannot overwrite source/existing output, include fake snapshots or accept credential-bearing API settings', async () => withDirectory(async directory => {
  const sourceDir = resolve(directory, 'source');
  await mkdir(sourceDir);
  await writeFile(resolve(sourceDir, 'news.json'), '{"items":[{"title":"Fake live report"}]}');
  await assert.rejects(buildPages({ sourceDir, outputDir: resolve(directory, 'fake') }), /reference geography/);
  await assert.rejects(buildPages({ outputDir: resolve(directory, 'bad-api'), apiBase: 'https://live.example.com/?key=private' }), /without credentials/);
  await assert.rejects(buildPages({ sourceDir, outputDir: resolve(sourceDir, 'pages') }), /separate/);
  await assert.rejects(buildPages({ sourceDir, outputDir: dirname(sourceDir) }), /separate/);
  const existing = resolve(directory, 'existing');
  await mkdir(existing); await writeFile(resolve(existing, 'keep.txt'), 'keep');
  await assert.rejects(buildPages({ outputDir: existing }), /already exists/);
  assert.equal(await readFile(resolve(existing, 'keep.txt'), 'utf8'), 'keep');
}));

test('terrain allowlist does not permit unrelated binary or JSON payloads', async()=>withDirectory(async directory=>{
 const sourceDir=resolve(directory,'source');await mkdir(resolve(sourceDir,'terrain/assets'),{recursive:true});
 await writeFile(resolve(sourceDir,'terrain/assets/private.bin'),'private');
 await assert.rejects(buildPages({sourceDir,outputDir:resolve(directory,'binary')}),/Unexpected public asset/);
 await rm(resolve(sourceDir,'terrain/assets/private.bin'));await writeFile(resolve(sourceDir,'terrain/assets/session.json'),'{}');
 await assert.rejects(buildPages({sourceDir,outputDir:resolve(directory,'json')}),/reference geography/);
}));
