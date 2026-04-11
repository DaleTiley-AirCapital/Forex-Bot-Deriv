import React, { useState, useMemo } from "react";
import { useGetLatestSignals, useGetPendingSignals } from "@workspace/api-client-react";
import type { ScoringDimensions, GetLatestSignalsParams, SignalLog } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui-elements";
import { formatNumber, cn } from "@/lib/utils";
import {
  Zap, ArrowUpRight, ArrowDownRight, Brain, ChevronDown, ChevronUp,
  Filter, X, ChevronLeft, ChevronRight, Download, ShieldAlert,
  Target, BarChart3, Clock, Layers, CheckCircle, XCircle, AlertTriangle, Activity,
} from "lucide-react";
import { downloadCSV, downloadJSON } from "@/lib/export";
import { motion, AnimatePresence } from "framer-motion";

const ENGINES = [
  "boom_expansion_engine",
  "crash_expansion_engine",
  "r75_continuation_engine",
  "r75_reversal_engine",
  "r75_breakout_engine",
  "r100_continuation_engine",
  "r100_reversal_engine",
  "r100_breakout_engine",
  "v3_engine",
] as const;

const STATUSES = ["approved", "blocked"] as const;
const AI_VERDICTS = ["agree", "disagree", "uncertain"] as const;

const ENGINE_LABELS: Record<string, string> = {
  boom_expansion_engine: "Boom Expansion",
  crash_expansion_engine: "Crash Expansion",
  r75_continuation_engine: "R75 Continuation",
  r75_reversal_engine: "R75 Reversal",
  r75_breakout_engine: "R75 Breakout",
  r100_continuation_engine: "R100 Continuation",
  r100_reversal_engine: "R100 Reversal",
  r100_breakout_engine: "R100 Breakout",
  v3_engine: "V3 Engine",
};

const ENGINE_COLORS: Record<string, string> = {
  boom_expansion_engine:  "bg-emerald-500/12 text-emerald-400 border-emerald-500/25",
  crash_expansion_engine: "bg-red-500/12 text-red-400 border-red-500/25",
  r75_continuation_engine: "bg-blue-500/12 text-blue-400 border-blue-500/25",
  r75_reversal_engine:    "bg-purple-500/12 text-purple-400 border-purple-500/25",
  r75_breakout_engine:    "bg-cyan-500/12 text-cyan-400 border-cyan-500/25",
  r100_continuation_engine: "bg-indigo-500/12 text-indigo-400 border-indigo-500/25",
  r100_reversal_engine:   "bg-violet-500/12 text-violet-400 border-violet-500/25",
  r100_breakout_engine:   "bg-sky-500/12 text-sky-400 border-sky-500/25",
  v3_engine:              "bg-amber-500/12 text-amber-400 border-amber-500/25",
};

function decisionState(sig: SignalLog): { label: string; variant: "ok" | "warn" | "error" | "info" } {
  if (!sig.allowedFlag) return { label: "Blocked", variant: "error" };
  if (sig.executionStatus === "open") return { label: "Traded", variant: "ok" };
  if (sig.executionStatus === "pending") return { label: "Pending", variant: "warn" };
  return { label: "Approved", variant: "info" };
}

function StateChip({ sig }: { sig: SignalLog }) {
  const state = decisionState(sig);
  const cls: Record<string, string> = {
    ok:    "bg-green-500/12 text-green-400 border-green-500/25",
    warn:  "bg-amber-500/12 text-amber-400 border-amber-500/25",
    error: "bg-red-500/12 text-red-400 border-red-500/25",
    info:  "bg-primary/12 text-primary border-primary/25",
  };
  const Icon = state.variant === "ok" ? CheckCircle : state.variant === "error" ? XCircle : state.variant === "warn" ? AlertTriangle : Activity;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border", cls[state.variant])}>
      <Icon className="w-3 h-3" />
      {state.label}
    </span>
  );
}

function DirectionChip({ direction }: { direction: string | null | undefined }) {
  if (!direction) return <span className="text-muted-foreground text-xs">—</span>;
  const isBuy = direction === "buy";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", isBuy ? "text-emerald-400" : "text-red-400")}>
      {isBuy ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
      {direction.toUpperCase()}
    </span>
  );
}

function ScorePill({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-xs text-muted-foreground/50">—</span>;
  const color = score >= 85 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
    : score >= 70 ? "text-amber-400 bg-amber-500/10 border-amber-500/25"
    : "text-red-400 bg-red-500/10 border-red-500/25";
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-sm font-bold border mono-num", color)}>
      {Math.round(score)}
    </span>
  );
}

