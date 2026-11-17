// @ts-nocheck  (plain JavaScript inside: the timetable layout is shared with the portal)
// Tells teachers when students are allocated or handed over to them: a nicely laid out email
// and a notification on their phone (Web Push, works when the portal is installed as an app).
// Students get an email too, with their teacher, day and time.
// Deploy:  supabase functions deploy notify-teacher --no-verify-jwt   (the function checks the caller itself)
// Secrets: RESEND_API_KEY and MAIL_FROM (already set for the welcome email),
//          VAPID_PRIVATE_KEY (the private half of the key whose public half is VAPID_PUBLIC_KEY in js/config.js),
//          optionally VAPID_PUBLIC_KEY, VAPID_SUBJECT (mailto:you@domain) and SITE_URL.
// Who can call it: the admin and teachers with schedule permission (checked with the caller's own login).
// Body: { ids: number[] }  → alerts the teachers of those slots who have not been told yet
//       { test: true }      → sends a test alert to the caller's own phones
//       { manual: true, id, to: ['student','teacher','admin'] } → the Notify buttons for one lesson
//       { timetable: true, from, to, recipients: [{type, ref}], force } → weekly timetable emails with a PDF copy
//       { removed: true, ids } → after a bulk delete: tells the student and teacher(s) which upcoming lessons were removed
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const DEFAULT_PUBLIC = 'BAvcwmwigK9lMRNfKAC052jxcvjWiIbA7HxxMZhWrsvjQNb6Nij2AxQvWJeWjacODoymXy_P94NsemC9Vw5QT3k';

