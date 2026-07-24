"use client";

import { useTransition } from "react";
import { setRuleStatus, setRuleMode } from "@/app/actions/rules";

/** Per-rule arm/disarm + simulate/live toggle. */
export function RuleControls({ ruleId, status, mode }: { ruleId: string; status: string; mode: string }) {
  const [pending, start] = useTransition();
  const armed = status === "armed";

  return (
    <div className="flex items-center gap-2">
      <button
        disabled={pending || status === "completed" || status === "cancelled"}
        onClick={() => start(async () => { await setRuleStatus(ruleId, armed ? "draft" : "armed"); })}
        className={`btn text-xs ${armed ? "border border-ink-500 text-neutral-300" : "btn-gold"}`}
      >
        {armed ? "Disarm" : "Arm"}
      </button>
      <button
        disabled={pending}
        onClick={() => start(async () => { await setRuleMode(ruleId, mode === "live" ? "simulate" : "live"); })}
        className={`btn text-xs ${mode === "live" ? "border border-gold/50 text-gold" : "border border-ink-500 text-neutral-400"}`}
        title="Simulate logs decisions without placing orders. Flip to Live to arm for real (paper) fills."
      >
        {mode === "live" ? "LIVE" : "SIMULATE"}
      </button>
    </div>
  );
}
