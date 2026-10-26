/* DROID ADB 4.0 Studio, Games page: game library, automatic game profiles, session reports and the live frame monitor. */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const SX = STK.studio, S = SX.S;
const nice = p => (STK.niceApp ? STK.niceApp(p) : p);
const games = () => STK.kv.get('games', []);
const sessions = () => STK.kv.get('gamesessions', []);
const presets = () => (state.schema && state.schema.presets) || [];
const presetName = id => { const p = presets().find(x => x.id === id); return p ? p.name : id; };
const G = { active: {}, misses: {}, entering: {}, heatAt: 0, lowAt: 0 };
const F = { on: false, timer: null, pkg: '', prev: null, jank: [], fps: [], p50: [], last: null, note: '' };

/* well-known games so installed ones can be added with one tap */
const KNOWN = { 'com.tencent.ig': 'PUBG MOBILE', 'com.activision.callofduty.shooter': 'Call of Duty: Mobile', 'com.dts.freefireth': 'Free Fire', 'com.dts.freefiremax': 'Free Fire MAX', 'com.miHoYo.GenshinImpact': 'Genshin Impact', 'com.HoYoverse.hkrpgoversea': 'Honkai: Star Rail', 'com.mobile.legends': 'Mobile Legends', 'com.roblox.client': 'Roblox', 'com.mojang.minecraftpe': 'Minecraft', 'com.supercell.brawlstars': 'Brawl Stars', 'com.supercell.clashroyale': 'Clash Royale', 'com.supercell.clashofclans': 'Clash of Clans', 'jp.konami.pesam': 'eFootball', 'com.ea.gp.fifamobile': 'EA FC Mobile', 'com.gameloft.android.ANMP.GloftA9HM': 'Asphalt 9', 'com.kiloo.subwaysurf': 'Subway Surfers', 'com.innersloth.spacemafia': 'Among Us', 'com.king.candycrushsaga': 'Candy Crush', 'com.firsttouchgames.dls7': 'Dream League Soccer', 'com.pubg.imobile': 'BGMI', 'com.garena.game.codm': 'Call of Duty: Mobile (Garena)', 'com.nianticlabs.pokemongo': 'Pokemon GO', 'com.wargaming.wot.blitz': 'WoT Blitz', 'com.levelinfinite.sgameGlobal': 'Honor of Kings', 'com.proximabeta.mf.uamo': 'Arena Breakout', 'com.kurogame.wutheringwaves.global': 'Wuthering Waves', 'com.netease.lztgglobal': 'Rules of Survival', 'com.ludo.king': 'Ludo King', 'com.chess': 'Chess.com' };
const gname = g => g.name || KNOWN[g.pkg] || nice(g.pkg);
const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const initials = s => { const w = String(s).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/); return ((w[0] || '?')[0] + ((w[1] || '')[0] || '')).toUpperCase(); };
const fmtDur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + ' h ' + m + ' min' : m ? m + ' min' : s + ' s'; };
const pt = () => STK.kv.get('playtime', {}) || {};

