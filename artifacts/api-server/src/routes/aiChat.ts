import { Router, type IRouter } from "express";
import { db, platformStateTable, tradesTable, signalLogTable } from "@workspace/db";
import { eq, and, gte, desc } from "drizzle-orm";
import { createDecipheriv, scryptSync } from "crypto";
import OpenAI from "openai";

const router: IRouter = Router();

const ENC_KEY_SOURCE = process.env["DATABASE_URL"] || process.env["ENCRYPTION_SECRET"];
const ENC_DERIVED_KEY = ENC_KEY_SOURCE ? scryptSync(ENC_KEY_SOURCE, "deriv-quant-salt", 32) : null;

function decryptStoredSecret(stored: string): string {
  if (!stored.startsWith("enc:") || !ENC_DERIVED_KEY) return stored;
  const parts = stored.split(":");
  if (parts.length !== 3) return stored;
  const iv = Buffer.from(parts[1], "hex");
  const decipher = createDecipheriv("aes-256-cbc", ENC_DERIVED_KEY, iv);
  let decrypted = decipher.update(parts[2], "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

async function getOpenAIClient(): Promise<OpenAI> {
  const rows = await db.select().from(platformStateTable).where(eq(platformStateTable.key, "openai_api_key"));
  const raw = rows[0]?.value || null;
  if (!raw) throw new Error("OpenAI API key not configured");
  return new OpenAI({ apiKey: decryptStoredSecret(raw) });
}

async function getCurrentSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(platformStateTable);
  const map: Record<string, string> = {};
  for (const r of rows) {
    if (!r.key.includes("api_key") && !r.key.includes("api_token")) {
      map[r.key] = r.value;
    }
  }
  return map;
}

const MODE_PREFIXES = ["paper", "demo", "real"];
const FAMILIES = ["trend_continuation", "mean_reversion", "breakout_expansion", "spike_event"];
const PER_MODE_KEYS = [
  "capital", "equity_pct_per_trade", "max_open_trades", "allocation_mode",
  "tp_multiplier_strong", "tp_multiplier_medium", "tp_multiplier_weak",
  "sl_ratio", "trailing_stop_pct", "time_exit_window_hours",
  "tp_capture_ratio", "min_sl_atr_multiplier",
  "max_daily_loss_pct", "max_weekly_loss_pct", "max_drawdown_pct",
  "probe_threshold", "confirmation_threshold", "momentum_threshold",
  "stage_multiplier_probe", "stage_multiplier_confirmation", "stage_multiplier_momentum",
  "peak_drawdown_exit_pct", "min_peak_profit_pct", "large_peak_threshold_pct",
  "extraction_target_pct", "auto_extraction",
  "correlated_family_cap",
];
const PER_FAMILY_KEYS = [
  "tp_atr_multiplier", "sl_atr_multiplier", "initial_exit_hours",
  "extension_hours", "max_exit_hours", "harvest_sensitivity",
];
const WRITABLE_SETTINGS = [
  "min_composite_score", "min_ev_threshold", "min_rr_ratio",
  "scoring_weight_regime_fit", "scoring_weight_setup_quality",
  "scoring_weight_trend_alignment", "scoring_weight_volatility_condition",
  "scoring_weight_reward_risk", "scoring_weight_probability_of_success",
  "scan_interval_seconds", "scan_stagger_seconds",
  "ai_verification_enabled", "kill_switch",
  "paper_mode_active", "demo_mode_active", "real_mode_active",
  ...MODE_PREFIXES.flatMap(m => PER_MODE_KEYS.map(k => `${m}_${k}`)),
  ...MODE_PREFIXES.flatMap(m => FAMILIES.flatMap(f => PER_FAMILY_KEYS.map(k => `${m}_${f}_${k}`))),
  ...MODE_PREFIXES.map(m => `${m}_enabled_symbols`),
  ...MODE_PREFIXES.map(m => `${m}_enabled_strategies`),
];

const SYSTEM_KNOWLEDGE = `# Deriv Capital Extraction Platform — Complete Knowledge Base

## 1. Platform Overview
This is the **Deriv Capital Extraction App** — a fully automated trading system for Deriv synthetic indices. It replaces "Forex Royals" bots with a systematic, ML-driven approach. The core philosophy is CAPITAL EXTRACTION: grow a trading account, extract profits when targets are hit, then reset and repeat.

### Supported Instruments (12 total)
- **Boom indices**: BOOM1000, BOOM900, BOOM600, BOOM300, BOOM500 — price spikes upward periodically
- **Crash indices**: CRASH1000, CRASH900, CRASH600, CRASH300, CRASH500 — price drops periodically
- **Volatility indices**: R_75 (75% volatility), R_100 (100% volatility) — continuous random walk

### Three Trading Modes (Independent)
Each mode has its own capital, settings, and trades. They run simultaneously and independently.
| Mode | Monthly Target | Risk Profile | Description |
|------|---------------|-------------|-------------|
| **Paper** | 120% | Aggressive | Simulated trades, no real money. Best for learning and testing. |
| **Demo** | 80% | Balanced | Uses Deriv demo account with virtual funds. Tests execution. |
| **Real** | 50% | Conservative | Real money. Tightest risk controls. Most conservative settings. |

## 2. The Four Strategy Families
Each family is a distinct trading approach, activated only when its matching market regime is detected.

### 2.1 Trend Continuation
- **When it fires**: Market has a clear directional trend (EMA slope > 0.0003 for uptrend, < -0.0003 for downtrend) AND price has pulled back near the EMA AND RSI is neutral (38-65)
- **Ideal regime**: trend_up or trend_down
- **How it works**: Enters in the direction of the trend during a pullback. Like buying the dip in an uptrend.
- **Hold profile**: TP = 6x ATR, SL = 2.5x ATR, initial hold 168 hours (7 days), max 336 hours (14 days)
- **Best for**: R_75, R_100 during trending periods

### 2.2 Mean Reversion
- **When it fires**: Price is overstretched (z-score > 1.8 or < -1.8) AND RSI is extreme (>68 or <32) AND there are 3+ consecutive adverse candles. Also triggers on liquidity sweep setups.
- **Ideal regime**: mean_reversion
- **How it works**: Bets that an overextended price will snap back to its average. Two sub-strategies: "exhaustion-rebound" (extreme RSI + consecutive moves) and "liquidity-sweep" (price sweeps past a swing point then reclaims it).
- **Hold profile**: TP = 4x ATR, SL = 3x ATR, initial hold 120 hours (5 days), max 240 hours (10 days)
- **Best for**: Boom/Crash indices that overshoot

### 2.3 Breakout Expansion
- **When it fires**: Bollinger Bands are squeezed (width < 0.006) AND ATR is expanding AND price is at the upper/lower band. Also triggers on volatility expansion after compression.
- **Ideal regime**: compression or breakout_expansion
- **How it works**: Catches the explosive move that follows a period of low volatility compression. Like a coiled spring releasing.
- **Hold profile**: TP = 8x ATR, SL = 2x ATR, initial hold 168 hours (7 days), max 336 hours (14 days)
- **Best for**: All instruments during consolidation → expansion transitions

### 2.4 Spike Event
- **When it fires**: Spike hazard score > 0.70 on Boom or Crash indices only
- **Ideal regime**: spike_zone
- **How it works**: Predicts when a Boom spike (upward) or Crash spike (downward) is imminent based on tick patterns. Buys Boom, sells Crash.
- **Hold profile**: TP = 4x ATR, SL = 1.5x ATR, initial hold 72 hours (3 days), max 168 hours (7 days)
- **Best for**: BOOM and CRASH indices exclusively

## 3. Signal Pipeline — How Trades are Born
Every signal goes through this exact sequence:

1. **Tick Streaming** → Live price ticks arrive from Deriv WebSocket
2. **Feature Extraction** → 20+ technical features computed (EMA slope, RSI, z-score, ATR, Bollinger Bands, spike hazard, etc.)
3. **Regime Classification** → Market classified into: trend_up, trend_down, mean_reversion, compression, breakout_expansion, spike_zone, or no_trade
4. **Strategy Evaluation** → Only strategies matching the current regime are run (e.g., trend_continuation only runs in trend_up/trend_down)
5. **ML Scoring** → Each family has its own logistic regression model that scores the feature vector (0-1)
6. **Composite Scoring** → 6-dimension weighted score (0-100):
   - **Regime Fit** (default 22%): How well does the current regime match the strategy's ideal?
   - **Setup Quality** (20%): Model score strength + expected value
   - **Trend Alignment** (15%): EMA slope alignment with trade direction
   - **Volatility Condition** (13%): Is ATR in the strategy's ideal range?
   - **Reward/Risk** (15%): TP distance vs SL distance ratio
   - **Probability of Success** (15%): Win probability estimate
7. **Filtering** → Must pass: composite score ≥ min_composite_score (default 80), expected value ≥ min_ev_threshold, R:R ≥ min_rr_ratio
8. **AI Verification** (optional) → OpenAI reviews the signal and can adjust confidence
9. **Portfolio Allocation** → Risk checks: daily/weekly loss limits, max drawdown, max open trades, correlated exposure cap, position conflicts
10. **Position Sizing** → Size = equity × equity_pct_per_trade × confidence factor × stage multiplier
11. **Execution** → Trade opened with calculated TP/SL/trailing stop

## 4. Position Sizing Formula (Worked Example)
Given: $10,000 equity, 22% equity per trade, confidence 0.85, probe stage (multiplier 1.0)

1. Base percent = 22% / 100 = 0.22
2. Confidence-adjusted = 0.22 × (0.8 + 0.4 × 0.85) = 0.22 × 1.14 = 0.2508
3. Raw size = $10,000 × 0.2508 = $2,508
4. Stage multiplier (probe = 1.0): $2,508 × 1.0 = $2,508
5. Clamped to min 5% ($500) and max remaining capacity (80% equity minus deployed)

For confirmation stage (multiplier 0.60): $2,508 × 0.60 = $1,505
For momentum stage (multiplier 0.50): $2,508 × 0.50 = $1,254

## 5. Trade Lifecycle
1. **Entry** → Signal passes all filters → position opened at spot price
2. **Position Building** → Up to 3 entries on same symbol at different stages:
   - **Probe**: First entry. Score must exceed probe_threshold (Paper: 75, Demo: 82, Real: 88)
   - **Confirmation**: Second entry. Score must exceed confirmation_threshold (Paper: 80, Demo: 86, Real: 91)
   - **Momentum**: Third entry. Score must exceed momentum_threshold (Paper: 85, Demo: 90, Real: 94)
3. **Monitoring** → Every 10 seconds: update current price, check TP/SL/trailing stop
4. **Trailing Stop** → Once price moves favourably, SL ratchets up. Trail = trailing_stop_pct (default 25%) behind peak price.
5. **Profit Harvest** → If peak profit ≥ min_peak_profit_pct AND drawdown from peak ≥ peak_drawdown_exit_pct → close trade and harvest. Large peaks (≥ large_peak_threshold_pct) use a tighter 60% drawdown trigger.
6. **Time Exit** → After initial_exit_hours: profitable → close. Small loss → extend by extension_hours (once). Large loss → close. Hard maximum at max_exit_hours.
7. **Close** → Trade closed, PnL recorded, capital updated.

## 6. Capital Extraction Cycle
1. Start with base capital (e.g., $1,000 for Paper)
2. Trade until capital grows by extraction_target_pct (default 50%)
3. When target reached: if auto_extraction is on, automatically extract profits back to base capital. If off, prompt user.
4. Capital resets to starting amount. Extraction cycle increments. Extracted amount tracked as total_extracted.
5. This prevents compound risk — you always trade with the same base, extracting profits regularly.

## 7. Settings Glossary — Plain-Language Descriptions

### Global Settings (apply to all modes)
| Setting | What it means | Default |
|---------|--------------|---------|
| min_composite_score | Minimum quality score (0-100) a signal needs to be traded. Higher = fewer but better trades. | 80 |
| min_ev_threshold | Minimum expected value. How much profit per dollar risked the model expects. | 0.003 |
| min_rr_ratio | Minimum reward-to-risk ratio. TP distance ÷ SL distance. | 1.5 |
| scoring_weight_regime_fit | How much "regime match" matters in the composite score (0-1). | 0.22 |
| scoring_weight_setup_quality | How much "setup quality" matters (0-1). | 0.20 |
| scoring_weight_trend_alignment | How much "trend alignment" matters (0-1). | 0.15 |
| scoring_weight_volatility_condition | How much "volatility condition" matters (0-1). | 0.13 |
| scoring_weight_reward_risk | How much "reward/risk" matters (0-1). | 0.15 |
| scoring_weight_probability_of_success | How much "win probability" matters (0-1). | 0.15 |
| scan_interval_seconds | How often (seconds) the system scans for new signals. | 30 |
| ai_verification_enabled | Whether OpenAI reviews each signal before trading. | true |
| kill_switch | Emergency stop — blocks ALL new trades immediately. | false |

### Per-Mode Settings (prefixed with paper_, demo_, or real_)
| Setting | What it means |
|---------|--------------|
| capital | Starting/current capital for this mode |
| equity_pct_per_trade | Percentage of equity to risk per trade (e.g., 22 = 22%) |
| max_open_trades | Maximum simultaneous open positions |
| allocation_mode | "conservative" (0.7x size), "balanced" (1.0x), or "aggressive" (1.3x) |
| tp_multiplier_strong / medium / weak | Take-profit ATR multipliers by confidence tier |
| sl_ratio | Stop-loss adjustment ratio (1.0 = use family default) |
| trailing_stop_pct | Trail percentage behind peak price (25 = 25%) |
| time_exit_window_hours | Base time before time-exit logic kicks in |
| tp_capture_ratio | What fraction of the predicted move to target (0.70 = 70%) |
| min_sl_atr_multiplier | Minimum SL distance in ATR multiples (wider = safer) |
| max_daily_loss_pct | Max daily loss before halting (% of capital) |
| max_weekly_loss_pct | Max weekly loss before halting |
| max_drawdown_pct | Max drawdown from peak before kill-switch territory |
| probe_threshold | Min composite score for first entry on a symbol |
| confirmation_threshold | Min composite score for second entry |
| momentum_threshold | Min composite score for third entry |
| stage_multiplier_probe / confirmation / momentum | Position size multiplier for each entry stage |
| peak_drawdown_exit_pct | How much drawdown from peak profit triggers harvest (%) |
| min_peak_profit_pct | Minimum peak profit before harvest can trigger (%) |
| large_peak_threshold_pct | What counts as a "large" peak for early harvest (%) |
| extraction_target_pct | How much profit to accumulate before extracting (%) |
| auto_extraction | "true"/"false" — automatically extract when target hit |
| correlated_family_cap | Max positions in correlated instruments (e.g., all Boom indices) |
| enabled_symbols | Comma-separated list of symbols this mode can trade |
| enabled_strategies | Comma-separated list of strategy families this mode can use |

### Per-Family Settings (prefixed with {mode}_{family}_)
| Setting | What it means |
|---------|--------------|
| tp_atr_multiplier | Take-profit distance in ATR multiples for this family |
| sl_atr_multiplier | Stop-loss distance in ATR multiples |
| initial_exit_hours | Hours before time-exit logic starts checking |
| extension_hours | Additional hours to give a small-loss trade |
| max_exit_hours | Absolute maximum hours a trade can stay open |
| harvest_sensitivity | Multiplier for harvest aggressiveness (lower = more patient) |

## 8. Market Regime Definitions
| Regime | What's happening | Allowed strategies |
|--------|-----------------|-------------------|
| trend_up | Clear upward trend, EMA slope positive | trend_continuation |
| trend_down | Clear downward trend, EMA slope negative | trend_continuation |
| mean_reversion | Price overstretched, RSI extreme | mean_reversion |
| compression | Low volatility squeeze, BB narrow | breakout_expansion |
| breakout_expansion | Volatility expanding after compression | breakout_expansion |
| spike_zone | Boom/Crash spike imminent | spike_event |
| no_trade | Conflicting or unclear signals | NONE — system waits |

## 9. Technical Glossary
| Term | Plain-language meaning |
|------|----------------------|
| **ATR** | Average True Range — measures how much the price typically moves. Higher = more volatile. |
| **R:R (Reward/Risk)** | How much you stand to gain vs lose. R:R of 3 means you gain $3 for every $1 risked. |
| **Composite Score** | Overall signal quality (0-100). Combines 6 factors. Must exceed min_composite_score to trade. |
| **Regime** | The current market "mood" — trending, reverting, compressing, or spiking. |
| **EMA** | Exponential Moving Average — a smoothed price trend line. Its slope shows direction. |
| **RSI** | Relative Strength Index (0-100). Below 30 = oversold, above 70 = overbought. |
| **z-Score** | How many standard deviations price is from its mean. ±2 = very stretched. |
| **Bollinger Bands** | Volatility bands around price. Narrow = squeeze. Wide = expansion. |
| **BB Width** | Width of Bollinger Bands. Below 0.006 = squeeze (breakout likely). |
| **%B** | Where price sits within Bollinger Bands. >0.85 = near top, <0.15 = near bottom. |
| **Spike Hazard Score** | Probability (0-1) that a Boom/Crash spike is imminent. >0.70 triggers spike_event. |
| **Trailing Stop** | A stop-loss that moves in your favour as price improves. Locks in profits. |
| **Profit Harvest** | Closing a profitable trade when it's drawn down significantly from its peak. |
| **Capital Extraction** | Taking profits out of the trading account when the target is reached, then resetting. |
| **Expected Value (EV)** | Average profit per dollar risked if you took this trade 1000 times. |
| **Probe/Confirmation/Momentum** | Three stages of building a position on the same symbol, requiring progressively higher scores. |

## 10. Recent System Changes (Changelog)
- **v1.0 — Current**: Full V1 system with 4-family ML engine, composite scoring, 3 independent modes
- AI converted from controller to suggestion-only advisor (never auto-changes settings)
- Weekly AI analysis covers ALL adjustable settings + regime distribution
- Monthly optimization writes suggestions only (ai_suggest_ keys)
- Settings page: field-level locking, unlock with risk warning, section saves
- AI suggestion badges on all settings with "Review Suggestions" button
- Kill switch locked by default with override save pattern
- Per-family hold profiles (TP/SL ATR multipliers, time exits, harvest sensitivity) per mode
- Position building: probe → confirmation → momentum with configurable thresholds and size multipliers
- Capital extraction cycle with configurable target and auto-extraction option
- Correlated instrument exposure cap prevents overconcentration in one family

## 11. AI Advisor Rules
1. You are an ADVISOR, not a controller. You NEVER directly change settings.
2. You can READ current settings and pending AI suggestions.
3. You can WRITE new AI suggestions (ai_suggest_ keys) for the user to review and apply manually.
4. You can ANALYSE recent trade performance data to give data-backed advice.
5. Always explain WHY you're suggesting a change — reference actual performance data when available.
6. For Real mode, be MOST conservative. For Paper, MOST aggressive.
7. Never suggest lowering composite score below 80.
8. Always favour FEWER, LARGER, HIGHER-QUALITY trades.
9. Write suggestions using write_suggestions tool, then tell the user to check Settings to review and apply.

## 12. Core Trading Philosophy
- HIGH CAPITAL PER TRADE: Deploy 15-25% equity per position
- HIGHEST-VALUE SIGNALS ONLY: Composite score ≥ 80+
- HOLD FOR LONGER PERIODS: Time exit windows of 72-168+ hours
- WIDE TAKE PROFITS: TP multipliers of 2.5x-4.0x ATR
- TIGHT TRAILING STOPS: Trail 20-25% behind peak price
- FEW SIMULTANEOUS POSITIONS: Max 2-4 open trades
- EXTRACT PROFITS REGULARLY: Don't let compound risk grow unchecked`;


async function buildDynamicContext(): Promise<string> {
  const settings = await getCurrentSettings();

  const activeModes: string[] = [];
  for (const mode of MODE_PREFIXES) {
    if (settings[`${mode}_mode_active`] === "true") activeModes.push(mode);
  }

  const modesSummary = MODE_PREFIXES.map(mode => {
    const active = settings[`${mode}_mode_active`] === "true";
    const capital = settings[`${mode}_capital`] || "N/A";
    const eqPct = settings[`${mode}_equity_pct_per_trade`] || "N/A";
    const maxTrades = settings[`${mode}_max_open_trades`] || "N/A";
    const allocation = settings[`${mode}_allocation_mode`] || "balanced";
    const probeThresh = settings[`${mode}_probe_threshold`] || "N/A";
    const extractTarget = settings[`${mode}_extraction_target_pct`] || "50";
    return `${mode.toUpperCase()}: ${active ? "ACTIVE" : "INACTIVE"} | Capital: $${capital} | Equity/trade: ${eqPct}% | Max trades: ${maxTrades} | Allocation: ${allocation} | Probe threshold: ${probeThresh} | Extraction target: ${extractTarget}%`;
  }).join("\n");

  const aiSuggestions: string[] = [];
  for (const [k, v] of Object.entries(settings)) {
    if (k.startsWith("ai_suggest_")) {
      const actualKey = k.replace("ai_suggest_", "");
      const currentValue = settings[actualKey] || "unknown";
      aiSuggestions.push(`${actualKey}: current="${currentValue}" → suggested="${v}"`);
    }
  }

  const globalSettings = [
    `min_composite_score: ${settings["min_composite_score"] || "80"}`,
    `min_ev_threshold: ${settings["min_ev_threshold"] || "0.003"}`,
    `min_rr_ratio: ${settings["min_rr_ratio"] || "1.5"}`,
    `scan_interval_seconds: ${settings["scan_interval_seconds"] || "30"}`,
    `ai_verification_enabled: ${settings["ai_verification_enabled"] || "true"}`,
    `kill_switch: ${settings["kill_switch"] || "false"}`,
  ].join("\n");

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

  let recentTradesSummary = "No recent trades in database.";
  try {
    const recentTrades = await db.select().from(tradesTable)
      .where(gte(tradesTable.entryTs, sevenDaysAgo))
      .orderBy(desc(tradesTable.entryTs))
      .limit(20);

    if (recentTrades.length > 0) {
      const openCount = recentTrades.filter(t => t.status === "open").length;
      const closedRecent = recentTrades.filter(t => t.status === "closed");
      const totalPnl = closedRecent.reduce((s, t) => s + (t.pnl ?? 0), 0);
      const winCount = closedRecent.filter(t => (t.pnl ?? 0) > 0).length;
      const winRate = closedRecent.length > 0 ? (winCount / closedRecent.length * 100).toFixed(1) : "N/A";

      recentTradesSummary = `Last 7 days: ${recentTrades.length} trades (${openCount} open, ${closedRecent.length} closed) | Win rate: ${winRate}% | Total PnL: $${totalPnl.toFixed(2)}`;
    }
  } catch { /* table may be empty */ }

  let sections = `\n--- CURRENT SYSTEM STATE ---\n`;
  sections += `\nActive Modes:\n${modesSummary}\n`;
  sections += `\nGlobal Settings:\n${globalSettings}\n`;
  sections += `\nRecent Performance:\n${recentTradesSummary}\n`;

  if (aiSuggestions.length > 0) {
    sections += `\nPending AI Suggestions (${aiSuggestions.length}):\n${aiSuggestions.join("\n")}\n`;
  } else {
    sections += `\nPending AI Suggestions: None\n`;
  }

  return sections;
}


const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_current_settings",
      description: "Get all current platform settings, their values, and any pending AI suggestions",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "write_suggestions",
      description: "Write AI suggestions for settings. These are NOT applied automatically — the user must review and apply them manually in the Settings page. Use this to recommend value changes.",
      parameters: {
        type: "object",
        properties: {
          suggestions: {
            type: "object",
            description: "Key-value pairs of suggested settings. Keys should match actual setting names (e.g. paper_equity_pct_per_trade, demo_sl_ratio, min_composite_score)",
            additionalProperties: { type: "string" },
          },
          reasoning: {
            type: "string",
            description: "Brief explanation of why these suggestions are being made",
          },
        },
        required: ["suggestions", "reasoning"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_trades",
      description: "Query recent trade performance data. Use this to answer questions about trade history, win rates, PnL, durations, strategy performance, and TP/SL effectiveness. Always call this before giving performance-based advice.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["paper", "demo", "real", "all"],
            description: "Which trading mode to analyze. Use 'all' for cross-mode analysis.",
          },
          days: {
            type: "number",
            description: "Number of days to look back. Default 7.",
          },
          focus: {
            type: "string",
            enum: ["overview", "by_strategy", "by_symbol", "durations", "tp_sl_effectiveness", "recent_closed", "open_positions"],
            description: "What aspect to focus the analysis on.",
          },
        },
        required: ["focus"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_signals",
      description: "Query signal log data to understand signal hit rates, rejection reasons, scoring patterns, and regime distribution. Use this to explain why trades are or aren't being taken.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Number of days to look back. Default 7.",
          },
          focus: {
            type: "string",
            enum: ["hit_rates", "rejection_reasons", "regime_distribution", "score_distribution", "by_symbol"],
            description: "What aspect of signal data to analyze.",
          },
        },
        required: ["focus"],
      },
    },
  },
];


