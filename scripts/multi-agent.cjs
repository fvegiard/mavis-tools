#!/usr/bin/env node
/**
 * multi-agent.cjs — one-shot agent run: worktree + sandbox + run + commit + push.
 *
 * Usage:
 *   node scripts/multi-agent.cjs \
 *       --name coder --task cowsay-demo \
 *       --command 'cowsay -t "I am agent coder"' --mode uvx
 *
 * Steps:
 *   1. Create a new worktree on a fresh branch (via new-agent.cjs).
 *   2. Run --command in the requested --mode sandbox.
 *   3. Capture stdout/stderr to .runs/<branch>.log.
 *   4. Commit + push (unless --no-push).
 *   5. Print a one-screen summary.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--no-push')   out.noPush = true;
    else if (k === '--remove') out.remove = true;
    else if (k.startsWith('--')) out[k.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv);
const { name, task, command, mode = 'uvx' } = args;
if (!name || !task || !command) {
  console.error('usage: --name <n> --task <slug> --command "<cmd>" [--mode uvx|docker|wsl|none] [--no-push] [--remove]');
  process.exit(2);
}

const here = __dirname;
const repoRoot = path.resolve(here, '..');
const parent = path.dirname(repoRoot);
const wtPath = path.join(parent, 'mcp-control.worktrees', `${name}-${task}`);
const branch = `agent/${name}/${task}`;
const runsDir = path.join(repoRoot, '.runs');
const logFile = path.join(runsDir, branch.replace(/\//g, '__') + '.log');

fs.mkdirSync(runsDir, { recursive: true });

console.log('=== multi-agent ===');
console.log('  agent     :', name);
console.log('  task      :', task);
console.log('  branch    :', branch);
console.log('  worktree  :', wtPath);
console.log('  mode      :', mode);
console.log('  log       :', logFile);
console.log();

// 1. Create worktree
console.log('[1/4] Creating worktree...');
const create = spawnSync(process.execPath, [path.join(here, 'new-agent.cjs'), '--name', name, '--task', task], {
  stdio: 'inherit',
});
if (create.status !== 0) { console.error('worktree creation failed'); process.exit(1); }

// 2. Run in sandbox
console.log();
console.log('[2/4] Running command in', mode, 'sandbox...');
const header = `# run at ${new Date().toISOString()}\n# branch: ${branch}\n# mode:   ${mode}\n# cmd:    ${command}\n`;
fs.writeFileSync(logFile, header);

const sandbox = spawnSync(process.execPath, [
  path.join(here, 'run-sandboxed.cjs'),
  '--mode', mode,
  '--command', command,
  '--cwd', wtPath,
], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
fs.appendFileSync(logFile, sandbox.stdout || '');
fs.appendFileSync(logFile, sandbox.stderr || '');
process.stdout.write(sandbox.stdout || '');
process.stderr.write(sandbox.stderr || '');

// 3. Commit + push
console.log();
console.log('[3/4] Commit + push...');
const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
const commitMsg = `agent/${name}/${task}: ${command}\n\nRan in ${mode} sandbox. Log: ${path.relative(repoRoot, logFile)}`;
const add = spawnSync('git', ['add', '-A'], { cwd: wtPath });
const commit = spawnSync('git', ['commit', '-m', commitMsg], { cwd: wtPath, encoding: 'utf8' });
if (commit.status !== 0) console.error('commit:', commit.stderr);
if (!args.noPush) {
  const push = spawnSync('git', ['push', '-u', 'origin', branch], { cwd: wtPath, stdio: 'inherit' });
  if (push.status !== 0) console.error('push failed');
}

// 4. Optionally remove worktree
console.log();
if (args.remove) {
  console.log('[4/4] Removing worktree...');
  spawnSync('git', ['worktree', 'remove', '--force', wtPath], { cwd: repoRoot, stdio: 'inherit' });
} else {
  console.log('[4/4] Keeping worktree at', wtPath);
  console.log('        resume: cd', `"${wtPath}"`);
}

console.log();
console.log('Done.');
console.log('  log    :', logFile);
console.log('  branch :', branch);
if (!args.noPush) console.log('  remote : pushed to origin/' + branch);
