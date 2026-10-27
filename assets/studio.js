/* DROID ADB 4.0 Performance Studio: shell, live sampling, health score, profiles, suggestions and the Overview and Optimize pages.
   Other Studio pages (Games, Thermals, Network, Capture) live in studio-games.js and studio-more.js and register themselves here. */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const nice = p => (STK.niceApp ? STK.niceApp(p) : p);
const root = () => $('#studio-root');
const N = 90;
const SX = STK.studio = { tabs: [], actions: {}, changes: {} };
const S = SX.S = { tab: STK.store.get('sx-tab', 'overview'), hist: {}, last: {}, busy: false, timer: null, err: null, toggles: null, brightness: -1, apps: null, pkg: STK.store.get('sx-pkg', ''), compat: null, run: null, prev: {}, active: {}, cool: null, gm: null, mounted: false };

/* ---------- small helpers ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = v => (v == null || !isFinite(v) ? null : Number(v));
const OPTS_DEFAULT = { hot: 43, cool: 36 };
SX.opts = () => ({ ...OPTS_DEFAULT, ...(STK.kv.get('perf-opts', {}) || {}) });
SX.games = () => STK.kv.get('games', []);
SX.last = () => S.last[STK.sel()] || null;
SX.hist = id => S.hist[id || STK.sel()] || null;
const H = id => S.hist[id] || (S.hist[id] = { cpu: [], mem: [], temp: [], gpuC: [], skin: [], batC: [], bat: [], t: [] });
const push = (a, v) => { a.push(v == null ? null : v); if (a.length > N) a.shift(); };
SX.tone = (kind, v) => {
  if (v == null) return '';
  const o = SX.opts();
  if (kind === 'temp') return v >= o.hot ? 'bad' : v >= o.hot - 4 ? 'warn' : v <= o.cool - 2 ? 'cool' : 'ok';
  if (kind === 'cpu') return v >= 92 ? 'bad' : v >= 75 ? 'warn' : 'ok';
  if (kind === 'mem') return v >= 90 ? 'bad' : v >= 78 ? 'warn' : 'ok';
  if (kind === 'bat') return v <= 15 ? 'bad' : v <= 30 ? 'warn' : 'ok';
  return 'ok';
};
SX.pkg = () => { const L = STK.live(); return S.pkg || (L && L.fgPackage) || ''; };
SX.setPkg = p => { S.pkg = p || ''; STK.store.set('sx-pkg', S.pkg); };
SX.ensureApps = async function () {
  if (S.apps) return S.apps;
  const id = STK.sel(); if (!id) return [];
  try { S.apps = (await STK.api('/apps?id=' + encodeURIComponent(id) + '&scope=user', { timeout: 60000 })).apps || []; } catch (e) { S.apps = []; }
  return S.apps;
};
SX.W = (id, html) => { const el = document.getElementById(id); if (el) STK.setHtml(el, html); return el; };
SX.empty = (ic, title, text) => `<div class="sx-empty">${icon(ic)}<b>${esc(title)}</b><p>${esc(text)}</p></div>`;
SX.noDevice = () => SX.empty('plug', 'No phone connected', 'Connect a phone on the Devices page and this page comes alive with live performance, cooling and gaming tools.');

/* smooth sparkline with a soft area */
let uid = 0;
SX.spark = function (values, { w = 240, h = 60, min = 0, max = 100, cls = '', bands = [] } = {}) {
  const pts = values.filter(x => x != null && isFinite(x));
  if (pts.length < 2) return `<svg class="sx-spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"></svg>`;
  let lo = min, hi = max;
  if (hi == null) hi = Math.max(1, ...pts) * 1.15;
  if (lo == null) { lo = Math.min(...pts) - 2; hi = Math.max(hi, Math.max(...pts) + 2); }
  const n = values.length, step = w / Math.max(1, n - 1), Y = v => h - 4 - (clamp(v, lo, hi) - lo) / ((hi - lo) || 1) * (h - 8);
  let d = '', first = null, last = null;
  values.forEach((x, i) => { if (x == null || !isFinite(x)) return; const px = (i * step).toFixed(1); d += (d ? 'L' : 'M') + px + ' ' + Y(x).toFixed(1); if (first === null) first = px; last = px; });
  const g = 'sg' + (++uid);
  return `<svg class="sx-spark ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".32"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><path d="${d}L${last} ${h}L${first} ${h}Z" fill="url(#${g})"/><path class="ln" d="${d}"/></svg>`;
};
/* 270 degree gauge ring. pct 0-100 */
SX.ring = function (pct, { tone = 'ok', stroke = 8 } = {}) {
  const r = 42, C = 2 * Math.PI * r, sweep = .75 * C, p = clamp(pct == null ? 0 : pct, 0, 100) / 100;
  return `<svg class="sx-ring ${tone}" viewBox="0 0 100 100" aria-hidden="true"><circle class="trk" cx="50" cy="50" r="${r}" stroke-width="${stroke}" stroke-dasharray="${sweep.toFixed(1)} ${C.toFixed(1)}" transform="rotate(135 50 50)"/><circle class="val" cx="50" cy="50" r="${r}" stroke-width="${stroke}" stroke-dasharray="${(sweep * p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(135 50 50)"/></svg>`;
};
SX.meter = (pct, tone = '') => `<i class="sx-bar ${tone}"><u style="width:${clamp(pct || 0, 0, 100).toFixed(0)}%"></u></i>`;
SX.card = (cls, title, sub, body, right = '') => `<section class="sx-card ${cls}"><header class="sx-card-head"><div><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${right}</header>${body}</section>`;
SX.kv = rows => `<dl class="sx-kv">${rows.filter(Boolean).map(([k, v, t]) => `<div><dt>${esc(k)}</dt><dd class="${t || ''}">${v}</dd></div>`).join('')}</dl>`;
SX.seg = (name, items, cur, extra = '') => `<div class="sx-seg" role="group" ${extra}>${items.map(([v, l]) => `<button type="button" class="${String(v) === String(cur) ? 'is-active' : ''}" data-sx="${name}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;

/* ---------- health score and thermal wording ---------- */
SX.thermalWord = s => ['Normal', 'Light throttling', 'Moderate throttling', 'Heavy throttling', 'Critical', 'Emergency', 'Shutdown risk'][s] || 'Unknown';
SX.score = function (r, jank) {
  if (!r) return null;
  const o = SX.opts(); let s = 100;
  const t = r.tempC; if (t != null && t > o.cool) s -= Math.min(48, (t - o.cool) * 4.2);
  if (r.thermalStatus >= 2) s -= 20; else if (r.thermalStatus === 1) s -= 6;
  if (r.cpu != null && r.cpu > 88) s -= 8;
  if (r.memPct != null) { if (r.memPct > 90) s -= 12; else if (r.memPct > 80) s -= 5; }
  if (r.battery != null && r.battery <= 15 && !r.charging) s -= 10;
  if (r.storage && r.storage.usedPct > 93) s -= 6;
  if (jank != null && jank > 15) s -= 8;
  return Math.round(clamp(s, 0, 100));
};
SX.scoreInfo = function (sc) {
  if (sc == null) return { tone: '', word: 'Waiting for the phone' };
  if (sc >= 85) return { tone: 'ok', word: 'Ready to game' };
  if (sc >= 70) return { tone: 'ok', word: 'Running well' };
  if (sc >= 50) return { tone: 'warn', word: 'Getting warm' };
  return { tone: 'bad', word: 'Cool it down' };
};

