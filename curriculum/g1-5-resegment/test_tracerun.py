# -*- coding: utf-8 -*-
"""The trace-block plan: which rows get a cell, and what goes in it.

Rewritten 2026-09-21. The block used to be ten columns; nine of them held
either nothing or the same string on all 1,923 traced rows, so it is one
`Traces` column holding a JSON object keyed by pipeline stage. The tests
read the header from `tabs` rather than pinning a fixture, because the
whole point of the change is that the column set moved.
"""
import json
import unittest

import tabs
import tracerun as tr

HEADER = tabs.header("Science")
URLMAP = {("grade_4_general_science", 6): "https://pub-x.r2.dev/a/pg_006.json",
          ("grade_4_general_science", 7): "https://pub-x.r2.dev/a/pg_007.json"}
BOOKS = set(b for b, _ in URLMAP)
GID = 99
STAMP = "2026-09-21"
TRACES_I = HEADER.index(tabs.TRACES_COLUMN)


def rows(*specs):
    """specs: (column A, printed pages). Header is row 3, so body starts at 4."""
    return [[a] + [""] * 2 + [pg] + [""] * (len(HEADER) - 4) for a, pg in specs]


def plan(*specs):
    return tr.plan("Science", GID, HEADER, rows(*specs), URLMAP, BOOKS, STAMP)


def value(req):
    return req["updateCells"]["rows"][0]["values"][0]["userEnteredValue"][
        "stringValue"]


class TheColumnLetters(unittest.TestCase):
    def test_counts_from_zero(self):
        self.assertEqual(tr.letter(0), "A")
        self.assertEqual(tr.letter(12), "M")

    def test_crosses_into_two_letters(self):
        self.assertEqual(tr.letter(25), "Z")
        self.assertEqual(tr.letter(26), "AA")


class TheRowsThatGetATrace(unittest.TestCase):
    def test_a_day_an_assessment_and_a_review_all_carry_one_cell(self):
        _, t = plan(("GRADE 4", ""), ("Day 1", "6"),
                    (u"✅ Ch. Assessment", "7"), (u"\U0001f4cb Ch. Review", "6"))
        self.assertEqual((t["rows"], t["traced"]), (3, 3))

    def test_a_chapter_header_gets_nothing(self):
        _, t = plan(("GRADE 4", ""), ("Chapter 1: Matter", "6-7"), ("Day 1", "6"))
        self.assertEqual(t["rows"], 1)

    def test_a_row_above_the_first_grade_banner_is_skipped(self):
        """Without a grade there is no book, so a cell would be a guess."""
        _, t = plan(("Day 1", "6"), ("GRADE 4", ""), ("Day 2", "7"))
        self.assertEqual(t["rows"], 1)


class TheCellsThatGetBuilt(unittest.TestCase):
    def test_one_header_is_stamped_and_nothing_else_is(self):
        reqs, _ = plan(("GRADE 4", ""))
        self.assertEqual([value(r) for r in reqs],
                         ["%s (%s)" % (tabs.TRACES_COLUMN, STAMP)])

    def test_a_day_writes_into_the_traces_column_only(self):
        reqs, _ = plan(("GRADE 4", ""), ("Day 1", "6-7"))
        cols = [r["updateCells"]["range"]["startColumnIndex"] for r in reqs]
        self.assertEqual(cols, [TRACES_I, TRACES_I])

    def test_the_cell_is_json_with_one_label_per_published_page(self):
        reqs, t = plan(("GRADE 4", ""), ("Day 1", "6-7"))
        cell = json.loads(value(reqs[1]))
        self.assertEqual(cell, {"page_truth": [u"pg 6", u"pg 7"]})
        self.assertEqual(t["links"], 2)

    def test_no_url_is_spelt_out_in_the_text(self):
        """bd-960al. 308,604 characters of near-identical prefix, gone."""
        reqs, _ = plan(("GRADE 4", ""), ("Day 1", "6-7"))
        text = value(reqs[1])
        for url in URLMAP.values():
            self.assertNotIn(url, text)

    def test_an_unpublished_page_is_counted_and_named_in_the_cell(self):
        reqs, t = plan(("GRADE 4", ""), ("Day 1", "6-8"))
        cell = json.loads(value(reqs[1]))
        self.assertEqual(cell["pages_unpublished"], [8])
        self.assertEqual((t["links"], t["gaps"]), (2, 1))

    def test_each_page_label_carries_its_address_on_a_run(self):
        """bd-960al, overturning the old rule that this cell took no runs.

        The reasoning then was that a run would be a second copy of an
        address the JSON already held. It is the other way round: the run
        is now the only copy, and the text is a fifth of the width.
        """
        reqs, _ = plan(("GRADE 4", ""), ("Day 1", "6-7"))
        runs = reqs[1]["updateCells"]["rows"][0]["values"][0]["textFormatRuns"]
        linked = [r["format"]["link"]["uri"] for r in runs
                  if r["format"].get("link")]
        self.assertEqual(linked, [URLMAP[("grade_4_general_science", 6)],
                                  URLMAP[("grade_4_general_science", 7)]])

    def test_a_gap_only_cell_carries_no_link_run(self):
        reqs, _ = plan(("GRADE 4", ""), ("Day 1", "99"))
        runs = reqs[1]["updateCells"]["rows"][0]["values"][0]["textFormatRuns"]
        self.assertEqual([r for r in runs if r["format"].get("link")], [])

    def test_a_day_with_no_printed_pages_gets_no_cell_at_all(self):
        """An empty object down a column is the constant this replaced."""
        reqs, t = plan(("GRADE 4", ""), ("Day 1", ""))
        self.assertEqual((t["traced"], t["no artefact"]), (0, 1))
        self.assertEqual(len(reqs), 1)

    def test_a_day_whose_every_page_is_unpublished_still_gets_a_cell(self):
        # bd-9hjsp. This row used to fall through the same door as a row with
        # no pages, and the two are not the same row: this one names a page
        # that still needs uploading, and a blank cell buries that. Only the
        # EMPTY object was worth suppressing, not every cell without a link.
        reqs, t = plan(("GRADE 4", ""), ("Day 1", "99"))
        self.assertEqual((t["traced"], t["no artefact"]), (1, 0))
        self.assertEqual(json.loads(value(reqs[1])),
                         {"pages_unpublished": [99]})
        self.assertEqual((t["links"], t["gaps"]), (0, 1))


