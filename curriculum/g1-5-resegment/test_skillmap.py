"""skillmap — the absence block, and the two kinds of absence it holds.

A skill nothing teaches at all is a gap. A skill the Teaching Calendar teaches
outside the book is a note. The block drew both the same way — struck through,
in red, under a heading reading WHAT IS NEVER TAUGHT — so the tab contradicted
the calendar sitting two tabs away from it.
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

    Two kinds of absence live in this block and they are not the same finding.
    A skill nothing teaches at all (Maths Abstract) is a gap. A skill the
    calendar teaches outside the book is a note. Only the first is struck.
    """

    GAPS = [("English", "communicative", None),
            ("Maths", "abstract", None),
            ("Maths", "concrete", "4")]

    def test_a_calendar_taught_basic_is_not_struck_through(self):
        rows, struck, basics, _h = skillmap.absence_block(self.GAPS)
        i = next(i for i, r in enumerate(rows)
                 if "Communicative" in str(r[skillgrid.SKILL_C]))
        self.assertNotIn(i, struck, "the calendar teaches it every week")
        self.assertIn(i, basics)

    def test_a_skill_nothing_teaches_is_still_struck(self):
        rows, struck, basics, _h = skillmap.absence_block(self.GAPS)
        for label in ("Abstract", "Concrete"):
            i = next(i for i, r in enumerate(rows)
                     if str(r[skillgrid.SKILL_C]).endswith(label))
            self.assertIn(i, struck, f"{label} is a real gap")
            self.assertNotIn(i, basics)

    def test_the_never_taught_heading_does_not_stand_over_a_taught_skill(self):
        # The heading is read before any row under it. If a basics row sits
        # beneath "WHAT IS NEVER TAUGHT", the row's own wording cannot undo it.
        rows, _struck, basics, _h = skillmap.absence_block(self.GAPS)
        head = max(i for i in range(min(basics)) if "NEVER" in str(rows[i][0]))
        between = " ".join(str(rows[i][0]) for i in range(head + 1, min(basics)))
        self.assertIn("basics", between.lower(),
                      "nothing tells the reader the heading stopped applying")

    def test_every_cell_fits_the_column_it_is_written_in(self):
        # The block's cells are read, not overflowed: a row here has a value in
        # the last column, so anything too long for its own column is cut. At
        # font size 10 a column holds roughly one character per 6.5px.
        rows, _struck, _basics, _h = skillmap.absence_block(self.GAPS)
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
        rows, plan = skillmap.build(BOOK, CALENDAR)
        i = next(i for i, r in enumerate(rows)
                 if str(r[skillgrid.SKILL_C]) == skillgrid.FA_MARKS)
        self.assertIn(i, plan["prose_rows"],
                      "the marks legend is cut at the edge of column A")

    def test_no_sentence_row_is_left_unregistered(self):
        # A sentence is a cell too long for its own column, alone on its row.
        # Either it is prose and free to run right, or it is cut.
        rows, plan = skillmap.build(BOOK, CALENDAR)
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
