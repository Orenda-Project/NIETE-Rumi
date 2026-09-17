"""covdata — the tally both coverage tabs are read off, and what it may not lose.

`Coverage Map` and `Coverage — gaps` are two pictures of ONE count. They used
to live in one file with the count inlined, which is why this module exists at
all: the tally is the only part of the coverage build that has nothing to do
with columns, and it is the part both tabs must agree on. Two tabs disagreeing
about the same book is the single thing a coverage tab may not do.

Three ways this count has gone wrong before, each of which is a test below:

  1. A LABEL LIVE IN THE DATA AND ABSENT FROM `skills.ORDER`. ORDER is hand
     edited; `review_assess` was a real Science label missing from it, and
     every ORDER-driven loop silently dropped those days. A tab that reports
     "Science teaches nothing on chapter-close days" because the loop that
     counted them never looked is worse than no tab.
  2. AN ALIASED URDU KEY COUNTED RAW. Urdu writes revision as `duhrai` and
     assessment as `jaiza`; Grade 5 Urdu arrived tagged with the English keys.
     Counted without canonicalising, one book's revision lands in a second,
     separate bucket and the bookkeeping line under-reports it.
  3. BOOKKEEPING FLATTERING THE MIX. A revision day consumes a teaching day
     without teaching a skill. Counted into the mix it makes the year look
     better balanced than it is; dropped entirely it makes the year look
     shorter than it is. It has to be both excluded and totalled.

So these tests assert conservation — nothing counted twice, nothing lost — and
the one architectural rule the split exists to keep: this module knows nothing
about columns and never imports its painter.
"""
import unittest

import covdata
import skills


def day(skill_type, chapter=1, kind="day", title="A chapter"):
    return {"kind": kind, "skill_type": skill_type, "chapter": chapter,
            "chapter_title": title}


class NoDayIsLostBetweenTheBookAndTheTally(unittest.TestCase):

    def test_every_teaching_day_lands_in_exactly_one_skill_bucket(self):
        rows = [day("concrete"), day("concrete"), day("pictorial"),
                day("word_problem")]
        per, _by, _admin = covdata.count(rows, "Maths")
        self.assertEqual(sum(per.values()), 4)

    def test_a_day_with_no_chapter_still_counts_towards_the_mix(self):
        # Basics periods and gap-fill carry no chapter. Counting them only in
        # the chapter grid would drop them from the mix bars, which are the
        # thing the tab is actually read for.
        per, by_chapter, _admin = covdata.count(
            [day("concrete", chapter=None), day("concrete", chapter=2)],
            "Maths")
        self.assertEqual(per["concrete"], 2)
        self.assertEqual(by_chapter, {2: {"concrete": 1}})

    def test_a_non_teaching_row_is_counted_as_bookkeeping_not_dropped(self):
        # A row that is not a day still consumed a day of the year.
        _per, _by, admin = covdata.count(
            [day("concrete"), day("", kind="chapter_close")], "Maths")
        self.assertEqual(admin, 1)

    def test_a_revision_day_is_kept_out_of_the_mix_and_still_totalled(self):
        # Both halves matter and they pull opposite ways: excluded from the
        # shown keys so the mix is not flattered, and present in the admin
        # total so the year is not reported as shorter than it is. A test
        # asserting only the exclusion would pass for an implementation that
        # threw the day away.
        per, _by, admin = covdata.count(
            [day("concrete"), day("revision"), day("assessment")], "Maths")
        shown, _extra = covdata.keys("Maths", set(per))
        self.assertNotIn("revision", shown)
        self.assertNotIn("assessment", shown)
        self.assertEqual(admin, 2)


class TheTaxonomyIsASortHintNotAGate(unittest.TestCase):
    """A label can be live in the corpus and absent from hand-edited ORDER."""

    def test_a_label_order_has_never_heard_of_is_kept_and_marked(self):
        # Kept, so the days it carries still reach the tab; marked, so the
        # reader knows the taxonomy has fallen behind the corpus rather than
        # seeing a skill type appear from nowhere.
        shown, extra = covdata.keys("Maths", {"concrete", "mental_maths"})
        self.assertIn("mental_maths", shown)
        self.assertIn("mental_maths", extra)

    def test_the_off_taxonomy_labels_come_after_the_ones_order_names(self):
        # ORDER is the teaching ramp and reads left to right; an unknown label
        # spliced into the middle of it breaks that reading.
        shown, extra = covdata.keys("Maths", {"aardvark", "concrete"})
        self.assertEqual(shown[-1], "aardvark")
        self.assertEqual(shown[0], skills.canonical("concrete", "Maths"))

    def test_a_label_order_does_name_is_never_reported_as_off_taxonomy(self):
        _shown, extra = covdata.keys("Science", {"review_assess"})
        self.assertEqual(extra, set(),
                         "review_assess is in Science's ORDER; flagging it "
                         "would put a false warning on every Science row")

    def test_bookkeeping_is_never_reported_as_off_taxonomy_either(self):
        # It is excluded on purpose, not because nobody has heard of it. A
        # warning triangle here would read as a data problem.
        _shown, extra = covdata.keys("Urdu", {"duhrai", "jaiza"})
        self.assertEqual(extra, set())

    def test_no_subject_shows_a_bookkeeping_key_in_its_mix(self):
        for subject in covdata.SUBJECTS:
            shown, _extra = covdata.keys(subject)
            self.assertEqual([k for k in shown if k in covdata.BOOKKEEPING],
                             [], f"{subject} counts bookkeeping in its mix")


