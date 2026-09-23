#!/usr/bin/env python3
"""Stdlib assert tests for scaffold-driver.py. Run: python3 test_scaffold_driver.py

WHY SYNC MODE EXISTS (bd-bufzl). The scaffolder was written on 2026-09-15 for the case it could see
at the time: a NEW feature has a spec and no driver at all. Every feature already had a hand-written
driver by then, so the case that actually bites was never covered — an EXISTING driver falling behind
its spec. coaching reached 33 @e2e scenarios against 15 implemented ones, and the tool declined with
"driver already exists" every time.

The two properties that must never break:
  · existing scenario code is NEVER rewritten — a real driver is worth more than any stub
  · a stub records BLOCKED, never PASS — 18 false-green scenarios are worse than 18 silent ones
"""
import importlib.util
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("scaffold_driver", os.path.join(HERE, "scaffold-driver.py"))
sd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sd)


FEATURE = """@whatsapp @ict
Feature: Coaching

  @e2e @P1 @COA01
  Scenario: The menu row asks for a recording
    Given the chat is open
    When I tap the row
    Then it asks for a recording

  @e2e @P2 @COA02
  Scenario: Declining cancels the session
    Given the chat is open
    When I decline
    Then it cancels

  @e2e @P2 @COA16
  Scenario: The session says it is over before the quiz offer
    Given a report has arrived
    When the commitment question lands
    Then the bot says the session is complete
"""

EXISTING_DRIVER = """// @mock-lane — hand-written driver.
const V = (c, ev) => [c ? 'PASS' : 'FAIL', ev];

exports.run = async ({ api, rec, sleep }) => {
  await api.resetFlow();

  // ══ COA01 — real, hand-written, must survive untouched ═══════════════════
  const row = await api.pickRowAndWait('Classroom Coaching');
  rec('COA01', 'The menu row asks for a recording', ...V(/recording/.test(row.txt || ''), { reply: row.txt }));

  // ══ COA02 ════════════════════════════════════════════════════════════════
  const no = await api.tapAndWait('No', 90000);
  rec('COA02', 'Declining cancels the session', ...V(!!no.ok, { reply: no.txt }));
};
"""


def _tree(feature=FEATURE, driver=EXISTING_DRIVER):
    """A throwaway repo root with a spec and (optionally) a driver."""
    root = tempfile.mkdtemp(prefix="scaffold-")
    sdir = os.path.join(root, "tests", "features", "whatsapp", "niete")
    ddir = os.path.join(root, ".claude", "qa", "shared", "features")
    os.makedirs(sdir), os.makedirs(ddir)
    fp = os.path.join(sdir, "coaching.feature")
    dp = os.path.join(ddir, "coaching.cjs")
    open(fp, "w", encoding="utf-8").write(feature)
    if driver is not None:
        open(dp, "w", encoding="utf-8").write(driver)
    return root, fp, dp


def test_scenarios_reads_the_id_from_the_tag_not_the_position():
    """Positional ids renumber every scenario when one is inserted. The tag is the identity."""
    _, fp, _ = _tree()
    got = sd.scenarios(fp)
    assert [i for i, _ in got] == ["COA01", "COA02", "COA16"], got


def test_sync_appends_only_the_missing_scenario():
    root, fp, dp = _tree()
    before = open(dp, encoding="utf-8").read()
    rc = sd.main(["coaching", "--sync", "--root", root])
    after = open(dp, encoding="utf-8").read()
    assert rc == 0, "sync exited %s" % rc
    assert "'COA16'" in after, "the missing scenario was not appended"
    assert after.count("rec('COA01'") == 1, "COA01 was duplicated"
    assert after.count("rec('COA02'") == 1, "COA02 was duplicated"
    # the real property: everything up to the closing brace of exports.run is byte-identical,
    # because the only safe edit to a hand-written driver is an additive one.
    keep = before[:before.rstrip().rfind("};")]
    assert after.startswith(keep), "existing driver code was rewritten, not appended to"
    assert "rec('COA01', 'The menu row asks for a recording'" in after, "COA01 body lost"


def test_an_appended_stub_records_blocked_never_pass():
    root, fp, dp = _tree()
    sd.main(["coaching", "--sync", "--root", root])
    after = open(dp, encoding="utf-8").read()
    stub = after[after.index("'COA16'"):]
    assert "'BLOCKED'" in stub, "the stub does not record BLOCKED"
    assert "'PASS'" not in stub.split("};")[0], "a stub claimed PASS"


def test_sync_is_a_no_op_when_nothing_is_missing():
    feature = FEATURE.replace("""
  @e2e @P2 @COA16
  Scenario: The session says it is over before the quiz offer
    Given a report has arrived
    When the commitment question lands
    Then the bot says the session is complete
""", "")
    root, fp, dp = _tree(feature=feature)
    before = open(dp, encoding="utf-8").read()
    rc = sd.main(["coaching", "--sync", "--root", root])
    assert rc == 0
    assert open(dp, encoding="utf-8").read() == before, "a no-op sync rewrote the driver"


def test_whole_file_creation_still_works_when_no_driver_exists():
    """The original behaviour must survive: a new feature still gets a full scaffold."""
    root, fp, dp = _tree(driver=None)
    rc = sd.main(["coaching", "--root", root])
    assert rc == 0, "creation exited %s" % rc
    out = open(dp, encoding="utf-8").read()
    assert "@mock-lane" in out, "the marker is missing, so the feature never enrols"
    for sid in ("COA01", "COA02", "COA16"):
        assert "'%s'" % sid in out, "%s missing from the fresh scaffold" % sid


def test_sync_refuses_when_there_is_no_driver_to_sync():
    root, fp, dp = _tree(driver=None)
    rc = sd.main(["coaching", "--sync", "--root", root])
    assert rc != 0, "sync pretended to update a driver that does not exist"


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