/* ---------- talking to the phone ---------- */
SX.tool = async function (body, o = {}) {
  const id = STK.sel();
  if (!id) { if (!o.quiet) STK.toast('Connect a phone first.', 'bad'); if (o.quiet) throw new Error('No phone connected.'); return null; }
  try {
    const r = await STK.post('/perf-tools', { serial: id, ...body }, { timeout: o.timeout || 45000 });
    if (!o.quiet) STK.toast(r.message || 'Done.', r.applied === false ? 'bad' : 'ok');
    return r;
  } catch (e) { if (o.quiet) throw e; STK.fail(e); return null; }
};
SX.setToggle = async function (key, value, o = {}) {
  const id = STK.sel(); if (!id) return null;
  try { const r = await STK.post('/toggle', { serial: id, key, value }, { timeout: 30000 }); if (r && r.toggles) S.toggles = r.toggles; return r; }
  catch (e) { if (o.quiet) throw e; STK.fail(e); return null; }
};
SX.loadToggles = async function () {
  const id = STK.sel(); if (!id) return;
  try { const t = await STK.api('/toggles?id=' + encodeURIComponent(id), { timeout: 30000 }); S.toggles = t.toggles || {}; S.brightness = t.brightness == null ? -1 : t.brightness; } catch (e) { S.toggles = null; }
  if (state.view === 'studio') SX.refresh();
};

/* ---------- live sampling ---------- */
async function sample(force) {
  if (S.busy) return;
  if (!force && (state.view !== 'studio' || document.hidden)) return;
  const id = STK.sel();
  if (!id) { paintAll(); return; }
  S.busy = true;
  try {
    const r = await STK.api('/perf?id=' + encodeURIComponent(id), { timeout: 30000 });
    const h = H(id);
    push(h.cpu, r.cpu); push(h.mem, r.memPct); push(h.temp, r.tempC); push(h.gpuC, r.gpuC); push(h.skin, r.skinC); push(h.batC, r.batteryC); push(h.bat, r.battery); push(h.t, r.at);
    S.last[id] = r; S.err = null;
    trackCooldown(id, r);
    STK.emit('sx-sample', r);
  } catch (e) { S.err = e.network ? null : e.message; }
  S.busy = false;
  paintAll();
}
SX.sample = sample;
function start() { stop(); sample(true); S.timer = setInterval(sample, 2600); }
function stop() { clearInterval(S.timer); S.timer = null; }

function trackCooldown(id, r) {
  const c = S.cool; if (!c || c.serial !== id || c.done || r.tempC == null) return;
  c.now = r.tempC; c.low = Math.min(c.low, r.tempC);
  if (r.tempC <= SX.opts().cool && Date.now() - c.t0 > 20000) {
    c.done = true; c.t1 = Date.now();
    const mins = Math.max(1, Math.round((c.t1 - c.t0) / 60000));
    STK.toast('Cooled down to ' + r.tempC.toFixed(0) + ' °C in about ' + mins + ' min. Ready to play again.');
    STK.notify && STK.notify('Phone cooled down', r.tempC.toFixed(0) + ' °C', 'cooled');
  }
}

