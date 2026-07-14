# Mavis Tools — browser + Windows automation for Mavis

A self-contained toolkit for Mavis (MiniMax / MiniMax) to drive the
local Windows machine and the user's running browser. No third-party
services, no extra installs beyond Node 18+.

## What's in here

| File | What |
|---|---|
| `mcp.cjs` | unified dispatcher with shortcuts for the common operations |
| `pwcli.cjs` | thin wrapper around the official Microsoft `playwright-cli` |
| `windows.cjs` | Windows desktop helper (PowerShell + .NET) |
| `mcp-servers.json` | MCP server config for any MCP host (alternative to CLI) |
| `start-edge-debug.bat` | launch Edge with `--remote-debugging-port=9223` |
| `start-playwright-mcp.bat` | launch the official `@playwright/mcp` server |
| `SKILL.md` | full reference for every command and subcommand |
| `package.json` | pinned to `playwright` ^1.x and `@playwright/mcp` ^0.0.78 |

## Quick start

```powershell
# 1. Edge in debug mode (port 9223, profile MavisDebug)
.\start-edge-debug.bat

# 2. One-time attach
node mcp.cjs attach

# 3. Drive the browser
node mcp.cjs tabs                            # list open tabs
node mcp.cjs snap                            # a11y snapshot with refs
node mcp.cjs click e15                       # click by ref
node mcp.cjs fill e5 "hello@exemple.com"     # fill an input
node mcp.cjs eval "document.title"           # run JS
node mcp.cjs goto https://minimax.io         # navigate

# Windows desktop
node mcp.cjs screen out.png                  # desktop screenshot
node mcp.cjs lswin                           # list visible windows
node mcp.cjs focus "Claude"                  # activate a window
```

## Why playwright-cli (a11y) and not CSS selectors

- **No screenshot flash.** Every interaction is text-based.
- **Deterministic.** Refs (`e15`) are stable for the duration of a snapshot.
- **Token-efficient.** A snapshot is ~1-5 KB of YAML vs 1-2 MB for a screenshot.
- **No vision model needed.** Pure structured data.
- **Recommended by Microsoft for coding agents** — see
  [`microsoft/playwright-mcp`](https://github.com/microsoft/playwright-mcp).

## Requirements

- Windows 10/11
- Node.js 18+ (tested on 24)
- Microsoft Edge (any recent channel) — already installed by default on Windows

## Installation

```powershell
git clone <repo-url> mavis-tools
cd mavis-tools
npm install
```

## Worktree workflow (multi-agent)

The repo is set up to be used with multiple parallel agents, each on its
own git worktree. See `WORKTREES.md` for the full pattern.

## License

Internal — Mavis tooling.