/* ---------- Games page ---------- */
function summaryHtml() {
  const gl = games(), p = pt(), total = Object.values(p).reduce((a, b) => a + b, 0), ss = sessions();
  const top = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
  const peak = ss.length ? Math.max(...ss.map(x => x.peakT || 0)) : null;
  const tile = (l, v, s) => `<div class="sx-sum"><small>${l}</small><b>${v}</b><span>${s}</span></div>`;
  return `<div class="sx-sums">${tile('Games', gl.length, gl.filter(g => g.on !== false).length + ' with auto profile on')}${tile('Total play time', total ? fmtDur(total) : '0 min', 'Tracked while Studio is open')}${tile('Most played', top ? esc(KNOWN[top[0]] || nice(top[0])) : '-', top ? fmtDur(top[1]) : 'Nothing yet')}${tile('Hottest session', peak ? peak.toFixed(0) + ' °C' : '-', ss.length ? ss.length + ' sessions recorded' : 'Play a game to see this')}</div>`;
}
function libraryHtml() {
  const gl = games(), p = pt(), act = G.active[STK.sel()];
  const detect = (S.apps || []).filter(a => KNOWN[a.package] && !gl.find(g => g.pkg === a.package));
  const cards = gl.map((g, i) => {
    const name = gname(g), h = hue(g.pkg), on = g.on !== false, live = act && act.pkg === g.pkg;
    const bits = [];
    if (g.profile) { const pr = SX.PROFILES.find(x => x.id === g.profile); if (pr) bits.push(`<span class="sx-chip accent">${icon(pr.ic, 'sm')}${esc(pr.name)}</span>`); }
    if (g.preset) bits.push(`<span class="sx-chip">${esc(presetName(g.preset))}</span>`);
    if (g.record) bits.push('<span class="sx-chip">Record</span>'); if (g.mirror) bits.push('<span class="sx-chip">Mirror</span>');
    if (g.dnd) bits.push('<span class="sx-chip">Do not disturb</span>'); if (g.freemem) bits.push('<span class="sx-chip">Free memory</span>'); if (g.gamemode) bits.push('<span class="sx-chip">Game Mode</span>');
    return `<article class="sx-game ${live ? 'live' : ''} ${on ? '' : 'off'}" style="--h:${h}"><div class="tp"><span class="av">${esc(initials(name))}</span><div class="nm"><b>${esc(name)}</b><small>${esc(g.pkg)}</small></div><label class="switch sm" title="Switch on automatically when this game opens"><input type="checkbox" data-sxc="gon" data-i="${i}" ${on ? 'checked' : ''} aria-label="Auto profile"><i></i></label></div>
      ${live ? `<div class="livebar"><i></i>Playing now · ${esc(fmtDur((Date.now() - act.startedAt) / 1000))}</div>` : ''}
      <div class="chips">${bits.join('') || '<span class="hint">No automatic actions yet. Edit to choose a profile.</span>'}</div>
      <div class="meta"><span>${icon('clock', 'sm')}${p[g.pkg] ? esc(fmtDur(p[g.pkg])) : 'Not played yet'}</span></div>
      <div class="acts"><button class="btn sm primary" type="button" data-sx="glaunch" data-i="${i}">${icon('play', 'sm')}<span>Launch</span></button><button class="btn sm" type="button" data-sx="gopt" data-i="${i}" title="Recompile for faster start-up">${icon('bolt', 'sm')}<span>Optimize</span></button><button class="btn sm" type="button" data-sx="gmon" data-i="${i}" title="Watch its smoothness">${icon('pulse', 'sm')}<span>Monitor</span></button><span class="grow"></span><button class="icon-btn" type="button" data-sx="gedit" data-i="${i}" aria-label="Edit">${icon('pencil')}</button><button class="icon-btn" type="button" data-sx="gdel" data-i="${i}" aria-label="Remove">${icon('trash')}</button></div></article>`;
  }).join('');
  const empty = `<div class="sx-empty">${icon('game')}<b>No games yet</b><p>Add the games you play. When one opens on the phone, Studio switches on your chosen profile and puts everything back when you leave.</p></div>`;
  return `<div class="sx-games">${cards || empty}</div>${detect.length ? `<div class="sx-detect"><span>${icon('sparkle', 'sm')}Found on this phone</span>${detect.slice(0, 8).map(a => `<button type="button" class="chipbtn" data-sx="gquick" data-pkg="${esc(a.package)}">+ ${esc(KNOWN[a.package])}</button>`).join('')}</div>` : ''}`;
}

async function editGame(i) {
  const g = i >= 0 ? games()[i] : {};
  const apps = await SX.ensureApps();
  const pr = [['', 'None'], ...SX.PROFILES.filter(p => p.id !== 'balanced').map(p => [p.id, p.name])];
  const cp = [['', 'Keep my settings'], ...presets().map(p => [p.id, p.name])];
  const f = await STK.form(i >= 0 ? 'Edit game' : 'Add a game',
    `<label class="ff"><span>App</span><input name="pkg" list="g-list" value="${esc(g.pkg || '')}" placeholder="Start typing the game name" autocomplete="off" spellcheck="false"></label><datalist id="g-list">${apps.map(a => `<option value="${esc(a.package)}">${esc(KNOWN[a.package] || nice(a.package))}</option>`).join('')}</datalist>` +
    STK.field('name', 'Display name (optional)', g.name || '') + STK.select('profile', 'Performance profile when it opens', pr, g.profile || 'gaming') + STK.select('preset', 'Capture preset', cp, g.preset || 'latency') +
    STK.check('mirror', 'Start mirroring', g.mirror) + STK.check('record', 'Start recording', !!g.record) + STK.check('dnd', 'Turn on Do not disturb', g.dnd !== false) + STK.check('touches', 'Show touches', !!g.touches) + STK.check('freemem', 'Free memory when the game starts', g.freemem !== false) + STK.check('gamemode', 'Use Android Game Mode: performance (needs Android 12+)', !!g.gamemode), 'Save');
  if (!f) return;
  const pkg = f.pkg.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(pkg)) return STK.toast('Use the package name, like com.tencent.ig. Pick one from the list.', 'bad');
  const entry = { pkg, name: f.name.trim().slice(0, 40), profile: f.profile, preset: f.preset, mirror: f.mirror, record: f.record, dnd: f.dnd, touches: f.touches, freemem: f.freemem, gamemode: f.gamemode, on: g.on !== false };
  const list = games().slice(); if (i >= 0) list[i] = entry; else list.push(entry);
  STK.kv.set('games', list.slice(0, 30)); SX.refresh();
}

