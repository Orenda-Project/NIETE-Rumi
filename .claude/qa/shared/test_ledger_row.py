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


def test_misses_from_an_earlier_feature_in_the_same_run_are_not_this_features():
    # language ran 20:53–20:55 and missed 9 times; status started 20:55:49. The miss log is per RUN,
    # so status must count only misses inside ITS window — the first live run stamped status CRITICAL
    # with language's misses (2026-09-07).
    root, run = _fixture()
    open(os.path.join(run, "progress-menu.log"), "w").write(
        "20:55:49.000 send START \"/menu\"\n20:55:52.000 REC M01 PASS 3s\n")
    open(os.path.join(run, "cassette-misses.jsonl"), "w").write(
        '{"ts":"2026-09-07T20:54:10.000Z","kind":"llm","key":"llm-earlier-feature"}\n')
    json.dump({"feature": "menu", "results": [{"id": "M01", "verdict": "PASS", "ms": 1}]}, open(os.path.join(run, "menu.json"), "w"))
    r = _row(root, run)
    assert r["cassette"]["misses"] == 0, r["cassette"]
    assert r["cassette"]["misses_in_run"] == 1
    assert r["status"] == "HEALTHY", r["status"]


def test_dirty_ignores_the_ledger_and_run_artifacts_the_runner_itself_writes():
    import subprocess
    root, run = _fixture()
    subprocess.run(["git", "init", "-q", root], check=True)
    g = lambda *a: subprocess.run(["git", "-C", root, "-c", "user.email=t@t", "-c", "user.name=t", *a], check=True, capture_output=True)  # noqa: E731
    open(os.path.join(root, "tracked.js"), "w").write("v1\n")
    os.makedirs(os.path.join(root, ".claude", "qa", "ledgers"), exist_ok=True)
    open(os.path.join(root, ".claude", "qa", "ledgers", "runs.jsonl"), "w").write("")
    g("add", "-A"); g("commit", "-qm", "base")
    # the runner appends to the ledger and writes results/ + pending markers during a run
    open(os.path.join(root, ".claude", "qa", "ledgers", "runs.jsonl"), "a").write('{"run_id":"x"}\n')
    os.makedirs(os.path.join(root, ".claude", ".e2e-pending"), exist_ok=True)
    open(os.path.join(root, ".claude", ".e2e-pending", "m.json"), "w").write("{}")
    r = _row(root, run)
    assert r["dirty"] is False and r["dirty_files"] == 0, (r["dirty"], r["dirty_files"])
    open(os.path.join(root, "tracked.js"), "w").write("v2\n")
    r = _row(root, run)
    assert r["dirty"] is True and r["dirty_files"] == 1


def test_emulated_flows_are_recorded_on_the_row_and_never_read_as_rendering():
    # feature-runner writes `flowEmulator` (from the mock adapter's flowStats) into <feature>.json;
    # the row must carry it so a reader sees the Flow verdicts came from the emulator, not a phone.
    root, run = _fixture()
    d = json.load(open(os.path.join(run, "menu.json")))
    d["flowEmulator"] = {"opened": 2, "completed": 1, "refused": 0, "flows": ["STATUS_FLOW_ID", "SETTINGS_FLOW_ID"]}
    json.dump(d, open(os.path.join(run, "menu.json"), "w"))
    r = _row(root, run)
    assert r["flows"] == {"via": "flow-emulator", "opened": 2, "completed": 1, "refused": 0, "flows": ["SETTINGS_FLOW_ID", "STATUS_FLOW_ID"]}, r.get("flows")


def test_no_flow_activity_means_no_flows_field():
    root, run = _fixture()
    assert "flows" not in _row(root, run)


def _write_known(root, mapping):
    cfg = os.path.join(root, ".claude", "qa", "config")
    os.makedirs(cfg, exist_ok=True)
    json.dump(mapping, open(os.path.join(cfg, "known-findings.json"), "w"))


def test_row_stamps_no_regression_when_the_only_fail_is_a_known_finding():
    # M09 FAILs but is documented, so there is NO new regression even though raw status is CRITICAL.
    # The row carries that verdict so impact.py can say "no regressions" instead of a bare CRITICAL.
    root, run = _fixture()
    _write_known(root, {"menu": {"M09": "documented"}})
    r = _row(root, run)
    assert r["status"] == "CRITICAL", r["status"]           # raw health is unchanged
    assert r["regression"]["gate"] == "pass", r["regression"]
    assert r["regression"]["known"] == ["M09"], r["regression"]
    assert r["regression"]["new_failures"] == [], r["regression"]
    assert ledger.validate_run(r) == [], "regression key must not break the frozen schema"


