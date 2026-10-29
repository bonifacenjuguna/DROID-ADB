/* DROID ADB 5.0 Capture shape: Default / Tablet / Window.
   The backend decides and does everything (see "Capture shape" in core/server/lib.ps1). This file only shows the
   choice on the Console, saves it as an ordinary setting and tells the truth about what is happening to the phone. */
(() => {
'use strict';
const { $, esc, icon, state } = STK;
const bar = $('#shape-bar');
if (!bar) return;

const S = () => state.settings || {};
const field = k => ((state.schema && state.schema.fields) || []).find(f => f.key === k);
const MODES = [
  { id: 'default', label: 'Default', glyph: 'phone', tip: 'The shape of the phone screen' },
  { id: 'tablet', label: 'Tablet', glyph: 'tablet', tip: 'The shape of a tablet screen (wide, 16:10)' },
  { id: 'window', label: 'Window', glyph: 'window', tip: 'The shape of a desktop window (wide, 16:9)' }
];
const KEYS = { tablet: ['shapeTablet', 'shapeTabletCustom'], window: ['shapeWindow', 'shapeWindowCustom'] };
let sig = '';

/* "1920x1200/240" -> { w, h, dpi } or null. Same rule as the backend. */
const parse = t => {
  const m = /^(\d{3,5})x(\d{3,5})(?:\/(\d{2,4}))?$/.exec(String(t || '').trim());
  return m ? { w: +m[1], h: +m[2], dpi: m[3] ? +m[3] : 0 } : null;
};
function plan(mode) {
  if (mode !== 'tablet' && mode !== 'window') return null;
  const [pk, ck] = KEYS[mode];
  const pick = S()[pk] || '';
  return parse(pick === 'custom' ? S()[ck] : pick);
}
const dpText = p => {
  if (!p || !p.dpi) return 'the phone keeps its own density';
  const f = p.dpi / 160;
  return `apps see about ${Math.round(Math.min(p.w, p.h) / f)} dp across the short side`;
};
const px = p => `${p.w} × ${p.h}`;

function note(mode, method, p, act, live, camera) {
  if (camera) return { tone: '', text: 'Shapes apply to the screen. The camera source keeps its own shape.' };
  if (act && live) return { tone: 'ok', text: `The phone screen is ${act.w} × ${act.h} right now${act.fitted ? ' (scaled to fit this phone)' : ''}. It goes back to normal when you stop.` };
  if (act) return { tone: 'warn', text: 'The phone screen is still resized. DROID ADB is putting it back; use Reset phone screen if it does not return.' };
  if (mode === 'default') return { tone: '', text: 'Mirror and recordings follow the phone screen. Pick Tablet or Window for a wide picture.' };
  if (!p) return { tone: 'warn', text: 'Type a custom size such as 1920x1200 or 1920x1200/240.' };
  if (method === 'virtual') return { tone: '', text: `Next Mirror or Record opens a separate ${px(p)} screen (${dpText(p)}). The phone screen is not touched. It starts empty, so open an app on it, and you cannot record while a mirror window is open.` };
  return { tone: '', text: `Next Mirror or Record resizes the phone screen to ${px(p)} (${dpText(p)}) and puts it back when you stop. Choose the shape before you open a game.` };
}

function render(force) {
  if (!state.schema || !state.settings) return;
  const active = document.activeElement;
  if (!force && active && bar.contains(active) && active.tagName === 'INPUT') return; /* never fight someone who is typing */
  const mode = S().shapeMode || 'default';
  const method = S().shapeMethod || 'screen';
  const camera = S().source === 'camera';
  const serial = STK.sel();
  const act = (((state.data || {}).shape) || []).find(x => !x.serial || x.serial === serial) || null;
  const live = !!(serial && STK.sessionFor(serial).length);
  const p = plan(mode);
  const key = JSON.stringify([mode, method, S().shapeTablet, S().shapeTabletCustom, S().shapeWindow, S().shapeWindowCustom, camera, act, live, !!serial]);
  if (!force && key === sig) return;
  sig = key;

  const seg = MODES.map(m => `<button type="button" role="radio" aria-checked="${m.id === mode}" class="${m.id === mode ? 'is-active' : ''}" data-shape="${m.id}" title="${esc(m.tip)}" ${camera ? 'disabled' : ''}><i class="sg sg-${m.glyph}" aria-hidden="true"></i><span>${m.label}</span></button>`).join('');
  let opts = '';
  if (mode !== 'default' && !camera) {
    const [pk, ck] = KEYS[mode], f = field(pk), cur = S()[pk] || '';
    const sizes = ((f && f.choices) || []).map(c => `<option value="${esc(c.v)}" ${c.v === cur ? 'selected' : ''}>${esc(c.l)}</option>`).join('');
    const custom = cur === 'custom' ? `<input id="shape-custom" type="text" value="${esc(S()[ck] || '')}" placeholder="${mode === 'tablet' ? '1920x1200/240' : '1920x1080/280'}" autocomplete="off" spellcheck="false" aria-label="Custom size">` : '';
    opts = `<div class="shape-opts"><div class="select-wrap plain"><select id="shape-size" aria-label="Shape size">${sizes}</select></div>${custom}
      <div class="seg mini" role="radiogroup" aria-label="Shape method"><button type="button" role="radio" aria-checked="${method === 'screen'}" class="${method === 'screen' ? 'is-active' : ''}" data-method="screen" title="Resize the phone screen while capturing, then put it back">Resize phone</button><button type="button" role="radio" aria-checked="${method === 'virtual'}" class="${method === 'virtual' ? 'is-active' : ''}" data-method="virtual" title="Capture a separate display and leave the phone screen alone">Virtual display</button></div></div>`;
  }
  const n = note(mode, method, p, act, live, camera);
  const reset = `<button type="button" class="shape-reset ${act ? 'is-hot' : ''}" id="shape-reset" ${serial ? '' : 'disabled'} title="Put the phone screen size and density back to normal">${icon('refresh', 'sm')}<span>Reset phone screen</span></button>`;
  STK.setHtml(bar, `<div class="shape-head"><b>Capture shape</b>${act ? '<em class="shape-live">Resized</em>' : ''}</div>
    <div class="seg shape-seg" role="radiogroup" aria-label="Capture shape">${seg}</div>${opts}
    <p class="shape-note ${n.tone}">${esc(n.text)} ${reset}</p>`);
}

async function save(patch) {
  try {
    const r = await STK.post('/settings', { patch });
    state.settings = r.settings; STK.emit('settings', r.settings);
    render(true);
  } catch (e) { STK.fail(e); render(true); }
}

bar.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  if (b.dataset.shape) { if (b.dataset.shape !== (S().shapeMode || 'default')) await save({ shapeMode: b.dataset.shape }); return; }
  if (b.dataset.method) { if (b.dataset.method !== (S().shapeMethod || 'screen')) await save({ shapeMethod: b.dataset.method }); return; }
  if (b.id === 'shape-reset') {
    const id = STK.sel(); if (!id) return STK.toast('Connect a phone first.', 'bad');
    const ok = await STK.confirm('Reset the phone screen?', '<p>This puts the screen size and density of the phone back to the factory values. If a mirror or recording is running it keeps going.</p><p class="hint">A size or density you set yourself outside DROID ADB is reset too.</p>', 'Reset', false);
    if (!ok) return;
    await STK.busy(b, async () => {
      try { const r = await STK.post('/shape/reset', { serial: id }, { timeout: 45000 }); STK.toast(r.message); STK.pollNow(); }
      catch (er) { STK.fail(er); }
    });
  }
});
bar.addEventListener('change', async e => {
  const t = e.target, mode = S().shapeMode || 'default';
  if (!KEYS[mode]) return;
  if (t.id === 'shape-size') await save({ [KEYS[mode][0]]: t.value });
  else if (t.id === 'shape-custom') {
    const v = t.value.trim();
    if (v && !parse(v)) { STK.toast('Use width x height, then an optional /density. Example: 1920x1200/240.', 'bad'); return; }
    await save({ [KEYS[mode][1]]: v });
  }
});

STK.setShape = async mode => { if (!MODES.some(m => m.id === mode)) return; await save({ shapeMode: mode }); STK.toast('Capture shape: ' + MODES.find(m => m.id === mode).label + '. It applies to the next Mirror or Record.'); };
STK.on('state', () => render(false));
STK.on('settings', () => render(false));
STK.on('device-changed', () => render(true));
STK.on('view', v => { if (v === 'console') render(true); });
render(true);
})();
