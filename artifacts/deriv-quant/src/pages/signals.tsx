import React, { useState } from "react";
import { useGetLatestSignals, useScoreSignal, getGetLatestSignalsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Select, Label } from "@/components/ui-elements";
import { formatNumber, cn } from "@/lib/utils";
import { Zap, Target, ShieldAlert, ArrowUpRight, ArrowDownRight, Brain, ChevronDown, ChevronUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

function AIVerdictBadge({ verdict, reasoning }: { verdict: string | null | undefined; reasoning: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);

  if (!verdict) return null;

  const colorMap: Record<string, string> = {
    agree: "bg-green-500/20 text-green-400 border-green-500/30",
    disagree: "bg-red-500/20 text-red-400 border-red-500/30",
    uncertain: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  };

  const labelMap: Record<string, string> = {
    agree: "AI: AGREE",
    disagree: "AI: DISAGREE",
    uncertain: "AI: UNCERTAIN",
  };

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border cursor-pointer",
          colorMap[verdict] || "bg-gray-500/20 text-gray-400"
        )}
      >
        <Brain className="w-3 h-3" />
        {labelMap[verdict] || verdict}
        {reasoning && (expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </button>
      <AnimatePresence>
        {expanded && reasoning && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-xs text-muted-foreground italic max-w-[200px]"
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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Live Signals</h1>
          <p className="text-muted-foreground font-mono mt-1 text-sm">Real-time model scoring and signal generation</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-4 h-4" />
                Manual Scoring
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Symbol</Label>
                  <Select value={form.symbol} onChange={e => setForm({...form, symbol: e.target.value})}>
                    <option value="BOOM1000">BOOM1000</option>
                    <option value="CRASH1000">CRASH1000</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Strategy</Label>
                  <Select value={form.strategyName} onChange={e => setForm({...form, strategyName: e.target.value})}>
                    <option value="trend-pullback">Trend Pullback</option>
                    <option value="volatility-breakout">Volatility Breakout</option>
                  </Select>
                </div>
                <Button 
                  className="w-full mt-2" 
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
              <Card className={cn("border-2", scoreResult.regimeCompatible ? "border-success/50" : "border-destructive/50")}>
                <CardContent className="p-4 space-y-3 font-mono text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Score</span>
                    <span className="font-bold">{formatNumber(scoreResult.score, 3)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Confidence</span>
                    <span>{formatNumber(scoreResult.confidence * 100, 1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">EV</span>
                    <span className={scoreResult.expectedValue > 0 ? "profit" : "loss"}>
                      {formatNumber(scoreResult.expectedValue, 2)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-border/30">
                    <Badge variant={scoreResult.regimeCompatible ? "default" : "destructive"} className="w-full justify-center">
                      {scoreResult.regimeCompatible ? "REGIME COMPATIBLE" : "REGIME MISMATCH"}
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
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-warning" />
                Signal Feed
              </CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full">
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
                    <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
                  ) : signals?.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">No recent signals.</td></tr>
                  ) : (
                    signals?.map((sig) => (
                      <tr key={sig.id} className={cn(!sig.allowedFlag && "opacity-50 grayscale")}>
                        <td className="mono-num text-muted-foreground">{new Date(sig.ts).toLocaleTimeString()}</td>
                        <td className="font-bold">{sig.symbol}</td>
                        <td className="text-muted-foreground">{sig.strategyName}</td>
                        <td>
                          {sig.direction === 'buy' ? <ArrowUpRight className="w-4 h-4 text-success" /> : 
                           sig.direction === 'sell' ? <ArrowDownRight className="w-4 h-4 text-destructive" /> : '-'}
                        </td>
                        <td className="text-right mono-num">{formatNumber(sig.score, 2)}</td>
                        <td className={cn("text-right mono-num", sig.expectedValue > 0 ? "profit" : "loss")}>
                          {formatNumber(sig.expectedValue, 2)}
                        </td>
                        <td>
                          {sig.allowedFlag ? (
                            <Badge variant="default">APPROVED</Badge>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Badge variant="destructive">REJECTED</Badge>
                              <span className="text-xs text-muted-foreground truncate max-w-[120px]" title={sig.rejectionReason || ''}>
                                {sig.rejectionReason}
                              </span>
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
