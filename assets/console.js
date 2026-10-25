/* Console view: phone card (framed live picture, orientation-aware), details, mirror/record toggles, remote controls, sessions, captures. */
(() => {
'use strict';
const { $, $$, esc, icon, bytes, ago, clock, state } = Object.assign({}, STK, { state: STK.state });
const setHtml = (el, html) => { if (el._h !== html) { el._h = html; el.innerHTML = html; } };
STK.setHtml = setHtml;
const S = () => state.settings || {};
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- friendly app names ---------- */
const KNOWN = { 'com.tencent.ig': 'PUBG MOBILE', 'com.whatsapp': 'WhatsApp', 'com.google.android.youtube': 'YouTube', 'com.instagram.android': 'Instagram', 'com.facebook.katana': 'Facebook', 'com.android.chrome': 'Chrome', 'com.google.android.apps.maps': 'Maps', 'com.google.android.gm': 'Gmail', 'com.spotify.music': 'Spotify', 'org.telegram.messenger': 'Telegram', 'com.netflix.mediaclient': 'Netflix', 'com.zhiliaoapp.musically': 'TikTok', 'com.supercell.clashofclans': 'Clash of Clans', 'com.activision.callofduty.shooter': 'Call of Duty Mobile', 'com.miui.home': 'Home screen', 'com.android.launcher3': 'Home screen', 'com.sec.android.app.launcher': 'Home screen', 'com.google.android.apps.nexuslauncher': 'Home screen', 'com.android.systemui': 'System UI', 'com.android.settings': 'Settings' };
function nice(pkg) {
  if (!pkg) return '';
  for (const part of String(S().appNames || '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === pkg) return part.slice(i + 1).trim() || pkg; }
  if (KNOWN[pkg]) return KNOWN[pkg];
  const seg = pkg.split('.').filter(x => !['com', 'org', 'net', 'android', 'google', 'app', 'apps', 'mobile', 'www'].includes(x));
  const w = (seg.pop() || pkg); return w.charAt(0).toUpperCase() + w.slice(1);
}
STK.niceApp = nice;

/* ---------- battery history, ETA, alerts ---------- */
const HIST = {}; let alerted = {}, diskAlerted = false;
function pushHist(serial, L) {
  if (!L || L.battery < 0) return;
  const h = HIST[serial] || (HIST[serial] = []), last = h[h.length - 1];
  if (last && last.v === L.battery && Date.now() - last.t < 60000) return;
  h.push({ t: Date.now(), v: L.battery, c: !!L.charging }); if (h.length > 180) h.shift();
}
function eta(serial, L) {
  const h = (HIST[serial] || []).filter(p => p.c === !!L.charging);
  if (h.length < 3) return '';
  const a = h[0], b = h[h.length - 1], mins = (b.t - a.t) / 60000, dv = b.v - a.v;
  if (mins < 8 || Math.abs(dv) < 2) return '';
  const perMin = dv / mins;
  if (L.charging && perMin > 0) { const m = (100 - b.v) / perMin; return m < 1440 ? 'Full in about ' + fmtMin(m) : ''; }
  if (!L.charging && perMin < 0) { const m = b.v / -perMin; return m < 2880 ? 'About ' + fmtMin(m) + ' left' : ''; }
  return '';
}
const fmtMin = m => m >= 60 ? Math.floor(m / 60) + ' h ' + (Math.round(m % 60) ? Math.round(m % 60) + ' min' : '').trim() : Math.max(1, Math.round(m)) + ' min';
function spark(serial) {
  const h = HIST[serial] || []; if (h.length < 3) return '';
  const W = 120, H = 28, t0 = h[0].t, span = Math.max(1, h[h.length - 1].t - t0);
  const pts = h.map(p => ((p.t - t0) / span * W).toFixed(1) + ',' + (H - 2 - p.v / 100 * (H - 4)).toFixed(1)).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}
function checkAlerts() {
  const id = STK.sel(), L = STK.live(), pct = Number(S().batteryAlertPct) || 0;
  if (id && L && pct > 0 && L.battery >= 0) {
    if (!L.charging && L.battery <= pct && !alerted[id]) { alerted[id] = true; STK.toast('Phone battery is low: ' + L.battery + '%.', 'bad'); }
    if (L.charging || L.battery > pct + 5) alerted[id] = false;
  }
  const lim = Number(S().lowDiskGb) || 0, d = state.disk;
  if (lim > 0 && d && d.total) { const low = d.free < lim * 1073741824; if (low && !diskAlerted) { diskAlerted = true; STK.toast('Only ' + bytes(d.free) + ' free on this PC. Recordings may stop early.', 'bad'); } if (!low && d.free > lim * 1073741824 * 1.3) diskAlerted = false; }
}
const lowDisk = () => { const lim = Number(S().lowDiskGb) || 0, d = state.disk; return lim > 0 && d && d.total && d.free < lim * 1073741824; };

/* ---------- hero: identity, battery, specs ---------- */
function renderStage() {
  const dev = STK.current(), info = STK.info(), L = STK.live(), idEl = $('#stage-id'), specs = $('#stage-specs'), bat = $('#battery');
  const needs = state.devices.find(d => d.state !== 'device');
  if (!state.everOnline && !state.online) {
    setHtml(idEl, `<h2>Connecting...</h2><p>Waiting for the local backend.</p>`); setHtml(specs, ''); setHtml(bat, '');
  } else if (!dev) {
    const why = needs ? (needs.state === 'unauthorized' ? 'The phone is waiting for you to accept the USB debugging prompt.' : 'The phone shows as ' + needs.state + '. Reconnect the cable or restart ADB.') : (state.deviceMessage || 'Connect a phone with USB debugging turned on.');
    setHtml(idEl, `<h2>No phone connected</h2><p>${esc(why)}</p><div class="chips"><button class="btn sm" data-view="device">${icon('phone', 'sm')}<span>Open device help</span></button></div>`);
    setHtml(specs, ''); setHtml(bat, '');
  } else {
    const name = info && info.model ? [info.manufacturer, info.model].filter(Boolean).join(' ') : dev.id;
    const wifi = dev.transport === 'wifi';
    const level = L && L.battery >= 0 ? L.battery : (info && info.battery >= 0 ? info.battery : -1);
    const charging = L ? L.charging : !!(info && info.charging);
    const power = (L && L.power) || (info && info.power) || '';
    const temp = L && L.tempC != null ? L.tempC : (info && info.tempC != null ? info.tempC : null);
    const fg = L && L.fgPackage ? nice(L.fgPackage) : '';
    const nick = STK.store.get('nick:' + dev.id, '');
    setHtml(idEl, `<h2><span>${esc(nick || name)}</span><button class="icon-btn mini" id="nick-btn" title="Give this phone a nickname" aria-label="Rename phone label">${icon('pencil', 'sm')}</button></h2><p>${nick ? esc(name) + ' · ' : ''}${info && info.android ? 'Android ' + esc(info.android) + (info.sdk ? ' (API ' + esc(info.sdk) + ')' : '') : 'Reading device details'}</p>
      <div class="chips"><span class="chip sm ok"><i class="dot"></i><b>Ready</b></span><span class="chip sm">${icon(wifi ? 'wifi' : 'usb', 'sm')}<b>${wifi ? 'Wi-Fi' : 'USB'}</b></span>${L && L.screenOn === false ? '<span class="chip sm warn"><i class="dot"></i><b>Screen off</b></span>' : ''}${fg ? `<span class="chip sm" title="App in front">${icon('apps', 'sm')}<b>${esc(fg)}</b></span>` : ''}</div>`);
    if (level >= 0) {
      const low = level <= (Number(S().batteryAlertPct) || 15) && !charging;
      const e = L ? eta(dev.id, L) : '';
      setHtml(bat, `<div class="bat-main"><div class="bat-num ${low ? 'low' : ''}"><b>${level}</b><span>%</span></div><div class="bat-side"><div class="bat-bar ${low ? 'low' : ''} ${charging ? 'chg' : ''}" role="img" aria-label="Battery ${level} percent"><i style="width:${level}%"></i></div>
        <div class="bat-line">${charging ? `<span class="bolt">${icon('bolt', 'sm')}Charging${power ? ' · ' + esc(power) : ''}</span>` : '<span>On battery</span>'}${temp != null ? `<span>${esc(temp)} °C</span>` : ''}${L && L.voltage ? `<span>${(L.voltage / 1000).toFixed(2)} V</span>` : ''}</div>
        ${e ? `<div class="bat-eta">${esc(e)}</div>` : ''}</div>${spark(dev.id)}</div>`);
    } else setHtml(bat, '');
    const rows = [];
    if (info && info.width) rows.push(['Screen', `${info.width} × ${info.height}` + (info.density ? ` · ${info.density} dpi` : '')]);
    if (info && info.storageTotal) rows.push(['Free storage', `${bytes(info.storageFree)} of ${bytes(info.storageTotal)}`]);
    if (info && info.ramTotal) rows.push(['Free memory', `${bytes(info.ramFree)} of ${bytes(info.ramTotal)}`]);
    if (info && info.ip) rows.push(['Wi-Fi address', info.ip]);
    rows.push(['Device ID', dev.id]);
    setHtml(specs, rows.map(r => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd></div>`).join(''));
  }
  renderActions();
  renderDeviceState();
}

/* ---------- independent mirror / record toggles ---------- */
function renderActions() {
  const dev = STK.current(), rec = STK.recording(), mir = STK.mirroring(), view = STK.viewer();
  const mb = $('#mirror-btn'), rb = $('#rec-btn'), sb = $('#shot-btn');
  if (!mb.classList.contains('is-busy')) {
    setHtml(mb, mir ? `${icon('stop')}<span>Stop mirror <time data-since="${esc(mir.started)}">${clock(mir.started)}</time></span>` : `${icon('mirror')}<span>Mirror</span>`);
    mb.setAttribute('aria-pressed', mir ? 'true' : 'false');
    const lock = !mir && view && view.recording;
    mb.disabled = !!lock || (!dev && !mir);
    mb.title = lock ? 'This recording has its own window. Stop it to mirror separately.' : (mir ? 'Close the mirror window' : 'Open a mirror window');
  }
  if (!rb.classList.contains('is-busy')) {
    const comp = rec && rec.companion;
    setHtml(rb, rec ? `${icon('stop')}<span>Stop recording <time data-since="${esc(rec.started)}">${clock(rec.started)}</time>${rec.fileSize ? ' · ' + bytes(rec.fileSize) : ''}</span>` : `${icon('record')}<span>Record</span>`);
    rb.setAttribute('aria-pressed', rec ? 'true' : 'false');
    const block = !rec && mir && S().recordWhileMirroring === 'block';
    rb.disabled = !!block || (!dev && !rec);
    rb.title = block ? 'Close the mirror window first (change this in Settings)' : (rec ? 'Stop and save the recording' : (mir ? 'Record in the background while the mirror stays open' : 'Start recording')) + (comp ? '' : '');
  }
  sb.disabled = !dev;
  $$('#keys .key, [data-gesture], #text-input, #text-send, #url-input, #url-send, [data-key], [data-ktoggle]').forEach(b => { if (!b.closest('#view-phone')) b.disabled = !dev; });
  $$('#frame-tools button, #frame-tools input').forEach(b => { b.disabled = !dev; });
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
  mirror: async () => {
    const m = STK.mirroring();
    if (m) { const r = STK.recording(); await stopSession(m, $('#mirror-btn')); if (S().autoRecordWithMirror && r && r.companion) await stopSession(r, $('#rec-btn')); return; }
    await start('mirror', $('#mirror-btn'));
    if (S().autoRecordWithMirror && STK.mirroring() && !STK.recording()) await start('record', $('#rec-btn'));
  },
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
  if (['playpause', 'next', 'prev'].includes(key)) { setTimeout(() => pollMedia(true), 700); setTimeout(() => pollMedia(true), 2200); }
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
  setHtml(box, (list.length > 1 ? `<div class="sess-all"><button class="btn sm danger" data-act="stopAll">${icon('stop', 'sm')}<span>Stop all</span></button></div>` : '') + list.map(s => `<div class="sess ${s.recording ? 'rec' : ''}"><span class="badge">${icon(s.recording ? 'record' : 'mirror')}</span>
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
  $('#meter-text').textContent = `${bytes(media)} of captures · ${bytes(d.free)} free on this PC` + (lowDisk() ? ' · low space' : '');
  $('#meter-text').classList.toggle('warn', !!lowDisk());
}

/* ---------- media card ---------- */
const M = { at: 0, loading: false, data: null, serial: '' };
function renderMedia() {
  const d = M.data, body = $('#media-body'), chip = $('#media-chip');
  const has = d && d.active && STK.sel();
  const playing = !!(has && d.playing);
  body.dataset.state = !STK.sel() ? 'off' : has ? (playing ? 'playing' : 'paused') : 'idle';
  $('#media-title').textContent = has ? (d.title || nice(d.package) || 'Playing') : (STK.sel() ? 'Nothing playing' : 'No phone connected');
  $('#media-artist').textContent = has ? ([d.artist, d.album].filter(Boolean).join(' · ') || (playing ? 'Playing now' : 'Paused')) : (STK.sel() ? 'Start music or a video on the phone and it shows up here.' : 'Connect a phone to control its media.');
  $('#media-app').textContent = has ? nice(d.package) : '';
  chip.className = 'chip sm' + (playing ? ' ok' : '');
  setHtml(chip, `<i class="dot"></i><b>${playing ? 'Playing' : has ? 'Paused' : 'Idle'}</b>`);
  setHtml($('#media-play'), icon(playing ? 'pause' : 'play'));
  $('#media-play').title = playing ? 'Pause' : 'Play';
}
async function pollMedia(force) {
  if (!STK.sel() || state.view !== 'console' || document.hidden || M.loading) return;
  if (!force && Date.now() - M.at < 4000 && M.serial === STK.sel()) return;
  M.at = Date.now(); M.loading = true; const id = STK.sel();
  try { const r = await STK.api('/media?id=' + encodeURIComponent(id), { timeout: 15000 }); if (id === STK.sel()) { M.data = r; M.serial = id; } } catch (e) { /* keep the last answer */ } finally { M.loading = false; }
  renderMedia();
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

/* ---------- phone frame: orientation controller ---------- */
const O = { cur: 'portrait', want: null, timer: null, lastFlip: 0, born: Date.now(), frameAuth: false };
const P = { busy: false, ctl: null, timer: null, fails: 0, etag: '', url: '', w: 0, h: 0, at: 0, serial: '', imgOrient: '', queued: false, followUp: null, secure: 0, lastRot: null, lastScreen: null, requests: 0, urls: 0 };
STK._preview = P; STK._orient = O;
const orientOf = (w, h) => (w > h ? 'landscape' : 'portrait');
function computedDims() {
  const info = STK.info(), L = STK.live(); if (!info || !info.width) return null;
  let w = Number(info.width), h = Number(info.height);
  if (L && L.rotation >= 0 && L.rotation % 2 === 1) [w, h] = [h, w];
  return { w, h };
}
function targetDims() {
  if (P.w && P.serial === STK.sel() && O.frameAuth) return { w: P.w, h: P.h };
  const c = computedDims(); if (c) return c;
  const L = STK.live();
  if (L && L.rotation >= 0) return L.rotation % 2 ? { w: 20, h: 9 } : { w: 9, h: 20 };
  if (P.w && P.serial === STK.sel()) return { w: P.w, h: P.h };
  return { w: 9, h: 20 };
}
function applyLayout(orient, d) {
  const grid = $('#console-grid'), hero = $('#hero'), dev = $('#device');
  grid.dataset.orient = hero.dataset.orient = dev.dataset.orient = orient;
  setAspect(d);
}
function setAspect(d) {
  const ar = Math.max(0.3, Math.min(3.4, d.w / d.h));
  const v = ar.toFixed(4);
  if ($('#screen').style.getPropertyValue('--ar') !== v) $('#screen').style.setProperty('--ar', v);
}
function animateLayout(fn) {
  const mode = S().layoutAnimation || 'auto';
  const motion = mode === 'on' || (mode === 'auto' && !reduceMotion());
  if (!motion || !document.startViewTransition || state.view !== 'console') return fn();
  const grid = $('#console-grid'); grid.classList.add('vt');
  try { const vt = document.startViewTransition(fn); const done = () => grid.classList.remove('vt'); vt.finished.then(done, done); }
  catch (e) { grid.classList.remove('vt'); fn(); }
}
function syncOrientation() {
  const d = targetDims(), want = orientOf(d.w, d.h);
  if (want === O.cur) { clearTimeout(O.timer); O.timer = null; O.want = null; setAspect(d); return; }
  if (O.want === want && O.timer) return;
  clearTimeout(O.timer); O.want = want;
  const early = Date.now() - O.born < 2500;
  const wait = early ? 0 : Math.max(O.lastFlip ? 1000 - (Date.now() - O.lastFlip) : 0, 400);
  const go = () => {
    O.timer = null; const dd = targetDims(), w2 = orientOf(dd.w, dd.h);
    if (w2 === O.cur) return;
    O.cur = w2; O.lastFlip = Date.now();
    animateLayout(() => { applyLayout(w2, dd); renderDeviceState(); });
  };
  if (!wait) { O.cur = want; applyLayout(want, d); renderDeviceState(); return; }
  O.timer = setTimeout(go, wait);
}
function onLive({ L, prev }) {
  const id = STK.sel(); if (!id || !L) return;
  pushHist(id, L);
  if (prev && prev.rotation >= 0 && L.rotation !== prev.rotation) {
    O.frameAuth = false;
    if (S().previewOnRotate !== false) { clearTimeout(P.followUp); P.followUp = setTimeout(() => shoot({ reason: 'rotate' }), 650); }
  }
  if (prev && prev.screenOn === false && L.screenOn) { clearTimeout(P.followUp); P.followUp = setTimeout(() => shoot({ reason: 'wake' }), 500); }
  syncOrientation(); renderStage(); renderDeviceState(); checkAlerts();
}

/* ---------- phone frame: states ---------- */
function frameState() {
  const dev = STK.current(), L = STK.live(), img = $('#screen-img');
  if (!state.everOnline && !state.online) return { k: 'loading', t: 'Connecting to the backend...' };
  if (!state.online && state.failures >= 3) return { k: 'lost', t: 'Backend not answering', s: 'Retrying automatically.', dim: P.hasImage, small: P.hasImage };
  if (!dev) {
    const bad = state.devices.find(d => d.state !== 'device');
    if (bad && bad.state === 'unauthorized') return { k: 'none', t: 'Waiting for permission', s: 'Accept the USB debugging prompt on the phone.' };
    if (bad) return { k: 'none', t: 'Phone is ' + bad.state, s: 'Reconnect the cable or restart ADB.' };
    return { k: 'none', t: 'No phone connected', s: 'Plug in a phone with USB debugging on.' };
  }
  if (P.err && !P.hasImage) return { k: 'error', t: 'Could not read the screen', s: P.err, retry: true };
  if (!P.hasImage) { if (!P.loadAt) P.loadAt = Date.now(); return Date.now() - P.loadAt > 700 ? { k: 'loading', t: 'Reading the screen...' } : { k: 'wait', t: '', quiet: true }; } P.loadAt = 0;
  if (P.imgOrient && P.imgOrient !== O.cur) { if (!P.mismatchAt) P.mismatchAt = Date.now(); if (Date.now() - P.mismatchAt > 1800) return { k: 'rotating', t: 'Rotating...', small: true }; } else P.mismatchAt = 0;
  if (L && L.screenOn === false) return { k: 'off', t: 'Screen is off', s: 'The picture shows the last frame.', wake: true, dim: true };
  if (P.err) return { k: 'stale', t: 'Out of date', s: P.err, retry: true, dim: true };
  if (P.paused) return { k: 'paused', t: 'Preview paused', s: P.paused, dim: true, small: true };
  return null;
}
function renderDeviceState() {
  const f = frameState(), box = $('#screen-state'), dev = $('#device'), img = $('#screen-img'), ghost = $('#screen-ghost');
  const show = P.hasImage && P.imgOrient === O.cur;
  img.hidden = !show;
  ghost.style.backgroundImage = !show && P.url ? `url("${P.url}")` : '';
  dev.dataset.state = f ? f.k : (P.busy && P.manualBusy ? 'updating' : 'ok');
  dev.classList.toggle('is-dim', !!(f && f.dim));
  const html = f && f.quiet ? '' : f ? `<div class="ss ${f.small ? 'small' : ''}">${f.k === 'loading' || f.k === 'rotating' ? '<i class="spin"></i>' : icon(f.k === 'error' || f.k === 'lost' || f.k === 'stale' ? 'alert' : f.k === 'off' ? 'sun-moon' : 'phone')}<b>${esc(f.t)}</b>${f.s ? `<span>${esc(f.s)}</span>` : ''}${f.retry ? '<button class="btn sm" data-fs="retry">Try again</button>' : ''}${f.wake ? '<button class="btn sm" data-fs="wake">Wake screen</button>' : ''}</div>` : '';
  setHtml(box, html);
  const badges = [];
  const rec = STK.recording(), L = STK.live(), id = STK.sel();
  if (rec && S().showRecBadge !== false) badges.push(`<span class="sb rec"><i></i>REC <time data-since="${esc(rec.started)}">${clock(rec.started)}</time>${rec.fileSize ? ' · ' + bytes(rec.fileSize) : ''}</span>`);
  if (L && L.battery >= 0 && L.battery <= (Number(S().batteryAlertPct) || 0) && !L.charging) badges.push('<span class="sb low">Low battery</span>');
  if ($('#preview-live').checked && P.hasImage && !P.paused) badges.push('<span class="sb live"><i></i>Live</span>');
  setHtml($('#screen-badges'), badges.join(''));
  renderMeta();
}
function renderMeta() {
  const m = $('#frame-meta');
  if (!STK.current()) { m.textContent = ''; return; }
  if (!P.w || P.serial !== STK.sel()) { m.textContent = P.busy ? 'Taking a picture...' : 'No picture yet.'; return; }
  const age = Math.max(0, Math.round((Date.now() - P.at) / 1000));
  m.textContent = `${P.w} × ${P.h} · ${O.cur === 'landscape' ? 'Landscape' : 'Portrait'} · ${P.busy ? 'updating...' : (age < 3 ? 'just now' : age + ' s ago')}`;
}

/* ---------- phone frame: preview engine ---------- */
function resetFrame() {
  if (P.ctl) { try { P.ctl.abort(); } catch (e) {} }
  clearTimeout(P.followUp); P.etag = ''; P.w = P.h = 0; P.hasImage = false; P.imgOrient = ''; P.err = ''; P.fails = 0; O.frameAuth = false; P.paused = '';
  const img = $('#screen-img'); img.removeAttribute('src'); if (P.url) { URL.revokeObjectURL(P.url); P.urls--; P.url = ''; }
}
function pausedReason(manual) {
  if (manual) return '';
  if (S().previewPauseOnSession && STK.sessionFor(STK.sel()).length) return 'Paused while a session runs.';
  return '';
}
async function shoot(opts = {}) {
  const manual = !!opts.manual, id = STK.sel();
  if (!id) { renderDeviceState(); return; }
  if (P.serial !== id) { resetFrame(); P.serial = id; }
  if (state.view !== 'console') return;
  if (!manual && document.hidden) return;
  if (P.busy) { if (manual) P.queued = true; return; }
  const why = pausedReason(manual);
  if (why !== P.paused) { P.paused = why; renderDeviceState(); }
  if (why) return;
  const L = STK.live();
  if (!manual && L && L.screenOn === false && P.hasImage) { renderDeviceState(); return; }
  P.busy = true; P.manualBusy = manual; P.requests++;
  if (manual) $('#preview-now').classList.add('is-busy');
  $('#device').classList.add('is-updating'); renderMeta();
  const ctl = new AbortController(); P.ctl = ctl; const to = setTimeout(() => ctl.abort(), 25000);
  try {
    const headers = P.etag && !opts.force ? { 'If-None-Match': P.etag } : {};
    const res = await fetch('/api/preview-image?id=' + encodeURIComponent(id) + (opts.force ? '&maxAge=0' : '') + '&t=' + Date.now(), { cache: 'no-store', signal: ctl.signal, headers });
    clearTimeout(to);
    if (id !== STK.sel() || ctl.signal.aborted) return;
    if (res.status === 304) { P.at = Date.now(); P.err = ''; P.fails = 0; return; }
    if (!res.ok) { let m = 'The phone did not return a picture.'; try { m = (await res.json()).error || m; } catch (e) {} throw new Error(m); }
    const blob = await res.blob();
    if (id !== STK.sel() || ctl.signal.aborted) return;
    const url = URL.createObjectURL(blob); P.urls++;
    const probe = new Image(); probe.src = url;
    try { await probe.decode(); } catch (e) { URL.revokeObjectURL(url); P.urls--; throw new Error('The picture could not be read.'); }
    if (id !== STK.sel() || ctl.signal.aborted) { URL.revokeObjectURL(url); P.urls--; return; }
    const hw = Number(res.headers.get('X-Frame-W')), hh = Number(res.headers.get('X-Frame-H'));
    const w = hw > 0 ? hw : probe.naturalWidth, h = hh > 0 ? hh : probe.naturalHeight;
    const old = P.url, img = $('#screen-img');
    img.src = url; P.url = url; P.w = w; P.h = h; P.at = Date.now(); P.etag = res.headers.get('ETag') || ''; P.hasImage = true; P.err = ''; P.fails = 0;
    P.imgOrient = orientOf(w, h); O.frameAuth = true;
    if (old) { const done = () => { URL.revokeObjectURL(old); P.urls--; }; img.decode ? img.decode().then(done, done) : done(); }
    syncOrientation();
  } catch (e) {
    clearTimeout(to);
    if (id !== STK.sel()) return;
    if (e.name === 'AbortError' && ctl.signal.aborted && P.serial !== id) return;
    P.fails++; P.err = e.name === 'AbortError' ? 'The phone took too long to answer.' : (e.message || 'Preview failed.');
    if (P.fails >= 4 && $('#preview-live').checked) { $('#preview-live').checked = false; STK.store.set('preview-live', false); stopLoop(); STK.toast('Live preview was turned off after repeated errors.', 'bad'); }
  } finally {
    clearTimeout(to); P.busy = false; P.manualBusy = false; $('#preview-now').classList.remove('is-busy'); $('#device').classList.remove('is-updating');
    renderDeviceState();
    if (P.queued) { P.queued = false; shoot({ manual: true }); }
  }
}
function stopLoop() { clearTimeout(P.timer); P.timer = null; }
function loopPreview() {
  stopLoop();
  if (!$('#preview-live').checked || state.view !== 'console') return;
  const run = async () => {
    if (!$('#preview-live').checked || state.view !== 'console') return;
    const t0 = Date.now();
    if (!document.hidden) await shoot({});
    const base = Math.max(1, S().previewSeconds || 3) * 1000;
    const delay = Math.min(60000, base * Math.pow(2, Math.min(P.fails, 4)));
    P.timer = setTimeout(run, Math.max(delay - (Date.now() - t0), 400));
  };
  run();
}

/* ---------- phone frame: touch ---------- */
const T = { id: null, x: 0, y: 0, t: 0, inflight: 0, hold: 0 };
function toDevice(e) {
  const r = $('#screen').getBoundingClientRect(); if (!P.w || !r.width) return null;
  const nx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), ny = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  return { nx, ny, x: Math.round(nx * (P.w - 1)), y: Math.round(ny * (P.h - 1)) };
}
function fx(kind, nx, ny, nx2, ny2) {
  const box = $('#screen-fx'); if (reduceMotion()) return;
  const el = document.createElement('i'); el.className = 'fx-' + kind; el.style.left = nx * 100 + '%'; el.style.top = ny * 100 + '%';
  if (kind === 'swipe') { const dx = (nx2 - nx) * box.clientWidth, dy = (ny2 - ny) * box.clientHeight; el.style.width = Math.hypot(dx, dy) + 'px'; el.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`; }
  box.appendChild(el); setTimeout(() => el.remove(), 600);
}
function touchReady() { return S().previewTouch !== false && STK.sel() && P.hasImage && P.imgOrient === O.cur && !$('#device').classList.contains('is-dim'); }
const cur = document.createElement('i'); cur.className = 'finger'; cur.hidden = true; $('#screen-fx').appendChild(cur);
function moveFinger(e) {
  const r = $('#screen').getBoundingClientRect();
  cur.style.transform = `translate(${(e.clientX - r.left).toFixed(1)}px, ${(e.clientY - r.top).toFixed(1)}px)`;
}
$('#screen').addEventListener('pointerenter', e => { if (touchReady()) { cur.hidden = false; moveFinger(e); $('#screen').classList.add('touch'); } });
$('#screen').addEventListener('pointermove', e => { if (!touchReady()) { cur.hidden = true; $('#screen').classList.remove('touch'); return; } if (cur.hidden) { cur.hidden = false; $('#screen').classList.add('touch'); } moveFinger(e); if (T.id === e.pointerId && T.p) { const m = Math.hypot(e.clientX - T.x, e.clientY - T.y); cur.classList.toggle('drag', m > 9); } });
$('#screen').addEventListener('pointerleave', () => { if (T.id === null) cur.hidden = true; });
$('#screen').addEventListener('pointerdown', e => {
  if (e.button !== 0 || !touchReady()) return;
  const p = toDevice(e); if (!p) return;
  T.id = e.pointerId; T.p = p; T.x = e.clientX; T.y = e.clientY; T.t = performance.now(); cur.classList.add('down'); cur.classList.remove('drag'); clearTimeout(T.hold); T.hold = setTimeout(() => cur.classList.add('hold'), 450);
  try { $('#screen').setPointerCapture(e.pointerId); } catch (er) {}
});
$('#screen').addEventListener('pointerup', async e => {
  if (e.pointerId !== T.id) return; T.id = null; clearTimeout(T.hold); cur.classList.remove('down', 'hold', 'drag');
  const p = toDevice(e); if (!p || !T.p || T.inflight > 2) return;
  const ms = Math.round(performance.now() - T.t), moved = Math.hypot(e.clientX - T.x, e.clientY - T.y);
  const serial = STK.sel(); T.inflight++;
  try {
    if (moved < 9) { fx('tap', T.p.nx, T.p.ny); await STK.post('/tap', { serial, x: T.p.x, y: T.p.y, holdMs: ms >= 450 ? Math.min(ms, 3000) : 0 }, { timeout: 15000 }); }
    else { fx('swipe', T.p.nx, T.p.ny, p.nx, p.ny); await STK.post('/swipe', { serial, x1: T.p.x, y1: T.p.y, x2: p.x, y2: p.y, ms: Math.min(1500, Math.max(80, ms)) }, { timeout: 15000 }); }
    clearTimeout(P.followUp); P.followUp = setTimeout(() => shoot({ reason: 'touch' }), 450);
  } catch (er) { STK.fail(er); } finally { T.inflight--; }
});
$('#screen').addEventListener('pointercancel', () => { T.id = null; clearTimeout(T.hold); cur.classList.remove('down', 'hold', 'drag'); });

/* drop an APK or file on the frame */
(() => {
  const scr = $('#screen'), drop = $('#screen-drop'); let depth = 0;
  const has = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  scr.addEventListener('dragenter', e => { if (!has(e) || !STK.sel()) return; e.preventDefault(); depth++; drop.hidden = false; });
  scr.addEventListener('dragover', e => { if (has(e)) e.preventDefault(); });
  scr.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.hidden = true; });
  scr.addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; drop.hidden = true;
    const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f || !STK.sel()) return;
    const id = STK.sel(), isApk = /\.apk$/i.test(f.name);
    STK.toast((isApk ? 'Installing ' : 'Sending ') + f.name + '...');
    try {
      const r = isApk ? await STK.upload(`/install?id=${encodeURIComponent(id)}&name=${encodeURIComponent(f.name)}`, f) : await STK.upload(`/files/push?id=${encodeURIComponent(id)}&name=${encodeURIComponent(f.name)}&dest=${encodeURIComponent('/sdcard/Download')}`, f);
      STK.toast(isApk ? (r.message || 'Installed.') : 'Sent ' + f.name + ' to Download.');
    } catch (er) { STK.fail(er); }
  });
})();

/* ---------- frame tools ---------- */
async function copyFrame() {
  if (!P.hasImage) return STK.toast('No picture yet.', 'bad');
  try {
    const blob = await (await fetch(P.url)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    STK.toast('Picture copied.');
  } catch (e) { STK.toast('The browser blocked copying. Use Screenshot to save a file.', 'bad'); }
}
function frameSize() { return STK.store.get('frame-size', 'm') === 'l' ? 'l' : 'm'; }
function applySize() {
  const z = frameSize(); $('#hero').dataset.size = z; document.body.classList.toggle('theater', z === 'l');
  $('#frame-close').hidden = z !== 'l'; $('#frame-size').setAttribute('aria-pressed', z === 'l' ? 'true' : 'false');
  $('#frame-size').title = z === 'l' ? 'Back to normal size (Esc)' : 'Pop the phone out to a big screen';
}
function setSize(z) { STK.store.set('frame-size', z); applySize(); }


/* ---------- rendering and timers ---------- */
function renderAll() { renderMedia(); renderStage(); renderSessions(); renderFeed(); renderStrip(); renderMeter(); renderQuickline(); renderPicker(); }
STK.renderConsole = renderAll;

function renderPicker() {
  const ready = STK.readyDevices(), wrap = $('#device-pick'), s = $('#device-select');
  wrap.hidden = ready.length < 2;
  const html = ready.map(d => { const i = state.info[d.id]; return `<option value="${esc(d.id)}">${esc(STK.store.get('nick:' + d.id, '') || (i && i.model ? i.model : d.id))}</option>`; }).join('');
  setHtml(s, html);
  s.value = STK.sel();
}

function tick() {
  $$('.timer[data-since]').forEach(el => { el.textContent = clock(el.dataset.since); });
  $$('time[data-since]').forEach(el => { el.textContent = clock(el.dataset.since); });
  const r = STK.recording();
  document.title = r ? '● REC ' + clock(r.started) + ' · Scrcpy Toolkit' : 'Scrcpy Toolkit';
  if (state.view === 'console') renderMeta();
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.fs === 'retry') return shoot({ manual: true, force: true });
  if (t.dataset.fs === 'wake') return STK.post('/key', { serial: STK.sel(), key: 'wake' }).then(() => setTimeout(() => shoot({ manual: true }), 700)).catch(STK.fail);
  if (t.id === 'nick-btn') return STK.prompt ? nick() : 0;
  if (t.dataset.act) { const a = STK.actions[t.dataset.act]; if (a) a(); return; }
  if ((t.dataset.key || t.dataset.ktoggle) && !t.closest('#view-phone')) return sendKey(t);
  if (t.dataset.gesture) return sendGesture(t);
  if (t.dataset.sessStop) return stopSession(state.sessions.find(s => s.id === t.dataset.sessStop), t);
  if (t.dataset.sessLog) return showSessionLog(t.dataset.sessLog);
});
async function nick() {
  const id = STK.sel(); if (!id) return;
  const v = await STK.prompt('Phone nickname', 'Shown in the dashboard only. Leave empty to use the phone model.', STK.store.get('nick:' + id, ''));
  if (v === null || v === undefined) return;
  STK.store.set('nick:' + id, String(v).trim().slice(0, 40)); renderStage(); renderPicker();
}
async function showSessionLog(id) {
  try { const r = await STK.api('/log?id=' + encodeURIComponent(id)); STK.showText('scrcpy output ' + (r.name ? '(' + r.name + ')' : ''), r.log); } catch (e) { STK.fail(e); }
}
STK.showSessionLog = showSessionLog;
STK.preview = { update: () => shoot({ manual: true, force: true }), toggleLive: () => { const c = $('#preview-live'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); }, copy: copyFrame };

$('#text-send').addEventListener('click', sendText);
$('#text-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });
$('#url-send').addEventListener('click', sendUrl);
$('#url-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendUrl(); });
$('#preview-now').addEventListener('click', () => shoot({ manual: true, force: true }));
$('#preview-live').addEventListener('change', e => { STK.store.set('preview-live', e.target.checked); if (e.target.checked) { P.fails = 0; loopPreview(); } else stopLoop(); renderDeviceState(); });
$('#preview-live').checked = !!STK.store.get('preview-live', false);
$('#frame-copy').addEventListener('click', copyFrame);
$('#frame-size').addEventListener('click', () => setSize(frameSize() === 'l' ? 'm' : 'l'));
$('#frame-close').addEventListener('click', () => setSize('m'));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && frameSize() === 'l' && !document.querySelector('dialog[open]')) setSize('m'); });
$('#hero-phone').addEventListener('mousedown', e => { if (frameSize() === 'l' && e.target === $('#hero-phone')) setSize('m'); });
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
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view === 'console') { if ($('#preview-live').checked) loopPreview(); else if (P.hasImage && Date.now() - P.at > 15000) shoot({}); } });

STK.on('state', () => { renderAll(); pollKeystate(); pollMedia(); checkAlerts(); if (STK.sel() && P.serial !== STK.sel()) { P.serial = STK.sel(); resetFrame(); O.born = Date.now(); syncOrientation(); shoot({}); if ($('#preview-live').checked) loopPreview(); } if (!STK.sel() && P.serial) { resetFrame(); P.serial = ''; renderDeviceState(); } });
STK.on('live', onLive);
STK.on('info', () => { renderStage(); renderPicker(); syncOrientation(); });
STK.on('settings', () => { renderQuickline(); renderStage(); });
STK.on('profiles', () => { renderQuickline(); });
STK.on('offline', () => { renderStage(); });
STK.on('library', () => { renderStrip(); renderMeter(); });
STK.on('library-changed', () => STK.loadLibrary());
STK.on('device-changed', () => { Object.assign(K, { shade: false, quick: false, screenOn: null, vol: null, prevVol: null }); renderKeys(); pollKeystate(true); M.data = null; pollMedia(true); resetFrame(); P.serial = STK.sel(); O.born = Date.now(); syncOrientation(); renderAll(); shoot({}); if ($('#preview-live').checked) loopPreview(); });
STK.on('view', v => { if (v === 'console') { renderAll(); pollKeystate(true); STK.loadLibrary(); syncOrientation(); if ($('#preview-live').checked) loopPreview(); else if (P.hasImage && Date.now() - P.at > 15000) shoot({}); } else { stopLoop(); } });
STK.views.console = { onShow() { STK.loadLibrary(); } };
setInterval(tick, 1000);
applySize(); renderAll();
setTimeout(() => { if (STK.sel()) { P.serial = STK.sel(); shoot({}); } if ($('#preview-live').checked) loopPreview(); }, 700);
})();
