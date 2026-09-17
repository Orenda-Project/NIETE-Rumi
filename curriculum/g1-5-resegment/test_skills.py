"""skills — one vocabulary per subject, and the ways that has silently failed.

This module is the taxonomy the whole matrix is drawn from: the label in the
`Skill type` column, the two-letter chip in the day grid, the colour of both,
and the gloss in the legend. Nothing downstream validates it. Every defect it
has had was invisible in the build and visible only on the finished sheet.

The three that actually happened, each with a test below:

  1. A CODE COLLISION ATE A LEGEND ROW. `review_assess` and `assessment` both
     carried "AX". The legend is keyed by code, so one of the two disappeared
     from it while its chips went on appearing in the grid — a chip with no
     entry in the legend, which is the one thing a legend may not allow. The
     collision only mattered because Science teaches both; a code clash
     between two subjects that never share a tab is harmless. So the promise
     is per subject, not global.
  2. AN ALIASED URDU KEY LOOKED UP RAW. Urdu writes revision as `duhrai`;
     Grade 5 Urdu arrived tagged `revision`. `SKILL["revision"]` exists, so
     nothing raised — the row simply took the English label and the English
     colour on an otherwise Urdu tab. Every accessor here canonicalises for
     that reason, and each is tested for it separately, because a helper that
     forgets is not detectable from its return value.
  3. A SKILL IN `ORDER` THAT `SKILL` DOES NOT DEFINE. ORDER is hand-edited.
     An entry with no definition falls through `label`'s raw-key path and
     prints `Review_assess` with no colour, beside eight coloured rows.

Also asserted: `rgb` returns Sheets' 0-1 floats and not 0-255 (Sheets clamps
above 1, so every chip would come out white), and `chip_requests` emits one
request per contiguous run INCLUDING the run that ends on the last row — the
loop runs one index past the end for exactly that reason, and dropping it
leaves the bottom of every column unpainted.
"""
import unittest

import skills


class EveryKeyASubjectMayUseIsFullyDefined(unittest.TestCase):

    def test_every_key_in_order_has_a_skill_entry(self):
        # Missing, it prints as a raw underscored key with no colour.
        for subject, keys in skills.ORDER.items():
            for key in keys:
                self.assertIn(skills.canonical(key, subject), skills.SKILL,
                              f"{subject} may use {key}, SKILL omits it")

    def test_every_key_in_order_has_a_two_letter_chip(self):
        # `code` falls back to the first two letters, which is silent and
        # produces chips like "BU" that match nothing in the legend.
        for subject, keys in skills.ORDER.items():
            for key in keys:
                self.assertIn(skills.canonical(key, subject), skills.CODE,
                              f"{subject}/{key} has no chip of its own")

    def test_every_key_in_order_has_a_gloss_for_the_legend(self):
        # The legend's third column explains what the day actually is. Blank
        # there and the legend is a colour swatch with no meaning attached.
        for subject, keys in skills.ORDER.items():
            for key in keys:
                self.assertTrue(skills.gloss(key, subject).strip(),
                                f"{subject}/{key} has no gloss")

    def test_every_key_in_order_has_a_colour(self):
        for subject, keys in skills.ORDER.items():
            for key in keys:
                self.assertTrue(skills.colour(key, subject),
                                f"{subject}/{key} would paint white")

    def test_no_subject_lists_the_same_skill_twice(self):
        for subject, keys in skills.ORDER.items():
            canon = [skills.canonical(k, subject) for k in keys]
            self.assertEqual(len(canon), len(set(canon)), subject)


class NoTwoSkillsOnOneTabShareAChip(unittest.TestCase):
    """The legend is keyed by code. Two keys, one code, one legend row."""

    def test_each_subjects_chips_are_unique_within_that_subject(self):
        # Science is the case that bit: a chapter-close review-and-check day
        # AND a separate formative assessment day, both "AX".
        for subject, keys in skills.ORDER.items():
            codes = [skills.code(k, subject) for k in keys]
            dupes = {c for c in codes if codes.count(c) > 1}
            self.assertEqual(dupes, set(), f"{subject} chips collide: {dupes}")

    def test_a_chip_is_never_wider_than_the_column_that_holds_it(self):
        # The day grid column is 30px: two characters and nothing more. A
        # third character is not clipped, it wraps and shoves the row down.
        for key, chip in skills.CODE.items():
            self.assertTrue(1 <= len(chip) <= 2, f"{key} -> {chip!r}")

    def test_no_two_skills_print_the_same_label(self):
        # `KEY_BY_LABEL` and `LABEL_COLOUR` are built by label. A duplicate
        # label silently drops one key from both, so `chip_requests` paints
        # the other key's colour over it.
        labels = [spec[0] for spec in skills.SKILL.values()]
        dupes = {lbl for lbl in labels if labels.count(lbl) > 1}
        self.assertEqual(dupes, set(), f"duplicate labels: {dupes}")
        self.assertEqual(len(skills.KEY_BY_LABEL), len(skills.SKILL))


