import { pgTable, serial, text, doublePrecision, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const modelRunsTable = pgTable("model_runs", {
  id: serial("id").primaryKey(),
  modelName: text("model_name").notNull(),
  symbol: text("symbol").notNull(),
  trainingWindow: integer("training_window").notNull(),
  accuracy: doublePrecision("accuracy"),
  precision: doublePrecision("precision"),
  recall: doublePrecision("recall"),
  f1Score: doublePrecision("f1_score"),
  metricsJson: jsonb("metrics_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertModelRunSchema = createInsertSchema(modelRunsTable).omit({ id: true, createdAt: true });
export type InsertModelRun = z.infer<typeof insertModelRunSchema>;
export type ModelRun = typeof modelRunsTable.$inferSelect;
