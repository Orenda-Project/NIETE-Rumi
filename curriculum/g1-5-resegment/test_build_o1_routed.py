"""bd-dituw: the build wiring for 995/990 segments.

`triage` already sorts a 995/990 away from `to_lp_doc` correctly -- that half
is covered by test_build_o1_docs.py. What happened after triage was nothing:
`main` only PRINTED the routed row (a "ROUTED ..." line) and moved on, so
whether the worksheet or the panels doc a chapter owes actually got built
never showed up anywhere. Measured on the real corpus (`ch9-10-build/work/*/
enr/*seg99[05].json`, wk_m_measure.py): 0 of 98 real assessment/revision
enrichments satisfy wslint/panellint today -- they carry the ordinary
content-lesson shape (`problems[]`, `steps`, ...), not the `questions[]`
(worksheet) or `revisionPanels` (panels) shape the builders require. That
mismatch is a separate, upstream authoring gap (see the FIXWAVE report) --
this file is only about the ATTEMPT and the ACCOUNTING: a chapter's real
state must show up as `complete: false` in its own manifest, and a good row
must still build and write its files, instead of either vanishing into a
"ROUTED" log line while nothing on disk or in any exit code says so.
"""
import contextlib
import io
import json
import pathlib
import tempfile
import unittest
from unittest import mock

import build_o1_docs as drv
import build_o1_routed as routed_mod
import d0_panels
import d0_worksheet
import test_panellint as panel_fixtures
from test_wslint import good as good_worksheet

PT = {"pt": "stub"}


def _pt_loader(subject, day):
    return PT


def _work(tmp):
    work = pathlib.Path(tmp) / "work"
    for stage in ("enr", "pt", "gate"):
        (work / stage).mkdir(parents=True)
    return work


def _put(dirpath, name, payload):
    (dirpath / name).write_text(json.dumps(payload))


def _pass_gate(work, subject, day):
    _put(work / "gate", "%s_seg%d_gate.json" % (subject, day), {"gate": {"pass": True}})


class BuildOneDispatchesToTheRightBuilder(unittest.TestCase):
    """Unit coverage of the new module, apart from the driver."""

    def test_a_good_assessment_produces_worksheet_and_answer_key(self):
        out = routed_mod.build_one("assessment", good_worksheet(), PT)
        self.assertEqual(sorted(out), ["answer_key", "worksheet"])

    def test_a_good_revision_produces_panels(self):
        out = routed_mod.build_one("revision", panel_fixtures.enr(), PT)
        self.assertEqual(sorted(out), ["panels"])

    def test_a_bad_assessment_raises_the_same_unfit_wslint_would(self):
        with self.assertRaises(d0_worksheet.Unfit):
            routed_mod.build_one("assessment", good_worksheet(0), PT)

    def test_a_bad_revision_raises_the_same_unfit_panellint_would(self):
        with self.assertRaises(d0_panels.Unfit):
            routed_mod.build_one("revision", panel_fixtures.enr(rp=None), PT)


