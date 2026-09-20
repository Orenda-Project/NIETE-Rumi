"""Stage C enrichment — vocabulary and derivation gate.

Red-first for bd-20n98. Every rule here is one a worker can violate silently,
so each gets a test that fails loudly on the violation, not just on the happy path.
"""
import unittest

import stagec


def moves(*pairs):
    return stagec.format_moves(list(pairs))


FORTY = [("warm_up", 5), ("hook", 5), ("announce", 5), ("explain", 3),
         ("explain", 2), ("guided", 4), ("guided", 4), ("independent", 5),
         ("independent", 4), ("exit", 3)]


class TheMoveSpine(unittest.TestCase):
    def test_a_well_formed_spine_round_trips(self):
        self.assertEqual(stagec.parse_moves(stagec.format_moves(FORTY)), FORTY)

    def test_the_spine_must_account_for_the_whole_period(self):
        short = FORTY[:-1]
        self.assertIn("40", " ".join(stagec.check_moves(stagec.format_moves(short))))

    def test_a_spine_summing_past_forty_is_a_segmentation_defect_not_a_rounding_one(self):
        over = FORTY + [("homework", 4)]
        self.assertTrue(stagec.check_moves(stagec.format_moves(over)))

    def test_fewer_than_ten_moves_is_refused(self):
        nine = [("warm_up", 5), ("hook", 5), ("announce", 5), ("explain", 5),
                ("guided", 4), ("guided", 4), ("independent", 5),
                ("independent", 4), ("exit", 3)]
        self.assertEqual(sum(m for _, m in nine), 40)
        self.assertTrue(stagec.check_moves(stagec.format_moves(nine)))

    def test_more_than_fifteen_moves_is_refused(self):
        many = [("guided", 2)] * 16
        self.assertTrue(stagec.check_moves(stagec.format_moves(many)))

    def test_an_invented_phase_is_refused(self):
        bad = stagec.format_moves(FORTY).replace("hook", "settle")
        self.assertTrue(stagec.check_moves(bad))

    def test_pending_is_not_a_spine(self):
        self.assertTrue(stagec.check_moves("pending"))

    def test_every_phase_the_extractor_emits_is_accepted(self):
        for phase in stagec.PHASES:
            self.assertIn(phase, stagec.PHASES)
            self.assertTrue(stagec._weight(phase) in (0.0, 0.5, 1.0))


class TeacherPrimaryMinutes(unittest.TestCase):
    def test_it_is_derived_from_the_moves_never_defaulted(self):
        # explain 3+2 = 5 full; warm_up 5 + hook 5 + announce 5 = 15 shared -> 7.5
        self.assertEqual(stagec.teacher_primary_min(FORTY), 12)

    def test_the_specs_own_reference_day_lands_on_its_own_ceiling(self):
        """The calibration. Spec table: opening 5 "partly", I Do 8 "yes",
        We Do 10 / You Do 12 / Exit 3 "no", buffer 2, ceiling <=10 min.
        If this stops equalling the ceiling exactly, a weight has drifted."""
        spec_day = [("warm_up", 3), ("hook", 2), ("explain", 4), ("explain", 4),
                    ("guided", 5), ("guided", 5), ("independent", 4),
                    ("independent", 4), ("independent", 4), ("exit", 3),
                    ("homework", 2)]
        self.assertEqual(sum(m for _, m in spec_day), stagec.PERIOD_MIN)
        self.assertEqual(stagec.teacher_primary_min(spec_day),
                         stagec.TEACHER_PRIMARY_CEILING)

    def test_student_phases_contribute_nothing(self):
        only = [("guided", 20), ("independent", 20)]
        self.assertEqual(stagec.teacher_primary_min(only), 0)

    def test_shared_phases_count_half(self):
        self.assertEqual(stagec.teacher_primary_min([("warm_up", 10)]), 5)

    def test_a_teacher_led_day_breaches_the_ceiling(self):
        led = [("explain", 20), ("announce", 6), ("guided", 4), ("independent", 7),
               ("exit", 3)]
        self.assertGreater(stagec.teacher_primary_min(led),
                           stagec.TEACHER_PRIMARY_CEILING)
        self.assertTrue(stagec.check_teacher_primary(stagec.format_moves(led),
                                                     stagec.teacher_primary_min(led)))

    def test_a_declared_value_that_disagrees_with_the_spine_is_refused(self):
        self.assertTrue(stagec.check_teacher_primary(stagec.format_moves(FORTY), 8))

    def test_announce_is_shared_not_teacher_primary(self):
        """"Set the task" organises the room; it is not instruction."""
        self.assertEqual(stagec._weight("announce"), 0.5)
        self.assertEqual(stagec._weight("explain"), 1.0)

    def test_a_non_numeric_declaration_is_refused(self):
        self.assertTrue(stagec.check_teacher_primary(stagec.format_moves(FORTY),
                                                     "pending"))


