"""The ten minutes that belonged to no step — bd-p4ulq, render side.

The engine half of this bead is in `contentbudget`: routine minutes count toward
the period and are not charged to the content budget. That fixed what the GATE
believes. It did not fix what the TEACHER reads, and the teacher is the one the
Digital Coach is standing next to.

Measured on `grade_2_math_ch1_seg801` before this module existed:

    period_minutes: 40
      Opening           5
      Explanation       5
      We Do · You Do   17
      Check             0
      Homework          0
      sum of bars      27

Thirteen minutes with no bar, against a header that says 40. Three of them are
the exit ticket's own minutes, zeroed by `d0_close.conclusion`. The other ten
are the settling and the task-setting that no step ever named.

Amena, on why this is not a cosmetic complaint:

    "how do we explain to teachers that the LP is to be taken in 40 minutes, if
    we calculate till 30, teachers and digitial coach both will be striking the
    teacher down on moving too slow on the LP, there needs to be a balance
    within the LP"

So the test that matters in this file is not that a paragraph renders. It is
that the bars ADD UP TO THE HEADER. A teacher who is exactly on design must be
able to point at the page and be right.

WHY `paragraph` AND NOT A NEW BLOCK TYPE. The v9 block enum is a closed `oneOf`
of fifteen types in `bot/vendor/lp-v9/schema/lp_doc.schema.json`, and
`template.js` drops an unknown type with a warning rather than failing. A new
type would mean forking the vendored schema AND three copies of the renderer to
print two sentences. `paragraph` is already in the enum, already rendered at
`template.js:807`, and is absent from `wordbudget.CAPS`, so it is uncapped by
construction — which the routine text needs, because `key_points` (the house
pattern for a titled extra block) already sits at a median of 105 words against
its cap of 120 across all 36 basics artefacts.
"""

from __future__ import annotations

import unittest

import contentbudget
import d0_routine


def rstep(phase, minutes, action="Children come in, books out, open at page 12."):
    return {"phase": phase, "kind": "routine", "minutes": minutes, "action": action}


def body(*steps):
    return {"generated": {"warmUp": {"minutes": 5}, "steps": list(steps),
                          "exitTicket": {"minutes": 3}}}


class WhichSectionTheMinutesLandIn(unittest.TestCase):

    def test_settling_belongs_to_the_opening(self):
        g = body(rstep("Settle and open", 5))["generated"]
        self.assertEqual(d0_routine.minutes(g, "introduction"), 5)
        self.assertEqual(d0_routine.minutes(g, "development"), 0)

    def test_setting_the_task_belongs_to_the_explanation(self):
        # It is the teacher talking before any child starts, which is the
        # explanation beginning, not the warm-up ending.
        g = body(rstep("Set the task", 5))["generated"]
        self.assertEqual(d0_routine.minutes(g, "development"), 5)
        self.assertEqual(d0_routine.minutes(g, "introduction"), 0)

    def test_a_routine_phase_nobody_mapped_still_keeps_its_minutes(self):
        # The point of the bead is that no minute goes unowned. An unmapped
        # phase falls to the opening rather than falling off the page.
        g = body(rstep("Hand back the slates", 4))["generated"]
        self.assertEqual(d0_routine.minutes(g, "introduction"), 4)

    def test_a_teaching_step_is_never_routine_minutes(self):
        g = body({"phase": "I-Do", "minutes": 5})["generated"]
        self.assertEqual(d0_routine.minutes(g, "introduction"), 0)
        self.assertEqual(d0_routine.minutes(g, "development"), 0)

    def test_the_kind_is_matched_exactly(self):
        # Same rule as the engine: a typo must not silently move minutes.
        g = body({"phase": "Settle and open", "kind": "Routine", "minutes": 5})["generated"]
        self.assertEqual(d0_routine.minutes(g, "introduction"), 0)

    def test_it_reads_the_same_key_the_engine_reads(self):
        self.assertEqual(d0_routine.KIND, contentbudget.ROUTINE)


