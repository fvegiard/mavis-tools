# Scripts — auto everything (Node.js)

All scripts live in `scripts/` and are written in **Node.js** (`.cjs`)
for cross-shell reliability on Windows. PowerShell quirks with
`$MyInvocation.MyCommand.Path` and `Resolve-Path` returning PathInfo
objects bit us early on; Node.js sidesteps both.

> **Note:** the previous PowerShell versions (`.ps1`) are gone — the
> `.cjs` versions are the canonical ones. PowerShell 7.6 (`pwsh`) is
> still installed on this machine if you ever need it.

| Script | What | When |
|---|---|---|
| `new-agent.cjs` | Create a new worktree + branch + best-effort `npm install` | Once per agent task |
| `multi-agent.cjs` | new-agent + run command in sandbox + commit + push | One-shot, end-to-end |
| `auto.cjs` | File watch + auto-commit + auto-push | Run in background |
| `auto-compact.cjs` | Prune stale worktrees, archive old logs, drop caches | Daily / weekly |
| `auto-resume.cjs` | List active worktrees, show last commit + next step | After reboot / pause |
| `run-sandboxed.cjs` | Run a command in uvx / docker / wsl / none isolation | Per command |

## Quick start

```bash
# 1. Have a coder agent run a Python tool in a uvx sandbox.
node scripts/multi-agent.cjs \
    --name coder \
    --task cowsay-demo \
    --command "uvx --from cowsay cowsay -t 'I am agent coder'" \
    --mode uvx

# 2. See what agents are running
node scripts/auto-resume.cjs

# 3. Open the run log
cat .runs/agent__coder__cowsay-demo.log

# 4. Merge back to main
git fetch origin
git merge --no-ff origin/agent/coder/cowsay-demo
git worktree remove ../mcp-control.worktrees/coder-cowsay-demo
git branch -D agent/coder/cowsay-demo
```

## Sandbox modes

| Mode | When to use | Overhead |
|---|---|---|
| `uvx` | Quick Python tools, isolated deps, no host side-effects | ~50ms / 50MB cache |
| `docker` | Untrusted code, full OS isolation, network sandboxing | ~500ms / 200MB+ image |
| `wsl` | Linux-only tools, native speed, share files with host | ~50ms / no extra |
| `none` | No isolation, just a thin wrapper for consistency | 0 |

## Auto-anything loops

```bash
# Watch current repo, auto-commit + push every 10s
node scripts/auto.cjs

# Watch with a 5s interval
node scripts/auto.cjs --interval 5

# Commit only, no push (e.g. while on a flight)
node scripts/auto.cjs --no-push

# Watch a different repo
node scripts/auto.cjs --path ../some-other-repo

# Run as a Windows scheduled task
schtasks /create /sc minute /mo 30 /tn "Mavis-auto-compact" \
    /tr "node C:\Users\fvegi\.mavis\workspace\mcp-control\scripts\auto-compact.cjs"
```

## Conventions

- **Branch names:** `agent/<name>/<task-slug>`
- **Commit prefixes:** `agent/<name>/<task>: <what>`
- **Log location:** `.runs/<branch-with-slashes-as-double-underscore>.log`
- **Worktree path:** `../mcp-control.worktrees/<name>-<task>`

## Why uvx (and not just pip / venv)

`uvx` is `uv`'s tool-runner. Each invocation:

- Spins up an ephemeral venv in a content-addressed cache (so a second
  call with the same tool is instant).
- Installs only the deps the tool needs.
- Cleans up after itself.

Result: sub-agents can `uvx cowsay` or `uvx ruff` or `uvx mypy` without
ever polluting the host's Python, and without carrying venv baggage in
their worktree. Same shape as `npx` for Node.

## Why Docker / WSL sandboxes

The Windows host has 20+ years of accumulated state — registry, config,
shell extensions, etc. Running a sub-agent in a fresh container or WSL
distro gives it a clean slate to install whatever it needs without
risking breakage of the user's actual environment. The trade-off is
startup time; for short-lived commands `uvx` is usually enough.

## Tested

End-to-end demo, captured in the run log:

```
$ node scripts/multi-agent.cjs --name coder --task demo2 \
      --command "uvx --from cowsay cowsay -t hello" --mode uvx
=== multi-agent ===
  agent     : coder
  task      : demo2
  branch    : agent/coder/demo2
  worktree  : C:\Users\fvegi\.mavis\workspace\mcp-control.worktrees\coder-demo2
  mode      : uvx
  log       : C:\Users\fvegi\.mavis\workspace\mcp-control\.runs\agent__coder__demo2.log

[1/4] Creating worktree...
[new-agent] creating branch agent/coder/demo2 from main
[new-agent] running npm install in worktree...
added 5 packages in 497ms
[new-agent]   npm install OK

[2/4] Running command in uvx sandbox...
[run-sandboxed:uvx] uvx --from cowsay cowsay -t hello
  _____
| hello |
  =====
     \
      \
        ^__^
        (oo)\_______
        (__)\       )\/

[3/4] Commit + push...
[4/4] Keeping worktree at ...\coder-demo2
Done.
  log    : ...\.runs\agent__coder__demo2.log
  branch : agent/coder/demo2
```

A real cow, a real sandbox, a real branch, all from one `node` call.
