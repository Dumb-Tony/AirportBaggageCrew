# GDD §37.3 criterion 5 — re-sweep the shift size against the rebuilt crews.
#
#   .\tools\_bagsweep.ps1                 15..18 bags a flight
#   .\tools\_bagsweep.ps1 -Counts 16,17   just those
#
# WHY AGAIN. The count has moved three times (50 -> 34 -> 42 -> 51) and every move was a
# measured decision — but the last sweep was taken against presets that were not a ladder:
# the "veteran" crew was detuned past both optima and delivered 59% where the average crew
# delivered 86%, so a third of the evidence for 51 came from a rung that was simply playing
# badly. §37 rebuilt the presets; this re-derives the count under them.
#
# ⚠ THIS IS THE THIRD TIME A TUNING SWEEP HAS HAD TO BE RE-RUN BECAUSE THE INSTRUMENT
# CHANGED (the bot could not drive, then it could not ease off, now the presets were not
# ordered). That is not wasted work — each re-run changed the answer — but it is the
# reason `_mutate.ps1` and m6 D14 exist: pin the instrument's properties so the next
# sweep is not silently measuring something else.
#
# Mechanically this is `_mutate.ps1`'s apply/measure/restore discipline pointed at data
# instead of at a bug: refuse a dirty tree, verify the substitution matched exactly three
# times, run the balance tool, restore byte-exactly in a finally, and ask git afterwards.

