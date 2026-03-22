# Deploy Deriv Capital Extraction App v1 to Railway

## What you need

- A GitHub account
- 5 minutes

That's it. Your Deriv API tokens, OpenAI key, and all trading settings are configured inside the app after deployment — no environment variables to copy-paste.

---

## v1 Deployable Symbol Set

| Family | Symbols |
|--------|---------|
| Boom/Crash | BOOM1000, CRASH1000, BOOM900, CRASH900, BOOM600, CRASH600, BOOM500, CRASH500, BOOM300, CRASH300 |
| Volatility | R_75, R_100 |

**Total: 12 symbols** — validated against Deriv `active_symbols` API on every boot.

## Startup Sequence

1. DB schema initialised (`CREATE TABLE IF NOT EXISTS` — safe for existing data)
2. AI verification auto-configured (enabled if OpenAI key is present)
3. Symbol validation against Deriv API (invalid symbols are skipped)
4. Tick streaming auto-started for all valid enabled symbols
5. Signal scheduler started (30s scan interval, 10s stagger)
6. Position manager started (10s cycle)
7. Stale-stream watchdog active (auto-resubscribe on dead streams)
8. Health endpoint live at `/api/healthz`

## Strategy Engine

4 families (frozen for v1):
- `trend_continuation` — trend pullback entries
- `mean_reversion` — exhaustion rebound + liquidity sweep
- `breakout_expansion` — volatility breakout + expansion
- `spike_event` — Boom/Crash spike hazard capture

---

## Step 1 — Create a Railway account

1. Go to [railway.app](https://railway.app)
2. Click **Login** → **Login with GitHub**
3. Authorise Railway to access your GitHub

## Step 2 — Create a new project

1. On the Railway dashboard click **New Project**
2. Choose **Deploy from GitHub repo**
3. Find and select your repository
4. Railway starts building — let it finish (3–5 minutes)

## Step 3 — Add a PostgreSQL database

1. Inside your Railway project, click **New** (the + button)
2. Choose **Database** → **Add PostgreSQL**
3. Railway creates the database and automatically injects `DATABASE_URL` into your app

## Step 4 — Link the database to your app

Railway can wire the database automatically using a Reference Variable:

1. Click on your **app service** → **Variables** tab → **New Variable**
2. Name: `DATABASE_URL` — Value: `${{Postgres.DATABASE_URL}}`

That is the only environment variable you need to set manually.

> Railway also injects `PORT` automatically — you do not need to set it.

## Step 5 — Generate a public domain

1. Click on your app service → **Settings** tab
2. Under **Networking → Public Networking** click **Generate Domain**
3. You get a URL like `your-app.up.railway.app`

## Step 6 — Configure the app from the UI

Open your new URL and go to **Settings**. Everything else is configured here:

| What | Where in Settings |
|------|------------------|
| Deriv Demo API token | Settings → API Keys → Deriv Demo Token |
| Deriv Real API token | Settings → API Keys → Deriv Real Token |
| OpenAI key (optional) | Settings → API Keys → OpenAI API Key |
| Trading modes | Settings → Trading Modes (Paper/Demo/Real) |
| Risk limits | Settings → each mode tab → Risk & Capital |
| AI verification | Settings → General → AI Signal Verification |
| Kill switch | Settings → General → Global Controls |

**After saving API keys**, run **Initial Setup** to backfill 24 months of data and optimise settings.

---

## Environment Variables

| Variable | Source | Required |
|----------|--------|----------|
| `DATABASE_URL` | Railway PostgreSQL reference | Yes |
| `PORT` | Railway auto-inject | Automatic |
| `NODE_ENV` | Set in Dockerfile | Automatic (`production`) |
| `SERVE_FRONTEND` | Set in Dockerfile | Automatic (`true`) |

All other configuration (API keys, trading parameters, risk limits) is stored in the database via the Settings UI.

---

## Updating the app

Push changes from Replit to GitHub and Railway redeploys automatically (3–5 minutes).

---

## Costs

Railway's Hobby plan is $5/month and includes PostgreSQL. A trading bot running 24/7 typically costs $5–10/month total.

---

## Troubleshooting

**App won't start**
- Check the Deployments tab → click the latest deployment → view build logs
- Make sure `DATABASE_URL` is linked to the PostgreSQL service

**Blank page / can't see the dashboard**
- The frontend is served automatically from the same process — no extra config needed
- Check the deployment logs for any startup errors

**Database errors**
- The app creates all tables on first start automatically
- Verify `DATABASE_URL` points to your Railway PostgreSQL instance

**Streaming not starting**
- Check Settings → Diagnostics tab for symbol validation status
- Ensure at least one Deriv API token is configured
- If user explicitly stopped streaming, restart from Data page

---

## Non-blocking issues for v1

- STP2-5, RDBR100/200, JD10-100, R_10/25/50, RDBULL/RDBEAR are catalogued but disabled for v1 deployment
- Real mode execution requires separate Deriv Real API token
- OpenAI API key is optional but recommended for AI signal verification
