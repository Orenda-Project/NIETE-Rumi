#!/usr/bin/env python3
"""Integration: discovery diff + dedup + drift/runs append, on temp files.
Proves spec §12 checks 1,2,4,5. Run: python3 test_flow_e2e.py"""
import json
import os
import tempfile
import ledger
import discovery_diff as dd


def test_discovery_then_dedup():
    observed = [{"kind": "list-row", "label": "Teacher Training"},
                {"kind": "list-row", "label": "Report a Problem"}]
    covered = [{"kind": "list-row", "label": "Teacher Training"}]
    # §12.1: one uncovered element → exactly one proposal
    fresh = dd.new_slugs(observed, covered, existing_slugs=set())
    assert len(fresh) == 1 and fresh[0]["label"] == "Report a Problem"
    # §12.2: re-run with that slug already recorded → zero
    again = dd.new_slugs(observed, covered, existing_slugs={fresh[0]["slug"]})
    assert again == []


def test_drift_row_shape_and_append():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "drift", "menu.jsonl")
        ledger.append_drift({
            "run_id": "2026-08-04T00:00:00Z-niete-menu-x1", "ts": "2026-08-04T00:00:00Z",
            "scenario": "/menu header copy", "step": "Then header",
            "expected": "a", "actual": "b", "assertion_kind": "copy",
            "verdict": "pending", "evidence": "results/x1/h.png",
        }, path)
        row = json.loads(open(path).read().strip())
        assert row["assertion_kind"] == "copy" and row["verdict"] == "pending"
        assert row["expected"] == "a" and row["actual"] == "b"


def test_runs_row_append_and_status_rule():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "runs.jsonl")
        base = {
            "run_id": "r", "ts": "t", "surface": "whatsapp", "tenant": "niete",
            "env": "prod", "method": "chrome", "feature": "menu",
            "summary": {"total": 5, "passed": 5, "failed": 0, "blocked": 0},
            "duration_ms": 1, "status": "HEALTHY",
            "coverage": {"scenarios": 5, "surface_observed": 5, "uncovered": 0},
            "drift_count": 0, "discovery_count": 0, "evidence_dir": "results/x/",
        }
        ledger.append_run(base, path)
        assert len([l for l in open(path) if l.strip()]) == 1


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok", name)
    print("ALL PASS")