/* ---------- automatic game mode ---------- */
async function setT(serial, key, value) { try { await STK.post('/toggle', { serial, key, value }, { timeout: 30000 }); } catch (e) { /* the phone may refuse; continue */ } }
async function enter(serial, g) {
  if (G.entering[serial]) return; G.entering[serial] = true;
  const a = G.active[serial] = { pkg: g.pkg, g, prevSettings: null, prevToggles: null, rec: false, mir: false, startedAt: Date.now(), gm: false, profile: false, restore: false, temps: [], bat0: (STK.live() || {}).battery, peak: 0 };
  G.misses[serial] = 0; refreshIfOpen();
  STK.toast('Game mode on: ' + gname(g));
  try {
    try { const t = await STK.api('/toggles?id=' + encodeURIComponent(serial), { timeout: 30000 }); a.prevToggles = t.toggles || {}; } catch (e) { /* optional */ }
    if (g.profile) { a.restore = !S.prev[serial]; try { await SX.applyProfile(g.profile, { quiet: true, pkg: g.pkg }); a.profile = true; } catch (e) { /* profile steps report themselves */ } }
    if (g.dnd) await setT(serial, 'dnd', true);
    if (g.touches) await setT(serial, 'touches', true);
    if (g.freemem && !g.profile) { try { await STK.post('/perf-tools', { serial, action: 'freemem' }, { timeout: 30000 }); } catch (e) { /* optional step */ } }
    if (g.gamemode) { try { const r = await STK.post('/perf-tools', { serial, action: 'gamemode', pkg: g.pkg, mode: 'performance' }, { timeout: 30000 }); if (r.applied) a.gm = true; else STK.toast(r.message, 'bad'); } catch (e) { STK.toast(e.message, 'bad'); } }
    const p = presets().find(x => x.id === g.preset);
    if (p) {
      const prev = {}; for (const k of Object.keys(p.v)) prev[k] = (state.settings || {})[k]; a.prevSettings = prev;
      try { await STK.post('/settings', { patch: p.v }); await STK.loadSettings(); } catch (e) { STK.fail(e); }
    }
    if (g.mirror && !STK.mirroring()) { await STK.actions.mirror(); a.mir = true; }
    if (g.record && !STK.recording()) { await STK.actions.record(); a.rec = true; }
  } finally { G.entering[serial] = false; }
}
async function exit(serial) {
  const a = G.active[serial]; if (!a) return;
  delete G.active[serial]; delete G.misses[serial]; refreshIfOpen();
  const secs = Math.round((Date.now() - (a.startedAt || Date.now())) / 1000);
  try { if (secs >= 10) { const p = { ...pt() }; p[a.pkg] = (p[a.pkg] || 0) + secs; STK.kv.set('playtime', p); } } catch (e) { /* optional */ }
  try {
    if (secs >= 30) {
      const t = a.temps.filter(x => x != null), L = STK.live();
      const rec = { pkg: a.pkg, name: gname(a.g), t0: a.startedAt, secs, avgT: t.length ? t.reduce((x, y) => x + y, 0) / t.length : null, peakT: t.length ? Math.max(...t) : null, bat0: a.bat0 == null ? null : a.bat0, bat1: L && L.battery >= 0 ? L.battery : null, profile: a.g.profile || '' };
      STK.kv.set('gamesessions', [rec, ...sessions()].slice(0, 40));
    }
  } catch (e) { /* optional */ }
  STK.toast('Game mode off. Settings restored.');
  if (a.gm) { try { await STK.post('/perf-tools', { serial, action: 'gamemode', pkg: a.pkg, mode: 'standard' }, { timeout: 30000 }); } catch (e) { /* ignore */ } }
  if (a.rec && STK.recording()) { try { await STK.actions.record(); } catch (e) { /* ignore */ } }
  if (a.mir && STK.mirroring()) { try { await STK.actions.mirror(); } catch (e) { /* ignore */ } }
  if (a.prevToggles) { if (a.g.dnd) await setT(serial, 'dnd', !!a.prevToggles.dnd); if (a.g.touches) await setT(serial, 'touches', !!a.prevToggles.touches); }
  if (a.profile && a.restore) { try { await SX.restoreProfile(); } catch (e) { /* ignore */ } }
  if (a.prevSettings) { try { await STK.post('/settings', { patch: a.prevSettings }); await STK.loadSettings(); } catch (e) { /* ignore */ } }
}
function refreshIfOpen() { if (state.view === 'studio' && S.tab === 'games') SX.refresh(); }
STK.on('live', ({ L }) => {
  const serial = STK.sel(); if (!serial || !L) return;
  const a = G.active[serial];
  if (a) { a.temps.push(L.tempC); if (L.tempC != null) a.peak = Math.max(a.peak, L.tempC); }
  const o = SX.opts();
  if (a) {
    if (L.tempC != null && L.tempC >= o.hot && Date.now() - G.heatAt > 300000) { G.heatAt = Date.now(); STK.toast('The phone is hot (' + L.tempC + ' °C). Take a short break or switch to the Cool profile.', 'bad', { label: 'Cool down', run: () => SX.cooldown() }); STK.notify && STK.notify('Phone is hot', L.tempC + ' °C while gaming', 'gheat'); }
    if (L.battery >= 0 && L.battery <= 15 && !L.charging && Date.now() - G.lowAt > 600000) { G.lowAt = Date.now(); STK.toast('Battery is at ' + L.battery + '%. Plug the phone in to keep playing.', 'bad'); }
  }
  const pkg = L.fgPackage;
  if (!a) { const g = games().find(x => x.pkg === pkg && x.on !== false); if (g && pkg) enter(serial, g); }
  else if (pkg && pkg !== a.pkg) { G.misses[serial] = (G.misses[serial] || 0) + 1; if (G.misses[serial] >= 2) exit(serial); }
  else G.misses[serial] = 0;
});

