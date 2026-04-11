-- ============================================================
-- V3 RUNTIME RESET SCRIPT
-- Safe to re-run. Purges runtime/application state only.
-- NEVER touches: candles, ticks, spike_events
-- ============================================================

-- 1. PURGE stale runtime tables (order: FK child first)
DELETE FROM backtest_trades;
DELETE FROM backtest_runs;
DELETE FROM signal_log;
DELETE FROM trades;

-- 2. RESET paper_current_equity to match paper_capital (trades purged)
UPDATE platform_state SET value = '600', updated_at = NOW()
  WHERE key = 'paper_current_equity';

-- 3. DELETE stale AI suggestion keys (computed from purged trade data)
DELETE FROM platform_state WHERE key IN (
  'ai_suggest_demo_equity_pct_per_trade',
  'ai_suggest_demo_min_composite_score',
  'ai_suggest_paper_equity_pct_per_trade',
  'ai_suggest_paper_min_composite_score',
  'ai_suggest_real_equity_pct_per_trade',
  'ai_suggest_real_min_composite_score',
  'ai_optimised_at',
  'ai_suggestion_trend'
);

-- 4. DELETE stale regime caches for non-active symbols (1h TTL, March 28 = expired)
DELETE FROM platform_state WHERE key IN (
  'regime_cache_BOOM1000',
  'regime_cache_BOOM500',
  'regime_cache_BOOM600',
  'regime_cache_BOOM900',
  'regime_cache_CRASH1000',
  'regime_cache_CRASH500',
  'regime_cache_CRASH600',
  'regime_cache_CRASH900'
);

-- 5. VERIFY market history untouched (must return 3 rows with counts > 0)
SELECT 'candles' AS tbl, COUNT(*) AS cnt FROM candles
UNION ALL SELECT 'ticks', COUNT(*) FROM ticks
UNION ALL SELECT 'spike_events', COUNT(*) FROM spike_events;

-- 6. VERIFY runtime tables empty
SELECT 'backtest_runs' AS tbl, COUNT(*) AS cnt FROM backtest_runs
UNION ALL SELECT 'backtest_trades', COUNT(*) FROM backtest_trades
UNION ALL SELECT 'signal_log', COUNT(*) FROM signal_log
UNION ALL SELECT 'trades', COUNT(*) FROM trades;
