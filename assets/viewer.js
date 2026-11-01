/* DROID ADB 4.11 Stretch viewer.
   A second window that shows the mirror window enlarged or stretched. It captures the scrcpy window with the browser's own
   window capture, cuts away the dark bars, and draws the picture to fill this window. Nothing on the phone is changed and
   scrcpy is not modified. Optional touch control sends taps and swipes through the normal DROID ADB backend. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const q = new URLSearchParams(location.search);
const KEY = 'droid-adb-viewer-v1';
const DEF = { mode: 'fill', stretch: 100, zoom: 100, panX: 50, panY: 50, tT: 0, tB: 0, tL: 0, tR: 0, aspect: 'auto', ctl: false };
const S = Object.assign({}, DEF);
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

const cv = $('#cv'), ctx = cv.getContext('2d', { alpha: false });
const vid = document.createElement('video');
vid.muted = true; vid.playsInline = true;
let stream = null, running = false, geo = null, det = null, detFrames = 0, lastFW = 0, lastFH = 0, col = null, row = null, ph = { a: 0, w: 0, h: 0, serial: '', fillOn: false };
const small = document.createElement('canvas'), sctx = small.getContext('2d', { willReadFrequently: true });

/* ---------- what the dashboard knows about the phone ---------- */
function opener() { try { return (window.opener && !window.opener.closed && window.opener.STK) ? window.opener : null; } catch (e) { return null; } }
function readPhone() {
  let w = +q.get('w') || 0, h = +q.get('h') || 0, serial = q.get('serial') || '', a = 0, fillOn = false;
  const o = opener();
  if (o) {
    try {
      const K = o.STK;
      serial = K.sel() || serial;
      const inf = K.info();
      if (inf && inf.width > 0 && inf.height > 0) { w = inf.width; h = inf.height; }
      const im = o.document.querySelector('#screen-img');
      if (im && im.naturalWidth > 0 && im.naturalHeight > 0) a = im.naturalWidth / im.naturalHeight;
      const st = (K.state && K.state.settings) || {};
      fillOn = (!!st.shapeSize && st.shapeSize !== 'phone' && !!st.shapeFill && st.shapeFill !== 'off') || !!st.crop;
    } catch (e) {}
  }
  if (!a && w > 0 && h > 0) a = w / h;
  if (a > 0 && w > 0 && h > 0 && ((a > 1) !== (w > h))) { const t = w; w = h; h = t; }
  ph = { a, w, h, serial, fillOn };
}

/* ---------- geometry ---------- */
function inner() {
  const W = vid.videoWidth, H = vid.videoHeight;
  const l = Math.min(S.tL, W - 60), r = Math.min(S.tR, W - 60 - l), t = Math.min(S.tT, H - 60), b = Math.min(S.tB, H - 60 - t);
  return { x: Math.max(0, l), y: Math.max(0, t), w: W - Math.max(0, l) - Math.max(0, r), h: H - Math.max(0, t) - Math.max(0, b) };
}
function resolvedAspect() {
  if (S.aspect === 'auto') return (ph.a > 0 && !ph.fillOn) ? 'phone' : 'detect';
  if (S.aspect === 'phone' && !(ph.a > 0)) return 'detect';
  return S.aspect;
}
function invalidate() { det = null; detFrames = 0; col = null; row = null; }
/* finds the picture inside the captured window by looking for where the picture is not black. It keeps the largest area seen over the first
   frames, so a dark scene does not cut the picture short. */
