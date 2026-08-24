# Mutation testing — GDD §35. Break the code on purpose and see whether the suite notices.
#
#   .\tools\_mutate.ps1                     the whole table
#   .\tools\_mutate.ps1 -Only camera        one mutation, by substring of its name
#   .\tools\_mutate.ps1 -List               print the table and exit, touching nothing
#
# WHY THIS EXISTS. The 2026-08-21 meta-audit read all nine suites and found roughly twenty
# assertions that could not fail. It found them BY EYE, four agents deep, and it then
# missed two more in its own author's new code — the m9 status-label check tested the
# audit's own table rather than the game, and the m6 claim that CrewBot never writes to
# state was written down as a rule and checked by nothing. Reading is not an instrument for
# this: an assertion that cannot fail looks exactly like one that can, and the ones that
# survive review are the ones that read most convincingly.
#
# So this measures instead. Every row below is a REVERSION OF A REAL FIX — a bug this
# project actually shipped, expressed as one literal substitution. Apply it, run the
# suites that ought to care, and record which assertions went red. A mutation that leaves
# a suite green is a hole in the suite, already named, with the file in hand.
#
# TWO RULES THE TOOL HOLDS ITSELF TO, because a mutation harness can catch the same disease
# it was built to cure:
#
#   1. A substitution that does not match the expected number of times is an ERROR, never
#      a result. A find string that silently matched nothing would report every suite
#      green and read as a perfect kill-rate of zero — the most convincing possible lie.
#   2. Restore is byte-exact and runs in a `finally`, and the run ends by asking git
#      whether the tree is clean again. A harness that leaves a deliberate bug in the
#      source is worse than no harness.
#
# It also refuses to start on a dirty tree, so a crash can never be confused with your
# own uncommitted edit.

