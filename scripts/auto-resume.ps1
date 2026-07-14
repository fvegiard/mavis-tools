<#
.SYNOPSIS
    Auto-resume: list unfinished agent worktrees, show their last commit,
    last touched file, and the exact command to jump back in.

.DESCRIPTION
    Reads git status of every worktree under ..\mcp-control.worktrees and
    prints a one-liner per active worktree showing:
      - branch
      - last commit (subject, age)
      - dirty?  (uncommitted changes)
      - ahead/behind main
      - suggested next command

    Designed to be run after a reboot, after a long pause, or as a
    "what was I doing" check.

.EXAMPLE
    .\scripts\auto-resume.ps1
    .\scripts\auto-resume.ps1 -Path ..\mcp-control.worktrees\coder-feature-x
#>
[CmdletBinding()]
param(
    [string]$WorktreesRoot
)

$ErrorActionPreference = 'Continue'
$here = (Get-Location).Path
if (-not $WorktreesRoot) {
    $repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
    $parent = Split-Path -Parent $repoRoot.Path
    $WorktreesRoot = Join-Path $parent 'mcp-control.worktrees'
}

if (-not (Test-Path $WorktreesRoot)) {
    Write-Host "No worktrees directory at $WorktreesRoot"
    exit 0
}

Write-Host "=== auto-resume ==="
Write-Host "  worktrees   : $WorktreesRoot"
Write-Host ""

Get-ChildItem $WorktreesRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $wt = $_.FullName
    Push-Location $wt
    try {
        if (-not (Test-Path '.git')) { return }
        $branch = (git rev-parse --abbrev-ref HEAD 2>$null).Trim()
        if (-not $branch) { return }
        $subject = (git log -1 --pretty=%s 2>$null).Trim()
        $age = (git log -1 --pretty=%cr 2>$null).Trim()
        $dirty = (git status --porcelain 2>$null | Measure-Object).Count
        $ahead  = [int](git rev-list --count origin/main..HEAD 2>$null)
        $behind = [int](git rev-list --count HEAD..origin/main 2>$null)

        Write-Host "[$branch]" -ForegroundColor Cyan
        Write-Host "  path        : $wt"
        Write-Host "  last commit : $subject ($age)"
        if ($dirty -gt 0) {
            Write-Host "  dirty       : $dirty uncommitted file(s)" -ForegroundColor Yellow
        }
        if ($ahead  -gt 0) { Write-Host "  ahead main  : $ahead commit(s)" }
        if ($behind -gt 0) { Write-Host "  behind main : $behind commit(s)" }
        Write-Host "  resume with : cd '$wt'"
        Write-Host ""
    } finally {
        Pop-Location
    }
}

Write-Host "Tip: run '.\scripts\auto-resume.ps1' anytime to see this list." -ForegroundColor DarkGray
