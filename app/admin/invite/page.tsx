"use client";

import { useState } from "react";
import Link from "next/link";

type Role = "investor" | "read_only" | "admin";
const ROLES: { key: Role; label: string }[] = [
  { key: "investor", label: "Investor" },
  { key: "read_only", label: "Read-only" },
  { key: "admin", label: "Admin" },
];

export default function AdminInvitePage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("investor");
  const [cash, setCash] = useState("100000");
  const [simulate, setSimulate] = useState(true);
  const [sent, setSent] = useState(false);

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Link href="/admin" className="text-sm text-gold hover:underline">← Admin console</Link>

      <div>
        <h1 className="text-lg font-semibold">Invite an investor</h1>
        <p className="text-xs text-neutral-500">
          They get a one-time link, $100,000 of virtual cash, and the guard rails you set below.
        </p>
      </div>

      {sent ? (
        <div className="card p-6 text-center text-sm text-neutral-300">
          Invitation sent to <span className="text-gold">{email || "the investor"}</span>.
          <div className="mt-4">
            <Link href="/admin" className="btn-ghost inline-block">Back to admin</Link>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSent(true);
          }}
          className="card space-y-4 p-6"
        >
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Email</label>
            <input
              className="input"
              type="email"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Display name</label>
            <input
              className="input"
              placeholder="A. Mehta"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Role</label>
            <div className="grid grid-cols-3 gap-2">
              {ROLES.map((r) => {
                const active = role === r.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setRole(r.key)}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      active
                        ? "border-black bg-black text-white"
                        : "border-ink-600 text-neutral-500 hover:bg-ink-700"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Opening virtual cash ($)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={cash}
              onChange={(e) => setCash(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-200">Rules start in simulate</span>
            <button
              type="button"
              role="switch"
              aria-checked={simulate}
              onClick={() => setSimulate((s) => !s)}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                simulate ? "bg-black" : "bg-ink-600"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  simulate ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          <button type="submit" className="btn-gold w-full">Send invitation</button>
        </form>
      )}

      {!sent && (
        <Link href="/admin" className="block text-center text-sm text-gold">Cancel</Link>
      )}
    </div>
  );
}
