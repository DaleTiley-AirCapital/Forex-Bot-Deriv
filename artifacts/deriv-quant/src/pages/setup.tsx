import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Circle, Loader2, AlertCircle, Database, BarChart3, Zap, ArrowRight, ArrowLeft, Key, Eye, EyeOff, Brain, Radio } from "lucide-react";

const BASE = import.meta.env.BASE_URL || "/";
const api = (path: string) => `${BASE}api${path}`;

type Step = "welcome" | "apikeys" | "testing" | "initialise" | "complete";

async function consumeSSE(
  url: string,
  onEvent: (evt: Record<string, unknown>) => void,
  signal?: AbortSignal,
) {
  const res = await fetch(url, { method: "POST", signal });
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No stream");
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {}
    }
  }
}

function formatTime(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  return `${seconds}s`;
}

export default function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const [derivTokenDemo, setDerivTokenDemo] = useState("");
  const [derivTokenReal, setDerivTokenReal] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [showDerivDemo, setShowDerivDemo] = useState(false);
  const [showDerivReal, setShowDerivReal] = useState(false);
  const [showOpenai, setShowOpenai] = useState(false);
  const [testResult, setTestResult] = useState<{ derivDemo: { ok: boolean; error?: string }; derivReal: { ok: boolean; error?: string }; openai: { ok: boolean; error?: string } } | null>(null);

  const [initProgress, setInitProgress] = useState(0);
  const [initStage, setInitStage] = useState<"backfill" | "backtest" | "ai_review" | "optimise" | "streaming" | "complete" | "error">("backfill");
  const [initStatus, setInitStatus] = useState("");
  const [candleTotal, setCandleTotal] = useState(0);
  const [btCompleted, setBtCompleted] = useState(0);
  const [btTotal, setBtTotal] = useState(0);
  const [estRemainingSec, setEstRemainingSec] = useState(0);
  const [symbolProgress, setSymbolProgress] = useState<Record<string, { status: string; candles: number; oldestDate: string | null; pct?: number; error?: string }>>({});
  const [btSymbolResults, setBtSymbolResults] = useState<Record<string, { strategy: string; winRate: number; profitFactor: number; score: number; tradeCount: number; avgHoldHours: number }>>({});
  const [aiReviews, setAiReviews] = useState<Record<string, { summary: string | null; suggestions: string[] | null; bestStrategy: string; winRate: number; profitFactor: number }>>({});

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const completedRef = useRef(false);
  const queryClient = useQueryClient();

  const saveKeysAndTest = useCallback(async () => {
    if (!derivTokenDemo.trim() && !derivTokenReal.trim()) {
      setError("Please enter at least one Deriv API token (Demo or Real).");
      return;
    }
    setError(null);
    setSaving(true);
    setStep("testing");
    setTestResult(null);

    try {
      const keysToSave: Record<string, string> = {};
      if (derivTokenDemo.trim()) {
        keysToSave.deriv_api_token_demo = derivTokenDemo.trim();
        keysToSave.deriv_api_token = derivTokenDemo.trim();
      }
      if (derivTokenReal.trim()) {
        keysToSave.deriv_api_token_real = derivTokenReal.trim();
        if (!derivTokenDemo.trim()) {
          keysToSave.deriv_api_token = derivTokenReal.trim();
        }
      }
      if (openaiKey.trim()) {
        keysToSave.openai_api_key = openaiKey.trim();
      }

      const saveRes = await fetch(api("/settings"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(keysToSave),
      });
      if (!saveRes.ok) throw new Error("Failed to save API keys");

      const testRes = await fetch(api("/setup/preflight"), { method: "POST" });
      const data = await testRes.json();

      const result = {
        derivDemo: data.derivDemo || { ok: false, error: "Not configured" },
        derivReal: data.derivReal || { ok: false, error: "Not configured" },
        openai: data.openai || { ok: false, error: "Not configured" },
      };
      setTestResult(result);

      const anyDerivOk = result.derivDemo.ok || result.derivReal.ok;
      if (anyDerivOk) {
        setStep("initialise");
      } else {
        setError("No Deriv API connection succeeded. Please check your tokens.");
        setStep("apikeys");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save keys");
      setStep("apikeys");
    } finally {
      setSaving(false);
    }
  }, [derivTokenDemo, derivTokenReal, openaiKey]);

  const runInitialise = useCallback(async () => {
    setError(null);
    setInitProgress(1);
    setInitStage("backfill");
    setInitStatus("Starting initialisation...");
    setCandleTotal(0);
    setBtCompleted(0);
    setBtTotal(0);
    setEstRemainingSec(0);
    setSymbolProgress({});
    setBtSymbolResults({});
    setAiReviews({});
    abortRef.current = new AbortController();
    completedRef.current = false;

    try {
      await consumeSSE(api("/setup/initialise"), (evt) => {
        const phase = evt.phase as string;
        const pct = (evt.overallPct as number) || 0;

        if (phase === "backfill_start") {
          setInitStage("backfill");
          setInitStatus(evt.message as string);
          const syms = evt.symbols as Array<{ symbol: string; status: string; candles: number; oldestDate: string | null }>;
          if (syms) {
            const map: Record<string, { status: string; candles: number; oldestDate: string | null; pct?: number }> = {};
            for (const s of syms) map[s.symbol] = { status: s.status, candles: s.candles, oldestDate: s.oldestDate, pct: 0 };
            setSymbolProgress(map);
          }
        } else if (phase === "backfill_symbol_start") {
          const sym = evt.symbol as string;
          setSymbolProgress(prev => ({ ...prev, [sym]: { status: "downloading", candles: 0, oldestDate: null, pct: 0 } }));
          setInitStatus(evt.message as string);
        } else if (phase === "backfill_progress") {
          setInitStage("backfill");
          setInitProgress(Math.max(pct, 1));
          setInitStatus(evt.message as string);
          setCandleTotal(evt.candleTotal as number || 0);
          const sym = evt.symbol as string;
          if (sym) {
            setSymbolProgress(prev => ({
              ...prev,
              [sym]: {
                status: "downloading",
                candles: evt.candlesForSymbol as number || 0,
                oldestDate: evt.oldestDate as string || null,
                pct: evt.symbolPct as number || prev[sym]?.pct || 0,
              },
            }));
          }
        } else if (phase === "backfill_symbol_error") {
          const sym = evt.symbol as string;
          if (sym) {
            setSymbolProgress(prev => ({
              ...prev,
              [sym]: {
                status: "error",
                candles: prev[sym]?.candles || 0,
                oldestDate: prev[sym]?.oldestDate || null,
                pct: prev[sym]?.pct || 0,
                error: evt.error as string || "Failed",
              },
            }));
          }
          setInitStatus(evt.message as string);
        } else if (phase === "backfill_symbol_done") {
          setInitProgress(Math.max(pct, 1));
          setInitStatus(evt.message as string);
          setCandleTotal(evt.candleTotal as number || 0);
          const sym = evt.symbol as string;
          if (sym) {
            setSymbolProgress(prev => ({
              ...prev,
              [sym]: { status: "done", candles: evt.candlesForSymbol as number || 0, oldestDate: prev[sym]?.oldestDate || null, pct: 100 },
            }));
          }
        } else if (phase === "backfill_complete") {
          setInitProgress(40);
          setInitStatus(evt.message as string);
          setCandleTotal(evt.candleTotal as number || 0);
          setEstRemainingSec(0);
        } else if (phase === "backtest_start") {
          setInitStage("backtest");
          setBtTotal(evt.btTotal as number || 0);
          setInitStatus(evt.message as string);
        } else if (phase === "backtest_progress") {
          setInitStage("backtest");
          setInitProgress(Math.max(pct, 40));
          setBtCompleted(evt.btCompleted as number || 0);
          setBtTotal(evt.btTotal as number || 0);
          setCandleTotal(evt.candleTotal as number || 0);
          setEstRemainingSec(evt.estRemainingSec as number || 0);
          setInitStatus(evt.message as string);
          const sym = evt.symbol as string;
          const strat = evt.strategy as string;
          if (sym && strat) {
            setBtSymbolResults(prev => {
              const existing = prev[sym];
              if (!existing) return { ...prev, [sym]: { strategy: strat, winRate: 0, profitFactor: 0, score: 0, tradeCount: 0, avgHoldHours: 0 } };
              return prev;
            });
          }
        } else if (phase === "backtest_symbol_summary") {
          const sym = evt.symbol as string;
          if (sym) {
            setBtSymbolResults(prev => ({
              ...prev,
              [sym]: {
                strategy: (evt.bestStrategy as string) || prev[sym]?.strategy || "",
                winRate: (evt.avgWinRate as number) || 0,
                profitFactor: (evt.avgProfitFactor as number) || 0,
                score: (evt.bestScore as number) || 0,
                tradeCount: (evt.tradeCount as number) || 0,
                avgHoldHours: (evt.avgHoldHours as number) || 0,
              },
            }));
          }
        } else if (phase === "ai_review_start") {
          setInitStage("ai_review");
          setInitProgress(Math.max(pct, 70));
          setInitStatus(evt.message as string);
          setEstRemainingSec(0);
        } else if (phase === "ai_review_symbol") {
          setInitStage("ai_review");
          setInitProgress(Math.max(pct, 70));
          setInitStatus(evt.message as string);
          setEstRemainingSec(0);
          const sym = evt.symbol as string;
          if (sym) {
            setAiReviews(prev => ({
              ...prev,
              [sym]: {
                summary: (evt.aiSummary as string) || null,
                suggestions: (evt.aiSuggestions as string[]) || null,
                bestStrategy: (evt.bestStrategy as string) || "none",
                winRate: (evt.winRate as number) || 0,
                profitFactor: (evt.profitFactor as number) || 0,
              },
            }));
          }
        } else if (phase === "ai_review_complete") {
          setInitStage("ai_review");
          setInitProgress(80);
          setInitStatus(evt.message as string);
        } else if (phase === "optimising" || phase === "optimise_complete") {
          setInitStage("optimise");
          setInitProgress(Math.max(pct, 80));
          setInitStatus(evt.message as string);
          setEstRemainingSec(0);
        } else if (phase === "streaming_start" || phase === "streaming_complete") {
          setInitStage("streaming");
          setInitProgress(Math.max(pct, 90));
          setInitStatus(evt.message as string);
        } else if (phase === "complete") {
          completedRef.current = true;
          setInitStage("complete");
          setInitProgress(100);
          setInitStatus(evt.message as string);
          setCandleTotal(evt.candleTotal as number || 0);
          setBtCompleted(evt.btCompleted as number || 0);
          setEstRemainingSec(0);
          queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
          queryClient.invalidateQueries({ queryKey: ["/api/setup/status"] });
          setStep("complete");
        } else if (phase === "error") {
          completedRef.current = true;
          setError(evt.message as string);
          setInitStage("error");
        }
      }, abortRef.current.signal);

      if (!completedRef.current) {
        setError("Setup stream ended unexpectedly. Please try again.");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Initialisation failed");
      }
    }
  }, [queryClient]);

  const stepDefs = [
    { label: "Welcome" },
    { label: "API Keys" },
    { label: "Backfill → Backtest → AI" },
    { label: "Ready" },
  ];

  const stepToIndex: Record<Step, number> = { welcome: 0, apikeys: 1, testing: 1, initialise: 2, complete: 3 };
  const indexToStep: Step[] = ["welcome", "apikeys", "initialise", "complete"];
  const stepIndex = stepToIndex[step];

  const goBack = () => {
    setError(null);
    if (abortRef.current) abortRef.current.abort();
    const prevIndex = Math.max(0, stepIndex - 1);
    setStep(indexToStep[prevIndex]);
  };

  const goToStep = (targetIndex: number) => {
    if (targetIndex >= stepIndex) return;
    setError(null);
    if (abortRef.current) abortRef.current.abort();
    setStep(indexToStep[targetIndex]);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Zap className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">Deriv Capital Extraction App</h1>
          <p className="text-muted-foreground mt-2">Initial Setup</p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-8">
          {stepDefs.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2">
              <button
                type="button"
                disabled={i >= stepIndex}
                onClick={() => goToStep(i)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  i < stepIndex ? "bg-green-500/10 text-green-400 cursor-pointer hover:bg-green-500/20" :
                  i === stepIndex ? "bg-primary/10 text-primary" :
                  "bg-muted/30 text-muted-foreground"
                }`}
              >
                {i < stepIndex ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                 i === stepIndex && step !== "welcome" && step !== "complete" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                 i === stepIndex && step === "complete" ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                 <Circle className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < stepDefs.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground/40" />}
            </div>
          ))}
        </div>

        <Card className="border-border/50 bg-card">
          <CardContent className="p-8">
            {error && (
              <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-destructive">Error</p>
                  <p className="text-sm text-destructive/80 mt-1">{error}</p>
                </div>
              </div>
            )}

            {step === "welcome" && (
              <div className="text-center space-y-6">
                <div className="space-y-3">
                  <h2 className="text-xl font-semibold text-foreground">Welcome</h2>
                  <p className="text-muted-foreground leading-relaxed max-w-md mx-auto">
                    Before trading, the system downloads ALL available 1m & 5m price history,
                    runs every strategy as backtests across every symbol, and has AI
                    recommend your optimal starting settings.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 max-w-lg mx-auto">
                  <div className="p-3 rounded-lg bg-muted/20 text-center">
                    <Key className="w-5 h-5 text-yellow-400 mx-auto mb-1.5" />
                    <p className="text-[10px] text-muted-foreground">API Keys</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/20 text-center">
                    <Database className="w-5 h-5 text-blue-400 mx-auto mb-1.5" />
                    <p className="text-[10px] text-muted-foreground">Backfill</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/20 text-center">
                    <BarChart3 className="w-5 h-5 text-purple-400 mx-auto mb-1.5" />
                    <p className="text-[10px] text-muted-foreground">Strategy Replay</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/20 text-center">
                    <Brain className="w-5 h-5 text-amber-400 mx-auto mb-1.5" />
                    <p className="text-[10px] text-muted-foreground">AI Review</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/20 text-center">
                    <Zap className="w-5 h-5 text-emerald-400 mx-auto mb-1.5" />
                    <p className="text-[10px] text-muted-foreground">AI Optimise</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/20 text-center">
                    <Radio className="w-5 h-5 text-cyan-400 mx-auto mb-1.5" />
                    <p className="text-[10px] text-muted-foreground">Start Streaming</p>
                  </div>
                </div>
                <Button size="lg" onClick={() => { setError(null); setStep("apikeys"); }} className="px-8">
                  Begin Setup <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}

            {(step === "apikeys" || step === "testing") && (
              <div className="space-y-6">
                <div className="text-center space-y-2">
                  <Key className="w-10 h-10 text-yellow-400 mx-auto" />
                  <h2 className="text-lg font-semibold">Connect Your API Keys</h2>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    Enter your Deriv API token and OpenAI key. We'll verify the connections before proceeding.
                  </p>
                </div>

                <div className="space-y-4 max-w-md mx-auto">
                  <p className="text-xs text-muted-foreground">
                    Get your tokens from{" "}
                    <a href="https://app.deriv.com/account/api-token" target="_blank" rel="noreferrer" className="text-primary underline">
                      Deriv API Token Settings
                    </a>. Enable Read, Trade, and Admin scopes. You need at least one token.
                  </p>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground flex items-center gap-2">
                      Deriv Demo API Token
                    </label>
                    <div className="relative">
                      <Input
                        type={showDerivDemo ? "text" : "password"}
                        placeholder="Enter your Demo account API token"
                        value={derivTokenDemo}
                        onChange={(e) => setDerivTokenDemo(e.target.value)}
                        className="pr-10 bg-background/50"
                        disabled={step === "testing"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowDerivDemo(!showDerivDemo)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showDerivDemo ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground flex items-center gap-2">
                      Deriv Real API Token
                    </label>
                    <div className="relative">
                      <Input
                        type={showDerivReal ? "text" : "password"}
                        placeholder="Enter your Real account API token"
                        value={derivTokenReal}
                        onChange={(e) => setDerivTokenReal(e.target.value)}
                        className="pr-10 bg-background/50"
                        disabled={step === "testing"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowDerivReal(!showDerivReal)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showDerivReal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground flex items-center gap-2">
                      OpenAI API Key <span className="text-muted-foreground text-xs">(optional)</span>
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Required for AI chat assistant and AI-powered analysis. You can add it later in Settings.
                    </p>
                    <div className="relative">
                      <Input
                        type={showOpenai ? "text" : "password"}
                        placeholder="sk-..."
                        value={openaiKey}
                        onChange={(e) => setOpenaiKey(e.target.value)}
                        className="pr-10 bg-background/50"
                        disabled={step === "testing"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenai(!showOpenai)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showOpenai ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {testResult && (
                    <div className="space-y-2 pt-2">
                      {derivTokenDemo.trim() && (
                        <div className={`flex items-center gap-2 text-sm ${testResult.derivDemo.ok ? "text-green-400" : "text-destructive"}`}>
                          {testResult.derivDemo.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                          Deriv Demo: {testResult.derivDemo.ok ? "Connected" : (testResult.derivDemo.error || "Failed")}
                        </div>
                      )}
                      {derivTokenReal.trim() && (
                        <div className={`flex items-center gap-2 text-sm ${testResult.derivReal.ok ? "text-green-400" : "text-destructive"}`}>
                          {testResult.derivReal.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                          Deriv Real: {testResult.derivReal.ok ? "Connected" : (testResult.derivReal.error || "Failed")}
                        </div>
                      )}
                      <div className={`flex items-center gap-2 text-sm ${testResult.openai.ok ? "text-green-400" : "text-yellow-400"}`}>
                        {testResult.openai.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                        OpenAI: {testResult.openai.ok ? "Connected" : (openaiKey.trim() ? (testResult.openai.error || "Failed") : "Not configured (optional)")}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-center gap-3">
                  <Button variant="outline" onClick={goBack} disabled={saving} className="px-6">
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back
                  </Button>
                  <Button onClick={saveKeysAndTest} disabled={saving || (!derivTokenDemo.trim() && !derivTokenReal.trim())} className="px-8">
                    {saving ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Testing Connections...</>
                    ) : (
                      <>Save & Test Connections <ArrowRight className="w-4 h-4 ml-2" /></>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {step === "initialise" && (
              <div className="space-y-6">
                {testResult && (
                  <div className="flex gap-4 justify-center mb-4 flex-wrap">
                    {testResult.derivDemo.ok && (
                      <div className="flex items-center gap-2 text-sm text-green-400">
                        <CheckCircle2 className="w-4 h-4" />
                        Demo Connected
                      </div>
                    )}
                    {testResult.derivReal.ok && (
                      <div className="flex items-center gap-2 text-sm text-green-400">
                        <CheckCircle2 className="w-4 h-4" />
                        Real Connected
                      </div>
                    )}
                    <div className={`flex items-center gap-2 text-sm ${testResult.openai.ok ? "text-green-400" : "text-yellow-400"}`}>
                      {testResult.openai.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      OpenAI {testResult.openai.ok ? "Connected" : "Skipped"}
                    </div>
                  </div>
                )}

                {initProgress > 0 ? (
                  <div className="space-y-5">
                    <div className="text-center space-y-1">
                      <h2 className="text-lg font-semibold">
                        {initStage === "backfill" && "Step 1 of 6: Downloading Historical Data"}
                        {initStage === "backtest" && "Step 2 of 6: Running Strategy Replay"}
                        {initStage === "ai_review" && "Step 3 of 6: AI Review Per Symbol"}
                        {initStage === "optimise" && "Step 4 of 6: AI-Optimised Settings"}
                        {initStage === "streaming" && "Step 5 of 6: Starting Live Stream"}
                        {initStage === "complete" && "Step 6 of 6: Complete"}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {initStage === "backfill" && "Fetching all available 1m & 5m candle data from Deriv"}
                        {initStage === "backtest" && "Testing all strategies across every symbol"}
                        {initStage === "ai_review" && "Analysing each symbol's best strategy and performance"}
                        {initStage === "optimise" && "Computing optimal parameters from backtest results"}
                        {initStage === "streaming" && "Connecting to live market data feeds"}
                        {initStage === "complete" && "Your platform is ready"}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                        <span>{initProgress}%</span>
                        {estRemainingSec > 0 && (
                          <span>~{formatTime(estRemainingSec)} remaining</span>
                        )}
                      </div>
                      <Progress value={initProgress} className="h-3" />
                    </div>

                    <div className="grid grid-cols-6 gap-1.5">
                      {([
                        { key: "backfill", icon: Database, label: "Backfill", activeBg: "bg-blue-500/10 border-blue-500/30", activeIcon: "text-blue-400", value: candleTotal > 0 ? candleTotal.toLocaleString() : "—" },
                        { key: "backtest", icon: BarChart3, label: "Replay", activeBg: "bg-purple-500/10 border-purple-500/30", activeIcon: "text-purple-400", value: btTotal > 0 ? `${btCompleted}/${btTotal}` : "—" },
                        { key: "ai_review", icon: Brain, label: "Review", activeBg: "bg-amber-500/10 border-amber-500/30", activeIcon: "text-amber-400 animate-pulse", value: null },
                        { key: "optimise", icon: Zap, label: "Optimise", activeBg: "bg-emerald-500/10 border-emerald-500/30", activeIcon: "text-emerald-400 animate-pulse", value: null },
                        { key: "streaming", icon: Radio, label: "Stream", activeBg: "bg-cyan-500/10 border-cyan-500/30", activeIcon: "text-cyan-400", value: null },
                        { key: "complete", icon: CheckCircle2, label: "Ready", activeBg: "bg-green-500/10 border-green-500/30", activeIcon: "text-green-400", value: null },
                      ] as const).map((s) => {
                        const stageOrder = ["backfill", "backtest", "ai_review", "optimise", "streaming", "complete"];
                        const currentIdx = stageOrder.indexOf(initStage);
                        const thisIdx = stageOrder.indexOf(s.key);
                        const isDone = thisIdx < currentIdx || initStage === "complete";
                        const isActive = s.key === initStage && initStage !== "complete";
                        const Icon = s.icon;
                        return (
                          <div key={s.key} className={`p-2 rounded-lg border text-center transition-colors ${
                            isActive ? s.activeBg :
                            isDone ? "bg-green-500/5 border-green-500/20" :
                            "bg-muted/20 border-border/40"
                          }`}>
                            <Icon className={`w-3.5 h-3.5 mx-auto mb-0.5 ${
                              isActive ? s.activeIcon :
                              isDone ? "text-green-400" : "text-muted-foreground"
                            }`} />
                            <p className="text-[9px] font-medium leading-tight">{s.label}</p>
                            <p className="text-[10px] font-bold tabular-nums mt-0.5">
                              {s.value ? s.value : isDone ? <CheckCircle2 className="w-3 h-3 text-green-400 mx-auto" /> : isActive ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "—"}
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    {initStage === "backfill" && Object.keys(symbolProgress).length > 0 && (
                      <div className="space-y-1.5 max-h-64 overflow-y-auto rounded-lg border border-border/30 p-3">
                        <p className="text-xs font-medium text-muted-foreground mb-2">Per-Symbol Progress</p>
                        {Object.entries(symbolProgress).map(([sym, info]) => {
                          const barPct = info.status === "done" ? 100 : info.status === "error" ? (info.pct || 0) : (info.pct || 0);
                          return (
                            <div key={sym} className="flex items-center gap-2 text-xs">
                              <span className="w-24 font-medium truncate">{sym}</span>
                              <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    info.status === "done" ? "bg-green-500" :
                                    info.status === "error" ? "bg-red-500" :
                                    info.status === "downloading" ? "bg-blue-500" :
                                    "bg-muted"
                                  }`}
                                  style={{ width: `${Math.max(barPct, info.status === "downloading" ? 2 : 0)}%` }}
                                />
                              </div>
                              <span className="w-20 text-right tabular-nums text-muted-foreground">
                                {info.status === "done" ? (
                                  <span className="text-green-400">{info.candles.toLocaleString()}</span>
                                ) : info.status === "error" ? (
                                  <span className="text-red-400">Error</span>
                                ) : info.status === "downloading" ? (
                                  <span className="text-blue-400">{info.candles > 0 ? info.candles.toLocaleString() : `${barPct}%`}</span>
                                ) : (
                                  "waiting"
                                )}
                              </span>
                              {info.oldestDate && (
                                <span className="w-20 text-right text-[10px] text-muted-foreground/70">{info.oldestDate}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {initStage === "backtest" && Object.keys(btSymbolResults).length > 0 && (
                      <div className="space-y-1.5 max-h-56 overflow-y-auto rounded-lg border border-border/30 p-3">
                        <p className="text-xs font-medium text-muted-foreground mb-2">Per-Symbol Backtest Results</p>
                        {Object.entries(btSymbolResults).map(([sym, info]) => (
                          <div key={sym} className="flex items-center gap-2 text-xs py-1 border-b border-border/10 last:border-0">
                            <span className="w-20 font-medium truncate">{sym}</span>
                            <span className="flex-1 text-muted-foreground truncate text-[10px]">{info.strategy.replace(/-/g, " ")}</span>
                            {info.tradeCount > 0 && (
                              <>
                                <span className="text-[10px] tabular-nums text-muted-foreground">{info.tradeCount} combos</span>
                                <span className="text-[10px] tabular-nums text-blue-400">WR {(info.winRate * 100).toFixed(0)}%</span>
                                <span className="text-[10px] tabular-nums text-purple-400">PF {info.profitFactor.toFixed(2)}</span>
                                <span className="text-[10px] tabular-nums text-muted-foreground">{info.avgHoldHours.toFixed(0)}h avg</span>
                              </>
                            )}
                            {info.tradeCount === 0 && <BarChart3 className="w-3 h-3 text-purple-400 animate-pulse" />}
                          </div>
                        ))}
                      </div>
                    )}

                    {(initStage === "ai_review" || initStage === "optimise" || initStage === "streaming" || initStage === "complete") && Object.keys(aiReviews).length > 0 && (
                      <div className="space-y-2 max-h-64 overflow-y-auto rounded-lg border border-border/30 p-3">
                        <p className="text-xs font-medium text-muted-foreground mb-2">AI Review Per Symbol</p>
                        {Object.entries(aiReviews).map(([sym, review]) => (
                          <div key={sym} className="p-2 rounded-md bg-muted/10 border border-border/20 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium">{sym}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {review.bestStrategy} — WR {(review.winRate * 100).toFixed(0)}% / PF {review.profitFactor.toFixed(2)}
                              </span>
                            </div>
                            {review.summary && (
                              <p className="text-[11px] text-muted-foreground leading-snug">{review.summary}</p>
                            )}
                            {review.suggestions && review.suggestions.length > 0 && (
                              <ul className="text-[10px] text-muted-foreground/80 list-disc list-inside">
                                {review.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <p className="text-sm text-muted-foreground text-center">{initStatus}</p>
                  </div>
                ) : (
                  <div className="text-center space-y-4">
                    <Database className="w-10 h-10 text-blue-400 mx-auto" />
                    <h2 className="text-lg font-semibold">System Initialisation</h2>
                    <p className="text-muted-foreground text-sm max-w-md mx-auto">
                      Download ALL available 1m & 5m price history, run all strategies as backtests
                      across every symbol, and AI-optimise your settings. This may take a while.
                    </p>
                    <div className="flex justify-center gap-3">
                      <Button variant="outline" onClick={goBack} className="px-6">
                        <ArrowLeft className="w-4 h-4 mr-2" /> Back
                      </Button>
                      <Button onClick={runInitialise}>
                        Start Initialisation <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === "complete" && (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8 text-green-500" />
                </div>
                <div className="space-y-3">
                  <h2 className="text-xl font-semibold text-foreground">You're All Set!</h2>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    Your platform has been configured with AI-optimised parameters based on
                    full historical backtested data.
                  </p>
                  <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto text-sm">
                    <div className="p-3 rounded-lg bg-muted/20 border border-border/40">
                      <p className="text-xs text-muted-foreground">Candles Loaded</p>
                      <p className="font-bold tabular-nums">{candleTotal > 0 ? candleTotal.toLocaleString() : "—"}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/20 border border-border/40">
                      <p className="text-xs text-muted-foreground">Backtests Run</p>
                      <p className="font-bold tabular-nums">{btCompleted > 0 ? btCompleted : "—"}</p>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  All modes start inactive. Enable Paper, Demo, or Real trading from the Settings page
                  when you're ready.
                </p>
                <Button size="lg" onClick={onComplete} className="px-8">
                  Go to Dashboard <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
