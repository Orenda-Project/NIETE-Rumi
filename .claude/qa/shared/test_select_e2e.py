#!/usr/bin/env python3
"""Stdlib assert tests for select_e2e. Run: python3 test_select_e2e.py

Covers the six behaviours the selector exists to get right (bd-43512):

  1. one feature changed          -> exactly that feature
  2. multiple features changed    -> exactly those, in agent `order:` sequence
  3. shared/fan-out file changed  -> every feature that file feeds
  4. .feature spec changed        -> that feature, directly
  5. unmapped production code     -> the SAFE subset as an EXPLICIT fallback
  6. docs/config-only change      -> nothing selected, and that is not a fallback

Plus the glob engine and the divergence guard (map keys vs agent frontmatter).
"""
import json
import os
import sys

import select_e2e as se

HERE = os.path.dirname(os.path.abspath(__file__))
QA = os.path.dirname(HERE)
MAP_PATH = os.path.join(QA, "config", "feature-map.yaml")
AGENTS_DIR = os.path.join(QA, "agents")


# ── glob engine ───────────────────────────────────────────────────────────────
# fnmatch is NOT usable here: its `*` crosses `/`, so `bot/*.js` would match
# `bot/shared/services/menu.service.js` and every top-level rule would swallow the
# whole tree. These assertions pin the distinction.

def test_star_does_not_cross_slash():
    assert se.glob_match("bot/*.js", "bot/whatsapp-bot.js")
    assert not se.glob_match("bot/*.js", "bot/shared/services/menu.service.js")


def test_doublestar_crosses_slash():
    assert se.glob_match("bot/shared/services/coaching/**",
                         "bot/shared/services/coaching/coaching-session.service.js")
    assert se.glob_match("bot/shared/services/coaching/**",
                         "bot/shared/services/coaching/report-v2/hero-report.service.js")
    assert not se.glob_match("bot/shared/services/coaching/**",
                             "bot/shared/services/menu.service.js")


def test_partial_star_within_a_segment():
    assert se.glob_match("bot/shared/services/lp-*.service.js",
                         "bot/shared/services/lp-shelf.service.js")
    assert not se.glob_match("bot/shared/services/lp-*.service.js",
                             "bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service.js")


def test_exact_path_is_a_valid_glob():
    assert se.glob_match("bot/whatsapp-bot.js", "bot/whatsapp-bot.js")
    assert not se.glob_match("bot/whatsapp-bot.js", "bot/whatsapp-bot.js.bak")


def test_glob_special_chars_are_escaped_not_regex():
    # A `.` in a glob is a literal dot, not "any char".
    assert not se.glob_match("bot/shared/services/menu.service.js",
                             "bot/shared/services/menuXservice.js")


# ── feature order (single source of truth = agent frontmatter) ────────────────

def test_feature_order_read_from_agent_frontmatter():
    order = se.load_feature_order(AGENTS_DIR)
    assert order[:3] == ["registration", "menu", "training"], order
    assert order[-2:] == ["observe", "attendance"], order
    assert len(order) == 9, order


def test_feature_order_rejects_duplicate_order_values(tmpdir=None):
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        for name, order in (("alpha", 1), ("beta", 1)):
            with open(os.path.join(d, "niete-%s-agent.md" % name), "w") as fh:
                fh.write("---\nname: niete-%s-agent\norder: %d\n"
                         "feature: tests/features/whatsapp/niete/%s.feature\n---\n"
                         % (name, order, name))
        try:
            se.load_feature_order(d)
        except se.MapError:
            return
        raise AssertionError("duplicate order: values must raise MapError")


# ── the map itself ────────────────────────────────────────────────────────────

def test_shipped_map_covers_exactly_the_nine_agent_features():
    fmap = se.load_map(MAP_PATH, AGENTS_DIR)
    assert sorted(fmap.features) == sorted(se.load_feature_order(AGENTS_DIR))


def test_map_rejects_a_feature_with_no_agent():
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as fh:
        fh.write("version: 1\nfeatures:\n  nosuchfeature:\n    - bot/x.js\n"
                 "shared: {}\nignore: []\n")
        path = fh.name
    try:
        se.load_map(path, AGENTS_DIR)
    except se.MapError as e:
        assert "nosuchfeature" in str(e)
        return
    finally:
        os.unlink(path)
    raise AssertionError("a map key with no matching agent must raise MapError")


