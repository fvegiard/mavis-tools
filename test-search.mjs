import { chromium } from 'playwright';
const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9223';
const browser = await chromium.connectOverCDP(cdpUrl);
const context = browser.contexts()[0];
let page = context.pages()[context.pages().length - 1];

console.log('=== Outlook search test ===');
await page.goto('https://outlook.office365.com/mail/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

// Find the search combobox and type
const searchId = 'topSearchInput';
const found = await page.evaluate((id) => !!document.getElementById(id), searchId);
console.log('search input found:', found);
if (!found) {
  console.log('search input not found, dumping IDs:');
  const ids = await page.evaluate(() => Array.from(document.querySelectorAll('[id]')).map(e => e.id).filter(Boolean).slice(0, 30));
  console.log(ids);
  await browser.close();
  process.exit(1);
}

await page.focus(`#${searchId}`);
// Use native setter for React
await page.evaluate((id) => {
  const input = document.getElementById(id);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'Kahnawake');
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, searchId);
await page.waitForTimeout(500);
await page.keyboard.press('Enter');
await page.waitForTimeout(5000);

const items = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[role=option]')).map((e, i) => ({
    i,
    text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
  }));
});
console.log('items found:', items.length);
for (const it of items) console.log(`  [${it.i}] ${it.text}`);

await browser.close();
