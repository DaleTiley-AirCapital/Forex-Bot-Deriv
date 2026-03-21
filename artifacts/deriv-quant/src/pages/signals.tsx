import React, { useState } from "react";
import { useGetLatestSignals } from "@workspace/api-client-react";
import type { ScoringDimensions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@/components/ui-elements";
import { formatNumber, cn } from "@/lib/utils";
import { Zap, ArrowUpRight, ArrowDownRight, Brain, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

function AIVerdictBadge({ verdict, reasoning }: { verdict: string | null | undefined; reasoning: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);

  if (!verdict) return <span className="text-xs text-muted-foreground/50">—</span>;

  const styles: Record<string, string> = {
    agree: "bg-emerald-500/12 text-emerald-400 border-emerald-500/25",
    disagree: "bg-red-500/12 text-red-400 border-red-500/25",
    uncertain: "bg-amber-500/12 text-amber-400 border-amber-500/25",
    error: "bg-gray-500/12 text-gray-400 border-gray-500/25",
  };

  const labels: Record<string, string> = {
    agree: "Agree",
    disagree: "Disagree",
    uncertain: "Uncertain",
    error: "Error",
  };

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border tracking-wide cursor-pointer transition-opacity hover:opacity-80",
          styles[verdict] || "bg-gray-500/12 text-gray-400 border-gray-500/25"
        )}
      >
        <Brain className="w-3 h-3" />
        {labels[verdict] || verdict}
        {reasoning && (expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </button>
      <AnimatePresence>
        {expanded && reasoning && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-xs text-muted-foreground italic max-w-[220px] leading-relaxed"
          >
            {reasoning}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CompositeScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-xs text-muted-foreground/50">—</span>;

  const color = score >= 85
    ? "text-emerald-400"
    : score >= 70
      ? "text-amber-400"
      : "text-red-400";

  const bg = score >= 85
    ? "bg-emerald-500/10 border-emerald-500/25"
    : score >= 70
      ? "bg-amber-500/10 border-amber-500/25"
      : "bg-red-500/10 border-red-500/25";

  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-sm font-bold border mono-num", color, bg)}>
      {score}
    </span>
  );
}

const DIMENSION_LABELS: Record<keyof ScoringDimensions, string> = {
  regimeFit: "Regime Fit",
  setupQuality: "Setup Quality",
  trendAlignment: "Trend Alignment",
  volatilityCondition: "Volatility",
  rewardRisk: "Reward/Risk",
  probabilityOfSuccess: "Probability",
};

function DimensionBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80
    ? "bg-emerald-500"
    : value >= 60
      ? "bg-amber-500"
      : "bg-red-500";

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-20 text-right shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10px] mono-num text-foreground w-6 text-right">{value}</span>
    </div>
  );
}

function DimensionsBreakdown({ dimensions }: { dimensions: ScoringDimensions | null | undefined }) {
  const [expanded, setExpanded] = useState(false);

  if (!dimensions) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[10px] text-primary/70 hover:text-primary transition-colors flex items-center gap-0.5"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {expanded ? "Hide" : "Details"}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-1.5 space-y-1 min-w-[200px]"
          >
            {(Object.keys(DIMENSION_LABELS) as (keyof ScoringDimensions)[]).map((key) => (
              <DimensionBar key={key} label={DIMENSION_LABELS[key]} value={dimensions[key]} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Signals() {
  const { data: signals, isLoading } = useGetLatestSignals({ query: { refetchInterval: 3000 } });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Live Signals</h1>
          <p className="page-subtitle">Real-time model scoring and AI-verified signal generation</p>
        </div>
      </div>

      <div className="mb-2 px-1 py-2 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 shrink-0 text-primary" />
        <span>
          <span className="font-medium text-foreground">Expected hold:</span>{" "}
          ~24–72 h (position held until Stop Loss or Take Profit is hit, hard cap 120 h)
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <Zap className="w-4 h-4 text-warning" />
            Signal Feed
          </CardTitle>
          <span className="text-xs text-muted-foreground">{signals?.length ?? 0} recent</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Strategy</th>
                <th>Dir</th>
                <th className="text-right">Composite</th>
                <th className="text-right">Model</th>
                <th className="text-right">EV</th>
                <th>Status</th>
                <th>AI Verdict</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">Loading signals…</td></tr>
              ) : !signals?.length ? (
                <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">No recent signals.</td></tr>
              ) : (
                signals.map((sig) => (
                  <tr key={sig.id} className={cn(!sig.allowedFlag && "opacity-50 grayscale")}>
                    <td className="mono-num text-muted-foreground text-xs">{new Date(sig.ts).toLocaleTimeString()}</td>
                    <td className="font-semibold text-foreground">{sig.symbol}</td>
                    <td className="text-sm text-muted-foreground">{sig.strategyName}</td>
                    <td>
                      {sig.direction === 'buy'
                        ? <span className="inline-flex items-center gap-1 text-success text-xs font-semibold"><ArrowUpRight className="w-3.5 h-3.5" />BUY</span>
                        : sig.direction === 'sell'
                        ? <span className="inline-flex items-center gap-1 text-destructive text-xs font-semibold"><ArrowDownRight className="w-3.5 h-3.5" />SELL</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <CompositeScoreBadge score={sig.compositeScore} />
                        <DimensionsBreakdown dimensions={sig.scoringDimensions} />
                      </div>
                    </td>
                    <td className="text-right mono-num text-xs text-muted-foreground">{formatNumber(sig.score, 2)}</td>
                    <td className={cn("text-right mono-num", sig.expectedValue > 0 ? "text-success" : "text-destructive")}>
                      {formatNumber(sig.expectedValue, 2)}
                    </td>
                    <td>
                      {sig.allowedFlag ? (
                        <Badge variant="success">Approved</Badge>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <Badge variant="destructive">Rejected</Badge>
                          {sig.rejectionReason && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={sig.rejectionReason}>
                              {sig.rejectionReason}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <AIVerdictBadge verdict={sig.aiVerdict} reasoning={sig.aiReasoning} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
