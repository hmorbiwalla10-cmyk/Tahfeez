/* Qism al Tahfeez — makes the portal installable and quick to open.
   Pages, scripts and styles: network first (always fresh, never an old script with a new page), saved copy when offline.
   Fonts and pictures: saved copy first, refreshed in the background.
   Database calls (Supabase) are never cached. */
var CACHE = 'qt-v43';
var SHELL = ['index.html', 'student.html', 'institute.html', 'css/style.css', 'css/fonts.css', 'css/fatimid.css', 'css/night.css', 'css/imperial.css', 'css/majestic.css', 'js/fx.js', 'js/landing.js', 'js/theme.js', 'js/config.js', 'js/core.js', 'js/student.js', 'js/institute.js',
  'vendor/supabase.js', 'assets/logo-qt-sm.png', 'assets/logo-qt.png', 'assets/app-192.png', 'fonts/al-kanz-arabic.woff2'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // Supabase and other sites: straight to the network
  // pages, scripts and styles: always the newest from the network (so they never mix versions), the saved copy only when offline
  if (req.mode === 'navigate' || /\.(html|js|css)$/.test(url.pathname) || url.pathname.slice(-1) === '/') {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()); }); }));
    return;
  }
  // fonts and pictures: the saved copy first, refreshed in the background
  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) { if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); } return res; });
    return hit || net;
  }));
});
/* Phone alerts: show what the server sent, and open the right page when it is tapped. */
self.addEventListener('push', function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Tahfeez Daressalaam', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Tahfeez Daressalaam', {
    body: d.body || '', icon: 'assets/app-192.png', badge: 'assets/app-192.png', tag: d.tag || 'qt', renotify: true,
    vibrate: [80, 40, 80], data: { url: d.url || 'institute.html#schedule' }
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || 'institute.html#schedule';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { var c = list[i]; if (/institute\.html/.test(c.url) && 'focus' in c) { c.postMessage({ type: 'open', url: url }); return c.focus(); } }
    return self.clients.openWindow ? self.clients.openWindow(url) : null;
  }));
});

