/* Studio 3.7 "Performance Studio": live cockpit, one-tap boost, cooling, game profiles, network check and capture tools. */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const nice = p => (STK.niceApp ? STK.niceApp(p) : p);
const enc = encodeURIComponent;
const TABS = [['cockpit', 'Cockpit', 'pulse'], ['boost', 'Boost', 'bolt'], ['cool', 'Cooling', 'flake'], ['games', 'Games', 'game'], ['net', 'Network', 'wifi'], ['capture', 'Capture', 'wand']];
const S = {
  tab: STK.store.get('studio-tab', 'cockpit'), snap: null, snapAt: 0, hist: {}, timer: null, polling: false,
  demo: false, apps: null, active: {}, misses: {}, entering: {}, target: '', stats: null, toggles: null,
  run: null, scan: null, ping: null, pinging: false, gm: null, cool: null, guard: {}, heatAt: 0, lowAt: 0
};
const games = () => STK.kv.get('games', []);
const kvv = (k, d) => STK.kv.get(k, d);
const dopts = () => ({ clock: '1200', battery: 100, hideNotifications: true, dnd: true, touches: false, ...STK.store.get('demo-opts', {}) });
const num = (v, d = 0) => (v === null || v === undefined || !isFinite(v) ? d : Number(v));

/* ---------- boost profiles ---------- */
const OPT_DEFS = [
  ['dnd', 'Do not disturb', 'No pop-ups while you play'], ['animations', 'Animations off', 'Snappier menus'], ['stayawake', 'Stay awake', 'Screen stays on while charging'],
  ['touches', 'Show touches', 'Taps visible on recordings'], ['batsaver', 'Battery saver off', 'Lets the phone run at full speed'], ['freemem', 'Free memory', 'Closes cached background apps'],
  ['stopheavy', 'Stop heavy apps', 'Closes big background apps (not your game)'], ['trim', 'Clear app caches', 'Frees storage and memory pressure'],
  ['perf', 'Performance mode', 'Fixed high speed (if supported)'], ['gamemode', 'Android Game Mode', 'Performance mode for the target app']
];
const PROFILES = {
  max: { name: 'Max performance', note: 'Everything on for speed. Runs warmer.', icon: 'bolt', o: { dnd: true, animations: true, stayawake: true, batsaver: true, freemem: true, stopheavy: true, trim: true, perf: true, gamemode: true, hz: 0, bright: 0 } },
  balanced: { name: 'Balanced', note: 'Smooth play without extra heat.', icon: 'sliders', o: { dnd: true, animations: true, batsaver: true, freemem: true, gamemode: true, hz: 0, bright: 0 } },
  cool: { name: 'Cool play', note: '60 Hz and a dimmer screen for long sessions.', icon: 'flake', o: { dnd: true, animations: true, freemem: true, stopheavy: true, hz: 60, bright: 40 } },
  endure: { name: 'Endurance', note: 'Longest battery life.', icon: 'plug', o: { dnd: true, freemem: true, hz: 60, bright: 30 } }
};
const boostOpts = () => ({ ...PROFILES.max.o, ...kvv('boostopts', {}) });
const HZ = [[0, 'Leave as is'], [-1, 'Automatic'], [60, '60 Hz'], [90, '90 Hz'], [120, '120 Hz'], [144, '144 Hz']];
const BRIGHT = [[0, 'Leave as is'], [25, '25%'], [40, '40%'], [60, '60%'], [80, '80%']];

/* ---------- live data helpers ---------- */
const hist = id => S.hist[id] || (S.hist[id] = { temp: [], cpu: [], mem: [], core: [] });
function pushHist(id, r) {
  const h = hist(id), add = (a, v) => { a.push(v == null ? null : v); if (a.length > 90) a.shift(); };
  add(h.temp, r.batteryTempC); add(h.cpu, r.cpu); add(h.mem, r.memPct);
  const z = zoneMax(r, 'cpu'); add(h.core, z ? z.c : null);
}
function liveL() { return STK.live() || null; }
function skinOf(r) { const x = (r && r.hal || []).find(h => h.type === 3); return x ? x.c : null; }
function tempNow() { const r = S.snap, L = liveL(); if (r && r.batteryTempC != null) return r.batteryTempC; if (L && L.tempC != null) return L.tempC; return null; }
const GROUPS = [['gpu', /gpu|kgsl|mali|adreno/i], ['battery', /batt|bat\b|fg_|gauge/i], ['skin', /skin|quiet|case|xo[-_]therm|shell|body|back|front|display|panel/i], ['modem', /modem|mdm|pa[-_]|nr|lte|5g|wifi|wlan|rf/i], ['charger', /charg|usb|pmic|pm\d|pmi|bms|wireless/i], ['cpu', /cpu|soc|tsens|big|little|prime|gold|silver|cluster|apc|mtk|cpuss|ap[-_]|core|mid/i]];
function groupOf(name) { for (const [g, re] of GROUPS) if (re.test(name)) return g; return 'other'; }
function zoneMax(r, g) { let best = null; for (const z of (r && r.zones || [])) if (groupOf(z.name) === g && (!best || z.c > best.c)) best = z; return best; }
const GLABEL = { cpu: 'Processor', gpu: 'Graphics', battery: 'Battery', skin: 'Body / screen', modem: 'Modem and radio', charger: 'Charging chip', other: 'Other sensor' };
function heatState(t) {
  if (t == null) return { k: '', label: 'Unknown', sub: 'No reading yet' };
  if (t < 36) return { k: 'ok', label: 'Cool', sub: 'Plenty of thermal headroom' };
  if (t < 41) return { k: '', label: 'Warm', sub: 'Normal for gaming' };
  if (t < 44) return { k: 'warn', label: 'Hot', sub: 'Throttling may start soon' };
  return { k: 'bad', label: 'Very hot', sub: 'Cool down now to protect the phone' };
}
const TSTAT = ['None', 'Light', 'Moderate', 'Severe', 'Critical', 'Emergency', 'Shutdown'];
function throttle(r) {
  if (!r) return null;
  if (r.thermalStatus != null && r.thermalStatus >= 2) return { sure: true, text: 'Android is limiting speed to cool down (thermal status: ' + (TSTAT[r.thermalStatus] || r.thermalStatus) + ').' };
  const on = (r.cores || []).filter(c => c.mhz != null && c.maxMhz);
  if (on.length) {
    const top = on.slice().sort((a, b) => b.maxMhz - a.maxMhz).slice(0, Math.max(2, Math.ceil(on.length / 3)));
    const ratio = top.reduce((s, c) => s + c.mhz / c.maxMhz, 0) / top.length;
    const t = tempNow();
    if (r.cpu != null && r.cpu >= 60 && ratio < 0.6 && t != null && t >= 40) return { sure: false, text: 'The fastest cores are running well below their top speed while the phone is hot. It is probably throttling.' };
  }
  return null;
}
function trend(id) { // degrees per minute over the last ~40 s of readings (poll is 4 s)
  const a = hist(id).temp.filter(v => v != null).slice(-10);
  if (a.length < 4) return null;
  return (a[a.length - 1] - a[0]) / ((a.length - 1) * 4 / 60);
}
function score(r) {
  if (!r) return null;
  let s = 100; const t = tempNow();
  if (t != null && t > 36) s -= Math.min(30, (t - 36) * 3);
  if (r.memPct != null && r.memPct > 80) s -= Math.min(15, r.memPct - 80);
  if (r.cpu != null && r.cpu > 70) s -= Math.min(12, (r.cpu - 70) * 0.4);
  if (r.batterySaver) s -= 10;
  const th = throttle(r); if (th) s -= th.sure ? 20 : 12;
  if (r.battery >= 0 && r.battery < 20 && !r.charging) s -= 8;
  if (r.wifi && r.wifi.rssi != null && r.wifi.rssi < -75) s -= 5;
  return Math.max(0, Math.min(100, Math.round(s)));
}
const scoreWord = s => s == null ? 'Waiting' : s >= 85 ? 'Play-ready' : s >= 70 ? 'Good' : s >= 50 ? 'Needs attention' : 'Not ideal';
const scoreKind = s => s == null ? '' : s >= 85 ? 'ok' : s >= 70 ? '' : s >= 50 ? 'warn' : 'bad';
const hzOf = r => r ? (r.renderHz || (r.refreshPeak && r.refreshPeak > 0 ? Math.round(r.refreshPeak) : null)) : null;
const targetPkg = () => S.target || ((liveL() || {}).fgPackage) || '';
const isLauncher = p => /launcher|systemui|^com\.android\.settings$|\.home$/.test(p || '');

