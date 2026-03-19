import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, platformStateTable } from "@workspace/db";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { checkOpenAiHealth } from "../lib/openai.js";

const router: IRouter = Router();

const ENCRYPTION_KEY_SOURCE = process.env["DATABASE_URL"] || process.env["ENCRYPTION_SECRET"];
if (!ENCRYPTION_KEY_SOURCE) {
  throw new Error("DATABASE_URL or ENCRYPTION_SECRET environment variable is required for secret encryption.");
}
const DERIVED_KEY = scryptSync(ENCRYPTION_KEY_SOURCE, "deriv-quant-salt", 32);

function encryptSecret(value: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", DERIVED_KEY, iv);
  let encrypted = cipher.update(value, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `enc:${iv.toString("hex")}:${encrypted}`;
}

function decryptSecret(stored: string): string {
  if (!stored.startsWith("enc:")) return stored;
  const parts = stored.split(":");
  if (parts.length !== 3) return stored;
  const iv = Buffer.from(parts[1], "hex");
  const decipher = createDecipheriv("aes-256-cbc", DERIVED_KEY, iv);
  let decrypted = decipher.update(parts[2], "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

const SETTING_DEFAULTS: Record<string, string> = {
  max_open_trades: "4",
  equity_pct_per_trade: "2",
  tp_multiplier_strong: "2.5",
  tp_multiplier_medium: "2.0",
  tp_multiplier_weak: "1.5",
  sl_ratio: "1.0",
  trailing_stop_buffer_pct: "0.3",
  time_exit_window_hours: "4",
  max_daily_loss_pct: "3",
  max_weekly_loss_pct: "8",
  max_drawdown_pct: "15",
  kill_switch: "false",
  allocation_mode: "balanced",
  total_capital: "10000",
  scan_interval_seconds: "30",
  paper_equity_pct_per_trade: "1",
  live_equity_pct_per_trade: "2",
  paper_max_open_trades: "4",
  live_max_open_trades: "3",
  ai_verification_enabled: "false",
  enabled_symbols: "BOOM1000,CRASH1000,BOOM500,CRASH500,R_75,R_100,JD75,STPIDX,RDBEAR",
  paper_max_daily_loss_pct: "5",
  live_max_daily_loss_pct: "3",
  paper_max_weekly_loss_pct: "12",
  live_max_weekly_loss_pct: "8",
  paper_max_drawdown_pct: "20",
  live_max_drawdown_pct: "15",
};

const API_KEY_KEYS = ["deriv_api_token", "openai_api_key"];

const ALL_SETTING_KEYS = Object.keys(SETTING_DEFAULTS);

function maskSecret(value: string): string {
  if (!value || value.length < 8) return value ? "****" : "";
  return value.substring(0, 4) + "****" + value.substring(value.length - 4);
}

router.get("/settings", async (_req, res): Promise<void> => {
  const states = await db.select().from(platformStateTable);
  const stateMap: Record<string, string> = {};
  for (const s of states) stateMap[s.key] = s.value;

  const settings: Record<string, string> = {};
  for (const key of ALL_SETTING_KEYS) {
    settings[key] = stateMap[key] ?? SETTING_DEFAULTS[key];
  }

  for (const key of API_KEY_KEYS) {
    const raw = stateMap[key] || "";
    const decrypted = raw ? decryptSecret(raw) : "";
    settings[key] = maskSecret(decrypted);
    settings[`${key}_set`] = raw ? "true" : "false";
  }

  const tradingMode = stateMap["mode"] || "idle";
  settings["trading_mode"] = tradingMode;

  res.json(settings);
});

router.post("/settings", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;

  if (!body || typeof body !== "object") {
    res.status(400).json({ success: false, message: "Request body must be a JSON object" });
    return;
  }

  const updates: { key: string; value: string }[] = [];
  const errors: string[] = [];

  for (const [key, val] of Object.entries(body)) {
    const strVal = String(val);

    if (API_KEY_KEYS.includes(key)) {
      if (strVal === "" || strVal === "clear") {
        updates.push({ key, value: "" });
      } else if (strVal && !strVal.includes("****")) {
        updates.push({ key, value: encryptSecret(strVal) });
      }
      continue;
    }

    if (!ALL_SETTING_KEYS.includes(key)) continue;

    if (key === "kill_switch" || key === "ai_verification_enabled") {
      if (strVal !== "true" && strVal !== "false") {
        errors.push(`${key}: must be "true" or "false"`);
        continue;
      }
    } else if (key === "allocation_mode") {
      if (!["conservative", "balanced", "aggressive"].includes(strVal)) {
        errors.push(`${key}: must be "conservative", "balanced", or "aggressive"`);
        continue;
      }
    } else if (key === "enabled_symbols") {
      // no validation needed
    } else {
      const num = parseFloat(strVal);
      if (isNaN(num) || num < 0) {
        errors.push(`${key}: must be a non-negative number`);
        continue;
      }
    }

    updates.push({ key, value: strVal });
  }

  if (updates.length === 0 && errors.length > 0) {
    res.status(400).json({ success: false, message: `Validation failed: ${errors.join("; ")}` });
    return;
  }

  for (const { key, value } of updates) {
    await db
      .insert(platformStateTable)
      .values({ key, value })
      .onConflictDoUpdate({
        target: platformStateTable.key,
        set: { value, updatedAt: new Date() },
      });
  }

  if (updates.find((u) => u.key === "kill_switch" && u.value === "true")) {
    await db
      .insert(platformStateTable)
      .values({ key: "mode", value: "idle" })
      .onConflictDoUpdate({
        target: platformStateTable.key,
        set: { value: "idle", updatedAt: new Date() },
      });
  }

  res.json({ success: true, message: `Updated ${updates.length} setting(s)` });
});

router.get("/settings/api-key-status", async (_req, res): Promise<void> => {
  const states = await db.select().from(platformStateTable);
  const stateMap: Record<string, string> = {};
  for (const s of states) stateMap[s.key] = s.value;

  res.json({
    deriv_api_token_set: !!stateMap["deriv_api_token"] || !!process.env["Deriv_Api_Token"],
    openai_api_key_set: !!stateMap["openai_api_key"],
  });
});

router.get("/settings/openai-health", async (_req, res): Promise<void> => {
  try {
    const health = await checkOpenAiHealth();
    res.json(health);
  } catch (err) {
    res.json({ configured: false, working: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
