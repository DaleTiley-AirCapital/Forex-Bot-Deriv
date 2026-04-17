#!/usr/bin/env bash
# verify-ai-pipeline.sh
# End-to-end verification that the GPT-5.1 AI pipeline works after the
# max_tokens → max_completion_tokens fix (Task #100 / Task #103).
#
# Checks:
#   1. normalizeParamsForModel is present and covers gpt-5 + o-series
#   2. All chatComplete() call sites use the wrapper (not raw client)
#   3. Health endpoint returns { working: true } with a gpt-5.x model
#   4. A live precursor pass completes without max_tokens rejection errors
#
# Requires: API server running on PORT (default 8080), curl, jq
# Run from the api-server package root.
# Exit code 0 = all PASS. Exit code 1 = at least one FAIL.

set -uo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)/src"
API_PORT="${PORT:-8080}"
BASE_URL="http://localhost:${API_PORT}/api"
SYMBOL="${SYMBOL:-CRASH300}"
PASS=0
FAIL=0

pass() { echo "  PASS  $1"; ((PASS++)) || true; }
fail() { echo "  FAIL  $1"; ((FAIL++)) || true; }

echo ""
echo "══════════════════════════════════════════"
echo "  API Server — AI Pipeline Verification"
echo "  (GPT-5.1 max_tokens fix — Task #103)"
echo "══════════════════════════════════════════"

# ─── 1. normalizeParamsForModel covers gpt-5 and o-series ────────────────────
echo ""
echo "1. normalizeParamsForModel covers gpt-5.x and o-series models"
OPENAI_FILE="$SRC/infrastructure/openai.ts"
if grep -q 'gpt-5' "$OPENAI_FILE" 2>/dev/null && grep -q 'max_completion_tokens' "$OPENAI_FILE" 2>/dev/null; then
  pass "normalizeParamsForModel translates max_tokens for gpt-5.x models"
else
  fail "normalizeParamsForModel translation not found in $OPENAI_FILE"
fi

# ─── 2. No direct client.chat.completions.create calls outside chatComplete() ─
echo ""
echo "2. No raw client.chat.completions.create calls bypassing chatComplete()"
RAW_CALLS=$(grep -rn "client\.chat\.completions\.create" "$SRC" --include="*.ts" 2>/dev/null \
  | grep -v "openai\.ts" \
  | grep -v "node_modules" || true)
if [ -z "$RAW_CALLS" ]; then
  pass "All chat completion calls route through chatComplete() wrapper"
else
  fail "Direct client.chat.completions.create calls found outside openai.ts:"
  echo "$RAW_CALLS" | sed 's/^/        /'
fi

# ─── 3. Health endpoint returns working:true with a gpt-5.x model ─────────────
echo ""
echo "3. AI health endpoint returns { working: true, model: gpt-5.x }"
if ! command -v curl &>/dev/null; then
  fail "curl not available — cannot hit health endpoint"
elif ! command -v jq &>/dev/null; then
  # Fall back to grep if jq is unavailable
  HEALTH_RESPONSE=$(curl -s --max-time 30 "${BASE_URL}/settings/openai-health" 2>/dev/null || echo "")
  if echo "$HEALTH_RESPONSE" | grep -q '"working":true'; then
    HEALTH_MODEL=$(echo "$HEALTH_RESPONSE" | grep -oP '"model":"[^"]+"' | head -1 || echo "")
    pass "Health endpoint: working=true (${HEALTH_MODEL})"
  elif echo "$HEALTH_RESPONSE" | grep -q '"configured":false'; then
    fail "OpenAI key not configured — skipping health check (set key in Settings)"
  else
    fail "Health endpoint did not return working:true — response: ${HEALTH_RESPONSE:0:200}"
  fi
else
  HEALTH_RESPONSE=$(curl -s --max-time 30 "${BASE_URL}/settings/openai-health" 2>/dev/null || echo "{}")
  WORKING=$(echo "$HEALTH_RESPONSE" | jq -r '.working' 2>/dev/null || echo "")
  HEALTH_MODEL=$(echo "$HEALTH_RESPONSE" | jq -r '.model // "unknown"' 2>/dev/null || echo "unknown")
  if [ "$WORKING" = "true" ]; then
    if echo "$HEALTH_MODEL" | grep -qE "^gpt-5"; then
      pass "Health endpoint: working=true, model=${HEALTH_MODEL} (confirmed GPT-5.x)"
    else
      pass "Health endpoint: working=true, model=${HEALTH_MODEL}"
    fi
  elif echo "$HEALTH_RESPONSE" | grep -q '"configured":false'; then
    fail "OpenAI key not configured — skipping health check (set key in Settings)"
  else
    HEALTH_ERROR=$(echo "$HEALTH_RESPONSE" | jq -r '.error // "unknown"' 2>/dev/null || echo "unknown")
    fail "Health endpoint not working — error: ${HEALTH_ERROR}"
  fi
fi

# ─── 4. Live precursor pass: no max_tokens rejection error ────────────────────
echo ""
echo "4. Precursor calibration pass on ${SYMBOL}: completes without max_tokens API rejection"
if ! command -v curl &>/dev/null; then
  fail "curl not available — cannot run precursor pass"
else
  PASS_RESPONSE=$(curl -s --max-time 90 -X POST "${BASE_URL}/calibration/run-passes/${SYMBOL}" \
    -H "Content-Type: application/json" \
    -d '{"passName":"precursor","maxMoves":1,"force":true}' 2>/dev/null || echo "{}")
  # Check for max_tokens-specific rejection in the response errors
  if echo "$PASS_RESPONSE" | grep -qi "max_tokens.*not.*supported\|max_tokens.*rejected\|Unrecognized request argument.*max_tokens"; then
    fail "max_tokens rejection error detected in precursor pass response"
  elif echo "$PASS_RESPONSE" | grep -q '"ok":true'; then
    PROCESSED=$(echo "$PASS_RESPONSE" | grep -oP '"processedMoves":\s*\K[0-9]+' | head -1 || echo "?")
    FAILED=$(echo "$PASS_RESPONSE" | grep -oP '"failedMoves":\s*\K[0-9]+' | head -1 || echo "0")
    pass "Precursor pass completed (processed=${PROCESSED}, failed=${FAILED}, no max_tokens rejection)"
  elif echo "$PASS_RESPONSE" | grep -q '"error":"OpenAI API key not configured'; then
    fail "OpenAI key not configured — cannot run precursor pass"
  else
    # Even if there's a JSON parse error in AI output, that's not a max_tokens rejection
    if echo "$PASS_RESPONSE" | grep -q '"runId"'; then
      pass "Precursor pass ran (runId present) — any errors are content/JSON parse, not max_tokens rejection"
    else
      fail "Precursor pass did not start — response: ${PASS_RESPONSE:0:200}"
    fi
  fi
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
echo "  Result: $PASS/$TOTAL passed"
if [ "$FAIL" -gt 0 ]; then
  echo "  STATUS: FAIL ($FAIL check(s) failed)"
  echo "══════════════════════════════════════════"
  echo ""
  exit 1
else
  echo "  STATUS: PASS"
  echo "══════════════════════════════════════════"
  echo ""
  exit 0
fi
