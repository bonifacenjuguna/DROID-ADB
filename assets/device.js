/* Phone card (Console): a framed, orientation-aware picture of the phone with its live status.
 *
 *  - Preview engine: one request at a time, decoded before it is shown, cross-faded, object URLs always revoked.
 *  - Live status: battery and screen rotation from /api/device-live, so the layout follows the phone
 *    even when no picture is being refreshed.
 *  - Orientation: when the phone rotates the frame turns like the real device while the card and the
 *    panels around it glide to their new places (FLIP animation, skipped for reduced motion).
 */
(() => {
'use strict';
const { $, esc, icon, bytes, state } = STK;
const setHtml = STK.setHtml;
const enc = encodeURIComponent;

const el = {
  card: $('#devcard'), bg: $('#dc-bg'), grid: $('#console-grid'), phone: $('#phone'), screen: $('#screen'), a: $('#scr-a'), b: $('#scr-b'),
  ovl: $('#scr-ovl'), ovlIc: $('#ovl-ic'), ovlTitle: $('#ovl-title'), ovlText: $('#ovl-text'), bar: $('#scr-bar'),
  ctl: $('#dc-ctl'), tags: $('#dc-tags'), live: $('#preview-live'), now: $('#preview-now'), note: $('#preview-note'),
  id: $('#stage-id'), batt: $('#dc-batt'), ring: $('#ring-fg'), bolt: $('#ring-bolt'), battVal: $('#batt-val'), battState: $('#batt-state'), battMeta: $('#batt-meta'),
  specs: $('#stage-specs'), actions: $('#stage-actions'), quick: $('#quickline'), sr: $('#dc-sr'),
  remote: $('#remote'), captures: $('#captures'), side: $('#side')
};

const DUR = 520;                                   // orientation animation length (ms)
const EASE = 'cubic-bezier(.32, 0, .12, 1)';

/* ---------- helpers ---------- */
const txt = (node, t) => { if (node._t !== t) { node._t = t; node.textContent = t; } };
const norm = d => { d = ((d % 360) + 360) % 360; return d > 180 ? d - 360 : d; };
const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const orientOf = (w, h) => (w > h ? 'landscape' : 'portrait');
const setting = (k, d) => { const v = state.settings && state.settings[k]; return v === undefined || v === null ? d : v; };
const liveOn = () => el.live.checked;
const natural = id => { const i = state.info[id]; return i && i.width > 0 && i.height > 0 ? { w: i.width, h: i.height } : null; };
let lastSay = '';
function announce(msg) { if (msg === lastSay) return; lastSay = msg; txt(el.sr, msg); }

/* ---------- state ---------- */
const D = {                       // what the card shows for the selected phone
  id: '', gone: false, laid: false, rot: 0, orient: 'portrait', w: 0, h: 0, ar: 0.45, stamp: 0, turn: 0,
  img: null, front: null, pending: null, pendingEl: null, fadeT: 0, delayT: 0, lastLive: null, flipUntil: 0, noInfo: 0
};
const P = {                       // preview requests
  busy: null, ctl: null, seq: 0, fails: 0, err: '', slow: false, lastTry: 0, lastOk: 0, timer: 0, again: false, owed: ''
};
const L = { timer: 0, busy: false, seq: 0, fails: 0, lat: 0, at: 0 };   // live status polling
const V = { visible: true };                                           // is the card on screen

/* ---------- geometry and layout ---------- */
function setGeometry(w, h) {
  let ar = w / h;
  ar = Math.min(5, Math.max(0.2, ar));
  D.w = w; D.h = h; D.ar = ar;
  // Frame aspect ratio for a uniform bezel of 3.5% of the short side, so the screen keeps exactly the phone's ratio.
  const far = ar < 1 ? 1 / (0.93 / ar + 0.07) : 0.93 * ar + 0.07;
  el.card.style.setProperty('--ar', ar.toFixed(4));
  el.card.style.setProperty('--far', far.toFixed(4));
}
function setLayout(orient, rot) {
  D.orient = orient; D.rot = rot;
  el.card.dataset.orient = orient; el.grid.dataset.orient = orient;
  el.phone.dataset.rot = String(rot);
}
function setTurn(img, deg) {
  D.turn = deg;
  if (Math.abs(deg) < 1) { img.classList.remove('is-turned', 'swap'); img.style.removeProperty('--turn'); return; }
  img.classList.add('is-turned');
  img.classList.toggle('swap', Math.abs(Math.abs(deg) - 90) < 1);
  img.style.setProperty('--turn', deg + 'deg');
}

/* A new reading of the phone's orientation. src: 'live' (adb) or 'png' (a picture just arrived). */
function applySample(id, s, at, src) {
  if (id !== D.id || at < D.stamp) return;
  const nat = natural(id);
  const natLand = nat ? nat.w > nat.h : false;
  let w = s.w || 0, h = s.h || 0;
  let rot = Number.isInteger(s.rot) ? s.rot & 3 : null;
  let orient;
  if (w > 0 && h > 0) orient = orientOf(w, h);
  else if (rot !== null && nat) {
    const odd = rot % 2 === 1;
    orient = (odd ? !natLand : natLand) ? 'landscape' : 'portrait';
    w = odd ? nat.h : nat.w; h = odd ? nat.w : nat.h;
  } else if (nat) { orient = orientOf(nat.w, nat.h); w = nat.w; h = nat.h; rot = 0; }
  else return;                                   // nothing to go on yet; try again when details load
  if (rot === null) rot = orient === (natLand ? 'landscape' : 'portrait') ? 0 : (D.rot % 2 === 1 ? D.rot : 1);
  D.stamp = at;
  commitDisplay(orient, rot, w, h, src);
}
function commitDisplay(orient, rot, w, h, src) {
  if (!D.laid) { D.laid = true; setLayout(orient, rot); setGeometry(w, h); announceLayout(false); return; }
  const turned = orient !== D.orient || rot !== D.rot;
  if (!turned) { if (Math.abs(w / h - D.ar) > 0.003) setGeometry(w, h); return; }
  rotateTo(orient, rot, w, h);
  announceLayout(true);
  if (src === 'live') setTimeout(() => autoCapture('rotate'), reduced() ? 150 : 550);
}
function announceLayout(changed) {
  if (!D.laid) return;
  announce((changed ? 'Phone rotated to ' : 'Phone is in ') + D.orient + '.');
}

/* ---------- orientation animation (FLIP) ---------- */
let running = [];
function finishFlip() {
  running.forEach(a => { try { a.finish(); } catch (e) { /* already gone */ } });
  running = [];
  el.card.classList.remove('is-flipping');
}
const canAnimate = () => !reduced() && !document.hidden && state.view === 'console' && D.laid && el.card.offsetParent !== null;
const rectOf = node => { if (!node || node.hidden || node.offsetParent === null) return null; const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };

function rotateTo(orient, rot, w, h) {
  finishFade();
  finishFlip();
  const d = (rot - D.rot + 4) % 4;
  const turn = d === 1 ? 90 : d === 3 ? -90 : 180;      // the new frame starts turned this far, then settles
  const mutate = () => {
    setLayout(orient, rot);
    setGeometry(w, h);
    if (D.front) setTurn(D.front, norm(D.turn - turn)); // old picture keeps its apparent angle until a new one arrives
    renderDevice();                                     // text for the new orientation must be in place before the final layout is measured
  };
  if (!canAnimate()) { mutate(); return; }
  const track = { card: el.card, phone: el.phone, ctl: el.ctl, id: el.id, batt: el.batt, specs: el.specs, actions: el.actions, quick: el.quick, remote: el.remote, captures: el.captures, side: el.side };
  const first = {}; Object.keys(track).forEach(k => { first[k] = rectOf(track[k]); });
  mutate();
  const last = {}; Object.keys(track).forEach(k => { last[k] = rectOf(track[k]); });
  play(first, last, turn);
}

function play(f, l, turn) {
  if (!f.card || !l.card || !f.phone || !l.phone) return;
  const opt = { duration: DUR, easing: EASE };
  const seq = { duration: DUR, easing: 'linear', fill: 'backwards' };   // keyframes carry their own easing
  const anims = [];
  el.card.classList.add('is-flipping');
  D.flipUntil = Date.now() + DUR;
  // Sequencing keeps the card from sliding over the side column: when the card widens, everything first moves
  // out of its way vertically and the card widens last; when it narrows, it narrows first and the rest follows.
  const widening = l.card.w >= f.card.w;
  const VF = 0.6, WF = 0.45;
  const vertical = (a, b) => widening
    ? [{ ...a, offset: 0, easing: EASE }, { ...b, offset: VF }, { ...b, offset: 1 }]
    : [{ ...a, offset: 0 }, { ...a, offset: 1 - VF, easing: EASE }, { ...b, offset: 1 }];
  const horizontal = (a, b) => widening
    ? [{ ...a, offset: 0 }, { ...a, offset: 1 - WF, easing: EASE }, { ...b, offset: 1 }]
    : [{ ...a, offset: 0, easing: EASE }, { ...b, offset: WF }, { ...b, offset: 1 }];
  // The card surface changes size for real (no scaling), so its edges and corners never distort. The layout box
  // of the card is already final, so the panels around it only need a matching slide.
  anims.push(el.bg.animate(vertical(
    { height: f.card.h + 'px', transform: `translate(${f.card.x - l.card.x}px, ${f.card.y - l.card.y}px)` },
    { height: l.card.h + 'px', transform: 'translate(0px, 0px)' }), seq));
  anims.push(el.bg.animate(horizontal({ width: f.card.w + 'px' }, { width: l.card.w + 'px' }), seq));
  // The phone turns like the real device: the new frame starts at the old frame's place and angle.
  const swap = Math.abs(turn) === 90;
  const s = swap ? (f.phone.w / l.phone.h + f.phone.h / l.phone.w) / 2 : (f.phone.w / l.phone.w + f.phone.h / l.phone.h) / 2;
  const tx = (f.phone.x + f.phone.w / 2) - (l.phone.x + l.phone.w / 2);
  const ty = (f.phone.y + f.phone.h / 2) - (l.phone.y + l.phone.h / 2);
  anims.push(el.phone.animate([
    { transform: `translate(${tx}px, ${ty}px) rotate(${turn}deg) scale(${s})` },
    { transform: 'translate(0px, 0px) rotate(0deg) scale(1)' }
  ], opt));
  // Controls under the phone travel with it. The details on the right fade and rise into their new
  // arrangement instead of crossing each other, so text never overlaps or stretches mid-flight.
  if (f.ctl && l.ctl) {
    const dx = f.ctl.x - l.ctl.x, dy = f.ctl.y - l.ctl.y;
    if (Math.abs(dx) + Math.abs(dy) >= 1) anims.push(el.ctl.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }], opt));
  }
  ['id', 'batt', 'specs', 'actions', 'quick'].forEach(k => {
    if (!f[k] || !l[k]) return;
    anims.push(el[k].animate([
      { opacity: 0, transform: 'translateY(10px)' },
      { opacity: 0, transform: 'translateY(10px)', offset: 0.28 },
      { opacity: 1, transform: 'translateY(0px)' }
    ], opt));
  });
  // Panels around the card only move.
  const vh = window.innerHeight;
  ['remote', 'captures', 'side'].forEach(k => {
    if (!f[k] || !l[k]) return;
    const dx = f[k].x - l[k].x, dy = f[k].y - l[k].y;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    if (f[k].y > vh + 300 && l[k].y > vh + 300) return;          // nowhere near the screen
    anims.push(el[k].animate(vertical({ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }), seq));
  });
  running = anims;
  Promise.allSettled(anims.map(a => a.finished)).then(() => {
    if (running === anims) { running = []; el.card.classList.remove('is-flipping'); }
  });
}

