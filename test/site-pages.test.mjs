// Every page is a landing page: one main action in its hero, a tagline, its own
// questions and a closing action, with the shared navigation marking where you
// are. The copy follows the house rules: no hyphenated words, no dashes, US
// spelling and no filler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PAGES, renderShell, navMarkup, faqPairs } from '../lib/site-pages.mjs';

const pages = await Promise.all(PAGES.map(async page => ({ ...page, html: renderShell(await readFile(new URL(`../dist/${page.file}`, import.meta.url), 'utf8'), page.path) })));
const landing = pages.filter(page => page.path !== '/404');
const visibleText = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<head>[\s\S]*?<\/head>/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const count = (html, pattern) => (html.match(pattern) || []).length;

test('every page has its own title, description, one heading and the shared frame', () => {
  const titles = new Set(), descriptions = new Set();
  for (const page of pages) {
    const title = /<title>([^<]+)<\/title>/.exec(page.html)?.[1], description = /<meta name="description" content="([^"]+)">/.exec(page.html)?.[1];
    assert.ok(title && description, `${page.file}: title and description`);
    titles.add(title); descriptions.add(description);
    assert.equal(count(page.html, /<h1[\s>]/g), 1, `${page.file}: one h1`);
    assert.match(page.html, /<main id="main">/, `${page.file}: main landmark`);
    assert.match(page.html, /<a class="skip" href="#main">/, `${page.file}: skip link`);
    assert.match(page.html, /<footer class="site-footer">/, `${page.file}: footer`);
    assert.match(page.html, /href="\/method\/#privacy"[\s\S]*href="\/method\/#terms"/, `${page.file}: privacy and terms links`);
    assert.match(page.html, /<meta name="passage-api-base" content="">/, `${page.file}: runtime configuration`);
    assert.match(page.html, /<script type="module" src="\/(?:pages\/[a-z]+|site\/shell)\.mjs"><\/script>/, `${page.file}: its page script`);
  }
  assert.equal(titles.size, pages.length, 'titles are distinct');
  assert.equal(descriptions.size, pages.length, 'descriptions are distinct');
});

test('the navigation marks the current page, and an event belongs to Events', () => {
  assert.match(navMarkup('/war/'), /<a href="\/war\/" aria-current="page">Regional war<\/a>/);
  assert.match(navMarkup('/event/'), /<a href="\/events\/" aria-current="page">Events<\/a>/);
  assert.match(navMarkup('/'), /<a class="nav-brand" href="\/" aria-current="page">/);
  assert.doesNotMatch(navMarkup('/404'), /aria-current/);
  for (const page of pages) assert.equal(count(navMarkup(page.path), /aria-current="page"/g), page.path === '/404' ? 0 : page.path === '/' ? 1 : 2, `${page.path}: one menu entry marked, in the bar and the phone menu`);
});

test('each landing page wins one action: one primary button in its hero, the same idea at its close', () => {
  for (const page of landing) {
    const hero = /<section [^>]*class="page-hero[\s\S]*?<\/section>/.exec(page.html)?.[0] || '';
    assert.equal(count(hero, /button-primary/g), 1, `${page.file}: one primary action above the fold`);
    assert.match(page.html, /<div class="container cta-band">[\s\S]*?button-primary/, `${page.file}: closing call to action`);
  }
});

test('each landing page has a tagline of two lines or more, and its own questions', () => {
  for (const page of landing) {
    const tagline = /<p class="tagline" data-tagline>([^<]+)<\/p>/.exec(page.html)?.[1] || '';
    assert.ok(tagline.split(/\s+/).length >= 10, `${page.file}: a tagline long enough for two lines`);
    const pairs = faqPairs(page.html);
    assert.ok(pairs.length >= (page.path === '/' ? 6 : 3), `${page.file}: ${pairs.length} questions`);
    for (const { question, answer } of pairs) { assert.match(question, /\?$/, `${page.file}: ${question}`); assert.ok(answer.length > 40, `${page.file}: ${question} has a real answer`); }
    assert.match(page.html, /<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"FAQPage"/, `${page.file}: FAQ structured data`);
  }
});

test('the copy has no hyphenated words, no dashes, US spelling and no filler', () => {
  const PROPER = new Set(['el-Mandeb']);
  const BRITISH = /\b(?:colour|behaviour|neighbour|favour|labour|honour|centre|centred|metres?|organis\w*|recognis\w*|prioritis\w*|standardis\w*|analys(?:e|ed|ing)\b|licence|catalogue|programme|travelled|modelled|labelled)\b/i;
  const FILLER = /\b(?:revolutioni[sz]e|supercharge|cutting edge|effortless|transform your workflow|next level|harness the power|world class|seamless|unlock)\b/i;
  for (const page of pages) {
    const text = visibleText(page.html);
    for (const word of text.match(/\b[A-Za-z]+-[A-Za-z]+\b/g) || []) assert.ok(PROPER.has(word), `${page.file}: hyphenated "${word}"`);
    assert.doesNotMatch(text, /\w\s?[–—]\s?\w/, `${page.file}: a dash in the copy`);
    assert.doesNotMatch(text, BRITISH, `${page.file}: British spelling`);
    assert.doesNotMatch(text, FILLER, `${page.file}: filler`);
    assert.doesNotMatch(text, /!/, `${page.file}: no exclamation marks`);
  }
});
