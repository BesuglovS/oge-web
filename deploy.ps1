<#
.SYNOPSIS
  Deploy PHP site to remote server via SSH.
.DESCRIPTION
  Reads config from .env, packs project source via tar and syncs
  to remote server over SSH. Excludes dev files (.git, IDE files, deploy script).
.PARAMETER DryRun
  Show commands without executing.
.PARAMETER Rollback
  Switch the public symlink to the previous release (or to -Release) and exit.
.PARAMETER Release
  Release directory name for -Rollback (e.g. 20261025-095658-1648451).
.EXAMPLE
  .\deploy.ps1
  .\deploy.ps1 -DryRun
  .\deploy.ps1 -Rollback
  .\deploy.ps1 -Rollback -Release 20261025-095536-1648371
#>

param(
  [switch]$DryRun,
  [switch]$Rollback,
  [string]$Release
)

$ErrorActionPreference = 'Stop'

# --- Deploy marker: writes version.json into the deployed payload ---
# Records commit/branch/tree/dirty/deployedAt/via so the deployed content can be
# compared with the local repository later (see na-web/check-deploy.ps1).
function New-DeployMarker {
  param(
    [Parameter(Mandatory)][string]$ProjectDir,
    [Parameter(Mandatory)][string]$OutFile,
    [string]$Via = 'deploy.ps1'
  )
  $commit = $null; $branch = $null; $tree = $null; $dirty = $null; $changed = $null
  if (Test-Path (Join-Path $ProjectDir '.git')) {
    $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
      $commit  = (& git -C $ProjectDir rev-parse HEAD 2>$null)
      $branch  = (& git -C $ProjectDir rev-parse --abbrev-ref HEAD 2>$null)
      $tracked   = @(& git -C $ProjectDir diff HEAD --numstat 2>$null)
      $untracked = @(& git -C $ProjectDir ls-files -o --exclude-standard 2>$null)
      $changed   = $tracked.Count + $untracked.Count
      $dirty     = ($changed -gt 0)
      if ($dirty) {
        $stash = (& git -C $ProjectDir stash create 2>$null)
        if ($stash) { $tree = (& git -C $ProjectDir rev-parse "$($stash.Trim())^{tree}" 2>$null) }
      } else {
        $tree = (& git -C $ProjectDir rev-parse 'HEAD^{tree}' 2>$null)
      }
    } finally { $ErrorActionPreference = $prevEap }
  }
  $marker = [ordered]@{
    project    = Split-Path -Leaf $ProjectDir
    commit     = if ($commit) { $commit.Trim() } else { $null }
    branch     = if ($branch) { $branch.Trim() } else { $null }
    tree       = if ($tree)   { $tree.Trim() }   else { $null }
    dirty      = $dirty
    dirtyFiles = $changed
    deployedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    deployedBy = $env:USERNAME
    via        = $Via
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutFile) | Out-Null
  [System.IO.File]::WriteAllText($OutFile, ($marker | ConvertTo-Json -Depth 3),
    (New-Object System.Text.UTF8Encoding($false)))
}

