/**
 * Strategy Engine
 * Four strategy families for Deriv Boom/Crash markets.
 * Strategies submit signal candidates — they do NOT place trades directly.
 */
import type { FeatureVector } from "./features.js";
import { scoreFeatures } from "./model.js";

export interface SignalCandidate {
  symbol: string;
  strategyName: string;
  direction: "buy" | "sell";
  score: number;
  confidence: number;
  expectedValue: number;
  regimeCompatible: boolean;
  signalType: string;
  suggestedSl: number | null;
  suggestedTp: number | null;
  reason: string;
  timestamp: number;
}

const STRATEGY_CONFIG = {
  "trend-pullback": {
    enabled: true,
    minScore: 0.58,
    minEV: 0.005,
    minRR: 1.5,
  },
  "exhaustion-rebound": {
    enabled: true,
    minScore: 0.60,
    minEV: 0.006,
    minRR: 1.8,
  },
  "volatility-breakout": {
    enabled: true,
    minScore: 0.55,
    minEV: 0.004,
    minRR: 1.5,
  },
  "spike-hazard": {
    enabled: true,
    minScore: 0.65,
    minEV: 0.008,
    minRR: 2.0,
  },
};

function sltp(
  price: number,
  direction: "buy" | "sell",
  atr: number,
  slMultiple = 1.5,
  tpMultiple = 3.0
): { sl: number; tp: number } {
  const atrPct = Math.max(atr, 0.001); // minimum 0.1%
  if (direction === "buy") {
    return {
      sl: price * (1 - slMultiple * atrPct),
      tp: price * (1 + tpMultiple * atrPct),
    };
  } else {
    return {
      sl: price * (1 + slMultiple * atrPct),
      tp: price * (1 - tpMultiple * atrPct),
    };
  }
}

/**
 * Strategy 1: Trend Pullback
 * Trade continuation after pullback in an established trend.
 */
export function trendPullback(features: FeatureVector): SignalCandidate | null {
  const cfg = STRATEGY_CONFIG["trend-pullback"];
  if (!cfg.enabled) return null;

  const isBoom = features.symbol.startsWith("BOOM");
  const inUptrend = features.emaSlope > 0.0003;
  const inDowntrend = features.emaSlope < -0.0003;
  const pulledBack = Math.abs(features.emaDist) < 0.008; // within 0.8% of EMA
  const rsiNeutral = features.rsi14 > 38 && features.rsi14 < 65;
  const noExtreme = Math.abs(features.zScore) < 2.0;
  const regimeOk = features.regimeLabel === "trending_up" || features.regimeLabel === "trending_down";

  let direction: "buy" | "sell" | null = null;
  let reason = "";

  if (inUptrend && pulledBack && rsiNeutral && noExtreme) {
    direction = "buy";
    reason = `Uptrend pullback to EMA (slope=${features.emaSlope.toFixed(5)}, RSI=${features.rsi14.toFixed(1)})`;
  } else if (inDowntrend && pulledBack && rsiNeutral && noExtreme) {
    direction = "sell";
    reason = `Downtrend pullback to EMA (slope=${features.emaSlope.toFixed(5)}, RSI=${features.rsi14.toFixed(1)})`;
  }

  if (!direction) return null;

  const { score, confidence, expectedValue } = scoreFeatures(features, "gradient-boost");
  if (score < cfg.minScore || expectedValue < cfg.minEV) return null;

  // Estimate current price from EMA + dist
  const price = 1; // relative - SL/TP as percentages
  const { sl, tp } = sltp(price, direction, features.atr14, 1.5, 3.0);

  return {
    symbol: features.symbol,
    strategyName: "trend-pullback",
    direction,
    score,
    confidence,
    expectedValue,
    regimeCompatible: regimeOk,
    signalType: "trend_continuation",
    suggestedSl: -Math.abs(sl - price),
    suggestedTp: Math.abs(tp - price),
    reason,
    timestamp: Date.now(),
  };
}

/**
 * Strategy 2: Exhaustion Rebound
 * Mean reversion after an overstretched move.
 */
export function exhaustionRebound(features: FeatureVector): SignalCandidate | null {
  const cfg = STRATEGY_CONFIG["exhaustion-rebound"];
  if (!cfg.enabled) return null;

  const oversold = features.rsi14 < 32 && features.zScore < -1.8;
  const overbought = features.rsi14 > 68 && features.zScore > 1.8;
  const multipleAdverse = Math.abs(features.consecutive) >= 3;
  const notTrending = features.regimeLabel !== "trending_up" && features.regimeLabel !== "trending_down";
  const regimeOk = features.regimeLabel === "ranging" || features.regimeLabel === "volatile";

  let direction: "buy" | "sell" | null = null;
  let reason = "";

  if (oversold && multipleAdverse) {
    direction = "buy";
    reason = `Oversold exhaustion: RSI=${features.rsi14.toFixed(1)}, z=${features.zScore.toFixed(2)}, ${Math.abs(features.consecutive)} consecutive down candles`;
  } else if (overbought && multipleAdverse) {
    direction = "sell";
    reason = `Overbought exhaustion: RSI=${features.rsi14.toFixed(1)}, z=${features.zScore.toFixed(2)}, ${Math.abs(features.consecutive)} consecutive up candles`;
  }

  if (!direction) return null;

  const { score, confidence, expectedValue } = scoreFeatures(features, "gradient-boost");
  if (score < cfg.minScore || expectedValue < cfg.minEV) return null;

  const { sl, tp } = sltp(1, direction, features.atr14, 2.0, 3.5);

  return {
    symbol: features.symbol,
    strategyName: "exhaustion-rebound",
    direction,
    score,
    confidence,
    expectedValue,
    regimeCompatible: regimeOk,
    signalType: "mean_reversion",
    suggestedSl: -Math.abs(sl - 1),
    suggestedTp: Math.abs(tp - 1),
    reason,
    timestamp: Date.now(),
  };
}

