#!/usr/bin/env node
'use strict';

// Parses a k6 console log (containing REQLOG / BALANCE lines printed by the
// test scripts) into:
//   - requests_log.csv  : one row per request
//   - full_report.json  : balance before/after, usage, success/fail totals
//
// Usage:
//   node parselog.js [k6_run.log] [output_dir]

const fs = require('fs');
const path = require('path');

const logFile = process.argv[2] || 'k6_run.log';
const outDir = process.argv[3] || '.';

if (!fs.existsSync(logFile)) {
  console.error(`Log file not found: ${logFile}`);
  process.exit(1);
}

const lines = fs.readFileSync(logFile, 'utf8').split('\n');

const requests = [];
const balances = {};

for (const line of lines) {
  const reqIdx = line.indexOf('REQLOG ');
  const balIdx = line.indexOf('BALANCE ');

  if (reqIdx !== -1) {
    try {
      requests.push(JSON.parse(line.slice(reqIdx + 'REQLOG '.length).trim()));
    } catch (e) {
      /* skip malformed line */
    }
  } else if (balIdx !== -1 && line.indexOf('BALANCE_DELTA ') === -1) {
    try {
      const entry = JSON.parse(line.slice(balIdx + 'BALANCE '.length).trim());
      balances[entry.label] = entry;
    } catch (e) {
      /* skip malformed line */
    }
  }
}

// ---------------------------------------------------------------------------
// requests_log.csv
// ---------------------------------------------------------------------------
const csvHeader = [
  'vu', 'iter', 'step', 'endpoint', 'method', 'timestamp',
  'status_code', 'response_time_ms', 'result', 'fail_reason',
  'request_body', 'response_body',
];
const csvEscape = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRows = [csvHeader.join(',')];
for (const r of requests) {
  csvRows.push(csvHeader.map((k) => csvEscape(r[k])).join(','));
}
fs.writeFileSync(path.join(outDir, 'requests_log.csv'), csvRows.join('\n') + '\n');

// ---------------------------------------------------------------------------
// full_report.json
// ---------------------------------------------------------------------------
const scenarios = {};
for (const r of requests) {
  const step = r.step || 'unknown';
  if (!scenarios[step]) {
    scenarios[step] = { success_count: 0, success_amount: 0, failed_count: 0, failed_amount: 0 };
  }
  let amount = 0;
  try {
    const body = JSON.parse(r.request_body || '{}');
    amount = Number(body.amount || 0);
  } catch (e) {
    /* no amount on this request type (e.g. balance check) */
  }

  if (r.result === 'SUCCESS') {
    scenarios[step].success_count += 1;
    scenarios[step].success_amount += amount;
  } else {
    scenarios[step].failed_count += 1;
    scenarios[step].failed_amount += amount;
  }
}

const totals = Object.values(scenarios).reduce(
  (acc, s) => {
    acc.success_count += s.success_count;
    acc.success_amount += s.success_amount;
    acc.failed_count += s.failed_count;
    acc.failed_amount += s.failed_amount;
    return acc;
  },
  { success_count: 0, success_amount: 0, failed_count: 0, failed_amount: 0 }
);

const before = balances.before || null;
const after = balances.after || null;
const beforeRupees = before && before.body ? before.body.total_balance_in_rupees : null;
const afterRupees = after && after.body ? after.body.total_balance_in_rupees : null;

const balanceSummary = {
  user: before && before.body ? before.body.user : null,
  before_total_rupees: beforeRupees,
  after_total_rupees: afterRupees,
  total_used_rupees: beforeRupees != null && afterRupees != null ? beforeRupees - afterRupees : null,
  before_bonus_rupees: before && before.body ? before.body.bonus_balance_in_rupees : null,
  after_bonus_rupees: after && after.body ? after.body.bonus_balance_in_rupees : null,
};

const totalRequests = totals.success_count + totals.failed_count;

const report = {
  generated_at: new Date().toISOString(),
  source_log: path.resolve(logFile),
  reseller_balance: balanceSummary,
  scenarios,
  totals: Object.assign({}, totals, {
    total_requests: totalRequests,
    success_rate_pct: totalRequests > 0 ? Number(((totals.success_count / totalRequests) * 100).toFixed(2)) : 0,
  }),
};

fs.writeFileSync(path.join(outDir, 'full_report.json'), JSON.stringify(report, null, 2) + '\n');

console.log(`Wrote ${path.join(outDir, 'requests_log.csv')} (${requests.length} requests)`);
console.log(`Wrote ${path.join(outDir, 'full_report.json')}`);
console.log(JSON.stringify(report.totals, null, 2));
