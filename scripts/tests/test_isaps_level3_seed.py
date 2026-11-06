"""bd-9svkbb — I-SAPS Level 3 (Advanced) seed, pure (no database).

Level 3 is seeded by scripts/migrations/2026-11-05-isaps-level3-seed.py, which reuses the Level 2 one-pass
seed (its parsers, writer and rollback: one implementation, so the bd-arghnv.3 option-parser fix carries over)
with Level 3's constants. Pinned here:

  * Level 3's identity: "Level 3: Advanced" (the partner's header on every Level 3 CRQ document), order_index 2
    (Level 1 is 0, Level 2 is 1), cpd_level 3, videos under .../i-saps/level-3/.
  * Unit codes are checked against the level being seeded: 3101 is level 3 / module 1; a 2101 in a Level 3
    folder is reported. The Level 2 seed hard-coded "level 2" and would have reported every Level 3 unit.
  * The summative bank is found whether the partner wrote "Summative Assessment Questions" or, as Level 3
    Module 2 does, "Summative Assessments Questions". The Level 2 pick missed the second and stopped the seed.
  * Loading the Level 3 seed leaves the Level 2 seed's constants alone.

Run: python3 -m unittest scripts/tests/test_isaps_level3_seed.py
"""
import importlib.util
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATIONS = os.path.join(HERE, "..", "migrations")


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(MIGRATIONS, filename))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Level3Identity(unittest.TestCase):
    def setUp(self):
        self.l3 = _load("isaps_l3_seed", "2026-11-05-isaps-level3-seed.py").seed

    def test_level_3_constants(self):
        self.assertEqual(self.l3.LEVEL_NO, 3)
        self.assertEqual(self.l3.LEVEL_NAME, "Level 3: Advanced")
        self.assertEqual(self.l3.LEVEL_ORDER, 2)
        self.assertEqual(self.l3.CPD_LEVEL, 3)
        self.assertTrue(self.l3.R2_BASE.endswith("/digital-coach-audio/training/rehosted/i-saps/level-3"))
        self.assertIn("Level 3", self.l3.RUBRIC_SOURCE)

    def test_the_per_module_exam_ids_are_the_shared_901_to_909(self):
        # isaps-module-exam.rules.js reads the module off source_quiz_id 900+N, at every level.
        self.assertEqual(self.l3.PER_MODULE_SOURCE_BASE, 900)

    def test_level_2_is_untouched_by_loading_level_3(self):
        _load("isaps_l3_seed_again", "2026-11-05-isaps-level3-seed.py")
        l2 = _load("isaps_l2_seed", "2026-10-23-isaps-level2-seed.py")
        self.assertEqual((l2.LEVEL_NO, l2.LEVEL_NAME, l2.LEVEL_ORDER, l2.CPD_LEVEL), (2, "Level 2: Intermediate", 1, 2))
        self.assertTrue(l2.R2_BASE.endswith("/i-saps/level-2"))


class UnitCodes(unittest.TestCase):
    def setUp(self):
        self.seed = _load("isaps_l2_seed_units", "2026-10-23-isaps-level2-seed.py")

    def test_a_level_3_code_fits_level_3(self):
        for code, module in ((3101, 1), (3205, 2), (3906, 9)):
            with self.subTest(code=code):
                self.assertIsNone(self.seed.unit_code_problem(code, 3, module))

    def test_a_code_from_another_level_or_module_is_reported(self):
        self.assertRegex(self.seed.unit_code_problem(2101, 3, 1), "level 3")
        self.assertRegex(self.seed.unit_code_problem(3201, 3, 1), "module 1")

    def test_level_2_codes_still_fit_level_2(self):
        self.assertIsNone(self.seed.unit_code_problem(2101, 2, 1))


