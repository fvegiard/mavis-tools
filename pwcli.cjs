#!/usr/bin/env node
/**
 * pwcli.cjs — thin wrapper around the official Microsoft playwright-cli
 * (bundled inside @playwright/mcp). Uses the accessibility tree (a11y) for
 * deterministic element refs — NO screenshots during normal operation.
 *
 * Setup:
 *   1. start-edge-debug.bat          (Edge with --remote-debugging-port=9223)
 *   2. node pwcli.cjs attach         (one-time, attaches CLI to that Edge)
 *   3. node pwcli.cjs snapshot       (see refs like e15, e22, ...)
 *   4. node pwcli.cjs click e15      (act on a ref)
 *
 * Or use the convenience shortcuts:
 *   node pwcli.cjs tabs             (list open tabs)
 *   node pwcli.cjs goto <url>       (navigate active tab)
 *   node pwcli.cjs eval "<js>"      (run JS, no screenshot)
 *   node pwcli.cjs text "<query>"   (find element by visible text)
 *   node pwcli.cjs shot out.png     (screenshot, rare)
 */
const { spawn } = require('child_process');
const path = require('path');

const CLI = path.join(
  __dirname,
  'node_modules/@playwright/mcp/node_modules/playwright-core/lib/tools/cli-client/cli.js'
);

const [, , cmd, ...rest] = process.argv;
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(`pwcli.cjs — Microsoft playwright-cli wrapper for Mavis

Quick start:
  node pwcli.cjs attach                       attach to Edge (run once per session)
  node pwcli.cjs snapshot                     show accessibility tree (refs like e15)
  node pwcli.cjs click e15                    click ref
  node pwcli.cjs fill e5 "hello world"        fill an input
  node pwcli.cjs type "search query"          type into focused field
  node pwcli.cjs press Enter                  press a key
  node pwcli.cjs goto https://example.com     navigate
  node pwcli.cjs eval "document.title"        run JS, get string back
  node pwcli.cjs find "Kahnawake"             find element by text in current snapshot

Shortcuts:
  node pwcli.cjs tabs                         list current tabs (browser_tabs list)
  node pwcli.cjs text "<query>"               find by text (alias for find)
  node pwcli.cjs shot <out.png>               take a screenshot

Anything else is forwarded verbatim to playwright-cli.
See: node node_modules/@playwright/mcp/node_modules/playwright-core/lib/tools/cli-client/cli.js --help
`);
  process.exit(0);
}

const args = [CLI];
if (cmd === 'attach') {
  args.push('attach', '--cdp', process.env.CDP_URL || 'http://127.0.0.1:9223');
} else if (cmd === 'tabs') {
  args.push('eval', '() => Array.from(document.querySelectorAll(\'a[href*="http"], [role="tab"]\')).map((a,i) => ({i, t: (a.innerText||"").trim().slice(0,80), href: a.href || ""}))');
} else if (cmd === 'text') {
  args.push('find', ...rest);
} else if (cmd === 'shot') {
  args.push('screenshot', '--filename', rest[0] || `shot-${Date.now()}.png`);
} else {
  args.push(cmd, ...rest);
}

const proc = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
proc.on('close', (code) => process.exit(code || 0));
