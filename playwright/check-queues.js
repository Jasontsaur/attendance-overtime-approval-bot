// Main automation: checks the three overtime/leave approval queues on your
// organization's attendance system and acts per the skill's standing
// policy, using Playwright DOM access instead of screenshots. See
// ../SKILL.md for the policy this implements.
//
// Usage: node check-queues.js
// Requires auth/storage_state.json (see login-once.js /
// build-storage-state-from-cookie.js). Prints a human-readable log, then a
// single line `RESULT_JSON:{...}` at the end with the structured summary —
// the caller should parse that last line rather than screen-scraping the
// log. Every run also appends one row per pending item (plus a summary row
// for empty queues) to ../logs/approval-log-YYYY-MM.csv, filed by each
// row's own event date (not the check-run date) — a local-only audit
// trail, gitignored, never synced anywhere.
require('./env.js');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const STORAGE_STATE_PATH = path.join(__dirname, 'auth', 'storage_state.json');
const WHITELIST_PATH = path.join(__dirname, '..', '白名單.md');
// Set this to your organization's attendance-system base URL, e.g. via
// `ATTENDANCE_BASE_URL=https://attendance.example.com node check-queues.js`.
const BASE_URL = process.env.ATTENDANCE_BASE_URL || 'https://YOUR-ATTENDANCE-SYSTEM.example.com';
const MAINBACK_URL = `${BASE_URL}/mainback.asp`;
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_HEADER = 'timestamp,queue,status,action,name,id,detail';

const QUEUE_LABELS = {
  pre_overtime: '預定加班單簽核',
  overtime: '加班單簽核',
  leave: '假單簽核',
  abnormal: '異常簽核',
};

// Column index (within a row's `detail` array) holding the event's own
// date, per queue — used to file each row under the month it actually
// happened in, not the month it was checked/approved in. Confirmed via
// live data against one specific system: pre_overtime uses 起始日期
// (Gregorian YYYYMMDD), overtime/leave use their 起始日期 (Minguo/ROC
// YYYMMDD, e.g. "1150829" = 2026-08-29). Re-verify these indices against
// your own system's column layout.
const EVENT_DATE_FIELD_INDEX = {
  pre_overtime: 4,
  overtime: 4,
  leave: 5,
};

