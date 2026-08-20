#!/usr/bin/env bash
# =============================================================================
# publish.sh — push the current build and confirm the public URL is serving it.
# =============================================================================
#
#   ./tools/publish.sh
#
#   -> https://dumb-tony.github.io/AirportBaggageCrew/
#
# PUSH IS THE DEPLOY. This repo is public, index.html sits at the root, and Pages
# serves `main` at `/`, so there is no build step and no second repository. That
# works because the game is already plain static files and ES modules — the only
# thing it needs from a host is http, which Pages gives it.
#
# Adapted from Dev\BedroomRacers\tools\publish.sh, which has to do considerably
# more because its source repo is private and its deliverable is one bundled
# file. What is copied from it verbatim is the part that matters: the way the
# live URL is verified.
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="https://dumb-tony.github.io/AirportBaggageCrew/"
REPO="Dumb-Tony/AirportBaggageCrew"

cd "$ROOT" || exit 2

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || { echo "on '$branch', not main — Pages serves main" >&2; exit 2; }

if ! git diff --quiet HEAD -- . || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  echo "working tree is dirty — commit before publishing" >&2
  git status --short >&2
  exit 2
fi

if [ -n "$(git log --oneline @{u}..HEAD 2>/dev/null)" ]; then
  echo "pushing $(git rev-parse --short HEAD)…"
  git push -q origin main || { echo "push failed" >&2; exit 1; }
else
  echo "nothing to push — checking the live link is serving this build"
fi

# ── WAIT FOR THE URL TO SERVE THIS BUILD ─────────────────────────────────────
# Poll the CONTENT, not the build API. Two ways the API misleads, both observed
# on Bedroom Racers:
#
#   1. `pages/builds/latest` describes the PREVIOUS build for a while after a
#      push, so "status == built" reports success against the build before
#      yours — the check goes green while the old bundle is still being served.
#   2. It also goes stale the other way, sitting on an older commit long after
#      the new content is live, so waiting for the sha times out on a deploy
#      that already worked.
#
# It is used below for exactly one thing: catching an actual build failure so a
# broken deploy fails fast instead of waiting out the clock.
#
# Compared by git's own content hash rather than by byte count, because the
# working copy is CRLF and git stores and serves LF — a byte comparison is off
# by one per line and can never match.
want_blob="$(git rev-parse "HEAD:index.html")"

for i in $(seq 1 24); do
  live="$(curl -sS "$URL?cb=$i" 2>/dev/null | git hash-object --stdin)"
  if [ "$live" = "$want_blob" ]; then
    echo
    echo "live and serving this exact build:"
    echo "  $URL"
    exit 0
  fi
  if command -v gh >/dev/null 2>&1; then
    st="$(gh api "repos/$REPO/pages/builds/latest" --jq '.status' 2>/dev/null)"
    [ "$st" = "errored" ] && { echo "Pages build FAILED" >&2; exit 1; }
  fi
  sleep 10
done

echo "four minutes on and the URL is still serving something else" >&2
echo "  expected ${want_blob:0:12}, serving ${live:0:12}" >&2
echo "  $URL" >&2
exit 1
