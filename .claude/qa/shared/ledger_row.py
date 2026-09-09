#!/usr/bin/env python3
"""ledger_row.py — append ONE runs.jsonl row for a (run × feature), from the runner itself.

Called by run-suite.sh after every feature. Before this, `runs.jsonl` was appended only from the
per-feature agent markdown — i.e. by an agent choosing to — and it went unwritten from 2026-08-24
while runs kept happening. The row keeps the frozen schema (ledger.validate_run) and adds the
provenance the commit-time lane needs, which the validator permits as extra keys:

  commit_sha / branch / dirty / dirty_files   which commit the bot ran; whether the DEVELOPER tree
                                              was dirty (the bot itself ran from a clean worktree)
  cassette {mode, misses, missed_kinds}       replay-strict misses make the row CRITICAL
  spec_sync {brief, validator_exit}           phase 1: the sync brief and the validate_specs verdict
  stack {bot_url, mock_url, worktree, lock_blob}  where the code under test actually ran
  driver / trigger                            synthetic driver phone; commit | push | manual
"""
import argparse, datetime, json, os, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ledger  # noqa: E402


def git(root, *args):
    try:
        return subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return ""


def _attribute_misses(misses, progress_log):
    """Which scenario was running when each cassette miss happened?

    The runner's progress log records `HH:MM:SS.mmm REC <id> <verdict> …` when a scenario FINISHES;
    a miss stamped before a REC belongs to that REC's scenario. Times are compared as seconds-of-day
    (the miss `ts` is ISO UTC, the progress log is UTC clock time), so a run may not straddle midnight
    — acceptable for a lane whose runs take minutes."""
    recs, start = [], None
    try:
        for line in open(progress_log, encoding="utf-8"):
            parts = line.split()
            if len(parts) < 2:
                continue
            try:
                h, m, s = parts[0].split(":")
                t = int(h) * 3600 + int(m) * 60 + float(s)
            except ValueError:
                continue
            start = t if start is None else min(start, t)   # the feature's window opens at its first trace line
            if len(parts) >= 3 and parts[1] == "REC":
                recs.append((t, parts[2]))
    except OSError:
        return {}
    recs.sort()
    by = {}
    for miss in misses:
        ts = str(miss.get("ts", ""))
        if "T" not in ts:
            continue
        try:
            h, m, s = ts.split("T", 1)[1].rstrip("Z").split(":")
            t = int(h) * 3600 + int(m) * 60 + float(s)
        except ValueError:
            continue
        if start is not None and t < start:
            continue   # an EARLIER feature's miss in the same run (the miss log is per run dir)
        sid = next((sid for rec_t, sid in recs if rec_t >= t), None)
        if sid:
            by[sid] = by.get(sid, 0) + 1
    return by


