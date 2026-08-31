// Lightweight session keep-alive: visits mainback.asp and does nothing
// else — no queue reads, no approvals, no CSV logging. Exists purely to
// reset the attendance system's server-side idle timer during a long gap
// between check-queues.js runs (e.g. an overnight gap that's long enough
// for the session to idle-timeout even though shorter daytime gaps
// between checks are not — tune the schedule to your own system's actual
// idle-timeout window).
//
// Usage: node keep-alive.js
// Prints "ALIVE" if the session is still valid, "EXPIRED" if it's not
// (does NOT attempt to refresh it — that needs a human, see SKILL.md
// "Session refresh"). Exits 0 either way; this is a status probe, not a
// task that can fail.
require('./env.js');
const path = require('path');
const { chromium } = require('playwright');

const STORAGE_STATE_PATH = path.join(__dirname, 'auth', 'storage_state.json');
// Set this to your organization's attendance-system base URL, e.g. via
// `ATTENDANCE_BASE_URL=https://attendance.example.com node keep-alive.js`.
const BASE_URL = process.env.ATTENDANCE_BASE_URL || 'https://YOUR-ATTENDANCE-SYSTEM.example.com';
const MAINBACK_URL = `${BASE_URL}/mainback.asp`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STORAGE_STATE_PATH });
  const page = await context.newPage();
  await page.goto(MAINBACK_URL);
  await page.waitForTimeout(1000);

  const expired = /index\.asp/.test(page.url()) || (await page.title()).includes('登入');
  console.log(expired ? 'EXPIRED' : 'ALIVE');

  await browser.close();
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
