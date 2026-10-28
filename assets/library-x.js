/* Library extras: favourites, tags, markers, trim/convert, phone gallery, backups, screenshot annotation. */
(() => {
'use strict';
const { $, $$, esc, icon, bytes, state } = STK;

/* ---------- favourites and tags ---------- */
const all = () => STK.kv.get('libmeta', {});
const meta = n => all()[n] || {};
function setMeta(n, patch) {
  const m = { ...all() }, e = { ...(m[n] || {}), ...patch };
  if (!e.f && !(e.t && e.t.length)) delete m[n]; else m[n] = e;
  STK.kv.set('libmeta', m);
}
const X = STK.libX = {
  meta,
  tagsText: n => (meta(n).t || []).join(' '),
  toggleFav: n => setMeta(n, { f: meta(n).f ? 0 : 1 }),
  chips(n) {
    const t = meta(n).t || [], mk = STK.markersFor ? STK.markersFor(n) : [];
    if (!t.length && !mk.length) return '';
    return `<div class="tagrow">${t.map(x => `<span class="tagchip">${esc(x)}</span>`).join('')}${mk.length ? `<span class="tagchip mk">${icon('flag', 'sm')}${mk.length} marker${mk.length > 1 ? 's' : ''}</span>` : ''}</div>`;
  },
  async editTags(n) {
    const f = await STK.form('Tags', STK.field('tags', 'Tags, separated by commas', (meta(n).t || []).join(', '), 'placeholder="gameplay, bug, demo"') + `<p class="hint">${esc(n)}</p>`);
    if (!f) return;
    const t = [...new Set(f.tags.split(',').map(x => x.trim().replace(/[^A-Za-z0-9 _\-]/g, '').slice(0, 20)).filter(Boolean))].slice(0, 8);
    setMeta(n, { t });
  },
  markers(n) {
    const box = $('#video-markers'), m = STK.markersFor ? STK.markersFor(n) : [];
    box.hidden = !m.length;
    box.innerHTML = m.length ? `<span class="hint">${icon('flag', 'sm')} Markers</span>` + m.map(s => `<button class="chipbtn" data-seek="${s}">${STK.clock(new Date(Date.now() - s * 1000))}</button>`).join('') : '';
  },
  async convert(name, op) {
    let ff = { available: false };
    try { ff = await STK.api('/ffmpeg'); } catch (e) {}
    if (!ff.available) return STK.confirm('ffmpeg is needed', '<p>Trimming, shrinking and GIFs use <b>ffmpeg</b>, a free tool that is not bundled with the toolkit.</p><p>Download ffmpeg for Windows, then put <b>ffmpeg.exe</b> in the toolkit folder <b>core\\ffmpeg</b>, or choose it in Settings, Advanced.</p>', 'OK', false);
    const t = s => { s = String(s).trim(); if (!s) return 0; const p = s.split(':').map(Number); if (p.some(isNaN)) return NaN; return p.reduce((a, b) => a * 60 + b, 0); };
    let f, body = { name, op };
    if (op === 'gif') {
      f = await STK.form('Make a GIF', STK.field('start', 'Start (seconds or m:ss)', '0') + STK.field('len', 'Length in seconds (up to 60)', '8') + STK.select('width', 'Width', [[240, '240 px'], [320, '320 px'], [480, '480 px'], [640, '640 px']], 480) + STK.select('fps', 'Frames per second', [[8, '8'], [12, '12'], [15, '15'], [20, '20']], 12), 'Make GIF');
      if (!f) return;
      Object.assign(body, { start: t(f.start), duration: t(f.len), width: Number(f.width), fps: Number(f.fps) });
    } else {
      f = await STK.form('Trim or shrink', STK.select('mode', 'What to do', [['trim', 'Cut a part out'], ['small', 'Make the file smaller']], op === 'small' ? 'small' : 'trim') + STK.field('start', 'Cut: start (seconds or m:ss)', '0') + STK.field('len', 'Cut: length in seconds', '30') + STK.check('fast', 'Cut: fast, without re-encoding (may be off by a second)', false) + STK.select('height', 'Smaller: picture height', [[360, '360p'], [480, '480p'], [540, '540p'], [720, '720p'], [1080, '1080p']], 720), 'Start');
      if (!f) return;
      body.op = f.mode;
      if (f.mode === 'trim') Object.assign(body, { start: t(f.start), duration: t(f.len), fast: f.fast });
      else Object.assign(body, { height: Number(f.height), start: 0, duration: 0 });
    }
    if ([body.start, body.duration].some(x => isNaN(x))) return STK.toast('Enter times like 90 or 1:30.', 'bad');
    try { await STK.jobs.start('/ffmpeg', body, 'Converting. The new file appears in the Library.'); } catch (e) { STK.fail(e); }
  }
};
document.addEventListener('click', e => { const b = e.target.closest('[data-seek]'); if (b) { const v = $('#video-el'); v.currentTime = Number(b.dataset.seek); v.play().catch(() => {}); } });

/* ---------- tabs ---------- */
const view = $('#view-library');
let xtab = '';
function showX(name) {
  xtab = name;
  view.dataset.x = name || '';
  $('#lib-classic').hidden = !!name;
  $('#lib-gallery').hidden = name !== 'gallery';
  $('#lib-backups').hidden = name !== 'backups';
  $$('#view-library .tab').forEach(b => { const on = name ? b.dataset.xtab === name : false; if (name) { b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); } });
  if (name === 'gallery') { G.type = ''; loadGallery(); }
  if (name === 'backups') renderBackups();
}
document.addEventListener('click', e => {
  const t = e.target.closest('#view-library .tab'); if (!t) return;
  if (t.dataset.xtab) showX(t.dataset.xtab);
  else if (t.dataset.tab && xtab) showX('');
});

/* ---------- phone gallery ---------- */
const G = { set: 'all', type: '', all: [], items: [], sel: new Set(), selecting: false, loading: false, cache: {}, idx: 0, id: '' };
const SETS = [['all', 'All'], ['camera', 'Camera'], ['screenshots', 'Screenshots'], ['downloads', 'Downloads'], ['whatsapp', 'WhatsApp']];
async function loadGallery(force) {
  const box = $('#lib-gallery'), id = STK.sel();
  if (!id) return STK.setHtml(box, `<div class="panel"><div class="empty">${icon('plug')}<b>No phone connected</b><p>Connect a phone to browse its photos and videos.</p></div></div>`);
  const key = id + '|' + G.set;
  if (!force && G.cache[key] && Date.now() - G.cache[key].at < 60000) { G.all = G.cache[key].items; applyType(); G.id = id; return paintGallery(); }
  G.loading = true; G.id = id; paintGallery();
  try { const r = await STK.api(`/gallery?id=${encodeURIComponent(id)}&set=${G.set}`, { timeout: 120000 }); G.all = r.items || []; G.total = r.total; G.cache[key] = { at: Date.now(), items: G.all }; applyType(); }
  catch (e) { G.all = []; G.items = []; STK.fail(e); }
  G.loading = false; G.sel.clear(); paintGallery();
}
function dayLabel(sec) {
  const d = new Date(sec * 1000), n = new Date(), y = new Date(Date.now() - 864e5);
  if (d.toDateString() === n.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
}
const thumbUrl = (it, full) => `/api/gallery/thumb?id=${encodeURIComponent(G.id)}&path=${encodeURIComponent(it.path)}&size=${it.size}${full ? '&full=1' : ''}`;
/* 4.4.0: the Phone page first asks Photos or Videos, then shows that kind with the folder chips. */
function applyType() { G.items = G.type === 'videos' ? G.all.filter(i => i.kind === 'video') : G.type === 'photos' ? G.all.filter(i => i.kind === 'image') : G.all; }
function paintGallery() {
  const box = $('#lib-gallery');
  if (!G.type) {
    const ph = G.all.filter(i => i.kind === 'image').length, vd = G.all.filter(i => i.kind === 'video').length, more = G.total > G.all.length ? '+' : '';
    box.innerHTML = `<div class="gchoose"><button class="gcard" data-gtype="photos">${icon('image')}<b>Photos</b><small>${G.loading ? 'Reading the phone...' : ph + more + ' pictures'}</small></button><button class="gcard" data-gtype="videos">${icon('play')}<b>Videos</b><small>${G.loading ? 'Reading the phone...' : vd + more + ' videos'}</small></button></div><p class="hint">Pick one to browse it. Nothing is copied until you choose Copy to PC.</p>`;
    return;
  }
  const head = `<div class="toolbar tight"><button class="btn sm" id="g-back">${icon('left', 'sm')}<span>Phone</span></button><b class="gtitle">${G.type === 'videos' ? 'Videos' : 'Photos'}</b><div class="chiprow">${SETS.map(([k, l]) => `<button class="chipbtn ${G.set === k ? 'is-active' : ''}" data-gset="${k}">${l}</button>`).join('')}</div><span class="grow"></span>
    <button class="btn sm ${G.selecting ? 'primary' : ''}" id="g-select">${icon('check', 'sm')}<span>Select</span></button><button class="btn sm" id="g-refresh">${icon('refresh', 'sm')}<span>Refresh</span></button></div>`;
  const bulk = G.selecting ? `<div class="bulkbar"><b>${G.sel.size} selected</b><button class="btn sm" id="g-all">Select all shown</button><button class="btn sm primary" id="g-pull" ${G.sel.size ? '' : 'disabled'}>${icon('download', 'sm')}<span>Copy to PC</span></button><button class="btn sm danger" id="g-del" ${G.sel.size ? '' : 'disabled'}>${icon('trash', 'sm')}<span>Delete from phone</span></button></div>` : '';
  let body;
  if (G.loading) body = `<div class="panel"><p class="hint">Reading the phone gallery...</p></div>`;
  else if (!G.items.length) body = `<div class="panel"><div class="empty">${icon('image')}<b>No ${G.type === 'videos' ? 'videos' : 'photos'} found</b><p>This folder set is empty on the phone, or the phone blocked reading it.</p></div></div>`;
  else {
    let lastDay = '', html = '';
    G.items.forEach((it, i) => {
      const d = dayLabel(it.mtime);
      if (d !== lastDay) { html += `${lastDay ? '</div>' : ''}<h3 class="dayhead">${esc(d)}</h3><div class="gal">`; lastDay = d; }
      const sel = G.sel.has(it.path);
      html += `<button class="gtile ${it.kind} ${sel ? 'sel' : ''}" data-gi="${i}" title="${esc(it.name)} · ${bytes(it.size)}">${it.kind === 'image' ? `<img data-src="${esc(thumbUrl(it))}" alt="${esc(it.name)}">` : `<span class="vid">${icon('play')}</span>`}<span class="gcap">${it.kind === 'video' ? 'Video · ' : ''}${bytes(it.size)}</span>${G.selecting ? `<span class="gcheck">${sel ? icon('check', 'sm') : ''}</span>` : ''}</button>`;
    });
    body = `<section class="panel flush galwrap">${html}</div><p class="hint" style="padding:10px 14px">${G.items.length} shown${G.total > G.items.length ? ' of ' + G.total : ''}. Pictures load as you scroll.</p></section>`;
  }
  box.innerHTML = head + bulk + body;
  $$('#lib-gallery img[data-src]').forEach(im => io.observe(im));
}
const TQ = { q: [], active: 0, max: 3 };
function pump() {
  while (TQ.active < TQ.max && TQ.q.length) {
    const img = TQ.q.shift(); if (!img.isConnected) continue;
    TQ.active++;
    const done = () => { TQ.active--; pump(); };
    img.onload = () => { img.classList.add('ready'); done(); };
    img.onerror = () => { img.classList.add('bad'); done(); };
    img.src = img.dataset.src;
  }
}
const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { io.unobserve(en.target); TQ.q.push(en.target); pump(); } }), { rootMargin: '400px' });

