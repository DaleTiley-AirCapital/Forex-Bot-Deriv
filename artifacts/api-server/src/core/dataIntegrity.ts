/**
 * Data Integrity Service — V3 Backend Foundation
 *
 * Provides gap detection, targeted gap-fill, and data top-up workflows
 * for all stored candle data.
 *
 * This is the reusable backend layer for:
 * - backfill/top-up workflows
 * - export preparation
 * - research preparation
 * - diagnostics
 *
 * Does NOT touch trading logic, strategies, or live engine path.
 */
import { db, backgroundDb, candlesTable } from "@workspace/db";
import { eq, and, gte, lt, min, max, count, asc, sql } from "drizzle-orm";
import type { DerivClient } from "../infrastructure/deriv.js";
type DerivClientPublic = DerivClient;

export interface CandleGap {
  symbol: string;
  timeframe: string;
  gapStart: number;
  gapEnd: number;
  expectedCount: number;
  label: string;
}

export interface IntegrityReport {
  symbol: string;
  timeframe: string;
  totalCandles: number;
  firstTs: number | null;
  lastTs: number | null;
  firstDate: string | null;
  lastDate: string | null;
  duplicateCount: number;
  missingIntervalCount: number;
  gapCount: number;
  gaps: CandleGap[];
  strictlyAscending: boolean;
  coveragePct: number;
  isHealthy: boolean;
  checkedAt: string;
}

export interface TopUpResult {
  symbol: string;
  timeframes: string[];
  gapsFound: number;
  gapsRepaired: number;
  candlesInserted: number;
  errors: string[];
  durationMs: number;
}

// Candle intervals in seconds for all supported timeframes
export const ENRICHMENT_TIMEFRAMES: Record<string, number> = {
  "1m":  60,
  "5m":  300,
  "10m": 600,
  "20m": 1200,
  "40m": 2400,
  "1h":  3600,
  "2h":  7200,
  "4h":  14400,
  "8h":  28800,
  "1d":  86400,
  "2d":  172800,
  "4d":  345600,
};

// Base timeframes that can be fetched from API (all others derived from 1m)
export const API_FETCHABLE_TIMEFRAMES = ["1m", "5m"] as const;

/**
 * Detects missing candle intervals (gaps) for a given symbol/timeframe.
 * Reads all stored openTs values and finds segments where timestamps are
 * non-consecutive beyond 1.5× the expected interval.
 *
 * Returns gaps sorted by gapStart ascending.
 * Gaps smaller than 3 expected candles are ignored (market microstructure noise).
 */
export async function detectCandleGaps(
  symbol: string,
  timeframe: string,
  lookbackDays = 365,
): Promise<CandleGap[]> {
  const tfSecs = ENRICHMENT_TIMEFRAMES[timeframe];
  if (!tfSecs) throw new Error(`[DataIntegrity] Unknown timeframe: ${timeframe}`);

  const cutoff = Math.floor(Date.now() / 1000) - lookbackDays * 86400;

  const rows = await backgroundDb
    .select({ ts: candlesTable.openTs })
    .from(candlesTable)
    .where(and(
      eq(candlesTable.symbol, symbol),
      eq(candlesTable.timeframe, timeframe),
      gte(candlesTable.openTs, cutoff),
    ))
    .orderBy(asc(candlesTable.openTs));

  if (rows.length < 2) return [];

  const gaps: CandleGap[] = [];
  const maxGapSecs = tfSecs * 1.5;

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].ts;
    const curr = rows[i].ts;
    const delta = curr - prev;

    if (delta > maxGapSecs) {
      const missedCandles = Math.round(delta / tfSecs) - 1;
      if (missedCandles >= 3) {
        gaps.push({
          symbol,
          timeframe,
          gapStart: prev + tfSecs,
          gapEnd: curr - 1,
          expectedCount: missedCandles,
          label: `${new Date(prev * 1000).toISOString().slice(0, 16)} → ${new Date(curr * 1000).toISOString().slice(0, 16)} (${missedCandles} missing)`,
        });
      }
    }
  }

  return gaps;
}

/**
 * Counts duplicate timestamps for a given symbol/timeframe.
 * (uniqueIndex should prevent new duplicates, but existing data may have them.)
 */
