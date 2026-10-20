// Writes the Anatomy tanker review sheets under test-results/ship-model-20261020/:
//   contact-sheet.svg  24 kit azimuths × 3 elevations at full size and full detail,
//                      plus the same angles as ~60 px and ~44 px map sprites.
//   preview.html       standalone review page: hero views for 4× inspection, the
//                      contact sheet, sprite strips on map water, the camera
//                      relation, and a live panel when served over http.
// Usage: node scripts/ship-model-preview.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tankerFigure, UNITS_PER_METRE, TANKER } from '../dist/terrain/ship-model.mjs';
import { shipSprite, ELEVATION_BANDS } from '../dist/terrain/ship-sprites.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'test-results', 'ship-model-20261020');
mkdirSync(OUT, { recursive: true });

const WATER = '#071a2c';
const AZIMUTHS = Array.from({ length: 24 }, (_, i) => i * 15);
const ELEVATIONS = [30, 50, 70];
const BROADSIDE = 230; // px for the hull lying across the screen
const scale = BROADSIDE / (TANKER.lengthOverall * UNITS_PER_METRE);
const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const inner = (svg) => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
const nested = (figure, x, y, s, extra = '') => `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(figure.width * s).toFixed(1)}" height="${(figure.height * s).toFixed(1)}" viewBox="0 0 ${figure.width} ${figure.height}" class="passage-ship"${extra}>${inner(figure.svg)}</svg>`;

// ------------------------------------------------------------ contact sheet
const COLUMNS = 6;
let y = 70;
const blocks = [];
const label = (x, y0, text, size = 11, fill = '#8fa3b3', anchor = 'start') => `<text x="${x}" y="${y0}" font-family="ui-monospace,Menlo,monospace" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`;
blocks.push(label(24, 34, 'PASSAGE · ANATOMY TANKER · 24 KIT AZIMUTHS × 3 ELEVATIONS · FULL DETAIL', 13, '#d8e0e6'));
blocks.push(label(24, 52, `Broadside ${BROADSIDE} px. Anchor (waterline centre) at each cell centre, marked +. Bow = kit +x. Kit azimuth A = 180° − (heading + yaw).`, 11));
let sheetWidth = 0;
for (const elevation of ELEVATIONS) {
  const figures = AZIMUTHS.map((azimuth) => tankerFigure({ azimuth, elevation, detail: 'full' }));
  const half = figures.reduce((m, f) => ({
    x: Math.max(m.x, f.anchor.x, f.width - f.anchor.x),
    up: Math.max(m.up, f.anchor.y),
    down: Math.max(m.down, f.height - f.anchor.y),
  }), { x: 0, up: 0, down: 0 });
  const cellW = Math.ceil(half.x * 2 * scale) + 16;
  const cellH = Math.ceil((half.up + half.down) * scale) + 30;
  sheetWidth = Math.max(sheetWidth, 24 * 2 + cellW * COLUMNS);
  blocks.push(label(24, y + 14, `KIT ELEVATION ${elevation}° · map tilt ${90 - elevation}°`, 12, '#d8e0e6'));
  y += 26;
  figures.forEach((f, i) => {
    const cx = 24 + (i % COLUMNS) * cellW + cellW / 2;
    const cy = y + Math.floor(i / COLUMNS) * cellH + 8 + half.up * scale;
    blocks.push(`<rect x="${(cx - cellW / 2 + 2).toFixed(1)}" y="${(cy - half.up * scale - 6).toFixed(1)}" width="${cellW - 4}" height="${cellH - 6}" fill="none" stroke="#12304a" stroke-width="1"/>`);
    blocks.push(nested(f, cx - f.anchor.x * scale, cy - f.anchor.y * scale, scale));
    blocks.push(`<path d="M${cx - 4} ${cy}h8M${cx} ${cy - 4}v8" stroke="#ffe4a3" stroke-width=".8" opacity=".55"/>`);
    blocks.push(label(cx - cellW / 2 + 8, cy + half.down * scale + 14, `A ${String(f.azimuth).padStart(3, '0')}° · ${f.partCount} parts`, 10, '#6f8799'));
  });
  y += Math.ceil(AZIMUTHS.length / COLUMNS) * cellH + 14;
  // The same angles as ~60 px map sprites (mid detail); 44 px low detail is on preview.html.
  for (const lengthPx of [60]) {
    blocks.push(label(24, y + 12, `SPRITES · ${lengthPx} px broadside · ${lengthPx < 56 ? 'low' : 'mid'} detail · heading = 180° − A at yaw 0, tilt ${90 - elevation}°`, 11));
    y += 22;
    const pitch = Math.max(56, Math.ceil(lengthPx * 0.95));
    AZIMUTHS.forEach((azimuth, i) => {
      const s = shipSprite({ headingDegrees: (360 + 180 - azimuth) % 360, cameraYawDegrees: 0, cameraTiltDegrees: 90 - elevation, lengthPx });
      const cx = 24 + pitch / 2 + i * pitch;
      const cy = y + pitch / 2;
      const f = { width: s.width / (lengthPx / (TANKER.lengthOverall * UNITS_PER_METRE)), height: s.height / (lengthPx / (TANKER.lengthOverall * UNITS_PER_METRE)), svg: s.svg };
      const k = lengthPx / (TANKER.lengthOverall * UNITS_PER_METRE);
      blocks.push(`<g transform="rotate(${s.rotationDeg} ${cx} ${cy})">${nested(f, cx - s.anchor.x, cy - s.anchor.y, k)}</g>`);
    });
    sheetWidth = Math.max(sheetWidth, 48 + pitch * AZIMUTHS.length);
    y += pitch + 10;
  }
  y += 18;
}
const sheetHeight = y + 20;
const contact = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheetWidth} ${sheetHeight}" width="${sheetWidth}" height="${sheetHeight}"><rect width="100%" height="100%" fill="${WATER}"/>${blocks.join('')}</svg>`;
writeFileSync(join(OUT, 'contact-sheet.svg'), contact);