def test_shared_star_expands_to_every_feature():
    fmap = se.load_map(MAP_PATH, AGENTS_DIR)
    # whatsapp.service.js is the send layer — every surface goes through it.
    hits = fmap.match("bot/shared/services/whatsapp.service.js")
    assert sorted(hits) == sorted(fmap.features), hits


# ── the six behaviours ────────────────────────────────────────────────────────

def _sel(paths):
    return se.select(paths, se.load_map(MAP_PATH, AGENTS_DIR),
                     se.load_feature_order(AGENTS_DIR))


def test_1_one_feature_changed():
    s = _sel(["bot/shared/services/training/progress.service.js"])
    assert s.features == ["training"], s.features
    assert s.fallback is False
    assert s.unmapped == []
    assert s.commands == ["/niete-e2e training"]


def test_2_multiple_features_changed_in_agent_order():
    s = _sel([
        "bot/shared/services/training/progress.service.js",
        "bot/shared/services/menu.service.js",
    ])
    # menu is order 2, training is order 3 — the selector must not echo input order.
    assert s.features == ["menu", "training"], s.features
    assert s.fallback is False
    assert s.commands == ["/niete-e2e menu", "/niete-e2e training"]


def test_3_shared_fanout_file_selects_every_feature_it_feeds():
    s = _sel(["bot/shared/handlers/text-message.handler.js"])
    assert len(s.features) >= 6, s.features
    for f in ("menu", "registration", "status", "language"):
        assert f in s.features, (f, s.features)
    assert s.fallback is False
    # the reason must name the file as shared so the operator sees WHY it fanned out
    assert s.reasons["menu"][0].shared is True


def test_4_feature_spec_change_selects_that_feature():
    s = _sel(["tests/features/whatsapp/niete/coaching.feature"])
    assert s.features == ["coaching"], s.features
    assert s.fallback is False
    assert s.reasons["coaching"][0].kind == "spec"


def test_4b_feature_spec_for_unknown_name_is_unmapped_not_silent():
    s = _sel(["tests/features/whatsapp/niete/ghost.feature"])
    assert s.unmapped == ["tests/features/whatsapp/niete/ghost.feature"]
    assert s.fallback is True


def test_5_unmapped_production_code_falls_back_to_safe_subset():
    s = _sel(["bot/shared/services/bandit.service.js"])
    assert s.unmapped == ["bot/shared/services/bandit.service.js"]
    assert s.fallback is True
    assert s.features == []
    assert s.commands == ["/niete-e2e"]
    assert "unmapped" in s.fallback_reason.lower()


def test_5b_unmapped_adds_safe_subset_ON_TOP_of_mapped_features():
    s = _sel([
        "bot/shared/services/menu.service.js",
        "bot/shared/services/bandit.service.js",
    ])
    assert s.features == ["menu"]
    assert s.fallback is True
    # SAFE subset first, then the narrowed feature — never one INSTEAD of the other
    assert s.commands == ["/niete-e2e", "/niete-e2e menu"]


def test_6_docs_and_config_only_selects_nothing_and_is_not_a_fallback():
    s = _sel([
        "README.md",
        "docs/architecture.md",
        "bot/tests/services/menu.test.js",
        "bot/package-lock.json",
        ".claude/skills/rumi-voice/SKILL.md",
    ])
    assert s.features == []
    assert s.unmapped == []
    assert s.fallback is False
    assert s.commands == []
    # Two land in `ignore:` (inside the bot, inert); three are outside scope
    # altogether. Different buckets, same verdict — nothing selected, no fallback.
    assert s.ignored == ["bot/tests/services/menu.test.js", "bot/package-lock.json"], s.ignored
    assert len(s.out_of_scope) == 3, s.out_of_scope


def test_6b_an_ignored_file_never_triggers_the_fallback_alongside_mapped_code():
    s = _sel(["README.md", "bot/shared/services/menu.service.js"])
    assert s.features == ["menu"]
    assert s.fallback is False
    assert s.commands == ["/niete-e2e menu"]