/* ---------- profiles ---------- */
const maxHz = () => { const r = SX.last(); const l = r && r.supportedHz || []; return l.length ? Math.max(...l) : 0; };
SX.PROFILES = [
  { id: 'balanced', name: 'Balanced', ic: 'sliders', tone: 'ok', note: 'Everything back to normal', steps: [
    { l: 'Performance mode off', k: 'tool', soft: 1, body: { action: 'perfmode', on: false } }, { l: 'Refresh rate automatic', k: 'tool', soft: 1, body: { action: 'refresh', hz: 0 } },
    { l: 'Normal animations', k: 'tool', body: { action: 'animscale', value: '1' } }, { l: 'Battery saver off', k: 'tool', soft: 1, body: { action: 'lowpower', on: false } }] },
  { id: 'gaming', name: 'Gaming', ic: 'game', tone: 'accent', note: 'Smooth, quiet and focused', steps: [
    { l: 'Silence notifications', k: 'toggle', key: 'dnd', value: true }, { l: 'Faster animations', k: 'tool', body: { action: 'animscale', value: '0.5' } },
    { l: 'Best refresh rate', k: 'hzmax', soft: 1 }, { l: 'Battery saver off', k: 'tool', soft: 1, body: { action: 'lowpower', on: false } },
    { l: 'Free memory', k: 'tool', body: { action: 'boost' } }] },
  { id: 'turbo', name: 'Turbo', ic: 'rocket', tone: 'hot', note: 'Maximum speed, runs warmer', steps: [
    { l: 'Silence notifications', k: 'toggle', key: 'dnd', value: true }, { l: 'Animations off', k: 'tool', body: { action: 'animscale', value: '0' } },
    { l: 'Best refresh rate', k: 'hzmax', soft: 1 }, { l: 'Battery saver off', k: 'tool', soft: 1, body: { action: 'lowpower', on: false } },
    { l: 'Fixed performance mode', k: 'tool', soft: 1, body: { action: 'perfmode', on: true } }, { l: 'Keep screen awake', k: 'toggle', key: 'stayawake', value: true },
    { l: 'Free memory', k: 'tool', body: { action: 'boost' } }, { l: 'Game Mode: performance', k: 'gamemode', soft: 1 }] },
  { id: 'cool', name: 'Cool', ic: 'snow', tone: 'cool', note: 'Lower heat, steadier frames', steps: [
    { l: 'Performance mode off', k: 'tool', soft: 1, body: { action: 'perfmode', on: false } }, { l: 'Refresh rate 60 Hz', k: 'tool', soft: 1, body: { action: 'refresh', hz: 60 } },
    { l: 'Dim the screen a little', k: 'bright', value: 110 }, { l: 'Free memory', k: 'tool', body: { action: 'boost' } }, { l: 'Battery saver on', k: 'tool', soft: 1, body: { action: 'lowpower', on: true } }] },
  { id: 'saver', name: 'Battery saver', ic: 'battery', tone: 'ok', note: 'Make the charge last', steps: [
    { l: 'Battery saver on', k: 'tool', soft: 1, body: { action: 'lowpower', on: true } }, { l: 'Refresh rate 60 Hz', k: 'tool', soft: 1, body: { action: 'refresh', hz: 60 } },
    { l: 'Performance mode off', k: 'tool', soft: 1, body: { action: 'perfmode', on: false } }, { l: 'Faster animations', k: 'tool', body: { action: 'animscale', value: '0.5' } }] },
  { id: 'record', name: 'Record', ic: 'record', tone: 'rec', note: 'Stable for capture', steps: [
    { l: 'Silence notifications', k: 'toggle', key: 'dnd', value: true }, { l: 'Show touches', k: 'toggle', key: 'touches', value: true },
    { l: 'Keep screen awake', k: 'toggle', key: 'stayawake', value: true }, { l: 'Fixed performance mode', k: 'tool', soft: 1, body: { action: 'perfmode', on: true } }, { l: 'Free memory', k: 'tool', body: { action: 'boost' } }] }
];
const activeKey = () => 'sx-active:' + STK.sel();
SX.activeProfile = () => STK.store.get(activeKey(), '');
async function runStep(st, pkg) {
  if (st.k === 'tool') return SX.tool(st.body, { quiet: true, timeout: 60000 });
  if (st.k === 'toggle') return SX.setToggle(st.key, st.value, { quiet: true });
  if (st.k === 'bright') { const id = STK.sel(); return STK.post('/toggle', { serial: id, key: 'brightness', value: st.value }, { timeout: 30000 }); }
  if (st.k === 'hzmax') { const hz = maxHz(); if (hz <= 60) return { skipped: 'This screen has no higher refresh rate.' }; return SX.tool({ action: 'refresh', hz }, { quiet: true }); }
  if (st.k === 'gamemode') { if (!pkg) return { skipped: 'No game selected. Pick one on the Optimize page.' }; const r = await SX.tool({ action: 'gamemode', pkg, mode: 'performance' }, { quiet: true }); if (r && r.applied === false) return { skipped: r.message }; return r; }
  return null;
}
/* Applies a profile step by step with live progress. opts: { quiet, pkg } */
SX.applyProfile = async function (pid, opts = {}) {
  const id = STK.sel(); if (!id) return STK.toast('Connect a phone first.', 'bad');
  const p = SX.PROFILES.find(x => x.id === pid); if (!p) return;
  if (S.run && S.run.busy) return STK.toast('A profile is still being applied. One moment.');
  const run = S.run = { id: pid, name: p.name, busy: true, steps: p.steps.map(s => ({ l: s.l, st: 'wait', note: '' })) };
  paintRun();
  // remember what the phone looked like so the profile can be undone
  if (pid !== 'balanced' && !S.prev[id]) {
    const r = SX.last() || {};
    let tg = S.toggles;
    try { const t = await STK.api('/toggles?id=' + encodeURIComponent(id), { timeout: 30000 }); tg = S.toggles = t.toggles || {}; S.brightness = t.brightness == null ? -1 : t.brightness; } catch (e) { /* keep what we have */ }
    S.prev[id] = { anim: r.animScale, lowPower: !!r.lowPower, lockMin: r.lockMin, lockPeak: r.lockPeak, brightness: S.brightness, dnd: !!(tg && tg.dnd), touches: !!(tg && tg.touches), stayawake: !!(tg && tg.stayawake) };
  }
  let ok = 0, skipped = 0, failed = 0;
  for (let i = 0; i < p.steps.length; i++) {
    run.steps[i].st = 'run'; paintRun();
    try {
      const r = await runStep(p.steps[i], opts.pkg || SX.pkg());
      if (r && r.skipped) { run.steps[i].st = 'skip'; run.steps[i].note = r.skipped; skipped++; }
      else { run.steps[i].st = 'ok'; run.steps[i].note = (r && r.message) || ''; ok++; }
    } catch (e) {
      const raw = e && e.message ? e.message : 'The phone refused.';
      if (p.steps[i].soft) { run.steps[i].st = 'skip'; run.steps[i].note = raw; skipped++; } else { run.steps[i].st = 'fail'; run.steps[i].note = raw; failed++; }
    }
    paintRun();
  }
  run.busy = false;
  STK.store.set(activeKey(), pid === 'balanced' ? '' : pid);
  if (pid === 'balanced') delete S.prev[id];
  if (!opts.quiet) STK.toast(p.name + ' profile applied' + (skipped ? ' (' + skipped + ' step' + (skipped > 1 ? 's' : '') + ' not supported by this phone)' : '') + (failed ? ', ' + failed + ' failed' : '') + '.', failed ? 'bad' : 'ok');
  SX.loadToggles();
  setTimeout(() => sample(true), 600);
  SX.refresh();
  return { ok, skipped, failed };
};
SX.restoreProfile = async function () {
  const id = STK.sel(), pv = S.prev[id]; if (!id) return;
  if (!pv) return SX.applyProfile('balanced');
  const run = S.run = { id: 'restore', name: 'Restore', busy: true, steps: [] };
  const steps = [
    ['Animations back', () => SX.tool({ action: 'animscale', value: pv.anim == null || pv.anim >= .9 ? '1' : pv.anim <= .1 ? '0' : '0.5' }, { quiet: true })],
    ['Battery saver as before', () => SX.tool({ action: 'lowpower', on: !!pv.lowPower }, { quiet: true })],
    ['Refresh rate as before', () => SX.tool({ action: 'refresh', hz: pv.lockPeak && pv.lockMin && pv.lockPeak === pv.lockMin ? pv.lockPeak : 0 }, { quiet: true })],
    ['Performance mode off', () => SX.tool({ action: 'perfmode', on: false }, { quiet: true })],
    ['Do not disturb as before', () => SX.setToggle('dnd', pv.dnd, { quiet: true })],
    ['Show touches as before', () => SX.setToggle('touches', pv.touches, { quiet: true })],
    ['Stay awake as before', () => SX.setToggle('stayawake', pv.stayawake, { quiet: true })]
  ];
  if (pv.brightness > 0) steps.push(['Brightness as before', () => STK.post('/toggle', { serial: id, key: 'brightness', value: pv.brightness }, { timeout: 30000 })]);
  run.steps = steps.map(s => ({ l: s[0], st: 'wait', note: '' })); paintRun();
  for (let i = 0; i < steps.length; i++) { run.steps[i].st = 'run'; paintRun(); try { await steps[i][1](); run.steps[i].st = 'ok'; } catch (e) { run.steps[i].st = 'skip'; run.steps[i].note = e.message; } paintRun(); }
  run.busy = false; delete S.prev[id]; STK.store.set(activeKey(), '');
  STK.toast('Your phone settings were restored.');
  SX.loadToggles(); setTimeout(() => sample(true), 600); SX.refresh();
};
function paintRun() {
  const el = document.getElementById('w-run'); if (!el) return;
  const r = S.run;
  if (!r) { STK.setHtml(el, ''); return; }
  const mark = s => s === 'ok' ? icon('check', 'sm') : s === 'run' ? '<i class="sx-spin"></i>' : s === 'skip' ? icon('info', 'sm') : s === 'fail' ? icon('alert', 'sm') : '<i class="sx-dot"></i>';
  STK.setHtml(el, `<div class="sx-run ${r.busy ? 'busy' : ''}"><header><b>${r.busy ? 'Applying' : 'Applied'} ${esc(r.name)}</b>${r.busy ? '' : '<button class="btn sm ghost" data-sx="closerun" type="button">Dismiss</button>'}</header><ol>${r.steps.map(s => `<li class="${s.st}"><span class="m">${mark(s.st)}</span><span class="t">${esc(s.l)}${s.note && s.st !== 'ok' ? `<small>${esc(s.note)}</small>` : ''}</span></li>`).join('')}</ol></div>`);
}

