-- =====================================================================
--  Update 2 — keys & rewards, monthly goals, Quran page progress,
--  notices (Word files), new name: Qism al Tahfeez Dar es Salaam.
--  Safe to run on a database that already has students and receipts.
-- =====================================================================

-- ------------------------------------------------------- staff roles
-- Admin: everything. Teacher: students' hifz, progress, ikhtibar, keys, notices (no fees).
-- Accounts: fees, receipts, reminders and discounts only (no hifz, no HR, no settings).
alter table public.admins add column if not exists role text not null default 'admin';
do $$ begin
  alter table public.admins add constraint admins_role_check check (role in ('admin', 'teacher', 'accounts'));
exception when duplicate_object then null; end $$;
create or replace function public.staff_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.admins where user_id = auth.uid()
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role = 'admin')
$$;
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;
create or replace function public.can_teach()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role in ('admin', 'teacher'))
$$;
create or replace function public.can_fees()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role in ('admin', 'accounts'))
$$;
revoke all on function public.staff_role() from public, anon;
revoke all on function public.is_staff() from public, anon;
revoke all on function public.can_teach() from public, anon;
revoke all on function public.can_fees() from public, anon;
grant execute on function public.staff_role() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.can_teach() to authenticated;
grant execute on function public.can_fees() to authenticated;

-- ------------------------------------------------------------ settings
alter table public.settings
  add column if not exists keys_jadeed   int not null default 3   check (keys_jadeed   >= 0),
  add column if not exists keys_ikhtibar int not null default 15  check (keys_ikhtibar >= 0),
  add column if not exists keys_goal     int not null default 10  check (keys_goal     >= 0),
  add column if not exists reward_every  int not null default 100 check (reward_every  >  0);
alter table public.settings alter column institute_name set default 'Qism al Tahfeez Dar es Salaam';
update public.settings set institute_name = 'Qism al Tahfeez Dar es Salaam' where institute_name in ('Mahad al-Zahra', '');

-- New receipts are numbered QT-26-00007 … (existing receipts keep their numbers)
alter table public.payments alter column receipt_no
  set default ('QT-' || to_char(now(), 'YY') || '-' || lpad(nextval('public.receipt_seq')::text, 5, '0'));

-- ------------------------------------------------------------ students
alter table public.students
  add column if not exists pages         int not null default 0 check (pages between 0 and 604),
  add column if not exists keys          int not null default 0 check (keys >= 0),
  add column if not exists rewards_given int not null default 0 check (rewards_given >= 0),
  add column if not exists rewards_seen  int not null default 0 check (rewards_seen >= 0);
update public.students set pages = least(604, juz * 20) where pages = 0 and juz > 0;

-- ------------------------------------------------- progress per month
create table if not exists public.progress_months (
  student_id   uuid not null references public.students (id) on delete cascade,
  month        text not null check (month ~ '^\d{4}-\d{2}$'),
  goal         int  not null default 0 check (goal >= 0),
  jadeed       int  not null default 0 check (jadeed >= 0),
  ikhtibar     int  not null default 0 check (ikhtibar >= 0),
  goal_awarded boolean not null default false,
  pages_end    int,
  updated_at   timestamptz not null default now(),
  primary key (student_id, month)
);

