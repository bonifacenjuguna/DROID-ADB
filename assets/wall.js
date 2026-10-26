/* Devices extras: live wall of all connected phones and saved Wi-Fi phones. */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const W = { on: false, timer: null, urls: {}, busy: {} };
const view = $('#view-device');
const holder = document.createElement('div'); holder.id = 'dev-x'; view.prepend(holder);

function nameOf(d) { return STK.nickFor(d.id) || (state.info[d.id] && state.info[d.id].model) || d.model || d.id; }
function render() {
  const ready = STK.readyDevices(), hosts = STK.kv.get('wifihosts', []);
  let html = '';
  if (ready.length >= 2) {
    html += `<section class="panel wallpanel"><header class="panel-head"><h2>Live wall</h2><span class="hint">All connected phones side by side. Click one to control it.</span></header><div class="wall">${ready.map(d => { const L = state.live && state.live[d.id]; return `<button class="wallcell ${STK.sel() === d.id ? 'active' : ''}" data-wall="${esc(d.id)}"><span class="wimg"><img data-wimg="${esc(d.id)}" ${W.urls[d.id] ? `src="${W.urls[d.id]}"` : ''} alt="Screen of ${esc(nameOf(d))}"></span><b>${esc(nameOf(d))}</b><small>${L && L.battery >= 0 ? L.battery + '%' + (L.charging ? ' charging' : '') : ''}${L && L.fgPackage ? ' · ' + esc(STK.niceApp(L.fgPackage)) : ''}</small></button>`; }).join('')}</div></section>`;
  }
  html += `<section class="panel"><header class="panel-head"><h2>Saved Wi-Fi phones</h2><span class="hint">The toolkit reconnects these automatically when they drop off (see Settings).</span></header>${hosts.length ? hosts.map(h => `<div class="grow-item"><span class="badge">${icon('wifi')}</span><div><b class="mono">${esc(h)}</b><small>${state.devices.some(d => d.id === h && d.state === 'device') ? 'Connected now' : 'Not connected'}</small></div><button class="btn sm" data-wconnect="${esc(h)}">Connect now</button><button class="icon-btn" data-wforget="${esc(h)}" aria-label="Forget ${esc(h)}">${icon('x')}</button></div>`).join('') : '<p class="hint">Phones you connect over Wi-Fi are remembered here.</p>'}</section>`;
  STK.setHtml(holder, html);
}
async function refresh() {
  if (state.view !== 'device' || document.hidden) return;
  for (const d of STK.readyDevices()) {
    if (W.busy[d.id]) continue; W.busy[d.id] = true;
    fetch('/api/preview-image?id=' + encodeURIComponent(d.id) + '&maxAge=2500&t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.blob() : null).then(b => {
      if (!b || !b.size) return; const old = W.urls[d.id]; W.urls[d.id] = URL.createObjectURL(b);
      const im = document.querySelector(`img[data-wimg="${CSS.escape(d.id)}"]`); if (im) im.src = W.urls[d.id]; if (old) setTimeout(() => URL.revokeObjectURL(old), 1500);
    }).catch(() => {}).finally(() => { W.busy[d.id] = false; });
  }
}
function start() { stop(); if (STK.readyDevices().length >= 2) { refresh(); W.timer = setInterval(refresh, 3500); } }
function stop() { clearInterval(W.timer); W.timer = null; }
document.addEventListener('click', async e => {
  const t = e.target.closest('#dev-x button'); if (!t) return;
  if (t.dataset.wall) { state.selected = t.dataset.wall; STK.store.set('device', state.selected); STK.emit('device-changed'); if (STK.renderConsole) STK.renderConsole(); STK.go('console'); return; }
  if (t.dataset.wconnect) return STK.busy(t, async () => { try { await STK.post('/wifi', { action: 'connect', address: t.dataset.wconnect }, { timeout: 30000 }); STK.toast('Connected.'); STK.pollNow(); } catch (er) { STK.fail(er); } });
  if (t.dataset.wforget) { try { await STK.post('/wifi-hosts', { hosts: STK.kv.get('wifihosts', []).filter(h => h !== t.dataset.wforget) }); await STK.kv.load(); render(); } catch (er) { STK.fail(er); } }
});
STK.on('view', v => { if (v === 'device') { render(); start(); } else stop(); });
STK.on('kv', k => { if (k === 'wifihosts' || k === '*' || k === 'nicknames') render(); });
STK.on('state', () => { if (state.view === 'device') { render(); if (!W.timer) start(); } });
})();