function openPic(i) {
  G.idx = Math.max(0, Math.min(G.items.length - 1, i));
  const it = G.items[G.idx]; if (!it) return;
  $('#pic-title').textContent = it.name + ' · ' + bytes(it.size);
  const img = $('#pic-img');
  if (it.kind === 'image') { img.removeAttribute('alt'); img.alt = it.name; img.src = thumbUrl(it, true); img.style.opacity = 1; }
  else { img.removeAttribute('src'); img.alt = 'Videos play on the phone. Copy to the PC to watch here.'; }
  $('#pic-prev').disabled = G.idx <= 0; $('#pic-next').disabled = G.idx >= G.items.length - 1;
  if (!$('#dlg-pic').open) $('#dlg-pic').showModal();
}
async function pull(paths, btn) {
  if (!paths.length) return;
  await STK.busy(btn, async () => { try { await STK.jobs.start('/gallery/pull', { serial: G.id, paths }, 'Copying to the PC (Pulled\\Gallery).'); } catch (e) { STK.fail(e); } });
}
$('#pic-close').addEventListener('click', () => $('#dlg-pic').close());
$('#pic-prev').addEventListener('click', () => openPic(G.idx - 1));
$('#pic-next').addEventListener('click', () => openPic(G.idx + 1));
$('#pic-pull').addEventListener('click', e => pull([G.items[G.idx].path], e.currentTarget));
$('#dlg-pic').addEventListener('keydown', e => { if (e.key === 'ArrowLeft' && !$('#pic-prev').disabled) openPic(G.idx - 1); if (e.key === 'ArrowRight' && !$('#pic-next').disabled) openPic(G.idx + 1); });