/* ---------- picture layers (two images so a new picture never flashes) ---------- */
function finishFade() {
  clearTimeout(D.fadeT); clearTimeout(D.delayT);
  if (!D.pendingEl) return;
  const back = D.pendingEl, old = D.front, oldRec = D.img;
  back.classList.add('is-front'); back.classList.remove('is-top');
  D.front = back; D.img = D.pending; D.pendingEl = null; D.pending = null; D.turn = 0;
  if (old && old !== back) {
    old.classList.remove('is-front', 'is-top', 'is-turned', 'swap'); old.style.removeProperty('--turn');
    old.hidden = true; old.removeAttribute('src');
  }
  if (oldRec) URL.revokeObjectURL(oldRec.url);
}
function discard(layer, rec) {
  layer.hidden = true; layer.removeAttribute('src');
  URL.revokeObjectURL(rec.url);
}
function clearImages() {
  finishFade();
  [el.a, el.b].forEach(n => { n.classList.remove('is-front', 'is-top', 'is-turned', 'swap'); n.style.removeProperty('--turn'); n.hidden = true; n.removeAttribute('src'); });
  if (D.img) URL.revokeObjectURL(D.img.url);
  D.img = null; D.front = null; D.turn = 0;
}
function startFade(back, rec, delay) {
  D.pending = rec; D.pendingEl = back;
  back.hidden = false; back.classList.add('is-top');
  void back.offsetWidth;                                   // paint at opacity 0 first so the fade runs
  const go = () => { if (D.pendingEl !== back) return; back.classList.add('is-front'); D.fadeT = setTimeout(finishFade, 340); };
  if (delay > 0) D.delayT = setTimeout(go, delay); else go();
}

