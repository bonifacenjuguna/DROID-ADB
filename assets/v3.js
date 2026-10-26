/* Scrcpy Toolkit 3.0 shared pieces: saved data (store), forms, jobs panel, notifications, accent, header battery, More sheet, charts. */
(() => {
'use strict';
const { $, $$, esc, icon, bytes, state } = STK;

/* ---------- saved data kept by the backend (Config\store.json) ---------- */
const kvData = {}, kvTimers = {}, kvPending = {};
let kvTries = 0, kvNext = 0, kvRun = null;
function kvSend(key) {
  clearTimeout(kvTimers[key]); delete kvTimers[key];
  if (!(key in kvPending)) return Promise.resolve();
  const value = kvPending[key];
  let small = true; try { small = JSON.stringify(value).length < 60000; } catch (e) {}
  return STK.post('/store', { key, value }, { keepalive: small }).then(() => { if (kvPending[key] === value) delete kvPending[key]; }).catch(e => { STK.fail(e); });
}
STK.kv = {
  loaded: false,
  /* True once the saved data was really read. Until then nothing may be written, or a short list built
     from "nothing loaded yet" would replace the real one. */
  ready() { return STK.kv.loaded === true; },
  guard() { if (STK.kv.ready()) return true; STK.toast('Your saved data is still loading. Try again in a moment.', 'bad'); if (!STK.kv.loaded) STK.kv.load(); return false; },
  get(key, d) { const v = kvData[key]; return v === undefined || v === null ? d : v; },
  set(key, value) {
    if (!STK.kv.guard()) return false;
    kvData[key] = value; kvPending[key] = value;
    clearTimeout(kvTimers[key]);
    kvTimers[key] = setTimeout(() => kvSend(key), 250);
    STK.emit('kv', key);
    return true;
  },
  flush() { return Promise.all(Object.keys(kvPending).map(kvSend)); },
  load() { if (!kvRun) kvRun = kvLoad().finally(() => { kvRun = null; }); return kvRun; }
};
async function kvLoad() {
  {
    const had = STK.kv.loaded === true;
    if (!had) STK.kv.loaded = 'loading';
    try {
      const r = await STK.api('/store'), fresh = r.store || {};
      for (const k of Object.keys(kvData)) if (!(k in kvPending)) delete kvData[k];   /* keep only what the backend has, except edits not sent yet */
      for (const k of Object.keys(fresh)) if (!(k in kvPending)) kvData[k] = fresh[k];
      STK.kv.loaded = true; kvTries = 0; applyNicks(); STK.emit('kv', '*');
    } catch (e) {
      if (!had) { STK.kv.loaded = false; kvTries++; kvNext = Date.now() + Math.min(60000, 2000 * kvTries); }   /* try again a little later */
    }
  }
}
/* send edits that are still waiting when the page is hidden or closed */
document.addEventListener('visibilitychange', () => { if (document.hidden) STK.kv.flush(); });
window.addEventListener('pagehide', () => { STK.kv.flush(); });
function applyNicks() { const n = kvData.nicknames || {}; for (const id of Object.keys(n)) STK.store.set('nick:' + id, n[id]); }
STK.saveNick = (id, name) => { if (!STK.kv.guard()) return; const n = { ...(kvData.nicknames || {}) }; if (name) n[id] = name; else delete n[id]; STK.kv.set('nicknames', n); };
STK.nickFor = id => STK.store.get('nick:' + id, '');

/* ---------- small form dialog: STK.form(title, html, okLabel) -> object or null ---------- */
STK.form = function (title, html, okLabel = 'Save') {
  return new Promise(resolve => {
    const dlg = $('#dlg-form'), form = $('#form-form');
    $('#form-title').textContent = title;
    $('#form-body').innerHTML = html;
    $('#form-ok').textContent = okLabel;
    const done = () => {
      dlg.removeEventListener('close', done);
      if (dlg.returnValue !== 'ok') return resolve(null);
      const out = {};
      for (const el of $$('[name]', form)) out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      resolve(out);
    };
    dlg.returnValue = 'cancel';
    dlg.addEventListener('close', done);
    dlg.showModal();
    const first = $('input:not([type=checkbox]), select, textarea', form); if (first) first.focus();
  });
};
STK.field = (name, label, value = '', attrs = '') => `<label class="ff"><span>${esc(label)}</span><input name="${esc(name)}" value="${esc(value)}" ${attrs} autocomplete="off" spellcheck="false"></label>`;
STK.select = (name, label, options, value) => `<label class="ff"><span>${esc(label)}</span><select name="${esc(name)}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
STK.check = (name, label, on) => `<label class="ff chk"><input type="checkbox" name="${esc(name)}" ${on ? 'checked' : ''}><span>${esc(label)}</span></label>`;

/* ---------- sparklines and gauges ---------- */
STK.line = function (values, { w = 300, h = 64, min = 0, max = null, cls = '' } = {}) {
  const v = values.filter(x => x !== null && x !== undefined && isFinite(x));
  if (v.length < 2) return `<svg class="chart ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"></svg>`;
  const hi = max === null ? Math.max(1, ...v) * 1.1 : max, lo = min;
  const n = values.length, step = w / Math.max(1, n - 1);
  let d = '', first = null, last = null;
  values.forEach((x, i) => {
    if (x === null || x === undefined || !isFinite(x)) return;
    const px = (i * step).toFixed(1), py = (h - 3 - (Math.min(hi, Math.max(lo, x)) - lo) / (hi - lo || 1) * (h - 6)).toFixed(1);
    d += (d ? 'L' : 'M') + px + ' ' + py; if (first === null) first = px; last = px;
  });
  return `<svg class="chart ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="${d}L${last} ${h}L${first} ${h}Z"/><path class="ln" d="${d}"/></svg>`;
};
STK.rate = n => { n = Number(n) || 0; if (n < 1024) return Math.round(n) + ' B/s'; if (n < 1048576) return (n / 1024).toFixed(0) + ' KB/s'; return (n / 1048576).toFixed(1) + ' MB/s'; };

/* ---------- desktop notifications ---------- */
STK.notify = function (title, body, tag) {
  try {
    if (!state.settings || state.settings.notifyDesktop === false || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden && document.hasFocus()) return;
    new Notification(title, { body, tag: tag || 'stk', silent: false });
  } catch (e) {}
};
document.addEventListener('click', () => {
  try { if ('Notification' in window && Notification.permission === 'default' && state.settings && state.settings.notifyDesktop !== false) Notification.requestPermission(); } catch (e) {}
}, { once: true });

/* ---------- accent colour ---------- */
STK.applyAccent = a => { a = a || 'amber'; document.documentElement.dataset.accent = a; try { localStorage.setItem('stk-accent', a); } catch (e) {} };
STK.on('settings', s => STK.applyAccent(s.accent));

/* ---------- jobs ---------- */
const J = { list: [], timer: null, seen: {}, open: false, first: true };
const KIND = { backup: 'cloud', pull: 'download', ffmpeg: 'scissors', gif: 'image', macro: 'macro', shot: 'camera' };
async function jobsRefresh() {
  try {
    const r = await STK.api('/jobs'); J.list = r.jobs || [];
    for (const j of J.list) {
      const was = J.seen[j.id]; J.seen[j.id] = j.state;
      if (J.first) continue;
      if (was && was !== j.state && ['done', 'failed', 'cancelled'].includes(j.state)) {
        STK.toast(j.title + ': ' + (j.message || j.state), j.state === 'failed' ? 'bad' : 'ok');
        STK.notify && STK.notify(j.state === 'failed' ? 'Job failed' : 'Job finished', j.title + ' - ' + (j.message || ''), 'job' + j.id);
        STK.emit('job-done', j);
        if (['ffmpeg', 'gif', 'shot'].includes(j.kind)) STK.emit('library-changed');
      }
    }
    J.first = false;
  } catch (e) {}
  paintJobs();
  const active = J.list.some(j => ['queued', 'running'].includes(j.state));
  clearTimeout(J.timer);
  if (active || J.open) J.timer = setTimeout(jobsRefresh, 1200);
}
function paintJobs() {
  const running = J.list.filter(j => ['queued', 'running'].includes(j.state)).length;
  const btn = $('#jobs-btn');
  btn.hidden = !J.list.length;
  btn.classList.toggle('busy', running > 0);
  $('#jobs-count').textContent = running || '';
  $('#jobs-count').hidden = !running;
  if (J.open) STK.setHtml($('#jobs-list'), J.list.length ? J.list.map(jobRow).join('') : '<p class="hint" style="padding:14px">Nothing running. Backups, copies, conversions and macros show up here.</p>');
}
function jobRow(j) {
  const pct = j.total ? Math.min(100, Math.round(j.done / j.total * 100)) : (j.state === 'done' ? 100 : 0);
  const live = ['queued', 'running'].includes(j.state);
  return `<div class="jobrow ${esc(j.state)}"><span class="badge">${icon(KIND[j.kind] || 'jobs')}</span><div><b>${esc(j.title)}</b><small>${esc(j.message || j.state)}${j.total && live ? ' · ' + j.done + '/' + j.total : ''}</small><div class="progress"><i style="width:${live && !j.total ? 30 : pct}%" class="${live && !j.total ? 'indet' : ''}"></i></div></div>${live ? `<button class="btn sm" data-jobcancel="${esc(j.id)}">Stop</button>` : `<span class="chip sm ${j.state === 'done' ? 'ok' : j.state === 'failed' ? 'bad' : ''}"><i class="dot"></i><b>${esc(j.state)}</b></span>`}</div>`;
}
STK.jobs = {
  watch() { J.first = false; clearTimeout(J.timer); jobsRefresh(); },
  toggle(force) {
    J.open = force === undefined ? !J.open : force;
    $('#jobs-panel').hidden = !J.open;
    if (J.open) jobsRefresh(); else paintJobs();
  },
  /* start a job route and follow it */
  async start(path, body, okMessage) {
    const r = await STK.post(path, body);
    STK.toast(okMessage || 'Started. Follow it in Background jobs.', 'ok', { label: 'Show', run: () => STK.jobs.toggle(true) });
    STK.jobs.watch();
    return r;
  }
};
$('#jobs-btn').addEventListener('click', () => STK.jobs.toggle());
$('#jobs-close').addEventListener('click', () => STK.jobs.toggle(false));
$('#jobs-clear').addEventListener('click', () => STK.post('/jobs/clear', {}).then(jobsRefresh).catch(STK.fail));
$('#jobs-panel').addEventListener('click', e => { const b = e.target.closest('[data-jobcancel]'); if (b) STK.post('/jobs/cancel', { id: b.dataset.jobcancel }).then(jobsRefresh).catch(STK.fail); });
STK.on('job-event', () => jobsRefresh());

/* ---------- header phone battery ---------- */
function paintHdr() {
  const L = STK.live(), el = $('#hdr-batt');
  if (!L || L.battery < 0) { el.hidden = true; return; }
  el.hidden = false;
  const cls = 'hdr-batt' + (L.charging ? ' chg' : '') + (L.battery <= 15 && !L.charging ? ' low' : '');
  const html = `<i style="--p:${L.battery}"></i><b>${L.battery}%</b>${L.charging ? icon('bolt', 'sm') : ''}`;
  el.className = cls; STK.setHtml(el, html);
}
let lastReady = null;
STK.on('state', () => {
  paintHdr();
  const ready = STK.readyDevices().length;
  if (lastReady !== null && lastReady > 0 && ready === 0) STK.notify && STK.notify('Phone disconnected', 'The phone is no longer connected to the PC.', 'disc');
  lastReady = ready;
});
STK.on('live', paintHdr);

/* ---------- More sheet and rail state ---------- */
const MORE = [['console', 'console', 'Console'], ['studio', 'wand', 'Studio'], ['automation', 'macro', 'Automation'], ['phone', 'apps', 'Phone tools'], ['monitor', 'chart', 'Monitor'], ['notifications', 'bell', 'Notifications'], ['library', 'library', 'Library'], ['device', 'phone', 'Devices'], ['settings', 'sliders', 'Settings']];
$('#more-grid').innerHTML = MORE.map(([v, ic, l]) => `<button class="moretile" data-view="${v}">${icon(ic)}<span>${l}</span></button>`).join('');
$('#rail-more').addEventListener('click', () => $('#dlg-more').showModal());
$('#more-close').addEventListener('click', () => $('#dlg-more').close());
$('#more-grid').addEventListener('click', () => $('#dlg-more').close());
STK.on('view', v => { const prim = ['console', 'phone', 'library'].includes(v); $('#rail-more').classList.toggle('is-active', !prim); });

/* ---------- misc ---------- */
STK.gifCapture = async function () {
  const f = await STK.form('Record a GIF', STK.select('seconds', 'Length', [[4, '4 seconds'], [6, '6 seconds'], [10, '10 seconds'], [15, '15 seconds'], [30, '30 seconds']], 6) + STK.select('width', 'Width', [[240, '240 px (small)'], [360, '360 px'], [480, '480 px'], [640, '640 px (large)']], 360) + '<p class="hint">The phone records its screen, then ffmpeg turns it into a GIF saved in your recordings.</p>', 'Record');
  if (!f) return;
  try { await STK.jobs.start('/gif-capture', { serial: STK.sel(), seconds: Number(f.seconds), width: Number(f.width), fps: 12 }, 'Recording a GIF. Use the phone now.'); } catch (e) { STK.fail(e); }
};
STK.demoToggle = async function () {
  const id = STK.sel(); if (!id) return;
  try { const cur = await STK.api('/demo?id=' + encodeURIComponent(id)); const r = await STK.post('/demo', { serial: id, on: !cur.on }, { timeout: 40000 }); STK.toast(r.message); STK.emit('demo', r.on); } catch (e) { STK.fail(e); }
};

STK.on('state', () => { if (!STK.kv.loaded && state.online && Date.now() >= kvNext) STK.kv.load(); });
STK.on('offline', () => { if (STK.kv.loaded === 'loading') STK.kv.loaded = false; });
jobsRefresh();
})();
