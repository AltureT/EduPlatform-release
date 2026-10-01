# 入口脚本写排障文件（Windows；排障文件与 AI 排障规格 §1.3 §1.4 §2）。班迹工作台.bat 出错时调用：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\launcher-diag.ps1 -Stage <install|node|manage> -Message "<English one-liner>"
#   .bat 必须纯 ASCII，所以中文环节名与"一句话"在这里由 Stage 映射；.bat 传来的英文 Message 写进"详情"
#   install → 安装依赖（附最新一份 npm 调试日志 %LOCALAPPDATA%\npm-cache\_logs 的最后 80 行）；node / manage → 启动入口
# 本文件是带 BOM 的 UTF-8（Windows PowerShell 5.1 没有 BOM 会按本机代码页读中文）、LF 行尾。
# 写到平台文件夹顶层 排障\<yyyy-MM-dd>-<HHmmss>-<环节>.md（UTF-8 无 BOM），只留最近 20 份（-反馈.md 不算不删）；
#   写完打印"排障文件已写到 排障/<文件名>，把它发给 AI 工具就能排查"。任何失败都不报错（排障不能把入口搞挂），总是 exit 0。
# 脱敏：.env 敏感键（名字含 PASSWORD / KEY / TOKEN / SECRET）只写"（已填）/（空）"；附上的记录里这些值、t=<凭据>、Bearer …、sk-…（≥ 8 位）换成 ***
# 平台问题的反馈去向（排障手册）：https://github.com/AltureT/EduPlatform-release/issues 、https://gitee.com/alture/EduPlatform-release/issues
param(
  [ValidateSet('install', 'node', 'manage')][string]$Stage = 'manage',
  [string]$Message = ''
)

$ErrorActionPreference = 'Stop'
$stageNames = @{ 'install' = '安装依赖'; 'node' = '启动入口'; 'manage' = '启动入口' }
$phases = @{ 'install' = 'npm install'; 'node' = '找 Node'; 'manage' = '工作台退出' }
$sentences = @{
  'install' = 'npm install 两次都失败（默认源与国内源各一次）'
  'node' = '没有可用的 Node.js（老师没选自动下载，或下载失败）'
  'manage' = '工作台意外退出'
}

# 去掉首尾空白；值被同一种引号（" ' `）包着就去掉引号（工作台 env-file.js 写含空格、#、引号的值时会加）
function Remove-Quotes([string]$v) {
  $v = $v.Trim()
  if ($v.Length -ge 2) {
    $q = $v[0]
    if (($q -eq [char]34 -or $q -eq [char]39 -or $q -eq [char]96) -and $v[$v.Length - 1] -eq $q) { $v = $v.Substring(1, $v.Length - 2) }
  }
  return $v
}

# .env 里敏感键的值（供脱敏）；短于 3 个字符的不做全局替换（免得把记录里所有同样的字符换掉，与 diagnosis.js 一致）
function Get-Secrets($envFile) {
  $out = @()
  if (Test-Path -LiteralPath $envFile) {
    foreach ($l in (Get-Content -LiteralPath $envFile -Encoding UTF8)) {
      if ($l -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $v = Remove-Quotes $Matches[2]
        if ($Matches[1] -match 'PASSWORD|KEY|TOKEN|SECRET' -and $v.Length -ge 3) { $out += $v }
      }
    }
  }
  return ,$out
}

function Protect-Text([string[]]$lines, $secrets) {
  $res = @()
  foreach ($line in $lines) {
    $t = [string]$line
    foreach ($s in $secrets) { if ($s) { $t = $t.Replace($s, '***') } }
    $t = $t -replace '([?&])t=[^&\s]+', '$1t=***'
    $t = $t -replace 'Bearer [A-Za-z0-9._~+/=-]+', 'Bearer ***'
    $t = $t -replace 'sk-[A-Za-z0-9_-]{8,}', '***'
    $res += $t
  }
  return ,$res
}

function Get-EnvLine($envFile) {
  if (-not (Test-Path -LiteralPath $envFile)) { return '（没有 .env）' }
  $parts = @()
  foreach ($l in (Get-Content -LiteralPath $envFile -Encoding UTF8)) {
    if ($l -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $k = $Matches[1]; $v = Remove-Quotes $Matches[2]
      if ($k -match 'PASSWORD|KEY|TOKEN|SECRET') { if ($v.Length -gt 0) { $v = '（已填）' } else { $v = '（空）' } }
      $parts += ($k + '=' + $v)
    }
  }
  if ($parts.Count -eq 0) { return '（空）' }
  return ($parts -join '；')
}

# 取版本：局部改回 Continue，npm 往 stderr 写 WARN 时不会在 Stop 下抛错；只取标准输出的最后一行
function Get-Cmd([string]$name, [string]$arg) {
  $ErrorActionPreference = 'Continue'
  try { $v = & $name $arg 2>$null | Select-Object -Last 1; if ($v) { return [string]$v } } catch { }
  return '未知'
}

function Add-Section($sb, [string]$title, [string[]]$lines) {
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('### ' + $title)
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('```')
  foreach ($l in $lines) { [void]$sb.AppendLine($l) }
  [void]$sb.AppendLine('```')
}

