import type { Metadata } from "next";
import "./globals.css";
import { Wordmark } from "@/components/brand";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Lavi Books — Paper Trading",
  description: "Vested-style paper trading for US equities, with a learning layer.",
  themeColor: "#FFFFFF",
};

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/command", label: "Command" },
  { href: "/trade", label: "Trade" },
  { href: "/orders", label: "Orders" },
  { href: "/rules", label: "Rules" },
  { href: "/learning", label: "Learning" },
  { href: "/backtest", label: "Backtest" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