const DIMENSION_LABELS: Record<keyof ScoringDimensions, string> = {
  rangePosition: "Range Position",
  maDeviation: "MA Deviation",
  volatilityProfile: "Volatility Profile",
  rangeExpansion: "Range Expansion",
  directionalConfirmation: "Directional Confirm",
};

function DimensionBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? "bg-emerald-500" : value >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-28 shrink-0 text-right">{label}</span>
      <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10px] mono-num text-foreground w-6 text-right">{value}</span>
    </div>
  );
}

function BlockingGate({ reason }: { reason: string }) {
  const patterns: { test: RegExp; gate: string; extract: (m: RegExpMatchArray) => string }[] = [
    { test: /composite.*?(\d+).*?below.*?(\d+)/i,      gate: "Composite Score",   extract: m => `Score ${m[1]} < threshold ${m[2]}` },
    { test: /composite.*?(\d+).*?<.*?(\d+)/i,           gate: "Composite Score",   extract: m => `Score ${m[1]} < threshold ${m[2]}` },
    { test: /RR.*?(\d+\.?\d*).*?below.*?(\d+\.?\d*)/i, gate: "Reward/Risk Ratio", extract: m => `RR ${m[1]} < minimum ${m[2]}` },
    { test: /EV.*?(-?\d+\.?\d*).*?below.*?(-?\d+\.?\d*)/i, gate: "Expected Value", extract: m => `EV ${m[1]} < minimum ${m[2]}` },
    { test: /kill.?switch/i,         gate: "Kill Switch",      extract: () => "Trading halted by kill switch" },
    { test: /daily.*loss/i,          gate: "Daily Loss Limit", extract: () => "Daily loss limit reached" },
    { test: /weekly.*loss/i,         gate: "Weekly Loss Limit",extract: () => "Weekly loss limit reached" },
    { test: /max.*drawdown/i,        gate: "Max Drawdown",     extract: () => "Maximum drawdown exceeded" },
    { test: /open.*risk/i,           gate: "Open Risk",        extract: () => "Open risk limit exceeded" },
    { test: /max.*open.*trades/i,    gate: "Max Open Trades",  extract: () => "Maximum concurrent trades reached" },
    { test: /AI disagree/i,          gate: "AI Verification",  extract: () => "AI disagreed with signal" },
    { test: /intelligence only/i,    gate: "Mode",             extract: () => "No execution mode active" },
    { test: /mode.*not.*active/i,    gate: "Mode",             extract: () => "No active trading mode" },
    { test: /interpolat/i,           gate: "Data Quality",     extract: () => "Interpolated candles detected — signal discarded" },
    { test: /insufficient.*data/i,   gate: "Data Quality",     extract: () => "Insufficient candle data for signal generation" },
  ];
  let gateName: string | null = null;
  let gateDetail: string | null = null;
  for (const p of patterns) {
    const match = reason.match(p.test);
    if (match) { gateName = p.gate; gateDetail = p.extract(match); break; }
  }
  return (
    <div className="p-2 rounded-md bg-red-500/8 border border-red-500/20 space-y-1">
      {gateName && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-red-400/80">Blocking Gate</span>
          <span className="text-[11px] font-semibold text-red-400">{gateName}</span>
        </div>
      )}
      {gateDetail && <p className="text-[10px] text-red-400/70">{gateDetail}</p>}
      <p className="text-[10px] text-red-400/60 leading-relaxed">{reason}</p>
    </div>
  );
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: "green" | "red" }) {
  const valClass = highlight === "green" ? "text-emerald-400" : highlight === "red" ? "text-red-400" : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn("text-[11px] mono-num font-medium", valClass)}>{value}</span>
    </div>
  );
}

