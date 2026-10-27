/* Studio 3.8 engine: live telemetry, 24 hour history, readiness analysis, forecasts, profiles with Undo,
   game sessions, watchdog alerts and the perf recorder. The screen is drawn by studio-views.js. */
(() => {
'use strict';
const { $, $$, esc, state } = STK;
const SX = STK.sx;
const enc = encodeURIComponent;
const SS = STK.studioCore = { render() {}, paint() {}, paintSteps() {}, paintEvents() {}, onChartTick() {} };
const store = STK.store;

const S = SS.S = {
  tab: store.get('studio-tab', 'overview'), pkg: '', perf: null, perfErr: '', perfBusy: false, perfTimer: null, running: false, paused: false,
  interval: Number(store.get('sx-int', 4000)) || 4000, lastAt: 0, lastLatency: null, sample: null, lastFrames: null,
  toggles: null, ext: {}, sys: null, stats: null, statsAt: 0, net: null, netBusy: false, netHist: store.get('sx-nethist', []),
  top: null, topAt: 0, topBusy: false, battApps: null, battAt: 0, battBusy: false, apps: null, demo: false,
  profile: store.get('sx-profile', null), busy: '', steps: [], stepPct: 0, freed: null,
  active: {}, misses: {}, entering: {}, rec: null, events: store.get('sx-events', []), coolNotified: false, alertAt: {},
  wd: { heat: true, low: true, ram: true, thr: true, fps: false, heatLimit: 43, coolTarget: 38, lowLimit: 15, ramLimit: 92, fpsLimit: 30, ...store.get('sx-wd', {}) },
  hist: null, histId: '', chartWin: null
};
const root = SS.root = () => $('#studio-root');
const games = SS.games = () => STK.kv.get('games', []);
const nice = SS.nice = p => (STK.niceApp ? STK.niceApp(p) : p);
const gt = SS.gt = body => STK.post('/game-tools', { serial: STK.sel(), ...body }, { timeout: 45000 });
const tog = SS.tog = (key, value) => STK.post('/toggle', { serial: STK.sel(), key, value }, { timeout: 30000 });
const sleep = STK.sleep;
const num = SX.num;

/* migrate 3.7 saved Turbo / cool-down state so an Undo still works after updating */
(() => {
  try {
    const t = store.get('turbo', null), c = store.get('cool', null);
    if (!S.profile && t) S.profile = { id: 'max', name: 'Turbo (from 3.7)', icon: 'rocket', at: t.at, prev: { ...t, touched: { refresh: true, lowpower: true } }, ok: 0, total: 0 };
    else if (!S.profile && c) S.profile = { id: 'cool', name: 'Cool-down (from 3.7)', icon: 'fan', at: c.at, prev: { ...c, touched: { brightness: true, lowpower: true } }, ok: 0, total: 0 };
    if (t || c) { store.set('turbo', null); store.set('cool', null); store.set('sx-profile', S.profile); }
  } catch (e) { /* ignore */ }
})();

/* ---------- live numbers ---------- */
const L = SS.L = () => STK.live() || null;
SS.fgPkg = () => { const l = L(); return l && l.fgPackage ? l.fgPackage : ''; };
const targetPkg = SS.targetPkg = () => S.pkg || (Object.values(S.active)[0] || {}).pkg || SS.fgPkg();
const phoneTemp = SS.phoneTemp = () => { const l = L(); if (l && num(l.tempC)) return l.tempC; const p = S.perf; if (p && num(p.skinTempC)) return p.skinTempC; const b = p && p.battery; return b && num(b.temp) ? b.temp : null; };
const socTemp = SS.socTemp = () => { const p = S.perf; return p ? (num(p.cpuTempC) ? p.cpuTempC : p.maxTempC) : null; };
const ramPct = SS.ramPct = () => { const p = S.perf; return p && p.memTotalKb ? Math.round(1000 * (1 - p.memAvailKb / p.memTotalKb)) / 10 : null; };
SS.gb = kb => (kb / 1048576).toFixed(1);
SS.THERMAL = ['None', 'Light', 'Moderate', 'Severe', 'Critical', 'Emergency', 'Shutdown'];
SS.tempLevel = t => !num(t) ? '' : t >= 45 ? 'bad' : t >= 41 ? 'warn' : 'ok';
SS.tempWord = t => !num(t) ? 'No reading' : t >= 45 ? 'Very hot' : t >= 41 ? 'Hot' : t >= 38 ? 'Warm' : t >= 30 ? 'Cool' : 'Cold';
SS.socLevel = t => !num(t) ? '' : t >= 80 ? 'bad' : t >= 65 ? 'warn' : 'ok';
SS.pctLevel = (v, w, b) => !num(v) ? '' : v >= b ? 'bad' : v >= w ? 'warn' : 'ok';
const fpsNow = SS.fpsNow = () => { const h = S.hist ? S.hist.a : []; for (let i = h.length - 1; i >= 0 && i > h.length - 4; i--) if (num(h[i].fps)) return h[i].fps; return null; };
SS.hist = () => { const id = STK.sel(); if (!id) return null; if (S.histId !== id || !S.hist) { S.histId = id; S.hist = SX.hist(id); } return S.hist; };
SS.recent = ms => { const h = SS.hist(); return h ? h.range(Date.now() - ms) : []; };

/* ---------- events and alerts ---------- */
const logEvent = SS.logEvent = (kind, text, level = 'info') => {
  S.events.unshift({ t: Date.now(), kind, text, level }); if (S.events.length > 40) S.events.length = 40;
  store.set('sx-events', S.events); SS.paintEvents();
};
function alertOnce(key, cooldown, text, level, action, notifyTitle) {
  const now = Date.now(); if (now - (S.alertAt[key] || 0) < cooldown) return;
  S.alertAt[key] = now; logEvent('alert', text, level);
  STK.toast(text, level === 'bad' ? 'bad' : 'ok', action);
  if (STK.notify && notifyTitle) STK.notify(notifyTitle, text, 'sx-' + key);
}
SS.saveWd = () => store.set('sx-wd', S.wd);

/* ---------- sampling ---------- */
function addSample(r) {
  S.perf = r; S.sample = null;
  const l = L(), pkg = targetPkg(); let fps = null;
  if (r.frames != null) {
    const lf = S.lastFrames;
    if (lf && lf.pkg === pkg && r.frames >= lf.frames && r.at > lf.at) { const v = (r.frames - lf.frames) / ((r.at - lf.at) / 1000); if (v >= 0 && v <= 250) fps = Math.round(v); }
    S.lastFrames = { pkg, frames: r.frames, at: r.at };
  } else S.lastFrames = null;
  const b = r.battery || {}, s = { t: r.at || Date.now(), phone: phoneTemp(), soc: socTemp(), skin: r.skinTempC, cpu: r.cpuPct, ram: ramPct(), gpu: r.gpuPct, fps, bat: l && l.battery >= 0 ? l.battery : b.level, ma: num(b.currentMa) ? Math.abs(b.currentMa) : null };
  s.w = num(s.ma) && num(b.voltage) ? Math.round(s.ma * b.voltage / 1e5) / 10 : null;
  (r.cores || []).forEach(c => { if (num(c.pct)) s['c' + c.id] = c.pct; });
  (r.zones || []).slice(0, 8).forEach(z => { s['z:' + z.name] = z.c; });
  S.sample = s;
  const h = SS.hist(); if (h) h.push(s);
  const a = S.active[STK.sel()], mini = { t: s.t, phone: s.phone, cpu: s.cpu, fps, ram: s.ram, bat: s.bat };
  if (a) { a.samples.push(mini); if (a.samples.length > 4000) a.samples.splice(0, 1000); }
  if (S.rec) { S.rec.samples.push(mini); if (S.rec.samples.length > 8000) S.rec.samples.splice(0, 2000); }
  watchdog(s, r);
  const pt = s.phone;
  if (S.profile && S.profile.id === 'cool' && !S.coolNotified && num(pt) && pt <= S.wd.coolTarget) { S.coolNotified = true; logEvent('cool', 'The phone cooled down to ' + pt + ' °C.', 'ok'); STK.toast('The phone cooled down to ' + pt + ' °C.', 'ok', { label: 'Restore', run: () => revertProfile() }); }
  if (S.profile && S.profile.id === 'cool' && num(pt) && pt > S.wd.coolTarget) S.coolNotified = false;
}
function watchdog(s, r) {
  const w = S.wd;
  if (w.thr && r.thermalStatus != null && r.thermalStatus >= 2) alertOnce('thr', 600e3, 'Android is throttling the phone (' + SS.THERMAL[r.thermalStatus] + '). Frame rate will drop until it cools.', 'bad', { label: 'Cool down', run: () => SS.applyProfile('cool') }, 'Phone is throttling');
  if (w.ram && num(s.ram) && s.ram >= w.ramLimit) alertOnce('ram', 600e3, 'Memory is ' + Math.round(s.ram) + '% full. Free memory to avoid stutter.', 'bad', { label: 'Free memory', run: () => SS.freeMemory() }, 'Memory almost full');
  if (w.fps && num(s.fps) && s.fps > 0 && s.fps < w.fpsLimit && (S.active[STK.sel()] || S.rec)) alertOnce('fps', 300e3, 'Frame rate dropped to ' + s.fps + ' fps.', 'bad', null, 'Low frame rate');
}
STK.on('live', ({ L: l }) => {
  if (!l) return; const w = S.wd;
  if (w.heat && num(l.tempC) && l.tempC >= w.heatLimit) alertOnce('heat', 300e3, 'The phone is hot (' + l.tempC + ' °C). Take a short break or start the cool-down.', 'bad', { label: 'Cool down', run: () => { STK.go('studio'); SS.applyProfile('cool'); } }, 'Phone is hot');
  if (w.low && l.battery >= 0 && l.battery <= w.lowLimit && !l.charging) alertOnce('low', 600e3, 'Battery is at ' + l.battery + '%. Plug the phone in to keep going.', 'bad', null, 'Battery low');
});

/* ---------- forecasts ---------- */
function slope(pts, k) {   // least squares, units per minute
  const p = pts.filter(x => num(x[k])); if (p.length < 4) return null;
  const t0 = p[0].t; let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = p.length;
  p.forEach(q => { const x = (q.t - t0) / 60000; sx += x; sy += q[k]; sxx += x * x; sxy += x * q[k]; });
  const d = n * sxx - sx * sx; if (Math.abs(d) < 1e-9) return null;
  return (n * sxy - sx * sy) / d;
}
SS.slope = slope;
SS.tempTrend = () => { const per = slope(SS.recent(4 * 60e3), 'phone'); return per; };
SS.heatForecast = () => {
  const pt = phoneTemp(), per = SS.tempTrend(); if (!num(pt) || per == null) return null;
  if (pt >= S.wd.heatLimit) return { state: 'over', per };
  if (per > 0.12) { const mins = (S.wd.heatLimit - pt) / per; if (mins > 0 && mins < 90) return { state: 'rising', mins, per }; }
  if (per < -0.12) { const mins = pt > S.wd.coolTarget ? (pt - S.wd.coolTarget) / -per : 0; return { state: 'falling', mins, per }; }
  return { state: 'steady', per };
};
SS.batteryEta = () => {
  const l = L(); if (!l || l.battery < 0) return null;
  const pts = SS.recent(40 * 60e3).filter(p => num(p.bat)), per = slope(pts, 'bat');
  if (per == null) return null; const span = pts.length ? (pts[pts.length - 1].t - pts[0].t) / 60000 : 0; if (span < 6) return null;
  if (l.charging && per > 0.02) return { dir: 'full', mins: Math.max(0, (100 - l.battery) / per), per };
  if (!l.charging && per < -0.02) return { dir: 'empty', mins: l.battery / -per, per };
  return { dir: 'steady', per };
};
SS.fmtMins = m => { if (!isFinite(m)) return '-'; m = Math.round(m); if (m < 1) return 'under a minute'; if (m < 60) return m + ' min'; const h = Math.floor(m / 60); return h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : ''); };

/* ---------- readiness score and suggestions ---------- */
SS.analyse = function () {
  const l = L(), p = S.perf, t = S.toggles || {}, pt = phoneTemp(), ram = ramPct(), sug = []; let score = 100;
  const add = (sev, title, text, fix, label) => sug.push({ sev, title, text, fix, label });
  if (num(pt)) {
    if (pt >= 45) { score -= 32; add('bad', 'The phone is very hot (' + pt + ' °C)', 'It will slow itself down to protect the battery. Pause and cool it before playing on.', 'cool', 'Start cool-down'); }
    else if (pt >= 41) { score -= 18; add('warn', 'The phone is getting hot (' + pt + ' °C)', 'Performance drops soon at this heat. Lower brightness or take a short break.', 'cool', 'Start cool-down'); }
    else if (pt >= 38) score -= 5;
  }
  const fc = SS.heatForecast();
  if (fc && fc.state === 'rising') add(fc.mins < 10 ? 'warn' : 'info', 'Heat is rising: ' + S.wd.heatLimit + ' °C in about ' + SS.fmtMins(fc.mins), 'The phone warms by about ' + fc.per.toFixed(1) + ' °C every minute. Act now to stay ahead of throttling.', 'cool', 'Start cool-down');
  if (p && p.thermalStatus != null && p.thermalStatus >= 2) { score -= 15; add('bad', 'Android is throttling the phone (' + SS.THERMAL[p.thermalStatus] + ')', 'The system is already cutting speed because of heat. Frame rate will suffer until it cools.', 'cool', 'Start cool-down'); }
  if (num(ram)) {
    if (ram >= 90) { score -= 25; add('bad', 'Memory is almost full (' + Math.round(ram) + '% used)', 'Games reload and stutter when memory runs out. Close background apps first.', 'freemem', 'Free memory'); }
    else if (ram >= 80) { score -= 12; add('warn', 'Memory is getting full (' + Math.round(ram) + '% used)', 'Closing background apps gives the game more room.', 'freemem', 'Free memory'); }
  }
  if (p && num(p.cpuPct) && p.cpuPct >= 85 && !Object.keys(S.active).length) { score -= 8; add('warn', 'Something is using the processor (' + p.cpuPct + '%)', 'A background app is busy. See Performance for the busiest apps.', 'perf', 'Open Performance'); }
  if (l && l.battery >= 0) {
    if (l.battery <= 15 && !l.charging) { score -= 15; add('bad', 'Battery is low (' + l.battery + '%)', 'Low battery makes many phones cut performance. Plug in, ideally with a slow charger to limit heat.', '', ''); }
    else if (l.battery <= 30 && !l.charging) score -= 5;
    if (l.charging && num(pt) && pt >= 39) add('warn', 'Charging while hot adds heat', 'Gaming and fast charging together is the biggest source of heat. Pause charging or use a slower charger.', '', '');
    const e = SS.batteryEta(); if (e && e.dir === 'empty' && e.mins < 45 && !l.charging) add('warn', 'About ' + SS.fmtMins(e.mins) + ' of battery left', 'At the current drain the battery will run out soon.', '', '');
  }
  if (S.toggles) {
    if (!t.dnd) { score -= 5; add('info', 'Notifications can interrupt you', 'Do not disturb keeps pop-ups and calls from covering the game.', 'dnd', 'Turn on'); }
    if (t.animations !== false) { score -= 2; add('info', 'System animations are on', 'Turning them off makes menus and app switching feel faster.', 'anim', 'Turn off'); }
  }
  if (p && p.lowPower === 1) { score -= 12; add('warn', 'Battery saver is on', 'Battery saver limits the processor and frame rate. Turn it off for gaming.', 'lowpower', 'Turn off'); }
  if (p && p.storageTotalKb) { const free = 100 * p.storageFreeKb / p.storageTotalKb; if (free < 8) { score -= 8; add('warn', 'Storage is nearly full (' + SS.gb(p.storageFreeKb) + ' GB free)', 'Very full storage slows loading and can make games crash. Clear caches or remove large files.', 'storage', 'Clean up'); } }
  const mir = STK.mirroring && STK.mirroring(), rec = STK.recording && STK.recording();
  if ((mir || rec) && num(pt) && pt >= 41) add('info', 'Mirroring or recording adds heat', 'Encoding video keeps the chip busy. A lighter capture preset runs cooler.', 'preset', 'Use Low latency');
  const net = S.net; if (net && net.reachable && net.avgMs != null && net.avgMs >= 80) add('warn', 'Network delay is high (' + Math.round(net.avgMs) + ' ms)', 'Online games feel laggy above about 80 ms. Move closer to the router or use 5 GHz Wi-Fi.', 'net', 'Test again');
  score = Math.max(0, Math.min(100, Math.round(score)));
  const order = { bad: 0, warn: 1, info: 2, ok: 3 }; sug.sort((a, b) => order[a.sev] - order[b.sev]);
  if (!sug.length) add('ok', 'Everything looks good', 'No problems found. Pick a profile for an extra edge before a long session.', '', '');
  return { score, sug, word: score >= 85 ? 'Ready to play' : score >= 65 ? 'Good to go' : score >= 45 ? 'Could be better' : 'Needs attention', color: score >= 85 ? 'var(--ok)' : score >= 65 ? 'var(--accent)' : score >= 45 ? 'var(--warn)' : 'var(--bad)' };
};

/* ---------- chart metrics (shared by cards, inline graph and full-size windows) ---------- */
const coreSeries = () => { const n = S.perf && S.perf.cores ? S.perf.cores.length : 0; return Array.from({ length: n }, (_, i) => ({ k: 'c' + i, name: 'CPU' + i, hidden: true })); };
SS.METRICS = {
  temp: { title: 'Temperature', sub: 'Phone (battery) and processor temperature over time.', unit: '°C', fmt: SX.f.c1, series: () => [{ k: 'phone', name: 'Phone', color: 'var(--warn)' }, { k: 'soc', name: 'Processor', color: 'var(--rec)' }, { k: 'skin', name: 'Skin sensor', color: 'var(--focus)', hidden: true }], thresholds: () => [{ v: S.wd.heatLimit, label: 'Warning limit', cls: 'bad' }, { v: S.wd.coolTarget, label: 'Cool-down target', cls: 'ok' }], minSpan: 6 },
  cpu: { title: 'Processor load', sub: 'Total load, and each core (click a core name to show it).', unit: '%', fmt: SX.f.pct, lo: 0, hi: 100, series: () => [{ k: 'cpu', name: 'Total', color: 'var(--focus)' }, ...coreSeries()] },
  ram: { title: 'Memory used', sub: 'Share of the phone memory in use.', unit: '%', fmt: SX.f.pct, lo: 0, hi: 100, series: () => [{ k: 'ram', name: 'Memory', color: 'var(--ok)' }], thresholds: () => [{ v: S.wd.ramLimit, label: 'Alert at ' + S.wd.ramLimit + '%', cls: 'bad' }] },
  gpu: { title: 'Graphics load', sub: 'Graphics chip busy time (phones that share it).', unit: '%', fmt: SX.f.pct, lo: 0, hi: 100, series: () => [{ k: 'gpu', name: 'GPU', color: '#b794f6' }] },
  fps: { title: 'Frame rate', sub: 'Estimated frames per second of the target game.', unit: 'fps', fmt: SX.f.fps, lo: 0, series: () => [{ k: 'fps', name: 'Frame rate', color: 'var(--accent)' }], thresholds: () => [{ v: 60, label: '60 fps', cls: 'ok' }, { v: 30, label: '30 fps', cls: 'bad' }] },
  bat: { title: 'Battery level', sub: 'Charge level over time.', unit: '%', fmt: SX.f.pct, lo: 0, hi: 100, series: () => [{ k: 'bat', name: 'Battery', color: 'var(--ok)' }], thresholds: () => [{ v: S.wd.lowLimit, label: 'Low battery', cls: 'bad' }] },
  power: { title: 'Power draw', sub: 'How much power the phone uses (or takes in while charging).', unit: 'W', fmt: SX.f.w, lo: 0, series: () => [{ k: 'w', name: 'Power', color: 'var(--rec)' }], note: 'Estimated from battery current and voltage. Some phones do not share the current reading.' },
  zones: { title: 'All sensors', sub: 'Every temperature sensor the phone shares.', unit: '°C', fmt: SX.f.c1, series: () => ((S.perf && S.perf.zones) || []).map(z => ({ k: 'z:' + z.name, name: z.name })), minSpan: 6 }
};
SS.metricSpec = (key, extra) => {
  const m = SS.METRICS[key]; if (!m) return null;
  return { ...m, series: m.series().map(s => ({ ...s })), thresholds: m.thresholds ? m.thresholds() : [], hist: () => SS.hist(), csvName: 'droid-adb-' + key, ...extra };
};
SS.openMetric = (key, series) => {
  const spec = SS.metricSpec(key); if (!spec) return;
  if (series) { spec.series.forEach(s => { s.hidden = !(series === s.k || series.includes?.(s.k)); }); }
  S.chartWin = SX.openChart(spec); return S.chartWin;
};
SS.chartTick = () => { const w = S.chartWin; if (w && w.modal && w.modal.el.isConnected) w.refresh(); else S.chartWin = null; };

/* ---------- polling ---------- */
async function pollPerf(force) {
  const id = STK.sel(); if (!id || S.perfBusy || (S.paused && !force) || document.hidden || state.view !== 'studio') return;
  S.perfBusy = true; const t0 = performance.now(); const pkg = targetPkg();
  try { const r = await STK.api('/perf?id=' + enc(id) + (pkg ? '&pkg=' + enc(pkg) : ''), { timeout: 25000 }); S.perfErr = ''; S.lastLatency = Math.round(performance.now() - t0); S.lastAt = Date.now(); addSample(r); }
  catch (e) { S.perfErr = e.message; }
  finally { S.perfBusy = false; SS.paint(); SS.chartTick(); }
  if (S.tab === 'perf' && Date.now() - S.topAt > 6000) loadTop();
  if (S.tab === 'perf' && S.statsAuto && pkg && Date.now() - S.statsAt > 6000) readStats(true);
}
SS.pollPerf = pollPerf;
function loop() { if (!S.running) return; pollPerf().finally(() => { if (S.running) { clearTimeout(S.perfTimer); S.perfTimer = setTimeout(loop, S.interval); } }); }
SS.startPerf = () => { SS.stopPerf(); if (state.view !== 'studio') return; S.running = true; loop(); };
SS.stopPerf = () => { S.running = false; clearTimeout(S.perfTimer); S.perfTimer = null; };
SS.setPaused = v => { S.paused = v; SS.paint(); if (!v) pollPerf(true); };
SS.setInterval = ms => { S.interval = ms; store.set('sx-int', ms); if (S.running) { clearTimeout(S.perfTimer); S.perfTimer = setTimeout(loop, 400); } };
SS.loadToggles = async function () {
  const id = STK.sel(); if (!id) return;
  try { const r = await STK.api('/toggles?id=' + enc(id), { timeout: 30000 }); S.toggles = r.toggles || {}; S.ext = { brightness: r.brightness, timeout: r.timeout, volume: r.volume, volumeMax: r.volumeMax }; } catch (e) { S.toggles = null; }
  if (state.view === 'studio') { if (S.tab === 'optimize') SS.render(); else SS.paint(); }
};
async function loadTop() {
  const id = STK.sel(); if (!id || S.topBusy) return; S.topBusy = true;
  try { S.top = await STK.api('/monitor?id=' + enc(id), { timeout: 25000 }); S.topAt = Date.now(); } catch (e) { S.topAt = Date.now(); }
  S.topBusy = false; if (state.view === 'studio' && S.tab === 'perf') SS.paint();
}
SS.loadTop = loadTop;
SS.loadBattApps = async function (force) {
  const id = STK.sel(); if (!id || S.battBusy || (!force && S.battApps && Date.now() - S.battAt < 120000)) return; S.battBusy = true; if (state.view === 'studio' && S.tab === 'battery') SS.paint();
  try { S.battApps = await STK.api('/insights/battery?id=' + enc(id), { timeout: 60000 }); } catch (e) { S.battApps = { apps: [], note: e.message }; }
  S.battAt = Date.now(); S.battBusy = false; if (state.view === 'studio' && S.tab === 'battery') SS.render();
};

/* ---------- tools ---------- */
SS.tool = async function (btn, body) {
  if (!STK.sel()) return null;
  return STK.busy(btn, async () => {
    try {
      const r = await gt(body);
      if (r.applied === false) { STK.logError('studio ' + body.action, (r.message || '') + (r.reply ? ' Phone reply: ' + r.reply : '') + (r.modes ? ' Modes: ' + r.modes : '')); STK.toast(r.message || 'The phone did not accept that.', 'bad'); }
      else STK.toast(r.message || 'Done.');
      return r;
    } catch (e) { STK.fail(e); return null; }
  });
};
SS.freeMemory = async function (btn) {
  const before = S.perf ? S.perf.memAvailKb : null;
  const r = await SS.tool(btn, { action: 'freemem' }); if (!r || r.applied === false) return;
  await pollPerf(true); const after = S.perf ? S.perf.memAvailKb : null;
  if (before != null && after != null) { const mb = Math.round((after - before) / 1024); if (mb > 0) { S.freed = { mb, at: Date.now() }; STK.toast('Freed about ' + (mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB') + ' of memory.'); logEvent('tool', 'Freed about ' + mb + ' MB of memory.', 'ok'); SS.paint(); }
  }
};
SS.cleanCaches = async function (btn) { const r = await SS.tool(btn, { action: 'trimcache' }); if (r && r.applied !== false) { logEvent('tool', 'Cleared app caches.', 'ok'); pollPerf(true); } return r; };
async function readStats(silent) {
  const id = STK.sel(), pkg = targetPkg(); if (!id || !pkg) { if (!silent) STK.toast('Open the game on the phone, or pick one from the list.', 'bad'); return; }
  S.statsAt = Date.now();
  try { S.stats = await STK.api('/game-stats?id=' + enc(id) + '&pkg=' + enc(pkg), { timeout: 30000 }); S.stats.at = Date.now(); if (state.view === 'studio' && S.tab === 'perf') SS.render(); } catch (e) { if (!silent) STK.fail(e); }
}
SS.readStats = readStats;
SS.netRun = async function () {
  const id = STK.sel(); if (!id || S.netBusy) return; S.netBusy = true; SS.render();
  try { S.net = await STK.api('/net-check?id=' + enc(id), { timeout: 60000 }); if (S.net.reachable) { S.netHist.push({ t: Date.now(), ms: S.net.avgMs, loss: S.net.lossPct }); S.netHist = S.netHist.slice(-30); store.set('sx-nethist', S.netHist); } } catch (e) { STK.fail(e); }
  S.netBusy = false; SS.render();
};

/* ---------- profiles (Turbo, Cool-down, and your own) with Undo ---------- */
const TLABEL = { dnd: 'Do not disturb', animations: 'Animations', stayawake: 'Screen stays awake', touches: 'Show touches', rotation: 'Auto-rotate', autobrightness: 'Auto brightness', wifi: 'Wi-Fi', bluetooth: 'Bluetooth', data: 'Mobile data', dark: 'Dark mode', pointer: 'Pointer location', airplane: 'Airplane mode' };
SS.TLABEL = TLABEL;
SS.PROFILES = [
  { id: 'max', name: 'Max performance', icon: 'rocket', blurb: 'No interruptions, no animations, free memory, high refresh rate and performance mode.', spec: { t: { dnd: true, animations: false, stayawake: true }, lowPower: 0, freemem: true, refresh: 'high', perf: true, gamemode: true } },
  { id: 'balanced', name: 'Balanced', icon: 'gauge', blurb: 'Everyday settings: animations on, performance mode off, automatic refresh rate.', spec: { t: { animations: true, dnd: false }, lowPower: 0, refresh: 'auto', perf: false } },
  { id: 'cool', name: 'Cool-down', icon: 'fan', blurb: 'Lower brightness, battery saver on, memory freed and performance mode off. Tells you when the phone is cool.', spec: { brightness: 45, lowPower: 1, freemem: true, perf: false, refresh: 'auto' } },
  { id: 'stream', name: 'Stream and record', icon: 'camera', blurb: 'Do not disturb, taps shown, screen kept on and performance mode for clean captures.', spec: { t: { dnd: true, touches: true, stayawake: true }, lowPower: 0, perf: true } },
  { id: 'saver', name: 'Battery saver', icon: 'bolt', blurb: 'Battery saver on, dim screen, animations off and a lower refresh rate.', spec: { t: { animations: false }, brightness: 60, lowPower: 1, refresh: 'auto', perf: false } }
];
SS.allProfiles = () => SS.PROFILES.concat((STK.kv.get('sxprofiles', []) || []).map(p => ({ ...p, custom: true, icon: p.icon || 'sliders' })));
function buildSteps(sp, pkg, prev) {
  const st = [];
  Object.keys(sp.t || {}).forEach(k => st.push({ label: TLABEL[k] + (sp.t[k] ? ' on' : ' off'), run: () => tog(k, !!sp.t[k]), key: k }));
  if (num(sp.brightness)) st.push({ label: 'Brightness ' + Math.round(sp.brightness / 2.55) + '%', run: () => gt({ action: 'setstate', brightnessMode: 0, brightness: Math.max(1, Math.min(255, Math.round(sp.brightness))) }), touch: 'brightness' });
  if (sp.lowPower === 0 || sp.lowPower === 1) st.push({ label: sp.lowPower ? 'Battery saver on' : 'Battery saver off', run: () => gt({ action: 'setstate', lowPower: sp.lowPower }), touch: 'lowpower' });
  if (sp.freemem) st.push({ label: 'Free memory', run: () => gt({ action: 'freemem' }) });
  if (sp.refresh === 'high') st.push({ label: 'Lock high refresh rate', run: () => gt({ action: 'refresh', on: true }), touch: 'refresh' });
  if (sp.refresh === 'auto') st.push({ label: 'Automatic refresh rate', run: () => gt({ action: 'refresh', on: false }), touch: 'refresh' });
  if (sp.perf === true || sp.perf === false) st.push({ label: sp.perf ? 'Performance mode' : 'Performance mode off', run: () => gt({ action: 'perfmode', on: !!sp.perf }), perf: sp.perf });
  if (sp.gamemode && pkg) st.push({ label: 'Android Game Mode', run: () => gt({ action: 'gamemode', pkg, mode: 'performance' }), gm: true });
  return st;
}
SS.applyProfile = async function (idOrProfile, opts = {}) {
  const sid = STK.sel(); if (!sid) return STK.toast('Connect a phone first.', 'bad');
  if (S.busy) return;
  const p = typeof idOrProfile === 'string' ? SS.allProfiles().find(x => x.id === idOrProfile) : idOrProfile; if (!p) return;
  if (S.profile) await SS.revertProfile(true);
  S.busy = p.id; S.steps = []; S.stepPct = 0; SS.render();
  const pkg = opts.pkg || S.pkg || '';
  const prev = { serial: sid, at: Date.now(), pkg, toggles: null, sys: null, gm: false, perf: false, touched: {}, keys: [] };
  try { const t = await STK.api('/toggles?id=' + enc(sid), { timeout: 30000 }); prev.toggles = t.toggles || {}; prev.ext = { brightness: t.brightness }; } catch (e) { /* optional */ }
  try { prev.sys = (await gt({ action: 'getstate' })).state; } catch (e) { /* optional */ }
  const steps = buildSteps(p.spec, pkg, prev);
  S.steps = steps.map(s => ({ label: s.label, st: 'wait', note: '' })); SS.paintSteps();
  let ok = 0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]; S.steps[i].st = 'run'; SS.paintSteps();
    try {
      const r = await s.run(); const good = !r || r.applied !== false;
      S.steps[i].st = good ? 'ok' : 'skip'; if (!good) S.steps[i].note = (r && r.message) || '';
      if (good) { ok++; if (s.key) prev.keys.push(s.key); if (s.touch) prev.touched[s.touch] = true; if (s.perf === true) prev.perf = true; if (s.gm) prev.gm = true; }
    } catch (e) { S.steps[i].st = 'skip'; S.steps[i].note = e.message; }
    S.stepPct = Math.round((i + 1) / steps.length * 100); SS.paintSteps(); await sleep(140);
  }
  S.profile = { id: p.id, name: p.name, icon: p.icon, at: Date.now(), prev, ok, total: steps.length };
  store.set('sx-profile', S.profile); S.busy = ''; S.coolNotified = false;
  logEvent('profile', p.name + ' applied: ' + ok + ' of ' + steps.length + ' changes.', ok ? 'ok' : 'warn');
  STK.toast(p.name + ' is on: ' + ok + ' of ' + steps.length + ' changes applied.');
  SS.loadToggles(); pollPerf(true); SS.render();
  if (opts.after) opts.after();
};
SS.revertProfile = async function (silent) {
  const pr = S.profile; if (!pr || (S.busy && !silent)) return;
  if (!silent) { S.busy = 'undo'; SS.render(); }
  const t = pr.prev || {}, pv = t.toggles || {}, run = async fn => { try { await fn(); } catch (e) { /* keep restoring the rest */ } };
  for (const k of (t.keys || [])) if (pv[k] !== undefined) await run(() => tog(k, !!pv[k]));
  if (t.sys) {
    const s = t.sys, body = { action: 'setstate' };
    if (t.touched && t.touched.lowpower) body.lowPower = s.lowPower === '1' ? 1 : s.lowPower === '0' ? 0 : undefined;
    if (t.touched && t.touched.refresh) { body.minRefresh = s.minRefresh || ''; body.peakRefresh = s.peakRefresh || ''; }
    if (t.touched && t.touched.brightness) { if (s.brightness) body.brightness = Number(s.brightness); if (s.brightnessMode === '0' || s.brightnessMode === '1') body.brightnessMode = Number(s.brightnessMode); }
    if (Object.keys(body).length > 1) await run(() => gt(body));
  } else if (t.touched && t.touched.refresh) await run(() => gt({ action: 'refresh', on: false }));
  if (t.perf) await run(() => gt({ action: 'perfmode', on: false }));
  if (t.gm && t.pkg) await run(() => gt({ action: 'gamemode', pkg: t.pkg, mode: 'standard' }));
  S.profile = null; S.steps = []; store.set('sx-profile', null); if (!silent) { S.busy = ''; logEvent('profile', pr.name + ' undone. Settings restored.', 'info'); STK.toast(pr.name + ' undone. Your settings were restored.'); SS.loadToggles(); SS.render(); }
};
SS.saveCustom = async function () {
  if (!STK.sel()) return STK.toast('Connect a phone first.', 'bad');
  const f = await STK.form('Save current settings as a profile',
    STK.field('name', 'Profile name', '') + STK.check('freemem', 'Free memory when applied', false) + STK.check('perf', 'Turn on performance mode', false) + STK.check('high', 'Lock the high refresh rate', false) +
    '<p class="hint">Saves the current state of the quick switches, the brightness and battery saver. Applying it later sets the phone to these values, and Undo restores what you had.</p>', 'Save');
  if (!f) return; const name = f.name.trim().slice(0, 32); if (!name) return STK.toast('Give the profile a name.', 'bad');
  let sys = null; try { sys = (await gt({ action: 'getstate' })).state; } catch (e) { /* optional */ }
  const t = {}; ['dnd', 'animations', 'stayawake', 'touches', 'rotation', 'autobrightness', 'wifi', 'bluetooth', 'dark'].forEach(k => { if (S.toggles && S.toggles[k] !== undefined) t[k] = !!S.toggles[k]; });
  const spec = { t, freemem: f.freemem, refresh: f.high ? 'high' : undefined, perf: f.perf ? true : undefined };
  if (num(S.ext.brightness) && S.ext.brightness > 0 && !(S.toggles && S.toggles.autobrightness)) spec.brightness = S.ext.brightness;
  if (sys && (sys.lowPower === '0' || sys.lowPower === '1')) spec.lowPower = Number(sys.lowPower);
  const list = (STK.kv.get('sxprofiles', []) || []).concat([{ id: 'c' + Date.now().toString(36), name, spec }]).slice(-8);
  STK.kv.set('sxprofiles', list); STK.toast('Profile "' + name + '" saved.'); SS.render();
};
SS.deleteCustom = id => { STK.kv.set('sxprofiles', (STK.kv.get('sxprofiles', []) || []).filter(p => p.id !== id)); SS.render(); };

/* ---------- sessions: games and the manual recorder ---------- */
function downsample(a, n) {
  if (a.length <= n) return a.map(p => ({ ...p }));
  const out = [], w = a.length / n;
  for (let i = 0; i < n; i++) {
    const sl = a.slice(Math.floor(i * w), Math.max(Math.floor(i * w) + 1, Math.floor((i + 1) * w))), o = { t: sl[0].t };
    ['phone', 'cpu', 'fps', 'ram', 'bat'].forEach(k => { const v = sl.map(x => x[k]).filter(num); o[k] = v.length ? Math.round(v.reduce((x, y) => x + y, 0) / v.length * 10) / 10 : null; });
    out.push(o);
  }
  return out;
}
const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : null;
function makeSession(src) {
  const temps = src.samples.map(x => x.phone).filter(num), fps = src.samples.map(x => x.fps).filter(x => num(x) && x > 0), l = L();
  const secs = Math.round((Date.now() - src.start) / 1000);
  return { pkg: src.pkg, name: src.name, start: src.start, secs, manual: !!src.manual, peak: temps.length ? Math.max(...temps) : null, avg: avg(temps), batStart: src.batStart, batEnd: l && l.battery >= 0 ? l.battery : null, fps: fps.length ? Math.round(avg(fps)) : null, minFps: fps.length ? Math.min(...fps) : null, samples: downsample(src.samples, 120) };
}
const saveSession = rec => { STK.kv.set('gamesessions', [...(STK.kv.get('gamesessions', []) || []), rec].slice(-60)); };
SS.startRec = function () {
  if (S.rec || !STK.sel()) return; const l = L(), pkg = targetPkg();
  S.rec = { start: Date.now(), pkg, name: pkg ? nice(pkg) : 'Phone', manual: true, samples: [], batStart: l && l.battery >= 0 ? l.battery : null };
  logEvent('rec', 'Started recording performance' + (pkg ? ' for ' + nice(pkg) : '') + '.', 'info'); STK.toast('Performance recording started.'); SS.render();
};
SS.stopRec = function () {
  const r = S.rec; if (!r) return; S.rec = null;
  if (r.samples.length < 2) { STK.toast('Recording was too short to save.', 'bad'); return SS.render(); }
  const rec = makeSession(r); saveSession(rec); logEvent('rec', 'Saved a ' + STK.dur(rec.secs) + ' performance recording.', 'ok'); STK.toast('Recording saved to Session history.', 'ok', { label: 'Open', run: () => { S.tab = 'games'; store.set('studio-tab', 'games'); SS.render(); SS.openSession(-1); } }); SS.render();
};

async function ensureApps() { if (S.apps) return S.apps; try { S.apps = (await STK.api(`/apps?id=${enc(STK.sel())}&scope=user`, { timeout: 60000 })).apps || []; } catch (e) { S.apps = []; } return S.apps; }
SS.ensureApps = ensureApps;
SS.editGame = async function (i) {
  const g = i >= 0 ? games()[i] : {}, apps = await ensureApps();
  const presets = [['', 'Keep my settings'], ...(((state.schema && state.schema.presets) || []).map(p => [p.id, p.name]))];
  const f = await STK.form(i >= 0 ? 'Edit game' : 'Add a game',
    `<label class="ff"><span>App</span><input name="pkg" list="g-list" value="${esc(g.pkg || '')}" placeholder="Start typing the game name" autocomplete="off" spellcheck="false"></label><datalist id="g-list">${apps.map(a => `<option value="${esc(a.package)}">${esc(a.label || nice(a.package))}</option>`).join('')}</datalist>` +
    STK.field('name', 'Display name (optional)', g.name || '') + STK.select('preset', 'Capture preset', presets, g.preset || 'latency') +
    STK.check('mirror', 'Start mirroring', g.mirror) + STK.check('record', 'Start recording', g.record !== false) + STK.check('dnd', 'Turn on Do not disturb', g.dnd !== false) + STK.check('touches', 'Show touches', !!g.touches) + STK.check('freemem', 'Free memory when the game starts', !!g.freemem) + STK.check('smooth', 'Lock the high refresh rate', !!g.smooth) + STK.check('gamemode', 'Try Android Game Mode: performance', !!g.gamemode), 'Save');
  if (!f) return; const pkg = f.pkg.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(pkg)) return STK.toast('Use the package name, like com.tencent.ig. Pick one from the list.', 'bad');
  const entry = { pkg, name: f.name.trim().slice(0, 40), preset: f.preset, mirror: f.mirror, record: f.record, dnd: f.dnd, touches: f.touches, freemem: f.freemem, smooth: f.smooth, gamemode: f.gamemode, on: g.on !== false };
  const list = games().slice(); if (i >= 0) list[i] = entry; else list.push(entry);
  STK.kv.set('games', list.slice(0, 30)); SS.render();
};
async function setT(serial, key, value) { try { await STK.post('/toggle', { serial, key, value }, { timeout: 30000 }); } catch (e) { /* the phone may refuse; continue */ } }
async function enter(serial, g) {
  if (S.entering[serial]) return; S.entering[serial] = true; const l = L();
  const a = S.active[serial] = { pkg: g.pkg, g, prevSettings: null, prevToggles: null, prevSys: null, rec: false, mir: false, gm: false, smooth: false, startedAt: Date.now(), samples: [], batStart: l && l.battery >= 0 ? l.battery : null };
  S.misses[serial] = 0; if (state.view === 'studio') SS.render();
  STK.toast('Game mode on: ' + (g.name || nice(g.pkg))); logEvent('game', 'Game profile started for ' + (g.name || nice(g.pkg)) + '.', 'ok');
  try {
    try { const t = await STK.api('/toggles?id=' + enc(serial), { timeout: 30000 }); a.prevToggles = t.toggles || {}; } catch (e) { /* optional */ }
    if (g.smooth) { try { a.prevSys = (await STK.post('/game-tools', { serial, action: 'getstate' }, { timeout: 30000 })).state; } catch (e) { /* optional */ } }
    if (g.dnd) await setT(serial, 'dnd', true);
    if (g.touches) await setT(serial, 'touches', true);
    if (g.freemem) { try { await STK.post('/game-tools', { serial, action: 'freemem' }, { timeout: 30000 }); } catch (e) { /* optional */ } }
    if (g.smooth) { try { const r = await STK.post('/game-tools', { serial, action: 'refresh', on: true }, { timeout: 30000 }); a.smooth = r.applied !== false; } catch (e) { /* optional */ } }
    if (g.gamemode) { try { const r = await STK.post('/game-tools', { serial, action: 'gamemode', pkg: g.pkg, mode: 'performance' }, { timeout: 30000 }); a.gm = r.applied !== false; if (r.applied === false) STK.logError('game mode', r.message + (r.reply ? ' Phone reply: ' + r.reply : '')); } catch (e) { /* optional */ } }
    const p = ((state.schema && state.schema.presets) || []).find(x => x.id === g.preset);
    if (p) { const prev = {}; for (const k of Object.keys(p.v)) prev[k] = (state.settings || {})[k]; a.prevSettings = prev; try { await STK.post('/settings', { patch: p.v }); await STK.loadSettings(); } catch (e) { STK.fail(e); } }
    if (g.mirror && !STK.mirroring()) { await STK.actions.mirror(); a.mir = true; }
    if (g.record && !STK.recording()) { await STK.actions.record(); a.rec = true; }
  } finally { S.entering[serial] = false; }
}
async function exit(serial) {
  const a = S.active[serial]; if (!a) return;
  delete S.active[serial]; delete S.misses[serial]; if (state.view === 'studio') SS.render();
  try {
    const secs = Math.round((Date.now() - (a.startedAt || Date.now())) / 1000);
    if (secs >= 10) {
      const pt = { ...(STK.kv.get('playtime', {}) || {}) }; pt[a.pkg] = (pt[a.pkg] || 0) + secs; STK.kv.set('playtime', pt);
      saveSession(makeSession({ pkg: a.pkg, name: a.g.name || nice(a.pkg), start: a.startedAt, samples: a.samples, batStart: a.batStart }));
    }
  } catch (e) { /* history is optional */ }
  STK.toast('Game mode off. Settings restored.'); logEvent('game', 'Game profile ended for ' + (a.g.name || nice(a.pkg)) + '.', 'info');
  if (a.gm) { try { await STK.post('/game-tools', { serial, action: 'gamemode', pkg: a.pkg, mode: 'standard' }, { timeout: 30000 }); } catch (e) { /* ignore */ } }
  if (a.smooth) { try { const s = a.prevSys || {}; await STK.post('/game-tools', { serial, action: 'setstate', minRefresh: s.minRefresh || '', peakRefresh: s.peakRefresh || '' }, { timeout: 30000 }); } catch (e) { /* ignore */ } }
  if (a.rec && STK.recording()) { try { await STK.actions.record(); } catch (e) { /* ignore */ } }
  if (a.mir && STK.mirroring()) { try { await STK.actions.mirror(); } catch (e) { /* ignore */ } }
  if (a.prevToggles) { if (a.g.dnd) await setT(serial, 'dnd', !!a.prevToggles.dnd); if (a.g.touches) await setT(serial, 'touches', !!a.prevToggles.touches); }
  if (a.prevSettings) { try { await STK.post('/settings', { patch: a.prevSettings }); await STK.loadSettings(); } catch (e) { /* ignore */ } }
}
STK.on('live', ({ L: l }) => {
  const serial = STK.sel(); if (!serial || !l) return;
  if (state.view === 'studio') SS.paint();
  const a = S.active[serial], pkg = l.fgPackage;
  if (!a) { const g = games().find(x => x.pkg === pkg && x.on !== false); if (g && pkg) enter(serial, g); }
  else if (pkg && pkg !== a.pkg) { S.misses[serial] = (S.misses[serial] || 0) + 1; if (S.misses[serial] >= 2) exit(serial); }
  else S.misses[serial] = 0;
});

/* ---------- demo mode ---------- */
SS.loadDemo = async function () { const id = STK.sel(); if (!id) { S.demo = false; return; } try { S.demo = (await STK.api('/demo?id=' + enc(id))).on; } catch (e) { /* ignore */ } if (state.view === 'studio' && S.tab === 'capture') SS.render(); };
STK.on('demo', on => { S.demo = on; if (state.view === 'studio' && S.tab === 'capture') SS.render(); });

/* ---------- export ---------- */
SS.exportCsv = function () {
  const h = SS.hist(); if (!h || !h.a.length) return STK.toast('No history yet. Keep the Studio open for a minute first.', 'bad');
  h.save(); const keys = new Set(); h.a.forEach(p => Object.keys(p).forEach(k => { if (k !== 't') keys.add(k); }));
  const cols = [['t', 'time', r => new Date(r.t).toISOString()]].concat([...keys].map(k => [k, k]));
  SX.download('droid-adb-studio-history.csv', SX.csv(h.a, cols)); STK.toast('History saved as CSV (' + h.a.length + ' readings).');
};
SS.clearHistory = async function () {
  if (!await STK.confirm('Clear Studio history?', '<p>This removes the stored graphs for this phone from this browser. Game session history is kept.</p>', 'Clear', true)) return;
  const h = SS.hist(); if (h) h.clear(); S.events = []; store.set('sx-events', []); STK.toast('History cleared.'); SS.render();
};

/* ---------- device changes ---------- */
STK.on('device-changed', () => { S.toggles = null; S.ext = {}; S.stats = null; S.sample = null; S.perf = null; S.lastFrames = null; S.net = null; S.top = null; S.battApps = null; S.apps = null; S.hist = null; if (state.view === 'studio') { SS.render(); SS.loadToggles(); pollPerf(true); } });
SS.save = () => {};
})();
