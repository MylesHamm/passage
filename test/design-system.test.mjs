// The design system's rules, checked in the stylesheets themselves: Tailwind's
// type scale with paired line heights, the spacing steps, Tailwind radii, flat
// dark backgrounds, no italics or ultra bold weights, and one easing curve with
// nothing faster than 200 ms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SHEETS = ['site.css', 'ops.css', 'oil-chart.css', 'motion.css'];
const css = Object.fromEntries(await Promise.all(SHEETS.map(async name => [name, (await readFile(new URL(`../dist/${name}`, import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')])));
/** Every rule as { sheet, selector, declarations }, including rules nested in @media. */
function rules() {
  const out = [];
  for (const [sheet, source] of Object.entries(css)) {
    for (const match of source.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const declarations = Object.fromEntries(match[2].split(';').map(d => d.trim()).filter(Boolean).map(d => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; }));
      // @font-face declares the variable font's whole weight range; it is not a rule that styles anything.
      if (!declarations.src) out.push({ sheet, selector: match[1].trim(), declarations });
    }
  }
  return out;
}
const RULES = rules();
const SCALE = { 12: '16px', 14: '20px', 16: '24px', 18: '28px', 20: '28px', 24: '32px', 30: '36px', 36: '40px', 48: '1', 60: '1', 72: '1', 96: '1', 128: '1' };
const SPACING = new Set([0, 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96]);
const RADII = new Set([0, 2, 4, 6, 8, 12, 16, 24, 9999]);
const BACKGROUNDS = new Set(['#000000', '#181818', '#1f1f1f', '#272727', '#313131', '#131209']);
// SVG text takes no line height.
const SVG_TEXT = /oil-chart-axis|oil-chart-endpoint text|mission-label/;

test('every font size is a step of the type scale, with its paired line height', () => {
  for (const { sheet, selector, declarations: d } of RULES) {
    if (!d['font-size']) continue;
    const size = Number(/^(\d+)px$/.exec(d['font-size'])?.[1]);
    assert.ok(SCALE[size], `${sheet} ${selector}: font-size ${d['font-size']} is off the scale`);
    if (SVG_TEXT.test(selector)) continue;
    assert.equal(d['line-height'], SCALE[size], `${sheet} ${selector}: ${size}px pairs with line-height ${SCALE[size]}`);
  }
  for (const { sheet, selector, declarations: d } of RULES) assert.ok(!d.font || d.font === 'inherit', `${sheet} ${selector}: use font-size and line-height, not the font shorthand`);
});

test('padding, margins and gaps use only the spacing steps', () => {
  for (const { sheet, selector, declarations } of RULES) {
    for (const [property, value] of Object.entries(declarations)) {
      if (!/^(?:padding|margin|gap|row-gap|column-gap)(?:-|$)/.test(property)) continue;
      for (const token of value.split(/\s+/)) {
        const px = /^(-?[\d.]+)px$/.exec(token)?.[1];
        if (px === undefined) { assert.ok(['0', 'auto'].includes(token), `${sheet} ${selector}: ${property} ${value}`); continue; }
        // Negative margins center markers on their point; they are geometry, not spacing.
        if (Number(px) < 0) continue;
        assert.ok(SPACING.has(Number(px)), `${sheet} ${selector}: ${property} ${value} is off the spacing scale`);
      }
    }
  }
});

test('corner radii are Tailwind radii', () => {
  for (const { sheet, selector, declarations: d } of RULES) {
    if (!d['border-radius']) continue;
    for (const token of d['border-radius'].split(/\s+/)) assert.ok(RADII.has(Number(/^(\d+)px$/.exec(token)?.[1] ?? NaN)) || token === '0', `${sheet} ${selector}: border-radius ${d['border-radius']}`);
  }
});

test('backgrounds are flat, and opaque surfaces use the dark palette', () => {
  for (const { sheet, selector, declarations: d } of RULES) {
    const background = d.background || d['background-color'] || '';
    if (/gradient\(/.test(background)) assert.equal(d['background-clip'], 'text', `${sheet} ${selector}: gradients appear only on hero heading text`);
    const opaque = /^#[\da-f]{6}$/i.exec(background)?.[0];
    // White is the primary button, never a page or card surface.
    if (opaque && !/button-primary/.test(selector)) assert.ok(BACKGROUNDS.has(opaque.toLowerCase()), `${sheet} ${selector}: background ${opaque} is not in the dark palette`);
  }
});

test('no italics, no ultra bold weights and no one-sided card borders', () => {
  for (const { sheet, selector, declarations: d } of RULES) {
    assert.notEqual(d['font-style'], 'italic', `${sheet} ${selector}`);
    if (d['font-weight']) assert.ok(Number(d['font-weight']) <= 700, `${sheet} ${selector}: font-weight ${d['font-weight']}`);
    for (const side of ['border-top', 'border-right', 'border-bottom', 'border-left']) {
      // Legend swatches draw a line with a top border; nothing else may have one side only.
      if (d[side] && !/k-track|\.px(?:\.\w+)? span i|oil-readout-series(?:\.\w+)? dt i/.test(selector + side)) assert.fail(`${sheet} ${selector}: ${side} on one side only`);
    }
  }
});

test('transitions use the shared curve, never a browser default, and nothing runs under 200 ms', () => {
  for (const { sheet, selector, declarations: d } of RULES) {
    for (const property of ['transition', 'transition-timing-function', 'animation']) {
      const value = d[property];
      if (!value) continue;
      assert.doesNotMatch(value, /(?:^|[\s,])(?:ease|ease-in|ease-out|ease-in-out|linear)(?=$|[\s,])/, `${sheet} ${selector}: ${property} uses a browser default curve`);
      for (const ms of value.matchAll(/(\d+)ms/g)) assert.ok(Number(ms[1]) === 0 || Number(ms[1]) >= 200, `${sheet} ${selector}: ${ms[0]} is under 200 ms`);
    }
  }
  assert.match(css['site.css'], /--ease: cubic-bezier\(0\.22, 1, 0\.36, 1\);/);
});

test('one typeface, with Geist Mono only for figures', () => {
  const families = new Set();
  for (const source of Object.values(css)) for (const m of source.matchAll(/font-family:\s*([^;]+);/g)) families.add(m[1].trim());
  for (const family of families) assert.ok(['var(--font)', 'var(--mono)', 'inherit', "'Geist'", "'Geist Mono'"].includes(family), `font-family ${family}`);
  assert.doesNotMatch(Object.values(css).join('\n'), /Inter\b|Roboto|Arial|Helvetica|Open Sans|IBM Plex/);
});
