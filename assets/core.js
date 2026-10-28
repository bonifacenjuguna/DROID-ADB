/* DROID ADB 2.3 core: helpers, resilient API client, polling, dialogs, routing. */
(() => {
'use strict';
const STK = window.STK = { views: {}, state: {
  view: 'console', online: false, everOnline: false, failures: 0, data: null, eventSeq: null,
  devices: [], deviceMessage: '', devicesAge: 0, selected: '', info: {}, infoAt: {}, sessions: [], activity: [], disk: null,
  settings: null, schema: null, status: null, pollSeconds: 3, ignoreSessions: new Set()
} };
const state = STK.state;

/* ---------- helpers ---------- */
const $ = STK.$ = (s, r = document) => r.querySelector(s);
const $$ = STK.$$ = (s, r = document) => [...r.querySelectorAll(s)];
STK.esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const esc = STK.esc;
STK.icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
STK.bytes = n => {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
};
STK.when = v => { const d = new Date(v); return isNaN(d) ? 'Unknown date' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
STK.ago = v => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 1000));
  if (!isFinite(s)) return '';
  if (s < 10) return 'just now';
  if (s < 60) return s + ' s ago';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
};
STK.clock = v => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  const p = n => String(n).padStart(2, '0');
  return (h ? p(h) + ':' : '') + p(m) + ':' + p(x);
};
STK.dur = sec => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ' h ' : '') + (m || h ? m + ' min ' : '') + (h ? '' : s + ' s'); };
STK.debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = (...a) => { clearTimeout(t); fn(...a); }; return f; };
STK.sleep = ms => new Promise(r => setTimeout(r, ms));
STK.store = {
  get(k, d) { try { const v = localStorage.getItem('stk-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('stk-' + k, JSON.stringify(v)); } catch (e) {} }
};

/* ---------- events ---------- */
const bus = new EventTarget();
STK.on = (name, fn) => bus.addEventListener(name, e => fn(e.detail));
STK.emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

/* ---------- friendly errors and the raw error log ----------
   Raw technical text (adb, scrcpy, PowerShell) never goes straight to the screen. It is turned into a
   plain sentence for toasts and cards, and the original text is kept in Settings > Error log. */
const ERR_RULES = [
  [/unauthori[sz]ed/i, 'The phone has not allowed this computer yet. Unlock it and tap Allow on the USB debugging prompt.'],
  [/no devices\/emulators found|no devices found|device '[^']*' not found|device not found|no such device|could not find any adb device/i, 'No phone was found. Check the cable, unlock the phone and make sure USB debugging is on.'],
  [/more than one device|multiple devices/i, 'More than one phone is connected. Pick the one to use from the phone list at the top.'],
  [/device offline|error: closed|protocol fault|no permissions/i, 'The phone is connected but not answering. Unplug the cable and plug it back in, or use Restart ADB on the Devices page.'],
  [/cannot connect to daemon|failed to start daemon|server didn't ack|adb server|connection refused/i, 'ADB (the tool that talks to the phone) is not running properly. Use Restart ADB on the Devices page.'],
  [/INSTALL_FAILED_ALREADY_EXISTS|INSTALL_FAILED_UPDATE_INCOMPATIBLE/i, 'That app is already installed in a different version. Uninstall it first, then try again.'],
  [/INSTALL_FAILED_INSUFFICIENT_STORAGE|no space left|not enough space/i, 'The phone does not have enough free storage for this.'],
  [/INSTALL_FAILED_USER_RESTRICTED|INSTALL_FAILED_VERIFICATION|INSTALL_PARSE_FAILED|INSTALL_FAILED/i, 'The phone refused to install the app. Check that the file is a valid APK and that install over USB is allowed in the phone developer options.'],
  [/securityexception|permission denied|operation not permitted|not allowed to|requires android\.permission/i, 'The phone refused this action. Some phones need an extra developer option (such as USB debugging (Security settings)) before they allow it.'],
  [/no such file or directory|does not exist|cannot stat|remote object .* does not exist/i, 'That file or folder was not found on the phone or the PC.'],
  [/address already in use|port .* (busy|in use)|could not listen on port/i, 'The port is already used by another program. Change the backend port in Settings or close the other program.'],
  [/encoder|mediacodec|codec/i, 'The phone could not start video capture with these settings. Try a lower resolution or the H.264 codec in Settings.'],
  [/server connection failed|could not connect to the server|connection to the device server/i, 'scrcpy could not connect to the phone. Unlock it, check the cable, and try again.'],
  [/device disconnected|disconnected/i, 'The phone was disconnected.'],
  [/cannot reach the backend|failed to fetch|networkerror/i, 'The toolkit service is not answering right now. It restarts itself, so try again in a few seconds.'],
  [/timed? ?out|timeout/i, 'The phone took too long to answer. Make sure it is unlocked and try again.'],
  [/unexpected host|only accepts the local dashboard|missing request header/i, 'The request was blocked for safety. Open the dashboard from the address shown by Launch.bat.'],
  [/unreadable answer/i, 'The toolkit service sent something unexpected. Restart it from Devices, Restart backend.']
];
const RAW_LOOK = /exception|traceback|\bat [\w.$]+\(|system\.|unexpected backend error|0x[0-9a-f]{4,}|[a-z]:\\[^ ]+\.ps1|java\.|android\.os|errno|stack ?trace|\.ps1|invalidoperation|nullreference|cannot (bind|index|convert)|the term '/i;
STK.friendly = function (raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return 'Something went wrong. Please try again.';
  for (const [re, msg] of ERR_RULES) if (re.test(text)) return msg;
  if (RAW_LOOK.test(text) || text.length > 480) return 'Something did not work as expected. The technical details were saved in Settings, Error log.';
  return text;
};
const ERR_KEY = 'errlog';
STK.errlog = (() => { const v = STK.store.get(ERR_KEY, []); return Array.isArray(v) ? v.slice(-100) : []; })();
STK.logError = function (where, raw, extra) {
  const text = String(raw == null ? '' : raw).trim(); if (!text) return;
  const last = STK.errlog[STK.errlog.length - 1];
  if (last && last.raw === text && last.where === where && Date.now() - new Date(last.t).getTime() < 60000) { last.count = (last.count || 1) + 1; last.t = new Date().toISOString(); }
  else STK.errlog.push({ t: new Date().toISOString(), where: String(where || ''), raw: text.slice(0, 4000), friendly: STK.friendly(text), count: 1, ...(extra || {}) });
  if (STK.errlog.length > 100) STK.errlog.splice(0, STK.errlog.length - 100);
  STK.store.set(ERR_KEY, STK.errlog);
  STK.emit('errlog', STK.errlog.length);
};
STK.clearErrorLog = function () { STK.errlog.length = 0; STK.store.set(ERR_KEY, []); STK.emit('errlog', 0); };

/* ---------- API client ---------- */
STK.api = async function api(path, opts = {}) {
  const method = opts.method || 'GET';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout || 20000);
  const headers = {};
  let body;
  if (method === 'POST') {
    headers['X-STK'] = '1';
    if (opts.raw !== undefined) { headers['Content-Type'] = 'application/octet-stream'; body = opts.raw; }
    else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body || {}); }
  }
  let res;
  try { res = await fetch('/api' + path, { method, headers, body, signal: ctl.signal, cache: 'no-store', keepalive: !!opts.keepalive }); }
  catch (e) {
    clearTimeout(timer);
    const rawNet = e.name === 'AbortError' ? 'Request to ' + path + ' timed out.' : 'Cannot reach the backend (' + path + '): ' + (e.message || e.name);
    if (!path.startsWith('/state') && !path.startsWith('/ping')) STK.logError('/api' + path, rawNet, { network: true });
    const err = new Error(e.name === 'AbortError' ? 'The backend took too long to answer. If the phone is busy, try again.' : 'Cannot reach the backend right now.');
    err.network = true; err.raw = rawNet;
    throw err;
  }
  clearTimeout(timer);
  let data;
  try { data = await res.json(); } catch (e) { data = { error: 'The backend sent an unreadable answer.' }; }
  if (!res.ok) {
    const rawMsg = data.error || 'The request failed (HTTP ' + res.status + ').';
    if (!path.startsWith('/state')) STK.logError('/api' + path, rawMsg, { status: res.status });
    const err = new Error(STK.friendly(rawMsg)); err.status = res.status; err.raw = rawMsg; throw err;
  }
  return data;
};
STK.post = (path, body, opts = {}) => STK.api(path, { ...opts, method: 'POST', body });

/* Uploads with progress (fetch cannot report upload progress). */
STK.upload = (path, file, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api' + path);
  xhr.setRequestHeader('X-STK', '1');
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  xhr.timeout = 30 * 60 * 1000;
  xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
  xhr.onload = () => {
    let data = {};
    try { data = JSON.parse(xhr.responseText); } catch (e) {}
    if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new Error(data.error || 'The upload failed.'));
  };
  xhr.onerror = () => reject(new Error('Cannot reach the backend right now.'));
  xhr.ontimeout = () => reject(new Error('The upload took too long.'));
  xhr.send(file);
});

