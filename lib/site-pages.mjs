// The site's pages and the navigation and footer they share. The local server
// and the Pages build both expand the include markers below, so every page
// carries the same links with its own one marked as current.
import { icon } from '../dist/site/icons.mjs';
import { ABOUT_NOTES, esc } from '../dist/ops/panels.mjs';

export const REPOSITORY_URL = 'https://github.com/MylesHamm/passage';
/** Every page, in navigation order. `nav` pages appear in the menu; `current` names the menu entry an unlisted page belongs to. */
export const PAGES = Object.freeze([
  Object.freeze({ path: '/', file: 'index.html', label: 'Overview' }),
  Object.freeze({ path: '/hormuz/', file: 'hormuz/index.html', label: 'Hormuz live', nav: true }),
  Object.freeze({ path: '/war/', file: 'war/index.html', label: 'Regional war', nav: true }),
  Object.freeze({ path: '/events/', file: 'events/index.html', label: 'Events', nav: true }),
  Object.freeze({ path: '/event/', file: 'event/index.html', label: 'Event', current: '/events/' }),
  Object.freeze({ path: '/oil/', file: 'oil/index.html', label: 'Oil and odds', nav: true }),
  Object.freeze({ path: '/method/', file: 'method/index.html', label: 'Method', nav: true }),
  Object.freeze({ path: '/404', file: '404.html', label: 'Not found' }),
]);
const NAV = PAGES.filter(page => page.nav);

/** The page a site path belongs to, or null. */
export const pageFor = path => PAGES.find(page => page.path === path || (page.path === '/' ? path === '/index.html' : path === page.path + 'index.html')) || null;
/** The site path a built file is served at. */
export const pathForFile = file => PAGES.find(page => page.file === file)?.path ?? null;

function links(current, { className = '' } = {}) {
  return NAV.map(page => `<li><a${className ? ` class="${className}"` : ''} href="${page.path}"${page.path === current ? ' aria-current="page"' : ''}>${page.label}</a></li>`).join('');
}

export function navMarkup(path) {
  const page = pageFor(path), current = page?.current || page?.path || '';
  return `<a class="skip" href="#main">Skip to content</a>
<header class="site-nav">
  <nav class="nav-bar" aria-label="Main">
    <a class="nav-brand" href="/"${current === '/' ? ' aria-current="page"' : ''}>PASSAGE</a>
    <ul class="nav-links">${links(current)}</ul>
    <a class="nav-status" href="/method/#sources" data-state="checking"><i aria-hidden="true"></i><span data-status-text>Checking sources</span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-menu" aria-label="Open the menu"><span></span><span></span></button>
  </nav>
  <div class="nav-menu" id="nav-menu" hidden>
    <ul>${current === '/' ? '' : '<li><a href="/">Overview</a></li>'}${links(current)}</ul>
  </div>
</header>`;
}

export function footerMarkup() {
  return `<footer class="site-footer">
  <div class="footer-grid">
    <div class="footer-brand">
      <a class="nav-brand" href="/">PASSAGE</a>
      <p>A free monitor of the regional war, from the Gulf to the Red Sea. No sign in, and every figure carries its source and date.</p>
    </div>
    <nav aria-label="Pages"><h2>Pages</h2><ul>${links('')}</ul></nav>
    <nav aria-label="About Passage"><h2>About</h2><ul>
      <li><a href="/method/#sources">Sources and status</a></li>
      <li><a href="/method/#privacy">Privacy</a></li>
      <li><a href="/method/#terms">Terms of use</a></li>
      <li><a href="${REPOSITORY_URL}" rel="noopener">Source code ${icon('arrow-up-right')}</a></li>
    </ul></nav>
  </div>
  <p class="footer-note">Not a nautical chart and not advice. Each source keeps its own terms.</p>
</footer>`;
}

// The method page asks each "how to read this" note as a question.
const NOTE_QUESTIONS = {
  Vessels: 'Where do the vessel positions come from?',
  'Ship models': 'What do the ship models show?',
  'AIS gaps': 'How is an AIS gap counted?',
  'Tracks and replay': 'What do the tracks and the replay show?',
  Transits: 'Where do the transit counts come from?',
  'Oil prices': 'Where do the oil prices come from?',
  'Market odds': 'What do the market odds mean?',
  'War events': 'How are war events chosen and placed?',
  'Naval missions': 'How are naval missions drawn?',
  'Show me': 'Does Passage say an event moved the price?',
  Headlines: 'Where do the headlines come from?',
};
const faqItem = (question, answer) => `<details><summary><span>${esc(question)}</span>${icon('caret-down')}</summary><div class="answer"><p>${esc(answer)}</p></div></details>`;
export const methodFaqMarkup = () => ABOUT_NOTES.map(([label, text]) => faqItem(NOTE_QUESTIONS[label] || label, text)).join('\n');

const plain = html => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
/** Question and answer pairs from a page's FAQ, read from its own markup. */
export function faqPairs(html) {
  const start = html.indexOf('<div class="faq" data-faq>'), block = start < 0 ? '' : html.slice(start);
  return [...block.matchAll(/<details>\s*<summary><span>([\s\S]*?)<\/span>[\s\S]*?<\/summary>\s*<div class="answer">([\s\S]*?)<\/div>\s*<\/details>/g)].map(m => ({ question: plain(m[1]), answer: plain(m[2]) }));
}
const faqSchema = pairs => `<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: pairs.map(p => ({ '@type': 'Question', name: p.question, acceptedAnswer: { '@type': 'Answer', text: p.answer } })),
}).replace(/</g, '\\u003c')}</script>`;

/**
 * Expands the shared navigation, footer, icons and method notes into a page
 * served at `path`, and adds FAQ structured data for search and answer engines.
 */
export function renderShell(html, path) {
  let out = html.replace('<!-- passage:nav -->', () => navMarkup(path)).replace('<!-- passage:footer -->', () => footerMarkup())
    .replace('<!-- passage:method-faq -->', () => methodFaqMarkup())
    .replace(/<!-- icon:([a-z-]+) -->/g, (_, name) => icon(name));
  const pairs = faqPairs(out);
  if (pairs.length) out = out.replace('</head>', () => `${faqSchema(pairs)}\n</head>`);
  return out;
}
