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
    ${['cpu:Processor', 'mem:Memory', 'net:Network', 'temp:Temperature'].map(x => { const [k, l] = x.split(':'); return `<section class="panel mon-card" id="mc-${k}"><header><span>${l}</span><b id="mv-${k}">--</b></header><div id="mg-${k}" class="mon-chart"></div><small id="ms-${k}" class="hint"></small></section>`; }).join('')}
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
    paintLive(); thermal(r);
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
STK.on('device-changed', () => { M.permApps = null; M.permPkg = ''; if (state.view === 'monitor') setTab(M.tab); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view === 'monitor' && M.tab === 'live') sample(); });
})();
