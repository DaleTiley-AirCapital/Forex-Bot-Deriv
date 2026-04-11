import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown, ChevronRight, TrendingUp, Package, Calendar, Zap,
  Database, Brain, Shield, Target, Activity, BarChart3, Radio,
  AlertTriangle, CheckCircle, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui-elements";

const BASE = import.meta.env.BASE_URL || "/";

interface ReleaseEntry {
  version: string;
  date: string;
  title: string;
  changes: string[];
}
interface VersionInfo {
  name: string;
  version: string;
  lastUpdated: string;
  releases: ReleaseEntry[];
}

interface FaqItem {
  q: string;
  a: string;
  icon?: React.ReactNode;
}

const ENGINES: { name: string; symbol: string; desc: string; direction: "up" | "down" | "both" }[] = [
  { name: "Boom Expansion",   symbol: "BOOM300",  direction: "up",   desc: "Enters on spike-surge events. Multi-window score confirmation required. Targets the expansion leg following a Boom spike cluster." },
  { name: "Crash Expansion",  symbol: "CRASH300", direction: "down", desc: "Enters on spike-drop events. Mirrors Boom Expansion but for Crash indices. Targets the continuation sell-off after a Crash spike cluster." },
  { name: "R75 Continuation", symbol: "R_75",     direction: "both", desc: "Follows high-momentum trends on Volatility 75. Enters in the direction of the dominant trend after a mean-to-range confirmation." },
  { name: "R75 Reversal",     symbol: "R_75",     direction: "both", desc: "Fades exhausted moves on Volatility 75. Enters counter-trend at extreme range positions where MA deviation is maximum." },
  { name: "R75 Breakout",     symbol: "R_75",     direction: "both", desc: "Captures ATR-surge breakouts on Volatility 75. Triggers when range expansion score exceeds volatility profile threshold." },
  { name: "R100 Continuation",symbol: "R_100",    direction: "both", desc: "High-momentum trend following on Volatility 100 — similar to R75 Continuation but calibrated for the higher-volatility index." },
  { name: "R100 Reversal",    symbol: "R_100",    direction: "both", desc: "Exhaustion reversal on Volatility 100. Uses same 5-dimension score; Real threshold is higher due to higher position sizing." },
  { name: "R100 Breakout",    symbol: "R_100",    direction: "both", desc: "ATR-burst range breakout on Volatility 100. Looks for volatility squeeze followed by expansion with directional confirmation." },
];

const SCORE_GATES: { mode: string; threshold: number; color: string }[] = [
  { mode: "Paper",  threshold: 80, color: "text-amber-400" },
  { mode: "Demo",   threshold: 85, color: "text-blue-400" },
  { mode: "Real",   threshold: 90, color: "text-red-400" },
];