/* ---------- smart suggestions ---------- */
function advise() {
  const r = S.snap, out = [], L = liveL(); if (!r) return out;
  const t = tempNow(), id = STK.sel(), tr = trend(id), hz = hzOf(r);
  const add = (sev, title, body, act) => out.push({ sev, title, body, act });
  const th = throttle(r);
  if (th) add('bad', 'The phone is throttling', th.text + ' Cool it down and the speed comes back.', ['cooldown', 'Start cool-down']);
  if (t != null && t >= 44) add('bad', 'Very hot (' + t + ' °C)', 'Pause the game for a few minutes. Heat is what shortens battery life and triggers throttling.', ['cooldown', 'Start cool-down']);
  else if (t != null && t >= 41) add('warn', 'Running hot (' + t + ' °C)', 'A 60 Hz cap, lower brightness and no charger cut heat quickly.', ['cooldown', 'Cool it down']);
  if (r.charging && t != null && t >= 38) add('warn', 'Charging while playing adds heat', 'Charging can add 3 to 6 °C. Unplug while you play, or use pass-through charging if your phone has it.');
  if (r.memPct != null && r.memPct >= 85) add('warn', 'Memory is nearly full (' + Math.round(r.memPct) + '%)', 'Apps get reloaded from storage, which causes stutter. Free some memory first.', ['freemem', 'Free memory']);
  if (r.batterySaver) add('warn', 'Battery saver is limiting speed', 'It lowers CPU speed and refresh rate. Turn it off for gaming.', ['bsoff', 'Turn it off']);
  if (r.cpu != null && r.cpu >= 85) add('warn', 'The processor is very busy (' + Math.round(r.cpu) + '%)', 'Something besides the game may be hogging it. Scan the background apps.', ['scan', 'Scan apps']);
  if (r.battery >= 0 && r.battery <= 20 && !r.charging) add('warn', 'Battery is at ' + r.battery + '%', 'Low battery makes phones lower their speed. Plug in or use the Endurance profile.', ['profile:endure', 'Endurance profile']);
  if (hz && hz >= 90 && t != null && t >= 40) add('info', 'Screen runs at ' + hz + ' Hz', 'A 60 Hz cap noticeably reduces heat and battery use in long sessions.', ['hz:60', 'Cap at 60 Hz']);
  if (r.brightness != null && r.brightness > 200 && t != null && t >= 39) add('info', 'Screen brightness is high', 'The display is one of the biggest heat sources. Dim it a little.', ['bright:40', 'Set 40%']);
  if (r.animations != null && r.animations > 0) add('info', 'System animations are on', 'Turning them off makes menus and app switching feel faster.', ['anim', 'Turn off']);
  if (r.wifi && r.wifi.rssi != null && r.wifi.rssi < -75) add('warn', 'Weak Wi-Fi signal (' + r.wifi.rssi + ' dBm)', 'Move closer to the router for stable ping in online games.', ['tab:net', 'Open Network']);
  else if (r.wifi && r.wifi.mhz && r.wifi.mhz < 3000) add('info', 'Connected on 2.4 GHz Wi-Fi', 'The 5 GHz band is usually faster and less crowded for gaming.', ['tab:net', 'Open Network']);
  if (r.swapTotalMb && r.swapUsedMb / r.swapTotalMb > 0.6) add('info', 'The phone is leaning on swap memory', 'Closing background apps reduces stutter.', ['freemem', 'Free memory']);
  if (tr != null && tr > 1.2 && t != null && t >= 38) add('warn', 'Temperature is climbing fast (+' + tr.toFixed(1) + ' °C/min)', 'At this rate it will hit throttling soon. Act now.', ['cooldown', 'Cool it down']);
  if (!out.length) add('ok', 'You are good to play', 'Temperature, memory and settings all look healthy' + (L && L.fgPackage ? '.' : '. Open your game and watch the cockpit.'));
  const rank = { bad: 0, warn: 1, info: 2, ok: 3 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev]).slice(0, 7);
}

/* ---------- small renderers ---------- */
function ring(pct, val, label, sub, kind) {
  const r = 34, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct || 0));
  return `<div class="sx-ring ${kind || ''}"><div class="rg"><svg viewBox="0 0 80 80" aria-hidden="true"><circle class="trk" cx="40" cy="40" r="${r}"/><circle class="val" cx="40" cy="40" r="${r}" stroke-dasharray="${(c * p / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 40 40)"/></svg><b>${val}</b></div><span>${esc(label)}</span><small>${esc(sub || '')}</small></div>`;
}
const spark = (vals, opt) => STK.line(vals, { w: 300, h: 56, ...opt });
function tile(label, val, kind, sub) { return `<div class="gt-stat ${kind || ''}"><small>${esc(label)}</small><b>${val}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`; }
const noDev = () => `<section class="panel"><div class="empty">${icon('plug')}<b>No phone connected</b><p>The Performance Studio reads live data from a ready phone. Connect one on the Devices page.</p></div></section>`;

/* ---------- hero (live) ---------- */
function heroHtml() {
  const id = STK.sel(), r = S.snap, L = liveL();
  if (!id) return '';
  const t = tempNow(), hs = heatState(t), sc = score(r), act = S.active[id], hz = hzOf(r);
  const cpu = r && r.cpu != null ? Math.round(r.cpu) : null, mem = r && r.memPct != null ? Math.round(r.memPct) : null;
  const bat = r && r.battery >= 0 ? r.battery : (L && L.battery >= 0 ? L.battery : null);
  const chg = r ? r.charging : (L && L.charging);
  const tp = t == null ? 0 : Math.max(0, Math.min(100, (t - 20) / 30 * 100));
  const skin = skinOf(r);
  const gpu = r && r.gpuBusy != null ? `GPU ${r.gpuBusy}%` : (r && r.gpuMhz ? `GPU ${r.gpuMhz} MHz` : '');
  return `<div class="sx-score ${scoreKind(sc)}"><div class="sx-big">${sc == null ? '--' : sc}</div><div><b>${esc(scoreWord(sc))}</b><small>Play-readiness score</small><div class="chiprow tight"><span class="chip sm ${hs.k}"><i class="dot"></i><b>${esc(hs.label)}</b></span>${act ? `<span class="chip sm ok"><i class="dot"></i><b>Playing ${esc(nice(act.pkg))}</b></span>` : ''}${S.cool ? '<span class="chip sm warn"><i class="dot"></i><b>Cooling down</b></span>' : ''}${(kvv('restore', {})[id]) ? '<span class="chip sm"><i class="dot"></i><b>Boost active</b></span>' : ''}</div></div></div>
  <div class="sx-rings">${ring(cpu, cpu == null ? '--' : cpu + '%', 'CPU load', gpu || (r && r.cores && r.cores.length ? r.cores.length + ' cores' : ''), cpu >= 85 ? 'bad' : cpu >= 65 ? 'warn' : '')}${ring(mem, mem == null ? '--' : mem + '%', 'Memory', r && r.memTotalMb ? ((r.memTotalMb - r.memUsedMb) / 1024).toFixed(1) + ' GB free' : '', mem >= 90 ? 'bad' : mem >= 80 ? 'warn' : '')}${ring(tp, t == null ? '--' : t + '°', 'Temperature', skin != null ? 'Body ' + skin + ' °C' : hs.sub, hs.k)}${ring(bat, bat == null ? '--' : bat + '%', 'Battery', (chg ? 'Charging' : 'On battery') + (r && r.currentMa ? ' · ' + r.currentMa + ' mA' : ''), bat != null && bat <= 15 && !chg ? 'bad' : '')}${ring(hz ? Math.min(100, hz / 1.44) : 0, hz ? hz + '' : '--', 'Screen Hz', r && r.brightness != null ? 'Brightness ' + Math.round(r.brightness / 2.55) + '%' : '', '')}</div>`;
}
function topHtml() {
  const id = STK.sel(), opts = [['', 'Current app on the phone']].concat(games().map(g => [g.pkg, g.name || nice(g.pkg)]));
  if (S.target && !opts.some(o => o[0] === S.target)) opts.push([S.target, nice(S.target)]);
  opts.push(['__other', 'Another app...']);
  const L = liveL(), r = S.snap;
  const dev = STK.current();
  const name = dev ? (dev.details && /model:(\S+)/.exec(dev.details) ? /model:(\S+)/.exec(dev.details)[1].replace(/_/g, ' ') : dev.id) : '';
  const rb = (kvv('restore', {}))[id];
  return `<section class="panel sx-top"><div class="sx-hero" data-live="hero">${heroHtml()}</div>
    <div class="sx-bar"><label class="ff sx-target"><span>Target app</span><select id="sx-target" ${id ? '' : 'disabled'} aria-label="App to tune the phone for">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === S.target ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <div class="row"><button class="btn primary sx-go" id="sx-boost" ${id ? '' : 'disabled'}>${icon('bolt', 'sm')}<span>Boost now</span></button><button class="btn" id="sx-restore" ${id && rb ? '' : 'disabled'}>${icon('refresh', 'sm')}<span>Restore settings</span></button><button class="btn ${S.cool ? 'danger' : ''}" id="sx-cooltop" ${id ? '' : 'disabled'}>${icon('flake', 'sm')}<span>${S.cool ? 'Stop cool-down' : 'Cool down'}</span></button></div></div>
    <p class="hint">${r ? `${esc(name)} · Android ${esc((STK.state.info && STK.state.info[id] && STK.state.info[id].android) || '')}` .replace(/ · Android $/, '') + ' · reading every 4 s while this page is open' : 'Reading the phone...'}${L && L.fgPackage ? ' · in front: ' + esc(nice(L.fgPackage)) : ''}</p></section>`;
}

