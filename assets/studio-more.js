/* DROID ADB 4.0 Studio: Thermals (temperatures, cooling guide, cool-down tracker), Network (ping and Wi-Fi) and Capture (demo mode, presets). */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const SX = STK.studio, S = SX.S;
const nice = p => (STK.niceApp ? STK.niceApp(p) : p);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Thermals ---------- */
/* Minutes until the hot limit at the current rate of heating, or 0 when it is not heating up. */
SX.heatEta = function () {
  const h = SX.hist(), r = SX.last(); if (!h || !r || r.tempC == null) return 0;
  const pts = []; for (let i = Math.max(0, h.t.length - 12); i < h.t.length; i++) if (h.temp[i] != null && h.t[i]) pts.push([h.t[i] / 60000, h.temp[i]]);
  if (pts.length < 5) return 0;
  const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  let nu = 0, de = 0; pts.forEach(p => { nu += (p[0] - mx) * (p[1] - my); de += (p[0] - mx) ** 2; });
  const slope = de ? nu / de : 0;
  const hot = SX.opts().hot;
  if (slope < .15 || r.tempC >= hot) return 0;
  const m = Math.round((hot - r.tempC) / slope);
  return m > 0 && m < 120 ? m : 0;
};
const tword = t => t == null ? 'Unknown' : t < SX.opts().cool ? 'Cool' : t < SX.opts().hot - 4 ? 'Comfortable' : t < SX.opts().hot ? 'Warm' : t < SX.opts().hot + 4 ? 'Hot' : 'Very hot';

function gaugeHtml() {
  const r = SX.last(); if (!r) return '<p class="hint">Reading the phone...</p>';
  const t = r.tempC, tone = SX.tone('temp', t), eta = SX.heatEta();
  const zone = (l, v, ic, k) => `<div class="sx-zone xp-click ${SX.tone('temp', v)}" data-xp="temp" data-series="${k}" role="button" tabindex="0" aria-label="Open the ${l} graph">${icon(ic, 'sm')}<span>${l}</span><b>${v == null ? '--' : v.toFixed(1) + ' °C'}</b>${SX.meter(v == null ? 0 : (v - 20) / 35 * 100, SX.tone('temp', v))}</div>`;
  return `<div class="sx-gauge"><div class="ringbox">${SX.ring(t == null ? 0 : (t - 20) / 35 * 100, { tone, stroke: 8 })}<div class="mid"><b>${t == null ? '--' : t.toFixed(1)}<em>°C</em></b><small>${esc(tword(t))}</small></div></div>
    <div class="why ${tone}">${r.thermalStatus >= 1 ? icon('alert', 'sm') + esc(SX.thermalWord(r.thermalStatus)) + '. Android is limiting speed.' : eta ? icon('thermo', 'sm') + 'Heating up. Hot in about ' + eta + ' min at this rate.' : t != null && t >= SX.opts().hot ? icon('alert', 'sm') + 'Too hot for steady performance.' : icon('check', 'sm') + 'Temperature is under control.'}</div></div>
    <div class="sx-zones">${zone('Processor', r.tempC, 'cpu', 'temp')}${zone('Graphics', r.gpuC, 'bolt', 'gpuT')}${zone('Case surface', r.skinC, 'phone', 'skin')}${zone('Battery', r.batteryC, 'battery', 'bt')}</div>`;
}

