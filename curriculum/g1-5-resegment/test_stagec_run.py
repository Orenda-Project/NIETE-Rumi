# -*- coding: utf-8 -*-
"""Everything that must be true before a single cell reaches the sheet.

A tab is written whole. Once a range is sent there is no undo that does not
itself involve guessing what was there, so every reason to refuse has to be
gathered BEFORE anything is sent -- and a refusal has to send nothing at all,
not stop halfway through the ranges.

Two reasons to refuse that the per-slice gate cannot see on its own: a slice
that failed its own verification, and a day row that no slice claimed. The
second is the quiet one. Slices are tiled by grade, and a tiling that misses
a row leaves it at `pending` while every slice reports success.
"""
import unittest

import stagec_run as run


class Sheet(object):
    """Records what it was asked to send. Sends nothing anywhere."""

    def __init__(self):
        self.sent = []

    def __call__(self, svc, sheet_id, payload):
        self.sent.append(payload)
        return sum(len(v["values"]) for v in payload)


def row(n, kind="day", **cells):
    base = {"Day #": "Day %d" % n, "Skill type": "Reading comprehension"}
    base.update(cells)
    return {"_row": n, "grade": 1, "chapter": 1, "chapter_title": "",
            "kind": kind, "cells": base}


def slice_doc(rows, columns):
    return {"slice": "english_G1", "subject": "English",
            "columns_to_fill": list(columns),
            "rows": [{"row": r["_row"], "day": i + 1,
                      "skill_type": r["cells"]["Skill type"],
                      "slo": "E-01-RD-0%d" % (i + 1),
                      "prior_slos_available": []}
                     for i, r in enumerate(rows)]}


COLS = ["Reading strategy", "Collaboration structure", "Prerequisite SLOs"]


def good_cells(rows):
    """Lopsided on purpose. Cycling values over the rows produces an exact
    tie, which the gate rejects -- correctly, since that is what balancing
    rather than reading looks like. Honest data is uneven."""
    spread = (["infer"] * 5 + ["summarise"] * 3
              + ["question-generate"] * 3 + ["retell"])
    collab = (["think-pair-share"] * 6 + ["peer-check"] * 4
              + ["group-task"] * 2)
    return {"slice": "english_G1", "cells": dict(
        (str(r["_row"]), {"Reading strategy": spread[i % len(spread)],
                          "Collaboration structure": collab[i % len(collab)],
                          "Prerequisite SLOs": "none"})
        for i, r in enumerate(rows))}


class NothingIsSentUntilEveryReasonToRefuseIsGathered(unittest.TestCase):

    def setUp(self):
        self.rows = [row(n) for n in range(4, 16)]
        self.tab = {"tab": "English G1–5", "subject": "English",
                    "header": ["Day #", "Skill type"] + COLS,
                    "columns": COLS, "rows": self.rows}
        self.doc = slice_doc(self.rows, COLS)
        self.out = good_cells(self.rows)

    def test_clean_input_is_ready(self):
        cells, why = run.check_ready(self.tab, [self.doc], [self.out], "English")
        self.assertEqual([], why, why)
        self.assertEqual(len(self.rows), len(cells))

    def test_a_slice_defect_refuses(self):
        self.out["cells"]["4"]["Reading strategy"] = "not-a-strategy"
        _, why = run.check_ready(self.tab, [self.doc], [self.out], "English")
        self.assertTrue(why)

    def test_the_refusal_names_the_slice(self):
        """Twelve slices in, a bare reason cannot be acted on."""
        self.out["cells"]["4"]["Reading strategy"] = "not-a-strategy"
        _, why = run.check_ready(self.tab, [self.doc], [self.out], "English")
        self.assertTrue(any("english_G1" in w for w in why), why)

    def test_a_day_row_no_slice_claimed_refuses(self):
        """The quiet failure: the tiling missed a row and every slice still
        reported success."""
        del self.out["cells"]["9"]
        _, why = run.check_ready(self.tab, [self.doc], [self.out], "English")
        self.assertTrue(any("9" in w for w in why), why)

    def test_a_note_does_not_refuse(self):
        """A note is a question for a curriculum lead, not a defect. It must
        not hold up a tab that is otherwise sound."""
        aloud = u"بلند خوانی · Reading aloud"
        self.doc["rows"][0]["skill_type"] = aloud
        self.rows[0]["cells"]["Skill type"] = aloud
        self.out["cells"]["4"]["Reading strategy"] = "pending"
        _, why = run.check_ready(self.tab, [self.doc], [self.out], "English")
        self.assertEqual([], why, why)

    def test_a_refusal_sends_nothing(self):
        self.out["cells"]["4"]["Reading strategy"] = "not-a-strategy"
        sheet = Sheet()
        updated, why = run.run(None, "sheet-id", self.tab, [self.doc],
                               [self.out], "English", writer=sheet)
        self.assertTrue(why)
        self.assertEqual(0, updated)
        self.assertEqual([], sheet.sent, "a refused write still sent ranges")


if __name__ == "__main__":
    unittest.main()
