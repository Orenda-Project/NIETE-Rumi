# -*- coding: utf-8 -*-
"""`skillsnap` regenerates the one snapshot the build reads instead of deriving.

Every assertion here is a way the snapshot could fall behind the corpus again,
because that is the whole defect class (bd-hlq38, bd-tphbz, bd-7j5rs). The
counting rules are not invented: `skillsmap.json`'s own `meta` block states
them, and the tests below hold the regenerator to that wording.
"""
import unittest

import skillsnap


def day(chapter, skill, title=u"Ch", n=1):
    return [{"kind": "day", "chapter": chapter, "chapter_title": title,
             "skill_type": skill, "day_label": u"Day %d" % (i + 1)}
            for i in range(n)]


def close(chapter, skill, title=u"Ch", kind="assessment"):
    return [{"kind": kind, "chapter": chapter, "chapter_title": title,
             "skill_type": skill, "day_label": skill}]


#: One chapter of three teaching days and a chapter-close assessment.
ROWS = (day(1, u"Writing", u"Hello", 2) + day(1, u"Phonics", u"Hello")
        + close(1, u"Assessment", u"Hello")
        + day(2, u"Writing", u"Senses") + close(2, u"Assessment", u"Senses"))


class TheCountIsOfDayRowsNotEveryRow(unittest.TestCase):
    """The 86-that-should-be-87. A chapter close consumes a period and
    teaches nothing, so it is never a teaching day."""

    def test_n_days_counts_only_day_rows(self):
        self.assertEqual(skillsnap.grade_block(ROWS)["n_days"], 4)

    def test_a_new_day_row_moves_the_count(self):
        grown = skillsnap.grade_block(ROWS + day(2, u"Phonics", u"Senses"))
        self.assertEqual(grown["n_days"], 5)

    def test_days_per_skill_never_counts_a_chapter_close(self):
        self.assertNotIn(u"Assessment", skillsnap.grade_block(ROWS)["days_per_skill"])


class ASlotIsADayOrAChapterClose(unittest.TestCase):
    """meta: "day rows PLUS chapter-close rows ... which also carry a skill
    type". Both counts exist because they answer different questions."""

    def test_slots_are_days_plus_closes(self):
        self.assertEqual(skillsnap.grade_block(ROWS)["n_slots"], 6)

    def test_slots_per_skill_carries_the_close(self):
        self.assertEqual(
            skillsnap.grade_block(ROWS)["slots_per_skill"][u"Assessment"], 2)


class ARunIsCollapsedOnlyWhenItRepeats(unittest.TestCase):

    def test_consecutive_repeats_collapse(self):
        self.assertEqual(skillsnap.runs([u"a", u"a", u"b"]),
                         [[u"a", 2], [u"b", 1]])

    def test_a_label_returning_later_starts_a_new_run(self):
        self.assertEqual(skillsnap.runs([u"a", u"b", u"a"]),
                         [[u"a", 1], [u"b", 1], [u"a", 1]])

    def test_the_day_sequence_leaves_the_closes_out(self):
        self.assertEqual(skillsnap.grade_block(ROWS)["day_sequence_runs"],
                         [[u"Writing", 2], [u"Phonics", 1], [u"Writing", 1]])


class FirstAppearanceIsTheFirstDayRowThatCarriesIt(unittest.TestCase):
    """meta: "100 * (zero-based index of the first DAY row carrying that
    skill) / (total day rows in the grade)"."""

    def test_the_ordinal_is_one_based_over_day_rows(self):
        fa = skillsnap.grade_block(ROWS)["first_appearance"]
        self.assertEqual(fa[u"Phonics"]["first_day_ordinal"], 3)

    def test_the_percentage_is_zero_based_over_the_grade(self):
        fa = skillsnap.grade_block(ROWS)["first_appearance"]
        self.assertAlmostEqual(fa[u"Phonics"]["pct_through"], 50.0)

    def test_it_names_the_chapter_the_first_day_sits_in(self):
        fa = skillsnap.grade_block(ROWS)["first_appearance"]
        self.assertEqual(fa[u"Writing"]["chapter"], 1)

    def test_a_chapter_close_never_opens_a_skill(self):
        self.assertNotIn(u"Assessment",
                         skillsnap.grade_block(ROWS)["first_appearance"])