# ── scope: what this suite is even allowed to have an opinion about ───────────
# Without a scope boundary the fallback is worthless. The NIETE-Rumi repo holds the
# React teacher portal, the observability dashboard, infrastructure and migration
# scripts — 647 of its 1,716 tracked files. All of them would land in UNMAPPED and
# drag the SAFE subset into a push that cannot possibly change WhatsApp behaviour,
# and a fallback that fires on every push is one nobody reads.

def test_7_portal_and_dashboard_are_out_of_scope_not_unmapped():
    s = _sel([
        "portal/src/components/ui/button.tsx",
        "dashboard/services/retention.service.js",
        "infrastructure/supabase/migrations/V1.0.9__leader_allocations.sql",
        "scripts/migrate-users.py",
    ])
    assert s.features == []
    assert s.unmapped == []
    assert s.fallback is False
    assert s.commands == []
    assert len(s.out_of_scope) == 4, s.out_of_scope


def test_7b_out_of_scope_alongside_mapped_code_still_selects_the_feature():
    s = _sel(["portal/src/App.tsx", "bot/shared/services/menu.service.js"])
    assert s.features == ["menu"]
    assert s.fallback is False


def test_7c_bot_runtime_is_in_scope():
    for p in ("bot/whatsapp-bot.js",
              "bot/shared/services/menu.service.js",
              "bot/workers/sqs-worker.js",
              "bot/docs/flows/registration-flow.json"):
        s = _sel([p])
        assert s.out_of_scope == [], (p, s.out_of_scope)
        assert s.features, (p, "should have selected something")


def test_7d_ops_scripts_inside_the_bot_are_ignored_not_unmapped():
    # bot/scripts/** are one-off ops tools. They can change what teachers see (a
    # Flow republish does), but running them is a manual act, not an effect of a
    # push — so a push that only edits one warrants no E2E.
    s = _sel(["bot/scripts/setup/register-all-flows.js"])
    assert s.ignored == ["bot/scripts/setup/register-all-flows.js"]
    assert s.fallback is False


def test_7e_a_db_migration_is_in_scope_and_unmapped_so_it_pulls_safe():
    s = _sel(["bot/database/migrations/014_attendance_tables.sql"])
    assert s.unmapped == ["bot/database/migrations/014_attendance_tables.sql"]
    assert s.fallback is True
    assert s.commands == ["/niete-e2e"]


def test_7f_real_world_path_sample_classifies_with_no_surprises():
    """A sample of genuine NIETE-Rumi paths, so the map is checked against the
    real tree rather than only against paths invented to make it pass."""
    expect_mapped = [
        "bot/shared/services/coaching/report-v2/hero-report.service.js",
        "bot/shared/services/observe/assignment/leader-source.js",
        "bot/shared/services/training/certificate.service.js",
        "bot/shared/services/quiz/quiz-orchestrator.service.js",
        "bot/shared/routes/registration-endpoint.js",
        "bot/shared/config/ux-strings.js",
        "bot/shared/handlers/lesson-plan-v2.handler.js",
        "bot/shared/services/attendance-write.service.js",
        "bot/shared/services/teacher-state.service.js",
        "bot/shared/services/remark/remark-gate.js",
    ]
    for p in expect_mapped:
        assert _sel([p]).features, p

    expect_ignored = [
        "bot/tests/observe/observe-gate.test.js",
        "bot/scripts/simulate.js",
        "bot/shared/fonts/Lexend-Bold.ttf",
        "bot/CLAUDE.md",
        "bot/shared/services/__mocks__/menu.service.js",
    ]
    for p in expect_ignored:
        s = _sel([p])
        assert s.ignored == [p], (p, s.to_dict())

    expect_out_of_scope = [
        "portal/src/portal/pages/PortalTraining.tsx",
        "dashboard/views/coaching.ejs",
        "infrastructure/templates/registration_v3.json",
        "package.json",
    ]
    for p in expect_out_of_scope:
        s = _sel([p])
        assert s.out_of_scope == [p], (p, s.to_dict())


