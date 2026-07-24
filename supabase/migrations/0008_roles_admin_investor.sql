-- Simplified role model: admin (full visibility) + investor (own money only).
-- Legacy role values are kept so pre-existing rows don't violate the constraint.

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','advisor','read_only','client','admin','investor'));

-- Is the current user an admin? SECURITY DEFINER so it reads profiles past RLS.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke execute on function public.is_admin() from anon;

-- Fold admin into the ownership predicate every child-table policy already uses,
-- so an admin can read/act across all portfolios' ledgers/lots/trades/rules/etc.
create or replace function public.owns_portfolio(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.portfolios p where p.id = pid and p.owner_id = auth.uid()
  ) or public.advises_portfolio(pid) or public.is_admin();
$$;

-- portfolios + profiles keep their owner-only SELECT policies; add an additive
-- admin read so the admin console can list every investor.
drop policy if exists portfolios_admin_read on public.portfolios;
create policy portfolios_admin_read on public.portfolios for select using (public.is_admin());
drop policy if exists profiles_admin_read on public.profiles;
create policy profiles_admin_read on public.profiles for select using (public.is_admin());

-- Demo accounts: admin@ = admin, demo@/demo2@ = investor (applied to live data too).
