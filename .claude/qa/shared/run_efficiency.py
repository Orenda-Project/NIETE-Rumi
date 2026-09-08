#!/usr/bin/env python3
"""Gate a NIETE E2E run on COST, the way validate-run.py gates it on COVERAGE.

WHY (bd-44102) — validate-run.py answers "did you drive every scenario?". Nothing
answered "what did it cost to drive them?", so the speed contract at the top of
whatsapp-interaction-map.md stayed prose, and prose decays. The on-disk record:

    2026-08-21  all   146 snapshots / 2.20 MB · no wa-drive · hand-rolled sleeps -> 4h23m
    2026-08-23  all    82 snapshots / 0.58 MB · wa-drive loaded                  -> the fix
    2026-08-24  part   94 snapshots / 0.54 MB · T01 alone burned 17              -> regressing
    2026-08-25  run.json records "wa_drive_loaded": false                        -> ignored

Cost IS coverage on this suite: the LaunchAgent fires every 2h, a full run takes
~3h15m, so roughly every other fire is skipped (SCHEDULE.md guard 1). Minutes saved
here are scheduled runs gained.

THE THRESHOLDS ARE MEASURED, NOT PREFERRED. Each one is set from the runs above and
carries its evidence in BUDGET. The good run (2026-08-23) must pass clean — a gate
that fires on the one run that did it right teaches people to ignore it.

Usage:
    run_efficiency.py <run_dir> [--json] [--warn-only]
Exit 0 clean, 1 on any violation (unless --warn-only).

Tests: python3 test_run_efficiency.py
"""
import json
import os
import re
import sys

# ── the budget, with the evidence for each number ─────────────────────────────
BUDGET = {
    # 2026-08-23 managed 82 snapshots for 99 scenarios = 0.83 each. 2026-08-21 took
    # 1.47 each. 1.2 sits above the good run's real variance and below the bad one.
    "snapshots_per_scenario": 1.2,
    # A small run must not be judged by a big run's ratio: /status is 4 scenarios and
    # a Flow walk alone is ~4 snapshots.
    "snapshots_floor": 8,
    # Mean snapshot size. Lean (#side hidden) snapshots measured 5.7-7.1 KB across the
    # 08-23 and 08-24 runs; the 08-21 run averaged 15.0 KB because it snapshotted the
    # full page. 10 KB separates them.
    "snapshot_mean_bytes": 10_000,
    # One scenario's full Flow walk is entry -> program -> level -> module -> detail,
    # about 5 snapshots. T01 took 17 on 2026-08-24 by re-entering from the top.
    "snapshots_per_scenario_hotspot": 6,
    # A run that logged >=3 waits all identical to the millisecond did not poll; it slept.
    "uniform_wait_min_samples": 3,
}


# ── pure helpers ──────────────────────────────────────────────────────────────

_SCEN = re.compile(r"^([a-z]{1,3}\d+)")


def scenario_key(filename):
    """Scenario id a snapshot file belongs to, or None if it isn't a scenario snapshot.

    Three naming schemes exist on disk and all three must fold to one id, or the
    per-scenario hotspot check is blind to whichever run wrote the other two:
        snap-t01-launch.txt   (20260824-1004)  -> t01
        snap_c11b.txt         (20260823-1606)  -> c11
        c10a.txt              (20260821-0632)  -> c10
    """
    if not filename.endswith(".txt"):
        return None
    stem = filename[:-4]
    stem = re.sub(r"^snap[-_]?", "", stem, flags=re.I).lower()
    m = _SCEN.match(stem)
    return m.group(1) if m else None


def scan_snapshots(run_dir):
    """Count every snapshot .txt (that is the token cost) but group only the ones whose
    name identifies a scenario (that is the hotspot signal)."""
    count, total, by = 0, 0, {}
    try:
        names = sorted(os.listdir(run_dir))
    except OSError:
        names = []
    for n in names:
        p = os.path.join(run_dir, n)
        if not n.endswith(".txt") or not os.path.isfile(p):
            continue
        count += 1
        try:
            total += os.path.getsize(p)
        except OSError:
            pass
        k = scenario_key(n)
        if k:
            by[k] = by.get(k, 0) + 1
    return {"count": count, "bytes": total, "by_scenario": by}


