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
    for needle in ("/niete-e2e menu", "/sync-specs", "menu.feature", "stale", "Spec-Sync:"):
        assert needle in md, (needle, md)
    assert ci.COMMENT_MARKER in md
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
