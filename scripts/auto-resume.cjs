#!/usr/bin/env node
/**
 * auto-resume.cjs — show active worktrees, last commit, dirty state, and
 * the exact command to jump back in.
 *
 * Usage:
 *   node scripts/auto-resume.cjs
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..');
const parent = path.dirname(repoRoot);
const wtBase = path.join(parent, 'mcp-control.worktrees');

console.log('=== auto-resume ===');
console.log('  worktrees :', wtBase);
console.log();

if (!fs.existsSync(wtBase)) {
  console.log('No worktrees directory yet.');
  process.exit(0);
}

function gitIn(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

for (const d of fs.readdirSync(wtBase, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const wt = path.join(wtBase, d.name);
  if (!fs.existsSync(path.join(wt, '.git'))) continue;

  const branch = gitIn(wt, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
  if (!branch) continue;

  const subject = gitIn(wt, 'log', '-1', '--pretty=%s').stdout.trim();
  const age = gitIn(wt, 'log', '-1', '--pretty=%cr').stdout.trim();
  const dirty = gitIn(wt, 'status', '--porcelain').stdout.trim().split(/\r?\n/).filter(Boolean).length;
  const ahead = parseInt(gitIn(wt, 'rev-list', '--count', 'origin/main..HEAD').stdout.trim() || '0', 10);
  const behind = parseInt(gitIn(wt, 'rev-list', '--count', 'HEAD..origin/main').stdout.trim() || '0', 10);

  console.log(`[${branch}]`);
  console.log('  path        :', wt);
  console.log('  last commit :', `${subject} (${age})`);
  if (dirty > 0) console.log('  dirty       :', `${dirty} uncommitted file(s)`);
  if (ahead > 0)  console.log('  ahead main  :', `${ahead} commit(s)`);
  if (behind > 0) console.log('  behind main :', `${behind} commit(s)`);
  console.log('  resume with :', `cd "${wt}"`);
  console.log();
}

console.log('Tip: run auto-resume.cjs anytime to see this list.');
