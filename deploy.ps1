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
# Относительный путь к ключу разрешаем от каталога скрипта, а не от CWD.
if ($identityFile -and -not [System.IO.Path]::IsPathRooted($identityFile)) {
  $identityFile = Join-Path $PSScriptRoot $identityFile
}
$identityArg  = if ($identityFile) { "-i `"$identityFile`"" } else { '' }

$remote  = "${sshUser}@${sshHost}"
# Внимание: ssh принимает порт как `-p`, а scp — как `-P` (разные ключи).
$sshPortArg = if ($sshPort -ne '22') { "-p $sshPort" } else { '' }
$scpPortArg = if ($sshPort -ne '22') { "-P $sshPort" } else { '' }

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
  '--exclude=deploy.ps1',
  '--exclude=AGENTS.md',
  '--exclude=ARCHITECTURE.md',
  '--exclude=refactoring.md',
  '--exclude=analysis-*.md',
  '--exclude=README.md',
  '--exclude=p',
  '--exclude=oge.nayanovaacademy.ru'
) -join ' '

$remoteTarCmd = "find `"${remotePath}`" -mindepth 1 -maxdepth 1 ! -name 'git' -exec rm -rf {} + 2>/dev/null; rm -rf `"${remotePath}/p`" 2>/dev/null; tar -xzf - --no-overwrite-dir -m -C `"${remotePath}`"; test -s `"${remotePath}/oge.html`""
$tarCmd   = "tar czf - $excludeArgs -C `"$srcPath`" ."
$sshCmd   = "ssh $sshPortArg $identityArg $remote `"$remoteTarCmd`""

Write-Host "`n==> Deploying to ${remote}:${remotePath} ..." -ForegroundColor Cyan

if ($DryRun) {
  Write-Host "  [DryRun] $tarCmd | $sshCmd" -ForegroundColor Yellow
} else {
  # Pack first (separately), so a tar failure is detected before transfer.
  Write-Host "  Archiving..." -ForegroundColor Gray
  $tarFile = Join-Path $env:TEMP ("oge-deploy-" + [guid]::NewGuid().ToString('N') + ".tar.gz")
  cmd /c "tar czf `"$tarFile`" $excludeArgs -C `"$srcPath`" ."
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  tar failed (exit code: $LASTEXITCODE)" -ForegroundColor Red
    Remove-Item $tarFile -ErrorAction SilentlyContinue
    exit 1
  }

  Write-Host "  Transferring..." -ForegroundColor Gray
  cmd /c "$sshCmd < `"$tarFile`""
  $sshExit = $LASTEXITCODE
  Remove-Item $tarFile -ErrorAction SilentlyContinue
  if ($sshExit -ne 0) {
    Write-Host "Deploy failed (ssh exit code: $sshExit)" -ForegroundColor Red
    exit 1
  }
  Write-Host "  Done." -ForegroundColor Green
}

# ─── 3. Deploy nginx config ───
$nginxSite = 'oge.nayanovaacademy.ru'
$nginxLocal = Join-Path $PSScriptRoot $nginxSite
$nginxRemote = '/etc/nginx/sites-available/' + $nginxSite

if ($DryRun) {
  Write-Host "  [DryRun] Deploy nginx config: $nginxSite" -ForegroundColor Yellow
} elseif (Test-Path $nginxLocal) {
  Write-Host "`n==> Deploying nginx config ($nginxSite) ..." -ForegroundColor Cyan
  $scpCmd = "scp $scpPortArg $identityArg `"$nginxLocal`" ${remote}:/tmp/nginx-$nginxSite"
  $sshNginxCmd = "ssh $sshPortArg $identityArg $remote `"sudo -n /usr/local/sbin/deploy-nginx.sh $nginxSite`""
  cmd /c $scpCmd
  if ($LASTEXITCODE -ne 0) { Write-Host "  Nginx config scp failed" -ForegroundColor Red; exit 1 }
  cmd /c $sshNginxCmd
  if ($LASTEXITCODE -ne 0) { Write-Host "  Nginx config install/reload failed" -ForegroundColor Red; exit 1 }
  Write-Host "  Done." -ForegroundColor Green
}

Write-Host "`n==> Deploy complete" -ForegroundColor Green
