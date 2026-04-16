/**
 * moveLabeler.ts — Deterministic Move Type Labeling
 *
 * Classifies a detected structural price move as one of:
 *   "breakout"      — strong directional move with range expansion, low lead-in oscillation
 *   "continuation"  — move in the direction of prior trend, high directional persistence
 *   "reversal"      — move against prior trend/shape, direction flip from lead-in
 *   "unknown"       — insufficient structural evidence to classify
 *
 * This is DETERMINISTIC — no AI involvement. Labels are based solely on
 * measurable structural features extracted during move detection:
 *   - leadInShape: "trending" | "ranging" | "compressing" | "expanding"
 *   - directionalPersistence: 0..1 fraction of bars in move direction
 *   - rangeExpansion: ATR at peak / ATR at start
 *   - direction: "up" | "down"
 *
 * Source of truth for move type classification. Called by moveDetector.ts
 * during move detection and can be called independently to re-label
 * existing detected_moves rows.
 */

export type MoveType = "breakout" | "continuation" | "reversal" | "unknown";

export interface MoveLabelInput {
  direction: "up" | "down";
  leadInShape: string;
  directionalPersistence: number;
  rangeExpansion: number;
  movePct: number;
}

/**
 * Label a structural move deterministically.
 *
 * Rules (applied in priority order):
 * 1. BREAKOUT: rangeExpansion >= 1.5 AND directionalPersistence >= 0.65
 *    → Strong directional thrust from compression or ranging baseline
 * 2. CONTINUATION: leadInShape === "trending" AND directionalPersistence >= 0.60
 *    → Move continues an established prior trend
 * 3. REVERSAL: leadInShape is "trending" with opposite character implied by low persistence
 *    → leadInShape === "trending" AND directionalPersistence < 0.45
 *    → OR leadInShape === "expanding" AND rangeExpansion < 1.2 AND directionalPersistence < 0.50
 * 4. UNKNOWN: all other cases — not enough structural signature
 */
export function labelMove(input: MoveLabelInput): MoveType {
  const { leadInShape, directionalPersistence, rangeExpansion } = input;

  // Priority 1: Breakout — strong expansion + high directional persistence
  if (rangeExpansion >= 1.5 && directionalPersistence >= 0.65) {
    return "breakout";
  }

  // Priority 2: Continuation — trending lead-in + directionally persistent move
  if (leadInShape === "trending" && directionalPersistence >= 0.60) {
    return "continuation";
  }

  // Priority 3: Reversal — trending lead-in but low directional persistence
  //             (move went against prevailing direction) or expanding with pullback
  if (
    (leadInShape === "trending" && directionalPersistence < 0.45) ||
    (leadInShape === "expanding" && rangeExpansion < 1.2 && directionalPersistence < 0.50)
  ) {
    return "reversal";
  }

  // Priority 4: Breakout from compressing or ranging lead-in with moderate expansion
  if (
    (leadInShape === "compressing" || leadInShape === "ranging") &&
    rangeExpansion >= 1.2 &&
    directionalPersistence >= 0.55
  ) {
    return "breakout";
  }

  return "unknown";
}
