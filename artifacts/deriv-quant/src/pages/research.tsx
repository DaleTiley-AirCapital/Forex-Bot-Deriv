import { useState, useRef, useEffect } from "react";
import {
  FlaskConical, Brain, Play, RefreshCw,
  Loader2, CheckCircle, XCircle,
  FileText, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL || "/";

function apiFetch(path: string, opts?: RequestInit) {
  return fetch(`${BASE}api/${path.replace(/^\//, "")}`, opts).then(async r => {
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const d = await r.json(); msg = d.error ?? d.message ?? msg; } catch {}
      throw new Error(msg);
    }
    return r.json();
  });
}

const ALL_SYMBOLS = [
  "BOOM300","CRASH300","R_75","R_100",
  "BOOM1000","CRASH1000","BOOM900","CRASH900","BOOM600","CRASH600","BOOM500","CRASH500",
  "R_10","R_25","R_50","RDBULL","RDBEAR",
  "JD10","JD25","JD50","JD75","JD100",
  "stpRNG","stpRNG2","stpRNG3","stpRNG5","RB100","RB200",
];
const ACTIVE = ["CRASH300", "BOOM300", "R_75", "R_100"];

function StatusPill({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return ok
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-500/15 text-green-400 border border-green-500/25"><CheckCircle className="w-3 h-3" />{yes}</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-500/15 text-red-400 border border-red-500/25"><XCircle className="w-3 h-3" />{no}</span>;
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
      <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="font-mono break-all">{msg}</span>
    </div>
  );
}

function SuccessBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs">
      <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="break-all">{msg}</span>
    </div>
  );
}

function SymbolSelect({ value, onChange, label }: { value: string; onChange: (s: string) => void; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="text-xs bg-background border border-border/50 rounded px-2 py-1.5 text-foreground focus:outline-none focus:border-primary/50"
      >
        {ALL_SYMBOLS.map(s => (
          <option key={s} value={s}>{s}{ACTIVE.includes(s) ? " ●" : ""}</option>
        ))}
      </select>
    </div>
  );
}

// ─── AI Analysis Tab ──────────────────────────────────────────────────────

function AiAnalysisTab() {
  const [symbol, setSymbol] = useState("CRASH300");
  const [windowDays, setWindowDays] = useState(365);
  const [running, setRunning] = useState(false);
  const [bgStarted, setBgStarted] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<any | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = async () => {
    try {
      const d = await apiFetch("research/ai-analyze/status");
      setStatus(d);
    } catch {}
  };

  useEffect(() => {
    loadStatus();
    intervalRef.current = setInterval(loadStatus, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const runSync = async () => {
    setRunning(true); setErr(null); setResult(null);
    try {
      const d = await apiFetch("research/ai-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, windowDays }),
      });
      setResult(d.report ?? d);
    } catch (e: any) { setErr(e.message); }
    finally { setRunning(false); }
  };

  const runBackground = async () => {
    setErr(null); setBgStarted(false);
    try {
      await apiFetch("research/ai-analyze/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, windowDays }),
      });
      setBgStarted(true);
    } catch (e: any) { setErr(e.message); }
  };

  const displayResult = result ?? (status?.lastResult?.[symbol] ?? null);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">AI Research Analysis</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Runs a GPT-4o structured analysis on stored candle data for the selected symbol.
            Extracts swing patterns, move size distribution, frequency, and behavioral drift.
            Produces a research report. <strong className="text-foreground">Sync mode blocks until complete (~10–30s).</strong>
          </p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <SymbolSelect value={symbol} onChange={s => { setSymbol(s); setResult(null); }} label="Symbol:" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Window:</span>
            {[90, 180, 365].map(d => (
              <button key={d} onClick={() => setWindowDays(d)}
                className={cn("px-2 py-1 rounded border text-xs transition-colors",
                  windowDays === d ? "border-primary/40 bg-primary/10 text-primary" : "border-border/40 text-muted-foreground hover:border-border")}>
                {d}d
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={runSync}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/30 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {running ? "Analyzing…" : "Run Sync Analysis"}
          </button>
          <button
            onClick={runBackground}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border/50 text-foreground text-xs font-medium hover:border-border hover:bg-muted/30 transition-colors"
          >
            <Clock className="w-3.5 h-3.5" /> Start Background Job
          </button>
          <button onClick={loadStatus}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border/40 text-muted-foreground text-xs hover:border-border transition-colors">
            <RefreshCw className="w-3 h-3" /> Status
          </button>
        </div>
        {err && <ErrorBox msg={err} />}
        {bgStarted && <SuccessBox msg={`Background analysis started for ${symbol} (${windowDays}d window). Check status panel.`} />}
      </div>

      {status && (
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Background Job Status</h3>
            <StatusPill ok={!status.running} yes="Idle" no="Running" />
          </div>
          {Object.keys(status.lastRun ?? {}).length === 0 ? (
            <p className="text-xs text-muted-foreground">No jobs run yet this session.</p>
          ) : (
            <div className="space-y-1">
              {Object.entries(status.lastRun ?? {}).map(([sym, ts]) => (
                <div key={sym} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground">{sym}</span>
                  <span className="text-foreground">{String(ts)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {displayResult && (
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Research Report — {symbol}</h3>
          </div>
          {typeof displayResult === "string" ? (
            <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap bg-muted/20 rounded p-3 leading-relaxed max-h-96 overflow-y-auto">
              {displayResult}
            </pre>
          ) : (
            <div className="space-y-2">
              {Object.entries(displayResult).map(([k, v]) => (
                <div key={k} className="flex items-start gap-3 py-1.5 border-b border-border/20 last:border-0">
                  <span className="text-xs text-muted-foreground w-40 shrink-0">{k}</span>
                  <span className="text-xs font-mono text-foreground break-all">{JSON.stringify(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────

export default function Research() {
  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FlaskConical className="w-6 h-6 text-primary" />
          Research
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          AI market analysis · structured research reports — Export moved to Data console
        </p>
      </div>

      <AiAnalysisTab />
    </div>
  );
}