class AnAliasedKeyIsResolvedByEveryAccessorNotJustSome(unittest.TestCase):
    """`SKILL["revision"]` exists, so a forgotten canonicalise never raises."""

    def test_the_urdu_label_is_urdu_even_when_the_day_says_revision(self):
        self.assertEqual(skills.label("revision", "Urdu"),
                         skills.label("duhrai", "Urdu"))

    def test_the_urdu_colour_is_the_urdu_colour(self):
        # The docstring on `colour` names this: a raw lookup paints it white
        # and the tab loses two colours out of nine.
        self.assertEqual(skills.colour("assessment", "Urdu"),
                         skills.colour("jaiza", "Urdu"))

    def test_the_urdu_chip_is_the_urdu_chip(self):
        self.assertEqual(skills.code("revision", "Urdu"), "DH")
        self.assertEqual(skills.code("assessment", "Urdu"), "JZ")

    def test_the_urdu_gloss_comes_from_the_urdu_entry(self):
        self.assertEqual(skills.gloss("revision", "Urdu"),
                         skills.gloss("duhrai", "Urdu"))

    def test_the_same_key_in_another_subject_is_left_alone(self):
        # The alias is scoped to Urdu. Applied globally it would rewrite
        # English and Maths revision days into Urdu.
        self.assertEqual(skills.canonical("revision", "Maths"), "revision")
        self.assertEqual(skills.label("revision", "English"), "Revision")

    def test_canonicalising_twice_changes_nothing(self):
        # Callers canonicalise at different depths; if one pass were not
        # enough, whether a row was right would depend on the call path.
        for (subject, key), target in skills.ALIAS.items():
            self.assertEqual(skills.canonical(target, subject), target)
            self.assertEqual(
                skills.canonical(skills.canonical(key, subject), subject),
                target)

    def test_every_alias_points_at_a_key_that_subject_may_actually_use(self):
        # An alias onto a key missing from that subject's ORDER moves the day
        # somewhere no loop over ORDER will ever find it.
        for (subject, _key), target in skills.ALIAS.items():
            self.assertIn(target, skills.ORDER[subject])

    def test_no_order_entry_is_itself_an_alias(self):
        # ORDER must already be canonical, or a tab built straight from it
        # shows the pre-alias vocabulary the alias exists to remove.
        for subject, keys in skills.ORDER.items():
            for key in keys:
                self.assertEqual(skills.canonical(key, subject), key,
                                 f"{subject} lists the aliased form {key}")


class AnUnknownKeyDegradesInsteadOfRaising(unittest.TestCase):
    """The corpus is hand-tagged; a typo may not take the build down."""

    def test_an_unknown_key_prints_as_readable_text(self):
        self.assertEqual(skills.label("mental_maths", "Maths"),
                         "Mental maths")

    def test_an_empty_key_prints_nothing_rather_than_none(self):
        # A day with no skill type is a real row. "None" in the cell reads as
        # a value; blank reads as absent, which is the truth.
        for value in ("", None):
            self.assertEqual(skills.label(value), "")
            self.assertEqual(skills.code(value), "")

    def test_an_unknown_key_has_no_colour_rather_than_a_wrong_one(self):
        # Better an unpainted cell than one borrowing another skill's colour,
        # which would read as a skill it is not.
        self.assertIsNone(skills.colour("mental_maths", "Maths"))

    def test_an_unknown_key_still_gets_a_chip_to_put_in_the_grid(self):
        self.assertEqual(skills.code("mental_maths", "Maths"), "ME")


class TheColoursAreInTheUnitsSheetsExpects(unittest.TestCase):

    def test_every_colour_is_a_six_digit_hex(self):
        for key, spec in skills.SKILL.items():
            self.assertRegex(spec[1], r"^#[0-9A-Fa-f]{6}$", key)

    def test_rgb_returns_fractions_not_bytes(self):
        # Sheets clamps anything above 1. Handing it 0-255 makes every chip
        # pure white, and the API returns 200 either way.
        for spec in skills.SKILL.values():
            for channel in skills.rgb(spec[1]).values():
                self.assertGreaterEqual(channel, 0)
                self.assertLessEqual(channel, 1)

    def test_rgb_reads_the_channels_in_the_right_order(self):
        # A red/blue swap is invisible on the pale end of this palette, where
        # most of it sits, and glaring on the two saturated colours.
        self.assertEqual(skills.rgb("#FF0000"),
                         {"red": 1.0, "green": 0.0, "blue": 0.0})
        self.assertEqual(skills.rgb("#0000FF"),
                         {"red": 0.0, "green": 0.0, "blue": 1.0})

    def test_it_reads_a_hex_string_with_or_without_the_hash(self):
        self.assertEqual(skills.rgb("00FF00"), skills.rgb("#00FF00"))


