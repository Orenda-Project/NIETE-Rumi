"""caltab — the KEY has to describe the grid that was actually painted.

Amena's brief on this tab was "keys should be clearly depicted, otherwise
reading the calendar is quite difficult". Three things were stopping that, and
all three are the same fault: the legend described a calendar nobody built.

  1. Every skill code was given a coloured chip, so the KEY read as a colour
     code. The grid has no skill colours at all — it is banded by CHAPTER, on
     purpose, because a grey block per basics period read as the class putting
     the book down. A teacher matching the KEY's green to a green cell would
     have looked for something that is not there.
  2. The MARKS section named eight colours, lines and blanks in words and
     showed none of them. "Alternating bands" is not a thing you can describe.
  3. Science's chapter-close day and its assessment day were given the same
     two-letter code, and the KEY dedupes by code, so one of the two vanished
     from the legend while its chips went on appearing in the grid.

So these tests assert what the legend PROMISES, against what the painter can
deliver. The wording will move; the promise must not outrun the paint.
"""
import unittest
from unittest import mock

import caltab
import calfmt
import skills


N_COLS = 40          # a grid wide enough that the key rows have room


def _rows_and_key():
    return caltab.key_block(N_COLS)


def _text(rows):
    return " ".join(str(c) for row in rows for c in row)


class TheKeyDoesNotPromiseColoursTheGridNeverPaints(unittest.TestCase):

    def test_the_key_never_asks_for_a_skill_colour_at_all(self):
        # calfmt._grid paints BAND[chapter % 2] and KIND_BG only. It never
        # calls skills.colour(), so a coloured chip beside a code in the KEY
        # is a colour code with nothing on the other end of it. Asserting on
        # the returned chips would only prove the colours were dropped on the
        # way out; the legend must not go looking for them in the first place.
        with mock.patch.object(skills, "colour",
                               side_effect=AssertionError(
                                   "the KEY asked for a skill colour")):
            caltab.key_block(N_COLS)

    def test_every_code_still_gets_a_chip_cell_to_be_styled(self):
        # Neutral is not absent: the code cell is still centred and bold, so
        # the first column reads as a column of codes.
        rows, chips, _s, _o, _sw = _rows_and_key()
        coded = [i for i, row in enumerate(rows)
                 if row[0] and row[2] in caltab.SUBJECTS]
        self.assertTrue(coded)
        self.assertTrue(set(coded) <= set(chips))

    def test_the_key_says_what_the_grid_is_actually_coloured_by(self):
        # Dropping the chips is only half the fix: the reader still has to be
        # told where colour-by-skill does live.
        rows, *_rest = _rows_and_key()
        text = _text(rows).lower()
        self.assertIn("not colour-coded", text)
        self.assertIn("skills map", text)


class EveryMarkIsShownAsWellAsNamed(unittest.TestCase):

    def test_each_mark_that_is_a_colour_or_a_line_gets_a_swatch(self):
        rows, _t, _s, _o, swatch = _rows_and_key()
        marked = {row for row, _c0, _c1, _name in swatch}
        # Every MARKS line is a colour, a line or a blank except the first,
        # which is two codes in a cell and shows itself in its own mark cell.
        self.assertGreaterEqual(len(marked), len(caltab.MARKS) - 1)

    def test_the_painter_knows_every_swatch_the_key_asks_for(self):
        _r, _t, _s, _o, swatch = _rows_and_key()
        for _row, _c0, _c1, name in swatch:
            self.assertTrue(calfmt.knows_swatch(name),
                            f"calfmt cannot paint swatch {name!r}")

    def test_a_swatch_never_lands_on_the_overflowing_explanation(self):
        # The explanation starts at column WIDE and runs right across the
        # empty grid. A background painted into it would fence the overflow.
        _r, _t, _s, _o, swatch = _rows_and_key()
        for _row, _c0, c1, _name in swatch:
            self.assertLessEqual(c1, caltab.WIDE)


class ScienceKeepsBothOfItsChapterCloseDays(unittest.TestCase):
    """Science teaches a review-and-check day AND a separate assessment day.
    They had the same code, and key_block dedupes by (code, subject)."""

    def test_the_two_science_close_days_have_different_codes(self):
        self.assertNotEqual(skills.code("review_assess", "Science"),
                            skills.code("assessment", "Science"))

    def test_no_two_skills_in_one_subject_share_a_code(self):
        for subject in caltab.SUBJECTS:
            codes = [skills.code(k, subject) for k in skills.ORDER[subject]]
            self.assertEqual(len(codes), len(set(codes)),
                             f"{subject} has a duplicate code: {codes}")

    def test_every_science_skill_reaches_the_legend(self):
        # On LABELS, not codes. The dedup keeps the FIRST of a colliding pair,
        # so its code is present either way and a code-based assertion passes
        # while the second day's line is missing — which is exactly how this
        # went unnoticed. The label is the thing the reader loses.
        rows, *_rest = _rows_and_key()
        listed = {row[1] for row in rows if row[2] == "Science"}
        for key in skills.ORDER["Science"]:
            self.assertIn(skills.label(key, "Science"), listed,
                          f"{key} never appears in the KEY")




