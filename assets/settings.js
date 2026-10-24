/* Settings view: rendered entirely from the backend schema. Nothing about the fields is hardcoded here. */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const S = { query: '', mode: 'mirror', errors: {}, queue: Promise.resolve(), pending: {}, timers: {}, rendered: false };
state.profiles = [];

STK.matchPreset = function (s) {
  const ps = (state.schema && state.schema.presets) || [];
  for (const p of ps) if (Object.keys(p.v).every(k => s[k] === p.v[k])) return p.id;
  return 'custom';
};
STK.loadProfiles = async function () {
  try { const r = await STK.api('/profiles'); state.profiles = r.profiles || []; } catch (e) {}
  STK.emit('profiles'); if (state.view === 'settings') renderProfiles();
};

const fields = () => (state.schema ? state.schema.fields : []);
const val = k => (state.settings || {})[k];
const isDefault = f => JSON.stringify(val(f.key)) === JSON.stringify(f.default);
const isOff = f => !!f.show && Object.entries(f.show).some(([k, v]) => val(k) !== v);
const matches = f => !S.query || (f.label + ' ' + f.help + ' ' + f.key).toLowerCase().includes(S.query.toLowerCase());

/* ---------- rendering ---------- */
function control(f) {
  const v = val(f.key), id = 'f-' + f.key, a = `data-key="${esc(f.key)}"`;
  if (f.type === 'bool') return `<label class="switch"><input type="checkbox" id="${id}" ${a} ${v ? 'checked' : ''} aria-label="${esc(f.label)}"><i></i></label>`;
  if (f.type === 'choice') return `<div class="select-wrap plain"><select id="${id}" ${a} aria-label="${esc(f.label)}">${(f.choices || []).map(c => `<option value="${esc(c.v)}" ${String(c.v) === String(v) ? 'selected' : ''}>${esc(c.l)}</option>`).join('')}</select>${icon('chevron', 'sm chev')}</div>`;
  if (f.type === 'int') {
    const picks = f.picks ? `<div class="picks">${f.picks.map(p => `<button type="button" class="chipbtn ${Number(v) === p ? 'is-active' : ''}" data-pick="${esc(f.key)}" data-val="${p}">${p === 0 && f.min === 0 ? 'Off' : p}</button>`).join('')}</div>` : '';
    return `${picks}<input type="number" id="${id}" ${a} value="${esc(v)}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} inputmode="numeric" aria-label="${esc(f.label)}">${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ''}`;
  }
  return `<input type="text" id="${id}" ${a} value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off" spellcheck="false" aria-label="${esc(f.label)}">`;
}
function fieldHtml(f) {
  const err = S.errors[f.key];
  return `<div class="field ${isOff(f) ? 'off' : ''}" data-field="${esc(f.key)}"><div><div class="name"><label for="f-${esc(f.key)}">${esc(f.label)}</label><span class="dotmod" ${isDefault(f) ? 'hidden' : ''} title="Changed from the default"></span>${f.restart ? '<span class="restart">restart</span>' : ''}</div><small>${esc(f.help)}</small><small class="errmsg" ${err ? '' : 'hidden'}>${esc(err || '')}</small></div><div class="ctl">${control(f)}<button type="button" class="reset" data-reset="${esc(f.key)}" ${isDefault(f) ? 'hidden' : ''} title="Back to ${esc(String(f.default))}">Reset</button></div></div>`;
}
function renderBody() {
  if (!state.schema || !state.settings) { STK.setHtml($('#settings-body'), '<section class="panel"><p class="hint">Loading settings...</p></section>'); return; }
  const groups = state.schema.groups;
  let html = '', nav = '';
  for (const g of groups) {
    const fs = fields().filter(f => f.group === g.id && matches(f));
    if (!fs.length) continue;
    html += `<section class="panel" id="grp-${esc(g.id)}"><header class="panel-head"><h2>${esc(g.title)}</h2></header><p class="hint group-note">${esc(g.note)}</p><div class="fields">${fs.map(fieldHtml).join('')}</div></section>`;
    nav += `<a href="#grp-${esc(g.id)}" data-nav="${esc(g.id)}">${esc(g.title)}</a>`;
  }
  if (!html) html = `<section class="panel"><div class="empty">${icon('search')}<b>No setting matches "${esc(S.query)}"</b><p>Try a shorter word.</p></div></section>`;
  STK.setHtml($('#settings-body'), html);
  const navEl = $('#settings-nav');
  if (!$('input', navEl)) navEl.innerHTML = '<input type="search" id="settings-search" placeholder="Search settings" autocomplete="off" aria-label="Search settings"><div id="settings-links" style="display:grid;gap:2px"></div>';
  STK.setHtml($('#settings-links'), nav);
  S.rendered = true;
}
function refreshFields() {
  $$('#settings-body .field').forEach(el => {
    const f = fields().find(x => x.key === el.dataset.field); if (!f) return;
    el.classList.toggle('off', isOff(f));
    $('.dotmod', el).hidden = isDefault(f);
    $('.reset', el).hidden = isDefault(f);
    const err = $('.errmsg', el); err.hidden = !S.errors[f.key]; err.textContent = S.errors[f.key] || '';
    $$('[data-pick]', el).forEach(b => b.classList.toggle('is-active', Number(val(f.key)) === Number(b.dataset.val)));
    $$('input,select,button.chipbtn', el).forEach(c => { c.disabled = isOff(f); });
  });
  $$('#settings-body .field').forEach(el => $$('input,select,button.chipbtn', el).forEach(c => { c.disabled = el.classList.contains('off'); }));
}
function renderPresets() {
  const ps = (state.schema && state.schema.presets) || [];
  const act = state.settings ? STK.matchPreset(state.settings) : '';
  STK.setHtml($('#presets'), ps.map(p => `<button type="button" class="preset ${act === p.id ? 'is-active' : ''}" data-preset="${esc(p.id)}" aria-pressed="${act === p.id}"><b>${esc(p.name)}</b><span>${esc(p.note)}</span><em>${p.v.maxSize === 0 ? 'Native' : p.v.maxSize + ' px'} · ${p.v.maxFps} fps · ${p.v.bitrateMbps} Mbps</em></button>`).join(''));
}
function renderProfiles() {
  STK.setHtml($('#profiles'), `<span class="hint">Saved profiles</span>` + state.profiles.map(p => `<span class="profile-chip"><button type="button" data-prof="${esc(p.name)}">${esc(p.name)}</button><button type="button" class="x" data-profdel="${esc(p.name)}" aria-label="Delete profile ${esc(p.name)}">${icon('x', 'sm')}</button></span>`).join('') + `<button type="button" class="chipbtn" id="prof-save">${icon('save', 'sm')} Save current as profile</button>`);
}
let cmdSeq = 0;
const refreshCmd = STK.debounce(async () => {
  const my = ++cmdSeq;
  try { const r = await STK.post('/preview', { mode: S.mode, serial: STK.sel() }); if (my === cmdSeq) $('#cmd-preview').textContent = r.command; } catch (e) { if (my === cmdSeq) $('#cmd-preview').textContent = e.message; }
}, 250);
function renderAll() { renderPresets(); renderProfiles(); renderBody(); refreshFields(); refreshCmd(); }

