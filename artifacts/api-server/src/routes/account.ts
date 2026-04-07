import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, platformStateTable } from "@workspace/db";
import { getDerivClientWithDbToken, getDerivClientForMode } from "../infrastructure/deriv.js";

const router: IRouter = Router();

interface AccountSnapshot {
  connected: boolean;
  balance: number | null;
  currency: string | null;
  equity: number | null;
  margin: number | null;
  free_margin: number | null;
  margin_level_pct: number | null;
  loginid: string | null;
  account_type: string | null;
  error: string | null;
}

const EMPTY_ACCOUNT: AccountSnapshot = {
  connected: false, balance: null, currency: null, equity: null,
  margin: null, free_margin: null, margin_level_pct: null,
  loginid: null, account_type: null, error: null,
};

async function fetchAccountSnapshot(mode: "demo" | "real"): Promise<AccountSnapshot> {
  try {
    const client = await getDerivClientForMode(mode);
    if (!client) return { ...EMPTY_ACCOUNT, error: `No ${mode} API token configured.` };

    if (!client.isStreaming()) {
      try { await client.connect(); } catch {
        return { ...EMPTY_ACCOUNT, error: `Could not connect to Deriv ${mode} API.` };
      }
    }

    const [balanceData, portfolioPnl] = await Promise.all([
      client.getAccountBalance(),
      client.getOpenContractPnl(),
    ]);

    if (!balanceData) {
      return { ...EMPTY_ACCOUNT, connected: true, error: `Could not fetch ${mode} balance.` };
    }

    const auth = client.authData;
    const loginid = auth ? String(auth.loginid || "") : null;
    const accountType = auth ? String(auth.account_type || auth.landing_company_name || "") : null;
    const balance = balanceData.balance;
    const marginVal = portfolioPnl.totalBuyPrice;
    const equityVal = balance + portfolioPnl.unrealizedPnl;
    const freeMargin = Math.max(0, equityVal - marginVal);
    const marginLevelPct = marginVal > 0 ? (equityVal / marginVal) * 100 : null;

    return {
      connected: true, balance, currency: balanceData.currency,
      equity: equityVal, margin: marginVal, free_margin: freeMargin,
      margin_level_pct: marginLevelPct, loginid, account_type: accountType, error: null,
    };
  } catch (err: unknown) {
    return { ...EMPTY_ACCOUNT, error: err instanceof Error ? err.message : `Failed to connect ${mode}` };
  }
}

router.get("/account/info", async (_req, res): Promise<void> => {
  const [demo, real] = await Promise.all([
    fetchAccountSnapshot("demo"),
    fetchAccountSnapshot("real"),
  ]);

  const primary = demo.connected ? demo : real.connected ? real : demo;

  res.json({
    ...primary,
    demo,
    real,
  });
});

router.get("/account/balance", async (_req, res): Promise<void> => {
  const [demo, real] = await Promise.all([
    fetchAccountSnapshot("demo"),
    fetchAccountSnapshot("real"),
  ]);
  const primary = demo.connected ? demo : real.connected ? real : demo;
  res.json({ ...primary, demo, real });
});

router.post("/account/set-mode", async (req, res): Promise<void> => {
  const { mode, confirmed } = req.body ?? {};
  if (!["paper", "live", "idle"].includes(mode)) {
    res.status(400).json({ success: false, message: "Mode must be paper, live, or idle" });
    return;
  }

  if (mode === "paper") {
    await db.insert(platformStateTable).values({ key: "paper_mode_active", value: "true" })
      .onConflictDoUpdate({ target: platformStateTable.key, set: { value: "true", updatedAt: new Date() } });
  } else if (mode === "live") {
    const tokenRow = await db.select().from(platformStateTable).where(eq(platformStateTable.key, "deriv_api_token")).limit(1);
    const demoTokenRow = await db.select().from(platformStateTable).where(eq(platformStateTable.key, "deriv_api_token_demo")).limit(1);
    if ((!tokenRow.length || !tokenRow[0].value) && (!demoTokenRow.length || !demoTokenRow[0].value)) {
      res.status(403).json({
        success: false,
        message: "Live trading requires a Deriv API token. Set it in Settings → API Keys first.",
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
    await db.insert(platformStateTable).values({ key: "demo_mode_active", value: "true" })
      .onConflictDoUpdate({ target: platformStateTable.key, set: { value: "true", updatedAt: new Date() } });
  } else {
    for (const modeKey of ["paper_mode_active", "demo_mode_active", "real_mode_active"]) {
      await db.insert(platformStateTable).values({ key: modeKey, value: "false" })
        .onConflictDoUpdate({ target: platformStateTable.key, set: { value: "false", updatedAt: new Date() } });
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
