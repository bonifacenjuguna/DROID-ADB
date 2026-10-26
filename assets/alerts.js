/* Notifications: read-only list of what the phone is showing, one-tap code copy, optional Windows alerts. */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const SHOW = 2, KEEP = 30, MAXAGE = 3 * 24 * 3600 * 1000;
const A = { open: new Set(), openLines: new Set(), hist: {}, histId: '', items: [], loading: false, filter: '', watch: STK.store.get('notif-watch', false), timer: null, seen: null, error: '' };
const nice = p => (STK.niceApp ? STK.niceApp(p) : p);
const root = () => $('#notif-root');
const OTP = /\b(\d{4,8}|\d{3}[- ]\d{3})\b/;
const WORDS = /code|otp|verif|passcode|pin\b|one[- ]time|security|login|sign.?in|confirm/i;
const codeOf = it => { const s = (it.title + ' ' + it.text); if (!WORDS.test(s)) return ''; const m = s.match(OTP); return m ? m[1].replace(/\D/g, '') : ''; };

const ikey = it => it.title + '|' + it.text;
function histFor(id) {
  if (A.histId === id) return A.hist;
  A.histId = id; A.hist = {};
  try { A.hist = JSON.parse(localStorage.getItem('stk-nhist:' + id) || '{}') || {}; } catch (e) { A.hist = {}; }
  return A.hist;
}
const cleanLines = a => (Array.isArray(a) ? a : []).filter(x => x && x.text).slice(-20).map(x => ({ text: String(x.text).slice(0, 300), sender: String(x.sender || '').slice(0, 60), time: Number(x.time) || 0 }));
function remember(id, items) {
  const h = histFor(id), now = Date.now();
  for (const it of items) {
    const list = h[it.package] || (h[it.package] = []), k = ikey(it), hit = list.find(x => ikey(x) === k), ls = cleanLines(it.lines);
    if (hit) { hit.last = now; if (it.when) hit.when = it.when; if (ls.length) hit.lines = ls; } else list.unshift({ title: it.title, text: it.text, when: it.when || 0, first: now, last: now, lines: ls });
  }
  for (const p of Object.keys(h)) { h[p] = h[p].filter(x => now - x.last < MAXAGE).sort((a, b) => (b.when || b.first) - (a.when || a.first)).slice(0, KEEP); if (!h[p].length) delete h[p]; }
  try { localStorage.setItem('stk-nhist:' + id, JSON.stringify(h)); } catch (e) { /* storage blocked or full */ }
}
const stamp = it => it.when || it.first || 0;
const hide = it => it.package === 'android' || /^com\.android\.systemui$/.test(it.package) && !it.text;

