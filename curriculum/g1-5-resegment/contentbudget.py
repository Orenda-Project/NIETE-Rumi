"""Does the plan fit the minutes the teacher actually has to teach in?

A basics row carries two numbers and they are not the same number.
`duration_min` is 40 -- the timetabled period, and what the rendered plan
prints, because that is the period the teacher was given. `content_min` is 30
-- what the timed steps are allowed to sum to. Amena, 20 Sep 2026: *"what we
assume as perfect 40 is too long for teachers, so we make it shorter and show
the teacher 40, something she can practically implement. The opening and
explanation take [the rest]."*

The gap is settling a class of forty, getting books open, and explaining the
task. It is real time and it is not in the plan, so a plan budgeted to 40
overruns by ten minutes every single period. That is the complaint this whole
rebuild answers, and 366 lessons is a long way for an unchecked rule to drift.

THE GAP HAS TO BE IN THE PLAN, NOT BESIDE IT. Amena, 20 Sep 2026: *"how do we
explain to teachers that the LP is to be taken in 40 minutes, if we calculate
till 30, teachers and digital coach both will be striking the teacher down on
moving too slow on the LP, there needs to be a balance within the LP."* A plan
printing 40 while its own timeline claims 30 leaves ten minutes no step owns,
and an observer reading the plan against the clock marks a teacher who is
exactly on design as ten minutes behind. The field log already has this
instrument running the other way -- a plan that cannot be finished drops the
fidelity percentage and the teacher rates it down -- so the fix is not to hide
the ten minutes better but to name them.

They are named as steps carrying `kind: "routine"`: settling and opening the
books, then setting the task before any child starts. Routine minutes are on
the teacher's clock and print in the timeline, so `structural` counts them and
they have to reconcile with `duration_min`. They are not teaching minutes, so
`spent` does not charge them against `content_min` -- charging them would make
every corrected plan read as ten minutes over budget, which is how a fix like
this gets reverted.

THREE FAILURES, AND THEY ARE NOT SYMMETRIC.

Over budget is the one that matters: the lesson teachers abandon half-finished.

No timings at all is worse, because nothing is there to add up and an empty sum
looks like a small number. `gate4`'s own word budget spent a day in exactly
that state -- handed an artifact carrying none of the surfaces it measures, it
reported clean. A plan that states no minutes is not inside budget, it is
unbudgeted, and it fails here rather than passing quietly.

Under budget is the soft one. The six lessons authored before this check
existed sum to 27 or 28 against 30, so two or three minutes is the house
style rather than a defect; `SLACK` is set from that measurement. A plan at
half the budget is a different thing -- the class is left with ten empty
minutes and the teacher improvises them.

WHICH ROWS ARE SCORED. Until bd-jfkl0 this module asked the row for
`content_min` and scored nothing when it did not find it. No corpus segment
spells `content_min` -- 0 of 2,039 -- so the check applied to the six basics
lessons and to nothing else, and every ordinary Stage C lesson was authored
against a 30-minute budget and then measured against none. That is the same
shape as the `gate4` failure two paragraphs up, arrived at from the other
direction: not an artifact missing the surfaces, but a rule missing the rows.

So the pair is resolved the way the author's envelope resolves it, through
`cbriefbasics.minutes()` -- one place, so what the gate scores and what the
brief printed cannot drift apart. The corpus states one number, calls it
`duration_min`, and that number is 25, 30 or 35: it is the budget wearing the
period's name, and the period beside it is 40.

What still belongs to the row is whether it is scored at all. A row naming no
minutes has not tacitly agreed to thirty of them, and is left alone -- see
`_states_time`. Widening a check to a shape it was not written for is one step
from scoring every row against a default nobody wrote down.
"""

import cbriefbasics

# Measured 20 Sep 2026 across the six authored grade_1_english lessons: 28,
# 28, 28, 28, 27, 27 minutes against a 30-minute plan. Two or three minutes
# short is how a lesson with an untimed exit ticket is written here, so the
# floor is set below it rather than at it.
SLACK = 5

TIMED = ("warmUp", "exitTicket")

# The one word that moves a step off the content budget and onto the clock.
# Matched exactly: a step reading "Routine" or "routine " is a typo, and a typo
# that silently frees five minutes is worse than one that costs them.
ROUTINE = "routine"