export async function countDuplicateTimestamps(
  symbol: string,
  timeframe: string,
): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) - COUNT(DISTINCT open_ts) AS dupes
    FROM candles
    WHERE symbol = ${symbol} AND timeframe = ${timeframe}
  `);
  return Number((result.rows[0] as { dupes: unknown })?.dupes ?? 0);
}

/**
 * Produces a full integrity report for a symbol/timeframe pair.
 * Includes gap list, duplicate count, coverage %, and health flag.
 */
export async function getIntegrityReport(
  symbol: string,
  timeframe: string,
  lookbackDays = 365,
): Promise<IntegrityReport> {
  const tfSecs = ENRICHMENT_TIMEFRAMES[timeframe];
  if (!tfSecs) throw new Error(`[DataIntegrity] Unknown timeframe: ${timeframe}`);

  const cutoff = Math.floor(Date.now() / 1000) - lookbackDays * 86400;
  const now = Math.floor(Date.now() / 1000);

  const [summary] = await db
    .select({
      cnt: count(),
      firstTs: min(candlesTable.openTs),
      lastTs: max(candlesTable.openTs),
    })
    .from(candlesTable)
    .where(and(
      eq(candlesTable.symbol, symbol),
      eq(candlesTable.timeframe, timeframe),
      gte(candlesTable.openTs, cutoff),
    ));

  const totalCandles = Number(summary?.cnt ?? 0);
  const firstTs = summary?.firstTs ?? null;
  const lastTs = summary?.lastTs ?? null;

  const gaps = await detectCandleGaps(symbol, timeframe, lookbackDays);
  const dupes = await countDuplicateTimestamps(symbol, timeframe);

  const missingIntervalCount = gaps.reduce((s, g) => s + g.expectedCount, 0);
  const expectedTotal = firstTs ? Math.ceil((now - firstTs) / tfSecs) : 0;
  const coveragePct = expectedTotal > 0 ? Math.min(100, (totalCandles / expectedTotal) * 100) : 0;

  // Check ascending order (sample last 100 rows)
  const sample = await backgroundDb
    .select({ ts: candlesTable.openTs })
    .from(candlesTable)
    .where(and(
      eq(candlesTable.symbol, symbol),
      eq(candlesTable.timeframe, timeframe),
      gte(candlesTable.openTs, cutoff),
    ))
    .orderBy(asc(candlesTable.openTs))
    .limit(100);

  let strictlyAscending = true;
  for (let i = 1; i < sample.length; i++) {
    if (sample[i].ts <= sample[i - 1].ts) { strictlyAscending = false; break; }
  }

  const isHealthy = dupes === 0 && gaps.length === 0 && strictlyAscending && coveragePct >= 70;

  return {
    symbol,
    timeframe,
    totalCandles,
    firstTs,
    lastTs,
    firstDate: firstTs ? new Date(firstTs * 1000).toISOString() : null,
    lastDate: lastTs ? new Date(lastTs * 1000).toISOString() : null,
    duplicateCount: dupes,
    missingIntervalCount,
    gapCount: gaps.length,
    gaps: gaps.slice(0, 20),
    strictlyAscending,
    coveragePct: Math.round(coveragePct * 10) / 10,
    isHealthy,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Fetches and inserts candles for a specific time range for a symbol/timeframe.
 * Used to fill individual gaps. Only works for API-fetchable timeframes (1m, 5m).
 *
 * client must be connected and authorized.
 * Returns the number of candles inserted.
 */
export async function repairGapFromApi(
  symbol: string,
  timeframe: string,
  gapStart: number,
  gapEnd: number,
  client: DerivClientPublic,
): Promise<number> {
  const tfSecs = ENRICHMENT_TIMEFRAMES[timeframe];
  if (!tfSecs) throw new Error(`[DataIntegrity] Unknown timeframe: ${timeframe}`);
  if (!(API_FETCHABLE_TIMEFRAMES as readonly string[]).includes(timeframe)) {
    throw new Error(`[DataIntegrity] ${timeframe} is not API-fetchable; derive from 1m instead`);
  }

  const MAX_PER_PAGE = 5000;
  const granularity = tfSecs;
  let inserted = 0;
  let endEpoch = gapEnd;

  while (endEpoch > gapStart) {
    const candles = await client.getCandleHistoryWithEnd(symbol, granularity, MAX_PER_PAGE, endEpoch, true);
    if (!candles || candles.length === 0) break;

    const inRange = candles.filter(c => c.epoch >= gapStart && c.epoch <= gapEnd);
    if (inRange.length === 0) break;

    const values = inRange.map(c => ({
      symbol,
      timeframe,
      openTs: c.epoch,
      closeTs: c.epoch + tfSecs,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      tickCount: 0,
    }));

    for (let i = 0; i < values.length; i += 500) {
      const chunk = values.slice(i, i + 500);
      await db.insert(candlesTable).values(chunk).onConflictDoNothing();
      inserted += chunk.length;
    }

    const oldest = inRange[0].epoch;
    if (oldest <= gapStart || oldest >= endEpoch) break;
    endEpoch = oldest - 1;

    await new Promise(r => setTimeout(r, 120));
  }

  return inserted;
}

/**
 * Targeted gap-fill for a symbol/timeframe.
 * Detects gaps, then fetches missing ranges from the API (1m/5m only).
 * For derived timeframes, call candleEnrichment.enrichTimeframes() after.
 *
 * Returns number of candles inserted.
 */
export async function repairAllGaps(
  symbol: string,
  timeframe: string,
  client: DerivClientPublic,
  lookbackDays = 365,
): Promise<{ inserted: number; errors: string[] }> {
  if (!(API_FETCHABLE_TIMEFRAMES as readonly string[]).includes(timeframe)) {
    return { inserted: 0, errors: [`${timeframe} cannot be repaired from API — derive from 1m`] };
  }

  const gaps = await detectCandleGaps(symbol, timeframe, lookbackDays);
  if (gaps.length === 0) return { inserted: 0, errors: [] };

  let totalInserted = 0;
  const errors: string[] = [];

  for (const gap of gaps) {
    try {
      console.log(`[DataIntegrity] Repairing gap ${gap.label} for ${symbol}/${timeframe}`);
      const n = await repairGapFromApi(symbol, timeframe, gap.gapStart, gap.gapEnd, client);
      totalInserted += n;
      console.log(`[DataIntegrity] Gap repaired: inserted ${n} candles`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[DataIntegrity] Gap repair failed for ${gap.label}: ${msg}`);
      errors.push(`gap@${gap.gapStart}: ${msg}`);
    }
  }

  return { inserted: totalInserted, errors };
}

