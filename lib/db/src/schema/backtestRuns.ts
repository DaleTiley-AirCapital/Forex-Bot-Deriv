import { pgTable, serial, text, doublePrecision, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const backtestRunsTable = pgTable("backtest_runs", {
  id: serial("id").primaryKey(),
  strategyName: text("strategy_name").notNull(),
  symbol: text("symbol").notNull(),
  initialCapital: doublePrecision("initial_capital").notNull().default(10000),
  totalReturn: doublePrecision("total_return"),
  netProfit: doublePrecision("net_profit"),
  winRate: doublePrecision("win_rate"),
  profitFactor: doublePrecision("profit_factor"),
  maxDrawdown: doublePrecision("max_drawdown"),
  tradeCount: integer("trade_count"),
  avgHoldingHours: doublePrecision("avg_holding_hours"),
  expectancy: doublePrecision("expectancy"),
  sharpeRatio: doublePrecision("sharpe_ratio"),
  configJson: jsonb("config_json"),
  metricsJson: jsonb("metrics_json"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBacktestRunSchema = createInsertSchema(backtestRunsTable).omit({ id: true, createdAt: true });
export type InsertBacktestRun = z.infer<typeof insertBacktestRunSchema>;
export type BacktestRun = typeof backtestRunsTable.$inferSelect;
