#!/usr/bin/env python3
"""Stdlib assert tests for niete_training_db env/creds resolution.
Run: python3 test_niete_training_db.py

Regression cover for bd-2759: the tool read NIETE-Rumi/.env unconditionally, so a
run whose e2e target was STAGING seeded the PROD Supabase — a wrong-DB write that
also silently did nothing to the bot under test.
"""
import os
import tempfile
import niete_training_db as t


def test_project_ref_parsed_from_url():
    assert t._project_ref("https://rpqkekcfvumypldbejhp.supabase.co") == "rpqkekcfvumypldbejhp"
    assert t._project_ref("https://ihzciabopbttygxxgrkm.supabase.co/") == "ihzciabopbttygxxgrkm"


def test_known_refs_are_pinned_per_env():
    assert t.ENV_REFS["staging"] == "rpqkekcfvumypldbejhp"
    assert t.ENV_REFS["prod"] == "ihzciabopbttygxxgrkm"


def test_default_env_follows_targets_yaml_default_profile():
    # whatsapp-targets.yaml default_profile: niete -> env: staging
    assert t._default_env() == "staging"


def test_ref_guard_accepts_matching_ref():
    t._assert_ref("staging", "https://rpqkekcfvumypldbejhp.supabase.co")   # no raise
    t._assert_ref("prod", "https://ihzciabopbttygxxgrkm.supabase.co")      # no raise


def test_ref_guard_aborts_on_wrong_db():
    """The bd-2759 bug: env=staging but the creds point at prod -> must abort."""
    try:
        t._assert_ref("staging", "https://ihzciabopbttygxxgrkm.supabase.co")
    except SystemExit as e:
        assert "prod" in str(e).lower() or "ihzciabopbttygxxgrkm" in str(e)
        return
    raise AssertionError("expected SystemExit when staging env resolves prod creds")


def test_env_file_candidates_differ_by_env():
    stg = [os.path.basename(p) for p in t._env_candidates("staging")]
    prd = [os.path.basename(p) for p in t._env_candidates("prod")]
    assert ".env.staging" in stg, stg
    assert ".env.staging" not in prd, prd
    assert ".env" in prd, prd


def test_keys_dir_is_searched_first():
    """Project convention (root CLAUDE.md): credentials live under keys/ at the
    project root, which is gitignored. That must win over the repo dotenvs."""
    for env, fname in (("staging", "niete-staging.env"), ("prod", "niete-prod.env")):
        cands = t._env_candidates(env)
        assert os.path.basename(cands[0]) == fname, cands
        assert os.path.basename(os.path.dirname(cands[0])) == "keys", cands


def test_upsert_path_carries_on_conflict():
    """bd-2760: PostgREST only treats `Prefer: resolution=merge-duplicates` as an
    upsert when the request also names the conflict target via `on_conflict`.
    Without it, seeding an account that already has progress rows 409s."""
    path = t._upsert_path("teacher_training_progress", ["user_id", "module_id"])
    assert path.startswith("/rest/v1/teacher_training_progress?"), path
    assert "on_conflict=user_id,module_id" in path, path


def test_no_hardcoded_driver_number_anywhere():
    """bd-2767 / bd-2748: the driver is resolved at runtime from the runner's own linked
    session. A hardcoded phone default meant a bare `lookup` silently read one specific
    person's account — and would keep doing so on a teammate's machine."""
    src = open(os.path.join(os.path.dirname(os.path.abspath(t.__file__)),
                            "niete_training_db.py"), encoding="utf-8").read()
    import re as _re
    hits = _re.findall(r"\b92\d{10}\b", src)
    assert not hits, "hardcoded driver number(s) in niete_training_db.py: %s" % sorted(set(hits))


def test_lookup_requires_an_explicit_phone():
    """`lookup` must not fall back to anyone's number."""
    import argparse
    parser = None
    try:
        t.main.__globals__  # noqa - just asserting the module imported
    except Exception:
        pass
    src = open(os.path.join(os.path.dirname(os.path.abspath(t.__file__)),
                            "niete_training_db.py"), encoding="utf-8").read()
    assert 'sub.add_parser("lookup"' in src
    line = next(l for l in src.splitlines() if 'sub.add_parser("lookup"' in l)
    assert "default=" not in line, "lookup --phone must have no default: %s" % line.strip()
    assert "required=True" in line, "lookup --phone must be required: %s" % line.strip()


def test_creds_read_from_explicit_file():
    with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as fh:
        fh.write("SUPABASE_URL=https://rpqkekcfvumypldbejhp.supabase.co\n")
        fh.write("SUPABASE_SERVICE_ROLE_KEY=fake-key-value\n")
        path = fh.name
    try:
        url, key = t._read_env_file(path)
        assert url == "https://rpqkekcfvumypldbejhp.supabase.co"
        assert key == "fake-key-value"
    finally:
        os.unlink(path)


def test_sandbox_env_is_pinned_to_its_own_project_and_creds_file():
    # The local mock E2E lane runs the bot against the SANDBOX Supabase (keys/niete-sandbox.env),
    # never staging or prod. The ref guard must know it, and the creds search must find it.
    assert t.ENV_REFS["sandbox"] == "olvritwoqujtjvwfulbh"
    t._assert_ref("sandbox", "https://olvritwoqujtjvwfulbh.supabase.co")   # no raise
    cands = t._env_candidates("sandbox")
    assert any(c.endswith(os.path.join("keys", "niete-sandbox.env")) for c in cands), cands


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print("PASS", fn.__name__)
        except Exception as e:
            failed += 1
            print("FAIL", fn.__name__, "->", type(e).__name__, e)
    print("\n%d/%d passed" % (len(fns) - failed, len(fns)))
    raise SystemExit(1 if failed else 0)