function csvField(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function logPathFor(yearMonth) {
  return path.join(LOG_DIR, `approval-log-${yearMonth}.csv`);
}

// Parses an 8-digit Gregorian (YYYYMMDD) or 7-digit Minguo/ROC (YYYMMDD)
// date string into a "YYYY-MM" key. Returns null if it doesn't look like
// either (e.g. it's actually an hour total or an ID, not a date).
function parseDateToYearMonth(str) {
  if (!/^\d{7,8}$/.test(str)) return null;
  const month = str.length === 8 ? str.slice(4, 6) : str.slice(3, 5);
  if (month < '01' || month > '12') return null;
  const year = str.length === 8 ? parseInt(str.slice(0, 4), 10) : parseInt(str.slice(0, 3), 10) + 1911;
  if (year < 1990 || year > 2100) return null;
  return `${year}-${month}`;
}

// Looks up the known date column for this queue first; falls back to
// scanning every field (for queues with an unconfirmed layout, e.g.
// 異常簽核) or if that column didn't parse. Falls back to the check-run's
// own month as a last resort so a row is never silently dropped.
function extractEventYearMonth(queueKey, texts, fallbackYearMonth) {
  const idx = EVENT_DATE_FIELD_INDEX[queueKey];
  if (idx !== undefined && texts[idx]) {
    const ym = parseDateToYearMonth(texts[idx]);
    if (ym) return ym;
  }
  for (const t of texts) {
    const ym = parseDateToYearMonth(t);
    if (ym) return ym;
  }
  return fallbackYearMonth;
}

// Appends one row per pending item (plus one summary row for empty queues)
// to a local CSV audit log — every run, whether or not anything was
// approved. Rows are filed into logs/approval-log-YYYY-MM.csv by the
// event's own date (an approval checked in September for an August
// overtime request lands in the August file); "empty queue" summary rows
// have no event date, so they're filed under the check run's own month.
// Local-only; never synced anywhere.
function appendLogRows(result) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const runYearMonth = result.timestamp.slice(0, 7); // "2026-08-31T07:01:37.059Z" -> "2026-08"
  const linesByMonth = new Map();
  const pushLine = (yearMonth, fields) => {
    if (!linesByMonth.has(yearMonth)) linesByMonth.set(yearMonth, []);
    linesByMonth.get(yearMonth).push(fields.map(csvField).join(','));
  };

  const approvedKeyOf = (r) => `${r.name}|${r.id}|${JSON.stringify(r.detail)}`;

  for (const [queueKey, q] of Object.entries(result.queues)) {
    const label = QUEUE_LABELS[queueKey] || queueKey;
    const action = q.action || '';
    const pending = q.pending || [];
    if (pending.length === 0) {
      pushLine(runYearMonth, [result.timestamp, label, 'empty', action, '', '', '']);
      continue;
    }
    const approvedKeys = new Set((q.approved || []).map(approvedKeyOf));
    for (const row of pending) {
      // Every queue's `approved` array is always present (possibly empty),
      // so this naturally comes out as 'still_pending' for anything not
      // actually approved this run — including 異常簽核 on a normal
      // (non-APPROVE_ALL) run, since that queue can now be approved too.
      const status = approvedKeys.has(approvedKeyOf(row)) ? 'approved' : 'still_pending';
      const eventYearMonth = extractEventYearMonth(queueKey, row.detail || [], runYearMonth);
      const detail = (row.detail || []).join(' | ');
      pushLine(eventYearMonth, [result.timestamp, label, status, action, row.name, row.id, detail]);
    }
  }

  for (const [yearMonth, lines] of linesByMonth) {
    const filePath = logPathFor(yearMonth);
    const isNewFile = !fs.existsSync(filePath);
    const out = (isNewFile ? [LOG_HEADER] : []).concat(lines);
    fs.appendFileSync(filePath, out.join('\n') + '\n');
  }
}

