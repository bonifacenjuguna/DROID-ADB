/* Scrcpy Toolkit 2.0 dashboard. Talks only to the local backend on 127.0.0.1. */
(() => {
'use strict';
const API = location.protocol === 'http:' ? '/api' : 'http://127.0.0.1:47821/api';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  view: 'console', online: false, healthFailures: 0, polling: false, version: '', status: null,
  devices: [], selected: '', info: {}, sessions: [], sessionRequest: 0, recs: [], shots: [], disk: null,
  activity: [], settings: null, tab: 'recordings', filter: '', sort: 'new',
  previewMode: 'mirror', busy: false, pendingKey: '', fileTarget: null
};

/* ---------- helpers ---------- */
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const bytes = n => {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
};
const when = v => { const d = new Date(v); return isNaN(d) ? 'Unknown date' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
const ago = v => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 1000));
  if (!isFinite(s)) return '';
  if (s < 10) return 'just now';
  if (s < 60) return s + ' s ago';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
};
const clock = v => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  const p = n => String(n).padStart(2, '0');
  return (h ? p(h) + ':' : '') + p(m) + ':' + p(x);
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  } catch (e) { throw new Error('The local backend is not reachable. Run Launch.bat and reload.'); }
  const data = await res.json().catch(() => ({ error: 'The backend sent an unreadable answer.' }));
  if (!res.ok) throw new Error(data.error || 'The request failed.');
  return data;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });

function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = icon(kind === 'bad' ? 'alert' : 'check') + `<p>${esc(message)}</p>`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 3600);
}

function confirmDialog(title, bodyHtml, okLabel = 'Delete') {
  return new Promise(resolve => {
    const dlg = $('#dlg-confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-body').innerHTML = bodyHtml;
    $('#confirm-ok').textContent = okLabel;
    const done = () => { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'ok'); };
    dlg.returnValue = 'cancel';
    dlg.addEventListener('close', done);
    dlg.showModal();
  });
}

