import { pgTable, serial, integer, text, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { backtestRunsTable } from "./backtestRuns";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const backtestTradesTable = pgTable("backtest_trades", {
  id: serial("id").primaryKey(),
  backtestRunId: integer("backtest_run_id").notNull().references(() => backtestRunsTable.id),
  entryTs: timestamp("entry_ts", { withTimezone: true }).notNull(),
  exitTs: timestamp("exit_ts", { withTimezone: true }),
  direction: text("direction").notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  exitPrice: doublePrecision("exit_price"),
  pnl: doublePrecision("pnl"),
  exitReason: text("exit_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBacktestTradeSchema = createInsertSchema(backtestTradesTable).omit({ id: true, createdAt: true });
export type InsertBacktestTrade = z.infer<typeof insertBacktestTradeSchema>;
export type BacktestTrade = typeof backtestTradesTable.$inferSelect;
