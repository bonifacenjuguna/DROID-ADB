/* Monitor: live CPU, memory, network, temperature and top apps; usage; access and permissions. */
(() => {
'use strict';
const { $, $$, esc, icon, bytes, state } = STK;
const M = { tab: STK.store.get('mtab', 'live'), timer: null, hist: {}, busy: false, alerted: 0, usage: null, battery: null, access: null, perms: null, permPkg: '', permApps: null };
const N = 60;
const nice = p => (STK.niceApp ? STK.niceApp(p) : p);
const root = () => $('#mon-root');
const hist = id => M.hist[id] || (M.hist[id] = { cpu: [], mem: [], rx: [], tx: [], temp: [], bat: [], log: [], last: null });
/* Every sample is also kept with its time, so the big graphs can show minutes or hours. Old data is thinned out, never dropped at once. */
function pushLog(h, r) {
  h.log.push({ t: Date.now(), cpu: r.cpu, mem: r.memPct, rx: r.rxBps, tx: r.txBps, temp: r.tempC != null ? r.tempC : r.batteryTempC });
  if (h.log.length > 12000) { const half = h.log.length >> 1; h.log = h.log.slice(0, half).filter((_, i) => i % 2 === 0).concat(h.log.slice(half)); }
}

function setTab(name) {
  M.tab = name; STK.store.set('mtab', name);
  $$('[data-mtab]').forEach(b => { const on = b.dataset.mtab === name; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); });
  stop();
  if (!STK.sel()) return nodev();
  if (name === 'live') { skeleton(); start(); } else if (name === 'usage') loadUsage(); else loadPerms();
}
function nodev() { STK.setHtml(root(), `<section class="panel"><div class="empty">${icon('plug')}<b>No phone connected</b><p>The monitor needs a ready phone. Connect one on the Devices page.</p></div></section>`); }

/* ---------- live ---------- */
function skeleton() {
  STK.setHtml(root(), `<div class="mon-grid">
    ${['cpu:Processor', 'mem:Memory', 'net:Network', 'temp:Temperature'].map(x => { const [k, l] = x.split(':'); return `<section class="panel mon-card is-zoomable" id="mc-${k}" data-zoom="${k}" tabindex="0" role="button" aria-label="${l}: open the big graph"><header><span>${l}<svg class="ic sm zoom-ic" aria-hidden="true"><use href="#i-expand"/></svg></span><b id="mv-${k}">--</b></header><div id="mg-${k}" class="mon-chart"></div><small id="ms-${k}" class="hint"></small></section>`; }).join('')}
  </div>
  <div class="two"><section class="panel"><header class="panel-head"><h2>Busiest apps right now</h2><span class="hint" id="mon-age"></span></header><div id="mon-top"></div></section>
  <section class="panel"><header class="panel-head"><h2>Alerts</h2></header><div id="mon-alerts" class="hint">Watching battery and processor heat. A warning shows here and on your desktop if the phone runs hot.</div></section></div>`);
  paintLive();
}
function paintLive() {
  const id = STK.sel(), h = hist(id); if (!id || !$('#mv-cpu')) return;
  const l = h.last;
  const set = (k, v, sub) => { const a = $('#mv-' + k), b = $('#ms-' + k); if (a && a.textContent !== v) a.textContent = v; if (b && b.textContent !== sub) b.textContent = sub; };
  const g = (k, svg) => STK.setHtml($('#mg-' + k), svg);
  set('cpu', l && l.cpu != null ? l.cpu.toFixed(0) + '%' : '--', 'Measured over the last few seconds');
  g('cpu', STK.line(h.cpu, { max: 100 }));
  set('mem', l && l.memPct != null ? l.memPct.toFixed(0) + '%' : '--', l && l.memTotalMb ? `${(l.memUsedMb / 1024).toFixed(1)} of ${(l.memTotalMb / 1024).toFixed(1)} GB in use` : '');
  g('mem', STK.line(h.mem, { max: 100 }));
  set('net', l && l.rxBps != null ? '↓ ' + STK.rate(l.rxBps) : '--', l && l.txBps != null ? '↑ ' + STK.rate(l.txBps) : '');
  g('net', `<div class="two-line">${STK.line(h.rx, { cls: 'a' })}${STK.line(h.tx, { cls: 'b' })}</div>`);
  const t = l && (l.tempC != null ? l.tempC : l.batteryTempC);
  set('temp', t != null ? t.toFixed(0) + ' °C' : '--', l ? [l.batteryTempC != null ? 'Battery ' + l.batteryTempC.toFixed(1) + ' °C' : '', l.battery != null ? l.battery + '%' + (l.charging ? ' charging' : '') : ''].filter(Boolean).join(' · ') : '');
  g('temp', STK.line(h.temp, { min: 20, max: 60 }));
  $('#mc-temp').classList.toggle('hot', t != null && (t >= 45));
  $('#mon-age').textContent = l ? 'Updated ' + new Date(l.at).toLocaleTimeString() : '';
  const top = (l && l.top) || [];
  STK.setHtml($('#mon-top'), top.length ? top.map(a => `<div class="barrow"><span class="bn">${esc(nice(a.name))}<small>${esc(a.name)}${a.res ? ' · ' + esc(a.res) : ''}</small></span><span class="bar"><i style="width:${Math.min(100, a.cpu)}%"></i></span><b>${a.cpu.toFixed(0)}%</b></div>`).join('') : '<p class="hint" style="padding:14px">This phone did not list busy apps. Some phones hide the process list from adb.</p>');
}
const watching = () => state.view === 'monitor' && M.tab === 'live';
async function sample(bg) {
  if (M.busy || document.hidden) return;
  if (bg === true ? watching() : !watching()) return;
  const id = STK.sel(); if (!id) return;
  M.busy = true;
  try {
    const r = await STK.api('/monitor?id=' + encodeURIComponent(id), { timeout: 25000 });
    const h = hist(id), push = (a, v) => { a.push(v); if (a.length > N) a.shift(); };
    push(h.cpu, r.cpu); push(h.mem, r.memPct); push(h.rx, r.rxBps); push(h.tx, r.txBps); push(h.temp, r.tempC != null ? r.tempC : r.batteryTempC); h.last = r;
    pushLog(h, r);
    if (id === STK.sel()) { paintLive(); paintZoom(); }
    thermal(r);
  } catch (e) { if (!e.network) { const a = $('#mon-alerts'); if (a) a.textContent = e.message; } }
  M.busy = false;
}
function thermal(r) {
  const t = Math.max(r.tempC || 0, r.batteryTempC || 0);
  if (t >= 45 && Date.now() - M.alerted > 10 * 60 * 1000) { M.alerted = Date.now(); STK.toast('The phone is running hot: ' + t.toFixed(0) + ' °C.', 'bad'); STK.notify && STK.notify('Phone is hot', t.toFixed(0) + ' °C', 'heat'); }
  const box = $('#mon-alerts'); if (!box) return;
  if (t >= 45) {
    box.innerHTML = `<div class="alertline bad">${icon('alert')}<b>The phone is hot (${t.toFixed(0)} °C).</b> Let it cool, stop recording or lower the frame rate.</div>`;
  } else box.innerHTML = `<div class="alertline ok">${icon('check')}<b>All normal.</b> Phone temperature ${t ? t.toFixed(0) + ' °C' : 'unknown'}.</div>`;
}
function start() { stop(); sample(); M.timer = setInterval(sample, 2200); }
/* While another page is open, take one slow sample every 30 s so the long graphs have no big hole in them. */
function startBg() { if (M.bgTimer) return; M.bgTimer = setInterval(() => { if (state.online !== false && STK.sel()) sample(true); }, 30000); }
function stop() { clearInterval(M.timer); M.timer = null; }

/* ---------- usage and access ---------- */
const dur = ms => { const m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : Math.max(1, m) + ' min'; };
function bars(list, val, fmt) {
  const max = Math.max(1, ...list.map(val));
  return list.map(a => `<div class="barrow"><span class="bn">${esc(nice(a.package))}<small>${esc(a.package)}</small></span><span class="bar"><i style="width:${(val(a) / max * 100).toFixed(1)}%"></i></span><b>${fmt(a)}</b></div>`).join('');
}
async function loadUsage() {
  const id = STK.sel(); if (!id) return nodev();
  STK.setHtml(root(), '<section class="panel"><p class="hint">Reading usage from the phone. This can take a few seconds...</p></section>');
  const q = '?id=' + encodeURIComponent(id);
  const [u, b, a] = await Promise.all([STK.api('/insights/usage' + q, { timeout: 60000 }).catch(e => ({ apps: [], note: e.message })), STK.api('/insights/battery' + q, { timeout: 60000 }).catch(e => ({ apps: [], note: e.message })), STK.api('/insights/access' + q, { timeout: 40000 }).catch(e => null)]);
  if (M.tab !== 'usage') return;
  const list = (title, arr, empty) => `<div class="accrow"><b>${title}</b>${arr && arr.length ? arr.map(x => `<span class="tagchip">${esc(x)}</span>`).join('') : `<span class="hint">${empty}</span>`}</div>`;
  u.apps = u.apps || []; b.apps = b.apps || [];
  const reload = `<button class="btn sm" data-usage-reload>${icon('refresh', 'sm')}<span>Reload</span></button>`;
  // Android clears per-app battery numbers while the phone sits at 100% on the charger. Then show a clearly labelled estimate from screen time.
  let batBody;
  if (b.apps.length) batBody = bars(b.apps.slice(0, 12), x => x.mah, x => x.mah + ' mAh');
  else {
    const tot = u.apps.reduce((s, x) => s + x.ms, 0), est = u.apps.slice(0, 10).map(x => ({ package: x.package, pct: tot ? x.ms / tot * 100 : 0 }));
    batBody = `<p class="hint">${esc(b.note || 'No battery data.')}</p>` + (est.length ? `<p class="hint est-title"><b>Estimate from screen time</b> (not measured): apps used the most are usually the ones that drain the most.</p>${bars(est, x => x.pct, x => x.pct.toFixed(0) + '%')}` : '');
  }
  STK.setHtml(root(), `<div class="two"><section class="panel"><header class="panel-head"><h2>Screen time today</h2><span class="hint">${u.apps.length ? dur(u.apps.reduce((s, x) => s + x.ms, 0)) + ' in the list' : ''}</span>${reload}</header>${u.apps.length ? bars(u.apps.slice(0, 12), x => x.ms, x => dur(x.ms)) : `<p class="hint">${esc(u.note || 'No usage data.')}</p>`}</section>
    <section class="panel"><header class="panel-head"><h2>Battery use by app</h2><span class="hint">${b.totalMah ? b.totalMah + ' mAh in the list' : ''}</span>${reload}</header>${batBody}</section></div>
    <section class="panel"><header class="panel-head"><h2>What has access to the phone</h2>${reload}</header>
    ${a ? list('Accessibility services', a.accessibility, 'None enabled') + list('Notification access', a.listeners, 'None') + list('Device administrators', a.admins, 'None found') + `<div class="accrow"><b>Keyboard</b><span class="mono hint">${esc(a.keyboard || 'unknown')}</span></div><p class="hint">Apps with accessibility or notification access can read the screen or your messages. Remove any you do not recognise in the phone settings.</p>` : '<p class="hint">The phone did not answer.</p>'}</section>`);
}

/* ---------- permissions ---------- */
async function loadPerms() {
  const id = STK.sel(); if (!id) return nodev();
  if (!M.permApps) {
    STK.setHtml(root(), '<section class="panel"><p class="hint">Loading apps...</p></section>');
    try { M.permApps = (await STK.api(`/apps?id=${encodeURIComponent(id)}&scope=user`, { timeout: 60000 })).apps || []; } catch (e) { M.permApps = []; }
  }
  if (M.tab !== 'perms') return;
  STK.setHtml(root(), `<section class="panel"><header class="panel-head"><h2>App permissions</h2></header><p class="hint lead">Pick an app to see what it is allowed to use, and turn camera, microphone, location and similar access on or off.</p>
    <div class="row"><label class="ff grow"><span>App</span><input id="perm-app" list="perm-list" placeholder="Start typing an app name" value="${esc(M.permPkg)}" autocomplete="off" spellcheck="false"></label><button class="btn primary" id="perm-go">Show</button></div><datalist id="perm-list">${M.permApps.map(a => `<option value="${esc(a.package)}">${esc(nice(a.package))}</option>`).join('')}</datalist></section><div id="perm-out"></div>`);
  if (M.permPkg) showPerms(M.permPkg);
}
async function showPerms(pkg) {
  const out = $('#perm-out'); if (!out) return;
  out.innerHTML = '<section class="panel"><p class="hint">Reading permissions...</p></section>';
  try {
    const r = await STK.api(`/perms?id=${encodeURIComponent(STK.sel())}&package=${encodeURIComponent(pkg)}`, { timeout: 40000 });
    M.permPkg = pkg;
    const ch = r.perms.filter(p => p.changeable), ro = r.perms.filter(p => !p.changeable);
    out.innerHTML = `<section class="panel"><header class="panel-head"><h2>${esc(nice(pkg))}</h2><span class="hint mono">${esc(pkg)}</span></header>${ch.length ? `<div class="togglegrid">${ch.map(p => `<div class="tg ${p.granted ? 'on' : ''}"><span class="badge">${icon('shield')}</span><div><b>${esc(p.short.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase()))}</b><small>${p.granted ? 'Allowed' : 'Not allowed'}</small></div><label class="switch"><input type="checkbox" data-perm="${esc(p.name)}" ${p.granted ? 'checked' : ''} aria-label="${esc(p.short)}"><i></i></label></div>`).join('')}</div>` : '<p class="hint">This app has no permissions you can change here.</p>'}
      ${ro.length ? `<details class="xlevels"><summary><span>Other permissions (${ro.length})</span></summary><div class="xbody">${ro.map(p => `<span class="tagchip ${p.granted ? '' : 'off'}">${esc(p.short)}</span>`).join('')}</div></details>` : ''}</section>`;
  } catch (e) { out.innerHTML = `<section class="panel"><div class="empty">${icon('alert')}<b>Could not read permissions</b><p>${esc(e.message)}</p></div></section>`; }
}

/* ---------- big graph (opens from a Live card) ---------- */
const RANGES = [['2 min', 12e4], ['10 min', 6e5], ['1 hour', 36e5], ['4 hours', 144e5], ['All', 0]];
const ZOOM = {
  cpu: { title: 'Processor', series: [{ k: 'cpu', name: 'Processor' }], fmt: v => v.toFixed(0) + '%', lo: 0, hi: 100 },
  mem: { title: 'Memory', series: [{ k: 'mem', name: 'Memory' }], fmt: v => v.toFixed(0) + '%', lo: 0, hi: 100 },
  net: { title: 'Network', series: [{ k: 'rx', name: 'Download' }, { k: 'tx', name: 'Upload' }], fmt: v => STK.rate(v), lo: 0, hi: null },
  temp: { title: 'Temperature', series: [{ k: 'temp', name: 'Temperature' }], fmt: v => v.toFixed(1) + ' °C', lo: null, hi: null }
};
const Z = { open: false, key: 'cpu', range: STK.store.get('mzrange', 6e5), hoverT: null, geo: null };
const VW = 900, VH = 340, PL = 10, PR = 70, PT = 14, PB = 28;
const dlg = () => $('#dlg-chart');
const clock = (t, secs) => new Date(t).toLocaleTimeString([], secs ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
function niceCeil(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
/* Averages the samples into at most `max` points so a 4 hour graph stays quick and smooth. */
function windowed(h, ms, keys, max) {
  let a = h.log; if (ms) { const from = Date.now() - ms; a = a.filter(p => p.t >= from); }
  if (a.length <= max) return a;
  const t0 = a[0].t, span = Math.max(1, a[a.length - 1].t - t0), out = [];
  const acc = new Map();
  for (const p of a) {
    const b = Math.min(max - 1, Math.floor((p.t - t0) / span * max)); let o = acc.get(b);
    if (!o) { o = { t: 0, n: 0, s: {}, c: {} }; keys.forEach(k => { o.s[k] = 0; o.c[k] = 0; }); acc.set(b, o); }
    o.t += p.t; o.n++; keys.forEach(k => { if (p[k] != null && isFinite(p[k])) { o.s[k] += p[k]; o.c[k]++; } });
  }
  [...acc.keys()].sort((x, y) => x - y).forEach(b => { const o = acc.get(b), p = { t: o.t / o.n }; keys.forEach(k => { p[k] = o.c[k] ? o.s[k] / o.c[k] : null; }); out.push(p); });
  return out;
}
function openZoom(key) {
  if (!ZOOM[key] || !STK.sel()) return;
  Z.key = key; Z.hoverT = null; Z.open = true;
  const d = dlg(); if (!d.open) d.showModal();
  paintZoom(true);
}
function paintZoom(force) {
  if (!Z.open) return;
  const id = STK.sel(), h = id && M.hist[id], cfg = ZOOM[Z.key]; if (!h || !cfg) return;
  $('#zc-title').textContent = cfg.title;
  const rg = $('#zc-ranges'); if (force || !rg.firstChild) rg.innerHTML = RANGES.map(([l, v]) => `<button class="chip ${Z.range === v ? 'is-active' : ''}" data-zr="${v}">${l}</button>`).join('');
  else $$('[data-zr]', rg).forEach(b => b.classList.toggle('is-active', Number(b.dataset.zr) === Z.range));
  const keys = cfg.series.map(x => x.k), pts = windowed(h, Z.range, keys, 480).filter(p => keys.some(k => p[k] != null));
  const plot = $('#zc-plot');
  if (pts.length < 2) { plot.innerHTML = '<p class="hint" style="padding:30px 0;text-align:center">Collecting data. The graph appears after a few seconds.</p>'; Z.geo = null; readout(null); return; }
  const now = Date.now(), tMax = pts[pts.length - 1].t, tMin = Z.range ? Math.max(now - Z.range, pts[0].t) : pts[0].t, span = Math.max(1, tMax - tMin);
  let vmin = Infinity, vmax = -Infinity; pts.forEach(p => keys.forEach(k => { if (p[k] != null) { vmin = Math.min(vmin, p[k]); vmax = Math.max(vmax, p[k]); } }));
  let lo = cfg.lo, hi = cfg.hi;
  if (hi == null) hi = lo === 0 ? niceCeil(vmax * 1.15) : Math.ceil(vmax + 2);
  if (lo == null) { lo = Math.floor(vmin - 2); if (hi - lo < 10) hi = lo + 10; }
  const pw = VW - PL - PR, ph = VH - PT - PB, X = t => PL + (t - tMin) / span * pw, Y = v => PT + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * ph;
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v); g += `<line class="gl" x1="${PL}" x2="${PL + pw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="gt" x="${PL + pw + 8}" y="${(y + 4).toFixed(1)}">${esc(cfg.fmt(v))}</text>`; }
  const secs = span <= 15 * 60e3;
  for (let i = 0; i <= 4; i++) { const t = tMin + span * i / 4, x = X(t); g += `<line class="gl v" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${PT}" y2="${PT + ph}"/><text class="gt" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}" x="${x.toFixed(1)}" y="${VH - 8}">${clock(t, secs)}</text>`; }
  cfg.series.forEach((sr, si) => {
    let d = '', first = null, last = null;
    pts.forEach(p => { if (p[sr.k] == null) return; const x = X(p.t).toFixed(1), y = Y(p[sr.k]).toFixed(1); d += (d ? 'L' : 'M') + x + ' ' + y; if (first === null) first = x; last = x; });
    if (!d) return;
    g += (si === 0 ? `<path class="area s0" d="${d}L${last} ${PT + ph}L${first} ${PT + ph}Z"/>` : '') + `<path class="ln s${si}" d="${d}"/>`;
  });
  g += `<g class="xh" hidden><line class="xv" y1="${PT}" y2="${PT + ph}"/><line class="xhz" x1="${PL}" x2="${PL + pw}"/><g class="xdots">${cfg.series.map((_, i) => `<circle class="xd s${i}" r="4"/>`).join('')}</g><g class="xtagy"><rect rx="3" height="18" width="${PR - 6}" x="${PL + pw + 2}" y="0"/><text x="${PL + pw + 8}" y="13"></text></g><g class="xtagx"><rect rx="3" height="18" width="76" y="${VH - PB + 3}" x="0"/><text y="${VH - PB + 16}" text-anchor="middle"></text></g></g>`;
  plot.innerHTML = `<svg class="zc-svg" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="${esc(cfg.title)} over time">${g}</svg>`;
  Z.geo = { pts, keys, tMin, span, lo, hi, pw, ph, X, Y, secs, cfg };
  const covered = Math.round((tMax - pts[0].t) / 1000);
  $('#zc-note').textContent = (Z.range && (now - pts[0].t) < Z.range * 0.9 ? 'History so far: ' + STK.dur(covered) + '. It keeps growing while the dashboard is open. ' : '') + 'Move over the graph to read exact values.';
  if (Z.hoverT != null) crosshair(null, null, Z.hoverT); else readout(null);
}
function readout(p) {
  const el = $('#zc-read'), id = STK.sel(), h = id && M.hist[id], cfg = ZOOM[Z.key]; if (!el || !cfg) return;
  const q = p || (h && h.log[h.log.length - 1]);
  if (!q) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="zr-t">${p ? clock(q.t, true) : 'Now'}</span>` + cfg.series.map((sr, i) => `<span class="zr-v s${i}"><i></i>${esc(sr.name)} <b>${q[sr.k] != null ? esc(cfg.fmt(q[sr.k])) : '--'}</b></span>`).join('');
}
/* Red dotted guide lines, like a trading chart: the vertical line snaps to the nearest reading, the horizontal one follows the pointer. */
const showXh = (el, on) => { if (on) el.removeAttribute('hidden'); else el.setAttribute('hidden', ''); };
function crosshair(cx, cy, keepT) {
  const G = Z.geo, svg = $('.zc-svg'); if (!G || !svg) return;
  const xh = $('.xh', svg), r = svg.getBoundingClientRect(); if (!r.width) return;
  let t, vy = null;
  if (keepT != null) { t = keepT; vy = Z.hoverY; }
  else { const x = (cx - r.left) / r.width * VW; if (x < PL - 6 || x > PL + G.pw + 6) { Z.hoverT = null; showXh(xh, false); readout(null); return; } t = G.tMin + Math.min(1, Math.max(0, (x - PL) / G.pw)) * G.span; vy = (cy - r.top) / r.height * VH; }
  let lo = 0, hi = G.pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (G.pts[m].t < t) lo = m; else hi = m; }
  const p = Math.abs(G.pts[lo].t - t) <= Math.abs(G.pts[hi].t - t) ? G.pts[lo] : G.pts[hi];
  Z.hoverT = p.t; Z.hoverY = vy;
  const x = G.X(p.t); vy = Math.min(PT + G.ph, Math.max(PT, vy == null ? G.Y(p[G.keys[0]] || G.lo) : vy));
  showXh(xh, true);
  const set = (el, o) => Object.keys(o).forEach(k => el.setAttribute(k, o[k]));
  set($('.xv', xh), { x1: x.toFixed(1), x2: x.toFixed(1) }); set($('.xhz', xh), { y1: vy.toFixed(1), y2: vy.toFixed(1) });
  $$('.xd', xh).forEach((c, i) => { const v = p[G.keys[i]]; c.style.display = v == null ? 'none' : ''; if (v != null) set(c, { cx: x.toFixed(1), cy: G.Y(v).toFixed(1) }); });
  const val = G.lo + (1 - (vy - PT) / G.ph) * (G.hi - G.lo), ty = $('.xtagy', xh), tx = $('.xtagx', xh);
  set($('rect', ty), { y: (vy - 9).toFixed(1) }); set($('text', ty), { y: (vy + 4).toFixed(1) }); $('text', ty).textContent = G.cfg.fmt(val);
  const bx = Math.min(VW - PR - 76 + 36, Math.max(PL, x - 38)); set($('rect', tx), { x: bx.toFixed(1) }); set($('text', tx), { x: (bx + 38).toFixed(1) }); $('text', tx).textContent = clock(p.t, true);
  readout(p);
}
const zpt = e => { const svg = $('.zc-svg'); if (!svg) return; crosshair(e.clientX, e.clientY); };
document.addEventListener('pointermove', e => { if (Z.open && e.target.closest && e.target.closest('.zc-svg')) zpt(e); });
document.addEventListener('pointerdown', e => { if (Z.open && e.target.closest && e.target.closest('.zc-svg')) { try { e.target.closest('.zc-svg').setPointerCapture(e.pointerId); } catch (er) {} zpt(e); } });
document.addEventListener('pointerleave', e => { if (Z.open && e.target.closest && e.target.closest('.zc-svg') && e.pointerType === 'mouse') { Z.hoverT = null; const x = $('.xh'); if (x) showXh(x, false); readout(null); } }, true);
document.addEventListener('click', e => {
  const d = dlg(); if (!d) return;
  if (e.target === d || e.target.closest('#zc-close')) return d.close();
  const r = e.target.closest('[data-zr]'); if (r) { Z.range = Number(r.dataset.zr); STK.store.set('mzrange', Z.range); Z.hoverT = null; return paintZoom(true); }
  const c = e.target.closest('#view-monitor .mon-card[data-zoom]'); if (c) openZoom(c.dataset.zoom);
});
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.mon-card[data-zoom]')) { e.preventDefault(); openZoom(e.target.dataset.zoom); } });
document.addEventListener('close', e => { if (e.target.id === 'dlg-chart') { Z.open = false; Z.hoverT = null; } }, true);

document.addEventListener('click', e => {
  const t = e.target.closest('#view-monitor button'); if (!t) return;
  if (t.dataset.mtab) return setTab(t.dataset.mtab);
  if ('usageReload' in t.dataset) return loadUsage();
  if (t.id === 'perm-go') { const v = $('#perm-app').value.trim(); if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(v)) return STK.toast('Choose an app from the list.', 'bad'); return showPerms(v); }
});
document.addEventListener('change', async e => {
  const c = e.target.closest('input[data-perm]'); if (!c) return;
  c.disabled = true;
  try { await STK.post('/perms', { serial: STK.sel(), package: M.permPkg, permission: c.dataset.perm, grant: c.checked }); const tile = c.closest('.tg'); tile.classList.toggle('on', c.checked); $('small', tile).textContent = c.checked ? 'Allowed' : 'Not allowed'; STK.flash(tile, true); }
  catch (er) { c.checked = !c.checked; STK.fail(er); }
  c.disabled = false;
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'perm-app') $('#perm-go').click(); });
STK.views.monitor = { onShow() { startBg(); setTab(M.tab); } };
STK.on('view', v => { if (v !== 'monitor') stop(); });
STK.on('device-changed', () => { M.permApps = null; M.permPkg = ''; if (Z.open) dlg().close(); if (state.view === 'monitor') setTab(M.tab); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view === 'monitor' && M.tab === 'live') sample(); });
})();
