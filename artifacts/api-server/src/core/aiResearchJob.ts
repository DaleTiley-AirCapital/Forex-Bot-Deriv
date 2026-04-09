/**
 * AI Research Job Foundation — V3 Backend
 *
 * Provides structured AI analysis of stored market data per symbol.
 * This is NOT a live trade gate — it is a backend research capability.
 *
 * Default window: rolling 1 year of stored data (or all available if less).
 * Output is a structured AiResearchReport suitable for:
 * - storage in DB
 * - consumption by future UI research views
 * - consumption by external AI tools (ChatGPT upload, etc.)
 *
 * The job is async-capable: runs on backgroundDb to avoid blocking main pool.
 * Does NOT modify live engine logic, strategies, or trade decisions.
 */
import { backgroundDb } from "@workspace/db";
import { candlesTable } from "@workspace/db";
import { eq, and, gte, asc, desc, min, max, count } from "drizzle-orm";
import { getOpenAIClient } from "../infrastructure/openai.js";

const DEFAULT_WINDOW_DAYS = 365;
const MAX_CANDLES_FOR_ANALYSIS = 10_000;

export interface PriceSwing {
  direction: "up" | "down";
  startTs: number;
  endTs: number;
  startPrice: number;
  endPrice: number;
  movePct: number;
  holdingMinutes: number;
}

export interface AiResearchReport {
  symbol: string;
  analysisWindowDays: number;
  dataFrom: string;
  dataTo: string;
  totalCandles1m: number;
  swingStats: {
    count: number;
    avgMovePct: number;
    medianMovePct: number;
    avgHoldingHours: number;
    upMoves: number;
    downMoves: number;
    swingsPerMonth: number;
  };
  aiSummary: string;
  aiMoveFrequency: string;
  aiMoveSize: string;
  aiHoldDuration: string;
  aiUsefulTimeframes: string;
  aiRepeatableSetups: string;
  aiFiringFrequency: string;
  aiBehaviorDrift: string;
  aiPromisingAreas: string;
  aiDegradingAreas: string;
  aiRawText: string;
  generatedAt: string;
  windowDays: number;
}

export interface ResearchJobStatus {
  running: boolean;
  lastRun: Record<string, string>;
  lastResult: Record<string, AiResearchReport | null>;
}

const jobStatus: ResearchJobStatus = {
  running: false,
  lastRun: {},
  lastResult: {},
};

export function getResearchJobStatus(): ResearchJobStatus {
  return jobStatus;
}

/**
 * Extracts price swings from 1m candle data using a simple swing detection.
 * A swing is defined as a sustained directional move > 2%.
 */
function extractSwings(candles: { openTs: number; open: number; close: number }[]): PriceSwing[] {
  if (candles.length < 10) return [];

  const swings: PriceSwing[] = [];
  const MIN_SWING_PCT = 0.02;
  const MIN_SWING_CANDLES = 5;

  let swingStart = 0;
  let swingDirection: "up" | "down" | null = null;
  let peakPrice = candles[0].close;

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    const movePct = (curr - candles[swingStart].close) / candles[swingStart].close;

    const dir: "up" | "down" = curr > prev ? "up" : "down";

    if (!swingDirection) {
      swingDirection = dir;
      peakPrice = curr;
      continue;
    }

    if (dir === swingDirection) {
      if (swingDirection === "up") peakPrice = Math.max(peakPrice, curr);
      else peakPrice = Math.min(peakPrice, curr);
      continue;
    }

    // Direction reversed — check if previous swing was significant
    const swingPct = Math.abs((peakPrice - candles[swingStart].close) / candles[swingStart].close);
    const swingLen = i - swingStart;

    if (swingPct >= MIN_SWING_PCT && swingLen >= MIN_SWING_CANDLES) {
      swings.push({
        direction: swingDirection,
        startTs:   candles[swingStart].openTs,
        endTs:     candles[i - 1].openTs,
        startPrice: candles[swingStart].close,
        endPrice:  peakPrice,
        movePct:   swingPct,
        holdingMinutes: (candles[i - 1].openTs - candles[swingStart].openTs) / 60,
      });
    }

    // Start new swing
    swingStart = i - 1;
    swingDirection = dir;
    peakPrice = curr;
  }

  return swings;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Runs AI research analysis on stored candle data for a symbol.
 *
 * @param symbol       Trading symbol (e.g. "CRASH300")
 * @param windowDays   Analysis window in days (default: 365)
 * @returns            Structured research report
 */
