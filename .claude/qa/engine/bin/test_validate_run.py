#!/usr/bin/env python3
"""Stdlib assert tests for validate-run's handling of incomplete run dirs.

Run: python3 test_validate_run.py

WHY (found while verifying the suite, 2026-08-26): validate-run.py raised a raw
FileNotFoundError traceback whenever a run dir had no PER-SCENARIO.md — which is **66 of
the 72 run dirs on disk**, because a run that stops early (QR screen, crash, parked) never
writes one.

That is the same failure class the harness exists to prevent. SCHEDULE.md guard 3 says it
outright: "An empty run directory reads as 'no problems found', which is the worst possible
way for a QA schedule to fail." A traceback is only marginally better — it tells the reader
the tool broke, not that the RUN produced nothing.

Pre-existing (commit b51a724), not introduced by the cost gate.
"""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
VR = os.path.join(HERE, "validate-run.py")


def _run(run_dir, *extra):
    return subprocess.run([sys.executable, VR, run_dir, *extra],
                          capture_output=True, text=True)


def test_a_missing_per_scenario_file_is_a_clear_message_not_a_traceback():
    out = _run(tempfile.mkdtemp(), "--features", "menu")
    combined = out.stdout + out.stderr
    assert "Traceback" not in combined, combined
    assert "PER-SCENARIO.md" in combined, combined


def test_a_missing_per_scenario_file_still_exits_nonzero():
    """It must not read as a pass — nothing was validated."""
    assert _run(tempfile.mkdtemp(), "--features", "menu").returncode != 0


def test_a_nonexistent_run_dir_is_also_handled():
    out = _run(os.path.join(tempfile.mkdtemp(), "no-such-run"), "--features", "menu")
    assert "Traceback" not in (out.stdout + out.stderr), out.stdout + out.stderr
    assert out.returncode != 0


def test_an_empty_per_scenario_file_is_reported_too():
    """A zero-byte file parses to zero rows, which would otherwise print a cheerful
    'complete and consistent (0 scenarios)'."""
    d = tempfile.mkdtemp()
    open(os.path.join(d, "PER-SCENARIO.md"), "w").close()
    out = _run(d, "--features", "menu")
    combined = out.stdout + out.stderr
    assert "Traceback" not in combined, combined
    assert out.returncode != 0, combined


def test_a_real_complete_run_still_validates_as_before():
    """The regression guard: the fix must not change behaviour on a run that HAS the file."""
    repo = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
    real = os.path.join(repo, ".claude/qa/results/whatsapp/niete/20260824-1004")
    if not os.path.exists(os.path.join(real, "PER-SCENARIO.md")):
        return                                    # not present in this checkout
    out = _run(real, "--features", "registration,menu,training,lesson-plan")
    assert "Traceback" not in (out.stdout + out.stderr)
    assert "coverage" in out.stdout


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok", name)
    print("ALL PASS")
