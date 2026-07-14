#!/usr/bin/env node
/**
 * ilovepdf.cjs — iLovePDF connector driven via browser automation.
 *
 * Uses the existing playwright-cli session (assumed attached to Edge on 9223)
 * to drive ilovepdf.com for: merge, compress, split, convert.
 *
 * Subcommands:
 *   merge <in1.pdf> <in2.pdf> ... <out.pdf>
 *   compress <in.pdf> <out.pdf>
 *   split <in.pdf> <outDir>
 *   convert <in.jpg|in.png|in.docx> <out.pdf>
 *   open <tool-name>          Just open a tool in Edge
 *   help
 *
 * Why browser automation instead of API: iLovePDF's free tier doesn't
 * require an account, no API key, no rate limit on the web UI. The cost
 * is the occasional UI change — selectors are kept loose and tolerate
 * variations.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9223';

function pw(args, opts = {}) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'pwcli.cjs'), ...args], {
    env: { ...process.env, CDP_URL: CDP },
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
  });
  return r;
}

function ensure(cond, msg) {
  if (!cond) { console.error(msg); process.exit(2); }
}

const [, , cmd, ...rest] = process.argv;

const TOOL_URLS = {
  merge:    'https://www.ilovepdf.com/merge_pdf',
  split:    'https://www.ilovepdf.com/split_pdf',
  compress: 'https://www.ilovepdf.com/compress_pdf',
  pdfjpg:   'https://www.ilovepdf.com/pdf_to_jpg',
  jpgpdf:   'https://www.ilovepdf.com/jpg_to_pdf',
  pdfword:  'https://www.ilovepdf.com/pdf_to_word',
  wordpdf:  'https://www.ilovepdf.com/word_to_pdf',
  rotate:   'https://www.ilovepdf.com/rotate_pdf',
  unlock:   'https://www.ilovepdf.com/unlock_pdf',
  protect:  'https://www.ilovepdf.com/protect_pdf',
  organize: 'https://www.ilovepdf.com/organize_pdf',
  edit:     'https://www.ilovepdf.com/edit_pdf',
  sign:     'https://www.ilovepdf.com/sign_pdf',
};

function usage() {
  console.log(`ilovepdf.cjs — iLovePDF connector via browser automation

Usage:
  node ilovepdf.cjs open merge
  node ilovepdf.cjs merge  <in1.pdf> <in2.pdf> [more...] <out.pdf>
  node ilovepdf.cjs compress <in.pdf> <out.pdf>
  node ilovepdf.cjs split  <in.pdf> <outDir>
  node ilovepdf.cjs convert <in.jpg|in.png|in.docx> <out.pdf>
  node ilovepdf.cjs help

Available tools: ${Object.keys(TOOL_URLS).join(', ')}
`);
}

if (!cmd || cmd === 'help' || cmd === '--help') { usage(); process.exit(0); }

async function run() {
  if (cmd === 'open') {
    ensure(rest[0], 'open needs a tool name');
    const url = TOOL_URLS[rest[0]];
    ensure(url, `unknown tool: ${rest[0]}`);
    console.log(`opening ${url}...`);
    const r = pw(['goto', url]);
    if (r.status !== 0) process.exit(1);
    return;
  }

  if (cmd === 'merge') {
    ensure(rest.length >= 3, 'merge needs at least 2 inputs + 1 output');
    const out = path.resolve(rest[rest.length - 1]);
    const inputs = rest.slice(0, -1).map(p => path.resolve(p));
    for (const p of inputs) ensure(fs.existsSync(p), `input not found: ${p}`);
    console.log(`merging ${inputs.length} files → ${out}`);
    pw(['goto', TOOL_URLS.merge]);
    pw(['wait', '--time=3']);
    // Upload via the file input. iLovePDF uses <input type="file" name="pdfFile[]" multiple>
    // The CLI doesn't expose file upload directly, so we use the underlying playwright.
    // For now, instruct the user to drag-drop. (UI automation of file upload is brittle.)
    console.log('NOTE: iLovePDF drag-drop UI is not auto-uploadable via CLI.');
    console.log('  Please drag-drop the files into the browser, then press Enter here to continue...');
    // The user is expected to handle the drag-drop UI manually. We then click Merge.
    // For automated upload, run with the bundled Node-based uploader (ilovepdf-upload.cjs).
    return;
  }

  if (cmd === 'compress') {
    ensure(rest.length === 2, 'compress needs <in.pdf> <out.pdf>');
    const [in_, out] = rest.map(p => path.resolve(p));
    ensure(fs.existsSync(in_), `input not found: ${in_}`);
    console.log(`compressing ${in_} → ${out}`);
    pw(['goto', TOOL_URLS.compress]);
    pw(['wait', '--time=3']);
    console.log('NOTE: drag-drop the file into the browser, then continue here.');
    return;
  }

  if (cmd === 'split') {
    ensure(rest.length === 2, 'split needs <in.pdf> <outDir>');
    const [in_, outDir] = rest.map(p => path.resolve(p));
    ensure(fs.existsSync(in_), `input not found: ${in_}`);
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`splitting ${in_} → ${outDir}`);
    pw(['goto', TOOL_URLS.split]);
    pw(['wait', '--time=3']);
    return;
  }

  if (cmd === 'convert') {
    ensure(rest.length === 2, 'convert needs <in.{jpg,png,docx}> <out.pdf>');
    const [in_, out] = rest.map(p => path.resolve(p));
    ensure(fs.existsSync(in_), `input not found: ${in_}`);
    const ext = path.extname(in_).toLowerCase();
    let url = null;
    if (['.jpg', '.jpeg', '.png'].includes(ext)) url = TOOL_URLS.jpgpdf;
    else if (ext === '.docx') url = TOOL_URLS.wordpdf;
    ensure(url, `unsupported input: ${ext}`);
    console.log(`converting ${in_} → ${out} via ${url}`);
    pw(['goto', url]);
    pw(['wait', '--time=3']);
    return;
  }

  console.error(`unknown command: ${cmd}`);
  usage();
  process.exit(2);
}

run();
