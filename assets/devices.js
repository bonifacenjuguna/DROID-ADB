/* Devices view: device list, wireless, power, specs, diagnostics, backend controls. */
(() => {
'use strict';
const { $, $$, esc, icon, bytes, state } = STK;
let lastDiag = null;

const STATE_INFO = { device: ['ok', 'Ready'], unauthorized: ['warn', 'Unauthorized'], offline: ['bad', 'Offline'], recovery: ['warn', 'Recovery'], sideload: ['warn', 'Sideload'] };

function renderList() {
  const box = $('#device-list');
  if (!state.devices.length) {
    STK.setHtml(box, `<div class="empty">${icon('plug')}<b>No phone detected</b><p>${esc(state.deviceMessage || 'Connect a phone with a data cable and turn on USB debugging.')}</p></div>`);
    return;
  }
  const cur = STK.current();
  STK.setHtml(box, state.devices.map(d => {
    const [cls, label] = STATE_INFO[d.state] || ['warn', d.state];
    const wifi = /:\d+$/.test(d.id) || /_adb/.test(d.id);
    const inf = state.info[d.id];
    const name = d.model || (inf && inf.model) || d.id;
    const active = cur && cur.id === d.id;
    return `<div class="dev ${active ? 'active' : ''}"><span class="badge">${icon(wifi ? 'wifi' : 'usb')}</span><div><b>${esc(String(name).replace(/_/g, ' '))}</b><small>${esc(d.id)} · ${wifi ? 'Wi-Fi' : 'USB'}</small></div><span class="chip sm ${cls}"><i class="dot"></i><b>${esc(label)}</b></span>${d.state === 'device' ? (active ? '<span class="pill">In use</span>' : `<button class="btn sm" data-use="${esc(d.id)}">Use this phone</button>`) : '<span></span>'}</div>`;
  }).join(''));
}

function renderSpecs() {
  const box = $('#phone-specs'), i = STK.info();
  if (!STK.sel()) { STK.setHtml(box, '<div class="hint">Connect a phone to see its details.</div>'); return; }
  if (!i) { STK.setHtml(box, '<div class="hint">Reading the phone...</div>'); return; }
  if (i.error) { STK.setHtml(box, `<div class="hint">${esc(i.error)}</div>`); return; }
  const rows = [
    ['Model', [i.manufacturer, i.model].filter(Boolean).join(' ')],
    ['Android', i.android ? i.android + (i.sdk ? ' (API ' + i.sdk + ')' : '') : ''],
    ['Screen', i.width ? `${i.width} x ${i.height}, ${i.density} dpi` : ''],
    ['Battery', i.battery >= 0 ? i.battery + '%' + (i.charging ? ' (charging' + (i.power ? ', ' + i.power : '') + ')' : '') + (i.tempC != null ? ', ' + i.tempC + ' °C' : '') : ''],
    ['Storage', i.storageTotal ? `${bytes(i.storageFree)} free of ${bytes(i.storageTotal)}` : ''],
    ['Memory', i.ramTotal ? `${bytes(i.ramFree)} free of ${bytes(i.ramTotal)}` : ''],
    ['Wi-Fi address', i.ip],
    ['Security patch', i.patch],
    ['Build', i.build],
    ['CPU', i.abi],
    ['Uptime', i.uptimeSec ? STK.dur(i.uptimeSec) : '']
  ].filter(r => r[1]);
  STK.setHtml(box, rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join(''));
}

function renderSys() {
  const s = state.status, box = $('#sys-specs');
  if (!s) { STK.setHtml(box, '<div class="hint">Loading...</div>'); return; }
  const up = STK.dur(s.uptime);
  const rows = [
    ['Toolkit', 'v' + s.version], ['scrcpy', s.versions && s.versions.scrcpy ? s.versions.scrcpy : (s.scrcpyFound ? 'found' : 'not found')], ['ADB', s.versions && s.versions.adb ? s.versions.adb : (s.adbFound ? 'found' : 'not found')],
    ['Backend', `port ${s.port}, ${s.workers} workers, up ${up}`], ['Platform', s.platform], ['Folder', s.root], ['Recordings', s.dirs.recordings], ['Screenshots', s.dirs.screenshots], ['Downloads', s.dirs.downloads]
  ];
  STK.setHtml(box, rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join(''));
}

function renderDiag() {
  const box = $('#diag-list');
  if (!lastDiag) return;
  STK.setHtml(box, lastDiag.map(c => `<li class="${c.ok ? 'ok' : 'no'}">${icon(c.ok ? 'check' : 'alert')}<div><b>${esc(c.name)}</b><small>${esc(c.detail)}</small></div></li>`).join(''));
}
async function runDiag(btn) {
  await STK.busy(btn, async () => {
    try { const r = await STK.api('/diagnostics', { timeout: 40000 }); lastDiag = r.checks; renderDiag(); const bad = r.checks.filter(c => !c.ok).length; STK.toast(bad ? bad + ' check' + (bad > 1 ? 's' : '') + ' need attention.' : 'Everything looks good.', bad ? 'bad' : 'ok'); } catch (e) { STK.fail(e); }
  });
}

function renderAll() { if (state.view !== 'device') return; renderList(); renderSpecs(); renderSys(); }

async function wifi(action, extra, btn, okMsg) {
  return STK.busy(btn, async () => {
    try { const r = await STK.post('/wifi', { action, serial: STK.sel(), ...extra }, { timeout: 60000 }); STK.toast(okMsg || r.message); STK.pollNow(); return r; } catch (e) { STK.fail(e); STK.flash(btn, false); return null; }
  });
}

document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  const dev = $('#view-device');
  if (t.dataset.use) { state.selected = t.dataset.use; STK.store.set('device', state.selected); if (!state.info[state.selected]) STK.loadInfo(state.selected); renderAll(); STK.emit('device-changed'); STK.toast('Using ' + t.dataset.use + '.'); return; }
  if (!dev.contains(t)) return;
  if (t.id === 'run-check') return STK.busy(t, async () => { STK.pollNow(); await STK.sleep(600); STK.toast('Device list refreshed.'); });
  if (t.id === 'diag-run') return runDiag(t);
  if (t.id === 'adb-restart') return wifi('restart', {}, t);
  if (t.id === 'wifi-enable') { if (!STK.sel()) return STK.toast('Connect the phone with USB first.', 'bad'); const r = await wifi('enable', {}, t); if (r && r.address) $('#wifi-address').value = r.address; return; }
  if (t.id === 'wifi-connect') { const a = $('#wifi-address').value.trim(); if (!a) return STK.toast('Type the phone address first.', 'bad'); return wifi('connect', { address: a }, t); }
  if (t.id === 'wifi-disconnect') return wifi('disconnect', {}, t);
  if (t.id === 'wifi-pair') { const a = $('#pair-address').value.trim(), c = $('#pair-code').value.trim(); if (!a || !c) return STK.toast('Enter the pairing address and the six digit code.', 'bad'); const r = await wifi('pair', { address: a, code: c }, t); if (r) $('#pair-code').value = ''; return; }
  if (t.id === 'wifi-discover') {
    const r = await wifi('discover', {}, t, 'Search finished.');
    if (!r) return;
    STK.setHtml($('#wifi-found'), (r.found || []).map(f => `<div class="item"><span><b>${esc(f.name)}</b> <small>${esc(f.address)} · ${f.pairing ? 'pairing' : 'connect'}</small></span><button class="btn sm" data-fill="${esc(f.address)}" data-pairing="${f.pairing ? 1 : 0}">Use address</button></div>`).join('') || `<p class="hint">${esc(r.message)}</p>`);
    return;
  }
  if (t.dataset.fill) { $(t.dataset.pairing === '1' ? '#pair-address' : '#wifi-address').value = t.dataset.fill; return STK.toast('Address filled in.'); }
  if (t.dataset.power) {
    const a = t.dataset.power, names = { reboot: 'Restart the phone?', recovery: 'Restart into recovery?', bootloader: 'Restart into the bootloader?', poweroff: 'Power off the phone?' };
    if (!STK.sel()) return STK.toast('No phone is connected.', 'bad');
    if (!await STK.confirm(names[a], '<p>Any running mirror or recording ends. ' + (a === 'poweroff' ? 'You will need to press the power button on the phone to turn it on again.' : 'The phone will reconnect after it starts.') + '</p>', 'Continue', a !== 'reboot')) return;
    return STK.busy(t, async () => { try { const r = await STK.post('/power', { serial: STK.sel(), action: a, confirm: true }, { timeout: 40000 }); STK.toast(r.message); STK.pollNow(); } catch (er) { STK.fail(er); } });
  }
  if (t.id === 'copy-report') {
    const i = STK.info() || {}, s = state.status || {};
    const text = ['Scrcpy Toolkit report', 'Toolkit: ' + (s.version || '?') + ' on ' + (s.platform || '?'), 'scrcpy: ' + ((s.versions || {}).scrcpy || '?') + ', adb: ' + ((s.versions || {}).adb || '?'),
      'Devices: ' + (state.devices.map(d => d.id + ' (' + d.state + ')').join(', ') || 'none'), 'Phone: ' + [i.manufacturer, i.model, 'Android ' + i.android].join(' '),
      ...(lastDiag || []).map(c => (c.ok ? 'OK   ' : 'FAIL ') + c.name + ': ' + c.detail)].join('\n');
    return navigator.clipboard.writeText(text).then(() => STK.toast('Report copied.'), () => STK.showText('Report', text));
  }
  if (t.dataset.folder) return STK.post('/open-folder', { kind: t.dataset.folder }).catch(STK.fail);
  if (t.id === 'backend-log') return STK.busy(t, async () => { try { const r = await STK.api('/backend-log'); STK.showText('Backend error log', r.log || 'The backend log is empty. That is good.'); } catch (er) { STK.fail(er); } });
  if (t.id === 'backend-restart') return STK.restartBackend(t);
  if (t.id === 'backend-quit') { if (!await STK.confirm('Quit the backend?', '<p>The dashboard stops working until you run <b>Launch.bat</b> again. Running scrcpy windows keep going.</p>', 'Quit', true)) return; try { await STK.post('/backend', { action: 'quit' }); STK.toast('The backend is shutting down. Run Launch.bat to start it again.'); } catch (er) { STK.fail(er); } }
});

STK.views.device = { onShow() { renderAll(); STK.refreshStatus(); STK.pollNow(); const i = STK.sel(); if (i) STK.loadInfo(i, true); } };
STK.on('state', renderAll);
STK.on('info', renderAll);
STK.on('status', renderAll);
STK.on('device-changed', renderAll);
})();
