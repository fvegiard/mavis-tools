#!/usr/bin/env node
/**
 * mcp.cjs — unified entry point.
 *
 * Browser side uses the official Microsoft playwright-cli (a11y tree, no
 * screenshot flash). Windows side uses a PowerShell-backed helper.
 *
 *   node mcp.cjs browser <open|attach|snapshot|click|fill|...>  → pwcli.cjs
 *   node mcp.cjs windows <screenshot|click|type|...>            → windows.cjs
 *
 * Shortcuts:
 *   node mcp.cjs attach                attach pwcli to your Edge
 *   node mcp.cjs tabs                  list open tabs in Edge
 *   node mcp.cjs snap [target]         show the a11y snapshot (refs)
 *   node mcp.cjs click <ref>           click an element by ref
 *   node mcp.cjs find "<text>"         find an element by visible text
 *   node mcp.cjs eval "<js>"           run JS in active page
 *   node mcp.cjs shot <out.png>        take a screenshot (rare)
 *   node mcp.cjs screen [outPath]      desktop screenshot
 *   node mcp.cjs lswin                 list open Windows windows
 *   node mcp.cjs focus "<title>"       activate a window
 */
const { spawn } = require('child_process');
const path = require('path');

const HERE = __dirname;
const PWCLI = path.join(HERE, 'pwcli.cjs');
const WINDOWS = path.join(HERE, 'windows.cjs');

function run(script, args) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [path.join(HERE, script), ...args], {
      stdio: 'inherit',
      windowsHide: true,
    });
    proc.on('close', (code) => process.exit(code || 0));
  });
}

const [, , group, sub, ...rest] = process.argv;

(async () => {
  if (!group) {
    console.log(`mcp.cjs — Mavis local MCP wrapper

Browser (uses official Microsoft playwright-cli, a11y tree):
  node mcp.cjs attach
  node mcp.cjs tabs
  node mcp.cjs snap [target]
  node mcp.cjs click <ref>
  node mcp.cjs fill <ref> "<text>"
  node mcp.cjs type "<text>"
  node mcp.cjs press <key>
  node mcp.cjs find "<text>"
  node mcp.cjs eval "<js>"
  node mcp.cjs goto <url>
  node mcp.cjs shot <out.png>

Windows (PowerShell helper):
  node mcp.cjs screen [outPath]                  desktop screenshot
  node mcp.cjs lswin                             list windows
  node mcp.cjs focus "<titleSubstr>"             activate a window
  node mcp.cjs click <x> <y>                     click at coords
  node mcp.cjs type "<text>"                     type text
  node mcp.cjs run <shellCommand>                run a shell command

Anything else is forwarded as: node mcp.cjs browser <args...>
or:                              node mcp.cjs windows <args...>
`);
    return;
  }

  // Browser shortcuts (use pwcli.cjs)
  if (group === 'attach') return run('pwcli.cjs', ['attach']);
  if (group === 'tabs') return run('pwcli.cjs', ['tabs']);
  if (group === 'snap' || group === 'snapshot') return run('pwcli.cjs', ['snapshot', sub, ...rest].filter(Boolean));
  if (group === 'click') {
    if (!sub) throw new Error('click needs <ref>');
    return run('pwcli.cjs', ['click', sub, ...rest]);
  }
  if (group === 'fill') {
    if (!sub || rest[0] === undefined) throw new Error('fill needs <ref> <text>');
    return run('pwcli.cjs', ['fill', sub, rest[0]]);
  }
  if (group === 'type') {
    if (sub === undefined) throw new Error('type needs <text>');
    return run('pwcli.cjs', ['type', ...(sub ? [sub] : []), ...rest]);
  }
  if (group === 'press') {
    if (!sub) throw new Error('press needs <key>');
    return run('pwcli.cjs', ['press', sub, ...rest]);
  }
  if (group === 'find' || group === 'text') {
    if (!sub) throw new Error('find needs <text>');
    return run('pwcli.cjs', ['find', sub, ...rest]);
  }
  if (group === 'eval') {
    if (sub === undefined) throw new Error('eval needs <js>');
    return run('pwcli.cjs', ['eval', [sub, ...rest].join(' ')]);
  }
  if (group === 'goto') {
    if (!sub) throw new Error('goto needs <url>');
    return run('pwcli.cjs', ['goto', sub, ...rest]);
  }
  if (group === 'shot' || group === 'screenshot') {
    return run('pwcli.cjs', ['shot', sub, ...rest].filter(Boolean));
  }
  if (group === 'browser') return run('pwcli.cjs', [sub, ...rest].filter(Boolean));

  // Windows shortcuts (use windows.cjs)
  if (group === 'screen') return run('windows.cjs', ['screenshot', sub || path.join(HERE, `screen-${Date.now()}.png`)]);
  if (group === 'lswin') return run('windows.cjs', ['windows']);
  if (group === 'focus') {
    if (!sub) throw new Error('focus needs <titleSubstr>');
    return run('windows.cjs', ['activate', sub, ...rest]);
  }
  if (group === 'windows') return run('windows.cjs', [sub, ...rest].filter(Boolean));

  console.error(`Unknown group: ${group}`);
  process.exit(1);
})();
