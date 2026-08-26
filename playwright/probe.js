require('./env.js');
const { chromium } = require('playwright');

const BASE_URL = process.env.ATTENDANCE_BASE_URL || 'https://YOUR-ATTENDANCE-SYSTEM.example.com';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'auth/storage_state.json' });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/mainback.asp`);
  await page.waitForTimeout(1000);

  console.log('=== frames after initial load ===');
  for (const f of page.frames()) {
    console.log(f.name() || '(unnamed)', '|', f.url());
  }

  // Find the frame that has the left-nav links (contains '預定加班單簽核' text)
  let navFrame = null;
  for (const f of page.frames()) {
    try {
      const hasLink = await f.locator('text=預定加班單簽核').count();
      if (hasLink > 0) { navFrame = f; break; }
    } catch (e) { /* cross-origin or detached, skip */ }
  }
  console.log('\n=== nav frame ===', navFrame ? navFrame.url() : 'NOT FOUND');

  if (navFrame) {
    await navFrame.locator('text=預定加班單簽核').click();
    await page.waitForTimeout(1500);
    console.log('\n=== frames after clicking 預定加班單簽核 ===');
    for (const f of page.frames()) {
      console.log(f.name() || '(unnamed)', '|', f.url());
    }
  }

  await browser.close();
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
