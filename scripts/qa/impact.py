#!/usr/bin/env python3
"""impact — the QA impact of a commit range, run locally by the pre-push hook.

The git pre-push hook (.githooks/pre-push) runs this over exactly the commits a
push is about to send — any branch — and prints the result in the terminal. The
GitHub workflow .github/workflows/qa-impact.yml runs the SAME analysis on every PR
into sandbox/staging/main and fails the PR on a stale spec (the "hooks only, no
CI" decision of 2026-09-07 was reversed on 2026-09-09 after PRs #835/#836 reached
sandbox unseen — see the workflow's header). By hand: `npm run qa:impact`.

It answers three questions, deterministically, and stops:

  1. WHICH FEATURES did the range touch?        select_e2e + feature-map.yaml
  2. WERE THEIR GHERKIN SPECS SYNCED?           for every feature whose OWN files
     changed (not only a shared fan-out file): did tests/features/whatsapp/niete/
     <feature>.feature change in the same range, or did a commit / the PR body
     carry an explicit `Spec-Sync: <feature>=none-needed (<why>)` trailer?
  3. WAS AN E2E RUN RECORDED?                   did the range append rows for
     those features to .claude/qa/ledgers/runs.jsonl (the durable proof the
     runner writes)?

What it deliberately does NOT do: author a scenario (an agent following
.claude/skills/gherkin-spec-sync does, because it is a judgement) or drive
WhatsApp (a linked browser session is a human precondition). It reports; the
next Claude Code session in the clone does the work.

Modes, per question, from --freshness / --proof (or the QA_SPEC_FRESHNESS /
QA_E2E_PROOF env vars):  off | warn | block.  `warn` reports and exits 0;
`block` exits 1 on `stale` / `missing`. The pre-push hook uses warn unless
QA_HOOKS_STRICT=1.

An undecidable range (unknown sha, shallow clone) is REPORTED and exits 0: it is
not evidence against the PR.

    python3 scripts/qa/impact.py --repo . --base <sha> --head <sha> [--pr-body-file f]
                                    [--target-branch develop] [--format md|text|json]
                                    [--freshness warn] [--proof warn] [--md-out f] [--json-out f]
Tests: python3 scripts/qa/test_impact.py
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SHARED = os.path.join(ROOT, ".claude", "qa", "shared")
if SHARED not in sys.path:
    sys.path.insert(0, SHARED)

COMMENT_MARKER = "<!-- niete-qa-impact -->"
SPEC_DIR = os.path.join("tests", "features", "whatsapp", "niete")
WEB_SPEC_DIR = os.path.join("tests", "features", "web")   # the portal's web lane (bd-hnhlgn.9)
LEDGER = os.path.join(".claude", "qa", "ledgers", "runs.jsonl")
TRAILER_RE = re.compile(r"^[ \t]*Spec-Sync:[ \t]*(.+?)[ \t]*$", re.M | re.I)
MODES = ("off", "warn", "block")


def _git(repo, *args):
    return subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True)


def _exists(repo, sha):
    return _git(repo, "cat-file", "-e", "%s^{commit}" % sha).returncode == 0


def resolve_range(repo, base, head):
    """(range, error). Three-dot when the shas share history — the PR shape —
    else two-dot (a push's before..after)."""
    if not _exists(repo, base):
        return None, "base commit %s is not in this checkout (shallow clone? wrong sha?)" % base[:12]
    if not _exists(repo, head):
        return None, "head commit %s is not in this checkout" % head[:12]
    if _git(repo, "merge-base", base, head).returncode == 0:
        return "%s...%s" % (base, head), ""
    return "%s..%s" % (base, head), ""


def changed_paths(repo, rng):
    r = _git(repo, "diff", "--name-only", rng)
    return [l.strip() for l in r.stdout.splitlines() if l.strip()] if r.returncode == 0 else []


def trailers(repo, rng, pr_body=""):
    """{feature or '*': reason} from `Spec-Sync:` lines in the range's commit
    messages and the PR body. Forms: `menu=none-needed (why)`,
    `menu,status=none-needed (why)`, `none-needed (why)` (= all features)."""
    text = _git(repo, "log", "--format=%B", rng).stdout + "\n" + (pr_body or "")
    out = {}
    for line in TRAILER_RE.findall(text):
        m = re.match(r"^(?:([A-Za-z0-9_,\- ]+?)\s*=\s*)?none-needed\s*(?:\((.*)\))?\s*$", line.strip(), re.I)
        if not m:
            continue
        reason = (m.group(2) or "").strip() or "no reason given"
        names = [n.strip() for n in (m.group(1) or "*").split(",") if n.strip()]
        for n in names:
            out[n] = reason
    return out


def ledger_rows_added(repo, rng):
    """{feature: status} for runs.jsonl rows ADDED in the range — the proof an
    E2E run was driven for this change and recorded the way every run is."""
    r = _git(repo, "diff", rng, "--", LEDGER)
    out = {}
    for line in r.stdout.splitlines():
        if not line.startswith("+") or line.startswith("+++"):
            continue
        try:
            row = json.loads(line[1:])
        except ValueError:
            continue
        if isinstance(row, dict) and row.get("feature"):
            out[row["feature"]] = row.get("status") or "recorded"
    return out


def web_rows_added(repo, rng):
    """{web feature: row} for runs.jsonl rows ADDED in the range with surface "web" — the web lane's proof, kept
    apart from the WhatsApp proof so a portal row can never stand in for a WhatsApp run (or the reverse)."""
    r = _git(repo, "diff", rng, "--", LEDGER)
    out = {}
    for line in r.stdout.splitlines():
        if not line.startswith("+") or line.startswith("+++"):
            continue
        try:
            row = json.loads(line[1:])
        except ValueError:
            continue
        if isinstance(row, dict) and row.get("surface") == "web" and row.get("feature"):
            out[row["feature"]] = row
    return out


def _web_scenario_count(repo, name):
    path = os.path.join(repo, WEB_SPEC_DIR, name + ".feature")
    try:
        return len(re.findall(r"^\s*@[A-Z]{2}\d+\b", open(path).read(), re.M))
    except OSError:
        return 0


def ledger_reasons(repo, rng):
    """{feature: why its latest added row has that status}. Rows written before ledger_row stamped
    `status_reason` get it derived from their own counts, so old rows read the same way."""
    import ledger
    r = _git(repo, "diff", rng, "--", LEDGER)
    out = {}
    for line in r.stdout.splitlines():
        if not line.startswith("+") or line.startswith("+++"):
            continue
        try:
            row = json.loads(line[1:])
        except ValueError:
            continue
        if isinstance(row, dict) and row.get("feature"):
            out[row["feature"]] = row.get("status_reason") or ledger.status_reason(row)
    return out


def ledger_misses(repo, rng):
    """{feature: misses} for the MOST RECENT runs.jsonl row of each feature in the range whose latest
    run still has missing cassettes. A mock-lane run that could not replay a vendor answer records the
    count under the nested `cassette.misses` (see .claude/qa/shared/ledger_row.py — there is no
    top-level `cassette_misses`); the PR comment turns it into an @-mention so the cassette owner
    records/updates the fixture. Last row wins, matching ledger_rows_added: a later clean run (misses 0)
    means the cassettes were recorded since, so the feature drops out and we do not nag."""
    r = _git(repo, "diff", rng, "--", LEDGER)
    latest = {}
    for line in r.stdout.splitlines():
        if not line.startswith("+") or line.startswith("+++"):
            continue
        try:
            row = json.loads(line[1:])
        except ValueError:
            continue
        if isinstance(row, dict) and row.get("feature"):
            latest[row["feature"]] = int((row.get("cassette") or {}).get("misses") or 0)
    return {f: m for f, m in latest.items() if m}


def ledger_regression(repo, rng):
    """{feature: regression dict} from the MOST RECENT row per feature that carries the known-findings
    verdict (ledger_row.py stamps `regression` = {gate, new_failures, known, fixed}). Rows without it
    (chrome runs, rows written before this field) contribute nothing, so the report simply falls back
    to the raw status for those. Last row wins, matching ledger_rows_added."""
    r = _git(repo, "diff", rng, "--", LEDGER)
    out = {}
    for line in r.stdout.splitlines():
        if not line.startswith("+") or line.startswith("+++"):
            continue
        try:
            row = json.loads(line[1:])
        except ValueError:
            continue
        if isinstance(row, dict) and row.get("feature") and isinstance(row.get("regression"), dict):
            out[row["feature"]] = row["regression"]
    return out


def _empty(base, head, error=""):
    return {"base": base, "head": head, "range": None, "error": error, "paths": [],
            "features": [], "commands": [], "fallback": False, "unmapped": [],
            "full_suite": None, "per_feature": {}, "cassette_misses": {},
            "web_features": [], "web_per_feature": {},
            "verdict": {"spec_freshness": "n/a", "e2e_proof": "n/a", "web_e2e_proof": "n/a"}}


def analyse(repo, base, head, pr_body="", target_branch=""):
    repo = os.path.abspath(repo)
    rng, err = resolve_range(repo, base, head)
    if err:
        return _empty(base, head, err)
    try:
        import select_e2e as se
        import spec_sync as ss
    except ImportError as e:  # PyYAML missing, most likely
        return _empty(base, head, "QA tooling unavailable: %s" % e)

    qa = os.path.join(repo, ".claude", "qa")
    map_path = os.path.join(qa, "config", "feature-map.yaml")
    agents_dir = os.path.join(qa, "agents")
    if not os.path.isfile(map_path):
        return _empty(base, head, "no feature map at %s" % map_path)

    paths = changed_paths(repo, rng)
    try:
        fmap = se.load_map(map_path, agents_dir)
        order = se.load_feature_order(agents_dir)
        sel = se.select(paths, fmap, order)
        if target_branch:
            remote = _git(repo, "remote", "get-url", "origin").stdout.strip()
            full = se.wants_full_suite(fmap, remote, target_branch)
            if full:
                sel.full_suite = full
    except Exception as e:  # noqa: BLE001 — a map problem is reported, never a crash
        return _empty(base, head, "selector failed: %s" % e)

    seld = sel.to_dict()
    brief = ss.build_brief(seld, os.path.join(repo, SPEC_DIR), lambda p: "", repo=repo, rev_range=rng)
    tr = trailers(repo, rng, pr_body)
    proof = ledger_rows_added(repo, rng)
    regr = ledger_regression(repo, rng)
    why = ledger_reasons(repo, rng)

    res = _empty(base, head)
    res.update({"range": rng, "paths": paths, "features": seld["features"], "commands": seld["commands"],
                "fallback": seld["fallback"], "unmapped": seld["unmapped"], "full_suite": seld["full_suite"],
                "cassette_misses": ledger_misses(repo, rng)})
    for f in brief["features"]:
        if f.get("lane") == "web":
            continue   # reported in web_per_feature below
        name = f["feature"]
        spec_changed = "%s/%s.feature" % (SPEC_DIR.replace(os.sep, "/"), name) in paths
        reason = ""
        if f["only_shared"]:
            status = "only-shared"
        elif f["action"] == ss.VALIDATE_ONLY or spec_changed:
            status = "synced"
        elif name in tr or "*" in tr:
            status, reason = "none-needed", tr.get(name) or tr.get("*")
        else:
            status = "stale"
        res["per_feature"][name] = {
            "only_shared": f["only_shared"], "spec_changed": spec_changed, "action": f["action"],
            "scenario_count": f["scenario_count"], "spec_status": status, "spec_reason": reason,
            "changed_files": [c["path"] for c in f["changed_files"]],
            # a Spec-Sync none-needed declaration answers the E2E column too (bd-481a2c): no run is asked for.
            "e2e_proof": proof.get(name, "not-needed" if status == "none-needed" else "missing"),
            "e2e_reason": why.get(name, "") if name in proof else "",
            "regression": regr.get(name),
        }
    # The web lane (bd-hnhlgn.9): portal features, reported beside the WhatsApp ones. Never gates the spec check —
    # web specs are not authored by the sync pipeline; the E2E proof follows the same --proof mode.
    web = web_rows_added(repo, rng)
    res["web_features"] = list(seld.get("web_features") or [])
    web_brief = {f["feature"]: f for f in brief["features"] if f.get("lane") == "web"}
    for name in res["web_features"]:
        spec_rel = "%s/%s.feature" % (WEB_SPEC_DIR.replace(os.sep, "/"), name)
        row = web.get(name)
        summ = (row or {}).get("summary") or {}
        # Phase 1 for the portal is the WhatsApp rule exactly (bd-hnhlgn.10): a fan-out is only-shared; the spec (or
        # the test code) being the change, or the spec changing with the code, is synced; a Spec-Sync declaration is
        # none-needed; otherwise the code moved under an unchanged spec — stale.
        b = web_brief.get(name) or {}
        spec_reason = ""
        if b.get("only_shared"):
            spec_status = "only-shared"
        elif b.get("action") == ss.VALIDATE_ONLY or spec_rel in paths:
            spec_status = "synced"
        elif name in tr or "*" in tr:
            spec_status, spec_reason = "none-needed", tr.get(name) or tr.get("*")
        else:
            spec_status = "stale"
        res["web_per_feature"][name] = {
            "spec_status": spec_status, "spec_reason": spec_reason, "only_shared": bool(b.get("only_shared")),
            "changed_files": list((seld.get("web_reasons") or {}).get(name) or []),
            "spec": spec_rel, "spec_changed": spec_rel in paths,
            "scenario_count": _web_scenario_count(repo, name),
            "e2e_proof": (row.get("status") or "recorded") if row else (
                "not-needed" if spec_status == "none-needed" else "missing"),
            "passed": summ.get("passed"), "total": summ.get("total"),
        }
    if res["web_features"]:
        res["verdict"]["web_e2e_proof"] = _proof_verdict(res["web_per_feature"].values())
    pf = res["per_feature"]
    statuses = [v["spec_status"] for v in pf.values()] + [w["spec_status"] for w in res["web_per_feature"].values()]
    if statuses:
        res["verdict"]["spec_freshness"] = "stale" if "stale" in statuses else "synced"
    if pf:
        required = [v for v in pf.values() if not v["only_shared"]]
        if required:
            res["verdict"]["e2e_proof"] = _proof_verdict(required)
    return res


def _proof_verdict(feats):
    """missing if any feature still owes a run; not-needed if every one was declared none-needed; else recorded."""
    proofs = [f["e2e_proof"] for f in feats]
    if "missing" in proofs:
        return "missing"
    return "not-needed" if proofs and all(p == "not-needed" for p in proofs) else "recorded"


def exit_code(res, freshness="warn", proof="warn"):
    if res.get("error"):
        return 0
    if freshness == "block" and res["verdict"]["spec_freshness"] == "stale":
        return 1
    if proof == "block" and res["verdict"]["e2e_proof"] == "missing":
        return 1
    if proof == "block" and res["verdict"].get("web_e2e_proof") == "missing":
        return 1
    return 0


def _shown(status):
    """How an E2E status reads on the PR comment: not-needed → "not needed"."""
    return "not needed" if status == "not-needed" else status


def _icon(status):
    return {"synced": "✅", "none-needed": "✅", "only-shared": "➖", "stale": "❌",
            "HEALTHY": "✅", "DEGRADED": "⚠️", "CRITICAL": "❌", "recorded": "✅", "missing": "⬜", "not-needed": "➖"}.get(status, "")


# What a person reads for each spec status (bd-u8r04u). The keys stay the machine contract —
# analyse(), exit_code() and the QA dashboard read them; only these words are for people.
_SPEC_WORDS = {"synced": "Scenarios updated", "none-needed": "No update needed",
               "only-shared": "Only shared code changed, no update expected"}
_SPEC_SHORT = {"synced": "updated", "none-needed": "not needed", "only-shared": "shared only",
               "stale": "NOT UPDATED"}


def _spec_cell(name, status, reason=""):
    """The PR comment's Gherkin-spec cell: what happened and, when stale, what to do."""
    if status == "stale":
        return ("❌ **Test scenarios not updated** — the %s code changed, but `%s.feature` didn't. "
                "Add or update its scenarios, or, if nothing a teacher sees changed, add "
                "`Spec-Sync: %s=none-needed (<why>)` to the PR description." % (name, name, name))
    cell = "%s %s" % (_icon(status), _SPEC_WORDS.get(status, status))
    if reason:
        cell += " — _%s_" % reason
    return cell


def _cassette_owner():
    owner = (os.environ.get("QA_CASSETTE_OWNER") or "@mah-noor1").strip()
    return owner if owner.startswith("@") else "@" + owner


def _regression_note(reg):
    """One line reconciling a raw run status against the known-findings gate. '' when the row carries
    no verdict (a chrome run, or a row written before the field existed) — the report then shows the
    raw status alone, as before. A CRITICAL run is CLEAN when its only FAILs are documented findings."""
    if not reg:
        return ""
    if reg.get("gate") == "fail":
        return "❌ NEW REGRESSION: %s" % ", ".join(reg.get("new_failures") or ["?"])
    note = "✅ no new regressions"
    if reg.get("known"):
        note += " (%d known: %s)" % (len(reg["known"]), ", ".join(reg["known"]))
    if reg.get("fixed"):
        note += " · ✓ now fixed: %s" % ", ".join(reg["fixed"])
    return note


def regressed_features(res):
    """Features whose most recent recorded run has a NEW regression (unlisted FAIL)."""
    return [n for n in res.get("features", [])
            if (res["per_feature"].get(n, {}).get("regression") or {}).get("gate") == "fail"]


def _any_regression_verdict(res):
    return any(res["per_feature"].get(n, {}).get("regression") for n in res.get("features", []))


def mock_feature_set():
    """Features enrolled in the mock lane (layer 1): those whose driver
    .claude/qa/shared/features/<f>.cjs carries a `@mock-lane` marker in its first 5 lines. This mirrors
    .claude/hooks/lib/mock-lane.sh exactly, so the pre-push report and the commit-time hooks cannot
    disagree about which lane a feature is on. E2E_MOCK_FEATURES overrides for a one-off. ROOT is the
    repo impact.py lives in, which is always the repo it analyses (`--repo .` from the checkout root)."""
    override = os.environ.get("E2E_MOCK_FEATURES")
    if override:
        return {f.strip() for f in override.split(",") if f.strip()}
    d = os.path.join(ROOT, ".claude", "qa", "shared", "features")
    out = set()
    try:
        names = sorted(os.listdir(d))
    except OSError:
        return out
    for fn in names:
        if not fn.endswith(".cjs"):
            continue
        try:
            with open(os.path.join(d, fn), encoding="utf-8") as fh:
                head = [next(fh, "") for _ in range(5)]
        except OSError:
            continue
        if any(re.match(r"^//\s*@mock-lane", ln) for ln in head):
            out.add(fn[:-4])
    return out


def chrome_paused():
    """The chrome lane (layer 2) is paused unless E2E_CHROME_ON=1 — same switch as mock-lane.sh."""
    return os.environ.get("E2E_CHROME_ON", "0") != "1"


def _drive_block(res):
    """The 'how to drive the E2E' recommendation, lane-aware. Mock-capable features go to the mock
    lane (layer 1: commit-e2e.sh, no browser, tests THIS commit). Chrome-only features are layer 2:
    noted as paused (with the scaffold hint that would move them onto the mock lane) unless
    E2E_CHROME_ON=1, in which case their `/niete-e2e` WhatsApp-Web commands are shown."""
    feats = res.get("features") or []
    mock_set = mock_feature_set()
    mock = [f for f in feats if f in mock_set]
    chrome = [f for f in feats if f not in mock_set]
    head = (res.get("head") or "HEAD")[:12]
    L = []
    if mock:
        L += ["### Then drive the targeted E2E — mock lane (layer 1)",
              "Tests THIS commit, no browser, no WhatsApp number:",
              "```",
              "bash .claude/qa/shared/commit-e2e.sh %s --features %s" % (head, ",".join(mock)),
              "```",
              "It boots the bot from a detached worktree at this commit behind a mock Graph API, drives the",
              "feature scripts, and appends `.claude/qa/ledgers/runs.jsonl` — the row this check reads as proof.",
              "Vendors are cassette replay-strict: a miss fails loudly and names the scenario. Commit the",
              "`runs.jsonl` row (and any new fixtures).", ""]
    if chrome:
        if chrome_paused():
            L += ["> **Chrome lane (layer 2) is paused** — %s not auto-driven here (no `@mock-lane` driver yet)."
                  % ", ".join("`%s`" % c for c in chrome),
                  "> Scaffold a mock driver to move it onto layer 1: `python3 .claude/qa/shared/scaffold-driver.py <feature>`",
                  "> (then fill in the interactions). Or set `E2E_CHROME_ON=1` to drive it on WhatsApp Web against staging.", ""]
        else:
            L += ["### Then drive the targeted E2E — chrome lane (layer 2)",
                  "```"] + ["/niete-e2e %s" % c for c in chrome] + ["```",
                  "Against staging, from a Claude Code session with a linked WhatsApp Web tab (`/niete-e2e` checks the",
                  "preconditions). The run appends to `.claude/qa/ledgers/runs.jsonl`.", ""]
    if not L:  # no features split either way — fall back to whatever the selector emitted
        L += ["### Then drive the targeted E2E", "```"] + (res.get("commands") or []) + ["```", ""]
    return L


def _web_markdown(res, proof="warn"):
    """The 'Portal — web lane' section: which portal features this range touched, their spec, and whether a
    web-lane run (runs.jsonl, surface web) was recorded for it. [] when the range touched no portal feature."""
    feats = res.get("web_features") or []
    if not feats:
        return []
    wp = res["web_per_feature"]
    L = ["### Portal — web lane (headless browser, local stack)", "",
         "| Web feature | Pulled in by | Gherkin spec | E2E run recorded |", "|---|---|---|---|"]
    for name in feats:
        w = wp[name]
        files = w["changed_files"]
        via = ", ".join("`%s`" % os.path.basename(p) for p in files[:3]) + (" +%d" % (len(files) - 3) if len(files) > 3 else "")
        spec = _spec_cell(name, w["spec_status"], w.get("spec_reason") or "")
        cell = "%s %s" % (_icon(w["e2e_proof"]), _shown(w["e2e_proof"]))
        if w.get("total"):
            cell += " — %s/%s" % (w.get("passed"), w["total"])
        L.append("| **%s** (%d scenarios) | %s | %s | %s |" % (name, w["scenario_count"], via or "—", spec, cell))
    v = res["verdict"].get("web_e2e_proof", "n/a")
    L += ["", "**Web E2E proof: %s** (mode: %s)" % (_shown(v), proof), ""]
    stale = [n for n in feats if wp[n]["spec_status"] == "stale"]
    if stale:
        L += ["#### Sync the portal specs first",
              "Own files of **%s** changed but the matching `tests/features/web/*.feature` did not. In Claude Code, in this clone:"
              % ", ".join(stale), "", "```", "/sync-specs %s" % " ".join(stale), "```",
              "Then `python3 .claude/qa/shared/validate_specs.py --only %s` — a new scenario also needs its driver code "
              "(a page area: a row in `.claude/qa/web/gen_page_features.py`, re-run it)." % ",".join(stale), "",
              "If the change genuinely alters nothing a user sees, declare it in a commit trailer or the PR body:", "",
              "```", "Spec-Sync: %s=none-needed (<why>)" % ",".join(stale), "```", ""]
    if v == "missing":
        head = (res.get("head") or "HEAD")[:12]
        L += ["Drive it (tests THIS commit, headless, on a local stack — no deploy, no WhatsApp number):", "", "```",
              "bash .claude/qa/shared/commit-e2e.sh %s" % head, "```",
              "or one feature: `npm run e2e:web -- %s` (add `--headed` to watch). Commit the `runs.jsonl` row it appends."
              % feats[0], ""]
    return L


def render_markdown(res, freshness="warn", proof="warn"):
    L = [COMMENT_MARKER, "## QA impact — Gherkin sync + targeted E2E", ""]
    if res.get("error"):
        L += ["⚠️ Could not analyse this range: %s" % res["error"], ""]
        return "\n".join(L)
    if not res["features"]:
        if res.get("web_features"):
            L += ["Range `%s` — no WhatsApp-bot feature affected." % res["range"], "",
                  "**Spec freshness: %s** (mode: %s)" % (res["verdict"]["spec_freshness"], freshness), ""]
            return "\n".join(L + _web_markdown(res, proof))
        L += ["No WhatsApp-bot or portal feature is affected by this range (docs, infra, tests, or ignored paths only).",
              "Nothing to sync, nothing to drive.", ""]
        return "\n".join(L)
    v = res["verdict"]
    L += ["Range `%s`" % res["range"], "",
          "| Feature | Pulled in by | Gherkin spec | E2E run recorded | Cassette |", "|---|---|---|---|---|"]
    for name in res["features"]:
        f = res["per_feature"][name]
        via = "shared file only" if f["only_shared"] else ", ".join("`%s`" % os.path.basename(p) for p in f["changed_files"][:3])
        if len(f["changed_files"]) > 3 and not f["only_shared"]:
            via += " +%d" % (len(f["changed_files"]) - 3)
        spec = _spec_cell(name, f["spec_status"], f["spec_reason"] or "")
        # E2E-run cell answers only "did the mock run for this commit" (+ any regression note).
        proof_cell = "%s %s" % (_icon(f["e2e_proof"]), _shown(f["e2e_proof"]))
        if f.get("e2e_reason"):
            proof_cell += " — %s" % f["e2e_reason"]
        note = _regression_note(f.get("regression"))
        if note:
            proof_cell += "<br>%s" % note
        # Cassette is its OWN column: a miss is a fixture-recording gap, not the run failing, so it
        # never sits in the E2E cell (where it read like a CRITICAL break). ✅ recorded once a run
        # landed and every vendor answer replayed; — when no run recorded (nothing to say yet).
        cm = (res.get("cassette_misses") or {}).get(name)
        if cm:
            cassette_cell = "📼 %d missing — %s record" % (cm, _cassette_owner())
        elif f["e2e_proof"] not in ("missing", "not-needed"):
            cassette_cell = "✅ recorded"
        else:
            cassette_cell = "—"
        L.append("| **%s** (%d scenarios) | %s | %s | %s | %s |" % (
            name, f["scenario_count"], via, spec, proof_cell, cassette_cell))
    L += ["", "**Spec freshness: %s** (mode: %s) · **E2E proof: %s** (mode: %s)" % (
        v["spec_freshness"], freshness, _shown(v["e2e_proof"]), proof), ""]
    regressed = regressed_features(res)
    if regressed:
        L += ["**❌ New regressions in %s** — a scenario broke that is not a documented known finding "
              "(see the E2E column). This is separate from a run being CRITICAL: a CRITICAL run can still "
              "be regression-clean." % ", ".join(regressed), ""]
    elif _any_regression_verdict(res):
        L += ["**✅ No new regressions** — every recorded FAIL is a documented known finding, so a "
              "CRITICAL status here is expected debt, not a break this range introduced.", ""]
    if v["spec_freshness"] == "stale":
        stale = [n for n, f in res["per_feature"].items() if f["spec_status"] == "stale"]
        L += ["### Sync the specs first",
              "Own files of **%s** changed but the matching `.feature` did not. In Claude Code, in this clone:" % ", ".join(stale),
              "", "```", "/sync-specs %s" % " ".join(stale), "```",
              "It authors through `gherkin-spec-sync` → `gherkin-test-cases`, never deletes (tags `@obsolete`), then gates on",
              "`python3 .claude/qa/shared/validate_specs.py --only %s`." % ",".join(stale), "",
              "If the change genuinely alters no teacher-visible behaviour, say so where this check can read it — a commit trailer",
              "or a line in the PR body:", "", "```", "Spec-Sync: %s=none-needed (<why>)" % ",".join(stale), "```", ""]
    # The how-to-drive block is a fix instruction: show it ONLY when something is actionable — a stale
    # spec, an un-recorded E2E run, or missing cassettes. On a fully-green range the developer already
    # drove it (that is what "recorded" means), so the block is noise — collapse it to one line.
    actionable = v["spec_freshness"] == "stale" or v.get("e2e_proof") == "missing" or bool(res.get("cassette_misses"))
    if actionable:
        L += _drive_block(res)
    else:
        L += ["✅ Nothing to drive — specs synced and the E2E run is recorded for this range.", ""]
    if res["fallback"]:
        L += ["> ⚠️ Unmapped in-scope files pulled in the SAFE subset: %s — add them to `feature-map.yaml`." % ", ".join("`%s`" % u for u in res["unmapped"]), ""]
    if res["full_suite"]:
        L += ["> This range targets a promotion branch: the map asks for `%s` (the whole suite)." % res["full_suite"], ""]
    L += _web_markdown(res, proof)
    return "\n".join(L)


def render_text(res, freshness="warn", proof="warn"):
    """Terminal form for the pre-push hook. Empty when there is nothing to say."""
    if res.get("error"):
        return "qa: could not analyse the pushed range — %s" % res["error"]
    if not res["features"] and not res.get("web_features"):
        return ""
    v = res["verdict"]
    L = ["┌ QA · pushing %s → touches: %s" % (res["range"], ", ".join(
        res["features"] + ["portal: %s" % f for f in res.get("web_features") or []]))]
    for name in res["features"]:
        f = res["per_feature"][name]
        extra = ""
        cm = (res.get("cassette_misses") or {}).get(name)
        if cm:
            extra += " 📼%d missing" % cm
        why = " (%s)" % f["e2e_reason"] if f.get("e2e_reason") else ""
        L.append("│   %-13s spec: %-12s e2e: %s%s%s" % (
            name, _SPEC_SHORT.get(f["spec_status"], f["spec_status"]), f["e2e_proof"], why, extra))
    if v["spec_freshness"] == "stale":
        stale = [n for n, f in res["per_feature"].items() if f["spec_status"] == "stale"]
        L.append("│ specs STALE for %s → in Claude Code: /sync-specs %s" % (", ".join(stale), " ".join(stale)))
        L.append("│   or declare it: commit trailer  Spec-Sync: %s=none-needed (<why>)" % ",".join(stale))
        if freshness == "block":
            L.append("│ QA_HOOKS_STRICT=1 is set: this push is BLOCKED until the specs are synced or declared.")
    mock_set = mock_feature_set()
    feats = res["features"]
    mock = [f for f in feats if f in mock_set]
    chrome = [f for f in feats if f not in mock_set]
    head = (res.get("head") or "HEAD")[:12]
    if mock:
        L.append("│ mock lane (layer 1 — tests this commit, no browser):")
        L.append("│   bash .claude/qa/shared/commit-e2e.sh %s --features %s" % (head, ",".join(mock)))
    if chrome:
        if chrome_paused():
            L.append("│ chrome lane (layer 2) PAUSED — %s not auto-driven "
                     "(scaffold-driver.py <feature> to move it onto mock, or E2E_CHROME_ON=1)" % ",".join(chrome))
        else:
            L.append("│ chrome lane (layer 2): " + "   ".join("/niete-e2e %s" % c for c in chrome))
    if not mock and not chrome:
        L.append("│ then: " + "   ".join(res["commands"]))
    regressed = regressed_features(res)
    if regressed:
        L.append("│ ❌ NEW REGRESSIONS: " + ", ".join(
            "%s(%s)" % (n, ",".join(res["per_feature"][n]["regression"]["new_failures"] or ["?"])) for n in regressed))
    elif _any_regression_verdict(res):
        L.append("│ ✅ no new regressions — recorded FAILs are all documented known findings")
    for name in res.get("web_features") or []:
        w = res["web_per_feature"][name]
        L.append("│   %-18s web lane  spec: %-12s e2e: %s" % (
            name, _SPEC_SHORT.get(w["spec_status"], w["spec_status"]), w["e2e_proof"]))
    wstale = [n for n in res.get("web_features") or [] if res["web_per_feature"][n]["spec_status"] == "stale"]
    if wstale:
        L.append("│ portal specs STALE for %s → in Claude Code: /sync-specs %s" % (", ".join(wstale), " ".join(wstale)))
    if res["verdict"].get("web_e2e_proof") == "missing":
        L.append("│ web lane (portal, headless — tests this commit):")
        L.append("│   bash .claude/qa/shared/commit-e2e.sh %s" % (res.get("head") or "HEAD")[:12])
    L.append("└ re-run any time: npm run qa:impact")
    return "\n".join(L)


def main(argv):
    ap = argparse.ArgumentParser(description="QA impact of a commit range: features, spec freshness, E2E proof")
    ap.add_argument("--repo", default=ROOT)
    ap.add_argument("--base", required=True)
    ap.add_argument("--head", required=True)
    ap.add_argument("--pr-body-file", default="")
    ap.add_argument("--target-branch", default="")
    ap.add_argument("--format", choices=("md", "text", "json"), default="md")
    ap.add_argument("--freshness", choices=MODES, default=os.environ.get("QA_SPEC_FRESHNESS", "warn"))
    ap.add_argument("--proof", choices=MODES, default=os.environ.get("QA_E2E_PROOF", "warn"))
    ap.add_argument("--md-out", default="")
    ap.add_argument("--json-out", default="")
    a = ap.parse_args(argv[1:])
    body = ""
    if a.pr_body_file and os.path.isfile(a.pr_body_file):
        with open(a.pr_body_file, encoding="utf-8", errors="replace") as fh:
            body = fh.read()
    res = analyse(a.repo, a.base, a.head, pr_body=body, target_branch=a.target_branch)
    md = render_markdown(res, a.freshness, a.proof)
    if a.md_out:
        with open(a.md_out, "w", encoding="utf-8") as fh:
            fh.write(md + "\n")
    if a.json_out:
        with open(a.json_out, "w", encoding="utf-8") as fh:
            json.dump(res, fh, indent=1)
    out = {"md": md, "text": render_text(res, a.freshness, a.proof), "json": json.dumps(res, indent=1)}[a.format]
    if out:
        print(out)
    return exit_code(res, a.freshness, a.proof)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
