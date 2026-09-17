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
sys.path.insert(0, HERE)
import tenants_lite as _tl  # noqa: E402
# The repo whose tenant layer this test copies is the one carrying tenants.yaml (CLAUDE_PROJECT_DIR or the
# cwd's ancestors) — never the engine's own ancestors (bd-9157r).
ROOT = _tl.repo_root()
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
    # the mention lives IN the feature table row now — no verbose standalone section
    assert "### 📼 Cassettes missing" not in md, "the standalone cassette section must be gone"
    menu_row = next(l for l in md.splitlines() if l.startswith("| **menu**"))
    assert "📼" in menu_row and "3" in menu_row and "@mah-noor1" in menu_row, menu_row
    # the CI log / pre-push terminal form carries it inline on the feature line
    txt = ci.render_text(res, "warn", "warn")
    menu_line = next(l for l in txt.splitlines() if l.strip().startswith("menu") or " menu " in l)
    assert "📼" in menu_line, menu_line
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


def test_regression_verdict_reconciles_a_critical_with_no_new_regressions():
    """A recorded run can be CRITICAL yet have NO new regression — its only FAIL is a known finding.
    The row carries regression.gate=pass; the report must say 'no new regressions' and name the known
    finding, not present a bare ❌ CRITICAL that reads as a break."""
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    row = {"run_id": "x", "ts": "2026-09-15T00:00:00Z", "surface": "whatsapp", "tenant": "niete",
           "env": "sandbox", "method": "mock", "feature": "menu", "status": "CRITICAL",
           "summary": {"total": 13, "passed": 11, "failed": 1, "blocked": 0, "skipped": 1},
           "regression": {"gate": "pass", "new_failures": [], "known": ["M09"], "fixed": []}}
    head = commit(r, "feat(menu)+run",
                  **{"bot/shared/services/menu.service.js": "// c\n",
                     ".claude/qa/ledgers/runs.jsonl": json.dumps(row) + "\n"})
    res = ci.analyse(r, base, head)
    assert res["per_feature"]["menu"]["regression"]["gate"] == "pass", res["per_feature"]["menu"]
    md = ci.render_markdown(res, "warn", "warn")
    assert "no new regressions" in md.lower() and "M09" in md, md
    txt = ci.render_text(res, "warn", "warn")
    assert "no new regressions" in txt.lower(), txt
    shutil.rmtree(r)


def test_regression_verdict_flags_a_new_regression():
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    row = {"run_id": "x", "ts": "2026-09-15T00:00:00Z", "surface": "whatsapp", "tenant": "niete",
           "env": "sandbox", "method": "mock", "feature": "menu", "status": "CRITICAL",
           "summary": {"total": 13, "passed": 11, "failed": 1, "blocked": 0, "skipped": 1},
           "regression": {"gate": "fail", "new_failures": ["M04"], "known": [], "fixed": []}}
    head = commit(r, "feat(menu)+run",
                  **{"bot/shared/services/menu.service.js": "// c\n",
                     ".claude/qa/ledgers/runs.jsonl": json.dumps(row) + "\n"})
    res = ci.analyse(r, base, head)
    for out in (ci.render_markdown(res, "warn", "warn"), ci.render_text(res, "warn", "warn")):
        assert "REGRESSION" in out and "M04" in out, out
    shutil.rmtree(r)


def test_unknown_range_is_reported_not_crashed():
    r = make_repo()
    res = ci.analyse(r, "0" * 40, "0" * 40)
    assert res["error"], res
    assert ci.exit_code(res, freshness="block", proof="block") == 0, "an undecidable range is not a failure of the PR"
    shutil.rmtree(r)