// One-off names to also approve in 加班單簽核 this run only, on top of the
// persistent 白名單.md whitelist — for explicit per-turn user authorization
// of a specific non-whitelisted row (not a permanent whitelist change).
// Usage: EXTRA_APPROVE_NAMES="某某人,某某人2" node check-queues.js
function loadExtraApproveNames() {
  const raw = process.env.EXTRA_APPROVE_NAMES || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// Same idea as loadExtraApproveNames() but for 假單簽核, which has no
// whitelist at all — every approval there requires this explicit per-run
// name list. Usage: EXTRA_APPROVE_LEAVE_NAMES="某某人" node check-queues.js
function loadExtraApproveLeaveNames() {
  const raw = process.env.EXTRA_APPROVE_LEAVE_NAMES || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// Explicit per-run "approve everything currently pending" override for
// 加班單簽核 / 假單簽核 / 異常簽核. This bypasses the whitelist/name-matching
// entirely for this one run; it is not a whitelist change, and there is no
// partial-approval mode for this flag — every pending row in each of these
// three queues gets approved when it's set.
// Usage: APPROVE_ALL=1 node check-queues.js
function isApproveAll() {
  return process.env.APPROVE_ALL === '1';
}

function loadWhitelist() {
  const text = fs.readFileSync(WHITELIST_PATH, 'utf8');
  const names = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^-\s*([^(（]+)/);
    if (m) names.push(m[1].trim());
  }
  return names;
}

// Finds the data table (the one whose header row contains 姓名+工號) inside
// a frame, and returns its parsed rows. Returns null if no such table
// exists (this site replaces the whole table with a plain "查無...資料"
// message when a queue is empty, so "no table" == "empty queue").
async function readQueueTable(frame) {
  const tables = frame.locator('table');
  const tableCount = await tables.count();
  for (let ti = 0; ti < tableCount; ti++) {
    const table = tables.nth(ti);
    const headerRow = table.locator('tr').first();
    const headerCells = await headerRow.locator('td,th').allInnerTexts();
    const trimmed = headerCells.map((h) => h.trim());
    if (trimmed.includes('姓名') && trimmed.includes('工號')) {
      const nameIdx = trimmed.indexOf('姓名');
      const idIdx = trimmed.indexOf('工號');
      const rows = table.locator('tr');
      const rowCount = await rows.count();
      const dataRows = [];
      for (let ri = 1; ri < rowCount; ri++) {
        const rowLocator = rows.nth(ri);
        const cells = rowLocator.locator('td');
        const cellCount = await cells.count();
        if (cellCount <= Math.max(nameIdx, idIdx)) continue;
        const texts = (await cells.allInnerTexts()).map((t) => t.trim());
        dataRows.push({
          rowLocator,
          texts,
          name: texts[nameIdx] || '',
          id: texts[idIdx] || '',
        });
      }
      return { table, headerCells: trimmed, nameIdx, idIdx, dataRows };
    }
  }
  return null;
}

// 異常簽核's table is structurally different from the other three queues:
// there's no separate 姓名 column — 工號 holds "工號 姓名" combined (e.g.
// "010722 林群洲") — so readQueueTable() (which requires distinct 姓名+工號
// headers) never matches it and this needs its own parser. Confirmed via a
// live probe of this one specific system's page — re-verify against your
// own system's layout.
async function readAbnormalQueueTable(frame) {
  const tables = frame.locator('table');
  const tableCount = await tables.count();
  for (let ti = 0; ti < tableCount; ti++) {
    const table = tables.nth(ti);
    const headerRow = table.locator('tr').first();
    const headerCells = await headerRow.locator('td,th').allInnerTexts();
    const trimmed = headerCells.map((h) => h.trim());
    if (trimmed.includes('工號') && trimmed.includes('異常名稱')) {
      const idIdx = trimmed.indexOf('工號');
      const rows = table.locator('tr');
      const rowCount = await rows.count();
      const dataRows = [];
      for (let ri = 1; ri < rowCount; ri++) {
        const rowLocator = rows.nth(ri);
        const cells = rowLocator.locator('td');
        const cellCount = await cells.count();
        if (cellCount <= idIdx) continue;
        const texts = (await cells.allInnerTexts()).map((t) => t.trim());
        const m = (texts[idIdx] || '').match(/^(\S+)\s+(.*)$/);
        dataRows.push({
          rowLocator,
          texts,
          id: m ? m[1] : (texts[idIdx] || ''),
          name: m ? m[2].trim() : '',
        });
      }
      return { table, headerCells: trimmed, dataRows };
    }
  }
  return null;
}

async function clickSignRadio(rowLocator) {
  // Column 0 is 簽核 (approve), column 1 is 駁回 (reject) — both unlabeled
  // radio columns to the left of 姓名/工號. Confirmed via probe2.js.
  await rowLocator.locator('td').nth(0).locator('input[type=radio]').check();
}

// 異常簽核 uses a checkbox (not a 簽核/駁回 radio pair — there is no reject
// option for this queue at all) in the first column.
async function clickCheckbox(rowLocator) {
  await rowLocator.locator('td').first().locator('input[type=checkbox]').check();
}

// buttonText defaults to '存檔' (the other three queues); 異常簽核's submit
// button is itself labeled '簽核' instead.
async function saveAndConfirm(frame, page, buttonText = '存檔') {
  let dialogMessage = null;
  const dialogHandler = async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept();
  };
  page.on('dialog', dialogHandler);
  const saveButton = frame.locator('input[type=button], input[type=submit], button').filter({ hasText: buttonText });
  await saveButton.first().click();
  await page.waitForTimeout(1500); // let the confirm() fire and the save complete
  page.off('dialog', dialogHandler);
  return dialogMessage;
}