try {
  $root = Split-Path -Parent $PSScriptRoot
  Set-Location -LiteralPath $root
  $now = Get-Date
  $stageName = $stageNames[$Stage]
  $name = $now.ToString('yyyy-MM-dd-HHmmss') + '-' + $stageName + '.md'
  $dir = Join-Path $root '排障'
  $envFile = Join-Path $root '.env'
  $secrets = Get-Secrets $envFile

  # 班迹版本（版本.json；开发仓库没有）
  $version = '开发仓库'
  $vf = Join-Path $root '版本.json'
  if (Test-Path -LiteralPath $vf) {
    try { $version = [string]((Get-Content -LiteralPath $vf -Raw -Encoding UTF8 | ConvertFrom-Json).version) } catch { $version = '未知' }
  }

  # Node：.bat 已把 vendor\node 前置到 PATH
  $nodeText = 'Node 未找到'
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCmd) {
    $kind = '系统'
    if ($nodeCmd.Source -like (Join-Path $root 'vendor\node\*')) { $kind = 'vendor/node 便携版' }
    $nodeText = 'Node ' + (Get-Cmd 'node' '-v') + '（' + $kind + '）'
  }
  $npmText = 'npm ' + (Get-Cmd 'npm' '-v')

  # 文件夹与真实路径：pushd 进 UNC 路径时会映射一个临时盘符，DisplayRoot 是 \\server\share
  $real = $root
  $free = '未知'
  try {
    $drive = Get-PSDrive -Name $root.Substring(0, 1) -PSProvider FileSystem
    if ($drive.DisplayRoot) { $real = $drive.DisplayRoot.TrimEnd('\') + $root.Substring(2) }
    if ($drive.Free -ne $null) { $free = [string][math]::Floor($drive.Free / 1MB) + ' MB' }
  } catch { }
  $note = ''
  if ($real.StartsWith('\\') -or $root.StartsWith('\\')) { $note = '（网络盘或外接盘）' }
  $realText = $real
  if ($real -eq $root) { $realText = '同上' }

  $lesson = '（还没有课程）'
  if (Test-Path -LiteralPath $envFile) {
    foreach ($l in (Get-Content -LiteralPath $envFile -Encoding UTF8)) { if ($l -match '^LESSON_CONFIG=(.+)$') { $lesson = $Matches[1] } }
  }

  $detail = '（无）'
  if ($Message) { $detail = (Protect-Text @($Message) $secrets)[0] }

  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('# 排障：' + $stageName + ' · ' + $now.ToString('yyyy-MM-dd HH:mm:ss'))
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('> 给 AI 工具：这是班迹工作台自动写的排障文件。请先读 docs/排障手册.md，按它判断是环境、课程还是平台问题，再处理。')
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('## 发生了什么')
  [void]$sb.AppendLine('- 环节：' + $stageName + '（' + $phases[$Stage] + '）')
  [void]$sb.AppendLine('- 一句话：' + $sentences[$Stage])
  [void]$sb.AppendLine('- 详情：' + $detail)
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('## 环境')
  [void]$sb.AppendLine('- 班迹版本：' + $version + '；平台文件被改过：没查')
  [void]$sb.AppendLine('- 系统：Windows ' + [Environment]::OSVersion.Version.ToString() + ' ' + $env:PROCESSOR_ARCHITECTURE + '；' + $nodeText + '；' + $npmText)
  [void]$sb.AppendLine('- 平台文件夹：' + $root + '；真实路径：' + $realText + $note)
  [void]$sb.AppendLine('- 磁盘可用：' + $free)
  [void]$sb.AppendLine('- 当前课程：' + $lesson)
  [void]$sb.AppendLine('- .env：' + (Get-EnvLine $envFile))
  [void]$sb.AppendLine('- 工作台：没启动（入口脚本写的）')
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('## 最近记录')

  $launcherLog = Join-Path $root 'data\logs\launcher.log'
  $lines = @('（还没有入口脚本记录）')
  if (Test-Path -LiteralPath $launcherLog) { $lines = Protect-Text @(Get-Content -LiteralPath $launcherLog -Tail 60 -Encoding UTF8) $secrets }
  Add-Section $sb '入口脚本记录（data/logs/launcher.log 最后 60 行）' $lines

  if ($Stage -eq 'install') {
    $npmLines = @('（没找到 npm 调试日志）')
    $logDir = Join-Path $env:LOCALAPPDATA 'npm-cache\_logs'
    if (Test-Path -LiteralPath $logDir) {
      $latest = Get-ChildItem -LiteralPath $logDir -Filter '*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($latest) { $npmLines = Protect-Text (@('（' + $latest.FullName + '）') + @(Get-Content -LiteralPath $latest.FullName -Tail 80 -Encoding UTF8)) $secrets }
    }
    Add-Section $sb 'npm 记录（最新一份 npm 调试日志的最后 80 行）' $npmLines
  }

  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $file = Join-Path $dir $name
  [IO.File]::WriteAllText($file, $sb.ToString().Replace("`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))

  # 只留最近 20 份（按文件名排序，-反馈.md 不算不删）
  $all = @(Get-ChildItem -LiteralPath $dir -Filter '*.md' | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}-\d{6}-.+\.md$' -and $_.Name -notlike '*-反馈.md' } | Sort-Object Name)
  if ($all.Count -gt 20) { $all | Select-Object -First ($all.Count - 20) | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force } }

  Write-Host ''
  Write-Host ('排障文件已写到 排障/' + $name + '，把它发给 AI 工具就能排查')
} catch {
  Write-Host ('launcher-diag: ' + $_.Exception.Message)
}
exit 0
