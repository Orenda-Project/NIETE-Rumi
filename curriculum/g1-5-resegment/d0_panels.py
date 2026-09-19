"""The 990 builder: a revision day as four pages, three groups wide.

A revision day is not a lesson plan with the teaching removed. It is three
parallel classes running in one room: she takes one group for twelve or
fifteen minutes while the other two work items pitched at where they are, and
then she moves. So the page set is shaped around the move, not around a
sequence -- one portrait page she reads before class to see the whole plan,
then three landscape pages she works ACROSS, a panel per group.

  1  glance     portrait   the grouping note, then three focus cards and the
                           three board cards she copies up before they arrive
  2  explain    landscape  the re-teaching script, one panel per group
  3  practice   landscape  one guided item she models, then the items each
                           group does alone -- answer boxes drawn EMPTY
  4  exit       landscape  a one-minute SLO check at each group's own level

Three things this module refuses to do, each because doing them silently is
the failure that has already happened once:

  It will not build a segment that is not a revision day. `d0_route` decides
  that and this raises `WrongRoute` rather than guessing.

  It will not build a revision day with no panels in it. `panellint` runs
  first and `Unfit` is raised before a single page is assembled, because on
  the pilot three of four such days reached the renderer, burned a paid render
  slot each, and the batch still reported clean.

  It will not print an answer on a page a child holds. Every practice answer
  goes into ONE teacher footnote at the foot of the page; the boxes above it
  are empty. The exit page is the deliberate exception -- that answer is for
  her, on a ticket she marks in the minute it takes to read it.

There is no iDo and no youDo anywhere below, and none is read off the
envelope. A revision script legally has neither, and a caller that
dereferences one unguarded takes down the render of every revision lesson in
the batch at once.
"""
import d0_route
import panellint

# The three groups, in the order the page prints them, with the words the
# teacher reads rather than the keys the JSON uses.
LEVELS = (
    ("beginner", "BEGINNER", "building the foundations"),
    ("intermediate", "INTERMEDIATE", "the chapter, made simpler"),
    ("advanced", "ADVANCED", "at grade level and beyond"),
)


class Unfit(Exception):
    """This revision day's shape is wrong, and the lint said so before any cost."""

    def __init__(self, findings):
        self.findings = findings
        Exception.__init__(self, "; ".join(
            "%s %s" % (f["id"], f["name"]) for f in findings))


def _val(d, key):
    v = (d or {}).get(key)
    return v if v not in (None, "") else None


def _pages(page_truth, pages):
    """The printed pages this day revises, as a teacher would say it.

    "10-12" where they run, "1, 4, 9" where they do not, and a single page as
    itself -- a one-page range reads like a typo.
    """
    src = pages if pages is not None else [page_truth]
    got = sorted({p.get("printed_page_number") for p in (src or [])
                  if (p or {}).get("printed_page_number") is not None})
    if not got:
        return ""
    if len(got) == 1:
        return str(got[0])
    if got[-1] - got[0] + 1 == len(got):
        return "%d-%d" % (got[0], got[-1])
    return ", ".join(str(n) for n in got)


def _provenance(pt, pages):
    ch = (pt or {}).get("chapter") or {}
    return {
        "book_stem": (pt or {}).get("book_stem") or "",
        "grade": (pt or {}).get("grade"),
        "subject": (pt or {}).get("subject"),
        "chapter": "Ch.%s · %s" % (ch.get("number"), ch.get("title")),
        "printed_pages": _pages(pt, pages),
    }


def _glance(rp, minutes):
    """What she reads before the children arrive: the plan, and the board."""
    return {
        "number": 1,
        "kind": "glance",
        "orientation": "portrait",
        "minutes": minutes,
        "grouping_note": _val(rp, "groupingNote") or "",
        "groups": [{
            "level": key,
            "label": label,
            "subtitle": sub,
            "focus": _val(rp[key], "focus") or "",
            "board": [l for l in (rp[key].get("board") or []) if l],
        } for key, label, sub in LEVELS],
    }


def _explain(rp):
    """The re-teaching itself. Quality here matters more than item count."""
    return {
        "number": 2,
        "kind": "explain",
        "orientation": "landscape",
        "aspect": "4:3",
        "minutes": 15,
        "panels": [{
            "level": key,
            "label": label,
            "say": _val(rp[key]["explain"], "say") or "",
            "say_local": _val(rp[key]["explain"], "sayLocal"),
        } for key, label, _ in LEVELS],
    }


def _practice(rp):
    """One modelled item per group, then the items they do alone.

    The answers are gathered into a single footnote and removed from the cards
    above it. A child sitting in front of the page must not be able to read
    the answer to the item they are working.
    """
    panels, answers = [], []
    for key, label, _ in LEVELS:
        guided = rp[key]["guided"]
        items = [o for o in (rp[key].get("practice") or []) if o]
        panels.append({
            "level": key,
            "label": label,
            "guided": {k: v for k, v in
                       (("prompt", _val(guided, "prompt")),
                        ("strategy", _val(guided, "strategy")))
                       if v is not None},
            "practice": [{"number": i + 1, "prompt": _val(o, "prompt")}
                         for i, o in enumerate(items)],
        })
        answers.append("%s guided: %s" % (label, _val(guided, "answer")))
        answers.extend("%s %d. %s" % (label, i + 1, _val(o, "answer"))
                       for i, o in enumerate(items))
    return {
        "number": 3,
        "kind": "practice",
        "orientation": "landscape",
        "aspect": "4:3",
        "minutes": 20,
        "panels": panels,
        "empty_answer_boxes": True,
        "answers": answers,
    }


def _exit(rp):
    """A one-minute check per group, each at that group's own level."""
    return {
        "number": 4,
        "kind": "exit",
        "orientation": "landscape",
        "aspect": "4:3",
        "minutes": 5,
        "panels": [{
            "level": key,
            "label": label,
            "prompt": _val(rp[key]["exit"], "prompt") or "",
            "answer": _val(rp[key]["exit"], "answer") or "",
        } for key, label, _ in LEVELS],
    }


def build(enr, page_truth, segment=None, pages=None):
    """The four pages of one revision day.

    `enr`        the authored revision envelope (its `generated` payload)
    `page_truth` one Stage-A page record, for provenance
    `segment`    the curriculum-matrix row, so the route check can read either
    `pages`      every resolved page the day revises, where it spans several

    Returns the page set. Raises `WrongRoute` if this is not a revision day at
    all, and `Unfit` if it is one with nothing in it. Both refuse loudly: the
    silent fallback -- rendering the ordinary lesson pages instead -- is the
    original defect, and it costs a render slot every time.

    More than four pages would be fine here; the LP page cap does not apply to
    a 990. Four is what the three groups need.
    """
    what = d0_route.kind(enr, segment)
    if what != "revision":
        raise d0_route.WrongRoute(
            "%s is a %s segment and has no revision panels to build — %s"
            % ((enr or {}).get("lesson_id") or "this segment", what,
               d0_route.ROUTES.get(what, "it is an ordinary lesson plan")))

    found = panellint.findings(enr, segment)
    if found:
        raise Unfit(found)

    gen = enr["generated"]
    rp = panellint.panels_of(gen)
    minutes = _val(gen, "minutes") or 40
    return {
        "doc_id": (enr.get("lesson_id") or "").upper(),
        "doc_type": "revision_pages",
        "schema_version": "1.0",
        "title": _val(gen, "title") or "Revision Day",
        "provenance": _provenance(page_truth, pages),
        "minutes": minutes,
        "pages": [_glance(rp, minutes), _explain(rp), _practice(rp),
                  _exit(rp)],
    }
