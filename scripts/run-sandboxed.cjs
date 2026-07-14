#!/usr/bin/env node
/**
 * run-sandboxed.cjs — run a command in an isolated sandbox.
 *
 * Modes:
 *   uvx    : run via `uvx` (Python tool runner, ephemeral venv)
 *   docker : run inside a Docker container
 *   wsl    : run inside the WSL default distro
 *   none   : run as-is (no isolation)
 *
 * Usage:
 *   node scripts/run-sandboxed.cjs --mode uvx --command 'cowsay -t "hi"'
 *   node scripts/run-sandboxed.cjs --mode docker --image python:3.13-slim --command 'python -c "print(1)"'
 *   node scripts/run-sandboxed.cjs --mode wsl --command 'uname -a'
 */
const { spawnSync } = require('child_process');
const path = require('path');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--mode')   out.mode = argv[++i];
    else if (k === '--image') out.image = argv[++i];
    else if (k === '--command') out.command = argv[++i];
    else if (k === '--cwd') out.cwd = argv[++i];
    else if (k.startsWith('--')) out[k.slice(2)] = argv[++i];
    else out._.push(k);
  }
  return out;
}

const args = parseArgs(process.argv);
const mode = args.mode || 'none';
const image = args.image || 'python:3.13-slim';
const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
const command = args.command || args._.join(' ');

if (!command) { console.error('usage: --mode <uvx|docker|wsl|none> --command "<cmd>"'); process.exit(2); }

let result;
switch (mode) {
  case 'uvx': {
    console.log(`[run-sandboxed:uvx] ${command}`);
    // uvx is one tool-runner; we pass the command as a single string after --
    result = spawnSync('uvx', ['--from', image === 'python:3.13-slim' ? 'cowsay' : image, ...command.split(/\s+/)], {
      cwd, stdio: 'inherit', shell: true,
    });
    break;
  }
  case 'docker': {
    console.log(`[run-sandboxed:docker] ${image}  ${command}`);
    const abs = cwd.replace(/\\/g, '/');
    result = spawnSync('docker', ['run', '--rm', '-i', '-v', `${abs}:/work`, '-w', '/work', image, 'sh', '-c', command], {
      stdio: 'inherit',
    });
    break;
  }
  case 'wsl': {
    console.log(`[run-sandboxed:wsl] ${command}`);
    // Convert Windows path to WSL path
    const wslPathResult = spawnSync('wsl', ['wslpath', '-u', cwd], { encoding: 'utf8' });
    if (wslPathResult.status !== 0) { console.error('wslpath failed'); process.exit(1); }
    const wslPath = wslPathResult.stdout.trim();
    result = spawnSync('wsl', ['--', 'bash', '-c', `cd "${wslPath}" && ${command}`], {
      stdio: 'inherit',
    });
    break;
  }
  case 'none': {
    console.log(`[run-sandboxed:none] ${command}`);
    result = spawnSync(command, { cwd, stdio: 'inherit', shell: true });
    break;
  }
  default:
    console.error(`unknown mode: ${mode}`); process.exit(2);
}

process.exit(result && typeof result.status === 'number' ? result.status : 0);
