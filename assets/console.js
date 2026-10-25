/* Console view: mirror/record toggles, remote controls, sessions, captures. The phone card itself lives in device.js. */
(() => {
'use strict';
const { $, $$, esc, icon, bytes, ago, clock, state } = Object.assign({}, STK, { state: STK.state });
const setHtml = STK.setHtml;

/* ---------- action toggles ---------- */
function renderActions() {
  const dev = STK.current(), rec = STK.recording(), mir = STK.mirroring();
  const mb = $('#mirror-btn'), rb = $('#rec-btn'), sb = $('#shot-btn');
  if (!mb.classList.contains('is-busy')) {
    setHtml(mb, mir ? `${icon('stop')}<span>Stop mirror <time data-since="${esc(mir.started)}">${clock(mir.started)}</time></span>` : `${icon('mirror')}<span>Mirror</span>`);
    mb.setAttribute('aria-pressed', mir ? 'true' : 'false');
    mb.disabled = !!rec || (!dev && !mir);
    mb.title = rec ? 'Recording also shows the phone window' : (mir ? 'Close the mirror window' : 'Open a mirror window');
  }
  if (!rb.classList.contains('is-busy')) {
    setHtml(rb, rec ? `${icon('stop')}<span>Stop recording <time data-since="${esc(rec.started)}">${clock(rec.started)}</time>${rec.fileSize ? ' · ' + bytes(rec.fileSize) : ''}</span>` : `${icon('record')}<span>Record</span>`);
    rb.setAttribute('aria-pressed', rec ? 'true' : 'false');
    rb.disabled = !!mir || (!dev && !rec);
    rb.title = mir ? 'Close the mirror window first' : (rec ? 'Stop and save the recording' : 'Start recording');
  }
  sb.disabled = !dev;
  $$('#keys .key, [data-gesture], #text-input, #text-send, #url-input, #url-send, [data-key], [data-ktoggle]').forEach(b => { if (!b.closest('#view-phone')) b.disabled = !dev; });
}

async function stopSession(s, btn) {
  await STK.busy(btn, async () => {
    try {
      const r = await STK.post('/action', { action: 'stop', session: s ? s.id : '' }, { timeout: 40000 });
      state.sessions = r.sessions || [];
      STK.toast(r.message, r.forced ? 'bad' : 'ok');
      renderAll(); STK.pollNow(); STK.emit('library-changed');
    } catch (e) { STK.fail(e); STK.flash(btn, false); }
  });
}

function countdown(sec) {
  return new Promise(resolve => {
    const box = $('#countdown'), num = $('#countdown-num');
    let n = sec, done = false;
    box.hidden = false; num.textContent = n;
    const finish = ok => { if (done) return; done = true; clearInterval(t); box.hidden = true; $('#countdown-cancel').removeEventListener('click', cancel); resolve(ok); };
    const cancel = () => finish(false);
    $('#countdown-cancel').addEventListener('click', cancel);
    const t = setInterval(() => { n--; if (n <= 0) finish(true); else num.textContent = n; }, 1000);
  });
}

async function start(mode, btn, extra = {}) {
  const s = state.settings || {};
  if (mode === 'record' && s.recordCountdown > 0 && !(await countdown(s.recordCountdown))) return;
  await STK.busy(btn, async () => {
    try {
      const r = await STK.post('/action', { action: mode, serial: STK.sel(), ...extra }, { timeout: 40000 });
      state.sessions = r.sessions || [];
      if (r.started) STK.toast(r.message);
      else { state.ignoreSessions.add(r.session); STK.toast('scrcpy closed right away' + (r.reason ? ': ' + r.reason : '. Check the cable and unlock the phone.'), 'bad'); STK.flash(btn, false); }
      renderAll(); STK.pollNow();
    } catch (e) { STK.fail(e); STK.flash(btn, false); }
  });
}
STK.startSession = start;

async function screenshot(btn) {
  btn = btn || $('#shot-btn');
  if (!STK.sel()) return STK.toast('Connect a phone first.', 'bad');
  await STK.busy(btn, async () => {
    try { const r = await STK.post('/action', { action: 'screenshot', serial: STK.sel() }, { timeout: 60000 }); STK.toast(r.message + ' ' + r.name); STK.flash(btn, true); STK.loadLibrary(); STK.pollNow(); }
    catch (e) { STK.fail(e); STK.flash(btn, false); }
  });
}

STK.actions = {
  mirror: () => { const m = STK.mirroring(); return m ? stopSession(m, $('#mirror-btn')) : start('mirror', $('#mirror-btn')); },
  record: () => { const r = STK.recording(); return r ? stopSession(r, $('#rec-btn')) : start('record', $('#rec-btn')); },
  screenshot,
  stopAll: () => stopSession(null, null)
};

/* ---------- keys, gestures, text ---------- */
const K = STK.keys = { shade: false, quick: false, screenOn: null, vol: null, volMax: null, prevVol: null, at: 0, loading: false };
function renderKeys() {
  const st = { shade: K.shade, quick: K.quick, screen: K.screenOn !== false, mute: K.vol === 0 };
  $$('#keys [data-ktoggle]').forEach(b => {
    const on = !!st[b.dataset.ktoggle];
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const sc = $('#keys [data-ktoggle="screen"] span'); if (sc) sc.textContent = K.screenOn === false ? 'Screen off' : 'Screen on';
  const mu = $('#keys [data-ktoggle="mute"] span'); if (mu) mu.textContent = K.vol === 0 ? 'Muted' : 'Mute';
}
async function pollKeystate(force) {
  if (!STK.sel() || state.view !== 'console' || document.hidden || K.loading) return;
  if (!force && Date.now() - K.at < 6000) return;
  K.at = Date.now(); K.loading = true;
  try { const r = await STK.api('/keystate?id=' + encodeURIComponent(STK.sel()), { timeout: 15000 }); K.screenOn = r.screenOn; K.vol = r.volume; K.volMax = r.volumeMax; renderKeys(); STK.emit('keystate', STK.sel()); } catch (e) {} finally { K.loading = false; }
}
function pulse(btn) { btn.classList.add('is-pressed'); setTimeout(() => btn.classList.remove('is-pressed'), 260); }
async function keyToggle(btn, kind) {
  const prev = { shade: K.shade, quick: K.quick, screenOn: K.screenOn, vol: K.vol };
  let call;
  if (kind === 'shade') { const on = !K.shade; K.shade = on; K.quick = false; call = () => STK.post('/key', { serial: STK.sel(), key: on ? 'notifications' : 'collapse' }, { timeout: 20000 }); }
  else if (kind === 'quick') { const on = !K.quick; K.quick = on; K.shade = false; call = () => STK.post('/key', { serial: STK.sel(), key: on ? 'quicksettings' : 'collapse' }, { timeout: 20000 }); }
  else if (kind === 'screen') { const off = K.screenOn !== false; K.screenOn = !off; call = () => STK.post('/key', { serial: STK.sel(), key: off ? 'sleep' : 'wake' }, { timeout: 20000 }); }
  else if (kind === 'mute') {
    if (K.vol === null) { call = () => STK.post('/key', { serial: STK.sel(), key: 'mute' }, { timeout: 20000 }); K.vol = 0; }
    else if (K.vol === 0) { const back = K.prevVol || Math.max(1, Math.round((K.volMax || 15) / 2)); K.vol = back; call = () => STK.post('/toggle', { serial: STK.sel(), key: 'volume', value: back }, { timeout: 20000 }); }
    else { K.prevVol = K.vol; K.vol = 0; call = () => STK.post('/toggle', { serial: STK.sel(), key: 'volume', value: 0 }, { timeout: 20000 }); }
  }
  renderKeys(); if (kind === 'screen') STK.emit('keystate', STK.sel());
  try { await call(); STK.flash(btn, true); K.at = Date.now() - 3000; }
  catch (e) { Object.assign(K, { shade: prev.shade, quick: prev.quick, screenOn: prev.screenOn, vol: prev.vol }); renderKeys(); STK.emit('keystate', STK.sel()); STK.fail(e); STK.flash(btn, false); }
}
async function sendKey(btn) {
  pulse(btn);
  if (btn.dataset.ktoggle) return keyToggle(btn, btn.dataset.ktoggle);
  const key = btn.dataset.key;
  if (['back', 'home', 'recents'].includes(key)) { K.shade = false; K.quick = false; renderKeys(); }
  await STK.busy(btn, async () => {
    try { await STK.post('/key', { serial: STK.sel(), key }, { timeout: 20000 }); STK.flash(btn, true); if (key === 'volup' || key === 'voldown') setTimeout(() => pollKeystate(true), 400); if (key === 'power') { K.screenOn = K.screenOn === false; renderKeys(); STK.emit('keystate', STK.sel()); setTimeout(() => pollKeystate(true), 800); } }
    catch (e) { STK.fail(e); STK.flash(btn, false); }
  });
}
STK.sendKey = async key => { try { await STK.post('/key', { serial: STK.sel(), key }); } catch (e) { STK.fail(e); } };
async function sendGesture(btn) {
  await STK.busy(btn, async () => {
    try { await STK.post('/gesture', { serial: STK.sel(), kind: btn.dataset.gesture }, { timeout: 20000 }); STK.flash(btn, true); }
    catch (e) { STK.fail(e); STK.flash(btn, false); }
  });
}
async function sendText() {
  const input = $('#text-input'), text = input.value.trim(), btn = $('#text-send');
  if (!text) return;
  await STK.busy(btn, async () => {
    try { const r = await STK.post('/text', { serial: STK.sel(), text }); input.value = ''; input.classList.remove('bad'); STK.toast(r.message); }
    catch (e) { input.classList.add('bad'); STK.fail(e); }
  });
}
async function sendUrl() {
  const input = $('#url-input'), url = input.value.trim(), btn = $('#url-send');
  if (!url) return;
  await STK.busy(btn, async () => {
    try { const r = await STK.post('/open-url', { serial: STK.sel(), url }, { timeout: 25000 }); input.value = ''; input.classList.remove('bad'); STK.toast(r.message); }
    catch (e) { input.classList.add('bad'); STK.fail(e); }
  });
}

/* ---------- sessions, feed, captures ---------- */
function renderSessions() {
  const box = $('#sessions'), list = state.sessions, chip = $('#session-chip');
  chip.className = 'chip sm' + (list.some(s => s.recording) ? ' rec' : list.length ? ' ok' : '');
  setHtml(chip, `<i class="dot"></i><b>${list.length ? list.length + ' open' : 'None'}</b>`);
  if (!list.length) { setHtml(box, `<div class="empty">${icon('mirror')}<b>No windows open</b><p>Mirror or record to see a live timer here.</p></div>`); return; }
  setHtml(box, list.map(s => `<div class="sess ${s.recording ? 'rec' : ''}"><span class="badge">${icon(s.recording ? 'record' : 'mirror')}</span>
    <div><b>${s.recording ? (s.headless ? 'Recording in background' : 'Recording') : 'Mirroring'}${s.app ? ' · ' + esc(s.app) : ''}</b><div class="timer" data-since="${esc(s.started)}">${clock(s.started)}</div>
    <small>${s.recording && s.file ? esc(s.file) + ' · ' + bytes(s.fileSize) : (s.serial ? esc(s.serial) + ' · ' : '') + 'process ' + esc(s.pid)}</small></div>
    <div class="acts"><button class="icon-btn" data-sess-log="${esc(s.id)}" title="Show scrcpy output" aria-label="Show scrcpy output">${icon('list', 'sm')}</button><button class="btn sm danger" data-sess-stop="${esc(s.id)}">${icon('stop', 'sm')}<span>Stop</span></button></div></div>`).join(''));
}
const FEED_ICON = { record: 'record', mirror: 'mirror', stop: 'stop', screenshot: 'camera', wifi: 'wifi', delete: 'trash', system: 'pulse', error: 'alert', app: 'apps', files: 'folder', shell: 'terminal', rename: 'pencil' };
function renderFeed() {
  const list = $('#feed');
  if (!state.activity.length) { setHtml(list, '<li class="none hint">Actions you run will appear here.</li>'); return; }
  setHtml(list, state.activity.slice(0, 14).map(a => `<li class="${a.kind === 'error' ? 'err' : ''}">${icon(FEED_ICON[a.kind] || 'pulse')}<div><p>${esc(a.text)}</p><time>${esc(STK.ago(a.t))}</time></div></li>`).join(''));
}
function renderStrip() {
  const lib = state.lib || { recs: [], shots: [] };
  const items = [...lib.shots.map(f => ({ ...f, kind: 'shot' })), ...lib.recs.map(f => ({ ...f, kind: 'rec' }))].sort((a, b) => new Date(b.modified) - new Date(a.modified)).slice(0, 10);
  const strip = $('#strip');
  if (!items.length) { setHtml(strip, `<div class="empty">${icon('image')}<b>Nothing captured yet</b><p>Screenshots and recordings you take show up here.</p></div>`); return; }
  setHtml(strip, items.map(f => f.kind === 'shot'
    ? `<button class="tile" data-shot="${esc(f.name)}" title="${esc(f.name)}"><img loading="lazy" src="/api/file?kind=screenshots&name=${encodeURIComponent(f.name)}" alt="Screenshot ${esc(f.name)}"><span class="cap">${esc(ago(f.modified))}</span></button>`
    : `<button class="tile vid" data-play="${esc(f.name)}" title="Play ${esc(f.name)}">${icon('play')}<span class="cap"><b>${esc(f.name.replace(/\.\w+$/, ''))}</b>${bytes(f.size)} · ${esc(ago(f.modified))}${f.live ? ' · recording' : ''}</span></button>`).join(''));
}
function renderMeter() {
  const d = state.disk, t = (state.lib && state.lib.totals) || { recs: 0, shots: 0 };
  const media = t.recs + t.shots;
  if (!d || !d.total) { $('#meter-text').textContent = `${bytes(media)} in your library.`; return; }
  const used = d.total - d.free;
  setHtml($('#meter'), `<i class="m-media" style="width:${Math.max(0.6, media / d.total * 100).toFixed(2)}%"></i><i class="m-other" style="width:${Math.max(0, (used - media) / d.total * 100).toFixed(2)}%"></i>`);
  $('#meter-text').textContent = `${bytes(media)} of captures · ${bytes(d.free)} free on this PC`;
}

/* ---------- quick profile line ---------- */
function renderQuickline() {
  const s = state.settings, box = $('#quickline');
  if (!s || !state.schema) { setHtml(box, ''); return; }
  const presets = state.schema.presets || [], profiles = state.profiles || [];
  const active = STK.matchPreset ? STK.matchPreset(s) : 'custom';
  const opts = [`<option value="custom"${active === 'custom' ? ' selected' : ''}>Custom</option>`]
    .concat(presets.map(p => `<option value="preset:${esc(p.id)}"${active === p.id ? ' selected' : ''}>${esc(p.name)}</option>`))
    .concat(profiles.map(p => `<option value="profile:${esc(p.name)}">${esc(p.name)} (saved)</option>`));
  const sum = [s.source === 'camera' ? 'Camera' : (s.maxSize ? s.maxSize + ' px' : 'Native size'), s.maxFps + ' fps', s.bitrateMbps + ' Mbps', String(s.codec).toUpperCase().replace('H', 'H.'), s.audio ? 'sound on' : 'no sound'];
  if (s.recordWindowless) sum.push('background recording');
  setHtml(box, `<span>Quality</span><div class="select-wrap plain">${''}<select id="quick-preset" aria-label="Quality preset">${opts.join('')}</select>${icon('chevron', 'sm chev')}</div><span>${esc(sum.join(' · '))}</span><button class="link" data-view="settings" type="button">Edit settings</button>`);
}

/* ---------- rendering and timers ---------- */
function renderAll() { STK.renderDevice(); renderActions(); renderSessions(); renderFeed(); renderStrip(); renderMeter(); renderQuickline(); renderPicker(); }
STK.renderConsole = renderAll;

function renderPicker() {
  const ready = STK.readyDevices(), wrap = $('#device-pick'), s = $('#device-select');
  wrap.hidden = ready.length < 2;
  const html = ready.map(d => { const i = state.info[d.id]; return `<option value="${esc(d.id)}">${esc(i && i.model ? i.model : d.id)}</option>`; }).join('');
  setHtml(s, html);
  s.value = STK.sel();
}

function tick() {
  $$('.timer[data-since]').forEach(el => { el.textContent = clock(el.dataset.since); });
  $$('time[data-since]').forEach(el => { el.textContent = clock(el.dataset.since); });
  const r = STK.recording();
  document.title = r ? '● REC ' + clock(r.started) + ' · Scrcpy Toolkit' : 'Scrcpy Toolkit';
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.act) { const a = STK.actions[t.dataset.act]; if (a) a(); return; }
  if ((t.dataset.key || t.dataset.ktoggle) && !t.closest('#view-phone')) return sendKey(t);
  if (t.dataset.gesture) return sendGesture(t);
  if (t.dataset.sessStop) return stopSession(state.sessions.find(s => s.id === t.dataset.sessStop), t);
  if (t.dataset.sessLog) return showSessionLog(t.dataset.sessLog);
});
async function showSessionLog(id) {
  try { const r = await STK.api('/log?id=' + encodeURIComponent(id)); STK.showText('scrcpy output ' + (r.name ? '(' + r.name + ')' : ''), r.log); } catch (e) { STK.fail(e); }
}
STK.showSessionLog = showSessionLog;

$('#text-send').addEventListener('click', sendText);
$('#text-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });
$('#url-send').addEventListener('click', sendUrl);
$('#url-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendUrl(); });
$('#device-select').addEventListener('change', async e => {
  state.selected = e.target.value; STK.store.set('device', state.selected);
  if (!state.info[state.selected]) await STK.loadInfo(state.selected);
  renderAll(); STK.emit('device-changed');
});
document.addEventListener('change', async e => {
  if (e.target.id !== 'quick-preset') return;
  const v = e.target.value;
  try {
    if (v.startsWith('preset:')) { const p = state.schema.presets.find(x => x.id === v.slice(7)); await STK.post('/settings', { patch: p.v }); STK.toast('Quality set to ' + p.name + '. Applies to the next session.'); }
    else if (v.startsWith('profile:')) { await STK.post('/profiles/apply', { name: v.slice(8) }); STK.toast('Applied profile ' + v.slice(8) + '.'); }
    await STK.loadSettings();
  } catch (er) { STK.fail(er); }
  renderQuickline();
});

STK.on('state', () => { renderAll(); pollKeystate(); });
STK.on('info', () => { STK.renderDevice(); renderActions(); renderPicker(); });
STK.on('settings', () => { renderQuickline(); });
STK.on('profiles', () => { renderQuickline(); });
STK.on('offline', () => { STK.renderDevice(); renderActions(); });
STK.on('library', () => { renderStrip(); renderMeter(); });
STK.on('library-changed', () => STK.loadLibrary());
STK.on('device-changed', () => { Object.assign(K, { shade: false, quick: false, screenOn: null, vol: null, prevVol: null }); renderKeys(); pollKeystate(true); });
STK.on('view', v => { if (v === 'console') { renderAll(); pollKeystate(true); STK.loadLibrary(); } });
STK.views.console = { onShow() { STK.loadLibrary(); } };
setInterval(tick, 1000);
renderAll();
})();
