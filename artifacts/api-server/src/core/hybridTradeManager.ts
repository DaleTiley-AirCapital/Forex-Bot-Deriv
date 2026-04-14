/**
 * V3 Hybrid Trade Manager
 *
 * Implements staged trade management layered on top of the existing trade engine.
 *
 * Stage model:
 *   Stage 1 — entry: SL at original position (below/above entry)
 *   Stage 2 — protection: SL moved to breakeven after BREAKEVEN_THRESHOLD_PCT of TP distance
 *   Stage 3 — runner: adaptive trailing stop from TRAILING_ACTIVATION_THRESHOLD_PCT of TP
 *
 * Thresholds are sourced from the shared tradeManagement module so backtest and live
 * always use identical values (single source of truth).
 *
 * This module handles ONLY Stage 1→2 SL promotion.
 * Stage 2→3 trailing stop activation is handled by the existing tradeEngine.
 * Trade closes are handled by manageOpenPositions in tradeEngine.
 *
 * Call order in positionManagementCycle:
 *   1. promoteBreakevenSls()  ← this module (stage 2 promotion)
 *   2. manageOpenPositions()  ← tradeEngine (trailing stop + closes)
 *
 * No DB schema changes required.
 */
import { db, tradesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { BREAKEVEN_THRESHOLD_PCT, calcTpProgress } from "./tradeManagement.js";

function inferHybridStage(
  entryPrice: number,
  currentSl: number,
  direction: "buy" | "sell",
): 1 | 2 | 3 {
  if (direction === "buy") {
    if (currentSl < entryPrice * 0.9998) return 1;
    if (currentSl >= entryPrice * 0.9998 && currentSl <= entryPrice * 1.002) return 2;
    return 3;
  } else {
    if (currentSl > entryPrice * 1.0002) return 1;
    if (currentSl <= entryPrice * 1.0002 && currentSl >= entryPrice * 0.998) return 2;
    return 3;
  }
}

function calcBreakevenSl(entryPrice: number, direction: "buy" | "sell"): number {
  const buffer = entryPrice * 0.0005;
  return direction === "buy" ? entryPrice + buffer : entryPrice - buffer;
}

/**
 * Promotes stage-1 trades to stage-2 (breakeven SL) when price has moved
 * BREAKEVEN_THRESHOLD_PCT+ of the TP distance in favor.
 *
 * Uses calcTpProgress() from the shared tradeManagement module so the
 * progression formula is identical to what backtestRunner uses.
 *
 * Only updates SL. Does not close trades. Closes are handled by manageOpenPositions.
 */
export async function promoteBreakevenSls(): Promise<void> {
  const openTrades = await db.select().from(tradesTable)
    .where(eq(tradesTable.status, "open"));

  if (openTrades.length === 0) return;

  for (const trade of openTrades) {
    try {
      const direction = trade.side as "buy" | "sell";
      const entryPrice = trade.entryPrice;
      const tp = trade.tp;
      const currentSl = trade.sl;
      const currentPrice = trade.currentPrice ?? entryPrice;

      const stage = inferHybridStage(entryPrice, currentSl, direction);
      if (stage !== 1) continue;

      const progress = calcTpProgress({
        direction,
        entryPrice,
        currentPrice,
        tpPrice: tp,
      });

      if (progress < BREAKEVEN_THRESHOLD_PCT) continue;

      const beSl = calcBreakevenSl(entryPrice, direction);

      const slImproved = direction === "buy"
        ? beSl > currentSl
        : beSl < currentSl;

      if (!slImproved) continue;

      await db.update(tradesTable)
        .set({ sl: beSl })
        .where(eq(tradesTable.id, trade.id));

      console.log(
        `[HybridMgr] Trade ${trade.id} ${trade.symbol} | Stage 1→2 | ` +
        `SL promoted to breakeven ${beSl.toFixed(4)} | ` +
        `progress=${(progress * 100).toFixed(1)}% of TP | mode=${trade.mode}`
      );
    } catch (err) {
      console.error(`[HybridMgr] Error promoting trade ${trade.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Returns the hybrid stage for a given trade (for diagnostics/logging).
 */
export function getTradeHybridStage(
  entryPrice: number,
  currentSl: number,
  direction: "buy" | "sell",
): 1 | 2 | 3 {
  return inferHybridStage(entryPrice, currentSl, direction);
}
