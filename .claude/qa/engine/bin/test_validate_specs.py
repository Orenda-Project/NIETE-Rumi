#!/usr/bin/env python3
"""Stdlib assert tests for validate_specs. Run: python3 test_validate_specs.py

The gate these cover is the one thing standing between an auto-written .feature
file and a suite that silently runs the wrong scenarios. Every error case here is
a way a generated spec can look fine and behave wrong:

  · a duplicated scenario name  → the run reports one result for two scenarios
  · a missing Then             → a scenario that can never fail
  · a mistyped gating tag      → @e2ee is not @e2e, so it is silently NEVER RUN
  · two layer tags             → ambiguous: does the runner pick it up or not?

The warn/error split matters as much as the checks. `tests/features/whatsapp/niete/`
already carries ~40 distinct tags while config/tags.md documents ~30, so erroring
on unknown vocabulary would fail all nine files on day one and the gate would be
switched off within the hour. Unknown tags WARN. Only near-misses of the tags that
actually decide what runs are errors.
"""
import os
import shutil
import tempfile

import validate_specs as vs


# ── helpers ──────────────────────────────────────────────────────────────────

def _spec(body, name="menu"):
    """Write `body` as <name>.feature in a throwaway spec dir; return (dir, path)."""
    d = tempfile.mkdtemp(prefix="specs-")
    p = os.path.join(d, name + ".feature")
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(body)
    return d, p


def _agents(names=("menu",)):
    d = tempfile.mkdtemp(prefix="agents-")
    for n in names:
        with open(os.path.join(d, "niete-%s-agent.md" % n), "w", encoding="utf-8") as fh:
            fh.write("---\norder: 1\n---\n")
    return d


def _codes(problems, level=None):
    return sorted(p["code"] for p in problems if level is None or p["level"] == level)


_BROKEN = """@profile:niete
Feature: broken — a duplicated scenario name hides one result behind another

  @e2e
  Scenario: same name
    When I send "/x"
    Then it works

  @e2e
  Scenario: same name
    When I send "/x"
    Then it also works
"""

GOOD = """@whatsapp @ict @profile:niete @feature:menu @persona:teacher
Feature: NIETE (ICT) WhatsApp bot — the /menu surface

  @e2e @menu @P1
  Scenario: /menu renders the four ICT rows
    Given the NIETE bot chat is open
    When I send "/menu"
    Then the feature list shows exactly four rows

  @e2e @menu @edge @P3
  Scenario: /menu is case-insensitive
    Given the NIETE bot chat is open
    When I send "/MENU"
    Then the menu is shown
"""


# ── the happy path ───────────────────────────────────────────────────────────

def test_valid_file_has_no_errors():
    d, p = _spec(GOOD)
    problems = vs.validate_file(p, agents=_agents())
    assert _codes(problems, "error") == [], _codes(problems, "error")
    shutil.rmtree(d)


def test_valid_file_exits_zero():
    d, _ = _spec(GOOD)
    assert vs.run(d, _agents()) == 0
    shutil.rmtree(d)


# ── structure ────────────────────────────────────────────────────────────────

def test_missing_feature_line_is_an_error():
    d, p = _spec("""@e2e
  Scenario: orphan
    When I send "/menu"
    Then something happens
""")
    assert "E-NOFEATURE" in _codes(vs.validate_file(p, agents=_agents()))
    shutil.rmtree(d)


def test_duplicate_scenario_name_is_an_error():
    d, p = _spec("""@profile:niete
Feature: dupes

  @e2e
  Scenario: the same name
    When I send "/menu"
    Then it works

  @e2e
  Scenario: the same name
    When I send "/menu"
    Then it works too
""")
    assert "E-DUPNAME" in _codes(vs.validate_file(p, agents=_agents()))
    shutil.rmtree(d)


def test_scenario_without_then_is_an_error():
    d, p = _spec("""@profile:niete
Feature: no assertion

  @e2e
  Scenario: does nothing observable
    Given the chat is open
    When I send "/menu"
""")
    assert "E-NOTHEN" in _codes(vs.validate_file(p, agents=_agents()))
    shutil.rmtree(d)


