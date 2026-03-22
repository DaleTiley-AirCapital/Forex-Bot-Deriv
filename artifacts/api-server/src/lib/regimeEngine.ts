import type { FeatureVector } from "./features.js";

export type RegimeState =
  | "trend_up"
  | "trend_down"
  | "mean_reversion"
  | "compression"
  | "breakout_expansion"
  | "spike_zone"
  | "no_trade";

export type InstrumentFamily = "boom" | "crash" | "volatility" | "other_synthetic";

export type StrategyFamily =
  | "trend_continuation"
  | "mean_reversion"
  | "breakout_expansion"
  | "spike_event";

export interface RegimeClassification {
  regime: RegimeState;
  confidence: number;
  allowedFamilies: StrategyFamily[];
  instrumentFamily: InstrumentFamily;
}

export function classifyInstrument(symbol: string): InstrumentFamily {
  if (symbol.startsWith("BOOM")) return "boom";
  if (symbol.startsWith("CRASH")) return "crash";
  if (symbol.startsWith("R_")) return "volatility";
  return "other_synthetic";
}

const STRATEGY_PERMISSION_MATRIX: Record<RegimeState, StrategyFamily[]> = {
  trend_up: ["trend_continuation"],
  trend_down: ["trend_continuation"],
  mean_reversion: ["mean_reversion"],
  compression: ["breakout_expansion"],
  breakout_expansion: ["breakout_expansion"],
  spike_zone: ["spike_event"],
  no_trade: [],
};

export function classifyRegime(features: FeatureVector): RegimeClassification {
  const instrumentFamily = classifyInstrument(features.symbol);
  const isBoomCrash = instrumentFamily === "boom" || instrumentFamily === "crash";

  let regime: RegimeState;
  let confidence: number;

  const slopeAbs = Math.abs(features.emaSlope);
  const isSqueeze = features.bbWidth < 0.005;
  const isExpanding = features.bbWidthRoc > 0.15 && features.atrAccel > 0.10;
  const isOverstretched = Math.abs(features.zScore) > 2.0;
  const rsiExtreme = features.rsi14 < 28 || features.rsi14 > 72;
  const strongTrend = slopeAbs > 0.0005;
  const veryStrongTrend = slopeAbs > 0.001;
  const highVol = features.atr14 > 0.004;
  const spikeImminent = isBoomCrash && features.spikeHazardScore > 0.72;

  if (spikeImminent) {
    regime = "spike_zone";
    confidence = Math.min(0.95, 0.5 + features.spikeHazardScore * 0.5);
  } else if (isSqueeze && !isExpanding && slopeAbs < 0.0003) {
    regime = "compression";
    confidence = Math.min(0.90, 0.6 + (0.005 - features.bbWidth) * 100);
  } else if (isExpanding && (features.atrRank > 1.2 || highVol)) {
    regime = "breakout_expansion";
    confidence = Math.min(0.90, 0.5 + features.bbWidthRoc + features.atrAccel * 0.5);
  } else if (isOverstretched && rsiExtreme && !veryStrongTrend) {
    regime = "mean_reversion";
    confidence = Math.min(0.90, 0.5 + Math.abs(features.zScore) * 0.15 + (rsiExtreme ? 0.1 : 0));
  } else if (veryStrongTrend) {
    regime = features.emaSlope > 0 ? "trend_up" : "trend_down";
    confidence = Math.min(0.95, 0.5 + slopeAbs * 500);
  } else if (strongTrend && !isOverstretched) {
    regime = features.emaSlope > 0 ? "trend_up" : "trend_down";
    confidence = Math.min(0.80, 0.4 + slopeAbs * 400);
  } else {
    const conflictingSignals =
      (features.rsi14 > 40 && features.rsi14 < 60) &&
      slopeAbs < 0.0002 &&
      features.bbWidth > 0.003 && features.bbWidth < 0.012;

    if (conflictingSignals) {
      regime = "no_trade";
      confidence = 0.6;
    } else if (isOverstretched || rsiExtreme) {
      regime = "mean_reversion";
      confidence = 0.55;
    } else {
      regime = "no_trade";
      confidence = 0.5;
    }
  }

  const allowedFamilies = STRATEGY_PERMISSION_MATRIX[regime];

  return { regime, confidence, allowedFamilies, instrumentFamily };
}

export function isStrategyAllowedForRegime(family: StrategyFamily, regime: RegimeState): boolean {
  return STRATEGY_PERMISSION_MATRIX[regime].includes(family);
}

export function getCorrelatedInstruments(symbol: string): string[] {
  const family = classifyInstrument(symbol);
  const num = symbol.replace(/[A-Z_]/g, "");

  const correlated: string[] = [];

  if (family === "boom") {
    correlated.push(`CRASH${num}`);
    ["1000", "500", "300", "200"].forEach(n => {
      if (n !== num) {
        correlated.push(`BOOM${n}`);
      }
    });
  } else if (family === "crash") {
    correlated.push(`BOOM${num}`);
    ["1000", "500", "300", "200"].forEach(n => {
      if (n !== num) {
        correlated.push(`CRASH${n}`);
      }
    });
  } else if (family === "volatility") {
    if (symbol === "R_75") correlated.push("R_100");
    if (symbol === "R_100") correlated.push("R_75");
  }

  return correlated;
}
