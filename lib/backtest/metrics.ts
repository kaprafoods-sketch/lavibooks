import type { Cents } from "../money";

/**
 * Backtest performance metrics computed from a daily equity curve (cents).
 * Sharpe uses daily returns and a configurable annual risk-free rate
 * (default 0%). These are documented approximations, not audited figures.
 */

export interface BacktestMetrics {
  startEquityCents: Cents;
  endEquityCents: Cents;
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  winRatePct: number; // fraction of positive-return days
  sharpe: number; // annualized
  tradingDays: number;
}

const TRADING_DAYS_PER_YEAR = 252;

export function computeMetrics(
  equityCurveCents: Cents[],
  annualRiskFreeRate = 0,
): BacktestMetrics {
  const n = equityCurveCents.length;
  if (n < 2) {
    const v = equityCurveCents[0] ?? 0;
    return {
      startEquityCents: v, endEquityCents: v, totalReturnPct: 0, cagrPct: 0,
      maxDrawdownPct: 0, winRatePct: 0, sharpe: 0, tradingDays: n,
    };
  }

  const start = equityCurveCents[0];
  const end = equityCurveCents[n - 1];
  const totalReturn = start === 0 ? 0 : end / start - 1;

  // Daily simple returns.
  const rets: number[] = [];
  for (let i = 1; i < n; i++) {
    const prev = equityCurveCents[i - 1];
    rets.push(prev === 0 ? 0 : equityCurveCents[i] / prev - 1);
  }

  // CAGR over the number of trading days elapsed.
  const years = (n - 1) / TRADING_DAYS_PER_YEAR;
  const cagr = years > 0 && start > 0 ? Math.pow(end / start, 1 / years) - 1 : 0;

  // Max drawdown on the equity curve.
  let peak = equityCurveCents[0];
  let maxDd = 0;
  for (const v of equityCurveCents) {
    if (v > peak) peak = v;
    if (peak > 0) maxDd = Math.max(maxDd, (peak - v) / peak);
  }

  // Win rate = share of positive-return days.
  const wins = rets.filter((r) => r > 0).length;
  const winRate = rets.length ? wins / rets.length : 0;

  // Sharpe: (mean excess daily return / stdev) annualized by sqrt(252).
  const rfDaily = annualRiskFreeRate / TRADING_DAYS_PER_YEAR;
  const mean = rets.reduce((a, r) => a + r, 0) / rets.length;
  const variance =
    rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
  const std = Math.sqrt(variance);
  const sharpe = std === 0 ? 0 : ((mean - rfDaily) / std) * Math.sqrt(TRADING_DAYS_PER_YEAR);

  return {
    startEquityCents: start,
    endEquityCents: end,
    totalReturnPct: totalReturn * 100,
    cagrPct: cagr * 100,
    maxDrawdownPct: maxDd * 100,
    winRatePct: winRate * 100,
    sharpe,
    tradingDays: n,
  };
}