// ------------------------------------------------------------ preview page
const hero = (azimuth, elevation) => {
  const f = tankerFigure({ azimuth, elevation, detail: 'full' });
  return `<figure class="hero"><div class="stage">${f.svg.replace(/ width="\d+" height="\d+"/, '')}</div><figcaption>Kit azimuth ${azimuth}°, elevation ${elevation}° · full detail · ${f.partCount} parts, ${f.itemCount} sorted items · anchor (${f.anchor.x}, ${f.anchor.y}) of ${f.width} × ${f.height}</figcaption></figure>`;
};
// Map-water legibility: sprites on deep water and on the lighter shore tone, at three sizes.
// Each unique sprite is embedded once; a small inline script assigns the <img> sources.
const unique = new Map();
const strip = (lengthPx, tilt, yaw, background) => {
  const cells = [];
  for (let heading = 0; heading < 360; heading += 30) {
    const s = shipSprite({ headingDegrees: heading, cameraYawDegrees: yaw, cameraTiltDegrees: tilt, lengthPx });
    const box = Math.ceil(lengthPx * 1.15);
    // Expected bow direction from the map's own camera math, drawn as a faint tick.
    const h = (heading + yaw) * Math.PI / 180; const e = (90 - tilt) * Math.PI / 180;
    const bx = Math.sin(h); const by = -Math.cos(h) * Math.sin(e); const n = Math.hypot(bx, by) || 1;
    const tick = `<svg class="tick" viewBox="0 0 ${box} ${box}" width="${box}" height="${box}"><path d="M${box / 2} ${box / 2}l${(bx / n) * box * 0.48} ${(by / n) * box * 0.48}" stroke="#ffe4a3" stroke-width="1" opacity=".35"/></svg>`;
    unique.set(s.key, s.dataUrl);
    cells.push(`<div class="cell" style="width:${box}px;height:${box}px">${tick}<img alt="" data-sprite="${s.key}" width="${s.width.toFixed(1)}" height="${s.height.toFixed(1)}" style="transform-origin:${s.anchor.x}px ${s.anchor.y}px;transform:translate(${box / 2 - s.anchor.x}px,${box / 2 - s.anchor.y}px) rotate(${s.rotationDeg}deg)"><span>${heading}°</span></div>`);
  }
  return `<div class="strip" style="background:${background}">${cells.join('')}</div>`;
};
const strips = [
  [44, 41.25, 0], [60, 41.25, 0], [90, 41.25, 0], [60, 20, 0], [60, 54, 0], [60, 41.25, 30], [60, 0, 0],
].map(([lengthPx, tilt, yaw]) => `<h3>${lengthPx} px · tilt ${tilt}° · yaw ${yaw}° · headings 0–330° (faint tick = bow from the map camera)</h3>${strip(lengthPx, tilt, yaw, WATER)}${strip(lengthPx, tilt, yaw, '#0e3841')}`).join('');

