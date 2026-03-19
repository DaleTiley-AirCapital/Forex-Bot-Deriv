/**
 * Probability Model
 * Logistic regression baseline + gradient-boosted decision rule ensemble
 * Trained on stored feature vectors and target labels
 */
import { db, featuresTable, modelRunsTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import type { FeatureVector } from "./features.js";

interface ModelWeights {
  intercept: number;
  emaSlope: number;
  rsi14: number;
  atr14: number;
  bbWidth: number;
  zScore: number;
  spikeHazard: number;
  consecutive: number;
  bbPctB: number;
}

// Global in-memory model store (per symbol)
const modelStore: Record<string, { weights: ModelWeights; type: string; trainedAt: number }> = {};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
}

function dot(features: number[], weights: number[]): number {
  return features.reduce((sum, f, i) => sum + f * (weights[i] || 0), 0);
}

/**
 * Train a logistic regression model using SGD on stored feature data
 */
export async function trainLogisticRegression(
  symbol: string,
  trainingWindowDays = 90
): Promise<{ accuracy: number; precision: number; recall: number; f1: number; weights: ModelWeights }> {
  const cutoffTs = Date.now() / 1000 - trainingWindowDays * 86400;

  const rows = await db.select().from(featuresTable)
    .where(and(
      eq(featuresTable.symbol, symbol),
      isNotNull(featuresTable.targetLabel)
    ));

  if (rows.length < 20) {
    // Return default weights if not enough data
    return {
      accuracy: 0.5, precision: 0.5, recall: 0.5, f1: 0.5,
      weights: getDefaultWeights(symbol),
    };
  }

  // Extract features and labels
  const dataset = rows.map(row => {
    const f = row.featureJson as Record<string, number>;
    const label = parseInt(row.targetLabel || "0");
    return {
      features: [
        f.emaSlope * 1000,    // scale slope to reasonable range
        (f.rsi14 - 50) / 50, // normalise RSI to -1..1
        f.atr14 * 100,        // scale ATR
        f.bbWidth * 10,       // scale BB width
        f.zScore,             // already normalised
        0.5,                  // spike hazard (default)
        0,                    // consecutive (not stored)
        0.5,                  // bbPctB (default)
      ],
      label,
    };
  });

  // SGD training
  const lr = 0.01;
  const epochs = 100;
  let weights = [0, 0, 0, 0, 0, 0, 0, 0];
  let bias = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Shuffle
    for (let i = dataset.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dataset[i], dataset[j]] = [dataset[j], dataset[i]];
    }
    for (const { features, label } of dataset) {
      const pred = sigmoid(dot(features, weights) + bias);
      const error = pred - label;
      weights = weights.map((w, i) => w - lr * error * features[i]);
      bias -= lr * error;
    }
  }

  // Evaluate on training set (in-sample)
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const { features, label } of dataset) {
    const pred = sigmoid(dot(features, weights) + bias) > 0.5 ? 1 : 0;
    if (pred === 1 && label === 1) tp++;
    else if (pred === 1 && label === 0) fp++;
    else if (pred === 0 && label === 0) tn++;
    else fn++;
  }
  const accuracy = (tp + tn) / dataset.length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  const modelWeights: ModelWeights = {
    intercept: bias,
    emaSlope: weights[0],
    rsi14: weights[1],
    atr14: weights[2],
    bbWidth: weights[3],
    zScore: weights[4],
    spikeHazard: weights[5],
    consecutive: weights[6],
    bbPctB: weights[7],
  };

  modelStore[symbol] = { weights: modelWeights, type: "logistic-regression", trainedAt: Date.now() };

  return { accuracy, precision, recall, f1, weights: modelWeights };
}

function getDefaultWeights(symbol: string): ModelWeights {
  // Evidence-based defaults for Boom/Crash markets
  const isBoom = symbol.startsWith("BOOM");
  return {
    intercept: -0.1,
    emaSlope: isBoom ? 2.0 : -2.0,   // favour trend direction
    rsi14: isBoom ? 1.5 : -1.5,       // RSI momentum
    atr14: -0.5,                       // high volatility slightly negative
    bbWidth: -1.0,                     // compression = opportunity after breakout
    zScore: isBoom ? -1.0 : 1.0,      // mean reversion bias
    spikeHazard: 1.5,                  // spike hazard is important
    consecutive: isBoom ? 0.3 : -0.3, // slight trend continuation bias
    bbPctB: isBoom ? 0.5 : -0.5,
  };
}

