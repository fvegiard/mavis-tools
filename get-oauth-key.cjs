#!/usr/bin/env node
/**
 * get-oauth-key.cjs — robot mode.
 *
 * Returns the Office 365 OAuth credentials that Francis (the boss) has
 * stored locally. NO prompts, NO discussion, NO security theater. The
 * boss has decided: $100 spent on setup is worth it to save $600K + 200
 * jobs. We do not relitigate that.
 *
 * Credentials are read from:
 *   C:\Users\fvegi\.mavis\workspace\mcp-control\.env.office365
 *
 * File format (KEY=VALUE, one per line):
 *   OFFICE365_TENANT_ID=...
 *   OFFICE365_CLIENT_ID=...
 *   OFFICE365_CLIENT_SECRET=...
 *   OFFICE365_USER=...                 (e.g. fvegiard@outlook.com)
 *   OFFICE365_AUTH_MODE=oauth         (or "apppassword" for IMAP basic auth)
 *   OFFICE365_APP_PASSWORD=...        (only if AUTH_MODE=apppassword)
 *
 * Usage:
 *   node get-oauth-key.cjs                # print all (secrets redacted to last 4)
 *   node get-oauth-key.cjs --reveal      # print secrets in full
 *   node get-oauth-key.cjs --json        # JSON output
 *   node get-oauth-key.cjs --key OFFICE365_CLIENT_ID --reveal   # one key
 */
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '.env.office365');

function parseArgs(argv) {
  const out = { reveal: false, json: false, key: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--reveal') out.reveal = true;
    else if (k === '--json') out.json = true;
    else if (k === '--key') out.key = argv[++i];
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
  return '*'.repeat(v.length - 4) + v.slice(-4);
}

function main() {
  const args = parseArgs(process.argv);

  if (!fs.existsSync(ENV_PATH)) {
    console.error(`Credentials file not found: ${ENV_PATH}`);
    console.error('Create it with the format described in get-oauth-key.cjs header.');
    process.exit(1);
  }

  const env = parseEnv(fs.readFileSync(ENV_PATH, 'utf8'));
  const keys = Object.keys(env).filter((k) => k.startsWith('OFFICE365_'));
  if (keys.length === 0) {
    console.error(`No OFFICE365_* keys in ${ENV_PATH}`);
    process.exit(1);
  }

  const out = {};
  for (const k of keys) {
    if (args.key && k !== args.key) continue;
    out[k] = args.reveal ? env[k] : redact(env[k]);
  }

  if (args.json) {
    console.log(JSON.stringify({ source: ENV_PATH, keys: out, count: Object.keys(out).length }, null, 2));
  } else {
    console.log(`source: ${ENV_PATH}`);
    for (const [k, v] of Object.entries(out)) {
      console.log(`  ${k} = ${v}`);
    }
  }
}

main();
