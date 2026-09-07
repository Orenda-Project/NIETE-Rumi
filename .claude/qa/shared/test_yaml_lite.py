#!/usr/bin/env python3
"""yaml_lite must read every YAML file this tooling ships EXACTLY as PyYAML does.

Run: python3 .claude/qa/shared/test_yaml_lite.py
The agreement tests are skipped (and say so) when PyYAML is not installed —
which is precisely the machine yaml_lite exists for; the literal cases still run.
"""
import glob
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import yaml_lite as yl  # noqa: E402

try:
    import yaml as pyyaml
except ImportError:  # pragma: no cover
    pyyaml = None


def test_scalars_and_nesting():
    doc = """
# comment
version: 1
name: "quoted # not a comment"
other: 'single ''quoted'''
flag: true
off: false
nothing: ~
empty_map: {}
empty_list: []
nested:
  a: 1
  b:
    - x
    - "y"
    - 3
  c: [p, q, "r s"]
  d: [
    one,
    two,   # trailing
  ]
list_of_maps:
  - repo_match: NIETE-Rumi
    branches: [main]
    command: /niete-e2e all
  - repo_match: other
    branches: [develop, main]
path/with.dots/**: "*"
"""
    got = yl.safe_load(doc)
    assert got["empty_map"] == {} and got["empty_list"] == []
    assert got["version"] == 1 and got["flag"] is True and got["off"] is False and got["nothing"] is None
    assert got["name"] == "quoted # not a comment" and got["other"] == "single 'quoted'"
    assert got["nested"]["b"] == ["x", "y", 3]
    assert got["nested"]["c"] == ["p", "q", "r s"]
    assert got["nested"]["d"] == ["one", "two"]
    assert got["list_of_maps"][0] == {"repo_match": "NIETE-Rumi", "branches": ["main"], "command": "/niete-e2e all"}
    assert got["list_of_maps"][1]["branches"] == ["develop", "main"]
    assert got["path/with.dots/**"] == "*"


def test_unsupported_constructs_raise_with_a_line_number():
    for bad in ("a: |\n  block\n", "a: &anchor 1\n", "a: {x: 1}\n", "a:\n\t- tab\n"):
        try:
            yl.safe_load(bad)
        except yl.ParseError as e:
            assert "line" in str(e), str(e)
        else:
            raise AssertionError("should have raised: %r" % bad)


def test_yaml_lite_is_the_fallback_for_every_yaml_consumer():
    """Only files that import yaml need the fallback; make sure each one has it.
    (whatsapp-targets.yaml uses flow mappings `{}` that yaml_lite does not read —
    it is consumed by regex, not by a YAML parser, so it is out of scope here.)"""
    consumers = []
    for f in glob.glob(os.path.join(HERE, "*.py")):
        if os.path.basename(f).startswith("test_") or os.path.basename(f) == "yaml_lite.py":
            continue
        src = open(f, encoding="utf-8").read()
        if "import yaml\n" in src or "import yaml " in src:
            consumers.append(os.path.basename(f))
            assert "import yaml_lite as yaml" in src, "%s imports yaml without the yaml_lite fallback" % f
    assert consumers == ["select_e2e.py"], consumers


def test_agrees_with_pyyaml_on_the_files_it_serves():
    if pyyaml is None:
        print("  (PyYAML not installed — agreement check skipped; literal cases cover the grammar)")
        return
    qa = os.path.dirname(HERE)
    files = [os.path.join(qa, "config", "feature-map.yaml")]
    for f in files:
        with open(f, encoding="utf-8") as fh:
            text = fh.read()
        ours = yl.safe_load(text)
        theirs = pyyaml.safe_load(io.StringIO(text))
        assert ours == theirs, "yaml_lite disagrees with PyYAML on %s" % os.path.relpath(f, qa)
    print("  agreed with PyYAML on %d file(s): %s" % (len(files), ", ".join(os.path.relpath(f, qa) for f in files)))


def test_feature_map_loads_through_select_e2e_without_pyyaml():
    """The real consumer, with PyYAML forcibly absent."""
    import importlib
    import builtins
    real_import = builtins.__import__

    def no_yaml(name, *a, **k):
        if name == "yaml":
            raise ImportError("simulated: PyYAML absent")
        return real_import(name, *a, **k)

    builtins.__import__ = no_yaml
    try:
        se = importlib.import_module("select_e2e")
        qa = os.path.dirname(HERE)
        fmap = se.load_map(os.path.join(qa, "config", "feature-map.yaml"), os.path.join(qa, "agents"))
        order = se.load_feature_order(os.path.join(qa, "agents"))
        sel = se.select(["bot/shared/services/menu.service.js", "bot/shared/handlers/exam-checker.handler.js"], fmap, order)
        assert "menu" in sel.features and "training" in sel.features, sel.features
    finally:
        builtins.__import__ = real_import


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t(); print("PASS", t.__name__)
        except Exception as e:  # noqa: BLE001
            failed += 1; print("FAIL", t.__name__, "->", type(e).__name__, e)
    print("%d/%d passed" % (len(tests) - failed, len(tests)))
    sys.exit(1 if failed else 0)