const FAQ_ITEMS: FaqItem[] = [
  {
    q: "What does 'Interpolated' mean in the Data page?",
    a: "When tick-derived candle data has gaps (e.g. no ticks arrived for a minute), the system inserts synthetic interpolated candles to maintain time continuity. These are not real market data — they are filled from the previous real close. The system discards signals if too many interpolated candles are detected in the evaluation window. Use Diagnostics → Integrity to find and repair them.",
    icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
  },
  {
    q: "What is the difference between Paper, Demo, and Real modes?",
    a: "Paper mode uses simulated orders against paper capital — no Deriv account required. Demo mode sends real orders to Deriv's virtual/demo account. Real mode sends live orders using real capital. Each mode has its own score threshold: Paper ≥80, Demo ≥85, Real ≥90.",
    icon: <Shield className="w-4 h-4 text-primary" />,
  },
  {
    q: "Why did a high-scoring signal get blocked?",
    a: "A signal passes the engine's composite score but may still be blocked by system gates: kill switch active, daily or weekly loss limit reached, maximum drawdown exceeded, open risk limit hit, maximum concurrent trades reached, AI disagreement, or trading mode not active. The Engine Decisions page explains each blocking gate with the specific reason.",
    icon: <Zap className="w-4 h-4 text-primary" />,
  },
  {
    q: "What are the 5 scoring dimensions?",
    a: "Range Position (how far price is in the recent range), MA Deviation (distance from moving average), Volatility Profile (current volatility vs historical percentile), Range Expansion (candle range vs ATR), Directional Confirmation (price action in signal direction). All five combine into a single Composite Score (0–100).",
    icon: <BarChart3 className="w-4 h-4 text-primary" />,
  },
  {
    q: "What are the TP/SL targets?",
    a: "Take profit is set to capture 50–200%+ moves. The trailing stop is a safety net (default 30%) that only triggers once price has moved significantly in your favour. The 72-hour profitable exit rule closes trades after 72 hours if they're profitable but haven't hit TP — this is a capital efficiency backstop, not the primary exit.",
    icon: <Target className="w-4 h-4 text-primary" />,
  },
  {
    q: "Why is 'Streaming' offline for some symbols?",
    a: "Streaming means the server is actively receiving real-time ticks from Deriv's API for that symbol. It requires a valid Deriv API token (Settings → Account Tokens). The 4 active trading symbols (CRASH300, BOOM300, R_75, R_100) should be streaming during active hours. Other symbols may be idle — they have historical candle data but no live tick feed.",
    icon: <Radio className="w-4 h-4 text-green-400" />,
  },
  {
    q: "What is 'Pending Confirmation'?",
    a: "Some engines require a signal to appear in multiple consecutive evaluation windows before firing an entry. This reduces false positives. A 'Pending' signal is one that has crossed the composite threshold but hasn't yet accumulated the required number of consecutive confirmations. The Engine Decisions page shows these in the Awaiting Confirmation panel.",
    icon: <Clock className="w-4 h-4 text-amber-400" />,
  },
  {
    q: "What does the AI Verdict mean?",
    a: "After the engine scores a signal above threshold, an OpenAI model independently evaluates it using regime context, scoring dimensions, and trade parameters. It returns Agree, Disagree, or Uncertain. A Disagree does not automatically block the trade (depends on settings) but is logged. Skipped means the signal was blocked by a gate before reaching the AI layer.",
    icon: <Brain className="w-4 h-4 text-primary" />,
  },
];

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-border/40">
        {icon}
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true });
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="rounded-lg border border-border/40 bg-card overflow-hidden">
          <button
            onClick={() => setOpen(o => ({ ...o, [i]: !o[i] }))}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
          >
            <div className="shrink-0">{item.icon ?? <ChevronRight className="w-4 h-4 text-muted-foreground" />}</div>
            <span className="flex-1 text-sm font-medium text-foreground">{item.q}</span>
            {open[i]
              ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            }
          </button>
          {open[i] && (
            <div className="px-4 pb-4 pt-0 border-t border-border/20">
              <p className="text-sm text-muted-foreground leading-relaxed mt-3">{item.a}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Help() {
  const { data, isLoading } = useQuery<VersionInfo>({
    queryKey: ["/api/version"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/version`);
      if (!res.ok) throw new Error("Failed to fetch version info");
      return res.json();
    },
    staleTime: 60_000,
  });

  const [relExpanded, setRelExpanded] = useState<Record<string, boolean>>({ "3.0.0": true });
  const toggleRel = (v: string) => setRelExpanded(p => ({ ...p, [v]: !p[v] }));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      {/* Header */}
      <div className="flex items-start gap-4 pb-6 border-b border-border/40">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <TrendingUp className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {data?.name ?? "Deriv Quant Research Platform"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Large capital, long hold, maximum profit — Boom, Crash, and Volatility synthetic indices.
          </p>
          <div className="flex items-center gap-4 mt-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-mono bg-primary/10 text-primary px-2.5 py-1 rounded-full">
              <Package className="w-3 h-3" /> v{data?.version ?? "3.0.0"}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="w-3 h-3" /> Last updated: {data?.lastUpdated ?? "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Core Strategy */}
      <Section title="Core Strategy" icon={<Target className="w-5 h-5 text-primary" />}>
        <Card>
          <CardContent className="p-4 space-y-3 text-sm text-muted-foreground">
            <p>
              Targets real price moves of <span className="text-foreground font-semibold">50–200%+</span> on
              Boom, Crash, and Volatility synthetic indices using a multi-engine, multi-window confirmation framework.
            </p>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div>
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1.5">Active Trading Symbols</p>
                <div className="flex flex-wrap gap-1.5">
                  {["CRASH300", "BOOM300", "R_75", "R_100"].map(s => (
                    <span key={s} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1.5">Score Thresholds</p>
                <div className="space-y-0.5">
                  {SCORE_GATES.map(g => (
                    <div key={g.mode} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{g.mode}</span>
                      <span className={cn("font-semibold mono-num", g.color)}>≥{g.threshold}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p>
              The <span className="text-foreground font-medium">Take Profit (TP)</span> is the primary exit.
              The 30% trailing stop is a safety net only. The 72-hour profitable exit is a capital efficiency backstop —
              it does not override TP if price is heading there.
            </p>
          </CardContent>
        </Card>
      </Section>

      {/* Engines */}
      <Section title="Signal Engines" icon={<Zap className="w-5 h-5 text-primary" />}>
        <div className="space-y-2">
          {ENGINES.map(e => (
            <div key={e.name} className="rounded-lg border border-border/40 bg-card p-4">
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">{e.name}</span>
                  <span className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold",
                    e.direction === "up" ? "bg-green-500/12 text-green-400"
                    : e.direction === "down" ? "bg-red-500/12 text-red-400"
                    : "bg-blue-500/12 text-blue-400"
                  )}>
                    {e.direction === "up" ? "↑ BUY" : e.direction === "down" ? "↓ SELL" : "↑↓ BOTH"}
                  </span>
                </div>
                <span className="text-[11px] font-mono text-muted-foreground shrink-0">{e.symbol}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{e.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Scoring */}
      <Section title="5-Dimension Scoring" icon={<BarChart3 className="w-5 h-5 text-primary" />}>
        <Card>
          <CardContent className="p-4">
            <div className="space-y-3">
              {[
                { dim: "Range Position", desc: "Where price sits within the recent ATR-normalized range. Extremes score higher for reversal engines." },
                { dim: "MA Deviation",   desc: "Distance of price from the primary moving average, normalized by ATR. High deviation is bullish for continuation, bearish for reversal." },
                { dim: "Volatility Profile", desc: "Current volatility percentile vs trailing 30-day history. Unusual volatility (high or low) triggers scores." },
                { dim: "Range Expansion",    desc: "Recent candle body/range vs ATR. Measures burst activity — essential for breakout and expansion engines." },
                { dim: "Directional Confirmation", desc: "Price action is moving in the signal direction. Prevents entries against immediate momentum." },
              ].map(({ dim, desc }) => (
                <div key={dim} className="flex gap-3">
                  <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{dim}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4 pt-3 border-t border-border/30">
              All five dimensions combine into a single <strong className="text-foreground">Composite Score (0–100)</strong>. Signals must exceed the mode-specific threshold at the moment of evaluation. Multi-window confirmation requires the threshold to hold across N consecutive evaluation cycles.
            </p>
          </CardContent>
        </Card>
      </Section>

      {/* FAQ */}
      <Section title="FAQ" icon={<Activity className="w-5 h-5 text-primary" />}>
        <FaqAccordion items={FAQ_ITEMS} />
      </Section>

      {/* Release history */}
      {data?.releases && data.releases.length > 0 && (
        <Section title="Release History" icon={<Package className="w-5 h-5 text-primary" />}>
          <div className="space-y-3">
            {data.releases.map(release => {
              const isOpen = !!relExpanded[release.version];
              return (
                <div key={release.version} className="rounded-lg border border-border/40 bg-card overflow-hidden">
                  <button
                    onClick={() => toggleRel(release.version)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                  >
                    {isOpen
                      ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-foreground">v{release.version}</span>
                        <span className="text-xs text-muted-foreground">— {release.title}</span>
                      </div>
                      <p className="text-xs text-muted-foreground/60 mt-0.5">{release.date}</p>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pt-0 border-t border-border/20">
                      <ul className="space-y-1.5 mt-3">
                        {release.changes.map((change, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <span className="text-primary mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-primary/60 inline-block" />
                            {change}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
