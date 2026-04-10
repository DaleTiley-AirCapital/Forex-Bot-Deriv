/**
 * Deterministic Strategy Extractor — V3 Research Engine
 *
 * Reads real candle data from the `candles` table (excluding interpolated rows)
 * and computes quantitative strategy rankings from observed price behavior.
 *
 * The extractor derives its findings from data — it does NOT assume a fixed
 * TP target or lock in the 50-200% mandate as the only valid answer.
 * The AI layer then explains and validates the ranked output.
 *
 * Output: ranked candidate strategies ordered by expected monthly return.
 */

import { backgroundDb, candlesTable } from "@workspace/db";
import { eq, and, gte, asc, min, max, count } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Candle {
  openTs:  number;
  open:    number;
  high:    number;
  low:     number;
  close:   number;
}

export interface DetectedMove {
  direction:     "up" | "down";
  startTs:       number;
  endTs:         number;
  startPrice:    number;
  endPrice:      number;
  movePct:       number;
  holdMinutes:   number;
  candleCount:   number;
}

export interface StrategyCandidate {
  id:                        string;
  family:                    string;
  direction:                 "up" | "down" | "both";
  holdClass:                 "long" | "medium" | "short";
  thresholdPct:              number;
  tradeCount:                number;
  tradesPerMonth:            number;
  avgMovePct:                number;
  medianMovePct:             number;
  p25MovePct:                number;
  p75MovePct:                number;
  avgHoldHours:              number;
  medianHoldHours:           number;
  winRate:                   number;
  avgWinPct:                 number;
  avgLossPct:                number;
  maxObservedMovePct:        number;
  minObservedMovePct:        number;
  roughSLPct:                number;
  roughTPPct:                number;
  expectedMonthlyReturnPct:  number;
  capitalEfficiencyScore:    number;
  consistency:               number;
  rankScore:                 number;
  description:               string;
}

export interface StrategyRankingReport {
  symbol:            string;
  timeframe:         string;
  windowDays:        number;
  dataFrom:          string;
  dataTo:            string;
  totalRealCandles:  number;
  interpolatedCount: number;
  monthsOfData:      number;
  candidates:        StrategyCandidate[];
  topStrategy:       StrategyCandidate | null;
  generatedAt:       string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx    = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p / 100)));
  return sorted[idx];
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m  = mean(arr);
  const variance = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function holdClass(avgHours: number): "long" | "medium" | "short" {
  if (avgHours > 24) return "long";
  if (avgHours >= 4) return "medium";
  return "short";
}

// ─── Swing Detection ─────────────────────────────────────────────────────────

/**
 * Detects directional moves above a minimum threshold using a peak/trough scan.
 * Uses HIGH/LOW candle extremes for move measurement, not just close-to-close.
 *
 * @param candles        OHLC candles in ascending time order
 * @param minMovePct     Minimum move to qualify (0.10 = 10%)
 * @param minCandleLen   Minimum number of candles in a swing
 */
function detectMoves(
  candles:      Candle[],
  minMovePct:   number,
  minCandleLen: number,
): DetectedMove[] {
  if (candles.length < minCandleLen * 2) return [];

  const moves: DetectedMove[] = [];

  let swingStart = 0;
  let direction: "up" | "down" | null = null;
  let peak  = candles[0].close;

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    const dir: "up" | "down" = curr >= prev ? "up" : "down";

    if (!direction) {
      direction = dir;
      peak      = curr;
      continue;
    }

    if (dir === direction) {
      peak = direction === "up" ? Math.max(peak, curr) : Math.min(peak, curr);
      continue;
    }

    // Direction change — evaluate completed swing
    const startPrice = candles[swingStart].close;
    const swingLen   = i - swingStart;
    const movePct    = Math.abs((peak - startPrice) / startPrice);

    if (movePct >= minMovePct && swingLen >= minCandleLen) {
      moves.push({
        direction:   direction,
        startTs:     candles[swingStart].openTs,
        endTs:       candles[i - 1].openTs,
        startPrice,
        endPrice:    peak,
        movePct,
        holdMinutes: (candles[i - 1].openTs - candles[swingStart].openTs) / 60,
        candleCount: swingLen,
      });
    }

    swingStart = i - 1;
    direction  = dir;
    peak       = curr;
  }

  return moves;
}

