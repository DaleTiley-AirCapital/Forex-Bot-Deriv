-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "candles" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"timeframe" text NOT NULL,
	"open_ts" double precision NOT NULL,
	"close_ts" double precision NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"tick_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spike_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"event_ts" double precision NOT NULL,
	"direction" text NOT NULL,
	"spike_size" double precision NOT NULL,
	"ticks_since_previous_spike" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"ts" double precision NOT NULL,
	"feature_json" jsonb NOT NULL,
	"regime_label" text,
	"target_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticks" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"epoch_ts" double precision NOT NULL,
	"quote" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"broker_trade_id" text,
	"symbol" text NOT NULL,
	"strategy_name" text NOT NULL,
	"side" text NOT NULL,
	"entry_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"exit_ts" timestamp with time zone,
	"entry_price" double precision NOT NULL,
	"exit_price" double precision,
	"sl" double precision NOT NULL,
	"tp" double precision NOT NULL,
	"size" double precision NOT NULL,
	"pnl" double precision,
	"status" text DEFAULT 'open' NOT NULL,
	"mode" text DEFAULT 'paper' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence" double precision,
	"trailing_stop_pct" double precision,
	"peak_price" double precision,
	"max_exit_ts" timestamp with time zone,
	"exit_reason" text,
	"current_price" double precision
);
--> statement-breakpoint
CREATE TABLE "platform_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_state_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "backtest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"strategy_name" text NOT NULL,
	"symbol" text NOT NULL,
	"initial_capital" double precision DEFAULT 10000 NOT NULL,
	"total_return" double precision,
	"net_profit" double precision,
	"win_rate" double precision,
	"profit_factor" double precision,
	"max_drawdown" double precision,
	"trade_count" integer,
	"avg_holding_hours" double precision,
	"expectancy" double precision,
	"sharpe_ratio" double precision,
	"config_json" jsonb,
	"metrics_json" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_name" text NOT NULL,
	"symbol" text NOT NULL,
	"training_window" integer NOT NULL,
	"accuracy" double precision,
	"precision" double precision,
	"recall" double precision,
	"f1_score" double precision,
	"metrics_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"symbol" text NOT NULL,
	"strategy_name" text NOT NULL,
	"score" double precision NOT NULL,
	"expected_value" double precision NOT NULL,
	"allowed_flag" boolean DEFAULT false NOT NULL,
	"rejection_reason" text,
	"direction" text,
	"suggested_sl" double precision,
	"suggested_tp" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ai_verdict" text,
	"ai_reasoning" text,
	"ai_confidence_adj" double precision,
	"composite_score" double precision,
	"scoring_dimensions" jsonb,
	"mode" text,
	"regime" text,
	"regime_confidence" double precision,
	"strategy_family" text,
	"sub_strategy" text,
	"allocation_pct" double precision,
	"execution_status" text
);
--> statement-breakpoint
CREATE TABLE "backtest_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"backtest_run_id" integer NOT NULL,
	"entry_ts" timestamp with time zone NOT NULL,
	"exit_ts" timestamp with time zone,
	"direction" text NOT NULL,
	"entry_price" double precision NOT NULL,
	"exit_price" double precision,
	"pnl" double precision,
	"exit_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_backtest_run_id_backtest_runs_id_fk" FOREIGN KEY ("backtest_run_id") REFERENCES "public"."backtest_runs"("id") ON DELETE no action ON UPDATE no action;
*/