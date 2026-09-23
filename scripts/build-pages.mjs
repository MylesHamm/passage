import { mkdir, readdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeApiBase } from '../dist/runtime-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const staticExtensions = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.ttf', '.woff', '.woff2', '.png', '.jpg', '.webp', '.ico', '.txt']);
const geography = new Set(['assets/region.json', 'assets/world-land.json']);
const escapeAttribute = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inside = (parent, child) => child === parent || child.startsWith(parent + sep);

export function normalizeBasePath(value = '/passage/') {
  if (typeof value !== 'string' || !/^\/(?:[a-z\d_-]+\/)*$/i.test(value)) throw new TypeError('The Pages base path must start and end with / and contain simple path segments.');
  return value;
}

export async function buildPages({ sourceDir = resolve(root, 'dist'), outputDir = resolve(root, 'build/pages'), basePath = '/passage/', apiBase = '' } = {}) {
  const base = normalizeBasePath(basePath), api = normalizeApiBase(apiBase);
  const source = resolve(sourceDir), output = resolve(outputDir);
  if (inside(source, output) || inside(output, source)) throw new Error('The Pages output must be separate from the source directory.');
  try { await stat(output); throw new Error('Pages output already exists. Choose a new empty output path.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = [];
  async function inventory(directory, prefix = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + item.name;
      if (item.isSymbolicLink()) throw new Error(`Refusing to publish a symbolic link: ${name}`);
      if (name === 'connections') continue; // Personal account forms and mutation code are local only.
      if (item.isDirectory()) { await inventory(resolve(directory, item.name), name + '/'); continue; }
      if (!item.isFile() || item.name.startsWith('.') || !staticExtensions.has(extname(name))) throw new Error(`Unexpected public asset: ${name}`);
      if (extname(name) === '.json' && !geography.has(name)) throw new Error(`Only reference geography JSON may be bundled: ${name}`);
      files.push(name);
    }
  }
  await inventory(source);
  await mkdir(output, { recursive: true });
  for (const name of files) {
    const from = resolve(source, name), to = resolve(output, name);
    await mkdir(dirname(to), { recursive: true });
    if (name.endsWith('.html')) {
      let html = await readFile(from, 'utf8');
      if (!html.includes('name="passage-api-base"') || !html.includes('name="passage-hosted"')) throw new Error(`Missing public runtime configuration: ${name}`);
      html = html.replace(/<!-- local-only:start -->[\s\S]*?<!-- local-only:end -->/g, '')
        .replace(/(<meta name="passage-api-base" content=")[^"]*(">)/, (_, start, end) => start + escapeAttribute(api) + end)
        .replace('name="passage-hosted" content="false"', 'name="passage-hosted" content="true"')
        .replace(/((?:href|src)=["'])\/(?!\/)/g, `$1${base}`)
        .replace('Local workspace <b>·</b> Internal', 'Public source watch')
        .replace('>INTERNAL<', '>PUBLIC<').replace('>LOCAL WORKSPACE<', '>PUBLIC WATCH<')
        .replace('use this local dashboard.', 'use this dashboard.');
      if (/connections\/acled|type=["']password/i.test(html)) throw new Error(`Private account UI remains in public page: ${name}`);
      await writeFile(to, html);
    } else if (name.endsWith('.css')) {
      const css = (await readFile(from, 'utf8')).replace(/(url\(["']?)\/(?!\/)/g, `$1${base}`);
      await writeFile(to, css);
    } else if (name === 'intelligence-context.mjs') {
      const source = await readFile(from, 'utf8');
      const publicContext = source.replace(/export const COVERAGE_REVIEW_DATE\s*=\s*'[^']+';/, 'export const COVERAGE_REVIEW_DATE = null;')
        .replace(/export const COVERAGE_NOTES\s*=\s*\[[\s\S]*?\n\];/, 'export const COVERAGE_NOTES = [];');
      if (publicContext.includes("id:'review:")) throw new Error('Private reviewed reporting remains in the public artifact.');
      await writeFile(to, publicContext);
    } else if (name === 'energy-context.mjs') {
      const source = await readFile(from, 'utf8');
      const publicContext = source.replace(/export const REVIEW_DATE\s*=\s*'[^']+';/, 'export const REVIEW_DATE = null;')
        .replace(/export const MARKET_CONTEXT\s*=\s*\[[\s\S]*?\n\];/, 'export const MARKET_CONTEXT = [];')
        .replace('East–West to Yanbu · shutdown reported Sep 11, 2026; see dated evidence', 'East–West to Yanbu · current operating status not connected')
        .replace('Pipeline restart, Yanbu loadings, production and OPEC+ decisions.', 'Dated operating notices, Yanbu loadings, production and OPEC+ decisions.')
        .replace('The September 11 shutdown notice supersedes an assumption of uninterrupted bypass availability. Nameplate capacity is not today’s throughput.', 'Nameplate capacity is not today’s throughput. Operating status requires current source evidence.');
      if (publicContext.includes("id:'saudi-pipeline'") || publicContext.includes("id:'iea-september'")) throw new Error('Private market assessments remain in the public artifact.');
      await writeFile(to, publicContext);
    } else await copyFile(from, to);
  }
  await writeFile(resolve(output, '.nojekyll'), '');
  return { outputDir: output, basePath: base, apiBase: api || null, liveDataConfigured: Boolean(api), files: files.length + 1 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = { apiBase: process.env.PASSAGE_API_BASE || '' };
    const flags = { '--out': 'outputDir', '--base-path': 'basePath', '--api-base': 'apiBase' };
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = flags[process.argv[index]], value = process.argv[index + 1];
      if (!key || !value) throw new Error('Usage: node scripts/build-pages.mjs [--out directory] [--base-path /passage/] [--api-base https://your-api.example/]');
      options[key] = value;
    }
    const result = await buildPages(options);
    console.log(`Pages files: ${relative(process.cwd(), result.outputDir) || '.'} · ${result.files} files · ${result.liveDataConfigured ? 'HTTPS live-data service configured' : 'live data unconfigured (clearly shown in the interface)'}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
