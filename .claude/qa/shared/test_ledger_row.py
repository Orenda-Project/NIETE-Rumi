#!/usr/bin/env python3
"""test_ledger_row.py — the runs.jsonl row the runner appends per (run × feature).

Run: python3 .claude/qa/shared/test_ledger_row.py
"""
import json, os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ledger, ledger_row  # noqa: E402


def _fixture():
    root = tempfile.mkdtemp()
    run = os.path.join(root, ".claude", "qa", "results", "whatsapp", "niete", "r1")
    os.makedirs(run)
    json.dump({"feature": "menu", "results": [
        {"id": "M01", "verdict": "PASS", "ms": 900}, {"id": "M08", "verdict": "PASS", "ms": 5000},
        {"id": "M09", "verdict": "FAIL", "ms": 5500}, {"id": "M11", "verdict": "SKIP", "ms": 300}]},
        open(os.path.join(run, "menu.json"), "w"))
    open(os.path.join(run, "progress-menu.log"), "w").write(
        "20:49:45.100 REC M01 PASS 1s\n20:49:52.000 REC M08 PASS 5s\n20:49:58.700 REC M09 FAIL 6s\n20:49:59.100 REC M11 SKIP 0s\n")
    open(os.path.join(run, "cassette-misses.jsonl"), "w").write(
        '{"ts":"2026-09-07T20:49:48.000Z","kind":"llm","key":"llm-a"}\n'
        '{"ts":"2026-09-07T20:49:49.000Z","kind":"llm","key":"llm-b"}\n'
        '{"ts":"2026-09-07T20:49:55.000Z","kind":"llm","key":"llm-c"}\n')
    json.dump({"bot_url": "http://127.0.0.1:3100", "mock_url": "http://127.0.0.1:4010", "worktree": "/w", "lock_blob": "abc"},
              open(os.path.join(run, "stack.json"), "w"))
    os.makedirs(os.path.join(root, ".claude", "qa", "ledgers"))
    return root, run


class A:  # argparse stand-in
    def __init__(self, **kw): self.__dict__.update(kw)


def _row(root, run, **over):
    kw = dict(root=root, run_dir=run, feature="menu", run_id="r1", env="sandbox", method="mock", seconds="91",
              driver="923000000001", trigger="commit", commit="a" * 40, spec_sync="none", validator_exit="0")
    kw.update(over)
    return ledger_row.build_row(A(**kw))


def test_row_is_valid_against_the_frozen_schema():
    root, run = _fixture()
    assert ledger.validate_run(_row(root, run)) == []


def test_row_carries_method_commit_and_the_summary():
    root, run = _fixture()
    r = _row(root, run)
    assert r["method"] == "mock" and r["env"] == "sandbox" and r["commit_sha"] == "a" * 40
    assert r["summary"] == {"total": 4, "passed": 2, "failed": 1, "blocked": 0, "skipped": 1}
    assert r["spec_sync"] == {"brief": None, "validator_exit": 0}
    assert r["stack"]["bot_url"] == "http://127.0.0.1:3100"


def test_cassette_misses_make_the_row_critical_and_name_the_scenarios_they_hit():
    # Misses at :48 and :49 land before M08's REC at :52 → M08; the one at :55 → M09. A PASS that
    # ran without a recorded vendor answer is not a trustworthy PASS, and the row must say which.
    root, run = _fixture()
    r = _row(root, run)
    assert r["status"] == "CRITICAL", r["status"]
    assert r["cassette"]["misses"] == 3
    assert r["cassette"]["scenarios_affected"] == ["M08", "M09"], r["cassette"]
    assert r["cassette"]["by_scenario"] == {"M08": 2, "M09": 1}


def test_no_misses_means_healthy_when_nothing_failed():
    root, run = _fixture()
    os.remove(os.path.join(run, "cassette-misses.jsonl"))
    json.dump({"feature": "menu", "results": [{"id": "M01", "verdict": "PASS", "ms": 1}]}, open(os.path.join(run, "menu.json"), "w"))
    r = _row(root, run)
    assert r["status"] == "HEALTHY" and r["cassette"]["misses"] == 0 and r["cassette"]["scenarios_affected"] == []


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn(); print("PASS", fn.__name__)
        except Exception as e:
            failed += 1; print("FAIL", fn.__name__, "->", type(e).__name__, e)
    print("\n%d/%d passed" % (len(fns) - failed, len(fns)))
    raise SystemExit(1 if failed else 0)
