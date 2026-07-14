#!/usr/bin/env node
/**
 * auto.cjs — file-watch + auto-commit + auto-push.
 *
 * Watches the current repo (or --path) for file changes; every --interval
 * seconds: stages everything, commits with an auto message, and pushes to
 * origin. Run as a background process. Ctrl+C to stop.
 *
 * Usage:
 *   node scripts/auto.cjs                       # watch cwd
 *   node scripts/auto.cjs --interval 5          # every 5s
 *   node scripts/auto.cjs --no-push             # local-only
 *   node scripts/auto.cjs --path <repo>         # watch a different repo
 */
const { spawnSync } = require('child_process');
const path = require('path');

function parseArgs(argv) {
  const out = { interval: 10 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--no-push')   out.noPush = true;
    else if (k.startsWith('--')) out[k.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv);
const watchPath = args.path ? path.resolve(args.path) : process.cwd();
const interval = parseInt(args.interval, 10) * 1000;
const noPush = !!args.noPush;

console.log('=== auto ===');
console.log('  path     :', watchPath);
console.log('  interval :', (interval / 1000) + 's');
console.log('  push     :', !noPush);
console.log('  Ctrl+C to stop');
console.log();

function runGit(cwd, ...gitArgs) {
  return spawnSync('git', gitArgs, { cwd, encoding: 'utf8' });
}

setInterval(() => {
  const status = runGit(watchPath, 'status', '--porcelain');
  if (status.stdout && status.stdout.trim()) {
    const files = status.stdout.trim().split(/\r?\n/).length;
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    runGit(watchPath, 'add', '-A');
    const commitMsg = `auto(${ts}): ${files} file(s) changed`;
    const c = runGit(watchPath, 'commit', '-m', commitMsg);
    if (c.status !== 0) { console.error('commit failed:', c.stderr); return; }
    if (!noPush) {
      const p = runGit(watchPath, 'push');
      if (p.status !== 0) { console.error('push failed:', p.stderr); return; }
    }
    console.log(`[${ts}] committed ${files} file(s)${noPush ? ' (no push)' : ', pushed'}`);
  }
}, interval);
