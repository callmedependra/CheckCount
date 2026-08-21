import http from 'k6/http';
import { check } from 'k6';

// GET {{base_url}}/wallet/reseller-balance
// Use this on its own to check current balance, or to load-test the balance
// endpoint itself (separate from the voting/payment endpoints).
//
// Example:
//   k6 run --env BALANCE_RPS=5 --env DURATION=10s reseller_api_load_test.js

const BASE_URL = __ENV.BASE_URL || 'https://uatapi.himalpay.com.np/api/v1';
const API_KEY = __ENV.API_KEY || '3c7b0c0e-d3e3-4bc6-978d-8663cc97a276';
const RPS = Number(__ENV.BALANCE_RPS || 1);
const DURATION = __ENV.DURATION || '5s';

export const options = {
  scenarios: {
    reseller_balance: {
      executor: 'constant-arrival-rate',
      rate: RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.max(20, RPS * 2),
      maxVUs: Math.max(50, RPS * 4),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
  },
};

function safeBody(res) {
  try {
    return res.body === null || res.body === undefined ? '' : String(res.body);
  } catch (e) {
    return '';
  }
}

export default function () {
  const res = http.get(`${BASE_URL}/wallet/reseller-balance`, {
    headers: { 'x-api-key': API_KEY },
    tags: { scenario: 'reseller_balance' },
  });

  let parsed = null;
  try {
    parsed = JSON.parse(safeBody(res));
  } catch (e) {
    parsed = null;
  }

  const ok = check(res, {
    'balance: status is 200': (r) => r.status === 200,
    'balance: has total_balance_in_rupees': () => parsed && typeof parsed.total_balance_in_rupees === 'number',
  });

  // Same REQLOG format as voting_api_load_test.js so parselog.js can read either.
  console.log(
    'REQLOG ' +
      JSON.stringify({
        vu: __VU,
        iter: __ITER,
        step: 'reseller_balance',
        endpoint: `${BASE_URL}/wallet/reseller-balance`,
        method: 'GET',
        timestamp: new Date().toISOString(),
        status_code: res.status,
        response_time_ms: Math.round(res.timings.duration),
        request_body: '',
        response_body: safeBody(res),
        result: ok ? 'SUCCESS' : 'FAILED',
        fail_reason: ok ? '' : `status_${res.status}`,
      })
  );
}