def test_scenario_without_when_only_warns():
    """`Given ... And ... Then ...` is deliberate style in the live suite.

    14 scenarios across 6 of the nine specs fold the action into the Given, some
    with an explicit reason ("Non-destructive to view; do NOT submit on the shared
    driver" — registration.feature:33). Erroring on it would fail the shipped
    suite the day this gate landed. A missing THEN is still an error: that one
    cannot fail, which is a real defect, not a style.
    """
    d, p = _spec("""@profile:niete
Feature: no trigger

  @e2e
  Scenario: asserts with no explicit When
    Given the chat is open
    And a coaching analysis has finished
    Then the menu is shown
""")
    problems = vs.validate_file(p, agents=_agents())
    assert _codes(problems, "error") == [], _codes(problems, "error")
    assert "W-NOWHEN" in _codes(problems, "warn")
    shutil.rmtree(d)


def test_scenario_outline_counts_as_a_scenario():
    d, p = _spec("""@profile:niete
Feature: outlines are scenarios

  @e2e
  Scenario Outline: send <cmd>
    When I send "<cmd>"
    Then the menu is shown
    Examples:
      | cmd   |
      | /menu |
""")
    assert _codes(vs.validate_file(p, agents=_agents()), "error") == []
    shutil.rmtree(d)


# ── tags: the run-gating vocabulary ──────────────────────────────────────────

def test_missing_layer_tag_only_warns():
    """A scenario with no layer tag is documentation, and sometimes deliberately so.

    coaching.feature:82 is `@known-issue` with no `@e2e` on purpose — "Documented,
    not asserted in the default run." Erroring would force a fake @e2e onto a
    scenario nobody intends to run, which is worse than the warning.
    """
    d, p = _spec("""@profile:niete
Feature: unlayered

  @menu @P1
  Scenario: documented, not run
    When I send "/menu"
    Then the menu is shown
""")
    problems = vs.validate_file(p, agents=_agents())
    assert _codes(problems, "error") == [], _codes(problems, "error")
    assert "W-NOLAYER" in _codes(problems, "warn")
    shutil.rmtree(d)


def test_two_layer_tags_is_an_error():
    d, p = _spec("""@profile:niete
Feature: double-layered

  @e2e @smoke
  Scenario: ambiguous layer
    When I send "/menu"
    Then the menu is shown
""")
    assert "E-LAYER" in _codes(vs.validate_file(p, agents=_agents()))
    shutil.rmtree(d)


def test_typo_of_a_gating_tag_is_an_error():
    """@e2ee is the dangerous one: it reads as covered and is never run."""
    d, p = _spec("""@profile:niete
Feature: typo

  @e2ee @menu
  Scenario: silently excluded forever
    When I send "/menu"
    Then the menu is shown
""")
    codes = _codes(vs.validate_file(p, agents=_agents()))
    assert "E-TAGTYPO" in codes, codes
    shutil.rmtree(d)


def test_typo_of_an_exclusion_tag_is_an_error():
    """@destructiv would run a destructive scenario in the default suite."""
    d, p = _spec("""@profile:niete
Feature: typo2

  @e2e @destructiv
  Scenario: mutates real state in the default run
    When I send "/menu"
    Then the menu is shown
""")
    assert "E-TAGTYPO" in _codes(vs.validate_file(p, agents=_agents()))
    shutil.rmtree(d)


def test_unknown_descriptive_tag_only_warns():
    """New vocabulary is normal — the nine live specs use ~40 tags for ~30 documented."""
    d, p = _spec("""@profile:niete
Feature: new vocabulary

  @e2e @brand-new-slice-tag
  Scenario: perfectly fine
    When I send "/menu"
    Then the menu is shown
""")
    problems = vs.validate_file(p, agents=_agents())
    assert _codes(problems, "error") == [], _codes(problems, "error")
    assert "W-UNKNOWNTAG" in _codes(problems, "warn")
    shutil.rmtree(d)


