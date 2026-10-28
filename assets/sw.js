/* DROID ADB service worker (4.2.2).
   Purpose: lets Chrome and Edge install the dashboard as an app and shows a friendly page when the
   local service is not running. It never touches /api/ requests, and it always prefers the network,
   so a new version of the dashboard is used right away. */
'use strict';
const VERSION = '4.2.2';
const CACHE = 'droid-adb-' + VERSION;
const SHELL = ['/', '/assets/style.css', '/assets/studio.css', '/assets/xp.css', '/assets/motion.css', '/assets/core.js', '/assets/console.js', '/assets/xp-ui.js', '/assets/studio.js', '/assets/studio-plus.js', '/assets/motion.js', '/assets/manifest.webmanifest', '/assets/icon-192.png'];

const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DROID ADB</title>
<style>:root{color-scheme:dark light}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#020f20;color:#e9ecf1;font:16px/1.6 system-ui,Segoe UI,sans-serif}
main{max-width:520px;padding:28px;text-align:center}img{width:72px;height:72px;border-radius:18px}h1{font-size:22px;margin:16px 0 6px}p{color:#a5aebc;margin:6px 0}
button{margin-top:18px;padding:11px 20px;border-radius:10px;border:0;background:#f2b544;color:#1c1405;font:600 15px system-ui;cursor:pointer}</style></head>
<body><main><img src="/assets/icon-192.png" alt=""><h1>DROID ADB is not running</h1>
<p>The local service did not answer. Double-click <b>Launch.bat</b> in the DROID ADB folder, then try again.</p>
<button onclick="location.reload()">Try again</button></main>
<script>setInterval(()=>fetch('/api/ping',{cache:'no-store'}).then(r=>r.ok&&location.reload()).catch(()=>{}),3000)</script></body></html>`;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('droid-adb-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { const r = await fetch(req); if (r.ok) { const c = await caches.open(CACHE); c.put('/', r.clone()).catch(() => {}); } return r; }
      catch (err) { return new Response(OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }); }
    })());
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith((async () => {
      try { const r = await fetch(req, { cache: 'no-store' }); if (r.ok) { const c = await caches.open(CACHE); c.put(req, r.clone()).catch(() => {}); } return r; }
      catch (err) { const hit = await caches.match(req); return hit || Response.error(); }
    })());
  }
});
