#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Usage: ./run.sh <script.js> [KEY=VALUE ...]
# Example:
#   ./run.sh voting_api_load_test.js BASE_URL=https://uatapi.himalpay.com.np/api/v1 \
#       API_KEY=your_key PACKAGE_RPS=300 AMOUNT_RPS=300 DURATION=1s

SCRIPT="${1:?Usage: ./run.sh <script.js> [KEY=VALUE ...]}"
shift || true

ENV_ARGS=()
for kv in "$@"; do
  ENV_ARGS+=(--env "$kv")
done

echo "Running k6 script: $SCRIPT"
k6 run "${ENV_ARGS[@]}" --summary-export=summary.json "$SCRIPT" | tee k6_run.log

echo "Parsing k6_run.log into requests_log.csv and full_report.json..."
node parselog.js k6_run.log .

echo ""
echo "Done. Generated files:"
echo "  k6_run.log        - raw console output (REQLOG / BALANCE lines + k6 summary)"
echo "  summary.json       - k6's built-in end-of-run metrics summary"
echo "  requests_log.csv   - one row per request"
echo "  full_report.json   - balance before/after + success/failed counts & amounts"