class TheControlledVocabularies(unittest.TestCase):
    def test_interaction_takes_only_the_matrix_values(self):
        self.assertFalse(stagec.check_enum("Interaction", "pair"))
        self.assertTrue(stagec.check_enum("Interaction", "pairs"))

    def test_gap_is_a_separate_question_from_interaction(self):
        self.assertFalse(stagec.check_enum("Gap", "two-way"))
        self.assertTrue(stagec.check_enum("Gap", "pair"))

    def test_a_high_medium_low_scale_is_refused_outright(self):
        for v in ("high", "medium", "low"):
            self.assertTrue(stagec.check_enum("Interaction", v))
            self.assertTrue(stagec.check_enum("Gap", v))

    def test_reading_strategy_admits_an_explicit_not_applicable(self):
        self.assertFalse(stagec.check_enum("Reading strategy", "n/a"))
        self.assertFalse(stagec.check_enum("Reading strategy", "infer"))

    def test_collaboration_refuses_free_text(self):
        self.assertTrue(stagec.check_enum("Collaboration structure",
                                          "children work together nicely"))

    def test_blank_is_refused_on_a_day_row(self):
        self.assertTrue(stagec.check_enum("Interaction", ""))


class TheSpeakingListeningFloor(unittest.TestCase):
    """A Speaking/Listening day may not be individual or teacher-fronted."""

    def test_a_speaking_day_may_not_be_taught_individually(self):
        self.assertTrue(stagec.check_oral_floor("Oral communication", "individual",
                                                stagec.format_moves(FORTY)))

    def test_a_speaking_day_may_not_be_teacher_fronted(self):
        self.assertTrue(stagec.check_oral_floor("Oral communication",
                                                "teacher↔class",
                                                stagec.format_moves(FORTY)))

    def test_a_speaking_day_in_pairs_passes(self):
        self.assertFalse(stagec.check_oral_floor("Oral communication", "pair",
                                                 stagec.format_moves(FORTY)))

    def test_a_writing_day_may_be_individual(self):
        self.assertFalse(stagec.check_oral_floor("Writing", "individual",
                                                 stagec.format_moves(FORTY)))

    def test_five_minutes_of_child_production_is_the_floor(self):
        thin = [("warm_up", 5), ("hook", 5), ("announce", 5), ("explain", 5),
                ("explain", 5), ("explain", 5), ("explain", 4), ("explain", 3),
                ("guided", 2), ("exit", 1)]
        self.assertEqual(sum(m for _, m in thin), 40)
        self.assertTrue(stagec.check_oral_floor("Oral communication", "pair",
                                                stagec.format_moves(thin)))