def test_cassette_status_is_a_separate_column_from_the_e2e_run():
    """A cassette miss is a fixture-RECORDING gap, not the run failing, so it must not live in the
    'E2E run recorded' cell (where it reads like the mock run itself broke). It gets its own
    'Cassette' column; the E2E cell answers only 'did the mock run for this commit'."""
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    row = {"run_id": "x", "ts": "2026-09-15T00:00:00Z", "surface": "whatsapp", "tenant": "niete",
           "env": "sandbox", "method": "mock", "feature": "menu", "status": "CRITICAL",
           "summary": {"total": 13, "passed": 11, "failed": 1, "blocked": 0, "skipped": 1},
           "cassette": {"mode": "replay-strict", "misses": 2, "scenarios_affected": ["M08", "M09"]}}
    head = commit(r, "feat(menu)+run",
                  **{"bot/shared/services/menu.service.js": "// c\n",
                     ".claude/qa/ledgers/runs.jsonl": json.dumps(row) + "\n"})
    res = ci.analyse(r, base, head)
    md = ci.render_markdown(res, "warn", "warn")
    header = next(l for l in md.splitlines() if l.startswith("| Feature |"))
    assert "Cassette" in header, header
    menu_row = next(l for l in md.splitlines() if l.startswith("| **menu**"))
    cells = [c.strip() for c in menu_row.split("|")]
    # cells: ['', feature, pulled-in-by, gherkin, e2e-run, cassette, '']
    assert len(cells) >= 7, cells
    e2e_cell, cassette_cell = cells[4], cells[5]
    assert "📼" not in e2e_cell, "E2E-run cell must not carry the cassette miss: %r" % e2e_cell
    assert "📼" in cassette_cell and "2" in cassette_cell and "@mah-noor1" in cassette_cell, cassette_cell
    shutil.rmtree(r)


def test_cassette_column_shows_recorded_when_a_run_has_no_misses():
    """When the mock run recorded and every cassette replayed, the Cassette column says so (✅),
    it is not left blank — so a reader can tell 'recorded & complete' from 'never ran'."""
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    row = {"run_id": "y", "ts": "2026-09-15T00:00:00Z", "surface": "whatsapp", "tenant": "niete",
           "env": "sandbox", "method": "mock", "feature": "menu", "status": "HEALTHY",
           "summary": {"total": 18, "passed": 18, "failed": 0, "blocked": 0, "skipped": 0},
           "cassette": {"mode": "replay-strict", "misses": 0}}
    head = commit(r, "feat(menu)+clean",
                  **{"bot/shared/services/menu.service.js": "// c\n",
                     ".claude/qa/ledgers/runs.jsonl": json.dumps(row) + "\n"})
    res = ci.analyse(r, base, head)
    md = ci.render_markdown(res, "warn", "warn")
    menu_row = next(l for l in md.splitlines() if l.startswith("| **menu**"))
    cells = [c.strip() for c in menu_row.split("|")]
    assert "📼" not in cells[5], cells[5]
    assert "✅" in cells[5], "a recorded-and-complete run should show ✅ in the Cassette column: %r" % cells[5]
    shutil.rmtree(r)


def test_drive_block_is_hidden_when_nothing_is_actionable():
    """Spec synced + E2E run recorded + no cassette misses == nothing to do. The verbose 'how to
    drive the E2E' block is then noise (the developer already drove it — that is why it is recorded),
    so it must not render; a one-line 'nothing to drive' stands in its place."""
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    row = {"run_id": "z", "ts": "2026-09-15T00:00:00Z", "surface": "whatsapp", "tenant": "niete",
           "env": "sandbox", "method": "mock", "feature": "menu", "status": "HEALTHY",
           "summary": {"total": 18, "passed": 18, "failed": 0, "blocked": 0, "skipped": 0},
           "cassette": {"misses": 0}}
    head = commit(r, "feat(menu): synced and recorded",
                  **{"bot/shared/services/menu.service.js": "// c\n",
                     "tests/features/whatsapp/niete/menu.feature": "\n# touched in range\n",
                     ".claude/qa/ledgers/runs.jsonl": json.dumps(row) + "\n"})
    res = ci.analyse(r, base, head)
    md = ci.render_markdown(res, "warn", "warn")
    assert "commit-e2e.sh" not in md, "drive block must be hidden when nothing is actionable:\n" + md
    assert "Then drive the targeted E2E" not in md, md
    assert "nothing to drive" in md.lower(), md
    shutil.rmtree(r)


def test_drive_block_still_shows_when_the_run_is_not_recorded():
    """The suppression is only for a fully-green range. A synced spec whose E2E run was NOT recorded
    is still actionable — the drive block must stay so the developer knows how to produce the proof."""
    r = make_repo(); base = git(r, "rev-parse", "HEAD").stdout.strip()
    head = commit(r, "feat(menu): synced, no run yet",
                  **{"bot/shared/services/menu.service.js": "// c\n",
                     "tests/features/whatsapp/niete/menu.feature": "\n# touched in range\n"})
    res = ci.analyse(r, base, head)
    md = ci.render_markdown(res, "warn", "warn")
    assert "commit-e2e.sh" in md, "drive block must show when the E2E run is not recorded:\n" + md
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
