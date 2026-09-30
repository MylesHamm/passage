// Navigation is independent of source refreshes; changing views never resets filters.
export const WORKSPACES = ['overview', 'reporting', 'energy', 'evidence'];
export function workspaceFor(view) {
  return ['saved', 'civilian'].includes(view) ? 'reporting' : WORKSPACES.includes(view) ? view : 'overview';
}
export function adjacentWorkspace(view, key) {
  const index = WORKSPACES.indexOf(workspaceFor(view));
  if (key === 'Home') return WORKSPACES[0];
  if (key === 'End') return WORKSPACES.at(-1);
  if (!['ArrowLeft', 'ArrowRight'].includes(key)) return null;
  return WORKSPACES[(index + (key === 'ArrowRight' ? 1 : -1) + WORKSPACES.length) % WORKSPACES.length];
}

const guidance = [
  ['Orient on the globe', 'Choose a chokepoint or inspect a received vessel. The priority selection highlights relevant reporting; it is not a count of incidents.'],
  ['Follow a development', 'Search or choose an actor, then select a headline. The evidence drawer keeps the original source, its dates and the possible oil connection together.'],
  ['Compare the market', 'Inspect dated Brent and WTI observations. Use the chart’s date control, then compare the separately labelled market expectations.'],
  ['Check what supports it', 'Inspect official records, regional infrastructure and coverage. A successful refresh does not establish complete coverage.'],
];

export function createWorkspaceView({ root = document, onNavigate } = {}) {
  let view = 'overview', guided = false;
  const get = selector => root.querySelector(selector);
  const all = selector => [...root.querySelectorAll(selector)];
  const nav = get('.workspace-tabs');
  function renderGuide() {
    get('#walkthrough').hidden = !guided;
    if (!guided) return;
    const index = WORKSPACES.indexOf(workspaceFor(view));
    get('#walkthrough-step').textContent = `${index + 1} / 4 · ${guidance[index][0]}`;
    get('#walkthrough-copy').textContent = guidance[index][1];
    get('#walkthrough-back').disabled = index === 0;
    get('#walkthrough-next').textContent = index === 3 ? 'Finish walkthrough ✓' : 'Next →';
  }
  function update(next) {
    const scene = workspaceFor(next), previous = workspaceFor(view);
    view = next;
    for (const panel of all('.workspace-scene')) {
      const visible = panel.id === `scene-${scene}`;
      panel.hidden = !visible;
      panel.classList.toggle('scene-enter', visible && previous !== scene);
    }
    for (const button of all('.workspace-tabs [data-view]')) {
      const selected = button.dataset.view === scene;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle('active', selected);
    }
    get('#reporting-all').setAttribute('aria-pressed', String(next !== 'saved'));
    get('#reporting-saved').setAttribute('aria-pressed', String(next === 'saved'));
    renderGuide();
  }
  function navigate(next, fromGuide = false) {
    if (!fromGuide) guided = false;
    onNavigate(next);
    renderGuide();
  }
  nav.addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (button) navigate(button.dataset.view);
  });
  // WAI-ARIA APG tabs: roving focus and automatic activation for local panels.
  nav.addEventListener('keydown', event => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    const next = adjacentWorkspace(button.dataset.view, event.key);
    if (!next) return;
    event.preventDefault(); navigate(next); get(`#tab-${next}`).focus();
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-workspace-view]');
    if (!button) return;
    navigate(button.dataset.workspaceView);
    // The clicked control may now be hidden. Land on the destination heading.
    get('#view-title').focus({ preventScroll: true });
    get('#workspace').scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  get('#walkthrough-start').onclick = () => {
    guided = true; navigate('overview', true); get('#walkthrough-next').focus({ preventScroll: true });
  };
  get('#walkthrough-exit').onclick = () => {
    guided = false; renderGuide(); get(`#tab-${workspaceFor(view)}`).focus({ preventScroll: true });
  };
  get('#walkthrough-back').onclick = () => navigate(WORKSPACES[Math.max(0, WORKSPACES.indexOf(workspaceFor(view)) - 1)], true);
  get('#walkthrough-next').onclick = () => {
    const index = WORKSPACES.indexOf(workspaceFor(view));
    if (index < 3) navigate(WORKSPACES[index + 1], true);
    else { guided = false; renderGuide(); get('#tab-evidence').focus({ preventScroll: true }); }
  };
  update('overview');
  return { update };
}