/* A decoded picture arrived. Takes ownership of rec.url (revoked here on every path that does not show it). */
async function commitFrame(rec) {
  finishFade();
  const back = D.front === el.a ? el.b : el.a;
  back.classList.remove('is-front', 'is-top', 'is-turned', 'swap'); back.style.removeProperty('--turn');
  back.src = rec.url;
  try { await back.decode(); }
  catch (e) { back.hidden = true; back.removeAttribute('src'); URL.revokeObjectURL(rec.url); throw new Error('The browser could not read the picture from the phone.'); }
  if (rec.id !== D.id || rec.seq !== P.seq) { discard(back, rec); return; }      // phone changed while decoding
  rec.w = back.naturalWidth; rec.h = back.naturalHeight; rec.orient = orientOf(rec.w, rec.h);
  let delay = 0;
  if (!D.laid) {
    const nat = natural(rec.id);
    D.laid = true; D.stamp = Math.max(D.stamp, rec.at);
    setLayout(rec.orient, rec.orient === (nat ? orientOf(nat.w, nat.h) : 'portrait') ? 0 : 1);
    setGeometry(rec.w, rec.h);
  } else if (rec.orient !== D.orient) {
    if (rec.at < D.stamp) { discard(back, rec); P.again = true; return; }       // taken before the phone rotated: stale
    applySample(rec.id, { w: rec.w, h: rec.h, rot: null }, rec.at, 'png');
    delay = Date.now() < D.flipUntil ? Math.round(DUR * 0.4) : 0;
  } else {
    D.stamp = Math.max(D.stamp, rec.at);
    if (Math.abs(rec.w / rec.h - D.ar) > 0.003) setGeometry(rec.w, rec.h);
  }
  startFade(back, rec, delay);
}

