import type { FeatureVector } from "./features.js";
import type { SignalCandidate } from "./strategies.js";

export interface ScoringDimensions {
  regimeFit: number;
  setupQuality: number;
  trendAlignment: number;
  volatilityCondition: number;
  rewardRisk: number;
  probabilityOfSuccess: number;
}

export interface ScoringWeights {
  regimeFit: number;
  setupQuality: number;
  trendAlignment: number;
  volatilityCondition: number;
  rewardRisk: number;
  probabilityOfSuccess: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  regimeFit: 1 / 6,
  setupQuality: 1 / 6,
  trendAlignment: 1 / 6,
  volatilityCondition: 1 / 6,
  rewardRisk: 1 / 6,
  probabilityOfSuccess: 1 / 6,
};

const STRATEGY_IDEAL_REGIMES: Record<string, string[]> = {
  "trend-pullback": ["trending_up", "trending_down"],
  "exhaustion-rebound": ["ranging", "volatile"],
  "volatility-breakout": ["volatile", "ranging"],
  "spike-hazard": ["trending_up", "trending_down", "ranging", "volatile"],
  "volatility-expansion": ["volatile", "ranging"],
  "liquidity-sweep": ["ranging", "volatile"],
  "macro-bias": ["trending_up", "trending_down", "ranging", "volatile"],
};

