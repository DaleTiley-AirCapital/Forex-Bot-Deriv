import { Router, type IRouter } from "express";
import { db, platformStateTable } from "@workspace/db";
import { getDerivClientWithDbToken } from "../lib/deriv.js";

const router: IRouter = Router();

async function getAccountData(res: import("express").Response): Promise<void> {
  try {
    const client = await getDerivClientWithDbToken();

    if (!client.isStreaming()) {
      try {
        await client.connect();
      } catch {
        res.json({
          connected: false,
          balance: null,
          currency: null,
          equity: null,
          margin: null,
          free_margin: null,
          margin_level_pct: null,
          loginid: null,
          account_type: null,
          error: "Could not connect to Deriv API. Check your API token.",
        });
        return;
      }
    }

    const [balanceData, portfolioPnl] = await Promise.all([
      client.getAccountBalance(),
      client.getOpenContractPnl(),
    ]);

    if (!balanceData) {
      res.json({
        connected: true,
        balance: null,
        currency: null,
        equity: null,
        margin: null,
        free_margin: null,
        margin_level_pct: null,
        loginid: null,
        account_type: null,
        error: "Could not fetch balance from Deriv.",
      });
      return;
    }

    const auth = client.authData;
    const loginid = auth ? String(auth.loginid || "") : null;
    const accountType = auth ? String(auth.account_type || auth.landing_company_name || "") : null;

    const balance = balanceData.balance;
    const margin = portfolioPnl.totalBuyPrice;
    const equity = balance + portfolioPnl.unrealizedPnl;
    const freeMargin = Math.max(0, equity - margin);
    const marginLevelPct = margin > 0 ? (equity / margin) * 100 : null;

    res.json({
      connected: true,
      balance,
      currency: balanceData.currency,
      equity,
      margin,
      free_margin: freeMargin,
      margin_level_pct: marginLevelPct,
      loginid,
      account_type: accountType,
      error: null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to connect to Deriv";
    res.json({
      connected: false,
      balance: null,
      currency: null,
      equity: null,
      margin: null,
      free_margin: null,
      margin_level_pct: null,
      loginid: null,
      account_type: null,
      error: message,
    });
  }
}

router.get("/account/info", async (_req, res): Promise<void> => {
  await getAccountData(res);
});

router.get("/account/balance", async (_req, res): Promise<void> => {
  await getAccountData(res);
});

router.post("/account/set-mode", async (req, res): Promise<void> => {
  const { mode, confirmed } = req.body ?? {};
  if (!["paper", "live", "idle"].includes(mode)) {
    res.status(400).json({ success: false, message: "Mode must be paper, live, or idle" });
    return;
  }

  if (mode === "live") {
    if (process.env["LIVE_TRADING_ENABLED"] !== "true") {
      res.status(403).json({
        success: false,
        message: "Live trading is disabled. Set LIVE_TRADING_ENABLED environment variable to enable.",
      });
      return;
    }
    if (!confirmed) {
      res.status(400).json({
        success: false,
        message: "Live mode requires confirmation. Send { confirmed: true } to proceed.",
        requiresConfirmation: true,
      });
      return;
    }
  }

  await db
    .insert(platformStateTable)
    .values({ key: "mode", value: mode })
    .onConflictDoUpdate({
      target: platformStateTable.key,
      set: { value: mode, updatedAt: new Date() },
    });

  res.json({ success: true, message: `Trading mode set to ${mode.toUpperCase()}` });
});

export default router;