class WhichRowsTakeWhichColumns(unittest.TestCase):
    def test_a_day_row_takes_every_column(self):
        self.assertEqual(stagec.columns_for("day", "English"), stagec.LANG_COLUMNS)
        self.assertEqual(stagec.columns_for("day", "Maths"), stagec.CORE_COLUMNS)

    def test_an_assessment_row_takes_moves_and_nothing_else(self):
        self.assertEqual(stagec.columns_for("assessment", "English"), ("Moves",))

    def test_a_review_row_takes_moves_and_nothing_else(self):
        self.assertEqual(stagec.columns_for("review", "Maths"), ("Moves",))

    def test_a_banner_row_takes_nothing(self):
        self.assertEqual(stagec.columns_for("grade_banner", "English"), ())
        self.assertEqual(stagec.columns_for("chapter_header", "Urdu"), ())

    def test_the_language_tabs_carry_four_columns_the_core_tabs_do_not(self):
        extra = set(stagec.LANG_COLUMNS) - set(stagec.CORE_COLUMNS)
        self.assertEqual(extra, {"Function", "Interaction", "Gap", "Recycles"})

    def test_strand_is_never_written_by_stage_c(self):
        self.assertNotIn("Strand", stagec.LANG_COLUMNS)
        self.assertNotIn("Strand", stagec.CORE_COLUMNS)


class TheRowGrammar(unittest.TestCase):
    """Column A alone decides the row kind.

    An earlier classifier also tested the Topic column, and every
    "Chapter 3 Assessment Worksheet" row was silently reclassified as a
    chapter header -- 171 rows dropped out of a 1,923-row census without
    an error. These tests pin column A as the only witness.
    """

    def test_a_teaching_day(self):
        self.assertEqual(stagec.classify_row("Day 12"), "day")

    def test_a_chapter_header(self):
        self.assertEqual(stagec.classify_row("Chapter 3: Hello Friends"), "chapter_header")

    def test_a_grade_banner(self):
        self.assertEqual(stagec.classify_row("GRADE 2"), "grade_banner")

    def test_an_assessment_row(self):
        self.assertEqual(stagec.classify_row("\u2705 Ch. Assessment"), "assessment")

    def test_a_review_row(self):
        self.assertEqual(stagec.classify_row("\U0001f4cb Ch. Review"), "review")

    def test_an_assessment_row_is_not_a_chapter_header(self):
        """The regression that cost 171 rows. Topic is not consulted."""
        self.assertEqual(
            stagec.classify_row("\u2705 Ch. Assessment",
                                topic="Chapter 3 Assessment Worksheet \u2014 'Hello'"),
            "assessment")

    def test_a_blank_row_is_not_a_row(self):
        self.assertIsNone(stagec.classify_row(""))
        self.assertIsNone(stagec.classify_row("   "))

    def test_an_unrecognised_form_is_refused_not_guessed(self):
        self.assertIsNone(stagec.classify_row("Week 4 catch-up"))

    def test_only_day_rows_take_the_full_column_set(self):
        for kind in ("assessment", "review"):
            self.assertEqual(stagec.columns_for(kind, "English"), ("Moves",))
        for kind in ("grade_banner", "chapter_header"):
            self.assertEqual(stagec.columns_for(kind, "English"), ())


class PrerequisiteSlos(unittest.TestCase):
    def test_a_cited_code_must_have_been_taught_earlier(self):
        earlier = {"E-01-A-01", "E-01-A-02"}
        self.assertFalse(stagec.check_prereq("E-01-A-01", earlier))
        self.assertTrue(stagec.check_prereq("E-01-B-09", earlier))

    def test_the_first_day_of_a_grade_may_honestly_have_none(self):
        self.assertFalse(stagec.check_prereq("none", set()))

    def test_pending_is_not_an_answer(self):
        self.assertTrue(stagec.check_prereq("pending", {"E-01-A-01"}))

    def test_several_codes_are_each_checked(self):
        earlier = {"E-01-A-01"}
        self.assertTrue(stagec.check_prereq("E-01-A-01, E-09-Z-99", earlier))


if __name__ == "__main__":
    unittest.main()
