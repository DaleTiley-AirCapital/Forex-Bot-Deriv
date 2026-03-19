import { pgTable, serial, text, doublePrecision, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const featuresTable = pgTable("features", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  ts: doublePrecision("ts").notNull(),
  featureJson: jsonb("feature_json").notNull(),
  regimeLabel: text("regime_label"),
  targetLabel: text("target_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFeatureSchema = createInsertSchema(featuresTable).omit({ id: true, createdAt: true });
export type InsertFeature = z.infer<typeof insertFeatureSchema>;
export type Feature = typeof featuresTable.$inferSelect;
