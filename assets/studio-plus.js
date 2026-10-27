/* DROID ADB 4.2 Studio Plus.
   Adds to the 4.x Performance Studio: 24 hours of history per phone, clickable analytics cards that open a large graph,
   a Processor cores card, the Battery page, the animated Cool-down assistant and the Watchdog alerts.
   Loads after studio.js, studio-games.js and studio-more.js and builds on STK.studio (SX) and STK.xp (xp-ui.js). */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const SX = STK.studio, S = SX.S, XP = STK.xp;
if (!SX || !XP) return;
const num = v => v != null && isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const enc = encodeURIComponent;
const hist = id => XP.hist(id || STK.sel());
const MIN = 60e3;

/* ---------- 1. history: every Studio reading is kept for 24 hours ---------- */
function toSample(r) {
  const s = { t: Date.now(), temp: r.tempC, gpuT: r.gpuC, bt: r.batteryC, skin: r.skinC, cpu: r.cpu, ram: r.memPct, bat: r.battery, gpu: r.gpuBusy, gpuMhz: r.gpuMHz };
  if (r.storage) s.stor = r.storage.usedPct;
  (r.cores || []).forEach(c => { if (num(c.pct)) s['c' + c.id] = c.pct; if (num(c.mhz)) s['f' + c.id] = c.mhz; });
  const b = r.batt;
  if (b && num(b.currentMa)) { s.cur = Math.abs(b.currentMa); if (num(r.voltage)) s.power = Math.abs(b.currentMa) * r.voltage / 1e6; }
  const f = SX.fpsNow && SX.fpsNow(); if (num(f)) s.fps = f;
  return s;
}
STK.on('sx-sample', r => {
  const id = STK.sel(); if (!id || !r) return;
  hist(id).push(toSample(r));
  watch(r);
  if (openH && !XP.isModalOpen()) openH = null;
  if (openH) openH.refresh();
  coolHero();
});