# ── not_covered: in scope, real surface, deliberately no E2E ──────────────────
# The third honest answer. Reading Assessment, video generation and homework are
# live bot code but have no `.feature` file — ICT's menu doesn't carry them. They
# are not inert (ignoring them would be a lie) and they are not unmapped (pulling
# the SAFE subset forever would be noise). They get named, with a reason.

def test_8_not_covered_surfaces_are_named_and_do_not_fall_back():
    s = _sel(["bot/shared/services/reading/fluency.service.js"])
    assert s.features == []
    assert s.unmapped == []
    assert s.fallback is False
    assert len(s.not_covered) == 1
    path, reason = s.not_covered[0]
    assert path == "bot/shared/services/reading/fluency.service.js"
    assert reason, "a not_covered entry without a reason is just a silent ignore"


def test_8b_not_covered_is_reported_even_when_it_is_the_only_change():
    s = _sel(["bot/shared/services/video/video-orchestrator.service.js"])
    out = se.render_text(s, repo="NIETE-Rumi")
    assert "NOT COVERED" in out, out
    assert "video-orchestrator" in out


def test_8c_a_mapped_path_still_wins_over_not_covered():
    # quiz/** is training-mapped; the video-quiz services live under it and must
    # not be swallowed by the video not_covered rule.
    s = _sel(["bot/shared/services/quiz/video-quiz-render.service.js"])
    assert s.features == ["training"], s.features
    assert s.not_covered == []


# ── the pushed range: a git-backed test, because synthetic paths hid a real bug ──
#
# CAUGHT 2026-08-21 by rehearsing against an actual `git push`. Every hook test
# above passed while the auto-run was completely broken in reality, because they
# all fed paths in via E2E_SELECT_FILES and never exercised the git path.
#
# The defect: PostToolUse fires AFTER the push, by which point `@{upstream}...HEAD`
# is EMPTY — the remote-tracking ref has already moved to the pushed commit. So the
# arming hook computed "nothing changed" on every real push and never armed. The
# pushed range has to come from the tracking ref's REFLOG: `<ref>@{1}...<ref>`.
#
# These tests build a real repo and really push. Slower, and the only reason the
# bug is fixed rather than still hiding.

def _git_fixture(tmp):
    import subprocess
    bare = os.path.join(tmp, "remote.git")
    work = os.path.join(tmp, "work")

    def g(*a):
        return subprocess.run(["git"] + list(a), cwd=work,
                              capture_output=True, text=True, check=False)

    subprocess.run(["git", "init", "-q", "--bare", bare], check=True)
    subprocess.run(["git", "init", "-q", work], check=True)
    g("config", "user.email", "t@t.t"); g("config", "user.name", "T")
    os.makedirs(os.path.join(work, "bot", "shared", "services"))
    for f in ("menu.service.js", "teacher-state.service.js"):
        _w(work, os.path.join("bot", "shared", "services", f), "v1")
    _w(work, "README.md", "v1")
    g("add", "-A"); g("commit", "-qm", "baseline")
    g("remote", "add", "origin", bare)
    g("push", "-q", "origin", "HEAD:develop")
    g("branch", "-M", "develop")
    g("branch", "--set-upstream-to=origin/develop")
    return work, g


def _w(root, rel, body):
    with open(os.path.join(root, rel), "w") as fh:
        fh.write(body + "\n")


def test_pushed_range_is_read_from_the_tracking_ref_reflog():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        work, g = _git_fixture(tmp)
        _w(work, os.path.join("bot", "shared", "services", "menu.service.js"), "v2")
        _w(work, "README.md", "v2")
        g("add", "-A"); g("commit", "-qm", "change")
        g("push", "-q", "origin", "develop")      # the push has ALREADY happened

        # the pre-push range is now empty — this is the bug, pinned
        assert se.changed_files(work) == [], "expected @{upstream}...HEAD empty post-push"

        # the pushed range still recovers exactly what went up
        got = sorted(se.changed_files(work, pushed=True))
        assert got == ["README.md", "bot/shared/services/menu.service.js"], got


