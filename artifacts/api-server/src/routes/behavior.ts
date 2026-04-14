/**
 * Behavior Profile API Routes
 *
 * POST /api/behavior/profile         — run backtest + derive profiles for symbol(s)
 * GET  /api/behavior/profile/:symbol — get cached profile for a symbol
 * GET  /api/behavior/profile/:symbol/:engine — get single engine profile
 * GET  /api/behavior/export/:symbol  — export raw behavior events as JSON
 * GET  /api/behavior/export/:symbol/:engine — export per-engine events
 */
import { Router, type IRouter } from "express";
import {
  runV3Backtest,
  runV3BacktestMulti,
} from "../core/backtest/backtestRunner.js";
import {
  getBehaviorEvents,
  clearBehaviorEvents,
} from "../core/backtest/behaviorCapture.js";
import {
  deriveEngineProfile,
  deriveSymbolBehaviorProfile,
} from "../core/backtest/behaviorProfiler.js";
import { ACTIVE_SYMBOLS } from "../core/engineTypes.js";

const router: IRouter = Router();

/**
 * POST /api/behavior/profile
 *
 * Run a backtest to populate behavior events, then derive the profile.
 * Body: { symbol?: string, startTs?: number, endTs?: number, minScore?: number }
 * symbol defaults to "all" (derives profiles for all 4 active symbols).
 */
router.post("/behavior/profile", async (req, res): Promise<void> => {
  const { symbol = "all", startTs, endTs, minScore } = req.body ?? {};

  const validSymbols = [...ACTIVE_SYMBOLS, "all"];
  if (!validSymbols.includes(symbol)) {
    res.status(400).json({ error: `Invalid symbol. Use: ${validSymbols.join(", ")}` });
    return;
  }

  try {
    const symbols = symbol === "all" ? [...ACTIVE_SYMBOLS] : [symbol];

    // Clear existing events before re-run
    for (const sym of symbols) clearBehaviorEvents(sym);

    // Run backtest (populates behavior events via recordBehaviorEvent)
    if (symbol === "all") {
      await runV3BacktestMulti(symbols, startTs, endTs, minScore);
    } else {
      await runV3Backtest({ symbol, startTs, endTs, minScore });
    }

    // Derive profiles
    const profiles = symbols
      .map(sym => deriveSymbolBehaviorProfile(sym))
      .filter(Boolean);

    res.json({
      ok: true,
      profileCount: profiles.length,
      profiles,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Behavior profile derivation failed";
    console.error("[behavior/profile] error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/behavior/profile/:symbol
 *
 * Get the cached behavior profile for a symbol (derived from last backtest run).
 * Returns 404 if no behavior events have been captured yet.
 */
router.get("/behavior/profile/:symbol", (req, res): void => {
  const { symbol } = req.params;
  const profile = deriveSymbolBehaviorProfile(symbol);
  if (!profile) {
    res.status(404).json({
      error: `No behavior data for symbol "${symbol}". Run POST /api/behavior/profile first.`,
    });
    return;
  }
  res.json(profile);
});

/**
 * GET /api/behavior/profile/:symbol/:engine
 *
 * Get the cached profile for a specific engine on a symbol.
 */
router.get("/behavior/profile/:symbol/:engine", (req, res): void => {
  const { symbol, engine } = req.params;
  const profile = deriveEngineProfile(symbol, engine);
  if (!profile) {
    res.status(404).json({
      error: `No behavior data for ${symbol}/${engine}. Run POST /api/behavior/profile first.`,
    });
    return;
  }
  res.json(profile);
});

/**
 * GET /api/behavior/export/:symbol
 *
 * Export raw behavior events for a symbol as JSON.
 * Useful for offline analysis or CSV export from the frontend.
 */
router.get("/behavior/export/:symbol", (req, res): void => {
  const { symbol } = req.params;
  const events = getBehaviorEvents(symbol);
  res.json({
    symbol,
    eventCount: events.length,
    events,
  });
});

/**
 * GET /api/behavior/export/:symbol/:engine
 *
 * Export raw behavior events for a specific engine on a symbol.
 */
router.get("/behavior/export/:symbol/:engine", (req, res): void => {
  const { symbol, engine } = req.params;
  const events = getBehaviorEvents(symbol, engine);
  res.json({
    symbol,
    engineName: engine,
    eventCount: events.length,
    events,
  });
});

export default router;
