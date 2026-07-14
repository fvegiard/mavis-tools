<#
.SYNOPSIS
    Auto-commit and auto-push on file changes.

.DESCRIPTION
    Watches the current repo (or specified worktree) for file changes, and
    every N seconds: stages everything, commits with an auto message
    (timestamp + file list), and pushes to origin.

    Use as a background process. Stop with Ctrl+C or by killing the process.

.PARAMETER Path
    Repo or worktree to watch. Defaults to current directory.

.PARAMETER IntervalSeconds
    How often to scan for changes. Default 10.

.PARAMETER Message
    Commit message prefix. Default 'auto'.

.PARAMETER NoPush
    Skip the push step (commit only).

.EXAMPLE
    .\scripts\auto.ps1                    # watch cwd, commit+push every 10s
    .\scripts\auto.ps1 -IntervalSeconds 5 # faster
    .\scripts\auto.ps1 -NoPush            # local-only auto-commit
#>
[CmdletBinding()]
param(
    [string]$Path = (Get-Location).Path,
    [int]$IntervalSeconds = 10,
    [string]$Message = 'auto',
    [switch]$NoPush
)

$ErrorActionPreference = 'Stop'
Push-Location $Path
try {
    if (-not (Test-Path '.git')) {
        throw "Not a git repo: $Path"
    }
    Write-Host "=== auto ==="
    Write-Host "  path        : $Path"
    Write-Host "  interval    : ${IntervalSeconds}s"
    Write-Host "  push        : $(-not $NoPush)"
    Write-Host "  Ctrl+C to stop"
    Write-Host ""

    while ($true) {
        $status = git status --porcelain 2>$null
        if ($status) {
            $files = ($status | Measure-Object).Count
            $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
            $msg = "$Message($ts): $files file(s) changed"
            git add -A | Out-Null
            git commit -m $msg | Out-Null
            if (-not $NoPush) {
                $pushOut = git push 2>&1
                if ($LASTEXITCODE -ne 0) {
                    Write-Warning "Push failed: $pushOut"
                } else {
                    Write-Host "[$ts] committed $files file(s), pushed" -ForegroundColor Green
                }
            } else {
                Write-Host "[$ts] committed $files file(s) (no push)" -ForegroundColor Green
            }
        }
        Start-Sleep -Seconds $IntervalSeconds
    }
} finally {
    Pop-Location
}