def test_pushed_range_across_several_commits():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        work, g = _git_fixture(tmp)
        for i, f in enumerate(("menu.service.js", "teacher-state.service.js")):
            _w(work, os.path.join("bot", "shared", "services", f), "v%d" % (i + 2))
            g("add", "-A"); g("commit", "-qm", "c%d" % i)
        g("push", "-q", "origin", "develop")      # ONE push, TWO commits
        got = sorted(se.changed_files(work, pushed=True))
        assert got == ["bot/shared/services/menu.service.js",
                       "bot/shared/services/teacher-state.service.js"], got


def test_unresolvable_pushed_range_raises_rather_than_returning_empty():
    """Empty and unknown are different answers and must not be conflated.

    Returning [] for "I could not work out what was pushed" is the silent
    under-selection this whole design exists to prevent."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        work, g = _git_fixture(tmp)   # tracking ref has ONE reflog entry, no @{1}
        try:
            se.changed_files(work, pushed=True)
        except se.RangeUnknown:
            return
        raise AssertionError("a first-ever push must raise RangeUnknown, not return []")


def test_range_unknown_selects_the_safe_subset_and_says_why():
    s = se.select([], se.load_map(MAP_PATH, AGENTS_DIR),
                  se.load_feature_order(AGENTS_DIR), range_unknown=True)
    assert s.fallback is True
    assert s.commands == ["/niete-e2e"]
    assert "range" in s.fallback_reason.lower()
    assert "FALLBACK" in se.render_text(s, repo="NIETE-Rumi")


# ── committed_files: the trigger is now COMMIT, not push (bd-43513) ───────────
#
# Operator: "commit any change then hook should trigger ... something changed in
# menu related features then it should automatically run /niete-e2e menu".
#
# A commit is a strictly easier range than a push — the files are just the ones in
# HEAD. No reflog, no upstream, no tracking ref. What it is NOT is a statement
# that the change is deployed; see the caveat carried in the hook's instruction.

def test_committed_files_returns_the_head_commits_files():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        work, g = _git_fixture(tmp)
        _w(work, os.path.join("bot", "shared", "services", "menu.service.js"), "v2")
        _w(work, "README.md", "v2")
        g("add", "-A"); g("commit", "-qm", "change")
        got = sorted(se.committed_files(work))
        assert got == ["README.md", "bot/shared/services/menu.service.js"], got


def test_committed_files_ignores_earlier_commits():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        work, g = _git_fixture(tmp)
        _w(work, os.path.join("bot", "shared", "services", "menu.service.js"), "v2")
        g("add", "-A"); g("commit", "-qm", "first")
        _w(work, os.path.join("bot", "shared", "services", "teacher-state.service.js"), "v2")
        g("add", "-A"); g("commit", "-qm", "second")
        # only the SECOND commit's file — not an accumulation
        assert se.committed_files(work) == ["bot/shared/services/teacher-state.service.js"]


def test_committed_files_handles_a_root_commit():
    """The very first commit has no parent; `HEAD~1` would explode."""
    import tempfile, subprocess
    with tempfile.TemporaryDirectory() as tmp:
        work = os.path.join(tmp, "fresh")
        subprocess.run(["git", "init", "-q", work], check=True)
        for a in (["config","user.email","t@t.t"], ["config","user.name","T"]):
            subprocess.run(["git"] + a, cwd=work, check=True)
        os.makedirs(os.path.join(work, "bot", "shared", "services"))
        _w(work, os.path.join("bot", "shared", "services", "menu.service.js"), "v1")
        subprocess.run(["git","add","-A"], cwd=work, check=True)
        subprocess.run(["git","commit","-qm","root"], cwd=work, check=True)
        assert se.committed_files(work) == ["bot/shared/services/menu.service.js"]


def test_committed_files_on_a_merge_commit_is_empty():
    """A merge introduces no new work of its own — arming on it would re-run the
    E2E for changes already armed when their real commits landed."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        work, g = _git_fixture(tmp)
        g("checkout", "-qb", "side")
        _w(work, os.path.join("bot", "shared", "services", "menu.service.js"), "side")
        g("add", "-A"); g("commit", "-qm", "side work")
        g("checkout", "-q", "develop")
        g("merge", "--no-ff", "-q", "-m", "merge side", "side")
        assert se.committed_files(work) == []


# ── full-suite promotion (bd-43559) ──────────────────────────────────────────
# develop commit -> targeted. develop -> main promotion -> the whole suite.

