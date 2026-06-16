-- =====================================================================
-- Re-enable Row Level Security on every public table.
--
-- 0003_clerk.sql turned RLS off when we migrated from Supabase Auth to
-- Clerk, on the theory that the server uses the service_role key which
-- bypasses RLS anyway. That's true for THIS app's code path, but the
-- project's anon key still works — and with RLS off, anyone holding
-- the (publicly-visible) anon key can read/write every table via
-- PostgREST. Supabase's "rls_disabled_in_public" advisory is flagging
-- exactly that.
--
-- Fix: enable RLS on every table. We deliberately add NO policies.
-- Without a policy, RLS denies every role *except* roles that bypass
-- RLS (service_role, postgres). So:
--
--   - service_role  (used by createAdminClient + import_backup_fast)  ✅
--   - postgres      (function-owner of SECURITY DEFINER functions)   ✅
--   - anon          → denied                                          🚫
--   - authenticated → denied                                          🚫
--
-- Application code stays unchanged. The server-side filters by
-- user_id from Clerk's auth() before returning rows; that's still the
-- only path data leaves the database.
-- =====================================================================

do $$
declare t text;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'                  -- ordinary tables only
      and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Belt-and-suspenders: revoke direct grants from the anon and
-- authenticated roles. RLS denies them already, but stripping grants
-- means PostgREST won't even expose the tables in its OpenAPI schema
-- to those roles.
do $$
declare t text;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format(
      'revoke all on public.%I from anon, authenticated', t
    );
  end loop;
end $$;