/* ---------- boost and cool down ---------- */
SX.boost = async function (btn) {
  return STK.busy(btn, async () => { const r = await SX.tool({ action: 'boost' }, { timeout: 60000 }); if (r) setTimeout(() => sample(true), 400); return r; });
};
SX.cooldown = async function (btn) {
  const id = STK.sel(); if (!id) return STK.toast('Connect a phone first.', 'bad');
  const r = SX.last();
  S.cool = { serial: id, t0: Date.now(), temp0: r && r.tempC != null ? r.tempC : null, low: r && r.tempC != null ? r.tempC : 99, now: r && r.tempC, done: false };
  STK.emit('sx-cool');
  await STK.busy(btn, () => SX.applyProfile('cool', { quiet: true }));
  STK.toast('Cool-down started. Take the phone out of its case and let it rest; the Thermals page tracks the drop.');
};

/* ---------- smart suggestions ---------- */
SX.suggestions = function () {
  const r = SX.last(); if (!r) return [];
  const o = SX.opts(), T = S.toggles || {}, t = r.tempC, out = [];
  const eta = SX.heatEta && SX.heatEta();
  if (t != null && t >= o.hot) out.push({ tone: 'bad', ic: 'thermo', title: 'Phone is hot (' + t.toFixed(0) + ' °C)', text: 'Heat makes Android slow the phone down. Let it rest, take it out of its case, or cool it now.', act: ['Cool down', 'cool'] });
  else if (t != null && t >= o.hot - 4) out.push({ tone: 'warn', ic: 'thermo', title: 'Getting warm (' + t.toFixed(0) + ' °C)', text: eta ? 'At this rate it reaches ' + o.hot + ' °C in about ' + eta + ' min. Switch to the Cool profile to stay smooth.' : 'Switch to the Cool profile to keep frame rates steady.', act: ['Cool profile', 'profile:cool'] });
  if (r.thermalStatus >= 2) out.push({ tone: 'bad', ic: 'alert', title: 'The phone is throttling', text: 'Android reports "' + SX.thermalWord(r.thermalStatus) + '". Frame rate drops until the phone cools.', act: ['Cool down', 'cool'] });
  if (r.charging && t != null && t >= o.hot - 6) out.push({ tone: 'warn', ic: 'bolt', title: 'Charging adds heat', text: 'Playing while plugged in warms the battery. Unplug, or use a slower charger, for steadier speed.' });
  if (r.memPct != null && r.memPct >= 85) out.push({ tone: 'warn', ic: 'ram', title: 'Memory is tight (' + Math.round(r.memPct) + '% used)', text: 'Low free memory makes games reload and stutter. Closing background apps helps.', act: ['Boost memory', 'boost'] });
  if (r.swapTotalMb > 0 && r.swapUsedMb / r.swapTotalMb > .8) out.push({ tone: 'info', ic: 'ram', title: 'Heavy memory swapping', text: 'The phone is leaning on compressed memory. A boost before you start a game keeps it responsive.', act: ['Boost memory', 'boost'] });
  if (r.battery != null && r.battery <= 20 && !r.charging) out.push({ tone: 'warn', ic: 'battery', title: 'Battery is at ' + r.battery + '%', text: 'Low charge can make the phone slow itself down. Plug in, or switch to Battery saver.', act: ['Battery saver', 'profile:saver'] });
  if (r.brightness != null && r.brightness >= 200 && t != null && t >= o.hot - 6) out.push({ tone: 'info', ic: 'sun-moon', title: 'Bright screen adds heat', text: 'The screen is one of the biggest heat sources. A little lower brightness cools the phone.', act: ['Dim screen', 'bright:110'] });
  const mh = maxHz();
  if (mh >= 90 && (r.lockPeak == null || r.lockPeak < mh) && (t == null || t < o.hot - 4)) out.push({ tone: 'info', ic: 'gauge', title: 'Unlock ' + mh + ' Hz', text: 'This screen supports ' + mh + ' Hz. Locking it gives the smoothest touch response in games that support it.', act: ['Lock ' + mh + ' Hz', 'hz:' + mh] });
  if (r.animScale == null || r.animScale > .5) out.push({ tone: 'info', ic: 'bolt', title: 'Faster animations', text: 'Menus and app switches feel snappier with shorter animations.', act: ['Make faster', 'anim:0.5'] });
  if (S.toggles && !T.dnd) out.push({ tone: 'info', ic: 'bell', title: 'Silence notifications', text: 'Do not disturb keeps pop-ups from interrupting a match.', act: ['Turn on', 'dnd'] });
  if (r.wifi && r.wifi.band === '2.4 GHz') out.push({ tone: 'info', ic: 'wifi', title: 'You are on 2.4 GHz Wi-Fi', text: '5 GHz usually gives lower and steadier ping for online games if your router offers it.', act: ['Check network', 'tab:network'] });
  if (r.wifi && r.wifi.rssi <= -75) out.push({ tone: 'warn', ic: 'wifi', title: 'Weak Wi-Fi signal (' + r.wifi.rssi + ' dBm)', text: 'Move closer to the router for lower ping and fewer lag spikes.', act: ['Check network', 'tab:network'] });
  if (r.storage && r.storage.usedPct >= 92) out.push({ tone: 'warn', ic: 'folder', title: 'Storage is almost full', text: r.storage.freeGb + ' GB left. A full phone loads games slowly. Clearing app caches frees space.', act: ['Clear caches', 'trim'] });
  if (!SX.games().length) out.push({ tone: 'info', ic: 'game', title: 'Add your games', text: 'Games you add switch on your chosen profile by themselves when you open them.', act: ['Add games', 'tab:games'] });
  const order = { bad: 0, warn: 1, info: 2, ok: 3 };
  out.sort((a, b) => order[a.tone] - order[b.tone]);
  if (!out.length || out.every(x => x.tone === 'info')) out.unshift({ tone: 'ok', ic: 'check', title: 'You are ready to play', text: 'Temperature, memory and battery all look healthy.' });
  return out.slice(0, 6);
};
async function runDo(s, btn) {
  const [k, v] = s.split(':');
  if (k === 'cool') return SX.cooldown(btn);
  if (k === 'profile') return STK.busy(btn, () => SX.applyProfile(v));
  if (k === 'boost') return SX.boost(btn);
  if (k === 'hz') return STK.busy(btn, async () => { await SX.tool({ action: 'refresh', hz: Number(v) }); sample(true); });
  if (k === 'anim') return STK.busy(btn, async () => { await SX.tool({ action: 'animscale', value: v }); sample(true); });
  if (k === 'dnd') return STK.busy(btn, async () => { const r = await SX.setToggle('dnd', true); if (r) STK.toast('Do not disturb is on.'); SX.refresh(); });
  if (k === 'bright') return STK.busy(btn, async () => { try { await STK.post('/toggle', { serial: STK.sel(), key: 'brightness', value: Number(v) }, { timeout: 30000 }); STK.toast('Screen dimmed a little.'); sample(true); } catch (e) { STK.fail(e); } });
  if (k === 'trim') return STK.busy(btn, () => SX.tool({ action: 'trimcaches' }, { timeout: 120000 }));
  if (k === 'tab') return SX.go(v);
}
SX.runDo = runDo;

