#!/usr/bin/env python3
"""test_engine_tenancy.py — the Python engine reads tenants.yaml instead of naming a tenant (bd-9157r).

Run against a fixture built by tests/mkfixture.sh:

    D=$(mktemp -d); bash .claude/qa/engine/tests/mkfixture.sh rumi "$D" >/dev/null
    E2E_FIXTURE="$D" E2E_FIXTURE_SHAPE=rumi python3 .claude/qa/engine/bin/test_engine_tenancy.py

The niete shape must produce EXACTLY what the pre-engine harness produced (one tenant → the same
`/niete-e2e <feature>` commands, no tenant token). The rumi shape must fan out to five tenants and honour
a tenant-scoped rule.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
FIX = os.environ["E2E_FIXTURE"]
SHAPE = os.environ["E2E_FIXTURE_SHAPE"]
ENV = dict(os.environ, CLAUDE_PROJECT_DIR=FIX)
RT = "bot/" if SHAPE == "niete" else ""
SUITE = "niete" if SHAPE == "niete" else "rumi"
CMD = "/niete-e2e" if SHAPE == "niete" else "/rumi-e2e"
TENANTS = ["niete"] if SHAPE == "niete" else ["pk", "tz", "ye", "ps", "ke"]


def py(script, *args, **kw):
    return subprocess.run([sys.executable, os.path.join(HERE, script)] + list(args),
                          capture_output=True, text=True, env=ENV, cwd=FIX, **kw)


def git(*args):
    return subprocess.run(["git", "-C", FIX] + list(args), capture_output=True, text=True, check=True).stdout


def touch_commit(rel, body="// changed\n"):
    with open(os.path.join(FIX, rel), "a") as fh:
        fh.write(body)
    git("add", "-A")
    git("commit", "-qm", "touch " + rel)


def test_select_uses_manifest_spec_dir_and_command():
    touch_commit(RT + "shared/services/menu.service.js")
    r = py("select_e2e.py", "--repo", FIX, "--json", "--committed")
    assert r.returncode == 0, r.stderr
    sel = json.loads(r.stdout)
    assert sel["features"] == ["menu"], sel
    if SHAPE == "niete":
        assert sel["commands"] == ["/niete-e2e menu"], sel["commands"]           # byte-identical to today
        assert sel["tenant_features"] == {"niete": ["menu"]}, sel["tenant_features"]
    else:
        assert sel["tenant_features"] == {t: ["menu"] for t in TENANTS}, sel["tenant_features"]
        assert sel["commands"] == ["/rumi-e2e %s menu" % t for t in TENANTS], sel["commands"]
    # text rendering names the manifest command too
    r = py("select_e2e.py", "--repo", FIX, "--committed")
    assert CMD in r.stdout, r.stdout
    if SHAPE == "rumi":
        assert "/niete-e2e" not in r.stdout, r.stdout


def test_tenant_scoped_rule_only_arms_that_tenant():
    if SHAPE != "rumi":
        return
    touch_commit("shared/services/palestine-pregen-lp.service.js")
    sel = json.loads(py("select_e2e.py", "--repo", FIX, "--json", "--committed").stdout)
    assert sel["features"] == ["menu"], sel
    assert sel["tenant_features"] == {"ps": ["menu"]}, sel["tenant_features"]
    assert sel["commands"] == ["/rumi-e2e ps menu"], sel["commands"]


def test_fan_out_file_reaches_every_tenant_that_has_the_feature():
    touch_commit(RT + "shared/services/whatsapp.service.js")
    sel = json.loads(py("select_e2e.py", "--repo", FIX, "--json", "--committed").stdout)
    assert set(sel["features"]) == {"menu", "status"}, sel["features"]
    if SHAPE == "rumi":
        assert sel["tenant_features"]["ye"] == ["menu"], sel["tenant_features"]       # ye has no status
        assert sel["tenant_features"]["pk"] == ["menu", "status"], sel["tenant_features"]


def test_spec_sync_brief_points_at_manifest_spec_dir():
    touch_commit(RT + "shared/services/status.service.js")
    sel = py("select_e2e.py", "--repo", FIX, "--json", "--committed").stdout
    r = subprocess.run([sys.executable, os.path.join(HERE, "spec_sync.py"), "--selection", "-", "--repo", FIX,
                        "--committed", "--json"], input=sel, capture_output=True, text=True, env=ENV, cwd=FIX)
    assert r.returncode == 0, r.stderr
    brief = json.loads(r.stdout)
    assert brief["spec_dir"].replace(os.sep, "/").endswith("tests/features/whatsapp/" + SUITE), brief["spec_dir"]
    assert any(f["feature"] == "status" and f["spec_path"].replace(os.sep, "/").endswith(SUITE + "/status.feature")
               for f in brief["features"]), brief["features"]


def test_validate_specs_accepts_generic_agent_names_and_tenants_tag():
    r = py("validate_specs.py", "--only", "menu,status")
    assert r.returncode == 0, r.stdout + r.stderr
    if SHAPE != "rumi":
        return
    p = os.path.join(FIX, "tests/features/whatsapp/rumi/menu.feature")
    with open(p, "a") as fh:
        fh.write("\n  @e2e @menu @tenants:ye,zz\n  Scenario: bad tenant\n    When x\n    Then y\n")
    try:
        r = py("validate_specs.py", "--only", "menu")
        assert r.returncode != 0 and "E-TENANT-UNKNOWN" in r.stdout + r.stderr, r.stdout + r.stderr
        assert "zz" in r.stdout + r.stderr
    finally:
        git("checkout", "--", p)
    with open(p, "a") as fh:
        fh.write("\n  @e2e @menu @tenants:ye,pk\n  Scenario: good tenants\n    When x\n    Then y\n")
    try:
        r = py("validate_specs.py", "--only", "menu")
        assert r.returncode == 0, r.stdout + r.stderr
    finally:
        git("checkout", "--", p)


def test_impact_marker_and_command_come_from_manifest():
    base = git("rev-parse", "HEAD~1").strip()
    r = py("impact.py", "--repo", FIX, "--base", base, "--head", "HEAD", "--format", "md",
           "--freshness", "warn", "--proof", "off")
    out = r.stdout + r.stderr
    marker = "<!-- %s-qa-impact -->" % SUITE
    assert marker in out, out[:400]
    other = "<!-- rumi-qa-impact -->" if SHAPE == "niete" else "<!-- niete-qa-impact -->"
    assert other not in out
    r = py("impact.py", "--repo", FIX, "--base", base, "--head", "HEAD", "--format", "text",
           "--freshness", "warn", "--proof", "off")
    assert ".claude/qa/engine/bin/commit-e2e.sh" in r.stdout, r.stdout


def test_scaffold_driver_writes_into_manifest_drivers_dir():
    r = py("scaffold-driver.py", "status")
    assert r.returncode == 0, r.stdout + r.stderr
    assert os.path.isfile(os.path.join(FIX, ".claude/qa/shared/features/status.cjs")), r.stdout
    git("checkout", "--", ".")
    subprocess.run(["git", "-C", FIX, "clean", "-fdq", ".claude/qa/shared/features"], check=True)


def test_check_all_mode_counts_skips_without_a_command_doc():
    r = py("check-all-mode-counts.py")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "skip" in r.stdout.lower(), r.stdout


if __name__ == "__main__":
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            f()
            print("ok  ", n)
    print("test_engine_tenancy[%s]: all ok" % SHAPE)
