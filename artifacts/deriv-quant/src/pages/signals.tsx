import React, { useState } from "react";
import { useGetLatestSignals, useScoreSignal, getGetLatestSignalsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Select, Label } from "@/components/ui-elements";
import { formatNumber, cn } from "@/lib/utils";
import { Zap, Target, ArrowUpRight, ArrowDownRight, Brain, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
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

export default function Signals() {
  const queryClient = useQueryClient();
  const { data: signals, isLoading } = useGetLatestSignals({ query: { refetchInterval: 3000 } });
  
  const { mutate: scoreSignal, isPending: scoring, data: scoreResult } = useScoreSignal({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetLatestSignalsQueryKey() });
      }
    }
  });

  const [form, setForm] = useState({ symbol: "BOOM1000", strategyName: "trend-pullback" });

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

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <Target className="w-4 h-4 text-primary" />
                Manual Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Symbol</Label>
                  <Select value={form.symbol} onChange={e => setForm({...form, symbol: e.target.value})}>
                    <option value="BOOM1000">BOOM1000</option>
                    <option value="CRASH1000">CRASH1000</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Strategy</Label>
                  <Select value={form.strategyName} onChange={e => setForm({...form, strategyName: e.target.value})}>
                    <option value="trend-pullback">Trend Pullback</option>
                    <option value="volatility-breakout">Volatility Breakout</option>
                  </Select>
                </div>
                <Button 
                  variant="primary"
                  className="w-full mt-1" 
                  onClick={() => scoreSignal({ data: form })}
                  isLoading={scoring}
                >
                  Score Now
                </Button>
              </div>
            </CardContent>
          </Card>

          {scoreResult && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card className={cn("border", scoreResult.regimeCompatible ? "border-success/30" : "border-destructive/30")}>
                <CardContent className="p-4 space-y-3">
                  {[
                    { label: "Score", value: formatNumber(scoreResult.score, 3) },
                    { label: "Confidence", value: `${formatNumber(scoreResult.confidence * 100, 1)}%` },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-sm font-semibold font-mono tabular-nums">{value}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">EV</span>
                    <span className={cn("text-sm font-semibold font-mono tabular-nums", scoreResult.expectedValue > 0 ? "text-success" : "text-destructive")}>
                      {formatNumber(scoreResult.expectedValue, 2)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-border/40">
                    <Badge variant={scoreResult.regimeCompatible ? "success" : "destructive"} className="w-full justify-center">
                      {scoreResult.regimeCompatible ? "Regime Compatible" : "Regime Mismatch"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </div>

        <div className="lg:col-span-3">
          <Card className="h-full">
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
                    <th className="text-right">Score</th>
                    <th className="text-right">EV</th>
                    <th>Status</th>
                    <th>AI Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">Loading signals…</td></tr>
                  ) : !signals?.length ? (
                    <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">No recent signals.</td></tr>
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
                        <td className="text-right mono-num">{formatNumber(sig.score, 2)}</td>
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
      </div>
    </div>
  );
}