def wait_stats(waits):
    """Descriptives for the logged adaptive waits. Median and p90, not just the mean —
    the 2026-08-23 sample ran 1.2s to 75.9s, so a mean alone hides both tails."""
    xs = sorted(int(w) for w in waits)
    n = len(xs)
    if not n:
        return {"n": 0, "mean_ms": 0, "median_ms": 0, "p90_ms": 0, "max_ms": 0}
    mid = n // 2
    median = xs[mid] if n % 2 else (xs[mid - 1] + xs[mid]) // 2
    p90 = xs[max(0, min(n - 1, int(round(0.9 * n)) - 1))]
    return {"n": n, "mean_ms": sum(xs) // n, "median_ms": median,
            "p90_ms": p90, "max_ms": xs[-1]}


def evaluate(rec, budget=None):
    """(violations, warnings) for an assembled run record. Pure, and never throws on a
    half-written record — a crashed run must still produce a readable verdict."""
    b = dict(BUDGET, **(budget or {}))
    v, w = [], []
    rec = rec or {}

    scen = int(rec.get("scenarios") or 0)
    snaps = int(rec.get("snapshots") or 0)
    nbytes = int(rec.get("snapshot_bytes") or 0)
    by = rec.get("by_scenario") or {}
    waits = list(rec.get("waits") or [])

    # 1 — wa-drive. The single highest-cost omission on record (4h23m, 2026-08-21).
    if not rec.get("wa_drive_loaded"):
        v.append("wa-drive.js was not loaded — every read then falls back to a hand-rolled "
                 "sleep. Load it first (see §1 Setup) and record wa_drive_loaded in run.json.")

    # 2 — the wait log IS the proof of adaptive waiting. Nothing else distinguishes a
    #     poll that returned in 3s from a constant that slept 9s.
    if not waits:
        v.append("no wait log — waits.jsonl is empty or absent, so nothing proves the run "
                 "polled instead of sleeping. Dump wa.waitLog() at the end of the run.")
    elif len(set(waits)) == 1 and len(waits) >= b["uniform_wait_min_samples"]:
        v.append("every logged wait is identical (%d ms x%d) — that is a fixed sleep, not a "
                 "poll. Use wa.waitForNew(baseline)." % (waits[0], len(waits)))
    elif scen and len(waits) < scen // 4:
        w.append("only %d waits logged for %d scenarios — most reads did not go through "
                 "wa-drive." % (len(waits), scen))

    # 3 — snapshot count, scaled to the run's size with a floor for small runs.
    if scen and snaps:
        allowance = max(b["snapshots_floor"], int(scen * b["snapshots_per_scenario"]))
        if snaps > allowance:
            v.append("%d snapshots for %d scenarios (budget %d) — resolve chat buttons, list "
                     "rows and the composer with wa.tap()/wa.pickListRow(); only the "
                     "cross-origin Flow iframe needs take_snapshot." % (snaps, scen, allowance))

    # 4 — snapshot size: a fat mean means #side was not hidden.
    if snaps and nbytes:
        mean = nbytes // snaps
        if mean > b["snapshot_mean_bytes"]:
            v.append("snapshots average %.1f KB (budget %.1f KB) — inject #side{display:none} "
                     "before snapshotting, and #main{display:none} inside a Flow."
                     % (mean / 1000.0, b["snapshot_mean_bytes"] / 1000.0))

    # 5 — per-scenario hotspots. Name the scenario: "too many snapshots" is unactionable,
    #     "t01 took 17" points straight at the Flow re-entry.
    for k in sorted(by):
        if by[k] > b["snapshots_per_scenario_hotspot"]:
            v.append("%s took %d snapshots (budget %d) — that is a Flow re-entry. Stay inside "
                     "the Flow across consecutive scenarios instead of walking "
                     "/training -> program -> level -> module again."
                     % (k, by[k], b["snapshots_per_scenario_hotspot"]))
    return v, w


