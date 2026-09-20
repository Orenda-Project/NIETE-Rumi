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
sys.path.insert(0, HERE)
import tenants_lite as _tl  # noqa: E402

# ROOT is the repo under analysis — the one carrying tenants.yaml — never this vendored file's ancestors
# (which are .claude/qa/engine/bin). Falls back to four levels up only for a manifest-less checkout, and
# analyse() then reports "not a guarded repo" before anything is computed (bd-9157r).
try:
    ROOT = _tl.repo_root()
except _tl.ManifestError:
    ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
SHARED = os.path.join(ROOT, ".claude", "qa", "shared")
if SHARED not in sys.path:
    sys.path.insert(0, SHARED)

LEDGER = os.path.join(".claude", "qa", "ledgers", "runs.jsonl")

# Everything repo-specific comes from that repo's tenants.yaml (bd-9157r). `_manifest(repo)` fills this
# at the top of analyse(); the renderers read it. The placeholders below are only what a manifest-less
# repo would see, and analyse() reports such a repo as "not guarded" before any of them are printed.
import tenants_lite as _tl  # noqa: E402

_M = {"marker": "<!-- qa-impact -->", "spec_dir": "", "command": "/e2e",
      "drivers_dir": os.path.join(".claude", "qa", "shared", "features"), "root": ""}
COMMENT_MARKER = _M["marker"]      # module-level alias kept for callers/tests that read `impact.COMMENT_MARKER`


def _manifest(repo):
    global COMMENT_MARKER
    m = _tl.load(_tl.repo_root(repo))
    _M.update({"marker": m.comment_marker, "spec_dir": m.spec_dir, "command": m.command,
               "drivers_dir": m.drivers_dir, "root": m.root})
    COMMENT_MARKER = _M["marker"]
    return m


# ── engine version drift (bd-9157r) ──────────────────────────────────────────────────────────────────────────
# The engine is vendored from rumi-agent-home. A checkout whose ENGINE_VERSION lags the upstream is running an old
# pipeline; one that is AHEAD was edited locally (the drift that took the pipeline down on 2026-09-09). Verdict:
# ok · warn (one minor behind, or upstream unreadable — offline CI must never fail on this) · fail. `fail` only
# affects the exit code when QA_ENGINE_DRIFT=block (default warn), so P2 can land before the check is tightened.
ENGINE_HOME_REPO = "hyasin270/rumi-agent-home"


def _vtuple(s):
    m = re.match(r"^\s*(\d+)\.(\d+)\.(\d+)", s or "")
    return tuple(int(x) for x in m.groups()) if m else None


def drift_verdict(downstream, upstream):
    a, b = _vtuple(downstream), _vtuple(upstream)
    if a is None:
        return "fail"
    if b is None:
        return "warn"
    if a == b:
        return "ok"
    if a > b or a[0] != b[0]:
        return "fail"
    return "warn" if (b[1] - a[1]) <= 1 else "fail"


def engine_versions(repo):
    """{downstream, upstream, verdict}. Upstream is read via `gh api` only in CI (GITHUB_ACTIONS) or when
    QA_ENGINE_UPSTREAM is set (tests); anywhere else it is None → warn at worst."""
    down = None
    p = os.path.join(repo, ".claude", "qa", "engine", "ENGINE_VERSION")
    if os.path.isfile(p):
        with open(p, encoding="utf-8") as fh:
            down = fh.read().strip()
    up = (os.environ.get("QA_ENGINE_UPSTREAM") or "").strip() or None
    if up is None and os.environ.get("GITHUB_ACTIONS"):
        try:
            r = subprocess.run(["gh", "api", "-H", "Accept: application/vnd.github.raw",
                                "repos/%s/contents/.claude/qa/engine/ENGINE_VERSION" % ENGINE_HOME_REPO],
                               capture_output=True, text=True, timeout=20)
            up = r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None
        except (OSError, subprocess.TimeoutExpired):
            up = None
    return {"downstream": down, "upstream": up, "verdict": drift_verdict(down, up)}
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


