import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Config (override via --env NAME=value)
// ---------------------------------------------------------------------------
const BASE_URL = __ENV.BASE_URL || 'https://uatapi.himalpay.com.np/api/v1';
const API_KEY = __ENV.API_KEY || '3c7b0c0e-d3e3-4bc6-978d-8663cc97a276';
const PACKAGE_RPS = Number(__ENV.PACKAGE_RPS || 300);
const AMOUNT_RPS = Number(__ENV.AMOUNT_RPS || 300);
const DURATION = __ENV.DURATION || '1s';
const VOTER_ID = __ENV.VOTER_ID || '9849820662';

// ---------------------------------------------------------------------------
// Metrics (visible in the end-of-run k6 summary / summary.json)
// ---------------------------------------------------------------------------
const failCounter = new Counter('failed_requests');
const unknownStateCounter = new Counter('unknown_state_requests');

const packageSuccessCount = new Counter('package_success_count');
const packageSuccessAmount = new Counter('package_success_amount');
const packageFailedCount = new Counter('package_failed_count');
const packageFailedAmount = new Counter('package_failed_amount');

const amountSuccessCount = new Counter('amount_success_count');
const amountSuccessAmount = new Counter('amount_success_amount');
const amountFailedCount = new Counter('amount_failed_count');
const amountFailedAmount = new Counter('amount_failed_amount');

export const options = {
  scenarios: {
    package_payment: {
      executor: 'constant-arrival-rate',
      rate: PACKAGE_RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.max(100, PACKAGE_RPS * 2),
      maxVUs: Math.max(400, PACKAGE_RPS * 4),
      exec: 'packagePayment',
    },
    amount_payment: {
      executor: 'constant-arrival-rate',
      rate: AMOUNT_RPS,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.max(100, AMOUNT_RPS * 2),
      maxVUs: Math.max(400, AMOUNT_RPS * 4),
      exec: 'amountPayment',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<3000'],
  },
};

function headers() {
  return {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  };
}

function uniqueTxnId(prefix) {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1000000);
  return `${prefix}_${ts}_${__VU}_${__ITER}_${rand}`;
}

function safeBody(res) {
  try {
    return res.body === null || res.body === undefined ? '' : String(res.body);
  } catch (e) {
    return '';
  }
}

// A request is ONLY successful when: HTTP 200/201, valid JSON body, and
// body.status === 'SUCCESS' (exact match). Everything else -- including
// "processed but in unknown state", missing status, non-JSON body, or a
// non-2xx HTTP code -- is a FAILURE.
function evaluateResult(res) {
  const bodyText = safeBody(res);
  let parsed = null;
  let parseError = null;

  try {
    parsed = JSON.parse(bodyText);
  } catch (e) {
    parseError = e.message;
  }

  const httpOk = res.status === 200 || res.status === 201;
  const bodyStatus = parsed && typeof parsed === 'object' ? parsed.status : undefined;
  const isUnknownState = !parseError && typeof bodyText === 'string' && /unknown state/i.test(bodyText);
  const success = httpOk && !parseError && bodyStatus === 'SUCCESS';

  let reason = 'ok';
  if (!httpOk) {
    reason = `non_2xx_http_${res.status}`;
  } else if (parseError) {
    reason = `invalid_json_body: ${parseError}`;
  } else if (isUnknownState) {
    reason = 'unknown_state';
  } else if (bodyStatus !== 'SUCCESS') {
    reason = `status_not_success (got: ${bodyStatus === undefined ? 'missing' : bodyStatus})`;
  }

  return { parsed, isSuccess: success, isUnknownState, reason };
}

// Every line here is picked up by parselog.js to build requests_log.csv.
function logRequest(step, endpoint, method, reqBody, res, evalResult) {
  const entry = {
    vu: __VU,
    iter: __ITER,
    step,
    endpoint,
    method,
    timestamp: new Date().toISOString(),
    status_code: res.status,
    response_time_ms: Math.round(res.timings.duration),
    request_body: reqBody ? JSON.stringify(reqBody) : '',
    response_body: safeBody(res),
    result: evalResult.isSuccess ? 'SUCCESS' : 'FAILED',
    fail_reason: evalResult.isSuccess ? '' : evalResult.reason,
  };
  console.log('REQLOG ' + JSON.stringify(entry));
}

