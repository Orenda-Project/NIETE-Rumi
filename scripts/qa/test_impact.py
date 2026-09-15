#!/usr/bin/env python3
"""Stdlib assert tests for scripts/qa/impact.py — the range check the pre-push hook runs.

impact answers, for a commit range, the three questions a reviewer needs and
nothing else: which features the diff touched, whether their specs were synced,
and whether an E2E run for them was recorded. It is deterministic; the LLM
authoring and the WhatsApp drive are not its job.

Run:  python3 scripts/qa/test_impact.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import impact as ci  # noqa: E402


def git(repo, *a, **kw):
    return subprocess.run(["git", "-C", repo] + list(a), capture_output=True, text=True, **kw)


def make_repo():
    """A NIETE-shaped repo carrying copies of the real map, agents and specs."""
    tmp = tempfile.mkdtemp(prefix="ci-impact.")
    for rel in (".claude/qa/config", ".claude/qa/agents", ".claude/qa/shared", ".claude/qa/ledgers",
                "tests/features/whatsapp/niete"):
        shutil.copytree(os.path.join(ROOT, rel), os.path.join(tmp, rel))
    os.makedirs(os.path.join(tmp, "bot/shared/services"))
    with open(os.path.join(tmp, "bot/shared/services/menu.service.js"), "w") as fh:
        fh.write("module.exports = { ROWS: ['Teacher Training'] };\n")
    with open(os.path.join(tmp, "bot/shared/services/whatsapp.service.js"), "w") as fh:
        fh.write("module.exports = { send: () => {} };\n")
    with open(os.path.join(tmp, "README.md"), "w") as fh:
        fh.write("# r\n")
    git(tmp, "init", "-q", "-b", "develop")
    git(tmp, "config", "user.email", "t@l"); git(tmp, "config", "user.name", "t")
    git(tmp, "add", "-A"); git(tmp, "commit", "-qm", "baseline")
    return tmp


def commit(repo, msg, **files):
    for rel, content in files.items():
        p = os.path.join(repo, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "a") as fh:
            fh.write(content)
    git(repo, "add", "-A"); git(repo, "commit", "-qm", msg)
    return git(repo, "rev-parse", "HEAD").stdout.strip()


def test_selects_features_for_a_range():
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    head = commit(r, "feat(menu): x", **{"bot/shared/services/menu.service.js": "// c\n"})
    res = ci.analyse(r, base, head)
    assert res["features"] == ["menu"], res["features"]
    assert "/niete-e2e menu" in res["commands"], res["commands"]
    shutil.rmtree(r)


def test_docs_only_range_selects_nothing_and_passes():
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    head = commit(r, "docs", **{"README.md": "more\n"})
    res = ci.analyse(r, base, head)
    assert res["features"] == [], res
    assert res["verdict"]["spec_freshness"] == "n/a", res["verdict"]
    assert ci.exit_code(res, freshness="block", proof="block") == 0
    shutil.rmtree(r)


def test_own_file_change_without_spec_change_is_stale():
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    head = commit(r, "feat(menu): x", **{"bot/shared/services/menu.service.js": "// c\n"})
    res = ci.analyse(r, base, head)
    f = res["per_feature"]["menu"]
    assert f["only_shared"] is False
    assert f["spec_changed"] is False
    assert f["spec_status"] == "stale", f
    assert res["verdict"]["spec_freshness"] == "stale"
    assert ci.exit_code(res, freshness="warn", proof="off") == 0, "warn mode never fails"
    assert ci.exit_code(res, freshness="block", proof="off") == 1, "block mode fails on a stale spec"
    shutil.rmtree(r)


def test_spec_change_in_range_makes_it_fresh():
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    head = commit(r, "feat(menu): x + spec",
                  **{"bot/shared/services/menu.service.js": "// c\n",
                     "tests/features/whatsapp/niete/menu.feature": "\n# synced\n"})
    res = ci.analyse(r, base, head)
    assert res["per_feature"]["menu"]["spec_status"] == "synced", res["per_feature"]["menu"]
    assert res["verdict"]["spec_freshness"] == "synced"
    assert ci.exit_code(res, freshness="block", proof="off") == 0
    shutil.rmtree(r)


def test_none_needed_trailer_in_a_commit_message_is_an_explicit_answer():
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    head = commit(r, "fix(menu): copy\n\nSpec-Sync: menu=none-needed (wording only, no behaviour)",
                  **{"bot/shared/services/menu.service.js": "// c\n"})
    res = ci.analyse(r, base, head)
    f = res["per_feature"]["menu"]
    assert f["spec_status"] == "none-needed", f
    assert "wording only" in f["spec_reason"], f
    assert ci.exit_code(res, freshness="block", proof="off") == 0
    shutil.rmtree(r)


def test_none_needed_trailer_in_the_pr_body_counts_too():
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    head = commit(r, "fix(menu): copy", **{"bot/shared/services/menu.service.js": "// c\n"})
    body = "Some PR text.\n\nSpec-Sync: none-needed (log line only)\n"
    res = ci.analyse(r, base, head, pr_body=body)
    assert res["per_feature"]["menu"]["spec_status"] == "none-needed", res["per_feature"]["menu"]
    shutil.rmtree(r)


def test_only_shared_features_are_not_required_to_sync():
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    head = commit(r, "chore: log", **{"bot/shared/services/whatsapp.service.js": "// log\n"})
    res = ci.analyse(r, base, head)
    assert len(res["features"]) == 9, res["features"]
    assert all(v["only_shared"] for v in res["per_feature"].values())
    assert all(v["spec_status"] == "only-shared" for v in res["per_feature"].values())
    assert res["verdict"]["spec_freshness"] == "synced", res["verdict"]
    assert ci.exit_code(res, freshness="block", proof="off") == 0
    shutil.rmtree(r)


def test_e2e_proof_is_a_ledger_row_added_in_the_range():
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    head = commit(r, "feat(menu): x", **{"bot/shared/services/menu.service.js": "// c\n"})
    res = ci.analyse(r, base, head)
    assert res["per_feature"]["menu"]["e2e_proof"] == "missing"
    assert res["verdict"]["e2e_proof"] == "missing"
    assert ci.exit_code(res, freshness="off", proof="block") == 1
    row = {"run_id": "x", "ts": "2026-09-07T00:00:00Z", "surface": "whatsapp", "tenant": "niete",
           "env": "staging", "method": "chrome", "feature": "menu",
           "summary": {"total": 12, "passed": 12, "failed": 0, "blocked": 0}, "status": "HEALTHY"}
    head2 = commit(r, "qa: menu run", **{".claude/qa/ledgers/runs.jsonl": json.dumps(row) + "\n"})
    res = ci.analyse(r, base, head2)
    assert res["per_feature"]["menu"]["e2e_proof"] == "HEALTHY", res["per_feature"]["menu"]
    assert res["verdict"]["e2e_proof"] == "recorded"
    assert ci.exit_code(res, freshness="off", proof="block") == 0
    shutil.rmtree(r)


def test_markdown_report_carries_the_commands_and_the_verdicts():
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    head = commit(r, "feat(menu): x", **{"bot/shared/services/menu.service.js": "// c\n"})
    res = ci.analyse(r, base, head)
    md = ci.render_markdown(res, freshness="warn", proof="warn")
    # menu is @mock-lane, so the drive step recommends the mock lane, not chrome's /niete-e2e.
    for needle in ("commit-e2e.sh", "/sync-specs", "menu.feature", "stale", "Spec-Sync:"):
        assert needle in md, (needle, md)
    assert ci.COMMENT_MARKER in md
    shutil.rmtree(r)


def test_drive_recommendation_uses_the_mock_lane_for_a_mock_capable_feature():
    """menu carries an @mock-lane driver, so the 'drive the E2E' step must recommend the mock lane
    (commit-e2e.sh — layer 1, no browser), never chrome's `/niete-e2e` WhatsApp-Web run. Both the
    markdown (PR comment) and the text (CI log) renderers must agree."""
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    head = commit(r, "feat(menu): x", **{"bot/shared/services/menu.service.js": "// c\n"})
    res = ci.analyse(r, base, head)
    for out in (ci.render_markdown(res, "warn", "warn"), ci.render_text(res, "warn", "warn")):
        assert "commit-e2e.sh %s --features menu" % head[:12] in out, out
        assert "mock lane" in out.lower(), out
    shutil.rmtree(r)


def test_chrome_only_feature_is_noted_paused_not_driven_when_chrome_off():
    """A feature with no @mock-lane driver (e.g. observe) is on the chrome lane — layer 2, paused.
    The report notes it as paused and does NOT tell the developer to open a WhatsApp Web tab; with
    E2E_CHROME_ON=1 the chrome command comes back."""
    assert "observe" not in ci.mock_feature_set(), "observe must have no mock driver for this test"
    res = {"features": ["observe"], "head": "abcdef012345", "commands": ["/niete-e2e observe"]}
    saved = os.environ.pop("E2E_CHROME_ON", None)
    try:
        paused = "\n".join(ci._drive_block(res))
        assert "paused" in paused.lower(), paused
        assert "linked WhatsApp Web tab" not in paused, paused
        os.environ["E2E_CHROME_ON"] = "1"
        enabled = "\n".join(ci._drive_block(res))
        assert "/niete-e2e observe" in enabled, enabled
    finally:
        os.environ.pop("E2E_CHROME_ON", None)
        if saved is not None:
            os.environ["E2E_CHROME_ON"] = saved


def test_cassette_misses_surface_the_record_mention():
    """A mock-lane run records missing cassettes under the NESTED `cassette.misses` (that is what
    ledger_row.py writes). impact must read that nested field — a top-level `cassette_misses` never
    exists — and turn it into the @-mention that asks the owner to record the fixtures."""
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    row = {"run_id": "x", "ts": "2026-09-15T00:00:00Z", "surface": "whatsapp", "tenant": "niete",
           "env": "sandbox", "method": "mock", "feature": "menu", "status": "CRITICAL",
           "summary": {"total": 13, "passed": 11, "failed": 1, "blocked": 0, "skipped": 1},
           "cassette": {"mode": "replay-strict", "misses": 3, "scenarios_affected": ["M08", "M09", "M12"]}}
    head = commit(r, "feat(menu)+run",
                  **{"bot/shared/services/menu.service.js": "// c\n",
                     ".claude/qa/ledgers/runs.jsonl": json.dumps(row) + "\n"})
    res = ci.analyse(r, base, head)
    assert res["cassette_misses"] == {"menu": 3}, res["cassette_misses"]
    md = ci.render_markdown(res, "warn", "warn")
    for needle in ("Cassettes missing", "@mah-noor1", "--record-missing"):
        assert needle in md, (needle, md)
    # the CI log / pre-push terminal form must surface it too, not only the posted comment
    txt = ci.render_text(res, "warn", "warn")
    assert "@mah-noor1" in txt and "--record-missing" in txt, txt
    shutil.rmtree(r)


def test_a_later_clean_run_clears_the_cassette_mention():
    """If a feature's MOST RECENT row has no misses, its cassettes were recorded since — don't nag.
    (Same last-row-wins semantics as the e2e-proof status.)"""
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    base_row = {"run_id": "a", "ts": "2026-09-15T00:00:00Z", "surface": "whatsapp", "tenant": "niete",
                "env": "sandbox", "method": "mock", "feature": "menu", "status": "CRITICAL",
                "summary": {"total": 1, "passed": 0, "failed": 0, "blocked": 0, "skipped": 0},
                "cassette": {"misses": 3}}
    clean = json.loads(json.dumps(base_row)); clean["run_id"] = "b"; clean["ts"] = "2026-09-15T01:00:00Z"
    clean["status"] = "HEALTHY"; clean["cassette"] = {"misses": 0}
    head = commit(r, "feat(menu)+runs",
                  **{"bot/shared/services/menu.service.js": "// c\n",
                     ".claude/qa/ledgers/runs.jsonl": json.dumps(base_row) + "\n" + json.dumps(clean) + "\n"})
    res = ci.analyse(r, base, head)
    assert res["cassette_misses"] == {}, res["cassette_misses"]
    assert "Cassettes missing" not in ci.render_markdown(res, "warn", "warn")
    shutil.rmtree(r)


def test_unknown_range_is_reported_not_crashed():
    r = make_repo()
    res = ci.analyse(r, "0" * 40, "0" * 40)
    assert res["error"], res
    assert ci.exit_code(res, freshness="block", proof="block") == 0, "an undecidable range is not a failure of the PR"
    shutil.rmtree(r)


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t(); print("PASS", t.__name__)
        except Exception as e:  # noqa: BLE001
            failed += 1; print("FAIL", t.__name__, "->", type(e).__name__, e)
    print("%d/%d passed" % (len(tests) - failed, len(tests)))
    sys.exit(1 if failed else 0)
