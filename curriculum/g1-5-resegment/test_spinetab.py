# -*- coding: utf-8 -*-
"""The move-spine lookup tab: twenty-two spines, written once each.

bd-960al. The Moves column held 276,996 characters across the four subject
tabs and carried 3,410 characters of information -- twenty distinct spines
copied down 1,658 day rows, 83 times each on average. The redundancy is not
incidental to the design, it IS the design: a spine's information is the
shape of the skill type, not the day (see stagec_spines). So the JSON moves
here, one row per spine, and the day row keeps a label that links to it.
"""
import json
import unittest

import spinetab
import stagec
import stagec_spines as sp


class TheRows(unittest.TestCase):

    def setUp(self):
        self.rows = spinetab.spine_rows()
        self.head = self.rows[0]
        self.body = self.rows[1:]

    def test_every_spine_stagec_can_build_has_exactly_one_row(self):
        self.assertEqual(len(self.body), len(sp.SPINES))

    def test_a_row_is_found_by_its_label_and_nothing_else_shares_it(self):
        labels = [r[self.head.index("Spine")] for r in self.body]
        self.assertEqual(len(set(labels)), len(labels))

    def test_the_spine_json_is_the_one_the_day_rows_carried(self):
        i = self.head.index("Moves (JSON)")
        got = set(r[i] for r in self.body)
        self.assertEqual(got,
                         set(stagec.format_moves(v) for v in sp.SPINES.values()))

    def test_every_spine_still_fills_the_period(self):
        i = self.head.index("Minutes")
        self.assertEqual(set(r[i] for r in self.body), {stagec.PERIOD_MIN})

    def test_the_move_count_is_inside_the_spec_band(self):
        i = self.head.index("Moves")
        for r in self.body:
            self.assertTrue(stagec.MOVES_MIN <= r[i] <= stagec.MOVES_MAX, r)

    def test_the_g1_2_band_gets_more_and_shorter_moves(self):
        """Amena's slow ramp, asserted here as well as in stagec_spines."""
        n = dict((r[self.head.index("Spine")], r[self.head.index("Moves")])
                 for r in self.body)
        for shape in sp.SHAPES:
            self.assertGreaterEqual(n[spinetab.label(shape, "G1-2")],
                                    n[spinetab.label(shape, "G3-5")], shape)


class TheLabel(unittest.TestCase):

    def test_it_names_the_shape_and_the_band(self):
        self.assertEqual(spinetab.label("language_focus", "G1-2"),
                         u"language_focus · G1-2")

    def test_it_is_a_fraction_of_the_spine_it_replaces(self):
        spine = stagec.format_moves(sp.SPINES[("language_focus", "G1-2")])
        self.assertLess(len(spinetab.label("language_focus", "G1-2")),
                        len(spine) / 5)


class TheReverseLookup(unittest.TestCase):
    """A day row is matched to its spine by its JSON, never re-derived.

    Re-deriving from skill type and grade would hand a plausible label to a
    row whose Moves cell says something else, which is the one thing a
    lookup must not do: the label has to describe the cell it replaces.
    """

    def test_a_known_spine_resolves_to_its_label_and_row(self):
        by_json = spinetab.index()
        spine = stagec.format_moves(sp.SPINES[("decoding", "G3-5")])
        label, row = by_json[spine]
        self.assertEqual(label, u"decoding · G3-5")
        rows = spinetab.spine_rows()
        self.assertEqual(rows[row][0], label)

    def test_a_cell_that_is_not_a_spine_is_absent_rather_than_guessed(self):
        self.assertNotIn('[["warm_up",40]]', spinetab.index())

    def test_whitespace_in_the_cell_does_not_lose_the_match(self):
        by_json = spinetab.index()
        pairs = sp.SPINES[("decoding", "G3-5")]
        loose = json.dumps([[p, m] for p, m in pairs])      # default spacing
        self.assertIn(spinetab.canonical(loose), by_json)


if __name__ == "__main__":
    unittest.main()
