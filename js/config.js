/* =====================================================================
   Qism al Tahfeez portal — settings you fill in once.

   1. Create a free project at https://supabase.com
   2. Project Settings → API: copy the "Project URL" and the "anon public" key
      and paste them below.
   3. Leave both empty to run in DEMO MODE: everything works, but data is
      only kept in this browser (good for trying it out, not for real use).
   ===================================================================== */
window.MZ_CONFIG = {
  SUPABASE_URL: 'https://dhnbnzcrubusjljneyfs.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobmJuemNydWJ1c2psam5leWZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NTEwMTQsImV4cCI6MjEwNjQyNzAxNH0.1VB4yZ8RfTxzxb9zlXvaaBkhwu0kosGpo6Ts98eqpco',

  // Must match public.login_domain() in supabase-setup.sql. Students never see this.
  LOGIN_DOMAIN: 'mahadalzahra.app',

  // Phone alerts (Web Push). Public key only; the private half is the VAPID_PRIVATE_KEY secret of the notify-teacher function.
  VAPID_PUBLIC_KEY: 'BAvcwmwigK9lMRNfKAC052jxcvjWiIbA7HxxMZhWrsvjQNb6Nij2AxQvWJeWjacODoymXy_P94NsemC9Vw5QT3k'
};
