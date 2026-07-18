<#
.SYNOPSIS
  Deploy PHP site to remote server via SSH.
.DESCRIPTION
  Reads config from .env, packs project source via tar and syncs
  to remote server over SSH. Excludes dev files (.git, IDE files, deploy script).
.PARAMETER DryRun
  Show commands without executing.
.EXAMPLE
  .\deploy.ps1
  .\deploy.ps1 -DryRun
#>

param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ─── 1. Load .env ───
$envFile = Join-Path $PSScriptRoot '.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+?)\s*=\s*(.+?)\s*$') {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2])
    }
  }
}

$sshHost    = [Environment]::GetEnvironmentVariable('DEPLOY_SSH_HOST')
$sshPort    = [Environment]::GetEnvironmentVariable('DEPLOY_SSH_PORT')
if (-not $sshPort) { $sshPort = '22' }
$sshUser    = [Environment]::GetEnvironmentVariable('DEPLOY_SSH_USER')
$remotePath = [Environment]::GetEnvironmentVariable('DEPLOY_REMOTE_PATH')
if ($remotePath) { $remotePath = $remotePath.TrimEnd('/') }

if (-not $sshHost -or -not $sshUser -or -not $remotePath) {
  Write-Host "ERROR: Set DEPLOY_SSH_HOST, DEPLOY_SSH_USER and DEPLOY_REMOTE_PATH in .env" -ForegroundColor Red
  exit 1
}

$identityFile = [Environment]::GetEnvironmentVariable('DEPLOY_SSH_KEY')
$identityArg  = if ($identityFile) { "-i `"$identityFile`"" } else { '' }

$remote  = "${sshUser}@${sshHost}"
$portArg = if ($sshPort -ne '22') { "-P $sshPort" } else { '' }

# ─── Fix SSH key permissions (Windows OpenSSH requires restrictive ACLs) ───
if ($identityFile -and (Test-Path $identityFile)) {
  $identityFullPath = (Resolve-Path $identityFile).Path
  icacls $identityFullPath /reset           2>$null
  icacls $identityFullPath /inheritance:r    2>$null
  icacls $identityFullPath /grant "${env:USERNAME}:(R)" 2>$null
}

# ─── 2. Pack & deploy via tar + ssh ───
$srcPath = $PSScriptRoot

$excludeArgs = @(
  '--exclude=.git',
  '--exclude=.gitignore',
  '--exclude=.gitattributes',
  '--exclude=.vscode',
  '--exclude=.idea',
  '--exclude=*.swp',
  '--exclude=*.swo',
  '--exclude=*~',
  '--exclude=Thumbs.db',
  '--exclude=.DS_Store',
  '--exclude=Desktop.ini',
  '--exclude=*.log',
  '--exclude=.env',
  '--exclude=deploy.ps1'
) -join ' '

$tarCmd   = "tar czf - $excludeArgs -C `"$srcPath`" ."
$sshCmd   = "ssh $portArg $identityArg $remote `"find ${remotePath} -mindepth 1 -maxdepth 1 ! -name 'p' ! -name 'git' -exec rm -rf {} + 2>/dev/null; tar -xzf - -C $remotePath`""

Write-Host "`n==> Deploying to ${remote}:${remotePath} ..." -ForegroundColor Cyan

if ($DryRun) {
  Write-Host "  [DryRun] $tarCmd | $sshCmd" -ForegroundColor Yellow
} else {
  Write-Host "  Archiving and transferring..." -ForegroundColor Gray
  $pipe = "$tarCmd | $sshCmd"
  cmd /c $pipe
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Deploy failed (exit code: $LASTEXITCODE)" -ForegroundColor Red
    exit 1
  }
  Write-Host "  Done." -ForegroundColor Green
}

Write-Host "`n==> Deploy complete" -ForegroundColor Green
