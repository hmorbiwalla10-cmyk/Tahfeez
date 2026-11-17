-- =====================================================================
--  Mahad al-Zahra — fees portal database
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run again: it only creates what is missing.
-- =====================================================================

-- Students sign in with a username. Behind the scenes Supabase needs an
-- e-mail address, so each username becomes  username@mahadalzahra.app
-- (no e-mail is ever sent). Keep this the same as LOGIN_DOMAIN in js/config.js.
create or replace function public.login_domain()
returns text language sql immutable set search_path = '' as $$ select 'mahadalzahra.app'::text $$;

-- ---------------------------------------------------------------- tables
create table if not exists public.settings (
  id               int primary key default 1 check (id = 1),
  institute_name   text not null default 'Mahad al-Zahra',
  currency         text not null default 'TSh',
  default_password text not null default 'zahra2026',
  due_day          int  not null default 5 check (due_day between 1 and 28)
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  username   text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique,
  full_name   text not null,
  phone       text,
  monthly_fee numeric(12,2) not null default 0,
  start_month text not null default to_char(now(), 'YYYY-MM') check (start_month ~ '^\d{4}-\d{2}$'),
  juz         int not null default 0 check (juz between 0 and 30),
  created_at  timestamptz not null default now()
);

create sequence if not exists public.receipt_seq start 1;

create table if not exists public.payments (
  id          bigint generated always as identity primary key,
  receipt_no  text not null unique
              default ('MZ-' || to_char(now(), 'YY') || '-' || lpad(nextval('public.receipt_seq')::text, 5, '0')),
  student_id  uuid not null references public.students (id) on delete cascade,
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  amount      numeric(12,2) not null check (amount >= 0),
  method      text not null default 'Cash',
  paid_on     date not null default current_date,
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  seen_at     timestamptz,
  unique (student_id, month)
);
create index if not exists payments_month_idx on public.payments (month);

-- ---------------------------------------------------------------- helpers
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

-- Creates a login (auth user) directly. Used by the two functions below.
create or replace function public._create_login(p_username text, p_password text)
returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_id    uuid := gen_random_uuid();
  v_user  text := lower(trim(p_username));
  v_email text;
begin
  if v_user !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then
    raise exception 'Username "%" is not valid. Use 3 to 30 letters, numbers, dots, dashes or underscores.', p_username;
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;
  v_email := v_user || '@' || public.login_domain();
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'The username "%" is already taken.', v_user;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('username', v_user), now(), now(),
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  return v_id;
end $$;

