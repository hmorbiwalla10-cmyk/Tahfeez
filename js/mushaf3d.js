/* The opening mushaf — a real-time 3D scene for the home page (Three.js r147, vendor/three).
   A lapis-leather Qur'an with a gold-tooled cover rests on a carved rehal in the dark.
   Light finds it, the cover opens from the right, two illuminated leaves turn with a real curl,
   and the first spread settles: al-Fatiha on the right page, the opening of al-Baqarah on the left,
   set in Amiri. The verses then light up line by line, as if being memorised, and the camera flies
   into the light. MZ.mushaf3d(host, done) returns false when WebGL is not available. */
(function () {
  'use strict';
  var MZ = window.MZ = window.MZ || {};

  /* ------------------------------------------------------------------ text */
  // Verse markers are drawn as gold roundels with Arabic-Indic numerals.
  var FATIHA = [
    [['بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', 1]],
    [['ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ', 2]],
    [['ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', 3], ['مَٰلِكِ يَوْمِ ٱلدِّينِ', 4]],
    [['إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ', 5]],
    [['ٱهْدِنَا ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ', 6]],
    [['صِرَٰطَ ٱلَّذِينَ أَنْعَمْتَ عَلَيْهِمْ', 0]],
    [['غَيْرِ ٱلْمَغْضُوبِ عَلَيْهِمْ وَلَا ٱلضَّآلِّينَ', 7]]
  ];
  var BAQARAH = [
    [['بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', 0]],
    [['الٓمٓ', 1], ['ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ', 2]],
    [['ٱلَّذِينَ يُؤْمِنُونَ بِٱلْغَيْبِ وَيُقِيمُونَ ٱلصَّلَوٰةَ', 0]],
    [['وَمِمَّا رَزَقْنَٰهُمْ يُنفِقُونَ', 3], ['وَٱلَّذِينَ يُؤْمِنُونَ', 0]],
    [['بِمَآ أُنزِلَ إِلَيْكَ وَمَآ أُنزِلَ مِن قَبْلِكَ', 0]],
    [['وَبِٱلْءَاخِرَةِ هُمْ يُوقِنُونَ', 4], ['أُو۟لَٰٓئِكَ عَلَىٰ', 0]],
    [['هُدًى مِّن رَّبِّهِمْ ۖ وَأُو۟لَٰٓئِكَ هُمُ ٱلْمُفْلِحُونَ', 5]]
  ];
  var AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  function arNum(n) { return String(n).split('').map(function (d) { return AR_DIGITS[+d]; }).join(''); }

  /* ------------------------------------------------------------------ canvas helpers */
  function cnv(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function noise(g, w, h, n, a, col) { g.save(); g.fillStyle = col; for (var i = 0; i < n; i++) { g.globalAlpha = Math.random() * a; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5); } g.restore(); }
  function goldGrad(g, x0, y0, x1, y1) { var gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, '#8A6514'); gr.addColorStop(0.25, '#F6E3A3'); gr.addColorStop(0.5, '#C9A23A'); gr.addColorStop(0.75, '#FFF1C2'); gr.addColorStop(1, '#9A7218'); return gr; }
  function star(g, cx, cy, r1, r2, n, rot) { g.beginPath(); for (var i = 0; i < n * 2; i++) { var a = (rot || 0) + i * Math.PI / n, r = i % 2 ? r2 : r1; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); }
  function lobed(g, cx, cy, r, lobes, depth) { g.beginPath(); for (var i = 0; i <= 360; i += 2) { var a = i * Math.PI / 180, rr = r * (1 + depth * Math.cos(lobes * a)); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); }

  // Tooled lapis leather for the front cover: colour, metal (where the gold is) and bump.
  function coverMaps(W, H) {
    var col = cnv(W, H), met = cnv(W, H), g = col.getContext('2d'), m = met.getContext('2d');
    var bg = g.createRadialGradient(W * 0.35, H * 0.3, 0, W * 0.5, H * 0.5, H * 0.75); bg.addColorStop(0, '#2B3E8C'); bg.addColorStop(0.55, '#1A2758'); bg.addColorStop(1, '#0C1433');
    g.fillStyle = bg; g.fillRect(0, 0, W, H); noise(g, W, H, 60000, 0.10, '#000'); noise(g, W, H, 25000, 0.06, '#8FA3E8');
    m.fillStyle = '#000'; m.fillRect(0, 0, W, H);
    function both(draw) { g.save(); m.save(); g.fillStyle = g.strokeStyle = goldGrad(g, 0, 0, W, H); m.fillStyle = m.strokeStyle = '#fff'; draw(g); draw(m); g.restore(); m.restore(); }
    both(function (c) {
      c.lineWidth = 7; c.strokeRect(40, 40, W - 80, H - 80); c.lineWidth = 2.5; c.strokeRect(62, 62, W - 124, H - 124); c.strokeRect(150, 150, W - 300, H - 300);
      for (var y = 92; y < H - 80; y += 46) { star(c, 106, y, 15, 6.5, 8, 0); c.fill(); star(c, W - 106, y, 15, 6.5, 8, 0); c.fill(); }
      for (var x = 152; x < W - 120; x += 46) { star(c, x, 106, 15, 6.5, 8, 0); c.fill(); star(c, x, H - 106, 15, 6.5, 8, 0); c.fill(); }
      [[150, 150, 0], [W - 150, 150, 1], [150, H - 150, 3], [W - 150, H - 150, 2]].forEach(function (k) {
        c.save(); c.translate(k[0], k[1]); c.rotate(k[2] * Math.PI / 2); c.lineWidth = 3;
        c.beginPath(); c.arc(0, 0, 120, 0, Math.PI / 2); c.stroke(); c.beginPath(); c.arc(0, 0, 92, 0, Math.PI / 2); c.stroke();
        for (var i = 0; i < 5; i++) { var a = (i + 0.5) * Math.PI / 10; c.beginPath(); c.ellipse(Math.cos(a) * 60, Math.sin(a) * 60, 18, 7, a, 0, Math.PI * 2); c.fill(); }
        c.restore();
      });
      var cx = W / 2, cy = H / 2;
      c.lineWidth = 4; lobed(c, cx, cy, 230, 16, 0.06); c.stroke(); c.lineWidth = 2; lobed(c, cx, cy, 205, 16, 0.06); c.stroke();
      c.lineWidth = 3; star(c, cx, cy, 185, 120, 8, Math.PI / 8); c.stroke(); star(c, cx, cy, 185, 120, 8, 0); c.stroke();
      star(c, cx, cy, 110, 52, 8, Math.PI / 8); c.fill();
      c.beginPath(); c.arc(cx, cy, 38, 0, Math.PI * 2); c.lineWidth = 5; c.stroke();
      [[cx, cy - 330], [cx, cy + 330]].forEach(function (p) { c.lineWidth = 3; lobed(c, p[0], p[1], 52, 8, 0.12); c.stroke(); star(c, p[0], p[1], 30, 13, 8, 0); c.fill(); c.beginPath(); c.moveTo(p[0], p[1] + (p[1] < cy ? 55 : -55)); c.lineTo(p[0], cy + (p[1] < cy ? -240 : 240)); c.lineWidth = 2; c.stroke(); });
    });
    var bump = cnv(W / 2, H / 2), b = bump.getContext('2d'); b.fillStyle = '#7f7f7f'; b.fillRect(0, 0, W / 2, H / 2); b.filter = 'blur(1.2px)'; b.globalAlpha = 0.85; b.drawImage(met, 0, 0, W / 2, H / 2);
    return { col: col, met: met, bump: bump };
  }
  function doublureMap(W, H) {
    var c = cnv(W, H), g = c.getContext('2d');
    var bg = g.createRadialGradient(W * 0.6, H * 0.35, 0, W / 2, H / 2, H * 0.8); bg.addColorStop(0, '#8A2424'); bg.addColorStop(0.6, '#5A1414'); bg.addColorStop(1, '#2E0909');
    g.fillStyle = bg; g.fillRect(0, 0, W, H); noise(g, W, H, 50000, 0.08, '#000');
    g.strokeStyle = goldGrad(g, 0, 0, W, H); g.lineWidth = 6; g.strokeRect(30, 30, W - 60, H - 60); g.lineWidth = 2; g.strokeRect(48, 48, W - 96, H - 96);
    g.globalAlpha = 0.35; g.lineWidth = 1.6;
    for (var y = 110; y < H - 80; y += 78) for (var x = 110; x < W - 80; x += 78) { star(g, x, y, 22, 9, 8, Math.PI / 8); g.stroke(); }
    g.globalAlpha = 1; return c;
  }
  function edgeMap() {
    var c = cnv(64, 512), g = c.getContext('2d'); g.fillStyle = '#C9A23A'; g.fillRect(0, 0, 64, 512);
    for (var x = 0; x < 64; x += 2) { g.fillStyle = x % 4 ? 'rgba(255,241,194,.55)' : 'rgba(120,85,20,.35)'; g.fillRect(x, 0, 1, 512); }
    return c;
  }
  function leatherMap() { var c = cnv(256, 256), g = c.getContext('2d'); g.fillStyle = '#16224F'; g.fillRect(0, 0, 256, 256); noise(g, 256, 256, 9000, 0.12, '#000'); return c; }
  function woodMap() {
    var c = cnv(512, 512), g = c.getContext('2d'); g.fillStyle = '#5A3418'; g.fillRect(0, 0, 512, 512);
    for (var i = 0; i < 140; i++) { var y = Math.random() * 512; g.strokeStyle = 'rgba(' + (Math.random() < 0.5 ? '35,18,6' : '140,90,45') + ',' + (0.12 + Math.random() * 0.2) + ')'; g.lineWidth = 0.6 + Math.random() * 2.4; g.beginPath(); g.moveTo(0, y); for (var x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 4); g.stroke(); }
    return c;
  }

  /* An illuminated page: paper, gold and lapis frame, a surah heading and the verses. */
  function paperBase(g, W, H) {
    var bg = g.createRadialGradient(W * 0.45, H * 0.4, 0, W / 2, H / 2, H * 0.75); bg.addColorStop(0, '#FBF4E0'); bg.addColorStop(0.7, '#F1E4C2'); bg.addColorStop(1, '#E2CF9F');
    g.fillStyle = bg; g.fillRect(0, 0, W, H); noise(g, W, H, 30000, 0.05, '#7A5A20');
  }
  function frameBand(g, x, y, w, h) {
    g.save();
    g.fillStyle = '#1B2A63'; g.fillRect(x, y, w, h);
    g.strokeStyle = goldGrad(g, x, y, x + w, y + h); g.lineWidth = 4; g.strokeRect(x, y, w, h);
    var t = 26; g.lineWidth = 3; g.strokeRect(x + t, y + t, w - 2 * t, h - 2 * t);
    g.fillStyle = goldGrad(g, x, y, x + w, y + h);
    for (var px = x + 26; px < x + w - 13; px += 26) { star(g, px, y + 13, 8, 3.6, 4, Math.PI / 4); g.fill(); star(g, px, y + h - 13, 8, 3.6, 4, Math.PI / 4); g.fill(); }
    for (var py = y + 26; py < y + h - 13; py += 26) { star(g, x + 13, py, 8, 3.6, 4, Math.PI / 4); g.fill(); star(g, x + w - 13, py, 8, 3.6, 4, Math.PI / 4); g.fill(); }
    g.restore();
  }
  function roundel(g, x, y, r, n, glow) {
    g.save();
    if (!glow) { g.fillStyle = goldGrad(g, x - r, y - r, x + r, y + r); lobed(g, x, y, r, 8, 0.1); g.fill(); g.fillStyle = '#FBF4E0'; g.beginPath(); g.arc(x, y, r * 0.66, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#1B2A63'; g.lineWidth = 1.6; g.stroke(); }
    else { g.fillStyle = '#fff'; lobed(g, x, y, r, 8, 0.1); g.fill(); }
    g.fillStyle = glow ? '#000' : '#1B2A63'; g.font = '700 ' + Math.round(r * 0.95) + 'px Amiri, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl'; g.fillText(arNum(n), x, y + r * 0.08);
    g.restore();
  }
  // lays the verses out right to left; returns nothing, draws onto g (and the same glyphs onto the glow mask)
  function pageMaps(kind, W, H) {
    var col = cnv(W, H), glow = cnv(W, H), g = col.getContext('2d'), q = glow.getContext('2d');
    paperBase(g, W, H); q.fillStyle = '#000'; q.fillRect(0, 0, W, H);
    var m = 70, fx = m, fy = m, fw = W - 2 * m, fh = H - 2 * m;
    frameBand(g, fx, fy, fw, fh);
    var ix = fx + 52, iy = fy + 52, iw = fw - 104, ih = fh - 104;
    g.fillStyle = '#FBF4E3'; g.fillRect(ix, iy, iw, ih); noise(g, W, H, 0, 0, '#000');
    g.strokeStyle = '#C9A23A'; g.lineWidth = 2; g.strokeRect(ix + 6, iy + 6, iw - 12, ih - 12);
    // surah heading cartouche
    var hy = iy + 34, hh = 120, hx = ix + 30, hw = iw - 60;
    g.fillStyle = '#1B2A63'; g.fillRect(hx, hy, hw, hh); g.strokeStyle = goldGrad(g, hx, hy, hx + hw, hy + hh); g.lineWidth = 4; g.strokeRect(hx, hy, hw, hh);
    g.fillStyle = goldGrad(g, hx, hy, hx + hw, hy + hh); g.beginPath(); g.ellipse(hx + hw / 2, hy + hh / 2, hw * 0.33, hh * 0.36, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1B2A63'; g.beginPath(); g.ellipse(hx + hw / 2, hy + hh / 2, hw * 0.31, hh * 0.3, 0, 0, Math.PI * 2); g.fill();
    for (var s = 0; s < 2; s++) { var sx = s ? hx + 70 : hx + hw - 70; g.fillStyle = goldGrad(g, sx - 40, hy, sx + 40, hy + hh); star(g, sx, hy + hh / 2, 40, 17, 8, 0); g.fill(); }
    g.fillStyle = '#F6E3A3'; g.font = '700 58px Amiri, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl';
    g.fillText(kind === 'fatiha' ? 'سُورَةُ ٱلْفَاتِحَةِ' : 'سُورَةُ ٱلْبَقَرَةِ', hx + hw / 2, hy + hh / 2 + 4);
    // margin palmette on the outer edge
    var outer = kind === 'fatiha' ? W - m / 2 - 6 : m / 2 + 6;
    g.fillStyle = goldGrad(g, outer - 30, H / 2 - 60, outer + 30, H / 2 + 60); lobed(g, outer, hy + hh / 2, 30, 6, 0.18); g.fill(); g.fillStyle = '#1B2A63'; star(g, outer, hy + hh / 2, 16, 7, 8, 0); g.fill();
    // the verses
    var lines = kind === 'fatiha' ? FATIHA : BAQARAH, top = hy + hh + 70, bottom = iy + ih - 60, step = (bottom - top) / lines.length, fs = kind === 'fatiha' ? 64 : 56, rr = fs * 0.42;
    g.font = q.font = '400 ' + fs + 'px Amiri, serif'; g.direction = q.direction = 'rtl'; g.textBaseline = q.textBaseline = 'alphabetic'; g.textAlign = q.textAlign = 'right';
    var gap = fs * 0.3, boxes = [];
    lines.forEach(function (line, li) {
      var parts = [], total = 0;
      line.forEach(function (seg, k) { var w = g.measureText(seg[0]).width; parts.push([seg[0], w, seg[1]]); total += w + (seg[1] ? gap + rr * 2 + gap : (k < line.length - 1 ? gap * 2 : 0)); });
      var justify = kind === 'baqarah' && li > 0 && li < lines.length - 1 ? Math.max(0, (iw - 120) - total) / Math.max(1, parts.length) : 0;
      var x = ix + iw / 2 + Math.min(total + justify * parts.length, iw - 120) / 2, y = top + step * (li + 0.62);
      parts.forEach(function (p, k) {
        g.fillStyle = '#1A1208'; g.fillText(p[0], x, y); q.fillStyle = '#fff'; q.fillText(p[0], x, y);
        x -= p[1] + justify;
        if (p[2]) { x -= gap; roundel(g, x - rr, y - fs * 0.28, rr, p[2]); roundel(q, x - rr, y - fs * 0.28, rr, p[2], true); x -= rr * 2 + gap; }
        else if (k < parts.length - 1) x -= gap * 2;
      });
      boxes.push(y);
    });
    return { col: col, glow: glow };
  }
  // the illuminated frontispiece leaves (geometric, no lettering)
  function frontisMap(W, H, variant) {
    var c = cnv(W, H), g = c.getContext('2d'); paperBase(g, W, H);
    var m = 70; frameBand(g, m, m, W - 2 * m, H - 2 * m);
    var ix = m + 52, iy = m + 52, iw = W - 2 * m - 104, ih = H - 2 * m - 104;
    var bg = g.createRadialGradient(ix + iw / 2, iy + ih / 2, 0, ix + iw / 2, iy + ih / 2, ih * 0.7); bg.addColorStop(0, variant ? '#22357A' : '#1B2A63'); bg.addColorStop(1, '#0E1736');
    g.fillStyle = bg; g.fillRect(ix, iy, iw, ih);
    g.save(); g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
    g.strokeStyle = 'rgba(233,199,90,.55)'; g.lineWidth = 2;
    for (var y = iy; y < iy + ih + 90; y += 90) for (var x = ix + (Math.round((y - iy) / 90) % 2 ? 45 : 0); x < ix + iw + 90; x += 90) { star(g, x, y, 40, 18, 8, Math.PI / 8); g.stroke(); }
    g.restore();
    var cx = ix + iw / 2, cy = iy + ih / 2;
    g.fillStyle = goldGrad(g, cx - 260, cy - 260, cx + 260, cy + 260); lobed(g, cx, cy, 250, 12, 0.07); g.fill();
    g.fillStyle = '#FBF4E3'; lobed(g, cx, cy, 225, 12, 0.07); g.fill();
    g.fillStyle = goldGrad(g, cx - 200, cy - 200, cx + 200, cy + 200); star(g, cx, cy, 205, 140, 12, 0); g.fill();
    g.fillStyle = '#1B2A63'; star(g, cx, cy, 160, 110, 12, Math.PI / 12); g.fill();
    g.fillStyle = goldGrad(g, cx - 110, cy - 110, cx + 110, cy + 110); star(g, cx, cy, 110, 50, 8, variant ? Math.PI / 8 : 0); g.fill();
    g.fillStyle = '#FBF4E3'; g.beginPath(); g.arc(cx, cy, 36, 0, Math.PI * 2); g.fill();
    return c;
  }
  function dotSprite() { var c = cnv(64, 64), g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,248,220,1)'); r.addColorStop(0.25, 'rgba(246,222,150,.85)'); r.addColorStop(1, 'rgba(212,175,55,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return c; }
  function rayMap() { var c = cnv(64, 256), g = c.getContext('2d'), r = g.createLinearGradient(0, 256, 0, 0); r.addColorStop(0, 'rgba(255,240,190,.9)'); r.addColorStop(1, 'rgba(255,240,190,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 256); var h = g.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = h; g.fillRect(0, 0, 64, 256); return c; }
  function skyMap() { var c = cnv(512, 512), g = c.getContext('2d'), r = g.createRadialGradient(256, 210, 0, 256, 256, 380); r.addColorStop(0, '#1F2D66'); r.addColorStop(0.5, '#0E1736'); r.addColorStop(1, '#03060F'); g.fillStyle = r; g.fillRect(0, 0, 512, 512); return c; }

  /* ------------------------------------------------------------------ helpers */
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function seg(t, a, b) { return ease((t - a) / (b - a)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  MZ.mushaf3d = function (host, done) {
    var T = window.THREE; if (!T || !T.WebGLRenderer) return false;
    var test = document.createElement('canvas'), gl = null; try { gl = test.getContext('webgl2') || test.getContext('webgl'); } catch (e) {} if (!gl) return false;

    var renderer; try { renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); } catch (e) { return false; }
    var DPR = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(DPR); renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.domElement.className = 'mu3d'; host.appendChild(renderer.domElement);

    var scene = new T.Scene(), sky = new T.CanvasTexture(skyMap()); sky.encoding = T.sRGBEncoding; scene.background = sky;
    scene.fog = new T.FogExp2(0x070C20, 0.075);
    var camera = new T.PerspectiveCamera(36, host.clientWidth / host.clientHeight, 0.05, 100);

    // a soft environment so the gold has something warm to reflect
    var pm = new T.PMREMGenerator(renderer), envScene = new T.Scene();
    envScene.add(new T.Mesh(new T.SphereGeometry(10, 32, 16), new T.MeshBasicMaterial({ color: 0x0A1129, side: T.BackSide })));
    [[0, 6, 2, 0xFFE2A8, 6, 3], [-6, 2, -3, 0x6A80E0, 4, 2], [5, 1, -4, 0xF4C25A, 3, 2]].forEach(function (b) { var p = new T.Mesh(new T.PlaneGeometry(b[4], b[5]), new T.MeshBasicMaterial({ color: b[3], side: T.DoubleSide })); p.position.set(b[0], b[1], b[2]); p.lookAt(0, 0, 0); envScene.add(p); });
    scene.environment = pm.fromScene(envScene, 0.04).texture;

    var maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 4;
    function tex(c, srgb) { var t = new T.CanvasTexture(c); if (srgb !== false) t.encoding = T.sRGBEncoding; t.anisotropy = maxAniso; return t; }

    /* dimensions (world units) */
    var W = 1.36, H = 1.92, BT = 0.24, CT = 0.035, top = BT, open = new T.Group(); scene.add(open);
    open.rotation.x = -0.05;

    /* the rehal (carved wooden stand) */
    var wood = new T.MeshStandardMaterial({ map: tex(woodMap()), roughness: 0.55, metalness: 0.05, color: 0xC9935A });
    var shape = new T.Shape(); shape.moveTo(-0.9, 0); shape.lineTo(0.9, 0); shape.lineTo(0.9, 0.18);
    for (var i = 0; i <= 12; i++) { var a = i / 12; shape.lineTo(lerp(0.9, -0.9, a), 0.18 + 0.08 * Math.abs(Math.sin(a * Math.PI * 4)) + 0.22 * Math.sin(a * Math.PI)); }
    shape.lineTo(-0.9, 0);
    var carv = new T.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
    [[-1, 1], [-1, -1], [1, 1], [1, -1]].forEach(function (k) {
      var board = new T.Mesh(new T.BoxGeometry(W + 0.2, 0.05, H + 0.25), wood); board.position.set(k[0] * (W / 2 + 0.06), -0.06, 0); board.rotation.z = k[0] * 0.04; board.castShadow = board.receiveShadow = true; if (k[1] > 0) open.add(board);
      var end = new T.Mesh(carv, wood); end.scale.set(0.82, 1, 1); end.position.set(k[0] * (W / 2 + 0.06), -0.08, k[1] * (H / 2 + 0.08) - (k[1] > 0 ? 0 : 0.05)); end.rotation.x = 0; end.rotation.y = 0; end.castShadow = true; open.add(end);
    });
    var legM = new T.Mesh(new T.BoxGeometry(0.08, 1.5, 0.06), wood); legM.position.set(-0.55, -0.72, 0.6); legM.rotation.z = 0.7; legM.castShadow = true; open.add(legM);
    var legN = legM.clone(); legN.position.x = 0.55; legN.rotation.z = -0.7; open.add(legN);
    var legO = legM.clone(); legO.position.z = -0.6; open.add(legO); var legP = legN.clone(); legP.position.z = -0.6; open.add(legP);

    /* the book */
    var cm = coverMaps(1024, 1446), colT = tex(cm.col), metT = tex(cm.met, false), bumpT = tex(cm.bump, false);
    var leather = new T.MeshStandardMaterial({ map: tex(leatherMap()), roughness: 0.62, metalness: 0.1, color: 0x9AA6D6 });
    var gild = new T.MeshStandardMaterial({ map: tex(edgeMap()), color: 0xF0D27A, roughness: 0.28, metalness: 0.85 });
    var coverFront = new T.MeshStandardMaterial({ map: colT, metalnessMap: metT, metalness: 1, roughnessMap: (function () { var c = cnv(512, 723), g = c.getContext('2d'); g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, 512, 723); g.globalCompositeOperation = 'difference'; g.drawImage(cm.met, 0, 0, 512, 723); return tex(c, false); })(), roughness: 1, bumpMap: bumpT, bumpScale: 0.012 });
    var coverInner = new T.MeshStandardMaterial({ map: tex(doublureMap(1024, 1446)), roughness: 0.7, metalness: 0.08 });
    var baq = pageMaps('baqarah', 1024, 1446), fat = pageMaps('fatiha', 1024, 1446);
    var PAPER = 0xE2D6BA, paperMat = function (c) { return new T.MeshStandardMaterial({ map: tex(c), color: PAPER, roughness: 0.92, metalness: 0 }); };

    // back board, page block (top face = the opening of al-Baqarah) and the rounded spine
    var back = new T.Mesh(new T.BoxGeometry(W + 0.05, CT, H + 0.06), leather); back.position.set(-W / 2, CT / 2 - 0.002, 0); back.castShadow = back.receiveShadow = true; open.add(back);
    var blockMats = [gild, gild, paperMat(baq.col), leather, gild, gild];
    var block = new T.Mesh(new T.BoxGeometry(W - 0.03, BT - CT, H - 0.03), blockMats); block.position.set(-W / 2 + 0.005, CT + (BT - CT) / 2, 0); block.castShadow = block.receiveShadow = true; open.add(block);
    var spine = new T.Mesh(new T.CylinderGeometry(BT / 2 + 0.02, BT / 2 + 0.02, H + 0.06, 24, 1, true, 0, Math.PI), leather); spine.rotation.x = Math.PI / 2; spine.rotation.y = Math.PI / 2; spine.position.set(0, BT / 2, 0); spine.scale.set(0.45, 1, 1); open.add(spine);

    // front cover hinged on the spine (right edge, the book opens to the right)
    var coverPivot = new T.Group(); coverPivot.position.set(0, top, 0); open.add(coverPivot);
    var coverMats = [leather, leather, coverFront, coverInner, leather, leather];
    var cover = new T.Mesh(new T.BoxGeometry(W + 0.05, CT, H + 0.06), coverMats); cover.position.set(-(W + 0.05) / 2, CT / 2, 0); cover.castShadow = true; coverPivot.add(cover);

    // leaves that turn with a curl; each has a front and a back side
    function makeLeaf(frontC, backC, y, yR) {
      var geo = new T.PlaneGeometry(W - 0.04, H - 0.04, 48, 1); geo.rotateX(-Math.PI / 2);
      var pos = geo.attributes.position, base = new Float32Array(pos.count * 2);
      for (var i = 0; i < pos.count; i++) { base[i * 2] = -(pos.getX(i) - (W - 0.04) / 2); base[i * 2 + 1] = pos.getZ(i); }
      var bt = tex(backC); bt.wrapS = T.RepeatWrapping; bt.repeat.x = -1; bt.offset.x = 1;
      var f = new T.Mesh(geo, new T.MeshStandardMaterial({ map: tex(frontC), color: PAPER, roughness: 0.9, side: T.FrontSide }));
      var b = new T.Mesh(geo, new T.MeshStandardMaterial({ map: bt, color: PAPER, roughness: 0.9, side: T.BackSide }));
      f.castShadow = b.castShadow = true; f.receiveShadow = true;
      var grp = new T.Group(); grp.add(f); grp.add(b); grp.position.y = y; open.add(grp);
      var leaf = { geo: geo, base: base, y: y, a: -1, set: function (a, curl) {
        if (Math.abs(a - leaf.a) < 1e-4) return; leaf.a = a;
        for (var i = 0; i < pos.count; i++) { var d = Math.max(0, base[i * 2]), ad = a + curl * Math.sin(a) * Math.pow(d / W, 1.35); pos.setXYZ(i, -d * Math.cos(ad), d * Math.sin(ad) + (yR - y) * Math.min(1, a / Math.PI), base[i * 2 + 1]); }
        pos.needsUpdate = true; geo.computeVertexNormals();
      } };
      leaf.set(0, 0); return leaf;
    }
    var fr1 = frontisMap(1024, 1446, 0), fr2 = frontisMap(1024, 1446, 1);
    var leaf1 = makeLeaf(fr1, fr2, top + 0.005, top + 0.002), leaf2 = makeLeaf(fr2, fat.col, top + 0.003, top + 0.005);

    // the verses light up: additive glow layers over both pages
    function glowLayer(mask, x) {
      var m = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending,
        uniforms: { map: { value: tex(mask, false) }, p: { value: 0 }, k: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform sampler2D map; uniform float p; uniform float k; varying vec2 vUv; void main(){ float m=texture2D(map,vUv).r; float key=(1.0-vUv.y)*1.0+(vUv.x)*0.055; float on=1.0-smoothstep(p-0.04,p+0.02,key); float edge=1.0-smoothstep(0.0,0.05,abs(key-p)); vec3 c=mix(vec3(1.0,0.78,0.32),vec3(1.0,0.97,0.85),edge); gl_FragColor=vec4(c*m*(on*0.42+edge*1.0)*k, m*(on+edge)*k); }' });
      var pl = new T.Mesh(new T.PlaneGeometry(W - 0.04, H - 0.04), m); pl.rotation.x = -Math.PI / 2; pl.position.set(x, top + 0.012, 0); open.add(pl); return m;
    }
    var glowR = glowLayer(fat.glow, (W - 0.04) / 2), glowL = glowLayer(baq.glow, -(W - 0.04) / 2 + 0.005);

    /* light */
    var hemi = new T.HemisphereLight(0x3A4E9E, 0x07091A, 0.0); scene.add(hemi);
    var key = new T.SpotLight(0xFFE0A6, 0, 18, 0.55, 0.65, 1.2); key.position.set(2.2, 5.6, 3.4); key.target.position.set(0, 0, 0); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0004; scene.add(key); scene.add(key.target);
    var rim = new T.PointLight(0xF4C25A, 0, 10, 1.6); rim.position.set(-3, 1.6, -2.2); scene.add(rim);
    var glint = new T.PointLight(0xFFF1C8, 0, 4, 2); glint.position.set(-2, 1.2, 1); scene.add(glint);
    var inner = new T.PointLight(0xFFD98A, 0, 6, 1.8); inner.position.set(0, 0.7, 0); scene.add(inner);

    // light pouring out of the opened book
    var rayTex = tex(rayMap()), rays = new T.Group(); rays.position.set(0, top, 0); open.add(rays);
    for (var r = 0; r < 9; r++) { var pl = new T.Mesh(new T.PlaneGeometry(0.5 + Math.random() * 0.5, 4.5), new T.MeshBasicMaterial({ map: rayTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0, side: T.DoubleSide })); pl.position.y = 2.2; pl.rotation.y = r * Math.PI / 9; pl.rotation.z = (Math.random() - 0.5) * 0.5; rays.add(pl); }

    // gold motes
    var N = 520, pg = new T.BufferGeometry(), pp = new Float32Array(N * 3), pv = new Float32Array(N);
    for (var n = 0; n < N; n++) { pp[n * 3] = (Math.random() - 0.5) * 6; pp[n * 3 + 1] = Math.random() * 4 - 0.6; pp[n * 3 + 2] = (Math.random() - 0.5) * 5; pv[n] = 0.15 + Math.random() * 0.4; }
    pg.setAttribute('position', new T.BufferAttribute(pp, 3));
    var pmat = new T.PointsMaterial({ size: 0.05, map: tex(dotSprite()), transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0, color: 0xFFE6A8 });
    scene.add(new T.Points(pg, pmat));

    /* bloom */
    var composer = null, bloom = null;
    if (T.EffectComposer && T.UnrealBloomPass) {
      composer = new T.EffectComposer(renderer); composer.addPass(new T.RenderPass(scene, camera));
      bloom = new T.UnrealBloomPass(new T.Vector2(host.clientWidth, host.clientHeight), 0.5, 0.5, 0.88); composer.addPass(bloom);
    }
    function resize() { var w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); if (composer) composer.setSize(w, h); fit(); }
    var narrow = 1; function fit() { narrow = Math.max(1, Math.pow(1.3 / Math.max(0.42, camera.aspect), 0.9)); }
    window.addEventListener('resize', resize); fit();

    /* the timeline (seconds) */
    var t0 = 0, clock = 0, end = 10.0, finished = false, raf = 0, look = new T.Vector3();
    var P = [ // camera keys: time, position, target
      [0.0, [0.6, 2.2, 7.4], [0, 0.1, 0]], [2.6, [0.1, 3.1, 4.2], [-0.4, 0.1, 0]], [4.6, [0, 4.0, 3.0], [0, 0.1, 0.1]],
      [7.2, [0.15, 4.3, 2.2], [0.05, 0.1, -0.05]], [8.5, [0.5, 2.35, 0.95], [0.66, 0.2, -0.18]], [10.0, [0.64, 1.5, 0.5], [0.68, 0.22, -0.26]]];
    function camAt(t) {
      var i = 0; while (i < P.length - 2 && t > P[i + 1][0]) i++;
      var a = P[i], b = P[i + 1], k = ease((t - a[0]) / (b[0] - a[0]));
      look.set(lerp(a[2][0], b[2][0], k), lerp(a[2][1], b[2][1], k), lerp(a[2][2], b[2][2], k));
      // on a tall phone screen step back along the line of sight so the whole spread fits
      camera.position.set(lerp(a[1][0], b[1][0], k), lerp(a[1][1], b[1][1], k), lerp(a[1][2], b[1][2], k)).sub(look).multiplyScalar(narrow).add(look);
      camera.lookAt(look);
    }
    function frame(now) {
      if (finished) return;
      // our own clock: a slow frame (shader compile, a busy phone) never skips part of the show
      var dt = t0 ? Math.min(0.05, (now - t0) / 1000) : 0; t0 = now; clock += dt;
      draw(clock, dt);
      if (clock >= end) { stop(true); return; }
      raf = requestAnimationFrame(frame);
    }
    function draw(t, dt) {
      camAt(Math.min(t, end));
      // light finds the book, a glint runs over the tooling
      var dawn = seg(t, 0.1, 2.0); key.intensity = 3.2 * dawn; hemi.intensity = 0.55 * dawn; rim.intensity = 1.6 * dawn; pmat.opacity = 0.75 * dawn;
      var gl2 = seg(t, 1.6, 3.4); glint.intensity = Math.sin(gl2 * Math.PI) * 2.4; glint.position.set(lerp(-1.8, 0.8, gl2), 0.7, lerp(1.2, -0.6, gl2));
      // the cover opens, light pours out
      var oc = seg(t, 3.1, 4.9); coverPivot.rotation.z = -Math.PI * oc;
      var burst = seg(t, 3.5, 5.0); inner.intensity = 2.2 * burst * (1 - 0.65 * seg(t, 5.2, 6.8)); rays.children.forEach(function (m, i) { m.material.opacity = 0.22 * burst * (1 - 0.55 * seg(t, 5.4, 7.2)) * (0.6 + 0.4 * Math.sin(t * 1.3 + i)); }); rays.rotation.y = t * 0.12;
      // two leaves turn, then the first spread settles
      var l1 = seg(t, 4.7, 6.0), l2 = seg(t, 5.4, 6.8);
      leaf1.set(Math.PI * l1, -0.7); leaf2.set(Math.PI * l2, -0.75);
      // the verses light up line by line (right page first, then the left)
      var gr = seg(t, 6.7, 8.3), gl3 = seg(t, 7.3, 8.9), on = seg(t, 6.6, 6.9);
      glowR.uniforms.p.value = lerp(-0.1, 1.1, gr); glowR.uniforms.k.value = on; glowL.uniforms.p.value = lerp(-0.1, 1.1, gl3); glowL.uniforms.k.value = on;
      if (bloom) bloom.strength = 0.3 + 0.35 * burst * (1 - 0.6 * seg(t, 5.2, 6.8)) + 0.25 * seg(t, 8.8, 10.0);
      renderer.toneMappingExposure = 1.0 + 0.12 * seg(t, 8.8, 10.0);
      // motes drift upward
      for (var n = 0; n < N; n++) { pp[n * 3 + 1] += pv[n] * (dt || 0.016) * 0.4; if (pp[n * 3 + 1] > 3.6) pp[n * 3 + 1] = -0.6; }
      pg.attributes.position.needsUpdate = true;
      if (composer) composer.render(); else renderer.render(scene, camera);
    }
    function stop(natural) {
      if (finished) return; finished = true; cancelAnimationFrame(raf); window.removeEventListener('resize', resize);
      if (done) done(natural);
      setTimeout(function () { try { renderer.dispose(); pm.dispose(); } catch (e) {} }, 1200);
    }
    var api = { stop: function () { stop(false); } };
    var go = function () {
      // compile every shader and draw one frame before the clock starts
      try { camAt(0); renderer.compile(scene, camera); if (composer) composer.render(); else renderer.render(scene, camera); } catch (e) {}
      if (window.__muDebug) { window.__muSeek = function (t) { draw(t, 0); }; return; }
      raf = requestAnimationFrame(frame);
    };
    // wait (briefly) for Amiri so the verses are set in it, then build the textures and start
    var ready = document.fonts && document.fonts.load ? Promise.all([document.fonts.load('400 64px Amiri', 'بسم'), document.fonts.load('700 58px Amiri', 'سورة')]) : Promise.resolve();
    var started = false;
    var start = function () {
      if (started || finished) return; started = true;
      // redraw the pages now that the font is in, so the verses are in Amiri
      var b2 = pageMaps('baqarah', 1024, 1446), f2 = pageMaps('fatiha', 1024, 1446);
      blockMats[2].map = tex(b2.col); blockMats[2].needsUpdate = true;
      open.traverse(function (o) { if (o.material && o.material.side === T.BackSide && o.material.map && o.parent && o.parent.position.y === top + 0.002) { var bt = tex(f2.col); bt.wrapS = T.RepeatWrapping; bt.repeat.x = -1; bt.offset.x = 1; o.material.map = bt; o.material.needsUpdate = true; } });
      glowR.uniforms.map.value = tex(f2.glow, false); glowL.uniforms.map.value = tex(b2.glow, false);
      go();
    };
    ready.then(start, start); setTimeout(start, 1800);
    return api;
  };
})();