def build_row(a):
    d = json.load(open(os.path.join(a.run_dir, a.feature + ".json"), encoding="utf-8"))
    res = d.get("results", [])
    by = lambda *v: sum(1 for r in res if r.get("verdict") in v)  # noqa: E731
    passed, failed = by("PASS"), by("FAIL")
    blocked = by("BLOCKED", "ERROR")
    skipped = by("SKIP", "DEFERRED", "NOT DRIVEN", "INFO", "PARTIAL")
    row = {
        "run_id": a.run_id, "ts": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "surface": "whatsapp", "tenant": "niete", "env": a.env, "method": a.method, "feature": a.feature,
        "status": ledger.verdict(passed, failed, blocked),
        "summary": {"total": len(res), "passed": passed, "failed": failed, "blocked": blocked, "skipped": skipped},
        "duration_ms": int(a.seconds) * 1000, "drift_count": 0, "discovery_count": 0,
        "coverage": {"scenarios": len(res), "surface_observed": passed + failed, "uncovered": blocked + skipped},
        "evidence_dir": os.path.relpath(a.run_dir, a.root).rstrip("/") + "/",
        "driver": a.driver, "trigger": a.trigger,
    }
    if a.commit:
        # The DEVELOPER tree's cleanliness, minus what the runner itself writes during a run (the ledger
        # append, results, pending markers) — otherwise the second feature's row always read dirty.
        dirty = [l for l in git(a.root, "status", "--porcelain", "--",
                                ".", ":(exclude).claude/qa/ledgers", ":(exclude).claude/qa/results",
                                ":(exclude).claude/.e2e-pending").splitlines() if l.strip()]
        row["commit_sha"] = a.commit
        row["branch"] = git(a.root, "rev-parse", "--abbrev-ref", "HEAD").strip()
        row["dirty"] = bool(dirty)
        row["dirty_files"] = len(dirty)
    if a.method == "mock":
        miss_log = os.path.join(a.run_dir, "cassette-misses.jsonl")
        misses = []
        if os.path.exists(miss_log):
            misses = [json.loads(l) for l in open(miss_log, encoding="utf-8") if l.strip()]
        by_scenario = _attribute_misses(misses, os.path.join(a.run_dir, "progress-%s.log" % a.feature))
        mine = sum(by_scenario.values())   # misses inside THIS feature's window; the log is per run dir
        row["cassette"] = {"mode": "replay-strict", "misses": mine, "misses_in_run": len(misses),
                           "missed_kinds": sorted({m.get("kind") for m in misses if m.get("kind")}),
                           "scenarios_affected": sorted(by_scenario), "by_scenario": by_scenario}
        if mine:
            # A scenario that ran while a vendor answer was missing got the bot's error path, not the
            # product's answer. Its PASS/FAIL is not evidence either way, so the row cannot be HEALTHY.
            row["status"] = "CRITICAL"
            row["cassette"]["note"] = ("vendor answers missing for %s; their verdicts are not trustworthy. Record once with "
                                       "E2E_CASSETTE=record, then rerun." % (", ".join(sorted(by_scenario)) or "an unattributed call"))
        try:
            st = json.load(open(os.path.join(a.run_dir, "stack.json"), encoding="utf-8"))
            row["stack"] = {k: st.get(k) for k in ("bot_url", "mock_url", "worktree", "lock_blob", "queue", "worker")}
        except Exception:
            pass
    fe = d.get("flowEmulator")
    if isinstance(fe, dict) and (fe.get("opened") or fe.get("completed") or fe.get("refused")):
        # Flow verdicts in this row came from the EMULATOR (stored FLOW_JSON + the bot's real endpoint), not
        # from a rendered screen. Named so nobody reads them as a rendering pass.
        row["flows"] = {"via": "flow-emulator", "opened": int(fe.get("opened") or 0), "completed": int(fe.get("completed") or 0),
                        "refused": int(fe.get("refused") or 0), "flows": sorted(set(fe.get("flows") or []))}
    brief = a.spec_sync if a.spec_sync and a.spec_sync != "none" else None
    row["spec_sync"] = {"brief": brief,
                        "validator_exit": int(a.validator_exit) if a.validator_exit not in (None, "") else None}
    if brief:
        try:
            bj = json.load(open(brief if os.path.isabs(brief) else os.path.join(a.root, brief), encoding="utf-8"))
            row["spec_sync"]["sync_needed"] = bool(bj.get("sync_needed"))
            row["spec_sync"]["features"] = sorted(f.get("feature") for f in bj.get("features", []) if f.get("feature"))
        except Exception:
            pass
    return row


def main(argv=None):
    p = argparse.ArgumentParser()
    for k in ("root", "run_dir", "feature", "run_id", "env", "method", "seconds", "driver"):
        p.add_argument("--" + k.replace("_", "-"), required=True)
    p.add_argument("--trigger", default="manual")
    p.add_argument("--commit", default="")
    p.add_argument("--spec-sync", default="")
    p.add_argument("--validator-exit", default="")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args(argv)
    try:
        row = build_row(a)
    except FileNotFoundError as e:
        print("    ledger: no result json for %s (%s) — no row appended" % (a.feature, e))
        return 0
    path = os.path.join(a.root, ".claude", "qa", "ledgers", "runs.jsonl")
    if a.dry_run:
        print(json.dumps(row, ensure_ascii=False))
        return 0
    ledger.append_run(row, path)
    print("    ledger: %s %s → runs.jsonl (%s%s)" % (a.feature, row["status"], a.method,
                                                   (" @" + a.commit[:12]) if a.commit else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
