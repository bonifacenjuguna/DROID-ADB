/* Notifications: read-only list of what the phone is showing, one-tap code copy, optional Windows alerts. */
(() => {
'use strict';
const { $, $$, esc, icon, state } = STK;
const A = { items: [], loading: false, filter: '', watch: STK.store.get('notif-watch', false), timer: null, seen: null, error: '', open: new Set(), moreChats: new Set() };
const nice = p => (STK.niceApp ? STK.niceApp(p) : p);
const root = () => $('#notif-root');
const OTP = /\b(\d{4,8}|\d{3}[- ]\d{3})\b/;
const WORDS = /code|otp|verif|passcode|pin\b|one[- ]time|security|login|sign.?in|confirm/i;
const codeOf = it => { const s = (it.title + ' ' + it.text); if (!WORDS.test(s)) return ''; const m = s.match(OTP); return m ? m[1].replace(/\D/g, '') : ''; };
const hide = it => it.package === 'android' || /^com\.android\.systemui$/.test(it.package) && !it.text;

async function load(quiet) {
  const id = STK.sel(); if (!id) { A.items = []; return paint(); }
  if (A.loading) return; A.loading = true; if (!quiet) paint();
  try {
    const r = await STK.api('/notifications?id=' + encodeURIComponent(id), { timeout: 40000 });
    A.items = (r.items || []).filter(i => !hide(i)); A.error = r.note || '';
    const keys = new Set(A.items.map(i => i.package + '|' + i.title + '|' + i.text));
    if (A.seen && A.watch) for (const it of A.items) { const k = it.package + '|' + it.title + '|' + it.text; if (!A.seen.has(k)) { const c = codeOf(it); STK.notify && STK.notify(nice(it.package) + (it.title ? ': ' + it.title : ''), c ? 'Code ' + c : it.text, 'n' + k.length); } }
    A.seen = keys;
    const b = $('#rail-notif'); b.hidden = !A.items.length || !A.watch; b.textContent = A.items.length > 99 ? '99+' : A.items.length;
  } catch (e) { A.error = e.message; }
  A.loading = false; if (state.view === 'notifications') paint();
}

/* One app panel: chats are grouped by sender, newest message shown, earlier ones behind an expander. */
const SUMMARY = /^\s*(\d+)\+?\s+(new\s+)?(messages?|notifications?|chats?)\b/i;
const whenOf = it => Number(it.when) || 0;
function rowHtml(it, badge = '') {
  const c = codeOf(it);
  return `<div class="nrow"><div><b>${esc(it.title || '(no title)')}</b>${badge}<p>${esc(it.text)}</p>${it.when ? `<small>${esc(STK.ago(it.when))}</small>` : ''}</div>${c ? `<button class="btn sm primary" data-ncopy="${esc(c)}">${icon('copy', 'sm')}<span>Copy ${esc(c)}</span></button>` : ''}</div>`;
}
function appPanel(pkg, items) {
  const chats = {}, order = [];
  items.forEach(it => { const k = (it.conversation || it.title || '(no title)'); if (!chats[k]) { chats[k] = []; order.push(k); } chats[k].push(it); });
  const MAXCHATS = 3, wantAll = A.moreChats.has(pkg);
  const shown = wantAll ? order : order.slice(0, MAXCHATS);
  const html = shown.map(k => {
    const all = chats[k];
    // The phone's own "5 new messages" line becomes a count badge instead of a message.
    let count = 0;
    const real = all.filter(it => { const m = it.summary || SUMMARY.test(it.text || '') ? SUMMARY.exec(it.text || '') : null; if (m && all.length > 1) { count = Math.max(count, Number(m[1]) || 0); return false; } return true; });
    const msgs = (real.length ? real : all).slice().sort((a, b) => whenOf(b) - whenOf(a));
    const key = pkg + '|' + k, isOpen = A.open.has(key), earlier = msgs.slice(1);
    const badge = count > 1 ? `<span class="nbadge" title="Unread messages in this chat">${count} new</span>` : '';
    let h = `<div class="nchat">${rowHtml(msgs[0], badge)}`;
    if (earlier.length) {
      h += `<button class="nmore ${isOpen ? 'open' : ''}" data-nexp="${esc(key)}" aria-expanded="${isOpen}">${icon('chevron', 'sm')}<span>${isOpen ? 'Hide earlier' : earlier.length + ' earlier'}</span></button>`;
      if (isOpen) h += `<div class="nearlier">${earlier.map(m => rowHtml(m)).join('')}</div>`;
    }
    return h + '</div>';
  }).join('');
  const hidden = order.length - shown.length;
  const more = order.length > MAXCHATS ? `<button class="nmore chats" data-nchats="${esc(pkg)}">${icon('chevron', 'sm')}<span>${wantAll ? 'Show fewer chats' : hidden + ' more chat' + (hidden === 1 ? '' : 's')}</span></button>` : '';
  return `<section class="panel nlist"><header class="panel-head"><h2>${esc(nice(pkg))}</h2><span class="hint"><span class="mono">${esc(pkg)}</span> · ${items.length}</span></header>${html}${more}</section>`;
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
      const groups = {}; list.forEach(i => (groups[i.package] = groups[i.package] || []).push(i));
      body = Object.keys(groups).map(p => appPanel(p, groups[p])).join('');
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
  if (t.dataset.nexp) { const k = t.dataset.nexp; if (A.open.has(k)) A.open.delete(k); else A.open.add(k); return paint(); }
  if (t.dataset.nchats) { const k = t.dataset.nchats; if (A.moreChats.has(k)) A.moreChats.delete(k); else A.moreChats.add(k); return paint(); }
  if (t.dataset.ncopy) return navigator.clipboard.writeText(t.dataset.ncopy).then(() => STK.toast('Code ' + t.dataset.ncopy + ' copied.'), () => STK.toast('The browser blocked copying.', 'bad'));
});
document.addEventListener('input', e => { if (e.target.id === 'n-filter') { A.filter = e.target.value; paint(); } });
document.addEventListener('change', e => { if (e.target.id === 'n-watch') { A.watch = e.target.checked; STK.store.set('notif-watch', A.watch); if (A.watch && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission(); A.seen = null; poll(); load(true); } });
STK.views.notifications = { onShow() { paint(); load(); poll(); } };
STK.on('view', v => { if (v !== 'notifications') poll(); });
STK.on('device-changed', () => { A.items = []; A.seen = null; if (state.view === 'notifications') load(); });
if (A.watch) STK.on('state', () => { if (!A.timer) poll(); });
})();