/* ---------- preview requests ---------- */
function ready() { return !!STK.current() && state.online && !D.gone; }
function screenOff() { return !!(STK.keys && STK.keys.screenOn === false); }
function pauseReason() {
  if (document.hidden) return 'tab hidden';
  if (state.view !== 'console') return 'page not shown';
  if (!V.visible) return 'scrolled out of view';
  if (!STK.sel()) return 'no phone';
  if (!state.online) return 'backend offline';
  if (screenOff()) return 'screen off';
  return '';
}
const canCapture = () => !pauseReason();

function abortPreview() {
  P.seq++;
  if (P.ctl) { try { P.ctl.abort(); } catch (e) { /* ignore */ } }
}

function capture(reason) {
  if (P.busy) { if (reason === 'rotate') P.again = true; return P.busy; }          // never two requests at once
  const id = STK.sel();
  if (!id) return Promise.resolve(false);
  const seq = ++P.seq, t0 = Date.now();
  const ctl = new AbortController();
  P.ctl = ctl; P.lastTry = t0; P.owed = '';
  const kill = setTimeout(() => ctl.abort(), 30000);
  const slow = setTimeout(() => { P.slow = true; renderNote(viewState()); }, 5000);
  P.busy = (async () => {
    let ok = false;
    try {
      const res = await fetch('/api/preview-image?id=' + enc(id) + '&t=' + t0, { cache: 'no-store', signal: ctl.signal });
      if (!res.ok) { let m = 'The preview failed.'; try { m = (await res.json()).error || m; } catch (e) { /* not json */ } throw new Error(m); }
      const blob = await res.blob();
      if (seq !== P.seq || id !== D.id) return false;                              // switched phone or disconnected meanwhile
      if (!blob.size) throw new Error('The phone sent an empty picture.');
      await commitFrame({ url: URL.createObjectURL(blob), at: t0, id, seq });
      P.err = ''; P.fails = 0; P.lastOk = Date.now(); ok = true;
    } catch (e) {
      if (seq !== P.seq) return false;                                              // cancelled on purpose
      P.fails++;
      P.err = e.name === 'AbortError' ? 'The phone took too long to answer.' : (e.message || 'The preview failed.');
    } finally {
      clearTimeout(kill); clearTimeout(slow);
      P.slow = false; P.ctl = null; P.busy = null;
      renderDevice();
      if (P.again && canCapture()) { P.again = false; setTimeout(() => autoCapture('rotate'), 120); } else P.again = false;
    }
    return ok;
  })();
  renderDevice();
  return P.busy;
}