/* ---------- frame monitor ---------- */
function fmStop() { F.on = false; clearInterval(F.timer); F.timer = null; F.prev = null; paintFm(); }
async function fmTick() {
  const id = STK.sel(); if (!id || !F.on) return;
  if (state.view !== 'studio' || document.hidden) return;
  try {
    const r = await STK.api('/game-stats?id=' + encodeURIComponent(id) + '&pkg=' + encodeURIComponent(F.pkg), { timeout: 25000 });
    const now = Date.now(); F.last = r; F.note = '';
    if (!r.running) F.note = 'The phone has no frame data for this app yet. Open the game and play for a moment.';
    if (F.prev && r.frames >= F.prev.frames) {
      const d = r.frames - F.prev.frames, dj = r.janky - F.prev.janky, dt = (now - F.prev.t) / 1000;
      if (d > 0) { F.jank.push(Math.min(100, dj / d * 100)); F.fps.push(Math.min(240, d / dt)); } else { F.fps.push(0); F.jank.push(null); }
      if (F.jank.length > 60) { F.jank.shift(); F.fps.shift(); }
    }
    F.p50.push(r.p50); if (F.p50.length > 60) F.p50.shift();
    F.prev = { frames: r.frames, janky: r.janky, t: now };
  } catch (e) { F.note = e.message; }
  paintFm(); SX.paintHeroSoon && SX.paintHeroSoon();
}
function fmStart(pkg) {
  if (!pkg) return;
  F.pkg = pkg; F.on = true; F.prev = null; F.jank = []; F.fps = []; F.p50 = []; F.last = null; F.note = '';
  SX.tool({ action: 'resetstats', pkg }, { quiet: true }).catch(() => {});
  clearInterval(F.timer); F.timer = setInterval(fmTick, 3000); setTimeout(fmTick, 800); paintFm();
}
SX.jank = () => (F.on && F.jank.length ? F.jank.filter(x => x != null).slice(-3).reduce((a, b, _, arr) => a + b / arr.length, 0) : null);
function paintFm() {
  const el = document.getElementById('w-fm'); if (!el) return;
  const r = F.last, jk = F.jank.filter(x => x != null), fps = F.fps.length ? F.fps[F.fps.length - 1] : null;
  const jnow = jk.length ? jk[jk.length - 1] : null;
  const tile = (l, v, s, t = '') => `<div class="sx-fmt ${t}"><small>${l}</small><b>${v}</b><span>${s}</span></div>`;
  const head = `<div class="sx-fmbar"><div><b>${F.on ? esc(KNOWN[F.pkg] || nice(F.pkg)) : 'Frame monitor is off'}</b><small>${F.on ? F.pkg : 'Watch how smoothly an app draws its frames, live.'}</small></div>${F.on ? `<button class="btn sm" type="button" data-sx="fmstop">${icon('stop', 'sm')}<span>Stop</span></button><button class="btn sm" type="button" data-sx="fmreset">Reset counters</button>` : `<button class="btn sm primary" type="button" data-sx="fmstart">${icon('pulse', 'sm')}<span>Monitor ${esc(SX.pkg() ? (KNOWN[SX.pkg()] || nice(SX.pkg())) : 'current app')}</span></button>`}</div>`;
  if (!F.on) { STK.setHtml(el, head + `<p class="hint">Tip: start it, switch to the game on the phone and play for a bit. Games that draw with their own engine may report little here.</p>`); return; }
  const jt = jnow == null ? '' : jnow >= 15 ? 'bad' : jnow >= 5 ? 'warn' : 'ok';
  STK.setHtml(el, head + `<div class="sx-fmgrid">${tile('Frames per second', fps == null ? '--' : Math.round(fps), 'Measured live', fps != null && fps < 24 ? 'warn' : '')}${tile('Janky frames', jnow == null ? '--' : jnow.toFixed(0) + '%', 'Right now', jt)}${tile('Typical frame', r && r.p50 != null ? r.p50 + ' ms' : '--', 'Under 16 ms is 60 fps', '')}${tile('Slow frames', r && r.p95 != null ? r.p95 + ' ms' : '--', '95th percentile', r && r.p95 >= 33 ? 'warn' : '')}</div>
    <div class="sx-fmcharts"><div><small>Frames per second</small>${SX.spark(F.fps, { min: 0, max: Math.max(60, ...F.fps.filter(x => x != null)), cls: 'cool' })}</div><div><small>Janky frames %</small>${SX.spark(F.jank, { min: 0, max: Math.max(20, ...F.jank.filter(x => x != null)), cls: 'warn' })}</div></div>${F.note ? `<p class="hint">${esc(F.note)}</p>` : ''}`);
}

