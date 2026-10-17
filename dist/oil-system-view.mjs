import { buildOilSystemState } from './oil-system-model.mjs';
import { oilSystemArt } from './oil-system-art.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => value ? new Date(value).toLocaleDateString('en-US', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}) : 'Not available';
const time = value => value ? new Date(value).toLocaleString('en-GB', {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}) + ' UTC' : 'Unknown';
const replace = (node, html) => { if (node.innerHTML !== html) node.innerHTML = html; };

/** Selection is local; source refreshes never reset the selected part or report. */
export function createOilSystemView(root, {motionPreference = matchMedia('(prefers-reduced-motion: reduce)')} = {}) {
  let input = {}, model = buildOilSystemState(), active = false, visible = false, renderedStage = null, renderedExpanded = model.expanded;
  const reduced = motionPreference;
  root.innerHTML = `<header class="system-heading"><div><span class="system-kicker">THE OIL SYSTEM / INTERACTIVE EXPLAINER</span><h2 id="oil-system-heading" tabindex="-1">How a claim connects to oil</h2><p>Explore a channel. Inspect the evidence. Then compare the observations.</p></div><button type="button" class="system-toggle" aria-pressed="false">Separate layers</button></header>
    <div class="system-context"><div><span data-context-scope></span><p data-context-title></p><small data-context-note></small></div><button type="button" class="text-button" data-system-clear hidden>Clear report</button></div>
    <div class="system-layout"><div class="system-figure"><div class="system-canvas">${oilSystemArt(model.stages)}</div><div class="system-controls" role="group" aria-label="Oil system parts">${model.stages.map((stage,index)=>`<button type="button" class="system-stage" data-system-select="${stage.id}" aria-pressed="${stage.selected}" aria-controls="system-readout"><span>0${index+1}</span><strong>${escape(stage.title)}</strong><small>${escape(stage.short)}</small></button>`).join('')}</div><p class="system-note">Conceptual mechanisms · the tanker cutaway reveals structure, not cargo levels or current status.</p></div>
    <section class="system-readout" id="system-readout" aria-labelledby="system-part-title"><span class="system-selected-label">SELECTED CHANNEL</span><h3 id="system-part-title"></h3><div data-system-explanation></div><p class="system-note" data-price-note hidden></p></section></div>
    <footer class="system-footer"><p>Demand, inventories, production policy and expectations also shape prices. This is a framework for checking evidence, not a forecast.</p><a class="text-button" href="#oil-heading" data-system-chart>Compare daily observations ↑</a></footer><span class="sr-only system-status" role="status" aria-live="polite"></span>`;
  const q = selector => root.querySelector(selector);
  const controls = [...root.querySelectorAll('[data-system-select]')];
  function motion() { root.dataset.motion = active && visible && !document.hidden && !reduced.matches ? 'on' : 'off'; }
  const observer = new IntersectionObserver(entries => { visible = entries.at(-1)?.isIntersecting === true; motion(); }, {threshold:0});
  observer.observe(root);
  document.addEventListener('visibilitychange', motion);
  reduced.addEventListener('change', motion);
  function render() {
    model = buildOilSystemState(input);
    // Separating or reassembling moves the layers in reading order (reverse on return);
    // a selection lift stays immediate.
    const regrouped = renderedExpanded !== model.expanded, count = model.stages.length;
    renderedExpanded = model.expanded;
    for (const [index, stage] of model.stages.entries()) {
      const part = q(`[data-system-part="${stage.id}"]`);
      part.style.transitionDelay = regrouped ? `${(model.expanded ? index : count - 1 - index) * 40}ms` : '0ms';
      part.style.transform = `translate(${stage.position.x}px, ${stage.position.y}px)`;
      part.classList.toggle('is-selected', stage.selected);
      part.classList.toggle('is-matched', stage.matched);
      const control = controls.find(button => button.dataset.systemSelect === stage.id);
      control.setAttribute('aria-pressed', String(stage.selected));
      control.querySelector('small').textContent = stage.matched ? 'Suggested by report text' : stage.short;
    }
    q('.system-toggle').textContent = model.expanded ? 'Assembled view' : 'Separate layers';
    q('.system-toggle').setAttribute('aria-pressed', String(model.expanded));
    q('.system-context').dataset.report = String(Boolean(model.context.report));
    q('[data-context-scope]').textContent = model.context.title + ' · conceptual framework';
    q('[data-context-title]').textContent = model.context.report?.title || 'Start with the channel you want to understand.';
    q('[data-context-note]').textContent = model.context.report
      ? `${model.context.report.source || 'Selected reporting'} · ${model.context.publication ? 'Published ' + (model.context.publication.precision === 'day' ? date(model.context.publication.value) : time(model.context.publication.value)) : 'Publication date unknown'}. ${model.context.label}.`
      : 'Select an illustrated part or use the numbered controls below.';
    q('[data-system-clear]').hidden = !model.context.report;
    if (renderedStage !== model.selected) {
      renderedStage = model.selected;
      q('#system-part-title').textContent = model.activeStage.title;
      replace(q('[data-system-explanation]'), `<p>${escape(model.caption)}</p><div class="system-evidence"><h4>Evidence to look for</h4><p>${escape(model.activeStage.evidence)}</p></div><p class="system-note">${escape(model.activeStage.measurementNote)}</p><a href="${escape(model.activeStage.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escape(model.activeStage.sourceName)} ↗</a>`);
    }
    q('[data-price-note]').hidden = model.selected !== 'benchmarks';
    q('[data-price-note]').textContent = model.priceNote;
    // Every entry point shares the same accessible state. Refreshing observations
    // must not repeat an unchanged selection or expansion announcement.
    const status = q('.system-status');
    const announcement = `${model.activeStage.title}. ${model.expanded ? 'Layers separated.' : 'Assembled view.'}`;
    if (status.textContent !== announcement) status.textContent = announcement;
  }
  function select(id) { input.selected = id; render(); }
  function onClick(event) {
    const selection = event.target.closest('[data-system-select], [data-system-part]');
    if (selection) select(selection.dataset.systemSelect || selection.dataset.systemPart);
    else if (event.target.closest('.system-toggle')) { input.expanded = !model.expanded; render(); }
    else if (event.target.closest('[data-system-clear]')) { input.report = null; render(); controls.find(b=>b.dataset.systemSelect===model.selected).focus(); }
    else if (event.target.closest('[data-system-chart]')) {
      event.preventDefault(); document.querySelector('#oil-heading').focus({preventScroll:true}); document.querySelector('#oil-heading').scrollIntoView({block:'start',behavior:'instant'});
    }
  }
  root.addEventListener('click', onClick);
  function onKey(event) {
    const current = controls.indexOf(event.target);
    if (current < 0 || !['ArrowRight','ArrowLeft','ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length-1 : (current + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1) + controls.length) % controls.length;
    controls[index].focus(); select(controls[index].dataset.systemSelect);
  }
  root.addEventListener('keydown', onKey);
  render(); motion();
  return {
    update(next) { input = {...input, ...next}; render(); },
    setActive(value) { active = Boolean(value); motion(); },
    open(report = null) {
      input.report = report;
      const next = buildOilSystemState(input);
      if (report) input.selected = next.context.matchedStageIds[0] || 'supply';
      render(); root.scrollIntoView({block:'start',behavior:'instant'}); q('#oil-system-heading').focus({preventScroll:true});
    },
    destroy() { observer.disconnect(); document.removeEventListener('visibilitychange',motion); reduced.removeEventListener('change',motion); root.removeEventListener('click',onClick); root.removeEventListener('keydown',onKey); },
  };
}
