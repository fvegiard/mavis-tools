#!/usr/bin/env node
/**
 * bootstrap-keys.cjs — boss-mode onboarding.
 *
 * Reads keys from the clipboard, writes .env files, and runs the first
 * IMAP pull. No prompts, no questions. The boss has decided: we move.
 *
 * Usage:
 *   1. Copy your Tailscale auth key to clipboard (Ctrl+C)
 *   2. Copy your Office 365 app password to clipboard (Ctrl+C, twice)
 *   3. Run:  node bootstrap-keys.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ENV_PATH = path.join(HERE, '.env.office365');

function readClipboard() {
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard'], { encoding: 'utf8' });
    return (r.stdout || '').trim();
  } catch { return ''; }
}

function writeEnv(tsKey, o365User, o365Pass) {
  const content = `OFFICE365_AUTH_MODE=apppassword
OFFICE365_USER=${o365User}
OFFICE365_APP_PASSWORD=${o365Pass}
TAILSCALE_AUTH_KEY=${tsKey}
TAILNET=fvegiard
`;
  fs.writeFileSync(ENV_PATH, content, 'utf8');
  console.log('  wrote:', ENV_PATH);
}

function runRobot() {
  console.log('  robot check:');
  const r = spawnSync(process.execPath, [path.join(HERE, 'get-tailscale-key.cjs')], { encoding: 'utf8' });
  console.log(r.stdout);
  const r2 = spawnSync(process.execPath, [path.join(HERE, 'get-oauth-key.cjs')], { encoding: 'utf8' });
  console.log(r2.stdout);
}

function runImap() {
  console.log('  starting IMAP pull: Kahnawake emails (max 50)...');
  const r = spawnSync(process.execPath, [
    path.join(HERE, 'imap-fetcher.cjs'),
    '--query', 'Kahnawake',
    '--out', path.join(HERE, 'imap-kahnawake'),
    '--limit', '50',
  ], { stdio: 'inherit' });
  return r.status === 0;
}

console.log('=== bootstrap-keys ===');
console.log('Reading clipboard...');
const cb1 = readClipboard();
const cb2 = readClipboard();  // second Ctrl+C of the Office 365 app password (if you copy twice)

if (!cb1) {
  console.error('Clipboard empty. Copy a key first.');
  process.exit(1);
}

// Heuristic: Tailscale key starts with "tskey-", app password is 16 chars with dashes
let tsKey = '', o365Pass = '', o365User = 'fvegiard@outlook.com';
if (cb1.startsWith('tskey-')) {
  tsKey = cb1;
  if (cb2 && /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(cb2)) {
    o365Pass = cb2;
  }
} else if (/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(cb1)) {
  o365Pass = cb1;
  if (cb2 && cb2.startsWith('tskey-')) tsKey = cb2;
} else if (cb1.includes('@')) {
  o365User = cb1;
}

if (!tsKey) { console.error('No Tailscale key found. Expected "tskey-..." in clipboard.'); process.exit(1); }
if (!o365Pass) {
  console.error('No Office 365 app password found. Expected "xxxx-xxxx-xxxx-xxxx" in clipboard.');
  process.exit(1);
}

console.log('  ts key  :', tsKey.slice(0, 12) + '...' + tsKey.slice(-4));
console.log('  o365    :', o365User);
console.log('  o365 pw :', '*'.repeat(o365Pass.length - 4) + o365Pass.slice(-4));

writeEnv(tsKey, o365User, o365Pass);
runRobot();

const ok = runImap();
console.log();
console.log('IMAP pull:', ok ? 'OK' : 'FAILED');
if (ok) {
  console.log();
  console.log('Next: zip + push to MaxClaw');
  // Continue the chain
  const out = path.join(HERE, 'imap-kahnawake');
  if (fs.existsSync(out)) {
    const files = fs.readdirSync(out).filter(f => f.endsWith('.eml'));
    console.log('  pulled', files.length, 'emails');
    console.log('  zip and upload coming up...');
  }
}