class StemOpeningWithACapital(unittest.TestCase):
    """Eight Level 3 exam items open "A Year 10 geography teacher, …" — "A", a space and a capital, which the
    option-line rule also accepts (for the Level 2 typo "D They feared…"). The stem was taken as option A, the real
    "A) …" folded into it, the stem came out empty and the item was refused (bd-arghnv.3's guard). A bare letter
    opens option A only when the item has no explicit "A." / "A)" line."""

    OPTS = "\nA) Qualification is dominant.\nB) Socialisation is dominant.\nC) Subjectification is dominant.\nD) None of these."

    def setUp(self):
        self.seed = _load("isaps_l2_seed_stems", "2026-10-23-isaps-level2-seed.py")

    def test_a_stem_opening_A_Year_stays_the_stem(self):
        for first in ("A Year 10 geography teacher, Mr. Tariq, plans a unit.",
                      "A Grade 5 class runs a survey.",
                      "A Head Teacher observes a lesson."):
            with self.subTest(first=first):
                text = first + "\nWhich purpose dominates?" + self.OPTS
                stem, opts = self.seed.split_options(text)
                self.assertEqual(stem, first + "\nWhich purpose dominates?")
                self.assertEqual([o[0] for o in opts], ["A", "B", "C", "D"])
                self.assertEqual(opts[0][1], "Qualification is dominant.")
                self.assertIsNone(self.seed.item_problem(stem, opts, "1", "MCQ"))

    def test_the_level_2_typos_still_parse(self):
        stem, opts = self.seed.split_options("Why did they stop?\nA. They were tired\nB.To achieve more\nC. They left\nD They feared failure")
        self.assertEqual(stem, "Why did they stop?")
        self.assertEqual([o[1] for o in opts], ["They were tired", "To achieve more", "They left", "They feared failure"])

    def test_a_bare_A_option_still_counts_when_nothing_else_is_option_A(self):
        stem, opts = self.seed.split_options("Pick one.\nA They were tired\nB. More\nC. Left\nD. Feared")
        self.assertEqual(stem, "Pick one.")
        self.assertEqual(opts[0], ("A", "They were tired"))


class DoubledOptionMarker(unittest.TestCase):
    """Level 3 Module 6 exam item 6.5 reads "B) A) He demonstrates agentic engagement…": the teacher would see a
    stray "A)" under option B. A second marker at the start of an option is the partner's typo; it is dropped."""

    def setUp(self):
        self.seed = _load("isaps_l2_seed_doubled", "2026-10-23-isaps-level2-seed.py")

    def test_a_doubled_marker_is_dropped(self):
        _, opts = self.seed.split_options("Which?\nA) Behavioural\nB) A) Agentic engagement\nC) Cognitive\nD) Emotional")
        self.assertEqual([o[1] for o in opts], ["Behavioural", "Agentic engagement", "Cognitive", "Emotional"])

    def test_an_option_that_merely_starts_with_a_letter_word_is_kept(self):
        _, opts = self.seed.split_options("Which?\nA. A teacher\nB. B. F. Skinner's view\nC. A) is right\nD. Done")
        # Only a ")" marker is a doubled marker; "B. F. Skinner" is a name.
        self.assertEqual([o[1] for o in opts], ["A teacher", "B. F. Skinner's view", "is right", "Done"])


class SummativeFile(unittest.TestCase):
    def setUp(self):
        self.seed = _load("isaps_l2_seed_files", "2026-10-23-isaps-level2-seed.py")

    def test_both_spellings_of_the_summative_bank_are_found(self):
        for name in ("3. Summative Assessment Questions - Module 1 Level 3.xlsx",
                     "3. Summative Assessments Questions - Module 2 Level 3.xlsx"):
            with self.subTest(name=name):
                files = ["2. Formative Assessment Questions - Module 1 Level 3.xlsx", name,
                         "4. Summative CRQ Assessment Items Bank - Module 1 Level 3.docx"]
                self.assertEqual(self.seed.pick_summative(files), [name])

    def test_the_level_1_name_is_still_found(self):
        files = ["Formative.xlsx", "Summative MCQ Items Bank - Module 1.xlsx", "CRQ.docx"]
        self.assertEqual(self.seed.pick_summative(files), ["Summative MCQ Items Bank - Module 1.xlsx"])

    def test_the_crq_document_is_never_taken_for_the_mcq_bank(self):
        self.assertEqual(self.seed.pick_summative(["4. Summative CRQ Assessment Items Bank - Module 1 Level 3.docx"]), [])


if __name__ == "__main__":
    unittest.main()
