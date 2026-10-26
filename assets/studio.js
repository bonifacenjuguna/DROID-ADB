/* Studio: demo mode, capture presets and game mode (per-app profiles). */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const S = { demo: false, apps: null, active: {}, misses: {}, entering: {} };
const root = () => $('#studio-root');
const games = () => STK.kv.get('games', []);
const nice = p => (STK.niceApp ? STK.niceApp(p) : p);
const dopts = () => ({ clock: '1200', battery: 100, hideNotifications: true, dnd: true, touches: false, ...STK.store.get('demo-opts', {}) });

function render() {
  if (state.view !== 'studio') return;
  const o = dopts(), id = STK.sel();
  const presets = (state.schema && state.schema.presets) || [];
  const cur = state.settings || {};
  const gl = games();
  const act = S.active[id];
  STK.setHtml(root(), `<div class="two"><div class="col">
    <section class="panel"><header class="panel-head"><h2>Demo mode</h2><span class="chip sm ${S.demo ? 'ok' : ''}"><i class="dot"></i><b>${S.demo ? 'On' : 'Off'}</b></span></header>
      <p class="hint lead">Cleans up the phone status bar for screenshots and recordings: fixed clock, full battery, strong signal and no notification icons. Turn it off to bring the real status bar back.</p>
      <div class="formgrid inline">
        <label class="ff"><span>Clock</span><input id="demo-clock" value="${esc(o.clock.slice(0, 2) + ':' + o.clock.slice(2))}" maxlength="5" autocomplete="off" aria-label="Clock shown on the phone"></label>
        <label class="ff"><span>Battery</span><input id="demo-batt" type="number" min="1" max="100" value="${o.battery}" aria-label="Battery level shown"></label>
      </div>
      <div class="checks"><label class="chk"><input type="checkbox" id="demo-hide" ${o.hideNotifications ? 'checked' : ''}><span>Hide notification icons</span></label><label class="chk"><input type="checkbox" id="demo-dnd" ${o.dnd ? 'checked' : ''}><span>Turn on Do not disturb</span></label><label class="chk"><input type="checkbox" id="demo-touch" ${o.touches ? 'checked' : ''}><span>Show touches on the screen</span></label></div>
      <div class="row"><button class="btn ${S.demo ? '' : 'primary'}" id="demo-toggle" ${id ? '' : 'disabled'}>${icon('wand', 'sm')}<span>${S.demo ? 'Turn demo mode off' : 'Turn demo mode on'}</span></button><button class="btn" id="demo-present">${icon('expand', 'sm')}<span>Presentation view</span></button></div>
      <p class="hint">Presentation view pops the phone out as a big clean screen on the Console. Press Esc to leave it.</p></section>
    <section class="panel"><header class="panel-head"><h2>Capture presets</h2></header>
      <p class="hint lead">One tap changes how mirroring and recording look and feel.</p>
      <div class="presets studio-presets">${presets.map(p => `<button type="button" class="preset" data-spreset="${esc(p.id)}"><b>${esc(p.name)}</b><span>${esc(p.note)}</span><em>${p.v.maxSize === 0 ? 'Native' : p.v.maxSize + ' px'} · ${p.v.maxFps} fps · ${p.v.bitrateMbps} Mbps</em></button>`).join('') || '<p class="hint">Loading presets...</p>'}</div>
      <p class="hint">Settings for fine control are on the Settings page.</p></section>
  </div><div class="col">
    <section class="panel"><header class="panel-head"><h2>Game mode</h2>${act ? `<span class="chip sm ok"><i class="dot"></i><b>Active: ${esc(nice(act.pkg))}</b></span>` : '<span class="chip sm"><i class="dot"></i><b>Waiting</b></span>'}</header>
      <p class="hint lead">Pick the apps you play. When one comes to the front on the phone, the toolkit switches to that game's settings and, when you leave it, puts everything back. It works while this dashboard is open.</p>
      ${gl.length ? `<div class="glist">${gl.map((g, i) => `<div class="grow-item"><span class="badge">${icon('game')}</span><div><b>${esc(g.name || nice(g.pkg))}</b><small>${esc(g.pkg)}${gameSummary(g)}</small></div><label class="switch" title="Enabled"><input type="checkbox" data-gon="${i}" ${g.on === false ? '' : 'checked'} aria-label="Enabled"><i></i></label><button class="icon-btn" data-gedit="${i}" aria-label="Edit">${icon('pencil')}</button><button class="icon-btn" data-gdel="${i}" aria-label="Remove">${icon('trash')}</button></div>`).join('')}</div>` : `<div class="empty small">${icon('game')}<b>No games yet</b><p>Add your first game to automate recording, Do not disturb and quality settings.</p></div>`}
      <div class="row"><button class="btn primary" id="game-add">${icon('game', 'sm')}<span>Add a game</span></button></div></section>
  </div></div>`);
}
function gameSummary(g) {
  const bits = [];
  if (g.preset) bits.push('preset ' + presetName(g.preset));
  if (g.mirror) bits.push('mirror'); if (g.record) bits.push('record'); if (g.dnd) bits.push('Do not disturb'); if (g.touches) bits.push('show touches');
  return bits.length ? ' · ' + bits.join(', ') : '';
}
const presetName = id => { const p = ((state.schema && state.schema.presets) || []).find(x => x.id === id); return p ? p.name : id; };

