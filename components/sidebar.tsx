"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Monogram } from "@/components/brand";

export type NavItem = { href: string; label: string; icon: IconName };

type IconName =
  | "dashboard"
  | "command"
  | "admin"
  | "trade"
  | "orders"
  | "rules"
  | "learning"
  | "backtest";

/* Minimal inline icon set — stroke-based, inherits currentColor. */
function Icon({ name }: { name: IconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "shrink-0",
  };
  switch (name) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
      );
    case "command":
      return (
        <svg {...common}>
          <path d="M9 6a3 3 0 1 0-3 3h3V6Zm0 0v12m0-12h6M9 18a3 3 0 1 1-3-3h3v3Zm6 0a3 3 0 1 0 3-3h-3v3Zm0 0V6m0 0a3 3 0 1 1 3 3h-3V6Z" />
        </svg>
      );
    case "admin":
      return (
        <svg {...common}>
          <path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5l-8-3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "trade":
      return (
        <svg {...common}>
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M17 7h4v4" />
        </svg>
      );
    case "orders":
      return (
        <svg {...common}>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      );
    case "rules":
      return (
        <svg {...common}>
          <path d="M4 4h16v4H4zM4 14h16v6H4z" />
          <path d="M8 11v.01M12 11v.01M16 11v.01" />
        </svg>
      );
    case "learning":
      return (
        <svg {...common}>
          <path d="M12 4 2 9l10 5 10-5-10-5Z" />
          <path d="M6 11v5c0 1 2.7 3 6 3s6-2 6-3v-5" />
        </svg>
      );
    case "backtest":
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <path d="m7 14 3-3 3 2 5-6" />
        </svg>
      );
  }
}

export function Sidebar({ nav }: { nav: NavItem[] }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Persist collapse preference.
  useEffect(() => {
    const saved = localStorage.getItem("lv-sidebar-collapsed");
    if (saved) setCollapsed(saved === "1");
  }, []);
  useEffect(() => {
    localStorage.setItem("lv-sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  // Close the mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const width = collapsed ? "w-[64px]" : "w-[248px]";

  const rail = (
    <div className="flex h-full flex-col">
      {/* Brand + collapse toggle */}
      <div className="flex items-center gap-2 px-3 py-4">
        <Link href="/" className="flex items-center gap-2 overflow-hidden">
          <Monogram size={32} />
          {!collapsed && (
            <span className="whitespace-nowrap font-heading text-sm font-semibold tracking-[0.2em] text-neutral-100">
              LAVI&nbsp;BOOKS
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="ml-auto hidden rounded-md p-1.5 text-neutral-500 hover:bg-ink-700 hover:text-neutral-100 lg:inline-flex"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {nav.map((n) => {
          const active = isActive(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              title={collapsed ? n.label : undefined}
              className={[
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                collapsed ? "justify-center" : "",
                active
                  ? "bg-ink-700 font-medium text-neutral-100"
                  : "text-neutral-400 hover:bg-ink-700 hover:text-neutral-100",
              ].join(" ")}
            >
              <span className={active ? "text-neutral-100" : "text-neutral-500 group-hover:text-neutral-100"}>
                <Icon name={n.icon} />
              </span>
              {!collapsed && <span className="whitespace-nowrap">{n.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-3 text-[10px] leading-tight text-neutral-600">
        {!collapsed && <span>Paper trading · virtual money only</span>}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-600 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="rounded-md p-1.5 text-neutral-500 hover:bg-ink-700 hover:text-neutral-100"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <Link href="/" className="flex items-center gap-2">
          <Monogram size={28} />
          <span className="font-heading text-xs font-semibold tracking-[0.2em] text-neutral-100">LAVI&nbsp;BOOKS</span>
        </Link>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="absolute left-0 top-0 h-full w-[248px] border-r border-ink-600 bg-white shadow-xl">
            {rail}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 border-r border-ink-600 bg-white transition-[width] duration-200 lg:block ${width}`}
      >
        {rail}
      </aside>
    </>
  );
}
