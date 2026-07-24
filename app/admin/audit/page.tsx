"use client";

import { useState } from "react";
import Link from "next/link";

type Cat = "access" | "roles" | "kill";
type Filter = Cat | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "access", label: "Access" },
  { key: "roles", label: "Roles" },
  { key: "kill", label: "Kill switch" },
];

const ENTRIES: { title: string; when: string; actor: string; cat: Cat }[] = [
  { title: "Kill switch thrown — 19 rules disarmed platform-wide", when: "24 Jul 14:22", actor: "admin@lavibooks.test", cat: "kill" },
  { title: "Viewed A. Mehta's book (read-only)", when: "24 Jul 11:08", actor: "admin@lavibooks.test", cat: "access" },
  { title: "Role changed: D. Roy investor → read_only", when: "23 Jul 17:40", actor: "admin@lavibooks.test", cat: "roles" },
  { title: "Invitation sent to n.bansal@example.com", when: "23 Jul 09:15", actor: "admin@lavibooks.test", cat: "access" },
  { title: "Rule v3 flipped simulate → live (NVDA trailing stop)", when: "22 Jul 08:12", actor: "rk@lavibooks.test", cat: "kill" },
  { title: "Order rejected — buying power (MSFT 124)", when: "23 Jul 11:02", actor: "rk@lavibooks.test", cat: "access" },
  { title: "Signed in via magic link", when: "22 Jul 07:55", actor: "s.iyer@example.com", cat: "access" },
];

export default function AdminAuditPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = ENTRIES.filter((e) => filter === "all" || e.cat === filter);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/admin" className="text-sm text-gold hover:underline">← Admin console</Link>

      <div>
        <h1 className="text-lg font-semibold">Audit log</h1>
        <p className="text-xs text-neutral-500">Append-only. Who did what, to whose book, and when.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-xs ${
                active
                  ? "border-black bg-black text-white"
                  : "border-ink-600 text-neutral-500 hover:text-neutral-100"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="card divide-y divide-ink-600">
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-neutral-500">No entries for this filter.</div>
        ) : (
          rows.map((e, i) => (
            <div key={i} className="px-4 py-3">
              <div className="text-sm text-neutral-100">{e.title}</div>
              <div className="text-xs text-neutral-500">
                {e.when} · {e.actor}
              </div>
            </div>
          ))
        )}
      </div>

      <button type="button" className="mx-auto block text-sm text-gold">Load older entries</button>
    </div>
  );
}