class BuildRoutedWritesWhatBuildsAndReportsWhatDoesNot(unittest.TestCase):

    def test_a_good_995_writes_two_files_named_like_the_lp_docs(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = pathlib.Path(tmp) / "out"
            row = {"subject": "English", "day": 10, "kind": "assessment",
                   "lesson_id": "grade_1_english_ch1_seg995",
                   "note": "worksheet route", "enr": good_worksheet()}
            written, failed = routed_mod.build_routed([row], _pt_loader, out)
            self.assertEqual(failed, [])
            names = sorted(p.name for p in written)
            self.assertEqual(names, ["English_seg10.answer_key.json",
                                      "English_seg10.worksheet.json"])

    def test_a_good_990_writes_one_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = pathlib.Path(tmp) / "out"
            row = {"subject": "English", "day": 11, "kind": "revision",
                   "lesson_id": "grade_1_english_ch1_seg990",
                   "note": "panels route", "enr": panel_fixtures.enr()}
            written, failed = routed_mod.build_routed([row], _pt_loader, out)
            self.assertEqual(failed, [])
            names = sorted(p.name for p in written)
            self.assertEqual(names, ["English_seg11.panels.json"])

    def test_a_995_shaped_like_the_real_corpus_fails_loud_not_silent(self):
        """The measured real shape: `generated` has no `questions[]` at all."""
        with tempfile.TemporaryDirectory() as tmp:
            out = pathlib.Path(tmp) / "out"
            real_shaped = {"lesson_id": "grade_1_urdu_ch8_seg995",
                           "lp_type": "assessment", "generated": {}}
            row = {"subject": "Urdu", "day": 7, "kind": "assessment",
                   "lesson_id": real_shaped["lesson_id"], "note": "worksheet route",
                   "enr": real_shaped}
            written, failed = routed_mod.build_routed([row], _pt_loader, out)
            self.assertEqual(written, [])
            self.assertEqual(len(failed), 1)
            self.assertIn("WS-02", failed[0]["error"])

    def test_one_bad_row_does_not_stop_a_good_one_beside_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = pathlib.Path(tmp) / "out"
            good_row = {"subject": "English", "day": 10, "kind": "assessment",
                        "lesson_id": "seg995-good", "note": "x", "enr": good_worksheet()}
            bad_row = {"subject": "Urdu", "day": 7, "kind": "assessment",
                       "lesson_id": "seg995-bad", "note": "x",
                       "enr": {"lesson_id": "seg995-bad", "lp_type": "assessment",
                               "generated": {}}}
            written, failed = routed_mod.build_routed([bad_row, good_row], _pt_loader, out)
            self.assertEqual(len(written), 2, "the good row still builds beside the bad one")
            self.assertEqual(len(failed), 1)


class ManifestReportsCompletenessTheWayRenderManifestDoes(unittest.TestCase):

    def test_no_failures_is_complete(self):
        routed = [{"lesson_id": "a"}, {"lesson_id": "b"}]
        m = routed_mod.manifest("g1_ch8", routed, [])
        self.assertEqual(m["expected"], ["a", "b"])
        self.assertEqual(m["built"], ["a", "b"])
        self.assertTrue(m["complete"])

    def test_one_failure_makes_the_chapter_incomplete(self):
        routed = [{"lesson_id": "a"}, {"lesson_id": "b"}]
        failed = [{"lesson_id": "b", "error": "WS-02 ..."}]
        m = routed_mod.manifest("g1_ch8", routed, failed)
        self.assertEqual(m["built"], ["a"])
        self.assertFalse(m["complete"], "a chapter missing even one is INCOMPLETE")
        self.assertEqual(m["failed"], failed)


class MainAttemptsAndAccountsForRoutedRows(unittest.TestCase):
    """The wiring, end to end through `build_o1_docs.main()`."""

    def _manifest_one_content_one_995(self, work, enr995):
        manifest = {"English": [{"topic": "Topic One"}, {"topic": "Assessment"}]}
        (work / "manifest.json").write_text(json.dumps(manifest))
        _put(work / "enr", "English_seg1_enr.json",
             {"lesson_id": "grade_1_english_ch1_seg1", "lp_type": "content"})
        _put(work / "pt", "English_seg1_pt.json", {"pt": "stub"})
        _pass_gate(work, "English", 1)
        _put(work / "enr", "English_seg2_enr.json", enr995)
        _put(work / "pt", "English_seg2_pt.json", {"pt": "stub"})
        _pass_gate(work, "English", 2)

    def test_a_995_shaped_like_the_real_corpus_is_attempted_and_reported_failed(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = _work(tmp)
            self._manifest_one_content_one_995(
                work, {"lesson_id": "grade_1_english_ch1_seg995",
                       "lp_type": "assessment", "generated": {}})
            with mock.patch.object(drv.d0, "to_lp_doc", return_value={"stub": True}):
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    rc = drv.main(str(work))
            printed = out.getvalue()
            self.assertIn("FAILED", printed)
            self.assertIn("WS-02", printed)
            self.assertEqual(rc, 0,
                              "a broken 995 must not stop the chapter's good content "
                              "lessons from building and being counted complete -- "
                              "build_render.sh treats a non-zero rc as BUILD FAILED "
                              "and skips rendering the WHOLE chapter (build_render.sh:114)")
            man_path = work.parent / "o1" / "routed" / "work.manifest.json"
            self.assertTrue(man_path.exists(), "the routed manifest must be written")
            man = json.loads(man_path.read_text())
            self.assertFalse(man["complete"])
            self.assertEqual(man["expected"], ["grade_1_english_ch1_seg995"])
            self.assertEqual(man["built"], [])

    def test_a_good_995_is_built_written_and_counted_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = _work(tmp)
            good = good_worksheet()
            good["lesson_id"] = "grade_1_english_ch1_seg995"
            self._manifest_one_content_one_995(work, good)
            with mock.patch.object(drv.d0, "to_lp_doc", return_value={"stub": True}):
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    rc = drv.main(str(work))
            self.assertEqual(rc, 0)
            self.assertIn("BUILT", out.getvalue())
            written = sorted(p.name for p in (work.parent / "o1" / "docs").glob("*.json"))
            self.assertIn("English_seg2.worksheet.json", written)
            self.assertIn("English_seg2.answer_key.json", written)
            man_path = work.parent / "o1" / "routed" / "work.manifest.json"
            man = json.loads(man_path.read_text())
            self.assertTrue(man["complete"])


if __name__ == "__main__":
    unittest.main()
