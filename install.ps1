<#
  install.ps1 — 把 dsh-deepseek-usage 便携插件安装进本机 DSH Desktop 的活动 profile。

  用法（换机/换用户后直接运行）：
    pwsh -File install.ps1                          # 自动识别活动 profile
    pwsh -File install.ps1 -ProfileName desktop     # 指定 profile
    pwsh -File install.ps1 -DshHome "D:\MyDSH"      # 指定 DSH 主目录

  做的事：
    1. 自动识别 DSH Desktop 当前使用的 profile（读 profile-selection 状态，
       找不到则回退到 desktop → web）；
    2. 复制 dsh-deepseek-usage 到 <DshHome>\profiles\<ProfileName>\node_modules\；
    3. 幂等地向该 profile 的 cordis.patch.yml 注入插件条目。
  安装后重启 DSH Desktop 生效。

  注意：
    - 插件本身不含你的 API Key。换机后请重新在 DSH 设置 → 模型页填 DEEPSEEK_API_KEY
      （或把旧机的 <DshHome>\.credentials.yaml 一并拷过来）。
    - 插件状态（今日用量基线等）保存在 <DshHome>\dsh-deepseek-usage\，自动重建。
#>
param(
  [string]$ProfileName = "",
  [string]$DshHome = ""
)

$ErrorActionPreference = "Stop"

if (-not $DshHome) { $DshHome = $env:DSH_HOME }
if (-not $DshHome) { $DshHome = Join-Path $HOME ".dsh" }
$DshHome = [System.IO.Path]::GetFullPath($DshHome)

# ── 自动识别活动 profile ────────────────────────────────────────────────────
if (-not $ProfileName) {
  $stateCandidates = @(
    (Join-Path $env:APPDATA "DSH Desktop\profile-selection\state.json"),
    (Join-Path $env:LOCALAPPDATA "DSH Desktop\profile-selection\state.json"),
    (Join-Path $env:APPDATA "dsh\profile-selection\state.json")
  )
  foreach ($f in $stateCandidates) {
    if (Test-Path $f) {
      try {
        $state = Get-Content $f -Raw | ConvertFrom-Json
        if ($state.active -and (Test-Path (Join-Path $DshHome "profiles\$($state.active)"))) {
          $ProfileName = [string]$state.active
          Write-Host "==> 检测到活动 profile: $ProfileName"
          break
        }
      } catch { /* 忽略损坏的状态文件 */ }
    }
  }
  if (-not $ProfileName) {
    foreach ($candidate in @("desktop", "web")) {
      if (Test-Path (Join-Path $DshHome "profiles\$candidate")) {
        $ProfileName = $candidate
        Write-Host "==> 未读到状态，回退到 profile: $ProfileName"
        break
      }
    }
  }
}
if (-not $ProfileName) { throw "无法确定 DSH profile，请用 -ProfileName 指定（如 desktop / web）" }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$profileDir = Join-Path $DshHome "profiles\$ProfileName"
if (-not (Test-Path $profileDir)) {
  throw "profile 目录不存在：$profileDir"
}
if (-not (Test-Path (Join-Path $profileDir "node_modules"))) {
  Write-Host "==> 警告：$profileDir\node_modules 不存在；插件仍会复制，但需先完成 DSH 依赖安装才能加载。"
}

# ── 1) 复制两个插件（宿主 dsh-deepseek-usage + 侧边栏卡片 dsh-deepseek-usage-ui）──
$plugins = @(
  @{ dir = "dsh-deepseek-usage";    row = "dsh-deepseek-usage";    id = "dsh-deepseek-usage" },
  @{ dir = "dsh-deepseek-usage-ui"; row = "dsh-deepseek-usage-ui"; id = "dsh-deepseek-usage-ui" }
)
foreach ($plugin in $plugins) {
  $source = Join-Path $scriptDir $plugin.dir
  if (-not (Test-Path (Join-Path $source "package.json"))) {
    throw "未找到插件源目录：$source（install.ps1 必须与 $($plugin.dir) 同级）"
  }
  $target = Join-Path $profileDir "node_modules\$($plugin.dir)"
  Write-Host "==> 复制插件到 $target"
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force
}

# ── 2) 幂等注入 cordis.patch.yml（两个插件各一行） ──────────────────────────
$patchFile = Join-Path $profileDir "cordis.patch.yml"
$raw = ""
if (Test-Path $patchFile) { $raw = Get-Content $patchFile -Raw }
if (-not $raw) { $raw = "[]`n" }

foreach ($plugin in $plugins) {
  if ($raw -match $plugin.row) {
    Write-Host "==> cordis.patch.yml 已包含 $($plugin.row)，跳过注入"
    continue
  }
  $entry = @"
- insert:
    - id: $($plugin.id)
      name: $($plugin.row)
"@
  if ($raw -match '(?m)^\[\s*\]\s*$') {
    $raw = [regex]::Replace($raw, '(?m)^\[\s*\]\s*$', ($entry + "`n"))
  } else {
    $trimmed = $raw.TrimEnd()
    if ($trimmed.EndsWith(']')) {
      $raw = $trimmed.Substring(0, $trimmed.Length - 1).TrimEnd() + "`n" + $entry + "`n]`n"
    } else {
      $raw = $trimmed + "`n" + $entry
    }
  }
  Set-Content -Path $patchFile -Value $raw -Encoding utf8 -NoNewline:$false
  Write-Host "==> 已注入 $($plugin.row) 到 cordis.patch.yml"
}

Write-Host ""
Write-Host "安装完成（profile: $ProfileName, DSH home: $DshHome）。"
Write-Host "1) 重启 DSH Desktop（托盘菜单 → 退出，再重新打开；或从启动失败页点「切换并重启」）。"
Write-Host "2) 若托盘显示余额未知：去 设置 → 模型 页确认 DEEPSEEK_API_KEY 已填写。"
Write-Host "3) 阈值/间隔：设置 → deepseek-usage。"
