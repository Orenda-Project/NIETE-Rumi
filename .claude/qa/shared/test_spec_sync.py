#!/usr/bin/env python3
"""Stdlib assert tests for spec_sync. Run: python3 test_spec_sync.py

spec_sync builds the BRIEF — the deterministic half of the commit-triggered
Gherkin sync. It decides nothing about test design; it assembles exactly the
material the agent needs and nothing else, so the judgement half runs on a
bounded, predictable input.

The cases below are the ways a brief can be quietly useless:
  · a feature selected with no diff attributed to it → the agent has to go hunting
  · an unbounded diff                                → one big commit floods context
  · a shared-file change indistinguishable from an owned one → the agent rewrites
    nine specs for a logging tweak in whatsapp.service.js
  · a missing .feature not flagged                   → new surface, no spec, silence
"""
import os
import shutil
import tempfile

import spec_sync as ss


# ── helpers ──────────────────────────────────────────────────────────────────

def _specs(files):
    """files: {feature_name: body}. Returns a throwaway spec dir."""
    d = tempfile.mkdtemp(prefix="specs-")
    for name, body in files.items():
        with open(os.path.join(d, name + ".feature"), "w", encoding="utf-8") as fh:
            fh.write(body)
    return d


MENU_SPEC = """@profile:niete @feature:menu
Feature: the /menu surface

  @e2e @menu @P1
  Scenario: /menu renders the four rows
    When I send "/menu"
    Then four rows are shown

  @e2e @menu @edge @P3
  Scenario: /menu is case-insensitive
    When I send "/MENU"
    Then the menu is shown
"""


def _selection(features, reasons, **kw):
    sel = {"features": features, "commands": ["/niete-e2e " + f for f in features],
           "reasons": reasons, "unmapped": [], "ignored": [], "out_of_scope": [],
           "not_covered": [], "draft": [], "considered": [], "full_suite": None,
           "fallback": False, "fallback_reason": ""}
    sel.update(kw)
    return sel


def _differ(mapping):
    """Fake git: returns the canned diff for whatever paths it is handed."""
    def differ(paths):
        return "\n".join(mapping.get(p, "") for p in paths).strip()
    return differ


# ── diff bounding ────────────────────────────────────────────────────────────

def test_short_diff_is_untouched():
    text, truncated = ss.truncate("a\nb\nc", 10)
    assert text == "a\nb\nc"
    assert truncated is False


def test_long_diff_is_truncated_and_says_so():
    text, truncated = ss.truncate("\n".join(str(i) for i in range(100)), 10)
    assert truncated is True
    assert len(text.splitlines()) == 11          # 10 kept + the marker line
    assert "truncated" in text.splitlines()[-1].lower()
    assert "90" in text.splitlines()[-1]          # names how much was dropped


def test_truncate_handles_empty():
    assert ss.truncate("", 10) == ("", False)


# ── attribution: which changed file made which feature light up ──────────────

def test_each_selected_feature_gets_its_own_changed_files():
    sel = _selection(
        ["menu", "status"],
        {"menu": [{"path": "bot/shared/services/menu.service.js",
                   "pattern": "bot/shared/services/menu.service.js",
                   "shared": False, "kind": "map"}],
         "status": [{"path": "bot/shared/services/session.service.js",
                     "pattern": "bot/shared/services/session.service.js",
                     "shared": False, "kind": "map"}]})
    d = _specs({"menu": MENU_SPEC, "status": MENU_SPEC})
    brief = ss.build_brief(sel, d, _differ({}))
    by = {f["feature"]: f for f in brief["features"]}
    assert [c["path"] for c in by["menu"]["changed_files"]] == ["bot/shared/services/menu.service.js"]
    assert [c["path"] for c in by["status"]["changed_files"]] == ["bot/shared/services/session.service.js"]
    shutil.rmtree(d)


def test_shared_files_are_labelled_shared():
    """A fan-out file lights up nine features. If the brief does not SAY that, the
    agent rewrites nine specs for a change that touched one shared helper."""
    sel = _selection(
        ["menu"],
        {"menu": [{"path": "bot/shared/services/whatsapp.service.js",
                   "pattern": "bot/shared/services/whatsapp.service.js",
                   "shared": True, "kind": "map"}]})
    d = _specs({"menu": MENU_SPEC})
    brief = ss.build_brief(sel, d, _differ({}))
    cf = brief["features"][0]["changed_files"][0]
    assert cf["shared"] is True
    assert brief["features"][0]["only_shared"] is True
    shutil.rmtree(d)


def test_owned_change_is_not_only_shared():
    sel = _selection(
        ["menu"],
        {"menu": [{"path": "bot/shared/services/whatsapp.service.js", "pattern": "x",
                   "shared": True, "kind": "map"},
                  {"path": "bot/shared/services/menu.service.js", "pattern": "y",
                   "shared": False, "kind": "map"}]})
    d = _specs({"menu": MENU_SPEC})
    brief = ss.build_brief(sel, d, _differ({}))
    assert brief["features"][0]["only_shared"] is False
    shutil.rmtree(d)


# ── the spec inventory the agent edits ───────────────────────────────────────

def test_brief_carries_the_current_scenario_inventory():
    sel = _selection(["menu"], {"menu": [{"path": "p", "pattern": "p",
                                          "shared": False, "kind": "map"}]})
    d = _specs({"menu": MENU_SPEC})
    brief = ss.build_brief(sel, d, _differ({}))
    f = brief["features"][0]
    assert f["spec_exists"] is True
    assert f["scenario_count"] == 2
    assert [s["name"] for s in f["scenarios"]] == [
        "/menu renders the four rows", "/menu is case-insensitive"]
    assert "@e2e" in f["scenarios"][0]["tags"]
    shutil.rmtree(d)


