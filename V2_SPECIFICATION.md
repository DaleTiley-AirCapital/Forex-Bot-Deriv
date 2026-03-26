# V2 Specification — Dynamic Trade Management

> This document describes all V2 changes implemented on top of V1. V1_SPECIFICATION.md is preserved unchanged.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [TP/SL: S/R + Fibonacci Confluence](#2-tpsl-sr--fibonacci-confluence)
3. [Trailing Stop: Profit-Based](#3-trailing-stop-profit-based)
4. [Time Exits](#4-time-exits)
5. [Regime Engine: Hourly Caching + Ranging](#5-regime-engine-hourly-caching--ranging)
6. [Scoring Updates](#6-scoring-updates)
7. [Entry Simplification](#7-entry-simplification)
8. [Removed V1 Concepts](#8-removed-v1-concepts)
9. [Settings Inventory (V2)](#9-settings-inventory-v2)
10. [Backtest Engine Alignment](#10-backtest-engine-alignment)
11. [AI Integration Updates](#11-ai-integration-updates)
12. [File-by-File Change Summary](#12-file-by-file-change-summary)

---

## 1. Design Philosophy

V2 replaces V1's static ATR-multiplier trade management with dynamic, market-structure-aware logic. The core principles:

- **Large capital, long hold, max profit.** Swing trades on highest-probability signals only.
- **TP/SL derived from actual market structure** (swing highs/lows, Fibonacci levels, Bollinger Bands) — not fixed ATR multiples.
- **Trailing stop protects realized profit** — trails at 30% below peak unrealized profit percentage, not price.
- **Simplified time exits** — 72h profitable close, 168h hard cap. No extension logic.
- **One position per symbol.** No multi-stage building (probe/confirmation/momentum removed).
- **AI never auto-changes settings.** Blocked signals get `aiVerdict="skipped"`.

---

## 2. TP/SL: S/R + Fibonacci Confluence

### Feature Vector Additions (`features.ts`)

New fields computed in `computeFeatures()`:

| Field | Type | Description |
|---|---|---|
| `swingHigh` | `number` | Highest high in lookback window (50 candles) |
| `swingLow` | `number` | Lowest low in lookback window |
| `fibRetraceLevels` | `number[]` | Fibonacci retracement levels: 23.6%, 38.2%, 50%, 61.8%, 78.6% between swing low and swing high |
| `fibExtensionLevels` | `number[]` | Fibonacci extension levels: 127.2%, 161.8%, 200% projected beyond swing range |
| `bbUpper` | `number` | Upper Bollinger Band value |
| `bbLower` | `number` | Lower Bollinger Band value |

### `calculateSRFibTP()` (`tradeEngine.ts`)

For **buy** trades:
1. Collect candidates: swing high, all fib extension levels, BB upper.
2. Filter to candidates **above** entry price.
3. Find the level closest to entry price (nearest resistance above).
4. Apply 0.2% buffer inside the level: `tp = level * 0.998`.
5. Floor: `tp >= entry * (1 + 3 * atrPct)`.
6. Fallback (no candidates): `tp = entry * (1 + 6 * atrPct)`.

For **sell** trades: mirror logic using candidates below entry, fib extensions projected downward.

### `calculateSRFibSL()` (`tradeEngine.ts`)

For **buy** trades:
1. Collect candidates: swing low, all fib retrace levels, BB lower.
2. Filter to candidates **below** entry price.
3. Find the level closest to entry price (nearest support below).
4. Apply 0.2% buffer outside the level: `sl = level * 0.998`.
5. Safety floor: `sl = max(sl, entry * (1 - 0.10 * equity / positionSize))` — caps loss at 10% of equity.
6. Fallback (no candidates): `sl = entry * (1 - 2.5 * atrPct)`.

For **sell** trades: mirror logic.

### Strategy-Level Integration (`strategies.ts`)

Strategy functions (`trendContinuation`, `meanReversion`, `breakoutExpansion`, `spikeEvent`) set `suggestedTp` and `suggestedSl` to `null` — TP/SL are computed later at execution time by `calculateSRFibTP`/`calculateSRFibSL` in the trade engine and backtest engine, where the entry price and position size are known.

---

## 3. Trailing Stop: Profit-Based

### `calculateProfitTrailingStop()` (`tradeEngine.ts`)

Replaces the old price-based trailing stop with profit-percentage trailing:

- **Peak tracking:** Tracks the highest unrealized profit percentage reached.
- **Activation:** Only activates when trade is **in profit** (unrealized P&L > 0).
- **Drawdown threshold:** 30% drawdown from peak profit triggers close.
  - Example: Peak profit was 10%. Current profit drops to 7% → drawdown = 30% → close.
- **Below breakeven:** If current price is at or below breakeven, returns the original S/R-based SL (no trailing).

### Constants

| Constant | Value | Description |
|---|---|---|
| `PROFIT_TRAIL_DRAWDOWN_PCT` | 0.30 | 30% drawdown from peak profit |

---

## 4. Time Exits

### Constants

| Constant | Value | Description |
|---|---|---|
| `TIME_EXIT_PROFIT_HOURS` | 72 | Close if profitable after 72h |
| `TIME_EXIT_HARD_CAP_HOURS` | 168 | Force close after 168h regardless |

### Logic (`evaluateTimeExit()` in `tradeEngine.ts`)

1. If position held ≥ 168h → force close (`"time_exit_hard_cap"`).
2. If position held ≥ 72h AND currently profitable → close (`"time_exit_profit"`).
3. If position held ≥ 72h AND currently at a loss → keep open (wait for profit or 168h cap).

### Removed

- `INITIAL_EXIT_HOURS`, `EXTENSION_HOURS`, `MAX_EXIT_HOURS` constants.
- Extension logic for near-breakeven trades.
- Per-family hold profiles (`FAMILY_HOLD_PROFILE`).

---

## 5. Regime Engine: Hourly Caching + Ranging

### Hourly Caching (`regimeEngine.ts` + `scheduler.ts`)

- Regime is computed once per symbol per hour and cached in `platform_state` with key `regime_cache_{symbol}`.
- Cache includes: `regime`, `confidence`, `timestamp`.
- `getCachedRegime(symbol)` returns cached regime if < 1 hour old; otherwise returns `null`.
- `cacheRegime(symbol, regime, confidence)` stores the result.
- The scanner loop in `scheduler.ts` calls `getCachedRegime()` first and only computes regime fresh on cache miss.

### "Ranging" Regime

Added `"ranging"` to the `RegimeType` union. Detected when:
- EMA slope is flat (< 0.0003 absolute).
- BB width is moderate (0.005–0.015).
- No spike hazard (< 0.50).
- Z-score is moderate (< 1.5 absolute).

### Strategy Permission Matrix

`STRATEGY_PERMISSION_MATRIX` updated:
- `mean_reversion` and `spike_event` strategies are now also allowed in `"ranging"` regime.
- `trend_continuation` allowed in: `trend_up`, `trend_down`, `breakout_expansion`.
- `breakout_expansion` allowed in: `compression`, `breakout_expansion`, `high_volatility`.

---

## 6. Scoring Updates

### `FAMILY_IDEAL_REGIMES` (`scoring.ts`)

Updated to include `"ranging"` for families that benefit from it:

| Family | Ideal Regimes |
|---|---|
| `trend_continuation` | `trend_up`, `trend_down`, `breakout_expansion` |
| `mean_reversion` | `mean_reversion`, `ranging` |
| `breakout_expansion` | `compression`, `breakout_expansion`, `trend_up`, `trend_down` |
| `spike_event` | `spike_zone`, `ranging` |

### Regime Data Source

Regime fit, trend alignment, and volatility condition scores use the hourly-cached regime from `platform_state`. Setup quality, reward/risk, and probability of success are computed per-signal in real time.

---

## 7. Entry Simplification

### One Position Per Symbol

- No more probe/confirmation/momentum stages.
- Each symbol gets at most one open position.
- Position size = `equity_pct_per_trade` (from settings) × equity.

### Signal Quality Gates

Signals must pass these minimum thresholds (configurable per mode in settings):

| Setting | Paper | Demo | Real |
|---|---|---|---|
| `min_composite_score` | 80 | 85 | 90 |
| `min_ev_threshold` | 0.003 | 0.003 | 0.003 |
| `min_rr_ratio` | 3.0 | 3.0 | 3.0 |

---

## 8. Removed V1 Concepts

### Settings Removed

| Setting | Reason |
|---|---|
| `tp_multiplier_strong/medium/weak` | Replaced by S/R + Fib TP |
| `sl_ratio` | Replaced by S/R + Fib SL |
| `tp_capture_ratio` | No longer applicable |
| `min_sl_atr_multiplier` | SL uses S/R levels, min = 3×ATR built in |
| `trailing_stop_pct` | Replaced by 30% profit trailing |
| `peak_drawdown_exit_pct` | Replaced by profit trailing |
| `min_peak_profit_pct` | Removed (trailing activates on any profit) |
| `large_peak_threshold_pct` | Removed |
| `time_exit_window_hours` | Replaced by 72h/168h constants |
| `probe_threshold` | No entry stages |
| `confirmation_threshold` | No entry stages |
| `momentum_threshold` | No entry stages |
| `stage_multiplier_probe/confirmation/momentum` | No entry stages |
| All per-family overrides (`*_tp_atr_multiplier`, `*_sl_atr_multiplier`, `*_initial_exit_hours`, `*_extension_hours`, `*_max_exit_hours`, `*_harvest_sensitivity`) | Trade management is now universal |

### Code Removed

| Concept | Files Affected |
|---|---|
| `evaluateProfitHarvest()` | `tradeEngine.ts` |
| `calculateTrailingStop()` (price-based) | `tradeEngine.ts` |
| `calculateDynamicTP()` / `calculateInitialSL()` | `tradeEngine.ts` |
| `FAMILY_HOLD_PROFILE` | `tradeEngine.ts` |
| Entry stage logic (probe/confirmation/momentum) | `signalRouter.ts`, `extractionEngine.ts` |
| `FamilyProfileSection` UI component | `settings.tsx` |
| Per-family config sections in UI | `settings.tsx` |

---

## 9. Settings Inventory (V2)

### Configurable Settings (Per Mode)

| Setting | Paper Default | Demo Default | Real Default | Description |
|---|---|---|---|---|
| `capital` | 10000 | 600 | 600 | Starting capital |
| `equity_pct_per_trade` | 30 | 20 | 15 | % of equity per position |
| `max_open_trades` | 4 | 3 | 3 | Max simultaneous positions |
| `allocation_mode` | aggressive | balanced | balanced | Capital deployment aggressiveness |
| `min_composite_score` | 80 | 85 | 90 | Min composite score for entry |
| `min_ev_threshold` | 0.003 | 0.003 | 0.003 | Min expected value |
| `min_rr_ratio` | 3.0 | 3.0 | 3.0 | Min reward-to-risk ratio |
| `max_daily_loss_pct` | 8 | 5 | 3 | Daily loss limit |
| `max_weekly_loss_pct` | 15 | 10 | 6 | Weekly loss limit |
| `max_drawdown_pct` | 25 | 18 | 12 | Kill switch drawdown |
| `extraction_target_pct` | 50 | 50 | 50 | Profit extraction target |
| `auto_extraction` | false | false | false | Auto-extract toggle |
| `correlated_family_cap` | 4 | 3 | 3 | Max trades per instrument family |

### Non-Configurable Constants (Hardcoded in V2)

| Constant | Value | Location |
|---|---|---|
| `PROFIT_TRAIL_DRAWDOWN_PCT` | 0.30 | `tradeEngine.ts` |
| `TIME_EXIT_PROFIT_HOURS` | 72 | `tradeEngine.ts` |
| `TIME_EXIT_HARD_CAP_HOURS` | 168 | `tradeEngine.ts` |
| S/R buffer | 0.2% | `calculateSRFibTP/SL` |
| Min TP distance | 3 × ATR | `calculateSRFibTP` |
| Fallback TP distance | 6 × ATR | `calculateSRFibTP` |
| Fallback SL distance | 2.5 × ATR | `calculateSRFibSL` |
| Safety floor SL | 10% equity | `calculateSRFibSL` |
| Regime cache TTL | 1 hour | `regimeEngine.ts` |

---

## 10. Backtest Engine Alignment

The backtest engine (`backtestEngine.ts`) mirrors all V2 logic:

- Uses `calculateSRFibTP` and `calculateSRFibSL` for entry TP/SL.
- Uses `calculateProfitTrailingStop` for trailing.
- Time exits: 72h profit close, 168h hard cap.
- Feature computation includes `swingHigh`, `swingLow`, `fibRetraceLevels`, `fibExtensionLevels`, `bbUpper`, `bbLower`.
- Removed: old ATR-based SL/TP, `calculateTrailingStop`, `INITIAL_EXIT_HOURS`/`EXTENSION_HOURS`/`MAX_EXIT_HOURS`.

---

## 11. AI Integration Updates

### Signal Verification Prompt (`openai.ts`)

- Removed `entryStage` from the `SignalContext` interface.
- AI prompt updated to reflect V2 trade management:
  - References S/R + Fibonacci TP/SL.
  - References 30% profit trailing stop.
  - References 72h/168h time exits.
  - No longer mentions entry stages or profit harvesting.

### AI Mandate

- AI **never** auto-changes settings.
- Blocked signals receive `aiVerdict="skipped"`.
- AI provides analysis and recommendations only.

---

## 12. File-by-File Change Summary

| File | Changes |
|---|---|
| `features.ts` | Added `swingHigh`, `swingLow`, `fibRetraceLevels`, `fibExtensionLevels`, `bbUpper`, `bbLower` to `FeatureVector` and `computeFeatures()` |
| `regimeEngine.ts` | Added `"ranging"` regime, hourly caching via `getCachedRegime`/`cacheRegime`, updated `STRATEGY_PERMISSION_MATRIX` |
| `strategies.ts` | Replaced ATR-based SL/TP with `calculateSRFibTP`/`calculateSRFibSL` calls; removed `FAMILY_CONFIG.slMultiple`/`tpMultiple` usage |
| `tradeEngine.ts` | Added `calculateSRFibTP`, `calculateSRFibSL`, `calculateProfitTrailingStop`; removed `calculateDynamicTP`, `calculateInitialSL`, `calculateTrailingStop`, `evaluateProfitHarvest`, `FAMILY_HOLD_PROFILE`; simplified time exits |
| `signalRouter.ts` | Removed entry stage logic (probe/confirmation/momentum) |
| `extractionEngine.ts` | Removed entry stage references |
| `scoring.ts` | Updated `FAMILY_IDEAL_REGIMES` to include `"ranging"` |
| `backtestEngine.ts` | Mirrored all V2 changes: S/R+Fib TP/SL, profit trailing, simplified time exits |
| `scheduler.ts` | Integrated regime caching in scanner; removed V1 setting references |
| `openai.ts` | Updated `SignalContext` interface and AI prompt for V2 |
| `settings.tsx` | Removed V1 settings from defaults and UI; added Signal Quality Thresholds and Trade Management info card |

---

*V1_SPECIFICATION.md is preserved unchanged as historical reference.*
