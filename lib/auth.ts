import { createServerSupabase } from "./supabase/server";

/** Returns the signed-in user's default (first) manual portfolio, or null. */
export async function getDefaultPortfolio() {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { sb, user: null, portfolio: null };
  const { data: portfolio } = await sb
    .from("portfolios")
    .select("*")
    .eq("owner_id", user.id)
    .eq("kind", "manual")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return { sb, user, portfolio };
}