/* ---- Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID), plain WebCrypto ---- */
// @webpush-start
const enc = new TextEncoder();
function b64u(buf) { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
function cat(...parts) { let n = 0; parts.forEach((p) => (n += p.length)); const o = new Uint8Array(n); let k = 0; parts.forEach((p) => { o.set(p, k); k += p.length; }); return o; }
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}
async function vapidAuth(endpoint, publicKey, privateKey, subject) {
  const pub = unb64u(publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: privateKey, ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + publicKey;
}
async function encryptPayload(text, p256dh, authSecret) {
  const ua = unb64u(p256dh), secret = unb64u(authSecret);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(secret, shared, cat(enc.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, cat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function sendPush(sub, payload, vapid) {
  const body = await encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuth(sub.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
    body,
  });
  return r.status;
}
// @webpush-end

/* ---- the email ---- */
const DAY = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
type Slot = { id: number; student: string; date: string; from: string; to: string; note?: string; handed_from?: string; kind?: string; was_date?: string; was_from?: string; was_to?: string; other_teacher?: string };
// what changed, in a few words (new, moved, changed time, cancelled, restored, taken off)
const SHORT_DAY = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
function changeLine(s: any, who: 'teacher' | 'student') {
  const was = s.was_date ? `${SHORT_DAY(s.was_date)} ${s.was_from}–${s.was_to}` : '';
  switch (s.kind) {
    case 'changed': return was ? `Changed (was ${was})` : 'Changed';
    case 'cancelled': return 'Cancelled';
    case 'restored': return 'Back on (it had been cancelled)';
    case 'moved': return who === 'teacher' ? (s.other_teacher ? `Moved to you from ${s.other_teacher}` : 'Moved to you') : (s.was_teacher ? `New teacher (was ${s.was_teacher})` : 'New teacher');
    case 'removed': return s.other_teacher ? `Taken off your schedule: now with ${s.other_teacher}` : 'Taken off your schedule';
    default: return who === 'teacher' ? 'New' : '';
  }
}
const TAG = (kind?: string) => kind === 'cancelled' || kind === 'removed' ? '#9A3A30' : kind === 'new' || !kind ? '#2F7D4F' : '#7A5A14';
const allNew = (l: any[]) => l.every((x) => !x.kind || x.kind === 'new');
function emailHtml(name: string, slots: Slot[], site: string) {
  const days: Record<string, Slot[]> = {};
  slots.forEach((s) => (days[s.date] = days[s.date] || []).push(s));
  const rows = Object.keys(days).sort().map((d) => `
    <tr><td style="padding:18px 0 6px;font:700 13px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#A67C1E">${esc(DAY(d))}</td></tr>
    ${days[d].map((s) => `<tr><td style="padding:6px 0">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E9D9AE;border-radius:12px;background:#FFFDF8"><tr>
        <td width="104" style="padding:12px 14px;border-right:1px solid #F0E4C4;font:700 15px Arial,sans-serif;color:#7A5A14;white-space:nowrap">${esc(s.from)}&nbsp;–&nbsp;${esc(s.to)}</td>
        <td style="padding:12px 14px;font:15px Arial,sans-serif;color:#1C1A17"><b style="font-size:16px">${esc(s.student)}</b>
          ${s.note ? `<span style="display:inline-block;margin-left:6px;padding:1px 9px;border-radius:999px;background:#F6ECCB;color:#7A5A14;font-size:12px">${esc(s.note)}</span>` : ''}
          ${changeLine(s, 'teacher') ? `<div style="margin-top:3px;font-size:13px;font-weight:700;color:${TAG(s.kind)}">${esc(changeLine(s, 'teacher'))}</div>` : ''}
          ${s.handed_from && (!s.kind || s.kind === 'new') ? `<div style="margin-top:3px;font-size:13px;color:#6B6455">Handed over from ${esc(s.handed_from)}</div>` : ''}</td>
      </tr></table></td></tr>`).join('')}`).join('');
  const n = slots.length, fresh = allNew(slots);
  return `<!doctype html><html><body style="margin:0;background:#F4EEDF;padding:24px 12px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#FBF7EC;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(10,17,41,.15)">
    <tr><td style="background:#0E1736;background-image:linear-gradient(135deg,#0A1129,#26366F);padding:26px 28px;text-align:center">
      <div style="font:700 12px Arial,sans-serif;letter-spacing:.22em;color:#D4AF37">QISM AL TAHFEEZ · DAR ES SALAAM</div>
      <div style="font:700 24px Georgia,serif;color:#F4DE9C;margin-top:8px">${fresh ? (n === 1 ? 'A new student for you' : n + ' new students for you') : 'Your schedule has changed'}</div>
      <div style="height:2px;width:90px;margin:14px auto 0;background:linear-gradient(90deg,transparent,#D4AF37,transparent)"></div>
    </td></tr>
    <tr><td style="padding:24px 28px 8px;font:15px/1.6 Arial,sans-serif;color:#1C1A17">Salaam ${esc(name)},<br>${fresh ? (n === 1 ? 'This student has' : 'These students have') + ' been allocated to you:' : 'Please note these changes to your schedule:'}</td></tr>
    <tr><td style="padding:0 28px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table></td></tr>
    <tr><td align="center" style="padding:26px 28px 10px"><a href="${esc(site)}#schedule" style="display:inline-block;padding:13px 26px;border-radius:999px;background:#D4AF37;background-image:linear-gradient(180deg,#F4DE9C,#C9A23A);color:#1C1A17;font:700 15px Arial,sans-serif;text-decoration:none">Open my schedule</a></td></tr>
    <tr><td style="padding:10px 28px 26px;text-align:center;font:12px/1.5 Arial,sans-serif;color:#8A8270">You get this email because you teach at Tahfeez Daressalaam.<br>Turn on phone alerts in the portal to be told on your phone too.</td></tr>
  </table></td></tr></table></body></html>`;
}
type SSlot = { id: number; teacher: string; date: string; from: string; to: string; note?: string; handed_from?: string; kind?: string; was_date?: string; was_from?: string; was_to?: string; was_teacher?: string };
function studentHtml(name: string, slots: SSlot[], site: string) {
  const changed = slots.some((s: any) => s.handed_from || (s.kind && s.kind !== 'new'));
  const days: Record<string, SSlot[]> = {};
  slots.forEach((s) => (days[s.date] = days[s.date] || []).push(s));
  const rows = Object.keys(days).sort().map((d) => `
    <tr><td style="padding:18px 0 6px;font:700 13px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#A67C1E">${esc(DAY(d))}</td></tr>
    ${days[d].map((s) => `<tr><td style="padding:6px 0">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E9D9AE;border-radius:12px;background:#FFFDF8"><tr>
        <td width="104" style="padding:12px 14px;border-right:1px solid #F0E4C4;font:700 15px Arial,sans-serif;color:#7A5A14;white-space:nowrap">${esc(s.from)}&nbsp;–&nbsp;${esc(s.to)}</td>
        <td style="padding:12px 14px;font:15px Arial,sans-serif;color:#1C1A17"><span style="font-size:12px;color:#6B6455">Your teacher</span><br><b style="font-size:16px">${esc(s.teacher)}</b>
          ${s.note ? `<span style="display:inline-block;margin-left:6px;padding:1px 9px;border-radius:999px;background:#F6ECCB;color:#7A5A14;font-size:12px">${esc(s.note)}</span>` : ''}
          ${changeLine(s, 'student') ? `<div style="margin-top:3px;font-size:13px;font-weight:700;color:${TAG(s.kind)}">${esc(changeLine(s, 'student'))}</div>` : s.handed_from ? `<div style="margin-top:3px;font-size:13px;color:#9A3A30">Changed: instead of ${esc(s.handed_from)}</div>` : ''}</td>
      </tr></table></td></tr>`).join('')}`).join('');
  const first = name.split(' ')[0];
  return `<!doctype html><html><body style="margin:0;background:#F4EEDF;padding:24px 12px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#FBF7EC;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(10,17,41,.15)">
    <tr><td style="background:#0E1736;background-image:linear-gradient(135deg,#0A1129,#26366F);padding:26px 28px;text-align:center">
      <div style="font:700 12px Arial,sans-serif;letter-spacing:.22em;color:#D4AF37">QISM AL TAHFEEZ · DAR ES SALAAM</div>
      <div style="font:700 24px Georgia,serif;color:#F4DE9C;margin-top:8px">${changed ? 'Your class schedule has changed' : 'Your class schedule'}</div>
      <div style="height:2px;width:90px;margin:14px auto 0;background:linear-gradient(90deg,transparent,#D4AF37,transparent)"></div>
    </td></tr>
    <tr><td style="padding:24px 28px 8px;font:15px/1.6 Arial,sans-serif;color:#1C1A17">Salaam ${esc(first)},<br>${changed ? 'Please note these changes:' : 'Here is when you sit with your teacher:'}</td></tr>
    <tr><td style="padding:0 28px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table></td></tr>
    <tr><td style="padding:16px 28px 0;font:14px/1.6 Arial,sans-serif;color:#4A4436">Please be on time, with your Qur'an and your revision ready.</td></tr>
    <tr><td align="center" style="padding:22px 28px 10px"><a href="${esc(site)}" style="display:inline-block;padding:13px 26px;border-radius:999px;background:#D4AF37;background-image:linear-gradient(180deg,#F4DE9C,#C9A23A);color:#1C1A17;font:700 15px Arial,sans-serif;text-decoration:none">Open my portal</a></td></tr>
    <tr><td style="padding:10px 28px 26px;text-align:center;font:12px/1.5 Arial,sans-serif;color:#8A8270">Tahfeez Daressalaam · You get this email because you are a student here.</td></tr>
  </table></td></tr></table></body></html>`;
}
const studentText = (name: string, slots: SSlot[], site: string) =>
  `Salaam ${name.split(' ')[0]},\n\nYour class${slots.length === 1 ? '' : 'es'}:\n` +
  slots.map((s) => `- ${DAY(s.date)}, ${s.from}–${s.to} with ${s.teacher}${s.note ? ' (' + s.note + ')' : ''}${changeLine(s, 'student') ? ' · ' + changeLine(s, 'student') : ''}`).join('\n') +
  `\n\nOpen your portal: ${site}\n`;
const emailText = (name: string, slots: Slot[], site: string) =>
  `Salaam ${name},\n\n${allNew(slots) ? 'New student' + (slots.length === 1 ? '' : 's') + ' allocated to you' : 'Changes to your schedule'}:\n` +
  slots.map((s) => `- ${DAY(s.date)}, ${s.from}–${s.to}: ${s.student}${s.note ? ' (' + s.note + ')' : ''}${changeLine(s, 'teacher') ? ' · ' + changeLine(s, 'teacher') : ''}`).join('\n') +
  `\n\nOpen your schedule: ${site}#schedule\n`;

/* ---- manual "Notify" emails for one lesson (student, teacher, admin) ---- */
const SUBJECT: Record<string, string> = { new: 'New Hifz Lesson Schedule', updated: 'Hifz Lesson Schedule Updated', rescheduled: 'Hifz Lesson Rescheduled', cancelled: 'Hifz Lesson Cancelled' };
const KIND_LINE: Record<string, string> = { new: 'A new lesson has been scheduled.', updated: 'This lesson has been updated.', rescheduled: 'This lesson has been rescheduled. Please note the new date and time.', cancelled: 'This lesson has been cancelled.' };
function manualHtml(p: any, who: string, name: string, site: string) {
  const kind = p.kind || 'new', cancelled = kind === 'cancelled';
  const row = (k: string, v: string) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #F0E4C4;color:#6B6455;font:13px Arial,sans-serif;width:120px">${esc(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #F0E4C4;font:15px Arial,sans-serif;color:#1C1A17${cancelled && (k === 'Date' || k === 'Time') ? ';text-decoration:line-through' : ''}"><b>${esc(v)}</b></td></tr>`;
  return `<!doctype html><html><body style="margin:0;background:#F4EEDF;padding:24px 12px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#FBF7EC;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(10,17,41,.15)">
    <tr><td style="background:#0E1736;background-image:linear-gradient(135deg,#0A1129,#26366F);padding:26px 28px;text-align:center">
      <div style="font:700 12px Arial,sans-serif;letter-spacing:.22em;color:#D4AF37">QISM AL TAHFEEZ · DAR ES SALAAM</div>
      <div style="font:700 24px Georgia,serif;color:#F4DE9C;margin-top:8px">${esc(SUBJECT[kind] || SUBJECT.new)}</div>
    </td></tr>
    <tr><td style="padding:22px 28px 6px;font:15px/1.6 Arial,sans-serif;color:#1C1A17">Salaam ${esc(name || '')},<br>${esc(KIND_LINE[kind] || KIND_LINE.new)}</td></tr>
    <tr><td style="padding:8px 28px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E9D9AE;border-radius:12px;background:#FFFDF8">
      ${row('Student', p.student?.name || '')}${row('Teacher', p.teacher?.name || '')}${row('Date', DAY(p.date))}${row('Time', `${p.from} – ${p.to}`)}${p.note ? row('Remarks', p.note) : ''}${row('Status', cancelled ? 'Cancelled' : kind === 'new' ? 'New' : kind === 'rescheduled' ? 'Rescheduled' : 'Updated')}
    </table></td></tr>
    ${who !== 'admin' ? `<tr><td align="center" style="padding:22px 28px 10px"><a href="${esc(site)}" style="display:inline-block;padding:13px 26px;border-radius:999px;background:#D4AF37;background-image:linear-gradient(180deg,#F4DE9C,#C9A23A);color:#1C1A17;font:700 15px Arial,sans-serif;text-decoration:none">Open my schedule</a></td></tr>` : ''}
    <tr><td style="padding:10px 28px 26px;text-align:center;font:12px/1.5 Arial,sans-serif;color:#8A8270">Tahfeez Daressalaam · Schedule notification</td></tr>
  </table></td></tr></table></body></html>`;
}
const manualText = (p: any, name: string) => `Salaam ${name || ''},\n\n${KIND_LINE[p.kind] || KIND_LINE.new}\n\nStudent: ${p.student?.name || ''}\nTeacher: ${p.teacher?.name || ''}\nDate: ${DAY(p.date)}\nTime: ${p.from}–${p.to}${p.note ? '\nRemarks: ' + p.note : ''}\n`;
async function log(sb: any, id: number, type: string, name: string, email: string | null, kind: string, status: string, error: string | null, manual: boolean) {
  try { await sb.rpc('log_schedule_notification', { p_schedule: id, p_type: type, p_name: name || null, p_email: email, p_kind: kind || null, p_status: status, p_error: error, p_manual: manual }); } catch (_) { /* the email itself matters more than its log */ }
}

async function sendMail(key: string, to: string, subject: string, html: string, text: string, attachments?: { filename: string; content: string }[]) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('MAIL_FROM') || 'Tahfeez Daressalaam <onboarding@resend.dev>', to: [to], subject, html, text, ...(attachments && attachments.length ? { attachments } : {}) }),
  }).catch(() => null);
  return !!r && r.ok;
}
/* ---- weekly timetable emails (student, teacher, admin): the same layout as the preview in the portal ---- */
// @tt-template-start
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
// @tt-template-end

