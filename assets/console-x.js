/* Console extras: pinned apps, phone levels, paste from PC, PC keyboard typing, recording markers. */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const box = $('#remote-extra');
const pins = () => STK.kv.get('pins', []);
const nice = p => (STK.niceApp ? STK.niceApp(p) : p);

function render() {
  const list = pins();
  const chips = list.map(p => `<span class="pinchip"><button class="chipbtn" data-pin="${esc(p)}" title="Open ${esc(p)}">${esc(nice(p))}</button><button class="pinmore" data-pinmore="${esc(p)}" aria-label="More for ${esc(nice(p))}">${icon('more', 'sm')}</button></span>`).join('');
  STK.setHtml(box, `<div class="xrow"><span class="xlabel">${icon('pin', 'sm')}Pinned apps</span><div class="pins">${chips || '<span class="hint">Pin the apps you open often.</span>'}<button class="chipbtn add" id="pin-add">+ Pin an app</button></div></div>
  <details class="xlevels" id="xlevels"><summary>${icon('sliders', 'sm')}<span>Phone levels</span></summary><div id="xlevels-body" class="xbody"></div></details>
  <div class="xrow"><span class="xlabel">${icon('keyboard', 'sm')}Typing</span><div class="pins"><button class="btn sm" id="paste-btn">${icon('copy', 'sm')}<span>Paste from PC</span></button><label class="live-toggle" title="Everything you type on the PC keyboard goes to the phone"><span class="switch sm"><input type="checkbox" id="kbd-live" aria-label="Type with the PC keyboard"><i></i></span><span>PC keyboard</span></label></div></div>`);
  const kb = $('#kbd-live'); if (kb) kb.checked = kbd.on;
}

/* pins */
async function pinApp() {
  const id = STK.sel(); if (!id) return STK.toast('Connect a phone first.', 'bad');
  let apps = [];
  try { apps = (await STK.api(`/apps?id=${encodeURIComponent(id)}&scope=user`, { timeout: 60000 })).apps || []; } catch (e) { /* typing the package still works */ }
  const f = await STK.form('Pin an app', `<label class="ff"><span>App</span><input name="pkg" list="pkg-list" placeholder="Start typing an app name" autocomplete="off" spellcheck="false"></label><datalist id="pkg-list">${apps.map(a => `<option value="${esc(a.package)}">${esc(nice(a.package))}</option>`).join('')}</datalist>`, 'Pin');
  if (!f || !f.pkg) return;
  const pkg = f.pkg.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(pkg)) return STK.toast('Use the package name, like com.whatsapp.', 'bad');
  if (!pins().includes(pkg)) STK.kv.set('pins', [...pins(), pkg].slice(0, 24));
  render();
}
STK.pinApp = pkg => { if (!pins().includes(pkg)) { STK.kv.set('pins', [...pins(), pkg].slice(0, 24)); render(); } STK.toast(nice(pkg) + ' pinned to the Console.'); };
const open = (pkg, btn) => STK.busy(btn, async () => { try { await STK.post('/app', { serial: STK.sel(), action: 'launch', package: pkg }); } catch (e) { STK.fail(e); } });

