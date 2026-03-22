import { sql } from "drizzle-orm";
import { db, platformStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "./app.js";
import { getDerivClientWithDbToken, getEnabledSymbols, SUPPORTED_SYMBOLS } from "./lib/deriv.js";
import { startScheduler } from "./lib/scheduler.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Ensure all database tables exist before the server starts.
 * Uses CREATE TABLE IF NOT EXISTS so it is safe to run on every boot —
 * existing data is never touched.
 */
async function initDb(): Promise<void> {
  console.log("[DB] Running schema initialisation...");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ticks (
      id         SERIAL PRIMARY KEY,
      symbol     TEXT NOT NULL,
      epoch_ts   DOUBLE PRECISION NOT NULL,
      quote      DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ticks_symbol_ts ON ticks (symbol, epoch_ts DESC);

    CREATE TABLE IF NOT EXISTS candles (
      id         SERIAL PRIMARY KEY,
      symbol     TEXT NOT NULL,
      timeframe  TEXT NOT NULL,
      open_ts    DOUBLE PRECISION NOT NULL,
      close_ts   DOUBLE PRECISION NOT NULL,
      open       DOUBLE PRECISION NOT NULL,
      high       DOUBLE PRECISION NOT NULL,
      low        DOUBLE PRECISION NOT NULL,
      close      DOUBLE PRECISION NOT NULL,
      tick_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_candles_symbol_tf_ts ON candles (symbol, timeframe, open_ts DESC);

    CREATE TABLE IF NOT EXISTS spike_events (
      id                         SERIAL PRIMARY KEY,
      symbol                     TEXT NOT NULL,
      event_ts                   DOUBLE PRECISION NOT NULL,
      direction                  TEXT NOT NULL,
      spike_size                 DOUBLE PRECISION NOT NULL,
      ticks_since_previous_spike INTEGER,
      created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_spikes_symbol_ts ON spike_events (symbol, event_ts DESC);

    CREATE TABLE IF NOT EXISTS features (
      id           SERIAL PRIMARY KEY,
      symbol       TEXT NOT NULL,
      ts           DOUBLE PRECISION NOT NULL,
      feature_json JSONB NOT NULL,
      regime_label TEXT,
      target_label TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_features_symbol_ts ON features (symbol, ts DESC);

    CREATE TABLE IF NOT EXISTS model_runs (
      id              SERIAL PRIMARY KEY,
      model_name      TEXT NOT NULL,
      symbol          TEXT NOT NULL,
      training_window INTEGER NOT NULL,
      accuracy        DOUBLE PRECISION,
      precision       DOUBLE PRECISION,
      recall          DOUBLE PRECISION,
      f1_score        DOUBLE PRECISION,
      metrics_json    JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS backtest_runs (
      id                SERIAL PRIMARY KEY,
      strategy_name     TEXT NOT NULL,
      symbol            TEXT NOT NULL,
      initial_capital   DOUBLE PRECISION NOT NULL DEFAULT 10000,
      total_return      DOUBLE PRECISION,
      net_profit        DOUBLE PRECISION,
      win_rate          DOUBLE PRECISION,
      profit_factor     DOUBLE PRECISION,
      max_drawdown      DOUBLE PRECISION,
      trade_count       INTEGER,
      avg_holding_hours DOUBLE PRECISION,
      expectancy        DOUBLE PRECISION,
      sharpe_ratio      DOUBLE PRECISION,
      config_json       JSONB,
      metrics_json      JSONB,
      status            TEXT NOT NULL DEFAULT 'pending',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trades (
      id              SERIAL PRIMARY KEY,
      broker_trade_id TEXT,
      symbol          TEXT NOT NULL,
      strategy_name   TEXT NOT NULL,
      side            TEXT NOT NULL,
      entry_ts        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      exit_ts         TIMESTAMPTZ,
      entry_price     DOUBLE PRECISION NOT NULL,
      exit_price      DOUBLE PRECISION,
      sl              DOUBLE PRECISION NOT NULL,
      tp              DOUBLE PRECISION NOT NULL,
      size            DOUBLE PRECISION NOT NULL,
      pnl             DOUBLE PRECISION,
      status          TEXT NOT NULL DEFAULT 'open',
      mode            TEXT NOT NULL DEFAULT 'paper',
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades (status);

    CREATE TABLE IF NOT EXISTS signal_log (
      id               SERIAL PRIMARY KEY,
      ts               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      symbol           TEXT NOT NULL,
      strategy_name    TEXT NOT NULL,
      score            DOUBLE PRECISION NOT NULL,
      expected_value   DOUBLE PRECISION NOT NULL,
      allowed_flag     BOOLEAN NOT NULL DEFAULT FALSE,
      rejection_reason TEXT,
      direction        TEXT,
      suggested_sl     DOUBLE PRECISION,
      suggested_tp     DOUBLE PRECISION,
      ai_verdict       TEXT,
      ai_reasoning     TEXT,
      ai_confidence_adj DOUBLE PRECISION,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_signals_ts ON signal_log (ts DESC);

    ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS ai_verdict TEXT;
    ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS ai_reasoning TEXT;
    ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS ai_confidence_adj DOUBLE PRECISION;
    ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS composite_score DOUBLE PRECISION;
    ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS scoring_dimensions JSONB;
    ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS mode TEXT;
    ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS regime TEXT;
    ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS regime_confidence DOUBLE PRECISION;
    ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS strategy_family TEXT;
    ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS sub_strategy TEXT;
    ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS allocation_pct DOUBLE PRECISION;
    ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS execution_status TEXT;

    CREATE TABLE IF NOT EXISTS platform_state (
      id         SERIAL PRIMARY KEY,
      key        TEXT NOT NULL UNIQUE,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Seed default platform configuration (only if table is empty)
    INSERT INTO platform_state (key, value)
    SELECT * FROM (VALUES
      ('mode',                'idle'),
      ('kill_switch',         'false'),
      ('allocation_mode',     'balanced'),
      ('total_capital',       '10000'),
      ('max_daily_loss_pct',  '3'),
      ('max_weekly_loss_pct', '8'),
      ('max_drawdown_pct',    '15'),
      ('max_open_trades',     '4'),
      ('disabled_strategies', '')
    ) AS defaults(key, value)
    WHERE NOT EXISTS (SELECT 1 FROM platform_state LIMIT 1);
  `);
  console.log("[DB] Schema ready.");
}

async function autoConfigureAI(): Promise<void> {
  try {
    const aiRows = await db.select().from(platformStateTable).where(eq(platformStateTable.key, "ai_verification_enabled"));
    if (aiRows.length > 0) return;

    const keyRows = await db.select().from(platformStateTable).where(eq(platformStateTable.key, "openai_api_key"));
    const hasKey = keyRows.length > 0 && keyRows[0].value && keyRows[0].value.length > 10;
    const defaultValue = hasKey ? "true" : "false";

    await db.insert(platformStateTable).values({ key: "ai_verification_enabled", value: defaultValue })
      .onConflictDoNothing();
    console.log(`[AutoConfig] AI verification default: ${defaultValue} (OpenAI key ${hasKey ? "present" : "absent"})`);
  } catch (err) {
    console.warn("[AutoConfig] Could not configure AI default:", err instanceof Error ? err.message : err);
  }
}

async function autoEnablePaperMode(): Promise<void> {
  try {
    const rows = await db.select().from(platformStateTable);
    const stateMap: Record<string, string> = {};
    for (const r of rows) stateMap[r.key] = r.value;
    const anyActive = stateMap["paper_mode_active"] === "true" ||
                      stateMap["demo_mode_active"] === "true" ||
                      stateMap["real_mode_active"] === "true";
    if (!anyActive) {
      await db.insert(platformStateTable).values({ key: "paper_mode_active", value: "true" })
        .onConflictDoUpdate({ target: platformStateTable.key, set: { value: "true", updatedAt: new Date() } });
      console.log("[AutoStart] Paper mode auto-enabled (no active modes found)");
    }
  } catch (err) {
    console.warn("[AutoStart] Could not auto-enable paper mode:", err instanceof Error ? err.message : err);
  }
}

async function autoStartStreaming(): Promise<void> {
  try {
    await autoConfigureAI();
    await autoEnablePaperMode();

    const rows = await db.select().from(platformStateTable).where(eq(platformStateTable.key, "streaming"));
    const explicitlyStopped = rows.length > 0 && rows[0].value === "false";
    if (explicitlyStopped) {
      console.log("[AutoStart] Streaming explicitly stopped — skipping auto-start. Use UI to start.");
      return;
    }
    const enabledSymbols = await getEnabledSymbols();
    const validSymbols = enabledSymbols.filter(s => SUPPORTED_SYMBOLS.includes(s));
    if (validSymbols.length === 0) {
      console.log("[AutoStart] No valid symbols to stream");
      return;
    }
    const client = await getDerivClientWithDbToken();
    await client.startStreaming(validSymbols);
    console.log(`[AutoStart] Streaming started for ${validSymbols.length} symbols`);
  } catch (err) {
    console.warn("[AutoStart] Could not auto-start streaming:", err instanceof Error ? err.message : err);
  }
}

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`  Deriv Capital Extraction App v1`);
      console.log(`  Port: ${port} | ENV: ${process.env.NODE_ENV || "development"}`);
      console.log(`  Health: /api/healthz`);
      console.log(`  Deployable symbols: 12 (Boom/Crash + R_75/R_100)`);
      console.log(`  Strategy families: 4 (trend_continuation, mean_reversion, breakout_expansion, spike_event)`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      startScheduler();
      autoStartStreaming();
    });
  })
  .catch((err) => {
    console.error("[DB] Initialisation failed:", err);
    process.exit(1);
  });
