# -*- coding: utf-8 -*-
"""The sender's half: a row is made and filled before the next one is made."""
import unittest

import stagebsend
from test_stagebsync import HEADER


class Call(object):
    """One recorded request. `execute` is what the Sheets client makes you call."""

    def __init__(self, log, kind, kwargs):
        self.log, self.kind, self.kwargs = log, kind, kwargs

    def execute(self):
        self.log.append((self.kind, self.kwargs))
        return {}


class FakeSheets(object):
    """Enough of the client to record what would have been sent."""

    def __init__(self):
        self.log = []

    def spreadsheets(self):
        return self

    def values(self):
        return self

    def batchUpdate(self, **kw):
        return Call(self.log, "insert", kw)

    def update(self, **kw):
        return Call(self.log, "fill", kw)


WANT = {(1, 1, 6): {"Day #": u"Day 6", "Topic": u"Days of the Week"},
        (1, 1, 7): {"Day #": u"Day 7", "Topic": u"Name It, Sort It"}}


class ARowIsFilledBeforeTheNextIsMade(unittest.TestCase):
    """A blank row on a subject tab reads as the end of the chapter.

    Insert-insert-fill-fill would leave the tab, between the two writes,
    claiming a chapter ends where it does not -- and the run can stop
    between any two calls.
    """

    def test_the_calls_alternate(self):
        svc = FakeSheets()
        stagebsend.add_rows(svc, 7, u"English G1–5", HEADER,
                            [(7, (1, 1, 7)), (6, (1, 1, 6))], WANT)
        self.assertEqual([k for k, _ in svc.log],
                         ["insert", "fill", "insert", "fill"])

    def test_the_row_index_is_the_header_plus_the_offset(self):
        svc = FakeSheets()
        stagebsend.add_rows(svc, 7, u"English G1–5", HEADER,
                            [(7, (1, 1, 7))], WANT)
        got = svc.log[0][1]["body"]["requests"][0]["insertDimension"]["range"]
        # rows[7] is sheet row 11, whose 0-based index is 10.
        self.assertEqual((got["startIndex"], got["endIndex"]), (10, 11))

    def test_the_new_row_is_filled_from_the_build(self):
        svc = FakeSheets()
        stagebsend.add_rows(svc, 7, u"English G1–5", HEADER,
                            [(7, (1, 1, 6))], WANT)
        row = svc.log[1][1]["body"]["values"][0]
        self.assertEqual(row[HEADER.index("Topic")], u"Days of the Week")

    def test_it_inherits_the_formatting_of_the_row_above(self):
        svc = FakeSheets()
        stagebsend.add_rows(svc, 7, u"English G1–5", HEADER,
                            [(7, (1, 1, 6))], WANT)
        req = svc.log[0][1]["body"]["requests"][0]["insertDimension"]
        self.assertTrue(req["inheritFromBefore"])


class ARangeIsSpelledNotNumbered(unittest.TestCase):
    """Sheets takes A, Z, AA -- and the tabs are wide enough to reach AA."""

    def test_the_first_column(self):
        self.assertEqual(stagebsend.letter(0), "A")

    def test_the_last_single_letter(self):
        self.assertEqual(stagebsend.letter(25), "Z")

    def test_it_carries(self):
        self.assertEqual(stagebsend.letter(26), "AA")


if __name__ == "__main__":
    unittest.main()