/* ---------- toasts and dialogs ---------- */
STK.toast = function toast(message, kind = 'ok', action) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = STK.icon(kind === 'bad' ? 'alert' : 'check') + `<p>${esc(message)}</p>` + (action ? `<button type="button">${esc(action.label)}</button>` : '');
  if (action) $('button', el).addEventListener('click', () => { action.run(); el.remove(); });
  $('#toasts').append(el);
  while ($('#toasts').children.length > 4) $('#toasts').firstElementChild.remove();
  setTimeout(() => el.remove(), kind === 'bad' ? 8000 : 4200);
};
STK.fail = e => {
  const raw = e && e.raw ? e.raw : (e && e.message ? e.message : String(e));
  if (!(e && e.raw)) STK.logError('app', raw);
  STK.toast(e && e.raw ? e.message : STK.friendly(raw), 'bad', STK.errlog.length ? { label: 'Details', run: () => { STK.go('settings'); setTimeout(() => { const el = document.getElementById('errlog-panel'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 150); } } : undefined);
};

STK.confirm = function confirmDialog(title, bodyHtml, okLabel = 'Delete', danger = true) {
  return new Promise(resolve => {
    const dlg = $('#dlg-confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-body').innerHTML = bodyHtml;
    const ok = $('#confirm-ok');
    ok.textContent = okLabel;
    ok.className = 'btn ' + (danger ? 'danger' : 'primary');
    const done = () => { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'ok'); };
    dlg.returnValue = 'cancel';
    dlg.addEventListener('close', done);
    dlg.showModal();
  });
};
/* Ask only when the user wants confirmations (Settings, Ask before deleting). */
STK.confirmDelete = async function (title, bodyHtml, okLabel) {
  if (state.settings && state.settings.confirmDeletes === false) return true;
  return STK.confirm(title, bodyHtml, okLabel);
};
STK.prompt = function promptDialog(title, label, value = '', okLabel = 'Save') {
  return new Promise(resolve => {
    const dlg = $('#dlg-prompt');
    $('#prompt-title').textContent = title;
    $('#prompt-label').textContent = label;
    const input = $('#prompt-input');
    input.value = value;
    $('#prompt-ok').textContent = okLabel;
    const done = () => { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'ok' ? input.value.trim() : null); };
    dlg.returnValue = 'cancel';
    dlg.addEventListener('close', done);
    dlg.showModal();
    input.focus(); input.select();
  });
};
STK.showText = function (title, text) {
  $('#text-title').textContent = title;
  $('#text-body').textContent = text || '(empty)';
  $('#dlg-text').showModal();
};