/* ---------- shell: hero, tabs, body ---------- */
function build() {
  const el = root(); if (!el || S.mounted) return; S.mounted = true;
  el.innerHTML = `<div class="sx">
    <section class="sx-hero" id="sx-hero" data-tone="">
      <div class="sx-score"><div class="sx-ringwrap">
        <svg class="sx-ring big" viewBox="0 0 100 100" aria-hidden="true"><circle class="trk" cx="50" cy="50" r="42" stroke-width="7" stroke-dasharray="197.9 263.9" transform="rotate(135 50 50)"/><circle class="val" id="sx-rv" cx="50" cy="50" r="42" stroke-width="7" stroke-dasharray="0 263.9" transform="rotate(135 50 50)"/></svg>
        <div class="sx-ringtxt"><b id="sx-score">--</b><small>health</small></div></div></div>
      <div class="sx-hero-main">
        <span class="sx-eyebrow">${icon('rocket', 'sm')}Performance Studio</span>
        <h2 id="sx-title">Connect a phone to begin</h2>
        <p class="sx-status" id="sx-status">Live performance, cooling and gaming tools appear here.</p>
        <div class="sx-chips" id="sx-chips"></div>
      </div>
      <div class="sx-metrics">
        ${[['cpu', 'CPU', 'cpu'], ['mem', 'Memory', 'ram'], ['temp', 'Temperature', 'thermo'], ['bat', 'Battery', 'battery'], ['hz', 'Display', 'gauge']].map(([k, l, ic]) => `<div class="sx-m" id="sxm-${k}">${icon(ic, 'sm')}<span class="l">${l}</span><b>--</b><small></small>${SX.meter(0)}</div>`).join('')}
      </div>
      <div class="sx-hero-actions">
        <button class="btn primary lg" id="sx-boost" data-sx="boost" type="button">${icon('rocket', 'sm')}<span>Boost</span></button>
        <button class="btn lg" id="sx-cool" data-sx="cool" type="button">${icon('snow', 'sm')}<span>Cool down</span></button>
      </div>
    </section>
    <nav class="sx-tabs" id="sx-tabs" role="tablist" aria-label="Studio pages"></nav>
    <div class="sx-body" id="sx-body"></div></div>`;
}
SX.register = t => { SX.tabs = SX.tabs.filter(x => x.id !== t.id).concat(t).sort((a, b) => (a.order || 9) - (b.order || 9)); };
const cur = () => SX.tabs.find(t => t.id === S.tab) || SX.tabs[0];
function paintTabs() {
  const el = $('#sx-tabs'); if (!el) return;
  STK.setHtml(el, SX.tabs.map(t => `<button type="button" role="tab" class="sx-tab ${t.id === cur().id ? 'is-active' : ''}" aria-selected="${t.id === cur().id}" data-sx="tab" data-tab="${t.id}">${icon(t.icon, 'sm')}<span>${esc(t.label)}</span></button>`).join(''));
}
SX.go = function (id) {
  if (!SX.tabs.find(t => t.id === id)) return;
  S.tab = id; STK.store.set('sx-tab', id);
  paintTabs(); SX.refresh(true);
  const t = cur(); if (t.onShow) t.onShow();
};
/* Rebuild the body of the open page (static parts). Live parts are painted separately. */
SX.refresh = function (force) {
  if (state.view !== 'studio') return;
  const body = $('#sx-body'), t = cur(); if (!body || !t) return;
  if (!STK.sel()) { STK.setHtml(body, SX.noDevice()); body._t = ''; return; }
  const html = t.render();
  if (force || body._t !== t.id) { body._t = t.id; body._h = ''; }
  const ae = document.activeElement;
  if (!force && ae && body.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) && ae.type !== 'checkbox') { if (t.paint) t.paint(); return; }
  if (body._h !== html) { body._h = html; body.innerHTML = html; }
  if (t.paint) t.paint();
  if (t.after) t.after();
};
SX.paintHeroSoon = () => paintHero();
function paintAll() { paintHero(); const t = cur(); if (t && STK.sel() && t.paint && $('#sx-body') && $('#sx-body')._t === t.id) t.paint(); else if (!STK.sel()) SX.refresh(); }

function setM(k, val, sub, pct, tone) {
  const m = document.getElementById('sxm-' + k); if (!m) return;
  const b = m.querySelector('b'), s = m.querySelector('small'), u = m.querySelector('u');
  if (b.textContent !== val) b.textContent = val; if (s.textContent !== sub) s.textContent = sub;
  u.style.width = clamp(pct || 0, 0, 100) + '%'; m.className = 'sx-m ' + (tone || '');
}
function paintHero() {
  const hero = document.getElementById('sx-hero'); if (!hero) return;
  const id = STK.sel(), r = id ? S.last[id] : null, info = STK.info();
  const jank = SX.jank && SX.jank();
  const sc = r ? SX.score(r, jank) : null, si = SX.scoreInfo(sc);
  hero.dataset.tone = si.tone;
  const rv = document.getElementById('sx-rv'); if (rv) rv.setAttribute('stroke-dasharray', (197.9 * (sc || 0) / 100).toFixed(1) + ' 263.9');
  const sct = document.getElementById('sx-score'); sct.textContent = sc == null ? '--' : sc;
  let name = 'Connect a phone to begin';
  if (id) name = (STK.nickFor && STK.nickFor(id)) || (info && (info.model ? ((info.manufacturer || '') + ' ' + info.model).trim() : id)) || id;
  const tt = document.getElementById('sx-title'); if (tt.textContent !== name) tt.textContent = name;
  let status = id ? (S.err ? S.err : r ? si.word + (r.tempC != null ? ' · ' + r.tempC.toFixed(0) + ' °C' : '') + (r.cpu != null ? ' · CPU ' + Math.round(r.cpu) + '%' : '') : 'Reading the phone...') : 'Live performance, cooling and gaming tools appear here.';
  const st = document.getElementById('sx-status'); if (st.textContent !== status) st.textContent = status;
  const chips = [];
  if (info && info.android) chips.push(`<span class="sx-chip">${icon('phone', 'sm')}Android ${esc(info.android)}${info.sdk ? ' · API ' + esc(info.sdk) : ''}</span>`);
  if (r && r.charging) chips.push(`<span class="sx-chip ok">${icon('bolt', 'sm')}Charging</span>`);
  const ap = id ? SX.activeProfile() : '', pr = SX.PROFILES.find(x => x.id === ap);
  if (pr) chips.push(`<span class="sx-chip accent">${icon(pr.ic, 'sm')}${esc(pr.name)} profile</span>`);
  const L = STK.live(); if (L && L.fgPackage) chips.push(`<span class="sx-chip">${icon('play', 'sm')}${esc(nice(L.fgPackage))}</span>`);
  if (r && r.thermalStatus >= 1) chips.push(`<span class="sx-chip bad">${icon('thermo', 'sm')}${esc(SX.thermalWord(r.thermalStatus))}</span>`);
  STK.setHtml(document.getElementById('sx-chips'), chips.join(''));
  const dis = !id; ['sx-boost', 'sx-cool'].forEach(b => { const e = document.getElementById(b); if (e) e.disabled = dis; });
  const cpu = r && r.cpu, mem = r && r.memPct, t = r && r.tempC, bat = r && r.battery, mh = maxHz();
  setM('cpu', cpu == null ? '--' : Math.round(cpu) + '%', r && r.cores && r.cores.length ? r.cores.filter(c => c.online).length + ' cores active' : '', cpu, SX.tone('cpu', cpu));
  setM('mem', mem == null ? '--' : Math.round(mem) + '%', r && r.memTotalMb ? (r.memUsedMb / 1024).toFixed(1) + ' of ' + (r.memTotalMb / 1024).toFixed(1) + ' GB' : '', mem, SX.tone('mem', mem));
  setM('temp', t == null ? '--' : t.toFixed(0) + ' °C', r ? [r.batteryC != null ? 'Battery ' + r.batteryC.toFixed(0) + '°' : '', r.skinC != null ? 'Skin ' + r.skinC.toFixed(0) + '°' : ''].filter(Boolean).join(' · ') : '', t == null ? 0 : (t - 20) / 35 * 100, SX.tone('temp', t));
  setM('bat', bat == null ? '--' : bat + '%', r ? (r.charging ? 'Charging' : r.plugged ? 'Plugged in' : 'On battery') : '', bat, SX.tone('bat', bat));
  const hzv = r ? (r.lockPeak || mh) : 0;
  setM('hz', hzv ? hzv + ' Hz' : '--', r ? (r.lockPeak ? 'Locked' : mh ? 'Up to ' + mh + ' Hz' : 'Automatic') : '', hzv ? hzv / 1.4 : 0, '');
}