def test_full_suite_config_loads_from_the_map():
    fmap = se.load_map(MAP_PATH, AGENTS_DIR)
    assert fmap.full_suite_on, "the shipped map must declare a full-suite rule"
    r = fmap.full_suite_on[0]
    assert r["repo_match"] == "NIETE-Rumi"
    assert r["branches"] == ["main"]
    assert r["command"] == "/niete-e2e all"


def test_wants_full_suite_matches_niete_main():
    fmap = se.load_map(MAP_PATH, AGENTS_DIR)
    for remote in ("https://github.com/Orenda-Project/NIETE-Rumi.git",
                   "git@github.com:Orenda-Project/NIETE-Rumi.git"):
        assert se.wants_full_suite(fmap, remote, "main") == "/niete-e2e all", remote


def test_wants_full_suite_declines_develop():
    """The whole point of the operator's choice: develop stays targeted."""
    fmap = se.load_map(MAP_PATH, AGENTS_DIR)
    assert se.wants_full_suite(fmap, "git@github.com:Orenda-Project/NIETE-Rumi.git",
                               "develop") is None


def test_wants_full_suite_declines_another_repo_on_main():
    """rumi-agent-home's main takes commits from 5+ parallel agents all day.
    Arming a 3-5 hour suite there would be catastrophic."""
    fmap = se.load_map(MAP_PATH, AGENTS_DIR)
    assert se.wants_full_suite(fmap, "https://github.com/hyasin270/rumi-agent-home.git",
                               "main") is None


def test_wants_full_suite_handles_missing_remote_or_branch():
    fmap = se.load_map(MAP_PATH, AGENTS_DIR)
    assert se.wants_full_suite(fmap, "", "main") is None
    assert se.wants_full_suite(fmap, "…/NIETE-Rumi.git", "") is None
    assert se.wants_full_suite(fmap, None, None) is None


# -- FEATURE -> CODE mapping correctness (bd-43700) ---------------------------
# The operator's requirement, pinned: change lesson-plan code, get lesson-plan
# and nothing else. Plus the graph-derived widenings, so a refactor that drops
# one shows up as a red test rather than as a surface silently going untested.

def test_operator_example_lesson_plan_queue_selects_only_lesson_plan():
    s = _sel(["bot/shared/services/lesson-plan-queue.service.js"])
    assert s.commands == ["/niete-e2e lesson-plan"], s.commands


def test_single_feature_files_stay_single():
    for path, feat in [
        ("bot/shared/handlers/lesson-plan-v2.handler.js", "lesson-plan"),
        ("bot/shared/services/menu.service.js", "menu"),
        ("bot/shared/services/training/certificate.service.js", "training"),
        ("bot/shared/routes/registration-endpoint.js", "registration"),
        ("bot/shared/services/teacher-state.service.js", "status"),
    ]:
        s = _sel([path])
        assert s.commands == ["/niete-e2e %s" % feat], (path, s.commands)


def test_observe_reuses_coaching_frameworks():
    """observe/observe-framework.js requires coaching/frameworks/{fico,hots,mewaka}.
    Before the graph audit this armed coaching alone and /observe broke untested."""
    for fw in ("fico", "hots", "mewaka", "oecd", "teach"):
        s = _sel(["bot/shared/services/coaching/frameworks/%s-framework.js" % fw])
        assert set(s.features) == {"coaching", "observe"}, (fw, s.features)


def test_observe_reuses_the_coaching_report_stack():
    s = _sel(["bot/shared/services/coaching/report-v2/hero-report.service.js"])
    assert set(s.features) == {"coaching", "observe"}, s.features


def test_string_catalog_reaches_every_surface_that_reads_it():
    """ux-strings/languages are read by 8 surfaces. Mapping them to `language`
    alone meant a copy change could break menu or status copy untested."""
    for path in ("bot/shared/config/ux-strings.js", "bot/shared/config/languages.js"):
        s = _sel([path])
        assert len(s.features) >= 8, (path, s.features)
        for f in ("menu", "status", "registration", "training"):
            assert f in s.features, (path, f)


