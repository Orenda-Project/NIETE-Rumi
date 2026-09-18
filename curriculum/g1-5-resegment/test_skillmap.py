"""skillmap — the absence block, and the three kinds of absence it holds.

A skill nothing teaches at all is a gap. A skill the Teaching Calendar teaches
outside the book is a note. The block drew both the same way — struck through,
in red, under a heading reading WHAT IS NEVER TAUGHT — so the tab contradicted
the calendar sitting two tabs away from it.

The third is a skill the live build teaches that this tab's snapshot has not
caught up with — the tab contradicted the Coverage Map on the same sheet,
which is the same failure against a nearer neighbour. These are unit tests
over a fixture; the same invariant over the real corpus, which is the one that
matters and the one that caught bd-hlq38, is in `test_skillmap_live.py`.
"""
import unittest

import skilldelta
import skillmap
import skillgrid


BOOK = {
    "labels_seen_in_data": {"English": ["Phonics"]},
    "labels_not_in_ORDER": [],
    "skill_reference": [{"subject": "English", "label": "Phonics",
                         "key": "phonics"}],
    "subjects": {"English": {"grades": {
        "1": {"n_days": 100, "n_chapters": 10,
              "day_sequence_runs": [["Phonics", 100]],
              "slots_per_skill": {"Phonics": 100},
              "chapters": [],
              # The book reaches phonics halfway through.
              "first_appearance": {"Phonics": {"first_day_ordinal": 50,
                                               "n_days_in_grade": 100,
                                               "pct_through": 50.0,
                                               "chapter": 5}}}}}},
}

# What the calendar actually does with it: period 1 of the year.
CALENDAR = {("English", "1"): {"phonics": {"period": 1, "of": 135,
                                           "pct_through": 0.0}}}

KEYMAP = {("English", "Phonics"): "phonics"}

# These two tests are about row registration, not about absence, and an empty
# corpus is the honest fixture for them: no live days, so nothing is vetoed
# and the rows the snapshot proposes are the rows that get laid out.
NO_CORPUS = {}


def _cells(rows, label):
    for row in rows:
        if row and str(row[0]).startswith(label):
            return row
    return None


class BasicsAreNotFiledAsNeverTaught(unittest.TestCase):
    """Communicative language IS taught. The Teaching Calendar allocates it as
    a basics period from the first weeks of April in every Grade 1 and 2
    English and Urdu week — that is the whole of what bd-5ai1h.10 changed. It
    is not in the textbook, so this file, which reads the book, finds no day
    row for it and reported it as a gap: struck through, in red, under a
    heading reading WHAT IS NEVER TAUGHT. The tab contradicted the calendar
    sitting two tabs away from it.

    Three kinds of absence live in this block and they are not the same
    finding. A skill nothing teaches at all (Science Revision) is a gap. A
    skill the calendar teaches outside the book is a note. A skill the live
    build teaches and the snapshot has not caught up with is neither, and is
    vetoed before it reaches the block at all.

    The examples here are ones the live build really does leave untaught.
    Maths Abstract and Grade 4 Concrete stood here before and the build had
    since started teaching both — a fixture that asserts what the corpus
    contradicts is the same mistake as a tab that does.
    """

    GAPS = [("English", "communicative", None),
            ("Science", "revision", None),
            ("Urdu", "qawaid", "4")]
    # No days for any of the three, so every proposal above is a true absence
    # and what is left to test is which heading it lands under. The veto is
    # tested below, and against the live corpus in the last class of the file.
    LIVE = {}

    def test_a_calendar_taught_basic_is_not_struck_through(self):
        rows, struck, basics, _h = skillmap.absence_block(self.GAPS, self.LIVE)
        i = next(i for i, r in enumerate(rows)
                 if "Communicative" in str(r[skillgrid.SKILL_C]))
        self.assertNotIn(i, struck, "the calendar teaches it every week")
        self.assertIn(i, basics)

    def test_a_skill_nothing_teaches_is_still_struck(self):
        rows, struck, basics, _h = skillmap.absence_block(self.GAPS, self.LIVE)
        for label in ("Revision", "Grammar"):
            i = next(i for i, r in enumerate(rows)
                     if str(r[skillgrid.SKILL_C]).endswith(label))
            self.assertIn(i, struck, f"{label} is a real gap")
            self.assertNotIn(i, basics)

    def test_a_gap_the_live_build_teaches_is_never_struck_through(self):
        # The one choke point: a proposal the Coverage Map counts days for
        # cannot be struck, whatever proposed it and for whatever reason.
        # Nothing else has to be right for the heading to be true.
        live = {("Urdu", "qawaid", "4"): 16, ("Science", "revision", "5"): 2}
        rows, struck, _basics, _h = skillmap.absence_block(self.GAPS, live)
        for label in ("Grammar", "Revision"):
            # Science Revision is taught in G5 only, so "never taught in this
            # subject" — a claim about every grade — is false as well.
            i = next(i for i, r in enumerate(rows)
                     if str(r[skillgrid.SKILL_C]).endswith(label))
            self.assertNotIn(i, struck, f"{label} has days in the build")
        self.assertTrue(struck, "the block still has to say something")

    def test_a_gap_the_live_build_teaches_is_named_and_pointed_at(self):
        # Silence is the failure mode left once the false absence is gone.
        # Maths Abstract has no track in this snapshot and 40 days across the
        # grades in the build, so vetoing its gap and stopping there drops a
        # skill off a tab whose whole subject is where each skill's days fall.
        # It gets what a basics period gets instead: its own heading, and the
        # tab that does know its days named in the row.
        live = {("Urdu", "qawaid", "4"): 16}
        rows, _struck, slots, _h = skillmap.absence_block(self.GAPS, live)
        i = next(i for i, r in enumerate(rows)
                 if str(r[skillgrid.SKILL_C]).endswith("Grammar"))
        self.assertIn(i, slots, "taught and unplaced, as a slot row is")
        self.assertIn("Coverage Map", str(rows[i][skillgrid.TRACK_C]))

    def test_the_snapshot_lag_section_has_a_heading_of_its_own(self):
        # Same reasoning as the basics split one test down: a row cannot undo
        # the heading above it, and "WHAT IS NEVER TAUGHT" is false of a skill
        # the build gives days to however the row itself is worded.
        live = {("Urdu", "qawaid", "4"): 16}
        rows, _struck, _slots, heads = skillmap.absence_block(self.GAPS, live)
        i = next(i for i, r in enumerate(rows)
                 if str(r[skillgrid.SKILL_C]).endswith("Grammar"))
        head = max(h for h in heads if h < i)
        self.assertNotIn("NEVER TAUGHT", str(rows[head][0]))
        self.assertIn("snapshot", str(rows[head][0]).lower())

    def test_the_never_taught_heading_does_not_stand_over_a_taught_skill(self):
        # The heading is read before any row under it. If a basics row sits
        # beneath "WHAT IS NEVER TAUGHT", the row's own wording cannot undo it.
        rows, _struck, basics, _h = skillmap.absence_block(self.GAPS, self.LIVE)
        head = max(i for i in range(min(basics)) if "NEVER" in str(rows[i][0]))
        between = " ".join(str(rows[i][0]) for i in range(head + 1, min(basics)))
        self.assertIn("basics", between.lower(),
                      "nothing tells the reader the heading stopped applying")

    def test_every_cell_fits_the_column_it_is_written_in(self):
        # The block's cells are read, not overflowed: a row here has a value in
        # the last column, so anything too long for its own column is cut. At
        # font size 10 a column holds roughly one character per 6.5px.
        rows, _struck, _basics, _h = skillmap.absence_block(self.GAPS, self.LIVE)
        for row in rows[2:]:
            if sum(1 for c in row if c) < 2:
                continue        # a banner row, alone on its line and free to
                                # overflow across the empty columns beside it
            for col, width in skillgrid.WIDTHS.items():
                text = str(row[col])
                if not text:
                    continue
                self.assertLessEqual(len(text), int(width / 6.5),
                                     f"{text!r} is cut off in column {col}")


