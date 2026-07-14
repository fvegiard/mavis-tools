// maxclaw-upload.mjs — upload a file to the Mavis chat on MaxClaw
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9223';
const filePath = process.argv[2];
const caption = process.argv[3] || '';

if (!filePath) {
  console.error('usage: node maxclaw-upload.mjs <filePath> [caption]');
  process.exit(2);
}
if (!fs.existsSync(filePath)) { console.error('file not found:', filePath); process.exit(1); }

const browser = await chromium.connectOverCDP(cdpUrl);
const context = browser.contexts()[0];
let page = context.pages()[context.pages().length - 1];

console.log('=== maxclaw-upload ===');
console.log('  file  :', filePath);
console.log('  caption:', caption);

const absFile = path.resolve(filePath);
const url = 'https://agent.minimax.io/mavis?id=419302696522043';
console.log('  goto  :', url);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

// Find the file input (often a hidden <input type="file"> on the page)
// Strategy: locate any <input type="file"> in the page, set the file.
const fileInputCount = await page.evaluate(() => document.querySelectorAll('input[type=file]').length);
console.log('  file inputs found:', fileInputCount);
if (fileInputCount === 0) {
  // Maybe the chat needs to be focused first to make the input appear
  console.log('  no file input; will try clicking attach button to reveal it...');
  const attachBtn = await page.evaluate(() => {
    for (const e of document.querySelectorAll('button, [role=button]')) {
      const t = (e.innerText || '').toLowerCase();
      const aria = (e.getAttribute('aria-label') || '').toLowerCase();
      if (t.includes('attach') || t.includes('joindre') || t.includes('upload') || t.includes('file') || aria.includes('attach') || aria.includes('joindre')) {
        e.click();
        return e.innerText || aria;
      }
    }
    return null;
  });
  console.log('  attach button:', attachBtn);
  await page.waitForTimeout(2000);
  const fileInputCount2 = await page.evaluate(() => document.querySelectorAll('input[type=file]').length);
  console.log('  file inputs after click:', fileInputCount2);
}

// Set the file
const fileInput = await page.$('input[type=file]');
if (!fileInput) {
  console.error('no file input found, cannot upload');
  await browser.close();
  process.exit(1);
}
await fileInput.setInputFiles(absFile);
console.log('  file set on input');
await page.waitForTimeout(2000);

// If caption provided, type it
if (caption) {
  // The ProseMirror editor might appear next to the uploaded file
  const editor = await page.$('.tiptap.ProseMirror[contenteditable="true"], [contenteditable="true"]');
  if (editor) {
    await editor.click();
    await editor.fill(caption);
    console.log('  caption typed');
  } else {
    console.log('  no editor found for caption (skipping)');
  }
}

// Submit (press Enter to send, or click send button)
await page.keyboard.press('Enter');
console.log('  Enter pressed');
await page.waitForTimeout(2000);

// Also try clicking a send button if Enter didn't work
const sendBtn = await page.evaluate(() => {
  for (const e of document.querySelectorAll('button')) {
    const t = (e.innerText || '').toLowerCase().trim();
    const aria = (e.getAttribute('aria-label') || '').toLowerCase();
    if (t === 'send' || t === 'envoyer' || aria.includes('send') || aria.includes('envoyer')) {
      return { text: e.innerText, aria: e.getAttribute('aria-label') };
    }
  }
  return null;
});
console.log('  send button:', sendBtn);
if (sendBtn) {
  await page.evaluate(() => {
    for (const e of document.querySelectorAll('button')) {
      const t = (e.innerText || '').toLowerCase().trim();
      const aria = (e.getAttribute('aria-label') || '').toLowerCase();
      if (t === 'send' || t === 'envoyer' || aria.includes('send') || aria.includes('envoyer')) {
        e.click();
        return true;
      }
    }
  });
  console.log('  send clicked');
}

await page.waitForTimeout(3000);

// Verify upload appeared in the chat
const lastMessage = await page.evaluate(() => {
  // Look for the most recent message in the thread
  const all = document.querySelectorAll('[class*="message"], [role="article"], [data-message-id]');
  for (let i = all.length - 1; i >= 0; i--) {
    const t = (all[i].innerText || '').trim();
    if (t.length > 5) return t.slice(0, 500);
  }
  return '(no message found)';
});
console.log('  last message:', lastMessage);

await browser.close();
