/* Studio 3.7: a performance hub for gaming (or any heavy app).
   Overview (readiness score, live gauges, trends, suggestions), Optimize (Turbo profile and tools),
   Cooling (temperatures, cool-down assistant, techniques), Games (auto profiles, play, sessions),
   Capture (demo mode and capture presets). */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const enc = encodeURIComponent;
const S = {
  tab: STK.store.get('studio-tab', 'overview'), demo: false, apps: null, active: {}, misses: {}, entering: {},
  pkg: '', toggles: null, sys: null, stats: null, net: null, netBusy: false, hist: [], perf: null, perfBusy: false, perfTimer: null, perfErr: '',
  lastFrames: null, heatAt: 0, lowAt: 0, turbo: STK.store.get('turbo', null), turboSteps: [], turboBusy: false, cool: STK.store.get('cool', null), coolBusy: false, coolNotified: false,
  coolTarget: Number(STK.store.get('cool-target', 38)) || 38, heatLimit: Number(STK.store.get('heat-limit', 43)) || 43
};
const root = () => $('#studio-root');
const games = () => STK.kv.get('games', []);
const nice = p => (STK.niceApp ? STK.niceApp(p) : p);
const dopts = () => ({ clock: '1200', battery: 100, hideNotifications: true, dnd: true, touches: false, ...STK.store.get('demo-opts', {}) });
const gt = body => STK.post('/game-tools', { serial: STK.sel(), ...body }, { timeout: 45000 });
const tog = (key, value) => STK.post('/toggle', { serial: STK.sel(), key, value }, { timeout: 30000 });
const TABS = [['overview', 'Overview', 'gauge'], ['optimize', 'Optimize', 'rocket'], ['cooling', 'Cooling', 'temp'], ['games', 'Games', 'game'], ['capture', 'Capture', 'camera']];
const THERMAL = ['None', 'Light', 'Moderate', 'Severe', 'Critical', 'Emergency', 'Shutdown'];
const KIT_TOGGLES = [['dnd', 'Do not disturb', 'No pop-ups while you play'], ['touches', 'Show touches', 'Taps show on recordings'], ['stayawake', 'Stay awake', 'Screen stays on while charging'], ['animations', 'Animations', 'Off feels snappier'], ['rotation', 'Auto-rotate', 'Off locks the orientation'], ['autobrightness', 'Auto brightness', 'Off keeps the light steady']];

/* ---------- live numbers ---------- */
const L = () => STK.live() || null;
const fgPkg = () => { const l = L(); return l && l.fgPackage ? l.fgPackage : ''; };
const targetPkg = () => S.pkg || (Object.values(S.active)[0] || {}).pkg || fgPkg();
const batteryTemp = () => { const l = L(); return l && l.tempC != null ? l.tempC : null; };
const phoneTemp = () => { const b = batteryTemp(); if (b != null) return b; const p = S.perf; return p && p.skinTempC != null ? p.skinTempC : null; };
const socTemp = () => { const p = S.perf; return p ? (p.cpuTempC != null ? p.cpuTempC : p.maxTempC) : null; };
const ramUsedPct = () => { const p = S.perf; return p && p.memTotalKb ? Math.round(100 * (1 - p.memAvailKb / p.memTotalKb)) : null; };
const gb = kb => (kb / 1048576).toFixed(1);
const tempLevel = t => t == null ? '' : t >= 45 ? 'bad' : t >= 41 ? 'warn' : 'ok';
const tempWord = t => t == null ? 'No reading' : t >= 45 ? 'Very hot' : t >= 41 ? 'Hot' : t >= 38 ? 'Warm' : 'Cool';
const socLevel = t => t == null ? '' : t >= 80 ? 'bad' : t >= 65 ? 'warn' : 'ok';
const pctLevel = (v, w, b) => v == null ? '' : v >= b ? 'bad' : v >= w ? 'warn' : 'ok';
const fpsNow = () => { const h = S.hist; for (let i = h.length - 1; i >= 0 && i > h.length - 4; i--) if (h[i].fps != null) return h[i].fps; return null; };

function addSample(r) {
  S.perf = r;
  const l = L(), pkg = targetPkg();
  let fps = null;
  if (r.frames != null) {
    const lf = S.lastFrames;
    if (lf && lf.pkg === pkg && r.frames >= lf.frames && r.at > lf.at) { const v = (r.frames - lf.frames) / ((r.at - lf.at) / 1000); if (v >= 0 && v <= 250) fps = Math.round(v); }
    S.lastFrames = { pkg, frames: r.frames, at: r.at };
  } else S.lastFrames = null;
  const mem = ramUsedPct();
  S.hist.push({ t: r.at, phone: phoneTemp(), soc: socTemp(), cpu: r.cpuPct, ram: mem, bat: l && l.battery >= 0 ? l.battery : null, fps });
  if (S.hist.length > 80) S.hist.shift();
  const a = S.active[STK.sel()];
  if (a) { a.samples.push({ phone: phoneTemp(), cpu: r.cpuPct, fps }); if (a.samples.length > 2000) a.samples.shift(); }
  // Cool-down assistant: tell the user when the phone has cooled.
  const pt = phoneTemp();
  if (S.cool && !S.coolNotified && pt != null && pt <= S.coolTarget) { S.coolNotified = true; STK.toast('The phone cooled down to ' + pt + ' °C.', 'ok', { label: 'Restore', run: () => coolOff() }); }
  if (S.cool && pt != null && pt > S.coolTarget) S.coolNotified = false;
}

