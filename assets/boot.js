/* Boot: navigation, command palette, shortcuts, theme, dialog plumbing. */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;

if (location.protocol === 'file:') {
  document.body.innerHTML = '<div style="max-width:560px;margin:12vh auto;padding:24px;font:16px/1.6 system-ui,sans-serif"><h1 style="font-size:22px">Open this page through the toolkit</h1><p>This dashboard needs its local backend. Double-click <b>Launch.bat</b> in the toolkit folder. It opens the page at an address starting with http://127.0.0.1.</p></div>';
  return;
}

/* navigation */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-view]');
  if (t) { e.preventDefault(); STK.go(t.dataset.view); }
});

/* dialogs */
$('#text-close').addEventListener('click', () => $('#dlg-text').close());
$('#text-copy').addEventListener('click', () => navigator.clipboard.writeText($('#text-body').textContent).then(() => STK.toast('Copied.'), () => STK.toast('Copy was blocked by the browser.', 'bad')));
$$('dialog').forEach(d => d.addEventListener('mousedown', e => { if (e.target === d && d.id !== 'dlg-confirm' && d.id !== 'dlg-prompt') d.close(); }));
$$('dialog button[value="cancel"]').forEach(btn => btn.addEventListener('click', () => btn.closest('dialog').close('cancel')));

/* theme */
const ORDER = ['auto', 'dark', 'light'];
$('#theme-btn').addEventListener('click', async () => {
  const cur = (state.settings && state.settings.theme) || 'auto';
  const next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
  STK.applyTheme(next);
  if (state.settings) state.settings.theme = next;
  STK.toast('Theme: ' + next + '.');
  try { await STK.post('/settings', { patch: { theme: next } }); STK.emit('settings', state.settings); } catch (e) { STK.fail(e); }
});
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (state.settings && state.settings.theme === 'auto') STK.applyTheme('auto'); });

/* command palette */
const need = fn => () => STK.sel() ? fn() : STK.toast('Connect a phone first.', 'bad');
const COMMANDS = [
  { name: 'Go to Console', hint: '1', run: () => STK.go('console') },
  { name: 'Go to Performance Studio (boost, cooling, games)', hint: '2', run: () => STK.go('studio') },
  { name: 'Studio: boost phone memory', run: need(() => { STK.go('studio'); setTimeout(() => STK.studio && STK.studio.boost(), 200); }) },
  { name: 'Studio: cool the phone down', run: need(() => { STK.go('studio'); setTimeout(() => STK.studio && STK.studio.cooldown(), 200); }) },
  { name: 'Studio: apply Gaming profile', run: need(() => { STK.go('studio'); setTimeout(() => STK.studio && STK.studio.applyProfile('gaming'), 200); }) },
  { name: 'Studio: thermals and temperature', run: () => { STK.go('studio'); setTimeout(() => STK.studio && STK.studio.go('thermals'), 100); } },
  { name: 'Studio: network and ping check', run: () => { STK.go('studio'); setTimeout(() => STK.studio && STK.studio.go('network'), 100); } },
  { name: 'Go to Automation (macros, schedules)', hint: '3', run: () => STK.go('automation') },
  { name: 'Go to Phone tools', hint: '4', run: () => STK.go('phone') },
  { name: 'Go to Monitor', hint: '5', run: () => STK.go('monitor') },
  { name: 'Go to Notifications', hint: '6', run: () => STK.go('notifications') },
  { name: 'Go to Library', hint: '7', run: () => STK.go('library') },
  { name: 'Go to Devices', hint: '8', run: () => STK.go('device') },
  { name: 'Go to Settings', hint: '9', run: () => STK.go('settings') },
  { name: 'Open phone gallery', run: () => { STK.go('library'); setTimeout(() => $('[data-xtab="gallery"]').click(), 0); } },
  { name: 'Back up phone photos', run: () => { STK.go('library'); setTimeout(() => $('[data-xtab="backups"]').click(), 0); } },
  { name: 'Inspect the phone screen', run: () => { STK.go('phone'); setTimeout(() => $('[data-ptab="inspect"]').click(), 0); } },
  { name: 'Open an intent or link on the phone', run: () => { STK.go('phone'); setTimeout(() => $('[data-ptab="launch"]').click(), 0); } },
  { name: 'Turn demo mode on or off', run: need(() => STK.demoToggle && STK.demoToggle()) },
  { name: 'Record a GIF of the phone screen', run: need(() => STK.gifCapture && STK.gifCapture()) },
  { name: 'Background jobs', hint: 'J', run: () => STK.jobs && STK.jobs.toggle() },
  { name: 'Start or stop mirroring', hint: 'M', run: need(() => STK.actions.mirror()) },
  { name: 'Start or stop recording', hint: 'R', run: need(() => STK.actions.record()) },
  { name: 'Take a screenshot', hint: 'S', run: need(() => STK.actions.screenshot()) },
  { name: 'Update the phone picture', hint: 'U', run: need(() => STK.preview.update()) },
  { name: 'Turn live preview on or off', hint: 'L', run: need(() => STK.preview.toggleLive()) },
  { name: 'Copy the phone picture', hint: 'C', run: need(() => STK.preview.copy()) },
  { name: 'Keyboard shortcuts', hint: '?', run: () => $('#dlg-help').showModal() },
  { name: 'Stop all sessions', run: () => STK.actions.stopAll() },
  { name: 'Press Home on the phone', run: need(() => STK.sendKey('home')) },
  { name: 'Press Back on the phone', run: need(() => STK.sendKey('back')) },
  { name: 'Open notifications on the phone', run: need(() => STK.sendKey('notifications')) },
  { name: 'Wake the phone screen', run: need(() => STK.sendKey('wake')) },
  { name: 'Turn the phone screen off', run: need(() => STK.sendKey('sleep')) },
  { name: 'Open phone shell', run: () => { STK.go('phone'); setTimeout(() => $('[data-ptab="shell"]').click(), 0); } },
  { name: 'Open phone apps', run: () => { STK.go('phone'); setTimeout(() => $('[data-ptab="apps"]').click(), 0); } },
  { name: 'Open phone files', run: () => { STK.go('phone'); setTimeout(() => $('[data-ptab="files"]').click(), 0); } },
  { name: 'Open recordings folder', run: () => STK.post('/open-folder', { kind: 'recordings' }).catch(STK.fail) },
  { name: 'Open screenshots folder', run: () => STK.post('/open-folder', { kind: 'screenshots' }).catch(STK.fail) },
  { name: 'Run system check', run: () => { STK.go('device'); setTimeout(() => $('#diag-run').click(), 0); } },
  { name: 'Refresh devices', run: () => { STK.pollNow(); STK.toast('Refreshing.'); } },
  { name: 'Switch theme', run: () => $('#theme-btn').click() },
  { name: 'Restart backend', run: () => STK.restartBackend(null) }
];
let palIdx = 0, palList = [];
function palRender() {
  const q = $('#pal-input').value.trim().toLowerCase();
  palList = COMMANDS.filter(c => !q || q.split(/\s+/).every(w => c.name.toLowerCase().includes(w)));
  palIdx = Math.min(palIdx, Math.max(0, palList.length - 1));
  STK.setHtml($('#pal-list'), palList.map((c, i) => `<li role="option" aria-selected="${i === palIdx}" class="${i === palIdx ? 'is-active' : ''}" data-i="${i}"><span>${esc(c.name)}</span>${c.hint ? `<kbd>${esc(c.hint)}</kbd>` : ''}</li>`).join('') || '<li class="hint" style="padding:12px">No command matches.</li>');
  const a = $('#pal-list .is-active'); if (a) a.scrollIntoView({ block: 'nearest' });
}
function palOpen() { const d = $('#dlg-palette'); if (d.open) return; $('#pal-input').value = ''; palIdx = 0; palRender(); d.showModal(); $('#pal-input').focus(); }
function palRun(i) { const c = palList[i]; if (!c) return; $('#dlg-palette').close(); setTimeout(c.run, 0); }
$('#palette-btn').addEventListener('click', palOpen);
$('#pal-input').addEventListener('input', () => { palIdx = 0; palRender(); });
$('#pal-input').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { palIdx = Math.min(palIdx + 1, palList.length - 1); palRender(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { palIdx = Math.max(palIdx - 1, 0); palRender(); e.preventDefault(); }
  else if (e.key === 'Enter') { e.preventDefault(); palRun(palIdx); }
});
$('#pal-list').addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) palRun(Number(li.dataset.i)); });

