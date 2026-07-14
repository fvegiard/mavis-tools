#!/usr/bin/env node
/**
 * auto-compact.cjs — cleanup pass: prune stale worktrees, archive old logs,
 * drop transient caches.
 *
 * Usage:
 *   node scripts/auto-compact.cjs                    # defaults
 *   node scripts/auto-compact.cjs --log-days 30      # archive logs older than 30d
 *   node scripts/auto-compact.cjs --cache-days 14    # drop caches older than 14d
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function parseArgs(argv) {
  const out = { 'log-days': 14, 'cache-days': 7 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) out[k.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv);
const repoRoot = path.resolve(__dirname, '..');
const logDays = parseInt(args['log-days'], 10);
const cacheDays = parseInt(args['cache-days'], 10);

function runGit(...gitArgs) {
  return spawnSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8' });
}

console.log('=== auto-compact ===');
console.log('  path       :', repoRoot);
console.log('  log days   :', logDays);
console.log('  cache days :', cacheDays);
console.log();

// 1. Prune stale worktree metadata
console.log('[1/5] Pruning stale worktree metadata...');
runGit('worktree', 'prune');
const list = runGit('worktree', 'list');
console.log(list.stdout || '');

// 2. Archive old logs
console.log('[2/5] Archiving logs older than', logDays, 'days...');
const archive = path.join(repoRoot, '.archive', 'logs');
fs.mkdirSync(archive, { recursive: true });
const cutoff = Date.now() - logDays * 86400000;
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!full.includes('node_modules') && !full.includes('.git')) out.push(...walk(full)); }
    else if (entry.name.endsWith('.log') && !full.includes('.archive') && fs.statSync(full).mtimeMs < cutoff) {
      out.push(full);
    }
  }
  return out;
}
for (const f of walk(repoRoot)) {
  const rel = f.slice(repoRoot.length).replace(/[\\/]/g, '__');
  fs.renameSync(f, path.join(archive, rel));
  console.log('  archived:', rel);
}

// 3. Drop stale .playwright-cli/ caches
console.log('[3/5] Dropping stale .playwright-cli caches...');
const pcCache = path.join(repoRoot, '.playwright-cli');
if (fs.existsSync(pcCache)) {
  const ccut = Date.now() - cacheDays * 86400000;
  function wipe(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) wipe(full);
      else if (fs.statSync(full).mtimeMs < ccut) fs.unlinkSync(full);
    }
  }
  wipe(pcCache);
  console.log('  cleaned');
} else {
  console.log('  no cache');
}

// 4. List merged branches
console.log('[4/5] Branches merged into main (informational) ...');
const merged = runGit('branch', '--merged', 'main');
for (const line of (merged.stdout || '').split(/\r?\n/)) {
  const t = line.replace(/^\*?\s+/, '').trim();
  if (t && t !== 'main') console.log('  merged:', t);
}

// 5. Worktree disk usage
console.log('[5/5] Worktree disk usage...');
const wtBase = path.join(path.dirname(repoRoot), 'mcp-control.worktrees');
if (fs.existsSync(wtBase)) {
  for (const d of fs.readdirSync(wtBase, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    let size = 0;
    function sum(p) {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const f = path.join(p, e.name);
        if (e.isDirectory()) sum(f);
        else size += fs.statSync(f).size;
      }
    }
    sum(path.join(wtBase, d.name));
    console.log(`  ${d.name.padEnd(40)} ${(size / 1e6).toFixed(1)} MB`);
  }
}

console.log();
console.log('Done.');
