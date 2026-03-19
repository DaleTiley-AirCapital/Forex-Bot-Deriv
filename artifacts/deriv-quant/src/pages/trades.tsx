import React, { useState } from "react";
import { 
  useGetOpenTrades, 
  useGetTradeHistory, 
  useGetLivePositions,
  useStartPaperTrading, 
  useStartLiveTrading, 
  useStopTrading,
  getGetOpenTradesQueryKey,
  getGetTradeHistoryQueryKey,
  getGetLivePositionsQueryKey,
  useGetDataStatus
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from "@/components/ui-elements";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Square, Activity, ArrowUpRight, ArrowDownRight, Clock, Target, ShieldAlert, TrendingUp } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function formatHours(hours: number): string {
  if (hours <= 0) return "0h";
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h`;
}

export default function Trades() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'positions' | 'history'>('positions');
  
  const { data: status } = useGetDataStatus({ query: { refetchInterval: 3000 } });
  const { data: positions } = useGetLivePositions({ query: { refetchInterval: 2000 } });
  const { data: openTrades, isLoading: openLoading } = useGetOpenTrades({ query: { refetchInterval: 3000 } });
  const { data: historyTrades, isLoading: historyLoading } = useGetTradeHistory({ query: { refetchInterval: 10000 } });

  const invalidator = {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOpenTradesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetTradeHistoryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetLivePositionsQueryKey() });
    }
  };

  const { mutate: startPaper, isPending: startingPaper } = useStartPaperTrading({ mutation: invalidator });
  const { mutate: startLive, isPending: startingLive } = useStartLiveTrading({ mutation: invalidator });
  const { mutate: stopTrades, isPending: stopping } = useStopTrading({ mutation: invalidator });

  const chartData = React.useMemo(() => {
    if (!historyTrades) return [];
    let cum = 0;
    return [...historyTrades].reverse().map(t => {
      cum += (t.pnl || 0);
      return { time: new Date(t.exitTs || t.entryTs).toLocaleTimeString(), pnl: cum };
    });
  }, [historyTrades]);

  const isTrading = status?.mode === 'paper' || status?.mode === 'live';
  const totalFloatingPnl = positions?.reduce((sum, p) => sum + p.floatingPnl, 0) ?? 0;

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Trades</h1>
          <p className="page-subtitle">Execution management and trade history</p>
        </div>
        
        <div className="flex items-center gap-2">
          {isTrading ? (
            <Button variant="destructive" onClick={() => stopTrades()} isLoading={stopping}>
              <Square className="w-3.5 h-3.5" fill="currentColor" />
              Stop Trading
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="text-warning border-warning/40 hover:bg-warning/8 hover:border-warning/60"
                onClick={() => startPaper()}
                isLoading={startingPaper}
              >
                <Play className="w-3.5 h-3.5" />
                Paper
              </Button>
              <Button
                variant="outline"
                className="text-success border-success/40 hover:bg-success/8 hover:border-success/60"
                onClick={() => startLive()}
                isLoading={startingLive}
              >
                <Activity className="w-3.5 h-3.5" />
                Live
              </Button>
            </>
          )}
        </div>
      </div>

      {positions && positions.length > 0 && (
        <Card className="border-primary/15">
          <CardHeader>
            <CardTitle>
              <TrendingUp className="w-4 h-4 text-primary" />
              Live Positions ({positions.length}/3)
            </CardTitle>
            <div className={cn("text-base font-bold font-mono tabular-nums", totalFloatingPnl >= 0 ? "text-success" : "text-destructive")}>
              {totalFloatingPnl >= 0 ? "+" : ""}{formatCurrency(totalFloatingPnl)}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid gap-3 p-4">
              {positions.map(p => (
                <div key={p.id} className="rounded-xl border border-border/60 p-4 bg-muted/15">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <Badge variant={p.side === 'buy' ? 'success' : 'destructive'}>
                        {p.side === 'buy' ? <ArrowUpRight className="w-3 h-3"/> : <ArrowDownRight className="w-3 h-3"/>}
                        {p.side}
                      </Badge>
                      <span className="font-semibold text-foreground">{p.symbol}</span>
                      <span className="text-xs text-muted-foreground">{p.strategyName}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={cn("text-base font-bold font-mono tabular-nums", p.floatingPnl >= 0 ? "text-success" : "text-destructive")}>
                        {p.floatingPnl >= 0 ? "+" : ""}{formatCurrency(p.floatingPnl)}
                        <span className="text-xs font-normal ml-1 opacity-80">
                          ({p.floatingPnlPct >= 0 ? "+" : ""}{p.floatingPnlPct.toFixed(2)}%)
                        </span>
                      </div>
                      <Badge variant="outline">{p.mode}</Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 md:grid-cols-6 gap-4 text-xs">
                    {[
                      { label: "Entry", value: formatNumber(p.entryPrice, 4) },
                      { label: "Current", value: formatNumber(p.currentPrice, 4), colorClass: p.currentPrice > p.entryPrice ? "text-success" : p.currentPrice < p.entryPrice ? "text-destructive" : "" },
                      { label: "SL", value: formatNumber(p.sl, 4), colorClass: "text-destructive", icon: <ShieldAlert className="w-3 h-3 text-destructive" /> },
                      { label: "TP", value: formatNumber(p.tp, 4), colorClass: "text-success", icon: <Target className="w-3 h-3 text-success" /> },
                      { label: "Size", value: formatCurrency(p.size) },
                      { label: "Time Left", value: formatHours(p.hoursRemaining), colorClass: p.hoursRemaining < 12 ? "text-warning" : "", icon: <Clock className="w-3 h-3 text-warning" /> },
                    ].map(({ label, value, colorClass, icon }) => (
                      <div key={label}>
                        <span className="text-muted-foreground block mb-0.5 flex items-center gap-1">
                          {icon}{label}
                        </span>
                        <span className={cn("font-mono font-semibold tabular-nums", colorClass)}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Cumulative P&L</CardTitle>
        </CardHeader>
        <CardContent className="h-[220px] p-0 px-1">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(213 90% 62%)" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="hsl(213 90% 62%)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 15%)" vertical={false} />
                <XAxis dataKey="time" hide />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(220 16% 9%)', 
                    borderColor: 'hsl(220 13% 15%)', 
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                  itemStyle={{ color: 'hsl(220 15% 92%)', fontFamily: 'monospace' }}
                  formatter={(val: number) => [formatCurrency(val), 'Cumulative P&L']}
                />
                <Area type="monotone" dataKey="pnl" stroke="hsl(213 90% 62%)" strokeWidth={1.5} fillOpacity={1} fill="url(#colorPnl)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              No trade data yet
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <div className="flex border-b border-border/50">
          {(['positions', 'history'] as const).map(t => (
            <button
              key={t}
              className={cn(
                "px-5 py-3 text-sm font-medium tracking-wide transition-colors capitalize",
                tab === t
                  ? "text-primary border-b-2 border-primary bg-primary/5"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setTab(t)}
            >
              {t === 'positions' ? `Open Positions (${openTrades?.length || 0})` : 'Trade History'}
            </button>
          ))}
        </div>
        
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Time</th>
                <th>Symbol</th>
                <th>Side</th>
                <th className="text-right">Size</th>
                <th className="text-right">Entry</th>
                {tab === 'history' && <th className="text-right">Exit</th>}
                <th className="text-right">SL</th>
                <th className="text-right">TP</th>
                <th className="text-right">P&L</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              {tab === 'positions' ? (
                openLoading
                  ? <tr><td colSpan={10} className="text-center py-10 text-muted-foreground">Loading…</td></tr>
                  : !openTrades?.length
                  ? <tr><td colSpan={10} className="text-center py-10 text-muted-foreground">No open trades.</td></tr>
                  : openTrades.map(t => (
                    <tr key={t.id}>
                      <td className="mono-num text-muted-foreground">#{t.id}</td>
                      <td className="mono-num text-xs">{new Date(t.entryTs).toLocaleTimeString()}</td>
                      <td className="font-semibold text-foreground">{t.symbol}</td>
                      <td>
                        <Badge variant={t.side === 'buy' ? 'success' : 'destructive'}>
                          {t.side === 'buy' ? <ArrowUpRight className="w-3 h-3"/> : <ArrowDownRight className="w-3 h-3"/>}
                          {t.side}
                        </Badge>
                      </td>
                      <td className="text-right mono-num">{formatNumber(t.size, 2)}</td>
                      <td className="text-right mono-num">{formatNumber(t.entryPrice, 3)}</td>
                      <td className="text-right mono-num text-destructive">{formatNumber(t.sl, 4)}</td>
                      <td className="text-right mono-num text-success">{formatNumber(t.tp, 4)}</td>
                      <td className="text-right mono-num">
                        <span className={cn(t.pnl && t.pnl > 0 ? "text-success" : t.pnl && t.pnl < 0 ? "text-destructive" : "")}>
                          {formatCurrency(t.pnl)}
                        </span>
                      </td>
                      <td><Badge variant="outline">{t.mode}</Badge></td>
                    </tr>
                  ))
              ) : (
                historyLoading
                  ? <tr><td colSpan={11} className="text-center py-10 text-muted-foreground">Loading…</td></tr>
                  : !historyTrades?.length
                  ? <tr><td colSpan={11} className="text-center py-10 text-muted-foreground">No trade history.</td></tr>
                  : historyTrades.map(t => (
                    <tr key={t.id}>
                      <td className="mono-num text-muted-foreground">#{t.id}</td>
                      <td className="mono-num text-xs">{new Date(t.entryTs).toLocaleDateString()} {new Date(t.entryTs).toLocaleTimeString()}</td>
                      <td className="font-semibold text-foreground">{t.symbol}</td>
                      <td>
                        <Badge variant={t.side === 'buy' ? 'success' : 'destructive'}>
                          {t.side === 'buy' ? <ArrowUpRight className="w-3 h-3"/> : <ArrowDownRight className="w-3 h-3"/>}
                          {t.side}
                        </Badge>
                      </td>
                      <td className="text-right mono-num">{formatNumber(t.size, 2)}</td>
                      <td className="text-right mono-num text-muted-foreground">{formatNumber(t.entryPrice, 3)}</td>
                      <td className="text-right mono-num">{formatNumber(t.exitPrice, 3)}</td>
                      <td className="text-right mono-num text-destructive">{formatNumber(t.sl, 4)}</td>
                      <td className="text-right mono-num text-success">{formatNumber(t.tp, 4)}</td>
                      <td className="text-right mono-num">
                        <span className={cn(t.pnl && t.pnl > 0 ? "text-success" : t.pnl && t.pnl < 0 ? "text-destructive" : "")}>
                          {formatCurrency(t.pnl)}
                        </span>
                      </td>
                      <td><Badge variant="outline">{t.mode}</Badge></td>
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
