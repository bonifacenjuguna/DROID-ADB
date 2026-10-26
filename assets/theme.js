/* Applies the saved theme before the page paints. */
(function () {
  try {
    var t = localStorage.getItem('stk-theme') || 'auto';
    if (t === 'auto') t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    document.documentElement.dataset.accent = localStorage.getItem('stk-accent') || 'amber';
  } catch (e) { document.documentElement.dataset.theme = 'dark'; }
})();
