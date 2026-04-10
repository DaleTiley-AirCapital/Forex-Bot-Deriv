import { Router, type IRouter } from "express";
import { backgroundDb, candlesTable } from "@workspace/db";
import { eq, and, gte, lt, asc, min, max, count, sql } from "drizzle-orm";
import { streamResearchExport } from "../infrastructure/candleExport.js";
import { ENRICHMENT_TIMEFRAMES } from "../core/dataIntegrity.js";

const router: IRouter = Router();

const SUPPORTED_TIMEFRAMES = new Set(Object.keys(ENRICHMENT_TIMEFRAMES));
const SYMBOL_RE = /^[A-Z0-9_]{1,20}$/;

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
}

function dateToTs(d: string, endOfDay = false): number {
  const base = new Date(d + "T00:00:00.000Z").getTime() / 1000;
  return endOfDay ? base + 86400 : base;
}

function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

// ─── GET /export/range ────────────────────────────────────────────────────────
//
// Returns the true available data coverage for a symbol/timeframe from `candles`.
// Used by the export screen to populate valid date bounds and prevent nonsense
// date selections.
//
// Response:
//   symbol, timeframe,
//   firstAvailableTimestamp, lastAvailableTimestamp,
//   firstAvailableDate, lastAvailableDate,
//   totalRows, interpolatedCount, realRows,
//   health: "ok" | "empty" | "partial"