// GET {{base_url}}/wallet/reseller-balance -- amounts in paisa.
// Logged as BALANCE lines, picked up by parselog.js to compute usage.
function fetchBalance(label) {
  const res = http.get(`${BASE_URL}/wallet/reseller-balance`, {
    headers: headers(),
    tags: { scenario: 'balance_check' },
  });

  let parsed = null;
  try {
    parsed = JSON.parse(safeBody(res));
  } catch (e) {
    parsed = null;
  }

  console.log(
    'BALANCE ' +
      JSON.stringify({
        label,
        timestamp: new Date().toISOString(),
        status_code: res.status,
        response_time_ms: Math.round(res.timings.duration),
        body: parsed,
      })
  );

  if (!parsed) {
    console.error(`Failed to fetch/parse reseller balance for "${label}" (HTTP ${res.status})`);
  }

  return parsed;
}

// setup() runs once, before any VU traffic starts.
export function setup() {
  const before = fetchBalance('before');
  return { balanceBefore: before };
}

export function packagePayment() {
  const amount = 2000;
  const payload = JSON.stringify({
    wallet_service_name: 'VOTING_PAY',
    amount: amount,
    merchant_transaction_id: uniqueTxnId('TXN'),
    data: {
      contestantCode: '778',
      type: 'package',
      voterId: VOTER_ID,
      amount: amount,
      schemeId: 26,
    },
  });

  const res = http.post(`${BASE_URL}/payments/wallet-service-reseller-payment`, payload, {
    headers: headers(),
    tags: { scenario: 'package_payment' },
  });

  const evalResult = evaluateResult(res);
  logRequest('package_payment', `${BASE_URL}/payments/wallet-service-reseller-payment`, 'POST', JSON.parse(payload), res, evalResult);

  check(res, { 'package: response status is SUCCESS': () => evalResult.isSuccess });

  if (evalResult.isSuccess) {
    packageSuccessCount.add(1);
    packageSuccessAmount.add(amount);
  } else {
    packageFailedCount.add(1);
    packageFailedAmount.add(amount);
    failCounter.add(1);
    if (evalResult.isUnknownState) unknownStateCounter.add(1);
  }
}

export function amountPayment() {
  const amount = 30000;
  const payload = JSON.stringify({
    wallet_service_name: 'VOTING_PAY',
    amount: amount,
    merchant_transaction_id: uniqueTxnId('TXN'),
    data: {
      contestantCode: '778',
      type: 'amount',
      voterId: VOTER_ID,
      amount: amount,
    },
  });

  const res = http.post(`${BASE_URL}/payments/wallet-service-reseller-payment`, payload, {
    headers: headers(),
    tags: { scenario: 'amount_payment' },
  });

  const evalResult = evaluateResult(res);
  logRequest('amount_payment', `${BASE_URL}/payments/wallet-service-reseller-payment`, 'POST', JSON.parse(payload), res, evalResult);

  check(res, { 'amount: response status is SUCCESS': () => evalResult.isSuccess });

  if (evalResult.isSuccess) {
    amountSuccessCount.add(1);
    amountSuccessAmount.add(amount);
  } else {
    amountFailedCount.add(1);
    amountFailedAmount.add(amount);
    failCounter.add(1);
    if (evalResult.isUnknownState) unknownStateCounter.add(1);
  }
}

// teardown() runs once, after all VU traffic has finished.
export function teardown(data) {
  const after = fetchBalance('after');

  if (data && data.balanceBefore && after) {
    const usedRupees = data.balanceBefore.total_balance_in_rupees - after.total_balance_in_rupees;
    const usedPaisa = data.balanceBefore.total_balance - after.total_balance;
    console.log(
      'BALANCE_DELTA ' +
        JSON.stringify({
          before_total_rupees: data.balanceBefore.total_balance_in_rupees,
          after_total_rupees: after.total_balance_in_rupees,
          used_rupees: usedRupees,
          used_paisa: usedPaisa,
        })
    );
  }
}
