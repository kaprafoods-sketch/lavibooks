"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Monogram } from "@/components/brand";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <div className="mb-6 flex flex-col items-center gap-3">
        <Monogram size={56} />
        <h1 className="text-lg font-semibold tracking-widest">LAVI BOOKS</h1>
        <p className="text-sm text-neutral-500">Paper trading, with a memory.</p>
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
          {error && <p className="loss text-xs">{error}</p>}
        </form>
      )}
    </div>
  );
}