-- ------------------------------------------------- institute-only actions
create or replace function public.create_student(
  p_username text, p_password text, p_full_name text,
  p_phone text default null, p_monthly_fee numeric default 0,
  p_start_month text default to_char(now(), 'YYYY-MM'), p_juz int default 0
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Only the institute can add students.'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Student name is required.'; end if;
  v_id := public._create_login(p_username, p_password);
  insert into public.students (id, username, full_name, phone, monthly_fee, start_month, juz)
  values (v_id, lower(trim(p_username)), trim(p_full_name), nullif(trim(p_phone), ''),
          coalesce(p_monthly_fee, 0), coalesce(nullif(p_start_month, ''), to_char(now(), 'YYYY-MM')),
          greatest(0, least(30, coalesce(p_juz, 0))));
  return v_id;
end $$;

create or replace function public.reset_student_password(p_student uuid, p_password text)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.is_admin() then raise exception 'Only the institute can reset passwords.'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters.'; end if;
  if not exists (select 1 from public.students where id = p_student) then raise exception 'Student not found.'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_student;
end $$;

create or replace function public.delete_student(p_student uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Only the institute can remove students.'; end if;
  if not exists (select 1 from public.students where id = p_student) then raise exception 'Student not found.'; end if;
  delete from auth.users where id = p_student;   -- removes the student row and receipts too
end $$;

-- ---------------------------------------------------- student-only action
create or replace function public.mark_receipt_seen(p_payment bigint)
returns void language sql security definer set search_path = public as $$
  update public.payments set seen_at = now()
   where id = p_payment and student_id = auth.uid() and seen_at is null
$$;

-- ------------------------------------- creating the institute account
-- Run ONCE from the SQL editor (it cannot be called from the website):
--   select public.create_institute_admin('admin', 'choose-a-strong-password');
create or replace function public.create_institute_admin(p_username text, p_password text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := public._create_login(p_username, p_password);
  insert into public.admins (user_id, username) values (v_id, lower(trim(p_username)));
  return v_id;
end $$;

revoke all on function public._create_login(text, text) from public, anon, authenticated;
revoke all on function public.create_institute_admin(text, text) from public, anon, authenticated;
revoke all on function public.create_student(text, text, text, text, numeric, text, int) from public, anon;
revoke all on function public.reset_student_password(uuid, text) from public, anon;
revoke all on function public.delete_student(uuid) from public, anon;
revoke all on function public.mark_receipt_seen(bigint) from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.create_student(text, text, text, text, numeric, text, int) to authenticated;
grant execute on function public.reset_student_password(uuid, text) to authenticated;
grant execute on function public.delete_student(uuid) to authenticated;
grant execute on function public.mark_receipt_seen(bigint) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ------------------------------------------------- row-level security
-- Students can only ever read their OWN row and their OWN receipts.
-- Everything else is institute-only, enforced by the database itself.
alter table public.settings enable row level security;
alter table public.admins   enable row level security;
alter table public.students enable row level security;
alter table public.payments enable row level security;

drop policy if exists "settings: signed-in read"   on public.settings;
drop policy if exists "settings: institute update" on public.settings;
create policy "settings: signed-in read"   on public.settings for select to authenticated using (true);
create policy "settings: institute update" on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins: read own" on public.admins;
create policy "admins: read own" on public.admins for select to authenticated using (user_id = auth.uid());

drop policy if exists "students: institute all" on public.students;
drop policy if exists "students: read own"      on public.students;
create policy "students: institute all" on public.students for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "students: read own"      on public.students for select to authenticated using (id = auth.uid());

drop policy if exists "payments: institute all" on public.payments;
drop policy if exists "payments: read own"      on public.payments;
create policy "payments: institute all" on public.payments for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "payments: read own"      on public.payments for select to authenticated using (student_id = auth.uid());

grant select, update on public.settings to authenticated;
grant select on public.admins to authenticated;
grant select, insert, update, delete on public.students to authenticated;
grant select, insert, update, delete on public.payments to authenticated;
grant usage on sequence public.receipt_seq to authenticated;

-- ------------------------------------------- institute (staff) accounts
-- First-time setup: the website can create the FIRST institute account
-- only while none exists. After that, only a signed-in institute account
-- can add more staff.
create or replace function public.institute_setup_needed()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.admins)
$$;

create or replace function public.setup_first_admin(p_username text, p_password text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('mz_first_admin'));
  if exists (select 1 from public.admins) then
    raise exception 'The institute account already exists. Please sign in.';
  end if;
  v_id := public._create_login(p_username, p_password);
  insert into public.admins (user_id, username) values (v_id, lower(trim(p_username)));
  return v_id;
end $$;

create or replace function public.add_staff(p_username text, p_password text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Only the institute can add staff accounts.'; end if;
  v_id := public._create_login(p_username, p_password);
  insert into public.admins (user_id, username) values (v_id, lower(trim(p_username)));
  return v_id;
end $$;

create or replace function public.remove_staff(p_user uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Only the institute can remove staff accounts.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot remove your own account while signed in.'; end if;
  if not exists (select 1 from public.admins where user_id = p_user) then raise exception 'Staff account not found.'; end if;
  delete from auth.users where id = p_user;
end $$;

create or replace function public.reset_staff_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.is_admin() then raise exception 'Only the institute can reset passwords.'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters.'; end if;
  if not exists (select 1 from public.admins where user_id = p_user) then raise exception 'Staff account not found.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = p_user;
end $$;

revoke all on function public.institute_setup_needed() from public;
revoke all on function public.setup_first_admin(text, text) from public;
revoke all on function public.add_staff(text, text) from public, anon;
revoke all on function public.remove_staff(uuid) from public, anon;
revoke all on function public.reset_staff_password(uuid, text) from public, anon;
grant execute on function public.institute_setup_needed() to anon, authenticated;
grant execute on function public.setup_first_admin(text, text) to anon, authenticated;
grant execute on function public.add_staff(text, text) to authenticated;
grant execute on function public.remove_staff(uuid) to authenticated;
grant execute on function public.reset_staff_password(uuid, text) to authenticated;

drop policy if exists "admins: institute read all" on public.admins;
create policy "admins: institute read all" on public.admins for select to authenticated using (public.is_admin());

-- Live updates: a receipt pops up on the student's phone the moment it is recorded.
do $$ begin
  alter publication supabase_realtime add table public.payments;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- =====================================================================
--  LAST STEP — open the website, tap Institute → "Create institute account".
--  (Or from here: select public.create_institute_admin('admin', 'choose-a-strong-password');)
-- =====================================================================