/* ---------- saving ---------- */
function setSaveState(text, cls) { const el = $('#save-state'); el.textContent = text; el.className = 'hint ' + (cls || ''); }
function applyResult(r) { state.settings = r.settings; state.pollSeconds = r.settings.pollSeconds; STK.applyTheme(r.settings.theme); STK.emit('settings', r.settings); if (r.restartRequired) STK.refreshStatus(); }
function save(key, value) {
  const f = fields().find(x => x.key === key);
  S.errors[key] = '';
  if (f && f.type === 'int') {
    if (!Number.isFinite(value)) return;
    if ((f.min != null && value < f.min) || (f.max != null && value > f.max)) { S.errors[key] = `Use a number from ${f.min} to ${f.max}.`; refreshFields(); return; }
  }
  setSaveState('Saving...');
  S.queue = S.queue.then(async () => {
    try { const r = await STK.post('/settings', { patch: { [key]: value } }); applyResult(r); S.errors[key] = ''; setSaveState('Saved just now.', 'ok'); }
    catch (e) { S.errors[key] = e.message; setSaveState('Not saved: ' + e.message, 'bad'); if (e.network) STK.fail(e); }
    refreshFields(); renderPresets(); refreshCmd();
  });
}
function setField(key, value) { const el = $('#f-' + key); if (el) { if (el.type === 'checkbox') el.checked = !!value; else el.value = value; } }

