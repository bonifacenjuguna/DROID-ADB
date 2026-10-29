/* DROID ADB 4.6 Screen shape. A small bar on the Console page: Phone, Tablet or PC, with a size, so what is mirrored and
   recorded has the shape you want when you share it (OBS, TikTok Live, a call). The bar only changes settings; the service
   applies them when Mirror or Record starts, and puts the phone back to normal by itself afterwards. */
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
  catch (e) { STK.fail(e); }
}
function sizeText(v) {
  const s = cfg();
  if (v === 'custom') return (s.shapeW || '?') + '×' + (s.shapeH || '?');
  return String(v).replace('x', '×');
}
function note(k, m, v) {
  if (k === 'phone') return 'The mirror and recordings keep the phone’s own shape.';
  const run = ($$('.stage-actions .toggle[aria-pressed="true"]').length ? ' Windows that are already open keep their shape.' : '');
  if (m === 'virtual') return 'A separate ' + sizeText(v) + ' screen is shown. The phone itself is not touched. Needs Android 11 or newer, one window at a time. Applies the next time you press Mirror or Record.' + run;
  return 'While you mirror or record, the phone is told it has a ' + sizeText(v) + ' screen, then it is put back by itself. Its own screen may show black bars meanwhile. Applies the next time you press Mirror or Record.' + run;
}
function html() {
  const s = cfg(), v = s.shapeSize || 'phone', k = kindOf(v), m = s.shapeMethod === 'virtual' ? 'virtual' : 'resize';
  const seg = [['phone', 'Phone', 'phone'], ['tablet', 'Tablet', 'grid'], ['pc', 'PC', 'terminal']].map(([id, l, ic]) => `<button type="button" data-shape-kind="${id}" class="${(k === id || (k === 'custom' && id === 'tablet')) ? 'is-active' : ''}" aria-pressed="${k === id}">${icon(ic, 'sm')}<span>${l}</span></button>`).join('');
  const list = k === 'pc' ? SIZES.pc : SIZES.tablet;
  const opts = (k === 'phone' ? [] : list.map(([id, l]) => `<option value="${id}" ${v === id ? 'selected' : ''}>${l}</option>`)).concat(k === 'custom' ? [`<option value="custom" selected>Custom · ${esc(sizeText('custom'))}</option>`] : []).join('');
  const reset = applied.includes(STK.sel()) ? `<button class="btn sm" type="button" data-shape-act="reset">${icon('refresh', 'sm')}<span>Put the phone screen back</span></button>` : '';
  return `<div class="shape-row"><span class="shape-lbl">${icon('expand', 'sm')}Screen shape</span><div class="seg shape-seg" role="group" aria-label="Screen shape">${seg}</div>${k === 'phone' ? '' : `<select id="shape-size" aria-label="Size">${opts}</select><div class="seg shape-seg mini" role="group" aria-label="Method"><button type="button" data-shape-method="resize" class="${m === 'resize' ? 'is-active' : ''}" title="Works on every phone">Resize</button><button type="button" data-shape-method="virtual" class="${m === 'virtual' ? 'is-active' : ''}" title="Android 11 or newer">Virtual</button></div>`}${reset}</div><p class="shape-note">${esc(note(k, m, v))}</p>`;
}
function mount() {
  if ($('#shape-bar')) return;
  const q = $('#quickline'); if (!q) return;
  const d = document.createElement('div'); d.id = 'shape-bar'; d.className = 'shape-bar'; q.parentNode.insertBefore(d, q);
  paint();
}
function paint() { const b = $('#shape-bar'); if (b) STK.setHtml(b, html()); }

document.addEventListener('click', async e => {
  const t = e.target.closest('#shape-bar [data-shape-kind], #shape-bar [data-shape-method], #shape-bar [data-shape-act]'); if (!t) return;
  if (t.dataset.shapeKind) {
    const k = t.dataset.shapeKind, mem = STK.store.get('shape-last', {});
    if (k === 'phone') return save({ shapeSize: 'phone' });
    return save({ shapeSize: mem[k] || (k === 'pc' ? '1920x1080' : '1600x1200') });
  }
  if (t.dataset.shapeMethod) return save({ shapeMethod: t.dataset.shapeMethod });
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
