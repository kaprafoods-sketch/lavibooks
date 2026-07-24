import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentRole } from "@/lib/auth";
import { Sidebar, type NavItem } from "@/components/sidebar";

export const metadata: Metadata = {
  title: "Lavi Books — Paper Trading",
  description: "Vested-style paper trading for US equities, with a learning layer.",
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
};

const NAV = {
  dashboard: { href: "/", label: "Dashboard", icon: "dashboard" },
  command: { href: "/command", label: "Command", icon: "command" },
  admin: { href: "/admin", label: "Admin", icon: "admin" },
  trade: { href: "/trade", label: "Trade", icon: "trade" },
  orders: { href: "/orders", label: "Orders", icon: "orders" },
  rules: { href: "/rules", label: "Rules", icon: "rules" },
  learning: { href: "/learning", label: "Learning", icon: "learning" },
  backtest: { href: "/backtest", label: "Backtest", icon: "backtest" },
} satisfies Record<string, NavItem>;

function navFor(role: string | null): NavItem[] {
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
        <div className="flex min-h-screen">
          <Sidebar nav={nav} />
          <div className="flex min-w-0 flex-1 flex-col">
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
            <footer className="mx-auto w-full max-w-5xl px-4 py-8 text-xs text-neutral-600">
              Lavi Books · paper trading · virtual money only. Quotes may be delayed —
              see the “Delayed” tags. Not investment advice.
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
