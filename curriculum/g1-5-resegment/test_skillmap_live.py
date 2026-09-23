"""The invariant, asserted over the corpus the live build really hands the tab.

No skill the Coverage Map gives days to may appear in the Skills Map's
never-taught block (bd-hlq38). Everything here is built from
`build.load_corpus()` rather than from `skillsmap.json`, because the snapshot
is what was wrong: asserted against it, every test below would pass while the
sheet printed "Maths · Abstract · never taught in this subject" beside a
Coverage Map counting sixteen Abstract days in Grade 4.

Its companion `test_skillmap.py` covers the same rules over a small fixture,
which is where a wording or a column width is worth pinning down. This file is
deliberately the one that cannot be satisfied by a fixture.
"""
import unittest

import build
import corpuscheck
import skillgrid
import skillmap
import skills
import skilltaught

def _never_taught(rows):
    """The rows a reader takes as being under WHAT IS NEVER TAUGHT: from that
    heading to the next one. The block's own wording cannot undo the heading
    above it, so the heading is what decides which rows count."""
    start = next(i for i, r in enumerate(rows)
                 if str(r[0]).startswith("WHAT IS NEVER TAUGHT"))
    out = []
    for row in rows[start + 1:]:
        if str(row[0]).startswith("TAUGHT, BUT NOT IN THIS FILE"):
            break
        out.append(row)
    return out


class NoSkillTheCoverageMapCountsIsCalledNeverTaught(unittest.TestCase):
    """The invariant, over the build both tabs are fed (bd-hlq38).

    The Skills Map was the only analysis tab built from a snapshot, and the
    snapshot in this tree predates two CPA fixes that the live build applies
    at the load door. So the tab printed "Maths · Concrete · not taught in G4"
    and "Maths · Abstract · never taught in this subject" while the Coverage
    Map on the same sheet counted 11 and 16 days for them in Grade 4.

    It is asserted from the in-memory corpus, not from the JSON — asserted
    against the snapshot it would assert the bug. Everything else on the tab
    may lag; this one claim may not, because it is the block a reviewer reads
    first and the one that gets quoted to FDE.
    """

    @classmethod
    def setUpClass(cls):
        # The corpus is gitignored (restricted-educational-internal), so it is
        # absent from a fresh clone more often than it is broken. The
        # invariant is about the live corpus and cannot be faked from the JSON.
        if corpuscheck.problems(seg=build.SEG_DIR, fde=build.FDE_DIR,
                                skillsmap=build.SKILLSMAP_JSON):
            raise unittest.SkipTest("corpus/ is not in this tree")
        cls.corpus = build.load_corpus()[0]
        cls.live = skilltaught.counts(cls.corpus)
        cls.rows, cls.plan = skillmap.build(
            skillgrid.load(), cls.corpus)
        cls.block = _never_taught(cls.rows)

    def test_the_invariant_is_asserted_over_all_four_subjects_and_five_grades(self):
        # A live count that came back empty would pass every assertion below
        # while asserting nothing at all.
        self.assertEqual(sorted({s for s, _k, _g in self.live}),
                         ["English", "Maths", "Science", "Urdu"])
        self.assertEqual(sorted({g for _s, _k, g in self.live}),
                         ["1", "2", "3", "4", "5"])

    def test_no_skill_with_live_days_appears_in_the_never_taught_block(self):
        for (subject, key, grade), n in sorted(self.live.items()):
            named = f"{subject} · {skills.label(key, subject)}"
            for row in self.block:
                if str(row[skillgrid.SKILL_C]) != named:
                    continue
                with self.subTest(subject=subject, key=key, grade=grade):
                    self.assertNotIn(
                        str(row[skillgrid.GRADE_C]), ("all", f"G{grade}"),
                        f"the Coverage Map gives {named} {n} days in "
                        f"G{grade}; this block calls it never taught")

    def test_grade_4_concrete_and_abstract_are_gone_from_the_block(self):
        # The two rows bd-hlq38 was filed for, named so the regression cannot
        # come back quietly under a passing generic assertion.
        for label in ("Concrete", "Abstract"):
            self.assertGreater(
                skilltaught.days(self.live, "Maths", label.lower(), 4), 0)
            self.assertNotIn(f"Maths · {label}",
                             [str(r[skillgrid.SKILL_C]) for r in self.block])

    def test_grade_4_concrete_and_abstract_are_still_named_somewhere(self):
        # Vetoing the false gap and stopping there would drop them off the tab.
        # Where they are named is the snapshot's business and moves under this
        # test: with a stale file Abstract had no track at all and appeared
        # only under the lag heading; regenerated from the corpus (bd-7j5rs)
        # it has a G4 column like any other skill. What must hold either way
        # is that the reviewer is told where the days are counted -- so the
        # assertion is that both are named and neither is drawn as absent.
        rows = [(i, r) for i, r in enumerate(self.rows)
                if str(r[skillgrid.SKILL_C]).startswith("Maths \u00b7 ")]
        for label in ("Concrete", "Abstract"):
            named = [(i, r) for i, r in rows
                     if str(r[skillgrid.SKILL_C]) == f"Maths \u00b7 {label}"]
            with self.subTest(label=label):
                self.assertTrue(named, f"Maths \u00b7 {label} is on no row")
                for i, _r in named:
                    self.assertNotIn(i, self.plan["absent_rows"])
                self.assertNotIn(
                    f"Maths \u00b7 {label}",
                    [str(r[skillgrid.SKILL_C]) for r in self.block])

    def test_the_snapshot_is_not_lagging_the_corpus(self):
        # bd-7j5rs. The lag section is the tab admitting its own input is out
        # of date, and `skillsnap` exists so that admission is never needed:
        # a row under this heading means the snapshot was taken before a build
        # that changed what is taught. Regenerate it rather than paint it.
        self.assertFalse(
            [r for r in self.rows
             if str(r[0]).startswith("TAUGHT, BUT NOT IN THIS SNAPSHOT")],
            "skillsmap.json lags the corpus -- run `python3 skillsnap.py`")

    def test_science_revision_is_still_named_as_never_taught(self):
        # Correct and load-bearing: Science writes its chapter close as
        # `review_assess`, so plain revision genuinely has no period anywhere.
        # Verified against the live count, not against the snapshot.
        self.assertEqual(skilltaught.days(self.live, "Science", "revision"), 0)
        row = next(r for r in self.block
                   if str(r[skillgrid.SKILL_C]) == "Science · Revision")
        self.assertEqual(row[skillgrid.CODE_C], "RV")
        self.assertEqual(row[skillgrid.GRADE_C], "all")
        self.assertEqual(row[skillgrid.TRACK_C], "never taught in this subject")

    def test_the_basics_period_section_still_names_all_three_skills(self):
        # The model for how this tab should talk about an absence: it names the
        # absence AND where the thing actually lives. Untouched by the fix.
        i = next(i for i, r in enumerate(self.rows)
                 if str(r[0]).startswith("TAUGHT, BUT NOT IN THIS FILE"))
        named = {str(r[skillgrid.SKILL_C]) for r in self.rows[i:]}
        for want in ("English · Communicative language",
                     "Urdu · Communicative language",
                     "Maths · Number fluency"):
            self.assertIn(want, named)
        for j, row in enumerate(self.rows[i:], start=i):
            if row[skillgrid.CODE_C]:
                self.assertNotIn(j, self.plan["absent_rows"],
                                 "a basics period is struck through")


if __name__ == "__main__":
    unittest.main()
