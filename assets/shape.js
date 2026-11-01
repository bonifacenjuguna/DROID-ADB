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
const FILLS = [['off', 'Fill: off (whole screen, bars)'], ['middle', 'Fill: keep the middle'], ['start', 'Fill: keep top or left'], ['end', 'Fill: keep bottom or right']];
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
async function applyNow(manual) {
  const id = STK.sel(); if (!id) return 0;
  if (!(state.sessions || []).length) { if (manual) STK.toast('Press Mirror or Record first, then apply.', 'bad'); return 0; }
  const img = $('#screen-img'), aspect = img && img.naturalWidth ? img.naturalWidth / img.naturalHeight : 0;
  try {
    const r = await STK.post('/window-shape', { serial: id, aspect }, { timeout: 15000 });
    if (r.windows) STK.toast('Window is now ' + String(r.size).replace('x', '×') + '.');
    else if (manual) STK.toast('No mirror window was found to resize. Open the mirror window first.', 'bad');
    return r.windows || 0;
  } catch (e) { if (manual) STK.fail(e); return 0; }
}
/* a window that has just opened is found a moment later; try a few times so the chosen shape is always applied */
let ensuring = false;
async function ensureShape() {
  if (ensuring || kindOf(cfg().shapeSize) === 'phone') return;
  ensuring = true;
  try { for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, i ? 1500 : 2200)); if (!(state.sessions || []).length) break; const n = await applyNow(false); if (n) break; } }
  finally { ensuring = false; }
}

function sizeText(v) {
  const s = cfg();
  if (v === 'custom') return (s.shapeW || '?') + '×' + (s.shapeH || '?');
  return String(v).replace('x', '×');
}
function note(k, v, f) {
  if (k === 'phone') return 'The mirror and record window keeps the shape of the phone.';
  const base = 'The mirror and record window is ' + sizeText(v) + ' shaped. A window that is open changes right away; new ones open at this shape. The phone itself is not changed. If your screen is smaller, the window is made as large as fits, in the same shape.';
  if (!f || f === 'off') return base + ' Your normal phone screen is scaled to fit inside, with plain dark bars around it.';
  return base + ' Fill is on: the picture is cropped to the shape of the window so it fills it, and the recording file gets that shape too. The part that does not fit is cut (the top and bottom of a tall picture, the sides of a wide one). It is worked out when you press Mirror or Record, so press it again after turning the phone.';
}
function html() {
  const s = cfg(), v = s.shapeSize || 'phone', k = kindOf(v), f = s.shapeFill || 'off';
  const seg = [['phone', 'Phone', 'phone'], ['tablet', 'Tablet', 'grid'], ['pc', 'PC', 'terminal']].map(([id, l, ic]) => `<button type="button" data-shape-kind="${id}" class="${(k === id || (k === 'custom' && id === 'tablet')) ? 'is-active' : ''}" aria-pressed="${k === id}">${icon(ic, 'sm')}<span>${l}</span></button>`).join('');
  const list = k === 'pc' ? SIZES.pc : SIZES.tablet;
  const opts = (k === 'phone' ? [] : list.map(([id, l]) => `<option value="${id}" ${v === id ? 'selected' : ''}>${l}</option>`)).concat(k === 'custom' ? [`<option value="custom" selected>Custom · ${esc(sizeText('custom'))}</option>`] : []).join('');
  const apply = (k !== 'phone' && (state.sessions || []).length) ? `<button class="btn sm" type="button" data-shape-act="apply">${icon('refresh', 'sm')}<span>Apply to the open window</span></button>` : '';
  const reset = applied.includes(STK.sel()) ? `<button class="btn sm" type="button" data-shape-act="reset">${icon('refresh', 'sm')}<span>Put the phone screen back (left resized by an older version)</span></button>` : '';
  return `<div class="shape-row"><span class="shape-lbl">${icon('expand', 'sm')}Window shape</span><div class="seg shape-seg" role="group" aria-label="Window shape">${seg}</div>${k === 'phone' ? '' : `<select id="shape-size" aria-label="Size">${opts}</select><select id="shape-fill" aria-label="Fill">${FILLS.map(([id, l]) => `<option value="${id}" ${f === id ? 'selected' : ''}>${l}</option>`).join('')}</select>`}${apply}${reset}</div><p class="shape-note">${esc(note(k, v, f))}</p>`;
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
  if (t.dataset.shapeAct === 'apply') return STK.busy(t, () => applyNow(true));
  if (t.dataset.shapeAct === 'reset') {
    const id = STK.sel(); if (!id) return;
    return STK.busy(t, async () => { try { const r = await STK.post('/shape-reset', { serial: id }, { timeout: 40000 }); STK.toast(r.message || 'Done.'); } catch (er) { STK.fail(er); } await loadApplied(); });
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'shape-fill') return save({ shapeFill: e.target.value });
  if (e.target.id !== 'shape-size') return;
  const v = e.target.value, mem = STK.store.get('shape-last', {}), k = kindOf(v);
  if (k === 'tablet' || k === 'pc') { mem[k] = v; STK.store.set('shape-last', mem); }
  save({ shapeSize: v });
});

/* the command palette and other pages can switch the shape too */
STK.shapeSet = k => { const mem = STK.store.get('shape-last', {}); return save({ shapeSize: k === 'phone' ? 'phone' : (mem[k] || (k === 'pc' ? '1920x1080' : '1600x1200')) }); };

let lastSessions = -1;
STK.on('state', () => { const n = (state.sessions || []).length; if (n !== lastSessions) { const more = n > Math.max(0, lastSessions); lastSessions = n; paint(); setTimeout(loadApplied, 3500); if (more) ensureShape(); } });
STK.on('settings', paint);
STK.on('device-changed', loadApplied);
STK.on('view', v => { if (v === 'console') { mount(); loadApplied(); } });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
setTimeout(() => { mount(); loadApplied(); }, 1500);
})();
