#!/usr/bin/env python3
"""Stdlib assert tests for check-scenario-coverage.py. Run: python3 test_check_scenario_coverage.py

WHAT THIS GATE IS FOR (bd-bufzl). Writing a Gherkin scenario does not make it run. The runner loads
the driver and collects whatever rec() reports; it never opens the .feature. So a PR can add prose,
satisfy the spec-freshness check, go green, and ship a test that executes nothing. coaching: 33 @e2e
scenarios, 15 implemented, no signal anywhere.

WHY ENROLMENT IS IMPLICIT. A feature is checked once its spec carries id tags. Untagged specs report
"not enrolled" and cannot fail. Backfilling nine specs at once would make this gate red on arrival
across the board, and a gate that is red on arrival is one somebody switches off — the same reasoning
validate_specs.py already applies to unknown tags.
"""
import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "check_scenario_coverage", os.path.join(HERE, "check-scenario-coverage.py"))
cov = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cov)


TAGGED_SPEC = """@whatsapp
Feature: Coaching

  @e2e @P1 @COA01
  Scenario: The menu row asks for a recording
    Given a
    When b
    Then c

  @e2e @P2 @COA16
  Scenario: The session says it is over before the quiz offer
    Given a
    When b
    Then c
"""

UNTAGGED_SPEC = TAGGED_SPEC.replace(" @COA01", "").replace(" @COA16", "")

DRIVER_ONE = """// @mock-lane
exports.run = async ({ api, rec }) => {
  rec('COA01', 'The menu row asks for a recording', 'PASS', {});
};
"""

DRIVER_BOTH = """// @mock-lane
exports.run = async ({ api, rec }) => {
  rec('COA01', 'The menu row asks for a recording', 'PASS', {});
  rec('COA16', 'The session says it is over before the quiz offer', 'PASS', {});
};
"""

DRIVER_ORPHAN = DRIVER_BOTH.replace(
    "  rec('COA16'", "  rec('COA99', 'A scenario nobody wrote down', 'PASS', {});\n  rec('COA16'")


def _tree(spec=TAGGED_SPEC, driver=DRIVER_ONE):
    root = tempfile.mkdtemp(prefix="cov-")
    sdir = os.path.join(root, "tests", "features", "whatsapp", "niete")
    ddir = os.path.join(root, ".claude", "qa", "shared", "features")
    os.makedirs(sdir), os.makedirs(ddir)
    open(os.path.join(sdir, "coaching.feature"), "w", encoding="utf-8").write(spec)
    if driver is not None:
        open(os.path.join(ddir, "coaching.cjs"), "w", encoding="utf-8").write(driver)
    return root


def _codes(root):
    return [f["code"] for f in cov.check_feature(root, "coaching")]


def test_a_spec_scenario_with_no_driver_fails_and_names_it():
    fs = cov.check_feature(_tree(), "coaching")
    miss = [f for f in fs if f["code"] == "E-NODRIVER"]
    assert miss, "a scenario with no driver did not fail: %r" % (fs,)
    assert miss[0]["id"] == "COA16", miss
    assert "quiz offer" in miss[0]["msg"], "the finding does not name the scenario: %r" % miss[0]


def test_a_driver_id_with_no_spec_scenario_fails():
    """The reverse direction: an id surviving a deleted or renamed scenario."""
    fs = cov.check_feature(_tree(driver=DRIVER_ORPHAN), "coaching")
    orphan = [f for f in fs if f["code"] == "E-NOSCENARIO"]
    assert orphan, "an orphan driver id was not reported: %r" % (fs,)
    assert orphan[0]["id"] == "COA99", orphan


def test_no_mock_driver_excuses_a_scenario():
    spec = TAGGED_SPEC.replace("@e2e @P2 @COA16",
                               "@e2e @P2 @COA16 @no-mock-driver")
    fs = cov.check_feature(_tree(spec=spec), "coaching")
    assert not [f for f in fs if f["code"] == "E-NODRIVER"], "an excused scenario still failed: %r" % (fs,)
    assert [f for f in fs if f["code"] == "I-EXCUSED"], "the excuse was not reported at all: %r" % (fs,)


def test_an_untagged_spec_is_not_enrolled_and_cannot_fail():
    fs = cov.check_feature(_tree(spec=UNTAGGED_SPEC), "coaching")
    assert not [f for f in fs if f["code"].startswith("E-")], "an untagged spec failed the gate: %r" % (fs,)
    assert [f for f in fs if f["code"] == "I-NOTENROLLED"], fs


def test_a_feature_in_sync_is_clean():
    fs = cov.check_feature(_tree(driver=DRIVER_BOTH), "coaching")
    assert not [f for f in fs if f["code"].startswith("E-")], fs


def test_main_exits_nonzero_only_on_a_real_gap():
    assert cov.main(["--root", _tree(driver=DRIVER_BOTH)]) == 0, "a clean feature failed the gate"
    assert cov.main(["--root", _tree()]) != 0, "a missing driver did not fail the gate"
    assert cov.main(["--root", _tree(spec=UNTAGGED_SPEC)]) == 0, "an unenrolled feature failed the gate"


def test_an_id_recorded_through_a_WRAPPER_counts_as_driven():
    """coaching.cjs records 8 of its 17 scenarios through deepOnly(), not rec() directly. A checker
    that only sees rec() calls them all missing and fires eight false failures on the day it lands —
    which is how a gate loses its credibility in one PR."""
    driver = DRIVER_BOTH.replace(
        "  rec('COA16', 'The session says it is over before the quiz offer', 'PASS', {});",
        "  const deepOnly = (id, name, v, ev) => rec(id, name, v, ev);\n"
        "  deepOnly('COA16', 'The session says it is over before the quiz offer', 'PASS', {});")
    fs = cov.check_feature(_tree(driver=driver), "coaching")
    assert not [f for f in fs if f["code"] == "E-NODRIVER"], \
        "a wrapper-recorded scenario was reported missing: %r" % (fs,)


if __name__ == "__main__":
    fns = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = 0
    for n, f in fns:
        try:
            f(); print("ok", n)
        except Exception as e:
            failed += 1; print("FAIL", n, "->", type(e).__name__, e)
    print("\n%d/%d passed" % (len(fns) - failed, len(fns)))
    sys.exit(1 if failed else 0)