/* ---------- backups ---------- */
const PRESETS = [['camera', 'Camera photos and videos', '/sdcard/DCIM', true], ['shots', 'Screenshots', '/sdcard/Pictures/Screenshots', true], ['pictures', 'Pictures', '/sdcard/Pictures', false], ['movies', 'Movies', '/sdcard/Movies', false], ['downloads', 'Downloads', '/sdcard/Download', false], ['docs', 'Documents', '/sdcard/Documents', false], ['whatsapp', 'WhatsApp media', '/sdcard/Android/media/com.whatsapp/WhatsApp/Media', false], ['rec', 'Phone screen recordings', '/sdcard/Recordings', false]];
let past = null;
async function renderBackups() {
  const box = $('#lib-backups');
  const checked = STK.store.get('backup-sel', PRESETS.filter(p => p[3]).map(p => p[0]));
  const old = past ? past.backups.map(b => `<div class="row-file"><span class="badge">${icon('cloud')}</span><div><b>${esc(b.name)}</b><small>${b.files} files${b.modified ? ' · last copy ' + esc(STK.ago(b.modified)) : ''}</small></div><span class="size">${bytes(b.size)}</span><div class="row-actions"></div></div>`).join('') || `<p class="hint" style="padding:14px">No backups yet.</p>` : '<p class="hint" style="padding:14px">Loading...</p>';
  box.innerHTML = `<div class="two"><div class="col"><section class="panel"><header class="panel-head"><h2>Back up the phone</h2></header>
    <p class="hint lead">Copies folders from the phone to this PC. Files that are already on the PC are skipped, so running it again only copies what is new.</p>
    <div class="checks" id="bk-checks">${PRESETS.map(([k, l, p]) => `<label class="chk"><input type="checkbox" data-bk="${k}" ${checked.includes(k) ? 'checked' : ''}><span>${esc(l)} <small class="mono">${esc(p)}</small></span></label>`).join('')}</div>
    <label class="ff"><span>Another folder on the phone</span><input id="bk-extra" placeholder="/sdcard/MyFolder" autocomplete="off" spellcheck="false"></label>
    <div class="row"><button class="btn primary" id="bk-start">${icon('cloud', 'sm')}<span>Start backup</span></button><span class="hint">Runs in the background. Follow it with the jobs button.</span></div></section></div>
    <div class="col"><section class="panel flush"><header class="panel-head" style="padding:14px 16px 0"><h2>Backups on this PC</h2><button class="btn sm" id="bk-open">${icon('folder', 'sm')}<span>Open folder</span></button></header><div>${old}</div></section></div></div>`;
  if (!past) { try { past = await STK.api('/backups'); if (xtab === 'backups') renderBackups(); } catch (e) { past = { backups: [] }; } }
}
STK.on('job-done', j => { if (j.kind === 'backup') { past = null; if (xtab === 'backups') renderBackups(); } });