/* Busy and flash feedback so every click visibly does something. */
STK.busy = async function (btn, fn) {
  if (btn && btn.classList.contains('is-busy')) return;
  if (btn) { btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); }
  finally { if (btn) { btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); } }
};
STK.flash = function (el, ok = true) {
  if (!el) return;
  el.classList.remove('flash-ok', 'flash-bad');
  void el.offsetWidth;
  el.classList.add(ok ? 'flash-ok' : 'flash-bad');
  setTimeout(() => el.classList.remove('flash-ok', 'flash-bad'), 800);
};

/* Small popup menu next to a button. items: [{label, icon, run, danger}] or '-' */
STK.menu = function (anchor, items) {
  $$('.popmenu').forEach(m => m.remove());
  const m = document.createElement('div');
  m.className = 'popmenu';
  m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button type="button" data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? STK.icon(it.icon, 'sm') : ''}<span>${esc(it.label)}</span></button>`).join('');
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
  m.style.top = (r.bottom + h + 12 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  const close = () => { m.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esck, true); };
  const outside = e => { if (!m.contains(e.target)) close(); };
  const esck = e => { if (e.key === 'Escape') close(); };
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', esck, true); }, 0);
  m.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; close(); items[Number(b.dataset.i)].run(); });
};

/* ---------- navigation ---------- */
const TITLES = { console: 'Console', studio: 'Performance Studio', automation: 'Automation', phone: 'Phone tools', monitor: 'Monitor', notifications: 'Notifications', library: 'Library', device: 'Devices', settings: 'Settings' };
STK.go = function go(name) {
  if (!TITLES[name]) name = 'console';
  state.view = name;
  $$('.view').forEach(v => v.hidden = v.id !== 'view-' + name);
  $$('.rail-btn').forEach(b => { const on = b.dataset.view === name; b.classList.toggle('is-active', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  $('#page-title').textContent = TITLES[name];
  try { history.replaceState(null, '', '#' + name); } catch (e) {}
  const v = STK.views[name];
  if (v && v.onShow) v.onShow();
  STK.emit('view', name);
  window.scrollTo(0, 0);
};

/* ---------- device selection ---------- */
STK.readyDevices = () => state.devices.filter(d => d.state === 'device');
STK.current = () => { const r = STK.readyDevices(); return r.find(d => d.id === state.selected) || r[0] || null; };
STK.sel = () => { const d = STK.current(); return d ? d.id : ''; };
STK.info = () => { const d = STK.current(); return d ? state.info[d.id] : null; };
STK.sessionFor = serial => state.sessions.filter(s => !serial || !s.serial || s.serial === serial);
STK.recording = () => STK.sessionFor(STK.sel()).find(s => s.recording);
STK.viewer = () => STK.sessionFor(STK.sel()).find(s => !s.headless);
STK.mirroring = () => { const v = STK.viewer(); return v && !v.recording ? v : undefined; };
STK.live = () => { const id = STK.sel(); return id && state.live ? state.live[id] || null : null; };

let infoLoading = false;
STK.loadInfo = async function (id, fresh) {
  if (!id || infoLoading) return;
  infoLoading = true;
  try {
    const r = await STK.api('/device-info?id=' + encodeURIComponent(id) + (fresh ? '&fresh=1' : ''), { timeout: 30000 });
    state.info[id] = r.info; state.infoAt[id] = Date.now();
  } catch (e) { state.infoAt[id] = Date.now() - 20000; if (!state.info[id]) state.info[id] = { id, error: e.message }; }
  finally { infoLoading = false; }
  STK.emit('info', id);
};

/* ---------- settings and schema ---------- */
STK.loadSettings = async function () {
  const r = await STK.api('/settings');
  state.settings = r.settings;
  state.pollSeconds = r.settings.pollSeconds;
  STK.applyTheme(r.settings.theme);
  STK.emit('settings', r.settings);
  return r.settings;
};
STK.loadSchema = async function () { if (!state.schema) state.schema = await STK.api('/schema'); return state.schema; };
STK.applyTheme = function (t) {
  STK.store.set('theme-setting', t);
  try { localStorage.setItem('stk-theme', t); } catch (e) {}
  let eff = t;
  if (t === 'auto') eff = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = eff;
};

/* ---------- connection and polling ---------- */
function setConn() {
  const chip = $('#conn-chip'), dot = $('#rail-dot');
  let cls = 'chip', label = 'Connecting', dcls = 'dot';
  if (state.online) { cls = 'chip ok'; label = 'Backend online'; dcls = 'dot ok'; }
  else if (state.failures > 0 && state.failures < 3 && state.everOnline) { cls = 'chip warn'; label = 'Slow to answer'; dcls = 'dot warn'; }
  else if (state.failures >= 3) { cls = 'chip bad'; label = 'Backend not answering'; dcls = 'dot bad'; }
  chip.className = cls; chip.innerHTML = `<i class="dot"></i><b>${label}</b>`;
  dot.className = dcls;
}
STK.FRONT_VERSION = '4.2.2';
{ const av = document.getElementById('about-version'); if (av) av.textContent = 'v' + STK.FRONT_VERSION; }
const stale = () => !!(state.online && state.data && state.data.version && state.data.version !== STK.FRONT_VERSION);
function setBanner() {
  const b = $('#banner');
  let html = '', cls = 'banner';
  if (stale()) {
    cls += ' stale';
    html = `${STK.icon('alert')}<p><b>The background service is still the old version (${String(state.data.version)}).</b> The page is new (${STK.FRONT_VERSION}) but the fixes run inside the service. Restart it once to load them. Running mirror windows keep going.</p><button class="btn sm primary" id="banner-stale" type="button">Restart service now</button>`;
  } else if (!state.online && state.failures >= 3) {
    cls += ' bad';
    html = `${STK.icon('alert')}<p><b>The backend is not answering.</b> It restarts itself automatically, so this usually clears in a few seconds. Your controls stay as they were and the page keeps retrying. If it stays like this, run <b>Launch.bat</b> again.</p><button class="btn sm" id="banner-retry" type="button">Retry now</button>`;
  } else if (state.online && state.devicesAge > 30 && state.devices.length) {
    html = `${STK.icon('alert')}<p><b>ADB has not answered for ${state.devicesAge} seconds.</b> The device list may be out of date.</p><button class="btn sm" id="banner-adb" type="button">Restart ADB</button>`;
  } else if (state.online && state.status && state.status.restartRequired) {
    html = `${STK.icon('info')}<p><b>Restart needed.</b> A setting you changed (port or workers) applies after the backend restarts.</p><button class="btn sm" id="banner-restart" type="button">Restart backend</button>`;
  }
  b.className = cls;
  b.hidden = !html;
  if (b.innerHTML !== html) b.innerHTML = html;
}
STK.refreshBanner = setBanner;
document.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'banner-retry') { pollNow(); }
  if (t.id === 'banner-adb') STK.busy(t, async () => { try { await STK.post('/wifi', { action: 'restart' }, { timeout: 40000 }); STK.toast('ADB was restarted.'); pollNow(); } catch (er) { STK.fail(er); } });
  if (t.id === 'banner-restart') STK.restartBackend(t);
  if (t.id === 'banner-stale') STK.restartService(t, { stale: true });
});

/* Restarts the background service and waits until the new one answers. Safe to click more than once. */
let restarting = false;
STK.restartService = async function (btn, opts = {}) {
  if (restarting) { STK.toast('The service is already restarting. Please wait a moment.'); return; }
  restarting = true;
  const label = btn && btn.querySelector('span') ? btn.querySelector('span') : btn;
  const oldText = label ? label.textContent : '';
  if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
  if (label) label.textContent = 'Restarting...';
  STK.toast(opts.stale ? 'Restarting the service...' : 'Restarting the backend...');
  let accepted = false;
  try {
    // The service may close the connection before it finishes answering. That still counts as accepted.
    try { await STK.post('/backend', { action: 'restart' }, { timeout: 8000 }); accepted = true; }
    catch (e) { if (!e.network) { STK.fail(e); return; } accepted = true; }
    state.failures = 0;
    const began = Date.now();
    let came = false;
    await STK.sleep(1200);
    while (Date.now() - began < 60000) {
      try {
        const r = await fetch('/api/ping', { cache: 'no-store' });
        if (r.ok) { const j = await r.json(); if (j && j.ok && (!j.uptime || j.uptime < 120 || Date.now() - began > 15000)) { came = true; break; } }
      } catch (e) { /* still down */ }
      await STK.sleep(700);
    }
    if (came) { STK.toast('The service is back.'); state.failures = 0; pollNow(); }
    else STK.toast('The service did not come back in 60 seconds. Run Launch.bat again. Details are in Logs\\backend-error.log.', 'bad');
  } finally {
    restarting = false;
    if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
    if (label) label.textContent = oldText;
  }
};
STK.restartBackend = async function (btn) {
  if (!await STK.confirm('Restart the backend?', '<p>The dashboard disconnects for a few seconds. Running scrcpy windows keep going.</p>', 'Restart', false)) return;
  return STK.restartService(btn);
};

function handleEvents(d) {
  if (state.eventSeq === null) { state.eventSeq = d.eventSeq; return; }
  for (const ev of d.events || []) {
    if (state.ignoreSessions.has(ev.session)) continue;
    if (ev.kind === 'failed') {
      if (ev.reason) STK.logError('scrcpy', ev.reason, { mode: ev.mode });
      const fr = ev.reason ? STK.friendly(ev.reason) : 'Check the cable and unlock the phone.';
      STK.toast('The mirror window closed right away. ' + fr, 'bad', ev.reason ? { label: 'Details', run: () => { STK.go('settings'); setTimeout(() => { const el = document.getElementById('errlog-panel'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 150); } } : undefined);
    }
    else if (ev.kind === 'audio') STK.emit('audio-problem', ev);
    else if (ev.kind === 'job') STK.emit('job-event', ev);
    else if (ev.kind === 'ended') {
      if (ev.mode === 'record' && ev.file) STK.notify && STK.notify('Recording saved', ev.file + ' (' + STK.bytes(ev.size) + ')', 'rec');
      if (ev.mode === 'record' && ev.file) STK.toast('Recording saved: ' + ev.file + ' (' + STK.bytes(ev.size) + ', ' + STK.dur(ev.seconds) + ')', 'ok', { label: 'Library', run: () => STK.go('library') });
      else STK.toast('Mirror window closed.');
      if (ev.mode === 'record' && ev.file && ev.audioExpected && STK.audioAfterRecording) STK.audioAfterRecording(ev);
      STK.emit('library-changed');
    }
  }
  state.eventSeq = d.eventSeq;
}

function applyState(d) {
  state.data = d;
  state.sessions = d.sessions || [];
  let devs = (d.devices || []).filter(Boolean);
  if (devs.some(x => x.state === 'device')) state.lastGoodAt = Date.now();
  else if (state.devices.some(x => x.state === 'device') && Date.now() - (state.lastGoodAt || 0) < 6000) devs = state.devices; // brief dip: keep the last list
  state.devices = devs;
  state.deviceMessage = d.deviceMessage || '';
  state.devicesAge = d.devicesAge;
  state.activity = d.activity || [];
  state.disk = d.disk;
  const prevLive = state.live; state.live = d.live || {};
  state.pollSeconds = d.pollSeconds || state.pollSeconds;
  const ready = STK.readyDevices();
  const saved = STK.store.get('device', '');
  const wasSelected = state.selected;
  if (!ready.find(x => x.id === state.selected)) state.selected = (ready.find(x => x.id === saved) || ready[0] || {}).id || '';
  // The phone in use changed on its own (unplugged, or another one took over): clear what each page kept for the old one.
  if (wasSelected && state.selected !== wasSelected) STK.emit('device-changed');
  $('#rail-version').textContent = 'v' + String(d.version).split('.').slice(0, 2).join('.');
  if (stale()) {
    setBanner();
    let tried = false; try { tried = sessionStorage.getItem('stk-autorestart') === String(d.version); } catch (e) { tried = true; }
    if (!tried && !(d.sessions || []).length) {
      try { sessionStorage.setItem('stk-autorestart', String(d.version)); } catch (e) { /* ignore */ }
      STK.restartService(null, { stale: true });
    }
  } else if ($('#banner') && $('#banner').classList.contains('stale')) setBanner();
  handleEvents(d);
  const cur = STK.current();
  if (cur && (!state.infoAt[cur.id] || Date.now() - state.infoAt[cur.id] > 45000)) STK.loadInfo(cur.id);
  STK.emit('state', d);
  const L = STK.live(), P0 = prevLive && prevLive[STK.sel()];
  if (L && (!P0 || P0.at !== L.at)) STK.emit('live', { L, prev: P0 || null });
}

let pollTimer = null, polling = false;
async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    const d = await STK.api('/state?since=' + (state.eventSeq || 0) + (document.hidden ? '&hidden=1' : ''), { timeout: 8000 });
    const was = state.online;
    state.failures = 0; state.online = true;
    if (!was && state.everOnline) STK.toast('Reconnected to the backend.');
    state.everOnline = true;
    setConn();
    applyState(d);
    setBanner();
  } catch (e) {
    state.failures++;
    if (state.failures >= 3) state.online = false;
    setConn(); setBanner();
    STK.emit('offline', state.failures);
  } finally {
    polling = false;
    clearTimeout(pollTimer);
    let delay = Math.max(1, state.pollSeconds) * 1000;
    if (state.sessions.length) delay = Math.min(delay, 2000);
    if (state.failures) delay = Math.min(10000, 1500 * state.failures);
    if (document.hidden) delay = Math.max(delay, 8000);
    pollTimer = setTimeout(pollOnce, delay);
  }
}
function pollNow() { clearTimeout(pollTimer); pollOnce(); }
STK.pollNow = pollNow;
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollNow(); });

STK.refreshStatus = async function () {
  try { state.status = await STK.api('/status'); STK.emit('status', state.status); setBanner(); } catch (e) {}
};

STK.start = async function () {
  try { await STK.loadSettings(); } catch (e) {}
  STK.loadSchema().catch(() => {});
  await pollOnce();
  STK.refreshStatus();
  setInterval(STK.refreshStatus, 30000);
};
})();
