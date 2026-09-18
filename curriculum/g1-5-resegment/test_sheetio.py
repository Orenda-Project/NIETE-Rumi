"""The §5 house-formatting contract, pinned against what format_grid emits.

`format_grid` is the one place every non-calendar tab gets its title band,
header row and base text format, so a number drifting here drifts on fifteen
tabs at once and nothing fails. It had drifted: the title band shipped at
13pt against the spec's 16, the headers were never centred, and the subtitle
row carried a cream label-cell background at 10pt where the spec asks for
gray 11pt prose. None of the three carried a comment claiming it was
deliberate — unlike the WRAP strategy, which is documented as fixing a
clipping bug and stays.

The two deliberate deviations are asserted as deviations, so a later reader
cannot mistake them for the same kind of drift:
  - data text stays at 10pt, not the spec's 9pt (§5.2) — a reviewer reads
    this workbook on a laptop and asked for a bigger, not a denser, grid;
  - the header row stays 46px, not the spec's 36px (§5.1), because headers
    here WRAP and a two-line header clips at 36.
"""
import unittest

import house
import sheetio


class Recorder:
    """The narrowest thing that looks like the Sheets client to format_grid."""

    def __init__(self):
        self.requests = []

    def spreadsheets(self):
        return self

    def batchUpdate(self, spreadsheetId=None, body=None):
        self.requests.extend(body["requests"])
        return self

    def execute(self):
        return {}


def grid(**kw):
    rec = Recorder()
    kw.setdefault("nrows", 12)
    kw.setdefault("ncols", 5)
    kw.setdefault("head_row", 2)
    sheetio.format_grid(rec, 777, **kw)
    return rec.requests


def fmt_for(reqs, r0, r1):
    """The repeatCell format applied to exactly the row range r0..r1."""
    for q in reqs:
        cell = q.get("repeatCell")
        if not cell:
            continue
        rng = cell["range"]
        if rng["startRowIndex"] == r0 and rng["endRowIndex"] == r1:
            return cell["cell"]["userEnteredFormat"]
    raise AssertionError(f"no format request spanning rows {r0}:{r1}")


def height_of(reqs, r0):
    for q in reqs:
        dim = q.get("updateDimensionProperties")
        if not dim:
            continue
        rng = dim["range"]
        if rng["dimension"] == "ROWS" and rng["startIndex"] == r0:
            return dim["properties"]["pixelSize"]
    raise AssertionError(f"no row height set at row {r0}")


class TitleBand(unittest.TestCase):
    """§5.1 — row 1 is the merged title band, Arial 16 bold, ~42px."""

    def setUp(self):
        self.reqs = grid()

    def test_the_title_is_16pt_not_the_13_it_had_drifted_to(self):
        self.assertEqual(fmt_for(self.reqs, 0, 1)["textFormat"]["fontSize"], 16)

    def test_the_title_row_is_tall_enough_for_16pt(self):
        # 34px was sized for 13pt text; 16pt needs the spec's ~42.
        self.assertGreaterEqual(height_of(self.reqs, 0), 42)

    def test_the_title_keeps_its_deep_teal_and_white_bold(self):
        f = fmt_for(self.reqs, 0, 1)
        self.assertEqual(f["backgroundColor"], sheetio.INK["title"])
        self.assertEqual(f["textFormat"]["foregroundColor"],
                         sheetio.INK["white"])
        self.assertTrue(f["textFormat"]["bold"])


class SubtitleRow(unittest.TestCase):
    """§5.1 — row 2 is gray #4B5563 prose at 11pt, not a cream label cell."""

    def setUp(self):
        self.reqs = grid()

    def test_the_subtitle_is_11pt(self):
        self.assertEqual(fmt_for(self.reqs, 1, 2)["textFormat"]["fontSize"], 11)

    def test_the_subtitle_text_is_the_spec_gray(self):
        self.assertEqual(fmt_for(self.reqs, 1, 2)["textFormat"]
                         ["foregroundColor"], sheetio.INK["sub"])

    def test_the_subtitle_does_not_wear_the_cream_label_cell_colour(self):
        # §5.4 reserves cream for a label cell in column B. On the subtitle it
        # read as a band the tab does not have.
        self.assertNotEqual(fmt_for(self.reqs, 1, 2).get("backgroundColor"),
                            sheetio.INK["cream"])

    def test_the_spec_gray_is_4b5563(self):
        self.assertEqual(
            {k: round(v * 255) for k, v in sheetio.INK["sub"].items()},
            {"red": 0x4B, "green": 0x55, "blue": 0x63})