def _minutes(obj):
    """`obj["minutes"]`, but only when it is a number somebody can add up."""
    if not isinstance(obj, dict):
        return 0
    m = obj.get("minutes")
    return m if isinstance(m, int) and not isinstance(m, bool) else 0


def _body(lp):
    """The v9 body, whether the caller handed the file or the body itself.

    `judgerun` passes the whole artefact and `gate4`'s own fixture passes a
    bare body; `qa_checks` accepts both, so this has to as well or the check
    silently applies to only one of them.
    """
    d = lp or {}
    return d.get("generated") or d


def _is_routine(step):
    return isinstance(step, dict) and step.get("kind") == ROUTINE


def spent(lp):
    """The TEACHING minutes the plan's own timed surfaces claim.

    The warm-up counts. It is the first thing a teacher who is running late
    drops, which is the argument for counting it, not against.

    Routine steps do not. They are the settling and the task-setting, and they
    are the reason `content_min` is 30 rather than 40 in the first place --
    counting them here would charge the budget twice for the same ten minutes.
    """
    g = _body(lp)
    total = sum(_minutes(g.get(k)) for k in TIMED)
    for step in g.get("steps") or []:
        if not _is_routine(step):
            total += _minutes(step)
    return total


def routine(lp):
    """Settling, books open, task explained. Real minutes, not teaching."""
    return sum(_minutes(s) for s in (_body(lp).get("steps") or [])
               if _is_routine(s))


def structural(lp):
    """Everything the teacher's clock sees -- what `duration_min` must equal.

    This is the number a Digital Coach reads off the plan when deciding
    whether the class is on time, so it is the number that has to be true.
    """
    return spent(lp) + routine(lp)


def _states_time(segment):
    """Has this row named a number of minutes under either name?

    Either one is enough. A row naming only the period has still said
    something the plan can be held to; a row naming neither has not, and
    `failures` leaves it alone rather than resolving it a default.
    """
    seg = segment or {}
    for key in ("duration_min", "content_min"):
        v = seg.get(key)
        if isinstance(v, int) and not isinstance(v, bool) and v > 0:
            return True
    return False


def failures(lp, segment):
    """`gate4`-shaped findings, or [] where the row states no minutes."""
    if not _states_time(segment):
        return []
    period, budget = cbriefbasics.minutes(segment)
    total = spent(lp)
    if total == 0:
        return [{"id": "C1",
                 "name": "the plan states no timings, so nothing was measured "
                         "against the %d-minute content budget" % budget}]
    if total > budget:
        return [{"id": "C1",
                 "name": "the timed steps sum to %d minutes, content budget %d "
                         "(over by %d) — the period is %d minutes long but the "
                         "rest of it is settling the class and explaining the "
                         "task" % (total, budget, total - budget, period)}]
    if total < budget - SLACK:
        return [{"id": "C1",
                 "name": "the timed steps sum to only %d minutes of a %d-minute "
                         "content budget, leaving %d minutes the teacher has to "
                         "fill" % (total, budget, budget - total)}]
    return _accounted(lp, period)


def _accounted(lp, period):
    """Does the period the plan PRINTS match the minutes its steps claim?

    Reported after the content budget on purpose. When a plan is both over on
    teaching time and short on accounting, cutting the teaching is the author's
    first move, and telling them both at once buries it.

    The tolerance is `SLACK`, the same three-or-four minutes the content budget
    already allows -- it was measured off authored lessons, not chosen, and a
    period that reconciles to within it reads as on time to an observer. Ten
    unaccounted minutes does not.

    `period` is the resolved one -- what the envelope printed -- not whatever
    the row happened to spell. A corpus row says 30 and the plan prints 40,
    and it is the 40 an observer watches the teacher against.
    """
    total = structural(lp)
    if total == period or period - SLACK <= total < period:
        return []
    if total < period:
        return [{"id": "C1",
                 "name": "the plan prints a %d-minute period but its steps "
                         "account for only %d minutes, so %d minutes belong to "
                         "no step — a teacher exactly on design reads as %d "
                         "minutes behind. Name them: add `kind: \"routine\"` "
                         "steps for settling the class and setting the task"
                         % (period, total, period - total, period - total)}]
    return [{"id": "C1",
             "name": "the plan prints a %d-minute period but its steps claim "
                     "%d minutes (over by %d) — the teacher runs out of period "
                     "before the plan runs out of steps"
                     % (period, total, total - period)}]