/* ---------- Overview ---------- */
function profilesHtml() {
  const id = STK.sel(), ap = id ? SX.activeProfile() : '', can = !!S.prev[id];
  const cards = SX.PROFILES.map(p => `<button type="button" class="sx-prof tone-${p.tone} ${p.id === ap ? 'is-active' : ''}" data-sx="profile" data-id="${p.id}" ${id ? '' : 'disabled'}><span class="ic-wrap">${icon(p.ic)}</span><b>${esc(p.name)}</b><small>${esc(p.note)}</small>${p.id === ap ? '<em>Active</em>' : ''}</button>`).join('');
  return `<div class="sx-profiles">${cards}</div>${can ? `<div class="sx-restore"><span>${icon('info', 'sm')}Your earlier phone settings were saved when this profile started.</span><button class="btn sm" data-sx="restore" type="button">${icon('refresh', 'sm')}<span>Restore my settings</span></button></div>` : ''}`;
}
function liveCards() {
  const id = STK.sel(), r = SX.last(), h = id && S.hist[id]; if (!r || !h) return '<p class="hint">Reading the phone...</p>';
  const o = SX.opts();
  const card = (label, val, sub, spark, tone, ic) => `<div class="sx-lc ${tone}"><div class="tp"><span class="l">${icon(ic, 'sm')}${label}</span><b>${val}</b></div>${spark}<small>${sub}</small></div>`;
  return card('Processor', r.cpu == null ? '--' : Math.round(r.cpu) + '%', 'Load across all cores', SX.spark(h.cpu, { min: 0, max: 100 }), SX.tone('cpu', r.cpu), 'cpu')
    + card('Memory', r.memPct == null ? '--' : Math.round(r.memPct) + '%', r.memAvailMb != null ? (r.memAvailMb / 1024).toFixed(1) + ' GB free' : '', SX.spark(h.mem, { min: 0, max: 100 }), SX.tone('mem', r.memPct), 'ram')
    + card('Temperature', r.tempC == null ? '--' : r.tempC.toFixed(1) + ' °C', 'Warning at ' + o.hot + ' °C', SX.spark(h.temp, { min: 25, max: 55 }), SX.tone('temp', r.tempC), 'thermo')
    + card('Battery', r.battery == null ? '--' : r.battery + '%', r.charging ? 'Charging' + (r.voltage ? ' · ' + (r.voltage / 1000).toFixed(2) + ' V' : '') : 'Discharging' + (r.voltage ? ' · ' + (r.voltage / 1000).toFixed(2) + ' V' : ''), SX.spark(h.bat, { min: 0, max: 100 }), SX.tone('bat', r.battery), 'battery');
}
function coresHtml() {
  const r = SX.last(); if (!r) return '<p class="hint">Reading the phone...</p>';
  const cores = r.cores || [];
  const rows = cores.length ? `<div class="sx-cores">${cores.map(c => { const pct = c.online && c.maxMhz ? (c.mhz || 0) / c.maxMhz * 100 : 0; return `<div class="sx-core ${c.online ? '' : 'off'}"><span>CPU ${c.id}</span>${SX.meter(pct, pct > 85 ? 'warn' : '')}<b>${c.online && c.mhz ? c.mhz + ' MHz' : 'sleeping'}</b></div>`; }).join('')}</div>` : '<p class="hint">This phone does not share its processor clock speeds.</p>';
  const gpu = r.gpuMHz != null || r.gpuC != null ? SX.kv([r.gpuMHz != null ? ['Graphics clock', r.gpuMHz + ' MHz'] : null, r.gpuBusy != null ? ['Graphics busy', r.gpuBusy + '%'] : null, r.gpuC != null ? ['Graphics temperature', r.gpuC.toFixed(0) + ' °C', SX.tone('temp', r.gpuC)] : null]) : '';
  return rows + gpu;
}
function sysHtml() {
  const r = SX.last(); if (!r) return '<p class="hint">Reading the phone...</p>';
  const info = STK.info() || {};
  return SX.kv([
    r.storage ? ['Storage', r.storage.freeGb + ' GB free of ' + r.storage.totalGb + ' GB', r.storage.usedPct >= 92 ? 'bad' : ''] : null,
    r.swapTotalMb ? ['Compressed memory', r.swapUsedMb + ' of ' + r.swapTotalMb + ' MB used'] : null,
    ['Refresh rate', r.lockPeak ? 'Locked at ' + r.lockPeak + ' Hz' : 'Automatic' + (maxHz() ? ' (up to ' + maxHz() + ' Hz)' : '')],
    ['Thermal state', r.thermalStatus == null ? 'Not reported' : SX.thermalWord(r.thermalStatus), r.thermalStatus >= 2 ? 'bad' : ''],
    r.wifi ? ['Wi-Fi', (r.wifi.band || 'Wi-Fi') + ' · ' + r.wifi.rssi + ' dBm' + (r.wifi.linkMbps ? ' · ' + r.wifi.linkMbps + ' Mbps' : ''), r.wifi.rssi <= -75 ? 'warn' : ''] : null,
    r.brightness != null ? ['Brightness', Math.round(r.brightness / 255 * 100) + '%'] : null,
    r.animScale != null ? ['Animations', r.animScale === 0 ? 'Off' : r.animScale < 1 ? 'Faster (' + r.animScale + 'x)' : 'Normal'] : null,
    info.android ? ['Android', esc(info.android) + (info.sdk ? ' (API ' + esc(info.sdk) + ')' : '')] : null
  ]);
}
function suggHtml() {
  const list = SX.suggestions(); if (!list.length) return '<p class="hint">Reading the phone...</p>';
  return `<ul class="sx-sugg">${list.map(s => `<li class="${s.tone}"><span class="ico">${icon(s.ic)}</span><div><b>${esc(s.title)}</b><p>${esc(s.text)}</p>${s.act ? `<button class="btn sm" type="button" data-sx="do" data-do="${esc(s.act[1])}">${esc(s.act[0])}</button>` : ''}</div></li>`).join('')}</ul>`;
}
SX.register({ id: 'overview', label: 'Overview', icon: 'gauge', order: 1,
  render: () => `<div class="sx-grid">
    ${SX.card('span-12', 'Performance profiles', 'One tap sets up the whole phone. Your old settings are saved so you can undo it.', '<div id="w-prof"></div><div id="w-run"></div>')}
    ${SX.card('span-8', 'Live performance', 'Updates every few seconds while this page is open.', '<div id="w-live" class="sx-live"></div>')}
    ${SX.card('span-4 tall', 'Smart suggestions', 'Based on what your phone is doing right now.', '<div id="w-sugg"></div>')}
    ${SX.card('span-8', 'Processor and graphics', 'Per-core clock speed.', '<div id="w-cores"></div>')}
    ${SX.card('span-12', 'System', 'Storage, display, network and thermal state.', '<div id="w-sys"></div>')}
  </div>`,
  paint() { SX.W('w-prof', profilesHtml()); SX.W('w-live', liveCards()); SX.W('w-sugg', suggHtml()); SX.W('w-cores', coresHtml()); SX.W('w-sys', sysHtml()); paintRun(); }
});