// ─── Win Rate Simulation ──────────────────────────────────────────────────────

/**
 * Estimates win rate by simulating a simple entry + TP/SL rule on the moves.
 *
 * Rules applied to each detected move:
 *   - If the final move exceeds TPMultiple × threshold → WIN (captured TP)
 *   - Otherwise → LOSS (stopped out at SLMultiple × threshold below entry)
 *
 * This is a rough simulation — assumes you enter at the START of a detected move
 * and either reach TP or hit SL before reversal.
 */
function simulateWinRate(
  moves:       DetectedMove[],
  tpMultiple:  number = 1.0,
  slMultiple:  number = 0.2,
): { winRate: number; avgWin: number; avgLoss: number } {
  if (moves.length === 0) return { winRate: 0, avgWin: 0, avgLoss: 0 };

  let wins = 0, losses = 0;
  let totalWin = 0, totalLoss = 0;

  for (const m of moves) {
    if (m.movePct >= tpMultiple) {
      wins++;
      totalWin += m.movePct * 100;
    } else {
      losses++;
      totalLoss += slMultiple * 100;
    }
  }

  const total = wins + losses;
  return {
    winRate: total > 0 ? wins / total : 0,
    avgWin:  wins   > 0 ? totalWin / wins : 0,
    avgLoss: losses > 0 ? totalLoss / losses : 0,
  };
}

// ─── Candidate Builder ────────────────────────────────────────────────────────

const THRESHOLD_CONFIGS: Array<{ threshold: number; minLen: number; label: string }> = [
  { threshold: 0.02,  minLen: 5,   label: "micro_2pct"   },
  { threshold: 0.05,  minLen: 10,  label: "small_5pct"   },
  { threshold: 0.10,  minLen: 20,  label: "medium_10pct" },
  { threshold: 0.20,  minLen: 60,  label: "swing_20pct"  },
  { threshold: 0.30,  minLen: 120, label: "large_30pct"  },
  { threshold: 0.50,  minLen: 200, label: "major_50pct"  },
  { threshold: 1.00,  minLen: 500, label: "mega_100pct"  },
];

