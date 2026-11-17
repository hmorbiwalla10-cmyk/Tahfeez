/* Qism al Tahfeez portal — shared code: data layer, formatting, receipts, UI helpers. */
(function () {
  'use strict';
  var MZ = (window.MZ = window.MZ || {});
  var CFG = window.MZ_CONFIG || {};
  MZ.LIVE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  MZ.AR_NAME = 'قسم التحفيظ · دار السلام';

  /* ------------------------------------------------------------ helpers */
  var $ = (MZ.$ = function (s, r) { return (r || document).querySelector(s); });
  MZ.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = (MZ.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  });
  var pad = (MZ.pad = function (n, l) { return String(n).padStart(l || 2, '0'); });
  MZ.today = function () { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  MZ.thisMonth = function () { return MZ.today().slice(0, 7); };
  function ymd(k) { return new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, k.length > 7 ? +k.slice(8, 10) : 1); }
  MZ.monthLabel = function (k) { return ymd(k).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); };
  MZ.monthShort = function (k) { return ymd(k).toLocaleDateString('en-GB', { month: 'short' }); };
  MZ.dateLabel = function (d) { return d ? ymd(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''; };
  MZ.dateShort = function (d) { return d ? ymd(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''; };
  MZ.addMonths = function (k, n) {
    var y = +k.slice(0, 4), m = +k.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad(m + 1);
  };
  MZ.ordinal = function (n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  MZ.money = function (n, cur) { return (cur || 'TSh') + ' ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); };
  MZ.initials = function (name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  };
  MZ.firstName = function (name) { return String(name || '').trim().split(/\s+/)[0] || ''; };

  var ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function under1000(n) {
    var out = [];
    if (n >= 100) { out.push(ONES[Math.floor(n / 100)] + ' hundred'); n %= 100; }
    if (n >= 20) { out.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')); }
    else if (n > 0) out.push(ONES[n]);
    return out.join(' ');
  }
  MZ.amountInWords = function (amount, cur) {
    var n = Math.floor(Math.abs(Number(amount) || 0));
    if (!n) return 'Zero';
    var parts = [], scales = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
    scales.forEach(function (s) { if (n >= s[0]) { parts.push(under1000(Math.floor(n / s[0])) + ' ' + s[1]); n %= s[0]; } });
    if (n) parts.push(under1000(n));
    var w = parts.join(' ');
    var unit = /sh/i.test(cur || '') ? ' shillings' : '';
    return w.charAt(0).toUpperCase() + w.slice(1) + unit + ' only';
  };

  /* Fee status of a student for one month. */
  MZ.statusOf = function (student, month, payment, settings) {
    if (payment) return payment.status === 'pending' ? 'pending' : 'paid';
    if ((student.start_month || '0000-00') > month) return 'na';
    if (MZ.onLeave(student, month)) return 'leave';
    var cur = MZ.thisMonth();
    if (month > cur) return 'upcoming';
    if (month < cur) return 'overdue';
    return +MZ.today().slice(8, 10) > ((settings && settings.due_day) || 5) ? 'overdue' : 'due';
  };
  MZ.STATUS_LABEL = { leave: 'On leave', paid: 'Paid', pending: 'Waiting for approval', due: 'Due', overdue: 'Unpaid', upcoming: 'Upcoming', na: 'Not enrolled' };
  MZ.pill = function (st, settings) {
    if (st === 'paid') return '<span class="pill good"><i></i>Paid</span>';
    if (st === 'pending') return '<span class="pill pending"><i></i>Waiting for approval</span>';
    if (st === 'overdue') return '<span class="pill bad"><i></i>Unpaid</span>';
    if (st === 'due') return '<span class="pill warn"><i></i>Due by ' + MZ.ordinal((settings && settings.due_day) || 5) + '</span>';
    if (st === 'upcoming') return '<span class="pill plain">Upcoming</span>';
    if (st === 'leave') return '<span class="pill leave"><i></i>On leave</span>';
    return '<span class="pill plain">Not enrolled</span>';
  };

  /* Make a username from a full name: "Hussein Ahmed" → "hussein.ahmed". */
  MZ.slugUsername = function (name, taken) {
    var base = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
    var u = base.length > 1 ? base[0] + '.' + base[base.length - 1] : (base[0] || 'student');
    u = u.slice(0, 26);
    if (u.length < 3) u = (u + 'student').slice(0, 8);
    var cand = u, i = 2;
    while (taken && taken[cand]) { cand = u + i; i++; }
    return cand;
  };
  MZ.validUsername = function (u) { return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u); };

  /* ------------------------------------------------------- UI helpers */
  MZ.toast = function (msg, action) {
    var box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var el = document.createElement('div'); el.className = 'toast';
    var sp = document.createElement('span'); sp.textContent = msg; el.appendChild(sp);
    if (action) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = action.label;
      b.onclick = function () { el.remove(); action.fn(); }; el.appendChild(b);
    }
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, action ? 7000 : 4000);
  };
  /* Two-step confirm without browser dialogs. */
  MZ.arm = function (btn, fn, label) {
    if (btn.dataset.armed === '1') { btn.dataset.armed = ''; fn(); return; }
    var old = btn.innerHTML; btn.dataset.armed = '1'; btn.classList.add('armed'); btn.textContent = label || 'Tap again to confirm';
    setTimeout(function () { if (btn.isConnected && btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.classList.remove('armed'); btn.innerHTML = old; } }, 4000);
  };
  MZ.copy = function (text, okMsg) {
    var p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject();
    return p.then(function () { MZ.toast(okMsg || 'Copied.'); }).catch(function () { MZ.toast('Copying is blocked here. Select the text and copy it instead.'); });
  };
  /* Save a generated file (works on a normal website and inside a Claude preview). */
  MZ.saveFile = function (filename, blob) {
    var viaClaude = window.claude && window.claude.use ? Promise.resolve(window.claude.use('downloads')).catch(function () { return null; }) : Promise.resolve(null);
    return viaClaude.then(function (dl) {
      if (dl) return dl.save({ filename: filename, data: blob }).then(function () { return true; }, function (e) { if (e && e.code === 'declined') return false; throw e; });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      return true;
    });
  };
  MZ.wa = function (phone, text) {
    var p = String(phone || '').replace(/\D/g, '');
    return 'https://wa.me/' + p + '?text=' + encodeURIComponent(text);
  };
  /* Arabic typing: any text field follows the direction of what is typed (Arabic right-to-left). */
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if ((t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|search|)$/.test(t.type || ''))) && !t.hasAttribute('dir')) t.setAttribute('dir', 'auto');
  });
  MZ.hasArabic = function (s) { return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(String(s || '')); };
  MZ.togglePw = function (root) {
    (root || document).addEventListener('click', function (e) {
      var b = e.target.closest('[data-pw]'); if (!b) return;
      var i = b.parentNode.querySelector('input'); var show = i.type === 'password';
      i.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show';
    });
  };

  MZ.ICON = {
    pen: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" stroke="currentColor" stroke-width="1.9"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3.5 22 20H2z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M12 10v4.5M12 17.2v.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    key: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="7.5" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="7.5" cy="12" r="1.4" fill="currentColor"/><path d="M11.7 12H21M17.5 12v3.2M20.5 12v2.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    book: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 5.5c2.6-.9 5.3-.7 8 1 2.7-1.7 5.4-1.9 8-1V19c-2.6-.9-5.3-.7-8 1-2.7-1.7-5.4-1.9-8-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 6.5V20" stroke="currentColor" stroke-width="1.8"/></svg>',
    doc: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 3h8l4 4v14H6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v4h4M9 12h6M9 16h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    gift: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3.5" y="9" width="17" height="11.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2.5 9h19M12 9v11.5M12 9c-1.5-3.5-6-4.5-6-1.8C6 9 12 9 12 9zm0 0c1.5-3.5 6-4.5 6-1.8C18 9 12 9 12 9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    back: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M12 4.5L6.5 10 12 15.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cash: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 9.5v5M18 9.5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    bank: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 9.5L12 4l9 5.5M4.5 10v7.5M9 10v7.5M15 10v7.5M19.5 10v7.5M3 20h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    swap: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    flag: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mail: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 7l8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    plane: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M10.5 13.5L3 11l1.2-1.6 8 .6 4.6-5.2c.9-1 2.4-1.3 3.2-.5.8.8.5 2.3-.5 3.2L14 12.1l.6 8L13 21.3l-2.5-7.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    print: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    left: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    right: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M7.5 4.5L13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    home: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 3h12v18l-2.2-1.5L13.6 21 12 19.5 10.4 21l-2.2-1.5L6 21z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 8h6M9 12h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    user: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.5 20c1.2-3.6 4-5.3 7.5-5.3s6.3 1.7 7.5 5.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    upload: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 13V3.5M6 7l4-4 4 4M3.5 13v3h13v-3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    gear: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3 6h9M16 6h1M3 14h1M8 14h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><circle cx="14" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="14" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'
  };

  /* ---------------------------------------------------------- receipts */
  MZ.receiptText = function (p, st, s) {
    return [
      (s.institute_name || 'Qism al Tahfeez Dar es Salaam') + ' — Fee receipt',
      'Receipt no: ' + p.receipt_no,
      'Student: ' + st.full_name + ' (' + st.username + ')',
      'Fees for: ' + MZ.monthLabel(p.month),
      'Amount: ' + MZ.money(p.amount, s.currency),
      '(' + MZ.amountInWords(p.amount, s.currency) + ')',
      'Paid on: ' + MZ.dateLabel(p.paid_on) + ' by ' + p.method,
      'Status: PAID',
      'Thank you'
    ].join('\n');
  };
  /* Seal: an eight-pointed Fatimid rosette with a gilded rim. */
  function sealSVG(id) {
    var pts = []; for (var i = 0; i < 16; i++) { var a = Math.PI / 8 * i - Math.PI / 2, r = i % 2 ? 31 : 44; pts.push((50 + r * Math.cos(a)).toFixed(1) + ',' + (50 + r * Math.sin(a)).toFixed(1)); }
    return '<svg viewBox="0 0 100 100" class="rx-sealsvg" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F3D29B"/><stop offset=".45" stop-color="#C98F45"/><stop offset=".7" stop-color="#E8BF7E"/><stop offset="1" stop-color="#9A6526"/></linearGradient></defs>'
      + '<circle cx="50" cy="50" r="48" fill="url(#' + id + ')"/><circle cx="50" cy="50" r="45" fill="none" stroke="#FFF3DC" stroke-width=".8" stroke-dasharray="1.5 2"/>'
      + '<polygon points="' + pts.join(' ') + '" fill="#FFF7E8" fill-opacity=".22" stroke="#FFF3DC" stroke-width="1.1"/>'
      + '<circle cx="50" cy="50" r="22" fill="url(#' + id + ')" stroke="#FFF3DC" stroke-width="1"/>'
      + '<text x="50" y="56" text-anchor="middle" font-family="Amiri,Georgia,serif" font-weight="700" font-size="17" fill="#FFFBF2">QT</text></svg>';
  }
  var rxSeq = 0;
  MZ.receiptHTML = function (p, st, s) {
    var sid = 'rxg' + (++rxSeq);
    return '<div class="receipt rx' + (p.status === 'pending' ? ' rx-pending' : '') + '">'
      + (p.status === 'pending' ? '<p class="rx-waitband">Waiting for admin approval · not yet sent to the student</p>' : '')
      + '<svg class="rx-arch" viewBox="0 0 300 120" preserveAspectRatio="none" aria-hidden="true"><path d="M2 120V70Q2 30 112 12L150 2L188 12Q298 30 298 70V120" fill="none" stroke="#C99350" stroke-width="1.6"/><path d="M12 120V73Q12 38 117 21L150 12L183 21Q288 38 288 73V120" fill="none" stroke="#E2C291" stroke-width=".8"/></svg>'
      + '<img class="rlogo" src="assets/logo-qt.png" alt="">'
      + '<p class="rname">' + esc(s.institute_name || 'Qism al Tahfeez Dar es Salaam') + '</p>'
      + '<p class="rx-kind">Official fee receipt</p>'
      + '<div class="rx-band" aria-hidden="true"></div>'
      + '<p class="ramt num"><small>Amount received</small>' + esc(MZ.money(p.amount, s.currency)) + '</p>'
      + '<p class="rx-words">' + esc(MZ.amountInWords(p.amount, s.currency)) + '</p>'
      + '<p class="rx-no">Receipt <b class="mono">' + esc(p.receipt_no) + '</b></p>'
      + '<dl>'
      + '<div><dt>Student</dt><dd>' + esc(st.full_name) + '</dd></div>'
      + (st.admission_no ? '<div><dt>Admission no</dt><dd class="mono">' + esc(st.admission_no) + '</dd></div>' : '')
      + (st.its_no ? '<div><dt>ITS no</dt><dd class="mono">' + esc(st.its_no) + '</dd></div>' : '<div><dt>Username</dt><dd class="mono">' + esc(st.username) + '</dd></div>')
      + '<div><dt>Fees for</dt><dd>' + esc(MZ.monthLabel(p.month)) + '</dd></div>'
      + '<div><dt>Paid on</dt><dd>' + esc(MZ.dateLabel(p.paid_on)) + '</dd></div>'
      + '<div><dt>Method</dt><dd>' + esc(p.method) + '</dd></div>'
      + (p.note ? '<div><dt>Note</dt><dd>' + esc(p.note) + '</dd></div>' : '')
      + '</dl>'
      + '<div class="rx-foot"><div class="rx-seal">' + sealSVG(sid) + '</div><p class="thanks">Thank you</p></div>'
      + (p.status === 'pending'
        ? '<div class="stamp wait" aria-label="Waiting for approval"><b>PENDING</b><small>APPROVAL</small></div>'
        : '<div class="stamp" aria-label="Paid"><b>PAID</b><small>' + esc(MZ.monthShort(p.month).toUpperCase() + ' ' + p.month.slice(0, 4)) + '</small></div>')
      + '</div>';
  };

  var logoImg = null;
  function loadLogo() {
    if (logoImg) return logoImg;
    logoImg = new Promise(function (res) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = 'assets/logo-qt.png'; });
    return logoImg;
  }
  function keelArch(x, l, t, r, b, inset) {
    var w = r - l, mid = l + w / 2;
    x.beginPath(); x.moveTo(l, b); x.lineTo(l, t + 120);
    x.quadraticCurveTo(l, t + 40, mid - 0.13 * w, t + 14); x.lineTo(mid, t); x.lineTo(mid + 0.13 * w, t + 14);
    x.quadraticCurveTo(r, t + 40, r, t + 120); x.lineTo(r, b);
  }
  MZ.receiptPNG = function (p, st, s) {
    var fonts = document.fonts && document.fonts.load ? Promise.all([
      document.fonts.load('700 48px Amiri'), document.fonts.load('600 24px Figtree'), document.fonts.load('500 24px "IBM Plex Mono"')
    ]).catch(function () {}) : Promise.resolve();
    return Promise.all([fonts, loadLogo()]).then(function (r) {
      var logo = r[1], W = 1000, H = 1640, c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d'), GOLD = '#C99350', DEEP = '#8E5F25', INK = '#2E2113', MUTE = '#76624B', LINE = '#E3CDAA';
      // marble: warm ivory with soft grey-gold veins
      var g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#FFFDF8'); g.addColorStop(.5, '#FAF5EC'); g.addColorStop(1, '#F6EEE0');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      var seed = 7; function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
      x.lineCap = 'round';
      for (var v = 0; v < 14; v++) {
        x.strokeStyle = 'rgba(150,125,95,' + (0.05 + rnd() * 0.07).toFixed(3) + ')'; x.lineWidth = 0.8 + rnd() * 2.2;
        var sx = rnd() * W, sy = rnd() * H; x.beginPath(); x.moveTo(sx, sy);
        for (var k = 0; k < 4; k++) { x.bezierCurveTo(sx + (rnd() - .3) * 360, sy + (rnd() - .5) * 260, sx + (rnd() - .2) * 420, sy + (rnd() - .5) * 300, sx += 120 + rnd() * 200, sy += (rnd() - .5) * 220); }
        x.stroke();
      }
      // gilded double frame with a keel arch head
      var gg = x.createLinearGradient(0, 0, W, 0); gg.addColorStop(0, '#E6BE7E'); gg.addColorStop(.5, '#B47A35'); gg.addColorStop(1, '#E6BE7E');
      x.strokeStyle = gg; x.lineWidth = 6; keelArch(x, 34, 34, W - 34, H - 34); x.lineTo(34, H - 34); x.closePath(); x.stroke();
      x.strokeStyle = LINE; x.lineWidth = 2; keelArch(x, 52, 56, W - 52, H - 52); x.lineTo(52, H - 52); x.closePath(); x.stroke();
      // corner stars
      function star(cx, cy, R, fill) { x.beginPath(); for (var i = 0; i < 16; i++) { var a = Math.PI / 8 * i - Math.PI / 2, rr = i % 2 ? R * .45 : R; x[i ? 'lineTo' : 'moveTo'](cx + rr * Math.cos(a), cy + rr * Math.sin(a)); } x.closePath(); x.fillStyle = fill; x.fill(); }
      star(W / 2, 34, 16, GOLD); star(34, H - 34, 12, GOLD); star(W - 34, H - 34, 12, GOLD);
      var y = 130;
      if (logo) { var lw = 180, lh = lw * logo.height / logo.width; x.drawImage(logo, (W - lw) / 2, y, lw, lh); y += lh + 30; }
      x.textAlign = 'center'; x.fillStyle = INK; x.font = '700 50px Amiri, Georgia, serif';
      x.fillText(s.institute_name || 'Qism al Tahfeez Dar es Salaam', W / 2, y + 30); y += 74;
      x.fillStyle = DEEP; x.font = 'italic 26px Amiri, Georgia, serif'; x.fillText('Official fee receipt', W / 2, y); y += 34;
      // tiraz band
      x.strokeStyle = GOLD; x.lineWidth = 1.5; x.beginPath(); x.moveTo(260, y); x.lineTo(W - 260, y); x.moveTo(260, y + 14); x.lineTo(W - 260, y + 14); x.stroke();
      for (var d = 280; d <= W - 280; d += 40) { x.beginPath(); x.moveTo(d, y + 2); x.lineTo(d + 5, y + 7); x.lineTo(d, y + 12); x.lineTo(d - 5, y + 7); x.closePath(); x.fillStyle = GOLD; x.fill(); }
      y += 88;
      x.fillStyle = MUTE; x.font = '700 18px Figtree, sans-serif'; if ('letterSpacing' in x) x.letterSpacing = '3px'; x.fillText('AMOUNT RECEIVED', W / 2, y); if ('letterSpacing' in x) x.letterSpacing = '0px'; y += 76;
      var ag = x.createLinearGradient(0, y - 60, 0, y); ag.addColorStop(0, '#A9732F'); ag.addColorStop(1, '#6F4818');
      x.fillStyle = ag; x.font = '700 80px Amiri, Georgia, serif'; x.fillText(MZ.money(p.amount, s.currency), W / 2, y); y += 46;
      x.fillStyle = MUTE; x.font = '500 22px Figtree, sans-serif'; x.fillText(MZ.amountInWords(p.amount, s.currency), W / 2, y); y += 50;
      x.font = '500 24px "IBM Plex Mono", monospace'; x.fillText('Receipt ' + p.receipt_no, W / 2, y); y += 88;
      var rows = [['Student', st.full_name]].concat(st.admission_no ? [['Admission no', st.admission_no]] : []).concat([st.its_no ? ['ITS no', st.its_no] : ['Username', st.username]]).concat([['Fees for', MZ.monthLabel(p.month)], ['Paid on', MZ.dateLabel(p.paid_on)], ['Method', p.method]]);
      if (p.note) rows.push(['Note', p.note]);
      rows.forEach(function (rw) {
        x.strokeStyle = LINE; x.lineWidth = 2; x.setLineDash([2, 8]); x.beginPath(); x.moveTo(120, y - 44); x.lineTo(W - 120, y - 44); x.stroke(); x.setLineDash([]);
        x.textAlign = 'left'; x.fillStyle = MUTE; x.font = '500 26px Figtree, sans-serif'; x.fillText(rw[0], 120, y);
        x.textAlign = 'right'; x.fillStyle = INK; x.font = '600 28px Figtree, sans-serif';
        var v = String(rw[1]); while (x.measureText(v).width > 520 && v.length > 4) v = v.slice(0, -2);
        x.fillText(v, W - 120, y); y += 74;
      });
      // gold seal
      var cx = W / 2, cy = H - 210, sg = x.createLinearGradient(cx - 70, cy - 70, cx + 70, cy + 70);
      sg.addColorStop(0, '#F3D29B'); sg.addColorStop(.45, '#C98F45'); sg.addColorStop(.7, '#E8BF7E'); sg.addColorStop(1, '#9A6526');
      x.shadowColor = 'rgba(110,70,15,.35)'; x.shadowBlur = 18; x.shadowOffsetY = 6;
      x.fillStyle = sg; x.beginPath(); x.arc(cx, cy, 70, 0, Math.PI * 2); x.fill(); x.shadowColor = 'transparent';
      x.strokeStyle = 'rgba(255,243,220,.9)'; x.lineWidth = 1.5; x.setLineDash([3, 4]); x.beginPath(); x.arc(cx, cy, 64, 0, Math.PI * 2); x.stroke(); x.setLineDash([]);
      star(cx, cy, 58, 'rgba(255,247,232,.25)'); x.lineWidth = 1.6; x.stroke();
      x.fillStyle = sg; x.beginPath(); x.arc(cx, cy, 30, 0, Math.PI * 2); x.fill(); x.strokeStyle = '#FFF3DC'; x.lineWidth = 1.5; x.stroke();
      x.fillStyle = '#FFFBF2'; x.textAlign = 'center'; x.font = '700 26px Amiri, serif'; x.fillText('QT', cx, cy + 9);
      x.fillStyle = DEEP; x.font = '400 34px Amiri, serif'; x.fillText('Thank you', W / 2, H - 92);
      // ink stamp
      x.save(); x.translate(W - 240, H - 230); x.rotate(-0.22); x.globalAlpha = .82;
      x.strokeStyle = '#A3322A'; x.lineWidth = 6; x.beginPath(); x.arc(0, 0, 92, 0, Math.PI * 2); x.stroke();
      x.lineWidth = 2; x.beginPath(); x.arc(0, 0, 80, 0, Math.PI * 2); x.stroke();
      x.fillStyle = '#A3322A'; x.textAlign = 'center'; x.font = '800 44px Figtree, sans-serif'; x.fillText('PAID', 0, 10);
      x.font = '800 16px Figtree, sans-serif'; x.fillText(MZ.monthShort(p.month).toUpperCase() + ' ' + p.month.slice(0, 4), 0, 40);
      x.restore();
      return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error('Could not draw the receipt.')); }, 'image/png'); });
    });
  };
  MZ.saveReceipt = function (p, st, s) {
    return MZ.receiptPNG(p, st, s).then(function (b) { return MZ.saveFile('Receipt ' + p.receipt_no + ' ' + st.full_name + '.png', b); })
      .then(function (ok) { if (ok) MZ.toast('Receipt image saved.'); })
      .catch(function () { MZ.toast('Could not save the image on this device.'); });
  };

  /* ===================================================================
     DATA LAYER — the same functions in live (Supabase) and demo mode.
     =================================================================== */
  function friendly(e) {
    var m = (e && (e.message || e.error_description || e.msg)) || String(e || 'Something went wrong.');
    if (/invalid login credentials/i.test(m)) return 'Username or password is incorrect.';
    if (/banned/i.test(m)) return 'This account is disabled. Please contact the institute.';
    if (/failed to fetch|network/i.test(m)) return 'No internet connection. Check your connection and try again.';
    if (/payments_student_id_month_key|duplicate key/i.test(m)) return 'This month is already marked as paid.';
    if (/row-level security|permission denied/i.test(m)) return 'Your account is not allowed to do that.';
    if (/should be at least 6|at least 6 characters/i.test(m)) return 'Password must be at least 6 characters.';
    return m;
  }
  function fail(e) { var err = new Error(friendly(e)); err.original = e; throw err; }
  MZ.friendly = friendly;

  function normalizeStudent(r) {
    return { id: r.id, username: r.username, full_name: r.full_name, phone: r.phone || '', monthly_fee: Number(r.monthly_fee || 0),
      start_month: r.start_month, juz: +r.juz || 0, created_at: r.created_at,
      pages: Math.max(0, Math.min(604, +r.pages || 0)), keys: +r.keys || 0, rewards_given: +r.rewards_given || 0, rewards_seen: +r.rewards_seen || 0,
      admission_no: r.admission_no || '', its_no: r.its_no || '', program: r.program || '', guardian_name: r.guardian_name || '', dob: r.dob || '', gender: r.gender || '', email: r.email || '', disabled: !!r.disabled_at, disabled_at: r.disabled_at || null,
      discount_type: r.discount_type === 'percent' ? 'percent' : 'amount', discount_value: Number(r.discount_value || 0), discount_note: r.discount_note || '',
      cur_surah: r.cur_surah ? +r.cur_surah : null, cur_pos: r.cur_pos ? +r.cur_pos : null,
      breaks: normBreaks(r.breaks), is_new: !!r.is_new, welcome_sent_at: r.welcome_sent_at || null,
      teacher_ids: (r.teacher_ids || []).map(Number).filter(function (x) { return x > 0; }),
      hifz_dir: r.hifz_dir === 'backward' ? 'backward' : r.hifz_dir === 'forward' ? 'forward' : null, hifz_dir_manual: !!r.hifz_dir_manual };
  }
  function normBreaks(b) {
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = []; } }
    return (Array.isArray(b) ? b : []).filter(function (x) { return x && /^\d{4}-\d{2}$/.test(x.from); })
      .map(function (x) { return { from: x.from, to: /^\d{4}-\d{2}$/.test(x.to || '') ? x.to : null, note: String(x.note || '').slice(0, 200) }; })
      .sort(function (a, c) { return a.from < c.from ? -1 : 1; });
  }
  MZ.DEFAULT_WELCOME = "Hello *{name}*, thank you for your sign up.\n\nTo complete your registration, please make your payment by the instructions that follow:\n\n{fees}\n\n*Fee Payment Instructions*\n\nPlease use the following account details to pay your fees:\n\n*Account Number:* 000100433890001\n*Account Name:* Al Madrasa Tus Saifiya Tul Burhaniyah\n\n*How to Pay:*\n\n1. Open your *Airtel Money, Selcom, M-Pesa, or Yas* app.\n2. Select *“Payment to Other Banks.”*\n3. Choose *Habib African Bank*.\n4. Enter the account number: *000100433890001*\n5. The account name *Al Madrasa Tus Saifiya Tul Burhaniyah* will appear automatically.\n6. Enter the amount and complete the payment.\n7. Kindly send the receipt to +255 738 468 484.\n\nOnce completed you will be informed on starting your classes.\n\nRegards\nAdmin\nAccount Dept";
  /* Fee details for the welcome email, from the student's saved enrollment record.
     An amount that was not entered is never guessed: the email says it will be confirmed, and the portal flags it. */
  MZ.welcomeFees = function (s, set) {
    set = set || {}; var cur = set.currency || 'TSh', fee = Number(s.monthly_fee || 0), reg = Number(set.registration_fee || 0), L = ['*Your Fees*'];
    if (s.program) L.push('Program: ' + s.program);
    var missing = !(fee > 0);
    if (missing) {
      L.push('Monthly fee: *to be confirmed*', 'The accounts office will confirm your fee amount with you before you pay.');
    } else {
      var eff = MZ.effFee(s), disc = MZ.discountLabel(s, cur);
      L.push('Monthly fee: ' + (disc ? MZ.money(fee, cur) : '*' + MZ.money(fee, cur) + '*'));
      if (disc) L.push('Discount: ' + disc + (s.discount_note ? ' (' + s.discount_note + ')' : ''), 'You pay each month: *' + MZ.money(eff, cur) + '*');
      else if (s.discount_note) L.push('Note: ' + s.discount_note);
    }
    if (reg > 0) L.push('Registration fee (one time): ' + MZ.money(reg, cur));
    if (s.start_month) L.push('Fees start from: ' + MZ.monthLabel(s.start_month));
    if (!missing) L.push('Amount to pay now: *' + MZ.money(MZ.effFee(s) + reg, cur) + '*' + (reg > 0 ? ' (registration + first month)' : ' (first month)'));
    return { text: L.join('\n'), missing: missing };
  };
  // put the fee details where the message says {fees}, else just before the payment instructions (or after the first paragraph)
  MZ.withWelcomeFees = function (body, s, set) {
    var f = MZ.welcomeFees(s, set), b = String(body || '');
    if (b.indexOf('{fees}') >= 0) return b.replace(/\{fees\}/g, f.text);
    var at = b.indexOf('*Fee Payment Instructions*'); if (at < 0) { at = b.indexOf('\n\n'); at = at < 0 ? b.length : at + 2; return b.slice(0, at) + f.text + '\n\n' + b.slice(at); }
    return b.slice(0, at) + f.text + '\n\n' + b.slice(at);
  };
  /* payment slip: JPEG, PNG or PDF up to 10 MB */
  MZ.PROOF_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
  MZ.proofCheck = function (f) {
    if (!f) return '';
    var t = f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : /\.png$/i.test(f.name) ? 'image/png' : /\.jpe?g$/i.test(f.name) ? 'image/jpeg' : '');
    if (MZ.PROOF_TYPES.indexOf(t) < 0) return 'The payment slip must be a JPEG, PNG or PDF file.';
    if (f.size > 10485760) return 'The payment slip is too big. The limit is 10 MB.';
    return '';
  };
  /* praise badges */
  // the badges that can be given now
  MZ.BADGES = [
    ['tajweed', 'Excellent Ahkaam & Makharij', 'Correct ahkaam and makharij', '#2F7D6B'],
    ['murajaat', 'Strong Murajaat', 'Revision kept strong', '#3D6FA8'],
    ['effort', 'Hard Worker', 'Great effort and dedication', '#B5542C']
  ];
  // no longer given, but badges already awarded keep showing with their own look
  MZ.BADGES_RETIRED = [
    ['star', 'Star of the Week', '', '#C9971C'], ['hifz', 'Hifz Champion', '', '#A0701A'], ['punctual', 'Always On Time', '', '#5B6B7A'],
    ['akhlaq', 'Excellent Akhlaq', '', '#7A4FA0'], ['helper', 'Helping Hand', '', '#2E8B57'], ['improve', 'Most Improved', '', '#C0392B'], ['custom', 'Special praise', '', '#8C6A2E']
  ];
  MZ.badgeDef = function (k) { var all = MZ.BADGES.concat(MZ.BADGES_RETIRED); for (var i = 0; i < all.length; i++) if (all[i][0] === k) return all[i]; return MZ.BADGES_RETIRED[MZ.BADGES_RETIRED.length - 1]; };
  // the name shown for a badge: the current name for a renamed badge, and never a stray colon at the end
  MZ.badgeTitle = function (b) { var t = b.badge === 'tajweed' && /^beautiful tajweed\s*:?\s*$/i.test(b.title || '') ? MZ.BADGES[0][1] : String(b.title || MZ.badgeDef(b.badge)[1]); return t.replace(/\s*:+\s*$/, ''); };
  /* ---- weekly timetable: the same layout for the email, the preview and the printable page (keep in step with notify-teacher) ---- */
  var TT_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var TT_MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var TT_CHANGE = { rescheduled: 'Rescheduled', updated: 'Updated', reassigned: 'New teacher' };
  function ttEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ttD(d) { return new Date(String(d).slice(0, 10) + 'T12:00:00Z'); }
  function ttAdd(d, n) { var x = ttD(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function ttDay(d) { return TT_DAY[ttD(d).getUTCDay()]; }
  function ttDate(d, noYear) { var x = ttD(d); return x.getUTCDate() + ' ' + TT_MON[x.getUTCMonth()].slice(0, 3) + (noYear ? '' : ' ' + x.getUTCFullYear()); }
  function tt12(t) { t = String(t || ''); var h = +t.slice(0, 2), m = t.slice(3, 5); return ((h % 12) || 12) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function ttIsWeek(p) { return ttD(p.from).getUTCDay() === 1 && ttAdd(p.from, 6) === String(p.to).slice(0, 10); }
  function ttPeriod(p) {
    var a = ttD(p.from), b = ttD(p.to), same = a.getUTCFullYear() === b.getUTCFullYear();
    return ttDay(p.from) + ' ' + ttDate(p.from, same) + ' – ' + ttDay(p.to) + ' ' + ttDate(p.to);
  }
  function ttTitle(p) {
    var w = ttIsWeek(p) ? 'Weekly ' : '';
    return p.type === 'student' ? 'Your ' + w + 'Timetable' : p.type === 'teacher' ? 'Your ' + w + 'Teaching Timetable' : w + 'Timetable · All Lessons';
  }
  function ttCols(type) {
    return type === 'student' ? ['Day', 'Date', 'Teacher', 'Start Time', 'End Time', 'Duration']
      : type === 'teacher' ? ['Day', 'Date', 'Student', 'Start Time', 'End Time', 'Duration']
      : ['Day', 'Date', 'Student', 'Teacher', 'Start Time', 'End Time', 'Duration'];
  }
  // rows grouped by day: every day of a week (empty days too), or only the days with lessons for a longer range
  function ttGroups(p) {
    var by = {}, rows = (p.rows || []).slice().sort(function (a, b) { return (a.date + a.from) < (b.date + b.from) ? -1 : (a.date + a.from) > (b.date + b.from) ? 1 : 0; });
    rows.forEach(function (r) { var k = String(r.date).slice(0, 10); (by[k] = by[k] || []).push(r); });
    var days = [];
    if (ttIsWeek(p)) for (var i = 0; i < 7; i++) days.push(ttAdd(p.from, i));
    else days = Object.keys(by).sort();
    return days.map(function (d) { return { date: d, rows: by[d] || [] }; });
  }
  function ttCells(p, r) {
    var who = p.type === 'student' ? [r.teacher] : p.type === 'teacher' ? [r.student] : [r.student, r.teacher];
    return { who: who, from: tt12(r.from), to: tt12(r.to), mins: (r.mins || 0) + ' min', change: TT_CHANGE[r.change] || '', note: r.note || '' };
  }
  function ttSubject(p) {
    var a = ttD(p.from), b = ttD(p.to), per = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear() ? a.getUTCDate() + '–' + ttDate(p.to) : ttDate(p.from, a.getUTCFullYear() === b.getUTCFullYear()) + ' – ' + ttDate(p.to);
    return (p.type === 'student' ? 'Your timetable' : p.type === 'teacher' ? 'Your teaching timetable' : 'Timetable, all lessons') + ': ' + per;
  }
function ttEmailHtml(p, o) {
    o = o || {};
    var cols = ttCols(p.type), g = ttGroups(p), n = (p.rows || []).length, gold = '#A67C1E';
    var th = 'padding:9px 8px;border:1px solid #E2D3A8;background:#0E1736;color:#F4DE9C;font:700 12px Arial,sans-serif;text-align:left;white-space:nowrap';
    var td = 'padding:9px 8px;border:1px solid #E9DDBA;font:14px Arial,sans-serif;color:#1C1A17;vertical-align:top';
    var body = g.map(function (d, di) {
      var bg = di % 2 ? '#FFFDF8' : '#FBF5E6';
      if (!d.rows.length) return '<tr style="background:' + bg + '"><td class="ttc" style="' + td + ';font-weight:700;color:' + gold + '">' + ttEsc(ttDay(d.date)) + '</td><td class="ttc" style="' + td + ';white-space:nowrap">' + ttEsc(ttDate(d.date)) + '</td><td class="ttc" colspan="' + (cols.length - 2) + '" style="' + td + ';color:#8A8270;font-style:italic">No lessons</td></tr>';
      return d.rows.map(function (r, i) {
        var c = ttCells(p, r);
        return '<tr style="background:' + bg + '">'
          + (i === 0 ? '<td class="ttc" rowspan="' + d.rows.length + '" style="' + td + ';font-weight:700;color:' + gold + '">' + ttEsc(ttDay(d.date)) + '</td><td class="ttc" rowspan="' + d.rows.length + '" style="' + td + ';white-space:nowrap">' + ttEsc(ttDate(d.date)) + '</td>' : '')
          + c.who.map(function (w, k) { return '<td class="ttc" style="' + td + '"><b>' + ttEsc(w) + '</b>' + (k === c.who.length - 1 && c.change ? '<br><span style="display:inline-block;margin-top:3px;padding:1px 8px;border-radius:999px;background:#FCEBC8;color:#7A5A14;font-size:11px;font-weight:700">' + ttEsc(c.change) + '</span>' : '') + (k === c.who.length - 1 && c.note ? '<br><span style="font-size:12px;color:#6B6455">' + ttEsc(c.note) + '</span>' : '') + '</td>'; }).join('')
          + '<td class="ttc" style="' + td + ';white-space:nowrap;font-weight:700">' + ttEsc(c.from) + '</td><td class="ttc" style="' + td + ';white-space:nowrap">' + ttEsc(c.to) + '</td><td class="ttc" style="' + td + ';white-space:nowrap">' + ttEsc(c.mins) + '</td></tr>';
      }).join('');
    }).join('');
    var first = String(p.name || '').split(' ')[0];
    var btn = function (href, label, solid) { return '<a href="' + ttEsc(href) + '" style="display:inline-block;margin:4px;padding:12px 22px;border-radius:999px;' + (solid ? 'background:#D4AF37;background-image:linear-gradient(180deg,#F4DE9C,#C9A23A);color:#1C1A17' : 'border:1.5px solid #C9A23A;color:#7A5A14') + ';font:700 14px Arial,sans-serif;text-decoration:none">' + label + '</a>'; };
    return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media (max-width:600px){.ttc{padding:6px 4px!important;font-size:12px!important}.ttwrap{padding-left:10px!important;padding-right:10px!important}}</style></head>'
      + '<body style="margin:0;background:#F4EEDF;padding:20px 8px">'
      + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">'
      + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#FBF7EC;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(10,17,41,.15)">'
      + '<tr><td style="background:#0E1736;background-image:linear-gradient(135deg,#0A1129,#26366F);padding:24px 24px;text-align:center">'
      + '<div style="font:700 12px Arial,sans-serif;letter-spacing:.22em;color:#D4AF37">TAHFEEZ DARESSALAAM</div>'
      + '<div style="font:700 24px Georgia,serif;color:#F4DE9C;margin-top:8px">' + ttEsc(ttTitle(p)) + '</div>'
      + '<div style="font:14px Arial,sans-serif;color:#E9E2CF;margin-top:6px">' + ttEsc(ttPeriod(p)) + '</div></td></tr>'
      + '<tr><td class="ttwrap" style="padding:20px 24px 6px;font:15px/1.6 Arial,sans-serif;color:#1C1A17">Salaam ' + ttEsc(p.type === 'admin' ? '' : first) + ',<br>'
      + (n ? (p.type === 'student' ? 'Here is your timetable' : p.type === 'teacher' ? 'Here are the students allocated to you' : 'Here is the complete timetable') + ' for ' + ttEsc(ttPeriod(p)) + ' (' + n + ' lesson' + (n === 1 ? '' : 's') + ').' : 'There are no lessons for ' + ttEsc(ttPeriod(p)) + '.')
      + (p.type !== 'admin' ? '<br><b>' + ttEsc(p.name || '') + '</b>' : '') + '</td></tr>'
      + '<tr><td class="ttwrap" style="padding:8px 24px 4px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #E2D3A8">'
      + '<thead><tr>' + cols.map(function (c) { return '<th class="ttc" style="' + th + '">' + c + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table></td></tr>'
      + '<tr><td class="ttwrap" style="padding:10px 24px 0;font:13px/1.55 Arial,sans-serif;color:#4A4436">Times are in order from the earliest. Cancelled lessons are not shown. <b>Rescheduled</b> or <b>Updated</b> marks a lesson that changed.' + (o.pdf ? ' The timetable is also attached as a PDF, ready to print or share.' : '') + '</td></tr>'
      + '<tr><td align="center" style="padding:18px 18px 6px">' + (o.printUrl ? btn(o.printUrl, 'Print Timetable', true) : '') + (o.siteUrl ? btn(o.siteUrl, 'Open the portal', false) : '') + '</td></tr>'
      + '<tr><td style="padding:10px 24px 24px;text-align:center;font:12px/1.5 Arial,sans-serif;color:#8A8270">' + ttEsc(p.institute || 'Qism al Tahfeez Dar es Salaam') + ' · Tahfeez Daressalaam timetable</td></tr>'
      + '</table></td></tr></table></body></html>';
  }
  function ttText(p) {
    var g = ttGroups(p);
    return ttTitle(p) + '\n' + ttPeriod(p) + (p.type !== 'admin' ? '\n' + (p.name || '') : '') + '\n\n'
      + g.map(function (d) { return ttDay(d.date) + ' ' + ttDate(d.date) + '\n' + (d.rows.length ? d.rows.map(function (r) { var c = ttCells(p, r); return '  ' + c.from + ' – ' + c.to + ' (' + c.mins + ')  ' + c.who.join(' with ') + (c.change ? ' [' + c.change + ']' : ''); }).join('\n') : '  No lessons'); }).join('\n') + '\n';
  }
  // a full A4 page for printing or "Save as PDF": the headings repeat on every page and columns never get cut
  function ttPrintHtml(p, autoPrint) {
    var cols = ttCols(p.type), g = ttGroups(p);
    var body = g.map(function (d) {
      if (!d.rows.length) return '<tr class="empty"><td class="n"><b>' + ttEsc(ttDay(d.date)) + '</b></td><td class="n">' + ttEsc(ttDate(d.date)) + '</td><td colspan="' + (cols.length - 2) + '"><i>No lessons</i></td></tr>';
      return d.rows.map(function (r, i) { var c = ttCells(p, r); return '<tr' + (i === 0 ? ' class="first"' : '') + '><td class="n"><b>' + ttEsc(ttDay(d.date)) + '</b></td><td class="n">' + ttEsc(ttDate(d.date)) + '</td>' + c.who.map(function (w, k) { return '<td>' + ttEsc(w) + (k === c.who.length - 1 && c.change ? ' <span class="chg">' + ttEsc(c.change) + '</span>' : '') + '</td>'; }).join('') + '<td class="t">' + ttEsc(c.from) + '</td><td class="t">' + ttEsc(c.to) + '</td><td class="t">' + ttEsc(c.mins) + '</td></tr>'; }).join('');
    }).join('');
    var n = (p.rows || []).length, now = new Date();
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + ttEsc(ttTitle(p) + (p.type !== 'admin' ? ' – ' + (p.name || '') : '') + ' – ' + ttPeriod(p)) + '</title><style>'
      + '@page{size:A4 portrait;margin:14mm 12mm 16mm}*{box-sizing:border-box}body{margin:0;font:10.5pt/1.4 Arial,Helvetica,sans-serif;color:#111;background:#fff}'
      + '.wrap{max-width:186mm;margin:0 auto;padding:10px}.top{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;border-bottom:2.5px solid #A67C1E;padding-bottom:8px;margin-bottom:10px}'
      + '.brand{font:700 9pt Arial;letter-spacing:.2em;color:#A67C1E}.inst{font-size:9pt;color:#555}h1{font:700 17pt Georgia,serif;margin:4px 0 2px;color:#0E1736}.per{font-size:10.5pt;color:#333}'
      + '.who{text-align:right;font-size:10pt}.who b{display:block;font-size:12pt}'
      + 'table{width:100%;border-collapse:collapse;table-layout:auto}thead{display:table-header-group}tfoot{display:table-footer-group}tr{break-inside:avoid;page-break-inside:avoid}'
      + 'th,td{border:1px solid #8C8C8C;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:break-word}td.n{white-space:nowrap}th{background:#EFE6CC;font-size:9.5pt;white-space:nowrap}td.t{white-space:nowrap}'
      + 'tr.first td{border-top:1.6px solid #333}tr.empty td{color:#777;background:#FAFAFA}.chg{display:inline-block;font-size:8pt;font-weight:700;border:1px solid #A67C1E;color:#7A5A14;border-radius:8px;padding:0 5px}'
      + '.foot{margin-top:10px;font-size:8.5pt;color:#666;display:flex;flex-wrap:wrap;gap:4px 16px;justify-content:space-between}.tw{overflow-x:auto}.bar{margin:0 0 12px;display:flex;gap:8px}.bar button{font:700 12px Arial;padding:9px 16px;border-radius:999px;border:1px solid #A67C1E;background:#F4DE9C;cursor:pointer}'
      + '@media print{.bar{display:none}.wrap{padding:0;max-width:none}.tw{overflow:visible}}</style></head><body><div class="wrap">'
      + '<div class="bar"><button onclick="window.print()">Print or save as PDF</button><button onclick="window.close()">Close</button></div>'
      + '<div class="top"><div><div class="brand">TAHFEEZ DARESSALAAM</div><div class="inst">' + ttEsc(p.institute || 'Qism al Tahfeez Dar es Salaam') + '</div><h1>' + ttEsc(ttTitle(p)) + '</h1><div class="per">' + ttEsc(ttPeriod(p)) + '</div></div>'
      + (p.type !== 'admin' ? '<div class="who">' + (p.type === 'student' ? 'Student' : 'Teacher') + '<b>' + ttEsc(p.name || '') + '</b></div>' : '<div class="who">All teachers and students<b>' + n + ' lesson' + (n === 1 ? '' : 's') + '</b></div>') + '</div>'
      + '<div class="tw"><table><thead><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table></div>'
      + '<div class="foot"><span>Cancelled lessons are not shown. Times are in order from the earliest.</span><span>Printed ' + ttEsc(ttDate(now.toISOString().slice(0, 10))) + '</span></div>'
      + '</div>' + (autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)})<\/script>' : '') + '</body></html>';
  }

  MZ.ttEmailHtml = ttEmailHtml; MZ.ttSubject = ttSubject; MZ.ttPrintHtml = ttPrintHtml; MZ.ttText = ttText; MZ.ttTitle = ttTitle; MZ.ttPeriod = ttPeriod; MZ.tt12 = tt12;
  // open the printable A4 timetable (the browser's print dialog can also save it as a PDF)
  // the printable A4 timetable, shown on top of the page (works on iPhone too, also when the portal is added to the
  // home screen, where pop-up windows cannot be printed); "Print or save as PDF" opens the phone's print / share sheet
  MZ.ttPrint = function (p) {
    var old = document.getElementById('ttPrintOverlay'); if (old) old.remove();
    var full = ttPrintHtml(p, false), body = full.slice(full.indexOf('<div class="wrap">'), full.lastIndexOf('</body>'));
    body = body.replace('<button onclick="window.print()">', '<button type="button" data-tp="print">').replace('<button onclick="window.close()">', '<button type="button" data-tp="close">');
    var S = '#ttPrintOverlay ';
    var css = '#ttPrintOverlay{position:fixed;inset:0;z-index:2147483000;background:#fff;overflow-y:auto;-webkit-overflow-scrolling:touch;color:#111;font:10.5pt/1.4 Arial,Helvetica,sans-serif;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}'
      + S + '*{box-sizing:border-box}' + S + '.wrap{max-width:186mm;margin:0 auto;padding:12px}' + S + '.top{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;border-bottom:2.5px solid #A67C1E;padding-bottom:8px;margin-bottom:10px}'
      + S + '.brand{font:700 9pt Arial;letter-spacing:.2em;color:#A67C1E}' + S + '.inst{font-size:9pt;color:#555}' + S + 'h1{font:700 17pt Georgia,serif;margin:4px 0 2px;color:#0E1736;-webkit-text-fill-color:#0E1736;background:none;letter-spacing:0;text-shadow:none}' + S + '.per{font-size:10.5pt;color:#333}'
      + S + '.who{display:block;text-align:right;font-size:10pt}' + S + '.who>b{display:block!important;font-size:12pt}' + '@media screen and (max-width:600px){' + S + 'th,' + S + 'td{font-size:12px;padding:5px}' + S + 'h1{font-size:20px}}'
      + S + 'table{width:100%;border-collapse:collapse}' + S + 'thead{display:table-header-group}' + S + 'tr{break-inside:avoid;page-break-inside:avoid}'
      + S + 'th,' + S + 'td{border:1px solid #8C8C8C;padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:break-word;color:#111;background:#fff}' + S + 'td.n,' + S + 'td.t{white-space:nowrap}' + S + 'th{background:#EFE6CC;font-size:9.5pt;white-space:nowrap}'
      + S + 'tr.first td{border-top:1.6px solid #333}' + S + 'tr.empty td{color:#777;background:#FAFAFA}' + S + '.chg{display:inline-block;font-size:8pt;font-weight:700;border:1px solid #A67C1E;color:#7A5A14;border-radius:8px;padding:0 5px}'
      + S + '.foot{margin-top:10px;font-size:8.5pt;color:#666;display:flex;flex-wrap:wrap;gap:4px 16px;justify-content:space-between}' + S + '.tw{overflow-x:auto;-webkit-overflow-scrolling:touch}'
      + S + '.bar{position:sticky;top:0;z-index:2;margin:0 -12px 12px;padding:10px 12px;display:flex;gap:8px;background:rgba(255,255,255,.96);border-bottom:1px solid #eee}' + S + '.bar button{font:700 14px Arial;padding:11px 18px;border-radius:999px;border:1px solid #A67C1E;background:#F4DE9C;color:#1C1A17;cursor:pointer;-webkit-appearance:none}'
      + '@page{size:A4 portrait;margin:14mm 12mm 16mm}'
      + '@media print{html,body{background:#fff!important;height:auto!important;overflow:visible!important}body>*:not(#ttPrintOverlay){display:none!important}'
      + '#ttPrintOverlay{position:static!important;overflow:visible!important;padding:0!important}' + S + '.bar{display:none!important}' + S + '.wrap{padding:0;max-width:none}' + S + '.tw{overflow:visible}}';
    var box = document.createElement('div');
    box.id = 'ttPrintOverlay'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Printable timetable');
    box.innerHTML = '<style>' + css + '</style>' + body;
    var title = document.title, close = function () { box.remove(); document.title = title; document.documentElement.style.overflow = ''; document.removeEventListener('keydown', esc); };
    var esc = function (e) { if (e.key === 'Escape') close(); };
    box.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-tp]'); if (!b) return;
      if (b.getAttribute('data-tp') === 'close') close(); else window.print();
    });
    document.addEventListener('keydown', esc);
    document.body.appendChild(box);
    document.documentElement.style.overflow = 'hidden';
    // the PDF a phone saves is named after the page title
    document.title = ttTitle(p) + (p.type !== 'admin' ? ' - ' + (p.name || '') : '') + ' - ' + ttPeriod(p);
    var pb = box.querySelector('[data-tp=print]'); if (pb) pb.focus();
    return true;
  };
  // a timetable built in the browser from lessons already loaded (for printing in the portals)
  MZ.ttFromLessons = function (type, name, from, to, list) {
    return { type: type, name: name, from: from, to: to, institute: (MZ.settingsName || ''), rows: (list || []).filter(function (x) { return x.status === 'scheduled' && x.slot_date >= from && x.slot_date <= to; })
      .map(function (x) { var a = String(x.start_time).slice(0, 5), b = String(x.end_time).slice(0, 5); return { date: x.slot_date, from: a, to: b, mins: (+b.slice(0, 2) * 60 + +b.slice(3, 5)) - (+a.slice(0, 2) * 60 + +a.slice(3, 5)), student: x.student_name || '', teacher: x.teacher_name || '', note: x.note || null, change: ['rescheduled', 'updated', 'reassigned'].indexOf(x.change_kind) >= 0 ? x.change_kind : null }; }) };
  };
  MZ.weekOf = function (d) { var x = new Date(d + 'T12:00:00'), k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); var a = x.toISOString().slice(0, 10); x.setDate(x.getDate() + 6); return { from: a, to: x.toISOString().slice(0, 10) }; };
  var BADGE_GLYPH = {
    star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.9 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z"/>',
    hifz: '<path d="M4 5.5C6.5 4.5 9 4.6 12 6c3-1.4 5.5-1.5 8-.5V19c-2.5-1-5-.9-8 .5-3-1.4-5.5-1.5-8-.5z"/><path d="M12 6v13.5"/>',
    tajweed: '<path d="M5 10v4M9 7v10M13 4v16M17 8v8M21 11v2"/>',
    murajaat: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5"/><path d="M4 20v-4.5h4.5"/>',
    effort: '<path d="M13 2L4.5 13.5H12L11 22l8.5-11.5H12z"/>',
    punctual: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
    akhlaq: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
    helper: '<path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11M10 10V5a1.5 1.5 0 0 1 3 0v5M13 10V6a1.5 1.5 0 0 1 3 0v6M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6.5 6.5 0 0 1-5.3-2.8L4 15a1.6 1.6 0 0 1 2.6-1.8L7 14"/>',
    improve: '<path d="M4 18l6-6 4 4 6-8"/><path d="M15 8h5v5"/>',
    custom: '<path d="M12 3l2 4.5 4.8.5-3.6 3.3 1 4.7L12 13.6 7.8 16l1-4.7L5.2 8l4.8-.5z"/><path d="M8 17l-1.5 4L12 19l5.5 2L16 17"/>'
  };
  MZ.badgeMedal = function (k, size) {
    var d = MZ.badgeDef(k), z = size || 56;
    return '<span class="medal" style="--mc:' + d[3] + ';width:' + z + 'px;height:' + z + 'px"><svg viewBox="0 0 24 24" width="' + Math.round(z * 0.5) + '" height="' + Math.round(z * 0.5) + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (BADGE_GLYPH[d[0]] || BADGE_GLYPH.custom) + '</svg></span>';
  };
  /* Mastership badge: earned automatically, one for every 100 keys */
  MZ.MASTER_EVERY = 100;
  MZ.mastery = function (keys) { return Math.floor((+keys || 0) / MZ.MASTER_EVERY); };
  var MASTER_SVG = '<svg viewBox="0 0 24 24" width="SZ" height="SZ" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17h14l1.5-9-5 3.5L12 5l-3.5 6.5-5-3.5z"/><path d="M5 20h14"/></svg>';
  MZ.masteryChip = function (keys, opt) {
    var n = MZ.mastery(keys); opt = opt || {};
    if (!n) return opt.zero ? '<span class="mastery none" title="Mastership badge every ' + MZ.MASTER_EVERY + ' keys">' + MASTER_SVG.replace(/SZ/g, '14') + (MZ.MASTER_EVERY - (+keys || 0) % MZ.MASTER_EVERY) + ' keys to the first</span>' : '';
    return '<span class="mastery" title="Mastership badge, ' + n + ' earned (one for every ' + MZ.MASTER_EVERY + ' keys)">' + MASTER_SVG.replace(/SZ/g, '14') + (opt.short ? '×' + n : n + ' Mastership' + (n === 1 ? '' : 's')) + '</span>';
  };
  MZ.masteryMedal = function (size) { var z = size || 56; return '<span class="medal master" style="width:' + z + 'px;height:' + z + 'px">' + MASTER_SVG.replace(/SZ/g, String(Math.round(z * 0.52))) + '</span>'; };
  MZ.PAY_DETAILS = '*Account Number:* 000100433890001\n*Account Name:* Al Madrasa Tus Saifiya Tul Burhaniyah (Habib African Bank)\nPay with Airtel Money, Selcom, M-Pesa or Yas → “Payment to Other Banks”, then send the receipt to +255 738 468 484.';
  MZ.normSettings = function (s) {
    s = Object.assign({}, s || {});
    var ip = s.ikhtibar_pages; if (typeof ip === 'string') ip = ip.replace(/[{}]/g, '').split(',');
    s.ikhtibar_pages = (Array.isArray(ip) ? ip : [582, 542, 502, 101, 201, 301, 401, 501]).map(Number).filter(function (n) { return n >= 1 && n <= 604; });
    s.ikhtibar_alert_pages = +s.ikhtibar_alert_pages || 20;
    s.elearning_url = s.elearning_url || '';
    s.welcome_subject = s.welcome_subject || 'Welcome to Tahfeez Daressalaam: complete your registration';
    s.welcome_body = s.welcome_body || MZ.DEFAULT_WELCOME;
    s.hafiz_days_per_year = +s.hafiz_days_per_year || 150;
    s.registration_fee = Number(s.registration_fee || 0);
    if (!s.institute_name) s.institute_name = 'Qism al Tahfeez Dar es Salaam';
    if (!s.currency) s.currency = 'TSh';
    s.due_day = +s.due_day || 5;
    s.keys_jadeed = s.keys_jadeed == null ? 3 : +s.keys_jadeed;
    s.keys_ikhtibar = s.keys_ikhtibar == null ? 15 : +s.keys_ikhtibar;
    s.keys_goal = s.keys_goal == null ? 10 : +s.keys_goal;
    s.reward_every = +s.reward_every || 100;
    if (!s.reminder_template) s.reminder_template = 'Dear {name}, this is a kind reminder from {institute}: fees for {months} are not paid yet. Balance due: {balance}. Thank you.';
    return s;
  };
  MZ.QURAN_PAGES = 604;
  MZ.TEACHER_CRITERIA = [['punctuality', 'Efficiency – Punctuality'], ['concentration', 'Efficiency – Concentration'], ['listening', 'Listening skills'],
    ['teaching', 'Teaching skills'], ['coaching', 'Coaching skills'], ['attitude', 'Attitude'], ['ownership', 'Ownership']];
  // what each rating means (shown to whoever gives the rating, and in HR)
  MZ.TEACHER_CRITERIA_DESC = {
    punctuality: 'Does the teacher arrive on time for lessons?',
    concentration: 'Does the teacher remain focused during the lesson without unnecessary distractions, such as using a mobile phone or engaging in unrelated activities?',
    listening: 'Does the teacher listen attentively to the student and correct their Erab, Ahkaam and Makharij when required?',
    teaching: 'Does the teacher provide useful guidance and practical tips to improve Hifz, such as managing time effectively and memorizing correctly?',
    coaching: 'Does the teacher motivate, encourage, and guide the student to complete their Hifz goals?',
    attitude: 'How does the teacher interact with the student? Is the teacher friendly, patient, respectful, and supportive, or does the teacher display a negative or angry attitude?',
    ownership: 'Does the teacher take responsibility for the student\'s progress and go the extra mile to support their Hifz journey?'
  };
  MZ.scoreAvg = function (sc) { var v = MZ.TEACHER_CRITERIA.map(function (c) { return +((sc || {})[c[0]]) || 0; }).filter(function (x) { return x > 0; }); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : 0; };
  MZ.EXPENSE_CATEGORIES = ['Electricity (LUKU)', 'Snacks', 'Stationery', 'Travel', 'Internet', 'Water', 'Maintenance', 'Housing & Cleaning', 'Food Pantry', 'Mawaid', 'Awards & Gifts', 'Rehlat ilmi / Tafreeh', 'Workshops / Seminars', 'Sports Activities', 'Training', 'Other'];
  MZ.INCOME_CATEGORIES = ['Food sponsorship', 'Electricity sponsorship', 'Mawaid sponsorship', 'Donation', 'Event sponsorship', 'Other income'];
  function normalizeFinance(r) { return { id: r.id, kind: r.kind, category: r.category, amount: Number(r.amount || 0), entry_date: r.entry_date, party: r.party || '', note: r.note || '', created_at: r.created_at, account: r.account === 'bank' ? 'bank' : 'cash', to_account: r.to_account || null, created_by: r.created_by || null }; }
  /* Which book a fee lands in: "Cash" → cash, anything else (bank, transfer, mobile money, cheque) → bank. */
  MZ.accountOf = function (method) { return /cash/i.test(String(method || 'Cash')) ? 'cash' : 'bank'; };
  MZ.ACCOUNT_NAME = { cash: 'Cash', bank: 'Bank' };
  function normalizeSchedule(r) {
    return { id: r.id, student_id: r.student_id, student_name: r.student_name || '', teacher_id: r.teacher_id, teacher_user: r.teacher_user || null, teacher_name: r.teacher_name || '', slot_date: r.slot_date,
      start_time: String(r.start_time || '').slice(0, 5), end_time: String(r.end_time || '').slice(0, 5), note: r.note || '', status: r.status || 'scheduled',
      created_at: r.created_at, updated_at: r.updated_at, student_seen_at: r.student_seen_at || null, teacher_seen_at: r.teacher_seen_at || null,
      handed_from: r.handed_from || '', handed_by: r.handed_by || null, handed_at: r.handed_at || null, series_id: r.series_id || null, change_kind: r.change_kind || null };
  }
  MZ.normalizeSchedule = normalizeSchedule;
  function normalizeHR(r) { return { id: r.id, kind: r.kind, data: r.data || {}, created_at: r.created_at, updated_at: r.updated_at }; }
  /* Monthly fee after discount. */
  MZ.effFee = function (s) {
    var fee = Number(s.monthly_fee || 0), v = Number(s.discount_value || 0);
    if (!v) return fee;
    return Math.max(0, Math.round((s.discount_type === 'percent' ? fee * (1 - Math.min(100, v) / 100) : fee - v) * 100) / 100);
  };
  MZ.discountLabel = function (s, cur) { return !s.discount_value ? '' : s.discount_type === 'percent' ? s.discount_value + '% off' : MZ.money(s.discount_value, cur) + ' off'; };
  /* Total due, paid and balance for one student between two months (inclusive). */
  /* Which way a student moves through the Qur'an: +1 forwards (page 1 → 604), -1 backwards (An-Nas → Al-Fatiha).
     Uses the latest month report when there is one, else compares their page with how much they have memorised. */
  MZ.direction = function (s, prog) {
    var rows = (prog || []).filter(function (r) { return r.student_id === s.id || !r.student_id; }).slice().sort(function (a, b) { return a.month < b.month ? 1 : -1; });
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i].start_pos, b = rows[i].end_pos || rows[i].goal_pos;
      if (a && b && a !== b) return b < a ? -1 : 1;
    }
    if (s.cur_pos) return Math.abs(s.cur_pos + (s.pages || 0) - 605) < Math.abs(s.cur_pos - (s.pages || 0)) ? -1 : 1;
    return 1;
  };
  /* The next ikhtibar page within the alert distance (default 20 pages) ahead of the student, or null. */
  MZ.ikhAhead = function (s, settings, prog) {
    if (!s || !s.cur_pos || !settings) return null;
    var sd = MZ.hifzDir(s), dir = sd ? 1 : MZ.direction(s, prog), lim = settings.ikhtibar_alert_pages || 20, best = null;
    (settings.ikhtibar_pages || []).forEach(function (pg) {
      // with a saved direction, "ahead" is counted along the student's own sequence (it passes the turn to page 1)
      var away = sd ? MZ.posToCount(pg, sd) - MZ.posToCount(s.cur_pos, sd) : (pg - s.cur_pos) * dir;
      if (away >= 0 && away <= lim && (!best || away < best.away)) best = { page: pg, away: away, dir: dir };
    });
    return best;
  };
  /* When will the student finish the Qur'an?  1 page and ½ page a day over the working days of a year,
     plus the pace of the monthly goal (takhteet) set by the admin. */
  MZ.hafizPredict = function (s, settings, monthlyGoal) {
    var left = Math.max(0, 604 - (s.pages || 0)), days = (settings && settings.hafiz_days_per_year) || 150, now = new Date();
    var at = function (years) { var d = new Date(now.getTime() + years * 365.25 * 864e5); return d.toISOString().slice(0, 7); };
    var span = function (years) { var m = Math.max(0, Math.round(years * 12)); return { years: Math.floor(m / 12), months: m % 12, total: m }; };
    var one = left / days, half = left / (days / 2), out = { left: left, days: days, one: { years: one, span: span(one), month: at(one) }, half: { years: half, span: span(half), month: at(half) } };
    if (monthlyGoal > 0) {
      var mLeft = 12 - now.getMonth(); // months left this year including this one
      var tm = left / monthlyGoal;
      out.plan = { perMonth: monthlyGoal, perYear: monthlyGoal * 12, yearEnd: Math.min(604, (s.pages || 0) + monthlyGoal * mLeft), monthsLeft: mLeft, span: span(tm / 12), month: at(tm / 12) };
    }
    return out;
  };
  MZ.spanLabel = function (sp) {
    if (!sp.total) return 'this month';
    var y = sp.years ? sp.years + ' year' + (sp.years === 1 ? '' : 's') : '', m = sp.months ? sp.months + ' month' + (sp.months === 1 ? '' : 's') : '';
    return [y, m].filter(Boolean).join(' ');
  };
  /* Monday-to-Sunday week that contains a date (YYYY-MM-DD). */
  MZ.weekOf = function (d) {
    var t = new Date((d || MZ.today()) + 'T12:00:00'), wd = (t.getDay() + 6) % 7;
    var a = new Date(t.getTime() - wd * 864e5), b = new Date(a.getTime() + 6 * 864e5);
    var iso = function (x) { return x.getFullYear() + '-' + MZ.pad(x.getMonth() + 1) + '-' + MZ.pad(x.getDate()); };
    return { from: iso(a), to: iso(b), label: MZ.dateShort(iso(a)) + ' to ' + MZ.dateShort(iso(b)) + ' ' + b.getFullYear() };
  };
  MZ.waBold = function (t) { return MZ.esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>'); };
  /* Breaks: months a student is away (e.g. travelled home). No fee is due for them. */
  MZ.breakAt = function (s, m) {
    var l = (s && s.breaks) || [];
    for (var i = 0; i < l.length; i++) if (l[i].from <= m && (!l[i].to || m <= l[i].to)) return l[i];
    return null;
  };
  MZ.onLeave = function (s, m) { return !!MZ.breakAt(s, m); };
  MZ.breakLabel = function (b) { return MZ.monthLabel(b.from) + (b.to ? (b.to === b.from ? '' : ' to ' + MZ.monthLabel(b.to)) : ' onwards'); };
  /* All-time totals for one student: approved money only, plus what is waiting. */
  MZ.paidTotals = function (s, pays) {
    var out = { total: 0, months: 0, pending: 0, pendingN: 0, first: null, last: null, byMonth: {} };
    (pays || []).forEach(function (p) {
      if (p.student_id !== s.id) return;
      if (p.status === 'pending') { out.pending += p.amount; out.pendingN++; return; }
      out.total += p.amount; out.byMonth[p.month] = (out.byMonth[p.month] || 0) + p.amount;
      if (!out.first || p.month < out.first) out.first = p.month;
      if (!out.last || p.month > out.last) out.last = p.month;
    });
    out.months = Object.keys(out.byMonth).length;
    return out;
  };
  MZ.feeSummary = function (s, pays, fromM, toM) {
    var start = s.start_month || '0000-00', end = toM || MZ.thisMonth();
    if (s.disabled_at) { var dm = String(s.disabled_at).slice(0, 7); if (dm < end) end = dm; }
    var from = fromM && fromM > start ? fromM : start, due = MZ.effFee(s), out = { months: 0, total: 0, paid: 0, balance: 0, unpaid: [], discount: 0, leave: [] };
    var byMonth = {}; (pays || []).forEach(function (p) { if (p.student_id === s.id) byMonth[p.month] = (byMonth[p.month] || 0) + p.amount; });
    for (var m = from; m <= end; m = MZ.addMonths(m, 1)) {
      if (!byMonth[m] && MZ.onLeave(s, m)) { out.leave.push(m); if (out.leave.length > 600) break; continue; }
      out.months++; out.total += due; out.discount += Number(s.monthly_fee || 0) - due;
      var paid = byMonth[m] || 0; out.paid += paid;
      if (paid + 0.001 < due) { out.unpaid.push(m); out.balance += due - paid; }  // each month stands alone; extra paid in one month does not cover another
      if (out.months > 600) break;
    }
    out.balance = Math.round(out.balance * 100) / 100;
    return out;
  };
  MZ.fillReminder = function (tpl, s, sum, settings) {
    return String(tpl || '').replace(/\{name\}/g, MZ.firstName(s.full_name)).replace(/\{fullname\}/g, s.full_name)
      .replace(/\{institute\}/g, settings.institute_name).replace(/\{balance\}/g, MZ.money(sum.balance, settings.currency))
      .replace(/\{months\}/g, sum.unpaid.length ? sum.unpaid.map(MZ.monthShort).join(', ') + (sum.unpaid.length > 1 ? ' ' + sum.unpaid[sum.unpaid.length - 1].slice(0, 4) : ' ' + sum.unpaid[0].slice(0, 4)) : 'part payment');
  };
  MZ.signed = function (n) { n = +n || 0; return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n); };
  MZ.juzOf = function (pages) { return pages <= 0 ? 0 : Math.min(30, Math.ceil(pages / 20.13)); };
  MZ.rewardLevel = function (keys, s) { return Math.floor((+keys || 0) / ((s && s.reward_every) || 100)); };
  function normalizeProgress(r) {
    return { student_id: r.student_id, month: r.month, goal: +r.goal || 0, jadeed: +r.jadeed || 0, ikhtibar: +r.ikhtibar || 0,
      goal_awarded: !!r.goal_awarded, pages_end: r.pages_end == null ? null : +r.pages_end,
      start_page: r.start_page == null ? null : +r.start_page, goal_page: r.goal_page == null ? null : +r.goal_page,
      ajza_improve: r.ajza_improve || '', ahkaam: r.ahkaam || '', murajaat: r.murajaat == null ? null : +r.murajaat,
      dawrat: r.dawrat == null ? null : +r.dawrat, report_note: r.report_note || '',
      start_surah: r.start_surah || null, start_pos: r.start_pos || null, goal_surah: r.goal_surah || null, goal_pos: r.goal_pos || null, end_surah: r.end_surah || null, end_pos: r.end_pos || null };
  }
  MZ.hasReport = function (r) { return !!(r && (r.ajza_improve || r.ahkaam || r.murajaat != null || r.dawrat != null || r.report_note)); };
  /* Goal page for a month: the page set, or start + "N pages" for older goals. */
  MZ.goalPageOf = function (r) { if (!r) return null; if (r.goal_page) return r.goal_page; if (r.goal > 0) return Math.min(604, (r.start_page != null ? r.start_page : Math.max(0, (r.pages_end || 0) - (r.jadeed || 0))) + r.goal); return null; };
  MZ.startPageOf = function (r) { if (!r) return null; return r.start_page != null ? r.start_page : Math.max(0, (r.pages_end || 0) - (r.jadeed || 0)); };
  MZ.ajzaList = function (txt) { return String(txt || '').split(/[^0-9]+/).map(Number).filter(function (n) { return n >= 1 && n <= 30; }).filter(function (n, i, a) { return a.indexOf(n) === i; }).sort(function (a, b) { return a - b; }); };
  MZ.fileKind = function (name, mime) {
    var n = String(name || '').toLowerCase(), m = String(mime || '').toLowerCase();
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n) || m.indexOf('image/') === 0) return 'image';
    if (/\.pdf$/.test(n) || m === 'application/pdf') return 'pdf';
    if (/\.docx?$/.test(n) || m.indexOf('wordprocessing') >= 0 || m === 'application/msword') return 'word';
    if (/\.(pptx?|ppsx?|key|odp)$/.test(n) || m.indexOf('presentation') >= 0 || m.indexOf('powerpoint') >= 0) return 'slides';
    if (/\.(xlsx?|csv|ods)$/.test(n) || m.indexOf('spreadsheet') >= 0 || m.indexOf('excel') >= 0) return 'sheet';
    if (/\.(mp3|m4a|wav|ogg|aac|opus)$/.test(n) || m.indexOf('audio/') === 0) return 'audio';
    if (/\.(mp4|mov|webm|m4v|3gp)$/.test(n) || m.indexOf('video/') === 0) return 'video';
    return 'file';
  };
  MZ.fileSize = function (b) { b = +b || 0; return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? Math.round(b / 1024) + ' KB' : b ? b + ' B' : ''; };
  MZ.FILE_LABEL = { image: 'Image', pdf: 'PDF', word: 'Word', slides: 'PowerPoint', sheet: 'Excel', audio: 'Audio', video: 'Video', file: 'File' };
  MZ.fileExt = function (name) { var m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || '')); return m ? m[1].toUpperCase() : 'FILE'; };
  /* A typed message: paragraphs, links, Arabic right-to-left. */
  MZ.textHTML = function (t) {
    return String(t || '').trim().split(/\n{2,}/).map(function (para) {
      var h = esc(para).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      return '<p dir="auto"' + (MZ.hasArabic(para) ? ' lang="ar"' : '') + '>' + h + '</p>';
    }).join('');
  };
  /* Body of a notice: typed message, converted Word text, and the attached file. */
  MZ.noticeHTML = function (n) {
    var h = '';
    if (n.body) h += '<div class="doc msg">' + MZ.textHTML(n.body) + '</div>';
    if (n.html) h += '<div class="doc">' + MZ.sanitizeHTML(n.html) + '</div>';
    if (n.file_name) {
      var k = MZ.fileKind(n.file_name, n.mime);
      h += '<div class="nfile" data-nfile="' + n.id + '" data-kind="' + k + '"><span class="fbadge k-' + k + '">' + esc(MZ.fileExt(n.file_name)) + '</span>'
        + '<span class="pname"><b>' + esc(n.file_name) + '</b><small>' + esc(MZ.FILE_LABEL[k] + (n.file_size ? ' · ' + MZ.fileSize(n.file_size) : '')) + '</small></span>'
        + '<span class="btnrow">' + (k === 'pdf' || k === 'image' ? '<a class="btn sm gold nopen" target="_blank" rel="noopener" hidden>Open</a>' : '')
        + '<button class="btn sm" type="button" data-act="downloadNotice" data-id="' + n.id + '">Download</button></span>'
        + '<div class="npreview"></div></div>';
    }
    return h || '<p class="muted">This notice is empty.</p>';
  };
  /* After the notice is on screen: load images inline and make PDFs open in a new tab. */
  MZ.hydrateNotice = function (api, n, root) {
    var box = (root || document).querySelector('[data-nfile="' + n.id + '"]'); if (!box || !n.file_name) return;
    var k = box.dataset.kind; if (k !== 'image' && k !== 'pdf' && k !== 'audio' && k !== 'video') return;
    if (n.file_size && n.file_size > 25 * 1048576) return;
    api.downloadNotice(n).then(function (blob) {
      if (!box.isConnected) return;
      var type = n.mime || (k === 'pdf' ? 'application/pdf' : blob.type);
      var url = URL.createObjectURL(type && blob.type !== type ? new Blob([blob], { type: type }) : blob);
      var a = box.querySelector('.nopen'); if (a) { a.href = url; a.hidden = false; }
      var pv = box.querySelector('.npreview');
      if (k === 'image') pv.innerHTML = '<img src="' + url + '" alt="' + esc(n.title) + '">';
      else if (k === 'audio') pv.innerHTML = '<audio controls src="' + url + '"></audio>';
      else if (k === 'video') pv.innerHTML = '<video controls playsinline src="' + url + '"></video>';
    }).catch(function () {});
  };
  MZ.downloadNotice = function (api, n) {
    return api.downloadNotice(n).then(function (b) { return MZ.saveFile(n.file_name || n.title, b); }).catch(function (e) { MZ.toast(e.message); });
  };
  function normalizeIkhtibar(r) { return { id: r.id, student_id: r.student_id, exam_date: r.exam_date, title: r.title || 'Ikhtibar', status: r.status || 'scheduled', note: r.note || '', key_event_id: r.key_event_id || null, quick: !!r.quick, created_at: r.created_at }; }
  /* Keep only safe tags from a converted Word file. */
  MZ.sanitizeHTML = function (html) {
    var doc = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,textarea,select').forEach(function (n) { n.remove(); });
    doc.querySelectorAll('*').forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        var name = a.name.toLowerCase(), v = String(a.value || '').trim().toLowerCase();
        if (name.indexOf('on') === 0 || name === 'style' || name === 'class' || name === 'id') n.removeAttribute(a.name);
        else if ((name === 'href' || name === 'src') && !(v.indexOf('data:image/') === 0 || v.indexOf('https:') === 0 || v.indexOf('http:') === 0 || v.indexOf('#') === 0 || v.indexOf('mailto:') === 0)) n.removeAttribute(a.name);
      });
      if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener'); }
    });
    return doc.body.firstChild.innerHTML;
  };
  function normalizePayment(r) {
    return { id: r.id, receipt_no: r.receipt_no, student_id: r.student_id, month: r.month, amount: Number(r.amount || 0), method: r.method,
      paid_on: r.paid_on, note: r.note || '', created_at: r.created_at, seen_at: r.seen_at || null,
      status: r.status === 'pending' ? 'pending' : 'approved', created_by: r.created_by || null, approved_at: r.approved_at || null,
      proof_path: r.proof_path || null, proof_name: r.proof_name || null, proof_mime: r.proof_mime || null, proof_data: r.proof_data || null };
  }

  /* ---------------------------------------------------------- live */
  function liveApi(portal) {
    var sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { storageKey: 'mz-' + portal, persistSession: true, autoRefreshToken: true }
    });
    var uid = null, staffRole = null;
    function q(p) { return p.then(function (r) { if (r.error) fail(r.error); return r.data; }); }
    function emailOf(u) { return String(u || '').trim().toLowerCase() + '@' + (CFG.LOGIN_DOMAIN || 'mahadalzahra.app'); }

    function checkRole() {
      // staff_role() is 'admin', 'teacher' or 'accounts' for institute accounts, empty for students
      return q(sb.rpc('staff_role')).catch(function () { return q(sb.rpc('is_admin')).then(function (a) { return a ? 'admin' : null; }); }).then(function (role) {
        staffRole = role || null;
        if (portal === 'institute') {
          if (!role) return sb.auth.signOut().then(function () { fail('This is a student account. Please sign in on the Student portal.'); });
          return { role: 'institute', staff: role };
        }
        if (role) return sb.auth.signOut().then(function () { fail('This is an institute account. Please sign in on the Institute portal.'); });
        return { role: 'student' };
      });
    }
    return {
      mode: 'live',
      restore: function () {
        return sb.auth.getSession().then(function (r) {
          var s = r.data && r.data.session; if (!s) return null;
          uid = s.user.id;
          return checkRole().catch(function () { return null; });
        });
      },
      signIn: function (username, password) {
        return sb.auth.signInWithPassword({ email: emailOf(username), password: password }).then(function (r) {
          if (r.error) fail(r.error); uid = r.data.user.id; return checkRole();
        }, fail);
      },
      signOut: function () { return sb.auth.signOut(); },
      setupNeeded: function () { return q(sb.rpc('institute_setup_needed')).catch(function () { return false; }); },
      createFirstAdmin: function (username, password) {
        var self = this;
        return q(sb.rpc('setup_first_admin', { p_username: username, p_password: password })).then(function () { return self.signIn(username, password); });
      },
      myId: function () { return uid; },
      myRole: function () { return staffRole || 'admin'; },
      myUid: function () { return uid; },
      listStaff: function () { return q(sb.from('admins').select('user_id,username,role,created_at').order('created_at')); },
      addStaff: function (u, p, role) { return q(sb.rpc('add_staff', { p_username: u, p_password: p, p_role: role || 'admin' })); },
      setStaffRole: function (id, role) { return q(sb.rpc('set_staff_role', { p_user: id, p_role: role })); },
      removeStaff: function (id) { return q(sb.rpc('remove_staff', { p_user: id })); },
      resetStaffPassword: function (id, p) { return q(sb.rpc('reset_staff_password', { p_user: id, p_password: p })); },
      teacherLoginSettings: function () { return q(sb.rpc('teacher_login_settings')); },
      saveTeacherLoginSettings: function (auto, pw) { return q(sb.rpc('save_teacher_login_settings', { p_auto: !!auto, p_password: pw })); },
      createTeacherLogin: function (hrId, username) { return q(sb.rpc('create_teacher_login', { p_hr_id: +hrId, p_username: username || null })); },
      myMustChangePw: function () { return q(sb.rpc('my_must_change_pw')); },
      changeStaffPassword: function (pw) { return q(sb.rpc('change_my_staff_password', { p_password: pw })); },
      getSettings: function () { return q(sb.from('settings').select('*').eq('id', 1).single()).then(MZ.normSettings); },
      saveSettings: function (patch) { return q(sb.from('settings').update(patch).eq('id', 1).select().single()).then(MZ.normSettings); },
      listStudents: function () {
        if (staffRole === 'teacher') return q(sb.rpc('staff_students')).then(function (d) { return (d || []).map(normalizeStudent); });
        return q(sb.from('students').select('*').order('full_name')).then(function (d) { return d.map(normalizeStudent); });
      },
      createStudent: function (o) {
        return q(sb.rpc('create_student', { p_username: o.username, p_password: o.password, p_full_name: o.full_name, p_phone: o.phone || null,
          p_monthly_fee: Number(o.monthly_fee) || 0, p_start_month: o.start_month || MZ.thisMonth(), p_juz: +o.juz || 0 }));
      },
      updateStudent: function (id, patch) {
        var self = this, keys = Object.keys(patch || {});
        if (staffRole === 'teacher') {
          if (keys.some(function (k) { return k !== 'cur_surah' && k !== 'cur_pos'; })) return Promise.reject(new Error('Teachers can update hifz only.'));
          return q(sb.rpc('set_position', { p_student: id, p_surah: patch.cur_surah || null, p_pos: patch.cur_pos || null })).then(function () { return self.listStudents(); }).then(function (l) { return l.find(function (x) { return x.id === id; }); });
        }
        if (staffRole === 'accounts') {
          return q(sb.rpc('update_student_fees', { p_student: id, p_patch: patch })).then(function () { return q(sb.from('students').select('*').eq('id', id).single()); }).then(normalizeStudent);
        }
        return q(sb.from('students').update(patch).eq('id', id).select().single()).then(normalizeStudent);
      },
      resetPassword: function (id, pw) { return q(sb.rpc('reset_student_password', { p_student: id, p_password: pw })); },
      deleteStudent: function (id) { return q(sb.rpc('delete_student', { p_student: id })); },
      listPayments: function (f) {
        var b = sb.from('payments').select('*');
        if (f && f.month) b = b.eq('month', f.month);
        if (f && f.year) b = b.gte('month', f.year + '-01').lte('month', f.year + '-12');
        if (f && f.studentId) b = b.eq('student_id', f.studentId);
        if (f && f.status) b = b.eq('status', f.status);
        return q(b.order('created_at', { ascending: false }).limit(5000)).then(function (d) { return d.map(normalizePayment); });
      },
      recordPayment: function (p) {
        return q(sb.from('payments').insert({ student_id: p.student_id, month: p.month, amount: Number(p.amount) || 0, method: p.method,
          paid_on: p.paid_on, note: p.note || null }).select().single()).then(normalizePayment);
      },
      deletePayment: function (id) { return q(sb.from('payments').delete().eq('id', id)); },
      approvePayments: function (ids) { return q(sb.rpc('approve_payments', { p_ids: ids })); },
      me: function () { return q(sb.from('students').select('*').eq('id', uid).single()).then(normalizeStudent); },
      myPayments: function () { return q(sb.from('payments').select('*').eq('student_id', uid).order('month', { ascending: false })).then(function (d) { return d.map(normalizePayment); }); },
      markSeen: function (id) { return q(sb.rpc('mark_receipt_seen', { p_payment: id })); },
      changePassword: function (pw) { return sb.auth.updateUser({ password: pw }).then(function (r) { if (r.error) fail(r.error); }); },
      watchPayments: function (cb) {
        var ch = sb.channel('payments-' + portal + '-' + Date.now())
          .on('postgres_changes', portal === 'student' && uid
            ? { event: '*', schema: 'public', table: 'payments', filter: 'student_id=eq.' + uid }
            : { event: '*', schema: 'public', table: 'payments' }, function () { cb(); })
          .subscribe();
        var onVis = function () { if (document.visibilityState === 'visible') cb(); };
        document.addEventListener('visibilitychange', onVis);
        var t = setInterval(cb, 60000);
        return function () { sb.removeChannel(ch); document.removeEventListener('visibilitychange', onVis); clearInterval(t); };
      },
      /* keys & progress */
      listProgress: function (f) {
        var b = sb.from('progress_months').select('*');
        if (f && f.month) b = b.eq('month', f.month);
        if (f && f.studentId) b = b.eq('student_id', f.studentId);
        return q(b.order('month').limit(5000)).then(function (d) { return d.map(normalizeProgress); });
      },
      myProgress: function () { return q(sb.from('progress_months').select('*').eq('student_id', uid).order('month')).then(function (d) { return d.map(normalizeProgress); }); },
      listKeyEvents: function (studentId, limit) { return q(sb.from('key_events').select('*').eq('student_id', studentId).order('created_at', { ascending: false }).limit(limit || 50)); },
      myKeyEvents: function () { return q(sb.from('key_events').select('*').eq('student_id', uid).order('created_at', { ascending: false }).limit(40)); },
      recordJadeed: function (sid, month, pages) { return q(sb.rpc('record_jadeed', { p_student: sid, p_month: month, p_pages: pages || 1 })); },
      recordIkhtibar: function (sid, month, note) { return q(sb.rpc('record_ikhtibar', { p_student: sid, p_month: month, p_note: note || null })); },
      setGoal: function (sid, month, goal) { return q(sb.rpc('set_month_goal', { p_student: sid || null, p_month: month, p_goal: +goal || 0 })); },
      setPages: function (sid, month, pages) { return q(sb.rpc('set_pages', { p_student: sid, p_month: month, p_pages: +pages || 0 })); },
      adminCorrectGoal: function (sid, month, o) { return q(sb.rpc('admin_correct_goal', { p_student: sid, p_month: month, p_start_pos: o.start_pos || null, p_goal: o.goal == null || o.goal === '' ? null : +o.goal, p_reached_pos: o.reached_pos || null, p_dir: o.dir || null, p_note: o.note || null })); },
      adminDeleteGoal: function (sid, month, note) { return q(sb.rpc('admin_delete_goal', { p_student: sid, p_month: month, p_note: note || null })); },
      adminDeleteStart: function (sid, month, note) { return q(sb.rpc('admin_delete_start', { p_student: sid, p_month: month, p_note: note || null })); },
      adminDeleteEntry: function (eventId, note) { return q(sb.rpc('admin_delete_entry', { p_event: +eventId, p_note: note || null })); },
      listHifzAudit: function (sid) { return q(sb.from('hifz_audit').select('*').eq('student_id', sid).order('created_at', { ascending: false }).limit(40)); },
      addMemorizedPages: function (sid, page, from, confirm) { return q(sb.rpc('add_memorized_pages', { p_student: sid, p_page: +page, p_from: from == null ? null : +from, p_confirm: !!confirm })); },
      setNowAt: function (sid, surah, pos) { return q(sb.rpc('set_now_at', { p_student: sid, p_surah: surah || null, p_pos: pos || null })); },
      setHifzDir: function (sid, dir) { return q(sb.rpc('set_hifz_dir', { p_student: sid, p_dir: dir })); },
      undoKeyEvent: function (id) { return q(sb.rpc('undo_key_event', { p_event: id })); },
      saveMonthReport: function (sid, month, r) {
        return q(sb.rpc('save_month_report', { p_student: sid, p_month: month, p_start_page: r.start_page == null || r.start_page === '' ? null : +r.start_page,
          p_goal_page: r.goal_page == null || r.goal_page === '' ? null : +r.goal_page, p_end_page: r.pages_end == null || r.pages_end === '' ? null : +r.pages_end,
          p_ajza: r.ajza_improve || '', p_ahkaam: r.ahkaam || '', p_murajaat: r.murajaat === '' || r.murajaat == null ? null : +r.murajaat,
          p_dawrat: r.dawrat === '' || r.dawrat == null ? null : +r.dawrat, p_note: r.report_note || '',
          p_start_surah: r.start_surah || null, p_start_pos: r.start_pos || null, p_goal_surah: r.goal_surah || null, p_goal_pos: r.goal_pos || null, p_end_surah: r.end_surah || null, p_end_pos: r.end_pos || null }));
      },
      listIkhtibars: function (f) {
        var b = sb.from('ikhtibars').select('*');
        if (f && f.studentId) b = b.eq('student_id', f.studentId);
        if (f && f.from) b = b.gte('exam_date', f.from);
        return q(b.order('exam_date').limit(5000)).then(function (d) { return d.map(normalizeIkhtibar); });
      },
      myIkhtibars: function () { return q(sb.from('ikhtibars').select('*').eq('student_id', uid).order('exam_date')).then(function (d) { return d.map(normalizeIkhtibar); }); },
      scheduleIkhtibar: function (o) {
        var rows = (o.studentIds || []).map(function (id) { return { student_id: id, exam_date: o.exam_date, title: o.title || 'Ikhtibar', note: o.note || null }; });
        return q(sb.from('ikhtibars').insert(rows).select()).then(function (d) { return d.length; });
      },
      updateIkhtibar: function (id, patch) { return q(sb.from('ikhtibars').update({ exam_date: patch.exam_date, title: patch.title, note: patch.note || null }).eq('id', id)); },
      ikhtibarResult: function (id, status, note) { return q(sb.rpc('ikhtibar_result', { p_id: id, p_status: status, p_note: note || null })); },
      deleteIkhtibar: function (x) {
        var del = function () { return q(sb.from('ikhtibars').delete().eq('id', x.id)); };
        return x.key_event_id ? q(sb.rpc('undo_key_event', { p_event: x.key_event_id })).then(del) : del();
      },
      giveReward: function (sid) { return q(sb.rpc('give_reward', { p_student: sid })); },
      listKeyRules: function () { return q(sb.from('key_rules').select('*').order('sort').order('id')); },
      saveKeyRule: function (r) {
        var row = { name: String(r.name || '').trim(), keys: parseInt(r.keys, 10), active: r.active !== false };
        return q((r.id ? sb.from('key_rules').update(row).eq('id', r.id) : sb.from('key_rules').insert(row)).select().single());
      },
      deleteKeyRule: function (id) { return q(sb.from('key_rules').delete().eq('id', id)); },
      leaderboard: function (month) { return q(sb.rpc('leaderboard', { p_month: month })); },
      listKeyEventsMonth: function (month) { return q(sb.from('key_events').select('*').eq('month', month).limit(20000)); },
      awardRule: function (sids, ruleId, month, note) { return q(sb.rpc('award_rule', { p_students: sids, p_rule: ruleId, p_month: month, p_note: note || null })); },
      markRewardSeen: function (level) { return q(sb.rpc('mark_reward_seen', { p_level: level })); },
      listReminders: function () { return q(sb.from('reminders').select('id,student_id,amount,created_at,seen_at').order('created_at', { ascending: false }).limit(2000)); },
      sendReminder: function (sid, message, amount) { return q(sb.from('reminders').insert({ student_id: sid, message: message, amount: amount }).select().single()); },
      myReminders: function () { return q(sb.from('reminders').select('*').eq('student_id', uid).order('created_at', { ascending: false }).limit(20)); },
      markReminderSeen: function (id) { return q(sb.rpc('mark_reminder_seen', { p_id: id })); },
      teachersForStudents: function () { return q(sb.rpc('teachers_for_students')); },
      myTeacherRatings: function () { return q(sb.from('teacher_feedback').select('*').eq('student_id', uid)); },
      rateTeacher: function (tid, month, scores, comment) { return q(sb.rpc('rate_teacher', { p_teacher: tid, p_month: month, p_scores: scores, p_comment: comment || '' })); },
      teacherFeedback: function (from, to) { return q(sb.rpc('teacher_feedback_summary', { p_from: from, p_to: to })); },
      listFinance: function (f) {
        var b = sb.from('finance_entries').select('*');
        if (f && f.from) b = b.gte('entry_date', f.from);
        if (f && f.to) b = b.lte('entry_date', f.to);
        return q(b.order('entry_date', { ascending: false }).order('id', { ascending: false }).limit(10000)).then(function (d) { return d.map(normalizeFinance); });
      },
      saveFinance: function (e) {
        var row = { kind: e.kind, category: e.category, amount: Number(e.amount), entry_date: e.entry_date, party: e.party || null, note: e.note || null, account: e.account === 'bank' ? 'bank' : 'cash', to_account: e.kind === 'transfer' ? (e.account === 'bank' ? 'cash' : 'bank') : null };
        return q((e.id ? sb.from('finance_entries').update(row).eq('id', e.id) : sb.from('finance_entries').insert(row)).select().single()).then(normalizeFinance);
      },
      deleteFinance: function (id) { return q(sb.from('finance_entries').delete().eq('id', id)); },
      listHR: function () { return q(sb.from('hr_records').select('*').order('id').limit(20000)).then(function (d) { return d.map(normalizeHR); }); },
      saveHR: function (r) {
        return q((r.id ? sb.from('hr_records').update({ data: r.data, updated_at: new Date().toISOString() }).eq('id', r.id) : sb.from('hr_records').insert({ kind: r.kind, data: r.data })).select().single()).then(normalizeHR);
      },
      deleteHR: function (id) { return q(sb.from('hr_records').delete().eq('id', id)); },
      myHrItems: function () { return q(sb.rpc('my_hr_items')).then(function (d) { return (d || []).map(normalizeHR); }); },
      uploadProof: function (p, file) {
        var bad = MZ.proofCheck(file); if (bad) return Promise.reject(new Error(bad));
        var type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/jpeg');
        var path = p.student_id + '/' + p.id + '-' + Date.now() + '-' + String(file.name || 'slip').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-60);
        return sb.storage.from('payment-proofs').upload(path, file, { contentType: type, upsert: false }).then(function (r) {
          if (r.error) fail(r.error);
          return q(sb.rpc('set_payment_proof', { p_id: p.id, p_path: path, p_name: file.name || 'slip', p_mime: type })).catch(function (e) { sb.storage.from('payment-proofs').remove([path]); throw e; });
        }).then(function () {
          if (p.proof_path) sb.storage.from('payment-proofs').remove([p.proof_path]).then(function () {}, function () {});
          return Object.assign({}, p, { proof_path: path, proof_name: file.name || 'slip', proof_mime: type });
        });
      },
      removeProof: function (p) {
        return q(sb.rpc('set_payment_proof', { p_id: p.id, p_path: null, p_name: null, p_mime: null })).then(function () {
          if (p.proof_path) sb.storage.from('payment-proofs').remove([p.proof_path]).then(function () {}, function () {});
          return Object.assign({}, p, { proof_path: null, proof_name: null, proof_mime: null });
        });
      },
      proofBlob: function (p) { return sb.storage.from('payment-proofs').download(p.proof_path).then(function (r) { if (r.error) fail(r.error); return r.data; }); },
      listBadges: function (sid) { var x = sb.from('badges').select('*').order('created_at', { ascending: false }).limit(5000); if (sid) x = x.eq('student_id', sid); return q(x); },
      myBadges: function () { return q(sb.from('badges').select('*').eq('student_id', uid).order('created_at', { ascending: false })); },
      awardBadge: function (b) { return q(sb.from('badges').insert({ student_id: b.student_id, badge: b.badge, title: b.title, note: b.note || null }).select().single()); },
      deleteBadge: function (id) { return q(sb.from('badges').delete().eq('id', id)); },
      markBadgesSeen: function () { return q(sb.rpc('mark_badges_seen')); },
      myMastership: function () { return q(sb.rpc('my_mastership')).then(function (d) { return (d || []).map(function (x) { return x.month; }); }); },
      canSchedule: function () { return q(sb.rpc('can_schedule')); },
      canMoveSchedule: function () { return q(sb.rpc('can_move_schedule')); },
      scheduleStudents: function () { return q(sb.rpc('schedule_students')); },
      scheduleTeachers: function () { return q(sb.rpc('schedule_teachers')); },
      listSchedules: function (f) {
        f = f || {}; var x = sb.from('schedules').select('*').order('slot_date').order('start_time').limit(5000);
        if (f.from) x = x.gte('slot_date', f.from); if (f.to) x = x.lte('slot_date', f.to); if (f.studentId) x = x.eq('student_id', f.studentId);
        return q(x).then(function (d) { return d.map(normalizeSchedule); });
      },
      saveSchedule: function (r) {
        var row = { student_id: r.student_id, teacher_id: +r.teacher_id, slot_date: r.slot_date, start_time: r.start_time, end_time: r.end_time, note: r.note || null, status: r.status || 'scheduled' };
        if (r.series_id !== undefined && !r.id) row.series_id = r.series_id || null;
        return q((r.id ? sb.from('schedules').update(row).eq('id', r.id) : sb.from('schedules').insert(row)).select().single()).then(normalizeSchedule);
      },
      deleteSchedule: function (id) { return q(sb.from('schedules').delete().eq('id', id)); },
      mySchedule: function () { var t = new Date(); t.setDate(t.getDate() - Math.max(1, (t.getDay() + 6) % 7)); return this.listSchedules({ from: t.toISOString().slice(0, 10), studentId: uid }); },
      markScheduleSeen: function () { return q(sb.rpc('mark_schedule_seen')); },
      reassignSchedule: function (ids, teacherId) { return q(sb.rpc('reassign_schedule', { p_ids: ids, p_teacher: +teacherId })); },
      teacherBusy: function (date) { return q(sb.rpc('teacher_busy', { p_date: date })).then(function (d) { return (d || []).map(function (x) { return { teacher_id: x.teacher_id, start_time: String(x.start_time).slice(0, 5), end_time: String(x.end_time).slice(0, 5) }; }); }); },
      setDisabled: function (id, on) { return q(sb.rpc('set_student_disabled', { p_student: id, p_disabled: !!on })); },
      updateMyDetails: function (d) { return q(sb.rpc('update_my_details', { p_guardian_name: d.guardian_name || '', p_phone: d.phone || '', p_email: d.email || '' })); },
      myTeacherProfile: function () { return q(sb.rpc('my_teacher_profile')); },
      saveMyTeacherProfile: function (d) { return q(sb.rpc('save_my_teacher_profile', { p: d })); },
      getItsPassword: function (sid) { return q(sb.from('student_secrets').select('its_password').eq('student_id', sid).maybeSingle()).then(function (r) { return r ? r.its_password || '' : ''; }); },
      setItsPassword: function (sid, pw) { return q(sb.from('student_secrets').upsert({ student_id: sid, its_password: pw || null, updated_at: new Date().toISOString() })); },
      myItsPassword: function () { return this.getItsPassword(uid); },
      setMyItsPassword: function (pw) { return this.setItsPassword(uid, pw); },
      sendWelcome: function (sid, tpl) { tpl = tpl || {}; return this._mail({ student_id: sid, kind: 'welcome', subject: tpl.subject || '', body: tpl.body || '' }); },
      sendEmail: function (sid, subject, body) { return this._mail({ student_id: sid, kind: 'update', subject: subject, body: body }); },
      /* teacher alerts (email + phone) after students are allocated or handed over */
      notifyTeachers: function (ids) { return this._fn('notify-teacher', { ids: ids, site: location.href.split('#')[0] }); },
      // manual emails for one lesson: to = ['student', 'teacher', 'admin']
      notifySchedule: function (id, to) { return this._fn('notify-teacher', { manual: true, id: +id, to: to, site: location.href.split('#')[0] }); },
      scheduleNotifyPreview: function (id) { return q(sb.rpc('schedule_manual_payload', { p_id: +id })); },
      listScheduleNotifications: function (ids) { ids = (ids || []).map(Number).filter(Boolean); if (!ids.length) return Promise.resolve([]); return q(sb.from('schedule_notifications').select('*').in('schedule_id', ids).order('created_at', { ascending: false }).limit(1000)); },
      scheduleHistory: function (id) { return q(sb.from('schedule_history').select('*').eq('schedule_id', +id).order('changed_at', { ascending: false }).limit(50)); },
      updateScheduleSeries: function (id, o) { return q(sb.rpc('update_schedule_series', { p_id: +id, p_student: o.student_id || null, p_teacher: o.teacher_id ? +o.teacher_id : null, p_from: o.start_time || null, p_to: o.end_time || null, p_note: o.note == null ? null : String(o.note), p_shift: +o.shift || 0 })); },
      myTeacherFeedback: function (from, to) { return q(sb.rpc('my_teacher_feedback', { p_from: from, p_to: to })); },
      myAdminFeedback: function () { return q(sb.rpc('my_admin_feedback')); },
      bulkUpdateSchedules: function (stu, ids, o) { return q(sb.rpc('bulk_update_schedules', { p_student: stu, p_ids: ids.map(Number), p_teacher: o.teacher_id ? +o.teacher_id : null, p_start: o.start_time || null, p_len: o.len ? +o.len : null, p_shift: o.shift ? +o.shift : null, p_note: o.note == null ? null : String(o.note), p_status: o.status || null })); },
      bulkDeleteSchedules: function (stu, ids) { return q(sb.rpc('bulk_delete_schedules', { p_student: stu, p_ids: ids.map(Number) })); },
      notifyRemoved: function (ids) { return this._fn('notify-teacher', { removed: true, ids: ids.map(Number), site: location.href.split('#')[0] }); },
      timetableRecipients: function (from, to) { return q(sb.rpc('timetable_recipients', { p_from: from, p_to: to })); },
      timetablePayload: function (from, to, type, ref) { return q(sb.rpc('timetable_payload', { p_from: from, p_to: to, p_type: type, p_ref: ref == null ? '' : String(ref) })); },
      sendTimetables: function (from, to, list, force) { return this._fn('notify-teacher', { timetable: true, from: from, to: to, recipients: list, force: !!force, site: location.href.split('#')[0] }); },
      listTimetableNotifications: function () { return q(sb.from('timetable_notifications').select('*').order('created_at', { ascending: false }).limit(300)); },
      testAlert: function () { return this._fn('notify-teacher', { test: true, site: location.href.split('#')[0] }); },
      savePushSub: function (sub) { var j = sub.toJSON ? sub.toJSON() : sub; return q(sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent.slice(0, 200) })); },
      removePushSub: function (endpoint) { return q(sb.rpc('remove_push_subscription', { p_endpoint: endpoint })); },
      _fn: function (name, payload) {
        if (!sb.functions) return Promise.reject(new Error('Alerts are not set up yet.'));
        return sb.functions.invoke(name, { body: payload }).then(function (r) {
          if (r.data && r.data.error) throw new Error(r.data.error);
          if (!r.error) return r.data;
          var e = r.error, ctx = e.context, st = ctx && ctx.status;
          if (e.name === 'FunctionsFetchError' || st === 404) { var x = new Error('The “' + name + '” function is not deployed in Supabase yet.'); x.notDeployed = true; throw x; }
          var read = ctx && typeof ctx.clone === 'function' ? ctx.clone().json().catch(function () { return {}; }) : Promise.resolve({});
          return read.then(function (b) { throw new Error((b && (b.error || b.message)) || ('The alert failed (' + (st || 'error') + ').')); });
        });
      },
      _mail: function (payload) {
        if (!sb.functions) return Promise.reject(new Error('Email is not set up yet.'));
        return sb.functions.invoke('send-welcome-email', { body: payload }).then(function (r) {
          if (r.data && r.data.error) throw new Error(r.data.error);
          if (!r.error) return r.data;
          var e = r.error, ctx = e.context;
          if (e.name === 'FunctionsFetchError') throw new Error('Could not reach the email function. Check that “send-welcome-email” is deployed in Supabase.');
          if (e.name === 'FunctionsRelayError') throw new Error('Supabase could not run the email function. Try again in a minute.');
          var st = ctx && ctx.status;
          var read = ctx && typeof ctx.clone === 'function' ? ctx.clone().json().catch(function () { return ctx.clone().text().then(function (t) { return { error: t }; }); }) : Promise.resolve({});
          return read.then(function (b) {
            var m = b && (b.error || b.message || b.msg);
            if (st === 404 && !(b && b.error && /Student/.test(b.error))) m = 'The email function “send-welcome-email” is not deployed yet in Supabase (Edge Functions).';
            else if (st === 401 && !m) m = 'Supabase refused the login for the email function. Log out and log in again.';
            throw new Error(m || ('Email failed (' + (st || 'error') + ').'));
          });
        });
      },
      listAttendance: function (from, to) { return q(sb.from('student_attendance').select('*').gte('att_date', from).lte('att_date', to).order('att_date').limit(20000)); },
      markAttendance: function (date, rows) { return q(sb.rpc('mark_attendance', { p_date: date, p_rows: rows })); },
      watchAttendance: function (cb) {
        var t = null, ch = sb.channel('attendance-' + Date.now()).on('postgres_changes', { event: '*', schema: 'public', table: 'student_attendance' }, function () { clearTimeout(t); t = setTimeout(cb, 400); }).subscribe();
        return function () { sb.removeChannel(ch); };
      },
      watchKeys: function (cb) {
        if (!uid) return function () {};
        var ch = sb.channel('keys-' + Date.now()).on('postgres_changes', { event: '*', schema: 'public', table: 'key_events', filter: 'student_id=eq.' + uid }, function () { cb(); }).subscribe();
        return function () { sb.removeChannel(ch); };
      },
      /* notices (Word files) */
      listNotices: function () { return q(sb.from('notices').select('*').order('created_at', { ascending: false })); },
      addNotice: function (o) {
        var path = null;
        var up = o.file ? (function () {
          path = Date.now() + '-' + String(o.file.name || 'notice').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
          return sb.storage.from('notices').upload(path, o.file, { contentType: o.file.type || 'application/octet-stream', upsert: false })
            .then(function (r) { if (r.error) fail(r.error); });
        })() : Promise.resolve();
        return up.then(function () {
          return q(sb.from('notices').insert({ title: o.title, html: o.html || '', body: o.body || null, file_path: path, file_name: o.file ? o.file.name : null,
            mime: o.file ? (o.file.type || null) : null, file_size: o.file ? o.file.size : null }).select().single()).catch(function (e) {
            if (path) sb.storage.from('notices').remove([path]); throw e; });
        });
      },
      deleteNotice: function (n) {
        return q(sb.from('notices').delete().eq('id', n.id)).then(function () {
          if (n.file_path) return sb.storage.from('notices').remove([n.file_path]).then(function () {});
        });
      },
      downloadNotice: function (n) {
        return sb.storage.from('notices').download(n.file_path).then(function (r) { if (r.error) fail(r.error); return r.data; });
      }
    };
  }

  /* ---------------------------------------------------------- demo */
  var DKEY = 'mz_demo_db_v25';
  function demoSeed() {
    var cur = MZ.thisMonth(), y = cur.slice(0, 4), seq = 0;
    var db = { seq: 0, settings: { id: 1, institute_name: 'Qism al Tahfeez Dar es Salaam', currency: 'TSh', default_password: 'zahra2026', due_day: 5, keys_jadeed: 3, keys_ikhtibar: 15, keys_goal: 10, reward_every: 100 },
      progress: [], events: [], evseq: 0, notices: [], reminders: [],
      admins: [{ user_id: 'admin-1', username: 'admin', password: 'admin123', role: 'admin', created_at: new Date().toISOString() },
        { user_id: 'teacher-1', username: 'teacher.hasan', password: 'teacher2026', role: 'teacher', created_at: new Date().toISOString() },
        { user_id: 'accounts-1', username: 'accounts.office', password: 'accounts2026', role: 'accounts', created_at: new Date().toISOString() },
        { user_id: 'cashier-1', username: 'cashier.desk', password: 'cashier2026', role: 'cashier', created_at: new Date().toISOString() },
        { user_id: 'viewer-1', username: 'viewer.office', password: 'viewer2026', role: 'viewer', created_at: new Date().toISOString() }], students: [], payments: [] };
    var people = [
      ['hussein.ahmed', 'Hussein Ahmed', '255712000001', 250000, y + '-01', 7],
      ['fatema.saifuddin', 'Fatema Saifuddin', '255712000002', 250000, y + '-01', 15],
      ['murtaza.ali', 'Murtaza Ali', '255712000003', 200000, y + '-03', 4],
      ['zahra.hakimuddin', 'Zahra Hakimuddin', '255712000004', 250000, y + '-01', 22],
      ['mustafa.jafferji', 'Mustafa Jafferji', '', 180000, y + '-06', 2],
      ['sakina.najmi', 'Sakina Najmi', '255712000006', 250000, y + '-02', 30]
    ];
    var methods = ['Cash', 'Bank', 'Cash'];
    people.forEach(function (p, i) {
      var id = 'demo-' + (i + 1);
      db.students.push({ id: id, username: p[0], password: 'zahra2026', full_name: p[1], phone: i === 0 ? '' : p[2], monthly_fee: p[3], start_month: p[4], juz: p[5], created_at: new Date().toISOString(),
        admission_no: 'QT-' + pad(i + 1, 3), its_no: String(30412340 + i * 7), program: i % 2 ? 'Part-time Hifz' : 'Full-time Hifz', gender: [0, 2, 4].indexOf(i) >= 0 ? 'Male' : 'Female', dob: (2008 + i) + '-0' + (i + 1) + '-1' + i, guardian_name: i === 0 ? '' : 'Ahmed ' + p[1].split(' ')[1], email: '' });
      // paid every month before this one (except Murtaza missed last month); a few already paid this month
      for (var m = p[4]; m <= cur; m = MZ.addMonths(m, 1)) {
        if (m === cur && !(i === 1 || i === 3 || i === 5)) continue;
        if (i === 2 && m === MZ.addMonths(cur, -1)) continue;
        if (i === 5 && m >= MZ.addMonths(cur, -6) && m <= MZ.addMonths(cur, -3)) continue; // Sakina was away (break below)
        seq++;
        var day = m === cur ? MZ.today().slice(8, 10) : pad(2 + (i % 3));
        db.payments.push({ id: seq, receipt_no: 'QT-' + y.slice(2) + '-' + pad(seq, 5), student_id: id, month: m, amount: p[3],
          method: methods[(i + seq) % 3], paid_on: m + '-' + day, note: '', created_at: m + '-' + day + 'T09:00:00Z', seen_at: m + '-' + day + 'T10:00:00Z' });
      }
    });
    db.seq = seq;
    db.payments.forEach(function (p) { p.status = 'approved'; });
    // a new enrollment: registered, waiting for the first payment
    db.students.push({ id: 'demo-7', username: 'mustafa.juzer', password: 'zahra2026', full_name: 'Mustafa Juzer', phone: '255712000007', email: 'mustafa.juzer@example.com', monthly_fee: 250000, start_month: cur, juz: 0,
      created_at: new Date().toISOString(), admission_no: 'QT-007', its_no: '30412389', program: 'Full-time Hifz', gender: 'Male', dob: '2014-03-12', guardian_name: 'Juzer Mustafa', is_new: true, pages: 0, keys: 0 });
    db.students[5].breaks = [{ from: MZ.addMonths(cur, -6), to: MZ.addMonths(cur, -3), note: 'Travelled home, came back' }];
    // hifz progress: pages at the end of each past month, a goal and some keys for this month
    var prevM = MZ.addMonths(cur, -1);
    db.students.forEach(function (st, i) {
      var start = st.start_month, endPages = [300, 40, 3, 140, 2, 600][i] || 0, months = [];
      for (var m = start; m < cur; m = MZ.addMonths(m, 1)) months.push(m);
      var base = Math.max(0, endPages - months.length * 10);
      months.forEach(function (m, k) {
        var pe = Math.min(604, Math.round(base + (endPages - base) * (k + 1) / months.length));
        var sp = k === 0 ? base : Math.min(604, Math.round(base + (endPages - base) * k / months.length));
        db.progress.push({ student_id: st.id, month: m, goal: 10, jadeed: 10, ikhtibar: k % 3 === 2 ? 1 : 0, goal_awarded: m !== prevM || i !== 2, pages_end: pe,
          start_page: sp, goal_page: Math.min(604, sp + 10) });
      });
      st.pages = endPages; st.keys = 0; st.rewards_given = 0; st.rewards_seen = 0;
      var lastKeys = [92, 230, 41, 315, 12, 960][i] || 0;
      st.keys = lastKeys; st.rewards_seen = Math.floor(lastKeys / 100); st.rewards_given = Math.max(0, Math.floor(lastKeys / 100) - (i === 3 ? 1 : 0));
      var gp = i === 0 ? 400 : Math.min(604, st.pages + 10);
      db.progress.push({ student_id: st.id, month: cur, goal: gp - st.pages, jadeed: 0, ikhtibar: 0, goal_awarded: false, pages_end: st.pages, start_page: st.pages, goal_page: gp > st.pages ? gp : null });
      db.evseq++; db.events.push({ id: db.evseq, student_id: st.id, kind: 'ikhtibar', keys: 15, pages: 0, month: prevM, note: 'Ikhtibar cleared', created_at: prevM + '-20T10:00:00Z' });
    });
    // teacher's report for Hussein, last month and this month
    var hp = db.progress.filter(function (r) { return r.student_id === 'demo-1'; });
    hp.forEach(function (r) { if (r.month === prevM) Object.assign(r, { ajza_improve: '3, 5', ahkaam: 'Qalqalah; makhraj of daad', murajaat: 4, dawrat: 1, report_note: 'Good effort. Revise juz 3 daily.' }); });
    hp.forEach(function (r) { if (r.month === cur) Object.assign(r, { ajza_improve: '5', ahkaam: 'Ghunnah in noon and meem mushaddad', murajaat: 2, dawrat: 0, report_note: '', start_surah: 19, start_pos: 305, goal_surah: 9, goal_pos: 205, end_surah: 19, end_pos: 305 }); });
    hp.forEach(function (r) { if (r.month === prevM) Object.assign(r, { start_surah: 20, start_pos: 315, goal_surah: 19, goal_pos: 305, end_surah: 19, end_pos: 305 }); });
    db.students[0].cur_surah = 19; db.students[0].cur_pos = 305;   // Hussein started from An-Nas and is going back
    db.students[1].cur_surah = 5; db.students[1].cur_pos = 115;
    db.ikhtibars = []; db.ikseq = 0;
    function ik(sid, date, title, status) { db.ikseq++; db.ikhtibars.push({ id: db.ikseq, student_id: sid, exam_date: date, title: title, status: status, note: '', key_event_id: null, quick: false, created_at: new Date().toISOString() }); }
    var d20 = cur + '-20', dNext = MZ.addMonths(cur, 1) + '-05';
    db.students.forEach(function (st) { ik(st.id, d20, 'Monthly ikhtibar', 'scheduled'); });
    ik('demo-1', dNext, 'Juz 15 ikhtibar', 'scheduled');
    ik('demo-1', prevM + '-20', 'Monthly ikhtibar', 'cleared');
    db.ikhtibars[db.ikhtibars.length - 1].key_event_id = db.events.filter(function (e) { return e.student_id === 'demo-1'; })[0].id;
    db.rules = [{ id: 1, name: 'Discipline', keys: 5, active: true, sort: 0 }, { id: 2, name: 'Helping others', keys: 5, active: true, sort: 0 },
      { id: 3, name: 'Full attendance this month', keys: 10, active: true, sort: 0 }, { id: 4, name: 'Late to class', keys: -2, active: true, sort: 0 }];
    db.ruleseq = 4;
    db.evseq++; db.events.push({ id: db.evseq, student_id: 'demo-1', kind: 'bonus', keys: 5, pages: 0, month: cur, note: 'Discipline', created_at: new Date(Date.now() - 864e5).toISOString() });
    // some keys this month for the leaderboard
    // spread over the current week (Monday up to today) so the weekly report has something to show
    var wkDays = (new Date().getDay() + 6) % 7;
    [['demo-2', 'jadeed', 12, 4], ['demo-4', 'jadeed', 18, 6], ['demo-6', 'jadeed', 9, 3], ['demo-3', 'bonus', 5, 0], ['demo-5', 'jadeed', 6, 2], ['demo-4', 'bonus', 5, 0], ['demo-1', 'jadeed', 6, 2], ['demo-2', 'jadeed', 6, 2]].forEach(function (x, k) {
      db.evseq++; db.events.push({ id: db.evseq, student_id: x[0], kind: x[1], keys: x[2], pages: x[3], month: cur, note: x[1] === 'bonus' ? 'Helping others' : 'Jadeed: ' + x[3] + ' pages cleared', created_at: new Date(Date.now() - (k % (wkDays + 1)) * 864e5 - 3600e3).toISOString() });
    });
    [['demo-1', 'Cash'], ['demo-3', 'M-Pesa']].forEach(function (x) {
      var st = db.students.find(function (s) { return s.id === x[0]; }); db.seq++;
      db.payments.push({ id: db.seq, receipt_no: 'QT-' + y.slice(2) + '-' + pad(db.seq, 5), student_id: st.id, month: cur, amount: st.monthly_fee, method: x[1], paid_on: MZ.today(), note: '',
        created_at: new Date(Date.now() - 3600e3).toISOString(), seen_at: null, status: 'pending', created_by: 'accounts-1', approved_at: null });
    });
    db.students[4].discount_type = 'percent'; db.students[4].discount_value = 20; db.students[4].discount_note = 'Sibling discount';
    db.finance = []; db.finseq = 0;
    [[cur, 'income', 'Food sponsorship', 450000, 'Shk. Taher Bhai', 'Lunch for all students, one week'], [cur, 'income', 'Electricity sponsorship', 120000, 'Mulla Yusuf Bhai', ''],
     [prevM, 'income', 'Donation', 300000, 'Anonymous', ''], [cur, 'expense', 'Electricity (LUKU)', 95000, 'TANESCO', ''], [cur, 'expense', 'Snacks', 60000, 'Shop', ''],
     [cur, 'expense', 'Internet', 75000, 'Vodacom', ''], [cur, 'expense', 'Stationery', 42000, '', 'Notebooks and pens'], [cur, 'expense', 'Awards & Gifts', 150000, '', 'Rewards for students'],
     [prevM, 'expense', 'Maintenance', 210000, 'Fundi', 'Fans repaired'], [prevM, 'expense', 'Water', 30000, 'DAWASA', ''], [prevM, 'expense', 'Mawaid', 400000, '', '']].forEach(function (r) {
      db.finseq++; db.finance.push({ id: db.finseq, kind: r[1], category: r[2], amount: r[3], entry_date: r[0] + '-0' + (1 + (db.finseq % 8)), party: r[4], note: r[5], created_at: new Date().toISOString(), account: db.finseq % 3 ? 'cash' : 'bank', to_account: null });
    });
    // cash and bank books: opening balances in January, one deposit and one withdrawal
    [[y + '-01-01', 'opening', 'Opening balance', 400000, 'cash'], [y + '-01-01', 'opening', 'Opening balance', 3500000, 'bank'],
     [prevM + '-25', 'transfer', 'Deposit to bank', 2000000, 'cash'], [cur + '-03', 'transfer', 'Withdrawal to cash', 500000, 'bank']].forEach(function (r) {
      db.finseq++; db.finance.push({ id: db.finseq, kind: r[1], category: r[2], amount: r[3], entry_date: r[0], party: '', note: '', created_at: new Date().toISOString(), account: r[4], to_account: r[1] === 'transfer' ? (r[4] === 'cash' ? 'bank' : 'cash') : null });
    });
    db.hr = []; db.hrseq = 0;
    function hr(kind, data) { db.hrseq++; db.hr.push({ id: db.hrseq, kind: kind, data: data, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); return db.hrseq; }
    var t1 = hr('teacher', { full_name: 'Mulla Hasan Saifuddin', role: 'Hifz teacher', phone: '255713000101', email: '', join_date: (+y - 3) + '-01-10', salary: 900000, status: 'Active', notes: '', user_id: 'teacher-1', its_no: '30455120', sanad_year: '2012', tadreeb: 'Yes' });
    var t2 = hr('teacher', { full_name: 'Moallema Fatema Najmi', role: 'Hifz teacher', phone: '255713000102', email: '', join_date: (+y - 1) + '-06-01', salary: 800000, status: 'Active', notes: '' });
    var t3 = hr('teacher', { full_name: 'Mulla Ammar Rangwala', role: 'Tajweed teacher', phone: '255713000103', email: '', join_date: y + '-02-15', salary: 600000, status: 'Active', notes: 'Part-time' });
    hr('teacher_rating', { teacher_id: t1, month: prevM, punctuality: 5, concentration: 4, listening: 5, teaching: 5, coaching: 4, attitude: 5, ownership: 5, comment: 'Excellent with new students', positives: 'Very patient with the new students and always well prepared.', improve: 'Send the monthly reports a little earlier.' });
    hr('teacher_rating', { teacher_id: t2, month: prevM, punctuality: 4, concentration: 5, listening: 4, teaching: 5, coaching: 5, attitude: 5, ownership: 4, comment: '' });
    hr('teacher_rating', { teacher_id: t3, month: prevM, punctuality: 3, concentration: 3, listening: 3, teaching: 4, coaching: 3, attitude: 4, ownership: 3, comment: 'Needs more patience in revision' });
    db.feedback = []; db.fbseq = 0;
    [['demo-2', t1, [5, 5, 5, 5, 4, 5, 5], 'Explains every mistake kindly'], ['demo-3', t1, [4, 4, 5, 4, 4, 5, 4], ''], ['demo-4', t1, [5, 4, 4, 5, 5, 5, 5], ''],
     ['demo-2', t2, [4, 5, 4, 5, 5, 4, 4], 'Helps with revision after class'], ['demo-6', t2, [5, 5, 5, 5, 5, 5, 5], ''], ['demo-4', t3, [3, 3, 4, 4, 3, 4, 3], 'Sometimes late']].forEach(function (f) {
      var sc = {}; MZ.TEACHER_CRITERIA.forEach(function (c, i) { sc[c[0]] = f[2][i]; });
      db.fbseq++; db.feedback.push({ id: db.fbseq, teacher_id: f[1], student_id: f[0], month: prevM, scores: sc, comment: f[3], created_at: prevM + '-25T10:00:00Z', updated_at: prevM + '-25T10:00:00Z' });
    });
    [[t1, 900000], [t2, 800000], [t3, 600000]].forEach(function (x) { hr('payroll', { teacher_id: x[0], month: prevM, basic: x[1], allowances: 50000, deductions: 0, status: 'Paid', paid_on: prevM + '-28', method: 'Bank transfer', note: '' }); });
    hr('leave', { teacher_id: t2, from_date: prevM + '-12', to_date: prevM + '-13', type: 'Sick', status: 'Approved', reason: 'Fever' });
    var today = MZ.today();
    [[t1, 'Present'], [t2, 'Present'], [t3, 'Late']].forEach(function (x) { hr('attendance', { teacher_id: x[0], date: today, status: x[1], note: x[1] === 'Late' ? '20 minutes' : '' }); });
    var addD = function (d, n) { var x = new Date(MZ.today() + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    hr('duty', { teacher_id: t1, person: '', position: 'Head of Hifz', reports_to: 'Admin', responsibilities: 'Plan the monthly takhteet for every class\nTake the monthly ikhtibar\nTrain new teachers', from_date: (+y - 1) + '-01-01', status: 'Active', notes: '' });
    hr('duty', { teacher_id: t2, person: '', position: 'Girls section in-charge', reports_to: 'Head of Hifz', responsibilities: 'Daily jadeed and murajaat for the girls class\nParent meetings each term', from_date: y + '-01-01', status: 'Active', notes: '' });
    hr('duty', { teacher_id: '', person: 'Shk. Burhanuddin', position: 'Accounts', reports_to: 'Admin', responsibilities: 'Record fees every day\nBank the cash every Thursday\nMonthly accounts report', from_date: y + '-03-01', status: 'Active', notes: '' });
    hr('goal', { title: '10 students complete 5 ajza', year: y, teacher_id: t1, person: '', target: '10 students reach 100 pages', due_date: y + '-12-31', follow_every: 'Month', next_follow: addD(0, -3), progress: 60, status: 'In progress', notes: '', log: [{ date: addD(0, -33), note: '6 students past 100 pages. 4 close behind.', progress: 60, by: 'Admin' }] });
    hr('goal', { title: 'Tajweed class for all new students', year: y, teacher_id: t3, person: '', target: 'Every new student in a tajweed class within a month', due_date: y + '-11-30', follow_every: '2 weeks', next_follow: addD(0, 10), progress: 40, status: 'In progress', notes: '', log: [] });
    hr('goal', { title: 'Collect 95% of fees on time', year: y, teacher_id: '', person: 'Shk. Burhanuddin', target: '95% paid by the 10th', due_date: y + '-12-31', follow_every: 'Month', next_follow: addD(0, -1), progress: 0, status: 'Not started', notes: '', log: [] });
    db.badges = [
      { id: 1, student_id: 'demo-2', badge: 'murajaat', title: 'Strong Murajaat', note: 'Finished Surah Maryam with no mistakes', awarded_by: 'teacher-1', awarded_by_name: 'Mulla Hasan Saifuddin', created_at: new Date(Date.now() - 86400e3).toISOString(), seen_at: null },
      { id: 2, student_id: 'demo-2', badge: 'tajweed', title: 'Excellent Ahkaam & Makharij', note: '', awarded_by: 'admin', awarded_by_name: 'Admin', created_at: new Date(Date.now() - 9 * 86400e3).toISOString(), seen_at: new Date().toISOString() },
      { id: 3, student_id: 'demo-1', badge: 'effort', title: 'Hard Worker', note: 'Came early every day this month', awarded_by: 'admin', awarded_by_name: 'Admin', created_at: new Date(Date.now() - 3 * 86400e3).toISOString(), seen_at: null }];
    db.badgeSeq = 3;
    db.hr.forEach(function (r) { if (r.id === t1) r.data.can_schedule = 'Yes'; });
    // each student's teacher(s)
    var mine = { 'demo-1': [t1, t3], 'demo-2': [t1], 'demo-4': [t1], 'demo-5': [t1], 'demo-3': [t2], 'demo-6': [t2], 'demo-7': [t3] };
    db.students.forEach(function (st) { st.teacher_ids = mine[st.id] || []; });
    // each demo student's memorisation direction and current page (demo-6 has none yet, to show setting it)
    var DIRS = { 'demo-1': 'forward', 'demo-2': 'forward', 'demo-3': 'forward', 'demo-4': 'forward', 'demo-5': 'backward', 'demo-7': 'forward' };
    db.students.forEach(function (st) {
      var dir = DIRS[st.id] || null; st.hifz_dir = dir; st.hifz_dir_manual = !!dir;
      if (st.id === 'demo-5') st.pages = Math.max(15, +st.pages || 0);
      // the months join up: this month starts where last month ended, plus this month's page entries
      if (dir) {
        var tm0 = MZ.thisMonth(), prevRow = db.progress.filter(function (x) { return x.student_id === st.id && x.month < tm0 && x.pages_end != null; }).sort(function (a, b) { return a.month < b.month ? 1 : -1; })[0];
        var evs0 = db.events.filter(function (e) { return e.student_id === st.id && e.kind === 'jadeed' && e.month === tm0; }).reduce(function (a, e) { return a + (+e.pages || 0); }, 0);
        if (prevRow) st.pages = Math.min(604, prevRow.pages_end + evs0);
      }
      if (dir) { st.cur_pos = MZ.countToPos(+st.pages || 0, dir); st.cur_surah = st.cur_pos ? MZ.pageSurah(st.cur_pos, dir) : null; }
      db.progress.filter(function (x) { return x.student_id === st.id; }).forEach(function (x) {
        if (!dir) return;
        var sp = x.start_page != null ? x.start_page : Math.max(0, (x.pages_end || 0) - (x.jadeed || 0));
        // this month: the page entries are the record, so the month's start is where they began
        if (x.month === MZ.thisMonth()) { var evs = db.events.filter(function (e) { return e.student_id === st.id && e.kind === 'jadeed' && e.month === x.month; }).reduce(function (a, e) { return a + (+e.pages || 0); }, 0); x.jadeed = evs; x.pages_end = st.pages; sp = Math.max(0, st.pages - evs); }
        x.start_page = sp; x.start_pos = MZ.countToPos(sp, dir); x.start_surah = x.start_pos ? MZ.pageSurah(x.start_pos, dir) : null;
        x.end_pos = x.pages_end != null ? MZ.countToPos(x.pages_end, dir) : null; x.end_surah = x.end_pos ? MZ.pageSurah(x.end_pos, dir) : null;
        if (x.goal > 0) { x.goal_page = Math.min(604, sp + x.goal); x.goal_pos = MZ.countToPos(x.goal_page, dir); x.goal_surah = MZ.pageSurah(x.goal_pos, dir); }
      });
    });
    var dPlus = function (n) { var x = new Date(MZ.today() + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    db.schedules = []; db.schedSeq = 0;
    [['demo-1', t1, 1, '07:30', '08:15', 'Jadeed'], ['demo-2', t1, 1, '08:15', '09:00', 'Jadeed'], ['demo-3', t2, 1, '07:30', '08:15', 'Murajaat'], ['demo-4', t2, 1, '08:15', '09:00', 'Jadeed'],
     ['demo-1', t3, 2, '10:00', '10:30', 'Tajweed'], ['demo-5', t1, 2, '07:30', '08:15', 'Jadeed'], ['demo-6', t2, 3, '07:30', '08:15', 'Ikhtibar']].forEach(function (x) {
      var t = db.hr.find(function (r) { return r.id === x[1]; });
      db.schedSeq++; db.schedules.push({ id: db.schedSeq, student_id: x[0], teacher_id: x[1], teacher_name: t.data.full_name, teacher_user: t.data.user_id || null, slot_date: dPlus(x[2]), start_time: x[3], end_time: x[4], note: x[5], status: 'scheduled', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), student_seen_at: null, teacher_seen_at: null });
    });
    hr('student_rating', { student_id: 'demo-1', month: prevM, hifz: 4, tajweed: 3, behaviour: 5, attendance: 4, comment: 'Good effort, revise juz 1 more' });
    db.notices.push({ id: 2, title: 'Ikhtibar on the 20th', body: 'The monthly ikhtibar is on the 20th of this month at 8:00 am. Please revise your last 5 pages.', file_path: null, file_name: null, html: '', created_at: new Date(Date.now() - 3600e3).toISOString() });
    db.notices.push({ id: 1, title: 'Fee structure ' + y, file_path: null, file_name: null, created_at: new Date().toISOString(),
      html: '<h2>Fee structure ' + y + '</h2><p>Monthly fees are due by the <strong>5th</strong> of every month.</p><table><tr><td><strong>Programme</strong></td><td><strong>Monthly fee</strong></td></tr><tr><td>Full-time hifz</td><td>TSh 250,000</td></tr><tr><td>Part-time hifz</td><td>TSh 180,000</td></tr></table><p>Payments can be made in cash at the office, by M-Pesa or by bank transfer. Please keep your receipt in the student portal.</p>' });
    return db;
  }
  function demoLoad() {
    try { var raw = localStorage.getItem(DKEY); if (raw) return JSON.parse(raw); } catch (e) {}
    var db = demoSeed(); demoSave(db); return db;
  }
  function demoSave(db) { try { localStorage.setItem(DKEY, JSON.stringify(db)); } catch (e) {} }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function later(v) { return new Promise(function (res) { setTimeout(function () { res(v); }, 120); }); }
  function demoErr(msg) { return Promise.reject(new Error(msg)); }

  // a month's row: for this month it keeps where the student started (mirrors _ensure_month)
  function demoMonth(db, st, month) {
    var r = db.progress.find(function (x) { return x.student_id === st.id && x.month === month; });
    if (!r) {
      if (month === MZ.thisMonth()) r = { student_id: st.id, month: month, goal: 0, jadeed: 0, ikhtibar: 0, goal_awarded: false, pages_end: st.pages || 0, start_page: st.pages || 0, start_pos: st.cur_pos || null, start_surah: st.cur_surah || null, end_pos: st.cur_pos || null, end_surah: st.cur_surah || null };
      else {
        var prev = db.progress.filter(function (x) { return x.student_id === st.id && x.month < month && x.pages_end != null; }).sort(function (a, b) { return a.month < b.month ? 1 : -1; })[0];
        r = { student_id: st.id, month: month, goal: 0, jadeed: 0, ikhtibar: 0, goal_awarded: false, pages_end: prev ? prev.pages_end : month > MZ.thisMonth() ? st.pages || 0 : null, start_page: prev ? prev.pages_end : null, start_pos: prev ? prev.end_pos || null : null, start_surah: prev ? prev.end_surah || null : null };
      }
      db.progress.push(r);
    }
    return r;
  }
  // pages memorised and "Now at" move together (mirrors _hifz_set)
  function demoHifzSet(db, st, count, surah) {
    count = Math.max(0, Math.min(604, +count || 0));
    if (!st.hifz_dir) { st.pages = count; demoMonth(db, st, MZ.thisMonth()).pages_end = count; return; }
    var dir = st.hifz_dir;
    var pos = MZ.countToPos(count, dir), su = pos ? (surah >= 1 && surah <= 114 ? +surah : MZ.pageSurah(pos, dir)) : null;
    st.pages = count; st.cur_pos = pos; st.cur_surah = su;
    var r = demoMonth(db, st, MZ.thisMonth()); r.pages_end = count; r.end_pos = pos; r.end_surah = su;
  }
  function demoEvent(db, sid, kind, keys, pages, month, note) {
    db.evseq = (db.evseq || 0) + 1;
    var e = { id: db.evseq, student_id: sid, kind: kind, keys: keys, pages: pages || 0, month: month, note: note, created_at: new Date().toISOString() };
    db.events.push(e); return e;
  }
  function demoGoal(db, st, r) {
    if (r.goal_awarded) return false;
    var reached = r.pages_end != null ? r.pages_end : (+st.pages || 0);
    if (!(r.goal > 0)) return false;
    var done = r.start_page != null ? reached - r.start_page : (r.jadeed || 0);
    if (done < r.goal) return false;
    var k = db.settings.keys_goal; r.goal_awarded = true; st.keys = (+st.keys || 0) + k;
    demoEvent(db, st.id, 'goal', k, 0, r.month, 'Monthly goal of ' + r.goal + ' pages reached');
    return true;
  }
  // takes back the goal keys when a correction means the goal is no longer met (mirrors _recheck_goal)
  function demoRecheckGoal(db, st, r, audit) {
    var reached = r.pages_end != null ? r.pages_end : (+st.pages || 0), done = r.start_page != null ? reached - r.start_page : (r.jadeed || 0);
    if (r.goal_awarded && (!(r.goal > 0) || done < r.goal)) {
      var ev = db.events.filter(function (e) { return e.student_id === st.id && e.month === r.month && e.kind === 'goal'; }), k = ev.reduce(function (a, e) { return a + e.keys; }, 0);
      db.events = db.events.filter(function (e) { return ev.indexOf(e) < 0; }); st.keys = Math.max(0, st.keys - k); r.goal_awarded = false;
      if (audit) audit('Goal keys taken back', String(k), '0');
    }
    demoGoal(db, st, r);
  }
  function demoAwardIkh(db, st, month, note) {
    var k = db.settings.keys_ikhtibar, r = demoMonth(db, st, month);
    st.keys = (+st.keys || 0) + k; r.ikhtibar += 1;
    return demoEvent(db, st.id, 'ikhtibar', k, 0, month, note);
  }
  function demoApi(portal) {
    var SKEY = 'mz_demo_session_' + portal, sess = null;
    try { sess = JSON.parse(sessionStorage.getItem(SKEY) || localStorage.getItem(SKEY) || 'null'); } catch (e) {}
    function setSess(s) { sess = s; try { if (s) localStorage.setItem(SKEY, JSON.stringify(s)); else localStorage.removeItem(SKEY); } catch (e) {} }
    function admin() { return sess && sess.role === 'institute'; }
    function need(role) { if (!sess || sess.role !== role) throw new Error('Please sign in again.'); }
    return {
      mode: 'demo',
      restore: function () { return later(sess ? { role: sess.role } : null); },
      signIn: function (username, password) {
        var db = demoLoad(), u = String(username || '').trim().toLowerCase();
        var a = db.admins.find(function (x) { return x.username === u && x.password === password; });
        var s = db.students.find(function (x) { return x.username === u && x.password === password; });
        if (!a && !s) return demoErr('Username or password is incorrect.');
        if (portal === 'institute' && !a) return demoErr('This is a student account. Please sign in on the Student portal.');
        if (portal === 'student' && !s) return demoErr('This is the institute account. Please sign in on the Institute portal.');
        if (s && s.disabled_at) return demoErr('This account is disabled. Please contact the institute.');
        setSess(a ? { role: 'institute', username: u, staff: a.role || 'admin' } : { role: 'student', id: s.id });
        return later({ role: sess.role, staff: sess.staff });
      },
      signOut: function () { setSess(null); return later(); },
      setupNeeded: function () { return later(!demoLoad().admins.length); },
      createFirstAdmin: function (username, password) {
        var db = demoLoad(), u = String(username || '').trim().toLowerCase(), self = this;
        if (db.admins.length) return demoErr('The institute account already exists. Please sign in.');
        if (!MZ.validUsername(u)) return demoErr('Username is not valid. Use 3 to 30 letters, numbers, dots, dashes or underscores.');
        if (!MZ.strongPw(password)) return demoErr(MZ.STRONG_PW_MSG);
        db.admins.push({ user_id: 'admin-' + Date.now(), username: u, password: password, role: 'admin', created_at: new Date().toISOString() }); demoSave(db);
        return self.signIn(u, password);
      },
      myId: function () { var a = sess && demoLoad().admins.find(function (x) { return x.username === sess.username; }); return a ? (a.user_id || a.username) : null; },
      myRole: function () { var a = sess && demoLoad().admins.find(function (x) { return x.username === sess.username; }); return a ? (a.role || 'admin') : 'admin'; },
      myUid: function () { var a = sess && demoLoad().admins.find(function (x) { return x.username === sess.username; }); return a ? a.user_id || null : null; },
      setStaffRole: function (id, role) {
        var db = demoLoad(), a = db.admins.find(function (x) { return (x.user_id || x.username) === id; }); if (!a) return demoErr('Staff account not found.');
        if (['admin', 'teacher', 'accounts', 'cashier'].indexOf(role) < 0) return demoErr('Role is not valid.');
        if (id === this.myId() && role !== 'admin') return demoErr('You cannot remove your own admin access.');
        a.role = role; demoSave(db); return later();
      },
      listStaff: function () {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        return later(demoLoad().admins.map(function (a) { return { user_id: a.user_id || a.username, username: a.username, role: a.role || 'admin', created_at: a.created_at || '' }; }));
      },
      addStaff: function (u, p, role) {
        if (!admin()) return demoErr('Only the institute can add staff accounts.');
        var db = demoLoad(); u = String(u || '').trim().toLowerCase(); role = role || 'admin';
        if (!MZ.validUsername(u)) return demoErr('Username "' + u + '" is not valid. Use 3 to 30 letters, numbers, dots, dashes or underscores.');
        if (!MZ.strongPw(p)) return demoErr(MZ.STRONG_PW_MSG);
        if (['admin', 'teacher', 'accounts', 'cashier'].indexOf(role) < 0) return demoErr('Role is not valid.');
        if (db.admins.some(function (x) { return x.username === u; }) || db.students.some(function (x) { return x.username === u; })) return demoErr('The username "' + u + '" is already taken.');
        db.admins.push({ user_id: 'staff-' + Date.now(), username: u, password: p, role: role, created_at: new Date().toISOString() }); demoSave(db); return later();
      },
      removeStaff: function (id) {
        if (!admin()) return demoErr('Only the institute can remove staff accounts.');
        if (id === this.myId()) return demoErr('You cannot remove your own account while signed in.');
        var db = demoLoad(); db.admins = db.admins.filter(function (a) { return (a.user_id || a.username) !== id; }); demoSave(db); return later();
      },
      resetStaffPassword: function (id, p) {
        if (!admin()) return demoErr('Only the institute can reset passwords.');
        if (!MZ.strongPw(p)) return demoErr(MZ.STRONG_PW_MSG);
        var db = demoLoad(), a = db.admins.find(function (x) { return (x.user_id || x.username) === id; }); if (!a) return demoErr('Staff account not found.');
        a.password = p; a.must_change_pw = a.username !== (sess && sess.username); demoSave(db); return later();
      },
      teacherLoginSettings: function () {
        if (!admin() || this.myRole() !== 'admin') return demoErr('Only an admin can see this.');
        var p = demoLoad().app_private || {}; return later({ auto: p.auto !== false, password: p.password || 'Tahfeez2026' });
      },
      saveTeacherLoginSettings: function (auto, pw) {
        if (!admin() || this.myRole() !== 'admin') return demoErr('Only an admin can change this.');
        if (!MZ.strongPw(pw)) return demoErr(MZ.STRONG_PW_MSG);
        var db = demoLoad(); db.app_private = { auto: !!auto, password: pw }; demoSave(db); return later();
      },
      createTeacherLogin: function (hrId, username) {
        if (!admin() || this.myRole() !== 'admin') return demoErr('Only an admin can create teacher logins.');
        var db = demoLoad(), t = (db.hr || []).find(function (x) { return x.kind === 'teacher' && String(x.id) === String(hrId); });
        if (!t) return demoErr('Teacher not found in HR → Teachers.');
        if (t.data.user_id && db.admins.some(function (a) { return a.user_id === t.data.user_id; })) return demoErr(t.data.full_name + ' already has a login.');
        var pw = (db.app_private || {}).password || 'Tahfeez2026', TITLES = ['mulla', 'mullah', 'janab', 'moallema', 'moalema', 'muallima', 'shaikh', 'sheikh', 'shk', 'mr', 'mrs', 'ms', 'bhai', 'behen', 'bai', 'ustad', 'ustadha', 'hafiz', 'hafiza', 'al'];
        var taken = function (u) { return db.admins.some(function (a) { return a.username === u; }) || db.students.some(function (x) { return x.username === u; }); };
        var u = String(username || '').trim().toLowerCase();
        if (!u) {
          var base;
          if (/^[0-9]{6,12}$/.test(t.data.its_no || '')) base = t.data.its_no;
          else { var w = String(t.data.full_name || '').toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(function (x) { return x && TITLES.indexOf(x) < 0; }); base = w.length ? (w.length > 1 ? w[0] + '.' + w[w.length - 1] : w[0]) : ''; if (base.length < 3) base = 'teacher' + hrId; base = base.slice(0, 26); }
          u = base; var n = 1; while (taken(u)) { n++; u = base + n; }
        } else if (taken(u)) return demoErr('The username "' + u + '" is already taken.');
        if (!MZ.validUsername(u)) return demoErr('Username "' + u + '" is not valid.');
        var id = 'staff-' + Date.now();
        db.admins.push({ user_id: id, username: u, password: pw, role: 'teacher', must_change_pw: true, created_at: new Date().toISOString() });
        t.data.user_id = id; t.updated_at = new Date().toISOString(); demoSave(db);
        return later({ user_id: id, username: u, password: pw });
      },
      myMustChangePw: function () { if (!admin()) return later(false); var db = demoLoad(), a = db.admins.find(function (x) { return sess && x.username === sess.username; }); return later(!!(a && a.must_change_pw)); },
      changeStaffPassword: function (pw) {
        if (!admin()) return demoErr('Please sign in again.');
        if (!MZ.strongPw(pw)) return demoErr(MZ.STRONG_PW_MSG);
        var db = demoLoad(), a = db.admins.find(function (x) { return sess && x.username === sess.username; }); if (!a) return demoErr('Staff account not found.');
        if (pw === ((db.app_private || {}).password || 'Tahfeez2026')) return demoErr('Choose a password different from the default one.');
        a.password = pw; a.must_change_pw = false; demoSave(db); return later();
      },
      getSettings: function () { return later(MZ.normSettings(clone(demoLoad().settings))); },
      saveSettings: function (patch) { if (!admin()) return demoErr('Your account is not allowed to do that.'); var db = demoLoad(); Object.assign(db.settings, patch); demoSave(db); return later(MZ.normSettings(clone(db.settings))); },
      listStudents: function () { if (!admin()) return demoErr('Your account is not allowed to do that.'); return later(demoLoad().students.map(normalizeStudent).sort(function (a, b) { return a.full_name.localeCompare(b.full_name); })); },
      createStudent: function (o) {
        if (!admin()) return demoErr('Only the institute can add students.');
        var db = demoLoad(), u = String(o.username || '').trim().toLowerCase();
        if (!MZ.validUsername(u)) return demoErr('Username "' + o.username + '" is not valid. Use 3 to 30 letters, numbers, dots, dashes or underscores.');
        if (String(o.password || '').length < 6) return demoErr('Password must be at least 6 characters.');
        if (!String(o.full_name || '').trim()) return demoErr('Student name is required.');
        if (db.students.some(function (x) { return x.username === u; }) || db.admins.some(function (x) { return x.username === u; })) return demoErr('The username "' + u + '" is already taken.');
        var id = 'demo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        db.students.push({ id: id, username: u, password: o.password, full_name: String(o.full_name).trim(), phone: o.phone || '', monthly_fee: Number(o.monthly_fee) || 0,
          start_month: o.start_month || MZ.thisMonth(), juz: +o.juz || 0, created_at: new Date().toISOString(), is_new: true });
        demoSave(db); return later(id);
      },
      updateStudent: function (id, patch) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var db = demoLoad(), s = db.students.find(function (x) { return x.id === id; }); if (!s) return demoErr('Student not found.');
        Object.assign(s, patch); demoSave(db); return later(normalizeStudent(s));
      },
      resetPassword: function (id, pw) {
        if (!admin()) return demoErr('Only the institute can reset passwords.');
        if (String(pw || '').length < 6) return demoErr('Password must be at least 6 characters.');
        var db = demoLoad(), s = db.students.find(function (x) { return x.id === id; }); if (!s) return demoErr('Student not found.');
        s.password = pw; demoSave(db); return later();
      },
      deleteStudent: function (id) {
        if (!admin()) return demoErr('Only the institute can remove students.');
        var db = demoLoad(); db.students = db.students.filter(function (x) { return x.id !== id; });
        db.payments = db.payments.filter(function (p) { return p.student_id !== id; }); demoSave(db); return later();
      },
      listPayments: function (f) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var list = demoLoad().payments.filter(function (p) {
          if (f && f.month && p.month !== f.month) return false;
          if (f && f.year && p.month.slice(0, 4) !== String(f.year)) return false;
          if (f && f.studentId && p.student_id !== f.studentId) return false;
          if (f && f.status && (p.status || 'approved') !== f.status) return false;
          return true;
        });
        return later(list.map(normalizePayment).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }));
      },
      recordPayment: function (p) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var db = demoLoad();
        if (db.payments.some(function (x) { return x.student_id === p.student_id && x.month === p.month; })) return demoErr('This month is already marked as paid.');
        db.seq++;
        var me = db.admins.find(function (x) { return sess && x.username === sess.username; }) || {}, isAdm = (me.role || 'admin') === 'admin';
        var row = { id: db.seq, receipt_no: 'QT-' + MZ.today().slice(2, 4) + '-' + pad(db.seq, 5), student_id: p.student_id, month: p.month, amount: Number(p.amount) || 0,
          method: p.method, paid_on: p.paid_on || MZ.today(), note: p.note || '', created_at: new Date().toISOString(), seen_at: null,
          status: isAdm ? 'approved' : 'pending', created_by: me.user_id || null, approved_at: isAdm ? new Date().toISOString() : null };
        db.payments.push(row); demoSave(db); return later(normalizePayment(row));
      },
      approvePayments: function (ids) {
        if (!admin() || this.myRole() !== 'admin') return demoErr('Only an admin can approve payments.');
        var db = demoLoad(), n = 0;
        db.payments.forEach(function (p) { if (ids.indexOf(p.id) >= 0 && p.status === 'pending') { p.status = 'approved'; p.approved_at = new Date().toISOString(); p.seen_at = null; n++; } });
        demoSave(db); return later(n);
      },
      deletePayment: function (id) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var row0 = demoLoad().payments.find(function (p) { return p.id === id; });
        if (row0 && row0.status !== 'pending' && this.myRole() !== 'admin') return demoErr('Only an admin can cancel an approved receipt.');
        if (row0 && this.myRole() === 'cashier') { var me0 = demoLoad().admins.find(function (x) { return sess && x.username === sess.username; }) || {}; if (row0.created_by !== me0.user_id) return demoErr('You can cancel only the payments you entered.'); }
        var db = demoLoad(); db.payments = db.payments.filter(function (p) { return p.id !== id; }); demoSave(db); return later();
      },
      me: function () { try { need('student'); } catch (e) { return Promise.reject(e); } var s = demoLoad().students.find(function (x) { return x.id === sess.id; }); return s ? later(normalizeStudent(s)) : demoErr('Your account was removed. Please contact the institute.'); },
      myPayments: function () { try { need('student'); } catch (e) { return Promise.reject(e); } return later(demoLoad().payments.filter(function (p) { return p.student_id === sess.id && p.status !== 'pending'; }).map(normalizePayment).sort(function (a, b) { return a.month < b.month ? 1 : -1; })); },
      markSeen: function (id) { var db = demoLoad(); db.payments.forEach(function (p) { if (p.id === id && sess && p.student_id === sess.id && !p.seen_at) p.seen_at = new Date().toISOString(); }); demoSave(db); return later(); },
      changePassword: function (pw) {
        if (String(pw || '').length < 6) return demoErr('Password must be at least 6 characters.');
        var db = demoLoad(), s = db.students.find(function (x) { return sess && x.id === sess.id; }); if (s) s.password = pw; demoSave(db); return later();
      },
      watchPayments: function (cb) {
        var onStore = function (e) { if (e.key === DKEY) cb(); };
        var onVis = function () { if (document.visibilityState === 'visible') cb(); };
        window.addEventListener('storage', onStore); document.addEventListener('visibilitychange', onVis);
        var t = setInterval(cb, 5000);
        return function () { window.removeEventListener('storage', onStore); document.removeEventListener('visibilitychange', onVis); clearInterval(t); };
      },
      resetDemo: function () { try { localStorage.removeItem(DKEY); } catch (e) {} },
      /* keys & progress (mirrors the database functions) */
      listProgress: function (f) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        return later(demoLoad().progress.filter(function (r) { return (!f || !f.month || r.month === f.month) && (!f || !f.studentId || r.student_id === f.studentId); }).map(normalizeProgress));
      },
      myProgress: function () { var id = sess && sess.id; return later(demoLoad().progress.filter(function (r) { return r.student_id === id; }).map(normalizeProgress).sort(function (a, b) { return a.month < b.month ? -1 : 1; })); },
      listKeyEvents: function (sid, limit) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        return later(demoLoad().events.filter(function (e) { return e.student_id === sid; }).sort(function (a, b) { return b.id - a.id; }).slice(0, limit || 50));
      },
      myKeyEvents: function () { var id = sess && sess.id; return later(demoLoad().events.filter(function (e) { return e.student_id === id; }).sort(function (a, b) { return b.id - a.id; }).slice(0, 40)); },
      recordJadeed: function (sid, month, pages) {
        if (!admin()) return demoErr('Only the institute can record progress.');
        pages = +pages || 1; if (pages < 1 || pages > 100) return demoErr('Pages must be between 1 and 100.');
        var db = demoLoad(), st = db.students.find(function (x) { return x.id === sid; }); if (!st) return demoErr('Student not found.');
        var k = db.settings.keys_jadeed, r = demoMonth(db, st, month); demoMonth(db, st, MZ.thisMonth());
        demoHifzSet(db, st, (+st.pages || 0) + pages); st.keys = (+st.keys || 0) + k * pages;
        r.jadeed += pages; r.pages_end = st.pages;
        var ev = demoEvent(db, sid, 'jadeed', k * pages, pages, month, pages === 1 ? 'Jadeed page cleared' : 'Jadeed: ' + pages + ' pages cleared');
        var g = demoGoal(db, st, r); demoSave(db);
        return later({ event_id: ev.id, goal_reached: g, pages: st.pages, keys: st.keys });
      },
      recordIkhtibar: function (sid, month, note) {
        if (!admin()) return demoErr('Only the institute can record progress.');
        var db = demoLoad(), st = db.students.find(function (x) { return x.id === sid; }); if (!st) return demoErr('Student not found.');
        var title = String(note || '').trim() || 'Ikhtibar';
        var ev = demoAwardIkh(db, st, month, 'Ikhtibar cleared' + (title !== 'Ikhtibar' ? ': ' + title : ''));
        db.ikhtibars = db.ikhtibars || []; db.ikseq = (db.ikseq || 0) + 1;
        db.ikhtibars.push({ id: db.ikseq, student_id: sid, exam_date: month === MZ.thisMonth() ? MZ.today() : month + '-01', title: title, status: 'cleared', note: '', key_event_id: ev.id, quick: true, created_at: new Date().toISOString() });
        demoSave(db); return later({ event_id: ev.id, keys: st.keys });
      },
      setGoal: function (sid, month, goal) {
        if (!admin()) return demoErr('Only the institute can set goals.');
        goal = +goal; if (!(goal >= 0 && goal <= 604)) return demoErr('Goal must be between 0 and 604 pages.');
        var db = demoLoad(), n = 0;
        db.students.forEach(function (st) {
          if (sid ? st.id !== sid : st.disabled_at) return; var r = demoMonth(db, st, month); r.goal = goal;
          var gc = goal && r.start_page != null ? Math.min(604, r.start_page + goal) : null, dir = MZ.hifzDir(st);
          r.goal_page = gc; r.goal_pos = gc ? MZ.countToPos(gc, dir) : null; r.goal_surah = r.goal_pos ? MZ.pageSurah(r.goal_pos, dir) : null; demoGoal(db, st, r); n++;
        });
        demoSave(db); return later(n);
      },
      /* admin corrections (mirror admin_correct_goal & co) */
      adminCorrectGoal: function (sid, month, o) {
        if (!admin() || this.myRole() !== 'admin') return demoErr('Only an administrator can correct goals and pages.');
        var db = demoLoad(), st = db.students.find(function (x) { return x.id === sid; }); if (!st) return demoErr('Student not found.');
        var who = (db.admins.find(function (x) { return sess && x.username === sess.username; }) || {}).username || 'admin';
        var audit = function (what, a, b) { db.audit = db.audit || []; db.auditSeq = (db.auditSeq || 0) + 1; db.audit.push({ id: db.auditSeq, student_id: sid, month: month, what: what, old_value: a, new_value: b, note: o.note || '', changed_by_name: who, created_at: new Date().toISOString() }); };
        var r = demoMonth(db, st, month), cur = MZ.thisMonth(), k = db.settings.keys_jadeed;
        if (o.dir && o.dir !== st.hifz_dir) {
          audit('Direction', st.hifz_dir || 'not set', o.dir); st.hifz_dir = o.dir; st.hifz_dir_manual = true; st.hifz_base = null; st.hifz_credited = null;
          if (st.cur_pos) st.pages = MZ.posToCount(st.cur_pos, o.dir);
          db.progress.filter(function (x) { return x.student_id === sid; }).forEach(function (x) { if (x.start_pos) x.start_page = MZ.posToCount(x.start_pos, o.dir); if (x.end_pos) x.pages_end = MZ.posToCount(x.end_pos, o.dir); });
        }
        var dir = st.hifz_dir; if (!dir && (o.start_pos || o.reached_pos)) return demoErr('Set the memorisation direction first.');
        if (o.start_pos && +o.start_pos !== r.start_pos) { audit('Started at', r.start_pos ? 'page ' + r.start_pos : 'not set', 'page ' + o.start_pos); r.start_pos = +o.start_pos; r.start_page = MZ.posToCount(r.start_pos, dir); r.start_surah = MZ.pageSurah(r.start_pos, dir); }
        if (o.goal != null && o.goal !== '' && +o.goal !== (r.goal || 0)) { audit('Monthly goal', (r.goal || 0) + ' pages', +o.goal + ' pages'); r.goal = +o.goal; }
        if (o.reached_pos) {
          if (month >= cur) { if (+o.reached_pos !== st.cur_pos) { audit('Current page', st.cur_pos ? 'page ' + st.cur_pos : 'not set', 'page ' + o.reached_pos);
            var oldC = st.cur_pos ? MZ.posToCount(st.cur_pos, dir) : (+st.pages || 0), nc = MZ.posToCount(+o.reached_pos, dir);
            if (st.hifz_base != null && nc < (st.hifz_credited == null ? oldC : st.hifz_credited)) { st.keys = Math.max(0, st.keys - k * Math.max(0, st.hifz_credited - Math.max(nc, st.hifz_base))); st.hifz_credited = Math.max(nc, st.hifz_base); }
            demoHifzSet(db, st, nc); } }
          else if (+o.reached_pos !== r.end_pos) { audit('Reached', r.end_pos ? 'page ' + r.end_pos : 'not set', 'page ' + o.reached_pos); r.end_pos = +o.reached_pos; r.pages_end = MZ.posToCount(r.end_pos, dir); r.end_surah = MZ.pageSurah(r.end_pos, dir); }
        }
        r.goal_page = r.goal > 0 && r.start_page != null ? Math.min(604, r.start_page + r.goal) : null; r.goal_pos = r.goal_page && dir ? MZ.countToPos(r.goal_page, dir) : null; r.goal_surah = r.goal_pos ? MZ.pageSurah(r.goal_pos, dir) : null;
        if (month === cur && r.start_page != null && r.pages_end != null) r.jadeed = Math.max(0, r.pages_end - r.start_page);
        demoRecheckGoal(db, st, r, audit); demoSave(db); return later({ ok: true });
      },
      adminDeleteGoal: function (sid, month, note) {
        if (!admin() || this.myRole() !== 'admin') return demoErr('Only an administrator can delete goals.');
        var db = demoLoad(), st = db.students.find(function (x) { return x.id === sid; }), r = db.progress.find(function (x) { return x.student_id === sid && x.month === month; });
        if (!st || !r || !(r.goal > 0)) return demoErr('There is no goal for this month.');
        db.audit = db.audit || []; db.auditSeq = (db.auditSeq || 0) + 1; db.audit.push({ id: db.auditSeq, student_id: sid, month: month, what: 'Monthly goal deleted', old_value: r.goal + ' pages', new_value: null, note: note || '', changed_by_name: 'admin', created_at: new Date().toISOString() });
        r.goal = 0; r.goal_page = null; r.goal_pos = null; r.goal_surah = null; demoRecheckGoal(db, st, r); demoSave(db); return later();
      },
      adminDeleteStart: function (sid, month, note) {
        if (!admin() || this.myRole() !== 'admin') return demoErr('Only an administrator can delete a starting point.');
        var db = demoLoad(), st = db.students.find(function (x) { return x.id === sid; }), r = db.progress.find(function (x) { return x.student_id === sid && x.month === month; });
        if (!st || !r || (r.start_pos == null && r.start_page == null)) return demoErr('There is no starting point for this month.');
        var prev = db.progress.filter(function (x) { return x.student_id === sid && x.month < month && x.pages_end != null; }).sort(function (a, b) { return a.month < b.month ? 1 : -1; })[0];
        db.audit = db.audit || []; db.auditSeq = (db.auditSeq || 0) + 1; db.audit.push({ id: db.auditSeq, student_id: sid, month: month, what: 'Started at deleted', old_value: r.start_pos ? 'page ' + r.start_pos : r.start_page + ' pages', new_value: prev && prev.end_pos ? 'page ' + prev.end_pos : 'empty', note: note || '', changed_by_name: 'admin', created_at: new Date().toISOString() });
        r.start_page = prev ? prev.pages_end : null; r.start_pos = prev ? prev.end_pos || null : null; r.start_surah = prev ? prev.end_surah || null : null;
        r.goal_page = r.goal > 0 && r.start_page != null ? Math.min(604, r.start_page + r.goal) : null; r.goal_pos = r.goal_page && st.hifz_dir ? MZ.countToPos(r.goal_page, st.hifz_dir) : null;
        demoRecheckGoal(db, st, r); demoSave(db); return later();
      },
      adminDeleteEntry: function (eventId, note) {
        if (!admin() || this.myRole() !== 'admin') return demoErr('Only an administrator can delete page entries.');
        var self = this, db = demoLoad(), e = db.events.find(function (x) { return x.id === +eventId; }); if (!e) return demoErr('This entry was already removed.');
        if (e.kind !== 'jadeed') return demoErr('Only memorisation entries can be deleted here.');
        db.audit = db.audit || []; db.auditSeq = (db.auditSeq || 0) + 1; db.audit.push({ id: db.auditSeq, student_id: e.student_id, month: e.month, what: 'Page entry deleted', old_value: (e.note || '') + ' (' + e.pages + ' pages, ' + e.keys + ' keys)', new_value: null, note: note || '', changed_by_name: 'admin', created_at: new Date().toISOString() });
        demoSave(db);
        return this.undoKeyEvent(+eventId).then(function () { var db2 = demoLoad(), st = db2.students.find(function (x) { return x.id === e.student_id; }), r = db2.progress.find(function (x) { return x.student_id === e.student_id && x.month === MZ.thisMonth(); });
          if (r && r.start_page != null && r.pages_end != null) r.jadeed = Math.max(0, r.pages_end - r.start_page);
          var re = db2.progress.find(function (x) { return x.student_id === e.student_id && x.month === e.month; }); if (st && re) demoRecheckGoal(db2, st, re); demoSave(db2); return { ok: true, pages: st ? st.pages : null, cur_pos: st ? st.cur_pos : null }; });
      },
      listHifzAudit: function (sid) { if (!admin() || this.myRole() !== 'admin') return later([]); return later(clone((demoLoad().audit || []).filter(function (a) { return a.student_id === sid; })).sort(function (a, b) { return b.id - a.id; })); },
      addMemorizedPages: function (sid, page, from, confirm) {
        if (!admin()) return demoErr('Only teachers can record memorised pages.');
        page = +page; if (!(page >= 1 && page <= 604)) return demoErr('Enter a page number between 1 and 604.');
        var db = demoLoad(), st = db.students.find(function (x) { return x.id === sid; }); if (!st) return demoErr('Student not found.');
        if (!st.hifz_dir) return demoErr("Set this student's memorisation direction (forward or reverse) first.");
        if ((from == null ? null : +from) !== (st.cur_pos || null)) return later({ status: 'changed', cur_pos: st.cur_pos || null, pages: st.pages, message: 'This was already updated: the current page is now ' + (st.cur_pos || 'not set') + '. Nothing was counted twice.' });
        var dir = st.hifz_dir, first = !st.cur_pos, oldC = first ? (+st.pages || 0) : MZ.posToCount(st.cur_pos, dir), newC = MZ.posToCount(page, dir), d = newC - oldC;
        if (!first && d === 0) return later({ status: 'same', cur_pos: st.cur_pos, pages: st.pages, message: 'No new pages: page ' + page + ' is already the current page.' });
        if (!first && !confirm && (d < 0 || d > 40)) return later({ status: 'confirm', delta: d, cur_pos: st.cur_pos, pages: st.pages,
          message: d < 0 ? 'Page ' + page + ' is behind the current page ' + st.cur_pos + ' for a ' + (dir === 'backward' ? 'reverse' : 'forward') + ' student. Save it as a correction (' + Math.abs(d) + ' page' + (Math.abs(d) === 1 ? '' : 's') + ' taken off)?' : 'That is ' + d + ' new pages since page ' + st.cur_pos + '. Is that right?' });
        var cur = MZ.thisMonth(), r = demoMonth(db, st, cur), k = db.settings.keys_jadeed, ev = null, before = +st.keys || 0;
        if (st.hifz_base == null) { st.hifz_base = oldC; st.hifz_credited = Math.max(st.hifz_credited || oldC, oldC); }
        if (first) {
          demoHifzSet(db, st, newC); st.hifz_base = newC; st.hifz_credited = newC;
          if (!r.jadeed) { r.start_page = newC; r.start_pos = page; r.start_surah = MZ.pageSurah(page, dir); } d = 0;
        } else {
          demoHifzSet(db, st, newC);
          if (d > 0) { st.keys = before + k * Math.max(0, newC - Math.max(oldC, st.hifz_credited == null ? oldC : st.hifz_credited)); st.hifz_credited = Math.max(st.hifz_credited == null ? oldC : st.hifz_credited, newC); }
          else { st.keys = Math.max(0, before - k * Math.max(0, (st.hifz_credited == null ? oldC : st.hifz_credited) - Math.max(newC, st.hifz_base || 0))); st.hifz_credited = Math.max(newC, st.hifz_base || 0); }
          r.jadeed = r.start_page != null ? Math.max(0, r.pages_end - r.start_page) : Math.max(0, (r.jadeed || 0) + d);
          ev = demoEvent(db, sid, 'jadeed', st.keys - before, d, cur, d > 0 ? 'Memorised to page ' + page + ' (+' + d + ' page' + (d === 1 ? '' : 's') + ')' : 'Correction: back to page ' + page + ' (' + d + ' pages)');
        }
        var g = demoGoal(db, st, r); demoSave(db);
        return later({ status: first ? 'started' : d < 0 ? 'corrected' : 'added', event_id: ev && ev.id, new_pages: d, cur_pos: st.cur_pos, pages: st.pages, keys: st.keys, goal_reached: g,
          month_done: Math.max(0, (r.pages_end || 0) - (r.start_page != null ? r.start_page : r.pages_end || 0)), month_goal: r.goal || 0 });
      },
      setNowAt: function (sid, surah, pos) {
        if (!admin()) return demoErr('Only teachers can update hifz.');
        var db = demoLoad(), st = db.students.find(function (x) { return x.id === sid; }); if (!st) return demoErr('Student not found.');
        surah = surah ? +surah : null; pos = pos ? +pos : null;
        if (surah && !(surah >= 1 && surah <= 114)) return demoErr('Surah must be 1 to 114.'); if (pos && !(pos >= 1 && pos <= 604)) return demoErr('Page must be 1 to 604.');
        if (!pos && surah) pos = MZ.SURAHS[surah][2];
        var first = !st.cur_pos && !(+st.pages > 0); demoMonth(db, st, MZ.thisMonth());
        if (!pos) { demoHifzSet(db, st, 0); demoSave(db); return later({ pages: 0, cur_pos: null, dir: MZ.hifzDir(st) }); }
        if (!st.hifz_dir) return demoErr("Set this student's memorisation direction (forward or reverse) first.");
        demoHifzSet(db, st, MZ.posToCount(pos, st.hifz_dir), surah);
        if (first) { var r = demoMonth(db, st, MZ.thisMonth()); if (!r.jadeed) { r.start_page = st.pages; r.start_pos = st.cur_pos; r.start_surah = st.cur_surah; } }
        demoSave(db); return later({ pages: st.pages, cur_pos: st.cur_pos, dir: st.hifz_dir });
      },
      setHifzDir: function (sid, dir) {
        if (!admin()) return demoErr('Only teachers can update hifz.'); if (dir !== 'forward' && dir !== 'backward') return demoErr('Choose forward or backward.');
        var db = demoLoad(), st = db.students.find(function (x) { return x.id === sid; }); if (!st) return demoErr('Student not found.');
        var pos = st.cur_pos; st.hifz_dir = dir; st.hifz_dir_manual = true; if (pos) demoHifzSet(db, st, MZ.posToCount(pos, dir), st.cur_surah);
        demoSave(db); return later({ dir: dir, pages: st.pages });
      },
      setPages: function (sid, month, pages) {
        if (!admin()) return demoErr('Only the institute can update pages.');
        pages = +pages; if (!(pages >= 0 && pages <= 604)) return demoErr('Pages must be between 0 and 604.');
        var db = demoLoad(), st = db.students.find(function (x) { return x.id === sid; }); if (!st) return demoErr('Student not found.');
        demoHifzSet(db, st, pages); demoSave(db); return later();
      },
      undoKeyEvent: function (id) {
        if (!admin()) return demoErr('Only the institute can undo progress.');
        var db = demoLoad(), e = db.events.find(function (x) { return x.id === id; }); if (!e) return demoErr('This entry was already removed.');
        var st = db.students.find(function (x) { return x.id === e.student_id; });
        if (st) { st.keys = Math.max(0, st.keys - e.keys); if (e.pages > 0) demoHifzSet(db, st, Math.max(0, st.pages - e.pages)); }
        var r = db.progress.find(function (x) { return x.student_id === e.student_id && x.month === e.month; });
        if (r) {
          if (e.kind === 'jadeed') { r.jadeed = Math.max(0, r.jadeed - e.pages); r.pages_end = st ? st.pages : r.pages_end; }
          else if (e.kind === 'ikhtibar') r.ikhtibar = Math.max(0, r.ikhtibar - 1);
          else if (e.kind === 'goal') r.goal_awarded = false;
        }
        if (e.kind === 'ikhtibar' && db.ikhtibars) {
          db.ikhtibars = db.ikhtibars.filter(function (x) { return !(x.key_event_id === e.id && x.quick); });
          db.ikhtibars.forEach(function (x) { if (x.key_event_id === e.id) { x.status = 'scheduled'; x.key_event_id = null; } });
        }
        db.events = db.events.filter(function (x) { return x.id !== id; }); demoSave(db); return later();
      },
      saveMonthReport: function (sid, month, o) {
        if (!admin()) return demoErr('Only the institute can save reports.');
        function num(v) { return v === '' || v == null ? null : +v; }
        var sp = num(o.start_page), gp = num(o.goal_page), ep = num(o.pages_end);
        if ([sp, gp, ep].some(function (v) { return v != null && !(v >= 0 && v <= 604); })) return demoErr('Pages must be between 0 and 604.');
        if (gp != null && sp != null && gp <= sp) return demoErr('The goal page must be after the starting page.');
        var db = demoLoad(), st = db.students.find(function (x) { return x.id === sid; }); if (!st) return demoErr('Student not found.');
        var r = demoMonth(db, st, month);
        if (gp != null && sp != null && gp <= sp) return demoErr('Pages to memorise must be more than 0.');
        if (sp != null) r.start_page = sp; r.goal_page = gp; if (ep != null) r.pages_end = ep; r.goal = gp != null && r.start_page != null ? gp - r.start_page : 0;
        ['start_surah', 'start_pos', 'end_surah', 'end_pos'].forEach(function (k) { if (o[k]) r[k] = +o[k]; });
        r.goal_surah = o.goal_surah ? +o.goal_surah : null; r.goal_pos = o.goal_pos ? +o.goal_pos : null;
        r.ajza_improve = String(o.ajza_improve || '').trim(); r.ahkaam = String(o.ahkaam || '').trim(); if (o.murajaat != null && o.murajaat !== '') r.murajaat = num(o.murajaat); r.dawrat = num(o.dawrat); r.report_note = String(o.report_note || '').trim();
        if (month >= MZ.thisMonth()) { if (o.end_pos) demoHifzSet(db, st, MZ.posToCount(+o.end_pos, MZ.hifzDir(st)), o.end_surah); else if (ep != null) demoHifzSet(db, st, ep); }
        var g = demoGoal(db, st, r); demoSave(db); return later({ goal_reached: g, keys: st.keys });
      },
      listIkhtibars: function (f) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        return later(clone(demoLoad().ikhtibars || []).filter(function (x) { return (!f || !f.studentId || x.student_id === f.studentId) && (!f || !f.from || x.exam_date >= f.from); })
          .sort(function (a, b) { return a.exam_date < b.exam_date ? -1 : a.exam_date > b.exam_date ? 1 : a.id - b.id; }).map(normalizeIkhtibar));
      },
      myIkhtibars: function () { var id = sess && sess.id; return later(clone(demoLoad().ikhtibars || []).filter(function (x) { return x.student_id === id; }).sort(function (a, b) { return a.exam_date < b.exam_date ? -1 : 1; }).map(normalizeIkhtibar)); },
      scheduleIkhtibar: function (o) {
        if (!admin()) return demoErr('Only the institute can schedule an ikhtibar.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(o.exam_date || '')) return demoErr('Please choose the date.');
        var db = demoLoad(); db.ikhtibars = db.ikhtibars || [];
        (o.studentIds || []).forEach(function (id) { db.ikseq = (db.ikseq || 0) + 1; db.ikhtibars.push({ id: db.ikseq, student_id: id, exam_date: o.exam_date, title: o.title || 'Ikhtibar', status: 'scheduled', note: o.note || '', key_event_id: null, quick: false, created_at: new Date().toISOString() }); });
        demoSave(db); return later((o.studentIds || []).length);
      },
      updateIkhtibar: function (id, p) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var db = demoLoad(), x = (db.ikhtibars || []).find(function (i) { return i.id === id; }); if (!x) return demoErr('Ikhtibar not found.');
        x.exam_date = p.exam_date; x.title = p.title || 'Ikhtibar'; x.note = p.note || ''; demoSave(db); return later();
      },
      ikhtibarResult: function (id, status, note) {
        if (!admin()) return demoErr('Only the institute can record results.');
        var self = this, db = demoLoad(), x = (db.ikhtibars || []).find(function (i) { return i.id === id; }); if (!x) return demoErr('Ikhtibar not found.');
        var pre = x.key_event_id && status !== 'cleared' ? self.undoKeyEvent(x.key_event_id) : Promise.resolve();
        return pre.then(function () {
          var db = demoLoad(), x = db.ikhtibars.find(function (i) { return i.id === id; }); if (!x) return { event_id: null };
          var ev = null, st = db.students.find(function (s) { return s.id === x.student_id; });
          if (status === 'cleared' && x.status !== 'cleared' && st) ev = demoAwardIkh(db, st, x.exam_date.slice(0, 7), 'Ikhtibar cleared: ' + x.title);
          x.status = status; if (note) x.note = note; x.key_event_id = status === 'cleared' ? (ev ? ev.id : x.key_event_id) : null;
          demoSave(db); return { event_id: ev && ev.id, keys: st && st.keys };
        });
      },
      deleteIkhtibar: function (x) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var self = this;
        return (x.key_event_id ? self.undoKeyEvent(x.key_event_id) : Promise.resolve()).then(function () {
          var db = demoLoad(); db.ikhtibars = (db.ikhtibars || []).filter(function (i) { return i.id !== x.id; }); demoSave(db);
        });
      },
      listKeyRules: function () { return later(clone(demoLoad().rules || [])); },
      saveKeyRule: function (r) {
        if (!admin()) return demoErr('Only the institute can change key rules.');
        var name = String(r.name || '').trim(), k = parseInt(r.keys, 10);
        if (!name) return demoErr('Give the rule a name.');
        if (!(k >= -100 && k <= 100) || !k) return demoErr('Keys must be between -100 and 100, and not 0.');
        var db = demoLoad(); db.rules = db.rules || [];
        var row = r.id ? db.rules.find(function (x) { return x.id === r.id; }) : null;
        if (!row) { db.ruleseq = (db.ruleseq || 0) + 1; row = { id: db.ruleseq, sort: 0, created_at: new Date().toISOString() }; db.rules.push(row); }
        row.name = name; row.keys = k; row.active = r.active !== false; demoSave(db); return later(clone(row));
      },
      deleteKeyRule: function (id) {
        if (!admin()) return demoErr('Only the institute can change key rules.');
        var db = demoLoad(); db.rules = (db.rules || []).filter(function (x) { return x.id !== id; }); demoSave(db); return later();
      },
      leaderboard: function (month) {
        var db = demoLoad(), me = sess && sess.role === 'student' ? sess.id : null, sum = {};
        db.events.forEach(function (e) { if (e.month === month && e.keys > 0) sum[e.student_id] = (sum[e.student_id] || 0) + e.keys; });
        var list = db.students.filter(function (st) { return !st.disabled_at && sum[st.id] > 0; }).map(function (st) { return { id: st.id, first_name: String(st.full_name).trim().split(/\s+/)[0], keys: sum[st.id] }; })
          .sort(function (a, b) { return b.keys - a.keys || a.first_name.localeCompare(b.first_name); });
        var out = [], rank = 0, prev = null;
        list.forEach(function (x, i) { if (x.keys !== prev) { rank = i + 1; prev = x.keys; } if (rank <= 10 || x.id === me) out.push({ rank: rank, first_name: x.first_name, keys: x.keys, is_me: x.id === me }); });
        return later(out);
      },
      listKeyEventsMonth: function (month) { if (!admin()) return demoErr('Your account is not allowed to do that.'); return later(clone(demoLoad().events.filter(function (e) { return e.month === month; }))); },
      awardRule: function (sids, ruleId, month, note) {
        if (!admin()) return demoErr('Only the institute can give keys.');
        var db = demoLoad(), r = (db.rules || []).find(function (x) { return x.id === ruleId; }); if (!r) return demoErr('This key rule no longer exists.');
        var n = 0;
        (sids || []).forEach(function (sid) {
          var st = db.students.find(function (x) { return x.id === sid; }); if (!st) return;
          var old = +st.keys || 0; st.keys = Math.max(0, old + r.keys);
          demoEvent(db, sid, 'bonus', st.keys - old, 0, month, r.name + (note ? ': ' + note : '')); n++;
        });
        demoSave(db); return later(n);
      },
      giveReward: function (sid) {
        if (!admin()) return demoErr('Only the institute can mark rewards.');
        var db = demoLoad(), st = db.students.find(function (x) { return x.id === sid; });
        if (!st || (st.rewards_given || 0) >= Math.floor(st.keys / db.settings.reward_every)) return demoErr('No reward is due for this student.');
        st.rewards_given = (st.rewards_given || 0) + 1; demoSave(db); return later(st.rewards_given);
      },
      markRewardSeen: function (level) {
        var db = demoLoad(), st = db.students.find(function (x) { return sess && x.id === sess.id; });
        if (st) st.rewards_seen = Math.max(st.rewards_seen || 0, Math.min(level, Math.floor(st.keys / db.settings.reward_every)));
        demoSave(db); return later();
      },
      watchKeys: function (cb) { return function () {}; },
      listAttendance: function (from, to) {
        var db = demoLoad(), mine = this._myStudentIds ? this._myStudentIds(db) : null;
        return later(clone((db.attendance || []).filter(function (r) { return r.att_date >= from && r.att_date <= to && (!mine || mine.indexOf(r.student_id) >= 0); })));
      },
      markAttendance: function (date, rows) {
        var db = demoLoad(), today = MZ.today(), admin = !this.myRole || this.myRole() === 'admin', who = (sess && (sess.full_name || sess.username)) || 'Admin';
        if (date > today) return demoErr('Attendance cannot be taken for a day that has not come yet.');
        var w = new Date(today + 'T12:00:00'); w.setDate(w.getDate() - 7);
        if (!admin && date < w.toISOString().slice(0, 10)) return demoErr('Teachers can take or change attendance for the last 7 days only. Ask the admin for older days.');
        db.attendance = db.attendance || []; db.attSeq = db.attSeq || 0; var n = 0;
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i], st = r.status || '';
          if (st && ['present', 'late', 'absent', 'excused'].indexOf(st) < 0) return demoErr('Unknown attendance mark.');
          if (!db.students.some(function (x) { return x.id === r.student_id; })) return demoErr('Student not found.');
          var ex = db.attendance.find(function (x) { return x.student_id === r.student_id && x.att_date === date; });
          if (!st) { db.attendance = db.attendance.filter(function (x) { return x !== ex; }); n++; continue; }
          var row = { student_id: r.student_id, att_date: date, status: st, minutes_late: st === 'late' && r.minutes_late != null ? +r.minutes_late : null, note: r.note ? String(r.note).slice(0, 200) : null, marked_by_name: who, updated_at: new Date().toISOString() };
          if (ex) Object.assign(ex, row); else db.attendance.push(Object.assign({ id: ++db.attSeq, created_at: row.updated_at }, row));
          n++;
        }
        demoSave(db); return later(n);
      },
      watchAttendance: function (cb) { var h = function (e) { if (e.key === DKEY) cb(); }; window.addEventListener('storage', h); return function () { window.removeEventListener('storage', h); }; },
      listReminders: function () { return later(clone(demoLoad().reminders)); },
      sendReminder: function (sid, message, amount) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var db = demoLoad(), r = { id: (db.reminders.reduce(function (m, x) { return Math.max(m, x.id); }, 0)) + 1, student_id: sid, message: message, amount: amount, created_at: new Date().toISOString(), seen_at: null };
        db.reminders.push(r); demoSave(db); return later(clone(r));
      },
      myReminders: function () { var id = sess && sess.id; return later(clone(demoLoad().reminders).filter(function (r) { return r.student_id === id; }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })); },
      markReminderSeen: function (id) { var db = demoLoad(); db.reminders.forEach(function (r) { if (r.id === id && sess && r.student_id === sess.id) r.seen_at = new Date().toISOString(); }); demoSave(db); return later(); },
      teachersForStudents: function () {
        return later((demoLoad().hr || []).filter(function (h) { return h.kind === 'teacher' && h.data.status !== 'Left'; })
          .map(function (h) { return { id: h.id, full_name: h.data.full_name, role: h.data.role || '' }; }).sort(function (a, b) { return a.full_name.localeCompare(b.full_name); }));
      },
      myTeacherRatings: function () { var id = sess && sess.id; return later(clone((demoLoad().feedback || []).filter(function (f) { return f.student_id === id; }))); },
      rateTeacher: function (tid, month, scores, comment) {
        var db = demoLoad(), id = sess && sess.id, clean = {};
        for (var i = 0; i < MZ.TEACHER_CRITERIA.length; i++) { var k = MZ.TEACHER_CRITERIA[i][0], v = +scores[k]; if (!(v >= 1 && v <= 5)) return demoErr('Please give every question 1 to 5 stars.'); clean[k] = v; }
        db.feedback = db.feedback || [];
        var row = db.feedback.find(function (f) { return f.teacher_id === tid && f.student_id === id && f.month === month; });
        if (!row) { db.fbseq = (db.fbseq || 0) + 1; row = { id: db.fbseq, teacher_id: tid, student_id: id, month: month, created_at: new Date().toISOString() }; db.feedback.push(row); }
        row.scores = clean; row.comment = String(comment || '').trim().slice(0, 500); row.updated_at = new Date().toISOString(); demoSave(db); return later();
      },
      teacherFeedback: function (from, to) {
        if (!admin()) return demoErr('Only the institute can see teacher feedback.');
        var g = {};
        (demoLoad().feedback || []).forEach(function (f) {
          if (f.month < from || f.month > to) return;
          var k = f.teacher_id + '|' + f.month; g[k] = g[k] || { teacher_id: f.teacher_id, month: f.month, responses: 0, sums: {}, comments: [] };
          g[k].responses++; MZ.TEACHER_CRITERIA.forEach(function (c) { g[k].sums[c[0]] = (g[k].sums[c[0]] || 0) + f.scores[c[0]]; }); if (f.comment) g[k].comments.push(f.comment);
        });
        return later(Object.keys(g).map(function (k) { var x = g[k], a = {}; MZ.TEACHER_CRITERIA.forEach(function (c) { a[c[0]] = Math.round(x.sums[c[0]] / x.responses * 100) / 100; }); return { teacher_id: x.teacher_id, month: x.month, responses: x.responses, avg_scores: a, comments: x.comments }; }));
      },
      listFinance: function (f) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var dbF = demoLoad(), meL = dbF.admins.find(function (x) { return sess && x.username === sess.username; }) || {};
        return later((dbF.finance || []).filter(function (e) { return (meL.role !== 'cashier' || e.created_by === meL.user_id) && (!f || !f.from || e.entry_date >= f.from) && (!f || !f.to || e.entry_date <= f.to); })
          .sort(function (a, b) { return a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : b.id - a.id; }).map(normalizeFinance));
      },
      saveFinance: function (e) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        if (!(Number(e.amount) > 0)) return demoErr('Amount must be more than 0.');
        var db = demoLoad(); db.finance = db.finance || [];
        var row = e.id ? db.finance.find(function (x) { return x.id === e.id; }) : null;
        var meF = db.admins.find(function (x) { return sess && x.username === sess.username; }) || {};
        if (row && (meF.role === 'cashier')) return demoErr('Only Accounts or the admin can change an entry.');
        if (meF.role === 'cashier' && e.kind !== 'income' && e.kind !== 'expense') return demoErr('The cashier can add income and expenses only.');
        if (!row) { db.finseq = (db.finseq || 0) + 1; row = { id: db.finseq, created_at: new Date().toISOString(), created_by: meF.user_id || null }; db.finance.push(row); }
        Object.assign(row, { kind: e.kind, category: e.category, amount: Number(e.amount), entry_date: e.entry_date || MZ.today(), party: e.party || '', note: e.note || '', account: e.account === 'bank' ? 'bank' : 'cash', to_account: e.kind === 'transfer' ? (e.account === 'bank' ? 'cash' : 'bank') : null });
        demoSave(db); return later(normalizeFinance(row));
      },
      deleteFinance: function (id) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var db = demoLoad(); db.finance = (db.finance || []).filter(function (e) { return e.id !== id; }); demoSave(db); return later();
      },
      listHR: function () { if (!admin()) return demoErr('Your account is not allowed to do that.'); return later(clone(demoLoad().hr || []).map(normalizeHR)); },
      saveHR: function (r) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var db = demoLoad(); db.hr = db.hr || [];
        var row = r.id ? db.hr.find(function (x) { return x.id === r.id; }) : null;
        if (!row) { db.hrseq = (db.hrseq || 0) + 1; row = { id: db.hrseq, kind: r.kind, created_at: new Date().toISOString() }; db.hr.push(row); }
        row.data = clone(r.data); row.updated_at = new Date().toISOString(); demoSave(db); return later(normalizeHR(clone(row)));
      },
      deleteHR: function (id) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var db = demoLoad(); db.hr = (db.hr || []).filter(function (x) { return x.id !== id; }); demoSave(db); return later();
      },
      myHrItems: function () {
        var db = demoLoad(), me = db.admins.find(function (x) { return sess && x.username === sess.username; }) || {};
        var t = (db.hr || []).find(function (x) { return x.kind === 'teacher' && me.user_id && x.data.user_id === me.user_id; }); if (!t) return later([]);
        return later((db.hr || []).filter(function (x) { return (x.kind === 'duty' || x.kind === 'goal') && String(x.data.teacher_id) === String(t.id); }).map(function (x) { var c = clone(x); delete c.data.notes; return normalizeHR(c); }));
      },
      uploadProof: function (p, file) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var bad = MZ.proofCheck(file); if (bad) return demoErr(bad);
        return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { res(null); }; fr.readAsDataURL(file); }).then(function (data) {
          var db = demoLoad(), row = db.payments.find(function (x) { return x.id === p.id; }); if (!row) return demoErr('Payment not found.');
          row.proof_path = 'demo/' + row.id; row.proof_name = file.name || 'slip'; row.proof_mime = file.type || 'image/jpeg'; row.proof_data = file.size <= 900000 ? data : null;
          try { localStorage.setItem(DKEY, JSON.stringify(db)); } catch (e) { row.proof_data = null; demoSave(db); }
          return later(normalizePayment(clone(row)));
        });
      },
      removeProof: function (p) {
        var db = demoLoad(), row = db.payments.find(function (x) { return x.id === p.id; }); if (!row) return demoErr('Payment not found.');
        row.proof_path = row.proof_name = row.proof_mime = row.proof_data = null; demoSave(db); return later(normalizePayment(clone(row)));
      },
      proofBlob: function (p) {
        var row = demoLoad().payments.find(function (x) { return x.id === p.id; });
        if (!row || !row.proof_data) return demoErr('In demo mode only small files (under 900 KB) can be opened again.');
        return fetch(row.proof_data).then(function (r) { return r.blob(); });
      },
      listBadges: function (sid) { var l = (demoLoad().badges || []).filter(function (b) { return !sid || b.student_id === sid; }); return later(clone(l).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })); },
      myBadges: function () { return this.listBadges(sess && sess.id); },
      awardBadge: function (b) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var r0 = this.myRole(); if (r0 !== 'admin' && r0 !== 'teacher') return demoErr('Only the admin and teachers can award badges.');
        var db = demoLoad(), me = db.admins.find(function (x) { return sess && x.username === sess.username; }) || {};
        var t = (db.hr || []).find(function (x) { return x.kind === 'teacher' && me.user_id && x.data.user_id === me.user_id; });
        db.badges = db.badges || []; db.badgeSeq = (db.badgeSeq || 0) + 1;
        var row = { id: db.badgeSeq, student_id: b.student_id, badge: b.badge, title: String(b.title || '').slice(0, 60), note: b.note || null, awarded_by: me.user_id || 'admin', awarded_by_name: t ? t.data.full_name : (me.role || 'admin') === 'admin' ? 'Admin' : me.username, created_at: new Date().toISOString(), seen_at: null };
        db.badges.push(row); demoSave(db); return later(clone(row));
      },
      deleteBadge: function (id) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var db = demoLoad(), me = db.admins.find(function (x) { return sess && x.username === sess.username; }) || {}, b = (db.badges || []).find(function (x) { return x.id === id; });
        if (b && (me.role || 'admin') !== 'admin' && b.awarded_by !== me.user_id) return demoErr('You can remove only the badges you gave.');
        db.badges = (db.badges || []).filter(function (x) { return x.id !== id; }); demoSave(db); return later();
      },
      markBadgesSeen: function () { var db = demoLoad(); (db.badges || []).forEach(function (b) { if (sess && b.student_id === sess.id && !b.seen_at) b.seen_at = new Date().toISOString(); }); demoSave(db); return later(); },
      myMastership: function () {
        var db = demoLoad(), me = db.admins.find(function (x) { return sess && x.username === sess.username; }) || {};
        var t = (db.hr || []).find(function (x) { return x.kind === 'teacher' && me.user_id && x.data.user_id === me.user_id; }); if (!t) return later([]);
        return later((db.hr || []).filter(function (r) { return r.kind === 'teacher_rating' && String(r.data.teacher_id) === String(t.id) && MZ.TEACHER_CRITERIA.every(function (c) { return (+r.data[c[0]] || 0) >= 4; }); }).map(function (r) { return r.data.month; }).sort());
      },
      canSchedule: function () {
        if (!admin()) return later(false);
        var db = demoLoad(), me = db.admins.find(function (x) { return sess && x.username === sess.username; }) || {};
        if ((me.role || 'admin') === 'admin') return later(true);
        if (me.role !== 'teacher') return later(false);
        return later(!!(db.hr || []).find(function (x) { return x.kind === 'teacher' && me.user_id && x.data.user_id === me.user_id && x.data.can_schedule === 'Yes'; }));
      },
      scheduleStudents: function () {
        return this.canMoveSchedule().then(function (ok) { if (!ok) return []; return demoLoad().students.filter(function (s) { return !s.disabled_at; }).map(function (s) { return { id: s.id, full_name: s.full_name, program: s.program || '' }; }).sort(function (a, b) { return a.full_name.localeCompare(b.full_name); }); });
      },
      canMoveSchedule: function () {
        return this.canSchedule().then(function (full) {
          if (full) return true;
          var db = demoLoad(), me = db.admins.find(function (x) { return sess && x.username === sess.username; }) || {};
          return me.role === 'teacher' && !!(db.hr || []).find(function (x) { return x.kind === 'teacher' && me.user_id && x.data.user_id === me.user_id && x.data.can_schedule === 'Drag and drop only'; });
        });
      },
      scheduleTeachers: function () { if (!admin()) return later([]); return later((demoLoad().hr || []).filter(function (x) { return x.kind === 'teacher'; }).map(function (x) { return { id: x.id, full_name: x.data.full_name, user_id: x.data.user_id || null, status: x.data.status || 'Active' }; }).sort(function (a, b) { return String(a.full_name).localeCompare(b.full_name); })); },
      listSchedules: function (f) {
        f = f || {}; var db = demoLoad(), me = sess && db.admins.find(function (x) { return x.username === sess.username; }), self = this;
        return (sess && sess.role === 'institute' ? this.canMoveSchedule() : Promise.resolve(false)).then(function (planner) {
          var role = me ? (me.role || 'admin') : 'student';
          return (db.schedules || []).filter(function (r) {
            if (!(planner || role === 'viewer' || (me && r.teacher_user && r.teacher_user === me.user_id) || (sess && sess.role === 'student' && r.student_id === sess.id))) return false;
            return (!f.from || r.slot_date >= f.from) && (!f.to || r.slot_date <= f.to) && (!f.studentId || r.student_id === f.studentId);
          }).map(function (r) { var st = db.students.find(function (x) { return x.id === r.student_id; }); return normalizeSchedule(Object.assign({}, r, { student_name: st ? st.full_name : '' })); }).sort(function (a, b) { return (a.slot_date + a.start_time) < (b.slot_date + b.start_time) ? -1 : 1; });
        });
      },
      saveSchedule: function (r) {
        return this.canSchedule().then(function (ok) {
          if (!ok) return demoErr('Your account is not allowed to make schedules.');
          var db = demoLoad(); db.schedules = db.schedules || [];
          var t = (db.hr || []).find(function (x) { return x.kind === 'teacher' && String(x.id) === String(r.teacher_id); }); if (!t) return demoErr('Choose a teacher from HR → Teachers.');
          var st = db.students.find(function (x) { return x.id === r.student_id; }); if (!st) return demoErr('Student not found.');
          if (!(r.end_time > r.start_time)) return demoErr('The end time must be after the start time.');
          var status = r.status || 'scheduled';
          if (status === 'scheduled') {
            var mySeries = r._series ? ((db.schedules.find(function (z) { return z.id === r.id; }) || {}).series_id || null) : null;
            var c = db.schedules.find(function (x) { return x.status === 'scheduled' && x.slot_date === r.slot_date && x.id !== r.id && x.start_time < r.end_time && r.start_time < x.end_time && (String(x.teacher_id) === String(r.teacher_id) || x.student_id === r.student_id) && !(mySeries && x.series_id === mySeries) && !(r._bulk && r._bulk.indexOf(x.id) >= 0); });
            if (c) {
              var cs = db.students.find(function (x) { return x.id === c.student_id; }) || {}, d = new Date(r.slot_date + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
              return demoErr(c.student_id === r.student_id ? st.full_name + ' already has a slot from ' + c.start_time + ' to ' + c.end_time + ' on ' + d + '.' : t.data.full_name + ' already teaches ' + cs.full_name + ' from ' + c.start_time + ' to ' + c.end_time + ' on ' + d + '.');
            }
          }
          var row = r.id ? db.schedules.find(function (x) { return x.id === r.id; }) : null, now = new Date().toISOString(), isNew = !row;
          var before = row ? clone(row) : null;
          if (!row) { db.schedSeq = (db.schedSeq || 0) + 1; row = { id: db.schedSeq, created_at: now, series_id: r.series_id || null }; db.schedules.push(row); }
          var changed = ['student_id', 'teacher_id', 'slot_date', 'start_time', 'end_time', 'note', 'status'].some(function (k) { return String(row[k] == null ? '' : row[k]) !== String(k === 'status' ? status : (r[k] == null ? '' : r[k])); });
          Object.assign(row, { student_id: r.student_id, teacher_id: +r.teacher_id, teacher_name: t.data.full_name, teacher_user: t.data.user_id || null, slot_date: r.slot_date, start_time: r.start_time, end_time: r.end_time, note: r.note || '', status: status });
          if (changed) { row.updated_at = now; row.student_seen_at = null; row.teacher_seen_at = null; }
          // what changed (for emails) and the history
          if (isNew) row.change_kind = 'new';
          else if (String(before.teacher_id) !== String(row.teacher_id)) row.change_kind = 'reassigned';
          else if (before.slot_date !== row.slot_date || before.start_time !== row.start_time || before.end_time !== row.end_time) row.change_kind = 'rescheduled';
          else if (before.student_id !== row.student_id || (before.note || '') !== (row.note || '')) row.change_kind = 'updated';
          if (isNew || changed) {
            var act = isNew ? 'created' : before.status !== row.status ? (row.status === 'cancelled' ? 'cancelled' : 'restored') : String(before.teacher_id) !== String(row.teacher_id) ? 'reassigned' : row.change_kind === 'rescheduled' && (before.slot_date !== row.slot_date || before.start_time !== row.start_time || before.end_time !== row.end_time) ? 'rescheduled' : 'edited';
            db.schedHist = db.schedHist || []; db.schedHistSeq = (db.schedHistSeq || 0) + 1;
            db.schedHist.push({ id: db.schedHistSeq, schedule_id: row.id, action: act, old_data: before, new_data: clone(row), changed_at: now });
          }
          demoSave(db); return later(normalizeSchedule(clone(row)));
        });
      },
      deleteSchedule: function (id) {
        return this.canSchedule().then(function (ok) { if (!ok) return demoErr('Your account is not allowed to make schedules.'); var db = demoLoad(), old = (db.schedules || []).find(function (x) { return x.id === id; }); db.schedules = (db.schedules || []).filter(function (x) { return x.id !== id; }); if (old) { db.schedHist = db.schedHist || []; db.schedHistSeq = (db.schedHistSeq || 0) + 1; db.schedHist.push({ id: db.schedHistSeq, schedule_id: id, action: 'deleted', old_data: clone(old), new_data: null, changed_at: new Date().toISOString() }); } demoSave(db); return later(); });
      },
      mySchedule: function () { var t = new Date(); t.setDate(t.getDate() - Math.max(1, (t.getDay() + 6) % 7)); return this.listSchedules({ from: t.toISOString().slice(0, 10), studentId: sess && sess.id }); },
      reassignSchedule: function (ids, teacherId) {
        var self = this;
        return this.canMoveSchedule().then(function (planner) {
          var db = demoLoad(), me = sess && db.admins.find(function (x) { return x.username === sess.username; }) || {};
          var t = (db.hr || []).find(function (x) { return x.kind === 'teacher' && String(x.id) === String(teacherId); }); if (!t) return demoErr('Choose a teacher from HR → Teachers.');
          var rows = (db.schedules || []).filter(function (r) { return ids.indexOf(r.id) >= 0; }), n = 0;
          for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var back = r.handed_from && r.handed_from === t.data.full_name;
            if (!planner) return demoErr('Only the admin and teachers with schedule permission can move students. Ask the admin.');
            if (r.status !== 'scheduled') return demoErr('This slot is cancelled. Restore it first.');
            if (String(r.teacher_id) === String(teacherId)) continue;
            var c = db.schedules.find(function (x) { return x.status === 'scheduled' && r.status === 'scheduled' && x.slot_date === r.slot_date && x.id !== r.id && x.start_time < r.end_time && r.start_time < x.end_time && String(x.teacher_id) === String(teacherId); });
            if (c) { var cs = db.students.find(function (x) { return x.id === c.student_id; }) || {}; return demoErr(t.data.full_name + ' already teaches ' + cs.full_name + ' from ' + c.start_time + ' to ' + c.end_time + '.'); }
            r.handed_from = back ? '' : r.teacher_name; r.handed_by = back ? null : (me.user_id || 'admin'); r.handed_at = new Date().toISOString(); r.teacher_id = +teacherId; r.teacher_name = t.data.full_name; r.teacher_user = t.data.user_id || null; r.updated_at = new Date().toISOString(); r.student_seen_at = null; r.teacher_seen_at = null; n++;
          }
          demoSave(db); return later(n);
        });
      },
      teacherBusy: function (date) { if (!admin()) return later([]); return later((demoLoad().schedules || []).filter(function (r) { return r.status === 'scheduled' && r.slot_date === date; }).map(function (r) { return { teacher_id: r.teacher_id, start_time: r.start_time, end_time: r.end_time }; })); },
      markScheduleSeen: function () {
        var db = demoLoad(), me = sess && db.admins.find(function (x) { return x.username === sess.username; }), now = new Date().toISOString();
        (db.schedules || []).forEach(function (r) { if (sess && sess.role === 'student' && r.student_id === sess.id && !r.student_seen_at) r.student_seen_at = now; if (me && r.teacher_user && r.teacher_user === me.user_id && !r.teacher_seen_at) r.teacher_seen_at = now; });
        demoSave(db); return later();
      },
      setDisabled: function (id, on) {
        if (!admin()) return demoErr('Only the institute can disable students.');
        var db = demoLoad(), st = db.students.find(function (x) { return x.id === id; }); if (!st) return demoErr('Student not found.');
        st.disabled_at = on ? (st.disabled_at || new Date().toISOString()) : null; demoSave(db); return later();
      },
      updateMyDetails: function (d) {
        var db = demoLoad(), st = db.students.find(function (x) { return sess && x.id === sess.id; }); if (!st) return demoErr('Please sign in again.');
        var ph = String(d.phone || '').replace(/[^0-9+]/g, ''), em = String(d.email || '').trim().toLowerCase();
        if (ph && !/^\+?\d{9,15}$/.test(ph)) return demoErr('Mobile number should have 9 to 15 digits.');
        if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return demoErr('Email address is not valid.');
        st.guardian_name = String(d.guardian_name || '').trim(); st.phone = ph; st.email = em; demoSave(db); return later();
      },
      notifySchedule: function (id, to) {
        var self = this; return this.scheduleNotifyPreview(id).then(function (p) {
          var db = demoLoad(); db.schedNotes = db.schedNotes || []; db.schedNoteSeq = db.schedNoteSeq || 0;
          var res = (to || []).map(function (k) { var r = p[k] || {}; var st = r.email ? 'sent' : 'missing'; db.schedNoteSeq++; db.schedNotes.push({ id: db.schedNoteSeq, schedule_id: +id, recipient_type: k, recipient_name: r.name, recipient_email: r.email || null, kind: p.kind, status: st, error: r.email ? null : 'No email address saved', manual: true, created_at: new Date().toISOString() }); return { type: k, name: r.name, email: r.email || null, sent: !!r.email, missing: !r.email }; });
          demoSave(db); return { ok: true, demo: true, kind: p.kind, results: res };
        });
      },
      scheduleNotifyPreview: function (id) {
        var db = demoLoad(), r = (db.schedules || []).find(function (x) { return x.id === +id; }); if (!r) return demoErr('This lesson no longer exists.');
        var su = db.students.find(function (x) { return x.id === r.student_id; }) || {}, t = (db.hr || []).find(function (h) { return h.kind === 'teacher' && h.id === r.teacher_id; }) || { data: {} };
        return later({ id: r.id, date: r.slot_date, from: r.start_time, to: r.end_time, note: r.note, status: r.status, kind: r.status === 'cancelled' ? 'cancelled' : r.change_kind === 'reassigned' || r.change_kind === 'updated' ? 'updated' : r.change_kind || 'new',
          student: { name: su.full_name, email: su.email || null }, teacher: { name: t.data.full_name || r.teacher_name, email: t.data.email || null }, admin: { name: 'Administrator', email: (db.settings.schedule_admin_email || '').trim() || null } });
      },
      listScheduleNotifications: function (ids) { var db = demoLoad(); ids = (ids || []).map(Number); return later(clone((db.schedNotes || []).filter(function (n) { return ids.indexOf(n.schedule_id) >= 0; })).sort(function (a, b) { return b.id - a.id; })); },
      scheduleHistory: function (id) { var db = demoLoad(); return later(clone((db.schedHist || []).filter(function (h) { return h.schedule_id === +id; })).sort(function (a, b) { return b.id - a.id; })); },
      updateScheduleSeries: function (id, o) {
        var self = this, db = demoLoad(), r = (db.schedules || []).find(function (x) { return x.id === +id; }); if (!r) return demoErr('This lesson no longer exists.');
        if (!r.series_id) return demoErr('This lesson is not part of a repeating schedule.');
        var rows = db.schedules.filter(function (x) { return x.series_id === r.series_id && x.slot_date >= r.slot_date && (x.status === 'scheduled' || x.id === r.id); }).sort(function (a, b) { return a.slot_date < b.slot_date ? -1 : 1; });
        var shift = +o.shift || 0, plan = rows.map(function (x) { var d = new Date(x.slot_date + 'T12:00:00'); d.setDate(d.getDate() + shift); return { x: x, d: d.getFullYear() + '-' + MZ.pad(d.getMonth() + 1) + '-' + MZ.pad(d.getDate()) }; });
        var tid = o.teacher_id ? +o.teacher_id : null, from = o.start_time || null, to = o.end_time || null, stu = o.student_id || null;
        for (var i = 0; i < plan.length; i++) {
          var x = plan[i].x, nf = from || x.start_time, nt = to || x.end_time, nT = tid || x.teacher_id, nS = stu || x.student_id;
          if (!(nt > nf)) return demoErr('The end time must be after the start time.');
          var c = db.schedules.find(function (y) { return y.status === 'scheduled' && y.series_id !== r.series_id && y.slot_date === plan[i].d && y.start_time < nt && nf < y.end_time && (String(y.teacher_id) === String(nT) || y.student_id === nS); });
          if (c) { var cs = db.students.find(function (z) { return z.id === c.student_id; }) || {}; return demoErr((c.student_id === nS ? (db.students.find(function (z) { return z.id === nS; }) || {}).full_name + ' already has a slot' : c.teacher_name + ' already teaches ' + cs.full_name) + ' from ' + c.start_time + ' to ' + c.end_time + ' on ' + plan[i].d + '.'); }
        }
        // all clear: save each through the normal path (keeps history and change kinds)
        return plan.reduce(function (pr, p) { return pr.then(function () { var x = p.x; return self.saveSchedule({ id: x.id, student_id: stu || x.student_id, teacher_id: tid || x.teacher_id, slot_date: p.d, start_time: from || x.start_time, end_time: to || x.end_time, note: o.note == null ? x.note : o.note, status: x.status, _series: true }); }); }, Promise.resolve())
          .then(function () { return plan.map(function (p) { return p.x.id; }); });
      },
      bulkUpdateSchedules: function (stu, ids, o) {
        var self = this; o = o || {};
        return this.canSchedule().then(function (ok) {
          if (!ok) return demoErr('Only the admin and teachers with schedule permission can change lessons.');
          var db = demoLoad(), tm = function (t) { return (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)); }, hm = function (m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); };
          var rows = (db.schedules || []).filter(function (x) { return x.student_id === stu && ids.map(Number).indexOf(x.id) >= 0; }); if (!rows.length) return later([]);
          var set = rows.map(function (x) { return x.id; });
          var plan = rows.map(function (x) {
            var a = o.start_time || x.start_time, len = o.len ? +o.len : tm(x.end_time) - tm(x.start_time), d = x.slot_date;
            if (o.shift) { var dt = new Date(d + 'T12:00:00'); dt.setDate(dt.getDate() + (+o.shift)); d = dt.toISOString().slice(0, 10); }
            return { x: x, d: d, a: a, b: tm(a) + len > 23 * 60 + 59 ? null : hm(tm(a) + len), tid: o.teacher_id ? +o.teacher_id : x.teacher_id, st: o.status || x.status };
          });
          if (plan.some(function (p) { return !p.b; })) return demoErr('A lesson would end after midnight. Choose an earlier time or a shorter length.');
          for (var i = 0; i < plan.length; i++) for (var j = i + 1; j < plan.length; j++) { var p = plan[i], q2 = plan[j]; if (p.st === 'scheduled' && q2.st === 'scheduled' && p.d === q2.d && p.a < q2.b && q2.a < p.b) return demoErr('Two of the chosen lessons would overlap on ' + p.d + ' (' + p.a + ' and ' + q2.a + '). Nothing was changed.'); }
          for (var k = 0; k < plan.length; k++) {
            var pl = plan[k]; if (pl.st !== 'scheduled') continue;
            var c = db.schedules.find(function (x) { return set.indexOf(x.id) < 0 && x.status === 'scheduled' && x.slot_date === pl.d && x.start_time < pl.b && pl.a < x.end_time && (String(x.teacher_id) === String(pl.tid) || x.student_id === stu); });
            if (c) { var cs = db.students.find(function (z) { return z.id === c.student_id; }) || {}; return demoErr((c.student_id === stu ? (cs.full_name || 'The student') + ' already has a slot' : c.teacher_name + ' already teaches ' + cs.full_name) + ' from ' + c.start_time + ' to ' + c.end_time + ' on ' + pl.d + '.'); }
          }
          return plan.reduce(function (pr, p) { return pr.then(function () { var x = p.x; return self.saveSchedule({ id: x.id, student_id: stu, teacher_id: p.tid, slot_date: p.d, start_time: p.a, end_time: p.b, note: o.note == null ? x.note : String(o.note).trim(), status: p.st, _bulk: set }); }); }, Promise.resolve()).then(function () { return set; });
        });
      },
      bulkDeleteSchedules: function (stu, ids) {
        var self = this, db = demoLoad(), del = (db.schedules || []).filter(function (x) { return x.student_id === stu && ids.map(Number).indexOf(x.id) >= 0; }).map(function (x) { return x.id; });
        db.lastRemoved = (db.schedules || []).filter(function (x) { return del.indexOf(x.id) >= 0; }).map(clone); demoSave(db);
        return del.reduce(function (pr, id) { return pr.then(function () { return self.deleteSchedule(id); }); }, Promise.resolve()).then(function () { return del; });
      },
      notifyRemoved: function (ids) {
        var db = demoLoad(), l = (db.lastRemoved || []).filter(function (x) { return ids.indexOf(x.id) >= 0 && x.status === 'scheduled' && x.slot_date >= MZ.today(); }); if (!l.length) return later({ ok: true, demo: true, results: [] });
        var su = db.students.find(function (x) { return x.id === l[0].student_id; }) || {}, res = [{ type: 'student', name: su.full_name, email: su.email || null, sent: !!su.email, missing: !su.email }];
        var tids = {}; l.forEach(function (x) { tids[x.teacher_id] = 1; });
        Object.keys(tids).forEach(function (k) { var t = (db.hr || []).find(function (h) { return h.kind === 'teacher' && String(h.id) === k; }) || { data: {} }; res.push({ type: 'teacher', name: t.data.full_name, email: t.data.email || null, sent: !!t.data.email, missing: !t.data.email }); });
        return later({ ok: true, demo: true, lessons: l.length, results: res });
      },
      _ttRows: function (db, from, to, type, ref) {
        return (db.schedules || []).filter(function (s) { return s.status === 'scheduled' && s.slot_date >= from && s.slot_date <= to && (type === 'admin' || (type === 'student' && s.student_id === ref) || (type === 'teacher' && String(s.teacher_id) === String(ref))); })
          .map(function (s) { var st = db.students.find(function (x) { return x.id === s.student_id; }) || {}, tm = function (t) { return (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)); }; return { date: s.slot_date, from: s.start_time, to: s.end_time, mins: tm(s.end_time) - tm(s.start_time), student: st.full_name || s.student_name || '', teacher: s.teacher_name, note: s.note || null, change: ['rescheduled', 'updated', 'reassigned'].indexOf(s.change_kind) >= 0 ? s.change_kind : null }; })
          .sort(function (a, b) { return (a.date + a.from + a.student + a.teacher) < (b.date + b.from + b.student + b.teacher) ? -1 : 1; });
      },
      _ttHash: function (rows) { var s = JSON.stringify(rows), h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return 'd' + (h >>> 0).toString(16); },
      timetablePayload: function (from, to, type, ref) {
        var db = demoLoad(), name, email;
        if (!from || !to || to < from) return demoErr('Choose the first and the last day.');
        if (type === 'student') { var s = db.students.find(function (x) { return x.id === ref; }); if (!s) return demoErr('Recipient not found.'); name = s.full_name; email = s.email || null; }
        else if (type === 'teacher') { var t = (db.hr || []).find(function (h) { return h.kind === 'teacher' && String(h.id) === String(ref); }); if (!t) return demoErr('Recipient not found.'); name = t.data.full_name; email = t.data.email || null; }
        else { name = 'Administrator'; email = (db.settings.schedule_admin_email || '').trim() || null; ref = ''; }
        var rows = this._ttRows(db, from, to, type, ref), last = (db.ttNotes || []).filter(function (n) { return n.recipient_type === type && String(n.recipient_ref || '') === String(ref || '') && n.period_from === from && n.period_to === to && n.status === 'sent'; }).sort(function (a, b) { return b.id - a.id; })[0];
        return later({ type: type, ref: ref, name: name, email: email, from: from, to: to, institute: db.settings.institute_name, rows: rows, hash: this._ttHash(rows), last_sent_at: last ? last.created_at : null, last_hash: last ? last.content_hash : null });
      },
      timetableRecipients: function (from, to) {
        var db = demoLoad(), self = this, out = [], seenS = {}, seenT = {};
        (db.schedules || []).forEach(function (s) { if (s.status !== 'scheduled' || s.slot_date < from || s.slot_date > to) return; seenS[s.student_id] = (seenS[s.student_id] || 0) + 1; seenT[s.teacher_id] = (seenT[s.teacher_id] || 0) + 1; });
        var lastOf = function (type, ref) { var l = (db.ttNotes || []).filter(function (n) { return n.recipient_type === type && String(n.recipient_ref || '') === String(ref || '') && n.period_from === from && n.period_to === to; }).sort(function (a, b) { return b.id - a.id; }); var a = l.filter(function (n) { return n.status !== 'skipped'; })[0], s = l.filter(function (n) { return n.status === 'sent'; })[0]; return { last: a ? { at: a.created_at, hash: a.content_hash, status: a.status } : null, sent_hash: s ? s.content_hash : null }; };
        var add = function (type, ref, name, email, n) { var L = lastOf(type, ref); out.push({ type: type, ref: ref, name: name, email: email || null, lessons: n, hash: self._ttHash(self._ttRows(db, from, to, type, ref)), last: L.last, sent_hash: L.sent_hash }); };
        add('admin', '', 'Administrator', (db.settings.schedule_admin_email || '').trim(), Object.keys(seenS).reduce(function (a, k) { return a + seenS[k]; }, 0));
        Object.keys(seenT).map(function (k) { var t = (db.hr || []).find(function (h) { return h.kind === 'teacher' && String(h.id) === k; }) || { data: {} }; return [k, t]; }).sort(function (a, b) { return String(a[1].data.full_name).localeCompare(b[1].data.full_name); }).forEach(function (x) { add('teacher', x[0], x[1].data.full_name, x[1].data.email, seenT[x[0]]); });
        Object.keys(seenS).map(function (k) { return db.students.find(function (x) { return x.id === k; }) || { id: k, full_name: 'Removed student' }; }).sort(function (a, b) { return a.full_name.localeCompare(b.full_name); }).forEach(function (s) { add('student', s.id, s.full_name, s.email, seenS[s.id]); });
        return later(out);
      },
      sendTimetables: function (from, to, list, force) {
        var self = this;
        return (list || []).reduce(function (pr, r) { return pr.then(function (acc) { return self.timetablePayload(from, to, r.type, r.ref).then(function (p) {
          var db = demoLoad(); db.ttNotes = db.ttNotes || []; db.ttSeq = (db.ttSeq || 0) + 1;
          var st = !p.email ? 'missing' : !force && p.last_hash && p.last_hash === p.hash ? 'skipped' : 'sent';
          db.ttNotes.push({ id: db.ttSeq, recipient_type: p.type, recipient_ref: p.ref, recipient_name: p.name, recipient_email: p.email, period_from: from, period_to: to, lessons: p.rows.length, content_hash: p.hash, status: st, error: st === 'missing' ? 'No email address saved' : st === 'skipped' ? 'Unchanged since it was last sent' : null, created_at: new Date().toISOString() });
          demoSave(db); acc.push({ type: p.type, ref: p.ref, name: p.name, email: p.email, status: st, lessons: p.rows.length }); return acc;
        }); }); }, Promise.resolve([])).then(function (res) { return { ok: true, demo: true, results: res }; });
      },
      listTimetableNotifications: function () { return later(clone(demoLoad().ttNotes || []).sort(function (a, b) { return b.id - a.id; }).slice(0, 300)); },
      myAdminFeedback: function () {
        var db = demoLoad(), me = db.admins.find(function (x) { return sess && x.username === sess.username; }) || {};
        var t = (db.hr || []).find(function (x) { return x.kind === 'teacher' && me.user_id && x.data.user_id === me.user_id; }); if (!t) return later([]);
        return later((db.hr || []).filter(function (r) { return r.kind === 'teacher_rating' && String(r.data.teacher_id) === String(t.id); }).sort(function (a, b) { return a.data.month < b.data.month ? 1 : a.data.month > b.data.month ? -1 : b.id - a.id; })
          .map(function (r) { var sc = {}; MZ.TEACHER_CRITERIA.forEach(function (c) { if (r.data[c[0]] != null && r.data[c[0]] !== '') sc[c[0]] = +r.data[c[0]]; }); return { id: r.id, month: r.data.month, scores: sc, comment: r.data.comment || null, positives: r.data.positives || null, improve: r.data.improve || null, rated_at: r.updated_at || r.created_at }; }));
      },
      myTeacherFeedback: function (from, to) {
        var db = demoLoad(), me = db.admins.find(function (x) { return sess && x.username === sess.username; }) || {};
        var t = (db.hr || []).find(function (x) { return x.kind === 'teacher' && me.user_id && x.data.user_id === me.user_id; }); if (!t) return later([]);
        var g = {}; (db.feedback || []).forEach(function (f) { if (String(f.teacher_id) !== String(t.id) || f.month < from || f.month > to) return; var k = f.month; g[k] = g[k] || { month: k, responses: 0, sums: {}, comments: [] }; g[k].responses++; MZ.TEACHER_CRITERIA.forEach(function (c) { g[k].sums[c[0]] = (g[k].sums[c[0]] || 0) + f.scores[c[0]]; }); if (f.comment) g[k].comments.push(f.comment); });
        return later(Object.keys(g).sort().map(function (k) { var x = g[k], a = {}; MZ.TEACHER_CRITERIA.forEach(function (c) { a[c[0]] = Math.round(x.sums[c[0]] / x.responses * 100) / 100; }); return { month: k, responses: x.responses, avg_scores: a, comments: x.comments }; }));
      },
      notifyTeachers: function (ids) {
        var db = demoLoad(), groups = {}, studs = {};
        (db.schedules || []).forEach(function (r) {
          if (ids.indexOf(r.id) < 0 || r.status !== 'scheduled' || r.notified_teacher_id === r.teacher_id) return;
          var su = db.students.find(function (x) { return x.id === r.student_id; }); if (su && !su.disabled_at) studs[su.id] = { student: su.full_name, email: !!su.email, emailed: false };
          var t = (db.hr || []).find(function (h) { return h.kind === 'teacher' && h.id === r.teacher_id; }) || { data: {} };
          var g = groups[r.teacher_id] = groups[r.teacher_id] || { teacher: r.teacher_name, email: !!t.data.email, devices: (db.push || []).filter(function (p) { return p.user_id && p.user_id === t.data.user_id; }).length, emailed: false, pushed: 0 };
          r.notified_teacher_id = r.teacher_id;
        });
        demoSave(db);
        return later({ ok: true, demo: true, teachers: Object.keys(groups).map(function (k) { return groups[k]; }), students: Object.keys(studs).map(function (k) { return studs[k]; }) });
      },
      testAlert: function () {
        if (!('serviceWorker' in navigator) || !window.Notification || Notification.permission !== 'granted') return demoErr('Turn on phone alerts first.');
        return navigator.serviceWorker.ready.then(function (reg) { return reg.showNotification('Alerts are on', { body: 'You will be told here when students are allocated to you.', icon: 'assets/app-192.png', tag: 'test', data: { url: 'institute.html#schedule' } }); }).then(function () { return { ok: true, pushed: 1, devices: 1 }; });
      },
      savePushSub: function (sub) { var db = demoLoad(), me = db.admins.find(function (x) { return sess && x.username === sess.username; }) || {}, j = sub.toJSON ? sub.toJSON() : sub; db.push = (db.push || []).filter(function (p) { return p.endpoint !== j.endpoint; }).concat([{ user_id: me.user_id, endpoint: j.endpoint }]); demoSave(db); return later(); },
      removePushSub: function (endpoint) { var db = demoLoad(); db.push = (db.push || []).filter(function (p) { return p.endpoint !== endpoint; }); demoSave(db); return later(); },
      myTeacherProfile: function () {
        var db = demoLoad(), me = db.admins.find(function (x) { return sess && x.username === sess.username; }) || {};
        var r = (db.hr || []).find(function (x) { return x.kind === 'teacher' && x.data.user_id === me.user_id; });
        if (!r) return later(null); var d = clone(r.data); delete d.salary; delete d.notes; return later({ id: r.id, data: d });
      },
      saveMyTeacherProfile: function (p) {
        var db = demoLoad(), me = db.admins.find(function (x) { return sess && x.username === sess.username; }); if (!me) return demoErr('Please sign in again.');
        var c = {}; ['full_name', 'its_no', 'email', 'sanad_year', 'phone', 'tadreeb'].forEach(function (k) { if (k in p) c[k] = String(p[k] || '').trim().slice(0, 120); });
        if ('full_name' in c && !c.full_name) return demoErr('Full name is required.');
        if (c.its_no && !/^\d{8}$/.test(c.its_no)) return demoErr('ITS number must be 8 digits.');
        if (c.sanad_year && !/^\d{4}$/.test(c.sanad_year)) return demoErr('Sanad year must be a year like 2015.');
        if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return demoErr('Email address is not valid.');
        db.hr = db.hr || []; var r = db.hr.find(function (x) { return x.kind === 'teacher' && x.data.user_id === me.user_id; });
        if (!r) { db.hrseq = (db.hrseq || 0) + 1; r = { id: db.hrseq, kind: 'teacher', data: { user_id: me.user_id, status: 'Active', role: 'Hifz teacher' }, created_at: new Date().toISOString() }; db.hr.push(r); }
        Object.assign(r.data, c); r.updated_at = new Date().toISOString(); demoSave(db); return this.myTeacherProfile();
      },
      getItsPassword: function (sid) { var db = demoLoad(); if (!(admin() && this.myRole() === 'admin') && !(sess && sess.role === 'student' && sess.id === sid)) return demoErr('Only the admin and the student can see the ITS password.'); return later(((db.secrets || {})[sid]) || ''); },
      setItsPassword: function (sid, pw) { var db = demoLoad(); if (!(admin() && this.myRole() === 'admin') && !(sess && sess.role === 'student' && sess.id === sid)) return demoErr('Only the admin and the student can change the ITS password.'); db.secrets = db.secrets || {}; db.secrets[sid] = String(pw || ''); demoSave(db); return later(); },
      myItsPassword: function () { return this.getItsPassword(sess && sess.id); },
      setMyItsPassword: function (pw) { return this.setItsPassword(sess && sess.id, pw); },
      sendWelcome: function () { return demoErr('Email is not set up in demo mode.'); },
      sendEmail: function () { return demoErr('Email is not set up in demo mode.'); },
      /* notices */
      listNotices: function () { return later(clone(demoLoad().notices).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })); },
      addNotice: function (o) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var db = demoLoad(), id = (db.notices.reduce(function (m, n) { return Math.max(m, n.id); }, 0) || 0) + 1;
        var row = { id: id, title: o.title, html: o.html || '', body: o.body || '', file_path: null, file_name: o.file ? o.file.name : null,
          mime: o.file ? o.file.type || '' : null, file_size: o.file ? o.file.size : null, created_at: new Date().toISOString() };
        // keep small files in demo mode so they can be opened (the live site keeps any size up to 50 MB)
        var keep = o.file && o.file.size <= 1200000 ? new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { res(null); }; fr.readAsDataURL(o.file); }) : Promise.resolve(null);
        return keep.then(function (data) {
          if (data) row.data_url = data;
          db.notices.push(row);
          try { localStorage.setItem(DKEY, JSON.stringify(db)); } catch (e) { delete row.data_url; demoSave(db); }
          return later(clone(row));
        });
      },
      deleteNotice: function (n) {
        if (!admin()) return demoErr('Your account is not allowed to do that.');
        var db = demoLoad(); db.notices = db.notices.filter(function (x) { return x.id !== n.id; }); demoSave(db); return later();
      },
      downloadNotice: function (n) {
        var row = demoLoad().notices.find(function (x) { return x.id === n.id; });
        if (!row || !row.data_url) return demoErr('In demo mode large files are not kept. It works once the site is live.');
        return fetch(row.data_url).then(function (r) { return r.blob(); });
      }
    };
  }

  /* ---------------------------------------------------------- surahs (604-page Madinah mushaf) */
  MZ.SURAHS = [null,
    ['Al-Fatiha','الفاتحة',1],['Al-Baqarah','البقرة',2],['Aal-Imran','آل عمران',50],['An-Nisa','النساء',77],['Al-Maidah','المائدة',106],['Al-Anam','الأنعام',128],['Al-Araf','الأعراف',151],['Al-Anfal','الأنفال',177],['At-Tawbah','التوبة',187],['Yunus','يونس',208],
    ['Hud','هود',221],['Yusuf','يوسف',235],['Ar-Rad','الرعد',249],['Ibrahim','إبراهيم',255],['Al-Hijr','الحجر',262],['An-Nahl','النحل',267],['Al-Isra','الإسراء',282],['Al-Kahf','الكهف',293],['Maryam','مريم',305],['Ta-Ha','طه',312],
    ['Al-Anbiya','الأنبياء',322],['Al-Hajj','الحج',332],['Al-Muminun','المؤمنون',342],['An-Nur','النور',350],['Al-Furqan','الفرقان',359],['Ash-Shuara','الشعراء',367],['An-Naml','النمل',377],['Al-Qasas','القصص',385],['Al-Ankabut','العنكبوت',396],['Ar-Rum','الروم',404],
    ['Luqman','لقمان',411],['As-Sajdah','السجدة',415],['Al-Ahzab','الأحزاب',418],['Saba','سبأ',428],['Fatir','فاطر',434],['Ya-Sin','يس',440],['As-Saffat','الصافات',446],['Sad','ص',453],['Az-Zumar','الزمر',458],['Ghafir','غافر',467],
    ['Fussilat','فصلت',477],['Ash-Shura','الشورى',483],['Az-Zukhruf','الزخرف',489],['Ad-Dukhan','الدخان',496],['Al-Jathiyah','الجاثية',499],['Al-Ahqaf','الأحقاف',502],['Muhammad','محمد',507],['Al-Fath','الفتح',511],['Al-Hujurat','الحجرات',515],['Qaf','ق',518],
    ['Adh-Dhariyat','الذاريات',520],['At-Tur','الطور',523],['An-Najm','النجم',526],['Al-Qamar','القمر',528],['Ar-Rahman','الرحمن',531],['Al-Waqiah','الواقعة',534],['Al-Hadid','الحديد',537],['Al-Mujadilah','المجادلة',542],['Al-Hashr','الحشر',545],['Al-Mumtahanah','الممتحنة',549],
    ['As-Saff','الصف',551],['Al-Jumuah','الجمعة',553],['Al-Munafiqun','المنافقون',554],['At-Taghabun','التغابن',556],['At-Talaq','الطلاق',558],['At-Tahrim','التحريم',560],['Al-Mulk','الملك',562],['Al-Qalam','القلم',564],['Al-Haqqah','الحاقة',566],['Al-Maarij','المعارج',568],
    ['Nuh','نوح',570],['Al-Jinn','الجن',572],['Al-Muzzammil','المزمل',574],['Al-Muddaththir','المدثر',575],['Al-Qiyamah','القيامة',577],['Al-Insan','الإنسان',578],['Al-Mursalat','المرسلات',580],['An-Naba','النبأ',582],['An-Naziat','النازعات',583],['Abasa','عبس',585],
    ['At-Takwir','التكوير',586],['Al-Infitar','الانفطار',587],['Al-Mutaffifin','المطففين',587],['Al-Inshiqaq','الانشقاق',589],['Al-Buruj','البروج',590],['At-Tariq','الطارق',591],['Al-Ala','الأعلى',591],['Al-Ghashiyah','الغاشية',592],['Al-Fajr','الفجر',593],['Al-Balad','البلد',594],
    ['Ash-Shams','الشمس',595],['Al-Layl','الليل',595],['Ad-Duha','الضحى',596],['Ash-Sharh','الشرح',596],['At-Tin','التين',597],['Al-Alaq','العلق',597],['Al-Qadr','القدر',598],['Al-Bayyinah','البينة',598],['Az-Zalzalah','الزلزلة',599],['Al-Adiyat','العاديات',599],
    ['Al-Qariah','القارعة',600],['At-Takathur','التكاثر',600],['Al-Asr','العصر',601],['Al-Humazah','الهمزة',601],['Al-Fil','الفيل',601],['Quraysh','قريش',602],['Al-Maun','الماعون',602],['Al-Kawthar','الكوثر',602],['Al-Kafirun','الكافرون',603],['An-Nasr','النصر',603],
    ['Al-Masad','المسد',603],['Al-Ikhlas','الإخلاص',604],['Al-Falaq','الفلق',604],['An-Nas','الناس',604]];
  MZ.surahLabel = function (n) { var x = MZ.SURAHS[+n]; return x ? n + '. ' + x[0] : ''; };
  MZ.surahName = function (n) { var x = MZ.SURAHS[+n]; return x ? x[0] : ''; };
  MZ.surahPages = function (n) { n = +n; var x = MZ.SURAHS[n]; if (!x) return null; return [x[2], n < 114 ? MZ.SURAHS[n + 1][2] : 604]; };
  /* Read what was typed: "67", "67. Al-Mulk", "mulk", "الملك". */
  MZ.parseSurah = function (t) {
    t = String(t || '').trim(); if (!t) return null;
    var m = /^(\d{1,3})\b/.exec(t); if (m && +m[1] >= 1 && +m[1] <= 114) return +m[1];
    var norm = function (s) { return String(s).toLowerCase().replace(/^(al|an|ar|as|ash|at|ad|adh|az|aal)[- ]/, '').replace(/[^a-z؀-ۿ]/g, ''); };
    var q = norm(t.replace(/·.*$/, '')), best = null;
    for (var i = 1; i <= 114; i++) { var e = norm(MZ.SURAHS[i][0]), a = MZ.SURAHS[i][1].replace(/[^؀-ۿ]/g, ''); if (q === e || q === a) return i; if (!best && q.length >= 3 && (e.indexOf(q) === 0 || a.indexOf(q) === 0)) best = i; }
    return best;
  };
  /* "Al-Mulk · p. 562" */
  MZ.posLabel = function (surah, pos, short) {
    if (!surah && !pos) return '';
    return (surah ? MZ.surahName(surah) : '') + (surah && pos ? ' · ' : '') + (pos ? (short ? 'p.' : 'page ') + pos : '');
  };
  /* ---- Hifz direction and the link between the current page and pages memorised ----
     Both directions start at the end of the Qur'an, go back to a turning page, then carry on from page 1:
     forward:              page 604 → 582, then page 1 → 581.  Page 604 = 1 page; 582 = 23 pages; page 1 = 24 pages … 581 = 604.
     reverse ('backward'): page 604 → 502, then page 1 → 501.  Page 600 = 5 pages; 502 = 103 pages; page 1 = 104 pages … 501 = 604.
     With no direction saved, the page number is simply the number of pages (nothing is guessed). */
  MZ.TURN = { forward: 582, backward: 502 };
  MZ.REV_TURN = MZ.TURN.backward;
  MZ.turnOf = function (dir) { return MZ.TURN[dir] || null; };
  MZ.lastPage = function (dir) { var t = MZ.turnOf(dir); return t ? t - 1 : 604; };
  MZ.hifzDir = function (s) { return s && (s.hifz_dir === 'backward' || s.hifz_dir === 'forward') ? s.hifz_dir : null; };
  MZ.posToCount = function (pos, dir) { pos = +pos; if (!(pos >= 1 && pos <= 604)) return 0; var t = MZ.turnOf(dir); if (!t) return pos; return pos >= t ? 605 - pos : (605 - t) + pos; };
  MZ.countToPos = function (count, dir) { count = +count || 0; if (count <= 0) return null; count = Math.min(604, count); var t = MZ.turnOf(dir); if (!t) return count; var seg = 605 - t; return count <= seg ? 605 - count : count - seg; };
  // the surah a student is in at that page (on the part going back from 604: the surah that begins on that page, if any)
  MZ.pageSurah = function (pos, dir) {
    pos = +pos; if (!(pos >= 1 && pos <= 604)) return null;
    var t = MZ.turnOf(dir); if (t && pos >= t) { for (var i = 1; i <= 114; i++) if (MZ.SURAHS[i][2] === pos) return i; }
    var n = 1; for (var j = 1; j <= 114; j++) if (MZ.SURAHS[j][2] <= pos) n = j; return n;
  };
  // true when going from page a to page b passes the turn (… → turning page → page 1 …)
  MZ.crossesTurn = function (a, b, dir) { var t = MZ.turnOf(dir); return !!t && +a >= t && +b >= 1 && +b < t; };
  // the direction is never guessed from one page: it is the student's saved setting
  MZ.detectDir = function (s) { return s && s.hifz_dir ? s.hifz_dir : null; };
  MZ.dirLabel = function (dir, short) { return dir === 'backward' ? (short ? 'Reverse' : 'Reverse: page 604 → 502, then page 1 → 501') : dir === 'forward' ? (short ? 'Forward' : 'Forward: page 604 → 582, then page 1 → 581') : (short ? 'Direction not set' : 'Memorisation direction not set'); };
  /* The month's numbers: started at, goal, reached, done, totals. rows = all the student's months. */
  /* Target page = Started at + Monthly goal, counted in the student's direction
     (forward: 590 + 5 → 585; 584 + 5 → 583, 582, then 1, 2, 3 → page 3. reverse: 504 + 5 → 503, 502, 1, 2, 3 → page 3). */
  MZ.targetPage = function (startPos, goal, dir) {
    goal = +goal || 0; if (!dir || goal <= 0 || !(+startPos >= 1)) return null;
    return MZ.countToPos(Math.min(604, MZ.posToCount(+startPos, dir) + goal), dir);
  };
  MZ.monthHifz = function (s, rows, m) {
    rows = rows || []; var dir = MZ.hifzDir(s), cur = MZ.thisMonth(), r = rows.filter(function (x) { return x.month === m; })[0] || null;
    var prev = rows.filter(function (x) { return x.month < m && (x.pages_end != null || x.end_pos); }).sort(function (a, b) { return a.month < b.month ? 1 : -1; })[0] || null;
    var startCount = r && r.start_page != null ? r.start_page : prev && prev.pages_end != null ? prev.pages_end : m >= cur ? (+s.pages || 0) : null;
    var startPos = r && r.start_pos ? r.start_pos : startCount != null ? MZ.countToPos(startCount, dir) : null;
    // "Started at" is the page shown, so the count (and the target) follow it
    if (r && r.start_pos && (dir || r.start_page == null)) startCount = MZ.posToCount(r.start_pos, dir);
    var reachedCount = m >= cur ? (+s.pages || 0) : r && r.pages_end != null ? r.pages_end : null;
    var reachedPos = m >= cur ? (s.cur_pos || MZ.countToPos(reachedCount, dir)) : r && r.end_pos ? r.end_pos : reachedCount != null ? MZ.countToPos(reachedCount, dir) : null;
    var goalN = r && r.goal > 0 ? r.goal : r && r.goal_page && startCount != null ? Math.max(0, r.goal_page - startCount) : null;
    var goalCount = goalN && startCount != null ? Math.min(604, startCount + goalN) : null;
    var done = reachedCount != null && startCount != null ? Math.max(0, reachedCount - startCount) : null;
    // this year: from where the year's first month started to where this month reached (no page counted twice)
    var y = m.slice(0, 4), first = rows.filter(function (x) { return x.month.slice(0, 4) === y && x.month < m && x.start_page != null; }).sort(function (a, b) { return a.month < b.month ? -1 : 1; })[0];
    var yStart = first ? (first.start_pos && dir ? MZ.posToCount(first.start_pos, dir) : first.start_page) : startCount, year = reachedCount != null && yStart != null ? reachedCount - yStart : (done || 0);
    // months saved before the direction was set can be counted differently: then add up each month of the year instead
    if (year < 0 || (done != null && year < done)) year = rows.filter(function (x) { return x.month.slice(0, 4) === y && x.month < m; }).reduce(function (a, x) {
      var sc = x.start_pos && dir ? MZ.posToCount(x.start_pos, dir) : x.start_page, ec = x.end_pos && dir ? MZ.posToCount(x.end_pos, dir) : x.pages_end;
      return a + (sc != null && ec != null ? Math.max(0, ec - sc) : Math.max(0, +x.jadeed || 0));
    }, 0) + (done || 0);
    if (reachedCount != null) year = Math.min(year, reachedCount); // never more than everything memorised
    return { dir: dir, row: r, startCount: startCount, startPos: startPos, startSurah: startPos ? (r && r.start_surah) || MZ.pageSurah(startPos, dir) : null,
      goalN: goalN, goalCount: goalCount, goalPos: goalCount ? MZ.countToPos(goalCount, dir) : null,
      reachedCount: reachedCount, reachedPos: reachedPos, reachedSurah: reachedPos ? MZ.pageSurah(reachedPos, dir) : null,
      done: done, toGo: goalN && done != null ? Math.max(0, goalN - done) : null, year: year, reachedGoal: goalN && done != null ? done >= goalN : !!(r && r.goal_awarded) };
  };
  /* ---------------------------------------------------------- reports: one set of rules for week, month and year
     Started at = the student's place in their own sequence when the period began; Reached = their place when it ended;
     Pages memorised = new pages in the period (never a page number, never counted twice);
     Target page = Started at + goal, along the student's direction (forward: 604 → 582, then 1 → 581). */
  MZ.repMonth = function (s, rows, m) {
    var h = MZ.monthHifz(s, rows, m), cur = MZ.thisMonth(), dir = h.dir;
    var has = h.row || m === cur, done = has && h.done != null ? Math.max(0, h.done) : null, goal = h.goalN || 0;
    var status = m > cur ? 'future' : done == null ? 'nodata' : !goal ? 'nogoal' : done >= goal ? 'reached' : m === cur ? 'progress' : 'missed';
    return { m: m, dir: dir, goal: goal, startPos: has ? h.startPos : null, startCount: has ? h.startCount : null, targetPos: goal && has ? h.goalPos : null,
      reachedPos: has ? h.reachedPos : null, reachedCount: has ? h.reachedCount : null, done: done,
      pct: goal && done != null ? Math.min(100, Math.round(done / goal * 100)) : null, remaining: goal && done != null ? Math.max(0, goal - done) : null, status: status };
  };
  // the year = the sum of its months (so it always equals the monthly figures)
  MZ.repYear = function (s, rows, y) {
    var cur = MZ.thisMonth(), months = [];
    for (var i = 1; i <= 12; i++) months.push(MZ.repMonth(s, rows, y + '-' + MZ.pad(i)));
    var past = months.filter(function (x) { return x.m <= cur; }), withData = past.filter(function (x) { return x.done != null; });
    var total = withData.reduce(function (a, x) { return a + x.done; }, 0), target = past.reduce(function (a, x) { return a + (x.goal || 0); }, 0);
    var first = withData[0], last = withData[withData.length - 1];
    return { y: y, months: months, total: total, target: target, goalsSet: past.filter(function (x) { return x.goal; }).length,
      goalsReached: months.filter(function (x) { return x.status === 'reached'; }).length,
      pct: target ? Math.min(100, Math.round(total / target * 100)) : null, remaining: target ? Math.max(0, target - total) : null,
      startPos: first ? first.startPos : null, startCount: first ? first.startCount : null, endPos: last ? last.reachedPos : null, endCount: last ? last.reachedCount : null };
  };
  // the local date of a record (records are saved in UTC)
  MZ.localDate = function (ts) { var d = new Date(ts); if (isNaN(d)) return String(ts || '').slice(0, 10); return d.getFullYear() + '-' + MZ.pad(d.getMonth() + 1) + '-' + MZ.pad(d.getDate()); };
  // a week, from the month's starting point plus the page entries (each entry is the new pages it added, corrections are negative)
  MZ.repWeek = function (s, rows, events, w) {
    var dir = MZ.hifzDir(s), m0 = w.from.slice(0, 7), jad = (events || []).filter(function (e) { return e.student_id === s.id && e.kind === 'jadeed'; });
    var sum = function (l) { return l.reduce(function (a, e) { return a + (+e.pages || 0); }, 0); };
    var inWeek = jad.filter(function (e) { var d = MZ.localDate(e.created_at); return d >= w.from && d <= w.to; });
    var pages = sum(inWeek), startCount = null, reachedCount = null;
    // anchored on the month's own "Reached" (this month: the current page), so the week always agrees with the monthly report
    var m1 = w.to.slice(0, 7) > MZ.thisMonth() ? MZ.thisMonth() : w.to.slice(0, 7), me = MZ.monthHifz(s, rows, m1);
    if (me.reachedCount != null && (me.row || m1 === MZ.thisMonth())) {
      reachedCount = me.reachedCount - sum(jad.filter(function (e) { return e.month === m1 && MZ.localDate(e.created_at) > w.to; }));
      startCount = reachedCount - pages;
    } else {
      // no saved end for that month: start from the month's starting point and add the entries
      var mh = MZ.monthHifz(s, rows, m0);
      if (mh.startCount != null) { startCount = mh.startCount + sum(jad.filter(function (e) { return e.month === m0 && MZ.localDate(e.created_at) < w.from; })); reachedCount = startCount + pages; }
    }
    if (startCount != null) { startCount = Math.max(0, Math.min(604, startCount)); reachedCount = Math.max(0, Math.min(604, reachedCount)); }
    var thu = new Date(w.from + 'T12:00:00'); thu.setDate(thu.getDate() + 3);
    var tm = thu.getFullYear() + '-' + MZ.pad(thu.getMonth() + 1), g = MZ.monthHifz(s, rows, tm).goalN || 0, dim = new Date(+tm.slice(0, 4), +tm.slice(5, 7), 0).getDate();
    var target = g ? Math.max(1, Math.round(g * 7 / dim)) : null;
    return { pages: pages, gained: inWeek.filter(function (e) { return +e.pages > 0; }).reduce(function (a, e) { return a + (+e.pages); }, 0),
      corrected: inWeek.filter(function (e) { return +e.pages < 0; }).reduce(function (a, e) { return a - (+e.pages); }, 0),
      startCount: startCount, reachedCount: reachedCount, startPos: startCount ? MZ.countToPos(startCount, dir) : null, reachedPos: reachedCount ? MZ.countToPos(reachedCount, dir) : null,
      target: target, monthGoal: g, achieved: target ? Math.min(Math.max(0, pages), target) : null, remaining: target ? Math.max(0, target - Math.max(0, pages)) : null,
      pct: target ? Math.min(100, Math.round(Math.max(0, pages) / target * 100)) : null, days: Object.keys(inWeek.filter(function (e) { return +e.pages > 0; }).reduce(function (o, e) { o[MZ.localDate(e.created_at)] = 1; return o; }, {})).length,
      entries: inWeek };
  };
  MZ.surahDatalist = function (id) { var o = '<datalist id="' + id + '">'; for (var i = 1; i <= 114; i++) o += '<option value="' + MZ.surahLabel(i) + '">'; return o + '</datalist>'; };
  /* ---------------------------------------------------------- juz, print, report card, certificate */
  // Counted by pages memorised, in any order: one juz is 604 / 30 ≈ 20 pages (works for students who start from An-Nas too).
  MZ.juzEnd = function (j) { return j >= 30 ? 604 : Math.ceil(j * 604 / 30); };
  MZ.juzDone = function (pages) { pages = +pages || 0; if (pages >= 604) return 30; return Math.min(29, Math.floor(pages * 30 / 604)); };
  /* The month a juz was completed, from the month-by-month pages. */
  MZ.juzMonth = function (rows, j) {
    var end = MZ.juzEnd(j), hit = (rows || []).filter(function (r) { return r.pages_end != null && r.pages_end >= end; }).sort(function (a, b) { return a.month < b.month ? -1 : 1; })[0];
    return hit ? hit.month : MZ.thisMonth();
  };
  // show a file (payment slip): pictures open on top of the page (works on iPhone, also from the home screen);
  // other files open in a new tab where allowed, otherwise they are saved
  MZ.viewBlob = function (b, name, win) {
    var u = URL.createObjectURL(b), ios = MZ.push && MZ.push.ios && MZ.push.ios();
    if (/^image\//.test(b.type || '')) {
      if (win && !win.closed) try { win.close(); } catch (e) {}
      var box = document.createElement('div'); box.className = 'imgview'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', name || 'Payment slip');
      box.innerHTML = '<div class="imgview-bar"><b></b><span><button type="button" class="btn sm" data-iv="save">Save</button><button type="button" class="btn sm gold" data-iv="close">Close</button></span></div><div class="imgview-in"><img alt=""></div>';
      box.querySelector('b').textContent = name || 'Payment slip'; box.querySelector('img').src = u; box.querySelector('img').alt = name || 'Payment slip';
      var close = function () { box.remove(); document.removeEventListener('keydown', esc); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); };
      var esc = function (e) { if (e.key === 'Escape') close(); };
      box.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-iv]'); if (!t) { if (e.target === box) close(); return; } if (t.getAttribute('data-iv') === 'close') close(); else MZ.saveFile(name || 'payment-slip', b); });
      document.addEventListener('keydown', esc); document.body.appendChild(box); box.querySelector('[data-iv=close]').focus();
      return;
    }
    if (!ios && win && !win.closed) { win.location.href = u; setTimeout(function () { URL.revokeObjectURL(u); }, 120000); return; }
    if (win && !win.closed) try { win.close(); } catch (e) {}
    MZ.saveFile(name || 'payment-slip', b); setTimeout(function () { URL.revokeObjectURL(u); }, 120000);
  };
  MZ.printHTML = function (html, title) {
    var root = document.getElementById('printRoot');
    if (!root) { root = document.createElement('div'); root.id = 'printRoot'; document.body.appendChild(root); }
    root.innerHTML = html;
    var old = document.title; if (title) document.title = title;
    document.body.classList.add('printing');
    var imgs = Array.prototype.slice.call(root.querySelectorAll('img')).map(function (i) { return i.complete ? null : new Promise(function (r) { i.onload = i.onerror = r; }); }).filter(Boolean);
    var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.race([Promise.all(imgs.concat([fonts])), new Promise(function (r) { setTimeout(r, 2500); })]).then(function () {
      var done = function () { document.body.classList.remove('printing'); document.title = old; window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      try { window.print(); } catch (e) { MZ.toast('Printing is blocked here. Open the site in your browser to print or save as PDF.'); }
      setTimeout(function () { if (!window.matchMedia || !matchMedia('print').matches) done(); }, 1500);
    });
  };
  function rcRow(label, value) { return value == null || value === '' ? '' : '<tr><th>' + esc(label) + '</th><td>' + value + '</td></tr>'; }
  /* Printable fee accounts. d = {settings, rows:[{s, pays, pending, sum, paid, all}], from, to, period, summary, each} */
  MZ.accountsHTML = function (d) {
    var st = d.settings, cur = st.currency, rows = d.rows, now = MZ.thisMonth();
    var perLabel = d.period === 'all' ? 'Since each student joined, to ' + MZ.monthLabel(d.to) : d.from === d.to ? MZ.monthLabel(d.from) : MZ.monthLabel(d.from) + ' to ' + MZ.monthLabel(d.to);
    var T = rows.reduce(function (a, r) { a.due += r.sum.total; a.paid += r.paid; a.bal += r.sum.balance; a.leave += r.sum.leave.length; a.pend += r.pending.reduce(function (x, p) { return x + p.amount; }, 0); return a; }, { due: 0, paid: 0, bal: 0, leave: 0, pend: 0 });
    var headF = function (title, sub) {
      return '<header class="rc-head"><img src="assets/logo-qt.png" alt=""><div style="flex:1"><p class="rc-inst">' + esc(st.institute_name) + '</p><h1>' + esc(title) + '</h1><p class="rc-month">' + esc(sub) + '</p></div><div class="acc-stamp">Printed ' + esc(MZ.dateLabel(MZ.today())) + '</div></header>';
    };
    var money = function (n) { return esc(MZ.money(n, cur)); };
    var h = '';
    if (d.summary) {
      h += '<section class="rc acc">' + headF('Fee accounts', perLabel + ' · ' + rows.length + ' student' + (rows.length === 1 ? '' : 's'))
        + '<div class="acc-tot"><div><small>Fees due</small><b>' + money(T.due) + '</b></div><div><small>Paid</small><b class="ok">' + money(T.paid) + '</b></div><div><small>Balance due</small><b class="' + (T.bal > 0 ? 'no' : 'ok') + '">' + money(T.bal) + '</b></div>'
        + (T.leave ? '<div><small>Months on leave</small><b>' + T.leave + '</b></div>' : '') + (T.pend ? '<div><small>Waiting for approval</small><b>' + money(T.pend) + '</b></div>' : '') + '</div>'
        + '<table class="acc-t"><thead><tr><th>#</th><th>Student</th><th class="r">Monthly fee</th><th class="r">Months due</th><th class="r">Fees due</th><th class="r">Paid</th><th class="r">Balance</th><th>Unpaid months</th><th class="r">Paid since joining</th></tr></thead><tbody>'
        + rows.map(function (r, i) {
          var s = r.s;
          return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(s.full_name) + '</b><small>' + esc([s.admission_no, s.its_no ? 'ITS ' + s.its_no : '', s.disabled ? 'Disabled' : ''].filter(Boolean).join(' · ')) + '</small>'
            + (r.sum.leave.length ? '<small class="lv">On leave ' + r.sum.leave.length + ' month' + (r.sum.leave.length === 1 ? '' : 's') + '</small>' : '') + '</td>'
            + '<td class="r">' + money(MZ.effFee(s)) + (s.discount_value ? '<small>' + esc(MZ.discountLabel(s, cur)) + '</small>' : '') + '</td>'
            + '<td class="r">' + r.sum.months + '</td><td class="r">' + money(r.sum.total) + '</td><td class="r ok">' + money(r.paid) + '</td>'
            + '<td class="r ' + (r.sum.balance > 0 ? 'no' : 'ok') + '">' + (r.sum.balance > 0 ? money(r.sum.balance) : 'Clear') + '</td>'
            + '<td class="ml">' + esc(r.sum.unpaid.map(function (m) { return MZ.monthShort(m) + (m.slice(0, 4) !== now.slice(0, 4) ? ' ' + m.slice(2, 4) : ''); }).join(', ') || '—') + '</td>'
            + '<td class="r">' + money(r.all.total) + '<small>' + r.all.months + ' month' + (r.all.months === 1 ? '' : 's') + '</small></td></tr>';
        }).join('')
        + '</tbody><tfoot><tr><td></td><td>Total</td><td></td><td></td><td class="r">' + money(T.due) + '</td><td class="r">' + money(T.paid) + '</td><td class="r">' + money(T.bal) + '</td><td></td><td class="r">' + money(rows.reduce(function (a, r) { return a + r.all.total; }, 0)) + '</td></tr></tfoot></table>'
        + '<p class="rc-small">Only approved payments are counted. Months on leave have no fee. Fees are counted in the month they are for. Months still to come are not counted as owed.</p>'
        + '<div class="rc-sign"><div><span></span><small>Accounts</small></div><div><span></span><small>Admin</small></div><div><span></span><small>Date</small></div></div></section>';
    }
    if (d.each) rows.forEach(function (r) {
      var s = r.s, start = s.start_month || now, from = d.from && d.from > start ? d.from : start, to = d.to, byM = {};
      r.pays.forEach(function (p) { (byM[p.month] = byM[p.month] || []).push(p); });
      r.pending.forEach(function (p) { (byM[p.month] = byM[p.month] || []).push(p); });
      var lines = [];
      for (var m = from; m <= to && lines.length < 240; m = MZ.addMonths(m, 1)) lines.push(m);
      h += '<section class="rc acc">' + headF(s.full_name, 'Fee statement · ' + perLabel)
        + '<div class="rc-who">' + [['Admission no', s.admission_no], ['ITS no', s.its_no], ['Username', s.username], ['Monthly fee', MZ.money(MZ.effFee(s), cur) + (s.discount_value ? ' (' + MZ.discountLabel(s, cur) + ')' : '')], ['Since', MZ.monthLabel(start)], ['Mobile', s.phone]].filter(function (x) { return x[1]; }).map(function (x) { return '<div><small>' + esc(x[0]) + '</small><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div>'
        + '<div class="acc-tot"><div><small>Fees due</small><b>' + money(r.sum.total) + '</b></div><div><small>Paid</small><b class="ok">' + money(r.paid) + '</b></div><div><small>Balance due</small><b class="' + (r.sum.balance > 0 ? 'no' : 'ok') + '">' + (r.sum.balance > 0 ? money(r.sum.balance) : 'Clear') + '</b></div><div><small>Paid since joining</small><b>' + money(r.all.total) + '</b></div></div>'
        + (s.breaks && s.breaks.length ? '<p class="rc-small"><b>Breaks:</b> ' + esc(s.breaks.map(function (b) { return MZ.breakLabel(b) + (b.note ? ' (' + b.note + ')' : ''); }).join('; ')) + '</p>' : '')
        + '<table class="acc-t"><thead><tr><th>Month</th><th>Status</th><th class="r">Fee</th><th class="r">Paid</th><th>Paid on</th><th>Receipt</th><th>Method</th></tr></thead><tbody>'
        + lines.map(function (m) {
          var ps = byM[m] || [], ok = ps.filter(function (p) { return p.status !== 'pending'; }), pd = ok.reduce(function (a, p) { return a + p.amount; }, 0);
          var stt = ok.length ? 'paid' : ps.length ? 'pending' : MZ.onLeave(s, m) ? 'leave' : m > now ? 'upcoming' : 'unpaid';
          var lab = { paid: 'Paid', pending: 'Waiting for approval', leave: 'On leave', upcoming: 'Upcoming', unpaid: 'Not paid' }[stt];
          return '<tr class="s-' + stt + '"><td>' + esc(MZ.monthLabel(m)) + '</td><td><span class="acc-pill ' + stt + '">' + lab + '</span></td><td class="r">' + (stt === 'leave' ? '—' : money(MZ.effFee(s))) + '</td><td class="r">' + (pd ? money(pd) : ps.length ? money(ps[0].amount) : '—') + '</td>'
            + '<td>' + esc(ps.map(function (p) { return MZ.dateShort(p.paid_on); }).join(', ')) + '</td><td class="mono">' + esc(ps.map(function (p) { return p.receipt_no; }).join(', ')) + '</td><td>' + esc(ps.map(function (p) { return p.method; }).join(', ')) + '</td></tr>';
        }).join('') + '</tbody></table></section>';
    });
    return h;
  };
  /* One printable A4 page for a student and a month. d = {settings, s, month, prog:[all months], events:[that month], pays:[], ikh:[], rank} */
  MZ.reportCardHTML = function (d) {
    var s = d.s, st = d.settings, m = d.month, cur = st.currency, rows = d.prog || [];
    var r = rows.filter(function (x) { return x.month === m; })[0] || null, later = m >= MZ.thisMonth();
    var start = r ? MZ.startPageOf(r) : null, goal = MZ.goalPageOf(r), reached = later ? s.pages : (r && r.pages_end != null ? r.pages_end : null);
    var reachedGoal = !!(r && (r.goal_awarded || (goal && reached != null && reached >= goal)));
    var earned = (d.events || []).filter(function (e) { return e.month === m; }), plus = earned.reduce(function (a, e) { return a + Math.max(0, e.keys); }, 0);
    var byKind = {}; earned.forEach(function (e) { var k = e.kind === 'bonus' ? String(e.note || 'Bonus').split(':')[0] : { jadeed: 'Jadeed pages', ikhtibar: 'Ikhtibar', goal: 'Monthly goal' }[e.kind] || e.kind; byKind[k] = (byKind[k] || 0) + e.keys; });
    var pay = (d.pays || []).filter(function (p) { return p.month === m; })[0], y = m.slice(0, 4);
    var sum = MZ.feeSummary(s, d.pays || [], y + '-01', m), status = MZ.statusOf(s, m, pay, st);
    var ikh = (d.ikh || []).filter(function (x) { return x.exam_date.slice(0, 7) === m && x.status !== 'cancelled'; });
    var ajza = MZ.ajzaList(r && r.ajza_improve), juz = MZ.juzDone(reached == null ? s.pages : reached);
    var pct = Math.round((reached == null ? s.pages : reached) / 604 * 1000) / 10;
    return '<section class="rc"><header class="rc-head"><img src="assets/logo-qt.png" alt=""><div><p class="rc-inst">' + esc(st.institute_name) + '</p><h1>Monthly report card</h1><p class="rc-month">' + esc(MZ.monthLabel(m)) + '</p></div></header>'
      + '<div class="rc-who"><div><small>Student</small><b>' + esc(s.full_name) + '</b></div>' + (s.admission_no ? '<div><small>Admission no</small><b>' + esc(s.admission_no) + '</b></div>' : '') + (s.its_no ? '<div><small>ITS no</small><b>' + esc(s.its_no) + '</b></div>' : '') + (s.program ? '<div><small>Program</small><b>' + esc(s.program) + '</b></div>' : '') + '</div>'
      + '<div class="rc-grid">'
      + '<div class="rc-box"><h2>Hifz</h2>'
      + (r && (r.start_surah || r.goal_surah || r.end_surah) ? '<div class="rc-pages rc-pos"><div><small>Started at</small><b>' + esc(MZ.posLabel(r.start_surah, r.start_pos, true) || '–') + '</b></div><span>→</span><div><small>' + (later ? 'Now at' : 'Reached') + '</small><b>' + esc((later ? MZ.posLabel(s.cur_surah, s.cur_pos, true) : MZ.posLabel(r.end_surah, r.end_pos, true)) || '–') + '</b></div><span>·</span><div><small>Goal</small><b>' + esc(MZ.posLabel(r.goal_surah, r.goal_pos, true) || '–') + '</b></div></div>' : '')
      + '<div class="rc-pages"><div><small>Pages this month</small><b>' + (start != null && reached != null ? Math.max(0, reached - start) : '–') + '</b></div><span>/</span><div><small>Goal (pages)</small><b>' + (goal && start != null ? goal - start : '–') + '</b></div></div>'
      + '<p class="rc-verdict ' + (reachedGoal ? 'ok' : goal ? 'no' : '') + '">' + (reachedGoal ? '✓ Monthly goal reached' : goal ? (reached == null ? 'Goal: ' + (goal - start) + ' pages' : (goal - reached) + ' pages short of the goal') : 'No goal set this month') + '</p>'
      + '<div class="rc-bar"><i style="width:' + Math.min(100, pct) + '%"></i></div><p class="rc-small">' + (reached == null ? s.pages : reached) + ' of 604 pages memorised (' + pct + '%) · ' + juz + ' ' + (juz === 1 ? 'juz' : 'ajza') + (s.cur_surah || s.cur_pos ? ' · now at ' + esc(MZ.posLabel(s.cur_surah, s.cur_pos)) : '') + '</p>'
      + '<table class="rc-t">' + rcRow('Jadeed pages this month', r ? String(r.jadeed) : '0') + rcRow('Total memorised this year', String(MZ.monthHifz(s, rows, m).year) + ' pages') + rcRow('Dawrat completed', r && r.dawrat != null ? String(r.dawrat) : '–') + '</table></div>'
      + '<div class="rc-box"><h2>Keys</h2><div class="rc-keys"><div><b>' + plus + '</b><small>earned this month</small></div><div><b>' + s.keys + '</b><small>total keys</small></div>' + (d.rank ? '<div><b>#' + d.rank + '</b><small>this month</small></div>' : '') + '</div>'
      + '<table class="rc-t">' + Object.keys(byKind).map(function (k) { return rcRow(k, MZ.signed(byKind[k])); }).join('') + (earned.length ? '' : '<tr><td colspan="2" class="rc-small">No keys this month.</td></tr>') + '</table>'
      + '<p class="rc-small">Rewards unlocked: ' + MZ.rewardLevel(s.keys, st) + ' · given: ' + (s.rewards_given || 0) + '</p></div>'
      + '<div class="rc-box wide"><h2>Teacher’s report</h2><table class="rc-t">'
      + rcRow('Ajza to be improved', ajza.length ? ajza.map(function (j) { return 'Juz ' + j; }).join(', ') : 'None')
      + rcRow('Ahkaam / Makharij to be improved', r && r.ahkaam ? '<span dir="auto">' + esc(r.ahkaam) + '</span>' : '–')
      + rcRow('Teacher’s note', r && r.report_note ? '<span dir="auto">' + esc(r.report_note) + '</span>' : '')
      + rcRow('Ikhtibar', ikh.length ? ikh.map(function (x) { return esc(MZ.dateShort(x.exam_date) + ' · ' + x.title + ' · ' + ({ scheduled: x.exam_date < MZ.today() ? 'no result yet' : 'coming', cleared: 'Cleared', not_cleared: 'Not cleared' })[x.status]); }).join('<br>') : 'None this month')
      + '</table></div>'
      + (d.noFees ? '</div>' : '<div class="rc-box wide"><h2>Fees</h2><table class="rc-t">'
      + rcRow(MZ.monthLabel(m), pay ? 'Paid ' + esc(MZ.money(pay.amount, cur)) + ' on ' + esc(MZ.dateLabel(pay.paid_on)) + ' · receipt ' + esc(pay.receipt_no) : esc(MZ.STATUS_LABEL[status] || '') + (MZ.effFee(s) ? ' · ' + esc(MZ.money(MZ.effFee(s), cur)) : ''))
      + rcRow('Paid in ' + y + ' so far', esc(MZ.money(sum.paid, cur)))
      + rcRow('Balance due', sum.balance > 0 ? '<b>' + esc(MZ.money(sum.balance, cur)) + '</b> (' + esc(sum.unpaid.map(MZ.monthShort).join(', ')) + ')' : 'Nothing due. Thank you.')
      + '</table></div></div>')
      + '<footer class="rc-sign"><div><span></span><small>Teacher</small></div><div><span></span><small>Head of Qism al Tahfeez</small></div><div><span></span><small>Parent / Guardian</small></div></footer>'
      + '<p class="rc-foot">Printed ' + esc(MZ.dateLabel(MZ.today())) + ' · ' + esc(st.institute_name) + '</p></section>';
  };
  /* A4 landscape certificate. o = {settings, s, juz (1..30), month, all (whole Qur'an)} */
  MZ.certificateHTML = function (o) {
    var s = o.s, all = o.all || o.juz >= 30 && (+s.pages >= 604), fem = /^f/i.test(s.gender || '');
    var title = all ? (fem ? 'Hafizat al-Qur’an' : 'Hafiz al-Qur’an') : 'Certificate of Hifz';
    var line = all ? 'has completed the hifz of the <b>entire Qur’an al-Kareem</b>, all thirty ajza.'
      : 'has memorised <b>' + (o.juz === 1 ? 'one juz' : o.juz + ' ajza') + '</b> of the Qur’an al-Kareem.';
    return '<section class="cert' + (all ? ' all' : '') + '"><div class="cert-frame"><div class="cert-in">'
      + '<img class="cert-logo" src="assets/logo-qt.png" alt="">'
      + '<h1>' + esc(title) + '</h1><p class="cert-pre">This is to certify that</p><p class="cert-name">' + esc(s.full_name) + '</p>'
      + '<p class="cert-line">' + line + '</p>'
      + (all ? '' : '<div class="cert-juz"><b>' + o.juz + '</b><small>of 30</small></div>')
      + '<div class="cert-sign"><div><span></span><small>Teacher</small></div><div class="cert-date"><b>' + esc(MZ.monthLabel(o.month || MZ.thisMonth())) + '</b><small>' + esc(o.settings.institute_name) + '</small></div><div><span></span><small>Head of Qism al Tahfeez</small></div></div>'
      + '</div></div></section>';
  };
  /* Certificates list for one student. */
  MZ.certList = function (s, rows) {
    var n = MZ.juzDone(s.pages), out = [];
    for (var j = 1; j <= n; j++) out.push({ juz: j, all: j === 30, month: MZ.juzMonth(rows, j) });
    return out;
  };
  /* ---------------------------------------------------------- welcome when the installed app opens */
  (function () {
    var force = /[?&]welcome\b/.test(location.search), seen = false;
    try { seen = sessionStorage.getItem('qt_welcome') === '1'; } catch (e) {}
    var isApp = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    if ((!isApp && !force) || (seen && !force) || !document.body) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try { sessionStorage.setItem('qt_welcome', '1'); } catch (e) {}
    var d = document.createElement('div'); d.className = 'fz-splash'; d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<div class="sp-arch"><svg viewBox="0 0 300 420"><path class="sp-draw" d="M10 420V178Q10 76 120 34L150 8L180 34Q290 76 290 178V420" fill="none" stroke="#fff" stroke-width="2.6"/>'
      + '<path class="sp-draw d2" d="M26 420V181Q26 88 128 50L150 30L172 50Q274 88 274 181V420" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.2"/></svg>'
      + '<img src="assets/logo-qt-sm.png" alt=""></div><p>Qism al Tahfeez</p>';
    document.body.appendChild(d);
    var close = function () { d.classList.add('out'); setTimeout(function () { d.remove(); }, 700); };
    d.addEventListener('click', close); setTimeout(close, 2300);
  })();

  /* ---------------------------------------------------------- day / night */
  MZ.ICON.moon = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M17 3.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor"/></svg>';
  MZ.ICON.sun = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  MZ.themeChipsHTML = function () {
    var cur = window.QTTheme ? QTTheme.get() : 'auto';
    return '<div class="chips" role="radiogroup" aria-label="Appearance">' + [['auto', 'Automatic'], ['light', 'Day'], ['dark', 'Night']].map(function (x) {
      return '<button class="chip" type="button" role="radio" data-theme-set="' + x[0] + '" aria-pressed="' + (cur === x[0]) + '" aria-checked="' + (cur === x[0]) + '">' + (x[0] === 'dark' ? MZ.ICON.moon.replace(/20/g, '15') + ' ' : x[0] === 'light' ? MZ.ICON.sun.replace(/20/g, '15') + ' ' : '') + x[1] + '</button>';
    }).join('') + '</div>';
  };
  MZ.themeToggleHTML = function () {
    var night = window.QTTheme && QTTheme.now() === 'dark';
    return '<button class="iconbtn themebtn" type="button" data-theme-toggle aria-label="' + (night ? 'Switch to day colours' : 'Switch to night colours') + '" title="' + (night ? 'Day' : 'Night') + '">' + (night ? MZ.ICON.sun : MZ.ICON.moon) + '</button>';
  };
  function drawThemeUI() {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) { b.outerHTML = MZ.themeToggleHTML(); });
    document.querySelectorAll('[data-theme-set]').forEach(function (b) { var on = window.QTTheme && QTTheme.get() === b.dataset.themeSet; b.setAttribute('aria-pressed', on); b.setAttribute('aria-checked', on); });
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-theme-toggle],[data-theme-set]'); if (!t || !window.QTTheme) return;
    if (t.hasAttribute('data-theme-toggle')) QTTheme.set(QTTheme.now() === 'dark' ? 'light' : 'dark'); else QTTheme.set(t.dataset.themeSet);
    drawThemeUI();
  });
  if (document.readyState !== 'loading') setTimeout(drawThemeUI, 0); else document.addEventListener('DOMContentLoaded', drawThemeUI);
  if (window.matchMedia) { var tmq = matchMedia('(prefers-color-scheme: dark)'); if (tmq.addEventListener) tmq.addEventListener('change', function () { setTimeout(drawThemeUI, 0); }); }

  /* ---------------------------------------------------------- install as an app */
  var installEvt = null;
  MZ.isApp = function () { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; };
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  MZ.installHTML = function () {
    if (MZ.isApp()) return '';
    var name = /institute/.test(location.pathname) ? 'Institute' : 'Student';
    if (installEvt) return '<div class="install"><img src="assets/app-192.png" alt=""><span><b>Get the app</b><small>Opens like an app from your home screen, with the logo.</small></span><button type="button" class="btn gold sm" data-install-go>Install</button></div>';
    if (isIOS) return '<div class="install"><img src="assets/app-192.png" alt=""><span><b>Get the app on iPhone</b><small>In Safari tap <b>Share</b> <svg viewBox="0 0 20 20" width="14" height="14" aria-label="Share icon" style="vertical-align:-2px"><path d="M10 12.5V3M6.5 6.5 10 3l3.5 3.5M5 9H4v8h12V9h-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>, then <b>Add to Home Screen</b>.</small></span></div>';
    return '';
  };
  function drawInstall() { document.querySelectorAll('[data-install]').forEach(function (el) { el.innerHTML = MZ.installHTML(); }); }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; drawInstall(); });
  window.addEventListener('appinstalled', function () { installEvt = null; drawInstall(); MZ.toast('App installed. Open it from your home screen.'); });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-install-go]') || !installEvt) return;
    var ev = installEvt; installEvt = null; ev.prompt();
    (ev.userChoice || Promise.resolve()).then(function () { drawInstall(); });
  });
  document.addEventListener('DOMContentLoaded', drawInstall); if (document.readyState !== 'loading') setTimeout(drawInstall, 0);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !/claude|claudeusercontent/.test(location.hostname)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  /* Demo mode mirrors the database rules: what each staff role may read and change. */
  var ROLE_RULES = {
    enter: { r: ['listPayments', 'listFinance'], w: ['recordPayment', 'deletePayment', 'saveFinance', 'uploadProof'] },
    fees: { r: ['listReminders'], w: ['sendReminder', 'deleteFinance', 'removeProof'] },
    teach: { r: ['listAttendance', 'listProgress', 'listKeyEvents', 'listKeyEventsMonth', 'listIkhtibars', 'listBadges'],
      w: ['markAttendance', 'recordJadeed', 'recordIkhtibar', 'setGoal', 'setPages', 'setNowAt', 'setHifzDir', 'addMemorizedPages', 'adminCorrectGoal', 'adminDeleteGoal', 'adminDeleteStart', 'adminDeleteEntry', 'undoKeyEvent', 'giveReward', 'saveMonthReport', 'scheduleIkhtibar', 'updateIkhtibar', 'ikhtibarResult', 'deleteIkhtibar', 'awardRule', 'awardBadge', 'deleteBadge'] },
    admin: { r: ['teacherFeedback'],
      w: ['addNotice', 'deleteNotice', 'approvePayments', 'saveSettings', 'createStudent', 'deleteStudent', 'resetPassword', 'setDisabled', 'addStaff', 'removeStaff', 'resetStaffPassword', 'setStaffRole', 'saveHR', 'deleteHR', 'saveKeyRule', 'deleteKeyRule'] }
  };
  MZ.roleCan = function (role, area) { return role === 'admin' || (area === 'fees' && role === 'accounts') || (area === 'enter' && (role === 'accounts' || role === 'cashier')) || (area === 'teach' && role === 'teacher'); };
  function withRoles(a) {
    Object.keys(ROLE_RULES).forEach(function (area) {
      ['r', 'w'].forEach(function (kind) {
        ROLE_RULES[area][kind].forEach(function (name) {
          var fn = a[name]; if (!fn) return;
          a[name] = function () {
            if (a.mode === 'demo' && a.myRole && portalOf(a) === 'institute' && !MZ.roleCan(a.myRole(), area) && !(kind === 'r' && a.myRole() === 'viewer')) {
              return kind === 'r' ? Promise.resolve([]) : Promise.reject(new Error('Your account is not allowed to do that.'));
            }
            return fn.apply(a, arguments);
          };
        });
      });
    });
    // demo mirrors the database: teachers cannot change pages, nor past months
    if (a.mode === 'demo') {
      var isT = function () { return a.myRole && portalOf(a) === 'institute' && a.myRole() === 'teacher'; };
      ['setHifzDir', 'setPages'].forEach(function (name) { var fn = a[name]; if (fn) a[name] = function () { return isT() ? Promise.reject(new Error('Only the admin can change the memorisation direction or correct the total.')) : fn.apply(a, arguments); }; });
      ['setGoal', 'saveMonthReport', 'recordJadeed'].forEach(function (name) { var fn = a[name]; if (fn) a[name] = function (sid, month) { return isT() && month < MZ.thisMonth() ? Promise.reject(new Error('Past months are locked. Teachers can fill in this month and the coming months.')) : fn.apply(a, arguments); }; });
    }
    var ls = a.listStudents, us = a.updateStudent, lh = a.listHR;
    // HR: admin sees everything; accounts sees only payroll and the teacher names (for the books); teachers see nothing
    if (lh) a.listHR = function () {
      var role = portalOf(a) === 'institute' && a.myRole ? a.myRole() : 'admin';
      if (role === 'teacher' || role === 'cashier') return Promise.resolve([]);
      return lh.apply(a, arguments).then(function (l) { return role === 'accounts' ? l.filter(function (x) { return x.kind === 'payroll' || x.kind === 'teacher'; }) : l; });
    };
    // a teacher sees only their students: set on the student, or in their schedule (14 days back to 30 ahead)
    function myStudentIds() {
      if (a.mode !== 'demo' || portalOf(a) !== 'institute' || !a.myRole || a.myRole() !== 'teacher') return null;
      var db = JSON.parse(localStorage.getItem(DKEY) || '{}'), uid = a.myUid ? a.myUid() : null, t = (db.hr || []).find(function (h) { return h.kind === 'teacher' && uid && h.data.user_id === uid; });
      var from = new Date(); from.setDate(from.getDate() - 14); var to = new Date(); to.setDate(to.getDate() + 30);
      var f = from.toISOString().slice(0, 10), tt = to.toISOString().slice(0, 10), ok = {};
      (db.students || []).forEach(function (s) { if (t && (s.teacher_ids || []).some(function (x) { return String(x) === String(t.id); })) ok[s.id] = 1; });
      (db.schedules || []).forEach(function (r) { if (uid && r.teacher_user === uid && r.status === 'scheduled' && r.slot_date >= f && r.slot_date <= tt) ok[r.student_id] = 1; });
      return ok;
    }
    a.myStudentIds = myStudentIds;
    ['listProgress', 'listKeyEvents', 'listKeyEventsMonth', 'listIkhtibars', 'listBadges'].forEach(function (name) {
      var fn = a[name]; if (!fn) return;
      a[name] = function () { return fn.apply(a, arguments).then(function (l) { var ok = myStudentIds(); return ok && Array.isArray(l) ? l.filter(function (r) { return !r.student_id || ok[r.student_id]; }) : l; }); };
    });
    a.listStudents = function () {
      return ls.apply(a, arguments).then(function (l) {
        if (portalOf(a) !== 'institute' || a.myRole() !== 'teacher') return l;
        var ok = myStudentIds(); if (ok) l = l.filter(function (s) { return ok[s.id]; });
        return l.map(function (s) { var c = Object.assign({}, s); c.monthly_fee = 0; c.discount_value = 0; c.discount_note = ''; c.hidden_fees = true; return c; });
      });
    };
    a.updateStudent = function (id, patch) {
      var role = portalOf(a) === 'institute' ? a.myRole() : 'admin', keys = Object.keys(patch || {});
      var FEE = ['monthly_fee', 'start_month', 'discount_type', 'discount_value', 'discount_note', 'breaks'];
      if (role === 'teacher' && keys.some(function (k) { return k !== 'cur_surah' && k !== 'cur_pos'; })) return Promise.reject(new Error('Teachers can update hifz only.'));
      var mine = myStudentIds(); if (mine && !mine[id]) return Promise.reject(new Error('This student is not one of yours. Ask the admin to add you as their teacher.'));
      if (role === 'accounts' && keys.some(function (k) { return FEE.indexOf(k) < 0; })) return Promise.reject(new Error('The accounts team can change fees only.'));
      if (role === 'cashier') return Promise.reject(new Error('The cashier can enter fees, income and expenses only.'));
      if (role === 'viewer') return Promise.reject(new Error('This is a view-only account.'));
      return us.apply(a, arguments);
    };
    return a;
  }
  function portalOf(a) { return a._portal; }
  MZ.STRONG_PW_MSG = 'Staff passwords need at least 10 characters, with letters and numbers.';
  /* Phone alerts (Web Push) and installing the portal as an app */
  function vapidKey(b64) { var s = String(b64).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var r = atob(s), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
  MZ.push = {
    supported: function () { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; },
    ios: function () { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); },
    standalone: function () { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; },
    // 'on' | 'off' | 'blocked' | 'install' (iPhone: add to Home Screen first) | 'unsupported'
    state: function () {
      if (!MZ.push.supported()) return Promise.resolve(MZ.push.ios() && !MZ.push.standalone() ? 'install' : 'unsupported');
      if (Notification.permission === 'denied') return Promise.resolve('blocked');
      if (!MZ.LIVE) { var on = false; try { on = localStorage.getItem('qt_push_demo') === '1'; } catch (e) {} return Promise.resolve(on && Notification.permission === 'granted' ? 'on' : 'off'); }
      return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) { return sub && Notification.permission === 'granted' ? 'on' : 'off'; }).catch(function () { return 'off'; });
    },
    enable: function (api) {
      return Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Alerts are blocked. Allow notifications for this site in your browser settings, then try again.' : 'Alerts were not allowed.');
        if (!MZ.LIVE) { try { localStorage.setItem('qt_push_demo', '1'); } catch (e) {} return api.savePushSub({ endpoint: 'demo-' + navigator.userAgent.length + '-' + Date.now(), keys: {} }); }
        if (!CFG.VAPID_PUBLIC_KEY) throw new Error('Phone alerts are not set up (VAPID_PUBLIC_KEY missing in js/config.js).');
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.getSubscription().then(function (old) { return old || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey(CFG.VAPID_PUBLIC_KEY) }); });
        }).then(function (sub) { return api.savePushSub(sub); });
      });
    },
    disable: function (api) {
      if (!MZ.LIVE) { try { localStorage.removeItem('qt_push_demo'); } catch (e) {} return Promise.resolve(); }
      return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
        if (!sub) return; var ep = sub.endpoint; return sub.unsubscribe().then(function () { return api.removePushSub(ep).catch(function () {}); });
      });
    }
  };
  MZ.strongPw = function (p) { p = String(p || ''); return p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p); };
  MZ.ROLES = {
    admin: { name: 'Admin', desc: 'Everything: fees, accounts, HR, students, hifz, ikhtibar, Student Hub and settings.' },
    teacher: { name: 'Teacher', desc: 'Students’ hifz, monthly reports, ikhtibar, keys, certificates and the Student Hub. No fees.' },
    accounts: { name: 'Accounts', desc: 'All the money: fees, discounts, reminders, income, expenses, the cash and bank books and printing.' },
    cashier: { name: 'Cashier', desc: 'Enters student fees, income and expenses only. Sees no totals, balances or reports. Fees wait for admin approval.' },
    viewer: { name: 'View only', desc: 'Can look at Accounts, HR, Progress and Ikhtibar. Cannot add, change or delete anything.' }
  };
  MZ.createApi = function (portal) {
    if (MZ.LIVE && window.supabase) return liveApi(portal);
    var a = demoApi(portal); a._portal = portal; return withRoles(a);
  };

  MZ.demoBanner = function () {
    if (MZ.LIVE) return '';
    return '<div class="demo"><b>Demo mode.</b> Data is saved only in this browser. Add your Supabase keys in js/config.js to go live.</div>';
  };
})();
