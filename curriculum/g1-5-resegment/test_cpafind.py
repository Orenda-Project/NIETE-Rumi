"""cpafind — the CPA ramp finding, and the two ways it has already gone wrong.

The Skill Taxonomy tab carried this finding once before as prose with the
numbers written into it by hand. The build moved and the sentence did not, so
the tab printed a pedagogical claim that was false of its own build: Concrete
flat at nothing in the middle grades and Abstract absent everywhere, while the
Coverage Map two tabs away counted both (bd-hlq38). A stale number in prose is
read as a finding, not as a cache.

So there are two separate contracts here and both are asserted below.

  * THE NUMBERS ARE THE BUILD'S. Every count must be the count `covdata`
    gives the Coverage Map for the same grade and the same skill type. Not a
    recount, not a snapshot, not a fixture standing in for one — the tests
    compare against `covdata.count` over the same rows.
  * THE SENTENCE IS NOT WRITTEN AROUND AN ASSUMED SHAPE. A ramp that thins
    and a ramp that rebounds must produce different readings, an Abstract
    line that falls may not be described as growth, and a grade with none of
    a phase has to be said plainly. Each of those is a separate test, because
    the failure mode is prose that is true of the shape its author expected.

And the guard that stops the original defect recurring: no digit may appear in
this module's source below its own docstring. The counts arrive as arguments.
"""
import inspect
import unittest

import covdata
import cpafind
import skills
import support


def day(skill, chapter=1):
    """The three fields `covdata.count` reads off a segment row."""
    return {"kind": "day", "skill_type": skill, "chapter": chapter}


def corpus(shape):
    """{grade: (concrete days, abstract days)} -> a Maths corpus.

    The shape is an input, not an expected tally: the test asserts the
    finding's numbers against `covdata.count` over these very rows, so a
    fixture cannot quietly become the authority the snapshot was.
    """
    books = []
    for grade, (concrete, abstract) in sorted(shape.items()):
        rows = [day("concrete") for _ in range(concrete)]
        rows += [day("abstract") for _ in range(abstract)]
        rows.append(day("revision", chapter=2))
        books.append((grade, rows, {}))
    return {"Maths": books}


# The shape the live build has: Concrete falls to G4 and jumps back at G5,
# Abstract present in every grade but peaking at G4 and collapsing after.
LIVE_SHAPE = {1: (36, 11), 2: (15, 7), 3: (15, 3), 4: (11, 16), 5: (33, 3)}
HEALTHY = {1: (30, 2), 2: (24, 6), 3: (18, 10), 4: (12, 18), 5: (6, 24)}
NO_ABSTRACT = {1: (30, 0), 2: (24, 4)}
# Nothing moves: no step in either phase rises or falls. And one grade, which
# has no steps at all — the shapes with no ramp in them to read.
FLAT = {1: (20, 5), 2: (20, 5), 3: (20, 5)}
ONE_GRADE = {4: (20, 5)}


def prose(shape):
    return cpafind.reading(cpafind.ramp(corpus(shape)))


class TheCountsAreTheOnesTheCoverageMapCounts(unittest.TestCase):
    """One tally or two tabs that disagree — there is no third option."""

    def test_every_count_matches_covdata_over_the_same_rows(self):
        built = corpus(LIVE_SHAPE)
        ramp = cpafind.ramp(built)
        for grade, rows, _st in built["Maths"]:
            per, _by_ch, _admin = covdata.count(rows, "Maths")
            for key in cpafind.PHASES:
                with self.subTest(grade=grade, key=key):
                    self.assertEqual(ramp[grade][key], per.get(key, 0))

    def test_every_grade_the_build_teaches_maths_in_is_named(self):
        self.assertEqual(sorted(cpafind.ramp(corpus(LIVE_SHAPE))),
                         sorted(LIVE_SHAPE))

    def test_the_per_grade_counts_reach_the_sentence(self):
        text = prose(LIVE_SHAPE)
        for grade, (concrete, abstract) in LIVE_SHAPE.items():
            self.assertIn(f"G{grade} {concrete}", text)
            self.assertIn(f"G{grade} {abstract}", text)

    def test_both_phases_are_named_in_the_readers_words(self):
        text = prose(LIVE_SHAPE)
        for key in cpafind.PHASES:
            self.assertIn(skills.label(key), text)