def test_missing_spec_is_flagged_not_skipped():
    """A selected feature with no .feature file is the NEW-SURFACE case — the one
    time the sync must CREATE a file rather than edit one."""
    sel = _selection(["brand-new"], {"brand-new": [{"path": "p", "pattern": "p",
                                                    "shared": False, "kind": "map"}]})
    d = _specs({})
    brief = ss.build_brief(sel, d, _differ({}))
    f = brief["features"][0]
    assert f["spec_exists"] is False
    assert f["scenario_count"] == 0
    assert f["action"] == "create"
    shutil.rmtree(d)


def test_existing_spec_action_is_update():
    sel = _selection(["menu"], {"menu": [{"path": "p", "pattern": "p",
                                          "shared": False, "kind": "map"}]})
    d = _specs({"menu": MENU_SPEC})
    assert ss.build_brief(sel, d, _differ({}))["features"][0]["action"] == "update"
    shutil.rmtree(d)


# ── the diff itself ──────────────────────────────────────────────────────────

def test_diff_is_scoped_to_the_features_own_files():
    sel = _selection(
        ["menu", "status"],
        {"menu": [{"path": "menu.js", "pattern": "menu.js", "shared": False, "kind": "map"}],
         "status": [{"path": "status.js", "pattern": "status.js", "shared": False, "kind": "map"}]})
    d = _specs({"menu": MENU_SPEC, "status": MENU_SPEC})
    brief = ss.build_brief(sel, d, _differ({"menu.js": "+ menu change",
                                            "status.js": "+ status change"}))
    by = {f["feature"]: f for f in brief["features"]}
    assert "menu change" in by["menu"]["diff"]
    assert "status change" not in by["menu"]["diff"]
    shutil.rmtree(d)


def test_per_feature_diff_is_bounded():
    big = "\n".join("+ line %d" % i for i in range(1000))
    sel = _selection(["menu"], {"menu": [{"path": "menu.js", "pattern": "menu.js",
                                          "shared": False, "kind": "map"}]})
    d = _specs({"menu": MENU_SPEC})
    brief = ss.build_brief(sel, d, _differ({"menu.js": big}), max_diff_lines=50)
    f = brief["features"][0]
    assert f["diff_truncated"] is True
    assert len(f["diff"].splitlines()) <= 51
    shutil.rmtree(d)


# ── the edges that must not crash ────────────────────────────────────────────

def test_empty_selection_yields_an_empty_brief():
    d = _specs({})
    brief = ss.build_brief(_selection([], {}), d, _differ({}))
    assert brief["features"] == []
    assert brief["sync_needed"] is False
    shutil.rmtree(d)


def test_selection_with_features_needs_sync():
    sel = _selection(["menu"], {"menu": [{"path": "p", "pattern": "p",
                                          "shared": False, "kind": "map"}]})
    d = _specs({"menu": MENU_SPEC})
    assert ss.build_brief(sel, d, _differ({}))["sync_needed"] is True
    shutil.rmtree(d)


def test_unmapped_paths_are_surfaced_as_map_gaps():
    """An in-scope file matching nothing means feature-map.yaml is behind the code.
    The sync is the moment to notice — it is the only thing reading both."""
    sel = _selection(["menu"], {"menu": [{"path": "p", "pattern": "p",
                                          "shared": False, "kind": "map"}]},
                     unmapped=["bot/shared/services/brand-new.service.js"])
    d = _specs({"menu": MENU_SPEC})
    brief = ss.build_brief(sel, d, _differ({}))
    assert brief["map_gaps"] == ["bot/shared/services/brand-new.service.js"]
    shutil.rmtree(d)


def test_spec_only_change_still_validates_but_needs_no_authoring():
    """Editing a .feature by hand selects that feature (kind == 'spec'). There is
    no source diff to analyse — the file IS the change — so authoring would just
    churn it. It still has to pass the validator."""
    sel = _selection(["menu"], {"menu": [{"path": "tests/features/whatsapp/niete/menu.feature",
                                          "pattern": "", "shared": False, "kind": "spec"}]})
    d = _specs({"menu": MENU_SPEC})
    brief = ss.build_brief(sel, d, _differ({}))
    assert brief["features"][0]["action"] == "validate-only"
    shutil.rmtree(d)


def test_full_suite_selection_covers_every_spec_present():
    sel = _selection([], {}, full_suite="/niete-e2e all")
    d = _specs({"menu": MENU_SPEC, "status": MENU_SPEC})
    brief = ss.build_brief(sel, d, _differ({}))
    assert brief["full_suite"] == "/niete-e2e all"
    assert sorted(f["feature"] for f in brief["features"]) == ["menu", "status"]
    assert all(f["action"] == "validate-only" for f in brief["features"])
    shutil.rmtree(d)


# ── the git command it actually runs ─────────────────────────────────────────

def test_committed_diff_uses_show_not_head_tilde():
    """`git diff HEAD~1..HEAD` explodes on a root commit; `git show HEAD` does not.

    Getting this wrong yields an empty diff, which reads as "nothing changed" —
    the silent under-selection the whole pipeline exists to prevent.
    """
    cmd = ss.diff_command("/r", ["a.js"], committed=True)
    assert "show" in cmd and "HEAD" in cmd
    assert not any("HEAD~1" in c for c in cmd)
    assert cmd[-2:] == ["--", "a.js"]


def test_range_diff_uses_diff_with_the_range():
    cmd = ss.diff_command("/r", ["a.js"], committed=False, rev_range="A...B")
    assert "diff" in cmd and "A...B" in cmd
    assert cmd[-2:] == ["--", "a.js"]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok", name)
    print("ALL PASS")