class ChipRequestsPaintEveryRunAndOnlyKnownLabels(unittest.TestCase):

    def column(self, labels, col=2, width=4):
        """A values grid with `labels` down column `col`, row 0 a header."""
        rows = [[""] * width for _ in range(len(labels) + 1)]
        for i, text in enumerate(labels):
            rows[i + 1][col] = text
        return rows

    def ranges(self, reqs):
        return [(r["repeatCell"]["range"]["startRowIndex"],
                 r["repeatCell"]["range"]["endRowIndex"]) for r in reqs]

    def test_a_run_of_the_same_label_is_one_request_not_one_per_row(self):
        # The calendar is ~190 rows a subject. One request per row is tens of
        # thousands of requests and a batchUpdate that times out.
        concrete = skills.label("concrete", "Maths")
        reqs = skills.chip_requests(7, self.column([concrete] * 30), 2)
        self.assertEqual(len(reqs), 1)
        self.assertEqual(self.ranges(reqs), [(1, 31)])

    def test_the_run_that_ends_on_the_last_row_is_still_emitted(self):
        # The loop deliberately runs one index past the end to close the
        # final run. Without that the bottom block of every column is left
        # unpainted, and it is the block nobody scrolls to in review.
        a, b = skills.label("concrete"), skills.label("pictorial")
        reqs = skills.chip_requests(7, self.column([a, a, b, b]), 2)
        self.assertEqual(self.ranges(reqs), [(1, 3), (3, 5)])

    def test_an_unknown_label_breaks_the_run_and_is_left_unpainted(self):
        # Painting through it would give a mistyped day the colour of the day
        # above it, which is how a wrong row looks right.
        a = skills.label("concrete")
        reqs = skills.chip_requests(7, self.column([a, "typo", a]), 2)
        self.assertEqual(self.ranges(reqs), [(1, 2), (3, 4)])

    def test_two_adjacent_skills_sharing_a_colour_are_one_run(self):
        # `tafheem` and `buland_khwani` are both BLUE. Splitting them would
        # emit two identical-colour requests for no reason; merging them is
        # correct and is what the colour-keyed run does.
        a = skills.label("buland_khwani", "Urdu")
        b = skills.label("tafheem", "Urdu")
        self.assertEqual(skills.colour("buland_khwani"),
                         skills.colour("tafheem"))
        reqs = skills.chip_requests(7, self.column([a, b]), 2)
        self.assertEqual(self.ranges(reqs), [(1, 3)])

    def test_it_paints_the_column_it_was_given_and_no_other(self):
        # The skill-type column moves between tabs. Off by one and the chips
        # land on the SLO column, which is the widest thing on the sheet.
        reqs = skills.chip_requests(7, self.column([skills.label("writing")],
                                                   col=3), 3)
        rng = reqs[0]["repeatCell"]["range"]
        self.assertEqual((rng["startColumnIndex"], rng["endColumnIndex"]),
                         (3, 4))
        self.assertEqual(rng["sheetId"], 7)

    def test_it_starts_where_it_is_told_and_never_paints_the_header(self):
        a = skills.label("concrete")
        rows = self.column([a, a], col=2)
        rows[0][2] = a                       # a header that looks like a day
        reqs = skills.chip_requests(7, rows, 2, first_row=1)
        self.assertEqual(self.ranges(reqs), [(1, 3)])

    def test_an_empty_column_asks_for_nothing(self):
        self.assertEqual(skills.chip_requests(7, self.column(["", ""]), 2), [])

    def test_it_only_ever_writes_the_background_colour(self):
        # This runs after the text is written. A wider `fields` mask would
        # clear the bold, the borders and the wrap the previous pass set.
        reqs = skills.chip_requests(7, self.column([skills.label("writing")]),
                                    2)
        self.assertEqual(reqs[0]["repeatCell"]["fields"],
                         "userEnteredFormat.backgroundColor")


class TheCpaRampIsTheMathsVocabularyAndNotASecondCopy(unittest.TestCase):

    def test_every_cpa_key_is_a_maths_skill_type(self):
        # The old matrix carried CPA phase as a separate column and the two
        # copies disagreed on 42 days. CPA is derived from the skill type
        # here; a key outside Maths' ORDER would be a third copy.
        for key in skills.CPA_FROM_SKILL:
            self.assertIn(key, skills.ORDER["Maths"])

    def test_it_names_only_the_three_real_phases(self):
        self.assertEqual(set(skills.CPA_FROM_SKILL.values()),
                         {"concrete", "pictorial", "abstract"})

    def test_every_maths_teaching_key_that_has_a_phase_declares_it(self):
        # The five CPA keys are the ramp; the rest of Maths' ORDER is
        # gap-fill and bookkeeping, which have no phase by design.
        ramp = {"concrete", "pictorial", "pictorial_abstract", "abstract",
                "word_problem"}
        self.assertEqual(set(skills.CPA_FROM_SKILL), ramp)


if __name__ == "__main__":
    unittest.main()
