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

    budget = bodysurface.targets()
    return {
        "envelope": _envelope(segment, pages, book, day, total_days),
        "spiral": _spiral(segment, prev),
        "source": _source(pages),
        "budget": budget,
        "write_last": _tightest(budget),
    }
