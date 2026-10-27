/* Studio 3.8 building blocks: history store, interactive charts (inline and full size), count-up numbers,
   rings, gauges, sparklines, modal, ripple and CSV download. Used by studio.js. No dependencies. */
(() => {
'use strict';
const { $, $$, esc, icon } = STK;
const SX = STK.sx = {};
const DAY = 24 * 3600 * 1000;
SX.reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const num = v => v != null && isFinite(v);
SX.num = num;
SX.clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- history: 24 hours of samples per phone, kept in this browser ---------- */
const hkey = id => 'stk-sxh:' + id;
class Hist {
  constructor(id) {
    this.id = id; this.saved = 0; this.a = [];
    try { const raw = localStorage.getItem(hkey(id)); if (raw) this.a = JSON.parse(raw).filter(p => p && p.t > Date.now() - DAY); } catch (e) { this.a = []; }
  }
  push(s) { this.a.push(s); if (Date.now() - this.saved > 30000) this.save(); }
  range(t0, t1) { const out = []; for (const p of this.a) if (p.t >= t0 && p.t <= (t1 || Infinity)) out.push(p); return out; }
  last() { return this.a[this.a.length - 1] || null; }
  clear() { this.a = []; try { localStorage.removeItem(hkey(this.id)); } catch (e) { /* ignore */ } }
  compact() {
    const now = Date.now(), out = []; let bucket = null;
    const flush = () => { if (bucket) { out.push(bucket.done()); bucket = null; } };
    for (const p of this.a) {
      if (p.t < now - DAY) continue;
      const age = now - p.t; if (age < 3600e3) { flush(); out.push(p); continue; }
      const w = age > 6 * 3600e3 ? 120e3 : 30e3, b = Math.floor(p.t / w);
      if (!bucket || bucket.b !== b || bucket.w !== w) { flush(); bucket = mk(b, w); }
      bucket.add(p);
    }
    flush(); this.a = out;
  }
  save() {
    this.saved = Date.now(); this.compact();
    try { localStorage.setItem(hkey(this.id), JSON.stringify(this.a.map(p => { const o = {}; for (const k in p) o[k] = k === 't' ? Math.round(p.t) : (num(p[k]) ? Math.round(p[k] * 10) / 10 : null); return o; }))); } catch (e) { /* storage full or blocked: keep the memory copy */ }
  }
}
function mk(b, w) {
  const sum = {}, n = {};
  return { b, w, add(p) { for (const k in p) if (k !== 't' && num(p[k])) { sum[k] = (sum[k] || 0) + p[k]; n[k] = (n[k] || 0) + 1; } }, done() { const o = { t: b * w + w / 2 }; for (const k in sum) o[k] = sum[k] / n[k]; return o; } };
}
const stores = {};
SX.hist = id => stores[id] || (stores[id] = new Hist(id));
window.addEventListener('pagehide', () => { for (const k in stores) stores[k].save(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const k in stores) stores[k].save(); });

/* ---------- formatting ---------- */
SX.f = {
  c1: v => v.toFixed(1) + ' °C', c0: v => Math.round(v) + ' °C', pct: v => Math.round(v) + '%', pct1: v => v.toFixed(1) + '%',
  fps: v => Math.round(v) + ' fps', mhz: v => v >= 1000 ? (v / 1000).toFixed(2) + ' GHz' : Math.round(v) + ' MHz', ma: v => Math.round(v) + ' mA',
  ms: v => Math.round(v) + ' ms', gb: v => v.toFixed(1) + ' GB', w: v => v.toFixed(1) + ' W'
};
const COLORS = ['var(--accent)', 'var(--focus)', 'var(--ok)', 'var(--rec)', '#b794f6', '#4dd0e1', '#f6ad55', '#90cdf4', '#fbb6ce', '#9ae6b4'];
SX.color = i => COLORS[i % COLORS.length];
const fmtT = (t, span) => { const d = new Date(t); return span <= 15 * 60e3 ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : (span > DAY * .9 ? d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' : '') + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
SX.PERIODS = [['5m', 5 * 60e3, '5 min'], ['15m', 15 * 60e3, '15 min'], ['1h', 3600e3, '1 hour'], ['6h', 6 * 3600e3, '6 hours'], ['24h', DAY, '24 hours']];

function buckets(pts, t0, t1, n) {
  if (pts.length <= n * 1.5) return pts;
  const w = (t1 - t0) / n, out = []; let cur = null, bi = null;
  for (const p of pts) { const bx = Math.floor((p.t - t0) / w); if (bx !== bi) { if (cur) out.push(cur.done()); cur = mk(bx, w); bi = bx; } cur.add(p); }
  if (cur) out.push(cur.done());
  return out;
}
const pctile = (arr, q) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
SX.stats = vals => { const v = vals.filter(num); if (!v.length) return null; return { min: Math.min(...v), max: Math.max(...v), avg: v.reduce((a, b) => a + b, 0) / v.length, p95: pctile(v, .95), last: v[v.length - 1], n: v.length }; };

/* ---------- sparkline (tiny, no axes) ---------- */
SX.spark = function (vals, { min = null, max = null, color = 'var(--accent)', mark = null } = {}) {
  const v = vals.filter(num);
  if (v.length < 2) return '<svg class="sx-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="100" y1="26" y2="26" class="sx-spark-empty"/></svg>';
  let lo = min != null ? Math.min(min, ...v) : Math.min(...v), hi = max != null ? Math.max(max, ...v) : Math.max(...v);
  if (hi - lo < 1e-6) { hi = lo + 1; }
  const Y = x => 29 - (x - lo) / (hi - lo) * 26, n = vals.length;
  let d = '', fx = null, lx = 0;
  vals.forEach((x, i) => { if (!num(x)) return; const px = (i / Math.max(1, n - 1) * 100).toFixed(2); d += (d ? 'L' : 'M') + px + ' ' + Y(x).toFixed(2); if (fx === null) fx = px; lx = px; });
  const ml = mark != null && mark >= lo && mark <= hi ? `<line x1="0" x2="100" y1="${Y(mark).toFixed(1)}" y2="${Y(mark).toFixed(1)}" class="sx-spark-mark"/>` : '';
  return `<svg class="sx-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">${ml}<path d="${d}L${lx} 32L${fx} 32Z" style="fill:${color}" class="sx-spark-area"/><path d="${d}" style="stroke:${color}" class="sx-spark-ln"/></svg>`;
};

/* ---------- ring and arc gauge ---------- */
SX.ring = (v, color, big, small) => `<svg class="sx-ring" viewBox="0 0 120 120" role="img" aria-label="${esc(big + ' ' + small)}"><defs><linearGradient id="sxg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:${color}"/><stop offset="1" style="stop-color:${color};stop-opacity:.55"/></linearGradient></defs><circle cx="60" cy="60" r="52" class="sx-ring-bg"/><circle cx="60" cy="60" r="52" class="sx-ring-fg" style="stroke:url(#sxg);stroke-dasharray:${(SX.clamp(v, 0, 100) / 100 * 326.7).toFixed(1)} 326.7"/><text x="60" y="63" text-anchor="middle" class="sx-ring-n">${esc(big)}</text><text x="60" y="82" text-anchor="middle" class="sx-ring-s">${esc(small)}</text></svg>`;
/* 240-degree arc gauge. Build once, then call SX.arcSet to animate. */
const ARC_LEN = 2 * Math.PI * 44 * (240 / 360);
SX.arc = () => `<svg class="sx-arc" viewBox="0 0 120 100" aria-hidden="true"><path class="sx-arc-bg" d="${arcPath()}" /><path class="sx-arc-fg" d="${arcPath()}" style="stroke-dasharray:${ARC_LEN.toFixed(1)};stroke-dashoffset:${ARC_LEN.toFixed(1)}"/></svg>`;
function arcPath() { const r = 44, cx = 60, cy = 56, a0 = (150) * Math.PI / 180, a1 = (390) * Math.PI / 180; const p = a => [cx + r * Math.cos(a), cy + r * Math.sin(a)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; }
SX.arcSet = (el, pct, color) => { const fg = $('.sx-arc-fg', el); if (!fg) return; fg.style.strokeDashoffset = (ARC_LEN * (1 - SX.clamp(pct, 0, 100) / 100)).toFixed(1); if (color) fg.style.stroke = color; };

/* ---------- animated number ---------- */
SX.setNum = function (el, to, { dec = 0, pre = '', suf = '' } = {}) {
  if (!el) return;
  if (!num(to)) { el._n = null; if (el.textContent !== '-') el.textContent = '-'; return; }
  const from = num(el._n) ? el._n : to, show = v => pre + v.toFixed(dec) + suf;
  el._n = to;
  if (SX.reduced() || from === to || !el.isConnected) { el.textContent = show(to); return; }
  cancelAnimationFrame(el._raf); const t0 = performance.now(), dur = 450;
  const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = show(from + (to - from) * e); if (k < 1) el._raf = requestAnimationFrame(step); };
  el._raf = requestAnimationFrame(step);
};
SX.tick = el => { if (!el || SX.reduced()) return; el.classList.remove('sx-tick'); void el.offsetWidth; el.classList.add('sx-tick'); };

/* ---------- download ---------- */
SX.download = function (name, text, mime = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};
SX.csv = (rows, cols) => [cols.map(c => c[1]).join(',')].concat(rows.map(r => cols.map(c => { const v = c[2] ? c[2](r) : r[c[0]]; return v == null ? '' : String(v).includes(',') ? '"' + v + '"' : v; }).join(','))).join('\n');

/* ---------- modal ---------- */
let openModal = null;
SX.modal = function (html, { cls = '', label = 'Details', onClose } = {}) {
  if (openModal) openModal.close(true);
  const prevFocus = document.activeElement;
  const el = document.createElement('div'); el.className = 'sx-modal ' + cls; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', label);
  el.innerHTML = `<div class="sx-modal-box" tabindex="-1">${html}</div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
  const box = $('.sx-modal-box', el);
  const api = {
    el, box,
    close(quick) { if (!el.isConnected) return; document.removeEventListener('keydown', key, true); openModal = null; if (onClose) onClose(); if (quick || SX.reduced()) el.remove(); else { el.classList.remove('on'); setTimeout(() => el.remove(), 200); } try { prevFocus && prevFocus.focus && prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  };
  const key = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return api.close(); }
    if (e.key === 'Tab') { const f = $$('button:not([disabled]), [href], input, select, [tabindex]:not([tabindex="-1"])', box).filter(x => x.offsetParent !== null); if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } return; }
    if (api.onKey && api.onKey(e)) { e.preventDefault(); }
    if (!/^(INPUT|SELECT|TEXTAREA)$/.test((e.target.tagName || ''))) e.stopPropagation();   // keep dashboard shortcuts quiet while a window is open
  };
  document.addEventListener('keydown', key, true);
  el.addEventListener('mousedown', e => { if (e.target === el) api.close(); });
  openModal = api;
  setTimeout(() => { const f = $('[data-autofocus]', box) || box; try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 30);
  return api;
};
SX.closeModal = () => { if (openModal) openModal.close(true); };
SX.isModalOpen = () => !!openModal;

/* ---------- ripple on buttons ---------- */
document.addEventListener('pointerdown', e => {
  const b = e.target.closest && e.target.closest('.sx-btn, .sx-tile, .sx-prof'); if (!b || b.disabled || SX.reduced()) return;
  const r = b.getBoundingClientRect(), s = document.createElement('span'); s.className = 'sx-ripple';
  const d = Math.max(r.width, r.height) * 1.6; s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.appendChild(s); setTimeout(() => s.remove(), 600);
}, { passive: true });

/* ---------- interactive chart ----------
   cfg: { series:[{k,name,color?,fmt?,hidden?}], fmt, lo, hi, thresholds:[{v,label,cls}], hist:()=>Hist, period, height, inline,
          rangeOf:(t0,t1)=>samples (overrides hist), onState }                                                            */
SX.Chart = class {
  constructor(host, cfg) {
    this.host = host; this.cfg = cfg; this.per = cfg.period || '15m'; this.zoom = null; this.hx = null; this.hy = null; this.pts = []; this.drag = null; this.paused = false;
    cfg.series.forEach((s, i) => { if (!s.color) s.color = SX.color(i); });
    host.classList.add('sx-chart'); host.innerHTML = `<div class="sx-plot" tabindex="0" role="img" aria-label="${esc(cfg.title || 'Graph')}. Move over it to read values."><div class="sx-tip"></div></div>`;
    this.plot = $('.sx-plot', host); this.tip = $('.sx-tip', host);
    const mv = e => { const r = this.plot.getBoundingClientRect(); this.hx = e.clientX - r.left; this.hy = e.clientY - r.top; if (this.drag) { this.drag.x1 = this.hx; } this.cross(); };
    this.plot.addEventListener('pointermove', mv);
    this.plot.addEventListener('pointerdown', e => { if (e.button) return; try { this.plot.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } mv(e); if (!cfg.inline && this.G) this.drag = { x0: this.hx, x1: this.hx }; });
    this.plot.addEventListener('pointerup', e => { if (this.drag) { const d = this.drag; this.drag = null; if (Math.abs(d.x1 - d.x0) > 12 && this.G) { const G = this.G, a = Math.min(d.x0, d.x1), b = Math.max(d.x0, d.x1); const ta = G.t0 + (a - G.L) / G.pw * (G.t1 - G.t0), tb = G.t0 + (b - G.L) / G.pw * (G.t1 - G.t0); this.zoom = [Math.max(G.t0, ta), Math.min(G.t1, tb)]; this.draw(); this.state(); } else this.cross(); } });
    this.plot.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !this.drag) { this.hx = null; this.cross(); } });
    this.plot.addEventListener('dblclick', () => this.resetZoom());
    this.plot.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); this.step(e.key === 'ArrowLeft' ? -1 : 1); } else if (e.key === 'Escape' && this.hx != null) { this.hx = null; this.cross(); } });
    if (window.ResizeObserver) { this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(this.plot); }
  }
  destroy() { if (this.ro) this.ro.disconnect(); this.ro = null; }
  state() { if (this.cfg.onState) this.cfg.onState(this); }
  setPeriod(p) { this.per = p; this.zoom = null; this.draw(); this.state(); }
  resetZoom() { if (!this.zoom) return; this.zoom = null; this.draw(); this.state(); }
  toggle(k) { const s = this.cfg.series.find(x => x.k === k); if (s) { s.hidden = !s.hidden; this.draw(); this.state(); } }
  step(dir) { if (!this.pts.length || !this.G) return; let i = this.hi == null ? this.pts.length - 1 : this.hi + dir; i = SX.clamp(i, 0, this.pts.length - 1); this.hx = this.G.X(this.pts[i].t); this.hy = null; this.cross(); }
  range() { if (this.cfg.fixedRange && !this.zoom) return this.cfg.fixedRange.slice(); const per = SX.PERIODS.find(p => p[0] === this.per) || SX.PERIODS[1], now = Date.now(); return this.zoom ? [this.zoom[0], this.zoom[1]] : [now - per[1], now]; }
  samples(t0, t1) { return this.cfg.rangeOf ? this.cfg.rangeOf(t0, t1) : this.cfg.hist().range(t0, t1); }
  draw() {
    const c = this.cfg, plot = this.plot; if (!plot || !plot.isConnected) return;
    const W = Math.max(240, plot.clientWidth), H = Math.max(c.inline ? 140 : 200, plot.clientHeight || c.height || 220);
    const L = 8, R = c.inline ? 54 : 66, T = 12, B = 24, pw = W - L - R, ph = H - T - B;
    const [t0, t1] = this.range();
    const raw = this.samples(t0, t1), pts = buckets(raw, t0, t1, Math.max(20, Math.floor(pw / 2.5)));
    this.pts = pts; this.hi = null;
    const vis = c.series.filter(s => !s.hidden);
    const vals = []; pts.forEach(p => vis.forEach(s => { if (num(p[s.k])) vals.push(p[s.k]); }));
    (c.thresholds || []).forEach(th => { if (num(th.v) && c.includeThresholds !== false && vals.length) vals.push(th.v); });
    let lo = c.lo, hi = c.hi;
    if (vals.length) { const mn = Math.min(...vals), mx = Math.max(...vals); if (lo == null) { const pad = Math.max((mx - mn) * .14, c.minSpan ? c.minSpan / 2 : .5); lo = mn - pad; hi = hi == null ? mx + pad : hi; } else if (hi == null) hi = Math.max(lo + 1, mx * 1.15); }
    else { lo = lo == null ? 0 : lo; hi = hi == null ? 100 : hi; }
    if (hi - lo < 1e-6) hi = lo + 1;
    const X = t => L + (t - t0) / (t1 - t0 || 1) * pw, Y = v => T + ph - (SX.clamp(v, lo, hi) - lo) / (hi - lo) * ph;
    const f = c.fmt || (v => String(Math.round(v * 10) / 10));
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, y = Y(v); g += `<line class="sx-grid" x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="sx-ax" x="${W - R + 8}" y="${(y + 4).toFixed(1)}">${esc(f(v))}</text>`; }
    const nx = Math.max(2, Math.min(6, Math.floor(pw / 120)));
    for (let i = 0; i <= nx; i++) { const t = t0 + (t1 - t0) * i / nx, x = X(t); g += `<line class="sx-grid v" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${T}" y2="${T + ph}"/><text class="sx-ax" x="${SX.clamp(x - 22, L, W - R - 44).toFixed(1)}" y="${H - 7}">${esc(fmtT(t, t1 - t0))}</text>`; }
    (c.thresholds || []).forEach(th => { if (!num(th.v) || th.v < lo || th.v > hi) return; const y = Y(th.v); g += `<line class="sx-th ${th.cls || ''}" x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="sx-th-t ${th.cls || ''}" x="${L + 4}" y="${(y - 4).toFixed(1)}">${esc(th.label || '')}</text>`; });
    const gap = Math.max((t1 - t0) / 40, 60e3);
    let lines = '', defs = '';
    vis.forEach((s, si) => {
      const segs = []; let cur = null, prev = null;
      pts.forEach(p => { const v = p[s.k]; if (!num(v)) { cur = null; return; } if (!cur || p.t - prev > gap) { cur = []; segs.push(cur); } cur.push([X(p.t), Y(v)]); prev = p.t; });
      const gid = 'sxa' + (this.uid || (this.uid = Math.random().toString(36).slice(2, 7))) + si;
      defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${s.color};stop-opacity:.32"/><stop offset="1" style="stop-color:${s.color};stop-opacity:0"/></linearGradient>`;
      segs.forEach(sg => {
        const d = sg.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('');
        if (sg.length > 1 && (vis.length === 1 || si === 0 || c.fillAll)) lines += `<path class="sx-area" fill="url(#${gid})" d="${d}L${sg[sg.length - 1][0].toFixed(1)} ${T + ph}L${sg[0][0].toFixed(1)} ${T + ph}Z"/>`;
        lines += `<path class="sx-ln" style="stroke:${s.color}" d="${d}${sg.length === 1 ? 'h.1' : ''}"/>`;
      });
    });
    // peak marker on the first visible series
    let peak = '';
    if (vis.length && !c.inline) { let best = null; pts.forEach(p => { const v = p[vis[0].k]; if (num(v) && (!best || v > best.v)) best = { v, t: p.t }; }); if (best && pts.length > 3) { const x = X(best.t), y = Y(best.v); peak = `<g class="sx-peak"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" style="stroke:${vis[0].color}"/><text x="${SX.clamp(x, 30, W - R - 30).toFixed(1)}" y="${Math.max(10, y - 9).toFixed(1)}" text-anchor="middle">max ${esc((vis[0].fmt || f)(best.v))}</text></g>`; } }
    this.G = { W, H, L, R, T, B, pw, ph, X, Y, t0, t1, lo, hi };
    plot.querySelectorAll('svg, .sx-empty').forEach(n => n.remove());
    plot.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><defs>${defs}</defs>${g}${lines}${peak}<rect class="sx-brush" id="sxbr" y="${T}" height="${ph}" visibility="hidden"/><g class="sx-cross" visibility="hidden"><line class="sx-vx" y1="${T}" y2="${T + ph}"/><line class="sx-hy" x1="${L}" x2="${W - R}"/><g class="sx-dots"></g></g><g class="sx-tag sx-tagy" visibility="hidden"><rect x="${W - R + 2}" width="${R - 4}" height="18" rx="4"/><text x="${W - R + 7}"></text></g></svg>`);
    if (!pts.length) plot.insertAdjacentHTML('beforeend', `<div class="sx-empty"><div><b>Collecting data...</b><br>The graph fills as readings arrive${this.zoom ? '' : '. Longer ranges fill over time'}.</div></div>`);
    this.cross();
  }
  cross() {
    const G = this.G, host = this.host; if (!G) return;
    const cr = $('.sx-cross', host), ty = $('.sx-tagy', host), tip = this.tip, br = $('.sx-brush', host); if (!cr) return;
    if (br) { if (this.drag) { const a = Math.max(G.L, Math.min(this.drag.x0, this.drag.x1)), b = Math.min(G.W - G.R, Math.max(this.drag.x0, this.drag.x1)); br.setAttribute('x', a); br.setAttribute('width', Math.max(0, b - a)); br.setAttribute('visibility', 'visible'); } else br.setAttribute('visibility', 'hidden'); }
    const off = () => { cr.setAttribute('visibility', 'hidden'); ty.setAttribute('visibility', 'hidden'); tip.style.opacity = 0; this.hi = null; if (this.cfg.onHover) this.cfg.onHover(null); };
    if (this.hx == null || !this.pts.length || this.hx < G.L || this.hx > G.W - G.R) return off();
    const t = G.t0 + (this.hx - G.L) / G.pw * (G.t1 - G.t0), P = this.pts;
    let lo = 0, hi = P.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (P[m].t < t) lo = m + 1; else hi = m; }
    let i = lo; if (i > 0 && Math.abs(P[i - 1].t - t) < Math.abs(P[i].t - t)) i--;
    this.hi = i; const p = P[i], px = G.X(p.t), vis = this.cfg.series.filter(s => !s.hidden), f = this.cfg.fmt || String;
    const main = vis.find(s => num(p[s.k])), py = main ? G.Y(p[main.k]) : G.T + G.ph / 2;
    const hy = SX.clamp(this.hy == null ? py : this.hy, G.T, G.T + G.ph);
    cr.setAttribute('visibility', 'visible');
    const vx = $('.sx-vx', cr), hl = $('.sx-hy', cr); vx.setAttribute('x1', px.toFixed(1)); vx.setAttribute('x2', px.toFixed(1)); hl.setAttribute('y1', hy.toFixed(1)); hl.setAttribute('y2', hy.toFixed(1));
    $('.sx-dots', cr).innerHTML = vis.map(s => num(p[s.k]) ? `<circle cx="${px.toFixed(1)}" cy="${G.Y(p[s.k]).toFixed(1)}" r="4.5" style="stroke:${s.color}"/>` : '').join('');
    const val = G.lo + (G.hi - G.lo) * (1 - (hy - G.T) / G.ph);
    ty.setAttribute('visibility', 'visible'); ty.firstElementChild.setAttribute('y', (hy - 9).toFixed(1)); ty.lastElementChild.setAttribute('y', (hy + 4).toFixed(1)); ty.lastElementChild.textContent = f(val);
    tip.innerHTML = `<b>${esc(fmtT(p.t, G.t1 - G.t0))}</b>` + vis.map(s => `<div><i style="background:${s.color}"></i>${esc(s.name)}<span>${num(p[s.k]) ? esc((s.fmt || f)(p[s.k])) : '-'}</span></div>`).join('');
    tip.style.opacity = 1;
    const tw = tip.offsetWidth, th = tip.offsetHeight; let lx = px + 14; if (lx + tw > G.W - G.R + 6) lx = px - tw - 14;
    tip.style.left = Math.max(4, lx) + 'px'; tip.style.top = Math.max(4, Math.min(G.H - th - G.B, hy - th - 12 < 4 ? hy + 14 : hy - th - 12)) + 'px';
    if (this.cfg.onHover) this.cfg.onHover(p);
  }
};

/* ---------- full-size chart window ----------
   spec: { title, sub, series, fmt, lo, hi, thresholds, hist, rangeOf, period, csvName, note }  Returns { refresh, close } */
SX.openChart = function (spec) {
  const per0 = spec.period || STK.store.get('sx-per', '15m');
  const html = `<div class="sx-cm-head"><div><h3>${esc(spec.title)}</h3><p class="hint">${esc(spec.sub || '')}</p></div><span class="grow"></span>
    <div class="sx-seg" id="sxc-per" role="group" aria-label="Time range" ${spec.fixedRange ? 'hidden' : ''}>${SX.PERIODS.map(p => `<button type="button" data-per="${p[0]}" class="${p[0] === per0 ? 'is-active' : ''}">${p[2]}</button>`).join('')}</div>
    <button class="sx-btn sm" type="button" id="sxc-zoom" hidden>${icon('refresh', 'sm')}<span>Reset zoom</span></button>
    <button class="sx-btn sm" type="button" id="sxc-csv">${icon('download', 'sm')}<span>CSV</span></button>
    <button class="sx-btn sm" type="button" id="sxc-x" data-autofocus aria-label="Close">${icon('x', 'sm')}<span>Close</span></button></div>
    <div class="sx-legend" id="sxc-legend"></div><div id="sxc-host" class="sx-cm-plot"></div><div class="sx-statt" id="sxc-stats"></div>
    <p class="hint sx-cm-note">${esc(spec.note || 'Move over the graph to read exact values. Drag across it to zoom, double-click to reset. Arrow keys step through readings. Click a name above to hide or show it.')}</p>`;
  const m = SX.modal(html, { cls: 'sx-chartwin', label: spec.title + ' history' });
  const host = $('#sxc-host', m.el), legend = $('#sxc-legend', m.el), statsEl = $('#sxc-stats', m.el);
  const cfg = { ...spec, series: spec.series.map(s => ({ ...s })), period: per0, inline: false, onState: () => side(), onHover: p => legendVals(p) };
  const ch = new SX.Chart(host, cfg);
  const f = k => (cfg.series.find(s => s.k === k) || {}).fmt || cfg.fmt || String;
  function legendVals(p) { const last = p || (ch.pts && ch.pts[ch.pts.length - 1]); $$('[data-lk]', legend).forEach(b => { const k = b.dataset.lk, v = last ? last[k] : null; $('b', b).textContent = num(v) ? f(k)(v) : '-'; }); }
  function side() {
    legend.innerHTML = cfg.series.map(s => `<button type="button" class="sx-lg ${s.hidden ? 'off' : ''}" data-lk="${esc(s.k)}" aria-pressed="${!s.hidden}"><i style="background:${s.color}"></i><span>${esc(s.name)}</span><b>-</b></button>`).join('');
    $('#sxc-zoom', m.el).hidden = !ch.zoom;
    legendVals(null);
    const rows = cfg.series.filter(s => !s.hidden).map(s => { const st = SX.stats(ch.pts.map(p => p[s.k])); const ff = s.fmt || cfg.fmt || String; return st ? `<tr><th><i style="background:${s.color}"></i>${esc(s.name)}</th><td>${esc(ff(st.last))}</td><td>${esc(ff(st.min))}</td><td>${esc(ff(st.avg))}</td><td>${esc(ff(st.p95))}</td><td>${esc(ff(st.max))}</td></tr>` : ''; }).join('');
    statsEl.innerHTML = rows ? `<table><thead><tr><th></th><th>Now</th><th>Lowest</th><th>Average</th><th>95th</th><th>Highest</th></tr></thead><tbody>${rows}</tbody></table>` : '';
  }
  m.el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'sxc-x') return m.close();
    if (b.dataset.per) { STK.store.set('sx-per', b.dataset.per); $$('#sxc-per button', m.el).forEach(x => x.classList.toggle('is-active', x === b)); return ch.setPeriod(b.dataset.per); }
    if (b.dataset.lk) return ch.toggle(b.dataset.lk);
    if (b.id === 'sxc-zoom') return ch.resetZoom();
    if (b.id === 'sxc-csv') { const [t0, t1] = ch.range(); const rows = ch.samples(t0, t1); SX.download((spec.csvName || 'studio-' + spec.title.toLowerCase().replace(/\W+/g, '-')) + '.csv', SX.csv(rows, [['t', 'time', r => new Date(r.t).toISOString()]].concat(cfg.series.map(s => [s.k, s.name + (spec.unit ? ' (' + spec.unit + ')' : '')])))); STK.toast('CSV saved to your downloads.'); }
  });
  m.onKey = e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { ch.step(e.key === 'ArrowLeft' ? -1 : 1); return true; } return false; };
  side(); ch.draw();
  return { refresh: () => { if (!ch.zoom) { ch.draw(); side(); } }, close: () => m.close(), chart: ch, modal: m };
};
})();