const live = `
<section id="live"><h2>Live sprite (needs the page served over http from the repository root)</h2>
<div class="controls">
<label>Heading <input id="h" type="range" min="0" max="359" value="65"><output id="ho"></output></label>
<label>Camera yaw <input id="yaw" type="range" min="-34" max="34" value="-6"><output id="yo"></output></label>
<label>Camera tilt <input id="tilt" type="range" min="0" max="60" value="41"><output id="to"></output></label>
<label>Length px <input id="len" type="range" min="30" max="400" value="90"><output id="lo"></output></label>
</div>
<div id="livestage" class="livestage"><p class="note">Module not loaded. Open this page through a local server (for example <code>npx serve .</code> or <code>python3 -m http.server</code> in the repository root) and visit /test-results/ship-model-20261020/preview.html.</p></div>
<pre id="liveinfo"></pre></section>
<script type="module">
try {
  const { shipSprite } = await import('../../dist/terrain/ship-sprites.mjs');
  const stage = document.getElementById('livestage'); stage.innerHTML = '<img id="liveimg" alt="">';
  const img = document.getElementById('liveimg');
  const read = (id) => Number(document.getElementById(id).value);
  const draw = () => {
    const s = shipSprite({ headingDegrees: read('h'), cameraYawDegrees: read('yaw'), cameraTiltDegrees: read('tilt'), lengthPx: read('len') });
    for (const [id, out] of [['h','ho'],['yaw','yo'],['tilt','to'],['len','lo']]) document.getElementById(out).textContent = read(id);
    img.src = s.dataUrl; img.width = s.width; img.height = s.height;
    img.style.transformOrigin = s.anchor.x + 'px ' + s.anchor.y + 'px';
    img.style.transform = 'translate(' + (stage.clientWidth / 2 - s.anchor.x) + 'px,' + (stage.clientHeight / 2 - s.anchor.y) + 'px) rotate(' + s.rotationDeg + 'deg)';
    document.getElementById('liveinfo').textContent = JSON.stringify({ key: s.key, azimuth: s.azimuth, elevation: s.elevation, detail: s.detail, rotationDeg: s.rotationDeg, width: +s.width.toFixed(1), height: +s.height.toFixed(1), anchor: s.anchor }, null, 1);
  };
  document.querySelectorAll('#live input').forEach((input) => input.addEventListener('input', draw)); draw();
} catch (error) { console.info('Live sprite panel needs http:', error.message); }
</script>`;

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tanker model review</title>
<style>
:root{color-scheme:dark;--water:${WATER};--ink:#d8e0e6;--muted:#8fa3b3}
*{box-sizing:border-box}body{margin:0;background:#04111d;color:var(--ink);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(1500px,100% - 32px);margin:32px auto 80px}
h1{font-size:20px;margin:0 0 6px}h2{font-size:15px;margin:36px 0 10px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}h3{font:12px ui-monospace,Menlo,monospace;color:var(--muted);margin:18px 0 6px}
p{max-width:900px;color:var(--muted)}code{color:var(--ink)}
.hero{margin:0 0 18px;background:var(--water);border:1px solid #12304a}.hero .stage{padding:8px}.hero svg{display:block;width:100%;height:auto}
.hero figcaption{font:12px ui-monospace,Menlo,monospace;color:var(--muted);padding:8px 12px;border-top:1px solid #12304a}
.sheet{display:block;width:100%;height:auto;border:1px solid #12304a;background:var(--water)}
.strip{display:flex;flex-wrap:wrap;gap:4px;padding:6px;border:1px solid #12304a;margin-bottom:4px}
.cell{position:relative;overflow:visible}.cell img,.cell .tick{position:absolute;left:0;top:0}.cell span{position:absolute;left:3px;bottom:1px;font:9px ui-monospace,Menlo,monospace;color:#56718a}
.controls{display:flex;flex-wrap:wrap;gap:16px;margin:8px 0}.controls label{display:flex;gap:8px;align-items:center;font:12px ui-monospace,Menlo,monospace;color:var(--muted)}
.livestage{position:relative;height:420px;background:var(--water);border:1px solid #12304a;overflow:hidden}.livestage img{position:absolute;left:0;top:0}.note{padding:16px}
pre{font:12px ui-monospace,Menlo,monospace;color:var(--muted)}
@media (max-width:600px){main{width:calc(100% - 32px)}}
</style></head><body><main>
<h1>Anatomy tanker · live Hormuz map model</h1>
<p>Generic VLCC crude carrier (330 × 60 m, 5.5 : 1) drawn with the vendored Anatomy kit at any camera-relative heading. Illustrative scale only; not a vessel's measured shape. The bridge glass is the one lit accent. Kit azimuth A = (180° − heading − camera yaw) mod 360, kit elevation E = 90° − camera tilt.</p>
<h2>Full detail, for 4× inspection</h2>
${hero(45, 35)}${hero(215, 50)}${hero(300, 22)}
<h2>Contact sheet · 24 azimuths × 3 elevations</h2>
<p>Opens without a server: <code>contact-sheet.svg</code> beside this page.</p>
<img class="sheet" src="contact-sheet.svg" alt="Contact sheet of the tanker at 24 kit azimuths and elevations 30, 50 and 70 degrees, with 60 and 44 pixel sprites">
<h2>Map sprites on deep and shore water</h2>
<p>shipSprite() output placed as an &lt;img&gt; with its residual rotation about the waterline anchor. Elevation bands: ${ELEVATION_BANDS.join(', ')}°.</p>
${strips}
<script>const SPRITES=${JSON.stringify(Object.fromEntries(unique)).replace(/</g, '\\u003c')};document.querySelectorAll('img[data-sprite]').forEach((img)=>{img.src=SPRITES[img.dataset.sprite];});</script>
${live}
</main></body></html>`;
writeFileSync(join(OUT, 'preview.html'), page);
console.log(`wrote ${join(OUT, 'contact-sheet.svg')} (${(contact.length / 1e6).toFixed(2)} MB) and preview.html (${(page.length / 1e6).toFixed(2)} MB)`);
