import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, signalLogTable } from "@workspace/db";
import { computeFeatures } from "../lib/features.js";
import { runAllStrategies } from "../lib/strategies.js";
import { routeSignals, logSignalDecisions } from "../lib/signalRouter.js";

const router: IRouter = Router();

const SYMBOLS = ["BOOM1000", "CRASH1000", "BOOM500", "CRASH500"];

/**
 * GET /api/signals/latest - return logged signal history
 */
router.get("/signals/latest", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit || 20), 100);
  const rows = await db.select().from(signalLogTable)
    .orderBy(desc(signalLogTable.ts))
    .limit(limit);
  res.json(rows.map(r => ({
    id: r.id,
    ts: r.ts.toISOString(),
    symbol: r.symbol,
    strategyName: r.strategyName,
    score: r.score,
    expectedValue: r.expectedValue,
    allowedFlag: r.allowedFlag,
    rejectionReason: r.rejectionReason,
    direction: r.direction,
    suggestedSl: r.suggestedSl,
    suggestedTp: r.suggestedTp,
    aiVerdict: r.aiVerdict ?? null,
    aiReasoning: r.aiReasoning ?? null,
    aiConfidenceAdj: r.aiConfidenceAdj ?? null,
  })));
});

/**
 * POST /api/signals/scan - run a full scan on all symbols right now
 */
router.post("/signals/scan", async (_req, res): Promise<void> => {
  try {
    const allCandidates = [];
    const symbolResults: Record<string, number> = {};

    for (const symbol of SYMBOLS) {
      const features = await computeFeatures(symbol);
      if (!features) { symbolResults[symbol] = 0; continue; }

      const candidates = runAllStrategies(features);
      allCandidates.push(...candidates);
      symbolResults[symbol] = candidates.length;
    }

    if (allCandidates.length === 0) {
      res.json({
        success: true,
        message: "Scan complete — no signals fired on current market conditions.",
        candidates: 0, allowed: 0, decisions: [],
      });
      return;
    }

    const decisions = await routeSignals(allCandidates);
    await logSignalDecisions(decisions);

    const allowed = decisions.filter(d => d.allowed);
    const rejected = decisions.filter(d => !d.allowed);

    res.json({
      success: true,
      message: `Scan complete: ${allCandidates.length} candidates → ${allowed.length} allowed, ${rejected.length} rejected`,
      candidates: allCandidates.length,
      allowed: allowed.length,
      symbolBreakdown: symbolResults,
      decisions: decisions.map(d => ({
        symbol: d.signal.symbol,
        strategy: d.signal.strategyName,
        direction: d.signal.direction,
        score: d.signal.score.toFixed(3),
        ev: d.signal.expectedValue.toFixed(4),
        allowed: d.allowed,
        rejectionReason: d.rejectionReason,
        capitalAmount: d.capitalAmount.toFixed(2),
        reason: d.signal.reason,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, message: `Scan failed: ${message}` });
  }
});

/**
 * GET /api/signals/features/:symbol - get current feature vector for a symbol
 */
router.get("/signals/features/:symbol", async (req, res): Promise<void> => {
  const symbol = req.params.symbol?.toUpperCase() ?? "";
  if (!SYMBOLS.includes(symbol)) {
    res.status(400).json({ error: `Unknown symbol. Use: ${SYMBOLS.join(", ")}` });
    return;
  }
  try {
    const features = await computeFeatures(symbol);
    if (!features) {
      res.status(404).json({ error: `Insufficient data for ${symbol} — run backfill first.` });
      return;
    }
    res.json(features);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Feature computation failed: ${message}` });
  }
});

/**
 * GET /api/signals/strategies - return which strategies fired for a symbol
 */
router.get("/signals/strategies/:symbol", async (req, res): Promise<void> => {
  const symbol = req.params.symbol?.toUpperCase() ?? "";
  if (!SYMBOLS.includes(symbol)) {
    res.status(400).json({ error: `Unknown symbol. Use: ${SYMBOLS.join(", ")}` });
    return;
  }
  try {
    const features = await computeFeatures(symbol);
    if (!features) {
      res.status(404).json({ error: `Insufficient data for ${symbol} — run backfill first.` });
      return;
    }
    const candidates = runAllStrategies(features);
    res.json({
      symbol,
      regime: features.regimeLabel,
      rsi14: features.rsi14,
      emaSlope: features.emaSlope,
      spikeHazard: features.spikeHazardScore,
      bbWidth: features.bbWidth,
      zScore: features.zScore,
      strategies: candidates.map(c => ({
        name: c.strategyName,
        direction: c.direction,
        score: c.score,
        confidence: c.confidence,
        ev: c.expectedValue,
        reason: c.reason,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Strategy scan failed: ${message}` });
  }
});

export default router;
