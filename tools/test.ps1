# Run every milestone suite in order. Exit 0 only if all of them are green.
#   .\tools\test.ps1                    all suites
#   .\tools\test.ps1 -Only m0           just one
#   .\tools\test.ps1 -Browser edge      the same suites in Edge (GDD M6 cross-browser)
#
# HONEST LIMIT on -Browser edge: Edge is Chromium. It catches build, profile and policy
# differences and nothing whatever about a different ENGINE. There is no Gecko or WebKit
# runtime on this machine, so Firefox and Safari are genuinely untested — the README says
# so rather than implying a coverage this cannot give.
param(
  [string]$Only = "",
  [ValidateSet("chrome", "edge")][string]$Browser = "chrome"
)

$root   = Split-Path $PSScriptRoot -Parent
$suites = @("m0","m1","m2","m3","m4","m5","m6","m7")
if ($Only) { $suites = @($Only) }

$failed = @()
foreach ($s in $suites) {
  Write-Host ""
  Write-Host "=== $s ($Browser) ===" -ForegroundColor Cyan
  & "$root\tools\smoketest.ps1" -Tests "tools\$s-tests.js" -Browser $Browser
  if ($LASTEXITCODE -ne 0) { $failed += $s }
}

Write-Host ""
if ($failed.Count -eq 0) {
  Write-Host "ALL SUITES GREEN in $Browser ($($suites -join ', '))" -ForegroundColor Green
  exit 0
} else {
  Write-Host "FAILING SUITES in ${Browser}: $($failed -join ', ')" -ForegroundColor Red
  exit 1
}
