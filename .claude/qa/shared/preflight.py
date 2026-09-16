#!/usr/bin/env python3
"""One command for §1 Setup of /niete-e2e — run dir, run.json, driver lock, wa-drive payload.

WHY (bd-44102). The setup steps were never hard, they were just not one command, so the
expensive one got skipped:

    2026-08-21  wa-drive never loaded -> a hand-rolled sleep for every read -> 4h23m run
    2026-08-25  run.json records "wa_drive_loaded": false, four days after the contract

This writes a run.json that already carries what the artifact masthead prints AND what
run_efficiency.py gates on, then hands back the exact payload to load wa-drive. Complying
is now less work than skipping.

    preflight.py <run-id> --mode all --driver 923… --target 923… [--env sandbox|staging|prod]
    preflight.py <run-dir> --mark-wa-drive-loaded      # after the load returns "wa-drive ready"
    preflight.py <run-dir> --finish                    # dump waits.jsonl reminder + cost gate

Scenario counts come from parse-gherkin against the live .feature files, never a hardcoded
number — a stale count is what silently capped `all` below exhaustive on 2026-08-18 (bd-2766).

Tests: python3 test_preflight.py
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
QA = os.path.dirname(HERE)
REPO = os.path.dirname(QA)
if os.path.basename(REPO) == ".claude":
    REPO = os.path.dirname(REPO)
SPECS = os.path.join(REPO, "tests", "features", "whatsapp", "niete")
RESULTS = os.path.join(QA, "results", "whatsapp", "niete")

# observe/attendance are runnable BY NAME but excluded from `all` (operator, 2026-08-18):
# every one of their scenarios needs a precondition nobody has set up, so including them
# pads the report with BLOCKED lines that read as coverage.
ALL_MODE = ["registration", "menu", "training", "lesson-plan", "coaching", "language", "status"]


# ── pure planning core ────────────────────────────────────────────────────────

def plan(mode, counts, order):
    """Which features run, in agent-`order:` sequence, and how many scenarios that is.

    `order` is authoritative: a caller must not be able to reorder the run by how it
    spells the argument. Returns scenarios=None for the SAFE subset, because the tag
    exclusions mean the .feature counts are NOT the runnable count — reporting `all`'s
    99 there is the bd-2766 bug in reverse.
    """
    mode = (mode or "").strip()
    if mode in ("", "safe"):
        return {"mode": "safe", "features": list(order), "scenarios": None,
                "per_feature": {}}
    names = ALL_MODE if mode == "all" else [x.strip() for x in mode.split(",") if x.strip()]
    unknown = [n for n in names if n not in order]
    if unknown:
        raise ValueError("unknown feature(s): %s — known: %s"
                         % (", ".join(unknown), ", ".join(order)))
    feats = [f for f in order if f in set(names)]          # agent order wins
    per = {f: counts[f] for f in feats if f in counts}
    return {"mode": "all" if mode == "all" else "named",
            "features": feats, "scenarios": sum(per.values()), "per_feature": per}


# ── live inputs ───────────────────────────────────────────────────────────────

def feature_order():
    out = subprocess.run([sys.executable, os.path.join(HERE, "feature-order.py")],
                         capture_output=True, text=True)
    feats = []
    for line in out.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0].rstrip(".").isdigit():
            feats.append(parts[1])
    return feats


def spec_counts(features):
    counts = {}
    for f in features:
        spec = os.path.join(SPECS, "%s.feature" % f)
        out = subprocess.run([sys.executable, os.path.join(HERE, "parse-gherkin.py"),
                              spec, "--tag", "@e2e"], capture_output=True, text=True)
        if out.returncode == 0:
            try:
                counts[f] = json.loads(out.stdout)["count"]
            except (ValueError, KeyError):
                pass
    return counts


# ── run.json ──────────────────────────────────────────────────────────────────

def write_run_json(run_dir, run, mode, driver, target, env, counts, order, **extra):
    p = plan(mode, counts, order)
    meta = {
        "run": run,
        "mode": p["mode"] if mode != "all" else "all",
        "env": env,
        "target": target,
        "driver": driver,
        "features_planned": p["per_feature"],
        "scenarios": p["scenarios"],
        # False on purpose: written true up front it would be a lie the moment the load is
        # skipped, which is the exact failure the flag exists to catch.
        "wa_drive_loaded": False,
    }
    meta.update(extra)
    os.makedirs(run_dir, exist_ok=True)
    with open(os.path.join(run_dir, "run.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
        fh.write("\n")
    return meta


INJECTOR = os.path.join(HERE, "inject-wa-drive.js")


def try_inject(run_dir, port=None):
    """Load wa-drive into the live WhatsApp tab over CDP. Returns (ok, detail).

    preflight used to PRINT "now load wa-drive". Printing is exactly what nine agent files
    already do, and the flag still came back false on 2026-08-25 — so it now does it (bd-44105).

    Never raises: Chrome closed, node missing, no linked tab are all ordinary and must
    degrade to a reported failure, not a traceback that blocks the run this exists to start.
    And it never optimistically flips wa_drive_loaded — the injector writes that from
    first-hand knowledge, which is what lets the cost gate trust the flag at all.
    """
    cmd = ["node", INJECTOR, "--run-dir", run_dir, "--quiet"]
    if port:
        cmd += ["--port", str(port)]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except FileNotFoundError:
        return False, "node is not on PATH — cannot inject wa-drive"
    except subprocess.TimeoutExpired:
        return False, "injector timed out after 60s"
    detail = (out.stdout + out.stderr).strip().splitlines()
    return out.returncode == 0, (detail[-1] if detail else "no output from the injector")


def mark_wa_drive_loaded(run_dir):
    p = os.path.join(run_dir, "run.json")
    meta = json.load(open(p, encoding="utf-8"))
    meta["wa_drive_loaded"] = True
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
        fh.write("\n")
    return meta


# ── CLI ───────────────────────────────────────────────────────────────────────

def _rel(path):
    """Repo-relative when the path is inside the repo, otherwise as given — a run dir under
    /var/folders would otherwise print as ../../../../../.., which nobody can paste."""
    r = os.path.relpath(path, REPO)
    return path if r.startswith("..") else r


def _arg(argv, flag, default=None):
    return argv[argv.index(flag) + 1] if flag in argv and argv.index(flag) + 1 < len(argv) else default


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    first = argv[1]

    if "--mark-wa-drive-loaded" in argv:
        m = mark_wa_drive_loaded(first)
        print("wa_drive_loaded = true for %s" % m.get("run"))
        return 0

    if "--finish" in argv:
        print("Finish the run:\n"
              "  1. dump the wait log (one evaluate_script):  __wa.waitLog()\n"
              "     write it to %s/waits.jsonl\n"
              "  2. release the driver lock:\n"
              "     python3 %s/driver_lock.py release --driver <digits>\n"
              % (first.rstrip('/'), HERE))
        return subprocess.run([sys.executable, os.path.join(HERE, "run_efficiency.py"),
                               first, "--warn-only"]).returncode

    run = first
    mode = _arg(argv, "--mode", "all")
    driver = _arg(argv, "--driver")
    target = _arg(argv, "--target", "923025502255")   # sandbox bot (default env since 2026-09-09)
    env = _arg(argv, "--env", "sandbox")
    if not driver:
        print("--driver is required: the runner's OWN linked WhatsApp number, never a "
              "hardcoded one (bd-2748).", file=sys.stderr)
        return 2

    order = feature_order()
    counts = spec_counts(order)
    run_dir = run if os.path.sep in run else os.path.join(RESULTS, run)
    # Provenance the mock lane needs: WHICH driver technology and WHICH commit this run drove.
    # Both are optional so the chrome lane's callers are unchanged.
    extra = {}
    if _arg(argv, "--method"):
        extra["method"] = _arg(argv, "--method")
    if _arg(argv, "--commit-sha"):
        extra["commit_sha"] = _arg(argv, "--commit-sha")
    meta = write_run_json(run_dir, run=os.path.basename(run_dir), mode=mode, driver=driver,
                          target=target, env=env, counts=counts, order=order, **extra)

    print("run dir   %s" % run_dir)
    print("mode      %s · %d feature(s) · %s scenario(s)"
          % (meta["mode"], len(meta["features_planned"]) or len(order),
             meta["scenarios"] if meta["scenarios"] is not None else "tag-filtered"))
    print("order     %s" % " -> ".join(meta["features_planned"] or order))
    print()
    ok, detail = (False, "skipped (--no-inject)") if "--no-inject" in argv \
        else try_inject(run_dir, _arg(argv, "--port"))
    print("wa-drive  %s" % ("INJECTED — wa.sendAndWait is live in the page" if ok
                            else "NOT injected: %s" % detail))
    print()
    print("NEXT, before the first send:")
    print("  1. take the driver lock:")
    print("       python3 %s/driver_lock.py acquire --driver %s --run-id %s"
          % (_rel(HERE), driver, meta["run"]))
    if not ok:
        print("  2. wa-drive is NOT loaded. Open the linked web.whatsapp.com tab in a Chrome")
        print("     started with --remote-debugging-port, then re-run this, or inject by hand:")
        print("       node %s --run-dir %s" % (_rel(INJECTOR), _rel(run_dir)))
        print("     Running without it is what made the 2026-08-21 run take 4h23m —")
        print("     every read falls back to a blind 9-20s sleep for a reply that lands in ~4-11s.")
    print()
    print("At the END of the run: dump __wa.waitLog() to %s/waits.jsonl, then" % _rel(run_dir))
    print("  python3 %s/preflight.py %s --finish" % (_rel(HERE), _rel(run_dir)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
