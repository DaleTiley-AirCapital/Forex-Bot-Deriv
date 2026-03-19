# Deploy Deriv Quant to Railway

## What you need

- A GitHub account (you already have this)
- Your Deriv API token
- 5 minutes

## Step 1 — Create a Railway account

1. Go to [railway.app](https://railway.app)
2. Click **Login** → **Login with GitHub**
3. Authorise Railway to access your GitHub

## Step 2 — Create a new project

1. On the Railway dashboard click **New Project**
2. Choose **Deploy from GitHub repo**
3. Find and select **Quant-Research-Deriv**
4. Railway will start building — let it finish (takes 3-5 minutes)

## Step 3 — Add a PostgreSQL database

1. Inside your Railway project, click **New** (the + button)
2. Choose **Database** → **Add PostgreSQL**
3. Railway creates the database and automatically sets `DATABASE_URL`

## Step 4 — Set environment variables

1. Click on your **app service** (not the database)
2. Go to the **Variables** tab
3. Click **New Variable** and add these one at a time:

| Variable              | Value                              |
|-----------------------|------------------------------------|
| `Deriv_Api_Token`     | Your token from app.deriv.com      |
| `SERVE_FRONTEND`      | `true`                             |
| `NODE_ENV`            | `production`                       |
| `LIVE_TRADING_ENABLED`| `false`                            |

Railway automatically provides `PORT` and `DATABASE_URL` — you do not need to set them manually.

## Step 5 — Link the database to your app

1. Click on the **PostgreSQL** service
2. Go to **Variables** tab
3. Copy the `DATABASE_URL` value
4. Click on your **app service** → **Variables** tab
5. Add a new variable: `DATABASE_URL` → paste the value you copied

Alternatively, use Railway's **Reference Variables**:
1. Click on your app service → Variables → New Variable
2. Name: `DATABASE_URL`, Value: `${{Postgres.DATABASE_URL}}`

## Step 6 — Deploy

Railway auto-deploys when you push to GitHub. To trigger a manual deploy:
1. Click on your app service
2. Go to **Deployments** tab
3. Click **Redeploy** on the latest deployment

## Step 7 — Open your dashboard

1. Click on your app service
2. Go to **Settings** tab
3. Under **Networking** → **Public Networking**, click **Generate Domain**
4. Railway gives you a URL like `your-app-production-xxxx.up.railway.app`
5. Open that URL in any browser — your dashboard is live

## Updating the app

When you make changes in Replit:
1. Commit your changes in Replit's Git panel
2. Push to GitHub
3. Railway automatically detects the push and redeploys (takes 3-5 minutes)

## Costs

Railway offers a free trial with $5 credit. After that, the Hobby plan is $5/month which includes:
- 8 GB RAM, 8 vCPU
- 100 GB bandwidth
- PostgreSQL database included

For a trading bot running 24/7, expect roughly $5-10/month total.

## Troubleshooting

**App won't start:**
- Check the **Deployments** tab → click on the latest deployment → view logs
- Make sure all environment variables are set correctly
- Make sure `DATABASE_URL` is connected to the PostgreSQL service

**Can't see the dashboard:**
- Make sure you generated a public domain (Step 7)
- Check that `SERVE_FRONTEND=true` is set

**Database errors:**
- The app creates all tables automatically on first start
- Check that `DATABASE_URL` points to your Railway PostgreSQL instance
