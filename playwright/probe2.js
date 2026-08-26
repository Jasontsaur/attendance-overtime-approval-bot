require('./env.js');
const { chromium } = require('playwright');

const QUEUES = ['預定加班單簽核', '加班單簽核', '假單簽核'];
const BASE_URL = process.env.ATTENDANCE_BASE_URL || 'https://YOUR-ATTENDANCE-SYSTEM.example.com';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'auth/storage_state.json' });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/mainback.asp`);
  await page.waitForTimeout(1000);

  for (const label of QUEUES) {
    console.log(`\n\n########## ${label} ##########`);
    const header = page.frame({ name: 'header' });
    await header.getByText(label, { exact: true }).click();
    await page.waitForTimeout(1500);
    const main = page.frame({ name: 'main' });
    console.log('main frame URL:', main.url());

    const bodyText = await main.evaluate(() => document.body ? document.body.innerText : '(none)');
    console.log('--- body innerText ---');
    console.log(bodyText.slice(0, 500));

    const tableCount = await main.locator('table').count();
    console.log('table count:', tableCount);

    if (tableCount > 0) {
      // Dump each table's rows/cells briefly
      for (let ti = 0; ti < tableCount; ti++) {
        const table = main.locator('table').nth(ti);
        const rows = table.locator('tr');
        const rowCount = await rows.count();
        console.log(`  table[${ti}] rows=${rowCount}`);
        for (let ri = 0; ri < Math.min(rowCount, 4); ri++) {
          const cells = rows.nth(ri).locator('td,th');
          const cellCount = await cells.count();
          const texts = [];
          for (let ci = 0; ci < cellCount; ci++) {
            texts.push((await cells.nth(ci).innerText()).trim());
          }
          console.log(`    row[${ri}]:`, JSON.stringify(texts));
        }
      }
    }

    // Look for radio inputs and buttons
    const radioCount = await main.locator('input[type=radio]').count();
    const buttonLikeCount = await main.locator('input[type=button], input[type=submit], button').count();
    console.log('radio inputs:', radioCount, '| button-like inputs:', buttonLikeCount);
    if (buttonLikeCount > 0) {
      const btns = main.locator('input[type=button], input[type=submit], button');
      for (let bi = 0; bi < buttonLikeCount; bi++) {
        const val = await btns.nth(bi).evaluate((el) => el.value || el.innerText || '');
        console.log(`  button[${bi}]:`, val);
      }
    }
  }

  await browser.close();
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