/* ---------- sessions ---------- */
function sessionsHtml() {
  const ss = sessions(); if (!ss.length) return `<div class="sx-empty small">${icon('clock')}<b>No sessions yet</b><p>After you play one of your games for a while, a report with time, temperature and battery use appears here.</p></div>`;
  return `<div class="sx-sess"><div class="hd"><span>Game</span><span>When</span><span>Length</span><span>Temperature</span><span>Battery</span></div>${ss.slice(0, 10).map(s => { const used = s.bat0 != null && s.bat1 != null ? s.bat0 - s.bat1 : null; const pr = SX.PROFILES.find(p => p.id === s.profile); return `<div class="rw"><span class="g"><b>${esc(s.name || nice(s.pkg))}</b>${pr ? `<small>${esc(pr.name)} profile</small>` : ''}</span><span>${esc(STK.ago(s.t0))}</span><span>${esc(fmtDur(s.secs))}</span><span class="${SX.tone('temp', s.peakT)}">${s.avgT != null ? 'avg ' + s.avgT.toFixed(0) + '° · peak ' + s.peakT.toFixed(0) + '°' : '-'}</span><span>${used == null ? '-' : used > 0 ? '-' + used + '%' : used === 0 ? 'no change' : '+' + (-used) + '%'}</span></div>`; }).join('')}</div>`;
}
function activeHtml() {
  const id = STK.sel(), a = G.active[id];
  const r = SX.last();
  if (!a) return `<div class="sx-note">${icon('info', 'sm')}<span>Waiting for one of your games to open. When it does, its profile switches on here automatically. This works while the dashboard is open.</span></div>`;
  return `<div class="sx-now"><span class="av" style="--h:${hue(a.pkg)}">${esc(initials(gname(a.g)))}</span><div><b>${esc(gname(a.g))}</b><small>Playing for ${esc(fmtDur((Date.now() - a.startedAt) / 1000))}</small></div></div>${SX.kv([['Peak temperature', a.peak ? a.peak.toFixed(1) + ' °C' : '-', SX.tone('temp', a.peak)], ['Now', r && r.tempC != null ? r.tempC.toFixed(1) + ' °C' : '-', r ? SX.tone('temp', r.tempC) : ''], ['Battery at start', a.bat0 != null && a.bat0 >= 0 ? a.bat0 + '%' : '-'], ['Profile', a.g.profile ? esc((SX.PROFILES.find(p => p.id === a.g.profile) || {}).name || a.g.profile) : 'None']])}`;
}
SX.register({ id: 'games', label: 'Games', icon: 'game', order: 4,
  render: () => `<div class="sx-grid">
    ${SX.card('span-12', 'Your game library', 'Studio switches on a profile by itself when one of these opens, and restores everything when you leave.', '<div id="w-gsum"></div><div id="w-glib"></div>', `<button class="btn primary" type="button" data-sx="gadd">${icon('game', 'sm')}<span>Add a game</span></button>`)}
    ${SX.card('span-8', 'Frame monitor', 'Frames per second and stutter, measured on the phone.', '<div id="w-fm"></div>')}
    ${SX.card('span-4', 'Right now', 'The game Studio is looking after.', '<div id="w-gnow"></div>')}
    ${SX.card('span-12', 'Recent sessions', 'Play time, temperature and battery use for each game session.', '<div id="w-gses"></div>')}
  </div>`,
  paint() { SX.W('w-gsum', summaryHtml()); SX.W('w-glib', libraryHtml()); paintFm(); SX.W('w-gnow', activeHtml()); SX.W('w-gses', sessionsHtml()); },
  onShow() { SX.ensureApps().then(() => { if (state.view === 'studio' && S.tab === 'games') SX.refresh(); }); }
});