/**
 * Full data top-up / reconciliation pipeline for a symbol.
 *
 * Steps:
 * 1. Check 1m and 5m base data integrity
 * 2. Repair detected gaps via API
 * 3. Trigger timeframe enrichment for derived TFs
 * 4. Final integrity re-check
 *
 * Designed to be reusable from: research prep, export prep, future UI "top up" action.
 */
export async function runDataTopUp(
  symbol: string,
  client: DerivClientPublic,
): Promise<TopUpResult> {
  const start = Date.now();
  const errors: string[] = [];
  let gapsFound = 0;
  let gapsRepaired = 0;
  let candlesInserted = 0;

  const baseTimeframes: string[] = ["1m", "5m"];

  for (const tf of baseTimeframes) {
    try {
      const gaps = await detectCandleGaps(symbol, tf);
      gapsFound += gaps.length;

      if (gaps.length > 0) {
        console.log(`[DataTopUp] ${symbol}/${tf}: ${gaps.length} gaps found, starting repair...`);
        const { inserted, errors: repairErrors } = await repairAllGaps(symbol, tf, client);
        candlesInserted += inserted;
        gapsRepaired += gaps.length - repairErrors.length;
        errors.push(...repairErrors);
      } else {
        console.log(`[DataTopUp] ${symbol}/${tf}: no gaps detected`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${tf} check failed: ${msg}`);
      console.error(`[DataTopUp] ${symbol}/${tf} error: ${msg}`);
    }
  }

  // Trigger enrichment for derived timeframes via dynamic import to avoid circular deps
  try {
    const { enrichTimeframes } = await import("./candleEnrichment.js");
    const enriched = await enrichTimeframes(symbol);
    candlesInserted += enriched.inserted;
    console.log(`[DataTopUp] ${symbol}: enrichment complete — ${enriched.inserted} derived candles inserted/updated`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`enrichment failed: ${msg}`);
    console.error(`[DataTopUp] ${symbol} enrichment error: ${msg}`);
  }

  const durationMs = Date.now() - start;
  const enrichedTfs = Object.keys(ENRICHMENT_TIMEFRAMES);

  console.log(`[DataTopUp] ${symbol}: complete in ${durationMs}ms | gaps=${gapsFound} repaired=${gapsRepaired} inserted=${candlesInserted} errors=${errors.length}`);

  return {
    symbol,
    timeframes: enrichedTfs,
    gapsFound,
    gapsRepaired,
    candlesInserted,
    errors,
    durationMs,
  };
}

/**
 * Quick data status summary for a symbol — counts per timeframe.
 * Lightweight — uses COUNT queries only.
 */
export async function getSymbolDataSummary(symbol: string): Promise<{
  symbol: string;
  timeframes: Array<{
    timeframe: string;
    count: number;
    firstDate: string | null;
    lastDate: string | null;
    ageHours: number | null;
  }>;
}> {
  const results = [];

  for (const tf of Object.keys(ENRICHMENT_TIMEFRAMES)) {
    const [row] = await db
      .select({
        cnt: count(),
        first: min(candlesTable.openTs),
        last: max(candlesTable.openTs),
      })
      .from(candlesTable)
      .where(and(eq(candlesTable.symbol, symbol), eq(candlesTable.timeframe, tf)));

    const cnt = Number(row?.cnt ?? 0);
    const first = row?.first ?? null;
    const last = row?.last ?? null;
    const ageHours = last ? Math.round((Date.now() / 1000 - last) / 3600 * 10) / 10 : null;

    results.push({
      timeframe: tf,
      count: cnt,
      firstDate: first ? new Date(first * 1000).toISOString().slice(0, 10) : null,
      lastDate: last ? new Date(last * 1000).toISOString().slice(0, 10) : null,
      ageHours,
    });
  }

  return { symbol, timeframes: results };
}
