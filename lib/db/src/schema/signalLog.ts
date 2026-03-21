import { pgTable, serial, text, doublePrecision, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const signalLogTable = pgTable("signal_log", {
  id: serial("id").primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  symbol: text("symbol").notNull(),
  strategyName: text("strategy_name").notNull(),
  score: doublePrecision("score").notNull(),
  expectedValue: doublePrecision("expected_value").notNull(),
  allowedFlag: boolean("allowed_flag").notNull().default(false),
  rejectionReason: text("rejection_reason"),
  direction: text("direction"),
  suggestedSl: doublePrecision("suggested_sl"),
  suggestedTp: doublePrecision("suggested_tp"),
  aiVerdict: text("ai_verdict"),
  aiReasoning: text("ai_reasoning"),
  aiConfidenceAdj: doublePrecision("ai_confidence_adj"),
  compositeScore: doublePrecision("composite_score"),
  scoringDimensions: jsonb("scoring_dimensions"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSignalLogSchema = createInsertSchema(signalLogTable).omit({ id: true, createdAt: true });
export type InsertSignalLog = z.infer<typeof insertSignalLogSchema>;
export type SignalLog = typeof signalLogTable.$inferSelect;