/* ---------- navigation ---------- */
const TITLES = { console: 'Console', library: 'Library', device: 'Devices', settings: 'Settings' };
function go(name) {
  if (!TITLES[name]) name = 'console';
  state.view = name;
  $$('.view').forEach(v => v.hidden = v.id !== 'view-' + name);
  $$('.rail-btn').forEach(b => { const on = b.dataset.view === name; b.classList.toggle('is-active', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  $('#page-title').textContent = TITLES[name];
  try { history.replaceState(null, '', '#' + name); } catch (e) {}
  if (name === 'library') loadLibrary();
  if (name === 'device') { loadDevices(); renderSys(); }
  if (name === 'settings') loadSettings();
  window.scrollTo(0, 0);
}

/* ---------- device state ---------- */
const readyDevices = () => state.devices.filter(d => d.state === 'device');
const current = () => readyDevices().find(d => d.id === state.selected) || readyDevices()[0] || null;
const currentInfo = () => { const d = current(); return d ? state.info[d.id] : null; };
const sel = () => { const d = current(); return d ? d.id : ''; };
const activeSessions = () => state.sessions.length;
const recording = () => state.sessions.find(s => s.recording);

async function loadStatus() {
  try {
    const s = await api('/status', { signal: AbortSignal.timeout(10000) });
    state.healthFailures = 0;
    state.online = true; state.status = s; state.version = s.version;
    $('#conn-chip').className = 'chip ok';
    $('#conn-chip').innerHTML = '<i class="dot"></i><b>Backend online</b>';
    $('#conn-chip').title = 'Local backend responded successfully.';
    $('#rail-dot').className = 'dot ok';
    $('#rail-version').textContent = 'v' + String(s.version).split('.').slice(0, 2).join('.');
    state.disk = s.disk;
  } catch (e) {
    // A failed health endpoint alone does not prove the backend is offline.
    // Probe a second lightweight endpoint before changing the global status.
    try {
      await api('/session', { signal: AbortSignal.timeout(5000) });
      state.online = true;
      state.healthFailures = 0;
      $('#conn-chip').className = 'chip warn';
      $('#conn-chip').innerHTML = '<i class="dot"></i><b>Backend online · retrying status</b>';
      $('#conn-chip').title = 'The health check failed, but the session API responded. Retrying the health check.';
      $('#rail-dot').className = 'dot ok';
      return true;
    } catch (probeError) {}
    state.healthFailures = (state.healthFailures || 0) + 1;
    if (state.online && state.healthFailures < 3) {
      $('#conn-chip').className = 'chip warn';
      $('#conn-chip').innerHTML = '<i class="dot"></i><b>Backend slow · retrying</b>';
      $('#conn-chip').title = 'A health check failed. Existing controls remain available while the dashboard retries.';
    } else if (state.healthFailures >= 3) {
      state.online = false;
      $('#conn-chip').className = 'chip bad';
      $('#conn-chip').innerHTML = '<i class="dot"></i><b>Backend unreachable</b>';
      $('#conn-chip').title = 'Three consecutive health checks failed. Check Launch.bat and the local API.';
      $('#rail-dot').className = 'dot bad';
      renderStageActions();
    } else {
      $('#conn-chip').className = 'chip warn';
      $('#conn-chip').innerHTML = '<i class="dot"></i><b>Connecting · retrying</b>';
    }
  }
  return state.online;
}

async function loadDevices(force) {
  if (!state.online) return;
  try {
    const d = await api('/devices');
    state.devices = d.devices || [];
    state.deviceMessage = d.message || '';
    const ready = readyDevices();
    if (!ready.find(x => x.id === state.selected)) state.selected = ready[0] ? ready[0].id : '';
    const dev = current();
    if (dev && (force || !state.info[dev.id] || Date.now() - (state.info[dev.id]._at || 0) > 30000)) await loadInfo(dev.id);
  } catch (e) { state.devices = []; state.deviceMessage = e.message; }
  renderDevices(); renderStage(); renderPicker();
}
async function loadInfo(id) {
  try { const r = await api('/device-info?id=' + encodeURIComponent(id)); r.info._at = Date.now(); state.info[id] = r.info; }
  catch (e) { state.info[id] = { id, _at: Date.now(), error: e.message }; }
}
async function loadSessions() {
  if (!state.online) return;
  const request = ++state.sessionRequest;
  try {
    const result = await api('/session', { signal: AbortSignal.timeout(10000) });
    // Ignore older responses: a slow poll must never overwrite a newer session state.
    if (request !== state.sessionRequest) return;
    state.sessions = Array.isArray(result.sessions) ? result.sessions : [];
    renderSessions();
    renderStageActions();
  } catch (e) {
    // A failed session poll is not proof that the backend or session stopped.
    // Keep the last confirmed state until a successful poll reconciles it.
    if (request === state.sessionRequest) {
      const chip = $('#session-chip');
      if (chip) {
        chip.className = 'chip sm warn';
        chip.title = 'Session status could not be refreshed; retrying.';
      }
    }
  }
}
async function loadActivity() {
  if (!state.online) return;
  try { state.activity = (await api('/activity')).items || []; } catch (e) {}
  renderFeed();
}
async function loadLibrary() {
  if (!state.online) return;
  try {
    const [r, s] = await Promise.all([api('/recordings'), api('/screenshots')]);
    state.recs = r.files || []; state.shots = s.files || []; state.disk = r.disk || state.disk;
    state.totals = { recs: r.totalSize || 0, shots: s.totalSize || 0 };
  } catch (e) { toast(e.message, 'bad'); }
  renderLibrary(); renderStrip(); renderMeter();
}

/* ---------- phone illustration ---------- */
function phoneSvg() {
  const info = currentInfo(), dev = current(), rec = recording();
  const W = 200, H = 400, sx = 16, sy = 16, sw = 168, sh = 368;
  let inner = '';
  if (!dev) {
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="No phone connected"><rect class="ph-dash" x="6" y="6" width="188" height="388" rx="30"/>
      <g transform="translate(76 150) scale(2.2)" class="ph-ic"><path d="M9 3v5M15 3v5M6 8h12v3.5a6 6 0 01-12 0zM12 17.5V21"/></g>
      <text class="ph-sub" x="100" y="260" text-anchor="middle">No phone connected</text></svg>`;
  }
  const level = info && info.battery >= 0 ? info.battery : null;
  const fillH = level === null ? 0 : Math.round(sh * level / 100);
  const low = level !== null && level <= 15 && !info.charging;
  inner += `<defs><clipPath id="scr"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="22"/></clipPath></defs>`;
  inner += `<rect class="ph-body" x="6" y="6" width="188" height="388" rx="30"/><rect class="ph-screen" x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="22"/>`;
  if (level !== null) {
    inner += `<g clip-path="url(#scr)"><rect class="${low ? 'ph-low' : 'ph-fill'}" x="${sx}" y="${sy + sh - fillH}" width="${sw}" height="${fillH}"/><line class="ph-edge" x1="${sx}" x2="${sx + sw}" y1="${sy + sh - fillH}" y2="${sy + sh - fillH}" ${low ? 'style="stroke:var(--bad)"' : ''}/></g>`;
    inner += `<text class="ph-num" x="100" y="206" text-anchor="middle">${level}<tspan font-size="24" dx="2">%</tspan></text>`;
    inner += `<text class="ph-sub" x="100" y="232" text-anchor="middle">${info.charging ? 'Charging' : (low ? 'Battery low' : 'Battery')}</text>`;
  } else {
    inner += `<text class="ph-sub" x="100" y="206" text-anchor="middle">${info && info.error ? 'Reading phone' : 'Reading phone…'}</text>`;
  }
  inner += `<rect x="78" y="26" width="44" height="12" rx="6" fill="var(--panel-2)"/>`;
  if (rec) inner += `<circle class="ph-rec" cx="36" cy="34" r="6"/><text class="ph-sub" x="48" y="38">REC</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${level === null ? 'Phone' : 'Phone battery ' + level + ' percent'}">${inner}</svg>`;
}

/* ---------- renderers: console ---------- */
function renderStage() {
  $('#phone').innerHTML = phoneSvg();
  const dev = current(), info = currentInfo(), idEl = $('#stage-id'), specs = $('#stage-specs');
  const needs = state.devices.find(d => d.state !== 'device');
  if (!state.online) {
    idEl.innerHTML = `<h2>Backend offline</h2><p>The dashboard cannot reach the local backend. Run <b>Launch.bat</b>, then reload this page.</p>`;
    specs.innerHTML = '';
  } else if (!dev) {
    const why = needs ? (needs.state === 'unauthorized' ? 'The phone is waiting for you to accept the USB debugging prompt.' : 'The phone shows as offline. Reconnect the cable or restart ADB.') : (state.deviceMessage || 'Connect a phone with USB debugging turned on.');
    idEl.innerHTML = `<h2>No phone connected</h2><p>${esc(why)}</p><div class="chips"><button class="btn sm" data-view="device">${icon('phone', 'sm')}Open device help</button></div>`;
    specs.innerHTML = '';
  } else {
    const name = info && info.model ? [info.manufacturer, info.model].filter(Boolean).join(' ') : dev.id;
    const wifi = dev.transport === 'wifi';
    idEl.innerHTML = `<h2>${esc(name)}</h2><p>${info && info.android ? 'Android ' + esc(info.android) + (info.sdk ? ' (API ' + esc(info.sdk) + ')' : '') : 'Reading device details'}</p>
      <div class="chips"><span class="chip sm ok"><i class="dot"></i><b>Ready</b></span><span class="chip sm">${icon(wifi ? 'wifi' : 'usb', 'sm')}<b>${wifi ? 'Wi-Fi' : 'USB'}</b></span>${info && info.charging ? `<span class="chip sm">${icon('bolt', 'sm')}<b>Charging</b></span>` : ''}</div>`;
    const rows = [];
    if (info && info.width) rows.push(['Screen', `${info.width} × ${info.height}`]);
    if (info && info.density) rows.push(['Density', info.density + ' dpi']);
    if (info && info.storageTotal) rows.push(['Free storage', `${bytes(info.storageFree)} of ${bytes(info.storageTotal)}`]);
    if (info && info.tempC != null) rows.push(['Battery temperature', info.tempC + ' °C']);
    rows.push(['Device ID', dev.id]);
    specs.innerHTML = rows.map(r => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd></div>`).join('');
  }
  renderStageActions();
}
function renderStageActions() {
  const dev = current(), rec = recording(), n = activeSessions();
  const mirror = state.sessions.find(s => !s.recording);
  const box = $('#stage-actions');
  box.classList.toggle('has-sessions', n > 0);
  $('[data-act]', box).forEach(b => { const pending = state.busy && b.dataset.act === state.pendingAction; b.disabled = state.busy || (['mirror', 'screenshot'].includes(b.dataset.act) && !dev); b.classList.toggle('is-pending', pending); b.setAttribute('aria-busy', String(!!pending)); });
  const mb = $('[data-act="mirror"]', box);
  mb.disabled = state.busy || (!dev && !mirror) || !!rec;
  mb.classList.toggle('live', !!mirror);
  mb.setAttribute('aria-pressed', String(!!mirror));
  mb.innerHTML = mirror ? `${icon('stop')}<span>Stop mirroring</span>` : rec ? `${icon('mirror')}<span>Recording active</span>` : `${icon('mirror')}<span>Mirror</span>`;
  const rb = $('#rec-btn');
  rb.disabled = (!dev && !rec) || state.busy;
  rb.classList.toggle('is-pending', state.busy && ['record','stop-recording'].includes(state.pendingAction));
  rb.setAttribute('aria-busy', String(!!(state.busy && ['record','stop-recording'].includes(state.pendingAction))));
  rb.classList.toggle('live', !!rec);
  rb.dataset.act = rec ? 'stop-recording' : 'record';
  rb.innerHTML = rec ? `${icon('stop')}<span>Stop recording <time id="rec-clock">${clock(rec.started)}</time></span>` : `${icon('record')}<span>Record</span>`;
  $('#keys .key').forEach(b => {
    const pending = state.pendingKey === b.dataset.key;
    b.disabled = !dev || state.busy || !!state.pendingKey;
    b.classList.toggle('is-pending', pending);
    b.setAttribute('aria-busy', String(pending));
  });
  const textPending = state.pendingKey === 'text';
  $('#text-send').disabled = !dev || state.busy || !!state.pendingKey;
  $('#text-send').classList.toggle('is-pending', textPending);
  $('#text-send').setAttribute('aria-busy', String(textPending));
  $('#text-input').disabled = !dev || state.busy || !!state.pendingKey;
}
function renderSessions() {
  const box = $('#sessions'), list = state.sessions;
  const chip = $('#session-chip');
  chip.className = 'chip sm' + (list.some(s => s.recording) ? ' rec' : list.length ? ' ok' : '');
  chip.innerHTML = `<i class="dot"></i><b>${list.length ? list.length + ' open' : 'None'}</b>`;
  if (!list.length) {
    box.innerHTML = `<div class="empty">${icon('mirror')}<b>No windows open</b><p>Mirror or record to see a live timer here.</p></div>`;
    return;
  }
  box.innerHTML = list.map(s => `<div class="sess ${s.recording ? 'rec' : ''}"><span class="badge">${icon(s.recording ? 'record' : 'mirror')}</span>
    <div><b>${s.recording ? 'Recording' : 'Mirroring'}</b><div class="timer" data-since="${esc(s.started)}">${s.started ? clock(s.started) : '--:--'}</div>
    <small>${s.recording && s.file ? esc(s.file) + ' · ' + bytes(s.fileSize) : 'Process ' + esc(s.pid)}</small></div></div>`).join('');
}
const FEED_ICON = { record: 'record', mirror: 'mirror', stop: 'stop', screenshot: 'camera', wifi: 'wifi', delete: 'trash', system: 'pulse' };
function renderFeed() {
  const list = $('#feed');
  if (!state.activity.length) { list.innerHTML = '<li class="none hint">Actions you run will appear here.</li>'; return; }
  list.innerHTML = state.activity.slice(0, 14).map(a => `<li>${icon(FEED_ICON[a.kind] || 'pulse')}<div><p>${esc(a.text)}</p><time>${esc(ago(a.t))}</time></div></li>`).join('');
}
function renderStrip() {
  const items = [...state.shots.map(f => ({ ...f, kind: 'shot' })), ...state.recs.map(f => ({ ...f, kind: 'rec' }))]
    .sort((a, b) => new Date(b.modified) - new Date(a.modified)).slice(0, 8);
  const strip = $('#strip');
  if (!items.length) { strip.innerHTML = `<div class="empty">${icon('image')}<b>Nothing captured yet</b><p>Screenshots and recordings you take show up here.</p></div>`; return; }
  strip.innerHTML = items.map(f => f.kind === 'shot'
    ? `<button class="tile" data-shot="${esc(f.name)}" title="${esc(f.name)}"><img loading="lazy" src="${API}/file?name=${encodeURIComponent(f.name)}" alt="Screenshot ${esc(f.name)}"><span class="cap">${esc(ago(f.modified))}</span></button>`
    : `<button class="tile vid" data-rec="${esc(f.name)}" title="Open ${esc(f.name)}">${icon('play')}<span class="cap"><b>${esc(f.name.replace(/\.\w+$/, ''))}</b>${bytes(f.size)} · ${esc(ago(f.modified))}</span></button>`).join('');
}
function renderMeter() {
  const d = state.disk, t = state.totals || { recs: 0, shots: 0 };
  const media = t.recs + t.shots;
  if (!d || !d.total) { $('#meter-text').textContent = `${bytes(media)} in your library.`; return; }
  const used = d.total - d.free;
  const meter = $('#meter');
  meter.innerHTML = `<i class="m-media" style="width:${Math.max(0.6, media / d.total * 100).toFixed(2)}%"></i><i class="m-other" style="width:${Math.max(0, (used - media) / d.total * 100).toFixed(2)}%"></i>`;
  $('#meter-text').textContent = `${bytes(media)} of captures · ${bytes(d.free)} free on this PC`;
}
function renderPicker() {
  const ready = readyDevices(), wrap = $('#device-pick'), s = $('#device-select');
  wrap.hidden = ready.length < 2;
  s.innerHTML = ready.map(d => { const i = state.info[d.id]; return `<option value="${esc(d.id)}">${esc(i && i.model ? i.model : d.id)}</option>`; }).join('');
  s.value = sel();
}

/* ---------- renderers: devices ---------- */
function renderDevices() {
  const box = $('#device-list');
  if (!state.devices.length) {
    box.innerHTML = `<div class="empty">${icon('plug')}<b>No device detected</b><p>${esc(state.deviceMessage || 'Connect your phone with USB debugging turned on.')}</p></div>`;
    return;
  }
  box.innerHTML = state.devices.map(d => {
    const i = state.info[d.id], ok = d.state === 'device';
    const dot = ok ? 'ok' : d.state === 'unauthorized' ? 'warn' : 'bad';
    return `<div class="dev ${d.id === sel() ? 'active' : ''}"><span class="badge">${icon(d.transport === 'wifi' ? 'wifi' : 'phone')}</span>
      <div><b>${esc(i && i.model ? i.model : d.id)}</b><small>${esc(d.id)}${d.details ? ' · ' + esc(d.details) : ''}</small></div>
      <span class="chip sm"><i class="dot ${dot}"></i><b>${esc(d.state)}</b></span></div>`;
  }).join('');
}
function renderSys() {
  const s = state.status;
  if (!s) { $('#sys-specs').innerHTML = ''; return; }
  const h = Math.floor(s.uptime / 3600), m = Math.floor(s.uptime % 3600 / 60);
  const rows = [['Toolkit version', s.version], ['Backend', 'Listening on 127.0.0.1:' + s.port], ['Backend uptime', (h ? h + ' h ' : '') + m + ' min'], ['scrcpy', s.scrcpy ? 'Found' : 'Missing'], ['ADB', s.adb ? 'Found' : 'Missing'], ['Folder', s.root]];
  $('#sys-specs').innerHTML = rows.map(r => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd></div>`).join('');
}

/* ---------- renderers: library ---------- */
function renderLibrary() {
  $('#tab-rec-count').textContent = state.recs.length;
  $('#tab-shot-count').textContent = state.shots.length;
  const badge = $('#rail-count'), total = state.recs.length + state.shots.length;
  badge.hidden = !total; badge.textContent = total > 99 ? '99+' : total;
  const isRec = state.tab === 'recordings';
  let files = (isRec ? state.recs : state.shots).filter(f => f.name.toLowerCase().includes(state.filter.toLowerCase()));
  const sorters = { new: (a, b) => new Date(b.modified) - new Date(a.modified), old: (a, b) => new Date(a.modified) - new Date(b.modified), big: (a, b) => b.size - a.size, name: (a, b) => a.name.localeCompare(b.name) };
  files = files.sort(sorters[state.sort]);
  const t = state.totals || { recs: 0, shots: 0 }, d = state.disk;
  const mine = isRec ? t.recs : t.shots, count = (isRec ? state.recs : state.shots).length;
  const media = t.recs + t.shots;
  $('#lib-summary').innerHTML = `<div><div class="v">${count}</div><div class="l">${isRec ? 'Recordings' : 'Screenshots'}</div></div><div><div class="v">${bytes(mine)}</div><div class="l">Used by ${isRec ? 'recordings' : 'screenshots'}</div></div><div><div class="v">${d && d.total ? bytes(d.free) : '—'}</div><div class="l">Free on this PC</div></div>
    ${d && d.total ? `<div class="meter"><i class="m-media" style="width:${Math.max(0.6, media / d.total * 100).toFixed(2)}%"></i><i class="m-other" style="width:${Math.max(0, (d.total - d.free - media) / d.total * 100).toFixed(2)}%"></i></div>` : ''}`;
  const list = $('#lib-list');
  if (!files.length) {
    list.innerHTML = `<div class="empty">${icon(isRec ? 'library' : 'image')}<b>${state.filter ? 'No match' : (isRec ? 'No recordings yet' : 'No screenshots yet')}</b><p>${state.filter ? 'Try a different name.' : (isRec ? 'Press Record on the Console to save your first session.' : 'Press Screenshot on the Console to grab the phone screen.')}</p></div>`;
    return;
  }
  if (!isRec) {
    list.innerHTML = `<div class="shots">${files.map(f => `<button class="tile" data-shot="${esc(f.name)}" title="${esc(f.name)}"><img loading="lazy" src="${API}/file?name=${encodeURIComponent(f.name)}" alt="Screenshot ${esc(f.name)}"><span class="cap">${esc(when(f.modified))} · ${bytes(f.size)}</span></button>`).join('')}</div>`;
    return;
  }
  list.innerHTML = files.map(f => `<div class="row-file"><span class="badge">${icon('library')}</span>
    <div><b>${esc(f.name)}</b><small>${esc(when(f.modified))} · ${esc(ago(f.modified))}</small></div>
    <span class="size">${bytes(f.size)}</span>
    <div class="row-actions"><button class="icon-btn" data-rec="${esc(f.name)}" title="Play" aria-label="Play ${esc(f.name)}">${icon('play')}</button><button class="icon-btn" data-reveal="${esc(f.name)}" title="Show in folder" aria-label="Show ${esc(f.name)} in folder">${icon('folder')}</button><button class="icon-btn del" data-del="${esc(f.name)}" title="Delete" aria-label="Delete ${esc(f.name)}">${icon('trash')}</button></div></div>`).join('');
}

function renderAll() { renderStage(); renderSessions(); renderFeed(); renderStrip(); renderMeter(); renderDevices(); renderPicker(); renderLibrary(); }

/* ---------- actions ---------- */
async function run(act) {
  if (state.busy) return;
  const dev = sel();
  state.busy = true; state.pendingAction = act;
  renderStageActions();
  try {
    if (['mirror', 'record', 'stop-recording', 'stop'].includes(act)) {
      const r = await post('/action', { action: act, serial: dev });
      toast(r.message, r.forced ? 'bad' : 'ok');
      const expected = {
        active: typeof r.active === 'boolean' ? r.active : (act === 'record' || (act === 'stop-recording' && !!r.returnedToMirror)),
        recording: typeof r.recording === 'boolean' ? r.recording : act === 'record'
      };
      let confirmed = false;
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, i === 0 ? 150 : 350));
        await loadSessions();
        const actualActive = state.sessions.length > 0;
        const actualRecording = state.sessions.some(s => s.recording);
        if (actualActive === expected.active && actualRecording === expected.recording) { confirmed = true; break; }
      }
      if (!confirmed && expected.active && !state.sessions.length) await explainFailure();
      await loadLibrary();
      await loadActivity();
    } else if (act === 'screenshot') {
      const r = await post('/action', { action: 'screenshot', serial: dev });
      toast(r.message + ' ' + r.name);
      await loadLibrary();
    }
  } catch (e) { toast(e.message, 'bad'); }
  finally {
    state.busy = false; state.pendingAction = '';
    renderStageActions();
    await loadSessions();
    loadActivity();
  }
}
async function explainFailure() {
  try {
    const { log } = await api('/log');
    const lines = String(log || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const err = [...lines].reverse().find(l => /error|fail|unauthorized|no devices|not found|could not/i.test(l)) || lines[lines.length - 1];
    toast(err ? 'scrcpy closed right away: ' + err.replace(/^\w+:\s*/, '') : 'scrcpy closed right away. Check the cable and unlock the phone.', 'bad');
  } catch (e) {}
}
async function sendKey(key) {
  if (state.pendingKey || state.busy) return;
  const labels = { back: 'Back', home: 'Home', recents: 'Recents', notifications: 'Notifications', voldown: 'Volume down', volup: 'Volume up', wake: 'Wake', power: 'Power', sleep: 'Sleep', mute: 'Mute', menu: 'Menu' };
  state.pendingKey = key;
  renderStageActions();
  try {
    await post('/key', { serial: sel(), key });
    toast((labels[key] || 'Phone key') + ' sent.');
  } catch (e) { toast(e.message, 'bad'); }
  finally { state.pendingKey = ''; renderStageActions(); }
}
async function sendText() {
  if (state.pendingKey || state.busy) return;
  const input = $('#text-input'), text = input.value.trim();
  if (!text) return;
  state.pendingKey = 'text';
  renderStageActions();
  try { const r = await post('/text', { serial: sel(), text }); input.value = ''; toast(r.message); }
  catch (e) { toast(e.message, 'bad'); }
  finally { state.pendingKey = ''; renderStageActions(); }
}
async function wifi(action, extra = {}) {
  try { const r = await post('/wifi', { action, serial: sel(), ...extra }); toast(r.message); await loadDevices(true); loadActivity(); return r; }
  catch (e) { toast(e.message, 'bad'); }
}
async function copyText(text, label) {
  try { await navigator.clipboard.writeText(text); toast(label + ' copied.'); }
  catch (e) { toast('Copy was blocked by the browser. Select the text and copy it manually.', 'bad'); }
}
async function copyReport() {
  const lines = [
    `Scrcpy Toolkit ${state.version || 'unknown'}`,
    `Backend: ${state.online ? 'online' : 'unreachable'}`,
    `API port: ${state.status?.port || 47821}`,
    `ADB: ${state.status ? (state.status.adb ? 'present' : 'missing') : 'unknown'}`,
    `scrcpy: ${state.status ? (state.status.scrcpy ? 'present' : 'missing') : 'unknown'}`,
    `Refresh interval: ${state.settings?.pollInterval || 10}s`,
    `Active sessions: ${state.sessions.length}`
  ];
  for (const d of state.devices) {
    const i = state.info[d.id] || {};
    lines.push(`Device ${d.id}: ${d.state}, ${d.transport}${i.model ? ', ' + i.model : ''}${i.android ? ', Android ' + i.android : ''}${i.battery >= 0 ? ', battery ' + i.battery + '%' : ''}`);
  }
  for (const s of state.sessions) lines.push(`Session ${s.pid}: ${s.recording ? 'recording' : 'mirroring'}, device ${s.serial || 'unknown'}, since ${s.started || 'unknown'}${s.file ? ', file ' + s.file : ''}`);
  try {
    const r = await api('/log');
    const recent = String(r.log || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(-8);
    lines.push('Recent scrcpy log:', ...(recent.length ? recent : ['No recent log output.']));
  } catch (e) { lines.push('Log unavailable: ' + e.message); }
  copyText(lines.join('\n'), 'Diagnostic report');
}

/* library actions */
async function openFile(kind, name, reveal) {
  try { await post(reveal ? '/reveal-file' : '/open-file', { kind, name }); } catch (e) { toast(e.message, 'bad'); }
}
async function deleteFile(kind, name) {
  const ok = await confirmDialog('Delete this file?', `<p><b>${esc(name)}</b> will be removed permanently. This cannot be undone.</p>`);
  if (!ok) return false;
  try { await post('/delete-file', { kind, name }); toast('Deleted ' + name + '.'); await loadLibrary(); loadActivity(); return true; }
  catch (e) { toast(e.message, 'bad'); return false; }
}
function showShot(name) {
  state.fileTarget = name;
  $('#shot-title').textContent = name;
  $('#shot-img').src = `${API}/file?name=${encodeURIComponent(name)}`;
  $('#dlg-shot').showModal();
}
async function cleanup() {
  const days = Number($('#cleanup-days').value), kind = state.tab;
  try {
    const p = await api(`/cleanup-preview?days=${days}&kind=${kind}`);
    if (!p.files.length) { toast(`No ${kind} are older than ${days} days.`); return; }
    const total = p.files.reduce((n, f) => n + f.size, 0);
    const list = `<p>${p.files.length} file${p.files.length > 1 ? 's' : ''} older than ${days} days, ${bytes(total)} in total.</p><ul>${p.files.slice(0, 40).map(f => `<li><span>${esc(f.name)}</span><span>${bytes(f.size)}</span></li>`).join('')}</ul>${p.files.length > 40 ? `<p class="hint">and ${p.files.length - 40} more</p>` : ''}`;
    if (!await confirmDialog('Delete old ' + kind + '?', list, `Delete ${p.files.length}`)) return;
    const r = await post('/cleanup', { days, confirm: true, kind });
    toast(`Removed ${r.deleted} file${r.deleted === 1 ? '' : 's'} and freed ${bytes(r.freed)}.`);
    loadLibrary(); loadActivity();
  } catch (e) { toast(e.message, 'bad'); }
}

/* ---------- settings ---------- */
const PRESETS = [
  { id: 'battery', name: 'Battery saver', note: 'Light on phone and PC', v: { maxSize: 1024, maxFps: 24, bitrate: '4M' } },
  { id: 'balanced', name: 'Balanced', note: 'Good for most phones', v: { maxSize: 1280, maxFps: 30, bitrate: '8M' } },
  { id: 'quality', name: 'Quality', note: 'Sharper and smoother', v: { maxSize: 1600, maxFps: 45, bitrate: '12M' } },
  { id: 'max', name: 'Maximum', note: 'Native size, needs a strong PC', v: { maxSize: 0, maxFps: 60, bitrate: '16M' } }
];
const SEG = {
  maxSize: [[720, '720'], [1024, '1024'], [1280, '1280'], [1600, '1600'], [1920, '1920'], [0, 'Native']],
  maxFps: [[15, '15'], [24, '24'], [30, '30'], [45, '45'], [60, '60']],
  bitrate: [['2M', '2'], ['4M', '4'], ['8M', '8'], ['12M', '12'], ['16M', '16']],
  codec: [['h264', 'H.264'], ['h265', 'H.265']],
  audioSource: [['output', 'Phone sound'], ['mic', 'Microphone']],
  pollInterval: [[4, '4 sec'], [6, '6 sec'], [10, '10 sec'], [15, '15 sec']]
};
const FIELDS = {
  video: [
    { k: 'maxSize', t: 'seg', n: 'Longest side', d: 'Pixels. Native uses the phone screen as is.' },
    { k: 'maxFps', t: 'seg', n: 'Frame rate', d: 'Frames per second. Higher uses more CPU.' },
    { k: 'bitrate', t: 'seg', n: 'Bitrate', d: 'Megabits per second. Higher makes larger files.' },
    { k: 'codec', t: 'seg', n: 'Video codec', d: 'H.265 makes smaller files but needs phone support.' }
  ],
  audio: [
    { k: 'audio', t: 'sw', n: 'Capture phone audio', d: 'Depends on Android version and app restrictions.' },
    { k: 'audioSource', t: 'seg', n: 'Audio source', d: 'Use the microphone to record your voice.', needs: 'audio' }
  ],
  dashboard: [
    { k: 'pollInterval', t: 'seg', n: 'Refresh interval', d: 'How often the dashboard checks devices and sessions. Slower intervals reduce ADB contention.' }
  ],
  window: [
    { k: 'stayAwake', t: 'sw', n: 'Keep the phone awake', d: 'Stops the screen from sleeping while connected.' },
    { k: 'turnScreenOff', t: 'sw', n: 'Turn the phone screen off', d: 'Mirror from the PC with the phone display dark.' },
    { k: 'showTouches', t: 'sw', n: 'Show touches', d: 'Draws a dot where fingers touch. Good for demos.' },
    { k: 'viewOnly', t: 'sw', n: 'View only', d: 'Block mouse and keyboard control of the phone.' },
    { k: 'alwaysOnTop', t: 'sw', n: 'Keep window on top', d: 'The mirror window stays above other apps.' },
    { k: 'fullscreen', t: 'sw', n: 'Start in full screen', d: 'Open the mirror window full screen.' },
    { k: 'borderless', t: 'sw', n: 'Borderless window', d: 'Hide the window title bar.' },
    { k: 'powerOffOnClose', t: 'sw', n: 'Lock phone on close', d: 'Turns the phone screen off when you close the window.' }
  ]
};
function matchPreset(s) { const p = PRESETS.find(x => Object.entries(x.v).every(([k, v]) => s[k] === v)); return p ? p.id : 'custom'; }

function renderSettings() {
  const s = state.settings;
  if (!s) return;
  const active = matchPreset(s);
  $('#presets').innerHTML = PRESETS.map(p => `<button class="preset ${p.id === active ? 'is-active' : ''}" data-preset="${p.id}" aria-pressed="${p.id === active}"><b>${p.name}</b><span>${p.note}</span><em>${p.v.maxSize || 'Native'}${p.v.maxSize ? ' px' : ''} · ${p.v.maxFps} fps · ${p.v.bitrate.replace('M', '')} Mbps</em></button>`).join('');
  for (const [group, list] of Object.entries(FIELDS)) {
    $('#fields-' + group).innerHTML = list.map(f => {
      const ctl = f.t === 'sw'
        ? `<label class="switch"><input type="checkbox" data-set="${f.k}" ${s[f.k] ? 'checked' : ''} aria-label="${esc(f.n)}"><i></i></label>`
        : `<div class="seg" role="group" aria-label="${esc(f.n)}">${SEG[f.k].map(o => { const selected = String(s[f.k]) === String(o[0]); return `<button type="button" data-seg="${f.k}" data-val="${esc(o[0])}" class="${selected ? 'is-active' : ''}" aria-pressed="${selected}">${esc(o[1])}</button>`; }).join('')}</div>`;
      return `<div class="field ${f.needs && !s[f.needs] ? 'off' : ''}"><div><span class="name">${esc(f.n)}</span><small>${esc(f.d)}</small></div>${ctl}</div>`;
    }).join('');
  }
  refreshPreview();
}
async function loadSettings() {
  if (!state.online) return;
  try { state.settings = (await api('/settings')).settings; renderSettings(); } catch (e) { toast(e.message, 'bad'); }
}
const saveSettings = debounce(async () => {
  const el = $('#save-state');
  el.textContent = 'Saving…';
  try { state.settings = (await post('/settings', state.settings)).settings; el.textContent = 'Saved. New sessions use these settings.'; }
  catch (e) { el.textContent = 'Not saved.'; toast(e.message, 'bad'); await loadSettings(); }
}, 450);
function change(key, val) {
  if (!state.settings) return;
  state.settings[key] = val;
  state.settings.preset = matchPreset(state.settings);
  renderSettings(); saveSettings();
}
const refreshPreview = debounce(async () => {
  if (!state.settings || !state.online) return;
  try { const r = await post('/preview', { settings: state.settings, mode: state.previewMode, serial: sel() }); $('#cmd-preview').textContent = r.command; }
  catch (e) { $('#cmd-preview').textContent = e.message; }
}, 120);

/* ---------- command palette ---------- */
const COMMANDS = () => [
  { n: 'Mirror phone', i: 'mirror', k: 'M', f: () => run('mirror') },
  { n: recording() ? 'Stop recording' : 'Start recording', i: recording() ? 'stop' : 'record', k: 'R', f: () => run(recording() ? 'stop' : 'record') },
  { n: 'Take screenshot', i: 'camera', k: 'S', f: () => run('screenshot') },
  { n: 'Close scrcpy windows', i: 'stop', f: () => run('stop') },
  { n: 'Go to Console', i: 'console', k: '1', f: () => go('console') },
  { n: 'Go to Library', i: 'library', k: '2', f: () => go('library') },
  { n: 'Go to Devices', i: 'phone', k: '3', f: () => go('device') },
  { n: 'Go to Settings', i: 'sliders', k: '4', f: () => go('settings') },
  { n: 'Press Home on phone', i: 'home', f: () => sendKey('home') },
  { n: 'Press Back on phone', i: 'back', f: () => sendKey('back') },
  { n: 'Open phone notifications', i: 'bell', f: () => sendKey('notifications') },
  { n: 'Wake phone screen', i: 'sun-moon', f: () => sendKey('wake') },
  { n: 'Switch phone to Wi-Fi', i: 'wifi', f: () => { go('device'); wifi('enable'); } },
  { n: 'Restart ADB', i: 'refresh', f: () => wifi('restart') },
  { n: 'Open recordings folder', i: 'folder', f: () => post('/open-folder', { kind: 'recordings' }) },
  { n: 'Open screenshots folder', i: 'folder', f: () => post('/open-folder', { kind: 'screenshots' }) },
  { n: 'Switch light and dark theme', i: 'sun-moon', f: () => toggleTheme() },
  { n: 'Refresh everything', i: 'refresh', f: () => refreshAll(true) }
];
let palIndex = 0, palItems = [];
function renderPalette() {
  const q = $('#pal-input').value.trim().toLowerCase();
  palItems = COMMANDS().filter(c => c.n.toLowerCase().includes(q));
  palIndex = Math.min(palIndex, Math.max(0, palItems.length - 1));
  $('#pal-list').innerHTML = palItems.length
    ? palItems.map((c, i) => `<li role="option" data-i="${i}" class="${i === palIndex ? 'sel' : ''}" aria-selected="${i === palIndex}">${icon(c.i)}<span>${esc(c.n)}</span>${c.k ? `<kbd>${c.k}</kbd>` : ''}</li>`).join('')
    : '<li class="none">No command matches.</li>';
  const cur = $('#pal-list .sel'); if (cur) cur.scrollIntoView({ block: 'nearest' });
}
function openPalette() { const d = $('#dlg-palette'); if (d.open) return; $('#pal-input').value = ''; palIndex = 0; renderPalette(); d.showModal(); $('#pal-input').focus(); }
function runPalette(i) { const c = palItems[i]; if (!c) return; $('#dlg-palette').close(); setTimeout(c.f, 30); }

/* ---------- theme ---------- */
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('stk-theme', next); } catch (e) {}
}

/* ---------- refresh loop ---------- */
async function refreshAll(loud) {
  if (state.polling || state.busy) { if (loud) toast('A refresh or action is already running.'); return; }
  state.polling = true;
  try {
    const ok = await loadStatus();
    if (!ok) { if (loud) toast('The local backend is not responding yet. Retrying automatically.', 'bad'); return; }
    await Promise.all([loadDevices(true), loadSessions(), loadActivity(), loadLibrary()]);
    if (loud) toast('Refresh complete.');
  } finally { state.polling = false; }
}
function tickClocks() {
  $$('.timer[data-since]').forEach(el => { el.textContent = clock(el.dataset.since); });
  const rc = $('#rec-clock'), r = recording(); if (rc && r) rc.textContent = clock(r.started);
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button, li[data-i]');
  if (!t) return;
  if (t.dataset.view) return go(t.dataset.view);
  if (t.dataset.act) return run(t.dataset.act);
  if (t.dataset.key) return sendKey(t.dataset.key);
  if (t.dataset.shot) return showShot(t.dataset.shot);
  if (t.dataset.rec) return openFile('recordings', t.dataset.rec, false);
  if (t.dataset.reveal) return openFile('recordings', t.dataset.reveal, true);
  if (t.dataset.del) return deleteFile('recordings', t.dataset.del);
  if (t.dataset.preset) { const p = PRESETS.find(x => x.id === t.dataset.preset); Object.assign(state.settings, p.v, { preset: p.id }); renderSettings(); return saveSettings(); }
  if (t.dataset.seg) { const raw = t.dataset.val, num = SEG[t.dataset.seg].find(o => String(o[0]) === raw)[0]; return change(t.dataset.seg, num); }
  if (t.dataset.mode) { state.previewMode = t.dataset.mode; $$('#preview-mode button').forEach(b => b.classList.toggle('is-active', b === t)); return refreshPreview(); }
  if (t.dataset.tab) { state.tab = t.dataset.tab; $$('.tab').forEach(b => { const on = b === t; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); }); return renderLibrary(); }
  if (t.dataset.i !== undefined) return runPalette(Number(t.dataset.i));
});
document.addEventListener('change', e => {
  if (e.target.dataset && e.target.dataset.set) change(e.target.dataset.set, e.target.checked);
});
$('#device-select').addEventListener('change', async e => { state.selected = e.target.value; if (!state.info[state.selected]) await loadInfo(state.selected); renderStage(); renderDevices(); refreshPreview(); });
$('#palette-btn').addEventListener('click', openPalette);
$('#theme-btn').addEventListener('click', toggleTheme);
$('#text-send').addEventListener('click', sendText);
$('#text-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });
$('#lib-search').addEventListener('input', e => { state.filter = e.target.value; renderLibrary(); });
$('#lib-sort').addEventListener('change', e => { state.sort = e.target.value; renderLibrary(); });
$('#lib-refresh').addEventListener('click', () => loadLibrary());
$('#lib-folder').addEventListener('click', () => post('/open-folder', { kind: state.tab }).catch(e => toast(e.message, 'bad')));
$('#cleanup-btn').addEventListener('click', cleanup);
$('#run-check').addEventListener('click', async () => { await loadDevices(true); toast(readyDevices().length ? 'Device check complete.' : 'No ready device found.', readyDevices().length ? 'ok' : 'bad'); });
$('#wifi-enable').addEventListener('click', () => wifi('enable'));
$('#wifi-connect').addEventListener('click', () => { const a = $('#wifi-address').value.trim(); if (!a) return toast('Enter the phone address first.', 'bad'); wifi('connect', { address: a }); });
$('#wifi-disconnect').addEventListener('click', () => wifi('disconnect'));
$('#adb-restart').addEventListener('click', () => wifi('restart'));
$('#copy-report').addEventListener('click', copyReport);
$('#cmd-copy').addEventListener('click', () => copyText($('#cmd-preview').textContent, 'Command'));
$('#shot-close').addEventListener('click', () => $('#dlg-shot').close());
$('#shot-open').addEventListener('click', () => openFile('screenshots', state.fileTarget, false));
$('#shot-reveal').addEventListener('click', () => openFile('screenshots', state.fileTarget, true));
$('#shot-delete').addEventListener('click', async () => { if (await deleteFile('screenshots', state.fileTarget)) $('#dlg-shot').close(); });
$('#pal-input').addEventListener('input', () => { palIndex = 0; renderPalette(); });
$('#pal-input').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palIndex = Math.min(palItems.length - 1, palIndex + 1); renderPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palIndex = Math.max(0, palIndex - 1); renderPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(palIndex); }
});
$('#dlg-palette').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d && d.id !== 'dlg-palette') d.close(); }));
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return openPalette(); }
  const typing = /^(input|select|textarea)$/i.test(document.activeElement.tagName) || document.querySelector('dialog[open]');
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const map = { '1': () => go('console'), '2': () => go('library'), '3': () => go('device'), '4': () => go('settings'), m: () => run('mirror'), r: () => run(recording() ? 'stop' : 'record'), s: () => run('screenshot') };
  const f = map[e.key.toLowerCase()]; if (f) { e.preventDefault(); f(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(false); });

/* ---------- session reconciliation ---------- */
// While a scrcpy window is active, check its real process state frequently so
// externally closed recording/mirroring windows do not leave a stale timer.
const pollSessionsLoop = async () => {
  if (!document.hidden && state.online && !state.busy) {
    try { await loadSessions(); } catch (e) {}
  }
  setTimeout(pollSessionsLoop, state.sessions.length ? 1200 : 5000);
};

/* ---------- boot ---------- */
(async function boot() {
  renderAll();
  go((location.hash || '#console').slice(1));
  await refreshAll(false);
  setInterval(tickClocks, 1000);
  const pollLoop = async () => {
    if (!document.hidden && !state.polling && !state.busy) {
      state.polling = true;
      try {
        const ok = await loadStatus();
        if (ok) {
          await Promise.all([loadSessions(), loadDevices(false), loadActivity()]);
          if (state.view === 'library') await loadLibrary();
        }
      } finally { state.polling = false; }
    }
    const seconds = Number(state.settings && state.settings.pollInterval) || 10;
    setTimeout(pollLoop, Math.max(4000, Math.min(15000, seconds * 1000)));
  };
  setTimeout(pollLoop, 6000);
  setTimeout(pollSessionsLoop, 1500);
})();
})();
