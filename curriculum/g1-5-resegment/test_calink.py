"""The day codes on the Teaching Calendar, coloured by the skill they name.

The grid's BACKGROUND is spoken for — it bands by chapter, tints the periods
FDE omits, golds Grade 1's Foundations block and greys everything past
24 December, so the skill colour goes on the glyph. That is why the palette
has to be darkened first: skills.py holds a background palette, and #FCE7C8
as text on a pale band is a smudge.

These tests fix the two things a reader can be wrong about — that a code
carries its own skill's colour and no other, and that a cell the painter
cannot name is left alone rather than guessed at.
"""
import colorsys
import itertools
import unittest

import calfmt
import calink
import skills


def _lum(c):    # relative luminance, WCAG 2.x
    def chan(v):
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return (0.2126 * chan(c["red"]) + 0.7152 * chan(c["green"])
            + 0.0722 * chan(c["blue"]))


def _triple(c):
    return (c["red"], c["green"], c["blue"])


def _dist(a, b):
    return sum((a[ch] - b[ch]) ** 2 for ch in a) ** 0.5


def contrast(fg, bg):
    hi, lo = max(_lum(fg), _lum(bg)), min(_lum(fg), _lum(bg))
    return (hi + 0.05) / (lo + 0.05)


BACKGROUNDS = {"chapter band A": calfmt.BAND[0], "chapter band B": calfmt.BAND[1],
               "Foundations gold": calfmt.FOUNDATION,
               "the run past 24 Dec": calfmt.AFTER,
               "an FDE-omitted chapter": calfmt.OMIT,
               "bare sheet": {"red": 1.0, "green": 1.0, "blue": 1.0}}


class EveryCodeCarriesItsOwnSkillsColour(unittest.TestCase):

    def test_a_code_takes_the_colour_its_skill_has_on_every_other_tab(self):
        for key, code in skills.CODE.items():
            chip = skills.colour(key)
            if not chip:
                continue
            self.assertEqual(calink.cell_ink(code), calink.dark(chip),
                             f"{code} ({key}) is not its skill's colour")

    def test_the_colour_is_darkened_so_it_reads_as_text(self):
        """The pale chip hexes are backgrounds. Unchanged, they vanish."""
        for code in ("C", "P", "PA", "WP", "RV"):
            ink = calink.cell_ink(code)
            self.assertLess(sum(ink.values()) / 3, 0.62, f"{code} is too pale")

    def test_the_five_cpa_stages_are_five_different_colours(self):
        inks = {tuple(sorted(calink.cell_ink(c).items()))
                for c in ("C", "P", "PA", "A", "WP")}
        self.assertEqual(len(inks), 5, "two CPA stages share a colour")

    def test_revision_and_assessment_do_not_read_as_teaching(self):
        for code in ("RV", "AX"):
            self.assertNotEqual(calink.cell_ink(code), calink.cell_ink("C"))


class ItReadsOnEveryBandItCanLandOn(unittest.TestCase):
    """A code is 9px type, so 4.5:1 is the floor, not 3:1.

    The darkening constant is the only thing standing between a background
    palette and unreadable text, and it cannot be chosen by eye: a colour
    that reads on the pale chapter band can disappear on the warm grey of
    the January run. Every ink is checked against every background the grid
    actually paints, so raising K to make the colours prettier fails here
    rather than in a teacher's hands.
    """

    def test_the_ceiling_is_the_one_the_darkest_band_forces(self):
        """The constant is derived, not chosen, so it must stay derived.

        The worst case is the darkest background — the warm grey of the
        January run — because every other band is lighter and so gives more
        contrast, not less.
        """
        darkest = min(BACKGROUNDS.values(), key=_lum)
        self.assertEqual(darkest, calfmt.AFTER)
        self.assertAlmostEqual(skills.INK_LUMINANCE,
                               (_lum(darkest) + 0.05) / 4.5 - 0.05, places=3)

    def test_the_hue_of_the_chip_survives(self):
        """Scaling toward black was tried first and lost the hue: a pastel
        pink at 40% strength is a grey, so revision and assessment came out
        the same colour. The hue is the whole signal; only the lightness may
        move."""
        for chip in {skills.colour(k) for k in skills.CODE if skills.colour(k)}:
            want = colorsys.rgb_to_hls(*_triple(skills.rgb(chip)))[0]
            got = colorsys.rgb_to_hls(*_triple(skills.ink(chip)))[0]
            self.assertAlmostEqual(got, want, places=2, msg=f"{chip} shifted")

    def test_the_eight_families_stay_tellable_apart(self):
        """Six of the eight, at least. PEACH/TAN/AMBER — entry, oral work and
        assessment — are three near-identical warm tones in the palette
        itself, and no darkening can separate what arrives the same; that is
        a palette question, not an ink one.
        """
        inks = [skills.ink(c) for c in
                sorted({skills.colour(k) for k in skills.CODE
                        if skills.colour(k)})]
        far = [(a, b) for a, b in itertools.combinations(inks, 2)
               if _dist(a, b) >= 0.15]
        self.assertGreaterEqual(len(far), 22)

    def test_every_code_clears_4_5_to_1_on_every_background(self):
        for key, code in skills.CODE.items():
            ink = calink.cell_ink(code)
            if ink is None:
                continue
            for name, bg in BACKGROUNDS.items():
                self.assertGreaterEqual(
                    contrast(ink, bg), 4.5,
                    f"{code} ({key}) on {name}: "
                    f"{contrast(ink, bg):.2f}:1")


