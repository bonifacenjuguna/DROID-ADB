/* Studio 3.8 screens: header, tabs, cards, interactive graphs, and every click. Engine: studio.js. */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const SX = STK.sx, SS = STK.studioCore, S = SS.S, store = STK.store;
const num = SX.num, root = SS.root;
const enc = encodeURIComponent;
const TABS = [['overview', 'Overview', 'gauge'], ['perf', 'Performance', 'cpu'], ['optimize', 'Optimize', 'rocket'], ['cooling', 'Cooling', 'temp'], ['battery', 'Battery', 'battery'], ['games', 'Games', 'game'], ['capture', 'Capture', 'camera']];
const KIT = [['dnd', 'Do not disturb', 'No pop-ups', 'bell'], ['animations', 'Animations', 'Off feels snappier', 'sparkle'], ['stayawake', 'Stay awake', 'Screen stays on while charging', 'bolt'], ['touches', 'Show touches', 'Taps show on recordings', 'tap'], ['rotation', 'Auto-rotate', 'Off locks orientation', 'rotate'], ['autobrightness', 'Auto brightness', 'Off keeps the light steady', 'sun-moon'], ['wifi', 'Wi-Fi', 'Wireless network', 'wifi'], ['bluetooth', 'Bluetooth', 'Accessories and pads', 'link'], ['data', 'Mobile data', 'Cellular internet', 'globe'], ['airplane', 'Airplane mode', 'All radios off', 'send'], ['dark', 'Dark mode', 'Phone theme', 'eye'], ['pointer', 'Pointer location', 'Developer touch trace', 'pin']];
const ago = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 10 ? 'just now' : s < 60 ? s + ' s ago' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago'; };
const setHtml = (el, h) => { if (el && el._h !== h) { el._h = h; el.innerHTML = h; } };
const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
const lv = (el, level) => { if (!el) return; el.classList.remove('ok', 'warn', 'bad'); if (level) el.classList.add(level); };
let enterNext = true, tl = { metric: store.get('sx-tlm', 'temp'), per: store.get('sx-tlp', '15m'), chart: null };

/* ---------- small templates ---------- */
const panel = (title, body, { right = '', cls = '', id = '' } = {}) => `<section class="sx-panel ${cls}" ${id ? `id="${id}"` : ''}><header class="sx-ph"><h2>${title}</h2>${right ? `<div class="sx-ph-r">${right}</div>` : ''}</header>${body}</section>`;
const sw = (attrs, on, label) => `<label class="sx-sw"><input type="checkbox" ${attrs} ${on ? 'checked' : ''} aria-label="${esc(label)}"><i></i></label>`;
const kpi = (id, label, ic, key) => `<button type="button" class="sx-kpi" data-kpi="${id}" data-open="${key || id}" aria-label="${esc(label)}: open the large graph"><span class="sx-kpi-h">${icon(ic, 'sm')}<span>${esc(label)}</span><i class="sx-exp">${icon('expand', 'sm')}</i></span><b class="sx-kpi-v"><span data-n>-</span><u data-u></u></b><span class="sx-kpi-d" data-d></span><span class="sx-kpi-s" data-s></span><small class="sx-kpi-n" data-note></small><i class="sx-kpi-bar"><u data-bar></u></i></button>`;
const empty = (ic, t, p) => `<div class="sx-empty-state">${icon(ic)}<b>${t}</b><p>${p}</p></div>`;
const dev = () => STK.current();

