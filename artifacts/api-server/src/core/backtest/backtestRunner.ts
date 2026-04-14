/**
 * backtestRunner.ts — V3 Unified Runtime Backtest Engine
 *
 * Replays historical candles bar-by-bar using the EXACT same decision path
 * as the live scanner:
 *
 *   features → HTF regime (averaged) → engines → symbolCoordinator → exit model
 *
 * Exit model (mirroring live hybridTradeManager + tradeEngine):
 *   Stage 1: SL at original position (1:5 RR from TP)
 *   Stage 2: SL promoted to breakeven after 20% of TP distance reached
 *   Stage 3: Adaptive ATR trailing stop from 30% of TP distance reached
 *   TP:      SR/Fib TP (calculateSRFibTP) — same function as live
 *   SL:      calculateSRFibSL (TP/5 = 1:5 RR) — same function as live
 *   Max:     30 calendar days (43,200 1m bars)
 *
 * Divergences from old runner (now eliminated):
 *   OLD: bare classifyRegime per bar → NEW: HTF-averaged regime
 *   OLD: highest-score loop → NEW: runSymbolCoordinator
 *   OLD: Leg1/Hard-SL/MFE exits → NEW: SR/Fib TP + 1:5 SL + BE + ATR trail
 *
 * Design constraints:
 *   - No DB calls inside the hot loop (candles pre-loaded at startup)
 *   - HTF regime averaged over last 60 1m feature samples (~1 hour)
 *   - One open trade per symbol at a time (no pyramiding)
 *   - Behavior events captured for each trade (exported via /api/behavior)
 */

import { db, candlesTable } from "@workspace/db";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import { computeFeaturesFromSlice, type CandleRow } from "./featureSlice.js";
import { classifyRegime } from "../regimeEngine.js";
import { getEnginesForSymbol } from "../engineRegistry.js";
import { runSymbolCoordinator } from "../symbolCoordinator.js";
import { calculateSRFibTP, calculateSRFibSL, calculateAdaptiveTrailingStop } from "../tradeEngine.js";
import { getSymbolIndicatorTimeframeMins } from "../features.js";
import type { EngineResult } from "../engineTypes.js";
import type { FeatureVector } from "../features.js";
import { recordBehaviorEvent, type BehaviorEvent } from "./behaviorCapture.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const STRUCTURAL_LOOKBACK = 1500;
const MAX_HOLD_BARS = 43_200;             // 30 days in 1m bars
const STAGE2_BREAKEVEN_THRESHOLD = 0.20;  // 20% of TP distance → promote to breakeven
const STAGE3_TRAIL_THRESHOLD = 0.30;      // 30% of TP distance → activate adaptive trail
const SYNTHETIC_EQUITY = 10_000;          // for calculateSRFibSL sizing math
const SYNTHETIC_SIZE = 1_500;             // 15% of synthetic equity
const HTF_AVERAGING_WINDOW = 60;          // 60 recent feature samples for HTF avg (≈1 hour)

// ── Types ─────────────────────────────────────────────────────────────────────

export interface V3BacktestTrade {
  entryTs: number;
  exitTs: number;
  symbol: string;
  direction: "buy" | "sell";
  engineName: string;
  entryType: string;
  entryPrice: number;
  exitPrice: number;
  exitReason: "tp_hit" | "sl_hit" | "max_duration";
  slStage: 1 | 2 | 3;
  projectedMovePct: number;
  nativeScore: number;
  regimeAtEntry: string;
  regimeConfidence: number;
  holdBars: number;
  pnlPct: number;
  mfePct: number;
  maePct: number;
  tpPct: number;
  slPct: number;
  conflictResolution: string;
}

export interface V3BacktestResult {
  symbol: string;
  startTs: number;
  endTs: number;
  totalBars: number;
  trades: V3BacktestTrade[];
  summary: {
    tradeCount: number;
    winCount: number;
    lossCount: number;
    winRate: number;
    avgPnlPct: number;
    avgWinPct: number;
    avgLossPct: number;
    totalPnlPct: number;
    profitFactor: number;
    maxDrawdownPct: number;
    avgHoldBars: number;
    avgMfePct: number;
    byEngine: Record<string, { count: number; wins: number; avgPnlPct: number }>;
    byExitReason: Record<string, number>;
    bySlStage: Record<string, number>;
    byRegime: Record<string, { count: number; wins: number }>;
  };
}

