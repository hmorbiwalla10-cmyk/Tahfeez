/* Qism al Tahfeez — Institute portal */
(function () {
  'use strict';
  var $ = MZ.$, esc = MZ.esc, I = MZ.ICON;
  var api = MZ.createApi('institute');
  var METHODS = ['Cash', 'M-Pesa', 'Mobile money', 'Bank transfer', 'Cheque'];
  var S = {
    tab: 'fees', month: MZ.thisMonth(), filter: 'all', q: '', sq: '', rq: '', pq: '', pfilter: 'all', prog: {}, progMonth: null, notices: null,
    settings: { institute_name: 'Qism al Tahfeez Dar es Salaam', currency: 'TSh', default_password: 'zahra2026', due_day: 5 },
    students: [], payments: [], payYear: null, allPayments: null, loading: true, newLogins: [], sel: {}, ikh: null, rules: null
  };
  try { var t0 = (location.hash || '').slice(1); if (['fees', 'accounts', 'hr', 'progress', 'ikhtibar', 'students', 'notices', 'receipts', 'settings', 'schedule'].indexOf(t0) >= 0) S.tab = t0; if (t0 === 'timetable') { S.tab = 'schedule'; S.ttHint = 1; } } catch (e) {}

  $('#demo').innerHTML = MZ.demoBanner();
  MZ.togglePw();

  /* --------------------------------------------------------- sign in */
  function showSignin() {
    $('#app').hidden = true; $('#signin').hidden = false;
    $('#inDemo').hidden = MZ.LIVE;
    $('#setupForm').hidden = true; $('#signinForm').hidden = false;
    setTimeout(function () { $('#inUser').focus(); }, 50);
    (api.setupNeeded ? api.setupNeeded() : Promise.resolve(false)).then(function (needed) {
      if (!needed || !$('#app').hidden) return;
      $('#signinForm').hidden = true; $('#setupForm').hidden = false;
      setTimeout(function () { $('#suPass').focus(); }, 50);
    });
  }
  $('#setupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var u = $('#suUser').value.trim().toLowerCase(), p = $('#suPass').value, btn = $('#suBtn'), err = $('#suErr');
    err.hidden = true;
    if (!MZ.validUsername(u)) { err.textContent = 'Username must be 3 to 30 letters or numbers (dots, dashes and underscores are allowed, no spaces).'; err.hidden = false; return; }
    if (!MZ.strongPw(p)) { err.textContent = MZ.STRONG_PW_MSG; err.hidden = false; return; }
    if (p !== $('#suPass2').value) { err.textContent = 'The two passwords do not match.'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Creating…';
    api.createFirstAdmin(u, p).then(function () {
      $('#suPass').value = ''; $('#suPass2').value = '';
      startApp(); MZ.toast('Institute account created. Sign in next time with ' + u + '.');
    }).catch(function (e2) {
      err.textContent = e2.message; err.hidden = false;
      if (/already exists/i.test(e2.message)) setTimeout(showSignin, 1500);
    }).then(function () { btn.disabled = false; btn.textContent = 'Create account and sign in'; });
  });
  $('#inBtn').disabled = false;   // the button only works once the page is ready, so a password never ends up in the address bar
  $('#signinForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#inBtn'), err = $('#inErr');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Signing in…';
    api.signIn($('#inUser').value, $('#inPass').value).then(function () {
      $('#inPass').value = ''; startApp();
    }).catch(function (e2) {
      err.textContent = e2.message; err.hidden = false;
    }).then(function () { btn.disabled = false; btn.textContent = 'Sign in'; });
  });
  // security: staff are signed out after 30 minutes without any activity (a warning comes 1 minute before)
  (function () {
    var IDLE = 30 * 60000, WARN = 60000, last = Date.now(), warned = false, bump = function () { last = Date.now(); if (warned) { warned = false; var w = $('#idleWarn'); if (w) w.remove(); } };
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, bump, { passive: true, capture: true }); });
    setInterval(function () {
      if ($('#app').hidden) { last = Date.now(); return; }
      var idle = Date.now() - last;
      if (idle >= IDLE) { var w = $('#idleWarn'); if (w) w.remove(); warned = false; MZ.toast('Signed out after 30 minutes without activity, to keep the records safe.'); $('#signOut').click(); last = Date.now(); return; }
      if (idle >= IDLE - WARN && !warned) {
        warned = true; var d = document.createElement('div'); d.id = 'idleWarn'; d.className = 'idlewarn'; d.setAttribute('role', 'alertdialog');
        d.innerHTML = '<b>Still there?</b><span>You will be signed out in 1 minute to keep the records safe.</span><button class="btn gold sm" type="button">Stay signed in</button>';
        d.querySelector('button').addEventListener('click', bump); document.body.appendChild(d);
      }
    }, 15000);
  })();
  $('#signOut').addEventListener('click', function () {
    api.signOut().then(function () { if (S.unwatch) S.unwatch(); S.mustPw = false; closeSheet(); S.tls = undefined; S.canSch = S.canMove = undefined; S.schTeachers = null; if (S.sch) { S.sch.tfInit = 0; S.sch.teacher = ''; S.sch.list = null; S.sch.key = null; S.sch.busy = {}; S.sch.newIds = {}; } location.hash = ''; showSignin(); });
  });

  /* ------------------------------------------------------------- data */
  var payMap = {};
  function indexPayments() { payMap = {}; S.payments.forEach(function (p) { payMap[p.student_id + '|' + p.month] = p; }); }
  function idLine(s) { return [s.admission_no, s.its_no && s.its_no !== s.username ? 'ITS ' + s.its_no : '', s.username].filter(Boolean).join(' · '); }
  function studentById(id) { for (var i = 0; i < S.students.length; i++) if (S.students[i].id === id) return S.students[i]; return null; }
  function loadYear(y) {
    S.payYear = y;
    return api.listPayments({ year: y }).then(function (list) { if (S.payYear === y) { S.payments = list; indexPayments(); } });
  }
  function loadProgress(month) {
    return api.listProgress({ month: month }).then(function (list) {
      if (S.month !== month) return;
      S.prog = {}; list.forEach(function (r) { S.prog[r.student_id] = r; }); S.progMonth = month;
    });
  }
  function loadPending() {
    if (!can('enter')) { S.pending = []; return Promise.resolve([]); }
    return api.listPayments({ status: 'pending' }).then(function (l) { S.pending = l; updateBadge(); return l; }).catch(function () { S.pending = []; });
  }
  function updateBadge() {
    var b = document.querySelector('.tab[data-tab=fees]'); if (!b) return;
    var n = (S.pending || []).length; b.innerHTML = 'Fees' + (n ? '<span class="tabbadge" aria-label="' + n + ' waiting for approval">' + n + '</span>' : '');
  }
  function reloadAll() {
    loadPending();
    return Promise.all([api.getSettings(), api.listStudents(), loadYear(+S.month.slice(0, 4)), loadProgress(S.month)]).then(function (r) {
      S.settings = r[0]; S.students = r[1]; S.allPayments = null; S.loading = false; S.lastSig = JSON.stringify([r[1], S.payments, S.prog]); render();
    });
  }
  var refreshTimer = null;
  function softRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      loadPending().then(function () { if (S.tab === 'fees') render(); });
      Promise.all([api.listStudents(), loadYear(S.payYear || +S.month.slice(0, 4)), loadProgress(S.month)]).then(function (r) {
        var sig = JSON.stringify([r[0], S.payments, S.prog]);
        if (sig === S.lastSig) return;   // nothing changed: do not redraw (keeps the open page steady)
        S.lastSig = sig;
        S.students = r[0]; S.allPayments = null; if (!document.querySelector('.sheet input:focus,.sheet select:focus')) { render(); refreshSheet(); }
      }).catch(function () {});
    }, 400);
  }

  /* ---- staff roles: Admin sees everything, Teacher hifz only, Accounts fees only */
  var TABS = { admin: ['fees', 'accounts', 'hr', 'roles', 'goals', 'schedule', 'attendance', 'progress', 'ikhtibar', 'reports', 'students', 'notices', 'settings'], teacher: ['progress', 'attendance', 'schedule', 'ikhtibar', 'reports', 'students', 'notices', 'profile', 'myfeedback'],
    accounts: ['fees', 'accounts', 'students'], cashier: ['fees', 'accounts'], viewer: ['progress', 'attendance', 'schedule', 'ikhtibar', 'reports', 'accounts', 'hr', 'roles', 'goals'] };
  function role() { return S.role || 'admin'; }
  function can(area) { return MZ.roleCan(role(), area); }
  function isAdmin() { return role() === 'admin'; }
  // teachers cannot change a student's pages or direction, and cannot change past months (the admin can)
  function pagesLocked() { return role() === 'teacher'; }
  function pastLocked(m) { return role() === 'teacher' && !!m && m < MZ.thisMonth(); }
  var LOCK_PAGES = 'Only the admin can change the memorisation direction.', LOCK_PAST = 'Past months are locked. You can fill in this month and the coming months.';
  function isCashier() { return role() === 'cashier'; }
  function isViewer() { return role() === 'viewer'; }
  function applyRole() {
    var allowed = TABS[role()] || TABS.admin;
    MZ.$$('.tab').forEach(function (b) { b.hidden = allowed.indexOf(b.dataset.tab) < 0; });
    if (allowed.indexOf(S.tab) < 0) S.tab = allowed[0];
    var at = document.querySelector('.tab[data-tab=accounts]'); if (at) at.textContent = isCashier() ? 'Income & expenses' : 'Accounts';
    document.body.classList.toggle('viewonly', isViewer());
    var w = $('#who'); if (w) w.innerHTML = '<span class="rolechip r-' + role() + '">' + esc(MZ.ROLES[role()].name) + '</span>';
  }
  function startApp() {
    S.staff = null; S.staffErr = null; S.role = api.myRole ? api.myRole() : 'admin'; applyRole();
    $('#signin').hidden = true; $('#app').hidden = false;
    $('#page').innerHTML = '<p class="muted">Loading…</p>';
    reloadAll().then(function () {
      goalReminders();
      checkMySchedule(true);
      checkMustPw();
      if (!S.schTimer) S.schTimer = setInterval(function () { checkMySchedule(false); if (S.tab === 'schedule' && !sheet) loadSchedule(true); }, 60000);
      if (S.unwatch) S.unwatch();
      S.unwatch = api.watchPayments(softRefresh);
    }).catch(function (e) {
      $('#page').innerHTML = '<div class="empty"><h3>Could not load</h3><p>' + esc(e.message) + '</p><button class="btn gold" data-act="retry">Try again</button></div>';
    });
  }

  /* ---------------------------------------------------------- render */
  function render() {
    $('#instName').textContent = S.settings.institute_name || 'Qism al Tahfeez Dar es Salaam';
    MZ.$$('.tab').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)); });
    if (S.tab === 'receipts') { S.tab = 'accounts'; S.sub.accounts = 'receipts'; }
    renderSubtabs();
    if ((TABS[role()] || TABS.admin).indexOf(S.tab) < 0) applyRole();
    var f = { fees: renderFees, accounts: renderAccounts, hr: renderHR, progress: renderProgress, ikhtibar: renderIkhTab, students: renderStudents, notices: renderNotices, settings: renderSettings, reports: renderReports, profile: renderProfile, myfeedback: renderMyFeedback, attendance: renderStuAtt, roles: function () { return renderHR('duties'); }, goals: function () { return renderHR('goals'); }, schedule: renderSchedule }[S.tab] || renderFees;
    var keepFocus = document.activeElement && document.activeElement.id, selStart = null;
    if (keepFocus && document.activeElement.selectionStart != null) selStart = document.activeElement.selectionStart;
    $('#page').innerHTML = f();
    updateGoalBadge(); updateSchBadge();
    if (keepFocus) { var el = document.getElementById(keepFocus); if (el && el.closest('#page')) { el.focus(); if (selStart != null && el.setSelectionRange) try { el.setSelectionRange(selStart, selStart); } catch (e) {} } }
  }
  function monthRows(month) {
    return S.students.filter(function (s) { return (s.start_month || '0000-00') <= month && (!s.disabled || payMap[s.id + '|' + month]); }).map(function (s) {
      var p = payMap[s.id + '|' + month] || null;
      return { s: s, p: p, st: MZ.statusOf(s, month, p, S.settings) };
    });
  }
  function unpaidBefore(s) {
    var out = [], y = S.month.slice(0, 4), stop = S.month < MZ.thisMonth() ? S.month : MZ.thisMonth();
    for (var m = 1; m <= 12; m++) {
      var k = y + '-' + MZ.pad(m); if (k >= stop) break;
      if (k >= (s.start_month || '0000-00') && !payMap[s.id + '|' + k] && !MZ.onLeave(s, k)) out.push(k);
    }
    return out;
  }

  /* All-time approved payments, loaded once when a fees screen needs totals. */
  var paidCache = { src: null, map: {} };
  function allPays() {
    if (!can('fees') && !isViewer()) return null;
    if (!S.allPayments && !S.apLoading) {
      S.apLoading = true;
      api.listPayments({}).then(function (l) { S.allPayments = l; S.apLoading = false; render(); }).catch(function () { S.apLoading = false; });
    }
    return S.allPayments;
  }
  function paidAll(sid) {
    var l = allPays(); if (!l) return null;
    if (paidCache.src !== l) { var m = {}; l.forEach(function (p) { if (p.status === 'pending') return; var e = m[p.student_id] = m[p.student_id] || { total: 0, months: 0 }; e.total += p.amount; e.months++; }); paidCache = { src: l, map: m }; }
    return paidCache.map[sid] || { total: 0, months: 0 };
  }
  function renderFees() {
    var month = S.month, cur = S.settings.currency, allRows = monthRows(month), rows = allRows.filter(function (r) { return pgmOk(r.s); });
    var expected = 0, collected = 0, paid = 0, leaveN = 0;
    var waiting = 0, waitingSum = 0;
    rows.forEach(function (r) { if (r.st === 'leave') { leaveN++; return; } expected += MZ.effFee(r.s); if (r.p) { paid++; if (r.p.status === 'pending') { waiting++; waitingSum += r.p.amount; } else collected += r.p.amount; } });
    var unpaid = rows.length - paid - leaveN, pct = expected ? Math.min(100, Math.round(collected / expected * 100)) : 0;
    var q = S.q.trim().toLowerCase();
    var shown = rows.filter(function (r) {
      if (S.filter === 'paid' && !r.p) return false;
      if (S.filter === 'unpaid' && (r.p || r.st === 'leave')) return false;
      if (S.filter === 'leave' && r.st !== 'leave') return false;
      if (q && (r.s.full_name + ' ' + r.s.username + ' ' + r.s.phone + ' ' + r.s.its_no + ' ' + r.s.admission_no).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return (a.st === 'leave' ? 2 : a.p ? 1 : 0) - (b.st === 'leave' ? 2 : b.p ? 1 : 0) || a.s.full_name.localeCompare(b.s.full_name); });

    var h = '<div class="pagehead"><div class="monthnav">'
      + '<button class="iconbtn" data-act="prevMonth" aria-label="Previous month">' + I.left + '</button>'
      + '<h1>' + esc(MZ.monthLabel(month)) + (S.pgm ? ' <small class="pgmtag">' + esc(pgmLabel(S.pgm === '__none' ? '' : S.pgm)) + '</small>' : '') + '</h1>'
      + '<button class="iconbtn" data-act="nextMonth" aria-label="Next month">' + I.right + '</button></div>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="eyebrow">Fees due by the ' + MZ.ordinal(S.settings.due_day || 5) + '</span>'
      + (month !== MZ.thisMonth() ? '<button class="btn sm" data-act="thisMonth">This month</button>' : '') + (isCashier() ? '' : '<button class="btn sm" data-act="printAccounts">' + I.print + 'Print accounts</button>') + '</div></div>';
    if (!isCashier()) h += '<div class="summary"><div class="card collected"><p class="eyebrow">Collected</p>'
      + '<p class="big num">' + esc(MZ.money(collected, cur)) + ' <small>of ' + esc(MZ.money(expected, cur)) + '</small></p>'
      + '<div class="bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%"></i>' + (waitingSum && expected ? '<i class="wait" style="width:' + Math.min(100 - pct, Math.round(waitingSum / expected * 100)) + '%"></i>' : '') + '</div>'
      + (waiting ? '<p class="waitline">+ ' + esc(MZ.money(waitingSum, cur)) + ' from ' + waiting + ' student' + (waiting === 1 ? '' : 's') + ' waiting for approval</p>' : '') + '</div>'
      + '<div class="counts"><div class="count paid"><b class="num">' + paid + '</b><span>Paid</span></div><div class="count unpaid"><b class="num">' + unpaid + '</b><span>Not paid yet</span></div></div></div>';
    h += '<div class="toolbar"><div class="chips" role="group" aria-label="Filter">'
      + [['all', 'All', rows.length], ['unpaid', 'Not paid', unpaid], ['paid', 'Paid', paid]].concat(leaveN ? [['leave', 'On leave', leaveN]] : []).map(function (c) {
        return '<button class="chip" type="button" data-act="filter" data-f="' + c[0] + '" aria-pressed="' + (S.filter === c[0]) + '">' + c[1] + '<b>' + c[2] + '</b></button>';
      }).join('') + (unpaid ? '<button class="chip" type="button" data-act="selAll" aria-pressed="false">Tick all not paid</button>' : '') + '</div><span class="spacer"></span>' + pgmSelectHTML('pgmFee')
      + '<label class="search"><span class="sr">Search students</span><input id="feeQ" type="search" placeholder="Search students" value="' + esc(S.q) + '" autocomplete="off"></label></div>';
    if (!S.pgm) h += pgmFeesHTML(allRows);

    h = approvalBanner() + h;
    if (!S.students.length) {
      return h + '<div class="empty"><h3>No students yet</h3><p>Add students one by one or upload your Excel list.</p><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn gold" data-act="addStudent">' + I.plus + 'Add student</button><button class="btn" data-act="import">' + I.upload + 'Import from Excel</button></div></div>';
    }
    if (!shown.length) return h + '<div class="empty"><p>' + (rows.length ? 'No students match.' : 'No students are enrolled in ' + esc(MZ.monthLabel(month)) + '.') + '</p></div>';
    h += '<div class="list">' + shown.map(function (r) {
      var s = r.s, ar = unpaidBefore(s);
      var act = r.p && r.p.status === 'pending' ? (isAdmin() ? '<button class="btn sm gold" data-act="approveOne" data-id="' + r.p.id + '">' + I.check + 'Approve</button>' : '') + '<button class="btn sm" data-act="receipt" data-id="' + r.p.id + '">View</button>'
        : r.p ? '<button class="btn sm" data-act="receipt" data-id="' + r.p.id + '">Receipt</button>'
        : r.st === 'leave' ? '<button class="btn sm ghost" data-act="student" data-id="' + esc(s.id) + '">Details</button>'
        : (MZ.effFee(s) > 0 ? '<label class="tick" title="Tick to mark paid with others"><input type="checkbox" data-sel="' + esc(s.id) + '"' + (S.sel[s.id] ? ' checked' : '') + '><span class="sr">Tick ' + esc(s.full_name) + '</span></label>' : '')
          + '<button class="btn sm gold" data-act="pay" data-sid="' + esc(s.id) + '" data-month="' + month + '">' + I.check + 'Paid</button>';
      return '<article class="row' + (S.sel[s.id] && !r.p ? ' sel' : '') + (r.p && r.p.status === 'pending' ? ' waiting' : '') + (r.st === 'leave' ? ' leave' : '') + '"><button class="person" data-act="student" data-id="' + esc(s.id) + '"><span class="av">' + esc(MZ.initials(s.full_name)) + '</span>'
        + '<span class="pname"><b>' + esc(s.full_name) + '</b><small class="mono">' + esc(idLine(s)) + '</small></span></button>'
        + (!r.p && r.st === 'leave' ? '<div class="amt"><span class="muted">No fee</span><small>' + esc(MZ.breakLabel(MZ.breakAt(s, month))) + '</small></div>'
          : !r.p && !s.monthly_fee ? (isCashier() ? '<div class="amt"><span class="muted">—</span><small>Fee not set</small></div>' : '<div class="amt"><button class="btn sm ghost" data-act="editFees" style="padding-left:0">Set fee</button><small>Fee not set</small></div>')
          : '<div class="amt num">' + esc(MZ.money(r.p ? r.p.amount : MZ.effFee(s), cur)) + '<small>' + (r.p ? 'Paid ' + esc(MZ.dateShort(r.p.paid_on)) + ' · ' + esc(r.p.method) + (r.p.proof_path ? ' · slip' : '') : s.discount_value ? 'After ' + esc(MZ.discountLabel(s, cur)) : 'Monthly fee') + '</small></div>')
        + '<div class="st">' + MZ.pill(r.st, S.settings) + (ar.length ? '<small>Also unpaid: ' + esc(ar.map(MZ.monthShort).join(', ')) + '</small>' : '') + '</div>'
        + '<div class="act">' + act + '</div></article>';
    }).join('') + '</div>';
    return h + bulkBar(rows);
  }
  /* ---- approval: payments recorded by the accounts team wait for an admin */
  function approvalBanner() {
    var l = S.pending || []; if (!l.length) return '';
    var tot = l.reduce(function (a, p) { return a + p.amount; }, 0), cur = S.settings.currency;
    var names = l.slice(0, 4).map(function (p) { var st = studentById(p.student_id); return st ? MZ.firstName(st.full_name) : ''; }).filter(Boolean);
    if (isAdmin()) return '<section class="approvebar"><div class="ap-seal">' + I.check + '<b class="num">' + l.length + '</b></div><div class="ap-text"><p class="eyebrow">Waiting for your approval</p><h2>' + l.length + ' payment' + (l.length === 1 ? '' : 's') + ' · <span class="num">' + esc(MZ.money(tot, cur)) + '</span></h2><p class="muted">'
      + esc(names.join(', ') + (l.length > names.length ? ' and ' + (l.length - names.length) + ' more' : '')) + '. Recorded by the accounts team. Students see the receipts after you approve.</p></div>'
      + '<div class="btnrow"><button class="btn" data-act="approvals">Review</button><button class="btn gold" data-act="approveAll">' + I.check + 'Approve all ' + l.length + '</button></div></section>';
    return '<section class="approvebar sent"><div class="ap-seal">' + I.check + '<b class="num">' + l.length + '</b></div><div class="ap-text"><p class="eyebrow">Sent for approval</p><h2>' + l.length + ' payment' + (l.length === 1 ? '' : 's') + ' · <span class="num">' + esc(MZ.money(tot, cur)) + '</span></h2><p class="muted">Waiting for an admin to approve. Students see the receipts once approved. You can still cancel one before it is approved.</p></div></section>';
  }
  function openApprovals() {
    var l = (S.pending || []).slice().sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; }), cur = S.settings.currency;
    if (!S.staff && api.listStaff) api.listStaff().then(function (st) { S.staff = st; if (sheet && sheet.kind === 'approvals') openApprovals(); }).catch(function () {});
    var who = function (id) { var a = (S.staff || []).find(function (x) { return x.user_id === id; }); return a ? a.username : 'Accounts'; };
    var tot = l.reduce(function (a, p) { return a + p.amount; }, 0);
    openSheet('approvals', {}, head('Approvals', l.length ? l.length + ' payment' + (l.length === 1 ? '' : 's') + ' to approve' : 'All approved')
      + (l.length ? '<div class="aplist">' + l.map(function (p) {
        var st = studentById(p.student_id) || { full_name: 'Removed student', username: '' };
        return '<label class="aprow"><input type="checkbox" name="apSel" value="' + p.id + '" checked><span class="av">' + esc(MZ.initials(st.full_name)) + '</span>'
          + '<span class="pname"><b>' + esc(st.full_name) + '</b><small>' + esc(MZ.monthLabel(p.month)) + ' fees · ' + esc(p.method) + ' · paid ' + esc(MZ.dateShort(p.paid_on)) + (p.note ? ' · ' + esc(p.note) : '') + '</small><small class="apby">Recorded by ' + esc(who(p.created_by)) + ' · ' + esc(MZ.dateShort((p.created_at || '').slice(0, 10))) + '</small></span>'
          + '<span class="amt num">' + esc(MZ.money(p.amount, cur)) + '<small class="mono">' + esc(p.receipt_no) + '</small></span>'
          + '<button class="btn sm ghost danger" type="button" data-act="rejectPay" data-id="' + p.id + '">Reject</button></label>';
      }).join('') + '</div>'
        + '<div class="apfoot"><div><b class="num" id="apTot">' + esc(MZ.money(tot, cur)) + '</b><small id="apCount">' + l.length + ' selected</small></div><button class="btn gold" data-act="approveSel" id="apBtn">' + I.check + 'Approve ' + l.length + '</button></div>'
        : '<div class="empty"><p>Nothing is waiting. Payments the accounts team records appear here for you to approve.</p></div>'));
  }
  function apCount() {
    var ids = MZ.$$('input[name=apSel]:checked').map(function (i) { return +i.value || i.value; }), cur = S.settings.currency;
    var tot = (S.pending || []).filter(function (p) { return ids.indexOf(p.id) >= 0; }).reduce(function (a, p) { return a + p.amount; }, 0);
    var t = $('#apTot'), c = $('#apCount'), b = $('#apBtn');
    if (t) t.textContent = MZ.money(tot, cur); if (c) c.textContent = ids.length + ' selected'; if (b) { b.innerHTML = I.check + 'Approve ' + ids.length; b.disabled = !ids.length; }
    return ids;
  }
  document.addEventListener('change', function (e) { if (e.target.name === 'apSel') apCount(); if (e.target.name === 'bulkAcc') setPrefAcc(e.target.value); });
  function approve(ids, btn) {
    if (!ids.length) return;
    if (btn) btn.disabled = true;
    api.approvePayments(ids).then(function (n) {
      return Promise.all([loadYear(S.payYear || +S.month.slice(0, 4)), loadPending()]).then(function () {
        S.allPayments = null; render(); if (sheet && sheet.kind === 'approvals') openApprovals(); else if (sheet && sheet.kind === 'receipt') closeSheet();
        MZ.toast(n + ' payment' + (n === 1 ? '' : 's') + ' approved. The receipts are now in the students’ portals.');
      });
    }).catch(function (e) { MZ.toast(e.message); if (btn) btn.disabled = false; });
  }

  /* ---- tick many students, mark them all paid at once */
  function selected(rows) { return (rows || monthRows(S.month)).filter(function (r) { return S.sel[r.s.id] && !r.p && r.st !== 'leave' && MZ.effFee(r.s) > 0; }); }
  function bulkBar(rows) {
    var sel = selected(rows); if (!sel.length) return '';
    var tot = sel.reduce(function (a, r) { return a + MZ.effFee(r.s); }, 0);
    return '<div class="bulkbar" role="region" aria-label="Ticked students"><span><b class="num">' + sel.length + '</b> ticked · <span class="num">' + esc(MZ.money(tot, S.settings.currency)) + '</span><small>' + esc(MZ.monthLabel(S.month)) + ' · each at their monthly fee</small></span>'
      + '<span class="btnrow">' + accPick('bulkAcc', prefAcc(), true) + '<button class="btn ghost" data-act="selNone">Clear</button><button class="btn gold" data-act="bulkPay">' + I.check + 'Mark ' + sel.length + ' paid</button></span></div>';
  }
  function payMany(jobs, done) {
    var method = prefAcc() === 'bank' ? 'Bank' : 'Cash';
    var ok = [], failed = [];
    (function next(i) {
      if (i >= jobs.length) { S.allPayments = null; done(ok, failed); return; }
      var j = jobs[i];
      api.recordPayment({ student_id: j.s.id, month: j.month, amount: MZ.effFee(j.s), method: method, paid_on: MZ.today(), note: '' })
        .then(function (p) { ok.push(p); if (+j.month.slice(0, 4) === S.payYear) { S.payments.push(p); indexPayments(); } })
        .catch(function (e) { failed.push(j.s.full_name + ' (' + MZ.monthShort(j.month) + '): ' + e.message); })
        .then(function () { next(i + 1); });
    })(0);
  }
  function bulkDone(ok, failed) {
    loadPending().then(function () { if (S.tab === 'fees') render(); });
    var pend = ok.filter(function (p) { return p.status === 'pending'; }).length;
    MZ.toast((pend ? pend + ' payment' + (pend === 1 ? '' : 's') + ' sent to the admin for approval. Students see the receipt once it is approved.' : ok.length + ' receipt' + (ok.length === 1 ? '' : 's') + ' created. Students see them in their portal now.') + (failed.length ? ' Not done: ' + failed.join('; ') : ''),
      ok.length ? { label: 'Undo', fn: function () {
        Promise.all(ok.map(function (p) { return api.deletePayment(p.id); })).then(function () {
          var ids = ok.map(function (p) { return p.id; }); S.payments = S.payments.filter(function (p) { return ids.indexOf(p.id) < 0; }); indexPayments(); S.allPayments = null;
          render(); refreshSheet(); MZ.toast('Undone.');
        }).catch(function (e) { MZ.toast(e.message); });
      } } : null);
  }

  /* which teacher(s) each student has (admin sets them; teachers see only their students) */
  function needHR() { if (isAdmin() && !S.hr && !S.hrLoading) { S.hrLoading = true; api.listHR().then(function (l) { S.hr = l; S.hrLoading = false; render(); if (sheet && sheet.kind === 'student') refreshSheet(); }).catch(function () { S.hrLoading = false; }); } }
  function teacherNames(s) { if (!S.hr) return ''; return (s.teacher_ids || []).map(function (id) { var t = hrById(id); return t ? t.data.full_name : ''; }).filter(Boolean).join(', '); }
  function teachersSection(s) {
    if (!isAdmin()) return '';
    needHR();
    var list = S.hr ? teachers(true) : [];
    return '<section><h3>Teachers</h3><div class="panel tpick"><p class="muted" style="font-size:13.5px;margin:0">Teachers see only their own students: the ones ticked here, and anyone in their schedule.</p>'
      + (S.hr ? (list.length ? '<div class="tchips" role="group" aria-label="Teachers">' + list.map(function (t) { var on = (s.teacher_ids || []).indexOf(t.id) >= 0; return '<label class="tchip"><input type="checkbox" value="' + t.id + '" data-tpick' + (on ? ' checked' : '') + '><span>' + esc(t.data.full_name) + '</span></label>'; }).join('') + '</div>' : '<p class="muted">Add teachers in HR → Teachers first.</p>') : '<p class="muted">Loading teachers…</p>')
      + (list.length ? '<div><button class="btn gold sm" data-act="saveTeachers" data-id="' + esc(s.id) + '">' + I.check + 'Save teachers</button></div>' : '') + '</div></section>';
  }
  function renderStudents() {
    var q = S.sq.trim().toLowerCase(), cur = S.settings.currency;
    var nDis = S.students.filter(function (s) { return s.disabled; }).length;
    var sf = S.sfilter || 'active';
    var nNew = S.students.filter(function (s) { return s.is_new && !s.disabled; }).length;
    if (isAdmin()) needHR();
    var tf = S.stf || '';
    var list = S.students.filter(function (s) { return sf === 'new' ? s.is_new && !s.disabled : (sf === 'all' || (sf === 'disabled') === s.disabled); }).filter(pgmOk)
      .filter(function (s) { return !tf || (tf === 'none' ? !(s.teacher_ids || []).length : (s.teacher_ids || []).indexOf(+tf) >= 0); }).filter(function (s) { return !q || (s.full_name + ' ' + s.username + ' ' + s.phone + ' ' + s.its_no + ' ' + s.admission_no + ' ' + s.program).toLowerCase().indexOf(q) >= 0; });
    var h = '<div class="pagehead"><div><h1>Students</h1><p class="stat"><span><b class="num">' + (S.students.length - nDis) + '</b> active</span>' + (nDis ? '<span><b class="num">' + nDis + '</b> disabled</span>' : '') + '</p></div>'
      + (isAdmin() ? '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn gold" data-act="addStudent">' + I.plus + 'Add student</button><button class="btn" data-act="import">' + I.upload + 'Import from Excel</button></div>' : '') + '</div>';
    h += '<div class="toolbar">' + (nDis || nNew ? '<div class="chips" role="group" aria-label="Show">' + [['active', 'Active', S.students.length - nDis], ['new', 'New enrollments', nNew], ['disabled', 'Disabled', nDis], ['all', 'All', S.students.length]].map(function (c) {
        return '<button class="chip" type="button" data-act="sfilter" data-f="' + c[0] + '" aria-pressed="' + (sf === c[0]) + '">' + c[1] + '<b>' + c[2] + '</b></button>';
      }).join('') + '</div>' : '') + '' + pgmSelectHTML('pgmStu')
      + (isAdmin() && S.hr && teachers(true).length ? '<label class="pgmsel"><span class="sr">Teacher</span><select id="stuTch" aria-label="Teacher"><option value="">All teachers</option><option value="none"' + (tf === 'none' ? ' selected' : '') + '>No teacher yet</option>' + teachers(true).map(function (t) { return '<option value="' + t.id + '"' + (tf === String(t.id) ? ' selected' : '') + '>' + esc(t.data.full_name) + '</option>'; }).join('') + '</select></label>' : '')
      + '<label class="search"><span class="sr">Search students</span><input id="stuQ" type="search" placeholder="Search by name, username or phone" value="' + esc(S.sq) + '" autocomplete="off"></label><span class="spacer"></span>'
      + (S.students.length ? (can('fees') ? '<button class="btn sm" data-act="editFees">Edit fees</button><button class="btn sm" data-act="bulkUpdate">' + I.mail + 'Email updates</button>' : '') + (isAdmin() ? '<button class="btn sm" data-act="exportStudents">Download list (Excel)</button>' : '') : '')
      + (S.newLogins.length ? '<button class="btn sm" data-act="exportLogins">Logins created today (' + S.newLogins.length + ')</button>' : '') + '</div>';
    h += pgmStripHTML();
    if (role() === 'teacher') h += '<p class="mynote">' + I.user + '<span>You see <b>your students only</b>: the ones the admin gave you, and anyone in your schedule.</span></p>';
    if (!S.students.length && role() === 'teacher') return h + '<div class="empty"><h3>No students given to you yet</h3><p>When the admin gives you students, or allocates them to you in the Schedule, they appear here.</p></div>';
    if (!S.students.length) return h + '<div class="empty"><h3>No students yet</h3><p>Upload your Excel list or add students one at a time. Each student gets a username and password to sign in to the Student portal.</p></div>';
    if (!list.length) return h + '<div class="empty"><p>No students match.</p></div>';
    // wide screens: arch-framed cards; narrow screens: the list below
    h += '<div class="archgrid" role="list">' + list.map(function (s) {
      var p = payMap[s.id + '|' + MZ.thisMonth()], st = MZ.statusOf(s, MZ.thisMonth(), p, S.settings), pct = (s.pages / 6.04).toFixed(1);
      return '<button class="archcard' + (s.disabled ? ' off' : '') + '" role="listitem" data-act="student" data-id="' + esc(s.id) + '">'
        + '<svg class="ac-frame" viewBox="0 0 200 260" preserveAspectRatio="none" aria-hidden="true"><path class="ac-fill" d="M3 260V92Q3 40 78 16L100 3L122 16Q197 40 197 92V260Z"/><path class="ac-line" d="M12 252V95Q12 48 82 26L100 14L118 26Q188 48 188 95V252Z"/></svg>'
        + '<span class="ac-av">' + esc(MZ.initials(s.full_name)) + '</span>'
        + '<b class="ac-name">' + esc(s.full_name) + '</b><small class="ac-id mono">' + esc(s.admission_no || s.its_no || s.username) + '</small>'
        + (s.program ? '<small class="ac-prog">' + esc(s.program) + '</small>' : '')
        + (isAdmin() && teacherNames(s) ? '<small class="ac-tch">' + esc(teacherNames(s)) + '</small>' : isAdmin() && S.hr ? '<small class="ac-tch none">No teacher yet</small>' : '')
        + (s.is_new && !s.disabled ? '<small class="newpill">New enrollment</small>' : '')
        + (can('fees') && paidAll(s.id) ? '<small class="ac-paid"><span>Paid in total</span><b class="num">' + esc(MZ.money(paidAll(s.id).total, cur)) + '</b><i>' + paidAll(s.id).months + ' month' + (paidAll(s.id).months === 1 ? '' : 's') + '</i></small>' : '')
        + '<span class="ac-hifz"><span class="mbar"><i style="width:' + pct + '%"></i></span><small>' + s.pages + ' of 604 pages' + (s.cur_surah ? ' · ' + esc(MZ.surahName(s.cur_surah)) : '') + '</small></span>'
        + (MZ.mastery(s.keys) ? '<small class="ac-master">' + MZ.masteryChip(s.keys) + '</small>' : '')
        + '<span class="ac-foot"><span class="ac-keys">' + I.key + s.keys + '</span>' + (s.disabled ? '<span class="pill plain">Disabled</span>' : can('fees') && S.payYear === +MZ.thisMonth().slice(0, 4) ? MZ.pill(st, S.settings) : '') + '</span>'
        + '</button>';
    }).join('') + '</div>';
    h += '<div class="list stulist">' + list.map(function (s) {
      var p = payMap[s.id + '|' + MZ.thisMonth()], st = MZ.statusOf(s, MZ.thisMonth(), p, S.settings);
      return '<article class="row"><button class="person" data-act="student" data-id="' + esc(s.id) + '"><span class="av">' + esc(MZ.initials(s.full_name)) + '</span>'
        + '<span class="pname"><b>' + esc(s.full_name) + (s.is_new && !s.disabled ? ' <span class="newpill">New</span>' : '') + '</b><small class="mono">' + esc(idLine(s)) + (s.phone ? ' · ' + esc(s.phone) : '') + '</small></span></button>'
        + (can('fees') ? '<div class="amt num">' + (s.monthly_fee ? esc(MZ.money(s.monthly_fee, cur)) + '<small>per month' + (paidAll(s.id) ? ' · ' + esc(MZ.money(paidAll(s.id).total, cur)) + ' paid in total' : '') + '</small>' : '<span class="muted">Fee not set</span>') + '</div>' : '<div class="amt num">' + s.pages + '<small>pages memorised</small></div>')
        + '<div class="st">' + (s.disabled ? '<span class="pill plain">Disabled</span>' : can('fees') && S.payYear === +MZ.thisMonth().slice(0, 4) ? MZ.pill(st, S.settings) : '') + '<small>Since ' + esc(MZ.monthLabel(s.start_month)) + '</small></div>'
        + '<div class="act"><button class="btn sm" data-act="student" data-id="' + esc(s.id) + '">Open</button></div></article>';
    }).join('') + '</div>';
    return h;
  }

  function renderReceipts() {
    if (!S.allPayments) {
      api.listPayments({}).then(function (l) { S.allPayments = l; if (S.tab === 'accounts' && S.sub.accounts === 'receipts') render(); }).catch(function (e) { MZ.toast(e.message); });
      return '<div class="pagehead"><h1>Receipts</h1></div><p class="muted" style="margin-top:14px">Loading receipts…</p>';
    }
    var q = S.rq.trim().toLowerCase(), cur = S.settings.currency;
    var list = S.allPayments.filter(function (p) {
      if (!q) return true; var s = studentById(p.student_id) || {};
      return (p.receipt_no + ' ' + (s.full_name || '') + ' ' + (s.username || '') + ' ' + MZ.monthLabel(p.month)).toLowerCase().indexOf(q) >= 0;
    });
    var total = list.reduce(function (a, p) { return a + p.amount; }, 0);
    var h = '<div class="pagehead"><div><h1>Receipts</h1><p class="stat"><span><b class="num">' + list.length + '</b> receipts</span><span><b class="num">' + esc(MZ.money(total, cur)) + '</b> total</span></p></div></div>'
      + '<div class="toolbar"><label class="search"><span class="sr">Search receipts</span><input id="recQ" type="search" placeholder="Search name, month or receipt no." value="' + esc(S.rq) + '" autocomplete="off"></label></div>';
    if (!list.length) return h + '<div class="empty"><p>' + (S.allPayments.length ? 'No receipts match.' : 'No receipts yet. They appear here when you mark a student as paid.') + '</p></div>';
    h += '<div class="list">' + list.slice(0, 400).map(function (p) {
      var s = studentById(p.student_id) || { full_name: 'Removed student', username: '' };
      return '<article class="row"><button class="person" data-act="receipt" data-id="' + p.id + '"><span class="av">' + I.receipt.replace('width="24" height="24"', 'width="20" height="20"') + '</span>'
        + '<span class="pname"><b>' + esc(s.full_name) + '</b><small class="mono">' + esc(p.receipt_no) + '</small></span></button>'
        + '<div class="amt num">' + esc(MZ.money(p.amount, cur)) + '<small>' + esc(p.method) + '</small></div>'
        + '<div class="st"><span class="pill good"><i></i>' + esc(MZ.monthLabel(p.month)) + '</span><small>Paid ' + esc(MZ.dateLabel(p.paid_on)) + '</small></div>'
        + '<div class="act"><button class="btn sm" data-act="receipt" data-id="' + p.id + '">View</button></div></article>';
    }).join('') + '</div>';
    if (list.length > 400) h += '<p class="muted" style="margin-top:10px">Showing the newest 400. Search to find older receipts.</p>';
    return h;
  }

  function renderSettings() {
    var s = S.settings;
    return '<div class="pagehead"><h1>Settings</h1></div>'
      + '<form class="form settings card" id="settingsForm" style="margin-top:16px" autocomplete="off">'
      + '<div class="field"><label for="setName">Institute name (shown on receipts)</label><input id="setName" required maxlength="80" value="' + esc(s.institute_name) + '"></div>'
      + '<div class="two"><div class="field"><label for="setCur">Currency</label><input id="setCur" required maxlength="8" value="' + esc(s.currency) + '"><span class="hint">For example TSh, KSh or UGX</span></div>'
      + '<div class="field"><label for="setDue">Fees due by day</label><input id="setDue" type="number" min="1" max="28" required value="' + esc(s.due_day) + '"><span class="hint">After this day an unpaid month shows as Unpaid</span></div></div>'
      + '<div class="field"><label for="setPw">Default password for new students</label><input id="setPw" required minlength="6" maxlength="40" value="' + esc(s.default_password) + '"><span class="hint">Students are asked to choose their own password the first time they sign in.</span></div>'
      + '<div><button class="btn gold" type="submit">Save settings</button></div></form>'
      + '<form class="form settings card" id="keysForm" style="margin-top:14px" autocomplete="off"><div><p class="eyebrow">Keys &amp; rewards</p><p class="muted" style="font-size:13.5px">How many keys students earn. Changes apply to new entries only.</p></div>'
      + '<div class="two"><div class="field"><label for="kJ">Keys per jadeed page</label><input id="kJ" type="number" min="0" max="1000" required value="' + s.keys_jadeed + '"></div>'
      + '<div class="field"><label for="kI">Keys for ikhtibar cleared</label><input id="kI" type="number" min="0" max="1000" required value="' + s.keys_ikhtibar + '"></div></div>'
      + '<div class="two"><div class="field"><label for="kG">Keys for monthly goal reached</label><input id="kG" type="number" min="0" max="1000" required value="' + s.keys_goal + '"></div>'
      + '<div class="field"><label for="kR">Reward unlocked every</label><input id="kR" type="number" min="1" max="100000" required value="' + s.reward_every + '"><span class="hint">keys</span></div></div>'
      + '<div><button class="btn gold" type="submit">Save keys</button></div></form>'
      + '<section class="card settings" style="margin-top:14px;display:grid;gap:10px"><div><p class="eyebrow">Appearance</p><p class="muted" style="font-size:13.5px">Night is deep indigo and gold, easier on the eyes after Maghrib. Automatic follows this device. Saved on this device only.</p></div>' + MZ.themeChipsHTML() + '</section>'
      + rulesSettingsHTML()
      + ikhSettingsHTML() + welcomeSettingsHTML() + schMailSettingsHTML()
      + teacherLoginHTML() + staffHTML() + myPwHTML()
      + (MZ.LIVE ? '' : '<div class="card settings" style="margin-top:14px;display:grid;gap:10px"><p class="eyebrow">Demo mode</p><p class="muted">Bring back the example students and receipts.</p><div><button class="btn danger" data-act="resetDemo">Reset demo data</button></div></div>');
  }

  /* Teacher logins: made automatically when a teacher is added in HR → Teachers */
  function teacherLoginHTML() {
    if (S.tls === undefined && api.teacherLoginSettings) { S.tls = null; api.teacherLoginSettings().then(function (v) { S.tls = v || { auto: true, password: '' }; if (S.tab === 'settings') render(); }).catch(function () { S.tls = { auto: true, password: '', err: 1 }; }); }
    var v = S.tls || { auto: true, password: '' };
    return '<form class="card settings form" id="tlsForm" style="margin-top:14px;display:grid;gap:12px" autocomplete="off"><div><p class="eyebrow">Teacher logins</p>'
      + '<p class="muted" style="font-size:13.5px">When you add a teacher in HR → Teachers, a login is made for them straight away. The username is their ITS number (or first.last name), and the password is the default below. The first time they sign in they must choose their own password.</p></div>'
      + '<label class="tickline"><input type="checkbox" id="tlsAuto"' + (v.auto ? ' checked' : '') + '><span>Create a login automatically for every new teacher</span></label>'
      + '<div class="field"><label for="tlsPw">Default password for new teachers</label><input id="tlsPw" required minlength="10" value="' + esc(v.password || '') + '" autocomplete="off" spellcheck="false"><span class="hint">At least 10 characters, letters and numbers. Teachers change it at their first sign-in.</span></div>'
      + '<div><button class="btn gold" type="submit" id="tlsBtn">' + I.check + 'Save</button></div></form>';
  }
  function myPwHTML() {
    return '<form class="card settings form" id="myPwForm" style="margin-top:14px;display:grid;gap:12px" autocomplete="off"><p class="eyebrow">My password</p>'
      + '<div class="two"><div class="field"><label for="mpw1">New password</label><input id="mpw1" type="password" required minlength="10" autocomplete="new-password"></div>'
      + '<div class="field"><label for="mpw2">Type it again</label><input id="mpw2" type="password" required minlength="10" autocomplete="new-password"></div></div>'
      + '<p class="err" id="mpwErr" hidden></p><div><button class="btn" type="submit" id="mpwBtn">Change my password</button></div></form>';
  }
  function saveMyPw(forced) {
    var a = $('#mpw1').value, b = $('#mpw2').value, err = $('#mpwErr'), btn = $('#mpwBtn');
    err.hidden = true;
    if (!MZ.strongPw(a)) { err.textContent = MZ.STRONG_PW_MSG; err.hidden = false; return; }
    if (a !== b) { err.textContent = 'The two passwords are different.'; err.hidden = false; return; }
    btn.disabled = true;
    api.changeStaffPassword(a).then(function () {
      if (forced) { S.mustPw = false; closeSheet(); }
      $('#mpw1') && ($('#mpw1').value = ''); $('#mpw2') && ($('#mpw2').value = '');
      btn.disabled = false; MZ.toast('Password changed. Use it next time you sign in.');
    }).catch(function (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; });
  }
  // a login made by the admin (or a reset) has a password someone else knows, so ask for a new one
  function checkMustPw() {
    if (!api.myMustChangePw) return;
    api.myMustChangePw().then(function (must) {
      if (!must) return; S.mustPw = true;
      openSheet('mustPw', {}, '<div class="sheet-head"><div><p class="eyebrow">Welcome</p><h2>Choose your own password</h2></div></div>'
        + '<p class="muted">You signed in with a password the admin gave you. Choose one that only you know. You will use it from now on.</p>'
        + '<form class="form" id="myPwForm" data-forced="1" autocomplete="off"><div class="field"><label for="mpw1">New password</label><input id="mpw1" type="password" required minlength="10" autocomplete="new-password"><span class="hint">At least 10 characters, letters and numbers.</span></div>'
        + '<div class="field"><label for="mpw2">Type it again</label><input id="mpw2" type="password" required minlength="10" autocomplete="new-password"></div>'
        + '<p class="err" id="mpwErr" hidden></p><button class="btn gold block" type="submit" id="mpwBtn">' + I.check + 'Save my password</button></form>');
      setTimeout(function () { var x = $('#mpw1'); if (x) x.focus(); }, 300);
    }).catch(function () {});
  }
  // creates the login for a teacher and shows the details to pass on
  function makeTeacherLogin(hrId, quietIfOff) {
    return (S.tls ? Promise.resolve(S.tls) : api.teacherLoginSettings().then(function (v) { S.tls = v; return v; })).then(function (v) {
      if (quietIfOff && v && v.auto === false) return null;
      return api.createTeacherLogin(hrId).then(function (r) {
        var rec = hrById(hrId); if (rec) rec.data.user_id = r.user_id;
        S.staff = null; render(); showTeacherLogin(rec ? rec.data.full_name : 'The teacher', r);
        return r;
      });
    });
  }
  function showTeacherLogin(name, r) {
    var url = location.origin + location.pathname.replace(/[^/]*$/, '') + 'institute.html';
    var msg = 'Salaam ' + name + ', your Tahfeez Daressalaam teacher login is ready.\nOpen: ' + url + '\nUsername: ' + r.username + '\nPassword: ' + r.password + '\nYou will be asked to choose your own password the first time you sign in.';
    S.tlMsg = msg;
    openSheet('tlogin', {}, head('Teacher login ready', name)
      + '<div class="logincard"><div><span>Username</span><b class="mono">' + esc(r.username) + '</b></div><div><span>Password</span><b class="mono">' + esc(r.password) + '</b></div><div><span>Sign in at</span><b class="mono">' + esc(url) + '</b></div></div>'
      + '<p class="muted">They sign in to the Institute portal as a teacher and will be asked to choose their own password the first time.</p>'
      + '<div class="btnrow"><button class="btn gold" data-act="tlCopy">' + I.doc + 'Copy the details</button><a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(msg) + '">Send on WhatsApp</a></div>');
  }
  function staffHTML() {
    if (!S.staff) {
      api.listStaff().then(function (l) { S.staff = l; if (S.tab === 'settings') render(); }).catch(function (e) { S.staff = []; S.staffErr = e.message; if (S.tab === 'settings') render(); });
    }
    var me = api.myId ? api.myId() : null, counts = { admin: 0, teacher: 0, accounts: 0, cashier: 0, viewer: 0 };
    (S.staff || []).forEach(function (a) { counts[a.role || 'admin']++; });
    var list = S.staff ? (S.staff.length ? S.staff.map(function (a) {
      var self = a.user_id === me, r = a.role || 'admin';
      return '<div class="staffrow"><span class="av r-' + r + '">' + esc(a.username.charAt(0).toUpperCase()) + '</span><span class="pname"><b class="mono">' + esc(a.username) + '</b><small>' + (self ? 'You · ' : '') + esc(MZ.ROLES[r].desc) + '</small></span>'
        + '<span class="staffact"><label class="sr" for="role_' + esc(a.user_id) + '">Role for ' + esc(a.username) + '</label><select class="input rolesel r-' + r + '" id="role_' + esc(a.user_id) + '" data-staff-role="' + esc(a.user_id) + '"' + (self ? ' disabled title="You cannot change your own role"' : '') + '>'
        + ['admin', 'teacher', 'accounts', 'cashier', 'viewer'].map(function (k) { return '<option value="' + k + '"' + (k === r ? ' selected' : '') + '>' + MZ.ROLES[k].name + '</option>'; }).join('') + '</select>'
        + '<button class="btn sm" type="button" data-act="staffPw" data-id="' + esc(a.user_id) + '" data-u="' + esc(a.username) + '">Reset password</button>'
        + (self ? '' : '<button class="btn sm danger" type="button" data-act="staffRemove" data-id="' + esc(a.user_id) + '">Remove</button>') + '</span></div>';
    }).join('') : '<p class="muted">No staff accounts.</p>') : '<p class="muted">' + esc(S.staffErr || 'Loading…') + '</p>';
    var roleCards = ['teacher', 'accounts', 'cashier', 'viewer', 'admin'].map(function (k, i) {
      return '<label class="rolecard r-' + k + '"><input type="radio" name="stRole" value="' + k + '"' + (i === 0 ? ' checked' : '') + '><span><b>' + MZ.ROLES[k].name + '</b><small>' + esc(MZ.ROLES[k].desc) + '</small></span></label>';
    }).join('');
    return '<section class="card settings staffcard" style="margin-top:14px;display:grid;gap:14px"><div class="stafftop"><div><p class="eyebrow">Institute accounts</p><p class="muted" style="font-size:13.5px">Give each person only what they need. The database checks every request, so a teacher can never see fees and the accounts team can never change hifz.</p></div>'
      + '<div class="rolecount">' + ['admin', 'teacher', 'accounts', 'cashier', 'viewer'].map(function (k) { return '<span class="r-' + k + '"><b class="num">' + counts[k] + '</b>' + (counts[k] === 1 ? MZ.ROLES[k].name : { admin: 'Admins', teacher: 'Teachers', accounts: 'Accounts', cashier: 'Cashiers', viewer: 'View only' }[k]) + '</span>'; }).join('') + '</div></div>'
      + '<div class="stafflist">' + list + '</div>'
      + '<form class="form" id="staffForm" autocomplete="off" style="border-top:1px solid var(--gold-line);padding-top:14px"><p style="font-weight:700">Create an account</p>'
      + '<div class="rolepick" role="radiogroup" aria-label="Role">' + roleCards + '</div>'
      + '<div class="two"><div class="field"><label for="stUser">Username</label><input id="stUser" required maxlength="30" autocapitalize="none" spellcheck="false" placeholder="e.g. teacher.ali"></div>'
      + '<div class="field"><label for="stPw">Password</label><input id="stPw" required minlength="10" placeholder="At least 10 letters and numbers" autocomplete="new-password"><span class="hint" id="stPwHint">Strong passwords: 10 or more characters, letters and numbers.</span></div></div>'
      + '<div><button class="btn gold" type="submit">' + I.plus + 'Create account</button></div></form></section>';
  }
  document.addEventListener('change', function (e) { if (e.target.id === 'stuTch') { S.stf = e.target.value; render(); } });
  document.addEventListener('change', function (e) {
    var id = e.target.dataset && e.target.dataset.staffRole; if (!id) return;
    var r = e.target.value, a = (S.staff || []).find(function (x) { return x.user_id === id; });
    api.setStaffRole(id, r).then(function () { S.staff = null; render(); MZ.toast((a ? a.username : 'Account') + ' is now ' + MZ.ROLES[r].name + '. The change applies the next time they open the portal.'); })
      .catch(function (e2) { MZ.toast(e2.message); S.staff = null; render(); });
  });
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'stPw') return; var h = $('#stPwHint'), ok = MZ.strongPw(e.target.value);
    if (h) { h.textContent = ok ? 'Strong password.' : 'Strong passwords: 10 or more characters, letters and numbers.'; h.style.color = ok ? 'var(--good)' : ''; }
  });

  /* -------------------------------------------------------- progress */
  /* Where a student stands against the month's goal page. */
  function goalInfo(s, r, month) {
    // the month's numbers, worked out the same way as the monthly report (started at → reached)
    var rows = [r].filter(Boolean).concat(sheet && sheet.kind === 'student' && sheet.data.id === s.id && sheet.data.progAll ? sheet.data.progAll.filter(function (x) { return x.month !== month; }) : []);
    var h = MZ.monthHifz(s, rows, month);
    var o = { start: h.startCount, goal: h.goalCount, reached: h.reachedCount, done: h.reachedGoal, pct: 0, toGo: h.toGo,
      goalN: h.goalN, doneN: h.done,
      from: h.startPos ? MZ.posLabel(MZ.pageSurah(h.startPos, h.dir), h.startPos, true) : '', to: h.goalPos ? MZ.posLabel(MZ.pageSurah(h.goalPos, h.dir), h.goalPos, true) : '',
      at: h.reachedPos ? MZ.posLabel(MZ.pageSurah(h.reachedPos, h.dir), h.reachedPos, true) : '' };
    if (h.goalN && h.done != null) o.pct = Math.max(0, Math.min(100, Math.round(h.done / h.goalN * 100)));
    if (o.done) { o.pct = 100; o.toGo = 0; }
    return o;
  }
  /* ---- the institute's own key rules (Discipline +5, Late −2 …) */
  function loadRules() { return api.listKeyRules().then(function (l) { S.rules = l; return l; }); }
  function activeRules() { if (!S.rules) { S.rules = []; loadRules().then(function () { render(); }).catch(function () {}); } return S.rules.filter(function (r) { return r.active; }); }
  function rulesCardHTML() {
    var rules = activeRules();
    return '<section class="card rulecard"><div><p class="eyebrow">Give keys</p><p class="muted" style="font-size:13.5px">' + (rules.length ? 'For discipline, helping others and anything else you choose. Give to one student or many at once.' : (isAdmin() ? 'Make your own key rules, like Discipline +5, under Key rules.' : 'An admin can add key rules, like Discipline +5.')) + '</p></div>'
      + '<div class="btnrow">' + (rules.length ? '<button class="btn gold" data-act="giveKeys">' + I.key + 'Give keys</button>' : '') + (isAdmin() ? '<button class="btn" data-act="goRules">' + I.gear + 'Key rules</button>' : '') + '</div></section>';
  }
  function openGiveKeys(sid) {
    var rules = activeRules();
    if (!rules.length) { MZ.toast(isAdmin() ? 'First add a key rule, e.g. Discipline +5.' : 'Ask an admin to add key rules first.'); if (isAdmin()) A.goRules(); return; }
    var act = S.students.filter(function (s) { return !s.disabled; }), one = sid ? studentById(sid) : null;
    openSheet('giveKeys', { sid: sid || null }, head('Give keys', one ? one.full_name : 'Choose students')
      + '<form class="form" id="giveKeysForm" autocomplete="off"><div class="field"><span class="flabel">What for?</span><div class="rulepick" role="radiogroup" aria-label="Key rule">'
      + rules.map(function (r, i) { return '<label class="rp' + (r.keys < 0 ? ' neg' : '') + '"><input type="radio" name="gkRule" value="' + r.id + '"' + (i === 0 ? ' checked' : '') + '><span><b class="num">' + MZ.signed(r.keys) + '</b>' + esc(r.name) + '</span></label>'; }).join('') + '</div></div>'
      + '<div class="field"><label for="gkNote">Note (optional, the student sees it)</label><input id="gkNote" maxlength="100" placeholder="e.g. Helped tidy the class"></div>'
      + (one ? '<input type="hidden" name="gkStu" value="' + esc(one.id) + '">' : '<div class="field"><span class="flabel">Students <span class="muted" id="gkCount"></span></span><div class="btnrow" style="margin-bottom:6px"><button class="btn sm" type="button" data-act="gkAll" data-v="1">Everyone</button><button class="btn sm" type="button" data-act="gkAll" data-v="0">No one</button></div>'
        + '<div class="pickgrid">' + act.map(function (s) { return '<label class="pick"><input type="checkbox" name="gkStu" value="' + esc(s.id) + '"><span><b>' + esc(s.full_name) + '</b><small>' + s.keys + ' keys</small></span></label>'; }).join('') + '</div></div>')
      + '<p class="err" id="gkErr" hidden></p><button class="btn gold block" type="submit" id="gkBtn">Give keys</button></form>');
    gkCount();
  }
  function ruleById(id) { return (S.rules || []).find(function (r) { return String(r.id) === String(id); }) || null; }
  function gkTicked() { return MZ.$$('[name=gkStu]').filter(function (i) { return i.type === 'hidden' || i.checked; }).map(function (i) { return i.value; }); }
  function gkCount() {
    var ids = gkTicked(), r = ruleById(($('input[name=gkRule]:checked') || {}).value), b = $('#gkBtn'), c = $('#gkCount');
    if (c) c.textContent = '(' + ids.length + ' ticked)';
    if (b && r) b.textContent = (r.keys < 0 ? 'Take ' + Math.abs(r.keys) + ' keys from ' : 'Give ' + r.keys + ' keys to ') + (sheet.data.sid ? MZ.firstName(studentById(sheet.data.sid).full_name) : ids.length + ' student' + (ids.length === 1 ? '' : 's'));
  }
  document.addEventListener('change', function (e) { if (sheet && sheet.kind === 'giveKeys' && (e.target.name === 'gkStu' || e.target.name === 'gkRule')) gkCount(); });
  function saveGiveKeys() {
    var ids = gkTicked(), r = ruleById(($('input[name=gkRule]:checked') || {}).value), err = $('#gkErr'), note = $('#gkNote').value.trim(), sid = sheet.data.sid;
    if (!r) { err.textContent = 'Choose what the keys are for.'; err.hidden = false; return; }
    if (!ids.length) { err.textContent = 'Tick at least one student.'; err.hidden = false; return; }
    $('#gkBtn').disabled = true;
    var before = {}; ids.forEach(function (id) { var st = studentById(id); before[id] = st ? st.keys : 0; });
    api.awardRule(ids, r.id, S.month, note).then(function (n) {
      return Promise.all([api.listStudents(), loadProgress(S.month)]).then(function (res) {
        S.students = res[0]; render();
        var unlocked = ids.filter(function (id) { var st = studentById(id); return st && MZ.rewardLevel(st.keys, S.settings) > MZ.rewardLevel(before[id], S.settings); }).length;
        MZ.toast(MZ.signed(r.keys) + ' keys · ' + r.name + ' · ' + (sid ? MZ.firstName(studentById(sid).full_name) : n + ' student' + (n === 1 ? '' : 's')) + '.' + (unlocked ? ' ' + unlocked + ' reward' + (unlocked === 1 ? '' : 's') + ' unlocked!' : ''));
        if (sid) openStudent(sid); else closeSheet();
      });
    }).catch(function (e) { err.textContent = e.message; err.hidden = false; $('#gkBtn').disabled = false; });
  }
  function rulesSettingsHTML() {
    if (!S.rules) activeRules();
    var list = S.rules || [];
    return '<section class="card settings" id="secRules" style="margin-top:14px;display:grid;gap:12px"><div><p class="eyebrow">Your own key rules</p><p class="muted" style="font-size:13.5px">Add anything you want to reward, with how many keys. Use a minus number to take keys away (e.g. Late to class −2). Students see these on their keys card. Give them from Progress → Give keys.</p></div>'
      + '<div class="rulelist">' + (list.length ? list.map(function (r) {
        return '<form class="rulerow' + (r.active ? '' : ' off') + '" data-rule="' + r.id + '" autocomplete="off"><input class="input" name="rn" maxlength="60" value="' + esc(r.name) + '" aria-label="Rule name" required><input class="input num" name="rk" type="number" min="-100" max="100" value="' + r.keys + '" aria-label="Keys" required>'
          + '<label class="rtoggle" title="Students see it and you can give it"><input type="checkbox" name="ra"' + (r.active ? ' checked' : '') + '><span>In use</span></label>'
          + '<button class="btn sm" type="submit">Save</button><button class="btn sm ghost danger" type="button" data-act="ruleDel" data-id="' + r.id + '">Delete</button></form>';
      }).join('') : '<p class="muted">No rules yet. Add one below or tap an idea.</p>') + '</div>'
      + '<form class="rulerow add" id="ruleAddForm" autocomplete="off"><input class="input" id="raName" maxlength="60" placeholder="e.g. Discipline" aria-label="New rule name" required><input class="input num" id="raKeys" type="number" min="-100" max="100" placeholder="5" aria-label="Keys" required><button class="btn gold sm" type="submit">' + I.plus + 'Add rule</button></form>'
      + '<div class="chips"><span class="muted" style="font-size:13px;align-self:center">Ideas:</span>' + [['Discipline', 5], ['Helping others', 5], ['Full attendance this month', 10], ['Best tilawat', 5], ['Cleanliness', 3], ['Homework done', 2], ['Late to class', -2]].filter(function (x) { return !list.some(function (r) { return r.name.toLowerCase() === x[0].toLowerCase(); }); }).map(function (x) {
        return '<button class="chip" type="button" data-act="ruleIdea" data-n="' + esc(x[0]) + '" data-k="' + x[1] + '">' + esc(x[0]) + ' ' + MZ.signed(x[1]) + '</button>';
      }).join('') + '</div></section>';
  }
  function saveRule(r, okMsg) {
    return api.saveKeyRule(r).then(function () { return loadRules(); }).then(function () { render(); MZ.toast(okMsg); }).catch(function (e) { MZ.toast(e.message); });
  }
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.id === 'ruleAddForm') { e.preventDefault(); var n = $('#raName').value.trim(), k = parseInt($('#raKeys').value, 10); if (!k) { MZ.toast('Keys cannot be 0.'); return; } saveRule({ name: n, keys: k, active: true }, 'Rule added: ' + n + ' ' + MZ.signed(k) + '.'); }
    else if (f.dataset && f.dataset.rule) { e.preventDefault(); var k2 = parseInt(f.rk.value, 10); if (!k2) { MZ.toast('Keys cannot be 0.'); return; } saveRule({ id: +f.dataset.rule || f.dataset.rule, name: f.rn.value, keys: k2, active: f.ra.checked }, 'Rule saved.'); }
    else if (f.id === 'giveKeysForm') { e.preventDefault(); saveGiveKeys(); }
  }, true);
  /* ---- Ikhtibar tab: every ikhtibar, reschedule or cancel */
  function renderIkhTab() {
    if (!S.ikh) loadIkh().then(function () { if (S.tab === 'ikhtibar') render(); }).catch(function (e) { S.ikh = []; MZ.toast(e.message); });
    var today = MZ.today(), f = S.ikf || 'upcoming', q = (S.ikq || '').trim().toLowerCase();
    var h = '<div class="pagehead"><div><h1>Ikhtibar</h1><p class="stat">Every ikhtibar you have scheduled. Reschedule or cancel here; students see the change straight away.</p></div>'
      + '<div class="btnrow"><button class="btn gold" data-act="ikhNew">' + I.plus + 'Schedule ikhtibar</button></div></div>';
    h += ikhAheadCardHTML();
    if (!S.ikh) return h + '<p class="muted" style="margin-top:14px">Loading…</p>';
    var groups = ikhGroups(null).map(function (g) {
      var c = { scheduled: 0, cleared: 0, not_cleared: 0, cancelled: 0 }; g.rows.forEach(function (x) { c[x.status]++; });
      g.c = c; g.state = c.scheduled ? (g.date < today ? 'result' : g.date === today ? 'today' : 'upcoming') : (c.cleared || c.not_cleared) ? 'done' : 'cancelled';
      return g;
    });
    var FILTERS = [['upcoming', 'Upcoming', function (g) { return g.state === 'upcoming' || g.state === 'today'; }], ['result', 'Result needed', function (g) { return g.state === 'result' || g.state === 'today'; }],
      ['done', 'Done', function (g) { return g.state === 'done'; }], ['cancelled', 'Cancelled', function (g) { return g.state === 'cancelled'; }], ['all', 'All', function () { return true; }]];
    var fn = FILTERS.filter(function (x) { return x[0] === f; })[0][2];
    var shown = groups.filter(fn).filter(function (g) { return !q || (g.title + ' ' + g.rows.map(function (x) { var st = studentById(x.student_id); return st ? st.full_name : ''; }).join(' ')).toLowerCase().indexOf(q) >= 0; });
    shown.sort(function (a, b) { var up = f === 'upcoming' || f === 'result'; return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * (up ? 1 : -1); });
    h += '<div class="toolbar"><div class="chips" role="group" aria-label="Show">' + FILTERS.map(function (x) {
      return '<button class="chip" type="button" data-act="ikf" data-f="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + '<b>' + groups.filter(x[2]).length + '</b></button>';
    }).join('') + '</div><span class="spacer"></span><label class="search"><span class="sr">Search</span><input id="ikQ" type="search" placeholder="Search student or title" value="' + esc(S.ikq || '') + '" autocomplete="off"></label></div>';
    if (!shown.length) return h + '<div class="empty"><p>' + (groups.length ? 'Nothing here.' : 'No ikhtibar yet. Tap Schedule ikhtibar to add one.') + '</p></div>';
    return h + '<div class="iktab">' + shown.map(function (g) {
      var names = g.rows.filter(function (x) { return x.status !== 'cancelled' || g.state === 'cancelled'; }).map(function (x) { var st = studentById(x.student_id); return st ? MZ.firstName(st.full_name) : ''; });
      var dt = new Date(g.date + 'T12:00:00');
      return '<article class="card ikbig ' + g.state + '"><div class="ikbig-date"><b class="num">' + dt.getDate() + '</b><small>' + esc(MZ.monthShort(g.date.slice(0, 7))) + '</small><span>' + esc(dt.toLocaleDateString('en-GB', { weekday: 'short' })) + '</span></div>'
        + '<div class="ikbig-main"><h3>' + esc(g.title) + '</h3><p class="muted">' + esc(MZ.dateLabel(g.date)) + ' · ' + (g.state === 'upcoming' ? daysTo(g.date) : g.state === 'today' ? 'Today' : g.state === 'result' ? 'Result needed' : g.state === 'done' ? 'Done' : 'Cancelled') + '</p>'
        + '<p class="iknames">' + esc(names.slice(0, 8).join(', ')) + (names.length > 8 ? ' +' + (names.length - 8) + ' more' : '') + '</p>'
        + '<div class="ikcounts" style="justify-content:flex-start">' + (g.c.scheduled ? '<span class="pill ' + (g.state === 'upcoming' ? 'plain' : 'warn') + '">' + g.c.scheduled + ' waiting</span>' : '') + (g.c.cleared ? '<span class="pill good">' + g.c.cleared + ' cleared</span>' : '') + (g.c.not_cleared ? '<span class="pill bad">' + g.c.not_cleared + ' not cleared</span>' : '') + (g.c.cancelled ? '<span class="pill plain">' + g.c.cancelled + ' cancelled</span>' : '') + '</div></div>'
        + '<div class="btnrow ikbig-act"><button class="btn sm' + (g.state === 'result' || g.state === 'today' ? ' gold' : '') + '" data-act="ikhGroup" data-key="' + esc(g.key) + '">' + (g.c.scheduled && g.date <= today ? 'Mark results' : 'Students') + '</button>'
        + (g.c.scheduled ? '<button class="btn sm" data-act="ikhMove" data-key="' + esc(g.key) + '">Reschedule</button><button class="btn sm danger" data-act="ikhCancelAll" data-key="' + esc(g.key) + '">Cancel</button>' : '')
        + (g.state === 'cancelled' ? '<button class="btn sm" data-act="ikhRestoreAll" data-key="' + esc(g.key) + '">Restore</button>' : '') + '</div></article>';
    }).join('') + '</div>';
  }
  function groupByKey(key) { return ikhGroups(null).find(function (x) { return x.key === key; }) || null; }
  function openIkhMove(key) {
    var g = groupByKey(key); if (!g) return;
    var wait = g.rows.filter(function (x) { return x.status === 'scheduled'; });
    openSheet('ikhMove', { key: key }, head('Reschedule', g.title)
      + '<form class="form" id="ikhMoveForm2" autocomplete="off"><p class="muted">Moves the ikhtibar for the ' + wait.length + ' student' + (wait.length === 1 ? '' : 's') + ' still waiting. Students who already have a result keep it.</p>'
      + '<div class="two"><div class="field"><label for="mvDate">New date</label><input id="mvDate" type="date" required value="' + esc(g.date) + '"></div><div class="field"><label for="mvTitle">What it covers</label><input id="mvTitle" maxlength="80" value="' + esc(g.title) + '"></div></div>'
      + '<div class="field"><label for="mvNote">Note for students (optional)</label><input id="mvNote" maxlength="200" placeholder="e.g. Moved because of the holiday"></div>'
      + '<p class="err" id="mvErr" hidden></p><button class="btn gold block" type="submit" id="mvBtn">Save new date</button></form>');
    var d = $('#mvDate'); if (d) d.focus();
  }
  function saveIkhMove() {
    var g = groupByKey(sheet.data.key), nd = $('#mvDate').value, nt = $('#mvTitle').value.trim() || 'Ikhtibar', note = $('#mvNote').value.trim(), err = $('#mvErr');
    if (!g || !nd) return;
    var wait = g.rows.filter(function (x) { return x.status === 'scheduled'; });
    if (!wait.length) { err.textContent = 'Everyone already has a result.'; err.hidden = false; return; }
    $('#mvBtn').disabled = true;
    Promise.all(wait.map(function (x) { return api.updateIkhtibar(x.id, { exam_date: nd, title: nt, note: note || x.note }); })).then(function () {
      closeSheet(); MZ.toast('Moved to ' + MZ.dateLabel(nd) + ' for ' + wait.length + ' student' + (wait.length === 1 ? '' : 's') + '. They can see the new date now.'); return afterIkhChange();
    }).catch(function (e) { err.textContent = e.message; err.hidden = false; $('#mvBtn').disabled = false; });
  }
  function ikhSetAll(key, from, to, t, msg) {
    var g = groupByKey(key); if (!g) return;
    var rows = g.rows.filter(function (x) { return x.status === from; }); if (!rows.length) return;
    t.disabled = true; var i = 0;
    (function next() {
      if (i >= rows.length) { MZ.toast(msg(rows.length)); afterIkhChange(); return; }
      api.ikhtibarResult(rows[i++].id, to).then(next, function (e) { MZ.toast(e.message); afterIkhChange(); });
    })();
  }

  /* ---- report cards (print or save as PDF) */
  function openReportCards(onlySid) {
    var act = S.students.filter(function (s) { return !s.disabled; });
    openSheet('reportCards', { sid: onlySid || null }, head('Report cards', onlySid ? studentById(onlySid).full_name : 'Print or save as PDF')
      + '<form class="form" id="rcForm" autocomplete="off"><div class="field"><label for="rcMonth">Month</label><input id="rcMonth" type="month" required value="' + esc(onlySid && sheet && sheet.data.rpMonth ? sheet.data.rpMonth : S.month) + '"></div>'
      + (onlySid ? '<input type="hidden" name="rcStu" value="' + esc(onlySid) + '">' : '<div class="field"><span class="flabel">Students <span class="muted" id="rcCount"></span></span><div class="btnrow" style="margin-bottom:6px"><button class="btn sm" type="button" data-act="rcAll" data-v="1">Everyone</button><button class="btn sm" type="button" data-act="rcAll" data-v="0">No one</button></div>'
        + '<div class="pickgrid">' + act.map(function (s) { return '<label class="pick"><input type="checkbox" name="rcStu" value="' + esc(s.id) + '" checked><span><b>' + esc(s.full_name) + '</b><small class="mono">' + esc(idLine(s)) + '</small></span></label>'; }).join('') + '</div></div>')
      + '<p class="muted" style="font-size:13.5px">One A4 page per student: pages and goal, the teacher’s report, ikhtibar, keys and fees. In the print window choose <b>Save as PDF</b> to get a file, or print on paper.</p>'
      + '<p class="err" id="rcErr" hidden></p><button class="btn gold block" type="submit" id="rcBtn">' + I.doc + 'Make report cards</button></form>');
  }
  function makeReportCards() {
    var month = $('#rcMonth').value, ids = MZ.$$('[name=rcStu]').filter(function (i) { return i.type === 'hidden' || i.checked; }).map(function (i) { return i.value; }), btn = $('#rcBtn'), err = $('#rcErr');
    if (!/^\d{4}-\d{2}$/.test(month)) { err.textContent = 'Choose the month.'; err.hidden = false; return; }
    if (!ids.length) { err.textContent = 'Tick at least one student.'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Preparing ' + ids.length + ' report card' + (ids.length === 1 ? '' : 's') + '…'; err.hidden = true;
    Promise.all([api.listProgress({}), api.listKeyEventsMonth(month), api.listPayments({}), S.ikh ? Promise.resolve(S.ikh) : loadIkh(), api.listStudents()]).then(function (r) {
      var prog = r[0], ev = r[1], pays = r[2], ikh = r[3]; S.students = r[4];
      var earned = {}; ev.forEach(function (e) { if (e.keys > 0) earned[e.student_id] = (earned[e.student_id] || 0) + e.keys; });
      var order = Object.keys(earned).sort(function (a, b) { return earned[b] - earned[a]; }), rank = {};
      order.forEach(function (id, i) { rank[id] = i > 0 && earned[order[i - 1]] === earned[id] ? rank[order[i - 1]] : i + 1; });
      var html = ids.map(studentById).filter(Boolean).sort(function (a, b) { return a.full_name.localeCompare(b.full_name); }).map(function (s) {
        return MZ.reportCardHTML({ settings: S.settings, s: s, month: month, prog: prog.filter(function (x) { return x.student_id === s.id; }),
          events: ev.filter(function (e) { return e.student_id === s.id; }), pays: pays.filter(function (p) { return p.student_id === s.id; }), ikh: ikh.filter(function (x) { return x.student_id === s.id; }), rank: rank[s.id], noFees: !can('fees') });
      }).join('');
      var back = sheet && sheet.data.sid; if (back) openStudent(back, true); else closeSheet();
      MZ.printHTML(html, (ids.length === 1 ? studentById(ids[0]).full_name + ' ' : 'Report cards ') + MZ.monthLabel(month));
    }).catch(function (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; btn.innerHTML = I.doc + 'Make report cards'; });
  }

  /* ---- hifz certificates */
  function certSectionHTML(s) {
    var n = MZ.juzDone(s.pages);
    return '<section id="secCert"><h3>Hifz certificates</h3><div class="panel form">'
      + (n ? '<p class="muted" style="font-size:13.5px">' + esc(MZ.firstName(s.full_name)) + ' has memorised ' + (n === 30 ? 'the whole Qur’an.' : (n === 1 ? 'one juz' : n + ' ajza') + ' (' + s.pages + ' of 604 pages). Next certificate at ' + MZ.juzEnd(n + 1) + ' pages (' + (n + 1) + ' ajza).') + ' Tap one to print it.</p>'
        + '<div class="certchips">' + Array.apply(null, Array(n)).map(function (_, i) { var j = i + 1; return '<button class="certchip' + (j === 30 ? ' all' : '') + '" type="button" data-act="cert" data-sid="' + esc(s.id) + '" data-j="' + j + '">' + (j === 30 && s.pages >= 604 ? '★ Whole Qur’an' : j + (j === 1 ? ' juz' : ' ajza')) + '</button>'; }).join('') + '</div>'
        + '<div class="btnrow"><button class="btn sm" type="button" data-act="certLatest" data-sid="' + esc(s.id) + '">' + I.gift + 'Print latest certificate</button>' + (n > 1 ? '<button class="btn sm ghost" type="button" data-act="certAll" data-sid="' + esc(s.id) + '">Print all ' + n + '</button>' : '') + '</div>'
        : '<p class="muted" style="font-size:13.5px">The first certificate is ready when ' + esc(MZ.firstName(s.full_name)) + ' has memorised ' + MZ.juzEnd(1) + ' pages (one juz). ' + (s.pages ? (MZ.juzEnd(1) - s.pages) + ' pages to go.' : '') + '</p>')
      + '</div></section>';
  }
  function printCerts(sid, list) {
    var s = studentById(sid); if (!s || !list.length) return;
    var rows = (sheet && sheet.kind === 'student' && sheet.data.id === sid && sheet.data.progAll) || [];
    var go = function (rows) {
      MZ.printHTML(list.map(function (j) { return MZ.certificateHTML({ settings: S.settings, s: s, juz: j, all: j === 30 && s.pages >= 604, month: MZ.juzMonth(rows, j) }); }).join(''),
        s.full_name + (list.length === 1 ? (list[0] === 30 ? ' Hifz al-Quran' : ' ' + list[0] + ' ajza') : ' certificates'));
    };
    if (rows.length) go(rows); else api.listProgress({ studentId: sid }).then(go).catch(function () { go([]); });
  }
  /* Tell the teacher when a student has just finished a juz. */
  function juzToast(sid, before, after) {
    var a = MZ.juzDone(before), b = MZ.juzDone(after); if (b <= a) return;
    var st = studentById(sid); if (!st) return;
    setTimeout(function () {
      MZ.toast(b === 30 ? MZ.firstName(st.full_name) + ' has completed the whole Qur’an!' : MZ.firstName(st.full_name) + ' has now memorised ' + (b === 1 ? 'one juz' : b + ' ajza') + '.', { label: 'Certificate', fn: function () { printCerts(sid, [b]); } });
    }, 600);
  }
  function progOf(sid) { return S.prog[sid] || { goal: 0, jadeed: 0, ikhtibar: 0, goal_awarded: false }; }
  function rewardsDue(s) { return Math.max(0, MZ.rewardLevel(s.keys, S.settings) - (s.rewards_given || 0)); }
  function keyLegend() {
    var st = S.settings;
    return '<div class="legendkeys"><span class="kchip">' + I.key + '+' + st.keys_jadeed + ' jadeed page</span><span class="kchip">' + I.key + '+' + st.keys_ikhtibar + ' ikhtibar</span><span class="kchip">' + I.key + '+' + st.keys_goal + ' monthly goal</span><span class="kchip">' + I.gift + 'Reward every ' + st.reward_every + '</span>' + activeRules().map(function (r) { return '<span class="kchip' + (r.keys < 0 ? ' neg' : '') + '">' + I.key + MZ.signed(r.keys) + ' ' + esc(r.name) + '</span>'; }).join('') + '</div>';
  }
  function renderProgress() {
    var month = S.month, loaded = S.progMonth === month, q = S.pq.trim().toLowerCase();
    var rows = S.students.filter(function (s) { return !s.disabled; }).map(function (s) { return { s: s, r: progOf(s.id) }; });
    var tJ = 0, tI = 0, tG = 0, tR = 0;
    rows.forEach(function (x) { tJ += x.r.jadeed; tI += x.r.ikhtibar; if (x.r.goal_awarded) tG++; if (rewardsDue(x.s)) tR++; });
    var shown = rows.filter(function (x) {
      if (S.pfilter === 'reward' && !rewardsDue(x.s)) return false;
      if (S.pfilter === 'goal' && !x.r.goal_awarded) return false;
      if (S.pfilter === 'behind' && (x.r.goal_awarded || !x.r.goal || MZ.onLeave(x.s, month))) return false;
      return !q || (x.s.full_name + ' ' + x.s.username + ' ' + x.s.its_no + ' ' + x.s.admission_no).toLowerCase().indexOf(q) >= 0;
    });
    var commonGoal = (function () { var c = {}; rows.forEach(function (x) { if (x.r.goal) c[x.r.goal] = (c[x.r.goal] || 0) + 1; }); var b = '', n = 0; for (var k in c) if (c[k] > n) { n = c[k]; b = k; } return b; })();
    var h = '<div class="pagehead"><div class="monthnav"><button class="iconbtn" data-act="prevMonth" aria-label="Previous month">' + I.left + '</button><h1>' + esc(MZ.monthLabel(month)) + '</h1><button class="iconbtn" data-act="nextMonth" aria-label="Next month">' + I.right + '</button></div>'
      + '<div class="btnrow">' + (month !== MZ.thisMonth() ? '<button class="btn sm" data-act="thisMonth">This month</button>' : '') + '<button class="btn" data-act="rcMany">' + I.doc + 'Report cards (PDF)</button></div></div>';
    h += '<div class="summary"><form class="card goalcard" id="goalAllForm" autocomplete="off"><div style="min-width:0;flex:1 1 220px"><p class="eyebrow">Monthly goal · ' + esc(MZ.monthLabel(month)) + '</p><p class="muted" style="font-size:13.5px;margin-top:4px">How many pages each student should memorise this month. Set one student\'s own goal under their <b>Goal</b>. Then just type each student\'s current page and tap <b>Add pages</b>. Reaching it gives +' + S.settings.keys_goal + ' keys automatically.</p></div>'
      + '<div class="field"><label for="goalAll">Pages to memorise, everyone</label><input id="goalAll" type="number" min="0" max="604" required value="' + esc(commonGoal) + '" placeholder="e.g. 10"' + (pastLocked(month) ? ' disabled' : '') + '></div><button class="btn gold" type="submit"' + (pastLocked(month) ? ' disabled title="' + esc(LOCK_PAST) + '"' : '') + '>' + (pastLocked(month) ? I.lock : '') + 'Set for all</button></form>'
      + '<div class="counts"><div class="count paid"><b class="num">' + tJ + '</b><span>Jadeed pages</span></div><div class="count" style="background:var(--gold-soft);color:var(--gold-dark)"><b class="num">' + tR + '</b><span>Rewards to give</span></div></div></div>';
    h += '<div class="toolbar"><div class="chips" role="group" aria-label="Filter">'
      + [['all', 'All', rows.length], ['behind', 'Goal not reached', rows.filter(function (x) { return x.r.goal && !x.r.goal_awarded; }).length], ['goal', 'Goal reached', tG], ['reward', 'Reward due', tR]].map(function (c) {
        return '<button class="chip" type="button" data-act="pfilter" data-f="' + c[0] + '" aria-pressed="' + (S.pfilter === c[0]) + '">' + c[1] + '<b>' + c[2] + '</b></button>';
      }).join('') + '</div><span class="spacer"></span><label class="search"><span class="sr">Search students</span><input id="progQ" type="search" placeholder="Search students" value="' + esc(S.pq) + '" autocomplete="off"></label></div>';
    h += ikhCardHTML(month) + rulesCardHTML();
    h += '<div style="margin-top:10px">' + keyLegend() + '</div>';
    if (!S.students.length) return h + '<div class="empty"><p>Add students first.</p></div>';
    if (!loaded) return h + '<p class="muted" style="margin-top:14px">Loading…</p>';
    if (!shown.length) return h + '<div class="empty"><p>No students match.</p></div>';
    h += '<div class="list">' + shown.map(function (x) {
      var s = x.s, r = x.r, due = rewardsDue(s), g = goalInfo(s, S.prog[s.id], month), nextR = S.settings.reward_every - (s.keys % S.settings.reward_every);
      var away = MZ.onLeave(s, month), ik = MZ.ikhAhead(s, S.settings, [S.prog[s.id]].filter(Boolean));
      return '<article class="prow' + (away ? ' leave' : '') + '"><button class="person" data-act="student" data-id="' + esc(s.id) + '"><span class="av">' + esc(MZ.initials(s.full_name)) + '</span><span class="pname"><b>' + esc(s.full_name) + (away ? ' <span class="pill leave"><i></i>On leave</span>' : '') + (ik ? ' <span class="pill ikahead" title="Ikhtibar at page ' + ik.page + '">' + I.flag + (ik.away ? 'Ikhtibar p.' + ik.page + ' in ' + ik.away + ' page' + (ik.away === 1 ? '' : 's') : 'Ikhtibar page ' + ik.page + ' now') + '</span>' : '') + '</b><small class="mono">' + esc(idLine(s)) + '</small></span></button>'
        + '<div class="mini q"><b class="num">' + s.pages + ' <span class="muted" style="font-weight:500">/ 604 memorised</span></b><div class="mbar"><i style="width:' + (s.pages / 6.04).toFixed(1) + '%"></i></div><small>' + (s.cur_surah || s.cur_pos ? 'Now at ' + esc(MZ.posLabel(s.cur_surah, s.cur_pos, true)) : MZ.juzDone(s.pages) + ' ajza') + '</small></div>'
        + '<div class="mini m"><b class="num">' + (g.goal ? (g.doneN == null ? '?' : g.doneN) + ' <span class="muted" style="font-weight:500">of ' + g.goalN + ' pages this month</span>' : 'Jadeed ' + r.jadeed) + '</b><div class="mbar' + (g.done ? ' goal' : '') + '"><i style="width:' + g.pct + '%"></i></div><small>' + (g.done ? 'Goal reached' : g.goal ? (g.toGo == null ? 'Page reached not entered' : g.toGo + ' page' + (g.toGo === 1 ? '' : 's') + ' to go') : 'No goal set') + (r.jadeed && g.goal ? ' · Jadeed ' + r.jadeed : '') + (r.ikhtibar ? ' · Ikhtibar ' + r.ikhtibar : '') + '</small></div>'
        + '<div class="keysum"><b class="num">' + I.key + s.keys + '</b>' + MZ.masteryChip(s.keys, { short: 1 }) + (due ? '<span class="pill warn">' + I.gift.replace('width="20" height="20"', 'width="14" height="14"') + (due > 1 ? due + ' rewards due' : 'Reward due') + '</span>' : '<small class="muted" style="font-size:12px">' + nextR + ' to next reward</small>') + '</div>'
        + '<div class="pact">' + (can('teach') ? (s.hifz_dir ? '<form class="qadd" data-sid="' + esc(s.id) + '" autocomplete="off"><input class="input num" type="number" min="1" max="604" inputmode="numeric" placeholder="Page no." aria-label="Current page for ' + esc(s.full_name) + '" required><button class="btn sm gold" type="submit" title="Add New Memorized Pages">' + I.plus + 'Add pages</button></form>' : '<button class="btn sm" data-act="student" data-id="' + esc(s.id) + '">Set direction</button>') : '') + '<button class="btn sm" data-act="jadeed" data-sid="' + esc(s.id) + '"' + (pastLocked(month) ? ' disabled title="' + esc(LOCK_PAST) + '"' : '') + '>+1 Jadeed</button><button class="btn sm" data-act="ikhtibar" data-sid="' + esc(s.id) + '">Ikhtibar ✓</button><button class="btn sm" data-act="report" data-sid="' + esc(s.id) + '">Report</button><button class="btn sm" data-act="giveKeys" data-sid="' + esc(s.id) + '">' + I.key + 'Keys</button></div></article>';
    }).join('') + '</div>';
    return h;
  }
  /* Records jadeed/ikhtibar, then tells the teacher what happened. */
  function progressAction(kind, sid, pages) {
    var st = studentById(sid), before = st ? st.keys : 0;
    var job = kind === 'jadeed' ? api.recordJadeed(sid, S.month, pages || 1) : api.recordIkhtibar(sid, S.month), pBefore = st ? st.pages : 0;
    return job.then(function (res) {
      if (kind === 'jadeed' && res.pages != null) juzToast(sid, pBefore, res.pages);
      var name = MZ.firstName(st.full_name), gained = (res.keys || 0) - before;
      var msg = kind === 'jadeed' ? name + ': ' + (pages > 1 ? pages + ' jadeed pages' : 'jadeed page') + ' cleared, +' + gained + ' keys.' : name + ': ikhtibar cleared, +' + gained + ' keys.';
      if (res.goal_reached) msg = name + ' reached the monthly goal! +' + gained + ' keys in total.';
      if (MZ.rewardLevel(res.keys, S.settings) > MZ.rewardLevel(before, S.settings)) msg += ' Reward unlocked at ' + (MZ.rewardLevel(res.keys, S.settings) * S.settings.reward_every) + ' keys.';
      MZ.toast(msg, { label: 'Undo', fn: function () { api.undoKeyEvent(res.event_id).then(function () { return refreshProgressFor(sid); }).then(function () { MZ.toast('Undone.'); }).catch(function (e) { MZ.toast(e.message); }); } });
      return res;
    });
  }
  function refreshProgressFor(sid) {
    return Promise.all([api.listStudents(), loadProgress(S.month)]).then(function (r) {
      S.students = r[0]; render();
      if (sheet && sheet.kind === 'student' && sheet.data.id === sid) openStudent(sid, true);
    });
  }
  function progressSection(s) {
    var r = progOf(s.id), due = rewardsDue(s), lvl = MZ.rewardLevel(s.keys, S.settings), every = S.settings.reward_every;
    return goalSectionHTML(s) + '<section><h3>Hifz &amp; keys · ' + esc(MZ.monthLabel(S.month)) + '</h3><div class="panel form">'
      + '<div class="stats" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">'
      + '<div class="count" style="background:var(--gold-soft);color:var(--gold-dark)"><b class="num">' + s.pages + '</b><span>of 604 pages memorised' + (s.cur_pos ? ' · now at p.' + s.cur_pos : '') + '</span></div>'
      + '<div class="count" style="background:var(--gold-soft);color:var(--gold-dark)"><b class="num">' + s.keys + '</b><span>keys</span></div>'
      + (function () { var g = goalInfo(s, S.prog[s.id], S.month); return '<div class="count ' + (g.done ? 'paid' : '') + '" style="' + (g.done ? '' : 'background:var(--gold-soft);color:var(--gold-dark)') + '"><b class="num">' + (g.goal ? (g.done ? '✓' : g.toGo == null ? g.goalN : g.toGo) : '–') + '</b><span>' + (g.done ? 'monthly goal reached' : g.goal ? (g.toGo == null ? 'pages to memorise' : 'pages to go of ' + g.goalN) : 'no goal yet') + '</span></div>'; })() + '</div>'
      + '<div class="mbar"><i style="width:' + (s.pages / 6.04).toFixed(1) + '%"></i></div>'
      + ikhAlertHTML(s, [S.prog[s.id]].filter(Boolean)) + predictHTML(s, goalInfo(s, S.prog[s.id], S.month).goalN)
      + (pastLocked(S.month) ? '<div class="btnrow"><button class="btn" type="button" disabled title="' + esc(LOCK_PAST) + '">' + I.lock + '+1 Jadeed page</button><button class="btn" type="button" disabled title="' + esc(LOCK_PAST) + '">' + I.lock + 'Add pages</button>'
        : '<div class="btnrow"><button class="btn gold" type="button" data-act="jadeed" data-sid="' + esc(s.id) + '">+1 Jadeed page</button>'
      + '<form id="sJadeedForm" class="inline2"><input id="sJadeedN" class="input" type="number" min="1" max="100" placeholder="Pages" aria-label="Number of jadeed pages"><button class="btn" type="submit">Add pages</button></form>')
      + '<button class="btn" type="button" data-act="ikhtibar" data-sid="' + esc(s.id) + '">Ikhtibar cleared</button><button class="btn" type="button" data-act="giveKeys" data-sid="' + esc(s.id) + '">' + I.key + 'Give keys</button></div>'
      + (due ? '<div class="okmsg" style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;background:var(--warn-bg);color:var(--warn)"><span>' + (due > 1 ? due + ' rewards' : 'A reward') + ' unlocked (' + (lvl * every) + ' keys). Give it, then mark it here.</span><button class="btn sm" type="button" data-act="giveReward" data-sid="' + esc(s.id) + '">Reward given</button></div>'
        : '<p class="muted" style="font-size:13px">' + (every - s.keys % every) + ' keys to the next reward. Rewards given so far: ' + (s.rewards_given || 0) + '.</p>')
      + '<div><p style="font-weight:700;margin-bottom:4px">Recent keys</p><div id="sKeys"><p class="muted">Loading…</p></div></div>'
      + '</div></section>'
      + '<section id="secReport"><h3>Monthly goal &amp; report</h3><div id="sReport" class="panel form"><p class="muted">Loading…</p></div></section>'
      + '<section id="secIkh"><h3>Ikhtibar</h3><div class="panel form"><div id="sIkh"><p class="muted">Loading…</p></div>'
      + '<form id="sIkhForm" class="ikhform" autocomplete="off"><div class="field"><label for="sIkhDate">Date</label><input id="sIkhDate" type="date" required value="' + esc(defaultIkhDate()) + '"></div>'
      + '<div class="field" style="flex:2 1 160px"><label for="sIkhTitle">What it covers</label><input id="sIkhTitle" maxlength="80" placeholder="e.g. Juz 15, or last 5 pages"></div><button class="btn" type="submit">' + I.plus + 'Schedule</button></form>'
      + '<p class="hint" style="margin-top:-4px">' + esc(MZ.firstName(s.full_name)) + ' sees the date on their Home page. Mark it Cleared on the day for +' + S.settings.keys_ikhtibar + ' keys.</p></div></section>'
      + certSectionHTML(s) + badgesSection(s);
  }
  /* ================= STUDENT ATTENDANCE: teachers mark it, the admin sees every mark live, printable ================= */
  var ATT = [['present', 'Present', 'P'], ['late', 'Late', 'L'], ['absent', 'Absent', 'A'], ['excused', 'Excused', 'E']];
  var ATT_NAME = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused' };
  S.att = { date: null, view: 'day', month: null, data: {}, keys: {}, lessons: {}, filter: 'all', q: '', saving: {}, editNote: null, liveAt: null, timer: null, unwatch: null };
  function attToday() { return MZ.today(); }
  function attCanEdit(d) {
    if (isViewer() || !can('teach')) return false;
    if (d > attToday()) return false;
    return isAdmin() || d >= isoAdd(attToday(), -7);
  }
  function attStudents() { return (S.students || []).filter(function (s) { return !s.disabled; }).slice().sort(function (a, b) { return a.full_name.localeCompare(b.full_name); }); }
  function attTeacherOf(s) {
    var id = (s.teacher_ids || [])[0]; if (id == null) return '';
    var h = S.hr && hrById(id); if (h) return h.data.full_name || '';
    var t = (S.schTeachers || []).find(function (x) { return String(x.id) === String(id); }); return t ? t.full_name : '';
  }
  // marks for a date range, kept by date then student
  function attLoad(from, to, quiet) {
    var key = from + '|' + to;
    if (S.att.loading === key) return;
    S.att.loading = key;
    if (!S.schTeachers && api.scheduleTeachers) api.scheduleTeachers().then(function (l) { S.schTeachers = l; if (S.tab === 'attendance') attRender(); }).catch(function () { S.schTeachers = []; });
    return api.listAttendance(from, to).then(function (rows) {
      S.att.loading = null;
      var by = {}, d;
      for (d = from; d <= to; d = isoAdd(d, 1)) by[d] = {};
      (rows || []).forEach(function (r) { (by[r.att_date] = by[r.att_date] || {})[r.student_id] = r; });
      var changed = false;
      Object.keys(by).forEach(function (k) { var a = JSON.stringify(by[k]), b = JSON.stringify(S.att.data[k] || null); if (a !== b) { changed = true; S.att.data[k] = by[k]; } });
      S.att.keys[key] = 1; S.att.liveAt = new Date(); S.att.err = null;
      if (S.tab === 'attendance' && (changed || !quiet)) attRender();
      else if (S.tab === 'attendance') { var lv = $('#attLive'); if (lv) lv.innerHTML = attLiveText(); }
    }).catch(function (e) {
      S.att.loading = null; S.att.err = /student_attendance|mark_attendance|relation|function/i.test(e.message) ? 'Attendance needs the latest database update (sql-nov16b.sql).' : e.message;
      if (S.tab === 'attendance') attRender();
    });
  }
  function attRange() {
    if (S.att.view === 'month') { var m = S.att.month || MZ.thisMonth(), y = +m.slice(0, 4), mo = +m.slice(5, 7), last = new Date(y, mo, 0).getDate(); return { from: m + '-01', to: m + '-' + MZ.pad(last) }; }
    return { from: S.att.date, to: S.att.date };
  }
  function attLiveText() { return '<i class="livedot"></i>Live' + (S.att.liveAt ? ' · updated ' + MZ.pad(S.att.liveAt.getHours()) + ':' + MZ.pad(S.att.liveAt.getMinutes()) + ':' + MZ.pad(S.att.liveAt.getSeconds()) : ''); }
  // live: database changes arrive at once; a quiet check every 20 seconds as well, in case the live link drops
  function attStartLive() {
    if (!S.att.unwatch && api.watchAttendance) S.att.unwatch = api.watchAttendance(function () { var r = attRange(); attLoad(r.from, r.to, true); });
    if (!S.att.timer) S.att.timer = setInterval(function () {
      if (S.tab !== 'attendance' || document.visibilityState !== 'visible') return;
      var a = document.activeElement; if (a && a.closest && a.closest('.attnote')) return;   // never redraw under someone typing a note
      var r = attRange(); attLoad(r.from, r.to, true);
    }, 20000);
  }
  function attRender() { if (S.tab === 'attendance' && !sheet) { var y = window.scrollY; render(); window.scrollTo(0, y); } }
  function attCounts(d, list) {
    var m = S.att.data[d] || {}, c = { present: 0, late: 0, absent: 0, excused: 0, none: 0 };
    list.forEach(function (s) { var r = m[s.id]; c[r ? r.status : 'none']++; });
    return c;
  }
  function renderStuAtt() {
    var A = S.att; if (!A.date) A.date = attToday(); if (!A.month) A.month = A.date.slice(0, 7);
    attStartLive();
    var r = attRange(); if (!A.keys[r.from + '|' + r.to] && !A.err) attLoad(r.from, r.to);
    var admin = isAdmin(), h = '<div class="pagehead"><div><p class="eyebrow">Attendance</p><h1>Student attendance</h1><p class="stat">'
      + (admin ? 'Every teacher’s marks appear here live, as they are taken. You can also mark or correct any day.' : 'Tap a mark for each student. It is saved at once, and the admin sees it live.') + '</p></div>'
      + '<div class="btnrow"><div class="seg" role="group" aria-label="View"><button class="chip" data-act="saView" data-v="day" aria-pressed="' + (A.view === 'day') + '">Day</button><button class="chip" data-act="saView" data-v="month" aria-pressed="' + (A.view === 'month') + '">Month register</button></div>'
      + '<button class="btn" data-act="saPrint">' + I.doc + 'Print</button></div></div>';
    if (A.err) return h + '<div class="empty"><h3>Could not load attendance</h3><p>' + esc(A.err) + '</p><button class="btn gold" data-act="saRetry">Try again</button></div>';
    return h + (A.view === 'month' ? attMonthHTML() : attDayHTML());
  }
  function attDayHTML() {
    var A = S.att, d = A.date, list = attStudents(), m = A.data[d], edit = attCanEdit(d), c = m ? attCounts(d, list) : null, total = list.length;
    var h = '<div class="attbar"><div class="attdate"><button class="iconbtn" data-act="saDay" data-n="-1" aria-label="Previous day">‹</button>'
      + '<label class="attpick"><span class="sr">Day</span><input type="date" id="saDate" value="' + esc(d) + '" max="' + attToday() + '"' + (!isAdmin() ? ' min="' + isoAdd(attToday(), -7) + '"' : '') + '></label>'
      + '<button class="iconbtn" data-act="saDay" data-n="1" aria-label="Next day"' + (d >= attToday() ? ' disabled' : '') + '>›</button>'
      + (d !== attToday() ? '<button class="btn sm" data-act="saDay" data-n="0">Today</button>' : '') + '<b class="attday">' + esc(dayName(d)) + ', ' + esc(MZ.dateLabel(d)) + '</b></div>'
      + '<span class="livepill" id="attLive" aria-live="polite">' + attLiveText() + '</span></div>';
    if (!m) return h + '<p class="muted" style="margin-top:14px">Loading…</p>';
    if (!total) return h + '<div class="empty"><h3>No students</h3><p>' + (isAdmin() ? 'Add students first.' : 'No students are linked to you yet. Ask the admin to add you as their teacher.') + '</p></div>';
    var pct = total - c.none ? Math.round((c.present + c.late) / (total - c.none - c.excused || 1) * 100) : 0;
    h += '<div class="atttiles">' + [['present', 'Present', c.present], ['late', 'Late', c.late], ['absent', 'Absent', c.absent], ['excused', 'Excused', c.excused], ['none', 'Not marked yet', c.none]].map(function (x) {
      return '<button type="button" class="atttile t-' + x[0] + '" data-act="saFilter" data-f="' + x[0] + '" aria-pressed="' + (A.filter === x[0]) + '"><b class="num">' + x[2] + '</b><span>' + x[1] + '</span></button>';
    }).join('') + '<div class="atttile t-rate"><b class="num">' + (total - c.none ? pct + '%' : '–') + '</b><span>attended</span></div></div>';
    h += '<div class="attprog" role="progressbar" aria-valuenow="' + (total - c.none) + '" aria-valuemin="0" aria-valuemax="' + total + '" aria-label="Marked"><i class="p" style="width:' + (c.present / total * 100) + '%"></i><i class="l" style="width:' + (c.late / total * 100) + '%"></i><i class="a" style="width:' + (c.absent / total * 100) + '%"></i><i class="e" style="width:' + (c.excused / total * 100) + '%"></i></div>'
      + '<p class="muted attmarked">' + (total - c.none) + ' of ' + total + ' students marked' + (c.none ? '' : ' ✓') + '</p>';
    h += '<div class="toolbar"><div class="chips" role="group" aria-label="Show"><button class="chip" data-act="saFilter" data-f="all" aria-pressed="' + (A.filter === 'all') + '">All<b>' + total + '</b></button></div><span class="spacer"></span>'
      + (edit && c.none ? '<button class="btn sm gold" data-act="saAllPresent">' + I.check + 'Mark the ' + c.none + ' not marked as present</button>' : '')
      + '<label class="search"><span class="sr">Search students</span><input id="saQ" type="search" placeholder="Search students" value="' + esc(A.q) + '" autocomplete="off"></label></div>';
    if (!edit) h += '<p class="lockmsg">' + I.lock + '<span>' + (d > attToday() ? 'This day has not come yet.' : isViewer() || !can('teach') ? 'You can look at attendance but not change it.' : 'Teachers can take or change attendance for the last 7 days only. Ask the admin for older days.') + '</span></p>';
    var q = A.q.trim().toLowerCase(), les = A.lessons[d] || {};
    if (!A.lessons[d] && api.listSchedules) { A.lessons[d] = {}; api.listSchedules({ from: d, to: d }).then(function (l) { var o = {}; (l || []).filter(function (x) { return x.status === 'scheduled'; }).forEach(function (x) { (o[x.student_id] = o[x.student_id] || []).push(x.start_time); }); A.lessons[d] = o; if (Object.keys(o).length) attRender(); }).catch(function () {}); }
    var shown = list.filter(function (s) { var r = m[s.id]; return (A.filter === 'all' || (A.filter === 'none' ? !r : r && r.status === A.filter)) && (!q || s.full_name.toLowerCase().indexOf(q) >= 0); });
    // the admin sees everyone grouped by teacher; a teacher sees students with a lesson that day first
    var groups = [];
    if (isAdmin() || isViewer()) {
      var by = {}; shown.forEach(function (s) { var t = attTeacherOf(s) || 'No teacher yet'; (by[t] = by[t] || []).push(s); });
      groups = Object.keys(by).sort(function (a, b) { return a === 'No teacher yet' ? 1 : b === 'No teacher yet' ? -1 : a.localeCompare(b); }).map(function (k) { return [k, by[k]]; });
    } else {
      var withL = shown.filter(function (s) { return les[s.id]; }).sort(function (a, b) { return les[a.id][0] < les[b.id][0] ? -1 : 1; }), rest = shown.filter(function (s) { return !les[s.id]; });
      if (withL.length) groups.push(['Lessons on this day', withL]);
      if (rest.length) groups.push([withL.length ? 'Other students' : 'My students', rest]);
    }
    if (!shown.length) return h + '<div class="empty"><p>No students match.</p></div>';
    return h + groups.map(function (g) {
      var gc = attCounts(d, g[1]);
      return '<section class="attgrp"><div class="attgh"><h3>' + esc(g[0]) + '</h3><small class="muted">' + g[1].length + ' · ' + gc.present + ' present' + (gc.late ? ', ' + gc.late + ' late' : '') + (gc.absent ? ', ' + gc.absent + ' absent' : '') + (gc.none ? ', ' + gc.none + ' not marked' : '') + '</small></div><div class="attlist">' + g[1].map(function (s) { return attRowHTML(s, m[s.id], edit, les[s.id]); }).join('') + '</div></section>';
    }).join('');
  }
  function attRowHTML(s, r, edit, times) {
    var st = r ? r.status : '', sv = S.att.saving[s.id], away = MZ.onLeave && MZ.onLeave(s, S.att.date.slice(0, 7));
    var when = r && r.updated_at ? new Date(r.updated_at) : null;
    return '<article class="attrow' + (st ? ' s-' + st : '') + '" data-sid="' + esc(s.id) + '">'
      + '<div class="attwho"><span class="av">' + esc(MZ.initials(s.full_name)) + '</span><span class="attn"><b>' + esc(s.full_name) + '</b><small>'
      + (times ? 'Lesson ' + esc(times.join(', ')) + ' · ' : '') + (away ? '<span class="pill leave"><i></i>On leave</span> ' : '')
      + (r ? esc(ATT_NAME[st]) + (st === 'late' && r.minutes_late ? ' ' + r.minutes_late + ' min' : '') + ' · by ' + esc(r.marked_by_name || 'staff') + (when ? ' at ' + MZ.pad(when.getHours()) + ':' + MZ.pad(when.getMinutes()) : '') : 'Not marked yet')
      + (sv === 'saving' ? ' · <span class="muted">saving…</span>' : sv === 'ok' ? ' · <span class="good">saved ✓</span>' : '') + '</small>'
      + (r && r.note ? '<small class="attnotetext">“' + esc(r.note) + '”</small>' : '') + '</span></div>'
      + '<div class="attmarks" role="radiogroup" aria-label="Attendance for ' + esc(s.full_name) + '">' + ATT.map(function (a) {
        return '<button type="button" class="attm m-' + a[0] + '" role="radio" aria-checked="' + (st === a[0]) + '" data-act="saMark" data-sid="' + esc(s.id) + '" data-st="' + a[0] + '"' + (edit ? '' : ' disabled') + ' title="' + a[1] + '"><span class="lg">' + a[1] + '</span><span class="sh" aria-hidden="true">' + a[2] + '</span></button>';
      }).join('') + (edit ? '<button type="button" class="attm m-note" data-act="saNote" data-sid="' + esc(s.id) + '" title="Add a note" aria-label="Note for ' + esc(s.full_name) + '">✎</button>' : '') + '</div>'
      + (S.att.editNote === s.id && edit ? '<form class="attnote" data-sid="' + esc(s.id) + '" autocomplete="off">' + (st === 'late' ? '<label>Minutes late <input type="number" id="attMin" min="0" max="600" inputmode="numeric" value="' + esc(r && r.minutes_late != null ? r.minutes_late : '') + '"></label>' : '')
        + '<label class="grow">Note <input id="attNoteI" maxlength="200" value="' + esc(r && r.note ? r.note : '') + '" placeholder="e.g. sick, travelling, came with parent"></label><button class="btn sm gold" type="submit">Save</button><button class="btn sm ghost" type="button" data-act="saNoteX">Cancel</button>' + (!st ? '<small class="muted">Choose a mark first.</small>' : '') + '</form>' : '')
      + '</article>';
  }
  function attSave(sid, status, extra, quietUndo) {
    var A = S.att, d = A.date, m = A.data[d] = A.data[d] || {}, before = m[sid] ? Object.assign({}, m[sid]) : null;
    var row = { student_id: sid, status: status, minutes_late: extra && extra.minutes_late != null ? extra.minutes_late : (before && status === 'late' ? before.minutes_late : null), note: extra && extra.note != null ? extra.note : (before ? before.note : null) };
    if (status) m[sid] = Object.assign({}, before || {}, row, { student_id: sid, att_date: d, marked_by_name: before && before.marked_by_name || 'you', updated_at: new Date().toISOString() }); else delete m[sid];
    A.saving[sid] = 'saving'; attRender();
    return api.markAttendance(d, [row]).then(function () {
      A.saving[sid] = 'ok'; attRender(); setTimeout(function () { if (A.saving[sid] === 'ok') { delete A.saving[sid]; attRender(); } }, 1800);
      attLoad(d, d, true);
    }).catch(function (e) { if (before) m[sid] = before; else delete m[sid]; delete A.saving[sid]; attRender(); MZ.toast(e.message); });
  }
  function attMonthHTML() {
    var A = S.att, mo = A.month, r = attRange(), list = attStudents(), days = [], d;
    for (d = r.from; d <= r.to; d = isoAdd(d, 1)) days.push(d);
    var h = '<div class="attbar"><div class="attdate"><button class="iconbtn" data-act="saMon" data-n="-1" aria-label="Previous month">‹</button><b class="attday">' + esc(MZ.monthLabel(mo)) + '</b><button class="iconbtn" data-act="saMon" data-n="1" aria-label="Next month"' + (mo >= MZ.thisMonth() ? ' disabled' : '') + '>›</button></div><span class="livepill" id="attLive">' + attLiveText() + '</span></div>';
    if (!A.keys[r.from + '|' + r.to]) return h + '<p class="muted" style="margin-top:14px">Loading…</p>';
    if (!list.length) return h + '<div class="empty"><p>No students.</p></div>';
    var tot = { present: 0, late: 0, absent: 0, excused: 0 };
    var rows = list.map(function (s) {
      var c = { present: 0, late: 0, absent: 0, excused: 0 };
      var cells = days.map(function (x) { var rr = (A.data[x] || {})[s.id]; if (rr) { c[rr.status]++; tot[rr.status]++; } var a = rr && ATT.find(function (y) { return y[0] === rr.status; }); return '<td class="' + (rr ? 'c-' + rr.status : x > attToday() ? 'fut' : '') + '"' + (rr ? ' title="' + esc(ATT_NAME[rr.status] + (rr.note ? ': ' + rr.note : '')) + '"' : '') + '>' + (a ? a[2] : '') + '</td>'; }).join('');
      var marked = c.present + c.late + c.absent, rate = marked ? Math.round((c.present + c.late) / marked * 100) : null;
      return '<tr><th scope="row">' + esc(s.full_name) + '</th>' + cells + '<td class="sum">' + c.present + '</td><td class="sum">' + c.late + '</td><td class="sum">' + c.absent + '</td><td class="sum">' + c.excused + '</td><td class="sum"><b>' + (rate == null ? '–' : rate + '%') + '</b></td></tr>';
    }).join('');
    h += '<div class="atttiles">' + [['present', 'Present', tot.present], ['late', 'Late', tot.late], ['absent', 'Absent', tot.absent], ['excused', 'Excused', tot.excused]].map(function (x) { return '<div class="atttile t-' + x[0] + '"><b class="num">' + x[2] + '</b><span>' + x[1] + ' marks</span></div>'; }).join('') + '</div>';
    h += '<p class="muted attlegend">' + ATT.map(function (a) { return '<span class="lg c-' + a[0] + '">' + a[2] + '</span> ' + a[1]; }).join(' &nbsp; ') + ' &nbsp; · Attended % = present and late out of the days marked (excused not counted).</p>';
    h += '<div class="tablewrap attreg"><table class="grid"><thead><tr><th>Student</th>' + days.map(function (x) { var w = new Date(x + 'T12:00:00'); return '<th class="dc' + (w.getDay() === 0 || w.getDay() === 6 ? ' we' : '') + (x === attToday() ? ' td' : '') + '"><small>' + 'SMTWTFS'[w.getDay()] + '</small>' + w.getDate() + '</th>'; }).join('') + '<th>P</th><th>L</th><th>A</th><th>E</th><th>%</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    return h;
  }
  /* printable: the day sheet (A4 portrait) or the month register (A4 landscape) */
  function attPrint() {
    var A = S.att, list = attStudents(), inst = esc(S.settings.institute_name || 'Qism al Tahfeez Dar es Salaam');
    var css = '<style>@page{size:A4 ' + (A.view === 'month' ? 'landscape' : 'portrait') + ';margin:12mm}.attp{font:10pt/1.35 Arial,Helvetica,sans-serif;color:#111}.attp .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #A67C1E;padding-bottom:6px;margin-bottom:8px}'
      + '.attp .brand{font:700 8.5pt Arial;letter-spacing:.2em;color:#A67C1E}.attp{background:#fff}.attp h1{font:700 16pt Georgia,serif;margin:3px 0;color:#0E1736;border:0;padding:0;background:none;box-shadow:none;-webkit-text-fill-color:#0E1736;letter-spacing:0}.attp .sumr{font-size:9.5pt}.attp table{width:100%;border-collapse:collapse}.attp thead{display:table-header-group}.attp tr{break-inside:avoid;page-break-inside:avoid}'
      + '.attp th,.attp td{border:1px solid #8C8C8C;padding:4px 5px;text-align:left;vertical-align:top}.attp th{background:#EFE6CC;font-size:9pt}.attp .reg th,.attp .reg td{padding:2px 1px;text-align:center;font-size:7.5pt}.attp .reg th:first-child,.attp .reg td:first-child{text-align:left;padding:2px 4px;white-space:nowrap;font-size:8pt}'
      + '.attp .c-present{background:#E3F2E8}.attp .c-late{background:#FFF1D6}.attp .c-absent{background:#FBE1DE}.attp .c-excused{background:#E6EEF8}.attp .foot{margin-top:8px;font-size:8pt;color:#555;display:flex;justify-content:space-between;gap:10px}.attp .sig{margin-top:22px;display:flex;justify-content:space-between;font-size:9pt}</style>';
    var top = function (title, sub, right) { return '<div class="top"><div><div class="brand">TAHFEEZ DARESSALAAM</div><div style="font-size:8.5pt;color:#555">' + inst + '</div><h1>' + esc(title) + '</h1><div>' + esc(sub) + '</div></div><div class="sumr" style="text-align:right">' + right + '</div></div>'; };
    var foot = '<div class="foot"><span>P = Present · L = Late · A = Absent · E = Excused</span><span>Printed ' + esc(MZ.dateLabel(attToday())) + ' ' + MZ.pad(new Date().getHours()) + ':' + MZ.pad(new Date().getMinutes()) + '</span></div>';
    var html;
    if (A.view === 'month') {
      var r = attRange(), days = [], d; for (d = r.from; d <= r.to; d = isoAdd(d, 1)) days.push(d);
      html = css + '<div class="attp">' + top('Attendance register', MZ.monthLabel(A.month), list.length + ' students') + '<table class="reg"><thead><tr><th>Student</th>' + days.map(function (x) { return '<th>' + (+x.slice(8)) + '</th>'; }).join('') + '<th>P</th><th>L</th><th>A</th><th>E</th><th>%</th></tr></thead><tbody>'
        + list.map(function (s) { var c = { present: 0, late: 0, absent: 0, excused: 0 }; var cells = days.map(function (x) { var rr = (A.data[x] || {})[s.id]; if (rr) c[rr.status]++; var a = rr && ATT.find(function (y) { return y[0] === rr.status; }); return '<td class="' + (rr ? 'c-' + rr.status : '') + '">' + (a ? a[2] : '') + '</td>'; }).join(''); var mk = c.present + c.late + c.absent; return '<tr><td>' + esc(s.full_name) + '</td>' + cells + '<td>' + c.present + '</td><td>' + c.late + '</td><td>' + c.absent + '</td><td>' + c.excused + '</td><td>' + (mk ? Math.round((c.present + c.late) / mk * 100) + '%' : '–') + '</td></tr>'; }).join('')
        + '</tbody></table>' + foot + '</div>';
    } else {
      var dd = A.date, m = A.data[dd] || {}, c = attCounts(dd, list);
      html = css + '<div class="attp">' + top('Daily attendance', dayName(dd) + ', ' + MZ.dateLabel(dd), 'Present <b>' + c.present + '</b> · Late <b>' + c.late + '</b> · Absent <b>' + c.absent + '</b><br>Excused <b>' + c.excused + '</b> · Not marked <b>' + c.none + '</b>')
        + '<table><thead><tr><th>#</th><th>Student</th><th>Teacher</th><th>Attendance</th><th>Note</th><th>Marked by</th></tr></thead><tbody>'
        + list.map(function (s, i) { var rr = m[s.id], w = rr && rr.updated_at ? new Date(rr.updated_at) : null; return '<tr><td>' + (i + 1) + '</td><td>' + esc(s.full_name) + '</td><td>' + esc(attTeacherOf(s)) + '</td><td class="' + (rr ? 'c-' + rr.status : '') + '"><b>' + (rr ? esc(ATT_NAME[rr.status]) + (rr.status === 'late' && rr.minutes_late ? ' (' + rr.minutes_late + ' min)' : '') : '—') + '</b></td><td>' + esc(rr && rr.note || '') + '</td><td>' + (rr ? esc(rr.marked_by_name || '') + (w ? ' ' + MZ.pad(w.getHours()) + ':' + MZ.pad(w.getMinutes()) : '') : '') + '</td></tr>'; }).join('')
        + '</tbody></table><div class="sig"><span>Teacher: ____________________</span><span>Admin: ____________________</span></div>' + foot + '</div>';
    }
    MZ.printHTML(html, A.view === 'month' ? 'Attendance register ' + MZ.monthLabel(A.month) : 'Attendance ' + A.date);
  }
  document.addEventListener('change', function (e) {
    if (S.tab !== 'attendance') return;
    if (e.target.id === 'saDate' && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { var v = e.target.value; if (v > attToday()) v = attToday(); S.att.date = v; S.att.month = v.slice(0, 7); S.att.editNote = null; render(); }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'hrQ') return;
    S.hrQ = S.hrQ || {}; S.hrQ[e.target.dataset.sub] = e.target.value; var pos = e.target.selectionStart; render(); var i = $('#hrQ'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (er) {} }
  });
  document.addEventListener('input', function (e) {
    if (S.tab !== 'attendance' || e.target.id !== 'saQ') return;
    S.att.q = e.target.value; var pos = e.target.selectionStart; render(); var i = $('#saQ'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (er) {} }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f.classList || !f.classList.contains('attnote')) return;
    e.preventDefault();
    var sid = f.dataset.sid, r = (S.att.data[S.att.date] || {})[sid];
    if (!r) { MZ.toast('Choose Present, Late, Absent or Excused first.'); return; }
    var mi = $('#attMin'), ex = { note: $('#attNoteI').value.trim().slice(0, 200), minutes_late: mi && mi.value !== '' ? Math.max(0, Math.min(600, parseInt(mi.value, 10) || 0)) : null };
    S.att.editNote = null; attSave(sid, r.status, ex);
  }, true);
  /* ================= GOAL: type the current page, tap "Add New Memorized Pages"; the rest is worked out ================= */
  function goalHint(s, page) {
    if (!s.hifz_dir) return 'Choose the memorisation direction first.';
    page = +page; if (!(page >= 1 && page <= 604)) return s.cur_pos ? 'Current page: <b>page ' + s.cur_pos + '</b>. Type the page the student has now reached.' : 'Type the page the student is on now. The first page is their starting point.';
    if (!s.cur_pos) return 'Starting point: <b>page ' + page + '</b> (' + esc(MZ.surahName(MZ.pageSurah(page, s.hifz_dir))) + '). No pages are counted for it.';
    var d = MZ.posToCount(page, s.hifz_dir) - MZ.posToCount(s.cur_pos, s.hifz_dir);
    if (!d) return 'Page ' + page + ' is already the current page: no new pages.';
    if (d < 0) return '<span class="warnt">Page ' + page + ' is behind page ' + s.cur_pos + ' for a ' + (s.hifz_dir === 'backward' ? 'reverse' : 'forward') + ' student: it will be saved as a correction (' + (-d) + ' page' + (d === -1 ? '' : 's') + ' off) only if you confirm.</span>';
    return 'Page ' + s.cur_pos + ' → <b>page ' + page + '</b> (' + esc(MZ.surahName(MZ.pageSurah(page, s.hifz_dir))) + ') = <b>' + d + ' new page' + (d === 1 ? '' : 's') + '</b>' + (MZ.crossesTurn(s.cur_pos, page, s.hifz_dir) ? ', carrying on from page ' + MZ.turnOf(s.hifz_dir) + ' to page 1' : '') + '.';
  }
  function goalTilesHTML(s, h) {
    var pg = function (p) { return p ? 'Page ' + p : '–'; }, sn = function (p) { return p ? esc(MZ.surahName(MZ.pageSurah(p, h.dir))) : ''; }, n = function (x) { return x == null ? '–' : x; }, pw = function (x) { return ' <i>page' + (x === 1 ? '' : 's') + '</i>'; };
    var pct = h.goalN ? Math.min(100, Math.round((h.done || 0) / h.goalN * 100)) : 0;
    return '<div class="gtiles">'
      + '<div class="gt now"><span>Current page</span><b class="num">' + pg(s.cur_pos) + '</b><small>' + sn(s.cur_pos) + '</small></div>'
      + '<div class="gt"><span>Started at</span><b class="num">' + pg(h.startPos) + '</b><small>' + sn(h.startPos) + (h.startPos ? ' · start of month' : '') + '</small></div>'
      + '<div class="gt"><span>Monthly goal</span><b class="num">' + (h.goalN ? h.goalN + pw(h.goalN) : '–') + '</b><small>' + (h.goalN ? 'to memorise this month' : 'not set yet') + '</small></div>'
      + '<div class="gt goal"><span>Target page</span><b class="num">' + pg(h.goalPos) + '</b><small>' + sn(h.goalPos) + '</small></div>'
      + '<div class="gt"><span>Reached</span><b class="num">' + pg(h.reachedPos) + '</b><small>' + sn(h.reachedPos) + '</small></div>'
      + '<div class="gt' + (h.goalN && h.done >= h.goalN ? ' good' : '') + '"><span>Memorised this month</span><b class="num">' + n(h.done) + pw(h.done) + '</b><small>' + (h.goalN ? (h.done >= h.goalN ? 'Goal reached ✓' : n(h.toGo) + ' page' + (h.toGo === 1 ? '' : 's') + ' remaining') : '') + '</small></div>'
      + '<div class="gt"><span>Remaining</span><b class="num">' + (h.goalN ? n(h.toGo) + pw(h.toGo) : '–') + '</b><small>to reach the target</small></div>'
      + '<div class="gt"><span>Cumulative memorised</span><b class="num">' + n(s.pages) + pw(s.pages) + '</b><small>of 604</small></div>'
      + '<div class="gt"><span>Memorised in ' + MZ.thisMonth().slice(0, 4) + '</span><b class="num">' + n(h.year) + pw(h.year) + '</b><small>this year</small></div>'
      + '</div>'
      + (h.goalN ? '<div class="gprog"><div class="gbar' + (h.done >= h.goalN ? ' done' : '') + '" role="progressbar" aria-valuenow="' + (h.done || 0) + '" aria-valuemin="0" aria-valuemax="' + h.goalN + '"><i style="width:' + pct + '%"></i></div><b class="num">' + (h.done || 0) + ' / ' + h.goalN + ' pages</b></div>' : '');
  }
  function goalSectionHTML(s) {
    var h = MZ.monthHifz(s, (sheet && sheet.kind === 'student' && sheet.data.id === s.id && sheet.data.progAll) || [S.prog[s.id]].filter(Boolean), MZ.thisMonth()), teach = can('teach');
    var dir = s.hifz_dir;
    var head = '<div class="ghead"><div><b class="gname">' + esc(s.full_name) + '</b>'
      + (dir ? '<span class="gdir">' + I.swap + esc(MZ.dirLabel(dir)) + '</span>' : '<span class="gdir missing">Memorisation direction not set</span>') + '</div>'
      + '<div class="btnrow">' + (isAdmin() ? '<button class="btn sm" type="button" data-act="goalEdit" data-sid="' + esc(s.id) + '" aria-expanded="' + (S.goalEdit === s.id) + '">' + (S.goalEdit === s.id ? 'Close' : '✎ Edit or delete') + '</button>' : '')
      + (teach && dir && !isAdmin() ? '<button class="btn sm ghost" type="button" data-act="hifzDir" data-sid="' + esc(s.id) + '" data-d="' + (dir === 'backward' ? 'forward' : 'backward') + '"' + (pagesLocked() ? ' disabled title="' + esc(LOCK_PAGES) + '"' : '') + '>' + (pagesLocked() ? I.lock : '') + 'Change to ' + esc(MZ.dirLabel(dir === 'backward' ? 'forward' : 'backward', true).toLowerCase()) + '</button>' : '') + '</div></div>';
    var setDir = teach && !dir && pagesLocked() ? '<div class="gsetdir"><p class="muted">' + I.lock + ' The memorisation direction is not set yet. Only the admin can set it.</p></div>' : teach && !dir ? '<div class="gsetdir"><p>Choose how ' + esc(MZ.firstName(s.full_name)) + ' memorises. It is saved on the student and used for every count.</p><div class="btnrow">'
      + '<button class="btn gold" type="button" data-act="hifzDirSet" data-sid="' + esc(s.id) + '" data-d="forward">' + esc(MZ.dirLabel('forward')) + '</button>'
      + '<button class="btn" type="button" data-act="hifzDirSet" data-sid="' + esc(s.id) + '" data-d="backward">' + esc(MZ.dirLabel('backward')) + '</button></div></div>' : '';
    var form = teach && dir ? '<form id="addPgForm" class="gadd" autocomplete="off" data-sid="' + esc(s.id) + '"><label for="apPage">Current page no.</label><div class="gaddrow"><input id="apPage" class="input num" type="number" min="1" max="604" inputmode="numeric" placeholder="e.g. ' + (s.cur_pos ? MZ.countToPos(Math.min(604, s.pages + 1), dir) : 1) + '" required>'
      + '<button class="btn gold" type="submit" id="apBtn">' + I.plus + 'Add New Memorized Pages</button></div><p class="ghint" id="apHint">' + goalHint(s, null) + '</p></form>' : '';
    var goalForm = teach ? '<form id="sGoalForm" class="ggoal" autocomplete="off"><label for="sGoal">Monthly goal for ' + esc(MZ.monthLabel(MZ.thisMonth())) + '</label><input id="sGoal" class="input num" type="number" min="0" max="604" value="' + esc(h.goalN || '') + '" placeholder="pages"><span>pages</span><button class="btn sm" type="submit">Set goal</button><p class="gtarget" id="sGoalTarget" aria-live="polite">' + targetLine(h.startPos, h.goalN, dir) + '</p></form>' : '';
    return '<section id="secGoal"><h3>Goal · ' + esc(MZ.monthLabel(MZ.thisMonth())) + '</h3><div class="panel form goalpanel">' + head + (isAdmin() && S.goalEdit === s.id ? '<div id="goalEditBox">' + goalEditHTML(s) + '</div>' : '') + setDir + form
      + '<div id="goalTiles">' + goalTilesHTML(s, h) + '</div>' + goalForm + '</div></section>';
  }
  // "Target page = Started at + Monthly goal", in the student's direction
  function targetLine(start, goal, dir) {
    if (!dir) return 'Target page: set the memorisation direction first.';
    if (!start) return 'Target page: worked out once the starting page is known.';
    if (!(+goal > 0)) return 'Target page: enter a monthly goal.';
    var t = MZ.targetPage(start, goal, dir), turn = MZ.crossesTurn(start, t, dir), back = +start >= MZ.turnOf(dir);
    return 'Target page: <b>page ' + t + '</b> <span>= started at page ' + (+start) + ' + ' + (+goal) + ' page' + (+goal === 1 ? '' : 's') + (turn ? ' (back to page ' + MZ.turnOf(dir) + ', then on from page 1)' : back ? ' going back' : '') + (t === MZ.lastPage(dir) && MZ.posToCount(start, dir) + (+goal) > 604 ? ' (the end of the Qur’an)' : '') + '</span>';
  }
  // the target changes as soon as Started at, the goal or the direction is changed (saved when you press the button)
  function goalPreview(e) {
    if (!sheet || sheet.kind !== 'student') return;
    var st = studentById(sheet.data.id); if (!st) return;
    if (e.target.id === 'sGoal') {
      var h = MZ.monthHifz(st, sheet.data.progAll || [], MZ.thisMonth()), g = e.target.value, t = MZ.targetPage(h.startPos, g, st.hifz_dir);
      $('#sGoalTarget').innerHTML = targetLine(h.startPos, g, st.hifz_dir);
      var tile = document.querySelector('#goalTiles .gt.goal');
      if (tile) { tile.querySelector('b').textContent = t ? 'Page ' + t : '–'; tile.querySelector('small').textContent = t ? MZ.surahName(MZ.pageSurah(t, st.hifz_dir)) + (String(g) !== String(h.goalN || '') ? ' · press Set goal to save' : '') : ''; tile.classList.toggle('preview', String(g) !== String(h.goalN || '')); }
    } else if (/^ge(Start|Goal)$/.test(e.target.id) || e.target.name === 'geDir') {
      var d = (document.querySelector('input[name=geDir]:checked') || {}).value || st.hifz_dir;
      $('#geTarget').innerHTML = targetLine($('#geStart').value, $('#geGoal').value, d);
    }
  }
  document.addEventListener('input', goalPreview);
  document.addEventListener('change', function (e) { if (e.target.name === 'geDir') goalPreview(e); });
  /* ---- admin: correct or delete (every change is recorded) ---- */
  function goalEditHTML(s) {
    var m = S.goalEditMonth || MZ.thisMonth(), cur = m >= MZ.thisMonth(), rows = (sheet && sheet.data.id === s.id && sheet.data.progAll) || [];
    var h = MZ.monthHifz(s, rows, m), dir = s.hifz_dir, r = h.row;
    if (!(S.goalAudit && S.goalAudit.sid === s.id) && api.listHifzAudit && !S.goalAuditLoading) { S.goalAuditLoading = true; api.listHifzAudit(s.id).then(function (l) { S.goalAudit = { sid: s.id, list: l || [] }; S.goalAuditLoading = false; var b = $('#gAudit'); if (b && sheet && sheet.data.id === s.id) b.outerHTML = goalAuditHTML(s); }).catch(function () { S.goalAuditLoading = false; }); }
    return '<div class="gedit"><div class="gedit-head"><b>Correct or delete</b><small>Only administrators can do this. Every change is recorded below with the old and new value.</small></div><div id="gConfirm" class="gconfirm" role="alertdialog" aria-live="assertive" hidden></div>'
      + '<form id="goalEditForm" class="form" autocomplete="off" data-sid="' + esc(s.id) + '">'
      + '<div class="two"><div class="field"><label for="geMonth">Month</label><input id="geMonth" type="month" value="' + esc(m) + '" max="' + MZ.thisMonth() + '"></div>'
      + '<div class="field"><span class="flabel">Memorisation direction</span><div class="yesno"><label class="yn"><input type="radio" name="geDir" value="forward"' + (dir === 'forward' ? ' checked' : '') + '><span>Forward</span></label><label class="yn"><input type="radio" name="geDir" value="backward"' + (dir === 'backward' ? ' checked' : '') + '><span>Reverse</span></label></div></div></div>'
      + '<div class="three gthree"><div class="field"><label for="geStart">Started at (page no.)</label><input id="geStart" class="num" type="number" min="1" max="604" value="' + esc(h.startPos || '') + '" data-orig="' + esc(h.startPos || '') + '"></div>'
      + '<div class="field"><label for="geGoal">Monthly goal (pages)</label><input id="geGoal" class="num" type="number" min="0" max="604" value="' + esc(h.goalN || '') + '" data-orig="' + esc(h.goalN || '') + '"></div>'
      + '<div class="field"><label for="geReach">' + (cur ? 'Current page (page no.)' : 'Reached (page no.)') + '</label><input id="geReach" class="num" type="number" min="1" max="604" value="' + esc((cur ? s.cur_pos : h.reachedPos) || '') + '" data-orig="' + esc((cur ? s.cur_pos : h.reachedPos) || '') + '"></div></div>'
      + '<p class="gtarget" id="geTarget" aria-live="polite">' + targetLine(h.startPos, h.goalN, dir) + '</p>'
      + '<div class="field"><label for="geNote">Reason (kept in the record)</label><input id="geNote" maxlength="200" placeholder="e.g. Started at was entered wrongly"></div>'
      + '<p class="hint">Changing a page here is a correction: no keys are given for it, and keys given for pages taken off go back. The target page, pages this month, remaining pages and the reports are worked out again.</p>'
      + '<p class="err" id="geErr" hidden></p><div class="btnrow"><button class="btn gold" type="submit" id="geBtn">' + I.check + 'Save corrections</button></div></form>'
      + '<div class="gdel"><p class="flabel">Delete</p><div class="btnrow">'
      + '<button class="btn sm danger" type="button" data-act="goalDel" data-what="goal" data-sid="' + esc(s.id) + '"' + (h.goalN ? '' : ' disabled') + '>Delete the monthly goal</button>'
      + '<button class="btn sm danger" type="button" data-act="goalDel" data-what="start" data-sid="' + esc(s.id) + '"' + (h.startPos || (r && r.start_page != null) ? '' : ' disabled') + '>Delete the starting point</button></div>'
      + '<p class="hint">Deleting the monthly goal removes only the target. Deleting the starting point puts it back to where the month before ended, so you can enter the right one. Pages, history and fees are not touched.</p>'
      + goalEntriesHTML(s) + '</div>' + goalAuditHTML(s) + '</div>';
  }
  function goalEntriesHTML(s) {
    var m = S.goalEditMonth || MZ.thisMonth(), ev = ((sheet && sheet.data.events) || []).filter(function (e) { return e.kind === 'jadeed' && e.month === m; });
    var latest = ev.length ? Math.max.apply(null, ev.map(function (e) { return e.id; })) : null;
    return '<div id="gEntries"><p class="flabel" style="margin-top:8px">Page entries in ' + esc(MZ.monthLabel(m)) + ' (memorisation records)</p>'
      + (ev.length ? '<div class="gentries">' + ev.map(function (e) { return '<div class="gentry"><span><b>' + esc(e.note || 'Jadeed') + '</b><small>' + esc(MZ.dateShort ? MZ.dateShort((e.created_at || '').slice(0, 10)) : (e.created_at || '').slice(0, 10)) + ' · ' + (e.pages > 0 ? '+' : '') + e.pages + ' pages · ' + (e.keys > 0 ? '+' : '') + e.keys + ' keys</small></span><button class="btn sm danger" type="button" data-act="goalDelEntry" data-id="' + e.id + '" data-sid="' + esc(s.id) + '" data-pages="' + e.pages + '" data-latest="' + (e.id === latest ? 1 : 0) + '">Delete entry</button></div>'; }).join('') + '</div>'
        : '<p class="muted" style="font-size:13px">' + (sheet && sheet.data.events ? 'No page entries in this month' + (sheet.data.events.length >= 25 ? ' among the latest 25' : '') + '.' : 'Loading…') + '</p>') + '</div>';
  }
  function goalAuditHTML(s) {
    var aud = S.goalAudit && S.goalAudit.sid === s.id ? S.goalAudit.list : null;
    return '<details class="gaudit" id="gAudit"' + (S.goalAuditOpen ? ' open' : '') + '><summary>Change record' + (aud ? ' (' + aud.length + ')' : '') + '</summary>'
      + (aud ? (aud.length ? '<div class="tablewrap"><table class="grid"><thead><tr><th>When</th><th>Month</th><th>What</th><th>Before</th><th>After</th><th>By</th><th>Reason</th></tr></thead><tbody>' + aud.map(function (a) { return '<tr><td>' + esc((a.created_at || '').slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(a.month ? MZ.monthShort(a.month) : '') + '</td><td>' + esc(a.what) + '</td><td>' + esc(a.old_value || '–') + '</td><td>' + esc(a.new_value || '–') + '</td><td>' + esc(a.changed_by_name || '') + '</td><td>' + esc(a.note || '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">No corrections yet.</p>') : '<p class="muted">Loading…</p>')
      + '</details>';
  }
  // a clear confirmation step inside the panel (no browser pop-ups)
  function gConfirm(msg, label, fn) {
    var b = $('#gConfirm'); if (!b) return;
    b.innerHTML = '<p><b>Please confirm</b>' + esc(msg) + '</p><div class="btnrow"><button class="btn danger" type="button" id="gcYes">' + esc(label) + '</button><button class="btn ghost" type="button" id="gcNo">Cancel</button></div>';
    b.hidden = false; b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); $('#gcNo').focus();
    $('#gcNo').onclick = function () { b.hidden = true; b.innerHTML = ''; };
    $('#gcYes').onclick = function () { this.disabled = true; fn(); };
  }
  function afterGoalChange(sid, msg) {
    S.goalAudit = null;
    return Promise.all([api.listProgress({ studentId: sid }), api.listKeyEvents(sid, 25)]).then(function (r) {
      if (sheet && sheet.kind === 'student' && sheet.data.id === sid) { sheet.data.progAll = r[0]; sheet.data.events = r[1]; }
      MZ.toast(msg); return refreshProgressFor(sid);
    });
  }
  function saveGoalEdit(f) {
    var sid = f.dataset.sid, st = studentById(sid), err = $('#geErr'), btn = $('#geBtn'), m = $('#geMonth').value;
    var d = (document.querySelector('input[name=geDir]:checked') || {}).value || null, o = { note: $('#geNote').value.trim() };
    var val = function (id) { var e = $('#' + id); return e.value === e.dataset.orig ? null : e.value; };
    if (d && d !== st.hifz_dir) o.dir = d;
    var a = val('geStart'), g = val('geGoal'), rp = val('geReach');
    if (a != null) { if (!(+a >= 1 && +a <= 604)) { err.textContent = 'Started at must be a page number from 1 to 604.'; err.hidden = false; return; } o.start_pos = +a; }
    if (g != null) { if (!(+g >= 0 && +g <= 604) || g === '') { err.textContent = 'The monthly goal must be 0 to 604 pages.'; err.hidden = false; return; } o.goal = +g; }
    if (rp != null) { if (!(+rp >= 1 && +rp <= 604)) { err.textContent = 'The page must be a page number from 1 to 604.'; err.hidden = false; return; } o.reached_pos = +rp; }
    if (!o.dir && o.start_pos == null && o.goal == null && o.reached_pos == null) { err.textContent = 'Nothing was changed.'; err.hidden = false; return; }
    btn.disabled = true; err.hidden = true;
    api.adminCorrectGoal(sid, m, o).then(function () { return afterGoalChange(sid, 'Corrected for ' + MZ.firstName(st.full_name) + '. The target page, pages this month and reports are updated.'); })
      .catch(function (e) { btn.disabled = false; err.textContent = e.message; err.hidden = false; });
  }
  // the one routine action: record the page reached
  function addPages(sid, page, confirm, btn) {
    var s = studentById(sid); if (!s) return;
    page = +page; if (!(page >= 1 && page <= 604)) { MZ.toast('Enter a page number between 1 and 604.'); return; }
    if (btn) btn.disabled = true;
    var pBefore = s.pages;
    api.addMemorizedPages(sid, page, s.cur_pos || null, !!confirm).then(function (r) {
      if (btn) btn.disabled = false;
      var nm = MZ.firstName(s.full_name);
      if (r.status === 'confirm') { MZ.toast(r.message, { label: 'Save anyway', fn: function () { addPages(sid, page, true, btn); } }); return; }
      if (r.status === 'same' || r.status === 'changed') { MZ.toast(r.message); return refreshProgressFor(sid); }
      var mp = r.month_goal ? ' Monthly progress: ' + r.month_done + '/' + r.month_goal + ' pages.' : ' Pages this month: ' + r.month_done + '.';
      if (r.status === 'started') MZ.toast(nm + ': starting page saved, page ' + r.cur_pos + '. New pages are counted from here.');
      else if (r.status === 'corrected') MZ.toast('Correction saved for ' + nm + '. Current page: ' + r.cur_pos + '. Pages taken off: ' + (-r.new_pages) + '.' + mp);
      else MZ.toast((r.goal_reached ? nm + ' reached the monthly goal! ' : '') + 'Progress updated successfully. Current page: ' + r.cur_pos + '. New pages recorded: ' + r.new_pages + '.' + mp,
        r.event_id ? { label: 'Undo', fn: function () { api.undoKeyEvent(r.event_id).then(function () { return refreshProgressFor(sid); }).then(function () { MZ.toast('Undone.'); }).catch(function (e) { MZ.toast(e.message); }); } } : undefined);
      if (r.status === 'added') juzToast(sid, pBefore, r.pages);
      var f = $('#apPage'); if (f) f.value = '';
      return api.listProgress({ studentId: sid }).then(function (l) { if (sheet && sheet.kind === 'student' && sheet.data.id === sid) sheet.data.progAll = l; return refreshProgressFor(sid); });
    }).catch(function (e) { if (btn) btn.disabled = false; MZ.toast(e.message); });
  }
  function nowAtPreview(s, pos) {
    if (!pos) return 'Total memorised: <b>' + s.pages + '</b> of 604.';
    var dir = s.hifz_dir || MZ.detectDir(s, pos), n = MZ.posToCount(pos, dir);
    return 'Total memorised will be <b>' + n + '</b> of 604 (' + esc(MZ.dirLabel(dir, true).toLowerCase()) + (s.hifz_dir ? '' : ', found from this page') + ').';
  }
  function defaultIkhDate() { var t = MZ.today(), d = +t.slice(8, 10); return d < 20 ? t.slice(0, 8) + '20' : MZ.addMonths(t.slice(0, 7), 1) + '-20'; }

  /* ---- monthly report: start page, goal page, page reached, ajza, ahkaam, murajaat, dawrat */
  function rpRow(m) { return ((sheet && sheet.data.progAll) || []).find(function (r) { return r.month === m; }) || null; }
  function drawGoal() {
    var el = $('#goalTiles'); if (!el || !sheet || sheet.kind !== 'student') return;
    var s = studentById(sheet.data.id); if (!s) return;
    el.innerHTML = goalTilesHTML(s, MZ.monthHifz(s, sheet.data.progAll || [], MZ.thisMonth()));
    var g = $('#sGoal'), h = MZ.monthHifz(s, sheet.data.progAll || [], MZ.thisMonth()); if (g && document.activeElement !== g) g.value = h.goalN || '';
  }
  function drawReport() {
    drawGoal();
    var el = $('#sReport'); if (!el || !sheet || sheet.kind !== 'student') return;
    var s = studentById(sheet.data.id); if (!s) return;
    if (!sheet.data.rpDirty || !$('#reportForm')) { sheet.data.rpTouched = {}; el.innerHTML = reportFormHTML(s, sheet.data.rpMonth || S.month) + '<div id="sRpHist"></div>'; }
    $('#sRpHist').innerHTML = reportHistHTML(s);
    rpHint();
  }
  function posInputs(key, label, surah, pos) {
    return '<div class="posrow"><span class="poslabel">' + label + '</span><input class="input" id="rp' + key + 'S" list="surahList" placeholder="Surah (type a name or number)" value="' + esc(surah ? MZ.surahLabel(surah) : '') + '" aria-label="' + label + ': surah" autocomplete="off">'
      + '<input class="input num" id="rp' + key + 'P" type="number" min="1" max="604" placeholder="Page" value="' + esc(pos || '') + '" aria-label="' + label + ': page"></div>';
  }
  // everything in the monthly report is worked out from the pages; only the target (and, for past months, the pages) are typed
  function rpCalc(s, m) {
    var h = MZ.monthHifz(s, sheet.data.progAll || [], m), past = m < MZ.thisMonth();
    var n = $('#rpGoalN') ? $('#rpGoalN').value : '';
    if (past) {
      var a = rpPos('S'), e = rpPos('E');
      if (a.p) { h.startPos = a.p; h.startSurah = a.s || MZ.pageSurah(a.p, h.dir); h.startCount = MZ.posToCount(a.p, h.dir); }
      if (e.p) { h.reachedPos = e.p; h.reachedSurah = e.s || MZ.pageSurah(e.p, h.dir); h.reachedCount = MZ.posToCount(e.p, h.dir); }
      h.done = h.reachedCount != null && h.startCount != null ? Math.max(0, h.reachedCount - h.startCount) : null;
    }
    if ($('#rpGoalN')) h.goalN = n === '' ? null : Math.max(0, +n);
    h.goalCount = h.goalN && h.startCount != null ? Math.min(604, h.startCount + h.goalN) : null;
    h.goalPos = h.goalCount ? MZ.countToPos(h.goalCount, h.dir) : null;
    h.toGo = h.goalN && h.done != null ? Math.max(0, h.goalN - h.done) : null;
    return h;
  }
  function rpTile(label, big, small, cls) { return '<div class="rptile' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b class="num">' + big + '</b>' + (small ? '<small>' + small + '</small>' : '') + '</div>'; }
  function rpTilesHTML(s, m, h) {
    if (m >= MZ.thisMonth()) return '<p class="muted" style="font-size:13.5px">This month’s pages, target page and totals are under <b>Goal</b> above. They update by themselves.</p>';
    var pg = function (pos, su) { return pos ? 'Page ' + pos : '–'; }, sn = function (pos, su) { return pos ? esc(MZ.surahName(su || MZ.pageSurah(pos, h.dir))) : ''; };
    return '<div class="rptiles">'
      + rpTile('Total memorised before this month', h.startCount != null ? h.startCount : '–', 'of 604 pages')
      + rpTile('Started at', pg(h.startPos), sn(h.startPos, h.startSurah) + (m >= MZ.thisMonth() ? ' · fixed for the month' : ''))
      + rpTile('Goal', h.goalPos ? 'Page ' + h.goalPos : '–', h.goalN ? sn(h.goalPos) + ' · ' + h.goalN + ' page' + (h.goalN === 1 ? '' : 's') : 'Enter the pages to memorise', 'goal')
      + rpTile(m >= MZ.thisMonth() ? 'Reached (now at)' : 'Reached', pg(h.reachedPos), sn(h.reachedPos, h.reachedSurah))
      + rpTile('Pages memorised this month', h.done != null ? h.done : '–', h.goalN ? (h.done != null && h.done >= h.goalN ? 'Goal reached ✓' : h.toGo != null ? h.toGo + ' to go' : '') : '', h.goalN && h.done != null && h.done >= h.goalN ? 'good' : '')
      + rpTile('Total memorised until now', h.reachedCount != null ? h.reachedCount : '–', 'of 604 pages')
      + rpTile('Total memorised in ' + m.slice(0, 4), h.year, 'pages this year')
      + '</div>';
  }
  function reportFormHTML(s, m) {
    var h = MZ.monthHifz(s, sheet.data.progAll || [], m), r = h.row, past = m < MZ.thisMonth(), locked = pastLocked(m);
    var ajza = MZ.ajzaList(r && r.ajza_improve), jz = '';
    for (var j = 1; j <= 30; j++) jz += '<label class="jz"><input type="checkbox" name="rpJuz" value="' + j + '"' + (ajza.indexOf(j) >= 0 ? ' checked' : '') + '><span>' + j + '</span></label>';
    return '<form id="reportForm" class="form" autocomplete="off">' + MZ.surahDatalist('surahList')
      + '<div class="rphead"><div class="field"><label for="rpMonth">Month</label><input id="rpMonth" type="month" required value="' + esc(m) + '"' + (pagesLocked() ? ' min="' + MZ.thisMonth() + '"' : '') + '></div><p class="muted" style="font-size:13px;flex:1 1 200px">Filled in by itself from ' + esc(MZ.firstName(s.full_name)) + '’s pages (' + esc(MZ.dirLabel(h.dir, true).toLowerCase()) + '). ' + (r && r.goal_awarded ? '<span class="pill good"><i></i>Goal reached</span>' : '') + '</p></div>'
      + (locked ? '<p class="lockmsg">' + I.lock + '<span><b>' + esc(MZ.monthLabel(m)) + ' is locked.</b> ' + esc(LOCK_PAST) + '</span></p><fieldset class="rplock" disabled>' : '')
      + '<div class="field"><label for="rpGoalN">Pages to memorise this month</label><input id="rpGoalN" type="number" min="1" max="604" value="' + esc(h.goalN || '') + '" placeholder="e.g. 10"><span class="hint">The goal page is worked out from “Started at”: e.g. started at page 201 + 5 pages = goal page 206.</span></div>'
      + '<div id="rpTiles">' + rpTilesHTML(s, m, h) + '</div>'
      + (past && !pagesLocked() ? '<div class="field"><span class="flabel">Pages for ' + esc(MZ.monthLabel(m)) + ' (a past month)</span><div class="posgrid">' + posInputs('S', 'Started at', h.startPos ? h.startSurah : null, h.startPos) + posInputs('E', 'Reached', h.reachedPos ? h.reachedSurah : null, h.reachedPos) + '</div><span class="hint">Type the page; the surah fills in by itself.</span></div>' : '')
      + '<div class="field"><span class="flabel">Ajza to be improved</span><div class="jzgrid" role="group" aria-label="Ajza to be improved">' + jz + '</div></div>'
      + '<div class="field"><label for="rpAhkaam">Ahkaam / Makharij to be improved</label><textarea id="rpAhkaam" class="input" rows="2" maxlength="600" placeholder="e.g. Qalqalah, ghunnah, makhraj of daad">' + esc(r ? r.ahkaam : '') + '</textarea></div>'
      + '<div class="two"><div class="field"><label for="rpDaw">Dawrat completed this month</label><input id="rpDaw" type="number" min="0" max="999" value="' + esc(r && r.dawrat != null ? r.dawrat : '') + '"></div><div></div></div>'
      + '<div class="field"><label for="rpNote">Teacher\'s note (optional)</label><textarea id="rpNote" class="input" rows="2" maxlength="600">' + esc(r ? r.report_note : '') + '</textarea></div>'
      + (locked ? '</fieldset>' : '')
      + '<p class="err" id="rpErr" hidden></p><div class="btnrow"><button class="btn gold" type="submit" id="rpBtn"' + (locked ? ' disabled' : '') + '>' + (locked ? I.lock : '') + 'Save ' + esc(MZ.monthLabel(m)) + '</button><button class="btn" type="button" data-act="rcOne" data-sid="' + esc(s.id) + '">' + I.doc + 'Report card (PDF)</button></div><p class="hint">' + esc(MZ.firstName(s.full_name)) + ' sees this on their Home page. Started at, Reached and the totals update by themselves as Jadeed pages are added.</p></form>';
  }
  function rpPos(k) { var sv = $('#rp' + k + 'S'), pv = $('#rp' + k + 'P'); return { s: sv ? MZ.parseSurah(sv.value) : null, p: pv && pv.value !== '' ? +pv.value : null, raw: sv ? sv.value.trim() : '' }; }
  /* a surah typed fills its first page; a page typed fills its surah */
  function rpAuto(changedId) {
    var s = studentById(sheet.data.id), dir = MZ.hifzDir(s);
    ['S', 'E'].forEach(function (k) {
      var sv = $('#rp' + k + 'S'), pv = $('#rp' + k + 'P'); if (!sv || !pv) return;
      if (changedId === 'rp' + k + 'S') { var x = MZ.parseSurah(sv.value); if (x) { sv.value = MZ.surahLabel(x); var rg = MZ.surahPages(x); if (pv.value === '' || +pv.value < rg[0] || +pv.value > rg[1]) pv.value = rg[0]; } }
      if (changedId === 'rp' + k + 'P' && pv.value !== '' && +pv.value >= 1 && +pv.value <= 604) sv.value = MZ.surahLabel(MZ.pageSurah(+pv.value, dir));
    });
  }
  function rpHint() {
    var el = $('#rpTiles'), s = sheet && studentById(sheet.data.id); if (!el || !s) return;
    var m = $('#rpMonth').value; el.innerHTML = rpTilesHTML(s, m, rpCalc(s, m));
  }
  function reportHistHTML(s) {
    var rows = (sheet.data.progAll || []).filter(function (r) { return r.goal_page || r.goal || MZ.hasReport(r) || r.end_pos || r.start_pos || r.jadeed || r.pages_end != null; }).slice().sort(function (a, b) { return a.month < b.month ? 1 : -1; });
    if (!rows.length) return '';
    var lbl = function (pos, dir) { return pos ? '<b class="num">p.' + pos + '</b><small>' + esc(MZ.surahName(MZ.pageSurah(pos, dir))) + '</small>' : '–'; };
    return '<div class="tablewrap" style="margin-top:6px"><table class="grid rptable"><thead><tr><th>Month</th><th>Started at</th><th>Goal</th><th>Reached</th><th class="r">Pages this month</th><th class="r">Total</th><th>Ajza to improve</th><th class="r">Dawrat</th><th></th></tr></thead><tbody>'
      + rows.map(function (r) {
        var h = MZ.monthHifz(s, sheet.data.progAll, r.month);
        return '<tr' + (r.month === sheet.data.rpMonth ? ' class="on"' : '') + '><td>' + esc(MZ.monthLabel(r.month)) + '</td><td class="rppos">' + lbl(h.startPos, h.dir) + '</td><td class="rppos">' + (h.goalPos ? lbl(h.goalPos, h.dir) : '–') + '</td><td class="rppos">' + lbl(h.reachedPos, h.dir) + '</td>'
          + '<td class="r num">' + (h.done == null ? '–' : h.done) + (h.goalN ? ' / ' + h.goalN : '') + (h.reachedGoal ? ' <span class="pill good sm">✓</span>' : '') + '</td><td class="r num">' + (h.reachedCount == null ? '–' : h.reachedCount) + '</td><td>' + esc(MZ.ajzaList(r.ajza_improve).join(', ') || '–') + '</td>'
          + '<td class="r num">' + (r.dawrat == null ? '–' : r.dawrat) + '</td>'
          + '<td class="r"><button class="btn sm ghost" type="button" data-act="rpEdit" data-m="' + r.month + '">Edit</button></td></tr>';
      }).join('') + '</tbody></table></div>'
      + '<p class="muted" style="font-size:13px;margin-top:6px">Memorised in ' + MZ.thisMonth().slice(0, 4) + ': <b>' + MZ.monthHifz(s, sheet.data.progAll, MZ.thisMonth()).year + '</b> pages.</p>';
  }
  function saveReport() {
    var sid = sheet.data.id, m = $('#rpMonth').value, btn = $('#rpBtn'), err = $('#rpErr'), st = studentById(sid);
    if (!/^\d{4}-\d{2}$/.test(m)) { err.textContent = 'Choose the month.'; err.hidden = false; return; }
    if (pastLocked(m)) { err.textContent = LOCK_PAST; err.hidden = false; return; }
    var a = rpPos('S'), e = rpPos('E');
    if ([a, e].some(function (x) { return x.raw && !x.s; })) { err.textContent = 'A surah name was not recognised. Type a name like "Mulk" or a number 1–114.'; err.hidden = false; return; }
    var n = $('#rpGoalN').value;
    if (n !== '' && +n <= 0) { err.textContent = 'Pages to memorise must be more than 0.'; err.hidden = false; return; }
    var h = rpCalc(st, m), past = m < MZ.thisMonth();
    if (n !== '' && h.startCount == null) { err.textContent = 'Enter the page the student started at for this month first.'; err.hidden = false; return; }
    var ajza = MZ.$$('input[name=rpJuz]:checked').map(function (i) { return i.value; }).join(', ');
    var o = { start_page: h.startCount, start_pos: h.startPos, start_surah: h.startPos ? h.startSurah || MZ.pageSurah(h.startPos, h.dir) : null,
      goal_page: h.goalCount || '', goal_pos: h.goalPos, goal_surah: h.goalPos ? MZ.pageSurah(h.goalPos, h.dir) : null,
      pages_end: past ? (h.reachedCount != null ? h.reachedCount : '') : '', end_pos: past ? h.reachedPos : null, end_surah: past && h.reachedPos ? h.reachedSurah || MZ.pageSurah(h.reachedPos, h.dir) : null,
      ajza_improve: ajza, ahkaam: $('#rpAhkaam').value.trim(), murajaat: null, dawrat: $('#rpDaw').value, report_note: $('#rpNote').value.trim() };
    var before = st.keys;
    btn.disabled = true; err.hidden = true;
    api.saveMonthReport(sid, m, o).then(function (res) {
      sheet.data.rpTouched = {}; sheet.data.rpDirty = false; sheet.data.rpMonth = m;
      MZ.toast(res && res.goal_reached ? MZ.firstName(st.full_name) + ' reached the monthly goal! +' + ((res.keys || 0) - before) + ' keys.' : MZ.monthLabel(m) + ' saved. ' + MZ.firstName(st.full_name) + ' can see it now.');
      return Promise.all([api.listProgress({ studentId: sid }), api.listStudents(), loadProgress(S.month)]);
    }).then(function (r) {
      if (!r) return; S.students = r[1]; render();
      if (sheet && sheet.kind === 'student' && sheet.data.id === sid) { sheet.data.progAll = r[0]; openStudent(sid, true); }
    }).catch(function (e2) { err.textContent = e2.message; err.hidden = false; btn.disabled = false; });
  }
  document.addEventListener('input', function (e) {
    if (!sheet || sheet.kind !== 'student' || !e.target.closest || !e.target.closest('#reportForm') || e.target.id === 'rpMonth') return;
    sheet.data.rpDirty = true;
    if (/^rp[SE]P$/.test(e.target.id)) rpAuto(e.target.id);
    rpHint();
  });
  document.addEventListener('change', function (e) { if (sheet && sheet.kind === 'student' && /^rp[SE]S$/.test(e.target.id)) { rpAuto(e.target.id); rpHint(); } });
  document.addEventListener('toggle', function (e) { if (e.target.id === 'gAudit') S.goalAuditOpen = e.target.open; }, true);
  document.addEventListener('change', function (e) {
    if (e.target.id !== 'geMonth' || !sheet || sheet.kind !== 'student' || !/^\d{4}-\d{2}$/.test(e.target.value)) return;
    S.goalEditMonth = e.target.value; var b = $('#goalEditBox'), s = studentById(sheet.data.id); if (b && s) b.innerHTML = goalEditHTML(s);
  });
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'apPage' || !sheet || sheet.kind !== 'student') return;
    var s = studentById(sheet.data.id), el = $('#apHint'); if (s && el) el.innerHTML = goalHint(s, e.target.value);
  });
  // "Now at": a page typed fills the surah, and shows the total memorised it means
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'nwP' || !sheet || sheet.kind !== 'student') return;
    var s = studentById(sheet.data.id), pv = +e.target.value, el = $('#nwCount'); if (!s) return;
    if (pv >= 1 && pv <= 604) { var dir = s.hifz_dir || MZ.detectDir(s, pv), sv = $('#nwS'); if (sv) sv.value = MZ.surahLabel(MZ.pageSurah(pv, dir)); }
    if (el) el.innerHTML = nowAtPreview(s, pv >= 1 && pv <= 604 ? pv : null);
  });
  document.addEventListener('change', function (e) {
    if (e.target.id !== 'nwS') return; var su = MZ.parseSurah(e.target.value), pv = $('#nwP'); if (!su) return;
    e.target.value = MZ.surahLabel(su); var rg = MZ.surahPages(su); if (pv.value === '' || +pv.value < rg[0] || +pv.value > rg[1]) pv.value = rg[0];
    var s = sheet && studentById(sheet.data.id), el = $('#nwCount'); if (s && el) el.innerHTML = nowAtPreview(s, +pv.value);
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'rpMonth' && sheet && sheet.kind === 'student' && /^\d{4}-\d{2}$/.test(e.target.value)) { sheet.data.rpMonth = e.target.value; sheet.data.rpDirty = false; drawReport(); var f = $('#rpGoal'); if (f) f.focus(); }
  });

  /* ---- ikhtibar dates */
  var IKH_LABEL = { scheduled: 'Scheduled', cleared: 'Cleared', not_cleared: 'Not cleared' };
  function ikhPill(x) {
    var past = x.exam_date < MZ.today();
    return x.status === 'cleared' ? '<span class="pill good"><i></i>Cleared · +' + S.settings.keys_ikhtibar + '</span>' : x.status === 'not_cleared' ? '<span class="pill bad"><i></i>Not cleared</span>' : x.status === 'cancelled' ? '<span class="pill plain"><i></i>Cancelled</span>'
      : x.exam_date === MZ.today() ? '<span class="pill warn"><i></i>Today</span>' : past ? '<span class="pill warn"><i></i>Result needed</span>' : '<span class="pill plain">' + daysTo(x.exam_date) + '</span>';
  }
  function daysTo(d) { var n = Math.round((new Date(d + 'T12:00:00') - new Date(MZ.today() + 'T12:00:00')) / 864e5); return n === 1 ? 'Tomorrow' : 'In ' + n + ' days'; }
  function ikhDateHTML(d) { var dt = new Date(d + 'T12:00:00'); return '<span class="ikdate"><b class="num">' + dt.getDate() + '</b><small>' + MZ.monthShort(d.slice(0, 7)).slice(0, 3) + '</small></span>'; }
  function ikhActions(x) {
    return x.status === 'scheduled' ? '<button class="btn sm gold" data-act="ikhRes" data-id="' + x.id + '" data-st="cleared">' + I.check + 'Cleared</button><button class="btn sm" data-act="ikhRes" data-id="' + x.id + '" data-st="not_cleared">Not cleared</button>'
      + '<button class="btn sm ghost" data-act="ikhRes" data-id="' + x.id + '" data-st="cancelled">Cancel</button>'
      : x.status === 'cancelled' ? '<button class="btn sm ghost" data-act="ikhRes" data-id="' + x.id + '" data-st="scheduled">Restore</button>'
      : '<button class="btn sm ghost" data-act="ikhRes" data-id="' + x.id + '" data-st="scheduled">Change result</button>';
  }
  function drawStudentIkh() {
    var el = $('#sIkh'); if (!el || !sheet) return;
    var list = (sheet.data.ikh || []).slice(), today = MZ.today();
    var up = list.filter(function (x) { return x.status === 'scheduled'; }), done = list.filter(function (x) { return x.status !== 'scheduled'; }).reverse().slice(0, 12);
    if (!list.length) { el.innerHTML = '<p class="muted">No ikhtibar scheduled yet.</p>'; return; }
    el.innerHTML = '<div class="iklist">' + up.concat(done).map(function (x) {
      return '<div class="ikrow' + (x.status === 'scheduled' && x.exam_date < today ? ' late' : '') + '">' + ikhDateHTML(x.exam_date) + '<span class="pname"><b>' + esc(x.title) + '</b><small>' + esc(MZ.dateLabel(x.exam_date)) + (x.note ? ' · ' + esc(x.note) : '') + '</small></span>' + ikhPill(x)
        + '<span class="btnrow ikact">' + ikhActions(x) + '<button class="btn sm ghost danger" data-act="ikhDel" data-id="' + x.id + '" aria-label="Delete">' + I.x + '</button></span></div>';
    }).join('') + '</div>';
  }
  function ikhById(id) { var all = (S.ikh || []).concat((sheet && sheet.data.ikh) || []); return all.find(function (x) { return String(x.id) === String(id); }) || null; }
  function afterIkhChange(sid) {
    S.ikh = null;
    var jobs = [api.listStudents(), loadProgress(S.month), loadIkh()];
    if (sheet && sheet.kind === 'student') jobs.push(api.listIkhtibars({ studentId: sheet.data.id }));
    return Promise.all(jobs).then(function (r) {
      S.students = r[0];
      if (sheet && sheet.kind === 'student' && r[3]) { sheet.data.ikh = r[3]; openStudent(sheet.data.id, true); }
      else if (sheet && sheet.kind === 'ikhGroup') openIkhGroup(sheet.data.key);
      render();
    });
  }
  function loadIkh() { return api.listIkhtibars({}).then(function (l) { S.ikh = l; return l; }); }
  function ikhGroups(month) {
    var g = {};
    (S.ikh || []).forEach(function (x) {
      if (x.quick || (month && x.exam_date.slice(0, 7) !== month)) return;
      var st = studentById(x.student_id); if (!st) return;
      var k = x.exam_date + '|' + x.title; (g[k] = g[k] || { key: k, date: x.exam_date, title: x.title, rows: [] }).rows.push(x);
    });
    return Object.keys(g).sort().map(function (k) { return g[k]; });
  }
  function ikhCardHTML(month) {
    if (!S.ikh) { loadIkh().then(function () { if (S.tab === 'progress') render(); }).catch(function () { S.ikh = []; }); }
    var groups = S.ikh ? ikhGroups(month).filter(function (g) { return g.rows.some(function (x) { return x.status !== 'cancelled'; }); }) : [];
    return '<section class="card ikcard"><div class="ikhead"><div><p class="eyebrow">Ikhtibar dates · ' + esc(MZ.monthLabel(month)) + '</p><p class="muted" style="font-size:13.5px">Students see the date on their Home page. Mark results on the day: cleared gives +' + S.settings.keys_ikhtibar + ' keys.</p></div>'
      + '<button class="btn gold" data-act="ikhNew">' + I.plus + 'Schedule ikhtibar</button></div>'
      + (!S.ikh ? '<p class="muted">Loading…</p>' : groups.length ? '<div class="iklist">' + groups.map(function (g) {
        var c = { scheduled: 0, cleared: 0, not_cleared: 0, cancelled: 0 }; g.rows.forEach(function (x) { c[x.status]++; });
        return '<button class="ikrow ikgroup' + (c.scheduled && g.date < MZ.today() ? ' late' : '') + '" data-act="ikhGroup" data-key="' + esc(g.key) + '">' + ikhDateHTML(g.date) + '<span class="pname"><b>' + esc(g.title) + '</b><small>' + esc(MZ.dateLabel(g.date)) + ' · ' + g.rows.length + ' student' + (g.rows.length === 1 ? '' : 's') + '</small></span>'
          + '<span class="ikcounts">' + (c.cleared ? '<span class="pill good">' + c.cleared + ' cleared</span>' : '') + (c.not_cleared ? '<span class="pill bad">' + c.not_cleared + ' not cleared</span>' : '') + (c.scheduled ? '<span class="pill ' + (g.date <= MZ.today() ? 'warn' : 'plain') + '">' + c.scheduled + (g.date <= MZ.today() ? ' to mark' : ' waiting') + '</span>' : '') + '</span>'
          + '<span class="go">' + I.right + '</span></button>';
      }).join('') + '</div>' : '<p class="muted" style="font-size:13.5px">No ikhtibar this month yet.</p>') + '</section>';
  }
  function openIkhNew() {
    var act = S.students.filter(function (s) { return !s.disabled; });
    openSheet('ikhNew', {}, head('Ikhtibar', 'Schedule an ikhtibar')
      + '<form class="form" id="ikhNewForm" autocomplete="off"><div class="two"><div class="field"><label for="ikDate">Date</label><input id="ikDate" type="date" required value="' + esc(defaultIkhDate()) + '"></div>'
      + '<div class="field"><label for="ikTitle">What it covers</label><input id="ikTitle" maxlength="80" value="Monthly ikhtibar"></div></div>'
      + '<div class="field"><label for="ikNote">Note for students (optional)</label><input id="ikNote" maxlength="200" placeholder="e.g. 8:00 am, revise the last 5 pages"></div>'
      + '<div class="field"><span class="flabel">Students <span class="muted" id="ikCount"></span></span><div class="btnrow" style="margin-bottom:6px"><button class="btn sm" type="button" data-act="ikAll" data-v="1">Everyone</button><button class="btn sm" type="button" data-act="ikAll" data-v="0">No one</button></div>'
      + '<div class="pickgrid">' + act.map(function (s) { return '<label class="pick"><input type="checkbox" name="ikStu" value="' + esc(s.id) + '" checked><span><b>' + esc(s.full_name) + '</b><small class="mono">' + esc(idLine(s)) + '</small></span></label>'; }).join('') + '</div></div>'
      + '<p class="err" id="ikErr" hidden></p><button class="btn gold block" type="submit" id="ikBtn">Schedule</button></form>');
    ikCount();
  }
  function ikCount() { var n = MZ.$$('input[name=ikStu]:checked').length, el = $('#ikCount'); if (el) el.textContent = '(' + n + ' ticked)'; var b = $('#ikBtn'); if (b) b.textContent = 'Schedule for ' + n + ' student' + (n === 1 ? '' : 's'); }
  document.addEventListener('change', function (e) { if (e.target.name === 'ikStu') ikCount(); });
  function saveIkhNew() {
    var ids = MZ.$$('input[name=ikStu]:checked').map(function (i) { return i.value; }), date = $('#ikDate').value, err = $('#ikErr');
    if (!ids.length) { err.textContent = 'Tick at least one student.'; err.hidden = false; return; }
    if (!date) { err.textContent = 'Choose the date.'; err.hidden = false; return; }
    $('#ikBtn').disabled = true;
    api.scheduleIkhtibar({ studentIds: ids, exam_date: date, title: $('#ikTitle').value.trim() || 'Ikhtibar', note: $('#ikNote').value.trim() }).then(function () {
      closeSheet(); if (date.slice(0, 7) !== S.month && S.tab === 'progress') setMonth(date.slice(0, 7));
      MZ.toast('Ikhtibar on ' + MZ.dateLabel(date) + ' scheduled for ' + ids.length + ' student' + (ids.length === 1 ? '' : 's') + '. They can see it now.');
      return afterIkhChange();
    }).catch(function (e) { err.textContent = e.message; err.hidden = false; $('#ikBtn').disabled = false; });
  }
  function openIkhGroup(key) {
    var g = ikhGroups(null).find(function (x) { return x.key === key; });
    if (!g) { closeSheet(); return; }
    var scrollTop = sheet && sheet.kind === 'ikhGroup' && $('#overlay .sheet') ? $('#overlay .sheet').scrollTop : 0;
    openSheet('ikhGroup', { key: key }, head('Ikhtibar · ' + MZ.dateLabel(g.date), g.title)
      + '<div class="btnrow"><button class="btn sm" data-act="ikhAllRes" data-st="cleared">' + I.check + 'Everyone waiting cleared</button><button class="btn sm" data-act="ikhMoveGo">Reschedule</button><button class="btn sm danger" data-act="ikhCancelAll" data-key="' + esc(key) + '">Cancel ikhtibar</button></div>'
      + '<div class="panel" style="padding:4px 14px"><div class="iklist">' + g.rows.slice().sort(function (a, b) { return (studentById(a.student_id).full_name).localeCompare(studentById(b.student_id).full_name); }).map(function (x) {
        var st = studentById(x.student_id);
        return '<div class="ikrow"><span class="av">' + esc(MZ.initials(st.full_name)) + '</span><span class="pname"><b>' + esc(st.full_name) + '</b><small class="mono">' + esc(idLine(st)) + '</small></span>' + ikhPill(x)
          + '<span class="btnrow ikact">' + ikhActions(x) + '<button class="btn sm ghost danger" data-act="ikhDel" data-id="' + x.id + '" aria-label="Remove ' + esc(st.full_name) + '">' + I.x + '</button></span></div>';
      }).join('') + '</div></div>'
      + '<form class="form panel" id="ikhMoveForm" autocomplete="off"><p style="font-weight:700">Change date or title for everyone still waiting</p><div class="two"><div class="field"><label for="imDate">Date</label><input id="imDate" type="date" required value="' + esc(g.date) + '"></div>'
      + '<div class="field"><label for="imTitle">What it covers</label><input id="imTitle" maxlength="80" value="' + esc(g.title) + '"></div></div><div><button class="btn" type="submit">Save</button></div></form>');
    if (scrollTop) $('#overlay .sheet').scrollTop = scrollTop;
  }
  function ikhResult(t) {
    var x = ikhById(t.dataset.id), stt = t.dataset.st; if (!x) return;
    var st = studentById(x.student_id); t.disabled = true;
    api.ikhtibarResult(x.id, stt).then(function () {
      MZ.toast(stt === 'cleared' ? MZ.firstName(st.full_name) + ': ikhtibar cleared, +' + S.settings.keys_ikhtibar + ' keys.' : stt === 'not_cleared' ? MZ.firstName(st.full_name) + ': not cleared. No keys.'
        : stt === 'cancelled' ? 'Cancelled for ' + MZ.firstName(st.full_name) + '.' + (x.status === 'cleared' ? ' Keys taken back.' : '') : x.status === 'cancelled' ? 'Restored for ' + MZ.firstName(st.full_name) + '.' : 'Result removed. Keys taken back if given.');
      return afterIkhChange();
    }).catch(function (e) { MZ.toast(e.message); t.disabled = false; });
  }
  function drawKeys() {
    var el = $('#sKeys'); if (!el || !sheet) return;
    var ev = sheet.data.events || [];
    el.innerHTML = ev.length ? ev.map(function (e) {
      return '<div class="kev"><span class="plus' + (e.keys < 0 ? ' minus' : '') + '">' + MZ.signed(e.keys) + '</span><span>' + esc(e.note || e.kind) + '<small>' + esc(MZ.dateShort((e.created_at || '').slice(0, 10))) + ' · ' + esc(MZ.monthLabel(e.month)) + '</small></span>'
        + '<button class="btn sm ghost" data-act="undoKey" data-id="' + e.id + '" data-sid="' + esc(sheet.data.id) + '">Undo</button></div>';
    }).join('') : '<p class="muted">No keys yet.</p>';
  }

  /* ---------------------------------------------------------- notices */
  function noticeById(id) { return (S.notices || []).find(function (n) { return String(n.id) === String(id); }) || null; }
  var MAX_FILE = 50 * 1024 * 1024;
  function renderNotices() {
    if (!S.notices) {
      api.listNotices().then(function (l) { S.notices = l; if (S.tab === 'notices') render(); }).catch(function (e) { S.notices = []; MZ.toast(e.message); });
    }
    var h = '<div class="pagehead"><div><h1>Student Hub</h1><p class="stat">Messages and files every student can read in their portal: PDF, Word, PowerPoint, Excel, pictures and more.</p></div>'
      + (role() === 'admin' ? '<div class="btnrow"><button class="btn gold" data-act="newNotice">' + I.plus + 'Write a notice</button><button class="btn" data-act="uploadNotice">' + I.upload + 'Upload a file</button><input type="file" id="noticeFile" class="sr" tabindex="-1" aria-hidden="true"></div>'
        : '<div class="btnrow"><button class="btn gold" disabled aria-disabled="true" title="Only the admin can write notices">' + I.lock + 'Write a notice</button><button class="btn" disabled aria-disabled="true" title="Only the admin can upload files">' + I.lock + 'Upload a file</button></div>') + '</div>'
      + (role() === 'admin' ? '' : '<p class="muted" style="margin-top:8px">' + I.lock + ' Only the admin can write notices or upload files. You can read everything that is published.</p>');
    if (!S.notices) return h + '<p class="muted" style="margin-top:14px">Loading…</p>';
    if (!S.notices.length) return h + '<div class="empty"><h3>No notices yet</h3><p>Type a message, upload a file, or both. Students see it straight away in their Student Hub.</p></div>';
    return h + '<div class="list" style="margin-top:16px">' + S.notices.map(function (n) {
      var k = n.file_name ? MZ.fileKind(n.file_name, n.mime) : 'msg', snip = String(n.body || '').replace(/\s+/g, ' ').slice(0, 110);
      return '<article class="ncard">' + noticeIcon(n) + '<span class="pname"><b>' + esc(n.title) + '</b><small>' + esc(MZ.dateLabel((n.created_at || '').slice(0, 10))) + (n.file_name ? ' · ' + esc(n.file_name) + (n.file_size ? ' (' + MZ.fileSize(n.file_size) + ')' : '') : k === 'msg' ? ' · Message' : '') + '</small>' + (snip ? '<small class="snip" dir="auto">' + esc(snip) + (n.body.length > 110 ? '…' : '') + '</small>' : '') + '</span>'
        + '<span class="btnrow" style="justify-content:flex-end"><button class="btn sm" data-act="viewNotice" data-id="' + n.id + '">View</button>' + (role() === 'admin' ? '<button class="btn sm danger" data-act="deleteNotice" data-id="' + n.id + '">Delete</button>' : '') + '</span></article>';
    }).join('') + '</div>';
  }
  function noticeIcon(n) {
    if (!n.file_name) return '<span class="ic">' + I.doc + '</span>';
    var k = MZ.fileKind(n.file_name, n.mime); return '<span class="ic fbadge k-' + k + '">' + esc(MZ.fileExt(n.file_name)) + '</span>';
  }
  function showNotice(n) {
    openSheet('notice', { id: n.id }, head('Notice · ' + MZ.dateLabel((n.created_at || '').slice(0, 10)), n.title)
      + MZ.noticeHTML(n)
      + (role() === 'admin' ? '<div class="btnrow"><button class="btn danger" data-act="deleteNotice" data-id="' + n.id + '">Delete notice</button></div>' : ''));
    MZ.hydrateNotice(api, n, $('#overlay'));
  }
  function openNewNotice(file) {
    openSheet('newNotice', { file: null, html: '' }, head('New notice', 'Send to all students')
      + '<form class="form" id="noticeForm" autocomplete="off"><div class="field"><label for="nTitle">Title</label><input id="nTitle" required maxlength="120" placeholder="e.g. Ikhtibar on the 20th"></div>'
      + '<div class="field"><label for="nBody">Message (optional if you attach a file)</label><textarea id="nBody" class="input" rows="6" maxlength="5000" placeholder="Type your notice here. Arabic is fine too."></textarea></div>'
      + '<div class="field"><span class="flabel">File (optional)</span><div id="nFileBox"></div><span class="hint">PDF, Word, PowerPoint, Excel, pictures, audio or video. Up to 50 MB.</span></div>'
      + '<div id="nPreview"></div><p class="err" id="nErr" hidden></p><button class="btn gold block" type="submit" id="nBtn">Publish to all students</button></form>');
    drawNoticeFile();
    if (file) setNoticeFile(file); else $('#nTitle').focus();
  }
  function drawNoticeFile() {
    var d = sheet && sheet.data, box = $('#nFileBox'); if (!box) return;
    if (!d.file) { box.innerHTML = '<label class="filepick"><input type="file" id="nFile" class="sr">' + I.upload + '<span>Choose a file</span></label>'; $('#nPreview').innerHTML = ''; return; }
    var k = MZ.fileKind(d.file.name, d.file.type);
    box.innerHTML = '<div class="nfile"><span class="fbadge k-' + k + '">' + esc(MZ.fileExt(d.file.name)) + '</span><span class="pname"><b>' + esc(d.file.name) + '</b><small>' + esc(MZ.FILE_LABEL[k] + ' · ' + MZ.fileSize(d.file.size)) + '</small></span><button class="btn sm ghost" type="button" data-act="nFileRemove">Remove</button></div>';
    var pv = $('#nPreview');
    if (d.html) pv.innerHTML = '<p class="eyebrow">What students will read</p><div class="doc">' + d.html + '</div>';
    else if (k === 'image') { pv.innerHTML = '<div class="npreview"><img alt="" src="' + URL.createObjectURL(d.file) + '"></div>'; }
    else pv.innerHTML = '';
  }
  function setNoticeFile(file) {
    if (!sheet || sheet.kind !== 'newNotice') return;
    if (file.size > MAX_FILE) { MZ.toast('That file is larger than 50 MB. Make it smaller and try again.'); return; }
    if (!file.size) { MZ.toast('This file is empty.'); return; }
    sheet.data.file = file; sheet.data.html = '';
    var t = $('#nTitle'); if (t && !t.value.trim()) t.value = file.name.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_-]+/g, ' ').trim();
    drawNoticeFile();
    if (/\.docx$/i.test(file.name) && window.mammoth) {
      file.arrayBuffer().then(function (buf) { return mammoth.convertToHtml({ arrayBuffer: buf }); }).then(function (res) {
        if (!sheet || sheet.data.file !== file) return;
        var html = MZ.sanitizeHTML(res.value);
        if (html.replace(/<[^>]*>/g, '').trim() || html.indexOf('<img') >= 0) { sheet.data.html = html; drawNoticeFile(); }
      }).catch(function () {});
    }
  }
  document.addEventListener('change', function (e) {
    if (e.target.id === 'noticeFile' && e.target.files[0]) { var f = e.target.files[0]; e.target.value = ''; openNewNotice(f); }
    else if (e.target.id === 'nFile' && e.target.files[0]) { setNoticeFile(e.target.files[0]); }
  });
  function publishNotice() {
    var d = sheet.data, btn = $('#nBtn'), err = $('#nErr'), title = $('#nTitle').value.trim(), body = $('#nBody').value.trim();
    if (!title) return;
    if (!body && !d.file) { err.textContent = 'Type a message or attach a file.'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = d.file && d.file.size > 2e6 ? 'Uploading ' + MZ.fileSize(d.file.size) + '…' : 'Publishing…'; err.hidden = true;
    api.addNotice({ title: title, body: body, html: d.html || '', file: d.file }).then(function () {
      S.notices = null; closeSheet(); S.tab = 'notices'; render(); MZ.toast('Notice published. Students can read it now.');
    }).catch(function (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Publish to all students'; });
  }

  /* ------------------------------------------------------- edit fees */
  function openFees() {
    var cur = S.settings.currency;
    openSheet('fees', {}, head('Students', 'Edit monthly fees')
      + '<p class="muted">Change any fee and press Save. Receipts already issued keep their amounts.</p>'
      + '<div class="panel" style="display:flex;gap:8px;align-items:end;flex-wrap:wrap"><div class="field" style="flex:1 1 160px"><label for="allFee">Same fee for many students (' + esc(cur) + ')</label><input id="allFee" type="number" min="0" step="any" placeholder="e.g. 250000"></div>'
      + '<button class="btn" type="button" data-act="fillFees" data-only="empty">Fill empty ones</button><button class="btn" type="button" data-act="fillFees">Fill all</button></div>'
      + '<form class="form" id="feesForm" autocomplete="off"><div class="feegrid">' + S.students.map(function (s) {
        return '<label class="feerow"><span class="pname"><b>' + esc(s.full_name) + '</b><small class="mono">' + esc(idLine(s)) + '</small></span><input type="number" min="0" step="any" data-fee="' + esc(s.id) + '" value="' + (s.monthly_fee || '') + '" placeholder="Not set" aria-label="Monthly fee for ' + esc(s.full_name) + '"></label>';
      }).join('') + '</div><p id="feeMsg" class="muted" hidden></p><button class="btn gold block" type="submit" id="feeBtn">Save fees</button></form>');
  }
  function saveFees() {
    var changes = MZ.$$('[data-fee]').map(function (i) { var st = studentById(i.dataset.fee); return { s: st, v: +i.value || 0 }; }).filter(function (c) { return c.s && c.v !== (c.s.monthly_fee || 0); });
    var btn = $('#feeBtn'), msg = $('#feeMsg');
    if (!changes.length) { MZ.toast('No fees changed.'); return; }
    btn.disabled = true; msg.hidden = false; var i = 0, failed = 0;
    (function next() {
      if (i >= changes.length) {
        api.listStudents().then(function (l) { S.students = l; render(); closeSheet(); MZ.toast((changes.length - failed) + ' fee' + (changes.length - failed === 1 ? '' : 's') + ' saved.' + (failed ? ' ' + failed + ' could not be saved.' : '')); });
        return;
      }
      msg.textContent = 'Saving ' + (i + 1) + ' of ' + changes.length + '…';
      api.updateStudent(changes[i].s.id, { monthly_fee: changes[i].v }).catch(function () { failed++; }).then(function () { i++; next(); });
    })();
  }

  /* ----------------------------------------------------------- sheets */
  var sheet = null;
  function openSheet(kind, data, html) {
    if (S.mustPw && sheet && sheet.kind === 'mustPw' && kind !== 'mustPw') return;
    sheet = { kind: kind, data: data || {} };
    $('#overlay').innerHTML = '<div class="scrim" data-act="close"></div><aside class="sheet" role="dialog" aria-modal="true">' + html + '</aside>';
    var f = $('#overlay .sheet input:not([type=hidden]),#overlay .sheet select'); if (f && kind !== 'student') f.focus();
  }
  function closeSheet() {
    if (S.mustPw && sheet && sheet.kind === 'mustPw') return;
    var wasStudent = sheet && sheet.kind === 'student'; $('#overlay').innerHTML = ''; sheet = null;
    // a student's record may have been edited from a report: show the new figures
    if (wasStudent && S.tab === 'reports' && S.rep) { repReset(); render(); }
  }
  function head(eyebrow, title) { return '<div class="sheet-head"><div><p class="eyebrow">' + esc(eyebrow) + '</p><h2>' + esc(title) + '</h2></div><button class="iconbtn" data-act="close" aria-label="Close">' + I.x + '</button></div>'; }
  function refreshSheet() { if (sheet && sheet.kind === 'student') openStudent(sheet.data.id, true); }

  /* Mark paid */
  /* Cash or Bank picker (big tappable tiles). */
  function accPick(name, val, small) {
    return '<div class="accpick' + (small ? ' sm' : '') + '" role="radiogroup" aria-label="Cash or bank">' + [['cash', 'Cash', 'Notes and coins'], ['bank', 'Bank', 'Bank, M-Pesa or cheque']].map(function (o) {
      return '<label class="acc-opt ' + o[0] + '"><input type="radio" name="' + name + '" value="' + o[0] + '"' + (val === o[0] ? ' checked' : '') + '><span class="ao-ico">' + I[o[0]] + '</span><span class="ao-t"><b>' + o[1] + '</b>' + (small ? '' : '<small>' + o[2] + '</small>') + '</span><span class="ao-tick">' + I.check + '</span></label>';
    }).join('') + '</div>';
  }
  function pickedAcc(name) { var i = document.querySelector('input[name="' + name + '"]:checked'); return i ? i.value : 'cash'; }
  function prefAcc() { var m = 'Cash'; try { m = localStorage.getItem('mz_method') || 'Cash'; } catch (e) {} return MZ.accountOf(m); }
  function setPrefAcc(a) { try { localStorage.setItem('mz_method', a === 'bank' ? 'Bank' : 'Cash'); } catch (e) {} }
  function openPay(sid, month) {
    var s = studentById(sid); if (!s) return;
    openSheet('pay', { sid: sid }, head('Record payment', s.full_name)
      + '<form class="form" id="payForm" autocomplete="off">'
      + '<div class="two"><div class="field"><label for="payMonth">Fees for month</label><input id="payMonth" type="month" required value="' + esc(month) + '"></div>'
      + '<div class="field"><label for="payAmt">Amount paid (' + esc(S.settings.currency) + ')</label><input id="payAmt" type="number" min="0" step="any" required inputmode="decimal" value="' + esc(MZ.effFee(s) || '') + '"></div></div>'
      + '<p class="muted" id="payWords" style="font-size:13px;margin-top:-6px">' + esc(MZ.amountInWords(MZ.effFee(s), S.settings.currency)) + (s.discount_value ? ' · after ' + esc(MZ.discountLabel(s, S.settings.currency)) : '') + '</p>'
      + '<div class="field"><span class="flabel">Paid in</span>' + accPick('payAcc', prefAcc()) + '</div>'
      + '<div class="two"><div class="field"><label for="payDate">Date paid</label><input id="payDate" type="date" required value="' + MZ.today() + '"></div>'
      + '<div class="field"><label for="payNote">Note (optional)</label><input id="payNote" maxlength="120" placeholder="e.g. bank slip or M-Pesa code"></div></div>'
      + '<div class="field"><label for="payProof">Payment slip or receipt (optional)</label><input id="payProof" type="file" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"><span class="hint">A photo (JPEG) or PDF of the bank slip, M-Pesa message or receipt, up to 10 MB. Kept with this payment.</span></div>'
      + '<p class="err" id="payErr" hidden></p>'
      + '<button class="btn gold block" type="submit" id="payBtn">' + I.check + 'Mark as paid and create receipt</button></form>');
  }
  function submitPay() {
    var sid = sheet.data.sid, s = studentById(sid), btn = $('#payBtn'), err = $('#payErr');
    var month = $('#payMonth').value, amt = $('#payAmt').value;
    if (!/^\d{4}-\d{2}$/.test(month)) { err.textContent = 'Choose the month this payment is for.'; err.hidden = false; return; }
    if (amt === '' || +amt < 0) { err.textContent = 'Enter the amount paid.'; err.hidden = false; return; }
    var acc = pickedAcc('payAcc'); setPrefAcc(acc);
    var pf = $('#payProof') && $('#payProof').files[0], pfBad = MZ.proofCheck(pf);
    if (pfBad) { err.textContent = pfBad; err.hidden = false; return; }
    btn.disabled = true; err.hidden = true;
    api.recordPayment({ student_id: sid, month: month, amount: +amt, method: acc === 'bank' ? 'Bank' : 'Cash', paid_on: $('#payDate').value || MZ.today(), note: $('#payNote').value.trim() })
      .then(function (p) {
        if (!pf) return p;
        btn.textContent = 'Uploading the slip…';
        return api.uploadProof(p, pf).catch(function (e2) { MZ.toast('Payment saved, but the slip was not: ' + e2.message + ' Open the receipt to attach it again.'); return p; });
      })
      .then(function (p) {
        S.allPayments = null;
        if (+month.slice(0, 4) === S.payYear) { S.payments.push(p); indexPayments(); }
        render();
        showReceipt(p, s, true);
        if (p.status === 'pending') loadPending().then(function () { render(); });
        MZ.toast(p.status === 'pending' ? 'Sent to the admin for approval. ' + MZ.firstName(s.full_name) + ' sees the receipt once it is approved.' : 'Receipt ' + p.receipt_no + ' created for ' + s.full_name + '.', { label: 'Undo', fn: function () { voidPayment(p.id, true); } });
      })
      .catch(function (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; });
  }
  function voidPayment(id, quiet) {
    return api.deletePayment(id).then(function () {
      S.payments = S.payments.filter(function (p) { return p.id !== id; }); indexPayments(); S.allPayments = null;
      closeSheet(); render(); MZ.toast(quiet ? 'Payment undone.' : 'Receipt cancelled. The month is unpaid again.');
    }).catch(function (e) { MZ.toast(e.message); });
  }

  /* Receipt viewer */
  function findPayment(id) {
    id = +id || id;
    var all = S.payments.concat(S.allPayments || [], (sheet && sheet.data.pays) || []);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function showReceipt(p, s, isNew) {
    s = s || studentById(p.student_id) || { full_name: 'Removed student', username: '', phone: '' };
    var text = MZ.receiptText(p, s, S.settings), pend = p.status === 'pending';
    sheet = { kind: 'receipt', data: { p: p, s: s } };
    $('#overlay').innerHTML = '<div class="scrim" data-act="close"></div><div class="modal"><div class="modal-in" role="dialog" aria-modal="true" aria-label="Receipt ' + esc(p.receipt_no) + '">'
      + (isNew ? '<div class="newhead' + (pend ? ' wait' : '') + '"><span class="seal">' + I.check + '</span><b>' + (pend ? 'Sent to the admin for approval' : 'Receipt created') + '</b></div>' : '')
      + MZ.receiptHTML(p, s, S.settings)
      + proofLine(p)
      + (pend && isAdmin() ? '<div class="ractions"><button class="btn gold" data-act="approveOne" data-id="' + p.id + '">' + I.check + 'Approve and send to student</button><button class="btn danger" data-act="rejectPay" data-id="' + p.id + '">Reject</button></div>' : '')
      + '<div class="ractions">' + (pend ? '' : '<button class="btn gold" data-act="saveImg">Save image</button><button class="btn" data-act="copyReceipt">Copy text</button>'
      + (s.phone ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(MZ.wa(s.phone, text)) + '">Send on WhatsApp</a>' : ''))
      + '<button class="btn" data-act="close">Done</button></div>'
      + (pend || isAdmin() ? '<div class="ractions"><button class="btn sm danger" data-act="voidReceipt" data-id="' + p.id + '">Cancel this receipt</button></div>' : '')
      + '</div></div>';
  }

  /* Student detail */
  /* Accounts: fee fields only. Teachers: the details, read-only. */
  function feeOnlyHTML(s) {
    return '<section><h3>Fees</h3><form class="form panel" id="feeOnlyForm" autocomplete="off"><div class="two"><div class="field"><label for="foFee">Monthly fee (' + esc(S.settings.currency) + ')</label><input id="foFee" type="number" min="0" step="any" required value="' + esc(s.monthly_fee) + '"></div>'
      + '<div class="field"><label for="foStart">First month</label><input id="foStart" type="month" required value="' + esc(s.start_month) + '"></div></div>'
      + '<div class="btnrow"><button class="btn gold" type="submit">Save fee</button><button class="btn" type="button" data-act="discount" data-id="' + esc(s.id) + '">' + (s.discount_value ? 'Discount: ' + esc(MZ.discountLabel(s, S.settings.currency)) : 'Add a discount') + '</button></div></form></section>'
      + infoHTML(s);
  }
  function infoHTML(s) {
    var rows = [['Admission no', s.admission_no], ['ITS no', s.its_no], ['Program', s.program], ['Gender', s.gender], ['Date of birth', s.dob ? MZ.dateLabel(s.dob) : ''], ['Father/Husband name', s.guardian_name], ['Mobile', s.phone], ['Email', s.email], ['Username', s.username]].filter(function (r) { return r[1]; });
    return '<section><h3>Details</h3><dl class="info panel">' + rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl><p class="hint">Only an admin can change these.</p></section>';
  }
  function openStudent(id, keepYear) {
    if (!keepYear) S.goalEdit = null; // the correction panel opens only when asked
    var s = studentById(id); if (!s) { closeSheet(); return; }
    var year = keepYear && sheet && sheet.data.year ? sheet.data.year : +MZ.thisMonth().slice(0, 4);
    var cur = S.settings.currency;
    var html = head(s.username, s.full_name) + newEnrollHTML(s) + teachersSection(s) + (can('teach') || isViewer() ? progressSection(s) : '')
      + (!can('enter') && !isViewer() ? '' : '<section><h3>Fees in ' + year + '</h3><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="muted" style="font-size:13px">Tap Paid on a month to record it.</span><span><button class="iconbtn" data-act="sYear" data-d="-1" aria-label="Previous year">' + I.left + '</button><button class="iconbtn" data-act="sYear" data-d="1" aria-label="Next year">' + I.right + '</button></span></div><div class="year" id="sLedger"><p class="muted">Loading…</p></div><div id="sLedgerBar"></div>' + (isCashier() ? '' : '<div id="sTotals" class="ptotals"></div>') + '</section>' + (can('fees') ? breaksHTML(s) : ''))
      + (!isAdmin() ? (role() === 'accounts' ? feeOnlyHTML(s) : infoHTML(s)) : ''
      + '<section><h3>Details</h3><form class="form panel" id="editForm" autocomplete="off">'
      + '<div class="field"><label for="eName">Full name</label><input id="eName" required maxlength="80" value="' + esc(s.full_name) + '"></div>'
      + '<div class="two"><div class="field"><label for="eAdm">Admission no</label><input id="eAdm" maxlength="30" value="' + esc(s.admission_no) + '"></div>'
      + '<div class="field"><label for="eIts">ITS no</label><input id="eIts" inputmode="numeric" maxlength="12" value="' + esc(s.its_no) + '"></div></div>'
      + '<div class="two"><div class="field"><label for="eProg">Program</label><input id="eProg" maxlength="60" value="' + esc(s.program) + '" list="progList"><datalist id="progList">' + programs().map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist></div>'
      + '<div class="field"><label for="eGender">Gender</label><select id="eGender"><option value=""></option>' + ['Male', 'Female'].map(function (g) { return '<option' + (s.gender === g ? ' selected' : '') + '>' + g + '</option>'; }).join('') + '</select></div></div>'
      + '<div class="two"><div class="field"><label for="eDob">Date of birth</label><input id="eDob" type="date" value="' + esc(s.dob) + '"></div>'
      + '<div class="field"><label for="eGuard">Father/Husband name</label><input id="eGuard" maxlength="100" value="' + esc(s.guardian_name) + '" placeholder="Student fills this in"></div></div>'
      + '<div class="two"><div class="field"><label for="eEmail">Email</label><input id="eEmail" type="email" maxlength="120" value="' + esc(s.email) + '" placeholder="Student fills this in"></div>'
      + '<div class="field"><label for="eItsPw">ITS password</label><div class="pw"><input id="eItsPw" type="password" maxlength="100" autocomplete="off" placeholder="Loading…" data-orig=""><button type="button" data-pw>Show</button></div><span class="hint">Only the admin and the student can see it</span></div></div>'
      + '<div class="two"><div class="field"><label for="ePhone">Mobile no (WhatsApp)</label><input id="ePhone" inputmode="tel" value="' + esc(s.phone) + '" placeholder="Student fills this in"></div>'
      + '<div class="field"><label for="eFee">Monthly fee (' + esc(cur) + ')</label><input id="eFee" type="number" min="0" step="any" required value="' + esc(s.monthly_fee) + '"></div></div>'
      + '<div class="field"><label for="eStart">First month</label><input id="eStart" type="month" required value="' + esc(s.start_month) + '"></div>'
      + '<div><button class="btn gold" type="submit">Save changes</button></div></form></section>')
      + (!isAdmin() ? '' : ''
      + '<section><h3>Login</h3><div class="panel form"><p>Username: <b class="mono">' + esc(s.username) + '</b></p>'
      + '<form class="form" id="resetForm" autocomplete="off"><div class="field"><label for="rPw">New password</label><div style="display:flex;gap:8px"><input id="rPw" class="input" minlength="6" value="' + esc(S.settings.default_password) + '"><button class="btn" type="submit">Reset password</button></div><span class="hint">Use this if the student forgot their password.</span></div></form></div></section>'
      + (s.disabled
        ? '<section><h3>Disabled</h3><div class="okmsg" style="background:var(--warn-bg);color:var(--warn)">Disabled since ' + esc(MZ.dateLabel((s.disabled_at || '').slice(0, 10))) + '. ' + esc(MZ.firstName(s.full_name)) + ' cannot sign in and is hidden from fees and progress. Receipts and keys are kept.</div><div><button class="btn gold" data-act="enableStudent" data-id="' + esc(s.id) + '">Enable ' + esc(MZ.firstName(s.full_name)) + ' again</button></div></section>'
        : '<section><h3>Disable</h3><p class="muted" style="font-size:13.5px">For a student who has left or is on a break. They cannot sign in and are hidden from fees and progress. Nothing is deleted, and you can enable them again any time.</p><div><button class="btn" data-act="disableStudent" data-id="' + esc(s.id) + '">Disable ' + esc(MZ.firstName(s.full_name)) + '</button></div></section>')
      + '<section><h3>Remove</h3><p class="muted" style="font-size:13.5px">Deletes this student, their login and all their receipts. This cannot be undone.</p><div><button class="btn danger" data-act="removeStudent" data-id="' + esc(s.id) + '">Remove ' + esc(MZ.firstName(s.full_name)) + '</button></div></section>');
    var scrollTop = keepYear && $('#overlay .sheet') ? $('#overlay .sheet').scrollTop : 0;
    var keep = sheet && sheet.kind === 'student' && sheet.data.id === id ? sheet.data : {};
    openSheet('student', { id: id, year: year, pays: keep.pays, msel: keep.msel || {}, progAll: keep.progAll, ikh: keep.ikh, rpMonth: keep.rpMonth || S.month, badges: keep.badges, events: keep.events }, html);
    if (scrollTop) $('#overlay .sheet').scrollTop = scrollTop;
    if (isAdmin() && $('#eItsPw')) api.getItsPassword(id).then(function (v) { var i = $('#eItsPw'); if (i) { i.value = v || ''; i.dataset.orig = v || ''; i.placeholder = 'Not set'; } }).catch(function () { var i = $('#eItsPw'); if (i) i.placeholder = 'Not set'; });
    api.listPayments({ studentId: id }).then(function (pays) {
      if (!sheet || sheet.kind !== 'student' || sheet.data.id !== id) return;
      sheet.data.pays = pays; drawLedger();
    }).catch(function (e) { MZ.toast(e.message); });
    api.listKeyEvents(id, 25).then(function (ev) {
      if (!sheet || sheet.kind !== 'student' || sheet.data.id !== id) return;
      sheet.data.events = ev; drawKeys();
      var gb = $('#gEntries'), gs = studentById(id); if (gb && gs) gb.outerHTML = goalEntriesHTML(gs);
    }).catch(function () {});
    if (sheet.data.progAll) drawReport();
    if (sheet.data.ikh) drawStudentIkh();
    loadSheetBadges(id);
    api.listProgress({ studentId: id }).then(function (l) {
      if (!sheet || sheet.kind !== 'student' || sheet.data.id !== id) return;
      sheet.data.progAll = l; drawReport();
    }).catch(function (e) { var el = $('#sReport'); if (el) el.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
    api.listIkhtibars({ studentId: id }).then(function (l) {
      if (!sheet || sheet.kind !== 'student' || sheet.data.id !== id) return;
      sheet.data.ikh = l; drawStudentIkh();
    }).catch(function () {});
  }
  /* Breaks: a student travels home for months and comes back. Those months are "On leave": no fee due. */
  function breaksHTML(s) {
    var l = s.breaks || [], now = MZ.thisMonth();
    return '<section id="secBreaks"><h3>Breaks</h3><p class="muted" style="font-size:13.5px;margin:0 0 10px">When a student goes away (for example home for a year) and comes back. Those months show as <b>On leave</b>: no fee is due and they are not counted as unpaid.</p>'
      + (l.length ? '<div class="breaklist">' + l.map(function (b, i) {
        var live = b.from <= now && (!b.to || now <= b.to);
        return '<div class="breakrow' + (live ? ' live' : '') + '"><span class="bk-ico">' + I.plane + '</span><span class="bk-txt"><b>' + esc(MZ.breakLabel(b)) + '</b><small>' + (live ? 'Away now' + (b.to ? '' : ' · no return month yet') : b.from > now ? 'Planned' : 'Came back') + (b.note ? ' · ' + esc(b.note) : '') + '</small></span>'
          + '<button class="btn sm ghost danger" data-act="delBreak" data-id="' + esc(s.id) + '" data-i="' + i + '">Remove</button></div>';
      }).join('') + '</div>' : '')
      + '<form class="form panel" id="breakForm" data-id="' + esc(s.id) + '" autocomplete="off"><div class="two"><div class="field"><label for="bkFrom">Away from</label><input id="bkFrom" type="month" required value="' + esc(now) + '"></div>'
      + '<div class="field"><label for="bkTo">Back in <small class="muted">(leave empty if not known)</small></label><input id="bkTo" type="month"></div></div>'
      + '<div class="field"><label for="bkNote">Note <small class="muted">(optional)</small></label><input id="bkNote" maxlength="200" placeholder="e.g. Travelled home"></div>'
      + '<div><button class="btn gold" type="submit">' + I.plus + 'Add break</button></div></form></section>';
  }
  function saveBreaks(id, list, msg) {
    return api.updateStudent(id, { breaks: list }).then(function (ns) {
      S.students = S.students.map(function (x) { return x.id === id ? Object.assign({}, x, { breaks: ns && ns.breaks ? ns.breaks : list }) : x; });
      render(); openStudent(id, true); MZ.toast(msg);
    }).catch(function (e) { MZ.toast(e.message); });
  }
  function drawTotals() {
    var el = $('#sTotals'); if (!el || !sheet) return;
    var s = studentById(sheet.data.id), pays = sheet.data.pays || [], cur = S.settings.currency;
    var t = MZ.paidTotals(s, pays), sum = MZ.feeSummary(s, pays.filter(function (p) { return p.status !== 'pending'; }), null, MZ.thisMonth());
    el.innerHTML = '<div class="pt-main"><span class="eyebrow">Paid in total</span><b class="num">' + esc(MZ.money(t.total, cur)) + '</b><small>' + t.months + ' month' + (t.months === 1 ? '' : 's') + ' paid' + (t.first ? ' · ' + esc(MZ.monthShort(t.first) + ' ' + t.first.slice(0, 4)) + (t.last !== t.first ? ' to ' + esc(MZ.monthShort(t.last) + ' ' + t.last.slice(0, 4)) : '') : '') + '</small></div>'
      + '<div class="pt-cell ' + (sum.balance > 0 ? 'bad' : 'good') + '"><span>Balance due</span><b class="num">' + (sum.balance > 0 ? esc(MZ.money(sum.balance, cur)) : 'Clear') + '</b><small>' + (sum.unpaid.length ? sum.unpaid.length + ' unpaid month' + (sum.unpaid.length === 1 ? '' : 's') : 'Since ' + esc(MZ.monthLabel(s.start_month))) + '</small></div>'
      + (sum.leave.length ? '<div class="pt-cell leave"><span>On leave</span><b class="num">' + sum.leave.length + '</b><small>month' + (sum.leave.length === 1 ? '' : 's') + ', no fee</small></div>' : '')
      + (t.pendingN ? '<div class="pt-cell wait"><span>Waiting</span><b class="num">' + esc(MZ.money(t.pending, cur)) + '</b><small>for approval</small></div>' : '');
  }
  function drawLedger() {
    drawTotals();
    var el = $('#sLedger'); if (!el || !sheet) return;
    var s = studentById(sheet.data.id), y = sheet.data.year, pays = sheet.data.pays || [], h = '';
    for (var m = 1; m <= 12; m++) {
      var k = y + '-' + MZ.pad(m), p = null;
      for (var i = 0; i < pays.length; i++) if (pays[i].month === k) p = pays[i];
      var st = MZ.statusOf(s, k, p, S.settings);
      var canTick = !p && st !== 'na' && st !== 'leave' && MZ.effFee(s) > 0, ticked = canTick && sheet.data.msel && sheet.data.msel[k];
      h += '<div class="mt ' + st + (ticked ? ' sel' : '') + '">' + (canTick ? '<label class="tick mtick" title="Tick to mark several months paid"><input type="checkbox" data-msel="' + k + '"' + (ticked ? ' checked' : '') + '><span class="sr">Tick ' + esc(MZ.monthLabel(k)) + '</span></label>' : '')
        + '<b>' + MZ.monthShort(k) + (p && p.proof_path ? ' <span class="clip" title="Payment slip attached">' + I.doc + '</span>' : '') + '</b><span>' + (st === 'pending' ? 'Awaiting approval' : MZ.STATUS_LABEL[st]) + '</span><small class="num">' + (p ? esc(MZ.money(p.amount, S.settings.currency)) : '') + '</small>'
        + (p ? '<button class="btn" data-act="receipt" data-id="' + p.id + '">Receipt</button>' : (st === 'na' || st === 'leave' ? '' : '<button class="btn' + (st === 'upcoming' ? '' : ' gold') + '" data-act="pay" data-sid="' + esc(s.id) + '" data-month="' + k + '">Paid</button>')) + '</div>';
    }
    el.innerHTML = h;
    var months = ledgerTicked(), bar = $('#sLedgerBar');
    if (bar) bar.innerHTML = months.length ? '<div class="bulkbar inline"><span><b class="num">' + months.length + '</b> month' + (months.length === 1 ? '' : 's') + ' ticked · <span class="num">' + esc(MZ.money(MZ.effFee(s) * months.length, S.settings.currency)) + '</span><small>' + esc(months.map(MZ.monthShort).join(', ')) + '</small></span><span class="btnrow"><button class="btn ghost sm" data-act="mselNone">Clear</button><button class="btn gold sm" data-act="bulkMonths">' + I.check + 'Mark paid</button></span></div>' : '';
  }
  function ledgerTicked() {
    var pays = (sheet && sheet.data.pays) || [], ms = Object.keys((sheet && sheet.data.msel) || {}).filter(function (k) { return sheet.data.msel[k]; });
    return ms.filter(function (k) { return !pays.some(function (p) { return p.month === k; }); }).sort();
  }

  /* Add student */
  function programs() { var o = {}; S.students.forEach(function (s) { if (s.program) o[s.program] = 1; }); return Object.keys(o).sort(); }
  function takenMap() { var t = {}; S.students.forEach(function (s) { t[s.username] = 1; }); return t; }
  function openAdd() {
    openSheet('add', {}, head('New student', 'Add a student')
      + '<form class="form" id="addForm" autocomplete="off">'
      + '<div class="field"><label for="aName">Student name</label><input id="aName" required maxlength="80" placeholder="e.g. Hussein Ahmed"></div>'
      + '<div class="two"><div class="field"><label for="aAdm">Admission no</label><input id="aAdm" maxlength="30"></div>'
      + '<div class="field"><label for="aIts">ITS no</label><input id="aIts" inputmode="numeric" maxlength="12"><span class="hint">Becomes the username</span></div></div>'
      + '<div class="two"><div class="field"><label for="aProg">Program</label><input id="aProg" maxlength="60" list="progList2"><datalist id="progList2">' + programs().map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist></div>'
      + '<div class="field"><label for="aGender">Gender</label><select id="aGender"><option value=""></option><option>Male</option><option>Female</option></select></div></div>'
      + '<div class="two"><div class="field"><label for="aDob">Date of birth</label><input id="aDob" type="date"></div>'
      + '<div class="field"><label for="aGuard">Father/Husband name</label><input id="aGuard" maxlength="100"></div></div>'
      + '<div class="field"><label for="aEmail">Email</label><input id="aEmail" type="email" maxlength="120" placeholder="The welcome email with fee instructions is sent here"></div>'
      + '<div class="two"><div class="field"><label for="aUser">Username</label><input id="aUser" required maxlength="30" autocapitalize="none" spellcheck="false" class="mono"><span class="hint">Filled in from the name. You can change it.</span></div>'
      + '<div class="field"><label for="aPw">Password</label><input id="aPw" required minlength="6" value="' + esc(S.settings.default_password) + '"><span class="hint">Default password</span></div></div>'
      + '<div class="two"><div class="field"><label for="aFee">Monthly fee (' + esc(S.settings.currency) + ')</label><input id="aFee" type="number" min="0" step="any" placeholder="Can be set later"></div>'
      + '<div class="field"><label for="aPhone">Mobile no (optional)</label><input id="aPhone" inputmode="tel" placeholder="Student can add it later"></div></div>'
      + '<div class="two"><div class="field"><label for="aStart">First month</label><input id="aStart" type="month" required value="' + MZ.thisMonth() + '"></div>'
      + '<div class="field"><label for="aPages">Pages memorised so far</label><input id="aPages" type="number" min="0" max="604" value="0"><span class="hint">Out of 604</span></div></div>'
      + '<p class="err" id="addErr" hidden></p>'
      + '<button class="btn gold block" type="submit" id="addBtn">Create student and login</button></form>');
    var touched = false;
    $('#aUser').addEventListener('input', function () { touched = true; });
    function autoUser() { if (touched) return; var its = $('#aIts').value.replace(/\D/g, ''); $('#aUser').value = its.length >= 3 ? its : MZ.slugUsername($('#aName').value, takenMap()); }
    $('#aName').addEventListener('input', autoUser); $('#aIts').addEventListener('input', autoUser);
  }
  function credCard(name, username, pw, phone) {
    var link = studentLink();
    var msg = 'Dear ' + MZ.firstName(name) + ', your Qism al Tahfeez student portal login:\nUsername: ' + username + '\nPassword: ' + pw + '\n' + link;
    return '<div class="cred"><p class="eyebrow">Login created</p><p><b>' + esc(name) + '</b> can now sign in to the Student portal.</p>'
      + '<dl><div><dt>Username</dt><dd>' + esc(username) + '</dd></div><div><dt>Password</dt><dd>' + esc(pw) + '</dd></div></dl>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="copyText" data-text="' + esc(msg) + '">Copy login</button>'
      + (phone ? '<a class="btn sm" target="_blank" rel="noopener" href="' + esc(MZ.wa(phone, msg)) + '">Send on WhatsApp</a>' : '') + '</div></div>';
  }
  function studentLink() {
    try { var u = new URL('student.html', location.href); if (/^https?:/.test(u.protocol) && !/claude|localhost|127\.0/.test(u.host)) return u.href; } catch (e) {}
    return '';
  }

  /* Import from Excel */
  var FIELDS = {
    full_name: ['name', 'names', 'fullname', 'studentname', 'studentsname', 'student', 'students', 'nameofstudent', 'studentfullname', 'jina', 'majina', 'jinakamili', 'jinalamwanafunzi', 'mwanafunzi', 'talib', 'talaba', 'اسم', 'الاسم', 'اسمالطالب', 'الطالب', 'الطلاب'],
    first_name: ['firstname', 'first', 'givenname', 'jinalakwanza'],
    last_name: ['lastname', 'surname', 'last', 'familyname', 'jinalamwisho'],
    username: ['username', 'user', 'login', 'userid', 'loginname'],
    password: ['password', 'pass', 'pwd', 'nenosiri'],
    phone: ['phone', 'phoneno', 'phonenumber', 'mobile', 'mobileno', 'whatsapp', 'contact', 'tel', 'telephone', 'simu', 'namba', 'nambayasimu', 'رقم', 'الهاتف', 'جوال', 'رقمالهاتف'],
    monthly_fee: ['fee', 'fees', 'monthlyfee', 'monthlyfees', 'amount', 'ada', 'adayamwezi', 'الرسوم', 'رسوم'],
    start_month: ['firstmonth', 'startmonth', 'start', 'joined', 'joiningmonth', 'from', 'admissiondate', 'joiningdate'],
    admission_no: ['admissionno', 'admissionnumber', 'admno', 'admnumber', 'admission', 'admissionnum', 'regno', 'registrationno', 'registrationnumber', 'rollno', 'serialno'],
    its_no: ['itsno', 'its', 'itsnumber', 'itsid', 'itsidno'],
    its_password: ['itspsw', 'itspassword', 'itspass', 'itspwd', 'itspasscode'],
    program: ['program', 'programme', 'programs', 'course', 'class', 'level', 'batch', 'darja'],
    guardian_name: ['fathername', 'fathersname', 'husbandname', 'husbandsname', 'fatherhusbandname', 'fatherhusbandsname', 'fatherorhusbandname', 'fatherorhusbandsname', 'fathershusbandsname', 'guardian', 'guardianname', 'parent', 'parentname', 'father', 'husband'],
    dob: ['dob', 'dateofbirth', 'birthdate', 'birthday', 'dobddmmyyyy', 'tareheyakuzaliwa'],
    gender: ['gender', 'sex', 'jinsia'],
    email: ['email', 'emailaddress', 'emailid', 'mail', 'barua', 'baruapepe'],
    pages: ['pages', 'page', 'pagesmemorised', 'pagesmemorized', 'kurasa', 'صفحات'],
    juz: ['juz', 'juzmemorised', 'juzmemorized', 'para', 'parah', 'جزء']
  };
  var PREFIX_OK = { monthly_fee: 1, phone: 1, start_month: 1, pages: 1, guardian_name: 1, dob: 1, email: 1, its_password: 1 };
  function normKey(k) { return String(k || '').toLowerCase().replace(/[^a-z؀-ۿ]/g, ''); }
  function fieldOf(header) {
    var k = normKey(header); if (!k) return null;
    var f; for (f in FIELDS) if (FIELDS[f].indexOf(k) >= 0) return f;
    if (/^its(psw|pass|pwd)/.test(k)) return 'its_password';
    if (/^(father|husband|guardian|parent)/.test(k)) return 'guardian_name';
    for (f in PREFIX_OK) for (var i = 0; i < FIELDS[f].length; i++) if (FIELDS[f][i].length >= 3 && k.indexOf(FIELDS[f][i]) === 0) return f;
    return null;
  }
  function openImport() {
    openSheet('import', { rows: null }, head('Students', 'Import from Excel')
      + '<section><p class="muted">Upload any Excel file (.xlsx, .xls or .csv) with your students’ names. Admission No, Student Name, Program, Father/Husband Name, Date of Birth, Gender, Mobile No, ITS No and Email are read automatically (blank columns are fine; students fill in Father/Husband Name, mobile and email themselves). Each student signs in with their <b>ITS No</b> and the default password <b class="mono">' + esc(S.settings.default_password) + '</b>. Fees can be set afterwards.</p>'
      + '<div><button class="btn sm" data-act="template">Download Excel template</button></div></section>'
      + '<label class="drop" id="drop" for="xlFile"><span>' + I.upload + '</span><b>Choose an Excel file</b><span class="muted" style="font-size:13px">or drag it here</span><input id="xlFile" type="file" accept=".xlsx,.xls,.csv" class="sr"></label>'
      + '<div class="two"><div class="field"><label for="impFee">Monthly fee for everyone without one (optional)</label><input id="impFee" type="number" min="0" step="any" placeholder="e.g. 250000"></div>'
      + '<div class="field"><label for="impStart">First month</label><input id="impStart" type="month" value="' + MZ.thisMonth() + '"></div></div>'
      + '<div id="impPreview"></div>');
    var drop = $('#drop');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) readExcel(f); });
    $('#xlFile').addEventListener('change', function (e) { var f = e.target.files[0]; if (f) readExcel(f); });
    var t; ['impFee', 'impStart'].forEach(function (id) { $('#' + id).addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { if (sheet && sheet.kind === 'import' && sheet.data.raw && !sheet.data.running) buildPreview(); }, 350); }); });
  }
  function toMonth(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) { v = new Date(v.getTime() + 12 * 3600 * 1000); return v.getFullYear() + '-' + MZ.pad(v.getMonth() + 1); }
    if (typeof v === 'number' && window.XLSX) { var d = XLSX.SSF.parse_date_code(v); if (d) return d.y + '-' + MZ.pad(d.m); }
    var s = String(v).trim(), m = s.match(/^(\d{4})[-\/.](\d{1,2})/);
    if (m) return m[1] + '-' + MZ.pad(m[2]);
    m = s.match(/^(\d{1,2})[-\/.](\d{4})$/); if (m) return m[2] + '-' + MZ.pad(m[1]);
    var t = Date.parse('1 ' + s); if (!isNaN(t)) { var dd = new Date(t); return dd.getFullYear() + '-' + MZ.pad(dd.getMonth() + 1); }
    return 'invalid';
  }
  function toDate(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) { v = new Date(v.getTime() + 12 * 3600 * 1000); return v.getFullYear() + '-' + MZ.pad(v.getMonth() + 1) + '-' + MZ.pad(v.getDate()); }
    if (typeof v === 'number' && window.XLSX) { var d = XLSX.SSF.parse_date_code(v); if (d && d.y > 1900) return d.y + '-' + MZ.pad(d.m) + '-' + MZ.pad(d.d); }
    var s = String(v).trim(), m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (m) return m[1] + '-' + MZ.pad(m[2]) + '-' + MZ.pad(m[3]);
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
    if (m) { var y = +m[3]; if (y < 100) y += y > 30 ? 1900 : 2000; return y + '-' + MZ.pad(m[2]) + '-' + MZ.pad(m[1]); } // day/month/year
    var t = Date.parse(s); if (!isNaN(t)) { var dd = new Date(t); return dd.getFullYear() + '-' + MZ.pad(dd.getMonth() + 1) + '-' + MZ.pad(dd.getDate()); }
    return '';
  }
  function toGender(v) {
    var t = String(v == null ? '' : v).trim().toLowerCase();
    if (/^(m|male|boy|man|mme|me|ذكر)$/.test(t)) return 'Male';
    if (/^(f|female|girl|woman|mke|ke|أنثى|انثى)$/.test(t)) return 'Female';
    return t ? String(v).trim() : '';
  }
  function cellText(v) { return v instanceof Date ? '' : String(v == null ? '' : v).trim().replace(/\s+/g, ' '); }
  function looksName(v) {
    var t = cellText(v);
    if (t.length < 2 || t.length > 70) return false;
    var letters = (t.match(/[A-Za-zÀ-ɏ؀-ۿ]/g) || []).length, digits = (t.match(/\d/g) || []).length;
    return letters >= 2 && digits <= 1 && !/@/.test(t) && !/^(total|jumla|sum|name|names|jina)$/i.test(t);
  }
  function looksPhone(v) { var d = String(v == null ? '' : v).replace(/[\s()+-]/g, ''); return /^\d{9,13}$/.test(d); }
  function looksFee(v) { var n = typeof v === 'number' ? v : Number(String(v || '').replace(/[, ]/g, '')); return isFinite(n) && n >= 500 && n < 1e8 && !looksPhone(v); }
  /* Turn rows of cells into student records, with or without a header row. */
  function detect(aoa) {
    aoa = aoa.filter(function (r) { return r && r.some(function (c) { return cellText(c) !== '' || c instanceof Date; }); });
    if (!aoa.length) return { rows: [], how: '' };
    var width = aoa.reduce(function (m, r) { return Math.max(m, r.length); }, 0), map = {}, headerAt = -1;
    for (var h = 0; h < Math.min(8, aoa.length) && headerAt < 0; h++) {
      var m = {}, hits = 0;
      for (var c = 0; c < width; c++) { var f = fieldOf(aoa[h][c]); if (f && m[f] == null) { m[f] = c; hits++; } }
      if (m.full_name != null || m.first_name != null || hits >= 2) { map = m; headerAt = h; }
    }
    var data = aoa.slice(headerAt + 1), how;
    function score(col, fn) { var n = 0; (typeof named !== 'undefined' && named ? named : data).forEach(function (r) { if (fn(r[col])) n++; }); return n; }
    var named = null;
    if (map.full_name == null && map.first_name == null) {
      var best = -1, bestN = 0;
      for (var c2 = 0; c2 < width; c2++) {
        if (Object.keys(map).some(function (k) { return map[k] === c2; })) continue;
        var n = score(c2, looksName); if (n > bestN) { bestN = n; best = c2; }
      }
      if (best < 0) return { rows: [], how: '' };
      map.full_name = best;
    }
    var used = Object.keys(map).map(function (k) { return map[k]; });
    var named = data.filter(function (r) { return map.full_name != null ? looksName(r[map.full_name]) : true; });
    for (var c3 = 0; c3 < width; c3++) {
      if (used.indexOf(c3) >= 0) continue;
      var nn = Math.max(1, named.length);
      if (map.phone == null && headerAt < 0 && score(c3, looksPhone) >= nn * 0.5) { map.phone = c3; used.push(c3); continue; }
      if (map.monthly_fee == null && headerAt < 0 && score(c3, looksFee) >= nn * 0.5) { map.monthly_fee = c3; used.push(c3); }
    }
    var colName = function (c) { return String.fromCharCode(65 + (c % 26)); };
    if (map.full_name != null) how = 'Names found in column ' + colName(map.full_name) + (headerAt >= 0 && cellText(aoa[headerAt][map.full_name]) ? ' (“' + cellText(aoa[headerAt][map.full_name]) + '”)' : ' (no header row)');
    else how = 'Names built from columns ' + colName(map.first_name) + (map.last_name != null ? ' and ' + colName(map.last_name) : '');
    var rows = data.map(function (r) {
      var o = {}; Object.keys(map).forEach(function (k) { o[k] = r[map[k]]; });
      if (map.full_name == null) o.full_name = [cellText(o.first_name), cellText(o.last_name)].filter(Boolean).join(' ');
      return o;
    }).filter(function (o) { return looksName(o.full_name) || cellText(o.username); });
    return { rows: rows, how: how, skippedIts: map.its_password != null };
  }
  function readExcel(file) {
    if (!window.XLSX) { MZ.toast('The Excel reader is still loading. Try again in a moment.'); return; }
    var r = new FileReader();
    r.onload = function () {
      try {
        var wb = XLSX.read(new Uint8Array(r.result), { type: 'array', cellDates: true }), res = { rows: [] };
        for (var i = 0; i < wb.SheetNames.length && !res.rows.length; i++) {
          res = detect(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[i]], { header: 1, defval: '', raw: true, blankrows: false }));
        }
        sheet.data.raw = res.rows; sheet.data.how = res.how; sheet.data.skippedIts = !!res.skippedIts; sheet.data.fileName = file.name; buildPreview();
      } catch (e) { $('#impPreview').innerHTML = '<p class="err">Could not read this file. Save it as .xlsx and try again.</p>'; }
    };
    r.readAsArrayBuffer(file);
  }
  function buildPreview() {
    var raw = sheet.data.raw || [], taken = takenMap(), seen = {}, out = [], names = {}, seenNames = {};
    var itsTaken = {}, admTaken = {};
    S.students.forEach(function (s) { names[s.full_name.toLowerCase()] = 1; if (s.its_no) itsTaken[s.its_no] = 1; if (s.admission_no) admTaken[s.admission_no.toLowerCase()] = 1; });
    var defFee = $('#impFee').value, defStart = $('#impStart').value || MZ.thisMonth();
    raw.forEach(function (o) {
      var name = cellText(o.full_name);
      var rec = { full_name: name, problems: [], notes: [] };
      rec.admission_no = cellText(o.admission_no); rec.its_no = String(o.its_no == null ? '' : o.its_no).replace(/\D/g, '');
      rec.program = cellText(o.program); rec.guardian_name = cellText(o.guardian_name); rec.dob = toDate(o.dob); rec.gender = toGender(o.gender);
      rec.email = cellText(o.email).toLowerCase();
      var u = cellText(o.username).toLowerCase().replace(/\s+/g, '.');
      if (!u && rec.its_no.length >= 3) u = rec.its_no;
      if (!u) { var merged = Object.assign({}, taken, seen); u = MZ.slugUsername(name, merged); }
      rec.username = u;
      rec.password = cellText(o.password) || S.settings.default_password;
      rec.phone = String(o.phone == null ? '' : o.phone).replace(/[^\d+]/g, '');
      var fee = cellText(o.monthly_fee) === '' ? defFee : String(o.monthly_fee).replace(/[^\d.]/g, '');
      rec.monthly_fee = fee === '' || isNaN(Number(fee)) ? 0 : Number(fee);
      if (!rec.monthly_fee) rec.notes.push('fee not set');
      rec.start_month = toMonth(o.start_month) || defStart;
      if (rec.start_month === 'invalid') { rec.start_month = defStart; rec.notes.push('first month not understood, using ' + defStart); }
      var pg = parseInt(o.pages, 10), jz = parseInt(o.juz, 10);
      rec.pages = pg > 0 ? Math.min(604, pg) : (jz > 0 ? Math.min(604, jz * 20) : 0);
      rec.juz = jz > 0 ? Math.min(30, jz) : 0;
      if (!name) rec.problems.push('Name is missing');
      else if (rec.its_no && itsTaken[rec.its_no]) rec.problems.push('ITS ' + rec.its_no + ' is already a student');
      else if (rec.admission_no && admTaken[rec.admission_no.toLowerCase()]) rec.problems.push('Admission no ' + rec.admission_no + ' already used');
      else if (!rec.its_no && !rec.admission_no && names[name.toLowerCase()]) rec.problems.push('Already a student');
      else if (rec.its_no ? seenNames['its:' + rec.its_no] : seenNames[name.toLowerCase()]) rec.problems.push(rec.its_no ? 'ITS no appears twice in the file' : 'Name appears twice in the file');
      seenNames[rec.its_no ? 'its:' + rec.its_no : name.toLowerCase()] = 1;
      if (!MZ.validUsername(u)) rec.problems.push('Username "' + u + '" is not valid');
      else if (taken[u]) rec.problems.push('Username already exists');
      else if (seen[u]) rec.problems.push('Username appears twice in the file');
      if (rec.password.length < 6) rec.problems.push('Password shorter than 6 characters');
      seen[u] = 1; out.push(rec);
    });
    sheet.data.rows = out;
    var ok = out.filter(function (r) { return !r.problems.length; }).length;
    var cur = S.settings.currency;
    var h = '<section><h3>' + esc(sheet.data.fileName || 'File') + '</h3>';
    if (!out.length) { $('#impPreview').innerHTML = h + '<p class="err">No names found in this file. Put one student name per row and try again.</p></section>'; return; }
    h += '<p class="okmsg" style="font-weight:600">' + esc(sheet.data.how || '') + ': ' + out.length + ' student' + (out.length === 1 ? '' : 's') + '.</p>'
      + '<p><b>' + ok + '</b> ready to add.' + (ok < out.length ? ' Rows marked in red are skipped.' : '') + (out.some(function (r) { return !r.problems.length && !r.monthly_fee; }) ? ' Students without a fee can be given one after importing.' : '') + '</p>'
      + (sheet.data.skippedIts ? '<p class="muted" style="font-size:13px">The ITS password column was skipped on purpose. Passwords for ITS are not stored here.</p>' : '')
      + '<div class="tablewrap"><table class="preview"><thead><tr><th>Adm no</th><th>Name</th><th>Program</th><th>Gender</th><th>Date of birth</th><th>ITS no</th><th>Login</th><th>Fee</th><th>Status</th></tr></thead><tbody>'
      + out.map(function (r) {
        return '<tr><td class="mono">' + esc(r.admission_no) + '</td><td>' + esc(r.full_name) + '</td><td>' + esc(r.program) + '</td><td>' + esc(r.gender) + '</td><td>' + esc(r.dob ? MZ.dateLabel(r.dob) : '') + '</td><td class="mono">' + esc(r.its_no) + '</td><td class="mono">' + esc(r.username) + ' / ' + esc(r.password) + '</td><td class="num">' + (r.monthly_fee ? esc(MZ.money(r.monthly_fee, cur)) : '<span class="muted">Not set</span>') + '</td>'
          + (r.problems.length ? '<td class="bad">' + esc(r.problems.join('. ')) + '</td>' : (r.done ? '<td class="ok">Added</td>' : '<td class="ok">Ready</td>')) + '</tr>';
      }).join('') + '</tbody></table></div>'
      + '<div id="impRun" style="display:grid;gap:10px"><button class="btn gold block" data-act="runImport"' + (ok ? '' : ' disabled') + '>Add ' + ok + ' student' + (ok === 1 ? '' : 's') + '</button></div></section>';
    $('#impPreview').innerHTML = h;
  }
  function runImport(btn) {
    var rows = (sheet.data.rows || []).filter(function (r) { return !r.problems.length; });
    if (!rows.length) return;
    btn.disabled = true; sheet.data.running = true;
    var box = $('#impRun'), i = 0, added = [], failed = [];
    box.innerHTML = '<p id="impMsg">Adding students…</p><div class="progress"><i id="impBar"></i></div>';
    (function next() {
      if (!sheet || sheet.kind !== 'import') return;
      if (i >= rows.length) {
        added.forEach(function (r) { S.newLogins.push({ name: r.full_name, username: r.username, password: r.password, phone: r.phone }); });
        box.innerHTML = '<p>Finishing…</p>';
        api.listStudents().then(function (l) { S.students = l; render(); }).catch(function () {}).then(function () { if (!$('#impRun')) return; box.innerHTML = '<div class="okmsg">' + added.length + ' student' + (added.length === 1 ? '' : 's') + ' added.</div>'
          + (failed.length ? '<div class="err">' + failed.length + ' could not be added:<br>' + failed.map(function (f) { return esc(f.r.full_name + ': ' + f.e); }).join('<br>') + '</div>' : '')
          + (added.length ? '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn gold" data-act="editFees">Set fees now</button><button class="btn" data-act="exportLogins">Download login list (Excel)</button></div><p class="muted" style="font-size:13px">Give each student their username and password. They will be asked to choose their own password when they first sign in.</p>' : ''); });
        return;
      }
      var r = rows[i];
      $('#impMsg').textContent = 'Adding ' + (i + 1) + ' of ' + rows.length + ': ' + r.full_name;
      api.createStudent(r).then(function (id) {
        added.push(r); r.done = true; if (!id) return;
        var extra = { admission_no: r.admission_no || null, its_no: r.its_no || null, program: r.program || null, guardian_name: r.guardian_name || null,
          dob: r.dob || null, gender: r.gender || null, email: r.email || null };
        return api.updateStudent(id, extra).catch(function () {}).then(function () { if (r.pages) return api.setPages(id, MZ.thisMonth(), r.pages).catch(function () {}); });
      }, function (e) { failed.push({ r: r, e: e.message }); })
        .then(function () { i++; var b = $('#impBar'); if (b) b.style.width = Math.round(i / rows.length * 100) + '%'; next(); });
    })();
  }
  function xlsxBlob(rows, sheetName) {
    var ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
    ws['!cols'] = Object.keys(rows[0] || {}).map(function (k) { return { wch: Math.max(12, k.length + 2) }; });
    XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Students');
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function needXLSX() { if (!window.XLSX) { MZ.toast('The Excel tools are still loading. Try again in a moment.'); return false; } return true; }

  /* ---------------------------------------------------------- events */
  var A = {
    retry: function () { startApp(); },
    tab: function (t) { if ((TABS[role()] || []).indexOf(t.dataset.tab) < 0) return; S.tab = t.dataset.tab; if (S.tab === 'reports' && S.rep) repReset(); try { history.replaceState(null, '', '#' + S.tab + (S.sub && S.sub[S.tab] ? '/' + S.sub[S.tab] : '')); } catch (e) {} render(); window.scrollTo(0, 0); },
    sub: function (t) { var tab = t.dataset.tab2 || S.tab; S.tab = tab; S.sub[tab] = t.dataset.sub; try { history.replaceState(null, '', '#' + tab + '/' + t.dataset.sub); } catch (e) {} closeSheet(); render(); window.scrollTo(0, 0); },
    prevMonth: function () { setMonth(MZ.addMonths(S.month, -1)); if (sheet && sheet.kind === 'tProfile') openTeacherProfile(sheet.data.id); },
    nextMonth: function () { setMonth(MZ.addMonths(S.month, 1)); if (sheet && sheet.kind === 'tProfile') openTeacherProfile(sheet.data.id); },
    thisMonth: function () { setMonth(MZ.thisMonth()); },
    filter: function (t) { S.filter = t.dataset.f; render(); },
    pay: function (t) { openPay(t.dataset.sid, t.dataset.month); },
    receipt: function (t) {
      var p = findPayment(t.dataset.id);
      if (p) showReceipt(p);
    },
    student: function (t) { openStudent(t.dataset.id); },
    sYear: function (t) { if (!sheet) return; sheet.data.year += +t.dataset.d; var y = sheet.data.year; var h = $('#overlay .sheet h3'); if (h) h.textContent = 'Fees in ' + y; drawLedger(); },
    close: function () { if (sheet && sheet.kind === 'receipt' && sheet.data.fromStudent) { openStudent(sheet.data.fromStudent); return; } closeSheet(); },
    addStudent: function () { openAdd(); },
    import: function () { openImport(); },
    runImport: function (t) { runImport(t); },
    template: function () {
      if (!needXLSX()) return;
      var rows = [
        { 'Admission No': 'QT-001', 'Student Name': 'Hussein Ahmed', Program: 'Full-time Hifz', 'Father/Husband Name': '', 'Date of Birth': '15/04/2012', Gender: 'Male', 'Mobile No': '', 'ITS No': '30412345', Email: '', 'Monthly fee': 250000 },
        { 'Admission No': 'QT-002', 'Student Name': 'Fatema Saifuddin', Program: 'Part-time Hifz', 'Father/Husband Name': '', 'Date of Birth': '02/09/2010', Gender: 'Female', 'Mobile No': '', 'ITS No': '30412352', Email: '', 'Monthly fee': 180000 }
      ];
      MZ.saveFile('Qism al Tahfeez students template.xlsx', xlsxBlob(rows, 'Students'));
    },
    exportLogins: function () {
      if (!needXLSX() || !S.newLogins.length) return;
      MZ.saveFile('Student logins ' + MZ.today() + '.xlsx', xlsxBlob(S.newLogins.map(function (l) { return { Name: l.name, Username: l.username, Password: l.password, Phone: l.phone || '' }; }), 'Logins'));
    },
    exportStudents: function () {
      var pg = programList();
      openSheet('exportStu', {}, head('Students', 'Download list')
        + '<form class="form" id="expForm" autocomplete="off"><div class="field"><label for="expProg">Program</label><select id="expProg"><option value="*">All programs (' + S.students.length + ' students)</option>'
        + pg.map(function (p) { return '<option value="' + esc(p.name) + '">' + esc(p.label) + ' (' + p.n + ' student' + (p.n === 1 ? '' : 's') + ')</option>'; }).join('') + '</select><span class="hint">The Excel file has only the students of the program you choose, in the same columns as before.</span></div>'
        + '<div class="btnrow"><button class="btn gold" type="button" data-act="exportGo">' + I.doc + 'Download Excel</button><button class="btn ghost" type="button" data-act="close">Cancel</button></div></form>');
    },
    exportGo: function () {
      if (!needXLSX()) return;
      var m = MZ.thisMonth(), pv = ($('#expProg') || {}).value || '*', list = S.students.filter(function (s) { return inProgram(s, pv); });
      if (!list.length) { MZ.toast('No students in that program.'); return; }
      closeSheet();
      MZ.toast(list.length + ' student' + (list.length === 1 ? '' : 's') + (pv === '*' ? '' : ' in ' + (pv || 'no program')) + ' downloaded.');
      MZ.saveFile('Qism al Tahfeez students ' + (pv === '*' ? '' : (pv || 'no program').replace(/[\\/:*?"<>|]/g, '') + ' ') + MZ.today() + '.xlsx', xlsxBlob(list.map(function (s) {
        var p = payMap[s.id + '|' + m];
        return { 'Admission No': s.admission_no, 'Student Name': s.full_name, Program: s.program, 'Father/Husband Name': s.guardian_name, 'Date of Birth': s.dob ? MZ.dateLabel(s.dob) : '', Gender: s.gender,
          'Mobile No': s.phone, 'ITS No': s.its_no, Email: s.email, Username: s.username, 'Monthly fee': s.monthly_fee, 'First month': s.start_month, Pages: s.pages, Keys: s.keys, ['Paid ' + MZ.monthLabel(m)]: p ? 'Yes' : 'No' };
      }), 'Students'));
    },
    copyText: function (t) { MZ.copy(t.dataset.text, t.dataset.msg || 'Login copied.'); },
    copyReceipt: function () { var d = sheet && sheet.data; if (d && d.p) MZ.copy(MZ.receiptText(d.p, d.s, S.settings), 'Receipt copied.'); },
    saveImg: function () { var d = sheet && sheet.data; if (d && d.p) MZ.saveReceipt(d.p, d.s, S.settings); },
    voidReceipt: function (t) { var id = +t.dataset.id || t.dataset.id; MZ.arm(t, function () { voidPayment(id); }, 'Tap again to cancel receipt'); },
    removeStudent: function (t) {
      var id = t.dataset.id;
      MZ.arm(t, function () {
        api.deleteStudent(id).then(function () {
          S.students = S.students.filter(function (s) { return s.id !== id; });
          S.payments = S.payments.filter(function (p) { return p.student_id !== id; }); indexPayments(); S.allPayments = null;
          closeSheet(); render(); MZ.toast('Student removed.');
        }).catch(function (e) { MZ.toast(e.message); });
      }, 'Tap again to remove');
    },
    staffRemove: function (t) {
      var id = t.dataset.id;
      MZ.arm(t, function () { api.removeStaff(id).then(function () { S.staff = null; render(); MZ.toast('Account removed.'); }).catch(function (e) { MZ.toast(e.message); }); }, 'Tap again to remove');
    },
    staffPw: function (t) {
      var row = t.closest('.staffrow'); if (!row || row.querySelector('form')) return;
      row.insertAdjacentHTML('beforeend', '<form class="staffpw" data-id="' + esc(t.dataset.id) + '" data-u="' + esc(t.dataset.u) + '" style="grid-column:1/-1;display:flex;gap:8px"><input class="input" type="text" minlength="6" required placeholder="New password for ' + esc(t.dataset.u) + '" aria-label="New password"><button class="btn sm gold" type="submit">Save</button></form>');
      row.querySelector('form input').focus();
    },
    pfilter: function (t) { S.pfilter = t.dataset.f; render(); },
    sfilter: function (t) { S.sfilter = t.dataset.f; render(); },
    disableStudent: function (t) {
      var id = t.dataset.id, st = studentById(id);
      MZ.arm(t, function () { api.setDisabled(id, true).then(function () { return api.listStudents(); }).then(function (l) { S.students = l; render(); openStudent(id, true); MZ.toast(MZ.firstName(st.full_name) + ' is disabled.'); }).catch(function (e) { MZ.toast(e.message); }); }, 'Tap again to disable');
    },
    enableStudent: function (t) {
      var id = t.dataset.id, st = studentById(id);
      api.setDisabled(id, false).then(function () { return api.listStudents(); }).then(function (l) { S.students = l; render(); openStudent(id, true); MZ.toast(MZ.firstName(st.full_name) + ' is active again and can sign in.'); }).catch(function (e) { MZ.toast(e.message); });
    },
    jadeed: function (t) { var sid = t.dataset.sid; t.disabled = true; progressAction('jadeed', sid, 1).then(function () { return refreshProgressFor(sid); }).catch(function (e) { MZ.toast(e.message); t.disabled = false; }); },
    ikhtibar: function (t) { var sid = t.dataset.sid; t.disabled = true; progressAction('ikhtibar', sid).then(function () { return refreshProgressFor(sid); }).catch(function (e) { MZ.toast(e.message); t.disabled = false; }); },
    undoKey: function (t) { var id = +t.dataset.id, sid = t.dataset.sid; t.disabled = true; api.undoKeyEvent(id).then(function () { MZ.toast('Removed. Keys and pages updated.'); return refreshProgressFor(sid); }).catch(function (e) { MZ.toast(e.message); t.disabled = false; }); },
    giveReward: function (t) {
      var sid = t.dataset.sid, st = studentById(sid);
      MZ.arm(t, function () { api.giveReward(sid).then(function () { MZ.toast('Reward marked as given to ' + MZ.firstName(st.full_name) + '.'); return refreshProgressFor(sid); }).catch(function (e) { MZ.toast(e.message); }); }, 'Tap again: reward given');
    },
    editFees: function () { openFees(); },
    fillFees: function (t) { var v = $('#allFee').value; if (v === '') { MZ.toast('Type a fee first.'); return; } MZ.$$('[data-fee]').forEach(function (i) { if (t.dataset.only === 'empty' && +i.value) return; i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }); },
    uploadNotice: function () { if (role() !== 'admin') return MZ.toast('Only the admin can upload files.'); var i = $('#noticeFile'); if (i) i.click(); },
    viewNotice: function (t) { var n = noticeById(t.dataset.id); if (n) showNotice(n); },
    downloadNotice: function (t) {
      var n = noticeById(t.dataset.id); if (!n) return;
      MZ.downloadNotice(api, n);
    },
    deleteNotice: function (t) {
      if (role() !== 'admin') return MZ.toast('Only the admin can delete notices.');
      var n = noticeById(t.dataset.id); if (!n) return;
      MZ.arm(t, function () { api.deleteNotice(n).then(function () { S.notices = null; closeSheet(); render(); MZ.toast('Notice deleted.'); }).catch(function (e) { MZ.toast(e.message); }); }, 'Tap again to delete');
    },
    resetDemo: function (t) { MZ.arm(t, function () { api.resetDemo(); reloadAll().then(function () { MZ.toast('Demo data restored.'); }); }); }
  };
  /* ===================================================== OCTOBER UPDATE */
  /* ---- view-only accounts: everything is visible, nothing can be changed */
  var VIEW_OK = ['retry', 'tab', 'sub', 'prevMonth', 'nextMonth', 'thisMonth', 'filter', 'receipt', 'student', 'sYear', 'close', 'copyText', 'copyReceipt', 'saveImg',
    'pfilter', 'sfilter', 'period', 'prevYear', 'nextYear', 'efilter', 'ffilter', 'bfilter', 'exportAccounts', 'hrAll', 'ikf', 'ikhGroup', 'rcMany', 'rcOne', 'rcAll', 'cert', 'certLatest', 'certAll',
    'approvals', 'printAccounts', 'paGo', 'report', 'rpEdit', 'viewNotice', 'downloadNotice', 'attDay', 'attToday', 'repMode', 'repMove', 'repToday', 'repPrint', 'repStudent', 'pgmPick', 'openProof', 'goalFollow', 'goalYear', 'schMode', 'schMove', 'schTomorrow', 'schOpen', 'saView', 'saDay', 'saMon', 'saFilter', 'saPrint', 'saRetry', 'hrQClear'];
  var VIEW_FORMS = ['rcForm', 'paForm'];
  function viewGuard(root) {
    if (!isViewer()) return;
    MZ.$$('[data-act]', root).forEach(function (el) { if (VIEW_OK.indexOf(el.dataset.act) < 0) el.hidden = true; });
    MZ.$$('form', root).forEach(function (f) {
      if (VIEW_FORMS.indexOf(f.id) >= 0 || f.classList.contains('search')) return;
      MZ.$$('button[type=submit]', f).forEach(function (b) { b.hidden = true; });
      MZ.$$('input,select,textarea', f).forEach(function (i) { if (i.type !== 'search') i.disabled = true; });
    });
    MZ.$$('.archcard[data-act=student],.person[data-act=student]', root).forEach(function (el) { el.hidden = false; });
  }
  document.addEventListener('click', function (e) {
    if (!isViewer()) return;
    var t = e.target.closest('[data-act]'); if (!t) return;
    if (VIEW_OK.indexOf(t.dataset.act) < 0) { e.preventDefault(); e.stopImmediatePropagation(); MZ.toast('This is a view-only account.'); }
  }, true);
  document.addEventListener('submit', function (e) {
    if (!isViewer() || e.target.id === 'signinForm' || VIEW_FORMS.indexOf(e.target.id) >= 0) return;
    e.preventDefault(); e.stopImmediatePropagation(); MZ.toast('This is a view-only account.');
  }, true);
  (function () {
    var mo = new MutationObserver(function () { if (isViewer()) { viewGuard($('#page')); viewGuard($('#overlay')); } });
    var go = function () { ['#page', '#overlay'].forEach(function (sel) { var el = $(sel); if (el) mo.observe(el, { childList: true, subtree: true }); }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  })();

  /* ---- new enrollments + welcome email */
  function newEnrollHTML(s) {
    if (!(isAdmin() || can('fees'))) return '';
    if (s.is_new && !s.disabled) {
      return '<section class="newenroll"><div class="ne-ico">' + I.mail + '</div><div><p class="eyebrow">New enrollment</p><h3 class="ne-t">Waiting for the first payment</h3>'
        + (MZ.welcomeFees(s, S.settings).missing ? '<p class="feeflag sm">' + I.flag + '<span><b>Fee not entered: please verify.</b> Enter the monthly fee before sending the welcome email.</span></p>' : '')
        + '<p class="muted">' + (s.welcome_sent_at ? 'Welcome email sent ' + esc(MZ.dateLabel(s.welcome_sent_at.slice(0, 10))) + '. ' : '') + 'Once the first fee is approved, ' + esc(MZ.firstName(s.full_name)) + ' moves to the active students on their own.</p>'
        + '<div class="btnrow"><button class="btn" data-act="welcome" data-id="' + esc(s.id) + '">' + I.mail + 'Welcome message</button><button class="btn" data-act="emailUpdate" data-id="' + esc(s.id) + '">' + I.mail + 'Email update</button>' + (isAdmin() ? '<button class="btn gold" data-act="startClasses" data-id="' + esc(s.id) + '">' + I.check + 'Start classes now</button>' : '') + '</div></div></section>';
    }
    return '<div class="btnrow updrow"><button class="btn" data-act="emailUpdate" data-id="' + esc(s.id) + '">' + I.mail + 'Email update</button><span class="hint">Send ' + esc(MZ.firstName(s.full_name)) + ' their fees due, progress and goal' + (s.email ? '' : ' (add an email first)') + '</span></div>';
  }
  function welcomeText(s) { return MZ.withWelcomeFees(String(S.settings.welcome_body || MZ.DEFAULT_WELCOME).replace(/\{name\}/g, s.full_name), s, S.settings); }
  function feeFlagHTML(s) {
    return '<p class="feeflag">' + I.flag + '<span><b>Fee not entered for ' + esc(MZ.firstName(s.full_name)) + '.</b> The welcome email will say the amount is to be confirmed; no amount is guessed. Enter the monthly fee on ' + esc(MZ.firstName(s.full_name)) + '’s page, then send it again.'
      + (studentById(s.id) ? ' <button class="linkbtn" type="button" data-act="student" data-id="' + esc(s.id) + '">Open ' + esc(MZ.firstName(s.full_name)) + '’s page</button>' : '') + '</span></p>';
  }
  function welcomeTpl() { return { subject: S.settings.welcome_subject || '', body: S.settings.welcome_body || MZ.DEFAULT_WELCOME }; }

  /* ---- email update to any student: fees due, progress, goal */
  var UPD_DEFAULT = { fees: true, progress: true, goal: true, pay: true };
  function updOpts() { return Object.assign({}, UPD_DEFAULT, S.updOpts || {}); }
  function ensureAllPays() {
    if (S.allPayments) return Promise.resolve(S.allPayments);
    if (!can('fees')) return Promise.resolve([]);
    return api.listPayments({}).then(function (l) { S.allPayments = l; return l; }).catch(function () { return []; });
  }
  function ensureProgNow() {
    var tm = MZ.thisMonth();
    if (S.progMonth === tm) return Promise.resolve(S.prog);
    if (S.progNow && S.progNow.month === tm) return Promise.resolve(S.progNow.map);
    if (!can('teach') && !isViewer()) return Promise.resolve({});
    return api.listProgress({ month: tm }).then(function (l) { var m = {}; l.forEach(function (r) { m[r.student_id] = r; }); S.progNow = { month: tm, map: m }; return m; }).catch(function () { return {}; });
  }
  function updSubject(s) { return 'Your update from Tahfeez Daressalaam · ' + MZ.monthLabel(MZ.thisMonth()); }
  function updFees(s, pays) { return MZ.feeSummary(s, pays); }
  function updateText(s, o, pays, r, note) {
    var cur = S.settings.currency, tm = MZ.thisMonth(), L = [];
    L.push('Assalamu alaikum *' + s.full_name + '*,', '', 'Here is your update from Tahfeez Daressalaam as of ' + MZ.dateLabel(MZ.today()) + '.');
    if (note && note.trim()) L.push('', note.trim());
    if (o.fees && MZ.effFee(s) > 0) {
      var sum = updFees(s, pays), pt = MZ.paidTotals(s, pays);
      L.push('', '*Fees*', 'Monthly fee: ' + MZ.money(MZ.effFee(s), cur) + (MZ.discountLabel(s, cur) ? ' (' + MZ.discountLabel(s, cur) + ')' : ''));
      L.push('Paid since you joined: ' + MZ.money(pt.total, cur) + (pt.months ? ' (' + pt.months + ' month' + (pt.months === 1 ? '' : 's') + ')' : ''));
      if (pt.pending) L.push('Waiting for approval: ' + MZ.money(pt.pending, cur));
      if (MZ.onLeave(s, tm)) L.push('You are on leave this month, so no fee is due for ' + MZ.monthLabel(tm) + '.');
      if (sum.balance > 0) {
        var ms = sum.unpaid.slice(-12).map(MZ.monthLabel);
        L.push('Amount due: *' + MZ.money(sum.balance, cur) + '*', 'For: ' + ms.join(', ') + (sum.unpaid.length > 12 ? ' and ' + (sum.unpaid.length - 12) + ' earlier months' : ''));
        if (o.pay) L.push('', MZ.PAY_DETAILS);
      } else L.push('All fees are paid up to ' + MZ.monthLabel(tm) + '. Thank you!');
    }
    if (o.progress) {
      var g = goalInfo(s, r, tm), ik = MZ.ikhAhead(s, S.settings, [r].filter(Boolean));
      L.push('', '*Hifz progress*', 'Memorised: ' + s.pages + ' of 604 pages (' + MZ.juzDone(s.pages) + ' juz complete)');
      if (s.cur_surah || s.cur_pos) L.push('Now at: ' + MZ.posLabel(s.cur_surah, s.cur_pos));
      if (g.goalN) L.push('This month (' + MZ.monthLabel(tm) + '): ' + (g.doneN || 0) + ' of ' + g.goalN + ' pages' + (g.done ? ' · goal reached, mashaAllah!' : g.toGo != null ? ' · ' + g.toGo + ' pages to go' : ''));
      else if (r && r.jadeed) L.push('Jadeed this month: ' + r.jadeed + ' pages');
      L.push('Keys earned: ' + s.keys);
      if (ik) L.push('Ikhtibar ahead: page ' + ik.page + (ik.away ? ', ' + ik.away + ' page' + (ik.away === 1 ? '' : 's') + ' away' : ', now') + '. Go to eLearning and check your ikhtibar history.');
    }
    if (o.goal) {
      var gN = goalInfo(s, r, tm).goalN, p = MZ.hafizPredict(s, S.settings, gN || 0);
      L.push('', '*Goal*');
      if (!p.left) L.push('All 604 pages memorised. Haafiz, mashaAllah!');
      else {
        L.push(p.left + ' pages to go to complete the Qur’an.');
        L.push('At 1 page a day: ' + MZ.spanLabel(p.one.span) + ' (around ' + MZ.monthLabel(p.one.month) + ')');
        L.push('At ½ page a day: ' + MZ.spanLabel(p.half.span) + ' (around ' + MZ.monthLabel(p.half.month) + ')');
        if (p.plan) L.push('At your takhteet of ' + p.plan.perMonth + ' pages a month: ' + MZ.spanLabel(p.plan.span) + ' (around ' + MZ.monthLabel(p.plan.month) + ')');
      }
    }
    L.push('', 'Regards', 'Admin', 'Tahfeez Daressalaam');
    return L.join('\n');
  }
  function updOptsHTML(o) {
    return '<fieldset class="updopts"><legend class="flabel">Include</legend>'
      + [['fees', 'Fees', 'monthly fee, total paid, amount due'], ['pay', 'How to pay', 'account details, when money is due'], ['progress', 'Hifz progress', 'pages, this month’s goal, keys, ikhtibar'], ['goal', 'Goal predictor', 'when they will finish']].map(function (c) {
        return '<label class="tickline"><input type="checkbox" data-upd="' + c[0] + '"' + (o[c[0]] ? ' checked' : '') + '> <span><b>' + c[1] + '</b> · ' + c[2] + '</span></label>';
      }).join('') + '</fieldset>'
      + '<div class="field"><label for="updNote">Your note (optional)</label><textarea id="updNote" class="input" rows="2" maxlength="600" placeholder="e.g. Classes are closed on Friday for Eid.">' + esc(S.updNote || '') + '</textarea></div>';
  }
  function readUpdOpts() {
    var o = updOpts(); document.querySelectorAll('[data-upd]').forEach(function (c) { o[c.dataset.upd] = c.checked; }); S.updOpts = o;
    var n = $('#updNote'); if (n) S.updNote = n.value; return o;
  }
  function openUpdate(sid) {
    var s = studentById(sid); if (!s) return;
    openSheet('update', { id: sid }, head('Email update', s.full_name) + '<p class="muted">Loading fees and progress…</p>');
    Promise.all([ensureAllPays(), ensureProgNow()]).then(function (res) {
      if (!sheet || sheet.kind !== 'update' || sheet.data.id !== sid) return;
      sheet.data.pays = res[0]; sheet.data.prog = res[1];
      drawUpdate();
    });
  }
  function drawUpdate() {
    if (!sheet || sheet.kind !== 'update') return;
    var s = studentById(sheet.data.id); if (!s) return;
    var o = updOpts(), txt = updateText(s, o, sheet.data.pays, sheet.data.prog[s.id], S.updNote), subj = updSubject(s), plain = txt.replace(/\*([^*\n]+)\*/g, '$1');
    var html = head('Email update', s.full_name)
      + '<div class="form">' + updOptsHTML(o) + '</div>'
      + '<div class="mailprev" style="margin-top:12px"><div class="mp-head"><span>To</span><b>' + esc(s.email || 'No email address yet') + '</b><span>Subject</span><b>' + esc(subj) + '</b></div><div class="mp-body" id="updBody">' + MZ.waBold(txt) + '</div></div>'
      + '<div class="btnrow" style="margin-top:12px">'
      + (s.email ? '<button class="btn gold" data-act="sendUpdate" data-id="' + esc(s.id) + '">' + I.mail + 'Send email now</button>' : '')
      + (s.email ? '<a class="btn" href="mailto:' + esc(s.email) + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(plain) + '">Open in my email app</a>' : '')
      + (s.phone ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(MZ.wa(s.phone, txt)) + '">Send on WhatsApp</a>' : '')
      + '<button class="btn" data-act="copyText" data-msg="Message copied." data-text="' + esc(txt) + '">Copy text</button></div>'
      + '<p id="updErr" class="okmsg" hidden style="margin-top:10px;background:var(--warn-bg);color:var(--warn)"></p>'
      + (s.email ? '' : '<p class="hint" style="margin-top:10px">Add the student’s email under Details to send by email.</p>');
    reSheet('update', sheet.data, html);
  }
  function reSheet(kind, data, html) { var el = document.querySelector('#overlay .sheet'), y = el ? el.scrollTop : 0; openSheet(kind, data, html); el = document.querySelector('#overlay .sheet'); if (el) el.scrollTop = y; }
  function updAudience(kind) {
    var act = S.students.filter(function (s) { return !s.disabled && s.email; });
    if (kind === 'due') return act.filter(function (s) { return MZ.effFee(s) > 0 && MZ.feeSummary(s, S.allPayments || []).balance > 0; });
    return act;
  }
  function openBulkUpdate() {
    openSheet('bulkupd', {}, head('Email updates', 'Send to many students') + '<p class="muted">Loading fees and progress…</p>');
    Promise.all([ensureAllPays(), ensureProgNow()]).then(function (res) {
      if (!sheet || sheet.kind !== 'bulkupd') return;
      sheet.data.prog = res[1]; drawBulk();
    });
  }
  function drawBulk() {
    if (!sheet || sheet.kind !== 'bulkupd') return;
    var d = sheet.data, aud = d.aud || 'all', all = updAudience('all'), due = updAudience('due'), list = aud === 'due' ? due : all, noMail = S.students.filter(function (s) { return !s.disabled && !s.email; }).length;
    var ex = list[0], o = updOpts();
    var html = head('Email updates', 'Send to many students')
      + '<div class="form"><fieldset class="updopts"><legend class="flabel">Send to</legend>'
      + '<label class="tickline"><input type="radio" name="updAud" value="all"' + (aud === 'all' ? ' checked' : '') + '> <span><b>All active students with an email</b> · ' + all.length + '</span></label>'
      + '<label class="tickline"><input type="radio" name="updAud" value="due"' + (aud === 'due' ? ' checked' : '') + '> <span><b>Only students with fees due</b> · ' + due.length + '</span></label></fieldset>'
      + updOptsHTML(o) + '</div>'
      + (noMail ? '<p class="hint">' + noMail + ' active student' + (noMail === 1 ? ' has' : 's have') + ' no email address and will be skipped.</p>' : '')
      + (ex ? '<p class="eyebrow" style="margin-top:12px">Example · ' + esc(ex.full_name) + '</p><div class="mailprev"><div class="mp-body" style="max-height:260px">' + MZ.waBold(updateText(ex, o, S.allPayments || [], d.prog[ex.id], S.updNote)) + '</div></div>' : '')
      + '<div class="btnrow" style="margin-top:12px">' + (list.length ? '<button class="btn gold" data-act="sendBulk"' + (d.running ? ' disabled' : '') + '>' + I.mail + 'Send to ' + list.length + ' student' + (list.length === 1 ? '' : 's') + '</button>' : '') + '<button class="btn" data-act="close">Close</button></div>'
      + '<p class="hint">Each student gets their own figures. The free email plan sends up to 100 emails a day.</p>'
      + '<div id="bulkLog">' + (d.log || '') + '</div>';
    reSheet('bulkupd', d, html);
  }
  function bulkLog(h) { if (!sheet || sheet.kind !== 'bulkupd') return; sheet.data.log = h; var el = $('#bulkLog'); if (el) el.innerHTML = h; }
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches && t.matches('[data-upd]')) { readUpdOpts(); if (sheet && sheet.kind === 'update') drawUpdate(); else if (sheet && sheet.kind === 'bulkupd') drawBulk(); }
    else if (t.name === 'updAud' && sheet && sheet.kind === 'bulkupd') { readUpdOpts(); sheet.data.aud = t.value; drawBulk(); }
    else if (t.id === 'updNote') { readUpdOpts(); if (sheet && sheet.kind === 'update') drawUpdate(); else if (sheet && sheet.kind === 'bulkupd') drawBulk(); }
  });
  function openWelcome(sid) {
    var s = studentById(sid); if (!s) return;
    var txt = welcomeText(s), plain = txt.replace(/\*([^*\n]+)\*/g, '$1'), subj = S.settings.welcome_subject.replace(/\{name\}/g, s.full_name);
    openSheet('welcome', { id: sid }, head('Welcome message', s.full_name)
      + (MZ.welcomeFees(s, S.settings).missing ? feeFlagHTML(s) : '')
      + '<div class="mailprev"><div class="mp-head"><span>To</span><b>' + esc(s.email || 'No email address yet') + '</b><span>Subject</span><b>' + esc(subj) + '</b></div><div class="mp-body">' + MZ.waBold(txt) + '</div></div>'
      + '<div class="btnrow" style="margin-top:12px">'
      + (s.email ? '<button class="btn gold" data-act="sendWelcome" data-id="' + esc(sid) + '">' + I.mail + 'Send email now</button>' : '')
      + (s.email ? '<a class="btn" href="mailto:' + esc(s.email) + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(plain) + '">Open in my email app</a>' : '')
      + (s.phone ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(MZ.wa(s.phone, txt)) + '">Send on WhatsApp</a>' : '')
      + '<button class="btn" data-act="copyText" data-msg="Message copied." data-text="' + esc(txt) + '">Copy text</button></div>'
      + '<p id="welErr" class="okmsg" hidden style="margin-top:10px;background:var(--warn-bg);color:var(--warn)"></p>'
      + '<p class="hint" style="margin-top:10px">Change this message in Settings → Welcome email.</p>');
  }

  /* ---- ikhtibar pages: alert 20 pages before */
  function ikhAlertHTML(s, prog) {
    var ik = MZ.ikhAhead(s, S.settings, prog); if (!ik) return '';
    return '<div class="ikalert"><span class="ia-ico">' + I.flag + '</span><div><b>' + (ik.away ? 'Ikhtibar ahead: page ' + ik.page + ', ' + ik.away + ' page' + (ik.away === 1 ? '' : 's') + ' to go' : 'Ikhtibar page ' + ik.page + ' reached') + '</b>'
      + '<small>Go to eLearning and check your ikhtibar history.' + (S.settings.elearning_url ? ' <a href="' + esc(S.settings.elearning_url) + '" target="_blank" rel="noopener">Open eLearning</a>' : '') + '</small></div></div>';
  }
  function ikhAheadCardHTML() {
    var list = S.students.filter(function (s) { return !s.disabled; }).map(function (s) { return { s: s, ik: MZ.ikhAhead(s, S.settings, [S.prog[s.id]].filter(Boolean)) }; })
      .filter(function (x) { return x.ik; }).sort(function (a, b) { return a.ik.away - b.ik.away; });
    var pages = S.settings.ikhtibar_pages.join(', ');
    return '<section class="card ikahead-card"><div class="boxhead" style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><div><p class="eyebrow">Coming up by page</p><h3>Ikhtibar ahead</h3></div><small class="muted">Ikhtibar pages: ' + esc(pages) + ' · alert ' + S.settings.ikhtibar_alert_pages + ' pages before' + (isAdmin() ? ' · change in Settings' : '') + '</small></div>'
      + (list.length ? '<div class="ikahead-list">' + list.map(function (x) {
        return '<button class="ikah" data-act="student" data-id="' + esc(x.s.id) + '"><span class="av">' + esc(MZ.initials(x.s.full_name)) + '</span><span><b>' + esc(x.s.full_name) + '</b><small>Now at ' + esc(MZ.posLabel(x.s.cur_surah, x.s.cur_pos, true)) + ' · going ' + (x.ik.dir < 0 ? 'back' : 'forward') + '</small></span><span class="ikah-n"><b class="num">p.' + x.ik.page + '</b><small>' + (x.ik.away ? 'in ' + x.ik.away + ' page' + (x.ik.away === 1 ? '' : 's') : 'now') + '</small></span></button>';
      }).join('') + '</div>' : '<p class="muted" style="margin-top:6px">No student is within ' + S.settings.ikhtibar_alert_pages + ' pages of an ikhtibar page right now.</p>') + '</section>';
  }

  /* ---- goal predictor */
  function predictHTML(s, monthlyGoal) {
    var p = MZ.hafizPredict(s, S.settings, monthlyGoal || 0);
    if (!p.left) return '<div class="predict done"><b>Haafiz</b><small>All 604 pages memorised.</small></div>';
    var cell = function (t, sub, sp, m) { return '<div class="pr-c"><span>' + t + '</span><b>' + esc(MZ.spanLabel(sp)) + '</b><small>' + (sub ? sub + ' · ' : '') + 'around ' + esc(MZ.monthLabel(m)) + '</small></div>'; };
    return '<div class="predict"><p class="eyebrow">Goal predictor · ' + p.left + ' pages to go</p><div class="pr-grid">'
      + cell('1 page a day', '', p.one.span, p.one.month)
      + cell('½ page a day', (p.days / 2) + ' pages a year', p.half.span, p.half.month)
      + (p.plan ? cell('Takhteet: ' + p.plan.perMonth + ' pages a month', p.plan.perYear + ' a year · ' + p.plan.yearEnd + ' pages by December', p.plan.span, p.plan.month) : '')
      + '</div></div>';
  }

  /* ---- settings: ikhtibar pages + eLearning, welcome email */
  function ikhSettingsHTML() {
    var s = S.settings;
    return '<form class="form settings card" id="ikhSetForm" style="margin-top:14px" autocomplete="off"><div><p class="eyebrow">Ikhtibar pages &amp; goal predictor</p><p class="muted" style="font-size:13.5px">When a student comes within the alert distance of one of these pages, the admin and the student see that an ikhtibar is coming, with a link to eLearning.</p></div>'
      + '<div class="field"><label for="ipPages">Ikhtibar pages</label><input id="ipPages" required value="' + esc(s.ikhtibar_pages.join(', ')) + '"><span class="hint">Page numbers, separated by commas</span></div>'
      + '<div class="two"><div class="field"><label for="ipAlert">Alert this many pages before</label><input id="ipAlert" type="number" min="1" max="100" required value="' + s.ikhtibar_alert_pages + '"></div>'
      + '<div class="field"><label for="ipDays">Working days in a year</label><input id="ipDays" type="number" min="50" max="365" required value="' + s.hafiz_days_per_year + '"><span class="hint">Used by the goal predictor</span></div></div>'
      + '<div class="field"><label for="ipUrl">eLearning link</label><input id="ipUrl" maxlength="300" inputmode="url" placeholder="https://…" value="' + esc(s.elearning_url) + '"></div>'
      + '<div><button class="btn gold" type="submit">Save</button></div></form>';
  }
  function schMailSettingsHTML() {
    var v = S.settings.schedule_admin_email || '';
    return '<form class="form settings card" id="schMailForm" style="margin-top:14px" autocomplete="off"><div><p class="eyebrow">Schedule emails</p><p class="muted" style="font-size:13.5px">Where “Notify Admin” sends lesson emails. Students and teachers get theirs at the email saved on their own records.</p></div>'
      + '<div class="field"><label for="smAdmin">Admin email for schedule notifications</label><input id="smAdmin" type="email" maxlength="200" value="' + esc(v) + '" placeholder="e.g. office@yourdomain.com"><span class="hint">' + (v ? 'Notify Admin sends to this address.' : 'Not set: the Notify Admin button stays off until you add one.') + '</span></div>'
      + '<div class="btnrow"><button class="btn gold" type="submit">Save</button></div></form>';
  }
  function welcomeSettingsHTML() {
    var s = S.settings;
    return '<form class="form settings card" id="welForm" style="margin-top:14px" autocomplete="off"><div><p class="eyebrow">Welcome email</p><p class="muted" style="font-size:13.5px">Sent to a new student’s email when you add them. Use {name} for the student’s name, {fees} for the fee details and *stars* for bold. Without {fees}, the fee details go just before the payment instructions.</p></div>'
      + '<div class="field"><label for="wReg">Registration fee, one time (' + esc(s.currency) + ', optional)</label><input id="wReg" type="number" min="0" step="any" value="' + esc(s.registration_fee || '') + '" placeholder="Leave empty if there is none"><span class="hint">Added to the fee details with the student’s own monthly fee, discount and start month.</span></div>'
      + '<div class="field"><label for="wSubj">Subject</label><input id="wSubj" required maxlength="150" value="' + esc(s.welcome_subject) + '"></div>'
      + '<div class="field"><label for="wBody">Message</label><textarea id="wBody" class="input" rows="14" maxlength="5000" required>' + esc(s.welcome_body) + '</textarea></div>'
      + '<div class="btnrow"><button class="btn gold" type="submit">Save message</button><button class="btn" type="button" data-act="welReset">Use the standard message</button></div>'
      + (MZ.LIVE ? '<p class="hint">Automatic sending needs the email service set up once (see README → Welcome email). Until then you can send it from the student’s page.</p>' : '<p class="hint">Demo mode cannot send emails; the student’s page shows the message to send yourself.</p>') + '</form>';
  }

  /* ---- teacher's own profile */
  /* ------------------------------------------------ phone alerts and emails for teachers */
  function pushState() {
    if (S.pushState === undefined) { S.pushState = null; MZ.push.state().then(function (v) { S.pushState = v; if (S.tab === 'profile' || S.tab === 'schedule') render(); }); }
    return S.pushState;
  }
  function alertsCardHTML(compact) {
    var st = pushState(), email = S.myProf && S.myProf.data && S.myProf.data.email, bell = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.6 2H4.4L6 16Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    if (st === null) return '';
    if (compact && (st === 'on' || st === 'unsupported' || S.pushHidden)) return '';
    var body, acts = '';
    if (st === 'on') { body = '<b>Phone alerts are on</b><small>This device tells you when a student is allocated or handed over to you, even when the portal is closed.</small>'; acts = '<button class="btn sm" data-act="pushTest">Send me a test</button><button class="btn sm ghost" data-act="pushOff">Turn off</button>'; }
    else if (st === 'blocked') body = '<b>Alerts are blocked on this device</b><small>Open your browser’s site settings for this page, set Notifications to Allow, then come back here.</small>';
    else if (st === 'install') body = '<b>Get alerts on your iPhone</b><small>In Safari tap <b>Share</b>, then <b>Add to Home Screen</b>. Open Tahfeez from your home screen and turn alerts on here.</small>';
    else if (st === 'unsupported') body = '<b>This browser can’t show phone alerts</b><small>Open the portal in Chrome, Edge, Firefox or Safari on your phone. You still get an email.</small>';
    else { body = '<b>Know the moment you get a student</b><small>Turn on alerts and your phone tells you when a student is allocated or handed over to you, with the day and time.</small>'; acts = '<button class="btn gold sm" data-act="pushOn">' + I.check + 'Turn on phone alerts</button>' + (compact ? '<button class="btn sm ghost" data-act="pushHide">Later</button>' : ''); }
    return '<section class="alertcard' + (st === 'on' ? ' on' : '') + (compact ? ' compact' : '') + '"><span class="ac-bell">' + bell + '</span><div class="ac-text">' + body
      + (!compact ? '<small class="ac-mail">' + I.mail + (email ? 'Emails go to <b>' + esc(email) + '</b>' : 'Add your email below to get an email too.') + '</small>' : '') + '</div>'
      + (acts ? '<div class="ac-acts">' + acts + '</div>' : '') + (!compact && !MZ.isApp() ? '<div class="ac-install" data-install>' + MZ.installHTML() + '</div>' : '') + '</section>';
  }
  // after students are allocated or moved: email + phone alert to their (new) teachers
  function tellTeachers(ids, wait) {
    ids = (ids || []).filter(Boolean); if (!ids.length || !api.notifyTeachers) return Promise.resolve();
    return api.notifyTeachers(ids).then(function (r) {
      var l = (r && r.teachers) || [], st = (r && r.students) || []; if (!l.length && !st.length) return;
      var parts = l.map(function (t) {
        var nm = t.teacher || 'The teacher', how = [];
        if (r.demo) return nm + (t.email ? ' gets an email' : ' has no email in HR') + (t.devices ? ' and a phone alert' : '');
        if (t.emailed) how.push('emailed'); if (t.pushed) how.push('alerted on their phone');
        return nm + (how.length ? ' was ' + how.join(' and ') : (t.email || t.devices ? ' could not be reached just now' : ' has no email in HR and no phone alerts yet'));
      });
      if (st.length) {
        var mailed = st.filter(function (x) { return r.demo ? x.email : x.emailed; }).length, noMail = st.filter(function (x) { return !x.email; }).map(function (x) { return MZ.firstName(x.student || ''); });
        parts.push((mailed ? mailed + ' student' + (mailed === 1 ? '' : 's') + (r.demo ? ' get' : ' got') + ' an email with the teacher and time' : 'No student email sent') + (noMail.length ? ' (' + noMail.slice(0, 3).join(', ') + (noMail.length > 3 ? ' and ' + (noMail.length - 3) + ' more' : '') + ' ha' + (noMail.length === 1 ? 's' : 've') + ' no email)' : ''));
      }
      setTimeout(function () { MZ.toast((r.demo ? 'In the live portal: ' : '') + parts.join('. ') + '.'); }, 2600);
    }).catch(function (e) {
      if (e.notDeployed) { if (!S.alertWarned && S.role === 'admin') { S.alertWarned = 1; setTimeout(function () { MZ.toast('Teacher email and phone alerts are not switched on yet: deploy the “notify-teacher” function in Supabase.'); }, 2600); } return; }
      setTimeout(function () { MZ.toast('Could not alert the teacher: ' + e.message); }, 2600);
    });
  }
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'open' && (TABS[role()] || []).indexOf('schedule') >= 0) { S.tab = 'schedule'; S.sch.mode = 'day'; loadSchedule(true); render(); }
  });
  /* ---- Teacher Portal: My Feedback (students' feedback about me only; anonymous; read only) ---- */
  S.mfb = { p: '6', data: null, key: '', src: 'students', adm: null };
  // feedback from the Admin / HR team: the institute's monthly ratings of this teacher, read only
  function mfbAdminLoad(quiet) {
    if (!api.myAdminFeedback || S.mfb.admLoading) return;
    S.mfb.admLoading = true;
    api.myAdminFeedback().then(function (l) {
      var changed = JSON.stringify(l || []) !== JSON.stringify(S.mfb.adm);
      S.mfb.adm = l || []; S.mfb.admLoading = false; S.mfb.admAt = new Date(); S.mfb.admErr = null;
      if (S.tab === 'myfeedback' && S.mfb.src === 'admin' && (changed || !quiet)) render();
    }).catch(function (e) { S.mfb.admLoading = false; S.mfb.adm = []; S.mfb.admErr = /my_admin_feedback|function/i.test(e.message) ? 'This needs the latest database update (supabase-update-2.sql).' : e.message; if (S.tab === 'myfeedback') render(); });
  }
  function mfbAdminHTML() {
    if (S.mfb.adm === null) { mfbAdminLoad(); return '<p class="muted" style="margin-top:14px">Loading…</p>'; }
    if (S.mfb.admErr) return '<div class="empty"><h3>Could not load</h3><p>' + esc(S.mfb.admErr) + '</p></div>';
    var L = S.mfb.adm;
    if (!L.length) return '<div class="empty"><h3>No feedback from Admin / HR yet</h3><p>When the admin rates you under HR → Teacher ratings, it appears here by itself.</p></div>' + critGuideHTML(false);
    var all = L.map(function (x) { return MZ.scoreAvg(x.scores); }).filter(Boolean), avg = all.reduce(function (a, b) { return a + b; }, 0) / (all.length || 1);
    var h = '<section class="card mfbtop"><div class="mfbscore"><b class="num">' + avg.toFixed(1) + '</b>' + stars(Math.round(avg)) + '<small>average of ' + plural(L.length, 'rating') + ' from Admin / HR</small></div>'
      + '<div class="mfbnotes"><div class="fbnote"><b>Latest</b><p>' + esc(MZ.monthLabel(L[0].month)) + ' · ' + MZ.scoreAvg(L[0].scores).toFixed(1) + ' out of 5' + (L[0].rated_at ? ' · given ' + esc(MZ.dateLabel(String(L[0].rated_at).slice(0, 10))) : '') + '</p></div></div></section>';
    return h + L.map(function (x) {
      var a = MZ.scoreAvg(x.scores), crit = MZ.TEACHER_CRITERIA.map(function (c) { return { k: c[0], name: c[1], v: +x.scores[c[0]] || 0 }; });
      var strong = crit.filter(function (c) { return c.v >= 4.5; }), grow = crit.filter(function (c) { return c.v && c.v < 3.5; });
      return '<section class="card mfbadm" style="margin-top:14px"><div class="mfbadm-head"><div><p class="eyebrow">Admin / HR feedback</p><h3>' + esc(MZ.monthLabel(x.month)) + '</h3><small class="muted">' + (x.rated_at ? 'Given ' + esc(MZ.dateLabel(String(x.rated_at).slice(0, 10))) : '') + '</small></div><div class="mfbadm-score">' + stars(Math.round(a)) + '<b class="num">' + a.toFixed(1) + '</b></div></div>'
        + fbBars(x.scores)
        + '<div class="fbsplit">'
        + (x.positives || strong.length ? '<div class="fbnote good"><b>Appreciation</b>' + (x.positives ? '<p>' + esc(x.positives) + '</p>' : '') + (strong.length ? '<p class="muted" style="margin-top:4px">Strong: ' + strong.map(function (c) { return esc(c.name); }).join(', ') + '</p>' : '') + '</div>' : '')
        + (x.improve || grow.length ? '<div class="fbnote warn"><b>Areas to improve</b>' + (x.improve ? '<p>' + esc(x.improve) + '</p>' : '') + (grow.length ? '<ul>' + grow.map(function (c) { return '<li><b>' + esc(c.name) + '</b> (' + c.v.toFixed(1) + '): ' + esc(MZ.TEACHER_CRITERIA_DESC[c.k]) + '</li>'; }).join('') + '</ul>' : '') + '</div>' : '')
        + '</div>'
        + (x.comment ? '<div class="fbnote"><b>Comment</b><p>' + esc(x.comment) + '</p></div>' : '')
        + '</section>';
    }).join('') + '<p class="hint" style="margin-top:12px">Only you and the admin can see this. You can read it but not change or delete it.</p>' + critGuideHTML(false);
  }
  function mfbRange() { var m = MZ.thisMonth(), n = { '3': 2, '6': 5, '12': 11 }[S.mfb.p]; return S.mfb.p === 'year' ? { from: m.slice(0, 4) + '-01', to: m.slice(0, 4) + '-12', label: 'This year' } : { from: MZ.addMonths(m, -n), to: m, label: 'Last ' + S.mfb.p + ' months' }; }
  function mfbLoad(force) {
    var r = mfbRange(), key = r.from + '|' + r.to;
    if (!api.myTeacherFeedback || (!force && (S.mfb.key === key || S.mfb.loading === key))) return;
    S.mfb.loading = key;
    api.myTeacherFeedback(r.from, r.to).then(function (l) {
      var changed = JSON.stringify(l || []) !== JSON.stringify(S.mfb.data || null);
      S.mfb.data = l || []; S.mfb.key = key; S.mfb.loading = null; S.mfb.at = new Date();
      if (S.tab === 'myfeedback' && (changed || force !== 'quiet')) render();
    }).catch(function (e) { S.mfb.loading = null; S.mfb.data = []; S.mfb.key = key; S.mfb.err = e.message; if (S.tab === 'myfeedback') render(); });
  }
  // new feedback shows up by itself while the page is open
  setInterval(function () { if (S.tab === 'myfeedback' && document.visibilityState === 'visible') { if (S.mfb.src === 'admin') mfbAdminLoad(true); else mfbLoad('quiet'); } }, 60000);
  function renderMyFeedback() {
    var SRC = [['students', 'From students'], ['admin', 'From Admin / HR']];
    var tabs = '<div class="seg mfbsrc" role="tablist" aria-label="Feedback source">' + SRC.map(function (x) { return '<button class="chip" type="button" role="tab" data-act="mfbSrc" data-src="' + x[0] + '" aria-selected="' + (S.mfb.src === x[0]) + '" aria-pressed="' + (S.mfb.src === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
    if (S.mfb.src === 'admin') return '<div class="pagehead"><div><p class="eyebrow">My Feedback</p><h1>Feedback from Admin / HR</h1><p class="stat">The institute’s monthly rating of your work, with appreciation and areas to improve. It appears here as soon as the admin saves it.</p></div></div>' + tabs + mfbAdminHTML();
    mfbLoad();
    var r = mfbRange(), P = [['3', 'Last 3 months'], ['6', 'Last 6 months'], ['12', 'Last 12 months'], ['year', 'This year']];
    var h = '<div class="pagehead"><div><p class="eyebrow">My Feedback</p><h1>What my students say</h1><p class="stat">Students’ feedback about you, 1 to 5 stars. Names are never shown, and only you (and the admin) can see this. It updates by itself when new feedback arrives.</p></div></div>'
      + tabs + '<div class="fbbar"><div class="seg" role="group" aria-label="Period">' + P.map(function (p) { return '<button class="chip" type="button" data-act="mfbPeriod" data-p="' + p[0] + '" aria-pressed="' + (S.mfb.p === p[0]) + '">' + p[1] + '</button>'; }).join('') + '</div>' + (S.mfb.at ? '<small class="muted">Updated ' + esc(S.mfb.at.toTimeString().slice(0, 5)) + '</small>' : '') + '</div>';
    if (S.mfb.key !== r.from + '|' + r.to) return h + '<p class="muted" style="margin-top:14px">Loading…</p>';
    var rows = S.mfb.data || [], n = rows.reduce(function (a, x) { return a + x.responses; }, 0);
    if (!n) return h + '<div class="empty"><h3>No feedback received yet</h3><p>When students give feedback from their portal, your averages and their comments appear here' + (S.mfb.p !== '12' ? '. Try a longer period above.' : '.') + '</p></div>' + critGuideHTML(false);
    var sums = {}; rows.forEach(function (x) { MZ.TEACHER_CRITERIA.forEach(function (c) { sums[c[0]] = (sums[c[0]] || 0) + (+x.avg_scores[c[0]] || 0) * x.responses; }); });
    var av = {}; MZ.TEACHER_CRITERIA.forEach(function (c) { av[c[0]] = sums[c[0]] / n; });
    var overall = MZ.scoreAvg(av), crit = MZ.TEACHER_CRITERIA.map(function (c) { return { k: c[0], name: c[1], v: av[c[0]] }; });
    var strong = crit.filter(function (c) { return c.v >= 4.5; }), grow = crit.filter(function (c) { return c.v < 3.5; }).sort(function (a, b) { return a.v - b.v; }), low = crit.slice().sort(function (a, b) { return a.v - b.v; })[0];
    h += '<section class="card mfbtop"><div class="mfbscore"><b class="num">' + overall.toFixed(1) + '</b>' + stars(Math.round(overall)) + '<small>overall, from ' + plural(n, 'response') + ' · ' + esc(r.label.toLowerCase()) + '</small></div>'
      + '<div class="mfbnotes">' + (strong.length ? '<div class="fbnote good"><b>Your strengths</b><p>' + strong.map(function (c) { return esc(c.name) + ' (' + c.v.toFixed(1) + ')'; }).join(', ') + '</p></div>' : '')
      + (grow.length ? '<div class="fbnote warn"><b>Areas to grow</b><ul>' + grow.map(function (c) { return '<li><b>' + esc(c.name) + '</b> (' + c.v.toFixed(1) + '): ' + esc(MZ.TEACHER_CRITERIA_DESC[c.k]) + '</li>'; }).join('') + '</ul></div>' : low.v < 4 ? '<div class="fbnote warn"><b>Could improve</b><p>' + esc(low.name) + ' (' + low.v.toFixed(1) + ') is your lowest category.</p></div>' : '<div class="fbnote good"><b>Well done</b><p>Every category is 4 or more.</p></div>') + '</div></section>';
    h += '<section class="card" style="margin-top:14px"><h3>Each category</h3>' + fbBars(av) + '</section>';
    // trend: month by month
    if (rows.length > 1) {
      var mx = rows.map(function (x) { return { m: x.month, v: MZ.scoreAvg(x.avg_scores), n: x.responses }; });
      h += '<section class="card" style="margin-top:14px"><h3>Month by month</h3><div class="mfbtrend">' + mx.map(function (x) { return '<div class="mfbcol"><span class="mfbbar" style="height:' + Math.round(x.v / 5 * 100) + '%" title="' + x.v.toFixed(1) + '"></span><b class="num">' + x.v.toFixed(1) + '</b><small>' + esc(MZ.monthShort(x.m)) + '</small><small class="muted">' + x.n + '</small></div>'; }).join('') + '</div><p class="hint">Bar = your overall average that month; the small number is how many students answered.</p></section>';
    }
    // comments by month
    var withC = rows.filter(function (x) { return x.comments && x.comments.length; }).slice().reverse();
    h += '<section class="card" style="margin-top:14px"><h3>What students wrote</h3>' + (withC.length ? withC.map(function (x) { return '<div class="mfbmonth"><p class="flabel">' + esc(MZ.monthLabel(x.month)) + '</p><div class="fbcomments">' + x.comments.map(function (c) { return '<p>“' + esc(c) + '”</p>'; }).join('') + '</div></div>'; }).join('') : '<p class="muted">No written comments in this period.</p>') + '<p class="hint">Comments are shown without names, in no particular order. You can read feedback but not change or delete it.</p></section>';
    return h + critGuideHTML(false);
  }
  function renderProfile() {
    if (S.myProf === undefined && !S.myProfLoading) {
      S.myProfLoading = true;
      api.myTeacherProfile().then(function (p) { S.myProf = p || null; S.myProfLoading = false; render(); }).catch(function (e) { S.myProf = null; S.myProfLoading = false; MZ.toast(e.message); });
    }
    var h = '<div class="pagehead"><div><p class="eyebrow">HR</p><h1>My profile</h1><p class="stat">Keep your details up to date. The admin sees them under HR → Teachers.</p></div></div>';
    if (S.myProf === undefined) return h + '<p class="muted">Loading…</p>';
    var d = (S.myProf && S.myProf.data) || {};
    return h + alertsCardHTML(false) + myWorkHTML() + '<form class="form card profform" id="profForm" autocomplete="off">'
      + '<div class="field"><label for="pfName">Full name</label><input id="pfName" required maxlength="120" value="' + esc(d.full_name) + '"></div>'
      + '<div class="two"><div class="field"><label for="pfIts">ITS no</label><input id="pfIts" inputmode="numeric" maxlength="8" value="' + esc(d.its_no) + '" placeholder="8 digits"></div>'
      + '<div class="field"><label for="pfSanad">Sanad year</label><input id="pfSanad" inputmode="numeric" maxlength="4" value="' + esc(d.sanad_year) + '" placeholder="e.g. 2015"></div></div>'
      + '<div class="two"><div class="field"><label for="pfEmail">Email</label><input id="pfEmail" type="email" maxlength="120" value="' + esc(d.email) + '"></div>'
      + '<div class="field"><label for="pfPhone">Phone</label><input id="pfPhone" inputmode="tel" maxlength="20" value="' + esc(d.phone) + '"></div></div>'
      + '<fieldset class="field"><legend>Tadreeb al Huffaz program attended?</legend><div class="yesno">' + ['Yes', 'No'].map(function (o) { return '<label class="yn"><input type="radio" name="pfTad" value="' + o + '"' + (d.tadreeb === o ? ' checked' : '') + '><span>' + o + '</span></label>'; }).join('') + '</div></fieldset>'
      + '<p class="err" id="pfErr" hidden></p><div><button class="btn gold" type="submit" id="pfBtn">' + I.check + 'Save my profile</button></div></form>' + myPwHTML();
  }
  function saveProfile() {
    var err = $('#pfErr'), b = $('#pfBtn'), t = document.querySelector('input[name=pfTad]:checked');
    b.disabled = true; err.hidden = true;
    api.saveMyTeacherProfile({ full_name: $('#pfName').value.trim(), its_no: $('#pfIts').value.replace(/\D/g, ''), sanad_year: $('#pfSanad').value.trim(), email: $('#pfEmail').value.trim().toLowerCase(), phone: $('#pfPhone').value.replace(/[^\d+]/g, ''), tadreeb: t ? t.value : '' })
      .then(function (p) { S.myProf = p; render(); MZ.toast('Profile saved.'); })
      .catch(function (e) { err.textContent = e.message; err.hidden = false; b.disabled = false; });
  }

  /* ---- weekly and yearly reports */
  /* ================================================================ REPORTS: weekly, monthly, yearly
     All three use the same records and rules (MZ.repWeek / repMonth / repYear in core.js). */
  S.rep = { mode: 'week', week: MZ.today(), month: MZ.thisMonth(), year: +MZ.thisMonth().slice(0, 4), sid: '', ev: {}, prog: {} };
  function repReset() { S.rep.ev = {}; S.rep.prog = {}; Object.keys(S.rep).forEach(function (k) { if (/^[lp]\d/.test(k)) delete S.rep[k]; }); }
  function repEvents(months) {
    var miss = months.filter(function (m) { return !S.rep.ev[m] && !S.rep['l' + m]; });
    miss.forEach(function (m) { S.rep['l' + m] = 1; api.listKeyEventsMonth(m).then(function (l) { S.rep.ev[m] = l || []; render(); }).catch(function () { S.rep.ev[m] = []; render(); }); });
    return months.every(function (m) { return S.rep.ev[m]; }) ? [].concat.apply([], months.map(function (m) { return S.rep.ev[m]; })) : null;
  }
  function repProgYear(y) {
    if (!S.rep.prog[y] && !S.rep['p' + y]) {
      S.rep['p' + y] = 1;
      var ms = []; for (var i = 1; i <= 12; i++) ms.push(y + '-' + MZ.pad(i));
      Promise.all(ms.map(function (m) { return api.listProgress({ month: m }).catch(function () { return []; }); })).then(function (r) { S.rep.prog[y] = [].concat.apply([], r); render(); });
    }
    return S.rep.prog[y] || null;
  }
  // the year asked for, plus the year before (a January without a saved start begins where December ended)
  function repRows(y) { var a = repProgYear(y), b = repProgYear(y - 1); return a && b ? a.concat(b) : null; }
  // programs (as typed on the students), with how many students each has
  function programList(list) {
    var c = {}; (list || S.students).forEach(function (s) { var p = (s.program || '').trim(); c[p] = (c[p] || 0) + 1; });
    return Object.keys(c).sort(function (a, b) { return !a ? 1 : !b ? -1 : a.localeCompare(b); }).map(function (k) { return { name: k, label: k || 'No program', n: c[k] }; });
  }
  function inProgram(s, p) { return p == null || p === '*' || (s.program || '').trim() === p; }
  function repStudents() { var l = S.students.filter(function (s) { return !s.disabled && inProgram(s, S.rep.pgm); }); if (S.rep.sid) l = l.filter(function (s) { return s.id === S.rep.sid; }); return l.sort(function (a, b) { return a.full_name.localeCompare(b.full_name); }); }
  function rowsOf(rows, sid) { return rows.filter(function (r) { return r.student_id === sid; }); }
  function pg(p) { return p ? 'p. ' + p : '—'; }
  function pctBar(pct, status) { return pct == null ? '<span class="muted">—</span>' : '<span class="rbar ' + (status || '') + '" title="' + pct + '%"><i style="width:' + pct + '%"></i></span><b class="num">' + pct + '%</b>'; }
  var REP_ST = { reached: ['Goal reached', 'good'], progress: ['In progress', 'warn'], missed: ['Goal not reached', 'bad'], nogoal: ['No goal set', 'plain'], nodata: ['No record', 'plain'], future: ['', 'plain'] };
  function stPill(st) { var x = REP_ST[st]; return x && x[0] ? '<span class="pill ' + x[1] + '">' + x[0] + '</span>' : ''; }
  function nameCell(s, printing) { return printing ? '<b>' + esc(s.full_name) + '</b>' : '<button class="linkbtn" data-act="student" data-id="' + esc(s.id) + '">' + esc(s.full_name) + '</button>'; }
  function dirTag(s) { return s.hifz_dir ? '<small class="muted">' + esc(MZ.dirLabel(s.hifz_dir, true)) + '</small>' : '<small class="muted">Direction not set</small>'; }
  function repLegend() { return '<div class="replegend" aria-label="Legend"><span><i class="lg reached"></i>Goal reached</span><span><i class="lg progress"></i>In progress (this month)</span><span><i class="lg missed"></i>Goal not reached</span><span><i class="lg nogoal"></i>No goal set</span><span><i class="lg nodata"></i>No record</span></div>'; }

  /* ---- weekly ---- */
  function weekData() {
    var w = MZ.weekOf(S.rep.week), ms = [w.from.slice(0, 7)]; if (w.to.slice(0, 7) !== ms[0]) ms.push(w.to.slice(0, 7));
    var ev = repEvents(ms), rows = repRows(+w.from.slice(0, 4)), rows2 = w.to.slice(0, 4) !== w.from.slice(0, 4) ? repRows(+w.to.slice(0, 4)) : [];
    if (!ev || !rows || !rows2) return null;
    var all = rows.concat(rows2), inW = ev.filter(function (e) { var d = MZ.localDate(e.created_at); return d >= w.from && d <= w.to; });
    var list = repStudents().map(function (s) {
      var x = MZ.repWeek(s, rowsOf(all, s.id), ev, w), mine = inW.filter(function (e) { return e.student_id === s.id; });
      x.s = s; x.ikh = mine.filter(function (e) { return e.kind === 'ikhtibar'; }).length; x.keys = mine.reduce(function (a, e) { return a + Math.max(0, +e.keys || 0); }, 0);
      x.status = x.target ? (x.pages >= x.target ? 'reached' : w.to >= MZ.today() ? 'progress' : 'missed') : 'nogoal';
      return x;
    }).sort(function (a, b) { return b.pages - a.pages || a.s.full_name.localeCompare(b.s.full_name); });
    return { w: w, rows: list };
  }
  function weekTable(d, printing) {
    var t = d.rows.reduce(function (a, r) { a.p += r.pages; a.k += r.keys; a.i += r.ikh; a.t += r.target || 0; return a; }, { p: 0, k: 0, i: 0, t: 0 });
    return '<table class="' + (printing ? 'acc-t' : 'grid') + ' rept"><thead><tr><th>Student</th><th class="r">Started at</th><th class="r">Reached</th><th class="r">Pages memorised</th><th class="r">Weekly target</th><th class="r">Achieved</th><th class="r">Remaining</th><th>Progress</th><th class="r">Days</th><th class="r">Ikhtibar</th><th class="r">Keys</th></tr></thead><tbody>'
      + d.rows.map(function (r) {
        return '<tr><td>' + nameCell(r.s, printing) + '<br>' + dirTag(r.s) + '</td><td class="r">' + pg(r.startPos) + '</td><td class="r">' + pg(r.reachedPos) + '</td>'
          + '<td class="r"><b>' + r.pages + '</b>' + (r.corrected ? '<br><small class="muted">' + r.gained + ' new, ' + r.corrected + ' corrected</small>' : '') + '</td>'
          + '<td class="r">' + (r.target ? r.target + '<br><small class="muted">from ' + r.monthGoal + '/month</small>' : '<span class="muted">—</span>') + '</td><td class="r">' + (r.target ? r.achieved : '—') + '</td><td class="r">' + (r.target ? r.remaining : '—') + '</td>'
          + '<td class="nowrap">' + pctBar(r.pct, r.status) + '</td><td class="r">' + r.days + '</td><td class="r">' + r.ikh + '</td><td class="r">' + r.keys + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>Total</td><td></td><td></td><td class="r">' + t.p + '</td><td class="r">' + (t.t || '—') + '</td><td></td><td></td><td></td><td></td><td class="r">' + t.i + '</td><td class="r">' + t.k + '</td></tr></tfoot></table>';
  }
  function weekEntries(d) {
    var r = d.rows[0]; if (!r || !r.entries.length) return '<p class="muted">No page entries this week.</p>';
    return '<div class="tablewrap"><table class="grid"><thead><tr><th>Day</th><th>Entry</th><th class="r">Pages</th></tr></thead><tbody>' + r.entries.slice().sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; }).map(function (e) {
      return '<tr><td>' + esc(MZ.dateLabel(MZ.localDate(e.created_at))) + '</td><td>' + esc(e.note || 'Jadeed') + '</td><td class="r">' + (+e.pages > 0 ? '+' : '') + (+e.pages || 0) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }

  /* ---- monthly ---- */
  function monthData() {
    var m = S.rep.month, rows = repRows(+m.slice(0, 4)); if (!rows) return null;
    return { m: m, rows: repStudents().map(function (s) { var x = MZ.repMonth(s, rowsOf(rows, s.id), m); x.s = s; return x; }).sort(function (a, b) { return (b.done || 0) - (a.done || 0) || a.s.full_name.localeCompare(b.s.full_name); }) };
  }
  function monthTable(d, printing) {
    var t = d.rows.reduce(function (a, r) { a.p += r.done || 0; a.g += r.goal || 0; return a; }, { p: 0, g: 0 });
    return '<table class="' + (printing ? 'acc-t' : 'grid') + ' rept"><thead><tr><th>Student</th><th class="r">Monthly goal</th><th class="r">Started at</th><th class="r">Target page</th><th class="r">Reached</th><th class="r">Pages memorised</th><th>Status</th><th>Completion</th><th class="r">Remaining</th></tr></thead><tbody>'
      + d.rows.map(function (r) {
        return '<tr class="st-' + r.status + '"><td>' + nameCell(r.s, printing) + '<br>' + dirTag(r.s) + '</td><td class="r">' + (r.goal ? r.goal + ' pages' : '<span class="muted">—</span>') + '</td><td class="r">' + pg(r.startPos) + '</td><td class="r">' + pg(r.targetPos) + '</td><td class="r">' + pg(r.reachedPos) + '</td>'
          + '<td class="r"><b>' + (r.done == null ? '—' : r.done) + '</b></td><td>' + stPill(r.status) + '</td><td class="nowrap">' + pctBar(r.pct, r.status) + '</td><td class="r">' + (r.remaining == null ? '—' : r.remaining) + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>Total</td><td class="r">' + (t.g || '—') + '</td><td></td><td></td><td></td><td class="r">' + t.p + '</td><td></td><td></td><td></td></tr></tfoot></table>';
  }
  // one student: every month of the year, one row each
  function studentYearTable(s, yd, printing) {
    return '<table class="' + (printing ? 'acc-t' : 'grid') + ' rept"><thead><tr><th>Month</th><th class="r">Monthly goal</th><th class="r">Started at</th><th class="r">Target page</th><th class="r">Reached</th><th class="r">Pages memorised</th><th>Status</th><th>Completion</th><th class="r">Remaining</th></tr></thead><tbody>'
      + yd.months.map(function (r) {
        if (r.status === 'future') return '<tr class="st-future"><td>' + esc(MZ.monthLabel(r.m)) + '</td><td colspan="8" class="muted">Not yet</td></tr>';
        return '<tr class="st-' + r.status + (r.m === S.rep.month && S.rep.mode === 'month' ? ' cur' : '') + '"><td>' + (printing ? esc(MZ.monthLabel(r.m)) : '<button class="linkbtn" data-act="repPickMonth" data-m="' + r.m + '">' + esc(MZ.monthLabel(r.m)) + '</button>') + '</td><td class="r">' + (r.goal ? r.goal : '—') + '</td><td class="r">' + pg(r.startPos) + '</td><td class="r">' + pg(r.targetPos) + '</td><td class="r">' + pg(r.reachedPos) + '</td>'
          + '<td class="r"><b>' + (r.done == null ? '—' : r.done) + '</b></td><td>' + stPill(r.status) + '</td><td class="nowrap">' + pctBar(r.pct, r.status) + '</td><td class="r">' + (r.remaining == null ? '—' : r.remaining) + '</td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>' + yd.y + '</td><td class="r">' + (yd.target || '—') + '</td><td class="r">' + pg(yd.startPos) + '</td><td></td><td class="r">' + pg(yd.endPos) + '</td><td class="r">' + yd.total + '</td><td>' + yd.goalsReached + ' of ' + yd.goalsSet + ' goals</td><td class="nowrap">' + pctBar(yd.pct) + '</td><td class="r">' + (yd.remaining == null ? '—' : yd.remaining) + '</td></tr></tfoot></table>';
  }

  /* ---- yearly ---- */
  function yearData() {
    var y = S.rep.year, rows = repRows(y); if (!rows) return null;
    return { y: y, rows: repStudents().map(function (s) { var x = MZ.repYear(s, rowsOf(rows, s.id), y); x.s = s; return x; }).sort(function (a, b) { return b.total - a.total || a.s.full_name.localeCompare(b.s.full_name); }) };
  }
  function yearTable(d, printing) {
    return '<table class="' + (printing ? 'acc-t' : 'grid') + ' yeart rept"><thead><tr><th>Student</th><th class="r">Start of year</th>' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (i) { return '<th class="r">' + MZ.monthShort(d.y + '-' + MZ.pad(i)) + '</th>'; }).join('')
      + '<th class="r">End of year</th><th class="r">Pages</th><th class="r">Yearly target</th><th>Completion</th><th class="r">Remaining</th><th class="r">Goals reached</th></tr></thead><tbody>'
      + d.rows.map(function (r) {
        return '<tr><td>' + nameCell(r.s, printing) + '</td><td class="r">' + pg(r.startPos) + '</td>'
          + r.months.map(function (m) { var tip = m.goal ? (m.done == null ? '' : m.done + ' of ' + m.goal + ' pages') : m.done != null ? m.done + ' pages, no goal set' : ''; return '<td class="r ycell ' + m.status + '"' + (tip ? ' title="' + esc(MZ.monthLabel(m.m) + ': ' + tip) + '"' : '') + '>' + (m.status === 'future' ? '' : m.done == null ? '<span class="muted">·</span>' : m.done + (m.goal ? '<small>/' + m.goal + '</small>' : '')) + '</td>'; }).join('')
          + '<td class="r">' + pg(r.endPos) + '</td><td class="r"><b>' + r.total + '</b></td><td class="r">' + (r.target || '—') + '</td><td class="nowrap">' + pctBar(r.pct) + '</td><td class="r">' + (r.remaining == null ? '—' : r.remaining) + '</td><td class="r">' + r.goalsReached + ' of ' + r.goalsSet + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function repHead(mode) {
    var titles = { week: 'Weekly report', month: 'Monthly report', year: 'Yearly report' };
    var sub = { week: 'Monday to Sunday: pages memorised from the page entries, from where each student started the week to where they reached.',
      month: 'One month: goal, Started at, Target page, Reached and pages memorised, from each student’s own records.',
      year: 'Every month of the year from the Monthly Reports, with cells highlighted when the goal is reached.' }[mode];
    var label = mode === 'week' ? MZ.weekOf(S.rep.week).label : mode === 'month' ? MZ.monthLabel(S.rep.month) : String(S.rep.year);
    var act = S.students.filter(function (s) { return !s.disabled; }), stu = act.filter(function (s) { return inProgram(s, S.rep.pgm); }).sort(function (a, b) { return a.full_name.localeCompare(b.full_name); });
    var pgms = programList(act);
    return '<div class="pagehead"><div><p class="eyebrow">Reports</p><h1>' + titles[mode] + '</h1><p class="stat">' + esc(sub) + '</p></div></div>'
      + '<div class="repbar"><div class="seg" role="group" aria-label="Report"><button class="chip" data-act="repMode" data-m="week" aria-pressed="' + (mode === 'week') + '">Weekly</button><button class="chip" data-act="repMode" data-m="month" aria-pressed="' + (mode === 'month') + '">Monthly</button><button class="chip" data-act="repMode" data-m="year" aria-pressed="' + (mode === 'year') + '">Yearly</button></div>'
      + (pgms.length > 1 || (pgms[0] && pgms[0].name) ? '<label class="pgmsel"><span class="sr">Program</span><select id="repProgram" aria-label="Program"><option value="*">All programs (' + act.length + ')</option>' + pgms.map(function (p) { return '<option value="' + esc(p.name) + '"' + (S.rep.pgm === p.name ? ' selected' : '') + '>' + esc(p.label) + ' (' + p.n + ')</option>'; }).join('') + '</select></label>' : '')
      + '<label class="pgmsel"><span class="sr">Student</span><select id="repStudent" aria-label="Student"><option value="">All students' + (S.rep.pgm != null && S.rep.pgm !== '*' ? ' in this program' : '') + '</option>' + stu.map(function (s) { return '<option value="' + esc(s.id) + '"' + (S.rep.sid === s.id ? ' selected' : '') + '>' + esc(s.full_name) + '</option>'; }).join('') + '</select></label>'
      + '<span class="monthnav"><button class="iconbtn" data-act="repMove" data-d="-1" aria-label="Previous">' + I.left + '</button><b class="replabel">' + esc(label) + '</b><button class="iconbtn" data-act="repMove" data-d="1" aria-label="Next">' + I.right + '</button></span>'
      + (mode === 'month' ? '<span class="repsel"><select id="repMonthSel" aria-label="Month">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (i) { var k = S.rep.month.slice(0, 4) + '-' + MZ.pad(i); return '<option value="' + MZ.pad(i) + '"' + (k === S.rep.month ? ' selected' : '') + '>' + MZ.monthShort(k) + '</option>'; }).join('') + '</select><input id="repYearSel" type="number" min="2020" max="2100" value="' + S.rep.month.slice(0, 4) + '" aria-label="Year"></span>' : '')
      + (mode === 'year' ? '<span class="repsel"><input id="repYearOnly" type="number" min="2020" max="2100" value="' + S.rep.year + '" aria-label="Year"></span>' : '')
      + '<button class="btn sm" data-act="repToday">' + (mode === 'week' ? 'This week' : mode === 'month' ? 'This month' : 'This year') + '</button><button class="btn sm" data-act="repPrint">' + I.print + 'Print</button></div>';
  }
  function renderReports() {
    var mode = S.rep.mode, h = repHead(mode), one = S.rep.sid ? studentById(S.rep.sid) : null;
    if (mode === 'week') {
      var d = weekData(); if (!d) return h + '<p class="muted" style="margin-top:14px">Loading…</p>';
      var t = d.rows.reduce(function (a, r) { a.p += r.pages; a.k += r.keys; a.i += r.ikh; if (r.pages > 0) a.n++; if (r.status === 'reached') a.r++; if (r.target) a.t++; return a; }, { p: 0, k: 0, i: 0, n: 0, r: 0, t: 0 });
      h += '<div class="cards4"><div class="stat4 gold"><span>Pages memorised</span><b class="num">' + t.p + '</b><small>by ' + t.n + ' of ' + d.rows.length + ' student' + (d.rows.length === 1 ? '' : 's') + '</small></div>'
        + '<div class="stat4 good"><span>Weekly targets reached</span><b class="num">' + t.r + '</b><small>of ' + t.t + ' with a monthly goal</small></div>'
        + '<div class="stat4"><span>Ikhtibar cleared</span><b class="num">' + t.i + '</b></div><div class="stat4"><span>Keys earned</span><b class="num">' + t.k + '</b></div></div>'
        + '<p class="hint">Weekly target = the monthly goal shared over the days of the month (goal × 7 ÷ days in the month). Corrections count as minus pages, so nothing is counted twice.</p>'
        + '<div class="tablewrap" style="margin-top:8px">' + weekTable(d) + '</div>';
      if (one) h += '<h3 class="rep-h3">Page entries this week</h3>' + weekEntries(d);
      return h;
    }
    if (mode === 'month') {
      var md = monthData(); if (!md) return h + '<p class="muted" style="margin-top:14px">Loading…</p>';
      var mt = md.rows.reduce(function (a, r) { a.p += r.done || 0; if (r.goal) a.g++; if (r.status === 'reached') a.r++; if (r.pct != null) { a.pc += r.pct; a.n++; } return a; }, { p: 0, g: 0, r: 0, pc: 0, n: 0 });
      h += '<div class="cards4"><div class="stat4 gold"><span>Pages memorised</span><b class="num">' + mt.p + '</b><small>in ' + esc(MZ.monthLabel(md.m)) + '</small></div>'
        + '<div class="stat4 good"><span>Goals reached</span><b class="num">' + mt.r + '</b><small>of ' + mt.g + ' students with a goal</small></div>'
        + '<div class="stat4"><span>Average completion</span><b class="num">' + (mt.n ? Math.round(mt.pc / mt.n) + '%' : '—') + '</b><small>of the monthly goal</small></div>'
        + '<div class="stat4"><span>Students</span><b class="num">' + md.rows.length + '</b><small>' + md.rows.filter(function (r) { return !r.goal && r.status !== 'future'; }).length + ' without a goal</small></div></div>';
      if (one) {
        var rows = repRows(+md.m.slice(0, 4)), yd = MZ.repYear(one, rowsOf(rows, one.id), +md.m.slice(0, 4)), r = md.rows[0];
        h += '<section class="repcard st-' + r.status + '"><div><p class="eyebrow">' + esc(MZ.monthLabel(md.m)) + '</p><h3>' + esc(one.full_name) + '</h3>' + dirTag(one) + '</div><div class="repgrid">'
          + [['Monthly goal', r.goal ? r.goal + ' pages' : '—'], ['Started at', pg(r.startPos)], ['Target page', pg(r.targetPos)], ['Reached', pg(r.reachedPos)], ['Pages memorised', r.done == null ? '—' : r.done], ['Remaining', r.remaining == null ? '—' : r.remaining]].map(function (x) { return '<div><span>' + x[0] + '</span><b class="num">' + esc(String(x[1])) + '</b></div>'; }).join('')
          + '</div><div class="repcard-foot">' + stPill(r.status) + pctBar(r.pct, r.status) + '</div></section>'
          + '<h3 class="rep-h3">All 12 months of ' + md.m.slice(0, 4) + '</h3><div class="tablewrap">' + studentYearTable(one, yd) + '</div>' + repLegend();
        return h;
      }
      return h + '<div class="tablewrap" style="margin-top:12px">' + monthTable(md) + '</div><p class="hint">Choose a student above to see their report for every month of the year, or open the Yearly report for everyone’s 12 months together.</p>';
    }
    var yd2 = yearData(); if (!yd2) return h + '<p class="muted" style="margin-top:14px">Loading…</p>';
    var tp = yd2.rows.reduce(function (a, r) { return a + r.total; }, 0), tt = yd2.rows.reduce(function (a, r) { return a + r.target; }, 0), tg = yd2.rows.reduce(function (a, r) { return a + r.goalsReached; }, 0), ts = yd2.rows.reduce(function (a, r) { return a + r.goalsSet; }, 0);
    h += '<div class="cards4"><div class="stat4 gold"><span>Pages memorised in ' + yd2.y + '</span><b class="num">' + tp + '</b><small>the sum of every month</small></div>'
      + '<div class="stat4"><span>Yearly target</span><b class="num">' + (tt || '—') + '</b><small>the monthly goals added up</small></div>'
      + '<div class="stat4 good"><span>Completion</span><b class="num">' + (tt ? Math.min(100, Math.round(tp / tt * 100)) + '%' : '—') + '</b><small>' + (tt ? Math.max(0, tt - tp) + ' pages remaining' : 'no goals set') + '</small></div>'
      + '<div class="stat4"><span>Monthly goals reached</span><b class="num">' + tg + '</b><small>of ' + ts + ' set</small></div></div>' + repLegend();
    if (one) return h + '<div class="tablewrap" style="margin-top:12px">' + studentYearTable(one, yd2.rows[0]) + '</div>';
    return h + '<div class="tablewrap" style="margin-top:12px">' + yearTable(yd2) + '</div>';
  }
  function printReport() {
    var mode = S.rep.mode, one = S.rep.sid ? studentById(S.rep.sid) : null;
    var d = mode === 'week' ? weekData() : mode === 'month' ? monthData() : yearData(); if (!d) { MZ.toast('Still loading. Try again in a moment.'); return; }
    var st = S.settings, title = (mode === 'week' ? 'Weekly report' : mode === 'month' ? 'Monthly report ' + MZ.monthLabel(d.m) : 'Yearly report ' + d.y) + (S.rep.pgm != null && S.rep.pgm !== '*' && !one ? ' · ' + (S.rep.pgm || 'No program') : '') + (one ? ' · ' + one.full_name : '');
    var sub = mode === 'week' ? d.w.label : mode === 'month' ? MZ.monthLabel(d.m) : 'January to December ' + d.y;
    var body = mode === 'week' ? weekTable(d, true) : mode === 'month' ? (one ? studentYearTable(one, MZ.repYear(one, rowsOf(repRows(+d.m.slice(0, 4)), one.id), +d.m.slice(0, 4)), true) : monthTable(d, true)) : (one ? studentYearTable(one, d.rows[0], true) : yearTable(d, true));
    MZ.printHTML('<section class="rc acc"><header class="rc-head"><img src="assets/logo-qt.png" alt=""><div style="flex:1"><p class="rc-inst">' + esc(st.institute_name) + '</p><h1>' + esc(title) + '</h1><p class="rc-month">' + esc(sub) + '</p></div><div class="acc-stamp">Printed ' + esc(MZ.dateLabel(MZ.today())) + '</div></header>'
      + body + (mode !== 'week' ? '<p style="font-size:11px;margin-top:6px">Highlighted: goal reached. Pages memorised = new pages in the period, counted along each student’s own order.</p>' : '') + '</section>', title);
  }
  document.addEventListener('change', function (e) {
    var id = e.target.id;
    if (id === 'repStudent') { S.rep.sid = e.target.value; render(); }
    else if (id === 'repProgram') { S.rep.pgm = e.target.value; var cur = S.rep.sid && studentById(S.rep.sid); if (cur && !inProgram(cur, S.rep.pgm)) S.rep.sid = ''; render(); }
    else if (id === 'repMonthSel' || id === 'repYearSel') { var y = +($('#repYearSel') || {}).value, mo = ($('#repMonthSel') || {}).value; if (y >= 2000 && y <= 2100 && mo) { S.rep.month = y + '-' + mo; render(); } }
    else if (id === 'repYearOnly') { var y2 = +e.target.value; if (y2 >= 2000 && y2 <= 2100) { S.rep.year = y2; render(); } }
  });

  Object.assign(A, {
    welcome: function (t) { openWelcome(t.dataset.id); },
    emailUpdate: function (t) { openUpdate(t.dataset.id); },
    bulkUpdate: function () { openBulkUpdate(); },
    sendUpdate: function (t) {
      var s = studentById(t.dataset.id); if (!s || !sheet) return; readUpdOpts();
      var txt = updateText(s, updOpts(), sheet.data.pays, sheet.data.prog[s.id], S.updNote);
      t.disabled = true; t.textContent = 'Sending…';
      api.sendEmail(s.id, updSubject(s), txt).then(function (r) { MZ.toast('Update emailed to ' + ((r && r.to) || s.email) + '.'); closeSheet(); })
        .catch(function (e) { t.disabled = false; t.innerHTML = I.mail + 'Send email now'; MZ.toast('Email not sent: ' + e.message); var b = $('#updErr'); if (b) { b.hidden = false; b.textContent = 'Email not sent: ' + e.message; } });
    },
    sendBulk: function (t) {
      if (!sheet || sheet.kind !== 'bulkupd' || sheet.data.running) return;
      readUpdOpts();
      var d = sheet.data, list = updAudience(d.aud || 'all'), o = updOpts(), note = S.updNote, ok = 0, bad = [], i = 0;
      d.running = true; t.disabled = true;
      var step = function () {
        if (i >= list.length) {
          d.running = false;
          bulkLog('<p class="okmsg" style="margin-top:10px">Sent ' + ok + ' of ' + list.length + ' emails.</p>' + (bad.length ? '<div class="okmsg" style="margin-top:8px;background:var(--warn-bg);color:var(--warn)"><b>Not sent (' + bad.length + '):</b><br>' + bad.map(function (b) { return esc(b[0]) + ' · ' + esc(b[1]); }).join('<br>') + '</div>' : ''));
          var bt = document.querySelector('[data-act=sendBulk]'); if (bt) bt.disabled = false;
          return;
        }
        var s = list[i++];
        bulkLog('<p class="muted" style="margin-top:10px">Sending ' + i + ' of ' + list.length + ' · ' + esc(s.full_name) + '…</p>');
        api.sendEmail(s.id, updSubject(s), updateText(s, o, S.allPayments || [], d.prog[s.id], note))
          .then(function () { ok++; }, function (e) { bad.push([s.full_name, e.message]); })
          .then(function () { setTimeout(step, 650); });
      };
      step();
    },
    sendWelcome: function (t) {
      var sid = t.dataset.id; t.disabled = true; t.textContent = 'Sending…';
      api.sendWelcome(sid, welcomeTpl()).then(function (r) { var st5 = studentById(sid); MZ.toast('Welcome email sent to ' + ((r && r.to) || 'the student') + '.' + (r && r.fee_missing ? ' The fee was not entered, so the email says it will be confirmed. Please enter ' + (st5 ? MZ.firstName(st5.full_name) + '’s' : 'the') + ' fee.' : '')); return api.listStudents().then(function (l) { S.students = l; render(); closeSheet(); }); })
        .catch(function (e) {
          t.disabled = false; t.innerHTML = I.mail + 'Send email now';
          MZ.toast('Email not sent: ' + e.message);
          var box = document.getElementById('welErr'); if (box) { box.hidden = false; box.textContent = 'Email not sent: ' + e.message; }
        });
    },
    startClasses: function (t) {
      var sid = t.dataset.id;
      api.updateStudent(sid, { is_new: false }).then(function (ns) { S.students = S.students.map(function (x) { return x.id === sid ? Object.assign({}, x, ns || {}, { is_new: false }) : x; }); render(); openStudent(sid, true); MZ.toast('Moved to active students.'); }).catch(function (e) { MZ.toast(e.message); });
    },
    welReset: function () { var b = $('#wBody'); if (b) b.value = MZ.DEFAULT_WELCOME; },
    repMode: function (t) {
      var to = t.dataset.m, from = S.rep.mode;
      // keep the same moment when switching views
      if (to === 'month' && from === 'week') S.rep.month = S.rep.week.slice(0, 7);
      if (to === 'month' && from === 'year') S.rep.month = S.rep.year + S.rep.month.slice(4);
      if (to === 'year') S.rep.year = +(from === 'week' ? S.rep.week : S.rep.month).slice(0, 4);
      S.rep.mode = to; render();
    },
    repMove: function (t) {
      var dd = +t.dataset.d;
      if (S.rep.mode === 'week') { var x = new Date(S.rep.week + 'T12:00:00'); x.setDate(x.getDate() + 7 * dd); S.rep.week = x.getFullYear() + '-' + MZ.pad(x.getMonth() + 1) + '-' + MZ.pad(x.getDate()); }
      else if (S.rep.mode === 'month') S.rep.month = MZ.addMonths(S.rep.month, dd);
      else S.rep.year += dd;
      render();
    },
    repPickMonth: function (t) { S.rep.month = t.dataset.m; S.rep.mode = 'month'; render(); },
    repToday: function () { if (S.rep.mode === 'week') S.rep.week = MZ.today(); else if (S.rep.mode === 'month') S.rep.month = MZ.thisMonth(); else S.rep.year = +MZ.thisMonth().slice(0, 4); render(); },
    repPrint: function () { printReport(); },
    pgmPick: function (t) { S.pgm = S.pgm === t.dataset.p ? '' : t.dataset.p; S.sel = {}; render(); },
    openProof: function (t) { openProof(t.dataset.id); },
    removeProof: function (t) {
      var p = findPayment(t.dataset.id); if (!p) return;
      MZ.arm(t, function () { api.removeProof(p).then(function (p2) { swapPayment(p2); if (sheet && sheet.kind === 'receipt') showReceipt(p2, sheet.data.s); render(); MZ.toast('Payment slip removed.'); }).catch(function (e) { MZ.toast(e.message); }); }, 'Tap again to remove');
    },
    awardBadge: function (t) { openAward(t.dataset.sid); },
    delBadge: function (t) {
      var sid = sheet && sheet.data.id;
      MZ.arm(t, function () { api.deleteBadge(+t.dataset.id || t.dataset.id).then(function () { MZ.toast('Badge removed.'); if (sid) loadSheetBadges(sid); }).catch(function (e) { MZ.toast(e.message); }); }, 'Tap again');
    },
    goalFollow: function (t) { openFollow(+t.dataset.id || t.dataset.id); },
    goalRemind: function (t) { openGoalRemind(+t.dataset.id || t.dataset.id); },
    goalYear: function (t) { S.goalYear += +t.dataset.d; render(); },
    schMode: function (t) {
      var from = S.sch.mode, to = t.dataset.m, d = S.sch.date || tomorrow();
      // leaving the month: open on the chosen day, or tomorrow when this month is showing
      if (from === 'month' && to !== 'month') S.sch.date = S.sch.pick && S.sch.pick.slice(0, 7) === d.slice(0, 7) ? S.sch.pick : MZ.today().slice(0, 7) === d.slice(0, 7) ? tomorrow() : d;
      if (from === 'list' && to !== 'list') S.sch.date = S.sch.rFrom || d;
      // the list opens on a useful stretch: the month shown, four weeks from the week shown, or a week from the day shown
      if (to === 'list' && from !== 'list') { var r1 = schRange(); S.sch.rFrom = r1.m0 || r1.from; S.sch.rTo = r1.m1 || isoAdd(r1.from, from === 'day' ? 6 : 27); }
      S.sch.mode = to; render();
    },
    schMove: function (t) {
      var d = S.sch.date || tomorrow();
      if (S.sch.mode === 'month') { var y = +d.slice(0, 4), mo = +d.slice(5, 7) - 1 + (+t.dataset.d); y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; S.sch.date = y + '-' + MZ.pad(mo + 1) + '-01'; S.sch.pick = null; }
      else if (S.sch.mode === 'list') { var rr = schRange(), len = rr.days.length; S.sch.rFrom = isoAdd(rr.from, len * (+t.dataset.d)); S.sch.rTo = isoAdd(rr.to, len * (+t.dataset.d)); }
      else S.sch.date = isoAdd(d, (+t.dataset.d) * (S.sch.mode === 'day' ? 1 : 7));
      render();
    },
    schEdit: function (t) { openSch(t.dataset.id, true); },
    schView: function (t) { openSch(t.dataset.id, false, true); },
    schResched: function (t) { openResched(t.dataset.id); },
    schNotify: function (t) { openNotify(t.dataset.id); },
    schCopyOpen: function () { openCopy(); },
    schQuick: function (t) {
      var q = t.dataset.q;
      if (q === 'today') { S.sch.date = MZ.today(); S.sch.mode = 'day'; }
      else if (q === 'week') { S.sch.date = MZ.today(); S.sch.mode = 'week'; }
      else if (q === 'next') { S.sch.date = isoAdd(weekStart(MZ.today()), 7); S.sch.mode = 'week'; }
      else if (q === 'month') { S.sch.date = MZ.today(); S.sch.mode = 'month'; S.sch.pick = null; }
      else { var r0 = schRange(); S.sch.rFrom = r0.m0 || r0.from; S.sch.rTo = r0.m1 || (S.sch.mode === 'list' ? r0.to : isoAdd(r0.from, S.sch.mode === 'day' ? 6 : 27)); S.sch.mode = 'list'; }
      render();
    },
    schPickDay: function (t) { S.sch.pick = t.dataset.d; render(); var p = $('#schDayPanel'); if (p) p.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
    schGoDay: function (t) { S.sch.date = t.dataset.d; S.sch.mode = 'day'; render(); },
    schGoWeek: function (t) { S.sch.date = t.dataset.d; S.sch.mode = 'week'; render(); },
    schPickT: function (t) { S.sch.teacher = t.dataset.tid; render(); },
    ttPrint: function () {
      var g = document.querySelector('.ttgrid'); if (!g) return;
      var c = g.cloneNode(true); MZ.$$('button.tt-edit, button.iconbtn', c).forEach(function (b) { b.remove(); });
      MZ.$$('button.tt-open', c).forEach(function (b) { var sp = document.createElement('span'); sp.className = 'tt-open'; sp.innerHTML = b.innerHTML; b.replaceWith(sp); });
      var title = (document.querySelector('.tt h3') || {}).textContent || 'Timetable', r = schRange();
      MZ.printHTML('<style>.ptt{font:12px/1.35 system-ui,sans-serif;color:#111}.ptt h1{font-size:18px;margin:0 0 2px}.ptt p{margin:0 0 10px;color:#555}.ptt table{width:100%;border-collapse:collapse;table-layout:fixed}.ptt th,.ptt td{border:1px solid #bbb;padding:4px;vertical-align:top;text-align:left}.ptt thead th{background:#f3eee0}.ptt .tt-open{display:block;margin:0 0 3px;padding:2px 4px;border-left:3px solid #a67c1e;background:#faf6ea}.ptt .tt-open small{display:block;color:#555}.ptt .off{opacity:.5;text-decoration:line-through}.ptt svg{display:none}.ptt .tt-sum{width:46px;text-align:center}.ptt .tt-time{width:84px}</style><div class="ptt"><h1>' + esc(title) + '</h1><p>Week of ' + esc(MZ.dateLabel(r.from)) + ' · Qism al Tahfeez</p>' + c.outerHTML + '</div>', title);
    },
    schTomorrow: function () { S.sch.date = S.sch.mode === 'month' ? MZ.today() : tomorrow(); S.sch.pick = null; render(); },
    schAdd: function (t) { openSchAdd(t.dataset.d); },
    schOpen: function (t) { openSch(t.dataset.id); },
    schBulkEdit: function (t) { openBulk('edit', t.dataset.sid); },
    schBulkDel: function (t) { openBulk('delete', t.dataset.sid); },
    bkStu: function (t) { S.bk.stu = t.dataset.id; S.bk.stuOpen = false; bkLoad(); bkDraw(); },
    bkStuEdit: function () { S.bk.stuOpen = true; bkDraw(); var q = $('#bkStuQ'); if (q) q.focus(); },
    bkPast: function (t) { S.bk.past = t.dataset.v === '1'; S.bk.confirm = false; S.bk.review = null; if (S.bk.mode === 'delete') bkVisible().forEach(function (x) { S.bk.sel[x.id] = 1; }); bkDraw(['bkList', 'bkAct']); },
    bkRange0: function () { S.bk.rf = S.bk.rt = ''; S.bk.review = null; S.bk.confirm = false; bkDraw(['bkList', 'bkAct']); },
    bkLenV: function (t) { S.bk.f.len = { on: true, v: +t.dataset.m }; bkDraw(['bkAct']); },
    bkShiftV: function (t) { var f = S.bk.f.shift = S.bk.f.shift || { on: true }; f.v = (+f.v || 0) + (+t.dataset.n); bkDraw(['bkAct']); },
    bkDelAsk: function () { S.bk.confirm = true; bkDraw(['bkAct']); var c = MZ.$$('.bkconfirm')[0]; if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
    bkDelNo: function () { S.bk.confirm = false; bkDraw(['bkAct']); },
    bkDelGo: function () { bkDelete(); },
    bkReview: function () { bkReview(); },
    bkBack: function () { S.bk.review = null; bkDraw(['bkAct']); },
    bkApply: function (t) { bkApply(t); },
    schTT: function () { openTT(); },
    ttHintX: function () { S.ttHint = 0; render(); },
    ttWeek: function (t) { var x = S.tt; if (x.custom) { x.from = isoAdd(x.from, +t.dataset.n); x.to = isoAdd(x.to, +t.dataset.n); } else { var w = MZ.weekOf(isoAdd(x.from, +t.dataset.n)); x.from = w.from; x.to = w.to; } x.prev = null; x.msg = ''; ttLoad(); },
    ttCustom: function () { var x = S.tt; x.custom = !x.custom; if (!x.custom) { var w = MZ.weekOf(x.from); x.from = w.from; x.to = w.to; ttLoad(); } else ttDraw(); },
    ttPrev: function (t) { ttPreview(t.dataset.k); },
    ttPrevClose: function () { S.tt.prev = null; ttDraw(); },
    ttPrint: function () { if (S.tt.prev && S.tt.prev.data) MZ.ttPrint(S.tt.prev.data); },
    ttSend: function (t) { ttSend(t); },
    schPrint: function () {
      var r = schRange(), me = api.myUid ? api.myUid() : null, plan = canPlan();
      var l = (S.sch.list || []).filter(function (x) { return plan ? (!S.sch.teacher || S.sch.teacher === 'me' ? true : String(x.teacher_id) === String(S.sch.teacher)) : x.teacher_user === me; });
      if (plan && S.sch.teacher && S.sch.teacher !== 'me') { MZ.ttPrint(Object.assign(MZ.ttFromLessons('teacher', teacherNameById(S.sch.teacher), r.from, r.to, l), { institute: S.settings.institute_name })); return; }
      var mine = !plan && l[0] ? l[0].teacher_name : '';
      l = l.map(function (x) { return Object.assign({}, x, { student_name: schName(x) }); });
      MZ.ttPrint(Object.assign(MZ.ttFromLessons(plan ? 'admin' : 'teacher', plan ? 'Administrator' : mine, r.from, r.to, l), { institute: S.settings.institute_name }));
    },
    alStu: function (t) { S.al.stu = t.dataset.id; S.al.stuOpen = false; alDraw(); if (S.al.tchOpen) { var q = $('#alTchQ'); if (q && window.innerWidth > 700) q.focus(); } },
    alStuEdit: function () { S.al.stuOpen = true; alDraw(); var q = $('#alStuQ'); if (q) q.focus(); },
    alTch: function (t) { S.al.tch = t.dataset.id; S.al.tchOpen = false; alDraw(); },
    alTchEdit: function () { S.al.tchOpen = true; alDraw(); var q = $('#alTchQ'); if (q) q.focus(); },
    alDate: function (t) { S.al.date = t.dataset.d; alLoadDay(S.al.date); alDraw(); },
    alLen: function (t) { S.al.len = +t.dataset.m; alDraw(); },
    alFrom: function (t) { S.al.from = t.dataset.t; alDraw(); var sm = $('#alSum'); if (sm && sm.scrollIntoView && window.innerWidth <= 700) sm.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
    schLen: function (t) { var f = $('#scFrom'), to = $('#scTo'); if (f && to && f.value) to.value = tAdd(f.value, +t.dataset.m); },
    schCancel: function (t) {
      var x = (S.sch.list || []).find(function (y) { return String(y.id) === t.dataset.id; }); if (!x) return;
      MZ.arm(t, function () {
        t.disabled = true;
        api.saveSchedule(Object.assign({}, x, { status: 'cancelled' })).then(function () { afterSchSave([x.id], schNotifyPref(), x.id, 'Lesson cancelled (kept in the history)'); }).catch(function (e) { t.disabled = false; MZ.toast(e.message); });
      }, 'Tap again to cancel the lesson');
    },
    schRestore: function (t) {
      var x = (S.sch.list || []).find(function (y) { return String(y.id) === t.dataset.id; }); if (!x) return;
      t.disabled = true;
      api.saveSchedule(Object.assign({}, x, { status: 'scheduled' })).then(function () { afterSchSave([x.id], schNotifyPref(), x.id, 'Lesson restored'); }).catch(function (e) { t.disabled = false; MZ.toast(e.message); });
    },
    schDel: function (t) {
      MZ.arm(t, function () {
        var id = +t.dataset.id || t.dataset.id, x = (S.sch.list || []).find(function (y) { return String(y.id) === String(id); });
        // a live slot is cancelled first so the student and the teacher are told, then removed
        // a live lesson is cancelled first so the student and the teacher are told (when emails are on), then removed
        var mail = schNotifyPref() === 'auto';
        var tell = x && x.status === 'scheduled' ? api.saveSchedule(Object.assign({}, x, { status: 'cancelled' })).then(function () { return mail ? tellTeachers([x.id], true) : null; }).catch(function () {}) : Promise.resolve();
        t.disabled = true;
        tell.then(function () { return api.deleteSchedule(id); }).then(function () { closeSheet(); S.sch.notes = null; S.sch.notesKey = null; loadSchedule(true); MZ.toast(x && x.status === 'scheduled' && mail ? 'Lesson deleted. The student and the teacher were told it is cancelled.' : 'Lesson deleted.'); }).catch(function (e) { t.disabled = false; MZ.toast(e.message); });
      }, 'Tap again to delete for good');
    },
    schAddDate: function () { var i = $('#scDateAdd'); if (!i || !i.value) return; S.sch.pickDates = S.sch.pickDates || []; if (S.sch.pickDates.indexOf(i.value) < 0) S.sch.pickDates.push(i.value); S.sch.pickDates.sort(); i.value = ''; drawPickDates(); },
    schDropDate: function (t) { S.sch.pickDates = (S.sch.pickDates || []).filter(function (d) { return d !== t.dataset.d; }); drawPickDates(); },
    rsLen: function (t) { var f = $('#rsFrom'), to = $('#rsTo'); if (f && to && f.value) to.value = tAdd(f.value, +t.dataset.m); },
    ntfSend: function (t) { ntfSend(t); },
    saveTeachers: function (t) {
      var id = t.dataset.id, ids = MZ.$$('[data-tpick]:checked').map(function (c) { return +c.value; });
      t.disabled = true;
      api.updateStudent(id, { teacher_ids: ids }).then(function (ns) {
        S.students = S.students.map(function (x) { return x.id === id ? Object.assign({}, x, { teacher_ids: ids }) : x; });
        var st = studentById(id); MZ.toast(ids.length ? MZ.firstName(st.full_name) + '’s teacher' + (ids.length > 1 ? 's are ' : ' is ') + teacherNames(st) + '.' : 'No teacher set. Only teachers who have ' + MZ.firstName(st.full_name) + ' in their schedule can see them.');
        t.disabled = false; render(); refreshSheet();
      }).catch(function (e) { t.disabled = false; MZ.toast(e.message); });
    },
    pushOn: function (t) {
      t.disabled = true;
      MZ.push.enable(api).then(function () { S.pushState = 'on'; render(); MZ.toast('Phone alerts are on. Try “Send me a test”.'); })
        .catch(function (e) { S.pushState = undefined; render(); MZ.toast(e.message); });
    },
    pushOff: function () { MZ.push.disable(api).then(function () { S.pushState = 'off'; render(); MZ.toast('Phone alerts turned off on this device.'); }); },
    pushHide: function () { S.pushHidden = true; render(); },
    pushTest: function (t) {
      t.disabled = true;
      api.testAlert().then(function (r) { t.disabled = false; MZ.toast(r && r.pushed ? 'Test alert sent. It should appear in a few seconds.' : 'No phone answered. Turn alerts off and on again.'); })
        .catch(function (e) { t.disabled = false; MZ.toast(e.message); });
    },
    goalEdit: function (t) { S.goalEdit = S.goalEdit === t.dataset.sid ? null : t.dataset.sid; S.goalEditMonth = MZ.thisMonth(); S.goalAudit = null; openStudent(t.dataset.sid, true); setTimeout(function () { var b = $('#goalEditBox'); if (b) b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 60); },
    goalDel: function (t) {
      var sid = t.dataset.sid, what = t.dataset.what, m = ($('#geMonth') || {}).value || MZ.thisMonth(), st = studentById(sid), note = ($('#geNote') || {}).value || '';
      var msg = what === 'goal' ? 'Are you sure you want to delete this goal? This action may affect the student\'s progress report.' : 'Delete this month\'s starting point? It goes back to where the month before ended, and the report is worked out again.';
      gConfirm(msg, what === 'goal' ? 'Yes, delete the goal' : 'Yes, delete the starting point', function () {
        (what === 'goal' ? api.adminDeleteGoal(sid, m, note) : api.adminDeleteStart(sid, m, note)).then(function () { return afterGoalChange(sid, (what === 'goal' ? 'Monthly goal deleted' : 'Starting point deleted') + ' for ' + MZ.firstName(st.full_name) + '. You can enter the right one now.'); }).catch(function (e) { MZ.toast(e.message); var b = $('#gConfirm'); if (b) b.hidden = true; });
      });
    },
    goalDelEntry: function (t) {
      var sid = t.dataset.sid, id = t.dataset.id, n = +t.dataset.pages, st = studentById(sid), note = ($('#geNote') || {}).value || '';
      var msg = 'This deletes an actual memorisation record (not the goal). ' + (t.dataset.latest === '1' ? 'The current page moves back by ' + Math.abs(n) + ' page' + (Math.abs(n) === 1 ? '' : 's') + '. ' : 'Warning: this is not the latest entry, so deleting it moves the current page back by ' + Math.abs(n) + ' page' + (Math.abs(n) === 1 ? '' : 's') + ' and changes totals and reports that came after it. ') + 'Keys given for it are taken back.';
      gConfirm(msg, 'Yes, delete this entry', function () {
        api.adminDeleteEntry(id, note).then(function (r) { return afterGoalChange(sid, 'Page entry deleted for ' + MZ.firstName(st.full_name) + '. Current page: ' + (r && r.cur_pos ? r.cur_pos : '–') + ', ' + (r ? r.pages : '') + ' pages memorised.'); }).catch(function (e) { MZ.toast(e.message); var b = $('#gConfirm'); if (b) b.hidden = true; });
      });
    },
    hifzDirSet: function (t) {
      var sid = t.dataset.sid, d = t.dataset.d, st0 = studentById(sid); t.disabled = true;
      api.setHifzDir(sid, d).then(function () { MZ.toast(MZ.firstName(st0.full_name) + ': ' + MZ.dirLabel(d) + '. Now type the current page.'); return refreshProgressFor(sid); })
        .then(function () { var f = $('#apPage'); if (f) f.focus(); }).catch(function (e) { t.disabled = false; MZ.toast(e.message); });
    },
    hifzDir: function (t) {
      var sid = t.dataset.sid, d = t.dataset.d, st0 = studentById(sid);
      MZ.arm(t, function () {
        api.setHifzDir(sid, d).then(function (r) { MZ.toast(MZ.firstName(st0.full_name) + ': ' + MZ.dirLabel(d) + '. ' + (r && r.pages != null ? r.pages + ' pages memorised.' : '')); return refreshProgressFor(sid); }).catch(function (e) { MZ.toast(e.message); });
      }, 'Tap again to change');
    },
    tlMake: function (t) { t.disabled = true; makeTeacherLogin(t.dataset.id, false).catch(function (e) { MZ.toast(e.message); t.disabled = false; }); },
    tlCopy: function (t) {
      var done = function () { t.textContent = 'Copied'; MZ.toast('Login details copied. Paste them in a message to the teacher.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(S.tlMsg || '').then(done, function () { MZ.toast('Could not copy. Select the details and copy them.'); });
      else MZ.toast('Could not copy. Select the details and copy them.');
    },
    schHand: function (t) { loadBusy(S.sch.date || tomorrow()); openHand(t.dataset.tid); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'schTeacher') { S.sch.teacher = e.target.value; render(); }
    if (e.target.id === 'schJump' && e.target.value) { if (S.sch.mode === 'list') { var len0 = schRange().days.length; S.sch.rFrom = e.target.value; S.sch.rTo = isoAdd(e.target.value, len0 - 1); } else { S.sch.date = e.target.value; S.sch.pick = e.target.value; } render(); }
    if ((e.target.id === 'schFrom' || e.target.id === 'schTo') && e.target.value) { S.sch[e.target.id === 'schFrom' ? 'rFrom' : 'rTo'] = e.target.value; render(); }
    if (e.target.id === 'schStuF' || e.target.id === 'schStF') { S.sch[e.target.id === 'schStuF' ? 'stu' : 'st'] = e.target.value; render(); }
    if (e.target.id === 'fbTeacher') { S.fbT = e.target.value; render(); }
    if ((e.target.id === 'fbFrom' || e.target.id === 'fbTo') && /^\d{4}-\d{2}$/.test(e.target.value)) { S[e.target.id] = e.target.value; render(); if (sheet && sheet.kind === 'tProfile') openTeacherProfile(sheet.data.id); }

    if (e.target.id === 'scFrom') { var to = $('#scTo'); if (to && S.sch.lastLen && sheet && sheet.kind === 'schAdd') to.value = tAdd(e.target.value, S.sch.lastLen || 45); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.id === 'profForm') { e.preventDefault(); saveProfile(); }
    else if (f.id === 'awardForm') { e.preventDefault(); saveAward(); }
    else if (f.id === 'followForm') { e.preventDefault(); saveFollow(); }
    else if (f.id === 'schForm') { e.preventDefault(); saveSch(); }
    else if (f.id === 'reschForm') { e.preventDefault(); saveResched(); }
    else if (f.id === 'copyForm') { e.preventDefault(); saveCopy(); }
    else if (f.id === 'schMailForm') { e.preventDefault(); var em = $('#smAdmin').value.trim().toLowerCase(); if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { MZ.toast('That email address is not valid.'); return; } api.saveSettings({ schedule_admin_email: em || null }).then(function (s2) { S.settings = s2; render(); MZ.toast(em ? 'Schedule emails for the admin go to ' + em + '.' : 'Admin schedule emails switched off.'); }).catch(function (e2) { MZ.toast(e2.message); }); }
    else if (f.id === 'handForm') { e.preventDefault(); saveHand(); }
    else if (f.id === 'hand1Form') { e.preventDefault(); var tv = $('#h1T').value, sid = +f.dataset.id || f.dataset.id; if (tv) moveSlots([sid], tv).then(function () { closeSheet(); }).catch(function (e2) { MZ.toast(e2.message); }); }
    else if (f.id === 'ikhSetForm') {
      e.preventDefault();
      var pages = $('#ipPages').value.split(/[^\d]+/).map(Number).filter(function (n) { return n >= 1 && n <= 604; });
      if (!pages.length) { MZ.toast('Enter at least one page number between 1 and 604.'); return; }
      var url = $('#ipUrl').value.trim(); if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      api.saveSettings({ ikhtibar_pages: pages, ikhtibar_alert_pages: Math.max(1, Math.min(100, parseInt($('#ipAlert').value, 10) || 20)), hafiz_days_per_year: Math.max(50, Math.min(365, parseInt($('#ipDays').value, 10) || 150)), elearning_url: url || null })
        .then(function (s2) { S.settings = s2; render(); MZ.toast('Saved.'); }).catch(function (e2) { MZ.toast(e2.message); });
    } else if (f.id === 'welForm') {
      e.preventDefault();
      api.saveSettings({ welcome_subject: $('#wSubj').value.trim(), welcome_body: $('#wBody').value, registration_fee: Math.max(0, Number($('#wReg').value) || 0) }).then(function (s2) { S.settings = s2; render(); MZ.toast('Welcome email saved.'); }).catch(function (e2) { MZ.toast(e2.message); });
    }
  }, true);

  /* ===================================================== ACCOUNTS & HR */
  var SUBS = {
    accounts: [['overview', 'Overview'], ['income', 'Income'], ['expenses', 'Expenses'], ['cash', 'Cash'], ['bank', 'Bank'], ['feesacc', 'Fees'], ['receipts', 'Receipts']],
    hr: [['teachers', 'Teachers'], ['teacher_rating', 'Teacher ratings'], ['feedback', 'Teacher feedback'], ['payroll', 'Payroll'], ['attendance', 'Attendance'], ['leave', 'Leave'], ['student_rating', 'Student ratings']]
  };
  S.sub = { accounts: 'overview', hr: 'teachers' };
  S.period = 'month'; S.fin = null; S.finYear = null; S.hr = null; S.ffilter = 'all'; S.efilter = ''; S.hrAll = false; S.attDate = MZ.today();
  try {
    var h0 = (location.hash || '').slice(1).split('/');
    if (SUBS[h0[0]]) { S.tab = h0[0]; if (h0[1] && SUBS[h0[0]].some(function (x) { return x[0] === h0[1]; })) S.sub[h0[0]] = h0[1]; }
  } catch (e) {}

  function renderSubtabs() {
    var nav = $('#subtabs'), list = SUBS[S.tab];
    if (isCashier()) list = null;
    if (!list) { nav.hidden = true; nav.innerHTML = ''; return; }
    nav.hidden = false;
    nav.innerHTML = '<div class="subtabs-in">' + list.map(function (x) {
      return '<button class="subtab" type="button" data-sub="' + x[0] + '" aria-current="' + (S.sub[S.tab] === x[0] ? 'page' : 'false') + '">' + x[1] + '</button>';
    }).join('') + '</div>';
  }
  function renderAccounts() {
    if (isCashier()) return renderCashier();
    var sub = S.sub.accounts;
    if (sub === 'receipts') return renderReceipts();
    if (sub === 'feesacc') return renderFeesAcc();
    var y = +S.month.slice(0, 4);
    if (S.finYear !== y) { loadFin(y); return periodHead('Accounts', '') + '<p class="muted" style="margin-top:14px">Loading…</p>'; }
    if (sub === 'cash' || sub === 'bank') return renderBook(sub);
    if (sub === 'income') return renderEntries('income');
    if (sub === 'expenses') return renderEntries('expense');
    return renderOverview();
  }
  function loadFin(y) {
    if (S.finLoading === y) return;
    S.finLoading = y;
    Promise.all([api.listFinance({ from: y + '-01-01', to: y + '-12-31' }), S.hr ? Promise.resolve(S.hr) : api.listHR()]).then(function (r) {
      S.fin = r[0]; S.hr = r[1]; S.finYear = y; S.finLoading = null; render();
    }).catch(function (e) { S.finLoading = null; MZ.toast(e.message); });
  }
  function range() {
    var y = S.month.slice(0, 4);
    return S.period === 'year' ? { from: y + '-01-01', to: y + '-12-31', label: y, inM: function (m) { return m.slice(0, 4) === y; } }
      : { from: S.month + '-01', to: S.month + '-31', label: MZ.monthLabel(S.month), inM: function (m) { return m === S.month; } };
  }
  function inRange(d, r) { return d && d >= r.from && d <= r.to; }
  function periodHead(eyebrow, title, extra) {
    var r = range();
    return '<div class="pagehead"><div><p class="eyebrow">' + esc(eyebrow) + '</p><h1>' + esc(title || r.label) + '</h1></div>'
      + '<div class="btnrow"><div class="chips" role="group" aria-label="Period"><button class="chip" type="button" data-act="period" data-p="month" aria-pressed="' + (S.period === 'month') + '">Month</button><button class="chip" type="button" data-act="period" data-p="year" aria-pressed="' + (S.period === 'year') + '">Year</button></div>'
      + '<span class="monthnav"><button class="iconbtn" data-act="' + (S.period === 'year' ? 'prevYear' : 'prevMonth') + '" aria-label="Previous">' + I.left + '</button><b style="min-width:120px;text-align:center">' + esc(r.label) + '</b><button class="iconbtn" data-act="' + (S.period === 'year' ? 'nextYear' : 'nextMonth') + '" aria-label="Next">' + I.right + '</button></span>'
      + (extra || '') + '</div></div>';
  }
  function salaryEntries(r) {
    return (S.hr || []).filter(function (x) { return x.kind === 'payroll' && x.data.status === 'Paid' && inRange(x.data.paid_on || (x.data.month + '-28'), r); }).map(function (x) {
      var t = hrById(x.data.teacher_id);
      return { kind: 'expense', category: 'Salaries', amount: payNet(x.data), entry_date: x.data.paid_on || x.data.month + '-28', party: t ? t.data.full_name : 'Teacher', note: 'Payroll ' + MZ.monthLabel(x.data.month), payroll: true };
    });
  }
  function totals() {
    var r = range();
    // fees count under the month they are FOR (September's fee paid in October shows in September)
    var fees = S.payments.filter(function (p) { return p.status !== 'pending' && r.inM(p.month); });
    var feeSum = fees.reduce(function (a, p) { return a + p.amount; }, 0);
    var fin = (S.fin || []).filter(function (e) { return inRange(e.entry_date, r); });
    var inc = fin.filter(function (e) { return e.kind === 'income'; }), exp = fin.filter(function (e) { return e.kind === 'expense'; }).concat(salaryEntries(r));
    var sum = function (l) { return l.reduce(function (a, e) { return a + e.amount; }, 0); };
    return { r: r, fees: fees, feeSum: feeSum, inc: inc, incSum: sum(inc), exp: exp, expSum: sum(exp) };
  }
  function groupSum(list) { var g = {}; list.forEach(function (e) { g[e.category] = (g[e.category] || 0) + e.amount; }); return Object.keys(g).map(function (k) { return [k, g[k]]; }).sort(function (a, b) { return b[1] - a[1]; }); }
  function barTable(rows, total, cls) {
    if (!rows.length) return '<p class="muted">Nothing recorded.</p>';
    var max = rows.reduce(function (m, r) { return Math.max(m, r[1]); }, 0) || 1, cur = S.settings.currency;
    return '<table class="grid"><tbody>' + rows.map(function (r) {
      return '<tr><td style="width:36%">' + esc(r[0]) + '</td><td style="width:34%"><div class="mbar' + (cls ? ' ' + cls : '') + '" style="height:8px"><i style="width:' + Math.max(2, r[1] / max * 100).toFixed(1) + '%"></i></div></td><td class="r">' + esc(MZ.money(r[1], cur)) + '</td></tr>';
    }).join('') + '<tr class="tot"><td>Total</td><td></td><td class="r">' + esc(MZ.money(total, cur)) + '</td></tr></tbody></table>';
  }
  function renderOverview() {
    var t = totals(), cur = S.settings.currency, totalInc = t.feeSum + t.incSum, net = totalInc - t.expSum;
    var h = periodHead('Accounts · Income head', 'Income head', '<button class="btn sm" data-act="exportAccounts">Download (Excel)</button>');
    h += '<div class="cards4"><div class="stat4 good"><span>Total income</span><b class="num">' + esc(MZ.money(totalInc, cur)) + '</b><small>Fees and other income</small></div>'
      + '<div class="stat4"><span>Fee income</span><b class="num">' + esc(MZ.money(t.feeSum, cur)) + '</b><small>' + t.fees.length + ' receipt' + (t.fees.length === 1 ? '' : 's') + '</small></div>'
      + '<div class="stat4 bad"><span>Expenses</span><b class="num">' + esc(MZ.money(t.expSum, cur)) + '</b><small>Including salaries paid</small></div>'
      + '<div class="stat4 ' + (net >= 0 ? 'gold' : 'bad') + '"><span>Balance</span><b class="num">' + esc(MZ.money(net, cur)) + '</b><small>Income minus expenses</small></div></div>';
    var cb = bookBalance('cash'), bb = bookBalance('bank');
    h += '<div class="accbal">' + [['cash', 'Cash in hand', cb], ['bank', 'In the bank', bb]].map(function (x) {
      return '<button type="button" class="accbal-c ' + x[0] + '" data-act="sub" data-sub="' + x[0] + '"><span class="ao-ico">' + I[x[0]] + '</span><span><small>' + x[1] + ' now</small><b class="num">' + (x[2] == null ? '…' : esc(MZ.money(x[2], cur))) + '</b></span><span class="go">' + I.right + '</span></button>';
    }).join('') + '</div>';
    var incRows = [['Student fees', t.feeSum]].concat(groupSum(t.inc)).filter(function (r) { return r[1] > 0; });
    h += '<div class="summary" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)"><section class="card"><div class="boxhead" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px"><h3 style="font-family:var(--font-display);font-size:22px">Income</h3><button class="btn sm" data-act="addFin" data-kind="income">' + I.plus + 'Add income</button></div>' + barTable(incRows, totalInc, 'goal') + '</section>'
      + '<section class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px"><h3 style="font-family:var(--font-display);font-size:22px">Expenses</h3><button class="btn sm" data-act="addFin" data-kind="expense">' + I.plus + 'Add expense</button></div>' + barTable(groupSum(t.exp), t.expSum) + '</section></div>';
    if (S.period === 'year') {
      var y = S.month.slice(0, 4), rows = [], max = 1;
      for (var m = 1; m <= 12; m++) {
        var k = y + '-' + MZ.pad(m), rr = { from: k + '-01', to: k + '-31' };
        var inc = S.payments.filter(function (p) { return p.status !== 'pending' && p.month === k; }).reduce(function (a, p) { return a + p.amount; }, 0)
          + (S.fin || []).filter(function (e) { return e.kind === 'income' && inRange(e.entry_date, rr); }).reduce(function (a, e) { return a + e.amount; }, 0);
        var exp = (S.fin || []).filter(function (e) { return e.kind === 'expense' && inRange(e.entry_date, rr); }).reduce(function (a, e) { return a + e.amount; }, 0)
          + salaryEntries(rr).reduce(function (a, e) { return a + e.amount; }, 0);
        rows.push([k, inc, exp]); max = Math.max(max, inc, exp);
      }
      h += '<section class="card" style="margin-top:14px"><h3 style="font-family:var(--font-display);font-size:22px;margin-bottom:10px">Month by month</h3><div class="ybars">' + rows.map(function (r) {
        return '<div class="ybar"><b>' + MZ.monthShort(r[0]) + '</b><span class="bars"><i class="inc" style="width:' + (r[1] / max * 100).toFixed(1) + '%"></i><i class="exp" style="width:' + (r[2] / max * 100).toFixed(1) + '%"></i></span><span class="num ' + (r[1] - r[2] >= 0 ? 'pos' : 'neg') + '" style="text-align:right">' + esc(MZ.money(r[1] - r[2], cur)) + '</span></div>';
      }).join('') + '</div><div class="legend" style="margin-top:8px;display:flex;gap:14px;font-size:12px;color:var(--ink-2)"><span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--good)"></i> Income</span><span><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--bad)"></i> Expenses</span><span>Right: balance</span></div></section>';
    }
    return h;
  }
  /* Print the fee accounts of all (or some) students: a summary table, and optionally one page per student. */
  function openPrintAccounts() {
    var y = S.month.slice(0, 4), nDis = S.students.filter(function (s) { return s.disabled; }).length;
    allPays();
    openSheet('printAcc', {}, head('Print accounts', 'Fee accounts of the students')
      + '<form class="form" id="paForm" autocomplete="off">'
      + '<fieldset class="field"><legend>Period</legend><div class="radios">'
      + '<label class="radio"><input type="radio" name="paPer" value="month" checked><span><b>One month</b><small>For example only ' + esc(MZ.monthLabel(S.month)) + '</small></span></label>'
      + '<div class="field" id="paOne"><label for="paMonth" class="sr">Month</label><input id="paMonth" type="month" value="' + esc(S.month) + '"></div>'
      + '<label class="radio"><input type="radio" name="paPer" value="custom"><span><b>From one month to another</b><small>For example October to December</small></span></label>'
      + '<div class="two" id="paCustom"><div class="field"><label for="paFrom">From</label><input id="paFrom" type="month" value="' + esc(S.month) + '"></div><div class="field"><label for="paTo">To</label><input id="paTo" type="month" value="' + esc(y + '-12') + '"></div></div>'
      + '<label class="radio"><input type="radio" name="paPer" value="year"><span><b>Whole year ' + esc(y) + '</b><small>January to December ' + esc(y) + '</small></span></label>'
      + '<label class="radio"><input type="radio" name="paPer" value="all"><span><b>Since they joined</b><small>Every month from each student’s first month</small></span></label>'
      + '</div></fieldset>'
      + '<div class="field"><label for="paWho">Students</label><select id="paWho"><option value="active">All active students</option>' + (nDis ? '<option value="all">Active and disabled</option>' : '') + '<option value="due">Only students with a balance due</option></select></div>'
      + '<fieldset class="field"><legend>What to print</legend>'
      + '<label class="tickline"><input type="checkbox" id="paSum" checked> <span><b>Summary table</b> · one line per student: months, paid, balance</span></label>'
      + '<label class="tickline"><input type="checkbox" id="paEach"> <span><b>Each student’s months</b> · one page per student with every month and receipt</span></label></fieldset>'
      + '<p class="hint">Only approved payments are counted. Months on leave have no fee. In the print window choose <b>Save as PDF</b> to keep a file.</p>'
      + '<p class="err" id="paErr" hidden></p><button class="btn gold block" type="button" data-act="paGo" id="paBtn">' + I.print + 'Print accounts</button></form>');
  }
  function makeAccountsPrint(btn) {
    var per = (document.querySelector('input[name=paPer]:checked') || {}).value || 'year', who = $('#paWho').value, sum = $('#paSum').checked, each = $('#paEach').checked;
    var err = $('#paErr'), y = S.month.slice(0, 4), now = MZ.thisMonth();
    var from = per === 'year' ? y + '-01' : per === 'custom' ? $('#paFrom').value : per === 'month' ? $('#paMonth').value : null;
    var to = per === 'year' ? y + '-12' : per === 'custom' ? $('#paTo').value : per === 'month' ? $('#paMonth').value : now;
    if (per === 'month' && !from) { err.textContent = 'Choose the month.'; err.hidden = false; return; }
    if (!sum && !each) { err.textContent = 'Tick at least one thing to print.'; err.hidden = false; return; }
    if (per === 'custom' && (!from || !to || to < from)) { err.textContent = 'Choose a From month before the To month.'; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true; btn.textContent = 'Preparing…';
    var go = function (pays) {
      var list = S.students.filter(function (s) { return who === 'all' || !s.disabled; });
      var rows = list.map(function (s) {
        var mine = pays.filter(function (p) { return p.student_id === s.id; });
        var ok = mine.filter(function (p) { return p.status !== 'pending'; });
        var fs = MZ.feeSummary(s, ok, from, to < now ? to : now);
        var inPer = ok.filter(function (p) { return (!from || p.month >= from) && p.month <= to; });
        return { s: s, pays: inPer, pending: mine.filter(function (p) { return p.status === 'pending' && (!from || p.month >= from) && p.month <= to; }), sum: fs, paid: inPer.reduce(function (a, p) { return a + p.amount; }, 0), all: MZ.paidTotals(s, mine) };
      }).filter(function (r) { return who !== 'due' || r.sum.balance > 0; }).sort(function (a, b) { return a.s.full_name.localeCompare(b.s.full_name); });
      if (!rows.length) { err.textContent = 'No students to print for that choice.'; err.hidden = false; btn.disabled = false; btn.innerHTML = I.print + 'Print accounts'; return; }
      MZ.printHTML(MZ.accountsHTML({ settings: S.settings, rows: rows, from: from, to: to, period: per, summary: sum, each: each, who: who }), 'Fee accounts ' + (per === 'year' ? y : per === 'all' ? 'all time' : per === 'month' ? MZ.monthLabel(from) : MZ.monthLabel(from) + ' to ' + MZ.monthLabel(to)));
      btn.disabled = false; btn.innerHTML = I.print + 'Print accounts';
    };
    (S.allPayments ? Promise.resolve(S.allPayments) : api.listPayments({}).then(function (l) { S.allPayments = l; return l; })).then(go)
      .catch(function (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; btn.innerHTML = I.print + 'Print accounts'; });
  }
  /* ---------------------------------------------------- Cashier: enter only */
  function renderCashier() {
    var cur = S.settings.currency;
    if (!S.myFin && !S.myFinLoading) { S.myFinLoading = true; api.listFinance({}).then(function (l) { S.myFin = l.filter(function (e) { return e.kind === 'income' || e.kind === 'expense'; }); S.myFinLoading = false; render(); }).catch(function (e) { S.myFinLoading = false; S.myFin = []; MZ.toast(e.message); }); }
    var h = '<div class="pagehead"><div><p class="eyebrow">Cashier</p><h1>Income & expenses</h1><p class="muted" style="margin-top:4px">Enter money that comes in or goes out. The accounts team and the admin see the totals.</p></div></div>';
    h += '<div class="cashier-actions">'
      + '<button type="button" class="ca-card in" data-act="addFin" data-kind="income"><span class="ca-ico">' + I.plus + '</span><b>Add income</b><small>Donation, sponsorship or any money received</small></button>'
      + '<button type="button" class="ca-card out" data-act="addFin" data-kind="expense"><span class="ca-ico">' + I.plus + '</span><b>Add expense</b><small>Electricity, food, repairs or anything paid out</small></button>'
      + '<button type="button" class="ca-card fee" data-act="tab" data-tab="fees"><span class="ca-ico">' + I.receipt.replace('width="24" height="24"', 'width="22" height="22"') + '</span><b>Student fees</b><small>Mark a student paid, in cash or bank</small></button></div>';
    var l = S.myFin;
    h += '<section class="card" style="margin-top:16px"><h3 style="font-family:var(--font-display);font-size:22px;margin-bottom:8px">What you entered</h3>';
    if (!l) return h + '<p class="muted">Loading…</p></section>';
    if (!l.length) return h + '<p class="muted">Nothing yet. Entries you add appear here.</p></section>';
    return h + '<div class="tablewrap"><table class="grid"><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>From / to</th><th>Cash or bank</th><th class="r">Amount</th></tr></thead><tbody>'
      + l.slice().sort(function (a, b) { return a.entry_date < b.entry_date ? 1 : -1; }).slice(0, 200).map(function (e) {
        return '<tr><td style="white-space:nowrap">' + esc(MZ.dateShort(e.entry_date)) + '</td><td><span class="btag ' + (e.kind === 'income' ? 'fee' : 'expense') + '">' + (e.kind === 'income' ? 'Income' : 'Expense') + '</span></td><td>' + esc(e.category) + (e.note ? '<br><small class="muted">' + esc(e.note) + '</small>' : '') + '</td><td>' + esc(e.party) + '</td><td><span class="btag ' + e.account + '">' + MZ.ACCOUNT_NAME[e.account] + '</span></td><td class="r">' + esc(MZ.money(e.amount, cur)) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="hint" style="margin-top:8px">Made a mistake? Ask the accounts team or the admin to correct it.</p></section>';
  }
  /* ---------------------------------------------------- Cash and Bank books */
  function finAll() {
    if (!S.finAll && !S.finAllLoading) {
      S.finAllLoading = true;
      api.listFinance({}).then(function (l) { S.finAll = l; S.finAllLoading = false; render(); }).catch(function (e) { S.finAllLoading = false; MZ.toast(e.message); });
    }
    return S.finAll;
  }
  /* Every movement of money in one account, oldest first. */
  function bookMoves(acc) {
    var fin = finAll(), pays = allPays(); if (!fin || !pays) return null;
    var out = [], other = acc === 'cash' ? 'bank' : 'cash';
    pays.forEach(function (p) {
      if (p.status === 'pending' || MZ.accountOf(p.method) !== acc) return;
      var st = studentById(p.student_id);
      out.push({ d: p.paid_on, t: 'fee', amt: p.amount, title: st ? st.full_name : 'Removed student', sub: 'Fees for ' + MZ.monthLabel(p.month) + ' · ' + p.receipt_no, pid: p.id, sid: p.student_id });
    });
    fin.forEach(function (e) {
      if (e.kind === 'income' && e.account === acc) out.push({ d: e.entry_date, t: 'income', amt: e.amount, title: e.category, sub: [e.party, e.note].filter(Boolean).join(' · '), fid: e.id, kind: e.kind });
      else if (e.kind === 'expense' && e.account === acc) out.push({ d: e.entry_date, t: 'expense', amt: -e.amount, title: e.category, sub: [e.party, e.note].filter(Boolean).join(' · '), fid: e.id, kind: e.kind });
      else if (e.kind === 'opening' && e.account === acc) out.push({ d: e.entry_date, t: 'opening', amt: e.amount, title: 'Opening balance', sub: e.note, fid: e.id, kind: e.kind });
      else if (e.kind === 'transfer' && e.account === acc) out.push({ d: e.entry_date, t: 'out', amt: -e.amount, title: acc === 'cash' ? 'Deposited into the bank' : 'Withdrawn to cash', sub: e.note, fid: e.id, kind: e.kind });
      else if (e.kind === 'transfer' && e.to_account === acc) out.push({ d: e.entry_date, t: 'in', amt: e.amount, title: acc === 'cash' ? 'Withdrawn from the bank' : 'Cash deposited', sub: e.note, fid: e.id, kind: e.kind });
    });
    (S.hr || []).forEach(function (x) {
      if (x.kind !== 'payroll' || x.data.status !== 'Paid' || MZ.accountOf(x.data.method) !== acc) return;
      var t = hrById(x.data.teacher_id);
      out.push({ d: x.data.paid_on || x.data.month + '-28', t: 'salary', amt: -payNet(x.data), title: 'Salary · ' + (t ? t.data.full_name : 'Teacher'), sub: 'Payroll ' + MZ.monthLabel(x.data.month) });
    });
    void other;
    return out.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.t === 'opening' ? -1 : 0) - (b.t === 'opening' ? -1 : 0); });
  }
  function bookBalance(acc) { var l = bookMoves(acc); return l ? l.reduce(function (a, m) { return a + m.amt; }, 0) : null; }
  function renderBook(acc) {
    var cur = S.settings.currency, name = MZ.ACCOUNT_NAME[acc], other = acc === 'cash' ? 'bank' : 'cash';
    var btns = '<button class="btn gold sm" data-act="moveMoney" data-acc="' + acc + '">' + I.swap + (acc === 'cash' ? 'Deposit cash into the bank' : 'Withdraw from the bank') + '</button>'
      + '<button class="btn sm" data-act="openingBal" data-acc="' + acc + '">Opening balance</button>';
    var h = periodHead('Accounts · ' + name, acc === 'cash' ? 'Cash book' : 'Bank book', btns);
    var moves = bookMoves(acc);
    if (!moves) return h + '<p class="muted" style="margin-top:14px">Loading…</p>';
    var r = range(), now = moves.reduce(function (a, m) { return a + m.amt; }, 0);
    var before = moves.filter(function (m) { return m.d < r.from; }).reduce(function (a, m) { return a + m.amt; }, 0);
    var inP = moves.filter(function (m) { return inRange(m.d, r); });
    var mIn = inP.filter(function (m) { return m.amt > 0; }).reduce(function (a, m) { return a + m.amt; }, 0), mOut = -inP.filter(function (m) { return m.amt < 0; }).reduce(function (a, m) { return a + m.amt; }, 0);
    var feesP = inP.filter(function (m) { return m.t === 'fee'; }), feeSum = feesP.reduce(function (a, m) { return a + m.amt; }, 0);
    var pend = (allPays() || []).filter(function (p) { return p.status === 'pending' && MZ.accountOf(p.method) === acc; });
    var pendSum = pend.reduce(function (a, p) { return a + p.amount; }, 0);
    h += '<div class="bookhero ' + acc + '"><div class="bh-ico">' + I[acc] + '</div><div class="bh-main"><span class="eyebrow">' + (acc === 'cash' ? 'Cash in hand now' : 'Bank balance now') + '</span><b class="num' + (now < 0 ? ' neg' : '') + '">' + esc(MZ.money(now, cur)) + '</b>'
      + '<small>' + (pendSum ? '+ ' + esc(MZ.money(pendSum, cur)) + ' in fees waiting for approval · ' : '') + 'Other account: ' + esc(MZ.ACCOUNT_NAME[other]) + ' ' + esc(MZ.money(bookBalance(other) || 0, cur)) + '</small></div>'
      + '<button class="btn" data-act="sub" data-sub="' + other + '">' + I[other] + 'Open ' + MZ.ACCOUNT_NAME[other].toLowerCase() + ' book</button></div>';
    h += '<div class="cards4"><div class="stat4"><span>Start of ' + esc(r.label) + '</span><b class="num">' + esc(MZ.money(before, cur)) + '</b><small>Brought forward</small></div>'
      + '<div class="stat4 good"><span>Money in</span><b class="num">' + esc(MZ.money(mIn, cur)) + '</b><small>' + esc(MZ.money(feeSum, cur)) + ' fees from ' + feesP.length + ' receipt' + (feesP.length === 1 ? '' : 's') + '</small></div>'
      + '<div class="stat4 bad"><span>Money out</span><b class="num">' + esc(MZ.money(mOut, cur)) + '</b><small>Expenses, salaries, ' + (acc === 'cash' ? 'deposits' : 'withdrawals') + '</small></div>'
      + '<div class="stat4 gold"><span>End of ' + esc(r.label) + '</span><b class="num">' + esc(MZ.money(before + mIn - mOut, cur)) + '</b><small>Carried forward</small></div></div>';
    var F = S.bfilter || 'all', cnt = function (f) { return inP.filter(function (m) { return f === 'fee' ? m.t === 'fee' : f === 'moves' ? m.t === 'in' || m.t === 'out' || m.t === 'opening' : f === 'other' ? m.t === 'income' : f === 'out' ? m.t === 'expense' || m.t === 'salary' : true; }); };
    h += '<div class="toolbar"><div class="chips" role="group" aria-label="Show">' + [['all', 'All'], ['fee', 'Student fees'], ['other', 'Other income'], ['out', 'Expenses'], ['moves', 'Transfers']].map(function (c) {
      return '<button class="chip" type="button" data-act="bfilter" data-f="' + c[0] + '" aria-pressed="' + (F === c[0]) + '">' + c[1] + '<b>' + cnt(c[0]).length + '</b></button>';
    }).join('') + '</div></div>';
    var list = cnt(F), run = before;
    var runMap = {}; inP.forEach(function (m, i) { run += m.amt; runMap[i] = run; });
    if (!list.length) return h + '<div class="empty"><p>Nothing in the ' + name.toLowerCase() + ' book for ' + esc(r.label) + '.</p></div>';
    h += '<div class="tablewrap" style="margin-top:12px"><table class="grid book"><thead><tr><th>Date</th><th>Details</th><th class="r">In</th><th class="r">Out</th>' + (F === 'all' ? '<th class="r">Balance</th>' : '') + '<th></th></tr></thead><tbody>'
      + (F === 'all' ? '<tr class="carry"><td>' + esc(MZ.dateShort(r.from)) + '</td><td><b>Brought forward</b></td><td></td><td></td><td class="r">' + esc(MZ.money(before, cur)) + '</td><td></td></tr>' : '')
      + inP.map(function (m, i) {
        if (list.indexOf(m) < 0) return '';
        var tag = { fee: 'Fee', income: 'Income', expense: 'Expense', salary: 'Salary', in: 'Transfer in', out: 'Transfer out', opening: 'Opening' }[m.t];
        var act = m.pid ? '<button class="btn sm" data-act="receipt" data-id="' + m.pid + '">Receipt</button>' : m.fid ? '<button class="btn sm ghost" data-act="editMove" data-id="' + m.fid + '">Edit</button>' : '';
        return '<tr class="bk-' + m.t + '"><td style="white-space:nowrap">' + esc(MZ.dateShort(m.d)) + '</td><td><span class="btag ' + m.t + '">' + tag + '</span> <b>' + esc(m.title) + '</b>' + (m.sub ? '<br><small class="muted">' + esc(m.sub) + '</small>' : '') + '</td>'
          + '<td class="r pos">' + (m.amt > 0 ? esc(MZ.money(m.amt, cur)) : '') + '</td><td class="r neg">' + (m.amt < 0 ? esc(MZ.money(-m.amt, cur)) : '') + '</td>'
          + (F === 'all' ? '<td class="r num">' + esc(MZ.money(runMap[i], cur)) + '</td>' : '') + '<td class="r">' + act + '</td></tr>';
      }).join('')
      + '<tr class="tot"><td></td><td>' + (F === 'all' ? 'Carried forward' : 'Total') + '</td><td class="r">' + esc(MZ.money(list.filter(function (m) { return m.amt > 0; }).reduce(function (a, m) { return a + m.amt; }, 0), cur)) + '</td><td class="r">' + esc(MZ.money(-list.filter(function (m) { return m.amt < 0; }).reduce(function (a, m) { return a + m.amt; }, 0), cur)) + '</td>' + (F === 'all' ? '<td class="r">' + esc(MZ.money(before + mIn - mOut, cur)) + '</td>' : '') + '<td></td></tr></tbody></table></div>';
    if (F === 'fee' || F === 'all') {
      var bySt = {}; feesP.forEach(function (m) { var e = bySt[m.sid] = bySt[m.sid] || { n: m.title, a: 0, k: 0 }; e.a += m.amt; e.k++; });
      var ks = Object.keys(bySt).sort(function (a, b) { return bySt[b].a - bySt[a].a; });
      if (ks.length) h += '<section class="card" style="margin-top:14px"><h3 style="font-family:var(--font-display);font-size:22px;margin-bottom:8px">Fees paid in ' + name.toLowerCase() + ' · ' + esc(r.label) + '</h3><table class="grid"><thead><tr><th>Student</th><th class="r">Receipts</th><th class="r">Amount</th></tr></thead><tbody>'
        + ks.map(function (k) { return '<tr><td><button class="linkbtn" data-act="student" data-id="' + esc(k) + '">' + esc(bySt[k].n) + '</button></td><td class="r">' + bySt[k].k + '</td><td class="r">' + esc(MZ.money(bySt[k].a, cur)) + '</td></tr>'; }).join('')
        + '<tr class="tot"><td>Total</td><td class="r">' + feesP.length + '</td><td class="r">' + esc(MZ.money(feeSum, cur)) + '</td></tr></tbody></table></section>';
    }
    return h;
  }
  /* Deposit (cash → bank), withdrawal (bank → cash) or an opening balance. */
  function openMove(kind, acc, e) {
    e = e || {}; var cur = S.settings.currency, bal = bookBalance(acc);
    var title = kind === 'opening' ? 'Opening balance · ' + MZ.ACCOUNT_NAME[acc] : acc === 'cash' ? 'Deposit cash into the bank' : 'Withdraw from the bank';
    var flow = kind === 'transfer' ? '<div class="flow"><span class="fl ' + acc + '">' + I[acc] + MZ.ACCOUNT_NAME[acc] + '<small>' + (bal != null ? esc(MZ.money(bal, cur)) + ' now' : '') + '</small></span><span class="fl-arrow">' + I.right + '</span><span class="fl ' + (acc === 'cash' ? 'bank' : 'cash') + '">' + I[acc === 'cash' ? 'bank' : 'cash'] + MZ.ACCOUNT_NAME[acc === 'cash' ? 'bank' : 'cash'] + '<small>' + (bookBalance(acc === 'cash' ? 'bank' : 'cash') != null ? esc(MZ.money(bookBalance(acc === 'cash' ? 'bank' : 'cash'), cur)) + ' now' : '') + '</small></span></div>' : '<p class="muted">The money in ' + (acc === 'cash' ? 'cash' : 'the bank') + ' on the day you start using the books. Enter it once.</p>';
    openSheet('move', { kind: kind, acc: acc, id: e.id || null }, head(MZ.ACCOUNT_NAME[acc], e.id ? 'Edit' : title)
      + '<form class="form" id="moveForm" autocomplete="off">' + flow
      + '<div class="two"><div class="field"><label for="mvAmt">Amount (' + esc(cur) + ')</label><input id="mvAmt" type="number" min="1" step="any" required inputmode="decimal" value="' + (e.amount || '') + '" placeholder="e.g. 2000000"></div>'
      + '<div class="field"><label for="mvDate">Date</label><input id="mvDate" type="date" required value="' + esc(e.entry_date || MZ.today()) + '"></div></div>'
      + '<p class="muted" id="mvWords" style="font-size:13px;margin-top:-6px"></p>'
      + '<div class="field"><label for="mvNote">Note (optional)</label><input id="mvNote" maxlength="200" value="' + esc(e.note || '') + '" placeholder="' + (kind === 'transfer' ? 'e.g. deposit slip no' : '') + '"></div>'
      + '<p class="err" id="mvErr" hidden></p><button class="btn gold block" type="submit" id="mvBtn">' + (kind === 'transfer' ? I.swap + (acc === 'cash' ? 'Move to bank' : 'Move to cash') : 'Save opening balance') + '</button></form>'
      + (e.id ? '<div><button class="btn danger" data-act="delMove" data-id="' + e.id + '">Delete this entry</button></div>' : ''));
    var w = function () { var v = +$('#mvAmt').value; $('#mvWords').textContent = v > 0 ? MZ.amountInWords(v, cur) : ''; };
    $('#mvAmt').addEventListener('input', w); w();
  }
  function saveMove() {
    var d = sheet.data, amt = +$('#mvAmt').value, err = $('#mvErr');
    if (!(amt > 0)) { err.textContent = 'Enter the amount.'; err.hidden = false; return; }
    $('#mvBtn').disabled = true;
    api.saveFinance({ id: d.id, kind: d.kind, category: d.kind === 'opening' ? 'Opening balance' : d.acc === 'cash' ? 'Deposit to bank' : 'Withdrawal to cash', amount: amt, entry_date: $('#mvDate').value, note: $('#mvNote').value.trim(), party: '', account: d.acc })
      .then(function () {
        S.finAll = null; S.finYear = null; closeSheet(); render();
        var c = S.settings.currency;
        MZ.toast(d.kind === 'opening' ? 'Opening balance saved.' : MZ.money(amt, c) + (d.acc === 'cash' ? ' moved from cash into the bank.' : ' moved from the bank into cash.') + ' Both books are updated.');
      }).catch(function (e2) { err.textContent = e2.message; err.hidden = false; $('#mvBtn').disabled = false; });
  }
  /* Student fees in the Income tab, counted under the month the fee is for. */
  function feeIncomeHTML(t) {
    var cur = S.settings.currency, byM = {};
    t.fees.forEach(function (p) { (byM[p.month] = byM[p.month] || []).push(p); });
    var months = Object.keys(byM).sort();
    var h = '<section class="card" style="margin-top:14px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h3 style="font-family:var(--font-display);font-size:22px">Student fees</h3><small class="muted">Each fee is counted in the month it is for, even if it was paid later.</small></div>';
    if (!months.length) return h + '<p class="muted" style="margin-top:8px">No approved fees for ' + esc(t.r.label) + ' yet.</p></section>';
    if (S.period === 'year') {
      h += '<table class="grid" style="margin-top:8px"><thead><tr><th>Month</th><th class="r">Receipts</th><th class="r">Amount</th></tr></thead><tbody>' + months.map(function (m) {
        return '<tr><td>' + esc(MZ.monthLabel(m)) + '</td><td class="r">' + byM[m].length + '</td><td class="r">' + esc(MZ.money(byM[m].reduce(function (a, p) { return a + p.amount; }, 0), cur)) + '</td></tr>';
      }).join('') + '<tr class="tot"><td>Total</td><td class="r">' + t.fees.length + '</td><td class="r">' + esc(MZ.money(t.feeSum, cur)) + '</td></tr></tbody></table>';
    } else {
      h += '<table class="grid" style="margin-top:8px"><thead><tr><th>Student</th><th>Receipt</th><th>Paid on</th><th class="r">Amount</th></tr></thead><tbody>' + t.fees.slice().sort(function (a, b) { return a.paid_on < b.paid_on ? -1 : 1; }).map(function (p) {
        var st = studentById(p.student_id);
        return '<tr><td>' + esc(st ? st.full_name : 'Removed student') + '</td><td class="mono">' + esc(p.receipt_no) + '</td><td>' + esc(MZ.dateShort(p.paid_on)) + (p.paid_on.slice(0, 7) !== p.month ? ' <small class="muted">(late)</small>' : '') + '</td><td class="r">' + esc(MZ.money(p.amount, cur)) + '</td></tr>';
      }).join('') + '<tr class="tot"><td colspan="3">Total</td><td class="r">' + esc(MZ.money(t.feeSum, cur)) + '</td></tr></tbody></table>';
    }
    return h + '</section>';
  }
  function renderEntries(kind) {
    var t = totals(), cur = S.settings.currency, list = kind === 'income' ? t.inc : t.exp;
    var title = kind === 'income' ? 'Income' : 'Expense head';
    var h = periodHead('Accounts', title, '<button class="btn gold sm" data-act="addFin" data-kind="' + kind + '">' + I.plus + (kind === 'income' ? 'Add income' : 'Add expense') + '</button>');
    if (kind === 'expense') {
      var g = {}; list.forEach(function (e) { g[e.category] = (g[e.category] || 0) + e.amount; });
      var cats = MZ.EXPENSE_CATEGORIES.concat(['Salaries']).concat(Object.keys(g).filter(function (k) { return MZ.EXPENSE_CATEGORIES.indexOf(k) < 0 && k !== 'Salaries'; }));
      h += '<div class="cards4">' + cats.map(function (c) {
        return '<button type="button" class="stat4' + (S.efilter === c ? ' gold' : '') + '" data-act="efilter" data-c="' + esc(c) + '" style="text-align:left;cursor:pointer;font:inherit;color:inherit' + (S.efilter === c ? ';border-color:var(--gold-deep);box-shadow:0 0 0 2px var(--gold-soft)' : '') + '"><span>' + esc(c) + '</span><b class="num" style="font-size:20px">' + esc(MZ.money(g[c] || 0, cur)) + '</b></button>';
      }).join('') + '</div>';
      if (S.efilter) { list = list.filter(function (e) { return e.category === S.efilter; }); h += '<p style="margin-top:10px">Showing <b>' + esc(S.efilter) + '</b> · <button class="btn sm ghost" data-act="efilter" data-c="">Show all</button></p>'; }
    } else {
      h += '<div class="cards4"><div class="stat4 good"><span>Other income</span><b class="num">' + esc(MZ.money(t.incSum, cur)) + '</b><small>' + t.inc.length + ' entries</small></div><div class="stat4"><span>Fee income</span><b class="num">' + esc(MZ.money(t.feeSum, cur)) + '</b><small>Fees for ' + esc(t.r.label) + ', listed below</small></div>'
        + '<div class="stat4 gold"><span>All income</span><b class="num">' + esc(MZ.money(t.incSum + t.feeSum, cur)) + '</b></div><div class="stat4"><span>Biggest source</span><b style="font-size:18px">' + esc((groupSum(t.inc)[0] || ['—'])[0]) + '</b></div></div>';
    }
    if (kind === 'income') h += feeIncomeHTML(t);
    if (!list.length) return h + '<div class="empty"><p>No ' + (kind === 'income' ? 'income' : 'expenses') + ' recorded for ' + esc(t.r.label) + '.</p><button class="btn gold" data-act="addFin" data-kind="' + kind + '">' + (kind === 'income' ? 'Add income' : 'Add expense') + '</button></div>';
    var sum = list.reduce(function (a, e) { return a + e.amount; }, 0);
    h += '<div class="tablewrap" style="margin-top:14px"><table class="grid"><thead><tr><th>Date</th><th>Category</th><th>' + (kind === 'income' ? 'From' : 'Paid to') + '</th><th>Note</th><th>' + (kind === 'income' ? 'Into' : 'From') + '</th><th class="r">Amount</th><th></th></tr></thead><tbody>'
      + list.map(function (e) {
        return '<tr><td style="white-space:nowrap">' + esc(MZ.dateShort(e.entry_date)) + '</td><td>' + esc(e.category) + '</td><td>' + esc(e.party) + '</td><td class="muted">' + esc(e.note) + '</td><td>' + (e.payroll ? '' : '<span class="btag ' + (e.account || 'cash') + '">' + MZ.ACCOUNT_NAME[e.account || 'cash'] + '</span>') + '</td><td class="r">' + esc(MZ.money(e.amount, cur)) + '</td>'
          + '<td class="r">' + (e.payroll ? (isAdmin() ? '<button class="btn sm ghost" data-act="sub" data-tab2="hr" data-sub="payroll">Payroll</button>' : '<small class="muted">Payroll</small>') : '<button class="btn sm" data-act="editFin" data-id="' + e.id + '">Edit</button>') + '</td></tr>';
      }).join('') + '<tr class="tot"><td colspan="5">Total</td><td class="r">' + esc(MZ.money(sum, cur)) + '</td><td></td></tr></tbody></table></div>';
    return h;
  }
  function openFin(kind, e) {
    e = e || {};
    var cats = kind === 'income' ? MZ.INCOME_CATEGORIES : MZ.EXPENSE_CATEGORIES;
    var catOpts = cats.slice(); if (e.category && cats.indexOf(e.category) < 0) catOpts.unshift(e.category);
    openSheet('fin', { kind: kind, id: e.id || null }, head(kind === 'income' ? 'Income' : 'Expense', e.id ? 'Edit ' + (kind === 'income' ? 'income' : 'expense') : (kind === 'income' ? 'Add income' : 'Add expense'))
      + '<form class="form" id="finForm" autocomplete="off">'
      + '<div class="field"><label for="fCat">Category</label><select id="fCat">' + catOpts.map(function (c) { return '<option' + (c === (e.category || (kind === 'expense' && S.efilter && S.efilter !== 'Salaries' ? S.efilter : '')) ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '<option value="__new">New category…</option></select></div>'
      + '<div class="field" id="fCatNewWrap" hidden><label for="fCatNew">New category name</label><input id="fCatNew" maxlength="60"></div>'
      + '<div class="two"><div class="field"><label for="fAmt">Amount (' + esc(S.settings.currency) + ')</label><input id="fAmt" type="number" min="1" step="any" required value="' + (e.amount || '') + '"></div>'
      + '<div class="field"><label for="fDate">Date</label><input id="fDate" type="date" required value="' + esc(e.entry_date || (S.month === MZ.thisMonth() ? MZ.today() : S.month + '-01')) + '"></div></div>'
      + '<div class="field"><span class="flabel">' + (kind === 'income' ? 'Received in' : 'Paid from') + '</span>' + accPick('finAcc', e.account || prefAcc()) + '</div>'
      + '<div class="field"><label for="fParty">' + (kind === 'income' ? 'From (sponsor or donor)' : 'Paid to') + '</label><input id="fParty" maxlength="100" value="' + esc(e.party || '') + '"></div>'
      + '<div class="field"><label for="fNote">Note</label><input id="fNote" maxlength="200" value="' + esc(e.note || '') + '"></div>'
      + '<p class="err" id="fErr" hidden></p><button class="btn gold block" type="submit" id="fBtn">Save</button></form>'
      + (e.id ? '<div><button class="btn danger" data-act="delFin" data-id="' + e.id + '">Delete this entry</button></div>' : ''));
    $('#fCat').addEventListener('change', function () { $('#fCatNewWrap').hidden = this.value !== '__new'; });
  }
  function saveFin() {
    var d = sheet.data, cat = $('#fCat').value === '__new' ? $('#fCatNew').value.trim() : $('#fCat').value, err = $('#fErr');
    if (!cat) { err.textContent = 'Choose or type a category.'; err.hidden = false; return; }
    if (!(+$('#fAmt').value > 0)) { err.textContent = 'Enter an amount.'; err.hidden = false; return; }
    $('#fBtn').disabled = true;
    api.saveFinance({ id: d.id, kind: d.kind, category: cat, amount: +$('#fAmt').value, entry_date: $('#fDate').value, party: $('#fParty').value.trim(), note: $('#fNote').value.trim(), account: pickedAcc('finAcc') })
      .then(function (row) {
        S.finAll = null; S.myFin = null;
        S.fin = (S.fin || []).filter(function (x) { return x.id !== row.id; }); if (row.entry_date.slice(0, 4) === String(S.finYear)) S.fin.unshift(row);
        S.fin.sort(function (a, b) { return a.entry_date < b.entry_date ? 1 : -1; });
        closeSheet(); render(); MZ.toast((d.kind === 'income' ? 'Income' : 'Expense') + ' saved.');
      }).catch(function (e) { err.textContent = e.message; err.hidden = false; $('#fBtn').disabled = false; });
  }

  /* ------------------------------------------------------ fees (accounts) */
  function lastRem(sid) { return (S.reminders || []).find(function (r) { return r.student_id === sid; }) || null; }
  function renderFeesAcc() {
    if (!S.reminders && !S.remLoading) { S.remLoading = true; api.listReminders().then(function (l) { S.reminders = l.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }); S.remLoading = false; render(); }).catch(function () { S.reminders = []; S.remLoading = false; }); }
    var m = S.month, cur = S.settings.currency, y = m.slice(0, 4);
    var act = S.students.filter(function (s) { return !s.disabled && (s.start_month || '0000-00') <= m; }).filter(pgmOk);
    var rows = act.map(function (s) {
      var p = payMap[s.id + '|' + m] || null, ytd = MZ.feeSummary(s, S.payments, y + '-01', m);
      return { s: s, p: p, due: MZ.onLeave(s, m) && !p ? 0 : MZ.effFee(s), paid: p ? p.amount : 0, ytd: ytd };
    });
    var total = rows.reduce(function (a, r) { return a + r.due; }, 0), coll = rows.reduce(function (a, r) { return a + r.paid; }, 0);
    var paidN = rows.filter(function (r) { return r.p; }).length, owed = rows.reduce(function (a, r) { return a + Math.max(0, r.ytd.balance); }, 0);
    var discN = rows.filter(function (r) { return r.s.discount_value; }).length, discSum = rows.reduce(function (a, r) { return a + (r.s.monthly_fee - r.due); }, 0);
    var shown = rows.filter(function (r) {
      if (S.ffilter === 'paid') return !!r.p; if (S.ffilter === 'due') return r.ytd.balance > 0; if (S.ffilter === 'discount') return !!r.s.discount_value; return true;
    }).sort(function (a, b) { return b.ytd.balance - a.ytd.balance || a.s.full_name.localeCompare(b.s.full_name); });
    var h = '<div class="pagehead"><div><p class="eyebrow">Accounts · Fees</p><h1>' + esc(MZ.monthLabel(m)) + '</h1></div><div class="monthnav"><button class="iconbtn" data-act="prevMonth" aria-label="Previous month">' + I.left + '</button><button class="iconbtn" data-act="nextMonth" aria-label="Next month">' + I.right + '</button></div></div>';
    h += '<div class="cards4"><div class="stat4"><span>Total amount</span><b class="num">' + esc(MZ.money(total, cur)) + '</b><small>' + act.length + ' students, after discounts</small></div>'
      + '<div class="stat4 good"><span>Paid</span><b class="num">' + esc(MZ.money(coll, cur)) + '</b><small>' + paidN + ' of ' + act.length + ' students</small></div>'
      + '<div class="stat4 bad"><span>Balance due</span><b class="num">' + esc(MZ.money(owed, cur)) + '</b><small>All unpaid months in ' + y + '</small></div>'
      + '<div class="stat4 gold"><span>Discounts</span><b class="num">' + esc(MZ.money(discSum, cur)) + '</b><small>' + discN + ' student' + (discN === 1 ? '' : 's') + ' this month</small></div></div>';
    h += allTimeHTML();
    var dueN = rows.filter(function (r) { return r.ytd.balance > 0; }).length;
    h += '<div class="toolbar"><div class="chips" role="group" aria-label="Filter">' + [['all', 'All', rows.length], ['paid', 'Paid', paidN], ['due', 'Balance due', dueN], ['discount', 'With discount', discN]].map(function (c) {
      return '<button class="chip" type="button" data-act="ffilter" data-f="' + c[0] + '" aria-pressed="' + (S.ffilter === c[0]) + '">' + c[1] + '<b>' + c[2] + '</b></button>';
    }).join('') + '</div><span class="spacer"></span>' + pgmSelectHTML('pgmAcc') + '<button class="btn sm" data-act="printAccounts">' + I.print + 'Print accounts</button>' + (dueN ? '<button class="btn sm" data-act="copyReminders">Copy all reminders (' + dueN + ')</button>' : '') + '</div>';
    h += '<div class="tablewrap" style="margin-top:12px"><table class="grid"><thead><tr><th>Student</th><th class="r">Monthly fee</th><th>Discount</th><th class="r">Due ' + esc(MZ.monthShort(m)) + '</th><th class="r">Paid</th><th class="r">Balance ' + y + '</th><th class="r">Paid in total</th><th></th></tr></thead><tbody>'
      + shown.map(function (r) {
        var s = r.s, msg = MZ.fillReminder(S.settings.reminder_template, s, r.ytd, S.settings);
        return '<tr><td><b>' + esc(s.full_name) + '</b><br><small class="muted mono">' + esc(idLine(s)) + '</small></td><td class="r">' + esc(MZ.money(s.monthly_fee, cur)) + '</td>'
          + '<td>' + (s.discount_value ? '<span class="pill">' + esc(MZ.discountLabel(s, cur)) + '</span>' : '<span class="muted">—</span>') + '</td>'
          + '<td class="r">' + esc(MZ.money(r.due, cur)) + '</td><td class="r">' + (r.p ? '<span class="pos">' + esc(MZ.money(r.paid, cur)) + '</span>' : '<span class="muted">—</span>') + '</td>'
          + '<td class="r">' + (r.ytd.balance > 0 ? '<span class="neg">' + esc(MZ.money(r.ytd.balance, cur)) + '</span><br><small class="muted">' + esc(r.ytd.unpaid.map(MZ.monthShort).join(', ')) + '</small>' : '<span class="pos">Clear</span>') + (MZ.onLeave(s, m) ? '<br><span class="pill leave"><i></i>On leave</span>' : '') + '</td>'
          + '<td class="r">' + (paidAll(s.id) ? '<b>' + esc(MZ.money(paidAll(s.id).total, cur)) + '</b><br><small class="muted">' + paidAll(s.id).months + ' month' + (paidAll(s.id).months === 1 ? '' : 's') + '</small>' : '<span class="muted">…</span>') + '</td>'
          + '<td class="r" style="white-space:nowrap">' + (r.ytd.balance > 0 ? (lastRem(s.id) ? '<small class="muted" style="display:block">Reminded ' + esc(MZ.dateShort(lastRem(s.id).created_at.slice(0, 10))) + (lastRem(s.id).seen_at ? ' · seen' : '') + '</small>' : '')
            + (s.phone ? '<a class="btn sm" target="_blank" rel="noopener" data-act="remindLink" data-id="' + esc(s.id) + '" data-amt="' + r.ytd.balance + '" data-text="' + esc(msg) + '" href="' + esc(MZ.wa(s.phone, msg)) + '">Remind on WhatsApp</a> '
              : '<button class="btn sm" data-act="remindApp" data-id="' + esc(s.id) + '" data-amt="' + r.ytd.balance + '" data-text="' + esc(msg) + '" title="No mobile number yet, the student sees it in their portal">Send reminder</button> ') : '')
          + '<button class="btn sm ghost" data-act="discount" data-id="' + esc(s.id) + '">Discount</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    h += '<form class="card form" id="reminderForm" style="margin-top:16px" autocomplete="off"><div><p class="eyebrow">Fee reminder message</p><p class="muted" style="font-size:13.5px">Used for the Remind buttons. You can use {name}, {fullname}, {months}, {balance} and {institute}.</p></div>'
      + '<div class="field"><label for="remTpl" class="sr">Reminder message</label><textarea id="remTpl" rows="3" maxlength="600" class="input">' + esc(S.settings.reminder_template) + '</textarea></div><div><button class="btn gold" type="submit">Save message</button></div></form>';
    return h;
  }
  function sendRem(t, viaWa) {
    var sid = t.dataset.id, st = studentById(sid);
    api.sendReminder(sid, t.dataset.text, +t.dataset.amt || null).then(function (r) {
      S.reminders = [r].concat(S.reminders || []); render();
      MZ.toast(viaWa ? 'Reminder sent in the portal too. Finish sending it in WhatsApp.' : 'Reminder sent. ' + MZ.firstName(st.full_name) + ' will see it in the student portal.');
    }).catch(function (e) { MZ.toast(e.message); });
  }
  function openDiscount(id) {
    var s = studentById(id), cur = S.settings.currency;
    openSheet('discount', { id: id }, head('Fee discount', s.full_name)
      + '<form class="form" id="discForm" autocomplete="off"><p class="muted">Monthly fee: <b>' + esc(MZ.money(s.monthly_fee, cur)) + '</b></p>'
      + '<div class="two"><div class="field"><label for="dType">Discount type</label><select id="dType"><option value="amount"' + (s.discount_type !== 'percent' ? ' selected' : '') + '>Amount (' + esc(cur) + ')</option><option value="percent"' + (s.discount_type === 'percent' ? ' selected' : '') + '>Percent (%)</option></select></div>'
      + '<div class="field"><label for="dVal">Discount</label><input id="dVal" type="number" min="0" step="any" value="' + (s.discount_value || '') + '" placeholder="0"></div></div>'
      + '<div class="field"><label for="dNote">Reason (optional)</label><input id="dNote" maxlength="100" value="' + esc(s.discount_note) + '" placeholder="e.g. Sibling discount, scholarship"></div>'
      + '<p class="okmsg" id="dPrev"></p><button class="btn gold block" type="submit">Save discount</button></form>'
      + (s.discount_value ? '<div><button class="btn" data-act="clearDiscount" data-id="' + esc(s.id) + '">Remove discount</button></div>' : ''));
    var upd = function () { var t = { monthly_fee: s.monthly_fee, discount_type: $('#dType').value, discount_value: +$('#dVal').value || 0 }; $('#dPrev').textContent = 'New monthly fee: ' + MZ.money(MZ.effFee(t), cur); };
    $('#dType').addEventListener('change', upd); $('#dVal').addEventListener('input', upd); upd();
  }
  function saveDiscount(id, type, val, note) {
    if (type === 'percent' && val > 100) { MZ.toast('A percent discount cannot be more than 100.'); return; }
    api.updateStudent(id, { discount_type: type, discount_value: val, discount_note: note || null }).then(function (s) {
      S.students = S.students.map(function (x) { return x.id === id ? s : x; }); closeSheet(); render(); MZ.toast(val ? 'Discount saved.' : 'Discount removed.');
    }).catch(function (e) { MZ.toast(e.message); });
  }

  /* ================================================================ HR */
  var CRIT_SHORT = { punctuality: 'Punctual', concentration: 'Focus', listening: 'Listening', teaching: 'Teaching', coaching: 'Coaching', attitude: 'Attitude', ownership: 'Ownership' };
  function scoreChip(v) { v = +v || 0; return v ? '<span class="sc sc' + Math.round(v) + '">' + (v % 1 ? v.toFixed(1) : v) + '</span>' : '<span class="muted">—</span>'; }
  var STAFF_ROLES = ['Hifz teacher', 'Tajweed teacher', 'Assistant teacher', 'Administrator', 'Support staff'];
  var HR = {
    teachers: { kind: 'teacher', title: 'Teachers', one: 'teacher', desc: 'All teachers and staff. Tap a row to edit.',
      fields: [['full_name', 'Full name', 'text', 1], ['its_no', 'ITS no', 'text'], ['role', 'Role', 'list', 0, STAFF_ROLES], ['phone', 'Mobile number', 'tel'], ['email', 'Email', 'email'], ['sanad_year', 'Sanad year', 'text'],
        ['tadreeb', 'Tadreeb al Huffaz program attended', 'select', 0, ['Yes', 'No']], ['join_date', 'Joining date', 'date'],
        ['salary', 'Monthly salary', 'money'], ['status', 'Status', 'select', 1, ['Active', 'On leave', 'Left']], ['user_id', 'Teacher login (they can edit their own profile)', 'login'], ['notes', 'Notes', 'textarea']],
      cols: [['Name', function (d) { return '<b>' + esc(d.full_name) + '</b>' + (d.its_no ? '<br><small class="muted mono">ITS ' + esc(d.its_no) + '</small>' : ''); }], ['Role', 'role'], ['Mobile', 'phone'],
        ['Sanad', 'sanad_year'], ['Tadreeb', function (d) { return d.tadreeb ? '<span class="pill ' + (d.tadreeb === 'Yes' ? 'good' : 'plain') + '">' + esc(d.tadreeb) + '</span>' : ''; }],
        ['Login', function (d) { var a = (S.staff || []).find(function (x) { return x.user_id === d.user_id; }); return d.user_id ? '<span class="mono">' + esc(a ? a.username : 'linked') + '</span>' : '<span class="muted">—</span>'; }], ['Joined', function (d) { return d.join_date ? esc(MZ.dateLabel(d.join_date)) : ''; }],
        ['Salary', function (d) { return d.salary ? esc(MZ.money(d.salary, S.settings.currency)) : ''; }, 1], ['Status', function (d) { return '<span class="pill ' + (d.status === 'Active' ? 'good' : d.status === 'Left' ? 'plain' : 'warn') + '">' + esc(d.status || 'Active') + '</span>'; }]],
      sort: function (a, b) { return (a.data.status === 'Left') - (b.data.status === 'Left') || String(a.data.full_name).localeCompare(b.data.full_name); } },
    teacher_rating: { kind: 'teacher_rating', title: 'Teacher ratings', one: 'rating', desc: 'The institute\u2019s rating of each teacher, 1 to 5, every month. Students\u2019 ratings are under Student feedback.', monthly: 1,
      fields: [['teacher_id', 'Teacher', 'teacher', 1], ['month', 'Month', 'month', 1]].concat(MZ.TEACHER_CRITERIA.map(function (c) { return [c[0], c[1], 'rating', 1]; })).concat([['positives', 'Appreciation (what went well)', 'textarea'], ['improve', 'Areas to improve', 'textarea'], ['comment', 'Comment', 'textarea']]),
      cols: [['Teacher', function (d) { return '<b>' + esc(tName(d.teacher_id)) + '</b>'; }], ['Month', function (d) { return esc(MZ.monthLabel(d.month)); }]]
        .concat(MZ.TEACHER_CRITERIA.map(function (c) { return [CRIT_SHORT[c[0]], function (d) { return scoreChip(d[c[0]]); }, 1]; }))
        .concat([['Average', function (d) { var a = MZ.scoreAvg(d); return a ? stars(Math.round(a)) + ' <b>' + a.toFixed(1) + '</b>' : '—'; }, 1]]) },
    payroll: { kind: 'payroll', title: 'Payroll', one: 'salary record', desc: 'Monthly salaries. Paid salaries are counted as expenses in Accounts.', monthly: 1,
      fields: [['teacher_id', 'Teacher', 'teacher', 1], ['month', 'Month', 'month', 1], ['basic', 'Basic salary', 'money', 1], ['allowances', 'Allowances', 'money'], ['deductions', 'Deductions', 'money'],
        ['status', 'Status', 'select', 1, ['Unpaid', 'Paid']], ['paid_on', 'Paid on', 'date'], ['method', 'Paid by', 'select', 0, ['Cash', 'M-Pesa', 'Mobile money', 'Bank transfer', 'Cheque']], ['note', 'Note', 'text']],
      cols: [['Teacher', function (d) { return '<b>' + esc(tName(d.teacher_id)) + '</b>'; }], ['Month', function (d) { return esc(MZ.monthLabel(d.month)); }], ['Basic', function (d) { return esc(MZ.money(d.basic, S.settings.currency)); }, 1],
        ['+ / −', function (d) { return '<span class="pos">+' + esc(Number(d.allowances || 0).toLocaleString('en-US')) + '</span> <span class="neg">−' + esc(Number(d.deductions || 0).toLocaleString('en-US')) + '</span>'; }, 1],
        ['Net pay', function (d) { return '<b>' + esc(MZ.money(payNet(d), S.settings.currency)) + '</b>'; }, 1], ['Status', function (d, r) { return d.status === 'Paid' ? '<span class="pill good">Paid ' + esc(MZ.dateShort(d.paid_on)) + '</span>' : '<button class="btn sm gold" data-act="payPayroll" data-id="' + r.id + '">Mark paid</button>'; }]] },
    attendance: { kind: 'attendance', title: 'Attendance', custom: 1 },
    leave: { kind: 'leave', title: 'Leave record', one: 'leave', desc: 'Leave taken or requested by teachers.',
      fields: [['teacher_id', 'Teacher', 'teacher', 1], ['from_date', 'From', 'date', 1], ['to_date', 'To', 'date', 1], ['type', 'Type of leave', 'select', 1, ['Sick', 'Annual', 'Emergency', 'Hajj / Ziyarat', 'Unpaid', 'Other']],
        ['status', 'Status', 'select', 1, ['Approved', 'Pending', 'Rejected']], ['reason', 'Reason', 'textarea']],
      cols: [['Teacher', function (d) { return '<b>' + esc(tName(d.teacher_id)) + '</b>'; }], ['Dates', function (d) { return esc(MZ.dateShort(d.from_date)) + (d.to_date && d.to_date !== d.from_date ? ' – ' + esc(MZ.dateShort(d.to_date)) : ''); }],
        ['Days', function (d) { return String(leaveDays(d)); }, 1], ['Type', 'type'], ['Status', function (d) { return '<span class="pill ' + (d.status === 'Approved' ? 'good' : d.status === 'Rejected' ? 'bad' : 'warn') + '">' + esc(d.status) + '</span>'; }], ['Reason', 'reason']],
      sort: function (a, b) { return a.data.from_date < b.data.from_date ? 1 : -1; }, inMonth: function (d, m) { return (d.from_date || '').slice(0, 7) <= m && (d.to_date || d.from_date || '').slice(0, 7) >= m; } },
    student_rating: { kind: 'student_rating', title: 'Student ratings', one: 'rating', desc: 'Rate students from 1 to 5 each month.', monthly: 1,
      fields: [['student_id', 'Student', 'student', 1], ['month', 'Month', 'month', 1], ['hifz', 'Hifz (memorisation)', 'rating', 1], ['tajweed', 'Tajweed', 'rating', 1], ['behaviour', 'Behaviour (akhlaq)', 'rating', 1], ['attendance', 'Attendance', 'rating', 1], ['comment', 'Comment', 'textarea']],
      cols: [['Student', function (d) { var s = studentById(d.student_id); return '<b>' + esc(s ? s.full_name : 'Removed student') + '</b>'; }], ['Month', function (d) { return esc(MZ.monthLabel(d.month)); }], ['Hifz', function (d) { return stars(d.hifz); }], ['Tajweed', function (d) { return stars(d.tajweed); }],
        ['Behaviour', function (d) { return stars(d.behaviour); }], ['Attendance', function (d) { return stars(d.attendance); }], ['Average', function (d) { return '<b>' + avg([d.hifz, d.tajweed, d.behaviour, d.attendance]) + '</b>'; }, 1]] }
  };
  function hrList(kind) { return (S.hr || []).filter(function (r) { return r.kind === kind; }); }
  function hrById(id) { return (S.hr || []).find(function (r) { return String(r.id) === String(id); }) || null; }
  function tName(id) { var t = hrById(id); return t ? t.data.full_name : 'Removed teacher'; }
  function teachers(activeOnly) { return hrList('teacher').filter(function (t) { return !activeOnly || t.data.status !== 'Left'; }).sort(function (a, b) { return String(a.data.full_name).localeCompare(b.data.full_name); }); }
  function payNet(d) { return Math.max(0, (Number(d.basic) || 0) + (Number(d.allowances) || 0) - (Number(d.deductions) || 0)); }
  function avg(v) { v = v.map(Number).filter(function (x) { return x > 0; }); return v.length ? (v.reduce(function (a, b) { return a + b; }, 0) / v.length).toFixed(1) : '—'; }
  function stars(n) { n = +n || 0; var s = ''; for (var i = 1; i <= 5; i++) s += '<span class="st' + (i <= n ? ' on' : '') + '">★</span>'; return '<span class="stars" aria-label="' + n + ' out of 5">' + s + '</span>'; }
  function leaveDays(d) { if (!d.from_date) return 0; var a = new Date(d.from_date), b = new Date(d.to_date || d.from_date); return Math.max(1, Math.round((b - a) / 864e5) + 1); }

  /* ================================================ OCTOBER (2) ADDITIONS */
  /* ---- program-wise view (Students, Fees, Accounts → Fees) */
  function pgmOk(s) { return !S.pgm || (S.pgm === '__none' ? !s.program : s.program === S.pgm); }
  function pgmSelectHTML(id) {
    var ps = programs(), none = S.students.some(function (s) { return !s.program; });
    if (!ps.length) return '';
    return '<label class="pgmsel"><span class="sr">Program</span><select id="' + id + '" data-pgm="1" aria-label="Program"><option value="">All programs</option>'
      + ps.map(function (p) { return '<option value="' + esc(p) + '"' + (S.pgm === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('')
      + (none ? '<option value="__none"' + (S.pgm === '__none' ? ' selected' : '') + '>No program set</option>' : '') + '</select></label>';
  }
  function pgmLabel(p) { return p ? p : 'No program set'; }
  /* Students tab: one tile per program with its count; tap to show only that program. */
  function pgmStripHTML() {
    var ps = programs(); if (!ps.length) return '';
    var act = S.students.filter(function (s) { return !s.disabled; }), cur = S.settings.currency;
    var keys = ps.concat(act.some(function (s) { return !s.program; }) ? [''] : []);
    return '<div class="pgmstrip" role="group" aria-label="Programs">' + keys.map(function (p) {
      var l = act.filter(function (s) { return (s.program || '') === p; }), v = p || '__none';
      var fee = l.reduce(function (a, s) { return a + MZ.effFee(s); }, 0);
      return '<button class="pgmtile" type="button" data-act="pgmPick" data-p="' + esc(v) + '" aria-pressed="' + (S.pgm === v) + '"><b>' + esc(pgmLabel(p)) + '</b><span class="num">' + l.length + ' student' + (l.length === 1 ? '' : 's') + '</span>'
        + (can('fees') ? '<small class="num">' + esc(MZ.money(fee, cur)) + ' a month</small>' : '') + '</button>';
    }).join('') + '</div>';
  }
  /* Fees tab: this month by program. */
  function pgmFeesHTML(rows) {
    var ps = programs(); if (!ps.length || isCashier()) return '';
    var keys = ps.concat(rows.some(function (r) { return !r.s.program; }) ? [''] : []), cur = S.settings.currency;
    var body = keys.map(function (p) {
      var l = rows.filter(function (r) { return (r.s.program || '') === p; }); if (!l.length) return '';
      var exp = 0, got = 0, wait = 0, paidN = 0, notN = 0;
      l.forEach(function (r) { if (r.st === 'leave') return; exp += MZ.effFee(r.s); if (r.p) { paidN++; if (r.p.status === 'pending') wait += r.p.amount; else got += r.p.amount; } else notN++; });
      var pc = exp ? Math.min(100, Math.round(got / exp * 100)) : 0;
      return '<tr><td><button class="linkbtn" data-act="pgmPick" data-p="' + esc(p || '__none') + '">' + esc(pgmLabel(p)) + '</button></td><td class="r">' + l.length + '</td><td class="r">' + esc(MZ.money(exp, cur)) + '</td><td class="r"><span class="pos">' + esc(MZ.money(got, cur)) + '</span>' + (wait ? '<br><small class="muted">+ ' + esc(MZ.money(wait, cur)) + ' waiting</small>' : '') + '</td>'
        + '<td style="min-width:110px"><div class="mbar" style="height:8px"><i style="width:' + pc + '%"></i></div><small class="muted">' + pc + '%</small></td><td class="r">' + paidN + '</td><td class="r">' + (notN ? '<span class="neg">' + notN + '</span>' : '0') + '</td></tr>';
    }).join('');
    return '<details class="card pgmfees"' + (S.pgmOpen ? ' open' : '') + '><summary><span><p class="eyebrow">Program-wise</p><b>' + esc(MZ.monthLabel(S.month)) + ' by program</b></span><span class="muted">' + keys.length + ' program' + (keys.length === 1 ? '' : 's') + '</span></summary>'
      + '<div class="tablewrap"><table class="grid"><thead><tr><th>Program</th><th class="r">Students</th><th class="r">Expected</th><th class="r">Collected</th><th>Progress</th><th class="r">Paid</th><th class="r">Not paid</th></tr></thead><tbody>' + body + '</tbody></table></div></details>';
  }
  document.addEventListener('change', function (e) { if (e.target.dataset && e.target.dataset.pgm) { S.pgm = e.target.value; S.sel = {}; render(); } });
  document.addEventListener('toggle', function (e) { if (e.target.classList && e.target.classList.contains('pgmfees')) S.pgmOpen = e.target.open; }, true);

  /* ---- Accounts → Fees: everything received, all months together */
  function allTimeHTML() {
    var l = allPays(), cur = S.settings.currency;
    if (!l) return '<div class="alltime"><span class="muted">Adding up every month…</span></div>';
    var ok = {}; S.students.forEach(function (s) { if (pgmOk(s)) ok[s.id] = 1; });
    var got = l.filter(function (p) { return p.status !== 'pending' && ok[p.student_id]; }), wait = l.filter(function (p) { return p.status === 'pending' && ok[p.student_id]; });
    var tot = got.reduce(function (a, p) { return a + p.amount; }, 0), ms = got.map(function (p) { return p.month; }).sort();
    var byY = {}; got.forEach(function (p) { var y = p.month.slice(0, 4); byY[y] = (byY[y] || 0) + p.amount; });
    var who = {}; got.forEach(function (p) { who[p.student_id] = 1; });
    return '<section class="alltime"><div class="at-main"><p class="eyebrow">Total received · all months' + (S.pgm ? ' · ' + esc(pgmLabel(S.pgm === '__none' ? '' : S.pgm)) : '') + '</p><b class="num">' + esc(MZ.money(tot, cur)) + '</b>'
      + '<small>' + got.length + ' receipt' + (got.length === 1 ? '' : 's') + ' from ' + Object.keys(who).length + ' student' + (Object.keys(who).length === 1 ? '' : 's') + (ms.length ? ' · ' + esc(MZ.monthLabel(ms[0])) + ' to ' + esc(MZ.monthLabel(ms[ms.length - 1])) : '') + (wait.length ? ' · + ' + esc(MZ.money(wait.reduce(function (a, p) { return a + p.amount; }, 0), cur)) + ' waiting for approval' : '') + '</small></div>'
      + '<div class="at-years">' + Object.keys(byY).sort().reverse().map(function (y) { return '<span><small>' + y + '</small><b class="num">' + esc(MZ.money(byY[y], cur)) + '</b></span>'; }).join('') + '</div></section>';
  }

  /* ---- payment slips (JPEG / PNG / PDF) */
  function proofLine(p) {
    if (!p) return '';
    var canAdd = can('enter') && !isViewer() && (can('fees') || (isCashier() && p.status === 'pending'));
    if (p.proof_path) return '<div class="proofbox"><span class="pf-ico">' + I.doc + '</span><span class="pf-t"><small>Payment slip</small><b>' + esc(p.proof_name || 'Slip') + '</b></span>'
      + '<span class="btnrow"><button class="btn sm" data-act="openProof" data-id="' + p.id + '">Open</button>' + (canAdd ? '<label class="btn sm ghost">Replace<input type="file" class="sr" data-proof="' + p.id + '" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"></label>' : '')
      + (can('fees') ? '<button class="btn sm ghost danger" data-act="removeProof" data-id="' + p.id + '">Remove</button>' : '') + '</span></div>';
    return canAdd ? '<div class="proofbox empty"><span class="pf-ico">' + I.upload + '</span><span class="pf-t"><small>Payment slip</small><b>No slip attached</b></span><label class="btn sm">Attach JPEG or PDF<input type="file" class="sr" data-proof="' + p.id + '" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"></label></div>' : '';
  }
  function swapPayment(p2) {
    var rep = function (l) { return (l || []).map(function (x) { return x.id === p2.id ? Object.assign({}, x, p2) : x; }); };
    S.payments = rep(S.payments); indexPayments(); if (S.allPayments) S.allPayments = rep(S.allPayments); if (S.pending) S.pending = rep(S.pending);
    if (sheet && sheet.data && sheet.data.pays) sheet.data.pays = rep(sheet.data.pays);
  }
  function attachProof(pid, file) {
    var p = findPayment(pid); if (!p || !file) return;
    var bad = MZ.proofCheck(file); if (bad) { MZ.toast(bad); return; }
    MZ.toast('Uploading the payment slip…');
    api.uploadProof(p, file).then(function (p2) { swapPayment(p2); if (sheet && sheet.kind === 'receipt') showReceipt(p2, sheet.data.s); render(); MZ.toast('Payment slip saved with receipt ' + p2.receipt_no + '.'); })
      .catch(function (e) { MZ.toast('Slip not saved: ' + e.message); });
  }
  document.addEventListener('change', function (e) { var t = e.target; if (t.dataset && t.dataset.proof && t.files && t.files[0]) attachProof(t.dataset.proof, t.files[0]); });
  function openProof(pid) {
    var p = findPayment(pid); if (!p) return;
    // iPhone home-screen apps cannot show a file in a pop-up, so no pop-up is opened there
    var w = null; if (!MZ.push.ios() && !/\.(png|jpe?g|webp|gif|heic)$/i.test(p.proof_name || '')) try { w = window.open('', '_blank'); } catch (e) {}
    api.proofBlob(p).then(function (b) { MZ.viewBlob(b, p.proof_name || 'payment-slip', w); }).catch(function (e) { if (w) w.close(); MZ.toast(e.message); });
  }

  /* ---- Mastership badge (automatic, every 100 keys) and praise badges */
  function badgesSection(s) {
    var n = MZ.mastery(s.keys), left = MZ.MASTER_EVERY - (s.keys % MZ.MASTER_EVERY);
    return '<section id="secBadges"><h3>Badges</h3><div class="panel form">'
      + '<div class="masterrow">' + MZ.masteryMedal(48) + '<div><b>' + (n ? n + ' Mastership badge' + (n === 1 ? '' : 's') : 'No Mastership badge yet') + '</b><small class="muted">Given automatically for every ' + MZ.MASTER_EVERY + ' keys · ' + left + ' keys to the next</small></div></div>'
      + '<div id="sBadges">' + (sheet && sheet.kind === 'student' && sheet.data.id === s.id && sheet.data.badges ? badgeListHTML(sheet.data.badges, can('teach')) : '<p class="muted">Loading praise badges…</p>') + '</div>'
      + (can('teach') ? '<div class="btnrow"><button class="btn gold" type="button" data-act="awardBadge" data-sid="' + esc(s.id) + '">' + I.plus + 'Give a praise badge</button></div>' : '')
      + '</div></section>';
  }
  function badgeListHTML(list, removable) {
    if (!list.length) return '<p class="muted" style="font-size:13.5px">No praise badges yet.</p>';
    return '<div class="badgelist">' + list.map(function (b) {
      return '<div class="bdg">' + MZ.badgeMedal(b.badge, 44) + '<div class="bdg-t"><b>' + esc(MZ.badgeTitle(b)) + '</b><small class="muted">' + esc(MZ.dateLabel(String(b.created_at).slice(0, 10))) + ' · by ' + esc(b.awarded_by_name || 'The institute') + '</small>' + (b.note ? '<span class="bdg-n">“' + esc(b.note) + '”</span>' : '') + '</div>'
        + (removable ? '<button class="iconbtn" data-act="delBadge" data-id="' + b.id + '" aria-label="Remove this badge" title="Remove">' + I.x + '</button>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function loadSheetBadges(sid) {
    if (!(can('teach') || isViewer()) || !api.listBadges) return;
    api.listBadges(sid).then(function (l) {
      if (!sheet || sheet.kind !== 'student' || sheet.data.id !== sid) return;
      sheet.data.badges = l; var el = $('#sBadges'); if (el) el.innerHTML = badgeListHTML(l, can('teach'));
    }).catch(function () { var el = $('#sBadges'); if (el) el.innerHTML = '<p class="muted">Praise badges need the latest database update (supabase-update-2.sql).</p>'; });
  }
  function openAward(sid) {
    var s = studentById(sid); if (!s) return;
    openSheet('award', { sid: sid }, head('Praise badge', s.full_name)
      + '<form class="form" id="awardForm" autocomplete="off"><fieldset class="badgepick"><legend class="flabel">Choose a badge</legend>'
      + MZ.BADGES.map(function (b, i) { return '<label class="bp"><input type="radio" name="bdg" value="' + b[0] + '"' + (i === 0 ? ' checked' : '') + '>' + MZ.badgeMedal(b[0], 46) + '<b>' + esc(b[1]) + '</b><small>' + esc(b[2]) + '</small></label>'; }).join('') + '</fieldset>'
      + '<div class="field"><label for="bdgNote">Why (optional, ' + esc(MZ.firstName(s.full_name)) + ' sees this)</label><input id="bdgNote" maxlength="300" placeholder="e.g. Recited Surah Yaseen with no mistakes"></div>'
      + '<p class="err" id="bdgErr" hidden></p><button class="btn gold block" type="submit" id="bdgBtn">Give badge</button></form>');
  }
  function saveAward() {
    var sid = sheet.data.sid, s = studentById(sid), c = document.querySelector('input[name=bdg]:checked'), k = c ? c.value : MZ.BADGES[0][0], d = MZ.badgeDef(k);
    var title = d[1], err = $('#bdgErr');
    if (!MZ.BADGES.some(function (b) { return b[0] === k; })) { err.textContent = 'Choose one of the badges.'; err.hidden = false; return; }
    if (!title) { err.textContent = 'Write a title for the badge.'; err.hidden = false; return; }
    $('#bdgBtn').disabled = true;
    api.awardBadge({ student_id: sid, badge: k, title: title, note: $('#bdgNote').value.trim() }).then(function () {
      MZ.toast(title + ' given to ' + MZ.firstName(s.full_name) + '. They see it in their portal.'); openStudent(sid);
      setTimeout(function () { var x = $('#secBadges'); if (x) x.scrollIntoView({ block: 'start' }); }, 250);
    }).catch(function (e2) { err.textContent = e2.message; err.hidden = false; $('#bdgBtn').disabled = false; });
  }

  /* ---- Roles & responsibilities, yearly goals & follow-up (stored as HR records) */
  var DUTY_ROLES = ['Head of Hifz', 'Class teacher', 'Tajweed in-charge', 'Ikhtibar in-charge', 'Accounts', 'Admin office', 'Student affairs', 'Parent liaison'];
  var FOLLOW_DAYS = { 'Week': 7, '2 weeks': 14, 'Month': 30, '3 months': 90 };
  function personName(d) { return d.teacher_id ? tName(d.teacher_id) : (d.person || '—'); }
  function personRec(d) { return d.teacher_id ? hrById(d.teacher_id) : null; }
  function addDays(d, n) { var x = new Date((d || MZ.today()) + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
  function goalOpen(d) { return d.status !== 'Done' && d.status !== 'Dropped'; }
  function goalState(d) {
    if (!goalOpen(d)) return '';
    var t = MZ.today();
    if (d.due_date && d.due_date < t) return 'late';
    if (d.next_follow && d.next_follow <= t) return 'follow';
    return '';
  }
  function goalsNeeding() { return hrList('goal').filter(function (r) { return goalState(r.data); }); }
  function updateGoalBadge() {
    var b = document.querySelector('.tab[data-tab=goals]'); if (!b) return;
    var n = S.hr ? goalsNeeding().length : 0;
    b.innerHTML = 'Goals' + (n ? '<span class="tabbadge" aria-label="' + n + ' need follow-up">' + n + '</span>' : '');
  }
  function goalReminders() {
    if (!(isAdmin() || isViewer()) || !api.listHR) return;
    var go = function () {
      updateGoalBadge();
      var n = goalsNeeding().length; if (!n || !isAdmin()) return;
      var k = 'qt_goal_nudge_' + MZ.today(); try { if (localStorage.getItem(k)) return; localStorage.setItem(k, '1'); } catch (e) {}
      MZ.toast(n + ' yearly goal' + (n === 1 ? ' needs' : 's need') + ' a follow-up.', { label: 'Open', fn: function () { S.tab = 'goals'; render(); } });
    };
    if (S.hr) return go();
    api.listHR().then(function (l) { if (!S.hr) S.hr = l; go(); }).catch(function () {});
  }
  function lines(t) { return String(t || '').split(/\n+/).map(function (x) { return x.replace(/^[-•*\s]+/, '').trim(); }).filter(Boolean); }
  function goalRemindText(d) {
    return 'Assalamu alaikum ' + MZ.firstName(personName(d)) + ',\n\nA reminder about the goal *' + d.title + '* (' + d.year + ').\n'
      + (d.target ? 'Target: ' + d.target + '\n' : '') + 'Target date: ' + MZ.dateLabel(d.due_date) + '\nProgress so far: ' + (+d.progress || 0) + '%\n\n'
      + 'Please share an update' + (d.next_follow ? ' by ' + MZ.dateLabel(d.next_follow > MZ.today() ? d.next_follow : MZ.today()) : '') + '.\n\nRegards\nAdmin';
  }
  HR.duties = { kind: 'duty', title: 'Roles & responsibilities', eyebrow: 'Team', one: 'role', desc: 'Who does what, in writing. A teacher linked to a login sees their own under My profile.',
    fields: [['teacher_id', 'Person (from HR → Teachers)', 'teacher', 0], ['person', 'Or another person’s name', 'text'], ['position', 'Role / position', 'list', 1, DUTY_ROLES], ['reports_to', 'Reports to', 'text'],
      ['responsibilities', 'Responsibilities (one per line)', 'textarea', 1], ['from_date', 'Since', 'date'], ['status', 'Status', 'select', 1, ['Active', 'Ended']], ['notes', 'Private notes (admin only)', 'textarea']],
    defaults: function (d) { d.status = 'Active'; d.from_date = MZ.today(); },
    validate: function (d) { return d.teacher_id || d.person ? '' : 'Choose a person from HR or type a name.'; },
    cols: [['Person', function (d) { return '<b>' + esc(personName(d)) + '</b>' + (d.reports_to ? '<br><small class="muted">Reports to ' + esc(d.reports_to) + '</small>' : ''); }], ['Role', function (d) { return '<span class="pill">' + esc(d.position) + '</span>'; }],
      ['Responsibilities', function (d) { return '<ul class="duties">' + lines(d.responsibilities).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; }],
      ['Since', function (d) { return d.from_date ? esc(MZ.dateLabel(d.from_date)) : ''; }], ['Status', function (d) { return '<span class="pill ' + (d.status === 'Ended' ? 'plain' : 'good') + '">' + esc(d.status || 'Active') + '</span>'; }]],
    sort: function (a, b) { return (a.data.status === 'Ended') - (b.data.status === 'Ended') || personName(a.data).localeCompare(personName(b.data)); },
    head: function (list) {
      var act = list.filter(function (r) { return r.data.status !== 'Ended'; }), people = {}; act.forEach(function (r) { people[personName(r.data)] = 1; });
      var t = teachers(true).filter(function (x) { return !act.some(function (r) { return String(r.data.teacher_id) === String(x.id); }); });
      return '<div class="cards4"><div class="stat4"><span>Active roles</span><b class="num">' + act.length + '</b></div><div class="stat4"><span>People with a role</span><b class="num">' + Object.keys(people).length + '</b></div>'
        + '<div class="stat4 ' + (t.length ? 'bad' : 'good') + '"><span>Teachers without a role</span><b class="num">' + t.length + '</b>' + (t.length ? '<small>' + esc(t.slice(0, 3).map(function (x) { return MZ.firstName(x.data.full_name); }).join(', ')) + (t.length > 3 ? '…' : '') + '</small>' : '') + '</div>'
        + '<div class="stat4"><span>Ended</span><b class="num">' + (list.length - act.length) + '</b></div></div>';
    },
    empty: 'No roles written down yet. Add one for each person: their position and what they are responsible for.' };
  HR.goals = { kind: 'goal', title: 'Yearly goals & follow-up', eyebrow: 'Goals', one: 'goal', desc: 'Set the year’s goals, who owns each one and how often to check. Goals due for a follow-up are flagged and counted on the tab.',
    fields: [['title', 'Goal', 'text', 1], ['year', 'Year', 'text', 1], ['teacher_id', 'Responsible person (from HR)', 'teacher', 0], ['person', 'Or another person’s name', 'text'], ['target', 'Target / how it is measured', 'text'],
      ['due_date', 'Target date', 'date', 1], ['follow_every', 'Follow up every', 'select', 1, ['Week', '2 weeks', 'Month', '3 months']], ['next_follow', 'Next follow-up', 'date'], ['progress', 'Progress (%)', 'percent'],
      ['status', 'Status', 'select', 1, ['Not started', 'In progress', 'Done', 'Dropped']], ['notes', 'Notes', 'textarea']],
    defaults: function (d) { d.year = String(S.goalYear); d.status = 'Not started'; d.follow_every = 'Month'; d.next_follow = addDays(MZ.today(), 30); d.progress = 0; d.due_date = S.goalYear + '-12-31'; },
    validate: function (d) { if (!/^\d{4}$/.test(String(d.year))) return 'Year must be like ' + MZ.today().slice(0, 4) + '.'; if (!d.next_follow && goalOpen(d)) d.next_follow = addDays(MZ.today(), FOLLOW_DAYS[d.follow_every] || 30); return ''; },
    filter: function (r) { return String(r.data.year) === String(S.goalYear); },
    cols: [['Goal', function (d) { return '<b>' + esc(d.title) + '</b>' + (d.target ? '<br><small class="muted">' + esc(d.target) + '</small>' : ''); }], ['Responsible', function (d) { return esc(personName(d)); }],
      ['Target date', function (d) { return esc(MZ.dateShort(d.due_date)) + (goalState(d) === 'late' ? '<br><span class="pill bad">Past due</span>' : ''); }],
      ['Progress', function (d) { var p = Math.max(0, Math.min(100, +d.progress || 0)); return '<div class="gprog"><div class="mbar' + (d.status === 'Done' ? ' goal' : '') + '" style="height:8px"><i style="width:' + (d.status === 'Done' ? 100 : p) + '%"></i></div><small class="num">' + (d.status === 'Done' ? 100 : p) + '%</small></div>'; }],
      ['Next follow-up', function (d) { var st = goalState(d); return !goalOpen(d) ? '<span class="muted">—</span>' : '<span class="' + (st ? 'neg' : '') + '">' + esc(MZ.dateShort(d.next_follow)) + '</span>' + (st === 'follow' ? '<br><span class="pill warn">Follow up now</span>' : '') + ((d.log || []).length ? '<br><small class="muted">Last: ' + esc(MZ.dateShort(d.log[d.log.length - 1].date)) + '</small>' : ''); }],
      ['Status', function (d) { return '<span class="pill ' + (d.status === 'Done' ? 'good' : d.status === 'Dropped' ? 'plain' : d.status === 'In progress' ? '' : 'warn') + '">' + esc(d.status) + '</span>'; }]],
    sort: function (a, b) { var o = function (d) { var s = goalState(d); return s === 'late' ? 0 : s === 'follow' ? 1 : goalOpen(d) ? 2 : 3; }; return o(a.data) - o(b.data) || String(a.data.next_follow || '').localeCompare(String(b.data.next_follow || '')); },
    rowActs: function (r) { if (isViewer()) return '<button class="btn sm" data-act="goalFollow" data-id="' + r.id + '">History</button>'; return (goalOpen(r.data) ? '<button class="btn sm gold" data-act="goalFollow" data-id="' + r.id + '">Follow up</button><button class="btn sm" data-act="goalRemind" data-id="' + r.id + '">Remind</button>' : '<button class="btn sm" data-act="goalFollow" data-id="' + r.id + '">History</button>'); },
    headBtns: function () { return '<span class="monthnav"><button class="iconbtn" data-act="goalYear" data-d="-1" aria-label="Previous year">' + I.left + '</button><b style="min-width:70px;text-align:center">' + S.goalYear + '</b><button class="iconbtn" data-act="goalYear" data-d="1" aria-label="Next year">' + I.right + '</button></span>'; },
    head: function (list) {
      var done = list.filter(function (r) { return r.data.status === 'Done'; }).length, need = list.filter(function (r) { return goalState(r.data); });
      var open = list.filter(function (r) { return goalOpen(r.data); }), avgP = open.length ? Math.round(open.reduce(function (a, r) { return a + (+r.data.progress || 0); }, 0) / open.length) : 0;
      var h = '<div class="cards4"><div class="stat4"><span>Goals in ' + S.goalYear + '</span><b class="num">' + list.length + '</b></div><div class="stat4 good"><span>Done</span><b class="num">' + done + '</b></div>'
        + '<div class="stat4 gold"><span>Average progress</span><b class="num">' + avgP + '%</b><small>' + open.length + ' open goal' + (open.length === 1 ? '' : 's') + '</small></div>'
        + '<div class="stat4 ' + (need.length ? 'bad' : 'good') + '"><span>Need follow-up</span><b class="num">' + need.length + '</b></div></div>';
      if (need.length) h += '<section class="followbar"><div><p class="eyebrow">Follow-up due</p><h3>' + need.length + ' goal' + (need.length === 1 ? '' : 's') + ' to check on</h3><p class="muted">' + esc(need.slice(0, 3).map(function (r) { return r.data.title + ' (' + MZ.firstName(personName(r.data)) + ')'; }).join(' · ')) + (need.length > 3 ? ' · and ' + (need.length - 3) + ' more' : '') + '</p></div>'
        + (isViewer() ? '' : '<button class="btn gold" data-act="goalFollow" data-id="' + need[0].id + '">Start with the first</button>') + '</section>';
      return h;
    },
    empty: 'No goals for this year yet. Add the institute’s goals, who is responsible and how often to follow up.' };
  S.goalYear = +MZ.today().slice(0, 4);
  /* ---- teacher Mastership: earned for every month the institute rates all 7 categories 4 or 5 stars */
  function ratingMaster(d) { return MZ.TEACHER_CRITERIA.every(function (c) { return (+d[c[0]] || 0) >= 4; }); }
  function teacherMastery(tid) { return hrList('teacher_rating').filter(function (r) { return String(r.data.teacher_id) === String(tid) && ratingMaster(r.data); }).sort(function (a, b) { return a.data.month < b.data.month ? 1 : -1; }); }
  HR.teachers.fields.splice(HR.teachers.fields.length - 2, 0, ['can_schedule', 'Schedule permission (No: sees only their own students and cannot change anything · Drag and drop only: can move students between teachers · Yes: can also allocate, edit and cancel)', 'select', 0, ['No', 'Drag and drop only', 'Yes']]);
  HR.teachers.cols.splice(HR.teachers.cols.length - 2, 0, ['Mastership', function (d, r) {
    var m = teacherMastery(r.id); if (!m.length) return '<span class="muted" title="Earned when all 7 categories are rated 4 or 5 in a month">—</span>';
    var last = m[0].data;
    return '<span class="tmaster" title="' + esc(m.map(function (x) { return MZ.monthLabel(x.data.month); }).join(', ')) + '">' + MZ.masteryMedal(30) + '<span><b>' + m.length + ' Mastership' + (m.length === 1 ? '' : 's') + '</b><small>Latest ' + esc(MZ.monthShort(last.month)) + ' ' + esc(String(last.month).slice(0, 4)) + (last.comment ? ' · “' + esc(String(last.comment).slice(0, 60)) + '”' : '') + '</small></span></span>';
  }]);
  // what each rating means, above the ratings list
  function critGuideHTML(open) {
    return '<details class="critguide"' + (open ? ' open' : '') + '><summary>What each rating means</summary><dl>' + MZ.TEACHER_CRITERIA.map(function (c) { return '<div><dt>' + esc(c[1]) + '</dt><dd>' + esc(MZ.TEACHER_CRITERIA_DESC[c[0]]) + '</dd></div>'; }).join('') + '</dl><p class="muted">1 star = needs to improve, 5 stars = excellent.</p></details>';
  }
  HR.teacher_rating.head = function () { return critGuideHTML(true); };
  HR.teachers.rowActs = function (r) { return '<button class="btn sm" data-act="tProfile" data-id="' + r.id + '">Feedback</button>'; };
  HR.teacher_rating.cols.push(['Mastership', function (d) { return ratingMaster(d) ? '<span class="mastery" title="All 7 categories 4 or 5 stars">' + MZ.masteryMedal(16).replace('class="medal master"', 'class="medal master mini"') + 'Earned</span>' : '<span class="muted">—</span>'; }]);
  function openFollow(id) {
    var r = hrById(id); if (!r) return; var d = r.data, log = (d.log || []).slice().reverse();
    var nextDef = addDays(MZ.today(), FOLLOW_DAYS[d.follow_every] || 30);
    openSheet('follow', { id: id }, head('Goal follow-up', d.title)
      + '<div class="panel form"><p class="muted">' + esc(personName(d)) + ' · target ' + esc(MZ.dateLabel(d.due_date)) + (d.target ? ' · ' + esc(d.target) : '') + '</p>'
      + '<div class="gprog big"><div class="mbar' + (d.status === 'Done' ? ' goal' : '') + '"><i style="width:' + (+d.progress || 0) + '%"></i></div><b class="num">' + (+d.progress || 0) + '%</b></div></div>'
      + (goalOpen(d) || isAdmin() ? '<form class="form" id="followForm" autocomplete="off"><div class="two"><div class="field"><label for="fuProg">Progress now (%)</label><input id="fuProg" type="number" min="0" max="100" required value="' + (+d.progress || 0) + '"></div>'
      + '<div class="field"><label for="fuStatus">Status</label><select id="fuStatus">' + ['Not started', 'In progress', 'Done', 'Dropped'].map(function (o) { return '<option' + (d.status === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select></div></div>'
      + '<div class="field"><label for="fuNote">What was done, and the next step</label><textarea id="fuNote" class="input" rows="3" maxlength="600" required placeholder="e.g. 7 students past 100 pages. Extra murajaat class on Saturdays."></textarea></div>'
      + '<div class="field"><label for="fuNext">Next follow-up</label><input id="fuNext" type="date" value="' + nextDef + '"><span class="hint">Every ' + esc((d.follow_every || 'Month').toLowerCase()) + ' by default</span></div>'
      + '<p class="err" id="fuErr" hidden></p><button class="btn gold block" type="submit" id="fuBtn">' + I.check + 'Save follow-up</button></form>' : '')
      + '<section><h3>History</h3>' + (log.length ? '<ol class="fulog">' + log.map(function (x) { return '<li><b>' + esc(MZ.dateLabel(x.date)) + '</b> · ' + (+x.progress || 0) + '%' + (x.by ? ' · ' + esc(x.by) : '') + '<p>' + esc(x.note) + '</p></li>'; }).join('') + '</ol>' : '<p class="muted">No follow-ups yet.</p>') + '</section>');
  }
  function saveFollow() {
    var id = sheet.data.id, r = hrById(id), err = $('#fuErr'); if (!r) return;
    var note = $('#fuNote').value.trim(), prog = Math.max(0, Math.min(100, +$('#fuProg').value || 0)), st = $('#fuStatus').value, nx = $('#fuNext').value;
    if (!note) { err.textContent = 'Write what was done.'; err.hidden = false; return; }
    if (st === 'Done') prog = 100;
    var d = JSON.parse(JSON.stringify(r.data)); d.log = (d.log || []).concat([{ date: MZ.today(), note: note, progress: prog, by: MZ.ROLES[role()].name }]).slice(-60);
    d.progress = prog; d.status = st === 'Not started' && prog > 0 ? 'In progress' : st; d.next_follow = goalOpen(d) ? (nx || addDays(MZ.today(), FOLLOW_DAYS[d.follow_every] || 30)) : d.next_follow;
    $('#fuBtn').disabled = true;
    api.saveHR({ id: id, kind: 'goal', data: d }).then(function (row) {
      S.hr = (S.hr || []).filter(function (x) { return x.id !== row.id; }).concat([row]); closeSheet(); render(); MZ.toast('Follow-up saved. Next one on ' + MZ.dateLabel(d.next_follow) + '.');
    }).catch(function (e) { err.textContent = e.message; err.hidden = false; $('#fuBtn').disabled = false; });
  }
  function openGoalRemind(id) {
    var r = hrById(id); if (!r) return; var d = r.data, t = personRec(d), txt = goalRemindText(d), plain = txt.replace(/\*([^*\n]+)\*/g, '$1');
    var phone = t && t.data.phone, email = t && t.data.email;
    openSheet('goalRemind', { id: id }, head('Reminder', personName(d))
      + '<div class="mailprev"><div class="mp-body">' + MZ.waBold(txt) + '</div></div>'
      + '<div class="btnrow" style="margin-top:12px">' + (phone ? '<a class="btn gold" target="_blank" rel="noopener" href="' + esc(MZ.wa(phone, txt)) + '">Send on WhatsApp</a>' : '')
      + (email ? '<a class="btn" href="mailto:' + esc(email) + '?subject=' + encodeURIComponent('Reminder: ' + d.title) + '&body=' + encodeURIComponent(plain) + '">Open in my email app</a>' : '')
      + '<button class="btn" data-act="copyText" data-msg="Reminder copied." data-text="' + esc(txt) + '">Copy text</button></div>'
      + (phone || email ? '' : '<p class="hint" style="margin-top:10px">Choose the person from HR → Teachers (with a phone number) to send it on WhatsApp.</p>'));
  }
  function myWorkHTML() {
    if (S.myHr === undefined && !S.myHrLoading && api.myHrItems) {
      S.myHrLoading = true; api.myHrItems().then(function (l) { S.myHr = l; S.myHrLoading = false; render(); }).catch(function () { S.myHr = []; S.myHrLoading = false; });
    }
    if (S.myMast === undefined && !S.myMastLoading && api.myMastership) { S.myMastLoading = true; api.myMastership().then(function (l) { S.myMast = l; S.myMastLoading = false; render(); }).catch(function () { S.myMast = []; S.myMastLoading = false; }); }
    var mast = S.myMast && S.myMast.length ? '<section class="card mywork tmasterbox">' + MZ.masteryMedal(64) + '<div><p class="eyebrow">Mastership</p><h3>' + S.myMast.length + ' Mastership badge' + (S.myMast.length === 1 ? '' : 's') + '</h3><p class="muted">For excellent ratings, 4 or 5 stars in every category: ' + esc(S.myMast.slice().reverse().map(function (m) { return MZ.monthLabel(m); }).join(', ')) + '.</p></div></section>' : '';
    if (!S.myHr || !S.myHr.length) return mast;
    var duties = S.myHr.filter(function (r) { return r.kind === 'duty' && r.data.status !== 'Ended'; }), goals = S.myHr.filter(function (r) { return r.kind === 'goal' && String(r.data.year) === String(MZ.today().slice(0, 4)); });
    return mast + '<section class="card mywork"><p class="eyebrow">Given to you by the admin</p>'
      + (duties.length ? '<h3>My roles &amp; responsibilities</h3>' + duties.map(function (r) { return '<div class="mw-duty"><b>' + esc(r.data.position) + '</b>' + (r.data.reports_to ? ' <small class="muted">· reports to ' + esc(r.data.reports_to) + '</small>' : '') + '<ul class="duties">' + lines(r.data.responsibilities).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>'; }).join('') : '')
      + (goals.length ? '<h3 style="margin-top:12px">My goals for ' + MZ.today().slice(0, 4) + '</h3>' + goals.map(function (r) { var d = r.data, p = d.status === 'Done' ? 100 : +d.progress || 0; return '<div class="mw-goal"><div><b>' + esc(d.title) + '</b><small class="muted">Target ' + esc(MZ.dateLabel(d.due_date)) + (d.next_follow && goalOpen(d) ? ' · next check ' + esc(MZ.dateShort(d.next_follow)) : '') + '</small></div><div class="gprog"><div class="mbar' + (d.status === 'Done' ? ' goal' : '') + '" style="height:8px"><i style="width:' + p + '%"></i></div><small class="num">' + p + '% · ' + esc(d.status) + '</small></div></div>'; }).join('') : '')
      + '</section>';
  }

  function renderHR(forceSub) {
    if (!S.hr) {
      if (!S.hrLoading) { S.hrLoading = true; api.listHR().then(function (l) { S.hr = l; S.hrLoading = false; render(); }).catch(function (e) { S.hrLoading = false; S.hr = []; MZ.toast(e.message); }); }
      return '<div class="pagehead"><h1>' + (forceSub ? esc(HR[forceSub].title) : 'HR') + '</h1></div><p class="muted" style="margin-top:14px">Loading…</p>';
    }
    if (!S.staff && !S.staffLoading && api.listStaff) { S.staffLoading = true; api.listStaff().then(function (l) { S.staff = l; S.staffLoading = false; if (S.tab === 'hr') render(); }).catch(function () { S.staffLoading = false; S.staff = []; }); }
    var sub = forceSub || S.sub.hr, cfg = HR[sub === 'teachers' ? 'teachers' : sub];
    if (sub === 'attendance') return renderAttendance();
    if (sub === 'feedback') return renderFeedback();
    var all = hrList(cfg.kind), m = S.month, cur = S.settings.currency;
    var list = cfg.filter ? all.filter(cfg.filter) : cfg.monthly && !S.hrAll ? all.filter(function (r) { return r.data.month === m; }) : cfg.inMonth && !S.hrAll ? all.filter(function (r) { return cfg.inMonth(r.data, m); }) : all;
    list = list.slice().sort(cfg.sort || function (a, b) { return (b.data.month || '') < (a.data.month || '') ? -1 : (b.data.month || '') > (a.data.month || '') ? 1 : 0; });
    var needT = cfg.fields.some(function (f) { return f[2] === 'teacher'; }) && !teachers(true).length;
    var h = '<div class="pagehead"><div><p class="eyebrow">' + esc(cfg.eyebrow || 'HR') + '</p><h1>' + esc(cfg.title) + '</h1><p class="stat">' + esc(cfg.desc) + '</p></div><div class="btnrow">' + (cfg.headBtns ? cfg.headBtns() : '');
    if (cfg.monthly || cfg.inMonth) h += '<span class="monthnav"><button class="iconbtn" data-act="prevMonth" aria-label="Previous month">' + I.left + '</button><b style="min-width:120px;text-align:center">' + (S.hrAll ? 'All months' : esc(MZ.monthLabel(m))) + '</b><button class="iconbtn" data-act="nextMonth" aria-label="Next month">' + I.right + '</button></span><button class="chip" type="button" data-act="hrAll" aria-pressed="' + S.hrAll + '">All months</button>';
    if (cfg.kind === 'payroll') h += '<button class="btn sm" data-act="genPayroll">Create payroll for ' + esc(MZ.monthShort(m)) + '</button>';
    h += '<button class="btn gold sm" data-act="hrAdd" data-k="' + sub + '"' + (needT ? ' disabled' : '') + '>' + I.plus + 'Add ' + esc(cfg.one) + '</button></div></div>';
    if (needT) h += '<p class="okmsg" style="margin-top:12px;background:var(--warn-bg);color:var(--warn)">Add your teachers first under HR → Teachers.</p>';
    if (cfg.kind === 'payroll' && list.length) {
      var net = list.reduce(function (a, r) { return a + payNet(r.data); }, 0), paid = list.filter(function (r) { return r.data.status === 'Paid'; });
      h += '<div class="cards4"><div class="stat4"><span>Total payroll</span><b class="num">' + esc(MZ.money(net, cur)) + '</b></div><div class="stat4 good"><span>Paid</span><b class="num">' + esc(MZ.money(paid.reduce(function (a, r) { return a + payNet(r.data); }, 0), cur)) + '</b><small>' + paid.length + ' of ' + list.length + '</small></div>'
        + '<div class="stat4 bad"><span>Still to pay</span><b class="num">' + esc(MZ.money(net - paid.reduce(function (a, r) { return a + payNet(r.data); }, 0), cur)) + '</b></div><div class="stat4"><span>Teachers</span><b class="num">' + list.length + '</b></div></div>';
    }
    if (cfg.kind === 'teacher' && list.length) {
      var act = list.filter(function (r) { return r.data.status !== 'Left'; });
      h += '<div class="cards4"><div class="stat4"><span>Active teachers</span><b class="num">' + act.length + '</b></div><div class="stat4"><span>Monthly salaries</span><b class="num">' + esc(MZ.money(act.reduce(function (a, r) { return a + (+r.data.salary || 0); }, 0), cur)) + '</b></div>'
        + '<div class="stat4"><span>On leave</span><b class="num">' + list.filter(function (r) { return r.data.status === 'On leave'; }).length + '</b></div><div class="stat4"><span>Students per teacher</span><b class="num">' + (act.length ? Math.round(S.students.filter(function (s) { return !s.disabled; }).length / act.length) : '—') + '</b></div></div>';
    }
    if (cfg.head) h += cfg.head(list, all);
    // search: teacher name (and anything else on the row: phone, email, ITS, notes, the student's name)
    S.hrQ = S.hrQ || {}; var hq = (S.hrQ[sub] || '').trim().toLowerCase(), total = list.length;
    if (all.length) h += '<div class="toolbar hrsearch"><label class="search"><span class="sr">Search</span><input id="hrQ" data-sub="' + esc(sub) + '" type="search" placeholder="' + (cfg.kind === 'teacher' ? 'Search teachers by name, phone, email or ITS' : 'Search by teacher name') + '" value="' + esc(S.hrQ[sub] || '') + '" autocomplete="off"></label>' + (hq ? '<span class="muted" style="font-size:13px">' : '');
    if (hq) {
      list = list.filter(function (r) {
        var d = r.data || {}, t = d.teacher_id != null ? hrById(d.teacher_id) : null, st = d.student_id ? studentById(d.student_id) : null;
        var txt = Object.keys(d).map(function (k) { var v = d[k]; return v == null || typeof v === 'object' ? '' : String(v); }).join(' ') + ' ' + (t ? t.data.full_name : '') + ' ' + (st ? st.full_name : '');
        return txt.toLowerCase().indexOf(hq) >= 0;
      });
      h += list.length + ' of ' + total + ' match</span><button class="btn sm ghost" type="button" data-act="hrQClear" data-sub="' + esc(sub) + '">Clear</button>';
    }
    if (all.length) h += '</div>';
    if (hq && !list.length) return h + '<div class="empty"><p>No ' + (cfg.kind === 'teacher' ? 'teacher' : 'record') + ' matches “' + esc(S.hrQ[sub]) + '”.</p></div>';
    if (!list.length && cfg.empty) return h + '<div class="empty"><p>' + esc(cfg.empty) + '</p></div>';
    if (!list.length) return h + '<div class="empty"><p>No ' + esc(cfg.title.toLowerCase()) + (cfg.monthly && !S.hrAll ? ' for ' + esc(MZ.monthLabel(m)) : '') + ' yet.</p></div>';
    h += '<div class="tablewrap" style="margin-top:14px"><table class="grid"><thead><tr>' + cfg.cols.map(function (c) { return '<th' + (c[2] ? ' class="r"' : '') + '>' + esc(c[0]) + '</th>'; }).join('') + '<th></th></tr></thead><tbody>'
      + list.map(function (r) {
        return '<tr>' + cfg.cols.map(function (c) { return '<td' + (c[2] ? ' class="r"' : '') + '>' + (typeof c[1] === 'function' ? c[1](r.data, r) : esc(r.data[c[1]] || '')) + '</td>'; }).join('')
          + '<td class="r" style="white-space:nowrap">' + (cfg.rowActs ? cfg.rowActs(r) + ' ' : '') + '<button class="btn sm" data-act="hrEdit" data-k="' + sub + '" data-id="' + r.id + '">Edit</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    return h;
  }
  function fieldHTML(f, d) {
    var k = f[0], label = f[1], type = f[2], req = f[3] ? ' required' : '', v = d[k] == null ? '' : d[k], id = 'hr_' + k;
    var inp;
    if (type === 'textarea') inp = '<textarea id="' + id + '" class="input" rows="3" maxlength="1000"' + req + '>' + esc(v) + '</textarea>';
    else if (type === 'select') inp = '<select id="' + id + '"' + req + '>' + (f[3] ? '' : '<option value=""></option>') + f[4].map(function (o) { return '<option' + (String(v) === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    else if (type === 'list') inp = '<input id="' + id + '" list="' + id + '_l" maxlength="80" value="' + esc(v) + '"' + req + '><datalist id="' + id + '_l">' + (typeof f[4] === 'function' ? f[4]() : f[4]).map(function (o) { return '<option value="' + esc(o) + '">'; }).join('') + '</datalist>';
    else if (type === 'teacher') inp = '<select id="' + id + '"' + req + '><option value="">Choose a teacher</option>' + teachers(false).map(function (t) { return '<option value="' + t.id + '"' + (String(v) === String(t.id) ? ' selected' : '') + '>' + esc(t.data.full_name) + (t.data.status === 'Left' ? ' (left)' : '') + '</option>'; }).join('') + '</select>';
    else if (type === 'login') { if (!S.staff && api.listStaff) api.listStaff().then(function (l) { S.staff = l; }).catch(function () {}); inp = '<select id="' + id + '"><option value="">Not linked</option>' + (S.staff || []).filter(function (a) { return a.role === 'teacher' || a.user_id === v; }).map(function (a) { return '<option value="' + esc(a.user_id) + '"' + (a.user_id === v ? ' selected' : '') + '>' + esc(a.username) + '</option>'; }).join('') + '</select>'; }
    else if (type === 'student') inp = '<select id="' + id + '"' + req + '><option value="">Choose a student</option>' + S.students.slice().sort(function (a, b) { return a.full_name.localeCompare(b.full_name); }).filter(function (s) { return !s.disabled || s.id === v; }).map(function (s) { return '<option value="' + esc(s.id) + '"' + (v === s.id ? ' selected' : '') + '>' + esc(s.full_name) + (s.admission_no ? ' (' + esc(s.admission_no) + ')' : '') + '</option>'; }).join('') + '</select>';
    else if (type === 'rating') {
      inp = '<div class="rate" role="radiogroup" aria-label="' + esc(label) + '">';
      for (var i = 5; i >= 1; i--) inp += '<input type="radio" name="' + id + '" id="' + id + i + '" value="' + i + '"' + (+v === i ? ' checked' : '') + (req && i === 5 ? ' required' : '') + '><label for="' + id + i + '" title="' + i + ' out of 5">★</label>';
      inp += '</div>';
    } else {
      var t = { money: 'number', percent: 'number', month: 'month', date: 'date', tel: 'tel', email: 'email' }[type] || 'text';
      inp = '<input id="' + id + '" type="' + t + '"' + (type === 'money' ? ' min="0" step="any"' : type === 'percent' ? ' min="0" max="100" step="1"' : '') + ' value="' + esc(v) + '"' + req + (t === 'text' ? ' maxlength="120"' : '') + '>';
    }
    return '<div class="field"><' + (type === 'rating' ? 'span class="lbl"' : 'label for="' + id + '"') + '>' + esc(label) + (type === 'money' ? ' (' + esc(S.settings.currency) + ')' : '') + '</' + (type === 'rating' ? 'span' : 'label') + '>' + (type === 'rating' && MZ.TEACHER_CRITERIA_DESC[k] ? '<small class="critdesc">' + esc(MZ.TEACHER_CRITERIA_DESC[k]) + '</small>' : '') + inp + '</div>';
  }
  function openHR(sub, rec) {
    var cfg = HR[sub], d = rec ? rec.data : {};
    if (!rec) {
      if (cfg.monthly) d.month = S.month;
      if (cfg.kind === 'teacher') d.status = 'Active';
      if (cfg.kind === 'payroll') d.status = 'Unpaid';
      if (cfg.kind === 'leave') { d.from_date = MZ.today(); d.to_date = MZ.today(); d.status = 'Approved'; }
      if (cfg.defaults) cfg.defaults(d);
    }
    var fields = cfg.fields, html = '', i = 0;
    while (i < fields.length) {
      var f = fields[i], small = ['textarea', 'rating'].indexOf(f[2]) < 0 && f[0] !== 'full_name';
      var g = fields[i + 1], small2 = g && ['textarea', 'rating'].indexOf(g[2]) < 0;
      if (small && small2) { html += '<div class="two">' + fieldHTML(f, d) + fieldHTML(g, d) + '</div>'; i += 2; }
      else { html += fieldHTML(f, d); i++; }
    }
    openSheet('hr', { sub: sub, id: rec ? rec.id : null }, head(cfg.title, rec ? 'Edit ' + cfg.one : 'Add ' + cfg.one)
      + '<form class="form" id="hrForm" autocomplete="off">' + html + '<p class="err" id="hrErr" hidden></p><button class="btn gold block" type="submit" id="hrBtn">Save</button></form>'
      + (rec && cfg.kind === 'teacher' && !d.user_id && S.role === 'admin' && api.createTeacherLogin ? '<div class="panel tlpanel"><p><b>No login yet.</b> Make one so ' + esc(MZ.firstName(d.full_name || 'they')) + ' can sign in.</p><button class="btn gold" data-act="tlMake" data-id="' + rec.id + '">' + I.key + 'Create login</button></div>' : '')
      + (rec ? '<div><button class="btn danger" data-act="hrDel" data-id="' + rec.id + '">Delete this ' + esc(cfg.one) + '</button></div>' : ''));
  }
  function saveHR() {
    var d0 = sheet.data, cfg = HR[d0.sub], rec = d0.id ? hrById(d0.id) : null, data = rec ? JSON.parse(JSON.stringify(rec.data)) : {}, err = $('#hrErr');
    for (var i = 0; i < cfg.fields.length; i++) {
      var f = cfg.fields[i], k = f[0], v;
      if (f[2] === 'rating') { var c = document.querySelector('input[name="hr_' + k + '"]:checked'); v = c ? +c.value : 0; if (f[3] && !v) { err.textContent = 'Please give a rating for ' + f[1] + '.'; err.hidden = false; return; } }
      else { v = $('#hr_' + k).value; if (typeof v === 'string') v = v.trim(); if (f[2] === 'money') v = v === '' ? 0 : +v; if (f[2] === 'percent') v = v === '' ? 0 : Math.max(0, Math.min(100, Math.round(+v) || 0)); if (f[2] === 'teacher') v = v === '' ? null : +v || v; }
      if (f[3] && (v === '' || v == null)) { err.textContent = f[1] + ' is required.'; err.hidden = false; return; }
      data[k] = v;
    }
    if (cfg.validate) { var ve = cfg.validate(data); if (ve) { err.textContent = ve; err.hidden = false; return; } }
    if (cfg.kind === 'leave' && data.to_date && data.to_date < data.from_date) { err.textContent = 'The end date is before the start date.'; err.hidden = false; return; }
    if (cfg.kind === 'payroll' && data.status === 'Paid' && !data.paid_on) data.paid_on = MZ.today();
    if (cfg.monthly && !rec) {
      var keyF = cfg.fields[0][0], dup = hrList(cfg.kind).find(function (r) { return String(r.data[keyF]) === String(data[keyF]) && r.data.month === data.month; });
      if (dup) { err.textContent = 'There is already a ' + cfg.one + ' for this person in ' + MZ.monthLabel(data.month) + '. Edit that one instead.'; err.hidden = false; return; }
    }
    $('#hrBtn').disabled = true;
    api.saveHR({ id: d0.id, kind: cfg.kind, data: data }).then(function (row) {
      S.hr = (S.hr || []).filter(function (x) { return x.id !== row.id; }).concat([row]);
      closeSheet(); render(); MZ.toast('Saved.');
      // a new teacher gets a login automatically (unless one was picked, or the admin turned this off)
      if (!d0.id && cfg.kind === 'teacher' && !data.user_id && S.role === 'admin' && api.createTeacherLogin)
        makeTeacherLogin(row.id, true).catch(function (e2) { MZ.toast('Saved, but the login was not created: ' + e2.message); });
    }).catch(function (e) { err.textContent = e.message; err.hidden = false; $('#hrBtn').disabled = false; });
  }
  function genPayroll() {
    var m = S.month, have = {}, jobs = [];
    hrList('payroll').forEach(function (r) { if (r.data.month === m) have[r.data.teacher_id] = 1; });
    teachers(true).forEach(function (t) { if (!have[t.id]) jobs.push({ kind: 'payroll', data: { teacher_id: t.id, month: m, basic: +t.data.salary || 0, allowances: 0, deductions: 0, status: 'Unpaid', paid_on: '', method: 'Bank transfer', note: '' } }); });
    if (!jobs.length) { MZ.toast('Payroll for ' + MZ.monthLabel(m) + ' already has every active teacher.'); return; }
    var done = 0;
    (function next() {
      if (!jobs.length) { render(); MZ.toast(done + ' salary record' + (done === 1 ? '' : 's') + ' created for ' + MZ.monthLabel(m) + '. Edit allowances or deductions if needed.'); return; }
      api.saveHR(jobs.shift()).then(function (row) { S.hr.push(row); done++; next(); }).catch(function (e) { MZ.toast(e.message); render(); });
    })();
  }


  /* ================================================================ SCHEDULE */
  /* Students allocated to teachers in time slots, for tomorrow or a whole week.
     Planners: the admin and teachers marked "Can make schedules" in HR. Everyone else sees their own. */
  var SCH_NOTES = ['Jadeed', 'Murajaat', 'Sabaq', 'Tajweed', 'Ikhtibar', 'Dawrat'];
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  S.sch = { mode: 'week', date: null, teacher: '', list: null, key: '', newIds: {} };
  function isoAdd(d, n) { var x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
  function tomorrow() { return isoAdd(MZ.today(), 1); }
  function weekStart(d) { var x = new Date(d + 'T12:00:00'), k = (x.getDay() + 6) % 7; return isoAdd(d, -k); }
  function schRange() {
    var d = S.sch.date || (S.sch.date = tomorrow());
    if (S.sch.mode === 'day') return { from: d, to: d, days: [d] };
    if (S.sch.mode === 'list') {
      var f = S.sch.rFrom || weekStart(d), t = S.sch.rTo || isoAdd(f, 6); if (t < f) { var sw = f; f = t; t = sw; }
      var ld = []; for (var y = f; y <= t && ld.length < 400; y = isoAdd(y, 1)) ld.push(y);
      return { from: f, to: t, days: ld };
    }
    if (S.sch.mode === 'month') {
      var m0 = d.slice(0, 7) + '-01', m1 = d.slice(0, 7) + '-' + MZ.pad(new Date(+d.slice(0, 4), +d.slice(5, 7), 0).getDate());
      var g0 = weekStart(m0), g1 = isoAdd(weekStart(m1), 6), md = []; for (var x = g0; x <= g1; x = isoAdd(x, 1)) md.push(x);
      return { from: g0, to: g1, days: md, m0: m0, m1: m1 };
    }
    var a = weekStart(d), days = []; for (var i = 0; i < 7; i++) days.push(isoAdd(a, i));
    return { from: a, to: days[6], days: days };
  }
  function dayName(d) { return d === MZ.today() ? 'Today' : d === tomorrow() ? 'Tomorrow' : new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' }); }
  function dayShort(d) { return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  function tAdd(t, min) { var p = t.split(':'), m = (+p[0]) * 60 + (+p[1]) + min; m = Math.max(0, Math.min(23 * 60 + 59, m)); return MZ.pad(Math.floor(m / 60)) + ':' + MZ.pad(m % 60); }
  function tMin(t) { var p = String(t || '0:0').split(':'); return (+p[0]) * 60 + (+p[1]); }
  function canPlan() { return !!S.canSch && !isViewer(); }
  function canMove() { return (!!S.canSch || !!S.canMove) && !isViewer(); }
  function loadSchedule(force) {
    var r = schRange(), key = r.from + '|' + r.to;
    if (!force && (S.sch.key === key || S.sch.loading === key)) return;
    S.sch.loading = key;
    var jobs = [api.listSchedules({ from: r.from, to: r.to })];
    if (!S.schTeachers) jobs.push(api.scheduleTeachers().then(function (l) { S.schTeachers = l; }).catch(function () { S.schTeachers = []; }));
    if (S.canSch === undefined) jobs.push(api.canSchedule().then(function (v) { S.canSch = !!v; }).catch(function () { S.canSch = false; }));
    if (S.canMove === undefined) jobs.push((api.canMoveSchedule ? api.canMoveSchedule() : Promise.resolve(false)).then(function (v) { S.canMove = !!v; }).catch(function () { S.canMove = false; }));
    Promise.all(jobs).then(function (res) {
      if (S.sch.loading !== key) return;
      S.sch.list = res[0]; S.sch.key = key; S.sch.loading = null;
      // what is new for me (a teacher): keep the "New" marks while this page is open, then tell the server I have seen them
      var me = api.myUid ? api.myUid() : null, fresh = res[0].filter(function (x) { return me && x.teacher_user === me && !x.teacher_seen_at; });
      fresh.forEach(function (x) { S.sch.newIds[x.id] = 1; });
      if (fresh.length && api.markScheduleSeen) api.markScheduleSeen().then(function () { S.schUnseen = 0; updateSchBadge(); }).catch(function () {});
      if (S.tab === 'schedule') render();
    }).catch(function (e) { S.sch.loading = null; S.sch.list = []; MZ.toast(e.message); if (S.tab === 'schedule') render(); });
  }
  function schName(x) { var s = studentById(x.student_id); return s ? s.full_name : x.student_name || 'Removed student'; }
  // planners who are teachers only see their own students' records, but need every name to allocate
  function schStudents() {
    if (role() === 'teacher' && canPlan()) {
      if (!S.schStu && api.scheduleStudents) { S.schStu = []; api.scheduleStudents().then(function (l) { S.schStu = l || []; if (sheet && sheet.kind === 'schAdd') alDraw(['alStu']); }).catch(function () {}); }
      return (S.schStu || []).map(function (s) { return { id: s.id, full_name: s.full_name, program: s.program || '' }; });
    }
    return S.students.filter(function (s) { return !s.disabled; }).sort(function (a, b) { return a.full_name.localeCompare(b.full_name); });
  }
  function schTeacherList() { return (S.schTeachers || []).filter(function (t) { return t.status !== 'Left'; }); }
  function renderSchedule() {
    loadSchedule();
    var r = schRange(), plan = canPlan(), me = api.myUid ? api.myUid() : null, mode = S.sch.mode;
    // a teacher opens on their own timetable
    // (teachers who may move students keep every teacher in view, so they have somewhere to drop)
    if (!S.sch.tfInit && S.schTeachers && S.canSch !== undefined && S.canMove !== undefined) { S.sch.tfInit = 1; if (role() === 'teacher' && !canMove() && me && S.schTeachers.some(function (t) { return t.user_id === me; }) && !S.sch.teacher) S.sch.teacher = 'me'; }
    var h = '<div class="pagehead"><div><p class="eyebrow">Schedule</p><h1>' + (mode === 'day' ? esc(dayName(r.from)) + ', ' + esc(MZ.dateLabel(r.from)) : mode === 'month' ? esc(MZ.monthLabel(r.m0.slice(0, 7))) : mode === 'list' ? esc(dayShort(r.from)) + ' – ' + esc(MZ.dateLabel(r.to)) : 'Week of ' + esc(MZ.dateLabel(r.from))) + '</h1>'
      + '<p class="stat">' + (plan ? 'Allocate students for any date, edit or reschedule any lesson, and choose who is emailed. Students and teachers see changes in their portals straight away.' : canMove() ? 'You can move students between teachers by drag and drop. Students and teachers are told straight away.' : 'The students allocated to you, with the day and time.') + '</p></div>'
      + (plan ? '<div class="btnrow schtools"><button class="btn gold" data-act="schAdd">' + I.plus + 'Allocate students</button><button class="btn" data-act="schBulkEdit">' + I.pen + 'Bulk Edit Schedules</button><button class="btn" data-act="schBulkDel">Delete All Schedules</button><button class="btn" data-act="schTT">' + I.mail + 'Timetable emails</button><button class="btn" data-act="schCopyOpen">Copy schedule…</button><button class="btn ghost" data-act="schPrint">Print timetable</button></div>'
        : (S.sch.list || []).some(function (x) { return me && x.teacher_user === me; }) ? '<div class="btnrow"><button class="btn" data-act="schPrint">Print my timetable</button></div>' : '') + '</div>'
      + (S.ttHint ? '<section class="card tthint">' + I.mail + '<span><b>Your timetable</b><small class="muted">Choose the week below, then press ' + (plan ? 'Print timetable' : 'Print my timetable') + '. In the print window you can also save it as a PDF.</small></span><button class="btn gold sm" data-act="schPrint">Print now</button><button class="iconbtn sm" data-act="ttHintX" aria-label="Close">' + I.x + '</button></section>' : '')
      + '<div class="schbar"><div class="seg" role="group" aria-label="View"><button class="chip" data-act="schMode" data-m="day" aria-pressed="' + (mode === 'day') + '">Day</button><button class="chip" data-act="schMode" data-m="week" aria-pressed="' + (mode === 'week') + '">Week</button><button class="chip" data-act="schMode" data-m="month" aria-pressed="' + (mode === 'month') + '">Month</button><button class="chip" data-act="schMode" data-m="list" aria-pressed="' + (mode === 'list') + '">List</button></div>'
      + '<span class="monthnav"><button class="iconbtn" data-act="schMove" data-d="-1" aria-label="Previous">' + I.left + '</button><label class="schjump"><span class="sr">Go to date</span><input type="date" id="schJump" value="' + esc(mode === 'list' ? r.from : S.sch.date) + '" aria-label="Go to date"></label><button class="iconbtn" data-act="schMove" data-d="1" aria-label="Next">' + I.right + '</button></span>'
      + '<div class="schquick" role="group" aria-label="Quick dates">' + [['today', 'Today'], ['week', 'This week'], ['next', 'Next week'], ['month', 'This month'], ['range', 'Custom range']].map(function (q) { return '<button class="chip sm" data-act="schQuick" data-q="' + q[0] + '">' + q[1] + '</button>'; }).join('') + '</div>'
      + (mode === 'list' ? '<span class="schrange"><input type="date" id="schFrom" value="' + esc(r.from) + '" aria-label="From"><span>to</span><input type="date" id="schTo" value="' + esc(r.to) + '" aria-label="To"></span>' : '') + '</div>';
    if (S.role === 'teacher') h += alertsCardHTML(true);
    if (!S.sch.list || S.sch.key !== r.from + '|' + r.to) return h + '<p class="muted" style="margin-top:14px">Loading the schedule…</p>';
    var tf = S.sch.teacher, all = S.sch.list.filter(function (x) { return (!tf || (tf === 'me' ? x.teacher_user === me : String(x.teacher_id) === tf)) && (mode !== 'month' || (x.slot_date >= r.m0 && x.slot_date <= r.m1)); });
    var live = all.filter(function (x) { return x.status === 'scheduled'; }), stu = {}, tch = {}; live.forEach(function (x) { stu[x.student_id] = 1; tch[x.teacher_id] = 1; });
    var unseenStu = live.filter(function (x) { return !x.student_seen_at; }).length;
    h += '<div class="cards4"><div class="stat4"><span>Slots</span><b class="num">' + live.length + '</b><small>' + (mode === 'day' ? 'this day' : mode === 'month' ? 'this month' : mode === 'list' ? 'in these dates' : 'this week') + '</small></div>'
      + '<div class="stat4"><span>Students</span><b class="num">' + Object.keys(stu).length + '</b><small>of ' + schStudents().length + ' active</small></div>'
      + '<div class="stat4"><span>Teachers</span><b class="num">' + Object.keys(tch).length + '</b><small>teaching</small></div>'
      + '<div class="stat4 ' + (unseenStu ? 'gold' : 'good') + '"><span>Not opened yet</span><b class="num">' + unseenStu + '</b><small>by the student</small></div></div>';
    var tsel = '<label class="pgmsel"><span class="sr">Teacher</span><select id="schTeacher" aria-label="Teacher"><option value="">All teachers</option>' + (me && (S.schTeachers || []).some(function (t) { return t.user_id === me; }) ? '<option value="me"' + (tf === 'me' ? ' selected' : '') + '>Only my students</option>' : '')
      + schTeacherList().map(function (t) { return '<option value="' + t.id + '"' + (tf === String(t.id) ? ' selected' : '') + '>' + esc(t.full_name) + '</option>'; }).join('') + '</select></label>';
    h += '<div class="toolbar">' + (plan || canMove() || isViewer() ? tsel : '') + '<span class="spacer"></span>'
      + (S.sch.mode === 'week' && live.some(function (x) { return canMoveSlot(x); }) ? '<button class="btn sm" data-act="schMode" data-m="day">' + I.swap + 'Move students between teachers</button>' : '') + '</div>';
    if (mode === 'month') return h + schMonthHTML(all, r, plan, me);
    if (mode === 'list') return h + schListHTML(all, r, plan, me);
    if (!all.length) return h + '<div class="empty"><h3>Nothing scheduled ' + (S.sch.mode === 'day' ? 'for ' + esc(dayName(r.from).toLowerCase()) : 'this week') + '</h3><p>' + (plan ? 'Choose a student, a teacher and a time. You can fill a whole week in one go.' : 'When the admin allocates students to you, they appear here and you get a notice.') + '</p>' + (plan ? '<button class="btn gold" data-act="schAdd">' + I.plus + 'Allocate students</button>' : '') + '</div>';
    var slot = function (x) {
      var nm = schName(x), off = x.status === 'cancelled', isNew = S.sch.newIds[x.id];
      var mv = !off && canMoveSlot(x);
      return '<button class="slot' + (S.sch.justMoved && S.sch.justMoved.indexOf(x.id) >= 0 ? ' landed' : '') + (off ? ' off' : '') + (isNew ? ' new' : '') + (me && x.teacher_user === me ? ' mine' : '') + (mv ? ' movable' : '') + '" data-act="schOpen" data-id="' + x.id + '" data-tid="' + x.teacher_id + '" data-from="' + esc(x.start_time) + '" data-to="' + esc(x.end_time) + '"' + (mv ? ' title="Drag onto another teacher to hand over"' : '') + '>'
        + (mv ? '<span class="sl-grip" aria-hidden="true"></span>' : '')
        + '<span class="sl-time num">' + esc(x.start_time) + '<i>–</i>' + esc(x.end_time) + '</span>'
        + '<b class="sl-stu">' + esc(nm) + '</b><span class="sl-tch">' + esc(x.teacher_name) + '</span>'
        + '<span class="sl-foot">' + (x.handed_from && !off ? '<span class="pill gold" title="Handed over">' + I.swap + 'from ' + esc(x.handed_from) + '</span>' : '') + (x.note ? '<span class="pill">' + esc(x.note) + '</span>' : '') + (off ? '<span class="pill plain">Cancelled</span>' : isNew ? '<span class="pill warn">New for you</span>' : x.student_seen_at ? '<span class="sl-seen" title="The student has opened it">' + I.check + 'Seen</span>' : '<span class="sl-sent">Sent</span>') + '</span></button>';
    };
    if (S.sch.mode === 'day') {
      // one lane per teacher (every teacher, so you can drop a student on someone with no slots yet)
      // people who can move students see every teacher (even free ones) as a place to drop; others see only teachers with students
      if (canMove()) loadBusy(r.from);
      var lanes = {}; if (canMove()) schTeacherList().forEach(function (t) { if (!tf || (tf === 'me' ? t.user_id === me : String(t.id) === tf)) lanes[t.id] = { name: t.full_name, l: [], uid: t.user_id }; });
      all.forEach(function (x) { (lanes[x.teacher_id] = lanes[x.teacher_id] || { name: x.teacher_name, l: [], uid: x.teacher_user }).l.push(x); });
      var anyMove = all.some(function (x) { return x.status === 'scheduled' && canMoveSlot(x); });
      if (!anyMove && !isViewer() && all.some(function (x) { return x.status === 'scheduled'; })) h += '<p class="dndhint muted">' + I.eye + '<span><b>View only.</b> Only the admin and teachers given schedule permission can move students. If you can’t come, tell the admin.</span></p>';
      if (anyMove) h += '<p class="dndhint">' + I.swap + '<span><b>Hand students over by dragging.</b> Drag a student onto another teacher. Teachers who are busy at that time turn red, free ones glow gold. On a phone, press and hold a student first.</span></p>';
      h += '<div class="lanes" id="schLanes">' + Object.keys(lanes).sort(function (a, b) { return (lanes[b].l.length ? 1 : 0) - (lanes[a].l.length ? 1 : 0) || lanes[a].name.localeCompare(lanes[b].name); }).map(function (k) {
        var L = lanes[k], live = L.l.filter(function (x) { return x.status === 'scheduled'; }), busy = live.reduce(function (a, x) { return a + tMin(x.end_time) - tMin(x.start_time); }, 0);
        var mineLane = me && L.uid === me, canHand = canMove() && live.length;
        // busy times we cannot see the students for (teachers only see their own students)
        var hidden = !L.l.length ? ((S.sch.busy || {})[r.from] || []).filter(function (b) { return String(b.teacher_id) === String(k); }).sort(function (a, b) { return a.start_time < b.start_time ? -1 : 1; }) : [];
        var sub = live.length ? live.length + ' student' + (live.length === 1 ? '' : 's') + ' · ' + Math.round(busy / 6) / 10 + ' h' : hidden.length ? 'Busy ' + hidden.length + ' slot' + (hidden.length === 1 ? '' : 's') : 'Free all day';
        return '<section class="lane' + (mineLane ? ' mylane' : '') + '" data-lane="' + esc(k) + '"><header><b>' + esc(L.name) + (mineLane ? ' <span class="pill">You</span>' : '') + '</b><small>' + sub + '</small>'
          + (canHand ? '<button class="btn sm' + (mineLane ? ' gold' : '') + '" data-act="schHand" data-tid="' + esc(k) + '">' + I.swap + (mineLane ? 'I can’t come: hand over' : 'Hand over all') + '</button>' : '') + '</header>'
          + '<div class="lane-slots">' + (L.l.length ? L.l.map(function (x) { return plan ? '<div class="slotwrap">' + slot(x) + schEditBtn(x) + '</div>' : slot(x); }).join('')
            : hidden.length ? '<p class="lane-free busyl">' + hidden.map(function (b) { return '<span class="num">' + esc(b.start_time) + '–' + esc(b.end_time) + '</span>'; }).join('') + '<em>Busy at these times. Drop a student here for any other time.</em></p>'
            : '<p class="lane-free">Free all day. Drop a student here.</p>') + '</div><span class="lane-drop" aria-hidden="true"></span></section>';
      }).join('') + '</div>';
    } else {
      h += schWeekHTML(all, r, plan, me, tf);
    }
    return h;
  }
  function schEditBtn(x) { return '<button class="sl-edit" type="button" data-act="schEdit" data-id="' + x.id + '" aria-label="Edit the allocation of ' + esc(schName(x)) + '">' + I.pen + '<span>Edit</span></button>'; }
  function schLive(x) { return x.status === 'scheduled'; }
  // slots that overlap another slot of the same teacher or the same student on the same day
  function schClashes(list) {
    var bad = {}, live = list.filter(schLive);
    live.forEach(function (a) { live.forEach(function (b) { if (a.id < b.id && a.slot_date === b.slot_date && a.start_time < b.end_time && b.start_time < a.end_time && (String(a.teacher_id) === String(b.teacher_id) || a.student_id === b.student_id)) { bad[a.id] = bad[b.id] = 1; } }); });
    return bad;
  }
  function plural(n, w) { return n + ' ' + (n === 1 ? w : /s$/.test(w) ? w + 'es' : w + 's'); }
  /* ---- Week: one timetable, Monday to Sunday, rows are the time slots ---- */
  function schWeekHTML(all, r, plan, me, tf) {
    var live = all.filter(schLive), clash = schClashes(all), showT = !tf;
    var h = '';
    // everyone's load at a glance (pick a teacher to see their timetable)
    if (showT && (plan || canMove() || isViewer())) {
      var by = {}; schTeacherList().forEach(function (t) { by[t.id] = { name: t.full_name, d: {}, n: 0, s: {} }; });
      live.forEach(function (x) { var b = by[x.teacher_id] = by[x.teacher_id] || { name: x.teacher_name, d: {}, n: 0, s: {} }; b.d[x.slot_date] = (b.d[x.slot_date] || 0) + 1; b.n++; b.s[x.student_id] = 1; });
      var ks = Object.keys(by).sort(function (a, b) { return by[b].n - by[a].n || by[a].name.localeCompare(by[b].name); });
      if (ks.length) h += '<section class="ttload"><h3>Teachers this week</h3><p class="muted">Classes per day. Choose a teacher to open their own timetable.</p><div class="tablewrap"><table class="grid tlgrid"><thead><tr><th>Teacher</th>' + r.days.map(function (d, i) { return '<th class="c' + (d === MZ.today() ? ' today' : '') + '">' + DOW[i] + '</th>'; }).join('') + '<th class="c">Week</th><th class="c">Students</th></tr></thead><tbody>'
        + ks.map(function (k) { var b = by[k]; return '<tr><td><button class="linkbtn" type="button" data-act="schPickT" data-tid="' + esc(k) + '">' + esc(b.name) + '</button></td>' + r.days.map(function (d) { var n = b.d[d] || 0; return '<td class="c num' + (n ? ' has h' + Math.min(4, n) : '') + '">' + (n || '·') + '</td>'; }).join('') + '<td class="c num"><b>' + b.n + '</b></td><td class="c num">' + Object.keys(b.s).length + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    }
    var tname = tf === 'me' ? 'My timetable' : tf ? teacherNameById(tf) + '’s timetable' : 'All teachers';
    var perDay = r.days.map(function (d) { var l = live.filter(function (x) { return x.slot_date === d; }), st = {}; l.forEach(function (x) { st[x.student_id] = 1; }); return { n: l.length, s: Object.keys(st).length }; });
    var weekStu = {}; live.forEach(function (x) { weekStu[x.student_id] = 1; });
    var rows = {}; all.forEach(function (x) { var k = x.start_time + '|' + x.end_time; rows[k] = rows[k] || { from: x.start_time, to: x.end_time }; });
    var keys = Object.keys(rows).sort(function (a, b) { return rows[a].from < rows[b].from ? -1 : rows[a].from > rows[b].from ? 1 : rows[a].to < rows[b].to ? -1 : 1; });
    var chip = function (x) {
      var off = !schLive(x), mine = me && x.teacher_user === me;
      return '<div class="ttslot' + (off ? ' off' : '') + (mine ? ' mine' : '') + (clash[x.id] ? ' clash' : '') + (S.sch.newIds[x.id] ? ' new' : '') + '"><button type="button" class="tt-open" data-act="schOpen" data-id="' + x.id + '"><b>' + esc(schName(x)) + '</b>'
        + (showT ? '<small>' + esc(x.teacher_name) + '</small>' : '') + (x.note ? '<small class="tt-note">' + esc(x.note) + '</small>' : '') + (off ? '<small class="tt-off">Cancelled</small>' : CHANGE_TAG[x.change_kind] ? '<small class="tt-chg">' + CHANGE_TAG[x.change_kind] + '</small>' : '') + (x.series_id ? '<small class="tt-ser" title="Repeats every week">↻</small>' : '') + (clash[x.id] ? '<small class="tt-clash">' + I.warn + 'Clash</small>' : '') + '</button>'
        + (plan ? '<button type="button" class="tt-edit" data-act="schEdit" data-id="' + x.id + '" aria-label="Edit the allocation of ' + esc(schName(x)) + '">' + I.pen + '</button>' : '') + '</div>';
    };
    h += '<section class="tt"><div class="tthead"><div><h3>' + esc(tname) + '</h3><p class="muted"><b class="num">' + plural(live.length, 'class')  + '</b> this week · <b class="num">' + plural(Object.keys(weekStu).length, 'student') + '</b>' + (Object.keys(clash).length ? ' · <span class="bad">' + I.warn + plural(Object.keys(clash).length, 'clashing slot') + '</span>' : '') + '</p></div>'
      + '<div class="btnrow"><button class="btn sm ghost" type="button" data-act="ttPrint">' + I.print + 'Print</button></div></div>';
    if (!keys.length) h += '<div class="empty"><h3>Nothing scheduled this week</h3><p>' + (plan ? 'Choose a student, a teacher and a time. You can fill a whole week in one go.' : 'When the admin allocates students to you, they appear here and you get a notice.') + '</p>' + (plan ? '<button class="btn gold" data-act="schAdd">' + I.plus + 'Allocate students</button>' : '') + '</div>';
    else {
      // desktop: a grid of time slots × days
      h += '<div class="tablewrap ttwrap"><table class="ttgrid"><thead><tr><th class="tt-time">Time</th>' + r.days.map(function (d, i) {
        return '<th class="' + (d === MZ.today() ? 'today' : '') + '"><span class="tt-d"><b>' + DOW[i] + '</b><small>' + esc(dayShort(d)) + '</small></span><span class="tt-n">' + (perDay[i].n ? plural(perDay[i].n, 'class') : 'Free') + '</span>'
          + (plan ? '<button class="iconbtn sm" type="button" data-act="schAdd" data-d="' + d + '" aria-label="Allocate on ' + esc(dayShort(d)) + '">' + I.plus + '</button>' : '') + '</th>';
      }).join('') + '<th class="tt-sum">Week</th></tr></thead><tbody>'
        + keys.map(function (k) {
          var rw = rows[k], n = 0;
          return '<tr><th class="tt-time num">' + esc(rw.from) + '<i>–</i>' + esc(rw.to) + '</th>' + r.days.map(function (d) {
            var l = all.filter(function (x) { return x.slot_date === d && x.start_time === rw.from && x.end_time === rw.to; }); n += l.filter(schLive).length;
            return '<td class="' + (d === MZ.today() ? 'today' : '') + (l.length ? '' : ' tt-empty') + '">' + l.map(chip).join('') + '</td>';
          }).join('') + '<td class="tt-sum num">' + n + '</td></tr>';
        }).join('')
        + '</tbody><tfoot><tr><th class="tt-time">Students</th>' + perDay.map(function (p) { return '<td class="num">' + p.s + '</td>'; }).join('') + '<td class="tt-sum num"><b>' + Object.keys(weekStu).length + '</b></td></tr></tfoot></table></div>';
      // phone: one day under the other
      h += '<div class="ttlist">' + r.days.map(function (d, i) {
        var l = all.filter(function (x) { return x.slot_date === d; });
        return '<section class="ttday' + (d === MZ.today() ? ' today' : '') + '"><header><b>' + esc(dayName(d)) + '</b><small>' + esc(dayShort(d)) + '</small><span class="tt-n">' + (perDay[i].n ? plural(perDay[i].n, 'class') + ' · ' + plural(perDay[i].s, 'student') : 'Free') + '</span>'
          + (plan ? '<button class="iconbtn sm" type="button" data-act="schAdd" data-d="' + d + '" aria-label="Allocate on ' + esc(dayShort(d)) + '">' + I.plus + '</button>' : '') + '</header>'
          + l.map(function (x) { return '<div class="ttrow"><span class="num tt-t">' + esc(x.start_time) + '–' + esc(x.end_time) + '</span>' + chip(x) + '</div>'; }).join('') + '</section>';
      }).join('') + '</div>';
    }
    h += '</section>';
    if (live.some(function (x) { return canMoveSlot(x); })) h += '<p class="dndhint">' + I.swap + '<span>To hand students over by drag and drop, open the <button class="linkbtn" type="button" data-act="schMode" data-m="day">Day</button> view.</span></p>';
    return h;
  }
  /* ---- Month: a calendar of the same saved slots ---- */
  function schMonthHTML(all, r, plan, me) {
    var tf = S.sch.teacher, live = all.filter(schLive), clash = schClashes(all), by = {};
    live.forEach(function (x) { (by[x.slot_date] = by[x.slot_date] || []).push(x); });
    var cancelled = {}; all.filter(function (x) { return !schLive(x); }).forEach(function (x) { cancelled[x.slot_date] = (cancelled[x.slot_date] || 0) + 1; });
    var max = 0; Object.keys(by).forEach(function (d) { max = Math.max(max, by[d].length); });
    var inMonth = r.days.filter(function (d) { return d >= r.m0 && d <= r.m1; });
    var free = inMonth.filter(function (d) { return !by[d]; }).length, busiest = Object.keys(by).sort(function (a, b) { return by[b].length - by[a].length || (a < b ? -1 : 1); })[0];
    var stu = {}; live.forEach(function (x) { stu[x.student_id] = 1; });
    var pick = S.sch.pick && S.sch.pick >= r.m0 && S.sch.pick <= r.m1 ? S.sch.pick : (MZ.today() >= r.m0 && MZ.today() <= r.m1 ? MZ.today() : r.m0);
    var h = '<section class="mcal"><div class="tthead"><div><h3>' + esc(tf === 'me' ? 'My month' : tf ? teacherNameById(tf) + '’s month' : 'All teachers') + '</h3><p class="muted"><b class="num">' + plural(live.length, 'class') + '</b> · <b class="num">' + plural(Object.keys(stu).length, 'student') + '</b>'
      + (busiest ? ' · busiest: <b>' + esc(dayShort(busiest)) + '</b> (' + by[busiest].length + ')' : '') + ' · <b class="num">' + free + '</b> free day' + (free === 1 ? '' : 's')
      + (Object.keys(clash).length ? ' · <span class="bad">' + I.warn + plural(Object.keys(clash).length, 'clashing slot') + '</span>' : '') + '</p></div>'
      + '<div class="mlegend" aria-hidden="true"><span><i class="h0"></i>Free</span><span><i class="h1"></i>Light</span><span><i class="h3"></i>Busy</span><span><i class="h4"></i>Busiest</span><span><i class="hc"></i>Clash</span></div></div>'
      + '<div class="mgrid" role="grid" aria-label="' + esc(MZ.monthLabel(r.m0.slice(0, 7))) + '">' + DOW.map(function (n) { return '<div class="mdow" role="columnheader">' + n + '</div>'; }).join('')
      + r.days.map(function (d) {
        var l = by[d] || [], out = d < r.m0 || d > r.m1, lvl = !l.length ? 0 : max <= 1 ? 2 : Math.max(1, Math.ceil(l.length / max * 4)), cl = l.some(function (x) { return clash[x.id]; });
        if (out) return '<div class="mcell out" aria-hidden="true"><span class="md">' + +d.slice(8) + '</span></div>';
        return '<button type="button" role="gridcell" class="mcell h' + lvl + (d === MZ.today() ? ' today' : '') + (d === pick ? ' sel' : '') + (cl ? ' clash' : '') + '" data-act="schPickDay" data-d="' + d + '" aria-pressed="' + (d === pick) + '" aria-label="' + esc(dayName(d) + ' ' + dayShort(d)) + ': ' + (l.length ? plural(l.length, 'class') : 'free') + (cl ? ', clash' : '') + '">'
          + '<span class="md">' + +d.slice(8) + '</span>' + (l.length ? '<span class="mcount num">' + l.length + '</span>' : '')
          + '<span class="mchips">' + l.slice(0, 3).map(function (x) { return '<span class="mchip' + (clash[x.id] ? ' clash' : '') + (me && x.teacher_user === me ? ' mine' : '') + '"><i class="num">' + esc(x.start_time) + '</i> ' + esc(MZ.firstName(schName(x))) + '</span>'; }).join('') + (l.length > 3 ? '<span class="mmore">+' + (l.length - 3) + ' more</span>' : '') + '</span>'
          + (!l.length ? '<span class="mfree">Free</span>' : '') + (cancelled[d] ? '<span class="mcan">' + cancelled[d] + ' cancelled</span>' : '') + (cl ? '<span class="mclash">' + I.warn + '</span>' : '') + '</button>';
      }).join('') + '</div></section>';
    h += '<div id="schDayPanel">' + schDayPanel(pick, all, clash, plan, me) + '</div>';
    return h;
  }
  // the chosen day: its classes, clashes and the free times of each teacher
  function schDayPanel(d, all, clash, plan, me) {
    var l = all.filter(function (x) { return x.slot_date === d; }), live = l.filter(schLive), tf = S.sch.teacher;
    // usual working hours, from the slots of the month
    var lv = all.filter(schLive), a = lv.length ? lv.reduce(function (m, x) { return x.start_time < m ? x.start_time : m; }, '23:59') : '07:00', b = lv.length ? lv.reduce(function (m, x) { return x.end_time > m ? x.end_time : m; }, '00:00') : '12:00';
    var ts = schTeacherList().filter(function (t) { return !tf || (tf === 'me' ? t.user_id === me : String(t.id) === tf); });
    if (role() === 'teacher' && !canPlan() && !canMove()) ts = ts.filter(function (t) { return t.user_id === me; });
    var gaps = function (tid) {
      var busy = live.filter(function (x) { return String(x.teacher_id) === String(tid); }).map(function (x) { return [tMin(x.start_time), tMin(x.end_time)]; }).sort(function (p, q) { return p[0] - q[0]; });
      var out = [], t = tMin(a), end = tMin(b);
      busy.forEach(function (x) { if (x[0] - t >= 30) out.push([t, x[0]]); t = Math.max(t, x[1]); });
      if (end - t >= 30) out.push([t, end]);
      return { n: busy.length, free: out.map(function (g) { return MZ.pad(Math.floor(g[0] / 60)) + ':' + MZ.pad(g[0] % 60) + '–' + MZ.pad(Math.floor(g[1] / 60)) + ':' + MZ.pad(g[1] % 60); }) };
    };
    return '<section class="mday panel"><div class="tthead"><div><h3>' + esc(dayName(d)) + ', ' + esc(MZ.dateLabel(d)) + '</h3><p class="muted">' + (live.length ? plural(live.length, 'class') : 'No classes') + (l.length - live.length ? ' · ' + (l.length - live.length) + ' cancelled' : '') + '</p></div>'
      + '<div class="btnrow"><button class="btn sm" type="button" data-act="schGoDay" data-d="' + d + '">Open day</button><button class="btn sm" type="button" data-act="schGoWeek" data-d="' + d + '">Open week</button>' + (plan && d >= MZ.today() ? '<button class="btn gold sm" type="button" data-act="schAdd" data-d="' + d + '">' + I.plus + 'Allocate</button>' : '') + '</div></div>'
      + (l.length ? '<div class="mlist">' + l.map(function (x) { return '<div class="mrow' + (schLive(x) ? '' : ' off') + (clash[x.id] ? ' clash' : '') + '"><span class="num tt-t">' + esc(x.start_time) + '–' + esc(x.end_time) + '</span><button type="button" class="linkbtn" data-act="schOpen" data-id="' + x.id + '"><b>' + esc(schName(x)) + '</b></button><span class="muted">' + esc(x.teacher_name) + (x.note ? ' · ' + esc(x.note) : '') + (schLive(x) ? '' : ' · Cancelled') + '</span>' + (clash[x.id] ? '<span class="pill warn">' + I.warn + 'Clash</span>' : '') + (plan ? schEditBtn(x) : '') + '</div>'; }).join('') + '</div>' : '')
      + (ts.length ? '<p class="flabel" style="margin-top:12px">Free times (usual hours ' + esc(a) + '–' + esc(b) + ')</p><div class="mfreeL">' + ts.map(function (t) { var g = gaps(t.id); return '<div><b>' + esc(t.full_name) + '</b><small>' + plural(g.n, 'class') + '</small><span>' + (g.free.length ? g.free.map(function (f) { return '<i class="num">' + f + '</i>'; }).join('') : '<em>No free time</em>') + '</span></div>'; }).join('') + '</div>' : '')
      + '</section>';
  }
  // only the admin and teachers given schedule permission (Yes, or Drag and drop only) can move students
  function canMoveSlot(x) { return x.status === 'scheduled' && canMove(); }
  function loadBusy(d) {
    S.sch.busy = S.sch.busy || {};
    if (S.sch.busy[d] || !api.teacherBusy) return;
    S.sch.busy[d] = [];
    api.teacherBusy(d).then(function (l) {
      var had = JSON.stringify(S.sch.busy[d] || []); S.sch.busy[d] = l;
      // a teacher cannot see other teachers' students, so show when those teachers are busy
      if (JSON.stringify(l) !== had && S.tab === 'schedule' && S.sch.mode === 'day' && !dnd && !canPlan()) render();
    }).catch(function () {});
  }
  function busyFor(tid, d, from, to, exceptId) {
    var mine = (S.sch.list || []).filter(function (x) { return x.status === 'scheduled' && x.slot_date === d && String(x.teacher_id) === String(tid) && x.id !== exceptId; });
    if (mine.some(function (x) { return x.start_time < to && from < x.end_time; })) return true;
    return ((S.sch.busy || {})[d] || []).some(function (b) { return String(b.teacher_id) === String(tid) && b.start_time < to && from < b.end_time && !(S.sch.list || []).some(function (x) { return x.id === exceptId && x.start_time === b.start_time && String(x.teacher_id) === String(b.teacher_id); }); });
  }
  function teacherNameById(tid) { var t = (S.schTeachers || []).find(function (x) { return String(x.id) === String(tid); }); return t ? t.full_name : 'the teacher'; }
  /* move one or more slots to another teacher; the database refuses clashes */
  function moveSlots(ids, tid, quiet) {
    var before = (S.sch.list || []).filter(function (x) { return ids.indexOf(x.id) >= 0; }).map(function (x) { return [x.id, x.teacher_id]; });
    return api.reassignSchedule(ids, tid).then(function (n) {
      tellTeachers(ids);
      S.sch.list = (S.sch.list || []).map(function (x) { return ids.indexOf(x.id) >= 0 ? Object.assign({}, x, { teacher_id: +tid, teacher_name: teacherNameById(tid), teacher_user: ((S.schTeachers || []).find(function (t) { return String(t.id) === String(tid); }) || {}).user_id || null, student_seen_at: null, teacher_seen_at: null }) : x; });
      S.sch.busy = {}; S.sch.justMoved = ids.slice(); render(); setTimeout(function () { S.sch.justMoved = null; }, 1200);
      if (!quiet) {
        var x = (S.sch.list || []).find(function (y) { return y.id === ids[0]; }), st = x && { full_name: schName(x) };
        MZ.toast((ids.length === 1 && st ? st.full_name : ids.length + ' students') + ' handed over to ' + teacherNameById(tid) + '. They and the student have been told.', { label: 'Undo', fn: function () {
          var by = {}; before.forEach(function (b) { (by[b[1]] = by[b[1]] || []).push(b[0]); });
          Object.keys(by).reduce(function (pr, k) { return pr.then(function () { return api.reassignSchedule(by[k], k); }); }, Promise.resolve()).then(function () { loadSchedule(true); MZ.toast('Undone.'); }).catch(function (e) { MZ.toast(e.message); });
        } });
      }
      setTimeout(function () { loadSchedule(true); }, 400);
      return n;
    });
  }
  /* drag and drop: mouse drags straight away; on touch, press and hold first so the page can still scroll */
  var dnd = null, swallowClick = false;
  function dndStart() {
    var d = dnd; d.on = true;
    var r = d.el.getBoundingClientRect(), g = d.el.cloneNode(true);
    g.className += ' sl-ghost'; g.removeAttribute('data-act'); g.style.width = r.width + 'px'; g.style.left = r.left + 'px'; g.style.top = r.top + 'px';
    d.dx = d.x0 - r.left; d.dy = d.y0 - r.top; d.ghost = g; document.body.appendChild(g);
    d.el.classList.add('sl-source'); document.body.classList.add('sch-dragging');
    if (navigator.vibrate && d.touch) try { navigator.vibrate(12); } catch (e) {}
    MZ.$$('#schLanes .lane').forEach(function (L) {
      var tid = L.dataset.lane;
      if (String(tid) === String(d.tid)) L.classList.add('origin');
      else L.classList.add(busyFor(tid, d.date, d.from, d.to, d.id) ? 'busy' : 'free');
    });
  }
  function dndMove(x, y) {
    var d = dnd; d.ghost.style.transform = 'translate(' + (x - d.dx - parseFloat(d.ghost.style.left)) + 'px,' + (y - d.dy - parseFloat(d.ghost.style.top)) + 'px) rotate(-2deg) scale(1.04)';
    d.ghost.style.visibility = 'hidden'; var under = document.elementFromPoint(x, y); d.ghost.style.visibility = '';
    var lane = under && under.closest ? under.closest('#schLanes .lane') : null;
    MZ.$$('#schLanes .lane.over').forEach(function (L) { if (L !== lane) L.classList.remove('over'); });
    if (lane) lane.classList.add('over'); d.lane = lane;
    // keep scrolling while dragging near the edges
    if (y < 70) window.scrollBy(0, -12); else if (y > window.innerHeight - 70) window.scrollBy(0, 12);
  }
  function dndEnd(cancel) {
    var d = dnd; dnd = null; if (!d) return;
    clearTimeout(d.hold);
    if (!d.on) return;
    swallowClick = true; setTimeout(function () { swallowClick = false; }, 80);
    document.body.classList.remove('sch-dragging');
    MZ.$$('#schLanes .lane').forEach(function (L) { L.classList.remove('origin', 'busy', 'free', 'over'); });
    var lane = !cancel && d.lane, tid = lane && lane.dataset.lane;
    var drop = function () { if (d.ghost) d.ghost.remove(); d.el.classList.remove('sl-source'); };
    if (!tid || String(tid) === String(d.tid)) { if (d.ghost) { d.ghost.classList.add('back'); d.ghost.style.transform = ''; setTimeout(drop, 260); } else drop(); return; }
    if (busyFor(tid, d.date, d.from, d.to, d.id)) { drop(); MZ.toast(teacherNameById(tid) + ' is busy at ' + d.from + '. Choose a teacher who glows gold.'); return; }
    var lr = lane.getBoundingClientRect(); d.ghost.classList.add('land'); d.ghost.style.transform = 'translate(' + (lr.left + 16 - parseFloat(d.ghost.style.left)) + 'px,' + (lr.top + 46 - parseFloat(d.ghost.style.top)) + 'px) scale(.96)';
    setTimeout(drop, 300);
    moveSlots([d.id], tid).catch(function (e) { MZ.toast(e.message); loadSchedule(true); });
  }
  document.addEventListener('pointerdown', function (e) {
    var el = e.target.closest && e.target.closest('#schLanes .slot.movable'); if (!el || e.button > 0) return;
    var x = (S.sch.list || []).find(function (y) { return String(y.id) === el.dataset.id; }); if (!x) return;
    dnd = { el: el, id: x.id, tid: x.teacher_id, date: x.slot_date, from: x.start_time, to: x.end_time, x0: e.clientX, y0: e.clientY, touch: e.pointerType !== 'mouse', on: false };
    if (dnd.touch) dnd.hold = setTimeout(function () { if (dnd && !dnd.on) { dndStart(); dndMove(dnd.x0, dnd.y0); } }, 280);
  });
  document.addEventListener('pointermove', function (e) {
    if (!dnd) return;
    if (!dnd.on) {
      var dist = Math.abs(e.clientX - dnd.x0) + Math.abs(e.clientY - dnd.y0);
      if (dnd.touch) { if (dist > 10) { clearTimeout(dnd.hold); dnd = null; } return; }
      if (dist > 6) dndStart(); else return;
    }
    e.preventDefault(); dndMove(e.clientX, e.clientY);
  }, { passive: false });
  document.addEventListener('touchmove', function (e) { if (dnd && dnd.on) e.preventDefault(); }, { passive: false });
  document.addEventListener('pointerup', function () { if (dnd) dndEnd(false); });
  document.addEventListener('pointercancel', function () { if (dnd) dndEnd(true); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dnd) dndEnd(true); });
  document.addEventListener('click', function (e) { if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true);
  document.addEventListener('contextmenu', function (e) { if (dnd && dnd.touch) e.preventDefault(); });
  /* "I can't come": share a teacher's students for the day among the others */
  function openHand(tid) {
    var d = S.sch.date || tomorrow(), l = (S.sch.list || []).filter(function (x) { return String(x.teacher_id) === String(tid) && x.slot_date === d && x.status === 'scheduled'; });
    if (!l.length) return;
    var others = schTeacherList().filter(function (t) { return String(t.id) !== String(tid); });
    var opts = function (x) { return '<option value="">Keep with ' + esc(teacherNameById(tid)) + '</option>' + others.map(function (t) { var b = busyFor(t.id, d, x.start_time, x.end_time, x.id); return '<option value="' + t.id + '"' + (b ? ' disabled' : '') + '>' + esc(t.full_name) + (b ? ' · busy then' : ' · free') + '</option>'; }).join(''); };
    openSheet('schHand', { tid: tid }, head(dayName(d) + ', ' + dayShort(d), 'Hand over ' + teacherNameById(tid) + '’s students')
      + '<form class="form" id="handForm" autocomplete="off"><p class="muted">Choose a teacher for each student. Only teachers who are free at that time can be chosen. Each student and teacher is told straight away.</p>'
      + '<div class="field"><label for="hdAll">Give every student to</label><select id="hdAll"><option value="">Choose for each student below</option>' + others.map(function (t) { return '<option value="' + t.id + '">' + esc(t.full_name) + '</option>'; }).join('') + '</select></div>'
      + '<div class="handlist">' + l.map(function (x) { var st = { full_name: schName(x) }; return '<div class="handrow"><span class="hd-who"><b>' + esc(st ? st.full_name : 'Student') + '</b><small class="num">' + esc(x.start_time) + '–' + esc(x.end_time) + (x.note ? ' · ' + esc(x.note) : '') + '</small></span><select data-hd="' + x.id + '" aria-label="New teacher for ' + esc(st ? st.full_name : 'student') + '">' + opts(x) + '</select></div>'; }).join('') + '</div>'
      + '<p class="err" id="hdErr" hidden></p><button class="btn gold block" type="submit" id="hdBtn">' + I.swap + 'Hand over</button></form>');
  }
  function saveHand() {
    var groups = {}, err = $('#hdErr'), btn = $('#hdBtn');
    MZ.$$('[data-hd]').forEach(function (sel) { if (sel.value) (groups[sel.value] = groups[sel.value] || []).push(+sel.dataset.hd || sel.dataset.hd); });
    var keys = Object.keys(groups); if (!keys.length) { err.textContent = 'Choose a new teacher for at least one student.'; err.hidden = false; return; }
    btn.disabled = true; var moved = 0, bad = [];
    keys.reduce(function (pr, k) { return pr.then(function () { return moveSlots(groups[k], k, true).then(function (n) { moved += groups[k].length; }, function (e) { bad.push(teacherNameById(k) + ': ' + e.message); }); }); }, Promise.resolve()).then(function () {
      btn.disabled = false;
      if (!bad.length) { closeSheet(); MZ.toast(moved + ' student' + (moved === 1 ? '' : 's') + ' handed over to ' + keys.map(teacherNameById).join(' and ') + '. Everyone has been told.'); }
      else { err.innerHTML = (moved ? '<b>' + moved + ' handed over.</b> ' : '') + bad.map(esc).join('<br>'); err.hidden = false; }
    });
  }
  document.addEventListener('change', function (e) {
    if (e.target.id !== 'hdAll' || !e.target.value) return;
    var v = e.target.value; MZ.$$('[data-hd]').forEach(function (sel) { var o = sel.querySelector('option[value="' + v + '"]'); if (o && !o.disabled) sel.value = v; });
  });
  function schSlotForm(x, day) {
    var st = schStudents(), ts = schTeacherList(), from = x ? x.start_time : (S.sch.lastFrom || '07:30'), to = x ? x.end_time : tAdd(from, S.sch.lastLen || 45);
    var d = x ? x.slot_date : (day || S.sch.date || tomorrow()), ws = weekStart(d);
    return '<form class="form" id="schForm" autocomplete="off">'
      + '<div class="field"><label for="scStu">Student</label><select id="scStu" required><option value="">Choose a student</option>' + st.map(function (s) { return '<option value="' + esc(s.id) + '"' + (x && x.student_id === s.id ? ' selected' : '') + '>' + esc(s.full_name) + (s.program ? ' · ' + esc(s.program) : '') + '</option>'; }).join('') + '</select></div>'
      + '<div class="field"><label for="scTch">Teacher</label><select id="scTch" required><option value="">Choose a teacher</option>' + ts.map(function (t) { return '<option value="' + t.id + '"' + (x ? (String(x.teacher_id) === String(t.id) ? ' selected' : '') : (S.sch.lastTeacher === String(t.id) ? ' selected' : '')) + '>' + esc(t.full_name) + '</option>'; }).join('') + '</select>'
      + (ts.length ? '' : '<span class="hint">Add teachers first under HR → Teachers.</span>') + '</div>'
      + '<div class="three"><div class="field"><label for="scDate">Date</label><input id="scDate" type="date" required value="' + esc(d) + '"></div>'
      + '<div class="field"><label for="scFrom">From</label><input id="scFrom" type="time" required step="300" value="' + esc(from) + '"></div>'
      + '<div class="field"><label for="scTo">To</label><input id="scTo" type="time" required step="300" value="' + esc(to) + '"></div></div>'
      + '<div class="durs" role="group" aria-label="Length">' + [15, 20, 30, 45, 60, 90].map(function (m) { return '<button type="button" class="chip" data-act="schLen" data-m="' + m + '">' + m + ' min</button>'; }).join('') + '</div>'
      + '<div class="field"><label for="scNote">What for (optional)</label><input id="scNote" maxlength="120" list="scNotes" value="' + esc(x ? x.note : (S.sch.lastNote || '')) + '" placeholder="e.g. Jadeed"><datalist id="scNotes">' + SCH_NOTES.map(function (n) { return '<option value="' + n + '">'; }).join('') + '</datalist></div>'
      + (x ? '' : '<fieldset class="field schrep"><legend class="flabel">Which dates</legend>'
        + '<label class="tickline"><input type="radio" name="scRep" value="one" checked> <span><b>Only this date</b></span></label>'
        + '<label class="tickline"><input type="radio" name="scRep" value="dates"> <span><b>Several dates</b> · pick any dates, this month or later</span></label>'
        + '<div class="scdates" id="scDates" hidden><div class="scdates-add"><input type="date" id="scDateAdd" aria-label="Add a date"><button type="button" class="btn sm" data-act="schAddDate">Add date</button></div><div class="scchips" id="scDateChips"></div></div>'
        + '<label class="tickline"><input type="radio" name="scRep" value="weekly"> <span><b>Repeat every week</b> · on the days you tick, until an end date (a repeating series you can change in one go)</span></label>'
        + '<div class="scweekly" id="scWeekly" hidden><div class="daypick">' + DOW.map(function (n, i) { return '<label class="dp"><input type="checkbox" name="scWd" value="' + i + '"' + (i === (new Date(d + 'T12:00:00').getDay() + 6) % 7 ? ' checked' : '') + '><span>' + n + '</span></label>'; }).join('') + '</div>'
        + '<div class="field" style="margin-top:8px"><label for="scUntil">Until</label><input id="scUntil" type="date" value="' + esc(isoAdd(d, 27)) + '"></div></div></fieldset>')
      + schNotifyChoice(x)
      + '<p class="schclash" id="scClash" role="status" hidden></p><p class="err" id="scErr" hidden></p><div class="btnrow"><button class="btn gold" type="submit" id="scBtn">' + I.check + (x ? 'Save and notify' : 'Allocate and notify') + '</button></div></form>';
  }
  /* ---- Allocate a student: 1 student, 2 teacher, 3 date, 4 time, then a summary with Save Schedule / Cancel ---- */
  var AL_LENS = [15, 20, 30, 45, 60, 90];
  function alTimes() { var t = [], m; for (m = 6 * 60; m <= 21 * 60 + 45; m += 15) t.push(MZ.pad(Math.floor(m / 60)) + ':' + MZ.pad(m % 60)); return t; }
  function fmt12(t) { if (!t) return ''; var h = +t.slice(0, 2), m = t.slice(3, 5); return ((h % 12) || 12) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function alEnd() { var a = S.al; return a.from ? tAdd(a.from, a.len) : ''; }
  function alStuName(id) { var s = schStudents().find(function (x) { return x.id === id; }); return s ? s.full_name : ''; }
  // everything already booked on a date: lessons (with names when allowed) and teachers' busy times
  function alLoadDay(d) {
    var a = S.al; if (!d || a.day[d]) return;
    a.day[d] = { loading: true, lessons: [], busy: [] };
    Promise.all([api.listSchedules({ from: d, to: d }).catch(function () { return []; }), api.teacherBusy ? api.teacherBusy(d).catch(function () { return []; }) : []]).then(function (r) {
      a.day[d] = { lessons: (r[0] || []).filter(schLive), busy: r[1] || [] };
      if (sheet && sheet.kind === 'schAdd' && S.al === a) alDraw();
    });
  }
  // why a time does not work (or '' when it is free)
  function alClash(d, from, to, tid, stu) {
    var day = S.al.day[d]; if (!day || !from) return '';
    var t = day.lessons.filter(function (x) { return x.start_time < to && from < x.end_time; });
    var ts = tid && t.find(function (x) { return String(x.teacher_id) === String(tid); });
    if (ts) return teacherNameById(tid) + ' already teaches ' + schName(ts) + ' ' + ts.start_time + '–' + ts.end_time;
    var ss = stu && t.find(function (x) { return x.student_id === stu; });
    if (ss) return alStuName(stu) + ' already has a lesson with ' + ss.teacher_name + ' ' + ss.start_time + '–' + ss.end_time;
    var b = tid && day.busy.find(function (x) { return String(x.teacher_id) === String(tid) && x.start_time < to && from < x.end_time; });
    if (b) return teacherNameById(tid) + ' is busy ' + b.start_time + '–' + b.end_time;
    return '';
  }
  function alStepHead(n, title, done, val, act) {
    return '<div class="alhead"><span class="alnum' + (done ? ' done' : '') + '">' + (done ? I.check : n) + '</span><div class="alt"><b>' + title + '</b>' + (done && val ? '<small>' + val + '</small>' : '') + '</div>' + (done && act ? '<button type="button" class="btn sm ghost" data-act="' + act + '">Change</button>' : '') + '</div>';
  }
  function alStuHTML() {
    var a = S.al, done = a.stu && !a.stuOpen;
    var h = alStepHead(1, 'Choose student', done, esc(alStuName(a.stu)), 'alStuEdit');
    if (done) return h;
    var q = a.sq.trim().toLowerCase(), all = schStudents(), l = all.filter(function (s) { return !q || s.full_name.toLowerCase().indexOf(q) >= 0; });
    return h + '<div class="alpick"><input type="search" id="alStuQ" class="alq" placeholder="Search by student name" value="' + esc(a.sq) + '" aria-label="Search students" autocomplete="off">'
      + '<div class="allist" role="listbox" aria-label="Students">' + (l.length ? l.slice(0, 60).map(function (s) { return '<button type="button" role="option" class="alopt' + (a.stu === s.id ? ' on' : '') + '" aria-selected="' + (a.stu === s.id) + '" data-act="alStu" data-id="' + esc(s.id) + '"><b>' + esc(s.full_name) + '</b>' + (s.program ? '<small>' + esc(s.program) + '</small>' : '') + '</button>'; }).join('') + (l.length > 60 ? '<p class="muted alhint">' + (l.length - 60) + ' more. Type more of the name.</p>' : '') : '<p class="muted alhint">' + (all.length ? 'No student matches “' + esc(a.sq) + '”.' : 'Loading students…') + '</p>') + '</div></div>';
  }
  function alTchHTML() {
    var a = S.al, done = a.tch && !a.tchOpen;
    var h = alStepHead(2, 'Choose teacher', done, esc(a.tch ? teacherNameById(a.tch) : ''), 'alTchEdit');
    if (done) return h + alTeacherDayHTML();
    var q = a.tq.trim().toLowerCase(), ts = schTeacherList(), l = ts.filter(function (t) { return !q || String(t.full_name).toLowerCase().indexOf(q) >= 0; }), day = a.date && a.day[a.date];
    if (!ts.length) return h + '<p class="muted">Add teachers first under HR → Teachers.</p>';
    return h + '<div class="alpick"><input type="search" id="alTchQ" class="alq" placeholder="Search by teacher name" value="' + esc(a.tq) + '" aria-label="Search teachers" autocomplete="off">'
      + '<div class="allist" role="listbox" aria-label="Teachers">' + (l.length ? l.map(function (t) {
        var info = '';
        if (day && !day.loading) {
          var n = day.lessons.filter(function (x) { return String(x.teacher_id) === String(t.id); }).length || day.busy.filter(function (x) { return String(x.teacher_id) === String(t.id); }).length;
          var c = a.from ? alClash(a.date, a.from, alEnd(), t.id, null) : '';
          info = '<small>' + (n ? plural(n, 'lesson') : 'No lessons') + ' on ' + esc(dayShort(a.date)) + (a.from ? ' · <span class="' + (c ? 'bad' : 'good') + '">' + (c ? 'busy at ' : 'free at ') + esc(fmt12(a.from)) + '</span>' : '') + '</small>';
        }
        return '<button type="button" role="option" class="alopt' + (String(a.tch) === String(t.id) ? ' on' : '') + '" aria-selected="' + (String(a.tch) === String(t.id)) + '" data-act="alTch" data-id="' + t.id + '"><b>' + esc(t.full_name) + '</b>' + info + '</button>';
      }).join('') : '<p class="muted alhint">No teacher matches “' + esc(a.tq) + '”.</p>') + '</div></div>';
  }
  // the chosen teacher's lessons that day, so free times are easy to see
  function alTeacherDayHTML() {
    var a = S.al, day = a.date && a.day[a.date]; if (!a.tch || !day || day.loading) return '';
    var l = day.lessons.filter(function (x) { return String(x.teacher_id) === String(a.tch); });
    var b = l.length ? [] : day.busy.filter(function (x) { return String(x.teacher_id) === String(a.tch); });
    if (!l.length && !b.length) return '<p class="alday muted">' + esc(teacherNameById(a.tch)) + ' has no lessons on ' + esc(dayName(a.date)) + ' ' + esc(dayShort(a.date)) + '.</p>';
    return '<div class="alday"><small class="muted">' + esc(teacherNameById(a.tch)) + ' on ' + esc(dayShort(a.date)) + ':</small> ' + (l.length ? l : b).map(function (x) { return '<span class="pill plain">' + esc(x.start_time) + '–' + esc(x.end_time) + (x.student_id ? ' ' + esc(MZ.firstName(schName(x))) : ' busy') + '</span>'; }).join(' ') + '</div>';
  }
  function alDateHTML() {
    var a = S.al, t = MZ.today(), quick = [];
    for (var i = 0; i < 8; i++) quick.push(isoAdd(t, i));
    return alStepHead(3, 'Choose date', !!a.date, '', '')
      + '<div class="aldates" role="group" aria-label="Quick dates">' + quick.map(function (d) { var w = new Date(d + 'T12:00:00'); return '<button type="button" class="aldate' + (a.date === d ? ' on' : '') + '" aria-pressed="' + (a.date === d) + '" data-act="alDate" data-d="' + d + '"><small>' + (d === t ? 'Today' : w.toLocaleDateString('en-GB', { weekday: 'short' })) + '</small><b>' + w.getDate() + '</b><small>' + w.toLocaleDateString('en-GB', { month: 'short' }) + '</small></button>'; }).join('') + '</div>'
      + '<div class="field alcal"><label for="alDateI">Or pick any date from the calendar</label><input id="alDateI" type="date" value="' + esc(a.date || '') + '"></div>';
  }
  function alTimeHTML() {
    var a = S.al, end = alEnd(), day = a.date && a.day[a.date];
    var h = alStepHead(4, 'Choose time', !!a.from, '', '')
      + '<p class="flabel">Lesson length</p><div class="durs allens" role="group" aria-label="Lesson length">' + AL_LENS.map(function (m) { return '<button type="button" class="chip" data-act="alLen" data-m="' + m + '" aria-pressed="' + (a.len === m) + '">' + m + ' min</button>'; }).join('') + '</div>';
    if (!a.date) return h + '<p class="muted alhint">Choose a date first to see the free times.</p>';
    if (!day || day.loading) return h + '<p class="muted alhint">Checking who is free…</p>';
    var now = a.date === MZ.today() ? MZ.pad(new Date().getHours()) + ':' + MZ.pad(new Date().getMinutes()) : '';
    var groups = [['Morning', '00:00', '12:00'], ['Afternoon', '12:00', '17:00'], ['Evening', '17:00', '24:00']], times = alTimes();
    h += '<p class="flabel" style="margin-top:10px">Start time <small class="muted">· gold = free' + (a.tch || a.stu ? ', crossed out = clash' : '') + '</small></p>';
    h += groups.map(function (g) {
      var ts = times.filter(function (t) { return t >= g[1] && t < g[2]; });
      return '<div class="algrp"><small>' + g[0] + '</small><div class="alslots">' + ts.map(function (t) {
        var e = tAdd(t, a.len), c = alClash(a.date, t, e, a.tch, a.stu), past = now && t < now;
        return '<button type="button" class="alslot' + (a.from === t ? ' on' : '') + (c ? ' clash' : '') + (past ? ' past' : '') + '" data-act="alFrom" data-t="' + t + '"' + (c ? ' disabled title="' + esc(c) + '"' : past ? ' title="Already past today"' : '') + ' aria-pressed="' + (a.from === t) + '">' + esc(fmt12(t)) + '</button>';
      }).join('') + '</div></div>';
    }).join('');
    h += '<div class="alother"><label for="alFromI">Other start time</label><input id="alFromI" type="time" step="300" value="' + esc(a.from || '') + '"><span class="alend">' + (a.from ? 'Ends <b>' + esc(fmt12(end)) + '</b> (' + a.len + ' min)' : 'The end time is worked out for you') + '</span></div>';
    return h;
  }
  function alSumHTML() {
    var a = S.al, end = alEnd(), ready = a.stu && a.tch && a.date && a.from, c = ready ? alClash(a.date, a.from, end, a.tch, a.stu) : '';
    var row = function (k, v) { return '<div><dt>' + k + '</dt><dd>' + (v ? esc(v) : '<span class="muted">—</span>') + '</dd></div>'; };
    return '<p class="flabel">Summary</p><dl class="info alsumdl">' + row('Student', alStuName(a.stu)) + row('Teacher', a.tch ? teacherNameById(a.tch) : '') + row('Date', a.date ? dayName(a.date) + ', ' + MZ.dateLabel(a.date) : '') + row('Start time', fmt12(a.from)) + row('End time', a.from ? fmt12(end) : '') + row('Duration', a.len + ' minutes') + '</dl>'
      + (c ? '<p class="schclash">' + I.warn + '<span><b>Clash.</b> ' + esc(c) + '. Choose another time or teacher.</span></p>' : '')
      + (!ready ? '<p class="muted alhint">' + (!a.stu ? 'Choose a student.' : !a.tch ? 'Choose a teacher.' : !a.date ? 'Choose a date.' : 'Choose a start time.') + '</p>' : '');
  }
  function alDraw(only) {
    if (!sheet || sheet.kind !== 'schAdd') return;
    var a = S.al, put = function (id, fn) { var el = $('#' + id); if (el && (!only || only.indexOf(id) >= 0)) el.innerHTML = fn(); };
    put('alStu', alStuHTML); put('alTch', alTchHTML); put('alDate', alDateHTML); put('alTime', alTimeHTML); put('alSum', alSumHTML);
    ['alStu', 'alTch', 'alDate', 'alTime'].forEach(function (id, i) { var el = $('#' + id); if (el) el.classList.toggle('done', !![a.stu && !a.stuOpen, a.tch && !a.tchOpen, a.date, a.from][i]); });
    // hidden fields the save uses
    $('#scStu').value = a.stu || ''; $('#scTch').value = a.tch || ''; $('#scDate').value = a.date || ''; $('#scFrom').value = a.from || ''; $('#scTo').value = a.from ? alEnd() : '';
    var ready = a.stu && a.tch && a.date && a.from, c = ready && alClash(a.date, a.from, alEnd(), a.tch, a.stu), b = $('#scBtn'); if (b) b.disabled = !ready || !!c;
  }
  function openSchAdd(day, pre) {
    if (!canPlan()) return;
    pre = pre || {};
    var keep = sheet && sheet.kind === 'schAdd' && S.al;  // the student list arrived: keep what was chosen
    if (!keep) S.al = { stu: pre.student_id || '', tch: pre.teacher_id ? String(pre.teacher_id) : (S.sch.lastTeacher || ''), date: day || null, from: '', len: S.sch.lastLen && AL_LENS.indexOf(S.sch.lastLen) >= 0 ? S.sch.lastLen : 30, sq: '', tq: '', stuOpen: !pre.student_id, tchOpen: !(pre.teacher_id || S.sch.lastTeacher), day: {} };
    if (S.al.tch && !schTeacherList().some(function (t) { return String(t.id) === String(S.al.tch); })) { S.al.tch = ''; S.al.tchOpen = true; }
    var d0 = S.al.date || day || S.sch.date || tomorrow();
    openSheet('schAdd', {}, head('Schedule', 'Allocate a student')
      + '<form class="form alform" id="schForm" autocomplete="off">'
      + '<input type="hidden" id="scStu"><input type="hidden" id="scTch"><input type="hidden" id="scDate"><input type="hidden" id="scFrom"><input type="hidden" id="scTo">'
      + '<ol class="alsteps"><li class="alstep" id="alStu"></li><li class="alstep" id="alTch"></li><li class="alstep" id="alDate"></li><li class="alstep" id="alTime"></li></ol>'
      + '<details class="almore"><summary>More options · remarks and repeating lessons</summary>'
      + '<div class="field"><label for="scNote">What for (optional)</label><input id="scNote" maxlength="120" list="scNotes" value="' + esc(S.sch.lastNote || '') + '" placeholder="e.g. Jadeed"><datalist id="scNotes">' + SCH_NOTES.map(function (n) { return '<option value="' + n + '">'; }).join('') + '</datalist></div>'
      + '<fieldset class="field schrep"><legend class="flabel">Which dates</legend>'
      + '<label class="tickline"><input type="radio" name="scRep" value="one" checked> <span><b>Only this date</b></span></label>'
      + '<label class="tickline"><input type="radio" name="scRep" value="dates"> <span><b>Several dates</b> · pick any dates, this month or later</span></label>'
      + '<div class="scdates" id="scDates" hidden><div class="scdates-add"><input type="date" id="scDateAdd" aria-label="Add a date"><button type="button" class="btn sm" data-act="schAddDate">Add date</button></div><div class="scchips" id="scDateChips"></div></div>'
      + '<label class="tickline"><input type="radio" name="scRep" value="weekly"> <span><b>Repeat every week</b> · on the days you tick, until an end date</span></label>'
      + '<div class="scweekly" id="scWeekly" hidden><div class="daypick">' + DOW.map(function (n, i) { return '<label class="dp"><input type="checkbox" name="scWd" value="' + i + '"' + (i === (new Date(d0 + 'T12:00:00').getDay() + 6) % 7 ? ' checked' : '') + '><span>' + n + '</span></label>'; }).join('') + '</div>'
      + '<div class="field" style="margin-top:8px"><label for="scUntil">Until</label><input id="scUntil" type="date" value="' + esc(isoAdd(d0, 27)) + '"></div></div></fieldset>'
      + schNotifyChoice(null) + '</details>'
      + '<section class="alsum" id="alSum"></section>'
      + '<p class="err" id="scErr" hidden></p><div class="btnrow alact"><button class="btn gold" type="submit" id="scBtn" disabled>' + I.check + 'Save Schedule</button><button class="btn ghost" type="button" data-act="close">Cancel</button></div></form>'
      + schExistingHTML(d0));
    if (S.al.date) alLoadDay(S.al.date);
    alDraw();
  }
  document.addEventListener('input', function (e) {
    if (!sheet || sheet.kind !== 'schAdd' || !S.al) return;
    var id = e.target.id;
    if (id === 'alStuQ' || id === 'alTchQ') {
      S.al[id === 'alStuQ' ? 'sq' : 'tq'] = e.target.value;
      var box = id === 'alStuQ' ? 'alStu' : 'alTch', pos = e.target.selectionStart;
      alDraw([box]); var i = $('#' + id); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (er) {} }
    }
  });
  document.addEventListener('change', function (e) {
    if (!sheet || sheet.kind !== 'schAdd' || !S.al) return;
    if (e.target.id === 'alDateI' && e.target.value) { S.al.date = e.target.value; alLoadDay(S.al.date); alDraw(); }
    if (e.target.id === 'alFromI' && e.target.value) { S.al.from = e.target.value.slice(0, 5); alDraw(); }
  });
  document.addEventListener('keydown', function (e) {
    // Enter in a search box picks the first match
    if (e.key !== 'Enter' || !e.target || (e.target.id !== 'alStuQ' && e.target.id !== 'alTchQ')) return;
    e.preventDefault(); var f = e.target.parentNode.querySelector('.alopt'); if (f) f.click();
  });
  /* ---- Bulk actions for one student: Delete All Schedules / Bulk Edit Schedules (every date, not only this week) ---- */
  function openBulk(mode, sid) {
    if (!canPlan()) return;
    S.bk = { mode: mode, stu: sid || '', sq: '', stuOpen: !sid, list: null, past: false, rf: '', rt: '', sel: {}, f: {}, review: null, confirm: false };
    openSheet('schBulk', {}, head('Schedule', mode === 'delete' ? 'Delete All Schedules' : 'Bulk Edit Schedules')
      + '<p class="muted bkintro">' + (mode === 'delete' ? 'Choose a student to see every lesson they have, on any day. Delete all of them, or only the ones you tick, in one go.' : 'Choose a student, tick the lessons to change (or Select All), then choose exactly what to change. You see a summary and any clashes before anything is saved.') + '</p>'
      + '<form class="form bkform" id="bkForm" autocomplete="off"><ol class="alsteps"><li class="alstep" id="bkStu"></li><li class="alstep" id="bkList"></li><li class="alstep" id="bkAct"></li></ol></form>');
    if (sid) bkLoad();
    bkDraw();
  }
  function bkLoad() {
    var b = S.bk; b.list = null; b.sel = {}; b.review = null; b.confirm = false;
    api.listSchedules({ studentId: b.stu }).then(function (l) {
      if (S.bk !== b) return;
      b.list = (l || []).filter(function (x) { return x.student_id === b.stu; });
      bkVisible().forEach(function (x) { if (b.mode === 'delete') b.sel[x.id] = 1; });
      bkDraw();
    }).catch(function (e) { b.list = []; b.err = e.message; bkDraw(); });
  }
  function bkVisible() {
    var b = S.bk, t = MZ.today();
    return (b.list || []).filter(function (x) { return (b.past || x.slot_date >= t) && (!b.rf || x.slot_date >= b.rf) && (!b.rt || x.slot_date <= b.rt); });
  }
  function bkChosen() { var b = S.bk; return bkVisible().filter(function (x) { return b.sel[x.id]; }); }
  function bkLen(x) { return tMin(x.end_time) - tMin(x.start_time); }
  function bkWhen(x) { return DOW[(new Date(x.slot_date + 'T12:00:00').getDay() + 6) % 7] + ' ' + dayShort(x.slot_date) + ' ' + x.slot_date.slice(0, 4); }
  function bkStuHTML() {
    var b = S.bk, done = b.stu && !b.stuOpen;
    var h = alStepHead(1, 'Choose student', done, esc(alStuName(b.stu) || schName({ student_id: b.stu })), 'bkStuEdit');
    if (done) return h;
    var q = b.sq.trim().toLowerCase(), all = schStudents(), l = all.filter(function (s) { return !q || s.full_name.toLowerCase().indexOf(q) >= 0; });
    return h + '<div class="alpick"><input type="search" id="bkStuQ" class="alq" placeholder="Search by student name" value="' + esc(b.sq) + '" aria-label="Search students" autocomplete="off">'
      + '<div class="allist" role="listbox" aria-label="Students">' + (l.length ? l.slice(0, 60).map(function (s) { return '<button type="button" role="option" class="alopt' + (b.stu === s.id ? ' on' : '') + '" data-act="bkStu" data-id="' + esc(s.id) + '"><b>' + esc(s.full_name) + '</b>' + (s.program ? '<small>' + esc(s.program) + '</small>' : '') + '</button>'; }).join('') : '<p class="muted alhint">No student matches.</p>') + '</div></div>';
  }
  function bkListHTML() {
    var b = S.bk, h = alStepHead(2, b.mode === 'delete' ? 'Their schedules' : 'Choose the schedules to change', false, '', '');
    if (!b.stu) return h + '<p class="muted alhint">Choose a student first.</p>';
    if (!b.list) return h + '<p class="muted alhint">Loading every lesson…</p>';
    if (b.err) return h + '<p class="err">' + esc(b.err) + '</p>';
    var vis = bkVisible(), ch = bkChosen(), pastN = (b.list || []).filter(function (x) { return x.slot_date < MZ.today(); }).length;
    h += '<div class="bkfilters"><div class="seg" role="group" aria-label="Which lessons"><button type="button" class="chip" data-act="bkPast" data-v="0" aria-pressed="' + !b.past + '">Upcoming</button><button type="button" class="chip" data-act="bkPast" data-v="1" aria-pressed="' + b.past + '">All, including past' + (pastN ? ' (' + pastN + ' past)' : '') + '</button></div>'
      + '<span class="bkrange"><label>From <input type="date" id="bkRf" value="' + esc(b.rf) + '"></label><label>To <input type="date" id="bkRt" value="' + esc(b.rt) + '"></label>' + (b.rf || b.rt ? '<button type="button" class="linkbtn" data-act="bkRange0">Clear dates</button>' : '') + '</span></div>';
    if (!vis.length) return h + '<p class="muted alhint">' + ((b.list || []).length ? 'No lessons match. ' + (!b.past ? 'Choose “All, including past” to see past lessons.' : '') : alStuName(b.stu) + ' has no schedules.') + '</p>';
    var all = vis.every(function (x) { return b.sel[x.id]; });
    h += '<div class="bkhead"><label class="tickline"><input type="checkbox" id="bkAll"' + (all ? ' checked' : '') + '> <span><b>Select All</b> · ' + vis.length + ' shown</span></label><span class="pill ' + (ch.length ? 'warn' : 'plain') + '">' + ch.length + ' selected</span></div>';
    h += '<div class="bklist">' + vis.map(function (x) {
      var past = x.slot_date < MZ.today();
      return '<label class="bkrow' + (b.sel[x.id] ? ' on' : '') + (past ? ' past' : '') + (x.status === 'cancelled' ? ' off' : '') + '"><input type="checkbox" data-bk="' + x.id + '"' + (b.sel[x.id] ? ' checked' : '') + '>'
        + '<span class="bkd num">' + esc(bkWhen(x)) + '</span><span class="bkt num">' + esc(x.start_time) + '–' + esc(x.end_time) + ' · ' + bkLen(x) + ' min</span><span class="bkw">' + esc(x.teacher_name) + (x.note ? ' · ' + esc(x.note) : '') + '</span>'
        + '<span class="bkp">' + (past ? '<span class="pill plain">Past</span>' : '') + (x.status === 'cancelled' ? '<span class="pill bad">Cancelled</span>' : '') + (x.series_id ? '<span class="pill plain">↻</span>' : '') + '</span></label>';
    }).join('') + '</div>';
    return h;
  }
  var BK_F = [['tch', 'Change teacher'], ['time', 'Change start time'], ['len', 'Change lesson length'], ['shift', 'Move dates'], ['note', 'Change remarks'], ['status', 'Change status']];
  function bkFieldHTML(k) {
    var b = S.bk, v = (b.f[k] || {}).v;
    if (k === 'tch') return '<select id="bkTch" aria-label="New teacher"><option value="">Choose the new teacher</option>' + schTeacherList().map(function (t) { return '<option value="' + t.id + '"' + (String(v) === String(t.id) ? ' selected' : '') + '>' + esc(t.full_name) + '</option>'; }).join('') + '</select>';
    if (k === 'time') return '<input type="time" id="bkTime" step="300" value="' + esc(v || '') + '" aria-label="New start time"><small class="muted">Each lesson keeps its length unless you change the length too.</small>';
    if (k === 'len') return '<div class="durs" role="group" aria-label="New length">' + AL_LENS.map(function (m) { return '<button type="button" class="chip" data-act="bkLenV" data-m="' + m + '" aria-pressed="' + (+v === m) + '">' + m + ' min</button>'; }).join('') + '</div><small class="muted">The end time is worked out from each start time.</small>';
    if (k === 'shift') return '<div class="bkshift"><button type="button" class="chip" data-act="bkShiftV" data-n="-7">−1 week</button><button type="button" class="chip" data-act="bkShiftV" data-n="-1">−1 day</button><input type="number" id="bkShift" min="-366" max="366" value="' + esc(v || 0) + '" aria-label="Days to move"><span>days</span><button type="button" class="chip" data-act="bkShiftV" data-n="1">+1 day</button><button type="button" class="chip" data-act="bkShiftV" data-n="7">+1 week</button></div>';
    if (k === 'note') return '<input id="bkNote" maxlength="120" list="scNotes" value="' + esc(v || '') + '" placeholder="Leave empty to clear the remarks"><datalist id="scNotes">' + SCH_NOTES.map(function (n) { return '<option value="' + n + '">'; }).join('') + '</datalist>';
    if (k === 'status') return '<div class="yesno">' + [['scheduled', 'Scheduled'], ['cancelled', 'Cancelled']].map(function (o) { return '<label class="yn"><input type="radio" name="bkSt" value="' + o[0] + '"' + ((v || 'scheduled') === o[0] ? ' checked' : '') + '><span>' + o[1] + '</span></label>'; }).join('') + '</div>';
    return '';
  }
  function bkChanges() {
    var b = S.bk, o = {}, words = [];
    if ((b.f.tch || {}).on && b.f.tch.v) { o.teacher_id = b.f.tch.v; words.push('Teacher → ' + teacherNameById(b.f.tch.v)); }
    if ((b.f.time || {}).on && b.f.time.v) { o.start_time = b.f.time.v; words.push('Start time → ' + fmt12(b.f.time.v)); }
    if ((b.f.len || {}).on && b.f.len.v) { o.len = +b.f.len.v; words.push('Length → ' + b.f.len.v + ' min'); }
    if ((b.f.shift || {}).on && +b.f.shift.v) { o.shift = +b.f.shift.v; words.push('Dates moved ' + (o.shift > 0 ? 'forward' : 'back') + ' ' + plural(Math.abs(o.shift), 'day')); }
    if ((b.f.note || {}).on) { o.note = (b.f.note.v || '').trim(); words.push(o.note ? 'Remarks → “' + o.note + '”' : 'Remarks cleared'); }
    if ((b.f.status || {}).on) { o.status = b.f.status.v || 'scheduled'; words.push('Status → ' + (o.status === 'cancelled' ? 'Cancelled' : 'Scheduled')); }
    return { o: o, words: words };
  }
  function bkPlan(x, o) {
    var a = o.start_time || x.start_time, len = o.len || bkLen(x), d = o.shift ? isoAdd(x.slot_date, o.shift) : x.slot_date, e = tMin(a) + len;
    return { x: x, d: d, a: a, b: e > 23 * 60 + 59 ? null : tAdd(a, len), len: len, tid: o.teacher_id || x.teacher_id, st: o.status || x.status, note: o.note == null ? x.note : o.note };
  }
  function bkActHTML() {
    var b = S.bk, ch = bkChosen();
    if (!b.stu || !b.list) return alStepHead(3, b.mode === 'delete' ? 'Delete' : 'What to change', false, '', '') + '<p class="muted alhint">Choose a student first.</p>';
    if (b.mode === 'delete') {
      var h = alStepHead(3, 'Delete', false, '', '');
      if (!ch.length) return h + '<p class="muted alhint">Tick at least one lesson above.</p>';
      var pastN = ch.filter(function (x) { return x.slot_date < MZ.today(); }).length;
      if (!b.confirm) return h + '<p class="muted">' + plural(ch.length, 'lesson') + ' selected, from ' + esc(dayShort(ch[0].slot_date)) + ' to ' + esc(dayShort(ch[ch.length - 1].slot_date)) + '.</p><div class="btnrow"><button type="button" class="btn danger" data-act="bkDelAsk">Delete ' + plural(ch.length, 'schedule') + '</button><button type="button" class="btn ghost" data-act="close">Cancel</button></div>';
      return h + '<div class="bkconfirm" role="alertdialog" aria-labelledby="bkcT"><p id="bkcT"><b>Delete ' + plural(ch.length, 'schedule') + ' for ' + esc(alStuName(b.stu) || schName({ student_id: b.stu })) + '?</b></p>'
        + '<p>They are removed from the Admin, Teacher and Student portals straight away. The change history keeps a record of each one. This cannot be undone.' + (pastN ? ' <b>' + plural(pastN, 'past lesson') + '</b> will be removed too.' : '') + '</p>'
        + '<label class="tickline"><input type="checkbox" id="bkTell" checked> <span><b>Email the student and teacher(s)</b> · lists the upcoming lessons that were removed</span></label>'
        + '<p class="err" id="bkErr" hidden></p><div class="btnrow"><button type="button" class="btn danger" data-act="bkDelGo" id="bkGo">Yes, delete ' + plural(ch.length, 'schedule') + '</button><button type="button" class="btn ghost" data-act="bkDelNo">Cancel</button></div></div>';
    }
    var h2 = alStepHead(3, 'What to change', false, '', '');
    if (b.review) return h2 + bkReviewHTML();
    h2 += '<p class="muted alhint">Tick only what should change. Everything else stays as it is.</p><div class="bkfields">' + BK_F.map(function (f) {
      var on = (b.f[f[0]] || {}).on;
      return '<div class="bkf' + (on ? ' on' : '') + '"><label class="tickline"><input type="checkbox" data-bkf="' + f[0] + '"' + (on ? ' checked' : '') + '> <span><b>' + f[1] + '</b></span></label>' + (on ? '<div class="bkfc">' + bkFieldHTML(f[0]) + '</div>' : '') + '</div>';
    }).join('') + '</div>' + schNotifyChoice(null)
      + '<p class="err" id="bkErr" hidden></p><div class="btnrow"><button type="button" class="btn gold" data-act="bkReview"' + (ch.length ? '' : ' disabled') + '>Review changes (' + ch.length + ')</button><button type="button" class="btn ghost" data-act="close">Cancel</button></div>';
    return h2;
  }
  function bkReviewHTML() {
    var b = S.bk, r = b.review, okN = r.rows.filter(function (x) { return !x.clash; }).length, badN = r.rows.length - okN;
    var tn = function (id) { return teacherNameById(id); };
    return '<div class="bksum"><p class="flabel">Summary · ' + esc(alStuName(b.stu) || '') + '</p><ul>' + r.words.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul><p>' + plural(r.rows.length, 'selected lesson') + (badN ? ': <b class="bad">' + badN + ' with a clash</b>, ' + okN + ' ready' : ', all ready') + '.</p></div>'
      + '<div class="tablewrap"><table class="grid bkrev"><thead><tr><th>Now</th><th>After</th><th>Check</th></tr></thead><tbody>' + r.rows.map(function (p) {
        var x = p.x, now = bkWhen(x) + ' ' + x.start_time + '–' + x.end_time + ' · ' + x.teacher_name, aft = p.b ? bkWhen({ slot_date: p.d }) + ' ' + p.a + '–' + p.b + ' · ' + tn(p.tid) + (p.st === 'cancelled' ? ' · Cancelled' : '') : '—';
        return '<tr class="' + (p.clash ? 'clash' : '') + '"><td>' + esc(now) + '</td><td>' + esc(aft) + '</td><td>' + (p.clash ? '<span class="bad">' + I.warn + esc(p.clash) + '</span>' : '<span class="good">' + I.check + 'OK</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      + (badN ? '<p class="schclash" style="margin-top:10px">' + I.warn + '<span><b>' + plural(badN, 'lesson') + ' would clash</b> and will not be changed. Nothing is overwritten. Untick them, choose another time or teacher, or apply only to the lessons without clashes.</span></p>' : '')
      + '<p class="err" id="bkErr" hidden></p><div class="btnrow"><button type="button" class="btn gold" data-act="bkApply" data-only="all" id="bkGo"' + (badN ? ' disabled' : '') + '>' + I.check + 'Apply to All Selected Schedules (' + r.rows.length + ')</button>'
      + (badN && okN ? '<button type="button" class="btn" data-act="bkApply" data-only="ok">Apply to the ' + okN + ' without clashes</button>' : '') + '<button type="button" class="btn ghost" data-act="bkBack">Back</button></div>';
  }
  function bkDraw(only) {
    if (!sheet || sheet.kind !== 'schBulk' || !S.bk) return;
    var put = function (id, fn) { var el = $('#' + id); if (el && (!only || only.indexOf(id) >= 0)) el.innerHTML = fn(); };
    put('bkStu', bkStuHTML); put('bkList', bkListHTML); put('bkAct', bkActHTML);
    var el = $('#bkStu'); if (el) el.classList.toggle('done', !!(S.bk.stu && !S.bk.stuOpen));
  }
  // check every planned change against the other lessons on those dates (the database checks again when saving)
  function bkReview() {
    var b = S.bk, c = bkChanges(), ch = bkChosen(), err = $('#bkErr');
    var bad = function (m) { if (err) { err.textContent = m; err.hidden = false; } };
    if (!ch.length) return bad('Tick at least one lesson.');
    if (!c.words.length) return bad('Tick what to change and fill it in.');
    if ((b.f.tch || {}).on && !b.f.tch.v) return bad('Choose the new teacher.');
    if ((b.f.time || {}).on && !b.f.time.v) return bad('Choose the new start time.');
    if ((b.f.len || {}).on && !b.f.len.v) return bad('Choose the new length.');
    var plan = ch.map(function (x) { return bkPlan(x, c.o); }), ds = plan.map(function (p) { return p.d; }).sort(), ids = ch.map(function (x) { return x.id; });
    var btn = MZ.$$('[data-act=bkReview]')[0]; if (btn) btn.disabled = true;
    Promise.all([api.listSchedules({ from: ds[0], to: ds[ds.length - 1] }).catch(function () { return []; })].concat(api.teacherBusy && c.o.teacher_id ? ds.filter(function (d, i) { return ds.indexOf(d) === i; }).slice(0, 60).map(function (d) { return api.teacherBusy(d).then(function (l) { return { d: d, l: l }; }).catch(function () { return { d: d, l: [] }; }); }) : [])).then(function (res) {
      var others = (res[0] || []).filter(function (x) { return schLive(x) && ids.indexOf(x.id) < 0; }), busy = {};
      res.slice(1).forEach(function (r) { busy[r.d] = r.l; });
      plan.forEach(function (p, i) {
        if (!p.b) { p.clash = 'Would end after midnight'; return; }
        if (p.st !== 'scheduled') return;
        var o = others.find(function (y) { return y.slot_date === p.d && y.start_time < p.b && p.a < y.end_time && (String(y.teacher_id) === String(p.tid) || y.student_id === b.stu); });
        if (o) { p.clash = o.student_id === b.stu ? 'Already has a lesson ' + o.start_time + '–' + o.end_time + ' with ' + o.teacher_name : teacherNameById(p.tid) + ' teaches ' + schName(o) + ' ' + o.start_time + '–' + o.end_time; return; }
        var bz = (busy[p.d] || []).find(function (y) { return String(y.teacher_id) === String(p.tid) && y.start_time < p.b && p.a < y.end_time && !(String(p.x.teacher_id) === String(p.tid) && p.x.slot_date === p.d && p.x.start_time === y.start_time); });
        if (bz) { p.clash = teacherNameById(p.tid) + ' is busy ' + bz.start_time + '–' + bz.end_time; return; }
        var self = plan.find(function (q, j) { return j < i && !q.clash && q.st === 'scheduled' && q.d === p.d && q.a < p.b && p.a < q.b; });
        if (self) p.clash = 'Overlaps another chosen lesson at ' + self.a;
      });
      b.review = { words: c.words, o: c.o, rows: plan, ntf: (document.querySelector('input[name=scNtf]:checked') || {}).value || 'auto' };
      bkDraw(['bkAct']);
    });
  }
  function bkApply(t) {
    var b = S.bk, r = b.review; if (!r) return;
    var rows = t.dataset.only === 'ok' ? r.rows.filter(function (p) { return !p.clash; }) : r.rows, ids = rows.map(function (p) { return p.x.id; }), err = $('#bkErr');
    MZ.$$('[data-act=bkApply]').forEach(function (x) { x.disabled = true; });
    api.bulkUpdateSchedules(b.stu, ids, r.o).then(function (done) {
      done = (done || []).map(Number);
      afterSchSave(done, r.ntf, done[0], plural(done.length, 'lesson') + ' changed for ' + (alStuName(b.stu) || 'the student'));
    }).catch(function (e) { if (err) { err.textContent = e.message + ' Nothing was changed.'; err.hidden = false; } MZ.$$('[data-act=bkApply]').forEach(function (x) { x.disabled = false; }); });
  }
  function bkDelete() {
    var b = S.bk, ch = bkChosen(), ids = ch.map(function (x) { return x.id; }), tell = $('#bkTell') && $('#bkTell').checked, err = $('#bkErr'), go = $('#bkGo'), name = alStuName(b.stu) || 'the student';
    if (go) go.disabled = true;
    api.bulkDeleteSchedules(b.stu, ids).then(function (done) {
      done = (done || []).map(Number);
      S.sch.busy = {}; S.sch.notes = null; S.sch.notesKey = null; loadSchedule(true); closeSheet();
      var msg = plural(done.length, 'schedule') + ' deleted for ' + name + '.';
      if (!tell || !api.notifyRemoved) { MZ.toast(msg); return; }
      MZ.toast(msg + ' Emailing the student and teacher(s)…');
      api.notifyRemoved(done).then(function (r) {
        var res = (r && r.results) || [], ok = res.filter(function (x) { return x.sent; }), miss = res.filter(function (x) { return !x.sent; });
        MZ.toast((r && r.demo ? 'Demo mode: nothing is really sent. ' : '') + msg + (res.length ? ' Emailed: ' + (ok.map(function (x) { return x.name; }).join(', ') || 'nobody') + (miss.length ? '. Not emailed: ' + miss.map(function (x) { return x.name + (x.missing ? ' (no email address)' : ''); }).join(', ') : '') + '.' : ' No upcoming lessons, so no email was needed.'));
      }).catch(function (e) { MZ.toast(msg + ' The email could not be sent: ' + (e.notDeployed ? 'the “notify-teacher” function is not deployed.' : e.message)); });
    }).catch(function (e) { if (go) go.disabled = false; if (err) { err.textContent = e.message; err.hidden = false; } });
  }
  document.addEventListener('input', function (e) {
    if (!sheet || sheet.kind !== 'schBulk' || !S.bk) return;
    var b = S.bk, id = e.target.id;
    if (id === 'bkStuQ') { b.sq = e.target.value; var pos = e.target.selectionStart; bkDraw(['bkStu']); var i = $('#bkStuQ'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (er) {} } }
    var fk = { bkTime: 'time', bkShift: 'shift', bkNote: 'note' }[id]; if (fk) { b.f[fk] = b.f[fk] || { on: true }; b.f[fk].v = e.target.value; }
  });
  document.addEventListener('change', function (e) {
    if (!sheet || sheet.kind !== 'schBulk' || !S.bk) return;
    var b = S.bk, t = e.target;
    if (t.dataset && t.dataset.bk) { if (t.checked) b.sel[t.dataset.bk] = 1; else delete b.sel[t.dataset.bk]; b.confirm = false; b.review = null; bkDraw(['bkList', 'bkAct']); return; }
    if (t.id === 'bkAll') { bkVisible().forEach(function (x) { if (t.checked) b.sel[x.id] = 1; else delete b.sel[x.id]; }); b.confirm = false; b.review = null; bkDraw(['bkList', 'bkAct']); return; }
    if (t.id === 'bkRf' || t.id === 'bkRt') { b[t.id === 'bkRf' ? 'rf' : 'rt'] = t.value; b.confirm = false; b.review = null; bkDraw(['bkList', 'bkAct']); return; }
    if (t.dataset && t.dataset.bkf) { var k = t.dataset.bkf; b.f[k] = b.f[k] || {}; b.f[k].on = t.checked; bkDraw(['bkAct']); return; }
    if (t.id === 'bkTch') { b.f.tch = b.f.tch || { on: true }; b.f.tch.v = t.value; }
    if (t.name === 'bkSt') { b.f.status = b.f.status || { on: true }; b.f.status.v = t.value; }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target && e.target.id === 'bkStuQ') { e.preventDefault(); var f = e.target.parentNode.querySelector('.alopt'); if (f) f.click(); } });
  /* ---- Timetable emails: weekly timetables for students, teachers and the admin, with preview, print and history ---- */
  var TT_WHO = { student: 'Student', teacher: 'Teacher', admin: 'Admin' };
  function openTT() {
    if (!canPlan()) return;
    var w = MZ.weekOf(S.sch.date || MZ.today());
    S.tt = { from: w.from, to: w.to, custom: false, list: null, hist: null, sel: {}, skip: true, busy: false, msg: '', prev: null };
    openSheet('schTT', {}, head('Schedule', 'Timetable emails') + '<div id="ttBox"></div>');
    ttLoad();
  }
  function ttLoad() {
    var t = S.tt; t.list = null; t.sel = {}; t.err = null; ttDraw();
    var key = t.from + '|' + t.to;
    Promise.all([api.timetableRecipients(t.from, t.to), api.listTimetableNotifications ? api.listTimetableNotifications().catch(function () { return []; }) : []]).then(function (r) {
      if (S.tt !== t || key !== t.from + '|' + t.to) return;
      t.list = r[0] || []; t.hist = r[1] || []; ttDraw();
    }).catch(function (e) { t.list = []; t.err = /timetable_recipients|function/i.test(e.message) ? 'This needs the latest database update (supabase-update-2.sql).' : e.message; ttDraw(); });
  }
  function ttState(x) {
    if (!x.email) return ['bad', 'No email address saved'];
    if (!x.last) return ['plain', 'Not sent yet'];
    var when = esc(String(x.last.at || '').slice(0, 16).replace('T', ' '));
    if (x.last.status === 'failed') return ['bad', 'Failed ' + when];
    if (x.sent_hash && x.sent_hash === x.hash) return ['good', 'Sent ' + when + ' · up to date'];
    if (x.sent_hash) return ['warn', 'Changed since it was sent'];
    return ['plain', 'Not sent yet'];
  }
  function ttKey(x) { return x.type + ':' + x.ref; }
  function ttDraw() {
    var box = $('#ttBox'), t = S.tt; if (!box || !t) return;
    var per = MZ.ttPeriod({ from: t.from, to: t.to });
    var h = '<div class="ttper"><div class="ttweek"><button type="button" class="iconbtn sm" data-act="ttWeek" data-n="-7" aria-label="Previous week">‹</button><b>' + esc(per) + '</b><button type="button" class="iconbtn sm" data-act="ttWeek" data-n="7" aria-label="Next week">›</button></div>'
      + '<button type="button" class="linkbtn" data-act="ttCustom">' + (t.custom ? 'Use whole weeks' : 'Choose other dates') + '</button>'
      + (t.custom ? '<span class="bkrange"><label>From <input type="date" id="ttFrom" value="' + esc(t.from) + '"></label><label>To <input type="date" id="ttTo" value="' + esc(t.to) + '"></label></span>' : '') + '</div>'
      + '<p class="muted alhint">Built from the saved schedules. Cancelled lessons are left out; changed lessons are marked. Nothing is sent until you press a Notify button.</p>';
    if (t.err) return (box.innerHTML = h + '<p class="err">' + esc(t.err) + '</p>');
    if (!t.list) return (box.innerHTML = h + '<p class="muted">Loading…</p>');
    var groups = [['admin', 'Admin'], ['teacher', 'Teachers'], ['student', 'Students']], anyLessons = t.list.some(function (x) { return x.type !== 'admin' && x.lessons; });
    var sel = t.list.filter(function (x) { return t.sel[ttKey(x)]; });
    h += '<div class="ttbar"><button type="button" class="btn sm gold" data-act="ttSend" data-to="student"' + (t.busy ? ' disabled' : '') + '>' + I.mail + 'Notify Students</button><button type="button" class="btn sm gold" data-act="ttSend" data-to="teacher"' + (t.busy ? ' disabled' : '') + '>' + I.mail + 'Notify Teachers</button><button type="button" class="btn sm gold" data-act="ttSend" data-to="admin"' + (t.busy ? ' disabled' : '') + '>' + I.mail + 'Notify Admin</button><button type="button" class="btn sm gold" data-act="ttSend" data-to="all"' + (t.busy ? ' disabled' : '') + '>' + I.mail + 'Notify All</button>'
      + (sel.length ? '<button type="button" class="btn sm" data-act="ttSend" data-to="sel"' + (t.busy ? ' disabled' : '') + '>Send to the ' + sel.length + ' ticked</button>' : '') + '</div>'
      + '<label class="tickline ttskip"><input type="checkbox" id="ttSkip"' + (t.skip ? ' checked' : '') + '> <span><b>Don’t resend unchanged timetables</b> · skip anyone who already has this period and nothing changed since</span></label>'
      + (t.msg ? '<p class="' + (t.msgBad ? 'err' : 'okmsg') + '">' + t.msg + '</p>' : '');
    if (!anyLessons) h += '<div class="empty" style="margin-top:12px"><h3>No lessons in this period</h3><p>Choose another week, or allocate students first.</p></div>';
    h += groups.map(function (g) {
      var l = t.list.filter(function (x) { return x.type === g[0] && (g[0] === 'admin' || x.lessons); }); if (!l.length) return '';
      return '<section class="ttgrp"><p class="flabel">' + g[1] + ' (' + l.length + ')</p>' + l.map(function (x) {
        var st = ttState(x), k = ttKey(x);
        return '<div class="ttrow' + (x.email ? '' : ' miss') + '"><label class="ttpick"><input type="checkbox" data-tt="' + esc(k) + '"' + (t.sel[k] ? ' checked' : '') + (x.email ? '' : ' disabled') + ' aria-label="Choose ' + esc(x.name) + '"></label>'
          + '<span class="ttwho"><b>' + esc(x.name) + '</b><small>' + (x.email ? esc(x.email) : '<span class="bad">' + I.warn + (x.type === 'admin' ? 'No admin email (Settings → Schedule emails)' : 'No email address saved') + '</span>') + ' · ' + plural(x.lessons || 0, 'lesson') + '</small></span>'
          + '<span class="pill ' + st[0] + '">' + st[1] + '</span>'
          + '<span class="ttbtns"><button type="button" class="btn sm" data-act="ttPrev" data-k="' + esc(k) + '">Preview</button><button type="button" class="btn sm' + (x.email ? ' gold' : '') + '" data-act="ttSend" data-to="one" data-k="' + esc(k) + '"' + (x.email && !t.busy ? '' : ' disabled') + '>' + I.mail + 'Notify ' + TT_WHO[x.type] + '</button></span></div>';
      }).join('') + '</section>';
    }).join('');
    var hist = (t.hist || []).slice(0, 120);
    h += '<details class="ntfhist"' + (t.openHist ? ' open' : '') + '><summary>Notification history (' + (t.hist || []).length + ')</summary>' + (hist.length ? '<div class="tablewrap"><table class="grid"><thead><tr><th>When</th><th>Recipient</th><th>Email</th><th>Timetable period</th><th>Lessons</th><th>Status</th></tr></thead><tbody>' + hist.map(function (n) {
      return '<tr><td>' + esc(String(n.created_at || '').slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(TT_WHO[n.recipient_type] || '') + ' · ' + esc(n.recipient_name || '') + '</td><td>' + esc(n.recipient_email || '—') + '</td><td>' + esc(MZ.ttPeriod({ from: n.period_from, to: n.period_to })) + '</td><td class="num">' + (n.lessons || 0) + '</td><td>' + esc(n.status === 'sent' ? 'Delivered' : n.status === 'skipped' ? 'Not sent: unchanged' : n.status === 'missing' ? 'No email address' : 'Failed' + (n.error ? ': ' + n.error : '')) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="muted">Nothing sent yet.</p>') + '</details>';
    if (t.prev) h += ttPreviewHTML();
    box.innerHTML = h;
  }
  function ttPreviewHTML() {
    var p = S.tt.prev;
    if (p.loading) return '<div class="ttprev"><p class="muted">Building the preview…</p></div>';
    if (p.err) return '<div class="ttprev"><p class="err">' + esc(p.err) + '</p><button type="button" class="btn sm" data-act="ttPrevClose">Close preview</button></div>';
    var x = p.data;
    return '<div class="ttprev" id="ttPrev"><div class="ttprev-head"><div><p class="flabel">Preview · exactly what is sent</p><p class="ttto">To: <b>' + esc(x.name) + '</b> ' + (x.email ? '&lt;' + esc(x.email) + '&gt;' : '<span class="bad">no email address</span>') + '<br>Subject: <b>' + esc(MZ.ttSubject(x)) + '</b><br><small class="muted">' + plural(x.rows.length, 'lesson') + ' · PDF attached for printing</small></p></div>'
      + '<div class="btnrow"><button type="button" class="btn sm" data-act="ttPrint">Print / Save as PDF</button>' + (x.email ? '<button type="button" class="btn sm gold" data-act="ttSend" data-to="one" data-k="' + esc(x.type + ':' + (x.ref || '')) + '">' + I.mail + 'Send to ' + esc(MZ.firstName ? MZ.firstName(x.name) : x.name) + '</button>' : '') + '<button type="button" class="btn sm ghost" data-act="ttPrevClose">Close preview</button></div></div>'
      + '<iframe class="ttframe" title="Email preview" sandbox="" srcdoc="' + esc(MZ.ttEmailHtml(x, { printUrl: '#', siteUrl: '#', pdf: true })) + '"></iframe></div>';
  }
  function ttPreview(k) {
    var t = S.tt, x = (t.list || []).find(function (y) { return ttKey(y) === k; }); if (!x) return;
    t.prev = { loading: true }; ttDraw();
    api.timetablePayload(t.from, t.to, x.type, x.ref).then(function (p) { t.prev = { data: p }; ttDraw(); var el = $('#ttPrev'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); })
      .catch(function (e) { t.prev = { err: e.message }; ttDraw(); });
  }
  function ttSend(btn) {
    var t = S.tt, to = btn.dataset.to, l = (t.list || []).filter(function (x) { return x.email && (x.type === 'admin' || x.lessons); });
    var pick = to === 'all' ? l : to === 'sel' ? l.filter(function (x) { return t.sel[ttKey(x)]; }) : to === 'one' ? l.filter(function (x) { return ttKey(x) === btn.dataset.k; }) : l.filter(function (x) { return x.type === to; });
    var missing = (t.list || []).filter(function (x) { return !x.email && (x.type === 'admin' || x.lessons) && (to === 'all' || x.type === to); });
    if (!pick.length) { t.msg = 'Nobody to send to' + (missing.length ? ': ' + missing.map(function (x) { return esc(x.name); }).join(', ') + ' ' + (missing.length === 1 ? 'has' : 'have') + ' no email address.' : '.'); t.msgBad = true; ttDraw(); return; }
    // one person, already sent and unchanged: ask once more instead of sending a duplicate
    var force = to === 'one' || !t.skip;
    if (to === 'one' && pick[0].sent_hash === pick[0].hash && btn.dataset.armed !== '1') { MZ.arm(btn, function () { ttSend(btn); }, 'Already sent, unchanged. Tap again to resend'); return; }
    t.busy = true; t.msg = 'Sending to ' + pick.length + (pick.length === 1 ? ' person' : ' people') + '…'; t.msgBad = false; ttDraw();
    api.sendTimetables(t.from, t.to, pick.map(function (x) { return { type: x.type, ref: x.ref }; }), force).then(function (r) {
      var res = (r && r.results) || [], ok = res.filter(function (x) { return x.status === 'sent'; }), sk = res.filter(function (x) { return x.status === 'skipped'; }), bad = res.filter(function (x) { return x.status !== 'sent' && x.status !== 'skipped'; });
      t.busy = false; t.msgBad = !!bad.length; t.prev = null;
      t.msg = (r && r.demo ? '<b>Demo mode:</b> nothing is really sent. ' : '') + (ok.length ? 'Sent to ' + ok.map(function (x) { return esc(x.name) + ' (' + esc(x.email) + ')'; }).join(', ') + '. ' : '')
        + (sk.length ? 'Not sent again (unchanged since last time): ' + sk.map(function (x) { return esc(x.name); }).join(', ') + '. ' : '')
        + (bad.length ? 'Not sent: ' + bad.map(function (x) { return esc(x.name) + (x.status === 'missing' ? ' (no email address)' : ' (' + esc(x.error || 'failed') + ')'); }).join(', ') + '. ' : '')
        + (missing.length && to !== 'one' && to !== 'sel' ? 'Skipped (no email address): ' + missing.map(function (x) { return esc(x.name); }).join(', ') + '.' : '');
      t.openHist = true; ttLoad();
    }).catch(function (e) { t.busy = false; t.msgBad = true; t.msg = esc(e.notDeployed ? 'Emails are not switched on: the “notify-teacher” function is not deployed in Supabase.' : e.message) + ' Nothing was sent.'; ttDraw(); });
  }
  document.addEventListener('change', function (e) {
    if (!sheet || sheet.kind !== 'schTT' || !S.tt) return;
    var t = S.tt, x = e.target;
    if (x.dataset && x.dataset.tt) { if (x.checked) t.sel[x.dataset.tt] = 1; else delete t.sel[x.dataset.tt]; ttDraw(); }
    if (x.id === 'ttSkip') t.skip = x.checked;
    if ((x.id === 'ttFrom' || x.id === 'ttTo') && x.value) {
      var f = x.id === 'ttFrom' ? x.value : t.from, to = x.id === 'ttTo' ? x.value : t.to;
      if (to < f) { var s = f; f = to; to = s; }
      if ((new Date(to) - new Date(f)) / 864e5 > 62) { MZ.toast('Choose at most 9 weeks at a time.'); ttDraw(); return; }
      t.from = f; t.to = to; t.prev = null; t.msg = ''; ttLoad();
    }
  });
  // Allocate Students: what is already allocated that week, each with an Edit button
  function schExistingHTML(d) {
    var ws = weekStart(d), we = isoAdd(ws, 6), l = (S.sch.list || []).filter(function (x) { return x.slot_date >= ws && x.slot_date <= we; });
    var loaded = S.sch.key && S.sch.key.split('|')[0] <= ws && S.sch.key.split('|')[1] >= we;
    if (!loaded) return '<section class="schexist"><p class="flabel">Already allocated</p><p class="muted">Open the week of ' + esc(dayShort(ws)) + ' on the Schedule page to see and edit its allocations.</p></section>';
    return '<section class="schexist"><p class="flabel">Already allocated · week of ' + esc(dayShort(ws)) + ' (' + l.filter(schLive).length + ')</p>'
      + (l.length ? '<div class="mlist">' + l.map(function (x) { return '<div class="mrow' + (schLive(x) ? '' : ' off') + '"><span class="num tt-t">' + esc(DOW[(new Date(x.slot_date + 'T12:00:00').getDay() + 6) % 7]) + ' ' + esc(x.start_time) + '–' + esc(x.end_time) + '</span><b>' + esc(schName(x)) + '</b><span class="muted">' + esc(x.teacher_name) + (schLive(x) ? '' : ' · Cancelled') + '</span>' + schEditBtn(x) + '</div>'; }).join('') + '</div>'
        : '<p class="muted">Nothing allocated that week yet.</p>') + '</section>';
  }
  // warn about a double booking while the form is being filled (the database refuses it too)
  function schClashHint() {
    var box = $('#scClash'); if (!box || !sheet) return;
    var id = sheet.kind === 'schEdit' ? sheet.data.id : null, stu = $('#scStu').value, tid = $('#scTch').value, d = $('#scDate').value, a = $('#scFrom').value, b = $('#scTo').value;
    if (!d || !a || !b || b <= a) { box.hidden = true; return; }
    var hit = (S.sch.list || []).filter(function (x) { return schLive(x) && x.id !== id && x.slot_date === d && x.start_time < b && a < x.end_time && ((tid && String(x.teacher_id) === String(tid)) || (stu && x.student_id === stu)); });
    if (!hit.length && tid) { var bz = ((S.sch.busy || {})[d] || []).filter(function (x) { return String(x.teacher_id) === String(tid) && x.start_time < b && a < x.end_time && !(S.sch.list || []).some(function (y) { return y.id === id && y.start_time === x.start_time; }); }); if (bz.length) hit = bz.map(function (x) { return { teacher_name: teacherNameById(tid), start_time: x.start_time, end_time: x.end_time, busyOnly: true }; }); }
    if (!hit.length) { box.hidden = true; return; }
    box.innerHTML = I.warn + '<span><b>Double booking.</b> ' + hit.slice(0, 3).map(function (x) { return x.busyOnly ? esc(x.teacher_name) + ' is busy ' + esc(x.start_time) + '–' + esc(x.end_time) : (stu && x.student_id === stu ? esc(schName(x)) + ' already has ' + esc(x.teacher_name) : esc(x.teacher_name) + ' already teaches ' + esc(schName(x))) + ' ' + esc(x.start_time) + '–' + esc(x.end_time); }).join('; ') + '. Choose another time or teacher.</span>';
    box.hidden = false;
  }
  document.addEventListener('input', function (e) { if (e.target.closest && e.target.closest('#schForm')) schClashHint(); });
  document.addEventListener('change', function (e) { if (e.target.closest && e.target.closest('#schForm')) { if (e.target.id === 'scDate' && e.target.value) loadBusy(e.target.value); schClashHint(); } });
  // after saving: email straight away, choose who to email, or send nothing (remembered on this device)
  function schNotifyPref() { try { return localStorage.getItem('qt_sch_notify') || 'auto'; } catch (e) { return 'auto'; } }
  function schNotifyChoice(x) {
    var v = schNotifyPref();
    return '<fieldset class="field schnotify"><legend class="flabel">After saving</legend>'
      + [['auto', 'Email the student and teacher(s) now', 'Everyone affected, including a teacher a lesson is taken from.'], ['choose', 'Let me choose who to email', 'Opens the Notify buttons: student, teacher, admin or all.'], ['none', 'Don’t send any email', 'You can still use the Notify buttons later.']].map(function (o) {
        return '<label class="tickline"><input type="radio" name="scNtf" value="' + o[0] + '"' + (v === o[0] ? ' checked' : '') + '> <span><b>' + o[1] + '</b><small class="muted"> · ' + o[2] + '</small></span></label>';
      }).join('') + '</fieldset>';
  }
  function schSeriesChoice(x, verb) {
    if (!x || !x.series_id) return '';
    return '<fieldset class="field schseries"><legend class="flabel">This lesson repeats every week</legend>'
      + '<label class="tickline"><input type="radio" name="scScope" value="one" checked> <span><b>' + verb + ' only this lesson</b> · ' + esc(dayName(x.slot_date)) + ' ' + esc(dayShort(x.slot_date)) + '</span></label>'
      + '<label class="tickline"><input type="radio" name="scScope" value="all"> <span><b>' + verb + ' this and every later lesson</b> in the series</span></label></fieldset>';
  }
  var CHANGE_TAG = { rescheduled: 'Rescheduled', updated: 'Updated', reassigned: 'New teacher' };
  function schTags(x) { return (x.series_id ? '<span class="pill plain" title="Repeats every week">↻ Weekly</span>' : '') + (x.status === 'cancelled' ? '<span class="pill bad">Cancelled</span>' : CHANGE_TAG[x.change_kind] ? '<span class="pill warn">' + CHANGE_TAG[x.change_kind] + '</span>' : ''); }
  function openSch(id, edit, viewOnly) {
    var x = (S.sch.list || []).find(function (y) { return String(y.id) === String(id); }); if (!x) return;
    var s = studentById(x.student_id), nm = schName(x);
    if (!canPlan() || viewOnly) {
      openSheet('schView', { id: x.id }, head(dayName(x.slot_date) + ', ' + dayShort(x.slot_date), nm)
        + '<dl class="info panel"><div><dt>Date</dt><dd>' + esc(MZ.dateLabel(x.slot_date)) + '</dd></div><div><dt>Time</dt><dd>' + esc(x.start_time) + ' to ' + esc(x.end_time) + '</dd></div><div><dt>Teacher</dt><dd>' + esc(x.teacher_name) + '</dd></div>' + (x.note ? '<div><dt>Remarks</dt><dd>' + esc(x.note) + '</dd></div>' : '') + '<div><dt>Status</dt><dd>' + (x.status === 'cancelled' ? 'Cancelled' : 'Scheduled') + ' ' + schTags(x) + '</dd></div></dl>'
        + (canPlan() ? '<div class="btnrow"><button class="btn gold" data-act="schEdit" data-id="' + x.id + '">' + I.pen + 'Edit</button><button class="btn" data-act="schResched" data-id="' + x.id + '">Reschedule</button><button class="btn" data-act="schNotify" data-id="' + x.id + '">' + I.mail + 'Notify</button></div>' : '')
        + (!canPlan() && canMoveSlot(x) ? '<form class="form panel" id="hand1Form" data-id="' + x.id + '"><div class="field"><label for="h1T">Hand ' + esc(MZ.firstName(nm)) + ' over to</label><select id="h1T" required><option value="">Choose a free teacher</option>' + schTeacherList().filter(function (t) { return String(t.id) !== String(x.teacher_id); }).map(function (t) { var b = busyFor(t.id, x.slot_date, x.start_time, x.end_time, x.id); return '<option value="' + t.id + '"' + (b ? ' disabled' : '') + '>' + esc(t.full_name) + (b ? ' · busy then' : '') + '</option>'; }).join('') + '</select></div><button class="btn gold" type="submit">' + I.swap + 'Hand over</button></form>' : '')
        + (!canPlan() && !canMoveSlot(x) && role() === 'teacher' ? '<p class="hint">Need a change? Ask the admin; they can edit or reschedule the lesson and you will be told.</p>' : '')
        + (s && !isViewer() ? '<div class="btnrow"><button class="btn" data-act="student" data-id="' + esc(s.id) + '">Open ' + esc(MZ.firstName(nm)) + '’s page</button></div>' : ''));
      return;
    }
    openSheet('schEdit', { id: x.id }, head('Edit lesson', nm) + '<p class="schnow">' + I.pen + '<span>Now: <b>' + esc(nm) + '</b> with <b>' + esc(x.teacher_name) + '</b>, ' + esc(dayName(x.slot_date)) + ' ' + esc(dayShort(x.slot_date)) + ', ' + esc(x.start_time) + '–' + esc(x.end_time) + (x.status === 'cancelled' ? ' (cancelled)' : '') + ' ' + schTags(x) + '<br>Change anything below and press Save changes. The same lesson is updated; nothing is deleted.</span></p>'
      + schSlotForm(x) + schSeriesChoice(x, 'Change')
      + '<div class="schacts"><p class="flabel">Other actions</p><div class="btnrow"><button class="btn" data-act="schResched" data-id="' + x.id + '">Reschedule (date or time only)</button>'
      + (x.status === 'cancelled' ? '<button class="btn" data-act="schRestore" data-id="' + x.id + '">Restore this lesson</button>' : '<button class="btn" data-act="schCancel" data-id="' + x.id + '">Cancel this lesson</button>') + '<button class="btn danger" data-act="schDel" data-id="' + x.id + '">Delete</button></div>'
      + '<p class="hint">Cancel keeps the lesson in the history marked cancelled. Delete removes it for good (the history still records it).</p></div>'
      + '<div id="ntfBox" class="ntfbox"><p class="muted">Loading the email options…</p></div>'
      + '<details class="schhist" id="schHist"><summary>Change history</summary><p class="muted">Loading…</p></details>');
    if (canMove()) loadBusy(x.slot_date);
    loadNotifyBox(x.id); loadSchHistory(x.id);
  }
  function loadSchHistory(id) {
    if (!api.scheduleHistory) return;
    api.scheduleHistory(id).then(function (l) {
      var box = $('#schHist'); if (!box) return;
      var tn = function (d) { return d ? (d.teacher_name || teacherNameById(d.teacher_id)) : ''; }, desc = function (h) { var o = h.old_data || {}, n = h.new_data || {};
        if (h.action === 'created') return 'Created: ' + (n.slot_date || '') + ' ' + String(n.start_time || '').slice(0, 5) + ' with ' + tn(n);
        if (h.action === 'deleted') return 'Deleted';
        var parts = []; if (o.slot_date !== n.slot_date || o.start_time !== n.start_time || o.end_time !== n.end_time) parts.push((o.slot_date || '') + ' ' + String(o.start_time || '').slice(0, 5) + ' → ' + (n.slot_date || '') + ' ' + String(n.start_time || '').slice(0, 5) + '–' + String(n.end_time || '').slice(0, 5));
        if (String(o.teacher_id) !== String(n.teacher_id)) parts.push(tn(o) + ' → ' + tn(n)); if (o.student_id !== n.student_id) parts.push('student changed'); if ((o.note || '') !== (n.note || '')) parts.push('remarks changed'); if (o.status !== n.status) parts.push(n.status);
        return { cancelled: 'Cancelled', restored: 'Restored', reassigned: 'Reassigned', rescheduled: 'Rescheduled', edited: 'Edited' }[h.action] + (parts.length ? ': ' + parts.join(', ') : ''); };
      box.innerHTML = '<summary>Change history (' + l.length + ')</summary>' + (l.length ? '<ul class="histl">' + l.map(function (h) { return '<li><small class="muted">' + esc(String(h.changed_at || '').slice(0, 16).replace('T', ' ')) + '</small> ' + esc(desc(h)) + '</li>'; }).join('') + '</ul>' : '<p class="muted">No changes recorded yet.</p>');
    }).catch(function () { var box = $('#schHist'); if (box) box.hidden = true; });
  }
  /* ---- Notify buttons: student, teacher, admin or all, with what was sent ---- */
  var NTF_WHO = [['student', 'Student'], ['teacher', 'Teacher'], ['admin', 'Admin']];
  var NTF_SUBJ = { new: 'New Hifz Lesson Schedule', updated: 'Hifz Lesson Schedule Updated', rescheduled: 'Hifz Lesson Rescheduled', cancelled: 'Hifz Lesson Cancelled' };
  function openNotify(id) {
    var x = (S.sch.list || []).find(function (y) { return String(y.id) === String(id); }); if (!x || !canPlan()) return;
    openSheet('schNotify', { id: x.id }, head('Notify', schName(x)) + '<p class="schnow">' + I.mail + '<span>' + esc(dayName(x.slot_date)) + ' ' + esc(dayShort(x.slot_date)) + ', ' + esc(x.start_time) + '–' + esc(x.end_time) + ' with <b>' + esc(x.teacher_name) + '</b> ' + schTags(x) + '</span></p><div id="ntfBox" class="ntfbox"><p class="muted">Loading…</p></div>'
      + '<div class="btnrow"><button class="btn" data-act="schEdit" data-id="' + x.id + '">' + I.pen + 'Edit lesson</button></div>');
    loadNotifyBox(x.id);
  }
  function loadNotifyBox(id) {
    if (!api.scheduleNotifyPreview) return;
    Promise.all([api.scheduleNotifyPreview(id), api.listScheduleNotifications ? api.listScheduleNotifications([id]).catch(function () { return []; }) : []]).then(function (r) {
      S.ntf = S.ntf || {}; S.ntf[id] = { p: r[0], hist: r[1] || [], busy: {}, res: {} }; drawNotifyBox(id);
    }).catch(function (e) { var b = $('#ntfBox'); if (b) b.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }
  function drawNotifyBox(id) {
    var b = $('#ntfBox'), st = S.ntf && S.ntf[id]; if (!b || !st) return;
    var p = st.p, last = function (k) { return st.hist.filter(function (h) { return h.recipient_type === k; })[0] || null; };
    var status = function (k) {
      if (st.busy[k]) return '<span class="ntfst sending">Sending…</span>';
      var h = last(k); if (!h) return '<span class="ntfst">Not sent</span>';
      var when = String(h.created_at || '').slice(0, 16).replace('T', ' ');
      return h.status === 'sent' ? '<span class="ntfst ok">' + I.check + 'Sent ' + esc(when) + '</span>' : h.status === 'missing' ? '<span class="ntfst bad">No email address</span>' : '<span class="ntfst bad">Failed ' + esc(when) + '</span>';
    };
    var any = NTF_WHO.some(function (w) { return p[w[0]] && p[w[0]].email; });
    b.innerHTML = '<p class="flabel">Email about this lesson</p><p class="ntfsubj">Subject: <b>' + esc(NTF_SUBJ[p.kind] || NTF_SUBJ.new) + '</b> · uses the latest saved details</p>'
      + '<div class="ntfrows">' + NTF_WHO.map(function (w) {
        var r = p[w[0]] || {}, miss = !r.email;
        return '<div class="ntfrow' + (miss ? ' miss' : '') + '"><span class="ntfwho"><b>' + w[1] + '</b><small>' + esc(r.name || (w[0] === 'admin' ? 'Administrator' : '')) + ' · ' + (miss ? '<span class="bad">' + I.warn + (w[0] === 'admin' ? 'No admin email set (Settings → Schedule emails)' : 'No email address saved') + '</span>' : esc(r.email)) + '</small></span>'
          + status(w[0]) + '<button class="btn sm' + (miss ? '' : ' gold') + '" type="button" data-act="ntfSend" data-id="' + id + '" data-to="' + w[0] + '"' + (miss || st.busy[w[0]] ? ' disabled' : '') + '>' + I.mail + 'Notify ' + w[1] + '</button></div>';
      }).join('') + '</div>'
      + '<div class="btnrow"><button class="btn gold" type="button" data-act="ntfSend" data-id="' + id + '" data-to="all"' + (any && !Object.keys(st.busy).length ? '' : ' disabled') + '>' + I.mail + 'Notify All</button>' + (NTF_WHO.some(function (w) { return !(p[w[0]] && p[w[0]].email); }) && any ? '<small class="muted">People without an email address are skipped and listed.</small>' : '') + '</div>'
      + (st.msg ? '<p class="' + (st.msgBad ? 'err' : 'okmsg') + '" style="margin-top:8px">' + st.msg + '</p>' : '')
      + (st.hist.length ? '<details class="ntfhist"><summary>Sent history (' + st.hist.length + ')</summary><div class="tablewrap"><table class="grid"><thead><tr><th>When</th><th>To</th><th>Email</th><th>Type</th><th>Result</th></tr></thead><tbody>' + st.hist.map(function (h) { return '<tr><td>' + esc(String(h.created_at || '').slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(h.recipient_type) + ' · ' + esc(h.recipient_name || '') + '</td><td>' + esc(h.recipient_email || '—') + '</td><td>' + esc((h.manual ? 'Manual · ' : 'Automatic · ') + (h.kind || '')) + '</td><td>' + esc(h.status === 'sent' ? 'Sent' : h.status === 'missing' ? 'No email' : 'Failed' + (h.error ? ': ' + h.error : '')) + '</td></tr>'; }).join('') + '</tbody></table></div></details>' : '');
  }
  function ntfSend(btn) {
    var id = +btn.dataset.id, st = S.ntf && S.ntf[id]; if (!st) return;
    var to = btn.dataset.to === 'all' ? NTF_WHO.map(function (w) { return w[0]; }).filter(function (k) { return st.p[k] && st.p[k].email; }) : [btn.dataset.to];
    var skipped = btn.dataset.to === 'all' ? NTF_WHO.filter(function (w) { return !(st.p[w[0]] && st.p[w[0]].email); }).map(function (w) { return w[1]; }) : [];
    if (!to.length) return;
    // no unintended repeats: something already sent asks once more
    var again = to.filter(function (k) { var h = st.hist.filter(function (x) { return x.recipient_type === k; })[0]; return h && h.status === 'sent'; });
    var go = function () {
      to.forEach(function (k) { st.busy[k] = 1; }); st.msg = ''; drawNotifyBox(id);
      api.notifySchedule(id, to).then(function (r) {
        to.forEach(function (k) { delete st.busy[k]; });
        var res = (r && r.results) || [], okN = res.filter(function (x) { return x.sent; }), bad = res.filter(function (x) { return !x.sent; });
        st.msgBad = !!bad.length;
        st.msg = (r && r.demo ? '<b>Demo mode:</b> nothing is really sent. ' : '') + (okN.length ? 'Sent to ' + okN.map(function (x) { return esc(x.name || x.type) + ' (' + esc(x.email) + ')'; }).join(', ') + '. ' : '') + (bad.length ? 'Not sent: ' + bad.map(function (x) { return esc(x.name || x.type) + (x.missing ? ' (no email address)' : ' (' + esc(x.error || 'failed') + ')'); }).join(', ') + '. Press the button again to retry.' : '') + (skipped.length ? ' Skipped (no email address): ' + skipped.join(', ') + '.' : '');
        S.sch.notesKey = null; if (S.tab === 'schedule' && S.sch.mode === 'list' && !sheet) render();
        return api.listScheduleNotifications([id]).then(function (h) { st.hist = h || []; drawNotifyBox(id); });
      }).catch(function (e) {
        to.forEach(function (k) { delete st.busy[k]; }); st.msgBad = true;
        st.msg = esc(e.notDeployed ? 'Emails are not switched on: the “notify-teacher” function is not deployed in Supabase.' : e.message) + ' Nothing was sent. Press the button again to retry.'; drawNotifyBox(id);
      });
    };
    if (again.length && btn.dataset.armed !== '1') { MZ.arm(btn, go, 'Already sent. Tap again to resend'); return; }
    go();
  }
  /* ---- reschedule: date and time only, the same lesson record ---- */
  function openResched(id) {
    var x = (S.sch.list || []).find(function (y) { return String(y.id) === String(id); }); if (!x || !canPlan()) return;
    openSheet('schResched', { id: x.id }, head('Reschedule', schName(x)) + '<p class="schnow">' + I.pen + '<span>Now: ' + esc(dayName(x.slot_date)) + ' ' + esc(MZ.dateLabel(x.slot_date)) + ', ' + esc(x.start_time) + '–' + esc(x.end_time) + ' with <b>' + esc(x.teacher_name) + '</b>. Choose the new date and time; the same lesson moves.</span></p>'
      + '<form class="form" id="reschForm" autocomplete="off"><div class="three"><div class="field"><label for="rsDate">New date</label><input id="rsDate" type="date" required value="' + esc(x.slot_date) + '"></div><div class="field"><label for="rsFrom">From</label><input id="rsFrom" type="time" step="300" required value="' + esc(x.start_time) + '"></div><div class="field"><label for="rsTo">To</label><input id="rsTo" type="time" step="300" required value="' + esc(x.end_time) + '"></div></div>'
      + '<div class="durs" role="group" aria-label="Length">' + [15, 20, 30, 45, 60, 90].map(function (m) { return '<button type="button" class="chip" data-act="rsLen" data-m="' + m + '">' + m + ' min</button>'; }).join('') + '</div>'
      + schSeriesChoice(x, 'Move') + schNotifyChoice(x)
      + '<p class="err" id="rsErr" hidden></p><div class="btnrow"><button class="btn gold" type="submit" id="rsBtn">' + I.check + 'Save the new time</button><button class="btn ghost" type="button" data-act="close">Cancel</button></div></form>');
  }
  function saveResched() {
    var x = (S.sch.list || []).find(function (y) { return y.id === sheet.data.id; }), err = $('#rsErr'), btn = $('#rsBtn'); if (!x) return;
    var d = $('#rsDate').value, a = $('#rsFrom').value, b = $('#rsTo').value;
    if (!d || !a || !b) { err.textContent = 'Choose the date and the time.'; err.hidden = false; return; }
    if (tMin(b) <= tMin(a)) { err.textContent = 'The end time must be after the start time.'; err.hidden = false; return; }
    var scope = (document.querySelector('input[name=scScope]:checked') || {}).value || 'one', ntf = (document.querySelector('input[name=scNtf]:checked') || {}).value || 'auto';
    btn.disabled = true; err.hidden = true;
    var shift = Math.round((new Date(d + 'T12:00:00') - new Date(x.slot_date + 'T12:00:00')) / 864e5);
    var job = scope === 'all' ? api.updateScheduleSeries(x.id, { start_time: a, end_time: b, shift: shift }) : api.saveSchedule(Object.assign({}, x, { slot_date: d, start_time: a, end_time: b })).then(function (sv) { return [sv && sv.id || x.id]; });
    job.then(function (ids) { afterSchSave(ids, ntf, x.id, scope === 'all' ? (ids.length + ' lessons moved') : 'Lesson moved to ' + dayShort(d) + ', ' + a + '–' + b); })
      .catch(function (e) { btn.disabled = false; err.textContent = e.message; err.hidden = false; });
  }
  // after any save: refresh every view, then email as chosen
  function afterSchSave(ids, ntf, firstId, msg) {
    try { localStorage.setItem('qt_sch_notify', ntf); } catch (e) {}
    S.sch.busy = {}; S.sch.notes = null; S.sch.notesKey = null;
    loadSchedule(true);
    if (ntf === 'auto') { closeSheet(); tellTeachers(ids); MZ.toast(msg + '. The student and teacher(s) are being emailed.'); }
    else if (ntf === 'choose') { MZ.toast(msg + '. Choose who to email.'); setTimeout(function () { var go = function () { if ((S.sch.list || []).some(function (y) { return y.id === firstId; })) openNotify(firstId); else closeSheet(); }; if (S.sch.loading) setTimeout(go, 700); else go(); }, 450); }
    else { closeSheet(); MZ.toast(msg + '. No email was sent.'); }
  }
  function saveSch() {
    var err = $('#scErr'), btn = $('#scBtn'), edit = sheet.kind === 'schEdit', x = edit ? (S.sch.list || []).find(function (y) { return y.id === sheet.data.id; }) : null;
    var row = { student_id: $('#scStu').value, teacher_id: $('#scTch').value, start_time: $('#scFrom').value, end_time: $('#scTo').value, note: $('#scNote').value.trim() };
    var d = $('#scDate').value, ntf = (document.querySelector('input[name=scNtf]:checked') || {}).value || 'auto';
    if (!row.student_id || !row.teacher_id || !d || !row.start_time || !row.end_time) { err.textContent = 'Choose the student, the teacher, the date and the time.'; err.hidden = false; return; }
    if (tMin(row.end_time) <= tMin(row.start_time)) { err.textContent = 'The end time must be after the start time.'; err.hidden = false; return; }
    S.sch.lastTeacher = row.teacher_id; S.sch.lastFrom = row.start_time; S.sch.lastLen = tMin(row.end_time) - tMin(row.start_time); S.sch.lastNote = row.note;
    if (edit) {
      var scope = (document.querySelector('input[name=scScope]:checked') || {}).value || 'one';
      btn.disabled = true; err.hidden = true;
      var shift = Math.round((new Date(d + 'T12:00:00') - new Date(x.slot_date + 'T12:00:00')) / 864e5);
      var job = scope === 'all' && x.series_id ? api.updateScheduleSeries(x.id, Object.assign({}, row, { shift: shift })) : api.saveSchedule(Object.assign({ id: x.id, slot_date: d, status: x.status }, row)).then(function (sv) { return [sv && sv.id || x.id]; });
      job.then(function (ids) { afterSchSave(ids, ntf, x.id, scope === 'all' && x.series_id ? ids.length + ' lessons changed' : 'Saved'); })
        .catch(function (e) { btn.disabled = false; err.textContent = e.message; err.hidden = false; });
      return;
    }
    // new lessons: one date, several dates, or a weekly series
    var rep = (document.querySelector('input[name=scRep]:checked') || {}).value || 'one', days = [d], series = null;
    if (rep === 'dates') { days = (S.sch.pickDates || []).slice(); if (days.indexOf(d) < 0 && d) days.unshift(d); days.sort(); }
    if (rep === 'weekly') {
      var wds = MZ.$$('input[name=scWd]:checked').map(function (i) { return +i.value; }), until = $('#scUntil').value;
      if (!wds.length) { err.textContent = 'Tick at least one day of the week.'; err.hidden = false; return; }
      if (!until || until < d) { err.textContent = 'Choose an end date on or after the first date.'; err.hidden = false; return; }
      days = []; for (var dd = d; dd <= until && days.length < 200; dd = isoAdd(dd, 1)) if (wds.indexOf((new Date(dd + 'T12:00:00').getDay() + 6) % 7) >= 0) days.push(dd);
      series = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); });
    }
    if (!days.length) { err.textContent = 'Choose at least one date.'; err.hidden = false; return; }
    btn.disabled = true; err.hidden = true;
    var ok = 0, bad = [], i = 0, newIds = [];
    (function next() {
      if (i >= days.length) {
        btn.disabled = false;
        if (!ok) { err.innerHTML = 'Nothing saved:<br>' + bad.map(esc).join('<br>'); err.hidden = false; return; }
        if (bad.length) MZ.toast(bad.length + ' date' + (bad.length === 1 ? '' : 's') + ' skipped because of a clash: ' + bad.slice(0, 3).join('; '));
        afterSchSave(newIds, ntf, newIds[0], ok + ' lesson' + (ok === 1 ? '' : 's') + ' saved' + (series ? ' as a weekly series' : ''));
        S.sch.pickDates = [];
        return;
      }
      var day = days[i++];
      api.saveSchedule(Object.assign({ id: null, slot_date: day, status: 'scheduled', series_id: series }, row)).then(function (sv) { ok++; if (sv && sv.id) newIds.push(sv.id); }, function (e) { bad.push(dayShort(day) + ': ' + e.message); }).then(next);
    })();
  }
  /* ---- copy a day or a week to other dates (each copy can be edited afterwards) ---- */
  function openCopy() {
    if (!canPlan()) return;
    var mode = S.sch.mode === 'day' ? 'day' : 'week', r = schRange(), src = mode === 'day' ? S.sch.date : weekStart(S.sch.mode === 'list' ? r.from : S.sch.date);
    openSheet('schCopy', {}, head('Schedule', 'Copy a schedule') + '<form class="form" id="copyForm" autocomplete="off">'
      + '<fieldset class="field"><legend class="flabel">Copy</legend><label class="tickline"><input type="radio" name="cpKind" value="day"' + (mode === 'day' ? ' checked' : '') + '> <span><b>One day</b></span></label><label class="tickline"><input type="radio" name="cpKind" value="week"' + (mode === 'week' ? ' checked' : '') + '> <span><b>A whole week</b> (Monday to Sunday)</span></label></fieldset>'
      + '<div class="two"><div class="field"><label for="cpFrom">From (the day, or any day in the week)</label><input id="cpFrom" type="date" required value="' + esc(src) + '"></div><div class="field"><label for="cpTo">To (the first day to fill)</label><input id="cpTo" type="date" required value="' + esc(mode === 'day' ? isoAdd(src, 1) : isoAdd(weekStart(src), 7)) + '"></div></div>'
      + '<div class="field"><label for="cpTimes">How many times</label><select id="cpTimes">' + [1, 2, 3, 4, 6, 8, 12].map(function (n) { return '<option value="' + n + '">' + n + (n === 1 ? ' time' : ' times (one after the other)') + '</option>'; }).join('') + '</select><span class="hint">For a week: 4 times fills the next 4 weeks.</span></div>'
      + (S.sch.teacher ? '<p class="hint">Only ' + esc(S.sch.teacher === 'me' ? 'your' : teacherNameById(S.sch.teacher) + '’s') + ' lessons are copied (the teacher you chose).</p>' : '')
      + schNotifyChoice(null)
      + '<p class="err" id="cpErr" hidden></p><div class="btnrow"><button class="btn gold" type="submit" id="cpBtn">Copy</button><button class="btn ghost" type="button" data-act="close">Cancel</button></div></form>');
  }
  function saveCopy() {
    var kind = (document.querySelector('input[name=cpKind]:checked') || {}).value || 'week', from = $('#cpFrom').value, to = $('#cpTo').value, times = +$('#cpTimes').value || 1;
    var err = $('#cpErr'), btn = $('#cpBtn'), ntf = (document.querySelector('input[name=scNtf]:checked') || {}).value || 'auto', me = api.myUid ? api.myUid() : null, tf = S.sch.teacher;
    if (!from || !to) { err.textContent = 'Choose both dates.'; err.hidden = false; return; }
    var a = kind === 'day' ? from : weekStart(from), b = kind === 'day' ? from : isoAdd(a, 6), t0 = kind === 'day' ? to : weekStart(to), step = kind === 'day' ? 1 : 7;
    if (t0 <= b && t0 >= a) { err.textContent = 'Choose a target outside the dates being copied.'; err.hidden = false; return; }
    btn.disabled = true; err.hidden = true;
    api.listSchedules({ from: a, to: b }).then(function (l) {
      var src = l.filter(function (x) { return x.status === 'scheduled' && (!tf || (tf === 'me' ? x.teacher_user === me : String(x.teacher_id) === tf)); });
      if (!src.length) { btn.disabled = false; err.textContent = 'There is nothing scheduled to copy on those dates.'; err.hidden = false; return; }
      var jobs = [], off0 = Math.round((new Date(t0 + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
      for (var k = 0; k < times; k++) src.forEach(function (x) { jobs.push({ x: x, d: isoAdd(x.slot_date, off0 + k * step) }); });
      var ok = 0, bad = [], ids = [], i = 0;
      (function next() {
        if (i >= jobs.length) {
          btn.disabled = false; S.sch.date = t0; if (S.sch.mode === 'list') { S.sch.rFrom = t0; S.sch.rTo = isoAdd(t0, (kind === 'day' ? 1 : 7) * times - 1); }
          if (!ok) { err.innerHTML = 'Nothing copied:<br>' + bad.slice(0, 8).map(esc).join('<br>'); err.hidden = false; return; }
          afterSchSave(ids, ntf, ids[0], ok + ' lesson' + (ok === 1 ? '' : 's') + ' copied' + (bad.length ? ' (' + bad.length + ' skipped because of a clash)' : ''));
          return;
        }
        var j = jobs[i++];
        api.saveSchedule({ student_id: j.x.student_id, teacher_id: j.x.teacher_id, slot_date: j.d, start_time: j.x.start_time, end_time: j.x.end_time, note: j.x.note }).then(function (sv) { ok++; if (sv && sv.id) ids.push(sv.id); }, function (e) { bad.push(dayShort(j.d) + ': ' + e.message); }).then(next);
      })();
    }).catch(function (e) { btn.disabled = false; err.textContent = e.message; err.hidden = false; });
  }
  /* ---- list: every lesson in the dates, searchable, with actions on each row ---- */
  function schListHTML(all, r, plan, me) {
    var q = (S.sch.q || '').toLowerCase(), stuF = S.sch.stu || '', stF = S.sch.st || 'all';
    var stuOpts = {}; (S.sch.list || []).forEach(function (x) { stuOpts[x.student_id] = schName(x); });
    var rows = all.filter(function (x) { return (!stuF || x.student_id === stuF) && (stF === 'all' || x.status === stF); }).sort(function (a, b) { return (a.slot_date + a.start_time) < (b.slot_date + b.start_time) ? -1 : 1; });
    // what was emailed (latest per lesson and person)
    var ids = rows.map(function (x) { return x.id; }), nk = ids.join(',');
    if (plan && api.listScheduleNotifications && S.sch.notesKey !== nk) { S.sch.notesKey = nk; api.listScheduleNotifications(ids).then(function (l) { S.sch.notes = l || []; if (S.tab === 'schedule' && S.sch.mode === 'list') render(); }).catch(function () { S.sch.notes = []; }); }
    var notes = S.sch.notes || [], mailCell = function (x) { var mine = notes.filter(function (n) { return n.schedule_id === x.id; }); if (!mine.length) return '<span class="muted">Not sent</span>';
      return ['student', 'teacher', 'admin'].map(function (k) { var n = mine.filter(function (m) { return m.recipient_type === k; })[0]; return n ? '<span class="mailtag ' + n.status + '" title="' + esc(k + ': ' + n.status + ' ' + String(n.created_at || '').slice(0, 16).replace('T', ' ')) + '">' + k.charAt(0).toUpperCase() + (n.status === 'sent' ? '✓' : '!') + '</span>' : ''; }).join(''); };
    var h = '<div class="schfilters"><input id="schQ" class="input" type="search" placeholder="Search student, teacher or remarks" value="' + esc(S.sch.q || '') + '" aria-label="Search">'
      + '<select id="schStuF" aria-label="Student"><option value="">All students</option>' + Object.keys(stuOpts).sort(function (a, b) { return stuOpts[a].localeCompare(stuOpts[b]); }).map(function (k) { return '<option value="' + esc(k) + '"' + (stuF === k ? ' selected' : '') + '>' + esc(stuOpts[k]) + '</option>'; }).join('') + '</select>'
      + '<select id="schStF" aria-label="Status">' + [['all', 'Any status'], ['scheduled', 'Scheduled'], ['cancelled', 'Cancelled']].map(function (o) { return '<option value="' + o[0] + '"' + (stF === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'
      + '<span class="muted" id="schCount">' + plural(rows.length, 'lesson') + '</span></div>';
    if (!rows.length) return h + '<div class="empty"><h3>No lessons in these dates</h3><p>' + (plan ? 'Pick other dates, or allocate students for any date with the button above.' : 'Pick other dates above.') + '</p></div>';
    return h + '<div class="tablewrap"><table class="grid schlist"><thead><tr><th>Date</th><th>Time</th><th>Student</th><th>Teacher</th><th>Remarks</th><th>Status</th>' + (plan ? '<th>Emails</th>' : '') + '<th></th></tr></thead><tbody>'
      + rows.map(function (x) {
        var hay = (schName(x) + ' ' + x.teacher_name + ' ' + (x.note || '')).toLowerCase();
        return '<tr data-hay="' + esc(hay) + '"' + (q && hay.indexOf(q) < 0 ? ' hidden' : '') + ' class="' + (x.status === 'cancelled' ? 'off' : '') + (x.slot_date < MZ.today() ? ' past' : '') + '"><td class="nowrap">' + esc(DOW[(new Date(x.slot_date + 'T12:00:00').getDay() + 6) % 7]) + ' ' + esc(dayShort(x.slot_date)) + '</td><td class="num nowrap">' + esc(x.start_time) + '–' + esc(x.end_time) + '</td><td><b>' + esc(schName(x)) + '</b></td><td>' + esc(x.teacher_name) + '</td><td>' + esc(x.note || '') + '</td><td>' + (x.status === 'cancelled' ? '<span class="pill bad">Cancelled</span>' : '<span class="pill good">Scheduled</span>') + ' ' + (x.status !== 'cancelled' ? schTags(x).replace('<span class="pill bad">Cancelled</span>', '') : (x.series_id ? '<span class="pill plain">↻ Weekly</span>' : '')) + '</td>'
          + (plan ? '<td class="nowrap">' + mailCell(x) + '</td>' : '')
          + '<td class="rowacts"><div class="ra">' + (plan ? '<button class="btn sm" data-act="schEdit" data-id="' + x.id + '">' + I.pen + 'Edit</button><button class="btn sm" data-act="schResched" data-id="' + x.id + '">Reschedule</button><button class="btn sm" data-act="schNotify" data-id="' + x.id + '">' + I.mail + 'Notify</button>'
            + (x.status === 'cancelled' ? '<button class="btn sm" data-act="schRestore" data-id="' + x.id + '">Restore</button>' : '<button class="btn sm" data-act="schCancel" data-id="' + x.id + '">Cancel</button>') + '<button class="btn sm danger" data-act="schDel" data-id="' + x.id + '">Delete</button>'
            : '<button class="btn sm" data-act="schView" data-id="' + x.id + '">View</button>') + '</div></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'schQ') return;
    S.sch.q = e.target.value; var q = S.sch.q.toLowerCase(), n = 0;
    MZ.$$('.schlist tbody tr').forEach(function (tr) { var show = !q || tr.dataset.hay.indexOf(q) >= 0; tr.hidden = !show; if (show) n++; });
    var c = $('#schCount'); if (c) c.textContent = plural(n, 'lesson');
  });
  // several dates: add and remove
  function drawPickDates() { var c = $('#scDateChips'); if (!c) return; c.innerHTML = (S.sch.pickDates || []).map(function (d) { return '<span class="pill">' + esc(dayName(d).slice(0, 3)) + ' ' + esc(dayShort(d)) + ' <button type="button" class="linkbtn" data-act="schDropDate" data-d="' + d + '" aria-label="Remove ' + esc(d) + '">×</button></span>'; }).join('') || '<small class="muted">No extra dates yet. The date above is included.</small>'; }
  document.addEventListener('change', function (e) {
    if (e.target.name === 'scRep') { var v = e.target.value, a = $('#scDates'), w = $('#scWeekly'); if (a) a.hidden = v !== 'dates'; if (w) w.hidden = v !== 'weekly'; if (v === 'dates') { S.sch.pickDates = S.sch.pickDates || []; drawPickDates(); } }
  });
  /* teachers: a count on the tab and a notice when students are allocated to them */
  function updateSchBadge() {
    var b = document.querySelector('.tab[data-tab=schedule]'); if (!b) return;
    var n = S.schUnseen || 0; b.innerHTML = 'Schedule' + (n ? '<span class="tabbadge" aria-label="' + n + ' new">' + n + '</span>' : '');
  }
  function checkMySchedule(first) {
    if (!(role() === 'teacher') || !api.listSchedules) return;
    var me = api.myUid ? api.myUid() : null; if (!me) return;
    api.listSchedules({ from: MZ.today(), to: isoAdd(MZ.today(), 21) }).then(function (l) {
      var fresh = l.filter(function (x) { return x.teacher_user === me && !x.teacher_seen_at && x.status === 'scheduled'; }), canc = l.filter(function (x) { return x.teacher_user === me && !x.teacher_seen_at && x.status === 'cancelled'; });
      var before = S.schUnseen || 0; S.schUnseen = fresh.length + canc.length; updateSchBadge();
      if (S.schUnseen && (first || S.schUnseen > before) && S.tab !== 'schedule') {
        var f = fresh[0], s = f && studentById(f.student_id);
        MZ.toast((fresh.length ? (fresh.length === 1 && s ? s.full_name + ' is allocated to you: ' + dayName(f.slot_date) + ', ' + dayShort(f.slot_date) + ' at ' + f.start_time + '.' : fresh.length + ' new or changed slots for you.') : '') + (canc.length ? ' ' + canc.length + ' slot' + (canc.length === 1 ? ' was' : 's were') + ' cancelled.' : ''), { label: 'Open', fn: function () { S.tab = 'schedule'; S.sch.teacher = 'me'; render(); } });
      }
    }).catch(function () {});
  }

  /* Students' ratings of teachers: averages and anonymous comments. */
  /* ---- Teacher feedback (HR): students' anonymous feedback + the institute's own ratings, by teacher and period ---- */
  S.fbP = 'month'; S.fbT = '';
  function fbRange() {
    var m = S.month, y = m.slice(0, 4);
    if (S.fbP === '3') return { from: MZ.addMonths(m, -2), to: m, label: MZ.monthShort(MZ.addMonths(m, -2)) + ' – ' + MZ.monthLabel(m) };
    if (S.fbP === '6') return { from: MZ.addMonths(m, -5), to: m, label: MZ.monthShort(MZ.addMonths(m, -5)) + ' – ' + MZ.monthLabel(m) };
    if (S.fbP === 'year') return { from: y + '-01', to: y + '-12', label: 'All of ' + y };
    if (S.fbP === 'custom') { var f = S.fbFrom || MZ.addMonths(m, -2), t = S.fbTo || m; if (f > t) { var x = f; f = t; t = x; } return { from: f, to: t, label: MZ.monthLabel(f) + ' – ' + MZ.monthLabel(t) }; }
    return { from: m, to: m, label: MZ.monthLabel(m) };
  }
  function fbLoad(r) {
    var key = r.from + '|' + r.to;
    if (S.fbKey !== key && S.fbLoading !== key) { S.fbLoading = key; api.teacherFeedback(r.from, r.to).then(function (l) { S.fb = l; S.fbKey = key; S.fbLoading = null; render(); if (sheet && sheet.kind === 'tProfile') openTeacherProfile(sheet.data.id); }).catch(function (e) { S.fbLoading = null; S.fb = []; S.fbKey = key; MZ.toast(e.message); }); }
    return S.fbKey === key;
  }
  // everything known about one teacher in the period
  function fbStats(tid, r) {
    var st = { n: 0, sums: {}, comments: [], months: {} }, inst = { n: 0, sums: {}, comments: [], months: {} };
    (S.fb || []).forEach(function (x) {
      if (String(x.teacher_id) !== String(tid)) return;
      st.n += x.responses; MZ.TEACHER_CRITERIA.forEach(function (c) { st.sums[c[0]] = (st.sums[c[0]] || 0) + (+x.avg_scores[c[0]] || 0) * x.responses; });
      (x.comments || []).forEach(function (c) { st.comments.push({ month: x.month, text: c }); });
      st.months[x.month] = { n: x.responses, avg: MZ.scoreAvg(x.avg_scores) };
    });
    hrList('teacher_rating').forEach(function (x) {
      var d = x.data; if (String(d.teacher_id) !== String(tid) || !d.month || d.month < r.from || d.month > r.to) return;
      inst.n++; MZ.TEACHER_CRITERIA.forEach(function (c) { inst.sums[c[0]] = (inst.sums[c[0]] || 0) + (+d[c[0]] || 0); });
      if (d.comment) inst.comments.push({ month: d.month, text: d.comment });
      inst.months[d.month] = { n: 1, avg: MZ.scoreAvg(d) };
    });
    [st, inst].forEach(function (g) { g.av = null; if (g.n) { g.av = {}; MZ.TEACHER_CRITERIA.forEach(function (c) { g.av[c[0]] = g.sums[c[0]] / g.n; }); g.overall = MZ.scoreAvg(g.av); } });
    // the main view: what students said; the institute's ratings when no student has given feedback
    var main = st.n ? st : inst.n ? inst : null, out = { st: st, inst: inst, main: main, src: st.n ? 'students' : inst.n ? 'institute' : '' };
    if (!main) { out.status = 'none'; return out; }
    var crit = MZ.TEACHER_CRITERIA.map(function (c) { return { k: c[0], name: c[1], v: main.av[c[0]] }; });
    out.improve = crit.filter(function (c) { return c.v < 3.5; }).sort(function (a, b) { return a.v - b.v; });
    out.strengths = crit.filter(function (c) { return c.v >= 4.5; });
    var lowest = crit.slice().sort(function (a, b) { return a.v - b.v; })[0];
    if (!out.improve.length && lowest.v < 4) out.watch = lowest;
    var mo = Object.keys(main.months).sort(), allGood = mo.every(function (k) { return main.months[k].avg >= 4; }), lowMonths = mo.filter(function (k) { return main.months[k].avg < 3.5; }).length;
    out.monthsN = mo.length;
    out.status = main.overall < 3.5 || crit.some(function (c) { return c.v < 3; }) || lowMonths >= 2 ? 'support'
      : main.overall >= 4.2 && crit.every(function (c) { return c.v >= 4; }) && allGood ? (mo.length >= 2 ? 'positive' : 'good') : main.overall >= 4 ? 'good' : 'watch';
    return out;
  }
  var FB_STATUS = { positive: ['Consistently positive', 'good'], good: ['Doing well', 'good'], watch: ['Mixed: keep an eye', 'warn'], support: ['May need support or training', 'bad'], none: ['No feedback yet', 'plain'] };
  function fbStatusPill(x) { var k = FB_STATUS[x.status]; return '<span class="pill ' + k[1] + '">' + esc(k[0]) + '</span>'; }
  function fbBars(av, other) {
    return '<div class="crit">' + MZ.TEACHER_CRITERIA.map(function (c) {
      var v = av ? av[c[0]] : null, o = other ? other[c[0]] : null;
      return '<div class="critrow"><span title="' + esc(MZ.TEACHER_CRITERIA_DESC[c[0]]) + '">' + esc(c[1]) + '<small class="critdesc">' + esc(MZ.TEACHER_CRITERIA_DESC[c[0]]) + '</small></span><span class="cbar">' + (v != null ? '<i class="' + (v < 3 ? 'low' : v < 4 ? 'mid' : '') + '" style="width:' + (v / 5 * 100).toFixed(0) + '%"></i>' : '') + '</span><b class="num">' + (v != null ? v.toFixed(1) : '–') + '</b>'
        + (other !== undefined ? '<b class="num fb-inst" title="The institute’s rating">' + (o != null ? o.toFixed(1) : '–') + '</b>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function teacherProfileHTML(t, r) {
    var x = fbStats(t.id, r), st = x.st, inst = x.inst, d = t.data;
    var h = '<div class="tprof"><div class="tp-head"><div><b class="tp-name">' + esc(d.full_name) + '</b><small>' + esc([d.role, d.status || 'Active', r.label].filter(Boolean).join(' · ')) + '</small></div>' + fbStatusPill(x) + '</div>';
    if (x.status === 'none') return h + '<p class="muted">No feedback for ' + esc(r.label) + '. Students can give feedback from their portal (Teachers), and the institute can add a rating under HR → Teacher ratings.</p></div>';
    h += '<div class="cards4 tp-cards"><div class="stat4"><span>Students’ overall</span><b class="num">' + (st.n ? st.overall.toFixed(1) : '–') + '</b><small>' + (st.n ? plural(st.n, 'response') + ' · anonymous' : 'no feedback yet') + '</small></div>'
      + '<div class="stat4"><span>Institute’s overall</span><b class="num">' + (inst.n ? inst.overall.toFixed(1) : '–') + '</b><small>' + (inst.n ? plural(inst.n, 'rating') : 'not rated yet') + '</small></div>'
      + '<div class="stat4 ' + (x.improve && x.improve.length ? 'bad' : 'good') + '"><span>To improve</span><b class="num">' + (x.improve ? x.improve.length : 0) + '</b><small>categories below 3.5</small></div>'
      + '<div class="stat4 good"><span>Strengths</span><b class="num">' + (x.strengths ? x.strengths.length : 0) + '</b><small>categories 4.5 or more</small></div></div>';
    h += '<p class="flabel">Average for each category <span class="muted fb-legend">· students' + (inst.n ? ' · <b class="fb-inst">institute</b>' : '') + '</span></p>' + fbBars(st.n ? st.av : null, inst.n ? inst.av : undefined);
    if (x.improve && x.improve.length) h += '<div class="fbnote bad"><b>Areas needing improvement</b><ul>' + x.improve.map(function (c) { return '<li><b>' + esc(c.name) + '</b> (' + c.v.toFixed(1) + '): ' + esc(MZ.TEACHER_CRITERIA_DESC[c.k]) + '</li>'; }).join('') + '</ul></div>';
    else if (x.watch) h += '<div class="fbnote warn"><b>Could improve</b><p>' + esc(x.watch.name) + ' (' + x.watch.v.toFixed(1) + ') is the lowest category.</p></div>';
    if (x.strengths && x.strengths.length) h += '<div class="fbnote good"><b>Strengths</b><p>' + x.strengths.map(function (c) { return esc(c.name) + ' (' + c.v.toFixed(1) + ')'; }).join(', ') + '</p></div>';
    // month by month
    var months = Object.keys(Object.assign({}, st.months, inst.months)).sort();
    if (months.length > 1) h += '<p class="flabel">Month by month</p><div class="tablewrap"><table class="grid"><thead><tr><th>Month</th><th class="r">Students</th><th class="r">Responses</th><th class="r">Institute</th></tr></thead><tbody>' + months.map(function (k) {
      var a = st.months[k], b = inst.months[k]; return '<tr><td>' + esc(MZ.monthLabel(k)) + '</td><td class="r">' + (a ? scoreChip(a.avg.toFixed(1)) : '–') + '</td><td class="r">' + (a ? a.n : '–') + '</td><td class="r">' + (b ? scoreChip(b.avg.toFixed(1)) : '–') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    var cm = st.comments.map(function (c) { return '<p><span class="pill plain">' + esc(MZ.monthShort(c.month)) + '</span> “' + esc(c.text) + '”</p>'; }).join('');
    var ci = inst.comments.map(function (c) { return '<p><span class="pill gold">' + esc(MZ.monthShort(c.month)) + '</span> ' + esc(c.text) + '</p>'; }).join('');
    h += '<p class="flabel">Written comments</p>' + (cm || ci ? (cm ? '<div class="fbcomments"><small class="muted">From students (names are never shown)</small>' + cm + '</div>' : '') + (ci ? '<div class="fbcomments"><small class="muted">From the institute’s ratings</small>' + ci + '</div>' : '') : '<p class="muted">No written comments in this period.</p>');
    return h + '</div>';
  }
  function openTeacherProfile(tid) {
    var t = hrById(tid); if (!t) return;
    var r = fbRange(), ok = fbLoad(r);
    openSheet('tProfile', { id: tid }, head('Teacher feedback', t.data.full_name) + fbToolbarHTML(true) + (ok ? teacherProfileHTML(t, r) : '<p class="muted">Loading…</p>') + critGuideHTML(false));
  }
  function fbToolbarHTML(inSheet) {
    var r = fbRange(), P = [['month', 'Month'], ['3', 'Last 3 months'], ['6', 'Last 6 months'], ['year', 'Whole year'], ['custom', 'Choose months']];
    return '<div class="fbbar">' + (inSheet ? '' : '<label class="pgmsel"><span class="sr">Teacher</span><select id="fbTeacher" aria-label="Teacher"><option value="">All teachers</option>' + teachers(false).map(function (t) { return '<option value="' + t.id + '"' + (String(S.fbT) === String(t.id) ? ' selected' : '') + '>' + esc(t.data.full_name) + (t.data.status === 'Left' ? ' (left)' : '') + '</option>'; }).join('') + '</select></label>')
      + '<div class="seg" role="group" aria-label="Reporting period">' + P.map(function (p) { return '<button class="chip" type="button" data-act="fbPeriod" data-p="' + p[0] + '" aria-pressed="' + (S.fbP === p[0]) + '">' + p[1] + '</button>'; }).join('') + '</div>'
      + (S.fbP === 'custom' ? '<span class="fbrange"><input type="month" id="fbFrom" value="' + esc(r.from) + '" aria-label="From"><span>to</span><input type="month" id="fbTo" value="' + esc(r.to) + '" aria-label="To"></span>'
        : S.fbP !== 'year' ? '<span class="monthnav"><button class="iconbtn" data-act="prevMonth" aria-label="Previous month">' + I.left + '</button><b class="fblabel">' + esc(r.label) + '</b><button class="iconbtn" data-act="nextMonth" aria-label="Next month">' + I.right + '</button></span>'
        : '<span class="monthnav"><button class="iconbtn" data-act="fbYear" data-d="-1" aria-label="Previous year">' + I.left + '</button><b class="fblabel">' + esc(r.label) + '</b><button class="iconbtn" data-act="fbYear" data-d="1" aria-label="Next year">' + I.right + '</button></span>') + '</div>';
  }
  function renderFeedback() {
    var r = fbRange(), ok = fbLoad(r);
    var h = '<div class="pagehead"><div><p class="eyebrow">HR</p><h1>Teacher feedback</h1><p class="stat">What students say about each teacher (anonymous, 1 to 5) and the institute’s own ratings. Choose a teacher and a period.</p></div></div>' + fbToolbarHTML(false);
    if (!ok) return h + '<p class="muted" style="margin-top:14px">Loading…</p>';
    var list = teachers(false).filter(function (t) { return t.data.status !== 'Left' || (S.fb || []).some(function (x) { return String(x.teacher_id) === String(t.id); }); });
    if (!list.length) return h + '<div class="empty"><p>Add your teachers first under HR → Teachers. Students can then give feedback from their portal.</p></div>';
    if (S.fbT) { var one = hrById(S.fbT); if (one) return h + '<section class="card" style="margin-top:14px">' + teacherProfileHTML(one, r) + '</section>' + critGuideHTML(false); }
    var rows = list.map(function (t) { return { t: t, x: fbStats(t.id, r) }; });
    var withFb = rows.filter(function (y) { return y.x.status !== 'none'; }), pos = rows.filter(function (y) { return y.x.status === 'positive' || y.x.status === 'good'; }), sup = rows.filter(function (y) { return y.x.status === 'support' || y.x.status === 'watch'; });
    var resp = rows.reduce(function (a, y) { return a + y.x.st.n; }, 0);
    h += '<div class="cards4"><div class="stat4"><span>Teachers with feedback</span><b class="num">' + withFb.length + '</b><small>of ' + list.length + '</small></div><div class="stat4"><span>Student responses</span><b class="num">' + resp + '</b><small>' + esc(r.label) + '</small></div>'
      + '<div class="stat4 good"><span>Doing well</span><b class="num">' + pos.length + '</b><small>' + rows.filter(function (y) { return y.x.status === 'positive'; }).length + ' consistently positive</small></div>'
      + '<div class="stat4 ' + (sup.length ? 'bad' : 'good') + '"><span>Need attention</span><b class="num">' + sup.length + '</b><small>support, training or watch</small></div></div>';
    var name = function (y) { return '<button class="linkbtn" type="button" data-act="tProfile" data-id="' + y.t.id + '">' + esc(y.t.data.full_name) + '</button>'; };
    if (pos.length || sup.length) h += '<div class="fbsplit">'
      + '<section class="fbnote good"><b>Consistently positive and doing well</b>' + (pos.length ? '<ul>' + pos.sort(function (a, b) { return b.x.main.overall - a.x.main.overall; }).map(function (y) { return '<li>' + name(y) + ' · ' + y.x.main.overall.toFixed(1) + (y.x.status === 'positive' ? ' · every month 4+' : '') + (y.x.strengths.length ? ' · strong in ' + esc(y.x.strengths.map(function (c) { return c.name; }).slice(0, 2).join(', ')) : '') + '</li>'; }).join('') + '</ul>' : '<p class="muted">No one yet in this period.</p>') + '</section>'
      + '<section class="fbnote ' + (sup.length ? 'bad' : 'good') + '"><b>May need support or training</b>' + (sup.length ? '<ul>' + sup.sort(function (a, b) { return a.x.main.overall - b.x.main.overall; }).map(function (y) { return '<li>' + name(y) + ' · ' + y.x.main.overall.toFixed(1) + (y.x.improve.length ? ' · improve ' + esc(y.x.improve.map(function (c) { return c.name + ' (' + c.v.toFixed(1) + ')'; }).join(', ')) : y.x.watch ? ' · lowest: ' + esc(y.x.watch.name) + ' (' + y.x.watch.v.toFixed(1) + ')' : '') + '</li>'; }).join('') + '</ul>' : '<p class="muted">Nobody needs extra support in this period.</p>') + '</section></div>';
    h += '<div class="tablewrap" style="margin-top:14px"><table class="grid fbtable"><thead><tr><th>Teacher</th><th class="r">Responses</th>' + MZ.TEACHER_CRITERIA.map(function (c) { return '<th class="r" title="' + esc(c[1] + ': ' + MZ.TEACHER_CRITERIA_DESC[c[0]]) + '">' + esc(CRIT_SHORT[c[0]]) + '</th>'; }).join('') + '<th class="r">Overall</th><th>Status</th><th></th></tr></thead><tbody>'
      + rows.sort(function (a, b) { return (b.x.main ? b.x.main.overall : -1) - (a.x.main ? a.x.main.overall : -1) || a.t.data.full_name.localeCompare(b.t.data.full_name); }).map(function (y) {
        var m = y.x.main;
        return '<tr><td><b>' + esc(y.t.data.full_name) + '</b><br><small class="muted">' + esc(y.t.data.role || '') + (y.x.src === 'institute' ? ' · institute rating only' : '') + '</small></td><td class="r num">' + (y.x.st.n || '–') + '</td>'
          + MZ.TEACHER_CRITERIA.map(function (c) { return '<td class="r">' + (m ? scoreChip(m.av[c[0]].toFixed(1)) : '<span class="muted">—</span>') + '</td>'; }).join('')
          + '<td class="r">' + (m ? '<b class="num">' + m.overall.toFixed(1) + '</b>' : '—') + '</td><td>' + fbStatusPill(y.x) + '</td><td class="r"><button class="btn sm" data-act="tProfile" data-id="' + y.t.id + '">View profile</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    return h + critGuideHTML(false);
  }

  /* Attendance register: one date at a time. */
  function renderAttendance() {
    var date = S.attDate, list = teachers(true), m = date.slice(0, 7);
    var recs = hrList('attendance'), byT = {};
    recs.forEach(function (r) { if (r.data.date === date) byT[r.data.teacher_id] = r; });
    var onLeave = {}; hrList('leave').forEach(function (r) { if (r.data.status === 'Approved' && r.data.from_date <= date && (r.data.to_date || r.data.from_date) >= date) onLeave[r.data.teacher_id] = 1; });
    var h = '<div class="pagehead"><div><p class="eyebrow">HR</p><h1>Attendance</h1><p class="stat">Mark each teacher for the day, then save.</p></div>'
      + '<div class="btnrow"><button class="iconbtn" data-act="attDay" data-d="-1" aria-label="Previous day">' + I.left + '</button><input type="date" id="attDate" class="input" style="width:auto" value="' + esc(date) + '"><button class="iconbtn" data-act="attDay" data-d="1" aria-label="Next day">' + I.right + '</button>'
      + (date !== MZ.today() ? '<button class="btn sm" data-act="attToday">Today</button>' : '') + '</div></div>';
    if (!list.length) return h + '<div class="empty"><p>Add your teachers first under HR → Teachers.</p></div>';
    var ST = ['Present', 'Absent', 'Late', 'Leave'];
    h += '<form id="attForm" autocomplete="off"><div class="list" style="margin-top:14px">' + list.map(function (t) {
      var r = byT[t.id], cur = r ? r.data.status : (onLeave[t.id] ? 'Leave' : '');
      return '<div class="attrow" data-t="' + t.id + '"><span class="pname"><b>' + esc(t.data.full_name) + '</b><small>' + esc(t.data.role || '') + (onLeave[t.id] ? ' · on approved leave' : '') + (r ? '' : ' · not marked yet') + '</small></span>'
        + '<span class="seg" role="radiogroup" aria-label="Attendance for ' + esc(t.data.full_name) + '">' + ST.map(function (s) {
          var id = 'att_' + t.id + '_' + s; return '<input type="radio" name="att_' + t.id + '" id="' + id + '" value="' + s + '"' + (cur === s ? ' checked' : '') + '><label for="' + id + '" class="s-' + s.toLowerCase() + '">' + s + '</label>';
        }).join('') + '</span><input class="input attnote" name="note_' + t.id + '" maxlength="100" placeholder="Note" value="' + esc(r ? r.data.note || '' : '') + '" aria-label="Note"></div>';
    }).join('') + '</div><div class="btnrow" style="margin-top:12px"><button class="btn gold" type="submit" id="attBtn">Save attendance for ' + esc(MZ.dateLabel(date)) + '</button><button class="btn" type="button" data-act="attAll">Mark everyone present</button></div></form>';
    // monthly summary
    h += '<section class="card" style="margin-top:18px"><h3 style="font-family:var(--font-display);font-size:22px;margin-bottom:8px">' + esc(MZ.monthLabel(m)) + ' summary</h3><div class="tablewrap"><table class="grid"><thead><tr><th>Teacher</th>' + ST.map(function (s) { return '<th class="r">' + s + '</th>'; }).join('') + '</tr></thead><tbody>'
      + list.map(function (t) {
        var c = { Present: 0, Absent: 0, Late: 0, Leave: 0 }; recs.forEach(function (r) { if (r.data.teacher_id === t.id && (r.data.date || '').slice(0, 7) === m && c[r.data.status] != null) c[r.data.status]++; });
        return '<tr><td>' + esc(t.data.full_name) + '</td>' + ST.map(function (s) { return '<td class="r' + (s === 'Absent' && c[s] ? ' neg' : '') + '">' + c[s] + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></section>';
    return h;
  }
  function saveAttendance() {
    var date = S.attDate, jobs = [];
    MZ.$$('.attrow').forEach(function (row) {
      var tid = +row.dataset.t || row.dataset.t, c = row.querySelector('input[type=radio]:checked'), note = row.querySelector('.attnote').value.trim();
      if (!c) return;
      var ex = hrList('attendance').find(function (r) { return String(r.data.teacher_id) === String(tid) && r.data.date === date; });
      if (ex && ex.data.status === c.value && (ex.data.note || '') === note) return;
      jobs.push({ id: ex ? ex.id : null, kind: 'attendance', data: { teacher_id: tid, date: date, status: c.value, note: note } });
    });
    if (!jobs.length) { MZ.toast('Nothing new to save.'); return; }
    var btn = $('#attBtn'); btn.disabled = true; var n = 0;
    (function next() {
      if (!jobs.length) { render(); MZ.toast('Attendance saved for ' + n + ' teacher' + (n === 1 ? '' : 's') + '.'); return; }
      api.saveHR(jobs.shift()).then(function (row) { S.hr = S.hr.filter(function (x) { return x.id !== row.id; }).concat([row]); n++; next(); }).catch(function (e) { MZ.toast(e.message); btn.disabled = false; });
    })();
  }

  function exportAccounts() {
    if (!needXLSX()) return;
    var t = totals(), cur = S.settings.currency, wb = XLSX.utils.book_new();
    function add(name, rows) { var ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'Nothing recorded' }]); ws['!cols'] = Object.keys(rows[0] || { Note: '' }).map(function () { return { wch: 20 }; }); XLSX.utils.book_append_sheet(wb, ws, name); }
    add('Summary', [{ Period: t.r.label, 'Fee income': t.feeSum, 'Other income': t.incSum, 'Total income': t.feeSum + t.incSum, Expenses: t.expSum, Balance: t.feeSum + t.incSum - t.expSum, Currency: cur }]);
    add('Fee receipts', t.fees.map(function (p) { var s = studentById(p.student_id) || {}; return { Date: p.paid_on, Receipt: p.receipt_no, Student: s.full_name || '', 'Admission No': s.admission_no || '', 'Fees for': MZ.monthLabel(p.month), Method: p.method, Amount: p.amount }; }));
    add('Other income', t.inc.map(function (e) { return { Date: e.entry_date, Category: e.category, From: e.party, Note: e.note, Amount: e.amount }; }));
    add('Expenses', t.exp.map(function (e) { return { Date: e.entry_date, Category: e.category, 'Paid to': e.party, Note: e.note, Amount: e.amount }; }));
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    MZ.saveFile('Accounts ' + t.r.label + '.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }

  /* actions for accounts & HR */
  Object.assign(A, {
    period: function (t) { S.period = t.dataset.p; render(); },
    prevYear: function () { setMonth((+S.month.slice(0, 4) - 1) + S.month.slice(4)); },
    nextYear: function () { setMonth((+S.month.slice(0, 4) + 1) + S.month.slice(4)); },
    addFin: function (t) { openFin(t.dataset.kind); },
    editFin: function (t) { var e = (S.fin || []).find(function (x) { return String(x.id) === t.dataset.id; }); if (e) openFin(e.kind, e); },
    delFin: function (t) { var id = +t.dataset.id; MZ.arm(t, function () { api.deleteFinance(id).then(function () { S.finAll = null; S.fin = S.fin.filter(function (x) { return x.id !== id; }); closeSheet(); render(); MZ.toast('Entry deleted.'); }).catch(function (e) { MZ.toast(e.message); }); }, 'Tap again to delete'); },
    efilter: function (t) { S.efilter = S.efilter === t.dataset.c ? '' : t.dataset.c; render(); },
    ffilter: function (t) { S.ffilter = t.dataset.f; render(); },
    discount: function (t) { openDiscount(t.dataset.id); },
    clearDiscount: function (t) { saveDiscount(t.dataset.id, 'amount', 0, ''); },
    remindLink: function (t) { sendRem(t, true); },
    remindApp: function (t) { sendRem(t, false); },
    copyReminders: function () {
      var m = S.month, y = m.slice(0, 4), lines = [];
      S.students.filter(function (s) { return !s.disabled && (s.start_month || '') <= m; }).forEach(function (s) {
        var sum = MZ.feeSummary(s, S.payments, y + '-01', m); if (sum.balance > 0) lines.push(s.full_name + (s.phone ? ' (' + s.phone + ')' : '') + ':\n' + MZ.fillReminder(S.settings.reminder_template, s, sum, S.settings));
      });
      MZ.copy(lines.join('\n\n'), lines.length + ' reminders copied.');
    },
    exportAccounts: function () { exportAccounts(); },
    hrAll: function () { S.hrAll = !S.hrAll; S.fbKey = null; render(); },
    tProfile: function (t) { openTeacherProfile(t.dataset.id); },
    mfbPeriod: function (t) { S.mfb.p = t.dataset.p; render(); },
    hrQClear: function (t) { S.hrQ[t.dataset.sub] = ''; render(); var i = $('#hrQ'); if (i) i.focus(); },
    saView: function (t) { S.att.view = t.dataset.v; S.att.editNote = null; if (t.dataset.v === 'month' && !S.att.month) S.att.month = (S.att.date || MZ.today()).slice(0, 7); render(); },
    saDay: function (t) { var n = +t.dataset.n, d = n === 0 ? attToday() : isoAdd(S.att.date, n); if (d > attToday()) return; S.att.date = d; S.att.month = d.slice(0, 7); S.att.editNote = null; render(); },
    saMon: function (t) { var m = S.att.month, y = +m.slice(0, 4), mo = +m.slice(5, 7) + (+t.dataset.n); if (mo < 1) { mo = 12; y--; } if (mo > 12) { mo = 1; y++; } var nm = y + '-' + MZ.pad(mo); if (nm > MZ.thisMonth()) return; S.att.month = nm; render(); },
    saFilter: function (t) { S.att.filter = S.att.filter === t.dataset.f && t.dataset.f !== 'all' ? 'all' : t.dataset.f; render(); },
    saMark: function (t) { var sid = t.dataset.sid, cur = (S.att.data[S.att.date] || {})[sid]; attSave(sid, cur && cur.status === t.dataset.st ? '' : t.dataset.st); },
    saNote: function (t) { S.att.editNote = S.att.editNote === t.dataset.sid ? null : t.dataset.sid; render(); var i = $('#attNoteI'); if (i) i.focus(); },
    saNoteX: function () { S.att.editNote = null; render(); },
    saAllPresent: function (t) {
      var d = S.att.date, m = S.att.data[d] || {}, rows = attStudents().filter(function (s) { return !m[s.id]; }).map(function (s) { return { student_id: s.id, status: 'present' }; });
      if (!rows.length) return; t.disabled = true;
      api.markAttendance(d, rows).then(function (n) { MZ.toast(n + ' student' + (n === 1 ? '' : 's') + ' marked present.'); S.att.loading = null; return attLoad(d, d); }).catch(function (e) { t.disabled = false; MZ.toast(e.message); });
    },
    saPrint: function () { attPrint(); },
    saRetry: function () { S.att.err = null; S.att.keys = {}; render(); },
    mfbSrc: function (t) { S.mfb.src = t.dataset.src; if (S.mfb.src === 'admin') mfbAdminLoad(); render(); },
    fbPeriod: function (t) { S.fbP = t.dataset.p; render(); if (sheet && sheet.kind === 'tProfile') openTeacherProfile(sheet.data.id); },
    fbYear: function (t) { setMonth(MZ.addMonths(S.month, 12 * (+t.dataset.d))); if (sheet && sheet.kind === 'tProfile') openTeacherProfile(sheet.data.id); },
    hrAdd: function (t) { openHR(t.dataset.k); },
    hrEdit: function (t) { var r = hrById(t.dataset.id); if (r) openHR(t.dataset.k, r); },
    hrDel: function (t) {
      var id = +t.dataset.id, r = hrById(id), linked = r && r.kind === 'teacher' ? (S.hr || []).filter(function (x) { return x.data.teacher_id === id; }).length : 0;
      MZ.arm(t, function () {
        api.deleteHR(id).then(function () { S.hr = S.hr.filter(function (x) { return x.id !== id; }); closeSheet(); render(); MZ.toast('Deleted.' + (linked ? ' Their ' + linked + ' older records are kept.' : '')); }).catch(function (e) { MZ.toast(e.message); });
      }, linked ? 'Tap again (' + linked + ' records stay)' : 'Tap again to delete');
    },
    payPayroll: function (t) {
      var r = hrById(t.dataset.id); if (!r) return; var d = JSON.parse(JSON.stringify(r.data)); d.status = 'Paid'; d.paid_on = MZ.today();
      t.disabled = true; api.saveHR({ id: r.id, kind: r.kind, data: d }).then(function (row) { S.hr = S.hr.filter(function (x) { return x.id !== row.id; }).concat([row]); render(); MZ.toast('Salary marked paid for ' + tName(d.teacher_id) + '.'); }).catch(function (e) { MZ.toast(e.message); t.disabled = false; });
    },
    genPayroll: function () { genPayroll(); },
    attDay: function (t) { var d = new Date(S.attDate + 'T12:00:00'); d.setDate(d.getDate() + +t.dataset.d); S.attDate = d.toISOString().slice(0, 10); render(); },
    attToday: function () { S.attDate = MZ.today(); render(); },
    attAll: function () { MZ.$$('.attrow').forEach(function (row) { var p = row.querySelector('input[value=Present]'); if (p && !row.querySelector('input[type=radio]:checked')) p.checked = true; }); }
  });
  document.addEventListener('change', function (e) { if (e.target.id === 'attDate' && e.target.value) { S.attDate = e.target.value; render(); } });

  Object.assign(A, {
    giveKeys: function (t) { openGiveKeys(t.dataset.sid || null); },
    gkAll: function (t) { MZ.$$('input[name=gkStu]').forEach(function (i) { i.checked = t.dataset.v === '1'; }); gkCount(); },
    goRules: function () { closeSheet(); S.tab = 'settings'; try { history.replaceState(null, '', '#settings'); } catch (e) {} render(); setTimeout(function () { var el = $('#secRules'); if (el) el.scrollIntoView({ block: 'start' }); }, 30); },
    ruleIdea: function (t) { saveRule({ name: t.dataset.n, keys: +t.dataset.k, active: true }, 'Rule added: ' + t.dataset.n + ' ' + MZ.signed(+t.dataset.k) + '.'); },
    ruleDel: function (t) { var r = ruleById(t.dataset.id); if (!r) return; MZ.arm(t, function () { api.deleteKeyRule(r.id).then(loadRules).then(function () { render(); MZ.toast('Rule deleted. Keys already given stay.'); }).catch(function (e) { MZ.toast(e.message); }); }, 'Delete?'); }
  });
  Object.assign(A, {
    ikf: function (t) { S.ikf = t.dataset.f; render(); },
    ikhMove: function (t) { openIkhMove(t.dataset.key); },
    ikhMoveGo: function () { var f = $('#ikhMoveForm'); if (f) { f.scrollIntoView({ block: 'center', behavior: 'smooth' }); $('#imDate').focus(); } },
    ikhCancelAll: function (t) {
      var g = groupByKey(t.dataset.key); if (!g) return; var n = g.rows.filter(function (x) { return x.status === 'scheduled'; }).length;
      if (!n) { MZ.toast('No one is waiting for this ikhtibar.'); return; }
      MZ.arm(t, function () { ikhSetAll(t.dataset.key, 'scheduled', 'cancelled', t, function (k) { return 'Ikhtibar cancelled for ' + k + ' student' + (k === 1 ? '' : 's') + '. They can see it is cancelled.'; }); }, 'Tap again to cancel for ' + n);
    },
    ikhRestoreAll: function (t) { ikhSetAll(t.dataset.key, 'cancelled', 'scheduled', t, function (k) { return 'Restored for ' + k + ' student' + (k === 1 ? '' : 's') + '.'; }); },
    rcMany: function () { openReportCards(null); },
    rcOne: function (t) { openReportCards(t.dataset.sid); },
    rcAll: function (t) { MZ.$$('input[name=rcStu]').forEach(function (i) { i.checked = t.dataset.v === '1'; }); },
    cert: function (t) { printCerts(t.dataset.sid, [+t.dataset.j]); },
    certLatest: function (t) { var s = studentById(t.dataset.sid); if (s) printCerts(s.id, [MZ.juzDone(s.pages)]); },
    certAll: function (t) { var s = studentById(t.dataset.sid); if (!s) return; var n = MZ.juzDone(s.pages), l = []; for (var j = 1; j <= n; j++) l.push(j); printCerts(s.id, l); }
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'ikQ') { S.ikq = e.target.value; render(); } });
  document.addEventListener('submit', function (e) {
    if (e.target.id === 'ikhMoveForm2') { e.preventDefault(); saveIkhMove(); }
    else if (e.target.id === 'rcForm') { e.preventDefault(); makeReportCards(); }
    else if (e.target.id === 'paForm') { e.preventDefault(); makeAccountsPrint($('#paBtn')); }
    else if (e.target.id === 'moveForm') { e.preventDefault(); saveMove(); }
  }, true);
  /* actions: tick to pay, monthly report, ikhtibar, notices */
  Object.assign(A, {
    approvals: function () { openApprovals(); },
    delBreak: function (t) {
      var bs = studentById(t.dataset.id); if (!bs) return;
      MZ.arm(t, function () { var nl = (bs.breaks || []).filter(function (_, i) { return i !== +t.dataset.i; }); saveBreaks(bs.id, nl, 'Break removed. Those months are due again if unpaid.'); }, 'Tap again to remove');
    },
    printAccounts: function () { openPrintAccounts(); },
    moveMoney: function (t) { openMove('transfer', t.dataset.acc); },
    openingBal: function (t) { var ex = (S.finAll || []).find(function (e) { return e.kind === 'opening' && e.account === t.dataset.acc; }); openMove('opening', t.dataset.acc, ex); },
    editMove: function (t) {
      var e = (S.finAll || []).find(function (x) { return String(x.id) === t.dataset.id; }); if (!e) return;
      if (e.kind === 'income' || e.kind === 'expense') { S.fin = S.fin || []; if (!S.fin.some(function (x) { return x.id === e.id; })) S.fin.push(e); openFin(e.kind, e); }
      else openMove(e.kind, e.account, e);
    },
    delMove: function (t) { var id = +t.dataset.id; MZ.arm(t, function () { api.deleteFinance(id).then(function () { S.finAll = null; S.finYear = null; closeSheet(); render(); MZ.toast('Entry deleted. Both books are updated.'); }).catch(function (e) { MZ.toast(e.message); }); }, 'Tap again to delete'); },
    bfilter: function (t) { S.bfilter = t.dataset.f; render(); },
    paGo: function (t) { makeAccountsPrint(t); },
    approveAll: function (t) { var ids = (S.pending || []).map(function (p) { return p.id; }); MZ.arm(t, function () { approve(ids, t); }, 'Tap again: approve ' + ids.length); },
    approveSel: function (t) { approve(apCount(), t); },
    approveOne: function (t) { approve([+t.dataset.id || t.dataset.id], t); },
    rejectPay: function (t, e) {
      if (e) e.preventDefault(); var id = +t.dataset.id || t.dataset.id;
      MZ.arm(t, function () { api.deletePayment(id).then(function () { S.payments = S.payments.filter(function (p) { return p.id !== id; }); indexPayments(); return loadPending(); }).then(function () { render(); openApprovals(); MZ.toast('Rejected. The month is unpaid again.'); }).catch(function (e2) { MZ.toast(e2.message); }); }, 'Reject?');
    },
    selAll: function () { monthRows(S.month).forEach(function (r) { if (!r.p && r.st !== 'leave' && MZ.effFee(r.s) > 0) S.sel[r.s.id] = true; }); render(); },
    selNone: function () { S.sel = {}; render(); },
    bulkPay: function (t) {
      var sel = selected(); if (!sel.length) return;
      MZ.arm(t, function () {
        t.disabled = true; t.textContent = 'Creating receipts…';
        payMany(sel.map(function (r) { return { s: r.s, month: S.month }; }), function (ok, failed) { S.sel = {}; render(); bulkDone(ok, failed); });
      }, 'Tap again: ' + sel.length + ' receipt' + (sel.length === 1 ? '' : 's'));
    },
    mselNone: function () { if (sheet) { sheet.data.msel = {}; drawLedger(); } },
    bulkMonths: function (t) {
      var s = studentById(sheet.data.id), months = ledgerTicked(); if (!s || !months.length) return;
      MZ.arm(t, function () {
        t.disabled = true;
        payMany(months.map(function (m) { return { s: s, month: m }; }), function (ok, failed) {
          sheet && (sheet.data.msel = {});
          api.listPayments({ studentId: s.id }).then(function (pays) { if (sheet && sheet.kind === 'student') { sheet.data.pays = pays; drawLedger(); } render(); bulkDone(ok, failed); });
        });
      }, 'Tap again: ' + months.length + ' receipt' + (months.length === 1 ? '' : 's'));
    },
    report: function (t) { openStudent(t.dataset.sid); sheet.data.rpMonth = S.month; setTimeout(function () { var el = $('#secReport'); if (el) el.scrollIntoView({ block: 'start' }); }, 60); },
    rpEdit: function (t) { sheet.data.rpMonth = t.dataset.m; sheet.data.rpDirty = false; drawReport(); var f = $('#reportForm'); if (f) f.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
    ikhNew: function () { openIkhNew(); },
    ikAll: function (t) { MZ.$$('input[name=ikStu]').forEach(function (i) { i.checked = t.dataset.v === '1'; }); ikCount(); },
    ikhGroup: function (t) { openIkhGroup(t.dataset.key); },
    ikhRes: function (t) { ikhResult(t); },
    ikhDel: function (t) {
      var x = ikhById(t.dataset.id); if (!x) return;
      MZ.arm(t, function () { api.deleteIkhtibar(x).then(function () { MZ.toast('Ikhtibar removed' + (x.key_event_id ? ' and its keys taken back.' : '.')); return afterIkhChange(); }).catch(function (e) { MZ.toast(e.message); }); }, 'Delete?');
    },
    ikhAllRes: function (t) {
      var g = ikhGroups(null).find(function (x) { return x.key === sheet.data.key; }); if (!g) return;
      var wait = g.rows.filter(function (x) { return x.status === 'scheduled'; }); if (!wait.length) { MZ.toast('Everyone already has a result.'); return; }
      MZ.arm(t, function () {
        t.disabled = true; var i = 0;
        (function next() { if (i >= wait.length) { MZ.toast(wait.length + ' marked cleared, +' + S.settings.keys_ikhtibar + ' keys each.'); afterIkhChange(); return; } api.ikhtibarResult(wait[i++].id, 'cleared').then(next, function (e) { MZ.toast(e.message); afterIkhChange(); }); })();
      }, 'Tap again: ' + wait.length + ' cleared');
    },
    newNotice: function () { if (role() !== 'admin') return MZ.toast('Only the admin can write notices.'); openNewNotice(null); },
    nFileRemove: function () { if (sheet) { sheet.data.file = null; sheet.data.html = ''; drawNoticeFile(); } }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.sel != null) { if (t.checked) S.sel[t.dataset.sel] = true; else delete S.sel[t.dataset.sel]; render(); }
    else if (t.dataset && t.dataset.msel != null && sheet && sheet.kind === 'student') { sheet.data.msel = sheet.data.msel || {}; if (t.checked) sheet.data.msel[t.dataset.msel] = true; else delete sheet.data.msel[t.dataset.msel]; drawLedger(); }
  });

  function setMonth(m) {
    var oldY = +S.month.slice(0, 4); S.month = m; S.sel = {};
    S.prog = {}; S.progMonth = null;
    var jobs = [loadProgress(m)]; if (+m.slice(0, 4) !== oldY) jobs.push(loadYear(+m.slice(0, 4)));
    render(); Promise.all(jobs).then(render).catch(function (e) { MZ.toast(e.message); });
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act],[data-tab],[data-sub]'); if (!t) return;
    if (t.dataset.tab && !t.dataset.act) { A.tab(t); return; }
    if (t.dataset.sub && !t.dataset.act) { A.sub(t); return; }
    if (t.tagName === 'A') { if (t.dataset.act === 'remindLink') A.remindLink(t); return; }
    if (!A[t.dataset.act]) return;
    if (t.dataset.act === 'receipt' && sheet && sheet.kind === 'student') {
      var p = findPayment(t.dataset.id); if (p) { var from = sheet.data.id; showReceipt(p); sheet.data.fromStudent = from; } return;
    }
    A[t.dataset.act](t, e);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheet) A.close(); });
  document.addEventListener('input', function (e) {
    var id = e.target.id;
    if (id === 'feeQ') { S.q = e.target.value; render(); }
    else if (id === 'stuQ') { S.sq = e.target.value; render(); }
    else if (id === 'recQ') { S.rq = e.target.value; render(); }
    else if (id === 'progQ') { S.pq = e.target.value; render(); }
    else if (e.target.dataset && e.target.dataset.fee != null) { var st0 = studentById(e.target.dataset.fee); e.target.classList.toggle('changed', !!st0 && String(+e.target.value || 0) !== String(st0.monthly_fee || 0)); }
    else if (id === 'payAmt') { var w = $('#payWords'); if (w) w.textContent = e.target.value ? MZ.amountInWords(e.target.value, S.settings.currency) : ''; }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target; if (f.id === 'signinForm' || f.id === 'setupForm') return;
    e.preventDefault();
    if (f.id === 'myPwForm') { saveMyPw(!!f.dataset.forced); return; }
    if (f.id === 'tlsForm') {
      var tp = $('#tlsPw').value.trim(), ta = $('#tlsAuto').checked;
      if (!MZ.strongPw(tp)) { MZ.toast(MZ.STRONG_PW_MSG); return; }
      $('#tlsBtn').disabled = true;
      api.saveTeacherLoginSettings(ta, tp).then(function () { S.tls = { auto: ta, password: tp }; render(); MZ.toast(ta ? 'Saved. New teachers get a login with this password.' : 'Saved. Logins will not be made automatically.'); })
        .catch(function (e2) { MZ.toast(e2.message); $('#tlsBtn').disabled = false; });
      return;
    }
    if (f.id === 'staffForm') {
      var su = $('#stUser').value.trim().toLowerCase(), sp = $('#stPw').value, sr = (f.querySelector('input[name=stRole]:checked') || {}).value || 'teacher';
      if (!MZ.validUsername(su)) { MZ.toast('Username must be 3 to 30 letters or numbers, no spaces.'); return; }
      if (!MZ.strongPw(sp)) { MZ.toast(MZ.STRONG_PW_MSG); return; }
      api.addStaff(su, sp, sr).then(function () {
        S.staff = null; render();
        MZ.toast(MZ.ROLES[sr].name + ' account created. ' + su + ' can now sign in to the Institute portal.');
      }).catch(function (e2) { MZ.toast(e2.message); });
      return;
    }
    if (f.id === 'breakForm') {
      var bid = f.dataset.id, bs = studentById(bid), bf = $('#bkFrom').value, bt = $('#bkTo').value || null;
      if (!bf) { MZ.toast('Choose the month they went away.'); return; }
      if (bt && bt < bf) { MZ.toast('The return month must be after the month they went away.'); return; }
      var clash = (bs.breaks || []).some(function (b) { return bf <= (b.to || '9999-12') && (bt || '9999-12') >= b.from; });
      if (clash) { MZ.toast('This overlaps a break already added. Remove that one first.'); return; }
      var nl = (bs.breaks || []).concat([{ from: bf, to: bt, note: $('#bkNote').value.trim() }]).sort(function (a, b) { return a.from < b.from ? -1 : 1; });
      saveBreaks(bid, nl, MZ.firstName(bs.full_name) + ' is on leave ' + MZ.breakLabel({ from: bf, to: bt }).replace(' onwards', ' until you set a return month') + '. No fees are due for those months.');
      return;
    }
    if (f.id === 'feeOnlyForm') {
      var fid = sheet.data.id;
      api.updateStudent(fid, { monthly_fee: Number($('#foFee').value) || 0, start_month: $('#foStart').value }).then(function () { return api.listStudents(); })
        .then(function (l) { S.students = l; render(); openStudent(fid, true); MZ.toast('Fee saved. Receipts already issued keep their amounts.'); }).catch(function (e2) { MZ.toast(e2.message); });
      return;
    }
    if (f.classList.contains('staffpw')) {
      var np = f.querySelector('input').value;
      if (!MZ.strongPw(np)) { MZ.toast(MZ.STRONG_PW_MSG); return; }
      api.resetStaffPassword(f.dataset.id, np).then(function () { f.remove(); MZ.toast('Password changed for ' + f.dataset.u + '.'); }).catch(function (e2) { MZ.toast(e2.message); });
      return;
    }
    if (f.id === 'payForm') submitPay();
    else if (f.id === 'addForm') {
      var btn = $('#addBtn'), err = $('#addErr');
      var o = { full_name: $('#aName').value.trim(), username: $('#aUser').value.trim().toLowerCase(), password: $('#aPw').value, monthly_fee: $('#aFee').value,
        phone: $('#aPhone').value.replace(/[^\d+]/g, ''), start_month: $('#aStart').value || MZ.thisMonth(), juz: 0, pages: Math.max(0, Math.min(604, parseInt($('#aPages').value, 10) || 0)),
        extra: { admission_no: $('#aAdm').value.trim() || null, its_no: $('#aIts').value.replace(/\D/g, '') || null, program: $('#aProg').value.trim() || null,
          gender: $('#aGender').value || null, dob: $('#aDob').value || null, guardian_name: $('#aGuard').value.trim() || null, email: $('#aEmail').value.trim().toLowerCase() || null } };
      if (o.extra.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.extra.email)) { err.textContent = 'The email address is not valid.'; err.hidden = false; return; }
      if (!MZ.validUsername(o.username)) { err.textContent = 'Username must be 3 to 30 letters or numbers (dots, dashes and underscores are allowed, no spaces).'; err.hidden = false; return; }
      btn.disabled = true; err.hidden = true;
      var newSid = null, mail = null;
      api.createStudent(o).then(function (newId) {
        if (!newId) return; newSid = newId;
        return api.updateStudent(newId, o.extra).catch(function () {}).then(function () { if (o.pages) return api.setPages(newId, MZ.thisMonth(), o.pages).catch(function () {}); });
      }).then(function () {
        S.newLogins.push({ name: o.full_name, username: o.username, password: o.password, phone: o.phone });
        if (newSid && o.extra.email) return api.sendWelcome(newSid, welcomeTpl()).then(function (r4) { mail = { ok: true, feeMissing: !!(r4 && r4.fee_missing) }; }, function (e4) { mail = { ok: false, msg: e4.message }; });
      }).then(function () {
        return api.listStudents().then(function (l) { S.students = l; render(); });
      }).then(function () {
        var mh = !o.extra.email ? '<p class="okmsg" style="background:var(--warn-bg);color:var(--warn)">No email address, so no welcome email was sent. You can send the fee instructions on WhatsApp instead.</p>'
          : mail && mail.ok ? '<p class="okmsg">' + I.check + 'Welcome email with the fee details and payment instructions sent to <b>' + esc(o.extra.email) + '</b>.</p>' + (mail.feeMissing ? feeFlagHTML({ id: newSid, full_name: o.full_name }) : '')
          : '<p class="okmsg" style="background:var(--warn-bg);color:var(--warn)">The welcome email could not be sent automatically (' + esc(mail ? mail.msg : 'not set up') + '). Send it from your email app or WhatsApp.</p>';
        $('#overlay .sheet').innerHTML = head('Student added', o.full_name) + credCard(o.full_name, o.username, o.password, o.phone) + mh
          + '<div style="display:flex;gap:8px;flex-wrap:wrap">' + (newSid && !(mail && mail.ok) ? '<button class="btn" data-act="welcome" data-id="' + esc(newSid) + '">' + I.doc + 'Welcome message</button>' : '') + '<button class="btn gold" data-act="addStudent">' + I.plus + 'Add another</button><button class="btn" data-act="close">Done</button></div>';
      }).catch(function (e2) { err.textContent = e2.message; err.hidden = false; btn.disabled = false; });
    } else if (f.id === 'editForm') {
      var id = sheet.data.id;
      api.updateStudent(id, { full_name: $('#eName').value.trim(), phone: $('#ePhone').value.replace(/[^\d+]/g, ''), monthly_fee: Number($('#eFee').value) || 0,
        start_month: $('#eStart').value, admission_no: $('#eAdm').value.trim() || null, its_no: $('#eIts').value.replace(/\D/g, '') || null,
        program: $('#eProg').value.trim() || null, gender: $('#eGender').value || null, dob: $('#eDob').value || null,
        guardian_name: $('#eGuard').value.trim() || null, email: $('#eEmail').value.trim().toLowerCase() || null })
        .then(function (s) {
          var ip = $('#eItsPw'); if (ip && ip.value !== ip.dataset.orig) api.setItsPassword(id, ip.value.trim()).then(function () { ip.dataset.orig = ip.value; }).catch(function (e3) { MZ.toast(e3.message); });
          S.students = S.students.map(function (x) { return x.id === id ? s : x; }); render();
          MZ.toast('Saved. Receipts already issued keep their amounts.');
          var h2 = $('#overlay .sheet-head h2'); if (h2) h2.textContent = s.full_name;
        }).catch(function (e2) { MZ.toast(e2.message); });
    } else if (f.id === 'resetForm') {
      var sid = sheet.data.id, pw = $('#rPw').value, st = studentById(sid);
      api.resetPassword(sid, pw).then(function () {
        MZ.toast('Password reset.');
        var sec = f.closest('.panel'); if (sec) sec.insertAdjacentHTML('beforeend', credCard(st.full_name, st.username, pw, st.phone));
      }).catch(function (e2) { MZ.toast(e2.message); });
    } else if (f.id === 'keysForm') {
      var kp = { keys_jadeed: Math.max(0, parseInt($('#kJ').value, 10) || 0), keys_ikhtibar: Math.max(0, parseInt($('#kI').value, 10) || 0),
        keys_goal: Math.max(0, parseInt($('#kG').value, 10) || 0), reward_every: Math.max(1, parseInt($('#kR').value, 10) || 100) };
      api.saveSettings(kp).then(function (s2) { S.settings = s2; render(); MZ.toast('Keys saved.'); }).catch(function (e2) { MZ.toast(e2.message); });
    } else if (f.id === 'goalAllForm') {
      var g = parseInt($('#goalAll').value, 10);
      if (!(g >= 0 && g <= 604)) { MZ.toast('Enter a goal between 0 and 604 pages.'); return; }
      api.setGoal(null, S.month, g).then(function (n) { return loadProgress(S.month).then(function () { return api.listStudents(); }).then(function (l) { S.students = l; render(); MZ.toast('Goal of ' + g + ' pages set for ' + n + ' students for ' + MZ.monthLabel(S.month) + '.'); }); }).catch(function (e2) { MZ.toast(e2.message); });
    } else if (f.id === 'goalEditForm') { saveGoalEdit(f);
    } else if (f.id === 'addPgForm') {
      addPages(f.dataset.sid, $('#apPage').value, false, $('#apBtn'));
    } else if (f.classList.contains('qadd')) {
      var qi = f.querySelector('input'); addPages(f.dataset.sid, qi.value, false, f.querySelector('button'));
    } else if (f.id === 'sGoalForm' || f.id === 'sPagesForm' || f.id === 'sJadeedForm') {
      var sid2 = sheet.data.id;
      var job = f.id === 'sGoalForm' ? api.setGoal(sid2, MZ.thisMonth(), parseInt($('#sGoal').value, 10) || 0).then(function () { var st3 = studentById(sid2), h3 = st3 && MZ.monthHifz(st3, sheet.data.progAll || [], MZ.thisMonth()), t3 = st3 && MZ.targetPage(h3.startPos, $('#sGoal').value, st3.hifz_dir); MZ.toast('Monthly goal saved.' + (t3 ? ' Target page: ' + t3 + '.' : '')); })
        : f.id === 'sPagesForm' ? (function (pb) {
          var sv = $('#nwS').value.trim(), su = MZ.parseSurah(sv), pg = $('#nwP').value === '' ? null : +$('#nwP').value;
          if (sv && !su) return Promise.reject(new Error('Surah not recognised. Type a name like "Mulk" or a number 1–114.'));
          if (su && !pg) pg = MZ.surahPages(su)[0];
          return api.setNowAt(sid2, su || null, pg || null)
            .then(function (res) { var pa = res ? +res.pages || 0 : 0; MZ.toast('Saved' + (pg ? ': now at ' + MZ.posLabel(su || MZ.pageSurah(pg, res && res.dir), pg) + ', ' + pa + ' pages memorised' : '') + '.'); juzToast(sid2, pb, pa); });
        })(studentById(sid2).pages)
        : progressAction('jadeed', sid2, parseInt($('#sJadeedN').value, 10) || 1);
      Promise.resolve(job).then(function () { return refreshProgressFor(sid2); }).catch(function (e2) { MZ.toast(e2.message); });
    } else if (f.id === 'finForm') { saveFin();
    } else if (f.id === 'hrForm') { saveHR();
    } else if (f.id === 'attForm') { saveAttendance();
    } else if (f.id === 'discForm') { saveDiscount(sheet.data.id, $('#dType').value, Math.max(0, +$('#dVal').value || 0), $('#dNote').value.trim());
    } else if (f.id === 'reminderForm') {
      var tpl = $('#remTpl').value.trim(); if (!tpl) { MZ.toast('Write a message first.'); return; }
      api.saveSettings({ reminder_template: tpl }).then(function (s2) { S.settings = s2; render(); MZ.toast('Reminder message saved.'); }).catch(function (e2) { MZ.toast(e2.message); });
    } else if (f.id === 'reportForm') { saveReport();
    } else if (f.id === 'ikhNewForm') { saveIkhNew();
    } else if (f.id === 'sIkhForm') {
      var sidI = sheet.data.id, dI = $('#sIkhDate').value; if (!dI) return;
      api.scheduleIkhtibar({ studentIds: [sidI], exam_date: dI, title: $('#sIkhTitle').value.trim() || 'Ikhtibar' }).then(function () { MZ.toast('Ikhtibar on ' + MZ.dateLabel(dI) + ' scheduled. ' + MZ.firstName(studentById(sidI).full_name) + ' can see it now.'); return afterIkhChange(); }).catch(function (e2) { MZ.toast(e2.message); });
    } else if (f.id === 'ikhMoveForm') {
      var gk = sheet.data.key, g2 = ikhGroups(null).find(function (x) { return x.key === gk; }), nd = $('#imDate').value, nt = $('#imTitle').value.trim() || 'Ikhtibar';
      if (!g2 || !nd) return;
      var wait2 = g2.rows.filter(function (x) { return x.status === 'scheduled'; });
      Promise.all(wait2.map(function (x) { return api.updateIkhtibar(x.id, { exam_date: nd, title: nt, note: x.note }); })).then(function () {
        MZ.toast(wait2.length + ' updated to ' + MZ.dateLabel(nd) + '.');
        if (wait2.length === g2.rows.filter(function (x) { return x.status !== 'cancelled'; }).length) { sheet.data.key = nd + '|' + nt; if (nd.slice(0, 7) !== S.month && S.tab === 'progress') { closeSheet(); setMonth(nd.slice(0, 7)); } }
        return afterIkhChange();
      }).catch(function (e2) { MZ.toast(e2.message); });
    } else if (f.id === 'noticeForm') {
      publishNotice();
    } else if (f.id === 'feesForm') {
      saveFees();
    } else if (f.id === 'settingsForm') {
      var patch = { institute_name: $('#setName').value.trim(), currency: $('#setCur').value.trim(), due_day: Math.max(1, Math.min(28, parseInt($('#setDue').value, 10) || 5)), default_password: $('#setPw').value };
      if (patch.default_password.length < 6) { MZ.toast('Default password must be at least 6 characters.'); return; }
      api.saveSettings(patch).then(function (s) { S.settings = s; render(); MZ.toast('Settings saved.'); }).catch(function (e2) { MZ.toast(e2.message); });
    }
  });

  /* ----------------------------------------------------------- start */
  api.restore().then(function (sess) { if (sess && sess.role === 'institute') startApp(); else showSignin(); }).catch(showSignin);
})();
