#!/usr/bin/env python3
"""test_tenants_lite.py — the manifest reader every engine script resolves tenants through (bd-9157r).

    python3 .claude/qa/engine/bin/test_tenants_lite.py

Manifests are BLOCK-STYLE YAML ONLY: yaml_lite (the no-PyYAML fallback) rejects non-empty flow
mappings `{a: b}`, and a manifest that only parses with PyYAML installed is the silent-pipeline
failure verify-clean-clone.sh exists to catch.
"""
import os
import subprocess
import sys
import tempfile
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tenants_lite as tl  # noqa: E402

RUMI = textwrap.dedent("""\
    version: 1
    repo: whatsapp-ai-bot
    command: /rumi-e2e
    runtime_scope:
      - shared/**
      - workers/**
      - whatsapp-bot.js
      - flows/**
    spec_suite: rumi
    branches:
      landing: staging
      release: main
      deploy_triggers:
        - staging
        - main
      full_suite_on:
        - main
    keys:
      local: keys/rumi-e2e.env
      record: keys/rumi-record.env
    db:
      env_prefix: RUMI_E2E_SUPABASE
      forbidden_project_refs:
        - jlpenspfdcwxkopaidys
    comment_marker: "<!-- rumi-qa-impact -->"
    tenants:
      pk:
        region_code: PK
        phone_number_id: "886544661200478"
        driver: "923000000011"
        features:
          - menu
          - status
          - lesson-plan
      tz:
        region_code: TZ
        phone_number_id: "1136440339547203"
        driver: "923000000012"
        features:
          - menu
          - status
      ye:
        region_code: YE
        phone_number_id: "1168562573007743"
        driver: "923000000013"
        features:
          - menu
    """)

NIETE = textwrap.dedent("""\
    version: 1
    repo: NIETE-Rumi
    command: /niete-e2e
    spec_suite: niete
    runtime_scope:
      - bot/**
    branches:
      landing: sandbox
      promotion: staging
      release: main
      deploy_triggers:
        - sandbox
        - staging
        - main
    tenants:
      niete:
        region_code: default
        driver: "923000000001"
        features:
          - menu
          - training
    """)


def mkroot(manifest):
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, ".claude", "qa", "config"))
    with open(os.path.join(d, ".claude", "qa", "config", "tenants.yaml"), "w") as fh:
        fh.write(manifest)
    os.makedirs(os.path.join(d, "sub", "dir"))
    return d


def test_repo_root_walks_up_and_prefers_CLAUDE_PROJECT_DIR():
    d = mkroot(RUMI)
    assert tl.repo_root(os.path.join(d, "sub", "dir")) == d
    os.environ["CLAUDE_PROJECT_DIR"] = d
    try:
        assert tl.repo_root("/") == d
    finally:
        del os.environ["CLAUDE_PROJECT_DIR"]


def test_explicit_guarded_start_beats_CLAUDE_PROJECT_DIR():
    a, b = mkroot(RUMI), mkroot(NIETE)
    os.environ["CLAUDE_PROJECT_DIR"] = a
    try:
        assert tl.repo_root(b) == b                      # explicit guarded repo wins
        assert tl.repo_root(os.path.join(b, "sub")) == a  # a non-root start does not: env wins over the walk
    finally:
        del os.environ["CLAUDE_PROJECT_DIR"]


def test_repo_root_ignores_a_manifest_less_CLAUDE_PROJECT_DIR():
    d = mkroot(RUMI)
    os.environ["CLAUDE_PROJECT_DIR"] = tempfile.mkdtemp()
    try:
        assert tl.repo_root(os.path.join(d, "sub")) == d
    finally:
        del os.environ["CLAUDE_PROJECT_DIR"]


def test_repo_root_raises_when_no_manifest():
    d = tempfile.mkdtemp()
    os.environ.pop("CLAUDE_PROJECT_DIR", None)
    try:
        tl.repo_root(d)
        assert False, "should raise"
    except tl.ManifestError:
        pass


