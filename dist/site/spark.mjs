// Small inline charts for the overview cards, drawn only from observed values.
// A missing value breaks the line or leaves its bar out; nothing is filled in.
const W = 300, H = 56;
const fmt = n => n.toFixed(1);
const attr = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** A line through observed values (null breaks it), scaled to the card. */
export function sparkLine(values, { label = '' } = {}) {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return '';
  const min = Math.min(...finite), max = Math.max(...finite), span = max - min || 1, step = W / (values.length - 1);
  let d = '', open = false;
  values.forEach((value, i) => {
    if (!Number.isFinite(value)) { open = false; return; }
    d += `${open ? 'L' : 'M'}${fmt(i * step)},${fmt(H - 4 - (value - min) / span * (H - 8))}`; open = true;
  });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${attr(label)}"><path class="spark-line" d="${d}"/></svg>`;
}

/** Bars for counts, with an optional dashed baseline (an average to compare against). */
export function sparkBars(rows, { label = '', baseline = null } = {}) {
  if (!rows.length) return '';
  const max = Math.max(1, baseline || 0, ...rows.map(r => r.value || 0)), step = W / rows.length, bar = Math.max(1, step - 2);
  const bars = rows.map((r, i) => {
    const h = (r.value || 0) / max * (H - 2);
    return `<rect class="spark-bar"${r.kind ? ` data-kind="${r.kind}"` : ''} x="${fmt(i * step)}" y="${fmt(H - h)}" width="${fmt(bar)}" height="${fmt(h)}"/>`;
  }).join('');
  const base = Number.isFinite(baseline) ? `<line class="spark-base" x1="0" x2="${W}" y1="${fmt(H - baseline / max * (H - 2))}" y2="${fmt(H - baseline / max * (H - 2))}"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${attr(label)}">${bars}${base}</svg>`;
}
