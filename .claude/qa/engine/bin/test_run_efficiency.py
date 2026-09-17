#!/usr/bin/env python3
"""Stdlib assert tests for run_efficiency. Run: python3 test_run_efficiency.py

WHY THIS MODULE EXISTS — the evidence, not a preference (bd-44102):

  validate-run.py gates a run on COVERAGE ("did you drive every scenario?") and shape.
  Nothing gates it on COST. So the speed contract in whatsapp-interaction-map.md is prose,
  and prose decays run over run. On disk, in this repo, right now:

    2026-08-21  all run   146 snapshots / 2.20 MB, no wa-drive, hand-rolled sleeps  -> 4h23m
    2026-08-23  all run    82 snapshots / 0.58 MB, wa-drive loaded                  -> the fix
    2026-08-24  part run   94 snapshots / 0.54 MB, T01 alone burned 17 snapshots    -> regressing
    2026-08-25  run.json says "wa_drive_loaded": false                              -> contract ignored

  The schedule fires every 2h; a full run takes ~3h15m, so roughly every other fire is
  skipped (SCHEDULE.md guard 1). Cost IS coverage here. These tests pin the gate that
  turns the contract into a measured, failing check.

Covers:
  1. scenario_key   — normalises the three real snapshot naming schemes on disk
  2. scan_snapshots — counts, bytes, per-scenario grouping
  3. wait_stats     — the arithmetic the wait budget is read off
  4. evaluate       — the pure verdict, incl. every regression above, and NO false alarm
                      on the one run that did it right
"""
import json
import os
import sys
import tempfile

import run_efficiency as re_


# ── 1. scenario_key: the three naming schemes that actually exist on disk ──────
# 20260821-0632 wrote `c10a.txt`, 20260823-1606 wrote `snap_c11b.txt`,
# 20260824-1004 wrote `snap-t01-launch.txt`. All three are the same run artifact
# and must group to the same scenario, or the per-scenario hotspot check is blind.

def test_scenario_key_handles_all_three_schemes():
    assert re_.scenario_key("snap-t01-launch.txt") == "t01"
    assert re_.scenario_key("snap_c11b.txt") == "c11"
    assert re_.scenario_key("c10a.txt") == "c10"


def test_scenario_key_keeps_bare_feature_prefixes_distinct():
    assert re_.scenario_key("snap_r10.txt") == "r10"
    assert re_.scenario_key("snap-lp03-chap.txt") == "lp03"


def test_scenario_key_ignores_non_scenario_artifacts():
    for n in ("run.json", "REPORT.md", "PER-SCENARIO.md", "TRACKER.md", "findings.json"):
        assert re_.scenario_key(n) is None, n


# ── 2. scan_snapshots ─────────────────────────────────────────────────────────

def _rundir(files):
    d = tempfile.mkdtemp()
    for name, body in files.items():
        with open(os.path.join(d, name), "w", encoding="utf-8") as fh:
            fh.write(body)
    return d


def test_scan_snapshots_counts_groups_and_sizes():
    d = _rundir({"snap-t01-a.txt": "x" * 100,
                 "snap-t01-b.txt": "x" * 100,
                 "snap-r03-a.txt": "x" * 50,
                 "REPORT.md": "not a snapshot"})
    s = re_.scan_snapshots(d)
    assert s["count"] == 3, s
    assert s["bytes"] == 250, s
    assert s["by_scenario"]["t01"] == 2, s
    assert s["by_scenario"]["r03"] == 1, s


def test_scan_snapshots_survives_an_empty_run_dir():
    s = re_.scan_snapshots(_rundir({}))
    assert s == {"count": 0, "bytes": 0, "by_scenario": {}}, s


# ── 3. wait_stats ─────────────────────────────────────────────────────────────

def test_wait_stats_median_is_the_middle_not_the_mean():
    st = re_.wait_stats([1000, 2000, 90000])
    assert st["median_ms"] == 2000, st
    assert st["max_ms"] == 90000, st
    assert st["n"] == 3, st


def test_wait_stats_median_averages_the_middle_pair_when_even():
    assert re_.wait_stats([1000, 2000, 4000, 8000])["median_ms"] == 3000


def test_wait_stats_p90_picks_the_slow_tail():
    st = re_.wait_stats(list(range(1, 101)))       # 1..100 ms
    assert st["p90_ms"] == 90, st


def test_wait_stats_on_no_waits_is_empty_not_a_crash():
    assert re_.wait_stats([])["n"] == 0


# ── 4. evaluate — the verdict ─────────────────────────────────────────────────
# Shape mirrors what load_run() assembles, so a test failure names a real field.

def _rec(**kw):
    base = dict(scenarios=99, wa_drive_loaded=True, snapshots=82, snapshot_bytes=579231,
                by_scenario={"t01": 4}, waits=[9000, 11000, 10300, 14000, 3000, 26000])
    base.update(kw)
    return base


