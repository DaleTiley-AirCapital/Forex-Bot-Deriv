import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown, ChevronRight, TrendingUp, Package, Calendar, Zap,
  Database, Brain, Shield, Target, Activity, BarChart3, Radio,
  AlertTriangle, CheckCircle, Clock, BookOpen, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

const ENGINES: {
  name: string; symbol: string; direction: "up" | "down" | "both";
  desc: string;
}[] = [
  { name: "Boom Expansion",    symbol: "BOOM300",  direction: "up",   desc: "Enters on spike-surge events with multi-window score confirmation. Targets the expansion leg following a Boom spike cluster. Requires direction=up; uses spike count, candle range, and MA deviation." },
  { name: "Crash Expansion",   symbol: "CRASH300", direction: "down", desc: "Mirrors Boom Expansion for Crash indices. Enters on spike-drop events and targets the continuation sell-off after a Crash spike cluster. Requires direction=down." },
  { name: "R75 Continuation",  symbol: "R_75",     direction: "both", desc: "Follows high-momentum trends on Volatility 75. Enters in the direction of the dominant trend after mean-to-range confirmation. Avoids counter-trend entries." },
  { name: "R75 Reversal",      symbol: "R_75",     direction: "both", desc: "Fades exhausted moves on Volatility 75. Enters counter-trend at extreme range positions where MA deviation is at maximum. High score required." },
  { name: "R75 Breakout",      symbol: "R_75",     direction: "both", desc: "Captures ATR-surge breakouts on Volatility 75. Triggers when range expansion score exceeds the symbol's volatility profile threshold." },
  { name: "R100 Continuation", symbol: "R_100",    direction: "both", desc: "High-momentum trend following on Volatility 100 — calibrated for the higher-volatility index with larger position movement expectations." },
  { name: "R100 Reversal",     symbol: "R_100",    direction: "both", desc: "Exhaustion reversal on Volatility 100. Same 5-dimension score as R75 Reversal but with a higher Real mode threshold due to sizing." },
  { name: "R100 Breakout",     symbol: "R_100",    direction: "both", desc: "ATR-burst range breakout on Volatility 100. Looks for volatility squeeze followed by directional expansion with confirmation." },
];

const SCORE_GATES = [
  { mode: "Paper", threshold: 85, color: "text-amber-400", note: "Simulated orders against paper capital" },
  { mode: "Demo",  threshold: 90, color: "text-blue-400",  note: "Real orders against Deriv virtual account" },
  { mode: "Real",  threshold: 92, color: "text-red-400",   note: "Live orders with real capital" },
];