/* ---------- 2. big graphs ---------- */
let openH = null;
const T = () => SX.opts();
const coreList = () => { const r = SX.last(); return ((r && r.cores) || []).filter(c => num(c.pct) || num(c.mhz)); };
const CH = {
  temp: () => ({ title: 'Temperature', sub: 'Processor, graphics, battery and case sensors.', unit: '°C', fmt: XP.f.c1, minSpan: 6,
    series: [{ k: 'temp', name: 'Processor', color: 'var(--warn)' }, { k: 'gpuT', name: 'Graphics', color: 'var(--rec)' }, { k: 'bt', name: 'Battery', color: 'var(--focus)' }, { k: 'skin', name: 'Case surface', color: 'var(--ok)', hidden: true }],
    thresholds: [{ v: T().hot, label: 'Warning limit', cls: 'bad' }, { v: T().cool, label: 'Cool-down target', cls: 'ok' }] }),
  cpu: () => ({ title: 'Processor load', sub: 'Total load, and each core. Click a core name to show it.', unit: '%', fmt: XP.f.pct, lo: 0, hi: 100, fillAll: false,
    series: [{ k: 'cpu', name: 'All cores', color: 'var(--accent)' }].concat(coreList().map((c, i) => ({ k: 'c' + c.id, name: 'CPU ' + c.id, hidden: true, color: XP.color(i + 1) }))),
    thresholds: [{ v: 90, label: 'Heavy load', cls: 'warn' }] }),
  freq: () => ({ title: 'Core clock speed', sub: 'How fast each core is running.', unit: 'MHz', fmt: XP.f.mhz, lo: 0,
    series: coreList().map((c, i) => ({ k: 'f' + c.id, name: 'CPU ' + c.id, hidden: i > 3, color: XP.color(i) })) }),
  ram: () => ({ title: 'Memory', sub: 'Share of memory in use.', unit: '%', fmt: XP.f.pct, lo: 0, hi: 100, series: [{ k: 'ram', name: 'Memory used', color: 'var(--focus)' }], thresholds: [{ v: 90, label: 'Nearly full', cls: 'warn' }] }),
  bat: () => ({ title: 'Battery level', sub: 'Charge over time.', unit: '%', fmt: XP.f.pct, lo: 0, hi: 100, series: [{ k: 'bat', name: 'Battery', color: 'var(--ok)' }], thresholds: [{ v: 15, label: 'Low', cls: 'bad' }] }),
  power: () => ({ title: 'Power', sub: 'How much the battery is giving or taking right now.', unit: 'W', fmt: XP.f.w, lo: 0, minSpan: 2, series: [{ k: 'power', name: 'Power', color: 'var(--accent)' }] }),
  cur: () => ({ title: 'Battery current', sub: 'Current in or out of the battery.', unit: 'mA', fmt: XP.f.ma, lo: 0, series: [{ k: 'cur', name: 'Current', color: 'var(--accent)' }] }),
  gpu: () => ({ title: 'Graphics', sub: 'Load and clock speed of the graphics chip.', unit: '%', fmt: XP.f.pct, lo: 0, hi: 100, series: [{ k: 'gpu', name: 'Busy', color: 'var(--rec)' }, { k: 'gpuMhz', name: 'Clock (MHz)', fmt: XP.f.mhz, hidden: true, color: 'var(--accent)' }] }),
  stor: () => ({ title: 'Storage', sub: 'Share of phone storage in use.', unit: '%', fmt: XP.f.pct, lo: 0, hi: 100, series: [{ k: 'stor', name: 'Used', color: 'var(--accent)' }], thresholds: [{ v: 92, label: 'Almost full', cls: 'bad' }] }),
  fps: () => ({ title: 'Frame rate', sub: 'Measured while the Games page frame monitor is on.', unit: 'fps', fmt: XP.f.fps, lo: 0, series: [{ k: 'fps', name: 'Frames per second', color: 'var(--ok)' }] })
};
SX.openChart = function (key, focus) {
  const mk = CH[key]; if (!mk) return;
  const spec = mk(); if (!spec.series.length) return STK.toast('This phone does not report that reading.', 'bad');
  if (focus) spec.series.forEach(s => { if (s.k === focus) s.hidden = false; });
  spec.hist = () => hist(); spec.csvName = 'droid-adb-' + key;
  openH = XP.openChart(spec);
};
document.addEventListener('click', e => {
  const t = e.target.closest('#studio-root [data-xp]'); if (!t) return;
  SX.openChart(t.dataset.xp, t.dataset.series);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target.closest && e.target.closest('#studio-root [data-xp][role="button"]'); if (!t) return;
  e.preventDefault(); SX.openChart(t.dataset.xp, t.dataset.series);
});