/* One picture without being asked (connect, rotate, screen on). Never fires while the card cannot be seen. */
function autoCapture(reason) {
  if (!STK.sel()) return;
  if (!(setting('previewOnConnect', true) || liveOn() || D.img)) return;
  if (!canCapture()) { P.owed = reason; return; }
  if (P.busy) { if (reason === 'rotate') P.again = true; return; }
  if (reason !== 'rotate' && Date.now() - P.lastTry < 3000) return;                 // do not hammer a flapping phone
  capture(reason);
}

function liveDelay() { return Math.max(1, setting('previewSeconds', 3)) * 1000; }
function scheduleLive(ms) { clearTimeout(P.timer); P.timer = 0; if (liveOn()) P.timer = setTimeout(liveTick, ms); }
async function liveTick() {
  P.timer = 0;
  if (!liveOn()) return;
  if (!canCapture()) { scheduleLive(1500); return; }                                // paused: no request, check again shortly
  const base = liveDelay();
  const wait = P.lastTry ? base - (Date.now() - P.lastTry) : 0;
  if (wait > 250 && !P.fails) { scheduleLive(wait); return; }                       // a manual or automatic picture was just taken
  const ok = await capture('live');
  if (!liveOn()) return;
  if (!ok && P.fails >= 5) {
    el.live.checked = false; STK.store.set('preview-live', false);
    STK.toast('Live preview was turned off after repeated errors. Update still works.', 'bad');
    renderDevice(); return;
  }
  scheduleLive(ok ? base : Math.min(30000, base * Math.pow(2, P.fails)));
}
function resumeLive() { if (liveOn() && !P.busy) scheduleLive(0); }

async function manualUpdate() {
  if (!STK.sel()) { STK.toast('Connect a phone first.', 'bad'); return; }
  await STK.busy(el.now, async () => { const ok = await capture('manual'); STK.flash(el.now, ok); });
}
function setLive(on) {
  el.live.checked = on; STK.store.set('preview-live', on);
  if (on) { P.fails = 0; P.err = ''; scheduleLive(0); } else { clearTimeout(P.timer); P.timer = 0; }
  renderDevice();
}

/* ---------- live status: battery and rotation ---------- */
function wantsStatus() { return !document.hidden && state.view === 'console' && V.visible && !!STK.sel() && state.online && !D.gone; }
function kickStatus() { clearTimeout(L.timer); L.timer = setTimeout(statusTick, 0); }
async function statusTick() {
  clearTimeout(L.timer); L.timer = 0;
  if (!wantsStatus()) { L.timer = setTimeout(statusTick, 2000); return; }
  if (L.busy) return;
  const id = STK.sel(), t0 = Date.now(), seq = ++L.seq;
  L.busy = true;
  let ok = false;
  try {
    const r = await STK.api('/device-live?id=' + enc(id), { timeout: 15000 });
    if (seq === L.seq && id === D.id) { mergeLive(id, r.live, t0); ok = true; }
  } catch (e) { /* counted below */ }
  L.busy = false;
  if (ok) { L.fails = 0; L.lat = Date.now() - t0; } else L.fails++;
  let ms = Math.max(2, setting('deviceLiveSeconds', 3)) * 1000;
  ms = Math.max(ms, L.lat * 2.5);                                                   // back off when adb is slow
  if (screenOff()) ms = Math.max(ms, 10000);
  if (L.fails) ms = Math.min(20000, ms * Math.pow(2, L.fails));
  L.timer = setTimeout(statusTick, ms);
}
function mergeLive(id, live, t0) {
  if (!live) return;
  const inf = state.info[id];
  let changed = false;
  if (inf && !inf.error) {
    ['battery', 'charging', 'chargeState', 'plugged', 'tempC', 'voltage', 'power'].forEach(k => {
      if (live[k] !== undefined && inf[k] !== live[k]) { inf[k] = live[k]; changed = true; }
    });
  }
  D.lastLive = { s: { rot: live.rotation, w: live.width, h: live.height }, at: t0 };
  const informs = Number.isInteger(live.rotation) || live.width > 0;
  if (informs) { D.noInfo = 0; applySample(id, D.lastLive.s, t0, 'live'); }
  else if (!D.laid && ++D.noInfo >= 2 && !P.busy) applySample(id, D.lastLive.s, t0, 'live');   // adb cannot tell: fall back to the natural size
  if (changed) STK.emit('info', id); else renderDevice();
}