def _ledger_rows_in_range(repo, rng):
    """The runs.jsonl rows that belong to this range, oldest first.
    repo mode      the ledger is tracked in the bot repo → the rows ADDED by the range (`git diff rng -- runs.jsonl`)
    workspace mode the ledger lives in the tenant layer above the clone (another git repo) → every row in the file
                   whose commit_sha is one of the range's commits"""
    try:
        m = _tl.load(repo)
    except _tl.ManifestError:
        m = None
    rows = []
    if m is not None and m.workspace_mode:
        shas = set(_git(repo, "rev-list", rng).stdout.split())
        path = os.path.join(m.ledgers_abs, "runs.jsonl")
        if os.path.isfile(path):
            for line in open(path, encoding="utf-8"):
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if isinstance(row, dict) and (row.get("commit_sha") or "") in shas:
                    rows.append(row)
        return rows
    r = _git(repo, "diff", rng, "--", LEDGER)
    for line in r.stdout.splitlines():
        if not line.startswith("+") or line.startswith("+++"):
            continue
        try:
            row = json.loads(line[1:])
        except ValueError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def ledger_rows_added(repo, rng):
    """{feature: status} for runs.jsonl rows ADDED in the range — the proof an
    E2E run was driven for this change and recorded the way every run is."""
    out = {}
    for row in _ledger_rows_in_range(repo, rng):
        if row.get("feature"):
            out[row["feature"]] = row.get("status") or "recorded"
    return out


def ledger_misses(repo, rng):
    """{feature: misses} for the MOST RECENT runs.jsonl row of each feature in the range whose latest
    run still has missing cassettes (nested `cassette.misses`, stamped by ledger_row.py). Last row wins,
    matching ledger_rows_added: a later clean run means the cassettes were recorded since."""
    latest = {}
    for row in _ledger_rows_in_range(repo, rng):
        if row.get("feature"):
            latest[row["feature"]] = int((row.get("cassette") or {}).get("misses") or 0)
    return {f: m for f, m in latest.items() if m}


def ledger_regression(repo, rng):
    """{feature: regression dict} from the MOST RECENT row per feature that carries the known-findings
    verdict (ledger_row.py stamps `regression` = {gate, new_failures, known, fixed}). Last row wins."""
    out = {}
    for row in _ledger_rows_in_range(repo, rng):
        if row.get("feature") and isinstance(row.get("regression"), dict):
            out[row["feature"]] = row["regression"]
    return out


def _empty(base, head, error=""):
    return {"base": base, "head": head, "range": None, "error": error, "paths": [],
            "features": [], "commands": [], "fallback": False, "unmapped": [],
            "full_suite": None, "per_feature": {}, "cassette_misses": {},
            "verdict": {"spec_freshness": "n/a", "e2e_proof": "n/a"}}


def analyse(repo, base, head, pr_body="", target_branch=""):
    repo = os.path.abspath(repo)
    try:
        _manifest(repo)
    except _tl.ManifestError as e:
        return _empty(base, head, "not a guarded repo: %s" % e)
    rng, err = resolve_range(repo, base, head)
    if err:
        return _empty(base, head, err)
    try:
        import select_e2e as se
        import spec_sync as ss
    except ImportError as e:  # PyYAML missing, most likely
        return _empty(base, head, "QA tooling unavailable: %s" % e)

    _lm = _tl.load(repo)
    map_path = os.path.join(_lm.config_abs, "feature-map.yaml")
    agents_dir = _lm.agents_abs
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
    brief = ss.build_brief(seld, os.path.join(repo, _M["spec_dir"]), lambda p: "", repo=repo, rev_range=rng)
    tr = trailers(repo, rng, pr_body)
    proof = ledger_rows_added(repo, rng)
    regr = ledger_regression(repo, rng)

    res = _empty(base, head)
    res["engine"] = engine_versions(repo)
    res.update({"range": rng, "paths": paths, "features": seld["features"], "commands": seld["commands"],
                "fallback": seld["fallback"], "unmapped": seld["unmapped"], "full_suite": seld["full_suite"],
                "cassette_misses": ledger_misses(repo, rng)})
    for f in brief["features"]:
        name = f["feature"]
        spec_changed = "%s/%s.feature" % (_M["spec_dir"].replace(os.sep, "/"), name) in paths
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
            "e2e_proof": proof.get(name, "missing"),
            "regression": regr.get(name),
        }
    pf = res["per_feature"]
    if pf:
        res["verdict"]["spec_freshness"] = "stale" if any(v["spec_status"] == "stale" for v in pf.values()) else "synced"
        required = [v for v in pf.values() if not v["only_shared"]]
        if required:
            res["verdict"]["e2e_proof"] = "recorded" if all(v["e2e_proof"] != "missing" for v in required) else "missing"
    return res


