import { db, platformStateTable, tradesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { TradingMode } from "../infrastructure/deriv.js";
import { getModeCapitalKey, getModeCapitalDefault } from "../infrastructure/deriv.js";

export interface ExtractionCycle {
  mode: TradingMode;
  startCapital: number;
  currentCapital: number;
  targetCapital: number;
  extractionTarget: number;
  extractionReady: boolean;
  cycleNumber: number;
  profitSinceReset: number;
  profitPct: number;
}

const DEFAULT_EXTRACTION_TARGET_PCT = 50;

export async function getExtractionCycle(mode: TradingMode): Promise<ExtractionCycle> {
  const states = await db.select().from(platformStateTable);
  const stateMap: Record<string, string> = {};
  for (const s of states) stateMap[s.key] = s.value;

  const prefix = mode === "paper" ? "paper" : mode === "demo" ? "demo" : "real";
  const capitalKey = getModeCapitalKey(mode);
  const capitalDefault = getModeCapitalDefault(mode);

  const startCapital = parseFloat(stateMap[`${prefix}_extraction_start_capital`] || stateMap[capitalKey] || capitalDefault);
  const currentCapital = parseFloat(stateMap[capitalKey] || capitalDefault);
  const extractionTargetPct = parseFloat(stateMap[`${prefix}_extraction_target_pct`] || stateMap["extraction_target_pct"] || String(DEFAULT_EXTRACTION_TARGET_PCT));
  const cycleNumber = parseInt(stateMap[`${prefix}_extraction_cycle`] || "1");

  const targetCapital = startCapital * (1 + extractionTargetPct / 100);
  const extractionTarget = targetCapital - startCapital;
  const profitSinceReset = currentCapital - startCapital;
  const profitPct = startCapital > 0 ? (profitSinceReset / startCapital) * 100 : 0;
  const extractionReady = currentCapital >= targetCapital;

  return {
    mode,
    startCapital,
    currentCapital,
    targetCapital,
    extractionTarget,
    extractionReady,
    cycleNumber,
    profitSinceReset,
    profitPct,
  };
}

export async function executeExtraction(mode: TradingMode): Promise<{
  extracted: number;
  newCapital: number;
  cycleNumber: number;
} | null> {
  const cycle = await getExtractionCycle(mode);
  if (!cycle.extractionReady) return null;

  const extractAmount = cycle.currentCapital - cycle.startCapital;
  const newCapital = cycle.startCapital;
  const newCycle = cycle.cycleNumber + 1;

  const prefix = mode === "paper" ? "paper" : mode === "demo" ? "demo" : "real";
  const capitalKey = getModeCapitalKey(mode);

  const updates: Record<string, string> = {
    [capitalKey]: String(newCapital),
    [`${prefix}_extraction_start_capital`]: String(newCapital),
    [`${prefix}_extraction_cycle`]: String(newCycle),
    [`${prefix}_last_extraction_at`]: new Date().toISOString(),
    [`${prefix}_last_extraction_amount`]: String(extractAmount),
    [`${prefix}_total_extracted`]: String(
      parseFloat((await getStateValue(`${prefix}_total_extracted`)) || "0") + extractAmount
    ),
  };

  for (const [key, value] of Object.entries(updates)) {
    await db.insert(platformStateTable).values({ key, value })
      .onConflictDoUpdate({ target: platformStateTable.key, set: { value, updatedAt: new Date() } });
  }

  console.log(`[ExtractionEngine] Extracted $${extractAmount.toFixed(2)} from ${mode.toUpperCase()} | Reset to $${newCapital.toFixed(2)} | Cycle #${newCycle}`);

  return { extracted: extractAmount, newCapital, cycleNumber: newCycle };
}

async function getStateValue(key: string): Promise<string | null> {
  const rows = await db.select().from(platformStateTable).where(eq(platformStateTable.key, key));
  return rows[0]?.value ?? null;
}

export async function checkAndAutoExtract(mode: TradingMode): Promise<void> {
  const prefix = mode === "paper" ? "paper" : mode === "demo" ? "demo" : "real";
  const autoExtract = (await getStateValue(`${prefix}_auto_extraction`)) || "false";
  if (autoExtract !== "true") return;

  const cycle = await getExtractionCycle(mode);
  if (cycle.extractionReady) {
    console.log(`[ExtractionEngine] Auto-extraction triggered for ${mode.toUpperCase()} — profit ${cycle.profitPct.toFixed(1)}% reached target`);
    await executeExtraction(mode);
  }
}
