# k6 Voting/Payment Load Test

Load tests the voting payment endpoint (`package` and `amount` flows) and
tracks reseller wallet balance before/after the run, with CSV/JSON reports.

## Files

| File | Purpose |
|---|---|
| `voting_api_load_test.js` | Main k6 test — hits `package_payment` and `amount_payment` scenarios concurrently, checks balance before (`setup`) and after (`teardown`). |
| `reseller_api_load_test.js` | Standalone script to check or load-test just the `GET /wallet/reseller-balance` endpoint. |
| `parselog.js` | Node script that parses `k6_run.log` into `requests_log.csv` and `full_report.json`. |
| `run.sh` | Generic runner — `./run.sh <script.js> [KEY=VALUE ...]`. Runs k6, tees output to `k6_run.log`, exports `summary.json`, then runs `parselog.js`. |
| `run_voting.sh` | Preset: runs `voting_api_load_test.js` at 300/300 RPS (override via env vars). |
| `run_payment_160.sh` | Preset: same test at 160/160 RPS. |

## Requirements

- [k6](https://k6.io/docs/get-started/installation/) installed and on `PATH`.
- Node.js (v14+) for `parselog.js`.

## Usage

```bash
chmod +x run.sh run_voting.sh run_payment_160.sh

# default 300/300 RPS
./run_voting.sh

# 160/160 RPS
./run_payment_160.sh

# custom
BASE_URL=https://uatapi.himalpay.com.np/api/v1 \
API_KEY=your_key \
PACKAGE_RPS=500 AMOUNT_RPS=100 DURATION=30s \
./run.sh voting_api_load_test.js BASE_URL=$BASE_URL API_KEY=$API_KEY \
  PACKAGE_RPS=$PACKAGE_RPS AMOUNT_RPS=$AMOUNT_RPS DURATION=$DURATION

# check/load-test just the balance endpoint
./run.sh reseller_api_load_test.js BALANCE_RPS=5 DURATION=10s
```

## Output files (generated after each run)

- **`k6_run.log`** — full console output, including per-request `REQLOG` lines
  and `BALANCE` / `BALANCE_DELTA` lines.
- **`summary.json`** — k6's built-in end-of-run metrics summary (`--summary-export`).
- **`requests_log.csv`** — one row per request: `vu, iter, step, endpoint, method,
  timestamp, status_code, response_time_ms, result, fail_reason, request_body,
  response_body`.
- **`full_report.json`** — the easy-to-read summary:
  - `reseller_balance`: user, balance before/after (rupees), total used, bonus balance before/after
  - `scenarios`: per-scenario (`package_payment`, `amount_payment`) success/failed count and amount
  - `totals`: overall success/failed count, amount, total requests, success rate %

## Success criteria

A request only counts as `SUCCESS` when:
1. HTTP status is `200` or `201`, **and**
2. the response body is valid JSON, **and**
3. `body.status === 'SUCCESS'` exactly.

Anything else — including "processed but in unknown state", a missing
`status` field, a non-JSON body, or a non-2xx HTTP code — counts as `FAILED`.

## Notes on amounts

- `package_payment` sends `amount: 2000` per request; `amount_payment` sends
  `amount: 30000` per request — these are the raw values from the request
  payload, used for the per-scenario success/failed amount totals.
- The reseller balance endpoint reports amounts in **paisa**, with
  `*_in_rupees` convenience fields — `full_report.json` uses the rupee fields
  for `total_used_rupees`. Confirm with your payment team whether the
  request-payload `amount` unit matches the balance endpoint's rupee unit
  before comparing the two directly.
