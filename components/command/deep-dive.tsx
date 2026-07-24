"use client";

import { useState } from "react";
import { fmtCents } from "@/lib/money";
import type { DeepDiveBundle, HoldingRow, Fundamentals } from "@/lib/command-service";
import { CandleChart } from "./candle-chart";

const TABS = ["Chart", "Fundamentals", "My history", "News & events", "Automation"] as const;
type Tab = (typeof TABS)[number];

function pnl(cents: number) {
  const cls = cents > 0 ? "t-gain" : cents < 0 ? "t-loss" : "";
  return <span className={`t-mono ${cls}`}>{cents > 0 ? "+" : ""}{fmtCents(cents)}</span>;
}

/** A labeled fundamental cell. Missing free-tier fields render an explained "—". */
function Field({ label, value, missingWhy }: { label: string; value: string | null; missingWhy?: string }) {
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid var(--t-line)" }}>
      <div className="t-label">{label}</div>
      {value != null ? (
        <div className="t-mono" style={{ fontSize: 13, marginTop: 2 }}>{value}</div>
      ) : (
        <div className="t-mono t-stale" title={missingWhy ?? "Not provided on the current data tier"} style={{ fontSize: 13, marginTop: 2 }}>—</div>
      )}
    </div>
  );
}

function FundamentalsTab({ f }: { f: Fundamentals | null }) {
  if (!f) {
    return (
      <div className="t-label" style={{ padding: "24px 0" }}>
        No fundamentals cached yet. The <span className="t-mono">refresh-fundamentals</span> cron
        (daily) populates this from Finnhub <span className="t-mono">/stock/profile2</span> and{" "}
        <span className="t-mono">/stock/metric</span>. Fields the free tier omits stay labeled, never faked.
      </div>
    );
  }
  const money = (c: number | null) => (c != null ? fmtCents(c) : null);
  const pct = (v: number | null) => (v != null ? `${v.toFixed(2)}%` : null);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0 20px" }}>
        <Field label="Sector" value={f.sector} />
        <Field label="Market cap" value={money(f.marketCapCents)} />
        <Field label="P/E" value={f.pe != null ? f.pe.toFixed(2) : null} missingWhy="Sparse on Finnhub free tier" />
        <Field label="EPS" value={money(f.epsCents)} missingWhy="Sparse on Finnhub free tier" />
        <Field label="Beta" value={f.beta != null ? f.beta.toFixed(2) : null} missingWhy="Sparse on Finnhub free tier" />
        <Field label="Dividend yield" value={pct(f.dividendYield)} />
        <Field label="52-wk high" value={money(f.high52wCents)} />
        <Field label="52-wk low" value={money(f.low52wCents)} />
        <Field label="Gross margin" value={pct(f.grossMargin)} />
        <Field label="Net margin" value={pct(f.netMargin)} />
      </div>
      <div className="t-label" style={{ marginTop: 10 }}>
        {f.isPartial ? "Partial — some fields not exposed by the free tier. " : ""}
        {f.fetchedAt ? `As of ${new Date(f.fetchedAt).toLocaleString()}` : ""}
      </div>
    </div>
  );
}

