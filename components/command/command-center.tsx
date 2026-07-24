"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtCents } from "@/lib/money";
import type { CommandView, DeepDiveBundle, HoldingRow } from "@/lib/command-service";
import { FlowWaveBg } from "./flow-wave-bg";
import { Sparkline } from "./sparkline";
import { DeepDive } from "./deep-dive";
import { CommandPalette, type PaletteItem } from "./command-palette";

type SortKey = "symbol" | "weightPct" | "dayChangePct" | "unrealizedPnlCents" | "marketValueCents" | "realizedPnlCents";
type Range = "1D" | "1W" | "1M" | "3M" | "YTD" | "ALL";
const RANGES: Range[] = ["1D", "1W", "1M", "3M", "YTD", "ALL"];

function signCls(n: number | null | undefined) {
  return n != null && n > 0 ? "t-gain" : n != null && n < 0 ? "t-loss" : "";
}
function pctStr(n: number | null) {
  return n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function rangeCutoff(range: Range): number {
  const now = Date.now();
  const day = 86_400_000;
  switch (range) {
    case "1D": return now - day;
    case "1W": return now - 7 * day;
    case "1M": return now - 30 * day;
    case "3M": return now - 90 * day;
    case "YTD": return new Date(new Date().getFullYear(), 0, 1).getTime();
    case "ALL": return 0;
  }
}

export function CommandCenter({ view, bundles, disclaimer, viewingLabel }: { view: CommandView; bundles: Record<string, DeepDiveBundle>; disclaimer: string; viewingLabel?: string }) {
  const [selected, setSelected] = useState<string | null>(view.holdings[0]?.instrumentId ?? null);
  const [sortKey, setSortKey] = useState<SortKey>("weightPct");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [filter, setFilter] = useState("");
  const [range, setRange] = useState<Range>("1M");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [asOfLabel, setAsOfLabel] = useState<string>("");
  const deepRef = useRef<HTMLDivElement>(null);

  // Cmd/Ctrl-K to open the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Client-side "as of" label (avoids SSR/tz mismatch).
  useEffect(() => {
    setAsOfLabel(view.asOf ? new Date(view.asOf).toLocaleTimeString() : "—");
  }, [view.asOf]);

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const filtered = view.holdings.filter((h) => !f || `${h.symbol} ${h.name ?? ""} ${h.sector ?? ""}`.toLowerCase().includes(f));
    return [...filtered].sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number | string;
      const bv = (b[sortKey] ?? 0) as number | string;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * sortDir;
      return ((av as number) - (bv as number)) * sortDir;
    });
  }, [view.holdings, filter, sortKey, sortDir]);

  const equitySeries = useMemo(() => {
    const cut = rangeCutoff(range);
    return view.equityCurve.filter((p) => new Date(p.d).getTime() >= cut).map((p) => p.equity);
  }, [view.equityCurve, range]);

  const select = (id: string) => {
    setSelected(id);
    requestAnimationFrame(() => deepRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(k === "symbol" ? 1 : -1); }
  };

  const exportCsv = () => {
    const cols = ["symbol", "name", "sector", "qty", "avgCostCents", "lastCents", "marketValueCents", "dayChangePct", "unrealizedPnlCents", "weightPct", "realizedPnlCents", "holdingDays"];
    const head = cols.join(",");
    const body = rows.map((r) => cols.map((c) => {
      const v = (r as unknown as Record<string, unknown>)[c];
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const blob = new Blob([`${head}\n${body}\n`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "command-holdings.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const paletteItems: PaletteItem[] = useMemo(() => {
    const tickers: PaletteItem[] = view.holdings.map((h) => ({
      id: `t-${h.instrumentId}`, label: h.symbol, hint: h.name ?? undefined, group: "Ticker", run: () => select(h.instrumentId),
    }));
    const actions: PaletteItem[] = [
      { id: "a-csv", label: "Export current view to CSV", group: "Action", run: exportCsv },
      { id: "a-trade", label: "Open Trade ticket", group: "Nav", run: () => (window.location.href = "/trade") },
      { id: "a-rules", label: "Open Rules / automation", group: "Nav", run: () => (window.location.href = "/rules") },
      { id: "a-top", label: "Scroll to top", group: "View", run: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
    ];
    return [...tickers, ...actions];
  }, [view.holdings]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedHolding = view.holdings.find((h) => h.instrumentId === selected) ?? null;
  const selectedBundle = selected ? bundles[selected] : null;

  return (
    <div data-terminal style={{ position: "relative", minHeight: "100vh", marginLeft: "calc(50% - 50vw)", marginRight: "calc(50% - 50vw)", width: "100vw" }}>
      <FlowWaveBg />
      {/* Scrim between wave and content for legibility. */}
      <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none", background: "linear-gradient(180deg, rgba(4,17,11,0.15) 0%, rgba(4,17,11,0.55) 42%, rgba(4,17,11,0.82) 100%)" }} />

      <div style={{ position: "relative", zIndex: 2, maxWidth: 1180, margin: "0 auto", padding: "0 16px 120px" }}>
        {/* ─────────── HERO / ZONE A: Portfolio Command Bar ─────────── */}
        <section style={{ minHeight: "78vh", display: "flex", flexDirection: "column", justifyContent: "center", paddingTop: 40 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 18 }}>
            <h1 style={{ fontSize: 15, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--t-dim)", margin: 0 }}>Command Center</h1>
            {viewingLabel && <span className="t-chip" style={{ color: "var(--t-gain)", borderColor: "var(--t-line-2)" }}>{viewingLabel}</span>}
            <span className="t-chip">as of {asOfLabel}</span>
            {view.anyDelayed && <span className="t-chip">DELAYED QUOTES</span>}
            {view.anyStale && <span className="t-chip t-stale">STALE</span>}
            <button onClick={() => setPaletteOpen(true)} className="t-chip" style={{ marginLeft: "auto", cursor: "pointer" }}>⌘K search</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Metric label="Total equity" value={fmtCents(view.equityCents)} big />
            <Metric label="Day P&L" value={`${view.dayPnlCents >= 0 ? "+" : ""}${fmtCents(view.dayPnlCents)}`} sub={pctStr(view.dayPnlPct)} cls={signCls(view.dayPnlCents)} />
            <Metric label="Unrealized P&L" value={`${view.unrealizedPnlCents >= 0 ? "+" : ""}${fmtCents(view.unrealizedPnlCents)}`} cls={signCls(view.unrealizedPnlCents)} />
            <Metric label="Realized P&L" value={`${view.realizedPnlCents >= 0 ? "+" : ""}${fmtCents(view.realizedPnlCents)}`} cls={signCls(view.realizedPnlCents)} />
            <Metric label="Cash / buying power" value={fmtCents(view.cashCents)} />
            <Metric label="Exposure" value={`${view.investedPct.toFixed(0)}% invested`} sub={`${view.cashPct.toFixed(0)}% cash`} />
          </div>

          <div className="t-panel" style={{ marginTop: 12, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span className="t-label">Equity curve</span>
              <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                {RANGES.map((r) => (
                  <span key={r} className="t-tab" data-active={range === r} style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => setRange(r)}>{r}</span>
                ))}
              </div>
            </div>
            <Sparkline data={equitySeries} width={1100} height={64} />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            {view.best && <BwCard kind="Best today" h={view.best} onClick={() => select(view.best!.instrumentId)} />}
            {view.worst && <BwCard kind="Worst today" h={view.worst} onClick={() => select(view.worst!.instrumentId)} />}
            <div className="t-panel" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
              <div>
                <div className="t-label">Automation</div>
                <div className="t-mono" style={{ fontSize: 14 }}>{view.armedRules} armed</div>
              </div>
              <a href="/rules" className="t-chip" style={{ color: view.automationEnabled ? "var(--t-gain)" : "var(--t-loss)" }}>
                {view.automationEnabled ? "● live" : "○ kill-switch off"}
              </a>
            </div>
          </div>

          <div className="t-scroll-hint" style={{ marginTop: 26, textAlign: "center" }}>scroll ↓ holdings</div>
        </section>

        {/* ─────────── ZONE B: Holdings Grid ─────────── */}
        <section style={{ marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <h2 style={{ fontSize: 13, color: "var(--t-dim)", textTransform: "uppercase", letterSpacing: ".1em", margin: 0 }}>Holdings</h2>
            {view.concentrationPct > 20 && (
              <span className="t-chip t-loss" title="A single name exceeds 20% of the book">⚠ concentration {view.concentrationPct.toFixed(0)}%</span>
            )}
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter…" className="t-mono"
              style={{ marginLeft: "auto", background: "transparent", border: "1px solid var(--t-line-2)", borderRadius: 4, color: "var(--t-text)", padding: "4px 8px", fontSize: 12, width: 140 }} />
            <button onClick={exportCsv} className="t-chip" style={{ cursor: "pointer" }}>CSV ↓</button>
          </div>

          <div className="t-panel" style={{ padding: 0, overflowX: "auto" }}>
            {rows.length === 0 ? (
              <div className="t-label" style={{ padding: 24 }}>No open positions. <a href="/trade" style={{ color: "var(--t-gain)" }}>Place your first trade →</a></div>
            ) : (
              <table className="t-grid">
                <thead>
                  <tr>
                    <Th onClick={() => toggleSort("symbol")} active={sortKey === "symbol"}>Ticker</Th>
                    <th>Qty</th><th>Avg</th><th>Last</th>
                    <Th onClick={() => toggleSort("marketValueCents")} active={sortKey === "marketValueCents"}>Mkt val</Th>
                    <Th onClick={() => toggleSort("dayChangePct")} active={sortKey === "dayChangePct"}>Day%</Th>
                    <Th onClick={() => toggleSort("unrealizedPnlCents")} active={sortKey === "unrealizedPnlCents"}>Unrl P&L</Th>
                    <Th onClick={() => toggleSort("weightPct")} active={sortKey === "weightPct"}>Wt%</Th>
                    <Th onClick={() => toggleSort("realizedPnlCents")} active={sortKey === "realizedPnlCents"}>Real P&L</Th>
                    <th>Hold</th><th>Trend</th><th>Rules</th><th>Thesis</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => (
                    <tr key={h.instrumentId} data-selected={h.instrumentId === selected} onClick={() => select(h.instrumentId)}>
                      <td style={{ textAlign: "left" }}>
                        <span style={{ fontWeight: 600, color: "var(--t-text)" }}>{h.symbol}</span>
                        <span className="t-label" style={{ marginLeft: 6 }}>{h.sector ?? ""}</span>
                        {h.isStale && <span className="t-chip t-stale" style={{ marginLeft: 6 }}>stale</span>}
                      </td>
                      <td>{h.qty}</td>
                      <td>{fmtCents(h.avgCostCents)}</td>
                      <td>{fmtCents(h.lastCents)}</td>
                      <td>{fmtCents(h.marketValueCents)}</td>
                      <td className={signCls(h.dayChangePct)}>{pctStr(h.dayChangePct)}</td>
                      <td className={signCls(h.unrealizedPnlCents)}>{h.unrealizedPnlCents > 0 ? "+" : ""}{fmtCents(h.unrealizedPnlCents)}</td>
                      <td>{h.weightPct.toFixed(1)}%</td>
                      <td className={signCls(h.realizedPnlCents)}>{h.realizedPnlCents !== 0 ? `${h.realizedPnlCents > 0 ? "+" : ""}${fmtCents(h.realizedPnlCents)}` : "—"}</td>
                      <td>{h.holdingDays}d</td>
                      <td><Sparkline data={h.spark} /></td>
                      <td style={{ textAlign: "left" }}>
                        {h.rules.length === 0 ? <span className="t-stale">—</span> : h.rules.map((r, i) => (
                          <span key={i} className="t-chip" style={{ marginRight: 3, color: r.kind === "stop" ? "var(--t-loss)" : "var(--t-gain)" }}>
                            {r.kind === "stop" ? "S" : "T"} {fmtCents(r.priceCents)}
                          </span>
                        ))}
                      </td>
                      <td style={{ textAlign: "left" }}>
                        {h.thesis ? (
                          <span className="t-chip" style={{ color: h.thesis.onTrack ? "var(--t-gain)" : h.thesis.onTrack === false ? "var(--t-loss)" : "var(--t-dim)" }}
                            title={h.thesis.text ?? ""}>
                            {h.thesis.progressPct != null ? `${h.thesis.progressPct.toFixed(0)}%` : "set"}
                            {h.thesis.daysRemaining != null ? ` · ${h.thesis.daysRemaining}d` : ""}
                          </span>
                        ) : <span className="t-stale">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* ─────────── ZONE C: Company Deep-Dive ─────────── */}
        <section ref={deepRef} style={{ marginTop: 20, scrollMarginTop: 12 }}>
          {selectedHolding && selectedBundle ? (
            <DeepDive holding={selectedHolding} bundle={selectedBundle} />
          ) : (
            <div className="t-panel t-label" style={{ padding: 24 }}>Select a holding to drill in.</div>
          )}
        </section>

        {/* ─────────── Cross-portfolio analytics ─────────── */}
        <section style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
          <Allocation view={view} onPick={(sym) => {
            const h = view.holdings.find((x) => x.symbol === sym); if (h) select(h.instrumentId);
          }} />
          <Attribution view={view} />
          <RiskPanel view={view} />
          <Benchmark view={view} />
        </section>

        <p className="t-label" style={{ marginTop: 28, lineHeight: 1.5 }}>{disclaimer}</p>
      </div>

      <CommandPalette items={paletteItems} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

/* ---------- small presentational pieces ---------- */

function Metric({ label, value, sub, cls, big }: { label: string; value: string; sub?: string; cls?: string; big?: boolean }) {
  return (
    <div className="t-panel" style={{ padding: "12px 14px" }}>
      <div className="t-label">{label}</div>
      <div className={`t-mono ${cls ?? ""}`} style={{ fontSize: big ? 22 : 16, marginTop: 3 }}>{value}</div>
      {sub && <div className={`t-mono ${cls ?? ""}`} style={{ fontSize: 11, opacity: 0.85 }}>{sub}</div>}
    </div>
  );
}

function Th({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active: boolean }) {
  return <th onClick={onClick} style={{ cursor: "pointer", color: active ? "var(--t-text)" : undefined }}>{children}{active ? " ▾" : ""}</th>;
}

function BwCard({ kind, h, onClick }: { kind: string; h: HoldingRow; onClick: () => void }) {
  return (
    <div className="t-panel" style={{ padding: "10px 14px", cursor: "pointer" }} onClick={onClick}>
      <div className="t-label">{kind}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontWeight: 600 }}>{h.symbol}</span>
        <span className={`t-mono ${signCls(h.dayChangePct)}`}>{pctStr(h.dayChangePct)}</span>
      </div>
    </div>
  );
}

function Donut({ slices }: { slices: { key: string; pct: number; color: string }[] }) {
  let acc = 0;
  const stops = slices.map((s) => {
    const from = acc; acc += s.pct;
    return `${s.color} ${from}% ${acc}%`;
  }).join(", ");
  return (
    <div style={{ width: 112, height: 112, borderRadius: "50%", background: `conic-gradient(${stops})`, position: "relative", flexShrink: 0 }}>
      <div style={{ position: "absolute", inset: 18, borderRadius: "50%", background: "var(--t-panel)" }} />
    </div>
  );
}

const PALETTE = ["#34e89a", "#0fa37f", "#7ee0aa", "#1c9d6f", "#4fd6c0", "#2b8f6a", "#9fe8c8", "#136b4c"];

function Allocation({ view, onPick }: { view: CommandView; onPick: (sym: string) => void }) {
  const slices = view.allocationBySector.map((s, i) => ({ key: s.key, pct: s.pct, color: PALETTE[i % PALETTE.length] }));
  return (
    <div className="t-panel" style={{ padding: 14 }}>
      <div className="t-label" style={{ marginBottom: 10 }}>Allocation by sector</div>
      {slices.length === 0 ? <div className="t-label">No positions.</div> : (
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <Donut slices={slices} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {view.allocationBySector.map((s, i) => (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: PALETTE[i % PALETTE.length], flexShrink: 0 }} />
                <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.key}</span>
                <span className="t-mono" style={{ fontSize: 12 }}>{s.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Attribution({ view }: { view: CommandView }) {
  const ranked = [...view.holdings].filter((h) => h.dayPnlCents != null).sort((a, b) => (b.dayPnlCents! - a.dayPnlCents!));
  const winners = ranked.filter((h) => (h.dayPnlCents ?? 0) > 0).slice(0, 4);
  const losers = ranked.filter((h) => (h.dayPnlCents ?? 0) < 0).slice(-4).reverse();
  const Row = (h: HoldingRow) => (
    <div key={h.instrumentId} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 12 }}>
      <span>{h.symbol}</span>
      <span className={`t-mono ${signCls(h.dayPnlCents)}`}>{(h.dayPnlCents ?? 0) > 0 ? "+" : ""}{fmtCents(h.dayPnlCents ?? 0)}</span>
    </div>
  );
  return (
    <div className="t-panel" style={{ padding: 14 }}>
      <div className="t-label" style={{ marginBottom: 10 }}>Day attribution (contribution)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div><div className="t-label t-gain" style={{ marginBottom: 4 }}>Winners</div>{winners.length ? winners.map(Row) : <span className="t-stale">—</span>}</div>
        <div><div className="t-label t-loss" style={{ marginBottom: 4 }}>Losers</div>{losers.length ? losers.map(Row) : <span className="t-stale">—</span>}</div>
      </div>
    </div>
  );
}

function RiskPanel({ view }: { view: CommandView }) {
  const largest = view.holdings.reduce<HoldingRow | null>((m, h) => (!m || h.weightPct > m.weightPct ? h : m), null);
  return (
    <div className="t-panel" style={{ padding: 14 }}>
      <div className="t-label" style={{ marginBottom: 10 }}>Risk</div>
      <RiskRow label="Invested exposure" value={`${view.investedPct.toFixed(0)}%`} />
      <RiskRow label="Cash buffer" value={`${view.cashPct.toFixed(0)}%`} />
      <RiskRow label="Largest position" value={largest ? `${largest.symbol} · ${largest.weightPct.toFixed(0)}%` : "—"} warn={view.concentrationPct > 20} />
      <RiskRow label="Names held" value={String(view.holdings.length)} />
      <div className="t-label" style={{ marginTop: 8 }}>Portfolio beta needs cached fundamentals (see deep-dive). Correlation/drawdown require deeper bar history.</div>
    </div>
  );
}
function RiskRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12 }}>
      <span className="t-label" style={{ textTransform: "none" }}>{label}</span>
      <span className={`t-mono ${warn ? "t-loss" : ""}`}>{value}</span>
    </div>
  );
}

function Benchmark({ view }: { view: CommandView }) {
  return (
    <div className="t-panel" style={{ padding: 14 }}>
      <div className="t-label" style={{ marginBottom: 10 }}>Benchmark vs SPY <span className="t-chip">SIMULATION</span></div>
      {view.equityCurve.length < 2 ? (
        <div className="t-label">Equity curve appears after the first EOD snapshot.</div>
      ) : (
        <>
          <Sparkline data={view.equityCurve.map((p) => p.equity)} width={260} height={54} />
          <div className="t-label" style={{ marginTop: 8 }}>
            Seed SPY as an instrument so its <span className="t-mono">daily_bars</span> plot alongside this curve;
            alpha is shown honestly and this is paper money — not investment advice.
          </div>
        </>
      )}
    </div>
  );
}