export async function analyzeSymbol(
  symbol: string,
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<AiResearchReport> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - windowDays * 86400;

  // Get data availability
  const [summary] = await backgroundDb
    .select({ cnt: count(), first: min(candlesTable.openTs), last: max(candlesTable.openTs) })
    .from(candlesTable)
    .where(and(eq(candlesTable.symbol, symbol), eq(candlesTable.timeframe, "1m"), gte(candlesTable.openTs, cutoff)));

  const totalCandles = Number(summary?.cnt ?? 0);
  const firstTs = summary?.first ?? cutoff;
  const lastTs  = summary?.last  ?? now;

  if (totalCandles < 100) {
    throw new Error(`[AIResearch] Insufficient data for ${symbol}: only ${totalCandles} 1m candles in window`);
  }

  const actualWindowDays = Math.ceil((lastTs - firstTs) / 86400);

  // Sample candles for swing analysis (evenly spaced if too many)
  let candles: { openTs: number; open: number; close: number }[];

  if (totalCandles <= MAX_CANDLES_FOR_ANALYSIS) {
    candles = await backgroundDb
      .select({ openTs: candlesTable.openTs, open: candlesTable.open, close: candlesTable.close })
      .from(candlesTable)
      .where(and(eq(candlesTable.symbol, symbol), eq(candlesTable.timeframe, "1m"), gte(candlesTable.openTs, cutoff)))
      .orderBy(asc(candlesTable.openTs));
  } else {
    // Sample every Nth candle to stay under limit
    const step = Math.ceil(totalCandles / MAX_CANDLES_FOR_ANALYSIS);
    const all = await backgroundDb
      .select({ openTs: candlesTable.openTs, open: candlesTable.open, close: candlesTable.close })
      .from(candlesTable)
      .where(and(eq(candlesTable.symbol, symbol), eq(candlesTable.timeframe, "1m"), gte(candlesTable.openTs, cutoff)))
      .orderBy(asc(candlesTable.openTs));
    candles = all.filter((_, i) => i % step === 0);
  }

  const swings = extractSwings(candles);
  const upSwings   = swings.filter(s => s.direction === "up");
  const downSwings = swings.filter(s => s.direction === "down");

  const allMovePcts = swings.map(s => s.movePct * 100);
  const allHoldHours = swings.map(s => s.holdingMinutes / 60);
  const monthsInWindow = actualWindowDays / 30;
  const swingsPerMonth = monthsInWindow > 0 ? swings.length / monthsInWindow : 0;

  const swingStats = {
    count:           swings.length,
    avgMovePct:      allMovePcts.length ? allMovePcts.reduce((a, b) => a + b, 0) / allMovePcts.length : 0,
    medianMovePct:   median(allMovePcts),
    avgHoldingHours: allHoldHours.length ? allHoldHours.reduce((a, b) => a + b, 0) / allHoldHours.length : 0,
    upMoves:   upSwings.length,
    downMoves: downSwings.length,
    swingsPerMonth: Math.round(swingsPerMonth * 10) / 10,
  };

  // Recent vs older behavior
  const midpoint = firstTs + (lastTs - firstTs) / 2;
  const recentSwings = swings.filter(s => s.startTs >= midpoint);
  const olderSwings  = swings.filter(s => s.startTs < midpoint);
  const recentAvgMove = recentSwings.length ? recentSwings.reduce((s, x) => s + x.movePct, 0) / recentSwings.length : 0;
  const olderAvgMove  = olderSwings.length  ? olderSwings.reduce( (s, x) => s + x.movePct, 0) / olderSwings.length  : 0;

  // Prepare the AI prompt
  const isBoomCrash = symbol.startsWith("BOOM") || symbol.startsWith("CRASH");
  const instrumentType = isBoomCrash ? "Boom/Crash synthetic index (spike-driven, mean-reverting)" : "Volatility synthetic index (random-walk, trend-following)";

  const prompt = `You are a quantitative analyst reviewing stored historical market data for a trading research report.

INSTRUMENT: ${symbol} — ${instrumentType}
ANALYSIS WINDOW: ${actualWindowDays} days (${new Date(firstTs * 1000).toISOString().slice(0, 10)} → ${new Date(lastTs * 1000).toISOString().slice(0, 10)})
TOTAL 1-MINUTE CANDLES AVAILABLE: ${totalCandles.toLocaleString()}

SWING ANALYSIS (≥2% moves, ≥5 candles):
- Total swings detected: ${swings.length}
- Up moves: ${upSwings.length}, Down moves: ${downSwings.length}
- Average move size: ${swingStats.avgMovePct.toFixed(1)}%
- Median move size: ${swingStats.medianMovePct.toFixed(1)}%
- Average holding time: ${swingStats.avgHoldingHours.toFixed(1)} hours
- Swings per month: ${swingStats.swingsPerMonth}

DRIFT ANALYSIS:
- Older half (${new Date(firstTs * 1000).toISOString().slice(0, 10)}–${new Date(midpoint * 1000).toISOString().slice(0, 10)}): avg move = ${(olderAvgMove * 100).toFixed(1)}%, count = ${olderSwings.length}
- Recent half (${new Date(midpoint * 1000).toISOString().slice(0, 10)}–${new Date(lastTs * 1000).toISOString().slice(0, 10)}): avg move = ${(recentAvgMove * 100).toFixed(1)}%, count = ${recentSwings.length}

SYSTEM CONTEXT:
- This system targets 50–200%+ return moves (large capital, long hold)
- TP = 50% of 90-day range for Boom/Crash; 70% of major swing range for Volatility
- Expected trade count: 5–30 per quarter
- The system holds trades for hours to weeks (never scalps)

Based on the data above, provide a structured research report:

Respond with ONLY valid JSON (no markdown, no preamble):
{
  "summary": "<2-3 sentence overall assessment of this instrument's suitability for the system>",
  "moveFrequency": "<assessment of how often significant tradeable moves occur>",
  "moveSize": "<assessment of typical move size vs the system's TP targets>",
  "holdDuration": "<assessment of how long moves last vs the system's hold philosophy>",
  "usefulTimeframes": "<which timeframes appear most meaningful for this instrument based on swing data>",
  "repeatableSetups": "<what appears repeatable or structural based on the data patterns>",
  "firingFrequency": "<expected signal frequency — how often the system should fire on this instrument>",
  "behaviorDrift": "<whether recent behavior differs significantly from older behavior>",
  "promisingAreas": "<what looks promising or improving in the data>",
  "degradingAreas": "<what looks degrading, less reliable, or risky in the recent data>"
}`;

  let aiResult: {
    summary: string;
    moveFrequency: string;
    moveSize: string;
    holdDuration: string;
    usefulTimeframes: string;
    repeatableSetups: string;
    firingFrequency: string;
    behaviorDrift: string;
    promisingAreas: string;
    degradingAreas: string;
  };

  let rawText = "";

  try {
    const client = await getOpenAIClient();
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      temperature: 0.3,
    });

    rawText = response.choices[0]?.message?.content?.trim() ?? "";
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON found in OpenAI response");

    const parsed = JSON.parse(match[0]);
    aiResult = {
      summary:           String(parsed.summary ?? ""),
      moveFrequency:     String(parsed.moveFrequency ?? ""),
      moveSize:          String(parsed.moveSize ?? ""),
      holdDuration:      String(parsed.holdDuration ?? ""),
      usefulTimeframes:  String(parsed.usefulTimeframes ?? ""),
      repeatableSetups:  String(parsed.repeatableSetups ?? ""),
      firingFrequency:   String(parsed.firingFrequency ?? ""),
      behaviorDrift:     String(parsed.behaviorDrift ?? ""),
      promisingAreas:    String(parsed.promisingAreas ?? ""),
      degradingAreas:    String(parsed.degradingAreas ?? ""),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[AIResearch] OpenAI analysis failed for ${symbol}: ${msg}`);
  }

  return {
    symbol,
    analysisWindowDays: actualWindowDays,
    dataFrom:   new Date(firstTs * 1000).toISOString(),
    dataTo:     new Date(lastTs  * 1000).toISOString(),
    totalCandles1m: totalCandles,
    swingStats,
    aiSummary:          aiResult.summary,
    aiMoveFrequency:    aiResult.moveFrequency,
    aiMoveSize:         aiResult.moveSize,
    aiHoldDuration:     aiResult.holdDuration,
    aiUsefulTimeframes: aiResult.usefulTimeframes,
    aiRepeatableSetups: aiResult.repeatableSetups,
    aiFiringFrequency:  aiResult.firingFrequency,
    aiBehaviorDrift:    aiResult.behaviorDrift,
    aiPromisingAreas:   aiResult.promisingAreas,
    aiDegradingAreas:   aiResult.degradingAreas,
    aiRawText:   rawText,
    generatedAt: new Date().toISOString(),
    windowDays,
  };
}

/**
 * Background-compatible wrapper for analyzeSymbol.
 * Updates jobStatus so callers can poll for completion.
 * Non-blocking — fires and forgets, result is stored in jobStatus.lastResult.
 */
export function runResearchJobBackground(symbol: string, windowDays = DEFAULT_WINDOW_DAYS): void {
  if (jobStatus.running) {
    console.warn(`[AIResearch] Job already running — skipping ${symbol}`);
    return;
  }

  jobStatus.running = true;
  jobStatus.lastRun[symbol] = new Date().toISOString();

  analyzeSymbol(symbol, windowDays)
    .then(report => {
      jobStatus.lastResult[symbol] = report;
      console.log(`[AIResearch] ${symbol}: research job complete`);
    })
    .catch(err => {
      console.error(`[AIResearch] ${symbol}: research job failed —`, err instanceof Error ? err.message : err);
      jobStatus.lastResult[symbol] = null;
    })
    .finally(() => {
      jobStatus.running = false;
    });
}
