import React from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  Activity, 
  BarChart2, 
  Radio, 
  History, 
  ShieldAlert, 
  Database,
  Terminal,
  Settings
} from "lucide-react";
import { useGetDataStatus } from "@workspace/api-client-react";

const NAV_ITEMS = [
  { name: "Overview", href: "/", icon: Activity },
  { name: "Research", href: "/research", icon: BarChart2 },
  { name: "Signals", href: "/signals", icon: Radio },
  { name: "Trades", href: "/trades", icon: History },
  { name: "Risk", href: "/risk", icon: ShieldAlert },
  { name: "Data", href: "/data", icon: Database },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  
  const { data: statusData } = useGetDataStatus({
    query: { refetchInterval: 5000, retry: false }
  });

  const mode = statusData?.mode || "idle";

  const isLive = mode === "live";
  const isPaper = mode === "paper";

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/30">
      <div className={cn(
        "w-64 border-r bg-card/50 backdrop-blur-sm flex flex-col z-20 shadow-2xl shadow-black/50",
        isLive ? "border-destructive/30" : isPaper ? "border-warning/30" : "border-border/50"
      )}>
        <div className={cn(
          "h-16 flex items-center px-6 border-b",
          isLive ? "border-destructive/30" : isPaper ? "border-warning/30" : "border-border/50"
        )}>
          <Terminal className={cn(
            "w-6 h-6 mr-3",
            isLive ? "text-destructive" : isPaper ? "text-warning" : "text-primary"
          )} />
          <h1 className="font-bold tracking-tight text-lg text-foreground">Deriv Quant</h1>
        </div>

        <div className={cn(
          "p-4 border-b",
          isLive ? "border-destructive/30" : isPaper ? "border-warning/30" : "border-border/50"
        )}>
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-muted-foreground uppercase tracking-wider">Status</span>
            <span className={cn(
              "flex items-center gap-1.5",
              isLive ? "text-destructive" : 
              isPaper ? "text-warning" : 
              mode === 'collecting' ? "text-primary" : "text-muted-foreground"
            )}>
              <span className="relative flex h-2 w-2">
                {(isLive || isPaper || mode === 'collecting') && (
                  <span className={cn(
                    "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                    isLive ? "bg-destructive" : isPaper ? "bg-warning" : "bg-primary"
                  )}></span>
                )}
                <span className={cn(
                  "relative inline-flex rounded-full h-2 w-2",
                  isLive ? "bg-destructive" : isPaper ? "bg-warning" : mode === 'collecting' ? "bg-primary" : "bg-muted-foreground"
                )}></span>
              </span>
              {mode.toUpperCase()}
            </span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.name} href={item.href} className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
                isActive 
                  ? "bg-primary/10 text-primary border border-primary/20 shadow-[inset_0_0_12px_rgba(var(--color-primary),0.1)]" 
                  : "text-muted-foreground hover:bg-accent hover:text-foreground border border-transparent"
              )}>
                <item.icon className={cn(
                  "w-4 h-4 transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                )} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border/50">
          <div className="text-xs text-muted-foreground font-mono text-center opacity-50">v0.1.0</div>
        </div>
      </div>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {(isLive || isPaper) && (
          <div className={cn(
            "flex items-center justify-center gap-2 py-1.5 text-xs font-bold uppercase tracking-widest z-20 relative",
            isLive 
              ? "bg-destructive/10 text-destructive border-b border-destructive/20" 
              : "bg-warning/10 text-warning border-b border-warning/20"
          )}>
            <span className="relative flex h-2 w-2">
              <span className={cn(
                "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                isLive ? "bg-destructive" : "bg-warning"
              )}></span>
              <span className={cn(
                "relative inline-flex rounded-full h-2 w-2",
                isLive ? "bg-destructive" : "bg-warning"
              )}></span>
            </span>
            {isLive ? "LIVE TRADING — REAL MONEY AT RISK" : "PAPER TRADING — SIMULATED"}
          </div>
        )}

        <div className="absolute top-0 inset-x-0 h-24 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
        
        <div className="flex-1 overflow-y-auto p-6 md:p-8 pt-8 z-0 relative">
          {children}
        </div>
      </main>
    </div>
  );
}