/**
 * Strategy 3: Volatility Breakout
 * Trade expansion after Bollinger Band compression.
 */
export function volatilityBreakout(features: FeatureVector): SignalCandidate | null {
  const cfg = STRATEGY_CONFIG["volatility-breakout"];
  if (!cfg.enabled) return null;

  const squeeze = features.bbWidth < 0.006;           // BB compressed
  const atrExpanding = features.atrRank > 0.8;        // ATR starting to expand
  const atUpperBand = features.bbPctB > 0.85;         // price at upper band
  const atLowerBand = features.bbPctB < 0.15;         // price at lower band
  const regimeOk = features.regimeLabel === "volatile" || features.regimeLabel === "ranging";

  let direction: "buy" | "sell" | null = null;
  let reason = "";

  if (squeeze && atrExpanding && atUpperBand) {
    direction = "buy";
    reason = `BB squeeze breakout upward: width=${features.bbWidth.toFixed(4)}, %B=${features.bbPctB.toFixed(2)}, ATR rank=${features.atrRank.toFixed(2)}`;
  } else if (squeeze && atrExpanding && atLowerBand) {
    direction = "sell";
    reason = `BB squeeze breakout downward: width=${features.bbWidth.toFixed(4)}, %B=${features.bbPctB.toFixed(2)}, ATR rank=${features.atrRank.toFixed(2)}`;
  }

  if (!direction) return null;

  const { score, confidence, expectedValue } = scoreFeatures(features, "gradient-boost");
  if (score < cfg.minScore || expectedValue < cfg.minEV) return null;

  const { sl, tp } = sltp(1, direction, features.atr14, 1.2, 2.5);

  return {
    symbol: features.symbol,
    strategyName: "volatility-breakout",
    direction,
    score,
    confidence,
    expectedValue,
    regimeCompatible: regimeOk,
    signalType: "breakout",
    suggestedSl: -Math.abs(sl - 1),
    suggestedTp: Math.abs(tp - 1),
    reason,
    timestamp: Date.now(),
  };
}

/**
 * Strategy 4: Spike Hazard Capture
 * Enter when hazard score indicates elevated spike probability.
 */
export function spikeHazard(features: FeatureVector): SignalCandidate | null {
  const cfg = STRATEGY_CONFIG["spike-hazard"];
  if (!cfg.enabled) return null;

  const hazardHigh = features.spikeHazardScore > 0.70;
  const isBoom = features.symbol.startsWith("BOOM");
  const regimeOk = true; // spike hazard is regime-agnostic

  if (!hazardHigh) return null;

  // In Boom markets spikes go up; in Crash markets spikes go down
  const direction: "buy" | "sell" = isBoom ? "buy" : "sell";
  const reason = `Spike hazard elevated: score=${features.spikeHazardScore.toFixed(2)}, ticks since last spike=${features.ticksSinceSpike}`;

  const { score, confidence, expectedValue } = scoreFeatures(features, "gradient-boost");
  // Boost score for spike hazard since it's the primary signal
  const boostedScore = Math.min(0.99, score * 0.5 + features.spikeHazardScore * 0.5);
  if (boostedScore < cfg.minScore) return null;

  const { sl, tp } = sltp(1, direction, features.atr14, 1.0, 2.5);

  return {
    symbol: features.symbol,
    strategyName: "spike-hazard",
    direction,
    score: boostedScore,
    confidence: features.spikeHazardScore,
    expectedValue: Math.max(expectedValue, 0.008),
    regimeCompatible: regimeOk,
    signalType: "spike_capture",
    suggestedSl: -Math.abs(sl - 1),
    suggestedTp: Math.abs(tp - 1),
    reason,
    timestamp: Date.now(),
  };
}

/**
 * Run all strategies for a symbol and return candidates
 */
export function runAllStrategies(features: FeatureVector): SignalCandidate[] {
  const candidates: SignalCandidate[] = [];

  const tp = trendPullback(features);
  if (tp) candidates.push(tp);

  const er = exhaustionRebound(features);
  if (er) candidates.push(er);

  const vb = volatilityBreakout(features);
  if (vb) candidates.push(vb);

  const sh = spikeHazard(features);
  if (sh) candidates.push(sh);

  return candidates;
}