class EveryLegendRowIsRegisteredAsProse(unittest.TestCase):
    """A row that is one long sentence has to be told it may overflow.

    `skillfmt._wrap` sets wrapStrategy WRAP down every column of the body, and
    `_prose` hands OVERFLOW_CELL back to exactly the rows named in
    `plan["prose_rows"]`. A sentence row that is not in that list is cut at the
    edge of its own column — which is what happened to the FIRST APPEARANCE
    marks legend: 160 characters written into column A, printed as far as
    "+ = two or more grades share a slice · — = n" and stopped.

    The legend is written in skilldelta, the plan is assembled here, and
    nothing connected the two. So this asserts the connection rather than the
    row number: every row whose only cell is a sentence must be prose.
    """

    def test_the_first_appearance_marks_legend_may_overflow(self):
        rows, plan = skillmap.build(BOOK, NO_CORPUS, CALENDAR)
        i = next(i for i, r in enumerate(rows)
                 if str(r[skillgrid.SKILL_C]) == skillgrid.FA_MARKS)
        self.assertIn(i, plan["prose_rows"],
                      "the marks legend is cut at the edge of column A")

    def test_no_sentence_row_is_left_unregistered(self):
        # A sentence is a cell too long for its own column, alone on its row.
        # Either it is prose and free to run right, or it is cut.
        rows, plan = skillmap.build(BOOK, NO_CORPUS, CALENDAR)
        budget = int(skillgrid.WIDTHS[skillgrid.SKILL_C] / 6.5)
        for i, row in enumerate(rows):
            # The title and subtitle rows are re-set to OVERFLOW_CELL by
            # skillfmt._frame, and a section band by _sections. Only the body
            # is left to _wrap, and only prose_rows is given back its overflow.
            if i < plan["head_rows"] or i in plan["sections"]:
                continue
            if i in plan["prose_rows"]:
                continue
            if sum(1 for c in row if c) != 1 or not row[skillgrid.SKILL_C]:
                continue
            self.assertLessEqual(
                len(str(row[skillgrid.SKILL_C])), budget,
                f"row {i} is a sentence nothing lets overflow")


if __name__ == "__main__":
    unittest.main()
