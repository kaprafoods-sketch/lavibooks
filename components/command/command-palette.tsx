"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

/** Cmd/Ctrl-K command palette: fuzzy jump to a ticker or run an action. */
export function CommandPalette({ items, open, onClose }: { items: PaletteItem[]; open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      // focus after paint
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((it) => `${it.label} ${it.hint ?? ""} ${it.group}`.toLowerCase().includes(s));
  }, [q, items]);

  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered, active]);

  if (!open) return null;

  const choose = (it?: PaletteItem) => {
    if (!it) return;
    it.run();
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(2,10,7,0.6)", backdropFilter: "blur(2px)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "14vh" }}
    >
      <div className="t-panel" onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 92vw)", padding: 0, overflow: "hidden", background: "var(--t-panel)" }}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); choose(filtered[active]); }
            else if (e.key === "Escape") onClose();
          }}
          placeholder="Jump to a ticker, or run an action…"
          className="t-mono"
          style={{ width: "100%", padding: "14px 16px", background: "transparent", border: "none", borderBottom: "1px solid var(--t-line-2)", color: "var(--t-text)", fontSize: 14, outline: "none" }}
        />
        <div style={{ maxHeight: "48vh", overflowY: "auto" }}>
          {filtered.length === 0 && <div className="t-label" style={{ padding: 16 }}>No matches.</div>}
          {filtered.map((it, i) => (
            <div
              key={it.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(it)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", cursor: "pointer", background: i === active ? "var(--t-panel-2)" : "transparent" }}
            >
              <span className="t-chip">{it.group}</span>
              <span style={{ fontSize: 13 }}>{it.label}</span>
              {it.hint && <span className="t-label" style={{ marginLeft: "auto" }}>{it.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