def test_fields_and_defaults():
    m = tl.load(mkroot(RUMI))
    assert m.command == "/rumi-e2e" and m.spec_suite == "rumi"
    assert m.spec_dir == os.path.join("tests", "features", "whatsapp", "rumi")   # derived from spec_suite
    assert m.drivers_dir == os.path.join(".claude", "qa", "shared", "features")  # default
    assert m.agents_dir == os.path.join(".claude", "qa", "agents")               # default
    assert m.command_doc == os.path.join(".claude", "commands", "rumi-e2e.md")    # derived from command
    assert m.bot_root == "bot" and m.e2e_scripts == os.path.join("bot", "scripts", "e2e")   # defaults (NIETE layout)
    assert m.get("bot_root") == "bot" and m.get("e2e_scripts") == m.e2e_scripts
    assert m.branches["deploy_triggers"] == ["staging", "main"]
    assert m.branches["full_suite_on"] == ["main"]
    assert m.db["env_prefix"] == "RUMI_E2E_SUPABASE"
    assert m.keys["local"] == "keys/rumi-e2e.env"
    assert m.comment_marker == "<!-- rumi-qa-impact -->"
    assert list(m.tenants) == ["pk", "tz", "ye"]
    assert m.tenant("tz")["phone_number_id"] == "1136440339547203"
    assert m.tenant("ye")["chrome"] is None                                     # default
    assert m.multi is True


def test_tenants_for_and_fan_out():
    m = tl.load(mkroot(RUMI))
    assert m.tenants_for("menu") == ["pk", "tz", "ye"]
    assert m.tenants_for("lesson-plan") == ["pk"]
    assert m.tenant_features(["menu", "lesson-plan"]) == {"pk": ["menu", "lesson-plan"], "tz": ["menu"], "ye": ["menu"]}
    assert m.tenant_features(["observe"]) == {}


def test_single_tenant_manifest_is_the_niete_shape():
    m = tl.load(mkroot(NIETE))
    assert m.spec_dir == os.path.join("tests", "features", "whatsapp", "niete")
    assert m.command == "/niete-e2e"
    assert m.command_doc == os.path.join(".claude", "commands", "niete-e2e.md")
    assert m.tenants_for("training") == ["niete"]
    assert m.branches["deploy_triggers"] == ["sandbox", "staging", "main"]
    assert m.branches["full_suite_on"] == ["main"]                               # defaults to release
    assert m.comment_marker == "<!-- niete-qa-impact -->"                        # derived from spec_suite
    assert m.multi is False
    assert m.keys == {} and m.db == {}


def test_get_dotted_and_computed():
    m = tl.load(mkroot(RUMI))
    assert m.get("command") == "/rumi-e2e"
    assert m.get("branches.deploy_triggers") == ["staging", "main"]
    assert m.get("keys.local") == "keys/rumi-e2e.env"
    assert m.get("spec_dir") == m.spec_dir
    assert m.get("tenant_tools.training_db") is None                            # optional block, absent → None


def test_unknown_tenant_raises():
    m = tl.load(mkroot(RUMI))
    try:
        m.tenant("xx")
        assert False, "should raise"
    except tl.ManifestError as e:
        assert "xx" in str(e) and "pk" in str(e)


def test_missing_required_key_raises():
    try:
        tl.load(mkroot("version: 1\nrepo: x\n"))
        assert False, "should raise"
    except tl.ManifestError as e:
        assert "command" in str(e) and "tenants" in str(e)


def test_cli():
    d = mkroot(RUMI)
    py = os.path.join(HERE, "tenants_lite.py")

    def run(*args):
        r = subprocess.run([sys.executable, py, "--root", d] + list(args), capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        return r.stdout

    assert run("--get", "command").strip() == "/rumi-e2e"
    assert run("--tenant", "ye", "--get", "phone_number_id").strip() == "1168562573007743"
    assert run("--list-tenants").split() == ["pk", "tz", "ye"]
    assert run("--get", "branches.deploy_triggers").split() == ["staging", "main"]
    assert run("--tenants-for", "lesson-plan").split() == ["pk"]
    assert run("--get", "spec_dir").strip() == os.path.join("tests", "features", "whatsapp", "rumi")
    assert run("--tenant", "ye", "--get", "chrome").strip() == ""               # null prints nothing
    j = run("--json")
    assert '"command": "/rumi-e2e"' in j and '"tz"' in j
    r = subprocess.run([sys.executable, py, "--root", d, "--get", "nope.nope"], capture_output=True, text=True)
    assert r.returncode == 1 and "nope" in r.stderr
    r = subprocess.run([sys.executable, py, "--root", tempfile.mkdtemp(), "--get", "command"], capture_output=True, text=True)
    assert r.returncode == 1


if __name__ == "__main__":
    for n, f in sorted(globals().items()):
        if n.startswith("test_") and callable(f):
            f()
            print("ok  ", n)
    print("test_tenants_lite: all ok")