/* ---------- cockpit tab ---------- */
function cockpitLive() {
  const id = STK.sel(), r = S.snap, h = hist(id);
  if (!r) return '<p class="hint">Reading the phone...</p>';
  const t = tempNow(), tr = trend(id), th = throttle(r);
  const adv = advise();
  const sugg = adv.map((a, i) => `<div class="sx-sug ${a.sev}"><span class="sx-sev">${icon(a.sev === 'ok' ? 'check' : a.sev === 'info' ? 'info' : 'alert', 'sm')}</span><div><b>${esc(a.title)}</b><small>${esc(a.body)}</small></div>${a.act ? `<button class="btn sm" data-sact="${esc(a.act[0])}">${esc(a.act[1])}</button>` : ''}</div>`).join('');
  const cores = (r.cores || []).map(c => { const p = c.mhz != null && c.maxMhz ? Math.round(c.mhz / c.maxMhz * 100) : 0; return `<div class="sx-core ${c.mhz == null ? 'off' : ''}" title="${c.mhz != null ? c.mhz + ' of ' + c.maxMhz + ' MHz' : 'Asleep'}"><i style="height:${Math.max(4, p)}%"></i><small>${c.id}</small></div>`; }).join('');
  const zones = (r.zones || []).slice(0, 8).map(z => { const g = groupOf(z.name), p = Math.max(0, Math.min(100, (z.c - 25) / 65 * 100)); return `<div class="sx-zone"><span>${esc(GLABEL[g])}<small>${esc(z.name)}</small></span><div class="sx-bar-t"><i class="${z.c >= 80 ? 'bad' : z.c >= 65 ? 'warn' : ''}" style="width:${p}%"></i></div><b>${z.c.toFixed(0)}°</b></div>`; }).join('');
  const tcls = t >= 44 ? 'bad' : t >= 41 ? 'warn' : '';
  return `<div class="two"><div class="col">
    <section class="panel"><header class="panel-head"><h2>Smart suggestions</h2><span class="hint">Based on live readings</span></header><div class="sx-sugs">${sugg}</div></section>
    <section class="panel"><header class="panel-head"><h2>Live graphs</h2></header><div class="sx-sparks">
      <div class="sx-spark"><small>Temperature</small><b class="${tcls}">${t == null ? '--' : t + ' °C'}${tr != null ? `<em>${tr > 0.3 ? '▲' : tr < -0.3 ? '▼' : '■'} ${Math.abs(tr).toFixed(1)}/min</em>` : ''}</b>${spark(h.temp, { min: 25, max: 50 })}</div>
      <div class="sx-spark"><small>CPU load</small><b>${r.cpu == null ? '--' : Math.round(r.cpu) + '%'}</b>${spark(h.cpu, { max: 100 })}</div>
      <div class="sx-spark"><small>Memory in use</small><b>${r.memPct == null ? '--' : Math.round(r.memPct) + '%'}</b>${spark(h.mem, { max: 100 })}</div>
      <div class="sx-spark"><small>Processor sensor</small><b>${h.core.length && h.core[h.core.length - 1] != null ? h.core[h.core.length - 1].toFixed(0) + ' °C' : '--'}</b>${spark(h.core, { min: 30, max: 95 })}</div></div></section>
  </div><div class="col">
    <section class="panel"><header class="panel-head"><h2>CPU cores</h2><span class="hint">${r.governor ? 'Governor: ' + esc(r.governor) : ''}</span></header>
      ${cores ? `<div class="sx-cores">${cores}</div><p class="hint">Bar height is each core's speed compared with its top speed. ${th ? esc(th.text) : 'No throttling detected.'}</p>` : '<p class="hint">This phone does not let the computer read per-core speeds.</p>'}
      <div class="gt-stats">${tile('Load average', r.load1 != null ? r.load1.toFixed(2) : '--')}${tile('GPU', r.gpuBusy != null ? r.gpuBusy + '%' : (r.gpuMhz ? r.gpuMhz + ' MHz' : 'n/a'))}${tile('Swap used', r.swapTotalMb ? r.swapUsedMb + ' of ' + r.swapTotalMb + ' MB' : 'n/a')}${tile('Thermal status', r.thermalStatus != null ? esc(TSTAT[r.thermalStatus] || r.thermalStatus) : 'n/a', r.thermalStatus >= 2 ? 'warn' : '')}</div></section>
    <section class="panel"><header class="panel-head"><h2>Temperature sensors</h2></header>${zones || '<p class="hint">No sensors could be read on this phone.</p>'}<p class="hint">Processor sensors normally read much higher than the body. Judge heat by the Temperature dial above.</p></section>
  </div></div>`;
}
const cockpitHtml = () => `<div data-live="cockpit">${cockpitLive()}</div>`;

/* ---------- boost tab ---------- */
function runLogHtml() {
  const R = S.run; if (!R) return '<p class="hint">Pick a profile, adjust the steps and press Boost. Each step shows whether the phone accepted it.</p>';
  return `<div class="sx-steps"><b>${esc(R.title)}</b>${R.steps.map(s => `<div class="sx-step ${s.state}"><i>${s.state === 'ok' ? '✓' : s.state === 'bad' ? '✕' : s.state === 'run' ? '…' : '·'}</i><span>${esc(s.label)}${s.note ? `<small>${esc(s.note)}</small>` : ''}</span></div>`).join('')}</div>`;
}
function scanHtml() {
  const sc = S.scan; if (!sc) return '<p class="hint">Scan to see which apps are using memory in the background. Stopping them frees RAM; they start again when you open them.</p>';
  if (sc.loading) return '<p class="hint">Scanning...</p>';
  if (!sc.apps.length) return '<div class="empty small">' + icon('check') + '<b>Nothing heavy in the background</b></div>';
  const keep = kvv('keepapps', []);
  return `<div class="sx-apps">${sc.apps.map(a => `<label class="sx-app"><input type="checkbox" data-sapp="${esc(a.package)}" ${a.sel ? 'checked' : ''}><span><b>${esc(nice(a.package))}</b><small>${esc(a.package)}</small></span><em>${Math.round(a.rssKb / 1024)} MB</em><button class="icon-btn" type="button" data-skeep="${esc(a.package)}" title="${keep.includes(a.package) ? 'Kept' : 'Always keep'}" aria-label="Always keep">${icon('pin')}</button></label>`).join('')}</div>
    <div class="row"><button class="btn primary" id="sx-stopsel">${icon('stop', 'sm')}<span>Stop selected (${sc.apps.filter(a => a.sel).length})</span></button><button class="btn" id="sx-selall"><span>Select all</span></button></div>`;
}
function gmHtml() {
  const g = S.gm;
  if (!g) return '<p class="hint">Check what this phone supports before you try it.</p>';
  if (g.loading) return '<p class="hint">Checking...</p>';
  return `<div class="gt-stats">${tile('Android', esc(g.release || '?') + (g.sdk ? ' (API ' + g.sdk + ')' : ''))}${tile('Game Mode service', g.service ? 'Present' : 'Missing', g.service ? 'ok' : 'warn')}${tile('Overall', g.supported ? 'Supported' : 'Not available', g.supported ? 'ok' : 'warn')}</div>
    <p class="hint">${g.supported ? 'Android Game Mode is available.' + (g.modes ? ' The phone reports: ' + esc(g.modes) : '') : (g.sdk && g.sdk >= 31 && !g.service ? 'Your Android version supports Game Mode, but ' + esc(g.maker || 'the maker') + ' removed the service and uses its own game booster. Use that app on the phone.' : 'This phone does not provide Android Game Mode.')}</p>`;
}
function boostHtml() {
  const o = boostOpts(), id = STK.sel(), dis = id ? '' : 'disabled';
  const tg = S.toggles, rr = S.snap;
  const hzOpts = HZ.map(([v, l]) => `<option value="${v}" ${Number(o.hz || 0) === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const bOpts = BRIGHT.map(([v, l]) => `<option value="${v}" ${Number(o.bright || 0) === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  return `<div class="two"><div class="col">
    <section class="panel"><header class="panel-head"><h2>Boost profile</h2></header>
      <div class="sx-profiles">${Object.entries(PROFILES).map(([k, p]) => `<button type="button" class="sx-prof" data-prof="${k}">${icon(p.icon)}<b>${esc(p.name)}</b><span>${esc(p.note)}</span></button>`).join('')}</div>
      <p class="hint lead">Choose what Boost does. Your picks are saved. Everything it changes is remembered, and Restore puts it all back.</p>
      <div class="sx-opts">${OPT_DEFS.map(([k, l, h]) => `<label class="sx-opt"><input type="checkbox" data-bopt="${k}" ${o[k] ? 'checked' : ''}><span><b>${esc(l)}</b><small>${esc(h)}</small></span></label>`).join('')}</div>
      <div class="formgrid inline"><label class="ff"><span>Refresh rate</span><select data-bsel="hz">${hzOpts}</select></label><label class="ff"><span>Screen brightness</span><select data-bsel="bright">${bOpts}</select></label></div>
      <div class="row"><button class="btn primary" id="sx-boost2" ${dis}>${icon('bolt', 'sm')}<span>Boost now</span></button><button class="btn" id="sx-restore2" ${dis}>${icon('refresh', 'sm')}<span>Restore settings</span></button></div>
      <div data-live="boostlog" class="sx-log">${runLogHtml()}</div></section>
    <section class="panel"><header class="panel-head"><h2>Display</h2></header>
      <p class="hint lead">Refresh rate and brightness have the biggest effect on heat and battery.</p>
      <div class="chiprow">${HZ.slice(1).map(([v, l]) => `<button class="chipbtn" data-hz="${v}" ${dis}>${esc(l)}</button>`).join('')}</div>
      <label class="ff sx-range"><span>Brightness <b id="sx-bv">${rr && rr.brightness != null ? Math.round(rr.brightness / 2.55) + '%' : ''}</b></span><input type="range" id="sx-bright" min="1" max="100" value="${rr && rr.brightness != null ? Math.round(rr.brightness / 2.55) : 50}" ${dis}></label>
      <div class="gametools" id="sx-toggles">${KIT.map(([k, l, h]) => { const on = tg ? (k === 'animations' ? tg[k] !== false : !!tg[k]) : false; return `<button type="button" class="gt" data-kit="${k}" aria-pressed="${on}" ${dis}><b>${esc(l)}</b><span>${tg ? (on ? 'On' : 'Off') + ' · ' : ''}${esc(h)}</span></button>`; }).join('')}</div></section>
  </div><div class="col">
    <section class="panel"><header class="panel-head"><h2>Background apps</h2></header><div data-live="scan">${scanHtml()}</div><div class="row"><button class="btn" id="sx-scan" ${dis}>${icon('search', 'sm')}<span>Scan apps</span></button></div></section>
    <section class="panel"><header class="panel-head"><h2>Android tools</h2></header>
      <div data-live="gm">${gmHtml()}</div>
      <div class="row"><button class="btn" id="gt-gmcheck" ${dis}>${icon('info', 'sm')}<span>Check support</span></button><button class="btn" id="gt-gm" ${dis}>${icon('sparkle', 'sm')}<span>Game Mode: performance</span></button><button class="btn" id="gt-gm-off" ${dis}><span>Standard</span></button></div>
      <div class="row"><button class="btn" id="gt-perf-on" ${dis}>${icon('game', 'sm')}<span>Performance mode on</span></button><button class="btn" id="gt-perf-off" ${dis}><span>Off</span></button><button class="btn" id="gt-freemem" ${dis}>${icon('bolt', 'sm')}<span>Free memory</span></button><button class="btn" id="gt-trim" ${dis}><span>Clear caches</span></button><button class="btn" id="gt-bsoff" ${dis}><span>Battery saver off</span></button></div>
      <p class="hint">If a tool is not supported, the message shows the phone's real answer. Performance mode is a hardware feature many phones do not offer. Game Mode only works for apps Android treats as games.</p></section>
  </div></div>`;
}
const KIT = [['dnd', 'Do not disturb', 'No pop-ups'], ['touches', 'Show touches', 'Visible taps'], ['stayawake', 'Stay awake', 'Screen on while charging'], ['animations', 'Animations', 'Off = snappier'], ['rotation', 'Auto-rotate', 'Lock orientation'], ['autobrightness', 'Auto brightness', 'Off = steady light'], ['wifi', 'Wi-Fi', 'Network'], ['bluetooth', 'Bluetooth', 'Off saves power'], ['airplane', 'Airplane mode', 'For offline games']];

/* ---------- cooling tab ---------- */
function coolLive() {
  const id = STK.sel(), r = S.snap, t = tempNow(), hs = heatState(t), tr = trend(id), C = S.cool;
  const hg = kvv('heatguard', { on: false, limit: 43 });
  let prog = '';
  if (C) {
    const total = Math.max(0.5, C.start - C.target), done = Math.max(0, Math.min(1, t == null ? 0 : (C.start - t) / total));
    prog = `<div class="sx-prog"><i style="width:${Math.round(done * 100)}%"></i></div><p class="hint">Cooling for ${esc(STK.dur((Date.now() - C.at) / 1000))}. Started at ${C.start} °C, target ${C.target} °C.${t != null && t <= C.target ? ' Target reached.' : ''}</p>`;
  }
  const eta = tr != null && tr < -0.2 && t != null && C ? Math.max(0, Math.round((t - C.target) / Math.abs(tr))) : null;
  return `<div class="sx-heat ${hs.k}"><div class="sx-big">${t == null ? '--' : t}<small>°C</small></div><div><b>${esc(hs.label)}</b><small>${esc(hs.sub)}</small><small>${tr == null ? 'Measuring the trend...' : tr > 0.3 ? 'Rising ' + tr.toFixed(1) + ' °C per minute' : tr < -0.3 ? 'Falling ' + Math.abs(tr).toFixed(1) + ' °C per minute' : 'Holding steady'}${eta != null ? ' · about ' + eta + ' min to target' : ''}</small></div></div>${prog}
    <div class="gt-stats">${tile('Battery', r && r.batteryTempC != null ? r.batteryTempC + ' °C' : '--')}${tile('Body', skinOf(r) != null ? skinOf(r) + ' °C' : 'n/a')}${tile('Processor', zoneMax(r, 'cpu') ? zoneMax(r, 'cpu').c.toFixed(0) + ' °C' : 'n/a')}${tile('Graphics', zoneMax(r, 'gpu') ? zoneMax(r, 'gpu').c.toFixed(0) + ' °C' : 'n/a')}</div>`;
}
function coolHtml() {
  const hg = kvv('heatguard', { on: false, limit: 43 }), dis = STK.sel() ? '' : 'disabled';
  const co = { target: 36, restore: true, ...STK.store.get('cool-opts', {}) };
  return `<div class="two"><div class="col">
    <section class="panel"><header class="panel-head"><h2>Phone temperature</h2></header><div data-live="cool">${coolLive()}</div></section>
    <section class="panel"><header class="panel-head"><h2>Cool-down mode</h2><span class="chip sm ${S.cool ? 'warn' : ''}"><i class="dot"></i><b>${S.cool ? 'Running' : 'Ready'}</b></span></header>
      <p class="hint lead">Drops the load so the phone sheds heat fast: caps the screen at 60 Hz, dims it, turns performance mode off and stops heavy background apps. Put the phone down, away from the sun and out of the case for best results.</p>
      <label class="ff sx-range"><span>Target temperature <b id="sx-ct">${co.target} °C</b></span><input type="range" id="sx-ctarget" min="30" max="40" value="${co.target}" ${dis}></label>
      <label class="chk"><input type="checkbox" id="sx-crestore" ${co.restore ? 'checked' : ''}><span>Restore my settings when it has cooled</span></label>
      <div class="row"><button class="btn ${S.cool ? 'danger' : 'primary'}" id="sx-cool" ${dis}>${icon('flake', 'sm')}<span>${S.cool ? 'Stop cool-down' : 'Start cool-down'}</span></button></div></section>
    <section class="panel"><header class="panel-head"><h2>Heat guard</h2><span class="chip sm ${hg.on ? 'ok' : ''}"><i class="dot"></i><b>${hg.on ? 'On' : 'Off'}</b></span></header>
      <p class="hint lead">While a game session or boost is running, if the phone passes the limit, the studio caps the screen at 60 Hz and turns performance mode off. When it cools by 4 °C your refresh rate comes back.</p>
      <label class="ff sx-range"><span>Limit <b id="sx-hl">${hg.limit} °C</b></span><input type="range" id="sx-hlimit" min="38" max="48" value="${hg.limit}"></label>
      <div class="switch-row"><span>Turn Heat guard on</span><label class="switch"><input type="checkbox" id="sx-hon" ${hg.on ? 'checked' : ''} aria-label="Heat guard"><i></i></label></div></section>
  </div><div class="col">
    <section class="panel"><header class="panel-head"><h2>Cooling playbook</h2></header>
      <div class="sx-play"><h3>Do now</h3>
        ${play('flake', 'Cap the frame rate', 'Playing at 60 instead of 120 fps is the single biggest heat saver. Also cap it inside the game settings.', ['hz:60', 'Set 60 Hz'])}
        ${play('sun-moon', 'Dim the screen', 'The display can be a third of total heat. 40% is plenty indoors.', ['bright:40', 'Set 40%'])}
        ${play('bolt', 'Free memory and stop heavy apps', 'Background work keeps the processor warm.', ['freemem', 'Free memory'])}
        ${play('wifi', 'Go offline for single-player games', 'Radios use power and make heat. Airplane mode stops them.', ['airplane', 'Toggle airplane'])}
        <h3>With your hands</h3>
        ${play('phone', 'Take the case off', 'Cases trap heat. Taking it off can lower the body temperature by a few degrees.')}
        ${play('plug', 'Do not charge while gaming', 'Charging adds heat from two sources at once. If you must, charge at a lower speed or use pass-through charging if your phone has it.')}
        ${play('globe', 'Add airflow, not ice', 'A clip-on phone cooler (fan or semiconductor) is the strongest fix. A desk fan or an open window also helps. Hold the phone away from your hand and from direct sun.')}
        <h3>Avoid</h3>
        ${play('alert', 'Fridge, freezer or ice', 'Sudden cold causes condensation inside the phone and stresses the battery. Cool it gradually.')}
        ${play('alert', 'Playing in a hot car or in the sun', 'The phone cannot shed heat, so it throttles within minutes.')}
      </div></section>
  </div></div>`;
}
function play(ic, title, body, act) { return `<div class="sx-sug"><span class="sx-sev">${icon(ic, 'sm')}</span><div><b>${esc(title)}</b><small>${esc(body)}</small></div>${act ? `<button class="btn sm" data-sact="${esc(act[0])}" ${STK.sel() ? '' : 'disabled'}>${esc(act[1])}</button>` : ''}</div>`; }

/* ---------- games tab ---------- */
function gameSummary(g) {
  const bits = [];
  if (g.preset) bits.push('preset ' + presetName(g.preset));
  if (g.mirror) bits.push('mirror'); if (g.record) bits.push('record'); if (g.dnd) bits.push('Do not disturb'); if (g.touches) bits.push('show touches'); if (g.freemem) bits.push('frees memory'); if (g.gamemode) bits.push('Game Mode'); if (g.perf) bits.push('performance mode'); if (g.hz) bits.push(g.hz + ' Hz'); if (g.heat) bits.push('heat guard');
  const pt = (kvv('playtime', {}) || {})[g.pkg]; if (pt) bits.push('played ' + STK.dur(pt));
  return bits.length ? ' · ' + bits.join(', ') : '';
}
const presetName = id => { const p = ((state.schema && state.schema.presets) || []).find(x => x.id === id); return p ? p.name : id; };
function sessionsHtml() {
  const ss = kvv('sessions', []);
  if (!ss.length) return `<div class="empty small">${icon('clock')}<b>No sessions yet</b><p>When a saved game comes to the front, the studio records its length, heat and battery use here.</p></div>`;
  return ss.slice(0, 8).map(s => `<div class="sx-sess"><span class="badge">${icon('game')}</span><div><b>${esc(s.name || nice(s.pkg))}</b><small>${esc(STK.when(s.at))} · ${esc(STK.dur(s.secs))}</small></div><div class="sx-sess-n"><span class="${s.peak >= 44 ? 'bad' : s.peak >= 41 ? 'warn' : ''}">${s.peak != null ? s.peak + ' °C peak' : ''}</span><small>${s.avg != null ? 'avg ' + s.avg + ' °C' : ''}${s.drain != null ? ' · battery ' + (s.drain > 0 ? '-' : '+') + Math.abs(s.drain) + '%' : ''}</small></div></div>`).join('');
}
function statsHtml() {
  const st = S.stats; if (!st) return '';
  if (!st.running) return '<p class="hint">The phone has no frame data for that app yet. Open it, play for a moment, then read again.</p>';
  const verdict = st.jankyPct >= 15 ? 'Many frames are late. Lower the in-game graphics, cap the frame rate or cool the phone.' : st.jankyPct >= 5 ? 'Mostly smooth with some stutter.' : 'Smooth. Frames are delivered on time.';
  return `<div class="gt-stats">${tile('Frames drawn', st.frames)}${tile('Janky frames', st.jankyPct + '%', st.jankyPct >= 15 ? 'bad' : st.jankyPct >= 5 ? 'warn' : '')}${tile('Typical frame', st.p50 == null ? '-' : st.p50 + ' ms')}${tile('Slow frames (95%)', st.p95 == null ? '-' : st.p95 + ' ms', st.p95 >= 33 ? 'warn' : '')}</div><p class="hint">${esc(verdict)} Under 5% janky is smooth. Games that draw with their own engine may report little here.</p>`;
}
function gamesHtml() {
  const gl = games(), act = S.active[STK.sel()], dis = STK.sel() ? '' : 'disabled';
  return `<div class="two"><div class="col">
    <section class="panel"><header class="panel-head"><h2>Game profiles</h2>${act ? `<span class="chip sm ok"><i class="dot"></i><b>Active: ${esc(nice(act.pkg))}</b></span>` : '<span class="chip sm"><i class="dot"></i><b>Waiting</b></span>'}</header>
      <p class="hint lead">Pick the apps you play. When one comes to the front, the studio applies that profile and, when you leave, puts everything back. Works while this dashboard is open. Any app works, not only games.</p>
      ${gl.length ? `<div class="glist">${gl.map((g, i) => `<div class="grow-item"><span class="badge">${icon('game')}</span><div><b>${esc(g.name || nice(g.pkg))}</b><small>${esc(g.pkg)}${esc(gameSummary(g))}</small></div><label class="switch" title="Enabled"><input type="checkbox" data-gon="${i}" ${g.on === false ? '' : 'checked'} aria-label="Enabled"><i></i></label><button class="icon-btn" data-gedit="${i}" aria-label="Edit">${icon('pencil')}</button><button class="icon-btn" data-gdel="${i}" aria-label="Remove">${icon('trash')}</button></div>`).join('')}</div>` : `<div class="empty small">${icon('game')}<b>No games yet</b><p>Add your first game to automate boost, cooling, recording and quality settings.</p></div>`}
      <div class="row"><button class="btn primary" id="game-add">${icon('game', 'sm')}<span>Add a game</span></button></div></section>
    <section class="panel"><header class="panel-head"><h2>Frame doctor</h2></header>
      <p class="hint lead">Reads how smoothly the target app is drawing frames (${esc(targetPkg() ? nice(targetPkg()) : 'open an app first')}).</p>
      <div class="row"><button class="btn" id="gt-stats" ${dis}>${icon('pulse', 'sm')}<span>Read frame stats</span></button><button class="btn" id="gt-stats-reset" ${dis}><span>Reset counters</span></button></div><div data-live="stats">${statsHtml()}</div></section>
  </div><div class="col">
    <section class="panel"><header class="panel-head"><h2>Session history</h2>${kvv('sessions', []).length ? '<button class="btn sm" id="sx-clrsess">Clear</button>' : ''}</header><div class="sx-sesslist">${sessionsHtml()}</div></section>
  </div></div>`;
}

/* ---------- network tab ---------- */
function netLive() {
  const r = S.snap, w = r && r.wifi, P = S.ping;
  let wifi = '<p class="hint">No Wi-Fi connection was found. The phone may be on mobile data.</p>';
  if (w) {
    const q = w.rssi >= -55 ? ['Excellent', 'ok'] : w.rssi >= -67 ? ['Good', ''] : w.rssi >= -75 ? ['Fair', 'warn'] : ['Weak', 'bad'];
    const band = w.mhz ? (w.mhz < 3000 ? '2.4 GHz' : w.mhz < 5900 ? '5 GHz' : '6 GHz') : '?';
    wifi = `<div class="gt-stats">${tile('Signal', w.rssi + ' dBm', q[1], q[0])}${tile('Band', band, w.mhz && w.mhz < 3000 ? 'warn' : '', w.mhz ? w.mhz + ' MHz' : '')}${tile('Link speed', w.linkMbps != null ? w.linkMbps + ' Mbps' : '--')}</div><p class="hint">${w.rssi < -75 ? 'The signal is weak. Move closer to the router.' : w.mhz && w.mhz < 3000 ? 'You are on 2.4 GHz. Switching to 5 GHz is usually less laggy.' : 'The connection looks healthy for gaming.'}</p>`;
  }
  let ping = '';
  if (S.pinging) ping = '<p class="hint">Pinging... this takes about 10 seconds.</p>';
  else if (P) {
    const v = P.received === 0 ? ['No reply', 'bad', 'The host did not answer.'] : P.lossPct >= 3 ? ['Unstable', 'bad', 'Packet loss like this causes rubber-banding and disconnects.'] : P.avg < 40 && (P.jitter || 0) < 8 ? ['Excellent', 'ok', 'Great for fast online games.'] : P.avg < 70 ? ['Good', 'ok', 'Fine for most online games.'] : P.avg < 120 ? ['Playable', 'warn', 'Casual and turn-based games are fine. Fast shooters will feel delay.'] : ['Laggy', 'bad', 'Expect noticeable delay. Try 5 GHz Wi-Fi or move closer.'];
    ping = `<div class="gt-stats">${tile('Average', P.avg == null ? '--' : P.avg + ' ms', v[1])}${tile('Best / worst', P.min == null ? '--' : P.min + ' / ' + P.max + ' ms')}${tile('Jitter', P.jitter == null ? '--' : P.jitter + ' ms', P.jitter >= 15 ? 'warn' : '')}${tile('Packet loss', P.lossPct + '%', P.lossPct >= 3 ? 'bad' : '')}</div>${P.times.length > 1 ? `<div class="sx-spark">${spark(P.times, { max: Math.max(60, P.max * 1.2) })}</div>` : ''}<p class="hint"><b>${esc(v[0])}.</b> ${esc(v[2])} This measures the connection to ${esc(P.host)}, not to your game's own server.</p>`;
  }
  return { wifi, ping };
}
function netHtml() {
  const dis = STK.sel() ? '' : 'disabled', n = netLive(), host = STK.store.get('ping-host', '8.8.8.8');
  return `<div class="two"><div class="col">
    <section class="panel"><header class="panel-head"><h2>Ping test</h2></header>
      <p class="hint lead">Sends 8 pings from the phone itself, so it measures what the phone really experiences.</p>
      <div class="formgrid inline"><label class="ff"><span>Test against</span><select id="sx-host" ${dis}>${[['8.8.8.8', 'Google DNS (8.8.8.8)'], ['1.1.1.1', 'Cloudflare (1.1.1.1)'], ['9.9.9.9', 'Quad9 (9.9.9.9)'], ['__c', 'Custom address...']].map(([v, l]) => `<option value="${v}" ${v === host ? 'selected' : ''}>${l}</option>`).join('')}${['8.8.8.8', '1.1.1.1', '9.9.9.9'].includes(host) ? '' : `<option value="${esc(host)}" selected>${esc(host)}</option>`}</select></label></div>
      <div class="row"><button class="btn primary" id="sx-ping" ${dis}>${icon('pulse', 'sm')}<span>Run ping test</span></button></div><div data-live="ping">${n.ping}</div></section>
  </div><div class="col"><section class="panel"><header class="panel-head"><h2>Wi-Fi</h2></header><div data-live="wifi">${n.wifi}</div>
    <div class="gametools">${KIT.filter(k => ['wifi', 'bluetooth', 'airplane'].includes(k[0])).map(([k, l, h]) => { const tg = S.toggles, on = tg ? !!tg[k] : false; return `<button type="button" class="gt" data-kit="${k}" aria-pressed="${on}" ${dis}><b>${esc(l)}</b><span>${tg ? (on ? 'On' : 'Off') + ' · ' : ''}${esc(h)}</span></button>`; }).join('')}</div></section></div></div>`;
}

/* ---------- capture tab (demo mode + presets) ---------- */
function captureHtml() {
  const o = dopts(), id = STK.sel(), presets = (state.schema && state.schema.presets) || [];
  return `<div class="two"><div class="col">
    <section class="panel"><header class="panel-head"><h2>Demo mode</h2><span class="chip sm ${S.demo ? 'ok' : ''}"><i class="dot"></i><b>${S.demo ? 'On' : 'Off'}</b></span></header>
      <p class="hint lead">Cleans up the phone status bar for screenshots and recordings: fixed clock, full battery, strong signal and no notification icons. Turn it off to bring the real status bar back.</p>
      <div class="formgrid inline"><label class="ff"><span>Clock</span><input id="demo-clock" value="${esc(o.clock.slice(0, 2) + ':' + o.clock.slice(2))}" maxlength="5" autocomplete="off" aria-label="Clock shown on the phone"></label><label class="ff"><span>Battery</span><input id="demo-batt" type="number" min="1" max="100" value="${o.battery}" aria-label="Battery level shown"></label></div>
      <div class="checks"><label class="chk"><input type="checkbox" id="demo-hide" ${o.hideNotifications ? 'checked' : ''}><span>Hide notification icons</span></label><label class="chk"><input type="checkbox" id="demo-dnd" ${o.dnd ? 'checked' : ''}><span>Turn on Do not disturb</span></label><label class="chk"><input type="checkbox" id="demo-touch" ${o.touches ? 'checked' : ''}><span>Show touches on the screen</span></label></div>
      <div class="row"><button class="btn ${S.demo ? '' : 'primary'}" id="demo-toggle" ${id ? '' : 'disabled'}>${icon('wand', 'sm')}<span>${S.demo ? 'Turn demo mode off' : 'Turn demo mode on'}</span></button><button class="btn" id="demo-present">${icon('expand', 'sm')}<span>Presentation view</span></button></div>
      <p class="hint">Presentation view pops the phone out as a big clean screen on the Console. Press Esc to leave it.</p></section>
  </div><div class="col"><section class="panel"><header class="panel-head"><h2>Capture presets</h2></header>
      <p class="hint lead">One tap changes how mirroring and recording look and feel.</p>
      <div class="presets studio-presets sx-presets">${presets.map(p => `<button type="button" class="preset" data-spreset="${esc(p.id)}"><b>${esc(p.name)}</b><span>${esc(p.note)}</span><em>${p.v.maxSize === 0 ? 'Native' : p.v.maxSize + ' px'} · ${p.v.maxFps} fps · ${p.v.bitrateMbps} Mbps</em></button>`).join('') || '<p class="hint">Loading presets...</p>'}</div>
      <p class="hint">Settings for fine control are on the Settings page.</p></section></div></div>`;
}

/* ---------- page shell ---------- */
const BODY = { cockpit: cockpitHtml, boost: boostHtml, cool: coolHtml, games: gamesHtml, net: netHtml, capture: captureHtml };
function render() {
  const root = $('#studio-root'); if (!root || state.view !== 'studio') return;
  if (!BODY[S.tab]) S.tab = 'cockpit';
  const keep = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : '';
  const sy = window.scrollY;
  STK.setHtml(root, `${STK.sel() ? topHtml() : noDev()}<div class="tabs sx-tabs" role="tablist">${TABS.map(([k, l, ic]) => `<button role="tab" class="tab ${k === S.tab ? 'is-active' : ''}" data-stab="${k}" aria-selected="${k === S.tab}">${icon(ic, 'sm')}${esc(l)}</button>`).join('')}</div><div id="sx-body">${STK.sel() || S.tab === 'capture' || S.tab === 'games' ? BODY[S.tab]() : ''}</div>`);
  if (keep) { const el = document.getElementById(keep); if (el && el.focus) el.focus(); }
  window.scrollTo(0, sy);
}
const LIVE = { hero: heroHtml, cockpit: cockpitLive, cool: coolLive, boostlog: runLogHtml, scan: scanHtml, gm: gmHtml, stats: statsHtml, wifi: () => netLive().wifi, ping: () => netLive().ping };
function paint() {
  if (state.view !== 'studio') return;
  $$('#studio-root [data-live]').forEach(el => { const f = LIVE[el.dataset.live]; if (f) STK.setHtml(el, f()); });
}

/* ---------- polling ---------- */
async function poll() {
  const id = STK.sel(); if (!id || S.polling || state.view !== 'studio' || document.hidden) return;
  S.polling = true;
  try {
    const r = await STK.api('/perf-snapshot?id=' + enc(id), { timeout: 25000 });
    S.snap = r; S.snapAt = Date.now(); pushHist(id, r); afterSnap(id, r);
    paint();
  } catch (e) { /* the next tick tries again */ } finally { S.polling = false; }
}
function startPoll() { stopPoll(); poll(); S.timer = setInterval(poll, 4000); }
function stopPoll() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }
STK.on('view', n => { if (n === 'studio') startPoll(); else stopPoll(); });

