import React from "react";
import { 
  useGetRiskStatus, 
  useTriggerKillSwitch, 
  useSetPortfolioMode, 
  getGetRiskStatusQueryKey,
  useGetPortfolioStatus,
  getGetPortfolioStatusQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, MetricValue } from "@/components/ui-elements";
import { formatPercent, cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, AlertOctagon, Lock } from "lucide-react";
import { motion } from "framer-motion";

export default function Risk() {
  const queryClient = useQueryClient();
  const { data: risk } = useGetRiskStatus({ query: { refetchInterval: 3000 } });
  const { data: portfolio } = useGetPortfolioStatus();

  const { mutate: triggerKill, isPending: killing } = useTriggerKillSwitch({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetRiskStatusQueryKey() })
    }
  });

  const { mutate: setMode, isPending: settingMode } = useSetPortfolioMode({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetPortfolioStatusQueryKey() })
    }
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Risk Manager</h1>
          <p className="text-muted-foreground font-mono mt-1 text-sm">Global portfolio constraints and limits</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="w-4 h-4" />
                Exposure & Limits
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6">
              <div className="space-y-2">
                <MetricValue 
                  label="Daily Loss" 
                  value={formatPercent(risk?.dailyLossPct)} 
                  trend={risk?.dailyLossBreached ? "down" : "neutral"}
                />
                <div className="w-full bg-muted/50 rounded-full h-1.5 mt-2">
                  <div className={cn("h-1.5 rounded-full", risk?.dailyLossBreached ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.min((Math.abs(risk?.dailyLossPct || 0) / 5) * 100, 100)}%` }}></div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Limit: -5.0%</p>
              </div>

              <div className="space-y-2">
                <MetricValue 
                  label="Weekly Loss" 
                  value={formatPercent(risk?.weeklyLossPct)} 
                  trend={risk?.weeklyLossBreached ? "down" : "neutral"}
                />
                <div className="w-full bg-muted/50 rounded-full h-1.5 mt-2">
                  <div className={cn("h-1.5 rounded-full", risk?.weeklyLossBreached ? "bg-destructive" : "bg-warning")} style={{ width: `${Math.min((Math.abs(risk?.weeklyLossPct || 0) / 10) * 100, 100)}%` }}></div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Limit: -10.0%</p>
              </div>

              <div className="space-y-2">
                <MetricValue 
                  label="Max Drawdown" 
                  value={formatPercent(risk?.drawdownPct)} 
                  trend={risk?.maxDrawdownBreached ? "down" : "neutral"}
                />
                <div className="w-full bg-muted/50 rounded-full h-1.5 mt-2">
                  <div className={cn("h-1.5 rounded-full", risk?.maxDrawdownBreached ? "bg-destructive" : "bg-primary/50")} style={{ width: `${Math.min((Math.abs(risk?.drawdownPct || 0) / 20) * 100, 100)}%` }}></div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Limit: -20.0%</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Strategy Constraints</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">Active Cooldowns</h4>
                  {risk?.activeCooldowns?.length ? (
                    <div className="space-y-2">
                      {risk.activeCooldowns.map(c => (
                        <div key={c} className="flex items-center justify-between p-2 rounded bg-muted/30 border border-border">
                          <span className="font-mono text-sm text-warning">{c}</span>
                          <Badge variant="warning">COOLING</Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No strategies currently in cooldown.</p>
                  )}
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">Disabled Strategies</h4>
                  {risk?.disabledStrategies?.length ? (
                    <div className="space-y-2">
                      {risk.disabledStrategies.map(s => (
                        <div key={s} className="flex items-center justify-between p-2 rounded bg-destructive/10 border border-destructive/20 text-destructive">
                          <span className="font-mono text-sm">{s}</span>
                          <Badge variant="destructive">DISABLED</Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">All strategies enabled.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
          <Card className={cn("border-2 shadow-2xl transition-colors duration-500", risk?.killSwitchActive ? "border-destructive bg-destructive/5" : "border-border")}>
            <CardContent className="p-8 flex flex-col items-center text-center">
              <div className={cn("p-4 rounded-full mb-4", risk?.killSwitchActive ? "bg-destructive/20 text-destructive animate-pulse" : "bg-muted text-muted-foreground")}>
                <ShieldAlert className="w-12 h-12" />
              </div>
              <h2 className="text-xl font-bold mb-2 text-foreground">Global Kill Switch</h2>
              <p className="text-sm text-muted-foreground mb-8">
                Instantly flattens all open positions and disables new trade entries across all strategies.
              </p>
              <Button 
                variant="destructive" 
                size="lg" 
                className="w-full text-lg font-bold shadow-destructive/20 shadow-xl"
                onClick={() => triggerKill()}
                isLoading={killing}
                disabled={risk?.killSwitchActive}
              >
                <AlertOctagon className="w-5 h-5 mr-2" />
                {risk?.killSwitchActive ? "SYSTEM HALTED" : "ENGAGE KILL SWITCH"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Portfolio Allocation Mode</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(['conservative', 'balanced', 'aggressive'] as const).map(mode => (
                <button
                  key={mode}
                  disabled={settingMode || portfolio?.allocationMode === mode}
                  onClick={() => setMode({ data: { mode } })}
                  className={cn(
                    "w-full text-left p-3 rounded-lg border transition-all flex items-center justify-between",
                    portfolio?.allocationMode === mode 
                      ? "bg-primary/10 border-primary text-primary" 
                      : "border-border hover:border-primary/50 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="font-medium uppercase tracking-wider text-sm">{mode}</span>
                  {portfolio?.allocationMode === mode && <Badge variant="default">ACTIVE</Badge>}
                </button>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
