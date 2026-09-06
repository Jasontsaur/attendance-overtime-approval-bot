// Fully automated login using credentials stored in .env (ATTENDANCE_EMP_ID /
// ATTENDANCE_PASSWORD, next to this file, gitignored — copy .env.example to
// .env and fill in). Fills the login form and submits headlessly, then saves
// the resulting session to auth/storage_state.json — no human interaction
// required. Use this instead of login-once.js once .env has been filled in.
require('./env.js');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ENV_PATH = path.join(__dirname, '.env');
const STORAGE_STATE_PATH = path.join(__dirname, 'auth', 'storage_state.json');
// Set this to your organization's attendance-system base URL, e.g. via
// `ATTENDANCE_BASE_URL=https://attendance.example.com node auto-login.js`.
const BASE_URL = process.env.ATTENDANCE_BASE_URL || 'https://YOUR-ATTENDANCE-SYSTEM.example.com';
const LOGIN_URL = `${BASE_URL}/index.asp`;
const LOGGED_IN_URL_PATTERN = /mainback\.asp/;

function loadEnvFile(filePath) {
  const creds = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    creds[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return creds;
}

(async () => {
  const creds = loadEnvFile(ENV_PATH);
  if (!creds.ATTENDANCE_EMP_ID || !creds.ATTENDANCE_PASSWORD) {
    console.error('LOGIN_FAILED: .env is missing ATTENDANCE_EMP_ID or ATTENDANCE_PASSWORD — copy .env.example to .env and fill it in first.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(LOGIN_URL);
  // Field names below match this one specific classic-ASP login form
  // (see SKILL.md "Adapting this to your own system") — re-verify against
  // your own system's form fields.
  await page.locator('input[name="EMP_ID"]').fill(creds.ATTENDANCE_EMP_ID);
  await page.locator('input[name="passwd"]').fill(creds.ATTENDANCE_PASSWORD);
  await page.locator('input[type="submit"]').click();
  await page.waitForURL(LOGGED_IN_URL_PATTERN, { timeout: 15000 });
  await page.waitForTimeout(1000);

  await context.storageState({ path: STORAGE_STATE_PATH });
  fs.chmodSync(STORAGE_STATE_PATH, 0o600); // contains session cookies — keep it private
  console.log(`登入狀態已儲存至 ${STORAGE_STATE_PATH}`);

  await browser.close();
})().catch((e) => {
  console.error('LOGIN_FAILED:', e.message);
  process.exit(1);
});