/* ---------- phone actions ---------- */
const post = (path, body, ms = 40000) => STK.post(path, body, { timeout: ms });
const tool = (body, ms) => post('/game-tools', { serial: STK.sel(), ...body }, ms);
const setT = (key, value) => post('/toggle', { serial: STK.sel(), key, value }, 30000);
async function act(btn, fn) { return STK.busy(btn, async () => { try { return await fn(); } catch (e) { STK.fail(e); return null; } }); }
async function loadToggles() { const id = STK.sel(); if (!id) return; try { const t = await STK.api('/toggles?id=' + enc(id), { timeout: 30000 }); S.toggles = t.toggles || {}; S.togMore = t; } catch (e) { S.toggles = null; } if (state.view === 'studio') render(); }
async function scanApps(auto) {
  const id = STK.sel(); if (!id) return [];
  S.scan = { loading: true, apps: [] }; paint();
  try {
    const r = await STK.api('/running?id=' + enc(id) + '&scope=user', { timeout: 60000 });
    const keep = kvv('keepapps', []), tp = targetPkg();
    const apps = (r.apps || []).filter(a => !a.foreground && a.package !== tp && !keep.includes(a.package) && !isLauncher(a.package) && a.rssKb > 20000).sort((a, b) => b.rssKb - a.rssKb).slice(0, 25).map(a => ({ ...a, sel: auto ? a.rssKb >= 150000 : a.rssKb >= 100000 }));
    S.scan = { apps }; paint(); return apps;
  } catch (e) { S.scan = null; paint(); if (!auto) STK.fail(e); return []; }
}

