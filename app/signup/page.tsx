"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Monogram } from "@/components/brand";

type Focus = "learn" | "automate" | "both";

const FOCUS_OPTS: { key: Focus; label: string; sub: string }[] = [
  { key: "learn", label: "Learn", sub: "Trade by hand, score every thesis" },
  { key: "automate", label: "Automate", sub: "Let rules place and exit orders" },
  { key: "both", label: "Both", sub: "Manual now, rules when you trust them" },
];

const RULES = [
  { label: "Max daily loss", value: "2.0%" },
  { label: "Max position weight", value: "20%" },
];

/** Progress bar — three segments, filled up to the current step. */
function Progress({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="mb-6 flex gap-1.5">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={`h-1 flex-1 rounded-full ${i <= step ? "bg-black" : "bg-ink-600"}`}
        />
      ))}
    </div>
  );
}

function StepLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[10px] uppercase tracking-wider text-gold">{children}</div>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [focus, setFocus] = useState<Focus>("learn");

  return (
    <div className="mx-auto mt-12 max-w-sm">
      <div className="mb-6 flex justify-center">
        <Monogram size={56} />
      </div>

      <Progress step={step} />

      {step === 1 && (
        <>
          <StepLabel>Step 1 of 3 · Who is trading</StepLabel>
          <h1 className="mb-4 text-lg font-semibold">Open a paper book.</h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setStep(2);
            }}
            className="card space-y-4 p-6"
          >
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Display name</label>
              <input
                className="input"
                required
                placeholder="R. Kapra"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Email</label>
              <input
                className="input"
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-gold w-full">Continue</button>
          </form>
          <Link href="/login" className="btn-ghost mt-3 w-full">I already have a book</Link>
          <p className="mt-4 text-center text-[10px] text-neutral-600">
            Funding is virtual, so there is no KYC, no wait, and nothing to lose.
          </p>
        </>
      )}

      {step === 2 && (
        <>
          <StepLabel>Step 2 of 3 · How you trade</StepLabel>
          <h1 className="mb-4 text-lg font-semibold">Pick your lane.</h1>
          <div className="card space-y-2 p-4">
            {FOCUS_OPTS.map((o) => {
              const active = focus === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setFocus(o.key)}
                  className={`w-full rounded-lg border px-4 py-3 text-left ${
                    active
                      ? "border-black bg-ink-700 text-neutral-100"
                      : "border-ink-600 text-neutral-500 hover:bg-ink-700"
                  }`}
                >
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="block text-xs text-neutral-500">{o.sub}</span>
                </button>
              );
            })}
          </div>
          <button className="btn-gold mt-3 w-full" onClick={() => setStep(3)}>Continue</button>
          <button className="mt-3 block w-full text-center text-sm text-gold" onClick={() => setStep(1)}>
            ← Back
          </button>
        </>
      )}

      {step === 3 && (
        <>
          <StepLabel>Step 3 of 3 · House rules</StepLabel>
          <h1 className="mb-2 text-lg font-semibold">Set the guard rails first.</h1>
          <p className="mb-4 text-sm text-neutral-500">
            These are enforced before every automated order. You can loosen them later;
            most people wish they hadn&apos;t.
          </p>
          <div className="space-y-3">
            {RULES.map((r) => (
              <div key={r.label} className="card flex items-center justify-between p-4">
                <span className="text-sm text-neutral-200">{r.label}</span>
                <span className="num text-neutral-100">{r.value}</span>
              </div>
            ))}
            <div className="card flex items-center justify-between p-4">
              <span className="text-sm text-neutral-200">New rules start in</span>
              <span className="rounded bg-ink-700 px-2 py-0.5 text-[10px] tracking-wider text-gold">
                SIMULATE
              </span>
            </div>
          </div>
          <button className="btn-gold mt-4 w-full" onClick={() => router.push("/login")}>
            Fund $100,000 of virtual cash
          </button>
          <button className="mt-3 block w-full text-center text-sm text-gold" onClick={() => setStep(2)}>
            ← Back
          </button>
        </>
      )}
    </div>
  );
}
