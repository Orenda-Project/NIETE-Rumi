# -*- coding: utf-8 -*-
"""Writing the authored objectives into the corpus, and refusing to.

The objectives are authored by hand, one JSON file per book. This driver
is the only thing that puts them on a segment, so it is the only place
that can put a WRONG one there -- an objective against a day that has
since moved, or a book half-covered. `dayobj.check` already says what is
wrong; the job here is to make a complaint stop the write rather than
annotate it.

The seg files come in two shapes -- `{"segments": [...]}` and a bare
list -- and the corpus holds both. A driver that assumed one would
silently rewrite the other into the wrong shape.
"""
import io
import json
import os
import shutil
import tempfile
import unittest

import dayobjrun


def seg(ch, idx, skill="tafheem"):
    return {"chapter_number": ch, "segment_index": idx, "skill_type": skill,
            "topic": "t", "slo_codes": ["U-05-CO-01"]}


class Fixture(unittest.TestCase):

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.segs = os.path.join(self.root, "seg")
        self.objs = os.path.join(self.root, "objectives")
        os.makedirs(self.segs)
        os.makedirs(self.objs)

    def tearDown(self):
        shutil.rmtree(self.root)

    def write_book(self, name, doc):
        with io.open(os.path.join(self.segs, name + ".json"), "w",
                     encoding="utf-8") as f:
            f.write(json.dumps(doc, ensure_ascii=False))

    def write_objectives(self, name, mapping):
        with io.open(os.path.join(self.objs, name + ".json"), "w",
                     encoding="utf-8") as f:
            f.write(json.dumps(mapping, ensure_ascii=False))

    def read_book(self, name):
        with io.open(os.path.join(self.segs, name + ".json"),
                     encoding="utf-8") as f:
            return json.load(f)


class WhichBooksAreAuthored(Fixture):

    def test_a_book_is_named_by_its_objectives_file(self):
        self.write_objectives("grade_4_english", {})
        self.write_objectives("grade_5_urdu", {})
        self.assertEqual(dayobjrun.books(self.objs),
                         ["grade_4_english", "grade_5_urdu"])

    def test_a_seg_file_with_no_objectives_is_not_a_book_to_write(self):
        self.write_book("grade_1_maths", {"segments": [seg(1, 1)]})
        self.assertEqual(dayobjrun.books(self.objs), [])


class TheShapeTheBookCameIn(Fixture):
    """Both shapes are in the corpus. Neither may be rewritten as the other."""

    def test_a_dict_book_stays_a_dict(self):
        self.write_book("b", {"segments": [seg(1, 1)], "grade": 5})
        self.write_objectives("b", {"ch1s1": "I can read it."})
        dayobjrun.run(self.segs, self.objs, write=True)
        out = self.read_book("b")
        self.assertIsInstance(out, dict)
        self.assertEqual(out["grade"], 5)

    def test_a_bare_list_book_stays_a_list(self):
        self.write_book("b", [seg(1, 1)])
        self.write_objectives("b", {"ch1s1": "I can read it."})
        dayobjrun.run(self.segs, self.objs, write=True)
        self.assertIsInstance(self.read_book("b"), list)


class AComplaintStopsTheWrite(Fixture):
    """A half-covered book on disk is worse than none: the days that got one
    look authored and the days that did not look deliberate."""

    def test_a_missing_objective_blocks_the_whole_book(self):
        self.write_book("b", {"segments": [seg(1, 1), seg(1, 2)]})
        self.write_objectives("b", {"ch1s1": "I can read it."})
        rows = dayobjrun.run(self.segs, self.objs, write=True)
        self.assertTrue(rows[0].complaints)
        self.assertEqual(rows[0].applied, 0)

    def test_and_the_file_on_disk_is_untouched(self):
        self.write_book("b", {"segments": [seg(1, 1), seg(1, 2)]})
        self.write_objectives("b", {"ch1s1": "I can read it."})
        dayobjrun.run(self.segs, self.objs, write=True)
        for s in self.read_book("b")["segments"]:
            self.assertNotIn("objective", s)

    def test_a_clean_book_beside_a_dirty_one_still_writes(self):
        self.write_book("dirty", {"segments": [seg(1, 1), seg(1, 2)]})
        self.write_objectives("dirty", {"ch1s1": "I can read it."})
        self.write_book("clean", {"segments": [seg(1, 1)]})
        self.write_objectives("clean", {"ch1s1": "I can count."})
        dayobjrun.run(self.segs, self.objs, write=True)
        self.assertEqual(self.read_book("clean")["segments"][0]["objective"],
                         "I can count.")

    def test_an_objectives_file_with_no_seg_file_is_reported_not_crashed(self):
        self.write_objectives("ghost", {"ch1s1": "I can read it."})
        rows = dayobjrun.run(self.segs, self.objs, write=True)
        self.assertTrue(rows[0].complaints)


class WhatItWrites(Fixture):

    def test_the_teaching_day_carries_its_objective(self):
        self.write_book("b", {"segments": [seg(1, 1)]})
        self.write_objectives("b", {"ch1s1": "I can read it."})
        rows = dayobjrun.run(self.segs, self.objs, write=True)
        self.assertEqual(rows[0].applied, 1)
        self.assertEqual(self.read_book("b")["segments"][0]["objective"],
                         "I can read it.")

    def test_the_slo_codes_are_still_there_afterwards(self):
        """Amena, twice: 'dont remove the SLOs pls'."""
        self.write_book("b", {"segments": [seg(1, 1)]})
        self.write_objectives("b", {"ch1s1": "I can read it."})
        dayobjrun.run(self.segs, self.objs, write=True)
        self.assertEqual(self.read_book("b")["segments"][0]["slo_codes"],
                         ["U-05-CO-01"])

    def test_a_revision_day_is_left_alone(self):
        self.write_book("b", {"segments": [seg(1, 1), seg(1, 2, "revision")]})
        self.write_objectives("b", {"ch1s1": "I can read it."})
        rows = dayobjrun.run(self.segs, self.objs, write=True)
        self.assertEqual(rows[0].complaints, [])
        self.assertNotIn("objective", self.read_book("b")["segments"][1])

    def test_urdu_survives_the_round_trip_unescaped(self):
        said = u"آج ہم نظم بلند خوانی کرتے ہیں۔"
        self.write_book("b", {"segments": [seg(1, 1)]})
        self.write_objectives("b", {"ch1s1": said})
        dayobjrun.run(self.segs, self.objs, write=True)
        raw = io.open(os.path.join(self.segs, "b.json"), encoding="utf-8").read()
        self.assertIn(said, raw)


class MeasuringWithoutWriting(Fixture):

    def test_the_default_writes_nothing(self):
        self.write_book("b", {"segments": [seg(1, 1)]})
        self.write_objectives("b", {"ch1s1": "I can read it."})
        rows = dayobjrun.run(self.segs, self.objs)
        self.assertEqual(rows[0].applied, 1)
        self.assertNotIn("objective", self.read_book("b")["segments"][0])

    def test_running_twice_leaves_the_same_bytes(self):
        self.write_book("b", {"segments": [seg(1, 1)]})
        self.write_objectives("b", {"ch1s1": "I can read it."})
        dayobjrun.run(self.segs, self.objs, write=True)
        first = io.open(os.path.join(self.segs, "b.json"), encoding="utf-8").read()
        dayobjrun.run(self.segs, self.objs, write=True)
        second = io.open(os.path.join(self.segs, "b.json"), encoding="utf-8").read()
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