// a PDF copy of the timetable (A4, headings repeat on every page, long names wrap instead of being cut)
function pdfSafe(s: unknown) { return String(s ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?'); }
async function ttPdf(p: any): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 36, FS = 9, LH = 11.5, PAD = 4, avail = W - M * 2;
  const cols = ttCols(p.type);
  const body: { cells: string[]; empty?: boolean; first?: boolean }[] = [];
  ttGroups(p).forEach((d: any) => {
    if (!d.rows.length) { body.push({ cells: [ttDay(d.date), ttDate(d.date), 'No lessons'].concat(cols.slice(3).map(() => '')), empty: true, first: true }); return; }
    d.rows.forEach((r: any, i: number) => { const c = ttCells(p, r); body.push({ cells: [ttDay(d.date), ttDate(d.date)].concat(c.who.map((w: string, k: number) => w + (k === c.who.length - 1 && c.change ? ' (' + c.change + ')' : ''))).concat([c.from, c.to, c.mins]), first: i === 0 }); });
  });
  // column widths: what the text needs, then the name columns share whatever is left
  const need = cols.map((h, i) => Math.max(fb.widthOfTextAtSize(pdfSafe(h), FS), ...body.filter((r) => !r.empty || i < 2).map((r) => (i === 0 ? fb : f).widthOfTextAtSize(pdfSafe(r.cells[i] || ''), FS))) + PAD * 2);
  const nameCols = cols.map((h, i) => (h === 'Student' || h === 'Teacher' ? i : -1)).filter((i) => i >= 0);
  const fixed = need.reduce((a, w, i) => a + (nameCols.includes(i) ? 0 : w), 0);
  const widths = need.slice();
  const left = avail - fixed, wantNames = nameCols.reduce((a, i) => a + need[i], 0);
  nameCols.forEach((i) => { widths[i] = wantNames <= left ? need[i] + (left - wantNames) / nameCols.length : Math.max(60, left * need[i] / wantNames); });
  const wrap = (text: string, width: number, font: any) => {
    const words = pdfSafe(text).split(' '), lines: string[] = []; let cur = '';
    words.forEach((w) => { const t = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(t, FS) <= width - PAD * 2 || !cur) cur = t; else { lines.push(cur); cur = w; } });
    if (cur) lines.push(cur); return lines.length ? lines : [''];
  };
  let page: any, y = 0, pageNo = 0;
  const pages: any[] = [];
  const header = () => {
    page = doc.addPage([W, H]); pages.push(page); pageNo++; y = H - M;
    page.drawText('TAHFEEZ DARESSALAAM', { x: M, y: y - 8, size: 8, font: fb, color: rgb(0.65, 0.49, 0.12) });
    page.drawText(pdfSafe(p.institute || 'Qism al Tahfeez Dar es Salaam'), { x: M, y: y - 19, size: 8, font: f, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(pdfSafe(ttTitle(p)), { x: M, y: y - 38, size: 15, font: fb, color: rgb(0.05, 0.09, 0.21) });
    page.drawText(pdfSafe(ttPeriod(p)), { x: M, y: y - 53, size: 10, font: f, color: rgb(0.2, 0.2, 0.2) });
    const who = p.type === 'admin' ? 'All teachers and students' : (p.type === 'student' ? 'Student: ' : 'Teacher: ') + (p.name || '');
    const ww = fb.widthOfTextAtSize(pdfSafe(who), 10); page.drawText(pdfSafe(who), { x: W - M - ww, y: y - 38, size: 10, font: fb });
    page.drawLine({ start: { x: M, y: y - 61 }, end: { x: W - M, y: y - 61 }, thickness: 1.6, color: rgb(0.65, 0.49, 0.12) });
    y -= 72;
    // the column headings, on every page
    const hh = LH + PAD * 2; let x = M;
    cols.forEach((h, i) => { page.drawRectangle({ x, y: y - hh, width: widths[i], height: hh, color: rgb(0.94, 0.9, 0.8), borderColor: rgb(0.55, 0.55, 0.55), borderWidth: 0.6 }); page.drawText(pdfSafe(h), { x: x + PAD, y: y - hh + PAD + 2.5, size: FS, font: fb }); x += widths[i]; });
    y -= hh;
  };
  header();
  body.forEach((r) => {
    const cellLines = r.empty ? [wrap(r.cells[0], widths[0], fb), wrap(r.cells[1], widths[1], f), wrap(r.cells[2], widths.slice(2).reduce((a, b) => a + b, 0), f)]
      : r.cells.map((c, i) => wrap(c, widths[i], i === 0 ? fb : f));
    const rh = Math.max(...cellLines.map((l) => l.length)) * LH + PAD * 2;
    if (y - rh < M + 20) header();
    let x = M;
    const spans = r.empty ? [widths[0], widths[1], widths.slice(2).reduce((a, b) => a + b, 0)] : widths;
    spans.forEach((w, i) => {
      page.drawRectangle({ x, y: y - rh, width: w, height: rh, color: r.empty ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1), borderColor: rgb(0.55, 0.55, 0.55), borderWidth: 0.6 });
      cellLines[i].forEach((line, k) => page.drawText(line, { x: x + PAD, y: y - PAD - (k + 1) * LH + 2.5, size: FS, font: i === 0 ? fb : f, color: r.empty && i > 0 ? rgb(0.45, 0.45, 0.45) : rgb(0.07, 0.07, 0.07) }));
      x += w;
    });
    if (r.first) page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: rgb(0.2, 0.2, 0.2) });
    y -= rh;
  });
  pages.forEach((pg, i) => pg.drawText(`Page ${i + 1} of ${pages.length}  -  Cancelled lessons are not shown.`, { x: M, y: M - 14, size: 7.5, font: f, color: rgb(0.45, 0.45, 0.45) }));
  return await doc.save();
}
function b64(bytes: Uint8Array) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
async function logTT(sb: any, p: any, from: string, to: string, status: string, error: string | null) {
  try { await sb.rpc('log_timetable_notification', { p_type: p.type, p_ref: String(p.ref ?? ''), p_name: p.name || null, p_email: p.email || null, p_from: from, p_to: to, p_lessons: (p.rows || []).length, p_hash: p.hash || null, p_status: status, p_error: error }); } catch (_) { /* the email itself matters more than its log */ }
}