export interface V3BacktestRequest {
  symbol: string;
  startTs?: number;
  endTs?: number;
  minScore?: number;
}

// ── HTF regime averaging (local, no shared state) ─────────────────────────────

interface FeatureSample {
  emaSlope: number;
  rsi14: number;
  bbWidth: number;
  bbWidthRoc: number;
  atr14: number;
  atrRank: number;
  atrAccel: number;
  zScore: number;
  spikeHazardScore: number;
  bbPctB: number;
}

function classifyRegimeHTFLocal(
  features: FeatureVector,
  featureHistory: FeatureSample[],
): ReturnType<typeof classifyRegime> {
  if (featureHistory.length < 3) {
    return classifyRegime(features);
  }
  const n = featureHistory.length;
  const avg = (fn: (s: FeatureSample) => number) =>
    featureHistory.reduce((s, x) => s + fn(x), 0) / n;

  const htfFeatures: FeatureVector = {
    ...features,
    emaSlope: avg(s => s.emaSlope),
    rsi14: avg(s => s.rsi14),
    bbWidth: avg(s => s.bbWidth),
    bbWidthRoc: avg(s => s.bbWidthRoc),
    atr14: avg(s => s.atr14),
    atrRank: avg(s => s.atrRank),
    atrAccel: avg(s => s.atrAccel),
    zScore: avg(s => s.zScore),
    spikeHazardScore: avg(s => s.spikeHazardScore),
    bbPctB: avg(s => s.bbPctB),
  };
  return classifyRegime(htfFeatures);
}

// ── Summary builder ───────────────────────────────────────────────────────────

function computeSummary(trades: V3BacktestTrade[]): V3BacktestResult["summary"] {
  if (trades.length === 0) {
    return {
      tradeCount: 0, winCount: 0, lossCount: 0, winRate: 0,
      avgPnlPct: 0, avgWinPct: 0, avgLossPct: 0, totalPnlPct: 0,
      profitFactor: 0, maxDrawdownPct: 0, avgHoldBars: 0, avgMfePct: 0,
      byEngine: {}, byExitReason: {}, bySlStage: {}, byRegime: {},
    };
  }

  const wins = trades.filter(t => t.pnlPct > 0);
  const losses = trades.filter(t => t.pnlPct <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));

  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of trades) {
    equity += t.pnlPct;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }

  const byEngine: Record<string, { count: number; wins: number; avgPnlPct: number }> = {};
  for (const t of trades) {
    if (!byEngine[t.engineName]) byEngine[t.engineName] = { count: 0, wins: 0, avgPnlPct: 0 };
    byEngine[t.engineName].count++;
    if (t.pnlPct > 0) byEngine[t.engineName].wins++;
    byEngine[t.engineName].avgPnlPct += t.pnlPct;
  }
  for (const k of Object.keys(byEngine)) {
    byEngine[k].avgPnlPct /= byEngine[k].count;
  }

  const byExitReason: Record<string, number> = {};
  for (const t of trades) {
    byExitReason[t.exitReason] = (byExitReason[t.exitReason] ?? 0) + 1;
  }

  const bySlStage: Record<string, number> = {};
  for (const t of trades) {
    const key = `stage_${t.slStage}`;
    bySlStage[key] = (bySlStage[key] ?? 0) + 1;
  }

  const byRegime: Record<string, { count: number; wins: number }> = {};
  for (const t of trades) {
    if (!byRegime[t.regimeAtEntry]) byRegime[t.regimeAtEntry] = { count: 0, wins: 0 };
    byRegime[t.regimeAtEntry].count++;
    if (t.pnlPct > 0) byRegime[t.regimeAtEntry].wins++;
  }

  return {
    tradeCount: trades.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    avgPnlPct: trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length,
    avgWinPct: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLossPct: losses.length > 0 ? -grossLoss / losses.length : 0,
    totalPnlPct: trades.reduce((s, t) => s + t.pnlPct, 0),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    maxDrawdownPct: maxDd,
    avgHoldBars: trades.reduce((s, t) => s + t.holdBars, 0) / trades.length,
    avgMfePct: trades.reduce((s, t) => s + t.mfePct, 0) / trades.length,
    byEngine,
    byExitReason,
    bySlStage,
    byRegime,
  };
}

