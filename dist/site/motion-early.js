// Runs before the first paint, so sections that load in on scroll start in their
// empty state instead of flashing finished first. With reduced motion nothing is
// held back. If the page script never arrives, everything shows after three seconds.
(function () {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var root = document.documentElement;
  root.classList.add('motion-ready');
  setTimeout(function () { if (!root.dataset.motion) root.classList.remove('motion-ready'); }, 3000);
})();
