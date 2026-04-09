import { pgTable, serial, text, doublePrecision, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ticksTable = pgTable("ticks", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  epochTs: doublePrecision("epoch_ts").notNull(),
  quote: doublePrecision("quote").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_ticks_symbol_epoch_unique").on(table.symbol, table.epochTs),
]);

export const insertTickSchema = createInsertSchema(ticksTable).omit({ id: true, createdAt: true });
export type InsertTick = z.infer<typeof insertTickSchema>;
export type Tick = typeof ticksTable.$inferSelect;
