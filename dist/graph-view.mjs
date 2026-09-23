const SVG_NS = 'http://www.w3.org/2000/svg';
import { GRAPH_TYPES, summarizeGraphNode } from './investigate-model.mjs';
const TYPES = { report: 'Report', actor: 'Actor', event: 'Event', asset: 'Infrastructure', market: 'Market', channel: 'Mechanism' };
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export { selectNeighborhood } from './investigate-model.mjs';

/** Wrap the complete label; the graph never substitutes an ellipsis for its meaning. */
export function wrapNodeLabel(value, maxCharacters = 28) {
  const limit = Math.max(8, maxCharacters), words = String(value || 'Untitled source').trim().split(/\s+/), lines = [];
  let line = '';
  for (let word of words) {
    if (line && line.length + word.length + 1 > limit) { lines.push(line); line = ''; }
    while (word.length > limit) { lines.push(word.slice(0, limit)); word = word.slice(limit); }
    if (word) line += `${line ? ' ' : ''}${word}`;
  }
  if (line) lines.push(line);
  return lines;
}

/** Category columns use full-height labels and scroll instead of shrinking text. */
export function layoutNeighborhood(nodes, selectedId, width, edges = []) {
  const positions = new Map(), groups = [], columns = width >= 600 ? 3 : 2;
  const gap = 20, padding = 16, columnWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
  const card = (node, cardWidth) => {
    const summary = summarizeGraphNode(node, { nodes, edges }), capacity = Math.max(8, Math.floor((cardWidth - 40) / 6.7));
    const lines = wrapNodeLabel(summary.title, capacity);
    const details = wrapNodeLabel([summary.detail, summary.qualification].filter(Boolean).join(' · '), Math.max(10, Math.floor((cardWidth - 40) / 5.4)));
    return { width: cardWidth, height: Math.max(54, lines.length * 16 + details.length * 13 + 28), lines, details };
  };
  const selected = nodes.find(node => node.id === selectedId);
  const root = selected ? card(selected, Math.min(width - padding * 2, 360)) : null;
  if (root) positions.set(selectedId, { ...root, x: 0, y: 22 + root.height / 2 });
  const tops = Array(columns).fill(root ? root.height + 64 : 24);
  for (const [type, label] of GRAPH_TYPES) {
    const items = nodes.filter(node => node.id !== selectedId && node.type === type);
    if (!items.length) continue;
    const column = tops.indexOf(Math.min(...tops)), x = padding + column * (columnWidth + gap) + columnWidth / 2 - width / 2;
    groups.push({ x: x - columnWidth / 2, y: tops[column], label, count: items.length });
    let y = tops[column] + 12;
    for (const node of items) {
      const item = card(node, columnWidth);
      positions.set(node.id, { ...item, x, y: y + item.height / 2 });
      y += item.height + 12;
    }
    tops[column] = y + 24;
  }
  return { positions, groups, height: Math.max(240, ...tops) + 48 };
}

function element(name, attrs = {}, text = '') {
  const result = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, String(value));
  if (text) result.textContent = text;
  return result;
}

