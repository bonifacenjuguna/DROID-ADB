/* DROID ADB 4.4 Studio Pro.
   - the Boost rocket launch scene
   - the redesigned "what is being applied" panel under the performance profiles
   - the Apps page (replaces Capture): what is using memory, stop it, protect what must stay
   - a richer game library, a game details window and Game Priority (stop background apps, keep stopping the ones that wake up)
   Loads after studio-plus.js. */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const SX = STK.studio, S = SX.S, XP = STK.xp;
if (!SX) return;
const enc = encodeURIComponent;
const nice = p => (STK.niceApp ? STK.niceApp(p) : p);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reduced = () => !!(STK.fx && STK.fx.reduced && STK.fx.reduced());

/* Capture is gone from Studio. Demo mode stays on the command palette, presets stay in Settings. */
SX.tabs = SX.tabs.filter(t => t.id !== 'capture');
if (S.tab === 'capture') S.tab = 'overview';

/* ====================== 1. Boost: rocket launch ====================== */
const ROCKET = `<svg class="xp-rk" viewBox="0 0 64 76" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><path d="M32 3c11 15 15 35 13 60H19C17 38 21 18 32 3z" fill="#f4f6fa"/><path d="M32 3c11 15 15 35 13 60H32z" fill="#d9dfe9"/><path d="M19 63l-12 24 12-7zM45 63l12 24-12-7z" fill="#f2b544"/><circle cx="32" cy="38" r="9" fill="#2b313b"/><circle cx="32" cy="38" r="6" fill="#7be0ff"/><path d="M25 63h14l-3 12h-8z" fill="#e0743c"/></svg>`;
const STARS = Array.from({ length: 22 }, (_, i) => `<i style="left:${(i * 47 + 9) % 100}%;top:${(i * 31 + 5) % 78}%;animation-delay:-${(i * 13) % 30 / 10}s;width:${1 + i % 3}px;height:${1 + i % 3}px"></i>`).join('');
const PUFFS = Array.from({ length: 7 }, (_, i) => `<i style="--dx:${(i - 3) * 16}px;animation-delay:${(i % 4) * .12}s"></i>`).join('');
function launchScene() {
  const old = document.getElementById('xp-launch'); if (old) old.remove();
  const el = document.createElement('div'); el.id = 'xp-launch'; el.className = 'xp-launch'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<div class="xp-lc"><div class="xp-lc-sky">${STARS}</div><div class="xp-lc-glow"></div>
    <div class="xp-lc-rocket"><div class="xp-lc-body">${ROCKET}<span class="xp-flame"><i></i><i></i></span></div></div>
    <div class="xp-lc-puffs">${PUFFS}</div><div class="xp-lc-pad"></div><div class="xp-lc-speed"><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="xp-lc-text"><b class="cnt">3</b><small class="sub">Clearing the launch pad</small></div>
    <div class="xp-lc-result"><span class="ok-ring">${icon('check')}</span><div class="big"><b id="xp-lc-mb">0</b><span>MB freed</span></div><small class="note"></small></div></div>`;
  document.body.appendChild(el);
  const cnt = el.querySelector('.cnt'), sub = el.querySelector('.sub');
  const say = (t, s) => { cnt.textContent = t; sub.textContent = s; cnt.classList.remove('pop'); void cnt.offsetWidth; cnt.classList.add('pop'); };
  let n = 3, ignited = false;
  const steps = [['2', 'Fuelling up'], ['1', 'Systems check'], ['Go', 'Ignition']];
  const timer = setInterval(() => { const s = steps.shift(); if (!s) { clearInterval(timer); return; } say(s[0], s[1]); if (!steps.length) { ignited = true; el.classList.add('ignite'); clearInterval(timer); } }, 640);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 500); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey); el.addEventListener('click', () => { if (el.classList.contains('done')) close(); });
  return {
    async finish(r, err, minWait) {
      clearInterval(timer);
      if (!ignited) { el.classList.add('ignite'); say('Go', 'Ignition'); }
      await sleep(Math.max(500, minWait));
      if (err) { el.classList.add('abort'); say('Abort', err); await sleep(2600); return close(); }
      el.classList.add('launch'); cnt.textContent = ''; sub.textContent = 'Lift off';
      await sleep(reduced() ? 200 : 1500);
      const mb = Number(r && r.freedMb) || 0;
      el.querySelector('.note').textContent = mb > 0 ? 'Background apps were closed. About ' + (r.availMb != null ? Math.round(r.availMb) + ' MB is available now.' : 'that much memory is free again.') : ((r && r.message) || 'Memory was already in good shape.');
      el.classList.add('done');
      const out = el.querySelector('#xp-lc-mb'); if (XP && XP.setNum) XP.setNum(out, mb, { dec: 0 }); else out.textContent = mb;
      if (STK.fx && mb > 0) setTimeout(() => STK.fx.burst(el.querySelector('.ok-ring'), { color: 'var(--ok)', n: 20, dist: 80 }), 250);
      await sleep(4200); if (document.body.contains(el)) close();
    }
  };
}
SX.boost = async function (btn) {
  if (!STK.sel()) return STK.toast('Connect a phone first.', 'bad');
  const scene = launchScene(), t0 = Date.now(); if (btn) btn.disabled = true;
  let r = null, err = '';
  try { r = await SX.tool({ action: 'boost' }, { timeout: 60000, quiet: true }); } catch (e) { err = e.message || 'The phone did not answer.'; }
  if (btn) btn.disabled = false;
  await scene.finish(r, err, 2900 - (Date.now() - t0));
  if (r && SX.sample) setTimeout(() => SX.sample(true), 400);
  return r;
};

/* ====================== 2. profile panel ====================== */
const TONE = { ok: 'var(--ok)', accent: 'var(--accent)', hot: 'var(--rec)', cool: 'var(--focus)', warn: 'var(--warn)', rec: 'var(--rec)' };
const mark = s => (s === 'ok' ? icon('check', 'sm') : s === 'run' ? '<i class="xp-spinner"></i>' : s === 'skip' ? icon('info', 'sm') : s === 'fail' ? icon('alert', 'sm') : '<i class="xp-dotw"></i>');
SX.paintRun = function () {
  const el = document.getElementById('w-run'); if (!el) return;
  const r = S.run;
  if (!r) { if (el.dataset.uid) { el.dataset.uid = ''; el.innerHTML = ''; } return; }
  const prof = SX.PROFILES.find(p => p.id === r.id) || { ic: r.id === 'restore' ? 'refresh' : 'sliders', tone: 'accent' };
  if (el.dataset.uid !== String(r.uid)) {
    el.dataset.uid = String(r.uid);
    el.innerHTML = `<div class="xp-run" style="--pc:${TONE[prof.tone] || 'var(--accent)'}"><header><span class="badge">${icon(prof.ic)}</span><div class="ttl"><b id="xp-run-t"></b><small id="xp-run-s"></small></div><span class="grow"></span><span id="xp-run-btns"></span></header><div class="bar"><i id="xp-run-bar"></i></div><ol id="xp-run-ol"></ol><footer id="xp-run-f"></footer></div>`;
  }
  const box = el.firstElementChild, ol = $('#xp-run-ol', el);
  const total = r.steps.length, done = r.steps.filter(s => s.st !== 'wait' && s.st !== 'run').length;
  const set = (id, t) => { const x = $('#' + id, el); if (x && x.textContent !== t) x.textContent = t; };
  set('xp-run-t', (r.busy ? 'Applying ' : 'Applied ') + r.name);
  set('xp-run-s', total ? done + ' of ' + total + ' steps' : 'Working...');
  const bar = $('#xp-run-bar', el); if (bar) bar.style.width = (total ? Math.round(done / total * 100) : 8) + '%';
  while (ol.children.length < total) { const li = document.createElement('li'); li.style.animationDelay = (ol.children.length * 60) + 'ms'; li.innerHTML = '<span class="m"></span><span class="t"></span>'; ol.appendChild(li); }
  r.steps.forEach((s, i) => {
    const li = ol.children[i]; if (!li) return;
    if (li.dataset.st !== s.st) { li.dataset.st = s.st; li.className = s.st; $('.m', li).innerHTML = mark(s.st); }
    const t = $('.t', li), txt = s.l + '|' + (s.note && s.st !== 'ok' ? s.note : '');
    if (t.dataset.k !== txt) { t.dataset.k = txt; t.innerHTML = esc(s.l) + (s.note && s.st !== 'ok' ? `<small>${esc(s.note)}</small>` : ''); }
  });
  const was = box.classList.contains('done');
  box.classList.toggle('busy', !!r.busy); box.classList.toggle('done', !r.busy);
  if (!r.busy && !was && STK.fx) { STK.fx.pop($('.badge', box)); }
  const okN = r.steps.filter(s => s.st === 'ok').length, skN = r.steps.filter(s => s.st === 'skip').length, fN = r.steps.filter(s => s.st === 'fail').length;
  const f = $('#xp-run-f', el), fh = r.busy ? '' : `<span class="c ok">${icon('check', 'sm')}${okN} applied</span>${skN ? `<span class="c warn">${icon('info', 'sm')}${skN} skipped</span>` : ''}${fN ? `<span class="c bad">${icon('alert', 'sm')}${fN} failed</span>` : ''}`;
  if (f && f._h !== fh) { f._h = fh; f.innerHTML = fh; }
  const b = $('#xp-run-btns', el), bh = r.busy ? '' : `${r.id !== 'restore' && S.prev[STK.sel()] ? `<button class="btn sm" data-sx="restore" type="button">${icon('refresh', 'sm')}<span>Undo</span></button>` : ''}<button class="btn sm ghost" data-sx="closerun" type="button">Dismiss</button>`;
  if (b && b._h !== bh) { b._h = bh; b.innerHTML = bh; }
};

/* ====================== 3. protected apps and sweeping ====================== */
const DEF_PROTECT = /inputmethod|keyboard|launcher|systemui|com\.android\.(phone|server\.telecom|dialer|providers|incallui)|dialer|\.gms$|\.gsf|vending|droid.?adb|transsion|hios|xos|game(space|mode|assist|turbo|center|booster|sdk)|playgames|webview|trichrome|permissioncontroller|packageinstaller|oplus|coloros|heytap|miui|samsung|huawei|vivo\.|oppo|realme/i;
const MSG_PROTECT = /messag|\.sms|\.mms|whatsapp|telegram|signal|viber|imo\./i;
const prot = () => STK.kv.get('xp-protect', []) || [];
const isProtected = (pkg, msgs = true) => prot().includes(pkg) || DEF_PROTECT.test(pkg) || (msgs && MSG_PROTECT.test(pkg));
async function runningApps(serial) {
  const r = await STK.api(`/running?id=${enc(serial)}&scope=user`, { timeout: 40000 });
  return (r.apps || []).filter(a => a.user !== false);
}
async function sweep(serial, keepPkg, msgs, onStep) {
  /* apps from the same maker as the game (for example com.tencent.* for PUBG) are the game's own helpers, so they are never stopped */
  const maker = keepPkg ? keepPkg.split('.').slice(0, 2).join('.') + '.' : '';
  const list = (await runningApps(serial)).filter(a => a.package !== keepPkg && !a.foreground && !(maker && a.package.startsWith(maker)) && !isProtected(a.package, msgs));
  let stopped = 0, kb = 0;
  for (const a of list.slice(0, 30)) {
    try { await STK.post('/app', { serial, package: a.package, action: 'stop' }, { timeout: 30000 }); stopped++; kb += a.rssKb || 0; if (onStep) onStep(stopped, list.length, a); } catch (e) { /* the phone refused this one */ }
  }
  return { stopped, mb: Math.round(kb / 1024), seen: list.length };
}

/* ====================== 4. Apps page ====================== */
const BG = { apps: null, busy: false, at: 0, note: '' };
async function loadBg(force) {
  const id = STK.sel(); if (!id || BG.busy || (!force && BG.apps && Date.now() - BG.at < 8000)) return;
  BG.busy = true; paintBg();
  try { BG.apps = await runningApps(id); BG.note = ''; BG.at = Date.now(); } catch (e) { BG.note = e.message; }
  BG.busy = false; paintBg();
}
const avatar = (name, pkg) => { let h = 0; for (const c of String(pkg)) h = (h * 31 + c.charCodeAt(0)) % 360; const w = String(name).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/); return `<span class="xp-av" style="--h:${h}">${esc(((w[0] || '?')[0] + ((w[1] || '')[0] || '')).toUpperCase())}</span>`; };
function paintBg() {
  const list = $('#xp-bg-list'); if (!list) return;
  let h;
  if (BG.note) h = `<p class="hint">${esc(BG.note)}</p>`;
  else if (!BG.apps) h = '<p class="hint">Reading what is running on the phone...</p>';
  else if (!BG.apps.length) h = '<p class="hint">No user apps are running in the background. The phone is already clean.</p>';
  else {
    const mx = Math.max(1, ...BG.apps.map(a => a.rssKb || 0)), front = BG.apps.find(a => a.foreground);
    h = BG.apps.slice().sort((a, b) => (b.rssKb || 0) - (a.rssKb || 0)).map(a => {
      const p = isProtected(a.package), user = prot().includes(a.package), n = nice(a.package);
      return `<div class="xp-bgrow ${a.foreground ? 'front' : ''}">${avatar(n, a.package)}<div class="nm"><b>${esc(n)}${a.foreground ? '<span class="pill ok">In front</span>' : ''}${p && !user ? '<span class="pill">Kept by default</span>' : ''}</b><small>${esc(a.package)}</small></div><div class="mem"><span>${((a.rssKb || 0) / 1024).toFixed(0)} MB</span><i style="--w:${Math.max(4, (a.rssKb || 0) / mx * 100).toFixed(0)}%"></i></div>
        <button class="icon-btn xp-star ${user ? 'on' : ''}" type="button" data-bg="prot" data-pkg="${esc(a.package)}" aria-label="${user ? 'Stop protecting' : 'Protect'} ${esc(n)}" title="${user ? 'Protected: never stopped' : 'Protect this app'}">${icon('star', 'sm')}</button>
        <button class="btn sm danger" type="button" data-bg="stop" data-pkg="${esc(a.package)}" ${a.foreground || p ? 'disabled' : ''}>Stop</button></div>`;
    }).join('') + (front ? '' : '');
  }
  if (list._h !== h) { list._h = h; list.innerHTML = h; }
  const pr = $('#xp-bg-prot'), mine = prot();
  const ph = `<p class="hint">Apps you star are never stopped by Boost-style sweeps or by Game Priority. Calls, keyboard and the launcher are always kept.</p><div class="xp-chips">${mine.length ? mine.map(p => `<button type="button" class="chipbtn is-active" data-bg="prot" data-pkg="${esc(p)}" title="Remove protection">${esc(nice(p))} ${icon('x', 'sm')}</button>`).join('') : '<span class="hint">Nothing protected yet. Tap a star in the list.</span>'}</div><label class="xp-wd-row"><span><b>Keep calls and messages working</b><small>WhatsApp, Telegram, SMS and similar are not stopped</small></span><input type="checkbox" role="switch" data-sxc="bgmsg" ${STK.kv.get('xp-keepmsg', true) !== false ? 'checked' : ''}></label>`;
  if (pr && pr._h !== ph) { pr._h = ph; pr.innerHTML = ph; }
  const r = SX.last(), m = $('#xp-bg-mem');
  if (m && r) { const t = r.memPct == null ? '--' : Math.round(r.memPct) + '% used'; if (m.textContent !== t) m.textContent = t; }
}
SX.register({ id: 'bg', label: 'Apps', icon: 'apps', order: 6,
  onShow() { loadBg(true); },
  render: () => `<div class="sx-grid">
    ${SX.card('span-8', 'Running apps', 'Biggest memory users first. Stop what you do not need; star what must stay.', '<div id="xp-bg-list" class="xp-bglist"></div>', `<span class="sx-chip" id="xp-bg-mem">--</span><button class="btn sm" type="button" data-bg="reload">${icon('refresh', 'sm')}<span>Refresh</span></button><button class="btn sm primary" type="button" data-bg="all">${icon('bolt', 'sm')}<span>Stop all others</span></button>`)}
    ${SX.card('span-4', 'Protected apps', 'These stay running.', '<div id="xp-bg-prot"></div>')}
  </div>`,
  paint() { paintBg(); }
});
document.addEventListener('click', async e => {
  const t = e.target.closest('#studio-root [data-bg]'); if (!t) return;
  const id = STK.sel(); const act = t.dataset.bg, pkg = t.dataset.pkg;
  if (act === 'reload') return STK.busy(t, () => loadBg(true));
  if (act === 'prot') { const l = prot().slice(), i = l.indexOf(pkg); if (i >= 0) l.splice(i, 1); else l.push(pkg); STK.kv.set('xp-protect', l); return paintBg(); }
  if (!id) return STK.toast('Connect a phone first.', 'bad');
  if (act === 'stop') return STK.busy(t, async () => { try { await STK.post('/app', { serial: id, package: pkg, action: 'stop' }, { timeout: 30000 }); STK.toast(nice(pkg) + ' was stopped.'); } catch (er) { STK.fail(er); } await sleep(300); loadBg(true); });
  if (act === 'all') {
    if (!await STK.confirm('Stop all other apps?', '<p>Every running app that is not in front, not starred and not a call, keyboard or messaging app will be force-stopped. They start again when you open them.</p>', 'Stop them')) return;
    const label = t.querySelector('span'); const keep = label.textContent;
    return STK.busy(t, async () => { try { const r = await sweep(id, '', STK.kv.get('xp-keepmsg', true) !== false, (n, tot) => { label.textContent = n + ' / ' + tot; }); STK.toast(r.stopped ? 'Stopped ' + r.stopped + ' apps (about ' + r.mb + ' MB).' : 'Nothing needed stopping.'); } catch (er) { STK.fail(er); } label.textContent = keep; loadBg(true); });
  }
});
Object.assign(SX.changes, { bgmsg: t => { STK.kv.set('xp-keepmsg', t.checked); paintBg(); } });

/* ====================== 5. games ====================== */
const gx = () => SX.gx;
const GL = { q: '', sort: STK.store.get('xp-gsort', 'recent') };
const ago = ms => { const s = Math.max(0, (Date.now() - ms) / 1000); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
const gguard = g => ({ enabled: false, sweep: true, watch: false, every: 45, msgs: true, ...(g.guard || {}) });
SX.gamesLibrary = function () {
  const X = gx(); if (!X) return '';
  const gl = X.games(), p = X.pt(), lp = STK.kv.get('lastplayed', {}) || {}, ss = X.sessions(), act = X.active[STK.sel()], fav = STK.kv.get('xp-gfav', []) || [];
  let rows = gl.map((g, i) => ({ g, i, name: X.gname(g), played: p[g.pkg] || 0, last: lp[g.pkg] || 0 }));
  const q = GL.q.trim().toLowerCase(); if (q) rows = rows.filter(r => (r.name + ' ' + r.g.pkg).toLowerCase().includes(q));
  const cmp = { recent: (a, b) => b.last - a.last, most: (a, b) => b.played - a.played, az: (a, b) => a.name.localeCompare(b.name) }[GL.sort] || (() => 0);
  rows.sort((a, b) => (fav.includes(b.g.pkg) - fav.includes(a.g.pkg)) || cmp(a, b));
  const detect = (S.apps || []).filter(a => X.KNOWN[a.package] && !gl.find(g => g.pkg === a.package));
  const chip = (t, ic) => `<span class="sx-chip">${ic ? icon(ic, 'sm') : ''}${esc(t)}</span>`;
  const cards = rows.map(({ g, i, name, played, last }) => {
    const live = act && act.pkg === g.pkg, on = g.on !== false, gs = ss.filter(s => s.pkg === g.pkg), peak = gs.length ? Math.max(...gs.map(s => s.peakT || 0)) : 0, gd = gguard(g), isFav = fav.includes(g.pkg);
    const pr = g.profile ? SX.PROFILES.find(x => x.id === g.profile) : null;
    return `<article class="xp-game ${live ? 'live' : ''} ${on ? '' : 'off'}" style="--h:${X.hue(g.pkg)}">
      <div class="gtop"><button type="button" class="av" data-sx="gdetails" data-i="${i}" aria-label="Open details of ${esc(name)}">${esc(X.initials(name))}</button><div class="nm"><b>${esc(name)}</b><small>${esc(g.pkg)}</small></div>
        <button type="button" class="favbtn ${isFav ? 'on' : ''}" data-sx="gfav" data-pkg="${esc(g.pkg)}" aria-label="${isFav ? 'Unpin' : 'Pin'} ${esc(name)}" title="${isFav ? 'Pinned to the top' : 'Pin to the top'}">${icon('star', 'sm')}</button></div>
      ${live ? `<div class="livebar"><i></i>Playing now · ${esc(X.fmtDur((Date.now() - act.startedAt) / 1000))}</div>` : `<div class="lastp">${last ? 'Last played ' + ago(last) : 'Not played yet'}</div>`}
      <div class="chips">${pr ? `<span class="sx-chip accent">${icon(pr.ic, 'sm')}${esc(pr.name)}</span>` : ''}${gd.enabled ? chip('Game Priority', 'bolt') : ''}${g.dnd ? chip('Do not disturb') : ''}${g.record ? chip('Records') : ''}${g.mirror ? chip('Mirrors') : ''}${g.gamemode ? chip('Game Mode') : ''}</div>
      <div class="stats"><span>${icon('clock', 'sm')}${played ? esc(X.fmtDur(played)) : '0 min'}</span><span>${icon('game', 'sm')}${gs.length} session${gs.length === 1 ? '' : 's'}</span><span>${icon('thermo', 'sm')}${peak ? peak.toFixed(0) + ' °C' : '-'}</span></div>
      <div class="acts"><button class="btn sm primary" type="button" data-sx="gprio" data-i="${i}" title="Stop background apps, then open the game">${icon('rocket', 'sm')}<span>Play</span></button><button class="btn sm" type="button" data-sx="glaunch" data-i="${i}" title="Open the game without changing anything">${icon('play', 'sm')}<span>Open</span></button><button class="btn sm" type="button" data-sx="gdetails" data-i="${i}">${icon('info', 'sm')}<span>Details</span></button>
        <label class="switch sm" title="Switch on its profile by itself when this game opens"><input type="checkbox" data-sxc="gon" data-i="${i}" ${on ? 'checked' : ''} aria-label="Auto profile"><i></i></label></div></article>`;
  }).join('');
  const tool = `<div class="xp-gtools"><div class="search"><svg class="ic sm"><use href="#i-search"/></svg><input id="xp-gq" type="search" placeholder="Find a game" value="${esc(GL.q)}" autocomplete="off" aria-label="Find a game"></div><div class="seg mini" role="group" aria-label="Sort games">${[['recent', 'Recent'], ['most', 'Most played'], ['az', 'A to Z']].map(([k, l]) => `<button type="button" data-gsort="${k}" class="${GL.sort === k ? 'is-active' : ''}">${l}</button>`).join('')}</div></div>`;
  const add = `<button type="button" class="xp-game add" data-sx="gadd">${icon('game')}<b>Add a game</b><small>Studio looks after it from then on</small></button>`;
  const empty = `<div class="sx-empty">${icon('game')}<b>No games yet</b><p>Add the games you play. Play stops background apps first, switches on your profile, and puts everything back when you leave.</p></div>`;
  return `${gl.length ? tool : ''}<div class="xp-games">${cards}${add}</div>${!gl.length ? empty : ''}${detect.length ? `<div class="sx-detect"><span>${icon('sparkle', 'sm')}Found on this phone</span>${detect.slice(0, 8).map(a => `<button type="button" class="chipbtn" data-sx="gquick" data-pkg="${esc(a.package)}">+ ${esc(X.KNOWN[a.package])}</button>`).join('')}</div>` : ''}`;
};
document.addEventListener('input', e => { if (e.target.id === 'xp-gq') { GL.q = e.target.value; const el = document.getElementById('w-glib'); if (el) { const pos = e.target.selectionStart; SX.W('w-glib', SX.gamesLibrary()); const n = document.getElementById('xp-gq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) { /* ignore */ } } } } });
document.addEventListener('click', e => { const b = e.target.closest('#studio-root [data-gsort]'); if (!b) return; GL.sort = b.dataset.gsort; STK.store.set('xp-gsort', GL.sort); SX.W('w-glib', SX.gamesLibrary()); });

/* true while a mirror or recording runs or a game is in front: Studio then asks the phone far less often */
SX.calm = () => {
  if ((state.sessions || []).length) return true;
  const fg = (STK.live() || {}).fgPackage; if (!fg) return false;
  const X = gx(); return !!(X && (X.games().some(g => g.pkg === fg) || X.KNOWN[fg]));
};

/* ---- Game Priority: stop background apps, keep stopping the ones that wake up ---- */
const GUARD = { timers: {}, stat: {}, busy: {}, away: {} };
SX.guardStat = serial => GUARD.stat[serial || STK.sel()];
function stopGuard(serial) { clearInterval(GUARD.timers[serial]); delete GUARD.timers[serial]; delete GUARD.away[serial]; }
function startGuard(serial, g) {
  stopGuard(serial); const o = gguard(g); GUARD.stat[serial] = GUARD.stat[serial] || { stopped: 0, mb: 0, pkg: g.pkg };
  GUARD.stat[serial].pkg = g.pkg;
  if (!o.watch) return;
  GUARD.timers[serial] = setInterval(async () => {
    const live = STK.live() || {};
    if (live.fgPackage && live.fgPackage !== g.pkg) { GUARD.away[serial] = (GUARD.away[serial] || 0) + 1; if (GUARD.away[serial] >= 3) return stopGuard(serial); } else GUARD.away[serial] = 0;
    if (GUARD.busy[serial]) return; GUARD.busy[serial] = true;
    try { const r = await sweep(serial, g.pkg, o.msgs); const st = GUARD.stat[serial]; st.stopped += r.stopped; st.mb += r.mb; st.at = Date.now(); } catch (e) { /* try again next time */ }
    GUARD.busy[serial] = false;
  }, Math.max(30, Number(o.every) || 45) * 1000);
}
STK.on('sx-game-enter', ({ serial, g }) => { const o = gguard(g); if (!o.enabled) return; GUARD.stat[serial] = { stopped: 0, mb: 0, pkg: g.pkg }; if (o.sweep) sweep(serial, g.pkg, o.msgs).then(r => { const st = GUARD.stat[serial]; if (st) { st.stopped += r.stopped; st.mb += r.mb; } if (r.stopped) STK.toast('Game Priority: stopped ' + r.stopped + ' background apps (about ' + r.mb + ' MB).'); }).catch(() => {}); startGuard(serial, g); });
STK.on('sx-game-exit', ({ serial, g }) => { stopGuard(serial); const st = GUARD.stat[serial]; if (st && st.stopped) STK.toast('Game Priority kept ' + st.stopped + ' apps out of the way during this game.'); });
STK.on('device-changed', () => { Object.keys(GUARD.timers).forEach(stopGuard); });

async function playWithPriority(i, btn) {
  const X = gx(), serial = STK.sel(), g = X.games()[i]; if (!g) return;
  if (!serial) return STK.toast('Connect a phone first.', 'bad');
  const o = gguard(g), label = btn && btn.querySelector('span'), keep = label ? label.textContent : '';
  const run = async () => {
    try {
      if (o.sweep) { if (label) label.textContent = 'Clearing...'; const r = await sweep(serial, g.pkg, o.msgs, (n, tot) => { if (label) label.textContent = n + ' / ' + tot; }); GUARD.stat[serial] = { stopped: r.stopped, mb: r.mb, pkg: g.pkg, at: Date.now() }; STK.toast(r.stopped ? 'Stopped ' + r.stopped + ' background apps (about ' + r.mb + ' MB). Opening ' + X.gname(g) + '.' : 'Nothing was in the way. Opening ' + X.gname(g) + '.'); }
      if (label) label.textContent = 'Opening...';
      await SX.tool({ action: 'launch', pkg: g.pkg }, { quiet: true });
      startGuard(serial, g);
    } catch (er) { STK.fail(er); }
  };
  if (btn) await STK.busy(btn, run); else await run();
  if (label) label.textContent = keep;
  SX.refresh();
}

/* ---- details window ---- */
function dlg() {
  let d = document.getElementById('xp-gd');
  if (!d) { d = document.createElement('dialog'); d.id = 'xp-gd'; d.className = 'dlg xp-gd'; document.body.appendChild(d); d.addEventListener('mousedown', e => { if (e.target === d) d.close(); }); }
  return d;
}
function detailsHtml(i) {
  const X = gx(), g = X.games()[i]; if (!g) return '<p class="hint">This game is no longer in your list.</p>';
  const name = X.gname(g), p = X.pt()[g.pkg] || 0, lp = (STK.kv.get('lastplayed', {}) || {})[g.pkg] || 0, gs = X.sessions().filter(s => s.pkg === g.pkg), gd = gguard(g), act = X.active[STK.sel()], live = act && act.pkg === g.pkg;
  const peak = gs.length ? Math.max(...gs.map(s => s.peakT || 0)) : 0, avgT = gs.filter(s => s.avgT != null).length ? gs.reduce((a, s) => a + (s.avgT || 0), 0) / gs.filter(s => s.avgT != null).length : 0;
  const drain = gs.filter(s => s.bat0 != null && s.bat1 != null && s.secs > 300); const perH = drain.length ? drain.reduce((a, s) => a + (s.bat0 - s.bat1) / (s.secs / 3600), 0) / drain.length : null;
  const tile = (l, v, s) => `<div class="sx-sum"><small>${l}</small><b>${v}</b><span>${s}</span></div>`;
  const sw = (k, l, h) => `<label class="xp-wd-row"><span><b>${l}</b><small>${h}</small></span><input type="checkbox" role="switch" data-gd="${k}" ${gd[k] ? 'checked' : ''}></label>`;
  const pr = g.profile ? SX.PROFILES.find(x => x.id === g.profile) : null, mine = prot();
  const st = SX.guardStat(); const stat = st && st.pkg === g.pkg && st.stopped ? `<div class="xp-gd-note ok">${icon('check', 'sm')}Stopped ${st.stopped} apps so far in this game (about ${st.mb} MB).</div>` : '';
  return `<div class="xp-gd-hero" style="--h:${X.hue(g.pkg)}"><span class="av">${esc(X.initials(name))}</span><div class="who"><h2>${esc(name)}</h2><small>${esc(g.pkg)}</small><div class="chips">${live ? '<span class="sx-chip ok">Playing now</span>' : ''}${pr ? `<span class="sx-chip accent">${icon(pr.ic, 'sm')}${esc(pr.name)} profile</span>` : '<span class="sx-chip">No profile</span>'}${g.on === false ? '<span class="sx-chip">Auto profile off</span>' : ''}</div></div><button class="icon-btn" type="button" data-gd="close" aria-label="Close">${icon('x')}</button></div>
  <div class="sx-sums xp-gd-stats">${tile('Play time', p ? esc(X.fmtDur(p)) : '0 min', 'Tracked while the dashboard is open')}${tile('Sessions', gs.length, gs.length ? 'Average ' + (avgT ? avgT.toFixed(0) + ' °C' : '-') : 'None yet')}${tile('Last played', lp ? ago(lp) : '-', lp ? new Date(lp).toLocaleDateString() : 'Not yet')}${tile('Hottest', peak ? peak.toFixed(0) + ' °C' : '-', perH != null ? perH.toFixed(0) + '% battery per hour' : 'Battery use appears after 5 min sessions')}</div>
  <section class="xp-gd-sec"><h3>${icon('rocket', 'sm')}Game Priority <small>Advanced optimization: this game gets the phone to itself</small></h3>
    ${sw('enabled', 'Use Game Priority when this game opens', 'Off by default. It starts about 40 seconds after the game opens, so the game can finish loading first')}
    ${sw('sweep', 'Stop background apps', 'Closes everything that is not in front, protected, or a call or message app')}
    ${sw('watch', 'Keep stopping apps that wake up', 'Checks while you play and stops anything that starts again. Heavy games can dislike this, so it is off by default')}
    ${sw('msgs', 'Keep calls and messages working', 'WhatsApp, Telegram, SMS and similar are left alone')}
    <label class="xp-gd-row"><span><b>Check every</b><small>How often the guard looks while you play</small></span><select data-gd="every" aria-label="Check every">${[30, 45, 60, 120].map(s => `<option value="${s}" ${Number(gd.every) === s ? 'selected' : ''}>${s} seconds</option>`).join('')}</select></label>
    <p class="hint">Starred apps are always kept${mine.length ? ': ' + esc(mine.map(nice).join(', ')) : ''}. Manage them on the Apps page.</p>${stat}
    <div class="xp-gd-acts"><button class="btn primary" type="button" data-gd="play">${icon('rocket', 'sm')}<span>Play with Game Priority</span></button><button class="btn" type="button" data-gd="clear">${icon('bolt', 'sm')}<span>Stop background apps now</span></button></div></section>
  <section class="xp-gd-sec"><h3>${icon('sliders', 'sm')}When it opens <small>Switched on by itself, restored when you leave</small></h3><div class="chips">${pr ? `<span class="sx-chip accent">${icon(pr.ic, 'sm')}${esc(pr.name)}</span>` : ''}${g.dnd ? '<span class="sx-chip">Do not disturb</span>' : ''}${g.touches ? '<span class="sx-chip">Show touches</span>' : ''}${g.freemem ? '<span class="sx-chip">Free memory</span>' : ''}${g.gamemode ? '<span class="sx-chip">Android Game Mode</span>' : ''}${g.mirror ? '<span class="sx-chip">Mirrors</span>' : ''}${g.record ? '<span class="sx-chip">Records</span>' : ''}${!pr && !g.dnd && !g.touches && !g.freemem && !g.gamemode && !g.mirror && !g.record ? '<span class="hint">Nothing selected.</span>' : ''}</div><div class="xp-gd-acts"><button class="btn" type="button" data-gd="edit">${icon('pencil', 'sm')}<span>Edit these</span></button><button class="btn" type="button" data-gd="opt" title="Recompile the game for faster start-up">${icon('bolt', 'sm')}<span>Speed up start-up</span></button><button class="btn" type="button" data-gd="mon">${icon('pulse', 'sm')}<span>Watch smoothness</span></button></div></section>
  <section class="xp-gd-sec"><h3>${icon('clock', 'sm')}Recent sessions</h3>${gs.length ? `<div class="xp-gd-ses">${gs.slice(0, 6).map(s => `<div><b>${esc(new Date(s.t0).toLocaleDateString())} ${esc(new Date(s.t0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</b><span>${esc(X.fmtDur(s.secs))}</span><span>${s.peakT ? s.peakT.toFixed(0) + ' °C peak' : '-'}</span><span>${s.bat0 != null && s.bat1 != null ? (s.bat0 - s.bat1) + '% battery' : '-'}</span></div>`).join('')}</div>` : '<p class="hint">After you play for a while, the report appears here.</p>'}</section>
  <footer class="xp-gd-foot"><button class="btn danger ghost" type="button" data-gd="remove">${icon('trash', 'sm')}<span>Remove from library</span></button><span class="grow"></span><button class="btn" type="button" data-gd="close">Close</button></footer>`;
}
let gdI = -1;
function openDetails(i) { gdI = i; const d = dlg(); d.innerHTML = detailsHtml(i); if (!d.open) d.showModal(); }
let patching = false;
const patchGame = (i, patch) => { patching = true; const l = gx().games().slice(); if (!l[i]) return; l[i] = { ...l[i], ...patch }; STK.kv.set('games', l); patching = false; };
document.addEventListener('click', async e => {
  const b = e.target.closest('#xp-gd [data-gd]'); if (!b || b.tagName === 'SELECT' || b.type === 'checkbox') return;
  const X = gx(), a = b.dataset.gd, g = X.games()[gdI], d = dlg(); if (!g) return;
  if (a === 'close') return d.close();
  if (a === 'edit') { d.close(); return X.editGame(gdI); }
  if (a === 'play') { d.close(); const btn = document.querySelector(`#w-glib [data-sx="gprio"][data-i="${gdI}"]`); return playWithPriority(gdI, btn || b); }
  if (a === 'clear') return STK.busy(b, async () => { try { const r = await sweep(STK.sel(), g.pkg, gguard(g).msgs); STK.toast(r.stopped ? 'Stopped ' + r.stopped + ' apps (about ' + r.mb + ' MB).' : 'Nothing was in the way.'); } catch (er) { STK.fail(er); } });
  if (a === 'opt') return STK.busy(b, () => SX.tool({ action: 'dexopt', pkg: g.pkg }, { timeout: 260000 }));
  if (a === 'mon') { d.close(); X.monitor(g); return; }
  if (a === 'remove') { if (!await STK.confirmDelete('Remove this game?', `<p><b>${esc(X.gname(g))}</b> will be removed from your list. The game itself is not touched.</p>`, 'Remove')) return; const l = X.games().slice(); l.splice(gdI, 1); STK.kv.set('games', l); d.close(); SX.refresh(); }
});
document.addEventListener('change', e => {
  const t = e.target.closest && e.target.closest('#xp-gd [data-gd]'); if (!t) return;
  const g = gx().games()[gdI]; if (!g) return;
  const k = t.dataset.gd, gd = { ...gguard(g) };
  if (k === 'every') gd.every = Number(t.value); else gd[k] = t.checked;
  patchGame(gdI, { guard: gd }); const d = dlg(); d.querySelectorAll('.xp-gd-note').forEach(n => n.remove());
});
Object.assign(SX.actions, {
  gdetails: t => openDetails(Number(t.dataset.i)),
  gprio: t => playWithPriority(Number(t.dataset.i), t),
  gfav: t => { const l = (STK.kv.get('xp-gfav', []) || []).slice(), i = l.indexOf(t.dataset.pkg); if (i >= 0) l.splice(i, 1); else l.push(t.dataset.pkg); STK.kv.set('xp-gfav', l); SX.W('w-glib', SX.gamesLibrary()); }
});
STK.on('kv', k => { if (k === 'games' && gdI >= 0 && !patching) { const d = document.getElementById('xp-gd'); if (d && d.open) d.innerHTML = detailsHtml(gdI); } });
})();