/* ---------- readiness score and suggestions ---------- */
function analyse() {
  const l = L(), p = S.perf, t = S.toggles || {}, pt = phoneTemp(), ram = ramUsedPct(), sug = [];
  let score = 100;
  const add = (sev, title, text, fix, label) => sug.push({ sev, title, text, fix, label });
  if (pt != null) {
    if (pt >= 45) { score -= 32; add('bad', 'The phone is very hot (' + pt + ' °C)', 'It will slow itself down to protect the battery. Pause and cool it before playing on.', 'cool', 'Start cool-down'); }
    else if (pt >= 41) { score -= 18; add('warn', 'The phone is getting hot (' + pt + ' °C)', 'Performance drops soon at this heat. Lower brightness or take a short break.', 'cool', 'Start cool-down'); }
    else if (pt >= 38) score -= 5;
  }
  if (p && p.thermalStatus != null && p.thermalStatus >= 2) { score -= 15; add('bad', 'Android is throttling the phone (' + THERMAL[p.thermalStatus] + ')', 'The system is already cutting speed because of heat. Frame rate will suffer until it cools.', 'cool', 'Start cool-down'); }
  if (ram != null) {
    if (ram >= 90) { score -= 25; add('bad', 'Memory is almost full (' + ram + '% used)', 'Games reload and stutter when memory runs out. Close background apps first.', 'freemem', 'Free memory'); }
    else if (ram >= 80) { score -= 12; add('warn', 'Memory is getting full (' + ram + '% used)', 'Closing background apps gives the game more room.', 'freemem', 'Free memory'); }
  }
  if (p && p.cpuPct != null && p.cpuPct >= 85 && !Object.keys(S.active).length) { score -= 8; add('warn', 'Something is using the processor (' + p.cpuPct + '%)', 'A background app is busy. Freeing memory usually stops it.', 'freemem', 'Free memory'); }
  if (l && l.battery >= 0) {
    if (l.battery <= 15 && !l.charging) { score -= 15; add('bad', 'Battery is low (' + l.battery + '%)', 'Low battery makes many phones cut performance. Plug in, ideally with a slow charger to limit heat.', '', ''); }
    else if (l.battery <= 30 && !l.charging) score -= 5;
    if (l.charging && pt != null && pt >= 39) add('warn', 'Charging while hot adds heat', 'Gaming and fast charging together is the biggest source of heat. Pause charging or use a slower charger.', '', '');
  }
  if (S.toggles) {
    if (!t.dnd) { score -= 5; add('info', 'Notifications can interrupt you', 'Do not disturb keeps pop-ups and calls from covering the game.', 'dnd', 'Turn on'); }
    if (t.animations !== false) { score -= 2; add('info', 'System animations are on', 'Turning them off makes menus and app switching feel faster.', 'anim', 'Turn off'); }
  }
  if (p && p.lowPower === 1) { score -= 12; add('warn', 'Battery saver is on', 'Battery saver limits the processor and frame rate. Turn it off for gaming.', 'lowpower', 'Turn off'); }
  if (p && p.storageTotalKb) { const free = 100 * p.storageFreeKb / p.storageTotalKb; if (free < 8) { score -= 8; add('warn', 'Storage is nearly full (' + gb(p.storageFreeKb) + ' GB free)', 'Very full storage slows loading and can make games crash. Clear some files or videos.', '', ''); } }
  const mir = STK.mirroring && STK.mirroring(), rec = STK.recording && STK.recording();
  if ((mir || rec) && pt != null && pt >= 41) add('info', 'Mirroring or recording adds heat', 'Encoding video keeps the chip busy. A lighter capture preset runs cooler.', 'preset', 'Use Low latency');
  const net = S.net;
  if (net && net.reachable && net.avgMs != null && net.avgMs >= 80) add('warn', 'Network delay is high (' + Math.round(net.avgMs) + ' ms)', 'Online games feel laggy above about 80 ms. Move closer to the router or use 5 GHz Wi-Fi.', 'net', 'Test again');
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (!sug.length) add('ok', 'Everything looks good', 'No problems found. Use Turbo for an extra edge before a long session.', '', '');
  return { score, sug, word: score >= 85 ? 'Ready to play' : score >= 65 ? 'Good to go' : score >= 45 ? 'Could be better' : 'Needs attention', color: score >= 85 ? 'var(--ok)' : score >= 65 ? 'var(--accent)' : score >= 45 ? 'var(--warn)' : 'var(--bad)' };
}