/* ---------- Optimize ---------- */
const TOGGLES = [['dnd', 'Do not disturb', 'bell', 'No pop-ups during play'], ['airplane', 'Airplane mode', 'plane', 'Offline games run cooler'], ['stayawake', 'Stay awake', 'sun-moon', 'Screen stays on while charging'], ['touches', 'Show touches', 'tap', 'Taps visible on recordings'], ['rotation', 'Auto-rotate', 'rotate', 'Off locks the orientation'], ['autobrightness', 'Auto brightness', 'sun-moon', 'Off keeps light steady'], ['bluetooth', 'Bluetooth', 'link', 'Off saves a little power'], ['dark', 'Dark mode', 'eye', 'Saves power on OLED screens']];
function optPkgBox() {
  const gl = SX.games(), pkg = SX.pkg(), L = STK.live();
  const chips = gl.slice(0, 6).map(g => `<button type="button" class="chipbtn ${g.pkg === pkg ? 'is-active' : ''}" data-sx="pickpkg" data-pkg="${esc(g.pkg)}">${esc(g.name || nice(g.pkg))}</button>`).join('');
  return `<div class="sx-pkg"><label class="ff"><span>Target app or game</span><input id="sx-pkg" data-sxc="pkg" list="sx-apps" value="${esc(S.pkg)}" placeholder="${esc(L && L.fgPackage ? 'Current app: ' + L.fgPackage : 'Open a game on the phone or type its package name')}" autocomplete="off" spellcheck="false"></label><datalist id="sx-apps">${(S.apps || []).map(a => `<option value="${esc(a.package)}">${esc(nice(a.package))}</option>`).join('')}</datalist>${chips ? `<div class="chiprow">${chips}</div>` : ''}</div>`;
}
function togglesHtml() {
  const T = S.toggles; if (!T) return '<p class="hint">Reading the phone settings...</p>';
  return `<div class="sx-toggles">${TOGGLES.map(([k, l, ic, h]) => `<button type="button" class="sx-tg ${T[k] ? 'on' : ''}" aria-pressed="${!!T[k]}" data-sx="toggle" data-key="${k}"><span class="ico">${icon(ic)}</span><span class="tx"><b>${esc(l)}</b><small>${esc(h)}</small></span><i class="sw"></i></button>`).join('')}</div>`;
}
function compatHtml() {
  const c = S.compat;
  if (!c) return `<p class="hint">Not sure what this phone supports? Run the check. It reads the phone itself and tells you exactly which features work.</p>`;
  if (c.error) return `<div class="sx-note bad">${icon('alert', 'sm')}<span>${esc(c.error)}</span></div>`;
  return `<div class="sx-compat"><header><b>${esc((c.maker || '') + ' ' + (c.model || ''))}</b><span>Android ${esc(c.android)} · API ${esc(c.sdk)}</span></header><ul>${c.checks.map(k => `<li class="${k.ok ? 'ok' : 'no'}"><span class="m">${icon(k.ok ? 'check' : 'info', 'sm')}</span><div><b>${esc(k.label)}</b><small>${esc(k.detail)}</small></div></li>`).join('')}</ul></div>`;
}
function gmReportHtml() {
  const g = S.gm; if (!g) return '';
  return `<div class="sx-note ${g.applied ? 'ok' : 'bad'}">${icon(g.applied ? 'check' : 'alert', 'sm')}<span>${esc(g.message)}${g.reply && g.applied ? ' The phone said: "' + esc(g.reply) + '".' : ''}</span></div>`;
}
SX.register({ id: 'optimize', label: 'Optimize', icon: 'bolt', order: 2,
  render() {
    const r = SX.last() || {}, hz = r.supportedHz || [];
    const hzItems = [[0, 'Auto'], ...hz.map(x => [x, x + ' Hz'])];
    const tile = (ic, t, d, body, cls = '') => `<button type="button" class="sx-tool ${cls}" data-sx="${body.sx}" ${body.attrs || ''}><span class="ico">${icon(ic)}</span><b>${esc(t)}</b><small>${esc(d)}</small></button>`;
    return `<div class="sx-grid">
      ${SX.card('span-12', 'Quick boosts', 'Safe one-tap actions. Nothing here deletes your data.', `<div class="sx-tools">
        ${tile('rocket', 'Boost memory', 'Close background apps and see how much was freed.', { sx: 'boostbtn' }, 'primary')}
        ${tile('folder', 'Clear app caches', 'Free storage that apps rebuild by themselves.', { sx: 'tool', attrs: `data-body='${esc(JSON.stringify({ action: 'trimcaches' }))}' data-timeout="120000"` })}
        ${tile('bolt', 'Optimize app code', 'Recompile the target app for faster start-up and steadier frames. Takes a minute.', { sx: 'dexopt' })}
        ${tile('stop', 'Stop the target app', 'Force-close it before a clean restart.', { sx: 'forcestop' })}
        ${tile('play', 'Open the target app', 'Launch it on the phone.', { sx: 'launchapp' })}
      </div>${optPkgBox()}`)}
      ${SX.card('span-6', 'Display and smoothness', 'Higher refresh feels smoother and uses more heat.', `
        <div class="sx-row"><div><b>Refresh rate</b><small>${hz.length ? 'Your screen supports ' + hz.join(', ') + ' Hz.' : 'Locks the screen to one refresh rate.'}</small></div>${SX.seg('hz', hzItems, r.lockPeak && r.lockMin === r.lockPeak ? r.lockPeak : 0)}</div>
        <div class="sx-row"><div><b>Animation speed</b><small>Shorter animations make menus feel instant.</small></div>${SX.seg('anim', [['0', 'Off'], ['0.5', 'Fast'], ['1', 'Normal']], r.animScale == null ? '1' : r.animScale === 0 ? '0' : r.animScale < 1 ? '0.5' : '1')}</div>
        <div class="sx-row col"><div><b>Brightness <em id="sx-bv">${S.brightness > 0 ? Math.round(S.brightness / 255 * 100) + '%' : ''}</em></b><small>Turning it down is the fastest way to cool a phone.</small></div><input type="range" id="sx-bright" data-sxc="bright" min="10" max="255" value="${S.brightness > 0 ? S.brightness : 128}" aria-label="Brightness"></div>`)}
      ${SX.card('span-6', 'Power and focus', 'Switches for a calmer, cooler play session.', '<div id="w-toggles"></div>')}
      ${SX.card('span-12', 'Android Game Mode', 'Android 12 and newer can tune the system for a game. Some makers hide it, so a check is included.', `
        <div class="sx-gm"><div class="sx-gm-l"><div class="sx-row"><div><b>Game Mode for the target app</b><small>Performance mode favours speed, Battery favours endurance.</small></div>${SX.seg('gm', [['performance', 'Performance'], ['standard', 'Standard'], ['battery', 'Battery']], '')}</div>
        <div class="sx-row"><div><b>Fixed performance mode</b><small>Keeps the processor at a steady high speed. Runs warm.</small></div><div class="sx-seg"><button type="button" data-sx="tool" data-body='${esc(JSON.stringify({ action: 'perfmode', on: true }))}'>On</button><button type="button" data-sx="tool" data-body='${esc(JSON.stringify({ action: 'perfmode', on: false }))}'>Off</button></div></div>
        <div id="w-gm"></div></div>
        <div class="sx-gm-r"><div class="sx-row"><div><b>Compatibility check</b><small>Reads what this phone supports.</small></div><button class="btn sm" data-sx="compat" type="button">${icon('shield', 'sm')}<span>Run check</span></button></div><div id="w-compat"></div></div></div>`)}
    </div>`;
  },
  paint() { SX.W('w-toggles', togglesHtml()); SX.W('w-compat', compatHtml()); SX.W('w-gm', gmReportHtml()); },
  onShow() { SX.loadToggles(); SX.ensureApps().then(() => { if (state.view === 'studio' && S.tab === 'optimize') { const dl = document.getElementById('sx-apps'); if (dl) dl.innerHTML = (S.apps || []).map(a => `<option value="${esc(a.package)}">${esc(nice(a.package))}</option>`).join(''); } }); }
});