export function DeepDive({ holding, bundle }: { holding: HoldingRow; bundle: DeepDiveBundle }) {
  const [tab, setTab] = useState<Tab>("Chart");

  return (
    <div className="t-panel" style={{ padding: 0 }}>
      {/* Header quote strip */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", padding: "12px 16px", borderBottom: "1px solid var(--t-line-2)" }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>{holding.symbol}</div>
        <div className="t-label" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{holding.name ?? ""}</div>
        <div className="t-mono" style={{ fontSize: 16 }}>{fmtCents(holding.lastCents)}</div>
        {holding.dayChangePct != null && (
          <div className={`t-mono ${holding.dayChangePct >= 0 ? "t-gain" : "t-loss"}`}>
            {holding.dayChangePct >= 0 ? "+" : ""}{holding.dayChangePct.toFixed(2)}% today
          </div>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {holding.isDelayed && <span className="t-chip">DELAYED</span>}
          {holding.isStale && <span className="t-chip t-stale">STALE</span>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--t-line)", overflowX: "auto" }}>
        {TABS.map((t) => (
          <div key={t} className="t-tab" data-active={tab === t} onClick={() => setTab(t)} role="tab" tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setTab(t)}>
            {t}
          </div>
        ))}
      </div>

      <div style={{ padding: 16 }}>
        {tab === "Chart" && <CandleChart bars={bundle.bars} trades={bundle.trades} levels={bundle.levels} />}

        {tab === "Fundamentals" && <FundamentalsTab f={bundle.fundamentals} />}

        {tab === "My history" && (
          <div>
            {bundle.trades.length === 0 ? (
              <div className="t-label">No trades recorded in this name.</div>
            ) : (
              <table className="t-grid">
                <thead><tr><th>Date</th><th>Side</th><th>Qty</th><th>Price</th><th>Source</th></tr></thead>
                <tbody>
                  {bundle.trades.map((t, i) => (
                    <tr key={i} style={{ cursor: "default" }}>
                      <td>{t.at.slice(0, 10)}</td>
                      <td className={t.side === "buy" ? "t-gain" : "t-loss"}>{t.side.toUpperCase()}</td>
                      <td>{t.qty}</td>
                      <td>{fmtCents(t.priceCents)}</td>
                      <td>{t.automated ? "auto" : "manual"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {bundle.theses.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="t-label" style={{ marginBottom: 6 }}>Recorded thesis · did it play out?</div>
                {bundle.theses.map((th, i) => (
                  <div key={i} className="t-panel" style={{ padding: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 12 }}>{th.text ?? <span className="t-label">no thesis text</span>}</div>
                    <div className="t-label" style={{ marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
                      {th.targetCents != null && <span>target {fmtCents(th.targetCents)}</span>}
                      {th.horizonDays != null && <span>{th.horizonDays}d horizon</span>}
                      {th.targetHit != null && <span className={th.targetHit ? "t-gain" : "t-loss"}>{th.targetHit ? "target hit" : "missed"}</span>}
                      {th.realizedPnlCents != null && <span>realized {pnl(th.realizedPnlCents)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "News & events" && (
          <div>
            <div className="t-panel" style={{ padding: 10, marginBottom: 12 }}>
              <span className="t-label">Next earnings</span>{" "}
              {bundle.nextEarnings?.available && bundle.nextEarnings.date ? (
                <span className="t-mono">{bundle.nextEarnings.date}</span>
              ) : (
                <span className="t-mono t-stale" title="Earnings calendar is premium-gated on the free tier">not available on current data tier</span>
              )}
            </div>
            {bundle.news.length === 0 ? (
              <div className="t-label">
                No headlines cached. The <span className="t-mono">refresh-news</span> cron pulls Finnhub{" "}
                <span className="t-mono">/company-news</span>; each headline is attributed and timestamped.
              </div>
            ) : (
              bundle.news.map((n, i) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--t-line)" }}>
                  <div style={{ fontSize: 12 }}>
                    {n.url ? <a href={n.url} target="_blank" rel="noreferrer" style={{ color: "var(--t-text)" }}>{n.headline}</a> : n.headline}
                  </div>
                  <div className="t-label" style={{ marginTop: 3 }}>{n.source ?? "source"} · {new Date(n.publishedAt).toLocaleString()}</div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "Automation" && (
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {holding.rules.length === 0 && <span className="t-label">No armed rules on this name.</span>}
              {holding.rules.map((r, i) => (
                <span key={i} className="t-chip">
                  {r.kind === "stop" ? "STOP" : "TGT"} {fmtCents(r.priceCents)}
                </span>
              ))}
              <a href="/rules" className="t-chip" style={{ marginLeft: "auto", color: "var(--t-gain)", borderColor: "var(--t-line-2)" }}>+ add bracket →</a>
            </div>
            {bundle.events.length === 0 ? (
              <div className="t-label">No rule events logged for this name.</div>
            ) : (
              <table className="t-grid">
                <thead><tr><th>When</th><th>Decision</th><th>Price</th><th>Reason</th></tr></thead>
                <tbody>
                  {bundle.events.slice(0, 20).map((ev, i) => (
                    <tr key={i} style={{ cursor: "default" }}>
                      <td>{new Date(ev.at).toLocaleString()}</td>
                      <td className={ev.decision === "triggered" ? "t-gain" : ev.decision === "blocked" ? "t-loss" : ""}>{ev.decision}</td>
                      <td className={ev.stale ? "t-stale" : ""}>{ev.priceCents != null ? fmtCents(ev.priceCents) : "—"}</td>
                      <td style={{ textAlign: "left", maxWidth: 280, whiteSpace: "normal" }}>{ev.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