async function handleAnalyzeTrades(args: { mode?: string; days?: number; focus: string }): Promise<string> {
  const days = args.days || 7;
  const since = new Date(Date.now() - days * 86400000);
  const modeFilter = args.mode && args.mode !== "all" ? args.mode : null;

  const conditions = [gte(tradesTable.entryTs, since)];
  if (modeFilter) conditions.push(eq(tradesTable.mode, modeFilter));

  const trades = await db.select().from(tradesTable)
    .where(and(...conditions))
    .orderBy(desc(tradesTable.entryTs))
    .limit(200);

  if (trades.length === 0) {
    return JSON.stringify({ message: `No trades found in the last ${days} days${modeFilter ? ` for ${modeFilter} mode` : ""}.` });
  }

  const openTrades = trades.filter(t => t.status === "open");
  const closedTrades = trades.filter(t => t.status === "closed");

  switch (args.focus) {
    case "overview": {
      const totalPnl = closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
      const wins = closedTrades.filter(t => (t.pnl ?? 0) > 0);
      const losses = closedTrades.filter(t => (t.pnl ?? 0) <= 0);
      const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length : 0;
      const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length : 0;
      const avgDurationHrs = closedTrades.length > 0
        ? closedTrades.filter(t => t.exitTs).reduce((s, t) => s + (t.exitTs!.getTime() - t.entryTs.getTime()) / 3600000, 0) / closedTrades.filter(t => t.exitTs).length
        : 0;

      return JSON.stringify({
        period: `Last ${days} days`,
        mode: modeFilter || "all",
        totalTrades: trades.length,
        openTrades: openTrades.length,
        closedTrades: closedTrades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: closedTrades.length > 0 ? `${(wins.length / closedTrades.length * 100).toFixed(1)}%` : "N/A",
        totalPnl: `$${totalPnl.toFixed(2)}`,
        avgWin: `$${avgWin.toFixed(2)}`,
        avgLoss: `$${avgLoss.toFixed(2)}`,
        avgDurationHours: `${avgDurationHrs.toFixed(1)}h`,
        profitFactor: losses.length > 0 && avgLoss !== 0 ? ((avgWin * wins.length) / Math.abs(avgLoss * losses.length)).toFixed(2) : "N/A",
      });
    }

    case "by_strategy": {
      const byStrategy: Record<string, { total: number; wins: number; pnl: number; avgScore: number }> = {};
      for (const t of closedTrades) {
        if (!byStrategy[t.strategyName]) byStrategy[t.strategyName] = { total: 0, wins: 0, pnl: 0, avgScore: 0 };
        byStrategy[t.strategyName].total++;
        if ((t.pnl ?? 0) > 0) byStrategy[t.strategyName].wins++;
        byStrategy[t.strategyName].pnl += t.pnl ?? 0;
        byStrategy[t.strategyName].avgScore += t.confidence ?? 0;
      }
      const result: Record<string, any> = {};
      for (const [strat, data] of Object.entries(byStrategy)) {
        result[strat] = {
          trades: data.total,
          wins: data.wins,
          winRate: `${(data.wins / data.total * 100).toFixed(1)}%`,
          totalPnl: `$${data.pnl.toFixed(2)}`,
          avgConfidence: (data.avgScore / data.total).toFixed(3),
        };
      }
      return JSON.stringify({ period: `Last ${days} days`, mode: modeFilter || "all", strategyBreakdown: result });
    }

    case "by_symbol": {
      const bySymbol: Record<string, { total: number; wins: number; pnl: number }> = {};
      for (const t of closedTrades) {
        if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { total: 0, wins: 0, pnl: 0 };
        bySymbol[t.symbol].total++;
        if ((t.pnl ?? 0) > 0) bySymbol[t.symbol].wins++;
        bySymbol[t.symbol].pnl += t.pnl ?? 0;
      }
      const result: Record<string, any> = {};
      for (const [sym, data] of Object.entries(bySymbol)) {
        result[sym] = {
          trades: data.total,
          winRate: `${(data.wins / data.total * 100).toFixed(1)}%`,
          totalPnl: `$${data.pnl.toFixed(2)}`,
        };
      }
      return JSON.stringify({ period: `Last ${days} days`, mode: modeFilter || "all", symbolBreakdown: result });
    }

    case "durations": {
      const durations = closedTrades
        .filter(t => t.exitTs)
        .map(t => ({
          symbol: t.symbol,
          strategy: t.strategyName,
          durationHours: ((t.exitTs!.getTime() - t.entryTs.getTime()) / 3600000).toFixed(1),
          pnl: `$${(t.pnl ?? 0).toFixed(2)}`,
          exitReason: t.exitReason || "unknown",
        }));
      const avgDuration = durations.length > 0
        ? (durations.reduce((s, d) => s + parseFloat(d.durationHours), 0) / durations.length).toFixed(1)
        : "0";
      const exitReasons: Record<string, number> = {};
      for (const d of durations) {
        exitReasons[d.exitReason] = (exitReasons[d.exitReason] || 0) + 1;
      }
      return JSON.stringify({
        period: `Last ${days} days`,
        avgDurationHours: avgDuration,
        exitReasonCounts: exitReasons,
        trades: durations.slice(0, 15),
      });
    }

    case "tp_sl_effectiveness": {
      const analysis = closedTrades.filter(t => t.exitTs).map(t => {
        const tpDist = Math.abs(t.tp - t.entryPrice);
        const slDist = Math.abs(t.sl - t.entryPrice);
        const actualMove = t.exitPrice ? Math.abs(t.exitPrice - t.entryPrice) : 0;
        const tpReached = t.exitReason === "tp_hit" || (t.pnl ?? 0) > 0 && actualMove >= tpDist * 0.9;
        const slReached = t.exitReason === "sl_hit" || (t.pnl ?? 0) < 0 && actualMove >= slDist * 0.9;
        return { symbol: t.symbol, strategy: t.strategyName, tpDist, slDist, actualMove, tpReached, slReached, exitReason: t.exitReason || "unknown", pnl: t.pnl ?? 0 };
      });
      const tpHits = analysis.filter(a => a.tpReached).length;
      const slHits = analysis.filter(a => a.slReached).length;
      const timeExits = analysis.filter(a => a.exitReason?.includes("time")).length;
      const harvestExits = analysis.filter(a => a.exitReason?.includes("harvest") || a.exitReason?.includes("peak")).length;
      const avgTpDistance = analysis.length > 0 ? analysis.reduce((s, a) => s + a.tpDist, 0) / analysis.length : 0;
      const avgSlDistance = analysis.length > 0 ? analysis.reduce((s, a) => s + a.slDist, 0) / analysis.length : 0;
      return JSON.stringify({
        period: `Last ${days} days`,
        totalClosed: analysis.length,
        tpHits,
        slHits,
        timeExits,
        harvestExits,
        otherExits: analysis.length - tpHits - slHits - timeExits - harvestExits,
        avgTpDistance: avgTpDistance.toFixed(4),
        avgSlDistance: avgSlDistance.toFixed(4),
        avgRR: avgSlDistance > 0 ? (avgTpDistance / avgSlDistance).toFixed(2) : "N/A",
      });
    }

    case "recent_closed": {
      const recent = closedTrades.slice(0, 10).map(t => ({
        id: t.id,
        symbol: t.symbol,
        strategy: t.strategyName,
        side: t.side,
        mode: t.mode,
        entryPrice: t.entryPrice.toFixed(4),
        exitPrice: t.exitPrice?.toFixed(4) || "N/A",
        pnl: `$${(t.pnl ?? 0).toFixed(2)}`,
        durationHours: t.exitTs ? ((t.exitTs.getTime() - t.entryTs.getTime()) / 3600000).toFixed(1) + "h" : "N/A",
        exitReason: t.exitReason || "unknown",
        confidence: t.confidence?.toFixed(3) || "N/A",
      }));
      return JSON.stringify({ period: `Last ${days} days`, recentClosedTrades: recent });
    }

    case "open_positions": {
      const open = openTrades.map(t => {
        const unrealizedPnl = t.currentPrice && t.entryPrice
          ? (t.side === "buy" ? t.currentPrice - t.entryPrice : t.entryPrice - t.currentPrice) * (t.size / t.entryPrice)
          : 0;
        const hoursOpen = (Date.now() - t.entryTs.getTime()) / 3600000;
        return {
          id: t.id,
          symbol: t.symbol,
          strategy: t.strategyName,
          side: t.side,
          mode: t.mode,
          entryPrice: t.entryPrice.toFixed(4),
          currentPrice: t.currentPrice?.toFixed(4) || "N/A",
          tp: t.tp.toFixed(4),
          sl: t.sl.toFixed(4),
          size: `$${t.size.toFixed(2)}`,
          unrealizedPnl: `$${unrealizedPnl.toFixed(2)}`,
          hoursOpen: `${hoursOpen.toFixed(1)}h`,
          peakPrice: t.peakPrice?.toFixed(4) || "N/A",
          maxExitTs: t.maxExitTs?.toISOString() || "N/A",
        };
      });
      return JSON.stringify({ openPositions: open, count: open.length });
    }

    default:
      return JSON.stringify({ error: "Unknown focus type" });
  }
}