param(
  [string]$Only = "",
  [switch]$List
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$utf8 = New-Object System.Text.UTF8Encoding $false

<#
  THE TABLE. Each row is a bug that shipped, or nearly did.

  suites  = the suites to try, IN COST ORDER. The run stops at the first one that kills the
            mutation, so the report names the CHEAPEST assertion that catches it — which is
            the useful fact when you want to know where coverage actually lives.
  matches = how many times `find` must appear. Stated explicitly rather than defaulted, so
            a row that legitimately hits three flights says so out loud.
#>
$mutations = @(
  @{ name    = "separate-degenerate-normal"
     file    = "src\systems\physics.js"
     find    = "if (d < 1e-6) { nx = 1; ny = 0; d = 0; }"
     replace = "if (d < 1e-6) { nx = 1 / 1e-6; ny = 0; d = 1e-6; }"
     matches = 1
     suites  = @("m1", "m7", "m6")
     why     = "the coincident-contact normal a million units long that threw a bag 181 km" }

  @{ name    = "separated-bag-not-pushed-out-of-walls"
     file    = "src\systems\baggageFlow.js"
     find    = "pushOutOfWalls(bag, bag.radiusM);"
     replace = "void bag;"
     matches = 1
     suites  = @("m1", "m7", "m6")
     why     = "separation shoving a pile through the sort-room wall, where nothing can reach it" }

  @{ name    = "recover-does-not-reseat-the-train"
     file    = "src\systems\interaction.js"
     find    = "updateTrain(state, v, 0);"
     replace = "void v;"
     matches = 1
     suites  = @("m7", "m6")
     why     = "one press of X throwing a bag off a train standing perfectly still" }

  @{ name    = "conveyor-bags-sort-under-the-belt"
     file    = "src\render\renderer.js"
     find    = "if (k === 'conveyor') key = conv.y0 + conv.widthM / 2 + 0.01;"
     replace = "if (k === 'conveyor') key = bag.y + bag.heightM / 2;"
     matches = 1
     suites  = @("m8")
     why     = "six milestones of a featureless empty belt in a game about bags arriving on one" }

  @{ name    = "cart-bags-sort-under-the-bed"
     file    = "src\render\renderer.js"
     find    = "if (c) key = c.y + CONFIG.cart.widthM / 2 + 0.01;"
     replace = "if (c) key = bag.y + bag.heightM / 2;"
     matches = 1
     suites  = @("m8")
     why     = "a loaded cart's bags sliding under its own bed" }

  @{ name    = "aircraft-ground-pass-rotates-again"
     file    = "src\render\renderer.js"
     find    = "ctx.translate(ac.x, ac.y);"
     replace = "ctx.translate(ac.x, ac.y); ctx.rotate(ac.rot);"
     matches = 1
     suites  = @("m8")
     why     = "the two aircraft passes disagreeing, so the fin sat over the nose gear" }

  @{ name    = "clock-runs-behind-the-title-screen"
     file    = "src\game.js"
     find    = "_syncClockToMode() { this.clock.setPaused(this.state.mode !== MODES.PLAYING); }"
     replace = "_syncClockToMode() { void MODES; }"
     matches = 1
     suites  = @("m0", "m3")
     why     = "a fresh game silently burning shift time on the title screen" }

  @{ name    = "camera-readability-floor-removed"
     file    = "src\render\camera.js"
     find    = "export const MIN_PX_PER_M = 28;"
     replace = "export const MIN_PX_PER_M = 1;"
     matches = 1
     suites  = @("m0", "m1", "m6")
     why     = "a narrow window shrinking a bag tag below legibility instead of showing less airport" }

  @{ name    = "priority-miss-costs-no-more-than-any-other"
     file    = "src\config.js"
     find    = "priorityMissPenalty: -50,"
     replace = "priorityMissPenalty: 0,"
     matches = 1
     suites  = @("m4", "m6")
     why     = "GDD §20.2's priority stake being a prize you could win and never one you could lose" }

  @{ name    = "signal-separation-threshold-to-nothing"
     file    = "src\ui\a11y.js"
     find    = "export const SIGNAL_DELTA_E = 11;"
     replace = "export const SIGNAL_DELTA_E = 0;"
     matches = 1
     suites  = @("m9")
     why     = "an accessibility audit that passes everything by asking for nothing" }

  @{ name    = "walls-stop-blocking-movement"
     file    = "src\systems\physics.js"
     find    = "if (isBlocked(nx, ent.y, radius)) { ent.vx = -ent.vx * restitution; hit = true; }"
     replace = "if (false) { ent.vx = -ent.vx * restitution; hit = true; }"
     matches = 1
     suites  = @("m0", "m1", "m6")
     why     = "the collision half of the one function every moving thing goes through" }

  @{ name    = "hold-becomes-a-radius-again"
     file    = "src\entities\aircraft.js"
     find    = "return Math.abs(x - z.x) <= z.lengthM / 2 + pad &&"
     replace = "return Math.hypot(x - z.x, y - z.y) <= z.lengthM / 2 + pad ||"
     matches = 1
     suites  = @("m3", "m6")
     why     = "GDD §9.1: do not count a bag merely because it touched the aircraft" }

  @{ name    = "corner-statistic-counts-keystrokes"
     file    = "src\systems\hitching.js"
     find    = "const CORNER_COUNTS_AT = 0.25;"
     replace = "const CORNER_COUNTS_AT = 0;"
     matches = 1
     suites  = @("m2", "m4", "m6")
     why     = "GDD §11.3's odd statistic reading 168 a shift against 5.7 spills — noise, not a stat" }

  @{ name    = "shift-is-11-bags-a-flight-again"
     file    = "src\data\flights.js"
     find    = "bagCount: 17,"
     replace = "bagCount: 11,"
     matches = 3
     suites  = @("m0", "m3", "m6")
     why     = "33 bags, outside GDD §20.2's 40-60 and §20.4's 14-18, and a shift anyone can clear" }
)

if ($Only) { $mutations = @($mutations | Where-Object { $_.name -like "*$Only*" }) }
if ($mutations.Count -eq 0) { Write-Host "No mutation matches '$Only'." -ForegroundColor Red; exit 2 }

if ($List) {
  Write-Host ""
  Write-Host "$($mutations.Count) mutations:" -ForegroundColor Cyan
  foreach ($m in $mutations) {
    Write-Host ("  {0,-42} {1,-30} {2}" -f $m.name, $m.file, ($m.suites -join ",")) -ForegroundColor Gray
    Write-Host ("  {0,-42} {1}" -f "", $m.why) -ForegroundColor DarkGray
  }
  exit 0
}

# A dirty tree makes "was it restored" unanswerable, so refuse rather than guess.
git -C $root diff --quiet
if ($LASTEXITCODE -ne 0) {
  Write-Host "Working tree is dirty. Commit or stash first — this tool edits source files." -ForegroundColor Red
  git -C $root diff --stat
  exit 2
}

# ONE SOURCE OF TRUTH for the assertion baseline: parse it out of test.ps1 rather than
# keeping a second copy here that would drift the first time somebody adds an assertion.
$baseline = @{}
$tp = [System.IO.File]::ReadAllText((Join-Path $root "tools\test.ps1"))
foreach ($bm in [regex]::Matches($tp, '(?m)\b(m\d+)\s*=\s*(\d+)')) {
  $baseline[$bm.Groups[1].Value] = [int]$bm.Groups[2].Value
}
if ($baseline.Count -lt 8) {
  Write-Host "Could not parse the assertion baseline out of tools\test.ps1 ($($baseline.Count) found)." -ForegroundColor Red
  exit 2
}

$scratch = Join-Path $env:TEMP ("abc-mutate-" + [guid]::NewGuid().ToString("N") + ".txt")
$results = @()

foreach ($m in $mutations) {
  $path = Join-Path $root $m.file
  Write-Host ""
  Write-Host "=== $($m.name) ===" -ForegroundColor Cyan
  Write-Host "    $($m.why)" -ForegroundColor DarkGray

  if (-not (Test-Path $path)) {
    Write-Host "    ERROR: $($m.file) does not exist." -ForegroundColor Red
    $results += @{ name = $m.name; verdict = "ERROR"; detail = "no such file: $($m.file)" }
    continue
  }

  $origBytes = [System.IO.File]::ReadAllBytes($path)
  $origText  = [System.IO.File]::ReadAllText($path)
  $hits = ([regex]::Matches($origText, [regex]::Escape($m.find))).Count
  if ($hits -ne $m.matches) {
    # NOT a result. A find string that no longer matches means the source moved on, and
    # reporting that as SURVIVED or KILLED would be the exact lie this tool exists to find.
    Write-Host "    ERROR: found $hits occurrences, expected $($m.matches). The source has moved." -ForegroundColor Red
    Write-Host "           looking for: $($m.find)" -ForegroundColor DarkGray
    $results += @{ name = $m.name; verdict = "ERROR"; detail = "matched $hits times, expected $($m.matches)" }
    continue
  }

  $verdict = "SURVIVED"
  $detail  = "no suite noticed"
  try {
    [System.IO.File]::WriteAllText($path, $origText.Replace($m.find, $m.replace), $utf8)
    Write-Host "    applied to $($m.file) ($hits site$(if ($hits -ne 1) { 's' }))" -ForegroundColor Yellow

    foreach ($s in $m.suites) {
      if (Test-Path $scratch) { Remove-Item $scratch -Force }
      & (Join-Path $root "tools\smoketest.ps1") -Tests "tools\$s-tests.js" -OutFile $scratch *> $null
      $body = if (Test-Path $scratch) { [System.IO.File]::ReadAllText($scratch) } else { "" }

      if (-not $body) {
        $verdict = "KILLED"; $detail = "$s crashed before reporting"
        Write-Host "    KILLED by $s — the suite could not even run" -ForegroundColor Green
        break
      }

      $failIds = @()
      foreach ($line in ($body -split "`n")) {
        $t = $line.Trim()
        if ($t -like 'FAIL *' -or $t -like 'FAIL`t*') {
          $tok = ($t -replace '^FAIL\s+', '') -split '\s+'
          if ($tok.Count -gt 0 -and $tok[0]) { $failIds += $tok[0] }
        }
      }
      $cm = [regex]::Match($body, '(?m)^ALL-PASS\s+(\d+)')
      $reported = if ($cm.Success) { [int]$cm.Groups[1].Value } else { -1 }
      $want = if ($baseline.ContainsKey($s)) { $baseline[$s] } else { -1 }

      if ($failIds.Count -gt 0) {
        $shown = ($failIds | Select-Object -First 6) -join ", "
        if ($failIds.Count -gt 6) { $shown += " (+$($failIds.Count - 6) more)" }
        $verdict = "KILLED"; $detail = "$s`: $shown"
        Write-Host "    KILLED by $s — $($failIds.Count) assertion$(if ($failIds.Count -ne 1) { 's' }) red: $shown" -ForegroundColor Green
        break
      }
      if ($want -gt 0 -and $reported -gt 0 -and $reported -ne $want) {
        # Green, but fewer assertions ran than the baseline says exist. That is the
        # structural hole the count gate was added for, and it counts as a kill.
        $verdict = "KILLED"; $detail = "$s`: count $reported, baseline $want (coverage drained, nothing failed)"
        Write-Host "    KILLED by $s — assertion count $reported against a baseline of $want" -ForegroundColor Green
        break
      }
      Write-Host "    $s green ($reported assertions)" -ForegroundColor DarkGray
    }
  }
  finally {
    [System.IO.File]::WriteAllBytes($path, $origBytes)
  }

  if ($verdict -eq "SURVIVED") {
    Write-Host "    SURVIVED — $($m.suites -join ', ') all green with this bug in place" -ForegroundColor Red
    $detail = "$($m.suites -join ',') all green"
  }
  $results += @{ name = $m.name; verdict = $verdict; detail = $detail; file = $m.file }
}

if (Test-Path $scratch) { Remove-Item $scratch -Force }

Write-Host ""
Write-Host "=== RESULTS ===" -ForegroundColor Cyan
$killed = @($results | Where-Object { $_.verdict -eq "KILLED" })
$lived  = @($results | Where-Object { $_.verdict -eq "SURVIVED" })
$errors = @($results | Where-Object { $_.verdict -eq "ERROR" })
foreach ($r in $results) {
  $c = switch ($r.verdict) { "KILLED" { "Green" } "SURVIVED" { "Red" } default { "Yellow" } }
  Write-Host ("  {0,-9} {1,-42} {2}" -f $r.verdict, $r.name, $r.detail) -ForegroundColor $c
}
Write-Host ""
$scored = $killed.Count + $lived.Count
if ($scored -gt 0) {
  $pct = [math]::Round(100 * $killed.Count / $scored)
  Write-Host "KILL RATE $($killed.Count)/$scored ($pct%)" -ForegroundColor $(if ($lived.Count -eq 0) { "Green" } else { "Yellow" })
}
if ($errors.Count -gt 0) {
  Write-Host "$($errors.Count) mutation(s) could not be applied and are NOT scored — fix the find strings." -ForegroundColor Yellow
}

# The tool's own honesty check: everything it touched has to be back.
git -C $root diff --quiet
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "RESTORE FAILED — the tree is dirty and a deliberate bug may still be in the source:" -ForegroundColor Red
  git -C $root diff --stat
  exit 3
}
Write-Host "every mutated file restored byte-for-byte (git agrees the tree is clean)" -ForegroundColor DarkGray
if ($lived.Count -gt 0 -or $errors.Count -gt 0) { exit 1 }
exit 0
