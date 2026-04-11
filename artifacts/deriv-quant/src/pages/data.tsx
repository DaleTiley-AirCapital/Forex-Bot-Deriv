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
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Select } from "@/components/ui-elements";
import { formatNumber, cn } from "@/lib/utils";
import {
  Database, Play, Square, RefreshCw, Radio, RadioTower, Activity,
  TrendingUp, Layers, AlertTriangle, CheckCircle, Eye, EyeOff,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL || "/";
function apiFetch(path: string, opts?: RequestInit) {
  return fetch(`${BASE}api/${path.replace(/^\//, "")}`, opts).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
}

const ACTIVE_SYMBOLS = ["CRASH300", "BOOM300", "R_75", "R_100"];

const SYMBOL_LABELS: Record<string, string> = {
  BOOM1000: "Boom 1000", CRASH1000: "Crash 1000",
  BOOM900: "Boom 900",   CRASH900: "Crash 900",
  BOOM600: "Boom 600",   CRASH600: "Crash 600",
  BOOM500: "Boom 500",   CRASH500: "Crash 500",
  BOOM300: "Boom 300",   CRASH300: "Crash 300",
  R_75: "Vol 75",        R_100: "Vol 100",
};

const ALL_SYMBOLS_SELECT = [
  { value: "BOOM1000", label: "Boom 1000" },
  { value: "CRASH1000", label: "Crash 1000" },
  { value: "BOOM900",  label: "Boom 900"   },
  { value: "CRASH900", label: "Crash 900"  },
  { value: "BOOM600",  label: "Boom 600"   },
  { value: "CRASH600", label: "Crash 600"  },
  { value: "BOOM500",  label: "Boom 500"   },
  { value: "CRASH500", label: "Crash 500"  },
  { value: "BOOM300",  label: "Boom 300"   },
  { value: "CRASH300", label: "Crash 300"  },
  { value: "R_75",     label: "Vol 75"     },
  { value: "R_100",    label: "Vol 100"    },
];

const ALL_STREAM_SYMBOLS = ALL_SYMBOLS_SELECT.map(s => s.value);

interface SymbolDiagnostic {
  symbol: string;
  streaming: boolean;
  streamingState: string;
  apiSymbol: string | null;
  lastTick?: number | null;
}

function useSymbolDiagnostics() {
  return useQuery<{ symbols: SymbolDiagnostic[] }>({
    queryKey: ["diagnostics-symbols"],
    queryFn: () => apiFetch("diagnostics/symbols"),
    refetchInterval: 6000,
    retry: 1,
  });
}

function StreamState({ state }: { state: string | undefined }) {
  const cfg: Record<string, { cls: string; label: string }> = {
    streaming: { cls: "bg-green-500/12 text-green-400 border-green-500/25", label: "Streaming" },
    available:  { cls: "bg-blue-500/12 text-blue-400 border-blue-500/25",   label: "Available" },
    idle:       { cls: "bg-muted/30 text-muted-foreground border-border/40", label: "Idle"      },
    disabled:   { cls: "bg-red-500/12 text-red-400 border-red-500/25",      label: "Disabled"  },
  };
  const s = cfg[state ?? "idle"] ?? cfg.idle;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border", s.cls)}>
      {state === "streaming" && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />}
      {s.label}
    </span>
  );
}

function SymbolRow({ sym, diag, onToggle }: {
  sym: string;
  diag?: SymbolDiagnostic;
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
    <tr className={cn(isActive ? "bg-primary/3" : "")}>
      <td>
        <div className="flex items-center gap-2">
          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />}
          <span className="font-semibold text-foreground">{sym}</span>
          {SYMBOL_LABELS[sym] && (
            <span className="text-[11px] text-muted-foreground">{SYMBOL_LABELS[sym]}</span>
          )}
        </div>
      </td>
      <td><StreamState state={state} /></td>
      <td className="mono-num text-xs text-muted-foreground">
        {diag?.apiSymbol && diag.apiSymbol !== sym ? `→ ${diag.apiSymbol}` : "—"}
      </td>
      <td>
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
            )}
          >
            {busy
              ? <RefreshCw className="w-3 h-3 animate-spin" />
              : state === "streaming"
                ? <><EyeOff className="w-3 h-3" /> Pause</>
                : <><Eye className="w-3 h-3" /> Stream</>
            }
          </button>
        )}
      </td>
    </tr>
  );
}