/* ---------- annotate ---------- */
const A = { tool: 'pen', color: '#ff3b4d', snaps: [], drag: null, name: '' };
const COLORS = ['#ff3b4d', '#ffc83d', '#3ddc97', '#4aa8ff', '#ffffff', '#111111'];
function annotOpen() {
  const name = $('#shot-title').textContent;
  if (!/\.png$/i.test(name)) return STK.toast('Only screenshots can be annotated.', 'bad');
  A.name = name;
  const img = new Image();
  img.onload = () => {
    const c = $('#annot-canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0); A.snaps = []; $('#annot-colors').innerHTML = COLORS.map(x => `<button class="sw ${x === A.color ? 'is-active' : ''}" style="background:${x}" data-color="${x}" aria-label="Colour ${x}"></button>`).join('');
    $('#dlg-annot').showModal();
  };
  img.onerror = () => STK.toast('Could not open that picture.', 'bad');
  img.src = '/api/file?kind=screenshots&name=' + encodeURIComponent(name);
}
const cv = () => $('#annot-canvas'), ctx = () => cv().getContext('2d');
function pt(e) { const r = cv().getBoundingClientRect(); return { x: (e.clientX - r.left) * cv().width / r.width, y: (e.clientY - r.top) * cv().height / r.height }; }
const lw = () => Math.max(4, Math.round(cv().width / 190));
function drawShape(c, tool, a, b, pts) {
  c.strokeStyle = A.color; c.fillStyle = A.color; c.lineWidth = lw(); c.lineCap = 'round'; c.lineJoin = 'round';
  if (tool === 'pen') { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.stroke(); }
  else if (tool === 'box') c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  else if (tool === 'arrow') {
    const ang = Math.atan2(b.y - a.y, b.x - a.x), h = lw() * 4.5;
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x - h * Math.cos(ang - .45), b.y - h * Math.sin(ang - .45)); c.lineTo(b.x - h * Math.cos(ang + .45), b.y - h * Math.sin(ang + .45)); c.closePath(); c.fill();
  } else if (tool === 'blur' || tool === 'crop') {
    c.save(); c.setLineDash([10, 8]); c.lineWidth = Math.max(2, lw() / 2); c.strokeStyle = tool === 'crop' ? '#4aa8ff' : '#fff'; c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); c.restore();
  }
}
function rectOf(a, b) { return { x: Math.round(Math.min(a.x, b.x)), y: Math.round(Math.min(a.y, b.y)), w: Math.round(Math.abs(b.x - a.x)), h: Math.round(Math.abs(b.y - a.y)) }; }
function snap() { A.snaps.push(ctx().getImageData(0, 0, cv().width, cv().height)); if (A.snaps.length > 15) A.snaps.shift(); }
$('#annot-canvas').addEventListener('pointerdown', e => { e.preventDefault(); cv().setPointerCapture(e.pointerId); const p = pt(e); A.drag = { a: p, b: p, pts: [p], base: ctx().getImageData(0, 0, cv().width, cv().height) }; });
$('#annot-canvas').addEventListener('pointermove', e => {
  if (!A.drag) return; const p = pt(e); A.drag.b = p; A.drag.pts.push(p);
  ctx().putImageData(A.drag.base, 0, 0); drawShape(ctx(), A.tool, A.drag.a, p, A.drag.pts);
});
$('#annot-canvas').addEventListener('pointerup', e => {
  if (!A.drag) return; const d = A.drag; A.drag = null; const c = ctx();
  c.putImageData(d.base, 0, 0);
  const r = rectOf(d.a, d.b);
  if (A.tool === 'blur' || A.tool === 'crop') { if (r.w < 6 || r.h < 6) return; }
  A.snaps.push(d.base); if (A.snaps.length > 15) A.snaps.shift();
  if (A.tool === 'blur') {
    const px = Math.max(8, Math.round(Math.min(r.w, r.h) / 8)), t = document.createElement('canvas'); t.width = Math.max(1, Math.round(r.w / px)); t.height = Math.max(1, Math.round(r.h / px));
    t.getContext('2d').drawImage(cv(), r.x, r.y, r.w, r.h, 0, 0, t.width, t.height);
    c.imageSmoothingEnabled = false; c.drawImage(t, 0, 0, t.width, t.height, r.x, r.y, r.w, r.h); c.imageSmoothingEnabled = true;
  } else if (A.tool === 'crop') {
    const data = c.getImageData(r.x, r.y, r.w, r.h); cv().width = r.w; cv().height = r.h; ctx().putImageData(data, 0, 0);
  } else drawShape(c, A.tool, d.a, d.b, d.pts);
});
$('#annot-undo').addEventListener('click', () => { const s = A.snaps.pop(); if (!s) return; cv().width = s.width; cv().height = s.height; ctx().putImageData(s, 0, 0); });
$('#annot-tools').addEventListener('click', e => {
  const t = e.target.closest('[data-tool]'); if (t) { A.tool = t.dataset.tool; $$('#annot-tools [data-tool]').forEach(b => b.classList.toggle('is-active', b === t)); }
  const c = e.target.closest('[data-color]'); if (c) { A.color = c.dataset.color; $$('#annot-colors .sw').forEach(b => b.classList.toggle('is-active', b === c)); }
});
const toBlob = () => new Promise(r => cv().toBlob(r, 'image/png'));
$('#annot-copy').addEventListener('click', async () => { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toBlob() })]); STK.toast('Copied. Paste it anywhere.'); } catch (e) { STK.toast('The browser blocked copying the picture.', 'bad'); } });
$('#annot-save').addEventListener('click', e => STK.busy(e.currentTarget, async () => {
  try { const blob = await toBlob(); const r = await STK.api('/screenshot-save?name=' + encodeURIComponent(A.name.replace(/\.png$/i, '') + '-edited'), { method: 'POST', raw: blob }); STK.toast('Saved ' + r.file + '.'); $('#dlg-annot').close(); STK.loadLibrary(); } catch (er) { STK.fail(er); }
}));
$('#annot-close').addEventListener('click', () => $('#dlg-annot').close());
$('#shot-annot').addEventListener('click', annotOpen);
STK.annotate = annotOpen;

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('#lib-gallery button, #lib-backups button, #lib-backups input'); if (!t) return;
  if (t.dataset.gtype) { G.type = t.dataset.gtype; G.sel.clear(); G.selecting = false; applyType(); return paintGallery(); }
  if (t.id === 'g-back') { G.type = ''; G.sel.clear(); G.selecting = false; return paintGallery(); }
  if (t.dataset.gset) { G.set = t.dataset.gset; G.sel.clear(); return loadGallery(); }
  if (t.id === 'g-refresh') return loadGallery(true);
  if (t.id === 'g-select') { G.selecting = !G.selecting; G.sel.clear(); return paintGallery(); }
  if (t.id === 'g-all') { G.items.forEach(i => G.sel.add(i.path)); return paintGallery(); }
  if (t.id === 'g-pull') return pull([...G.sel], t);
  if (t.id === 'g-del') return (async () => {
    const n = G.sel.size; if (!await STK.confirm('Delete from the phone?', `<p>${n} file${n > 1 ? 's' : ''} will be removed from the phone permanently. Copy them to the PC first if you want to keep them.</p>`, 'Delete ' + n)) return;
    await STK.busy(t, async () => { try { const r = await STK.post('/gallery/delete', { serial: G.id, paths: [...G.sel] }, { timeout: 120000 }); STK.toast('Deleted ' + r.deleted + ' file(s) from the phone.'); G.cache = {}; G.sel.clear(); loadGallery(true); } catch (er) { STK.fail(er); } });
  })();
  if (t.dataset.gi !== undefined) {
    const it = G.items[Number(t.dataset.gi)];
    if (G.selecting) { G.sel.has(it.path) ? G.sel.delete(it.path) : G.sel.add(it.path); return paintGallery(); }
    return openPic(Number(t.dataset.gi));
  }
  if (t.dataset.bk) { const sel = $$('#bk-checks [data-bk]').filter(x => x.checked).map(x => x.dataset.bk); STK.store.set('backup-sel', sel); return; }
  if (t.id === 'bk-open') return STK.post('/open-folder', { kind: 'backups' }).catch(STK.fail);
  if (t.id === 'bk-start') return (async () => {
    const id = STK.sel(); if (!id) return STK.toast('Connect a phone first.', 'bad');
    const paths = $$('#bk-checks [data-bk]').filter(x => x.checked).map(x => PRESETS.find(p => p[0] === x.dataset.bk)[2]);
    const extra = $('#bk-extra').value.trim(); if (extra) paths.push(extra);
    if (!paths.length) return STK.toast('Choose at least one folder.', 'bad');
    await STK.busy(t, async () => { try { await STK.jobs.start('/backup', { serial: id, paths }, 'Backup started.'); } catch (er) { STK.fail(er); } });
  })();
});
STK.on('device-changed', () => { G.cache = {}; if (xtab === 'gallery') loadGallery(); });
STK.on('view', v => { if (v === 'library' && xtab === 'gallery') loadGallery(); });
})();
