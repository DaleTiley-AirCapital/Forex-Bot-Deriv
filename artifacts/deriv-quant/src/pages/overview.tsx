import React from "react";
import { useGetOverview, useGetPortfolioStatus, useGetAccountInfo, useGetLivePositions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, MetricValue, Badge } from "@/components/ui-elements";
import { cn, formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import { AlertTriangle, TrendingUp, Target, Activity, Wallet, ArrowUpDown } from "lucide-react";
import { motion } from "framer-motion";

export default function Overview() {
  const { data: overview, isLoading: overviewLoading } = useGetOverview({ query: { refetchInterval: 5000 } });
  const { data: portfolio, isLoading: portfolioLoading } = useGetPortfolioStatus({ query: { refetchInterval: 5000 } });
  const { data: accountInfo } = useGetAccountInfo({ query: { refetchInterval: 30000 } });
  const { data: positions } = useGetLivePositions({ query: { refetchInterval: 10000 } });

  if (overviewLoading || portfolioLoading) {
    return <div className="animate-pulse h-full w-full flex items-center justify-center text-muted-foreground font-mono">Loading System Data...</div>;
  }

  const pnlTrend = (overview?.realisedPnl || 0) >= 0 ? "up" : "down";
  const isLive = overview?.mode === "live";
  const isPaper = overview?.mode === "paper";

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">System Overview</h1>
          <p className="text-muted-foreground font-mono mt-1 text-sm">Last sync: {overview?.lastDataSyncAt ? new Date(overview.lastDataSyncAt).toLocaleTimeString() : 'Never'}</p>
        </div>
        {overview?.killSwitchActive && (
          <div className="flex items-center gap-2 bg-destructive/10 text-destructive px-4 py-2 rounded-lg border border-destructive/20 animate-pulse">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-bold uppercase tracking-wider text-sm">Kill Switch Active</span>
          </div>
        )}
      </div>

      {accountInfo?.connected && accountInfo.balance != null && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className={cn(
            "border-2",
            isLive ? "border-destructive/30" : isPaper ? "border-warning/30" : "border-primary/30"
          )}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    isLive ? "bg-destructive/10" : isPaper ? "bg-warning/10" : "bg-primary/10"
                  )}>
                    <Wallet className={cn(
                      "w-5 h-5",
                      isLive ? "text-destructive" : isPaper ? "text-warning" : "text-primary"
                    )} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-mono">
                      Deriv Account {accountInfo.loginid ? `(${accountInfo.loginid})` : ""}
                    </p>
                    <p className="text-2xl font-bold font-mono text-foreground">
                      {accountInfo.currency} {accountInfo.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant={isLive ? "destructive" : isPaper ? "warning" : "outline"}>
                    {overview?.mode?.toUpperCase() || "IDLE"}
                  </Badge>
                  {accountInfo.account_type && (
                    <p className="text-xs text-muted-foreground mt-1 font-mono capitalize">{accountInfo.account_type}</p>
                  )}
                </div>
              </div>
              {(accountInfo.equity != null || accountInfo.margin != null) && (
                <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-border/50">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">Equity</p>
                    <p className="text-sm font-bold font-mono">{accountInfo.equity?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">Margin</p>
                    <p className="text-sm font-bold font-mono">{accountInfo.margin?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">Free Margin</p>
                    <p className="text-sm font-bold font-mono">{accountInfo.free_margin?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">Margin Level</p>
                    <p className="text-sm font-bold font-mono">{accountInfo.margin_level_pct != null ? `${accountInfo.margin_level_pct.toFixed(1)}%` : "—"}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {!accountInfo?.connected && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border border-warning/30">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <Wallet className="w-5 h-5 text-warning" />
                <div>
                  <p className="text-sm font-medium text-foreground">Deriv Account Not Connected</p>
                  <p className="text-xs text-muted-foreground">
                    {accountInfo?.error || "Set your Deriv API token in Settings to see live account data"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card>
            <CardContent className="p-6">
              <MetricValue 
                label="Available Capital" 
                value={formatCurrency(overview?.availableCapital)} 
                mono 
              />
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Allocation</span>
                <Badge variant="outline">{portfolio?.allocationMode || 'N/A'}</Badge>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card>
            <CardContent className="p-6">
              <MetricValue 
                label="Realised P&L" 
                value={formatNumber(overview?.realisedPnl, 2)} 
                prefix="$"
                trend={pnlTrend}
                mono 
              />
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Win Rate</span>
                <span className="font-mono">{formatNumber(overview?.winRate, 1)}%</span>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card>
            <CardContent className="p-6">
              <MetricValue 
                label="Open Risk" 
                value={formatNumber(overview?.openRisk, 2)} 
                suffix="%"
                trend={overview?.openRisk && overview.openRisk > 5 ? "down" : "neutral"}
                mono 
              />
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Open Positions</span>
                <span className="font-mono">{overview?.openPositions || 0}</span>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card>
            <CardContent className="p-6">
              <MetricValue 
                label="Active Strategies" 
                value={overview?.activeStrategies || 0} 
                mono 
              />
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Model Status</span>
                <Badge variant={overview?.modelStatus === 'trained' ? 'success' : 'warning'}>
                  {overview?.modelStatus || 'unknown'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {positions && positions.length > 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.45 }}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowUpDown className="w-4 h-4" />
                Live Positions ({positions.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm font-mono">
                  <thead>
                    <tr className="border-b border-border/30">
                      <th className="text-left py-2 text-xs text-muted-foreground uppercase tracking-wider">Symbol</th>
                      <th className="text-left py-2 text-xs text-muted-foreground uppercase tracking-wider">Side</th>
                      <th className="text-right py-2 text-xs text-muted-foreground uppercase tracking-wider">Entry</th>
                      <th className="text-right py-2 text-xs text-muted-foreground uppercase tracking-wider">Current</th>
                      <th className="text-right py-2 text-xs text-muted-foreground uppercase tracking-wider">SL</th>
                      <th className="text-right py-2 text-xs text-muted-foreground uppercase tracking-wider">TP</th>
                      <th className="text-right py-2 text-xs text-muted-foreground uppercase tracking-wider">Size</th>
                      <th className="text-right py-2 text-xs text-muted-foreground uppercase tracking-wider">Float P&L</th>
                      <th className="text-right py-2 text-xs text-muted-foreground uppercase tracking-wider">Hrs Left</th>
                      <th className="text-center py-2 text-xs text-muted-foreground uppercase tracking-wider">Mode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => (
                      <tr key={p.id} className="border-b border-border/20 hover:bg-accent/30 transition-colors">
                        <td className="py-2.5 font-medium text-foreground">{p.symbol}</td>
                        <td className="py-2.5">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-xs font-bold uppercase",
                            p.side === "buy" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                          )}>
                            {p.side}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">{formatNumber(p.entryPrice, 2)}</td>
                        <td className="py-2.5 text-right">{formatNumber(p.currentPrice, 2)}</td>
                        <td className="py-2.5 text-right text-destructive">{formatNumber(p.sl, 2)}</td>
                        <td className="py-2.5 text-right text-success">{formatNumber(p.tp, 2)}</td>
                        <td className="py-2.5 text-right">${formatNumber(p.size, 0)}</td>
                        <td className={cn(
                          "py-2.5 text-right font-medium",
                          p.floatingPnl > 0 ? "text-success" : p.floatingPnl < 0 ? "text-destructive" : ""
                        )}>
                          {p.floatingPnl > 0 ? "+" : ""}{formatNumber(p.floatingPnl, 2)} ({formatNumber(p.floatingPnlPct, 1)}%)
                        </td>
                        <td className="py-2.5 text-right">{p.hoursRemaining}h</td>
                        <td className="py-2.5 text-center">
                          <Badge variant={p.mode === "live" ? "destructive" : "warning"} className="text-[10px]">
                            {p.mode}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Portfolio Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 font-mono text-sm">
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span className="text-muted-foreground">Account Balance</span>
                  <span>{formatCurrency(accountInfo?.balance ?? portfolio?.totalCapital)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span className="text-muted-foreground">Unrealised P&L</span>
                  <span className={cn(
                    portfolio?.unrealisedPnl && portfolio.unrealisedPnl > 0 ? "profit" : 
                    portfolio?.unrealisedPnl && portfolio.unrealisedPnl < 0 ? "loss" : ""
                  )}>
                    {formatCurrency(portfolio?.unrealisedPnl)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span className="text-muted-foreground">Daily P&L</span>
                  <span className={cn(
                    portfolio?.dailyPnl && portfolio.dailyPnl > 0 ? "profit" : 
                    portfolio?.dailyPnl && portfolio.dailyPnl < 0 ? "loss" : ""
                  )}>
                    {formatCurrency(portfolio?.dailyPnl)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span className="text-muted-foreground">Drawdown</span>
                  <span className="loss">{formatPercent(portfolio?.drawdownPct)}</span>
                </div>
                {portfolio?.suggestWithdrawal && (
                  <div className="mt-4 p-3 bg-success/10 border border-success/30 rounded text-success flex items-center justify-between">
                    <span>Withdrawal Target Reached</span>
                    <Badge variant="success">SUGGESTED</Badge>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.6 }}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-4 h-4" />
                Operational Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between mb-1 text-sm">
                    <span className="text-muted-foreground">Total Trades</span>
                    <span className="font-mono">{overview?.totalTrades || 0}</span>
                  </div>
                  <div className="w-full bg-muted/50 rounded-full h-2">
                    <div className="bg-primary h-2 rounded-full" style={{ width: `${Math.min(((overview?.totalTrades || 0) / 1000) * 100, 100)}%` }}></div>
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between mb-1 text-sm">
                    <span className="text-muted-foreground">Win Rate</span>
                    <span className="font-mono">{formatNumber(overview?.winRate, 1)}%</span>
                  </div>
                  <div className="w-full bg-muted/50 rounded-full h-2">
                    <div className="bg-success h-2 rounded-full" style={{ width: `${overview?.winRate || 0}%` }}></div>
                  </div>
                </div>

                <div className="pt-4 border-t border-border/50">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">System Checks</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Data Stream</span>
                      {overview?.mode !== 'idle' ? <Badge variant="success">ONLINE</Badge> : <Badge variant="outline">OFFLINE</Badge>}
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>Risk Engine</span>
                      {overview?.killSwitchActive ? <Badge variant="destructive">BLOCKED</Badge> : <Badge variant="success">ACTIVE</Badge>}
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>Deriv API</span>
                      {accountInfo?.connected ? <Badge variant="success">CONNECTED</Badge> : <Badge variant="outline">DISCONNECTED</Badge>}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