async function gotoQueue(page, label) {
  const header = page.frame({ name: 'header' });
  await header.getByText(label, { exact: true }).click();
  await page.waitForTimeout(1200);
  return page.frame({ name: 'main' });
}

async function main() {
  const result = {
    timestamp: new Date().toISOString(),
    queues: {},
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_STATE_PATH });
  const page = await context.newPage();
  await page.goto(MAINBACK_URL);
  await page.waitForTimeout(1000);

  if (/index\.asp/.test(page.url()) || (await page.title()).includes('登入')) {
    result.error = 'SESSION_EXPIRED';
    console.log('RESULT_JSON:' + JSON.stringify(result));
    await browser.close();
    return;
  }

  // ---- 1. 預定加班單簽核: auto-approve everything ----
  {
    const label = '預定加班單簽核';
    console.log(`\n=== ${label} ===`);
    const frame = await gotoQueue(page, label);
    const parsed = await readQueueTable(frame);
    const q = { pending: [], approved: [], action: 'none' };
    if (!parsed || parsed.dataRows.length === 0) {
      console.log('empty queue');
    } else {
      q.pending = parsed.dataRows.map((r) => ({ name: r.name, id: r.id, detail: r.texts }));
      console.log(`${parsed.dataRows.length} pending row(s):`, JSON.stringify(q.pending));
      for (const row of parsed.dataRows) {
        await clickSignRadio(row.rowLocator);
      }
      const dialogMsg = await saveAndConfirm(frame, page);
      q.action = 'auto_approved_all';
      q.approved = q.pending;
      q.dialogMessage = dialogMsg;
      console.log('saved, confirm dialog:', dialogMsg);
    }
    result.queues.pre_overtime = q;
  }

  // ---- 2. 加班單簽核: whitelist-based ----
  {
    const label = '加班單簽核';
    console.log(`\n=== ${label} ===`);
    const frame = await gotoQueue(page, label);
    const parsed = await readQueueTable(frame);
    const q = { pending: [], approved: [], stillPending: [], action: 'none' };
    if (!parsed || parsed.dataRows.length === 0) {
      console.log('empty queue');
    } else {
      const whitelist = loadWhitelist();
      const extraApprove = loadExtraApproveNames();
      const approveAll = isApproveAll();
      q.pending = parsed.dataRows.map((r) => ({ name: r.name, id: r.id, detail: r.texts }));
      console.log(`${parsed.dataRows.length} pending row(s):`, JSON.stringify(q.pending));
      if (extraApprove.length > 0) console.log('extra one-off approve names:', extraApprove);
      if (approveAll) console.log('APPROVE_ALL override active — ignoring whitelist for this run');
      const toApprove = approveAll ? parsed.dataRows : parsed.dataRows.filter((r) => whitelist.includes(r.name) || extraApprove.includes(r.name));
      const toLeave = approveAll ? [] : parsed.dataRows.filter((r) => !whitelist.includes(r.name) && !extraApprove.includes(r.name));
      q.stillPending = toLeave.map((r) => ({ name: r.name, id: r.id, detail: r.texts }));
      if (toApprove.length > 0) {
        for (const row of toApprove) {
          await clickSignRadio(row.rowLocator);
        }
        const dialogMsg = await saveAndConfirm(frame, page);
        q.action = approveAll ? 'approved_all_override' : 'whitelist_approved_subset';
        q.approved = toApprove.map((r) => ({ name: r.name, id: r.id, detail: r.texts }));
        q.dialogMessage = dialogMsg;
        console.log('approved:', JSON.stringify(q.approved));
      } else {
        q.action = 'none_matched_whitelist';
      }
      console.log('still pending (not on whitelist):', JSON.stringify(q.stillPending));
    }
    result.queues.overtime = q;
  }

  // ---- 3. 假單簽核: check-only by default, no whitelist. Only approves a
  // row if its name is explicitly passed via EXTRA_APPROVE_LEAVE_NAMES for
  // this run (separate from EXTRA_APPROVE_NAMES, which is overtime-only) —
  // per standing policy this queue never auto-approves on its own.
  {
    const label = '假單簽核';
    console.log(`\n=== ${label} ===`);
    const frame = await gotoQueue(page, label);
    const parsed = await readQueueTable(frame);
    const q = { pending: [], approved: [], stillPending: [], action: 'check_only' };
    if (!parsed || parsed.dataRows.length === 0) {
      console.log('empty queue');
    } else {
      const extraApprove = loadExtraApproveLeaveNames();
      const approveAll = isApproveAll();
      q.pending = parsed.dataRows.map((r) => ({ name: r.name, id: r.id, detail: r.texts }));
      console.log(`${parsed.dataRows.length} pending row(s):`, JSON.stringify(q.pending));
      if (extraApprove.length > 0) console.log('extra one-off approve names:', extraApprove);
      if (approveAll) console.log('APPROVE_ALL override active — approving every pending row');
      const toApprove = approveAll ? parsed.dataRows : parsed.dataRows.filter((r) => extraApprove.includes(r.name));
      const toLeave = approveAll ? [] : parsed.dataRows.filter((r) => !extraApprove.includes(r.name));
      q.stillPending = toLeave.map((r) => ({ name: r.name, id: r.id, detail: r.texts }));
      if (toApprove.length > 0) {
        for (const row of toApprove) {
          await clickSignRadio(row.rowLocator);
        }
        const dialogMsg = await saveAndConfirm(frame, page);
        q.action = approveAll ? 'approved_all_override' : 'explicitly_approved_subset';
        q.approved = toApprove.map((r) => ({ name: r.name, id: r.id, detail: r.texts }));
        q.dialogMessage = dialogMsg;
        console.log('approved:', JSON.stringify(q.approved));
      }
      console.log('still pending (check-only):', JSON.stringify(q.stillPending));
    }
    result.queues.leave = q;
  }

  // ---- 4. 異常簽核: check-only by default — no whitelist, no per-name
  // override, ever. The ONLY way anything here gets approved is the
  // explicit, per-run APPROVE_ALL=1 override (this queue has no partial-
  // approval concept, it's all-or-nothing same as the other two queues
  // under that flag). Note this queue's table is structurally different
  // (checkboxes not radios, submit button is itself labeled 簽核, no reject
  // option, no separate 姓名 column) — see readAbnormalQueueTable().
  {
    const label = '異常簽核';
    console.log(`\n=== ${label} ===`);
    const frame = await gotoQueue(page, label);
    const parsed = await readAbnormalQueueTable(frame);
    const q = { pending: [], approved: [], action: 'check_only' };
    if (!parsed || parsed.dataRows.length === 0) {
      console.log('empty queue');
    } else {
      q.pending = parsed.dataRows.map((r) => ({ name: r.name, id: r.id, detail: r.texts }));
      console.log(`${parsed.dataRows.length} pending row(s):`, JSON.stringify(q.pending));
      if (isApproveAll()) {
        console.log('APPROVE_ALL override active — approving every pending row');
        for (const row of parsed.dataRows) {
          await clickCheckbox(row.rowLocator);
        }
        const dialogMsg = await saveAndConfirm(frame, page, '簽核');
        q.action = 'approved_all_override';
        q.approved = q.pending;
        q.dialogMessage = dialogMsg;
        console.log('approved:', JSON.stringify(q.approved));
      }
    }
    result.queues.abnormal = q;
  }

  await browser.close();
  appendLogRows(result);
  console.log('\nRESULT_JSON:' + JSON.stringify(result));
}

main().catch((e) => {
  console.error('FATAL:', e);
  console.log('RESULT_JSON:' + JSON.stringify({ error: 'FATAL', message: e.message }));
  process.exit(1);
});