/* ---------- restore data (what boost changed) ---------- */
function restoreMap() { return kvv('restore', {}); }
const softRender = STK.debounce(() => { if (state.view === 'studio') render(); }, 250);
function saveRestore(id, val) { const m = { ...restoreMap() }; if (val) m[id] = val; else delete m[id]; STK.kv.set('restore', m); softRender(); }
async function ensureRestore(id) {
  const m = restoreMap(); if (m[id]) return m[id];
  const r = { at: Date.now(), toggles: {}, brightness: null, refresh: null, batsaver: null, applied: {} };
  try { const t = await STK.api('/toggles?id=' + enc(id), { timeout: 30000 }); r.toggles = t.toggles || {}; r.brightness = t.brightness >= 1 ? t.brightness : null; } catch (e) { /* partial restore is still useful */ }
  const sn = S.snap || await STK.api('/perf-snapshot?id=' + enc(id), { timeout: 25000 }).catch(() => null);
  if (sn) { r.refresh = { min: sn.refreshMin, peak: sn.refreshPeak }; r.batsaver = !!sn.batterySaver; }
  saveRestore(id, r); return r;
}
const refStr = v => (v == null ? 'null' : String(v));

/* ---------- boost ---------- */
async function runBoost(opts, extra = {}) {
  const id = STK.sel(); if (!id) return STK.toast('Connect a phone first.', 'bad');
  if (S.run && S.run.busy) return;
  const pkg = extra.pkg || targetPkg(), rb = await ensureRestore(id), A = rb.applied;
  const steps = [];
  const add = (label, fn) => steps.push({ label, fn, state: 'wait', note: '' });
  if (opts.dnd) add('Do not disturb on', async () => { await setT('dnd', true); A.dnd = true; });
  if (opts.animations) add('Animations off', async () => { await setT('animations', false); A.animations = true; });
  if (opts.stayawake) add('Stay awake on', async () => { await setT('stayawake', true); A.stayawake = true; });
  if (opts.touches) add('Show touches on', async () => { await setT('touches', true); A.touches = true; });
  if (opts.batsaver) add('Battery saver off', async () => { await tool({ action: 'batterysaver', on: false }); A.batsaver = true; });
  if (opts.freemem) add('Free background memory', () => tool({ action: 'freemem' }));
  if (opts.stopheavy) add('Stop heavy background apps', async () => { const a = (await scanApps(true)).filter(x => x.sel); if (!a.length) return 'Nothing heavy found'; const r = await tool({ action: 'forcestop', packages: a.map(x => x.package), keep: pkg }); return r.message; });
  if (opts.trim) add('Clear app caches', () => tool({ action: 'trimcache' }));
  if (opts.perf) add('Performance mode on', async () => { await tool({ action: 'perfmode', on: true }); A.perf = true; });
  if (opts.gamemode) add('Android Game Mode: performance', async () => { if (!pkg || isLauncher(pkg)) throw new Error('Open the app on the phone or pick a target app first.'); await tool({ action: 'gamemode', pkg, mode: 'performance' }); A.gm = pkg; });
  const hz = Number(opts.hz || 0);
  if (hz) add(hz < 0 ? 'Refresh rate: automatic' : 'Refresh rate: ' + hz + ' Hz', async () => { await tool({ action: 'refresh', hz: hz < 0 ? 0 : hz }); A.hz = true; });
  const br = Number(opts.bright || 0);
  if (br) add('Brightness ' + br + '%', async () => { await setT('brightness', Math.max(1, Math.round(br * 2.55))); A.bright = true; });
  S.run = { title: (extra.title || 'Boost') + ' running...', steps, busy: true }; saveRestore(id, rb); paint();
  let good = 0;
  for (const s of steps) {
    s.state = 'run'; paint();
    try { const n = await s.fn(); s.state = 'ok'; if (typeof n === 'string') s.note = n; good++; }
    catch (e) { s.state = 'bad'; s.note = e.message || 'The phone refused.'; }
    paint();
  }
  saveRestore(id, rb);
  S.run.busy = false; S.run.title = (extra.title || 'Boost') + ': ' + good + ' of ' + steps.length + ' steps worked';
  render(); paint();
  STK.toast(good === steps.length ? (extra.title || 'Boost') + ' complete.' : good + ' of ' + steps.length + ' steps worked. See the list for the rest.', good === steps.length ? 'ok' : 'bad');
  Promise.resolve().then(poll);
}
async function restoreAll(quiet) {
  const id = STK.sel(), rb = restoreMap()[id]; if (!id) return;
  if (!rb) { if (!quiet) STK.toast('There is nothing to restore.'); return; }
  const A = rb.applied || {}, T = rb.toggles || {}, fails = [];
  const tryDo = async fn => { try { await fn(); } catch (e) { fails.push(e.message); } };
  for (const k of ['dnd', 'touches', 'stayawake']) if (A[k]) await tryDo(() => setT(k, !!T[k]));
  if (A.animations) await tryDo(() => setT('animations', T.animations !== false));
  if (A.hz && rb.refresh) await tryDo(() => tool({ action: 'refresh', min: refStr(rb.refresh.min), peak: refStr(rb.refresh.peak) }));
  if (A.bright && rb.brightness) { await tryDo(() => setT('brightness', rb.brightness)); if (T.autobrightness) await tryDo(() => setT('autobrightness', true)); }
  if (A.batsaver && rb.batsaver) await tryDo(() => tool({ action: 'batterysaver', on: true }));
  if (A.perf) await tryDo(() => tool({ action: 'perfmode', on: false }));
  if (A.gm) await tryDo(() => tool({ action: 'gamemode', pkg: A.gm, mode: 'standard' }));
  saveRestore(id, null); S.run = null;
  if (!quiet) STK.toast(fails.length ? 'Restored with ' + fails.length + ' problem(s): ' + fails[0] : 'Your settings are back.', fails.length ? 'bad' : 'ok');
  render(); paint(); poll();
}

