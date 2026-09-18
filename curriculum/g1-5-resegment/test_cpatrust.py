"""A concrete day has to be backed by the page, not by the section's name.

Grade 5 Maths printed 33 concrete days — more hands-on periods than any grade
above Grade 1, in the board-prep year. It was a labelling rule, not a book.
The division agent's own `_meta.taxonomy` says "concrete/concept hard-start
opens each new concept", and 32 of the 33 days carry the section name "Leap
and Learn". The same section is read as concrete on 36 of 54 Grade 1 days and
on 0 of 34 Grade 3 and 0 of 37 Grade 4 days, so the label tracks the section
heading, not what the child does.

Two columns already disagree about those days and the corpus says so itself:
`cpa_phase`, which the division agent derived from the page, says `pictorial`
on 28 of the 33 and `abstract` on 4. Reading all 33 pages, not one puts an
object in a child's hands — they are a context scene and a worked method
(ch4's is the divisibility rule for 7, worked on 2632). Against Grade 1,
where 21 of 36 concrete days name a real manipulative in the page text
itself: "Deal out real counters one-to-one", "Use a real balance and
counters/stones", "act out buying with play money".

The label did not only overstate the ramp. It SUPPRESSED the fix: cpaopen
skips any chapter that already holds a concrete day, all twelve Grade 5
chapters held one, so Grade 5 was the only grade that never received a
hands-on opener while Grades 2-4 received 34 between them. That is why this
module has to run BEFORE cpaopen at the load door, and why the test for that
ordering is the last one here rather than an afterthought.

The corpus is never edited. `cpa_phase` is the page's own reading and stays
exactly as the source wrote it, as in cparamp; what changes is `skill_type`,
which is what the sheet prints and what every count reads.
"""
import unittest

import cpaopen
import cpatrust
import stageb


def day(skill, phase, **kw):
    return dict({"skill_type": skill, "cpa_phase": phase,
                 "day_label": "Day 1"}, **kw)


def types(segments):
    return [s.get("skill_type") for s in segments]


class TheSectionNameDoesNotOutrankThePage(unittest.TestCase):

    def test_a_concrete_day_whose_page_says_pictorial_is_renamed(self):
        rows = [day("concrete", "pictorial")]
        out, renamed = cpatrust.trust_page(rows, "Maths")
        self.assertEqual(types(out), ["pictorial"])
        self.assertEqual(renamed, 1)

    def test_a_concrete_day_whose_page_says_abstract_becomes_the_bridge(self):
        # `abstract` is not a skill_type the corpus uses: cparamp owns that
        # rename, downstream and by section. The bridge is where the day goes.
        out, _n = cpatrust.trust_page([day("concrete", "abstract")], "Maths")
        self.assertEqual(types(out), ["pictorial_abstract"])

    def test_a_concrete_day_the_page_agrees_with_is_left_alone(self):
        rows = [day("concrete", "concrete")]
        out, renamed = cpatrust.trust_page(rows, "Maths")
        self.assertEqual((types(out), renamed), (["concrete"], 0))

    def test_a_day_with_no_page_reading_keeps_its_label(self):
        # Revision and assessment rows carry cpa_phase null. Silence is not
        # disagreement, and a rule that read it as one would strip the ramp.
        for phase in (None, "", "unknown"):
            out, renamed = cpatrust.trust_page([day("concrete", phase)],
                                               "Maths")
            self.assertEqual((types(out), renamed), (["concrete"], 0), phase)

    def test_only_the_concrete_claim_is_checked(self):
        # The strongest claim in the taxonomy is the one that says a child
        # holds something, and it is the one read page by page. Every other
        # disagreement is still open (bd-x2su1) and is not silently rewritten.
        rows = [day("pictorial", "abstract"), day("pictorial_abstract",
                                                  "pictorial")]
        out, renamed = cpatrust.trust_page(rows, "Maths")
        self.assertEqual(renamed, 0)
        self.assertEqual(types(out), ["pictorial", "pictorial_abstract"])

    def test_no_other_subject_is_touched(self):
        for subject in ("English", "Urdu", "General Science"):
            out, renamed = cpatrust.trust_page([day("concrete", "pictorial")],
                                               subject)
            self.assertEqual((types(out), renamed), (["concrete"], 0), subject)

    def test_the_page_column_itself_is_never_rewritten(self):
        rows = [day("concrete", "pictorial")]
        out, _n = cpatrust.trust_page(rows, "Maths")
        self.assertEqual(out[0]["cpa_phase"], "pictorial")

    def test_the_input_rows_are_not_mutated(self):
        rows = [day("concrete", "pictorial")]
        cpatrust.trust_page(rows, "Maths")
        self.assertEqual(rows[0]["skill_type"], "concrete")

    def test_every_other_field_survives_the_rename(self):
        rows = [day("concrete", "pictorial", topic="Place value",
                    slo_codes=["M-05-NS-01"], pages_printed=[3, 4])]
        out, _n = cpatrust.trust_page(rows, "Maths")
        self.assertEqual(out[0]["topic"], "Place value")
        self.assertEqual(out[0]["slo_codes"], ["M-05-NS-01"])
        self.assertEqual(out[0]["pages_printed"], [3, 4])

    def test_a_day_we_added_ourselves_is_never_reconsidered(self):
        # cpaopen runs after this module, so this cannot happen in the
        # pipeline. It is pinned because a future reordering that broke it
        # would undo our own hands-on openers silently, one by one.
        rows = [day("concrete", "concrete", **{cpaopen.MARK: "counters"})]
        rows[0]["cpa_phase"] = "pictorial"
        out, renamed = cpatrust.trust_page(rows, "Maths")
        self.assertEqual((types(out), renamed), (["concrete"], 0))


