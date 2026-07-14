#!/usr/bin/env node
/**
 * dump-kahnawake.cjs — open each of the 9 Kahnawake emails in Outlook, grab
 * the body + headers, and emit a single JSON document. Then sends the whole
 * thing to Mavis on MaxClaw.
 *
 * Strategy:
 *   1. goto Outlook ?q=Kahnawake
 *   2. snapshot the search results to find role=option refs
 *   3. for each ref: click, snapshot body, go back
 *   4. compose a single markdown message and post it to MaxClaw
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const CLI = path.join(__dirname, '..', 'node_modules', '@playwright', 'mcp', 'node_modules', 'playwright-core', 'lib', 'tools', 'cli-client', 'cli.js');
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9223';

function pwcli(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, CDP_URL: CDP },
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    process.stderr.write(`pwcli ${args[0]} failed: ${r.stderr}\n`);
  }
  return r;
}

function pwcliOut(...args) {
  return pwcli(...args).stdout;
}

// 1. Make sure we're on Outlook with the Kahnawake search
console.log('=== dump-kahnawake ===');
console.log('step 1: navigate to Outlook ?q=Kahnawake');
pwcli('goto', 'https://outlook.office365.com/mail/?q=Kahnawake');
// wait for it to settle
const wait = spawnSync(process.execPath, [CLI, 'wait', '--text=Kahnawake'], {
  env: { ...process.env, CDP_URL: CDP },
  encoding: 'utf8',
});

// 2. Find the 9 [role=option] items in the list
console.log('step 2: enumerate search results');
const listJs = `
(() => {
  const items = Array.from(document.querySelectorAll('[role=option]'));
  return items.map((it, idx) => {
    const txt = (it.innerText || '').replace(/\\s+/g, ' ').trim();
    // Try to extract subject (often in a span/div with class containing "subject")
    const subjectEl = it.querySelector('[id*="subject"], [class*="Subject"], [data-testid*="subject"]');
    const subject = subjectEl ? subjectEl.innerText : null;
    return { idx, subject, text: txt.substring(0, 500) };
  });
})()
`;
const listResult = pwcliOut('eval', listJs, '0');
const items = JSON.parse(listResult.match(/### Result\n(.+?)\n###/s)?.[1] || '[]');
console.log(`found ${items.length} items`);

// 3. For each, click, snapshot, extract body
const emails = [];
for (const item of items) {
  console.log(`step 3.${item.idx + 1}: open "${(item.subject || item.text).slice(0, 50)}..."`);
  // Click via JS to keep things deterministic
  const clickJs = `
    (() => {
      const items = document.querySelectorAll('[role=option]');
      const it = items[${item.idx}];
      if (it) { it.click(); return 'clicked ' + ${item.idx}; }
      return 'not found';
    })()
  `;
  pwcli('eval', clickJs, '0');
  // wait for body to load
  spawnSync(process.execPath, [CLI, 'wait', '--time=2'], { env: { ...process.env, CDP_URL: CDP }, encoding: 'utf8' });
  // extract body
  const bodyJs = `
    (() => {
      // Outlook uses aria-label="Message body" or similar
      const bodyEl = document.querySelector('[aria-label="Message body"]')
                  || document.querySelector('[class*="messageBody"]')
                  || document.querySelector('div[role="region"] div[contenteditable]');
      const fromEl = document.querySelector('[aria-label*="From"]') || document.querySelector('[class*="From"]');
      const subjEl = document.querySelector('[class*="ConversationSubject"], [class*="Subject"]');
      return {
        body: bodyEl ? (bodyEl.innerText || bodyEl.textContent).trim() : null,
        from: fromEl ? fromEl.innerText : null,
        subject: subjEl ? subjEl.innerText : null,
        url: location.href,
      };
    })()
  `;
  const bodyResult = pwcliOut('eval', bodyJs, '0');
  const parsed = JSON.parse(bodyResult.match(/### Result\n(.+?)\n###/s)?.[1] || '{}');
  emails.push({
    index: item.idx,
    preview: item.text,
    ...parsed,
  });
  // go back
  pwcli('go-back');
  spawnSync(process.execPath, [CLI, 'wait', '--time=1'], { env: { ...process.env, CDP_URL: CDP }, encoding: 'utf8' });
}

// Save raw dump
const out = path.join(__dirname, '..', '.runs', 'kahnawake-dump.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(emails, null, 2));
console.log(`dump saved: ${out}`);

// 4. Compose a single message
const md = emails.map((e, i) => {
  const lines = [];
  lines.push(`## ${i + 1}. ${e.subject || '(no subject)'}`);
  if (e.from) lines.push(`**From:** ${e.from}`);
  lines.push(`**Preview:** ${e.preview}`);
  if (e.body) {
    lines.push('');
    lines.push('**Body:**');
    lines.push('```');
    lines.push(e.body.substring(0, 4000));
    lines.push('```');
  }
  return lines.join('\n');
}).join('\n\n---\n\n');

const message = `Voici les 9 emails originaux "Kahnawake" depuis Outlook (Francis Végiard, compte fvegiard):

${md}

---
Total: ${emails.length} emails. Dump JSON dans .runs/kahnawake-dump.json.

Dis-moi si tu as besoin des pièces jointes (xlsx, docx, zip) ou du format différent.`;

fs.writeFileSync(path.join(__dirname, '..', '.runs', 'kahnawake-message.md'), message);
console.log('message drafted: .runs/kahnawake-message.md');
console.log();
console.log('NEXT: navigate to Mavis on MaxClaw, paste this into the chat, submit.');