def test_row_flags_a_regression_for_an_unlisted_fail():
    root, run = _fixture()
    _write_known(root, {"menu": {}})                        # M09 not listed → a real regression
    r = _row(root, run)
    assert r["regression"]["gate"] == "fail", r["regression"]
    assert r["regression"]["new_failures"] == ["M09"], r["regression"]
    assert r["regression"]["known"] == [], r["regression"]


# ── bd-2jdxj: the row is proof only if it is COMMITTED ───────────────────────────────────────────
# runs.jsonl was appended to the working tree and left there. impact.py measures
# `git diff <base>...<head> -- .claude/qa/ledgers/runs.jsonl`, so an uncommitted row is invisible to
# CI and a successful run looks identical to a run that never happened (PRs #1139, #1151, #1155).


def _git(root, *args):
    import subprocess
    return subprocess.run(["git", "-C", root] + list(args), capture_output=True, text=True).stdout.strip()


def _git_fixture():
    """A real git repo with the ledger tracked and one commit, plus the run-dir fixture."""
    import subprocess
    root, run = _fixture()
    for a in (["init", "-q", "-b", "sandbox"], ["config", "user.email", "t@l"], ["config", "user.name", "t"]):
        subprocess.run(["git", "-C", root] + a, capture_output=True)
    led = os.path.join(root, ".claude", "qa", "ledgers", "runs.jsonl")
    open(led, "w").close()
    subprocess.run(["git", "-C", root, "add", "-A"], capture_output=True)
    subprocess.run(["git", "-C", root, "commit", "-qm", "baseline"], capture_output=True)
    return root, run, led


def _main(root, run, **over):
    kw = dict(root=root, run_dir=run, feature="menu", run_id="r1", env="sandbox", method="mock",
              seconds="91", driver="923000000001", trigger="commit", commit="a" * 40,
              spec_sync="none", validator_exit="0", dry_run=False)
    kw.update(over)
    argv = []
    for k, v in kw.items():
        if k == "dry_run":
            continue
        argv += ["--" + k.replace("_", "-"), str(v)]
    return ledger_row.main(argv)


def test_the_appended_row_is_committed():
    root, run, led = _git_fixture()
    os.environ.pop("E2E_LEDGER_COMMIT_OFF", None)
    assert _main(root, run) == 0
    assert "runs.jsonl" in _git(root, "log", "-1", "--name-only", "--format="), "the row was not committed"
    assert _git(root, "status", "--porcelain", "--", led) == "", "the ledger is still dirty after the run"


def test_the_commit_can_be_switched_off():
    root, run, led = _git_fixture()
    os.environ["E2E_LEDGER_COMMIT_OFF"] = "1"
    try:
        assert _main(root, run) == 0
        assert json.loads(open(led).read().strip().splitlines()[-1])["feature"] == "menu", "row not appended"
        assert _git(root, "status", "--porcelain", "--", led) != "", "committed although the switch was off"
    finally:
        os.environ.pop("E2E_LEDGER_COMMIT_OFF", None)


def test_a_detached_head_is_left_alone():
    """An auto-commit on a detached HEAD is an orphan nobody will find. Append, do not commit."""
    root, run, led = _git_fixture()
    sha = _git(root, "rev-parse", "HEAD")
    import subprocess
    subprocess.run(["git", "-C", root, "checkout", "-q", "--detach", sha], capture_output=True)
    assert _main(root, run) == 0
    assert _git(root, "status", "--porcelain", "--", led) != "", "committed onto a detached HEAD"


def test_only_the_ledger_is_committed():
    """Never -A: a run must not sweep up whatever the developer had in flight."""
    root, run, led = _git_fixture()
    open(os.path.join(root, "unrelated.txt"), "w").write("mine\n")
    assert _main(root, run) == 0
    assert "unrelated.txt" not in _git(root, "log", "-1", "--name-only", "--format="), "swept up an unrelated file"
    assert "unrelated.txt" in _git(root, "status", "--porcelain"), "the unrelated file vanished"


def test_a_non_git_root_still_returns_zero():
    """A lane run must never fail because git refused."""
    root, run = _fixture()
    assert _main(root, run) == 0


