#!/usr/bin/env bash
# Verify the vendored data-standards skill still matches its own receipt.
#
# The skill under tools/data-standards/ is owned by the Data Team in
# Orenda-Project/agent-skills-taleemabad and is vendored here VERBATIM. Nobody
# in this repo edits it — this script is what proves that claim, and it runs in
# CI so a local edit can't land silently.
#
#   ./scripts/data-standards-verify.sh            # verify (exit 1 on mismatch)
#   ./scripts/data-standards-verify.sh --update   # regenerate after refreshing
#                                                 # from upstream (see docs)
#
# Refreshing from upstream is a manual step for anyone who has the pack cloned:
#   rsync -a --exclude __pycache__ --exclude '*.pyc' \
#     <pack>/skills/data-standards/ tools/data-standards/
#   ./scripts/data-standards-verify.sh --update
#
# __pycache__ is excluded everywhere on purpose: running the validator once
# creates a .pyc that would otherwise read as upstream drift.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2

MODE="${1:-verify}"
exec python3 - "$MODE" <<'PY'
import hashlib, json, sys, time, subprocess
from pathlib import Path

mode = sys.argv[1]
# The receipt lives OUTSIDE the skill directory on purpose: that directory is
# the Data Team's, vendored verbatim, and must contain nothing we authored.
root = Path("tools/data-standards")
receipt = Path("tools/data-standards.upstream.json")

if not root.is_dir():
    print("data-standards: vendored skill missing at", root, file=sys.stderr)
    sys.exit(2)

files = {}
for p in sorted(root.rglob("*")):
    if not p.is_file() or "__pycache__" in p.parts :
        continue
    files[str(p.relative_to(root))] = hashlib.sha256(p.read_bytes()).hexdigest()

rollup = hashlib.sha256(
    "".join(f"{k}:{v}\n" for k, v in sorted(files.items())).encode()
).hexdigest()

if mode == "--update":
    prev = json.loads(receipt.read_text()) if receipt.exists() else {}
    sha = prev.get("source_commit", "unknown")
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"],
                             cwd=Path.home() / "Documents/agent-skills-taleemabad",
                             capture_output=True, text=True)
        if out.returncode == 0:
            sha = out.stdout.strip()
    except OSError:
        pass
    receipt.write_text(json.dumps({
        "_comment": prev.get("_comment", "Receipt for the vendored data-standards skill. "
                    "Owned by the Data Team — NEVER edit files under this directory."),
        "source_repo": "Orenda-Project/agent-skills-taleemabad",
        "source_path": "skills/data-standards",
        "source_commit": sha,
        "vendored_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "file_count": len(files),
        "rollup_sha256": rollup,
        "files": files,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"data-standards: receipt updated — {len(files)} files, rollup {rollup[:16]}…")
    sys.exit(0)

if not receipt.exists():
    print("data-standards: no .upstream receipt — run --update", file=sys.stderr)
    sys.exit(2)

want = json.loads(receipt.read_text())
if want.get("rollup_sha256") == rollup and want.get("files") == files:
    print(f"data-standards: vendored skill matches its receipt "
          f"({len(files)} files, upstream {str(want.get('source_commit'))[:12]}) OK")
    sys.exit(0)

print("data-standards: VENDORED SKILL DOES NOT MATCH ITS RECEIPT", file=sys.stderr)
print("This directory is owned by the Data Team and must stay verbatim.", file=sys.stderr)
for k in sorted(set(files) | set(want.get("files", {}))):
    a, b = want.get("files", {}).get(k), files.get(k)
    if a != b:
        state = "added locally" if a is None else "deleted locally" if b is None else "modified locally"
        print(f"  {state}: {k}", file=sys.stderr)
print("", file=sys.stderr)
print("If you refreshed from upstream on purpose, re-run with --update.", file=sys.stderr)
sys.exit(1)
PY
