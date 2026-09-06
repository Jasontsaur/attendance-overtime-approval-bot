// Queries the local CSV audit log (playwright/logs/approval-log-YYYY-MM.csv,
// written by check-queues.js) for a summary of what happened this week/month.
// Filters by each row's own `timestamp` column (when the check/approval
// actually ran) — NOT by which monthly file it landed in, since rows are
// filed by the *event's* date and can land in a different month's file than
// the run that produced them (see check-queues.js's appendLogRows comment).
// So every log file is scanned; this stays cheap since the log is small.
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOCAL_TZ = 'Asia/Taipei';

const QUEUE_LABEL = { 預定加班單簽核: '預定加班單簽核', 加班單簽核: '加班單簽核', 假單簽核: '假單簽核', 異常簽核: '異常簽核' };

// Parses a whole CSV file's text into records (each an array of fields),
// respecting quoted fields that contain a literal newline (check-queues.js
// quotes any field containing a comma/quote/newline — 異常簽核's detail
// column regularly has embedded newlines, e.g. "20260903\n0800" from its
// 員工補登出勤時間 field — so naively splitting the whole file on '\n' would
// cut such a record in half).
function parseCsvRecords(text) {
  const records = [];
  let fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      fields.push(cur);
      cur = '';
      if (fields.length > 1 || fields[0] !== '') records.push(fields);
      fields = [];
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  if (fields.length > 1 || fields[0] !== '') records.push(fields);
  return records;
}

function readAllRows() {
  let files = [];
  try {
    files = fs.readdirSync(LOG_DIR).filter((f) => /^approval-log-\d{4}-\d{2}\.csv$/.test(f));
  } catch {
    return [];
  }
  const rows = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(LOG_DIR, file), 'utf8');
    const records = parseCsvRecords(text);
    for (let i = 1; i < records.length; i++) { // skip header
      const [timestamp, queue, status, action, name, id, detail] = records[i];
      if (!timestamp) continue;
      rows.push({ timestamp, queue, status, action, name, id, detail });
    }
  }
  return rows;
}

// Calendar-date (y,m,d) in Asia/Taipei for a given ISO timestamp, or now.
function taipeiDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  const s = d.toLocaleDateString('en-CA', { timeZone: LOCAL_TZ }); // "YYYY-MM-DD"
  const [y, m, day] = s.split('-').map(Number);
  return { y, m, d: day, key: s };
}

function daysBetween(a, b) {
  const ms = Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d);
  return Math.round(ms / 86400000);
}

function inRange(rowDate, range) {
  const today = taipeiDate();
  if (range === 'month') {
    return rowDate.y === today.y && rowDate.m === today.m;
  }
  // week: Monday..today (Taiwan convention)
  const todayWeekday = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (todayWeekday + 6) % 7;
  const diff = daysBetween(today, rowDate); // >=0 means rowDate is today or in the past
  return diff >= 0 && diff <= daysSinceMonday;
}

function query(range) {
  const rows = readAllRows().filter((r) => r.status !== 'empty' && inRange(taipeiDate(r.timestamp), range));
  const label = range === 'month' ? '本月' : '本週';
  if (rows.length === 0) return `${label}沒有任何簽核紀錄。`;

  const byQueue = {};
  for (const r of rows) {
    byQueue[r.queue] = byQueue[r.queue] || { approved: 0, still_pending: 0, reported: 0, names: [] };
    const bucket = byQueue[r.queue];
    if (r.status === 'approved') bucket.approved++;
    else if (r.status === 'still_pending') bucket.still_pending++;
    else if (r.status === 'reported') bucket.reported++;
    if (r.name) bucket.names.push(`${r.name}${r.status === 'approved' ? '' : `(${r.status})`}`);
  }

  const lines = [`${label}簽核紀錄（共 ${rows.length} 筆）：`];
  for (const [queue, b] of Object.entries(byQueue)) {
    const parts = [];
    if (b.approved) parts.push(`已核准 ${b.approved}`);
    if (b.still_pending) parts.push(`待確認 ${b.still_pending}`);
    if (b.reported) parts.push(`僅回報 ${b.reported}`);
    lines.push(`${queue}：${parts.join('、')}\n  ${b.names.join('、')}`);
  }
  return lines.join('\n');
}

module.exports = { query };