const FAQ_ITEMS: { q: string; a: string; icon: React.ReactNode }[] = [
  {
    q: "What are the TP/SL targets?",
    a: "Take profit is calibrated to capture 50–200%+ moves. This is the PRIMARY exit — most trade lifecycle decisions are made relative to TP. The trailing stop (default 30%) is a SAFETY NET only — it triggers only once price has moved significantly in your favour. The 72-hour profitable exit closes trades after 72 hours if they're profitable but haven't reached TP — this is a capital efficiency backstop, not the primary strategy. Never change TP to smaller targets; that defeats the purpose of this system.",
    icon: <Target className="w-4 h-4 text-primary" />,
  },
  {
    q: "What is the difference between Paper, Demo, and Real modes?",
    a: "Paper mode uses simulated orders against paper capital — no Deriv account required. Positions are tracked internally with floating PnL, no real money changes hands. Demo mode sends real orders to Deriv's virtual account (VRTC prefix). Real mode sends live orders using real capital. Each mode has its own score threshold: Paper ≥ 85, Demo ≥ 90, Real ≥ 92. These thresholds are not negotiable.",
    icon: <Shield className="w-4 h-4 text-primary" />,
  },
  {
    q: "Why did a high-scoring signal get blocked?",
    a: "A signal that passes the engine's composite score gate may still be blocked by system-level gates: Kill switch active, daily/weekly loss limit reached, maximum drawdown exceeded, open risk limit hit, maximum concurrent trades reached, AI disagreement (if AI verification is enabled), or trading mode not active. The Engine Decisions page explains each blocking gate with the specific reason code and detail.",
    icon: <Zap className="w-4 h-4 text-amber-400" />,
  },
  {
    q: "What are the 5 scoring dimensions?",
    a: "Every signal is scored on 5 independent dimensions, each contributing to the composite score (0–100): (1) Range Position — where price sits in the recent ATR-normalized range; (2) MA Deviation — distance from the primary moving average; (3) Volatility Profile — current volatility vs trailing 30-day percentile; (4) Range Expansion — recent candle body/range vs ATR, measures burst; (5) Directional Confirmation — price action moving in the signal direction. All five combine into one composite score.",
    icon: <BarChart3 className="w-4 h-4 text-primary" />,
  },
  {
    q: "What does 'Pending Confirmation' mean?",
    a: "Some engines require a signal to appear in multiple consecutive evaluation windows before firing an entry. This reduces false positives. A 'Pending' signal has crossed the composite threshold but hasn't yet accumulated the required consecutive confirmation count. The Engine Decisions page shows these in a separate state (pending) with a progress bar showing confirmations vs required.",
    icon: <Clock className="w-4 h-4 text-amber-400" />,
  },
  {
    q: "What is the AI Verdict?",
    a: "After the engine scores a signal above threshold, a GPT-4o model independently evaluates it using regime context, all 5 scoring dimensions, and trade parameters. It returns Agree, Disagree, or Uncertain with reasoning. A Disagree does not automatically block the trade unless 'AI Verification' is enabled in settings — but it is always logged. 'Skipped' means the signal was blocked by a gate before reaching the AI layer.",
    icon: <Brain className="w-4 h-4 text-primary" />,
  },
  {
    q: "What does 'Interpolated' mean in the Data page?",
    a: "When tick-derived candle data has gaps (e.g. no ticks arrived for a minute), the system inserts synthetic interpolated candles using the previous real close to maintain time continuity. These are NOT real market data. Signals are penalized or blocked if too many interpolated candles appear in the evaluation window. Use Research → Data Operations → Repair Interpolated to attempt recovery from the Deriv API.",
    icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
  },
  {
    q: "Why is streaming offline for some symbols?",
    a: "Streaming means the server is actively receiving real-time ticks from Deriv's API for that symbol. It requires a valid Deriv API token configured in Settings. The 4 active trading symbols (CRASH300, BOOM300, R_75, R_100) should be streaming during active hours. Other symbols may be idle — they have historical candle data but no live tick feed. Start All in the Data page to activate streaming for all symbols.",
    icon: <Radio className="w-4 h-4 text-green-400" />,
  },
  {
    q: "What does the Coordinator do?",
    a: "The V3 Coordinator is the decision layer between the signal engines and order execution. It receives scored signals, applies system-level gates (kill switch, drawdown limits, concurrent trade limits), coordinates with the AI layer, and routes approved signals to the Allocator. The Allocator then determines position sizing based on capital, equity %, and current portfolio state. The Engine Decisions page shows both coordinator and allocator outcomes.",
    icon: <Layers className="w-4 h-4 text-primary" />,
  },
  {
    q: "How do I read the scoring dimensions in the Decisions panel?",
    a: "Each dimension shows a bar from 0 to 100. Higher bars are better in the signal direction. A dimension at 50 is neutral. The composite score is not a simple average — each dimension is weighted based on the engine type. Range Expansion is more heavily weighted for breakout engines. MA Deviation is more weighted for continuation engines. The raw score is before weighting; the composite score is after.",
    icon: <Activity className="w-4 h-4 text-primary" />,
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

function FaqAccordion({ items }: { items: typeof FAQ_ITEMS }) {
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true });
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="rounded-lg border border-border/40 bg-card overflow-hidden">
          <button
            onClick={() => setOpen(o => ({ ...o, [i]: !o[i] }))}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
          >
            <div className="shrink-0">{item.icon}</div>
            <span className="flex-1 text-sm font-medium text-foreground">{item.q}</span>
            {open[i]
              ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
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
  const { data } = useQuery<VersionInfo>({
    queryKey: ["/api/version"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/version`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60_000,
  });

  const [relExpanded, setRelExpanded] = useState<Record<string, boolean>>({ "3.0.0": true });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-10">
      {/* Header */}
      <div className="flex items-start gap-4 pb-6 border-b border-border/40">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <TrendingUp className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {data?.name ?? "Deriv Trading — Long Hold V3"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Large capital · long hold · maximum profit — Boom, Crash, and Volatility synthetic indices
          </p>
          <div className="flex items-center gap-4 mt-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-mono bg-primary/10 text-primary px-2.5 py-1 rounded-full">
              <Package className="w-3 h-3" /> v{data?.version ?? "3.0.0"}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="w-3 h-3" /> {data?.lastUpdated ?? "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Core Strategy */}
      <Section title="Core Strategy" icon={<Target className="w-5 h-5 text-primary" />}>
        <div className="rounded-lg border border-border/40 bg-card p-4 space-y-4 text-sm text-muted-foreground">
          <p>
            Targets real price moves of <span className="text-foreground font-semibold">50–200%+</span> on
            Boom, Crash, and Volatility synthetic indices using a multi-engine, multi-window
            confirmation framework. This system is designed for <strong className="text-foreground">large capital, long hold</strong> — not
            scalping or frequent trading.
          </p>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div>
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">Active Trading Symbols</p>
              <div className="flex flex-wrap gap-1.5">
                {["CRASH300", "BOOM300", "R_75", "R_100"].map(s => (
                  <span key={s} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">Score Thresholds</p>
              <div className="space-y-1">
                {SCORE_GATES.map(g => (
                  <div key={g.mode} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{g.mode}</span>
                    <span className={cn("font-bold tabular-nums", g.color)}>≥ {g.threshold}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-md bg-primary/5 border border-primary/15 px-3 py-2.5">
            <p className="text-xs text-muted-foreground/90 leading-relaxed">
              <strong className="text-primary">Exit hierarchy:</strong> TP hit (primary) → Trailing stop (safety) → 72h profitable exit (capital efficiency backstop).
              The 72h rule does NOT override TP if price is moving toward it. Never reduce TP targets — the 50–200%+ mandate is non-negotiable.
            </p>
          </div>
        </div>
      </Section>

      {/* Mode Thresholds */}
      <Section title="Trading Modes" icon={<Shield className="w-5 h-5 text-primary" />}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {SCORE_GATES.map(g => (
            <div key={g.mode} className="rounded-lg border border-border/40 bg-card p-4">
              <p className={cn("text-sm font-bold", g.color)}>{g.mode}</p>
              <p className={cn("text-2xl font-bold tabular-nums mt-1", g.color)}>≥ {g.threshold}</p>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{g.note}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground/70 mt-2">
          These thresholds are the minimum composite scores required for a signal to proceed to order placement.
          They cannot be lowered — doing so undermines the statistical edge of the system.
        </p>
      </Section>

      {/* Signal Engines */}
      <Section title="Signal Engines" icon={<Zap className="w-5 h-5 text-primary" />}>
        <div className="space-y-2">
          {ENGINES.map(e => (
            <div key={e.name} className="rounded-lg border border-border/40 bg-card p-4">
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-foreground">{e.name}</span>
                  <span className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold",
                    e.direction === "up"   ? "bg-green-500/12 text-green-400"
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

      {/* 5-Dimension Scoring */}
      <Section title="5-Dimension Scoring" icon={<BarChart3 className="w-5 h-5 text-primary" />}>
        <div className="rounded-lg border border-border/40 bg-card p-4">
          <div className="space-y-3.5">
            {[
              { dim: "Range Position",          desc: "Where price sits within the recent ATR-normalized range. Extremes (0 or 100) score higher for reversal engines; mid-range for continuation." },
              { dim: "MA Deviation",            desc: "Distance of price from the primary moving average, normalized by ATR. High deviation signals continuation momentum or extreme exhaustion." },
              { dim: "Volatility Profile",      desc: "Current volatility percentile vs the trailing 30-day history. Unusual volatility (high or low) is a precondition for several engines." },
              { dim: "Range Expansion",         desc: "Recent candle body/range vs ATR. Measures burst activity — high expansion signals potential breakout energy." },
              { dim: "Directional Confirmation",desc: "Price action moving in the intended signal direction. Prevents entries against immediate short-term momentum even if longer-term setup is valid." },
            ].map(({ dim, desc }) => (
              <div key={dim} className="flex gap-3">
                <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">{dim}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4 pt-3 border-t border-border/30 leading-relaxed">
            All five combine into a single <strong className="text-foreground">Composite Score (0–100)</strong>.
            Multi-window confirmation requires the threshold to hold across N consecutive evaluation cycles,
            preventing single-candle false positives.
          </p>
        </div>
      </Section>

      {/* FAQ */}
      <Section title="Frequently Asked Questions" icon={<BookOpen className="w-5 h-5 text-primary" />}>
        <FaqAccordion items={FAQ_ITEMS} />
      </Section>

      {/* Pages Reference */}
      <Section title="Pages Reference" icon={<Database className="w-5 h-5 text-primary" />}>
        <div className="space-y-2">
          {[
            { page: "Overview",         path: "/",            desc: "System status, portfolio snapshot, mode summary, engine config, data health. Start here." },
            { page: "Engine Decisions", path: "/decisions",   desc: "Every signal decision — scored, classified by state (traded/pending/approved/rejected/blocked/suppressed), with coordinator reasoning and AI verdict." },
            { page: "Trades",           path: "/trades",      desc: "Open positions with floating PnL and progress to TP, closed trade history with exit reasons, attribution by symbol and engine." },
            { page: "Research",         path: "/research",    desc: "AI market analysis, data repair/reconcile operations, and candle export by date range." },
            { page: "Data",             path: "/data",        desc: "Streaming state per symbol, candle coverage for all 28 symbols, live tick feed, and spike events." },
            { page: "Settings",         path: "/settings",    desc: "Trading mode activation, kill switch, capital, score thresholds, AI verification, streaming config." },
            { page: "Diagnostics",      path: "/diagnostics", desc: "Data integrity grid, enrichment pipeline, top-up, AI research jobs, export controls, streaming state, runtime info." },
          ].map(({ page, path, desc }) => (
            <div key={page} className="flex items-start gap-3 rounded-lg border border-border/40 bg-card px-4 py-3">
              <span className="font-mono text-[11px] text-primary bg-primary/10 border border-primary/20 rounded px-1.5 py-0.5 shrink-0 mt-0.5">{path}</span>
              <div>
                <p className="text-sm font-medium text-foreground">{page}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Release History */}
      {data?.releases && data.releases.length > 0 && (
        <Section title="Release History" icon={<Package className="w-5 h-5 text-primary" />}>
          <div className="space-y-3">
            {data.releases.map(release => {
              const isOpen = !!relExpanded[release.version];
              return (
                <div key={release.version} className="rounded-lg border border-border/40 bg-card overflow-hidden">
                  <button
                    onClick={() => setRelExpanded(p => ({ ...p, [release.version]: !isOpen }))}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                  >
                    {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">v{release.version}</span>
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
