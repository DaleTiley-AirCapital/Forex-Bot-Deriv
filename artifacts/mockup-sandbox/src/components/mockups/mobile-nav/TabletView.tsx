import React, { useState } from "react";
import {
  Activity, BarChart2, Radio, History, Settings,
  Wallet, TrendingUp, ShieldAlert, Database, MoreHorizontal, X,
} from "lucide-react";

const DARK = {
  bg: "#0e1120",
  card: "#1a2035",
  sidebar: "#141830",
  border: "#2a3050",
  muted: "#64748b",
  mutedFg: "#94a3b8",
  primary: "#60a5fa",
  success: "#34d399",
  destructive: "#f87171",
  warning: "#fbbf24",
  foreground: "#e8edf5",
};

const RAIL = [
  { id: "overview",  label: "Overview",  icon: Activity },
  { id: "signals",   label: "Signals",   icon: Radio },
  { id: "trades",    label: "Trades",    icon: History },
  { id: "research",  label: "Research",  icon: BarChart2 },
  { id: "risk",      label: "Risk",      icon: ShieldAlert },
  { id: "data",      label: "Data",      icon: Database },
  { id: "settings",  label: "Settings",  icon: Settings },
];

function RailItem({ item, active, onClick }: { item: typeof RAIL[0]; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      title={item.label}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
        width: "100%",
        padding: "12px 0",
        background: active ? `${DARK.primary}15` : "none",
        border: "none",
        borderLeft: active ? `3px solid ${DARK.primary}` : "3px solid transparent",
        cursor: "pointer",
      }}
    >
      <Icon size={20} color={active ? DARK.primary : DARK.muted} />
      <span style={{ color: active ? DARK.primary : DARK.muted, fontSize: 9, fontWeight: active ? 700 : 400, letterSpacing: 0.3 }}>
        {item.label}
      </span>
    </button>
  );
}

