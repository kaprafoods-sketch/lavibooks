import { createServerSupabase } from "./supabase/server";

export type AppRole = "admin" | "investor" | "client" | "owner" | "advisor" | "read_only";

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

/** The signed-in user's app role (from profiles), or null if signed out. */
export async function getCurrentRole(): Promise<AppRole | null> {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return (data?.role as AppRole) ?? "investor";
}