/* ---------- 3. Overview: analytics cards ---------- */
const series = (id, k, mins = 6) => { const now = Date.now(); return hist(id).range(now - mins * MIN, now).map(p => (num(p[k]) ? p[k] : null)); };
SX.liveCards = function () {
  const id = STK.sel(), r = SX.last(), h = id && S.hist[id]; if (!r || !h) return '<p class="hint">Reading the phone...</p>';
  const o = SX.opts();
  const card = (key, label, val, sub, spark, tone, ic) => `<div class="sx-lc xp-click ${tone}" data-xp="${key}" role="button" tabindex="0" aria-label="Open the ${esc(label)} graph"><div class="tp"><span class="l">${icon(ic, 'sm')}${label}</span><b>${val}</b></div>${spark}<small>${sub}</small><i class="xp-exp" aria-hidden="true">${icon('expand', 'sm')}</i></div>`;
  let out = card('cpu', 'Processor', r.cpu == null ? '--' : Math.round(r.cpu) + '%', 'Load across all cores', SX.spark(h.cpu, { min: 0, max: 100 }), SX.tone('cpu', r.cpu), 'cpu')
    + card('ram', 'Memory', r.memPct == null ? '--' : Math.round(r.memPct) + '%', r.memAvailMb != null ? (r.memAvailMb / 1024).toFixed(1) + ' GB free' : '', SX.spark(h.mem, { min: 0, max: 100 }), SX.tone('mem', r.memPct), 'ram')
    + card('temp', 'Temperature', r.tempC == null ? '--' : r.tempC.toFixed(1) + ' °C', 'Warning at ' + o.hot + ' °C', SX.spark(h.temp, { min: 25, max: 55 }), SX.tone('temp', r.tempC), 'thermo')
    + card('bat', 'Battery', r.battery == null ? '--' : r.battery + '%', r.charging ? 'Charging' + (r.voltage ? ' · ' + (r.voltage / 1000).toFixed(2) + ' V' : '') : 'Discharging' + (r.voltage ? ' · ' + (r.voltage / 1000).toFixed(2) + ' V' : ''), SX.spark(h.bat, { min: 0, max: 100 }), SX.tone('bat', r.battery), 'battery');
  if (r.gpuBusy != null || r.gpuMHz != null) out += card('gpu', 'Graphics', r.gpuBusy != null ? r.gpuBusy + '%' : r.gpuMHz + ' MHz', [r.gpuMHz != null && r.gpuBusy != null ? r.gpuMHz + ' MHz' : '', r.gpuC != null ? r.gpuC.toFixed(0) + ' °C' : ''].filter(Boolean).join(' · ') || 'Graphics chip', SX.spark(series(id, r.gpuBusy != null ? 'gpu' : 'gpuMhz'), { min: 0, max: r.gpuBusy != null ? 100 : null }), r.gpuBusy >= 90 ? 'warn' : 'ok', 'bolt');
  const b = r.batt;
  if (b && num(b.currentMa) && num(r.voltage)) { const w = Math.abs(b.currentMa) * r.voltage / 1e6; out += card('power', 'Power', w.toFixed(1) + ' W', (r.charging ? 'Going into the battery' : 'Drawn from the battery') + ' · ' + Math.abs(b.currentMa) + ' mA', SX.spark(series(id, 'power'), { min: 0 }), w >= 12 && !r.charging ? 'warn' : 'ok', 'plug'); }
  if (r.storage) out += card('stor', 'Storage', r.storage.usedPct + '%', r.storage.freeGb + ' GB free of ' + r.storage.totalGb + ' GB', SX.spark(series(id, 'stor', 60), { min: 0, max: 100 }), r.storage.usedPct >= 92 ? 'bad' : r.storage.usedPct >= 85 ? 'warn' : 'ok', 'folder');
  const f = SX.fpsNow && SX.fpsNow();
  if (num(f)) out += card('fps', 'Frame rate', Math.round(f) + ' fps', 'Frame monitor is on', SX.spark(series(id, 'fps'), { min: 0 }), f < 24 ? 'warn' : 'ok', 'play');
  return out;
};

