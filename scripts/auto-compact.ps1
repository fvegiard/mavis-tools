<#
.SYNOPSIS
    Auto-compact / cleanup: prune stale worktrees, drop transient artifacts,
    archive old logs.

.DESCRIPTION
    Idempotent cleanup pass:
      - Remove empty .playwright-cli/ caches older than 7 days.
      - Archive .log files older than 14 days into .archive/logs/.
      - Prune git worktree metadata for paths that no longer exist.
      - List merged-into-main branches (informational, never auto-delete).
      - Show disk usage by worktree.

    Safe to run on a schedule (e.g. via cron or schtasks).

.EXAMPLE
    .\scripts\auto-compact.ps1
#>
[CmdletBinding()]
param(
    [string]$Path = (Get-Location).Path,
    [int]$LogDays = 14,
    [int]$CacheDays = 7
)

$ErrorActionPreference = 'Continue'
$RepoRoot = Resolve-Path $Path
Write-Host "=== auto-compact ==="
Write-Host "  path        : $RepoRoot"
Write-Host "  log days    : $LogDays"
Write-Host "  cache days  : $CacheDays"
Write-Host ""

Push-Location $RepoRoot
try {
    # 1. Prune git worktree metadata for missing dirs
    Write-Host "[1/4] Pruning stale worktree metadata..."
    git worktree prune 2>&1 | Out-Null
    git worktree list 2>&1 | ForEach-Object { Write-Host "  $_" }

    # 2. Archive old logs
    Write-Host ""
    Write-Host "[2/4] Archiving logs older than $LogDays days..."
    $archive = Join-Path $RepoRoot '.archive/logs'
    if (-not (Test-Path $archive)) { New-Item -ItemType Directory -Path $archive -Force | Out-Null }
    $cutoff = (Get-Date).AddDays(-$LogDays)
    Get-ChildItem $RepoRoot -Recurse -File -Filter '*.log' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt $cutoff -and $_.FullName -notlike '*.archive*' } |
        ForEach-Object {
            $rel = $_.FullName.Substring($RepoRoot.Path.Length)
            $dest = Join-Path $archive ($rel -replace '[\\/]', '__')
            Move-Item $_.FullName $dest -Force
            Write-Host "  archived: $rel"
        }

    # 3. Drop empty .playwright-cli/ caches older than $CacheDays
    Write-Host ""
    Write-Host "[3/4] Dropping stale .playwright-cli/ caches older than $CacheDays days..."
    $pcCache = Join-Path $RepoRoot '.playwright-cli'
    if (Test-Path $pcCache) {
        Get-ChildItem $pcCache -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$CacheDays) } |
            ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
        Write-Host "  cleaned"
    } else {
        Write-Host "  no cache to clean"
    }

    # 4. List merged branches
    Write-Host ""
    Write-Host "[4/4] Branches merged into main (informational)..."
    git branch --merged main 2>&1 | Where-Object { $_ -notmatch '^\*' -and $_ -notmatch 'main' } | ForEach-Object {
        Write-Host "  merged: $_"
    }

    # 5. Disk usage by worktree
    Write-Host ""
    Write-Host "[5/5] Worktree disk usage..."
    $parent = Split-Path -Parent $RepoRoot.Path
    $wtBase = Join-Path $parent 'mcp-control.worktrees'
    if (Test-Path $wtBase) {
        Get-ChildItem $wtBase -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $size = (Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue |
                Measure-Object -Property Length -Sum).Sum
            Write-Host ("  {0,-40} {1,8:N1} MB" -f $_.Name, ($size / 1MB))
        }
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
