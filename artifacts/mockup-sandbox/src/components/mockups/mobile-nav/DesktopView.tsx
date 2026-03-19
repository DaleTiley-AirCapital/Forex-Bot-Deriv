import React, { useState } from "react";
import {
  Activity, BarChart2, Radio, History, Settings,
  Wallet, TrendingUp, ShieldAlert, Database,
  ArrowUpRight, ArrowDownRight, Layers, Zap,
} from "lucide-react";

const DARK = {
  bg: "#0e1120",
  card: "#1a2035",
  sidebar: "#141830",
  sidebarDeep: "linear-gradient(180deg, hsl(228 45% 11%) 0%, hsl(228 42% 9%) 100%)",
  border: "#2a3050",
  muted: "#64748b",
  mutedFg: "#94a3b8",
  primary: "#60a5fa",
  success: "#34d399",
  destructive: "#f87171",
  warning: "#fbbf24",
  violet: "#a78bfa",
  foreground: "#e8edf5",
};

const NAV = [
  { id: "overview",  label: "Overview",  icon: Activity },
  { id: "research",  label: "Research",  icon: BarChart2 },
  { id: "signals",   label: "Signals",   icon: Radio },
  { id: "trades",    label: "Trades",    icon: History },
  { id: "risk",      label: "Risk",      icon: ShieldAlert },
  { id: "data",      label: "Data",      icon: Database },
  { id: "settings",  label: "Settings",  icon: Settings },
];

function NavLink({ item, active, onClick }: { item: typeof NAV[0]; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "9px 12px",
        background: active ? `${DARK.primary}12` : "none",
        border: "none",
        borderLeft: active ? `2px solid ${DARK.primary}` : "2px solid transparent",
        borderRadius: "0 8px 8px 0",
        cursor: "pointer", textAlign: "left",
        position: "relative",
      }}
    >
      <Icon size={15} color={active ? DARK.primary : DARK.muted} style={{ flexShrink: 0 }} />
      <span style={{ color: active ? DARK.primary : DARK.mutedFg, fontSize: 13.5, fontWeight: active ? 600 : 400 }}>
        {item.label}
      </span>
    </button>
  );
}

