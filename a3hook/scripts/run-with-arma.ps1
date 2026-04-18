#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Run the built a3hook tool against a running Arma 3 process (local development only).

.DESCRIPTION
  Resolves a3hook.exe next to typical CMake output folders, finds arma3_x64 / arma3,
  then runs: a3hook <ArmaPid> <your arguments>.

  Examples:
    .\run-with-arma.ps1
    .\run-with-arma.ps1 memdump "$env:TEMP\arma-memdump.bin"
    .\run-with-arma.ps1 hijack $PID

  Override binary or process:
    $env:A3HOOK_EXE = 'D:\path\a3hook.exe'
    .\run-with-arma.ps1 -ArmaProcessId 12345 memdump "$env:TEMP\out.bin"
#>
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $HookArgs,

  # If set, skip Arma detection and use this PID (must be Arma when using hook features).
  [int] $ArmaProcessId = 0
)

$ErrorActionPreference = 'Stop'

function Resolve-A3HookExe {
  if ($env:A3HOOK_EXE) {
    $p = [System.IO.Path]::GetFullPath($env:A3HOOK_EXE)
    if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
    Write-Error "A3HOOK_EXE is set but file not found: $p"
  }
  $a3hookRoot = Split-Path -Parent $PSScriptRoot
  $candidates = @(
    (Join-Path $a3hookRoot 'build\Release\a3hook.exe'),
    (Join-Path $a3hookRoot 'build\RelWithDebInfo\a3hook.exe'),
    (Join-Path $a3hookRoot 'build\Debug\a3hook.exe'),
    (Join-Path $a3hookRoot 'build\a3hook.exe'),
    (Join-Path $a3hookRoot 'out\build\x64-release\a3hook.exe'),
    (Join-Path $a3hookRoot 'out\build\x64-debug\a3hook.exe')
  )
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c -PathType Leaf) { return $c }
  }
  Write-Error @"
Could not find a3hook.exe. Build the target first, for example from the repo root:

  cmake -B a3hook/build -S a3hook
  cmake --build a3hook/build --parallel --config Release

Or set A3HOOK_EXE to the full path of a3hook.exe.
"@
}

function Get-ArmaProcess {
  param([int] $ForcePid)
  if ($ForcePid -gt 0) {
    $p = Get-Process -Id $ForcePid -ErrorAction SilentlyContinue
    if (-not $p) { Write-Error "No process with Id $ForcePid." }
    return $p
  }
  $list = @(
    foreach ($n in 'arma3_x64', 'arma3') {
      Get-Process -Name $n -ErrorAction SilentlyContinue
    }
  ) | Sort-Object StartTime -Descending
  $n = @($list).Count
  if ($n -eq 0) {
    Write-Error "No running Arma 3 process found (looked for arma3_x64, arma3). Start the game first."
  }
  if ($n -gt 1) {
    Write-Host "Multiple Arma processes found; using the one started most recently:" -ForegroundColor Yellow
    $list | ForEach-Object { Write-Host ("  Id={0} Name={1} StartTime={2}" -f $_.Id, $_.Name, $_.StartTime) }
  }
  return @($list)[0]
}

$hook = Resolve-A3HookExe
$arma = Get-ArmaProcess -ForcePid $ArmaProcessId

Write-Host ("a3hook: {0}" -f $hook) -ForegroundColor Cyan
Write-Host ("Arma 3: Id={0} Name={1}" -f $arma.Id, $arma.Name) -ForegroundColor Cyan

if (-not $HookArgs -or $HookArgs.Count -eq 0) {
  Write-Host ""
  Write-Host "No hook arguments passed. Showing a3hook help (does not use the Arma PID):" -ForegroundColor Yellow
  Write-Host ("  To try against this session: .\{0} memdump `"$env:TEMP\arma-memdump.bin`"" -f (Split-Path -Leaf $PSCommandPath)) -ForegroundColor DarkGray
  Write-Host ""
  & $hook -h
  exit $LASTEXITCODE
}

$invoke = @($hook, [string]$arma.Id) + $HookArgs
Write-Host ("Running: {0}" -f ($invoke -join ' ')) -ForegroundColor DarkGray
& $hook ([string]$arma.Id) @HookArgs
exit $LASTEXITCODE
