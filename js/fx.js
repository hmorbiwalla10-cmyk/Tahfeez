/* Tahfeez Daressalaam — visual effects ("Raudat Tahera by night").
   The 604 arch (one gold tile per page of the Qur'an), gold dust, pointer parallax,
   tilt + glare on cards, numbers that count up when they change, tab reveals.
   Everything stays still for people who ask their device for reduced motion. */
(function () {
  'use strict';
  var MZ = window.MZ = window.MZ || {};
  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var finePointer = !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);
  var DPR = Math.min(2, window.devicePixelRatio || 1);
  var fx = MZ.fx = { reduce: reduce };

  /* ------------------------------------------------------------ shared sprites */
  function sprite(size, draw) { var c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); return c; }
  var DUST = sprite(64, function (g, s) {
    var r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,248,220,1)'); r.addColorStop(0.18, 'rgba(246,222,150,.9)'); r.addColorStop(0.45, 'rgba(212,175,55,.28)'); r.addColorStop(1, 'rgba(212,175,55,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });

  /* ------------------------------------------------------------ the keel arch */
  // al-Aqmar style keel arch in a unit box (0..1 wide, 0..1 tall): straight jambs, two arcs meeting in a keel point.
  function archPath(ctx, x, y, w, h, inset) {
    var i = inset || 0, L = x + i, R = x + w - i, T = y + i, B = y + h, sp = y + h * 0.44;
    ctx.beginPath();
    ctx.moveTo(L, B); ctx.lineTo(L, sp);
    ctx.bezierCurveTo(L, y + h * 0.17, x + w * 0.3, T + h * 0.07, x + w / 2, T);
    ctx.bezierCurveTo(x + w * 0.7, T + h * 0.07, R, y + h * 0.17, R, sp);
    ctx.lineTo(R, B);
  }
  // 604 tile centres inside the arch, ordered from the base upward (an arch is built from the ground).
  var layoutCache = {};
  function archLayout(aspect) {
    var key = aspect.toFixed(3); if (layoutCache[key]) return layoutCache[key];
    var test = document.createElement('canvas').getContext('2d'), W = 1000, H = W / aspect, best = null;
    archPath(test, 0, 0, W, H, W * 0.075);
    var inside = function (x, y, st) { return test.isPointInPath(x, y - st * 0.42) && test.isPointInPath(x - st * 0.42, y) && test.isPointInPath(x + st * 0.42, y); };
    // shrink the grid step a little at a time until 604 pages fit inside the arch
    for (var step = W / 14; step > W / 60; step *= 0.985) {
      var pts = [], rowH = step * 0.86, row = 0;
      for (var cy = H * 0.965 - rowH / 2; cy > H * 0.03; cy -= rowH, row++) {
        var off = row % 2 ? step / 2 : 0;
        for (var cx = W / 2 - Math.floor(W / step) * step + off; cx < W; cx += step) if (cx > 0 && inside(cx, cy, step)) pts.push([cx / W, cy / H, row]);
      }
      if (pts.length >= 604) { best = { pts: pts, step: step / W }; break; }
    }
    // an arch is built from the ground up: bottom row first, each row from the centre outward
    best.pts.sort(function (a, b) { return a[2] !== b[2] ? a[2] - b[2] : Math.abs(a[0] - 0.5) - Math.abs(b[0] - 0.5); });
    // drop any extra tiles from the very top so exactly 604 remain
    best.pts = best.pts.slice(0, 604);
    return (layoutCache[key] = best);
  }
  function tileSprite(size, lit) {
    return sprite(size, function (g, s) {
      var c = s / 2, k = s * 0.26;
      if (lit) {
        var glow = g.createRadialGradient(c, c, 0, c, c, c); glow.addColorStop(0, 'rgba(255,236,170,.55)'); glow.addColorStop(1, 'rgba(212,175,55,0)');
        g.fillStyle = glow; g.fillRect(0, 0, s, s);
      }
      g.translate(c, c); g.rotate(Math.PI / 4);
      var gr = g.createLinearGradient(-k, -k, k, k);
      if (lit) { gr.addColorStop(0, '#FFF4C8'); gr.addColorStop(0.45, '#E9C75A'); gr.addColorStop(1, '#A67C1E'); g.fillStyle = gr; g.fillRect(-k, -k, 2 * k, 2 * k); }
      else { g.strokeStyle = 'rgba(232,201,106,.32)'; g.lineWidth = Math.max(1, s * 0.03); g.strokeRect(-k, -k, 2 * k, 2 * k); }
    });
  }

  /* MZ.fx.arch(el, {lit: 604, animate: true, label: true})
     Draws the 604 arch into el (a canvas is added). lit = how many pages glow. */
  fx.arch = function (el, opt) {
    if (!el) return null;
    opt = opt || {};
    var cv = el.querySelector('canvas.fx-arch') || document.createElement('canvas'); cv.className = 'fx-arch'; cv.setAttribute('aria-hidden', 'true');
    if (!cv.parentNode) el.insertBefore(cv, el.firstChild);
    var ctx = cv.getContext('2d'), st = { lit: Math.max(0, Math.min(604, opt.lit == null ? 604 : opt.lit)), t0: performance.now(), raf: 0, shown: 0, dead: false };
    var w = 0, h = 0, lay = null, sprLit = null, sprOff = null, tile = 0;
    function size() {
      var r = el.getBoundingClientRect(); w = Math.max(60, r.width); h = Math.max(80, r.height);
      cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR); cv.style.width = w + 'px'; cv.style.height = h + 'px';
      lay = archLayout(w / h); tile = Math.max(3, lay.step * w * 0.68);
      sprLit = tileSprite(Math.round(tile * DPR * 1.6), true); sprOff = tileSprite(Math.round(tile * DPR * 1.6), false);
    }
    function frame(now) {
      if (st.dead) return;
      var t = (now - st.t0) / 1000, dur = opt.animate === false || reduce ? 0 : (opt.duration || 2.6);
      var p = dur ? Math.min(1, t / dur) : 1, ease = 1 - Math.pow(1 - p, 3), shown = Math.floor(st.lit * ease);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, w, h);
      // halo behind the arch
      var halo = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, h * 0.62);
      halo.addColorStop(0, 'rgba(244,222,156,' + (0.08 + 0.16 * (st.lit / 604) * ease) + ')'); halo.addColorStop(1, 'rgba(244,222,156,0)');
      ctx.save(); archPath(ctx, 0, 0, w, h, w * 0.012); ctx.closePath(); ctx.clip(); ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h); ctx.restore();
      // frame: outer and inner keel arch in gold leaf
      var gl = ctx.createLinearGradient(0, 0, w, h); gl.addColorStop(0, '#F6E3A3'); gl.addColorStop(0.5, '#D4AF37'); gl.addColorStop(1, '#A67C1E');
      ctx.strokeStyle = gl; ctx.lineWidth = Math.max(1.4, w * 0.008); archPath(ctx, 0, 0, w, h, w * 0.012); ctx.stroke();
      ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1, w * 0.004); archPath(ctx, 0, 0, w, h, w * 0.045); ctx.stroke(); ctx.globalAlpha = 1;
      // apex star
      var sx = w / 2, sy = w * 0.012, sr = Math.max(4, w * 0.03);
      ctx.save(); ctx.translate(sx, sy); ctx.fillStyle = '#F6E3A3'; ctx.beginPath();
      for (var i = 0; i < 16; i++) { var a = i * Math.PI / 8, rr = i % 2 ? sr * 0.42 : sr; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill(); ctx.restore();
      // tiles
      var d = tile * 1.6, wave = (t % 7) / 7, pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
      for (var k = 0; k < 604; k++) {
        var pt = lay.pts[k], x = pt[0] * w, y = pt[1] * h, s = d;
        if (k < shown) {
          var age = dur ? (ease * st.lit - k) / 18 : 9, flare = age < 1 ? 1.5 - 0.5 * age : 1;
          var band = reduce ? 0 : Math.max(0, 1 - Math.abs((1 - pt[1]) - wave * 1.3 + 0.15) * 7);
          ctx.globalAlpha = Math.min(1, 0.82 + band * 0.18); s = d * flare * (1 + band * 0.18);
          ctx.drawImage(sprLit, x - s / 2, y - s / 2, s, s);
        } else {
          ctx.globalAlpha = k === st.lit && st.lit < 604 && opt.next !== false ? 0.35 + 0.65 * pulse : 1;
          ctx.drawImage(k === st.lit && st.lit < 604 && opt.next !== false ? sprLit : sprOff, x - s / 2, y - s / 2, s, s);
        }
      }
      ctx.globalAlpha = 1;
      st.shown = shown;
      if (!reduce && opt.loop !== false) st.raf = requestAnimationFrame(frame);
      else if (p < 1) st.raf = requestAnimationFrame(frame);
    }
    size();
    var ro = window.ResizeObserver ? new ResizeObserver(function () { size(); if (reduce || opt.loop === false) frame(performance.now()); }) : null; if (ro) ro.observe(el);
    st.raf = requestAnimationFrame(frame);
    var api = {
      set: function (n, again) { st.lit = Math.max(0, Math.min(604, n)); if (again) st.t0 = performance.now(); cancelAnimationFrame(st.raf); st.raf = requestAnimationFrame(frame); },
      stop: function () { st.dead = true; cancelAnimationFrame(st.raf); if (ro) ro.disconnect(); }
    };
    document.addEventListener('visibilitychange', function () { if (document.hidden) cancelAnimationFrame(st.raf); else if (!st.dead) st.raf = requestAnimationFrame(frame); });
    return api;
  };

  /* ------------------------------------------------------------ gold dust */
  fx.dust = function (el, opt) {
    if (!el || reduce) return null;
    opt = opt || {};
    var cv = document.createElement('canvas'); cv.className = 'fx-dust'; cv.setAttribute('aria-hidden', 'true'); el.insertBefore(cv, el.firstChild);
    var ctx = cv.getContext('2d'), P = [], w = 0, h = 0, mx = -999, my = -999, raf = 0, on = true;
    function size() {
      var r = el.getBoundingClientRect(); w = r.width; h = r.height; cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR);
      var n = Math.round(Math.min(opt.max || 90, w * h / (opt.density || 9000)));
      while (P.length < n) P.push(seed(true)); P.length = n;
    }
    function seed(any) { return { x: Math.random() * w, y: any ? Math.random() * h : h + 10, r: 0.6 + Math.random() * 2.2, vy: -(0.12 + Math.random() * 0.42), ph: Math.random() * 6.28, sw: 0.2 + Math.random() * 0.6 }; }
    el.addEventListener('pointermove', function (e) { var r = el.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
    el.addEventListener('pointerleave', function () { mx = my = -999; });
    function frame(now) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, w, h);
      var t = now / 1000;
      for (var i = 0; i < P.length; i++) {
        var p = P[i]; p.y += p.vy; p.x += Math.sin(t * p.sw + p.ph) * 0.25;
        var dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy; if (d2 < 9000) { var f = (9000 - d2) / 9000 * 1.6; p.x += dx / Math.sqrt(d2 + 1) * f; p.y += dy / Math.sqrt(d2 + 1) * f; }
        if (p.y < -12 || p.x < -12 || p.x > w + 12) P[i] = seed(false);
        var tw = 0.45 + 0.55 * Math.abs(Math.sin(t * 1.3 + p.ph)), s = p.r * 7;
        ctx.globalAlpha = tw * (opt.alpha || 0.9); ctx.drawImage(DUST, p.x - s / 2, p.y - s / 2, s, s);
      }
      if (on) raf = requestAnimationFrame(frame);
    }
    size(); if (window.ResizeObserver) new ResizeObserver(size).observe(el);
    if (window.IntersectionObserver) new IntersectionObserver(function (es) { var v = es[0].isIntersecting; if (v && !on) { on = true; raf = requestAnimationFrame(frame); } else if (!v) { on = false; cancelAnimationFrame(raf); } }).observe(el);
    raf = requestAnimationFrame(frame);
    return cv;
  };

  /* ------------------------------------------------------------ pointer parallax */
  fx.parallax = function (scene) {
    if (!scene || reduce) return;
    var tx = 0, ty = 0, cx = 0, cy = 0, run = false;
    function tick() { cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08; scene.style.setProperty('--px', cx.toFixed(4)); scene.style.setProperty('--py', cy.toFixed(4)); if (Math.abs(tx - cx) + Math.abs(ty - cy) > 0.0005) requestAnimationFrame(tick); else run = false; }
    function kick() { if (!run) { run = true; requestAnimationFrame(tick); } }
    window.addEventListener('pointermove', function (e) { tx = e.clientX / window.innerWidth - 0.5; ty = e.clientY / window.innerHeight - 0.5; kick(); }, { passive: true });
    if (!finePointer) { var t0 = performance.now(); (function sway(now) { var t = (now - t0) / 1000; tx = Math.sin(t * 0.35) * 0.18; ty = Math.cos(t * 0.27) * 0.12; kick(); requestAnimationFrame(sway); })(t0); }
  };

  /* ------------------------------------------------------------ tilt + glare */
  var TILT = '.archcard,.fx-gate,.pgmtile,.bitem,.bp,.stat4,.accbal-c';
  if (finePointer && !reduce) {
    var cur = null;
    document.addEventListener('pointermove', function (e) {
      var el = e.target.closest && e.target.closest(TILT);
      if (cur && cur !== el) { cur.style.removeProperty('--tx'); cur.style.removeProperty('--ty'); cur.classList.remove('fx-tilting'); cur = null; }
      if (!el) return;
      var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height, k = el.classList.contains('stat4') || el.classList.contains('accbal-c') ? 4 : 9;
      el.classList.add('fx-tilting'); cur = el;
      el.style.setProperty('--tx', ((x - 0.5) * k).toFixed(2) + 'deg'); el.style.setProperty('--ty', ((0.5 - y) * k).toFixed(2) + 'deg');
      el.style.setProperty('--gx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
    }, { passive: true });
  }

  /* ------------------------------------------------------------ numbers that count up */
  var NUMSEL = '.stat4 b.num,.count b.num,.summary .big,.alltime .at-main>b,.kcount,.at-years b,.ptotals b.num';
  var seen = new WeakMap(), lastByKey = {};
  function keyOf(el) { var p = el.parentElement, lab = p ? (p.querySelector('span,small,p') || {}).textContent || '' : ''; return (el.className || '') + '|' + lab.trim().slice(0, 40); }
  function countUp(el) {
    var tn = null, it = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (it.nextNode()) { if (/\d/.test(it.currentNode.nodeValue)) { tn = it.currentNode; break; } }
    if (!tn) return;
    var full = tn.nodeValue, m = /-?\d[\d,]*(\.\d+)?/.exec(full); if (!m) return;
    var key = keyOf(el), target = parseFloat(m[0].replace(/,/g, '')), prev = lastByKey[key];
    lastByKey[key] = full; seen.set(el, 1);
    if (prev === full || reduce || !isFinite(target) || Math.abs(target) < 2) return;
    var from = prev ? parseFloat(((/-?\d[\d,]*(\.\d+)?/.exec(prev) || ['0'])[0]).replace(/,/g, '')) || 0 : 0, dec = (m[1] || '').length - 1;
    if (from === target) return;
    var pre = full.slice(0, m.index), post = full.slice(m.index + m[0].length), t0 = performance.now(), D = 900;
    var fmt = function (v) { return pre + (dec > 0 ? v.toFixed(dec) : Math.round(v)).toLocaleString('en-US', dec > 0 ? { minimumFractionDigits: dec } : undefined) + post; };
    (function step(now) {
      var p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(2, -10 * p);
      tn.nodeValue = p >= 1 ? full : fmt(from + (target - from) * e);
      if (p < 1 && tn.isConnected) requestAnimationFrame(step);
    })(t0);
  }
  fx.watch = function (root) {
    if (!root || !window.MutationObserver) return;
    var queued = false, lastView = '';
    var run = function () {
      queued = false;
      MZ.$$ ? MZ.$$(NUMSEL, root).forEach(function (el) { if (!seen.has(el)) countUp(el); }) : null;
      // a short reveal when the page changes (tab or screen), never on ordinary redraws
      var tab = document.querySelector('.tab[aria-selected="true"]'), view = (tab ? tab.dataset.tab : '') + '|' + (document.querySelector('.subtab[aria-current="page"]') || {}).textContent + '|' + (root.firstElementChild ? root.firstElementChild.className : '');
      if (view !== lastView) {
        lastView = view;
        if (!reduce) { root.classList.remove('fx-enter'); void root.offsetWidth; root.classList.add('fx-enter'); clearTimeout(root._fxT); root._fxT = setTimeout(function () { root.classList.remove('fx-enter'); }, 1400); }
        MZ.$$ ? MZ.$$('.pagehead h1', root).forEach(function (h) { h.classList.add('fx-sweep'); }) : null;
      }
    };
    new MutationObserver(function () { if (!queued) { queued = true; requestAnimationFrame(run); } }).observe(root, { childList: true, subtree: true });
    requestAnimationFrame(run);
  };


  /* ------------------------------------------------------------ the opening mushaf (home page intro) */
  // An illuminated Qur'an in 3D: it rises, turns to you, the cover opens from the right (spine on the right),
  // light pours out, a few leaves turn, and the view flies into the page to reveal the 604 arch.
  // Abstract illumination only: gold frames, a headpiece and ruled lines; no lettering is drawn.
  function pageFace(cls) {
    var lines = '';
    for (var i = 0; i < 9; i++) {
      var w = i === 8 ? 54 : 100;
      lines += '<i class="ln" style="width:' + w + '%"></i>' + (i % 3 === 1 ? '<i class="vm"></i>' : '');
    }
    return '<div class="mu-page ' + (cls || '') + '"><div class="mu-frame"><div class="mu-head"><span></span></div><div class="mu-lines">' + lines + '</div><div class="mu-rose"></div></div></div>';
  }
  var TOOL = '<svg viewBox="0 0 280 380" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="#E9C75A" stroke-width="1.6">'
    + '<rect x="14" y="14" width="252" height="352" rx="4"/><rect x="22" y="22" width="236" height="336" rx="3" stroke-width=".8"/>'
    + '<path d="M22 70Q60 70 70 22M258 70Q220 70 210 22M22 310Q60 310 70 358M258 310Q220 310 210 358" stroke-width="1.2"/>'
    + '<circle cx="140" cy="190" r="58"/><circle cx="140" cy="190" r="44" stroke-width=".9"/>'
    + '<path d="M140 120L156 172L208 156L172 190L208 224L156 208L140 260L124 208L72 224L108 190L72 156L124 172Z" fill="rgba(233,199,90,.18)"/>'
    + '<path d="M140 146L148 182L184 190L148 198L140 234L132 198L96 190L132 182Z" fill="#E9C75A" stroke="none" opacity=".9"/>'
    + '<path d="M140 92v-30M140 288v30" stroke-width="1"/><circle cx="140" cy="56" r="6"/><circle cx="140" cy="324" r="6"/></g></svg>';
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  fx.intro = function (onDone) {
    var done = false, ov = null, three = null;
    function finish() {
      if (done) return; done = true;
      try { sessionStorage.setItem('qt_intro_seen', '1'); } catch (e) {}
      if (three) three.stop();
      document.body.classList.remove('intro-on');
      if (ov) { ov.classList.add('out'); setTimeout(function () { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }, 1000); }
      document.removeEventListener('keydown', onKey);
      if (onDone) onDone();
    }
    function onKey(e) { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish(); }
    var seen = false; try { seen = !!sessionStorage.getItem('qt_intro_seen'); } catch (e) {}
    if (reduce || seen || /[?&]nointro/.test(location.search)) { finish(); return; }
    document.body.classList.add('intro-on');
    ov = document.createElement('div'); ov.className = 'mu-intro'; ov.setAttribute('role', 'presentation');
    ov.innerHTML = '<div class="mu3d-host" aria-hidden="true"></div><p class="mu-wait" aria-hidden="true"><span></span></p><button type="button" class="mu-skip">Skip</button>';
    document.body.appendChild(ov);
    ov.querySelector('.mu-skip').addEventListener('click', finish);
    document.addEventListener('keydown', onKey);
    var cssBook = function () {
      if (done) return;
      ov.classList.add('css');
      var leaves = ''; for (var k = 0; k < 4; k++) leaves += '<div class="mu-leaf l' + k + '">' + pageFace('front') + pageFace('back') + '</div>';
      ov.insertAdjacentHTML('afterbegin', '<div class="mu-rays" aria-hidden="true"></div><div class="mu-glow" aria-hidden="true"></div>'
        + '<div class="mu-scene" aria-hidden="true"><div class="mu-book">'
        + '<div class="mu-back"></div><div class="mu-spine"></div><div class="mu-edge l"></div><div class="mu-edge b"></div><div class="mu-edge t"></div>'
        + pageFace('first') + leaves
        + '<div class="mu-cover"><div class="mu-cv front">' + TOOL + '<span class="mu-sheen"></span></div><div class="mu-cv inner"></div></div></div></div>');
      requestAnimationFrame(function () { requestAnimationFrame(function () { ov.classList.add('play'); }); });
      setTimeout(finish, 5600);
    };
    // the real 3D mushaf (Three.js) when the device can draw it; the CSS book otherwise
    var base = (document.currentScript && document.currentScript.src) ? '' : '';
    var timer = window.__muDebug ? 0 : setTimeout(cssBook, 6000);
    (window.THREE ? Promise.resolve() : loadScript(base + 'vendor/three/three.min.js').then(function () { return loadScript(base + 'vendor/three/three-post.js'); }))
      .then(function () { return MZ.mushaf3d ? null : loadScript(base + 'js/mushaf3d.js'); })
      .then(function () {
        if (done || ov.classList.contains('css')) return;
        clearTimeout(timer);
        three = MZ.mushaf3d(ov.querySelector('.mu3d-host'), function (natural) { if (natural) finish(); });
        if (!three) cssBook(); else { ov.classList.add('webgl'); if (!window.__muDebug) setTimeout(finish, 20000); }
      })
      .catch(function () { clearTimeout(timer); cssBook(); });
  };
  /* ------------------------------------------------------------ page wiring */
  function boot() {
    MZ.$$ = MZ.$$ || function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
    // landing + sign-in: the arch, the dust, the parallax
    var arches = function () { document.querySelectorAll('[data-fx-arch]').forEach(function (el) { if (!el._arch) el._arch = fx.arch(el, { lit: +el.dataset.fxArch || 604, duration: +el.dataset.fxDur || 3.2, next: false }); }); };
    if (document.body.hasAttribute('data-fx-intro')) fx.intro(arches); else arches();
    document.querySelectorAll('[data-fx-dust]').forEach(function (el) { fx.dust(el, { max: +el.dataset.fxDust || 90 }); });
    document.querySelectorAll('[data-fx-scene]').forEach(function (el) { fx.parallax(el); });
    // portal doors swing open before going through
    document.querySelectorAll('.fx-gate').forEach(function (g) {
      g.addEventListener('click', function (e) {
        if (reduce || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault(); g.classList.add('open'); document.body.classList.add('fx-leaving');
        setTimeout(function () { location.href = g.href; }, 650);
      });
    });
    window.addEventListener('pageshow', function () { document.body.classList.remove('fx-leaving'); document.querySelectorAll('.fx-gate.open').forEach(function (g) { g.classList.remove('open'); }); });
    var page = document.getElementById('page'); if (page) fx.watch(page);
    var scr = document.getElementById('screen'); if (scr) fx.watch(scr);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
