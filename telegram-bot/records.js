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

// A still-pending (or reported) request gets re-logged on every check run
// that observes it still open — the same underlying request can appear
// dozens of times across a week. Pull a short M/D label out of the raw
// detail string so entries stay distinguishable after collapsing repeats.
// Returns { label: "M/D", sortKey: MMDD } or null.
function extractDateLabel(detail) {
  for (const t of String(detail || '').split('|').map((s) => s.trim())) {
    let m, d;
    if (/^\d{8}$/.test(t)) { m = +t.slice(4, 6); d = +t.slice(6, 8); }
    else if (/^\d{7}$/.test(t)) { m = +t.slice(3, 5); d = +t.slice(5, 7); }
    else continue;
    return { label: `${m}/${d}`, sortKey: m * 100 + d };
  }
  return null;
}

const STATUS_LABEL = { approved: '', still_pending: '待確認', reported: '僅回報' };
// Once a request is approved it never gets logged as still_pending/reported
// again, so when the same (queue,name,id,detail) key shows up under more
// than one status across the range, 'approved' is simply the later, final
// state — prefer it so each real request appears exactly once.
const STATUS_RANK = { approved: 2, reported: 1, still_pending: 1 };

function query(range) {
  const rows = readAllRows().filter((r) => r.status !== 'empty' && inRange(taipeiDate(r.timestamp), range));
  const label = range === 'month' ? '本月' : '本週';
  if (rows.length === 0) return `${label}沒有任何簽核紀錄。`;

  // Collapse to one entry per distinct (queue, name, id, detail) — this is
  // what turns "checked 5 times while still pending, then approved" into a
  // single "approved" line instead of 5 pending repeats plus 1 approved one.
  const byQueue = {};
  for (const r of rows) {
    const requests = (byQueue[r.queue] = byQueue[r.queue] || new Map());
    const key = `${r.name}|${r.id}|${r.detail}`;
    const existing = requests.get(key);
    if (!existing || STATUS_RANK[r.status] > STATUS_RANK[existing.status]) {
      requests.set(key, r);
    }
  }

  // Within one status, group by name and collect that person's dates onto
  // one entry — "李蘇倫(9/7、9/8、9/9)" instead of repeating the name once
  // per date.
  function formatGroup(requests, status) {
    const byName = new Map();
    for (const r of requests.values()) {
      if (r.status !== status) continue;
      const date = extractDateLabel(r.detail);
      if (!byName.has(r.name)) byName.set(r.name, []);
      if (date) byName.get(r.name).push(date);
    }
    return [...byName.entries()]
      .map(([name, dates]) => {
        dates.sort((a, b) => a.sortKey - b.sortKey);
        return dates.length ? `${name}(${dates.map((d) => d.label).join('、')})` : name;
      })
      .join('、');
  }

  let totalUnique = 0;
  const lines = [];
  for (const [queue, requests] of Object.entries(byQueue)) {
    const counts = { approved: 0, still_pending: 0, reported: 0 };
    for (const r of requests.values()) counts[r.status] = (counts[r.status] || 0) + 1;

    const countParts = [];
    const detailLines = [];
    for (const status of ['approved', 'still_pending', 'reported']) {
      if (!counts[status]) continue;
      countParts.push(`${status === 'approved' ? '已核准' : STATUS_LABEL[status]} ${counts[status]}`);
      detailLines.push(`  ${status === 'approved' ? '已核准' : STATUS_LABEL[status]}：${formatGroup(requests, status)}`);
    }
    totalUnique += requests.size;
    lines.push(`${queue}：${countParts.join('、')}\n` + detailLines.join('\n'));
  }
  return `${label}簽核紀錄（共 ${totalUnique} 筆）：\n` + lines.join('\n');
}

module.exports = { query };