class WhatThePageShows(unittest.TestCase):

    def test_the_block_is_a_schema_legal_paragraph(self):
        b = d0_routine.block([rstep("Settle and open", 5)])
        self.assertEqual(b["type"], "paragraph")
        self.assertIn("id", b)

    def test_the_block_names_the_minutes_and_says_what_to_do(self):
        b = d0_routine.block([rstep("Settle and open", 5, "Books out, page 12.")])
        self.assertIn("5", b["text"])
        self.assertIn("Books out, page 12.", b["text"])
        self.assertIn("Settle and open", b["text"])

    def test_no_routine_steps_means_no_block_rather_than_an_empty_one(self):
        self.assertIsNone(d0_routine.block([]))

    def test_two_routine_steps_in_one_section_print_as_one_block(self):
        b = d0_routine.block([rstep("Settle and open", 3, "Line up."),
                              rstep("Hand out slates", 2, "One each.")])
        self.assertIn("Line up.", b["text"])
        self.assertIn("One each.", b["text"])


class TheBarsAddUpToTheHeader(unittest.TestCase):
    """The whole bead, stated as arithmetic."""

    def test_the_measured_shape_reconciles(self):
        # Settle 5 + warmUp 5 + Set the task 5 + I-Do 5 + We-Do 8 + You-Do 9
        # + exit 3 = 40, which is what the header prints.
        g = {"warmUp": {"minutes": 5},
             "steps": [rstep("Settle and open", 5),
                       rstep("Set the task", 5),
                       {"phase": "I-Do", "minutes": 5},
                       {"phase": "We-Do", "minutes": 8},
                       {"phase": "You-Do", "minutes": 9}],
             "exitTicket": {"minutes": 3},
             "duration_min": 40}
        opening = int(g["warmUp"]["minutes"]) + d0_routine.minutes(g, "introduction")
        development = 5 + d0_routine.minutes(g, "development")
        activity = 8 + 9
        check = int(g["exitTicket"]["minutes"])
        self.assertEqual(opening + development + activity + check, g["duration_min"])
        self.assertEqual(contentbudget.structural({"generated": g}), 40)


class TheHalfwayCheckpoint(unittest.TestCase):
    """Rule [3B]: say where the class should be halfway through.

    Amena's words: a teacher and a Digital Coach should not have to add up the
    minutes themselves to know whether the lesson is late. So the line is
    COMPUTED from the plan's own timeline rather than authored into it -- an
    authored line can disagree with the minutes above it, and across 36 lessons
    one of them eventually would.

    `flex_note` was the obvious home and is the wrong one: it is on every step
    already and renders nowhere.
    """

    def plan(self):
        return {"warmUp": {"minutes": 5},
                "steps": [rstep("Settle and open", 5),
                          rstep("Set the task", 5),
                          {"phase": "I-Do", "minutes": 5},
                          {"phase": "We-Do", "minutes": 8},
                          {"phase": "You-Do", "minutes": 9}],
                "exitTicket": {"minutes": 3},
                "duration_min": 40}

    def test_the_proven_phase_plan_puts_minute_twenty_at_the_we_do(self):
        # 5 settle + 5 warm + 5 task + 5 I-Do = 20, so at minute 20 the We-Do
        # is starting. This is the example the authoring rule itself gives.
        self.assertEqual(d0_routine.checkpoint(self.plan()), ("We-Do", 20))

    def test_the_line_names_the_move_and_the_minute(self):
        b = d0_routine.checkpoint_block(self.plan())
        self.assertEqual(b["type"], "paragraph")
        self.assertIn("20", b["text"])
        self.assertIn("WE DO", b["text"])

    def test_it_belongs_to_the_section_that_owns_that_move(self):
        self.assertEqual(d0_routine.checkpoint_section(self.plan()), "activity")

    def test_a_different_phase_plan_moves_the_checkpoint_with_it(self):
        # Nothing here is hardcoded to We-Do. A plan that front-loads the
        # modelling puts minute 20 inside I Do, and the line must follow.
        g = self.plan()
        g["steps"] = [rstep("Settle and open", 5),
                      {"phase": "I-Do", "minutes": 20},
                      {"phase": "We-Do", "minutes": 5},
                      {"phase": "You-Do", "minutes": 7}]
        self.assertEqual(d0_routine.checkpoint(g)[0], "I-Do")
        self.assertEqual(d0_routine.checkpoint_section(g), "development")

    def test_a_plan_with_no_timings_gets_no_line_rather_than_a_wrong_one(self):
        # The assessment body has no steps and no exit ticket. Half of nothing
        # is not minute zero, it is no claim at all.
        self.assertIsNone(d0_routine.checkpoint({}))
        self.assertIsNone(d0_routine.checkpoint_block({}))


