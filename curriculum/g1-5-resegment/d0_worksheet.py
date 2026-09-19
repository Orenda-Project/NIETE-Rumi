"""Stage D0 — the 995 route: a student worksheet and its own answer key.

A chapter assessment is not a lesson plan with the teaching removed. It is a
sheet a six-year-old writes on, and a second document the teacher marks from.
Before `d0_route` existed this module did not, and every 995 in the corpus
rendered through `d0_primary` onto v9's RECALL: four colour pages of teacher
script, well formed, gate-clean, and impossible to hand to a child.

ONE SOURCE, TWO ARTEFACTS, and the split is the check. A worksheet and a key
authored separately drift -- the key loses a question, or answers one the sheet
stopped asking -- and the teacher finds out at the front of the class. So one
`questions[]` is divided here: what the child reads goes on the sheet, what the
teacher needs goes on the key, and nothing is written twice.

Which side a field falls on is the guarantee, not a layout preference:

  `answer`, `marking`, `common_errors`, `model_solution` are the key. On the
  sheet they are a leaked answer.

  `directive` is the teacher's instruction about the question ("work alone for
  this one"). Printed as child text it is noise a child cannot act on, which
  is why `wslint` refuses it there -- but it is not dropped, it moves.

  `childText` is on BOTH, because a key that says only "q3: bat" cannot be
  read at arm's length while twenty children wait.

The sheet renders body-only with the top of the page left blank, and the
header -- logo, grade, marks, the name-and-date row -- is composited after,
deterministically. A header drawn by the same pass as the body is a header
that drifts by a few millimetres per sheet and never lines up in a stack of
forty.

`wslint` runs first and this refuses on any finding. The lint is free, the
render is not, and a shape defect found after generation has already been paid
for.
"""
import d0_route
import wslint

# The header is composited, so the body must leave room for it. Measured off
# the skill's worksheet route: roughly the top eighth of the page.
HEADER_BAND = 0.12

# What the child never sees. Named once, used by the split and by the test
# that proves nothing leaked.
KEY_ONLY = ("answer", "marking", "common_errors", "model_solution",
            "open_personal", "directive")

# What the sheet prints, in the order it prints it.
SHEET_FIELDS = ("id", "type", "marks", "childText", "options", "pairs",
                "space", "illustration")


class Unfit(Exception):
    """This worksheet's shape is wrong, and the lint said so before any cost."""

    def __init__(self, findings):
        self.findings = findings
        Exception.__init__(self, "; ".join(
            "%s %s" % (f["id"], f["name"]) for f in findings))


def _val(d, key):
    v = (d or {}).get(key)
    return v if v not in (None, "") else None


def _pages(page_truth, pages):
    """The printed pages a chapter-wide sheet covers, as a teacher would say it.

    "1-11" where they run, "1, 4, 9" where they do not, and a single page as
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


def _sheet_question(q, number):
    """One question as the child meets it. Nothing else comes across."""
    out = {"number": number}
    for f in SHEET_FIELDS:
        v = _val(q, f)
        if v is not None:
            out[f] = v
    # Space is the room to write, and a question that needs none still says so
    # rather than leaving the renderer to guess.
    out.setdefault("space", "none")
    return out


def _key_answer(q, number):
    """One question as the teacher marks it, readable on its own."""
    out = {"number": number, "id": _val(q, "id"), "type": _val(q, "type"),
           "marks": _val(q, "marks"), "childText": _val(q, "childText"),
           "open_personal": bool((q or {}).get("open_personal")),
           "common_errors": list((q or {}).get("common_errors") or [])}
    for f in ("answer", "marking", "model_solution", "directive"):
        v = _val(q, f)
        if v is not None:
            out[f] = v
    return out


def build(enr, page_truth, segment=None, pages=None):
    """The two documents of one chapter assessment.

    `enr`        the authored assessment envelope (its `generated` payload)
    `page_truth` one Stage-A page record, for provenance
    `segment`    the curriculum-matrix row, so the route check can read either
    `pages`      every resolved page the sheet draws on, where the assessment
                 is chapter-wide -- which it normally is

    Returns `{"worksheet": ..., "answer_key": ...}`. Raises `WrongRoute` if
    this is not an assessment at all, and `Unfit` if it is one of the wrong
    shape. Both refuse loudly: a silent fallback was the original defect.
    """
    what = d0_route.kind(enr, segment)
    if what != "assessment":
        raise d0_route.WrongRoute(
            "%s is a %s segment and has no worksheet to build — %s"
            % ((enr or {}).get("lesson_id") or "this segment", what,
               d0_route.ROUTES.get(what, "it is an ordinary lesson plan")))

    found = wslint.findings(enr, segment)
    if found:
        raise Unfit(found)

    gen = enr["generated"]
    qs = gen.get("questions") or []
    prov = _provenance(page_truth, pages)
    stem = (enr.get("lesson_id") or "").upper()
    total = gen.get("total_marks")

    header = {
        "composite": True,
        "blank_fraction": HEADER_BAND,
        "logo": True,
        "grade": prov["grade"],
        "subject": prov["subject"],
        "chapter": prov["chapter"],
        "total_marks": total,
        "name_date_row": True,
    }

    worksheet = {
        "doc_id": stem,
        "doc_type": "worksheet",
        "schema_version": "1.0",
        "title": _val(gen, "title") or "",
        "instructions": _val(gen, "instructions") or "",
        "header_band": header,
        "provenance": prov,
        "questions": [_sheet_question(q, i + 1) for i, q in enumerate(qs)],
        "total_marks": total,
    }

    answer_key = {
        "doc_id": stem + "_ANSWER_KEY",
        "doc_type": "answer_key",
        "schema_version": "1.0",
        "title": (worksheet["title"] + " — Answer Key").strip(" —"),
        "header_band": dict(header, name_date_row=False),
        "provenance": prov,
        "answers": [_key_answer(q, i + 1) for i, q in enumerate(qs)],
        "total_marks": total,
        "notes": {"gaps": [n for n in (gen.get("notes") or [])
                           if isinstance(n, str)]},
    }
    return {"worksheet": worksheet, "answer_key": answer_key}
