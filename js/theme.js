/* Day / night appearance. Loaded first so the page never flashes the wrong colours.
   Auto follows the phone or computer; the choice is remembered on this device. */
(function () {
  var KEY = 'qt_theme', pref = null;
  try { pref = localStorage.getItem(KEY); } catch (e) {}
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function apply() {
    var t = pref === 'light' || pref === 'dark' ? pref : (mq && mq.matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'dark' ? '#15142A' : '#D19B5B');
  }
  apply();
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply); }
  window.QTTheme = {
    get: function () { return pref === 'light' || pref === 'dark' ? pref : 'auto'; },
    now: function () { return document.documentElement.getAttribute('data-theme'); },
    set: function (v) {
      pref = v === 'light' || v === 'dark' ? v : null;
      try { if (pref) localStorage.setItem(KEY, pref); else localStorage.removeItem(KEY); } catch (e) {}
      document.documentElement.classList.add('theming'); apply();
      setTimeout(function () { document.documentElement.classList.remove('theming'); }, 450);
    }
  };
})();

/* Safety net: if a script fails while the page is opening (for example an old saved copy on a phone),
   offer one tap that clears the saved copies and opens the newest version, instead of a blank screen. */
(function () {
  var t0 = Date.now(), shown = false;
  function fresh() {
    var done = function () { location.replace(location.pathname + '?r=' + Date.now() + location.hash); };
    var jobs = [];
    try { if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) jobs.push(navigator.serviceWorker.getRegistrations().then(function (l) { return Promise.all(l.map(function (r) { return r.unregister(); })); })); } catch (e) {}
    try { if (window.caches && caches.keys) jobs.push(caches.keys().then(function (k) { return Promise.all(k.map(function (n) { return caches.delete(n); })); })); } catch (e) {}
    Promise.all(jobs).then(done, done); setTimeout(done, 2500);
  }
  window.addEventListener('error', function (e) {
    if (shown || Date.now() - t0 > 15000 || !e.filename || !/\/(js|vendor)\//.test(e.filename)) return;
    shown = true;
    var show = function () {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'The portal did not open properly. Tap here to load the newest version.';
      b.setAttribute('style', 'position:fixed;left:12px;right:12px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:2147483646;padding:16px;border-radius:14px;border:0;background:#0E1736;color:#F4DE9C;font:700 15px/1.4 -apple-system,Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)');
      b.addEventListener('click', function () { b.textContent = 'Loading the newest version…'; fresh(); });
      document.body.appendChild(b);
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  });
})();
