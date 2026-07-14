// inspect-outlook.mjs — open the first email in Kahnawake search and dump
// the page structure so we can find good selectors for metadata.
import { chromium } from 'playwright';
const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9223';
const browser = await chromium.connectOverCDP(cdpUrl);
const context = browser.contexts()[0];
let page = context.pages()[context.pages().length - 1];

console.log('=== Outlook inspection ===');
await page.goto('https://outlook.office365.com/mail/?q=Kahnawake', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

// Click the first item that has "Kahnawake" in its text
const clickedIdx = await page.evaluate(() => {
  const items = document.querySelectorAll('[role=option]');
  for (let i = 0; i < items.length; i++) {
    if ((items[i].innerText || '').toLowerCase().includes('kahnawake')) {
      items[i].click();
      return i;
    }
  }
  return -1;
});
console.log('clicked item index:', clickedIdx);
await page.waitForTimeout(5000);

// Dump a structural summary
const struct = await page.evaluate(() => {
  const out = { url: location.href, title: document.title };
  // Find all h1/h2/h3/h4 with text
  out.headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
    .filter(e => e.offsetParent !== null)
    .map(e => ({ tag: e.tagName, text: (e.innerText || '').trim().slice(0, 200), id: e.id, classes: (e.className || '').toString().slice(0, 80) }))
    .filter(h => h.text);
  // Find candidate metadata regions: search for known field names
  const candidateAttrs = ['data-testid', 'aria-label', 'title'];
  out.candidates = [];
  for (const a of candidateAttrs) {
    const els = document.querySelectorAll(`[${a}*="from" i], [${a}*="to" i], [${a}*="subject" i], [${a}*="date" i], [${a}*="sent" i], [${a}*="body" i], [${a}*="message" i]`);
    for (const e of els) {
      if (e.offsetParent === null) continue;
      out.candidates.push({
        attr: a, value: e.getAttribute(a),
        tag: e.tagName, text: (e.innerText || '').trim().slice(0, 150),
        classes: (e.className || '').toString().slice(0, 80),
      });
    }
  }
  // All element IDs and class fragments
  out.ids = Array.from(document.querySelectorAll('[id]'))
    .filter(e => e.offsetParent !== null)
    .map(e => e.id)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 30);
  return out;
});
console.log(JSON.stringify(struct, null, 2));

await browser.close();