def test_namespaced_tags_are_accepted():
    d, p = _spec("""@whatsapp @profile:niete @feature:menu @persona:teacher
Feature: namespaced

  @e2e @menu
  Scenario: fine
    When I send "/menu"
    Then the menu is shown
""")
    problems = vs.validate_file(p, agents=_agents())
    assert _codes(problems, "error") == []
    assert "W-UNKNOWNTAG" not in _codes(problems, "warn")
    shutil.rmtree(d)


# ── the deletion policy: @obsolete must justify itself ───────────────────────

def test_obsolete_without_a_reason_is_an_error():
    """Auto-sync may never delete. It marks @obsolete — and an unexplained
    @obsolete is indistinguishable from a mistake six months later."""
    d, p = _spec("""@profile:niete
Feature: retiring

  @e2e @obsolete
  Scenario: covers a flow that no longer exists
    When I send "/menu"
    Then the old thing happens
""")
    assert "E-OBSOLETE-NOREASON" in _codes(vs.validate_file(p, agents=_agents()))
    shutil.rmtree(d)


def test_obsolete_with_a_reason_passes():
    d, p = _spec("""@profile:niete
Feature: retiring properly

  @e2e @obsolete
  Scenario: covers a flow that no longer exists
    When I send "/menu"
    Then the old thing happens
    # OBSOLETE 2026-08-28 (bd-59809): menu.service.js:265 dropped the Reading row.
""")
    assert _codes(vs.validate_file(p, agents=_agents()), "error") == []
    shutil.rmtree(d)


# ── the spec must have somebody to run it ────────────────────────────────────

def test_feature_file_without_an_agent_is_an_error():
    d, p = _spec(GOOD, name="teleportation")
    codes = _codes(vs.validate_file(p, agents=_agents(("menu",))))
    assert "E-NOAGENT" in codes, codes
    shutil.rmtree(d)


def test_empty_feature_file_warns():
    d, p = _spec("""@profile:niete
Feature: nothing here yet
""")
    problems = vs.validate_file(p, agents=_agents())
    assert "W-EMPTY" in _codes(problems, "warn")
    shutil.rmtree(d)


# ── the directory run + exit codes ───────────────────────────────────────────

def test_run_returns_one_when_any_file_has_an_error():
    d, _ = _spec(GOOD)
    with open(os.path.join(d, "training.feature"), "w", encoding="utf-8") as fh:
        fh.write(_BROKEN)
    assert vs.run(d, _agents(("menu", "training"))) == 1
    shutil.rmtree(d)


def test_run_ignores_non_feature_files():
    d, _ = _spec(GOOD)
    with open(os.path.join(d, "README.md"), "w", encoding="utf-8") as fh:
        fh.write("not gherkin at all\n")
    assert vs.run(d, _agents()) == 0
    shutil.rmtree(d)


def test_run_can_be_scoped_to_named_features():
    """The commit-triggered gate validates only what the sync touched."""
    d, _ = _spec(GOOD)
    with open(os.path.join(d, "training.feature"), "w", encoding="utf-8") as fh:
        fh.write(_BROKEN)
    agents = _agents(("menu", "training"))
    assert vs.run(d, agents, only=["menu"]) == 0
    assert vs.run(d, agents, only=["training"]) == 1
    shutil.rmtree(d)


# ── the live specs must actually pass their own gate ─────────────────────────

def test_the_real_niete_specs_pass():
    """A gate the shipped specs fail is a gate nobody will keep."""
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, "..", "..", ".."))
    spec_dir = os.path.join(root, "tests", "features", "whatsapp", "niete")
    agents_dir = os.path.join(root, ".claude", "qa", "agents")
    if not os.path.isdir(spec_dir):
        return
    assert vs.run(spec_dir, agents_dir) == 0


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok", name)
    print("ALL PASS")
