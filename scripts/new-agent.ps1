<#
.SYNOPSIS
    Create a new isolated worktree for an agent on its own branch.

.DESCRIPTION
    Spins up a new git worktree under ..\mcp-control.worktrees\<name>-<task>,
    creates branch agent/<name>/<task> off main, and runs npm install in the
    new checkout so the agent has its own deps.

.PARAMETER Name
    Agent name (e.g. coder, verifier, general, researcher, mavis).

.PARAMETER Task
    Short task slug (e.g. feature-x, bug-42, port-bridge).

.EXAMPLE
    .\scripts\new-agent.ps1 -Name coder -Task feature-totp
    # creates mcp-control.worktrees\coder-feature-totp on branch agent/coder/feature-totp
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Task
)

$ErrorActionPreference = 'Stop'

# Resolve repo root from this script's location
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir '..')
$ParentDir = Split-Path -Parent $RepoRoot.FullName
$WorktreeBase = Join-Path $ParentDir 'mcp-control.worktrees'
$WorktreePath = Join-Path $WorktreeBase ("{0}-{1}" -f $Name, $Task)
$BranchName   = "agent/$Name/$Task"

Write-Host "=== new-agent ==="
Write-Host "  agent       : $Name"
Write-Host "  task        : $Task"
Write-Host "  branch      : $BranchName"
Write-Host "  worktree    : $WorktreePath"
Write-Host ""

# Sanity: are we inside a git repo?
Push-Location $RepoRoot.FullName
try {
    $branch = git rev-parse --abbrev-ref HEAD 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Not a git repo: $RepoRoot. Run 'git init' first."
    }
    if ($branch -ne 'main') {
        Write-Warning "Current branch is '$branch', expected 'main'. Switching to main first..."
        git checkout main | Out-Null
    }

    # Make sure the worktrees base directory exists
    if (-not (Test-Path $WorktreeBase)) {
        New-Item -ItemType Directory -Path $WorktreeBase -Force | Out-Null
    }

    # If a stale worktree exists, fail loud
    if (Test-Path $WorktreePath) {
        throw "Path already exists: $WorktreePath. Remove with: git worktree remove $WorktreePath"
    }

    # If a branch with the same name exists locally, reuse it; otherwise create
    $existing = git branch --list $BranchName
    if ($existing) {
        Write-Host "Reusing existing branch $BranchName"
        git worktree add $WorktreePath $BranchName | Out-Null
    } else {
        Write-Host "Creating branch $BranchName from main"
        git worktree add -b $BranchName $WorktreePath main | Out-Null
    }

    Push-Location $WorktreePath
    try {
        if (Test-Path 'package.json') {
            Write-Host "Running npm install in worktree..."
            npm install --no-audit --no-fund 2>&1 | Select-Object -Last 3
        }
    } finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "Done. To use this agent:" -ForegroundColor Green
    Write-Host "  cd $WorktreePath"
    Write-Host "  node mcp.cjs tabs    # verify the tools work in this checkout"
    Write-Host ""
    Write-Host "When done, merge or remove:"
    Write-Host "  git -C $RepoRoot merge $BranchName"
    Write-Host "  git -C $RepoRoot worktree remove $WorktreePath"
    Write-Host "  git -C $RepoRoot branch -D $BranchName"
} finally {
    Pop-Location
}