/* ---------- cool-down and heat guard ---------- */
async function startCool() {
  const id = STK.sel(); if (!id) return;
  const co = { target: 36, restore: true, ...STK.store.get('cool-opts', {}) }, t = tempNow();
  if (t != null && t <= co.target) return STK.toast('The phone is already at ' + t + ' °C, below your ' + co.target + ' °C target.');
  S.cool = { at: Date.now(), start: t == null ? co.target + 5 : t, target: co.target, restore: co.restore };
  render();
  await runBoost({ dnd: true, animations: false, freemem: true, stopheavy: true, hz: 60, bright: 25 }, { title: 'Cool-down' });
  try { await tool({ action: 'perfmode', on: false }); } catch (e) { /* not supported on every phone */ }
}
async function stopCool(done) {
  if (!S.cool) return; const c = S.cool; S.cool = null;
  if (c.restore || !done) await restoreAll(true);
  render();
  STK.toast(done ? 'Cooled down to ' + (tempNow() == null ? c.target : tempNow()) + ' °C. Your settings are back.' : 'Cool-down stopped.');
}
function afterSnap(id, r) {
  const t = tempNow();
  if (S.cool && t != null && t <= S.cool.target && Date.now() - S.cool.at > 20000) stopCool(true);
  guardCheck(id, t);
}
async function guardCheck(id, t) {
  const hg = kvv('heatguard', { on: false, limit: 43 });
  const gameHeat = S.active[id] && S.active[id].g.heat;
  if (!(hg.on || gameHeat) || t == null) return;
  const busy = S.active[id] || restoreMap()[id];
  const G = S.guard[id];
  if (!G && busy && t >= hg.limit && Date.now() - S.heatAt > 120000) {
    S.heatAt = Date.now();
    const r = S.snap; S.guard[id] = { min: r ? r.refreshMin : null, peak: r ? r.refreshPeak : null };
    try { await tool({ action: 'refresh', hz: 60 }); } catch (e) { /* ignore */ }
    try { await tool({ action: 'perfmode', on: false }); } catch (e) { /* ignore */ }
    STK.toast('Heat guard: the phone hit ' + t + ' °C, so the screen was capped at 60 Hz.', 'bad'); paint();
  } else if (G && t <= hg.limit - 4) {
    delete S.guard[id];
    try { await tool({ action: 'refresh', min: refStr(G.min), peak: refStr(G.peak) }); STK.toast('Heat guard: cooled to ' + t + ' °C. Refresh rate restored.'); } catch (e) { /* ignore */ }
  }
}

