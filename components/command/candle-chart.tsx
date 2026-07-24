"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi, type Time } from "lightweight-charts";
import type { DeepDiveBar, DeepDiveLevel, DeepDiveTrade } from "@/lib/command-service";

/** SMA over closes; null until the window fills. */
function sma(bars: DeepDiveBar[], period: number) {
  const out: { time: Time; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c;
    if (i >= period) sum -= bars[i - period].c;
    if (i >= period - 1) out.push({ time: bars[i].d as Time, value: sum / period });
  }
  return out;
}

export function CandleChart({
  bars,
  trades,
  levels,
}: {
  bars: DeepDiveBar[];
  trades: DeepDiveTrade[];
  levels: DeepDiveLevel[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || bars.length === 0) return;

    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#7fa694", fontSize: 11 },
      grid: { vertLines: { color: "rgba(28,77,60,0.25)" }, horzLines: { color: "rgba(28,77,60,0.25)" } },
      rightPriceScale: { borderColor: "#12352a" },
      timeScale: { borderColor: "#12352a", timeVisible: false },
      crosshair: { mode: 0 },
    });

    const candle = chart.addCandlestickSeries({
      upColor: "#34e89a", downColor: "#ff5a7a", wickUpColor: "#34e89a", wickDownColor: "#ff5a7a",
      borderVisible: false, priceLineVisible: false,
    });
    candle.setData(bars.map((b) => ({ time: b.d as Time, open: b.o, high: b.h, low: b.l, close: b.c })));

    // Volume subpanel (overlay scale at the bottom).
    const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", color: "#1c4d3c" });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(bars.map((b) => ({ time: b.d as Time, value: b.v, color: b.c >= b.o ? "rgba(52,232,154,0.4)" : "rgba(255,90,122,0.4)" })));

    // SMA overlays.
    if (bars.length > 20) {
      const s20 = chart.addLineSeries({ color: "#7ee0aa", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      s20.setData(sma(bars, 20));
    }
    if (bars.length > 50) {
      const s50 = chart.addLineSeries({ color: "#0fa37f", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      s50.setData(sma(bars, 50));
    }

    // My entry/exit markers.
    if (trades.length) {
      candle.setMarkers(
        trades.map((t) => ({
          time: t.at.slice(0, 10) as Time,
          position: t.side === "buy" ? "belowBar" : "aboveBar",
          color: t.side === "buy" ? "#34e89a" : "#ff5a7a",
          shape: t.side === "buy" ? "arrowUp" : "arrowDown",
          text: `${t.side === "buy" ? "B" : "S"} ${t.qty}${t.automated ? "·auto" : ""}`,
        })) as never,
      );
    }

    // Stop / target lines.
    for (const l of levels) {
      candle.createPriceLine({
        price: l.priceCents / 100,
        color: l.kind === "stop" ? "#ff5a7a" : "#34e89a",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: l.kind.toUpperCase(),
      });
    }

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [bars, trades, levels]);

  if (bars.length === 0) {
    return (
      <div className="t-label" style={{ padding: "48px 0", textAlign: "center" }}>
        No daily bars cached for this name. Finnhub free-tier candles are premium-gated —
        seed <span className="t-mono">daily_bars</span> to populate this chart.
      </div>
    );
  }
  return <div ref={ref} style={{ width: "100%", height: 320 }} />;
}
