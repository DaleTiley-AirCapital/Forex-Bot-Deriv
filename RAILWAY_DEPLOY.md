# Deploy Deriv Quant to Railway

## What you need

- A GitHub account
- 5 minutes

That's it. Your Deriv API token, OpenAI key, and all trading settings are configured inside the app after deployment — no environment variables to copy-paste.

---

## Step 1 — Create a Railway account

1. Go to [railway.app](https://railway.app)
2. Click **Login** → **Login with GitHub**
3. Authorise Railway to access your GitHub

## Step 2 — Create a new project

1. On the Railway dashboard click **New Project**
2. Choose **Deploy from GitHub repo**
3. Find and select **Quant-Research-Deriv**
4. Railway starts building — let it finish (3–5 minutes)

## Step 3 — Add a PostgreSQL database

1. Inside your Railway project, click **New** (the + button)
2. Choose **Database** → **Add PostgreSQL**
3. Railway creates the database and automatically injects `DATABASE_URL` into your app

## Step 4 — Link the database to your app

Railway can wire the database automatically using a Reference Variable:

1. Click on your **app service** → **Variables** tab → **New Variable**
2. Name: `DATABASE_URL` — Value: `${{Postgres.DATABASE_URL}}`

That is the only variable you need to set manually.

> Railway also injects `PORT` automatically — you do not need to set it.

## Step 5 — Generate a public domain

1. Click on your app service → **Settings** tab
2. Under **Networking → Public Networking** click **Generate Domain**
3. You get a URL like `your-app.up.railway.app`

## Step 6 — Configure the app from the UI

Open your new URL and go to **Settings**. Everything else is configured here:

| What | Where in Settings |
|------|------------------|
| Deriv API token | Settings → API Keys → Deriv API Token |
| OpenAI key (optional) | Settings → API Keys → OpenAI API Key |
| Live / Paper / Idle mode | Settings → Trading Mode |
| Risk limits, position sizing | Settings → Risk Controls / Position Sizing |

Switching to **Live** mode requires a Deriv API token to be saved first — the app will tell you if it is missing.

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
