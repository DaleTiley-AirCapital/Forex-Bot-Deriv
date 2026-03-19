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
  const [tab, setTab] = useState<'positions' | 'open' | 'history'>('positions');
  
  const { data: status } = useGetDataStatus({ query: { refetchInterval: 3000 } });
  const { data: positions, isLoading: positionsLoading } = useGetLivePositions({ query: { refetchInterval: 2000 } });
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
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Execution & Trades</h1>
          <p className="text-muted-foreground font-mono mt-1 text-sm">Portfolio execution and trade management</p>
        </div>
        
        <div className="flex items-center gap-3 p-2 glass-panel rounded-xl">
          {isTrading ? (
            <Button variant="destructive" onClick={() => stopTrades()} isLoading={stopping}>
              <Square className="w-4 h-4 mr-2" fill="currentColor" /> Stop Trading
            </Button>
          ) : (
            <>
              <Button variant="outline" className="text-warning border-warning/50 hover:bg-warning/10" onClick={() => startPaper()} isLoading={startingPaper}>
                <Play className="w-4 h-4 mr-2" /> Start Paper
              </Button>
              <Button variant="outline" className="text-success border-success/50 hover:bg-success/10" onClick={() => startLive()} isLoading={startingLive}>
                <Activity className="w-4 h-4 mr-2" /> Start Live
              </Button>
            </>
          )}
        </div>
      </div>

      {positions && positions.length > 0 && (
        <Card className="mb-6 border-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                Live Positions ({positions.length}/3)
              </CardTitle>
              <div className={cn("text-lg font-bold font-mono", totalFloatingPnl >= 0 ? "text-success" : "text-destructive")}>
                {totalFloatingPnl >= 0 ? "+" : ""}{formatCurrency(totalFloatingPnl)}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid gap-3 p-4 pt-0">
              {positions.map(p => (
                <div key={p.id} className="glass-panel rounded-lg p-4 border border-border/30">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Badge variant={p.side === 'buy' ? 'success' : 'destructive'} className="flex w-16 justify-center gap-1">
                        {p.side === 'buy' ? <ArrowUpRight className="w-3 h-3"/> : <ArrowDownRight className="w-3 h-3"/>}
                        {p.side}
                      </Badge>
                      <span className="font-bold text-foreground">{p.symbol}</span>
                      <span className="text-xs text-muted-foreground font-mono">{p.strategyName}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className={cn("text-lg font-bold font-mono", p.floatingPnl >= 0 ? "text-success" : "text-destructive")}>
                        {p.floatingPnl >= 0 ? "+" : ""}{formatCurrency(p.floatingPnl)}
                        <span className="text-xs ml-1">({p.floatingPnlPct >= 0 ? "+" : ""}{p.floatingPnlPct.toFixed(2)}%)</span>
                      </div>
                      <Badge variant="outline">{p.mode}</Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground block">Entry</span>
                      <span className="font-mono font-medium">{formatNumber(p.entryPrice, 4)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Current</span>
                      <span className={cn("font-mono font-medium", p.currentPrice > p.entryPrice ? "text-success" : p.currentPrice < p.entryPrice ? "text-destructive" : "")}>
                        {formatNumber(p.currentPrice, 4)}
                      </span>
                    </div>
                    <div className="flex items-start gap-1">
                      <ShieldAlert className="w-3 h-3 text-destructive mt-0.5" />
                      <div>
                        <span className="text-muted-foreground block">SL</span>
                        <span className="font-mono font-medium text-destructive">{formatNumber(p.sl, 4)}</span>
                      </div>
                    </div>
                    <div className="flex items-start gap-1">
                      <Target className="w-3 h-3 text-success mt-0.5" />
                      <div>
                        <span className="text-muted-foreground block">TP</span>
                        <span className="font-mono font-medium text-success">{formatNumber(p.tp, 4)}</span>
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Size</span>
                      <span className="font-mono font-medium">{formatCurrency(p.size)}</span>
                    </div>
                    <div className="flex items-start gap-1">
                      <Clock className="w-3 h-3 text-warning mt-0.5" />
                      <div>
                        <span className="text-muted-foreground block">Time Left</span>
                        <span className={cn("font-mono font-medium", p.hoursRemaining < 12 ? "text-warning" : "")}>{formatHours(p.hoursRemaining)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Cumulative P&L</CardTitle>
        </CardHeader>
        <CardContent className="h-[250px] p-0">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="time" hide />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                  itemStyle={{ color: 'hsl(var(--foreground))', fontFamily: 'monospace' }}
                  formatter={(val: number) => [formatCurrency(val), 'Cumulative P&L']}
                />
                <Area type="monotone" dataKey="pnl" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#colorPnl)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground font-mono">No trade data available</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <div className="flex border-b border-border/50">
          <button 
            className={cn("px-6 py-3 text-sm font-medium uppercase tracking-wider transition-colors", tab === 'positions' ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setTab('positions')}
          >
            Open Positions ({openTrades?.length || 0})
          </button>
          <button 
            className={cn("px-6 py-3 text-sm font-medium uppercase tracking-wider transition-colors", tab === 'history' ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setTab('history')}
          >
            Trade History
          </button>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
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
                openLoading ? <tr><td colSpan={10} className="text-center py-8 text-muted-foreground">Loading...</td></tr> :
                openTrades?.length === 0 ? <tr><td colSpan={10} className="text-center py-8 text-muted-foreground">No open trades.</td></tr> :
                openTrades?.map(t => (
                  <tr key={t.id}>
                    <td className="mono-num text-muted-foreground">#{t.id}</td>
                    <td className="mono-num">{new Date(t.entryTs).toLocaleTimeString()}</td>
                    <td className="font-bold">{t.symbol}</td>
                    <td>
                      <Badge variant={t.side === 'buy' ? 'success' : 'destructive'} className="flex w-16 justify-center gap-1">
                        {t.side === 'buy' ? <ArrowUpRight className="w-3 h-3"/> : <ArrowDownRight className="w-3 h-3"/>}
                        {t.side}
                      </Badge>
                    </td>
                    <td className="text-right mono-num">{formatNumber(t.size, 2)}</td>
                    <td className="text-right mono-num">{formatNumber(t.entryPrice, 3)}</td>
                    <td className="text-right mono-num text-destructive">{formatNumber(t.sl, 4)}</td>
                    <td className="text-right mono-num text-success">{formatNumber(t.tp, 4)}</td>
                    <td className="text-right mono-num">
                      <span className={cn(t.pnl && t.pnl > 0 ? "profit" : t.pnl && t.pnl < 0 ? "loss" : "")}>
                        {formatCurrency(t.pnl)}
                      </span>
                    </td>
                    <td><Badge variant="outline">{t.mode}</Badge></td>
                  </tr>
                ))
              ) : (
                historyLoading ? <tr><td colSpan={11} className="text-center py-8 text-muted-foreground">Loading...</td></tr> :
                historyTrades?.length === 0 ? <tr><td colSpan={11} className="text-center py-8 text-muted-foreground">No trade history.</td></tr> :
                historyTrades?.map(t => (
                  <tr key={t.id}>
                    <td className="mono-num text-muted-foreground">#{t.id}</td>
                    <td className="mono-num">{new Date(t.entryTs).toLocaleDateString()} {new Date(t.entryTs).toLocaleTimeString()}</td>
                    <td className="font-bold">{t.symbol}</td>
                    <td>
                      <Badge variant={t.side === 'buy' ? 'success' : 'destructive'} className="flex w-16 justify-center gap-1">
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
                      <span className={cn(t.pnl && t.pnl > 0 ? "profit" : t.pnl && t.pnl < 0 ? "loss" : "")}>
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