/* ---------- demo ---------- */
async function loadDemo() { const id = STK.sel(); if (!id) { S.demo = false; return render(); } try { S.demo = (await STK.api('/demo?id=' + encodeURIComponent(id))).on; } catch (e) {} render(); }
async function toggleDemo(btn) {
  const id = STK.sel(); if (!id) return;
  const clock = ($('#demo-clock').value.replace(':', '').replace(/\D/g, '') + '1200').slice(0, 4).padStart(4, '0');
  const o = { clock, battery: Math.max(1, Math.min(100, Number($('#demo-batt').value) || 100)), hideNotifications: $('#demo-hide').checked, dnd: $('#demo-dnd').checked, touches: $('#demo-touch').checked };
  STK.store.set('demo-opts', o);
  await STK.busy(btn, async () => { try { const r = await STK.post('/demo', { serial: id, on: !S.demo, ...o }, { timeout: 60000 }); S.demo = r.on; STK.toast(r.message); render(); } catch (e) { STK.fail(e); } });
}
STK.on('demo', on => { S.demo = on; render(); });

/* ---------- games ---------- */
async function ensureApps() {
  if (S.apps) return S.apps;
  try { S.apps = (await STK.api(`/apps?id=${encodeURIComponent(STK.sel())}&scope=user`, { timeout: 60000 })).apps || []; } catch (e) { S.apps = []; }
  return S.apps;
}
async function editGame(i) {
  const g = i >= 0 ? games()[i] : {};
  const apps = await ensureApps();
  const presets = [['', 'Keep my settings'], ...(((state.schema && state.schema.presets) || []).map(p => [p.id, p.name]))];
  const f = await STK.form(i >= 0 ? 'Edit game' : 'Add a game',
    `<label class="ff"><span>App</span><input name="pkg" list="g-list" value="${esc(g.pkg || '')}" placeholder="Start typing the game name" autocomplete="off" spellcheck="false"></label><datalist id="g-list">${apps.map(a => `<option value="${esc(a.package)}">${esc(nice(a.package))}</option>`).join('')}</datalist>` +
    STK.field('name', 'Display name (optional)', g.name || '') + STK.select('preset', 'Capture preset', presets, g.preset || 'latency') +
    STK.check('mirror', 'Start mirroring', g.mirror) + STK.check('record', 'Start recording', g.record !== false) + STK.check('dnd', 'Turn on Do not disturb', g.dnd !== false) + STK.check('touches', 'Show touches', !!g.touches), 'Save');
  if (!f) return;
  const pkg = f.pkg.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(pkg)) return STK.toast('Use the package name, like com.tencent.ig. Pick one from the list.', 'bad');
  const entry = { pkg, name: f.name.trim().slice(0, 40), preset: f.preset, mirror: f.mirror, record: f.record, dnd: f.dnd, touches: f.touches, on: g.on !== false };
  const list = games().slice(); if (i >= 0) list[i] = entry; else list.push(entry);
  STK.kv.set('games', list.slice(0, 30)); render();
}
async function setT(serial, key, value) { try { await STK.post('/toggle', { serial, key, value }, { timeout: 30000 }); } catch (e) { /* the phone may refuse; continue */ } }
async function enter(serial, g) {
  if (S.entering[serial]) return; S.entering[serial] = true;
  const a = S.active[serial] = { pkg: g.pkg, g, prevSettings: null, prevToggles: null, rec: false, mir: false };
  S.misses[serial] = 0; render();
  STK.toast('Game mode on: ' + (g.name || nice(g.pkg)));
  try {
    try { const t = await STK.api('/toggles?id=' + encodeURIComponent(serial), { timeout: 30000 }); a.prevToggles = t.toggles || {}; } catch (e) {}
    if (g.dnd) await setT(serial, 'dnd', true);
    if (g.touches) await setT(serial, 'touches', true);
    const p = ((state.schema && state.schema.presets) || []).find(x => x.id === g.preset);
    if (p) {
      const prev = {}; for (const k of Object.keys(p.v)) prev[k] = (state.settings || {})[k]; a.prevSettings = prev;
      try { await STK.post('/settings', { patch: p.v }); await STK.loadSettings(); } catch (e) { STK.fail(e); }
    }
    if (g.mirror && !STK.mirroring()) { await STK.actions.mirror(); a.mir = true; }
    if (g.record && !STK.recording()) { await STK.actions.record(); a.rec = true; }
  } finally { S.entering[serial] = false; }
}
async function exit(serial) {
  const a = S.active[serial]; if (!a) return;
  delete S.active[serial]; delete S.misses[serial]; render();
  STK.toast('Game mode off. Settings restored.');
  if (a.rec && STK.recording()) { try { await STK.actions.record(); } catch (e) {} }
  if (a.mir && STK.mirroring()) { try { await STK.actions.mirror(); } catch (e) {} }
  if (a.prevToggles) { if (a.g.dnd) await setT(serial, 'dnd', !!a.prevToggles.dnd); if (a.g.touches) await setT(serial, 'touches', !!a.prevToggles.touches); }
  if (a.prevSettings) { try { await STK.post('/settings', { patch: a.prevSettings }); await STK.loadSettings(); } catch (e) {} }
}
STK.on('live', ({ L }) => {
  const serial = STK.sel(); if (!serial || !L) return;
  const pkg = L.fgPackage, a = S.active[serial];
  if (!a) { const g = games().find(x => x.pkg === pkg && x.on !== false); if (g && pkg) enter(serial, g); }
  else if (pkg && pkg !== a.pkg) { S.misses[serial] = (S.misses[serial] || 0) + 1; if (S.misses[serial] >= 2) exit(serial); }
  else S.misses[serial] = 0;
});