/* ---------- suggestion actions ---------- */
async function doSuggestion(btn, key) {
  if (key.startsWith('tab:')) { S.tab = key.slice(4); STK.store.set('studio-tab', S.tab); return render(); }
  if (key === 'cooldown') return S.cool ? null : startCool();
  if (key === 'scan') { S.tab = 'boost'; STK.store.set('studio-tab', S.tab); render(); return scanApps(false); }
  if (key.startsWith('profile:')) { const p = PROFILES[key.slice(8)]; STK.kv.set('boostopts', { ...p.o }); return runBoost(p.o, { title: p.name }); }
  return act(btn, async () => {
    if (key === 'freemem') { const r = await tool({ action: 'freemem' }); STK.toast(r.message); }
    else if (key === 'bsoff') { const r = await tool({ action: 'batterysaver', on: false }); STK.toast(r.message); }
    else if (key === 'anim') { await ensureRestore(STK.sel()).then(rb => { rb.applied.animations = true; saveRestore(STK.sel(), rb); }); await setT('animations', false); STK.toast('Animations are off.'); }
    else if (key.startsWith('hz:')) { const rb = await ensureRestore(STK.sel()); rb.applied.hz = true; saveRestore(STK.sel(), rb); const r = await tool({ action: 'refresh', hz: Number(key.slice(3)) }); STK.toast(r.message); }
    else if (key.startsWith('bright:')) { const rb = await ensureRestore(STK.sel()); rb.applied.bright = true; saveRestore(STK.sel(), rb); await setT('brightness', Math.round(Number(key.slice(7)) * 2.55)); STK.toast('Brightness lowered.'); }
    else if (key === 'airplane') { const on = !(S.toggles && S.toggles.airplane); await setT('airplane', on); S.toggles = { ...(S.toggles || {}), airplane: on }; STK.toast('Airplane mode ' + (on ? 'on' : 'off') + '.'); }
    poll();
  });
}

/* ---------- games (profiles) ---------- */
async function ensureApps() {
  if (S.apps) return S.apps;
  try { S.apps = (await STK.api('/apps?id=' + enc(STK.sel()) + '&scope=user', { timeout: 60000 })).apps || []; } catch (e) { S.apps = []; }
  return S.apps;
}
const PKG_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
async function pickApp() {
  const apps = await ensureApps();
  const f = await STK.form('Choose the target app', `<label class="ff"><span>App</span><input name="pkg" list="sx-list" placeholder="Start typing the app name" autocomplete="off" spellcheck="false"></label><datalist id="sx-list">${apps.map(a => `<option value="${esc(a.package)}">${esc(nice(a.package))}</option>`).join('')}</datalist>`, 'Use this app');
  if (!f) return null; const pkg = f.pkg.trim();
  if (!PKG_RE.test(pkg)) { STK.toast('Use the package name, like com.tencent.ig. Pick one from the list.', 'bad'); return null; }
  return pkg;
}
async function editGame(i) {
  const g = i >= 0 ? games()[i] : {};
  const apps = await ensureApps();
  const presets = [['', 'Keep my settings'], ...(((state.schema && state.schema.presets) || []).map(p => [p.id, p.name]))];
  const f = await STK.form(i >= 0 ? 'Edit game' : 'Add a game',
    `<label class="ff"><span>App</span><input name="pkg" list="g-list" value="${esc(g.pkg || '')}" placeholder="Start typing the game name" autocomplete="off" spellcheck="false"></label><datalist id="g-list">${apps.map(a => `<option value="${esc(a.package)}">${esc(nice(a.package))}</option>`).join('')}</datalist>` +
    STK.field('name', 'Display name (optional)', g.name || '') + STK.select('preset', 'Capture preset', presets, g.preset || 'latency') + STK.select('hz', 'Refresh rate while playing', HZ.filter(h => h[0] >= 0).map(h => [h[0], h[1]]), g.hz || 0) +
    STK.check('mirror', 'Start mirroring', g.mirror) + STK.check('record', 'Start recording', g.record !== false) + STK.check('dnd', 'Turn on Do not disturb', g.dnd !== false) + STK.check('touches', 'Show touches', !!g.touches) + STK.check('freemem', 'Free memory when the game starts', !!g.freemem) + STK.check('gamemode', 'Use Android Game Mode: performance', !!g.gamemode) + STK.check('perf', 'Use fixed performance mode (if the phone has it)', !!g.perf) + STK.check('heat', 'Heat guard: cap to 60 Hz if the phone gets too hot', g.heat !== false), 'Save');
  if (!f) return;
  const pkg = f.pkg.trim();
  if (!PKG_RE.test(pkg)) return STK.toast('Use the package name, like com.tencent.ig. Pick one from the list.', 'bad');
  const entry = { pkg, name: f.name.trim().slice(0, 40), preset: f.preset, hz: Number(f.hz) || 0, mirror: f.mirror, record: f.record, dnd: f.dnd, touches: f.touches, freemem: f.freemem, gamemode: f.gamemode, perf: f.perf, heat: f.heat, on: g.on !== false };
  const list = games().slice(); if (i >= 0) list[i] = entry; else list.push(entry);
  STK.kv.set('games', list.slice(0, 30)); render();
}
async function enter(serial, g) {
  if (S.entering[serial]) return; S.entering[serial] = true;
  const a = S.active[serial] = { pkg: g.pkg, g, rec: false, mir: false, startedAt: Date.now(), gm: false, perf: false, prevSettings: null, prevToggles: null, samples: [], batStart: (liveL() || {}).battery };
  S.misses[serial] = 0; render();
  STK.toast('Game mode on: ' + (g.name || nice(g.pkg)));
  try {
    const rb = await ensureRestore(serial), A = rb.applied; a.prevToggles = rb.toggles;
    if (g.dnd) { try { await setT('dnd', true); A.dnd = true; } catch (e) { /* optional */ } }
    if (g.touches) { try { await setT('touches', true); A.touches = true; } catch (e) { /* optional */ } }
    if (g.freemem) { try { await tool({ action: 'freemem' }, 30000); } catch (e) { /* optional step */ } }
    if (g.hz) { try { await tool({ action: 'refresh', hz: g.hz }, 30000); A.hz = true; } catch (e) { STK.toast(e.message, 'bad'); } }
    if (g.perf) { try { await tool({ action: 'perfmode', on: true }, 30000); A.perf = true; } catch (e) { STK.toast(e.message, 'bad'); } }
    if (g.gamemode) { try { await tool({ action: 'gamemode', pkg: g.pkg, mode: 'performance' }, 30000); A.gm = g.pkg; a.gm = true; } catch (e) { STK.toast(e.message, 'bad'); } }
    saveRestore(serial, rb);
    const p = ((state.schema && state.schema.presets) || []).find(x => x.id === g.preset);
    if (p) { const prev = {}; for (const k of Object.keys(p.v)) prev[k] = (state.settings || {})[k]; a.prevSettings = prev; try { await STK.post('/settings', { patch: p.v }); await STK.loadSettings(); } catch (e) { STK.fail(e); } }
    if (g.mirror && !STK.mirroring()) { await STK.actions.mirror(); a.mir = true; }
    if (g.record && !STK.recording()) { await STK.actions.record(); a.rec = true; }
  } finally { S.entering[serial] = false; }
}
async function exit(serial) {
  const a = S.active[serial]; if (!a) return;
  delete S.active[serial]; delete S.misses[serial]; render();
  const secs = Math.round((Date.now() - (a.startedAt || Date.now())) / 1000);
  try {
    if (secs >= 10) {
      const pt = { ...(kvv('playtime', {}) || {}) }; pt[a.pkg] = (pt[a.pkg] || 0) + secs; STK.kv.set('playtime', pt);
      const tt = a.samples.map(s => s.t).filter(v => v != null), L = liveL();
      const rec = { pkg: a.pkg, name: a.g.name || '', at: a.startedAt, secs, peak: tt.length ? Math.max(...tt) : null, avg: tt.length ? Math.round(tt.reduce((x, y) => x + y, 0) / tt.length * 10) / 10 : null, drain: a.batStart >= 0 && L && L.battery >= 0 ? a.batStart - L.battery : null };
      STK.kv.set('sessions', [rec, ...kvv('sessions', [])].slice(0, 30));
    }
  } catch (e) { /* history is optional */ }
  STK.toast('Game mode off. Settings restored.');
  if (a.rec && STK.recording()) { try { await STK.actions.record(); } catch (e) { /* ignore */ } }
  if (a.mir && STK.mirroring()) { try { await STK.actions.mirror(); } catch (e) { /* ignore */ } }
  delete S.guard[serial];
  await restoreAll(true);
  if (a.prevSettings) { try { await STK.post('/settings', { patch: a.prevSettings }); await STK.loadSettings(); } catch (e) { /* ignore */ } }
}
STK.on('live', ({ L }) => {
  const serial = STK.sel(); if (!serial || !L) return;
  if (state.view === 'studio') { const el = $('#studio-root [data-live="hero"]'); if (el && !S.snap) STK.setHtml(el, heroHtml()); }
  const a = S.active[serial];
  if (a) {
    a.samples.push({ t: L.tempC }); if (a.samples.length > 1500) a.samples.shift();
    if (L.tempC != null && L.tempC >= 43 && Date.now() - S.heatAt > 300000 && !kvv('heatguard', { on: false }).on) { S.heatAt = Date.now(); STK.toast('The phone is hot (' + L.tempC + ' °C). Open Studio, Cooling, or turn on Heat guard.', 'bad'); }
    if (L.battery >= 0 && L.battery <= 15 && !L.charging && Date.now() - S.lowAt > 600000) { S.lowAt = Date.now(); STK.toast('Battery is at ' + L.battery + '%. Plug the phone in to keep playing.', 'bad'); }
  }
  const pkg = L.fgPackage;
  if (!a) { const g = games().find(x => x.pkg === pkg && x.on !== false); if (g && pkg) enter(serial, g); }
  else if (pkg && pkg !== a.pkg) { S.misses[serial] = (S.misses[serial] || 0) + 1; if (S.misses[serial] >= 2) exit(serial); }
  else S.misses[serial] = 0;
});