/* ---------- 4. Processor cores card ---------- */
const clusterNames = n => (n === 1 ? [''] : n === 2 ? ['Efficiency cores', 'Performance cores'] : n === 3 ? ['Efficiency cores', 'Performance cores', 'Prime core'] : null);
SX.coresHtml = function () {
  const r = SX.last(); if (!r) return '<p class="hint">Reading the phone...</p>';
  const cores = r.cores || [];
  if (!cores.length) return '<p class="hint">This phone does not share its processor details.</p>' + gpuLine(r);
  const maxes = [...new Set(cores.map(c => c.maxMhz || 0))].sort((a, b) => a - b), nm = clusterNames(maxes.length);
  const groups = maxes.map((m, i) => ({ name: nm ? nm[i] : 'Cluster ' + (i + 1), list: cores.filter(c => (c.maxMhz || 0) === m) }));
  queueMicrotask(paintCores);
  return `<div class="xp-cores-head"><div class="xp-cores-sum" id="xp-cores-sum"></div><button class="btn sm" type="button" data-xp="cpu">${icon('chart', 'sm')}<span>History</span></button><button class="btn sm" type="button" data-xp="freq">${icon('gauge', 'sm')}<span>Clock speeds</span></button></div>`
    + groups.map(g => `<div class="xp-cgroup">${g.name ? `<small class="xp-cname">${esc(g.name)}</small>` : ''}<div class="xp-cores">${g.list.map(c => `<button type="button" class="xp-core" data-xp="cpu" data-series="c${c.id}" data-c="${c.id}" aria-label="CPU ${c.id} history"><span class="xp-core-bar"><i></i></span><b>--</b><small>CPU ${c.id}</small><em></em></button>`).join('')}</div></div>`).join('')
    + '<div class="xp-gpuline" id="xp-gpu">' + gpuLineInner(r) + '</div>';
};
function gpuLineInner(r) {
  if (r.gpuMHz == null && r.gpuBusy == null && r.gpuC == null) return '';
  return `<button type="button" class="xp-gpubtn" data-xp="gpu">${icon('bolt', 'sm')}<span>Graphics</span><b>${[r.gpuBusy != null ? r.gpuBusy + '% busy' : '', r.gpuMHz != null ? r.gpuMHz + ' MHz' : '', r.gpuC != null ? r.gpuC.toFixed(0) + ' °C' : ''].filter(Boolean).join(' · ')}</b></button>`;
}
const gpuLine = r => '<div class="xp-gpuline">' + gpuLineInner(r) + '</div>';
const loadTone = p => (p >= 85 ? 'bad' : p >= 60 ? 'warn' : '');
function paintCores() {
  const r = SX.last(); if (!r || !$('#xp-cores-sum')) return;
  const cores = r.cores || [], on = cores.filter(c => c.online);
  let top = null; cores.forEach(c => { if (num(c.pct) && (!top || c.pct > top.pct)) top = c; });
  const sum = $('#xp-cores-sum'), line = `${on.length} of ${cores.length} cores awake` + (num(r.cpu) ? ` · total ${Math.round(r.cpu)}%` : '') + (top ? ` · busiest CPU ${top.id} at ${Math.round(top.pct)}%` : '');
  if (sum.textContent !== line) sum.textContent = line;
  cores.forEach(c => {
    const el = $('.xp-core[data-c="' + c.id + '"]'); if (!el) return;
    const pct = num(c.pct) ? c.pct : 0, bi = $('i', el), b = $('b', el), em = $('em', el);
    if (bi) bi.style.height = Math.max(3, pct) + '%';
    el.classList.remove('warn', 'bad', 'off'); const t = loadTone(pct); if (t) el.classList.add(t); if (!c.online) el.classList.add('off');
    const bt = !c.online ? 'asleep' : num(c.pct) ? Math.round(c.pct) + '%' : '--'; if (b.textContent !== bt) b.textContent = bt;
    const ft = c.online && c.mhz ? XP.f.mhz(c.mhz) : ''; if (em.textContent !== ft) em.textContent = ft;
  });
  const g = $('#xp-gpu'); if (g) { const h = gpuLineInner(r); if (g._h !== h) { g._h = h; g.innerHTML = h; } }
}
STK.on('sx-sample', () => { if (state.view === 'studio') paintCores(); });

