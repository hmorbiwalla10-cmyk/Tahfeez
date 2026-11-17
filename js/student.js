/* Qism al Tahfeez — Student portal */
(function () {
  'use strict';
  var $ = MZ.$, esc = MZ.esc, I = MZ.ICON;
  var api = MZ.createApi('student');
  var S = { view: 'home', me: null, pays: [], settings: { institute_name: 'Qism al Tahfeez Dar es Salaam', currency: 'TSh', due_day: 5 }, year: +MZ.thisMonth().slice(0, 4), queue: [], showing: null, typedPw: null, prog: [], events: [], notices: [], reminders: [], teachers: [], myRatings: [], ikh: [], rules: [], lb: [], badges: [], sched: [] };
  try { if (location.hash === '#receipts') S.view = 'receipts'; if (location.hash === '#notices') S.view = 'notices'; if (location.hash === '#teachers') S.view = 'teachers'; if (location.hash === '#timetable') S.ttJump = 1; } catch (e) {}

  $('#demo').innerHTML = MZ.demoBanner();
  MZ.togglePw();

  /* --------------------------------------------------------- sign in */
  function showSignin() {
    document.body.classList.remove('in-app');
    $('#app').hidden = true; $('#signin').hidden = false; $('#inDemo').hidden = MZ.LIVE;
    setTimeout(function () { $('#inUser').focus(); }, 50);
  }
  $('#inBtn').disabled = false;   // the button only works once the page is ready, so a password never ends up in the address bar
  $('#signinForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#inBtn'), err = $('#inErr');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Signing in…';
    S.typedPw = $('#inPass').value;
    api.signIn($('#inUser').value, S.typedPw).then(function () { $('#inPass').value = ''; startApp(true); })
      .catch(function (e2) { err.textContent = e2.message; err.hidden = false; })
      .then(function () { btn.disabled = false; btn.textContent = 'Sign in'; });
  });

  /* ------------------------------------------------------------- data */
  function load() {
    return Promise.all([api.me(), api.myPayments(), api.getSettings(), api.myProgress().catch(function () { return []; }),
      api.myKeyEvents().catch(function () { return []; }), api.listNotices().catch(function () { return []; }), api.myReminders ? api.myReminders().catch(function () { return []; }) : [],
      api.teachersForStudents().catch(function () { return []; }), api.myTeacherRatings().catch(function () { return []; }), api.myIkhtibars().catch(function () { return []; }), api.listKeyRules().catch(function () { return []; }), api.leaderboard(MZ.thisMonth()).catch(function () { return []; })]).then(function (r) {
      S.lb = r[11] || [];
      S.teachers = r[7] || []; S.myRatings = r[8] || []; S.ikh = r[9] || []; S.rules = (r[10] || []).filter(function (x) { return x.active; });
      S.me = r[0]; S.pays = r[1]; S.settings = r[2]; S.prog = r[3]; S.events = r[4]; S.notices = r[5]; S.reminders = r[6] || [];
      return Promise.all([api.myBadges ? api.myBadges().then(function (b) { S.badges = b || []; }, function () { S.badges = []; }) : null,
        api.mySchedule ? api.mySchedule().then(function (l) { S.sched = l || []; }, function () { S.sched = []; }) : null]);
    });
  }
  function reloadProgress() {
    if (api.myReminders) api.myReminders().then(function (l) { if (l.length !== S.reminders.length) { S.reminders = l; if (!S.showing) render(); } }).catch(function () {});
    api.leaderboard(MZ.thisMonth()).then(function (l) { if (JSON.stringify(l) !== JSON.stringify(S.lb)) { S.lb = l; if (!S.showing) render(); } }).catch(function () {});
    if (api.mySchedule) api.mySchedule().then(function (l) {
      l = l || []; var sig = function (a) { return JSON.stringify(a.map(function (x) { return [x.id, x.updated_at, x.status, x.student_seen_at]; })); };
      if (sig(l) === sig(S.sched)) return;
      var fresh = l.filter(function (x) { return !x.student_seen_at && x.slot_date >= MZ.today() && !S.sched.some(function (o) { return o.id === x.id && o.updated_at === x.updated_at; }); });
      S.sched = l; if (fresh.length) schedNotify(fresh);
      if (!S.showing) { render(); nextInQueue(); }
    }).catch(function () {});
    if (api.myBadges) api.myBadges().then(function (b) { if ((b || []).length !== S.badges.length) { S.badges = b || []; if (!S.showing) { render(); nextInQueue(); } } }).catch(function () {});
    return Promise.all([api.me(), api.myProgress(), api.myKeyEvents(), api.listNotices().catch(function () { return S.notices; }), api.myIkhtibars().catch(function () { return S.ikh; })]).then(function (r) {
      var changed = r[0].keys !== S.me.keys || r[0].pages !== S.me.pages || r[3].length !== S.notices.length || r[2].length !== S.events.length
        || JSON.stringify(r[1]) !== JSON.stringify(S.prog) || JSON.stringify(r[4]) !== JSON.stringify(S.ikh);
      var fresh = r[3].filter(function (n) { return !S.notices.some(function (o) { return o.id === n.id; }); });
      S.me = r[0]; S.prog = r[1]; S.events = r[2]; S.notices = r[3]; S.ikh = r[4];
      if (fresh.length) osNotify(fresh);
      if (changed && !S.showing) { render(); keysToast(); }
      if (!S.showing) nextInQueue();
    }).catch(function () {});
  }
  function startApp(fresh) {
    $('#signin').hidden = true; $('#app').hidden = false; document.body.classList.add('in-app');
    $('#screen').innerHTML = '<p class="muted" style="padding:40px 18px">Loading…</p>';
    load().then(function () {
      render();
      queueUnseen();
      if (fresh && S.typedPw && S.typedPw === S.settings.default_password) setTimeout(function () { if (!S.showing) openAccount(true); else S.askPw = true; }, 300);
      S.typedPw = null;
      if (S.unwatch) S.unwatch();
      var u1 = api.watchPayments(function () {
        api.myPayments().then(function (p) { S.pays = p; if (!S.showing) render(); queueUnseen(); }).catch(function () {});
        reloadProgress();
      });
      var u2 = api.watchKeys ? api.watchKeys(reloadProgress) : function () {};
      var poll = setInterval(function () { if (!document.hidden || ('Notification' in window && Notification.permission === 'granted')) reloadProgress(); }, 90000);
      var onVis = function () { if (!document.hidden) reloadProgress(); };
      document.addEventListener('visibilitychange', onVis);
      S.unwatch = function () { u1(); u2(); clearInterval(poll); document.removeEventListener('visibilitychange', onVis); };
      keysToast();
    }).catch(function (e) {
      $('#screen').innerHTML = '<div style="padding:40px 18px;display:grid;gap:12px"><p class="err">' + esc(e.message) + '</p><button class="btn" data-act="signOut">Sign out</button></div>';
    });
  }
  function payFor(month) { for (var i = 0; i < S.pays.length; i++) if (S.pays[i].month === month) return S.pays[i]; return null; }
  function payById(id) { for (var i = 0; i < S.pays.length; i++) if (String(S.pays[i].id) === String(id)) return S.pays[i]; return null; }

  /* ---------------------------------------------------------- render */
  function render() {
    var unseen = S.pays.filter(function (p) { return !p.seen_at; }).length;
    var newNotices = S.notices.filter(function (n) { return !noticeSeen(n); }).length;
    $('#navHome').innerHTML = I.home + '<span>Home</span>';
    $('#navRec').innerHTML = I.receipt + '<span>Receipts</span>' + (unseen ? '<span class="badge">' + unseen + '</span>' : '');
    $('#navNot').innerHTML = I.doc.replace('width="22" height="22"', 'width="24" height="24"') + '<span>Student Hub</span>' + (newNotices ? '<span class="badge">' + newNotices + '</span>' : '');
    $('#navHome').setAttribute('aria-current', S.view === 'home' ? 'page' : 'false');
    $('#navRec').setAttribute('aria-current', S.view === 'receipts' ? 'page' : 'false');
    $('#navNot').setAttribute('aria-current', S.view === 'notices' ? 'page' : 'false');
    var toRate = unrated().length;
    $('#navTea').innerHTML = I.user.replace('width="22" height="22"', 'width="24" height="24"') + '<span>Teachers</span>' + (toRate ? '<span class="badge">' + toRate + '</span>' : '');
    $('#navTea').setAttribute('aria-current', S.view === 'teachers' ? 'page' : 'false');
    setTimeout(animateKeys, 0);
    if (S.myArch) { S.myArch.stop(); S.myArch = null; }
    $('#screen').innerHTML = S.view === 'home' ? homeHTML() : S.view === 'notices' ? noticesHTML() : S.view === 'teachers' ? teachersHTML() : receiptsHTML();
    if (S.ttJump && S.view === 'home' && $('#schedBox')) { S.ttJump = 0; setTimeout(function () { var b = $('#schedBox'); if (b) { b.scrollIntoView({ block: 'start', behavior: 'smooth' }); b.classList.add('flash'); } }, 300); }
    // the student's own 604 arch: one gold tile for every page memorised (builds up once per visit)
    var ma = $('#screen .fx-myarch');
    if (ma && MZ.fx && MZ.fx.arch) { S.myArch = MZ.fx.arch(ma, { lit: S.me.pages, animate: !S.archDone, duration: 2.4 }); S.archDone = true; }
  }
  function header() {
    return '<div class="shead-top"><img src="assets/logo-qt-sm.png" alt=""><b>' + esc(S.settings.institute_name || 'Qism al Tahfeez Dar es Salaam') + '</b>'
      + MZ.themeToggleHTML() + '<button class="iconbtn" data-act="account" aria-label="My account">' + I.user + '</button></div>';
  }
  function homeHTML() {
    var s = S.me, cur = S.settings.currency, m = MZ.thisMonth(), p = payFor(m), st = MZ.statusOf(s, m, p, S.settings);
    var h = '<header class="shead goldfield">' + '<svg class="fz-window" viewBox="0 0 300 420" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="3"><path d="M10 420V178Q10 76 120 34L150 8L180 34Q290 76 290 178V420"/><path d="M34 420V184Q34 96 132 58L150 40L168 58Q266 96 266 184V420" stroke-width="1.6"/><path d="M150 182L58 182M150 182L64 149M150 182L82 120M150 182L109 100M150 182L141 90M150 182L159 90M150 182L191 100M150 182L218 120M150 182L236 149M150 182L242 182" stroke-width="1.4"/><circle cx="150" cy="182" r="32" stroke-width="2"/></g></svg>' + header()
      + '<div class="fx-myarch" aria-hidden="true"></div><div class="fx-myarch-l"><b class="num">' + s.pages + '</b>of 604 pages</div>'
      + '<div class="hello"><p>Welcome back</p><h1>' + esc(MZ.firstName(s.full_name)) + '</h1>' + (s.program ? '<p class="prog">' + esc(s.program) + (s.admission_no ? ' · ' + esc(s.admission_no) : '') + '</p>' : '') + '</div><span class="fz-edge" aria-hidden="true"></span></header><div class="scontent">';
    h += noticeBannerHTML() + scheduleHTML();
    var rem = S.reminders.filter(function (x) { return !x.seen_at; })[0];
    if (rem && st !== 'paid') h += '<section class="remind"><div><p class="eyebrow">Reminder from the institute</p><p class="rmsg">' + esc(rem.message) + '</p><small class="muted">' + esc(MZ.dateLabel((rem.created_at || '').slice(0, 10))) + '</small></div><button class="btn" data-act="remSeen" data-id="' + rem.id + '">OK</button></section>';
    var ur = unrated();
    if (S.teachers.length && ur.length) h += '<section class="ratecta"><div><p class="eyebrow">' + esc(MZ.monthLabel(MZ.thisMonth())) + '</p><h3>Feedback for your teachers and Musaideen</h3><p class="muted">' + (S.teachers.length - ur.length) + ' of ' + S.teachers.length + ' done. Share appreciation, comments or a concern. It takes a minute and your name is not shown.</p></div><button class="btn gold" data-go="teachers">Give feedback</button></section>';
    var miss = missingDetails();
    if (miss.length) h += '<section class="complete"><div><p class="eyebrow">Action needed</p><h3>Complete your details</h3><p class="muted">Please add your ' + esc(listWords(miss)) + '.</p></div><button class="btn gold" data-act="details">Fill in now</button></section>';
    // this month
    if (st === 'paid') {
      h += '<section class="status paid"><div class="row1"><div><p class="eyebrow">This month</p><h2>' + esc(MZ.monthLabel(m)) + '</h2></div><span class="seal">' + I.check + '</span></div>'
        + '<p class="state">Fees paid</p><p class="amt num">' + esc(MZ.money(p.amount, cur)) + '</p>'
        + '<p class="meta">Paid ' + esc(MZ.dateLabel(p.paid_on)) + ' · ' + esc(p.method) + ' · <span class="mono">' + esc(p.receipt_no) + '</span></p>'
        + '<button class="btn gold block" data-act="receipt" data-id="' + p.id + '">' + I.receipt.replace('width="24" height="24"', 'width="18" height="18"') + 'View receipt</button></section>';
    } else if (st === 'leave') {
      var bk = MZ.breakAt(s, m);
      h += '<section class="status leave"><div class="row1"><div><p class="eyebrow">This month</p><h2>' + esc(MZ.monthLabel(m)) + '</h2></div><span class="seal">' + I.plane + '</span></div>'
        + '<p class="state">On leave</p><p class="meta">' + esc(MZ.breakLabel(bk)) + '. No fees are due while you are away.' + (bk.to ? ' Welcome back in ' + esc(MZ.monthLabel(MZ.addMonths(bk.to, 1))) + '.' : '') + '</p></section>';
    } else if (st === 'na') {
      h += '<section class="status na"><div class="row1"><div><p class="eyebrow">This month</p><h2>' + esc(MZ.monthLabel(m)) + '</h2></div><span class="seal">' + I.home.replace('width="24" height="24"', 'width="22" height="22"') + '</span></div>'
        + '<p class="meta">Your fees start in ' + esc(MZ.monthLabel(s.start_month)) + '.</p></section>';
    } else {
      var dueDate = m + '-' + MZ.pad(S.settings.due_day || 5);
      h += '<section class="status ' + st + '"><div class="row1"><div><p class="eyebrow">This month</p><h2>' + esc(MZ.monthLabel(m)) + '</h2></div><span class="seal">!</span></div>'
        + '<p class="state">' + (st === 'overdue' ? 'Not paid yet' : 'Due by ' + esc(MZ.dateLabel(dueDate))) + '</p><p class="amt num">' + esc(MZ.money(MZ.effFee(s), cur)) + '</p>' + (s.discount_value ? '<p class="meta">Includes your discount: ' + esc(MZ.discountLabel(s, cur)) + (s.discount_note ? ' (' + esc(s.discount_note) + ')' : '') + '</p>' : '')
        + '<p class="meta">Your receipt appears here as soon as the institute records your payment.</p></section>';
    }
    h += ikhAlertHTML() + ikhUpcomingHTML() + goalCardHTML() + weekHTML() + predictHTML() + reportCardHTML() + keysCardHTML() + badgesHTML() + leaderboardHTML() + quranCardHTML() + certsHTML() + monthsHTML() + yearHTML();
    // year
    var y = S.year, paidCount = 0, paidSum = 0, tiles = '';
    for (var i = 1; i <= 12; i++) {
      var k = y + '-' + MZ.pad(i), pp = payFor(k), ms = MZ.statusOf(s, k, pp, S.settings);
      if (pp) { paidCount++; paidSum += pp.amount; }
      tiles += '<button type="button" class="mo ' + ms + '"' + (pp ? ' data-act="receipt" data-id="' + pp.id + '" aria-label="' + esc(MZ.monthLabel(k)) + ' paid, view receipt"' : ' tabindex="-1" aria-label="' + esc(MZ.monthLabel(k)) + ': ' + MZ.STATUS_LABEL[ms] + '"') + '><b>' + MZ.monthShort(k) + '</b><i></i></button>';
    }
    h += '<section class="box"><div class="boxhead"><h3>Fees in ' + y + '</h3><span><button class="iconbtn" data-act="year" data-d="-1" aria-label="Previous year">' + I.left + '</button><button class="iconbtn" data-act="year" data-d="1" aria-label="Next year">' + I.right + '</button></span></div>'
      + '<div class="months">' + tiles + '</div>'
      + '<div class="legend"><span><i style="background:var(--good)"></i>Paid</span><span><i style="background:var(--warn)"></i>Due</span><span><i style="background:var(--bad)"></i>Not paid</span><span><i style="background:var(--gold-line)"></i>Upcoming</span>' + ((s.breaks || []).length ? '<span><i style="background:var(--leave)"></i>On leave</span>' : '') + '</div>'
      + '<div class="stats"><div><b class="num">' + paidCount + '</b><span>Months paid in ' + y + '</span></div><div><b class="num">' + esc(MZ.money(paidSum, cur)) + '</b><span>Total paid in ' + y + '</span></div>' + (function () { var t = MZ.paidTotals(s, S.pays); return t.total ? '<div class="wide"><b class="num">' + esc(MZ.money(t.total, cur)) + '</b><span>Paid since you joined · ' + t.months + ' month' + (t.months === 1 ? '' : 's') + '</span></div>' : ''; })() + '</div></section>';
    h += recentKeysHTML();
    return h + '</div>';
  }
  function receiptsHTML() {
    var cur = S.settings.currency;
    var h = '<header class="pagetitle goldfield">' + header() + '<div class="hello"><h1>Receipts</h1><p>' + S.pays.length + ' receipt' + (S.pays.length === 1 ? '' : 's') + ' saved</p></div><span class="fz-edge" aria-hidden="true"></span></header><div class="scontent">';
    if (!S.pays.length) return h + '<div class="empty">No receipts yet. When the institute records your payment, the receipt appears here.</div></div>';
    h += S.pays.map(function (p) {
      return '<button class="rcard" data-act="receipt" data-id="' + p.id + '"><span class="ic">' + I.receipt + (p.seen_at ? '' : '<span class="dot" aria-label="New"></span>') + '</span>'
        + '<span><b>' + esc(MZ.monthLabel(p.month)) + '</b><small class="mono">' + esc(p.receipt_no) + '</small><small>Paid ' + esc(MZ.dateLabel(p.paid_on)) + '</small></span>'
        + '<span class="amt num">' + esc(MZ.money(p.amount, cur)) + '<small><span class="pill good">Paid</span></small></span></button>';
    }).join('');
    return h + '</div>';
  }

  /* ------------------------------------------------------ hifz & keys */
  /* ---- ikhtibar page alert (20 pages before) */
  function ikhAlertHTML() {
    var ik = MZ.ikhAhead(S.me, S.settings, S.prog); if (!ik) return '';
    return '<section class="ikalert big"><span class="ia-ico">' + I.flag.replace('width="14" height="14"', 'width="22" height="22"') + '</span><div><p class="eyebrow">Ikhtibar ahead</p>'
      + '<h3>' + (ik.away ? 'Page ' + ik.page + ' is ' + ik.away + ' page' + (ik.away === 1 ? '' : 's') + ' away' : 'You have reached page ' + ik.page) + '</h3>'
      + '<p>There is an ikhtibar at page ' + ik.page + '. Go to eLearning and check your ikhtibar history.</p>'
      + (S.settings.elearning_url ? '<a class="btn gold" href="' + esc(S.settings.elearning_url) + '" target="_blank" rel="noopener">Open eLearning</a>' : '') + '</div></section>';
  }
  /* ---- goal predictor */
  function predictHTML() {
    var m = MZ.thisMonth(), g = goalInfo(S.prog.find(function (x) { return x.month === m; }), m), p = MZ.hafizPredict(S.me, S.settings, g.goalN || 0);
    if (!p.left) return '<section class="box predict-s done"><div class="boxhead"><h3>Haafiz</h3></div><p>All 604 pages memorised. Mubarak!</p></section>';
    var cell = function (t, sub, sp, mm) { return '<div class="pr-c"><span>' + t + '</span><b>' + esc(MZ.spanLabel(sp)) + '</b><small>' + (sub ? sub + '<br>' : '') + 'around <b>' + esc(MZ.monthLabel(mm)) + '</b></small></div>'; };
    return '<section class="box predict-s"><div class="boxhead"><h3>When will I be a haafiz?</h3><span class="pill">' + p.left + ' pages to go</span></div><div class="pr-grid">'
      + cell('At 1 page a day', '', p.one.span, p.one.month)
      + cell('At ½ page a day', (p.days / 2) + ' pages a year', p.half.span, p.half.month)
      + (p.plan ? cell('At your takhteet', p.plan.perMonth + ' pages a month · ' + p.plan.yearEnd + ' pages by December', p.plan.span, p.plan.month) : '')
      + '</div></section>';
  }
  /* ---- this week (Monday to Sunday) */
  function weekHTML() {
    var w = MZ.weekOf(MZ.today()), ev = (S.events || []).filter(function (e) { var d = String(e.created_at || '').slice(0, 10); return d >= w.from && d <= w.to; });
    var pages = ev.filter(function (e) { return e.kind === 'jadeed'; }).reduce(function (a, e) { return a + (+e.pages || 1); }, 0);
    var ikh = ev.filter(function (e) { return e.kind === 'ikhtibar'; }).length, keys = ev.reduce(function (a, e) { return a + Math.max(0, +e.keys || 0); }, 0);
    var days = Object.keys(ev.filter(function (e) { return e.kind === 'jadeed'; }).reduce(function (o, e) { o[String(e.created_at).slice(0, 10)] = 1; return o; }, {})).length;
    var dots = ''; for (var i = 0; i < 7; i++) { var d = new Date(new Date(w.from + 'T12:00:00').getTime() + i * 864e5).toISOString().slice(0, 10); var on = ev.some(function (e) { return e.kind === 'jadeed' && String(e.created_at).slice(0, 10) === d; }); dots += '<span class="wd' + (on ? ' on' : '') + (d === MZ.today() ? ' today' : '') + '"><i></i>' + 'MTWTFSS'.charAt(i) + '</span>'; }
    return '<section class="box weekbox"><div class="boxhead"><h3>This week</h3><span class="pill">' + esc(w.label) + '</span></div><div class="wdots">' + dots + '</div>'
      + '<div class="mtotals"><div><b class="num">' + pages + '</b><span>jadeed page' + (pages === 1 ? '' : 's') + '</span></div><div><b class="num">' + days + '</b><span>day' + (days === 1 ? '' : 's') + ' with jadeed</span></div>'
      + '<div><b class="num">' + ikh + '</b><span>ikhtibar cleared</span></div><div><b class="num">' + keys + '</b><span>keys earned</span></div></div></section>';
  }
  /* ---- my year */
  function yearRows(y) { var by = {}; S.prog.forEach(function (r) { if (r.month.slice(0, 4) === String(y)) by[r.month] = r; }); var out = []; for (var i = 1; i <= 12; i++) { var m = y + '-' + MZ.pad(i); out.push({ m: m, r: by[m] || null }); } return out; }
  function yearTableHTML(y) {
    var rows = yearRows(y), tp = 0, tg = 0, ti = 0;
    var body = rows.map(function (x) {
      var r = x.r, g = r ? goalInfo(r, x.m) : null, pg = r ? (+r.jadeed || 0) : 0; tp += pg; if (r && r.goal_awarded) tg++; ti += r ? (+r.ikhtibar || 0) : 0;
      return '<tr><td>' + esc(MZ.monthLabel(x.m)) + '</td><td class="r">' + (r ? pg : '·') + '</td><td class="r">' + (g && g.goalN ? g.goalN : '·') + '</td><td>' + (r && r.goal_awarded ? '✓' : '') + '</td><td class="r">' + (r ? (+r.ikhtibar || 0) : '·') + '</td></tr>';
    }).join('');
    return { html: '<table class="grid yr"><thead><tr><th>Month</th><th class="r">Jadeed pages</th><th class="r">Goal</th><th>Reached</th><th class="r">Ikhtibar</th></tr></thead><tbody>' + body + '</tbody><tfoot><tr><td>Total</td><td class="r">' + tp + '</td><td></td><td>' + tg + '</td><td class="r">' + ti + '</td></tr></tfoot></table>', tp: tp, tg: tg };
  }
  function yearHTML() {
    var y = +MZ.thisMonth().slice(0, 4), t = yearTableHTML(y);
    if (!S.prog.some(function (r) { return r.month.slice(0, 4) === String(y); })) return '';
    return '<section class="box"><div class="boxhead"><h3>My year ' + y + '</h3><button class="btn sm" data-act="myYear">' + I.doc.replace('width="22" height="22"', 'width="16" height="16"') + 'Print</button></div>'
      + '<div class="tablewrap">' + t.html + '</div><p class="muted" style="font-size:13px;margin-top:8px">' + t.tp + ' pages memorised this year · ' + t.tg + ' monthly goal' + (t.tg === 1 ? '' : 's') + ' reached · ' + S.me.pages + ' of 604 in total.</p></section>';
  }
  function printMyYear() {
    var y = +MZ.thisMonth().slice(0, 4), t = yearTableHTML(y), st = S.settings;
    MZ.printHTML('<section class="rc acc"><header class="rc-head"><img src="assets/logo-qt.png" alt=""><div style="flex:1"><p class="rc-inst">' + esc(st.institute_name) + '</p><h1>Yearly report ' + y + '</h1><p class="rc-month">' + esc(S.me.full_name) + '</p></div><div class="acc-stamp">Printed ' + esc(MZ.dateLabel(MZ.today())) + '</div></header>'
      + t.html.replace('class="grid yr"', 'class="acc-t"') + '<p class="rc-small">' + S.me.pages + ' of 604 pages memorised in total.</p></section>', S.me.full_name + ' yearly report ' + y);
  }
  function thisProg() { var m = MZ.thisMonth(); return S.prog.find(function (r) { return r.month === m; }) || { goal: 0, jadeed: 0, ikhtibar: 0, goal_awarded: false }; }
  function keysCardHTML() {
    var s = S.me, st = S.settings, every = st.reward_every, into = s.keys % every, lvl = MZ.rewardLevel(s.keys, st), pct = Math.round(into / every * 100);
    return '<section class="keys goldfield"><div class="keyshead"><div><p class="kl">Your keys</p><p class="kbig num">' + I.key.replace('width="20" height="20"', 'width="34" height="34"') + '<span class="kcount">' + s.keys + '</span></p></div>'
      + '<div class="chest" aria-label="' + lvl + ' rewards unlocked">' + I.gift.replace('width="20" height="20"', 'width="30" height="30"') + '<b class="num">' + lvl + '</b><small>reward' + (lvl === 1 ? '' : 's') + '</small></div></div>'
      + '<div class="kbar" role="progressbar" aria-valuenow="' + into + '" aria-valuemin="0" aria-valuemax="' + every + '"><i style="width:' + pct + '%"></i></div>'
      + '<p class="knext">' + (every - into) + ' more keys to unlock reward ' + (lvl + 1) + (MZ.mastery(s.keys) ? ' · ' + MZ.mastery(s.keys) + ' Mastership badge' + (MZ.mastery(s.keys) === 1 ? '' : 's') : '') + '</p>'
      + '<div class="kways"><span>+' + st.keys_jadeed + ' each jadeed page</span><span>+' + st.keys_ikhtibar + ' ikhtibar cleared</span><span>+' + st.keys_goal + ' monthly goal</span>'
      + S.rules.map(function (r) { return '<span' + (r.keys < 0 ? ' class="neg"' : '') + '>' + MZ.signed(r.keys) + ' ' + esc(r.name) + '</span>'; }).join('') + '</div></section>';
  }
  function goalInfo(r, month) {
    var later = month >= MZ.thisMonth(), reached = later ? S.me.pages : (r && r.pages_end != null ? r.pages_end : null);
    var start = r ? MZ.startPageOf(r) : S.me.pages, goal = MZ.goalPageOf(r);
    var o = { start: start, goal: goal, reached: reached, done: !!(r && r.goal_awarded), pct: 0, toGo: null,
      goalN: goal && start != null ? goal - start : null, doneN: reached != null && start != null ? Math.max(0, reached - start) : null };
    if (goal && reached != null) { o.toGo = Math.max(0, goal - reached); if (!o.toGo) o.done = true; o.pct = goal > start ? Math.max(0, Math.min(100, Math.round((reached - start) / (goal - start) * 100))) : 100; }
    if (o.done) o.pct = 100;
    return o;
  }
  function goalCardHTML() {
    var r = thisProg(), m = MZ.thisMonth(), g = goalInfo(S.prog.find(function (x) { return x.month === m; }), m);
    if (!g.goal && !r.jadeed && !r.ikhtibar) return '';
    var h = '<section class="box"><div class="boxhead"><h3>' + esc(MZ.monthShort(m)) + ' goal</h3>' + (g.done ? '<span class="pill good"><i></i>Goal reached · +' + S.settings.keys_goal + '</span>' : '') + '</div>';
    if (g.goal) {
      var total = Math.max(0, g.goal - g.start), done = Math.max(0, Math.min(total, g.reached - g.start)), pr = S.prog.find(function (x) { return x.month === m; }) || {};
      var from = MZ.posLabel(pr.start_surah, pr.start_pos, true), to = MZ.posLabel(pr.goal_surah, pr.goal_pos, true), at = MZ.posLabel(S.me.cur_surah, S.me.cur_pos, true);
      if (from || to || at) h += '<div class="pgoal pos"><div><small>Started at</small><b>' + esc(from || '–') + '</b></div><span class="arrow" aria-hidden="true">→</span><div><small>Now at</small><b class="now">' + esc(at || '–') + '</b></div><span class="arrow" aria-hidden="true">→</span><div><small>Goal</small><b>' + esc(to || '–') + '</b></div></div>';
      h += '<div class="goalnum"><b class="num">' + done + '</b><span class="num">/ ' + total + ' pages this month</span></div>'
        + '<div class="gbar' + (g.done ? ' done' : '') + '" role="progressbar" aria-valuenow="' + done + '" aria-valuemin="0" aria-valuemax="' + total + '"><i style="width:' + g.pct + '%"></i></div>'
        + '<p class="muted" style="font-size:13.5px">' + (g.done ? 'Well done! You reached this month’s goal' + (to ? ' (' + esc(to) + ')' : '') + '.' : '<b>' + g.toGo + ' page' + (g.toGo === 1 ? '' : 's') + ' to go</b>' + (to ? ' to reach ' + esc(to) : '') + '. Reach your goal to earn +' + S.settings.keys_goal + ' keys.') + '</p>';
    } else h += '<p class="muted">' + r.jadeed + ' jadeed page' + (r.jadeed === 1 ? '' : 's') + ' this month.</p>';
    return h + (r.ikhtibar ? '<p class="muted" style="font-size:13px">Ikhtibar cleared this month: ' + r.ikhtibar + '</p>' : '') + '</section>';
  }
  /* The teacher's monthly report: this month, or the latest one. */
  function reportCardHTML() {
    var m = MZ.thisMonth(), list = S.prog.filter(MZ.hasReport), r = list.filter(function (x) { return x.month === m; })[0] || list[list.length - 1];
    if (!r) return '';
    var ajza = MZ.ajzaList(r.ajza_improve);
    return '<section class="box report"><div class="boxhead"><h3>Teacher’s report</h3><span class="pill">' + esc(MZ.monthLabel(r.month)) + '</span></div>'
      + '<div class="rstats"><div><b class="num">' + MZ.monthHifz(S.me, S.prog, r.month).year + '</b><span>Pages memorised in ' + r.month.slice(0, 4) + '</span></div><div><b class="num">' + (r.dawrat == null ? '–' : r.dawrat) + '</b><span>Dawrat completed</span></div></div>'
      + '<div class="ritem"><p class="eyebrow">Ajza to be improved</p>' + (ajza.length ? '<div class="jzs">' + ajza.map(function (j) { return '<span>Juz ' + j + '</span>'; }).join('') + '</div>' : '<p class="muted">None. Well done!</p>') + '</div>'
      + (r.ahkaam ? '<div class="ritem"><p class="eyebrow">Ahkaam / Makharij to be improved</p><p dir="auto"' + (MZ.hasArabic(r.ahkaam) ? ' lang="ar"' : '') + '>' + esc(r.ahkaam) + '</p></div>' : '')
      + (r.report_note ? '<div class="ritem"><p class="eyebrow">Note from your teacher</p><p dir="auto"' + (MZ.hasArabic(r.report_note) ? ' lang="ar"' : '') + '>' + esc(r.report_note) + '</p></div>' : '')
      + '<button class="btn block" data-act="myReport" data-m="' + r.month + '">' + I.doc + 'Report card for ' + esc(MZ.monthShort(r.month)) + ' (PDF)</button></section>';
  }
  function ikhDate(d) { var dt = new Date(d + 'T12:00:00'); return '<span class="ikdate"><b class="num">' + dt.getDate() + '</b><small>' + MZ.monthShort(d.slice(0, 7)).slice(0, 3) + '</small></span>'; }
  function ikhUpcomingHTML() {
    var t = MZ.today(), up = S.ikh.filter(function (x) { return x.status === 'scheduled' && x.exam_date >= t; });
    var cancelled = S.ikh.filter(function (x) { return x.status === 'cancelled' && x.exam_date >= t; });
    var recent = S.ikh.filter(function (x) { return (x.status === 'cleared' || x.status === 'not_cleared') && !x.quick; }).slice(-3).reverse();
    up = up.concat(cancelled).sort(function (a, b) { return a.exam_date < b.exam_date ? -1 : 1; });
    if (!up.length && !recent.length) return '';
    var h = '<section class="box ikh"><div class="boxhead"><h3>Ikhtibar</h3>' + (up.filter(function (x) { return x.status === 'scheduled'; }).length ? '<span class="pill">' + up.filter(function (x) { return x.status === 'scheduled'; }).length + ' coming</span>' : '') + '</div>';
    h += up.map(function (x, i) {
      var n = Math.round((new Date(x.exam_date + 'T12:00:00') - new Date(t + 'T12:00:00')) / 864e5);
      if (x.status === 'cancelled') return '<div class="ikrow done cancelled">' + ikhDate(x.exam_date) + '<span class="pname"><b>' + esc(x.title) + '</b><small>' + esc(MZ.dateLabel(x.exam_date)) + '</small></span><span class="pill plain">Cancelled</span></div>';
      return '<div class="ikrow' + (i === 0 ? ' next' : '') + '">' + ikhDate(x.exam_date) + '<span class="pname"><b>' + esc(x.title) + '</b><small>' + esc(MZ.dateLabel(x.exam_date)) + (x.note ? ' · ' + esc(x.note) : '') + '</small></span><span class="pill ' + (n <= 1 ? 'warn' : 'plain') + '">' + (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : 'In ' + n + ' days') + '</span></div>';
    }).join('');
    if (up.some(function (x) { return x.status === 'scheduled'; })) h += '<p class="muted" style="font-size:13px">Clear it for +' + S.settings.keys_ikhtibar + ' keys. Revise well.</p>';
    h += recent.map(function (x) {
      return '<div class="ikrow done">' + ikhDate(x.exam_date) + '<span class="pname"><b>' + esc(x.title) + '</b><small>' + esc(MZ.dateLabel(x.exam_date)) + (x.note ? ' · ' + esc(x.note) : '') + '</small></span>'
        + (x.status === 'cleared' ? '<span class="pill good"><i></i>Cleared +' + S.settings.keys_ikhtibar + '</span>' : '<span class="pill bad"><i></i>Not cleared</span>') + '</div>';
    }).join('');
    return h + '</section>';
  }
  /* Month by month: start page, goal page, page reached, murajaat, dawrat. */
  function monthsHTML() {
    var allRows = S.prog.filter(function (r) { return MZ.goalPageOf(r) || MZ.hasReport(r) || r.jadeed || r.start_pos; }).slice().reverse(), rows = allRows.slice(0, 12);
    if (!rows.length) return '';
    // totals across all months shown
    var T = { months: allRows.length, pages: 0, goal: 0, reached: 0, withGoal: 0, mur: 0, daw: 0 };
    allRows.forEach(function (r) { var g = goalInfo(r, r.month); if (g.doneN != null) T.pages += g.doneN; if (g.goalN) { T.goal += g.goalN; T.withGoal++; if (g.done) T.reached++; } T.daw += r.dawrat || 0; });
    var tot = '<div class="mtotals"><div><b class="num">' + T.months + '</b><span>month' + (T.months === 1 ? '' : 's') + '</span></div>'
      + '<div><b class="num">' + T.pages + '</b><span>pages memorised' + (T.goal ? ' of ' + T.goal + ' goal' : '') + '</span></div>'
      + '<div><b class="num">' + T.reached + (T.withGoal ? '<small>/' + T.withGoal + '</small>' : '') + '</b><span>goals reached</span></div>'
      + '<div><b class="num">' + MZ.monthHifz(S.me, S.prog, MZ.thisMonth()).year + '</b><span>pages in ' + MZ.thisMonth().slice(0, 4) + '</span></div><div><b class="num">' + T.daw + '</b><span>dawrat</span></div></div>';
    return '<section class="box"><div class="boxhead"><h3>My months</h3><span class="pill">Total</span></div>' + tot + '<div class="mlist">' + rows.map(function (r) {
      var g = goalInfo(r, r.month), ajza = MZ.ajzaList(r.ajza_improve), mh = MZ.monthHifz(S.me, S.prog, r.month), at = function (p) { return p ? MZ.posLabel(MZ.pageSurah(p, mh.dir), p) : ''; };
      return '<details class="mrow"><summary><span class="mname">' + esc(MZ.monthLabel(r.month)) + '</span><span class="mpages num">' + (g.goal ? (g.doneN == null ? '–' : g.doneN) + ' / ' + g.goalN + ' pages' : '') + '</span>'
        + (g.done ? '<span class="pill good"><i></i>Reached</span>' : g.goal && r.month < MZ.thisMonth() ? '<span class="pill plain">Not reached</span>' : g.goal ? '<span class="pill">' + g.toGo + ' to go</span>' : '<span></span>') + '</summary>'
        + '<dl class="info">' + [['Total memorised before this month', mh.startCount], ['Started at', at(mh.startPos)], ['Goal', mh.goalPos ? at(mh.goalPos) + ' (' + mh.goalN + ' pages)' : ''], ['Reached', at(mh.reachedPos)], ['Pages memorised this month', mh.done != null ? mh.done + (mh.goalN ? ' of ' + mh.goalN : '') : ''], ['Total memorised until now', mh.reachedCount], ['Dawrat completed', r.dawrat], ['Ajza to be improved', ajza.join(', ')], ['Ahkaam / Makharij', r.ahkaam], ['Teacher’s note', r.report_note]]
          .filter(function (x) { return x[1] != null && x[1] !== ''; }).map(function (x) { return '<div><dt>' + esc(x[0]) + '</dt><dd dir="auto">' + esc(x[1]) + '</dd></div>'; }).join('') + '</dl><button class="btn sm" data-act="myReport" data-m="' + r.month + '" style="margin-bottom:10px">' + I.doc + 'Report card (PDF)</button></details>';
    }).join('') + '</div></section>';
  }
  function quranCardHTML() {
    var s = S.me, pages = s.pages, pct = pages / 604 * 100;
    var hist = S.prog.filter(function (r) { return r.pages_end != null; }).slice(-12);
    var cur = MZ.thisMonth();
    if (!hist.length || hist[hist.length - 1].month !== cur) hist = hist.concat([{ month: cur, pages_end: pages }]).slice(-12);
    else hist[hist.length - 1] = Object.assign({}, hist[hist.length - 1], { pages_end: pages });
    var chart = '';
    if (hist.length > 1) {
      var W = 320, H = 132, padB = 22, padT = 18, max = Math.max(20, hist.reduce(function (m, r) { return Math.max(m, r.pages_end); }, 0)), bw = W / hist.length;
      chart = '<svg class="hchart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Pages memorised at the end of each month">'
        + '<line x1="0" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) + '" class="axis"/>'
        + hist.map(function (r, i) {
          var hgt = Math.max(2, (H - padB - padT) * r.pages_end / max), x = i * bw + bw * 0.2, w = bw * 0.6, y = H - padB - hgt, last = i === hist.length - 1;
          return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hgt.toFixed(1) + '" rx="3" class="' + (last ? 'b now' : 'b') + '"/>'
            + '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" class="v">' + r.pages_end + '</text>'
            + '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 6) + '" class="m">' + MZ.monthShort(r.month).slice(0, 3) + '</text>';
        }).join('') + '</svg>';
    }
    return '<section class="box quran"><div class="boxhead"><h3>Qur’an progress</h3><span class="pill">' + MZ.juzDone(pages) + ' ' + (MZ.juzDone(pages) === 1 ? 'juz' : 'ajza') + '</span></div>'
      + (s.cur_surah || s.cur_pos ? '<p class="nowat">Now at <b>' + esc(MZ.posLabel(s.cur_surah, s.cur_pos)) + '</b>'  + '</p>' : '')
      + '<div class="goalnum"><b class="num">' + pages + '</b><span class="num">/ 604 pages memorised</span><span class="pct num">' + pct.toFixed(pct < 10 ? 1 : 0) + '%</span></div>'
      + '<div class="qbar"><i style="width:' + pct.toFixed(2) + '%"></i>' + [5, 10, 15, 20, 25].map(function (j) { return '<s style="left:' + (j / 30 * 100).toFixed(2) + '%"></s>'; }).join('') + '</div>'
      + '<div class="qticks"><span>0</span><span>10 ajza</span><span>20 ajza</span><span>30</span></div>'
      + (chart ? '<p class="eyebrow" style="margin-top:6px">Pages memorised, month by month</p>' + chart : '')
      + '<p class="muted" style="font-size:13px">' + (pages >= 604 ? 'Hafiz of the whole Qur’an. Well done!' : pages ? (604 - pages) + ' pages left. Keep going.' : 'Your journey starts with the first page.') + '</p></section>';
  }
  function recentKeysHTML() {
    if (!S.events.length) return '';
    return '<section class="box"><h3>Recent keys</h3><div class="kevs">' + S.events.slice(0, 8).map(function (e) {
      return '<div class="kev"><span class="plus num' + (e.keys < 0 ? ' minus' : '') + '">' + MZ.signed(e.keys) + '</span><span>' + esc(e.note || e.kind) + '<small>' + esc(MZ.dateLabel((e.created_at || '').slice(0, 10))) + '</small></span>' + I.key.replace('width="20" height="20"', 'width="18" height="18"') + '</div>';
    }).join('') + '</div></section>';
  }
  /* Keys count up with a gold shimmer when new keys have arrived since they were last shown. */
  function animateKeys() {
    var el = document.querySelector('.keys .kcount'); if (!el || !S.me) return;
    var k = 'qt_keys_shown_' + S.me.id, from = null, to = S.me.keys;
    try { from = localStorage.getItem(k); } catch (e) {}
    try { localStorage.setItem(k, String(to)); } catch (e) {}
    if (from == null || +from >= to || S.animKeys) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    from = +from; S.animKeys = true;
    var card = el.closest('.keys'), t0 = null, dur = Math.min(2200, 900 + (to - from) * 25);
    card.classList.add('shimmer');
    var gain = document.createElement('span'); gain.className = 'kgain'; gain.textContent = '+' + (to - from); el.parentNode.appendChild(gain);
    (function step(t) {
      if (!t0) t0 = t; var q = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - q, 3);
      var live = document.querySelector('.keys .kcount'); if (live) live.textContent = Math.round(from + (to - from) * e);
      if (q < 1) requestAnimationFrame(step); else { S.animKeys = false; setTimeout(function () { var c = document.querySelector('.keys.shimmer'); if (c) c.classList.remove('shimmer'); }, 900); }
    })(performance.now());
  }
  function keysToast() {
    if (!S.me) return;
    var k = 'qt_keys_seen_' + S.me.id, prev = null;
    try { prev = localStorage.getItem(k); } catch (e) {}
    if (prev != null && S.me.keys > +prev) MZ.toast('+' + (S.me.keys - +prev) + ' keys since your last visit. Well done!');
    try { localStorage.setItem(k, String(S.me.keys)); } catch (e) {}
  }
  function showReward() {
    var lvl = MZ.rewardLevel(S.me.keys, S.settings), at = lvl * S.settings.reward_every;
    S.showing = { reward: lvl };
    $('#overlay').innerHTML = '<div class="scrim gold reward-scrim" data-act="closeReward"></div><div class="modal"><div class="modal-in reward" role="dialog" aria-modal="true" aria-label="Reward unlocked">'
      + '<div class="rays" aria-hidden="true"></div>'
      + '<div class="rbadge giftbox"><svg viewBox="0 0 100 100" width="84" height="84" aria-hidden="true"><defs><linearGradient id="gbx" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E8BF7E"/><stop offset="1" stop-color="#A9732F"/></linearGradient></defs>'
      + '<g class="gb-light"><path d="M50 40L30 4M50 40L50 0M50 40L70 4M50 40L14 18M50 40L86 18" stroke="#FFE9B8" stroke-width="3" stroke-linecap="round"/></g>'
      + '<rect x="20" y="48" width="60" height="42" rx="4" fill="url(#gbx)"/><rect x="45" y="48" width="10" height="42" fill="#FFF3DC" opacity=".85"/>'
      + '<g class="gb-lid"><rect x="15" y="36" width="70" height="14" rx="3" fill="url(#gbx)" stroke="#FFF3DC" stroke-width="1"/><rect x="45" y="36" width="10" height="14" fill="#FFF3DC" opacity=".9"/>'
      + '<path d="M50 36C40 22 26 26 34 34C38 38 46 37 50 36ZM50 36C60 22 74 26 66 34C62 38 54 37 50 36Z" fill="#FFF3DC" stroke="#C98F45" stroke-width="1.5"/></g></svg></div>'
      + '<p class="rk">Reward ' + lvl + ' unlocked</p><h2>Well done, ' + esc(MZ.firstName(S.me.full_name)) + '!</h2>'
      + '<p class="rtext">You collected <b>' + at + ' keys</b>. Go to the institute to collect your reward.</p>'
      + '<div class="rkeys num">' + I.key.replace('width="20" height="20"', 'width="26" height="26"') + S.me.keys + ' keys</div>'
      + '<button class="btn block rbtn" data-act="closeReward">Continue</button></div></div>';
    sparkle(true);
  }
  function closeReward() {
    var lvl = S.showing && S.showing.reward; $('#overlay').innerHTML = ''; S.showing = null;
    if (lvl) { S.me.rewards_seen = lvl; api.markRewardSeen(lvl).catch(function () {}); }
    render(); setTimeout(nextInQueue, 250);
  }

  /* ---------------------------------------------------------- leaderboard */
  function leaderboardHTML() {
    var lb = S.lb || []; if (!lb.length) return '';
    var top = lb.filter(function (x) { return x.rank <= 10; }), me = lb.filter(function (x) { return x.is_me; })[0];
    return '<section class="box lboard"><div class="boxhead"><h3>Top 10 this month</h3><span class="pill">' + esc(MZ.monthShort(MZ.thisMonth())) + ' keys</span></div><ol class="lb">'
      + top.map(function (x) {
        return '<li class="' + (x.is_me ? 'me ' : '') + (x.rank <= 3 ? 'm' + x.rank : '') + '"><span class="lbr">' + (x.rank <= 3 ? ['', '🥇', '🥈', '🥉'][x.rank] : x.rank) + '</span><span class="lbn">' + esc(x.first_name) + (x.is_me ? ' <small>(you)</small>' : '') + '</span><span class="lbk num">' + I.key.replace('width="20" height="20"', 'width="15" height="15"') + x.keys + '</span></li>';
      }).join('') + '</ol>'
      + (me && me.rank > 10 ? '<p class="lbme">You are <b>#' + me.rank + '</b> with ' + me.keys + ' keys this month. ' + (top.length ? (top[top.length - 1].keys - me.keys + 1) + ' more to reach the top 10!' : '') + '</p>'
        : !me ? '<p class="lbme">Earn keys this month to join the board.</p>' : '')
      + '</section>';
  }
  /* ---------------------------------------------------------- report card & certificates */
  function printMyReport(month) {
    var me = (S.lb || []).filter(function (x) { return x.is_me; })[0];
    MZ.printHTML(MZ.reportCardHTML({ settings: S.settings, s: S.me, month: month, prog: S.prog, events: S.events, pays: S.pays, ikh: S.ikh, rank: month === MZ.thisMonth() && me ? me.rank : null }), S.me.full_name + ' ' + MZ.monthLabel(month));
  }
  function printMyCert(j) {
    MZ.printHTML(MZ.certificateHTML({ settings: S.settings, s: S.me, juz: j, all: j === 30 && S.me.pages >= 604, month: MZ.juzMonth(S.prog, j) }), S.me.full_name + (j === 30 ? ' Hifz al-Quran' : ' ' + j + ' ajza'));
  }
  function certsHTML() {
    var n = MZ.juzDone(S.me.pages);
    if (!n) return '<section class="box certs"><div class="boxhead"><h3>My certificates</h3></div><p class="muted" style="font-size:13.5px">Your first certificate comes when you have memorised ' + MZ.juzEnd(1) + ' pages (one juz). ' + (MZ.juzEnd(1) - S.me.pages) + ' pages to go!</p></section>';
    var chips = ''; for (var j = n; j >= 1; j--) chips += '<button class="certchip' + (j === 30 ? ' all' : '') + '" type="button" data-act="myCert" data-j="' + j + '">' + (j === 30 && S.me.pages >= 604 ? '★ Whole Qur’an' : j + (j === 1 ? ' juz' : ' ajza')) + '</button>';
    return '<section class="box certs"><div class="boxhead"><h3>My certificates</h3><span class="pill">' + n + ' of 30</span></div>'
      + '<p class="muted" style="font-size:13.5px">' + (n < 30 ? 'Next: ' + (n + 1) + ' ajza at ' + MZ.juzEnd(n + 1) + ' pages (' + (MZ.juzEnd(n + 1) - S.me.pages) + ' pages to go).' : 'Hafiz of the whole Qur’an. Well done!') + ' Tap one to print or save it as PDF.</p>'
      + '<div class="certchips">' + chips + '</div></section>';
  }
  function juzSeenKey() { return 'qt_juz_seen_' + S.me.id; }
  function newJuz() { var n = MZ.juzDone(S.me.pages), seen = null; try { seen = localStorage.getItem(juzSeenKey()); } catch (e) {} if (seen == null) { try { localStorage.setItem(juzSeenKey(), String(n)); } catch (e) {} return 0; } return n > +seen ? n : 0; }
  function showJuz(n) {
    S.showing = { juz: n };
    $('#overlay').innerHTML = '<div class="scrim gold reward-scrim" data-act="closeJuz"></div><div class="modal"><div class="modal-in reward" role="dialog" aria-modal="true" aria-label="Juz completed">'
      + '<div class="rays" aria-hidden="true"></div><div class="rbadge juzbadge"><b>' + (n === 30 ? '★' : n) + '</b></div>'
      + '<p class="rk">' + (n === 30 ? 'The whole Qur’an' : (n === 1 ? 'One juz' : n + ' ajza') + ' memorised') + '</p><h2>Well done, ' + esc(MZ.firstName(S.me.full_name)) + '!</h2>'
      + '<p class="rtext">' + (n === 30 ? 'You have completed the hifz of the entire Qur’an al-Kareem.' : 'You have now memorised ' + (n === 1 ? 'one juz' : n + ' ajza') + '. Your certificate is ready.') + '</p>'
      + '<button class="btn block rbtn" data-act="juzCert" data-j="' + n + '">View my certificate</button><button class="btn ghost block" data-act="closeJuz" style="color:#fff;margin-top:6px">Close</button></div></div>';
    sparkle(true);
  }
  function closeJuz() { var n = S.showing && S.showing.juz; $('#overlay').innerHTML = ''; S.showing = null; try { localStorage.setItem(juzSeenKey(), String(n)); } catch (e) {} render(); setTimeout(nextInQueue, 250); }
  /* ---------------------------------------------------------- details */
  function missingDetails() {
    var s = S.me, m = [];
    if (!s.guardian_name) m.push('father/husband name'); if (!s.phone) m.push('mobile number'); if (!s.email) m.push('email');
    return m;
  }
  function listWords(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function openDetails() {
    var s = S.me;
    var info = [['Name', s.full_name], ['Admission no', s.admission_no], ['ITS no', s.its_no], ['Program', s.program], ['Gender', s.gender], ['Date of birth', s.dob ? MZ.dateLabel(s.dob) : ''], ['Username', s.username]]
      .filter(function (r) { return r[1]; });
    S.showing = { details: true };
    $('#overlay').innerHTML = '<div class="scrim" data-act="closeDetails"></div><aside class="sheet" role="dialog" aria-modal="true" aria-label="My details">'
      + '<div class="sheet-head"><div><p class="eyebrow">My details</p><h2>' + esc(s.full_name) + '</h2></div><button class="iconbtn" data-act="closeDetails" aria-label="Close">' + I.x + '</button></div>'
      + '<section><h3>From the institute</h3><dl class="info">' + info.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl>'
      + '<p class="muted" style="font-size:13px">If something here is wrong, tell the institute.</p></section>'
      + '<section><h3>Your details</h3><form class="form panel" id="detailsForm" autocomplete="on">'
      + '<div class="field"><label for="dGuard">Father/Husband name</label><input id="dGuard" maxlength="100" autocomplete="off" value="' + esc(s.guardian_name) + '"></div>'
      + '<div class="field"><label for="dPhone">Mobile number</label><input id="dPhone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="e.g. 0712 345 678" value="' + esc(s.phone) + '"></div>'
      + '<div class="field"><label for="dEmail">Email</label><input id="dEmail" type="email" autocomplete="email" maxlength="120" placeholder="name@example.com" value="' + esc(s.email) + '"></div>'
      + '<div class="field"><label for="dItsPw">ITS password</label><div class="pw"><input id="dItsPw" type="password" maxlength="100" autocomplete="off" placeholder="Loading…" data-orig=""><button type="button" data-pw>Show</button></div><span class="hint">Only you and the admin can see it</span></div>'
      + '<p class="err" id="dErr" hidden></p><button class="btn gold block" type="submit" id="dBtn">Save my details</button></form></section></aside>';
    var f = missingDetails().length ? $('#dGuard') : null; if (f && !s.guardian_name) f.focus();
    if (api.myItsPassword) api.myItsPassword().then(function (v) { var i = $('#dItsPw'); if (i) { i.value = v || ''; i.dataset.orig = v || ''; i.placeholder = 'Not set'; } }).catch(function () { var i = $('#dItsPw'); if (i) i.placeholder = 'Not set'; });
  }
  function closeDetails() { $('#overlay').innerHTML = ''; S.showing = null; setTimeout(nextInQueue, 150); }

  /* ---------------------------------------------------------- teachers */
  function myRating(tid) { var m = MZ.thisMonth(); return S.myRatings.find(function (r) { return String(r.teacher_id) === String(tid) && r.month === m; }) || null; }
  function unrated() { return S.teachers.filter(function (t) { return !myRating(t.id); }); }
  function starRow(n) { n = Math.round(n || 0); var o = ''; for (var i = 1; i <= 5; i++) o += '<span class="' + (i <= n ? 'on' : '') + '">★</span>'; return '<span class="srow" aria-label="' + n + ' out of 5">' + o + '</span>'; }
  function teachersHTML() {
    var m = MZ.thisMonth();
    var h = '<header class="pagetitle goldfield">' + header() + '<div class="hello"><h1>Teachers</h1><p>Feedback for your teachers and Musaideen for ' + esc(MZ.monthLabel(m)) + ': appreciation, comments, ideas or a concern. Your name is not shown to the institute.</p></div><span class="fz-edge" aria-hidden="true"></span></header><div class="scontent">';
    if (!S.teachers.length) return h + '<div class="empty">Your teachers will appear here once the institute adds them.</div></div>';
    return h + S.teachers.map(function (t) {
      var r = myRating(t.id), a = r ? MZ.scoreAvg(r.scores) : 0;
      return '<button class="rcard tcard" data-act="rateT" data-id="' + t.id + '"><span class="ic tini">' + esc(MZ.initials(t.full_name)) + '</span>'
        + '<span><b>' + esc(t.full_name) + '</b><small>' + esc(t.role || 'Teacher') + '</small>' + (r ? '<small>' + starRow(a) + ' ' + a.toFixed(1) + ' · feedback given</small>' : '<small class="todo">No feedback yet this month</small>') + '</span>'
        + '<span class="btn sm ' + (r ? '' : 'gold') + '">' + (r ? 'Edit feedback' : (isMusaid(t) ? 'Feedback for Musaideen' : 'Feedback')) + '</span></button>';
    }).join('') + '</div>';
  }
  function isMusaid(t) { return /musa?id/i.test((t && t.role) || ''); }
  function openRate(tid) {
    var t = S.teachers.find(function (x) { return String(x.id) === String(tid); }); if (!t) return;
    var r = myRating(t.id), sc = r ? r.scores : {};
    S.showing = { rate: t.id };
    $('#overlay').innerHTML = '<div class="scrim" data-act="closeRate"></div><aside class="sheet" role="dialog" aria-modal="true" aria-label="Feedback for ' + esc(t.full_name) + '">'
      + '<div class="sheet-head"><div><p class="eyebrow">' + (isMusaid(t) ? 'Feedback for Musaideen' : 'Feedback for your teacher') + ' · ' + esc(MZ.monthLabel(MZ.thisMonth())) + '</p><h2>' + esc(t.full_name) + '</h2></div><button class="iconbtn" data-act="closeRate" aria-label="Close">' + I.x + '</button></div>'
      + '<form class="form" id="rateForm" autocomplete="off"><p class="muted">1 star = needs to improve, 5 stars = excellent. Your name is not shown to the institute.</p>'
      + MZ.TEACHER_CRITERIA.map(function (c) {
        var o = '<div class="qrow"><span class="ql">' + esc(c[1]) + (MZ.TEACHER_CRITERIA_DESC[c[0]] ? '<small class="qd">' + esc(MZ.TEACHER_CRITERIA_DESC[c[0]]) + '</small>' : '') + '</span><div class="rate" role="radiogroup" aria-label="' + esc(c[1]) + '">';
        for (var i = 5; i >= 1; i--) o += '<input type="radio" name="q_' + c[0] + '" id="q_' + c[0] + i + '" value="' + i + '"' + (+sc[c[0]] === i ? ' checked' : '') + '><label for="q_' + c[0] + i + '" title="' + i + ' out of 5">★</label>';
        return o + '</div></div>';
      }).join('')
      + '<div class="field"><label for="rComment">Your feedback (optional)</label><textarea id="rComment" class="input" rows="3" maxlength="500" placeholder="Appreciation, comments, ideas, or a concern you want to raise.">' + esc(r ? r.comment || '' : '') + '</textarea></div>'
      + '<p class="err" id="rErr" hidden></p><button class="btn gold block" type="submit" id="rBtn">' + (r ? 'Update my feedback' : 'Send my feedback') + '</button></form></aside>';
  }
  function closeRate() { $('#overlay').innerHTML = ''; S.showing = null; setTimeout(nextInQueue, 150); }
  function submitRate() {
    var tid = S.showing && S.showing.rate, scores = {}, missing = [];
    MZ.TEACHER_CRITERIA.forEach(function (c) { var x = document.querySelector('input[name="q_' + c[0] + '"]:checked'); if (x) scores[c[0]] = +x.value; else missing.push(c[1]); });
    var err = $('#rErr');
    if (missing.length) { err.textContent = 'Please choose the stars for: ' + missing.join(', ') + '.'; err.hidden = false; return; }
    $('#rBtn').disabled = true;
    api.rateTeacher(tid, MZ.thisMonth(), scores, $('#rComment').value.trim()).then(function () { return api.myTeacherRatings(); }).then(function (l) {
      S.myRatings = l; closeRate(); render(); var left = unrated().length;
      MZ.toast(left ? 'Thank you for your feedback! ' + left + ' more to go.' : 'Thank you! You have given feedback to all your teachers and Musaideen this month.');
    }).catch(function (e) { err.textContent = e.message; err.hidden = false; $('#rBtn').disabled = false; });
  }

  /* ---------------------------------------------------------- notices */
  function noticeSeen(n) { try { return !!localStorage.getItem('qt_notice_seen_' + n.id); } catch (e) { return true; } }
  function noticeAnnounced(n) { try { return !!localStorage.getItem('qt_notice_pop_' + n.id); } catch (e) { return true; } }
  function noticeBannerHTML() {
    var nw = S.notices.filter(function (n) { return !noticeSeen(n); }); if (!nw.length) return '';
    var n = nw[0];
    return '<section class="noticebar"><span class="nb-ico">' + I.doc + '</span><div><p class="eyebrow">' + (nw.length > 1 ? nw.length + ' new notices' : 'New notice') + ' · ' + esc(MZ.dateLabel(String(n.created_at || '').slice(0, 10))) + '</p><h3>' + esc(n.title) + '</h3></div>'
      + '<button class="btn gold" data-act="notice" data-id="' + n.id + '">Read</button>' + (nw.length > 1 ? '<button class="btn" data-go="notices">All</button>' : '') + '</section>';
  }
  function showNoticePop(list) {
    var n = list[0], more = list.length - 1;
    try { list.forEach(function (x) { localStorage.setItem('qt_notice_pop_' + x.id, '1'); }); } catch (e) {}
    S.showing = { noticePop: n.id };
    $('#overlay').innerHTML = '<div class="scrim" data-act="noticeLater"></div><div class="modal"><div class="modal-in npop" role="dialog" aria-modal="true" aria-label="New notice">'
      + '<span class="np-ico">' + I.doc.replace('width="22" height="22"', 'width="30" height="30"') + '</span><p class="eyebrow">New notice from the institute</p><h2>' + esc(n.title) + '</h2>'
      + '<p class="muted">' + esc(MZ.dateLabel(String(n.created_at || '').slice(0, 10))) + (more ? ' · and ' + more + ' more new notice' + (more === 1 ? '' : 's') : '') + '</p>'
      + '<div class="ractions"><button class="btn gold" data-act="noticePop" data-id="' + n.id + '">Read it now</button>' + (more ? '<button class="btn" data-act="noticeAll">See all</button>' : '') + '<button class="btn" data-act="noticeLater">Later</button></div></div></div>';
  }
  function osNotify(list) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    list.forEach(function (n) { try { var x = new Notification('New notice · Tahfeez Daressalaam', { body: n.title, icon: 'assets/app-192.png', tag: 'notice-' + n.id }); x.onclick = function () { window.focus(); openNotice(n.id); x.close(); }; } catch (e) {} });
  }
  /* ---- schedule: the teacher, day and time allocated to me */
  function sdName(d) { var t = MZ.today(), tm = new Date(t + 'T12:00:00'); tm.setDate(tm.getDate() + 1); return d === t ? 'Today' : d === tm.toISOString().slice(0, 10) ? 'Tomorrow' : new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' }); }
  function sdShort(d) { return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  function scheduleHTML() {
    var up = (S.sched || []).filter(function (x) { return x.slot_date >= MZ.today(); }).slice(0, 14);
    if (!up.length) return '';
    var days = {}; up.forEach(function (x) { (days[x.slot_date] = days[x.slot_date] || []).push(x); });
    return '<section class="box schedbox" id="schedBox"><div class="boxhead"><h3>My schedule</h3>' + (up.some(function (x) { return !x.student_seen_at; }) ? '<span class="pill warn">Updated</span>' : '') + '</div>'
      + Object.keys(days).sort().slice(0, 7).map(function (d) {
        return '<div class="sd-day' + (d === MZ.today() ? ' today' : '') + '"><div class="sd-date"><b>' + esc(sdName(d)) + '</b><small>' + esc(sdShort(d)) + '</small></div><div class="sd-slots">' + days[d].map(function (x) {
          var off = x.status === 'cancelled';
          return '<div class="sd-slot' + (off ? ' off' : '') + (x.student_seen_at ? '' : ' new') + '"><span class="sd-time num">' + esc(x.start_time) + ' – ' + esc(x.end_time) + '</span><span class="sd-t"><b>' + esc(x.teacher_name) + '</b>' + (x.handed_from && !off ? '<small class="sd-hand">Instead of ' + esc(x.handed_from) + '</small>' : '') + (x.note ? '<small>' + esc(x.note) + '</small>' : '') + '</span>'
            + (off ? '<span class="pill plain">Cancelled</span>' : x.student_seen_at ? '' : '<span class="pill warn">New</span>') + '</div>';
        }).join('') + '</div></div>';
      }).join('') + '<div class="btnrow sd-print"><button class="btn sm" data-act="printTT" data-w="0">Print this week’s timetable</button><button class="btn sm ghost" data-act="printTT" data-w="7">Next week</button></div></section>';
  }
  // the printable A4 timetable (Monday to Sunday); the print window can also save it as a PDF
  function printTT(add) {
    var t = new Date(MZ.today() + 'T12:00:00'); t.setDate(t.getDate() + (+add || 0));
    var w = MZ.weekOf(t.toISOString().slice(0, 10)), nm = (S.me && S.me.full_name) || '';
    MZ.ttPrint(Object.assign(MZ.ttFromLessons('student', nm, w.from, w.to, (S.sched || []).map(function (x) { return Object.assign({}, x, { student_name: nm }); })), { institute: S.settings.institute_name }));
  }
  function showSchedulePop(list) {
    S.showing = { sched: 1 };
    list = list.slice().sort(function (a, b) { return (a.slot_date + a.start_time) < (b.slot_date + b.start_time) ? -1 : 1; });
    $('#overlay').innerHTML = '<div class="scrim" data-act="closeSched"></div><div class="modal"><div class="modal-in spop" role="dialog" aria-modal="true" aria-label="Your schedule">'
      + '<span class="np-ico"><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M14 14h2M8 17.5h2"/></svg></span><p class="eyebrow">' + (list.length > 1 ? list.length + ' schedule updates' : 'Schedule update') + '</p><h2>Your class times</h2>'
      + '<div class="sp-list">' + list.slice(0, 6).map(function (x) { return '<div class="sp-row' + (x.status === 'cancelled' ? ' off' : '') + '"><b>' + esc(sdName(x.slot_date)) + '<small>' + esc(sdShort(x.slot_date)) + '</small></b><span class="num">' + esc(x.start_time) + ' – ' + esc(x.end_time) + '</span><span>' + esc(x.teacher_name) + (x.handed_from && x.status !== 'cancelled' ? ' <small>(instead of ' + esc(x.handed_from) + ')</small>' : '') + (x.note ? ' · ' + esc(x.note) : '') + (x.status === 'cancelled' ? ' · <b>Cancelled</b>' : '') + '</span></div>'; }).join('') + '</div>'
      + (list.length > 6 ? '<p class="muted">and ' + (list.length - 6) + ' more on your Home page</p>' : '')
      + '<div class="ractions"><button class="btn gold" data-act="closeSched">Got it</button></div></div></div>';
  }
  function closeSched() {
    $('#overlay').innerHTML = ''; S.showing = null;
    S.sched.forEach(function (x) { if (!x.student_seen_at) x.student_seen_at = new Date().toISOString(); });
    if (api.markScheduleSeen) api.markScheduleSeen().catch(function () {});
    render(); setTimeout(nextInQueue, 200);
  }
  function schedNotify(list) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var x = list[0];
    try { var n = new Notification('Schedule · Tahfeez Daressalaam', { body: (list.length > 1 ? list.length + ' updates. ' : '') + sdName(x.slot_date) + ' ' + x.start_time + ' with ' + x.teacher_name + (x.handed_from ? ' (instead of ' + x.handed_from + ')' : '') + (x.status === 'cancelled' ? ' (cancelled)' : ''), icon: 'assets/app-192.png', tag: 'sched-' + x.id }); n.onclick = function () { window.focus(); n.close(); }; } catch (e) {}
  }
  /* ---- badges: Mastership (every 100 keys, automatic) and praise badges from teachers */
  function badgesHTML() {
    var n = MZ.mastery(S.me.keys), left = MZ.MASTER_EVERY - (S.me.keys % MZ.MASTER_EVERY), b = S.badges || [];
    if (!n && !b.length) return '<section class="box badges-s"><div class="boxhead"><h3>My badges</h3></div><div class="bshelf"><div class="bitem dim">' + MZ.masteryMedal(58) + '<b>Mastership</b><small>' + left + ' keys to go</small></div></div><p class="muted" style="font-size:13px;margin-top:8px">Earn a Mastership badge for every ' + MZ.MASTER_EVERY + ' keys. Your teachers can also give you praise badges.</p></section>';
    return '<section class="box badges-s"><div class="boxhead"><h3>My badges</h3><span class="pill">' + (n + b.length) + '</span></div><div class="bshelf">'
      + (n ? '<div class="bitem master">' + MZ.masteryMedal(62) + (n > 1 ? '<i class="bx num">×' + n + '</i>' : '') + '<b>Mastership</b><small>' + n * MZ.MASTER_EVERY + ' keys · next in ' + left + '</small></div>' : '<div class="bitem dim">' + MZ.masteryMedal(58) + '<b>Mastership</b><small>' + left + ' keys to go</small></div>')
      + b.map(function (x) { return '<div class="bitem' + (x.seen_at ? '' : ' fresh') + '" title="' + esc(x.note || MZ.badgeTitle(x)) + '">' + MZ.badgeMedal(x.badge, 58) + '<b>' + esc(MZ.badgeTitle(x)) + '</b><small>' + esc(MZ.dateShort(String(x.created_at).slice(0, 10))) + ' · ' + esc(x.awarded_by_name || 'Institute') + '</small>' + (x.note ? '<em>“' + esc(x.note) + '”</em>' : '') + '</div>'; }).join('')
      + '</div></section>';
  }
  function showBadges(list) {
    S.showing = { badges: 1 };
    var b = list[0];
    $('#overlay').innerHTML = '<div class="scrim gold" data-act="closeBadges"></div><div class="modal"><div class="modal-in bpop" role="dialog" aria-modal="true" aria-label="New badge">'
      + '<p class="eyebrow">' + (list.length > 1 ? list.length + ' new badges' : 'A new badge for you') + '</p>' + MZ.badgeMedal(b.badge, 110) + '<h2>' + esc(MZ.badgeTitle(b)) + '</h2>'
      + (b.note ? '<p class="bnote">“' + esc(b.note) + '”</p>' : '') + '<p class="muted">From ' + esc(b.awarded_by_name || 'the institute') + '</p>'
      + (list.length > 1 ? '<div class="bmore">' + list.slice(1).map(function (x) { return '<span>' + MZ.badgeMedal(x.badge, 40) + '<small>' + esc(MZ.badgeTitle(x)) + '</small></span>'; }).join('') + '</div>' : '')
      + '<div class="ractions"><button class="btn gold" data-act="closeBadges">Alhamdulillah!</button></div></div></div>';
    sparkle(true);
  }
  function closeBadges() {
    $('#overlay').innerHTML = ''; S.showing = null;
    S.badges.forEach(function (x) { if (!x.seen_at) x.seen_at = new Date().toISOString(); });
    if (api.markBadgesSeen) api.markBadgesSeen().catch(function () {});
    render(); setTimeout(nextInQueue, 200);
  }
  function noticesHTML() {
    var h = '<header class="pagetitle goldfield">' + header() + '<div class="hello"><h1>Student Hub</h1><p>Notices from the institute</p></div><span class="fz-edge" aria-hidden="true"></span></header><div class="scontent">';
    if ('Notification' in window && Notification.permission === 'default') h += '<section class="alertson"><div><b>Get an alert for new notices</b><small class="muted">Your phone or computer shows a notification when the institute posts a notice.</small></div><button class="btn gold" data-act="alertsOn">Turn on alerts</button></section>';
    if (!S.notices.length) return h + '<div class="empty">No notices yet. Messages and files from the institute appear here.</div></div>';
    return h + S.notices.map(function (n) {
      var k = n.file_name ? MZ.fileKind(n.file_name, n.mime) : null, snip = String(n.body || '').replace(/\s+/g, ' ').slice(0, 90);
      return '<button class="rcard" data-act="notice" data-id="' + n.id + '"><span class="ic' + (k ? ' fbadge k-' + k : '') + '">' + (k ? esc(MZ.fileExt(n.file_name)) : I.doc) + (noticeSeen(n) ? '' : '<span class="dot" aria-label="New"></span>') + '</span>'
        + '<span><b>' + esc(n.title) + '</b>' + (snip ? '<small class="snip" dir="auto">' + esc(snip) + (n.body.length > 90 ? '…' : '') + '</small>' : '') + '<small>' + esc(MZ.dateLabel((n.created_at || '').slice(0, 10))) + (k ? ' · ' + MZ.FILE_LABEL[k] : '') + '</small></span><span class="amt" style="color:var(--gold-deep)">' + I.right + '</span></button>';
    }).join('') + '</div>';
  }
  function openNotice(id) {
    var n = S.notices.find(function (x) { return String(x.id) === String(id); }); if (!n) return;
    try { localStorage.setItem('qt_notice_seen_' + n.id, '1'); } catch (e) {}
    S.showing = { notice: n.id };
    $('#overlay').innerHTML = '<div class="scrim" data-act="closeNotice"></div><aside class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(n.title) + '">'
      + '<div class="sheet-head"><div><p class="eyebrow">Notice · ' + esc(MZ.dateLabel((n.created_at || '').slice(0, 10))) + '</p><h2>' + esc(n.title) + '</h2></div><button class="iconbtn" data-act="closeNotice" aria-label="Close">' + I.x + '</button></div>'
      + MZ.noticeHTML(n)
      + '</aside>';
    render();
    MZ.hydrateNotice(api, n, $('#overlay'));
  }

  /* --------------------------------------------------------- receipts */
  function queueUnseen() {
    S.pays.filter(function (p) { return !p.seen_at; }).sort(function (a, b) { return a.month < b.month ? -1 : 1; }).forEach(function (p) {
      if (S.queue.indexOf(p.id) < 0 && (!S.showing || S.showing.id !== p.id)) S.queue.push(p.id);
    });
    if (!S.showing) nextInQueue();
  }
  function nextInQueue() {
    var id = S.queue.shift();
    if (id == null) {
      var ns = S.sched.filter(function (x) { return !x.student_seen_at && x.slot_date >= MZ.today(); });
      if (ns.length) { showSchedulePop(ns); return; }
      var nb = S.badges.filter(function (b) { return !b.seen_at; });
      if (nb.length) { showBadges(nb); return; }
      if (S.me && MZ.rewardLevel(S.me.keys, S.settings) > (S.me.rewards_seen || 0)) { showReward(); return; }
      var nj = S.me ? newJuz() : 0; if (nj) { showJuz(nj); return; }
      if (S.askPw) { S.askPw = false; openAccount(true); return; }
      var nl = S.notices.filter(function (n) { return !noticeSeen(n) && !noticeAnnounced(n); });
      if (nl.length) showNoticePop(nl);
      return;
    }
    var p = payById(id); if (!p || p.seen_at) return nextInQueue();
    showReceipt(p, true);
  }
  function sparkle(big) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var colors = ['#FFFFFF', '#F7ECDD', '#D19B5B', '#9A6A30', '#FFE7B0'];
    for (var i = 0; i < (big ? 110 : 36); i++) {
      var d = document.createElement('i'); d.className = 'spark';
      d.style.left = Math.random() * 100 + 'vw'; d.style.background = colors[i % colors.length];
      d.style.animationDuration = (1.6 + Math.random() * (big ? 2.6 : 1.6)) + 's'; d.style.animationDelay = (Math.random() * (big ? 1.2 : 0.5)) + 's';
      document.body.appendChild(d); setTimeout(function (el) { el.remove(); }.bind(null, d), big ? 5600 : 3800);
    }
  }
  function showReceipt(p, isNew) {
    S.showing = { id: p.id, isNew: !!isNew };
    $('#overlay').innerHTML = '<div class="scrim' + (isNew ? ' gold' : '') + '" data-act="closeReceipt"></div><div class="modal"><div class="modal-in" role="dialog" aria-modal="true" aria-label="Receipt ' + esc(p.receipt_no) + '">'
      + (isNew ? '<div class="celebrate"><span class="ring">' + I.check + '</span><b>Payment received</b><span>' + esc(MZ.monthLabel(p.month)) + ' fees are paid. Thank you.</span></div>' : '')
      + MZ.receiptHTML(p, S.me, S.settings)
      + (p.proof_path ? '<div class="proofbox"><span class="pf-ico">' + I.doc + '</span><span class="pf-t"><small>Your payment slip</small><b>' + esc(p.proof_name || 'Slip') + '</b></span><button class="btn sm" data-act="myProof" data-id="' + p.id + '">Open</button></div>' : '')
      + '<div class="ractions"><button class="btn gold" data-act="saveImg" data-id="' + p.id + '">Save image</button>'
      + '<button class="btn" data-act="closeReceipt">' + (isNew ? 'Close' : 'Close') + '</button></div></div></div>';
    if (isNew) sparkle();
  }
  function closeReceipt() {
    var sh = S.showing; $('#overlay').innerHTML = ''; S.showing = null;
    if (sh && sh.isNew) {
      var p = payById(sh.id); if (p) p.seen_at = new Date().toISOString();
      render();
      api.markSeen(sh.id).catch(function () {});
    }
    setTimeout(nextInQueue, 250);
  }

  /* ---------------------------------------------------------- account */
  function openAccount(firstTime) {
    S.showing = { id: null, account: true };
    var s = S.me;
    $('#overlay').innerHTML = '<div class="scrim" data-act="closeAccount"></div><aside class="sheet" role="dialog" aria-modal="true" aria-label="My account">'
      + '<div class="sheet-head"><div><p class="eyebrow mono">' + esc(s.username) + '</p><h2>' + esc(s.full_name) + '</h2></div><button class="iconbtn" data-act="closeAccount" aria-label="Close">' + I.x + '</button></div>'
      + '<section><h3>' + (firstTime ? 'Choose your own password' : 'Change password') + '</h3>'
      + (firstTime ? '<p class="muted">You signed in with the default password. Choose a password only you know.</p>' : '')
      + '<form class="form panel" id="pwForm" autocomplete="off">'
      + '<div class="field"><label for="pw1">New password</label><div class="pw"><input id="pw1" type="password" minlength="6" required autocomplete="new-password"><button type="button" data-pw>Show</button></div><span class="hint">At least 6 characters</span></div>'
      + '<div class="field"><label for="pw2">Type it again</label><input id="pw2" type="password" minlength="6" required autocomplete="new-password"></div>'
      + '<p class="err" id="pwErr" hidden></p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn gold" type="submit">Save password</button>' + (firstTime ? '<button class="btn ghost" type="button" data-act="closeAccount">Later</button>' : '') + '</div></form></section>'
      + (firstTime ? '' : '<section><h3>Appearance</h3><div class="panel" style="display:grid;gap:8px"><p class="muted" style="font-size:13.5px">Night is deep indigo and gold. Automatic follows your phone.</p>' + MZ.themeChipsHTML() + '</div></section>')
      + (!firstTime && MZ.installHTML() ? '<section><h3>App</h3><div data-install>' + MZ.installHTML() + '</div></section>' : '')
      + (firstTime ? '' : '<section><h3>My details</h3><div><button class="btn" type="button" data-act="details">View and edit my details</button></div></section>')
      + (firstTime ? '' : '<section><h3>Sign out</h3><div><button class="btn danger" data-act="signOut">Sign out</button></div></section>')
      + '</aside>';
    setTimeout(function () { var i = $('#pw1'); if (i) i.focus(); }, 80);
  }
  function closeAccount() { $('#overlay').innerHTML = ''; S.showing = null; setTimeout(nextInQueue, 150); }

  /* ----------------------------------------------------------- events */
  document.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]');
    if (g) { S.view = g.dataset.go; try { history.replaceState(null, '', S.view === 'home' ? location.pathname + location.search : '#' + S.view); } catch (er) {} render(); window.scrollTo(0, 0); return; }
    var t = e.target.closest('[data-act]'); if (!t) return;
    var a = t.dataset.act;
    if (a === 'receipt') { var p = payById(t.dataset.id); if (p) showReceipt(p, !p.seen_at); }
    else if (a === 'closeReceipt') closeReceipt();
    else if (a === 'saveImg') { var p2 = payById(t.dataset.id); if (p2) MZ.saveReceipt(p2, S.me, S.settings); }
    else if (a === 'year') { S.year += +t.dataset.d; render(); }
    else if (a === 'account') openAccount(false);
    else if (a === 'closeReward') closeReward();
    else if (a === 'closeJuz') closeJuz();
    else if (a === 'juzCert') { var jj = +t.dataset.j; closeJuz(); printMyCert(jj); }
    else if (a === 'myCert') printMyCert(+t.dataset.j);
    else if (a === 'myReport') printMyReport(t.dataset.m);
    else if (a === 'details') openDetails();
    else if (a === 'myYear') printMyYear();
    else if (a === 'rateT') openRate(t.dataset.id);
    else if (a === 'closeRate') closeRate();
    else if (a === 'remSeen') { var rid = +t.dataset.id || t.dataset.id; S.reminders.forEach(function (x) { if (x.id === rid) x.seen_at = new Date().toISOString(); }); render(); api.markReminderSeen(rid).catch(function () {}); }
    else if (a === 'closeDetails') closeDetails();
    else if (a === 'notice') openNotice(t.dataset.id);
    else if (a === 'closeNotice') { $('#overlay').innerHTML = ''; S.showing = null; setTimeout(nextInQueue, 150); }
    else if (a === 'downloadNotice') { var n = S.notices.find(function (x) { return String(x.id) === String(t.dataset.id); }); if (n) MZ.downloadNotice(api, n); }
    else if (a === 'closeAccount') closeAccount();
    else if (a === 'closeBadges') closeBadges();
    else if (a === 'closeSched') closeSched();
    else if (a === 'noticePop') { var nid = t.dataset.id; $('#overlay').innerHTML = ''; S.showing = null; openNotice(nid); }
    else if (a === 'printTT') printTT(t.dataset.w);
    else if (a === 'noticeAll') { $('#overlay').innerHTML = ''; S.showing = null; S.view = 'notices'; render(); window.scrollTo(0, 0); }
    else if (a === 'noticeLater') { $('#overlay').innerHTML = ''; S.showing = null; setTimeout(nextInQueue, 150); }
    else if (a === 'alertsOn') { if ('Notification' in window) Notification.requestPermission().then(function (r) { MZ.toast(r === 'granted' ? 'Alerts are on. You will get a notification for every new notice.' : 'Alerts were not allowed. You can allow them in your browser settings.'); render(); }); }
    else if (a === 'myProof') { var pp = payById(t.dataset.id); if (pp) { var w = null; if (!MZ.push.ios() && !/\.(png|jpe?g|webp|gif|heic)$/i.test(pp.proof_name || '')) try { w = window.open('', '_blank'); } catch (er) {} api.proofBlob(pp).then(function (b) { MZ.viewBlob(b, pp.proof_name || 'payment-slip', w); }).catch(function (er) { if (w) w.close(); MZ.toast(er.message); }); } }
    else if (a === 'signOut') api.signOut().then(function () { if (S.unwatch) S.unwatch(); $('#overlay').innerHTML = ''; S.showing = null; S.queue = []; showSignin(); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !S.showing) return;
    if (S.showing.rate) closeRate(); else if (S.showing.details) closeDetails(); else if (S.showing.account) closeAccount(); else if (S.showing.reward) closeReward(); else if (S.showing.juz) closeJuz(); else if (S.showing.notice) { $('#overlay').innerHTML = ''; S.showing = null; } else if (S.showing.badges) closeBadges(); else if (S.showing.sched) closeSched(); else if (S.showing.noticePop) { $('#overlay').innerHTML = ''; S.showing = null; } else closeReceipt();
  });
  document.addEventListener('submit', function (e) {
    if (e.target.id === 'rateForm') { e.preventDefault(); submitRate(); return; }
    if (e.target.id === 'detailsForm') {
      e.preventDefault();
      var btn = $('#dBtn'), err = $('#dErr'), d = { guardian_name: $('#dGuard').value.trim(), phone: $('#dPhone').value.replace(/[^\d+]/g, ''), email: $('#dEmail').value.trim() };
      if (d.phone && d.phone.charAt(0) === '0' && d.phone.length === 10) d.phone = '255' + d.phone.slice(1);
      btn.disabled = true; err.hidden = true;
      var ipw = $('#dItsPw');
      api.updateMyDetails(d).then(function () { if (ipw && ipw.value !== ipw.dataset.orig && api.setMyItsPassword) return api.setMyItsPassword(ipw.value.trim()); }).then(function () { return api.me(); }).then(function (me) {
        S.me = me; closeDetails(); render(); MZ.toast(missingDetails().length ? 'Saved. You can add the rest later.' : 'Thank you! Your details are complete.');
      }).catch(function (e2) { err.textContent = e2.message; err.hidden = false; btn.disabled = false; });
      return;
    }
    if (e.target.id !== 'pwForm') return;
    e.preventDefault();
    var a = $('#pw1').value, b = $('#pw2').value, err = $('#pwErr');
    if (a.length < 6) { err.textContent = 'Password must be at least 6 characters.'; err.hidden = false; return; }
    if (a !== b) { err.textContent = 'The two passwords do not match.'; err.hidden = false; return; }
    if (a === S.settings.default_password) { err.textContent = 'Choose a password different from the default one.'; err.hidden = false; return; }
    api.changePassword(a).then(function () { closeAccount(); MZ.toast('Password changed. Use it next time you sign in.'); })
      .catch(function (e2) { err.textContent = e2.message; err.hidden = false; });
  });

  api.restore().then(function (sess) { if (sess && sess.role === 'student') startApp(false); else showSignin(); }).catch(showSignin);
})();
