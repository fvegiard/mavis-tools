#!/usr/bin/env node
/**
 * extract-pdf.mjs v3 — Outlook email extraction that actually works.
 *
 * Strategy:
 *   1. Goto Outlook home (not search URL — that filter doesn't apply).
 *   2. Type the query into the search combobox (using React-friendly setter).
 *   3. Press Enter, wait for results.
 *   4. Enumerate [role=option] items.
 *   5. For each: click, wait for body, capture PDF + sidecar JSON.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

const query = arg('query', 'Kahnawake');
const outDir = path.resolve(arg('out', '.'));
const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9223';
const limit = parseInt(arg('limit', '999'), 10);
const prefix = arg('prefix', 'kahnawake');

fs.mkdirSync(outDir, { recursive: true });

console.log('=== extract-pdf.mjs v3 ===');
console.log('  query    :', query);
console.log('  outDir   :', outDir);
console.log('  cdpUrl   :', cdpUrl);
console.log('  limit    :', limit);
console.log('  prefix   :', prefix);

const browser = await chromium.connectOverCDP(cdpUrl);
const context = browser.contexts()[0];
let page = context.pages()[context.pages().length - 1];

// Step 1: Goto Outlook HOME
console.log('[1/5] goto Outlook...');
await page.goto('https://outlook.office365.com/mail/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

// Step 2: Type query in the search box
console.log('[2/5] searching for:', query);
const searchId = 'topSearchInput';
const searchOk = await page.evaluate(({ id, q }) => {
  const input = document.getElementById(id);
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, q);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
  return true;
}, { id: searchId, q: query });
if (!searchOk) {
  console.error('search input not found');
  await browser.close();
  process.exit(1);
}
await page.keyboard.press('Enter');
await page.waitForTimeout(6000);

// Step 3: Enumerate results
console.log('[3/5] enumerating results...');
const items = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[role=option]')).map((e, i) => ({
    i,
    text: (e.innerText || '').replace(/\s+/g, ' ').trim(),
  }));
});
console.log('  found', items.length, 'items');
if (items.length === 0) {
  await browser.close();
  process.exit(0);
}
const todo = items.slice(0, limit);

// Step 4: For each, click, wait, capture
let saved = 0, skipped = 0;
const slugs = new Set();

for (let n = 0; n < todo.length; n++) {
  const item = todo[n];
  console.log(`[4/5] [${n + 1}/${todo.length}] ${item.text.slice(0, 70)}...`);

  // Click via JS (deterministic)
  const clicked = await page.evaluate((idx) => {
    const items = document.querySelectorAll('[role=option]');
    const it = items[idx];
    if (it) { it.click(); return true; }
    return false;
  }, String(item.i));
  if (!clicked) { console.log('    SKIP (not clickable)'); skipped++; continue; }

  // Wait for the message body to render
  try {
    await page.waitForSelector('[class*="messageBody"], [aria-label*="corps du message" i]', { timeout: 20000 });
  } catch {
    await page.waitForTimeout(4000);
  }
  await page.waitForTimeout(2000);

  // Parse metadata
  const meta = await page.evaluate(() => {
    function findLabel(label) {
      const allDivs = Array.from(document.querySelectorAll('div, span'));
      for (const e of allDivs) {
        const t = (e.innerText || '').trim();
        if (e.children.length === 0 && new RegExp('^' + label + '\\b', 'i').test(t) && t.length < 200) {
          const sib = e.nextElementSibling;
          if (sib) return (sib.innerText || '').trim();
          const parent = e.parentElement;
          if (parent) return (parent.innerText || '').replace(new RegExp('^' + label, 'i'), '').trim().slice(0, 200);
        }
      }
      return null;
    }
    let subject = null;
    for (const sel of ['[class*="ConversationSubject"]', '[class*="subject"]', 'h1', 'h2']) {
      const e = document.querySelector(sel);
      if (e && e.offsetParent !== null && (e.innerText || '').trim()) {
        subject = (e.innerText || '').trim();
        break;
      }
    }
    const bodyEl = document.querySelector('[class*="messageBody"]')
                || document.querySelector('[aria-label*="corps du message" i]');
    return {
      from: findLabel('De') || findLabel('From') || findLabel('Expéditeur'),
      to:   findLabel('À')  || findLabel('To')   || findLabel('Destinataire'),
      subject,
      date: findLabel('Envoyé') || findLabel('Sent') || findLabel('Reçu') || findLabel('Received'),
      bodyPreview: bodyEl ? (bodyEl.innerText || '').slice(0, 200) : null,
    };
  });

  const slug = (s) => (s || '').toString().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'x';
  const fromSlug = slug(meta.from || item.text);
  const subjSlug = slug(meta.subject || item.text);
  const dateGuess = (meta.date || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || 'undated';
  let filename = `${prefix}_${dateGuess}_${String(n + 1).padStart(3, '0')}_${fromSlug}_${subjSlug}.pdf`;
  let unique = filename, n2 = 1;
  while (slugs.has(unique)) unique = filename.replace(/\.pdf$/, `_${++n2}.pdf`);
  filename = unique;
  slugs.add(filename);

  const outPath = path.join(outDir, filename);
  try {
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
    console.log('    saved:', filename);
    fs.writeFileSync(outPath.replace(/\.pdf$/, '.json'),
      JSON.stringify({ ...meta, source: 'outlook', query, extracted_at: new Date().toISOString() }, null, 2));
    saved++;
  } catch (e) {
    console.log('    PDF failed:', e.message);
    skipped++;
  }

  // Go back
  try { await page.goBack({ waitUntil: 'domcontentloaded' }); } catch {}
  await page.waitForTimeout(2000);
}

console.log();
console.log('[5/5] done.');
console.log('  saved:   ', saved);
console.log('  skipped: ', skipped);
console.log('  outDir:  ', outDir);

await browser.close();
