#!/usr/bin/env node
/**
 * get-tailscale-key.cjs — Tailscale robot mode.
 *
 * The boss (Francis) is the owner of the tailnet and the machine.
 * No security theater, no discussion. Returns the Tailscale key(s) he has
 * stored locally.
 *
 * Keys are read from (in order):
 *   1. $env:TAILSCALE_AUTH_KEY    (injected at runtime)
 *   2. .env.tailscale            (in this directory)
 *   3. Windows Credential Manager  (only if --cred flag)
 *
 * .env.tailscale format (KEY=VALUE, one per line):
 *   TAILSCALE_AUTH_KEY=tskey-auth-...        (auth key, 1 use or reusable)
 *   TAILSCALE_API_KEY=tskey-api-...          (admin API, persistent)
 *   TAILSCALE_OAUTH_CLIENT_ID=...
 *   TAILSCALE_OAUTH_CLIENT_SECRET=...
 *   TAILSCALE_TAILNET=-                      (your tailnet org, defaults to '-')
 *
 * Usage:
 *   node get-tailscale-key.cjs                       # all keys, redacted
 *   node get-tailscale-key.cjs --reveal             # full secrets
 *   node get-tailscale-key.cjs --key TAILSCALE_AUTH_KEY --reveal
 *   node get-tailscale-key.cjs --cred               # also try Credential Manager
 *   node get-tailscale-key.cjs --json
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ENV_PATH = path.join(__dirname, '.env.tailscale');

function parseArgs(argv) {
  const out = { reveal: false, json: false, key: null, cred: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--reveal') out.reveal = true;
    else if (k === '--json') out.json = true;
    else if (k === '--key') out.key = argv[++i];
    else if (k === '--cred') out.cred = true;
  }
  return out;
}

function parseEnv(content) {
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function redact(v) {
  if (!v) return '(empty)';
  if (v.length <= 8) return '****';
  if (v.startsWith('tskey-')) return v.slice(0, 7) + '...' + v.slice(-4);
  return '*'.repeat(v.length - 4) + v.slice(-4);
}

function readEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return {};
  return parseEnv(fs.readFileSync(ENV_PATH, 'utf8'));
}

function readEnvVar() {
  // Anything set as process env at runtime
  const out = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('TAILSCALE_')) out[k] = process.env[k];
  }
  return out;
}

function readCredMgr() {
  // Windows Credential Manager via cmdkey. Only works for "Generic" credentials.
  // Tailscale stores some things there, but mostly the auth state.
  try {
    const out = execSync('cmdkey /list', { encoding: 'utf8' });
    const lines = out.split(/\r?\n/);
    const found = {};
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Target: Tailscale')) {
        const target = (lines[i].match(/Target: (.+)/) || [])[1];
        if (target) found[`CRED_${target.replace(/[^a-zA-Z0-9]/g, '_')}`] = '(in Windows Credential Manager — use cmdkey /generic:Tailscale to retrieve)';
      }
    }
    return found;
  } catch { return {}; }
}

function main() {
  const args = parseArgs(process.argv);
  const fileEnv = readEnvFile();
  const procEnv = readEnvVar();
  const credEnv = args.cred ? readCredMgr() : {};

  // Merge: env var wins over file
  const env = { ...fileEnv, ...procEnv, ...credEnv };
  const keys = Object.keys(env).filter((k) => k.startsWith('TAILSCALE_') || k.startsWith('CRED_'));
  if (keys.length === 0) {
    console.error('No Tailscale keys found.');
    console.error('  • Set $env:TAILSCALE_AUTH_KEY=... before running, OR');
    console.error('  • Create ' + ENV_PATH);
    if (!args.cred) console.error('  • Or re-run with --cred to check Windows Credential Manager');
    process.exit(1);
  }

  const out = {};
  for (const k of keys) {
    if (args.key && k !== args.key) continue;
    out[k] = args.reveal ? env[k] : redact(env[k]);
  }

  if (args.json) {
    console.log(JSON.stringify({ source: ENV_PATH, envVar: Object.keys(procEnv), keys: out, count: Object.keys(out).length }, null, 2));
  } else {
    console.log('source: ' + (Object.keys(procEnv).length ? 'env-var + ' : '') + ENV_PATH);
    for (const [k, v] of Object.entries(out)) {
      console.log('  ' + k + ' = ' + v);
    }
  }

  // Auto-print the current node status for context
  console.log();
  console.log('current tailnet status:');
  try {
    const out = execSync('tailscale status --json 2>nul', { encoding: 'utf8' });
    const j = JSON.parse(out);
    console.log('  tailnet:', j.CurrentTailnet?.Name || '(unknown)');
    console.log('  self  :', j.SelfDNSName || '(unknown)');
    console.log('  ips   :', (j.TailscaleIPs || []).join(', '));
  } catch {}
}

main();