class WhatThePainterWillNotGuess(unittest.TestCase):

    def test_a_code_it_does_not_know_is_left_black(self):
        self.assertIsNone(calink.cell_ink("ZZ"))

    def test_an_empty_cell_is_left_alone(self):
        for blank in ("", "   ", None):
            self.assertIsNone(calink.cell_ink(blank))

    def test_a_shared_period_takes_the_colour_of_its_first_code(self):
        """196 of 3,230 cells carry two codes. The first is the day's lead
        skill; the KEY says so, so a slash is not read as a third colour."""
        self.assertEqual(calink.cell_ink("NF/PA"), calink.cell_ink("NF"))
        self.assertEqual(calink.cell_ink("WP/AX"), calink.cell_ink("WP"))

    def test_spacing_round_a_code_does_not_lose_its_colour(self):
        self.assertEqual(calink.cell_ink(" PA "), calink.cell_ink("PA"))


def rng(sid, r0, r1, c0, c1):
    return {"sheetId": sid, "startRowIndex": r0, "endRowIndex": r1,
            "startColumnIndex": c0, "endColumnIndex": c1}


def plan(**kw):
    base = {"lead": 5, "n_cols": 9, "body_top": 3, "body_rows": 2}
    base.update(kw)
    return base


def rows(*bodies):
    """Three header rows, then one grade-and-subject row per body given. Each
    body is that row's day cells, so a row is passed as a sequence, never as
    a bare string — list("PA") is two cells, not one."""
    head = [[""] * 9 for _ in range(3)]
    return head + [["G1", "Maths", 6, 128, 35] + list(b) for b in bodies]


def inks(reqs):
    """The foreground colour of every cell the requests touch, row by row."""
    return [[(v.get("userEnteredFormat", {}).get("textFormat", {})
              .get("foregroundColor")) for v in r["updateCells"]["rows"][0]["values"]]
            for r in reqs]


CODES = ("C", "P", "PA", "WP")


class WhatGoesOverTheWire(unittest.TestCase):

    def test_one_request_per_row_not_one_per_cell(self):
        """3,230 coloured cells is 3,230 repeatCells and a batch that times
        out. One updateCells per row is 60 requests for the whole grid."""
        reqs = calink.ink_requests(rng, 7, rows(CODES, CODES), plan())
        self.assertEqual(len(reqs), 2)
        self.assertEqual([r["updateCells"]["range"]["startRowIndex"]
                          for r in reqs], [3, 4])

    def test_it_colours_only_the_day_columns(self):
        reqs = calink.ink_requests(rng, 7, rows(CODES, CODES), plan())
        for r in reqs:
            self.assertEqual(r["updateCells"]["range"]["startColumnIndex"], 5)
            self.assertEqual(r["updateCells"]["range"]["endColumnIndex"], 9)
            self.assertEqual(len(r["updateCells"]["rows"][0]["values"]), 4)

    def test_it_writes_the_colour_of_each_code(self):
        reqs = calink.ink_requests(rng, 7, rows(CODES, CODES), plan())
        self.assertEqual(inks(reqs)[0],
                         [calink.cell_ink(c) for c in CODES])

    def test_it_touches_nothing_but_the_text_colour(self):
        """The background is the chapter band and the italic is the basics
        mark. Both are painted by calfmt, and a wider field mask here would
        erase them."""
        reqs = calink.ink_requests(rng, 7, rows(CODES, CODES), plan())
        for r in reqs:
            self.assertEqual(r["updateCells"]["fields"],
                             "userEnteredFormat.textFormat.foregroundColor")

    def test_a_cell_with_no_colour_is_sent_empty_rather_than_black(self):
        reqs = calink.ink_requests(rng, 7, rows(["C", "ZZ", "", "WP"]), plan(body_rows=1))
        self.assertEqual(inks(reqs)[0][1:3], [None, None])

    def test_a_row_with_no_codes_at_all_sends_no_request(self):
        reqs = calink.ink_requests(rng, 7, rows(["", "", "", ""]), plan(body_rows=1))
        self.assertEqual(reqs, [])

    def test_a_short_row_does_not_lose_the_columns_it_does_have(self):
        """Trailing empties come back from Sheets as a shorter list."""
        reqs = calink.ink_requests(rng, 7, rows(["C", "P"]), plan(body_rows=1))
        self.assertEqual(len(reqs[0]["updateCells"]["rows"][0]["values"]), 4)
        self.assertEqual(inks(reqs)[0][2:], [None, None])


