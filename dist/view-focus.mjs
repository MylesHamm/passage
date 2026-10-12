/** Capture a focused control before replacing its view, then restore its logical
 * successor. Link roles and occurrence distinguish repeated source URLs. */
export function preserveViewFocus(container, fallback = null) {
  const active = container.ownerDocument.activeElement;
  if (!active || active === container || !container.contains(active)) return () => {};
  let candidates;
  if (active.dataset?.selectNode) {
    const id = active.dataset.selectNode;
    candidates = () => [...container.querySelectorAll('[data-select-node]')].filter(node => node.dataset.selectNode === id);
  } else if (active.id) {
    const id = active.id;
    candidates = () => [...container.querySelectorAll('[id]')].filter(node => node.id === id);
  } else if (active.tagName === 'A' && active.hasAttribute('href')) {
    const href = active.getAttribute('href'), role = active.className;
    candidates = () => [...container.querySelectorAll('a[href]')].filter(node => node.getAttribute('href') === href && node.className === role);
  }
  const occurrence = candidates ? candidates().indexOf(active) : -1;
  return () => {
    if (container.contains(active) && active.getClientRects().length) return;
    const matches = candidates?.() || [];
    const target = matches[occurrence] || matches[0];
    (target?.getClientRects().length ? target : fallback)?.focus({ preventScroll: true });
  };
}
