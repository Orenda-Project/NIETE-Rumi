# -*- coding: utf-8 -*-
"""Name the minutes a plan does not name. Nothing else.

bd-oisjm. Seven grade_1_english lessons print a 40-minute period and account
for 27 or 28 of it. `contentbudget` calls that the failure it is: twelve
minutes belong to no step, so a teacher exactly on design reads to a Digital
Coach as twelve minutes behind, and the fidelity score she loses for it is the
same score the field log already ties to the thumbs-down ratings.

The minutes are not missing. They are being spent -- settling forty six-year-
olds and getting books open, explaining the task before any child starts, and
running the exit ticket -- and the plan simply does not write them down. So
this pass writes them down and changes nothing about the teaching.

TWO KINDS OF UNNAMED MINUTE, AND THEY ARE NOT INTERCHANGEABLE.

The exit ticket is TEACHING. Every one of these bodies carries an exit ticket
with no `minutes`, which is why `spent` reads 27 or 28 against a 30-minute
budget: the check the class is assessed on costs nothing on the plan's own
clock. Its minutes are charged to the content budget, which is the whole
reason they can only be the ones the budget has left -- `budget - teaching`
and not a number somebody liked.

Settling and task-setting are NOT teaching. They are `kind: "routine"` steps:
on the teacher's clock, in the printed timeline, and deliberately outside the
30-minute budget. `lessonrules` [3B] names both and gives each five minutes;
`d0_routine` already renders them. Nothing here is new law, it is the law
applied to seven lessons authored before it existed.

WHY THIS REFUSES RATHER THAN DEFAULTS. Every refusal below is a lesson whose
shape means something other than "unnamed minutes":

  * no timings at all is a different defect, the one `contentbudget` reports
    separately, and a plan with no clock does not get one invented for it;
  * a plan already over its content budget needs teaching cut, and padding its
    period would bury that;
  * a plan far short of its budget has empty minutes, not unnamed ones -- a
    ten-minute exit ticket is not an exit ticket;
  * a plan already carrying routine steps has been timed by somebody, and
    re-timing it is re-authoring, not naming; and
  * a row stating no minutes has not tacitly agreed to forty of them. That is
    `contentbudget._states_time`'s rule, and it is repeated here rather than
    inherited so this module cannot be the one that widens it.
"""
import copy

import cbriefbasics
import contentbudget

#: The two phases `lessonrules` [3B] names and `d0_routine.SECTION` maps. Kept
#: as constants so a rename breaks a test rather than the render.
SETTLE = "Settle and open"
SET_TASK = "Set the task"

#: Five minutes each is the house rule. It is a floor on settling rather than
#: a ceiling: a wider gap lengthens the class coming in, because explaining a
#: task is bounded by how much task there is and getting forty six-year-olds
#: seated with the right page open is not.
CANON = 5

#: The longest exit ticket that is still an exit ticket. Past this the lesson
#: is short, and that is a lesson to lengthen.
MAX_EXIT = 5

SETTLE_ACTION = (
    "Class in and seated, books out, every child open at today's page. Do not "
    "start the warm-up until the last book is open -- a child still hunting "
    "for the page misses the whole of it.")

TASK_ACTION = (
    "Before any child starts, say in one sentence what they are about to do "
    "and how they will know they have done it. Ask two children to say it "
    "back to you, then let the class begin.")


class Refused(Exception):
    """Nothing was named, and the message says which rule stopped it."""


def split(gap):
    """(settling, task-setting) minutes for a period short by `gap`."""
    if gap < 2:
        raise Refused("a %d-minute gap is not two steps -- there is nothing "
                      "here worth naming" % (gap,))
    task = CANON if gap >= 2 * CANON else gap // 2
    return gap - task, task


def _minutes(obj):
    """`obj["minutes"]` when it is a number, else None."""
    if not isinstance(obj, dict):
        return None
    m = obj.get("minutes")
    return m if isinstance(m, int) and not isinstance(m, bool) else None


def _step(phase, mins, action):
    """One routine step, in the shape `d0_routine.block` renders."""
    return {"kind": contentbudget.ROUTINE, "phase": phase,
            "minutes": mins, "action": action}


def name(body, segment, settle_action=SETTLE_ACTION, task_action=TASK_ACTION):
    """`body` with its unnamed minutes written down, or `Refused` with why."""
    if not contentbudget._states_time(segment):
        raise Refused("the segment row states no minutes, so there is no "
                      "period to reconcile this plan against")
    period, budget = cbriefbasics.minutes(segment)
    if contentbudget.routine(body):
        raise Refused("this plan already names routine minutes -- re-timing "
                      "one that was timed is authoring, not naming")
    teaching = contentbudget.spent(body)
    if teaching == 0:
        raise Refused("the plan states no timings at all, which is a defect "
                      "of its own and not a period with minutes left over")
    if teaching > budget:
        raise Refused("the teaching is %d minutes against a %d-minute content "
                      "budget -- that is teaching to cut, and padding the "
                      "period around it would hide it" % (teaching, budget))
    out = copy.deepcopy(body)
    short = budget - teaching
    if short > MAX_EXIT and _minutes(body.get("exitTicket")) is None:
        raise Refused("the teaching is %d minutes short of the %d-minute "
                      "content budget -- those are empty minutes, not unnamed "
                      "ones, and a %d-minute exit ticket is not an exit "
                      "ticket" % (short, budget, short))
    if short and isinstance(out.get("exitTicket"), dict) \
            and _minutes(out["exitTicket"]) is None:
        out["exitTicket"]["minutes"] = short
    gap = period - contentbudget.structural(out)
    if gap <= contentbudget.SLACK:
        raise Refused("the plan already reconciles: %d minutes of a %d-minute "
                      "period, which is inside the %d the check allows"
                      % (contentbudget.structural(out), period,
                         contentbudget.SLACK))
    settle, task = split(gap)
    out["steps"] = [_step(SETTLE, settle, settle_action),
                    _step(SET_TASK, task, task_action)] \
        + list(out.get("steps") or [])
    _verify(body, out, period)
    return out


def _verify(before, after, period):
    """Redundant proof that only the named minutes moved.

    Rebuilt rather than derived: the routine steps come back out, the exit
    ticket's minutes go back to whatever they were, and what is left has to be
    character-for-character what came in. A bug above that reordered a step,
    edited a script or dropped a `cfu` stops here rather than in a teacher's
    hand.
    """
    if contentbudget.structural(after) != period:
        raise Refused("the named minutes come to %d against a %d-minute "
                      "period -- refusing to return a plan that still does "
                      "not add up" % (contentbudget.structural(after), period))
    rebuilt = copy.deepcopy(after)
    rebuilt["steps"] = [s for s in rebuilt.get("steps") or []
                        if s.get("kind") != contentbudget.ROUTINE]
    if isinstance(rebuilt.get("exitTicket"), dict):
        was = _minutes(before.get("exitTicket"))
        if was is None:
            rebuilt["exitTicket"].pop("minutes", None)
        else:
            rebuilt["exitTicket"]["minutes"] = was
    if rebuilt != before:
        raise Refused("naming the minutes moved something else in the plan "
                      "-- refusing to return it")
