#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

./run.sh voting_api_load_test.js \
  "BASE_URL=${BASE_URL:-https://uatapi.himalpay.com.np/api/v1}" \
  "API_KEY=${API_KEY:-3c7b0c0e-d3e3-4bc6-978d-8663cc97a276}" \
  "PACKAGE_RPS=${PACKAGE_RPS:-300}" \
  "AMOUNT_RPS=${AMOUNT_RPS:-300}" \
  "DURATION=${DURATION:-1s}" \
  "VOTER_ID=${VOTER_ID:-9849820662}"