/* ---------- small drawing helpers ---------- */
function ring(v, color, big, small) {
  return `<svg class="ring" viewBox="0 0 120 120" role="img" aria-label="${esc(big + ' ' + small)}"><circle cx="60" cy="60" r="52" class="ring-bg"/><circle cx="60" cy="60" r="52" class="ring-fg" style="stroke:${color};stroke-dasharray:${(Math.max(0, Math.min(100, v)) / 100 * 326.7).toFixed(1)} 326.7"/><text x="60" y="64" text-anchor="middle" class="ring-n">${esc(big)}</text><text x="60" y="82" text-anchor="middle" class="ring-s">${esc(small)}</text></svg>`;
}
function spark(vals, { min = 0, max = 100, color = 'var(--accent)', mark = null } = {}) {
  const v = vals.filter(x => x != null);
  if (v.length < 2) return '<div class="spark empty">Collecting data...</div>';
  const W = 240, H = 56, lo = Math.min(min, ...v), hi = Math.max(max, ...v), pts = vals.map((x, i) => x == null ? null : [i / (vals.length - 1) * W, H - 3 - (x - lo) / ((hi - lo) || 1) * (H - 6)]).filter(Boolean);
  const d = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
  const ml = mark != null && mark >= lo && mark <= hi ? `<line x1="0" x2="${W}" y1="${(H - 3 - (mark - lo) / ((hi - lo) || 1) * (H - 6)).toFixed(1)}" y2="${(H - 3 - (mark - lo) / ((hi - lo) || 1) * (H - 6)).toFixed(1)}" class="spark-mark"/>` : '';
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${ml}<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><path d="${d} L${W} ${H} L0 ${H} Z" fill="${color}" opacity=".12"/></svg>`;
}
const gauge = (label, value, note, level, pct) => `<div class="gauge ${level || ''}"><small>${esc(label)}</small><b>${esc(value)}</b><i class="gbar"><u style="width:${Math.max(0, Math.min(100, pct == null ? 0 : pct))}%"></u></i><em>${esc(note || '')}</em></div>`;

/* ---------- rendering ---------- */
function render() {
  if (state.view !== 'studio') return;
  const id = STK.sel();
  const tabs = `<div class="st-tabs" role="tablist">${TABS.map(([k, n, ic]) => `<button type="button" role="tab" class="st-tab ${S.tab === k ? 'is-active' : ''}" data-sttab="${k}" aria-selected="${S.tab === k}">${icon(ic, 'sm')}<span>${n}</span></button>`).join('')}</div>`;
  const dev = STK.current();
  const head = `<div class="st-head"><div><h2 class="st-title">Performance Studio</h2><p class="hint">${dev ? 'Tuning ' + esc(dev.model || dev.id) + '. ' : ''}Get the phone ready, keep it cool and watch it live while you play.</p></div>${tabs}</div>`;
  const body = !id ? `<section class="panel"><div class="empty">${icon('phone')}<b>Connect a phone to start</b><p>The Studio reads live battery, heat, memory and frame data from the phone.</p></div></section>` : ({ overview: tabOverview, optimize: tabOptimize, cooling: tabCooling, games: tabGames, capture: tabCapture }[S.tab] || tabOverview)();
  STK.setHtml(root(), head + `<div class="st-body">${body}</div>`);
  paint();
}

function tabOverview() {
  const opts = gameOptions();
  return `<section class="panel st-hero"><div id="st-ring"></div><div class="st-hero-main"><h3 id="st-word">Reading the phone...</h3><p class="hint lead" id="st-sub">Live numbers appear in a few seconds.</p>
      <div class="formgrid inline"><label class="ff"><span>Target game</span><select id="st-pkg" aria-label="Target game">${opts}</select></label></div>
      <div class="row"><button class="btn primary lg" id="turbo-btn" type="button">${icon('rocket')}<span>${S.turbo ? 'Turbo is on. Undo' : 'Turbo boost'}</span></button><button class="btn lg" id="play-btn" type="button">${icon('play')}<span>Boost and play</span></button></div>
      <p class="hint">Turbo prepares the phone in one tap: no interruptions, faster animations, free memory, high refresh rate and performance mode where the phone allows. Undo puts everything back.</p></div></section>
    <div class="gauges" id="st-gauges"></div>
    <div class="two"><div class="col"><section class="panel"><header class="panel-head"><h2>Live trends</h2><span class="hint">Last few minutes</span></header><div id="st-trends"></div></section></div>
    <div class="col"><section class="panel"><header class="panel-head"><h2>Suggestions</h2></header><div id="st-sugs" class="sugs"></div></section></div></div>`;
}
function gameOptions() {
  const cur = S.pkg;
  return `<option value="">Whatever is in front on the phone</option>` + games().map(g => `<option value="${esc(g.pkg)}" ${cur === g.pkg ? 'selected' : ''}>${esc(g.name || nice(g.pkg))}</option>`).join('');
}

function tabOptimize() {
  const t = S.toggles, dis = '';
  const tg = KIT_TOGGLES.map(([k, l, h]) => { const on = t ? (k === 'animations' ? t[k] !== false : !!t[k]) : false; return `<button type="button" class="gt" data-kit="${k}" aria-pressed="${on}"><b>${esc(l)}</b><span>${t ? (on ? 'On' : 'Off') + ' · ' : ''}${esc(h)}</span></button>`; }).join('');
  const st = S.stats;
  const stats = st ? (st.running ? `<div class="gt-stats"><div class="gt-stat"><small>Frames drawn</small><b>${st.frames}</b></div><div class="gt-stat ${st.jankyPct >= 15 ? 'bad' : st.jankyPct >= 5 ? 'warn' : ''}"><small>Janky frames</small><b>${st.jankyPct}%</b></div><div class="gt-stat"><small>Typical frame</small><b>${st.p50 == null ? '-' : st.p50 + ' ms'}</b></div><div class="gt-stat ${st.p95 >= 33 ? 'warn' : ''}"><small>Slow frames (95%)</small><b>${st.p95 == null ? '-' : st.p95 + ' ms'}</b></div></div><p class="hint">Under 5% janky is smooth. A typical frame under 16 ms is 60 fps or better.</p>` : '<p class="hint">The phone has no frame data for that app yet. Play for a moment, then read again.</p>') : '';
  const n = S.net;
  const net = S.netBusy ? '<p class="hint">Testing the connection...</p>' : n ? netHtml(n) : '<p class="hint">Measures delay and packet loss from the phone to the internet, and the Wi-Fi quality.</p>';
  const steps = S.turboSteps.length ? `<ul class="steps">${S.turboSteps.map(x => `<li class="${x.ok ? 'ok' : 'skip'}">${icon(x.ok ? 'check' : 'info', 'sm')}<span><b>${esc(x.label)}</b>${x.note ? '<small>' + esc(x.note) + '</small>' : ''}</span></li>`).join('')}</ul>` : '';
  return `<div class="two"><div class="col">
    <section class="panel"><header class="panel-head"><h2>Turbo profile</h2><span class="chip sm ${S.turbo ? 'ok' : ''}"><i class="dot"></i><b>${S.turboBusy ? 'Working' : S.turbo ? 'On' : 'Off'}</b></span></header>
      <p class="hint lead">One tap builds a gaming environment from the phone's own switches, and Undo restores what you had before.</p>
      <div class="row"><button class="btn primary" id="turbo-btn" type="button" ${S.turboBusy ? 'disabled' : ''}>${icon('rocket', 'sm')}<span>${S.turbo ? 'Undo Turbo' : 'Turn Turbo on'}</span></button></div>${steps}</section>
    <section class="panel"><header class="panel-head"><h2>Quick switches</h2></header><div class="gametools" id="gt-toggles">${tg}</div>
      <div class="row"><button class="btn" id="gt-refresh-on" type="button">${icon('sparkle', 'sm')}<span>Lock high refresh rate</span></button><button class="btn" id="gt-refresh-off" type="button"><span>Automatic</span></button><button class="btn" id="gt-lp-off" type="button"><span>Battery saver off</span></button></div></section>
    </div><div class="col">
    <section class="panel"><header class="panel-head"><h2>Game tools</h2></header>
      <div class="formgrid inline"><label class="ff"><span>Game</span><select id="st-pkg" aria-label="Game for the tools">${gameOptions()}</select></label></div>
      <div class="row"><button class="btn" id="gt-freemem" type="button">${icon('bolt', 'sm')}<span>Free memory</span></button><button class="btn" id="gt-perf-on" type="button">${icon('game', 'sm')}<span>Performance mode</span></button><button class="btn" id="gt-perf-off" type="button"><span>Off</span></button><button class="btn" id="gt-gm" type="button">${icon('sparkle', 'sm')}<span>Game Mode: performance</span></button></div>
      <div class="row"><button class="btn" id="gt-stats" type="button">${icon('pulse', 'sm')}<span>Read frame stats</span></button><button class="btn" id="gt-stats-reset" type="button"><span>Reset counters</span></button></div>${stats}
      <p class="hint">Performance mode and Game Mode depend on the phone maker. If the phone declines, you see exactly what it answered, and the rest of Turbo still works.</p></section>
    <section class="panel"><header class="panel-head"><h2>Network check</h2></header>${net}<div class="row"><button class="btn" id="net-run" type="button" ${S.netBusy ? 'disabled' : ''}>${icon('wifi', 'sm')}<span>Test connection</span></button></div></section>
  </div></div>`;
}
function netHtml(n) {
  if (!n.reachable) return `<div class="verdict bad">${icon('alert')}<div><b>No internet from the phone</b><small>The phone could not reach the internet. Check Wi-Fi or mobile data.</small></div></div>`;
  const ms = n.avgMs, lvl = ms < 40 ? 'ok' : ms < 80 ? 'ok' : ms < 150 ? 'warn' : 'bad', word = ms < 40 ? 'Excellent' : ms < 80 ? 'Good' : ms < 150 ? 'Laggy' : 'Poor';
  const tips = [];
  if (n.lossPct > 0) tips.push(n.lossPct + '% of packets were lost, which causes rubber-banding.');
  if (n.freqMhz && n.freqMhz < 3000) tips.push('The phone is on 2.4 GHz Wi-Fi. 5 GHz is usually faster and calmer for games.');
  if (n.rssi != null && n.rssi < -70) tips.push('The Wi-Fi signal is weak (' + n.rssi + ' dBm). Move closer to the router.');
  if (ms >= 80) tips.push('Close apps that download in the background, or pause other devices streaming.');
  return `<div class="verdict ${lvl}">${icon(lvl === 'ok' ? 'check' : 'alert')}<div><b>${word}: ${Math.round(ms)} ms average delay</b><small>Best ${Math.round(n.minMs)} ms, worst ${Math.round(n.maxMs)} ms${n.lossPct != null ? ', ' + n.lossPct + '% lost' : ''}${n.linkMbps ? ' · Wi-Fi ' + n.linkMbps + ' Mbps' : ''}${n.freqMhz ? (n.freqMhz >= 4900 ? ' · 5 GHz' : ' · 2.4 GHz') : ''}</small></div></div>${tips.length ? '<ul class="tips">' + tips.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : ''}`;
}

const TECHNIQUES = [
  ['Take the case off', 'Cases trap heat. Playing caseless, or with a thin one, lets the frame act as a heat sink.', 'case'],
  ['Pause or slow the charging', 'Charging while gaming is the biggest heat source. Use a slow charger, or unplug until the phone is warm no more.', 'charge'],
  ['Lower the brightness', 'The screen is the second hottest part. Dropping to about 40% cuts several degrees.', 'bright'],
  ['Cap the frame rate in the game', '60 fps instead of 120 fps can lower the temperature by 3 to 5 degrees with little visible difference.', 'fps'],
  ['Give it airflow', 'Prop the phone on a stand, away from the bed, sofa or your hand. A small clip-on fan or a cooler helps a lot.', 'air'],
  ['Stay out of the sun', 'Direct sun on a dark phone adds heat that no setting can remove. Play in the shade.', 'sun'],
  ['Use Wi-Fi, not mobile data', 'The radio runs hot on weak mobile signal. A good Wi-Fi link is cooler and has lower delay.', 'net'],
  ['Take a 5-minute break', 'Every 30 to 45 minutes, let the phone rest with the screen off. It recovers faster than you expect.', 'break'],
  ['Never use a fridge or freezer', 'Rapid cooling causes condensation inside the phone and can damage it. Cool it gently with air.', 'warn']
];
function tabCooling() {
  const p = S.perf, pt = phoneTemp(), ts = p ? p.thermalStatus : null, lvl = tempLevel(pt);
  const hot = pt != null && pt >= 41, ch = L() && L().charging;
  const priority = [];
  if (ch && pt != null && pt >= 38) priority.push('charge');
  if (hot) priority.push('bright', 'fps', 'case');
  const tech = TECHNIQUES.slice().sort((a, b) => (priority.includes(b[2]) ? 1 : 0) - (priority.includes(a[2]) ? 1 : 0));
  const zones = p && p.zones && p.zones.length ? `<div class="zones">${p.zones.map(z => `<div class="zone ${socLevel(z.c)}"><small>${esc(z.name)}</small><b>${z.c} °C</b></div>`).join('')}</div>` : '<p class="hint">This phone does not share detailed sensor temperatures.</p>';
  return `<div class="two"><div class="col">
    <section class="panel"><header class="panel-head"><h2>Temperature</h2><span class="chip sm ${lvl}"><i class="dot"></i><b id="cool-word">${esc(tempWord(pt))}</b></span></header>
      <div class="cool-main"><div class="bigtemp ${lvl}" id="cool-big">${pt == null ? '-' : pt + ' °C'}</div><div class="cool-side" id="cool-side"></div></div>
      <div id="cool-trend"></div>
      <div class="gt-stats"><div class="gt-stat ${socLevel(socTemp())}"><small>Processor</small><b>${socTemp() == null ? '-' : socTemp() + ' °C'}</b></div><div class="gt-stat ${ts >= 2 ? 'bad' : ''}"><small>Android throttling</small><b>${ts == null ? '-' : THERMAL[ts]}</b></div></div>
      <details class="fold"><summary>All sensors</summary>${zones}</details></section>
    <section class="panel"><header class="panel-head"><h2>Alerts</h2></header>
      <div class="formgrid inline"><label class="ff"><span>Warn me above (°C)</span><input id="heat-limit" type="number" min="36" max="55" value="${S.heatLimit}" aria-label="Heat warning limit"></label><label class="ff"><span>Cool-down target (°C)</span><input id="cool-target" type="number" min="30" max="45" value="${S.coolTarget}" aria-label="Cool-down target"></label></div>
      <p class="hint">During a game session you get a notice above the warning limit, at most every 5 minutes.</p></section>
    </div><div class="col">
    <section class="panel"><header class="panel-head"><h2>Cool-down assistant</h2><span class="chip sm ${S.cool ? 'ok' : ''}"><i class="dot"></i><b>${S.cool ? 'Active' : 'Off'}</b></span></header>
      <p class="hint lead">Lowers brightness, turns on battery saver, closes background apps and ends performance mode. You get a notice when the phone reaches ${S.coolTarget} °C. Restore brings your old settings back.</p>
      <div class="row"><button class="btn primary" id="cool-btn" type="button" ${S.coolBusy ? 'disabled' : ''}>${icon('fan', 'sm')}<span>${S.cool ? 'Restore settings' : 'Start cool-down'}</span></button></div></section>
    <section class="panel"><header class="panel-head"><h2>Cooling techniques</h2></header><div class="techs">${tech.map(([n, d, k]) => `<div class="tech ${priority.includes(k) ? 'hot' : ''} ${k === 'warn' ? 'warn' : ''}"><b>${esc(n)}${priority.includes(k) ? ' <em>Suggested now</em>' : ''}</b><span>${esc(d)}</span></div>`).join('')}</div></section>
  </div></div>`;
}

function tabGames() {
  const gl = games(), pt = STK.kv.get('playtime', {}) || {}, ses = STK.kv.get('gamesessions', []) || [];
  const act = Object.values(S.active)[0];
  const rows = gl.length ? `<div class="glist">${gl.map((g, i) => `<div class="grow-item"><span class="badge">${icon('game')}</span><div><b>${esc(g.name || nice(g.pkg))}</b><small>${esc(g.pkg)}${gameSummary(g, pt)}</small></div><button class="btn sm primary" data-gplay="${i}" title="Open on the phone and boost" type="button">${icon('play', 'sm')}<span>Play</span></button><label class="switch" title="Enabled"><input type="checkbox" data-gon="${i}" ${g.on !== false ? 'checked' : ''} aria-label="Enable"><i></i></label><span class="rowbtns"><button class="icon-btn" data-gedit="${i}" title="Edit" type="button">${icon('pencil', 'sm')}</button><button class="icon-btn" data-gdel="${i}" title="Remove" type="button">${icon('trash', 'sm')}</button></span></div>`).join('')}</div>` : `<div class="empty small">${icon('game')}<b>No games yet</b><p>Add the games you play. Each one gets its own profile.</p></div>`;
  const hist = ses.length ? `<div class="sesl">${ses.slice().reverse().slice(0, 10).map(s => `<div class="ses"><div><b>${esc(s.name)}</b><small>${esc(new Date(s.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</small></div><span>${esc(STK.dur(s.secs))}</span><span class="${tempLevel(s.peak)}">${s.peak == null ? '-' : 'Peak ' + s.peak + ' °C'}</span><span>${s.batStart != null && s.batEnd != null ? (s.batStart - s.batEnd >= 0 ? '-' : '+') + Math.abs(s.batStart - s.batEnd) + '% battery' : '-'}</span><span>${s.fps ? s.fps + ' fps' : ''}</span></div>`).join('')}</div>${sessionInsight(ses[ses.length - 1])}` : '<p class="hint">After each game session you see its length, peak temperature and battery use here.</p>';
  return `<div class="two"><div class="col"><section class="panel"><header class="panel-head"><h2>Game profiles</h2>${act ? `<span class="chip sm ok"><i class="dot"></i><b>Active: ${esc(nice(act.pkg))}</b></span>` : '<span class="chip sm"><i class="dot"></i><b>Waiting</b></span>'}</header>
    <p class="hint lead">When a game on this list comes to the front of the phone, the Studio applies its profile and puts everything back when you leave. It works while this dashboard is open.</p>${rows}
    <div class="row"><button class="btn primary" id="game-add" type="button">${icon('game', 'sm')}<span>Add a game</span></button></div></section></div>
    <div class="col"><section class="panel"><header class="panel-head"><h2>Session history</h2></header>${hist}</section></div></div>`;
}
function sessionInsight(s) {
  if (!s) return '';
  const tips = [];
  if (s.peak != null && s.peak >= 45) tips.push('That session ran very hot. Try a lower frame rate in the game, no case, and a break halfway.');
  else if (s.peak != null && s.peak >= 41) tips.push('That session got hot toward the end. Cool-down breaks help keep the frame rate steady.');
  else if (s.peak != null) tips.push('Temperatures stayed comfortable in the last session.');
  if (s.secs >= 3600) tips.push('Long session. Rest your eyes and the phone for a few minutes.');
  return `<ul class="tips">${tips.map(x => '<li>' + esc(x) + '</li>').join('')}</ul>`;
}
function gameSummary(g, pt) {
  const bits = [];
  if (g.preset) bits.push('preset ' + presetName(g.preset));
  if (g.mirror) bits.push('mirror'); if (g.record) bits.push('record'); if (g.dnd) bits.push('Do not disturb'); if (g.touches) bits.push('show touches'); if (g.freemem) bits.push('frees memory'); if (g.gamemode) bits.push('Game Mode'); if (g.smooth) bits.push('high refresh');
  const t = pt[g.pkg]; if (t) bits.push('played ' + STK.dur(t));
  return bits.length ? ' · ' + bits.join(', ') : '';
}
const presetName = id => { const p = ((state.schema && state.schema.presets) || []).find(x => x.id === id); return p ? p.name : id; };

function tabCapture() {
  const o = dopts(), id = STK.sel(), presets = (state.schema && state.schema.presets) || [];
  return `<div class="two"><div class="col"><section class="panel"><header class="panel-head"><h2>Demo mode</h2><span class="chip sm ${S.demo ? 'ok' : ''}"><i class="dot"></i><b>${S.demo ? 'On' : 'Off'}</b></span></header>
      <p class="hint lead">Cleans up the phone status bar for screenshots and recordings: fixed clock, full battery, strong signal and no notification icons.</p>
      <div class="formgrid inline"><label class="ff"><span>Clock</span><input id="demo-clock" value="${esc(o.clock.slice(0, 2) + ':' + o.clock.slice(2))}" maxlength="5" autocomplete="off" aria-label="Clock shown on the phone"></label><label class="ff"><span>Battery</span><input id="demo-batt" type="number" min="1" max="100" value="${o.battery}" aria-label="Battery level shown"></label></div>
      <div class="checks"><label class="chk"><input type="checkbox" id="demo-hide" ${o.hideNotifications ? 'checked' : ''}><span>Hide notification icons</span></label><label class="chk"><input type="checkbox" id="demo-dnd" ${o.dnd ? 'checked' : ''}><span>Turn on Do not disturb</span></label><label class="chk"><input type="checkbox" id="demo-touch" ${o.touches ? 'checked' : ''}><span>Show touches</span></label></div>
      <div class="row"><button class="btn ${S.demo ? '' : 'primary'}" id="demo-toggle" type="button" ${id ? '' : 'disabled'}>${icon('wand', 'sm')}<span>${S.demo ? 'Turn demo mode off' : 'Turn demo mode on'}</span></button><button class="btn" id="demo-present" type="button">${icon('expand', 'sm')}<span>Presentation view</span></button></div>
      <p class="hint">Presentation view pops the phone out as a big clean screen on the Console. Press Esc to leave it.</p></section></div>
    <div class="col"><section class="panel"><header class="panel-head"><h2>Capture presets</h2></header>
      <p class="hint lead">One tap changes how mirroring and recording look and feel. Lighter presets keep the phone cooler.</p>
      <div class="presets studio-presets">${presets.map(p => `<button type="button" class="preset" data-spreset="${esc(p.id)}"><b>${esc(p.name)}</b><span>${esc(p.note)}</span><em>${p.v.maxSize === 0 ? 'Native' : p.v.maxSize + ' px'} · ${p.v.maxFps} fps · ${p.v.bitrateMbps} Mbps</em></button>`).join('')}</div>
      <p class="hint">Fine control is on the Settings page.</p></section></div></div>`;
}

/* ---------- live painting (no full re-render, so inputs keep focus) ---------- */
function paint() {
  if (state.view !== 'studio') return;
  const id = STK.sel(); if (!id) return;
  const l = L(), p = S.perf, pt = phoneTemp(), ram = ramUsedPct(), fps = fpsNow();
  if ($('#st-ring')) {
    const a = analyse();
    STK.setHtml($('#st-ring'), ring(a.score, a.color, S.perf || l ? String(a.score) : '-', 'readiness'));
    $('#st-word').textContent = S.perf || l ? a.word : 'Reading the phone...';
    $('#st-sub').textContent = S.perfErr ? 'Could not read the phone: ' + S.perfErr : (a.sug[0].sev === 'ok' ? a.sug[0].text : a.sug[0].title + '.');
    STK.setHtml($('#st-sugs'), a.sug.map(s => `<div class="sug ${s.sev}">${icon(s.sev === 'ok' ? 'check' : s.sev === 'info' ? 'info' : 'alert')}<div><b>${esc(s.title)}</b><span>${esc(s.text)}</span></div>${s.fix ? `<button class="btn sm" data-fix="${s.fix}" type="button">${esc(s.label)}</button>` : ''}</div>`).join(''));
  }
  if ($('#st-gauges')) {
    const storagePct = p && p.storageTotalKb ? Math.round(100 * (1 - p.storageFreeKb / p.storageTotalKb)) : null;
    STK.setHtml($('#st-gauges'),
      gauge('Phone temperature', pt == null ? '-' : pt + ' °C', tempWord(pt) + (socTemp() != null ? ' · chip ' + socTemp() + ' °C' : ''), tempLevel(pt), pt == null ? 0 : (pt - 25) / 25 * 100) +
      gauge('Processor load', p && p.cpuPct != null ? p.cpuPct + '%' : '-', p && p.thermalStatus != null && p.thermalStatus >= 1 ? 'Throttling: ' + THERMAL[p.thermalStatus] : 'No throttling', pctLevel(p && p.cpuPct, 60, 85), p && p.cpuPct) +
      gauge('Memory used', ram == null ? '-' : ram + '%', p && p.memTotalKb ? gb(p.memAvailKb) + ' GB free of ' + gb(p.memTotalKb) : '', pctLevel(ram, 75, 88), ram) +
      gauge('Battery', l && l.battery >= 0 ? l.battery + '%' : '-', l ? (l.charging ? 'Charging' : 'On battery') : '', l && l.battery >= 0 && l.battery <= 15 && !l.charging ? 'bad' : l && l.battery <= 30 && !l.charging ? 'warn' : 'ok', l && l.battery) +
      gauge('Frame rate (est.)', fps == null ? '-' : fps + ' fps', fps == null ? 'Shows when a game draws frames' : targetPkg() ? nice(targetPkg()) : '', fps == null ? '' : fps >= 55 ? 'ok' : fps >= 30 ? 'warn' : 'bad', fps == null ? 0 : fps / 120 * 100) +
      gauge('Storage used', storagePct == null ? '-' : storagePct + '%', p && p.storageTotalKb ? gb(p.storageFreeKb) + ' GB free' : '', pctLevel(storagePct, 85, 93), storagePct));
  }
  if ($('#st-trends')) {
    const h = S.hist;
    STK.setHtml($('#st-trends'), `<div class="trend"><span>Phone temperature</span>${spark(h.map(x => x.phone), { min: 28, max: 48, color: 'var(--warn)', mark: S.heatLimit })}</div><div class="trend"><span>Processor load</span>${spark(h.map(x => x.cpu), { min: 0, max: 100, color: 'var(--focus)' })}</div><div class="trend"><span>Memory used</span>${spark(h.map(x => x.ram), { min: 0, max: 100, color: 'var(--ok)' })}</div><div class="trend"><span>Frame rate</span>${spark(h.map(x => x.fps), { min: 0, max: 60, color: 'var(--accent)' })}</div>`);
  }
  if ($('#cool-big')) {
    const el = $('#cool-big'); el.textContent = pt == null ? '-' : pt + ' °C'; el.className = 'bigtemp ' + tempLevel(pt);
    $('#cool-word').textContent = tempWord(pt);
    const h = S.hist.filter(x => x.phone != null), first = h[Math.max(0, h.length - 12)], last = h[h.length - 1];
    let trend = 'Collecting data...';
    if (first && last && last.t > first.t) { const per = (last.phone - first.phone) / ((last.t - first.t) / 60000); trend = Math.abs(per) < 0.3 ? 'Steady' : (per > 0 ? 'Rising ' : 'Falling ') + Math.abs(per).toFixed(1) + ' °C per minute'; }
    STK.setHtml($('#cool-side'), `<small>Trend</small><b>${esc(trend)}</b><small>Battery temperature</small><b>${batteryTemp() == null ? '-' : batteryTemp() + ' °C'}</b>`);
    STK.setHtml($('#cool-trend'), spark(S.hist.map(x => x.phone), { min: 28, max: 48, color: 'var(--warn)', mark: S.heatLimit }));
  }
}

/* ---------- polling ---------- */
async function pollPerf() {
  const id = STK.sel(); if (!id || S.perfBusy || document.hidden || state.view !== 'studio') return;
  S.perfBusy = true;
  try { const pkg = targetPkg(); const r = await STK.api('/perf?id=' + enc(id) + (pkg ? '&pkg=' + enc(pkg) : ''), { timeout: 25000 }); S.perfErr = ''; addSample(r); }
  catch (e) { S.perfErr = e.message; }
  finally { S.perfBusy = false; paint(); }
}
function startPerf() { stopPerf(); if (state.view !== 'studio') return; pollPerf(); S.perfTimer = setInterval(pollPerf, 3500); }
function stopPerf() { clearInterval(S.perfTimer); S.perfTimer = null; }
async function loadToggles() { const id = STK.sel(); if (!id) return; try { S.toggles = (await STK.api('/toggles?id=' + enc(id), { timeout: 30000 })).toggles || {}; } catch (e) { S.toggles = null; } if (state.view === 'studio') { if (S.tab === 'optimize') render(); else paint(); } }

/* ---------- Turbo ---------- */
const note = r => (r && r.message) || '';
async function turboOn() {
  const id = STK.sel(); if (!id || S.turboBusy) return;
  S.turboBusy = true; S.turboSteps = []; render();
  const prev = { serial: id, at: Date.now(), pkg: S.pkg || '', toggles: null, sys: null, gm: false, perf: false };
  try { prev.toggles = (await STK.api('/toggles?id=' + enc(id), { timeout: 30000 })).toggles || {}; } catch (e) { /* optional */ }
  try { prev.sys = (await gt({ action: 'getstate' })).state; } catch (e) { /* optional */ }
  const step = async (label, fn) => { try { const r = await fn(); const ok = !r || r.applied !== false; S.turboSteps.push({ label, ok, note: ok ? '' : note(r) }); if (ok && r && r.on === true && label === 'Performance mode') prev.perf = true; if (ok && label === 'Android Game Mode') prev.gm = true; } catch (e) { S.turboSteps.push({ label, ok: false, note: e.message }); } if (S.tab === 'optimize') render(); };
  await step('Do not disturb', () => tog('dnd', true));
  await step('Animations off', () => tog('animations', false));
  await step('Screen stays awake', () => tog('stayawake', true));
  if (prev.sys && prev.sys.lowPower === '1') await step('Battery saver off', () => gt({ action: 'setstate', lowPower: 0 }));
  await step('Free memory', () => gt({ action: 'freemem' }));
  await step('High refresh rate', () => gt({ action: 'refresh', on: true }));
  await step('Performance mode', () => gt({ action: 'perfmode', on: true }));
  if (S.pkg) await step('Android Game Mode', () => gt({ action: 'gamemode', pkg: S.pkg, mode: 'performance' }));
  S.turbo = prev; STK.store.set('turbo', prev); S.turboBusy = false;
  const okc = S.turboSteps.filter(x => x.ok).length;
  STK.toast('Turbo is on: ' + okc + ' of ' + S.turboSteps.length + ' boosts applied.');
  loadToggles(); render();
}
async function turboOff() {
  const t = S.turbo; if (!t || S.turboBusy) return;
  S.turboBusy = true; render();
  const run = async fn => { try { await fn(); } catch (e) { /* keep restoring the rest */ } };
  const pv = t.toggles || {};
  if (t.toggles) { await run(() => tog('dnd', !!pv.dnd)); await run(() => tog('animations', pv.animations !== false)); await run(() => tog('stayawake', !!pv.stayawake)); }
  if (t.sys) await run(() => gt({ action: 'setstate', lowPower: t.sys.lowPower === '1' ? 1 : t.sys.lowPower === '0' ? 0 : undefined, minRefresh: t.sys.minRefresh, peakRefresh: t.sys.peakRefresh }));
  else await run(() => gt({ action: 'refresh', on: false }));
  await run(() => gt({ action: 'perfmode', on: false }));
  if (t.gm && t.pkg) await run(() => gt({ action: 'gamemode', pkg: t.pkg, mode: 'standard' }));
  S.turbo = null; S.turboSteps = []; STK.store.set('turbo', null); S.turboBusy = false;
  STK.toast('Turbo is off. Your settings were restored.');
  loadToggles(); render();
}

/* ---------- cool-down assistant ---------- */
async function coolOn() {
  const id = STK.sel(); if (!id || S.coolBusy) return;
  S.coolBusy = true; render();
  const prev = { serial: id, at: Date.now(), sys: null };
  try { prev.sys = (await gt({ action: 'getstate' })).state; } catch (e) { /* optional */ }
  try { await gt({ action: 'setstate', brightnessMode: 0, brightness: 45, lowPower: 1 }); } catch (e) { STK.fail(e); }
  try { await gt({ action: 'perfmode', on: false }); } catch (e) { /* optional */ }
  try { await gt({ action: 'freemem' }); } catch (e) { /* optional */ }
  S.cool = prev; S.coolNotified = false; STK.store.set('cool', prev); S.coolBusy = false;
  STK.toast('Cool-down started. Brightness is lower and battery saver is on.'); render();
}
async function coolOff() {
  const c = S.cool; if (!c || S.coolBusy) return;
  S.coolBusy = true; render();
  const s = c.sys || {};
  try { await gt({ action: 'setstate', lowPower: s.lowPower === '1' ? 1 : s.lowPower === '0' ? 0 : undefined, brightnessMode: s.brightnessMode === '1' ? 1 : s.brightnessMode === '0' ? 0 : undefined, brightness: s.brightness ? Number(s.brightness) : undefined }); } catch (e) { STK.fail(e); }
  S.cool = null; STK.store.set('cool', null); S.coolBusy = false;
  STK.toast('Your brightness and battery saver settings were restored.'); render();
}

/* ---------- tools ---------- */
async function tool(btn, body) {
  if (!STK.sel()) return null;
  return STK.busy(btn, async () => {
    try {
      const r = await gt(body);
      if (r.applied === false) { STK.logError('studio ' + body.action, (r.message || '') + (r.reply ? ' Phone reply: ' + r.reply : '') + (r.modes ? ' Modes: ' + r.modes : '')); STK.toast(r.message || 'The phone did not accept that.', 'bad'); }
      else STK.toast(r.message || 'Done.');
      return r;
    } catch (e) { STK.fail(e); return null; }
  });
}
async function readStats(btn) {
  const id = STK.sel(), pkg = targetPkg();
  if (!id) return; if (!pkg) return STK.toast('Open the game on the phone, or pick one from the list.', 'bad');
  await STK.busy(btn, async () => { try { S.stats = await STK.api('/game-stats?id=' + enc(id) + '&pkg=' + enc(pkg), { timeout: 30000 }); render(); } catch (e) { STK.fail(e); } });
}
async function netRun() {
  const id = STK.sel(); if (!id || S.netBusy) return;
  S.netBusy = true; render();
  try { S.net = await STK.api('/net-check?id=' + enc(id), { timeout: 60000 }); } catch (e) { STK.fail(e); }
  S.netBusy = false; render();
}
async function fix(kind, btn) {
  const id = STK.sel(); if (!id) return;
  if (kind === 'freemem') return tool(btn, { action: 'freemem' }).then(() => pollPerf());
  if (kind === 'dnd') return STK.busy(btn, async () => { try { await tog('dnd', true); await loadToggles(); } catch (e) { STK.fail(e); } });
  if (kind === 'anim') return STK.busy(btn, async () => { try { await tog('animations', false); await loadToggles(); } catch (e) { STK.fail(e); } });
  if (kind === 'lowpower') return tool(btn, { action: 'setstate', lowPower: 0 }).then(() => pollPerf());
  if (kind === 'cool') { S.tab = 'cooling'; STK.store.set('studio-tab', 'cooling'); render(); return coolOn(); }
  if (kind === 'net') { S.tab = 'optimize'; STK.store.set('studio-tab', 'optimize'); render(); return netRun(); }
  if (kind === 'preset') { const p = ((state.schema && state.schema.presets) || []).find(x => x.id === 'latency') || ((state.schema && state.schema.presets) || [])[0]; if (!p) return; return STK.busy(btn, async () => { try { await STK.post('/settings', { patch: p.v }); await STK.loadSettings(); STK.toast(p.name + ' preset applied.'); } catch (e) { STK.fail(e); } }); }
}

/* ---------- demo ---------- */
async function loadDemo() { const id = STK.sel(); if (!id) { S.demo = false; return; } try { S.demo = (await STK.api('/demo?id=' + enc(id))).on; } catch (e) { /* ignore */ } if (state.view === 'studio' && S.tab === 'capture') render(); }
async function toggleDemo(btn) {
  const id = STK.sel(); if (!id) return;
  const clock = ($('#demo-clock').value.replace(':', '').replace(/\D/g, '') + '1200').slice(0, 4).padStart(4, '0');
  const o = { clock, battery: Math.max(1, Math.min(100, Number($('#demo-batt').value) || 100)), hideNotifications: $('#demo-hide').checked, dnd: $('#demo-dnd').checked, touches: $('#demo-touch').checked };
  STK.store.set('demo-opts', o);
  await STK.busy(btn, async () => { try { const r = await STK.post('/demo', { serial: id, on: !S.demo, ...o }, { timeout: 60000 }); S.demo = r.on; STK.toast(r.message); render(); } catch (e) { STK.fail(e); } });
}
STK.on('demo', on => { S.demo = on; if (S.tab === 'capture') render(); });

/* ---------- games and automatic profiles ---------- */
async function ensureApps() {
  if (S.apps) return S.apps;
  try { S.apps = (await STK.api(`/apps?id=${enc(STK.sel())}&scope=user`, { timeout: 60000 })).apps || []; } catch (e) { S.apps = []; }
  return S.apps;
}
async function editGame(i) {
  const g = i >= 0 ? games()[i] : {};
  const apps = await ensureApps();
  const presets = [['', 'Keep my settings'], ...(((state.schema && state.schema.presets) || []).map(p => [p.id, p.name]))];
  const f = await STK.form(i >= 0 ? 'Edit game' : 'Add a game',
    `<label class="ff"><span>App</span><input name="pkg" list="g-list" value="${esc(g.pkg || '')}" placeholder="Start typing the game name" autocomplete="off" spellcheck="false"></label><datalist id="g-list">${apps.map(a => `<option value="${esc(a.package)}">${esc(a.label || nice(a.package))}</option>`).join('')}</datalist>` +
    STK.field('name', 'Display name (optional)', g.name || '') + STK.select('preset', 'Capture preset', presets, g.preset || 'latency') +
    STK.check('mirror', 'Start mirroring', g.mirror) + STK.check('record', 'Start recording', g.record !== false) + STK.check('dnd', 'Turn on Do not disturb', g.dnd !== false) + STK.check('touches', 'Show touches', !!g.touches) + STK.check('freemem', 'Free memory when the game starts', !!g.freemem) + STK.check('smooth', 'Lock the high refresh rate', !!g.smooth) + STK.check('gamemode', 'Try Android Game Mode: performance', !!g.gamemode), 'Save');
  if (!f) return;
  const pkg = f.pkg.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(pkg)) return STK.toast('Use the package name, like com.tencent.ig. Pick one from the list.', 'bad');
  const entry = { pkg, name: f.name.trim().slice(0, 40), preset: f.preset, mirror: f.mirror, record: f.record, dnd: f.dnd, touches: f.touches, freemem: f.freemem, smooth: f.smooth, gamemode: f.gamemode, on: g.on !== false };
  const list = games().slice(); if (i >= 0) list[i] = entry; else list.push(entry);
  STK.kv.set('games', list.slice(0, 30)); render();
}
async function setT(serial, key, value) { try { await STK.post('/toggle', { serial, key, value }, { timeout: 30000 }); } catch (e) { /* the phone may refuse; continue */ } }
async function enter(serial, g) {
  if (S.entering[serial]) return; S.entering[serial] = true;
  const l = L();
  const a = S.active[serial] = { pkg: g.pkg, g, prevSettings: null, prevToggles: null, prevSys: null, rec: false, mir: false, gm: false, smooth: false, startedAt: Date.now(), samples: [], batStart: l && l.battery >= 0 ? l.battery : null };
  S.misses[serial] = 0; if (state.view === 'studio') render();
  STK.toast('Game mode on: ' + (g.name || nice(g.pkg)));
  try {
    try { const t = await STK.api('/toggles?id=' + enc(serial), { timeout: 30000 }); a.prevToggles = t.toggles || {}; } catch (e) { /* optional */ }
    if (g.smooth) { try { a.prevSys = (await STK.post('/game-tools', { serial, action: 'getstate' }, { timeout: 30000 })).state; } catch (e) { /* optional */ } }
    if (g.dnd) await setT(serial, 'dnd', true);
    if (g.touches) await setT(serial, 'touches', true);
    if (g.freemem) { try { await STK.post('/game-tools', { serial, action: 'freemem' }, { timeout: 30000 }); } catch (e) { /* optional step */ } }
    if (g.smooth) { try { const r = await STK.post('/game-tools', { serial, action: 'refresh', on: true }, { timeout: 30000 }); a.smooth = r.applied !== false; } catch (e) { /* optional */ } }
    if (g.gamemode) { try { const r = await STK.post('/game-tools', { serial, action: 'gamemode', pkg: g.pkg, mode: 'performance' }, { timeout: 30000 }); a.gm = r.applied !== false; if (r.applied === false) STK.logError('game mode', r.message + (r.reply ? ' Phone reply: ' + r.reply : '')); } catch (e) { /* optional */ } }
    const p = ((state.schema && state.schema.presets) || []).find(x => x.id === g.preset);
    if (p) {
      const prev = {}; for (const k of Object.keys(p.v)) prev[k] = (state.settings || {})[k]; a.prevSettings = prev;
      try { await STK.post('/settings', { patch: p.v }); await STK.loadSettings(); } catch (e) { STK.fail(e); }
    }
    if (g.mirror && !STK.mirroring()) { await STK.actions.mirror(); a.mir = true; }
    if (g.record && !STK.recording()) { await STK.actions.record(); a.rec = true; }
  } finally { S.entering[serial] = false; }
}
async function exit(serial) {
  const a = S.active[serial]; if (!a) return;
  delete S.active[serial]; delete S.misses[serial]; if (state.view === 'studio') render();
  try {
    const secs = Math.round((Date.now() - (a.startedAt || Date.now())) / 1000);
    if (secs >= 10) {
      const pt = { ...(STK.kv.get('playtime', {}) || {}) }; pt[a.pkg] = (pt[a.pkg] || 0) + secs; STK.kv.set('playtime', pt);
      const temps = a.samples.map(x => x.phone).filter(x => x != null), fps = a.samples.map(x => x.fps).filter(x => x != null && x > 0), l = L();
      const rec = { pkg: a.pkg, name: a.g.name || nice(a.pkg), start: a.startedAt, secs, peak: temps.length ? Math.max(...temps) : null, avg: temps.length ? Math.round(temps.reduce((x, y) => x + y, 0) / temps.length * 10) / 10 : null, batStart: a.batStart, batEnd: l && l.battery >= 0 ? l.battery : null, fps: fps.length ? Math.round(fps.reduce((x, y) => x + y, 0) / fps.length) : null };
      STK.kv.set('gamesessions', [...(STK.kv.get('gamesessions', []) || []), rec].slice(-20));
    }
  } catch (e) { /* history is optional */ }
  STK.toast('Game mode off. Settings restored.');
  if (a.gm) { try { await STK.post('/game-tools', { serial, action: 'gamemode', pkg: a.pkg, mode: 'standard' }, { timeout: 30000 }); } catch (e) { /* ignore */ } }
  if (a.smooth) { try { const s = a.prevSys || {}; await STK.post('/game-tools', { serial, action: 'setstate', minRefresh: s.minRefresh || '', peakRefresh: s.peakRefresh || '' }, { timeout: 30000 }); } catch (e) { /* ignore */ } }
  if (a.rec && STK.recording()) { try { await STK.actions.record(); } catch (e) { /* ignore */ } }
  if (a.mir && STK.mirroring()) { try { await STK.actions.mirror(); } catch (e) { /* ignore */ } }
  if (a.prevToggles) { if (a.g.dnd) await setT(serial, 'dnd', !!a.prevToggles.dnd); if (a.g.touches) await setT(serial, 'touches', !!a.prevToggles.touches); }
  if (a.prevSettings) { try { await STK.post('/settings', { patch: a.prevSettings }); await STK.loadSettings(); } catch (e) { /* ignore */ } }
}
STK.on('live', ({ L: l }) => {
  const serial = STK.sel(); if (!serial || !l) return;
  if (state.view === 'studio') paint();
  const a = S.active[serial];
  if (a) {
    if (l.tempC != null && l.tempC >= S.heatLimit && Date.now() - S.heatAt > 300000) { S.heatAt = Date.now(); STK.toast('The phone is hot (' + l.tempC + ' °C). Take a short break or start the cool-down.', 'bad', { label: 'Cool down', run: () => { STK.go('studio'); S.tab = 'cooling'; render(); coolOn(); } }); }
    if (l.battery >= 0 && l.battery <= 15 && !l.charging && Date.now() - S.lowAt > 600000) { S.lowAt = Date.now(); STK.toast('Battery is at ' + l.battery + '%. Plug the phone in to keep playing.', 'bad'); }
  }
  const pkg = l.fgPackage;
  if (!a) { const g = games().find(x => x.pkg === pkg && x.on !== false); if (g && pkg) enter(serial, g); }
  else if (pkg && pkg !== a.pkg) { S.misses[serial] = (S.misses[serial] || 0) + 1; if (S.misses[serial] >= 2) exit(serial); }
  else S.misses[serial] = 0;
});

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('#studio-root button'); if (!t) return;
  if (t.dataset.sttab) { S.tab = t.dataset.sttab; STK.store.set('studio-tab', S.tab); render(); if (S.tab === 'optimize' && !S.toggles) loadToggles(); if (S.tab === 'capture') loadDemo(); return; }
  if (t.dataset.fix) return fix(t.dataset.fix, t);
  if (t.id === 'turbo-btn') return S.turbo ? turboOff() : turboOn();
  if (t.id === 'play-btn') {
    const pkg = S.pkg; if (!pkg) return STK.toast('Pick a target game first.', 'bad');
    return STK.busy(t, async () => { try { if (!S.turbo) await turboOn(); await gt({ action: 'launch', pkg }); STK.toast('Have a great game!'); } catch (er) { STK.fail(er); } });
  }
  if (t.id === 'cool-btn') return S.cool ? coolOff() : coolOn();
  if (t.id === 'net-run') return netRun();
  if (t.id === 'demo-toggle') return toggleDemo(t);
  if (t.id === 'demo-present') { STK.go('console'); return setTimeout(() => { if ($('#hero').dataset.size !== 'l') $('#frame-size').click(); }, 120); }
  if (t.id === 'game-add') return editGame(-1);
  if (t.dataset.gedit) return editGame(Number(t.dataset.gedit));
  if (t.dataset.gdel) { const list = games().slice(); list.splice(Number(t.dataset.gdel), 1); STK.kv.set('games', list); return render(); }
  if (t.dataset.gplay) { const g = games()[Number(t.dataset.gplay)]; if (!g) return; S.pkg = g.pkg; return STK.busy(t, async () => { try { await gt({ action: 'launch', pkg: g.pkg }); STK.toast('Opening ' + (g.name || nice(g.pkg)) + '...'); } catch (er) { STK.fail(er); } }); }
  if (t.dataset.kit) {
    const key = t.dataset.kit, id = STK.sel(); if (!id) return;
    const t0 = S.toggles || {}, cur = key === 'animations' ? t0[key] !== false : !!t0[key], next = !cur;
    return STK.busy(t, async () => { try { await tog(key, next); S.toggles = { ...t0, [key]: next }; render(); } catch (er) { STK.fail(er); } });
  }
  if (t.id === 'gt-freemem') return tool(t, { action: 'freemem' }).then(() => pollPerf());
  if (t.id === 'gt-perf-on') return tool(t, { action: 'perfmode', on: true });
  if (t.id === 'gt-perf-off') return tool(t, { action: 'perfmode', on: false });
  if (t.id === 'gt-refresh-on') return tool(t, { action: 'refresh', on: true });
  if (t.id === 'gt-refresh-off') return tool(t, { action: 'refresh', on: false });
  if (t.id === 'gt-lp-off') return tool(t, { action: 'setstate', lowPower: 0 });
  if (t.id === 'gt-gm') { const pkg = targetPkg(); if (!pkg) return STK.toast('Open the game on the phone, or pick one from the list.', 'bad'); return tool(t, { action: 'gamemode', pkg, mode: 'performance' }); }
  if (t.id === 'gt-stats') return readStats(t);
  if (t.id === 'gt-stats-reset') { const pkg = targetPkg(); if (!pkg) return STK.toast('Open the game on the phone, or pick one from the list.', 'bad'); const r = await tool(t, { action: 'resetstats', pkg }); if (r) { S.stats = null; render(); } return; }
  if (t.dataset.spreset) {
    const p = state.schema.presets.find(x => x.id === t.dataset.spreset);
    return STK.busy(t, async () => { try { await STK.post('/settings', { patch: p.v }); await STK.loadSettings(); STK.toast(p.name + ' preset applied.'); } catch (er) { STK.fail(er); } });
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'st-pkg') { S.pkg = el.value; S.stats = null; S.lastFrames = null; S.hist.forEach(x => { x.fps = null; }); render(); pollPerf(); return; }
  if (el.id === 'heat-limit') { const v = Math.max(36, Math.min(55, Number(el.value) || 43)); S.heatLimit = v; STK.store.set('heat-limit', v); el.value = v; paint(); return; }
  if (el.id === 'cool-target') { const v = Math.max(30, Math.min(45, Number(el.value) || 38)); S.coolTarget = v; STK.store.set('cool-target', v); el.value = v; return; }
  const c = el.closest && el.closest('input[data-gon]'); if (!c) return;
  const list = games().slice(); list[Number(c.dataset.gon)] = { ...list[Number(c.dataset.gon)], on: c.checked }; STK.kv.set('games', list);
});
STK.views.studio = { onShow() { render(); STK.loadSchema().then(() => { if (state.view === 'studio') render(); }).catch(() => {}); loadToggles(); if (S.tab === 'capture') loadDemo(); startPerf(); } };
STK.on('view', name => { if (name !== 'studio') stopPerf(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view === 'studio') pollPerf(); });
STK.on('device-changed', () => { S.toggles = null; S.stats = null; S.hist = []; S.perf = null; S.lastFrames = null; S.net = null; if (state.view === 'studio') { render(); loadToggles(); pollPerf(); } });
STK.on('kv', () => { if (state.view === 'studio' && (S.tab === 'games' || S.tab === 'overview')) { if (!document.activeElement || !/INPUT|SELECT/.test(document.activeElement.tagName)) render(); } });
})();
