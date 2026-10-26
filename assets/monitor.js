/* Monitor: live CPU, memory, network, temperature and top apps; usage; access and permissions. */
(() => {
'use strict';
const { $, $$, esc, icon, bytes, state } = STK;
const M = { tab: STK.store.get('mtab', 'live'), timer: null, hist: {}, busy: false, alerted: 0, usage: null, battery: null, access: null, perms: null, permPkg: '', permApps: null };
const N = 60;
const nice = p => (STK.niceApp ? STK.niceApp(p) : p);
const root = () => $('#mon-root');
const hist = id => M.hist[id] || (M.hist[id] = { cpu: [], mem: [], rx: [], tx: [], temp: [], bat: [], last: null });

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
    ${['cpu:Processor', 'mem:Memory', 'net:Network', 'temp:Temperature'].map(x => { const [k, l] = x.split(':'); return `<section class="panel mon-card" id="mc-${k}" data-k="${k}" tabindex="0" role="button" aria-label="${l} history, open large graph"><header><span>${l}</span><b id="mv-${k}">--</b></header><div id="mg-${k}" class="mon-chart"></div><small id="ms-${k}" class="hint"></small></section>`; }).join('')}
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
async function sample() {
  if (M.busy || state.view !== 'monitor' || M.tab !== 'live' || document.hidden) return;
  const id = STK.sel(); if (!id) return;
  M.busy = true;
  try {
    const r = await STK.api('/monitor?id=' + encodeURIComponent(id), { timeout: 25000 });
    const h = hist(id), push = (a, v) => { a.push(v); if (a.length > N) a.shift(); };
    push(h.cpu, r.cpu); push(h.mem, r.memPct); push(h.rx, r.rxBps); push(h.tx, r.txBps); push(h.temp, r.tempC != null ? r.tempC : r.batteryTempC); h.last = r;
    lhPush(id, r);
    paintLive(); thermal(r); if (CM.el) drawChart();
  } catch (e) { if (!e.network) { const a = $('#mon-alerts'); if (a) a.textContent = e.message; } }
  M.busy = false;
}
function thermal(r) {
  const t = Math.max(r.tempC || 0, r.batteryTempC || 0);
  const box = $('#mon-alerts'); if (!box) return;
  if (t >= 45) {
    box.innerHTML = `<div class="alertline bad">${icon('alert')}<b>The phone is hot (${t.toFixed(0)} °C).</b> Let it cool, stop recording or lower the frame rate.</div>`;
    if (Date.now() - M.alerted > 10 * 60 * 1000) { M.alerted = Date.now(); STK.toast('The phone is running hot: ' + t.toFixed(0) + ' °C.', 'bad'); STK.notify && STK.notify('Phone is hot', t.toFixed(0) + ' °C', 'heat'); }
  } else box.innerHTML = `<div class="alertline ok">${icon('check')}<b>All normal.</b> Phone temperature ${t ? t.toFixed(0) + ' °C' : 'unknown'}.</div>`;
}
function start() { stop(); sample(); M.timer = setInterval(sample, 2200); }
function stop() { clearInterval(M.timer); M.timer = null; closeChart(true); }


/* ---------- long history and big graph ---------- */
const DAY = 24 * 3600 * 1000, KEYS = ['cpu', 'mem', 'rx', 'tx', 'temp'];
const LH = { data: {}, saved: 0 };
const lkey = id => 'stk-monhist:' + id;
function lhGet(id) {
  if (LH.data[id]) return LH.data[id];
  let arr = [];
  try { const raw = localStorage.getItem(lkey(id)); if (raw) arr = JSON.parse(raw).filter(p => p && p.t > Date.now() - DAY); } catch (e) { arr = []; }
  return (LH.data[id] = arr);
}
function lhCompact(arr) {
  const cut = Date.now() - 3600 * 1000, out = [];
  let bucket = null;
  for (const p of arr) {
    if (p.t >= cut) { if (bucket) { out.push(bucket.done()); bucket = null; } out.push(p); continue; }
    const b = Math.floor(p.t / 30000);
    if (!bucket || bucket.b !== b) { if (bucket) out.push(bucket.done()); bucket = mkBucket(b); }
    bucket.add(p);
  }
  if (bucket) out.push(bucket.done());
  return out;
}
function mkBucket(b) {
  const sum = {}, n = {}; KEYS.forEach(k => { sum[k] = 0; n[k] = 0; });
  return { b, add(p) { KEYS.forEach(k => { if (p[k] != null && isFinite(p[k])) { sum[k] += p[k]; n[k]++; } }); }, done() { const o = { t: this.tc != null ? this.tc : b * 30000 + 15000 }; KEYS.forEach(k => { o[k] = n[k] ? sum[k] / n[k] : null; }); return o; } };
}
function lhPush(id, r) {
  const arr = lhGet(id), now = Date.now();
  arr.push({ t: now, cpu: r.cpu, mem: r.memPct, rx: r.rxBps, tx: r.txBps, temp: r.tempC != null ? r.tempC : r.batteryTempC });
  if (now - LH.saved > 30000) {
    LH.saved = now;
    const c = lhCompact(arr.filter(p => p.t > now - DAY)); LH.data[id] = c;
    try { localStorage.setItem(lkey(id), JSON.stringify(c.map(p => { const o = { t: Math.round(p.t) }; KEYS.forEach(k => { o[k] = p[k] == null ? null : Math.round(p[k] * 10) / 10; }); return o; }))); } catch (e) { /* storage full or blocked: keep memory copy */ }
  }
}
const CHARTS = {
  cpu: { title: 'Processor', series: [{ k: 'cpu', cls: 'a', name: 'CPU' }], fmt: v => v.toFixed(0) + '%', lo: 0, hi: 100 },
  mem: { title: 'Memory', series: [{ k: 'mem', cls: 'a', name: 'Memory' }], fmt: v => v.toFixed(0) + '%', lo: 0, hi: 100 },
  net: { title: 'Network', series: [{ k: 'rx', cls: 'a', name: 'Down' }, { k: 'tx', cls: 'b', name: 'Up' }], fmt: v => STK.rate(v), lo: 0, hi: null },
  temp: { title: 'Temperature', series: [{ k: 'temp', cls: 'a', name: 'Temp' }], fmt: v => v.toFixed(1) + ' °C', lo: null, hi: null }
};
const PERIODS = [['5m', 5 * 60e3, '5 min'], ['30m', 30 * 60e3, '30 min'], ['1h', 3600e3, '1 hour'], ['6h', 6 * 3600e3, '6 hours'], ['24h', DAY, '24 hours']];
const CM = { el: null, k: null, per: STK.store.get('mper', '30m'), pts: [], geo: null, hx: null };
const fmtT = (t, span) => { const d = new Date(t); const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); return span <= 6 * 60e3 ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : (span > DAY * .9 ? d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + hm : hm); };
function niceRange(lo, hi) { if (!(hi > lo)) { hi = lo + 1; } const pad = (hi - lo) * .12; return [lo - pad, hi + pad]; }
function bucketPts(pts, t0, t1, n) {
  if (pts.length <= n * 1.5) return pts;
  const w = (t1 - t0) / n, out = []; let cur = null, bi = null;
  for (const p of pts) {
    const bx = Math.floor((p.t - t0) / w);
    if (bx !== bi) { if (cur) out.push(cur.done()); cur = mkBucket(0); bi = bx; cur.tc = t0 + (bx + .5) * w; }
    cur.add(p);
  }
  if (cur) out.push(cur.done());
  return out;
}
function openChart(k) {
  if (!CHARTS[k]) return;
  closeChart(true);
  CM.k = k; CM.hx = null;
  const c = CHARS_META(k);
  const el = document.createElement('div'); el.className = 'cm'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', c.title + ' history');
  el.innerHTML = `<div class="cm-box"><div class="cm-head"><h3>${esc(c.title)}</h3><span class="cm-now" id="cm-now"></span><span class="grow"></span><div class="cm-per" id="cm-per">${PERIODS.map(p => `<button type="button" data-per="${p[0]}" class="${p[0] === CM.per ? 'is-active' : ''}">${p[2]}</button>`).join('')}</div><button class="btn sm" type="button" id="cm-close">${icon('x', 'sm')}<span>Close</span></button></div>
    <div class="cm-plot" id="cm-plot"><div class="cm-tip" id="cm-tip"></div></div><div class="cm-stats" id="cm-stats"></div><p class="hint" style="margin-top:8px">Move over the graph to read exact values. History is kept for 24 hours while this page has been open on this PC.</p></div>`;
  document.body.appendChild(el); CM.el = el;
  requestAnimationFrame(() => el.classList.add('on'));
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('#cm-close')) return closeChart(); const b = e.target.closest('[data-per]'); if (b) { CM.per = b.dataset.per; STK.store.set('mper', CM.per); $$('#cm-per button', el).forEach(x => x.classList.toggle('is-active', x === b)); CM.hx = null; drawChart(); } });
  const plot = $('#cm-plot', el);
  const move = e => { const r = plot.getBoundingClientRect(); CM.hx = e.clientX - r.left; CM.hy = e.clientY - r.top; cross(); };
  plot.addEventListener('pointermove', move); plot.addEventListener('pointerdown', e => { try { plot.setPointerCapture(e.pointerId); } catch (er) {} move(e); });
  plot.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { CM.hx = null; cross(); } });
  if (window.ResizeObserver) { CM.ro = new ResizeObserver(() => drawChart()); CM.ro.observe(plot); }
  drawChart();
}
const CHARS_META = k => CHARTS[k];
function closeChart(quick) {
  if (!CM.el) return; const el = CM.el; CM.el = null; CM.k = null;
  if (CM.ro) { CM.ro.disconnect(); CM.ro = null; }
  if (quick) return el.remove();
  el.classList.remove('on'); setTimeout(() => el.remove(), 220);
}
function drawChart() {
  if (!CM.el) return;
  const c = CHARTS[CM.k], plot = $('#cm-plot', CM.el), id = STK.sel(); if (!plot || !id) return;
  const per = PERIODS.find(p => p[0] === CM.per) || PERIODS[1], now = Date.now(), t0 = now - per[1];
  const W = Math.max(280, plot.clientWidth), H = Math.max(200, plot.clientHeight), L = 10, R = 64, T = 14, B = 26, pw = W - L - R, ph = H - T - B;
  const all = lhGet(id).filter(p => p.t >= t0);
  const pts = bucketPts(all, t0, now, Math.floor(pw / 2));
  CM.pts = pts;
  const vals = []; pts.forEach(p => c.series.forEach(s => { if (p[s.k] != null && isFinite(p[s.k])) vals.push(p[s.k]); }));
  let lo = c.lo, hi = c.hi;
  if (vals.length) { const mn = Math.min(...vals), mx = Math.max(...vals); if (lo == null) { [lo, hi] = niceRange(mn, mx); } else if (hi == null) { hi = Math.max(1, mx * 1.15); } } else { lo = lo == null ? 0 : lo; hi = hi == null ? 100 : hi; }
  const X = t => L + (t - t0) / (now - t0) * pw, Y = v => T + ph - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1) * ph;
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v); g += `<line class="cm-grid" x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text x="${W - R + 8}" y="${(y + 4).toFixed(1)}">${esc(c.fmt(v))}</text>`; }
  for (let i = 0; i <= 5; i++) { const t = t0 + (now - t0) * i / 5, x = X(t); g += `<line class="cm-grid" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${T}" y2="${T + ph}" opacity=".45"/><text x="${Math.min(W - R - 24, Math.max(L + 4, x - 18)).toFixed(1)}" y="${H - 8}">${esc(fmtT(t, per[1]))}</text>`; }
  const gap = Math.max(per[1] / 60, 45000);
  let lines = '';
  c.series.forEach(s => {
    const segs = []; let cur = null, prev = null;
    pts.forEach(p => { const v = p[s.k]; if (v == null || !isFinite(v)) { cur = null; prev = null; return; } if (!cur || p.t - prev > gap) { cur = []; segs.push(cur); } cur.push([X(p.t), Y(v)]); prev = p.t; });
    segs.forEach(sg => {
      const d = sg.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('');
      if (sg.length > 1) lines += `<path class="cm-area ${s.cls}" d="${d}L${sg[sg.length - 1][0].toFixed(1)} ${T + ph}L${sg[0][0].toFixed(1)} ${T + ph}Z"/>`;
      lines += `<path class="cm-ln ${s.cls}" d="${d}${sg.length === 1 ? 'h.1' : ''}"/>`;
    });
  });
  CM.geo = { W, H, L, R, T, B, pw, ph, X, Y, t0, now, per: per[1], lo, hi };
  plot.querySelectorAll('svg, .cm-empty').forEach(n => n.remove());
  plot.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${g}${lines}<g class="cm-cross" id="cm-cross" visibility="hidden"><line id="cm-vx" y1="${T}" y2="${T + ph}"/><line id="cm-hy" x1="${L}" x2="${W - R}"/><g id="cm-dots"></g></g><g class="cm-tag" id="cm-tagy" visibility="hidden"><rect x="${W - R + 2}" y="0" width="${R - 4}" height="18" rx="4"/><text x="${W - R + 8}" y="13"></text></g><g class="cm-tag" id="cm-tagx" visibility="hidden"><rect y="${H - B + 3}" width="96" height="18" rx="4"/><text y="${H - B + 16}"></text></g></svg>`);
  if (!pts.length) plot.insertAdjacentHTML('beforeend', '<div class="cm-empty"><div><b>Collecting data...</b><br>Keep the Monitor page open; the graph fills as samples arrive.</div></div>');
  const lastOf = k => { for (let i = pts.length - 1; i >= 0; i--) if (pts[i][k] != null && isFinite(pts[i][k])) return pts[i][k]; return null; };
  $('#cm-now', CM.el).textContent = c.series.map(s => { const v = lastOf(s.k); return v != null ? (c.series.length > 1 ? (s.k === 'rx' ? '↓ ' : '↑ ') : '') + c.fmt(v) : '--'; }).join('  ');
  $('#cm-stats', CM.el).innerHTML = c.series.map(s => { const v = pts.map(p => p[s.k]).filter(x => x != null && isFinite(x)); if (!v.length) return ''; const avg = v.reduce((a, b) => a + b, 0) / v.length; return `<span>${c.series.length > 1 ? esc(s.name) + ': ' : ''}min <b>${esc(c.fmt(Math.min(...v)))}</b> · avg <b>${esc(c.fmt(avg))}</b> · max <b>${esc(c.fmt(Math.max(...v)))}</b></span>`; }).join('');
  cross();
}
function cross() {
  const G = CM.geo, el = CM.el; if (!G || !el) return;
  const cr = $('#cm-cross', el), tip = $('#cm-tip', el), ty = $('#cm-tagy', el), tx = $('#cm-tagx', el); if (!cr) return;
  const off = () => { cr.setAttribute('visibility', 'hidden'); ty.setAttribute('visibility', 'hidden'); tx.setAttribute('visibility', 'hidden'); tip.style.opacity = 0; };
  if (CM.hx == null || !CM.pts.length) return off();
  const c = CHARTS[CM.k], t = G.t0 + (CM.hx - G.L) / G.pw * (G.now - G.t0);
  if (CM.hx < G.L || CM.hx > G.W - G.R) return off();
  let lo = 0, hi = CM.pts.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (CM.pts[m].t < t) lo = m + 1; else hi = m; }
  let p = CM.pts[lo]; if (lo > 0 && Math.abs(CM.pts[lo - 1].t - t) < Math.abs(p.t - t)) p = CM.pts[lo - 1];
  const px = G.X(p.t), main = c.series[0], mv = p[main.k];
  const py = mv != null && isFinite(mv) ? G.Y(mv) : Math.max(G.T, Math.min(G.T + G.ph, CM.hy || G.T));
  const hy = Math.max(G.T, Math.min(G.T + G.ph, CM.hy == null ? py : CM.hy));
  cr.setAttribute('visibility', 'visible');
  const vx = $('#cm-vx', el), hl = $('#cm-hy', el);
  vx.setAttribute('x1', px.toFixed(1)); vx.setAttribute('x2', px.toFixed(1)); hl.setAttribute('y1', hy.toFixed(1)); hl.setAttribute('y2', hy.toFixed(1));
  $('#cm-dots', el).innerHTML = c.series.map(s => p[s.k] != null && isFinite(p[s.k]) ? `<circle cx="${px.toFixed(1)}" cy="${G.Y(p[s.k]).toFixed(1)}" r="4"/>` : '').join('');
  const val = G.lo + (G.hi - G.lo) * (1 - (hy - G.T) / G.ph);
  ty.setAttribute('visibility', 'visible'); ty.firstElementChild.setAttribute('y', (hy - 9).toFixed(1)); ty.lastElementChild.setAttribute('y', (hy + 4).toFixed(1)); ty.lastElementChild.textContent = c.fmt(val);
  const label = fmtT(p.t, G.per), bx = Math.max(G.L, Math.min(G.W - G.R - 96, px - 48));
  tx.setAttribute('visibility', 'visible'); tx.firstElementChild.setAttribute('x', bx.toFixed(1)); tx.lastElementChild.setAttribute('x', (bx + 6).toFixed(1)); tx.lastElementChild.textContent = label;
  tip.innerHTML = `<b>${esc(label)}</b>` + c.series.map(s => `<div>${c.series.length > 1 ? esc(s.name) + ' ' : ''}<span>${p[s.k] != null && isFinite(p[s.k]) ? esc(c.fmt(p[s.k])) : '--'}</span></div>`).join('');
  tip.style.opacity = 1;
  const tw = tip.offsetWidth, th = tip.offsetHeight; let lx = px + 14; if (lx + tw > G.W - G.R) lx = px - tw - 14; tip.style.left = Math.max(4, lx) + 'px'; tip.style.top = Math.max(4, Math.min(G.H - th - G.B - 4, hy - th - 12 < 4 ? hy + 14 : hy - th - 12)) + 'px';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && CM.el) { e.stopPropagation(); closeChart(); } }, true);
document.addEventListener('click', e => { const c = e.target.closest('#view-monitor .mon-card[data-k]'); if (c) openChart(c.dataset.k); });
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.mon-card[data-k]')) { e.preventDefault(); openChart(e.target.dataset.k); } });

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
  STK.setHtml(root(), `<div class="two"><section class="panel"><header class="panel-head"><h2>Screen time today</h2><span class="hint">${esc(id)}</span></header>${u.apps.length ? bars(u.apps.slice(0, 12), x => x.ms, x => dur(x.ms)) : `<p class="hint">${esc(u.note || 'No usage data.')}</p>`}</section>
    <section class="panel"><header class="panel-head"><h2>Battery use by app</h2><span class="hint">${b.totalMah ? b.totalMah + ' mAh in the list' : ''}</span></header>${b.apps.length ? bars(b.apps.slice(0, 12), x => x.mah, x => x.mah + ' mAh') : `<p class="hint">${esc(b.note || 'No battery data.')}</p>`}</section></div>
    <section class="panel"><header class="panel-head"><h2>What has access to the phone</h2><button class="btn sm" id="usage-reload">${icon('refresh', 'sm')}<span>Reload</span></button></header>
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

document.addEventListener('click', e => {
  const t = e.target.closest('#view-monitor button'); if (!t) return;
  if (t.dataset.mtab) return setTab(t.dataset.mtab);
  if (t.id === 'usage-reload') return loadUsage();
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
STK.views.monitor = { onShow() { setTab(M.tab); } };
STK.on('view', v => { if (v !== 'monitor') stop(); });
STK.on('device-changed', () => { closeChart(true); M.permApps = null; M.permPkg = ''; if (state.view === 'monitor') setTab(M.tab); });
window.addEventListener('pagehide', () => { try { const id = STK.sel(); if (id) { LH.saved = 0; } } catch (e) {} });
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view === 'monitor' && M.tab === 'live') sample(); });
})();