async function load(quiet) {
  const id = STK.sel(); if (!id) { A.items = []; return paint(); }
  if (A.loading) return; A.loading = true; if (!quiet) paint();
  try {
    const r = await STK.api('/notifications?id=' + encodeURIComponent(id), { timeout: 40000 });
    A.items = (r.items || []).filter(i => !hide(i)); A.error = r.note || '';
    const keys = new Set(A.items.map(i => i.package + '|' + i.title + '|' + i.text));
    if (A.seen && A.watch) for (const it of A.items) { const k = it.package + '|' + it.title + '|' + it.text; if (!A.seen.has(k)) { const c = codeOf(it); STK.notify && STK.notify(nice(it.package) + (it.title ? ': ' + it.title : ''), c ? 'Code ' + c : it.text, 'n' + k.length); } }
    A.seen = keys; remember(id, A.items);
    const b = $('#rail-notif'); b.hidden = !A.items.length || !A.watch; b.textContent = A.items.length > 99 ? '99+' : A.items.length;
  } catch (e) { A.error = e.message; }
  A.loading = false; if (state.view === 'notifications') paint();
}
function paint() {
  if (state.view !== 'notifications') return;
  const id = STK.sel();
  const head = `<div class="toolbar"><div class="search"><svg class="ic sm"><use href="#i-search"/></svg><input id="n-filter" type="search" placeholder="Filter notifications" value="${esc(A.filter)}" autocomplete="off" aria-label="Filter notifications"></div>
    <label class="live-toggle" title="Show new phone notifications as Windows notifications while this page is open"><span class="switch sm"><input type="checkbox" id="n-watch" ${A.watch ? 'checked' : ''} aria-label="Mirror to Windows"><i></i></span><span>Mirror new ones to Windows</span></label>
    <button class="btn" id="n-refresh">${icon('refresh', 'sm')}<span>Refresh</span></button></div>`;
  let body;
  if (!id) body = `<section class="panel"><div class="empty">${icon('plug')}<b>No phone connected</b><p>Connect a phone to see its notifications.</p></div></section>`;
  else {
    const f = A.filter.toLowerCase();
    const list = A.items.filter(i => !f || (i.package + ' ' + i.title + ' ' + i.text).toLowerCase().includes(f));
    if (A.loading && !A.items.length) body = '<section class="panel"><p class="hint">Reading notifications...</p></section>';
    else if (!list.length) body = `<section class="panel"><div class="empty">${icon('bell')}<b>${A.items.length ? 'No match' : 'No notifications'}</b><p>${esc(A.error || (A.items.length ? 'Try a different word.' : 'The phone is not showing any notifications right now.'))}</p></div></section>`;
    else {
      const f2 = A.filter.toLowerCase(), h = histFor(id), now = {};
      const groups = {};
      list.forEach(i => { (groups[i.package] = groups[i.package] || []).push(Object.assign({ live: true }, i)); });
      for (const p of Object.keys(h)) {
        const have = new Set((groups[p] || []).map(ikey));
        h[p].forEach(x => { if (have.has(ikey(x))) return; if (f2 && !(p + ' ' + x.title + ' ' + x.text).toLowerCase().includes(f2)) return; (groups[p] = groups[p] || []).push(Object.assign({ live: false }, x)); });
      }
      const SUMMARY = /^\d+\s+(new\s+)?(messages?|chats?)\b/i;
      const lineKey = x => (x.time || 0) + '|' + (x.sender || '') + '|' + x.text;
      const timeOf = x => (x.time ? STK.ago(x.time) : '');
      const row = (it, old, ctx) => {
        const c = codeOf(it), tk = p0 => p0 + '|' + it.title;
        let extra = '';
        if (!ctx.done.has(it.title)) {
          ctx.done.add(it.title);
          const union = new Map();
          ctx.all.forEach(x => { if (x.title === it.title) (x.lines || []).forEach(l => { if (l && l.text && !union.has(lineKey(l))) union.set(lineKey(l), l); }); });
          const shown = new Set(ctx.all.filter(x => x.title === it.title).map(x => x.text));
          const msgs = [...union.values()].filter(l => !shown.has(l.text) && !SUMMARY.test(l.text)).sort((a, b) => (a.time || 0) - (b.time || 0));
          const key = ctx.pkg + '|' + it.title, open = A.openLines.has(key);
          if (msgs.length) extra = `<button class="nmore" type="button" data-nline="${esc(key)}" aria-expanded="${open}">${icon('chevron', 'sm')}<span>${open ? 'Hide earlier messages' : 'Show ' + msgs.length + ' earlier message' + (msgs.length === 1 ? '' : 's')}</span></button>${open ? `<div class="nlines">${msgs.map(l => `<div class="nline">${l.sender ? `<b>${esc(l.sender)}</b>` : ''}<p>${esc(l.text)}</p>${timeOf(l) ? `<small>${esc(timeOf(l))}</small>` : ''}</div>`).join('')}</div>` : ''}`;
          else {
            const hint = (ctx.all.find(x => x.title === it.title && x.hint) || {}).hint;
            if (hint && ctx.all.some(x => x.title === it.title && SUMMARY.test(x.text))) extra = `<small class="nhint">${esc(hint)}</small>`;
          }
        }
        return `<div class="nrow"><div><b>${esc(it.title || '(no title)')}</b><p>${esc(it.text)}</p>${stamp(it) ? `<small>${esc(STK.ago(stamp(it)))}${old ? ' · no longer on the phone' : ''}</small>` : ''}${extra}</div>${c ? `<button class="btn sm primary" data-ncopy="${esc(c)}">${icon('copy', 'sm')}<span>Copy ${esc(c)}</span></button>` : ''}</div>`;
      };
      body = Object.keys(groups).map(p => {
        const all = groups[p].sort((a, b) => (b.live - a.live) || (stamp(b) - stamp(a)));
        const top = all.slice(0, SHOW), rest = all.slice(SHOW), open = A.open.has(p), ctx = { pkg: p, all, done: new Set() };
        return `<section class="panel nlist"><header class="panel-head"><h2>${esc(nice(p))}${rest.length ? `<span class="nbadge">${all.length}</span>` : ''}</h2><span class="hint mono">${esc(p)}</span></header>${top.map(it => row(it, !it.live, ctx)).join('')}${rest.length ? `<button class="nmore" type="button" data-nmore="${esc(p)}" aria-expanded="${open}">${icon('chevron', 'sm')}<span>${open ? 'Hide earlier' : 'Show ' + rest.length + ' earlier'}</span></button>${open ? `<div class="nearlier">${rest.map(it => row(it, !it.live, ctx)).join('')}</div>` : ''}` : ''}</section>`;
      }).join('');
    }
  }
  const keep = document.activeElement && document.activeElement.id === 'n-filter';
  root().innerHTML = head + body + '<p class="hint" style="margin-top:10px">This list is read-only. Notification text can contain private messages, so it stays on this PC.</p>';
  if (keep) { const i = $('#n-filter'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
function poll() { clearInterval(A.timer); A.timer = null; if (A.watch || state.view === 'notifications') A.timer = setInterval(() => { if (!document.hidden) load(true); }, A.watch && state.view !== 'notifications' ? 12000 : 6000); }
document.addEventListener('click', e => {
  const t = e.target.closest('#notif-root button'); if (!t) return;
  if (t.id === 'n-refresh') return load();
  if (t.dataset.nline) { const k = t.dataset.nline; if (A.openLines.has(k)) A.openLines.delete(k); else A.openLines.add(k); return paint(); }
  if (t.dataset.nmore) { const p = t.dataset.nmore; if (A.open.has(p)) A.open.delete(p); else A.open.add(p); return paint(); }
  if (t.dataset.ncopy) return navigator.clipboard.writeText(t.dataset.ncopy).then(() => STK.toast('Code ' + t.dataset.ncopy + ' copied.'), () => STK.toast('The browser blocked copying.', 'bad'));
});
document.addEventListener('input', e => { if (e.target.id === 'n-filter') { A.filter = e.target.value; paint(); } });
document.addEventListener('change', e => { if (e.target.id === 'n-watch') { A.watch = e.target.checked; STK.store.set('notif-watch', A.watch); if (A.watch && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission(); A.seen = null; poll(); load(true); } });
STK.views.notifications = { onShow() { paint(); load(); poll(); } };
STK.on('view', v => { if (v !== 'notifications') poll(); });
STK.on('device-changed', () => { A.items = []; A.seen = null; A.histId = ''; A.open.clear(); A.openLines.clear(); if (state.view === 'notifications') load(); });
if (A.watch) STK.on('state', () => { if (!A.timer) poll(); });
})();