async function handleAnalyzeSignals(args: { days?: number; focus: string }): Promise<string> {
  const days = args.days || 7;
  const since = new Date(Date.now() - days * 86400000);

  const signals = await db.select().from(signalLogTable)
    .where(gte(signalLogTable.ts, since))
    .orderBy(desc(signalLogTable.ts))
    .limit(500);

  if (signals.length === 0) {
    return JSON.stringify({ message: `No signals logged in the last ${days} days.` });
  }

  switch (args.focus) {
    case "hit_rates": {
      const total = signals.length;
      const allowed = signals.filter(s => s.allowedFlag).length;
      const rejected = total - allowed;
      const byFamily: Record<string, { total: number; allowed: number }> = {};
      for (const s of signals) {
        const fam = (s as any).strategyFamily || s.strategyName;
        if (!byFamily[fam]) byFamily[fam] = { total: 0, allowed: 0 };
        byFamily[fam].total++;
        if (s.allowedFlag) byFamily[fam].allowed++;
      }
      const familyRates: Record<string, string> = {};
      for (const [fam, data] of Object.entries(byFamily)) {
        familyRates[fam] = `${data.allowed}/${data.total} (${(data.allowed / data.total * 100).toFixed(1)}%)`;
      }
      return JSON.stringify({
        period: `Last ${days} days`,
        totalSignals: total,
        allowed,
        rejected,
        overallHitRate: `${(allowed / total * 100).toFixed(1)}%`,
        byFamily: familyRates,
      });
    }

    case "rejection_reasons": {
      const rejected = signals.filter(s => !s.allowedFlag && s.rejectionReason);
      const reasons: Record<string, number> = {};
      for (const s of rejected) {
        const reason = s.rejectionReason || "unknown";
        const normalized = reason.replace(/\([^)]*\)/g, "").replace(/[0-9.]+/g, "N").trim();
        reasons[normalized] = (reasons[normalized] || 0) + 1;
      }
      const sorted = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
      return JSON.stringify({
        period: `Last ${days} days`,
        totalRejected: rejected.length,
        topReasons: sorted.slice(0, 10).map(([reason, count]) => ({ reason, count })),
      });
    }

    case "regime_distribution": {
      const regimes: Record<string, number> = {};
      for (const s of signals) {
        const r = (s as any).regime || "unknown";
        regimes[r] = (regimes[r] || 0) + 1;
      }
      return JSON.stringify({
        period: `Last ${days} days`,
        totalSignals: signals.length,
        regimeDistribution: regimes,
      });
    }

    case "score_distribution": {
      const scores = signals.filter(s => s.compositeScore != null).map(s => s.compositeScore!);
      if (scores.length === 0) return JSON.stringify({ message: "No scored signals found." });
      const buckets: Record<string, number> = { "0-50": 0, "50-60": 0, "60-70": 0, "70-80": 0, "80-85": 0, "85-90": 0, "90-95": 0, "95-100": 0 };
      for (const s of scores) {
        if (s < 50) buckets["0-50"]++;
        else if (s < 60) buckets["50-60"]++;
        else if (s < 70) buckets["60-70"]++;
        else if (s < 80) buckets["70-80"]++;
        else if (s < 85) buckets["80-85"]++;
        else if (s < 90) buckets["85-90"]++;
        else if (s < 95) buckets["90-95"]++;
        else buckets["95-100"]++;
      }
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      return JSON.stringify({
        period: `Last ${days} days`,
        totalScored: scores.length,
        avgCompositeScore: avg.toFixed(1),
        distribution: buckets,
      });
    }

    case "by_symbol": {
      const bySymbol: Record<string, { total: number; allowed: number; avgScore: number }> = {};
      for (const s of signals) {
        if (!bySymbol[s.symbol]) bySymbol[s.symbol] = { total: 0, allowed: 0, avgScore: 0 };
        bySymbol[s.symbol].total++;
        if (s.allowedFlag) bySymbol[s.symbol].allowed++;
        bySymbol[s.symbol].avgScore += s.compositeScore ?? 0;
      }
      const result: Record<string, any> = {};
      for (const [sym, data] of Object.entries(bySymbol)) {
        result[sym] = {
          signals: data.total,
          allowed: data.allowed,
          hitRate: `${(data.allowed / data.total * 100).toFixed(1)}%`,
          avgCompositeScore: (data.avgScore / data.total).toFixed(1),
        };
      }
      return JSON.stringify({ period: `Last ${days} days`, symbolBreakdown: result });
    }

    default:
      return JSON.stringify({ error: "Unknown focus type" });
  }
}


