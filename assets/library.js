/* Library view: recordings and screenshots with filter, sort, selection, playback, rename, delete, cleanup. */
(() => {
'use strict';
const { $, $$, esc, icon, bytes, when, ago, state } = STK;
const L = { tab: 'recordings', favOnly: false, curKind: '', filter: '', sort: 'new', selecting: false, selected: new Set(), shotIndex: -1, shotList: [], current: null };
state.lib = { recs: [], shots: [], totals: { recs: 0, shots: 0 }, disk: null, loaded: false };

STK.loadLibrary = async function () {
  if (!state.online && state.everOnline === false) return;
  try {
    const [r, s] = await Promise.all([STK.api('/library?kind=recordings'), STK.api('/library?kind=screenshots')]);
    state.lib = { recs: r.files || [], shots: s.files || [], totals: { recs: r.totalSize || 0, shots: s.totalSize || 0 }, disk: r.disk, dirs: { rec: r.dir, shot: s.dir }, loaded: true };
    state.disk = r.disk || state.disk;
  } catch (e) { if (!e.network) STK.fail(e); }
  render();
  STK.emit('library');
};

const SORT = {
  new: (a, b) => new Date(b.modified) - new Date(a.modified),
  old: (a, b) => new Date(a.modified) - new Date(b.modified),
  big: (a, b) => b.size - a.size,
  name: (a, b) => a.name.localeCompare(b.name)
};
const X = () => STK.libX || { meta: () => ({}), tagsText: () => '' };
const files = () => (L.tab === 'recordings' ? state.lib.recs : state.lib.shots).filter(f => (f.name + ' ' + X().tagsText(f.name)).toLowerCase().includes(L.filter.toLowerCase()) && (!L.favOnly || X().meta(f.name).f)).sort(SORT[L.sort]);
const kind = () => L.tab;

function render() {
  const lib = state.lib;
  $('#tab-rec-count').textContent = lib.recs.length;
  $('#tab-shot-count').textContent = lib.shots.length;
  const badge = $('#rail-count'), total = lib.recs.length + lib.shots.length;
  badge.hidden = !total; badge.textContent = total > 99 ? '99+' : total;
  if (state.view !== 'library') return;
  const isRec = L.tab === 'recordings';
  const list = files();
  const t = lib.totals, d = lib.disk;
  const mine = isRec ? t.recs : t.shots, count = (isRec ? lib.recs : lib.shots).length, media = t.recs + t.shots;
  STK.setHtml($('#lib-summary'), `<div><div class="v">${count}</div><div class="l">${isRec ? 'Recordings' : 'Screenshots'}</div></div><div><div class="v">${bytes(mine)}</div><div class="l">Used by ${isRec ? 'recordings' : 'screenshots'}</div></div><div><div class="v">${d && d.total ? bytes(d.free) : '—'}</div><div class="l">Free on this PC</div></div>
    ${d && d.total ? `<div class="meter"><i class="m-media" style="width:${Math.max(0.6, media / d.total * 100).toFixed(2)}%"></i><i class="m-other" style="width:${Math.max(0, (d.total - d.free - media) / d.total * 100).toFixed(2)}%"></i></div>` : ''}`);
  $('#bulkbar').hidden = !L.selecting;
  $('#lib-select').classList.toggle('primary', L.selecting);
  $('#bulk-count').textContent = L.selected.size + ' selected';
  $('#bulk-delete').disabled = !L.selected.size;
  const box = $('#lib-list');
  if (!list.length) {
    STK.setHtml(box, `<div class="empty">${icon(isRec ? 'library' : 'image')}<b>${L.filter ? 'No match' : (isRec ? 'No recordings yet' : 'No screenshots yet')}</b><p>${L.filter ? 'Try a different name.' : (isRec ? 'Press Record on the Console to save your first session.' : 'Press Screenshot on the Console to grab the phone screen.')}</p></div>`);
    return;
  }
  const sel = n => L.selected.has(n);
  if (!isRec) {
    STK.setHtml(box, `<div class="shots">${list.map(f => `<button class="tile ${sel(f.name) ? 'sel' : ''}" data-lshot="${esc(f.name)}" title="${esc(f.name)}"><img loading="lazy" src="/api/file?kind=screenshots&name=${encodeURIComponent(f.name)}" alt="Screenshot ${esc(f.name)}"><span class="cap">${esc(when(f.modified))} · ${bytes(f.size)}</span></button>`).join('')}</div>`);
    return;
  }
  STK.setHtml(box, list.map(f => `<div class="row-file ${L.selecting ? 'selectable' : ''} ${sel(f.name) ? 'sel' : ''}">
    ${L.selecting ? `<input type="checkbox" data-lsel="${esc(f.name)}" ${sel(f.name) ? 'checked' : ''} ${f.live ? 'disabled' : ''} aria-label="Select ${esc(f.name)}">` : ''}
    <span class="badge">${icon('library')}</span>
    <div><b>${esc(f.name)}${f.live ? '<span class="live-tag">REC</span>' : ''}</b><small>${esc(when(f.modified))} · ${esc(ago(f.modified))}</small>${X().chips ? X().chips(f.name) : ''}</div>
    <span class="size">${bytes(f.size)}</span>
    <button class="icon-btn starbtn ${X().meta(f.name).f ? 'on' : ''}" data-lfav="${esc(f.name)}" title="Favourite" aria-label="Favourite ${esc(f.name)}">${icon('star')}</button>
    <div class="row-actions">
      <button class="icon-btn" data-lplay="${esc(f.name)}" title="Play" aria-label="Play ${esc(f.name)}">${icon('play')}</button>
      <button class="icon-btn" data-lreveal="${esc(f.name)}" title="Show in folder" aria-label="Show ${esc(f.name)} in folder">${icon('folder')}</button>
      <button class="icon-btn" data-lmore="${esc(f.name)}" title="More" aria-label="More actions for ${esc(f.name)}">${icon('more')}</button>
    </div></div>`).join(''));
}
STK.renderLibrary = render;
STK.on('kv', () => { if (state.view === 'library' && state.lib.loaded) render(); });

/* ---------- file actions ---------- */
async function fileOp(k, name, op, extra = {}) { return STK.post('/file-op', { kind: k, name, op, ...extra }); }
async function reveal(k, name) { try { await fileOp(k, name, 'reveal'); } catch (e) { STK.fail(e); } }
async function rename(k, name) {
  const base = name.replace(/\.\w+$/, '');
  const v = await STK.prompt('Rename file', 'New name (the extension stays the same)', base, 'Rename');
  if (!v || v === base) return;
  try { await fileOp(k, name, 'rename', { newName: v }); STK.toast('Renamed.'); await STK.loadLibrary(); } catch (e) { STK.fail(e); }
}
async function del(k, name) {
  if (!await STK.confirmDelete('Delete this file?', `<p><b>${esc(name)}</b> will be removed permanently. This cannot be undone.</p>`)) return false;
  try { await fileOp(k, name, 'delete'); STK.toast('Deleted ' + name + '.'); L.selected.delete(name); await STK.loadLibrary(); return true; } catch (e) { STK.fail(e); return false; }
}
function download(k, name) { const a = document.createElement('a'); a.href = `/api/file?kind=${k}&name=${encodeURIComponent(name)}&download=1`; a.download = name; document.body.append(a); a.click(); a.remove(); }

function play(name) {
  if (/\.gif$/i.test(name)) return showPicFile('recordings', name);
  L.current = name;
  const v = $('#video-el');
  $('#video-title').textContent = name;
  $('#video-note').textContent = 'If the video does not play here, use Open in player.';
  v.onerror = () => { $('#video-note').textContent = 'This browser cannot play this file. Use Open in player instead.'; };
  v.preload = 'auto';
  STK.quiet = true; // 4.3.0: while a video plays the dashboard stops its busy work so playback stays smooth
  v.src = `/api/file?kind=recordings&name=${encodeURIComponent(name)}`;
  if (X().markers) X().markers(name);
  $('#dlg-video').showModal();
  v.play().catch(() => {});
}
$('#dlg-video').addEventListener('close', () => { STK.quiet = false; const v = $('#video-el'); v.pause(); v.removeAttribute('src'); v.load(); });
$('#video-close').addEventListener('click', () => $('#dlg-video').close());
$('#video-open').addEventListener('click', () => fileOp('recordings', L.current, 'open').catch(STK.fail));
$('#video-reveal').addEventListener('click', () => reveal('recordings', L.current));
$('#video-save').addEventListener('click', () => download('recordings', L.current));

STK.playRecording = play;

/* screenshot viewer */
function showPicFile(kind, name) {
  L.shotList = [name]; L.shotIndex = 0; L.curKind = kind; L.current = name;
  $('#shot-title').textContent = name; $('#shot-img').src = `/api/file?kind=${kind}&name=${encodeURIComponent(name)}`;
  $('#shot-prev').disabled = true; $('#shot-next').disabled = true;
  if (!$('#dlg-shot').open) $('#dlg-shot').showModal();
}
function showShot(name) {
  L.curKind = 'screenshots';
  L.shotList = (state.lib.shots.slice().sort(SORT.new)).map(f => f.name);
  L.shotIndex = Math.max(0, L.shotList.indexOf(name));
  paintShot();
  if (!$('#dlg-shot').open) $('#dlg-shot').showModal();
}
function paintShot() {
  const name = L.shotList[L.shotIndex];
  if (!name) { $('#dlg-shot').close(); return; }
  L.current = name;
  $('#shot-title').textContent = name;
  $('#shot-img').src = `/api/file?kind=screenshots&name=${encodeURIComponent(name)}`;
  $('#shot-prev').disabled = L.shotIndex <= 0;
  $('#shot-next').disabled = L.shotIndex >= L.shotList.length - 1;
}
STK.showShot = showShot;
$('#shot-close').addEventListener('click', () => $('#dlg-shot').close());
$('#shot-prev').addEventListener('click', () => { L.shotIndex--; paintShot(); });
$('#shot-next').addEventListener('click', () => { L.shotIndex++; paintShot(); });
$('#shot-reveal').addEventListener('click', () => reveal(L.curKind || 'screenshots', L.current));
$('#shot-save').addEventListener('click', () => download(L.curKind || 'screenshots', L.current));
$('#shot-delete').addEventListener('click', async () => { const name = L.current; if (await del(L.curKind || 'screenshots', name)) { L.shotList.splice(L.shotIndex, 1); if (L.shotIndex >= L.shotList.length) L.shotIndex = L.shotList.length - 1; paintShot(); } });
$('#dlg-shot').addEventListener('keydown', e => { if (e.key === 'ArrowLeft' && !$('#shot-prev').disabled) { L.shotIndex--; paintShot(); } if (e.key === 'ArrowRight' && !$('#shot-next').disabled) { L.shotIndex++; paintShot(); } });

/* cleanup */
async function cleanup(btn) {
  const days = Number($('#cleanup-days').value);
  if (!(days >= 1 && days <= 3650)) return STK.toast('Enter a number of days between 1 and 3650.', 'bad');
  await STK.busy(btn, async () => {
    try {
      const p = await STK.api(`/cleanup-preview?days=${days}&kind=${L.tab}`);
      if (!p.files.length) return STK.toast(`No ${L.tab} are older than ${days} days.`);
      const total = p.files.reduce((n, f) => n + f.size, 0);
      const list = `<p>${p.files.length} file${p.files.length > 1 ? 's' : ''} older than ${days} days, ${bytes(total)} in total.</p><ul>${p.files.slice(0, 40).map(f => `<li><span>${esc(f.name)}</span><span>${bytes(f.size)}</span></li>`).join('')}</ul>${p.files.length > 40 ? `<p class="hint">and ${p.files.length - 40} more</p>` : ''}`;
      if (!await STK.confirm('Delete old ' + L.tab + '?', list, `Delete ${p.files.length}`)) return;
      const r = await STK.post('/cleanup', { days, confirm: true, kind: L.tab });
      STK.toast(`Removed ${r.deleted} file${r.deleted === 1 ? '' : 's'} and freed ${bytes(r.freed)}.`);
      STK.loadLibrary();
    } catch (e) { STK.fail(e); }
  });
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button, input[data-lsel]');
  if (!t) return;
  if (t.dataset.tab) { L.tab = t.dataset.tab; L.selected.clear(); $$('#view-library .tab').forEach(b => { const on = b === t; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); }); return render(); }
  if (t.dataset.lfav) { X().toggleFav(t.dataset.lfav); return render(); }
  if (t.dataset.lplay) return play(t.dataset.lplay);
  if (t.dataset.play) { STK.go('library'); return play(t.dataset.play); }
  if (t.dataset.lreveal) return reveal('recordings', t.dataset.lreveal);
  if (t.dataset.lmore) {
    const n = t.dataset.lmore, f = state.lib.recs.find(x => x.name === n);
    return STK.menu(t, [
      { label: 'Open in player', icon: 'external', run: () => fileOp('recordings', n, 'open').catch(STK.fail) },
      { label: 'Download', icon: 'download', run: () => download('recordings', n) },
      { label: 'Rename', icon: 'pencil', run: () => rename('recordings', n), disabled: f && f.live },
      { label: 'Tags', icon: 'tag', run: () => X().editTags(n) },
      { label: 'Trim or shrink', icon: 'scissors', run: () => X().convert(n, 'trim'), disabled: f && f.live },
      { label: 'Make a GIF', icon: 'image', run: () => X().convert(n, 'gif'), disabled: f && f.live },
      { label: 'Check sound', icon: 'play', run: () => STK.audioCheck && STK.audioCheck(n), disabled: (f && f.live) || /\.gif$/i.test(n) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, run: () => del('recordings', n) }
    ].filter(i => !i.disabled));
  }
  if (t.dataset.lshot) { if (L.selecting) { L.selected.has(t.dataset.lshot) ? L.selected.delete(t.dataset.lshot) : L.selected.add(t.dataset.lshot); return render(); } return showShot(t.dataset.lshot); }
  if (t.dataset.shot) { STK.loadLibrary().then(() => showShot(t.dataset.shot)); return; }
  if (t.dataset.lsel) { t.checked ? L.selected.add(t.dataset.lsel) : L.selected.delete(t.dataset.lsel); return render(); }
});
$('#lib-select').addEventListener('click', () => { L.selecting = !L.selecting; L.selected.clear(); render(); });
$('#bulk-cancel').addEventListener('click', () => { L.selecting = false; L.selected.clear(); render(); });
$('#bulk-all').addEventListener('click', () => { files().filter(f => !f.live).forEach(f => L.selected.add(f.name)); render(); });
$('#bulk-delete').addEventListener('click', async e => {
  const names = [...L.selected];
  if (!names.length) return;
  if (!await STK.confirmDelete(`Delete ${names.length} file${names.length > 1 ? 's' : ''}?`, `<ul>${names.slice(0, 30).map(n => `<li><span>${esc(n)}</span></li>`).join('')}</ul>${names.length > 30 ? `<p class="hint">and ${names.length - 30} more</p>` : ''}<p>This cannot be undone.</p>`, 'Delete')) return;
  await STK.busy(e.currentTarget, async () => {
    try { const r = await STK.post('/delete-files', { kind: kind(), names }); STK.toast(`Deleted ${r.deleted} file${r.deleted === 1 ? '' : 's'}${r.skipped ? ', skipped ' + r.skipped : ''}.`); L.selected.clear(); L.selecting = false; STK.loadLibrary(); } catch (er) { STK.fail(er); }
  });
});
$('#lib-search').addEventListener('input', e => { L.filter = e.target.value; render(); });
$('#lib-sort').addEventListener('change', e => { L.sort = e.target.value; render(); });
$('#lib-fav').addEventListener('click', e => { L.favOnly = !L.favOnly; e.currentTarget.classList.toggle('primary', L.favOnly); render(); });
$('#lib-refresh').addEventListener('click', e => STK.busy(e.currentTarget, async () => { await STK.loadLibrary(); STK.toast('Library refreshed.'); }));
$('#lib-folder').addEventListener('click', () => STK.post('/open-folder', { kind: L.tab }).catch(STK.fail));
$('#cleanup-btn').addEventListener('click', e => cleanup(e.currentTarget));

STK.views.library = { onShow() { render(); STK.loadLibrary(); } };
let lastRefresh = 0;
STK.on('state', () => {
  if (state.view === 'library' && state.sessions.some(s => s.recording) && Date.now() - lastRefresh > 4000) { lastRefresh = Date.now(); STK.loadLibrary(); }
});
})();
