/* DROID ADB 4.11 Stretch viewer launcher. Adds a "Stretch viewer" button next to Screenshot on the Console. It opens
   assets/viewer.html in its own window: a second window that shows the mirror enlarged or stretched to fill it.
   The phone is not changed and no virtual screen is used. */
(() => {
'use strict';
const { $, icon, state } = STK;
let win = null;

function open() {
  const id = STK.sel(), inf = STK.info() || {};
  const qs = new URLSearchParams({ serial: id || '', w: inf.width || 0, h: inf.height || 0 });
  const w = Math.min(screen.availWidth - 40, 1280), h = Math.min(screen.availHeight - 80, 800);
  if (!(state.sessions || []).length) STK.toast('Open Mirror first, keep its window open, then press Start capture in the viewer.');
  try { win = window.open('assets/viewer.html?' + qs.toString(), 'droid-adb-viewer', 'popup=yes,width=' + w + ',height=' + h); } catch (e) { win = null; }
  if (!win) STK.toast('The browser blocked the new window. Allow pop-ups for this page and try again.', 'bad');
  else try { win.focus(); } catch (e) {}
}
function mount() {
  if ($('#relay-btn')) return;
  const shot = $('#shot-btn'); if (!shot) return;
  const b = document.createElement('button');
  b.className = 'btn lg'; b.id = 'relay-btn'; b.type = 'button';
  b.title = 'Open the Stretch viewer: a second window that shows the mirror enlarged or stretched to fill it. The phone is not changed.';
  b.innerHTML = icon('expand', 'sm') + '<span>Stretch viewer</span>';
  b.addEventListener('click', open);
  shot.after(b);
}
STK.openStretchViewer = open;
STK.on('view', v => { if (v === 'console') mount(); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
setTimeout(mount, 1500);
})();
