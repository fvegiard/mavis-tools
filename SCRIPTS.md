# Scripts — auto everything

All scripts live in `scripts/` and are designed to be safe to run on a
schedule (idempotent where possible) and chainable with each other.

| Script | What | When |
|---|---|---|
| `new-agent.ps1` | Create a new worktree + branch + install deps | Once per agent task |
| `multi-agent.ps1` | new-agent + run command in sandbox + commit + push | One-shot, end-to-end |
| `auto.ps1` | File watch + auto-commit + auto-push | Run in background |
| `auto-compact.ps1` | Prune stale worktrees, archive old logs, drop caches | Daily / weekly |
| `auto-resume.ps1` | List active worktrees, show last commit + next step | After reboot / pause |
| `run-sandboxed.ps1` | Run a command in uvx / docker / wsl isolation | Per command |

## Worktree + sandbox + uvx multi-agent pattern

```powershell
# 1. Have a coder agent run a Python tool in a uvx sandbox,
#    capture the log, commit the result, push the branch.
.\scripts\multi-agent.ps1 `
    -Name coder `
    -Task cowsay-demo `
    -Command 'cowsay -t "I am agent coder, in a uvx sandbox"' `
    -Mode uvx

# 2. See what the agent did (branch, log, worktree path)
.\scripts\auto-resume.ps1

# 3. Open the log
notepad .runs\agent_coder_cowsay-demo.log

# 4. Merge back to main
git fetch origin
git merge --no-ff origin/agent/coder/cowsay-demo
git worktree remove ..\mcp-control.worktrees\coder-cowsay-demo
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

```powershell
# Watch current repo, auto-commit + push every 10s
.\scripts\auto.ps1

# Watch with a 5s interval
.\scripts\auto.ps1 -IntervalSeconds 5

# Commit only, no push (e.g. while on a flight)
.\scripts\auto.ps1 -NoPush

# Run as a Windows scheduled task
schtasks /create /sc minute /mo 30 /tn "Mavis-auto-compact" `
    /tr "powershell -NoProfile -File C:\Users\fvegi\.mavis\workspace\mcp-control\scripts\auto-compact.ps1"
```

## Conventions

- **Branch names:** `agent/<name>/<task-slug>`
- **Commit prefixes:** `agent/<name>/<task>: <what>`
- **Log location:** `.runs/<branch-with-slashes-as-double-underscore>.log`
- **Worktree path:** `..\mcp-control.worktrees\<name>-<task>`

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
