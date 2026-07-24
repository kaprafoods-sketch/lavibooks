"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Signs out and does a full navigation so middleware drops the session cookie. */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await createClient().auth.signOut();
        window.location.href = "/login";
      }}
      className="btn w-full border border-loss text-loss hover:bg-ink-700 disabled:opacity-50"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