def paint(rng, sid, r0, r1, c0, c1, fmt):
    """calfmt._paint, passed in so the ink module never imports the painter."""
    return {"repeatCell": {"range": rng(sid, r0, r1, c0, c1),
                           "cell": {"userEnteredFormat": fmt},
                           "fields": "userEnteredFormat(" +
                                     ",".join(sorted(fmt)) + ")"}}


CREAM = {"red": 0.98, "green": 0.96, "blue": 0.93}
PEACH = "#FCE7C8"


def chip(colour=PEACH):
    return calink.chip_requests(paint, rng, 7, [(9, colour)], CREAM)


def fmt_of(reqs):
    return reqs[0]["repeatCell"]["cell"]["userEnteredFormat"]


class TheKeyChipsSayTheSameThingAsTheGrid(unittest.TestCase):
    """A neutral chip beside a coloured code is the old defect reversed.

    The legend has to look like the thing it explains, so the chip carries the
    skill's colour at full strength — it is a background, which is what the
    palette was mixed for — and the glyph in the grid carries that same colour
    darkened. Both come out of this module so neither can be changed alone.
    """

    def test_a_chip_is_painted_in_its_skills_own_colour(self):
        self.assertEqual(fmt_of(chip())["backgroundColor"], skills.rgb(PEACH))

    def test_the_chip_and_the_grid_ink_are_one_decision(self):
        bg = fmt_of(chip())["backgroundColor"]
        self.assertEqual(bg, skills.rgb(PEACH))
        self.assertEqual(calink.dark(PEACH), skills.ink(PEACH))

    def test_a_chip_whose_skill_has_no_colour_keeps_the_neutral_cream(self):
        self.assertEqual(fmt_of(chip(None))["backgroundColor"], CREAM)

    def test_the_chip_shows_the_glyph_colour_too_not_only_the_background(self):
        # "Keys should be clearly depicted" — a chip that shows the pale
        # background but writes its code in black is showing half of what the
        # grid does. The code inside the chip is the same ink as the grid's.
        self.assertEqual(fmt_of(chip())["textFormat"]["foregroundColor"],
                         calink.dark(PEACH))

    def test_the_glyph_still_reads_on_its_own_chip(self):
        fmt = fmt_of(chip())
        self.assertGreaterEqual(
            contrast(fmt["textFormat"]["foregroundColor"],
                     fmt["backgroundColor"]), 4.5)

    def test_a_chip_with_no_colour_leaves_its_code_black(self):
        self.assertNotIn("foregroundColor", fmt_of(chip(None))["textFormat"])

    def test_the_chip_keeps_the_shape_it_had_when_it_was_neutral(self):
        # Centred and bold is what makes the first column read as a column of
        # codes; the colour was added to that, not put in place of it.
        self.assertEqual(fmt_of(chip())["horizontalAlignment"], "CENTER")
        self.assertEqual(fmt_of(chip())["textFormat"]["bold"], True)
        self.assertEqual(fmt_of(chip())["textFormat"]["fontSize"], 10)

    def test_it_paints_the_code_cell_only(self):
        self.assertEqual(chip()[0]["repeatCell"]["range"], rng(7, 9, 10, 0, 1))

    def test_one_request_per_chip(self):
        chips = [(9, PEACH), (10, "#C8E6F4"), (11, None)]
        self.assertEqual(
            len(calink.chip_requests(paint, rng, 7, chips, CREAM)), 3)


if __name__ == "__main__":
    unittest.main()