class TheRenderedDocReconciles(unittest.TestCase):
    """End to end: the bars a teacher reads add up to the header she reads.

    This is the test that would have caught the defect. Everything above it is
    the mechanism; this is the promise.
    """

    def _doc(self, routine=True):
        import copy
        import d0_primary
        import test_d0_primary as fx
        enr = copy.deepcopy(fx.ENR)
        g = enr["generated"]
        g["duration_min"] = 40
        g["exitTicket"]["minutes"] = 3
        if routine:
            g["steps"] = [rstep("Settle and open", 5, "Books out, page 102."),
                          rstep("Set the task", 5, "Explain the four words first.")] \
                         + g["steps"]
        return d0_primary.to_lp_doc(enr, fx.PT, day=1, total_days=10, topic=fx.TOPIC)

    def test_the_section_bars_sum_to_the_printed_period(self):
        doc = self._doc()
        bars = sum(int(s.get("minutes") or 0) for s in doc["sections"])
        self.assertEqual(bars, doc["period_minutes"])

    def test_without_the_routine_steps_the_bars_do_not_reach_the_header(self):
        # The shape the corpus was in on 20 Sep. Kept as a test so the fix
        # cannot be quietly reverted into looking correct.
        doc = self._doc(routine=False)
        bars = sum(int(s.get("minutes") or 0) for s in doc["sections"])
        self.assertLess(bars, doc["period_minutes"])

    def test_the_exit_ticket_minutes_reach_the_check_bar(self):
        # They were hardcoded to 0, so three of the thirteen missing minutes
        # were the check's own.
        doc = self._doc()
        check = [s for s in doc["sections"] if s["id"] == "conclusion"][0]
        self.assertEqual(check["minutes"], 3)

    def test_the_routine_text_is_on_the_page_not_just_in_the_arithmetic(self):
        doc = self._doc()
        opening = [s for s in doc["sections"] if s["id"] == "introduction"][0]
        dev = [s for s in doc["sections"] if s["id"] == "development"][0]
        self.assertIn("Books out, page 102.",
                      " ".join(b.get("text", "") for b in opening["blocks"]))
        self.assertIn("Explain the four words first.",
                      " ".join(b.get("text", "") for b in dev["blocks"]))

    def test_the_halfway_line_is_seated_in_the_section_that_owns_it(self):
        doc = self._doc()
        act = [s for s in doc["sections"] if s["id"] == "activity"][0]
        text = " ".join(b.get("text", "") for b in act["blocks"])
        self.assertIn("Halfway check", text)
        self.assertIn("WE DO", text)

    def test_the_halfway_line_appears_exactly_once_in_the_whole_plan(self):
        # It is a landmark. Two of them is two landmarks.
        doc = self._doc()
        n = sum(1 for sec in doc["sections"] for b in sec["blocks"]
                if "Halfway check" in (b.get("text") or ""))
        self.assertEqual(n, 1)

    def test_the_routine_steps_never_become_a_teaching_move(self):
        # steps_by_phase matches the phase string exactly, so a routine step
        # must not turn up as an I Do. Guarded because the reverse -- routine
        # rendering as teaching -- would overstate the teaching minutes.
        doc = self._doc()
        dev = [s for s in doc["sections"] if s["id"] == "development"][0]
        self.assertEqual(dev["move"], "I DO")
        self.assertEqual(dev["minutes"], 6 + 5)


if __name__ == "__main__":
    unittest.main()