class TheRegroup(unittest.TestCase):
    """The collapsed groups are re-derived, never nudged."""

    LIVE = [(12, 18), (21, 23), (19, 29)]

    def reqs(self, subject="Science", ncols=31):
        return tr.regroup(subject, GID, self.LIVE, ncols)

    def test_every_live_group_is_deleted_first(self):
        deleted = [(r["deleteDimensionGroup"]["range"]["startIndex"],
                    r["deleteDimensionGroup"]["range"]["endIndex"])
                   for r in self.reqs() if "deleteDimensionGroup" in r]
        self.assertEqual(deleted, self.LIVE)

    def test_the_whole_tab_is_unhidden_before_anything_is_regrouped(self):
        r = self.reqs()
        adds = [i for i, q in enumerate(r) if "addDimensionGroup" in q]
        unhide = [i for i, q in enumerate(r)
                  if "updateDimensionProperties" in q
                  and q["updateDimensionProperties"]["properties"] == {
                      "hiddenByUser": False}]
        self.assertEqual(len(unhide), 1)
        self.assertTrue(all(unhide[0] < i for i in adds))

    def test_the_crisped_tab_has_nothing_left_to_collapse(self):
        """Every remaining column carries values, so none of them hide.

        This is the answer to "i dont see it on my sheet": the old tab put
        Stage C inside collapsed groups, and the reviewer could not see
        what had been written.
        """
        for subject in ("English", "Urdu", "Maths", "Science"):
            self.assertEqual(tabs.groups(subject), [], subject)
            self.assertEqual(
                [r for r in tr.regroup(subject, GID, [], 24)
                 if "addDimensionGroup" in r], [], subject)

    def test_the_new_groups_leave_the_traces_column_out(self):
        added = [(r["addDimensionGroup"]["range"]["startIndex"],
                  r["addDimensionGroup"]["range"]["endIndex"])
                 for r in self.reqs() if "addDimensionGroup" in r]
        self.assertEqual(added, [tuple(g) for g in tabs.groups("Science")])
        self.assertTrue(all(not (a <= TRACES_I < b) for a, b in added))

    def test_each_new_group_ships_collapsed(self):
        n_add = sum(1 for r in self.reqs() if "addDimensionGroup" in r)
        collapsed = [r["updateDimensionGroup"]["dimensionGroup"]["collapsed"]
                     for r in self.reqs() if "updateDimensionGroup" in r]
        self.assertEqual(collapsed, [True] * n_add)

    def test_the_traces_header_loses_the_pending_grey_and_the_note(self):
        cells = [r["repeatCell"] for r in self.reqs() if "repeatCell" in r]
        self.assertEqual(len(cells), 1)
        c = cells[0]
        self.assertEqual(c["cell"]["note"], "")
        self.assertTrue(c["cell"]["userEnteredFormat"]["textFormat"]["bold"])
        self.assertFalse(c["cell"]["userEnteredFormat"]["textFormat"]["italic"])
        self.assertEqual(c["range"]["startRowIndex"], tr.HEAD_ROW - 1)
        self.assertEqual(c["range"]["startColumnIndex"], TRACES_I)


class TheTraceColumnWidth(unittest.TestCase):
    def test_the_traces_column_is_sized(self):
        sized = dict(
            (r["updateDimensionProperties"]["range"]["startIndex"],
             r["updateDimensionProperties"]["properties"]["pixelSize"])
            for r in tr.regroup("Science", GID, [], 31)
            if "pixelSize" in r.get("updateDimensionProperties", {})
                              .get("properties", {}))
        self.assertEqual(sized, {TRACES_I: tr.WIDTH})


class TheClipAndTheRowHeights(unittest.TestCase):
    """A wrapped traces cell is fifteen lines tall and hides the rest."""

    def reqs(self):
        return tr.retighten(GID, TRACES_I, 200)

    def test_only_the_traces_column_is_clipped(self):
        r = self.reqs()[0]["repeatCell"]
        self.assertEqual(r["cell"]["userEnteredFormat"]["wrapStrategy"], "CLIP")
        self.assertEqual((r["range"]["startColumnIndex"],
                          r["range"]["endColumnIndex"]), (TRACES_I, TRACES_I + 1))

    def test_it_starts_below_the_header_so_the_label_keeps_its_format(self):
        self.assertEqual(self.reqs()[0]["repeatCell"]["range"]["startRowIndex"],
                         tr.HEAD_ROW)

    def test_the_rows_are_resized_after_the_clip_not_before(self):
        kinds = [list(q)[0] for q in self.reqs()]
        self.assertEqual(kinds, ["repeatCell", "autoResizeDimensions"])
        d = self.reqs()[1]["autoResizeDimensions"]["dimensions"]
        self.assertEqual((d["dimension"], d["startIndex"], d["endIndex"]),
                         ("ROWS", tr.HEAD_ROW, 200))


if __name__ == "__main__":
    unittest.main()
