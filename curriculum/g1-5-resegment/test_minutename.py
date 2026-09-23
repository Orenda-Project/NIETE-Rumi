# -*- coding: utf-8 -*-
"""bd-oisjm. Naming the minutes a plan leaves unnamed, and nothing else."""
import copy

import pytest

import contentbudget
import minutename

SEG = {"duration_min": 30}          # the corpus spelling: 30 is the BUDGET
PERIOD = 40


def body(*step_minutes, **kw):
    """A v9 body whose teaching sums to warm-up plus the steps given."""
    out = {"lesson_id": "grade_1_english_ch1_seg1",
           "warmUp": {"minutes": kw.get("warm", 4), "items": []},
           "exitTicket": {"task": "say the sound"},
           "steps": [{"phase": p, "minutes": m, "action": "a", "say": "s"}
                     for p, m in zip(("I-Do", "We-Do", "You-Do"),
                                     step_minutes)]}
    if "exit" in kw:
        out["exitTicket"]["minutes"] = kw["exit"]
    if kw.get("no_exit"):
        del out["exitTicket"]
    return out


# --- the split ------------------------------------------------------------

def test_a_ten_minute_gap_is_the_canonical_five_and_five():
    assert minutename.split(10) == (5, 5)


def test_a_wider_gap_lengthens_the_settling_not_the_explanation():
    assert minutename.split(12) == (7, 5)
    assert minutename.split(13) == (8, 5)


def test_a_narrow_gap_is_halved_with_the_odd_minute_on_settling():
    assert minutename.split(9) == (5, 4)
    assert minutename.split(6) == (3, 3)


def test_a_gap_too_small_to_be_two_steps_is_refused():
    with pytest.raises(minutename.Refused):
        minutename.split(1)


# --- what naming does -----------------------------------------------------

def test_the_named_minutes_reach_the_printed_period_exactly():
    out = minutename.name(body(5, 10, 9), SEG)
    assert contentbudget.structural(out) == PERIOD


def test_the_exit_ticket_takes_the_minutes_left_in_the_content_budget():
    out = minutename.name(body(5, 10, 9), SEG)
    assert out["exitTicket"]["minutes"] == 2
    assert contentbudget.spent(out) == 30


def test_two_routine_steps_are_added_and_they_carry_the_routine_kind():
    out = minutename.name(body(5, 10, 9), SEG)
    added = [s for s in out["steps"] if s.get("kind") == contentbudget.ROUTINE]
    assert [s["phase"] for s in added] == [minutename.SETTLE,
                                           minutename.SET_TASK]
    assert [s["minutes"] for s in added] == [5, 5]
    assert all(s.get("action") for s in added)


def test_the_routine_minutes_are_not_charged_to_the_content_budget():
    out = minutename.name(body(5, 10, 9), SEG)
    assert contentbudget.spent(out) == 30
    assert contentbudget.routine(out) == 10


def test_the_routine_steps_lead_the_step_list_in_the_order_they_happen():
    out = minutename.name(body(5, 10, 9), SEG)
    assert out["steps"][0]["phase"] == minutename.SETTLE
    assert out["steps"][1]["phase"] == minutename.SET_TASK


def test_a_shorter_lesson_gets_a_longer_exit_ticket_not_longer_routine():
    out = minutename.name(body(3, 11, 9, warm=4), SEG)      # teaching 27
    assert out["exitTicket"]["minutes"] == 3
    assert contentbudget.routine(out) == 10
    assert contentbudget.structural(out) == PERIOD


def test_the_gate_stops_complaining_about_this_lesson():
    lp = minutename.name(body(5, 10, 9), SEG)
    assert contentbudget.failures(lp, SEG) == []


def test_the_teaching_steps_are_untouched():
    before = body(5, 10, 9)
    out = minutename.name(before, SEG)
    taught = [s for s in out["steps"] if s.get("kind") != contentbudget.ROUTINE]
    assert taught == before["steps"]


def test_the_callers_body_is_not_mutated():
    before = body(5, 10, 9)
    keep = copy.deepcopy(before)
    minutename.name(before, SEG)
    assert before == keep


def test_nothing_outside_the_steps_and_the_exit_minutes_moves():
    before = body(5, 10, 9)
    before["bigIdea"] = "sounds make words"
    out = minutename.name(before, SEG)
    assert out["bigIdea"] == "sounds make words"
    assert out["warmUp"] == before["warmUp"]
    assert out["exitTicket"]["task"] == before["exitTicket"]["task"]


def test_a_body_with_no_exit_ticket_still_gets_its_period_named():
    out = minutename.name(body(5, 10, 9, no_exit=True), SEG)
    assert contentbudget.structural(out) == PERIOD
    assert contentbudget.routine(out) == 12
    assert "exitTicket" not in out


def test_an_exit_ticket_that_already_states_minutes_is_left_alone():
    out = minutename.name(body(5, 10, 8, exit=3), SEG)
    assert out["exitTicket"]["minutes"] == 3
    assert contentbudget.structural(out) == PERIOD


# --- the refusals ---------------------------------------------------------

def test_a_plan_stating_no_timings_at_all_is_refused():
    with pytest.raises(minutename.Refused) as e:
        minutename.name({"lesson_id": "x", "steps": []}, SEG)
    assert "no timings" in str(e.value)


def test_a_plan_that_already_names_its_routine_is_refused():
    b = body(5, 10, 9)
    b["steps"].append({"kind": "routine", "phase": minutename.SETTLE,
                       "minutes": 5, "action": "a"})
    with pytest.raises(minutename.Refused) as e:
        minutename.name(b, SEG)
    assert "already" in str(e.value)


def test_a_plan_over_its_content_budget_is_refused():
    with pytest.raises(minutename.Refused) as e:
        minutename.name(body(10, 12, 12), SEG)     # 4 + 34 teaching
    assert "content budget" in str(e.value)


def test_a_plan_far_short_of_its_content_budget_is_refused():
    with pytest.raises(minutename.Refused) as e:
        minutename.name(body(3, 4, 5), SEG)        # 4 + 12 teaching
    assert "short" in str(e.value)


def test_a_plan_that_already_reconciles_is_refused():
    """A period already accounted for has no minutes left to name.

    Reached with a row whose budget IS its period -- the only shape where a
    plan can fill the content budget and owe the clock nothing.
    """
    b = {"warmUp": {"minutes": 5}, "exitTicket": {"minutes": 5},
         "steps": [{"phase": "I-Do", "minutes": 30, "action": "a"}]}
    with pytest.raises(minutename.Refused) as e:
        minutename.name(b, {"duration_min": 40, "content_min": 40})
    assert "reconcile" in str(e.value)


def test_a_row_stating_no_minutes_is_refused_rather_than_given_a_default():
    with pytest.raises(minutename.Refused) as e:
        minutename.name(body(5, 10, 9), {})
    assert "states no minutes" in str(e.value)
