-- =====================================================================
-- Switch from Supabase Auth to Clerk.
-- Clerk user IDs are strings (e.g. user_2abc...), not UUIDs.
-- The server uses the Supabase service role key, which bypasses RLS,
-- so we filter by user_id in application code instead.
-- =====================================================================

-- Drop policies on system-scoped tables
do $$
declare t text;
begin
  for t in select unnest(array[
    'systems','scaling_log_entries','cappers','capper_day_entries',
    'capper_bet_entries','journal_day_entries','system_backups'
  ]) loop
    execute format('drop policy if exists "via system" on public.%I', t);
    execute format('drop policy if exists "systems owner" on public.%I', t);
    execute format('alter table public.%I disable row level security', t);
  end loop;
end $$;

-- Drop the auth.users FK and switch user_id to text
alter table public.systems drop constraint if exists systems_user_id_fkey;
alter table public.system_backups drop constraint if exists system_backups_user_id_fkey;

alter table public.systems       alter column user_id type text using user_id::text;
alter table public.system_backups alter column user_id type text using user_id::text;