def exit_code(res, freshness="warn", proof="warn"):
    if os.environ.get("QA_ENGINE_DRIFT", "warn") == "block" and (res.get("engine") or {}).get("verdict") == "fail":
        return 1
    if res.get("error"):
        return 0
    if freshness == "block" and res["verdict"]["spec_freshness"] == "stale":
        return 1
    if proof == "block" and res["verdict"]["e2e_proof"] == "missing":
        return 1
    return 0


def _icon(status):
    return {"synced": "✅", "none-needed": "✅", "only-shared": "➖", "stale": "❌",
            "HEALTHY": "✅", "DEGRADED": "⚠️", "CRITICAL": "❌", "recorded": "✅", "missing": "⬜"}.get(status, "")


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
    .claude/qa/engine/hooks/lib/mock-lane.sh exactly, so the pre-push report and the commit-time hooks cannot
    disagree about which lane a feature is on. E2E_MOCK_FEATURES overrides for a one-off. ROOT is the
    repo impact.py lives in, which is always the repo it analyses (`--repo .` from the checkout root)."""
    override = os.environ.get("E2E_MOCK_FEATURES")
    if override:
        return {f.strip() for f in override.split(",") if f.strip()}
    d = os.path.join(_M["root"] or ROOT, _M["drivers_dir"])
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
    E2E_CHROME_ON=1, in which case their WhatsApp-Web commands (the manifest's slash command) are shown."""
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
              "bash .claude/qa/engine/bin/commit-e2e.sh %s --features %s" % (head, ",".join(mock)),
              "```",
              "It boots the bot from a detached worktree at this commit behind a mock Graph API, drives the",
              "feature scripts, and appends `.claude/qa/ledgers/runs.jsonl` — the row this check reads as proof.",
              "Vendors are cassette replay-strict: a miss fails loudly and names the scenario. Commit the",
              "`runs.jsonl` row (and any new fixtures).", ""]
    if chrome:
        if chrome_paused():
            L += ["> **Chrome lane (layer 2) is paused** — %s not auto-driven here (no `@mock-lane` driver yet)."
                  % ", ".join("`%s`" % c for c in chrome),
                  "> Scaffold a mock driver to move it onto layer 1: `python3 .claude/qa/engine/bin/scaffold-driver.py <feature>`",
                  "> (then fill in the interactions). Or set `E2E_CHROME_ON=1` to drive it on WhatsApp Web against staging.", ""]
        else:
            L += ["### Then drive the targeted E2E — chrome lane (layer 2)",
                  "```"] + ["%s %s" % (_M["command"], c) for c in chrome] + ["```",
                  "Against staging, from a Claude Code session with a linked WhatsApp Web tab (`%s` checks the" % _M["command"],
                  "preconditions). The run appends to `.claude/qa/ledgers/runs.jsonl`.", ""]
    if not L:  # no features split either way — fall back to whatever the selector emitted
        L += ["### Then drive the targeted E2E", "```"] + (res.get("commands") or []) + ["```", ""]
    return L