function plotHtml(el) {
  const id = STK.sel(), h = SX.hist(id); if (!h || h.temp.filter(x => x != null).length < 2) return '<div class="sx-plot-empty">Collecting temperature data. Keep this page open and the history draws itself.</div>';
  const W = Math.max(320, el.clientWidth || 640), Ht = 230, L = 38, R = 12, T = 12, B = 24, pw = W - L - R, ph = Ht - T - B, o = SX.opts();
  const series = [['temp', 'Processor', 'a'], ['gpuC', 'Graphics', 'c'], ['batC', 'Battery', 'b']];
  const vals = []; series.forEach(s => h[s[0]].forEach(v => { if (v != null) vals.push(v); }));
  let lo = Math.min(28, Math.floor(Math.min(...vals) - 2)), hi = Math.max(o.hot + 5, Math.ceil(Math.max(...vals) + 2));
  const n = h.temp.length, X = i => L + i / Math.max(1, N_MAX - 1) * pw, Y = v => T + ph - (clamp(v, lo, hi) - lo) / (hi - lo) * ph;
  const off = N_MAX - n; // draw from the right edge so new samples slide in
  const band = (a, b, c) => { const ya = Y(Math.min(hi, b)), yb = Y(Math.max(lo, a)); return yb > ya ? `<rect class="band ${c}" x="${L}" y="${ya.toFixed(1)}" width="${pw}" height="${(yb - ya).toFixed(1)}"/>` : ''; };
  let g = band(lo, o.cool, 'cool') + band(o.cool, o.hot - 4, 'ok') + band(o.hot - 4, o.hot, 'warn') + band(o.hot, hi, 'bad');
  for (let v = Math.ceil(lo / 5) * 5; v <= hi; v += 5) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${v}°</text>`;
  g += `<line class="lim" x1="${L}" x2="${W - R}" y1="${Y(o.hot).toFixed(1)}" y2="${Y(o.hot).toFixed(1)}"/><text class="limt" x="${W - R - 4}" y="${(Y(o.hot) - 5).toFixed(1)}" text-anchor="end">Warning ${o.hot}°</text>`;
  const secs = (h.t[n - 1] - h.t[0]) / 1000;
  g += `<text x="${L}" y="${Ht - 6}">${secs > 90 ? '-' + Math.round(secs / 60) + ' min' : '-' + Math.round(secs) + ' s'}</text><text x="${W - R}" y="${Ht - 6}" text-anchor="end">now</text>`;
  let lines = '';
  series.forEach(([k, name, c]) => {
    let d = ''; h[k].forEach((v, i) => { if (v == null) return; d += (d ? 'L' : 'M') + X(i + off).toFixed(1) + ' ' + Y(v).toFixed(1); });
    if (d) lines += `<path class="ln ${c}" d="${d}"/>`;
  });
  return `<svg class="sx-plot" viewBox="0 0 ${W} ${Ht}" width="${W}" height="${Ht}" role="img" aria-label="Temperature history">${g}${lines}</svg><div class="sx-legend"><span class="a"><i></i>Processor</span><span class="c"><i></i>Graphics</span><span class="b"><i></i>Battery</span></div>`;
}
const N_MAX = 90;

function coolHtml() { return SX.coolAssistant(); }

const TECH = [
  { ic: 'phone', t: 'Take the case off', d: 'A thick case traps heat. Removing it can lower surface temperature by several degrees.' },
  { ic: 'bolt', t: 'Do not charge while you play', d: 'Charging and gaming together are the two biggest heat sources. Unplug, or charge slowly.', flag: r => r && r.charging },
  { ic: 'sun-moon', t: 'Lower the brightness', d: 'The screen is the largest heat source after the processor.', act: ['Dim the screen', 'bright:110'] },
  { ic: 'gauge', t: 'Lock 60 Hz', d: 'High refresh rates make the processor and screen work harder. 60 Hz is much cooler.', act: ['Lock 60 Hz', 'hz:60'] },
  { ic: 'battery', t: 'Use Battery saver', d: 'Limits background work and processor speed. A good choice for slower games.', act: ['Cool profile', 'profile:cool'] },
  { ic: 'rocket', t: 'Close background apps', d: 'Apps running in the background keep the processor busy for no reason.', act: ['Boost memory', 'boost'] },
  { ic: 'fan', t: 'Add airflow', d: 'A clip-on phone cooler or even a small desk fan lowers temperature quickly. Avoid direct sun and car dashboards.' },
  { ic: 'game', t: 'Lower in-game graphics', d: 'Medium graphics and a 30 or 60 fps cap inside the game use much less power than the maximum setting.' }
];
function techHtml() {
  const r = SX.last();
  return `<div class="sx-tech">${TECH.map(x => `<article class="${x.flag && x.flag(r) ? 'flag' : ''}"><span class="ico">${icon(x.ic)}</span><div><b>${esc(x.t)}</b><p>${esc(x.d)}</p>${x.act ? `<button class="btn sm" type="button" data-sx="do" data-do="${esc(x.act[1])}">${esc(x.act[0])}</button>` : ''}</div></article>`).join('')}</div>`;
}
function alertsHtml() {
  const o = SX.opts();
  return `<div class="sx-row col"><div><b>Warn me at <em id="sx-hotv">${o.hot} °C</em></b><small>Studio warns you and suggests cooling once the phone reaches this.</small></div><input type="range" min="38" max="50" step="1" value="${o.hot}" data-sxc="hot" aria-label="Warning temperature"></div>
    <div class="sx-row col"><div><b>Cool enough at <em id="sx-coolv">${o.cool} °C</em></b><small>The cool-down tracker finishes when the phone reaches this.</small></div><input type="range" min="30" max="40" step="1" value="${o.cool}" data-sxc="coolat" aria-label="Cool temperature"></div>
    <p class="hint">Typical phones feel warm at 38 °C, throttle from about 43 to 45 °C and protect themselves above 48 °C. Readings come from the phone sensors.</p>`;
}
SX.register({ id: 'thermals', label: 'Thermals', icon: 'thermo', order: 3,
  render: () => `<div class="sx-grid">
    ${SX.card('span-5', 'Temperature', 'Live from the phone sensors.', '<div id="w-tg"></div>')}
    ${SX.card('span-7', 'Thermal history', 'The last few minutes. Coloured bands show comfortable, warm and hot.', '<div id="w-tp" class="sx-plotbox"></div>', `<button class="btn sm" type="button" data-xp="temp">${icon('expand', 'sm')}<span>Full history</span></button>`)}
    ${SX.card('span-12 xp-cdcard', 'Cool-down assistant', '', '<div id="w-tc"></div>')}
    ${SX.card('span-8', 'Cooling techniques', 'What actually lowers temperature, best first.', '<div id="w-tt"></div>')}
    ${SX.card('span-4', 'Thermal alerts', 'Set your own limits.', '<div id="w-ta"></div>')}
  </div>`,
  paint() { SX.W('w-tg', gaugeHtml()); const pb = document.getElementById('w-tp'); if (pb) { const h = plotHtml(pb); if (pb._p !== h) { pb._p = h; pb.innerHTML = h; } } SX.W('w-tc', coolHtml()); SX.W('w-tt', techHtml()); SX.W('w-ta', alertsHtml()); }
});
Object.assign(SX.actions, { coolstop: () => { S.cool = null; SX.refresh(); } });
document.addEventListener('input', e => {
  const t = e.target.closest('#studio-root [data-sxc="hot"],#studio-root [data-sxc="coolat"]'); if (!t) return;
  const el = document.getElementById(t.dataset.sxc === 'hot' ? 'sx-hotv' : 'sx-coolv'); if (el) el.textContent = t.value + ' °C';
});
Object.assign(SX.changes, {
  hot: t => { const o = SX.opts(); const v = Number(t.value); STK.kv.set('perf-opts', { ...o, hot: v, cool: Math.min(o.cool, v - 4) }); },
  coolat: t => { const o = SX.opts(); const v = Number(t.value); STK.kv.set('perf-opts', { ...o, cool: Math.min(v, o.hot - 3) }); }
});
STK.on('sx-cool', () => { if (state.view === 'studio' && S.tab === 'thermals') SX.refresh(); });

/* ---------- Network ---------- */
const NET = { res: null, hist: [], busy: false, host: STK.store.get('sx-nethost', ''), err: '' };
const rate = ms => ms == null ? ['', '--'] : ms < 40 ? ['ok', 'Excellent'] : ms < 80 ? ['ok', 'Good'] : ms < 130 ? ['warn', 'Playable'] : ['bad', 'Laggy'];
function wifiHtml() {
  const r = SX.last(); if (!r) return '<p class="hint">Reading the phone...</p>';
  const w = r.wifi; if (!w) return `<div class="sx-note">${icon('info', 'sm')}<span>The phone is not on Wi-Fi right now (or it does not share the details). Mobile data works for the ping test below.</span></div>`;
  const q = clamp(2 * (w.rssi + 100), 0, 100), tone = q >= 60 ? 'ok' : q >= 40 ? 'warn' : 'bad';
  return `<div class="sx-gauge small"><div class="ringbox">${SX.ring(q, { tone, stroke: 9 })}<div class="mid"><b>${q}<em>%</em></b><small>Signal</small></div></div><div class="sx-kvwrap">${SX.kv([['Signal strength', w.rssi + ' dBm', tone === 'ok' ? '' : tone], ['Band', esc(w.band || '-'), w.band === '2.4 GHz' ? 'warn' : ''], w.linkMbps ? ['Link speed', w.linkMbps + ' Mbps'] : null, w.freqMhz ? ['Frequency', w.freqMhz + ' MHz'] : null])}</div></div>`;
}
function netResHtml() {
  if (NET.busy) return `<div class="sx-note"><i class="sx-spin"></i><span>Testing the connection from the phone. This takes about ten seconds...</span></div>`;
  if (NET.err) return `<div class="sx-note bad">${icon('alert', 'sm')}<span>${esc(NET.err)}</span></div>`;
  if (!NET.res) return `<div class="sx-empty small">${icon('wifi')}<b>No test yet</b><p>Run the network check to measure ping, jitter and packet loss from the phone itself, which is what a game feels.</p></div>`;
  const good = NET.res.filter(x => x.ok);
  const cards = NET.res.map(x => { const [t, w] = rate(x.avg); return `<div class="sx-ping ${x.ok ? t : 'bad'}"><small>${esc(x.host)}</small><b>${x.ok ? x.avg + '<em> ms</em>' : 'No reply'}</b><span>${x.ok ? w : esc(x.reply || 'The phone could not reach it.')}</span>${x.ok ? `<div class="sub"><span>Jitter <b>${x.jitter} ms</b></span><span>Loss <b>${x.loss}%</b></span><span>Best <b>${x.min} ms</b></span><span>Worst <b>${x.max} ms</b></span></div>` : ''}</div>`; }).join('');
  let verdict = '', tips = [];
  if (good.length) {
    const avg = good.reduce((a, x) => a + x.avg, 0) / good.length, jit = Math.max(...good.map(x => x.jitter)), loss = Math.max(...good.map(x => x.loss));
    const [t, w] = rate(avg); verdict = `<div class="sx-verdict ${t}"><b>${w} for online games</b><span>Average ${avg.toFixed(0)} ms${jit > 15 ? ' with jumpy delay' : ''}${loss > 0 ? ' and ' + loss + '% lost packets' : ''}.</span></div>`;
    if (jit > 15) tips.push('Jitter is high. That feels like random lag spikes. Move closer to the router or pause other downloads.');
    if (loss > 2) tips.push('Packets are being lost. Try 5 GHz Wi-Fi, a different spot, or restarting the router.');
    if (avg > 80) tips.push('Ping is high. Pick a nearer game server region, and close apps that use the network in the background.');
    const r = SX.last(); if (r && r.wifi && r.wifi.band === '2.4 GHz') tips.push('You are on 2.4 GHz. 5 GHz usually has lower ping if your router and distance allow it.');
    if (!tips.length) tips.push('Nothing to fix. The connection looks steady.');
  }
  const trend = NET.hist.length > 1 ? `<div class="sx-trend"><small>Average ping over your tests</small>${SX.spark(NET.hist, { min: 0, max: null, cls: 'cool' })}</div>` : '';
  return `${verdict}<div class="sx-pings">${cards}</div>${trend}${tips.length ? `<ul class="sx-tips">${tips.map(x => `<li>${icon('sparkle', 'sm')}<span>${esc(x)}</span></li>`).join('')}</ul>` : ''}`;
}
async function runNet(btn) {
  if (NET.busy) return; const id = STK.sel(); if (!id) return;
  const hosts = ['1.1.1.1', '8.8.8.8']; const extra = (NET.host || '').trim(); if (extra) hosts.push(extra);
  NET.busy = true; NET.err = ''; SX.W('w-nr', netResHtml());
  try { const r = await STK.post('/perf-tools', { serial: id, action: 'netcheck', hosts }, { timeout: 90000 }); NET.res = r.results || []; const g = NET.res.filter(x => x.ok); if (g.length) { NET.hist.push(g.reduce((a, x) => a + x.avg, 0) / g.length); if (NET.hist.length > 20) NET.hist.shift(); } else NET.err = 'No host answered. Check that the phone has internet access.'; }
  catch (e) { NET.err = e.message; }
  NET.busy = false; SX.W('w-nr', netResHtml());
}
SX.register({ id: 'network', label: 'Network', icon: 'wifi', order: 5,
  render: () => `<div class="sx-grid">
    ${SX.card('span-5', 'Wi-Fi', 'Signal quality of the phone connection.', '<div id="w-nw"></div>')}
    ${SX.card('span-7', 'Network check', 'Ping, jitter and packet loss, measured from the phone.', `<div class="sx-netbar"><label class="ff"><span>Also test this server (optional)</span><input data-sxc="nethost" value="${esc(NET.host)}" placeholder="example.com or a game server address" autocomplete="off" spellcheck="false"></label><button class="btn primary" type="button" data-sx="netrun">${icon('pulse', 'sm')}<span>Run network check</span></button></div><div id="w-nr"></div>`)}
  </div>`,
  paint() { SX.W('w-nw', wifiHtml()); SX.W('w-nr', netResHtml()); }
});
Object.assign(SX.actions, { netrun: t => runNet(t) });
Object.assign(SX.changes, { nethost: t => { NET.host = t.value.trim(); STK.store.set('sx-nethost', NET.host); } });

/* ---------- Capture ---------- */
const CAP = { demo: false };
const dopts = () => ({ clock: '1200', battery: 100, hideNotifications: true, dnd: true, touches: false, ...STK.store.get('demo-opts', {}) });
function demoHtml() {
  const o = dopts();
  return `<p class="hint lead">Cleans up the status bar for screenshots and recordings: fixed clock, full battery, strong signal and no notification icons. Turn it off to bring the real status bar back.</p>
    <div class="formgrid inline"><label class="ff"><span>Clock</span><input id="demo-clock" value="${esc(o.clock.slice(0, 2) + ':' + o.clock.slice(2))}" maxlength="5" autocomplete="off" aria-label="Clock shown on the phone"></label><label class="ff"><span>Battery</span><input id="demo-batt" type="number" min="1" max="100" value="${o.battery}" aria-label="Battery level shown"></label></div>
    <div class="checks"><label class="chk"><input type="checkbox" id="demo-hide" ${o.hideNotifications ? 'checked' : ''}><span>Hide notification icons</span></label><label class="chk"><input type="checkbox" id="demo-dnd" ${o.dnd ? 'checked' : ''}><span>Turn on Do not disturb</span></label><label class="chk"><input type="checkbox" id="demo-touch" ${o.touches ? 'checked' : ''}><span>Show touches on the screen</span></label></div>
    <div class="row"><button class="btn ${CAP.demo ? '' : 'primary'}" type="button" data-sx="demotoggle">${icon('wand', 'sm')}<span>${CAP.demo ? 'Turn demo mode off' : 'Turn demo mode on'}</span></button><button class="btn" type="button" data-sx="demopresent">${icon('expand', 'sm')}<span>Presentation view</span></button></div>`;
}
function presetsHtml() {
  const ps = (state.schema && state.schema.presets) || [];
  return ps.length ? `<div class="sx-presets">${ps.map(p => `<button type="button" class="sx-preset" data-sx="spreset" data-id="${esc(p.id)}"><b>${esc(p.name)}</b><span>${esc(p.note)}</span><em>${p.v.maxSize === 0 ? 'Native' : p.v.maxSize + ' px'} · ${p.v.maxFps} fps · ${p.v.bitrateMbps} Mbps</em></button>`).join('')}</div>` : '<p class="hint">Loading presets...</p>';
}
SX.register({ id: 'capture', label: 'Capture', icon: 'camera', order: 6,
  render: () => `<div class="sx-grid">
    ${SX.card('span-12', 'Quick capture', 'Mirror, record or screenshot your gameplay straight from here.', `<div class="sx-tools three">
      <button type="button" class="sx-tool primary" data-sx="capmirror"><span class="ico">${icon('mirror')}</span><b>Mirror screen</b><small>Open the phone in a window on this PC.</small></button>
      <button type="button" class="sx-tool rec" data-sx="caprecord"><span class="ico">${icon('record')}</span><b>Record gameplay</b><small>Start or stop a recording with sound.</small></button>
      <button type="button" class="sx-tool" data-sx="capshot"><span class="ico">${icon('camera')}</span><b>Screenshot</b><small>Save a picture to your library.</small></button></div>`)}
    ${SX.card('span-6', 'Demo mode', 'A clean status bar for trailers and screenshots.', '<div id="w-demo"></div>', `<span class="sx-chip ${CAP.demo ? 'ok' : ''}">${CAP.demo ? 'On' : 'Off'}</span>`)}
    ${SX.card('span-6', 'Capture presets', 'One tap changes how mirroring and recording look and feel.', '<div id="w-presets"></div><p class="hint" style="margin-top:12px">Fine control is on the Settings page.</p>')}
  </div>`,
  paint() { SX.W('w-demo', demoHtml()); SX.W('w-presets', presetsHtml()); },
  onShow() { STK.loadSchema().then(() => { if (state.view === 'studio' && S.tab === 'capture') SX.refresh(true); }).catch(() => {}); loadDemo(); }
});
async function loadDemo() { const id = STK.sel(); if (!id) { CAP.demo = false; return; } try { CAP.demo = (await STK.api('/demo?id=' + encodeURIComponent(id))).on; } catch (e) { /* unknown */ } if (state.view === 'studio' && S.tab === 'capture') SX.refresh(true); }
STK.on('demo', on => { CAP.demo = on; if (state.view === 'studio' && S.tab === 'capture') SX.refresh(true); });
async function toggleDemo(btn) {
  const id = STK.sel(); if (!id) return;
  const clock = (($('#demo-clock').value.replace(':', '').replace(/\D/g, '')) + '1200').slice(0, 4).padStart(4, '0');
  const o = { clock, battery: Math.max(1, Math.min(100, Number($('#demo-batt').value) || 100)), hideNotifications: $('#demo-hide').checked, dnd: $('#demo-dnd').checked, touches: $('#demo-touch').checked };
  STK.store.set('demo-opts', o);
  await STK.busy(btn, async () => { try { const r = await STK.post('/demo', { serial: id, on: !CAP.demo, ...o }, { timeout: 60000 }); CAP.demo = r.on; STK.toast(r.message); SX.refresh(true); } catch (e) { STK.fail(e); } });
}
const needPhone = fn => () => STK.sel() ? fn() : STK.toast('Connect a phone first.', 'bad');
Object.assign(SX.actions, {
  demotoggle: t => toggleDemo(t),
  demopresent: () => { STK.go('console'); setTimeout(() => { const h = $('#hero'); if (h && h.dataset.size !== 'l') $('#frame-size').click(); }, 120); },
  spreset: t => { const p = state.schema.presets.find(x => x.id === t.dataset.id); return STK.busy(t, async () => { try { await STK.post('/settings', { patch: p.v }); await STK.loadSettings(); STK.toast(p.name + ' preset applied.'); } catch (er) { STK.fail(er); } }); },
  capmirror: needPhone(() => STK.actions.mirror()), caprecord: needPhone(() => STK.actions.record()), capshot: needPhone(() => STK.actions.screenshot())
});
STK.on('device-changed', () => { CAP.demo = false; NET.res = null; NET.hist = []; NET.err = ''; });
})();
