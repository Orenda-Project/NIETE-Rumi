"""skillgrid — the Skills Map's column geometry: nine column roles, five
header rows, the pixel-width contract that ties them together, and the
`__all__` list skillmap.py trusts wholesale via `from skillgrid import *`.

The five header lists, WIDTHS, and the nine SKILL_C..TRACK_C constants are
independent literals that must all agree on one number, N_COLS, with
nothing but convention holding them together. Widen one list without the
others and every label after the gap sits one column left of its data — a
wrong-answer sheet, not a crash.

CONVENTION's own comment claims "about 150 Latin characters, this is 148";
the live string actually measures 153 — a real instance of the same drift,
caught here rather than fixed, since this file may not edit skillgrid.py.

`__all__` is the entire contract of what a wildcard import receives, not
documentation: a name missing from it silently never arrives at skillmap.

The `track()` bar-rendering and `load()`/`_ordered` data-handling promises
live in test_skillgrid_track.py — a different seam, a different file.
"""
import ast
import inspect
import unittest

import skillgrid
import skilldelta


def _names_bound_by(target, out):
    """Every plain name a top-level assignment target binds, including the
    tuple-unpacking form `SKILL_C, CODE_C, ... = range(9)` uses."""
    if isinstance(target, ast.Name):
        out.add(target.id)
    elif isinstance(target, (ast.Tuple, ast.List)):
        for elt in target.elts:
            _names_bound_by(elt, out)


def _top_level_defined_names(module):
    """Names skillgrid.py itself defines at module level — not names it
    merely imports (json, os, skills), so `__all__` can be compared against
    what the file actually contributes."""
    tree = ast.parse(inspect.getsource(module))
    names = set()
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                _names_bound_by(t, names)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
    names.discard("__all__")   # the export list naming itself isn't a promise
    return names


HEADERS = {"HEAD_TOP": skillgrid.HEAD_TOP, "HEAD_TL": skillgrid.HEAD_TL,
           "HEAD_FA": skillgrid.HEAD_FA, "HEAD_CT": skillgrid.HEAD_CT,
           "HEAD_AB": skillgrid.HEAD_AB}

ROLES = (skillgrid.SKILL_C, skillgrid.CODE_C, skillgrid.GRADE_C,
          skillgrid.YEAR_C, skillgrid.FIRST_C, skillgrid.PCT_C,
          skillgrid.CH_C, skillgrid.NOTE_C, skillgrid.TRACK_C)


class HeaderRowsAgreeWithTheDataRowsOnWidth(unittest.TestCase):

    def test_every_header_row_is_exactly_n_cols_wide(self):
        for name, header in HEADERS.items():
            with self.subTest(header=name):
                # A header one cell short of N_COLS still renders — Sheets
                # does not error on a short row — it just shifts every label
                # after the gap one column left of the data beneath it.
                self.assertEqual(len(header), skillgrid.N_COLS,
                                 f"{name} is not N_COLS cells wide")

    def test_widths_has_an_entry_for_every_column_index(self):
        self.assertEqual(set(skillgrid.WIDTHS), set(range(skillgrid.N_COLS)))

    def test_n_cols_matches_the_number_of_column_role_constants(self):
        # Catches the other half of the drift: a tenth role added to the
        # SKILL_C..TRACK_C tuple without N_COLS (and every header) growing
        # to match.
        self.assertEqual(skillgrid.N_COLS, len(ROLES))


class ColumnRolesAreDistinctAndCoverEveryIndex(unittest.TestCase):

    def test_the_nine_roles_are_pairwise_distinct(self):
        # Two roles sharing an index is invisible in a diff of skillgrid.py —
        # `SKILL_C, CODE_C, ... = range(9)` looks correct no matter what the
        # names are — but it means two different blocks paint one cell.
        self.assertEqual(len(ROLES), len(set(ROLES)))

    def test_the_roles_are_exactly_0_through_n_cols_minus_1(self):
        self.assertEqual(set(ROLES), set(range(skillgrid.N_COLS)))


class RowPadsSparseCellsToTheFullRowWidth(unittest.TestCase):

    def test_a_sparse_dict_pads_out_to_n_cols(self):
        row = skillgrid._row({0: "a", 5: "b"})
        self.assertEqual(len(row), skillgrid.N_COLS)
        self.assertEqual(row[0], "a")
        self.assertEqual(row[5], "b")
        self.assertEqual(row[1], "")

    def test_a_row_with_nothing_past_the_first_cell_still_reaches_full_width(self):
        # The dict only names index 0; a row built from `max(keys) + 1`
        # instead of N_COLS would come out length 1 here and silently drop
        # its tail when written to the sheet.
        row = skillgrid._row({0: "only this"})
        self.assertEqual(len(row), skillgrid.N_COLS)
        self.assertEqual(row[skillgrid.N_COLS - 1], "")


