// Section motion and card stories (design-to-motion, website mode).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { storyStops, storyStep, storyLength, introDelays } from '../dist/site/stories.mjs';
import { PAGES } from '../lib/site-pages.mjs';

test('a story stops on evenly spread points and always ends on the latest one', () => {
  assert.deepEqual(storyStops(0), []);
  assert.deepEqual(storyStops(1), [0]);
  assert.deepEqual(storyStops(3), [0, 1, 2]);
  assert.deepEqual(storyStops(9), [0, 1, 3, 4, 5, 7, 8]);
  const stops = storyStops(42);
  assert.equal(stops.length, 7); assert.equal(stops[0], 0); assert.equal(stops.at(-1), 41);
});

test('a story reads each stop for a beat, holds the latest, then rests on the design', () => {
  assert.equal(storyStep(null, 7), -1, 'at rest before it starts');
  assert.equal(storyStep(0, 7), 0);
  assert.equal(storyStep(.69, 7), 0);
  assert.equal(storyStep(.71, 7), 1);
  assert.equal(storyStep(4.95, 7), 6, 'holds on the latest point');
  assert.equal(storyStep(storyLength(7) - .01, 7), -1, 'ends at rest, so every loop starts from the design');
  // One clear action every one to two seconds, and each story is three to eight seconds long.
  for (const n of [1, 3, 7]) { const length = storyLength(n); assert.ok(length >= 3 && length <= 8.5, `${n} stops: ${length}s`); }
});

test('moving parts load in reading order: text 80 ms apart, cards 85 ms apart, a card\'s contents after it', () => {
  const unit = (motion, parent = null) => { const el = { dataset: { motion }, style: { values: {}, setProperty(k, v) { this.values[k] = v; } }, parentElement: parent }; return el; };
  const card = unit('card'), cardHost = { closest: () => card };
  card.parentElement = { closest: () => null };
  const heading = unit('up', { closest: () => null }), lead = unit('up', { closest: () => null });
  const inside = [unit('up', cardHost), unit('wipe', cardHost)];
  const second = unit('card'); second.parentElement = { closest: () => null };
  const last = introDelays([heading, lead, card, ...inside, second]);
  assert.deepEqual([heading, lead, card, ...inside, second].map(el => el.style.values['--d']), ['0ms', '80ms', '160ms', '310ms', '370ms', '245ms']);
  assert.equal(last, 370);
});

test('every page holds its moving parts back before first paint, and numbers what enters at load', async () => {
  for (const page of PAGES) {
    const html = await readFile(new URL(`../dist/${page.file}`, import.meta.url), 'utf8');
    assert.match(html, /<script src="\/site\/motion-early\.js"><\/script>\s*<link rel="preload"/, `${page.file}: the early script runs in the head, before the styles`);
    for (const block of html.match(/<section [^>]*data-intro="load"[\s\S]*?<\/section>/g) || []) {
      for (const tag of block.match(/<[^>]+data-motion="[a-z]+"[^>]*>/g) || []) assert.match(tag, /style="--i:\d+"/, `${page.file}: ${tag.slice(0, 60)} has its place in the order`);
    }
  }
});
