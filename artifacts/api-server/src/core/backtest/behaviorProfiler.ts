/**
 * behaviorProfiler.ts — Strategy Behavior Profile Derivation
 *
 * Derives per-symbol, per-engine behavior profiles from captured backtest events.
 * Profiles are used by the live system to:
 *   - Set rolling memory windows (how far back to evaluate signals)
 *   - Set recommended scan cadence (how often to scan per symbol)
 *   - Report expected win rates, hold times, MFE/MAE by engine/regime
 *
 * All derivation is pure — no DB access. Call after a backtest run.
 */

import { getBehaviorEvents, getAllBehaviorKeys, type BehaviorEvent } from "./behaviorCapture.js";

export interface EngineProfile {
  symbol: string;
  engineName: string;
  tradeCount: number;
  winRate: number;
  avgHoldBars: number;
  avgHoldHours: number;
  avgMfePct: number;
  avgMaePct: number;
  avgPnlPct: number;
  avgNativeScore: number;
  avgProjectedMovePct: number;
  profitFactor: number;
  byExitReason: Record<"tp_hit" | "sl_hit" | "max_duration", number>;
  bySlStage: Record<"stage_1" | "stage_2" | "stage_3", number>;
  byRegime: Record<string, { count: number; wins: number; winRate: number }>;
  dominantRegime: string;
  dominantEntryType: string;
  signalFrequencyPerDay: number;
  recommendedMemoryWindowBars: number;
  recommendedScanCadenceMins: number;
  scoreP25: number;
  scoreP50: number;
  scoreP75: number;
  sampleStartTs: number;
  sampleEndTs: number;
  sampleDays: number;
}

export interface BehaviorProfileSummary {
  symbol: string;
  engineProfiles: EngineProfile[];
  totalTrades: number;
  overallWinRate: number;
  lastUpdated: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)));
  return sorted[idx];
}

function deriveScanCadence(signalFreqPerDay: number): number {
  if (signalFreqPerDay >= 3) return 5;
  if (signalFreqPerDay >= 1) return 15;
  if (signalFreqPerDay >= 0.5) return 30;
  if (signalFreqPerDay >= 0.2) return 60;
  return 120;
}

function deriveMemoryWindow(avgHoldBars: number, signalFreqPerDay: number): number {
  const minWindow = 60;
  const holdBasedWindow = Math.ceil(avgHoldBars * 0.5);
  const freqBasedWindow = signalFreqPerDay > 0
    ? Math.ceil((1 / signalFreqPerDay) * 24 * 60 * 0.25)
    : holdBasedWindow;
  return Math.max(minWindow, Math.min(holdBasedWindow, freqBasedWindow, 1440));
}

