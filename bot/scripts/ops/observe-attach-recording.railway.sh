#!/usr/bin/env bash
# bd-twyobl (queue #289) — run observe-attach-recording.js INSIDE a NIETE Railway worker container (deployed code, its
# env, internal Redis, ffprobe), with the recording sent over the same ssh stream. Nothing runs locally but tar.
#
#   observe-attach-recording.railway.sh <production|staging|sandbox> <plan|apply|status|undo> [recording.opus]
#   env: SCHEDULE_ID, EXPECT_TEACHER_ID (plan/apply/undo), SESSION_ID (status/undo), WAIT_SECONDS (apply, default 900)
#
# EXPECT_SHA256 is computed here from the file you pass, so the container refuses any other bytes.
# `railway ssh` joins its arguments into ONE remote shell line (a `sh -c "…"` wrapper runs only its first word),
# so the remote command is passed as a single string. Its API lookups fail intermittently with "dns error": retried.
set -euo pipefail
ENVNAME=${1:?environment}; MODE=${2:?mode}; AUDIO=${3:-}
case "$ENVNAME" in
  production) PROJECT=bcc5a6a9-02e6-4d1f-8fff-1fe5eb5626df ;;
  staging|sandbox) PROJECT=0aef0655-1f90-4aab-9cca-e4daec46f2b4 ;;
  *) echo "unknown environment: $ENVNAME" >&2; exit 64 ;;
esac
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
cp "$HERE/observe-attach-recording.js" "$WORK/"
SHA=""
if [ -n "$AUDIO" ]; then
  cp "$AUDIO" "$WORK/rec.ogg"
  SHA=$(sha256sum "$WORK/rec.ogg" | cut -c1-64)
fi
DIR="/tmp/oar-$(date +%s)"
INPUT=""; [ -n "$AUDIO" ] && INPUT="< $DIR/rec.ogg"
REMOTE="mkdir -p $DIR && cd $DIR && tar xzf - && cd /app/bot && MODE=$MODE BOT_ROOT=/app/bot \
SCHEDULE_ID=${SCHEDULE_ID:-} EXPECT_TEACHER_ID=${EXPECT_TEACHER_ID:-} EXPECT_SHA256=$SHA SESSION_ID=${SESSION_ID:-} \
WAIT_SECONDS=${WAIT_SECONDS:-900} FORCE=${FORCE:-} node $DIR/observe-attach-recording.js $INPUT"
LOG="$WORK/run.log"
for attempt in 1 2 3 4 5; do
  tar czf - -C "$WORK" observe-attach-recording.js $( [ -n "$AUDIO" ] && echo rec.ogg ) \
    | railway ssh -i "${RAILWAY_SSH_KEY:-$HOME/.ssh/railway_hafat}" -p "$PROJECT" -e "$ENVNAME" -s sqs-worker -- "$REMOTE" >"$LOG" 2>&1 || true
  grep -q "dns error" "$LOG" || break
  sleep 5
done
# The script's own lines, unescaped; nothing else from the container.
grep -o '\[attach\][^"]*\("[^"]*\)*' "$LOG" | sed 's/\\"/"/g' || cat "$LOG"
grep -q '\[attach\] \(DONE\|UNDONE\|plan_only\)' "$LOG"
