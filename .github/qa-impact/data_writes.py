#!/usr/bin/env python3
"""data_writes.py — which database writes did a commit touch? (bd-5b3u70.11, the data E2E strategy)

WHY THIS EXISTS. The data E2E checks (engine 2.3.0: api.rows / snapshot / dataRules) make a scenario check what the
bot SAVED, not only what it showed. They were first added by hand, to registration. For every later change the spec
sync is the author, so the brief has to tell it when a commit changes what the bot saves: then the scenario that
covers that behaviour gets a plain-word data step ("…is saved", "…is updated", "…is removed") and the table goes into
the repo's .claude/qa/config/data-keys.json (gherkin-spec-sync §1, `data_writes[]`).

WHAT IS A WRITE. A supabase-js chain `.from('<table>')` … `.insert(` / `.update(` / `.upsert(` / `.delete(`, the
chain read up to its `;` (it may span lines), in a bot source file the change touched — added, changed or deleted
lines inside the chain. Tests, specs, docs, scripts and the harness (.claude/) are not the bot's writes. A read
(`.select(` alone) is not a write. An `.rpc(` can write but says nothing about the table, so it is not judged.

WHAT IT CANNOT SEE. A change that saves through an existing helper without touching the write itself (main bot
8824de698 now calls the roster's add-student save on Finish): the write chain did not change, so nothing is found.
The spec sync still sees that change through the feature's diff; this finding only adds the writes it can name. A
write in a SHARED file (flow-response.handler.js, which every feature's map pulls in) names no feature: the brief
says so, and the sync finds the feature it belongs to.

    python3 data_writes.py [--root <repo>] [--head <rev>] [--base <rev>] [--json]

Each finding: { file, line (of `.from`), table, op, watched } — `watched` is whether data-keys.json names the table.
Exit 0 always: it is a finding for the brief, not a gate.
"""
import argparse
import json
import os
import re
import subprocess
import sys

CODE = re.compile(r"\.(c|m)?[jt]s$")
NOT_BOT = re.compile(r"(^|/)(tests?|__tests__|__mocks__|specs?|docs|scripts|node_modules|\.claude|\.github)/|\.test\.|\.spec\.")
FROM = re.compile(r"\.from\(\s*['\"`]([\w.]+)['\"`]\s*\)")
OP = re.compile(r"\.\s*(insert|update|upsert|delete)\s*\(")
NEXT_FROM = re.compile(r"\.from\(")


def _git(root, *a):
    r = subprocess.run(["git", "-C", root, *a], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""


def touched_lines(root, base, head, path):
    """Line numbers in `head`'s version of `path` that the change added or changed, plus the line after a deletion."""
    out, lines = _git(root, "diff", "-U0", base, head, "--", path), set()
    for m in re.finditer(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", out, re.M):
        start, count = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
        lines.update(range(start, start + count) if count else (start, start + 1))
    return lines


def writes_in(text):
    """[(from_line, end_line, table, op)] for every write chain in `text`."""
    found = []
    for m in FROM.finditer(text):
        rest = text[m.end():]
        # the chain ends at its `;` or at the next `.from(`, whichever comes first
        nxt = NEXT_FROM.search(rest)
        ends = [i for i in (rest.find(";"), nxt.start() if nxt else -1) if i >= 0]
        stop = min(ends) if ends else len(rest)
        chain = rest[:stop]
        op = OP.search(chain)
        if not op:
            continue
        start = text.count("\n", 0, m.start()) + 1
        end = text.count("\n", 0, m.end() + stop) + 1
        found.append((start, end, m.group(1), op.group(1)))
    return found


def watched_tables(root):
    try:
        with open(os.path.join(root, ".claude/qa/config/data-keys.json")) as fh:
            return set(json.load(fh))
    except (OSError, ValueError):
        return set()


def check(root, head="HEAD", base="HEAD^1"):
    watched = watched_tables(root)
    out = []
    for path in _git(root, "diff", "--name-only", "--diff-filter=AMR", base, head).splitlines():
        if not CODE.search(path) or NOT_BOT.search(path):
            continue
        text = _git(root, "show", "%s:%s" % (head, path))
        if not text:
            continue
        lines = touched_lines(root, base, head, path)
        for start, end, table, op in writes_in(text):
            if any(start <= n <= end for n in lines):
                out.append({"file": path, "line": start, "table": table, "op": op, "watched": table in watched})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", default=".")
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--base", default="HEAD^1")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    found = check(a.root, a.head, a.base)
    if a.json:
        print(json.dumps(found, indent=2))
    else:
        for f in found:
            print("%s:%d  %s %s%s" % (f["file"], f["line"], f["op"], f["table"], "" if f["watched"] else "  (not in data-keys.json)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
