#!/usr/bin/env python3
"""Stdlib assert tests for ledger. Run: python3 test_ledger.py"""
import json
import os
import tempfile
import ledger


def _valid_run():
    return {
        "run_id": "2026-08-04T14:22:10Z-niete-menu-14f2",
        "ts": "2026-08-04T14:22:10Z",
        "surface": "whatsapp", "tenant": "niete", "env": "prod",
        "method": "chrome", "feature": "menu",
        "summary": {"total": 12, "passed": 12, "failed": 0, "blocked": 0},
        "duration_ms": 84210, "status": "HEALTHY",
        "coverage": {"scenarios": 12, "surface_observed": 12, "uncovered": 0},
        "drift_count": 0, "discovery_count": 0,
        "evidence_dir": "results/whatsapp/niete/14f2/",
    }


def _valid_drift():
    return {
        "run_id": "2026-08-04T14:22:10Z-niete-menu-14f2",
        "ts": "2026-08-04T14:22:10Z",
        "scenario": "/menu header copy", "step": "Then the header is ...",
        "expected": "Here's what I can do!", "actual": "Here's how I can help!",
        "assertion_kind": "copy", "verdict": "pending",
        "evidence": "results/whatsapp/niete/14f2/menu-rows.png",
    }


def test_valid_run_passes():
    assert ledger.validate_run(_valid_run()) == []


def test_run_missing_key_flagged():
    r = _valid_run(); del r["status"]
    probs = ledger.validate_run(r)
    assert any("status" in p for p in probs)


def test_run_bad_status_flagged():
    r = _valid_run(); r["status"] = "GREEN"
    assert any("status" in p for p in ledger.validate_run(r))


def test_run_bad_summary_type_flagged():
    r = _valid_run(); r["summary"]["passed"] = "twelve"
    assert any("summary.passed" in p for p in ledger.validate_run(r))


def test_valid_drift_passes():
    assert ledger.validate_drift(_valid_drift()) == []


def test_drift_bad_verdict_flagged():
    d = _valid_drift(); d["verdict"] = "maybe"
    assert any("verdict" in p for p in ledger.validate_drift(d))


def test_append_run_writes_one_line():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "runs.jsonl")
        ledger.append_run(_valid_run(), path)
        ledger.append_run(_valid_run(), path)
        lines = [l for l in open(path) if l.strip()]
        assert len(lines) == 2
        assert json.loads(lines[0])["feature"] == "menu"


def test_append_run_rejects_invalid():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "runs.jsonl")
        bad = _valid_run(); bad["status"] = "NOPE"
        raised = False
        try:
            ledger.append_run(bad, path)
        except ValueError as e:
            raised = True; assert "status" in str(e)
        assert raised
        assert not os.path.exists(path)  # nothing written on invalid


def _git_repo(tmp):
    import subprocess
    subprocess.run(["git", "-C", tmp, "init", "-q"], check=True)
    subprocess.run(["git", "-C", tmp, "-c", "user.email=t@l", "-c", "user.name=t",
                    "commit", "-q", "--allow-empty", "-m", "x"], check=True)
    return subprocess.run(["git", "-C", tmp, "rev-parse", "--short=12", "HEAD"],
                          capture_output=True, text=True).stdout.strip()


def test_append_run_stamps_the_commit_it_ran_from():
    """impact.py's proof is 'a row for this feature was added in the range'; without
    the commit on the row a run against an OLDER build counted. Stamp HEAD of the
    repo the ledger lives in unless the caller already said which commit."""
    with tempfile.TemporaryDirectory() as tmp:
        sha = _git_repo(tmp)
        path = os.path.join(tmp, ".claude", "qa", "ledgers", "runs.jsonl")
        ledger.append_run(_valid_run(), path)
        row = json.loads(open(path).read().splitlines()[0])
        assert row["commit"] == sha, row


def test_append_run_keeps_an_explicit_commit():
    with tempfile.TemporaryDirectory() as tmp:
        _git_repo(tmp)
        path = os.path.join(tmp, "runs.jsonl")
        r = _valid_run(); r["commit"] = "52f18e65abcd"
        ledger.append_run(r, path)
        assert json.loads(open(path).read())["commit"] == "52f18e65abcd"


def test_append_run_outside_git_has_no_commit_key():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "runs.jsonl")
        ledger.append_run(_valid_run(), path)
        assert "commit" not in json.loads(open(path).read())


def test_validate_run_rejects_a_non_string_commit():
    r = _valid_run(); r["commit"] = 123
    assert any("commit" in p for p in ledger.validate_run(r))


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok", name)
    print("ALL PASS")