# ─── 1. Load .env ───
$envFile = Join-Path $PSScriptRoot '.env'
if (Test-Path $envFile) {
  # Читаем явно как UTF-8: Get-Content в PowerShell 5.1 использует ANSI и
  # портит кириллицу/значения с не-ASCII.
  foreach ($line in [System.IO.File]::ReadAllLines($envFile, [System.Text.Encoding]::UTF8)) {
    if ($line -match '^\s*([^#=]+?)\s*=\s*(.*?)\s*$') {
      $key = $matches[1]
      $val = $matches[2]
      if ($val.Length -ge 2 -and
          (($val[0] -eq '"' -and $val[-1] -eq '"') -or ($val[0] -eq "'" -and $val[-1] -eq "'"))) {
        $val = $val.Substring(1, $val.Length - 2)
      }
      [Environment]::SetEnvironmentVariable($key, $val)
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

# ─── 1.5. Rollback (optional) ───
if ($Rollback) {
  if ($Release -and ($Release -notmatch '^[A-Za-z0-9._-]+$' -or $Release -match '(^|/)\.\.(/|$)')) {
    Write-Host "ERROR: invalid -Release name" -ForegroundColor Red
    exit 1
  }
  $rollbackTemplate = @'
set -e
ROOT="__REMOTE_PATH__"
PARENT=$(dirname "$ROOT")
RELEASES="$PARENT/releases"
TARGET="__TARGET__"
if [ -z "$TARGET" ]; then
  CUR=$(basename "$(readlink -f "$ROOT")")
  TARGET=$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '20*' -printf '%f\n' 2>/dev/null | sort -r | grep -Fvx "$CUR" | head -1)
  if [ -z "$TARGET" ]; then
    TARGET=$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -name '20*' -printf '%f\n' 2>/dev/null | sort -r | grep -Fvx "$CUR" | head -1)
  fi
fi
[ -n "$TARGET" ] || { echo "no previous release found" >&2; exit 1; }
[ -d "$RELEASES/$TARGET" ] || { echo "release not found: $TARGET" >&2; exit 1; }
ln -s "releases/$TARGET" "$PARENT/.public-$$"
mv -T "$PARENT/.public-$$" "$ROOT"
echo "rolled back to: $TARGET"
curl -sS -o /dev/null -w "https %{http_code}\n" "https://oge.nayanovaacademy.ru/oge.html"
'@
  $rbScript = $rollbackTemplate.Replace('__REMOTE_PATH__', $remotePath).Replace('__TARGET__', $Release)
  if ($DryRun) {
    $targetText = if ($Release) { $Release } else { 'previous release' }
    Write-Host "[DryRun] rollback to: $targetText" -ForegroundColor Yellow
    exit 0
  }
  Write-Host "==> Rolling back $remote ..." -ForegroundColor Cyan
  $rbName = '/tmp/oge-rollback-' + [guid]::NewGuid().ToString('N') + '.sh'
  $rbFile = Join-Path $env:TEMP ("oge-rollback-" + [guid]::NewGuid().ToString('N') + ".sh")
  [System.IO.File]::WriteAllText($rbFile, $rbScript.Replace("`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))
  $uploadCmd = "ssh $sshPortArg $identityArg $remote `"cat > $rbName`""
  cmd /c "$uploadCmd < `"$rbFile`""
  $rbUpload = $LASTEXITCODE
  Remove-Item $rbFile -ErrorAction SilentlyContinue
  if ($rbUpload -ne 0) {
    Write-Host "Rollback script upload failed" -ForegroundColor Red
    exit 1
  }
  $runCmd = "ssh $sshPortArg $identityArg $remote `"bash $rbName; rc=`$?; rm -f $rbName; exit `$rc`""
  cmd /c $runCmd
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Rollback failed" -ForegroundColor Red
    exit 1
  }
  Write-Host "Rollback complete" -ForegroundColor Green
  exit 0
}

# ─── 2. Pack & deploy via tar + ssh ───
$srcPath = $PSScriptRoot

# --- Deploy marker ---
$markerDir = Join-Path $env:TEMP "marker-$(Get-Random)"
New-DeployMarker -ProjectDir $PSScriptRoot -OutFile (Join-Path $markerDir 'version.json')

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
  '--exclude=HANDOFF.md',
  '--exclude=*.md',
  '--exclude=README.md',
  '--exclude=./p',
  '--exclude=tools',
  '--exclude=.github',
  '--exclude=oge.nayanovaacademy.ru'
) -join ' '

# После распаковки проверяем ключевые файлы (smoke-check).
# Атомарный деплой: новый релиз распаковывается в releases/<ts>-$PID,
# серверные файлы git/ переносятся без перезаписи, затем public —
# симлинк на новый релиз (замена симлинка атомарна). Старые релизы
# хранятся для отката (KEEP=5). При любой ошибке live не трогается.
$remoteScriptTemplate = @'
set -e
ROOT="__REMOTE_PATH__"
PARENT=$(dirname "$ROOT")
RELEASES="$PARENT/releases"
KEEP=5
NAME="$(date +%Y%m%d-%H%M%S)-$$"
NEW="$RELEASES/$NAME"
trap 'rm -rf "$NEW"' EXIT
mkdir -p "$RELEASES"
rm -rf "$NEW"
mkdir -p "$NEW"
tar -xzf - -C "$NEW"
if [ -d "$ROOT/git" ]; then
  mkdir -p "$NEW/git"
  cp -a -n "$ROOT/git/." "$NEW/git/"
fi
# Нормализуем права: tar с Windows может принести 0777 у каталогов
# (в частности git/); webroot не должен быть world-writable.
find "$NEW" -type d -exec chmod 755 {} +
find "$NEW" -type f -exec chmod 644 {} +
# tar может выставить каталогу mtime исходного дерева — для сортировки
# релизов и логов фиксируем «сейчас».
touch "$NEW"
test -s "$NEW/oge.html"
test -s "$NEW/sw.js"
test -s "$NEW/404.html"
test -s "$NEW/offline.html"
test -s "$NEW/manifest.json"
test -s "$NEW/run_python.php"
test -s "$NEW/version.json"
test -s "$NEW/js/progress.js"
test -s "$NEW/js/oge15-ref.js"
test -s "$NEW/data/oge14-exam.json"
test -s "$NEW/files/oge15/tasks.json"
test ! -e "$NEW/HANDOFF.md"
ls "$NEW/files/"*.zip >/dev/null 2>&1
if [ ! -L "$ROOT" ]; then
  INITIAL="$RELEASES/initial-$$"
  rm -rf "$INITIAL"
  mv "$ROOT" "$INITIAL"
  if ! ln -s "releases/$(basename "$INITIAL")" "$PARENT/.public-$$" || ! mv -T "$PARENT/.public-$$" "$ROOT"; then
    rm -f "$PARENT/.public-$$"
    mv "$INITIAL" "$ROOT"
    exit 1
  fi
fi
ln -s "releases/$NAME" "$PARENT/.public-$$"
if ! mv -T "$PARENT/.public-$$" "$ROOT"; then
  rm -f "$PARENT/.public-$$"
  exit 1
fi
trap - EXIT
# PHP-FPM выполняет файлы через симлинк public: без revalidate_path opcache
# продолжает отдавать старый run_python.php. Ставим конфиг из нового релиза
# и перезагружаем FPM (sudo-хелпер валидирует php-fpm -t).
if [ -f "$NEW/php-fpm-opcache.ini" ]; then
  sudo -n /usr/local/sbin/deploy-php.sh "$NEW/php-fpm-opcache.ini" \
    || echo "WARN: не удалось установить php-fpm-opcache.ini (проверьте PHP-код: X-Sandbox-Build)"
fi
# Храним текущий релиз + (KEEP-1) предыдущих. Текущий не удаляем никогда:
# mtime каталога из tar может быть старее старых релизов, и удаление по
# mtime уже один раз снесло live-релиз. Сортируем timestamp-релизы по имени.
CUR=$(basename "$(readlink -f "$ROOT")")
[ -n "$CUR" ] || { echo "current release unresolved" >&2; exit 1; }
KEPT=0
for d in $(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '20*' -printf '%p\n' | sort -r); do
  name=$(basename "$d")
  [ "$name" = "$CUR" ] && continue
  KEPT=$((KEPT+1))
  [ "$KEPT" -lt "$KEEP" ] && continue
  rm -rf "$d" || true
done
test -d "$ROOT"
'@
$remoteScript = $remoteScriptTemplate.Replace('__REMOTE_PATH__', $remotePath)
$tarCmd = "tar czf - $excludeArgs -C `"$srcPath`" . -C `"$markerDir`" version.json"

Write-Host "`n==> Deploying to ${remote}:${remotePath} ..." -ForegroundColor Cyan

try {
  if ($DryRun) {
    Write-Host "  [DryRun] atomic deploy: новый релиз в releases/, smoke-check, атомарная замена public-симлинка" -ForegroundColor Yellow
    Write-Host "  [DryRun] $tarCmd" -ForegroundColor Yellow
  } else {
    # Pack first (separately), so a tar failure is detected before transfer.
    Write-Host "  Archiving..." -ForegroundColor Gray
    $tarFile = Join-Path $env:TEMP ("oge-deploy-" + [guid]::NewGuid().ToString('N') + ".tar.gz")
    cmd /c "tar czf `"$tarFile`" $excludeArgs -C `"$srcPath`" . -C `"$markerDir`" version.json"
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  tar failed (exit code: $LASTEXITCODE)" -ForegroundColor Red
      Remove-Item $tarFile -ErrorAction SilentlyContinue
      exit 1
    }

    # Скрипт атомарного деплоя загружаем отдельно, затем запускаем его,
    # подавая tar на stdin (bash читает скрипт из файла, tar — из stdin).
    $scriptName = '/tmp/oge-deploy-' + [guid]::NewGuid().ToString('N') + '.sh'
    $scriptFile = Join-Path $env:TEMP ("oge-deploy-" + [guid]::NewGuid().ToString('N') + ".sh")
    [System.IO.File]::WriteAllText($scriptFile, $remoteScript.Replace("`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))

    Write-Host "  Uploading deploy script..." -ForegroundColor Gray
    $uploadCmd = "ssh $sshPortArg $identityArg $remote `"cat > $scriptName`""
    cmd /c "$uploadCmd < `"$scriptFile`""
    $uploadExit = $LASTEXITCODE
    Remove-Item $scriptFile -ErrorAction SilentlyContinue
    if ($uploadExit -ne 0) {
      Write-Host "Deploy script upload failed (exit code: $uploadExit)" -ForegroundColor Red
      Remove-Item $tarFile -ErrorAction SilentlyContinue
      exit 1
    }

    Write-Host "  Transferring (atomic swap)..." -ForegroundColor Gray
    $runCmd = "ssh $sshPortArg $identityArg $remote `"bash $scriptName; rc=`$?; rm -f $scriptName; exit `$rc`""
    cmd /c "$runCmd < `"$tarFile`""
    $sshExit = $LASTEXITCODE
    Remove-Item $tarFile -ErrorAction SilentlyContinue
    if ($sshExit -ne 0) {
      Write-Host "Deploy failed (ssh exit code: $sshExit); live-версия не тронута" -ForegroundColor Red
      exit 1
    }
    Write-Host "  Done." -ForegroundColor Green
  }
} finally {
  # Чистим временный каталог маркера даже при ошибке деплоя.
  Remove-Item -Recurse -Force $markerDir -ErrorAction SilentlyContinue
}

# ─── 3. Deploy nginx config ───
$nginxSite = 'oge.nayanovaacademy.ru'
$nginxLocal = Join-Path $PSScriptRoot $nginxSite
$nginxRemote = '/etc/nginx/sites-available/' + $nginxSite

if ($DryRun) {
  Write-Host "  [DryRun] Deploy nginx config: $nginxSite" -ForegroundColor Yellow
} elseif (Test-Path $nginxLocal) {
  Write-Host "`n==> Deploying nginx config ($nginxSite) ..." -ForegroundColor Cyan
  # CSP с хешами inline-скриптов и стилей: политика считается по тем же файлам,
  # что уехали в релиз. Политика длиннее лимита nginx на параметр (4 КБ),
  # поэтому генератор отдаёт блок из set $cspN и склейки в $csp.
  # Если сгенерировать не удалось — НЕ отправляем запасной конфиг с
  # 'unsafe-inline': лучше оставить прежнюю строгую политику.
  $cspBlock = ''
  try {
    $cspBlock = (& node (Join-Path $PSScriptRoot 'tools/csp-policy.mjs') '--nginx' 2>$null | Out-String).TrimEnd()
  } catch { $cspBlock = '' }
  if (-not $cspBlock -or $cspBlock -notmatch 'set \$csp "' -or $cspBlock -notmatch 'sha256-') {
    Write-Host "ERROR: не удалось сгенерировать CSP с хешами (node tools/csp-policy.mjs --nginx)." -ForegroundColor Red
    Write-Host "       Nginx-конфиг не обновлён, чтобы не уехать с 'unsafe-inline'." -ForegroundColor Red
    exit 1
  }
  if ($cspBlock -match "script-src[^;]*'unsafe-inline'|style-src[^;]*'unsafe-inline'") {
    Write-Host "ERROR: сгенерированная CSP содержит 'unsafe-inline'." -ForegroundColor Red
    exit 1
  }
  $cfg = [System.IO.File]::ReadAllText($nginxLocal, [System.Text.Encoding]::UTF8)
  $nl = if ($cfg -match "`r`n") { "`r`n" } else { "`n" }
  $patched = [regex]::Replace($cfg, '(?ms)^([ \t]*)# >>> csp.*?^[ \t]*# <<< csp', {
    param($m)
    $indent = $m.Groups[1].Value
    $indent + '# >>> csp (генерируется deploy.ps1: tools/csp-policy.mjs --nginx)' + $nl +
      ($cspBlock -replace "`r?`n", $nl) + $nl +
      $indent + '# <<< csp'
  })
  if ($patched -eq $cfg) {
    Write-Host "ERROR: в nginx-конфиге не найдены маркеры '# >>> csp' / '# <<< csp'." -ForegroundColor Red
    exit 1
  }
  $nginxUpload = Join-Path $env:TEMP ("nginx-$nginxSite")
  [System.IO.File]::WriteAllText($nginxUpload, $patched, (New-Object System.Text.UTF8Encoding $false))
  $hashCount = ([regex]::Matches($cspBlock, "sha256-")).Count
  Write-Host "  CSP: хешей (скрипты + стили) $hashCount, блоков: $(([regex]::Matches($cspBlock, '(?m)^\s*set \$csp\d+ "')).Count)" -ForegroundColor Gray
  $scpCmd = "scp $scpPortArg $identityArg `"$nginxUpload`" ${remote}:/tmp/nginx-$nginxSite"
  $sshNginxCmd = "ssh $sshPortArg $identityArg $remote `"sudo -n /usr/local/sbin/deploy-nginx.sh $nginxSite`""
  cmd /c $scpCmd
  if ($LASTEXITCODE -ne 0) { Write-Host "  Nginx config scp failed" -ForegroundColor Red; exit 1 }
  cmd /c $sshNginxCmd
  if ($LASTEXITCODE -ne 0) { Write-Host "  Nginx config install/reload failed" -ForegroundColor Red; exit 1 }
  Write-Host "  Done." -ForegroundColor Green
}

# ─── 4. Проверка, что PHP-FPM выполняет именно задеплоенный run_python.php ───
# opcache кэширует realpath симлинка: при revalidate_path=0 после переключения
# public на новый релиз продолжает работать старый файл. run_python.php отдаёт
# X-Sandbox-Build (первые 12 символов sha256 файла) — сверяем с локальным.
$phpLocal = Join-Path $PSScriptRoot 'run_python.php'
if (-not $DryRun -and (Test-Path $phpLocal)) {
  $localHash = (Get-FileHash $phpLocal -Algorithm SHA256).Hash.ToLower().Substring(0, 12)
  try {
    $probe = Invoke-WebRequest -Method Post -Uri "https://$nginxSite/run_python.php" `
      -Body @{ code = 'print(1)'; test_input = ''; expected_output = '1' } `
      -UseBasicParsing -TimeoutSec 20
    $remoteHash = $probe.Headers['X-Sandbox-Build']
    if ($remoteHash -ne $localHash) {
      Write-Host "WARNING: PHP-FPM выполняет другой run_python.php (build=$remoteHash, ожидался $localHash)." -ForegroundColor Yellow
      Write-Host "         Установите php-fpm-opcache.ini (opcache.revalidate_path=1) и перезагрузите php8.1-fpm." -ForegroundColor Yellow
    } else {
      Write-Host "  PHP build matches ($localHash)." -ForegroundColor Gray
    }
  } catch {
    Write-Host "  PHP build check skipped: $($_.Exception.Message)" -ForegroundColor DarkYellow
  }
}

Write-Host "`n==> Deploy complete" -ForegroundColor Green