/* ---------- events ---------- */
function needPkg() { const p = SX.pkg(); if (!p) { STK.toast('Open the game on the phone, pick one of your games, or type its package name.', 'bad'); return ''; } if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(p)) { STK.toast('That is not a valid package name, like com.tencent.ig. Pick one from the list.', 'bad'); return ''; } return p; }
SX.needPkg = needPkg;
Object.assign(SX.actions, {
  tab: t => SX.go(t.dataset.tab),
  boost: t => SX.boost(t), cool: t => SX.cooldown(t), boostbtn: t => SX.boost(t),
  profile: t => STK.busy(t, () => SX.applyProfile(t.dataset.id)),
  restore: t => STK.busy(t, () => SX.restoreProfile()),
  closerun: () => { S.run = null; paintRun(); },
  do: t => runDo(t.dataset.do, t),
  pickpkg: t => { SX.setPkg(t.dataset.pkg); SX.refresh(true); },
  tool: t => { let body = {}; try { body = JSON.parse(t.dataset.body || '{}'); } catch (e) { return; } return STK.busy(t, async () => { await SX.tool(body, { timeout: Number(t.dataset.timeout) || 45000 }); sample(true); }); },
  dexopt: t => { const p = needPkg(); if (!p) return; return STK.busy(t, () => SX.tool({ action: 'dexopt', pkg: p }, { timeout: 260000 })); },
  forcestop: t => { const p = needPkg(); if (!p) return; return STK.busy(t, () => SX.tool({ action: 'forcestop', pkg: p })); },
  launchapp: t => { const p = needPkg(); if (!p) return; return STK.busy(t, () => SX.tool({ action: 'launch', pkg: p })); },
  hz: t => STK.busy(t, async () => { await SX.tool({ action: 'refresh', hz: Number(t.dataset.v) }); sample(true); SX.refresh(true); }),
  anim: t => STK.busy(t, async () => { await SX.tool({ action: 'animscale', value: t.dataset.v }); sample(true); SX.refresh(true); }),
  toggle: t => { const key = t.dataset.key, next = !(S.toggles && S.toggles[key]); return STK.busy(t, async () => { const r = await SX.setToggle(key, next); if (r) { SX.refresh(); } }); },
  gm: t => { const p = needPkg(); if (!p) return; return STK.busy(t, async () => { const r = await SX.tool({ action: 'gamemode', pkg: p, mode: t.dataset.v }, { timeout: 60000 }); if (r) { S.gm = r; SX.refresh(); } }); },
  compat: t => STK.busy(t, async () => { try { S.compat = await STK.post('/perf-tools', { serial: STK.sel(), action: 'compat' }, { timeout: 45000 }); } catch (e) { S.compat = { error: e.message }; } SX.refresh(); })
});
document.addEventListener('click', e => {
  const t = e.target.closest('#studio-root [data-sx]'); if (!t || t.disabled) return;
  const fn = SX.actions[t.dataset.sx]; if (fn) fn(t, e);
});
document.addEventListener('change', e => {
  const t = e.target.closest('#studio-root [data-sxc]'); if (!t) return;
  const fn = SX.changes[t.dataset.sxc]; if (fn) fn(t, e);
});
document.addEventListener('input', e => { const t = e.target.closest('#studio-root [data-sxc="bright"]'); if (t) { const v = document.getElementById('sx-bv'); if (v) v.textContent = Math.round(t.value / 255 * 100) + '%'; } });
Object.assign(SX.changes, {
  pkg: t => { SX.setPkg(t.value.trim()); },
  bright: t => { const v = Number(t.value); S.brightness = v; STK.post('/toggle', { serial: STK.sel(), key: 'brightness', value: v }, { timeout: 30000 }).then(() => { STK.toast('Brightness set.'); sample(true); }).catch(STK.fail); }
});

/* ---------- lifecycle ---------- */
STK.views.studio = { onShow() { build(); paintTabs(); SX.refresh(true); start(); const t = cur(); if (t && t.onShow) t.onShow(); if (!S.toggles) SX.loadToggles(); } };
STK.on('view', v => { if (v !== 'studio') stop(); });
STK.on('device-changed', () => { S.toggles = null; S.apps = null; S.compat = null; S.gm = null; S.cool = null; S.run = null; if (state.view === 'studio') { SX.refresh(true); start(); SX.loadToggles(); } });
STK.on('kv', () => { if (state.view === 'studio') { SX.refresh(); paintHero(); } });
STK.on('info', () => { if (state.view === 'studio') paintHero(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view === 'studio') sample(true); });
})();
