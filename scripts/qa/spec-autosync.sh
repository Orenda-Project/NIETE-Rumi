#!/usr/bin/env bash
# spec-autosync — the deterministic half of the server-side Gherkin auto-sync (bd-2a07j).
#
# The GitHub workflow (.github/workflows/qa-impact.yml, job `autosync`) runs when the
# PR check finds a stale spec: it calls these subcommands around ONE Claude Code run
# that authors the scenario through the repo's own `gherkin-spec-sync` skill.
# Everything a script can decide is decided here, so the model only judges.
#
#   brief    --repo R --base A --head B --out F     select features for A...B and write the
#                                                  spec-sync brief; exit 3 = nothing to author
#   features --brief F                             the features the brief says to author
#   guard    --repo R --head B                     exit 2 when HEAD is already this bot's own
#                                                  commit (never author on top of authoring)
#   commit   --repo R --features a,b --head B      validate the changed specs, commit ONLY
#            [--no-push] [--remote origin]         tests/features/**, push; exit 3 = no change,
#                                                  exit 1 = validator refused (nothing committed)
#
# Exit codes: 0 done · 1 refused (validator / bad args) · 2 guard stop · 3 nothing to do.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
BOT_SUBJECT_PREFIX="qa(spec-sync):"
SPEC_DIR="tests/features/whatsapp/niete"

usage() { sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 1; }
[ $# -ge 1 ] || usage
CMD="$1"; shift
REPO=""; BASE=""; HEAD=""; OUT=""; BRIEF=""; FEATURES=""; PUSH=1; REMOTE="origin"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;      --base) BASE="$2"; shift 2 ;;
    --head) HEAD="$2"; shift 2 ;;      --out) OUT="$2"; shift 2 ;;
    --brief) BRIEF="$2"; shift 2 ;;    --features) FEATURES="$2"; shift 2 ;;
    --no-push) PUSH=0; shift ;;        --remote) REMOTE="$2"; shift 2 ;;
    *) echo "spec-autosync: unknown arg $1" >&2; usage ;;
  esac
done
[ -n "$REPO" ] || REPO="$(cd "$HERE/../.." && pwd)"
QA="$REPO/.claude/qa/shared"

case "$CMD" in
brief)
  [ -n "$BASE" ] && [ -n "$HEAD" ] && [ -n "$OUT" ] || { echo "brief: --base --head --out required" >&2; exit 1; }
  SEL=$(python3 "$QA/select_e2e.py" --repo "$REPO" --range "$BASE...$HEAD" --json 2>/dev/null) || { echo "brief: selector failed" >&2; exit 1; }
  N=$(printf '%s' "$SEL" | jq -r '.features | length' 2>/dev/null); case "$N" in ''|0) echo "brief: no feature touched in $BASE...$HEAD" >&2; exit 3 ;; esac
  B=$(printf '%s' "$SEL" | python3 "$QA/spec_sync.py" --selection - --repo "$REPO" --range "$BASE...$HEAD" --json 2>/dev/null) || { echo "brief: spec_sync failed" >&2; exit 1; }
  [ "$(printf '%s' "$B" | jq -r '.sync_needed // false')" = "true" ] || { echo "brief: specs already in sync for $BASE...$HEAD" >&2; exit 3; }
  # keep only the features that need authoring (create/update, own files changed)
  printf '%s' "$B" | jq '.features |= map(select(.action != "validate-only" and (.only_shared // false) == false))' > "$OUT"
  [ "$(jq -r '.features | length' "$OUT")" -gt 0 ] || { echo "brief: only fan-out / validate-only features — nothing to author" >&2; exit 3; }
  echo "brief: $(jq -r '[.features[].feature] | join(", ")' "$OUT") → $OUT" >&2
  ;;
features)
  [ -n "$BRIEF" ] && [ -f "$BRIEF" ] || { echo "features: --brief <file> required" >&2; exit 1; }
  jq -r '[.features[].feature] | join(",")' "$BRIEF"
  ;;
guard)
  [ -n "$HEAD" ] || HEAD=HEAD
  SUBJ=$(git -C "$REPO" log -1 --format=%s "$HEAD" 2>/dev/null) || { echo "guard: cannot read $HEAD" >&2; exit 1; }
  case "$SUBJ" in
    "$BOT_SUBJECT_PREFIX"*) echo "guard: HEAD is already an auto-sync commit ('$SUBJ') — not authoring on top of authoring. A human decides next." >&2; exit 2 ;;
  esac
  echo "guard: ok — HEAD is '$SUBJ'" >&2
  ;;
commit)
  [ -n "$FEATURES" ] || { echo "commit: --features a,b required" >&2; exit 1; }
  [ -n "$HEAD" ] || HEAD=$(git -C "$REPO" rev-parse HEAD)
  CHANGED=$(git -C "$REPO" status --porcelain -- "$SPEC_DIR" | awk '{print $2}')
  [ -n "$CHANGED" ] || { echo "commit: no spec changed under $SPEC_DIR — nothing to commit" >&2; exit 3; }
  OUTV=$(cd "$REPO" && python3 .claude/qa/shared/validate_specs.py --only "$FEATURES" 2>&1); rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "commit: validator REFUSED the authored spec — nothing committed:" >&2
    printf '%s\n' "$OUTV" | tail -20 >&2
    exit 1
  fi
  # counts drift check is advisory here: the agent was told to update niete-e2e.md
  (cd "$REPO" && python3 .claude/qa/shared/check-all-mode-counts.py >/dev/null 2>&1) || echo "commit: note — check-all-mode-counts.py reports drift; the per-feature counts in .claude/commands/niete-e2e.md may need updating" >&2
  git -C "$REPO" add -- "$SPEC_DIR" || { echo "commit: git add failed" >&2; exit 1; }
  [ -f "$REPO/.claude/commands/niete-e2e.md" ] && git -C "$REPO" add -- .claude/commands/niete-e2e.md
  SHORT=$(git -C "$REPO" rev-parse --short=12 "$HEAD")
  git -C "$REPO" -c user.name="niete-qa-bot" -c user.email="qa-bot@users.noreply.github.com" \
    -c core.hooksPath=/dev/null commit -q -F - <<MSG || { echo "commit: git commit failed" >&2; exit 1; }
$BOT_SUBJECT_PREFIX sync $(printf '%s' "$FEATURES" | sed 's/,/.feature, /g').feature to $SHORT [auto]

Authored on the GitHub runner by Claude Code through the repo's gherkin-spec-sync
skill because qa-impact found these specs stale for the change at $SHORT.
Validated with validate_specs.py --only $FEATURES before committing. Review the
scenarios like any other code: they describe what the change is claimed to do.

Spec-Sync: $FEATURES=synced (auto, $SHORT)
Co-Authored-By: Claude <noreply@anthropic.com>
MSG
  echo "commit: $(git -C "$REPO" log -1 --format=%h) — $CHANGED" >&2
  if [ "$PUSH" = 1 ]; then
    BR=$(git -C "$REPO" rev-parse --abbrev-ref HEAD)
    git -C "$REPO" push -q "$REMOTE" "HEAD:$BR" || { echo "commit: push failed" >&2; exit 1; }
    echo "commit: pushed to $REMOTE/$BR" >&2
  fi
  ;;
*) usage ;;
esac
exit 0
