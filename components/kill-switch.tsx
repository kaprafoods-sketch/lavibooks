"use client";

import { useState, useTransition } from "react";
import { toggleKillSwitch } from "@/app/actions/rules";

/** One-tap global kill switch, reachable from the rules header. */
export function KillSwitch({ portfolioId, enabled }: { portfolioId: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !on;
    if (!next && !confirm("Throw the kill switch? This disarms EVERY rule in this portfolio immediately.")) return;
    start(async () => {
      await toggleKillSwitch(portfolioId, next);
      setOn(next);
    });
  }

  return (
    <button
      onClick={toggle} disabled={pending}
      className={`btn text-xs ${on ? "border border-gain/50 text-gain" : "bg-loss text-ink-900"}`}
      title={on ? "Automation is live — click to disarm all rules" : "Automation disabled — click to enable"}
    >
      {on ? "● Automation ON" : "◼ KILLED — enable"}
    </button>
  );
}
