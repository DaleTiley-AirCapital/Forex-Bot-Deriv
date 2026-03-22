import { relations } from "drizzle-orm/relations";
import { backtestRuns, backtestTrades } from "./schema";

export const backtestTradesRelations = relations(backtestTrades, ({one}) => ({
	backtestRun: one(backtestRuns, {
		fields: [backtestTrades.backtestRunId],
		references: [backtestRuns.id]
	}),
}));

export const backtestRunsRelations = relations(backtestRuns, ({many}) => ({
	backtestTrades: many(backtestTrades),
}));