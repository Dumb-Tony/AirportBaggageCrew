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

<#
  THE ASSERTION BASELINE. A green suite proves that the assertions which RAN passed; it
  says nothing about how many ran. Most of the coverage here loops over a collection —
  the 24 event names, the 17 cue rows, three flights, nine waypoints — and a loop over an
  empty collection contributes zero assertions and stays green. So does a section that
  returns early after a containment failure. Both drain coverage invisibly.

  Comparing the reported count against these numbers is the only thing that notices.
  When you deliberately add or remove assertions, update the number here in the same
  commit — that is the point at which somebody has to look at it.
#>
$baseline = @{
  m0 = 122; m1 = 147; m2 = 155; m3 = 109; m4 = 131; m5 = 190; m6 = 170; m7 = 159
  m8 = 38; m9 = 109
}
$suites = @("m0","m1","m2","m3","m4","m5","m6","m7","m8","m9")
if ($Only) { $suites = @($Only) }

$failed = @()
foreach ($s in $suites) {
  Write-Host ""
  Write-Host "=== $s ($Browser) ===" -ForegroundColor Cyan
  $expect = if ($baseline.ContainsKey($s)) { $baseline[$s] } else { 0 }
  & "$root\tools\smoketest.ps1" -Tests "tools\$s-tests.js" -Browser $Browser -ExpectAssertions $expect
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
