<#
.SYNOPSIS
    Run a task on a fresh isolated worktree agent (worktree + sandbox + uvx).

.DESCRIPTION
    One-shot "spin up an agent, run a command, capture the result" flow:

      1. Create a new worktree on a fresh branch (via new-agent.ps1).
      2. Inside the worktree, run the command in a sandbox (uvx / docker / wsl).
      3. Capture stdout/stderr to .runs/<branch>.log.
      4. Commit + push the worktree state back to origin.
      5. Print the run summary.

    Perfect for: "have agent coder run this Python script in a clean env, then
    commit the result so I can review it on GitHub later."

.PARAMETER Name
    Agent name (e.g. coder, verifier, researcher). Becomes branch prefix.

.PARAMETER Task
    Short task slug.

.PARAMETER Command
    The command to run inside the worktree sandbox.

.PARAMETER Mode
    Sandbox mode: uvx | docker | wsl | none. Default uvx.

.PARAMETER KeepWorktree
    Don't remove the worktree after the run (default: keep; pass -Remove
    to clean up).

.PARAMETER Push
    Push the branch to origin after the run. Default true.

.EXAMPLE
    # Have a coder-agent run cowsay in a uvx sandbox on a fresh worktree.
    .\scripts\multi-agent.ps1 -Name coder -Task cowsay-demo `
        -Command 'cowsay -t "I am agent coder"'

    # Same, but in a Docker sandbox, and don't keep the worktree.
    .\scripts\multi-agent.ps1 -Name researcher -Task sanity-check `
        -Command 'python -c "import sys; print(sys.version)"' `
        -Mode docker -Remove
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Task,
    [Parameter(Mandatory)][string]$Command,
    [ValidateSet('uvx', 'docker', 'wsl', 'none')][string]$Mode = 'uvx',
    [switch]$Remove,
    [bool]$Push = $true
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir '..')
$Parent    = Split-Path -Parent $RepoRoot.Path
$WTBase    = Join-Path $Parent 'mcp-control.worktrees'
$WTPath    = Join-Path $WTBase ("{0}-{1}" -f $Name, $Task)
$Branch    = "agent/$Name/$Task"
$RunsDir   = Join-Path $RepoRoot '.runs'
$LogFile   = Join-Path $RunsDir ("{0}.log" -f ($Branch -replace '/', '__'))

if (-not (Test-Path $RunsDir)) { New-Item -ItemType Directory -Path $RunsDir -Force | Out-Null }

Write-Host "=== multi-agent ===" -ForegroundColor Cyan
Write-Host "  agent       : $Name"
Write-Host "  task        : $Task"
Write-Host "  branch      : $Branch"
Write-Host "  worktree    : $WTPath"
Write-Host "  mode        : $Mode"
Write-Host "  log         : $LogFile"
Write-Host ""

# 1. Create worktree
Write-Host "[1/4] Creating worktree..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir 'new-agent.ps1') -Name $Name -Task $Task

# 2. Run the command in the sandbox
Write-Host ""
Write-Host "[2/4] Running command in $Mode sandbox..."
Push-Location $WTPath
try {
    $header = "# run at $(Get-Date -Format 'o')`n# branch: $Branch`n# mode:   $Mode`n# cmd:    $Command`n"
    $header | Out-File $LogFile -Encoding utf8

    $sb = {
        param($cmd, $mode, $image, $cwd, $log)
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $using:ScriptDir 'run-sandboxed.ps1') `
            -Command $cmd -Mode $mode -Image $image -Cwd $cwd *>&1 | Tee-Object -FilePath $log -Append
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir 'run-sandboxed.ps1') `
        -Command $Command -Mode $Mode -Cwd $WTPath *>&1 | Tee-Object -FilePath $LogFile -Append

    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

# 3. Commit + push
Write-Host ""
Write-Host "[3/4] Commit + push..."
Push-Location $WTPath
try {
    git add -A
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    git commit -m "agent/$Name/$Task: $Command`n`nRan in $Mode sandbox. Log: $LogFile" 2>&1 | Out-Null
    if ($Push) {
        git push -u origin $Branch 2>&1
    }
} finally {
    Pop-Location
}

# 4. Optionally remove worktree
Write-Host ""
if ($Remove) {
    Write-Host "[4/4] Removing worktree..."
    & git -C $RepoRoot worktree remove --force $WTPath
} else {
    Write-Host "[4/4] Keeping worktree at $WTPath" -ForegroundColor Yellow
    Write-Host "        resume: cd '$WTPath'"
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  log    : $LogFile"
Write-Host "  branch : $Branch"
if ($Push) { Write-Host "  remote : pushed to origin/$Branch" }
