# ── Stage 1: Build the React frontend ─────────────────────────────────────────
FROM node:24-slim AS frontend
RUN npm install -g pnpm
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY lib/                        ./lib/
COPY artifacts/deriv-quant/      ./artifacts/deriv-quant/

RUN pnpm install --frozen-lockfile

# BASE_PATH=/ so the app is served at the root.
# PORT is required by the vite config validator (not used at build time).
ENV BASE_PATH=/
ENV PORT=3000
ENV NODE_ENV=production

RUN pnpm --filter @workspace/deriv-quant run build

# ── Stage 2: Run the API server ────────────────────────────────────────────────
FROM node:24-slim AS app
RUN apt-get update && apt-get install -y curl --no-install-recommends && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY lib/                        ./lib/
COPY artifacts/api-server/       ./artifacts/api-server/
COPY scripts/                    ./scripts/

# Copy the built frontend (outputs to dist/public)
COPY --from=frontend /app/artifacts/deriv-quant/dist ./artifacts/deriv-quant/dist

RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
ENV SERVE_FRONTEND=true

CMD ["pnpm", "--filter", "@workspace/api-server", "exec", "tsx", "./src/index.ts"]
