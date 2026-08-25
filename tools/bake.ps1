# Bake the clay sprite atlas — GDD §38. A DEV TOOL: it writes assets/, then never runs again
# until the art changes.
#
#   .\tools\bake.ps1
#
# WHY THIS IS OFFLINE. The raymarcher in tools\_bake.js runs at about 43 pixels per
# millisecond in JavaScript, measured, and flat across sprite sizes — it is compute-bound.
# The sprite set is ~1.8 M pixels, so baking at load would cost the player the better part
# of a minute before the title screen appeared. Bake once here, ship the PNG.
#
# The atlas comes back as a base64 data URL inside the harness's own result block, because
# the dev server only serves. That is a couple of megabytes of text through a DOM dump,
# which works, but it is why this script checks the decode rather than trusting it.

param(
  [switch]$KeepRaw
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$assets = Join-Path $root "assets"
if (-not (Test-Path $assets)) { New-Item -ItemType Directory $assets | Out-Null }

$raw = Join-Path $env:TEMP ("abc-bake-" + [guid]::NewGuid().ToString("N") + ".txt")

Write-Host ""
Write-Host "baking the clay atlas — this takes tens of seconds by design" -ForegroundColor Cyan
& (Join-Path $root "tools\smoketest.ps1") -Tests "tools\_bake-run.js" -OutFile $raw -VirtualTimeMs 600000

if (-not (Test-Path $raw)) { Write-Host "no output from the baker." -ForegroundColor Red; exit 1 }
$body = [System.IO.File]::ReadAllText($raw)

# The three markers the runner emits. Anchored, because the whole point of this script is
# that it either produced a real atlas or it failed loudly.
$mJson = [regex]::Match($body, '(?s)==BAKE-JSON==\s*(.+?)\s*==BAKE-PNG==')
$mPng  = [regex]::Match($body, '(?s)==BAKE-PNG==\s*(data:image/png;base64,[A-Za-z0-9+/=\s]+?)\s*==BAKE-DONE==')
if (-not $mJson.Success -or -not $mPng.Success) {
  Write-Host "the baker did not emit a complete atlas." -ForegroundColor Red
  Write-Host ($body.Substring(0, [Math]::Min(1200, $body.Length)))
  exit 1
}

$json = $mJson.Groups[1].Value.Trim()
$b64  = ($mPng.Groups[1].Value -replace '^data:image/png;base64,', '') -replace '\s', ''
$bytes = [Convert]::FromBase64String($b64)

# A PNG starts 89 50 4E 47. If the DOM dump truncated or mangled the payload this is where
# it shows up, rather than as a game that renders nothing.
if ($bytes.Length -lt 8 -or $bytes[0] -ne 0x89 -or $bytes[1] -ne 0x50 -or $bytes[2] -ne 0x4E -or $bytes[3] -ne 0x47) {
  Write-Host "decoded payload is not a PNG ($($bytes.Length) bytes)." -ForegroundColor Red
  exit 1
}

$pngPath  = Join-Path $assets "sprites.png"
$jsonPath = Join-Path $assets "sprites.json"
[System.IO.File]::WriteAllBytes($pngPath, $bytes)
[System.IO.File]::WriteAllText($jsonPath, $json, (New-Object System.Text.UTF8Encoding $false))

$idx = $json | ConvertFrom-Json
Write-Host ""
Write-Host "wrote assets\sprites.png   $([math]::Round($bytes.Length/1024)) KB, $($idx.atlas.w) x $($idx.atlas.h)" -ForegroundColor Green
Write-Host "wrote assets\sprites.json  $($idx.frames.Count) frames, elevation $($idx.elevationDeg)°" -ForegroundColor Green

foreach ($line in ($body -split "`n")) {
  $t = $line.Trim()
  if ($t -match '^(frames|atlas|sprite pixels|bake time|png bytes|elevation) ') {
    Write-Host "  $t" -ForegroundColor DarkGray
  }
}

if ($KeepRaw) { Write-Host "raw block kept at $raw" -ForegroundColor DarkGray }
else { Remove-Item $raw -Force -ErrorAction SilentlyContinue }
exit 0