/* levels */
async function loadLevels() {
  const body = $('#xlevels-body'), id = STK.sel();
  if (!id) return STK.setHtml(body, '<p class="hint">Connect a phone first.</p>');
  body.innerHTML = '<p class="hint">Reading the phone...</p>';
  try {
    const t = await STK.api('/toggles?id=' + encodeURIComponent(id), { timeout: 30000 });
    const b = t.brightness >= 0 ? `<div class="sliderrow"><b>Brightness</b><input type="range" min="1" max="255" value="${t.brightness}" data-xslide="brightness" aria-label="Brightness"><output>${Math.round(t.brightness / 255 * 100)}%</output></div>` : '';
    const v = t.volume !== null && t.volumeMax ? `<div class="sliderrow"><b>Volume</b><input type="range" min="0" max="${t.volumeMax}" value="${t.volume}" data-xslide="volume" aria-label="Media volume"><output>${t.volume}/${t.volumeMax}</output></div>` : '';
    const TO = [[15000, '15 s'], [30000, '30 s'], [60000, '1 min'], [120000, '2 min'], [300000, '5 min'], [600000, '10 min']];
    body.innerHTML = b + v + `<div class="sliderrow"><b>Screen timeout</b><div class="picks" style="justify-content:flex-start">${TO.map(([x, l]) => `<button class="chipbtn ${t.timeout === x ? 'is-active' : ''}" data-xtimeout="${x}">${l}</button>`).join('')}</div><span></span></div>`;
  } catch (e) { body.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
}
const send = STK.debounce(async (key, value, el) => { try { await STK.post('/toggle', { serial: STK.sel(), key, value }, { timeout: 30000 }); STK.flash(el, true); } catch (e) { STK.flash(el, false); STK.fail(e); } }, 300);

/* paste from PC and PC keyboard */
async function paste(btn) {
  if (!STK.sel()) return STK.toast('Connect a phone first.', 'bad');
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch (e) { return STK.toast('The browser blocked reading the clipboard. Allow it, or use the text box.', 'bad'); }
  if (!text) return STK.toast('The clipboard has no text.', 'bad');
  await STK.busy(btn, async () => { try { const r = await STK.post('/type', { serial: STK.sel(), text }); STK.toast(r.message); } catch (e) { STK.fail(e); } });
}
const kbd = { on: false, buf: '', timer: null, q: Promise.resolve(), warned: false };
const SPECIAL = { Enter: 'enter', Backspace: 'del', Tab: 'tab', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Escape: 'back' };
function flush() {
  const text = kbd.buf; kbd.buf = ''; clearTimeout(kbd.timer);
  if (!text) return kbd.q;
  kbd.q = kbd.q.then(() => STK.post('/type', { serial: STK.sel(), text })).catch(STK.fail);
  return kbd.q;
}
function onKey(e) {
  if (!kbd.on || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable || document.querySelector('dialog[open]')) return;
  if (!STK.sel()) return;
  if (SPECIAL[e.key]) { e.preventDefault(); flush(); const k = SPECIAL[e.key]; kbd.q = kbd.q.then(() => STK.post('/key', { serial: STK.sel(), key: k })).catch(STK.fail); return; }
  if (e.key.length === 1) {
    e.preventDefault();
    if (/['\\`]/.test(e.key) || !/^[\x20-\x7E]$/.test(e.key)) { if (!kbd.warned) { kbd.warned = true; STK.toast('Apostrophes, backslashes and non-English letters cannot be typed this way. Type those on the phone.', 'bad'); } return; }
    kbd.buf += e.key; clearTimeout(kbd.timer); kbd.timer = setTimeout(flush, 140);
  }
}
document.addEventListener('keydown', onKey, true);
function setKbd(on) { kbd.on = on; $('#hero').classList.toggle('kbd-on', on); if (!on) flush(); }

/* markers */
function markers() { return STK.kv.get('markers', {}); }
STK.markersFor = file => (markers()[file] || []);
STK.markRecording = function () {
  const r = STK.recording(); if (!r || !r.file) return STK.toast('Start a recording first, then drop markers.', 'bad');
  const secs = Math.max(0, Math.round((Date.now() - new Date(r.started).getTime()) / 1000));
  const all = { ...markers() }; all[r.file] = [...(all[r.file] || []), secs].slice(-60);
  const keys = Object.keys(all); if (keys.length > 80) delete all[keys[0]];
  STK.kv.set('markers', all);
  STK.toast('Marker at ' + STK.clock(new Date(Date.now() - secs * 1000)) + ' saved with this recording.');
};
function paintMarker() { const r = STK.recording(); const b = $('#marker-btn'); if (b) b.hidden = !r; }
$('#marker-btn').addEventListener('click', STK.markRecording);

/* events */
document.addEventListener('click', e => {
  const t = e.target.closest('button, summary'); if (!t || !box.contains(t) && t.id !== 'marker-btn') return;
  if (t.id === 'pin-add') return pinApp();
  if (t.dataset.pin) return open(t.dataset.pin, t);
  if (t.dataset.pinmore) {
    const p = t.dataset.pinmore;
    return STK.menu(t, [{ label: 'Open on the phone', icon: 'external', run: () => open(p) }, { label: 'Open and mirror just this app', icon: 'mirror', run: () => STK.startSession('mirror', null, { app: p }) }, '-', { label: 'Unpin', icon: 'x', run: () => { STK.kv.set('pins', pins().filter(x => x !== p)); render(); } }]);
  }
  if (t.dataset.xtimeout) return STK.post('/toggle', { serial: STK.sel(), key: 'timeout', value: Number(t.dataset.xtimeout) }).then(() => { $$('[data-xtimeout]').forEach(b => b.classList.toggle('is-active', b === t)); STK.flash(t, true); }).catch(STK.fail);
  if (t.id === 'paste-btn') return paste(t);
});
box.addEventListener('toggle', e => { if (e.target.id === 'xlevels' && e.target.open) loadLevels(); }, true);
box.addEventListener('input', e => {
  const s = e.target.closest('[data-xslide]'); if (!s) return;
  const key = s.dataset.xslide, v = Number(s.value), out = s.nextElementSibling;
  if (out) out.textContent = key === 'brightness' ? Math.round(v / 255 * 100) + '%' : v + '/' + s.max;
  send(key, v, s.closest('.sliderrow'));
});
box.addEventListener('change', e => { if (e.target.id === 'kbd-live') setKbd(e.target.checked); });
STK.on('kv', k => { if (k === 'pins' || k === '*') render(); });
STK.on('state', paintMarker);
STK.on('device-changed', () => { const d = $('#xlevels'); if (d && d.open) loadLevels(); });
render();
})();