def load_run(run_dir):
    """Assemble the record from what the run left on disk."""
    meta = {}
    rj = os.path.join(run_dir, "run.json")
    if os.path.exists(rj):
        try:
            meta = json.load(open(rj, encoding="utf-8")) or {}
        except (ValueError, OSError):
            meta = {}

    waits = []
    wl = os.path.join(run_dir, "waits.jsonl")
    if os.path.exists(wl):
        for line in open(wl, encoding="utf-8", errors="replace"):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue          # a truncated tail must not lose the good lines above it
            if isinstance(obj, dict) and obj.get("waitedMs") is not None:
                waits.append(int(obj["waitedMs"]))

    snaps = scan_snapshots(run_dir)
    scen = meta.get("scenarios") or meta.get("total_scenarios") or 0
    if not scen:
        fp = meta.get("features_planned") or {}
        if isinstance(fp, dict):
            scen = sum(int(x) for x in fp.values() if isinstance(x, int))
    return {
        "run": meta.get("run") or os.path.basename(run_dir.rstrip("/")),
        "scenarios": scen,
        # absent is not innocent: every run before the flag existed slept its way through.
        "wa_drive_loaded": bool(meta.get("wa_drive_loaded")),
        "snapshots": snaps["count"],
        "snapshot_bytes": snaps["bytes"],
        "by_scenario": snaps["by_scenario"],
        "waits": waits,
    }


def render(rec, v, w, fail_label="FAIL", warn_label="warn"):
    """fail_label exists because this renders in TWO places with different consequences:
    standalone (exit 1 — "FAIL" is honest) and embedded in validate-run.py, whose exit code
    a cost problem must NOT change. Printing "FAIL" there reads as a failed validation and
    sends the reader hunting for a correctness bug that isn't there."""
    # .get throughout: a crashed run leaves a half-written record and must still render a
    # readable verdict — the same reason evaluate() never throws.
    rec = rec or {}
    name = rec.get("run") or "?"
    snaps, nbytes = rec.get("snapshots") or 0, rec.get("snapshot_bytes") or 0
    st = wait_stats(rec.get("waits") or [])
    L = ["efficiency — %s" % name,
         "  scenarios        %s" % (rec.get("scenarios") or "?"),
         "  wa-drive loaded  %s" % ("yes" if rec.get("wa_drive_loaded") else "NO"),
         "  snapshots        %d (%.2f MB, mean %.1f KB)"
         % (snaps, nbytes / 1e6, (nbytes / snaps / 1000.0) if snaps else 0)]
    if st["n"]:
        L.append("  waits            n=%d mean %.1fs median %.1fs p90 %.1fs max %.1fs"
                 % (st["n"], st["mean_ms"] / 1000.0, st["median_ms"] / 1000.0,
                    st["p90_ms"] / 1000.0, st["max_ms"] / 1000.0))
    else:
        L.append("  waits            none logged")
    top = sorted((rec.get("by_scenario") or {}).items(), key=lambda kv: -kv[1])[:5]
    if top:
        L.append("  snapshot hotspots %s" % ", ".join("%s=%d" % t for t in top))
    L.append("")
    for x in w:
        L.append("  %-4s  %s" % (warn_label, x))
    for x in v:
        L.append("  %-4s  %s" % (fail_label, x))
    L.append("")
    L.append("%d efficiency problem(s)." % len(v) if v
             else "run %s is within the efficiency budget." % name)
    return "\n".join(L)


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip().splitlines()[-4], file=sys.stderr)
        return 2
    run_dir = argv[1]
    rec = load_run(run_dir)
    v, w = evaluate(rec)
    if "--json" in argv:
        print(json.dumps({"record": rec, "stats": wait_stats(rec["waits"]),
                          "violations": v, "warnings": w}, indent=2))
    else:
        print(render(rec, v, w))
    return 1 if (v and "--warn-only" not in argv) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
