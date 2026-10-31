#!/usr/bin/env python3
"""mask-ledger.py — rewrite a QA ledger with every phone masked and every home-directory path made relative.

The repo is public (bd-5gyspy.3). ledger.append_run scrubs each new row on the way in; this applies the same
ledger.scrub to the rows written before that, in place and in order. A row scrub leaves unchanged keeps its line
byte for byte. Idempotent: a second run changes nothing. impact.py does not count a rewritten row as a new run.

Run:  python3 scripts/qa/mask-ledger.py [--check] [path ...]     (default: .claude/qa/ledgers/runs.jsonl)
      --check  rewrite nothing; exit 1 if any row would change.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, ".claude", "qa", "engine", "bin"))   # the shared engine's ledger module, through the link
import ledger  # noqa: E402

DEFAULT = os.path.join(ROOT, ".claude", "qa", "ledgers", "runs.jsonl")


def mask_lines(lines):
    """(new lines, how many changed). A line that is not a JSON object is kept as it is."""
    out, changed = [], 0
    for line in lines:
        body = line.rstrip("\n")
        try:
            row = json.loads(body)
        except ValueError:
            out.append(line)
            continue
        clean = ledger.scrub(row)
        if clean == row:
            out.append(line)
        else:
            out.append(json.dumps(clean, ensure_ascii=False) + ("\n" if line.endswith("\n") else ""))
            changed += 1
    return out, changed


def main(argv):
    check = "--check" in argv
    paths = [a for a in argv if a != "--check"] or [DEFAULT]
    dirty = 0
    for path in paths:
        with open(path, encoding="utf-8") as fh:
            lines = fh.readlines()
        out, changed = mask_lines(lines)
        dirty += changed
        if changed and not check:
            with open(path, "w", encoding="utf-8") as fh:
                fh.writelines(out)
        print("%s: %d of %d row(s) %s" % (os.path.relpath(path, ROOT), changed, len(lines),
                                          "would change" if check else "masked"))
    return 1 if (check and dirty) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
