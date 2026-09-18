"""support — the Skill Taxonomy tab, the pipeline recipe, the flat dump.

The Skill Taxonomy tab is a DEFINITION tab: every skill type per subject, what
the day actually is, and — for Maths — which CPA phase the chip stands for, so
reviewers and LP writers argue about the teaching rather than about the words.
It used to carry a `Days` column too, and that is the failure this file now
holds the line on: the Coverage Map counts the days the build really teaches,
per grade and per chapter, and a second copy of that number here is a second
number to go stale. One number, one home.

What can go wrong quietly, and is therefore asserted below:

  * A DAY COUNT CREEPING BACK IN, in a column or inside a sentence. Nothing on
    this tab may be a tally; a cell holding an integer is the tell.
  * A ROW NARROWER THAN THE HEADER. `sheetio.titled` takes the tab's width
    from `rows[0]`, and Sheets writes a short row as a short row — the tail
    columns keep whatever the previous build left there.
  * A BLANK `CPA phase` ON A MATHS ROW. The Maths skill type IS the CPA ramp;
    a blank there is the tab failing at the one job it has for Maths. On an
    English, Urdu or Science row the same cell must stay empty — CPA is a
    Maths idea and painting it on other subjects invents a claim.
  * THE CPA CONFLICT COUNT GOING SILENT. It reports Maths days whose
    `cpa_phase` field disagrees with the skill type. It has no column of its
    own any more, so it has to reach the reader inside the sentence.
  * A `Source` LINE THAT STILL DESCRIBES A TALLY. The rows are definitions;
    a source that says "counted" is describing a table that no longer exists.
"""
import unittest

import skills
import support


MATHS_RAMP = ("concrete", "pictorial", "pictorial_abstract", "abstract",
              "word_problem")


def day(subject, skill, grade=1):
    """The three fields the taxonomy reads off a segment row."""
    return {"subject": subject, "skill_type": skill, "grade": grade}


def corpus():
    """One book per subject, in the subjects' own vocabularies. Maths carries
    the whole CPA ramp plus the bookkeeping that has no phase."""
    rows = []
    for grade in (1, 2):
        for key in MATHS_RAMP:
            rows.append(day("Maths", skills.label(key), grade))
        rows.append(day("Maths", skills.label("revision"), grade))
    for key in ("reading_comprehension", "writing"):
        rows.append(day("English", skills.label(key), 3))
    for key in ("buland_khwani", "tafheem"):
        rows.append(day("Urdu", skills.label(key), 4))
    rows.append(day("Science", skills.label("engage_hook"), 5))
    return rows


def taxonomy(conflicts=0):
    return support.skill_taxonomy(corpus(), conflicts)


def data_rows(rows):
    """The definition rows: header, banners and the trailing blocks dropped."""
    return [r for r in rows[1:] if r[0] in
            ("English", "Urdu", "Maths", "Science") and r[1] not in
            ("the CPA ramp", "this build's ramp", "skill type vs cpa_phase")]


class TheTaxonomyDefinesAndDoesNotCount(unittest.TestCase):
    """Dropping `Days` is the point; a count creeping back is the regression."""

    def test_the_header_names_no_day_count(self):
        self.assertEqual(taxonomy()[0],
                         ["Subject", "Skill type", "Grades", "CPA phase",
                          "What the day is", "Source"])

    def test_no_cell_anywhere_on_the_tab_is_a_number(self):
        # A tally is an integer in a cell. The conflict count is prose now,
        # and prose is the one place a number may live on a definition tab.
        for row in taxonomy(42):
            for cell in row:
                self.assertNotIsInstance(cell, int, row)

    def test_every_row_is_as_wide_as_the_header(self):
        rows = taxonomy(42)
        for i, row in enumerate(rows):
            self.assertEqual(len(row), support.TAX_COLS, f"row {i}: {row}")

    def test_the_tab_is_as_wide_as_it_says_it_is(self):
        # build.py quotes TAX_COLS to `format_grid` and to the index. A header
        # that grew without the constant growing writes past the formatting.
        self.assertEqual(len(taxonomy()[0]), support.TAX_COLS)


