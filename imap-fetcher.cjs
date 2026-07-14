#!/usr/bin/env node
/**
 * imap-fetcher.cjs — pull live emails from Office 365 via IMAP.
 *
 * Two modes (AUTH_MODE in .env.office365):
 *   - apppassword: simple IMAP basic auth (app password, no OAuth dance)
 *   - oauth: XOAUTH2 SASL using client_id/secret (more complex, requires
 *            Azure app registration with IMAP.AccessAsUser.All scope)
 *
 * Usage:
 *   node imap-fetcher.cjs --query "Kahnawake" --out ./out --format msg
 *   node imap-fetcher.cjs --mailbox INBOX --since 2026-01-01 --out ./all
 *   node imap-fetcher.cjs --hash-only --mailbox INBOX     # just dump SHA256 of each .msg
 *
 * Output: RFC822 (.eml) or .msg files plus a .json sidecar with headers.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const tls = require('tls');

const ENV_PATH = path.join(__dirname, '.env.office365');
if (!fs.existsSync(ENV_PATH)) {
  console.error(`Credentials not found: ${ENV_PATH}. Run get-oauth-key.cjs for help.`);
  process.exit(1);
}
const env = {};
for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2];
}
const AUTH_MODE = env.OFFICE365_AUTH_MODE || 'apppassword';
const HOST = env.OFFICE365_IMAP_HOST || 'outlook.office365.com';
const PORT = 993;
const USER = env.OFFICE365_USER;
if (!USER) { console.error('OFFICE365_USER missing from .env.office365'); process.exit(1); }

function parseArgs(argv) {
  const out = { format: 'eml', hashOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--query') out.query = argv[++i];
    else if (k === '--out') out.out = argv[++i];
    else if (k === '--mailbox') out.mailbox = argv[++i];
    else if (k === '--since') out.since = argv[++i];
    else if (k === '--limit') out.limit = parseInt(argv[++i], 10);
    else if (k === '--format') out.format = argv[++i];
    else if (k === '--hash-only') out.hashOnly = true;
  }
  return out;
}
const args = parseArgs(process.argv);
const OUT_DIR = path.resolve(args.out || './imap-out');
fs.mkdirSync(OUT_DIR, { recursive: true });

// --- IMAP protocol helpers (minimal subset) ---
function imapConnect() {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host: HOST, port: PORT, servername: HOST }, () => resolve(sock));
    sock.on('error', reject);
  });
}

function readLine(sock) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        // Untagged response: continuation. Wait for more.
        if (line.startsWith('+ ')) {
          // Continuation, caller should send next
          continue;
        }
        // First line received; remove listener
        sock.removeListener('data', onData);
        resolve({ line, sock, readMore: () => readUntil(sock, line) });
      }
    };
    sock.on('data', onData);
    sock.on('error', reject);
  });
}

function readUntil(sock, lastLine) {
  return new Promise((resolve, reject) => {
    let buf = lastLine + '\r\n';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\r\n')) !== -1) {
        // Try to find end of an IMAP response: tagged line that matches
        if (buf.match(/^\* OK /)) { /* greeting, keep reading */ }
        // Look for the final tagged response. We need a tag.
        // Simplification: wait for a CRLF followed by a tagged line; but with
        // untagged * OK / * LIST etc we need a smarter approach.
        // Instead, look for the pattern: a line that doesn't start with * or +.
        const lines = buf.split('\r\n');
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          if (l && !l.startsWith('*') && !l.startsWith('+')) {
            sock.removeListener('data', onData);
            resolve(l);
            return;
          }
        }
      }
    };
    sock.on('data', onData);
    sock.on('error', reject);
  });
}

function send(sock, cmd) {
  return new Promise((resolve, reject) => {
    sock.write(cmd + '\r\n', 'utf8', (err) => err ? reject(err) : resolve());
  });
}

// Token via OAuth2 client credentials (app-only, no user flow)
async function getOAuthToken() {
  const tenant = env.OFFICE365_TENANT_ID;
  const client = env.OFFICE365_CLIENT_ID;
  const secret = env.OFFICE365_CLIENT_SECRET;
  if (!tenant || !client || !secret) throw new Error('OAuth creds missing in .env.office365');
  const body = new URLSearchParams({
    client_id: client, client_secret: secret, scope: 'https://outlook.office.com/.default',
    grant_type: 'client_credentials',
  }).toString();
  const resp = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const j = await resp.json();
  if (!j.access_token) throw new Error('No access_token: ' + JSON.stringify(j));
  return j.access_token;
}

function buildXOauth2(user, token) {
  const auth = `user=${user}\x01auth=Bearer ${token}\x01\x01`;
  return Buffer.from(auth, 'utf8').toString('base64');
}