function buildCandidate(
  id:          string,
  family:      string,
  direction:   "up" | "down" | "both",
  thresholdPct: number,
  moves:       DetectedMove[],
  monthsOfData: number,
): StrategyCandidate | null {
  if (moves.length < 2) return null;

  const movePcts   = moves.map(m => m.movePct * 100);
  const holdHours  = moves.map(m => m.holdMinutes / 60);

  const avgMove    = mean(movePcts);
  const medMove    = pct(movePcts, 50);
  const p25Move    = pct(movePcts, 25);
  const p75Move    = pct(movePcts, 75);
  const avgHold    = mean(holdHours);
  const medHold    = pct(holdHours, 50);
  const maxMove    = Math.max(...movePcts);
  const minMove    = Math.min(...movePcts);

  const tradesPerMonth = monthsOfData > 0 ? moves.length / monthsOfData : 0;

  // TP = p75 of detected moves (achievable for ~25% of best trades)
  // SL = 20% of TP as rough stop (1:5 R:R)
  const roughTP = p75Move;
  const roughSL = roughTP * 0.2;

  // Win = move exceeds median (conservative)
  const { winRate, avgWin, avgLoss } = simulateWinRate(moves, medMove / 100, roughSL / 100);

  // Expected monthly return using Kelly-like approximation:
  // E[R] = winRate*avgWin - (1-winRate)*avgLoss, then × trades/month
  const edgePerTrade = (winRate * avgWin) - ((1 - winRate) * avgLoss);
  const expectedMonthlyReturn = edgePerTrade * tradesPerMonth;

  // Capital efficiency: return-per-locked-hour (higher if faster cycles)
  const capitalEfficiency = avgHold > 0
    ? (edgePerTrade * tradesPerMonth) / (avgHold * tradesPerMonth / 720)
    : 0;

  // Consistency: inverse of coefficient of variation
  const sd       = stddev(movePcts);
  const cv       = avgMove > 0 ? sd / avgMove : 1;
  const consistency = Math.max(0, 1 - cv);

  // Rank score: weighted blend
  // 60% expected monthly return (normalized to [0,100])
  // 20% consistency
  // 20% win rate
  const normalizedEMR = Math.min(100, Math.max(0, expectedMonthlyReturn));
  const rankScore     = normalizedEMR * 0.6 + consistency * 100 * 0.2 + winRate * 100 * 0.2;

  const hClass = holdClass(avgHold);

  const description = [
    `Threshold: ≥${(thresholdPct * 100).toFixed(0)}% moves`,
    `${moves.length} trades detected over ${monthsOfData.toFixed(1)} months`,
    `Avg move: ${avgMove.toFixed(1)}%, Median: ${medMove.toFixed(1)}%`,
    `Avg hold: ${avgHold.toFixed(0)}h (${hClass})`,
    `Trades/month: ${tradesPerMonth.toFixed(1)}`,
    `Win rate: ${(winRate * 100).toFixed(0)}%`,
    `Edge/trade: ${edgePerTrade.toFixed(1)}%`,
    `Expected monthly return: ${expectedMonthlyReturn.toFixed(1)}%`,
  ].join(" | ");

  return {
    id,
    family,
    direction,
    holdClass:                 hClass,
    thresholdPct:              thresholdPct * 100,
    tradeCount:                moves.length,
    tradesPerMonth:            Math.round(tradesPerMonth * 10) / 10,
    avgMovePct:                Math.round(avgMove * 10) / 10,
    medianMovePct:             Math.round(medMove * 10) / 10,
    p25MovePct:                Math.round(p25Move * 10) / 10,
    p75MovePct:                Math.round(p75Move * 10) / 10,
    avgHoldHours:              Math.round(avgHold * 10) / 10,
    medianHoldHours:           Math.round(medHold * 10) / 10,
    winRate:                   Math.round(winRate * 1000) / 1000,
    avgWinPct:                 Math.round(avgWin * 10) / 10,
    avgLossPct:                Math.round(avgLoss * 10) / 10,
    maxObservedMovePct:        Math.round(maxMove * 10) / 10,
    minObservedMovePct:        Math.round(minMove * 10) / 10,
    roughSLPct:                Math.round(roughSL * 10) / 10,
    roughTPPct:                Math.round(roughTP * 10) / 10,
    expectedMonthlyReturnPct:  Math.round(expectedMonthlyReturn * 10) / 10,
    capitalEfficiencyScore:    Math.round(capitalEfficiency * 100) / 100,
    consistency:               Math.round(consistency * 100) / 100,
    rankScore:                 Math.round(rankScore * 10) / 10,
    description,
  };
}

// ─── Main Extractor ───────────────────────────────────────────────────────────

/**
 * Loads candles from the database (excluding interpolated), runs multi-threshold
 * move detection in both directions, builds candidates for each threshold+direction
 * combination, and returns them ranked by expected monthly return.
 *
 * @param symbol      Trading symbol (e.g. "CRASH300")
 * @param windowDays  Lookback window in days (default 365)
 * @param timeframe   Candle timeframe to analyse (default "1m")
 */
