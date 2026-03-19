import { pgTable, serial, text, doublePrecision, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const platformStateTable = pgTable("platform_state", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlatformStateSchema = createInsertSchema(platformStateTable).omit({ id: true, updatedAt: true });
export type InsertPlatformState = z.infer<typeof insertPlatformStateSchema>;
export type PlatformState = typeof platformStateTable.$inferSelect;
