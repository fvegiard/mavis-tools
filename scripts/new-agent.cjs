#!/usr/bin/env node
/**
 * new-agent.cjs — create an isolated worktree for an agent on its own branch.
 *
 * Usage:
 *   node scripts/new-agent.cjs --name coder --task feature-totp
 *
 * Creates:
 *   ../mcp-control.worktrees/coder-feature-totp/  (new worktree)
 *   agent/coder/feature-totp                       (new branch off main)
 *   runs npm install inside the worktree.
 */
const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) out[k.slice(2)] = argv[++i];
  }
  return out;
}

function log(...args) { console.log('[new-agent]', ...args); }
function err(...args) { console.error('[new-agent]', ...args); }

const args = parseArgs(process.argv);
const { name, task } = args;
if (!name || !task) { err('usage: --name <name> --task <task-slug>'); process.exit(2); }

const repoRoot = path.resolve(__dirname, '..');
const parent = path.dirname(repoRoot);
const wtBase = path.join(parent, 'mcp-control.worktrees');
const wtPath = path.join(wtBase, `${name}-${task}`);
const branch = `agent/${name}/${task}`;

function gitIn(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

log('agent     :', name);
log('task      :', task);
log('branch    :', branch);
log('worktree  :', wtPath);

// 1. Sanity: in a git repo, on main
const branchCheck = gitIn(repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD');
if (branchCheck.status !== 0) {
  err('not a git repo:', repoRoot); process.exit(1);
}
const currentBranch = branchCheck.stdout.trim();
if (currentBranch !== 'main') {
  log(`switching to main (was ${currentBranch})`);
  const r = gitIn(repoRoot, 'checkout', 'main');
  if (r.status !== 0) { err('checkout main failed:', r.stderr); process.exit(1); }
}

// 2. Create the worktree base dir
fs.mkdirSync(wtBase, { recursive: true });

// 3. Fail loud if path already exists
if (fs.existsSync(wtPath)) {
  err(`path already exists: ${wtPath}`);
  err(`remove with: git worktree remove "${wtPath}"`);
  process.exit(1);
}

// 4. Reuse or create the branch
const branchList = gitIn(repoRoot, 'branch', '--list', branch);
const branchExists = branchList.stdout.trim().length > 0;

let wtResult;
if (branchExists) {
  log('reusing existing branch', branch);
  wtResult = gitIn(repoRoot, 'worktree', 'add', wtPath, branch);
} else {
  log('creating branch', branch, 'from main');
  wtResult = gitIn(repoRoot, 'worktree', 'add', '-b', branch, wtPath, 'main');
}
if (wtResult.status !== 0) {
  err('git worktree add failed:', wtResult.stderr);
  process.exit(1);
}

// 5. npm install in the new worktree (best-effort)
if (fs.existsSync(path.join(wtPath, 'package.json'))) {
  log('running npm install in worktree...');
  const ni = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: wtPath, stdio: 'inherit', shell: true,
  });
  if (ni.status !== 0) {
    log('  npm install failed (non-fatal). The worktree is still ready; you can run');
    log('  `npm install` manually inside it later.');
  } else {
    log('  npm install OK');
  }
}

console.log();
log('done.', 'resume with:');
log('  cd', `"${wtPath}"`);
log('When done, merge or remove:');
log('  git', '-C', `"${repoRoot}"`, 'merge', branch);
log('  git', '-C', `"${repoRoot}"`, 'worktree', 'remove', `"${wtPath}"`);
log('  git', '-C', `"${repoRoot}"`, 'branch', '-D', branch);
