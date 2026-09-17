"""skillgrid — the block-character track that paints five stacked grades,
the ordering that turns `skills.ORDER` into a column position, and the
`load()` path that reads the Skills Map's own JSON.

skills.py's own comment records a real incident: `review_assess`, a
Science label, went missing from `skills.ORDER["Science"]`, so "every
ORDER-driven loop silently dropped those days." `_ordered` promises the
fix is structural — an unknown label keeps its place at the end and never
vanishes — worth proving once here, not per caller.

`track()`'s fixed-width promise is the other failure mode: five grades
stack one under another, so an empty sequence has to occupy the same width
as a full one, or the rows stop lining up. And `load()`'s default path is
bound at import time (`os.environ.get("SKILLSMAP_JSON", ...)`), which only
`importlib.reload` actually exercises — a plain env-var patch tests nothing.

Column geometry, WIDTHS, and the `__all__` export contract live in
test_skillgrid.py — a different seam, a different file.
"""
import importlib
import json
import os
import tempfile
import unittest
from unittest import mock

import skillgrid
import skills


class TrackIsFixedWidthWhateverGoesIntoIt(unittest.TestCase):
    """The five grades stack one under another, so a track's width must be
    identical whether the grade taught 3 days or 300. The empty case is
    easiest to get wrong: an early-return of "" instead of VOID*slices
    breaks only the stacking, not the caller — nothing else would catch it."""

    def test_a_long_sequence_still_comes_out_slices_characters_wide(self):
        self.assertEqual(len(skillgrid.track(["phonics"] * 1000, "phonics")),
                         skillgrid.SLICES)

    def test_a_single_element_sequence_still_comes_out_slices_characters_wide(self):
        self.assertEqual(len(skillgrid.track(["phonics"], "phonics")),
                         skillgrid.SLICES)

    def test_an_empty_sequence_is_all_void_at_the_full_width(self):
        # This is the case the docstring calls out by name: a grade with no
        # days for this skill still has to occupy the same width as one that
        # taught it every day, or the five stacked rows stop lining up.
        empty_track = skillgrid.track([], "phonics")
        self.assertEqual(len(empty_track), skillgrid.SLICES)
        self.assertEqual(empty_track, skillgrid.VOID * skillgrid.SLICES)

    def test_a_track_never_contains_a_plain_space(self):
        # The void character is deliberately ░, not " " — a space is the
        # naive "nothing here" filler and it would collapse in a monospace
        # stack instead of holding its column, defeating the whole point of
        # a fixed-width track.
        for seq, label in ([], "x"), (["a", "b", "x", "b"], "x"), (["x"] * 5, "x"):
            with self.subTest(seq=seq):
                self.assertNotIn(" ", skillgrid.track(seq, label))


class TrackPaintsExactlyWhatTheLegendPromises(unittest.TestCase):
    """LEGEND promises three marks: █ fills half the slice or more, ▌ merely
    appears in it, ░ is absent. These tests build sequences by hand so the
    paint is checked against the promise, not its own logic re-derived."""

    def test_the_three_marks_land_on_hand_built_slices(self):
        # 4 slices of 3 elements each: slice 0 has 1 of 3 hits (appears, but
        # under half -> ▌), slice 1 is all hits (-> █), slice 2 has none
        # (-> ░), slice 3 has 2 of 3 (at least half -> █). A test that only
        # checked "hit vs no hit" would pass a bug that painted ▌ wherever █
        # belongs, since both are "the skill is here somewhere."
        seq = ["a", "b", "b",  "a", "a", "a",  "b", "b", "b",  "a", "a", "b"]
        self.assertEqual(skillgrid.track(seq, "a", slices=4),
                         skillgrid.HALF + skillgrid.BLOCK + skillgrid.VOID
                         + skillgrid.BLOCK)

    def test_a_label_that_never_appears_gives_an_all_void_track(self):
        seq = ["b"] * 40
        self.assertEqual(skillgrid.track(seq, "a"), skillgrid.VOID * skillgrid.SLICES)

    def test_a_label_that_fills_the_whole_sequence_gives_an_all_block_track(self):
        seq = ["a"] * 40
        self.assertEqual(skillgrid.track(seq, "a"), skillgrid.BLOCK * skillgrid.SLICES)

    def test_no_character_outside_the_legends_three_ever_reaches_the_sheet(self):
        # An odd length that does not divide evenly into SLICES, so windows
        # overlap awkwardly — exactly the arithmetic most likely to produce a
        # stray character LEGEND never named.
        seq = ["a", "b", "c", "a", "b"] * 3
        painted = set(skillgrid.track(seq, "a", slices=skillgrid.SLICES))
        self.assertLessEqual(painted, {skillgrid.BLOCK, skillgrid.HALF, skillgrid.VOID})


