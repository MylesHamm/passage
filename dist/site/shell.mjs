// Behavior every page shares: the menu, the source status in the navigation,
// sections that rise into view once, and the tagline whose words light up in
// reading order as it scrolls past. Page modules import it first.
import { runtime } from '../runtime-config.mjs';
import { statusSummary, esc } from '../ops/panels.mjs';
import { load, every } from './data.mjs';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function bindMenu() {
  const toggle = document.querySelector('.nav-toggle'), menu = document.getElementById('nav-menu');
  if (!toggle || !menu) return;
  let closing = 0;
  const set = open => {
    clearTimeout(closing);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu');
    document.documentElement.dataset.menu = open ? 'open' : '';
    if (open) {
      menu.hidden = false;
      // Two frames, so the panel is laid out before its links start to rise.
      requestAnimationFrame(() => requestAnimationFrame(() => { menu.dataset.open = 'true'; }));
    } else {
      menu.dataset.open = 'false';
      closing = setTimeout(() => { menu.hidden = true; }, reduced() ? 0 : 300);
    }
  };
  toggle.addEventListener('click', () => set(toggle.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', event => { if (event.target.closest('a')) set(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { set(false); toggle.focus(); } });
  matchMedia('(min-width: 1180px)').addEventListener('change', event => { if (event.matches) set(false); });
}

/** The status link in the navigation: how many sources are current. */
async function loadStatus() {
  const pill = document.querySelector('.nav-status');
  if (!pill) return;
  let summary;
  try { summary = statusSummary((await load('/api/diagnostics')).sources || []); }
  catch { summary = { state: 'down', text: runtime.configurationError ? 'Live data not configured' : 'Sources unavailable' }; }
  pill.dataset.state = summary.state;
  pill.querySelector('[data-status-text]').textContent = summary.text;
  pill.setAttribute('aria-label', `${summary.text}. See every source and its status.`);
}

/** Sections marked data-reveal rise 32px and fade in once, as they enter the viewport. */
export function bindReveals(root = document) {
  const nodes = [...root.querySelectorAll('[data-reveal]:not([data-revealed])')];
  if (!nodes.length || typeof IntersectionObserver !== 'function') return;
  document.documentElement.classList.add('reveal-ready');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.dataset.revealed = 'true'; observer.unobserve(entry.target); }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0 });
  for (const node of nodes) observer.observe(node);
}

/**
 * The tagline: every word starts muted and lights up in reading order as the
 * block scrolls through the middle of the viewport. One scroll listener,
 * throttled to animation frames and attached only while a tagline is on screen.
 */
export function bindTaglines(root = document) {
  const blocks = [...root.querySelectorAll('[data-tagline]')];
  if (!blocks.length) return;
  for (const block of blocks) {
    if (block.dataset.split) continue;
    block.innerHTML = block.textContent.trim().split(/\s+/).map(word => `<span class="w">${esc(word)}</span>`).join(' ');
    block.dataset.split = 'true';
  }
  if (reduced() || typeof IntersectionObserver !== 'function') { for (const block of blocks) block.dataset.static = 'true'; return; }
  const onScreen = new Set();
  let frame = 0;
  const update = () => {
    frame = 0;
    for (const block of onScreen) {
      const box = block.getBoundingClientRect(), words = block.querySelectorAll('.w');
      // From the block's top reaching 85% of the viewport to its middle reaching 40%.
      const progress = Math.min(1, Math.max(0, (innerHeight * .85 - box.top) / (innerHeight * .45 + box.height / 2)));
      const lit = Math.round(progress * words.length);
      words.forEach((word, index) => { const on = String(index < lit); if (word.dataset.on !== on) word.dataset.on = on; });
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) entry.isIntersecting ? onScreen.add(entry.target) : onScreen.delete(entry.target);
    if (onScreen.size) { addEventListener('scroll', schedule, { passive: true }); addEventListener('resize', schedule); schedule(); }
    else { removeEventListener('scroll', schedule); removeEventListener('resize', schedule); }
  });
  for (const block of blocks) observer.observe(block);
}

/** Starts the shared behavior; importing this module calls it once. */
export function startShell() {
  bindMenu();
  bindReveals();
  bindTaglines();
  every(60_000, loadStatus);
}
startShell();