/* ---------- 5. Cool-down assistant (Thermals page) ---------- */
const FLAKES = Array.from({ length: 16 }, (_, i) => { const a = (i * 37 + 11) % 100, d = 5 + ((i * 53) % 40) / 10, dl = ((i * 29) % 60) / 10, s = 4 + (i * 7) % 6; return `<i style="left:${a}%;width:${s}px;height:${s}px;animation-duration:${d}s;animation-delay:-${dl}s"></i>`; }).join('');
const coolPhase = () => { const c = S.cool; if (!c || c.serial !== STK.sel()) return 'idle'; return c.done ? 'done' : 'active'; };
const RING = 2 * Math.PI * 52;
SX.coolAssistant = function () {
  const ph = coolPhase();
  queueMicrotask(updateCool);
  const sky = `<div class="xp-cd-sky" aria-hidden="true"><span class="xp-aur"></span><span class="xp-flakes">${FLAKES}</span></div>`;
  if (ph === 'idle') return `<div class="xp-cd idle">${sky}<div class="xp-cd-main"><div class="xp-cd-fan">${icon('fan')}</div><div class="xp-cd-copy"><h3>Cool-down assistant</h3><p>One tap dims the screen, turns on battery saver, locks 60 Hz and frees memory, then watches the temperature and tells you the moment the phone is ready. Undo puts everything back.</p><div class="xp-cd-fc" id="xp-cd-fc"></div></div></div><div class="xp-cd-actions"><button class="btn primary" type="button" data-sx="cool">${icon('snow', 'sm')}<span>Start cool-down</span></button></div></div>`;
  const ring = `<div class="xp-cd-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" id="xp-cd-arc" cx="60" cy="60" r="52" stroke-dasharray="${RING.toFixed(1)}" stroke-dashoffset="${RING.toFixed(1)}"/></svg><div class="mid"><b id="xp-cd-now">--</b><small>°C now</small></div><span class="xp-cd-fanmini">${icon('fan')}</span></div>`;
  if (ph === 'done') return `<div class="xp-cd done">${sky}<div class="xp-cd-main">${ring}<div class="xp-cd-copy"><h3><span class="xp-cd-tick">${icon('check')}</span>Cooled down. Ready to play.</h3><div class="xp-cd-nums" id="xp-cd-nums"></div></div></div><div class="xp-cd-actions"><button class="btn" type="button" data-sx="restore">${icon('refresh', 'sm')}<span>Undo: restore my settings</span></button><button class="btn ghost" type="button" data-sx="coolstop">Close</button></div></div>`;
  return `<div class="xp-cd active">${sky}<div class="xp-cd-main">${ring}<div class="xp-cd-copy"><h3>Cooling down<span class="xp-dots"><i></i><i></i><i></i></span></h3><div class="xp-cd-nums" id="xp-cd-nums"></div></div></div><div id="xp-cd-steps"></div><div class="xp-cd-actions"><button class="btn" type="button" data-sx="restore">${icon('refresh', 'sm')}<span>Undo: restore my settings</span></button><button class="btn ghost" type="button" data-sx="coolstop">Stop tracking</button></div></div>`;
};
function updateCool() {
  const r = SX.last(), ph = coolPhase(), o = SX.opts();
  const fc = $('#xp-cd-fc');
  if (fc && r) { const eta = SX.heatEta ? SX.heatEta() : 0, t = r.tempC; const txt = t == null ? '' : eta ? `Heating up. About ${eta} min until ${o.hot} °C at this rate.` : t >= o.hot ? `Hot at ${t.toFixed(1)} °C. A cool-down will help.` : `${t.toFixed(1)} °C now. Under control.`; if (fc.textContent !== txt) fc.textContent = txt; fc.className = 'xp-cd-fc ' + (t != null && (t >= o.hot || eta) ? 'warn' : 'ok'); }
  const c = S.cool; if (ph === 'idle' || !c) return;
  const now = c.now == null ? c.temp0 : c.now, drop = c.temp0 != null && now != null ? c.temp0 - now : null;
  const prog = c.temp0 != null && now != null ? clamp((c.temp0 - now) / Math.max(.5, c.temp0 - o.cool) * 100, 0, 100) : 0;
  const arc = $('#xp-cd-arc'); if (arc) arc.style.strokeDashoffset = (RING * (1 - (ph === 'done' ? 1 : prog / 100))).toFixed(1);
  const nb = $('#xp-cd-now'); if (nb) XP.setNum(nb, now, { dec: 1 });
  const el = ((c.done ? c.t1 : Date.now()) - c.t0) / 1000, clock = Math.floor(el / 60) + ':' + String(Math.floor(el % 60)).padStart(2, '0');
  const nums = $('#xp-cd-nums');
  if (nums) { const h = `<div><small>Started at</small><b>${c.temp0 == null ? '--' : c.temp0.toFixed(1) + ' °C'}</b></div><div><small>${drop != null && drop < 0 ? 'Warmer by' : 'Cooled by'}</small><b class="${drop != null && drop < 0 ? 'warn' : 'ok'}">${drop == null ? '--' : Math.abs(drop).toFixed(1) + ' °C'}</b></div><div><small>Target</small><b>${o.cool} °C</b></div><div><small>Time</small><b>${clock}</b></div>`; if (nums._h !== h) { nums._h = h; nums.innerHTML = h; } }
  const st = $('#xp-cd-steps');
  if (st) { const run = S.run; const h = run && (run.id === 'cool' || run.id === 'restore') ? `<ol class="xp-cd-steps">${run.steps.map(x => `<li class="${x.st}"><span class="m">${x.st === 'ok' ? icon('check', 'sm') : x.st === 'run' ? '<i class="xp-spinner"></i>' : x.st === 'skip' ? icon('info', 'sm') : x.st === 'fail' ? icon('alert', 'sm') : '<i class="xp-dotw"></i>'}</span><span>${esc(x.l)}</span></li>`).join('')}</ol>` : ''; if (st._h !== h) { st._h = h; st.innerHTML = h; } }
}
setInterval(() => { if (state.view === 'studio' && S.tab === 'thermals' && coolPhase() === 'active') updateCool(); }, 1000);
STK.on('sx-sample', () => { if (state.view === 'studio' && S.tab === 'thermals') updateCool(); });
STK.on('sx-cool', coolHero);
function coolHero() {
  const hero = document.getElementById('sx-hero'); if (!hero) return;
  const on = coolPhase() === 'active'; if (hero.classList.contains('xp-cooling') !== on) hero.classList.toggle('xp-cooling', on);
}