def test_dispatchers_cover_everything_they_route_to():
    for path in ("bot/shared/handlers/text-message.handler.js",
                 "bot/shared/handlers/voice-message.handler.js",
                 "bot/shared/handlers/flow-response.handler.js"):
        s = _sel([path])
        assert len(s.features) == 9, (path, len(s.features))


def test_import_graph_audit_finds_no_under_selection():
    """The audit, as a regression test. Skips when NIETE-Rumi is not checked out
    (a worktree of this repo does not carry it) rather than failing on absence."""
    import subprocess
    repo = os.path.join(QA, "..", "..", "NIETE-Rumi")
    if not os.path.isdir(os.path.join(repo, "bot")):
        return
    out = subprocess.run(
        [sys.executable, os.path.join(HERE, "audit_feature_map.py"),
         "--repo", repo, "--json"],
        capture_output=True, text=True)
    assert out.returncode == 0, out.stderr[:400]
    d = json.loads(out.stdout)
    assert d["under_select"] == [], \
        "under-selection reintroduced: %s" % d["under_select"][:5]
    assert d["unmapped"] == [], \
        "unmapped in-scope files: %s" % d["unmapped"][:5]


# ── edges that would otherwise silently mis-select ────────────────────────────

def test_empty_diff_selects_nothing():
    s = _sel([])
    assert s.features == [] and s.fallback is False and s.commands == []


def test_a_unit_test_for_mapped_code_is_ignored_not_mapped():
    # bot/tests/** is inert for E2E purposes — a jest test change proves nothing
    # about user-visible WhatsApp behaviour, and selecting on it would make every
    # TDD commit drag the suite along.
    s = _sel(["bot/tests/observe/observe-gate.test.js"])
    assert s.features == [] and s.fallback is False


def test_duplicate_paths_do_not_duplicate_features_or_reasons():
    s = _sel(["bot/shared/services/menu.service.js",
              "bot/shared/services/menu.service.js"])
    assert s.features == ["menu"]
    assert len(s.reasons["menu"]) == 1


def test_draft_features_are_flagged_as_by_name_only():
    s = _sel(["bot/shared/services/observe/observe-gate.js"])
    assert s.features == ["observe"]
    assert s.draft == ["observe"], s.draft


def test_paths_are_normalised_before_matching():
    s = _sel(["./bot/shared/services/menu.service.js"])
    assert s.features == ["menu"], s.features


def test_json_payload_is_stable_and_complete():
    s = _sel(["bot/shared/services/menu.service.js",
              "bot/shared/services/bandit.service.js"])
    d = s.to_dict()
    for k in ("features", "commands", "fallback", "fallback_reason",
              "unmapped", "ignored", "draft", "reasons"):
        assert k in d, k
    import json
    json.dumps(d)  # must be serialisable


def test_render_text_names_the_fallback_reason_explicitly():
    s = _sel(["bot/shared/services/bandit.service.js"])
    out = se.render_text(s, repo="NIETE-Rumi")
    assert "UNMAPPED" in out
    assert "FALLBACK" in out
    assert "/niete-e2e" in out
    assert "feature-map.yaml" in out  # tells the operator how to narrow it


def test_render_lists_a_fanout_file_once_with_all_its_features():
    # Eight repetitions of the same path is a wall the operator scrolls past.
    # One line per CHANGED FILE is the readable shape — that's what they're
    # reasoning about.
    s = _sel(["bot/shared/handlers/text-message.handler.js"])
    out = se.render_text(s, repo="NIETE-Rumi")
    assert out.count("text-message.handler.js") == 1, out
    assert "menu, training" in out          # features listed together on that line
    assert "shared" in out


def test_render_pluralises_the_fallback_count():
    one = se.render_text(_sel(["bot/shared/services/bandit.service.js"]))
    assert "1 changed file is unmapped" in one, one
    two = se.render_text(_sel(["bot/shared/services/bandit.service.js",
                               "bot/database/migrations/018_x.sql"]))
    assert "2 changed files are unmapped" in two, two


def test_render_text_is_quiet_when_nothing_is_selected():
    s = _sel(["README.md"])
    out = se.render_text(s, repo="NIETE-Rumi")
    assert out == "", repr(out)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok", name)
    print("ALL PASS")
