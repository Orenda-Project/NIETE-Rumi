#!/usr/bin/env bash
# profile-dashboard.sh — serve the mock-lane profiling dashboard locally (bd-5zzbvq).
#
#   bash .claude/qa/shared/profile-dashboard.sh [port]      # default 8765
#
# Static files only: the dashboard (shared/profile-dashboard.html) and the published profiles
# (.claude/qa/profiles/*.json + index.json, written by profile_run.py after every mock-lane feature).
# Nothing leaves the machine. Ctrl-C stops it.
set -uo pipefail
QA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-8765}"
[ -f "$QA/profiles/index.json" ] || echo "profile-dashboard: no $QA/profiles/index.json yet — run the mock lane first (npm run e2e:mock -- menu), or build one: python3 .claude/qa/shared/profile_run.py <run_dir> --publish .claude/qa/profiles" >&2
echo "Mock Lane Profiler → http://127.0.0.1:$PORT/shared/profile-dashboard.html"
exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$QA"
