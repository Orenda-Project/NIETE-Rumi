"""The Gate-O1 driver's load loop -- a missing gate artefact vs. a failing one.

`_artefact` is "exactly one glob match or raise" by design: an ambiguous or
absent artefact is a pipeline defect the driver should never paper over. The
gate lookup broke that assumption. Nine real rows in the live corpus (all
Urdu, chapter 8, across grades 1/3/4/5) carry `url.gate: null` in the
worklist -- their gate artefact was never downloaded, so `pt` and `enr` exist
on disk but `gate` does not. `main` called `_artefact(work, "gate", ...)`
unconditionally, so the FIRST such row raised `FileNotFoundError` inside the
load loop, before `triage` ever ran, and took the other ~30 good rows in that
work dir down with it. Four of fifteen work dirs (g1_ch8, g3_ch8, g4_ch8,
g5_ch8) could not build at all.

A missing gate has to read as "skip this row," exactly like a failing gate --
never as a pass, since building an ungated lesson plan is not authorised --
but the skip reason has to say WHICH is true. "Gate says no" is a quality
verdict; "no gate exists" is a pipeline gap that the operator needs to chase
down (re-run the download), not re-litigate. `_artefact` keeps its strict
"exactly one match" contract everywhere else -- an ambiguous 2+ match glob on
ANY stage, gate included, still raises. Only the zero-match case bends, and
only for the one caller that opts in.
"""
import contextlib
import io
import json
import pathlib
import tempfile
import unittest
from unittest import mock

import build_o1_docs as drv

CONTENT = {"lesson_id": "grade_1_urdu_ch8_seg1", "lp_type": "content"}


def _work(tmp):
    work = pathlib.Path(tmp) / "work"
    for stage in ("enr", "pt", "gate"):
        (work / stage).mkdir(parents=True)
    return work


def _put(dirpath, name, payload):
    (dirpath / name).write_text(json.dumps(payload))


class ArtefactOptionalOnlyToleratesZeroMatches(unittest.TestCase):
    """Unit-level coverage of `_artefact` itself, apart from the full driver."""

    def test_zero_matches_raises_by_default_same_as_always(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = _work(tmp)
            with self.assertRaises(FileNotFoundError):
                drv._artefact(work, "gate", "Urdu", 1)

    def test_zero_matches_is_tolerated_when_optional_and_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = _work(tmp)
            self.assertIsNone(drv._artefact(work, "gate", "Urdu", 1, optional=True))

    def test_two_matches_still_raises_even_when_optional(self):
        """Ambiguous is ambiguous regardless of the caller's tolerance for absence."""
        with tempfile.TemporaryDirectory() as tmp:
            work = _work(tmp)
            _put(work / "gate", "Urdu_seg1_a.json", {"gate": {"pass": True}})
            _put(work / "gate", "Urdu_seg1_b.json", {"gate": {"pass": True}})
            with self.assertRaises(FileNotFoundError):
                drv._artefact(work, "gate", "Urdu", 1, optional=True)

    def test_pt_stage_has_no_optional_tolerance_at_all(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = _work(tmp)
            with self.assertRaises(FileNotFoundError):
                drv._artefact(work, "pt", "Urdu", 1)

    def test_enr_stage_has_no_optional_tolerance_at_all(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = _work(tmp)
            with self.assertRaises(FileNotFoundError):
                drv._artefact(work, "enr", "Urdu", 1)


class MissingGateDoesNotAbortTheChapter(unittest.TestCase):
    """`main`, end to end, on a two-row manifest where row 1's gate never
    downloaded and row 2's did and passed -- the bug, stated as behaviour."""

    def _manifest_with_one_missing_gate(self, work):
        manifest = {"Urdu": [{"topic": "Topic One"}, {"topic": "Topic Two"}]}
        (work / "manifest.json").write_text(json.dumps(manifest))
        _put(work / "enr", "Urdu_seg1_enr.json", CONTENT)
        _put(work / "enr", "Urdu_seg2_enr.json",
             {"lesson_id": "grade_1_urdu_ch8_seg2", "lp_type": "content"})
        _put(work / "pt", "Urdu_seg2_pt.json", {"pt": "stub"})
        _put(work / "gate", "Urdu_seg2_gate.json", {"gate": {"pass": True}})
        # Deliberately no gate/Urdu_seg1_*.json -- day 1's `url.gate` was null.

    def test_the_row_with_no_gate_is_skipped_and_the_other_row_still_builds(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = _work(tmp)
            self._manifest_with_one_missing_gate(work)
            with mock.patch.object(drv.d0, "to_lp_doc", return_value={"stub": True}):
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    rc = drv.main(str(work))
            self.assertEqual(rc, 0)
            written = sorted(p.name for p in (work.parent / "o1" / "docs").glob("*.lp.json"))
            self.assertEqual(written, ["Urdu_seg2.lp.json"],
                              "day 1's missing gate must not stop day 2 from building")

    def test_the_skip_reason_says_absent_not_failing(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = _work(tmp)
            self._manifest_with_one_missing_gate(work)
            with mock.patch.object(drv.d0, "to_lp_doc", return_value={"stub": True}):
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    drv.main(str(work))
            printed = out.getvalue()
            self.assertIn("Urdu day1", printed)
            self.assertIn("never downloaded", printed)
            self.assertNotIn("gate fail", printed, "must read as absent, not as a verdict")


class FailingGateBehavesExactlyAsBefore(unittest.TestCase):

    def test_a_failing_gate_is_skipped_with_its_own_reasons(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = _work(tmp)
            manifest = {"Urdu": [{"topic": "Topic One"}]}
            (work / "manifest.json").write_text(json.dumps(manifest))
            _put(work / "enr", "Urdu_seg1_enr.json", CONTENT)
            _put(work / "gate", "Urdu_seg1_gate.json",
                 {"gate": {"pass": False, "reasons": ["too long"]}})
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                rc = drv.main(str(work))
            self.assertEqual(rc, 1, "nothing built, nothing routed")
            self.assertIn("Urdu day1: too long", out.getvalue())

    def test_a_failing_gate_with_no_reasons_falls_back_to_gate_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = _work(tmp)
            manifest = {"Urdu": [{"topic": "Topic One"}]}
            (work / "manifest.json").write_text(json.dumps(manifest))
            _put(work / "enr", "Urdu_seg1_enr.json", CONTENT)
            _put(work / "gate", "Urdu_seg1_gate.json", {"gate": {"pass": False}})
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                drv.main(str(work))
            self.assertIn("Urdu day1: gate fail", out.getvalue())


if __name__ == "__main__":
    unittest.main()
