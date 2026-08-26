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
// log.
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

async function clickSignRadio(rowLocator) {
  // Column 0 is 簽核 (approve), column 1 is 駁回 (reject) — both unlabeled
  // radio columns to the left of 姓名/工號. Confirmed via probe2.js.
  await rowLocator.locator('td').nth(0).locator('input[type=radio]').check();
}

async function saveAndConfirm(frame, page) {
  let dialogMessage = null;
  const dialogHandler = async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept();
  };
  page.on('dialog', dialogHandler);
  const saveButton = frame.locator('input[type=button], input[type=submit], button').filter({ hasText: '存檔' });
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
      q.pending = parsed.dataRows.map((r) => ({ name: r.name, id: r.id, detail: r.texts }));
      console.log(`${parsed.dataRows.length} pending row(s):`, JSON.stringify(q.pending));
      if (extraApprove.length > 0) console.log('extra one-off approve names:', extraApprove);
      const toApprove = parsed.dataRows.filter((r) => whitelist.includes(r.name) || extraApprove.includes(r.name));
      const toLeave = parsed.dataRows.filter((r) => !whitelist.includes(r.name) && !extraApprove.includes(r.name));
      q.stillPending = toLeave.map((r) => ({ name: r.name, id: r.id, detail: r.texts }));
      if (toApprove.length > 0) {
        for (const row of toApprove) {
          await clickSignRadio(row.rowLocator);
        }
        const dialogMsg = await saveAndConfirm(frame, page);
        q.action = 'whitelist_approved_subset';
        q.approved = toApprove.map((r) => ({ name: r.name, id: r.id, detail: r.texts }));
        q.dialogMessage = dialogMsg;
        console.log('whitelist-approved:', JSON.stringify(q.approved));
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
      q.pending = parsed.dataRows.map((r) => ({ name: r.name, id: r.id, detail: r.texts }));
      console.log(`${parsed.dataRows.length} pending row(s):`, JSON.stringify(q.pending));
      if (extraApprove.length > 0) console.log('extra one-off approve names:', extraApprove);
      const toApprove = parsed.dataRows.filter((r) => extraApprove.includes(r.name));
      const toLeave = parsed.dataRows.filter((r) => !extraApprove.includes(r.name));
      q.stillPending = toLeave.map((r) => ({ name: r.name, id: r.id, detail: r.texts }));
      if (toApprove.length > 0) {
        for (const row of toApprove) {
          await clickSignRadio(row.rowLocator);
        }
        const dialogMsg = await saveAndConfirm(frame, page);
        q.action = 'explicitly_approved_subset';
        q.approved = toApprove.map((r) => ({ name: r.name, id: r.id, detail: r.texts }));
        q.dialogMessage = dialogMsg;
        console.log('explicitly approved:', JSON.stringify(q.approved));
      }
      console.log('still pending (check-only):', JSON.stringify(q.stillPending));
    }
    result.queues.leave = q;
  }

  await browser.close();
  console.log('\nRESULT_JSON:' + JSON.stringify(result));
}

main().catch((e) => {
  console.error('FATAL:', e);
  console.log('RESULT_JSON:' + JSON.stringify({ error: 'FATAL', message: e.message }));
  process.exit(1);
});