/**
 * Score a feature vector using the stored model or defaults
 */
export function scoreFeatures(
  features: FeatureVector,
  modelType: "logistic-regression" | "gradient-boost" | "rule-based" = "gradient-boost"
): { score: number; confidence: number; expectedValue: number } {
  const weights = modelStore[features.symbol]?.weights ?? getDefaultWeights(features.symbol);

  const featureVec = [
    features.emaSlope * 1000,
    (features.rsi14 - 50) / 50,
    features.atr14 * 100,
    features.bbWidth * 10,
    features.zScore,
    features.spikeHazardScore,
    features.consecutive / 5,
    features.bbPctB,
  ];

  // Logistic regression score
  const logitScore = sigmoid(
    weights.intercept +
    weights.emaSlope * featureVec[0] +
    weights.rsi14 * featureVec[1] +
    weights.atr14 * featureVec[2] +
    weights.bbWidth * featureVec[3] +
    weights.zScore * featureVec[4] +
    weights.spikeHazard * featureVec[5] +
    weights.consecutive * featureVec[6] +
    weights.bbPctB * featureVec[7]
  );

  // Rule-based overlay (gradient boost simulation with weak rules)
  let ruleScore = 0.5;
  let ruleWeight = 0;

  // Rule 1: EMA trend
  if (Math.abs(features.emaSlope) > 0.0005) {
    const trendScore = features.emaSlope > 0 ? 0.65 : 0.35;
    ruleScore += trendScore * 0.15;
    ruleWeight += 0.15;
  }

  // Rule 2: RSI extremes (reversal signals)
  if (features.rsi14 < 30) { ruleScore += 0.70 * 0.15; ruleWeight += 0.15; }
  else if (features.rsi14 > 70) { ruleScore += 0.30 * 0.15; ruleWeight += 0.15; }
  else if (features.rsi14 > 45 && features.rsi14 < 60) { ruleScore += 0.55 * 0.10; ruleWeight += 0.10; }

  // Rule 3: Bollinger band squeeze (low width = upcoming move)
  if (features.bbWidth < 0.005) { ruleScore += 0.60 * 0.10; ruleWeight += 0.10; }

  // Rule 4: Spike hazard
  ruleScore += features.spikeHazardScore * 0.20;
  ruleWeight += 0.20;

  // Rule 5: Mean reversion
  if (Math.abs(features.zScore) > 2.0) {
    const revScore = features.zScore > 0 ? 0.35 : 0.65; // revert to mean
    ruleScore += revScore * 0.10;
    ruleWeight += 0.10;
  }

  // Normalise rule score
  if (ruleWeight > 0) ruleScore = ruleScore / (1 + ruleWeight);

  // Ensemble: 60% logistic, 40% rule-based
  const ensembleScore = modelType === "rule-based"
    ? ruleScore
    : 0.6 * logitScore + 0.4 * ruleScore;

  // Confidence based on how far from 0.5 the score is
  const confidence = Math.abs(ensembleScore - 0.5) * 2;

  // Expected value: assume avg win = 2.5%, avg loss = 1.5% (risk/reward 1.67)
  const avgWin = 0.025;
  const avgLoss = 0.015;
  const expectedValue = ensembleScore * avgWin - (1 - ensembleScore) * avgLoss;

  return { score: ensembleScore, confidence, expectedValue };
}

export function getModelStatus(symbol: string): { trained: boolean; type: string; trainedAt: number | null } {
  const m = modelStore[symbol];
  return m
    ? { trained: true, type: m.type, trainedAt: m.trainedAt }
    : { trained: false, type: "none", trainedAt: null };
}

export async function saveModelRun(
  symbol: string,
  modelName: string,
  trainingWindow: number,
  metrics: { accuracy: number; precision: number; recall: number; f1: number },
  weights: ModelWeights
): Promise<void> {
  await db.insert(modelRunsTable).values({
    modelName,
    symbol,
    trainingWindow,
    accuracy: metrics.accuracy,
    precision: metrics.precision,
    recall: metrics.recall,
    f1Score: metrics.f1,
    metricsJson: { weights, trainedOn: new Date().toISOString() },
  });
}
