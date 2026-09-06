#!/usr/bin/env python3
"""Driver-session lock for the Chrome-MCP E2E suite (P0-2).

Only ONE run may drive a given WhatsApp test_driver at a time. Without this,
parallel QA sessions on the same driver number interleave messages and
corrupt each other's reads — observed twice on 2026-08-06 (a parallel session drove
a full coaching run + tapped commitment buttons mid-sweep). Mirrors the bead-claim
protocol in .claude/CLAUDE.md, but for the live driver instead of a code worktree.

Lock file: .claude/qa/results/.driver-lock.json  { driver, run_id, pid, heartbeat_utc }
A lock is STALE (ignored / auto-stealable) if its heartbeat is older than --ttl (default 15 min).

Usage (Step 0 of every run, before touching the chat):
  python3 .claude/qa/shared/driver_lock.py acquire --driver <driver-number> --run-id all-2026-08-06-run2
      -> prints ACQUIRED and exits 0, or BLOCKED (+ holder details) and exits 3. STOP the run on BLOCKED.
      (<driver-number> = the run's resolved driver — the runner's OWN linked WhatsApp number, digits no +)
  python3 .claude/qa/shared/driver_lock.py heartbeat --driver <driver-number>   # refresh mid-run (optional)
  python3 .claude/qa/shared/driver_lock.py status    --driver <driver-number>   # inspect (read-only)
  python3 .claude/qa/shared/driver_lock.py release   --driver <driver-number>   # on run exit
"""
import subprocess
import argparse, json, os, sys, datetime

def _lock_root():
    """The MAIN checkout, so every worktree shares ONE lock.

    The path used to derive from __file__, which meant a worktree had its own
    private lock: a run started from a git worktree was invisible to
    one started from the root and both would drive the SAME WhatsApp account at
    once — the exact collision this lock exists to prevent, and precisely the
    situation created by CLAUDE.md rule 21 (work in a worktree) plus a scheduled
    job firing from the root. `--git-common-dir` resolves to the main repo's .git
    from anywhere inside it; its parent is the main checkout."""
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        out = subprocess.run(["git", "rev-parse", "--git-common-dir"],
                             cwd=here, capture_output=True, text=True, timeout=5)
        if out.returncode == 0:
            g = out.stdout.strip()
            if not os.path.isabs(g):
                g = os.path.abspath(os.path.join(here, g))
            return os.path.join(os.path.dirname(g), ".claude", "qa", "results")
    except (OSError, subprocess.SubprocessError):
        pass
    return os.path.join(here, "..", "results")     # not a repo: fall back to local

LOCK_DIR = _lock_root()
LOCK_PATH = os.path.abspath(os.path.join(LOCK_DIR, ".driver-lock.json"))


def _now():
    return datetime.datetime.utcnow().replace(microsecond=0)


def _load():
    try:
        with open(LOCK_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, ValueError):
        return None


def _age_min(lock):
    try:
        hb = datetime.datetime.fromisoformat(lock["heartbeat_utc"].replace("Z", ""))
        return (_now() - hb).total_seconds() / 60.0
    except Exception:
        return 1e9  # unparseable → treat as stale


def _write(driver, run_id):
    os.makedirs(LOCK_DIR, exist_ok=True)
    with open(LOCK_PATH, "w", encoding="utf-8") as fh:
        json.dump({"driver": driver, "run_id": run_id, "pid": os.getpid(),
                   "heartbeat_utc": _now().isoformat() + "Z"}, fh)


def acquire(a):
    lock = _load()
    if lock and lock.get("driver") == a.driver and _age_min(lock) < a.ttl and lock.get("run_id") != a.run_id:
        print("BLOCKED: driver %s is locked by run '%s' (pid %s), heartbeat %.1f min ago (< %d min ttl)."
              % (a.driver, lock.get("run_id"), lock.get("pid"), _age_min(lock), a.ttl))
        print("Another E2E session is driving this number. STOP — do not drive the chat. "
              "Wait for it to finish, or if you're sure it's dead, re-run with --steal.")
        if not a.steal:
            sys.exit(3)
        print("--steal set: taking the lock anyway.")
    _write(a.driver, a.run_id)
    print("ACQUIRED driver %s for run '%s'." % (a.driver, a.run_id))


def heartbeat(a):
    lock = _load()
    if not lock or lock.get("driver") != a.driver:
        sys.exit("no lock for driver %s to heartbeat" % a.driver)
    _write(a.driver, lock.get("run_id"))
    print("heartbeat refreshed for driver %s (run '%s')." % (a.driver, lock.get("run_id")))


def release(a):
    lock = _load()
    if lock and lock.get("driver") == a.driver:
        os.remove(LOCK_PATH)
        print("RELEASED driver %s (was run '%s')." % (a.driver, lock.get("run_id")))
    else:
        print("no matching lock to release for driver %s." % a.driver)


def status(a):
    lock = _load()
    if not lock:
        print("no active driver lock."); return
    stale = _age_min(lock) >= a.ttl
    print(json.dumps({**lock, "age_min": round(_age_min(lock), 1), "stale": stale}, indent=1))


def main():
    p = argparse.ArgumentParser(description="Driver-session lock for the Chrome-MCP E2E suite.")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("acquire", "heartbeat", "release", "status"):
        s = sub.add_parser(name)
        s.add_argument("--driver", required=True)
        s.add_argument("--ttl", type=int, default=15, help="minutes before a lock is considered stale")
        if name == "acquire":
            s.add_argument("--run-id", required=True, dest="run_id")
            s.add_argument("--steal", action="store_true", help="take the lock even if a fresh one exists")
    a = p.parse_args()
    {"acquire": acquire, "heartbeat": heartbeat, "release": release, "status": status}[a.cmd](a)


if __name__ == "__main__":
    main()
