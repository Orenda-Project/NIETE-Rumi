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

A segment that states no `content_min` states no budget, and has none of these
failures. The rule belongs to the row, not to the gate: every lesson outside
the basics build is scored exactly as it was before this module existed.
"""

# Measured 20 Sep 2026 across the six authored grade_1_english lessons: 28,
# 28, 28, 28, 27, 27 minutes against a 30-minute plan. Two or three minutes
# short is how a lesson with an untimed exit ticket is written here, so the
# floor is set below it rather than at it.
SLACK = 5

TIMED = ("warmUp", "exitTicket")


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


def spent(lp):
    """The minutes the plan's own timed surfaces claim.

    The warm-up counts. It is the first thing a teacher who is running late
    drops, which is the argument for counting it, not against.
    """
    g = _body(lp)
    total = sum(_minutes(g.get(k)) for k in TIMED)
    for step in g.get("steps") or []:
        total += _minutes(step)
    return total


def failures(lp, segment):
    """`gate4`-shaped findings, or [] where the segment states no budget."""
    budget = (segment or {}).get("content_min")
    if not isinstance(budget, int) or isinstance(budget, bool) or budget <= 0:
        return []
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
                         "task" % (total, budget, total - budget,
                                   segment.get("duration_min") or 0)}]
    if total < budget - SLACK:
        return [{"id": "C1",
                 "name": "the timed steps sum to only %d minutes of a %d-minute "
                         "content budget, leaving %d minutes the teacher has to "
                         "fill" % (total, budget, budget - total)}]
    return []