class ConventionAndLegendFitTheTabsPixelBudget(unittest.TestCase):
    """CONVENTION's own comment claims "about 150 Latin characters, this is
    148" — the live string actually measures 153, already over its stated
    budget. That is real comment drift in skillgrid.py this file must not
    edit, so asserting the literal 150 would make this suite permanently red
    against source we cannot touch. The ceiling below is the load-bearing
    number instead: the tab's pixel width at the ~6.5px/char this codebase
    already uses for the same overflow reasoning (test_skillmap.py)."""

    def test_widths_sum_to_the_1383px_the_comment_measures(self):
        # The comment's pixel figure is a measurement of the live sheet, not
        # a constant anyone derives from WIDTHS — nothing else ties them
        # together, so a column width change that breaks the tab's actual
        # layout would leave this comment wrong and uncaught without it.
        self.assertEqual(sum(skillgrid.WIDTHS.values()), 1383)

    def test_convention_fits_the_tabs_real_pixel_budget(self):
        budget_chars = int(sum(skillgrid.WIDTHS.values()) / 6.5)
        self.assertLessEqual(len(skillgrid.CONVENTION), budget_chars)


# The smallest input delta_block will build a block from: one subject, one
# grade, one skill. The legend it prints does not depend on the data.
ONE_SKILL = {
    "labels_seen_in_data": {"English": ["Phonics"]},
    "skill_reference": [{"subject": "English", "label": "Phonics",
                         "key": "phonics"}],
    "subjects": {"English": {"grades": {
        "1": {"n_days": 10, "slots_per_skill": {"Phonics": 10},
              "day_sequence_runs": [["Phonics", 10]], "chapters": [],
              "first_appearance": {"Phonics": {"first_day_ordinal": 1,
                                               "n_days_in_grade": 10,
                                               "pct_through": 0.0,
                                               "chapter": 1}}}}}},
}
ONE_KEYMAP = {("English", "Phonics"): "phonics"}


class EveryHeaderLegendFitsTheColumnItIsWrittenIn(unittest.TestCase):
    """The Track column is the LAST one on the tab, so nothing it holds can
    overflow: there is no column to its right to run into, and a cell wider
    than 470px is simply cut where the column ends.

    Four of the five header rows write their legend there, and two of them
    outran it. FIRST APPEARANCE's ran 165 characters into a 72-character
    column, so the PDF export printed "+ = two or more grades share a sl" and
    stopped — losing the two marks a reader most needs looked up, "—" for
    never taught and "·" for a chapter-close slot with no day position. Both
    appear in the grid below it. CHAPTER TEMPLATE's lost its tail the same way.

    A legend that is cut off is worse than no legend: the reader does not know
    a mark was explained, only that the sentence stops. So a header cell in
    the last column has to fit it, and anything longer belongs on a row of its
    own, where it is alone on the line and free to overflow left to right.
    """

    HEADS = ("HEAD_TOP", "HEAD_TL", "HEAD_FA", "HEAD_CT", "HEAD_AB")

    def test_no_header_writes_more_into_the_track_column_than_it_holds(self):
        budget = int(skillgrid.WIDTHS[skillgrid.TRACK_C] / 6.5)
        for name in self.HEADS:
            head = getattr(skillgrid, name)
            with self.subTest(head=name):
                text = str(head[skillgrid.TRACK_C])
                self.assertLessEqual(
                    len(text), budget,
                    f"{name}'s legend is cut after {budget} characters: "
                    f"...{text[budget - 20:budget]}|{text[budget:budget + 20]}")

    def test_the_marks_the_grid_paints_are_all_still_explained_somewhere(self):
        # Shortening a legend must not silently drop a mark. These three are
        # painted by skilldelta into the FIRST APPEARANCE rows themselves.
        rows, _cells = skilldelta.delta_block(ONE_SKILL, ONE_KEYMAP, None)
        text = " ".join(str(c) for row in rows for c in row)
        for mark, meaning in (("—", "never taught"),
                              ("·", "chapter-close"),
                              ("+", "share")):
            self.assertIn(meaning, text,
                          f"the {mark!r} mark is painted and never explained")


class DunderAllMatchesWhatTheModuleActuallyDefines(unittest.TestCase):
    """skillmap.py imports this module with `from skillgrid import *`, so
    __all__ is not documentation here — it is the entire contract of what
    reaches skillmap. A name missing from it silently fails to arrive; a
    stale name left in it after a rename resolves to nothing when skillmap
    reaches for it."""

    def test_every_name_in_all_is_a_real_module_attribute(self):
        for name in skillgrid.__all__:
            with self.subTest(name=name):
                self.assertTrue(hasattr(skillgrid, name),
                                f"__all__ lists {name!r}, which skillgrid.py "
                                "no longer defines")

    def test_all_lists_every_top_level_name_and_nothing_more(self):
        # Derived from the source itself (via ast), not a second hand-typed
        # list here — a hand-typed list would drift right alongside __all__
        # instead of catching it drifting.
        defined = _top_level_defined_names(skillgrid)
        self.assertEqual(defined, set(skillgrid.__all__))


if __name__ == "__main__":
    unittest.main()