def render_markdown(res, freshness="warn", proof="warn"):
    L = [_M["marker"], "## QA impact — Gherkin sync + targeted E2E", ""]
    eng = res.get("engine") or {}
    if eng.get("downstream") is not None or eng.get("verdict") == "fail":
        icon = {"ok": "✅", "warn": "⚠️", "fail": "❌"}.get(eng.get("verdict"), "⚠️")
        L += ["%s Engine: this repo v%s · upstream v%s · %s" % (icon, eng.get("downstream") or "?",
                                                                  eng.get("upstream") or "unknown", eng.get("verdict")), ""]
    if res.get("error"):
        L += ["⚠️ Could not analyse this range: %s" % res["error"], ""]
        return "\n".join(L)
    if not res["features"]:
        L += ["No WhatsApp-bot feature is affected by this range (docs, portal, infra, tests, or ignored paths only).",
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
        spec = "%s %s" % (_icon(f["spec_status"]), f["spec_status"])
        if f["spec_reason"]:
            spec += " — _%s_" % f["spec_reason"]
        if f["spec_status"] == "stale":
            spec += " — `%s.feature` unchanged" % name
        # E2E-run cell answers only "did the mock run for this commit" (+ any regression note).
        proof_cell = "%s %s" % (_icon(f["e2e_proof"]), f["e2e_proof"])
        note = _regression_note(f.get("regression"))
        if note:
            proof_cell += "<br>%s" % note
        # Cassette is its OWN column: a miss is a fixture-recording gap, not the run failing, so it
        # never sits in the E2E cell (where it read like a CRITICAL break). ✅ recorded once a run
        # landed and every vendor answer replayed; — when no run recorded (nothing to say yet).
        cm = (res.get("cassette_misses") or {}).get(name)
        if cm:
            cassette_cell = "📼 %d missing — %s record" % (cm, _cassette_owner())
        elif f["e2e_proof"] != "missing":
            cassette_cell = "✅ recorded"
        else:
            cassette_cell = "—"
        L.append("| **%s** (%d scenarios) | %s | %s | %s | %s |" % (
            name, f["scenario_count"], via, spec, proof_cell, cassette_cell))
    L += ["", "**Spec freshness: %s** (mode: %s) · **E2E proof: %s** (mode: %s)" % (
        v["spec_freshness"], freshness, v["e2e_proof"], proof), ""]
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
              "`python3 .claude/qa/engine/bin/validate_specs.py --only %s`." % ",".join(stale), "",
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
    return "\n".join(L)


def render_text(res, freshness="warn", proof="warn"):
    """Terminal form for the pre-push hook. Empty when there is nothing to say."""
    if res.get("error"):
        return "qa: could not analyse the pushed range — %s" % res["error"]
    if not res["features"]:
        return ""
    v = res["verdict"]
    L = ["┌ QA · pushing %s → touches: %s" % (res["range"], ", ".join(res["features"]))]
    for name in res["features"]:
        f = res["per_feature"][name]
        extra = " (%s.feature unchanged)" % name if f["spec_status"] == "stale" else ""
        cm = (res.get("cassette_misses") or {}).get(name)
        if cm:
            extra += " 📼%d missing" % cm
        L.append("│   %-13s spec: %-12s e2e: %s%s" % (name, f["spec_status"], f["e2e_proof"], extra))
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
        L.append("│   bash .claude/qa/engine/bin/commit-e2e.sh %s --features %s" % (head, ",".join(mock)))
    if chrome:
        if chrome_paused():
            L.append("│ chrome lane (layer 2) PAUSED — %s not auto-driven "
                     "(scaffold-driver.py <feature> to move it onto mock, or E2E_CHROME_ON=1)" % ",".join(chrome))
        else:
            L.append("│ chrome lane (layer 2): " + "   ".join("%s %s" % (_M["command"], c) for c in chrome))
    if not mock and not chrome:
        L.append("│ then: " + "   ".join(res["commands"]))
    regressed = regressed_features(res)
    if regressed:
        L.append("│ ❌ NEW REGRESSIONS: " + ", ".join(
            "%s(%s)" % (n, ",".join(res["per_feature"][n]["regression"]["new_failures"] or ["?"])) for n in regressed))
    elif _any_regression_verdict(res):
        L.append("│ ✅ no new regressions — recorded FAILs are all documented known findings")
    L.append("└ re-run any time: npm run qa:impact")
    return "\n".join(L)


def main(argv):
    ap = argparse.ArgumentParser(description="QA impact of a commit range: features, spec freshness, E2E proof")
    ap.add_argument("--repo", default="", help="repo root (default: the tenants.yaml repo above the cwd)")
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
    repo = a.repo
    if not repo:
        try:
            repo = _tl.repo_root()
        except _tl.ManifestError as e:
            print("[qa-impact] %s" % e, file=sys.stderr)
            return 0          # not a guarded repo: nothing to report, never a failed check
    res = analyse(repo, a.base, a.head, pr_body=body, target_branch=a.target_branch)
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
