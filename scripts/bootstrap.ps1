# SurfCore 一键引导安装（Windows PowerShell）
#
# 陌生人用法（复制这一行到 PowerShell）：
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/Mieksido/surfcore/main/scripts/bootstrap.ps1 | iex"
#
# 只检查环境不安装（`iex` 没有 -Check 参数，管道后也传不了 switch —— 先落盘，再 -File 调用）：
#   $f="$env:TEMP\bootstrap.ps1"; irm https://raw.githubusercontent.com/Mieksido/surfcore/main/scripts/bootstrap.ps1 -OutFile $f
#   powershell -NoProfile -ExecutionPolicy Bypass -File $f -Check
#
# 自定义安装位置：
#   $env:SURFCORE_DIR = 'D:\surfcore'; ... | iex

param(
  [switch]$Check,
  [string]$Dir = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Say($m = '') { Write-Host $m }
function Ok($m) { Write-Host "  [OK] $m" -ForegroundColor Green }
function Bad($m) { Write-Host "  [!!] $m" -ForegroundColor Yellow }
function Step($n, $m) { Write-Host "`n=== $n. $m ===" -ForegroundColor Cyan }

Say '=============================================='
Say '  SurfCore 一键安装'
Say '=============================================='

# ── 1. 环境 ────────────────────────────────────────────────
Step 1 '检查环境'
$node = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = if ($node) { 'node' } else { '' }
$runtimeRoot = Join-Path $env:USERPROFILE '.dsh'
$runtimeRoot = Join-Path $runtimeRoot 'dsh-runtimes'
$runtimeRoot = Join-Path $runtimeRoot 'dsh-primary-runtime'
$runtimeRoot = Join-Path $runtimeRoot 'dependencies'
$bundledNode = Join-Path (Join-Path (Join-Path $runtimeRoot 'node') 'bin') 'node.exe'
$bundledPnpm = Join-Path (Join-Path (Join-Path $runtimeRoot 'pnpm') 'bin') 'pnpm.cjs'
if (-not $nodeExe -and (Test-Path $bundledNode)) {
  $nodeExe = $bundledNode
  Bad 'PATH 里没有 node，改用 DSH 自带的 Node'
  Ok $bundledNode
}
if (-not $nodeExe) {
  Bad '没找到 Node.js（DSH 自带运行时也没有）。请装 Node 22.13+： https://nodejs.org/'
  return
}
$nodeVer = (& $nodeExe -v).TrimStart('v')
$parts = $nodeVer.Split('.')
$okNode = ([int]$parts[0] -gt 22) -or (([int]$parts[0] -eq 22) -and ([int]$parts[1] -ge 13))
if ($okNode) { Ok "Node v$nodeVer" } else { Bad "Node v$nodeVer 太老（需要 >= 22.13）"; return }

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profiles = @()
if (Test-Path (Join-Path $dshHome 'profiles')) {
  $profiles = Get-ChildItem (Join-Path $dshHome 'profiles') -Directory |
    Where-Object { $_.Name -notlike '.*' -and (Test-Path (Join-Path $_.FullName 'package.json')) } |
    Select-Object -ExpandProperty Name
}
if ($profiles.Count) { Ok "DSH 配置目录：$dshHome（profile：$($profiles -join '、')）" }
else { Bad "没找到 DSH。请先装 DeepSeek Harness 并打开一次（$dshHome）" }

$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if ($gitCmd) { Ok 'git 可用（会用 clone）' } else { Bad '没有 git（会用 zip 下载，也能装）' }

$ports = @()
try {
  $ports = (netstat -ano) | Select-String ':3000 |:3001 ' | ForEach-Object { 'SnowLuma' } | Select-Object -Unique
} catch {}
if ($ports.Count) { Ok '检测到 SnowLuma 端口（3000/3001）' } else { Bad '没检测到 SnowLuma：QQ 会连不上，装好它之后再点一键安装即可' }

if ($Check) { Say "`n仅检查模式，结束。"; return }

# ── 2. 拿到代码 ─────────────────────────────────────────────
Step 2 '下载 SurfCore'
if (-not $Dir) { $Dir = if ($env:SURFCORE_DIR) { $env:SURFCORE_DIR } else { Join-Path $env:USERPROFILE 'surfcore' } }
Say "  安装到：$Dir"

if (Test-Path (Join-Path $Dir 'package.json')) {
  Ok '目录已存在，跳到更新'
  if ($gitCmd -and (Test-Path (Join-Path $Dir '.git'))) {
    Push-Location $Dir
    try { & git pull --ff-only 2>&1 | Out-Null; Ok 'git pull 完成' } catch { Bad "git pull 失败（可忽略，继续用现有版本）" }
    Pop-Location
  }
} elseif ($gitCmd) {
  & git clone --depth 1 https://github.com/Mieksido/surfcore.git $Dir
  if ($LASTEXITCODE -ne 0) { Bad 'git clone 失败'; return }
  Ok '克隆完成'
} else {
  $zip = Join-Path $env:TEMP 'surfcore-main.zip'
  Say '  下载 zip …'
  Invoke-WebRequest -Uri 'https://github.com/Mieksido/surfcore/archive/refs/heads/main.zip' -OutFile $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $env:TEMP -Force
  $src = Get-ChildItem $env:TEMP -Directory -Filter 'surfcore-main' | Select-Object -First 1
  Move-Item $src.FullName $Dir
  Ok '解压完成'
}

# ── 3. 依赖 ────────────────────────────────────────────────
Step 3 '安装依赖（npm install）'
Push-Location $Dir
try {
  $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($npmCmd) {
    & npm install --no-audit --no-fund
  } elseif (Test-Path $bundledPnpm) {
    Bad '没有 npm，改用 DSH 自带的 pnpm'
    & $nodeExe $bundledPnpm install
  } else {
    Bad '没有 npm 也没有 pnpm，请装 Node 22.13+ 后重试'
    return
  }
  if ($LASTEXITCODE -ne 0) {
    Bad '依赖安装失败。可试：npm config set registry https://registry.npmmirror.com'
    return
  }
  Ok '依赖完成'
} finally { Pop-Location }

# ── 4. 装进 DSH ───────────────────────────────────────────
Step 4 '装进 DSH（注册插件 / 预设 / MCP）'
$profile = (& $nodeExe (Join-Path $Dir 'scripts\detect-profile.mjs')).Trim()
if (-not $profile) { $profile = 'web' }
Say "  使用 profile：$profile"
& $nodeExe (Join-Path $Dir 'scripts\setup-dsh.mjs') $profile
if ($LASTEXITCODE -ne 0) { Bad "注册失败：可在 $Dir 下手动跑 node scripts\setup-dsh.mjs $profile" }
else { Ok '已注册' }

# ── 5. 配置 ───────────────────────────────────────────────
Step 5 '生成本地配置'
$cfg = Join-Path $Dir 'config.json'
if (Test-Path $cfg) { Ok 'config.json 已存在（不覆盖）' }
else {
  Copy-Item (Join-Path $Dir 'config.example.json') $cfg
  Ok '已生成 config.json（白名单稍后在界面里勾）'
}

# ── 6. 下一步 ─────────────────────────────────────────────
Step 6 '完成'
Say ''
Say '  接下来（必须做）：'
Say '    1) 完全退出 DSH，再打开'
Say "    2) 设置 → SurfCore → 诊断 → 一键安装（全部）"
Say '    3) 弹窗里填主人 QQ、勾群 → 开始安装'
Say '    4) 若提示需要，再退出重开一次 DSH'
Say ''
Say "  安装目录：$Dir"
Say '  出问题：设置 → SurfCore → 诊断 → 重新体检，把 ✗ 的那项发我。'
Say ''