function OverviewContent() {
  return (
    <>
      {/* Account card */}
      <div style={{ background: DARK.card, border: `1px solid ${DARK.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Wallet size={16} color={DARK.primary} />
            <div>
              <p style={{ color: DARK.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>VRTC15298516 · Virtual</p>
              <p style={{ color: DARK.foreground, fontSize: 20, fontWeight: 700, fontFamily: "monospace", marginTop: 4 }}>USD 10,000.00</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            {[["Equity", "10,000.00"], ["Free Margin", "10,000.00"]].map(([l, v]) => (
              <div key={l} style={{ textAlign: "right" }}>
                <p style={{ color: DARK.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>{l}</p>
                <p style={{ color: DARK.foreground, fontSize: 13, fontFamily: "monospace", fontWeight: 600, marginTop: 2 }}>{v}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* KPIs — 4-col on tablet */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
        {[
          { label: "Available Capital", value: "$25,000", sub: "Balanced mode",  accent: DARK.primary, color: undefined },
          { label: "Realised P&L",      value: "-$599.52", sub: "Win rate 0.4%", accent: DARK.destructive, color: DARK.destructive },
          { label: "Open Risk",         value: "0.00%",    sub: "0 positions",   accent: DARK.warning, color: undefined },
          { label: "Strategies",        value: "4 Active", sub: "Model trained", accent: "#a78bfa", color: undefined },
        ].map(({ label, value, sub, accent, color }) => (
          <div key={label} style={{ background: DARK.card, border: `1px solid ${DARK.border}`, borderLeft: `3px solid ${accent}`, borderRadius: 12, padding: "12px 14px" }}>
            <p style={{ color: DARK.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>{label}</p>
            <p style={{ color: color || DARK.foreground, fontSize: 17, fontWeight: 700, fontFamily: "monospace", marginTop: 4 }}>{value}</p>
            <p style={{ color: DARK.muted, fontSize: 10, marginTop: 4 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Portfolio + System side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: DARK.card, border: `1px solid ${DARK.border}`, borderRadius: 12, padding: "14px 16px" }}>
          <p style={{ color: DARK.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 10 }}>Portfolio</p>
          {[
            { l: "Balance",   v: "$10,000.00", c: undefined },
            { l: "Daily P&L", v: "-$1,191.16", c: DARK.destructive },
            { l: "Drawdown",  v: "11.9%",      c: DARK.destructive },
            { l: "Total Trades", v: "10",       c: undefined },
          ].map(({ l, v, c }) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 9, marginBottom: 9, borderBottom: `1px solid ${DARK.border}40` }}>
              <span style={{ color: DARK.muted, fontSize: 12 }}>{l}</span>
              <span style={{ color: c || DARK.foreground, fontSize: 12, fontFamily: "monospace", fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>

        <div style={{ background: DARK.card, border: `1px solid ${DARK.border}`, borderRadius: 12, padding: "14px 16px" }}>
          <p style={{ color: DARK.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 10 }}>System Status</p>
          {[
            { l: "Data Stream",  ok: true },
            { l: "Risk Engine",  ok: true },
            { l: "Deriv API",    ok: true },
            { l: "Kill Switch",  ok: false },
          ].map(({ l, ok }) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 9, marginBottom: 9, borderBottom: `1px solid ${DARK.border}40` }}>
              <span style={{ color: DARK.muted, fontSize: 12 }}>{l}</span>
              <span style={{ background: ok ? `${DARK.success}20` : `${DARK.muted}15`, color: ok ? DARK.success : DARK.muted, borderRadius: 5, padding: "2px 8px", fontSize: 10, fontWeight: 600 }}>
                {ok ? "Online" : "Off"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function PlaceholderPage({ id }: { id: string }) {
  const item = RAIL.find((n) => n.id === id);
  const label = item ? item.label : id;
  const Icon = item ? item.icon : Activity;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 280, gap: 12 }}>
      <div style={{ width: 48, height: 48, background: `${DARK.primary}15`, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={22} color={DARK.primary} />
      </div>
      <p style={{ color: DARK.foreground, fontSize: 16, fontWeight: 600 }}>{label}</p>
      <p style={{ color: DARK.muted, fontSize: 13 }}>Page content goes here</p>
    </div>
  );
}

export function TabletView() {
  const [active, setActive] = useState("overview");

  return (
    <div style={{ width: 780, height: 790, background: DARK.bg, fontFamily: "Inter, sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Top bar */}
      <div style={{ height: 50, background: DARK.sidebar, borderBottom: `1px solid ${DARK.border}`, display: "flex", alignItems: "center", flexShrink: 0, paddingRight: 16 }}>
        {/* Logo area — same width as rail */}
        <div style={{ width: 68, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", borderRight: `1px solid ${DARK.border}`, flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, background: `${DARK.primary}20`, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <TrendingUp size={14} color={DARK.primary} />
          </div>
        </div>

        {/* Title */}
        <div style={{ padding: "0 16px", flex: 1 }}>
          <p style={{ color: DARK.foreground, fontSize: 13, fontWeight: 700, lineHeight: 1 }}>Deriv Quant</p>
          <p style={{ color: DARK.muted, fontSize: 10, marginTop: 2 }}>Research Platform</p>
        </div>

        {/* Mode + balance */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, background: `${DARK.warning}15`, border: `1px solid ${DARK.warning}30`, borderRadius: 20, padding: "4px 10px" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: DARK.warning, display: "inline-block" }} />
            <span style={{ color: DARK.warning, fontSize: 10, fontWeight: 700 }}>PAPER</span>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ color: DARK.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>Balance</p>
            <p style={{ color: DARK.foreground, fontSize: 13, fontFamily: "monospace", fontWeight: 700, marginTop: 1 }}>USD 10,000.00</p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Icon rail */}
        <div style={{ width: 68, flexShrink: 0, background: DARK.sidebar, borderRight: `1px solid ${DARK.border}`, display: "flex", flexDirection: "column", paddingTop: 8, overflowY: "auto" }}>
          {RAIL.map((item) => (
            <RailItem key={item.id} item={item} active={active === item.id} onClick={() => setActive(item.id)} />
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
          <div style={{ marginBottom: 16 }}>
            <h1 style={{ color: DARK.foreground, fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>
              {active === "overview" ? "Dashboard" : active.charAt(0).toUpperCase() + active.slice(1)}
            </h1>
            <p style={{ color: DARK.muted, fontSize: 11, marginTop: 3 }}>Last sync: 18:26:48</p>
          </div>
          {active === "overview" ? <OverviewContent /> : <PlaceholderPage id={active} />}
        </div>
      </div>
    </div>
  );
}