function detect(inn) {
  const sc = Math.min(1, 320 / inn.w), sw = Math.max(8, Math.round(inn.w * sc)), sh = Math.max(8, Math.round(inn.h * sc));
  if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; col = null; row = null; }
  if (!col) { col = new Uint16Array(sw); row = new Uint16Array(sh); }
  sctx.drawImage(vid, inn.x, inn.y, inn.w, inn.h, 0, 0, sw, sh);
  let d; try { d = sctx.getImageData(0, 0, sw, sh).data; } catch (e) { return; }
  const cc = new Uint16Array(sw), rc = new Uint16Array(sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = (y * sw + x) * 4;
    if (d[i] + d[i + 1] + d[i + 2] > 48) { cc[x]++; rc[y]++; }
  }
  for (let x = 0; x < sw; x++) if (cc[x] > col[x]) col[x] = cc[x];
  for (let y = 0; y < sh; y++) if (rc[y] > row[y]) row[y] = rc[y];
  const tc = Math.max(2, sh * 0.02), tr = Math.max(2, sw * 0.02);
  let x0 = 0, x1 = sw - 1, y0 = 0, y1 = sh - 1;
  while (x0 < x1 && col[x0] < tc) x0++;
  while (x1 > x0 && col[x1] < tc) x1--;
  while (y0 < y1 && row[y0] < tr) y0++;
  while (y1 > y0 && row[y1] < tr) y1--;
  if (x1 - x0 < 8 || y1 - y0 < 8) return;
  det = { x: inn.x + Math.floor(x0 / sc), y: inn.y + Math.floor(y0 / sc), w: Math.min(inn.w, Math.ceil((x1 - x0 + 1) / sc)), h: Math.min(inn.h, Math.ceil((y1 - y0 + 1) / sc)) };
  detFrames++;
}
function pictureRect(inn) {
  const m = resolvedAspect();
  if (m === 'phone') {
    let w = inn.w, h = w / ph.a;
    if (h > inn.h) { h = inn.h; w = h * ph.a; }
    return { x: inn.x + (inn.w - w) / 2, y: inn.y + (inn.h - h) / 2, w, h };
  }
  if (m === 'detect') { if (detFrames < 40) detect(inn); if (det) return det; }
  return inn;
}
function layout(p, W, H) {
  const z = S.zoom / 100;
  let dw, dh;
  if (S.mode === 'fit') { const s = Math.min(W / p.w, H / p.h); dw = p.w * s * z; dh = p.h * s * z; }
  else {
    const s = Math.max(W / p.w, H / p.h), cw = p.w * s, ch = p.h * s, t = S.stretch / 100;
    dw = (cw + (W - cw) * t) * z; dh = (ch + (H - ch) * t) * z;
  }
  const x = dw >= W ? -(dw - W) * S.panX / 100 : (W - dw) / 2;
  const y = dh >= H ? -(dh - H) * S.panY / 100 : (H - dh) / 2;
  return { x, y, dw, dh };
}
function draw() {
  if (!running || !vid.videoWidth) return;
  if (vid.videoWidth !== lastFW || vid.videoHeight !== lastFH) { lastFW = vid.videoWidth; lastFH = vid.videoHeight; invalidate(); }
  const W = cv.width, H = cv.height;
  const p = pictureRect(inner());
  geo = Object.assign(layout(p, W, H), { p });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(vid, p.x, p.y, p.w, p.h, geo.x, geo.y, geo.dw, geo.dh);
}
function fitCanvas() {
  const d = window.devicePixelRatio || 1;
  cv.width = Math.max(2, Math.round(innerWidth * d)); cv.height = Math.max(2, Math.round(innerHeight * d));
  draw();
}

/* ---------- capture ---------- */
function msg(t) { $('#msg').textContent = t || ''; }
function setRunning(on) {
  running = on;
  $('#intro').style.display = on ? 'none' : 'grid';
  $('#startb').textContent = on ? 'Stop capture' : 'Start capture';
  if (!on) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height); }
}
async function start() {
  if (running) return stop();
  msg('');
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60, max: 60 } }, audio: false });
  } catch (e) { msg('Capture was cancelled or blocked (' + (e && e.name ? e.name : 'error') + '). Press Start capture and choose the DROID ADB window.'); return; }
  const tr = stream.getVideoTracks()[0];
  try { const st = tr.getSettings(); if (st.displaySurface && st.displaySurface !== 'window') msg('You chose ' + st.displaySurface + ', not a window. It works, but you will see more than the phone. Choose the window called DROID ADB for a clean picture.'); } catch (e) {}
  tr.addEventListener('ended', stop);
  vid.srcObject = stream;
  try { await vid.play(); } catch (e) {}
  invalidate(); readPhone(); setRunning(true); fitCanvas(); pump();
}
function stop() {
  if (stream) { stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} }); stream = null; }
  vid.srcObject = null; setRunning(false);
}
function pump() {
  if (!running) return;
  if (vid.requestVideoFrameCallback) vid.requestVideoFrameCallback(() => { draw(); pump(); });
  else requestAnimationFrame(() => { draw(); pump(); });
}
/* the phone turns or the dashboard changes: look again once a second */
setInterval(() => { if (!running) return; const was = ph.a + '|' + ph.fillOn; readPhone(); if (was !== ph.a + '|' + ph.fillOn) { invalidate(); draw(); } }, 1000);