class TheReadingDescribesTheRampItWasGiven(unittest.TestCase):
    """The defect was prose written around an assumed shape. A sentence that
    reads the same for a thinning ramp and a rebounding one is that defect."""

    def test_a_ramp_that_thins_and_grows_reads_as_the_shape_it_wants(self):
        text = prose(HEALTHY)
        self.assertIn("thins out as the grade rises", text)
        self.assertIn("grows", text)
        self.assertNotIn("does not thin out", text)

    def test_a_concrete_count_that_climbs_back_up_is_stated(self):
        text = prose(LIVE_SHAPE)
        self.assertIn("does not thin out", text)
        self.assertIn("climbs back up in G5", text)

    def test_an_abstract_line_that_falls_is_never_called_growth(self):
        text = prose(LIVE_SHAPE)
        self.assertIn("does not grow", text)
        self.assertIn("heaviest in G4", text)
        self.assertIn("G2, G3 and G5", text)

    def test_the_top_grade_moving_both_ways_at_once_is_named(self):
        # Concrete up and Abstract down in the last primary year is the
        # sharpest thing in these numbers; a reading that omits it is smoothing.
        self.assertIn("the wrong way at once", prose(LIVE_SHAPE))

    def test_a_grade_with_no_abstract_at_all_is_said_plainly(self):
        text = prose(NO_ABSTRACT)
        self.assertIn("not taught at all in G1", text)

    def test_a_flat_line_is_never_read_as_thinning_or_growing(self):
        # Neither phase moves. The default branch of a clause written around
        # a healthy ramp is exactly where an unearned claim hides: nothing
        # fell, so nothing thinned, and nothing rose, so nothing grew.
        text = prose(FLAT)
        self.assertIn("does not thin out", text)
        self.assertNotIn("which is the shape the ramp wants", text)
        self.assertIn("does not grow", text)
        self.assertNotIn("the destination the ramp exists to reach", text)

    def test_a_single_grade_build_claims_no_ramp_at_all(self):
        # One grade is no steps, so every comparison is vacuously true. A
        # partial build must not read as a healthy one.
        text = prose(ONE_GRADE)
        self.assertNotIn("which is the shape the ramp wants", text)
        self.assertNotIn("the destination the ramp exists to reach", text)

    def test_the_reading_is_two_readings_not_one(self):
        # Every shape must produce a Concrete clause and an Abstract clause;
        # a shape that silences one of them hides half the ramp.
        for shape in (LIVE_SHAPE, HEALTHY, NO_ABSTRACT, FLAT,
                      ONE_GRADE):
            with self.subTest(shape=sorted(shape)):
                text = prose(shape)
                self.assertIn("Concrete", text)
                self.assertIn("Abstract", text)


class NoCountIsWrittenIntoThisModule(unittest.TestCase):
    """The guard on the original defect, mirroring the one on `cpa_pointer`.

    That test forbids a digit in the pointer's rendered cell. This one forbids
    a digit in the source that renders the finding, which is the only place a
    hardcoded phase count could now hide: the counts must arrive as arguments.
    The module docstring is excluded on purpose — it records the stale figures
    as evidence, and evidence of the bug is not the bug.
    """

    def test_no_digit_appears_below_the_module_docstring(self):
        src = inspect.getsource(cpafind).replace(cpafind.__doc__, "")
        self.assertFalse([c for c in src if c.isdigit()], src)


class TheFindingFitsTheTabItSitsOn(unittest.TestCase):

    def test_every_finding_row_is_the_width_it_is_given(self):
        for row in cpafind.finding(cpafind.ramp(corpus(LIVE_SHAPE)),
                                   support.TAX_COLS):
            self.assertEqual(len(row), support.TAX_COLS, row)

    def test_no_finding_cell_is_a_number(self):
        # Same rule as the rest of the tab: the tally lives in prose, because
        # an integer in a cell is a column, and a column here is the `Days`
        # column coming back.
        for row in cpafind.finding(cpafind.ramp(corpus(LIVE_SHAPE)),
                                   support.TAX_COLS):
            for cell in row:
                self.assertNotIsInstance(cell, int, row)

    def test_the_grades_column_is_the_range_the_build_teaches(self):
        rows = cpafind.finding(cpafind.ramp(corpus(LIVE_SHAPE)),
                               support.TAX_COLS)
        self.assertEqual(rows[0][2], "1–5")

    def test_the_taxonomy_tab_carries_the_finding_when_it_is_given(self):
        ramp = cpafind.ramp(corpus(LIVE_SHAPE))
        rows = support.skill_taxonomy(
            [{"subject": "Maths", "skill_type": skills.label("concrete"),
              "grade": 1}], cpa_ramp=ramp)
        flat = "\n".join("\t".join(r) for r in rows)
        self.assertIn(cpafind.reading(ramp), flat)

    def test_the_tab_says_nothing_about_the_ramp_it_was_not_given(self):
        # A caller with no corpus in hand — a partial build, a test of the
        # definitions alone. Better silent than a ramp inferred from part of one.
        rows = support.skill_taxonomy(
            [{"subject": "Maths", "skill_type": skills.label("concrete"),
              "grade": 1}])
        self.assertNotIn("this build's ramp", [r[1] for r in rows])


class TheFindingIsBuiltFromTheLiveCorpus(unittest.TestCase):
    """A fixture can satisfy everything above. This is the one that cannot:
    the numbers on the tab have to be the numbers the live build teaches."""

    def setUp(self):
        try:
            import build
            import corpuscheck
            corpuscheck.require(build.SEG_DIR, build.FDE_DIR,
                                build.SKILLSMAP_JSON)
            self.corpus = build.load_corpus()[0]
        except Exception as exc:                       # pragma: no cover
            self.skipTest(f"no local corpus: {exc}")

    def test_the_live_ramp_agrees_with_covdata_grade_by_grade(self):
        ramp = cpafind.ramp(self.corpus)
        for grade, rows, _st in self.corpus["Maths"]:
            per, _by_ch, _admin = covdata.count(rows, "Maths")
            for key in cpafind.PHASES:
                with self.subTest(grade=grade, key=key):
                    self.assertEqual(ramp[grade][key], per.get(key, 0))

    def test_the_live_sentence_prints_the_live_counts(self):
        ramp = cpafind.ramp(self.corpus)
        text = cpafind.reading(ramp)
        for grade in sorted(ramp):
            for key in cpafind.PHASES:
                self.assertIn(f"G{grade} {ramp[grade][key]}", text)


if __name__ == "__main__":
    unittest.main()