/* ---------- 6. Battery page ---------- */
const BAT = { apps: null, at: 0, busy: false, mode: 'bat' };
async function loadBatApps(force) {
  const id = STK.sel(); if (!id || BAT.busy || (!force && BAT.apps && Date.now() - BAT.at < 2 * MIN)) return;
  BAT.busy = true; paintBatApps();
  try { BAT.apps = await STK.api('/insights/battery?id=' + enc(id), { timeout: 60000 }); } catch (e) { BAT.apps = { apps: [], note: e.message }; }
  BAT.busy = false; BAT.at = Date.now(); paintBatApps();
}
function paintBatApps() {
  const el = $('#xp-bat-apps'); if (!el) return;
  const b = BAT.apps; let h;
  if (b && b.apps && b.apps.length) { const mx = Math.max(1, ...b.apps.map(a => a.mah)); h = b.apps.slice(0, 10).map(a => `<div class="xp-bar"><span class="bn">${esc(STK.niceApp ? STK.niceApp(a.package) : a.package)}<small>${esc(a.package)}</small></span><i><u style="width:${(a.mah / mx * 100).toFixed(1)}%"></u></i><b>${a.mah} mAh</b></div>`).join(''); }
  else h = `<p class="hint">${BAT.busy ? 'Reading battery use from the phone. This can take a few seconds...' : esc((b && b.note) || 'No per-app data from this phone.')}</p>`;
  if (el._h !== h) { el._h = h; el.innerHTML = h; }
}
const hm = h => { if (!isFinite(h) || h <= 0) return ''; const m = Math.round(h * 60); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : '') : m + ' min'; };
function batEta(r) {
  if (r.battery == null) return '';
  const pts = hist().range(Date.now() - 40 * MIN).filter(p => num(p.bat));
  if (pts.length >= 6 && pts[pts.length - 1].t - pts[0].t >= 8 * MIN) {
    const a = pts[0], b = pts[pts.length - 1], perH = (b.bat - a.bat) / ((b.t - a.t) / 3600e3);
    if (r.charging && perH > 0.5) return 'About ' + hm((100 - r.battery) / perH) + ' to full';
    if (!r.charging && perH < -0.5) return 'About ' + hm(r.battery / -perH) + ' left at this rate';
  }
  const bt = r.batt;
  if (bt && num(bt.currentMa) && bt.currentMa !== 0 && num(bt.chargeUah) && bt.chargeUah > 0 && r.battery > 0) {
    const mah = bt.chargeUah / 1000, cur = Math.abs(bt.currentMa);
    if (!r.charging) return 'About ' + hm(mah / cur) + ' left right now';
    return 'About ' + hm((mah / r.battery * (100 - r.battery)) / cur) + ' to full';
  }
  return 'Estimating... this needs a few minutes of readings';
}
const BR = 2 * Math.PI * 54;
SX.register({ id: 'battery', label: 'Battery', icon: 'battery', order: 3.5,
  onShow() { loadBatApps(false); },
  render: () => `<div class="sx-grid">
    ${SX.card('span-5', 'Battery', 'Click the ring for the full history.', `<div class="xp-bat-main" data-xp="bat" role="button" tabindex="0" aria-label="Open the battery graph"><div class="xp-batring" id="xp-batring"><svg viewBox="0 0 130 130" aria-hidden="true"><circle class="bg" cx="65" cy="65" r="54"/><circle class="fg" id="xp-bat-arc" cx="65" cy="65" r="54" stroke-dasharray="${BR.toFixed(1)}" stroke-dashoffset="${BR.toFixed(1)}"/></svg><div class="mid"><b id="xp-bat-pct">--</b><small id="xp-bat-bolt"></small></div></div><div class="xp-bat-side"><b id="xp-bat-status">--</b><span class="hint" id="xp-bat-eta"></span></div></div><div id="xp-bat-kv"></div>`)}
    ${SX.card('span-7', 'Charge history', 'Level, power and temperature while the phone is connected.', `<div class="xp-tl-bar"><div class="xp-seg" id="xp-bat-seg" role="group" aria-label="Graph"><button type="button" data-bm="bat" class="is-active">Level</button><button type="button" data-bm="power">Power</button><button type="button" data-bm="bt">Temperature</button></div><span class="grow"></span><button class="btn sm" type="button" data-xp="bat" id="xp-bat-exp">${icon('expand', 'sm')}<span>Expand</span></button></div><div id="xp-bat-chart" class="xp-inline"></div>`)}
    ${SX.card('span-7', 'Battery use by app', 'Since the phone was last fully charged.', '<div id="xp-bat-apps" class="xp-bars"></div>', `<button class="btn sm" type="button" data-sx="batreload">${icon('refresh', 'sm')}<span>Reload</span></button>`)}
    ${SX.card('span-5', 'Watchdog', 'Studio tells you when something needs attention.', '<div id="xp-wd"></div>')}
    ${SX.card('span-12', 'Battery tips', '', '<ul class="xp-tips"><li>Charging while gaming is the biggest source of heat. A slower charger keeps the phone cooler and the battery healthier.</li><li>Keeping the charge between 20% and 80% slows battery ageing.</li><li>Battery saver cuts processor speed. Turn it off before gaming and on again after.</li><li>A phone above 40 °C charges slower to protect the battery.</li></ul>')}
  </div>`,
  paint() { updateBattery(); paintWd(); paintBatApps(); }
});
let batChart = null;
function mountBatChart() {
  const host = $('#xp-bat-chart'); if (!host) { batChart = null; return; }
  if (batChart && batChart.host === host) return;
  if (batChart) batChart.destroy();
  const m = BAT.mode, spec = m === 'power' ? { fmt: XP.f.w, lo: 0, minSpan: 2, series: [{ k: 'power', name: 'Power (W)', color: 'var(--accent)' }] } : m === 'bt' ? { fmt: XP.f.c1, minSpan: 4, series: [{ k: 'bt', name: 'Battery temperature', color: 'var(--warn)' }] } : { fmt: XP.f.pct, lo: 0, hi: 100, series: [{ k: 'bat', name: 'Battery level', color: 'var(--ok)' }] };
  batChart = new XP.Chart(host, { ...spec, title: 'Battery', inline: true, period: '1h', hist: () => hist() });
  host.classList.add('xp-inline'); batChart.draw();
}
function updateBattery() {
  const r = SX.last(); if (!r || !$('#xp-batring')) return;
  const pct = r.battery, bt = r.batt || {};
  const arc = $('#xp-bat-arc'); if (arc) { arc.style.strokeDashoffset = (BR * (1 - (pct == null ? 0 : pct) / 100)).toFixed(1); arc.style.stroke = pct == null ? '' : pct <= 15 && !r.charging ? 'var(--bad)' : pct <= 30 && !r.charging ? 'var(--warn)' : 'var(--ok)'; }
  const ring = $('#xp-batring'); ring.classList.toggle('chg', !!r.charging);
  XP.setNum($('#xp-bat-pct'), pct, { suf: '%' });
  const bolt = $('#xp-bat-bolt'); if (bolt) { const t = r.charging ? 'Charging' : r.plugged ? 'Plugged in' : 'On battery'; if (bolt.textContent !== t) bolt.textContent = t; }
  const st = $('#xp-bat-status'); if (st) { const t = pct == null ? '--' : r.charging ? 'Charging' + (pct >= 100 ? ', full' : '') : 'Discharging'; if (st.textContent !== t) st.textContent = t; }
  const eta = $('#xp-bat-eta'); if (eta) { const t = batEta(r); if (eta.textContent !== t) eta.textContent = t; }
  const w = num(bt.currentMa) && num(r.voltage) ? Math.abs(bt.currentMa) * r.voltage / 1e6 : null;
  const rows = [['Power', w == null ? '--' : w.toFixed(1) + ' W', ''], ['Current', num(bt.currentMa) ? Math.abs(bt.currentMa) + ' mA' : '--', ''], ['Voltage', r.voltage ? (r.voltage / 1000).toFixed(2) + ' V' : '--', ''], ['Temperature', r.batteryC != null ? r.batteryC.toFixed(1) + ' °C' : '--', SX.tone('temp', r.batteryC)], ['Health', esc(bt.health || '--'), bt.health && bt.health !== 'Good' ? 'warn' : ''], ['Capacity vs new', bt.capacityPct != null ? bt.capacityPct + '%' : '--', bt.capacityPct != null && bt.capacityPct < 80 ? 'warn' : ''], ['Technology', esc(bt.tech || '--'), '']];
  const kv = $('#xp-bat-kv'), h = SX.kv(rows); if (kv && kv._h !== h) { kv._h = h; kv.innerHTML = h; }
  mountBatChart(); if (batChart) batChart.draw();
}
Object.assign(SX.actions, {
  batreload: t => STK.busy(t, () => loadBatApps(true))
});
document.addEventListener('click', e => {
  const b = e.target.closest('#studio-root #xp-bat-seg button'); if (!b) return;
  BAT.mode = b.dataset.bm; $$('#xp-bat-seg button').forEach(x => x.classList.toggle('is-active', x === b));
  const ex = $('#xp-bat-exp'); if (ex) ex.dataset.xp = BAT.mode;
  if (batChart) batChart.destroy(); batChart = null; mountBatChart();
});

