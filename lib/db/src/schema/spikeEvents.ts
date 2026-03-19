import { pgTable, serial, text, doublePrecision, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const spikeEventsTable = pgTable("spike_events", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  eventTs: doublePrecision("event_ts").notNull(),
  direction: text("direction").notNull(),
  spikeSize: doublePrecision("spike_size").notNull(),
  ticksSincePreviousSpike: integer("ticks_since_previous_spike"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSpikeEventSchema = createInsertSchema(spikeEventsTable).omit({ id: true, createdAt: true });
export type InsertSpikeEvent = z.infer<typeof insertSpikeEventSchema>;
export type SpikeEvent = typeof spikeEventsTable.$inferSelect;
