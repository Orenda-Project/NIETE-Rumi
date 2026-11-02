"""bd-arghnv.3 — I-SAPS Level 2 questions seeded with a blank stem.

Two scripts are pinned here, both pure (no database):

  scripts/migrations/2026-10-23-isaps-level2-seed.py
      split_options read a stem line that opens "A teacher…", "After…", "At…" as option A, because the dot and the
      space after the option letter were both optional. The stem lost its "A", the real "A. …" line was folded into
      it as a continuation, and 43 items went in with question_text ''. The option line now needs "A." / "A)" or
      the letter, a space and a capital/digit; an item whose stem comes out empty is refused.

  scripts/migrations/2026-11-02-isaps-l2-blank-stem-repair.py
      Rebuilds the 43 from what the rows still hold: options[0] is "<stem minus its A> A. <option A>".

Run: python3 -m unittest scripts/tests/test_isaps_level2_blank_stem.py   (or pytest scripts/tests/test_isaps_level2_blank_stem.py)

The fixtures are made-up items in the source's shape, not the partner's text.
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


seed = _load("isaps_l2_seed", "2026-10-23-isaps-level2-seed.py")
repair = _load("isaps_l2_repair", "2026-11-02-isaps-l2-blank-stem-repair.py")

OPTS = "\nA. When the bell rang\nB. When the group work began\nC. When notes went on the board\nD. When the lesson ended"


class SeedOptionParser(unittest.TestCase):
    """split_options: one option per line, and a stem word that starts with A is still the stem."""

    def test_a_stem_that_opens_with_an_A_word_stays_the_stem(self):
        for stem in ("At what point did the students start asking questions?",
                     "A teacher plans a lesson on fractions. What should she do first?",
                     "After the quiz, what does the teacher look at?",
                     "According to the unit, which practice builds trust?",
                     "An observer sits at the back of the room. What does she note?",
                     "Anticipating a hard question, the teacher pauses. Why?"):
            with self.subTest(stem=stem):
                got_stem, opts = seed.split_options(stem + OPTS)
                self.assertEqual(got_stem, stem)
                self.assertEqual([o[0] for o in opts], ["A", "B", "C", "D"])
                self.assertEqual(opts[0][1], "When the bell rang")

    def test_the_two_known_source_typos_still_parse(self):
        # 'D They feared…' has no full stop; 'B.To achieve…' has no space after it.
        stem, opts = seed.split_options("Why did they stop?\nA. They were tired\nB.To achieve more\nC. They left\nD They feared failure")
        self.assertEqual(stem, "Why did they stop?")
        self.assertEqual(opts, [("A", "They were tired"), ("B", "To achieve more"), ("C", "They left"), ("D", "They feared failure")])

    def test_a_closing_parenthesis_marks_an_option(self):
        _, opts = seed.split_options("Pick one.\nA) one\nB) two\nC) three\nD) four")
        self.assertEqual([o[1] for o in opts], ["one", "two", "three", "four"])

    def test_a_bare_letter_before_a_lowercase_word_is_not_an_option(self):
        self.assertIsNone(seed.OPT_LINE.match("A teacher gives feedback"))
        self.assertIsNone(seed.OPT_LINE.match("At what point"))
        self.assertIsNotNone(seed.OPT_LINE.match("D They feared failure"))
        self.assertIsNotNone(seed.OPT_LINE.match("C 25 students"))

    def test_an_item_with_an_empty_stem_is_refused(self):
        stem, opts = seed.split_options(OPTS.strip())
        self.assertEqual(stem, "")
        self.assertRegex(seed.item_problem(stem, opts, "1", "MCQ"), "empty stem")

    def test_a_well_formed_item_has_no_problem(self):
        stem, opts = seed.split_options("At what point did it change?" + OPTS)
        self.assertIsNone(seed.item_problem(stem, opts, "2", "MCQ"))

    def test_the_older_refusals_still_hold(self):
        stem, opts = seed.split_options("Q?" + OPTS)
        self.assertRegex(seed.item_problem(stem, opts, "2", "CRQ"), "type")
        self.assertRegex(seed.item_problem(stem, opts[:3], "2", "MCQ"), "options parsed")
        self.assertRegex(seed.item_problem(stem, opts, None, "MCQ"), "answer key")


def glued(stem_without_a, option_a):
    """options[0] exactly as the old parser wrote it."""
    return f"{stem_without_a} A. {option_a}"


REST = ["When the group work began", "When notes went on the board", "When the lesson ended"]


class RepairRule(unittest.TestCase):
    """repair_row: question_text = A + the text before ' A. ', options[0] = the text after it."""

    def test_a_word_that_lost_its_first_letter_is_joined_back(self):
        for cut, whole in (("fter", "After"), ("ccording", "According"), ("t", "At"), ("n", "An"),
                           ("nticipating", "Anticipating")):
            with self.subTest(word=whole):
                row = {"id": 1, "question_text": "", "options": [glued(f"{cut} the quiz, what changed?", "When the bell rang")] + REST}
                stem, opts = repair.repair_row(row)
                self.assertEqual(stem, f"{whole} the quiz, what changed?")
                self.assertEqual(opts, ["When the bell rang"] + REST)

    def test_a_noun_gets_the_article_back_with_a_space(self):
        for noun in ("teacher", "student", "school", "principal", "university", "purposeful"):
            with self.subTest(word=noun):
                row = {"id": 2, "question_text": "", "options": [glued(f"{noun} plans a lesson. What next?", "Ask a question")] + REST}
                stem, opts = repair.repair_row(row)
                self.assertEqual(stem, f"A {noun} plans a lesson. What next?")
                self.assertEqual(opts[0], "Ask a question")

    def test_options_b_to_d_and_their_order_are_untouched(self):
        row = {"id": 3, "question_text": "", "options": [glued("teacher asks why.", "x")] + REST}
        _, opts = repair.repair_row(row)
        self.assertEqual(opts[1:], REST)

    def test_rows_that_do_not_fit_are_refused_with_a_reason(self):
        cases = {
            "two ' A. ' markers": glued("teacher asks A. or B.", "x"),
            "no ' A. ' marker": "teacher asks what?",
            "starts with a capital": glued("Teacher asks what?", "x"),
            "first word not in the reviewed lists": glued("nother teacher asks?", "x"),
            "nothing before the marker": " A. x",
            "nothing after the marker": "teacher asks? A. ",
        }
        for why, a0 in cases.items():
            with self.subTest(why=why):
                with self.assertRaises(repair.Refuse):
                    repair.repair_row({"id": 4, "question_text": "", "options": [a0] + REST})

    def test_a_row_without_four_options_is_refused(self):
        with self.assertRaises(repair.Refuse):
            repair.repair_row({"id": 5, "question_text": "", "options": [glued("teacher asks?", "x")]})

    def test_a_row_that_already_has_a_stem_is_left_alone(self):
        with self.assertRaises(repair.AlreadyHasStem):
            repair.repair_row({"id": 6, "question_text": "A teacher asks?", "options": ["x"] + REST})

    def test_a_glued_tail_goes_back_under_the_stem(self):
        # Same bug, two M4 rows: the stem's LAST line ("According to …") was read as option A.
        row = {"id": 7, "question_text": "Students type a report instead of writing it by hand.",
               "options": [glued("ccording to the framework, this is an example of:", "Modification")] + REST}
        stem, opts = repair.repair_tail(row)
        self.assertEqual(stem, "Students type a report instead of writing it by hand.\n"
                               "According to the framework, this is an example of:")
        self.assertEqual(opts, ["Modification"] + REST)


class RepairSql(unittest.TestCase):
    """render_sql: one guarded UPDATE, idempotent, quoting safe."""

    def setUp(self):
        self.rows = [
            {"id": 9001, "question_text": "", "options": [glued("t what point did it change?", "When the bell rang")] + REST},
            {"id": 9002, "question_text": "", "options": [glued("teacher's plan fails. Why?", "It's too long")] + REST},
            {"id": 9003, "question_text": "", "options": ["Teacher asks?"] + REST},       # refused: capital
        ]
        self.plan = repair.plan(self.rows)

    def test_the_plan_splits_fixed_from_refused(self):
        self.assertEqual([p["id"] for p in self.plan["fixed"]], [9001, 9002])
        self.assertEqual([p["id"] for p in self.plan["refused"]], [9003])

    def test_the_sql_touches_only_rows_still_blank_and_still_glued(self):
        sql = repair.render_sql(self.plan)
        self.assertIn("coalesce(btrim(q.question_text), '') = ''", sql)
        self.assertIn("q.options->>0 = v.was_option_a", sql)
        self.assertIn("jsonb_set(q.options, '{0}', to_jsonb(v.option_a))", sql)
        self.assertNotIn("9003", sql)
        self.assertTrue(sql.strip().startswith("--"))
        self.assertIn("BEGIN;", sql)
        self.assertIn("COMMIT;", sql)

    def test_single_quotes_are_doubled(self):
        sql = repair.render_sql(self.plan)
        self.assertIn("'A teacher''s plan fails. Why?'", sql)
        self.assertIn("'It''s too long'", sql)

    def test_glued_tails_are_proposed_but_written_only_when_asked(self):
        rows = self.rows + [{"id": 9004, "question_text": "Students type a report.",
                             "options": [glued("ccording to the framework:", "Modification")] + REST}]
        p = repair.plan(rows)
        self.assertEqual([t["id"] for t in p["tails"]], [9004])
        self.assertNotIn("9004", repair.render_sql(p))
        self.assertTrue(repair.review_rows(p)[2]["status"].startswith("PROPOSED"))
        sql = repair.render_sql(p, with_tails=True)
        self.assertIn("(9004::bigint", sql)
        self.assertIn("q.question_text = v.was_stem", sql)

    def test_line_breaks_come_from_the_source_only_when_the_words_match(self):
        row = {"id": 9010, "question_text": "", "correct_option": "2",
               "options": [glued("teacher asks a question. Why does she wait?", "To let them think")] + REST}
        key = (tuple(["To let them think"] + REST), "2")
        p = repair.plan([row])
        self.assertEqual(repair.with_source_line_breaks(p, {key: ["A teacher asks a question.\nWhy does she wait?"]}), 1)
        self.assertEqual(p["fixed"][0]["new_stem"], "A teacher asks a question.\nWhy does she wait?")
        p = repair.plan([row])   # different words in the source: the rule's text stands
        self.assertEqual(repair.with_source_line_breaks(p, {key: ["A teacher asks.\nWhy does she wait?"]}), 0)
        self.assertEqual(p["fixed"][0]["new_stem"], "A teacher asks a question. Why does she wait?")
        p = repair.plan([row])   # two source items with these options and key: ambiguous, left alone
        self.assertEqual(repair.with_source_line_breaks(p, {key: ["A teacher asks a question.\nWhy does she wait?"] * 2}), 0)

    def test_the_review_rows_carry_every_column_the_operator_reads(self):
        rows = repair.review_rows(self.plan)
        self.assertEqual(rows[0]["id"], 9001)
        self.assertEqual(rows[0]["question"], "At what point did it change?")
        self.assertEqual(rows[0]["option_a"], "When the bell rang")
        self.assertEqual(rows[0]["option_b"], REST[0])
        self.assertEqual(rows[-1]["status"].split(":")[0], "REFUSED")


if __name__ == "__main__":
    unittest.main()