export class EvidenceGraph {
  constructor(svg, tooltip, onSelect) {
    this.svg = svg; this.tooltip = tooltip; this.onSelect = onSelect;
    this.layer = element('g', { class: 'graph-world' }); svg.append(this.layer);
    this.nodes = []; this.edges = []; this.positions = new Map(); this.zoom = 1; this.pan = { x: 0, y: 0 }; this.layoutHeight = 240;
    this.resize = new ResizeObserver(() => this.fit({ resetScroll: false })); this.resize.observe(svg.parentElement);
    this.bind();
  }
  bind() {
    this.svg.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      this.gesture = { x: event.clientX, y: event.clientY, pan: { ...this.pan }, moved: false, node: event.target.closest('[data-node-id]')?.dataset.nodeId };
      this.svg.setPointerCapture(event.pointerId);
    });
    this.svg.addEventListener('pointermove', event => {
      if (this.gesture) {
        const dx = event.clientX - this.gesture.x, dy = event.clientY - this.gesture.y;
        if (Math.hypot(dx, dy) > 4) this.gesture.moved = true;
        if (this.gesture.moved) { this.pan = { x: this.gesture.pan.x + dx, y: this.gesture.pan.y + dy }; this.transform(); this.hideTooltip(); this.svg.classList.add('dragging'); }
        return;
      }
      const group = event.target.closest('[data-node-id]');
      if (group) this.showTooltip(group.dataset.nodeId, event.clientX, event.clientY); else this.hideTooltip();
    });
    this.svg.addEventListener('pointerup', event => {
      const gesture = this.gesture; this.gesture = null; this.svg.classList.remove('dragging');
      if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
      if (gesture && !gesture.moved && gesture.node) { this.hideTooltip(); this.onSelect(gesture.node); }
    });
    this.svg.addEventListener('pointercancel', () => { this.gesture = null; this.svg.classList.remove('dragging'); this.hideTooltip(); });
    this.svg.addEventListener('pointerleave', () => this.hideTooltip());
    this.svg.addEventListener('wheel', event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = this.svg.getBoundingClientRect();
      this.changeZoom(Math.exp(-event.deltaY * .002), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top });
    }, { passive: false });
    this.svg.addEventListener('keydown', event => {
      const node = event.target.closest('[data-node-id]');
      if (event.key === 'Escape') this.hideTooltip();
      if (node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); this.hideTooltip(); this.onSelect(node.dataset.nodeId); }
      if (node && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const all = [...this.layer.querySelectorAll('[data-node-id]')], current = all.indexOf(node);
        all[(current + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + all.length) % all.length]?.focus();
      }
    });
    this.svg.addEventListener('focusin', event => {
      const node = event.target.closest('[data-node-id]'); if (!node) return;
      const rect = node.getBoundingClientRect(); this.showTooltip(node.dataset.nodeId, rect.x + rect.width / 2, rect.y + 10);
    });
    this.svg.addEventListener('focusout', () => this.hideTooltip());
  }
  update({ nodes, edges }, selectedId) {
    const signature = JSON.stringify([selectedId, nodes.map(n => [n.id, n.type, summarizeGraphNode(n, { nodes, edges })]), edges.map(e => [e.id, e.from, e.to, e.relation, e.basis, e.sourceUrl, e.matchedText, e.evidenceStatus])]);
    if (signature === this.signature) { this.nodes = nodes; this.edges = edges; return; }
    this.signature = signature;
    const focusedId = this.svg.contains(document.activeElement) ? document.activeElement?.dataset.nodeId : null;
    const resetScroll = selectedId !== this.selectedId;
    this.nodes = nodes; this.edges = edges; this.selectedId = selectedId;
    this.fit({ resetScroll });
    if (focusedId) [...this.layer.querySelectorAll('[data-node-id]')].find(el => el.dataset.nodeId === focusedId)?.focus({ preventScroll: true });
  }
  draw(width) {
    const layout = layoutNeighborhood(this.nodes, this.selectedId, width, this.edges);
    this.positions = layout.positions; this.layoutHeight = layout.height;
    this.layer.replaceChildren(); this.hideTooltip();
    for (const edge of this.edges) {
      const from = this.positions.get(edge.from), to = this.positions.get(edge.to); if (!from || !to) continue;
      const line = element('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: `graph-edge${edge.from === this.selectedId || edge.to === this.selectedId ? ' related' : ''}${edge.relation === 'CONTEXT_FOR' ? ' market-context' : ''}` });
      line.append(element('title', {}, `${edge.relation || 'Source connection'} · ${edge.basis || 'Inspect the relationship source'}`));
      this.layer.append(line);
    }
    for (const group of layout.groups) this.layer.append(element('text', { x: group.x, y: group.y, class: 'graph-category' }, `${group.label} · ${group.count}`));
    for (const node of this.nodes) {
      const position = this.positions.get(node.id); if (!position) continue;
      const selected = node.id === this.selectedId, radius = 5;
      const group = element('g', { class: `graph-node ${node.type}${selected ? ' selected' : ''}`, transform: `translate(${position.x} ${position.y})`, role: 'button', tabindex: 0, 'aria-pressed': selected, 'aria-label': `${TYPES[node.type] || 'Entity'}: ${node.label}`, 'data-node-id': node.id });
      group.append(element('rect', { x: -position.width / 2, y: -position.height / 2, width: position.width, height: position.height, rx: 5, class: 'node-card' }));
      const symbol = element('g', { transform: `translate(${-position.width / 2 + 15} 0)` });
      if (['report', 'event'].includes(node.type)) symbol.append(element('rect', { x: -radius, y: -radius * .8, width: radius * 2, height: radius * 1.6, rx: 1, class: 'node-body' }));
      else if (node.type === 'asset') symbol.append(element('rect', { x: -radius, y: -radius, width: radius * 2, height: radius * 2, transform: 'rotate(45)', class: 'node-body' }));
      else symbol.append(element('circle', { r: radius, class: 'node-body' }));
      group.append(symbol);
      group.append(element('title', {}, `${TYPES[node.type] || 'Entity'} · ${node.label}`));
      const label = element('text', { x: -position.width / 2 + 29, y: -position.height / 2 + 19, class: 'node-label' });
      position.lines.forEach((line, index) => label.append(element('tspan', { x: -position.width / 2 + 29, dy: index ? 16 : 0 }, line)));
      group.append(label);
      const detail = element('text', { x: -position.width / 2 + 29, y: -position.height / 2 + 24 + position.lines.length * 16, class: 'node-detail' });
      position.details.forEach((line, index) => detail.append(element('tspan', { x: -position.width / 2 + 29, dy: index ? 13 : 0 }, line)));
      group.append(detail);
      this.layer.append(group);
    }
  }
  transform() {
    const rect = this.svg.getBoundingClientRect();
    this.layer.setAttribute('transform', `translate(${rect.width / 2 + this.pan.x} ${this.pan.y}) scale(${this.zoom})`);
  }
  fit({ resetScroll = true } = {}) {
    const viewport = this.svg.parentElement, width = viewport.clientWidth;
    if (!width) return;
    const focusedId = this.svg.contains(document.activeElement) ? document.activeElement?.dataset.nodeId : null;
    this.draw(width);
    const height = Math.max(viewport.clientHeight, this.layoutHeight);
    this.svg.style.height = `${height}px`;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.zoom = 1; this.pan = { x: 0, y: 0 }; this.transform();
    if (resetScroll) viewport.scrollTop = 0;
    if (focusedId) [...this.layer.querySelectorAll('[data-node-id]')].find(el => el.dataset.nodeId === focusedId)?.focus({ preventScroll: true });
  }
  changeZoom(factor, anchor = { x: 0, y: 0 }) {
    const next = clamp(this.zoom * factor, .2, 4), ratio = next / this.zoom;
    this.pan = { x: anchor.x - (anchor.x - this.pan.x) * ratio, y: anchor.y - (anchor.y - this.pan.y) * ratio };
    this.zoom = next; this.transform(); this.hideTooltip();
  }
  showTooltip(id, clientX, clientY) {
    const node = this.nodes.find(item => item.id === id); if (!node) return;
    const title = document.createElement('strong'); title.textContent = node.label;
    const meta = document.createElement('small'); meta.textContent = `${TYPES[node.type] || 'Entity'} · ${node.record?.source || node.record?.publisher || 'Select to inspect source links'}`;
    this.tooltip.replaceChildren(title, meta); this.tooltip.hidden = false;
    const stage = this.svg.closest('.graph-stage').getBoundingClientRect();
    this.tooltip.style.left = `${clamp(clientX - stage.left + 12, 10, Math.max(10, stage.width - this.tooltip.offsetWidth - 10))}px`;
    this.tooltip.style.top = `${clamp(clientY - stage.top + 14, 10, Math.max(10, stage.height - this.tooltip.offsetHeight - 10))}px`;
  }
  hideTooltip() { this.tooltip.hidden = true; }
}
