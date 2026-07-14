<#
.SYNOPSIS
    Run a command in an isolated sandbox.

.DESCRIPTION
    Three sandbox modes:
      - docker  : run inside `mcr.microsoft.com/playwright/mcp` (or any image)
      - wsl     : run inside the WSL default distro
      - none    : run as-is (no isolation, just a wrapper for uvx)

    Useful for letting a sub-agent install Python deps, run network calls,
    or do anything that should not touch the host.

.PARAMETER Command
    The command to run. For uvx mode this is a uvx invocation (e.g.
    'cowsay -t "hi"'). For docker/wsl it's a shell command.

.PARAMETER Mode
    docker | wsl | uvx | none. Default uvx.

.PARAMETER Image
    Docker image to use when Mode=docker. Default 'python:3.13-slim'.

.PARAMETER Cwd
    Mount this path inside the sandbox (read-write). Default current dir.

.EXAMPLE
    .\scripts\run-sandboxed.ps1 -Mode uvx -Command 'cowsay -t "hello"'
    .\scripts\run-sandboxed.ps1 -Mode docker -Command 'python -c "print(1+1)"'
    .\scripts\run-sandboxed.ps1 -Mode wsl -Command 'uname -a'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Command,
    [ValidateSet('docker', 'wsl', 'uvx', 'none')][string]$Mode = 'uvx',
    [string]$Image = 'python:3.13-slim',
    [string]$Cwd = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

switch ($Mode) {
    'uvx' {
        Write-Host "[uvx sandbox] $Command" -ForegroundColor Cyan
        uvx $Command
    }
    'none' {
        Write-Host "[no sandbox] $Command" -ForegroundColor Yellow
        Invoke-Expression $Command
    }
    'docker' {
        Write-Host "[docker sandbox] $Image  $Command" -ForegroundColor Cyan
        $abs = (Resolve-Path $Cwd).Path
        docker run --rm -i -v "${abs}:/work" -w /work $Image sh -c $Command
    }
    'wsl' {
        Write-Host "[wsl sandbox] $Command" -ForegroundColor Cyan
        $abs = (Resolve-Path $Cwd).Path
        # Convert Windows path to WSL path
        $wslPath = (wsl wslpath -u $abs).Trim()
        wsl -- bash -c "cd '$wslPath' && $Command"
    }
}