class TheUrduAliasesAreResolvedBeforeAnythingIsCounted(unittest.TestCase):

    def test_urdu_revision_and_duhrai_are_the_same_bucket(self):
        # Grade 5 Urdu arrived tagged with the English keys. Counted raw they
        # are two buckets and the bookkeeping line reports half the truth.
        per, _by, admin = covdata.count(
            [day("Revision"), day("دہرائی · Revision")], "Urdu")
        self.assertEqual(len(per), 1, f"revision split across buckets: {per}")
        self.assertEqual(admin, 2)

    def test_the_shown_keys_for_urdu_are_all_urdu_vocabulary(self):
        # One vocabulary per subject is the whole point of skills.ORDER; an
        # un-canonicalised key would show the English label on an Urdu row.
        shown, _extra = covdata.keys("Urdu")
        for key in shown:
            self.assertEqual(skills.canonical(key, "Urdu"), key)


class EveryPrintedLabelFindsItsWayBackToAKey(unittest.TestCase):

    def test_a_day_tagged_with_a_printed_label_counts_as_its_key(self):
        # The corpus writes some days by label and some by key. Both must land
        # in the same bucket or a book is split in two down the middle.
        per, _by, _admin = covdata.count(
            [day("concrete"), day(skills.label("concrete", "Maths"))],
            "Maths")
        self.assertEqual(per, {"concrete": 2})

    def test_a_label_nobody_knows_survives_as_itself(self):
        # Falling back to the raw label keeps the day; raising or returning
        # None loses it, and a lost day is invisible on the tab.
        per, _by, _admin = covdata.count([day("brand new thing")], "Maths")
        self.assertEqual(per, {"brand new thing": 1})


class PrepareGivesEveryTabTheSameNumbers(unittest.TestCase):

    def corpus(self):
        return {"Maths": [(1, [day("concrete"), day("pictorial", 2)], {})],
                "Science": []}

    def test_a_subject_with_no_books_gets_no_entry_at_all(self):
        # An empty entry would render as a subject banner over an empty block.
        prepared = covdata.prepare(self.corpus())
        self.assertNotIn("Science", prepared)
        self.assertIn("Maths", prepared)

    def test_the_shown_keys_cover_every_key_the_count_produced(self):
        # A key counted but not shown is days that exist and are never drawn.
        prepared = covdata.prepare(self.corpus())
        _books, shown, _extra, counted = prepared["Maths"]
        for _grade, (per, _by, _admin) in counted.items():
            for key in per:
                if key in covdata.BOOKKEEPING:
                    continue
                self.assertIn(key, shown, f"{key} counted but never shown")

    def test_every_expected_skill_is_real_vocabulary_for_its_subject(self):
        # EXPECTED drives the gaps tab's "this chapter is missing X" list. A
        # key that is not in the subject's ORDER can never be satisfied, so
        # every chapter would be reported as missing it, for ever.
        for subject, expected in covdata.EXPECTED.items():
            order = [skills.canonical(k, subject)
                     for k in skills.ORDER[subject]]
            for key in expected:
                self.assertIn(skills.canonical(key, subject), order,
                              f"{subject} can never satisfy {key}")


class TheTallyKnowsNothingAboutTheSheet(unittest.TestCase):
    """The split's own rule: a content module never imports its painter."""

    def test_covdata_does_not_import_the_painter_or_the_layout(self):
        # Asserting on the import graph rather than on behaviour, because the
        # damage from breaking this is not a wrong number — it is a cycle and
        # a module that can no longer be tested without a Sheets client.
        with open(covdata.__file__, encoding="utf-8") as fh:
            source = fh.read()
        for forbidden in ("covfmt", "covtab", "sheetio", "googleapiclient"):
            self.assertNotIn(f"import {forbidden}", source)

    def test_it_names_no_column_width_or_index(self):
        # Geometry belongs to covtab. A width here means the two files can
        # disagree about the same tab.
        names = [n for n in dir(covdata) if not n.startswith("_")]
        for name in names:
            self.assertFalse(name.endswith(("_C", "_W", "_COLS")),
                             f"{name} is geometry and belongs in covtab")


if __name__ == "__main__":
    unittest.main()
