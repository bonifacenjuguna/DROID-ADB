/* Phone tools: quick settings, apps, files, log, shell. */
(() => {
'use strict';
const { $, $$, esc, icon, bytes, state } = STK;
const P = { tab: STK.store.get('ptab', 'quick'), running: null, runScope: 'user', runFilter: '', runTimer: null, toggles: null, apps: null, scope: 'user', appFilter: '', path: '/sdcard/', files: null, log: { level: 'I', filter: '', lines: [], timer: null }, hist: STK.store.get('shell-hist', []), shell: [] };

const TOG = [
  ['wifi', 'Wi-Fi', 'wifi'], ['data', 'Mobile data', 'globe'], ['bluetooth', 'Bluetooth', 'link'], ['airplane', 'Airplane mode', 'bolt'],
  ['rotation', 'Auto-rotate', 'refresh'], ['dark', 'Dark mode', 'sun-moon'], ['dnd', 'Do not disturb', 'bell'], ['stayawake', 'Stay awake while charging', 'bolt'],
  ['touches', 'Show touches', 'tap'], ['pointer', 'Pointer location', 'tap'], ['animations', 'Animations', 'sparkle'], ['autobrightness', 'Auto brightness', 'sun-moon']
];
const TIMEOUTS = [[15000, '15 s'], [30000, '30 s'], [60000, '1 min'], [120000, '2 min'], [300000, '5 min'], [600000, '10 min'], [1800000, '30 min']];

const serial = () => STK.sel();
function guard() {
  const has = !!serial();
  $('#phone-nodev').hidden = has;
  $$('.ptab').forEach(t => t.hidden = !has || t.id !== 'ptab-' + P.tab);
  return has;
}
const nice = pkg => {
  const parts = String(pkg).split('.').filter(Boolean);
  let w = parts.pop() || pkg;
  while (['app', 'android', 'mobile', 'main', 'client', 'free', 'lite', 'release'].includes(w.toLowerCase()) && parts.length) w = parts.pop();
  w = w.replace(/_/g, ' ');
  return w.charAt(0).toUpperCase() + w.slice(1);
};
function setTab(name) {
  if (!['quick', 'apps', 'running', 'files', 'logcat', 'shell'].includes(name)) name = 'quick';
  P.tab = name; STK.store.set('ptab', name);
  $$('[data-ptab]').forEach(b => { const on = b.dataset.ptab === name; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); });
  if (name !== 'logcat') stopLog();
  if (name !== 'running') stopRun();
  if (!guard()) return;
  ({ quick: loadQuick, apps: loadApps, running: loadRunning, files: loadFiles, logcat: loadLog, shell: renderShell }[name])();
}

/* ---------- quick settings ---------- */
const quickBox = () => $('#ptab-quick');
async function loadQuick() {
  const id = serial();
  if (!P.toggles) STK.setHtml(quickBox(), '<div class="panel"><p class="hint">Reading the phone settings...</p></div>');
  try { P.toggles = await STK.api('/toggles?id=' + encodeURIComponent(id), { timeout: 30000 }); P.togglesFor = id; } catch (e) { if (!P.toggles) STK.setHtml(quickBox(), `<div class="panel"><div class="empty">${icon('alert')}<b>Could not read the phone</b><p>${esc(e.message)}</p><button class="btn" id="quick-retry">Try again</button></div></div>`); else STK.fail(e); return; }
  if (state.view === 'phone' && P.tab === 'quick') renderQuick();
}
function renderQuick() {
  const t = P.toggles, on = t.toggles || {};
  const tiles = TOG.map(([k, label, ic]) => `<div class="tg ${on[k] ? 'on' : ''}" data-tile="${k}"><span class="badge">${icon(ic)}</span><div><b>${esc(label)}</b><small>${on[k] ? 'On' : 'Off'}</small></div><label class="switch" title="${esc(label)}"><input type="checkbox" data-tog="${k}" ${on[k] ? 'checked' : ''} aria-label="${esc(label)}"><i></i></label></div>`).join('');
  const bright = t.brightness >= 0 ? `<div class="sliderrow"><b>Brightness</b><input type="range" min="1" max="255" value="${t.brightness}" data-slide="brightness" aria-label="Brightness"><output>${Math.round(t.brightness / 255 * 100)}%</output></div>` : '';
  const vol = t.volume !== null && t.volumeMax ? `<div class="sliderrow"><b>Media volume</b><input type="range" min="0" max="${t.volumeMax}" value="${t.volume}" data-slide="volume" aria-label="Media volume"><output>${t.volume}/${t.volumeMax}</output></div>` : '';
  const to = `<div class="sliderrow"><b>Screen timeout</b><div class="picks" style="justify-content:flex-start">${TIMEOUTS.map(([v, l]) => `<button class="chipbtn ${t.timeout === v ? 'is-active' : ''}" data-timeout="${v}">${l}</button>`).join('')}</div><span></span></div>`;
  STK.setHtml(quickBox(), `<section class="panel"><header class="panel-head"><h2>Quick settings</h2><button class="btn sm" id="quick-refresh">${icon('refresh', 'sm')}<span>Refresh</span></button></header><div class="togglegrid">${tiles}</div></section>
  <section class="panel"><header class="panel-head"><h2>Levels</h2></header>${bright}${vol}${to}</section>`);
}
async function setToggle(input) {
  const key = input.dataset.tog, want = input.checked, tile = input.closest('.tg');
  tile.classList.add('pending'); tile.classList.toggle('on', want); $('small', tile).textContent = want ? 'On' : 'Off';
  input.disabled = true;
  try {
    const r = await STK.post('/toggle', { serial: serial(), key, value: want }, { timeout: 30000 });
    P.toggles = r; STK.flash(tile, true);
  } catch (e) {
    input.checked = !want; tile.classList.toggle('on', !want); $('small', tile).textContent = !want ? 'On' : 'Off';
    STK.flash(tile, false); STK.fail(e);
  } finally { tile.classList.remove('pending'); input.disabled = false; }
}
const slideSend = STK.debounce(async (key, value, el) => {
  try { await STK.post('/toggle', { serial: serial(), key, value }, { timeout: 30000 }); P.toggles[key] = value; STK.flash(el, true); } catch (e) { STK.flash(el, false); STK.fail(e); }
}, 350);

/* ---------- apps ---------- */
async function loadApps(force) {
  const box = $('#ptab-apps');
  if (!P.apps || force || P.appsFor !== serial() || P.appsScope !== P.scope) {
    STK.setHtml(box, '<div class="panel"><p class="hint">Loading apps...</p></div>');
    try {
      const url = `/apps?id=${encodeURIComponent(serial())}&scope=${P.scope}`; let r;
      try { r = await STK.api(url, { timeout: 60000 }); } catch (e1) { await STK.sleep(900); r = await STK.api(url, { timeout: 60000 }); }
      P.apps = r.apps; P.appsNote = r.note || ''; P.appsFor = serial(); P.appsScope = P.scope; }
    catch (e) { STK.setHtml(box, `<div class="panel"><div class="empty">${icon('alert')}<b>Could not list apps</b><p>${esc(e.message)}</p><div class="row"><button class="btn primary" id="app-retry">Try again</button><button class="btn" data-ptab="shell">Open shell</button></div><p class="hint">Tip: unlock the phone and check that USB debugging is still authorized.</p></div></div>`); return; }
  }
  renderApps();
}
function renderApps() {
  const box = $('#ptab-apps');
  if (!$('#app-filter', box)) {
    STK.setHtml(box, `<section class="panel"><header class="panel-head"><h2>Apps</h2><div class="row tight"><div class="seg mini" id="app-scope"><button data-scope="user">Installed</button><button data-scope="system">System</button><button data-scope="all">All</button></div><button class="btn sm" id="app-reload">${icon('refresh', 'sm')}<span>Reload</span></button></div></header>
    <div class="row"><div class="search"><svg class="ic sm"><use href="#i-search"/></svg><input id="app-filter" type="search" placeholder="Filter by package name" autocomplete="off" aria-label="Filter apps"></div><label class="btn" for="apk-file">${icon('upload', 'sm')}<span>Install APK</span></label><input id="apk-file" type="file" accept=".apk" hidden></div>
    <div class="progress" id="apk-progress" hidden><i></i></div><p class="hint" id="app-count"></p><div class="applist" id="app-list"></div></section>`);
    $('#app-filter').value = P.appFilter;
  }
  $$('#app-scope button').forEach(b => b.classList.toggle('is-active', b.dataset.scope === P.scope));
  const f = P.appFilter.toLowerCase();
  const list = P.apps.filter(a => a.package.toLowerCase().includes(f));
  $('#app-count').textContent = P.appsNote || `${list.length} of ${P.apps.length} apps`;
  if (!P.apps.length) {
    STK.setHtml($('#app-list'), `<div class="empty">${icon('alert')}<b>The phone returned no apps</b><p>${esc(P.appsNote || 'Try the All tab, unlock the phone, and check that USB debugging is still authorized.')}</p><button class="btn primary" id="app-retry">Try again</button></div>`);
    return;
  }
  STK.setHtml($('#app-list'), list.slice(0, 300).map(a => `<div class="approw"><div><b>${esc(nice(a.package))}${a.disabled ? '<span class="pill warn">Disabled</span>' : ''}</b><small>${esc(a.package)}</small></div><div class="row tight"><button class="btn sm" data-app="launch" data-pkg="${esc(a.package)}">Open</button><button class="btn sm" data-app="mirrorapp" data-pkg="${esc(a.package)}" title="Mirror only this app in its own window">Mirror app</button><button class="icon-btn" data-app="more" data-pkg="${esc(a.package)}" data-dis="${a.disabled ? 1 : 0}" aria-label="More actions for ${esc(a.package)}">${icon('more')}</button></div></div>`).join('') + (list.length > 300 ? '<p class="hint">Showing the first 300. Narrow the filter to see more.</p>' : '') || '<p class="hint">No apps match.</p>');
}
async function appAction(pkg, action, btn, extra) {
  const run = async () => {
    try { const r = await STK.post('/app', { serial: serial(), package: pkg, action }, { timeout: 90000 }); return r; } catch (e) { STK.fail(e); return null; }
  };
  const r = await (btn ? STK.busy(btn, run) : run());
  if (!r) return null;
  if (action === 'info') { STK.showText(pkg, Object.entries(r.info || {}).map(([k, v]) => k + ': ' + v).join('\n') || 'No details available.'); return r; }
  STK.toast(r.message || 'Done.');
  if (['uninstall', 'disable', 'enable'].includes(action) && P.tab === 'apps') loadApps(true);
  if (P.tab === 'running' && ['stop', 'clear', 'uninstall', 'disable', 'launch'].includes(action)) setTimeout(() => loadRunning(true), action === 'launch' ? 900 : 300);
  if (action === 'pullapk' && r.folder) STK.toast('Saved. Open the downloads folder to find it.', 'ok', { label: 'Open', run: () => STK.post('/open-folder', { kind: 'downloads' }).catch(STK.fail) });
  return r;
}
function appMenu(btn) {
  const pkg = btn.dataset.pkg, dis = btn.dataset.dis === '1';
  STK.menu(btn, [
    { label: 'Stop app', icon: 'stop', run: () => appAction(pkg, 'stop') },
    { label: 'Copy package name', icon: 'copy', run: () => navigator.clipboard.writeText(pkg).then(() => STK.toast('Copied ' + pkg), () => STK.toast('Copy was blocked by the browser.', 'bad')) },
    { label: 'App info', icon: 'info', run: () => appAction(pkg, 'info') },
    { label: 'Open its settings on phone', icon: 'sliders', run: () => appAction(pkg, 'settings') },
    { label: 'Save APK to this PC', icon: 'download', run: () => appAction(pkg, 'pullapk') },
    { label: dis ? 'Enable' : 'Disable', icon: 'power', run: () => appAction(pkg, dis ? 'enable' : 'disable') },
    '-',
    { label: 'Clear data', icon: 'trash', danger: true, run: async () => { if (await STK.confirm('Clear app data?', `<p>All data of <b>${esc(pkg)}</b> (logins, settings, saves) will be erased.</p>`, 'Clear data')) appAction(pkg, 'clear'); } },
    { label: 'Uninstall', icon: 'trash', danger: true, run: async () => { if (await STK.confirm('Uninstall this app?', `<p><b>${esc(pkg)}</b> will be removed from the phone.</p>`, 'Uninstall')) appAction(pkg, 'uninstall'); } }
  ]);
}
async function installApk(file) {
  if (!file) return;
  if (!/\.apk$/i.test(file.name)) return STK.toast('Choose an .apk file.', 'bad');
  const bar = $('#apk-progress'); bar.hidden = false;
  try {
    const r = await STK.upload(`/install?id=${encodeURIComponent(serial())}&name=${encodeURIComponent(file.name)}`, file, p => { $('i', bar).style.width = (p * 100).toFixed(0) + '%'; });
    STK.toast(r.message || 'Installed.'); loadApps(true);
  } catch (e) { STK.fail(e); } finally { bar.hidden = true; $('i', bar).style.width = '0'; $('#apk-file').value = ''; }
}

/* ---------- running apps ---------- */
function stopRun() { clearInterval(P.runTimer); P.runTimer = null; }
async function loadRunning(force) {
  const box = $('#ptab-running');
  if (!$('#run-list', box)) STK.setHtml(box, '<div class="panel"><p class="hint">Reading running apps...</p></div>');
  try { P.running = await STK.api(`/running?id=${encodeURIComponent(serial())}&scope=${P.runScope}`, { timeout: 40000 }); P.runErr = ''; }
  catch (e) { P.runErr = e.message; if (!P.running) { STK.setHtml(box, `<div class="panel"><div class="empty">${icon('alert')}<b>Could not read running apps</b><p>${esc(e.message)}</p><button class="btn primary" id="run-retry">Try again</button></div></div>`); return; } }
  renderRunning();
  if (!P.runTimer && $('#run-auto') && $('#run-auto').checked) P.runTimer = setInterval(() => { if (state.view === 'phone' && P.tab === 'running' && !document.hidden) loadRunning(); }, 5000);
}
function renderRunning() {
  const box = $('#ptab-running'), r = P.running;
  if (!$('#run-list', box)) {
    STK.setHtml(box, `<section class="panel"><header class="panel-head"><h2>Running apps</h2><div class="row tight"><div class="seg mini" id="run-scope"><button data-rscope="user">Apps</button><button data-rscope="all">Include system</button></div><label class="row tight hint" style="gap:8px">Auto refresh <span class="switch sm"><input type="checkbox" id="run-auto" aria-label="Auto refresh" ${STK.store.get('run-auto', true) ? 'checked' : ''}><i></i></span></label><button class="btn sm" id="run-reload">${icon('refresh', 'sm')}<span>Refresh</span></button></div></header>
    <div id="run-front"></div><div class="row"><div class="search"><svg class="ic sm"><use href="#i-search"/></svg><input id="run-filter" type="search" placeholder="Filter running apps" autocomplete="off" aria-label="Filter running apps"></div></div>
    <p class="hint" id="run-count"></p><div id="run-list"></div><p class="hint">Memory is what the phone reports for each app's processes. Stop uses force-stop, so the app closes until you open it again.</p></section>`);
    $('#run-filter').value = P.runFilter;
  }
  $$('#run-scope button').forEach(b => b.classList.toggle('is-active', b.dataset.rscope === P.runScope));
  const fg = r.foreground && r.foreground.package;
  STK.setHtml($('#run-front'), fg ? `<div class="runhead">${icon('phone')}<div class="grow"><small>In front right now</small><b>${esc(nice(fg))}</b><small>${esc(fg)}${r.foreground.activity ? ' / ' + esc(r.foreground.activity) : ''}</small></div><button class="btn sm" data-app="mirrorapp" data-pkg="${esc(fg)}">Mirror app</button><button class="btn sm danger" data-app="stop" data-pkg="${esc(fg)}">Stop</button></div>` : '');
  const f = P.runFilter.toLowerCase();
  const list = r.apps.filter(a => a.package.toLowerCase().includes(f) || nice(a.package).toLowerCase().includes(f));
  const max = Math.max(1, ...r.apps.map(a => a.rssKb));
  $('#run-count').textContent = `${list.length} of ${r.total} running`;
  STK.setHtml($('#run-list'), list.map(a => `<div class="runrow"><div><b>${esc(nice(a.package))}${a.foreground ? '<span class="pill ok">In front</span>' : ''}${a.recent >= 0 && !a.foreground ? `<span class="pill">Recent ${a.recent + 1}</span>` : ''}${a.user ? '' : '<span class="pill">System</span>'}</b><small>${esc(a.package)} · pid ${a.pid}${a.procs > 1 ? ' · ' + a.procs + ' processes' : ''}</small></div><div class="mem"><span>${bytes(a.rssKb * 1024)}</span><i style="--w:${Math.max(3, a.rssKb / max * 100).toFixed(0)}%"></i></div><div class="row tight"><button class="btn sm" data-app="launch" data-pkg="${esc(a.package)}">Open</button><button class="btn sm danger" data-app="stop" data-pkg="${esc(a.package)}">Stop</button><button class="icon-btn" data-app="more" data-pkg="${esc(a.package)}" data-dis="0" aria-label="More actions for ${esc(a.package)}">${icon('more')}</button></div></div>`).join('') || '<p class="hint">Nothing matches.</p>');
}

/* ---------- files ---------- */
async function loadFiles(path) {
  if (typeof path === 'string') P.path = path;
  const box = $('#ptab-files');
  if (!$('#file-list', box)) STK.setHtml(box, '<div class="panel"><p class="hint">Loading...</p></div>');
  try { P.files = await STK.api(`/files?id=${encodeURIComponent(serial())}&path=${encodeURIComponent(P.path)}`, { timeout: 40000 }); }
  catch (e) { STK.fail(e); if (!P.files) { STK.setHtml(box, `<div class="panel"><div class="empty">${icon('alert')}<b>Could not read the folder</b><p>${esc(e.message)}</p><button class="btn" id="files-home">Go to /sdcard/</button></div></div>`); return; } }
  P.path = P.files.path;
  renderFiles();
}
function renderFiles() {
  const box = $('#ptab-files'), f = P.files;
  const parts = f.path.split('/').filter(Boolean);
  let acc = '/';
  const crumbs = `<button data-go="/">/</button>` + parts.map(p => { acc += p + '/'; return `<span>/</span><button data-go="${esc(acc)}">${esc(p)}</button>`; }).join('');
  const rows = f.entries.map(e => `<div class="filerow"><span>${icon(e.dir ? 'folder' : 'file', 'sm')}</span><button class="nm ${e.dir ? 'dir' : ''}" ${e.dir ? `data-open="${esc(e.name)}"` : `data-pull="${esc(e.name)}" title="Copy to this PC"`}>${esc(e.name)}</button><span class="meta">${e.dir ? '' : bytes(e.size)}</span><span class="meta">${esc(e.modified)}</span><button class="icon-btn" data-fmore="${esc(e.name)}" data-isdir="${e.dir ? 1 : 0}" aria-label="Actions for ${esc(e.name)}">${icon('more')}</button></div>`).join('');
  STK.setHtml(box, `<section class="panel"><header class="panel-head"><h2>Phone files</h2><div class="row tight"><button class="btn sm" id="files-up" ${f.parent ? '' : 'disabled'}>${icon('up', 'sm')}<span>Up</span></button><button class="btn sm" id="files-mkdir">${icon('folder', 'sm')}<span>New folder</span></button><button class="btn sm" id="files-reload">${icon('refresh', 'sm')}<span>Reload</span></button></div></header>
  <div class="crumbs" aria-label="Current folder">${crumbs}</div>
  <div class="dropzone" id="drop">${icon('upload')}<b>Drop files here to send them to this folder</b><label class="btn sm" for="push-file">Choose files</label><input type="file" id="push-file" multiple hidden></div>
  <div class="progress" id="push-progress" hidden><i></i></div>
  <div id="file-list">${rows || '<p class="hint">This folder is empty.</p>'}</div>
  <p class="hint">Click a file to copy it to this PC. Changes (new folder, rename, delete) work inside /sdcard only.</p></section>`);
}
async function pushFiles(list) {
  const bar = $('#push-progress');
  for (const file of list) {
    bar.hidden = false;
    try { await STK.upload(`/files/push?id=${encodeURIComponent(serial())}&name=${encodeURIComponent(file.name)}&dest=${encodeURIComponent(P.path)}`, file, p => { $('i', bar).style.width = (p * 100).toFixed(0) + '%'; }); STK.toast('Sent ' + file.name + '.'); }
    catch (e) { STK.fail(e); }
  }
  loadFiles();
}
const fileOp = (op, path, extra = {}) => STK.post('/files/op', { serial: serial(), op, path, ...extra }, { timeout: 40000 });

/* ---------- log ---------- */
function stopLog() { clearInterval(P.log.timer); P.log.timer = null; }
function loadLog() {
  const box = $('#ptab-logcat');
  if (!$('#log-view', box)) {
    STK.setHtml(box, `<section class="panel"><header class="panel-head"><h2>Phone log</h2><div class="row tight"><label class="row tight hint" style="gap:8px">Auto refresh <span class="switch sm"><input type="checkbox" id="log-auto" aria-label="Auto refresh"><i></i></span></label><button class="btn sm" id="log-refresh">${icon('refresh', 'sm')}<span>Refresh</span></button><button class="btn sm" id="log-copy">${icon('copy', 'sm')}<span>Copy</span></button><button class="btn sm" id="log-save">${icon('download', 'sm')}<span>Save</span></button><button class="btn sm danger" id="log-clear">${icon('trash', 'sm')}<span>Clear</span></button></div></header>
    <div class="row"><div class="seg mini" id="log-level">${['V', 'D', 'I', 'W', 'E'].map(l => `<button data-level="${l}">${l}</button>`).join('')}</div><div class="search"><svg class="ic sm"><use href="#i-search"/></svg><input id="log-filter" type="search" placeholder="Filter text" autocomplete="off" aria-label="Filter log"></div></div>
    <pre class="logview" id="log-view" tabindex="0"></pre><p class="hint" id="log-note"></p></section>`);
    $('#log-filter').value = P.log.filter;
  }
  $$('#log-level button').forEach(b => b.classList.toggle('is-active', b.dataset.level === P.log.level));
  fetchLog();
}
async function fetchLog(btn) {
  const run = async () => {
    try {
      const r = await STK.api(`/logcat?id=${encodeURIComponent(serial())}&level=${P.log.level}&lines=600&filter=${encodeURIComponent(P.log.filter)}`, { timeout: 40000 });
      P.log.lines = r.lines;
      const v = $('#log-view'); if (!v) return;
      const atEnd = v.scrollTop + v.clientHeight >= v.scrollHeight - 30;
      STK.setHtml(v, r.lines.map(l => { const m = l.match(/^\S+\s+\S+\s+([VDIWEF])\//) || l.match(/^\S+\s+([VDIWEF])\//); return `<div class="${m ? m[1] : ''}">${esc(l)}</div>`; }).join('') || '<div class="D">No log lines match.</div>');
      $('#log-note').textContent = r.count + ' lines';
      if (atEnd || !v.dataset.seen) { v.scrollTop = v.scrollHeight; v.dataset.seen = '1'; }
    } catch (e) { if (!e.network) STK.fail(e); }
  };
  return btn ? STK.busy(btn, run) : run();
}

/* ---------- shell ---------- */
const CHIPS = [['Battery', 'dumpsys battery'], ['Storage', 'df -h /sdcard'], ['Memory', 'cat /proc/meminfo | head -n 6'], ['Uptime', 'uptime'], ['Screen', 'wm size; wm density'], ['IP address', 'ip -f inet addr show wlan0'], ['Top apps', 'dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity"'], ['Properties', 'getprop | head -n 40']];
function renderShell() {
  const box = $('#ptab-shell');
  if (!$('#shell-out', box)) {
    STK.setHtml(box, `<section class="panel"><header class="panel-head"><h2>Shell</h2><div class="row tight"><button class="btn sm" id="shell-copy">${icon('copy', 'sm')}<span>Copy output</span></button><button class="btn sm" id="shell-clear">Clear</button></div></header>
    <p class="hint lead">Runs one adb shell command at a time on the selected phone. Interactive programs such as top without -n 1 will time out.</p>
    <pre class="shellout" id="shell-out" tabindex="0"></pre>
    <div class="typebar">${icon('terminal', 'sm')}<input id="shell-input" type="text" placeholder="Type a command and press Enter" autocomplete="off" spellcheck="false" maxlength="1000" aria-label="Shell command"><button class="btn sm primary" id="shell-run">${icon('send', 'sm')}<span>Run</span></button></div>
    <div class="chiprow">${CHIPS.map(([l, c]) => `<button class="chipbtn" data-chip="${esc(c)}">${esc(l)}</button>`).join('')}</div></section>`);
    paintShell();
  }
}
function paintShell() {
  const o = $('#shell-out'); if (!o) return;
  STK.setHtml(o, P.shell.map(x => `<div class="cmd">$ ${esc(x.cmd)}</div>${x.out ? `<div>${esc(x.out)}</div>` : ''}${x.err ? `<div class="err">${esc(x.err)}</div>` : ''}`).join('') || '<div class="hint">Output appears here.</div>');
  o.scrollTop = o.scrollHeight;
}
async function runShell(cmd, btn) {
  cmd = (cmd || '').trim(); if (!cmd) return;
  P.hist = [cmd, ...P.hist.filter(h => h !== cmd)].slice(0, 30); STK.store.set('shell-hist', P.hist); P.histIdx = -1;
  const entry = { cmd, out: 'Running...', err: '' }; P.shell.push(entry); if (P.shell.length > 60) P.shell.shift(); paintShell();
  try { const r = await STK.post('/shell', { serial: serial(), command: cmd, timeout: 60 }, { timeout: 80000 }); entry.out = (r.out || '').trimEnd(); entry.err = (r.err || '').trimEnd(); if (!entry.out && !entry.err) entry.out = r.code === 0 ? '(no output)' : '(exit code ' + r.code + ')'; }
  catch (e) { entry.out = ''; entry.err = e.message; }
  paintShell();
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t || !$('#view-phone').contains(t)) return;
  if (t.dataset.ptab) return setTab(t.dataset.ptab);
  if (t.id === 'quick-refresh' || t.id === 'quick-retry') return STK.busy(t, loadQuick);
  if (t.dataset.timeout) { const v = Number(t.dataset.timeout); const prev = P.toggles.timeout; P.toggles.timeout = v; renderQuick(); return STK.post('/toggle', { serial: serial(), key: 'timeout', value: v }, { timeout: 30000 }).then(() => STK.toast('Screen timeout set.')).catch(er => { P.toggles.timeout = prev; renderQuick(); STK.fail(er); }); }
  if (t.dataset.scope) { P.scope = t.dataset.scope; return loadApps(true); }
  if (t.id === 'app-reload') return STK.busy(t, () => loadApps(true));
  if (t.id === 'app-retry') return loadApps(true);
  if (t.id === 'run-retry' || t.id === 'run-reload') return STK.busy(t, () => loadRunning(true));
  if (t.dataset.rscope) { P.runScope = t.dataset.rscope; return loadRunning(true); }
  if (t.dataset.app === 'stop') return appAction(t.dataset.pkg, 'stop', t);
  if (t.dataset.app === 'launch') return appAction(t.dataset.pkg, 'launch', t);
  if (t.dataset.app === 'mirrorapp') return STK.startSession('mirror', t, { app: t.dataset.pkg });
  if (t.dataset.app === 'more') return appMenu(t);
  if (t.dataset.go) return loadFiles(t.dataset.go);
  if (t.dataset.open) return loadFiles(P.path + t.dataset.open + '/');
  if (t.id === 'files-up') return loadFiles(P.files.parent);
  if (t.id === 'files-home') return loadFiles('/sdcard/');
  if (t.id === 'files-reload') return STK.busy(t, () => loadFiles());
  if (t.id === 'files-mkdir') return STK.prompt('New folder', 'Folder name', '', 'Create').then(async v => { if (!v) return; try { await fileOp('mkdir', P.path + v); loadFiles(); } catch (er) { STK.fail(er); } });
  if (t.dataset.pull) return STK.busy(t, async () => { try { const r = await STK.post('/files/pull', { serial: serial(), path: P.path + t.dataset.pull }, { timeout: 620000 }); STK.toast(r.message, 'ok', { label: 'Open folder', run: () => STK.post('/open-folder', { kind: 'downloads' }).catch(STK.fail) }); } catch (er) { STK.fail(er); } });
  if (t.dataset.fmore) {
    const n = t.dataset.fmore, isDir = t.dataset.isdir === '1', full = P.path + n;
    return STK.menu(t, [
      ...(isDir ? [] : [{ label: 'Copy to this PC', icon: 'download', run: () => STK.post('/files/pull', { serial: serial(), path: full }, { timeout: 620000 }).then(r => STK.toast(r.message)).catch(STK.fail) }]),
      { label: 'Rename', icon: 'pencil', run: async () => { const v = await STK.prompt('Rename', 'New name', n, 'Rename'); if (v && v !== n) fileOp('rename', full, { to: v }).then(() => loadFiles()).catch(STK.fail); } },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, run: async () => { if (await STK.confirm('Delete from the phone?', `<p><b>${esc(n)}</b>${isDir ? ' and everything in it' : ''} will be removed permanently.</p>`)) fileOp('delete', full).then(() => { STK.toast('Deleted.'); loadFiles(); }).catch(STK.fail); } }
    ]);
  }
  if (t.dataset.level) { P.log.level = t.dataset.level; $$('#log-level button').forEach(b => b.classList.toggle('is-active', b === t)); return fetchLog(); }
  if (t.id === 'log-refresh') return fetchLog(t);
  if (t.id === 'log-copy') return navigator.clipboard.writeText(P.log.lines.join('\n')).then(() => STK.toast('Log copied.'), () => STK.toast('Copy was blocked by the browser.', 'bad'));
  if (t.id === 'log-save') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([P.log.lines.join('\n')], { type: 'text/plain' })); a.download = 'phone-log.txt'; a.click(); return setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  if (t.id === 'log-clear') return STK.busy(t, async () => { try { await STK.post('/logcat/clear', { serial: serial() }); STK.toast('Phone log cleared.'); fetchLog(); } catch (er) { STK.fail(er); } });
  if (t.dataset.chip) { const i = $('#shell-input'); i.value = t.dataset.chip; return runShell(t.dataset.chip); }
  if (t.id === 'shell-run') return runShell($('#shell-input').value).then(() => { $('#shell-input').value = ''; });
  if (t.id === 'shell-clear') { P.shell = []; return paintShell(); }
  if (t.id === 'shell-copy') return navigator.clipboard.writeText($('#shell-out').textContent).then(() => STK.toast('Output copied.'), () => STK.toast('Copy was blocked by the browser.', 'bad'));
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset && t.dataset.tog) return setToggle(t);
  if (t.id === 'apk-file') return installApk(t.files[0]);
  if (t.id === 'push-file') return pushFiles([...t.files]);
  if (t.id === 'run-auto') { STK.store.set('run-auto', t.checked); stopRun(); if (t.checked) loadRunning(); return; }
  if (t.id === 'log-auto') { stopLog(); if (t.checked) P.log.timer = setInterval(() => { if (state.view === 'phone' && P.tab === 'logcat' && !document.hidden) fetchLog(); }, 3000); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset && t.dataset.slide) { const v = Number(t.value); const out = t.nextElementSibling; out.textContent = t.dataset.slide === 'brightness' ? Math.round(v / 255 * 100) + '%' : v + '/' + t.max; return slideSend(t.dataset.slide, v, t.closest('.sliderrow')); }
  if (t.id === 'run-filter') { P.runFilter = t.value; if (P.running) renderRunning(); }
  if (t.id === 'app-filter') { P.appFilter = t.value; if (P.apps) renderApps(); }
  if (t.id === 'log-filter') { P.log.filter = t.value; clearTimeout(P.logT); P.logT = setTimeout(fetchLog, 400); }
});
document.addEventListener('keydown', e => {
  if (e.target.id !== 'shell-input') return;
  if (e.key === 'Enter') { const v = e.target.value; e.target.value = ''; runShell(v); }
  if (e.key === 'ArrowUp' && P.hist.length) { P.histIdx = Math.min((P.histIdx ?? -1) + 1, P.hist.length - 1); e.target.value = P.hist[P.histIdx]; e.preventDefault(); }
  if (e.key === 'ArrowDown') { P.histIdx = Math.max((P.histIdx ?? 0) - 1, -1); e.target.value = P.histIdx >= 0 ? P.hist[P.histIdx] : ''; e.preventDefault(); }
});
['dragenter', 'dragover'].forEach(n => document.addEventListener(n, e => { const z = e.target.closest && e.target.closest('#drop'); if (z) { e.preventDefault(); z.classList.add('over'); } }));
['dragleave', 'drop'].forEach(n => document.addEventListener(n, e => { const z = e.target.closest && e.target.closest('#drop'); if (z) { e.preventDefault(); z.classList.remove('over'); if (n === 'drop') pushFiles([...e.dataTransfer.files]); } }));

STK.views.phone = { onShow() { setTab(P.tab); } };
STK.on('device-changed', () => { P.toggles = null; P.apps = null; P.files = null; P.path = '/sdcard/'; if (state.view === 'phone') setTab(P.tab); });
STK.on('state', () => { if (state.view === 'phone') { const had = !$('#phone-nodev').hidden; if (had === !!serial()) setTab(P.tab); } });
STK.on('view', v => { if (v !== 'phone') { stopLog(); stopRun(); } });
})();
