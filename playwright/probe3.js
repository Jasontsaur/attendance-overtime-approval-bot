require('./env.js');
const { chromium } = require('playwright');
const BASE_URL = process.env.ATTENDANCE_BASE_URL || 'https://YOUR-ATTENDANCE-SYSTEM.example.com';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'auth/storage_state.json' });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/mainback.asp`);
  await page.waitForTimeout(1500);
  for (const f of page.frames()) {
    console.log('--- frame:', f.name() || '(unnamed)', f.url());
    try {
      const text = await f.evaluate(() => document.body ? document.body.innerText : '(no body)');
      console.log(text.slice(0, 400));
    } catch (e) { console.log('eval failed:', e.message); }
  }
  await browser.close();
})().catch(e => { console.error('ERROR', e); process.exit(1); });
