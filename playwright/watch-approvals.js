#!/usr/bin/env node
// Reads scheduled-run.log lines on stdin (fed by `tail -F`) and, for each
// RESULT_JSON line, prints a terse summary ONLY when that run did something
// worth telling the user about: rows approved on their behalf, rows left
// waiting for their decision, or an error. Uneventful runs print nothing, so
// this stays quiet through the many all-empty scheduled checks.
const readline = require('readline');

const LOCAL_TZ = 'Asia/Taipei';

// Column layouts per queue (index into the row's `detail` array). Column 0/1
// are the 簽核/駁回 radios, 2 = 姓名, 3 = 工號; the rest differ per queue.
const LAYOUT = {
  pre_overtime: { label: '預定加班單', fmt: (d) => `${md(d[4])} ${hm(d[5])}–${hm(d[7])}` },
  overtime: { label: '加班單', fmt: (d) => `${md(d[4])} ${hm(d[5])}起 ${d[6]}h${d[10] ? ' ' + d[10] : ''}` },
  // 假單 has both a 天數 (d[9]) and a 時數 (d[10]) column: a full-day leave is
  // 1 day / 0 hours, a partial one 0 days / N hours. Show whichever is set, or
  // the request reads as "0h".
  leave: { label: '假單', fmt: (d) => `${d[4]} ${md(d[5])} ${hm(d[6])}–${hm(d[8])} ${+d[9] > 0 ? `${d[9]}天` : ''}${+d[10] > 0 ? `${d[10]}h` : ''}`.trim() },
  abnormal: { label: '異常', fmt: (d) => d.slice(4).filter(Boolean).join(' ') },
};

// 起始日期 arrives either Gregorian (20260904) or ROC (1150904) — show M/D.
function md(v) {
  const s = String(v || '');
  if (/^\d{8}$/.test(s)) return `${+s.slice(4, 6)}/${+s.slice(6, 8)}`;
  if (/^\d{7}$/.test(s)) return `${+s.slice(3, 5)}/${+s.slice(5, 7)}`;
  return s;
}

function hm(v) {
  const s = String(v || '');
  return /^\d{4}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2)}` : s;
}

function localTime(iso) {
  // A FATAL result carries no timestamp — fall back to now, which is within
  // seconds of when the failing run emitted the line.
  if (!iso) iso = new Date().toISOString();
  try {
    return new Date(iso).toLocaleString('sv-SE', { timeZone: LOCAL_TZ }).replace('T', ' ');
  } catch {
    return iso;
  }
}

function describe(queueKey, rows) {
  const { fmt } = LAYOUT[queueKey];
  return rows.map((r) => {
    let detail = '';
    try {
      detail = fmt(r.detail) || '';
    } catch {
      detail = '';
    }
    return `${r.name}(${r.id})${detail ? ' ' + detail : ''}`;
  });
}

// A row left waiting reappears in every subsequent run until it's signed, so
// only report each one the first time it's seen (approvals are one-off events
// and are always reported).
const reportedWaiting = new Set();
const sig = (key, r) => `${key}|${r.id}|${(r.detail || []).join('')}`;

// A failed run is held this long before being reported, so the automatic
// re-login + retry inside scheduled-check.sh gets a chance to cancel it.
const FAILURE_GRACE_MS = Number(process.env.FAILURE_GRACE_MS || 90000);
let pendingFailure = null;

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const marker = 'RESULT_JSON:';
  const i = line.indexOf(marker);
  if (i === -1) return;

  let res;
  try {
    res = JSON.parse(line.slice(i + marker.length));
  } catch {
    return;
  }

  const q = res.queues || {};
  const out = [];

  for (const key of ['pre_overtime', 'overtime', 'leave']) {
    const approved = (q[key] && q[key].approved) || [];
    if (approved.length) {
      out.push(`已代簽 ${LAYOUT[key].label} ${approved.length} 筆：${describe(key, approved).join('、')}`);
    }
  }

  for (const key of ['overtime', 'leave']) {
    const waiting = ((q[key] && q[key].stillPending) || []).filter((r) => !reportedWaiting.has(sig(key, r)));
    if (waiting.length) {
      waiting.forEach((r) => reportedWaiting.add(sig(key, r)));
      out.push(`待你確認 ${LAYOUT[key].label} ${waiting.length} 筆：${describe(key, waiting).join('、')}`);
    }
  }

  const abnormal = ((q.abnormal && q.abnormal.pending) || []).filter((r) => !reportedWaiting.has(sig('abnormal', r)));
  if (abnormal.length) {
    abnormal.forEach((r) => reportedWaiting.add(sig('abnormal', r)));
    out.push(`異常簽核 ${abnormal.length} 筆（僅回報）：${describe('abnormal', abnormal).join('、')}`);
  }

  // scheduled-check.sh re-logs-in and retries after a failed run, so a failure
  // is only worth reporting if nothing recovers it. Hold it briefly; a clean
  // RESULT_JSON arriving from the retry cancels the alarm.
  if (res.error) {
    const msg = `⚠ 排程執行失敗且未自動恢復：${res.error}${res.message ? ' — ' + String(res.message).split('\n')[0] : ''}`;
    clearTimeout(pendingFailure);
    pendingFailure = setTimeout(() => {
      console.log(`排程檢查 ${localTime(null)}`);
      console.log('  ' + msg);
    }, FAILURE_GRACE_MS);
    return;
  }
  clearTimeout(pendingFailure); // this run succeeded — retract any held alarm

  if (out.length === 0) return; // quiet run — nothing the user needs

  console.log(`排程檢查 ${localTime(res.timestamp)}`);
  for (const l of out) console.log('  ' + l);
});