async function login(sock) {
  if (AUTH_MODE === 'apppassword') {
    const pw = env.OFFICE365_APP_PASSWORD;
    if (!pw) throw new Error('OFFICE365_APP_PASSWORD missing');
    await send(sock, `A1 LOGIN "${USER}" "${pw}"`);
    const resp = await readUntil(sock, '');
    if (!resp.startsWith('A1 OK')) throw new Error('LOGIN failed: ' + resp);
    return;
  }
  // OAuth2
  const token = await getOAuthToken();
  const xoauth2 = buildXOauth2(USER, token);
  await send(sock, `A1 AUTHENTICATE XOAUTH2 ${xoauth2}`);
  // IMAP returns continuation + then OK
  const resp = await readUntil(sock, '');
  if (!resp.includes('OK')) {
    // Try SASL-IR
    await send(sock, `A1 AUTHENTICATE XOAUTH2`);
    // XOAUTH2 string on next line
    sock.write(xoauth2 + '\r\n');
    const resp2 = await readUntil(sock, '');
    if (!resp2.includes('OK')) throw new Error('OAuth login failed: ' + resp2);
  }
}

function quoteIfNeeded(s) {
  return /[ "\\\(\)]/.test(s) ? '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : s;
}

async function listMailboxes(sock) {
  await send(sock, 'B1 LIST "" "*"');
  const all = await readUntil(sock, '');
  return all;
}

async function selectMailbox(sock, name) {
  await send(sock, `C1 SELECT ${quoteIfNeeded(name)}`);
  const resp = await readUntil(sock, '');
  if (!resp.includes('OK')) throw new Error('SELECT failed: ' + resp);
}

async function uidSearch(sock, criteria) {
  await send(sock, `D1 UID SEARCH ${criteria}`);
  const resp = await readUntil(sock, '');
  // Parse "D1 OK" or "* SEARCH 1 2 3"
  const m = resp.match(/\* SEARCH ([\d ]+)/);
  const ids = m ? m[1].trim().split(/\s+/).filter(Boolean) : [];
  return ids;
}

async function uidFetch(sock, uid) {
  await send(sock, `E1 UID FETCH ${uid} (RFC822)`);
  // Read until tagged response
  const all = await readUntil(sock, '');
  // Find RFC822 body
  const m = all.match(/\{(\d+)\}/);
  if (!m) return null;
  // ... we need to actually read the literal body. For now, use a simpler approach.
  // Re-implement with proper literal reading.
  return await fetchLiteral(sock, parseInt(m[1], 10));
}

async function fetchLiteral(sock, len) {
  return new Promise((resolve, reject) => {
    let got = 0;
    let body = Buffer.alloc(0);
    const onData = (chunk) => {
      body = Buffer.concat([body, chunk]);
      got += chunk.length;
      if (got >= len) {
        sock.removeListener('data', onData);
        // Wait for the closing CRLF and the tagged response
        // The literal is followed by CRLF and then E1 OK or similar
        // We'll need to read the tagged response too
        resolve(body.slice(0, len));
      }
    };
    sock.on('data', onData);
    sock.on('error', reject);
  });
}

async function main() {
  console.log('=== imap-fetcher ===');
  console.log('  host     :', HOST);
  console.log('  user     :', USER);
  console.log('  auth     :', AUTH_MODE);
  console.log('  mailbox  :', args.mailbox || 'INBOX');
  console.log('  query    :', args.query);
  console.log('  out      :', OUT_DIR);

  const sock = await imapConnect();
  const greeting = await readUntil(sock, '');
  console.log('  greeting :', greeting.split('\r\n')[0]);

  await login(sock);
  console.log('  logged in');

  await selectMailbox(sock, args.mailbox || 'INBOX');

  // Build SEARCH criteria
  let criteria = 'ALL';
  if (args.query) criteria += ` TEXT "${args.query}"`;
  if (args.since) {
    const d = args.since.replace(/-/g, '-');
    criteria += ` SINCE ${d}`;
  }
  const uids = await uidSearch(sock, criteria);
  console.log('  found    :', uids.length, 'uids');
  if (args.hashOnly) { sock.end(); return; }

  const limit = args.limit || uids.length;
  let saved = 0, errs = 0;
  for (const uid of uids.slice(0, limit)) {
    try {
      const body = await uidFetch(sock, uid);
      if (!body) { errs++; continue; }
      const sha = crypto.createHash('sha256').update(body).digest('hex');
      const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const filename = `${date}_${uid}_${sha.slice(0, 12)}.eml`;
      const out = path.join(OUT_DIR, filename);
      fs.writeFileSync(out, body);
      // Sidecar: sha + minimal header
      const headers = body.toString('utf8').split(/\r\n\r\n/)[0] || '';
      fs.writeFileSync(out + '.json', JSON.stringify({ uid, sha256: sha, len: body.length, headers: headers.slice(0, 1000) }, null, 2));
      saved++;
    } catch (e) {
      console.error('  err uid', uid, ':', e.message);
      errs++;
    }
  }
  console.log('  saved    :', saved);
  console.log('  errors   :', errs);
  sock.end();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