type ViewTab = "overview" | "ticks" | "candles" | "spikes";

export default function DataManager() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ViewTab>("overview");
  const [symbol, setSymbol] = useState("BOOM300");

  const { data: status } = useGetDataStatus({ query: { refetchInterval: 3000 } });
  const { data: diagData, refetch: refetchDiag } = useSymbolDiagnostics();

  const invalidator = {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetDataStatusQueryKey() }),
  };
  const { mutate: startStream, isPending: startingStream } = useStartStream({ mutation: invalidator });
  const { mutate: stopStream,  isPending: stoppingStream  } = useStopStream({ mutation: invalidator });

  const { data: ticks }   = useGetTicks(
    { symbol, limit: 20 },
    { query: { enabled: tab === "ticks",   refetchInterval: 2000 } }
  );
  const { data: candles } = useGetCandles(
    { symbol, timeframe: "M1", limit: 20 },
    { query: { enabled: tab === "candles", refetchInterval: 5000 } }
  );
  const { data: spikes }  = useGetSpikeEvents(
    { symbol, limit: 20 },
    { query: { enabled: tab === "spikes",  refetchInterval: 5000 } }
  );

  const diagSymbols = diagData?.symbols ?? [];
  const streamingCount = diagSymbols.filter(s => s.streamingState === "streaming").length;

  async function toggleStream(sym: string, enable: boolean) {
    await apiFetch(`diagnostics/symbols/${sym}/streaming`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: enable }),
    });
    refetchDiag();
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Database className="w-6 h-6 text-primary" /> Data
          </h1>
          <p className="page-subtitle">
            Tick ingestion pipeline, candle coverage, streaming state, and per-symbol controls
          </p>
        </div>
      </div>

      {/* Stream control + summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 flex items-center gap-4">
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
            status?.streaming ? "bg-green-500/12 text-green-400" : "bg-muted/30 text-muted-foreground"
          )}>
            {status?.streaming ? <RadioTower className="w-5 h-5" /> : <Radio className="w-5 h-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-muted-foreground">Global Stream</span>
              <Badge variant={status?.streaming ? "success" : "outline"}>
                {status?.streaming ? "Live" : "Offline"}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-success border-success/40 hover:bg-success/8"
                disabled={status?.streaming}
                onClick={() => startStream({ data: { symbols: ALL_STREAM_SYMBOLS } })}
                isLoading={startingStream}
              >
                <Play className="w-3 h-3" /> Start
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/40 hover:bg-destructive/8"
                disabled={!status?.streaming}
                onClick={() => stopStream()}
                isLoading={stoppingStream}
              >
                <Square className="w-3 h-3" /> Stop
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground">Streaming</span>
          </div>
          <div className="text-2xl font-bold mono-num text-foreground">{streamingCount}</div>
          <div className="text-xs text-muted-foreground">of {diagSymbols.length} validated symbols</div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Layers className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground">Total Ticks Ingested</span>
          </div>
          <div className="text-2xl font-bold mono-num text-foreground">
            {status?.tickCount != null ? status.tickCount.toLocaleString() : "—"}
          </div>
          <div className="text-xs text-muted-foreground">since last stream start</div>
        </Card>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border/50 overflow-x-auto">
        {([
          { id: "overview", label: "Symbol State",  icon: Database    },
          { id: "ticks",    label: "Live Ticks",    icon: Activity    },
          { id: "candles",  label: "M1 Candles",    icon: TrendingUp  },
          { id: "spikes",   label: "Spike Events",  icon: Layers      },
        ] as const).map(t => (
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

      {/* Symbol State overview */}
      {tab === "overview" && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Radio className="w-4 h-4 text-primary" /> Per-Symbol Streaming State
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              Active trading symbols highlighted · Toggle per-symbol streaming from here
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Streaming State</th>
                    <th>API Alias</th>
                    <th>Control</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Active first */}
                  {ACTIVE_SYMBOLS.map(sym => (
                    <SymbolRow
                      key={sym}
                      sym={sym}
                      diag={diagSymbols.find(d => d.symbol === sym)}
                      onToggle={toggleStream}
                    />
                  ))}

                  {diagSymbols.filter(d => !ACTIVE_SYMBOLS.includes(d.symbol)).length > 0 && (
                    <tr key="__separator__">
                      <td colSpan={4}
                        className="text-[10px] text-muted-foreground/50 uppercase tracking-wider py-1 px-4 bg-muted/15">
                        Non-Active / Research Symbols
                      </td>
                    </tr>
                  )}
                  {diagSymbols
                    .filter(d => !ACTIVE_SYMBOLS.includes(d.symbol))
                    .map(d => (
                      <SymbolRow
                        key={d.symbol}
                        sym={d.symbol}
                        diag={d}
                        onToggle={toggleStream}
                      />
                    ))}

                  {diagSymbols.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                        Loading symbol diagnostics…
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data viewer tabs — symbol selector */}
      {tab !== "overview" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-xs text-muted-foreground font-medium">Symbol:</label>
            <Select className="h-8 w-44 text-xs" value={symbol} onChange={e => setSymbol(e.target.value)}>
              {ALL_SYMBOLS_SELECT.map(s => (
                <option key={s.value} value={s.value}>{s.value} — {s.label}</option>
              ))}
            </Select>
          </div>

          {tab === "ticks" && (
            <Card>
              <CardHeader>
                <CardTitle><Activity className="w-4 h-4 text-primary" /> Live Ticks — {symbol}</CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Symbol</th>
                      <th className="text-right">Quote</th>
                      <th className="text-right">Epoch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!ticks?.length
                      ? <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">No tick data</td></tr>
                      : ticks.map(t => (
                        <tr key={t.id}>
                          <td className="mono-num text-muted-foreground text-xs">
                            {new Date(t.createdAt).toLocaleTimeString()}
                          </td>
                          <td className="text-sm font-medium text-foreground">{symbol}</td>
                          <td className="text-right mono-num font-semibold">{formatNumber(t.quote, 4)}</td>
                          <td className="text-right mono-num text-xs text-muted-foreground/50">{t.epochTs}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {tab === "candles" && (
            <Card>
              <CardHeader>
                <CardTitle><TrendingUp className="w-4 h-4 text-primary" /> M1 Candles — {symbol}</CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th className="text-right">Open</th>
                      <th className="text-right">High</th>
                      <th className="text-right">Low</th>
                      <th className="text-right">Close</th>
                      <th className="text-right">Ticks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!candles?.length
                      ? <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No candle data</td></tr>
                      : candles.map(c => (
                        <tr key={c.id}>
                          <td className="mono-num text-muted-foreground text-xs">
                            {new Date(c.openTs * 1000).toLocaleTimeString()}
                          </td>
                          <td className="text-right mono-num">{formatNumber(c.open, 3)}</td>
                          <td className="text-right mono-num text-success">{formatNumber(c.high, 3)}</td>
                          <td className="text-right mono-num text-destructive">{formatNumber(c.low, 3)}</td>
                          <td className="text-right mono-num font-semibold">{formatNumber(c.close, 3)}</td>
                          <td className="text-right mono-num text-muted-foreground">{c.tickCount}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {tab === "spikes" && (
            <Card>
              <CardHeader>
                <CardTitle><Layers className="w-4 h-4 text-primary" /> Spike Events — {symbol}</CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Direction</th>
                      <th className="text-right">Size</th>
                      <th className="text-right">Ticks Since Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!spikes?.length
                      ? <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">No spike events</td></tr>
                      : spikes.map(s => (
                        <tr key={s.id}>
                          <td className="mono-num text-muted-foreground text-xs">
                            {new Date(s.eventTs * 1000).toLocaleTimeString()}
                          </td>
                          <td>
                            <Badge variant={s.direction === "up" ? "success" : "destructive"}>
                              {s.direction}
                            </Badge>
                          </td>
                          <td className="text-right mono-num font-semibold">{formatNumber(s.spikeSize, 2)}</td>
                          <td className="text-right mono-num text-muted-foreground">
                            {s.ticksSincePreviousSpike || "—"}
                          </td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
