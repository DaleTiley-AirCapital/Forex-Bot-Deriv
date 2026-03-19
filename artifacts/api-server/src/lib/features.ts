/**
 * Feature Engineering Service
 * Computes technical indicators and regime features from candle/tick data
 */
import { db, candlesTable, spikeEventsTable, featuresTable } from "@workspace/db";
import { desc, eq, and, gte } from "drizzle-orm";

export interface FeatureVector {
  symbol: string;
  ts: number;
  // Trend
  emaSlope: number;          // EMA slope (positive = uptrend)
  emaDist: number;           // Price distance from EMA as % 
  priceVsEma20: number;      // price / ema20 - 1
  // Momentum
  rsi14: number;             // RSI 0-100
  rsiZone: number;           // -1 oversold, 0 neutral, 1 overbought
  // Volatility
  atr14: number;             // ATR normalised as % of price
  bbWidth: number;           // Bollinger band width / mid
  bbPctB: number;            // %B position within bands
  atrRank: number;           // ATR vs rolling 50-period ATR (0-1)
  // Price structure
  candleBody: number;        // |close-open| / (high-low)
  upperWickRatio: number;    // upper wick / body
  lowerWickRatio: number;    // lower wick / body
  consecutive: number;       // consecutive up(+) or down(-) candles
  // Statistical
  zScore: number;            // (close - mean20) / std20
  rollingSkew: number;       // skew of last 20 closes
  // Spike / regime
  ticksSinceSpike: number;   // ticks since last spike (normalised)
  runLengthSinceSpike: number; // number of candles since last spike
  spikeHazardScore: number;  // probability of spike based on run length
  // Regime
  regimeLabel: string;       // trending_up | trending_down | ranging | volatile
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values[0];
  for (const v of values) {
    const cur = v * k + prev * (1 - k);
    result.push(cur);
    prev = cur;
  }
  return result;
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const window = changes.slice(-period);
  const gains = window.filter(c => c > 0);
  const losses = window.filter(c => c < 0).map(Math.abs);
  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (highs.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  const window = trs.slice(-period);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
}

function skewness(arr: number[]): number {
  const m = mean(arr);
  const s = stdDev(arr);
  if (s === 0) return 0;
  return arr.reduce((a, b) => a + ((b - m) / s) ** 3, 0) / arr.length;
}

function detectRegime(closes: number[], atrVal: number, ema20: number[]): string {
  if (closes.length < 20) return "ranging";
  const recentEma = ema20.slice(-20);
  const slopePoints = recentEma.slice(-5);
  const slope = (slopePoints[slopePoints.length - 1] - slopePoints[0]) / slopePoints[0];
  const currentPrice = closes[closes.length - 1];
  const vol = atrVal / currentPrice;
  if (vol > 0.003) return "volatile";
  if (slope > 0.001) return "trending_up";
  if (slope < -0.001) return "trending_down";
  return "ranging";
}

export async function computeFeatures(symbol: string, lookback = 100): Promise<FeatureVector | null> {
  // Get recent candles
  const candles = await db.select().from(candlesTable)
    .where(and(eq(candlesTable.symbol, symbol), eq(candlesTable.timeframe, "1m")))
    .orderBy(desc(candlesTable.openTs))
    .limit(lookback);

  if (candles.length < 30) return null;

  // Reverse to chronological order
  candles.reverse();

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const opens = candles.map(c => c.open);

  const last = candles[candles.length - 1];
  const price = last.close;

  // EMA
  const ema20Arr = ema(closes, 20);
  const ema50Arr = ema(closes, Math.min(50, closes.length));
  const ema20 = ema20Arr[ema20Arr.length - 1];
  const ema20Prev = ema20Arr[ema20Arr.length - 2] || ema20;
  const emaSlope = (ema20 - ema20Prev) / ema20;
  const emaDist = (price - ema20) / ema20;

  // RSI
  const rsi14 = rsi(closes, 14);
  const rsiZone = rsi14 < 30 ? -1 : rsi14 > 70 ? 1 : 0;

  // ATR
  const atr14 = atr(highs, lows, closes, 14) / price;
  const atr50 = atr(highs, lows, closes, Math.min(50, closes.length)) / price;
  const atrRank = atr50 > 0 ? Math.min(atr14 / atr50, 2) : 1;

  // Bollinger Bands (20, 2)
  const bbPeriod = 20;
  const bbCloses = closes.slice(-bbPeriod);
  const bbMean = mean(bbCloses);
  const bbStd = stdDev(bbCloses);
  const bbUpper = bbMean + 2 * bbStd;
  const bbLower = bbMean - 2 * bbStd;
  const bbWidth = bbStd > 0 ? (bbUpper - bbLower) / bbMean : 0;
  const bbPctB = bbStd > 0 ? (price - bbLower) / (bbUpper - bbLower) : 0.5;

  // Candle structure
  const range = last.high - last.low;
  const body = Math.abs(last.close - last.open);
  const candleBody = range > 0 ? body / range : 0;
  const upperWick = range > 0 ? (last.high - Math.max(last.open, last.close)) / Math.max(body, 0.0001) : 0;
  const lowerWick = range > 0 ? (Math.min(last.open, last.close) - last.low) / Math.max(body, 0.0001) : 0;

  // Consecutive candles
  let consecutive = 0;
  for (let i = candles.length - 1; i >= 1; i--) {
    const up = candles[i].close > candles[i].open;
    const prevUp = candles[i - 1].close > candles[i - 1].open;
    if (i === candles.length - 1) {
      consecutive = up ? 1 : -1;
    } else if ((up && consecutive > 0) || (!up && consecutive < 0)) {
      consecutive += up ? 1 : -1;
    } else {
      break;
    }
  }

  // Z-score
  const z20Closes = closes.slice(-20);
  const z20Mean = mean(z20Closes);
  const z20Std = stdDev(z20Closes);
  const zScore = z20Std > 0 ? (price - z20Mean) / z20Std : 0;
  const rollingSkew = skewness(z20Closes);

  // Spike features
  const recentSpikes = await db.select().from(spikeEventsTable)
    .where(eq(spikeEventsTable.symbol, symbol))
    .orderBy(desc(spikeEventsTable.eventTs))
    .limit(10);

  let ticksSinceSpike = 9999;
  let runLengthSinceSpike = 500;
  let spikeHazardScore = 0;

  if (recentSpikes.length > 0) {
    const lastSpike = recentSpikes[0];
    ticksSinceSpike = lastSpike.ticksSincePreviousSpike ?? 999;
    runLengthSinceSpike = candles.length; // approximation

    // Compute mean interval between spikes
    if (recentSpikes.length >= 3) {
      const intervals = recentSpikes
        .slice(0, 8)
        .map(s => s.ticksSincePreviousSpike ?? 0)
        .filter(i => i > 0);
      const meanInterval = mean(intervals);
      const stdInterval = stdDev(intervals);
      // Hazard score: how many std devs past the mean interval have we gone?
      if (stdInterval > 0) {
        const z = (ticksSinceSpike - meanInterval) / stdInterval;
        // Sigmoid to compress into 0-1
        spikeHazardScore = 1 / (1 + Math.exp(-z));
      } else {
        spikeHazardScore = ticksSinceSpike > meanInterval ? 0.7 : 0.3;
      }
    }
  }

  // Regime
  const regimeLabel = detectRegime(closes, atr14, ema20Arr);

  return {
    symbol,
    ts: last.closeTs,
    emaSlope,
    emaDist,
    priceVsEma20: emaDist,
    rsi14,
    rsiZone,
    atr14,
    bbWidth,
    bbPctB,
    atrRank,
    candleBody,
    upperWickRatio: upperWick,
    lowerWickRatio: lowerWick,
    consecutive,
    zScore,
    rollingSkew,
    ticksSinceSpike,
    runLengthSinceSpike,
    spikeHazardScore,
    regimeLabel,
  };
}

export async function buildAndStoreFeaturesForSymbol(symbol: string): Promise<number> {
  const candles = await db.select().from(candlesTable)
    .where(and(eq(candlesTable.symbol, symbol), eq(candlesTable.timeframe, "1m")))
    .orderBy(desc(candlesTable.openTs))
    .limit(500);

  if (candles.length < 30) return 0;
  candles.reverse();

  let stored = 0;
  // Compute features every 10 candles (sliding window)
  for (let i = 50; i < candles.length; i += 10) {
    const window = candles.slice(0, i + 1);
    const closes = window.map(c => c.close);
    const highs = window.map(c => c.high);
    const lows = window.map(c => c.low);
    const last = window[window.length - 1];
    const price = last.close;

    const ema20Arr = ema(closes, 20);
    const ema20 = ema20Arr[ema20Arr.length - 1];
    const ema20Prev = ema20Arr[ema20Arr.length - 2] || ema20;
    const emaSlope = (ema20 - ema20Prev) / ema20;
    const rsi14 = rsi(closes, 14);
    const atr14v = atr(highs, lows, closes, 14) / price;
    const bbCloses = closes.slice(-20);
    const bbMean = mean(bbCloses);
    const bbStd = stdDev(bbCloses);
    const bbWidth = bbStd > 0 ? (4 * bbStd) / bbMean : 0;
    const zScore = bbStd > 0 ? (price - bbMean) / bbStd : 0;
    const regimeLabel = detectRegime(closes, atr14v, ema20Arr);

    // Target label: did price go up in next 10 candles?
    const futureClose = i + 10 < candles.length ? candles[i + 10].close : null;
    const targetLabel = futureClose ? (futureClose > price ? "1" : "0") : null;

    try {
      await db.insert(featuresTable).values({
        symbol,
        ts: last.closeTs,
        featureJson: { emaSlope, rsi14, atr14: atr14v, bbWidth, zScore },
        regimeLabel,
        targetLabel,
      });
      stored++;
    } catch {
      // skip duplicates
    }
  }
  return stored;
}