/* ---------- header and tabs ---------- */
function headerHtml() {
  const d = dev(), a = Object.values(S.active)[0];
  return `<div class="sx-head"><div class="sx-title"><p class="hint">${d ? 'Tuning <b>' + esc(d.model || d.id) + '</b>. ' : ''}Live performance, cooling and capture tools for your phone.</p></div>
    <div class="sx-head-r"><button type="button" class="sx-live ${S.paused ? 'paused' : ''}" id="sx-pause" aria-pressed="${S.paused}" title="Pause or resume live updates (P)"><i></i><span id="sx-live-t">${S.paused ? 'Paused' : 'Live'}</span><em id="sx-live-a"></em></button>
      <label class="sx-sel" title="How often the phone is read"><span class="sr">Update every</span><select id="sx-int" aria-label="Update interval">${[[2500, 'Every 2.5 s'], [4000, 'Every 4 s'], [7000, 'Every 7 s'], [15000, 'Every 15 s']].map(([v, l]) => `<option value="${v}" ${S.interval === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button type="button" class="sx-btn sm" id="sx-more">${icon('download', 'sm')}<span>Data</span></button></div></div>
    <nav class="sx-tabs" role="tablist" aria-label="Studio sections">${TABS.map(([k, n, ic]) => `<button type="button" role="tab" class="sx-tab ${S.tab === k ? 'is-active' : ''}" data-sttab="${k}" aria-selected="${S.tab === k}">${icon(ic, 'sm')}<span>${n}</span>${k === 'games' && a ? '<i class="sx-tab-dot"></i>' : ''}</button>`).join('')}<i class="sx-tab-ind" id="sx-ind"></i></nav>`;
}
function moveInd() {
  const ind = $('#sx-ind'), act = $('.sx-tab.is-active'); if (!ind || !act) return;
  ind.style.width = act.offsetWidth + 'px'; ind.style.transform = `translateX(${act.offsetLeft}px)`; ind.style.opacity = 1;
}

/* ---------- tab bodies ---------- */
function tabOverview() {
  const opts = gameOptions();
  return `<section class="sx-hero" id="sx-hero">
      <div class="sx-ring-wrap" id="sx-ring">${SX.ring(0, 'var(--ok)', '-', 'readiness')}</div>
      <div class="sx-hero-main"><div class="sx-hero-top"><h3 id="sx-word" aria-live="polite">Reading the phone...</h3></div>
        <div class="sx-pills" id="sx-pills"></div><p class="hint lead" id="sx-sub">Live numbers appear in a few seconds.</p>
        <div class="sx-hero-row"><label class="sx-sel wide"><span>Target game</span><select id="st-pkg" aria-label="Target game">${opts}</select></label></div>
        <div class="sx-hero-row"><button class="sx-btn primary lg" id="turbo-btn" type="button"></button><button class="sx-btn lg" id="play-btn" type="button">${icon('play')}<span>Boost and play</span></button><button class="sx-btn lg ghost" id="cool-quick" type="button">${icon('fan')}<span>Cool down</span></button></div>
        <div class="sx-progress" id="sx-prog" hidden><i></i></div><ul class="sx-steps" id="sx-steps"></ul></div></section>
    <div class="sx-kpis" id="sx-kpis">${kpi('temp', 'Phone temperature', 'temp')}${kpi('cpu', 'Processor load', 'cpu')}${kpi('ram', 'Memory used', 'ram')}${kpi('gpu', 'Graphics load', 'gpu')}${kpi('bat', 'Battery', 'battery')}${kpi('fps', 'Frame rate', 'pulse')}${kpi('power', 'Power draw', 'bolt')}${kpi('storage', 'Storage used', 'storage', 'storage')}</div>
    <div class="sx-cols"><div class="sx-col">
      ${panel('Live graph', `<div class="sx-tl-bar"><div class="sx-seg" id="sx-tlm" role="tablist">${[['temp', 'Temperature'], ['cpu', 'Processor'], ['ram', 'Memory'], ['fps', 'Frame rate'], ['bat', 'Battery'], ['power', 'Power']].map(([k, l]) => `<button type="button" data-tlm="${k}" class="${tl.metric === k ? 'is-active' : ''}">${l}</button>`).join('')}</div><span class="grow"></span><div class="sx-seg sm" id="sx-tlp">${SX.PERIODS.slice(0, 4).map(p => `<button type="button" data-tlp="${p[0]}" class="${tl.per === p[0] ? 'is-active' : ''}">${p[0]}</button>`).join('')}</div><button class="sx-btn sm" type="button" data-open="tl">${icon('expand', 'sm')}<span>Expand</span></button></div><div id="sx-tl" class="sx-tl"></div><p class="hint">Move over the graph for exact values. Expand it for 24 hours of history, zoom and CSV export.</p>`)}
      ${panel('Phone passport', '<div id="sx-passport" class="sx-kv"></div>')}
    </div><div class="sx-col">
      ${panel('Suggestions', '<div id="st-sugs" class="sx-sugs"></div>')}
      ${panel('Watchdog', watchdogHtml(), { right: '<span class="hint">Alerts you before trouble starts</span>' })}
      ${panel('Activity', '<div id="sx-events" class="sx-events"></div>', { right: '<button class="sx-btn sm ghost" type="button" id="sx-ev-clear">Clear</button>' })}
    </div></div>`;
}
function watchdogHtml() {
  const w = S.wd, row = (k, label, lim, unit, min, max) => `<div class="sx-wd"><div><b>${label}</b><small>${lim ? `Alert at <input type="number" data-wdn="${lim}" min="${min}" max="${max}" value="${w[lim]}" aria-label="${esc(label)} limit"> ${unit}` : 'Alert when the system slows down'}</small></div>${sw(`data-wd="${k}"`, w[k], label)}</div>`;
  return `<div class="sx-wds">${row('heat', 'Heat', 'heatLimit', '°C', 36, 55)}${row('low', 'Low battery', 'lowLimit', '%', 5, 50)}${row('ram', 'Memory full', 'ramLimit', '%', 70, 99)}${row('fps', 'Low frame rate', 'fpsLimit', 'fps', 10, 90)}${row('thr', 'Throttling', '', '', 0, 0)}</div><p class="hint">Alerts show here and as a desktop notice when the page is in the background.</p>`;
}
function gameOptions() {
  return '<option value="">Whatever is in front on the phone</option>' + SS.games().map(g => `<option value="${esc(g.pkg)}" ${S.pkg === g.pkg ? 'selected' : ''}>${esc(g.name || SS.nice(g.pkg))}</option>`).join('');
}

function tabPerf() {
  const ap = S.top;
  return `<div class="sx-cols"><div class="sx-col">
    ${panel('Processor cores', '<div id="sx-cores" class="sx-cores"></div><div class="sx-mini"><span id="sx-gpu-line"></span></div>', { right: '<button class="sx-btn sm" type="button" data-open="cpu">' + icon('expand', 'sm') + '<span>History</span></button>' })}
    ${panel('Frame stats', frameHtml(), { right: `<label class="sx-chk"><input type="checkbox" id="sx-stats-auto" ${S.statsAuto ? 'checked' : ''}><span>Auto refresh</span></label>` })}
    ${panel('Network', netHtml(), { right: `<button class="sx-btn sm" id="net-run" type="button" ${S.netBusy ? 'disabled' : ''}>${icon('wifi', 'sm')}<span>Test connection</span></button>` })}
  </div><div class="sx-col">
    ${panel('Performance recorder', recorderHtml(), { right: S.rec ? '<span class="sx-rec-pill"><i></i>Recording</span>' : '' })}
    ${panel('Busiest apps right now', '<div id="sx-top"></div>', { right: `<button class="sx-btn sm" id="sx-top-reload" type="button">${icon('refresh', 'sm')}<span>Refresh</span></button>` })}
    ${panel('Sensors', '<div id="sx-zones-mini" class="sx-zones"></div>', { right: '<button class="sx-btn sm" type="button" data-open="zones">' + icon('expand', 'sm') + '<span>History</span></button>' })}
  </div></div>`;
}
function frameHtml() {
  const st = S.stats;
  if (!st) return `<p class="hint">Reads how smoothly the target game draws frames: the time each frame takes and what slowed it down. Open the game on the phone, then read.</p><div class="row"><button class="sx-btn" id="gt-stats" type="button">${icon('pulse', 'sm')}<span>Read frame stats</span></button></div>`;
  if (!st.running) return `<p class="hint">The phone has no frame data for that app yet. Play for a moment, then read again.</p><div class="row"><button class="sx-btn" id="gt-stats" type="button">${icon('pulse', 'sm')}<span>Read again</span></button></div>`;
  const h = st.histogram || [], max = Math.max(1, ...h.map(x => x[1]));
  const bars = h.length ? `<div class="sx-hist" role="img" aria-label="Frame time distribution">${h.map(([ms, n]) => `<div class="sx-hbar ${ms > 32 ? 'bad' : ms > 16 ? 'warn' : ''}" title="${ms} ms: ${n} frames"><i style="height:${Math.max(3, n / max * 100)}%"></i><span>${ms}</span></div>`).join('')}</div><p class="hint sx-hist-note">Frame time in milliseconds. Bars left of 16 ms are smooth at 60 fps; right of 33 ms is a visible stutter.</p>` : '';
  const c = st.causes || {}, causes = [['Missed vsync', c.missedVsync], ['Slow UI thread', c.slowUi], ['Slow draw commands', c.slowDraw], ['High input delay', c.highInput], ['Slow bitmap uploads', c.slowBitmap]].filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  return `<div class="sx-stats4"><div><small>Frames drawn</small><b>${st.frames}</b></div><div class="${st.jankyPct >= 15 ? 'bad' : st.jankyPct >= 5 ? 'warn' : 'ok'}"><small>Janky frames</small><b>${st.jankyPct}%</b></div><div><small>Typical frame</small><b>${st.p50 == null ? '-' : st.p50 + ' ms'}</b></div><div class="${st.p95 >= 33 ? 'warn' : ''}"><small>Slow (95%)</small><b>${st.p95 == null ? '-' : st.p95 + ' ms'}</b></div></div>${bars}
    ${causes.length ? `<div class="sx-causes"><b>What slowed frames down</b>${causes.map(([n, v]) => `<div class="sx-cause"><span>${n}</span><i><u style="width:${Math.min(100, v / causes[0][1] * 100)}%"></u></i><em>${v}</em></div>`).join('')}</div>` : ''}
    <div class="row"><button class="sx-btn" id="gt-stats" type="button">${icon('pulse', 'sm')}<span>Read again</span></button><button class="sx-btn ghost" id="gt-stats-reset" type="button"><span>Reset counters</span></button></div><p class="hint">Updated ${esc(ago(st.at))}. Under 5% janky is smooth.</p>`;
}
function netHtml() {
  const n = S.net;
  if (S.netBusy) return '<div class="sx-skel"><i></i><i></i></div><p class="hint">Testing the connection...</p>';
  if (!n) return '<p class="hint">Measures delay and packet loss from the phone to the internet, and the Wi-Fi quality.</p>' + netTrend();
  if (!n.reachable) return `<div class="sx-verdict bad">${icon('alert')}<div><b>No internet from the phone</b><small>The phone could not reach the internet. Check Wi-Fi or mobile data.</small></div></div>`;
  const ms = n.avgMs, lvl = ms < 80 ? 'ok' : ms < 150 ? 'warn' : 'bad', word = ms < 40 ? 'Excellent' : ms < 80 ? 'Good' : ms < 150 ? 'Laggy' : 'Poor', tips = [];
  if (n.lossPct > 0) tips.push(n.lossPct + '% of packets were lost, which causes rubber-banding.');
  if (n.freqMhz && n.freqMhz < 3000) tips.push('The phone is on 2.4 GHz Wi-Fi. 5 GHz is usually faster and calmer for games.');
  if (n.rssi != null && n.rssi < -70) tips.push('The Wi-Fi signal is weak (' + n.rssi + ' dBm). Move closer to the router.');
  if (ms >= 80) tips.push('Close apps that download in the background, or pause other devices streaming.');
  return `<div class="sx-verdict ${lvl}">${icon(lvl === 'ok' ? 'check' : 'alert')}<div><b>${word}: ${Math.round(ms)} ms average delay</b><small>Best ${Math.round(n.minMs)} ms, worst ${Math.round(n.maxMs)} ms${n.lossPct != null ? ', ' + n.lossPct + '% lost' : ''}${n.linkMbps ? ' · Wi-Fi ' + n.linkMbps + ' Mbps' : ''}${n.freqMhz ? (n.freqMhz >= 4900 ? ' · 5 GHz' : ' · 2.4 GHz') : ''}</small></div></div>${tips.length ? '<ul class="sx-tips">' + tips.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : ''}${netTrend()}`;
}
function netTrend() { const h = S.netHist; if (h.length < 2) return ''; return `<div class="sx-nethist"><small>Delay over your last ${h.length} tests</small>${SX.spark(h.map(x => x.ms), { min: 0, color: 'var(--focus)' })}</div>`; }
function recorderHtml() {
  if (S.rec) return `<div class="sx-rec-live"><b id="sx-rec-t">00:00</b><span class="hint">${esc(S.rec.name)} · <span id="sx-rec-n">0</span> readings</span></div><div class="sx-spark-big" id="sx-rec-spark"></div><div class="row"><button class="sx-btn rec" id="sx-rec" type="button">${icon('stop', 'sm')}<span>Stop and save</span></button></div>`;
  return `<p class="hint lead">Record temperature, processor, memory, battery and frame rate while you play or test. When you stop, the run is saved to Session history with a graph you can zoom and export.</p><div class="row"><button class="sx-btn primary" id="sx-rec" type="button">${icon('record', 'sm')}<span>Start recording</span></button></div>`;
}

function tabOptimize() {
  const t = S.toggles, ex = S.ext || {};
  const profs = SS.allProfiles().map(p => { const on = S.profile && S.profile.id === p.id, busy = S.busy === p.id; return `<button type="button" class="sx-prof ${on ? 'is-on' : ''} ${busy ? 'is-busy' : ''}" data-prof="${esc(p.id)}" aria-pressed="${!!on}"><span class="sx-prof-ic">${icon(p.icon || 'sliders')}</span><b>${esc(p.name)}</b><small>${esc(p.blurb || 'Your saved settings.')}</small><em>${on ? 'Active. Click to undo' : busy ? 'Applying...' : 'Apply'}</em>${p.custom ? `<i class="sx-prof-x" data-pdel="${esc(p.id)}" title="Delete profile" role="button" aria-label="Delete profile">${icon('x', 'sm')}</i>` : ''}</button>`; }).join('');
  const tiles = KIT.map(([k, l, h, ic]) => { const on = t ? (k === 'animations' ? t[k] !== false : !!t[k]) : false; return `<button type="button" class="sx-tile ${on ? 'on' : ''}" data-kit="${k}" aria-pressed="${on}" ${t ? '' : 'disabled'}><span class="sx-tile-ic">${icon(ic)}</span><b>${esc(l)}</b><small>${esc(h)}</small><i class="sx-knob"></i></button>`; }).join('');
  const to = [[15000, '15 seconds'], [30000, '30 seconds'], [60000, '1 minute'], [120000, '2 minutes'], [300000, '5 minutes'], [600000, '10 minutes'], [1800000, '30 minutes']];
  const br = num(ex.brightness) && ex.brightness >= 0 ? ex.brightness : 128;
  return `<div class="sx-cols"><div class="sx-col">
    ${panel('Profiles', `<p class="hint lead">One tap sets the phone up for a job. Undo restores exactly what you had before. Only one profile is active at a time.</p><div class="sx-profs">${profs}</div><div class="sx-hero-row"><button class="sx-btn" id="prof-save" type="button">${icon('save', 'sm')}<span>Save current settings as a profile</span></button>${S.profile ? `<button class="sx-btn rec" id="sx-undo" type="button">${icon('refresh', 'sm')}<span>Undo ${esc(S.profile.name)}</span></button>` : ''}</div><div class="sx-progress" id="sx-prog" hidden><i></i></div><ul class="sx-steps" id="sx-steps"></ul>`)}
    ${panel('Display and sound', `<div class="sx-sliders"><label class="sx-slide"><span>${icon('sun-moon', 'sm')}Brightness <b id="sl-br-v">${Math.round(br / 2.55)}%</b></span><input type="range" min="1" max="255" value="${br}" data-slider="brightness" ${t ? '' : 'disabled'} aria-label="Brightness"></label>
      <label class="sx-slide"><span>${icon('volup', 'sm')}Media volume <b id="sl-vol-v">${num(ex.volume) ? ex.volume + '/' + (ex.volumeMax || 15) : '-'}</b></span><input type="range" min="0" max="${ex.volumeMax || 15}" value="${num(ex.volume) ? ex.volume : 0}" data-slider="volume" ${t && num(ex.volume) ? '' : 'disabled'} aria-label="Media volume"></label>
      <label class="ff sx-timeout"><span>Screen turns off after</span><select data-slider="timeout" ${t ? '' : 'disabled'}>${to.map(([v, l]) => `<option value="${v}" ${ex.timeout === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div><p class="hint">Changing brightness switches the phone to manual brightness.</p>`)}
    </div><div class="sx-col">
    ${panel('Quick switches', `<div class="sx-tiles" id="gt-toggles">${tiles}</div>${t ? '' : '<p class="hint">Reading the phone switches...</p>'}`)}
    ${panel('Game tools', `<div class="sx-hero-row"><label class="sx-sel wide"><span>Game</span><select id="st-pkg" aria-label="Game for the tools">${gameOptions()}</select></label></div>
      <div class="sx-toolgrid"><button class="sx-btn" id="gt-freemem" type="button">${icon('bolt', 'sm')}<span>Free memory</span></button><button class="sx-btn" id="gt-trim" type="button">${icon('trash', 'sm')}<span>Clear app caches</span></button><button class="sx-btn" id="gt-perf-on" type="button">${icon('game', 'sm')}<span>Performance mode</span></button><button class="sx-btn ghost" id="gt-perf-off" type="button"><span>Performance off</span></button><button class="sx-btn" id="gt-refresh-on" type="button">${icon('sparkle', 'sm')}<span>Lock high refresh</span></button><button class="sx-btn ghost" id="gt-refresh-off" type="button"><span>Automatic refresh</span></button><button class="sx-btn" id="gt-gm" type="button">${icon('game', 'sm')}<span>Game Mode: performance</span></button><button class="sx-btn ghost" id="gt-lp-off" type="button"><span>Battery saver off</span></button></div>
      <p class="hint">Performance mode and Game Mode depend on the phone maker. If the phone declines, you see exactly what it answered and the rest still works.</p>`)}
    </div></div>`;
}

function tabCooling() {
  const ts = S.perf ? S.perf.thermalStatus : null, on = S.profile && S.profile.id === 'cool';
  const TECH = [['Take the case off', 'Cases trap heat. Playing caseless, or with a thin one, lets the frame act as a heat sink.', 'case'], ['Pause or slow the charging', 'Charging while gaming is the biggest heat source. Use a slow charger, or unplug until the phone is warm no more.', 'charge'], ['Lower the brightness', 'The screen is the second hottest part. Dropping to about 40% cuts several degrees.', 'bright'], ['Cap the frame rate in the game', '60 fps instead of 120 fps can lower the temperature by 3 to 5 degrees with little visible difference.', 'fps'], ['Give it airflow', 'Prop the phone on a stand, away from the bed, sofa or your hand. A small clip-on fan helps a lot.', 'air'], ['Stay out of the sun', 'Direct sun on a dark phone adds heat that no setting can remove. Play in the shade.', 'sun'], ['Use Wi-Fi, not mobile data', 'The radio runs hot on weak mobile signal. A good Wi-Fi link is cooler and has lower delay.', 'net'], ['Take a 5-minute break', 'Every 30 to 45 minutes, let the phone rest with the screen off. It recovers faster than you expect.', 'break'], ['Never use a fridge or freezer', 'Rapid cooling causes condensation inside the phone and can damage it. Cool it gently with air.', 'warn']];
  const done = store.get('sx-tried', []);
  return `<div class="sx-cols"><div class="sx-col">
    ${panel('Temperature', `<div class="sx-cool-main" data-open="temp" role="button" tabindex="0" aria-label="Open the temperature graph"><div class="sx-gauge" id="sx-tg">${SX.arc()}<div class="sx-gauge-in"><b id="cool-big">-</b><small id="cool-word"></small></div></div><div class="sx-cool-side" id="cool-side"></div></div><div id="cool-trend" class="sx-spark-big"></div>
      <div class="sx-stats4"><div id="cool-soc"><small>Processor</small><b>-</b></div><div id="cool-thr" class="${ts >= 2 ? 'bad' : ''}"><small>Android throttling</small><b>${ts == null ? '-' : SS.THERMAL[ts]}</b></div><div id="cool-bat"><small>Battery</small><b>-</b></div><div id="cool-fc"><small>Forecast</small><b>-</b></div></div>`, { right: `<span class="sx-chip" id="cool-chip"><i class="dot"></i><b>-</b></span>` })}
    ${panel('All sensors', '<div id="cool-zones" class="sx-zones"></div>', { right: '<span class="hint">Click a sensor for its history</span>' })}
    </div><div class="sx-col">
    <section class="sx-panel sx-cool-card ${on ? 'is-on' : ''}"><header class="sx-ph"><h2>Cool-down assistant</h2><span class="sx-chip ${on ? 'ok' : ''}"><i class="dot"></i><b>${on ? 'Active' : 'Off'}</b></span></header>
      <div class="sx-fanrow"><div class="sx-fan ${on ? 'spin' : ''}">${icon('fan')}</div><p class="hint lead">Lowers brightness, turns on battery saver, closes background apps and ends performance mode. You get a notice when the phone reaches <b>${S.wd.coolTarget} °C</b>. Undo brings your old settings back.</p></div>
      <div class="sx-hero-row"><button class="sx-btn primary" id="cool-btn" type="button" ${S.busy ? 'disabled' : ''}>${icon('snow', 'sm')}<span>${on ? 'Restore settings' : 'Start cool-down'}</span></button></div>
      <div class="sx-form2"><label class="ff"><span>Warn me above (°C)</span><input id="heat-limit" type="number" min="36" max="55" value="${S.wd.heatLimit}"></label><label class="ff"><span>Cool-down target (°C)</span><input id="cool-target" type="number" min="30" max="45" value="${S.wd.coolTarget}"></label></div></section>
    ${panel('Cooling techniques', `<div class="sx-techs">${TECH.map(([n, d, k]) => `<div class="sx-tech ${k === 'warn' ? 'warn' : ''}" data-tech="${k}"><button type="button" class="sx-tick-btn ${done.includes(k) ? 'on' : ''}" data-tried="${k}" aria-pressed="${done.includes(k)}" title="Mark as tried">${icon('check', 'sm')}</button><div><b>${esc(n)}<em class="sx-sugg" hidden>Suggested now</em></b><span>${esc(d)}</span></div></div>`).join('')}</div>`)}
    </div></div>`;
}

function tabBattery() {
  const ba = S.battApps;
  const apps = ba && ba.apps && ba.apps.length ? (() => { const mx = Math.max(1, ...ba.apps.map(a => a.mah)); return ba.apps.slice(0, 10).map(a => `<div class="sx-bar"><span class="bn">${esc(SS.nice(a.package))}<small>${esc(a.package)}</small></span><i><u style="width:${a.mah / mx * 100}%"></u></i><b>${a.mah} mAh</b></div>`).join(''); })() : `<p class="hint">${S.battBusy ? 'Reading battery use from the phone. This can take a few seconds...' : esc((ba && ba.note) || 'No per-app data from this phone.')}</p>`;
  return `<div class="sx-cols"><div class="sx-col">
    ${panel('Battery', `<div class="sx-bat-main" data-open="bat" role="button" tabindex="0" aria-label="Open the battery graph"><div class="sx-batring" id="sx-batring"></div><div class="sx-bat-side"><b id="bat-status">-</b><span class="hint" id="bat-eta"></span></div></div><div class="sx-kv" id="bat-kv"></div>`)}
    ${panel('Charge history', `<div class="sx-tl-bar"><div class="sx-seg"><button type="button" data-batm="bat" class="is-active">Level</button><button type="button" data-batm="power">Power</button></div><span class="grow"></span><button class="sx-btn sm" type="button" data-open="bat">${icon('expand', 'sm')}<span>Expand</span></button></div><div id="sx-bt" class="sx-tl"></div>`)}
    </div><div class="sx-col">
    ${panel('Battery use by app', `<div id="bat-apps" class="sx-bars">${apps}</div>`, { right: `<button class="sx-btn sm" id="bat-reload" type="button">${icon('refresh', 'sm')}<span>Reload</span></button>` })}
    ${panel('Tips', '<ul class="sx-tips"><li>Charging while gaming is the biggest source of heat. A slower charger keeps the phone cooler and the battery healthier.</li><li>Keeping the charge between 20% and 80% slows battery ageing.</li><li>Battery saver cuts the processor speed. Turn it off before gaming and on again after.</li><li>A phone above 40 °C charges slower to protect the battery.</li></ul>')}
    </div></div>`;
}

function tabGames() {
  const gl = SS.games(), pt = STK.kv.get('playtime', {}) || {}, ses = STK.kv.get('gamesessions', []) || [], act = Object.values(S.active)[0];
  const rows = gl.length ? `<div class="sx-glist">${gl.map((g, i) => `<div class="sx-game ${S.active[STK.sel()] && S.active[STK.sel()].pkg === g.pkg ? 'live' : ''}"><span class="sx-badge">${icon('game')}</span><div><b>${esc(g.name || SS.nice(g.pkg))}</b><small>${esc(g.pkg)}${gameSummary(g, pt)}</small></div><button class="sx-btn sm primary" data-gplay="${i}" title="Open on the phone and boost" type="button">${icon('play', 'sm')}<span>Play</span></button>${sw(`data-gon="${i}"`, g.on !== false, 'Enable ' + (g.name || g.pkg))}<span class="sx-rowbtns"><button class="sx-icon" data-gedit="${i}" title="Edit" type="button">${icon('pencil', 'sm')}</button><button class="sx-icon" data-gdel="${i}" title="Remove" type="button">${icon('trash', 'sm')}</button></span></div>`).join('')}</div>` : empty('game', 'No games yet', 'Add the games you play. Each one gets its own profile.');
  const day = 864e5, days = Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.now() - (6 - i) * day); d.setHours(0, 0, 0, 0); return { t: d.getTime(), secs: 0 }; });
  ses.forEach(s => { const d = new Date(s.start); d.setHours(0, 0, 0, 0); const x = days.find(y => y.t === d.getTime()); if (x) x.secs += s.secs; });
  const mx = Math.max(60, ...days.map(d => d.secs)), total = ses.reduce((a, s) => a + s.secs, 0), peaks = ses.map(s => s.peak).filter(num), fpss = ses.map(s => s.fps).filter(num);
  const wk = `<div class="sx-week">${days.map(d => `<div class="sx-day" title="${esc(new Date(d.t).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }))}: ${d.secs ? STK.dur(d.secs) : 'no play'}"><i style="height:${Math.max(4, d.secs / mx * 100)}%" class="${d.secs ? 'has' : ''}"></i><span>${new Date(d.t).toLocaleDateString([], { weekday: 'short' }).slice(0, 2)}</span></div>`).join('')}</div>`;
  const list = ses.length ? `<div class="sx-sesl">${ses.slice().reverse().slice(0, 14).map(s => { const i = ses.indexOf(s); return `<button type="button" class="sx-ses" data-sess="${i}" aria-label="Open session ${esc(s.name)}"><span class="sx-ses-ic">${icon(s.manual ? 'record' : 'game')}</span><div><b>${esc(s.name)}${s.manual ? ' <em>recorded</em>' : ''}</b><small>${esc(new Date(s.start).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</small></div><span>${esc(STK.dur(s.secs))}</span><span class="${SS.tempLevel(s.peak)}">${s.peak == null ? '-' : 'Peak ' + s.peak + ' °C'}</span><span>${s.fps ? s.fps + ' fps' : '-'}</span><span>${s.batStart != null && s.batEnd != null ? (s.batStart - s.batEnd >= 0 ? '-' : '+') + Math.abs(s.batStart - s.batEnd) + '%' : '-'}</span>${s.samples && s.samples.length ? SX.spark(s.samples.map(x => x.phone), { color: 'var(--warn)' }) : '<span></span>'}</button>`; }).join('')}</div>` : '<p class="hint">After each game session, or a recording from the Performance tab, you see its length, peak temperature and battery use here. Click one to open its graph.</p>';
  return `<div class="sx-cols"><div class="sx-col">${panel('Game profiles', `<p class="hint lead">When a game on this list comes to the front of the phone, Studio applies its profile and puts everything back when you leave. It works while this dashboard is open.</p>${rows}<div class="row"><button class="sx-btn primary" id="game-add" type="button">${icon('game', 'sm')}<span>Add a game</span></button></div>`, { right: act ? `<span class="sx-chip ok"><i class="dot"></i><b>Active: ${esc(SS.nice(act.pkg))}</b></span>` : '<span class="sx-chip"><i class="dot"></i><b>Waiting</b></span>' })}</div>
    <div class="sx-col">${panel('Play time', `<div class="sx-stats4"><div><small>Total</small><b>${total ? STK.dur(total) : '-'}</b></div><div><small>Sessions</small><b>${ses.length}</b></div><div><small>Average fps</small><b>${fpss.length ? Math.round(fpss.reduce((a, b) => a + b, 0) / fpss.length) : '-'}</b></div><div class="${SS.tempLevel(Math.max(0, ...peaks))}"><small>Hottest</small><b>${peaks.length ? Math.max(...peaks) + ' °C' : '-'}</b></div></div>${wk}<p class="hint">Last 7 days.</p>`)}
    ${panel('Session history', list, { right: ses.length ? '<button class="sx-btn sm ghost" id="sess-csv" type="button">' + icon('download', 'sm') + '<span>CSV</span></button>' : '' })}</div></div>`;
}
function gameSummary(g, pt) {
  const bits = []; if (g.preset) bits.push('preset ' + presetName(g.preset)); if (g.mirror) bits.push('mirror'); if (g.record) bits.push('record'); if (g.dnd) bits.push('Do not disturb'); if (g.touches) bits.push('show touches'); if (g.freemem) bits.push('frees memory'); if (g.gamemode) bits.push('Game Mode'); if (g.smooth) bits.push('high refresh');
  const t = pt[g.pkg]; if (t) bits.push('played ' + STK.dur(t)); return bits.length ? ' · ' + bits.join(', ') : '';
}
const presetName = id => { const p = ((state.schema && state.schema.presets) || []).find(x => x.id === id); return p ? p.name : id; };

function tabCapture() {
  const o = { clock: '1200', battery: 100, hideNotifications: true, dnd: true, touches: false, ...store.get('demo-opts', {}) }, id = STK.sel(), presets = (state.schema && state.schema.presets) || [], st = state.settings || {};
  const cur = p => p.v.maxSize === st.maxSize && p.v.maxFps === st.maxFps && p.v.bitrateMbps === st.bitrateMbps;
  const mbMin = st.bitrateMbps ? Math.round(st.bitrateMbps * 60 / 8) : null;
  const rec = STK.recording && STK.recording(), mir = STK.mirroring && STK.mirroring();
  return `<div class="sx-cols"><div class="sx-col">
    ${panel('Capture now', `<div class="sx-toolgrid big"><button class="sx-btn lg ${rec ? 'rec' : ''}" id="cap-rec" type="button" aria-pressed="${!!rec}" ${id ? '' : 'disabled'}>${icon(rec ? 'stop' : 'record')}<span>${rec ? 'Stop recording' : 'Record'}</span></button><button class="sx-btn lg ${mir ? 'primary' : ''}" id="cap-mir" type="button" aria-pressed="${!!mir}" ${id ? '' : 'disabled'}>${icon('mirror')}<span>${mir ? 'Stop mirror' : 'Mirror'}</span></button><button class="sx-btn lg" id="cap-shot" type="button" ${id ? '' : 'disabled'}>${icon('camera')}<span>Screenshot</span></button><button class="sx-btn lg" id="cap-gif" type="button" ${id ? '' : 'disabled'}>${icon('image')}<span>Record a GIF</span></button></div><p class="hint">${mbMin ? 'At the current preset a recording uses about ' + mbMin + ' MB per minute.' : ''} Files appear in the Library.</p>`)}
    ${panel('Demo mode', `<p class="hint lead">Cleans up the phone status bar for screenshots and recordings: fixed clock, full battery, strong signal and no notification icons.</p>
      <div class="sx-form2"><label class="ff"><span>Clock</span><input id="demo-clock" value="${esc(o.clock.slice(0, 2) + ':' + o.clock.slice(2))}" maxlength="5" autocomplete="off"></label><label class="ff"><span>Battery</span><input id="demo-batt" type="number" min="1" max="100" value="${o.battery}"></label></div>
      <div class="sx-checks"><label class="sx-chk"><input type="checkbox" id="demo-hide" ${o.hideNotifications ? 'checked' : ''}><span>Hide notification icons</span></label><label class="sx-chk"><input type="checkbox" id="demo-dnd" ${o.dnd ? 'checked' : ''}><span>Turn on Do not disturb</span></label><label class="sx-chk"><input type="checkbox" id="demo-touch" ${o.touches ? 'checked' : ''}><span>Show touches</span></label></div>
      <div class="sx-hero-row"><button class="sx-btn ${S.demo ? '' : 'primary'}" id="demo-toggle" type="button" ${id ? '' : 'disabled'}>${icon('wand', 'sm')}<span>${S.demo ? 'Turn demo mode off' : 'Turn demo mode on'}</span></button><button class="sx-btn" id="demo-present" type="button">${icon('expand', 'sm')}<span>Presentation view</span></button></div><p class="hint">Presentation view pops the phone out as a big clean screen on the Console. Press Esc to leave it.</p>`, { right: `<span class="sx-chip ${S.demo ? 'ok' : ''}"><i class="dot"></i><b>${S.demo ? 'On' : 'Off'}</b></span>` })}
    </div><div class="sx-col">
    ${panel('Capture presets', `<p class="hint lead">One tap changes how mirroring and recording look and feel. Lighter presets keep the phone cooler.</p><div class="sx-presets">${presets.map(p => `<button type="button" class="sx-preset ${cur(p) ? 'is-current' : ''}" data-spreset="${esc(p.id)}"><b>${esc(p.name)}</b><span>${esc(p.note)}</span><em>${p.v.maxSize === 0 ? 'Native' : p.v.maxSize + ' px'} · ${p.v.maxFps} fps · ${p.v.bitrateMbps} Mbps</em>${cur(p) ? '<i class="sx-cur">In use</i>' : ''}</button>`).join('')}</div><p class="hint">Fine control is on the Settings page.</p>`)}
    </div></div>`;
}

/* ---------- render ---------- */
function render() {
  if (state.view !== 'studio') return;
  const id = STK.sel();
  destroyCharts();
  const body = !id ? `<section class="sx-panel">${empty('phone', 'Connect a phone to start', 'Studio reads live battery, heat, memory and frame data from the phone. Plug it in with USB debugging on, then it appears here.')}</section>` : ({ overview: tabOverview, perf: tabPerf, optimize: tabOptimize, cooling: tabCooling, battery: tabBattery, games: tabGames, capture: tabCapture }[S.tab] || tabOverview)();
  const rootEl = root(); if (!rootEl) return;
  rootEl._h = null;
  rootEl.innerHTML = headerHtml() + `<div class="sx-body ${enterNext ? 'sx-enter' : ''}" data-tab="${S.tab}">${body}</div>`;
  enterNext = false;
  moveInd(); mountCharts(); paint(); paintSteps(); paintEvents();
}
function destroyCharts() { if (tl.chart) { tl.chart.destroy(); tl.chart = null; } if (S.batChart) { S.batChart.destroy(); S.batChart = null; } }
function mountCharts() {
  const el = $('#sx-tl');
  if (el) { const spec = SS.metricSpec(tl.metric, { inline: true, period: tl.per }); tl.chart = new SX.Chart(el, spec); tl.chart.draw(); }
  const b = $('#sx-bt');
  if (b) { const spec = SS.metricSpec(S.batm || 'bat', { inline: true, period: '1h' }); S.batChart = new SX.Chart(b, spec); S.batChart.draw(); }
}

/* ---------- paint (live, no re-render) ---------- */
function kpiSet(id, o) {
  const el = $(`[data-kpi="${id}"]`); if (!el) return;
  el.hidden = !!o.hide; if (o.hide) return;
  const n = $('[data-n]', el); SX.setNum(n, o.v, { dec: o.dec || 0 });
  setText($('[data-u]', el), o.unit || ''); setText($('[data-note]', el), o.note || ''); setText($('[data-d]', el), o.delta || '');
  $('[data-d]', el).className = 'sx-kpi-d ' + (o.dcls || '');
  lv(el, o.level);
  const bar = $('[data-bar]', el); if (bar) bar.style.width = SX.clamp(o.pct == null ? 0 : o.pct, 0, 100) + '%';
  setHtml($('[data-s]', el), o.spark || '');
  if (o.v !== el._lastv) { if (el._lastv != null) SX.tick(el); el._lastv = o.v; }
}
const series = (key, n = 48) => { const a = SS.recent(8 * 60e3).map(p => p[key]); if (a.length <= n) return a; const out = [], w = a.length / n; for (let i = 0; i < n; i++) { const sl = a.slice(Math.floor(i * w), Math.floor((i + 1) * w)).filter(num); out.push(sl.length ? sl.reduce((x, y) => x + y, 0) / sl.length : null); } return out; };
function delta(key, cur, unit, dec = 1, minDiff = 0.2) {
  if (!num(cur)) return { t: '' };
  const old = SS.recent(75e3).filter(p => num(p[key]))[0]; if (!old || Date.now() - old.t < 25e3) return { t: '' };
  const d = cur - old[key]; if (Math.abs(d) < minDiff) return { t: 'steady', c: '' };
  return { t: (d > 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(dec) + unit + ' / min', c: d > 0 ? 'up' : 'down' };
}
function paint() {
  if (state.view !== 'studio') return;
  const id = STK.sel(); if (!id) return;
  paintLive();
  const l = SS.L(), p = S.perf, pt = SS.phoneTemp(), ram = SS.ramPct(), fps = SS.fpsNow(), s = S.sample || SS.hist() && SS.hist().last() || {};
  const gb = SS.gb;
  if ($('#sx-hero')) {
    const a = SS.analyse(), has = !!(p || l);
    const ring = $('#sx-ring'), fg = $('.sx-ring-fg', ring), txt = $('.sx-ring-n', ring);
    if (fg) { fg.style.strokeDasharray = (a.score / 100 * 326.7).toFixed(1) + ' 326.7'; fg.style.stroke = a.color; }
    if (txt) { const nowv = has ? a.score : null; if (nowv == null) txt.textContent = '-'; else { const from = Number(txt.dataset.v || nowv); txt.dataset.v = nowv; if (from !== nowv && !SX.reduced()) { const t0 = performance.now(); const st = n => { const k = Math.min(1, (n - t0) / 500); txt.textContent = Math.round(from + (nowv - from) * k); if (k < 1) requestAnimationFrame(st); }; requestAnimationFrame(st); } else txt.textContent = nowv; } }
    $('#sx-hero').style.setProperty('--hc', a.color);
    setText($('#sx-word'), has ? a.word : 'Reading the phone...');
    setText($('#sx-sub'), S.perfErr ? 'Could not read the phone: ' + S.perfErr : (a.sug[0].sev === 'ok' ? a.sug[0].text : a.sug[0].title + '.'));
    const pills = [], pr = S.profile, act = Object.values(S.active)[0], fc = SS.heatForecast();
    if (pr) pills.push(`<span class="sx-pill on">${icon(pr.icon || 'rocket', 'sm')}${esc(pr.name)}</span>`);
    if (act) pills.push(`<span class="sx-pill game">${icon('game', 'sm')}${esc(SS.nice(act.pkg))}</span>`);
    if (S.rec) pills.push('<span class="sx-pill rec"><i></i>Recording</span>');
    if (fc) pills.push(fc.state === 'rising' ? `<span class="sx-pill warn">${icon('up', 'sm')}${S.wd.heatLimit} °C in ~${SS.fmtMins(fc.mins)}</span>` : fc.state === 'falling' ? `<span class="sx-pill ok">${icon('down', 'sm')}Cooling ${Math.abs(fc.per).toFixed(1)} °C/min</span>` : fc.state === 'over' ? `<span class="sx-pill bad">${icon('alert', 'sm')}Over ${S.wd.heatLimit} °C</span>` : `<span class="sx-pill">${icon('temp', 'sm')}Temperature steady</span>`);
    setHtml($('#sx-pills'), pills.join(''));
    const tb = $('#turbo-btn'); if (tb) { const on = S.profile && S.profile.id === 'max'; const h = S.busy === 'max' ? `${icon('rocket')}<span>Boosting...</span>` : on ? `${icon('refresh')}<span>Turbo is on. Undo</span>` : `${icon('rocket')}<span>Turbo boost</span>`; setHtml(tb, h); tb.classList.toggle('is-on', !!on); tb.disabled = !!S.busy && S.busy !== 'max'; }
    $('#sx-hero').classList.toggle('launching', !!S.busy); $('#sx-hero').classList.toggle('cooling', !!(S.profile && S.profile.id === 'cool'));
    const cq = $('#cool-quick'); if (cq) { const on = S.profile && S.profile.id === 'cool'; setHtml(cq, `${icon(on ? 'refresh' : 'fan')}<span>${on ? 'Restore' : 'Cool down'}</span>`); cq.disabled = !!S.busy; }
    setHtml($('#st-sugs'), a.sug.map(x => `<div class="sx-sug ${x.sev}">${icon(x.sev === 'ok' ? 'check' : x.sev === 'info' ? 'info' : 'alert')}<div><b>${esc(x.title)}</b><span>${esc(x.text)}</span></div>${x.fix ? `<button class="sx-btn sm" data-fix="${x.fix}" type="button">${esc(x.label)}</button>` : ''}</div>`).join(''));
  }
  if ($('#sx-kpis')) {
    const sp = (k, o) => SX.spark(series(k), o);
    const dt = delta('phone', pt, ' °C', 1, 0.15);
    kpiSet('temp', { v: pt, dec: 1, unit: ' °C', level: SS.tempLevel(pt), pct: num(pt) ? (pt - 25) / 25 * 100 : 0, note: SS.tempWord(pt) + (SS.socTemp() != null ? ' · chip ' + SS.socTemp() + ' °C' : ''), spark: sp('phone', { color: 'var(--warn)', mark: S.wd.heatLimit }), delta: dt.t, dcls: dt.c });
    const dc = delta('cpu', p && p.cpuPct, '%', 0, 4);
    kpiSet('cpu', { v: p && p.cpuPct, unit: '%', level: SS.pctLevel(p && p.cpuPct, 60, 85), pct: p && p.cpuPct, note: p && p.thermalStatus >= 1 ? 'Throttling: ' + SS.THERMAL[p.thermalStatus] : p && p.cores && p.cores.length ? p.cores.length + ' cores · no throttling' : 'No throttling', spark: sp('cpu', { min: 0, max: 100, color: 'var(--focus)' }), delta: dc.t, dcls: dc.c });
    const dr = delta('ram', ram, '%', 0, 2);
    kpiSet('ram', { v: ram, unit: '%', level: SS.pctLevel(ram, 75, 88), pct: ram, note: p && p.memTotalKb ? gb(p.memAvailKb) + ' GB free of ' + gb(p.memTotalKb) : '', spark: sp('ram', { min: 0, max: 100, color: 'var(--ok)' }), delta: dr.t, dcls: dr.c });
    kpiSet('gpu', { hide: !(p && num(p.gpuPct)), v: p && p.gpuPct, unit: '%', level: SS.pctLevel(p && p.gpuPct, 70, 92), pct: p && p.gpuPct, note: p && p.gpuMhz ? p.gpuMhz + ' MHz' : '', spark: sp('gpu', { min: 0, max: 100, color: '#b794f6' }) });
    const eta = SS.batteryEta(), bl = l && l.battery >= 0 ? l.battery : null;
    kpiSet('bat', { v: bl, unit: '%', level: bl != null && bl <= 15 && !l.charging ? 'bad' : bl != null && bl <= 30 && !l.charging ? 'warn' : 'ok', pct: bl, note: l ? (l.charging ? 'Charging' : 'On battery') + (eta && eta.dir !== 'steady' ? ' · ' + SS.fmtMins(eta.mins) + (eta.dir === 'full' ? ' to full' : ' left') : '') : '', spark: sp('bat', { min: 0, max: 100, color: 'var(--ok)' }) });
    kpiSet('fps', { v: fps, unit: ' fps', level: fps == null ? '' : fps >= 55 ? 'ok' : fps >= 30 ? 'warn' : 'bad', pct: fps == null ? 0 : fps / 120 * 100, note: fps == null ? 'Shows when a game draws frames' : SS.targetPkg() ? SS.nice(SS.targetPkg()) : '', spark: sp('fps', { min: 0, max: 60, color: 'var(--accent)' }) });
    kpiSet('power', { hide: !(num(s.w)), v: s.w, dec: 1, unit: ' W', level: s.w >= 12 ? 'bad' : s.w >= 7 ? 'warn' : 'ok', pct: num(s.w) ? s.w / 15 * 100 : 0, note: p && p.battery && num(p.battery.currentMa) ? Math.abs(p.battery.currentMa) + ' mA · ' + (p.battery.voltage / 1000).toFixed(2) + ' V' + (l && l.charging ? ' · charging' : '') : '', spark: sp('w', { min: 0, color: 'var(--rec)' }) });
    const sPct = p && p.storageTotalKb ? Math.round(100 * (1 - p.storageFreeKb / p.storageTotalKb)) : null;
    kpiSet('storage', { v: sPct, unit: '%', level: SS.pctLevel(sPct, 85, 93), pct: sPct, note: p && p.storageTotalKb ? gb(p.storageFreeKb) + ' GB free' : '' });
  }
  if (tl.chart) tl.chart.draw();
  if (S.batChart) S.batChart.draw();
  if ($('#sx-passport')) paintPassport();
  if ($('#sx-cores')) paintCores();
  if ($('#sx-top')) paintTop();
  if ($('#sx-zones-mini')) setHtml($('#sx-zones-mini'), zonesHtml());
  if ($('#cool-big')) paintCool();
  if ($('#sx-batring')) paintBattery();
  if ($('#sx-rec-t') && S.rec) { setText($('#sx-rec-t'), STK.clock(S.rec.start)); setText($('#sx-rec-n'), String(S.rec.samples.length)); setHtml($('#sx-rec-spark'), SX.spark(S.rec.samples.map(x => x.phone), { color: 'var(--warn)' })); }
  paintEvents();
}
function paintLive() {
  const pl = $('#sx-pause'); if (!pl) return;
  const age = S.lastAt ? Date.now() - S.lastAt : null, stale = !S.paused && (age == null ? false : age > S.interval * 3 + 5000);
  pl.classList.toggle('stale', stale); pl.classList.toggle('paused', S.paused); pl.setAttribute('aria-pressed', S.paused);
  setText($('#sx-live-t'), S.paused ? 'Paused' : stale ? 'Waiting' : 'Live');
  setText($('#sx-live-a'), age == null ? '' : age < 2000 ? 'now' : Math.round(age / 1000) + ' s' + (S.lastLatency ? ' · ' + S.lastLatency + ' ms' : ''));
}
function paintPassport() {
  const i = STK.info() || {}, d = dev() || {}, p = S.perf, l = SS.L();
  const rows = [['Model', ((i.manufacturer ? i.manufacturer.charAt(0).toUpperCase() + i.manufacturer.slice(1) + ' ' : '') + (i.model || d.model || '')).trim()], ['Android', i.android ? i.android + (i.sdk ? ' (API ' + i.sdk + ')' : '') : ''], ['Security patch', i.patch], ['Chip type', i.abi], ['Screen', i.width ? i.width + ' x ' + i.height + (i.density ? ' · ' + i.density + ' dpi' : '') : ''], ['Memory', i.ramTotal ? (i.ramTotal / 1073741824).toFixed(1) + ' GB' : p && p.memTotalKb ? SS.gb(p.memTotalKb) + ' GB' : ''], ['Storage', i.storageTotal ? STK.bytes(i.storageTotal) + ' · ' + STK.bytes(i.storageFree) + ' free' : ''], ['Network address', i.ip], ['Running for', i.uptimeSec ? STK.dur(i.uptimeSec) : ''], ['Foreground app', l && l.fgPackage ? SS.nice(l.fgPackage) : '']].filter(r => r[1]);
  setHtml($('#sx-passport'), rows.length ? rows.map(r => `<div><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('') : '<p class="hint">Reading phone details...</p>');
}
function paintCores() {
  const el = $('#sx-cores'), p = S.perf, cores = p && p.cores ? p.cores.filter(c => c.pct != null) : [];
  if (!cores.length) { setHtml(el, `<p class="hint">${p ? 'This phone does not share per-core load.' : 'Reading the processor...'}</p>`); el.dataset.n = ''; }
  else {
    if (el.dataset.n !== String(cores.length)) { el.dataset.n = String(cores.length); el._h = null; el.innerHTML = cores.map(c => `<button type="button" class="sx-core" data-open="cpu" data-series="c${c.id}" data-c="${c.id}" aria-label="CPU ${c.id} history"><span class="sx-core-bar"><i></i></span><b></b><small>CPU${c.id}</small><em></em></button>`).join(''); }
    cores.forEach(c => { const b = $(`[data-c="${c.id}"]`, el); if (!b) return; $('i', b).style.height = Math.max(3, c.pct) + '%'; lv(b, SS.pctLevel(c.pct, 60, 85)); setText($('b', b), c.pct + '%'); setText($('em', b), c.mhz ? SX.f.mhz(c.mhz) : ''); });
  }
  const gl = $('#sx-gpu-line'); if (gl) setText(gl, p && num(p.gpuPct) ? 'Graphics ' + p.gpuPct + '%' + (p.gpuMhz ? ' · ' + p.gpuMhz + ' MHz' : '') : p ? 'Graphics load is not shared by this phone.' : '');
}
function paintTop() {
  const t = S.top && S.top.top ? S.top.top : null, el = $('#sx-top');
  if (!S.top) return setHtml(el, '<div class="sx-skel"><i></i><i></i><i></i></div>');
  if (!t || !t.length) return setHtml(el, '<p class="hint">This phone did not list busy apps. Some phones hide the process list from adb.</p>');
  setHtml(el, t.map(a => `<div class="sx-bar"><span class="bn">${esc(SS.nice(a.name))}<small>${esc(a.name)}${a.res ? ' · ' + esc(a.res) : ''}</small></span><i><u style="width:${Math.min(100, a.cpu)}%"></u></i><b>${a.cpu.toFixed(0)}%</b>${/^[A-Za-z][\w]*(\.\w+)+$/.test(a.name) && !/systemui|launcher|^android$/.test(a.name) ? `<button class="sx-icon" data-stop="${esc(a.name)}" title="Force stop" type="button">${icon('stop', 'sm')}</button>` : '<span></span>'}</div>`).join(''));
}
function zonesHtml() {
  const z = S.perf && S.perf.zones && S.perf.zones.length ? S.perf.zones : null;
  if (!z) return '<p class="hint">This phone does not share detailed sensor temperatures.</p>';
  return z.map(x => `<button type="button" class="sx-zone ${SS.socLevel(x.c)}" data-open="zones" data-series="z:${esc(x.name)}"><small>${esc(x.name)}</small><b>${x.c} °C</b><i style="width:${SX.clamp((x.c - 20) / 70 * 100, 2, 100)}%"></i></button>`).join('');
}
function paintCool() {
  const pt = SS.phoneTemp(), p = S.perf, lvl = SS.tempLevel(pt);
  const g = $('#sx-tg'); if (g) SX.arcSet(g, num(pt) ? (pt - 20) / 35 * 100 : 0, lvl === 'bad' ? 'var(--bad)' : lvl === 'warn' ? 'var(--warn)' : 'var(--ok)');
  const big = $('#cool-big'); if (big) { SX.setNum(big, pt, { dec: 1, suf: ' °C' }); big.className = lvl; }
  setText($('#cool-word'), SS.tempWord(pt));
  const chip = $('#cool-chip'); if (chip) { chip.className = 'sx-chip ' + lvl; setText($('b', chip), SS.tempWord(pt)); }
  const fc = SS.heatForecast(), per = SS.tempTrend();
  setHtml($('#cool-side'), `<small>Trend</small><b>${per == null ? 'Collecting data...' : Math.abs(per) < 0.12 ? 'Steady' : (per > 0 ? 'Rising ' : 'Falling ') + Math.abs(per).toFixed(1) + ' °C per minute'}</b><small>Battery temperature</small><b>${num(SS.L() && SS.L().tempC) ? SS.L().tempC + ' °C' : '-'}</b><small>Warning limit</small><b>${S.wd.heatLimit} °C</b>`);
  setHtml($('#cool-trend'), SX.spark(series('phone', 70), { min: 28, max: 48, color: 'var(--warn)', mark: S.wd.heatLimit }));
  const set = (id, v, lc) => { const e = $(id); if (e) { setText($('b', e), v); lv(e, lc); } };
  set('#cool-soc', SS.socTemp() == null ? '-' : SS.socTemp() + ' °C', SS.socLevel(SS.socTemp()));
  set('#cool-thr', p && p.thermalStatus != null ? SS.THERMAL[p.thermalStatus] : '-', p && p.thermalStatus >= 2 ? 'bad' : p && p.thermalStatus === 1 ? 'warn' : '');
  set('#cool-bat', SS.L() && SS.L().battery >= 0 ? SS.L().battery + '%' + (SS.L().charging ? ' charging' : '') : '-', SS.L() && SS.L().charging && pt >= 39 ? 'warn' : '');
  set('#cool-fc', !fc ? '-' : fc.state === 'rising' ? S.wd.heatLimit + ' °C in ' + SS.fmtMins(fc.mins) : fc.state === 'falling' ? (fc.mins ? S.wd.coolTarget + ' °C in ' + SS.fmtMins(fc.mins) : 'Cool enough') : fc.state === 'over' ? 'Over the limit' : 'Steady', !fc ? '' : fc.state === 'rising' ? 'warn' : fc.state === 'over' ? 'bad' : fc.state === 'falling' ? 'ok' : '');
  setHtml($('#cool-zones'), zonesHtml());
  const hot = pt != null && pt >= 41, ch = SS.L() && SS.L().charging, pri = [];
  if (ch && pt >= 38) pri.push('charge'); if (hot) pri.push('bright', 'fps', 'case');
  $$('.sx-tech').forEach(t => { const k = t.dataset.tech, on = pri.includes(k); t.classList.toggle('hot', on); const e = $('.sx-sugg', t); if (e) e.hidden = !on; });
}
function paintBattery() {
  const l = SS.L(), p = S.perf, b = p && p.battery || {}, lvlv = l && l.battery >= 0 ? l.battery : b.level, chg = l && l.charging;
  const col = lvlv == null ? 'var(--ink-3)' : lvlv <= 15 && !chg ? 'var(--bad)' : lvlv <= 30 && !chg ? 'var(--warn)' : 'var(--ok)';
  const br = $('#sx-batring'); if (br) { br.classList.toggle('chg', !!chg); if (!$('.sx-ring', br)) { br.innerHTML = SX.ring(0, col, '-', 'battery'); } const fg = $('.sx-ring-fg', br); fg.style.strokeDasharray = ((lvlv || 0) / 100 * 326.7).toFixed(1) + ' 326.7'; fg.style.stroke = col; setText($('.sx-ring-n', br), lvlv == null ? '-' : lvlv + '%'); }
  const eta = SS.batteryEta(); setText($('#bat-status'), !l ? '-' : chg ? 'Charging' + (l.power ? ' (' + l.power + ')' : '') : l.full ? 'Full' : 'On battery');
  setText($('#bat-eta'), eta && eta.dir === 'full' ? SS.fmtMins(eta.mins) + ' to full' : eta && eta.dir === 'empty' ? 'About ' + SS.fmtMins(eta.mins) + ' left at this rate' : 'Measuring the rate... keep Studio open for a few minutes.');
  const s = S.sample || {}, cap = b.chargeCounterUah && lvlv ? Math.round(b.chargeCounterUah / 1000 / (lvlv / 100)) : null;
  const rows = [['Power', num(s.w) ? s.w.toFixed(1) + ' W' : ''], ['Current', num(b.currentMa) ? Math.abs(b.currentMa) + ' mA' : ''], ['Voltage', b.voltage ? (b.voltage / 1000).toFixed(2) + ' V' : ''], ['Temperature', l && num(l.tempC) ? l.tempC + ' °C' : ''], ['Health', b.health], ['Technology', b.tech], ['Estimated capacity', cap ? cap + ' mAh' : ''], ['Charge state', b.status]].filter(r => r[1]);
  setHtml($('#bat-kv'), rows.map(r => `<div><span>${r[0]}</span><b>${esc(r[1])}</b></div>`).join(''));
}
function paintSteps() {
  const ul = $('#sx-steps'), pr = $('#sx-prog'); if (!ul) return;
  const show = S.busy && S.steps.length;
  if (pr) { pr.hidden = !show; const bar = $('i', pr); if (bar) bar.style.width = S.stepPct + '%'; }
  if (!S.steps.length) return setHtml(ul, S.profile && S.profile.total ? '' : '');
  setHtml(ul, S.steps.map(x => `<li class="${x.st}"><span class="sx-sti">${x.st === 'run' ? '<i class="sx-spin"></i>' : x.st === 'ok' ? icon('check', 'sm') : x.st === 'skip' ? icon('info', 'sm') : '<i class="sx-dotw"></i>'}</span><span><b>${esc(x.label)}</b>${x.note ? '<small>' + esc(x.note) + '</small>' : ''}</span></li>`).join(''));
}
function paintEvents() {
  const el = $('#sx-events'); if (!el) return;
  setHtml(el, S.events.length ? S.events.slice(0, 8).map(e => `<div class="sx-ev ${e.level}">${icon(e.level === 'bad' ? 'alert' : e.level === 'ok' ? 'check' : 'info', 'sm')}<span>${esc(e.text)}</span><time>${esc(ago(e.t))}</time></div>`).join('') : '<p class="hint">Alerts, profiles and game sessions are listed here as they happen.</p>');
}
SS.render = render; SS.paint = paint; SS.paintSteps = paintSteps; SS.paintEvents = paintEvents;

/* ---------- storage and session windows ---------- */
function openStorage() {
  const p = S.perf, i = STK.info() || {};
  const tot = p && p.storageTotalKb ? p.storageTotalKb * 1024 : i.storageTotal, free = p && p.storageTotalKb ? p.storageFreeKb * 1024 : i.storageFree;
  if (!tot) return STK.toast('Storage details are not available yet.', 'bad');
  const pct = Math.round(100 * (1 - free / tot));
  const m = SX.modal(`<div class="sx-cm-head"><div><h3>Storage</h3><p class="hint">Space on the phone data partition.</p></div><span class="grow"></span><button class="sx-btn sm" type="button" data-x data-autofocus>${icon('x', 'sm')}<span>Close</span></button></div>
    <div class="sx-store"><div class="sx-store-ring">${SX.ring(pct, pct >= 93 ? 'var(--bad)' : pct >= 85 ? 'var(--warn)' : 'var(--ok)', pct + '%', 'used')}</div><div class="sx-kv"><div><span>Total</span><b>${STK.bytes(tot)}</b></div><div><span>Used</span><b>${STK.bytes(tot - free)}</b></div><div><span>Free</span><b>${STK.bytes(free)}</b></div></div></div>
    <p class="hint">Below about 8% free, loading slows down and games can crash. Clearing app caches is safe: apps rebuild them as needed.</p>
    <div class="sx-hero-row"><button class="sx-btn primary" type="button" data-clean>${icon('trash', 'sm')}<span>Clear app caches</span></button><button class="sx-btn" type="button" data-lib>${icon('library', 'sm')}<span>Open phone files</span></button></div>`, { cls: 'sx-small', label: 'Storage' });
  m.el.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.x !== undefined) return m.close();
    if (b.dataset.clean !== undefined) { await SS.cleanCaches(b); return; }
    if (b.dataset.lib !== undefined) { m.close(); STK.go('phone'); setTimeout(() => { const t = $('[data-ptab="files"]'); if (t) t.click(); }, 0); }
  });
}
SS.openSession = function (i) {
  const ses = STK.kv.get('gamesessions', []) || [], idx = i < 0 ? ses.length - 1 : i, s = ses[idx]; if (!s) return;
  const smp = (s.samples || []).map(x => ({ ...x })), t0 = smp.length ? smp[0].t : s.start, t1 = smp.length ? smp[smp.length - 1].t : s.start + s.secs * 1000;
  const M = { phone: ['Temperature', SX.f.c1, null, null, '°C'], cpu: ['Processor', SX.f.pct, 0, 100, '%'], fps: ['Frame rate', SX.f.fps, 0, null, 'fps'], ram: ['Memory', SX.f.pct, 0, 100, '%'], bat: ['Battery', SX.f.pct, 0, 100, '%'] };
  const stat = (k) => SX.stats(smp.map(x => x[k]));
  const tiles = [['Length', STK.dur(s.secs), ''], ['Peak temperature', s.peak != null ? s.peak + ' °C' : '-', SS.tempLevel(s.peak)], ['Average temperature', s.avg != null ? s.avg + ' °C' : '-', ''], ['Average frame rate', s.fps ? s.fps + ' fps' : '-', ''], ['Lowest frame rate', s.minFps ? s.minFps + ' fps' : '-', s.minFps && s.minFps < 30 ? 'warn' : ''], ['Battery', s.batStart != null && s.batEnd != null ? s.batStart + '% to ' + s.batEnd + '%' : '-', '']];
  let cur = smp.some(x => num(x.fps)) ? 'fps' : 'phone', ch = null;
  const m = SX.modal(`<div class="sx-cm-head"><div><h3>${esc(s.name)}${s.manual ? ' <em class="sx-em">recorded</em>' : ''}</h3><p class="hint">${esc(new Date(s.start).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' }))}</p></div><span class="grow"></span><button class="sx-btn sm" type="button" data-csv>${icon('download', 'sm')}<span>CSV</span></button><button class="sx-btn sm rec" type="button" data-del>${icon('trash', 'sm')}<span>Delete</span></button><button class="sx-btn sm" type="button" data-x data-autofocus>${icon('x', 'sm')}<span>Close</span></button></div>
    <div class="sx-stats6">${tiles.map(([l, v, c]) => `<div class="${c}"><small>${l}</small><b>${esc(v)}</b></div>`).join('')}</div>
    <div class="sx-seg" id="ses-m">${Object.keys(M).filter(k => smp.some(x => num(x[k]))).map(k => `<button type="button" data-m="${k}" class="${k === cur ? 'is-active' : ''}">${M[k][0]}</button>`).join('')}</div>
    <div id="ses-host" class="sx-cm-plot"></div><div class="sx-statt" id="ses-stats"></div><p class="hint sx-cm-note">Drag across the graph to zoom, double-click to reset.</p>`, { cls: 'sx-chartwin', label: 'Session ' + s.name });
  const draw = () => {
    if (ch) ch.destroy(); const k = cur, d = M[k];
    ch = new SX.Chart($('#ses-host', m.el), { title: d[0], series: [{ k, name: d[0], color: k === 'fps' ? 'var(--accent)' : k === 'phone' ? 'var(--warn)' : 'var(--focus)' }], fmt: d[1], lo: d[2], hi: d[3], fixedRange: [t0 - 1000, t1 + 1000], rangeOf: () => smp, thresholds: k === 'phone' ? [{ v: S.wd.heatLimit, label: 'Warning limit', cls: 'bad' }] : k === 'fps' ? [{ v: 60, label: '60 fps', cls: 'ok' }, { v: 30, label: '30', cls: 'bad' }] : [] });
    ch.draw(); const st = stat(k); $('#ses-stats', m.el).innerHTML = st ? `<table><thead><tr><th></th><th>Lowest</th><th>Average</th><th>95th</th><th>Highest</th></tr></thead><tbody><tr><th>${d[0]}</th><td>${esc(d[1](st.min))}</td><td>${esc(d[1](st.avg))}</td><td>${esc(d[1](st.p95))}</td><td>${esc(d[1](st.max))}</td></tr></tbody></table>` : '';
  };
  m.el.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.x !== undefined) { if (ch) ch.destroy(); return m.close(); }
    if (b.dataset.m) { cur = b.dataset.m; $$('#ses-m button', m.el).forEach(x => x.classList.toggle('is-active', x === b)); return draw(); }
    if (b.dataset.csv !== undefined) { SX.download('droid-adb-session-' + new Date(s.start).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.csv', SX.csv(smp, [['t', 'time', r => new Date(r.t).toISOString()], ['phone', 'phone_temp_c'], ['cpu', 'cpu_pct'], ['ram', 'memory_pct'], ['fps', 'fps'], ['bat', 'battery_pct']])); return STK.toast('Session saved as CSV.'); }
    if (b.dataset.del !== undefined) { if (!await STK.confirm('Delete this session?', '<p>The session and its graph will be removed from history.</p>', 'Delete', true)) return; const list = (STK.kv.get('gamesessions', []) || []).slice(); list.splice(idx, 1); STK.kv.set('gamesessions', list); if (ch) ch.destroy(); m.close(true); render(); }
  });
  draw();
};

/* ---------- events ---------- */
function setTab(k) {
  if (!TABS.some(t => t[0] === k) || k === S.tab) return;
  S.tab = k; store.set('studio-tab', k); enterNext = true; render();
  if (k === 'optimize' && !S.toggles) SS.loadToggles(); if (k === 'capture') SS.loadDemo(); if (k === 'battery') SS.loadBattApps(); if (k === 'perf') { SS.loadTop(); }
  SS.pollPerf(true);
}
const need = fn => () => STK.sel() ? fn() : STK.toast('Connect a phone first.', 'bad');
document.addEventListener('click', async e => {
  const t = e.target.closest('#studio-root button, #studio-root [data-open], #studio-root [role="button"]'); if (!t || !$('#studio-root').contains(t)) return;
  if (t.dataset.sttab) return setTab(t.dataset.sttab);
  if (t.dataset.pdel) { e.stopPropagation(); return SS.deleteCustom(t.dataset.pdel); }
  if (e.target.closest('[data-pdel]')) { e.stopPropagation(); return SS.deleteCustom(e.target.closest('[data-pdel]').dataset.pdel); }
  if (t.dataset.open) { const k = t.dataset.open; if (k === 'storage') return openStorage(); if (k === 'tl') return SS.openMetric(tl.metric); return SS.openMetric(k, t.dataset.series); }
  if (t.dataset.tlm) { tl.metric = t.dataset.tlm; store.set('sx-tlm', tl.metric); $$('#sx-tlm button').forEach(b => b.classList.toggle('is-active', b === t)); if (tl.chart) tl.chart.destroy(); tl.chart = new SX.Chart($('#sx-tl'), SS.metricSpec(tl.metric, { inline: true, period: tl.per })); tl.chart.draw(); return; }
  if (t.dataset.tlp) { tl.per = t.dataset.tlp; store.set('sx-tlp', tl.per); $$('#sx-tlp button').forEach(b => b.classList.toggle('is-active', b === t)); if (tl.chart) tl.chart.setPeriod(tl.per); return; }
  if (t.dataset.batm) { S.batm = t.dataset.batm; $$('[data-batm]').forEach(b => b.classList.toggle('is-active', b === t)); if (S.batChart) S.batChart.destroy(); S.batChart = new SX.Chart($('#sx-bt'), SS.metricSpec(S.batm, { inline: true, period: '1h' })); S.batChart.draw(); return; }
  if (t.dataset.fix) return fix(t.dataset.fix, t);
  if (t.dataset.prof) { const id = t.dataset.prof; return S.profile && S.profile.id === id ? SS.revertProfile() : SS.applyProfile(id); }
  if (t.dataset.tried) { const k = t.dataset.tried, l = store.get('sx-tried', []), on = !l.includes(k); store.set('sx-tried', on ? l.concat(k) : l.filter(x => x !== k)); t.classList.toggle('on', on); t.setAttribute('aria-pressed', on); return; }
  if (t.dataset.stop) { const pkg = t.dataset.stop; if (!await STK.confirm('Force stop ' + SS.nice(pkg) + '?', '<p>The app closes immediately and unsaved work in it may be lost.</p>', 'Force stop', true)) return; return STK.busy(t, async () => { try { await STK.post('/app', { serial: STK.sel(), action: 'stop', package: pkg }); STK.toast(SS.nice(pkg) + ' was stopped.'); SS.logEvent('tool', 'Force stopped ' + SS.nice(pkg) + '.', 'info'); S.topAt = 0; SS.loadTop(); } catch (er) { STK.fail(er); } }); }
  if (t.dataset.sess) return SS.openSession(Number(t.dataset.sess));
  switch (t.id) {
    case 'sx-pause': return SS.setPaused(!S.paused);
    case 'sx-more': return STK.menu(t, [{ label: 'Download 24 hour history (CSV)', icon: 'download', run: SS.exportCsv }, { label: 'Open the Monitor page', icon: 'chart', run: () => STK.go('monitor') }, '-', { label: 'Clear Studio history', icon: 'trash', danger: true, run: SS.clearHistory }]);
    case 'turbo-btn': return S.profile && S.profile.id === 'max' ? SS.revertProfile() : SS.applyProfile('max');
    case 'cool-quick': case 'cool-btn': return S.profile && S.profile.id === 'cool' ? SS.revertProfile() : SS.applyProfile('cool');
    case 'sx-undo': return SS.revertProfile();
    case 'prof-save': return SS.saveCustom();
    case 'play-btn': { const pkg = S.pkg; if (!pkg) return STK.toast('Pick a target game first.', 'bad'); return STK.busy(t, async () => { try { if (!S.profile || S.profile.id !== 'max') await SS.applyProfile('max'); await SS.gt({ action: 'launch', pkg }); STK.toast('Have a great game!'); } catch (er) { STK.fail(er); } }); }
    case 'net-run': return SS.netRun();
    case 'gt-stats': return STK.busy(t, () => SS.readStats());
    case 'gt-stats-reset': { const pkg = SS.targetPkg(); if (!pkg) return STK.toast('Open the game on the phone, or pick one from the list.', 'bad'); const r = await SS.tool(t, { action: 'resetstats', pkg }); if (r) { S.stats = null; render(); } return; }
    case 'gt-freemem': return SS.freeMemory(t);
    case 'gt-trim': return SS.cleanCaches(t);
    case 'gt-perf-on': return SS.tool(t, { action: 'perfmode', on: true });
    case 'gt-perf-off': return SS.tool(t, { action: 'perfmode', on: false });
    case 'gt-refresh-on': return SS.tool(t, { action: 'refresh', on: true });
    case 'gt-refresh-off': return SS.tool(t, { action: 'refresh', on: false });
    case 'gt-lp-off': return SS.tool(t, { action: 'setstate', lowPower: 0 }).then(() => SS.pollPerf(true));
    case 'gt-gm': { const pkg = SS.targetPkg(); if (!pkg) return STK.toast('Open the game on the phone, or pick one from the list.', 'bad'); return SS.tool(t, { action: 'gamemode', pkg, mode: 'performance' }); }
    case 'sx-rec': return S.rec ? (SS.stopRec(), undefined) : SS.startRec();
    case 'sx-top-reload': S.topAt = 0; return SS.loadTop();
    case 'bat-reload': return SS.loadBattApps(true);
    case 'sx-ev-clear': S.events = []; store.set('sx-events', []); return paintEvents();
    case 'sess-csv': { const ses = STK.kv.get('gamesessions', []) || []; return SX.download('droid-adb-sessions.csv', SX.csv(ses, [['start', 'start', r => new Date(r.start).toISOString()], ['name', 'name'], ['secs', 'seconds'], ['peak', 'peak_temp_c'], ['avg', 'avg_temp_c'], ['fps', 'avg_fps'], ['minFps', 'min_fps'], ['batStart', 'battery_start'], ['batEnd', 'battery_end']])); }
    case 'game-add': return SS.editGame(-1);
    case 'demo-toggle': return toggleDemo(t);
    case 'demo-present': STK.go('console'); return setTimeout(() => { const h = $('#hero'); if (h && h.dataset.size !== 'l') $('#frame-size').click(); }, 120);
    case 'cap-rec': return STK.actions.record().then(() => setTimeout(render, 400));
    case 'cap-mir': return STK.actions.mirror().then(() => setTimeout(render, 400));
    case 'cap-shot': return STK.actions.screenshot();
    case 'cap-gif': return STK.gifCapture && STK.gifCapture();
  }
  if (t.dataset.gedit) return SS.editGame(Number(t.dataset.gedit));
  if (t.dataset.gdel) { const list = SS.games().slice(); list.splice(Number(t.dataset.gdel), 1); STK.kv.set('games', list); return render(); }
  if (t.dataset.gplay) { const g = SS.games()[Number(t.dataset.gplay)]; if (!g) return; S.pkg = g.pkg; return STK.busy(t, async () => { try { await SS.gt({ action: 'launch', pkg: g.pkg }); STK.toast('Opening ' + (g.name || SS.nice(g.pkg)) + '...'); } catch (er) { STK.fail(er); } }); }
  if (t.dataset.kit) {
    const key = t.dataset.kit; if (!STK.sel() || !S.toggles) return;
    const cur = key === 'animations' ? S.toggles[key] !== false : !!S.toggles[key], next = !cur;
    t.classList.toggle('on', next); t.setAttribute('aria-pressed', next); S.toggles[key] = next;
    return STK.busy(t, async () => { try { const r = await SS.tog(key, next); if (r && r.toggles) { S.toggles = r.toggles; S.ext = { ...S.ext, brightness: r.brightness, timeout: r.timeout, volume: r.volume, volumeMax: r.volumeMax }; } STK.flash(t, true); } catch (er) { S.toggles[key] = cur; t.classList.toggle('on', cur); t.setAttribute('aria-pressed', cur); STK.fail(er); } });
  }
  if (t.dataset.spreset) { const p = state.schema.presets.find(x => x.id === t.dataset.spreset); return STK.busy(t, async () => { try { await STK.post('/settings', { patch: p.v }); await STK.loadSettings(); STK.toast(p.name + ' preset applied.'); render(); } catch (er) { STK.fail(er); } }); }
});
async function fix(kind, btn) {
  if (!STK.sel()) return;
  if (kind === 'freemem') return SS.freeMemory(btn);
  if (kind === 'dnd' || kind === 'anim') return STK.busy(btn, async () => { try { await SS.tog(kind === 'dnd' ? 'dnd' : 'animations', kind === 'dnd'); await SS.loadToggles(); } catch (e) { STK.fail(e); } });
  if (kind === 'lowpower') return SS.tool(btn, { action: 'setstate', lowPower: 0 }).then(() => SS.pollPerf(true));
  if (kind === 'cool') return SS.applyProfile('cool');
  if (kind === 'net') { setTab('perf'); return SS.netRun(); }
  if (kind === 'perf') return setTab('perf');
  if (kind === 'storage') return openStorage();
  if (kind === 'preset') { const ps = (state.schema && state.schema.presets) || [], p = ps.find(x => x.id === 'latency') || ps[0]; if (!p) return; return STK.busy(btn, async () => { try { await STK.post('/settings', { patch: p.v }); await STK.loadSettings(); STK.toast(p.name + ' preset applied.'); } catch (e) { STK.fail(e); } }); }
}
async function toggleDemo(btn) {
  const id = STK.sel(); if (!id) return;
  const clock = ($('#demo-clock').value.replace(':', '').replace(/\D/g, '') + '1200').slice(0, 4).padStart(4, '0');
  const o = { clock, battery: Math.max(1, Math.min(100, Number($('#demo-batt').value) || 100)), hideNotifications: $('#demo-hide').checked, dnd: $('#demo-dnd').checked, touches: $('#demo-touch').checked };
  store.set('demo-opts', o);
  await STK.busy(btn, async () => { try { const r = await STK.post('/demo', { serial: id, on: !S.demo, ...o }, { timeout: 60000 }); S.demo = r.on; STK.toast(r.message); render(); } catch (e) { STK.fail(e); } });
}
document.addEventListener('keydown', e => {
  const t = e.target.closest && e.target.closest('#studio-root [data-open]');
  if (t && (e.key === 'Enter' || e.key === ' ') && t.tagName !== 'BUTTON') { e.preventDefault(); t.click(); }
  if (state.view !== 'studio' || e.ctrlKey || e.metaKey || e.altKey || SX.isModalOpen() || document.querySelector('dialog[open]')) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName || '')) return;
  const i = TABS.findIndex(x => x[0] === S.tab);
  if (e.key === ']') setTab(TABS[(i + 1) % TABS.length][0]); else if (e.key === '[') setTab(TABS[(i + TABS.length - 1) % TABS.length][0]); else if (e.key.toLowerCase() === 'p') SS.setPaused(!S.paused);
});
document.addEventListener('change', async e => {
  const el = e.target; if (!el.closest || !el.closest('#studio-root')) return;
  if (el.id === 'st-pkg') { S.pkg = el.value; S.stats = null; S.lastFrames = null; const h = SS.hist(); if (h) h.a.forEach(x => { x.fps = null; }); render(); SS.pollPerf(true); return; }
  if (el.id === 'sx-int') return SS.setInterval(Number(el.value));
  if (el.id === 'sx-stats-auto') { S.statsAuto = el.checked; if (el.checked) SS.readStats(true); return; }
  if (el.id === 'heat-limit') { const v = SX.clamp(Number(el.value) || 43, 36, 55); S.wd.heatLimit = v; SS.saveWd(); el.value = v; return paint(); }
  if (el.id === 'cool-target') { const v = SX.clamp(Number(el.value) || 38, 30, 45); S.wd.coolTarget = v; SS.saveWd(); el.value = v; return; }
  if (el.dataset.wd) { S.wd[el.dataset.wd] = el.checked; SS.saveWd(); return STK.toast((el.checked ? 'Alert on: ' : 'Alert off: ') + el.closest('.sx-wd').querySelector('b').textContent + '.'); }
  if (el.dataset.wdn) { const lim = { heatLimit: [36, 55], lowLimit: [5, 50], ramLimit: [70, 99], fpsLimit: [10, 90] }[el.dataset.wdn], v = SX.clamp(Number(el.value) || lim[0], lim[0], lim[1]); S.wd[el.dataset.wdn] = v; el.value = v; SS.saveWd(); return paint(); }
  if (el.dataset.slider) {
    const k = el.dataset.slider, v = Number(el.value);
    try { const r = await SS.tog(k, v); if (r) { S.ext = { ...S.ext, brightness: r.brightness, timeout: r.timeout, volume: r.volume, volumeMax: r.volumeMax }; } STK.toast(k === 'brightness' ? 'Brightness set.' : k === 'volume' ? 'Volume set.' : 'Screen timeout set.'); } catch (er) { STK.fail(er); }
    return;
  }
  if (el.dataset.gon !== undefined) { const list = SS.games().slice(); list[Number(el.dataset.gon)] = { ...list[Number(el.dataset.gon)], on: el.checked }; STK.kv.set('games', list); }
});
document.addEventListener('input', e => {
  const el = e.target; if (!el.dataset || !el.dataset.slider) return;
  if (el.dataset.slider === 'brightness') setText($('#sl-br-v'), Math.round(el.value / 2.55) + '%'); else if (el.dataset.slider === 'volume') setText($('#sl-vol-v'), el.value + '/' + el.max);
});

/* ---------- life cycle ---------- */
let ageTimer = null;
STK.views.studio = { onShow() { enterNext = true; render(); STK.loadSchema().then(() => { if (state.view === 'studio') render(); }).catch(() => {}); SS.loadToggles(); if (S.tab === 'capture') SS.loadDemo(); if (S.tab === 'battery') SS.loadBattApps(); SS.startPerf(); clearInterval(ageTimer); ageTimer = setInterval(() => { if (state.view === 'studio') { paintLive(); paintEvents(); if (S.rec) paint(); } }, 1000); } };
STK.on('view', name => { if (name !== 'studio') { SS.stopPerf(); clearInterval(ageTimer); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view === 'studio') SS.pollPerf(true); });
STK.on('kv', () => { if (state.view === 'studio' && ['games', 'overview', 'optimize'].includes(S.tab) && !SX.isModalOpen()) { if (!document.activeElement || !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) render(); } });
STK.on('state', () => { if (state.view === 'studio' && S.tab === 'capture' && !SX.isModalOpen()) { const rec = !!STK.recording(), mir = !!STK.mirroring(), a = $('#cap-rec'), b = $('#cap-mir'); if (a && a.getAttribute('aria-pressed') !== String(rec)) render(); else if (b && b.getAttribute('aria-pressed') !== String(mir)) render(); } });
window.addEventListener('resize', STK.debounce(moveInd, 100));

/* command palette and shortcuts help */
STK.studio = { turbo: need(() => S.profile && S.profile.id === 'max' ? SS.revertProfile() : SS.applyProfile('max')), cool: need(() => S.profile && S.profile.id === 'cool' ? SS.revertProfile() : SS.applyProfile('cool')), tab: k => { STK.go('studio'); setTimeout(() => setTab(k), 0); }, export: SS.exportCsv, freeMemory: need(() => SS.freeMemory()), pause: () => SS.setPaused(!S.paused) };
const help = $('#dlg-help .keylist'); if (help) help.insertAdjacentHTML('beforeend', '<div><dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Studio: previous or next section</dd></div><div><dt><kbd>P</kbd></dt><dd>Studio: pause or resume live updates</dd></div>');
})();
