import { computeFeatures } from "./features.js";
import { runAllStrategies } from "./strategies.js";
import { routeSignals, logSignalDecisions } from "./signalRouter.js";
import { openPosition, manageOpenPositions } from "./tradeEngine.js";
import { verifySignal } from "./openai.js";
import { db, platformStateTable, tradesTable, candlesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";

const DEFAULT_SYMBOLS = [
  "BOOM1000", "CRASH1000", "BOOM500", "CRASH500",
  "R_75", "R_100", "JD75", "STPIDX", "RDBEAR"
];
const DEFAULT_SCAN_INTERVAL_MS = 30_000;
const POSITION_MGMT_INTERVAL_MS = 10_000;

let schedulerHandle: ReturnType<typeof setInterval> | null = null;
let positionMgmtHandle: ReturnType<typeof setInterval> | null = null;
let currentIntervalMs = DEFAULT_SCAN_INTERVAL_MS;

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

    if (mode === "idle" || killSwitch) return;

    const enabledSymbolsRaw = stateMap["enabled_symbols"] || "";
    const symbols = enabledSymbolsRaw
      ? enabledSymbolsRaw.split(",").map(s => s.trim()).filter(Boolean)
      : DEFAULT_SYMBOLS;

    const allCandidates = [];

    for (const symbol of symbols) {
      const features = await computeFeatures(symbol);
      if (!features) continue;

      const candidates = runAllStrategies(features);
      allCandidates.push(...candidates.map(c => ({ candidate: c, atr: features.atr14 })));
    }

    if (allCandidates.length === 0) return;

    const decisions = await routeSignals(allCandidates.map(c => c.candidate));

    const aiEnabled = stateMap["ai_verification_enabled"] === "true";
    const finalDecisions = [];

    for (const decision of decisions) {
      if (decision.allowed && aiEnabled) {
        try {
          const matchingCandidate = allCandidates.find(c => c.candidate.symbol === decision.signal.symbol && c.candidate.strategyName === decision.signal.strategyName);
          const features = matchingCandidate ? await computeFeatures(decision.signal.symbol) : null;

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

          const ema20Value = features ? features.priceVsEma20 : 0;
          const currentPrice = last5Candles.length > 0 ? last5Candles[0].close : 0;
          const estimatedEma20 = currentPrice > 0 ? currentPrice / (1 + ema20Value) : 0;

          const verdict = await verifySignal({
            symbol: decision.signal.symbol,
            direction: decision.signal.direction,
            confidence: decision.signal.confidence,
            score: decision.signal.score,
            strategyName: decision.signal.strategyName,
            reason: decision.signal.reason,
            rsi14: features?.rsi14 ?? 50,
            atr14: features?.atr14 ?? 0.01,
            ema20: estimatedEma20,
            bbWidth: features?.bbWidth ?? 0,
            zScore: features?.zScore ?? 0,
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
              console.log(`[AI] Blocked ${decision.signal.symbol} ${decision.signal.strategyName}: ${verdict.reasoning}`);
            } else if (verdict.verdict === "uncertain") {
              decision.capitalAmount = decision.capitalAmount * 0.5;
              console.log(`[AI] Reduced size for ${decision.signal.symbol}: ${verdict.reasoning}`);
            } else {
              console.log(`[AI] Agreed with ${decision.signal.symbol} ${decision.signal.strategyName}`);
            }
          }
        } catch (err) {
          console.error("[AI] Verification error:", err instanceof Error ? err.message : err);
          decision.allowed = false;
          decision.rejectionReason = `AI verification unavailable: ${err instanceof Error ? err.message : "unknown error"}`;
          decision.aiVerdict = "error";
          decision.aiReasoning = `Verification failed: ${err instanceof Error ? err.message : "unknown error"}`;
        }
      }
      finalDecisions.push(decision);
    }

    await logSignalDecisions(finalDecisions);

    const allowed = finalDecisions.filter(d => d.allowed);
    const rejected = finalDecisions.filter(d => !d.allowed);

    if (mode === "paper" || mode === "live") {
      for (const decision of allowed) {
        const matchingCandidate = allCandidates.find(c => c.candidate.symbol === decision.signal.symbol && c.candidate.strategyName === decision.signal.strategyName);
        const atr = matchingCandidate?.atr ?? 0.01;
        await openPosition(decision, atr);
      }
    }

    console.log(`[Scheduler] Scan complete: ${allCandidates.length} candidates → ${allowed.length} allowed, ${rejected.length} rejected`);
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
}