/* ---------- touch control ---------- */
function toPhone(e) {
  if (!geo || !(ph.w > 0) || !(ph.h > 0)) return null;
  const r = cv.getBoundingClientRect(), cx = (e.clientX - r.left) * cv.width / r.width, cy = (e.clientY - r.top) * cv.height / r.height;
  const u = (cx - geo.x) / geo.dw, v = (cy - geo.y) / geo.dh;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { x: Math.round(u * (ph.w - 1)), y: Math.round(v * (ph.h - 1)) };
}
function post(path, body) {
  return fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-STK': '1' }, body: JSON.stringify(body) }).catch(() => {});
}
function ring(x, y) { const i = document.createElement('i'); i.className = 'fx'; i.style.left = x + 'px'; i.style.top = y + 'px'; document.body.appendChild(i); setTimeout(() => i.remove(), 600); }
let down = null;
cv.addEventListener('pointerdown', e => {
  if (!S.ctl || e.button !== 0 || !running) return;
  readPhone(); const p = toPhone(e); if (!p) return;
  down = { p, x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  try { cv.setPointerCapture(e.pointerId); } catch (er) {}
});
cv.addEventListener('pointerup', e => {
  if (!down || e.pointerId !== down.id) return;
  const d = down; down = null;
  const p = toPhone(e) || d.p, ms = Math.round(performance.now() - d.t), moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
  if (!ph.serial) return;
  ring(e.clientX, e.clientY);
  if (moved < 9) post('/tap', { serial: ph.serial, x: d.p.x, y: d.p.y, holdMs: ms >= 450 ? Math.min(ms, 3000) : 0 });
  else post('/swipe', { serial: ph.serial, x1: d.p.x, y1: d.p.y, x2: p.x, y2: p.y, ms: Math.min(1500, Math.max(80, ms)) });
});
cv.addEventListener('pointercancel', () => { down = null; });

/* ---------- controls ---------- */
const sliders = ['stretch', 'zoom', 'panX', 'panY', 'tT', 'tB', 'tL', 'tR'];
function sync() {
  $('#mode').value = S.mode; $('#aspect').value = S.aspect; $('#ctl').checked = !!S.ctl; cv.classList.toggle('ctl', !!S.ctl);
  for (const k of sliders) { const el = $('#' + k); if (el) el.value = S[k]; }
  $('#vstretch').textContent = S.stretch + '%'; $('#vzoom').textContent = S.zoom + '%';
  for (const k of ['tT', 'tB', 'tL', 'tR']) { const v = $('#v' + k); if (v) v.textContent = S[k]; }
  $('#lstretch').style.opacity = S.mode === 'fill' ? '1' : '.4';
}
function change(k, v, inval) { S[k] = v; save(); sync(); if (inval) invalidate(); draw(); }
$('#mode').addEventListener('change', e => change('mode', e.target.value));
$('#aspect').addEventListener('change', e => change('aspect', e.target.value, true));
$('#ctl').addEventListener('change', e => change('ctl', e.target.checked));
for (const k of sliders) $('#' + k).addEventListener('input', e => change(k, +e.target.value, k[0] === 't' && k.length === 2));
$('#reset').addEventListener('click', () => { Object.assign(S, DEF); save(); sync(); invalidate(); draw(); });
$('#start').addEventListener('click', start);
$('#startb').addEventListener('click', start);
$('#morebtn').addEventListener('click', () => $('#more').classList.toggle('on'));
function fs() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
$('#fs').addEventListener('click', fs);
cv.addEventListener('dblclick', e => { if (!S.ctl) fs(); });

/* the bar hides itself while you watch */
let hideT = null;
function showBar() {
  $('#bar').classList.remove('hide'); $('#hint').classList.remove('hide'); $('#more').classList.remove('hide');
  clearTimeout(hideT);
  if (running) hideT = setTimeout(hideBar, 3500);
}
function hideBar() { $('#bar').classList.add('hide'); $('#hint').classList.add('hide'); $('#more').classList.add('hide'); }
document.addEventListener('pointermove', showBar);
addEventListener('keydown', e => {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'f') fs();
  else if (k === 'h') { if ($('#bar').classList.contains('hide')) showBar(); else hideBar(); }
});
addEventListener('resize', fitCanvas);
addEventListener('beforeunload', stop);

sync(); fitCanvas(); readPhone();
if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) msg('This browser cannot capture a window. Use Chrome or Edge, and open DROID ADB at http://127.0.0.1.');
})();