class TheRenamedDayIsStillMarkedAsOurs(unittest.TestCase):
    """stageb.day_flags shows a reviewer what we changed and why. A silent
    relabel would put the correction beyond the reach of the person who has
    to check it against the book."""

    def test_the_renamed_day_records_what_the_page_said(self):
        out, _n = cpatrust.trust_page([day("concrete", "pictorial")], "Maths")
        self.assertIn("pictorial", out[0][cpatrust.MARK])

    def test_an_untouched_day_carries_no_mark(self):
        out, _n = cpatrust.trust_page([day("concrete", "concrete")], "Maths")
        self.assertNotIn(cpatrust.MARK, out[0])

    def test_the_flags_column_shows_it_to_the_teacher(self):
        """Every other correction this build makes names itself in Flags.
        Thirty-two Grade 5 rows changed skill type on this rule alone, so a
        reviewer checking the tab against the book has to be able to see
        which ones, and on what grounds (bd-1czs0)."""
        out, _n = cpatrust.trust_page([day("concrete", "pictorial")], "Maths")
        flags = stageb.day_flags(out[0], {"new_codes": []}, set())
        self.assertIn("page reads pictorial", flags)

    def test_a_day_we_did_not_re_read_says_nothing_about_the_page(self):
        out, _n = cpatrust.trust_page([day("pictorial", "pictorial")], "Maths")
        flags = stageb.day_flags(out[0], {"new_codes": []}, set())
        self.assertNotIn("page reads", flags)


class TheOpenerLandsOnTheChapterThisFrees(unittest.TestCase):
    """The whole point of the ordering: a chapter whose only concrete day was
    a section name has no hands-on day at all, and must now get one."""

    def test_cpaopen_reaches_a_chapter_this_rule_has_corrected(self):
        rows = [day("concrete", "pictorial", chapter_number=1,
                    topic="Multiply by 10"),
                day("pictorial", "pictorial", chapter_number=1)]
        before, added = cpaopen.open_concrete(rows, "Maths")
        self.assertEqual((added, types(before)[0]), (0, "concrete"))
        freed, _n = cpatrust.trust_page(rows, "Maths")
        after, added = cpaopen.open_concrete(freed, "Maths")
        self.assertEqual(added, 1)
        self.assertEqual(types(after)[0], "concrete")
        self.assertIn("array", after[0][cpaopen.MARK])


if __name__ == "__main__":
    unittest.main()
