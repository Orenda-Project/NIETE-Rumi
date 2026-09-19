"""The context a Stage-C author is handed for one lesson.

Stage C invents nothing. That is the whole guarantee, and it is not made by
the author — it is made by what the author is given. So this is the module
that decides, rather than a paragraph of prose inside a prompt where nothing
can check it.

It is assembled, not fetched: the caller loads the segment, resolves its pages
through `pageres`, and hands the dicts in. Pure on purpose, for the same
reason `pageres` is — the grounding rule stays testable without the corpus,
which is restricted and not on every machine.

Three decisions worth stating, each one a defect that already happened.

**The warm-up spirals backwards.** The operator found Grade 2 Maths Chapter 1
warming up on "ordering of numbers", which is the SLO of the lesson it was
warming up FOR. An author handed only today's SLOs cannot avoid that, so the
previous lesson arrives whole — topic and its own SLO codes — and today's
codes are named in `forbidden`. Where there is no previous lesson the spiral
says which and why rather than going quiet; an absent key reads as an
oversight, a `None` with a reason reads as a fact.

**A character may be named and may not be ventriloquised.** SP-003 allows a
silent recurring character and forbids inventing a line for one. The page
truth already draws that line — `text_in_image` is either the words printed on
the page or null — so the two arrive as two lists, and the silent one carries
no field an author could mistake for a line to speak. Nothing here classifies
an illustration as a "character": that judgement would be a guess, and a guess
is the thing this module exists to prevent.

**No pages, no lesson.** A segment whose pages did not resolve raises rather
than producing a brief with an empty source section. "The #1 partner-rejected
failure is FABRICATION from no grounding" — a brief that asks for a lesson and
supplies no page is that failure, pre-authorised.
"""
import bodysurface
import d0_route

# The shape of a chapter assessment, handed to the author rather than only
# enforced afterwards. Law 18: "MIRROR EVERY ENGINE REFUSAL IN THE FREE
# PRE-RENDER LINT, AND WRITE THE SHAPE INTO THE AUTHORING BRIEF." The engine
# refuses a 995 that arrives as a lesson plan and `wslint` refuses one of the
# wrong shape; neither tells an author what the right one is. Every rule below
# is one `wslint` enforces, said in the order an author meets it.
WORKSHEET = {
    "artefact": "a student-facing worksheet and a separate answer key, built "
                "from ONE authored questions[] by d0_worksheet.build",
    "fields": ("title", "instructions", "total_marks", "questions",
               "id", "type", "marks", "childText", "directive", "space",
               "options", "pairs", "illustration",
               "answer", "marking", "common_errors",
               "open_personal", "model_solution"),
    "rules": (
        "8 to 12 questions for the whole chapter -- not a four-page lesson "
        "with the teaching removed",
        "at least 3 of: mcq, fill, match, short, draw, compute, word",
        "every question carries its own marks, and they add to total_marks",
        "childText is what the CHILD reads; anything addressed to the teacher "
        "goes in `directive` and never reaches the sheet",
        "anything written into declares its space: lines, box, grid or none",
        "every question carries answer, marking and common_errors -- a "
        "question with no key is one the teacher cannot mark at the front of "
        "a class",
        "a personal question legitimately has no single answer: set "
        "open_personal and give model_solution instead of answer",
        "an illustration carries an ASCII count, and no drawn group holds "
        "more than 4 countable objects -- split 7 into 4 and 3. This is about "
        "PICTURED OBJECTS ONLY: five rhyming pairs or seven days of the week "
        "are the book's own content and are never split",
    ),
    "exemplar": "exemplars/worksheet.json",
}

# `d0_route` names the route; an author names the artefact.
SHAPE = {"content": "lesson", "assessment": "worksheet",
         "revision": "revision"}

# The shape of a revision day. Same law as `WORKSHEET` above, and the same
# reason said twice as loudly: on the GK/Islamiat/SST pilot THREE of four
# revision lessons reached the renderer with `revisionPanels: null`. Each one
# burned a paid render slot, each came back as an ordinary lesson plan with the
# teaching removed, and the run still logged "30/30 lint clean". The renderer
# does that silently by design -- it picks the revision page set only when the
# panels are there, and one missing panel discards all three. `d0_panels`
# refuses that artefact and `panellint` refuses it for free; neither tells an
# author what the accepted shape is. Every rule below is one `panellint`
# enforces, said in the order an author meets it.
REVISION = {
    "artefact": "three parallel revision panels -- beginner, intermediate and "
                "advanced -- built by d0_panels.build into a portrait glance "
                "page and three landscape 4:3 pages (explain, practice, exit). "
                "It is NOT a lesson plan with the teaching removed: a revision "
                "day legally has no iDo and no youDo",
    "fields": ("revisionPanels", "groupingNote",
               "beginner", "intermediate", "advanced",
               "focus", "board", "explain", "say", "sayLocal",
               "guided", "prompt", "strategy", "answer",
               "practice", "exit"),
    "rules": (
        "write revisionPanels with exactly three keys -- beginner, "
        "intermediate, advanced -- and nothing else beside groupingNote. All "
        "three must be complete: one missing panel and the renderer discards "
        "all three and prints the ordinary lesson pages instead, at full cost "
        "and without saying so",
        "a key that is present and null is ABSENT. Writing \"advanced\": null "
        "to mean \"this one is short\" loses the other two as well",
        "groupingNote tells the teacher how to split the class, in 200 "
        "characters or fewer",
        "every panel carries focus (80 chars), board (1 to 3 lines of 60), "
        "explain, guided, practice and exit",
        "explain.say is what the teacher says, 300 characters at most, and "
        "sayLocal is the same thing in Urdu -- aim at 220 so it is not read "
        "at a truncation point",
        "guided is one worked example: prompt (115), strategy (140) and "
        "answer (78)",
        "practice is 2 to 3 items, each prompt 115 and each answer 78",
        "exit is one question the child leaves on: prompt (125), answer (78)",
        "no answer is printed on a child-facing card -- every guided and "
        "practice answer is collected into the single teacher footnote, and "
        "the answer boxes on the page are empty",
        "the three panels teach the SAME chapter content at three depths: "
        "beginner is building the foundations, intermediate is the chapter "
        "made simpler, advanced is at grade level and beyond. They are not "
        "three different topics",
        "write no iDo, weDo or youDo. A revision day has no teaching blocks, "
        "and one written here is a lesson plan wearing a revision label",
    ),
    "exemplar": "exemplars/revision.json",
}