param(
  [int[]]$Counts = @(15, 16, 17, 18)
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$flights = Join-Path $root "src\data\flights.js"
$utf8 = New-Object System.Text.UTF8Encoding $false

function Get-DirtyPaths {
  $ErrorActionPreference = "Continue"
  $out = & git -c core.safecrlf=false -C $root status --porcelain
  return @($out | Where-Object { $_ } | ForEach-Object { ($_ -replace '^..\s+', '').Trim() })
}
if ((Get-DirtyPaths) -contains "src/data/flights.js") {
  Write-Host "src/data/flights.js is dirty. Commit or stash it first." -ForegroundColor Red
  exit 2
}

$origBytes = [System.IO.File]::ReadAllBytes($flights)
$origText  = [System.IO.File]::ReadAllText($flights)
$current   = [regex]::Match($origText, 'bagCount:\s*(\d+)').Groups[1].Value
Write-Host ""
Write-Host "shipped count is $current a flight; sweeping $($Counts -join ', ')" -ForegroundColor Cyan

$scratch = Join-Path $env:TEMP ("abc-bagsweep-" + [guid]::NewGuid().ToString("N") + ".txt")
$results = @()

try {
  foreach ($n in $Counts) {
    $hits = ([regex]::Matches($origText, 'bagCount:\s*\d+,')).Count
    if ($hits -ne 3) {
      Write-Host "ERROR: found $hits bagCount entries, expected 3." -ForegroundColor Red
      exit 2
    }
    $mutated = [regex]::Replace($origText, 'bagCount:\s*\d+,', "bagCount: $n,")
    [System.IO.File]::WriteAllText($flights, $mutated, $utf8)

    Write-Host ""
    Write-Host "=== $n a flight ($($n * 3) bags) ===" -ForegroundColor Cyan
    if (Test-Path $scratch) { Remove-Item $scratch -Force }
    & (Join-Path $root "tools\smoketest.ps1") -Tests "tools\_balance.js" -OutFile $scratch -VirtualTimeMs 300000 *> $null
    $body = if (Test-Path $scratch) { [System.IO.File]::ReadAllText($scratch) } else { "" }
    if (-not $body) {
      Write-Host "  no output — the run crashed" -ForegroundColor Red
      $results += @{ n = $n; ok = $false }
      continue
    }

    $row = @{ n = $n; ok = $true; total = $n * 3 }
    foreach ($skill in @("novice", "average", "veteran")) {
      $m = [regex]::Match($body, "(?m)^$skill\s+mean\s+(-?\d+)% delivered,\s+(-?\d+) points")
      if ($m.Success) {
        $row[$skill] = @{ pct = [int]$m.Groups[1].Value; points = [int]$m.Groups[2].Value }
      } else {
        $row[$skill] = @{ pct = -1; points = 0 }
      }
    }
    # GDD §29: "no known blocker can make a required bag permanently unreachable" is a
    # RULE, not a preference — a count that reintroduces dead ends is out however well it
    # scores. 48 was rejected on exactly this in the 2026-08-21 sweep.
    $row.deadEnds = if ($body -match 'none — the bot never went') { 0 }
                    else { ([regex]::Matches($body, '(?m)^\s+(novice|average|veteran)\s+seed\s')).Count }
    $results += $row
    Write-Host ("  novice {0,3}% / {1,6}   average {2,3}% / {3,6}   veteran {4,3}% / {5,6}   dead ends {6}" -f `
      $row.novice.pct, $row.novice.points, $row.average.pct, $row.average.points, `
      $row.veteran.pct, $row.veteran.points, $row.deadEnds) -ForegroundColor Gray
  }
}
finally {
  [System.IO.File]::WriteAllBytes($flights, $origBytes)
  if (Test-Path $scratch) { Remove-Item $scratch -Force }
}

Write-Host ""
Write-Host "=== RESULTS (mean of 3 seeds per skill) ===" -ForegroundColor Cyan
Write-Host "  per flight  total   novice          average         veteran         dead ends"
foreach ($r in $results) {
  if (-not $r.ok) { Write-Host ("  {0,-10}  CRASHED" -f $r.n) -ForegroundColor Red; continue }
  Write-Host ("  {0,-10}  {1,-6}  {2,3}% / {3,6}   {4,3}% / {5,6}   {6,3}% / {7,6}   {8}" -f `
    $r.n, $r.total, $r.novice.pct, $r.novice.points, $r.average.pct, $r.average.points, `
    $r.veteran.pct, $r.veteran.points, $r.deadEnds)
}
Write-Host ""
Write-Host "the pick has to satisfy all four, in this order:" -ForegroundColor DarkGray
Write-Host "  1. ZERO dead ends        — GDD §29 is a rule, not a preference" -ForegroundColor DarkGray
Write-Host "  2. LADDER STILL ORDERED  — veteran >= average, or the presets stop meaning anything" -ForegroundColor DarkGray
Write-Host "  3. novice in DEBT        — m6 D6: nobody clears it without trying" -ForegroundColor DarkGray
Write-Host "  4. best veteran score    — the top rung is what a played-well shift looks like" -ForegroundColor DarkGray
Write-Host ""
Write-Host "criterion 2 is NEW and came out of this sweep: the ordering is COUNT-DEPENDENT." -ForegroundColor DarkGray
Write-Host "At 16 a flight the average crew beat the veteran (86% against 80%) — the same" -ForegroundColor DarkGray
Write-Host "inversion GDD §37 was written to remove, reappearing from the shift size alone." -ForegroundColor DarkGray
Write-Host "So the presets are not a fixed property of the bot; they are a property of the" -ForegroundColor DarkGray
Write-Host "bot AND the shift it plays, and m6 D14 has to be re-run whenever the count moves." -ForegroundColor DarkGray
foreach ($r in $results) {
  if (-not $r.ok) { continue }
  $flags = @()
  if ($r.deadEnds -gt 0) { $flags += "dead ends" }
  if ($r.veteran.pct -lt $r.average.pct) { $flags += "LADDER INVERTED" }
  if ($r.novice.points -ge 0) { $flags += "novice in credit" }
  if ($flags.Count -gt 0) {
    Write-Host ("  {0,-3} is OUT: {1}" -f $r.n, ($flags -join ", ")) -ForegroundColor Yellow
  } else {
    Write-Host ("  {0,-3} is eligible ({1} pts at veteran)" -f $r.n, $r.veteran.points) -ForegroundColor Green
  }
}

if ((Get-DirtyPaths) -contains "src/data/flights.js") {
  Write-Host ""
  Write-Host "RESTORE FAILED — src/data/flights.js is still modified." -ForegroundColor Red
  Write-Host "  recover with: git checkout -- src/data/flights.js" -ForegroundColor Yellow
  exit 3
}
Write-Host "src/data/flights.js restored byte-for-byte" -ForegroundColor DarkGray
exit 0
