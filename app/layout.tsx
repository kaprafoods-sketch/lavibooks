import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Wordmark } from "@/components/brand";
import Link from "next/link";
import { getCurrentRole } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Lavi Books — Paper Trading",
  description: "Vested-style paper trading for US equities, with a learning layer.",
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
};

const NAV = {
  dashboard: { href: "/", label: "Dashboard" },
  command: { href: "/command", label: "Command" },
  admin: { href: "/admin", label: "Admin" },
  trade: { href: "/trade", label: "Trade" },
  orders: { href: "/orders", label: "Orders" },
  rules: { href: "/rules", label: "Rules" },
  learning: { href: "/learning", label: "Learning" },
  backtest: { href: "/backtest", label: "Backtest" },
};

function navFor(role: string | null) {
  if (role === "admin") return [NAV.dashboard, NAV.command, NAV.admin, NAV.trade, NAV.orders, NAV.rules, NAV.learning, NAV.backtest];
  if (role === "investor") return [NAV.command, NAV.dashboard]; // their money + dashboards only
  return [NAV.dashboard, NAV.command, NAV.trade, NAV.orders, NAV.rules, NAV.learning, NAV.backtest];
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const role = await getCurrentRole();
  const nav = navFor(role);
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-10 border-b border-ink-600 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Wordmark />
            <nav className="hidden gap-1 sm:flex">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-ink-700 hover:text-neutral-100"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          {/* Mobile-first bottom-safe nav */}
          <nav className="flex justify-around border-t border-ink-600 sm:hidden">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="px-2 py-2 text-xs text-neutral-400">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-neutral-600">
          Lavi Books · paper trading · virtual money only. Quotes may be delayed —
          see the “Delayed” tags. Not investment advice.
        </footer>
      </body>
    </html>
  );
}