class Ungrounded(Exception):
    """A lesson was asked for with no page of the book behind it."""


def _slo(segment):
    """`(code, description)` per SLO. A code with no description says so.

    Pairing by position and truncating to the shorter list would silently drop
    the second SLO of any segment whose descriptions were filled in late.
    """
    codes = segment.get("slo_codes") or []
    desc = segment.get("slo_descriptions") or []
    return [(c, desc[i] if i < len(desc) else None)
            for i, c in enumerate(codes)]


def _envelope(segment, pages, book, day, total_days):
    return {
        "segment_index": segment.get("segment_index"),
        "grade": book.get("grade"),
        "subject": book.get("subject"),
        "book_stem": book.get("stem"),
        "chapter_number": segment.get("chapter_number"),
        "chapter_title": book.get("chapter_title"),
        "topic": segment.get("topic"),
        "skill_type": segment.get("skill_type"),
        "lp_type": segment.get("lp_type"),
        "cpa_phase": segment.get("cpa_phase"),
        "bloom": segment.get("blooms"),
        "duration_min": segment.get("duration_min"),
        "day_num": day,
        "total_days": total_days,
        # What resolved, not what was asked for. A segment naming three pages
        # of which two resolved must not tell the author it has three.
        "pages_printed": [p.get("printed_page_number") for p in pages],
        "pages_pdf": [p.get("pdf_page_index") for p in pages],
        "slo_refs": [c for c, _ in _slo(segment)],
        "slo": _slo(segment),
    }


def _spiral(segment, prev):
    """What the warm-up may rehearse, and what it may not."""
    forbidden = [c for c, _ in _slo(segment)]
    if prev is None:
        return {"previous": None, "forbidden": forbidden,
                "reason": "first lesson of this chapter — the warm-up reaches "
                          "back to prior knowledge, not to a named SLO"}
    return {
        "previous": {"segment_index": prev.get("segment_index"),
                     "topic": prev.get("topic"),
                     "slo_refs": [c for c, _ in _slo(prev)],
                     "slo": _slo(prev)},
        "forbidden": forbidden,
        "reason": None,
    }


def _source(pages):
    """Everything on the paper, split the way an author may use it."""
    out = {"pages": [], "exercises": [], "voices": [], "silent": []}
    for p in pages:
        printed = p.get("printed_page_number")
        out["pages"].append({
            "printed_page": printed,
            "pdf_page_index": p.get("pdf_page_index"),
            "page_type": p.get("page_type"),
            "headings": p.get("headings") or [],
            "text_verbatim": p.get("text_verbatim") or "",
        })
        for ex in p.get("exercises") or []:
            out["exercises"].append(dict(ex, printed_page=printed))
        for ill in p.get("illustrations") or []:
            words = (ill.get("text_in_image") or "").strip()
            base = {"printed_page": printed,
                    "description": ill.get("description"),
                    "objects": ill.get("objects") or [],
                    "pedagogical_role": ill.get("pedagogical_role")}
            if words:
                out["voices"].append(dict(base, says=words))
            else:
                # No `says` key at all. A null one is an invitation.
                out["silent"].append(base)
    return out


def _tightest(budget):
    """The surface an author should write last: least room per feeder field."""
    def room(name):
        t = budget[name]
        return t["author_budget"] / max(len(t["fields"]), 1)
    return min(budget, key=room)


def context(segment, pages, book, prev=None, day=None, total_days=None):
    """Everything one lesson may be built from. Raises if that is nothing."""
    if not pages:
        raise Ungrounded("segment %s resolved to no page of %s"
                         % (segment.get("segment_index"), book.get("stem")))
    chapter = segment.get("chapter_number")
    for p in pages:
        ch = p.get("chapter") or {}
        if ch.get("number") != chapter:
            raise Ungrounded(
                "segment %s is chapter %s but printed page %s is chapter %s"
                % (segment.get("segment_index"), chapter,
                   p.get("printed_page_number"), ch.get("number")))

    brief = {
        "envelope": _envelope(segment, pages, book, day, total_days),
        "spiral": _spiral(segment, prev),
        "source": _source(pages),
        # The route word, said in the brief's own vocabulary: an author
        # builds a lesson, a worksheet or a revision page, not a "content".
        "shape": SHAPE.get(d0_route.kind({}, segment), "lesson"),
    }

    # Grounding is the same question whatever is being built, so `source` and
    # `spiral` above are unconditional. What is built from it is not: the five
    # capped surfaces belong to a four-page lesson, and handing them to a
    # worksheet author is an instruction to write one.
    if brief["shape"] == "worksheet":
        brief["worksheet"] = WORKSHEET
    elif brief["shape"] == "revision":
        brief["revision"] = REVISION
    else:
        budget = bodysurface.targets()
        brief["budget"] = budget
        brief["write_last"] = _tightest(budget)
    return brief
