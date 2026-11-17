// Sends email to a student: the welcome / fee-instructions email (kind 'welcome'),
// or an update written in the portal with fees due, progress and goal (kind 'update').
// Deploy:  supabase functions deploy send-welcome-email --no-verify-jwt   (the function checks the caller is admin/accounts itself)
// Secrets: supabase secrets set RESEND_API_KEY=re_xxx MAIL_FROM="Tahfeez Daressalaam <admin@tahfeezdaressalaam.com>"
// Only an admin or the accounts team can call it (checked with the caller's own login).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
// WhatsApp-style *bold* → <b>, new lines → <br>
const toHtml = (t: string) => esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
const toText = (t: string) => t.replace(/\*([^*\n]+)\*/g, '$1');
const money = (n: number, cur: string) => (cur || 'TSh') + ' ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const monthLabel = (k: string) => { const [y, m] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }); };
// Fee details from the student's saved record (same text as the portal's preview). A fee that was not entered is never guessed.
// deno-lint-ignore no-explicit-any
function feeSection(st: any, set: any): { text: string; missing: boolean } {
  const cur = set?.currency || 'TSh', fee = Number(st.monthly_fee || 0), reg = Number(set?.registration_fee || 0), v = Number(st.discount_value || 0);
  const eff = !v ? fee : Math.max(0, Math.round((st.discount_type === 'percent' ? fee * (1 - Math.min(100, v) / 100) : fee - v) * 100) / 100);
  const disc = !v ? '' : st.discount_type === 'percent' ? v + '% off' : money(v, cur) + ' off';
  const L = ['*Your Fees*'];
  if (st.program) L.push('Program: ' + st.program);
  const missing = !(fee > 0);
  if (missing) L.push('Monthly fee: *to be confirmed*', 'The accounts office will confirm your fee amount with you before you pay.');
  else {
    L.push('Monthly fee: ' + (disc ? money(fee, cur) : '*' + money(fee, cur) + '*'));
    if (disc) L.push('Discount: ' + disc + (st.discount_note ? ' (' + st.discount_note + ')' : ''), 'You pay each month: *' + money(eff, cur) + '*');
    else if (st.discount_note) L.push('Note: ' + st.discount_note);
  }
  if (reg > 0) L.push('Registration fee (one time): ' + money(reg, cur));
  if (/^\d{4}-\d{2}$/.test(st.start_month || '')) L.push('Fees start from: ' + monthLabel(st.start_month));
  if (!missing) L.push('Amount to pay now: *' + money(eff + reg, cur) + '*' + (reg > 0 ? ' (registration + first month)' : ' (first month)'));
  return { text: L.join('\n'), missing };
}
const withFees = (body: string, f: { text: string }) => {
  if (body.includes('{fees}')) return body.replace(/\{fees\}/g, f.text);
  let at = body.indexOf('*Fee Payment Instructions*');
  if (at < 0) { at = body.indexOf('\n\n'); at = at < 0 ? body.length : at + 2; }
  return body.slice(0, at) + f.text + '\n\n' + body.slice(at);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: role } = await sb.rpc('staff_role');
    if (role !== 'admin' && role !== 'accounts') return json({ error: 'Only the admin or accounts can send this email.' }, 403);
    const reqBody = await req.json().catch(() => ({}));
    const student_id = reqBody.student_id;
    if (!student_id) return json({ error: 'No student was given.' }, 400);
    const { data: st, error: e1 } = await sb.from('students').select('*').eq('id', student_id).single();
    if (e1 || !st) return json({ error: 'Student not found.' }, 404);
    if (!st.email) return json({ error: 'This student has no email address.' }, 400);
    const isUpdate = reqBody.kind === 'update';
    let subject: string, body: string, feeMissing = false;
    if (isUpdate) {
      // written in the portal for this student (fees due, progress, goal)
      subject = String(reqBody.subject || 'Your update from Tahfeez Daressalaam').slice(0, 200);
      body = String(reqBody.body || '').slice(0, 12000);
    } else {
      const { data: set } = await sb.from('settings').select('*').eq('id', 1).single();
      // The saved settings win; if they were never saved, use the text the portal sent (its built-in default).
      subject = String(set?.welcome_subject || reqBody.subject || 'Welcome to Tahfeez Daressalaam: complete your registration').slice(0, 200).replace(/\{name\}/g, st.full_name);
      body = String(set?.welcome_body || reqBody.body || '').slice(0, 8000).replace(/\{name\}/g, st.full_name);
      // the fee the student has to pay, from their enrollment record
      const fees = feeSection(st, set);
      if (body.trim()) body = withFees(body, fees);
      feeMissing = fees.missing;
    }
    if (!body.trim()) return json({ error: 'The welcome message is empty. Write a message first.' }, 400);
    const key = Deno.env.get('RESEND_API_KEY');
    if (!key) return json({ error: 'Email is not set up yet (RESEND_API_KEY missing).' }, 500);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('MAIL_FROM') || 'Tahfeez Daressalaam <onboarding@resend.dev>',
        to: [st.email], subject,
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1C1A17">${toHtml(body)}</div>`,
        text: toText(body),
      }),
    });
    if (!r.ok) return json({ error: 'The email service refused: ' + (await r.text()).slice(0, 200) }, 502);
    if (!isUpdate) await sb.from('students').update({ welcome_sent_at: new Date().toISOString() }).eq('id', st.id);
    return json({ ok: true, to: st.email, fee_missing: feeMissing });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