function DecisionDetailPanel({ sig }: { sig: SignalLog }) {
  const tp = sig.suggestedTp != null ? Math.abs(sig.suggestedTp) : null;
  const sl = sig.suggestedSl != null ? Math.abs(sig.suggestedSl) : null;
  const rr = sl && sl > 0 && tp ? (tp / sl) : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-card/50 border-t border-border/30">
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5 text-primary" /> Scoring Breakdown
        </h4>
        {sig.scoringDimensions ? (
          <div className="space-y-1.5">
            {(Object.keys(DIMENSION_LABELS) as (keyof ScoringDimensions)[]).map(key => (
              <DimensionBar key={key} label={DIMENSION_LABELS[key]} value={sig.scoringDimensions![key]} />
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground">No dimension data available</p>
        )}
        <div className="pt-2 border-t border-border/20 space-y-1">
          <DetailRow label="Composite Score" value={sig.compositeScore != null ? Math.round(sig.compositeScore).toString() : "—"} />
          <DetailRow label="Raw Score" value={formatNumber(sig.score, 3)} />
          <DetailRow label="Expected Value" value={formatNumber(sig.expectedValue, 4)} highlight={sig.expectedValue > 0 ? "green" : "red"} />
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-primary" /> Engine Outcome
        </h4>
        <div className="space-y-1">
          <DetailRow label="Direction" value={sig.direction?.toUpperCase() ?? "—"} />
          <DetailRow label="Engine" value={ENGINE_LABELS[sig.strategyFamily ?? ""] ?? sig.strategyFamily ?? "—"} />
          <DetailRow label="Strategy" value={sig.strategyName ?? "—"} />
          <DetailRow label="Regime" value={sig.regime ?? "—"} />
          <DetailRow label="Regime Certainty" value={sig.regimeConfidence != null ? `${(sig.regimeConfidence * 100).toFixed(0)}%` : "—"} />
          <DetailRow label="Allocation" value={sig.allocationPct != null ? `${sig.allocationPct.toFixed(1)}%` : "—"} />
          <DetailRow label="Mode" value={sig.mode ?? "—"} />
        </div>
        <div className="pt-2 border-t border-border/20 space-y-1">
          <DetailRow label="Take Profit (offset)" value={tp != null ? formatNumber(tp, 4) : "—"} highlight="green" />
          <DetailRow label="Stop Loss (offset)" value={sl != null ? formatNumber(sl, 4) : "—"} highlight="red" />
          <DetailRow label="R:R Ratio" value={rr != null ? `${rr.toFixed(2)}:1` : "—"} />
        </div>
        {(sig.expectedMovePct != null || sig.expectedHoldDays != null || sig.captureRate != null || sig.empiricalWinRate != null) && (
          <div className="pt-2 border-t border-border/20 space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Signal Intelligence</p>
            {sig.expectedMovePct != null && <DetailRow label="Expected Move %" value={`${(sig.expectedMovePct * 100).toFixed(1)}%`} highlight="green" />}
            {sig.expectedHoldDays != null && <DetailRow label="Expected Hold" value={`${sig.expectedHoldDays.toFixed(0)} days`} />}
            {sig.captureRate != null && <DetailRow label="Capture Rate" value={`${(sig.captureRate * 100).toFixed(0)}%`} />}
            {sig.empiricalWinRate != null && <DetailRow label="Empirical Win Rate" value={`${(sig.empiricalWinRate * 100).toFixed(0)}%`} />}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-primary" /> Decision & AI Verdict
        </h4>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Final Decision</span>
            <StateChip sig={sig} />
          </div>
          {!sig.allowedFlag && sig.rejectionReason && (
            <BlockingGate reason={sig.rejectionReason} />
          )}
        </div>
        <div className="pt-2 border-t border-border/20 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">AI Verdict</span>
            <span className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border",
              sig.aiVerdict === "agree" ? "bg-emerald-500/12 text-emerald-400 border-emerald-500/25"
              : sig.aiVerdict === "disagree" ? "bg-red-500/12 text-red-400 border-red-500/25"
              : sig.aiVerdict === "uncertain" ? "bg-amber-500/12 text-amber-400 border-amber-500/25"
              : "bg-slate-500/12 text-slate-400 border-slate-500/25"
            )}>
              <Brain className="w-3 h-3" />
              {sig.aiVerdict ? sig.aiVerdict.charAt(0).toUpperCase() + sig.aiVerdict.slice(1) : (!sig.allowedFlag ? "Skipped" : "—")}
            </span>
          </div>
          {sig.aiReasoning && sig.aiVerdict !== "skipped" && (
            <div className="p-2 rounded-md bg-muted/30 border border-border/30">
              <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap">{sig.aiReasoning}</p>
            </div>
          )}
          {!sig.aiReasoning && !sig.allowedFlag && (
            <p className="text-[10px] text-slate-400/80 italic">Signal blocked before reaching AI verification.</p>
          )}
          {sig.aiConfidenceAdj != null && sig.aiConfidenceAdj !== 0 && (
            <DetailRow label="AI Confidence Adj" value={`${sig.aiConfidenceAdj > 0 ? "+" : ""}${sig.aiConfidenceAdj}`} />
          )}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void;
  options: readonly string[] | string[]; placeholder: string;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="bg-card border border-border/50 rounded-md px-2.5 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none">
      <option value="">{placeholder}</option>
      {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  );
}

const PAGE_SIZE = 50;

export default function Decisions() {
  const [symbolFilter, setSymbolFilter] = useState("");
  const [engineFilter, setEngineFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [aiFilter, setAiFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const params: GetLatestSignalsParams = useMemo(() => {
    const p: GetLatestSignalsParams = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    if (symbolFilter) p.symbol = symbolFilter;
    if (engineFilter) p.family = engineFilter;
    if (statusFilter) p.status = statusFilter;
    if (aiFilter) p.ai = aiFilter;
    return p;
  }, [symbolFilter, engineFilter, statusFilter, aiFilter, page]);

  const { data, isLoading } = useGetLatestSignals(params, { query: { refetchInterval: 5000 } });
  const { data: pendingData } = useGetPendingSignals({ query: { refetchInterval: 5000 } });

  const signals = data?.signals ?? [];
  const total = data?.total ?? 0;
  const visThreshold = data?.visibilityThreshold ?? 70;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilters = !!(symbolFilter || engineFilter || statusFilter || aiFilter || dateFrom || dateTo);

  const dateFilteredSignals = useMemo(() => {
    if (!dateFrom && !dateTo) return signals;
    return signals.filter(sig => {
      const d = new Date(sig.ts);
      if (dateFrom && d < new Date(dateFrom)) return false;
      if (dateTo) { const end = new Date(dateTo); end.setDate(end.getDate() + 1); if (d >= end) return false; }
      return true;
    });
  }, [signals, dateFrom, dateTo]);

  const symbolOptions = useMemo(() => {
    const s = new Set<string>(); signals.forEach(sig => s.add(sig.symbol)); return Array.from(s).sort();
  }, [signals]);

  function clearFilters() {
    setSymbolFilter(""); setEngineFilter(""); setStatusFilter(""); setAiFilter("");
    setDateFrom(""); setDateTo(""); setPage(0);
  }

  const passedCount = signals.filter(s => s.allowedFlag).length;
  const blockedCount = signals.filter(s => !s.allowedFlag).length;

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Zap className="w-6 h-6 text-primary" /> Engine Decisions
          </h1>
          <p className="page-subtitle">
            Every engine decision — why it passed, why it failed, what it expected
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500/70 inline-block" />
            {passedCount} approved
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500/70 inline-block" />
            {blockedCount} blocked
          </span>
          <span className="mono-num">{total} total decisions</span>
        </div>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <FilterSelect value={symbolFilter} onChange={v => { setSymbolFilter(v); setPage(0); }}
              options={symbolOptions.length > 0 ? symbolOptions : ["BOOM300","CRASH300","R_75","R_100"]} placeholder="All Symbols" />
            <FilterSelect value={engineFilter} onChange={v => { setEngineFilter(v); setPage(0); }}
              options={ENGINES} placeholder="All Engines" />
            <FilterSelect value={statusFilter} onChange={v => { setStatusFilter(v); setPage(0); }}
              options={STATUSES} placeholder="All States" />
            <FilterSelect value={aiFilter} onChange={v => { setAiFilter(v); setPage(0); }}
              options={AI_VERDICTS} placeholder="AI Verdict" />
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0); }}
              className="bg-card border border-border/50 rounded-md px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0); }}
              className="bg-card border border-border/50 rounded-md px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
            {hasFilters && (
              <button onClick={clearFilters}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-3 h-3" /> Clear
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => downloadCSV(dateFilteredSignals.map(s => ({
                time: new Date(s.ts).toISOString(), symbol: s.symbol,
                engine: ENGINE_LABELS[s.strategyFamily ?? ""] ?? s.strategyFamily,
                direction: s.direction, compositeScore: s.compositeScore, score: s.score,
                expectedValue: s.expectedValue, regime: s.regime, regimeConfidence: s.regimeConfidence,
                expectedMovePct: s.expectedMovePct, expectedHoldDays: s.expectedHoldDays,
                captureRate: s.captureRate, empiricalWinRate: s.empiricalWinRate,
                allocationPct: s.allocationPct, status: s.allowedFlag ? "approved" : "blocked",
                rejectionReason: s.rejectionReason, aiVerdict: s.aiVerdict, mode: s.mode,
              })), "decisions_log")}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground border border-border/50 hover:border-border transition-colors">
                <Download className="w-3 h-3" /> CSV
              </button>
              <button onClick={() => downloadJSON(dateFilteredSignals as unknown as Record<string, unknown>[], "decisions_log")}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground border border-border/50 hover:border-border transition-colors">
                <Download className="w-3 h-3" /> JSON
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending confirmations */}
      {pendingData && pendingData.count > 0 && (
        <Card className="border-amber-500/20">
          <CardHeader>
            <CardTitle><Clock className="w-4 h-4 text-amber-400" /> Awaiting Confirmation ({pendingData.count})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid gap-3 p-4">
              {pendingData.signals.map(ps => (
                <div key={`${ps.symbol}-${ps.strategyName}-${ps.direction}`}
                  className="rounded-xl border border-border/60 p-4 bg-muted/15">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <DirectionChip direction={ps.direction} />
                      <span className="font-semibold text-foreground">{ps.symbol}</span>
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border",
                        ENGINE_COLORS[ps.strategyFamily] || "bg-gray-500/12 text-gray-400 border-gray-500/25")}>
                        {ENGINE_LABELS[ps.strategyFamily] || ps.strategyFamily}
                      </span>
                      {ps.pyramidLevel > 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          <Layers className="w-3 h-3 mr-1" />Pyramid L{ps.pyramidLevel + 1}
                        </Badge>
                      )}
                    </div>
                    <ScorePill score={ps.lastCompositeScore} />
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">Confirmation Progress</span>
                        <span className="text-xs font-semibold mono-num text-amber-400">
                          {ps.confirmCount}/{ps.requiredConfirmations} windows
                        </span>
                      </div>
                      <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${ps.progressPct}%` }} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs shrink-0">
                      <div>
                        <span className="text-muted-foreground block text-[10px]">EV</span>
                        <span className={cn("mono-num font-semibold", ps.lastExpectedValue > 0 ? "text-success" : "text-destructive")}>
                          {formatNumber(ps.lastExpectedValue, 4)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Tracking</span>
                        <span className="mono-num text-foreground text-[11px]">
                          {(() => {
                            const mins = Math.floor((Date.now() - new Date(ps.firstDetectedAt).getTime()) / 60000);
                            if (mins < 1) return "<1m";
                            if (mins < 60) return `${mins}m`;
                            return `${Math.floor(mins / 60)}h ${mins % 60}m`;
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Decision log */}
      <Card>
        <CardHeader>
          <CardTitle><Zap className="w-4 h-4 text-primary" /> Decision Log</CardTitle>
          <span className="text-xs text-muted-foreground">
            Scores above {visThreshold} threshold. Click any row for full details.
          </span>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading decisions…</div>
          ) : dateFilteredSignals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Zap className="w-8 h-8 text-muted-foreground/30" />
              <p className="text-muted-foreground text-sm">{hasFilters ? "No decisions match these filters" : "No decisions logged yet"}</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {dateFilteredSignals.map(sig => {
                const isExpanded = expandedId === sig.id;
                return (
                  <div key={sig.id} className="group">
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : sig.id)}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/20 transition-colors",
                        isExpanded && "bg-muted/10"
                      )}
                    >
                      <span className="text-[10px] text-muted-foreground/60 mono-num w-20 shrink-0">
                        {new Date(sig.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <DirectionChip direction={sig.direction} />
                      <span className="font-semibold text-foreground text-sm w-20 shrink-0">{sig.symbol}</span>
                      <span className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border shrink-0",
                        ENGINE_COLORS[sig.strategyFamily ?? ""] || "bg-gray-500/12 text-gray-400 border-gray-500/25"
                      )}>
                        {ENGINE_LABELS[sig.strategyFamily ?? ""] ?? sig.strategyFamily ?? "—"}
                      </span>

                      {sig.regime && (
                        <span className="text-[11px] text-muted-foreground hidden sm:inline truncate max-w-28">
                          {sig.regime}{sig.regimeConfidence != null ? ` (${(sig.regimeConfidence * 100).toFixed(0)}%)` : ""}
                        </span>
                      )}

                      <div className="ml-auto flex items-center gap-3">
                        {sig.expectedMovePct != null && (
                          <span className="text-[11px] text-emerald-400/80 mono-num hidden md:inline">
                            {(sig.expectedMovePct * 100).toFixed(1)}% move
                          </span>
                        )}
                        <ScorePill score={sig.compositeScore} />
                        <StateChip sig={sig} />
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground/50" /> : <ChevronDown className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground/60" />}
                      </div>
                    </div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.18 }}
                        >
                          <DecisionDetailPanel sig={sig} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/30">
              <span className="text-xs text-muted-foreground">
                Page {page + 1} of {totalPages} ({total} total)
              </span>
              <div className="flex items-center gap-2">
                <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
                  className="p-1.5 rounded hover:bg-muted/30 disabled:opacity-30 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  className="p-1.5 rounded hover:bg-muted/30 disabled:opacity-30 transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
