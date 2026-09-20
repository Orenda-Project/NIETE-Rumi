# -*- coding: utf-8 -*-
"""The sender is thin, so these tests cover the round trip, not the decisions.

A fake service stands in for Sheets. The case that matters is the dishonest
one: the API reports cells updated and the sheet does not hold them. That must
surface as findings, because "the API said OK" is not evidence.
"""
import unittest

import stagec_send as s

HEADER = ["Day #", "Topic", "Moves", "Teacher-primary min (of 40)"]
TAB = {"tab": "Maths G1–5", "header": HEADER,
       "rows": [{"_row": 4, "kind": "day", "cells": {}},
                {"_row": 5, "kind": "day", "cells": {}}]}
NEW = {4: {"Moves": "a", "Teacher-primary min (of 40)": "9"},
       5: {"Moves": "b", "Teacher-primary min (of 40)": "10"}}
COLS = ["Moves", "Teacher-primary min (of 40)"]


class FakeSheet(object):
    """Stores what it is told, and returns what it stores."""

    def __init__(self, drop=(), lie=False):
        self.store = {}
        self.drop = set(drop)
        self.lie = lie
        self.sent = []

    # -- the chained google-api surface, only as far as we use it --
    def spreadsheets(self):
        return self

    def values(self):
        return self

    def batchUpdate(self, spreadsheetId=None, body=None):
        self.sent = body["data"]
        n = 0
        for vr in body["data"]:
            if not self.lie:
                self.store[vr["range"]] = vr["values"]
            n += len(vr["values"])
        return _Exec({"totalUpdatedCells": n})

    def batchGet(self, spreadsheetId=None, ranges=None):
        out = []
        for r in ranges or []:
            if r in self.drop:
                continue
            if r in self.store:
                out.append({"range": r, "values": self.store[r]})
        return _Exec({"valueRanges": out})


class _Exec(object):
    def __init__(self, payload):
        self.payload = payload

    def execute(self):
        return self.payload


class TheRoundTrip(unittest.TestCase):

    def test_a_write_that_lands_reports_no_findings(self):
        svc = FakeSheet()
        updated, findings = s.write_tab(svc, "SID", TAB, NEW, COLS)
        self.assertEqual(findings, [])
        self.assertEqual(updated, 4)

    def test_it_sends_one_range_per_column(self):
        svc = FakeSheet()
        s.write_tab(svc, "SID", TAB, NEW, COLS)
        self.assertEqual(len(svc.sent), len(COLS))

    def test_an_api_that_claims_success_without_storing_is_caught(self):
        """The failure the read-back exists for: totalUpdatedCells is not
        evidence that the sheet holds anything."""
        svc = FakeSheet(lie=True)
        updated, findings = s.write_tab(svc, "SID", TAB, NEW, COLS)
        self.assertEqual(updated, 4)
        self.assertEqual(len(findings), 4)

    def test_a_column_the_sheet_omits_on_read_is_caught(self):
        svc = FakeSheet()
        s.write_tab(svc, "SID", TAB, NEW, COLS)
        omitted = list(svc.store)[0]
        svc.drop.add(omitted)
        _, findings = s.write_tab(svc, "SID", TAB, NEW, COLS)
        self.assertTrue(findings)

    def test_nothing_to_write_touches_nothing(self):
        svc = FakeSheet()
        updated, findings = s.write_tab(svc, "SID", TAB, {}, [])
        self.assertEqual((updated, findings), (0, []))
        self.assertEqual(svc.sent, [])


if __name__ == "__main__":
    unittest.main()
