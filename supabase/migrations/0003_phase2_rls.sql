-- PHASE 2 RLS extension (schema + policy only; no Phase-2 UI in v1).
--
-- Layers org-scoped access ADDITIVELY on top of the Phase-1 owner policies.
-- Enabling these does not remove a user's access to their own data — it grants
-- advisors/owners visibility into their org's client portfolios.

-- Is the current user an advisor/owner in the same org as this portfolio?
create or replace function advises_portfolio(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from portfolios p
    join profiles me on me.id = auth.uid()
    where p.id = pid
      and p.org_id is not null
      and p.org_id = me.org_id
      and me.role in ('owner','advisor')
  );
$$;

-- Extend the ownership helper used by all child-table policies so a single
-- change flows everywhere. (Phase 1 policies call owns_portfolio; here we
-- broaden it to include advisor access.)
create or replace function owns_portfolio(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from portfolios p
    where p.id = pid and p.owner_id = auth.uid()
  ) or advises_portfolio(pid);
$$;

-- Audit log: readable by org owners/advisors; writable by service role only.
alter table audit_log enable row level security;
create policy audit_read on audit_log for select using (
  org_id is not null and exists (
    select 1 from profiles me
    where me.id = auth.uid() and me.org_id = audit_log.org_id
      and me.role in ('owner','advisor')
  )
);