class EveryDefinitionSaysWhereItsDefinitionComesFrom(unittest.TestCase):

    def test_no_definition_row_claims_to_have_counted_anything(self):
        # It used to read "counted from the segmentation corpus", which was
        # true of the Days column and of nothing that is left.
        for row in data_rows(taxonomy()):
            self.assertNotIn("counted", row[-1], row)

    def test_every_definition_row_carries_a_source(self):
        for row in data_rows(taxonomy()):
            self.assertTrue(row[-1].strip(), row)

    def test_every_definition_row_says_what_the_day_is(self):
        # `What the day is` is the whole product of this tab. A blank one is
        # a skill type in the vocabulary that nobody can look up.
        for row in data_rows(taxonomy()):
            self.assertTrue(row[4].strip(), row)


class TheCpaPhaseIsFilledForMathsAndEmptyEverywhereElse(unittest.TestCase):

    def test_every_maths_ramp_row_names_its_phase(self):
        rows = [r for r in data_rows(taxonomy()) if r[0] == "Maths"]
        ramp = {skills.label(k) for k in MATHS_RAMP}
        listed = {r[1]: r[3] for r in rows}
        for label in ramp:
            self.assertIn(label, listed)
            self.assertTrue(listed[label].strip(),
                            f"{label} carries no CPA phase")

    def test_the_phase_is_written_the_way_the_reader_reads_it(self):
        # `CPA_FROM_SKILL` holds taxonomy keys, not display text. Printing the
        # key puts a lowercase `abstract` in a reviewer-facing column beside
        # `Pictorial → Abstract` in the column next to it.
        phases = {r[3] for r in data_rows(taxonomy())
                  if r[0] == "Maths" and r[3]}
        self.assertEqual(phases, {"Concrete", "Pictorial", "Abstract"})

    def test_maths_bookkeeping_has_no_phase_because_it_teaches_no_maths(self):
        rows = {r[1]: r[3] for r in data_rows(taxonomy()) if r[0] == "Maths"}
        self.assertEqual(rows[skills.label("revision")], "")

    def test_no_other_subject_is_given_a_cpa_phase(self):
        for row in data_rows(taxonomy()):
            if row[0] != "Maths":
                self.assertEqual(row[3], "", row)


class TheCpaConflictCountStillReachesTheReader(unittest.TestCase):
    """It lost its column with `Days`; losing the reader would be a regression."""

    def test_the_count_is_printed_where_the_conflict_is_explained(self):
        block = [r for r in taxonomy(42) if r[1] == "skill type vs cpa_phase"]
        self.assertEqual(len(block), 1, "the data-quality row went missing")
        self.assertIn("42", " ".join(block[0]))

    def test_the_block_is_headed_so_it_is_not_read_as_a_definition(self):
        rows = taxonomy(42)
        self.assertIn("DATA QUALITY", [r[0] for r in rows])

    def test_nothing_is_said_when_nothing_disagrees(self):
        # A standing "0 conflicts" row is noise that teaches the reader to
        # skip the block, which is the block they must not skip.
        self.assertNotIn("DATA QUALITY", [r[0] for r in taxonomy(0)])


class TheVocabularyIsTheOneTheCorpusActuallyUses(unittest.TestCase):
    """Why `all_rows` is still a parameter after the counting stopped."""

    def test_a_skill_type_no_day_in_the_corpus_uses_is_not_listed(self):
        # Communicative language and Number fluency are in the subjects'
        # ORDER and are taught in basics periods, not textbook days, so no
        # segment row carries them and the tab does not define them here.
        listed = {(r[0], r[1]) for r in data_rows(taxonomy())}
        self.assertNotIn(("Maths", skills.label("number_fluency")), listed)
        self.assertNotIn(("English", skills.label("communicative")), listed)

    def test_each_subject_is_listed_in_its_teaching_order(self):
        rows = [r for r in data_rows(taxonomy()) if r[0] == "Maths"]
        order = [skills.label(k) for k in skills.ORDER["Maths"]]
        got = [r[1] for r in rows]
        self.assertEqual(got, [lb for lb in order if lb in got])

    def test_every_grade_that_teaches_the_skill_is_named(self):
        rows = {r[1]: r[2] for r in data_rows(taxonomy()) if r[0] == "Maths"}
        self.assertEqual(rows[skills.label("concrete")], "1, 2")

    def test_a_label_the_taxonomy_does_not_name_is_still_listed(self):
        # A live label absent from hand-edited ORDER must not vanish: the tab
        # is the vocabulary, and a word in use and undefined is the gap.
        rows = corpus() + [day("English", "Handwriting", 3)]
        listed = [r[1] for r in support.skill_taxonomy(rows)]
        self.assertIn("Handwriting", listed)