/* shortcuts */
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return palOpen(); }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable || document.querySelector('dialog[open]')) return;
  const views = { 1: 'console', 2: 'studio', 3: 'automation', 4: 'phone', 5: 'monitor', 6: 'notifications', 7: 'library', 8: 'device', 9: 'settings' };
  if (views[e.key]) return STK.go(views[e.key]);
  const k = e.key.toLowerCase();
  if (k === 'm') need(() => STK.actions.mirror())();
  else if (k === 'r') need(() => STK.actions.record())();
  else if (k === 's') need(() => STK.actions.screenshot())();
  else if (k === 'u') need(() => STK.preview.update())();
  else if (k === 'l') need(() => STK.preview.toggleLive())();
  else if (k === 'c') need(() => STK.preview.copy())();
  else if (k === 'k') { if (STK.markRecording) STK.markRecording(); }
  else if (k === 'j') { if (STK.jobs) STK.jobs.toggle(); }
  else if (e.key === '?') $('#dlg-help').showModal();
});

$('#help-close').addEventListener('click', () => $('#dlg-help').close());

/* start */
STK.go((location.hash || '#console').slice(1));
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== state.view) STK.go(h); });
/* 4.4.0: say so when a phone is plugged in or taken out, whatever page is open (and on the desktop if the tab is in the background). */
let knownReady = null;
STK.on('state', () => {
  const ready = STK.readyDevices().map(d => d.id);
  if (knownReady === null) { knownReady = ready; return; }
  const added = ready.filter(x => !knownReady.includes(x)), gone = knownReady.filter(x => !ready.includes(x));
  knownReady = ready;
  const name = id => { const d = state.devices.find(x => x.id === id); return (d && (d.model || d.product)) || id; };
  added.forEach(id => { STK.toast('Phone connected: ' + name(id), 'ok'); STK.notify && STK.notify('Phone connected', name(id), 'dev-' + id); });
  gone.forEach(id => { STK.toast('Phone disconnected.', 'bad'); STK.notify && STK.notify('Phone disconnected', 'The cable was unplugged or the phone went to sleep.', 'dev-' + id); });
});

/* 4.4.0: the start-up loader leaves once the first reading of the service and the phone is in, and has been seen for a moment. */
const hideLoader = () => {
  const el = document.getElementById('boot-loader'); if (!el) return;
  const wait = Math.max(0, 900 - performance.now());
  setTimeout(() => { document.documentElement.classList.remove('booting'); el.classList.add('out'); setTimeout(() => el.remove(), 650); }, wait);
};
STK.start().then(() => { STK.loadProfiles(); hideLoader(); }, hideLoader);
})();
