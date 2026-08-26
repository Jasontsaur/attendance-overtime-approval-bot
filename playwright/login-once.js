// One-time interactive login. Opens a real, visible Chromium window (via
// WSLg, so it shows up on the Windows desktop) pointed at the attendance
// system's login page. The user logs in by hand; once the page navigates
// to mainback.asp, the session's cookies are saved to auth/storage_state.json
// so future runs (check-queues.js) can load them and skip login entirely.
//
// Claude never sees or handles the password — this script only waits for
// the URL to change and then persists whatever cookies exist at that point.
require('./env.js');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const STORAGE_STATE_PATH = path.join(__dirname, 'auth', 'storage_state.json');
// Set this to your organization's attendance-system base URL, e.g. via
// `ATTENDANCE_BASE_URL=https://attendance.example.com node login-once.js`.
const BASE_URL = process.env.ATTENDANCE_BASE_URL || 'https://YOUR-ATTENDANCE-SYSTEM.example.com';
const LOGIN_URL = `${BASE_URL}/index.asp`;
const LOGGED_IN_URL_PATTERN = /mainback\.asp/;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes to log in by hand

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(LOGIN_URL);
  console.log('===================================================');
  console.log('請在剛才彈出的瀏覽器視窗手動登入差勤系統。');
  console.log(`最長等待 ${TIMEOUT_MS / 60000} 分鐘，登入成功後會自動偵測並存檔。`);
  console.log('===================================================');

  await page.waitForURL(LOGGED_IN_URL_PATTERN, { timeout: TIMEOUT_MS });
  await page.waitForTimeout(1000); // let cookies fully settle

  await context.storageState({ path: STORAGE_STATE_PATH });
  fs.chmodSync(STORAGE_STATE_PATH, 0o600); // contains session cookies — keep it private
  console.log(`登入狀態已儲存至 ${STORAGE_STATE_PATH}`);

  await browser.close();
})().catch((e) => {
  console.error('LOGIN_FAILED:', e.message);
  process.exit(1);
});