class TheSubtitleIsGivenRoomToBeRead(unittest.TestCase):
    """§5.1's sentence, §5.9's rule about where it may be merged to.

    OVERFLOW_CELL is not a wrap strategy — it is a promise that nothing sits
    to the right. On a grid with a fixed column count that promise expires at
    the last column, and the sentence is cut there without an error. So the
    row wraps, is merged across the room it has, and is heighted from its own
    text; and the merge stays on one side of the frozen boundary, because a
    merge that crosses it makes the freeze request fail (§6 gotcha 2).
    """

    @staticmethod
    def merges(reqs, row):
        return [q["mergeCells"]["range"] for q in reqs
                if q.get("mergeCells")
                and q["mergeCells"]["range"]["startRowIndex"] == row]

    def test_the_subtitle_wraps_rather_than_running_off_the_grid(self):
        self.assertEqual(fmt_for(grid(), 1, 2)["wrapStrategy"], "WRAP")

    def test_the_title_band_still_overflows_because_nothing_is_beside_it(self):
        self.assertEqual(fmt_for(grid(), 0, 1)["wrapStrategy"], "OVERFLOW_CELL")

    def test_a_long_subtitle_is_given_more_than_the_house_height(self):
        rows = [["TITLE"], ["", "", "y" * 600]]
        tall = grid(rows=rows, ncols=5, freeze_cols=2,
                    widths={0: 90, 1: 90, 2: 300, 3: 300, 4: 300})
        self.assertGreater(height_of(tall, 1), house.SUB_PX)

    def test_a_tab_without_rows_keeps_the_house_height(self):
        # The fallback: a caller that has not passed its rows yet is not
        # given a tall blank band where a sentence is missing.
        self.assertEqual(height_of(grid(), 1), house.SUB_PX)

    def test_the_subtitle_is_merged_from_the_freeze_to_the_edge(self):
        rows = [["TITLE"], ["", "", "y" * 600]]
        got = self.merges(grid(rows=rows, ncols=5, freeze_cols=2), 1)
        self.assertEqual([(r["startColumnIndex"], r["endColumnIndex"])
                          for r in got], [(2, 5)])

    def test_the_merge_never_crosses_the_frozen_boundary(self):
        # If a caller's titled(at=) and format_grid(freeze_cols=) disagree the
        # sentence lands INSIDE the frozen region. Merging it to the edge from
        # there would silently kill the freeze, so it stops at the boundary.
        rows = [["TITLE"], ["y" * 600]]
        got = self.merges(grid(rows=rows, ncols=5, freeze_cols=2), 1)
        for r in got:
            self.assertLessEqual(r["endColumnIndex"], 2)

    def test_an_empty_subtitle_is_not_merged_at_all(self):
        self.assertEqual(self.merges(grid(rows=[["TITLE"], ["", ""]]), 1), [])

    def test_the_merge_is_unmerged_first_so_a_rebuild_is_idempotent(self):
        rows = [["TITLE"], ["", "", "y" * 600]]
        reqs = grid(rows=rows, ncols=5, freeze_cols=2)
        kinds = [k for q in reqs for k in q
                 if k in ("mergeCells", "unmergeCells")
                 and q[k]["range"].get("startRowIndex") == 1]
        self.assertEqual(kinds, ["unmergeCells", "mergeCells"])


class HeaderRow(unittest.TestCase):
    """§5.1 — row 3 is #264653, white, Arial 10 bold, CENTERED."""

    def setUp(self):
        self.reqs = grid()

    def test_the_headers_are_centred(self):
        self.assertEqual(fmt_for(self.reqs, 2, 3)["horizontalAlignment"],
                         "CENTER")

    def test_the_headers_keep_slate_white_bold_10(self):
        f = fmt_for(self.reqs, 2, 3)
        self.assertEqual(f["backgroundColor"], sheetio.INK["head"])
        self.assertEqual(f["textFormat"]["fontSize"], 10)
        self.assertTrue(f["textFormat"]["bold"])

    def test_all_three_top_rows_are_frozen(self):
        props = next(q["updateSheetProperties"] for q in self.reqs
                     if "updateSheetProperties" in q)
        self.assertEqual(props["properties"]["gridProperties"]
                         ["frozenRowCount"], 3)


class BaseTextFormat(unittest.TestCase):
    """§5.2 — data is #1F2937, wrapped, top-aligned. Size is a deviation."""

    def setUp(self):
        self.reqs = grid(nrows=12)

    def test_data_text_is_the_spec_ink(self):
        self.assertEqual(fmt_for(self.reqs, 0, 12)["textFormat"]
                         ["foregroundColor"], sheetio.INK["data"])

    def test_the_spec_ink_is_1f2937(self):
        self.assertEqual(
            {k: round(v * 255) for k, v in sheetio.INK["data"].items()},
            {"red": 0x1F, "green": 0x29, "blue": 0x37})

    def test_data_stays_wrapped_and_top_aligned(self):
        f = fmt_for(self.reqs, 0, 12)
        self.assertEqual(f["wrapStrategy"], "WRAP")
        self.assertEqual(f["verticalAlignment"], "TOP")

    def test_data_is_the_spec_nine(self):
        # This test used to assert 10 and carry the reason for it, so that any
        # pass conforming the size had to read the reason first. It worked:
        # Amena read it and chose 9 on 2026-09-18. Kept as a conformance check
        # rather than deleted — the grid font is what makes every data row on
        # every tab the same size, and nothing else asserts it.
        self.assertEqual(fmt_for(self.reqs, 0, 12)["textFormat"]["fontSize"],
                         house.DATA_PT)
        self.assertEqual(house.DATA_PT, 9)


class HeaderHeightDeviation(unittest.TestCase):
    """§5.1 asks 36px. Headers here WRAP, and 36 clips a two-line header."""

    def test_the_header_row_is_46_not_36(self):
        self.assertEqual(height_of(grid(), 2), 46)


class UntitledTabs(unittest.TestCase):
    """A tab with no title band must not get one painted anyway."""

    def test_no_title_or_subtitle_format_when_head_row_is_zero(self):
        reqs = grid(head_row=0)
        with self.assertRaises(AssertionError):
            fmt_for(reqs, 1, 2)

    def test_the_header_is_still_centred_without_a_title_band(self):
        self.assertEqual(fmt_for(grid(head_row=0), 0, 1)
                         ["horizontalAlignment"], "CENTER")


if __name__ == "__main__":
    unittest.main()