/* ---------- phone changes ---------- */
function startDevice(id) {
  abortPreview(); clearImages();
  Object.assign(D, { id, gone: false, laid: false, rot: 0, orient: 'portrait', stamp: 0, turn: 0, lastLive: null, noInfo: 0 });
  P.err = ''; P.fails = 0; P.again = false; P.lastTry = 0; P.lastOk = 0; P.owed = ''; L.fails = 0; L.seq++;
  el.card.dataset.orient = 'portrait'; el.grid.dataset.orient = 'portrait'; el.phone.dataset.rot = '0';
  el.card.style.removeProperty('--ar'); el.card.style.removeProperty('--far');
  setTimeout(() => { kickStatus(); autoCapture('connect'); if (liveOn()) scheduleLive(800); }, 0);
}
function syncDevice() {
  const cur = STK.current(), id = cur ? cur.id : '';
  if (id && id !== D.id) startDevice(id);
  else if (id && D.gone) { D.gone = false; announce('Phone reconnected.'); setTimeout(() => { kickStatus(); autoCapture('connect'); resumeLive(); }, 0); }
  else if (!id && D.id && !D.gone) { D.gone = true; abortPreview(); announce('Phone disconnected.'); }
}

/* ---------- view state and rendering ---------- */
function viewState() {
  const dev = STK.current();
  if (!state.everOnline && !state.online) return { key: 'connecting' };
  if (!state.online && state.failures >= 3) return { key: 'backend' };
  if (!dev) { const needs = state.devices.find(d => d.state !== 'device'); return needs ? { key: 'unavailable', needs } : { key: 'disconnected' }; }
  if (!D.img) return { key: P.busy ? 'loading' : (P.err ? 'error' : 'idle') };
  return { key: screenOff() ? 'screenoff' : 'ok' };
}
function overlayFor(v) {
  const has = !!D.img;
  switch (v.key) {
    case 'connecting': return { ic: 'spin', t: 'Connecting', x: 'Waiting for the local backend.' };
    case 'backend': return { ic: icon('alert'), t: 'Backend not answering', x: has ? 'Retrying. The last picture is kept.' : 'Retrying automatically.', dim: true };
    case 'unavailable': {
      const un = v.needs.state === 'unauthorized';
      return { ic: icon(un ? 'lock' : 'plug'), t: un ? 'Waiting for permission' : 'Phone not ready', x: un ? 'Unlock the phone and accept the USB debugging prompt.' : 'The phone shows as ' + v.needs.state + '. Reconnect the cable or restart ADB.', dim: true };
    }
    case 'disconnected': return { ic: icon('plug'), t: has ? 'Disconnected' : 'No phone connected', x: has ? 'Showing the last picture.' : 'Connect a phone with USB debugging turned on.', dim: true };
    case 'loading': return { ic: 'spin', t: 'Reading the screen', x: '' };
    case 'error': return { ic: icon('alert'), t: 'No picture', x: P.err };
    case 'idle': return { ic: icon('image'), t: 'No picture yet', x: 'Press Update to see the phone screen here.' };
    case 'screenoff': return { ic: icon('moon'), t: 'Screen is off', x: 'Live updates pause until it is on.', dim: true };
    default: return null;
  }
}
function renderScreen(v) {
  const has = !!D.img, o = overlayFor(v);
  el.card.dataset.pv = v.key;
  el.screen.classList.toggle('is-dim', !!(o && o.dim && has));
  el.ovl.classList.toggle('on', !!o);
  el.ovl.classList.toggle('solid', !!o && !has);
  if (o) {
    setHtml(el.ovlIc, o.ic === 'spin' ? '<i class="spin"></i>' : o.ic);
    txt(el.ovlTitle, o.t); txt(el.ovlText, o.x || '');
  }
  const busy = !!P.busy && has && !o;
  el.bar.dataset.on = busy ? '1' : '';
  el.bar.dataset.tone = P.err && has && !busy ? 'bad' : '';
  const dev = STK.current(), info = STK.info();
  const name = dev ? (info && info.model ? deviceName(info) : dev.id) : 'Phone';
  const label = name + ' screen, ' + D.orient + (o ? '. ' + o.t : (liveOn() ? '. Live preview' : ''));
  if (el.phone._l !== label) { el.phone._l = label; el.phone.setAttribute('aria-label', label); }
}
function renderNote(v) {
  let t;
  const age = D.img ? STK.ago(D.img.at) : '';
  if (!v) v = viewState();
  if (v.key === 'ok' || v.key === 'screenoff') {
    if (P.busy) t = P.slow ? 'Still waiting for the phone...' : 'Updating...';
    else if (P.err) t = 'Could not update: ' + P.err;
    else {
      t = (v.key === 'screenoff' ? 'Screen is off. Last picture ' : 'Updated ') + age;
      if (liveOn()) { const why = pauseReason(); t += why ? ' · live paused (' + why + ')' : ' · live every ' + Math.round(liveDelay() / 1000) + ' s'; }
    }
  } else if (v.key === 'loading') t = P.slow ? 'Still waiting for the phone...' : 'Reading the screen...';
  else if (v.key === 'error') t = 'Could not get a picture: ' + P.err;
  else if (v.key === 'idle') t = 'Press Update for a picture of the screen.';
  else if (v.key === 'connecting') t = 'Waiting for the backend.';
  else if (v.key === 'backend') t = 'The backend is not answering.';
  else if (v.key === 'unavailable') t = 'The phone is not ready.';
  else t = D.img ? 'Disconnected. Last picture ' + age : 'No phone connected.';
  txt(el.note, t);
  el.note.classList.toggle('bad', !!P.err && !P.busy && (v.key === 'ok' || v.key === 'screenoff' || v.key === 'error'));
  el.now.disabled = !STK.sel();
}
function renderTags(dev) {
  const tags = [], rec = STK.recording(), mir = STK.mirroring();
  if (dev && D.laid) tags.push(`<span class="chip sm" title="Phone orientation">${icon('rotate', 'sm')}<b>${D.orient === 'landscape' ? 'Landscape' : 'Portrait'}${D.rot ? ' · ' + D.rot * 90 + '°' : ''}</b></span>`);
  if (dev && liveOn()) tags.push(`<span class="chip sm ok"><i class="dot"></i><b>Live</b></span>`);
  if (rec) tags.push(`<span class="chip sm rec"><i class="dot"></i><b>Recording</b></span>`);
  else if (mir) tags.push(`<span class="chip sm">${icon('mirror', 'sm')}<b>Mirroring</b></span>`);
  setHtml(el.tags, tags.join(''));
  el.phone.toggleAttribute('data-rec', !!rec);
  el.phone.toggleAttribute('data-live', !!(dev && liveOn() && !pauseReason()));
}