create table if not exists public.key_events (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.students (id) on delete cascade,
  kind       text not null check (kind in ('jadeed', 'ikhtibar', 'goal', 'bonus')),
  keys       int  not null,
  pages      int  not null default 0,
  month      text not null,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists key_events_student_idx on public.key_events (student_id, created_at desc);

-- -------------------------------------------------------------- notices
create table if not exists public.notices (
  id         bigint generated always as identity primary key,
  title      text not null,
  html       text not null default '',
  file_path  text,
  file_name  text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------- helpers
create or replace function public._ensure_month(p_student uuid, p_month text)
returns void language sql security definer set search_path = public as $$
  insert into public.progress_months (student_id, month, pages_end)
  select p_student, p_month, s.pages from public.students s where s.id = p_student
  on conflict (student_id, month) do nothing
$$;

-- Awards the monthly-goal keys once, when jadeed pages this month reach the goal.
create or replace function public._check_goal(p_student uuid, p_month text)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.progress_months; v int;
begin
  select * into r from public.progress_months where student_id = p_student and month = p_month for update;
  if not found or r.goal_awarded or r.goal <= 0 or r.jadeed < r.goal then return false; end if;
  select keys_goal into v from public.settings where id = 1;
  update public.progress_months set goal_awarded = true, updated_at = now() where student_id = p_student and month = p_month;
  insert into public.key_events (student_id, kind, keys, month, note)
  values (p_student, 'goal', v, p_month, 'Monthly goal of ' || r.goal || ' pages reached');
  update public.students set keys = keys + v where id = p_student;
  return true;
end $$;

-- ------------------------------------------------- institute actions
create or replace function public.record_jadeed(p_student uuid, p_month text, p_pages int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare v_k int; v_pages int; v_event bigint; v_goal boolean;
begin
  if not public.can_teach() then raise exception 'Only the institute can record progress.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if coalesce(p_pages, 0) < 1 or p_pages > 100 then raise exception 'Pages must be between 1 and 100.'; end if;
  select keys_jadeed into v_k from public.settings where id = 1;
  perform public._ensure_month(p_student, p_month);
  update public.students set pages = least(604, pages + p_pages), keys = keys + v_k * p_pages
   where id = p_student returning pages into v_pages;
  if not found then raise exception 'Student not found.'; end if;
  update public.progress_months set jadeed = jadeed + p_pages, pages_end = v_pages, updated_at = now()
   where student_id = p_student and month = p_month;
  insert into public.key_events (student_id, kind, keys, pages, month, note)
  values (p_student, 'jadeed', v_k * p_pages, p_pages, p_month,
          case when p_pages = 1 then 'Jadeed page cleared' else 'Jadeed: ' || p_pages || ' pages cleared' end)
  returning id into v_event;
  v_goal := public._check_goal(p_student, p_month);
  return json_build_object('event_id', v_event, 'goal_reached', v_goal,
    'pages', v_pages, 'keys', (select keys from public.students where id = p_student));
end $$;

create or replace function public.record_ikhtibar(p_student uuid, p_month text, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_k int; v_event bigint;
begin
  if not public.can_teach() then raise exception 'Only the institute can record progress.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  select keys_ikhtibar into v_k from public.settings where id = 1;
  perform public._ensure_month(p_student, p_month);
  update public.students set keys = keys + v_k where id = p_student;
  if not found then raise exception 'Student not found.'; end if;
  update public.progress_months set ikhtibar = ikhtibar + 1, updated_at = now() where student_id = p_student and month = p_month;
  insert into public.key_events (student_id, kind, keys, month, note)
  values (p_student, 'ikhtibar', v_k, p_month, coalesce(nullif(trim(p_note), ''), 'Ikhtibar cleared'))
  returning id into v_event;
  return json_build_object('event_id', v_event, 'keys', (select keys from public.students where id = p_student));
end $$;

-- Set the monthly goal for one student, or for every student when p_student is null.
create or replace function public.set_month_goal(p_student uuid, p_month text, p_goal int)
returns int language plpgsql security definer set search_path = public as $$
declare s record; n int := 0;
begin
  if not public.can_teach() then raise exception 'Only the institute can set goals.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if coalesce(p_goal, -1) < 0 or p_goal > 604 then raise exception 'Goal must be between 0 and 604 pages.'; end if;
  for s in select id from public.students where p_student is null or id = p_student loop
    perform public._ensure_month(s.id, p_month);
    update public.progress_months set goal = p_goal, updated_at = now() where student_id = s.id and month = p_month;
    perform public._check_goal(s.id, p_month);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Correct / update the total pages memorised (no keys given).
create or replace function public.set_pages(p_student uuid, p_month text, p_pages int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_teach() then raise exception 'Only the institute can update pages.'; end if;
  if coalesce(p_pages, -1) < 0 or p_pages > 604 then raise exception 'Pages must be between 0 and 604.'; end if;
  update public.students set pages = p_pages where id = p_student;
  if not found then raise exception 'Student not found.'; end if;
  perform public._ensure_month(p_student, p_month);
  update public.progress_months set pages_end = p_pages, updated_at = now() where student_id = p_student and month = p_month;
end $$;

create or replace function public.undo_key_event(p_event bigint)
returns void language plpgsql security definer set search_path = public as $$
declare e public.key_events; v_pages int;
begin
  if not public.can_teach() then raise exception 'Only the institute can undo progress.'; end if;
  select * into e from public.key_events where id = p_event for update;
  if not found then raise exception 'This entry was already removed.'; end if;
  update public.students set keys = greatest(0, keys - e.keys), pages = greatest(0, pages - e.pages)
   where id = e.student_id returning pages into v_pages;
  if e.kind = 'jadeed' then
    update public.progress_months set jadeed = greatest(0, jadeed - e.pages), pages_end = v_pages, updated_at = now()
     where student_id = e.student_id and month = e.month;
  elsif e.kind = 'ikhtibar' then
    update public.progress_months set ikhtibar = greatest(0, ikhtibar - 1), updated_at = now()
     where student_id = e.student_id and month = e.month;
  elsif e.kind = 'goal' then
    update public.progress_months set goal_awarded = false, updated_at = now()
     where student_id = e.student_id and month = e.month;
  end if;
  delete from public.key_events where id = p_event;
end $$;

create or replace function public.give_reward(p_student uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not public.can_teach() then raise exception 'Only the institute can mark rewards.'; end if;
  update public.students s set rewards_given = rewards_given + 1
   where s.id = p_student and s.rewards_given < floor(s.keys::numeric / (select reward_every from public.settings where id = 1))
  returning rewards_given into v;
  if v is null then raise exception 'No reward is due for this student.'; end if;
  return v;
end $$;

-- ------------------------------------------------- student action
create or replace function public.mark_reward_seen(p_level int)
returns void language sql security definer set search_path = public as $$
  update public.students s
     set rewards_seen = greatest(s.rewards_seen, least(p_level, floor(s.keys::numeric / (select reward_every from public.settings where id = 1))::int))
   where s.id = auth.uid()
$$;

revoke all on function public._ensure_month(uuid, text) from public, anon, authenticated;
revoke all on function public._check_goal(uuid, text) from public, anon, authenticated;
revoke all on function public.record_jadeed(uuid, text, int) from public, anon;
revoke all on function public.record_ikhtibar(uuid, text, text) from public, anon;
revoke all on function public.set_month_goal(uuid, text, int) from public, anon;
revoke all on function public.set_pages(uuid, text, int) from public, anon;
revoke all on function public.undo_key_event(bigint) from public, anon;
revoke all on function public.give_reward(uuid) from public, anon;
revoke all on function public.mark_reward_seen(int) from public, anon;
grant execute on function public.record_jadeed(uuid, text, int) to authenticated;
grant execute on function public.record_ikhtibar(uuid, text, text) to authenticated;
grant execute on function public.set_month_goal(uuid, text, int) to authenticated;
grant execute on function public.set_pages(uuid, text, int) to authenticated;
grant execute on function public.undo_key_event(bigint) to authenticated;
grant execute on function public.give_reward(uuid) to authenticated;
grant execute on function public.mark_reward_seen(int) to authenticated;

-- ------------------------------------------------ row-level security
alter table public.progress_months enable row level security;
alter table public.key_events      enable row level security;
alter table public.notices         enable row level security;

drop policy if exists "progress: institute all" on public.progress_months;
drop policy if exists "progress: read own"      on public.progress_months;
create policy "progress: institute all" on public.progress_months for all    to authenticated using (public.can_teach()) with check (public.can_teach());
create policy "progress: read own"      on public.progress_months for select to authenticated using (student_id = auth.uid());

drop policy if exists "keys: institute read" on public.key_events;
drop policy if exists "keys: read own"       on public.key_events;
create policy "keys: institute read" on public.key_events for select to authenticated using (public.can_teach());
create policy "keys: read own"       on public.key_events for select to authenticated using (student_id = auth.uid());

drop policy if exists "notices: signed-in read" on public.notices;
drop policy if exists "notices: institute all"  on public.notices;
create policy "notices: signed-in read" on public.notices for select to authenticated using (true);
create policy "notices: institute all"  on public.notices for all    to authenticated using (public.can_teach()) with check (public.can_teach());

grant select on public.progress_months to authenticated;
grant select on public.key_events to authenticated;
grant select, insert, update, delete on public.notices to authenticated;
revoke all on public.progress_months, public.key_events, public.notices from anon;

-- Students see new keys appear live.
do $$ begin
  alter publication supabase_realtime add table public.key_events;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ------------------------------------------- Word files (storage bucket)
insert into storage.buckets (id, name, public, file_size_limit)
values ('notices', 'notices', false, 15728640)
on conflict (id) do nothing;

drop policy if exists "notice files: signed-in read"   on storage.objects;
drop policy if exists "notice files: institute upload" on storage.objects;
drop policy if exists "notice files: institute update" on storage.objects;
drop policy if exists "notice files: institute delete" on storage.objects;
create policy "notice files: signed-in read"   on storage.objects for select to authenticated using (bucket_id = 'notices');
create policy "notice files: institute upload" on storage.objects for insert to authenticated with check (bucket_id = 'notices' and public.can_teach());
create policy "notice files: institute update" on storage.objects for update to authenticated using (bucket_id = 'notices' and public.can_teach()) with check (bucket_id = 'notices' and public.can_teach());
create policy "notice files: institute delete" on storage.objects for delete to authenticated using (bucket_id = 'notices' and public.can_teach());

-- ------------------------------------------------------ student details
alter table public.students
  add column if not exists admission_no  text,
  add column if not exists its_no        text,
  add column if not exists program       text,
  add column if not exists guardian_name text,
  add column if not exists dob           date,
  add column if not exists gender        text,
  add column if not exists email         text;
create index if not exists students_its_idx on public.students (its_no);

-- Students fill in the details the institute does not have.
create or replace function public.update_my_details(p_guardian_name text, p_phone text, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
        v_email text := lower(trim(coalesce(p_email, '')));
begin
  if auth.uid() is null or not exists (select 1 from public.students where id = auth.uid()) then
    raise exception 'Please sign in again.';
  end if;
  if length(trim(coalesce(p_guardian_name, ''))) > 100 then raise exception 'Name is too long.'; end if;
  if v_phone <> '' and length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 9 and 15 then
    raise exception 'Mobile number should have 9 to 15 digits.';
  end if;
  if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email address is not valid.'; end if;
  update public.students
     set guardian_name = nullif(trim(p_guardian_name), ''), phone = nullif(v_phone, ''), email = nullif(v_email, '')
   where id = auth.uid();
end $$;
revoke all on function public.update_my_details(text, text, text) from public, anon;
grant execute on function public.update_my_details(text, text, text) to authenticated;

-- ------------------------------------------- disable / enable a student
-- A disabled student cannot sign in; all receipts, keys and details are kept.
alter table public.students add column if not exists disabled_at timestamptz;

create or replace function public.set_student_disabled(p_student uuid, p_disabled boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Only the institute can disable students.'; end if;
  update public.students set disabled_at = case when p_disabled then coalesce(disabled_at, now()) else null end where id = p_student;
  if not found then raise exception 'Student not found.'; end if;
  update auth.users set banned_until = case when p_disabled then '2999-12-31 00:00:00+00'::timestamptz else null end, updated_at = now()
   where id = p_student;
end $$;
revoke all on function public.set_student_disabled(uuid, boolean) from public, anon;
grant execute on function public.set_student_disabled(uuid, boolean) to authenticated;

-- Goals set "for everyone" skip disabled students.
create or replace function public.set_month_goal(p_student uuid, p_month text, p_goal int)
returns int language plpgsql security definer set search_path = public as $$
declare s record; n int := 0;
begin
  if not public.can_teach() then raise exception 'Only the institute can set goals.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if coalesce(p_goal, -1) < 0 or p_goal > 604 then raise exception 'Goal must be between 0 and 604 pages.'; end if;
  for s in select id from public.students where (p_student is null and disabled_at is null) or id = p_student loop
    perform public._ensure_month(s.id, p_month);
    update public.progress_months set goal = p_goal, updated_at = now() where student_id = s.id and month = p_month;
    perform public._check_goal(s.id, p_month);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ===================================================== fee reminders
-- Reminders the institute sends; the student also sees them in their portal.
create table if not exists public.reminders (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.students (id) on delete cascade,
  message    text not null,
  amount     numeric(12,2),
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists reminders_student_idx on public.reminders (student_id, created_at desc);

create or replace function public.mark_reminder_seen(p_id bigint)
returns void language sql security definer set search_path = public as $$
  update public.reminders set seen_at = now() where id = p_id and student_id = auth.uid() and seen_at is null
$$;
revoke all on function public.mark_reminder_seen(bigint) from public, anon;
grant execute on function public.mark_reminder_seen(bigint) to authenticated;

alter table public.reminders enable row level security;
drop policy if exists "reminders: institute all"    on public.reminders;
drop policy if exists "reminders: read own"         on public.reminders;
create policy "reminders: institute all"    on public.reminders     for all to authenticated using (public.can_fees()) with check (public.can_fees());
create policy "reminders: read own"         on public.reminders     for select to authenticated using (student_id = auth.uid());
grant select, insert, update, delete on public.reminders to authenticated;
revoke all on public.reminders from anon;

do $$ begin
  alter publication supabase_realtime add table public.reminders;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ----------------------------------------------- accounts (institute only)
create table if not exists public.finance_entries (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('income', 'expense')),
  category   text not null,
  amount     numeric(14,2) not null check (amount > 0),
  entry_date date not null default current_date,
  party      text,
  note       text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists finance_entries_date_idx on public.finance_entries (entry_date);
alter table public.finance_entries enable row level security;
drop policy if exists "finance: institute all" on public.finance_entries;
create policy "finance: institute all" on public.finance_entries for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.finance_entries to authenticated;
revoke all on public.finance_entries from anon;

-- Monthly fee discount per student: a fixed amount or a percentage
alter table public.students add column if not exists discount_type  text not null default 'amount' check (discount_type in ('amount', 'percent'));
alter table public.students add column if not exists discount_value numeric(12,2) not null default 0 check (discount_value >= 0);
alter table public.students add column if not exists discount_note  text;
alter table public.settings add column if not exists reminder_template text not null default
  'Dear {name}, this is a kind reminder from {institute}: fees for {months} are not paid yet. Balance due: {balance}. Thank you.';

-- ------------------------------------------------- HR (institute only)
-- One flexible table for teachers, ratings, payroll, attendance, leave and student ratings.
create table if not exists public.hr_records (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('teacher', 'teacher_rating', 'payroll', 'attendance', 'leave', 'student_rating')),
  data       jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_records_kind_idx on public.hr_records (kind);
alter table public.hr_records enable row level security;
drop policy if exists "hr: institute all" on public.hr_records;
create policy "hr: institute all" on public.hr_records for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.hr_records to authenticated;
revoke all on public.hr_records from anon;

-- ------------------------------------- students rate their teachers (1–5)
-- Criteria: punctuality, concentration, listening, teaching, coaching, attitude, ownership.
-- The institute sees averages and comments; it does not see which student gave which rating.
create table if not exists public.teacher_feedback (
  id         bigint generated always as identity primary key,
  teacher_id bigint not null references public.hr_records (id) on delete cascade,
  student_id uuid   not null references public.students (id) on delete cascade,
  month      text   not null check (month ~ '^\d{4}-\d{2}$'),
  scores     jsonb  not null,
  comment    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, student_id, month)
);
alter table public.teacher_feedback enable row level security;
drop policy if exists "feedback: read own" on public.teacher_feedback;
create policy "feedback: read own" on public.teacher_feedback for select to authenticated using (student_id = auth.uid());
grant select on public.teacher_feedback to authenticated;
revoke all on public.teacher_feedback from anon;

-- Teachers a student may rate (names and roles only, never salaries).
create or replace function public.teachers_for_students()
returns table (id bigint, full_name text, role text) language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.students where students.id = auth.uid()) and not public.is_staff() then
    raise exception 'Please sign in again.';
  end if;
  return query select h.id, h.data->>'full_name', coalesce(h.data->>'role', '')
    from public.hr_records h where h.kind = 'teacher' and coalesce(h.data->>'status', 'Active') <> 'Left'
    order by 2;
end $$;

create or replace function public.rate_teacher(p_teacher bigint, p_month text, p_scores jsonb, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare k text; v int; clean jsonb := '{}'::jsonb;
begin
  if not exists (select 1 from public.students where id = auth.uid() and disabled_at is null) then raise exception 'Please sign in again.'; end if;
  if not exists (select 1 from public.hr_records where id = p_teacher and kind = 'teacher') then raise exception 'Teacher not found.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' or p_month > to_char(now(), 'YYYY-MM') then raise exception 'Month is not valid.'; end if;
  foreach k in array array['punctuality', 'concentration', 'listening', 'teaching', 'coaching', 'attitude', 'ownership'] loop
    begin v := (p_scores->>k)::int; exception when others then v := null; end;
    if v is null or v < 1 or v > 5 then raise exception 'Please give every question 1 to 5 stars.'; end if;
    clean := clean || jsonb_build_object(k, v);
  end loop;
  insert into public.teacher_feedback (teacher_id, student_id, month, scores, comment)
  values (p_teacher, auth.uid(), p_month, clean, nullif(left(trim(coalesce(p_comment, '')), 500), ''))
  on conflict (teacher_id, student_id, month)
  do update set scores = excluded.scores, comment = excluded.comment, updated_at = now();
end $$;

-- For the institute: averages per teacher and month, plus comments, without student names.
create or replace function public.teacher_feedback_summary(p_from text, p_to text)
returns table (teacher_id bigint, month text, responses int, avg_scores jsonb, comments text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the institute can see teacher feedback.'; end if;
  return query
    select f.teacher_id, f.month, count(*)::int,
      jsonb_build_object(
        'punctuality',   round(avg((f.scores->>'punctuality')::numeric), 2),
        'concentration', round(avg((f.scores->>'concentration')::numeric), 2),
        'listening',     round(avg((f.scores->>'listening')::numeric), 2),
        'teaching',      round(avg((f.scores->>'teaching')::numeric), 2),
        'coaching',      round(avg((f.scores->>'coaching')::numeric), 2),
        'attitude',      round(avg((f.scores->>'attitude')::numeric), 2),
        'ownership',     round(avg((f.scores->>'ownership')::numeric), 2)),
      array_remove(array_agg(f.comment order by random()), null)
    from public.teacher_feedback f
    where f.month between p_from and p_to
    group by f.teacher_id, f.month;
end $$;

revoke all on function public.teachers_for_students() from public, anon;
revoke all on function public.rate_teacher(bigint, text, jsonb, text) from public, anon;
revoke all on function public.teacher_feedback_summary(text, text) from public, anon;
grant execute on function public.teachers_for_students() to authenticated;
grant execute on function public.rate_teacher(bigint, text, jsonb, text) to authenticated;
grant execute on function public.teacher_feedback_summary(text, text) to authenticated;

-- ===================================================== page goals & monthly report
-- Each month: the page the student started on, the goal page, the page reached,
-- and the teacher's report (ajza to improve, ahkaam/makharij, murajaat, dawrat).
alter table public.progress_months
  add column if not exists start_page   int check (start_page between 0 and 604),
  add column if not exists goal_page    int check (goal_page between 0 and 604),
  add column if not exists ajza_improve text,
  add column if not exists ahkaam       text,
  add column if not exists murajaat     int check (murajaat >= 0),
  add column if not exists dawrat       int check (dawrat >= 0),
  add column if not exists report_note  text;

create or replace function public._ensure_month(p_student uuid, p_month text)
returns void language sql security definer set search_path = public as $$
  insert into public.progress_months (student_id, month, pages_end, start_page)
  select p_student, p_month, s.pages, s.pages from public.students s where s.id = p_student
  on conflict (student_id, month) do nothing
$$;

-- Goal reached = page reached that month is at or past the goal page
-- (or, for older goals set as a number of pages, enough jadeed pages).
create or replace function public._check_goal(p_student uuid, p_month text)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.progress_months; v int; reached int; ok boolean;
begin
  select * into r from public.progress_months where student_id = p_student and month = p_month for update;
  if not found or r.goal_awarded then return false; end if;
  reached := coalesce(r.pages_end, (select pages from public.students where id = p_student));
  if coalesce(r.goal_page, 0) > 0 then ok := reached >= r.goal_page and r.goal_page > coalesce(r.start_page, 0);
  else ok := r.goal > 0 and r.jadeed >= r.goal; end if;
  if not ok then return false; end if;
  select keys_goal into v from public.settings where id = 1;
  update public.progress_months set goal_awarded = true, updated_at = now() where student_id = p_student and month = p_month;
  insert into public.key_events (student_id, kind, keys, month, note)
  values (p_student, 'goal', v, p_month,
          case when coalesce(r.goal_page, 0) > 0 then 'Monthly goal reached: page ' || r.goal_page else 'Monthly goal of ' || r.goal || ' pages reached' end);
  update public.students set keys = keys + v where id = p_student;
  return true;
end $$;

-- "+N pages" goal for one student or everyone (from the page each is on).
create or replace function public.set_month_goal(p_student uuid, p_month text, p_goal int)
returns int language plpgsql security definer set search_path = public as $$
declare s record; n int := 0;
begin
  if not public.can_teach() then raise exception 'Only the institute can set goals.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if coalesce(p_goal, -1) < 0 or p_goal > 604 then raise exception 'Goal must be between 0 and 604 pages.'; end if;
  for s in select id from public.students where (p_student is null and disabled_at is null) or id = p_student loop
    perform public._ensure_month(s.id, p_month);
    update public.progress_months set goal = p_goal,
           goal_page = case when p_goal = 0 then null else least(604, coalesce(start_page, pages_end, 0) + p_goal) end,
           updated_at = now()
     where student_id = s.id and month = p_month;
    perform public._check_goal(s.id, p_month);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Save one month for a student, any month (past or present).
create or replace function public.save_month_report(
  p_student uuid, p_month text, p_start_page int, p_goal_page int, p_end_page int,
  p_ajza text, p_ahkaam text, p_murajaat int, p_dawrat int, p_note text)
returns json language plpgsql security definer set search_path = public as $$
declare v_goal boolean; cur text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM');
begin
  if not public.can_teach() then raise exception 'Only the institute can save reports.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if (p_start_page is not null and (p_start_page < 0 or p_start_page > 604)) or (p_goal_page is not null and (p_goal_page < 0 or p_goal_page > 604))
     or (p_end_page is not null and (p_end_page < 0 or p_end_page > 604)) then raise exception 'Pages must be between 0 and 604.'; end if;
  if p_goal_page is not null and p_start_page is not null and p_goal_page <= p_start_page then raise exception 'The goal page must be after the starting page.'; end if;
  if not exists (select 1 from public.students where id = p_student) then raise exception 'Student not found.'; end if;
  perform public._ensure_month(p_student, p_month);
  update public.progress_months set
    start_page = p_start_page, goal_page = p_goal_page, pages_end = coalesce(p_end_page, pages_end),
    goal = case when p_goal_page is not null and p_start_page is not null then p_goal_page - p_start_page else goal end,
    ajza_improve = nullif(trim(coalesce(p_ajza, '')), ''), ahkaam = nullif(trim(coalesce(p_ahkaam, '')), ''),
    murajaat = p_murajaat, dawrat = p_dawrat, report_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
  where student_id = p_student and month = p_month;
  -- the page reached this month is the page the student is on now
  if p_month >= cur and p_end_page is not null then update public.students set pages = p_end_page where id = p_student; end if;
  v_goal := public._check_goal(p_student, p_month);
  return json_build_object('goal_reached', v_goal, 'keys', (select keys from public.students where id = p_student));
end $$;
revoke all on function public.save_month_report(uuid, text, int, int, int, text, text, int, int, text) from public, anon;
grant execute on function public.save_month_report(uuid, text, int, int, int, text, text, int, int, text) to authenticated;

-- ===================================================== ikhtibar dates
create table if not exists public.ikhtibars (
  id           bigint generated always as identity primary key,
  student_id   uuid not null references public.students (id) on delete cascade,
  exam_date    date not null,
  title        text not null default 'Ikhtibar',
  status       text not null default 'scheduled' check (status in ('scheduled', 'cleared', 'not_cleared')),
  note         text,
  key_event_id bigint,
  quick        boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists ikhtibars_student_idx on public.ikhtibars (student_id, exam_date);
alter table public.ikhtibars enable row level security;
drop policy if exists "ikhtibar: institute all" on public.ikhtibars;
drop policy if exists "ikhtibar: read own"      on public.ikhtibars;
create policy "ikhtibar: institute all" on public.ikhtibars for all    to authenticated using (public.can_teach()) with check (public.can_teach());
create policy "ikhtibar: read own"      on public.ikhtibars for select to authenticated using (student_id = auth.uid());
grant select, insert, update, delete on public.ikhtibars to authenticated;
revoke all on public.ikhtibars from anon;

create or replace function public._award_ikhtibar(p_student uuid, p_month text, p_note text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_k int; v_event bigint;
begin
  select keys_ikhtibar into v_k from public.settings where id = 1;
  perform public._ensure_month(p_student, p_month);
  update public.students set keys = keys + v_k where id = p_student;
  update public.progress_months set ikhtibar = ikhtibar + 1, updated_at = now() where student_id = p_student and month = p_month;
  insert into public.key_events (student_id, kind, keys, month, note) values (p_student, 'ikhtibar', v_k, p_month, p_note) returning id into v_event;
  return v_event;
end $$;
revoke all on function public._award_ikhtibar(uuid, text, text) from public, anon, authenticated;

-- Quick "Ikhtibar cleared" today (also listed in the student's ikhtibar history).
create or replace function public.record_ikhtibar(p_student uuid, p_month text, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_event bigint; v_title text := coalesce(nullif(trim(p_note), ''), 'Ikhtibar');
begin
  if not public.can_teach() then raise exception 'Only the institute can record progress.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if not exists (select 1 from public.students where id = p_student) then raise exception 'Student not found.'; end if;
  v_event := public._award_ikhtibar(p_student, p_month, 'Ikhtibar cleared' || case when v_title <> 'Ikhtibar' then ': ' || v_title else '' end);
  insert into public.ikhtibars (student_id, exam_date, title, status, key_event_id, quick)
  values (p_student, case when p_month = to_char(current_date, 'YYYY-MM') then current_date else (p_month || '-01')::date end, v_title, 'cleared', v_event, true);
  return json_build_object('event_id', v_event, 'keys', (select keys from public.students where id = p_student));
end $$;

-- Result for a scheduled ikhtibar: cleared gives keys, not cleared gives none.
create or replace function public.ikhtibar_result(p_id bigint, p_status text, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare x public.ikhtibars; v_event bigint;
begin
  if not public.can_teach() then raise exception 'Only the institute can record results.'; end if;
  if p_status not in ('scheduled', 'cleared', 'not_cleared') then raise exception 'Result is not valid.'; end if;
  select * into x from public.ikhtibars where id = p_id for update;
  if not found then raise exception 'Ikhtibar not found.'; end if;
  if x.key_event_id is not null and p_status <> 'cleared' then
    perform public.undo_key_event(x.key_event_id);   -- takes the keys back
    select * into x from public.ikhtibars where id = p_id;
  end if;
  if p_status = 'cleared' and x.status <> 'cleared' then
    v_event := public._award_ikhtibar(x.student_id, to_char(x.exam_date, 'YYYY-MM'), 'Ikhtibar cleared: ' || x.title);
  end if;
  update public.ikhtibars set status = p_status, note = coalesce(nullif(trim(p_note), ''), note),
         key_event_id = case when p_status = 'cleared' then coalesce(v_event, key_event_id) else null end
   where id = p_id;
  return json_build_object('event_id', v_event, 'keys', (select keys from public.students where id = x.student_id));
end $$;
revoke all on function public.ikhtibar_result(bigint, text, text) from public, anon;
grant execute on function public.ikhtibar_result(bigint, text, text) to authenticated;

-- Undo also updates the ikhtibar list.
create or replace function public.undo_key_event(p_event bigint)
returns void language plpgsql security definer set search_path = public as $$
declare e public.key_events; v_pages int;
begin
  if not public.can_teach() then raise exception 'Only the institute can undo progress.'; end if;
  select * into e from public.key_events where id = p_event for update;
  if not found then raise exception 'This entry was already removed.'; end if;
  update public.students set keys = greatest(0, keys - e.keys), pages = greatest(0, pages - e.pages)
   where id = e.student_id returning pages into v_pages;
  if e.kind = 'jadeed' then
    update public.progress_months set jadeed = greatest(0, jadeed - e.pages), pages_end = v_pages, updated_at = now()
     where student_id = e.student_id and month = e.month;
  elsif e.kind = 'ikhtibar' then
    update public.progress_months set ikhtibar = greatest(0, ikhtibar - 1), updated_at = now()
     where student_id = e.student_id and month = e.month;
    delete from public.ikhtibars where key_event_id = e.id and quick;
    update public.ikhtibars set status = 'scheduled', key_event_id = null where key_event_id = e.id;
  elsif e.kind = 'goal' then
    update public.progress_months set goal_awarded = false, updated_at = now()
     where student_id = e.student_id and month = e.month;
  end if;
  delete from public.key_events where id = p_event;
end $$;

-- ===================================================== notices: messages and any file type
alter table public.notices
  add column if not exists body      text,
  add column if not exists mime      text,
  add column if not exists file_size bigint;
update storage.buckets set file_size_limit = 52428800, allowed_mime_types = null where id = 'notices';

-- ===================================================== your own key rules (e.g. Discipline +5)
create table if not exists public.key_rules (
  id         bigint generated always as identity primary key,
  name       text not null check (length(trim(name)) between 1 and 60),
  keys       int  not null check (keys between -100 and 100 and keys <> 0),
  active     boolean not null default true,
  sort       int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.key_rules enable row level security;
drop policy if exists "rules: institute all" on public.key_rules;
drop policy if exists "rules: everyone read" on public.key_rules;
create policy "rules: institute all" on public.key_rules for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "rules: everyone read" on public.key_rules for select to authenticated using (true);
grant select, insert, update, delete on public.key_rules to authenticated;
revoke all on public.key_rules from anon;
alter table public.key_events add column if not exists rule_id bigint;

-- Give (or take away) a rule's keys to one or many students. The number of keys comes from the rule, not the browser.
create or replace function public.award_rule(p_students uuid[], p_rule bigint, p_month text, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare r public.key_rules; sid uuid; v_old int; v_new int; n int := 0;
begin
  if not public.can_teach() then raise exception 'Only the institute can give keys.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  select * into r from public.key_rules where id = p_rule;
  if not found then raise exception 'This key rule no longer exists.'; end if;
  foreach sid in array coalesce(p_students, '{}') loop
    select keys into v_old from public.students where id = sid for update;
    if not found then continue; end if;
    v_new := greatest(0, v_old + r.keys);
    update public.students set keys = v_new where id = sid;
    insert into public.key_events (student_id, kind, keys, month, note, rule_id)
    values (sid, 'bonus', v_new - v_old, p_month, r.name || coalesce(': ' || nullif(trim(p_note), ''), ''), r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.award_rule(uuid[], bigint, text, text) from public, anon;
grant execute on function public.award_rule(uuid[], bigint, text, text) to authenticated;

-- ===================================================== ikhtibar: cancel
alter table public.ikhtibars drop constraint if exists ikhtibars_status_check;
alter table public.ikhtibars add constraint ikhtibars_status_check check (status in ('scheduled', 'cleared', 'not_cleared', 'cancelled'));
create or replace function public.ikhtibar_result(p_id bigint, p_status text, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare x public.ikhtibars; v_event bigint;
begin
  if not public.can_teach() then raise exception 'Only the institute can record results.'; end if;
  if p_status not in ('scheduled', 'cleared', 'not_cleared', 'cancelled') then raise exception 'Result is not valid.'; end if;
  select * into x from public.ikhtibars where id = p_id for update;
  if not found then raise exception 'Ikhtibar not found.'; end if;
  if x.key_event_id is not null and p_status <> 'cleared' then
    perform public.undo_key_event(x.key_event_id);   -- takes the keys back
    select * into x from public.ikhtibars where id = p_id;
    if not found then return json_build_object('event_id', null); end if;
  end if;
  if p_status = 'cleared' and x.status <> 'cleared' then
    v_event := public._award_ikhtibar(x.student_id, to_char(x.exam_date, 'YYYY-MM'), 'Ikhtibar cleared: ' || x.title);
  end if;
  update public.ikhtibars set status = p_status, note = coalesce(nullif(trim(p_note), ''), note),
         key_event_id = case when p_status = 'cleared' then coalesce(v_event, key_event_id) else null end
   where id = p_id;
  return json_build_object('event_id', v_event, 'keys', (select keys from public.students where id = x.student_id));
end $$;
revoke all on function public.ikhtibar_result(bigint, text, text) from public, anon;
grant execute on function public.ikhtibar_result(bigint, text, text) to authenticated;

-- ===================================================== leaderboard (first names only)
-- Top 10 by keys earned in a month, for students and the institute. Only first names leave the database.
create or replace function public.leaderboard(p_month text)
returns table (rank int, first_name text, keys int, is_me boolean)
language sql security definer stable set search_path = public as $$
  with earned as (
    select s.id, split_part(trim(s.full_name), ' ', 1) as first_name, coalesce(sum(e.keys) filter (where e.keys > 0), 0)::int as keys
      from public.students s left join public.key_events e on e.student_id = s.id and e.month = p_month
     where s.disabled_at is null
     group by s.id, s.full_name
  ), ranked as (
    select id, first_name, keys, (rank() over (order by keys desc))::int as rank from earned where keys > 0
  )
  select r.rank, r.first_name, r.keys, r.id = auth.uid()
    from ranked r
   where auth.uid() is not null and (r.rank <= 10 or r.id = auth.uid())
   order by r.rank, r.first_name
$$;
revoke all on function public.leaderboard(text) from public, anon;
grant execute on function public.leaderboard(text) to authenticated;

-- ===================================================== where the student is: surah + page
-- Some students start from the end (An-Nas) and go back, so the place in the mushaf (surah + page)
-- is kept apart from how much is memorised (students.pages = number of pages memorised).
alter table public.students
  add column if not exists cur_surah int check (cur_surah between 1 and 114),
  add column if not exists cur_pos   int check (cur_pos between 1 and 604);
alter table public.progress_months
  add column if not exists start_surah int check (start_surah between 1 and 114),
  add column if not exists start_pos   int check (start_pos between 1 and 604),
  add column if not exists goal_surah  int check (goal_surah between 1 and 114),
  add column if not exists goal_pos    int check (goal_pos between 1 and 604),
  add column if not exists end_surah   int check (end_surah between 1 and 114),
  add column if not exists end_pos     int check (end_pos between 1 and 604);

-- start_page / goal_page / pages_end are counts of pages memorised (start of month, target, reached).
drop function if exists public.save_month_report(uuid, text, int, int, int, text, text, int, int, text);
create or replace function public.save_month_report(
  p_student uuid, p_month text, p_start_page int, p_goal_page int, p_end_page int,
  p_ajza text, p_ahkaam text, p_murajaat int, p_dawrat int, p_note text,
  p_start_surah int default null, p_start_pos int default null, p_goal_surah int default null, p_goal_pos int default null,
  p_end_surah int default null, p_end_pos int default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_goal boolean; cur text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM');
begin
  if not public.can_teach() then raise exception 'Only the institute can save reports.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if (p_start_page is not null and (p_start_page < 0 or p_start_page > 604)) or (p_goal_page is not null and (p_goal_page < 0 or p_goal_page > 604))
     or (p_end_page is not null and (p_end_page < 0 or p_end_page > 604)) then raise exception 'Pages memorised must be between 0 and 604.'; end if;
  if p_goal_page is not null and p_start_page is not null and p_goal_page <= p_start_page then raise exception 'Pages to memorise must be more than 0.'; end if;
  if not exists (select 1 from public.students where id = p_student) then raise exception 'Student not found.'; end if;
  perform public._ensure_month(p_student, p_month);
  update public.progress_months set
    start_page = p_start_page, goal_page = p_goal_page, pages_end = coalesce(p_end_page, pages_end),
    goal = case when p_goal_page is not null and p_start_page is not null then p_goal_page - p_start_page else 0 end,
    start_surah = p_start_surah, start_pos = p_start_pos, goal_surah = p_goal_surah, goal_pos = p_goal_pos, end_surah = p_end_surah, end_pos = p_end_pos,
    ajza_improve = nullif(trim(coalesce(p_ajza, '')), ''), ahkaam = nullif(trim(coalesce(p_ahkaam, '')), ''),
    murajaat = p_murajaat, dawrat = p_dawrat, report_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
  where student_id = p_student and month = p_month;
  if p_month >= cur then
    if p_end_page is not null then update public.students set pages = p_end_page where id = p_student; end if;
    if p_end_surah is not null or p_end_pos is not null then update public.students set cur_surah = p_end_surah, cur_pos = p_end_pos where id = p_student; end if;
  end if;
  v_goal := public._check_goal(p_student, p_month);
  return json_build_object('goal_reached', v_goal, 'keys', (select keys from public.students where id = p_student));
end $$;
revoke all on function public.save_month_report(uuid, text, int, int, int, text, text, int, int, text, int, int, int, int, int, int) from public, anon;
grant execute on function public.save_month_report(uuid, text, int, int, int, text, text, int, int, text, int, int, int, int, int, int) to authenticated;


-- ===================================================== staff roles: what each account may do
-- Fees: admin and accounts.
drop policy if exists "payments: institute all" on public.payments;
create policy "payments: institute all" on public.payments for all to authenticated using (public.can_fees()) with check (public.can_fees());
-- Students: admin manages everything; accounts can read the list (names and fees); teachers read through
-- staff_students() which leaves out fees and discounts.
drop policy if exists "students: accounts read" on public.students;
create policy "students: accounts read" on public.students for select to authenticated using (public.can_fees());

create or replace function public.staff_students()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_admin() or public.can_fees() then to_jsonb(s)
              else to_jsonb(s) - 'monthly_fee' - 'discount_type' - 'discount_value' - 'discount_note' end
    from public.students s
   where public.is_staff()
   order by s.full_name
$$;
revoke all on function public.staff_students() from public, anon;
grant execute on function public.staff_students() to authenticated;

-- Teachers (and admin) set where a student is in the Qur'an.
create or replace function public.set_position(p_student uuid, p_surah int, p_pos int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_teach() then raise exception 'Only teachers can update hifz.'; end if;
  if p_surah is not null and (p_surah < 1 or p_surah > 114) then raise exception 'Surah must be 1 to 114.'; end if;
  if p_pos is not null and (p_pos < 1 or p_pos > 604) then raise exception 'Page must be 1 to 604.'; end if;
  update public.students set cur_surah = p_surah, cur_pos = p_pos where id = p_student;
  if not found then raise exception 'Student not found.'; end if;
end $$;
revoke all on function public.set_position(uuid, int, int) from public, anon;
grant execute on function public.set_position(uuid, int, int) to authenticated;

-- Accounts (and admin) change only fee fields.
create or replace function public.update_student_fees(p_student uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_fees() then raise exception 'Only the accounts team can change fees.'; end if;
  update public.students set
    monthly_fee    = case when p_patch ? 'monthly_fee'    then greatest(0, (p_patch->>'monthly_fee')::numeric) else monthly_fee end,
    start_month    = case when p_patch ? 'start_month' and (p_patch->>'start_month') ~ '^\d{4}-\d{2}$' then p_patch->>'start_month' else start_month end,
    discount_type  = case when p_patch ? 'discount_type'  then coalesce(nullif(p_patch->>'discount_type', ''), 'amount') else discount_type end,
    discount_value = case when p_patch ? 'discount_value' then greatest(0, coalesce((p_patch->>'discount_value')::numeric, 0)) else discount_value end,
    discount_note  = case when p_patch ? 'discount_note'  then nullif(trim(p_patch->>'discount_note'), '') else discount_note end
  where id = p_student;
  if not found then raise exception 'Student not found.'; end if;
end $$;
revoke all on function public.update_student_fees(uuid, jsonb) from public, anon;
grant execute on function public.update_student_fees(uuid, jsonb) to authenticated;

-- Strong passwords for every institute account: at least 10 characters with letters and numbers.
create or replace function public._strong_pw(p text)
returns void language plpgsql immutable as $$
begin
  if length(coalesce(p, '')) < 10 or p !~ '[A-Za-z]' or p !~ '[0-9]' then
    raise exception 'Staff passwords need at least 10 characters, with letters and numbers.';
  end if;
end $$;

drop function if exists public.add_staff(text, text);
create or replace function public.add_staff(p_username text, p_password text, p_role text default 'admin')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Only an admin can add staff accounts.'; end if;
  if p_role not in ('admin', 'teacher', 'accounts') then raise exception 'Role is not valid.'; end if;
  perform public._strong_pw(p_password);
  v_id := public._create_login(p_username, p_password);
  insert into public.admins (user_id, username, role) values (v_id, lower(trim(p_username)), p_role);
  return v_id;
end $$;
revoke all on function public.add_staff(text, text, text) from public, anon;
grant execute on function public.add_staff(text, text, text) to authenticated;

create or replace function public.set_staff_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can change roles.'; end if;
  if p_role not in ('admin', 'teacher', 'accounts') then raise exception 'Role is not valid.'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'You cannot remove your own admin access.'; end if;
  update public.admins set role = p_role where user_id = p_user;
  if not found then raise exception 'Staff account not found.'; end if;
end $$;
revoke all on function public.set_staff_role(uuid, text) from public, anon;
grant execute on function public.set_staff_role(uuid, text) to authenticated;

create or replace function public.reset_staff_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can reset passwords.'; end if;
  perform public._strong_pw(p_password);
  if not exists (select 1 from public.admins where user_id = p_user) then raise exception 'Staff account not found.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = p_user;
end $$;

create or replace function public.setup_first_admin(p_username text, p_password text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('mz_first_admin'));
  if exists (select 1 from public.admins) then raise exception 'The institute account already exists. Please sign in.'; end if;
  perform public._strong_pw(p_password);
  v_id := public._create_login(p_username, p_password);
  insert into public.admins (user_id, username, role) values (v_id, lower(trim(p_username)), 'admin');
  return v_id;
end $$;

-- Every staff member can see the staff list (names and roles only).
drop policy if exists "admins: institute read all" on public.admins;
create policy "admins: institute read all" on public.admins for select to authenticated using (public.is_staff());

-- ===================================================== approval: payments by the accounts team wait for an admin
alter table public.payments
  add column if not exists status      text not null default 'approved',
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz;
do $$ begin
  alter table public.payments add constraint payments_status_check check (status in ('pending', 'approved'));
exception when duplicate_object then null; end $$;
create index if not exists payments_pending_idx on public.payments (status) where status = 'pending';

-- Who recorded it decides the status; nobody but an admin can approve or remove an approved receipt.
create or replace function public._payment_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if public.is_admin() or auth.uid() is null then
      new.status := 'approved'; new.approved_by := auth.uid(); new.approved_at := now();
    else
      new.status := 'pending'; new.approved_by := null; new.approved_at := null;
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if not public.is_admin() and auth.uid() is not null then
      if new.status is distinct from old.status or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
        raise exception 'Only an admin can approve payments.';
      end if;
      if old.status = 'approved' and (new.amount, new.month, new.student_id) is distinct from (old.amount, old.month, old.student_id) then
        raise exception 'Only an admin can change an approved receipt.';
      end if;
    end if;
    return new;
  else
    if old.status = 'approved' and not public.is_admin() and auth.uid() is not null then
      raise exception 'Only an admin can cancel an approved receipt.';
    end if;
    return old;
  end if;
end $$;
drop trigger if exists payments_guard on public.payments;
create trigger payments_guard before insert or update or delete on public.payments for each row execute function public._payment_guard();

-- Students see a receipt only once it is approved.
drop policy if exists "payments: read own" on public.payments;
create policy "payments: read own" on public.payments for select to authenticated using (student_id = auth.uid() and status = 'approved');

-- Approve one or many at once (the receipt then appears in the student's portal).
create or replace function public.approve_payments(p_ids bigint[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only an admin can approve payments.'; end if;
  update public.payments set status = 'approved', approved_by = auth.uid(), approved_at = now(), seen_at = null
   where id = any(coalesce(p_ids, '{}')) and status = 'pending';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.approve_payments(bigint[]) from public, anon;
grant execute on function public.approve_payments(bigint[]) to authenticated;

-- ============================================================================
-- Breaks (student away, e.g. travelled home for a year): those months are
-- "On leave" — no fee is due and they are not counted as unpaid.
-- breaks = [{"from":"2026-08","to":"2027-07","note":"Travelled home"}], "to" may be null (still away).
-- ============================================================================
alter table public.students add column if not exists breaks jsonb not null default '[]'::jsonb;
alter table public.students drop constraint if exists students_breaks_array;
alter table public.students add constraint students_breaks_array check (jsonb_typeof(breaks) = 'array' and jsonb_array_length(breaks) <= 50);

create or replace function public._clean_breaks(p jsonb)
returns jsonb language plpgsql immutable as $$
declare b jsonb; out jsonb := '[]'::jsonb; f text; t text;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return '[]'::jsonb; end if;
  for b in select * from jsonb_array_elements(p) loop
    f := b->>'from'; t := nullif(b->>'to', '');
    if f !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Break start must be a month like 2026-08.'; end if;
    if t is not null and t !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Break end must be a month like 2027-07.'; end if;
    if t is not null and t < f then raise exception 'A break cannot end before it starts.'; end if;
    out := out || jsonb_build_array(jsonb_build_object('from', f, 'to', t, 'note', left(coalesce(b->>'note', ''), 200)));
  end loop;
  return out;
end $$;

-- Accounts (and admin) change only fee fields — now including breaks.
create or replace function public.update_student_fees(p_student uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_fees() then raise exception 'Only the accounts team can change fees.'; end if;
  update public.students set
    monthly_fee    = case when p_patch ? 'monthly_fee'    then greatest(0, (p_patch->>'monthly_fee')::numeric) else monthly_fee end,
    start_month    = case when p_patch ? 'start_month' and (p_patch->>'start_month') ~ '^\d{4}-\d{2}$' then p_patch->>'start_month' else start_month end,
    discount_type  = case when p_patch ? 'discount_type'  then coalesce(nullif(p_patch->>'discount_type', ''), 'amount') else discount_type end,
    discount_value = case when p_patch ? 'discount_value' then greatest(0, coalesce((p_patch->>'discount_value')::numeric, 0)) else discount_value end,
    discount_note  = case when p_patch ? 'discount_note'  then nullif(trim(p_patch->>'discount_note'), '') else discount_note end,
    breaks         = case when p_patch ? 'breaks'         then public._clean_breaks(p_patch->'breaks') else breaks end
  where id = p_student;
  if not found then raise exception 'Student not found.'; end if;
end $$;
revoke all on function public.update_student_fees(uuid, jsonb) from public, anon;
grant execute on function public.update_student_fees(uuid, jsonb) to authenticated;

-- ============================================================================
-- Cash and Bank books.
-- finance_entries gains: account ('cash' or 'bank') for income and expenses,
-- and two new kinds: 'transfer' (account → to_account, e.g. cash deposited
-- into the bank, or a bank withdrawal into cash) and 'opening' (the starting
-- balance of an account). Fees: method 'Cash' goes to the cash book, anything
-- else (Bank, bank transfer, mobile money, cheque) to the bank book.
-- The Accounts role now also manages Income and Expenses, and can read the
-- payroll (salary amounts and teacher names) so salaries show in the books.
-- ============================================================================
alter table public.finance_entries add column if not exists account text not null default 'cash';
alter table public.finance_entries add column if not exists to_account text;
alter table public.finance_entries drop constraint if exists finance_entries_kind_check;
alter table public.finance_entries add constraint finance_entries_kind_check check (kind in ('income', 'expense', 'transfer', 'opening'));
alter table public.finance_entries drop constraint if exists finance_entries_account_check;
alter table public.finance_entries add constraint finance_entries_account_check check (account in ('cash', 'bank'));
alter table public.finance_entries drop constraint if exists finance_entries_to_account_check;
alter table public.finance_entries add constraint finance_entries_to_account_check check (
  (kind = 'transfer' and to_account in ('cash', 'bank') and to_account <> account) or (kind <> 'transfer' and to_account is null));

drop policy if exists "finance: institute all" on public.finance_entries;
create policy "finance: institute all" on public.finance_entries for all to authenticated using (public.can_fees()) with check (public.can_fees());

drop policy if exists "hr: accounts read payroll" on public.hr_records;
create policy "hr: accounts read payroll" on public.hr_records for select to authenticated
  using (public.can_fees() and kind in ('payroll', 'teacher'));

-- ============================================================================
-- Cashier role: enters student fees, income and expenses — nothing else.
-- Sees the student list (to find a name) and who has paid, but no totals,
-- balances, books, reports, HR or settings. Fees they record wait for admin
-- approval (payments_guard already does that for every non-admin). They can
-- cancel only their own payments that are still waiting, and they see only
-- the income and expense lines they entered themselves.
-- ============================================================================
alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check check (role in ('admin', 'teacher', 'accounts', 'cashier', 'viewer'));

create or replace function public.is_cashier()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role = 'cashier')
$$;
revoke all on function public.is_cashier() from public, anon;
grant execute on function public.is_cashier() to authenticated;

drop policy if exists "students: cashier read" on public.students;
create policy "students: cashier read" on public.students for select to authenticated using (public.is_cashier());

drop policy if exists "payments: cashier read" on public.payments;
create policy "payments: cashier read" on public.payments for select to authenticated using (public.is_cashier());
drop policy if exists "payments: cashier add" on public.payments;
create policy "payments: cashier add" on public.payments for insert to authenticated
  with check (public.is_cashier() and created_by = auth.uid());
drop policy if exists "payments: cashier cancel own waiting" on public.payments;
create policy "payments: cashier cancel own waiting" on public.payments for delete to authenticated
  using (public.is_cashier() and created_by = auth.uid() and status = 'pending');

drop policy if exists "finance: cashier read own" on public.finance_entries;
create policy "finance: cashier read own" on public.finance_entries for select to authenticated
  using (public.is_cashier() and created_by = auth.uid());
drop policy if exists "finance: cashier add" on public.finance_entries;
create policy "finance: cashier add" on public.finance_entries for insert to authenticated
  with check (public.is_cashier() and created_by = auth.uid() and kind in ('income', 'expense'));

create or replace function public.add_staff(p_username text, p_password text, p_role text default 'admin')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Only an admin can add staff accounts.'; end if;
  if p_role not in ('admin', 'teacher', 'accounts', 'cashier') then raise exception 'Role is not valid.'; end if;
  perform public._strong_pw(p_password);
  v_id := public._create_login(p_username, p_password);
  insert into public.admins (user_id, username, role) values (v_id, lower(trim(p_username)), p_role);
  return v_id;
end $$;
revoke all on function public.add_staff(text, text, text) from public, anon;
grant execute on function public.add_staff(text, text, text) to authenticated;

create or replace function public.set_staff_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can change roles.'; end if;
  if p_role not in ('admin', 'teacher', 'accounts', 'cashier') then raise exception 'Role is not valid.'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'You cannot remove your own admin access.'; end if;
  update public.admins set role = p_role where user_id = p_user;
  if not found then raise exception 'Staff account not found.'; end if;
end $$;
revoke all on function public.set_staff_role(uuid, text) from public, anon;
grant execute on function public.set_staff_role(uuid, text) to authenticated;

-- ============================================================================
-- October update: view-only accounts, teacher profiles, ITS password,
-- ikhtibar page alerts, new enrollments and welcome email settings.
-- ============================================================================

-- ---------- View-only staff: can look at Accounts, HR, Progress and Ikhtibar, can change nothing.
alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check check (role in ('admin', 'teacher', 'accounts', 'cashier', 'viewer'));
create or replace function public.is_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role = 'viewer')
$$;
revoke all on function public.is_viewer() from public, anon;
grant execute on function public.is_viewer() to authenticated;
do $$
declare t text;
begin
  foreach t in array array['students', 'payments', 'progress_months', 'key_events', 'ikhtibars', 'finance_entries', 'hr_records', 'reminders'] loop
    execute format('drop policy if exists "%s: viewer read" on public.%I', t, t);
    execute format('create policy "%s: viewer read" on public.%I for select to authenticated using (public.is_viewer())', t, t);
  end loop;
end $$;
create or replace function public.teacher_feedback_summary(p_from text, p_to text)
returns table (teacher_id bigint, month text, responses int, avg_scores jsonb, comments text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_viewer()) then raise exception 'Only the institute can see teacher feedback.'; end if;
  return query
    select f.teacher_id, f.month, count(*)::int,
      jsonb_build_object(
        'punctuality',   round(avg((f.scores->>'punctuality')::numeric), 2),
        'concentration', round(avg((f.scores->>'concentration')::numeric), 2),
        'listening',     round(avg((f.scores->>'listening')::numeric), 2),
        'teaching',      round(avg((f.scores->>'teaching')::numeric), 2),
        'coaching',      round(avg((f.scores->>'coaching')::numeric), 2),
        'attitude',      round(avg((f.scores->>'attitude')::numeric), 2),
        'ownership',     round(avg((f.scores->>'ownership')::numeric), 2)),
      array_remove(array_agg(f.comment order by random()), null)
    from public.teacher_feedback f
    where f.month between p_from and p_to
    group by f.teacher_id, f.month;
end $$;

create or replace function public.add_staff(p_username text, p_password text, p_role text default 'admin')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Only an admin can add staff accounts.'; end if;
  if p_role not in ('admin', 'teacher', 'accounts', 'cashier', 'viewer') then raise exception 'Role is not valid.'; end if;
  perform public._strong_pw(p_password);
  v_id := public._create_login(p_username, p_password);
  insert into public.admins (user_id, username, role) values (v_id, lower(trim(p_username)), p_role);
  return v_id;
end $$;
revoke all on function public.add_staff(text, text, text) from public, anon;
grant execute on function public.add_staff(text, text, text) to authenticated;
create or replace function public.set_staff_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can change roles.'; end if;
  if p_role not in ('admin', 'teacher', 'accounts', 'cashier', 'viewer') then raise exception 'Role is not valid.'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'You cannot remove your own admin access.'; end if;
  update public.admins set role = p_role where user_id = p_user;
  if not found then raise exception 'Staff account not found.'; end if;
end $$;
revoke all on function public.set_staff_role(uuid, text) from public, anon;
grant execute on function public.set_staff_role(uuid, text) to authenticated;

-- ---------- Teacher profiles (HR → Teachers). A teacher record can be linked to a teacher's
-- login (data.user_id); that teacher then edits their own ITS, name, email, sanad year,
-- phone and Tadreeb al Huffaz from "My profile". Salary and notes stay with the admin.
create or replace function public.my_teacher_profile()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', h.id, 'data', h.data - 'salary' - 'notes')
    from public.hr_records h
   where h.kind = 'teacher' and h.data->>'user_id' = auth.uid()::text
   order by h.id limit 1
$$;
revoke all on function public.my_teacher_profile() from public, anon;
grant execute on function public.my_teacher_profile() to authenticated;

create or replace function public.save_my_teacher_profile(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_clean jsonb := '{}'::jsonb; k text; v text;
begin
  if not public.is_staff() then raise exception 'Please sign in again.'; end if;
  foreach k in array array['full_name', 'its_no', 'email', 'sanad_year', 'phone', 'tadreeb'] loop
    if p ? k then
      v := left(trim(coalesce(p->>k, '')), 120);
      if k = 'its_no' and v <> '' and v !~ '^\d{8}$' then raise exception 'ITS number must be 8 digits.'; end if;
      if k = 'sanad_year' and v <> '' and v !~ '^\d{4}$' then raise exception 'Sanad year must be a year like 2015.'; end if;
      if k = 'email' and v <> '' and v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email address is not valid.'; end if;
      if k = 'tadreeb' and v not in ('', 'Yes', 'No') then raise exception 'Tadreeb al Huffaz must be Yes or No.'; end if;
      v_clean := v_clean || jsonb_build_object(k, v);
    end if;
  end loop;
  if coalesce(v_clean->>'full_name', 'x') = '' then raise exception 'Full name is required.'; end if;
  select id into v_id from public.hr_records where kind = 'teacher' and data->>'user_id' = auth.uid()::text order by id limit 1;
  if v_id is null then
    insert into public.hr_records (kind, data)
    values ('teacher', v_clean || jsonb_build_object('user_id', auth.uid()::text, 'status', 'Active', 'role', 'Hifz teacher'))
    returning id into v_id;
  else
    update public.hr_records set data = data || v_clean, updated_at = now() where id = v_id;
  end if;
  return public.my_teacher_profile();
end $$;
revoke all on function public.save_my_teacher_profile(jsonb) from public, anon;
grant execute on function public.save_my_teacher_profile(jsonb) to authenticated;

-- ---------- ITS password: kept in its own table, readable only by the admin and the student.
create table if not exists public.student_secrets (
  student_id   uuid primary key references public.students (id) on delete cascade,
  its_password text,
  updated_at   timestamptz not null default now()
);
alter table public.student_secrets enable row level security;
drop policy if exists "secrets: admin all" on public.student_secrets;
create policy "secrets: admin all" on public.student_secrets for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "secrets: own" on public.student_secrets;
create policy "secrets: own" on public.student_secrets for all to authenticated using (student_id = auth.uid()) with check (student_id = auth.uid());
grant select, insert, update, delete on public.student_secrets to authenticated;
revoke all on public.student_secrets from anon;

-- ---------- Ikhtibar pages, eLearning link, welcome email.
alter table public.settings add column if not exists ikhtibar_pages int[] not null default '{582,542,502,101,201,301,401,501}';
alter table public.settings add column if not exists ikhtibar_alert_pages int not null default 20;
alter table public.settings add column if not exists elearning_url text;
alter table public.settings add column if not exists welcome_subject text;
alter table public.settings add column if not exists welcome_body text;
alter table public.settings add column if not exists hafiz_days_per_year int not null default 150;

-- ---------- New enrollments: a new student is "new" until their first payment is approved
-- (or the admin taps Start classes).
alter table public.students add column if not exists is_new boolean not null default false;
alter table public.students alter column is_new set default true;
alter table public.students add column if not exists welcome_sent_at timestamptz;
create or replace function public._clear_new_on_paid()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' then update public.students set is_new = false where id = new.student_id and is_new; end if;
  return new;
end $$;
drop trigger if exists payments_clear_new on public.payments;
create trigger payments_clear_new after insert or update of status on public.payments for each row execute function public._clear_new_on_paid();

-- ============================================================================
-- October (2): payment slips, roles & responsibilities, yearly goals, praise badges
-- ============================================================================

-- ---------- Payment slip / receipt (JPEG, PNG or PDF) kept with each recorded payment.
alter table public.payments add column if not exists proof_path text;
alter table public.payments add column if not exists proof_name text;
alter table public.payments add column if not exists proof_mime text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf'];

-- Files live at <student id>/<payment id>-<time>-<name>. Staff who record fees can add them;
-- the student can open the slips in their own folder.
drop policy if exists "payment proofs: read" on storage.objects;
drop policy if exists "payment proofs: upload" on storage.objects;
drop policy if exists "payment proofs: delete" on storage.objects;
create policy "payment proofs: read" on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and (public.can_fees() or public.is_cashier() or public.is_viewer() or (storage.foldername(name))[1] = auth.uid()::text));
create policy "payment proofs: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (public.can_fees() or public.is_cashier()));
create policy "payment proofs: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs' and public.can_fees());

create or replace function public.set_payment_proof(p_id bigint, p_path text, p_name text, p_mime text)
returns void language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  select * into p from public.payments where id = p_id;
  if not found then raise exception 'Payment not found.'; end if;
  if not (public.can_fees() or (public.is_cashier() and p.created_by = auth.uid())) then
    raise exception 'Your account is not allowed to do that.';
  end if;
  if p_path is not null and split_part(p_path, '/', 1) <> p.student_id::text then
    raise exception 'The file is in the wrong folder.';
  end if;
  if p_mime is not null and p_mime not in ('image/jpeg', 'image/png', 'application/pdf') then
    raise exception 'Only JPEG, PNG or PDF files.';
  end if;
  update public.payments set proof_path = p_path, proof_name = left(p_name, 120), proof_mime = p_mime where id = p_id;
end $$;
revoke all on function public.set_payment_proof(bigint, text, text, text) from public, anon;
grant execute on function public.set_payment_proof(bigint, text, text, text) to authenticated;

-- ---------- Roles & responsibilities ('duty') and yearly goals ('goal') are HR records.
alter table public.hr_records drop constraint if exists hr_records_kind_check;
alter table public.hr_records add constraint hr_records_kind_check
  check (kind in ('teacher', 'teacher_rating', 'payroll', 'attendance', 'leave', 'student_rating', 'duty', 'goal'));

-- A teacher sees the responsibilities and goals given to them (through their linked teacher record).
create or replace function public.my_hr_items()
returns table (id bigint, kind text, data jsonb) language sql stable security definer set search_path = public as $$
  select h.id, h.kind, h.data - 'notes' from public.hr_records h
   where h.kind in ('duty', 'goal')
     and h.data->>'teacher_id' in (select t.id::text from public.hr_records t where t.kind = 'teacher' and t.data->>'user_id' = auth.uid()::text)
   order by h.id
$$;
revoke all on function public.my_hr_items() from public, anon;
grant execute on function public.my_hr_items() to authenticated;

-- ---------- Praise badges: admin and teachers award them; the student sees them in their portal.
create table if not exists public.badges (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  badge text not null check (char_length(badge) between 1 and 30),
  title text not null check (char_length(title) between 1 and 60),
  note text check (char_length(note) <= 300),
  awarded_by uuid default auth.uid(),
  awarded_by_name text,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index if not exists badges_student_idx on public.badges (student_id, created_at desc);
alter table public.badges enable row level security;

create or replace function public._badge_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.awarded_by := coalesce(auth.uid(), new.awarded_by);
  new.awarded_by_name := coalesce(
    (select t.data->>'full_name' from public.hr_records t where t.kind = 'teacher' and t.data->>'user_id' = auth.uid()::text limit 1),
    (select case when a.role = 'admin' then 'Admin' else a.username end from public.admins a where a.user_id = auth.uid()),
    new.awarded_by_name, 'The institute');
  new.created_at := now(); new.seen_at := null;
  return new;
end $$;
drop trigger if exists badges_stamp on public.badges;
create trigger badges_stamp before insert on public.badges for each row execute function public._badge_stamp();

drop policy if exists "badges: staff read" on public.badges;
drop policy if exists "badges: own read" on public.badges;
drop policy if exists "badges: award" on public.badges;
drop policy if exists "badges: remove" on public.badges;
create policy "badges: staff read" on public.badges for select to authenticated using (public.can_teach() or public.is_viewer());
create policy "badges: own read" on public.badges for select to authenticated using (student_id = auth.uid());
create policy "badges: award" on public.badges for insert to authenticated with check (public.can_teach());
create policy "badges: remove" on public.badges for delete to authenticated using (public.is_admin() or (public.can_teach() and awarded_by = auth.uid()));
grant select, insert, delete on public.badges to authenticated;
revoke all on public.badges from anon;

create or replace function public.mark_badges_seen()
returns void language sql security definer set search_path = public as $$
  update public.badges set seen_at = now() where student_id = auth.uid() and seen_at is null
$$;
revoke all on function public.mark_badges_seen() from public, anon;
grant execute on function public.mark_badges_seen() to authenticated;

-- ============================================================================
-- October (3): teacher Mastership badge, scheduling
-- ============================================================================

-- ---------- A teacher sees their own Mastership months (all 7 categories rated 4 or 5),
-- without the scores or comments.
create or replace function public.my_mastership()
returns table (month text) language sql stable security definer set search_path = public as $$
  select r.data->>'month' from public.hr_records r
   where r.kind = 'teacher_rating'
     and r.data->>'teacher_id' in (select t.id::text from public.hr_records t where t.kind = 'teacher' and t.data->>'user_id' = auth.uid()::text)
     and coalesce((r.data->>'punctuality')::numeric, 0) >= 4 and coalesce((r.data->>'concentration')::numeric, 0) >= 4
     and coalesce((r.data->>'listening')::numeric, 0) >= 4 and coalesce((r.data->>'teaching')::numeric, 0) >= 4
     and coalesce((r.data->>'coaching')::numeric, 0) >= 4 and coalesce((r.data->>'attitude')::numeric, 0) >= 4
     and coalesce((r.data->>'ownership')::numeric, 0) >= 4
   order by 1
$$;
revoke all on function public.my_mastership() from public, anon;
grant execute on function public.my_mastership() to authenticated;

-- ---------- Scheduling: students allocated to teachers in time slots.
-- Who can make schedules: the admin, and teachers whose HR record says "Can make schedules: Yes".
create or replace function public.can_schedule()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.hr_records t join public.admins a on a.user_id = auth.uid() and a.role = 'teacher'
     where t.kind = 'teacher' and t.data->>'user_id' = auth.uid()::text and t.data->>'can_schedule' = 'Yes')
$$;
revoke all on function public.can_schedule() from public, anon;
grant execute on function public.can_schedule() to authenticated;
-- Who can move students between teachers (drag and drop): planners, and teachers whose HR record says
-- "Schedule permission: Drag and drop only". Other teachers only see their own students.
create or replace function public.can_move_schedule()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_schedule() or exists (
    select 1 from public.hr_records t join public.admins a on a.user_id = auth.uid() and a.role = 'teacher'
     where t.kind = 'teacher' and t.data->>'user_id' = auth.uid()::text and t.data->>'can_schedule' = 'Drag and drop only')
$$;
revoke all on function public.can_move_schedule() from public, anon;
grant execute on function public.can_move_schedule() to authenticated;

create table if not exists public.schedules (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  teacher_id bigint not null,
  teacher_user uuid,
  teacher_name text,
  slot_date date not null,
  start_time time not null,
  end_time time not null,
  note text check (char_length(note) <= 120),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  student_seen_at timestamptz,
  teacher_seen_at timestamptz,
  constraint schedules_time_order check (end_time > start_time)
);
create index if not exists schedules_date_idx on public.schedules (slot_date, start_time);
create index if not exists schedules_student_idx on public.schedules (student_id, slot_date);
create index if not exists schedules_teacher_idx on public.schedules (teacher_id, slot_date);
alter table public.schedules enable row level security;

-- Fill in the teacher's name and login, refuse double bookings, and mark the slot as new for both people.
create or replace function public._schedule_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.hr_records; s public.students; clash record;
begin
  select * into t from public.hr_records where id = new.teacher_id and kind = 'teacher';
  if not found then raise exception 'Choose a teacher from HR → Teachers.'; end if;
  select * into s from public.students where id = new.student_id;
  if not found then raise exception 'Student not found.'; end if;
  new.teacher_name := t.data->>'full_name';
  new.teacher_user := nullif(t.data->>'user_id', '')::uuid;
  if new.status = 'scheduled' then
    select sc.*, st.full_name into clash from public.schedules sc join public.students st on st.id = sc.student_id
     where sc.status = 'scheduled' and sc.slot_date = new.slot_date and sc.id is distinct from new.id
       and sc.start_time < new.end_time and new.start_time < sc.end_time
       and (sc.teacher_id = new.teacher_id or sc.student_id = new.student_id)
     limit 1;
    if found then
      if clash.student_id = new.student_id then
        raise exception '% already has a slot from % to % on %.', s.full_name, to_char(clash.start_time, 'HH24:MI'), to_char(clash.end_time, 'HH24:MI'), to_char(new.slot_date, 'DD Mon');
      else
        raise exception '% already teaches % from % to % on %.', new.teacher_name, clash.full_name, to_char(clash.start_time, 'HH24:MI'), to_char(clash.end_time, 'HH24:MI'), to_char(new.slot_date, 'DD Mon');
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); new.created_at := now(); end if;
  if tg_op = 'INSERT' or (new.student_id, new.teacher_id, new.slot_date, new.start_time, new.end_time, new.status, coalesce(new.note, ''))
       is distinct from (old.student_id, old.teacher_id, old.slot_date, old.start_time, old.end_time, old.status, coalesce(old.note, '')) then
    new.updated_at := now(); new.student_seen_at := null; new.teacher_seen_at := null;
  end if;
  return new;
end $$;
drop trigger if exists schedules_guard on public.schedules;
create trigger schedules_guard before insert or update on public.schedules for each row execute function public._schedule_guard();

drop policy if exists "schedules: planners all" on public.schedules;
drop policy if exists "schedules: teacher own" on public.schedules;
drop policy if exists "schedules: student own" on public.schedules;
drop policy if exists "schedules: viewer read" on public.schedules;
drop policy if exists "schedules: movers read" on public.schedules;
create policy "schedules: planners all" on public.schedules for all to authenticated using (public.can_schedule()) with check (public.can_schedule());
create policy "schedules: teacher own" on public.schedules for select to authenticated using (teacher_user = auth.uid());
create policy "schedules: student own" on public.schedules for select to authenticated using (student_id = auth.uid());
create policy "schedules: viewer read" on public.schedules for select to authenticated using (public.is_viewer());
create policy "schedules: movers read" on public.schedules for select to authenticated using (public.can_move_schedule());
grant select, insert, update, delete on public.schedules to authenticated;
revoke all on public.schedules from anon;

-- Teachers to choose from (planners and teachers can call it; only names, no salaries).
create or replace function public.schedule_teachers()
returns table (id bigint, full_name text, user_id text, status text) language sql stable security definer set search_path = public as $$
  select t.id, t.data->>'full_name', t.data->>'user_id', coalesce(t.data->>'status', 'Active') from public.hr_records t
   where t.kind = 'teacher' and (public.is_staff())
   order by 2
$$;
revoke all on function public.schedule_teachers() from public, anon;
grant execute on function public.schedule_teachers() to authenticated;

-- "Seen": the student or the teacher opened their schedule.
create or replace function public.mark_schedule_seen()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.schedules set student_seen_at = now() where student_id = auth.uid() and student_seen_at is null;
  update public.schedules set teacher_seen_at = now() where teacher_user = auth.uid() and teacher_seen_at is null;
end $$;
revoke all on function public.mark_schedule_seen() from public, anon;
grant execute on function public.mark_schedule_seen() to authenticated;

-- ---------- Hand students over to another teacher (drag and drop in the Schedule tab).
-- The planner can move any slot; a teacher can move their own slots (for example when they cannot come).
-- The guard trigger still refuses a clash and marks the slot as new for the student and the new teacher.
alter table public.schedules add column if not exists handed_from text;
alter table public.schedules add column if not exists handed_by uuid;
alter table public.schedules add column if not exists handed_at timestamptz;
create or replace function public.reassign_schedule(p_ids bigint[], p_teacher bigint)
returns int language plpgsql security definer set search_path = public as $$
declare r public.schedules; t public.hr_records; n int := 0;
begin
  select * into t from public.hr_records where id = p_teacher and kind = 'teacher';
  if not found then raise exception 'Choose a teacher from HR → Teachers.'; end if;
  for r in select * from public.schedules where id = any(coalesce(p_ids, '{}')) order by slot_date, start_time loop
    -- only the admin and teachers given schedule permission (full, or drag and drop) can move students
    if not public.can_move_schedule() then
      raise exception 'Only the admin and teachers with schedule permission can move students. Ask the admin.';
    end if;
    if r.status <> 'scheduled' then raise exception 'This slot is cancelled. Restore it first.'; end if;
    if r.teacher_id <> p_teacher then
      update public.schedules
         set teacher_id = p_teacher,
             -- moved back to the teacher it came from: no longer a hand-over
             handed_from = case when t.data->>'full_name' = r.handed_from then null else r.teacher_name end,
             handed_by = case when t.data->>'full_name' = r.handed_from then null else auth.uid() end,
             handed_at = now()
       where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.reassign_schedule(bigint[], bigint) from public, anon;
grant execute on function public.reassign_schedule(bigint[], bigint) to authenticated;

-- Who is busy when on a day (no student names), so teachers can see who is free before moving a student.
create or replace function public.teacher_busy(p_date date)
returns table (teacher_id bigint, start_time time, end_time time) language sql stable security definer set search_path = public as $$
  select s.teacher_id, s.start_time, s.end_time from public.schedules s
   where public.is_staff() and s.status = 'scheduled' and s.slot_date = p_date
$$;
revoke all on function public.teacher_busy(date) from public, anon;
grant execute on function public.teacher_busy(date) to authenticated;

-- ---------- Teacher logins created automatically from HR → Teachers.
-- The default password lives in a private table no one can read directly (only the admin, through the functions below).
create table if not exists public.app_private (
  id int primary key default 1 check (id = 1),
  auto_teacher_login boolean not null default true,
  teacher_default_pw text not null default 'Tahfeez2026',
  updated_at timestamptz not null default now()
);
insert into public.app_private (id) values (1) on conflict (id) do nothing;
alter table public.app_private enable row level security;
revoke all on public.app_private from public, anon, authenticated;

-- a staff member signing in with a password someone else set is asked to choose their own
alter table public.admins add column if not exists must_change_pw boolean not null default false;

create or replace function public.teacher_login_settings()
returns json language plpgsql stable security definer set search_path = public as $$
declare r public.app_private;
begin
  if not public.is_admin() then raise exception 'Only an admin can see this.'; end if;
  select * into r from public.app_private where id = 1;
  return json_build_object('auto', coalesce(r.auto_teacher_login, true), 'password', coalesce(r.teacher_default_pw, 'Tahfeez2026'));
end $$;
revoke all on function public.teacher_login_settings() from public, anon;
grant execute on function public.teacher_login_settings() to authenticated;

create or replace function public.save_teacher_login_settings(p_auto boolean, p_password text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can change this.'; end if;
  perform public._strong_pw(p_password);
  insert into public.app_private (id, auto_teacher_login, teacher_default_pw, updated_at) values (1, coalesce(p_auto, true), p_password, now())
  on conflict (id) do update set auto_teacher_login = excluded.auto_teacher_login, teacher_default_pw = excluded.teacher_default_pw, updated_at = now();
end $$;
revoke all on function public.save_teacher_login_settings(boolean, text) from public, anon;
grant execute on function public.save_teacher_login_settings(boolean, text) to authenticated;

-- Creates the login for a teacher in HR → Teachers and links it. Username: the ITS number when there is one,
-- otherwise first.last name (titles such as Mulla or Janab left out), with a number added if it is taken.
create or replace function public.create_teacher_login(p_hr_id bigint, p_username text default null)
returns json language plpgsql security definer set search_path = public, auth, extensions as $$
declare t public.hr_records; v_pw text; v_user text; v_base text; v_id uuid; n int := 1; w text[]; i int;
begin
  if not public.is_admin() then raise exception 'Only an admin can create teacher logins.'; end if;
  select * into t from public.hr_records where id = p_hr_id and kind = 'teacher' for update;
  if not found then raise exception 'Teacher not found in HR → Teachers.'; end if;
  if nullif(t.data->>'user_id', '') is not null and exists (select 1 from public.admins where user_id::text = t.data->>'user_id') then
    raise exception '% already has a login.', t.data->>'full_name';
  end if;
  select teacher_default_pw into v_pw from public.app_private where id = 1;
  v_pw := coalesce(v_pw, 'Tahfeez2026');
  if nullif(trim(coalesce(p_username, '')), '') is not null then
    v_user := lower(trim(p_username));
  else
    if coalesce(t.data->>'its_no', '') ~ '^[0-9]{6,12}$' then
      v_base := t.data->>'its_no';
    else
      w := regexp_split_to_array(lower(regexp_replace(coalesce(t.data->>'full_name', ''), '[^A-Za-z ]', '', 'g')), '\s+');
      v_base := '';
      for i in 1 .. coalesce(array_length(w, 1), 0) loop
        if w[i] <> '' and w[i] not in ('mulla', 'mullah', 'janab', 'moallema', 'moalema', 'muallima', 'shaikh', 'sheikh', 'shk', 'mr', 'mrs', 'ms', 'bhai', 'behen', 'bai', 'ustad', 'ustadha', 'hafiz', 'hafiza', 'al') then
          if v_base = '' then v_base := w[i]; elsif position('.' in v_base) = 0 then v_base := v_base || '.' || w[i]; else v_base := split_part(v_base, '.', 1) || '.' || w[i]; end if;
        end if;
      end loop;
      if length(v_base) < 3 then v_base := 'teacher' || p_hr_id; end if;
      v_base := left(v_base, 26);
    end if;
    v_user := v_base;
    while exists (select 1 from auth.users where email = v_user || '@' || public.login_domain()) or exists (select 1 from public.admins where username = v_user) loop
      n := n + 1; v_user := v_base || n;
    end loop;
  end if;
  v_id := public._create_login(v_user, v_pw);
  insert into public.admins (user_id, username, role, must_change_pw) values (v_id, v_user, 'teacher', true);
  update public.hr_records set data = data || jsonb_build_object('user_id', v_id::text), updated_at = now() where id = p_hr_id;
  return json_build_object('user_id', v_id, 'username', v_user, 'password', v_pw);
end $$;
revoke all on function public.create_teacher_login(bigint, text) from public, anon;
grant execute on function public.create_teacher_login(bigint, text) to authenticated;

-- an admin resetting someone's password means they should choose their own next time
create or replace function public.reset_staff_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can reset passwords.'; end if;
  perform public._strong_pw(p_password);
  if not exists (select 1 from public.admins where user_id = p_user) then raise exception 'Staff account not found.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = p_user;
  update public.admins set must_change_pw = (p_user <> auth.uid()) where user_id = p_user;
end $$;

create or replace function public.my_must_change_pw()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select must_change_pw from public.admins where user_id = auth.uid()), false)
$$;
revoke all on function public.my_must_change_pw() from public, anon;
grant execute on function public.my_must_change_pw() to authenticated;

-- a staff member sets their own password (and the "choose your own" prompt goes away)
create or replace function public.change_my_staff_password(p_password text)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_def text;
begin
  if not exists (select 1 from public.admins where user_id = auth.uid()) then raise exception 'Staff account not found.'; end if;
  perform public._strong_pw(p_password);
  select teacher_default_pw into v_def from public.app_private where id = 1;
  if p_password = v_def then raise exception 'Choose a password different from the default one.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = auth.uid();
  update public.admins set must_change_pw = false where user_id = auth.uid();
end $$;
revoke all on function public.change_my_staff_password(text) from public, anon;
grant execute on function public.change_my_staff_password(text) to authenticated;

-- ---------- Teacher alerts: an email and a phone notification when students are allocated to them.
-- Phones register for notifications here (Web Push). Nobody can read this table directly.
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;

-- which teacher was last told about each slot (so nobody is told twice)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'schedules' and column_name = 'notified_teacher_id') then
    alter table public.schedules add column notified_teacher_id bigint;
    alter table public.schedules add column teacher_notified_at timestamptz;
    -- slots made before alerts existed: the teachers already saw them in the portal
    update public.schedules set notified_teacher_id = teacher_id, teacher_notified_at = now();
  end if;
end $$;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in again.'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 or length(coalesce(p_p256dh, '')) < 40 or length(coalesce(p_auth, '')) < 8 then
    raise exception 'This phone could not be registered for alerts.';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, ua) values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, created_at = now();
  -- keep at most 6 devices per person
  delete from public.push_subscriptions where user_id = auth.uid() and id not in (select id from public.push_subscriptions where user_id = auth.uid() order by created_at desc limit 6);
end $$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- my own devices (for "Send me a test alert")
create or replace function public.my_push_subscriptions()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)), '[]'::json)
    from public.push_subscriptions where user_id = auth.uid()
$$;
revoke all on function public.my_push_subscriptions() from public, anon;
grant execute on function public.my_push_subscriptions() to authenticated;

-- For the email/phone alert: the teachers of these slots who have not been told yet, with their students.
-- Only someone who can move students (admin, planners) can ask.
create or replace function public.schedule_notify_payload(p_ids bigint[])
returns json language plpgsql stable security definer set search_path = public as $$
declare tch json; stu json;
begin
  if not public.can_move_schedule() then raise exception 'Only the admin and teachers with schedule permission can send alerts.'; end if;
  -- one entry per teacher: their email, phones and new students
  with _np as (select * from public.schedules s0 where s0.id = any(coalesce(p_ids, '{}')) and s0.status = 'scheduled' and s0.notified_teacher_id is distinct from s0.teacher_id)
  select coalesce(json_agg(t), '[]'::json) into tch from (
    select s.teacher_id, max(s.teacher_name) as teacher_name, max(h.data->>'email') as email, max(s.teacher_user::text) as user_id,
           (select coalesce(json_agg(json_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth)), '[]'::json)
              from public.push_subscriptions p where p.user_id = max(s.teacher_user::text)::uuid) as subs,
           json_agg(json_build_object('id', s.id, 'student', st.full_name, 'date', s.slot_date, 'from', to_char(s.start_time, 'HH24:MI'),
                                      'to', to_char(s.end_time, 'HH24:MI'), 'note', s.note, 'handed_from', s.handed_from) order by s.slot_date, s.start_time) as slots
      from _np s
      join public.students st on st.id = s.student_id
      left join public.hr_records h on h.id = s.teacher_id and h.kind = 'teacher'
     group by s.teacher_id
  ) t;
  -- one entry per student: their email and the teacher and time of each class
  with _np as (select * from public.schedules s0 where s0.id = any(coalesce(p_ids, '{}')) and s0.status = 'scheduled' and s0.notified_teacher_id is distinct from s0.teacher_id)
  select coalesce(json_agg(u), '[]'::json) into stu from (
    select s.student_id, max(st.full_name) as name, max(st.email) as email,
           json_agg(json_build_object('id', s.id, 'teacher', s.teacher_name, 'date', s.slot_date, 'from', to_char(s.start_time, 'HH24:MI'),
                                      'to', to_char(s.end_time, 'HH24:MI'), 'note', s.note, 'handed_from', s.handed_from) order by s.slot_date, s.start_time) as slots
      from _np s join public.students st on st.id = s.student_id
     where st.disabled_at is null
     group by s.student_id
  ) u;
  return json_build_object('teachers', tch, 'students', stu);
end $$;
revoke all on function public.schedule_notify_payload(bigint[]) from public, anon;
grant execute on function public.schedule_notify_payload(bigint[]) to authenticated;

create or replace function public.mark_schedule_notified(p_ids bigint[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_move_schedule() then raise exception 'Not allowed.'; end if;
  update public.schedules set notified_teacher_id = teacher_id, teacher_notified_at = now() where id = any(coalesce(p_ids, '{}'));
end $$;
revoke all on function public.mark_schedule_notified(bigint[]) from public, anon;
grant execute on function public.mark_schedule_notified(bigint[]) to authenticated;

-- a phone that no longer accepts alerts (uninstalled, permission removed) is forgotten
create or replace function public.drop_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.can_move_schedule() or exists (select 1 from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid())) then return; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
end $$;
revoke all on function public.drop_push_subscription(text) from public, anon;
grant execute on function public.drop_push_subscription(text) to authenticated;

-- ---------- Teachers see only their own students.
-- A student is a teacher's when the admin set that teacher on the student (Students → Teachers),
-- or the student is in that teacher's schedule (from 14 days ago to 30 days ahead, e.g. after a hand-over).
-- The admin, accounts, cashier and view-only accounts are not affected.
alter table public.students add column if not exists teacher_ids bigint[] not null default '{}';
create index if not exists students_teacher_ids_idx on public.students using gin (teacher_ids);
alter table public.schedules add column if not exists student_name text;

create or replace function public.is_teacher_role()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role = 'teacher')
$$;
create or replace function public.my_teacher_hr_id()
returns bigint language sql stable security definer set search_path = public as $$
  select id from public.hr_records where kind = 'teacher' and data->>'user_id' = auth.uid()::text order by id limit 1
$$;
create or replace function public.teaches(p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.is_teacher_role()
      or exists (select 1 from public.students s where s.id = p_student and public.my_teacher_hr_id() = any (s.teacher_ids))
      or exists (select 1 from public.schedules sc where sc.student_id = p_student and sc.teacher_user = auth.uid() and sc.status = 'scheduled'
                  and sc.slot_date between current_date - 14 and current_date + 30)
$$;
revoke all on function public.is_teacher_role() from public, anon;
revoke all on function public.my_teacher_hr_id() from public, anon;
revoke all on function public.teaches(uuid) from public, anon;
grant execute on function public.is_teacher_role() to authenticated;
grant execute on function public.my_teacher_hr_id() to authenticated;
grant execute on function public.teaches(uuid) to authenticated;

-- the student list for staff: a teacher gets only their students (and never fees)
create or replace function public.staff_students()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_admin() or public.can_fees() then to_jsonb(s)
              else to_jsonb(s) - 'monthly_fee' - 'discount_type' - 'discount_value' - 'discount_note' end
    from public.students s
   where public.is_staff() and public.teaches(s.id)
   order by s.full_name
$$;

-- reading progress, keys, ikhtibar and badges: only for their students
drop policy if exists "progress: institute all" on public.progress_months;
create policy "progress: institute all" on public.progress_months for all to authenticated
  using (public.can_teach() and public.teaches(student_id)) with check (public.can_teach() and public.teaches(student_id));
drop policy if exists "keys: institute read" on public.key_events;
create policy "keys: institute read" on public.key_events for select to authenticated using (public.can_teach() and public.teaches(student_id));
drop policy if exists "ikhtibar: institute all" on public.ikhtibars;
create policy "ikhtibar: institute all" on public.ikhtibars for all to authenticated
  using (public.can_teach() and public.teaches(student_id)) with check (public.can_teach() and public.teaches(student_id));
drop policy if exists "badges: staff read" on public.badges;
create policy "badges: staff read" on public.badges for select to authenticated using ((public.can_teach() and public.teaches(student_id)) or public.is_viewer());
drop policy if exists "badges: award" on public.badges;
create policy "badges: award" on public.badges for insert to authenticated with check (public.can_teach() and public.teaches(student_id));

-- changing anything (also through the portal's functions) is refused for someone else's student
create or replace function public._only_my_students()
returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if public.is_teacher_role() then
    if tg_table_name = 'students' then sid := coalesce(new.id, old.id);
    elsif tg_op = 'DELETE' then sid := old.student_id;
    else sid := new.student_id; end if;
    if sid is not null and not public.teaches(sid) then
      raise exception 'This student is not one of yours. Ask the admin to add you as their teacher.';
    end if;
    if tg_op = 'UPDATE' and tg_table_name <> 'students' then
      if not public.teaches(old.student_id) then raise exception 'This student is not one of yours.'; end if;
    end if;
  end if;
  return coalesce(new, old);
end $$;
do $$
declare t text;
begin
  foreach t in array array['progress_months', 'key_events', 'ikhtibars', 'badges'] loop
    execute format('drop trigger if exists only_my_students on public.%I', t);
    execute format('create trigger only_my_students before insert or update or delete on public.%I for each row execute function public._only_my_students()', t);
  end loop;
  drop trigger if exists only_my_students on public.students;
  create trigger only_my_students before update on public.students for each row execute function public._only_my_students();
end $$;

-- teachers who plan the schedule still need every student's name (only the name) to allocate
create or replace function public.schedule_students()
returns table (id uuid, full_name text, program text) language sql stable security definer set search_path = public as $$
  select s.id, s.full_name, s.program from public.students s
   where public.can_move_schedule() and s.disabled_at is null
   order by s.full_name
$$;
revoke all on function public.schedule_students() from public, anon;
grant execute on function public.schedule_students() to authenticated;

-- each slot carries the student's name, so a planner sees who it is without seeing their records
create or replace function public._schedule_student_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select full_name into new.student_name from public.students where id = new.student_id;
  return new;
end $$;
drop trigger if exists schedules_student_name on public.schedules;
create trigger schedules_student_name before insert or update of student_id on public.schedules for each row execute function public._schedule_student_name();
update public.schedules sc set student_name = s.full_name from public.students s where s.id = sc.student_id and sc.student_name is distinct from s.full_name;

-- ---------- Hifz: "Now at" and pages memorised always match; monthly report fills itself in.
-- Order: forward: page 1 → 604. Now at page 59 = 59 pages memorised.
--        reverse ('backward'): page 604 → 502 (Juz 30 back to the start of Juz 26), then page 1 → 501.
--        Now at page 600 = 5 pages; page 502 = 103 pages; then page 1 = 104 pages … page 501 = 604 pages.
alter table public.students add column if not exists hifz_dir text check (hifz_dir in ('forward', 'backward'));
alter table public.students add column if not exists hifz_dir_manual boolean not null default false;

create or replace function public._surah_starts()
returns int[] language sql immutable as $$ select array[1,2,50,77,106,128,151,177,187,208,221,235,249,255,262,267,282,293,305,312,322,332,342,350,359,367,377,385,396,404,411,415,418,428,434,440,446,453,458,467,477,483,489,496,499,502,507,511,515,518,520,523,526,528,531,534,537,542,545,549,551,553,554,556,558,560,562,564,566,568,570,572,574,575,577,578,580,582,583,585,586,587,587,589,590,591,591,592,593,594,595,595,596,596,597,597,598,598,599,599,600,600,601,601,601,602,602,602,603,603,603,604,604,604] $$;
-- position in the student's own sequence (1 … 604) for a page number, and back
create or replace function public._pos_count(p_pos int, p_dir text)
returns int language sql immutable as $$
  select case when p_pos is null or p_pos < 1 or p_pos > 604 then 0
              when p_dir = 'backward' then case when p_pos >= 502 then 605 - p_pos else 103 + p_pos end
              else p_pos end
$$;
create or replace function public._count_pos(p_count int, p_dir text)
returns int language sql immutable as $$
  select case when coalesce(p_count, 0) <= 0 then null
              when p_dir = 'backward' then case when least(604, p_count) <= 103 then 605 - least(604, p_count) else least(604, p_count) - 103 end
              else least(604, p_count) end
$$;
-- the surah at a page (going backward: the surah that begins on that page, if one does)
create or replace function public._page_surah(p_pos int, p_dir text)
returns int language plpgsql immutable as $$
declare a int[] := public._surah_starts(); n int := 1; i int;
begin
  if p_pos is null or p_pos < 1 or p_pos > 604 then return null; end if;
  if p_dir = 'backward' and p_pos >= 502 then
    for i in 1 .. 114 loop if a[i] = p_pos then return i; end if; end loop;
  end if;
  for i in 1 .. 114 loop if a[i] <= p_pos then n := i; end if; end loop;
  return n;
end $$;
-- guess the order from the first "Now at" page and the pages already counted
create or replace function public._guess_dir(p_pos int, p_had int)
returns text language sql immutable as $$
  select case when coalesce(p_had, 0) > 0 then case when abs((605 - p_pos) - p_had) + 10 < abs(p_pos - p_had) then 'backward' else 'forward' end
              when p_pos > 302 then 'backward' else 'forward' end
$$;

-- A month's row is made the first time anything happens in it. For the current month it keeps
-- where the student started (page and pages memorised), which then never changes for that month.
create or replace function public._ensure_month(p_student uuid, p_month text)
returns void language plpgsql security definer set search_path = public as $$
declare cur text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM'); s public.students; prev public.progress_months;
begin
  if exists (select 1 from public.progress_months where student_id = p_student and month = p_month) then return; end if;
  select * into s from public.students where id = p_student;
  if not found then return; end if;
  if p_month = cur then
    insert into public.progress_months (student_id, month, pages_end, start_page, start_pos, start_surah, end_pos, end_surah)
    values (p_student, p_month, s.pages, s.pages, s.cur_pos, s.cur_surah, s.cur_pos, s.cur_surah)
    on conflict (student_id, month) do nothing;
  else
    -- another month: start from where the month before it ended, if we know
    select * into prev from public.progress_months where student_id = p_student and month < p_month and pages_end is not null order by month desc limit 1;
    insert into public.progress_months (student_id, month, pages_end, start_page, start_pos, start_surah)
    values (p_student, p_month, coalesce(prev.pages_end, case when p_month > cur then s.pages end), prev.pages_end, prev.end_pos, prev.end_surah)
    on conflict (student_id, month) do nothing;
  end if;
end $$;

-- Sets pages memorised and moves "Now at" to match (and this month's "Reached").
create or replace function public._hifz_set(p_student uuid, p_count int, p_surah int default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.students; v_dir text; v_pos int; v_cnt int := greatest(0, least(604, coalesce(p_count, 0)));
        cur text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM');
begin
  select * into s from public.students where id = p_student;
  if not found then raise exception 'Student not found.'; end if;
  -- no direction yet: only the total can change (the page is not guessed)
  if s.hifz_dir is null then
    update public.students set pages = v_cnt where id = p_student;
    perform public._ensure_month(p_student, cur);
    update public.progress_months set pages_end = v_cnt, updated_at = now() where student_id = p_student and month = cur;
    return;
  end if;
  v_dir := s.hifz_dir;
  v_pos := public._count_pos(v_cnt, v_dir);
  update public.students set pages = v_cnt, cur_pos = v_pos,
         cur_surah = case when v_pos is null then null when p_surah between 1 and 114 then p_surah else public._page_surah(v_pos, v_dir) end
   where id = p_student;
  perform public._ensure_month(p_student, cur);
  update public.progress_months set pages_end = v_cnt, end_pos = v_pos,
         end_surah = case when v_pos is null then null when p_surah between 1 and 114 then p_surah else public._page_surah(v_pos, v_dir) end, updated_at = now()
   where student_id = p_student and month = cur;
end $$;
revoke all on function public._hifz_set(uuid, int, int) from public, anon, authenticated;
revoke all on function public._ensure_month(uuid, text) from public, anon, authenticated;

-- "Now at": the teacher types the page (and surah); pages memorised follow. The first time, the order is detected.
create or replace function public.set_now_at(p_student uuid, p_surah int, p_pos int)
returns json language plpgsql security definer set search_path = public as $$
declare s public.students; v_dir text; v_surah int := p_surah; v_pos int := p_pos;
begin
  if not public.can_teach() then raise exception 'Only teachers can update hifz.'; end if;
  if v_surah is not null and (v_surah < 1 or v_surah > 114) then raise exception 'Surah must be 1 to 114.'; end if;
  if v_pos is not null and (v_pos < 1 or v_pos > 604) then raise exception 'Page must be 1 to 604.'; end if;
  select * into s from public.students where id = p_student for update;
  if not found then raise exception 'Student not found.'; end if;
  if v_pos is null and v_surah is not null then v_pos := (public._surah_starts())[v_surah]; end if;
  perform public._ensure_month(p_student, to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM'));
  if v_pos is null then
    perform public._hifz_set(p_student, 0, null);
    return json_build_object('pages', 0, 'cur_pos', null, 'dir', coalesce(s.hifz_dir, 'forward'));
  end if;
  -- the direction is never guessed from one page: it must be set on the student first
  if s.hifz_dir is null then raise exception 'Set this student''s memorisation direction (forward or reverse) first.'; end if;
  v_dir := s.hifz_dir;
  perform public._hifz_set(p_student, public._pos_count(v_pos, v_dir), v_surah);
  -- the very first "Now at" for a student is where they start, not progress made this month
  if s.cur_pos is null and coalesce(s.pages, 0) = 0 then
    update public.progress_months set start_page = public._pos_count(v_pos, v_dir), start_pos = v_pos, start_surah = (select cur_surah from public.students where id = p_student)
     where student_id = p_student and month = to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM') and coalesce(jadeed, 0) = 0;
  end if;
  return json_build_object('pages', public._pos_count(v_pos, v_dir), 'cur_pos', v_pos, 'dir', v_dir);
end $$;
revoke all on function public.set_now_at(uuid, int, int) from public, anon;
grant execute on function public.set_now_at(uuid, int, int) to authenticated;

-- the older call some screens use: same thing
create or replace function public.set_position(p_student uuid, p_surah int, p_pos int)
returns void language plpgsql security definer set search_path = public as $$
begin perform public.set_now_at(p_student, p_surah, p_pos); end $$;

-- change the order by hand: "Now at" stays, pages memorised are counted again
create or replace function public.set_hifz_dir(p_student uuid, p_dir text)
returns json language plpgsql security definer set search_path = public as $$
declare s public.students;
begin
  if not public.can_teach() then raise exception 'Only teachers can update hifz.'; end if;
  if p_dir not in ('forward', 'backward') then raise exception 'Choose forward or backward.'; end if;
  select * into s from public.students where id = p_student for update;
  if not found then raise exception 'Student not found.'; end if;
  update public.students set hifz_dir = p_dir, hifz_dir_manual = true where id = p_student;
  if s.cur_pos is not null then perform public._hifz_set(p_student, public._pos_count(s.cur_pos, p_dir), s.cur_surah); end if;
  return json_build_object('dir', p_dir, 'pages', (select pages from public.students where id = p_student));
end $$;
revoke all on function public.set_hifz_dir(uuid, text) from public, anon;
grant execute on function public.set_hifz_dir(uuid, text) to authenticated;

-- correcting the total also moves "Now at"
create or replace function public.set_pages(p_student uuid, p_month text, p_pages int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_teach() then raise exception 'Only the institute can update pages.'; end if;
  if coalesce(p_pages, -1) < 0 or p_pages > 604 then raise exception 'Pages must be between 0 and 604.'; end if;
  perform public._hifz_set(p_student, p_pages, null);
end $$;

-- each jadeed page moves "Now at" one page on (forward or backward) and adds one to pages memorised
create or replace function public.record_jadeed(p_student uuid, p_month text, p_pages int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare v_k int; v_pages int; v_event bigint; v_goal boolean; s public.students;
begin
  if not public.can_teach() then raise exception 'Only the institute can record progress.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if coalesce(p_pages, 0) < 1 or p_pages > 100 then raise exception 'Pages must be between 1 and 100.'; end if;
  select keys_jadeed into v_k from public.settings where id = 1;
  select * into s from public.students where id = p_student for update;
  if not found then raise exception 'Student not found.'; end if;
  perform public._ensure_month(p_student, p_month);
  perform public._ensure_month(p_student, to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM'));
  perform public._hifz_set(p_student, least(604, s.pages + p_pages), null);
  update public.students set keys = keys + v_k * p_pages,
         hifz_credited = case when hifz_base is not null then greatest(coalesce(hifz_credited, 0), pages) end
   where id = p_student returning pages into v_pages;
  update public.progress_months set jadeed = jadeed + p_pages, pages_end = v_pages, updated_at = now()
   where student_id = p_student and month = p_month;
  insert into public.key_events (student_id, kind, keys, pages, month, note)
  values (p_student, 'jadeed', v_k * p_pages, p_pages, p_month,
          case when p_pages = 1 then 'Jadeed page cleared' else 'Jadeed: ' || p_pages || ' pages cleared' end)
  returning id into v_event;
  v_goal := public._check_goal(p_student, p_month);
  return json_build_object('event_id', v_event, 'goal_reached', v_goal,
    'pages', v_pages, 'keys', (select keys from public.students where id = p_student));
end $$;

create or replace function public.undo_key_event(p_event bigint)
returns void language plpgsql security definer set search_path = public as $$
declare e public.key_events; v_pages int;
begin
  if not public.can_teach() then raise exception 'Only the institute can undo progress.'; end if;
  select * into e from public.key_events where id = p_event for update;
  if not found then raise exception 'This entry was already removed.'; end if;
  update public.students set keys = greatest(0, keys - e.keys) where id = e.student_id;
  if coalesce(e.pages, 0) > 0 then
    perform public._hifz_set(e.student_id, greatest(0, (select pages from public.students where id = e.student_id) - e.pages), null);
  end if;
  select pages into v_pages from public.students where id = e.student_id;
  if e.kind = 'jadeed' and e.pages > 0 then
    update public.students set hifz_credited = greatest(coalesce(hifz_base, 0), least(coalesce(hifz_credited, v_pages), v_pages)) where id = e.student_id and hifz_base is not null;
  end if;
  if e.kind = 'jadeed' then
    update public.progress_months set jadeed = greatest(0, jadeed - e.pages), pages_end = v_pages, updated_at = now()
     where student_id = e.student_id and month = e.month;
  elsif e.kind = 'ikhtibar' then
    update public.progress_months set ikhtibar = greatest(0, ikhtibar - 1), updated_at = now()
     where student_id = e.student_id and month = e.month;
    delete from public.ikhtibars where key_event_id = e.id and quick;
    update public.ikhtibars set status = 'scheduled', key_event_id = null where key_event_id = e.id;
  elsif e.kind = 'goal' then
    update public.progress_months set goal_awarded = false, updated_at = now()
     where student_id = e.student_id and month = e.month;
  end if;
  delete from public.key_events where id = p_event;
end $$;

-- the monthly goal for everyone also sets each student's goal page from where they started
create or replace function public.set_month_goal(p_student uuid, p_month text, p_goal int)
returns int language plpgsql security definer set search_path = public as $$
declare s record; n int := 0;
begin
  if not public.can_teach() then raise exception 'Only the institute can set goals.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if coalesce(p_goal, -1) < 0 or p_goal > 604 then raise exception 'Goal must be between 0 and 604 pages.'; end if;
  for s in select st.id, st.hifz_dir as dir from public.students st where (p_student is null and st.disabled_at is null and public.teaches(st.id)) or st.id = p_student loop
    perform public._ensure_month(s.id, p_month);
    update public.progress_months set goal = p_goal,
           goal_page = case when p_goal > 0 and start_page is not null then least(604, start_page + p_goal) end,
           goal_pos = case when p_goal > 0 and start_page is not null and s.dir is not null then public._count_pos(least(604, start_page + p_goal), s.dir) end,
           goal_surah = case when p_goal > 0 and start_page is not null and s.dir is not null then public._page_surah(public._count_pos(least(604, start_page + p_goal), s.dir), s.dir) end,
           updated_at = now()
     where student_id = s.id and month = p_month;
    perform public._check_goal(s.id, p_month);
    n := n + 1;
  end loop;
  return n;
end $$;

-- goal reached = pages memorised this month (reached − started) ≥ the month's target
create or replace function public._check_goal(p_student uuid, p_month text)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.progress_months; v int; done int;
begin
  select * into r from public.progress_months where student_id = p_student and month = p_month for update;
  if not found or r.goal_awarded or coalesce(r.goal, 0) <= 0 then return false; end if;
  -- pages memorised this month: reached − started (the jadeed count only when the start is not known)
  done := case when r.pages_end is not null and r.start_page is not null then r.pages_end - r.start_page else coalesce(r.jadeed, 0) end;
  if done < r.goal then return false; end if;
  select keys_goal into v from public.settings where id = 1;
  update public.progress_months set goal_awarded = true, updated_at = now() where student_id = p_student and month = p_month;
  insert into public.key_events (student_id, kind, keys, month, note)
  values (p_student, 'goal', v, p_month, 'Monthly goal of ' || r.goal || ' pages reached');
  update public.students set keys = keys + v where id = p_student;
  return true;
end $$;

-- saving a month's report: for this month, "Reached" moves "Now at" (and pages memorised follow)
create or replace function public.save_month_report(
  p_student uuid, p_month text, p_start_page int, p_goal_page int, p_end_page int,
  p_ajza text, p_ahkaam text, p_murajaat int, p_dawrat int, p_note text,
  p_start_surah int default null, p_start_pos int default null, p_goal_surah int default null, p_goal_pos int default null,
  p_end_surah int default null, p_end_pos int default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_goal boolean; cur text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM'); v_dir text;
begin
  if not public.can_teach() then raise exception 'Only the institute can save reports.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if (p_start_page is not null and (p_start_page < 0 or p_start_page > 604)) or (p_goal_page is not null and (p_goal_page < 0 or p_goal_page > 604))
     or (p_end_page is not null and (p_end_page < 0 or p_end_page > 604)) then raise exception 'Pages memorised must be between 0 and 604.'; end if;
  if p_goal_page is not null and p_start_page is not null and p_goal_page <= p_start_page then raise exception 'Pages to memorise must be more than 0.'; end if;
  select hifz_dir into v_dir from public.students where id = p_student;
  if not found then raise exception 'Student not found.'; end if;
  perform public._ensure_month(p_student, p_month);
  update public.progress_months set
    start_page = coalesce(p_start_page, start_page), goal_page = p_goal_page, pages_end = coalesce(p_end_page, pages_end),
    goal = case when p_goal_page is not null and coalesce(p_start_page, start_page) is not null then p_goal_page - coalesce(p_start_page, start_page) else 0 end,
    start_surah = coalesce(p_start_surah, start_surah), start_pos = coalesce(p_start_pos, start_pos),
    goal_surah = p_goal_surah, goal_pos = p_goal_pos,
    end_surah = coalesce(p_end_surah, end_surah), end_pos = coalesce(p_end_pos, end_pos),
    ajza_improve = nullif(trim(coalesce(p_ajza, '')), ''), ahkaam = nullif(trim(coalesce(p_ahkaam, '')), ''),
    murajaat = coalesce(p_murajaat, murajaat), dawrat = p_dawrat, report_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
  where student_id = p_student and month = p_month;
  if p_month >= cur then
    if p_end_pos is not null then perform public._hifz_set(p_student, public._pos_count(p_end_pos, v_dir), p_end_surah);
    elsif p_end_page is not null then perform public._hifz_set(p_student, p_end_page, null); end if;
  end if;
  v_goal := public._check_goal(p_student, p_month);
  return json_build_object('goal_reached', v_goal, 'keys', (select keys from public.students where id = p_student));
end $$;

-- Directions are never guessed: clear any that an earlier version of this update worked out by itself
-- (once only), so a teacher sets each student's direction the first time they add pages.
alter table public.app_private add column if not exists hifz_v2 boolean not null default false;
do $$
begin
  if not coalesce((select hifz_v2 from public.app_private where id = 1), false) then
    update public.students set hifz_dir = null where hifz_dir is not null and not hifz_dir_manual;
    update public.app_private set hifz_v2 = true where id = 1;
  end if;
end $$;

-- ---------- Goal: "Add New Memorized Pages" — the teacher types the current page, everything else follows.
-- Keys are given once per page: hifz_credited is the furthest page (in the student's sequence) keys were given for,
-- hifz_base where the record started. A correction takes back only keys given for pages it removes.
alter table public.students add column if not exists hifz_credited int;
alter table public.students add column if not exists hifz_base int;
-- p_from is the page the screen showed; if it no longer matches, the entry was already saved (double tap,
-- another phone), so nothing is counted twice. A page behind the current one, or a very big jump, needs p_confirm.
create or replace function public.add_memorized_pages(p_student uuid, p_page int, p_from int default null, p_confirm boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare s public.students; v_k int; v_old int; v_new int; v_delta int; v_event bigint; v_goal boolean;
        cur text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM'); r public.progress_months; v_first boolean;
begin
  if not public.can_teach() then raise exception 'Only teachers can record memorised pages.'; end if;
  if p_page is null or p_page < 1 or p_page > 604 then raise exception 'Enter a page number between 1 and 604.'; end if;
  select * into s from public.students where id = p_student for update;
  if not found then raise exception 'Student not found.'; end if;
  if s.hifz_dir is null then raise exception 'Set this student''s memorisation direction (forward or reverse) first.'; end if;
  if p_from is distinct from s.cur_pos then
    return json_build_object('status', 'changed', 'cur_pos', s.cur_pos, 'pages', s.pages,
      'message', 'This was already updated: the current page is now ' || coalesce(s.cur_pos::text, 'not set') || '. Nothing was counted twice.');
  end if;
  v_first := s.cur_pos is null;
  v_old := case when v_first then coalesce(s.pages, 0) else public._pos_count(s.cur_pos, s.hifz_dir) end;
  v_new := public._pos_count(p_page, s.hifz_dir);
  v_delta := v_new - v_old;
  if not v_first and v_delta = 0 then
    return json_build_object('status', 'same', 'cur_pos', s.cur_pos, 'pages', s.pages, 'message', 'No new pages: page ' || p_page || ' is already the current page.');
  end if;
  if not v_first and not coalesce(p_confirm, false) and (v_delta < 0 or v_delta > 40) then
    return json_build_object('status', 'confirm', 'delta', v_delta, 'cur_pos', s.cur_pos, 'pages', s.pages,
      'message', case when v_delta < 0 then 'Page ' || p_page || ' is behind the current page ' || s.cur_pos || ' for a ' || case when s.hifz_dir = 'backward' then 'reverse' else 'forward' end || ' student. Save it as a correction (' || abs(v_delta) || ' page' || case when abs(v_delta) = 1 then '' else 's' end || ' taken off)?'
                      else 'That is ' || v_delta || ' new pages since page ' || s.cur_pos || '. Is that right?' end);
  end if;
  perform public._ensure_month(p_student, cur);
  select keys_jadeed into v_k from public.settings where id = 1;
  if s.hifz_base is null then
    update public.students set hifz_base = v_old, hifz_credited = greatest(coalesce(hifz_credited, v_old), v_old) where id = p_student;
    select * into s from public.students where id = p_student;
  end if;
  if v_first then
    -- the first page entered is where the student starts: no pages or keys are counted for it
    perform public._hifz_set(p_student, v_new, null);
    update public.students set hifz_base = v_new, hifz_credited = v_new where id = p_student;
    update public.progress_months set start_page = v_new, start_pos = p_page, start_surah = public._page_surah(p_page, s.hifz_dir)
     where student_id = p_student and month = cur and coalesce(jadeed, 0) = 0;
    v_delta := 0;
  else
    perform public._hifz_set(p_student, v_new, null);
    if v_delta > 0 then
      -- keys only for pages beyond the furthest page already rewarded
      update public.students set keys = keys + v_k * greatest(0, v_new - greatest(v_old, coalesce(hifz_credited, v_old))),
             hifz_credited = greatest(coalesce(hifz_credited, v_old), v_new) where id = p_student;
    else
      -- a correction takes back the keys for the pages it removes (never below where the record started)
      update public.students set keys = greatest(0, keys - v_k * greatest(0, coalesce(hifz_credited, v_old) - greatest(v_new, coalesce(hifz_base, 0)))),
             hifz_credited = greatest(v_new, coalesce(hifz_base, 0)) where id = p_student;
    end if;
    update public.progress_months set jadeed = case when start_page is not null then greatest(0, pages_end - start_page) else greatest(0, jadeed + v_delta) end, updated_at = now()
     where student_id = p_student and month = cur;
    insert into public.key_events (student_id, kind, keys, pages, month, note)
    values (p_student, 'jadeed', (select keys from public.students where id = p_student) - s.keys, v_delta, cur,
            case when v_delta > 0 then 'Memorised to page ' || p_page || ' (+' || v_delta || ' page' || case when v_delta = 1 then '' else 's' end || ')'
                 else 'Correction: back to page ' || p_page || ' (' || v_delta || ' pages)' end)
    returning id into v_event;
  end if;
  v_goal := public._check_goal(p_student, cur);
  select * into r from public.progress_months where student_id = p_student and month = cur;
  select * into s from public.students where id = p_student;
  return json_build_object('status', case when v_first then 'started' when v_delta < 0 then 'corrected' else 'added' end,
    'event_id', v_event, 'new_pages', v_delta, 'cur_pos', s.cur_pos, 'pages', s.pages, 'keys', s.keys, 'goal_reached', v_goal,
    'month_done', greatest(0, coalesce(r.pages_end, 0) - coalesce(r.start_page, r.pages_end, 0)), 'month_goal', coalesce(r.goal, 0));
end $$;
revoke all on function public.add_memorized_pages(uuid, int, int, boolean) from public, anon;
grant execute on function public.add_memorized_pages(uuid, int, int, boolean) to authenticated;

-- Correcting a past month's "Reached" also moves the next month's "Started at" if it had been carried over.
create or replace function public._carry_month_end()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pages_end is distinct from old.pages_end or new.end_pos is distinct from old.end_pos then
    update public.progress_months n set start_page = new.pages_end, start_pos = new.end_pos, start_surah = new.end_surah
     where n.student_id = new.student_id
       and n.month = (select min(month) from public.progress_months x where x.student_id = new.student_id and x.month > new.month)
       and n.start_page is not distinct from old.pages_end and n.start_pos is not distinct from old.end_pos
       and new.month < to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM');
  end if;
  return new;
end $$;
drop trigger if exists progress_carry_end on public.progress_months;
create trigger progress_carry_end after update of pages_end, end_pos on public.progress_months for each row execute function public._carry_month_end();


-- ---------- Goal: corrections and deletions by the admin, with a record of every change.
create table if not exists public.hifz_audit (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.students (id) on delete cascade,
  month text,
  what text not null,
  old_value text,
  new_value text,
  note text,
  changed_by uuid default auth.uid(),
  changed_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists hifz_audit_student_idx on public.hifz_audit (student_id, created_at desc);
alter table public.hifz_audit enable row level security;
drop policy if exists "hifz audit: admin read" on public.hifz_audit;
create policy "hifz audit: admin read" on public.hifz_audit for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.hifz_audit from anon, authenticated;
grant select on public.hifz_audit to authenticated;

create or replace function public._audit(p_student uuid, p_month text, p_what text, p_old text, p_new text, p_note text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.hifz_audit (student_id, month, what, old_value, new_value, note, changed_by, changed_by_name)
  values (p_student, p_month, p_what, p_old, p_new, nullif(trim(coalesce(p_note, '')), ''), auth.uid(), (select username from public.admins where user_id = auth.uid()))
$$;
revoke all on function public._audit(uuid, text, text, text, text, text) from public, anon, authenticated;

-- takes back the monthly-goal keys when the goal is no longer met (after a correction)
create or replace function public._recheck_goal(p_student uuid, p_month text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.progress_months; v_keys int; done int;
begin
  select * into r from public.progress_months where student_id = p_student and month = p_month for update;
  if not found then return; end if;
  done := case when r.pages_end is not null and r.start_page is not null then r.pages_end - r.start_page else coalesce(r.jadeed, 0) end;
  if r.goal_awarded and (coalesce(r.goal, 0) <= 0 or done < r.goal) then
    select coalesce(sum(keys), 0) into v_keys from public.key_events where student_id = p_student and month = p_month and kind = 'goal';
    delete from public.key_events where student_id = p_student and month = p_month and kind = 'goal';
    update public.students set keys = greatest(0, keys - v_keys) where id = p_student;
    update public.progress_months set goal_awarded = false, updated_at = now() where student_id = p_student and month = p_month;
    perform public._audit(p_student, p_month, 'Goal keys taken back', v_keys::text, '0', 'Goal no longer reached after a correction');
  end if;
  perform public._check_goal(p_student, p_month);
end $$;
revoke all on function public._recheck_goal(uuid, text) from public, anon, authenticated;

-- Correct a month: started-at page, monthly goal, reached / current page, and the student's direction.
-- Only what is given (not null) is changed; every change is recorded.
create or replace function public.admin_correct_goal(p_student uuid, p_month text, p_start_pos int default null, p_goal int default null,
  p_reached_pos int default null, p_dir text default null, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare s public.students; r public.progress_months; cur text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM');
        v_dir text; v_k int; v_new int; v_old int;
begin
  if not public.is_admin() then raise exception 'Only an administrator can correct goals and pages.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if (p_start_pos is not null and (p_start_pos < 1 or p_start_pos > 604)) or (p_reached_pos is not null and (p_reached_pos < 1 or p_reached_pos > 604)) then
    raise exception 'Page numbers must be between 1 and 604.'; end if;
  if p_goal is not null and (p_goal < 0 or p_goal > 604) then raise exception 'The monthly goal must be between 0 and 604 pages.'; end if;
  if p_dir is not null and p_dir not in ('forward', 'backward') then raise exception 'Direction must be forward or reverse.'; end if;
  select * into s from public.students where id = p_student for update;
  if not found then raise exception 'Student not found.'; end if;
  perform public._ensure_month(p_student, p_month);
  -- 1. direction: page numbers stay, every total is counted again
  if p_dir is not null and p_dir is distinct from s.hifz_dir then
    perform public._audit(p_student, p_month, 'Direction', coalesce(s.hifz_dir, 'not set'), p_dir, p_note);
    update public.students set hifz_dir = p_dir, hifz_dir_manual = true, hifz_base = null, hifz_credited = null,
           pages = case when cur_pos is not null then public._pos_count(cur_pos, p_dir) else pages end where id = p_student;
    update public.progress_months set
           start_page = case when start_pos is not null then public._pos_count(start_pos, p_dir) else start_page end,
           pages_end = case when end_pos is not null then public._pos_count(end_pos, p_dir) else pages_end end
     where student_id = p_student;
    update public.progress_months set
           goal_page = case when goal > 0 and start_page is not null then least(604, start_page + goal) end,
           goal_pos = case when goal > 0 and start_page is not null then public._count_pos(least(604, start_page + goal), p_dir) end,
           goal_surah = case when goal > 0 and start_page is not null then public._page_surah(public._count_pos(least(604, start_page + goal), p_dir), p_dir) end
     where student_id = p_student;
    select * into s from public.students where id = p_student;
  end if;
  v_dir := s.hifz_dir;
  if v_dir is null and (p_start_pos is not null or p_reached_pos is not null) then raise exception 'Set the memorisation direction first.'; end if;
  select * into r from public.progress_months where student_id = p_student and month = p_month;
  -- 2. started at
  if p_start_pos is not null and p_start_pos is distinct from r.start_pos then
    perform public._audit(p_student, p_month, 'Started at', coalesce('page ' || r.start_pos, 'not set'), 'page ' || p_start_pos, p_note);
    update public.progress_months set start_pos = p_start_pos, start_page = public._pos_count(p_start_pos, v_dir), start_surah = public._page_surah(p_start_pos, v_dir), updated_at = now()
     where student_id = p_student and month = p_month;
  end if;
  -- 3. monthly goal
  if p_goal is not null and p_goal is distinct from coalesce(r.goal, 0) then
    perform public._audit(p_student, p_month, 'Monthly goal', coalesce(r.goal, 0) || ' pages', p_goal || ' pages', p_note);
    update public.progress_months set goal = p_goal, updated_at = now() where student_id = p_student and month = p_month;
  end if;
  -- 4. reached / current page
  if p_reached_pos is not null then
    if p_month >= cur then
      if p_reached_pos is distinct from s.cur_pos then
        perform public._audit(p_student, p_month, 'Current page', coalesce('page ' || s.cur_pos, 'not set'), 'page ' || p_reached_pos, p_note);
        select keys_jadeed into v_k from public.settings where id = 1;
        v_old := case when s.cur_pos is null then coalesce(s.pages, 0) else public._pos_count(s.cur_pos, v_dir) end;
        v_new := public._pos_count(p_reached_pos, v_dir);
        if v_new < coalesce(s.hifz_credited, v_old) and s.hifz_base is not null then
          -- the keys given for pages that are now taken off go back
          update public.students set keys = greatest(0, keys - v_k * greatest(0, hifz_credited - greatest(v_new, hifz_base))), hifz_credited = greatest(v_new, hifz_base) where id = p_student;
        end if;
        perform public._hifz_set(p_student, v_new, null);
      end if;
    else
      if p_reached_pos is distinct from r.end_pos then
        perform public._audit(p_student, p_month, 'Reached', coalesce('page ' || r.end_pos, 'not set'), 'page ' || p_reached_pos, p_note);
        update public.progress_months set end_pos = p_reached_pos, pages_end = public._pos_count(p_reached_pos, v_dir), end_surah = public._page_surah(p_reached_pos, v_dir), updated_at = now()
         where student_id = p_student and month = p_month;
      end if;
    end if;
  end if;
  -- 5. work the month out again: target page, pages this month, goal reached
  update public.progress_months set
         goal_page = case when goal > 0 and start_page is not null then least(604, start_page + goal) end,
         goal_pos = case when goal > 0 and start_page is not null and v_dir is not null then public._count_pos(least(604, start_page + goal), v_dir) end,
         goal_surah = case when goal > 0 and start_page is not null and v_dir is not null then public._page_surah(public._count_pos(least(604, start_page + goal), v_dir), v_dir) end,
         jadeed = case when month = cur and start_page is not null and pages_end is not null then greatest(0, pages_end - start_page) else jadeed end
   where student_id = p_student and month = p_month;
  perform public._recheck_goal(p_student, p_month);
  select * into r from public.progress_months where student_id = p_student and month = p_month;
  return json_build_object('ok', true, 'start_pos', r.start_pos, 'goal', r.goal, 'goal_pos', r.goal_pos, 'end_pos', r.end_pos,
    'pages', (select pages from public.students where id = p_student), 'cur_pos', (select cur_pos from public.students where id = p_student));
end $$;
revoke all on function public.admin_correct_goal(uuid, text, int, int, int, text, text) from public, anon;
grant execute on function public.admin_correct_goal(uuid, text, int, int, int, text, text) to authenticated;

-- Delete the month's goal only (pages, history and fees are not touched).
create or replace function public.admin_delete_goal(p_student uuid, p_month text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.progress_months;
begin
  if not public.is_admin() then raise exception 'Only an administrator can delete goals.'; end if;
  select * into r from public.progress_months where student_id = p_student and month = p_month for update;
  if not found or coalesce(r.goal, 0) = 0 then raise exception 'There is no goal for this month.'; end if;
  perform public._audit(p_student, p_month, 'Monthly goal deleted', r.goal || ' pages (target page ' || coalesce(r.goal_pos::text, '–') || ')', null, p_note);
  update public.progress_months set goal = 0, goal_page = null, goal_pos = null, goal_surah = null, updated_at = now() where student_id = p_student and month = p_month;
  perform public._recheck_goal(p_student, p_month);
end $$;
revoke all on function public.admin_delete_goal(uuid, text, text) from public, anon;
grant execute on function public.admin_delete_goal(uuid, text, text) to authenticated;

-- Delete a wrong starting point: it goes back to where the month before ended (or is left empty to enter again).
create or replace function public.admin_delete_start(p_student uuid, p_month text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.progress_months; prev public.progress_months; v_dir text;
begin
  if not public.is_admin() then raise exception 'Only an administrator can delete a starting point.'; end if;
  select * into r from public.progress_months where student_id = p_student and month = p_month for update;
  if not found or (r.start_pos is null and r.start_page is null) then raise exception 'There is no starting point for this month.'; end if;
  select hifz_dir into v_dir from public.students where id = p_student;
  select * into prev from public.progress_months where student_id = p_student and month < p_month and pages_end is not null order by month desc limit 1;
  perform public._audit(p_student, p_month, 'Started at deleted', coalesce('page ' || r.start_pos, r.start_page || ' pages'), coalesce('page ' || prev.end_pos, 'empty'), p_note);
  update public.progress_months set start_page = prev.pages_end, start_pos = prev.end_pos, start_surah = prev.end_surah,
         goal_page = case when goal > 0 and prev.pages_end is not null then least(604, prev.pages_end + goal) end,
         goal_pos = case when goal > 0 and prev.pages_end is not null and v_dir is not null then public._count_pos(least(604, prev.pages_end + goal), v_dir) end,
         goal_surah = null, updated_at = now()
   where student_id = p_student and month = p_month;
  perform public._recheck_goal(p_student, p_month);
end $$;
revoke all on function public.admin_delete_start(uuid, text, text) from public, anon;
grant execute on function public.admin_delete_start(uuid, text, text) to authenticated;

-- Delete one memorisation entry (a page entry): pages, keys and the month are worked out again.
create or replace function public.admin_delete_entry(p_event bigint, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare e public.key_events; cur text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM');
begin
  if not public.is_admin() then raise exception 'Only an administrator can delete page entries.'; end if;
  select * into e from public.key_events where id = p_event;
  if not found then raise exception 'This entry was already removed.'; end if;
  if e.kind <> 'jadeed' then raise exception 'Only memorisation entries can be deleted here.'; end if;
  perform public._audit(e.student_id, e.month, 'Page entry deleted', coalesce(e.note, '') || ' (' || e.pages || ' pages, ' || e.keys || ' keys, ' || to_char(e.created_at at time zone 'Africa/Dar_es_Salaam', 'DD Mon YYYY HH24:MI') || ')', null, p_note);
  perform public.undo_key_event(p_event);
  update public.progress_months set jadeed = greatest(0, pages_end - start_page) where student_id = e.student_id and month = cur and start_page is not null and pages_end is not null;
  perform public._recheck_goal(e.student_id, e.month);
  return json_build_object('ok', true, 'pages', (select pages from public.students where id = e.student_id), 'cur_pos', (select cur_pos from public.students where id = e.student_id));
end $$;
revoke all on function public.admin_delete_entry(bigint, text) from public, anon;
grant execute on function public.admin_delete_entry(bigint, text) to authenticated;

-- ---------- Schedule: tell the student and teacher(s) about changes too (time, date, teacher, cancelled, restored).
-- notified_sig = what they were last told: teacher|date|from|to|status.
create or replace function public._sched_sig(p_teacher bigint, p_date date, p_from time, p_to time, p_status text)
returns text language sql immutable as $$ select p_teacher || '|' || p_date || '|' || to_char(p_from, 'HH24:MI') || '|' || to_char(p_to, 'HH24:MI') || '|' || p_status $$;
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'schedules' and column_name = 'notified_sig') then
    alter table public.schedules add column notified_sig text;
    -- slots already told about keep what they were told
    update public.schedules set notified_sig = public._sched_sig(teacher_id, slot_date, start_time, end_time, status) where notified_teacher_id is not distinct from teacher_id;
  end if;
end $$;

create or replace function public.schedule_notify_payload(p_ids bigint[])
returns json language plpgsql stable security definer set search_path = public as $$
declare tch json; stu json;
begin
  if not public.can_move_schedule() then raise exception 'Only the admin and teachers with schedule permission can send alerts.'; end if;
  with np as (
    select s.*, st.full_name as student_full, st.email as student_email, st.disabled_at,
           split_part(s.notified_sig, '|', 1) as o_tid, split_part(s.notified_sig, '|', 2) as o_date, split_part(s.notified_sig, '|', 3) as o_from,
           split_part(s.notified_sig, '|', 4) as o_to, split_part(s.notified_sig, '|', 5) as o_status
      from public.schedules s join public.students st on st.id = s.student_id
     where s.id = any(coalesce(p_ids, '{}'))
       and s.notified_sig is distinct from public._sched_sig(s.teacher_id, s.slot_date, s.start_time, s.end_time, s.status)
       and not (s.notified_sig is null and s.status = 'cancelled')
  ), k as (
    select np.*, case when notified_sig is null then 'new'
                      when status = 'cancelled' then 'cancelled'
                      when o_status = 'cancelled' then 'restored'
                      when o_tid <> teacher_id::text then 'moved'
                      else 'changed' end as kind,
           (select h.data->>'full_name' from public.hr_records h where h.id::text = np.o_tid and h.kind = 'teacher') as was_teacher
      from np
  ), items as (
    -- the slot's teacher hears about it
    select k.teacher_id as tid, k.id, k.student_full, k.slot_date, k.start_time, k.end_time, k.note, k.handed_from, k.kind, k.o_date, k.o_from, k.o_to, k.was_teacher from k
    union all
    -- a teacher it was taken away from hears that too
    select k.o_tid::bigint, k.id, k.student_full, k.slot_date, k.start_time, k.end_time, k.note, k.handed_from, 'removed', k.o_date, k.o_from, k.o_to, k.teacher_name from k where k.kind = 'moved'
  )
  select coalesce(json_agg(t), '[]'::json) into tch from (
    select i.tid as teacher_id, max(h.data->>'full_name') as teacher_name, max(h.data->>'email') as email, max(h.data->>'user_id') as user_id,
           (select coalesce(json_agg(json_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth)), '[]'::json)
              from public.push_subscriptions p where p.user_id::text = max(h.data->>'user_id')) as subs,
           json_agg(json_build_object('id', i.id, 'student', i.student_full, 'date', i.slot_date, 'from', to_char(i.start_time, 'HH24:MI'), 'to', to_char(i.end_time, 'HH24:MI'),
                    'note', i.note, 'handed_from', i.handed_from, 'kind', i.kind, 'was_date', nullif(i.o_date, ''), 'was_from', nullif(i.o_from, ''), 'was_to', nullif(i.o_to, ''),
                    'other_teacher', i.was_teacher) order by i.slot_date, i.start_time) as slots
      from items i left join public.hr_records h on h.id = i.tid and h.kind = 'teacher'
     group by i.tid
  ) t;
  with np as (
    select s.*, st.full_name as student_full, st.email as student_email, st.disabled_at,
           split_part(s.notified_sig, '|', 1) as o_tid, split_part(s.notified_sig, '|', 2) as o_date, split_part(s.notified_sig, '|', 3) as o_from,
           split_part(s.notified_sig, '|', 4) as o_to, split_part(s.notified_sig, '|', 5) as o_status
      from public.schedules s join public.students st on st.id = s.student_id
     where s.id = any(coalesce(p_ids, '{}'))
       and s.notified_sig is distinct from public._sched_sig(s.teacher_id, s.slot_date, s.start_time, s.end_time, s.status)
       and not (s.notified_sig is null and s.status = 'cancelled')
  )
  select coalesce(json_agg(u), '[]'::json) into stu from (
    select np.student_id, max(np.student_full) as name, max(np.student_email) as email,
           json_agg(json_build_object('id', np.id, 'teacher', np.teacher_name, 'date', np.slot_date, 'from', to_char(np.start_time, 'HH24:MI'), 'to', to_char(np.end_time, 'HH24:MI'),
                    'note', np.note, 'handed_from', np.handed_from,
                    'kind', case when notified_sig is null then 'new' when status = 'cancelled' then 'cancelled' when o_status = 'cancelled' then 'restored' when o_tid <> teacher_id::text then 'moved' else 'changed' end,
                    'was_date', nullif(o_date, ''), 'was_from', nullif(o_from, ''), 'was_to', nullif(o_to, ''),
                    'was_teacher', (select h.data->>'full_name' from public.hr_records h where h.id::text = np.o_tid and h.kind = 'teacher')) order by np.slot_date, np.start_time) as slots
      from np where np.disabled_at is null
     group by np.student_id
  ) u;
  return json_build_object('teachers', tch, 'students', stu);
end $$;

create or replace function public.mark_schedule_notified(p_ids bigint[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_move_schedule() then raise exception 'Not allowed.'; end if;
  update public.schedules set notified_teacher_id = teacher_id, teacher_notified_at = now(),
         notified_sig = public._sched_sig(teacher_id, slot_date, start_time, end_time, status)
   where id = any(coalesce(p_ids, '{}'));
end $$;


-- ---------- Goal: Target page = Started at + Monthly goal, counted in the student's own direction.
-- Forward: 201 + 5 pages → page 206. Reverse (604 → 502, then 1 → 501): 590 + 5 → page 585, and 504 + 5 → page 3
-- (503, 502, then 1, 2, 3). Worked out on every save, whatever saves the month, so it can never drift.
create or replace function public._goal_target()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dir text;
begin
  select hifz_dir into v_dir from public.students where id = new.student_id;
  -- "Started at" is the page shown, so the count follows it
  if new.start_pos is not null and v_dir is not null then new.start_page := public._pos_count(new.start_pos, v_dir); end if;
  -- someone typed a target page (old style): turn it into a number of pages
  if new.goal_page is not null and new.start_page is not null and (
       (tg_op = 'INSERT' and coalesce(new.goal, 0) = 0)
    or (tg_op = 'UPDATE' and new.goal_page is distinct from old.goal_page and new.goal is not distinct from old.goal)) then
    new.goal := greatest(0, new.goal_page - new.start_page);
  end if;
  if coalesce(new.goal, 0) > 0 and new.start_page is not null then
    new.goal_page := least(604, new.start_page + new.goal);
    if v_dir is not null then
      new.goal_pos := public._count_pos(new.goal_page, v_dir);
      new.goal_surah := public._page_surah(new.goal_pos, v_dir);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists progress_goal_target on public.progress_months;
create trigger progress_goal_target before insert or update on public.progress_months for each row execute function public._goal_target();
-- bring every saved month in line once
update public.progress_months set goal = goal where coalesce(goal, 0) > 0 or goal_page is not null;


-- ---------- Forward sequence: page 604 → 582, then page 1 → 581 (one continuous sequence).
-- Reverse stays page 604 → 502, then page 1 → 501. Forward: page 604 = 1 page, 582 = 23 pages, page 1 = 24 pages … 581 = 604.
create or replace function public._turn(p_dir text)
returns int language sql immutable as $$ select case p_dir when 'forward' then 582 when 'backward' then 502 end $$;
create or replace function public._pos_count(p_pos int, p_dir text)
returns int language sql immutable as $$
  select case when p_pos is null or p_pos < 1 or p_pos > 604 then 0
              when public._turn(p_dir) is null then p_pos
              when p_pos >= public._turn(p_dir) then 605 - p_pos
              else (605 - public._turn(p_dir)) + p_pos end
$$;
create or replace function public._count_pos(p_count int, p_dir text)
returns int language sql immutable as $$
  select case when coalesce(p_count, 0) <= 0 then null
              when public._turn(p_dir) is null then least(604, p_count)
              when least(604, p_count) <= 605 - public._turn(p_dir) then 605 - least(604, p_count)
              else least(604, p_count) - (605 - public._turn(p_dir)) end
$$;
create or replace function public._page_surah(p_pos int, p_dir text)
returns int language plpgsql immutable as $$
declare a int[] := public._surah_starts(); n int := 1; i int;
begin
  if p_pos is null or p_pos < 1 or p_pos > 604 then return null; end if;
  -- on the part going back from page 604: the surah that begins on that page, if one does
  if public._turn(p_dir) is not null and p_pos >= public._turn(p_dir) then
    for i in 1 .. 114 loop if a[i] = p_pos then return i; end if; end loop;
  end if;
  for i in 1 .. 114 loop if a[i] <= p_pos then n := i; end if; end loop;
  return n;
end $$;

-- One time: forward students keep every page they are on and every page in their history;
-- only the counts (pages memorised) are worked out again along the new sequence. Each change is recorded.
alter table public.app_private add column if not exists fwd_v3 boolean not null default false;
do $$
declare st record; v_new int; v_delta int;
begin
  if coalesce((select fwd_v3 from public.app_private where id = 1), false) then return; end if;
  for st in select * from public.students where hifz_dir = 'forward' loop
    if st.cur_pos is not null then
      v_new := public._pos_count(st.cur_pos, 'forward'); v_delta := v_new - coalesce(st.pages, 0);
      if v_delta <> 0 then
        -- keys already given stay given: the key bookmarks move with the count, so no page earns keys twice
        update public.students set pages = v_new, cur_surah = public._page_surah(cur_pos, 'forward'),
               hifz_base = case when hifz_base is null then null else least(604, greatest(0, hifz_base + v_delta)) end,
               hifz_credited = case when hifz_credited is null then null else least(604, greatest(0, hifz_credited + v_delta)) end
         where id = st.id;
        insert into public.hifz_audit (student_id, month, what, old_value, new_value, note, changed_by_name)
        values (st.id, to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM'), 'Forward sequence (604 → 582, then 1 → 581)',
                coalesce(st.pages, 0) || ' pages at page ' || st.cur_pos, v_new || ' pages at page ' || st.cur_pos, 'Pages counted again along the new forward order', 'System');
      end if;
    end if;
  end loop;
  -- months: "Started at" and "Reached" pages stay; their counts, the target page and pages that month follow them
  update public.progress_months p
     set start_page = case when p.start_pos is not null then public._pos_count(p.start_pos, 'forward') else p.start_page end,
         pages_end  = case when p.end_pos   is not null then public._pos_count(p.end_pos,   'forward') else p.pages_end end,
         start_surah = case when p.start_pos is not null then public._page_surah(p.start_pos, 'forward') else p.start_surah end,
         end_surah   = case when p.end_pos   is not null then public._page_surah(p.end_pos,   'forward') else p.end_surah end,
         updated_at = now()
    from public.students s
   where s.id = p.student_id and s.hifz_dir = 'forward' and (p.start_pos is not null or p.end_pos is not null);
  -- this month's "Reached" is the page the student is on now
  update public.progress_months p set pages_end = s.pages, end_pos = s.cur_pos, end_surah = s.cur_surah
    from public.students s
   where s.id = p.student_id and s.hifz_dir = 'forward' and s.cur_pos is not null
     and p.month = to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM');
  -- pages memorised in a month = reached − started (never below 0)
  update public.progress_months p set jadeed = greatest(0, p.pages_end - p.start_page)
    from public.students s
   where s.id = p.student_id and s.hifz_dir = 'forward' and p.start_pos is not null and p.end_pos is not null;
  update public.app_private set fwd_v3 = true where id = 1;
end $$;


-- ---------- Welcome email: fee details from the student's record, and an optional one-time registration fee.
alter table public.settings add column if not exists registration_fee numeric(12,2) not null default 0 check (registration_fee >= 0);


-- =====================================================================
-- October 31: schedule for any date, recurring series, direct edit with history,
-- manual "Notify" buttons with a sent-history, and each teacher's own feedback.
-- =====================================================================
alter table public.schedules add column if not exists series_id uuid;
alter table public.schedules add column if not exists change_kind text;
do $$ begin
  alter table public.schedules add constraint schedules_change_kind_check check (change_kind in ('new', 'updated', 'rescheduled', 'reassigned'));
exception when duplicate_object then null; end $$;
create index if not exists schedules_series_idx on public.schedules (series_id, slot_date) where series_id is not null;
alter table public.settings add column if not exists schedule_admin_email text;

-- the guard again, now letting a whole series move together (its own lessons never clash with each other)
create or replace function public._schedule_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.hr_records; s public.students; clash record; moving text := current_setting('app.series_move', true);
begin
  select * into t from public.hr_records where id = new.teacher_id and kind = 'teacher';
  if not found then raise exception 'Choose a teacher from HR → Teachers.'; end if;
  select * into s from public.students where id = new.student_id;
  if not found then raise exception 'Student not found.'; end if;
  if new.end_time <= new.start_time then raise exception 'The end time must be after the start time.'; end if;
  new.teacher_name := t.data->>'full_name';
  new.teacher_user := nullif(t.data->>'user_id', '')::uuid;
  if new.status = 'scheduled' then
    select sc.*, st.full_name into clash from public.schedules sc join public.students st on st.id = sc.student_id
     where sc.status = 'scheduled' and sc.slot_date = new.slot_date and sc.id is distinct from new.id
       and sc.start_time < new.end_time and new.start_time < sc.end_time
       and (sc.teacher_id = new.teacher_id or sc.student_id = new.student_id)
       and not (coalesce(moving, '') <> '' and coalesce(sc.series_id::text, '') = moving)
     limit 1;
    if found then
      if clash.student_id = new.student_id then
        raise exception '% already has a slot from % to % on %.', s.full_name, to_char(clash.start_time, 'HH24:MI'), to_char(clash.end_time, 'HH24:MI'), to_char(new.slot_date, 'DD Mon');
      else
        raise exception '% already teaches % from % to % on %.', new.teacher_name, clash.full_name, to_char(clash.start_time, 'HH24:MI'), to_char(clash.end_time, 'HH24:MI'), to_char(new.slot_date, 'DD Mon');
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); new.created_at := now(); end if;
  if tg_op = 'INSERT' or (new.student_id, new.teacher_id, new.slot_date, new.start_time, new.end_time, new.status, coalesce(new.note, ''))
       is distinct from (old.student_id, old.teacher_id, old.slot_date, old.start_time, old.end_time, old.status, coalesce(old.note, '')) then
    new.updated_at := now(); new.student_seen_at := null; new.teacher_seen_at := null;
  end if;
  return new;
end $$;

-- what kind of change a lesson last had (for the email subject): new, updated, rescheduled or reassigned
create or replace function public._schedule_kind()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then new.change_kind := 'new';
  elsif new.teacher_id is distinct from old.teacher_id then new.change_kind := 'reassigned';
  elsif (new.slot_date, new.start_time, new.end_time) is distinct from (old.slot_date, old.start_time, old.end_time) then new.change_kind := 'rescheduled';
  elsif new.student_id is distinct from old.student_id or coalesce(new.note, '') is distinct from coalesce(old.note, '') then new.change_kind := 'updated';
  end if;
  return new;
end $$;
drop trigger if exists schedules_track on public.schedules;
create trigger schedules_track before insert or update on public.schedules for each row execute function public._schedule_kind();

-- every change is kept (edits, reschedules, cancellations, deletions)
create table if not exists public.schedule_history (
  id bigint generated always as identity primary key,
  schedule_id bigint not null,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create index if not exists schedule_history_idx on public.schedule_history (schedule_id, changed_at desc);
alter table public.schedule_history enable row level security;
drop policy if exists "schedule history: planners read" on public.schedule_history;
create policy "schedule history: planners read" on public.schedule_history for select to authenticated using (public.can_schedule() or public.is_viewer());
grant select on public.schedule_history to authenticated;
revoke all on public.schedule_history from anon;
create or replace function public._schedule_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare keep text[] := array['student_id', 'student_name', 'teacher_id', 'teacher_name', 'slot_date', 'start_time', 'end_time', 'note', 'status', 'series_id'];
        o jsonb; n jsonb; act text;
begin
  if tg_op = 'INSERT' then
    n := (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(keep) k);
    insert into public.schedule_history (schedule_id, action, new_data) values (new.id, 'created', n);
    return new;
  elsif tg_op = 'DELETE' then
    o := (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(keep) k);
    insert into public.schedule_history (schedule_id, action, old_data) values (old.id, 'deleted', o);
    return old;
  end if;
  o := (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(keep) k);
  n := (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(keep) k);
  if o = n then return new; end if;
  act := case when new.status = 'cancelled' and old.status <> 'cancelled' then 'cancelled'
              when new.status = 'scheduled' and old.status = 'cancelled' then 'restored'
              when new.teacher_id is distinct from old.teacher_id then 'reassigned'
              when (new.slot_date, new.start_time, new.end_time) is distinct from (old.slot_date, old.start_time, old.end_time) then 'rescheduled'
              else 'edited' end;
  insert into public.schedule_history (schedule_id, action, old_data, new_data) values (new.id, act, o, n);
  return new;
end $$;
drop trigger if exists schedules_log on public.schedules;
create trigger schedules_log after insert or update or delete on public.schedules for each row execute function public._schedule_log();

-- change one lesson and every later lesson of its series in one go (all or nothing: a clash stops it with the reason)
create or replace function public.update_schedule_series(p_id bigint, p_student uuid, p_teacher bigint, p_from time, p_to time, p_note text, p_shift int default 0)
returns bigint[] language plpgsql security definer set search_path = public as $$
declare r public.schedules; ids bigint[];
begin
  if not public.can_schedule() then raise exception 'Only the admin and teachers with schedule permission can change lessons.'; end if;
  select * into r from public.schedules where id = p_id;
  if not found then raise exception 'This lesson no longer exists.'; end if;
  if r.series_id is null then raise exception 'This lesson is not part of a repeating schedule.'; end if;
  if p_from is not null and p_to is not null and p_to <= p_from then raise exception 'The end time must be after the start time.'; end if;
  perform set_config('app.series_move', r.series_id::text, true);
  with u as (
    update public.schedules set
      student_id = coalesce(p_student, student_id), teacher_id = coalesce(p_teacher, teacher_id),
      start_time = coalesce(p_from, start_time), end_time = coalesce(p_to, end_time),
      note = case when p_note is null then note else nullif(trim(p_note), '') end,
      slot_date = slot_date + coalesce(p_shift, 0)
     where series_id = r.series_id and slot_date >= r.slot_date and (status = 'scheduled' or id = r.id)
    returning id)
  select array_agg(id) into ids from u;
  perform set_config('app.series_move', '', true);
  return coalesce(ids, '{}');
end $$;
revoke all on function public.update_schedule_series(bigint, uuid, bigint, time, time, text, int) from public, anon;
grant execute on function public.update_schedule_series(bigint, uuid, bigint, time, time, text, int) to authenticated;

-- manual notifications: who would get an email for a lesson (names and saved emails only; nothing is guessed)
create or replace function public.schedule_manual_payload(p_id bigint)
returns json language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if not public.can_schedule() then raise exception 'Only the admin and teachers with schedule permission can send schedule emails.'; end if;
  select s.*, st.full_name as student_full, nullif(trim(st.email), '') as student_email, st.disabled_at,
         nullif(trim(h.data->>'email'), '') as teacher_email, h.data->>'full_name' as teacher_full,
         (select nullif(trim(schedule_admin_email), '') from public.settings where id = 1) as admin_email
    into r from public.schedules s join public.students st on st.id = s.student_id left join public.hr_records h on h.id = s.teacher_id and h.kind = 'teacher'
   where s.id = p_id;
  if not found then raise exception 'This lesson no longer exists.'; end if;
  return json_build_object('id', r.id, 'date', r.slot_date, 'from', to_char(r.start_time, 'HH24:MI'), 'to', to_char(r.end_time, 'HH24:MI'), 'note', r.note,
    'status', r.status, 'kind', case when r.status = 'cancelled' then 'cancelled' when r.change_kind in ('reassigned', 'updated') then 'updated' else coalesce(r.change_kind, 'new') end,
    'student', json_build_object('name', r.student_full, 'email', r.student_email, 'disabled', r.disabled_at is not null),
    'teacher', json_build_object('name', coalesce(r.teacher_full, r.teacher_name), 'email', r.teacher_email),
    'admin', json_build_object('name', 'Administrator', 'email', r.admin_email));
end $$;
revoke all on function public.schedule_manual_payload(bigint) from public, anon;
grant execute on function public.schedule_manual_payload(bigint) to authenticated;

-- the sent-history: recipient, when, what kind and whether it was delivered
create table if not exists public.schedule_notifications (
  id bigint generated always as identity primary key,
  schedule_id bigint not null,
  recipient_type text not null check (recipient_type in ('student', 'teacher', 'admin')),
  recipient_name text,
  recipient_email text,
  kind text,
  status text not null check (status in ('sent', 'failed', 'missing')),
  error text,
  manual boolean not null default false,
  sent_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists schedule_notifications_idx on public.schedule_notifications (schedule_id, created_at desc);
alter table public.schedule_notifications enable row level security;
drop policy if exists "schedule notifications: planners read" on public.schedule_notifications;
create policy "schedule notifications: planners read" on public.schedule_notifications for select to authenticated using (public.can_schedule());
grant select on public.schedule_notifications to authenticated;
revoke all on public.schedule_notifications from anon;
create or replace function public.log_schedule_notification(p_schedule bigint, p_type text, p_name text, p_email text, p_kind text, p_status text, p_error text, p_manual boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_move_schedule() then raise exception 'Not allowed.'; end if;
  insert into public.schedule_notifications (schedule_id, recipient_type, recipient_name, recipient_email, kind, status, error, manual)
  values (p_schedule, p_type, left(p_name, 120), left(p_email, 200), p_kind, p_status, left(p_error, 300), coalesce(p_manual, false));
end $$;
revoke all on function public.log_schedule_notification(bigint, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.log_schedule_notification(bigint, text, text, text, text, text, text, boolean) to authenticated;

-- each teacher sees students' feedback about themselves only: averages and comments, never who wrote them, read only
create or replace function public.my_teacher_feedback(p_from text, p_to text)
returns table (month text, responses int, avg_scores jsonb, comments text[])
language plpgsql stable security definer set search_path = public as $$
declare me bigint := public.my_teacher_hr_id();
begin
  if me is null then return; end if;
  return query
    select f.month, count(*)::int,
      jsonb_build_object(
        'punctuality',   round(avg((f.scores->>'punctuality')::numeric), 2),
        'concentration', round(avg((f.scores->>'concentration')::numeric), 2),
        'listening',     round(avg((f.scores->>'listening')::numeric), 2),
        'teaching',      round(avg((f.scores->>'teaching')::numeric), 2),
        'coaching',      round(avg((f.scores->>'coaching')::numeric), 2),
        'attitude',      round(avg((f.scores->>'attitude')::numeric), 2),
        'ownership',     round(avg((f.scores->>'ownership')::numeric), 2)),
      array_remove(array_agg(f.comment order by random()), null)
    from public.teacher_feedback f
    where f.teacher_id = me and f.month between p_from and p_to
    group by f.month order by f.month;
end $$;
revoke all on function public.my_teacher_feedback(text, text) from public, anon;
grant execute on function public.my_teacher_feedback(text, text) to authenticated;


-- ============================================================================
-- November (1): praise badges, Admin/HR feedback for teachers, bulk schedule
-- changes, weekly timetable emails
-- ============================================================================

-- ---------- Praise badges: "Beautiful Tajweed" is now "Excellent Ahkaam & Makharij".
-- Badges already given are kept; only this one title changes.
update public.badges set title = 'Excellent Ahkaam & Makharij'
 where badge = 'tajweed' and title ~* '^\s*beautiful tajweed\s*:?\s*$';

-- ---------- A teacher reads the Admin/HR ratings about themselves (HR -> Teacher ratings), read only.
create or replace function public.my_admin_feedback()
returns table (id bigint, month text, scores jsonb, comment text, positives text, improve text, rated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare me bigint := public.my_teacher_hr_id();
begin
  if me is null then return; end if;
  return query
    select r.id, r.data->>'month',
      jsonb_strip_nulls(jsonb_build_object(
        'punctuality',   nullif(r.data->>'punctuality', '')::numeric,
        'concentration', nullif(r.data->>'concentration', '')::numeric,
        'listening',     nullif(r.data->>'listening', '')::numeric,
        'teaching',      nullif(r.data->>'teaching', '')::numeric,
        'coaching',      nullif(r.data->>'coaching', '')::numeric,
        'attitude',      nullif(r.data->>'attitude', '')::numeric,
        'ownership',     nullif(r.data->>'ownership', '')::numeric)),
      nullif(r.data->>'comment', ''), nullif(r.data->>'positives', ''), nullif(r.data->>'improve', ''),
      greatest(r.created_at, r.updated_at)
    from public.hr_records r
    where r.kind = 'teacher_rating' and r.data->>'teacher_id' = me::text
    order by r.data->>'month' desc, r.id desc;
end $$;
revoke all on function public.my_admin_feedback() from public, anon;
grant execute on function public.my_admin_feedback() to authenticated;

-- ---------- Bulk changes for one student's lessons.
-- The guard again: lessons changed together in one bulk edit never clash with each other while they move
-- (they are checked against each other once all of them have moved).
create or replace function public._schedule_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.hr_records; s public.students; clash record;
        moving text := current_setting('app.series_move', true);
        bulk bigint[] := ('{' || coalesce(current_setting('app.bulk_ids', true), '') || '}')::bigint[];
begin
  select * into t from public.hr_records where id = new.teacher_id and kind = 'teacher';
  if not found then raise exception 'Choose a teacher from HR → Teachers.'; end if;
  select * into s from public.students where id = new.student_id;
  if not found then raise exception 'Student not found.'; end if;
  if new.end_time <= new.start_time then raise exception 'The end time must be after the start time.'; end if;
  new.teacher_name := t.data->>'full_name';
  new.teacher_user := nullif(t.data->>'user_id', '')::uuid;
  if new.status = 'scheduled' then
    select sc.*, st.full_name into clash from public.schedules sc join public.students st on st.id = sc.student_id
     where sc.status = 'scheduled' and sc.slot_date = new.slot_date and sc.id is distinct from new.id
       and sc.start_time < new.end_time and new.start_time < sc.end_time
       and (sc.teacher_id = new.teacher_id or sc.student_id = new.student_id)
       and not (coalesce(moving, '') <> '' and coalesce(sc.series_id::text, '') = moving)
       and not (sc.id = any (bulk))
     limit 1;
    if found then
      if clash.student_id = new.student_id then
        raise exception '% already has a slot from % to % on %.', s.full_name, to_char(clash.start_time, 'HH24:MI'), to_char(clash.end_time, 'HH24:MI'), to_char(new.slot_date, 'DD Mon');
      else
        raise exception '% already teaches % from % to % on %.', new.teacher_name, clash.full_name, to_char(clash.start_time, 'HH24:MI'), to_char(clash.end_time, 'HH24:MI'), to_char(new.slot_date, 'DD Mon');
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); new.created_at := now(); end if;
  if tg_op = 'INSERT' or (new.student_id, new.teacher_id, new.slot_date, new.start_time, new.end_time, new.status, coalesce(new.note, ''))
       is distinct from (old.student_id, old.teacher_id, old.slot_date, old.start_time, old.end_time, old.status, coalesce(old.note, '')) then
    new.updated_at := now(); new.student_seen_at := null; new.teacher_seen_at := null;
  end if;
  return new;
end $$;

-- Bulk edit: the same change for many lessons of ONE student. Only the fields given change (null = keep).
-- p_len sets the length from the (new) start time; p_shift moves dates by that many days; p_note '' clears remarks.
-- All or nothing: if any lesson would clash, nothing changes and the reason is shown.
create or replace function public.bulk_update_schedules(p_student uuid, p_ids bigint[], p_teacher bigint default null, p_start time default null,
  p_len int default null, p_shift int default null, p_note text default null, p_status text default null)
returns bigint[] language plpgsql security definer set search_path = public as $$
declare ids bigint[]; c record;
begin
  if not public.can_schedule() then raise exception 'Only the admin and teachers with schedule permission can change lessons.'; end if;
  if p_len is not null and (p_len < 5 or p_len > 240) then raise exception 'Choose a lesson length between 5 and 240 minutes.'; end if;
  if p_status is not null and p_status not in ('scheduled', 'cancelled') then raise exception 'Unknown status.'; end if;
  if p_shift is not null and abs(p_shift) > 366 then raise exception 'Move dates by at most a year.'; end if;
  if p_note is not null and char_length(trim(p_note)) > 120 then raise exception 'Remarks can be at most 120 characters.'; end if;
  select array_agg(id order by slot_date, start_time) into ids from public.schedules where student_id = p_student and id = any (p_ids);
  if ids is null then return '{}'; end if;
  if p_start is not null or p_len is not null then
    if exists (select 1 from public.schedules where id = any (ids)
                and (coalesce(p_start, start_time) + make_interval(mins => coalesce(p_len, (extract(epoch from end_time - start_time) / 60)::int)))::time <= coalesce(p_start, start_time)) then
      raise exception 'A lesson would end after midnight. Choose an earlier time or a shorter length.';
    end if;
  end if;
  perform set_config('app.bulk_ids', array_to_string(ids, ','), true);
  update public.schedules set
    teacher_id = coalesce(p_teacher, teacher_id),
    end_time   = (coalesce(p_start, start_time) + make_interval(mins => coalesce(p_len, (extract(epoch from end_time - start_time) / 60)::int)))::time,
    start_time = coalesce(p_start, start_time),
    slot_date  = slot_date + coalesce(p_shift, 0),
    note       = case when p_note is null then note else nullif(trim(p_note), '') end,
    status     = coalesce(p_status, status)
   where id = any (ids);
  perform set_config('app.bulk_ids', '', true);
  -- now that every lesson has moved: none of them may overlap another one
  select a.slot_date, a.start_time, b.start_time as b_start into c from public.schedules a join public.schedules b
      on a.id < b.id and a.slot_date = b.slot_date and a.start_time < b.end_time and b.start_time < a.end_time
   where a.id = any (ids) and b.id = any (ids) and a.status = 'scheduled' and b.status = 'scheduled' limit 1;
  if found then raise exception 'Two of the chosen lessons would overlap on % (% and %). Nothing was changed.', to_char(c.slot_date, 'DD Mon'), to_char(c.start_time, 'HH24:MI'), to_char(c.b_start, 'HH24:MI'); end if;
  return ids;
end $$;
revoke all on function public.bulk_update_schedules(uuid, bigint[], bigint, time, int, int, text, text) from public, anon;
grant execute on function public.bulk_update_schedules(uuid, bigint[], bigint, time, int, int, text, text) to authenticated;

-- Delete many lessons of ONE student at once (other students are never touched). The history keeps each one.
create or replace function public.bulk_delete_schedules(p_student uuid, p_ids bigint[])
returns bigint[] language plpgsql security definer set search_path = public as $$
declare ids bigint[];
begin
  if not public.can_schedule() then raise exception 'Only the admin and teachers with schedule permission can delete lessons.'; end if;
  with d as (delete from public.schedules where student_id = p_student and id = any (p_ids) returning id)
  select array_agg(id) into ids from d;
  return coalesce(ids, '{}');
end $$;
revoke all on function public.bulk_delete_schedules(uuid, bigint[]) from public, anon;
grant execute on function public.bulk_delete_schedules(uuid, bigint[]) to authenticated;

-- who to tell after lessons were deleted (read from the history, so it works after the delete)
create or replace function public.schedule_removed_payload(p_ids bigint[])
returns json language plpgsql stable security definer set search_path = public as $$
declare v json;
begin
  if not public.can_schedule() then raise exception 'Only the admin and teachers with schedule permission can send schedule emails.'; end if;
  with h as (
    select distinct on (schedule_id) schedule_id, old_data o from public.schedule_history
     where action = 'deleted' and schedule_id = any (p_ids) and changed_at > now() - interval '6 hours'
     order by schedule_id, changed_at desc),
  one as (select o->>'student_id' as sid from h order by (o->>'slot_date') desc limit 1),
  l as (select * from h where o->>'status' = 'scheduled' and (o->>'slot_date')::date >= current_date and o->>'student_id' = (select sid from one))
  select json_build_object(
    'student', (select json_build_object('id', st.id, 'name', st.full_name, 'email', nullif(trim(st.email), '')) from public.students st where st.id::text = (select sid from one)),
    'lessons', coalesce((select json_agg(json_build_object('id', schedule_id, 'date', o->>'slot_date', 'from', left(o->>'start_time', 5), 'to', left(o->>'end_time', 5),
                 'teacher_id', (o->>'teacher_id')::bigint, 'teacher', o->>'teacher_name', 'student', o->>'student_name') order by o->>'slot_date', o->>'start_time') from l), '[]'),
    'teachers', coalesce((select json_agg(json_build_object('id', t.id, 'name', t.data->>'full_name', 'email', nullif(trim(t.data->>'email'), '')))
                 from public.hr_records t where t.kind = 'teacher' and t.id in (select (o->>'teacher_id')::bigint from l)), '[]')) into v;
  return v;
end $$;
revoke all on function public.schedule_removed_payload(bigint[]) from public, anon;
grant execute on function public.schedule_removed_payload(bigint[]) to authenticated;

-- ---------- Weekly timetable emails (student, teacher, admin), built from the saved lessons.
create table if not exists public.timetable_notifications (
  id bigint generated always as identity primary key,
  recipient_type text not null check (recipient_type in ('student', 'teacher', 'admin')),
  recipient_ref text,
  recipient_name text,
  recipient_email text,
  period_from date not null,
  period_to date not null,
  lessons int not null default 0,
  content_hash text,
  status text not null check (status in ('sent', 'failed', 'missing', 'skipped')),
  error text,
  sent_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists timetable_notifications_idx on public.timetable_notifications (recipient_type, recipient_ref, period_from, period_to, created_at desc);
create index if not exists timetable_notifications_time_idx on public.timetable_notifications (created_at desc);
alter table public.timetable_notifications enable row level security;
drop policy if exists "timetable notifications: planners read" on public.timetable_notifications;
create policy "timetable notifications: planners read" on public.timetable_notifications for select to authenticated using (public.can_schedule());
grant select on public.timetable_notifications to authenticated;
revoke all on public.timetable_notifications from anon;

-- the lessons in a timetable: cancelled lessons left out, in date and time order
create or replace function public._tt_rows(p_from date, p_to date, p_type text, p_ref text)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
      'date', s.slot_date, 'from', to_char(s.start_time, 'HH24:MI'), 'to', to_char(s.end_time, 'HH24:MI'),
      'mins', (extract(epoch from s.end_time - s.start_time) / 60)::int,
      'student', coalesce(st.full_name, s.student_name), 'teacher', s.teacher_name, 'note', s.note,
      'change', case when s.change_kind in ('rescheduled', 'updated', 'reassigned') then s.change_kind end)
    order by s.slot_date, s.start_time, coalesce(st.full_name, s.student_name), s.teacher_name), '[]'::json)
  from public.schedules s left join public.students st on st.id = s.student_id
  where s.status = 'scheduled' and s.slot_date between p_from and p_to
    and (p_type = 'admin' or (p_type = 'student' and s.student_id::text = p_ref) or (p_type = 'teacher' and s.teacher_id::text = p_ref))
$$;
revoke all on function public._tt_rows(date, date, text, text) from public, anon, authenticated;

create or replace function public.timetable_payload(p_from date, p_to date, p_type text, p_ref text)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_rows json; v_name text; v_email text; last record;
begin
  if not public.can_schedule() then raise exception 'Only the admin and teachers with schedule permission can send timetables.'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose the first and the last day.'; end if;
  if p_to - p_from > 62 then raise exception 'Choose at most 9 weeks at a time.'; end if;
  if p_type = 'student' then select full_name, nullif(trim(email), '') into v_name, v_email from public.students where id::text = p_ref;
  elsif p_type = 'teacher' then select data->>'full_name', nullif(trim(data->>'email'), '') into v_name, v_email from public.hr_records where kind = 'teacher' and id::text = p_ref;
  elsif p_type = 'admin' then v_name := 'Administrator'; select nullif(trim(schedule_admin_email), '') into v_email from public.settings where id = 1;
  else raise exception 'Unknown recipient.'; end if;
  if v_name is null then raise exception 'Recipient not found.'; end if;
  v_rows := public._tt_rows(p_from, p_to, p_type, p_ref);
  select created_at, content_hash into last from public.timetable_notifications
   where recipient_type = p_type and coalesce(recipient_ref, '') = coalesce(p_ref, '') and period_from = p_from and period_to = p_to and status = 'sent'
   order by created_at desc limit 1;
  return json_build_object('type', p_type, 'ref', p_ref, 'name', v_name, 'email', v_email, 'from', p_from, 'to', p_to,
    'institute', (select institute_name from public.settings where id = 1), 'rows', v_rows, 'hash', md5(v_rows::text),
    'last_sent_at', last.created_at, 'last_hash', last.content_hash);
end $$;
revoke all on function public.timetable_payload(date, date, text, text) from public, anon;
grant execute on function public.timetable_payload(date, date, text, text) to authenticated;

-- everyone with lessons in a period, with whether their timetable was sent and whether it changed since
create or replace function public.timetable_recipients(p_from date, p_to date)
returns json language plpgsql stable security definer set search_path = public as $$
declare v json;
begin
  if not public.can_schedule() then raise exception 'Only the admin and teachers with schedule permission can send timetables.'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose the first and the last day.'; end if;
  if p_to - p_from > 62 then raise exception 'Choose at most 9 weeks at a time.'; end if;
  with r as (
    select 'student'::text as type, s.student_id::text as ref, max(coalesce(st.full_name, s.student_name)) as name, max(nullif(trim(st.email), '')) as email, count(*)::int as lessons
      from public.schedules s left join public.students st on st.id = s.student_id
     where s.status = 'scheduled' and s.slot_date between p_from and p_to group by s.student_id
    union all
    select 'teacher', s.teacher_id::text, max(coalesce(h.data->>'full_name', s.teacher_name)), max(nullif(trim(h.data->>'email'), '')), count(*)::int
      from public.schedules s left join public.hr_records h on h.id = s.teacher_id and h.kind = 'teacher'
     where s.status = 'scheduled' and s.slot_date between p_from and p_to group by s.teacher_id
    union all
    select 'admin', '', 'Administrator', (select nullif(trim(schedule_admin_email), '') from public.settings where id = 1),
           (select count(*)::int from public.schedules where status = 'scheduled' and slot_date between p_from and p_to)),
  x as (
    select r.*, md5(public._tt_rows(p_from, p_to, r.type, r.ref)::text) as hash,
      (select json_build_object('at', n.created_at, 'hash', n.content_hash, 'status', n.status) from public.timetable_notifications n
        where n.recipient_type = r.type and coalesce(n.recipient_ref, '') = coalesce(r.ref, '') and n.period_from = p_from and n.period_to = p_to and n.status <> 'skipped'
        order by n.created_at desc limit 1) as last,
      (select n.content_hash from public.timetable_notifications n
        where n.recipient_type = r.type and coalesce(n.recipient_ref, '') = coalesce(r.ref, '') and n.period_from = p_from and n.period_to = p_to and n.status = 'sent'
        order by n.created_at desc limit 1) as sent_hash
    from r)
  select coalesce(json_agg(json_build_object('type', type, 'ref', ref, 'name', name, 'email', email, 'lessons', lessons, 'hash', hash, 'last', last, 'sent_hash', sent_hash)
           order by case type when 'admin' then 0 when 'teacher' then 1 else 2 end, name), '[]') into v from x;
  return v;
end $$;
revoke all on function public.timetable_recipients(date, date) from public, anon;
grant execute on function public.timetable_recipients(date, date) to authenticated;

create or replace function public.log_timetable_notification(p_type text, p_ref text, p_name text, p_email text, p_from date, p_to date, p_lessons int, p_hash text, p_status text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_schedule() then raise exception 'Not allowed.'; end if;
  insert into public.timetable_notifications (recipient_type, recipient_ref, recipient_name, recipient_email, period_from, period_to, lessons, content_hash, status, error)
  values (p_type, left(p_ref, 60), left(p_name, 120), left(p_email, 200), p_from, p_to, coalesce(p_lessons, 0), left(p_hash, 64), p_status, left(p_error, 300));
end $$;
revoke all on function public.log_timetable_notification(text, text, text, text, date, date, int, text, text, text) from public, anon;
grant execute on function public.log_timetable_notification(text, text, text, text, date, date, int, text, text, text) to authenticated;


-- ============================================================================
-- November (2): teachers cannot change a student's pages, and cannot change past months
-- (the admin still can). Teachers can still fill in this month and the coming months.
-- ============================================================================
create or replace function public._is_teacher_only()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role = 'teacher')
     and not exists (select 1 from public.admins where user_id = auth.uid() and role = 'admin')
$$;
revoke all on function public._is_teacher_only() from public, anon;
grant execute on function public._is_teacher_only() to authenticated;

create or replace function public.add_memorized_pages(p_student uuid, p_page int, p_from int default null, p_confirm boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare s public.students; v_k int; v_old int; v_new int; v_delta int; v_event bigint; v_goal boolean;
        cur text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM'); r public.progress_months; v_first boolean;
begin
  if not public.can_teach() then raise exception 'Only teachers can record memorised pages.'; end if;
  if public._is_teacher_only() then raise exception 'Only the admin can change a student''s pages.'; end if;
  if p_page is null or p_page < 1 or p_page > 604 then raise exception 'Enter a page number between 1 and 604.'; end if;
  select * into s from public.students where id = p_student for update;
  if not found then raise exception 'Student not found.'; end if;
  if s.hifz_dir is null then raise exception 'Set this student''s memorisation direction (forward or reverse) first.'; end if;
  if p_from is distinct from s.cur_pos then
    return json_build_object('status', 'changed', 'cur_pos', s.cur_pos, 'pages', s.pages,
      'message', 'This was already updated: the current page is now ' || coalesce(s.cur_pos::text, 'not set') || '. Nothing was counted twice.');
  end if;
  v_first := s.cur_pos is null;
  v_old := case when v_first then coalesce(s.pages, 0) else public._pos_count(s.cur_pos, s.hifz_dir) end;
  v_new := public._pos_count(p_page, s.hifz_dir);
  v_delta := v_new - v_old;
  if not v_first and v_delta = 0 then
    return json_build_object('status', 'same', 'cur_pos', s.cur_pos, 'pages', s.pages, 'message', 'No new pages: page ' || p_page || ' is already the current page.');
  end if;
  if not v_first and not coalesce(p_confirm, false) and (v_delta < 0 or v_delta > 40) then
    return json_build_object('status', 'confirm', 'delta', v_delta, 'cur_pos', s.cur_pos, 'pages', s.pages,
      'message', case when v_delta < 0 then 'Page ' || p_page || ' is behind the current page ' || s.cur_pos || ' for a ' || case when s.hifz_dir = 'backward' then 'reverse' else 'forward' end || ' student. Save it as a correction (' || abs(v_delta) || ' page' || case when abs(v_delta) = 1 then '' else 's' end || ' taken off)?'
                      else 'That is ' || v_delta || ' new pages since page ' || s.cur_pos || '. Is that right?' end);
  end if;
  perform public._ensure_month(p_student, cur);
  select keys_jadeed into v_k from public.settings where id = 1;
  if s.hifz_base is null then
    update public.students set hifz_base = v_old, hifz_credited = greatest(coalesce(hifz_credited, v_old), v_old) where id = p_student;
    select * into s from public.students where id = p_student;
  end if;
  if v_first then
    -- the first page entered is where the student starts: no pages or keys are counted for it
    perform public._hifz_set(p_student, v_new, null);
    update public.students set hifz_base = v_new, hifz_credited = v_new where id = p_student;
    update public.progress_months set start_page = v_new, start_pos = p_page, start_surah = public._page_surah(p_page, s.hifz_dir)
     where student_id = p_student and month = cur and coalesce(jadeed, 0) = 0;
    v_delta := 0;
  else
    perform public._hifz_set(p_student, v_new, null);
    if v_delta > 0 then
      -- keys only for pages beyond the furthest page already rewarded
      update public.students set keys = keys + v_k * greatest(0, v_new - greatest(v_old, coalesce(hifz_credited, v_old))),
             hifz_credited = greatest(coalesce(hifz_credited, v_old), v_new) where id = p_student;
    else
      -- a correction takes back the keys for the pages it removes (never below where the record started)
      update public.students set keys = greatest(0, keys - v_k * greatest(0, coalesce(hifz_credited, v_old) - greatest(v_new, coalesce(hifz_base, 0)))),
             hifz_credited = greatest(v_new, coalesce(hifz_base, 0)) where id = p_student;
    end if;
    update public.progress_months set jadeed = case when start_page is not null then greatest(0, pages_end - start_page) else greatest(0, jadeed + v_delta) end, updated_at = now()
     where student_id = p_student and month = cur;
    insert into public.key_events (student_id, kind, keys, pages, month, note)
    values (p_student, 'jadeed', (select keys from public.students where id = p_student) - s.keys, v_delta, cur,
            case when v_delta > 0 then 'Memorised to page ' || p_page || ' (+' || v_delta || ' page' || case when v_delta = 1 then '' else 's' end || ')'
                 else 'Correction: back to page ' || p_page || ' (' || v_delta || ' pages)' end)
    returning id into v_event;
  end if;
  v_goal := public._check_goal(p_student, cur);
  select * into r from public.progress_months where student_id = p_student and month = cur;
  select * into s from public.students where id = p_student;
  return json_build_object('status', case when v_first then 'started' when v_delta < 0 then 'corrected' else 'added' end,
    'event_id', v_event, 'new_pages', v_delta, 'cur_pos', s.cur_pos, 'pages', s.pages, 'keys', s.keys, 'goal_reached', v_goal,
    'month_done', greatest(0, coalesce(r.pages_end, 0) - coalesce(r.start_page, r.pages_end, 0)), 'month_goal', coalesce(r.goal, 0));
end $$;

create or replace function public.set_now_at(p_student uuid, p_surah int, p_pos int)
returns json language plpgsql security definer set search_path = public as $$
declare s public.students; v_dir text; v_surah int := p_surah; v_pos int := p_pos;
begin
  if not public.can_teach() then raise exception 'Only teachers can update hifz.'; end if;
  if public._is_teacher_only() then raise exception 'Only the admin can change a student''s pages.'; end if;
  if v_surah is not null and (v_surah < 1 or v_surah > 114) then raise exception 'Surah must be 1 to 114.'; end if;
  if v_pos is not null and (v_pos < 1 or v_pos > 604) then raise exception 'Page must be 1 to 604.'; end if;
  select * into s from public.students where id = p_student for update;
  if not found then raise exception 'Student not found.'; end if;
  if v_pos is null and v_surah is not null then v_pos := (public._surah_starts())[v_surah]; end if;
  perform public._ensure_month(p_student, to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM'));
  if v_pos is null then
    perform public._hifz_set(p_student, 0, null);
    return json_build_object('pages', 0, 'cur_pos', null, 'dir', coalesce(s.hifz_dir, 'forward'));
  end if;
  -- the direction is never guessed from one page: it must be set on the student first
  if s.hifz_dir is null then raise exception 'Set this student''s memorisation direction (forward or reverse) first.'; end if;
  v_dir := s.hifz_dir;
  perform public._hifz_set(p_student, public._pos_count(v_pos, v_dir), v_surah);
  -- the very first "Now at" for a student is where they start, not progress made this month
  if s.cur_pos is null and coalesce(s.pages, 0) = 0 then
    update public.progress_months set start_page = public._pos_count(v_pos, v_dir), start_pos = v_pos, start_surah = (select cur_surah from public.students where id = p_student)
     where student_id = p_student and month = to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM') and coalesce(jadeed, 0) = 0;
  end if;
  return json_build_object('pages', public._pos_count(v_pos, v_dir), 'cur_pos', v_pos, 'dir', v_dir);
end $$;

create or replace function public.set_hifz_dir(p_student uuid, p_dir text)
returns json language plpgsql security definer set search_path = public as $$
declare s public.students;
begin
  if not public.can_teach() then raise exception 'Only teachers can update hifz.'; end if;
  if public._is_teacher_only() then raise exception 'Only the admin can change a student''s pages.'; end if;
  if p_dir not in ('forward', 'backward') then raise exception 'Choose forward or backward.'; end if;
  select * into s from public.students where id = p_student for update;
  if not found then raise exception 'Student not found.'; end if;
  update public.students set hifz_dir = p_dir, hifz_dir_manual = true where id = p_student;
  if s.cur_pos is not null then perform public._hifz_set(p_student, public._pos_count(s.cur_pos, p_dir), s.cur_surah); end if;
  return json_build_object('dir', p_dir, 'pages', (select pages from public.students where id = p_student));
end $$;

create or replace function public.set_pages(p_student uuid, p_month text, p_pages int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_teach() then raise exception 'Only the institute can update pages.'; end if;
  if public._is_teacher_only() then raise exception 'Only the admin can change a student''s pages.'; end if;
  if coalesce(p_pages, -1) < 0 or p_pages > 604 then raise exception 'Pages must be between 0 and 604.'; end if;
  perform public._hifz_set(p_student, p_pages, null);
end $$;

create or replace function public.record_jadeed(p_student uuid, p_month text, p_pages int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare v_k int; v_pages int; v_event bigint; v_goal boolean; s public.students;
begin
  if not public.can_teach() then raise exception 'Only the institute can record progress.'; end if;
  if public._is_teacher_only() then raise exception 'Only the admin can change a student''s pages.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if coalesce(p_pages, 0) < 1 or p_pages > 100 then raise exception 'Pages must be between 1 and 100.'; end if;
  select keys_jadeed into v_k from public.settings where id = 1;
  select * into s from public.students where id = p_student for update;
  if not found then raise exception 'Student not found.'; end if;
  perform public._ensure_month(p_student, p_month);
  perform public._ensure_month(p_student, to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM'));
  perform public._hifz_set(p_student, least(604, s.pages + p_pages), null);
  update public.students set keys = keys + v_k * p_pages,
         hifz_credited = case when hifz_base is not null then greatest(coalesce(hifz_credited, 0), pages) end
   where id = p_student returning pages into v_pages;
  update public.progress_months set jadeed = jadeed + p_pages, pages_end = v_pages, updated_at = now()
   where student_id = p_student and month = p_month;
  insert into public.key_events (student_id, kind, keys, pages, month, note)
  values (p_student, 'jadeed', v_k * p_pages, p_pages, p_month,
          case when p_pages = 1 then 'Jadeed page cleared' else 'Jadeed: ' || p_pages || ' pages cleared' end)
  returning id into v_event;
  v_goal := public._check_goal(p_student, p_month);
  return json_build_object('event_id', v_event, 'goal_reached', v_goal,
    'pages', v_pages, 'keys', (select keys from public.students where id = p_student));
end $$;

create or replace function public.set_month_goal(p_student uuid, p_month text, p_goal int)
returns int language plpgsql security definer set search_path = public as $$
declare s record; n int := 0;
begin
  if not public.can_teach() then raise exception 'Only the institute can set goals.'; end if;
  if public._is_teacher_only() and p_month < to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM') then raise exception 'Past months are locked. Teachers can fill in this month and the coming months.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if coalesce(p_goal, -1) < 0 or p_goal > 604 then raise exception 'Goal must be between 0 and 604 pages.'; end if;
  for s in select st.id, st.hifz_dir as dir from public.students st where (p_student is null and st.disabled_at is null and public.teaches(st.id)) or st.id = p_student loop
    perform public._ensure_month(s.id, p_month);
    update public.progress_months set goal = p_goal,
           goal_page = case when p_goal > 0 and start_page is not null then least(604, start_page + p_goal) end,
           goal_pos = case when p_goal > 0 and start_page is not null and s.dir is not null then public._count_pos(least(604, start_page + p_goal), s.dir) end,
           goal_surah = case when p_goal > 0 and start_page is not null and s.dir is not null then public._page_surah(public._count_pos(least(604, start_page + p_goal), s.dir), s.dir) end,
           updated_at = now()
     where student_id = s.id and month = p_month;
    perform public._check_goal(s.id, p_month);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.save_month_report(
  p_student uuid, p_month text, p_start_page int, p_goal_page int, p_end_page int,
  p_ajza text, p_ahkaam text, p_murajaat int, p_dawrat int, p_note text,
  p_start_surah int default null, p_start_pos int default null, p_goal_surah int default null, p_goal_pos int default null,
  p_end_surah int default null, p_end_pos int default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_goal boolean; cur text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM'); v_dir text;
begin
  if not public.can_teach() then raise exception 'Only the institute can save reports.'; end if;
  if public._is_teacher_only() and p_month < to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM') then raise exception 'Past months are locked. Teachers can fill in this month and the coming months.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if (p_start_page is not null and (p_start_page < 0 or p_start_page > 604)) or (p_goal_page is not null and (p_goal_page < 0 or p_goal_page > 604))
     or (p_end_page is not null and (p_end_page < 0 or p_end_page > 604)) then raise exception 'Pages memorised must be between 0 and 604.'; end if;
  if p_goal_page is not null and p_start_page is not null and p_goal_page <= p_start_page then raise exception 'Pages to memorise must be more than 0.'; end if;
  select hifz_dir into v_dir from public.students where id = p_student;
  if not found then raise exception 'Student not found.'; end if;
  perform public._ensure_month(p_student, p_month);
  update public.progress_months set
    start_page = coalesce(p_start_page, start_page), goal_page = p_goal_page, pages_end = coalesce(p_end_page, pages_end),
    goal = case when p_goal_page is not null and coalesce(p_start_page, start_page) is not null then p_goal_page - coalesce(p_start_page, start_page) else 0 end,
    start_surah = coalesce(p_start_surah, start_surah), start_pos = coalesce(p_start_pos, start_pos),
    goal_surah = p_goal_surah, goal_pos = p_goal_pos,
    end_surah = coalesce(p_end_surah, end_surah), end_pos = coalesce(p_end_pos, end_pos),
    ajza_improve = nullif(trim(coalesce(p_ajza, '')), ''), ahkaam = nullif(trim(coalesce(p_ahkaam, '')), ''),
    murajaat = coalesce(p_murajaat, murajaat), dawrat = p_dawrat, report_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
  where student_id = p_student and month = p_month;
  if p_month >= cur then
    if p_end_pos is not null then perform public._hifz_set(p_student, public._pos_count(p_end_pos, v_dir), p_end_surah);
    elsif p_end_page is not null then perform public._hifz_set(p_student, p_end_page, null); end if;
  end if;
  v_goal := public._check_goal(p_student, p_month);
  return json_build_object('goal_reached', v_goal, 'keys', (select keys from public.students where id = p_student));
end $$;


-- ============================================================================
-- November (3): student attendance (teachers take it, the admin sees it live) + security checks
-- ============================================================================
create table if not exists public.student_attendance (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  att_date date not null,
  status text not null check (status in ('present', 'late', 'absent', 'excused')),
  minutes_late int check (minutes_late is null or minutes_late between 0 and 600),
  note text check (note is null or char_length(note) <= 200),
  marked_by uuid default auth.uid(),
  marked_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, att_date)
);
create index if not exists student_attendance_date_idx on public.student_attendance (att_date);
alter table public.student_attendance enable row level security;
drop policy if exists "attendance: read" on public.student_attendance;
-- the admin sees everyone; a teacher sees only their own students; a student sees only their own days
create policy "attendance: read" on public.student_attendance for select to authenticated
  using (public.is_admin() or (public.can_teach() and public.teaches(student_id)) or student_id = auth.uid());
revoke all on public.student_attendance from anon, public;
grant select on public.student_attendance to authenticated;   -- changes only through mark_attendance()

-- every change is kept (who, when, from what to what); only the admin can read it
create table if not exists public.student_attendance_log (
  id bigint generated always as identity primary key,
  student_id uuid not null,
  att_date date not null,
  old_status text,
  new_status text,
  changed_by uuid default auth.uid(),
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists student_attendance_log_idx on public.student_attendance_log (att_date, student_id);
alter table public.student_attendance_log enable row level security;
drop policy if exists "attendance log: admin reads" on public.student_attendance_log;
create policy "attendance log: admin reads" on public.student_attendance_log for select to authenticated using (public.is_admin());
revoke all on public.student_attendance_log from anon, public;
grant select on public.student_attendance_log to authenticated;

-- p_rows: [{student_id, status ('present'|'late'|'absent'|'excused'|'' to clear), minutes_late, note}]
-- Teachers: their own students, today and the 7 days before. Admin: anyone, any past day. Never a future day.
create or replace function public.mark_attendance(p_date date, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; v_sid uuid; v_st text; v_old text; v_min int; v_note text; v_name text;
        v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date; v_admin boolean := public.is_admin();
begin
  if not public.can_teach() then raise exception 'Only teachers and the admin can take attendance.'; end if;
  if p_date is null then raise exception 'Choose the day.'; end if;
  if p_date > v_today then raise exception 'Attendance cannot be taken for a day that has not come yet.'; end if;
  if not v_admin and p_date < v_today - 7 then raise exception 'Teachers can take or change attendance for the last 7 days only. Ask the admin for older days.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Nothing to save.'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'Save at most 500 students at a time.'; end if;
  v_name := coalesce((select data->>'full_name' from public.hr_records where kind = 'teacher' and data->>'user_id' = auth.uid()::text limit 1),
                     (select case when role = 'admin' then 'Admin' else username end from public.admins where user_id = auth.uid() limit 1), 'Staff');
  for r in select value from jsonb_array_elements(p_rows) loop
    begin v_sid := (r->>'student_id')::uuid; exception when others then raise exception 'A student was not recognised.'; end;
    if not exists (select 1 from public.students where id = v_sid) then raise exception 'Student not found.'; end if;
    if not public.teaches(v_sid) then raise exception 'This student is not one of yours. Ask the admin to add you as their teacher.'; end if;
    v_st := nullif(trim(coalesce(r->>'status', '')), '');
    if v_st is not null and v_st not in ('present', 'late', 'absent', 'excused') then raise exception 'Unknown attendance mark.'; end if;
    v_min := case when v_st = 'late' and coalesce(r->>'minutes_late', '') ~ '^\d{1,3}$' then least(600, (r->>'minutes_late')::int) end;
    v_note := nullif(left(trim(regexp_replace(coalesce(r->>'note', ''), '[[:cntrl:]]', ' ', 'g')), 200), '');
    select status into v_old from public.student_attendance where student_id = v_sid and att_date = p_date;
    if v_st is null then
      delete from public.student_attendance where student_id = v_sid and att_date = p_date;
    else
      insert into public.student_attendance (student_id, att_date, status, minutes_late, note, marked_by, marked_by_name)
      values (v_sid, p_date, v_st, v_min, v_note, auth.uid(), v_name)
      on conflict (student_id, att_date) do update set status = excluded.status, minutes_late = excluded.minutes_late, note = excluded.note,
        marked_by = excluded.marked_by, marked_by_name = excluded.marked_by_name, updated_at = now();
    end if;
    if v_old is distinct from v_st then
      insert into public.student_attendance_log (student_id, att_date, old_status, new_status, changed_by_name) values (v_sid, p_date, v_old, v_st, v_name);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.mark_attendance(date, jsonb) from public, anon;
grant execute on function public.mark_attendance(date, jsonb) to authenticated;

-- live updates for the admin (only if Supabase Realtime is there; it still respects who may read what)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'student_attendance') then
    execute 'alter publication supabase_realtime add table public.student_attendance';
  end if;
end $$;

-- ---------- security: no table in the public schema may be open without row level security,
-- and nobody signed out (anon) may run any function or touch any table directly.
do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;


-- ============================================================================
-- November (4): teachers can add pages again (+1 Jadeed, Add pages, Current page no.) for their own students.
-- Still admin only: the memorisation direction and correcting the total. Past months stay locked for teachers.
-- ============================================================================

create or replace function public.add_memorized_pages(p_student uuid, p_page int, p_from int default null, p_confirm boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare s public.students; v_k int; v_old int; v_new int; v_delta int; v_event bigint; v_goal boolean;
        cur text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM'); r public.progress_months; v_first boolean;
begin
  if not public.can_teach() then raise exception 'Only teachers can record memorised pages.'; end if;
  if p_page is null or p_page < 1 or p_page > 604 then raise exception 'Enter a page number between 1 and 604.'; end if;
  select * into s from public.students where id = p_student for update;
  if not found then raise exception 'Student not found.'; end if;
  if s.hifz_dir is null then raise exception 'Set this student''s memorisation direction (forward or reverse) first.'; end if;
  if p_from is distinct from s.cur_pos then
    return json_build_object('status', 'changed', 'cur_pos', s.cur_pos, 'pages', s.pages,
      'message', 'This was already updated: the current page is now ' || coalesce(s.cur_pos::text, 'not set') || '. Nothing was counted twice.');
  end if;
  v_first := s.cur_pos is null;
  v_old := case when v_first then coalesce(s.pages, 0) else public._pos_count(s.cur_pos, s.hifz_dir) end;
  v_new := public._pos_count(p_page, s.hifz_dir);
  v_delta := v_new - v_old;
  if not v_first and v_delta = 0 then
    return json_build_object('status', 'same', 'cur_pos', s.cur_pos, 'pages', s.pages, 'message', 'No new pages: page ' || p_page || ' is already the current page.');
  end if;
  if not v_first and not coalesce(p_confirm, false) and (v_delta < 0 or v_delta > 40) then
    return json_build_object('status', 'confirm', 'delta', v_delta, 'cur_pos', s.cur_pos, 'pages', s.pages,
      'message', case when v_delta < 0 then 'Page ' || p_page || ' is behind the current page ' || s.cur_pos || ' for a ' || case when s.hifz_dir = 'backward' then 'reverse' else 'forward' end || ' student. Save it as a correction (' || abs(v_delta) || ' page' || case when abs(v_delta) = 1 then '' else 's' end || ' taken off)?'
                      else 'That is ' || v_delta || ' new pages since page ' || s.cur_pos || '. Is that right?' end);
  end if;
  perform public._ensure_month(p_student, cur);
  select keys_jadeed into v_k from public.settings where id = 1;
  if s.hifz_base is null then
    update public.students set hifz_base = v_old, hifz_credited = greatest(coalesce(hifz_credited, v_old), v_old) where id = p_student;
    select * into s from public.students where id = p_student;
  end if;
  if v_first then
    -- the first page entered is where the student starts: no pages or keys are counted for it
    perform public._hifz_set(p_student, v_new, null);
    update public.students set hifz_base = v_new, hifz_credited = v_new where id = p_student;
    update public.progress_months set start_page = v_new, start_pos = p_page, start_surah = public._page_surah(p_page, s.hifz_dir)
     where student_id = p_student and month = cur and coalesce(jadeed, 0) = 0;
    v_delta := 0;
  else
    perform public._hifz_set(p_student, v_new, null);
    if v_delta > 0 then
      -- keys only for pages beyond the furthest page already rewarded
      update public.students set keys = keys + v_k * greatest(0, v_new - greatest(v_old, coalesce(hifz_credited, v_old))),
             hifz_credited = greatest(coalesce(hifz_credited, v_old), v_new) where id = p_student;
    else
      -- a correction takes back the keys for the pages it removes (never below where the record started)
      update public.students set keys = greatest(0, keys - v_k * greatest(0, coalesce(hifz_credited, v_old) - greatest(v_new, coalesce(hifz_base, 0)))),
             hifz_credited = greatest(v_new, coalesce(hifz_base, 0)) where id = p_student;
    end if;
    update public.progress_months set jadeed = case when start_page is not null then greatest(0, pages_end - start_page) else greatest(0, jadeed + v_delta) end, updated_at = now()
     where student_id = p_student and month = cur;
    insert into public.key_events (student_id, kind, keys, pages, month, note)
    values (p_student, 'jadeed', (select keys from public.students where id = p_student) - s.keys, v_delta, cur,
            case when v_delta > 0 then 'Memorised to page ' || p_page || ' (+' || v_delta || ' page' || case when v_delta = 1 then '' else 's' end || ')'
                 else 'Correction: back to page ' || p_page || ' (' || v_delta || ' pages)' end)
    returning id into v_event;
  end if;
  v_goal := public._check_goal(p_student, cur);
  select * into r from public.progress_months where student_id = p_student and month = cur;
  select * into s from public.students where id = p_student;
  return json_build_object('status', case when v_first then 'started' when v_delta < 0 then 'corrected' else 'added' end,
    'event_id', v_event, 'new_pages', v_delta, 'cur_pos', s.cur_pos, 'pages', s.pages, 'keys', s.keys, 'goal_reached', v_goal,
    'month_done', greatest(0, coalesce(r.pages_end, 0) - coalesce(r.start_page, r.pages_end, 0)), 'month_goal', coalesce(r.goal, 0));
end $$;

create or replace function public.set_now_at(p_student uuid, p_surah int, p_pos int)
returns json language plpgsql security definer set search_path = public as $$
declare s public.students; v_dir text; v_surah int := p_surah; v_pos int := p_pos;
begin
  if not public.can_teach() then raise exception 'Only teachers can update hifz.'; end if;
  if v_surah is not null and (v_surah < 1 or v_surah > 114) then raise exception 'Surah must be 1 to 114.'; end if;
  if v_pos is not null and (v_pos < 1 or v_pos > 604) then raise exception 'Page must be 1 to 604.'; end if;
  select * into s from public.students where id = p_student for update;
  if not found then raise exception 'Student not found.'; end if;
  if v_pos is null and v_surah is not null then v_pos := (public._surah_starts())[v_surah]; end if;
  perform public._ensure_month(p_student, to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM'));
  if v_pos is null then
    perform public._hifz_set(p_student, 0, null);
    return json_build_object('pages', 0, 'cur_pos', null, 'dir', coalesce(s.hifz_dir, 'forward'));
  end if;
  -- the direction is never guessed from one page: it must be set on the student first
  if s.hifz_dir is null then raise exception 'Set this student''s memorisation direction (forward or reverse) first.'; end if;
  v_dir := s.hifz_dir;
  perform public._hifz_set(p_student, public._pos_count(v_pos, v_dir), v_surah);
  -- the very first "Now at" for a student is where they start, not progress made this month
  if s.cur_pos is null and coalesce(s.pages, 0) = 0 then
    update public.progress_months set start_page = public._pos_count(v_pos, v_dir), start_pos = v_pos, start_surah = (select cur_surah from public.students where id = p_student)
     where student_id = p_student and month = to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM') and coalesce(jadeed, 0) = 0;
  end if;
  return json_build_object('pages', public._pos_count(v_pos, v_dir), 'cur_pos', v_pos, 'dir', v_dir);
end $$;

create or replace function public.record_jadeed(p_student uuid, p_month text, p_pages int default 1)
returns json language plpgsql security definer set search_path = public as $$
declare v_k int; v_pages int; v_event bigint; v_goal boolean; s public.students;
begin
  if not public.can_teach() then raise exception 'Only the institute can record progress.'; end if;
  if public._is_teacher_only() and p_month < to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM') then raise exception 'Past months are locked. Teachers can fill in this month and the coming months.'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Month is not valid.'; end if;
  if coalesce(p_pages, 0) < 1 or p_pages > 100 then raise exception 'Pages must be between 1 and 100.'; end if;
  select keys_jadeed into v_k from public.settings where id = 1;
  select * into s from public.students where id = p_student for update;
  if not found then raise exception 'Student not found.'; end if;
  perform public._ensure_month(p_student, p_month);
  perform public._ensure_month(p_student, to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM'));
  perform public._hifz_set(p_student, least(604, s.pages + p_pages), null);
  update public.students set keys = keys + v_k * p_pages,
         hifz_credited = case when hifz_base is not null then greatest(coalesce(hifz_credited, 0), pages) end
   where id = p_student returning pages into v_pages;
  update public.progress_months set jadeed = jadeed + p_pages, pages_end = v_pages, updated_at = now()
   where student_id = p_student and month = p_month;
  insert into public.key_events (student_id, kind, keys, pages, month, note)
  values (p_student, 'jadeed', v_k * p_pages, p_pages, p_month,
          case when p_pages = 1 then 'Jadeed page cleared' else 'Jadeed: ' || p_pages || ' pages cleared' end)
  returning id into v_event;
  v_goal := public._check_goal(p_student, p_month);
  return json_build_object('event_id', v_event, 'goal_reached', v_goal,
    'pages', v_pages, 'keys', (select keys from public.students where id = p_student));
end $$;

-- ===== nov16d: admin-only notices and files =====
-- Nov 16d: only the admin can write notices or upload files (Student Hub).
-- Teachers (and every signed-in user) can still read notices and open files.
-- Safe to run more than once.
alter table public.notices enable row level security;
drop policy if exists "notices: signed-in read"  on public.notices;
drop policy if exists "notices: institute all"   on public.notices;
drop policy if exists "notices: admin write"     on public.notices;
create policy "notices: signed-in read" on public.notices for select to authenticated using (true);
create policy "notices: admin write"    on public.notices for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "notice files: institute upload" on storage.objects;
drop policy if exists "notice files: institute update" on storage.objects;
drop policy if exists "notice files: institute delete" on storage.objects;
drop policy if exists "notice files: admin upload"     on storage.objects;
drop policy if exists "notice files: admin update"     on storage.objects;
drop policy if exists "notice files: admin delete"     on storage.objects;
create policy "notice files: admin upload" on storage.objects for insert to authenticated with check (bucket_id = 'notices' and public.is_admin());
create policy "notice files: admin update" on storage.objects for update to authenticated using (bucket_id = 'notices' and public.is_admin()) with check (bucket_id = 'notices' and public.is_admin());
create policy "notice files: admin delete" on storage.objects for delete to authenticated using (bucket_id = 'notices' and public.is_admin());
