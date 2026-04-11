import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetDataStatus,
  useStartStream,
  useStopStream,
  useGetTicks,
  useGetCandles,
  useGetSpikeEvents,
  getGetDataStatusQueryKey,
} from "@workspace/api-client-react";
import { formatNumber, cn } from "@/lib/utils";
import {
  Database, Play, Square, RefreshCw, Radio, RadioTower, Activity,
  TrendingUp, Layers, CheckCircle, XCircle, AlertTriangle, Eye, EyeOff,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL || "/";
function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  return fetch(`${BASE}api/${path.replace(/^\//, "")}`, opts).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTIVE_SYMBOLS = ["CRASH300", "BOOM300", "R_75", "R_100"];

const SYMBOL_LABELS: Record<string, string> = {
  BOOM1000: "Boom 1000",  CRASH1000: "Crash 1000",
  BOOM900:  "Boom 900",   CRASH900:  "Crash 900",
  BOOM600:  "Boom 600",   CRASH600:  "Crash 600",
  BOOM500:  "Boom 500",   CRASH500:  "Crash 500",
  BOOM300:  "Boom 300",   CRASH300:  "Crash 300",
  R_75:     "Vol 75",     R_100:     "Vol 100",
};

const ALL_SYMBOLS_SELECT = [
  { value: "BOOM1000", label: "Boom 1000" }, { value: "CRASH1000", label: "Crash 1000" },
  { value: "BOOM900",  label: "Boom 900"  }, { value: "CRASH900",  label: "Crash 900"  },
  { value: "BOOM600",  label: "Boom 600"  }, { value: "CRASH600",  label: "Crash 600"  },
  { value: "BOOM500",  label: "Boom 500"  }, { value: "CRASH500",  label: "Crash 500"  },
  { value: "BOOM300",  label: "Boom 300"  }, { value: "CRASH300",  label: "Crash 300"  },
  { value: "R_75",     label: "Vol 75"    }, { value: "R_100",     label: "Vol 100"    },
];

const ALL_STREAM_SYMBOLS = ALL_SYMBOLS_SELECT.map(s => s.value);

// ── Types ─────────────────────────────────────────────────────────────────────

interface SymbolDiagnostic {
  symbol: string;
  streaming: boolean;
  streamingState: string;
  apiSymbol: string | null;
  lastTick?: number | null;
}

interface DataStatusSymbol {
  symbol: string;
  tier: string;
  count1m: number;
  count5m: number;
  totalCandles: number;
  oldestDate: string | null;
  newestDate: string | null;
  lastBacktestDate: string | null;
  status: string;
}

interface ResearchDataStatus {
  symbols: DataStatusSymbol[];
  totalStorage: number;
  symbolCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAge(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useSymbolDiagnostics() {
  return useQuery<{ symbols: SymbolDiagnostic[] }>({
    queryKey: ["diagnostics-symbols"],
    queryFn: () => apiFetch("diagnostics/symbols"),
    refetchInterval: 6000,
    retry: 1,
  });
}

function useResearchDataStatus() {
  return useQuery<ResearchDataStatus>({
    queryKey: ["research/data-status"],
    queryFn: () => apiFetch("research/data-status"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// ── Stream State Chip ─────────────────────────────────────────────────────────

function StreamState({ state }: { state: string | undefined }) {
  const cfg: Record<string, { cls: string; label: string }> = {
    streaming: { cls: "bg-green-500/12 text-green-400 border-green-500/25", label: "Streaming" },
    available: { cls: "bg-blue-500/12 text-blue-400 border-blue-500/25",   label: "Available" },
    idle:      { cls: "bg-muted/30 text-muted-foreground border-border/40", label: "Idle"      },
    disabled:  { cls: "bg-red-500/12 text-red-400 border-red-500/25",       label: "Disabled"  },
  };
  const s = cfg[state ?? "idle"] ?? cfg.idle;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border", s.cls)}>
      {state === "streaming" && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
      {s.label}
    </span>
  );
}

// ── Coverage Status Chip ──────────────────────────────────────────────────────

function CoverageStatus({ sym }: { sym: DataStatusSymbol }) {
  if (sym.status === "no_data" || sym.totalCandles === 0) {
    return <span className="text-[10px] px-2 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/20 font-semibold">No data</span>;
  }
  if (!sym.newestDate) {
    return <span className="text-[10px] px-2 py-0.5 rounded border bg-muted/30 text-muted-foreground border-border/40 font-semibold">Unknown</span>;
  }
  const hrs = (Date.now() - new Date(sym.newestDate).getTime()) / 3_600_000;
  if (hrs < 24) {
    return <span className="text-[10px] px-2 py-0.5 rounded border bg-green-500/10 text-green-400 border-green-500/20 font-semibold">Current</span>;
  }
  return (
    <span className="text-[10px] px-2 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/20 font-semibold">
      Stale {formatAge(sym.newestDate)}
    </span>
  );
}

// ── Symbol State Row (streaming tab) ─────────────────────────────────────────

function SymbolStreamRow({ sym, diag, coverage, onToggle }: {
  sym: string;
  diag?: SymbolDiagnostic;
  coverage?: DataStatusSymbol;
  onToggle: (sym: string, enable: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const isActive = ACTIVE_SYMBOLS.includes(sym);
  const state = diag?.streamingState ?? "idle";

  async function toggle() {
    setBusy(true);
    try { await onToggle(sym, state !== "streaming"); }
    finally { setBusy(false); }
  }

  return (
    <tr className={cn("border-b border-border/20 last:border-0", isActive ? "bg-primary/2" : "")}>
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-2">
          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
          <span className="font-mono font-semibold text-sm text-foreground">{sym}</span>
          {SYMBOL_LABELS[sym] && <span className="text-[11px] text-muted-foreground">{SYMBOL_LABELS[sym]}</span>}
        </div>
      </td>
      <td className="py-2.5 px-3"><StreamState state={state} /></td>
      <td className="py-2.5 px-3 tabular-nums text-xs text-muted-foreground">
        {coverage?.count1m ? coverage.count1m.toLocaleString() : "—"}
      </td>
      <td className="py-2.5 px-3 tabular-nums text-xs text-muted-foreground">
        {coverage?.count5m ? coverage.count5m.toLocaleString() : "—"}
      </td>
      <td className="py-2.5 px-3 text-[11px] text-muted-foreground">
        {coverage ? formatAge(coverage.newestDate) : "—"}
      </td>
      <td className="py-2.5 px-4">
        {isActive && (
          <button
            onClick={toggle}
            disabled={busy}
            className={cn(
              "px-2.5 py-0.5 rounded text-[11px] font-medium border transition-colors inline-flex items-center gap-1",
              state === "streaming"
                ? "bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/20"
                : "bg-green-500/10 border-green-500/25 text-green-400 hover:bg-green-500/20",
              busy && "opacity-50 cursor-not-allowed"
            )}>
            {busy
              ? <RefreshCw className="w-3 h-3 animate-spin" />
              : state === "streaming"
                ? <><EyeOff className="w-3 h-3" /> Pause</>
                : <><Eye className="w-3 h-3" /> Stream</>}
          </button>
        )}
      </td>
    </tr>
  );
}

// ── Coverage Table ────────────────────────────────────────────────────────────

function CoverageTable({ data, tier }: { data: DataStatusSymbol[]; tier?: string }) {
  const rows = tier ? data.filter(s => s.tier === tier) : data;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground py-4">No symbols in this tier.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-muted-foreground uppercase tracking-wide border-b border-border/40 bg-muted/10">
            <th className="text-left py-2.5 px-4 font-medium">Symbol</th>
            <th className="text-left py-2.5 px-3 font-medium">Tier</th>
            <th className="text-right py-2.5 px-3 font-medium">M1 Candles</th>
            <th className="text-right py-2.5 px-3 font-medium">M5 Candles</th>
            <th className="text-right py-2.5 px-3 font-medium">Total</th>
            <th className="text-center py-2.5 px-3 font-medium">Oldest</th>
            <th className="text-center py-2.5 px-3 font-medium">Newest</th>
            <th className="text-center py-2.5 px-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(sym => {
            const isActive = ACTIVE_SYMBOLS.includes(sym.symbol);
            return (
              <tr key={sym.symbol} className={cn("border-b border-border/20 hover:bg-muted/10", isActive ? "bg-primary/2" : "")}>
                <td className="py-2.5 px-4">
                  <div className="flex items-center gap-2">
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                    <span className="font-mono font-semibold text-foreground">{sym.symbol}</span>
                    {SYMBOL_LABELS[sym.symbol] && (
                      <span className="text-[11px] text-muted-foreground">{SYMBOL_LABELS[sym.symbol]}</span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 px-3">
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase",
                    sym.tier === "active" ? "bg-primary/10 text-primary border-primary/25"
                    : sym.tier === "data" ? "bg-blue-500/10 text-blue-400 border-blue-500/25"
                    : "bg-muted/30 text-muted-foreground border-border/40"
                  )}>
                    {sym.tier}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums">
                  {sym.count1m > 0 ? <span className="text-foreground font-medium">{sym.count1m.toLocaleString()}</span> : <span className="text-muted-foreground/40">—</span>}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums">
                  {sym.count5m > 0 ? <span className="text-foreground font-medium">{sym.count5m.toLocaleString()}</span> : <span className="text-muted-foreground/40">—</span>}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">
                  {sym.totalCandles > 0 ? sym.totalCandles.toLocaleString() : "—"}
                </td>
                <td className="py-2.5 px-3 text-center text-xs text-muted-foreground">{formatDate(sym.oldestDate)}</td>
                <td className="py-2.5 px-3 text-center text-xs text-muted-foreground">
                  {sym.newestDate
                    ? <span title={sym.newestDate}>{formatDate(sym.newestDate)} <span className="text-muted-foreground/50">({formatAge(sym.newestDate)})</span></span>
                    : "—"}
                </td>
                <td className="py-2.5 px-3 text-center"><CoverageStatus sym={sym} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Integrity Summary ─────────────────────────────────────────────────────────

function IntegritySummary({ data }: { data: ResearchDataStatus }) {
  const active = data.symbols.filter(s => s.tier === "active");
  const withData = data.symbols.filter(s => s.totalCandles > 0);
  const noData = data.symbols.filter(s => s.totalCandles === 0);
  const current = data.symbols.filter(s => {
    if (!s.newestDate) return false;
    return (Date.now() - new Date(s.newestDate).getTime()) < 24 * 3_600_000;
  });
  const stale = withData.filter(s => {
    if (!s.newestDate) return false;
    return (Date.now() - new Date(s.newestDate).getTime()) >= 24 * 3_600_000;
  });
  const totalM = (data.totalStorage / 1_000_000).toFixed(2);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <div className="rounded-xl border border-border/50 bg-card p-4">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">Total Symbols</p>
        <p className="text-2xl font-bold tabular-nums">{data.symbolCount}</p>
      </div>
      <div className="rounded-xl border border-border/50 bg-card p-4">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">Total Candles</p>
        <p className="text-2xl font-bold tabular-nums">{totalM}M</p>
      </div>
      <div className="rounded-xl border border-border/50 bg-card p-4">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">
          <CheckCircle className="w-3 h-3 inline mr-1 text-green-400" />Current
        </p>
        <p className="text-2xl font-bold tabular-nums text-green-400">{current.length}</p>
        <p className="text-[10px] text-muted-foreground">within 24h</p>
      </div>
      <div className="rounded-xl border border-border/50 bg-card p-4">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">
          <AlertTriangle className="w-3 h-3 inline mr-1 text-amber-400" />Stale
        </p>
        <p className="text-2xl font-bold tabular-nums text-amber-400">{stale.length}</p>
        <p className="text-[10px] text-muted-foreground">&gt;24h behind</p>
      </div>
      <div className="rounded-xl border border-border/50 bg-card p-4">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">
          <XCircle className="w-3 h-3 inline mr-1 text-red-400" />No Data
        </p>
        <p className="text-2xl font-bold tabular-nums text-red-400">{noData.length}</p>
        <p className="text-[10px] text-muted-foreground">research symbols</p>
      </div>
    </div>
  );
}

// ── Tab Types ─────────────────────────────────────────────────────────────────

type ViewTab = "streaming" | "coverage" | "ticks" | "candles" | "spikes";

// ── Main Component ────────────────────────────────────────────────────────────

export default function DataManager() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ViewTab>("streaming");
  const [symbol, setSymbol] = useState("BOOM300");
  const [coverageTier, setCoverageTier] = useState<"" | "active" | "data" | "research">("");

  const { data: status } = useGetDataStatus({ query: { refetchInterval: 3000 } });
  const { data: diagData, refetch: refetchDiag } = useSymbolDiagnostics();
  const { data: researchData, isLoading: researchLoading } = useResearchDataStatus();

  const invalidator = {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetDataStatusQueryKey() }),
  };
  const { mutate: startStream, isPending: startingStream } = useStartStream({ mutation: invalidator });
  const { mutate: stopStream,  isPending: stoppingStream  } = useStopStream({ mutation: invalidator });

  const { data: ticks }   = useGetTicks(
    { symbol, limit: 30 },
    { query: { enabled: tab === "ticks",   refetchInterval: 2000 } }
  );
  const { data: candles } = useGetCandles(
    { symbol, timeframe: "M1", limit: 30 },
    { query: { enabled: tab === "candles", refetchInterval: 5000 } }
  );
  const { data: spikes }  = useGetSpikeEvents(
    { symbol, limit: 30 },
    { query: { enabled: tab === "spikes",  refetchInterval: 5000 } }
  );

  const diagSymbols = diagData?.symbols ?? [];
  const streamingCount = diagSymbols.filter(d => d.streamingState === "streaming").length;

  async function toggleStream(sym: string, enable: boolean) {
    await apiFetch(`diagnostics/symbols/${sym}/streaming`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: enable }),
    });
    refetchDiag();
  }

  function getCoverageForSymbol(sym: string): DataStatusSymbol | undefined {
    return researchData?.symbols.find(s => s.symbol === sym);
  }

  const tabs: { id: ViewTab; label: string; icon: React.ElementType }[] = [
    { id: "streaming",  label: "Symbol State",     icon: Radio       },
    { id: "coverage",   label: "Candle Coverage",  icon: Database    },
    { id: "ticks",      label: "Live Ticks",        icon: Activity    },
    { id: "candles",    label: "M1 Candles",        icon: TrendingUp  },
    { id: "spikes",     label: "Spike Events",      icon: Layers      },
  ];

  return (
    <div className="space-y-5 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Database className="w-6 h-6 text-primary" /> Data Operations
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tick ingestion, candle coverage, streaming state, and per-symbol controls
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={status?.streaming}
            onClick={() => startStream({ data: { symbols: ALL_STREAM_SYMBOLS } })}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
              "bg-green-500/10 border-green-500/25 text-green-400 hover:bg-green-500/20",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}>
            {startingStream ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Start All
          </button>
          <button
            disabled={!status?.streaming}
            onClick={() => stopStream()}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
              "bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/20",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}>
            {stoppingStream ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
            Stop All
          </button>
        </div>
      </div>

      {/* Stream summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border/50 bg-card p-4 flex items-center gap-4">
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
            status?.streaming ? "bg-green-500/12 text-green-400" : "bg-muted/30 text-muted-foreground"
          )}>
            {status?.streaming ? <RadioTower className="w-5 h-5" /> : <Radio className="w-5 h-5" />}
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-0.5">Global Stream</p>
            <p className={cn("text-sm font-bold", status?.streaming ? "text-green-400" : "text-muted-foreground")}>
              {status?.streaming ? "Live" : "Offline"}
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Activity className="w-3 h-3" /> Streaming Symbols
          </p>
          <p className="text-2xl font-bold tabular-nums">{streamingCount}</p>
          <p className="text-[10px] text-muted-foreground">of {diagSymbols.length} validated</p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Layers className="w-3 h-3" /> Total Ticks Ingested
          </p>
          <p className="text-2xl font-bold tabular-nums">
            {status?.tickCount != null ? status.tickCount.toLocaleString() : "—"}
          </p>
          <p className="text-[10px] text-muted-foreground">since last stream start</p>
        </div>
      </div>

      {/* Integrity summary from coverage data */}
      {researchData && <IntegritySummary data={researchData} />}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border/50 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors",
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border/60"
            )}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* ── Symbol State (Streaming) ── */}
      {tab === "streaming" && (
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Radio className="w-4 h-4 text-primary" /> Per-Symbol Streaming State
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Active trading symbols highlighted · Toggle per-symbol streaming · Candle counts from coverage data
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-muted-foreground uppercase tracking-wide border-b border-border/30 bg-muted/10">
                  <th className="text-left py-2.5 px-4 font-medium">Symbol</th>
                  <th className="text-left py-2.5 px-3 font-medium">Stream State</th>
                  <th className="text-right py-2.5 px-3 font-medium">M1 Candles</th>
                  <th className="text-right py-2.5 px-3 font-medium">M5 Candles</th>
                  <th className="text-right py-2.5 px-3 font-medium">Last Updated</th>
                  <th className="text-left py-2.5 px-4 font-medium">Control</th>
                </tr>
              </thead>
              <tbody>
                {/* Active symbols first */}
                {ACTIVE_SYMBOLS.map(sym => (
                  <SymbolStreamRow
                    key={sym}
                    sym={sym}
                    diag={diagSymbols.find(d => d.symbol === sym)}
                    coverage={getCoverageForSymbol(sym)}
                    onToggle={toggleStream} />
                ))}

                {diagSymbols.filter(d => !ACTIVE_SYMBOLS.includes(d.symbol)).length > 0 && (
                  <tr key="__separator__">
                    <td colSpan={6} className="text-[10px] text-muted-foreground/50 uppercase tracking-wider py-1.5 px-4 bg-muted/10">
                      Non-Active / Research Symbols
                    </td>
                  </tr>
                )}
                {diagSymbols
                  .filter(d => !ACTIVE_SYMBOLS.includes(d.symbol))
                  .map(d => (
                    <SymbolStreamRow
                      key={d.symbol}
                      sym={d.symbol}
                      diag={d}
                      coverage={getCoverageForSymbol(d.symbol)}
                      onToggle={toggleStream} />
                  ))}

                {diagSymbols.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-sm text-muted-foreground">
                      Loading symbol diagnostics…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Coverage Tab ── */}
      {tab === "coverage" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-xs text-muted-foreground font-medium">Filter tier:</label>
            <select value={coverageTier} onChange={e => setCoverageTier(e.target.value as typeof coverageTier)}
              className="bg-card border border-border/50 rounded-md px-2.5 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none">
              <option value="">All tiers</option>
              <option value="active">Active</option>
              <option value="data">Data</option>
              <option value="research">Research</option>
            </select>
          </div>

          {researchLoading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Loading coverage data…</div>
          ) : researchData ? (
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Database className="w-4 h-4 text-primary" /> Candle Coverage — All {researchData.symbolCount} Symbols
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {(researchData.totalStorage / 1_000_000).toFixed(2)}M total candles stored across all symbols
                  · Active symbols highlighted
                </p>
              </div>
              <CoverageTable data={researchData.symbols} tier={coverageTier || undefined} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Coverage data unavailable.</p>
          )}
        </div>
      )}

      {/* ── Data Viewer Tabs (Ticks / Candles / Spikes) ── */}
      {(tab === "ticks" || tab === "candles" || tab === "spikes") && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-xs text-muted-foreground font-medium">Symbol:</label>
            <select className="bg-card border border-border/50 rounded-md px-2.5 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none h-8 w-48"
              value={symbol} onChange={e => setSymbol(e.target.value)}>
              {ALL_SYMBOLS_SELECT.map(s => (
                <option key={s.value} value={s.value}>{s.value} — {s.label}</option>
              ))}
            </select>
          </div>

          {/* Live Ticks */}
          {tab === "ticks" && (
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" /> Live Ticks — {symbol}
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-muted-foreground uppercase tracking-wide border-b border-border/30 bg-muted/10">
                      <th className="text-left py-2 px-4 font-medium">Time</th>
                      <th className="text-left py-2 px-3 font-medium">Symbol</th>
                      <th className="text-right py-2 px-3 font-medium">Quote</th>
                      <th className="text-right py-2 px-4 font-medium">Epoch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!ticks?.length
                      ? <tr><td colSpan={4} className="text-center py-10 text-sm text-muted-foreground">No tick data for {symbol}</td></tr>
                      : ticks.map(t => (
                        <tr key={t.id} className="border-b border-border/15 hover:bg-muted/10">
                          <td className="py-2 px-4 tabular-nums text-xs text-muted-foreground">
                            {new Date(t.createdAt).toLocaleTimeString()}
                          </td>
                          <td className="py-2 px-3 text-sm font-medium">{symbol}</td>
                          <td className="py-2 px-3 text-right tabular-nums font-semibold">{formatNumber(t.quote, 4)}</td>
                          <td className="py-2 px-4 text-right tabular-nums text-xs text-muted-foreground/50">{t.epochTs}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* M1 Candles */}
          {tab === "candles" && (
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" /> M1 Candles — {symbol}
                </h2>
                {getCoverageForSymbol(symbol) && (
                  <span className="text-[11px] text-muted-foreground">
                    {getCoverageForSymbol(symbol)!.count1m.toLocaleString()} M1 candles total
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-muted-foreground uppercase tracking-wide border-b border-border/30 bg-muted/10">
                      <th className="text-left py-2 px-4 font-medium">Time</th>
                      <th className="text-right py-2 px-3 font-medium">Open</th>
                      <th className="text-right py-2 px-3 font-medium">High</th>
                      <th className="text-right py-2 px-3 font-medium">Low</th>
                      <th className="text-right py-2 px-3 font-medium">Close</th>
                      <th className="text-right py-2 px-4 font-medium">Ticks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!candles?.length
                      ? <tr><td colSpan={6} className="text-center py-10 text-sm text-muted-foreground">No candle data for {symbol}</td></tr>
                      : candles.map(c => (
                        <tr key={c.id} className="border-b border-border/15 hover:bg-muted/10">
                          <td className="py-2 px-4 tabular-nums text-xs text-muted-foreground">
                            {new Date(c.openTs * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">{formatNumber(c.open, 3)}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-green-400">{formatNumber(c.high, 3)}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-red-400">{formatNumber(c.low, 3)}</td>
                          <td className="py-2 px-3 text-right tabular-nums font-semibold">{formatNumber(c.close, 3)}</td>
                          <td className="py-2 px-4 text-right tabular-nums text-muted-foreground">{c.tickCount}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Spike Events */}
          {tab === "spikes" && (
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" /> Spike Events — {symbol}
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Boom/Crash spike events captured from live tick stream
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-muted-foreground uppercase tracking-wide border-b border-border/30 bg-muted/10">
                      <th className="text-left py-2 px-4 font-medium">Time</th>
                      <th className="text-left py-2 px-3 font-medium">Direction</th>
                      <th className="text-right py-2 px-3 font-medium">Size</th>
                      <th className="text-right py-2 px-4 font-medium">Ticks Since Previous</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!spikes?.length
                      ? <tr><td colSpan={4} className="text-center py-10 text-sm text-muted-foreground">No spike events for {symbol}</td></tr>
                      : spikes.map(s => (
                        <tr key={s.id} className="border-b border-border/15 hover:bg-muted/10">
                          <td className="py-2 px-4 tabular-nums text-xs text-muted-foreground">
                            {new Date(s.eventTs * 1000).toLocaleTimeString()}
                          </td>
                          <td className="py-2 px-3">
                            <span className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border",
                              s.direction === "up"
                                ? "bg-green-500/10 text-green-400 border-green-500/25"
                                : "bg-red-500/10 text-red-400 border-red-500/25"
                            )}>
                              {s.direction === "up" ? "↑ Up" : "↓ Down"}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums font-semibold">{formatNumber(s.spikeSize, 2)}</td>
                          <td className="py-2 px-4 text-right tabular-nums text-muted-foreground">
                            {s.ticksSincePreviousSpike || "—"}
                          </td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

