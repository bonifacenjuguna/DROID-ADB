/* Console view: device stage, mirror/record toggles, remote controls, sessions, preview, captures. */
(() => {
'use strict';
const { $, $$, esc, icon, bytes, ago, clock, state } = Object.assign({}, STK, { state: STK.state });
const setHtml = (el, html) => { if (el._h !== html) { el._h = html; el.innerHTML = html; } };
STK.setHtml = setHtml;

/* ---------- phone illustration ---------- */
function phoneSvg() {
  const info = STK.info(), dev = STK.current(), rec = STK.recording();
  const W = 200, H = 400, sx = 16, sy = 16, sw = 168, sh = 368;
  if (!dev) {
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="No phone connected"><rect class="ph-dash" x="6" y="6" width="188" height="388" rx="30"/>
      <g transform="translate(76 150) scale(2.2)" class="ph-ic"><path d="M8.5 3v5M15.5 3v5M6 8h12v3.5a6 6 0 01-12 0zM12 17.5V21"/></g>
      <text class="ph-sub" x="100" y="260" text-anchor="middle">No phone connected</text></svg>`;
  }
  const level = info && info.battery >= 0 ? info.battery : null;
  const fillH = level === null ? 0 : Math.round(sh * level / 100);
  const low = level !== null && level <= 15 && !info.charging;
  let inner = `<defs><clipPath id="scr"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="22"/></clipPath></defs>`;
  inner += `<rect class="ph-body" x="6" y="6" width="188" height="388" rx="30"/><rect class="ph-screen" x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="22"/>`;
  if (previewUrl) {
    inner += `<image class="ph-live-screen" href="${esc(previewUrl)}" x="${sx}" y="${sy}" width="${sw}" height="${sh}" preserveAspectRatio="xMidYMid slice" clip-path="url(#scr)"/>`;
  } else if (level !== null) {
    inner += `<g clip-path="url(#scr)"><rect class="${low ? 'ph-low' : 'ph-fill'}" x="${sx}" y="${sy + sh - fillH}" width="${sw}" height="${fillH}"/><line class="ph-edge" x1="${sx}" x2="${sx + sw}" y1="${sy + sh - fillH}" y2="${sy + sh - fillH}" ${low ? 'style="stroke:var(--bad)"' : ''}/></g>`;
    inner += `<text class="ph-num" x="100" y="206" text-anchor="middle">${level}<tspan font-size="24" dx="2">%</tspan></text>`;
    inner += `<text class="ph-sub" x="100" y="232" text-anchor="middle">${info.charging ? 'Charging' : (low ? 'Battery low' : 'Battery')}</text>`;
  } else {
    inner += `<text class="ph-sub" x="100" y="206" text-anchor="middle">${info && info.error ? 'Could not read phone' : 'Reading phone...'}</text>`;
  }
  inner += `<rect x="78" y="26" width="44" height="12" rx="6" fill="var(--panel-2)"/>`;
  if (rec) inner += `<circle class="ph-rec" cx="36" cy="34" r="6"/><text class="ph-sub" x="48" y="38">REC</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${previewUrl ? 'Live phone screen preview' : (level === null ? 'Phone' : 'Phone battery ' + level + ' percent')}">${inner}</svg>`;
}

function renderStage() {
  setHtml($('#phone'), phoneSvg());
  const dev = STK.current(), info = STK.info(), idEl = $('#stage-id'), specs = $('#stage-specs');
  const needs = state.devices.find(d => d.state !== 'device');
  if (!state.everOnline && !state.online) {
    setHtml(idEl, `<h2>Connecting...</h2><p>Waiting for the local backend.</p>`);
    setHtml(specs, '');
  } else if (!dev) {
    const why = needs ? (needs.state === 'unauthorized' ? 'The phone is waiting for you to accept the USB debugging prompt.' : 'The phone shows as ' + needs.state + '. Reconnect the cable or restart ADB.') : (state.deviceMessage || 'Connect a phone with USB debugging turned on.');
    setHtml(idEl, `<h2>No phone connected</h2><p>${esc(why)}</p><div class="chips"><button class="btn sm" data-view="device">${icon('phone', 'sm')}<span>Open device help</span></button></div>`);
    setHtml(specs, '');
  } else {
    const name = info && info.model ? [info.manufacturer, info.model].filter(Boolean).join(' ') : dev.id;
    const wifi = dev.transport === 'wifi';
    setHtml(idEl, `<h2>${esc(name)}</h2><p>${info && info.android ? 'Android ' + esc(info.android) + (info.sdk ? ' (API ' + esc(info.sdk) + ')' : '') : 'Reading device details'}</p>
      <div class="chips"><span class="chip sm ok"><i class="dot"></i><b>Ready</b></span><span class="chip sm">${icon(wifi ? 'wifi' : 'usb', 'sm')}<b>${wifi ? 'Wi-Fi' : 'USB'}</b></span>${info && info.battery >= 0 ? `<span class="chip sm"><b>Battery ${info.battery}%</b></span>` : ''}${info && info.charging ? `<span class="chip sm">${icon('bolt', 'sm')}<b>Charging${info.power ? ' (' + esc(info.power) + ')' : ''}</b></span>` : ''}<label class="switch sm preview-switch" title="Toggle live screen preview"><input type="checkbox" id="preview-live" aria-label="Live screen preview" ${STK.store.get('preview-live', false) ? 'checked' : ''}><i></i></label><button class="btn sm" id="preview-now" title="Refresh phone screen preview">${icon('refresh', 'sm')}<span>Update</span></button></div><p class="hint preview-note" id="preview-note">${esc(previewStatus)}</p>`);
    const rows = [];
    if (info && info.width) rows.push(['Screen', `${info.width} × ${info.height}` + (info.density ? ` · ${info.density} dpi` : '')]);
    if (info && info.storageTotal) rows.push(['Free storage', `${bytes(info.storageFree)} of ${bytes(info.storageTotal)}`]);
    if (info && info.ramTotal) rows.push(['Free memory', `${bytes(info.ramFree)} of ${bytes(info.ramTotal)}`]);
    if (info && info.tempC != null) rows.push(['Battery temperature', info.tempC + ' °C']);
    if (info && info.ip) rows.push(['Wi-Fi address', info.ip]);
    rows.push(['Device ID', dev.id]);
    setHtml(specs, rows.map(r => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd></div>`).join(''));
  }
  renderActions();
}

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
const K = { shade: false, quick: false, screenOn: null, vol: null, volMax: null, prevVol: null, at: 0, loading: false };
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
  try { const r = await STK.api('/keystate?id=' + encodeURIComponent(STK.sel()), { timeout: 15000 }); K.screenOn = r.screenOn; K.vol = r.volume; K.volMax = r.volumeMax; renderKeys(); } catch (e) {} finally { K.loading = false; }
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
  renderKeys();
  try { await call(); STK.flash(btn, true); K.at = Date.now() - 3000; }
  catch (e) { Object.assign(K, { shade: prev.shade, quick: prev.quick, screenOn: prev.screenOn, vol: prev.vol }); renderKeys(); STK.fail(e); STK.flash(btn, false); }
}
async function sendKey(btn) {
  pulse(btn);
  if (btn.dataset.ktoggle) return keyToggle(btn, btn.dataset.ktoggle);
  const key = btn.dataset.key;
  if (['back', 'home', 'recents'].includes(key)) { K.shade = false; K.quick = false; renderKeys(); }
  await STK.busy(btn, async () => {
    try { await STK.post('/key', { serial: STK.sel(), key }, { timeout: 20000 }); STK.flash(btn, true); if (key === 'volup' || key === 'voldown') setTimeout(() => pollKeystate(true), 400); if (key === 'power') { K.screenOn = K.screenOn === false; renderKeys(); setTimeout(() => pollKeystate(true), 800); } }
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

/* ---------- live preview ---------- */
let previewTimer = null, previewBusy = false, previewFails = 0, previewUrl = '', previewStatus = 'Use Update to load the phone screen, or enable live preview.';
async function previewShot(manual) {
  if (previewBusy) return;
  const id = STK.sel();
  if (!id) { previewStatus = 'Connect a phone to see its screen.'; renderStage(); return; }
  previewBusy = true;
  const btn = $('#preview-now');
  if (manual && btn) btn.classList.add('is-busy');
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 30000);
    let res;
    try { res = await fetch('/api/preview-image?id=' + encodeURIComponent(id) + '&t=' + Date.now(), { cache: 'no-store', signal: ctl.signal }); }
    finally { clearTimeout(to); }
    if (!res.ok) { let m = 'Preview failed.'; try { m = (await res.json()).error || m; } catch (e) {} throw new Error(m); }
    const blob = await res.blob();
    const previousUrl = previewUrl;
    previewUrl = URL.createObjectURL(blob);
    previewStatus = 'Updated ' + new Date().toLocaleTimeString();
    previewFails = 0;
    renderStage();
    if (previousUrl) URL.revokeObjectURL(previousUrl);
  } catch (e) {
    previewFails++;
    previewStatus = e.name === 'AbortError' ? 'The phone took too long to answer.' : e.message;
    renderStage();
    if (previewFails >= 3 && $('#preview-live') && $('#preview-live').checked) { $('#preview-live').checked = false; STK.store.set('preview-live', false); stopPreview(); STK.toast('Live preview was turned off after repeated errors.', 'bad'); }
  } finally { previewBusy = false; if (btn) btn.classList.remove('is-busy'); }
}
function loopPreview() {
  clearTimeout(previewTimer);
  if (!$('#preview-live').checked) return;
  const run = async () => {
    if (!$('#preview-live').checked) return;
    if (state.view === 'console' && !document.hidden) await previewShot(false);
    const every = Math.max(1, (state.settings && state.settings.previewSeconds) || 3) * 1000;
    previewTimer = setTimeout(run, every);
  };
  run();
}
function stopPreview() { clearTimeout(previewTimer); }
function clearPreview(message) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = '';
  previewStatus = message;
  renderStage();
}

/* ---------- rendering and timers ---------- */
function renderAll() { renderStage(); renderSessions(); renderFeed(); renderStrip(); renderMeter(); renderQuickline(); renderPicker(); }
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
document.addEventListener('click', e => { if (e.target.closest('#preview-now')) previewShot(true); });
document.addEventListener('change', e => {
  if (e.target.id !== 'preview-live') return;
  STK.store.set('preview-live', e.target.checked);
  previewStatus = e.target.checked ? 'Live preview enabled.' : 'Live preview paused.';
  const note = $('#preview-note'); if (note) note.textContent = previewStatus;
  if (e.target.checked) loopPreview(); else stopPreview();
});
$('#device-select').addEventListener('change', async e => {
  state.selected = e.target.value; STK.store.set('device', state.selected);
  if (!state.info[state.selected]) await STK.loadInfo(state.selected);
  renderAll(); STK.emit('device-changed');
});
$('#quick-preset') && 0;
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
STK.on('info', () => { renderStage(); renderPicker(); });
STK.on('settings', () => { renderQuickline(); });
STK.on('profiles', () => { renderQuickline(); });
STK.on('offline', () => { renderStage(); });
STK.on('library', () => { renderStrip(); renderMeter(); });
STK.on('library-changed', () => STK.loadLibrary());
STK.on('device-changed', () => { clearPreview('Selected phone changed. Select Update to load its screen.'); Object.assign(K, { shade: false, quick: false, screenOn: null, vol: null, prevVol: null }); renderKeys(); pollKeystate(true); if ($('#preview-live').checked) previewShot(false); });
STK.on('view', v => { if (v === 'console') { renderAll(); pollKeystate(true); STK.loadLibrary(); if ($('#preview-live').checked) loopPreview(); } else stopPreview(); });
STK.views.console = { onShow() { STK.loadLibrary(); } };
setInterval(tick, 1000);
renderAll();
if ($('#preview-live').checked) setTimeout(loopPreview, 600);
})();