Object.assign(SX.actions, {
  gadd: () => editGame(-1),
  gedit: t => editGame(Number(t.dataset.i)),
  gdel: async t => { const i = Number(t.dataset.i), g = games()[i]; if (!g) return; if (!await STK.confirmDelete('Remove this game?', `<p><b>${esc(gname(g))}</b> will be removed from your list. The game itself is not touched.</p>`, 'Remove')) return; const l = games().slice(); l.splice(i, 1); STK.kv.set('games', l); SX.refresh(); },
  gquick: t => { const pkg = t.dataset.pkg; const l = games().slice(); l.push({ pkg, name: KNOWN[pkg] || '', profile: 'gaming', preset: 'latency', mirror: false, record: false, dnd: true, touches: false, freemem: true, gamemode: false, on: true }); STK.kv.set('games', l.slice(0, 30)); STK.toast((KNOWN[pkg] || pkg) + ' added with the Gaming profile.'); SX.refresh(); },
  glaunch: t => { const g = games()[Number(t.dataset.i)]; if (g) return STK.busy(t, () => SX.tool({ action: 'launch', pkg: g.pkg })); },
  gopt: t => { const g = games()[Number(t.dataset.i)]; if (g) return STK.busy(t, () => SX.tool({ action: 'dexopt', pkg: g.pkg }, { timeout: 260000 })); },
  gmon: t => { const g = games()[Number(t.dataset.i)]; if (g) { SX.setPkg(g.pkg); fmStart(g.pkg); STK.toast('Monitoring ' + gname(g) + '. Switch to it on the phone.'); } },
  fmstart: () => { const p = SX.needPkg(); if (p) fmStart(p); },
  fmstop: () => fmStop(),
  fmreset: t => { if (F.pkg) return STK.busy(t, async () => { await SX.tool({ action: 'resetstats', pkg: F.pkg }); F.prev = null; F.jank = []; F.fps = []; F.p50 = []; paintFm(); }); }
});
Object.assign(SX.changes, { gon: t => { const i = Number(t.dataset.i), l = games().slice(); l[i] = { ...l[i], on: t.checked }; STK.kv.set('games', l); } });
STK.on('view', v => { if (v !== 'studio' && F.on) fmStop(); });
STK.on('device-changed', () => { fmStop(); F.last = null; });
setInterval(() => { if (state.view === 'studio' && S.tab === 'games' && G.active[STK.sel()]) SX.W('w-gnow', activeHtml()); }, 5000);
})();
