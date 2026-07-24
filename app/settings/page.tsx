import Link from "next/link";
import { getCurrentRole } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";

export const dynamic = "force-dynamic";

function initials(from: string) {
  const parts = from.replace(/@.*/, "").split(/[.\s_-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (letters || from[0] || "?").toUpperCase();
}

export default async function SettingsPage() {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    return (
      <div className="card mx-auto mt-12 max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Your account</h1>
        <p className="mt-2 text-sm text-neutral-400">Sign in to see your account.</p>
        <Link href="/login" className="btn-gold mt-5 inline-block">Sign in</Link>
      </div>
    );
  }

  const role = (await getCurrentRole()) ?? "investor";
  const { data: prof } = await sb
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  const email = user.email ?? "—";
  const name = prof?.display_name ?? email.replace(/@.*/, "");

  const rows: { label: string; value: string }[] = [
    { label: "Email", value: email },
    { label: "Max daily loss", value: "2.0%" },
    { label: "Max position weight", value: "20%" },
    { label: "Automated orders per day", value: "10" },
    { label: "Quote source", value: "Finnhub · delayed" },
    { label: "Statement delivery", value: "Monthly" },
  ];

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-lg font-semibold">Your account</h1>

      <div className="card flex items-center gap-4 p-5">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-black bg-white text-sm font-bold text-black">
          {initials(name)}
        </span>
        <div>
          <div className="font-medium text-neutral-100">{name}</div>
          <div className="text-xs text-neutral-500">
            {email} · {role}
          </div>
        </div>
      </div>

      <div className="card divide-y divide-ink-600">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-neutral-400">{r.label}</span>
            <span className="num text-neutral-100">{r.value}</span>
          </div>
        ))}
      </div>

      <Link href="/admin" className="btn-ghost w-full">Try opening the admin console</Link>

      <SignOutButton />

      <p className="text-xs text-neutral-600">
        Guard rails apply to automated orders only. Virtual money — not investment advice.
      </p>
    </div>
  );
}
