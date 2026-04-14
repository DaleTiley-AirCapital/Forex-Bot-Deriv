/**
 * behaviorCapture.ts — Behavior Event Capture Layer
 *
 * Records per-trade behavior events from backtest replay.
 * Events are stored in-memory, keyed by symbol+engine.
 * The behavior profiler reads these events to derive profiles.
 *
 * This module has NO DB dependency — it is a pure in-memory event log.
 * Events are cleared when a new backtest run starts for the same symbol.
 */

export interface BehaviorEvent {
  symbol: string;
  engineName: string;
  entryType: string;
  direction: "buy" | "sell";
  regimeAtEntry: string;
  regimeConfidence: number;
  nativeScore: number;
  projectedMovePct: number;
  entryTs: number;
  exitTs: number;
  holdBars: number;
  pnlPct: number;
  mfePct: number;
  maePct: number;
  exitReason: "tp_hit" | "sl_hit" | "max_duration";
  slStage: 1 | 2 | 3;
  conflictResolution: string;
}

// Key: `${symbol}|${engineName}`
const eventStore = new Map<string, BehaviorEvent[]>();

export function clearBehaviorEvents(symbol: string, engineName?: string): void {
  if (engineName) {
    const key = `${symbol}|${engineName}`;
    eventStore.delete(key);
  } else {
    for (const key of eventStore.keys()) {
      if (key.startsWith(`${symbol}|`)) {
        eventStore.delete(key);
      }
    }
  }
}

export function recordBehaviorEvent(event: BehaviorEvent): void {
  const key = `${event.symbol}|${event.engineName}`;
  const existing = eventStore.get(key) ?? [];
  existing.push(event);
  eventStore.set(key, existing);
}

export function getBehaviorEvents(symbol: string, engineName?: string): BehaviorEvent[] {
  if (engineName) {
    return eventStore.get(`${symbol}|${engineName}`) ?? [];
  }
  const results: BehaviorEvent[] = [];
  for (const [key, events] of eventStore.entries()) {
    if (key.startsWith(`${symbol}|`)) {
      results.push(...events);
    }
  }
  return results;
}

export function getAllBehaviorKeys(): string[] {
  return [...eventStore.keys()];
}

export function getBehaviorEventCount(): number {
  let total = 0;
  for (const events of eventStore.values()) total += events.length;
  return total;
}
