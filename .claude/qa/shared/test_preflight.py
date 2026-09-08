#!/usr/bin/env python3
"""Stdlib assert tests for preflight. Run: python3 test_preflight.py

WHY (bd-44102) — §1 Setup of /niete-e2e is three prose steps, and the ones that get skipped
are the ones that cost the most. The record:

    2026-08-21  wa-drive never loaded  -> hand-rolled sleeps for every read -> 4h23m
    2026-08-25  run.json literally records "wa_drive_loaded": false

The steps were never hard, they were just not one command. preflight builds the run dir,
writes a run.json that already carries the fields run_efficiency.py and the artifact
masthead need, and hands back the exact payload to load wa-drive — so complying is less
work than skipping.

Covers the pure planning core (which features, how many scenarios) and the run.json it
writes, both of which the cost gate reads back.
"""
import json
import os
import tempfile

import preflight as pf


COUNTS = {"registration": 13, "menu": 12, "training": 23, "lesson-plan": 10,
          "coaching": 15, "language": 22, "status": 4, "observe": 29, "attendance": 31}
ORDER = ["registration", "menu", "training", "lesson-plan", "coaching", "language",
         "status", "observe", "attendance"]


# ── plan(): which features, in which order, and how many scenarios ────────────

def test_all_is_the_seven_features_not_all_nine():
    """observe and attendance are run-by-name only — they would otherwise pad the report
    with BLOCKED lines for preconditions nobody has set up."""
    p = pf.plan("all", COUNTS, ORDER)
    assert p["features"] == ["registration", "menu", "training", "lesson-plan",
                             "coaching", "language", "status"], p
    assert "observe" not in p["features"] and "attendance" not in p["features"]


def test_all_totals_the_ninety_nine_scenarios_on_record():
    assert pf.plan("all", COUNTS, ORDER)["scenarios"] == 99


def test_naming_a_feature_runs_only_that_one():
    p = pf.plan("training", COUNTS, ORDER)
    assert p["features"] == ["training"] and p["scenarios"] == 23, p


def test_a_named_feature_may_be_one_all_excludes():
    """observe/attendance are excluded from `all` but ARE runnable by name."""
    assert pf.plan("observe", COUNTS, ORDER)["features"] == ["observe"]


def test_plan_follows_the_agent_order_not_the_argument_order():
    """feature-order.py is the single source of truth; a caller must not be able to
    reorder the run by how it spells the argument."""
    p = pf.plan("status,registration,menu", COUNTS, ORDER)
    assert p["features"] == ["registration", "menu", "status"], p


def test_an_unknown_feature_is_rejected_loudly():
    try:
        pf.plan("lessonplan", COUNTS, ORDER)
    except ValueError as e:
        assert "lessonplan" in str(e)
    else:
        raise AssertionError("an unknown feature must not silently plan an empty run")


def test_the_safe_subset_is_not_the_same_as_all():
    """The empty argument excludes tags; the count must therefore be reported as unknown
    rather than as `all`'s 99 — the 2026-08-18 bug (bd-2766) was exactly a stale count
    silently capping `all` below exhaustive."""
    p = pf.plan("", COUNTS, ORDER)
    assert p["mode"] == "safe"
    assert p["scenarios"] is None, p


# ── the run.json the cost gate reads back ─────────────────────────────────────

def _write(mode="all", **kw):
    d = tempfile.mkdtemp()
    return d, pf.write_run_json(d, run="20260825-1200", mode=mode, driver="923028931858",
                                target="923222482222", env="staging",
                                counts=COUNTS, order=ORDER, **kw)


def test_run_json_carries_every_field_the_masthead_and_gate_need():
    d, meta = _write()
    on_disk = json.load(open(os.path.join(d, "run.json")))
    for k in ("run", "target", "driver", "env", "scenarios", "features_planned",
              "wa_drive_loaded"):
        assert k in on_disk, (k, on_disk)
    assert on_disk == meta


def test_wa_drive_loaded_starts_false_so_the_flag_means_something():
    """Written true up front it would be a lie the moment the load is skipped — which is
    the exact failure it exists to catch."""
    _, meta = _write()
    assert meta["wa_drive_loaded"] is False


def test_features_planned_records_the_per_feature_counts():
    _, meta = _write()
    assert meta["features_planned"]["training"] == 23, meta


def test_mark_wa_drive_loaded_flips_the_flag_in_place():
    d, _ = _write()
    pf.mark_wa_drive_loaded(d)
    assert json.load(open(os.path.join(d, "run.json")))["wa_drive_loaded"] is True


def test_mark_wa_drive_loaded_keeps_the_rest_of_run_json():
    d, _ = _write()
    pf.mark_wa_drive_loaded(d)
    assert json.load(open(os.path.join(d, "run.json")))["driver"] == "923028931858"


def test_preflight_output_feeds_the_efficiency_gate_directly():
    """The two halves must actually connect: what preflight writes is what load_run reads."""
    import run_efficiency as eff
    d, _ = _write()
    rec = eff.load_run(d)
    assert rec["scenarios"] == 99, rec
    assert rec["wa_drive_loaded"] is False, rec
    v, _w = eff.evaluate(rec)
    assert any("wa-drive" in x for x in v), v


# ── injection wiring (bd-44105) ───────────────────────────────────────────────
# preflight used to PRINT "now load wa-drive". Printing is what nine agent files already
# do, and the flag still came back false. It now runs the injector itself.

# A port nothing listens on, so "no Chrome" is FORCED rather than assumed. Both of these
# tests used to call try_inject() with no port and assert failure — which silently became a
# no-op assertion the moment a real Chrome was running on 9223 (caught 2026-08-26, mid-run).
DEAD_PORT = 9
def test_try_inject_reports_failure_instead_of_raising_when_chrome_is_absent():
    """Chrome closed is the common case in CI and on a laptop. A preflight that tracebacks
    here would block the run it exists to start."""
    ok, detail = pf.try_inject(tempfile.mkdtemp(), port=DEAD_PORT)
    assert ok is False
    assert isinstance(detail, str) and detail


def test_try_inject_leaves_the_flag_false_on_failure():
    """It must never optimistically flip the flag it cannot verify — that flag being
    trustworthy is the whole reason the cost gate can rely on it."""
    d = tempfile.mkdtemp()
    pf.write_run_json(d, run="r", mode="all", driver="923", target="923", env="staging",
                      counts=COUNTS, order=ORDER)
    pf.try_inject(d, port=DEAD_PORT)
    assert json.load(open(os.path.join(d, "run.json")))["wa_drive_loaded"] is False


def test_try_inject_DOES_flip_the_flag_when_it_really_works():
    """The other half, which the pair above never covered: a real injection must be recorded.
    Skipped unless a Chrome with a live WhatsApp tab is actually reachable."""
    import urllib.request
    try:
        urllib.request.urlopen("http://127.0.0.1:9223/json/version", timeout=2)
    except Exception:
        return                                  # no live Chrome — nothing to assert
    d = tempfile.mkdtemp()
    pf.write_run_json(d, run="r", mode="menu", driver="923", target="923", env="staging",
                      counts=COUNTS, order=ORDER)
    ok, _ = pf.try_inject(d, port=9223)
    if ok:
        assert json.load(open(os.path.join(d, "run.json")))["wa_drive_loaded"] is True


def test_the_injector_the_preflight_shells_out_to_actually_exists():
    """A silently-wrong path here degrades to 'injection failed' forever, which looks
    exactly like Chrome being closed and would never get investigated."""
    assert os.path.exists(pf.INJECTOR), pf.INJECTOR


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok", name)
    print("ALL PASS")