router.get("/export/range", async (req, res): Promise<void> => {
  const symbol    = req.query.symbol    as string | undefined;
  const timeframe = req.query.timeframe as string | undefined ?? "1m";

  if (!symbol || !SYMBOL_RE.test(symbol)) {
    res.status(400).json({ error: "symbol query param is required (uppercase alphanumeric/underscore)" });
    return;
  }
  if (!SUPPORTED_TIMEFRAMES.has(timeframe)) {
    res.status(400).json({ error: `timeframe must be one of: ${[...SUPPORTED_TIMEFRAMES].join(", ")}` });
    return;
  }

  try {
    const [total] = await backgroundDb
      .select({
        cnt:   count(),
        first: min(candlesTable.openTs),
        last:  max(candlesTable.openTs),
      })
      .from(candlesTable)
      .where(and(
        eq(candlesTable.symbol,    symbol),
        eq(candlesTable.timeframe, timeframe),
      ));

    const [interp] = await backgroundDb
      .select({ cnt: count() })
      .from(candlesTable)
      .where(and(
        eq(candlesTable.symbol,         symbol),
        eq(candlesTable.timeframe,      timeframe),
        eq(candlesTable.isInterpolated, true),
      ));

    const totalRows        = Number(total?.cnt ?? 0);
    const interpolatedCount = Number(interp?.cnt ?? 0);
    const realRows         = totalRows - interpolatedCount;
    const firstTs          = total?.first ?? null;
    const lastTs           = total?.last  ?? null;

    res.json({
      symbol,
      timeframe,
      firstAvailableTimestamp: firstTs,
      lastAvailableTimestamp:  lastTs,
      firstAvailableDate:      firstTs ? tsToDate(firstTs) : null,
      lastAvailableDate:       lastTs  ? tsToDate(lastTs)  : null,
      totalRows,
      interpolatedCount,
      realRows,
      health: totalRows === 0 ? "empty" : interpolatedCount > totalRows * 0.1 ? "partial" : "ok",
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── GET /export/precheck ─────────────────────────────────────────────────────
//
// Returns selected-range stats (tied to startDate/endDate) AND total-available
// stats separately.
//
// This replaces the broken frontend approach of calling /diagnostics/data-integrity
// which returns total counts and null firstDate/lastDate for 1m.
//
// Response:
//   symbol, timeframe, startDate, endDate,
//   selectedRange: { rowCount, firstTimestamp, lastTimestamp, firstDate, lastDate, interpolatedCount, gapIndicator }
//   totalAvailable: { rowCount, firstTimestamp, lastTimestamp, firstDate, lastDate, interpolatedCount }
//   ready: boolean   — true if selectedRange.rowCount > 0
//   outOfRange: boolean — true if no data in the selected range but total data exists

router.get("/export/precheck", async (req, res): Promise<void> => {
  const symbol    = req.query.symbol    as string | undefined;
  const timeframe = req.query.timeframe as string | undefined ?? "1m";
  const startDate = req.query.startDate as string | undefined;
  const endDate   = req.query.endDate   as string | undefined;

  if (!symbol || !SYMBOL_RE.test(symbol)) {
    res.status(400).json({ error: "symbol query param is required" });
    return;
  }
  if (!SUPPORTED_TIMEFRAMES.has(timeframe)) {
    res.status(400).json({ error: `timeframe must be one of: ${[...SUPPORTED_TIMEFRAMES].join(", ")}` });
    return;
  }
  if (!startDate || !isValidDate(startDate)) {
    res.status(400).json({ error: "startDate query param is required (YYYY-MM-DD)" });
    return;
  }
  if (!endDate || !isValidDate(endDate)) {
    res.status(400).json({ error: "endDate query param is required (YYYY-MM-DD)" });
    return;
  }
  if (startDate > endDate) {
    res.status(400).json({ error: "startDate must be on or before endDate" });
    return;
  }

  try {
    const rangeStartTs = dateToTs(startDate, false);
    const rangeEndTs   = dateToTs(endDate,   true);

    const rangeWhere = and(
      eq(candlesTable.symbol,    symbol),
      eq(candlesTable.timeframe, timeframe),
      gte(candlesTable.openTs,   rangeStartTs),
      lt(candlesTable.openTs,    rangeEndTs),
    );

    const totalWhere = and(
      eq(candlesTable.symbol,    symbol),
      eq(candlesTable.timeframe, timeframe),
    );

    const [rangeSummary] = await backgroundDb
      .select({
        cnt:   count(),
        first: min(candlesTable.openTs),
        last:  max(candlesTable.openTs),
      })
      .from(candlesTable)
      .where(rangeWhere);

    const [rangeInterp] = await backgroundDb
      .select({ cnt: count() })
      .from(candlesTable)
      .where(and(rangeWhere, eq(candlesTable.isInterpolated, true)));

    const [totalSummary] = await backgroundDb
      .select({
        cnt:   count(),
        first: min(candlesTable.openTs),
        last:  max(candlesTable.openTs),
      })
      .from(candlesTable)
      .where(totalWhere);

    const [totalInterp] = await backgroundDb
      .select({ cnt: count() })
      .from(candlesTable)
      .where(and(totalWhere, eq(candlesTable.isInterpolated, true)));

    const rangeCount     = Number(rangeSummary?.cnt   ?? 0);
    const rangeInterpCnt = Number(rangeInterp?.cnt    ?? 0);
    const rangeFirst     = rangeSummary?.first ?? null;
    const rangeLast      = rangeSummary?.last  ?? null;

    const totalCount     = Number(totalSummary?.cnt   ?? 0);
    const totalInterpCnt = Number(totalInterp?.cnt    ?? 0);
    const totalFirst     = totalSummary?.first ?? null;
    const totalLast      = totalSummary?.last  ?? null;

    const ready      = rangeCount > 0;
    const outOfRange = !ready && totalCount > 0;

    let outOfRangeMsg: string | null = null;
    if (outOfRange && totalFirst && totalLast) {
      outOfRangeMsg = `No ${symbol}/${timeframe} data in ${startDate} → ${endDate}. Available: ${tsToDate(totalFirst)} → ${tsToDate(totalLast)}`;
    }

    res.json({
      symbol,
      timeframe,
      startDate,
      endDate,
      ready,
      outOfRange,
      outOfRangeMsg,
      selectedRange: {
        rowCount:           rangeCount,
        firstTimestamp:     rangeFirst,
        lastTimestamp:      rangeLast,
        firstDate:          rangeFirst ? tsToDate(rangeFirst) : null,
        lastDate:           rangeLast  ? tsToDate(rangeLast)  : null,
        interpolatedCount:  rangeInterpCnt,
        realCount:          rangeCount - rangeInterpCnt,
      },
      totalAvailable: {
        rowCount:           totalCount,
        firstTimestamp:     totalFirst,
        lastTimestamp:      totalLast,
        firstDate:          totalFirst ? tsToDate(totalFirst) : null,
        lastDate:           totalLast  ? tsToDate(totalLast)  : null,
        interpolatedCount:  totalInterpCnt,
        realCount:          totalCount - totalInterpCnt,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

// ─── POST /export/research ────────────────────────────────────────────────────

router.post("/export/research", async (req, res): Promise<void> => {
  const { symbol, timeframe = "1m", startDate, endDate, maxCandlesPerChunk } = req.body ?? {};
  const includeCsv = req.query.csv === "true";

  if (!symbol || typeof symbol !== "string" || !SYMBOL_RE.test(symbol)) {
    res.status(400).json({ error: "symbol is required and must be uppercase alphanumeric/underscore (max 20 chars)" });
    return;
  }
  if (typeof timeframe !== "string" || !SUPPORTED_TIMEFRAMES.has(timeframe)) {
    res.status(400).json({ error: `timeframe must be one of: ${[...SUPPORTED_TIMEFRAMES].join(", ")}` });
    return;
  }
  if (!startDate || typeof startDate !== "string" || !isValidDate(startDate)) {
    res.status(400).json({ error: "startDate is required and must be YYYY-MM-DD" });
    return;
  }
  if (!endDate || typeof endDate !== "string" || !isValidDate(endDate)) {
    res.status(400).json({ error: "endDate is required and must be YYYY-MM-DD" });
    return;
  }
  if (startDate > endDate) {
    res.status(400).json({ error: "startDate must be on or before endDate" });
    return;
  }

  let maxChunk: number | undefined;
  if (maxCandlesPerChunk !== undefined) {
    const raw = Number(maxCandlesPerChunk);
    if (!Number.isInteger(raw) || raw < 1 || raw > 50_000) {
      res.status(400).json({ error: "maxCandlesPerChunk must be an integer between 1 and 50000" });
      return;
    }
    maxChunk = raw;
  }

  console.log(`[Export] Research bundle requested: ${symbol}/${timeframe} ${startDate} → ${endDate} (maxChunk=${maxChunk ?? 25000}, csv=${includeCsv})`);

  try {
    await streamResearchExport(
      { symbol, timeframe, startDate, endDate, maxCandlesPerChunk: maxChunk, includeCsv },
      res,
    );
    console.log(`[Export] Bundle complete: ${symbol}/${timeframe} ${startDate} → ${endDate}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Export] Error: ${msg}`);
    if (!res.headersSent) {
      res.status(500).json({ error: `Export failed: ${msg}` });
    } else {
      res.end();
    }
  }
});

export default router;
