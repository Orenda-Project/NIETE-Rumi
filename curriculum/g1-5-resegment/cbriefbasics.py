"""The part of a basics lesson that is not on the page.

`cbrief` keeps one guarantee: Stage C invents nothing, because the author is
handed everything the lesson may be built from. For an ordinary lesson that
is the page plus the SLOs. For a basics day the SLO half is deliberately
empty -- the FDE syllabus has no objective for number fluency, and borrowing
the chapter's codes would report the syllabus as covered by a day that never
taught it -- which means the guarantee inverts unless something takes its
place. A blank where today's purpose belongs is the one blank an author will
fill, and filling it is fabrication.

So this says instead: what the day is for, what it feeds, why it claims no
code, and the rule that binds all five templates -- the class never leaves
the book. Teachers reject out-of-textbook work, and that rejection is why the
period is anchored to a chapter at all, so the rule cannot live only in a
spec file that no author reads.

Separate from `cbrief` because `cbrief` is at its length limit, and because
this is one decision -- how a chapterless day is described -- that should be
arguable on its own.
"""
import basicseg

ANCHOR = ("Use only this chapter's own words, numbers and pictures. The class "
          "never leaves the book: a basics period sits inside the chapter it "
          "is anchored to, and teachers reject a lesson that sends them "
          "outside the textbook they were given.")

NO_SLO = ("This day claims no SLO, and that is the design, not an omission. "
          "The FDE syllabus has no objective for this skill, so the day is "
          "measured against its own objective above. Do not write the lesson "
          "against the chapter's SLOs -- those are what it feeds, over the "
          "weeks, and they are listed under supports_slo for that reason.")

SPIRAL = ("This day claims no SLO, so the warm-up forbids nothing. Point it "
          "at %s itself: something the class can already do with this "
          "chapter's material, that the day then pushes further.")


def section(segment):
    """The basics half of a brief, or None where the day is an ordinary one."""
    if not segment.get("is_basics"):
        return None
    skill = segment.get("skill_type")
    return {
        "skill": skill,
        "skill_name": basicseg.NAME.get(skill, skill),
        "objective": segment.get("objective"),
        # Named, never as today's objective: `envelope.slo_refs` stays empty
        # because coverage arithmetic reads it. This list nothing counts.
        "supports_slo": list(segment.get("supports_slo_codes") or []),
        "no_slo_reason": NO_SLO,
        "anchor": ANCHOR,
    }


def spiral_reason(segment):
    """Why a basics day's warm-up forbids nothing, or None if it is not one."""
    if not segment.get("is_basics"):
        return None
    skill = segment.get("skill_type")
    return SPIRAL % basicseg.NAME.get(skill, skill).lower()