// ── Instrument family helper ───────────────────────────────────────────────────

function getInstrumentFamily(symbol: string): "crash" | "boom" | "volatility" {
  if (symbol.startsWith("CRASH")) return "crash";
  if (symbol.startsWith("BOOM")) return "boom";
  return "volatility";
}

// ── Open trade state ──────────────────────────────────────────────────────────

interface OpenTradeState {
  winner: EngineResult;
  entryBar: number;
  entryPrice: number;
  entryTs: number;
  regimeAtEntry: string;
  regimeConfidence: number;
  nativeScore: number;
  conflictResolution: string;
  tp: number;
  sl: number;
  originalSl: number;
  stage: 1 | 2 | 3;
  peakPrice: number;
  mfePct: number;
  maePct: number;
  atr14AtEntry: number;
  instrumentFamily: "crash" | "boom" | "volatility";
  emaSlope: number;
  spikeCount4h: number;
  adverseCandleCount: number;
  tpPct: number;
  slOriginalPct: number;
}

// ── Core simulation loop ──────────────────────────────────────────────────────

export async function runV3Backtest(req: V3BacktestRequest): Promise<V3BacktestResult> {
  const now = Math.floor(Date.now() / 1000);
  const startTs = req.startTs ?? (now - 90 * 86400);
  const endTs = req.endTs ?? now;
  const symbol = req.symbol;
  const minScore = req.minScore;

  const bufferStartTs = startTs - STRUCTURAL_LOOKBACK * 60;

  const rawCandles = await db.select({
    open: candlesTable.open,
    high: candlesTable.high,
    low: candlesTable.low,
    close: candlesTable.close,
    openTs: candlesTable.openTs,
    closeTs: candlesTable.closeTs,
  }).from(candlesTable)
    .where(
      and(
        eq(candlesTable.symbol, symbol),
        eq(candlesTable.timeframe, "1m"),
        gte(candlesTable.openTs, bufferStartTs),
        lte(candlesTable.openTs, endTs)
      )
    )
    .orderBy(asc(candlesTable.openTs));

  if (rawCandles.length < 60) {
    return {
      symbol, startTs, endTs, totalBars: 0, trades: [],
      summary: computeSummary([]),
    };
  }

  const candles = rawCandles as CandleRow[];

  let simStart = candles.findIndex(c => c.openTs >= startTs);
  if (simStart < 0) simStart = candles.length - 1;
  if (simStart < STRUCTURAL_LOOKBACK) simStart = STRUCTURAL_LOOKBACK;

  const engines = getEnginesForSymbol(symbol);
  const instrumentFamily = getInstrumentFamily(symbol);
  const htfMins = getSymbolIndicatorTimeframeMins(symbol);
  const indicatorLookback = 55 * htfMins;

  const trades: V3BacktestTrade[] = [];
  let openTrade: OpenTradeState | null = null;

  // Per-bar local HTF feature history for regime averaging
  const featureHistory: FeatureSample[] = [];

  for (let i = simStart; i < candles.length; i++) {
    const sliceStart = Math.max(0, i - STRUCTURAL_LOOKBACK + 1);
    const slice = candles.slice(sliceStart, i + 1);
    const bar = candles[i];

    // ── Manage open trade ─────────────────────────────────────────────────
    if (openTrade !== null) {
      const dir = openTrade.winner.direction;
      const ep = openTrade.entryPrice;

      // Track peak price for trailing stop
      const favorable = dir === "buy" ? bar.high : bar.low;
      if (dir === "buy" && favorable > openTrade.peakPrice) openTrade.peakPrice = favorable;
      if (dir === "sell" && favorable < openTrade.peakPrice) openTrade.peakPrice = favorable;

      // MFE / MAE tracking (as pct from entry)
      const barMfe = dir === "buy"
        ? (bar.high - ep) / ep
        : (ep - bar.low) / ep;
      const barMae = dir === "buy"
        ? (bar.low - ep) / ep
        : (ep - bar.high) / ep;
      if (barMfe > openTrade.mfePct) openTrade.mfePct = barMfe;
      if (barMae < openTrade.maePct) openTrade.maePct = barMae;

      // Adverse candle count (consecutive bars moving against trade)
      const barIsFavorable = dir === "buy"
        ? bar.close >= bar.open
        : bar.close <= bar.open;
      openTrade.adverseCandleCount = barIsFavorable ? 0 : openTrade.adverseCandleCount + 1;

      // ── Stage 1→2: Breakeven promotion ─────────────────────────────────
      if (openTrade.stage === 1) {
        const tpDist = Math.abs(openTrade.tp - ep);
        const currentPnl = dir === "buy"
          ? (bar.close - ep) / ep
          : (ep - bar.close) / ep;
        const currentDist = dir === "buy"
          ? Math.max(0, bar.close - ep)
          : Math.max(0, ep - bar.close);
        const progress = tpDist > 0 ? currentDist / tpDist : 0;

        if (progress >= STAGE2_BREAKEVEN_THRESHOLD) {
          const buffer = ep * 0.0005;
          const beSlPrice = dir === "buy" ? ep + buffer : ep - buffer;
          const slImproved = dir === "buy"
            ? beSlPrice > openTrade.sl
            : beSlPrice < openTrade.sl;
          if (slImproved) {
            openTrade.sl = beSlPrice;
            openTrade.stage = 2;
          }
        }
        void currentPnl;
      }

      // ── Stage 2→3: Adaptive trailing stop ──────────────────────────────
      if (openTrade.stage >= 2) {
        const tpDist = Math.abs(openTrade.tp - ep);
        const currentPnl = dir === "buy"
          ? (bar.close - ep) / ep
          : (ep - bar.close) / ep;
        const tpPctVal = tpDist > 0 ? tpDist / ep : 0;
        const progress = tpPctVal > 0 ? currentPnl / tpPctVal : 0;

        if (progress >= STAGE3_TRAIL_THRESHOLD) {
          openTrade.stage = 3;
          const { newSl, updated } = calculateAdaptiveTrailingStop({
            entryPrice: ep,
            currentPrice: bar.close,
            peakPrice: openTrade.peakPrice,
            direction: dir,
            currentSl: openTrade.sl,
            tpPrice: openTrade.tp,
            atr14Pct: openTrade.atr14AtEntry,
            instrumentFamily: openTrade.instrumentFamily,
            adverseCandleCount: openTrade.adverseCandleCount,
            emaSlope: openTrade.emaSlope,
            spikeCountAdverse4h: openTrade.spikeCount4h,
          });
          if (updated) {
            openTrade.sl = newSl;
          }
        }
        void currentPnl;
      }

      // ── Exit checks ─────────────────────────────────────────────────────
      const holdBars = i - openTrade.entryBar;
      let exitReason: V3BacktestTrade["exitReason"] | null = null;
      let exitPrice = bar.close;

      // SL hit (check bar extremes)
      const slBreached = dir === "buy"
        ? bar.low <= openTrade.sl
        : bar.high >= openTrade.sl;
      if (slBreached) {
        exitReason = "sl_hit";
        exitPrice = openTrade.sl;
      }

      // TP hit (check bar extremes, prefer TP over SL if both on same bar)
      if (!exitReason || exitReason === "sl_hit") {
        const tpReached = dir === "buy"
          ? bar.high >= openTrade.tp
          : bar.low <= openTrade.tp;
        if (tpReached) {
          exitReason = "tp_hit";
          exitPrice = openTrade.tp;
        }
      }

      // Max duration
      if (!exitReason && holdBars >= MAX_HOLD_BARS) {
        exitReason = "max_duration";
        exitPrice = bar.close;
      }

      if (exitReason) {
        const finalPnl = dir === "buy"
          ? (exitPrice - ep) / ep
          : (ep - exitPrice) / ep;

        const trade: V3BacktestTrade = {
          entryTs: openTrade.entryTs,
          exitTs: bar.closeTs,
          symbol,
          direction: dir,
          engineName: openTrade.winner.engineName,
          entryType: openTrade.winner.entryType,
          entryPrice: ep,
          exitPrice,
          exitReason,
          slStage: openTrade.stage,
          projectedMovePct: openTrade.winner.projectedMovePct,
          nativeScore: openTrade.nativeScore,
          regimeAtEntry: openTrade.regimeAtEntry,
          regimeConfidence: openTrade.regimeConfidence,
          holdBars,
          pnlPct: finalPnl,
          mfePct: openTrade.mfePct,
          maePct: openTrade.maePct,
          tpPct: openTrade.tpPct,
          slPct: openTrade.slOriginalPct,
          conflictResolution: openTrade.conflictResolution,
        };

        trades.push(trade);

        // Capture behavior event
        recordBehaviorEvent({
          symbol,
          engineName: openTrade.winner.engineName,
          entryType: openTrade.winner.entryType,
          direction: dir,
          regimeAtEntry: openTrade.regimeAtEntry,
          regimeConfidence: openTrade.regimeConfidence,
          nativeScore: openTrade.nativeScore,
          projectedMovePct: openTrade.winner.projectedMovePct,
          entryTs: openTrade.entryTs,
          exitTs: bar.closeTs,
          holdBars,
          pnlPct: finalPnl,
          mfePct: openTrade.mfePct,
          maePct: openTrade.maePct,
          exitReason,
          slStage: openTrade.stage,
          conflictResolution: openTrade.conflictResolution,
        });

        openTrade = null;
      }

      if (openTrade !== null) continue;
    }

    // ── Signal scan (only when no open trade) ─────────────────────────────
    if (slice.length < Math.max(60, Math.ceil(indicatorLookback / 60))) continue;

    const features = computeFeaturesFromSlice(symbol, slice);
    if (!features) continue;

    // Accumulate feature sample for HTF averaging
    featureHistory.push({
      emaSlope: features.emaSlope,
      rsi14: features.rsi14,
      bbWidth: features.bbWidth,
      bbWidthRoc: features.bbWidthRoc,
      atr14: features.atr14,
      atrRank: features.atrRank,
      atrAccel: features.atrAccel,
      zScore: features.zScore,
      spikeHazardScore: features.spikeHazardScore,
      bbPctB: features.bbPctB,
    });
    if (featureHistory.length > HTF_AVERAGING_WINDOW) {
      featureHistory.shift();
    }

    // HTF-averaged regime classification (matches live path)
    const regimeResult = classifyRegimeHTFLocal(features, featureHistory);

    const ctx = {
      features,
      operationalRegime: regimeResult.regime,
      regimeConfidence: regimeResult.confidence,
    };

    // Run all engines and apply score gate
    const engineResults: EngineResult[] = [];
    for (const engine of engines) {
      try {
        const result = engine(ctx);
        if (!result || !result.valid) continue;
        const score = Math.round(result.confidence * 100);
        if (minScore !== undefined && score < minScore) continue;
        engineResults.push(result);
      } catch {
        // Silent: engine error in backtest is non-fatal
      }
    }

    if (engineResults.length === 0) continue;

    // Coordinator selection (matches live path)
    const coordinatorOutput = runSymbolCoordinator(symbol, engineResults);
    if (!coordinatorOutput) continue;

    const { winner, conflictResolution } = coordinatorOutput;
    const nativeScore =
      winner.metadata?.["boom300NativeScore"] != null ? (winner.metadata["boom300NativeScore"] as number)
      : winner.metadata?.["crash300NativeScore"] != null ? (winner.metadata["crash300NativeScore"] as number)
      : winner.metadata?.["r75ReversalNativeScore"] != null ? (winner.metadata["r75ReversalNativeScore"] as number)
      : winner.metadata?.["r75ContinuationNativeScore"] != null ? (winner.metadata["r75ContinuationNativeScore"] as number)
      : winner.metadata?.["r75BreakoutNativeScore"] != null ? (winner.metadata["r75BreakoutNativeScore"] as number)
      : winner.metadata?.["r100ReversalNativeScore"] != null ? (winner.metadata["r100ReversalNativeScore"] as number)
      : winner.metadata?.["r100BreakoutNativeScore"] != null ? (winner.metadata["r100BreakoutNativeScore"] as number)
      : winner.metadata?.["r100ContinuationNativeScore"] != null ? (winner.metadata["r100ContinuationNativeScore"] as number)
      : Math.round(coordinatorOutput.coordinatorConfidence * 100);

    // Apply score gate to coordinator winner if minScore specified
    if (minScore !== undefined && nativeScore < minScore) continue;

    const entryPrice = bar.close;
    const dir = winner.direction;

    // ── SR/Fib TP (same as live openPositionV3) ─────────────────────────
    const tp = calculateSRFibTP({
      entryPrice,
      direction: dir,
      swingHigh: features.swingHigh,
      swingLow: features.swingLow,
      majorSwingHigh: features.majorSwingHigh,
      majorSwingLow: features.majorSwingLow,
      fibExtensionLevels: features.fibExtensionLevels ?? [],
      fibExtensionLevelsDown: features.fibExtensionLevelsDown ?? [],
      bbUpper: features.bbUpper,
      bbLower: features.bbLower,
      atrPct: features.atr14,
      pivotLevels: [
        features.pivotR1, features.pivotR2, features.pivotS1, features.pivotS2,
      ].filter((v): v is number => typeof v === "number"),
      vwap: features.vwap,
      psychRound: features.psychRound,
      prevSessionHigh: features.prevSessionHigh,
      prevSessionLow: features.prevSessionLow,
      spikeMagnitude: features.spikeMagnitude,
    });

    if (!isFinite(tp) || tp <= 0) continue;

    // ── SR/Fib SL at 1:5 RR (same as live) ─────────────────────────────
    const sl = calculateSRFibSL({
      entryPrice,
      direction: dir,
      tp,
      positionSize: SYNTHETIC_SIZE,
      equity: SYNTHETIC_EQUITY,
    });

    if (!isFinite(sl) || sl <= 0) continue;

    const tpPct = Math.abs(tp - entryPrice) / entryPrice;
    const slOriginalPct = Math.abs(sl - entryPrice) / entryPrice;

    // Sanity: TP must be in correct direction
    if (dir === "buy" && tp <= entryPrice) continue;
    if (dir === "sell" && tp >= entryPrice) continue;

    openTrade = {
      winner,
      entryBar: i,
      entryPrice,
      entryTs: bar.closeTs,
      regimeAtEntry: regimeResult.regime,
      regimeConfidence: regimeResult.confidence,
      nativeScore,
      conflictResolution,
      tp,
      sl,
      originalSl: sl,
      stage: 1,
      peakPrice: entryPrice,
      mfePct: 0,
      maePct: 0,
      atr14AtEntry: Math.max(features.atr14, 0.001),
      instrumentFamily,
      emaSlope: features.emaSlope,
      spikeCount4h: features.spikeCount4h ?? 0,
      adverseCandleCount: 0,
      tpPct,
      slOriginalPct,
    };
  }

  const barsInRange = Math.max(0, candles.length - simStart);

  return {
    symbol,
    startTs,
    endTs,
    totalBars: barsInRange,
    trades,
    summary: computeSummary(trades),
  };
}

/**
 * Run V3 backtest across multiple symbols concurrently.
 */
export async function runV3BacktestMulti(
  symbols: string[],
  startTs?: number,
  endTs?: number,
  minScore?: number,
): Promise<Record<string, V3BacktestResult>> {
  const results = await Promise.all(
    symbols.map(sym => runV3Backtest({ symbol: sym, startTs, endTs, minScore }))
  );

  const out: Record<string, V3BacktestResult> = {};
  for (let i = 0; i < symbols.length; i++) {
    out[symbols[i]] = results[i];
  }
  return out;
}