class OrderedNeverDropsAWordOrderHasNeverHeardOf(unittest.TestCase):
    """skills.ORDER is a SORT HINT ONLY: what it does not know keeps its
    place at the end and never vanishes — the review_assess incident in
    skills.py was a label ORDER-driven code silently dropped, not sorted last."""

    LABELS = ["Mystery skill one", skills.label("writing", "English"),
              skills.label("phonics", "English"), "Mystery skill two"]

    def test_nothing_is_lost_and_nothing_is_duplicated(self):
        # A test that only checked the two known labels survived would pass
        # even if both unknowns were silently dropped — comparing the full
        # multiset is what catches that.
        result = skillgrid._ordered({}, "English", self.LABELS)
        self.assertEqual(sorted(result), sorted(self.LABELS))

    def test_unknown_labels_land_after_every_known_one(self):
        result = skillgrid._ordered({}, "English", self.LABELS)
        known = {skills.label("writing", "English"), skills.label("phonics", "English")}
        last_known = max(i for i, lab in enumerate(result) if lab in known)
        first_unknown = min(i for i, lab in enumerate(result) if lab not in known)
        self.assertLess(last_known, first_unknown)

    def test_known_labels_come_out_in_teaching_ramp_order(self):
        labels = [skills.label("writing", "English"), skills.label("phonics", "English"),
                  skills.label("assessment", "English")]
        result = skillgrid._ordered({}, "English", labels)
        self.assertEqual(result, [skills.label("phonics", "English"),
                                  skills.label("writing", "English"),
                                  skills.label("assessment", "English")])


class OrderedCanonicalisesBeforeItRanks(unittest.TestCase):
    """Grade 5 Urdu carries the generic labels "Revision"/"Assessment" that
    ALIAS maps onto duhrai/jaiza; neither raw key is itself in
    skills.ORDER["Urdu"]. Ranking on the raw key would fall both to the
    end — indistinguishable from a label ORDER has never heard of."""

    def test_an_aliased_urdu_label_sorts_into_its_ramp_position_not_the_end(self):
        # duhrai sits at index 7 of ORDER["Urdu"], jaiza at 8, qawaid at 1 —
        # so the canonicalised order below is the only order that is not
        # "qawaid, then whichever alias happened to come first in the input".
        ordered = skillgrid._ordered(
            {}, "Urdu", ["Assessment", skills.label("qawaid", "Urdu"), "Revision"])
        self.assertEqual(ordered, [skills.label("qawaid", "Urdu"),
                                   "Revision", "Assessment"])


class LoadHonoursTheEnvVarAndReadsUtf8(unittest.TestCase):

    def setUp(self):
        self._original_default_path = skillgrid.DEFAULT_PATH

    def tearDown(self):
        # DEFAULT_PATH only changes via a reload (load()'s bound default is
        # fixed at definition time) — undo it, or a later test file sharing
        # this interpreter under `unittest discover` inherits a dead path.
        if skillgrid.DEFAULT_PATH != self._original_default_path:
            importlib.reload(skillgrid)

    def test_load_reads_utf8_so_an_urdu_label_round_trips(self):
        # A platform-default read (cp1252 on some machines) would not raise
        # here — it would mangle the Nastaliq into mojibake instead, so this
        # checks the round-tripped value, not just that the call succeeded.
        payload = {"label": "دہرائی · Revision", "code": "DH"}
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "skillsmap.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, ensure_ascii=False)
            self.assertEqual(skillgrid.load(path), payload)

    def test_skillsmap_json_env_var_is_what_default_path_consults(self):
        # DEFAULT_PATH is `os.environ.get(...)` evaluated once, at import —
        # setting the env var afterwards proves nothing since nothing re-runs
        # that line. Only a reload actually exercises it.
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "skillsmap.json")
            payload = {"label": "قواعد · Grammar"}
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, ensure_ascii=False)
            with mock.patch.dict(os.environ, {"SKILLSMAP_JSON": path}):
                importlib.reload(skillgrid)
                self.assertEqual(skillgrid.DEFAULT_PATH, path)
                self.assertEqual(skillgrid.load(), payload)
            importlib.reload(skillgrid)   # back to the real project path


if __name__ == "__main__":
    unittest.main()
