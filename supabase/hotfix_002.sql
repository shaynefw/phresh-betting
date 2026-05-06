-- =====================================================================
-- Hotfix 002: gate after-write triggers so recompute_capper / journal
-- updates don't recursively re-fire them. Without this, a user insert
-- runs recompute_capper -> UPDATE capper_day_entries -> cde_after fires
-- -> recompute_capper -> ...  until stack-depth-exceeded.
--
-- Use pg_trigger_depth() to detect nested-trigger context.
-- =====================================================================

create or replace function public.trg_after_cde()
returns trigger language plpgsql as $$
declare
  v_capper uuid;
  v_system uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  v_capper := coalesce(new.capper_id, old.capper_id);
  v_system := coalesce(new.system_id, old.system_id);
  perform public.recompute_capper(v_capper);
  perform public.recompute_journal(v_system);
  return null;
end $$;

create or replace function public.trg_after_cbe()
returns trigger language plpgsql as $$
declare
  v_capper uuid;
  v_system uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  v_capper := coalesce(new.capper_id, old.capper_id);
  v_system := coalesce(new.system_id, old.system_id);
  perform public.recompute_capper(v_capper);
  perform public.recompute_journal(v_system);
  return null;
end $$;

create or replace function public.trg_after_scaling()
returns trigger language plpgsql as $$
declare
  c record;
  v_system uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  v_system := coalesce(new.system_id, old.system_id);
  for c in select id from public.cappers where system_id = v_system loop
    perform public.recompute_capper(c.id);
  end loop;
  perform public.recompute_journal(v_system);
  return null;
end $$;
