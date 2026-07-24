-- M8 deploy — harden SECURITY DEFINER functions that PostgREST exposes as RPCs.
-- Applied to the live project on first deploy.

-- fire_rule bypasses RLS to write orders/trades/ledger atomically. Only the Edge
-- worker (service_role) should ever call it — never a client via /rest/v1/rpc.
revoke execute on function public.fire_rule(uuid, uuid, uuid, text, numeric, bigint, bigint, bigint, timestamptz, text) from anon, authenticated;

-- handle_new_user is a trigger function and must never be invoked directly.
revoke execute on function public.handle_new_user() from anon, authenticated;

-- NOTE: owns_portfolio / advises_portfolio are intentionally left executable by
-- the `authenticated` role — the RLS policies on every owner-scoped table call
-- them during query planning, so revoking would break row access. They only
-- return a boolean about the caller's own access and leak nothing.
