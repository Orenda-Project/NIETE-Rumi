"""The part of a basics lesson that is not on the page.

`cbrief` keeps one guarantee: Stage C invents nothing, because the author is
handed everything the lesson may be built from. For an ordinary lesson the
page plus the SLOs is all of it. A basics day states SLOs too -- the ones of
the book day it is grounded on -- and there the same fields mean something
different, in three ways an author cannot detect from the fields alone.

The codes are NOT today's new objectives. The class already met them, in the
lesson this period sits beside; today is practice on them, at one named
skill. An author reading them as new teaching writes the lesson the class
already had.

`_spiral` puts those codes in `forbidden`, which for an ordinary lesson means
the warm-up may not reach there. For a drill it is exactly where the warm-up
belongs. Left unsaid, the list forbids the one move that works.

And the period shown is not the content budget. The teacher's slot is 40
minutes and the plan says 40; the steps are budgeted shorter, because the
opening and the explanation take the rest. An author told only "40" writes
the plan teachers say they cannot finish -- the complaint the whole rebuild
started from.

The fourth thing is the rule that binds all five templates: the class never
leaves the book. Teachers reject out-of-textbook work, and that rejection is
why the period is anchored to a chapter at all, so it cannot live only in a
spec file that no author reads.

Separate from `cbrief` because `cbrief` is at its length limit, and because
this is one decision -- how a minted day is described -- that should be
arguable on its own.
"""
import basicseg

ANCHOR = ("Use only this chapter's own words, numbers and pictures. The class "
          "never leaves the book: a basics period sits inside the chapter it "
          "is anchored to, and teachers reject a lesson that sends them "
          "outside the textbook they were given.")

SLO_REASON = ("These are the SLOs of the lesson this period rehearses, taught "
              "on the book day it is grounded on. They are not new objectives "
              "and today is not first teaching: write practice on them, at "
              "the skill named above, using that day's own pages. The wider "
              "list under supports_slo is what this skill feeds over the "
              "weeks -- it is not today's target.")

SPIRAL = ("The codes this day states were taught in the lesson it rehearses, "
          "not introduced today, so the usual rule inverts: the warm-up may "
          "reach straight back to them. Point it at %s itself -- something "
          "the class can already do with this chapter's material, that the "
          "day then pushes further.")

# The teacher reads `period_minutes`; the steps are written to the shorter
# number. Said as a rule rather than two bare figures, because an author
# given both and no rule picks whichever reads as the period.
TIMING = ("The teacher's period is %d minutes and the plan says so. Budget "
          "the steps to %d minutes: settling the class and explaining the "
          "task take the rest. A plan whose steps fill the whole period is "
          "the plan teachers report they cannot finish.")

# What a row that does not say gets. A missing budget must not read as
# permission to spend the whole period.
CONTENT_MIN = 30
PERIOD_MIN = 40


def section(segment):
    """The basics half of a brief, or None where the day is an ordinary one."""
    if not segment.get("is_basics"):
        return None
    skill = segment.get("skill_type")
    period = segment.get("duration_min") or PERIOD_MIN
    content = segment.get("content_min") or CONTENT_MIN
    return {
        "skill": skill,
        "skill_name": basicseg.NAME.get(skill, skill),
        "objective": segment.get("objective"),
        # The chapter's wider set, named as what the skill feeds. Nothing
        # counts this list -- `envelope.slo_refs` is the counted one, and it
        # holds only the grounding day's codes.
        "supports_slo": list(segment.get("supports_slo_codes") or []),
        "slo_reason": SLO_REASON,
        "period_min": period,
        "content_min": content,
        "timing": TIMING % (period, content),
        "anchor": ANCHOR,
    }


def spiral_reason(segment):
    """Why a basics day's warm-up forbids nothing, or None if it is not one."""
    if not segment.get("is_basics"):
        return None
    skill = segment.get("skill_type")
    return SPIRAL % basicseg.NAME.get(skill, skill).lower()