/* ---------- events ---------- */
document.addEventListener('change', e => {
  const t = e.target; if (!t.dataset || !t.dataset.key || !$('#view-settings').contains(t)) return;
  const f = fields().find(x => x.key === t.dataset.key); if (!f) return;
  if (f.type === 'bool') { state.settings[f.key] = t.checked; refreshFields(); save(f.key, t.checked); }
  else if (f.type === 'choice') { state.settings[f.key] = t.value; refreshFields(); save(f.key, t.value); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'settings-search') { S.query = t.value; renderBody(); refreshFields(); return; }
  if (!t.dataset || !t.dataset.key || !$('#view-settings').contains(t)) return;
  const f = fields().find(x => x.key === t.dataset.key); if (!f) return;
  if (f.type === 'int') { if (t.value === '') return; const n = Number(t.value); clearTimeout(S.timers[f.key]); S.timers[f.key] = setTimeout(() => { if (Number.isFinite(n)) { state.settings[f.key] = n; refreshFields(); } save(f.key, n); }, 500); }
  else if (f.type === 'text' || f.type === 'path') { clearTimeout(S.timers[f.key]); S.timers[f.key] = setTimeout(() => { state.settings[f.key] = t.value; refreshFields(); save(f.key, t.value); }, 600); }
});
document.addEventListener('click', async e => {
  const t = e.target.closest('button, a[data-nav]'); if (!t || !$('#view-settings').contains(t)) return;
  if (t.dataset.nav) { e.preventDefault(); const el = $('#grp-' + t.dataset.nav); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (t.dataset.pick) { const f = fields().find(x => x.key === t.dataset.pick), v = Number(t.dataset.val); state.settings[f.key] = v; setField(f.key, v); refreshFields(); return save(f.key, v); }
  if (t.dataset.reset) { const f = fields().find(x => x.key === t.dataset.reset); state.settings[f.key] = f.default; setField(f.key, f.default); refreshFields(); return save(f.key, f.default); }
  if (t.dataset.preset) {
    const p = state.schema.presets.find(x => x.id === t.dataset.preset);
    return STK.busy(t, async () => { try { applyResult(await STK.post('/settings', { patch: p.v })); STK.toast(p.name + ' applied. It takes effect on the next mirror or recording.'); renderAll(); } catch (er) { STK.fail(er); } });
  }
  if (t.dataset.prof) return STK.busy(t, async () => { try { applyResult(await STK.post('/profiles/apply', { name: t.dataset.prof })); STK.toast('Applied profile ' + t.dataset.prof + '.'); renderAll(); } catch (er) { STK.fail(er); } });
  if (t.dataset.profdel) { if (!await STK.confirm('Delete profile?', `<p>The saved profile <b>${esc(t.dataset.profdel)}</b> will be removed. Your current settings stay as they are.</p>`)) return; try { const r = await STK.post('/profiles/delete', { name: t.dataset.profdel }); state.profiles = r.profiles; STK.emit('profiles'); renderProfiles(); } catch (er) { STK.fail(er); } return; }
  if (t.id === 'prof-save') {
    const name = await STK.prompt('Save profile', 'Profile name (letters, numbers, spaces)', '', 'Save'); if (!name) return;
    try { const r = await STK.post('/profiles', { name }); state.profiles = r.profiles; STK.toast(r.message); STK.emit('profiles'); renderProfiles(); } catch (er) { STK.fail(er); } return;
  }
  if (t.closest('#preview-mode') && t.dataset.mode) { S.mode = t.dataset.mode; $$('#preview-mode button').forEach(b => b.classList.toggle('is-active', b === t)); return refreshCmd(); }
  if (t.id === 'cmd-copy') return navigator.clipboard.writeText($('#cmd-preview').textContent).then(() => STK.toast('Command copied.'), () => STK.toast('Copy was blocked by the browser.', 'bad'));
  if (t.id === 'settings-export') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(state.settings, null, 2)], { type: 'application/json' })); a.download = 'scrcpy-toolkit-settings.json'; a.click(); return setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  if (t.id === 'settings-import') return $('#settings-file').click();
  if (t.id === 'settings-reset') {
    if (!await STK.confirm('Reset all settings?', '<p>Every setting goes back to its default. Saved profiles are kept.</p>', 'Reset all')) return;
    return STK.busy(t, async () => { try { applyResult(await STK.post('/settings/reset', {})); STK.toast('Settings reset.'); renderAll(); } catch (er) { STK.fail(er); } });
  }
});
$('#settings-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('That file does not look like a settings export.');
    const known = new Set(fields().map(f => f.key)), patch = {};
    for (const [k, v] of Object.entries(obj)) if (known.has(k)) patch[k] = v;
    if (!Object.keys(patch).length) throw new Error('No known settings were found in that file.');
    applyResult(await STK.post('/settings', { patch })); STK.toast(`Imported ${Object.keys(patch).length} settings.`); renderAll();
  } catch (er) { STK.fail(er.message ? er : new Error('Could not read that file.')); }
});

STK.views.settings = { onShow() { STK.loadSchema().then(() => { if (!state.settings) return STK.loadSettings(); }).then(() => { STK.loadProfiles(); renderAll(); }).catch(STK.fail); } };
STK.on('settings', () => { if (state.view === 'settings' && !S.rendered) renderAll(); });
STK.on('device-changed', () => { if (state.view === 'settings') refreshCmd(); });
STK.loadProfiles();
})();
