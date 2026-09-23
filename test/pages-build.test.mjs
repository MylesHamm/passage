import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPages, normalizeBasePath } from '../scripts/build-pages.mjs';
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
    const name = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
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
    } else if (name.endsWith('.css')) {
      for (const match of source.matchAll(/url\(['"]?([^'"()]+)['"]?\)/g)) await checkReference(match[1], name);
    } else {
      for (const match of source.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]|new URL\(['"](\.[^'"]+)['"],\s*import\.meta\.url\)/g)) await checkReference(match[1] || match[2], name);
    }
  }
  assert.ok(files.includes('.nojekyll'));
  assert.ok(!files.some(name => name.startsWith('connections/') || /(?:\.env|server\.mjs|cache|node_modules)/.test(name)));
  assert.deepEqual(files.filter(name => name.endsWith('.json')).sort(), ['assets/region.json', 'assets/world-land.json']);
  const notes = await import(pathToFileURL(resolve(output, 'intelligence-context.mjs')));
  const energy = await import(pathToFileURL(resolve(output, 'energy-context.mjs')));
  const graph = await import(pathToFileURL(resolve(output, 'intelligence-data.mjs')));
  assert.deepEqual(notes.COVERAGE_NOTES, []);
  assert.equal(notes.COVERAGE_REVIEW_DATE, null);
  assert.deepEqual(energy.MARKET_CONTEXT, []);
  assert.equal(energy.REVIEW_DATE, null);
  assert.ok(notes.ENERGY_ASSETS.length && energy.INFRASTRUCTURE.length);
  assert.equal(graph.buildIntelligence().nodes.length, 0);
  assert.equal(graph.mergeManualEvidence({ nodes: [], edges: [] }, []).review, null);
  assert.doesNotMatch(await readFile(resolve(output, 'energy-context.mjs'), 'utf8'), /shutdown reported Sep 11|September 11 shutdown notice/);
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
    const css = await readFile(resolve(outputDir, 'styles.css'), 'utf8');
    assert.ok(css.includes(`url('${basePath}assets/plex-400.ttf')`));
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