router.post("/ai/chat", async (req, res): Promise<void> => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array required" });
      return;
    }

    const client = await getOpenAIClient();

    const dynamicContext = await buildDynamicContext();
    const fullSystemPrompt = SYSTEM_KNOWLEDGE + "\n" + dynamicContext;

    const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: fullSystemPrompt },
      ...messages,
    ];

    let response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: chatMessages,
      tools,
      max_tokens: 1500,
    });

    let attempts = 0;
    const maxAttempts = 5;

    while (response.choices[0]?.finish_reason === "tool_calls" && attempts < maxAttempts) {
      attempts++;
      const toolCalls = response.choices[0].message.tool_calls || [];
      chatMessages.push(response.choices[0].message);

      for (const tc of toolCalls) {
        let result: string;
        try {
          if (tc.function.name === "get_current_settings") {
            const settings = await getCurrentSettings();
            const aiSuggestions: Record<string, string> = {};
            for (const [k, v] of Object.entries(settings)) {
              if (k.startsWith("ai_suggest_")) {
                aiSuggestions[k.replace("ai_suggest_", "")] = v;
              }
            }
            const actualSettings: Record<string, string> = {};
            for (const [k, v] of Object.entries(settings)) {
              if (!k.startsWith("ai_suggest_") && !k.startsWith("ai_")) {
                actualSettings[k] = v;
              }
            }
            result = JSON.stringify({ settings: actualSettings, pendingSuggestions: aiSuggestions }, null, 2);
          } else if (tc.function.name === "write_suggestions") {
            const args = JSON.parse(tc.function.arguments);
            const toSuggest = args.suggestions || {};
            const reasoning = args.reasoning || "";
            const written: string[] = [];
            const rejected: string[] = [];

            for (const [key, value] of Object.entries(toSuggest)) {
              if (WRITABLE_SETTINGS.includes(key)) {
                const suggestKey = `ai_suggest_${key}`;
                await db
                  .insert(platformStateTable)
                  .values({ key: suggestKey, value: String(value) })
                  .onConflictDoUpdate({
                    target: platformStateTable.key,
                    set: { value: String(value), updatedAt: new Date() },
                  });
                written.push(`${key} → ${value}`);
              } else {
                rejected.push(`${key} (not a valid setting key)`);
              }
            }

            await db.insert(platformStateTable)
              .values({ key: "ai_chat_suggestion_at", value: new Date().toISOString() })
              .onConflictDoUpdate({ target: platformStateTable.key, set: { value: new Date().toISOString(), updatedAt: new Date() } });

            result = JSON.stringify({
              written,
              rejected,
              message: written.length > 0
                ? `Wrote ${written.length} suggestion(s). The user can review and apply them in the Settings page.`
                : "No suggestions were written.",
              reasoning,
            });
          } else if (tc.function.name === "analyze_trades") {
            const args = JSON.parse(tc.function.arguments);
            result = await handleAnalyzeTrades(args);
          } else if (tc.function.name === "analyze_signals") {
            const args = JSON.parse(tc.function.arguments);
            result = await handleAnalyzeSignals(args);
          } else {
            result = JSON.stringify({ error: "Unknown function" });
          }
        } catch (err) {
          result = JSON.stringify({ error: err instanceof Error ? err.message : "Function call failed" });
        }

        chatMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }

      response = await client.chat.completions.create({
        model: "gpt-4o",
        messages: chatMessages,
        tools,
        max_tokens: 1500,
      });
    }

    const reply = response.choices[0]?.message?.content || "I couldn't generate a response.";
    const suggestionsWritten = chatMessages.some(
      m => m.role === "tool" && typeof m.content === "string" && m.content.includes('"written"')
    );

    res.json({ reply, settingsChanged: false, suggestionsWritten });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI chat failed";
    res.status(500).json({ error: message });
  }
});

export default router;
