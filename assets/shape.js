/* DROID ADB 4.7 Window shape. A small bar on the Console page: Phone, Tablet or PC, with a size. The mirror and record window
   takes that shape (your normal phone screen scaled to fit inside), so OBS, TikTok Live or a call that captures the window
   gets it. The phone itself is never changed. A window that is already open changes shape right away. */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const SIZES = {
  tablet: [['1280x800', '16:10 · 1280×800'], ['1600x1200', '4:3 · 1600×1200'], ['1920x1200', '16:10 · 1920×1200'], ['2048x1536', '4:3 · 2048×1536']],
  pc: [['1280x720', '16:9 · 1280×720'], ['1920x1080', '16:9 · 1920×1080'], ['2560x1440', '16:9 · 2560×1440']]
};
const kindOf = v => (!v || v === 'phone') ? 'phone' : SIZES.tablet.some(x => x[0] === v) ? 'tablet' : SIZES.pc.some(x => x[0] === v) ? 'pc' : 'custom';
const cfg = () => state.settings || {};
let applied = [];

async function loadApplied() {
  try { const r = await STK.api('/shape'); applied = r.applied || []; } catch (e) { applied = []; }
  paint();
}
async function save(patch) {
  try { const r = await STK.post('/settings', { patch }); state.settings = r.settings; STK.emit('settings', r.settings); paint(); }
  catch (e) { return STK.fail(e); }
  applyNow();
}
/* an open mirror or record window changes shape at once: no restart, nothing on the phone changes */
async function applyNow() {
  const id = STK.sel(); if (!id || !(state.sessions || []).length) return;
  const img = $('#screen-img'), aspect = img && img.naturalWidth ? img.naturalWidth / img.naturalHeight : 0;
  try {
    const r = await STK.post('/window-shape', { serial: id, aspect }, { timeout: 15000 });
    if (r.windows) STK.toast('Window is now ' + String(r.size).replace('x', '×') + '.');
  } catch (e) { /* the window may have been closed; the next one opens at the right size */ }
}
function sizeText(v) {
  const s = cfg();
  if (v === 'custom') return (s.shapeW || '?') + '×' + (s.shapeH || '?');
  return String(v).replace('x', '×');
}
function note(k, v) {
  if (k === 'phone') return 'The mirror and record window keeps the shape of the phone.';
  return 'The mirror and record window is ' + sizeText(v) + ' shaped, with your normal phone screen scaled to fit inside and plain dark bars around it. A window that is open changes right away; new ones open at this shape. The phone itself is not changed. If your screen is smaller, the window is made as large as fits, in the same shape.';
}
function html() {
  const s = cfg(), v = s.shapeSize || 'phone', k = kindOf(v);
  const seg = [['phone', 'Phone', 'phone'], ['tablet', 'Tablet', 'grid'], ['pc', 'PC', 'terminal']].map(([id, l, ic]) => `<button type="button" data-shape-kind="${id}" class="${(k === id || (k === 'custom' && id === 'tablet')) ? 'is-active' : ''}" aria-pressed="${k === id}">${icon(ic, 'sm')}<span>${l}</span></button>`).join('');
  const list = k === 'pc' ? SIZES.pc : SIZES.tablet;
  const opts = (k === 'phone' ? [] : list.map(([id, l]) => `<option value="${id}" ${v === id ? 'selected' : ''}>${l}</option>`)).concat(k === 'custom' ? [`<option value="custom" selected>Custom · ${esc(sizeText('custom'))}</option>`] : []).join('');
  const reset = applied.includes(STK.sel()) ? `<button class="btn sm" type="button" data-shape-act="reset">${icon('refresh', 'sm')}<span>Put the phone screen back (left resized by an older version)</span></button>` : '';
  return `<div class="shape-row"><span class="shape-lbl">${icon('expand', 'sm')}Window shape</span><div class="seg shape-seg" role="group" aria-label="Window shape">${seg}</div>${k === 'phone' ? '' : `<select id="shape-size" aria-label="Size">${opts}</select>`}${reset}</div><p class="shape-note">${esc(note(k, v))}</p>`;
}
function mount() {
  if ($('#shape-bar')) return;
  const q = $('#quickline'); if (!q) return;
  const d = document.createElement('div'); d.id = 'shape-bar'; d.className = 'shape-bar'; q.parentNode.insertBefore(d, q);
  paint();
}
function paint() { const b = $('#shape-bar'); if (b) STK.setHtml(b, html()); }

document.addEventListener('click', async e => {
  const t = e.target.closest('#shape-bar [data-shape-kind], #shape-bar [data-shape-act]'); if (!t) return;
  if (t.dataset.shapeKind) {
    const k = t.dataset.shapeKind, mem = STK.store.get('shape-last', {});
    if (k === 'phone') return save({ shapeSize: 'phone' });
    return save({ shapeSize: mem[k] || (k === 'pc' ? '1920x1080' : '1600x1200') });
  }
  if (t.dataset.shapeAct === 'reset') {
    const id = STK.sel(); if (!id) return;
    return STK.busy(t, async () => { try { const r = await STK.post('/shape-reset', { serial: id }, { timeout: 40000 }); STK.toast(r.message || 'Done.'); } catch (er) { STK.fail(er); } await loadApplied(); });
  }
});
document.addEventListener('change', e => {
  if (e.target.id !== 'shape-size') return;
  const v = e.target.value, mem = STK.store.get('shape-last', {}), k = kindOf(v);
  if (k === 'tablet' || k === 'pc') { mem[k] = v; STK.store.set('shape-last', mem); }
  save({ shapeSize: v });
});

/* the command palette and other pages can switch the shape too */
STK.shapeSet = k => { const mem = STK.store.get('shape-last', {}); return save({ shapeSize: k === 'phone' ? 'phone' : (mem[k] || (k === 'pc' ? '1920x1080' : '1600x1200')) }); };

let lastSessions = -1;
STK.on('state', () => { const n = (state.sessions || []).length; if (n !== lastSessions) { lastSessions = n; setTimeout(loadApplied, 3500); } });
STK.on('settings', paint);
STK.on('device-changed', loadApplied);
STK.on('view', v => { if (v === 'console') { mount(); loadApplied(); } });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
setTimeout(() => { mount(); loadApplied(); }, 1500);
})();
