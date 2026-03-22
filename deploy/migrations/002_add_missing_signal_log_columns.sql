-- Add missing columns to signal_log table (match Drizzle schema)
ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS mode TEXT;
ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS regime TEXT;
ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS regime_confidence DOUBLE PRECISION;
ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS strategy_family TEXT;
ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS sub_strategy TEXT;
ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS allocation_pct DOUBLE PRECISION;
ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS execution_status TEXT;

-- Add missing backtest_trades table
CREATE TABLE IF NOT EXISTS backtest_trades (
  id               SERIAL PRIMARY KEY,
  backtest_run_id  INTEGER NOT NULL REFERENCES backtest_runs(id),
  entry_ts         TIMESTAMPTZ NOT NULL,
  exit_ts          TIMESTAMPTZ,
  direction        TEXT NOT NULL,
  entry_price      DOUBLE PRECISION NOT NULL,
  exit_price       DOUBLE PRECISION,
  pnl              DOUBLE PRECISION,
  exit_reason      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
