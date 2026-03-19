import { computeFeatures } from "./features.js";
import { runAllStrategies } from "./strategies.js";
import { routeSignals, logSignalDecisions } from "./signalRouter.js";
import { openPosition, manageOpenPositions } from "./tradeEngine.js";
import { verifySignal } from "./openai.js";
import { db, platformStateTable, tradesTable, candlesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";

const DEFAULT_SYMBOLS = [
  "BOOM1000", "CRASH1000", "BOOM500", "CRASH500",
  "BOOM300", "CRASH300", "BOOM200", "CRASH200",
  "R_75", "R_100", "JD75", "STPIDX", "RDBEAR"
];
const DEFAULT_SCAN_INTERVAL_MS = 30_000;
const DEFAULT_STAGGER_SECONDS = 10;
const POSITION_MGMT_INTERVAL_MS = 10_000;

let schedulerHandle: ReturnType<typeof setInterval> | null = null;
let positionMgmtHandle: ReturnType<typeof setInterval> | null = null;
let currentIntervalMs = DEFAULT_SCAN_INTERVAL_MS;

let staggeredScanActive = false;
let staggerSymbolIndex = 0;
let staggerTimerHandle: ReturnType<typeof setTimeout> | null = null;

async function scanSingleSymbol(symbol: string, stateMap: Record<string, string>): Promise<void> {
  const features = await computeFeatures(symbol);
  if (!features) return;

  const candidates = runAllStrategies(features);
  if (candidates.length === 0) return;

  const allCandidates = candidates.map(c => ({ candidate: c, atr: features.atr14 }));
  const decisions = await routeSignals(allCandidates.map(c => c.candidate));

  const aiEnabled = stateMap["ai_verification_enabled"] === "true";
  const finalDecisions = [];

  for (const decision of decisions) {
    if (decision.allowed && aiEnabled) {
      try {
        const matchingCandidate = allCandidates.find(c => c.candidate.symbol === decision.signal.symbol && c.candidate.strategyName === decision.signal.strategyName);
        const feats = matchingCandidate ? await computeFeatures(decision.signal.symbol) : null;

        const recentTrades = await db.select().from(tradesTable)
          .where(eq(tradesTable.symbol, decision.signal.symbol))
          .orderBy(desc(tradesTable.entryTs))
          .limit(5);
        const recentWinLoss = recentTrades.length > 0
          ? recentTrades.map(t => `${t.side} ${t.status} PnL:${(t.pnl ?? 0).toFixed(2)}`).join("; ")
          : "No recent trades";

        const last5Candles = await db.select().from(candlesTable)
          .where(and(eq(candlesTable.symbol, decision.signal.symbol), eq(candlesTable.timeframe, "1m")))
          .orderBy(desc(candlesTable.openTs))
          .limit(5);
        const candleDescriptions = last5Candles.length > 0
          ? last5Candles.map((c, i) => `[${i+1}] O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)} Vol:${c.tickCount}`).join("; ")
          : "No recent candles";

        const ema20Value = feats ? feats.priceVsEma20 : 0;
        const currentPrice = last5Candles.length > 0 ? last5Candles[0].close : 0;
        const estimatedEma20 = currentPrice > 0 ? currentPrice / (1 + ema20Value) : 0;

        const verdict = await verifySignal({
          symbol: decision.signal.symbol,
          direction: decision.signal.direction,
          confidence: decision.signal.confidence,
          score: decision.signal.score,
          strategyName: decision.signal.strategyName,
          reason: decision.signal.reason,
          rsi14: feats?.rsi14 ?? 50,
          atr14: feats?.atr14 ?? 0.01,
          ema20: estimatedEma20,
          bbWidth: feats?.bbWidth ?? 0,
          zScore: feats?.zScore ?? 0,
          recentCandles: candleDescriptions,
          recentWinLoss,
        });

        if (verdict) {
          decision.aiVerdict = verdict.verdict;
          decision.aiReasoning = verdict.reasoning;
          decision.aiConfidenceAdj = verdict.confidenceAdjustment;

          if (verdict.verdict === "disagree") {
            decision.allowed = false;
            decision.rejectionReason = `AI disagree: ${verdict.reasoning}`;
          } else if (verdict.verdict === "uncertain") {
            decision.capitalAmount = decision.capitalAmount * 0.5;
          }
        }
      } catch (err) {
        decision.allowed = false;
        decision.rejectionReason = `AI verification unavailable: ${err instanceof Error ? err.message : "unknown error"}`;
        decision.aiVerdict = "error";
        decision.aiReasoning = `Verification failed: ${err instanceof Error ? err.message : "unknown error"}`;
      }
    }
    finalDecisions.push(decision);
  }

  await logSignalDecisions(finalDecisions);

  const mode = stateMap["mode"] || "idle";
  const allowed = finalDecisions.filter(d => d.allowed);
  if (mode === "paper" || mode === "live") {
    for (const decision of allowed) {
      const matchingCandidate = allCandidates.find(c => c.candidate.symbol === decision.signal.symbol && c.candidate.strategyName === decision.signal.strategyName);
      const atr = matchingCandidate?.atr ?? 0.01;
      await openPosition(decision, atr);
    }
  }
}

async function scheduleStaggeredScan(symbols: string[], staggerMs: number, stateMap: Record<string, string>): Promise<void> {
  if (staggerSymbolIndex >= symbols.length) {
    staggerSymbolIndex = 0;
  }

  const symbol = symbols[staggerSymbolIndex];
  staggerSymbolIndex++;

  try {
    await scanSingleSymbol(symbol, stateMap);
  } catch (err) {
    console.error(`[Scheduler] Stagger scan error for ${symbol}:`, err instanceof Error ? err.message : err);
  }

  if (staggeredScanActive) {
    staggerTimerHandle = setTimeout(() => scheduleStaggeredScan(symbols, staggerMs, stateMap), staggerMs);
  }
}

async function scanCycle(): Promise<void> {
  try {
    const states = await db.select().from(platformStateTable);
    const stateMap: Record<string, string> = {};
    for (const s of states) stateMap[s.key] = s.value;

    const configuredInterval = parseInt(stateMap["scan_interval_seconds"] || "30") * 1000;
    if (configuredInterval !== currentIntervalMs && configuredInterval >= 5000) {
      currentIntervalMs = configuredInterval;
      if (schedulerHandle) {
        clearInterval(schedulerHandle);
        schedulerHandle = setInterval(scanCycle, currentIntervalMs);
        console.log(`[Scheduler] Scan interval updated to ${currentIntervalMs / 1000}s`);
      }
    }

    const mode = stateMap["mode"] || "idle";
    const killSwitch = stateMap["kill_switch"] === "true";

    if (mode === "idle" || killSwitch) {
      if (staggeredScanActive) {
        staggeredScanActive = false;
        if (staggerTimerHandle) { clearTimeout(staggerTimerHandle); staggerTimerHandle = null; }
      }
      return;
    }

    const enabledSymbolsRaw = stateMap["enabled_symbols"] || "";
    const symbols = enabledSymbolsRaw
      ? enabledSymbolsRaw.split(",").map(s => s.trim()).filter(Boolean)
      : DEFAULT_SYMBOLS;

    const staggerSeconds = parseInt(stateMap["scan_stagger_seconds"] || String(DEFAULT_STAGGER_SECONDS));
    const staggerMs = Math.max(staggerSeconds * 1000, 1000);

    if (!staggeredScanActive) {
      staggeredScanActive = true;
      staggerSymbolIndex = 0;
      console.log(`[Scheduler] Starting staggered scan: ${symbols.length} symbols, ${staggerSeconds}s apart`);
      scheduleStaggeredScan(symbols, staggerMs, stateMap).catch(console.error);
    } else {
      const newStaggerMs = Math.max(parseInt(stateMap["scan_stagger_seconds"] || String(DEFAULT_STAGGER_SECONDS)) * 1000, 1000);
      if (newStaggerMs !== staggerMs) {
        console.log(`[Scheduler] Stagger interval updated to ${newStaggerMs / 1000}s`);
      }
    }
  } catch (err) {
    console.error("[Scheduler] Scan error:", err instanceof Error ? err.message : err);
  }
}

async function positionManagementCycle(): Promise<void> {
  try {
    const states = await db.select().from(platformStateTable);
    const stateMap: Record<string, string> = {};
    for (const s of states) stateMap[s.key] = s.value;
    const mode = stateMap["mode"] || "idle";
    if (mode === "idle") return;

    await manageOpenPositions();
  } catch (err) {
    console.error("[Scheduler] Position management error:", err instanceof Error ? err.message : err);
  }
}

export function startScheduler(): void {
  if (schedulerHandle) return;
  console.log(`[Scheduler] Starting signal scan every ${currentIntervalMs / 1000}s`);
  schedulerHandle = setInterval(scanCycle, currentIntervalMs);
  setTimeout(scanCycle, 5000);

  console.log(`[Scheduler] Starting position management every ${POSITION_MGMT_INTERVAL_MS / 1000}s`);
  positionMgmtHandle = setInterval(positionManagementCycle, POSITION_MGMT_INTERVAL_MS);
  setTimeout(positionManagementCycle, 8000);
}

export function stopScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
    console.log("[Scheduler] Signal scanner stopped.");
  }
  if (positionMgmtHandle) {
    clearInterval(positionMgmtHandle);
    positionMgmtHandle = null;
    console.log("[Scheduler] Position manager stopped.");
  }
  staggeredScanActive = false;
  if (staggerTimerHandle) {
    clearTimeout(staggerTimerHandle);
    staggerTimerHandle = null;
  }
}
