# Multi-agent worktree workflow

Mavis's tools repo is set up so that **multiple agents can work in parallel**
on isolated git worktrees, each on its own branch, without stepping on
each other. This file documents the pattern.

## Why worktrees

- **Isolation.** Each agent has its own working copy, its own branch,
  its own `node_modules` — no merge conflicts mid-task.
- **Parallel work.** While agent A is iterating on the Windows helper,
  agent B can iterate on the browser helper. Both on the same machine.
- **Atomic rollbacks.** A bad idea in `agent-coder-feature`? `git worktree
  remove` and it's gone, the main checkout is untouched.
- **Clean merges.** Each worktree's branch is reviewed/merged on its own
  terms; no `git stash` gymnastics.

## Layout

```
mcp-control\                ← main worktree, branch=main
mcp-control.worktrees\
    coder-feature-x\        ← agent "coder" on branch agent/coder/feature-x
    verifier-bug-42\        ← agent "verifier" on branch agent/verifier/bug-42
    research-bridge\        ← agent "research" on branch agent/research/bridge
```

The `mcp-control.worktrees\` directory is **not** itself a git worktree —
it's just a folder where each subfolder is a separate worktree. Git
manages the registration under the hood.

## Spinning up a new agent

Use the helper script:

```powershell
# from the main checkout
.\scripts\new-agent.ps1 -Name coder -Task "feature-x"
```

This:

1. Creates the folder `mcp-control.worktrees\coder-feature-x\` if missing.
2. Creates a new branch `agent/coder/feature-x` based on `main`.
3. Adds the worktree at that path.
4. Runs `npm install` in the new worktree (so each agent has its own deps).
5. Prints the path and branch so the agent knows where to work.

After that, the agent does its work in `mcp-control.worktrees\coder-feature-x\`
and commits to `agent/coder/feature-x`. When done, the orchestrator reviews
and merges the branch back to `main`.

## Common operations

```powershell
# list worktrees
git worktree list

# remove a worktree (after merging or abandoning)
git worktree remove mcp-control.worktrees\coder-feature-x
git branch -D agent/coder/feature-x

# clean up stale worktree metadata
git worktree prune

# update a worktree with the latest main
cd mcp-control.worktrees\coder-feature-x
git fetch origin
git rebase origin/main    # or: git merge origin/main
```

## Conventions

- **Branch name:** `agent/<agent-name>/<task-slug>`
  - e.g. `agent/coder/feature-x`, `agent/verifier/bug-42`
- **Commit messages:** prefix with the agent + scope, e.g.
  - `coder: add TOTP auth to windows.cjs`
  - `verifier: assert playwright-cli a11y ref format`
- **One task per worktree.** When the task ends, merge or remove the
  worktree. Don't keep stale worktrees around.

## Why not just use a worktree per branch

Because in Mavis's setup, **each agent is a separate Mavis session** that
needs to be invoked from its own checkout (so its tool paths and state
don't collide with other agents). Putting each agent on its own worktree
makes that trivial: the agent just `cd`s into its worktree path and runs
`node mcp.cjs` from there.

## What "all the necessary tools" means in this folder

When you check out this repo on a new machine, you get:

- `node mcp.cjs attach` (Edge via CDP)
- `node mcp.cjs snap` (a11y snapshot, refs)
- `node mcp.cjs click/fill/type/eval/...`
- `node mcp.cjs screen/lswin/focus` (Windows desktop)
- `start-edge-debug.bat` (prereq for browser)
- `start-playwright-mcp.bat` (alternative MCP host)

All driven by the official Microsoft `playwright-cli` over CDP — no
third-party services, no extra installs beyond `npm install`.
