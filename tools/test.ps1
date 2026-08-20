# Run every milestone suite in order. Exit 0 only if all of them are green.
#   .\tools\test.ps1            all suites
#   .\tools\test.ps1 -Only m0   just one
param([string]$Only = "")

$root   = Split-Path $PSScriptRoot -Parent
$suites = @("m0","m1","m2","m3")
if ($Only) { $suites = @($Only) }

$failed = @()
foreach ($s in $suites) {
  Write-Host ""
  Write-Host "=== $s ===" -ForegroundColor Cyan
  & "$root\tools\smoketest.ps1" -Tests "tools\$s-tests.js"
  if ($LASTEXITCODE -ne 0) { $failed += $s }
}

Write-Host ""
if ($failed.Count -eq 0) {
  Write-Host "ALL SUITES GREEN ($($suites -join ', '))" -ForegroundColor Green
  exit 0
} else {
  Write-Host "FAILING SUITES: $($failed -join ', ')" -ForegroundColor Red
  exit 1
}