function KpiCard({ label, value, sub, accent, color, icon: Icon }: {
  label: string; value: string; sub: string;
  accent: string; color?: string; icon: React.ElementType;
}) {
  return (
    <div style={{
      background: DARK.card, border: `1px solid ${DARK.border}`,
      borderLeft: `3px solid ${accent}`, borderRadius: 12, padding: "16px 18px",
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <p style={{ color: DARK.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600 }}>
          {label}
        </p>
        <div style={{ width: 28, height: 28, background: `${accent}15`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={13} color={accent} />
        </div>
      </div>
      <p style={{ color: color || DARK.foreground, fontSize: 24, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", lineHeight: 1 }}>
        {value}
      </p>
      <p style={{ color: DARK.muted, fontSize: 11 }}>{sub}</p>
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      paddingBottom: 10, marginBottom: 10, borderBottom: `1px solid ${DARK.border}40`,
    }}>
      <span style={{ color: DARK.muted, fontSize: 12.5 }}>{label}</span>
      <span style={{
        background: ok ? `${DARK.success}18` : `${DARK.muted}15`,
        color: ok ? DARK.success : DARK.muted,
        borderRadius: 5, padding: "2px 9px", fontSize: 10, fontWeight: 600,
      }}>
        {ok ? "Active" : "Off"}
      </span>
    </div>
  );
}

function RowStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      paddingBottom: 10, marginBottom: 10, borderBottom: `1px solid ${DARK.border}40`,
    }}>
      <span style={{ color: DARK.muted, fontSize: 12.5 }}>{label}</span>
      <span style={{ color: color || DARK.foreground, fontSize: 12.5, fontFamily: "monospace", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const SIGNALS = [
  { sym: "BOOM1000", dir: "BUY",  conf: 87, strat: "Trend Pullback",     time: "18:24:01" },
  { sym: "CRASH500", dir: "SELL", conf: 74, strat: "Exhaustion Rebound", time: "18:21:48" },
  { sym: "VOL75",    dir: "BUY",  conf: 91, strat: "Volatility Breakout",time: "18:19:33" },
  { sym: "BOOM500",  dir: "SELL", conf: 62, strat: "Spike Hazard",       time: "18:15:09" },
];

export function DesktopView() {
  const [active, setActive] = useState("overview");

  return (
    <div style={{
      width: 1280, height: 800,
      background: DARK.bg, fontFamily: "Inter, sans-serif",
      display: "flex", overflow: "hidden",
    }}>
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside style={{
        width: 220, flexShrink: 0, display: "flex", flexDirection: "column",
        borderRight: `1px solid ${DARK.border}`,
        background: DARK.sidebarDeep,
        boxShadow: `2px 0 20px rgba(0,0,0,0.5), inset -1px 0 0 rgba(255,255,255,0.04)`,
      }}>
        {/* Logo */}
        <div style={{ height: 56, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", borderBottom: `1px solid ${DARK.border}50` }}>
          <div style={{ width: 28, height: 28, background: `${DARK.primary}20`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <TrendingUp size={14} color={DARK.primary} />
          </div>
          <div>
            <p style={{ color: DARK.foreground, fontSize: 13.5, fontWeight: 700, lineHeight: 1 }}>Deriv Quant</p>
            <p style={{ color: DARK.muted, fontSize: 10, marginTop: 2 }}>Research Platform</p>
          </div>
        </div>

        {/* Mode chip */}
        <div style={{ padding: "10px 18px", borderBottom: `1px solid ${DARK.border}40`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: DARK.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600 }}>System</span>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: DARK.warning, display: "inline-block" }} />
            <span style={{ color: DARK.warning, fontSize: 10, fontWeight: 700 }}>PAPER</span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, overflowY: "auto", padding: "8px 6px", display: "flex", flexDirection: "column", gap: 1 }}>
          {NAV.map((item) => (
            <NavLink key={item.id} item={item} active={active === item.id} onClick={() => setActive(item.id)} />
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: "12px 18px", borderTop: `1px solid ${DARK.border}40` }}>
          <p style={{ color: `${DARK.muted}50`, fontSize: 9, fontFamily: "monospace", textAlign: "center" }}>v0.1.0</p>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Paper mode banner */}
        <div style={{
          height: 30, background: `${DARK.warning}10`, borderBottom: `1px solid ${DARK.warning}20`,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 0,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: DARK.warning, display: "inline-block" }} />
          <span style={{ color: DARK.warning, fontSize: 10, fontWeight: 700, letterSpacing: "0.15em" }}>
            PAPER TRADING — SIMULATED POSITIONS
          </span>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "22px 28px" }}>

          {active === "overview" ? (
            <>
              {/* Page header */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
                <div>
                  <h1 style={{ color: DARK.foreground, fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: -0.4 }}>Dashboard</h1>
                  <p style={{ color: DARK.muted, fontSize: 12, marginTop: 4 }}>Last sync: 18:26:48</p>
                </div>
                {/* Account chip */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: DARK.card, border: `1px solid ${DARK.border}`, borderRadius: 10, padding: "8px 14px",
                }}>
                  <Wallet size={14} color={DARK.primary} />
                  <div>
                    <p style={{ color: DARK.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>VRTC15298516 · Virtual</p>
                    <p style={{ color: DARK.foreground, fontSize: 14, fontWeight: 700, fontFamily: "monospace", marginTop: 2 }}>USD 10,000.00</p>
                  </div>
                  <div style={{ width: 1, height: 32, background: DARK.border, margin: "0 4px" }} />
                  {[["Equity", "10,000.00"], ["Free Margin", "10,000.00"]].map(([l, v]) => (
                    <div key={l} style={{ textAlign: "right" }}>
                      <p style={{ color: DARK.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em" }}>{l}</p>
                      <p style={{ color: DARK.foreground, fontSize: 11, fontFamily: "monospace", fontWeight: 600, marginTop: 2 }}>{v}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* KPI row — 4 across */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
                <KpiCard label="Available Capital" value="$25,000" sub="Balanced allocation"    accent={DARK.primary}     icon={Wallet} />
                <KpiCard label="Realised P&L"      value="-$599.52" sub="Win rate: 0.4%"       accent={DARK.destructive} color={DARK.destructive} icon={ArrowDownRight} />
                <KpiCard label="Open Risk"         value="0.00%"   sub="0 open positions"      accent={DARK.warning}     icon={ShieldAlert} />
                <KpiCard label="Active Strategies" value="4 Active" sub="Model: Trained"       accent={DARK.violet}      icon={Layers} />
              </div>

              {/* Three-column second row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>

                {/* Portfolio */}
                <div style={{ background: DARK.card, border: `1px solid ${DARK.border}`, borderRadius: 12, padding: "16px 18px" }}>
                  <p style={{ color: DARK.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600, marginBottom: 14 }}>Portfolio</p>
                  <RowStat label="Balance"    value="$10,000.00" />
                  <RowStat label="Daily P&L"  value="-$1,191.16" color={DARK.destructive} />
                  <RowStat label="Drawdown"   value="11.9%"      color={DARK.destructive} />
                  <RowStat label="Total Trades" value="10" />
                  <RowStat label="Sharpe Ratio" value="0.83" />
                </div>

                {/* System status */}
                <div style={{ background: DARK.card, border: `1px solid ${DARK.border}`, borderRadius: 12, padding: "16px 18px" }}>
                  <p style={{ color: DARK.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600, marginBottom: 14 }}>System Status</p>
                  <StatusBadge ok={true}  label="Data Stream" />
                  <StatusBadge ok={true}  label="Risk Engine" />
                  <StatusBadge ok={true}  label="Deriv API" />
                  <StatusBadge ok={false} label="Kill Switch" />
                  <StatusBadge ok={true}  label="Signal Scanner" />
                </div>

                {/* Recent Signals */}
                <div style={{ background: DARK.card, border: `1px solid ${DARK.border}`, borderRadius: 12, padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                    <p style={{ color: DARK.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600 }}>Recent Signals</p>
                    <Zap size={12} color={DARK.primary} />
                  </div>
                  {SIGNALS.map((s, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      paddingBottom: 10, marginBottom: 10,
                      borderBottom: i < SIGNALS.length - 1 ? `1px solid ${DARK.border}40` : "none",
                    }}>
                      <span style={{
                        background: s.dir === "BUY" ? `${DARK.success}18` : `${DARK.destructive}18`,
                        color: s.dir === "BUY" ? DARK.success : DARK.destructive,
                        borderRadius: 4, padding: "1px 6px", fontSize: 9, fontWeight: 700, flexShrink: 0,
                      }}>{s.dir}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ color: DARK.foreground, fontSize: 11.5, fontWeight: 600, fontFamily: "monospace" }}>{s.sym}</p>
                        <p style={{ color: DARK.muted, fontSize: 10, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.strat}</p>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <p style={{ color: s.conf >= 80 ? DARK.success : s.conf >= 65 ? DARK.warning : DARK.muted, fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>{s.conf}%</p>
                        <p style={{ color: DARK.muted, fontSize: 9, marginTop: 1 }}>{s.time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            /* Placeholder for other pages */
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, gap: 14 }}>
              {(() => {
                const item = NAV.find((n) => n.id === active);
                const Icon = item ? item.icon : Activity;
                return (
                  <>
                    <div style={{ width: 52, height: 52, background: `${DARK.primary}15`, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon size={24} color={DARK.primary} />
                    </div>
                    <p style={{ color: DARK.foreground, fontSize: 18, fontWeight: 600 }}>{item?.label}</p>
                    <p style={{ color: DARK.muted, fontSize: 13 }}>Page content goes here</p>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
