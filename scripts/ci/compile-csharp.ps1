# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# Compiles every piece of C# Keeper builds on Windows at run time, with the
# compilers Windows itself ships (Windows PowerShell 5.1's Add-Type and the
# .NET Framework 4 csc.exe, both C# 5). Run scripts/ci/csharp-sources.mjs first.
# Each Add-Type runs in its own process, as it does in Keeper; nothing is called.
# Usage (Windows PowerShell): powershell -File scripts/ci/compile-csharp.ps1 <folder>
param([string]$Dir = 'csharp-out')
$ErrorActionPreference = 'Continue'
$Dir = (Resolve-Path $Dir).Path
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$manifest = Get-Content -Raw (Join-Path $Dir 'manifest.json') | ConvertFrom-Json
$failed = @()

foreach ($m in $manifest) {
  if ($m.kind -eq 'csc') {
    $csc = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $exe = Join-Path $Dir "$($m.name).exe"
    $out = & $csc /nologo /target:exe "/out:$exe" /reference:System.ServiceProcess.dll (Join-Path $Dir "$($m.name).cs") 2>&1 | Out-String
    $ok = ($LASTEXITCODE -eq 0) -and (Test-Path $exe)
  } elseif ($m.kind -eq 'load') {
    $out = & $ps -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $Dir "$($m.name).ps1") 2>&1 | Out-String
    $ok = $LASTEXITCODE -eq 0
  } else {
    $out = & $ps -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $Dir "$($m.name).ps1") 2>&1 | Out-String
    $ok = ($LASTEXITCODE -eq 0) -and ($out -match 'compiled')
  }
  if ($ok) {
    Write-Output "PASS $($m.name)  $($m.where)"
    if ($m.kind -eq 'load') { Write-Output $out.Trim() }
  } else {
    Write-Output "FAIL $($m.name)  $($m.where)"
    Write-Output $out.Trim()
    $failed += $m.name
  }
}

Write-Output "PowerShell $($PSVersionTable.PSVersion), .NET $([Environment]::Version)"
if ($failed.Count) {
  Write-Output "$($failed.Count) did not compile: $($failed -join ', ')"
  exit 1
}
Write-Output "Everything compiled ($($manifest.Count) checks)."