# ── bd-wvu2y: committed is not enough — qa-impact only reads what was PUSHED ────────────────────
# The workflow runs on pull_request/synchronize and resolves the range on the remote, so a row that
# is committed but unpushed still reads "E2E run recorded: missing".
# NOTE the baseline commit already tracks an EMPTY runs.jsonl, so "does the remote have the file"
# proves nothing. Every assertion below reads the remote's ledger CONTENT for this run's id.


def _git_fixture_with_remote():
    import subprocess
    root, run, led = _git_fixture()
    bare = tempfile.mkdtemp()
    subprocess.run(["git", "init", "-q", "--bare", bare], capture_output=True)
    subprocess.run(["git", "-C", root, "remote", "add", "origin", bare], capture_output=True)
    subprocess.run(["git", "-C", root, "push", "-q", "-u", "origin", "sandbox"], capture_output=True)
    subprocess.run(["git", "-C", root, "checkout", "-q", "-b", "bd-test-1"], capture_output=True)
    subprocess.run(["git", "-C", root, "push", "-q", "-u", "origin", "bd-test-1"], capture_output=True)
    return root, run, led, bare


def _remote_ledger(bare, branch="bd-test-1"):
    """The ledger as the REMOTE has it — empty string if the branch or file is absent."""
    import subprocess
    return subprocess.run(
        ["git", "-C", bare, "show", "%s:.claude/qa/ledgers/runs.jsonl" % branch],
        capture_output=True, text=True).stdout


def test_the_committed_row_is_pushed():
    root, run, led, bare = _git_fixture_with_remote()
    os.environ.pop("E2E_LEDGER_PUSH_OFF", None)
    assert '"r1"' not in _remote_ledger(bare), "fixture is not clean"
    assert _main(root, run) == 0
    assert '"r1"' in _remote_ledger(bare), "the row was committed but never pushed"


def test_a_protected_branch_is_never_pushed_to():
    """A run on a checked-out sandbox must not push to sandbox."""
    import subprocess
    root, run, led, bare = _git_fixture_with_remote()
    subprocess.run(["git", "-C", root, "checkout", "-q", "sandbox"], capture_output=True)
    before = subprocess.run(["git", "-C", bare, "rev-parse", "sandbox"], capture_output=True, text=True).stdout
    assert _main(root, run) == 0
    after = subprocess.run(["git", "-C", bare, "rev-parse", "sandbox"], capture_output=True, text=True).stdout
    assert before == after, "pushed to a protected branch"
    assert '"r1"' not in _remote_ledger(bare, "sandbox")


def test_no_upstream_means_no_push():
    """Never create a remote branch nobody asked for, and never fail the run over it."""
    import subprocess
    root, run, led, bare = _git_fixture_with_remote()
    subprocess.run(["git", "-C", root, "checkout", "-q", "-b", "bd-no-upstream"], capture_output=True)
    assert _main(root, run) == 0
    assert subprocess.run(["git", "-C", bare, "rev-parse", "--verify", "-q", "bd-no-upstream"],
                          capture_output=True).returncode != 0, "created a remote branch nobody asked for"


def test_the_push_can_be_switched_off():
    root, run, led, bare = _git_fixture_with_remote()
    os.environ["E2E_LEDGER_PUSH_OFF"] = "1"
    try:
        assert _main(root, run) == 0
        assert '"r1"' not in _remote_ledger(bare), "pushed although the switch was off"
    finally:
        os.environ.pop("E2E_LEDGER_PUSH_OFF", None)


def test_a_refused_push_never_fails_the_run():
    """The pre-push gate may refuse. The run still exits 0, and we do NOT retry with a bypass."""
    import subprocess
    root, run, led, bare = _git_fixture_with_remote()
    hooks = os.path.join(root, ".githooks")
    os.makedirs(hooks, exist_ok=True)
    hp = os.path.join(hooks, "pre-push")
    open(hp, "w").write("#!/bin/sh\necho 'BLOCKED by the gate' >&2\nexit 1\n")
    os.chmod(hp, 0o755)
    subprocess.run(["git", "-C", root, "config", "core.hooksPath", ".githooks"], capture_output=True)
    assert _main(root, run) == 0, "a refused push failed the run"
    assert '"r1"' not in _remote_ledger(bare), "bypassed a refusing pre-push gate"


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