export function deriveEngineProfile(
  symbol: string,
  engineName: string,
): EngineProfile | null {
  const events = getBehaviorEvents(symbol, engineName);
  if (events.length === 0) return null;

  const wins = events.filter(e => e.pnlPct > 0);
  const losses = events.filter(e => e.pnlPct <= 0);
  const grossProfit = wins.reduce((s, e) => s + e.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, e) => s + e.pnlPct, 0));

  const avgHoldBars = events.reduce((s, e) => s + e.holdBars, 0) / events.length;
  const avgHoldHours = avgHoldBars / 60;

  const byExitReason: Record<"tp_hit" | "sl_hit" | "max_duration", number> = {
    tp_hit: 0, sl_hit: 0, max_duration: 0,
  };
  const bySlStage: Record<"stage_1" | "stage_2" | "stage_3", number> = {
    stage_1: 0, stage_2: 0, stage_3: 0,
  };
  const byRegimeRaw: Record<string, { count: number; wins: number }> = {};
  const entryTypeCounts: Record<string, number> = {};

  for (const e of events) {
    byExitReason[e.exitReason] = (byExitReason[e.exitReason] ?? 0) + 1;
    const stageKey = `stage_${e.slStage}` as "stage_1" | "stage_2" | "stage_3";
    bySlStage[stageKey] = (bySlStage[stageKey] ?? 0) + 1;
    if (!byRegimeRaw[e.regimeAtEntry]) byRegimeRaw[e.regimeAtEntry] = { count: 0, wins: 0 };
    byRegimeRaw[e.regimeAtEntry].count++;
    if (e.pnlPct > 0) byRegimeRaw[e.regimeAtEntry].wins++;
    entryTypeCounts[e.entryType] = (entryTypeCounts[e.entryType] ?? 0) + 1;
  }

  const byRegime: Record<string, { count: number; wins: number; winRate: number }> = {};
  for (const [regime, data] of Object.entries(byRegimeRaw)) {
    byRegime[regime] = { ...data, winRate: data.count > 0 ? data.wins / data.count : 0 };
  }

  const dominantRegime = Object.entries(byRegimeRaw)
    .sort((a, b) => b[1].count - a[1].count)[0]?.[0] ?? "unknown";

  const dominantEntryType = Object.entries(entryTypeCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";

  const sortedByTs = [...events].sort((a, b) => a.entryTs - b.entryTs);
  const sampleStartTs = sortedByTs[0].entryTs;
  const sampleEndTs = sortedByTs[sortedByTs.length - 1].entryTs;
  const sampleDays = Math.max(1, (sampleEndTs - sampleStartTs) / 86400);
  const signalFrequencyPerDay = events.length / sampleDays;

  const sortedScores = events.map(e => e.nativeScore).sort((a, b) => a - b);
  const scoreP25 = percentile(sortedScores, 0.25);
  const scoreP50 = percentile(sortedScores, 0.50);
  const scoreP75 = percentile(sortedScores, 0.75);

  const recommendedMemoryWindowBars = deriveMemoryWindow(avgHoldBars, signalFrequencyPerDay);
  const recommendedScanCadenceMins = deriveScanCadence(signalFrequencyPerDay);

  return {
    symbol,
    engineName,
    tradeCount: events.length,
    winRate: events.length > 0 ? wins.length / events.length : 0,
    avgHoldBars,
    avgHoldHours,
    avgMfePct: events.reduce((s, e) => s + e.mfePct, 0) / events.length,
    avgMaePct: events.reduce((s, e) => s + e.maePct, 0) / events.length,
    avgPnlPct: events.reduce((s, e) => s + e.pnlPct, 0) / events.length,
    avgNativeScore: events.reduce((s, e) => s + e.nativeScore, 0) / events.length,
    avgProjectedMovePct: events.reduce((s, e) => s + e.projectedMovePct, 0) / events.length,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    byExitReason,
    bySlStage,
    byRegime,
    dominantRegime,
    dominantEntryType,
    signalFrequencyPerDay,
    recommendedMemoryWindowBars,
    recommendedScanCadenceMins,
    scoreP25,
    scoreP50,
    scoreP75,
    sampleStartTs,
    sampleEndTs,
    sampleDays,
  };
}

export function deriveSymbolBehaviorProfile(symbol: string): BehaviorProfileSummary | null {
  const keys: string[] = getAllBehaviorKeys();
  const engineNames = keys
    .filter(k => k.startsWith(`${symbol}|`))
    .map(k => k.split("|")[1])
    .filter((v, i, arr) => arr.indexOf(v) === i);

  if (engineNames.length === 0) return null;

  const engineProfiles: EngineProfile[] = [];
  for (const engineName of engineNames) {
    const profile = deriveEngineProfile(symbol, engineName);
    if (profile) engineProfiles.push(profile);
  }

  if (engineProfiles.length === 0) return null;

  const totalTrades = engineProfiles.reduce((s, p) => s + p.tradeCount, 0);
  const totalWins = engineProfiles.reduce(
    (s, p) => s + Math.round(p.winRate * p.tradeCount), 0
  );

  return {
    symbol,
    engineProfiles,
    totalTrades,
    overallWinRate: totalTrades > 0 ? totalWins / totalTrades : 0,
    lastUpdated: new Date().toISOString(),
  };
}
