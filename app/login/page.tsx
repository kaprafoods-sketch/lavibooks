"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Monogram } from "@/components/brand";

const DEMO_PASSWORD = "lavibooks-demo-123";
const DEMOS = [
  { email: "admin@lavibooks.test", label: "Admin demo", sub: "See every investor + market feed", to: "/admin" },
  { email: "demo@lavibooks.test", label: "Investor demo", sub: "~$117k portfolio · your money & dashboards", to: "/command" },
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const sb = createClient();
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  async function demoLogin(demoEmail: string, to: string) {
    setError(null);
    setBusy(demoEmail);
    const sb = createClient();
    const { error } = await sb.auth.signInWithPassword({ email: demoEmail, password: DEMO_PASSWORD });
    if (error) {
      setError(error.message);
      setBusy(null);
    } else {
      // Full navigation so middleware picks up the fresh session cookie.
      window.location.href = to;
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <div className="mb-6 flex flex-col items-center gap-3">
        <Monogram size={56} />
        <h1 className="text-lg font-semibold tracking-widest">LAVI BOOKS</h1>
        <p className="text-sm text-neutral-500">Paper trading, with a memory.</p>
      </div>

      {/* One-click demo accounts — no email required. */}
      <div className="card space-y-2 p-4">
        <div className="text-[10px] uppercase tracking-wider text-gold">Try it instantly — demo accounts</div>
        {DEMOS.map((d) => (
          <button
            key={d.email}
            onClick={() => demoLogin(d.email, d.to)}
            disabled={busy !== null}
            className="flex w-full items-center justify-between rounded-lg border border-ink-600 px-3 py-2 text-left hover:bg-ink-700 disabled:opacity-50"
          >
            <span>
              <span className="block text-sm font-medium text-neutral-100">{d.label}</span>
              <span className="block text-xs text-neutral-500">{d.sub}</span>
            </span>
            <span className="text-xs text-gold">{busy === d.email ? "Entering…" : "Enter →"}</span>
          </button>
        ))}
        <p className="text-[10px] text-neutral-600">Virtual money only. Not investment advice.</p>
      </div>

      <div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-wider text-neutral-500">
        <span className="h-px flex-1 bg-ink-600" /> or your own email <span className="h-px flex-1 bg-ink-600" />
      </div>

      {sent ? (
        <div className="card p-6 text-center text-sm text-neutral-300">
          Check <span className="text-gold">{email}</span> for a magic link.
        </div>
      ) : (
        <form onSubmit={send} className="card space-y-4 p-6">
          <input
            type="email" required placeholder="you@example.com" value={email}
            onChange={(e) => setEmail(e.target.value)} className="input"
          />
          <button type="submit" className="btn-gold w-full">Send magic link</button>
        </form>
      )}
      {error && <p className="loss mt-3 text-center text-xs">{error}</p>}
    </div>
  );
}
