#!/usr/bin/env node
/**
 * windows.cjs — Windows desktop control MCP for Mavis
 *
 * Uses PowerShell (System.Windows.Forms + System.Drawing + UIAutomation)
 * to drive the local desktop. All commands run via powershell.exe.
 *
 * Subcommands:
 *   screenshot <outPath>             Capture full screen to PNG
 *   click <x> <y>                    Left-click at coords
 *   dblclick <x> <y>                 Double-click at coords
 *   rightclick <x> <y>               Right-click at coords
 *   move <x> <y>                     Move mouse (no click)
 *   scroll <amount>                  Scroll wheel (+ up, - down)
 *   type <text>                      Type unicode text (clipboard paste)
 *   key <name>                       Press a key (Enter, Tab, Escape, F1..F12, etc.)
 *   chord <keys>                     Key chord e.g. "ctrl+c", "alt+F4"
 *   windows                          List visible top-level windows
 *   find <titleSubstr>               Find first window whose title contains
 *   activate <titleSubstr>           Bring window matching to front
 *   clipboard get                    Read clipboard text
 *   clipboard set <text>             Write clipboard text
 *   run <command>                    Run a shell command, capture stdout
 *   ps <script>                      Run arbitrary PowerShell, print stdout
 *   size                             Get primary screen size
 *
 * Coordinates: pixel coords on the primary screen (top-left = 0,0).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function usage() {
  console.log(`windows.cjs — Windows desktop control for Mavis

Usage:
  node windows.cjs screenshot <outPath>
  node windows.cjs click <x> <y>
  node windows.cjs dblclick <x> <y>
  node windows.cjs rightclick <x> <y>
  node windows.cjs move <x> <y>
  node windows.cjs scroll <amount>
  node windows.cjs type "<text>"
  node windows.cjs key <Enter|Tab|Escape|F1..F12|...>
  node windows.cjs chord "<ctrl+c|alt+F4>"
  node windows.cjs windows
  node windows.cjs find "<titleSubstr>"
  node windows.cjs activate "<titleSubstr>"
  node windows.cjs clipboard get
  node windows.cjs clipboard set "<text>"
  node windows.cjs run <shellCommand>
  node windows.cjs ps "<powershell>"
  node windows.cjs size
`);
}

function runPS(script) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', script,
    ], { windowsHide: true });

    let out = '', err = '';
    ps.stdout.on('data', (d) => (out += d.toString('utf8')));
    ps.stderr.on('data', (d) => (err += d.toString('utf8')));
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code !== 0) return reject(new Error(`powershell exit ${code}: ${err.trim()}`));
      resolve(out);
    });
  });
}

// Shared preamble: load WinForms + Drawing once.
const PREAMBLE = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$ErrorActionPreference = 'Stop'
`;

const READ_JSON = `$JsonParams = [Console]::In.ReadLine() | ConvertFrom-Json`;

const SCRIPT_SCREENSHOT = `
${READ_JSON}
${PREAMBLE}
$OutPath = $JsonParams[0]
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
@{ ok = $true; path = $OutPath; width = $bounds.Width; height = $bounds.Height } | ConvertTo-Json -Compress
`;

const SCRIPT_CLICK = `
${READ_JSON}
${PREAMBLE}
$X = [int]$JsonParams[0]
$Y = [int]$JsonParams[1]
$Button = if ($JsonParams.Count -gt 2) { $JsonParams[2] } else { 'Left' }
$Clicks = if ($JsonParams.Count -gt 3) { [int]$JsonParams[3] } else { 1 }
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($X, $Y)
Start-Sleep -Milliseconds 30
if ($Button -eq 'Right') {
  [System.Windows.Forms.Mouse]::MouseRightButton($null, [System.Windows.Forms.MouseButtons]::Right, 0,0,0)
} else {
  for ($i=0; $i -lt $Clicks; $i++) {
    [System.Windows.Forms.Mouse]::MouseLeftButton($null, [System.Windows.Forms.MouseButtons]::Left, 0,0,0)
    Start-Sleep -Milliseconds 20
  }
}
@{ ok = $true; x = $X; y = $Y; button = $Button; clicks = $Clicks } | ConvertTo-Json -Compress
`;

const SCRIPT_MOVE = `
${READ_JSON}
${PREAMBLE}
$X = [int]$JsonParams[0]
$Y = [int]$JsonParams[1]
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($X, $Y)
@{ ok = $true; x = $X; y = $Y } | ConvertTo-Json -Compress
`;

const SCRIPT_SCROLL = `
${READ_JSON}
${PREAMBLE}
$Amount = [int]$JsonParams[0]
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);
}
"@
$flags = 0x0800  # MOUSEEVENTF_WHEEL
[M]::mouse_event($flags, 0, 0, [uint32]($Amount * 120), 0)
@{ ok = $true; amount = $Amount } | ConvertTo-Json -Compress
`;

const SCRIPT_TYPE = `
${READ_JSON}
${PREAMBLE}
$Text = $JsonParams[0]
Set-Clipboard -Value $Text
Start-Sleep -Milliseconds 40
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 60
@{ ok = $true; length = $Text.Length } | ConvertTo-Json -Compress
`;

const SCRIPT_KEY = `
${READ_JSON}
${PREAMBLE}
$Name = $JsonParams[0]
[System.Windows.Forms.SendKeys]::SendWait($Name)
@{ ok = $true; key = $Name } | ConvertTo-Json -Compress
`;

const SCRIPT_CHORD = `
${READ_JSON}
${PREAMBLE}
$Chord = $JsonParams[0]
[System.Windows.Forms.SendKeys]::SendWait($Chord)
@{ ok = $true; chord = $Chord } | ConvertTo-Json -Compress
`;

const SCRIPT_WINDOWS = `
${READ_JSON}
${PREAMBLE}
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object Id, ProcessName, MainWindowTitle |
  ForEach-Object {
    [PSCustomObject]@{
      pid = $_.Id
      process = $_.ProcessName
      title = $_.MainWindowTitle
      handle = $_.MainWindowHandle
    }
  } | ConvertTo-Json -Compress
`;

const SCRIPT_SIZE = `
${READ_JSON}
${PREAMBLE}
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
@{ width = $b.Width; height = $b.Height; x = $b.X; y = $b.Y } | ConvertTo-Json -Compress
`;

const SCRIPT_ACTIVATE = `
${READ_JSON}
${PREAMBLE}
$TitleSubstr = $JsonParams[0]
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*$TitleSubstr*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { @{ ok = $false; error = "no window matching: $TitleSubstr" } | ConvertTo-Json -Compress; exit 2 }
if ([W]::IsIconic($proc.MainWindowHandle)) { [W]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null }
[W]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 80
@{ ok = $true; pid = $proc.Id; title = $proc.MainWindowTitle } | ConvertTo-Json -Compress
`;

const SCRIPT_FIND = `
${READ_JSON}
${PREAMBLE}
$TitleSubstr = $JsonParams[0]
$matches = Get-Process | Where-Object { $_.MainWindowTitle -like "*$TitleSubstr*" -and $_.MainWindowHandle -ne 0 } |
  Select-Object Id, ProcessName, MainWindowTitle |
  ForEach-Object {
    [PSCustomObject]@{ pid = $_.Id; process = $_.ProcessName; title = $_.MainWindowTitle }
  }
if (-not $matches) { @{ ok = $false; error = "no window matching: $TitleSubstr" } | ConvertTo-Json -Compress; exit 2 }
$matches | ConvertTo-Json -Compress
`;

async function ps(script, params = []) {
  // Write the script to a tempfile, run it, and pass params as JSON via stdin.
  const tmp = path.join(require('os').tmpdir(), `mcp-ps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);
  fs.writeFileSync(tmp, script, 'utf8');
  try {
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', tmp,
    ], { windowsHide: true });

    // Pass params as JSON via stdin (newline-terminated so ReadLine unblocks).
    proc.stdin.write(JSON.stringify(params) + '\n');
    proc.stdin.end();

    return await new Promise((resolve, reject) => {
      let out = '', err = '';
      proc.stdout.on('data', (d) => (out += d.toString('utf8')));
      proc.stderr.on('data', (d) => (err += d.toString('utf8')));
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error(`powershell exit ${code}: ${err.trim() || out.trim()}`));
        resolve(out.trim());
      });
    });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function ok(text) {
  try { return JSON.parse(text); } catch { return { ok: true, raw: text }; }
}

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    let out, raw;
    switch (cmd) {
      case 'screenshot':
        if (!args[0]) throw new Error('screenshot needs <outPath>');
        fs.mkdirSync(path.dirname(path.resolve(args[0])), { recursive: true });
        raw = await ps(SCRIPT_SCREENSHOT, [args[0]]);
        out = ok(raw);
        break;
      case 'click':
        if (!args[0] || !args[1]) throw new Error('click needs <x> <y>');
        raw = await ps(SCRIPT_CLICK, [parseInt(args[0], 10), parseInt(args[1], 10)]);
        out = ok(raw);
        break;
      case 'dblclick':
        if (!args[0] || !args[1]) throw new Error('dblclick needs <x> <y>');
        raw = await ps(SCRIPT_CLICK, [parseInt(args[0], 10), parseInt(args[1], 10), 'Left', 2]);
        out = ok(raw);
        break;
      case 'rightclick':
        if (!args[0] || !args[1]) throw new Error('rightclick needs <x> <y>');
        raw = await ps(SCRIPT_CLICK, [parseInt(args[0], 10), parseInt(args[1], 10), 'Right', 1]);
        out = ok(raw);
        break;
      case 'move':
        if (!args[0] || !args[1]) throw new Error('move needs <x> <y>');
        raw = await ps(SCRIPT_MOVE, [parseInt(args[0], 10), parseInt(args[1], 10)]);
        out = ok(raw);
        break;
      case 'scroll':
        if (!args[0]) throw new Error('scroll needs <amount>');
        raw = await ps(SCRIPT_SCROLL, [parseInt(args[0], 10)]);
        out = ok(raw);
        break;
      case 'type':
        if (args[0] === undefined) throw new Error('type needs <text>');
        raw = await ps(SCRIPT_TYPE, [args.join(' ')]);
        out = ok(raw);
        break;
      case 'key':
        if (!args[0]) throw new Error('key needs <name>');
        raw = await ps(SCRIPT_KEY, [args[0]]);
        out = ok(raw);
        break;
      case 'chord':
        if (!args[0]) throw new Error('chord needs <keys>');
        raw = await ps(SCRIPT_CHORD, [args[0]]);
        out = ok(raw);
        break;
      case 'windows':
        raw = await ps(SCRIPT_WINDOWS);
        out = ok(raw);
        break;
      case 'size':
        raw = await ps(SCRIPT_SIZE);
        out = ok(raw);
        break;
      case 'activate':
        if (!args[0]) throw new Error('activate needs <titleSubstr>');
        raw = await ps(SCRIPT_ACTIVATE, [args[0]]);
        out = ok(raw);
        break;
      case 'find':
        if (!args[0]) throw new Error('find needs <titleSubstr>');
        raw = await ps(SCRIPT_FIND, [args[0]]);
        out = ok(raw);
        break;
      case 'clipboard':
        if (args[0] === 'get') {
          raw = await ps(`${PREAMBLE} (Get-Clipboard) | ConvertTo-Json -Compress`);
          out = { ok: true, text: raw.replace(/^"|"$/g, '') };
        } else if (args[0] === 'set') {
          if (args[1] === undefined) throw new Error('clipboard set needs <text>');
          raw = await ps(`${PREAMBLE} Set-Clipboard -Value $args[0]; @{ ok = $true; length = $args[0].Length } | ConvertTo-Json -Compress`,
            [args.slice(1).join(' ')]);
          out = ok(raw);
        } else {
          throw new Error('clipboard subcommand: get | set');
        }
        break;
      case 'run':
        if (!args[0]) throw new Error('run needs <command>');
        raw = await new Promise((resolve, reject) => {
          const p = spawn(args.join(' '), { shell: true, windowsHide: true });
          let o = '', e = '';
          p.stdout.on('data', (d) => (o += d.toString('utf8')));
          p.stderr.on('data', (d) => (e += d.toString('utf8')));
          p.on('error', reject);
          p.on('close', (code) => resolve(JSON.stringify({ ok: code === 0, code, stdout: o, stderr: e })));
        });
        out = JSON.parse(raw);
        break;
      case 'ps':
        if (!args[0]) throw new Error('ps needs <script>');
        raw = await new Promise((resolve, reject) => {
          const p = spawn('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', args.join(' '),
          ], { windowsHide: true });
          let o = '', e = '';
          p.stdout.on('data', (d) => (o += d.toString('utf8')));
          p.stderr.on('data', (d) => (e += d.toString('utf8')));
          p.on('error', reject);
          p.on('close', (code) => resolve(JSON.stringify({ ok: code === 0, code, stdout: o, stderr: e })));
        });
        out = JSON.parse(raw);
        break;
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        usage();
        process.exit(0);
      default:
        throw new Error(`Unknown command: ${cmd}. Try 'help'.`);
    }
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e.message }, null, 2));
    process.exit(1);
  }
})();
