// Formats check-queues.js RESULT_JSON rows into short human-readable lines.
// Column layout mirrors playwright/watch-approvals.js (kept in sync manually
// — both read the same detail-array shape emitted by check-queues.js).
const LOCAL_TZ = 'Asia/Taipei';

const LAYOUT = {
  pre_overtime: { label: '預定加班單', fmt: (d) => `${md(d[4])} ${hm(d[5])}–${hm(d[7])}` },
  overtime: { label: '加班單', fmt: (d) => `${md(d[4])} ${hm(d[5])}起 ${d[6]}h${d[10] ? ' ' + d[10] : ''}` },
  leave: { label: '假單', fmt: (d) => `${d[4]} ${md(d[5])} ${hm(d[6])}–${hm(d[8])} ${+d[9] > 0 ? `${d[9]}天` : ''}${+d[10] > 0 ? `${d[10]}h` : ''}`.trim() },
  abnormal: { label: '異常', fmt: (d) => d.slice(4).filter(Boolean).join(' ') },
};

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
  if (!iso) iso = new Date().toISOString();
  try {
    return new Date(iso).toLocaleString('sv-SE', { timeZone: LOCAL_TZ }).replace('T', ' ');
  } catch {
    return iso;
  }
}

function describeRow(queueKey, row) {
  const { fmt } = LAYOUT[queueKey];
  let detail = '';
  try {
    detail = fmt(row.detail) || '';
  } catch {
    detail = '';
  }
  return `${row.name}(${row.id})${detail ? ' ' + detail : ''}`;
}

function describeRows(queueKey, rows) {
  return rows.map((r) => describeRow(queueKey, r));
}

// Same info as describeRows, but grouped by name (no 工號, and one person's
// multiple rows collapse onto a single entry) — e.g. "洪瑞菁(9/7 18:00–23:00、
// 9/8 18:00–23:00)" instead of repeating "洪瑞菁(006882)" once per row.
function describeGroupedRows(queueKey, rows) {
  const { fmt } = LAYOUT[queueKey];
  const byName = new Map();
  for (const r of rows) {
    let detail = '';
    try {
      detail = fmt(r.detail) || '';
    } catch {
      detail = '';
    }
    if (!byName.has(r.name)) byName.set(r.name, []);
    if (detail) byName.get(r.name).push(detail);
  }
  return [...byName.entries()]
    .map(([name, frags]) => (frags.length ? `${name}(${frags.join('、')})` : name))
    .join('、');
}

module.exports = { LAYOUT, localTime, describeRow, describeRows, describeGroupedRows };
