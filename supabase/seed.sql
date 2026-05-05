-- =====================================================================
-- Sample seed data. Run AFTER signing in once, then replace YOUR_USER_ID
-- with the auth.users.id of the account you signed up with.
-- =====================================================================
-- Tip: select id, email from auth.users;

-- Replace this with your actual UUID:
-- e.g. select id, email from auth.users;
do $$
declare
  v_user uuid;
  v_sys  uuid;
  v_c1   uuid;
  v_c2   uuid;
  v_day  uuid;
  d      date;
  i      int;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'No auth user found. Sign up first.'; end if;

  insert into public.systems (user_id, name, description)
  values (v_user, 'Demo System', 'Auto-seeded sample data') returning id into v_sys;

  insert into public.scaling_log_entries
    (system_id, effective_date, starting_units_threshold, ending_units_threshold, unit_size_dollars, notes)
  values
    (v_sys, '2026-01-01', 0,  25, 25, 'Initial level'),
    (v_sys, '2026-02-15', 25, 50, 31, 'Scale up at +25u'),
    (v_sys, '2026-04-01', 50, 75, 39, 'Scale up at +50u');

  insert into public.cappers (system_id, name, base_system_risk_units, current_phase)
  values (v_sys, 'Underground Lab', 3, 'heater') returning id into v_c1;
  insert into public.cappers (system_id, name, base_system_risk_units, current_phase)
  values (v_sys, 'Tennisxu', 2, 'lukewarm') returning id into v_c2;

  -- generate ~60 days of data per capper
  for i in 0..59 loop
    d := date '2026-03-01' + i;

    insert into public.capper_day_entries
      (capper_id, system_id, date, entry_mode, wager_total, bet_count, daily_amount_pnl, wins, losses)
    values
      (v_c1, v_sys, d, 'daily_totals',
        300 + (random() * 200)::int,
        2 + (random() * 4)::int,
        (random() - 0.45) * 200,
        (random() * 4)::int,
        (random() * 4)::int);

    insert into public.capper_day_entries
      (capper_id, system_id, date, entry_mode, wager_total, bet_count, daily_amount_pnl, wins, losses)
    values
      (v_c2, v_sys, d, 'daily_totals',
        180 + (random() * 100)::int,
        1 + (random() * 3)::int,
        (random() - 0.5) * 120,
        (random() * 3)::int,
        (random() * 3)::int);
  end loop;
end $$;