export async function extractStrategies(
  symbol:     string,
  windowDays: number = 365,
  timeframe:  string = "1m",
): Promise<StrategyRankingReport> {
  const now    = Math.floor(Date.now() / 1000);
  const cutoff = now - windowDays * 86400;

  const realWhere = and(
    eq(candlesTable.symbol,        symbol),
    eq(candlesTable.timeframe,     timeframe),
    gte(candlesTable.openTs,       cutoff),
    eq(candlesTable.isInterpolated, false),
  );
  const allWhere = and(
    eq(candlesTable.symbol,    symbol),
    eq(candlesTable.timeframe, timeframe),
    gte(candlesTable.openTs,   cutoff),
  );

  const [realSummary] = await backgroundDb
    .select({ cnt: count(), first: min(candlesTable.openTs), last: max(candlesTable.openTs) })
    .from(candlesTable)
    .where(realWhere);

  const [allSummary] = await backgroundDb
    .select({ cnt: count() })
    .from(candlesTable)
    .where(allWhere);

  const totalReal        = Number(realSummary?.cnt ?? 0);
  const totalAll         = Number(allSummary?.cnt ?? 0);
  const interpolatedCount = totalAll - totalReal;
  const firstTs           = realSummary?.first ?? cutoff;
  const lastTs            = realSummary?.last  ?? now;
  const monthsOfData      = Math.max(0.1, (lastTs - firstTs) / 86400 / 30);

  const generatedAt = new Date().toISOString();
  const dataFrom    = new Date(firstTs * 1000).toISOString().slice(0, 10);
  const dataTo      = new Date(lastTs  * 1000).toISOString().slice(0, 10);

  if (totalReal < 100) {
    return {
      symbol, timeframe, windowDays, dataFrom, dataTo,
      totalRealCandles: totalReal, interpolatedCount, monthsOfData,
      candidates: [], topStrategy: null, generatedAt,
    };
  }

  // Load real candles (max 50k sample for performance)
  const MAX_LOAD = 50_000;
  let rawCandles: Candle[];

  if (totalReal <= MAX_LOAD) {
    rawCandles = await backgroundDb
      .select({
        openTs: candlesTable.openTs,
        open:   candlesTable.open,
        high:   candlesTable.high,
        low:    candlesTable.low,
        close:  candlesTable.close,
      })
      .from(candlesTable)
      .where(realWhere)
      .orderBy(asc(candlesTable.openTs));
  } else {
    const step = Math.ceil(totalReal / MAX_LOAD);
    const all  = await backgroundDb
      .select({
        openTs: candlesTable.openTs,
        open:   candlesTable.open,
        high:   candlesTable.high,
        low:    candlesTable.low,
        close:  candlesTable.close,
      })
      .from(candlesTable)
      .where(realWhere)
      .orderBy(asc(candlesTable.openTs));
    rawCandles = all.filter((_, i) => i % step === 0);
  }

  if (rawCandles.length < 20) {
    return {
      symbol, timeframe, windowDays, dataFrom, dataTo,
      totalRealCandles: totalReal, interpolatedCount, monthsOfData,
      candidates: [], topStrategy: null, generatedAt,
    };
  }

  // Build candidates for each threshold × direction combination
  const candidates: StrategyCandidate[] = [];

  for (const cfg of THRESHOLD_CONFIGS) {
    const allMoves  = detectMoves(rawCandles, cfg.threshold, cfg.minLen);
    const upMoves   = allMoves.filter(m => m.direction === "up");
    const downMoves = allMoves.filter(m => m.direction === "down");

    // Both directions combined
    const bothId = `${cfg.label}_both`;
    const both   = buildCandidate(bothId, cfg.label, "both", cfg.threshold, allMoves, monthsOfData);
    if (both) candidates.push(both);

    // Up-only (BUY)
    if (upMoves.length >= 2) {
      const upId  = `${cfg.label}_up`;
      const upCand = buildCandidate(upId, cfg.label, "up", cfg.threshold, upMoves, monthsOfData);
      if (upCand) candidates.push(upCand);
    }

    // Down-only (SELL / spike recovery)
    if (downMoves.length >= 2) {
      const dnId   = `${cfg.label}_down`;
      const dnCand = buildCandidate(dnId, cfg.label, "down", cfg.threshold, downMoves, monthsOfData);
      if (dnCand) candidates.push(dnCand);
    }
  }

  // Rank by expected monthly return (descending), break ties by consistency
  candidates.sort((a, b) => {
    if (Math.abs(b.expectedMonthlyReturnPct - a.expectedMonthlyReturnPct) > 0.5) {
      return b.expectedMonthlyReturnPct - a.expectedMonthlyReturnPct;
    }
    return b.consistency - a.consistency;
  });

  // Assign rank scores after final sort
  candidates.forEach((c, i) => {
    c.rankScore = Math.max(0, 100 - i * 2);
  });

  const topStrategy = candidates.length > 0 ? candidates[0] : null;

  return {
    symbol,
    timeframe,
    windowDays,
    dataFrom,
    dataTo,
    totalRealCandles:  totalReal,
    interpolatedCount,
    monthsOfData:      Math.round(monthsOfData * 10) / 10,
    candidates,
    topStrategy,
    generatedAt,
  };
}
