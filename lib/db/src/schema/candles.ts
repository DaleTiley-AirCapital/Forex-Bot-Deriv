import { pgTable, serial, text, doublePrecision, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const candlesTable = pgTable("candles", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  openTs: doublePrecision("open_ts").notNull(),
  closeTs: doublePrecision("close_ts").notNull(),
  open: doublePrecision("open").notNull(),
  high: doublePrecision("high").notNull(),
  low: doublePrecision("low").notNull(),
  close: doublePrecision("close").notNull(),
  tickCount: integer("tick_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_candles_symbol_tf_ts_unique").on(table.symbol, table.timeframe, table.openTs),
]);

export const insertCandleSchema = createInsertSchema(candlesTable).omit({ id: true, createdAt: true });
export type InsertCandle = z.infer<typeof insertCandleSchema>;
export type Candle = typeof candlesTable.$inferSelect;