def test_the_good_run_passes_clean():
    """2026-08-23's shape. A gate that cries wolf on the one good run is worthless."""
    v, w = re_.evaluate(_rec())
    assert v == [], v


def test_wa_drive_not_loaded_is_a_violation():
    """The 2026-08-25 regression: run.json literally records wa_drive_loaded false."""
    v, w = re_.evaluate(_rec(wa_drive_loaded=False))
    assert any("wa-drive" in x for x in v), v


def test_a_missing_wait_log_is_a_violation():
    """No waitedMs anywhere == hand-rolled fixed sleeps. The 4h run's root cause: the
    waits log is the only artifact that PROVES adaptive waiting happened."""
    v, w = re_.evaluate(_rec(waits=[]))
    assert any("wait" in x.lower() for x in v), v


def test_uniform_waits_are_flagged_as_fixed_sleeps():
    """Logged, but every wait identical to the millisecond = a constant, not a poll."""
    v, w = re_.evaluate(_rec(waits=[9000] * 12))
    assert any("fixed sleep" in x.lower() for x in v + w), (v, w)


def test_the_146_snapshot_run_is_a_violation():
    """2026-08-21: 146 snapshots / 99 scenarios = 1.47 each, and 2.2 MB of text."""
    v, w = re_.evaluate(_rec(snapshots=146, snapshot_bytes=2196613))
    assert any("snapshot" in x.lower() for x in v), v


def test_the_budget_scales_with_scenario_count():
    """A 4-scenario /status run taking 12 snapshots is fine in absolute terms and must not
    be judged against an `all`-sized budget — and 99 scenarios at 82 must stay clean."""
    small = dict(scenarios=4, snapshot_bytes=4 * 7000, by_scenario={"s01": 2})
    v, _ = re_.evaluate(_rec(snapshots=4, **small))
    assert v == [], v
    v2, _ = re_.evaluate(_rec(snapshots=40, **dict(small, snapshot_bytes=40 * 7000)))
    assert any("snapshot" in x.lower() for x in v2), v2


def test_a_flow_reentry_hotspot_is_named_with_its_scenario():
    """T01 burned 17 snapshots on 2026-08-24 re-walking /training -> program -> level ->
    module. The report must name t01, not just say 'too many snapshots'."""
    v, w = re_.evaluate(_rec(by_scenario={"t01": 17, "r03": 2}))
    assert any("t01" in x for x in v + w), (v, w)
    assert not any("r03" in x for x in v + w), (v, w)


def test_evaluate_never_throws_on_a_half_written_record():
    v, w = re_.evaluate({})          # a crashed run wrote nothing
    assert isinstance(v, list) and isinstance(w, list)


def test_render_never_throws_on_a_half_written_record_either():
    """A crashed run is exactly when someone reads this output. It must render, not traceback."""
    out = re_.render({}, *re_.evaluate({}))
    assert "efficiency" in out


# ── load_run wiring ───────────────────────────────────────────────────────────

def test_load_run_reads_wa_drive_flag_and_waits_from_disk():
    d = _rundir({
        "run.json": json.dumps({"run": "x", "scenarios": 2, "wa_drive_loaded": True}),
        "waits.jsonl": '{"waitedMs": 9000}\n{"waitedMs": 12000}\n',
        "snap-t01-a.txt": "y" * 10,
    })
    rec = re_.load_run(d)
    assert rec["wa_drive_loaded"] is True, rec
    assert rec["waits"] == [9000, 12000], rec
    assert rec["snapshots"] == 1, rec


def test_load_run_treats_a_missing_wa_drive_flag_as_not_loaded():
    """Absent is not innocent: every run before the flag existed hand-rolled its sleeps."""
    d = _rundir({"run.json": json.dumps({"run": "x"})})
    assert re_.load_run(d)["wa_drive_loaded"] is False


def test_load_run_tolerates_a_corrupt_waits_line():
    d = _rundir({"run.json": "{}", "waits.jsonl": '{"waitedMs": 9000}\nnot json\n{"waitedMs": 1}\n'})
    assert re_.load_run(d)["waits"] == [9000, 1]


def test_render_can_relabel_so_the_cost_gate_never_says_FAIL_inside_validate_run():
    """validate-run.py embeds this report but a cost problem must not change its exit code.
    Printing "FAIL" there reads as a failed validation and sends the reader hunting for a
    correctness bug that does not exist."""
    rec = _rec(wa_drive_loaded=False)
    v, w = re_.evaluate(rec)
    embedded = re_.render(rec, v, w, fail_label="cost", warn_label="cost")
    assert "FAIL" not in embedded, embedded
    assert "cost" in embedded, embedded
    assert "FAIL" in re_.render(rec, v, w), "standalone must still say FAIL — it exits 1"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok", name)
    print("ALL PASS")
