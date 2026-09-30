const DAY = 86400000;
const GAP_DAYS = 4;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
let chartSequence = 0;

function dateMillis(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

function priceScale(min, max) {
  const padding = Math.max((max - min) * .12, Math.max(Math.abs(min), Math.abs(max)) * .015, 1);
  const roughStep = (max - min + 2 * padding) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const ratio = roughStep / magnitude;
  const step = (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * magnitude;
  const yMin = Math.floor((min - padding) / step) * step;
  const yMax = Math.ceil((max + padding) / step) * step;
  const ticks = Array.from({ length: Math.round((yMax - yMin) / step) + 1 }, (_, i) => yMin + i * step);
  return { yMin, yMax, ticks };
}

/** Daily observations only. A missing value is never coerced to zero or carried forward. */
export function buildOilChartModel(series = [], { period = 90, now = Date.now() } = {}) {
  const days = Number.isFinite(period) && period >= 1 ? Math.floor(period) : 90;
  const observationCutoff = Number.isFinite(now) ? now : Date.now();
  const normalized = (Array.isArray(series) ? series : []).map(item => {
    const byDate = new Map();
    for (const point of item.observations || []) {
      const ms = dateMillis(point?.date);
      if (ms !== null && ms <= observationCutoff) byDate.set(point.date, { date: point.date, ms, value: Number.isFinite(point.value) ? point.value : null });
    }
    return { id: item.id, name: item.name || item.id || 'Oil', rows: [...byDate.values()].sort((a, b) => a.ms - b.ms) };
  });
  const valid = normalized.flatMap(s => s.rows.filter(p => p.value !== null));
  const latest = valid.length ? Math.max(...valid.map(p => p.ms)) : null;
  const begin = latest === null ? null : latest - (days - 1) * DAY;
  const sets = normalized.map(s => {
    const segments = [];
    let segment = [];
    for (const point of s.rows.filter(p => p.ms >= begin && p.ms <= latest)) {
      if (point.value === null || (segment.length && point.ms - segment.at(-1).ms > GAP_DAYS * DAY)) {
        if (segment.length) segments.push(segment);
        segment = [];
      }
      if (point.value !== null) segment.push(point);
    }
    if (segment.length) segments.push(segment);
    const points = segments.flat();
    return { id: s.id, name: s.name, points, segments };
  });
  const points = sets.flatMap(s => s.points);
  const dates = [...new Set(points.map(p => p.date))].sort();
  const min = points.length ? Math.min(...points.map(p => p.value)) : 0;
  const max = points.length ? Math.max(...points.map(p => p.value)) : 1;
  return {
    series: sets, dates, begin, latest, period: days, hasData: Boolean(points.length),
    ...priceScale(min, max),
    breakCount: sets.reduce((count, s) => count + Math.max(0, s.segments.length - 1), 0),
  };
}

export function oilReadout(model, date) {
  if (!model.dates.includes(date)) return null;
  const values = model.series.map(s => ({ id: s.id, name: s.name, value: s.points.find(p => p.date === date)?.value ?? null }));
  const label = dateFormat.format(dateMillis(date));
  const text = `${label}. ${values.map(s => `${s.name}: ${s.value === null ? 'no observation' : dollars.format(s.value) + ' per barrel'}`).join('. ')}.`;
  return { date, label, values, text };
}

export function nearestOilDate(model, ms) {
  if (!model.dates.length || !Number.isFinite(ms)) return null;
  return model.dates.reduce((best, date) => Math.abs(dateMillis(date) - ms) < Math.abs(dateMillis(best) - ms) ? date : best);
}

/**
 * Native SVG plus a native range input: the same observed-date readout works with
 * pointer, touch and keyboard. W3C complex-image guidance calls for accessible
 * values and descriptions: https://www.w3.org/WAI/tutorials/images/complex/
 * Keep this instance alive across updates so the date control retains focus.
 */
export function createOilChart(mount, { onReadout } = {}) {
  const id = `oil-history-${++chartSequence}`;
  let model = buildOilChartModel();
  let selectedDate = null;
  let selectedLatest = true;
  let width = 0;
  let geometry = null;
  let destroyed = false;
  mount.classList.add('oil-history-chart');
  mount.innerHTML = `<figure class="oil-history-figure">
    <figcaption class="oil-history-caption"><span>DAILY SPOT · USD / BARREL</span><span data-chart-window></span></figcaption>
    <div class="oil-history-plot" data-chart-plot></div>
    <div class="oil-history-readout" data-chart-readout></div>
    <div class="oil-history-scrubber" data-chart-controls>
      <label for="${id}-date">Inspect an observed date</label><span>Drag or use arrow keys</span>
      <input type="range" id="${id}-date" min="0" max="0" step="1" value="0" aria-describedby="${id}-note">
    </div>
    <p class="oil-history-note" id="${id}-note" data-chart-note></p>
  </figure>`;
  const plot = mount.querySelector('[data-chart-plot]');
  const readout = mount.querySelector('[data-chart-readout]');
  const input = mount.querySelector('input');
  const controls = mount.querySelector('[data-chart-controls]');
  const note = mount.querySelector('[data-chart-note]');
  const windowLabel = mount.querySelector('[data-chart-window]');

  function select(date, notify = true) {
    const detail = oilReadout(model, date);
    if (!detail) return;
    selectedDate = date;
    selectedLatest = date === model.dates.at(-1);
    input.value = String(model.dates.indexOf(date));
    input.setAttribute('aria-valuetext', detail.text);
    readout.innerHTML = `<time datetime="${date}">${esc(detail.label)}</time><dl>${detail.values.map(s => `<div class="oil-readout-series oil-series-${s.id === 'wti' ? 'wti' : 'brent'}"><dt><i aria-hidden="true"></i>${esc(s.name)}</dt><dd>${s.value === null ? '<span class="oil-no-value">— <small>No observation</small></span>' : esc(dollars.format(s.value))}</dd></div>`).join('')}</dl>`;
    const focus = plot.querySelector('[data-chart-focus]');
    if (focus && geometry) {
      const cx = geometry.x(dateMillis(date));
      focus.innerHTML = `<line x1="${cx}" x2="${cx}" y1="${geometry.top}" y2="${geometry.bottom}" class="oil-chart-crosshair"/>${detail.values.filter(s => s.value !== null).map(s => `<circle cx="${cx}" cy="${geometry.y(s.value)}" r="4" class="oil-chart-focus-dot oil-series-${s.id === 'wti' ? 'wti' : 'brent'}"/>`).join('')}`;
    }
    if (notify && typeof onReadout === 'function') onReadout(detail);
  }

  function draw() {
    if (destroyed) return;
    width = Math.max(240, Math.round(plot.clientWidth || mount.clientWidth || 600));
    if (!model.hasData) {
      geometry = null;
      plot.innerHTML = '<p class="oil-history-empty">No daily oil observations are available. Inspect Sources for the EIA connection and last successful retrieval.</p>';
      readout.replaceChildren();
      controls.hidden = true;
      windowLabel.textContent = 'No observations';
      note.textContent = 'Missing prices are not zero. EIA daily spot prices are published with a lag.';
      return;
    }
    controls.hidden = false;
    const compact = width < 400;
    const height = 280, left = 48, right = width - (compact ? 12 : 78), top = 28, bottom = height - 42;
    const span = Math.max(DAY, model.latest - model.begin);
    const x = ms => left + (ms - model.begin) / span * (right - left);
    const y = value => bottom - (value - model.yMin) / (model.yMax - model.yMin) * (bottom - top);
    geometry = { x, y, top, bottom, left, right };
    const tickCount = model.begin === model.latest ? 1 : width < 400 ? 3 : 4;
    const grid = model.ticks.map(value => {
      return `<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" class="oil-chart-grid"/><text x="${left - 10}" y="${y(value) + 4}" text-anchor="end" class="oil-chart-axis">${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}</text>`;
    }).join('');
    const ticks = Array.from({ length: tickCount }, (_, i) => {
      const ms = model.begin + (model.latest - model.begin) * i / Math.max(1, tickCount - 1);
      return `<text x="${x(ms)}" y="${bottom + 24}" text-anchor="${i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle'}" class="oil-chart-axis">${shortDate.format(ms)}</text>`;
    }).join('');
    const lines = model.series.map(s => {
      const type = s.id === 'wti' ? 'wti' : 'brent';
      return s.segments.map(segment => segment.length === 1
        ? `<circle cx="${x(segment[0].ms)}" cy="${y(segment[0].value)}" r="3" class="oil-chart-observation oil-series-${type}"/>`
        : `<path d="${segment.map((p, i) => `${i ? 'L' : 'M'}${x(p.ms).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ')}" class="oil-chart-line oil-series-${type}"/>`).join('');
    }).join('');
    const endpoints = model.series.filter(s => s.points.length).map(s => ({ ...s, point: s.points.at(-1), labelY: y(s.points.at(-1).value) })).sort((a, b) => a.labelY - b.labelY);
    // Give endpoint labels separate lanes when prices converge; leaders are annotations, not observations.
    endpoints.forEach((s, i) => { s.labelY = Math.max(top + 6, s.labelY, i ? endpoints[i - 1].labelY + 36 : top); });
    if (endpoints.length && endpoints.at(-1).labelY > bottom - 14) {
      const overflow = endpoints.at(-1).labelY - bottom + 14;
      endpoints.forEach(s => { s.labelY -= overflow; });
    }
    const labels = endpoints.map(s => `<g class="oil-chart-endpoint oil-series-${s.id === 'wti' ? 'wti' : 'brent'}"><circle cx="${x(s.point.ms)}" cy="${y(s.point.value)}" r="3"/>${compact ? '' : `<path d="M${x(s.point.ms)},${y(s.point.value)} L${right + 5},${s.labelY}" class="oil-chart-leader"/><text x="${right + 10}" y="${s.labelY - 2}"><tspan>${esc(s.id === 'brent' ? 'Brent' : s.id === 'wti' ? 'WTI' : s.name)}</tspan><tspan x="${right + 10}" dy="16">${esc(dollars.format(s.point.value))}</tspan></text>`}</g>`).join('');
    const dateRange = `${shortDate.format(model.begin)} – ${dateFormat.format(model.latest)}`;
    windowLabel.textContent = dateRange;
    plot.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-title ${id}-description" data-oil-svg>
      <title id="${id}-title">Daily Brent and WTI spot prices, U.S. dollars per barrel</title>
      <desc id="${id}-description">${esc(dateRange)}. Brent is a solid mint line; WTI is a dashed blue line. ${model.dates.length} observed dates. Lines stop across missing values or gaps longer than four calendar days. Use the date control below for exact observations. Shared timing with news does not establish causation.</desc>
      ${grid}${ticks}${lines}${labels}<g data-chart-focus aria-hidden="true"></g>
      <rect x="${left}" y="${top}" width="${Math.max(1, right - left)}" height="${bottom - top}" fill="transparent" data-chart-hit/>
    </svg>`;
    note.textContent = `${model.dates.length} observed dates · Daily spot prices, published with a lag. ${model.breakCount ? `${model.breakCount} line break${model.breakCount === 1 ? '' : 's'} for missing values or gaps over 4 days.` : 'Gaps over 4 days and missing values are not connected.'}`;
    input.max = String(model.dates.length - 1);
    input.disabled = model.dates.length < 2;
    select(selectedDate && model.dates.includes(selectedDate) ? selectedDate : model.dates.at(-1), false);
  }

  function onInput() { select(model.dates[Number(input.value)]); }
  function onPointer(event) {
    if (!geometry || !model.hasData) return;
    const svg = plot.querySelector('svg');
    const box = svg?.getBoundingClientRect();
    if (!box?.width) return;
    const cursor = (event.clientX - box.left) / box.width * width;
    const fraction = Math.max(0, Math.min(1, (cursor - geometry.left) / (geometry.right - geometry.left)));
    select(nearestOilDate(model, model.begin + fraction * (model.latest - model.begin)));
  }
  input.addEventListener('input', onInput);
  plot.addEventListener('pointermove', onPointer);
  plot.addEventListener('pointerdown', onPointer);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (Math.abs((plot.clientWidth || width) - width) > 1) draw();
  }) : null;
  observer?.observe(plot);
  draw();
  return {
    update(series, options) {
      model = buildOilChartModel(series, options);
      if (selectedLatest || !model.dates.includes(selectedDate)) selectedDate = model.dates.at(-1) || null;
      draw();
    },
    destroy() {
      destroyed = true;
      observer?.disconnect();
      input.removeEventListener('input', onInput);
      plot.removeEventListener('pointermove', onPointer);
      plot.removeEventListener('pointerdown', onPointer);
      mount.replaceChildren();
      mount.classList.remove('oil-history-chart');
    },
  };
}
