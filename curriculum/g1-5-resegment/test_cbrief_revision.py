"""What a 990 author is handed, now that the panel builder exists.

`test_cbrief.py` covers the lesson and the worksheet briefs and is already
over the file-length limit, so the revision brief is tested here rather than
grown onto the end of it.

Law 18, the rule the whole file exists to satisfy: "THE ENGINE GUARD IS NOT
ENOUGH -- MIRROR EVERY ENGINE REFUSAL IN THE FREE PRE-RENDER LINT, AND WRITE
THE SHAPE INTO THE AUTHORING BRIEF." On the GK/Islamiat/SST pilot, three of
four revision lessons reached the renderer with `revisionPanels: null`. Each
burned a paid render slot, each came back as an ordinary lesson plan with the
teaching removed, and the run still reported "30/30 lint clean". `d0_panels`
refuses that artefact and `panellint` refuses it for free -- but neither ever
tells an author what the accepted shape IS. That is this brief's whole job,
and the tests below are the ones that would have caught the pilot: the brief
must name the builder, list the keys, state the numbers the lint enforces, and
point at an exemplar that the lint itself passes.
"""
import json
import os
import unittest

import cbrief
import d0_panels
import panellint

HERE = os.path.dirname(os.path.abspath(__file__))


def page(printed, pdf, chapter=1, **kw):
    d = {"printed_page_number": printed, "pdf_page_index": pdf,
         "chapter": {"number": chapter, "title": "Hello World!"},
         "headings": [], "text_verbatim": "", "exercises": [],
         "illustrations": []}
    d.update(kw)
    return d


def seg(index=990, **kw):
    d = {"segment_index": index, "chapter_number": 1, "lp_type": "revision",
         "topic": "Chapter revision", "skill_type": "revision",
         "cpa_phase": None, "pages_printed": [2], "slo_codes": ["E-01-VO-01"],
         "slo_descriptions": ["Name various objects through pictures"],
         "blooms": "understand", "duration_min": 40}
    d.update(kw)
    return d


BOOK = {"stem": "grade_1_english", "grade": 1, "subject": "English",
        "chapter_title": "Hello World!"}


def brief():
    return cbrief.context(seg(), [page(2, 5)], book=BOOK)


def text_of(d):
    """Every string in the brief, flattened -- the author reads all of it."""
    return " ".join(str(v) for v in d.values()
                    if isinstance(v, str)) + " " + " ".join(
        str(x) for v in d.values() if isinstance(v, (list, tuple)) for x in v)


class TheRouteReachesTheBrief(unittest.TestCase):

    def test_a_revision_segment_is_briefed_as_a_revision_page(self):
        b = brief()
        self.assertEqual(b["shape"], "revision")
        self.assertIn("revision", b)

    def test_it_is_not_handed_the_five_capped_lesson_surfaces(self):
        # The pilot's failure mode in one line: hand a revision author a
        # lesson's budget and they write a lesson.
        b = brief()
        self.assertNotIn("budget", b)
        self.assertNotIn("write_last", b)


class TheBriefIsNoLongerDesignPending(unittest.TestCase):
    """It said "no builder exists yet" after the builder existed."""

    def test_it_does_not_still_say_the_design_is_pending(self):
        flat = text_of(cbrief.REVISION).lower()
        self.assertNotIn("design pending", flat)
        self.assertNotIn("no builder exists", flat)

    def test_it_names_the_builder_that_will_be_run_on_what_is_written(self):
        self.assertIn("d0_panels.build", cbrief.REVISION["artefact"])

    def test_it_names_the_three_groups(self):
        flat = text_of(cbrief.REVISION).lower()
        for level in ("beginner", "intermediate", "advanced"):
            self.assertIn(level, flat)


class TheKeysAnAuthorMustWrite(unittest.TestCase):

    def test_every_key_the_lint_dereferences_is_listed(self):
        fields = cbrief.REVISION["fields"]
        for key in ("revisionPanels", "groupingNote", "beginner",
                    "intermediate", "advanced", "focus", "board", "explain",
                    "say", "sayLocal", "guided", "prompt", "strategy",
                    "answer", "practice", "exit"):
            self.assertIn(key, fields)

    def test_no_teaching_block_is_offered_as_a_key(self):
        # A 990 legally has no iDo and no youDo. Listing one as a field is
        # how it quietly becomes a lesson again.
        for block in ("iDo", "weDo", "youDo"):
            self.assertNotIn(block, cbrief.REVISION["fields"])


class TheNumbersTheLintEnforces(unittest.TestCase):
    """Every rule here is one `panellint` refuses on, said before the cost."""

    def setUp(self):
        self.rules = " ".join(cbrief.REVISION["rules"]).lower()

    def test_it_says_all_three_panels_or_none_of_them_render(self):
        self.assertIn("three", self.rules)
        self.assertIn("all three", self.rules)

    def test_it_states_the_board_and_practice_counts(self):
        self.assertIn("1 to 3", self.rules)     # board lines
        self.assertIn("2 to 3", self.rules)     # practice items

    def test_it_says_where_the_answers_go(self):
        self.assertIn("footnote", self.rules)

    def test_it_states_the_widths_the_renderer_truncates_at(self):
        for width in ("115", "125", "78", "300"):
            self.assertIn(width, self.rules)

    def test_it_warns_that_a_null_key_counts_as_absent(self):
        self.assertIn("null", self.rules)


class TheExemplar(unittest.TestCase):
    """A field list says which keys to write and nothing about how much."""

    def path(self):
        return os.path.join(HERE, cbrief.REVISION["exemplar"])

    def load(self):
        with open(self.path()) as fh:
            return json.load(fh)

    def test_it_names_a_file_that_is_actually_there(self):
        self.assertTrue(os.path.exists(self.path()), self.path())

    def test_it_passes_the_lint_it_is_an_example_for(self):
        self.assertEqual(panellint.findings(self.load()), [])

    def test_the_builder_accepts_it(self):
        # Green on known-good, to stand beside the red-on-known-bad that
        # `test_panellint.py` already proves.
        built = d0_panels.build(
            self.load(), page(2, 5), pages=[page(2, 5)])
        self.assertEqual(len(built["pages"]), 4)

    def test_it_is_marked_as_shape_and_not_as_content(self):
        # It is invented. Nothing of it may reach a real sheet.
        self.assertIn("NOT CONTENT", self.load()["_note"])


if __name__ == "__main__":
    unittest.main()