class AChapterKeepsItsOwnShape(unittest.TestCase):

    def test_every_chapter_is_listed_once_in_order(self):
        got = skillsnap.grade_block(ROWS)["chapters"]
        self.assertEqual([c["chapter"] for c in got], [1, 2])

    def test_a_chapter_carries_its_title(self):
        self.assertEqual(skillsnap.grade_block(ROWS)["chapters"][0]["title"],
                         u"Hello")

    def test_a_chapters_days_exclude_its_close(self):
        self.assertEqual(skillsnap.grade_block(ROWS)["chapters"][0]["n_days"], 3)


class TheSnapshotSaysWhereItCameFrom(unittest.TestCase):
    """The old file was scraped off the published sheet, which is why it could
    lag a build that had already moved. A regenerated one says so."""

    def test_meta_names_the_corpus_not_the_sheet(self):
        meta = skillsnap.build({"English": [(1, ROWS, {})]})["meta"]
        self.assertEqual(meta["source"], "corpus")
        self.assertNotIn("sheet_id", meta)

    def test_meta_keeps_the_counting_rules_it_is_held_to(self):
        meta = skillsnap.build({"English": [(1, ROWS, {})]})["meta"]
        self.assertIn("pct_through_formula", meta)

    def test_meta_stamps_the_day_it_was_taken(self):
        meta = skillsnap.build({"English": [(1, ROWS, {})]})["meta"]
        self.assertRegex(meta["generated"], r"^\d{4}-\d{2}-\d{2}")


class ASubjectCarriesEverySkillItsVocabularyNames(unittest.TestCase):

    def test_the_reference_covers_the_subjects_order(self):
        import skills
        got = skillsnap.build({"English": [(1, ROWS, {})]})["skill_reference"]
        keys = [r["key"] for r in got if r["subject"] == "English"]
        self.assertEqual(keys, list(skills.ORDER["English"]))

    def test_labels_seen_in_data_include_the_chapter_close(self):
        seen = skillsnap.build(
            {"English": [(1, ROWS, {})]})["labels_seen_in_data"]["English"]
        self.assertIn(u"Assessment", seen)

    def test_a_label_the_order_does_not_name_is_recorded(self):
        rows = ROWS + day(3, u"Made up skill", u"Odd")
        out = skillsnap.build({"English": [(1, rows, {})]})
        self.assertEqual(out["labels_not_in_ORDER"]["English"],
                         [u"Made up skill"])


class AStaleSnapshotIsNamedNotGuessedAt(unittest.TestCase):
    """The check that would have caught bd-7j5rs on the build that caused it."""

    def test_a_snapshot_built_from_this_corpus_is_not_stale(self):
        corpus = {"English": [(1, ROWS, {})]}
        self.assertEqual(skillsnap.stale(skillsnap.build(corpus), corpus), [])

    def test_a_grade_that_gained_a_day_is_named(self):
        corpus = {"English": [(1, ROWS, {})]}
        snap = skillsnap.build(corpus)
        grown = {"English": [(1, ROWS + day(2, u"Phonics", u"Senses"), {})]}
        self.assertEqual(skillsnap.stale(snap, grown),
                         [("English", "1", 4, 5)])

    def test_a_subject_the_snapshot_has_never_seen_is_named(self):
        snap = skillsnap.build({"English": [(1, ROWS, {})]})
        both = {"English": [(1, ROWS, {})], "Urdu": [(1, ROWS, {})]}
        self.assertEqual(skillsnap.stale(snap, both),
                         [("Urdu", "1", None, 4)])


if __name__ == "__main__":
    unittest.main()
