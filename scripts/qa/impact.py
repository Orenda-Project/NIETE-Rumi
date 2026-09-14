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


def _empty(base, head, error=""):
    return {"base": base, "head": head, "range": None, "error": error, "paths": [],
            "features": [], "commands": [], "fallback": False, "unmapped": [],
            "full_suite": None, "per_feature": {},
            "verdict": {"spec_freshness": "n/a", "e2e_proof": "n/a"}}


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

    res = _empty(base, head)
    res.update({"range": rng, "paths": paths, "features": seld["features"], "commands": seld["commands"],
                "fallback": seld["fallback"], "unmapped": seld["unmapped"], "full_suite": seld["full_suite"]})
    for f in brief["features"]:
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
            "e2e_proof": proof.get(name, "missing"),
        }
    pf = res["per_feature"]
    if pf:
        res["verdict"]["spec_freshness"] = "stale" if any(v["spec_status"] == "stale" for v in pf.values()) else "synced"
        required = [v for v in pf.values() if not v["only_shared"]]
        if required:
            res["verdict"]["e2e_proof"] = "recorded" if all(v["e2e_proof"] != "missing" for v in required) else "missing"
    return res


def exit_code(res, freshness="warn", proof="warn"):
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


def render_markdown(res, freshness="warn", proof="warn"):
    L = [COMMENT_MARKER, "## QA impact — Gherkin sync + targeted E2E", ""]
    if res.get("error"):
        L += ["⚠️ Could not analyse this range: %s" % res["error"], ""]
        return "\n".join(L)
    if not res["features"]:
        L += ["No WhatsApp-bot feature is affected by this range (docs, portal, infra, tests, or ignored paths only).",
              "Nothing to sync, nothing to drive.", ""]
        return "\n".join(L)
    v = res["verdict"]
    L += ["Range `%s`" % res["range"], "",
          "| Feature | Pulled in by | Gherkin spec | E2E run recorded |", "|---|---|---|---|"]
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
        L.append("| **%s** (%d scenarios) | %s | %s | %s %s |" % (
            name, f["scenario_count"], via, spec, _icon(f["e2e_proof"]), f["e2e_proof"]))
    L += ["", "**Spec freshness: %s** (mode: %s) · **E2E proof: %s** (mode: %s)" % (
        v["spec_freshness"], freshness, v["e2e_proof"], proof), ""]
    if v["spec_freshness"] == "stale":
        stale = [n for n, f in res["per_feature"].items() if f["spec_status"] == "stale"]
        L += ["### Sync the specs first",
              "Own files of **%s** changed but the matching `.feature` did not. In Claude Code, in this clone:" % ", ".join(stale),
              "", "```", "/sync-specs %s" % " ".join(stale), "```",
              "It authors through `gherkin-spec-sync` → `gherkin-test-cases`, never deletes (tags `@obsolete`), then gates on",
              "`python3 .claude/qa/shared/validate_specs.py --only %s`." % ",".join(stale), "",
              "If the change genuinely alters no teacher-visible behaviour, say so where this check can read it — a commit trailer",
              "or a line in the PR body:", "", "```", "Spec-Sync: %s=none-needed (<why>)" % ",".join(stale), "```", ""]
    L += ["### Then drive the targeted E2E", "```"] + res["commands"] + ["```",
          "Against staging, from a Claude Code session with a linked WhatsApp Web tab (`/niete-e2e` checks the",
          "preconditions). The run appends to `.claude/qa/ledgers/runs.jsonl`; commit that file and this check",
          "records the proof.", ""]
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
        L.append("│   %-13s spec: %-12s e2e: %s%s" % (name, f["spec_status"], f["e2e_proof"], extra))
    if v["spec_freshness"] == "stale":
        stale = [n for n, f in res["per_feature"].items() if f["spec_status"] == "stale"]
        L.append("│ specs STALE for %s → in Claude Code: /sync-specs %s" % (", ".join(stale), " ".join(stale)))
        L.append("│   or declare it: commit trailer  Spec-Sync: %s=none-needed (<why>)" % ",".join(stale))
        if freshness == "block":
            L.append("│ QA_HOOKS_STRICT=1 is set: this push is BLOCKED until the specs are synced or declared.")
    L.append("│ then: " + "   ".join(res["commands"]))
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