class TheReadThisBlockPointsAtWhereTheRampIsMeasured(unittest.TestCase):

    def test_the_pointer_fills_the_tab_it_sits_on(self):
        for row in support.cpa_pointer():
            self.assertEqual(len(row), support.TAX_COLS, row)

    def test_it_names_the_tab_that_measures_the_ramp(self):
        text = " ".join(" ".join(r) for r in support.cpa_pointer())
        self.assertIn("SKILLS MAP", text)

    def test_it_points_at_the_counts_instead_of_reprinting_them(self):
        # This sentence used to carry the phase counts inline — "Concrete is
        # 36 / 6 / 1 / 0 / 33 days in G1–G5 … Abstract is 0 in every grade".
        # By the time anyone read it the build said Concrete 36/15/15/11/33 and
        # Abstract 11/7/3/16/3, so the tab was printing a false pedagogical
        # finding in the reviewer's voice. A hardcoded count in prose is the
        # same defect as a `Days` column and it goes stale the same way; only
        # the tab that does the counting may state one.
        prose = support.cpa_pointer()[2][4]
        self.assertFalse([c for c in prose if c.isdigit()], prose)


class ThePipelineAndTheFlatDumpFillEveryColumn(unittest.TestCase):

    def test_every_stage_row_matches_the_pipeline_header(self):
        rows = support.pipeline_tab()
        for row in rows:
            self.assertEqual(len(row), len(rows[0]), row)

    def test_every_segment_row_matches_the_flat_header(self):
        seg = {"grade": 4, "subject": "Maths", "book": "grade_4_math",
               "chapter": 2, "chapter_title": "Fractions", "kind": "day",
               "day_label": "Day 3", "topic": "Halves", "skill_type":
               "Concrete", "pages": "12–13", "primary_slo": "M-4-2-1",
               "primary_slo_desc": "Name a half", "supporting_slos": "",
               "blooms": "Understand", "flags": ""}
        rows = support.all_segments([seg])
        self.assertEqual(len(rows), 2)
        self.assertEqual(len(rows[1]), len(rows[0]))
        self.assertEqual(rows[1][0], "G4")
        self.assertEqual(rows[1][2], "G4 Maths")


if __name__ == "__main__":
    unittest.main()
class TabsNotBuiltYetAreNamedOnThePipelineTab(unittest.TestCase):
    """PENDING_TABS existed and was printed nowhere, which is the one thing a
    design-pending record must not be: a tab nobody proposed is indistinguishable
    from a tab nobody thought of, and Communicative Balance (bd-v8008) is a
    deliberate not-yet, not an oversight.
    """

    def setUp(self):
        self.rows = support.pipeline_tab()
        self.width = len(self.rows[0])

    def test_every_row_is_the_full_width(self):
        for r in self.rows:
            self.assertEqual(len(r), self.width, r)

    def test_each_pending_tab_is_named(self):
        flat = "\n".join("\t".join(r) for r in self.rows)
        for name, _, _ in support.PENDING_TABS:
            self.assertIn(name, flat)

    def test_a_pending_tab_says_not_built_and_never_pending_alone(self):
        rows = [r for r in self.rows
                if r[1] in {n for n, _, _ in support.PENDING_TABS}]
        self.assertEqual(len(rows), len(support.PENDING_TABS))
        for r in rows:
            self.assertEqual(r[4], "not built")
            self.assertTrue(r[5].strip(), r)

    def test_the_stage_rows_still_come_first(self):
        codes = [r[0] for r in self.rows[1:1 + len(support.STAGES)]]
        self.assertEqual(codes, [s[0] for s in support.STAGES])

    def test_the_block_is_labelled_so_it_cannot_read_as_a_stage(self):
        labels = [r[0] for r in self.rows]
        self.assertIn("TABS NOT BUILT YET", labels)