/* ---------- demo ---------- */
async function loadDemo() { const id = STK.sel(); if (!id) { S.demo = false; return; } try { S.demo = (await STK.api('/demo?id=' + enc(id))).on; } catch (e) { /* ignore */ } if (state.view === 'studio') render(); }
async function toggleDemo(btn) {
  const id = STK.sel(); if (!id) return;
  const clock = ($('#demo-clock').value.replace(':', '').replace(/\D/g, '') + '1200').slice(0, 4).padStart(4, '0');
  const o = { clock, battery: Math.max(1, Math.min(100, Number($('#demo-batt').value) || 100)), hideNotifications: $('#demo-hide').checked, dnd: $('#demo-dnd').checked, touches: $('#demo-touch').checked };
  STK.store.set('demo-opts', o);
  await act(btn, async () => { const r = await post('/demo', { serial: id, on: !S.demo, ...o }, 60000); S.demo = r.on; STK.toast(r.message); render(); });
}
STK.on('demo', on => { S.demo = on; render(); });

/* ---------- ping ---------- */
async function runPing(btn) {
  const id = STK.sel(); if (!id || S.pinging) return;
  let host = STK.store.get('ping-host', '8.8.8.8');
  S.pinging = true; paint();
  try { S.ping = await post('/game-tools', { serial: id, action: 'ping', host }, 60000); } catch (e) { STK.fail(e); } finally { S.pinging = false; paint(); }
}

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('#studio-root button'); if (!t) return;
  const id = STK.sel();
  if (t.dataset.stab) { S.tab = t.dataset.stab; STK.store.set('studio-tab', S.tab); if (S.tab === 'boost' || S.tab === 'net') loadToggles(); render(); return; }
  if (t.dataset.sact) return doSuggestion(t, t.dataset.sact);
  if (t.id === 'sx-boost' || t.id === 'sx-boost2') return runBoost(boostOpts(), { title: 'Boost' });
  if (t.id === 'sx-restore' || t.id === 'sx-restore2') return act(t, () => restoreAll(false));
  if (t.id === 'sx-cooltop' || t.id === 'sx-cool') return S.cool ? stopCool(false) : startCool();
  if (t.dataset.prof) { const p = PROFILES[t.dataset.prof]; STK.kv.set('boostopts', { ...p.o }); return render(); }
  if (t.dataset.hz) { return act(t, async () => { const rb = await ensureRestore(id); rb.applied.hz = true; saveRestore(id, rb); const r = await tool({ action: 'refresh', hz: Number(t.dataset.hz) < 0 ? 0 : Number(t.dataset.hz) }); STK.toast(r.message); poll(); }); }
  if (t.id === 'sx-scan') return act(t, () => scanApps(false));
  if (t.id === 'sx-selall') { S.scan.apps.forEach(a => { a.sel = true; }); return paint(); }
  if (t.id === 'sx-stopsel') { const pk = S.scan.apps.filter(a => a.sel).map(a => a.package); if (!pk.length) return STK.toast('Tick the apps to stop first.'); return act(t, async () => { const r = await tool({ action: 'forcestop', packages: pk, keep: targetPkg() }); STK.toast(r.message); await scanApps(false); poll(); }); }
  if (t.dataset.skeep) { const k = kvv('keepapps', []).slice(), p = t.dataset.skeep; const i = k.indexOf(p); if (i >= 0) k.splice(i, 1); else k.push(p); STK.kv.set('keepapps', k); STK.toast(i >= 0 ? nice(p) + ' can be stopped again.' : nice(p) + ' will always be kept.'); return scanApps(false); }
  if (t.dataset.kit) {
    const key = t.dataset.kit; if (!id) return;
    const t0 = S.toggles || {}, cur = key === 'animations' ? t0[key] !== false : !!t0[key], next = !cur;
    return act(t, async () => { await setT(key, next); S.toggles = { ...t0, [key]: next }; render(); });
  }
  if (t.id === 'gt-freemem') return act(t, async () => { const r = await tool({ action: 'freemem' }); STK.toast(r.message); poll(); });
  if (t.id === 'gt-trim') return act(t, async () => { const r = await tool({ action: 'trimcache' }); STK.toast(r.message); });
  if (t.id === 'gt-bsoff') return act(t, async () => { const r = await tool({ action: 'batterysaver', on: false }); STK.toast(r.message); poll(); });
  if (t.id === 'gt-perf-on' || t.id === 'gt-perf-off') { const on = t.id === 'gt-perf-on'; return act(t, async () => { const rb = await ensureRestore(id); if (on) { rb.applied.perf = true; saveRestore(id, rb); } const r = await tool({ action: 'perfmode', on }); STK.toast(r.message); }); }
  if (t.id === 'gt-gmcheck') return act(t, async () => { S.gm = { loading: true }; paint(); try { S.gm = await tool({ action: 'gameinfo', pkg: targetPkg() }); } catch (er) { S.gm = null; throw er; } paint(); });
  if (t.id === 'gt-gm' || t.id === 'gt-gm-off') { const pkg = targetPkg(); if (!pkg || isLauncher(pkg)) return STK.toast('Open the game on the phone, or pick one as the target app.', 'bad'); const mode = t.id === 'gt-gm' ? 'performance' : 'standard'; return act(t, async () => { const rb = await ensureRestore(id); if (mode === 'performance') { rb.applied.gm = pkg; saveRestore(id, rb); } const r = await tool({ action: 'gamemode', pkg, mode }); STK.toast(r.message + (r.modes ? ' ' + r.modes : '')); }); }
  if (t.id === 'gt-stats') { const pkg = targetPkg(); if (!pkg) return STK.toast('Open the app on the phone, or pick a target app.', 'bad'); return act(t, async () => { S.stats = await STK.api('/game-stats?id=' + enc(id) + '&pkg=' + enc(pkg), { timeout: 30000 }); paint(); }); }
  if (t.id === 'gt-stats-reset') { const pkg = targetPkg(); if (!pkg) return STK.toast('Open the app on the phone, or pick a target app.', 'bad'); return act(t, async () => { const r = await tool({ action: 'resetstats', pkg }); STK.toast(r.message); S.stats = null; paint(); }); }
  if (t.id === 'sx-ping') return runPing(t);
  if (t.id === 'sx-clrsess') { STK.kv.set('sessions', []); return render(); }
  if (t.id === 'demo-toggle') return toggleDemo(t);
  if (t.id === 'demo-present') { STK.go('console'); return setTimeout(() => { if ($('#hero').dataset.size !== 'l') $('#frame-size').click(); }, 120); }
  if (t.id === 'game-add') return editGame(-1);
  if (t.dataset.gedit) return editGame(Number(t.dataset.gedit));
  if (t.dataset.gdel) { const list = games().slice(); list.splice(Number(t.dataset.gdel), 1); STK.kv.set('games', list); return render(); }
  if (t.dataset.spreset) { const p = state.schema.presets.find(x => x.id === t.dataset.spreset); return act(t, async () => { await STK.post('/settings', { patch: p.v }); await STK.loadSettings(); STK.toast(p.name + ' preset applied.'); }); }
});
document.addEventListener('change', async e => {
  const el = e.target; if (!el.closest || !el.closest('#studio-root')) return;
  if (el.id === 'sx-target') {
    if (el.value === '__other') { const p = await pickApp(); S.target = p || S.target; } else S.target = el.value;
    S.stats = null; S.gm = null; return render();
  }
  if (el.dataset.bopt) { STK.kv.set('boostopts', { ...boostOpts(), [el.dataset.bopt]: el.checked }); return; }
  if (el.dataset.bsel) { STK.kv.set('boostopts', { ...boostOpts(), [el.dataset.bsel]: Number(el.value) }); return; }
  if (el.dataset.sapp) { const a = S.scan && S.scan.apps.find(x => x.package === el.dataset.sapp); if (a) a.sel = el.checked; return paint(); }
  if (el.dataset.gon) { const list = games().slice(); list[Number(el.dataset.gon)] = { ...list[Number(el.dataset.gon)], on: el.checked }; STK.kv.set('games', list); return; }
  if (el.id === 'sx-hlimit') { STK.kv.set('heatguard', { ...kvv('heatguard', { on: false, limit: 43 }), limit: Number(el.value) }); return; }
  if (el.id === 'sx-hon') { STK.kv.set('heatguard', { ...kvv('heatguard', { on: false, limit: 43 }), on: el.checked }); return render(); }
  if (el.id === 'sx-crestore') { STK.store.set('cool-opts', { ...STK.store.get('cool-opts', {}), restore: el.checked }); return; }
  if (el.id === 'sx-bright') { const v = Number(el.value); const id = STK.sel(); if (!id) return; try { const rb = await ensureRestore(id); rb.applied.bright = true; saveRestore(id, rb); await setT('brightness', Math.max(1, Math.round(v * 2.55))); STK.toast('Brightness set to ' + v + '%.'); } catch (er) { STK.fail(er); } return; }
  if (el.id === 'sx-host') {
    if (el.value === '__c') { const f = await STK.form('Custom ping address', STK.field('host', 'Address or host name', '', 'placeholder="example.com or 203.0.113.5"'), 'Use'); if (f && /^[A-Za-z0-9][A-Za-z0-9.\-]{0,98}$/.test(f.host.trim())) STK.store.set('ping-host', f.host.trim()); else if (f) STK.toast('Use an address like 8.8.8.8 or example.com.', 'bad'); }
    else STK.store.set('ping-host', el.value);
    return render();
  }
});
document.addEventListener('input', e => {
  const el = e.target; if (!el.closest || !el.closest('#studio-root')) return;
  if (el.id === 'sx-bright') { const b = $('#sx-bv'); if (b) b.textContent = el.value + '%'; }
  else if (el.id === 'sx-ctarget') { const v = Number(el.value); $('#sx-ct').textContent = v + ' °C'; STK.store.set('cool-opts', { ...STK.store.get('cool-opts', {}), target: v }); }
  else if (el.id === 'sx-hlimit') { $('#sx-hl').textContent = Number(el.value) + ' °C'; }
});

STK.views.studio = { onShow() { render(); STK.loadSchema().then(render).catch(() => {}); loadDemo(); loadToggles(); startPoll(); } };
STK.on('device-changed', () => { S.snap = null; S.toggles = null; S.stats = null; S.scan = null; S.gm = null; S.ping = null; S.cool = null; if (state.view === 'studio') { render(); loadToggles(); startPoll(); } });
STK.on('kv', k => { if (state.view === 'studio' && k === 'games') render(); });
})();
