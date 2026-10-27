/* DROID ADB 4.2 motion helpers. Page entrances, card stagger, button ripple, theme cross-fade and STK.fx
   (pop, shake, burst) that any page can call for a small celebration. Decoration only: all of it is skipped
   when the system asks for reduced motion. */
(() => {
'use strict';
const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const fx = STK.fx = {
  reduced,
  pop(el) { if (!el || reduced() || !el.animate) return; el.animate([{ transform: 'scale(.7)', opacity: .4 }, { transform: 'scale(1.12)', opacity: 1 }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.3,1.4,.5,1)' }); },
  shake(el) { if (!el || reduced() || !el.animate) return; el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 380, easing: 'ease-out' }); },
  /* a ring of small dots flying out from the middle of an element */
  burst(el, { n = 18, color = 'var(--accent)', dist = 70 } = {}) {
    if (!el || reduced() || !el.animate || !el.isConnected) return;
    const r = el.getBoundingClientRect(), box = document.createElement('div'); box.className = 'mo-burst';
    box.style.transform = `translate(${r.left + r.width / 2}px,${r.top + r.height / 2}px)`;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (i % 2 ? .12 : 0), d = dist * (.65 + (i % 3) * .22), p = document.createElement('i');
      p.style.background = i % 3 === 0 ? 'var(--accent)' : color; box.appendChild(p);
      p.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d}px) scale(.2)`, opacity: 0 }], { duration: 700 + (i % 4) * 90, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    }
    document.body.appendChild(box); setTimeout(() => box.remove(), 1200);
  }
};

const stagger = (root, sel, cap = 14) => { [...root.querySelectorAll(sel)].slice(0, cap).forEach((el, i) => el.style.setProperty('--mo-i', i)); };

/* pages: their cards rise in one after another */
STK.on('view', name => {
  if (reduced()) return;
  const v = document.getElementById('view-' + name); if (!v) return;
  v.classList.remove('mo-in'); stagger(v, '.panel, .sx-card, .sx-hero, .sx-tabs, .toolbar'); void v.offsetWidth; v.classList.add('mo-in');
  clearTimeout(v._mo); v._mo = setTimeout(() => v.classList.remove('mo-in'), 1500);
});

/* Studio pages: every new grid of cards staggers in */
function watchStudio() {
  const sr = document.getElementById('studio-root'); if (!sr || sr._mo) return; sr._mo = true;
  new MutationObserver(list => {
    if (reduced()) return;
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType !== 1 || !n.classList || !n.classList.contains('sx-grid')) continue;
      stagger(n, ':scope > .sx-card', 12); n.classList.add('mo-stagger'); clearTimeout(n._mo); n._mo = setTimeout(() => n.classList.remove('mo-stagger'), 1300);
    }
  }).observe(sr, { childList: true, subtree: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchStudio); else watchStudio();

/* ripple on buttons and tabs */
document.addEventListener('pointerdown', e => {
  if (reduced() || e.button) return;
  const h = e.target.closest && e.target.closest('.btn, .sx-tab, .sx-prof, .ptab'); if (!h || h.disabled) return;
  h.classList.add('mo-rp');
  const r = h.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2, s = document.createElement('span'); s.className = 'mo-ripple';
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  h.appendChild(s); setTimeout(() => s.remove(), 650);
}, { passive: true });

/* theme and accent changes cross-fade */
try {
  new MutationObserver(() => { if (reduced()) return; const h = document.documentElement; h.classList.add('mo-theme'); clearTimeout(h._mo); h._mo = setTimeout(() => h.classList.remove('mo-theme'), 520); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
} catch (e) { /* ignore */ }

/* celebrations from Studio events */
STK.on('sx-cooled', () => setTimeout(() => { const el = document.querySelector('.xp-cd-ring') || document.getElementById('sx-score'); fx.burst(el, { color: 'var(--ok)', n: 22, dist: 90 }); }, 500));
STK.on('sx-applied', () => { const el = document.getElementById('sx-score'); if (el) { fx.burst(el.parentElement || el, { color: 'var(--accent)' }); } });
})();
