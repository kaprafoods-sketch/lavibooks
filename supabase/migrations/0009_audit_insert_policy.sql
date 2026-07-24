-- audit_log previously had only a SELECT policy, so client-side audit inserts
-- (order fills, and an admin trading on behalf of an investor) were silently
-- blocked by RLS. Allow authenticated users to write audit rows attributed to
-- themselves — this captures "admin X acted on portfolio Y" with real provenance.
create policy audit_insert_self on public.audit_log
  for insert to authenticated
  with check (actor_id = auth.uid());