const STRATEGY_IDEAL_VOLATILITY: Record<string, { min: number; max: number }> = {
  "trend-pullback": { min: 0.001, max: 0.004 },
  "exhaustion-rebound": { min: 0.002, max: 0.006 },
  "volatility-breakout": { min: 0.003, max: 0.008 },
  "spike-hazard": { min: 0.001, max: 0.010 },
  "volatility-expansion": { min: 0.003, max: 0.010 },
  "liquidity-sweep": { min: 0.001, max: 0.005 },
  "macro-bias": { min: 0.001, max: 0.006 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeRegimeFit(features: FeatureVector, strategyName: string): number {
  const idealRegimes = STRATEGY_IDEAL_REGIMES[strategyName] ?? [];
  if (idealRegimes.length === 0) return 50;

  const isIdeal = idealRegimes.includes(features.regimeLabel);
  if (!isIdeal) return 15;

  let score = 70;

  if (features.regimeLabel === "trending_up" || features.regimeLabel === "trending_down") {
    const trendStrength = Math.abs(features.emaSlope) / 0.002;
    score += clamp(trendStrength * 30, 0, 30);
  } else if (features.regimeLabel === "ranging") {
    const rangeConfidence = 1 - Math.min(Math.abs(features.emaSlope) / 0.001, 1);
    score += clamp(rangeConfidence * 30, 0, 30);
  } else if (features.regimeLabel === "volatile") {
    const volStrength = Math.min(features.atrRank / 1.5, 1);
    score += clamp(volStrength * 30, 0, 30);
  }

  return clamp(Math.round(score), 0, 100);
}

function computeSetupQuality(candidate: SignalCandidate, modelScore: number): number {
  let score = 0;

  const scoreMargin = (modelScore - 0.5) / 0.5;
  score += clamp(scoreMargin * 40, 0, 40);

  const evStrength = Math.min(candidate.expectedValue / 0.015, 1);
  score += clamp(evStrength * 30, 0, 30);

  if (candidate.regimeCompatible) score += 15;

  const confidence = candidate.confidence;
  score += clamp(confidence * 15, 0, 15);

  return clamp(Math.round(score), 0, 100);
}

function computeTrendAlignment(features: FeatureVector, direction: "buy" | "sell"): number {
  let score = 50;

  const slopeAligned = (direction === "buy" && features.emaSlope > 0) ||
    (direction === "sell" && features.emaSlope < 0);

  if (slopeAligned) {
    const slopeStrength = Math.min(Math.abs(features.emaSlope) / 0.001, 1);
    score += clamp(slopeStrength * 25, 0, 25);
  } else {
    const slopeStrength = Math.min(Math.abs(features.emaSlope) / 0.001, 1);
    score -= clamp(slopeStrength * 25, 0, 25);
  }

  const priceAboveEma = features.emaDist > 0;
  if ((direction === "buy" && priceAboveEma) || (direction === "sell" && !priceAboveEma)) {
    score += 10;
  } else {
    score -= 5;
  }

  const consecutiveAligned = (direction === "buy" && features.consecutive > 0) ||
    (direction === "sell" && features.consecutive < 0);
  if (consecutiveAligned) {
    const consStrength = Math.min(Math.abs(features.consecutive) / 5, 1);
    score += clamp(consStrength * 15, 0, 15);
  }

  return clamp(Math.round(score), 0, 100);
}

function computeVolatilityCondition(features: FeatureVector, strategyName: string): number {
  const ideal = STRATEGY_IDEAL_VOLATILITY[strategyName] ?? { min: 0.001, max: 0.006 };
  const midpoint = (ideal.min + ideal.max) / 2;
  const halfRange = (ideal.max - ideal.min) / 2;

  const atr = features.atr14;
  let score: number;

  if (atr >= ideal.min && atr <= ideal.max) {
    const distFromMid = Math.abs(atr - midpoint) / halfRange;
    score = 100 - distFromMid * 25;
  } else if (atr < ideal.min) {
    const deficit = (ideal.min - atr) / ideal.min;
    score = Math.max(10, 60 - deficit * 100);
  } else {
    const excess = (atr - ideal.max) / ideal.max;
    score = Math.max(10, 60 - excess * 80);
  }

  const bbNormal = features.bbWidth >= 0.003 && features.bbWidth <= 0.015;
  if (bbNormal) score += 10;

  const atrRankNormal = features.atrRank >= 0.5 && features.atrRank <= 1.5;
  if (atrRankNormal) score += 5;

  return clamp(Math.round(score), 0, 100);
}

function computeRewardRisk(candidate: SignalCandidate): number {
  const tp = Math.abs(candidate.suggestedTp ?? 0);
  const sl = Math.abs(candidate.suggestedSl ?? 0);

  if (sl === 0 || tp === 0) return 30;

  const rr = tp / sl;

  if (rr >= 3.0) return 100;
  if (rr >= 2.5) return 90;
  if (rr >= 2.0) return 80;
  if (rr >= 1.8) return 70;
  if (rr >= 1.5) return 60;
  if (rr >= 1.2) return 45;
  if (rr >= 1.0) return 30;
  return 15;
}

function computeProbabilityOfSuccess(modelScore: number): number {
  return clamp(Math.round(modelScore * 100), 0, 100);
}

export function computeScoringDimensions(
  features: FeatureVector,
  candidate: SignalCandidate,
  modelScore: number
): ScoringDimensions {
  return {
    regimeFit: computeRegimeFit(features, candidate.strategyName),
    setupQuality: computeSetupQuality(candidate, modelScore),
    trendAlignment: computeTrendAlignment(features, candidate.direction),
    volatilityCondition: computeVolatilityCondition(features, candidate.strategyName),
    rewardRisk: computeRewardRisk(candidate),
    probabilityOfSuccess: computeProbabilityOfSuccess(modelScore),
  };
}

export function computeCompositeScore(
  dimensions: ScoringDimensions,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS
): number {
  const totalWeight = weights.regimeFit + weights.setupQuality + weights.trendAlignment +
    weights.volatilityCondition + weights.rewardRisk + weights.probabilityOfSuccess;

  if (totalWeight === 0) return 0;

  const weighted =
    dimensions.regimeFit * weights.regimeFit +
    dimensions.setupQuality * weights.setupQuality +
    dimensions.trendAlignment * weights.trendAlignment +
    dimensions.volatilityCondition * weights.volatilityCondition +
    dimensions.rewardRisk * weights.rewardRisk +
    dimensions.probabilityOfSuccess * weights.probabilityOfSuccess;

  return clamp(Math.round(weighted / totalWeight), 0, 100);
}
