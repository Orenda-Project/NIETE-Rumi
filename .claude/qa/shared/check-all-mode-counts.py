#!/usr/bin/env python3
"""Consistency CHECK (not a test run): /niete-e2e `all` must claim the REAL per-feature
@e2e counts.  Run: python3 .claude/qa/shared/check-all-mode-counts.py

⚠️ This drives NOTHING. It opens no WhatsApp session and executes no scenario — it takes
about a second. It only compares the scenario counts hard-coded in the `all` spec of
.claude/commands/niete-e2e.md against what parse-gherkin finds in the .feature files.
To actually run the suite you drive the bot: `/niete-e2e all` (or `/niete-e2e <feature>`).
Deliberately NOT named `test_*` so it is never mistaken for the E2E suite, and because the
`test_*` files here are unit tests of importable modules; this is a standalone doc lint.

Scope is deliberately narrow — this checks ONE thing a reader cannot: that the scenario
counts hard-coded in the `all` spec still equal what the .feature files contain. The tag
POLICY in that doc is prose and is reviewed as prose; asserting its wording here would
only break on rewording without proving anything.

Regression cover for bd-2766. The `all` spec in .claude/commands/niete-e2e.md carries a
per-feature scenario count and tells the runner "if your run touched fewer than the
parse-gherkin count for a feature, you have not run `all`". Those numbers had drifted to
the SAFE-subset counts (training said 14 of its 23), so a runner who honoured the doc
silently skipped every @wip/@draft scenario while believing the run was exhaustive.
"""
import json
import os
import re
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CMD = os.path.join(ROOT, ".claude", "commands", "niete-e2e.md")
FEATURES = os.path.join(ROOT, "tests", "features", "whatsapp", "niete")

# Excluded from `all`, run by NAME only (operator, 2026-08-18): attendance is all @wip and
# needs the principal persona; observe is all @config-gated/@first-use and needs
# role_switch.enabled, which is false. Coaching IS in `all` — slow (real audio + ~10 min
# analysis per scenario), but in scope.
RUN_BY_NAME_ONLY = {"attendance", "observe"}


def _claimed_counts(text):
    """Pull `**menu 13 · training 23 · ...**` out of the `all` spec."""
    m = re.search(r"runnable scenarios\*\*:\s*\*\*(.+?)\*\*", text, re.S)
    if not m:
        return {}
    return {n: int(c) for n, c in re.findall(r"([a-z-]+)\s+(\d+)", m.group(1))}


def _stated_total(text):
    """Pull the `87` out of `That is **87 runnable scenarios**`."""
    m = re.search(r"That is \*\*~?(\d+) runnable scenarios\*\*", text)
    return int(m.group(1)) if m else None


def _actual_count(feature):
    path = os.path.join(FEATURES, "%s.feature" % feature)
    out = subprocess.run(
        ["python3", os.path.join(HERE, "parse-gherkin.py"), path, "--tag", "@e2e"],
        capture_output=True, text=True, cwd=ROOT)
    return json.loads(out.stdout)["count"]


def check_count_line_is_parseable():
    counts = _claimed_counts(open(CMD, encoding="utf-8").read())
    assert counts, "could not find the per-feature count list in the `all` spec"
    assert "training" in counts, counts


def check_claimed_counts_match_the_feature_files():
    """The heart of bd-2766: doc numbers must equal the real @e2e counts."""
    claimed = _claimed_counts(open(CMD, encoding="utf-8").read())
    bad = []
    for feature, n in sorted(claimed.items()):
        if not os.path.isfile(os.path.join(FEATURES, "%s.feature" % feature)):
            continue
        actual = _actual_count(feature)
        if actual != n:
            bad.append("%s: doc says %d, file has %d" % (feature, n, actual))
    assert not bad, "`all` count list is stale -> `all` would under-run: " + "; ".join(bad)


def check_training_all_is_the_full_file_not_the_safe_subset():
    """Training is the case that bit us: 23 total, 9 of them @wip/@draft."""
    claimed = _claimed_counts(open(CMD, encoding="utf-8").read())
    assert claimed.get("training") == _actual_count("training")
    assert claimed.get("training", 0) > 14, (
        "training count is back at the safe-subset value; `all` must include @wip/@draft")


def check_all_excludes_the_run_by_name_features():
    """`all` covers six features. coaching/attendance/observe are named-only, so listing one
    in the count line would quietly pull it back into `all`."""
    claimed = _claimed_counts(open(CMD, encoding="utf-8").read())
    leaked = sorted(RUN_BY_NAME_ONLY & set(claimed))
    assert not leaked, (
        "%s listed in the `all` count line, but that runs by NAME only — listing it there puts "
        "it back into `all`" % ", ".join(leaked))


def check_stated_total_equals_the_sum_of_the_parts():
    """The headline number and the per-feature list must not drift apart."""
    text = open(CMD, encoding="utf-8").read()
    claimed, total = _claimed_counts(text), _stated_total(text)
    assert total is not None, "could not find the 'That is **N runnable scenarios**' total"
    assert total == sum(claimed.values()), (
        "`all` total says %d but the per-feature list sums to %d (%s)"
        % (total, sum(claimed.values()), claimed))


def check_report_section_quotes_the_same_total():
    """§3 tells the reporter how many scenarios to account for. That number now lives in
    TWO places (the `all` spec and the Report section) — exactly the duplication that let
    bd-2766 rot. Keep them equal."""
    text = open(CMD, encoding="utf-8").read()
    total = _stated_total(text)
    m = re.search(r"must account for \*\*all (\d+)\*\*", text)
    assert m, "§3 no longer states how many scenarios the report must account for"
    assert int(m.group(1)) == total, (
        "§3 says the report must account for %s, but the `all` spec says %s"
        % (m.group(1), total))


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("check_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print("PASS", fn.__name__)
        except Exception as e:
            failed += 1
            print("FAIL", fn.__name__, "->", type(e).__name__, e)
    print("\n%d/%d checks passed" % (len(fns) - failed, len(fns)))
    raise SystemExit(1 if failed else 0)
