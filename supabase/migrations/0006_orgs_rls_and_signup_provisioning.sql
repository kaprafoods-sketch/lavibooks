-- M8 deploy — lock down the Phase-2 orgs stub and auto-provision new users.
-- Applied to the live project on first deploy.

-- 1) The Phase-2 `orgs` stub had RLS disabled (flagged by the security linter).
--    Enable it with no policy → service-role only until Phase 2 adds policies.
alter table public.orgs enable row level security;

-- 2) Every new auth user gets a profile + a funded paper portfolio, so a freshly
--    signed-in user is never staring at an empty app. SECURITY DEFINER so it can
--    write past RLS inside the signup transaction; search_path pinned.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public as $$
declare
  v_portfolio_id uuid;
begin
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), 'client')
  on conflict (id) do nothing;

  if not exists (select 1 from public.portfolios where owner_id = new.id and kind = 'manual') then
    insert into public.portfolios (owner_id, name, kind)
    values (new.id, 'Main (paper)', 'manual')
    returning id into v_portfolio_id;

    insert into public.sim_config (portfolio_id, slippage_bps, commission_cents)
    values (v_portfolio_id, 5, 0);

    -- $100,000 of virtual cash (balance is derived from this ledger row).
    insert into public.cash_ledger (portfolio_id, amount_cents, reason)
    values (v_portfolio_id, 10000000, 'deposit');

    insert into public.automation_settings (portfolio_id, automation_enabled)
    values (v_portfolio_id, false);
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