function deviceName(i) {
  const mk = String(i.manufacturer || ''), md = String(i.model || '');
  if (!mk || md.toLowerCase().startsWith(mk.toLowerCase())) return md;
  return mk.charAt(0).toUpperCase() + mk.slice(1) + ' ' + md;
}
function chargeText(i) {
  const via = i.power ? ' · ' + (i.power === 'AC' ? 'Wall charger' : i.power === 'USB' ? 'USB' : 'Wireless') : '';
  switch (i.chargeState) {
    case 'charging': return 'Charging' + via;
    case 'full': return 'Fully charged' + via;
    case 'not-charging': return i.plugged ? 'Plugged in, not charging' + via : 'Not charging';
    case 'discharging': return 'On battery';
    default: return i.charging ? 'Charging' + via : 'On battery';
  }
}
function renderBody(v, dev, info) {
  const specs = el.specs;
  if (v.key === 'connecting') {
    setHtml(el.id, '<h2>Connecting...</h2><p>Waiting for the local backend.</p>'); setHtml(specs, ''); return;
  }
  if (!dev) {
    const needs = state.devices.find(d => d.state !== 'device');
    const why = needs ? (needs.state === 'unauthorized' ? 'The phone is waiting for you to accept the USB debugging prompt.' : 'The phone shows as ' + needs.state + '. Reconnect the cable or restart ADB.') : (state.deviceMessage || 'Connect a phone with USB debugging turned on.');
    setHtml(el.id, `<h2>No phone connected</h2><p>${esc(why)}</p><div class="chips"><button class="btn sm" data-view="device">${icon('phone', 'sm')}<span>Open device help</span></button></div>`);
    setHtml(specs, ''); return;
  }
  const wifi = dev.transport === 'wifi';
  const name = info && info.model ? deviceName(info) : dev.id;
  const sub = info && info.error ? 'Could not read device details' : (info && info.android ? 'Android ' + info.android + (info.sdk ? ' (API ' + info.sdk + ')' : '') : 'Reading device details');
  setHtml(el.id, `<h2>${esc(name)}</h2><p>${esc(sub)}</p><div class="chips"><span class="chip sm ok"><i class="dot"></i><b>Ready</b></span><span class="chip sm">${icon(wifi ? 'wifi' : 'usb', 'sm')}<b>${wifi ? 'Wi-Fi' : 'USB'}</b></span></div>`);
  const rows = [];
  if (info && info.width) rows.push(['Screen', `${info.width} × ${info.height}` + (info.density ? ` · ${info.density} dpi` : '')]);
  if (D.laid) rows.push(['Orientation', `${D.orient === 'landscape' ? 'Landscape' : 'Portrait'} · ${D.w} × ${D.h}`]);
  if (info && info.storageTotal) rows.push(['Free storage', `${bytes(info.storageFree)} of ${bytes(info.storageTotal)}`]);
  if (info && info.ramTotal) rows.push(['Free memory', `${bytes(info.ramFree)} of ${bytes(info.ramTotal)}`]);
  if (info && info.ip) rows.push(['Wi-Fi address', info.ip]);
  rows.push(['Device ID', dev.id]);
  setHtml(specs, rows.map(r => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd></div>`).join(''));
}
function renderBattery(dev, info) {
  const show = !!dev && (!info || (!info.error && info.battery >= 0));
  el.batt.hidden = !show;
  if (!show) return;
  if (!info) { txt(el.battVal, '--'); txt(el.battState, 'Reading battery'); el.ring.style.strokeDashoffset = '100'; setHtml(el.battMeta, ''); return; }
  const lvl = Math.max(0, Math.min(100, info.battery));
  const on = !!info.charging;
  const tone = on ? 'charge' : lvl <= 15 ? 'bad' : lvl <= 30 ? 'warn' : 'ok';
  el.batt.dataset.tone = tone;
  txt(el.battVal, String(lvl));
  txt(el.battState, (!on && lvl <= 15 ? 'Battery low · ' : '') + chargeText(info));
  el.ring.style.strokeDashoffset = String(100 - lvl);
  el.bolt.toggleAttribute('hidden', !on);
  const meta = [];
  if (info.tempC != null) meta.push(`<span class="chip sm ${info.tempC >= 45 ? 'bad' : info.tempC >= 40 ? 'warn' : ''}" title="Battery temperature">${icon('thermo', 'sm')}<b>${esc(info.tempC)} °C</b></span>`);
  if (info.voltage) meta.push(`<span class="chip sm" title="Battery voltage">${icon('bolt', 'sm')}<b>${(info.voltage / 1000).toFixed(2)} V</b></span>`);
  setHtml(el.battMeta, meta.join(''));
}

function renderDevice() {
  syncDevice();
  if (!D.laid && D.id && D.lastLive && (Number.isInteger(D.lastLive.s.rot) || D.lastLive.s.w > 0)) applySample(D.id, D.lastLive.s, D.lastLive.at, 'live');   // details arrived after the first reading
  const dev = STK.current(), info = STK.info(), v = viewState();
  renderScreen(v);
  renderNote(v);
  renderTags(dev);
  renderBody(v, dev, info);
  renderBattery(dev, info);
}
STK.renderDevice = renderDevice;
STK.display = D;
STK.preview = { update: manualUpdate, setLive, toggleLive: () => setLive(!liveOn()), isLive: liveOn };

/* ---------- wiring ---------- */
el.now.addEventListener('click', manualUpdate);
el.live.addEventListener('change', e => setLive(e.target.checked));
el.live.checked = !!STK.store.get('preview-live', false);

if ('IntersectionObserver' in window) {
  new IntersectionObserver(es => {
    const seen = es[es.length - 1].isIntersecting;
    if (seen === V.visible) return;
    V.visible = seen;
    if (seen) { kickStatus(); resumeLive(); if (P.owed) autoCapture(P.owed); }
    renderNote();
  }, { threshold: 0.05 }).observe(el.card);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  kickStatus(); resumeLive(); if (P.owed) autoCapture(P.owed);
});
STK.on('view', v => {
  if (v === 'console') { setTimeout(() => { V.visible = true; kickStatus(); resumeLive(); if (P.owed) autoCapture(P.owed); renderDevice(); }, 0); }
});
STK.on('state', () => { if (state.online && P.owed && canCapture()) autoCapture(P.owed); });
STK.on('keystate', () => {
  const was = el.card._off, now = screenOff();
  el.card._off = now;
  if (was && !now) { announce('Phone screen is on.'); autoCapture('screen-on'); resumeLive(); }
  renderDevice();
});
STK.on('settings', () => renderDevice());
setInterval(() => { if (!document.hidden && state.view === 'console') renderNote(); }, 1000);
window.addEventListener('pagehide', () => { clearImages(); });

renderDevice();
kickStatus();
if (liveOn()) scheduleLive(900);
})();