/* ---------- 7. Watchdog ---------- */
const WD0 = { heat: true, throttle: true, battery: true, memory: true, bg: true, low: 15 };
const wd = () => ({ ...WD0, ...(STK.kv.get('xp-wd', {}) || {}) });
const fired = {};
function alertOnce(key, text, kind, action) {
  const now = Date.now(); if (fired[key] && now - fired[key] < 5 * MIN) return; fired[key] = now;
  STK.toast(text, kind || 'bad', action);
  STK.notify && STK.notify('Phone alert', text, 'xp-' + key);
  const hero = document.getElementById('sx-hero'); if (hero) { hero.classList.remove('xp-alert'); void hero.offsetWidth; hero.classList.add('xp-alert'); }
}
function watch(r) {
  const w = wd(), o = SX.opts(), coolNow = { label: 'Cool down', run: () => { STK.go('studio'); SX.go('thermals'); SX.cooldown(document.getElementById('sx-cool')); } };
  if (w.heat && r.tempC != null && r.tempC >= o.hot) alertOnce('heat', 'The phone is hot (' + r.tempC.toFixed(0) + ' °C). Give it a break or start a cool-down.', 'bad', coolNow);
  else if (w.throttle && r.thermalStatus >= 2) alertOnce('thr', 'Android is slowing the phone down to protect it from heat.', 'bad', coolNow);
  if (w.battery && r.battery != null && !r.charging && r.battery <= w.low) alertOnce('bat', 'Battery is at ' + r.battery + '%. Plug the phone in soon.', 'bad');
  if (w.memory && r.memPct != null && r.memPct >= 93) alertOnce('mem', 'Memory is almost full (' + Math.round(r.memPct) + '%). Free memory from the Optimize page.', 'bad');
}
function paintWd() {
  const el = $('#xp-wd'); if (!el) return;
  const w = wd(), sw = (k, label, hint) => `<label class="xp-wd-row"><span><b>${label}</b><small>${hint}</small></span><input type="checkbox" role="switch" data-sxc="wd" data-k="${k}" ${w[k] ? 'checked' : ''}></label>`;
  const h = sw('heat', 'Overheating', 'At your warning temperature') + sw('throttle', 'Throttling', 'When Android slows the phone') + sw('battery', 'Low battery', 'At ' + w.low + '% or less') + sw('memory', 'Memory nearly full', 'At 93% or more') + sw('bg', 'Keep watching in the background', 'Checks every 30 seconds on other pages while this tab is open');
  if (el._h !== h) { el._h = h; el.innerHTML = h; }
}
Object.assign(SX.changes, { wd: t => { const w = wd(); w[t.dataset.k] = t.checked; STK.kv.set('xp-wd', w); } });
setInterval(() => { if (state.view !== 'studio' && !document.hidden && STK.sel() && wd().bg && SX.sample) SX.sample(true); }, 30000);

/* ---------- 8. housekeeping ---------- */
STK.on('device-changed', () => { batChart = null; BAT.apps = null; });
})();