document.addEventListener('click', async e => {
  const t = e.target.closest('#studio-root button'); if (!t) return;
  if (t.id === 'demo-toggle') return toggleDemo(t);
  if (t.id === 'demo-present') { STK.go('console'); return setTimeout(() => { if ($('#hero').dataset.size !== 'l') $('#frame-size').click(); }, 120); }
  if (t.id === 'game-add') return editGame(-1);
  if (t.dataset.gedit) return editGame(Number(t.dataset.gedit));
  if (t.dataset.gdel) { const list = games().slice(); list.splice(Number(t.dataset.gdel), 1); STK.kv.set('games', list); return render(); }
  if (t.dataset.spreset) {
    const p = state.schema.presets.find(x => x.id === t.dataset.spreset);
    return STK.busy(t, async () => { try { await STK.post('/settings', { patch: p.v }); await STK.loadSettings(); STK.toast(p.name + ' preset applied.'); } catch (er) { STK.fail(er); } });
  }
});
document.addEventListener('change', e => {
  const c = e.target.closest('input[data-gon]'); if (!c) return;
  const list = games().slice(); list[Number(c.dataset.gon)] = { ...list[Number(c.dataset.gon)], on: c.checked }; STK.kv.set('games', list);
});
STK.views.studio = { onShow() { render(); STK.loadSchema().then(render).catch(() => {}); loadDemo(); } };
STK.on('kv', () => render());
})();
