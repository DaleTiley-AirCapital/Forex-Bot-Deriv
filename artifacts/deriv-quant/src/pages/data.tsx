import React, { useState } from "react";
import { 
  useGetDataStatus, 
  useStartBackfill, 
  useStartStream, 
  useStopStream,
  useGetTicks,
  useGetCandles,
  getGetDataStatusQueryKey,
  useGetSpikeEvents
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Input, Select, Label } from "@/components/ui-elements";
import { formatNumber, cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Database, Play, Square, DownloadCloud } from "lucide-react";

export default function DataManager() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'ticks' | 'candles' | 'spikes'>('ticks');
  const [symbol, setSymbol] = useState("BOOM1000");

  const { data: status } = useGetDataStatus({ query: { refetchInterval: 3000 } });
  
  const invalidator = {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetDataStatusQueryKey() })
  };

  const { mutate: startStream, isPending: startingStream } = useStartStream({ mutation: invalidator });
  const { mutate: stopStream, isPending: stoppingStream } = useStopStream({ mutation: invalidator });
  const { mutate: startBackfill, isPending: backfilling } = useStartBackfill({ mutation: invalidator });

  const { data: ticks } = useGetTicks({ symbol, limit: 15 }, { query: { enabled: tab === 'ticks', refetchInterval: 2000 } });
  const { data: candles } = useGetCandles({ symbol, timeframe: 'M1', limit: 15 }, { query: { enabled: tab === 'candles' } });
  const { data: spikes } = useGetSpikeEvents({ symbol, limit: 15 }, { query: { enabled: tab === 'spikes' } });

  const [backfillForm, setBackfillForm] = useState({ symbol: "BOOM1000", days: 30 });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Data Pipeline</h1>
          <p className="text-muted-foreground font-mono mt-1 text-sm">Tick ingestion, derived candles, and event labelling</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-4 h-4" />
              Stream Control
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-border/30">
              <span className="text-muted-foreground text-sm">Status</span>
              <Badge variant={status?.streaming ? "success" : "outline"}>
                {status?.streaming ? "STREAMING" : "OFFLINE"}
              </Badge>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/30">
              <span className="text-muted-foreground text-sm">Tick Count</span>
              <span className="font-mono">{formatNumber(status?.tickCount, 0)}</span>
            </div>
            <div className="pt-4 flex gap-3">
              <Button 
                variant="outline" 
                className="flex-1 text-success border-success/50 hover:bg-success/10"
                disabled={status?.streaming}
                onClick={() => startStream({ data: { symbols: ["BOOM1000", "CRASH1000"] }})}
                isLoading={startingStream}
              >
                <Play className="w-4 h-4 mr-2" /> Start
              </Button>
              <Button 
                variant="outline" 
                className="flex-1 text-destructive border-destructive/50 hover:bg-destructive/10"
                disabled={!status?.streaming}
                onClick={() => stopStream()}
                isLoading={stoppingStream}
              >
                <Square className="w-4 h-4 mr-2" /> Stop
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DownloadCloud className="w-4 h-4" />
              Historical Backfill
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-4 items-end">
              <div className="space-y-2 flex-1 w-full">
                <Label>Target Symbol</Label>
                <Select value={backfillForm.symbol} onChange={e => setBackfillForm({...backfillForm, symbol: e.target.value})}>
                  <option value="BOOM1000">BOOM1000</option>
                  <option value="CRASH1000">CRASH1000</option>
                  <option value="BOOM500">BOOM500</option>
                  <option value="CRASH500">CRASH500</option>
                </Select>
              </div>
              <div className="space-y-2 flex-1 w-full">
                <Label>Days of History</Label>
                <Input type="number" value={backfillForm.days} onChange={e => setBackfillForm({...backfillForm, days: Number(e.target.value)})} />
              </div>
              <Button 
                onClick={() => startBackfill({ data: backfillForm })} 
                isLoading={backfilling}
                className="w-full md:w-auto"
              >
                Start Backfill Task
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row justify-between border-b border-border/50">
          <div className="flex">
            <button className={cn("px-6 py-3 text-sm font-medium uppercase tracking-wider transition-colors", tab === 'ticks' ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground")} onClick={() => setTab('ticks')}>Raw Ticks</button>
            <button className={cn("px-6 py-3 text-sm font-medium uppercase tracking-wider transition-colors", tab === 'candles' ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground")} onClick={() => setTab('candles')}>M1 Candles</button>
            <button className={cn("px-6 py-3 text-sm font-medium uppercase tracking-wider transition-colors", tab === 'spikes' ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground")} onClick={() => setTab('spikes')}>Spike Events</button>
          </div>
          <div className="p-2 flex items-center border-t sm:border-t-0 border-border/50">
            <Select className="h-8 w-32 text-xs" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              <option value="BOOM1000">BOOM1000</option>
              <option value="CRASH1000">CRASH1000</option>
            </Select>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          {tab === 'ticks' && (
            <table className="w-full">
              <thead><tr><th>Time</th><th>Quote</th><th>Epoch</th></tr></thead>
              <tbody>
                {ticks?.map(t => (
                  <tr key={t.id}>
                    <td className="mono-num text-muted-foreground">{new Date(t.createdAt).toLocaleTimeString()}</td>
                    <td className="mono-num font-bold">{formatNumber(t.quote, 4)}</td>
                    <td className="mono-num text-xs text-muted-foreground/50">{t.epochTs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'candles' && (
            <table className="w-full">
              <thead><tr><th>Time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Ticks</th></tr></thead>
              <tbody>
                {candles?.map(c => (
                  <tr key={c.id}>
                    <td className="mono-num text-muted-foreground">{new Date(c.openTs * 1000).toLocaleTimeString()}</td>
                    <td className="mono-num">{formatNumber(c.open, 3)}</td>
                    <td className="mono-num text-success">{formatNumber(c.high, 3)}</td>
                    <td className="mono-num text-destructive">{formatNumber(c.low, 3)}</td>
                    <td className="mono-num font-bold">{formatNumber(c.close, 3)}</td>
                    <td className="mono-num text-muted-foreground">{c.tickCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'spikes' && (
            <table className="w-full">
              <thead><tr><th>Time</th><th>Dir</th><th>Size</th><th>Ticks Since Last</th></tr></thead>
              <tbody>
                {spikes?.map(s => (
                  <tr key={s.id}>
                    <td className="mono-num text-muted-foreground">{new Date(s.eventTs * 1000).toLocaleTimeString()}</td>
                    <td><Badge variant={s.direction === 'up' ? 'success' : 'destructive'}>{s.direction}</Badge></td>
                    <td className="mono-num font-bold">{formatNumber(s.spikeSize, 2)}</td>
                    <td className="mono-num">{s.ticksSincePreviousSpike || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
