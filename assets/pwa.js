/* DROID ADB 4.2: install as an app (Chrome, Edge). Registers the service worker, shows an Install button
   when the browser offers it, and tells the user when the app was installed. */
(() => {
'use strict';
const { $, icon } = STK;
const standalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
const P = STK.pwa = { prompt: null, installed: standalone(), can: () => !!P.prompt && !P.installed };

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* an older backend has no /sw.js: installing still works in Edge */ }); });
}

function button() {
  let b = $('#install-btn');
  if (!b) {
    b = document.createElement('button'); b.id = 'install-btn'; b.type = 'button'; b.className = 'btn sm install-btn'; b.hidden = true;
    b.innerHTML = icon('download', 'sm') + '<span>Install app</span>';
    const tools = $('.top-tools'); if (tools) tools.insertBefore(b, $('#theme-btn') || null);
    b.addEventListener('click', () => P.install());
  }
  return b;
}
function paint() { const b = button(); b.hidden = !P.can(); }
P.install = async function () {
  if (P.installed) return STK.toast('DROID ADB is already installed as an app.');
  if (!P.prompt) return STK.toast('Your browser did not offer installing yet. In Chrome or Edge, open the browser menu and choose Install DROID ADB (or Apps, Install this site as an app).', 'bad');
  const ev = P.prompt; P.prompt = null; paint();
  try { ev.prompt(); const r = await ev.userChoice; if (r && r.outcome === 'accepted') STK.toast('Installing DROID ADB...'); } catch (e) { /* ignored */ }
};
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); P.prompt = e; paint(); });
window.addEventListener('appinstalled', () => { P.installed = true; P.prompt = null; paint(); STK.toast('DROID ADB was installed. Open it from your Start menu, Desktop or apps list.'); });
if (window.matchMedia) { try { window.matchMedia('(display-mode: standalone)').addEventListener('change', e => { P.installed = e.matches; paint(); }); } catch (er) { /* old browser */ } }
document.addEventListener('DOMContentLoaded', paint);
if (document.readyState !== 'loading') paint();
})();
