"""The CI workflow template must work VERBATIM in a governed repository — the
porter bootstraps it there as .github/workflows/data-standards.yml.

Measured 2026-09-25 against the first governed repository: the template as
inherited (a) only ran on PRs targeting main, so a repo whose PRs target an
integration branch (sandbox/staging) would never run it — and a REQUIRED check
that never reports wedges every PR as "expected"; (b) looked for the validator
under a pack checkout (PACK_PATH/skills/...) and not the vendored path the
porter writes to; (c) had no job proving the vendored copy is still verbatim,
which is the whole basis for calling it upstream's.

Run:  python3 <path>/tests/test_ci_template.py -v
"""
import unittest
from pathlib import Path

import yaml

SKILL = Path(__file__).resolve().parents[1]
TEMPLATE = SKILL / "reference" / "ci-workflow-template.yml"


def load():
    return yaml.safe_load(TEMPLATE.read_text(encoding="utf-8"))


def steps(job):
    return {s.get("name", s.get("uses", "")): s for s in job["steps"]}


class Template(unittest.TestCase):
    def setUp(self):
        self.wf = load()
        # PyYAML parses the bare key `on` as boolean True.
        self.on = self.wf.get("on", self.wf.get(True))

    def test_runs_on_every_pull_request_whatever_its_base(self):
        self.assertIn("pull_request", self.on)
        pr = self.on["pull_request"]
        self.assertFalse(pr and pr.get("branches"), f"a branch filter on pull_request: {pr}")

    def test_finds_the_validator_at_the_vendored_path_first(self):
        locate = steps(self.wf["jobs"]["data-standards"])["Locate the data-standards validator"]["run"]
        vendored = locate.find(".claude/skills/data-standards")
        pack = locate.find("skills/data-standards", 0 if vendored < 0 else vendored + 30)
        self.assertGreaterEqual(vendored, 0, "the vendored path is never tried")
        self.assertTrue(pack < 0 or vendored < pack, "the pack path is tried before the vendored one")

    def test_has_an_ownership_job_that_verifies_the_receipt(self):
        job = self.wf["jobs"].get("ownership")
        self.assertIsNotNone(job, "no ownership job")
        run = "\n".join(s.get("run", "") for s in job["steps"])
        self.assertIn(".claude/skills/data-standards.upstream.json", run)
        self.assertIn("rollup_sha256", run)
        self.assertIn("exit(1)", run.replace(" ", ""))


class OwnershipVerifier(unittest.TestCase):
    """The ownership job's inline verifier, executed for real against a vendored
    copy of THIS skill: a receipt built the way the porter builds it must pass,
    one edited byte must fail with the file named, and no receipt is a no-op."""

    def setUp(self):
        import hashlib, json, shutil, tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        dst = self.root / ".claude" / "skills" / "data-standards"
        shutil.copytree(SKILL, dst, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        files = {p.relative_to(dst).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in sorted(dst.rglob("*")) if p.is_file()}
        rollup = hashlib.sha256("".join(f"{k}:{v}\n" for k, v in sorted(files.items())).encode()).hexdigest()
        self.receipt = dst.with_name("data-standards.upstream.json")
        self.receipt.write_text(json.dumps({"source_commit": "abc", "file_count": len(files),
                                            "rollup_sha256": rollup, "files": files}))
        self.dst = dst
        run = load()["jobs"]["ownership"]["steps"][1]["run"]
        self.body = run.split("<<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]

    def tearDown(self):
        self.tmp.cleanup()

    def verify(self):
        import subprocess, sys
        r = subprocess.run([sys.executable, "-c", self.body], cwd=self.root, capture_output=True, text=True)
        return r.returncode, r.stdout + r.stderr

    def test_receipt_matches_the_porters_algorithm(self):
        import importlib.util, json
        porter = SKILL.parents[1] / "scripts" / "port_skills.py"
        if not porter.exists():
            self.skipTest("porter not present in this checkout")
        spec = importlib.util.spec_from_file_location("port_skills", porter)
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        mod.SRC = str(self.dst.parent)
        got = mod.receipt_for("data-standards", mod.list_skill_files("data-standards"), "abc")
        want = json.loads(self.receipt.read_text())
        self.assertEqual(got["rollup_sha256"], want["rollup_sha256"])
        self.assertEqual(got["files"], want["files"])

    def test_verbatim_copy_passes(self):
        rc, out = self.verify()
        self.assertEqual(rc, 0, out)
        self.assertIn("matches its receipt", out)

    def test_one_edited_byte_fails_and_names_the_file(self):
        p = self.dst / "SKILL.md"
        p.write_bytes(p.read_bytes() + b"\n")
        rc, out = self.verify()
        self.assertEqual(rc, 1, out)
        self.assertIn("modified locally: SKILL.md", out)

    def test_no_receipt_is_a_noop(self):
        self.receipt.unlink()
        rc, out = self.verify()
        self.assertEqual(rc, 0, out)
        self.assertIn("nothing to verify", out)


if __name__ == "__main__":
    unittest.main()