/* ---- lessons deleted in bulk: tell the student and their teacher(s) which upcoming lessons were removed ---- */
function removedHtml(name: string, rows: any[], who: 'student' | 'teacher', site: string) {
  const td = 'padding:9px 10px;border:1px solid #E9DDBA;font:14px Arial,sans-serif;color:#1C1A17';
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#F4EEDF;padding:24px 10px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#FBF7EC;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(10,17,41,.15)">
    <tr><td style="background:#0E1736;background-image:linear-gradient(135deg,#0A1129,#26366F);padding:24px;text-align:center">
      <div style="font:700 12px Arial,sans-serif;letter-spacing:.22em;color:#D4AF37">TAHFEEZ DARESSALAAM</div>
      <div style="font:700 23px Georgia,serif;color:#F4DE9C;margin-top:8px">Lessons removed from the schedule</div></td></tr>
    <tr><td style="padding:22px 24px 8px;font:15px/1.6 Arial,sans-serif;color:#1C1A17">Salaam ${esc(String(name || '').split(' ')[0])},<br>${who === 'student' ? 'These lessons have been taken off your schedule:' : 'These lessons have been taken off your teaching schedule:'}</td></tr>
    <tr><td style="padding:6px 24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
      <tr>${['Day', 'Date', who === 'student' ? 'Teacher' : 'Student', 'Time'].map((h) => `<th style="padding:8px 10px;border:1px solid #E2D3A8;background:#0E1736;color:#F4DE9C;font:700 12px Arial,sans-serif;text-align:left">${h}</th>`).join('')}</tr>
      ${rows.map((r) => `<tr><td style="${td};font-weight:700;color:#A67C1E">${esc(ttDay(r.date))}</td><td style="${td};white-space:nowrap">${esc(ttDate(r.date))}</td><td style="${td}">${esc(who === 'student' ? r.teacher : r.student)}</td><td style="${td};white-space:nowrap;text-decoration:line-through">${esc(tt12(r.from))} - ${esc(tt12(r.to))}</td></tr>`).join('')}
    </table></td></tr>
    <tr><td align="center" style="padding:22px 24px 10px"><a href="${esc(site)}" style="display:inline-block;padding:13px 26px;border-radius:999px;background:#D4AF37;background-image:linear-gradient(180deg,#F4DE9C,#C9A23A);color:#1C1A17;font:700 15px Arial,sans-serif;text-decoration:none">Open my schedule</a></td></tr>
    <tr><td style="padding:10px 24px 24px;text-align:center;font:12px/1.5 Arial,sans-serif;color:#8A8270">Tahfeez Daressalaam · Schedule notification</td></tr>
  </table></td></tr></table></body></html>`;
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const body = await req.json().catch(() => ({}));
    const site = (Deno.env.get('SITE_URL') || String(body.site || '') || 'https://tahfeezdaressalaam.com/institute.html').split('#')[0];
    const vapid = { publicKey: Deno.env.get('VAPID_PUBLIC_KEY') || DEFAULT_PUBLIC, privateKey: Deno.env.get('VAPID_PRIVATE_KEY') || '', subject: Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@tahfeezdaressalaam.com' };
    const pushOn = !!vapid.privateKey;

    if (body.test) {
      const { data: subs, error } = await sb.rpc('my_push_subscriptions');
      if (error) return json({ error: 'Please sign in again.' }, 401);
      if (!pushOn) return json({ error: 'Phone alerts are not set up on the server yet (VAPID_PRIVATE_KEY missing).' }, 500);
      let ok = 0;
      for (const s of (subs || []) as any[]) {
        const st = await sendPush(s, { title: 'Alerts are on', body: 'You will be told here when students are allocated to you.', url: site + '#schedule', tag: 'test' }, vapid).catch(() => 0);
        if (st >= 200 && st < 300) ok++; else if (st === 404 || st === 410) await sb.rpc('drop_push_subscription', { p_endpoint: s.endpoint });
      }
      return json({ ok: true, pushed: ok, devices: (subs || []).length });
    }

    if (body.manual) {
      const id = Number(body.id), to: string[] = (Array.isArray(body.to) ? body.to : []).filter((x: string) => ['student', 'teacher', 'admin'].includes(x));
      if (!id || !to.length) return json({ error: 'Choose who to notify.' }, 400);
      const { data: p, error: pe } = await sb.rpc('schedule_manual_payload', { p_id: id });
      if (pe) return json({ error: pe.message }, 403);
      const key = Deno.env.get('RESEND_API_KEY');
      if (!key) return json({ error: 'Email is not set up yet: add the RESEND_API_KEY secret to the notify-teacher function in Supabase.' }, 500);
      const studentSite = site.replace(/institute\.html.*$/, 'student.html');
      const results: any[] = [];
      for (const who of to) {
        const r = (p as any)[who] || {}, name = r.name || (who === 'admin' ? 'Administrator' : '');
        if (!r.email) { results.push({ type: who, name, email: null, sent: false, missing: true }); await log(sb, id, who, name, null, p.kind, 'missing', 'No email address saved', true); continue; }
        const ok = await sendMail(key, r.email, `${SUBJECT[p.kind] || SUBJECT.new}: ${p.student?.name || ''}, ${DAY(p.date)} ${p.from}`, manualHtml(p, who, name, who === 'student' ? studentSite : site + '#schedule'), manualText(p, name));
        results.push({ type: who, name, email: r.email, sent: ok, error: ok ? null : 'The email service did not accept it' });
        await log(sb, id, who, name, r.email, p.kind, ok ? 'sent' : 'failed', ok ? null : 'The email service did not accept it', true);
      }
      // once the student and the teacher have both been told, the automatic email will not repeat it
      const told = (k: string) => results.some((x) => x.type === k && x.sent);
      if (told('student') && told('teacher')) { try { await sb.rpc('mark_schedule_notified', { p_ids: [id] }); } catch (_) { /* not critical */ } }
      return json({ ok: true, kind: p.kind, results });
    }

    if (body.timetable) {
      const from = String(body.from || '').slice(0, 10), to = String(body.to || '').slice(0, 10), force = !!body.force;
      const list = (Array.isArray(body.recipients) ? body.recipients : []).filter((r: any) => r && ['student', 'teacher', 'admin'].includes(r.type)).slice(0, 300);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !list.length) return json({ error: 'Choose the period and who to send to.' }, 400);
      const key = Deno.env.get('RESEND_API_KEY');
      if (!key) return json({ error: 'Email is not set up yet: add the RESEND_API_KEY secret to the notify-teacher function in Supabase.' }, 500);
      const studentSite = site.replace(/institute\.html.*$/, 'student.html');
      const results: any[] = [];
      for (const r of list) {
        const { data: p, error: pe } = await sb.rpc('timetable_payload', { p_from: from, p_to: to, p_type: r.type, p_ref: String(r.ref ?? '') });
        if (pe) { if (/permission|allowed/i.test(pe.message)) return json({ error: pe.message }, 403); results.push({ type: r.type, ref: r.ref, name: '', email: null, status: 'failed', error: pe.message }); continue; }
        const base = { type: p.type, ref: p.ref, name: p.name, email: p.email, lessons: (p.rows || []).length };
        if (!p.email) { results.push({ ...base, status: 'missing' }); await logTT(sb, p, from, to, 'missing', 'No email address saved'); continue; }
        if (!force && p.last_hash && p.last_hash === p.hash) { results.push({ ...base, status: 'skipped' }); await logTT(sb, p, from, to, 'skipped', 'Unchanged since it was last sent'); continue; }
        let att: { filename: string; content: string }[] = [];
        try { att = [{ filename: pdfSafe(`Timetable ${p.type === 'admin' ? 'all lessons' : p.name} ${from} to ${to}.pdf`).replace(/[\\/:*?"<>|]/g, ''), content: b64(await ttPdf(p)) }]; } catch (_) { att = []; }
        const portal = p.type === 'student' ? studentSite : site;
        const ok = await sendMail(key, p.email, ttSubject(p), ttEmailHtml(p, { printUrl: portal + '#timetable', siteUrl: portal, pdf: att.length > 0 }), ttText(p), att);
        results.push({ ...base, status: ok ? 'sent' : 'failed', error: ok ? null : 'The email service did not accept it' });
        await logTT(sb, p, from, to, ok ? 'sent' : 'failed', ok ? null : 'The email service did not accept it');
      }
      return json({ ok: true, results });
    }

    if (body.removed) {
      const rids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n: number) => n > 0).slice(0, 1000) : [];
      if (!rids.length) return json({ ok: true, results: [] });
      const { data: p, error: pe } = await sb.rpc('schedule_removed_payload', { p_ids: rids });
      if (pe) return json({ error: pe.message }, 403);
      const lessons: any[] = (p && p.lessons) || [];
      if (!lessons.length) return json({ ok: true, lessons: 0, results: [] });
      const key = Deno.env.get('RESEND_API_KEY');
      if (!key) return json({ error: 'Email is not set up yet: add the RESEND_API_KEY secret to the notify-teacher function in Supabase.' }, 500);
      const studentSite = site.replace(/institute\.html.*$/, 'student.html');
      const results: any[] = [], st = p.student || {};
      const subj = (n: number) => n === 1 ? 'Hifz Lesson Cancelled' : `${n} Hifz Lessons Cancelled`;
      if (st.email) {
        const ok = await sendMail(key, st.email, subj(lessons.length), removedHtml(st.name, lessons, 'student', studentSite), `Salaam ${st.name},\n\nThese lessons were removed from your schedule:\n` + lessons.map((l) => `- ${DAY(l.date)}, ${l.from}-${l.to} with ${l.teacher}`).join('\n'));
        results.push({ type: 'student', name: st.name, email: st.email, sent: ok });
        for (const l of lessons) await log(sb, l.id, 'student', st.name, st.email, 'removed', ok ? 'sent' : 'failed', ok ? null : 'The email service did not accept it', true);
      } else results.push({ type: 'student', name: st.name, email: null, sent: false, missing: true });
      for (const t of (p.teachers || []) as any[]) {
        const mine = lessons.filter((l) => String(l.teacher_id) === String(t.id));
        if (!t.email) { results.push({ type: 'teacher', name: t.name, email: null, sent: false, missing: true }); continue; }
        const ok = await sendMail(key, t.email, subj(mine.length) + `: ${st.name || ''}`, removedHtml(t.name, mine, 'teacher', site + '#schedule'), `Salaam ${t.name},\n\nThese lessons were removed from your schedule:\n` + mine.map((l) => `- ${DAY(l.date)}, ${l.from}-${l.to}: ${l.student}`).join('\n'));
        results.push({ type: 'teacher', name: t.name, email: t.email, sent: ok });
        for (const l of mine) await log(sb, l.id, 'teacher', t.name, t.email, 'removed', ok ? 'sent' : 'failed', ok ? null : 'The email service did not accept it', true);
      }
      return json({ ok: true, lessons: lessons.length, results });
    }

    const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n: number) => n > 0).slice(0, 500) : [];
    if (!ids.length) return json({ ok: true, teachers: [] });
    const { data: payload, error } = await sb.rpc('schedule_notify_payload', { p_ids: ids });
    if (error) return json({ error: error.message }, 403);
    const groups = Array.isArray(payload) ? payload : (payload?.teachers || []);
    const pupils = Array.isArray(payload) ? [] : (payload?.students || []);
    const studentSite = site.replace(/institute\.html.*$/, 'student.html');

    const key = Deno.env.get('RESEND_API_KEY');
    const result: any[] = [], told: number[] = [];
    for (const g of (groups || []) as any[]) {
      const slots: Slot[] = g.slots || [];
      const r = { teacher: g.teacher_name, emailed: false, pushed: 0, email: !!g.email, devices: (g.subs || []).length };
      if (g.email && key) {
        r.emailed = await sendMail(key, g.email,
          !allNew(slots) ? (slots.length === 1 ? `Schedule change: ${slots[0].student}, ${changeLine(slots[0], 'teacher')}` : `${slots.length} changes to your schedule`)
            : slots.length === 1 ? `New student: ${slots[0].student}, ${DAY(slots[0].date)} at ${slots[0].from}` : `${slots.length} new students allocated to you`,
          emailHtml(g.teacher_name, slots, site), emailText(g.teacher_name, slots, site));
        for (const s of slots) await log(sb, s.id, 'teacher', g.teacher_name, g.email, s.kind || 'new', r.emailed ? 'sent' : 'failed', r.emailed ? null : 'The email service did not accept it', false);
      }
      if (pushOn) {
        const first = slots[0];
        const payload = {
          title: !allNew(slots) ? (slots.length === 1 ? `Schedule change: ${first.student}` : `${slots.length} changes to your schedule`) : slots.length === 1 ? `New student: ${first.student}` : `${slots.length} new students for you`,
          body: slots.length === 1 ? `${DAY(first.date)}, ${first.from}–${first.to}${changeLine(first, 'teacher') && first.kind !== 'new' ? ' · ' + changeLine(first, 'teacher') : first.handed_from ? ' · from ' + first.handed_from : ''}` : slots.slice(0, 4).map((s) => `${s.student} · ${DAY(s.date).split(' ')[0]} ${s.from}${s.kind && s.kind !== 'new' ? ' · ' + changeLine(s, 'teacher') : ''}`).join('\n'),
          url: site + '#schedule', tag: 'sched-' + g.teacher_id + '-' + Date.now(),
        };
        for (const s of (g.subs || []) as any[]) {
          const st = await sendPush(s, payload, vapid).catch(() => 0);
          if (st >= 200 && st < 300) r.pushed++; else if (st === 404 || st === 410) await sb.rpc('drop_push_subscription', { p_endpoint: s.endpoint });
        }
      }
      if (r.emailed || r.pushed) slots.forEach((s) => told.push(s.id));
      result.push(r);
    }
    // the students: their teacher, day and time
    const studs: any[] = [];
    for (const u of pupils as any[]) {
      const slots: SSlot[] = u.slots || [];
      const r = { student: u.name, email: !!u.email, emailed: false };
      if (u.email && key) {
        const changed = slots.some((s: any) => s.handed_from || (s.kind && s.kind !== 'new'));
        r.emailed = await sendMail(key, u.email,
          changed ? (slots.length === 1 ? `Class ${slots[0].kind === 'cancelled' ? 'cancelled' : 'changed'}: ${DAY(slots[0].date)} at ${slots[0].from} with ${slots[0].teacher}` : `Your class schedule has changed`) : slots.length === 1 ? `Your class: ${DAY(slots[0].date)} at ${slots[0].from} with ${slots[0].teacher}` : `Your class schedule: ${slots.length} classes`,
          studentHtml(u.name, slots, studentSite), studentText(u.name, slots, studentSite));
        for (const s of slots) await log(sb, s.id, 'student', u.name, u.email, s.kind || 'new', r.emailed ? 'sent' : 'failed', r.emailed ? null : 'The email service did not accept it', false);
      }
      if (r.emailed) slots.forEach((s) => told.push(s.id));
      studs.push(r);
    }
    if (told.length) await sb.rpc('mark_schedule_notified', { p_ids: [...new Set(told)] });
    return json({ ok: true, teachers: result, students: studs, email: !!key, push: pushOn });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
