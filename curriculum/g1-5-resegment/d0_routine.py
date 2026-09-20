"""Stage D0 — the minutes around the teaching, and where they print.

A lesson prints a 40-minute period and teaches for 30. The other ten are real:
the class coming in and finding the page, and the teacher explaining the task
before any child starts. They were never written down, so the rendered plan
showed bars summing to 27 under a header saying 40, and a teacher exactly on
design read to a Digital Coach as thirteen minutes behind.

`contentbudget` already fixed what the GATE believes -- a step carrying
`kind: "routine"` counts toward the period and is not charged to the 30-minute
content budget. This module fixes what the TEACHER reads. It is the same word,
`routine`, read from the same key, and `KIND` is asserted equal to
`contentbudget.ROUTINE` in the tests so the two can never drift apart.

WHY THE TEXT IS A `paragraph`. The v9 block enum is a closed `oneOf` of fifteen
types (`bot/vendor/lp-v9/schema/lp_doc.schema.json`), and `template.js` drops an
unknown type with a warning rather than failing -- so a new `routine` type would
silently lose the text unless the vendored schema AND all three copies of the
renderer were forked, to print two sentences. `paragraph` is already in the
enum, already rendered (`template.js:807`), and absent from `wordbudget.CAPS`,
which makes it uncapped by construction. That matters: `key_points` is the house
pattern for a titled extra block, and across all 36 basics artefacts it already
sits at a median of 105 words against a cap of 120. There is no room in it.

NO MINUTE FALLS OFF THE PAGE. `SECTION` maps the two phases the authoring rules
name. A routine phase nobody mapped still lands somewhere -- the opening -- and
still carries its minutes, because an unowned minute is the exact defect this
module exists to remove, and a silent drop would recreate it one phase name at
a time.
"""

from __future__ import annotations

# The one word that moves a step off the content budget and onto the clock.
# Matched exactly, for the reason `contentbudget` matches it exactly: a typo
# that silently moves five minutes is worse than one that costs them.
KIND = "routine"

# The two phases `lessonrules` tells the author to write, and the section each
# one belongs to. Settling is the period starting; setting the task is the
# explanation starting, not the warm-up ending.
SECTION = {
    "Settle and open": "introduction",
    "Set the task": "development",
}

# Where an unmapped routine phase goes. See the module docstring.
FALLBACK = "introduction"


def _is_routine(step):
    return isinstance(step, dict) and step.get("kind") == KIND


def _minutes(step):
    try:
        return int(step.get("minutes") or 0)
    except (TypeError, ValueError):
        return 0


def steps(g, section=None):
    """The routine steps of a plan body, optionally only one section's."""
    found = [s for s in (g or {}).get("steps") or [] if _is_routine(s)]
    if section is None:
        return found
    return [s for s in found
            if SECTION.get((s.get("phase") or "").strip(), FALLBACK) == section]


def minutes(g, section):
    """The minutes this section owes to routine, on top of its teaching."""
    return sum(_minutes(s) for s in steps(g, section))


def block(rsteps):
    """One paragraph for a section's routine, or None if it has none.

    The minutes are named in the sentence as well as in the section bar. The bar
    is the total; this is the part of it the teacher is not teaching, and she
    should be able to see that without subtracting.
    """
    lines = []
    for s in rsteps or []:
        phase = (s.get("phase") or "").strip()
        action = (s.get("action") or "").strip()
        mins = _minutes(s)
        head = "%s · %d min." % (phase, mins) if phase else "%d min." % mins
        lines.append((head + " " + action).strip())
    if not lines:
        return None
    return {"type": "paragraph", "id": "routine", "text": " ".join(lines)}


# The order a period actually runs in. `warmUp` and `exitTicket` are their own
# fields, not steps, so the timeline has to be reassembled before anyone can ask
# what is happening at minute 20.
TEACHING_ORDER = ("I-Do", "We-Do", "You-Do")

# Which section prints which phase, for seating the checkpoint line.
PHASE_SECTION = {"I-Do": "development", "We-Do": "activity", "You-Do": "activity"}

MOVE_LABEL = {"I-Do": "I DO", "We-Do": "WE DO", "You-Do": "YOU DO"}


def timeline(g):
    """(phase, minutes) in the order the period runs, warm-up and check included."""
    g = g or {}
    out = [(s.get("phase") or KIND, _minutes(s)) for s in steps(g, "introduction")]
    out.append(("warmUp", _minutes(g.get("warmUp") or {})))
    out += [(s.get("phase") or KIND, _minutes(s)) for s in steps(g, "development")]
    for phase in TEACHING_ORDER:
        out += [(phase, _minutes(s)) for s in (g.get("steps") or [])
                if not _is_routine(s) and (s.get("phase") or "").strip() == phase]
    out.append(("exitTicket", _minutes(g.get("exitTicket") or {})))
    return [(p, m) for p, m in out if m > 0]


def checkpoint(g):
    """(phase, minute) at the halfway mark, or None if the plan has no clock.

    Half of nothing is not minute zero -- it is no claim at all, which is why an
    untimed body (the assessment has neither steps nor an exit ticket) gets None
    rather than a line that would be wrong on every reading.
    """
    line = timeline(g)
    total = sum(m for _, m in line)
    if total <= 0:
        return None
    half = total // 2
    at = 0
    for phase, mins in line:
        if at <= half < at + mins:
            return (phase, half)
        at += mins
    return (line[-1][0], half)


def checkpoint_section(g):
    """Which rendered section the halfway line belongs in."""
    found = checkpoint(g)
    if not found:
        return None
    return PHASE_SECTION.get(found[0], FALLBACK)


def checkpoint_block(g):
    """The one line that turns being on time from a judgement into a fact.

    A teacher and a Digital Coach read the same page. Neither should have to add
    up the minutes to know whether the lesson is late.
    """
    found = checkpoint(g)
    if not found:
        return None
    phase, minute = found
    return {"type": "paragraph", "id": "halfway",
            "text": "Halfway check · minute %d. By now the class should be "
                    "starting %s." % (minute, MOVE_LABEL.get(phase, phase))}


def seat_the_checkpoint(sections, g):
    """Put the halfway line at the head of the section that owns minute 20.

    Runs after the sections are built, like `d0_close.seat_the_check`, because
    which section owns it depends on the whole timeline and not on any one
    section's contents.
    """
    block = checkpoint_block(g)
    if not block:
        return
    want = checkpoint_section(g)
    for sec in sections or []:
        if sec.get("id") == want:
            sec.setdefault("blocks", []).insert(0, block)
            return
