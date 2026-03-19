import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, ticksTable, candlesTable, spikeEventsTable, platformStateTable } from "@workspace/db";
import { getDerivClientWithDbToken, SUPPORTED_SYMBOLS, getEnabledSymbols } from "../lib/deriv.js";

const router: IRouter = Router();

router.post("/data/backfill", async (req, res): Promise<void> => {
  const { symbol = "BOOM1000", months = 12 } = req.body ?? {};

  if (!SUPPORTED_SYMBOLS.includes(symbol)) {
    res.status(400).json({ error: `Symbol '${symbol}' not supported. Use: ${SUPPORTED_SYMBOLS.join(", ")}` });
    return;
  }

  const monthsNum = Math.min(Math.max(Number(months) || 12, 1), 24);
  const tickCount = 5000;

  try {
    const client = await getDerivClientWithDbToken();
    await client.connect();
    const result = await client.backfill(symbol, tickCount);

    await db.insert(platformStateTable).values({ key: "last_sync_at", value: new Date().toISOString() })
      .onConflictDoUpdate({ target: platformStateTable.key, set: { value: new Date().toISOString(), updatedAt: new Date() } });

    res.json({
      success: true,
      message: `Backfill complete for ${symbol} (${monthsNum}mo requested): ${result.ticks} ticks and ${result.candles} candles stored.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, message: `Backfill failed: ${message}` });
  }
});

router.post("/data/stream/start", async (req, res): Promise<void> => {
  const enabledSymbols = await getEnabledSymbols();
  const { symbols = enabledSymbols } = req.body ?? {};

  const validSymbols = (symbols as string[]).filter(s => SUPPORTED_SYMBOLS.includes(s));
  if (validSymbols.length === 0) {
    res.status(400).json({ error: `No valid symbols provided. Supported: ${SUPPORTED_SYMBOLS.join(", ")}` });
    return;
  }

  try {
    const client = await getDerivClientWithDbToken();
    await client.startStreaming(validSymbols);
    res.json({ success: true, message: `Live tick stream started for: ${validSymbols.join(", ")}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, message: `Stream start failed: ${message}` });
  }
});

router.post("/data/stream/stop", async (_req, res): Promise<void> => {
  try {
    const client = await getDerivClientWithDbToken();
    await client.stopStreaming();
    res.json({ success: true, message: "Live tick stream stopped." });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, message: `Stream stop failed: ${message}` });
  }
});

router.get("/data/status", async (_req, res): Promise<void> => {
  const states = await db.select().from(platformStateTable);
  const stateMap: Record<string, string> = {};
  for (const s of states) stateMap[s.key] = s.value;

  const tickCountResult = await db.select({ count: sql<number>`count(*)` }).from(ticksTable);

  let streamingSymbols: string[] = [];
  try {
    const client = await getDerivClientWithDbToken();
    streamingSymbols = client.getSubscribedSymbols();
  } catch {
    streamingSymbols = (stateMap["streaming_symbols"] || "").split(",").filter(Boolean);
  }

  res.json({
    mode: stateMap["mode"] || "idle",
    streaming: stateMap["streaming"] === "true",
    lastSyncAt: stateMap["last_sync_at"] || null,
    tickCount: Number(tickCountResult[0]?.count || 0),
    symbols: streamingSymbols.length > 0 ? streamingSymbols : SUPPORTED_SYMBOLS,
  });
});

router.get("/data/ticks", async (req, res): Promise<void> => {
  const symbol = String(req.query.symbol || "BOOM1000");
  const limit = Math.min(Number(req.query.limit || 100), 1000);
  const rows = await db.select().from(ticksTable)
    .where(eq(ticksTable.symbol, symbol))
    .orderBy(desc(ticksTable.epochTs))
    .limit(limit);
  res.json(rows.map(r => ({
    id: r.id,
    symbol: r.symbol,
    epochTs: r.epochTs,
    quote: r.quote,
    createdAt: r.createdAt.toISOString(),
  })));
});

router.get("/data/candles", async (req, res): Promise<void> => {
  const symbol = String(req.query.symbol || "BOOM1000");
  const timeframe = String(req.query.timeframe || "1m");
  const limit = Math.min(Number(req.query.limit || 200), 1000);
  const rows = await db.select().from(candlesTable)
    .where(eq(candlesTable.symbol, symbol))
    .orderBy(desc(candlesTable.openTs))
    .limit(limit);
  res.json(rows.map(r => ({
    id: r.id,
    symbol: r.symbol,
    timeframe: r.timeframe,
    openTs: r.openTs,
    closeTs: r.closeTs,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    tickCount: r.tickCount,
  })));
});

router.get("/data/spikes", async (req, res): Promise<void> => {
  const symbol = String(req.query.symbol || "BOOM1000");
  const limit = Math.min(Number(req.query.limit || 50), 500);
  const rows = await db.select().from(spikeEventsTable)
    .where(eq(spikeEventsTable.symbol, symbol))
    .orderBy(desc(spikeEventsTable.eventTs))
    .limit(limit);
  res.json(rows.map(r => ({
    id: r.id,
    symbol: r.symbol,
    eventTs: r.eventTs,
    direction: r.direction,
    spikeSize: r.spikeSize,
    ticksSincePreviousSpike: r.ticksSincePreviousSpike,
  })));
});

export default router;