class NoTwoMarksLookTheSameInTheLegend(unittest.TestCase):
    """The MARKS section stacks every swatch in one column, one per row. Two
    marks that differ by a few percent of blue are, at that size and on that
    background, one mark printed twice — and the reader concludes the legend
    is redundant rather than that they cannot see the difference.

    OMIT and ASSESS were (0.97, 0.85, 0.85) and (0.98, 0.88, 0.92): both pale
    pink, adjacent in the list. AFTER and BAND[1] were closer still. Naming a
    mark is not showing it, and showing two marks in the same colour is not
    showing them either.

    So this asserts the property rather than the pair: no two backgrounds the
    KEY puts side by side may be perceptually closer than JND. The colours
    will move; the promise must not.
    """

    # Thiadmer Riemersma's "redmean" approximation — cheap, no dependency, and
    # much closer to perceived difference than plain RGB distance, which
    # badly overrates blue. ~30 is about where two flat colour chips stop
    # being tellable apart; 35 leaves a little headroom for the PDF export,
    # which is not colour-managed.
    JND = 35

    @staticmethod
    def _distance(a, b):
        ra, ga, ba = (a[k] * 255 for k in ("red", "green", "blue"))
        rb, gb, bb = (b[k] * 255 for k in ("red", "green", "blue"))
        rmean = (ra + rb) / 2
        dr, dg, db = ra - rb, ga - gb, ba - bb
        return ((2 + rmean / 256) * dr * dr + 4 * dg * dg
                + (2 + (255 - rmean) / 256) * db * db) ** 0.5

    def _pairs(self, palette):
        names = sorted(palette)
        for i, one in enumerate(names):
            for other in names[i + 1:]:
                yield one, other, self._distance(palette[one], palette[other])

    def test_no_two_swatch_backgrounds_are_the_same_colour(self):
        for one, other, d in self._pairs(calfmt.SWATCH_BG):
            self.assertGreaterEqual(
                d, self.JND,
                f"{one} and {other} are the same mark to the eye ({d:.0f})")

    def test_no_two_rule_colours_are_the_same_colour(self):
        for one, other, d in self._pairs(calfmt.SWATCH_RULE):
            self.assertGreaterEqual(
                d, self.JND,
                f"{one} and {other} are the same rule to the eye ({d:.0f})")

    def test_the_assessment_border_is_dark_enough_to_read_as_a_line(self):
        # ASSESS is not only a swatch: it is the MEDIUM border drawn around
        # every assessment-week column in the grid. A 0.98/0.88/0.92 line on a
        # white sheet is a line nobody sees, which is how it stayed the same
        # pink as OMIT for so long. A border has to be darker than what it is
        # drawn on.
        lum = sum(calfmt.ASSESS[k] * w for k, w in
                  (("red", 0.2126), ("green", 0.7152), ("blue", 0.0722)))
        self.assertLess(lum, 0.6, "the assessment border is invisible")


class EveryColourTheGridPaintsIsNamedInTheLegend(unittest.TestCase):
    """The KEY is read as a complete list. A colour the grid paints and the
    legend never mentions does not read as "undocumented" — it reads as
    meaning something the reader has failed to look up.

    `calfmt.KIND_BG` is that list: the two backgrounds a day cell can take
    from its KIND rather than from its chapter band. `omitted` has had a line
    since the tab was built. `after` — every column right of 24 December,
    which is a quarter of the grid — had none. The thick red line's line says
    what the DATE means; nothing said the shading was a mark at all.
    """

    def test_every_kind_background_has_a_line_in_the_marks_list(self):
        named = {swatch for _code, _name, _text, swatch in caltab.MARKS}
        for kind, colour in calfmt.KIND_BG.items():
            hit = [n for n in named
                   if n and calfmt.SWATCH_BG.get(n) == colour]
            self.assertTrue(hit, f"the grid paints {kind!r} and the KEY "
                                 "never shows that colour")

    def test_a_mark_is_not_named_after_a_colour_it_is_not(self):
        # "red band" was a pale pink and "pink column" is now a saturated
        # violet — the palette moved to make the two tellable apart and the
        # words stayed put. A reader scanning the grid for a red band finds
        # the thick red rule instead and stops there.
        wrong = {"red": ("omit",), "pink": ("assess",)}
        for _code, name, _text, swatch in caltab.MARKS:
            for word, swatches in wrong.items():
                if swatch in swatches:
                    self.assertNotIn(word, name.lower(),
                                     f"{name!r} calls {swatch} {word}")


if __name__ == "__main__":
    unittest.main()
