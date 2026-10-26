/* Phone tools: Inspect (screen layout tree) and Launch (intents, deep links, settings pages). */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const I = { nodes: [], img: '', w: 0, h: 0, sel: -1, filter: '', onlyClick: false, loading: false, err: '' };

/* ---------- inspect ---------- */
const box = () => $('#ptab-inspect');
STK.inspectShow = function () { paint(); };
function label(n) { return n.text || n.desc || n.id || n.cls; }
async function capture(btn) {
  const id = STK.sel(); if (!id) return;
  I.loading = true; I.err = ''; paint();
  try {
    const [tree, pic] = await Promise.all([
      STK.api('/inspect?id=' + encodeURIComponent(id), { timeout: 60000 }),
      fetch('/api/preview-image?id=' + encodeURIComponent(id) + '&maxAge=0&t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.blob() : Promise.reject(new Error('The phone picture could not be taken.')))
    ]);
    if (I.img) URL.revokeObjectURL(I.img);
    I.img = URL.createObjectURL(pic); I.nodes = tree.nodes; I.w = tree.width; I.h = tree.height; I.sel = -1;
  } catch (e) { I.err = e.message; }
  I.loading = false; paint();
}
function paint() {
  const el = box(); if (!el || state.view !== 'phone' || $('#ptab-inspect').hidden) return;
  if (!I.nodes.length) {
    return STK.setHtml(el, `<section class="panel"><header class="panel-head"><h2>Inspect the screen</h2></header><p class="hint lead">Shows every button, field and label on the phone screen right now, with its name, position and size. Useful for building macros, writing tests and finding where things are.</p>${I.err ? `<p class="alertline bad">${icon('alert')}<span>${esc(I.err)}</span></p>` : ''}<div class="row"><button class="btn primary" id="i-go" ${I.loading ? 'disabled' : ''}>${icon('eye', 'sm')}<span>${I.loading ? 'Reading the screen...' : 'Capture the screen'}</span></button><button class="btn" id="i-gif">${icon('image', 'sm')}<span>Record a GIF instead</span></button></div></section>`);
  }
  const f = I.filter.toLowerCase();
  const list = I.nodes.filter(n => (!I.onlyClick || n.click) && (!f || (n.text + ' ' + n.desc + ' ' + n.id + ' ' + n.cls).toLowerCase().includes(f)));
  const sel = I.nodes[I.sel];
  const boxes = I.nodes.map(n => `<i class="ibox ${n.i === I.sel ? 'sel' : ''} ${n.click ? 'click' : ''}" data-ib="${n.i}" style="left:${n.b[0] / I.w * 100}%;top:${n.b[1] / I.h * 100}%;width:${(n.b[2] - n.b[0]) / I.w * 100}%;height:${(n.b[3] - n.b[1]) / I.h * 100}%"></i>`).join('');
  STK.setHtml(el, `<div class="inspect"><section class="panel"><header class="panel-head"><h2>Screen</h2><div class="row tight"><button class="btn sm" id="i-go">${icon('refresh', 'sm')}<span>Capture again</span></button></div></header><div class="ipic" id="ipic"><img src="${I.img}" alt="Phone screen" draggable="false"><div class="ioverlay" id="ioverlay">${boxes}</div></div><p class="hint">Click an item on the picture to select it.</p></section>
  <section class="panel"><header class="panel-head"><h2>${sel ? 'Selected item' : 'Items'}</h2><span class="hint">${I.nodes.length} found</span></header>
    ${sel ? `<div class="idetail"><b>${esc(label(sel))}</b><dl><dt>Type</dt><dd>${esc(sel.cls)}</dd><dt>Id</dt><dd class="mono">${esc(sel.id || '-')}</dd><dt>Text</dt><dd>${esc(sel.text || '-')}</dd><dt>Description</dt><dd>${esc(sel.desc || '-')}</dd><dt>Bounds</dt><dd class="mono">[${sel.b.join(', ')}]</dd><dt>Centre</dt><dd class="mono">${cx(sel)}, ${cy(sel)}</dd><dt>App</dt><dd class="mono">${esc(sel.pkg)}</dd><dt>Can tap</dt><dd>${sel.click ? 'Yes' : 'No'}${sel.scroll ? ', scrolls' : ''}${sel.edit ? ', text field' : ''}</dd></dl>
      <div class="row wrap"><button class="btn sm primary" data-itap>${icon('tap', 'sm')}<span>Tap it on the phone</span></button><button class="btn sm" data-icopy="bounds">${icon('copy', 'sm')}<span>Copy bounds</span></button><button class="btn sm" data-icopy="centre">${icon('copy', 'sm')}<span>Copy centre</span></button>${sel.id ? `<button class="btn sm" data-icopy="id">${icon('copy', 'sm')}<span>Copy id</span></button>` : ''}<button class="btn sm ghost" data-iclear>Back to list</button></div></div>` : `<div class="row"><div class="search"><svg class="ic sm"><use href="#i-search"/></svg><input id="i-filter" type="search" placeholder="Filter by text or id" value="${esc(I.filter)}" autocomplete="off" aria-label="Filter items"></div><label class="chk inline"><input type="checkbox" id="i-click" ${I.onlyClick ? 'checked' : ''}><span>Only tappable</span></label></div>
      <div class="ilist">${list.slice(0, 250).map(n => `<button class="irow ${n.click ? 'click' : ''}" data-ii="${n.i}" style="padding-left:${10 + Math.min(n.d, 8) * 8}px"><b>${esc(label(n))}</b><small>${esc(n.cls)}${n.id ? ' · ' + esc(n.id) : ''}</small></button>`).join('') || '<p class="hint">No items match.</p>'}</div>`}
  </section></div>`);
  if (f && document.activeElement !== $('#i-filter') && state.view === 'phone') { /* keep typing focus */ }
}
const cx = n => Math.round((n.b[0] + n.b[2]) / 2), cy = n => Math.round((n.b[1] + n.b[3]) / 2);
function pick(e) {
  const r = $('#ioverlay').getBoundingClientRect(), x = (e.clientX - r.left) / r.width * I.w, y = (e.clientY - r.top) / r.height * I.h;
  let best = null, area = Infinity;
  for (const n of I.nodes) if (x >= n.b[0] && x <= n.b[2] && y >= n.b[1] && y <= n.b[3]) { const a = (n.b[2] - n.b[0]) * (n.b[3] - n.b[1]); if (a <= area) { area = a; best = n; } }
  return best;
}
document.addEventListener('click', async e => {
  const t = e.target.closest('#ptab-inspect button, #ptab-inspect .ioverlay'); if (!t) return;
  if (t.id === 'i-go') return capture(t);
  if (t.id === 'i-gif') return STK.gifCapture();
  if (t.id === 'ioverlay') { const n = pick(e); if (n) { I.sel = n.i; paint(); } return; }
  if (t.dataset.ii) { I.sel = Number(t.dataset.ii); return paint(); }
  if (t.dataset.iclear !== undefined) { I.sel = -1; return paint(); }
  const n = I.nodes[I.sel];
  if (t.dataset.itap !== undefined && n) return STK.busy(t, async () => { try { await STK.post('/tap', { serial: STK.sel(), x: cx(n), y: cy(n), holdMs: 0 }); STK.toast('Tapped ' + label(n) + '.'); } catch (er) { STK.fail(er); } });
  if (t.dataset.icopy && n) { const v = { bounds: '[' + n.b.join(',') + ']', centre: cx(n) + ',' + cy(n), id: n.id }[t.dataset.icopy]; return navigator.clipboard.writeText(v).then(() => STK.toast('Copied ' + v), () => STK.toast('The browser blocked copying.', 'bad')); }
});
document.addEventListener('input', e => { if (e.target.id === 'i-filter') { I.filter = e.target.value; const pos = e.target.selectionStart; paint(); const i = $('#i-filter'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } } });
document.addEventListener('change', e => { if (e.target.id === 'i-click') { I.onlyClick = e.target.checked; paint(); } });

/* ---------- launch ---------- */
const SETTINGS = [['Wi-Fi', 'WIFI_SETTINGS'], ['Bluetooth', 'BLUETOOTH_SETTINGS'], ['Display', 'DISPLAY_SETTINGS'], ['Sound', 'SOUND_SETTINGS'], ['Battery saver', 'BATTERY_SAVER_SETTINGS'], ['Accessibility', 'ACCESSIBILITY_SETTINGS'], ['Developer options', 'APPLICATION_DEVELOPMENT_SETTINGS'], ['All apps', 'MANAGE_ALL_APPLICATIONS_SETTINGS'], ['Storage', 'INTERNAL_STORAGE_SETTINGS'], ['Date and time', 'DATE_SETTINGS'], ['Language', 'LOCALE_SETTINGS'], ['Location', 'LOCATION_SOURCE_SETTINGS']];
const IP = [
  ['', 'Choose an example...', {}],
  ['link', 'Open a web link or deep link', { action: 'android.intent.action.VIEW', data: 'https://example.com' }],
  ['store', 'Open an app in the Play Store', { action: 'android.intent.action.VIEW', data: 'market://details?id=com.whatsapp' }],
  ['dial', 'Dial a number', { action: 'android.intent.action.DIAL', data: 'tel:+254700000000' }],
  ['map', 'Show a place on the map', { action: 'android.intent.action.VIEW', data: 'geo:0,0?q=Nairobi' }],
  ['appinfo', 'Open an app info page', { action: 'android.settings.APPLICATION_DETAILS_SETTINGS', data: 'package:com.android.chrome' }]
];
const hist = () => STK.kv.get('intents', []);
STK.launchShow = function () {
  const el = $('#ptab-launch');
  STK.setHtml(el, `<div class="two"><div class="col"><section class="panel"><header class="panel-head"><h2>Open a link or intent</h2></header>
    <p class="hint lead">Send a link, deep link or Android intent straight to the phone.</p>
    <label class="ff"><span>Example</span><select id="l-preset">${IP.map(p => `<option value="${p[0]}">${esc(p[1])}</option>`).join('')}</select></label>
    <div class="formgrid inline"><label class="ff"><span>Action</span><input id="l-action" placeholder="android.intent.action.VIEW" autocomplete="off" spellcheck="false"></label><label class="ff"><span>Data / link</span><input id="l-data" placeholder="https://..." autocomplete="off" spellcheck="false"></label>
    <label class="ff"><span>App (package)</span><input id="l-pkg" placeholder="optional" autocomplete="off" spellcheck="false"></label><label class="ff"><span>Component</span><input id="l-comp" placeholder="optional, com.app/.Activity" autocomplete="off" spellcheck="false"></label></div>
    <div class="row"><button class="btn primary" id="l-send">${icon('send', 'sm')}<span>Send to phone</span></button><button class="btn" id="l-copy">${icon('copy', 'sm')}<span>Copy adb command</span></button></div></section>
    <section class="panel"><header class="panel-head"><h2>Recent</h2></header>${hist().length ? hist().map((h, i) => `<button class="irow" data-lh="${i}"><b>${esc(h.action || h.data || h.component)}</b><small>${esc(h.data || '')}</small></button>`).join('') : '<p class="hint">Nothing sent yet.</p>'}</section></div>
    <div class="col"><section class="panel"><header class="panel-head"><h2>Phone settings pages</h2></header><div class="setgrid">${SETTINGS.map(([l, a]) => `<button class="btn" data-lset="${a}">${esc(l)}</button>`).join('')}</div></section></div></div>`);
};
const val = id => $('#' + id).value.trim();
const body = () => ({ serial: STK.sel(), action: val('l-action'), data: val('l-data'), package: val('l-pkg'), component: val('l-comp') });
document.addEventListener('change', e => {
  if (e.target.id !== 'l-preset') return; const p = IP.find(x => x[0] === e.target.value); if (!p) return;
  $('#l-action').value = p[2].action || ''; $('#l-data').value = p[2].data || ''; $('#l-pkg').value = ''; $('#l-comp').value = '';
});
document.addEventListener('click', async e => {
  const t = e.target.closest('#ptab-launch button'); if (!t) return;
  if (!STK.sel()) return STK.toast('Connect a phone first.', 'bad');
  if (t.id === 'l-send') return STK.busy(t, async () => {
    try { const b = body(); await STK.post('/intent', b, { timeout: 30000 }); STK.toast('Sent to the phone.'); const h = [b, ...hist().filter(x => x.action !== b.action || x.data !== b.data)].slice(0, 8); STK.kv.set('intents', h.map(({ serial, ...r }) => r)); STK.launchShow(); $('#l-action').value = b.action; $('#l-data').value = b.data; } catch (er) { STK.fail(er); }
  });
  if (t.id === 'l-copy') { const b = body(); const parts = ['adb shell am start']; if (b.action) parts.push('-a ' + b.action); if (b.data) parts.push(`-d '${b.data}'`); if (b.component) parts.push('-n ' + b.component); if (b.package) parts.push('-p ' + b.package); return navigator.clipboard.writeText(parts.join(' ')).then(() => STK.toast('Command copied.'), () => STK.toast('The browser blocked copying.', 'bad')); }
  if (t.dataset.lset) return STK.post('/intent', { serial: STK.sel(), action: 'android.settings.' + t.dataset.lset }).then(() => STK.flash(t, true)).catch(er => { STK.flash(t, false); STK.fail(er); });
  if (t.dataset.lh) { const h = hist()[Number(t.dataset.lh)]; $('#l-action').value = h.action || ''; $('#l-data').value = h.data || ''; $('#l-pkg').value = h.package || ''; $('#l-comp').value = h.component || ''; }
});
STK.on('device-changed', () => { I.nodes = []; I.sel = -1; });
})();
