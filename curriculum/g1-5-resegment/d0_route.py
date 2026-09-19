"""Which printed object a segment is, decided once, in the engine.

Primary's type axis has three values and each one is a DIFFERENT artefact:

  content     a four-page teacher lesson plan            -> d0_primary
  assessment  a student-facing worksheet, plus a separate
              answer key as its own file                 -> d0_worksheet
  revision    three parallel Beginner / Intermediate /
              Advanced panels, with no I-Do and no You-Do -> d0_panels

The skill's Law 18 is about where that decision is allowed to live. It was
caught twice in the cloud lineage and it happened here a third time: v9's
`lp_type` enum is closed and has no worksheet variant, so `d0_primary` mapped
`assessment` onto `"RECALL"` and carried on building the five content
sections. The output was well-formed, scored clean, and was the wrong object.
A silent fallback is worse than a crash because nothing downstream can tell
the difference.

So the check is here, the caller is `to_lp_doc` itself rather than any script
that happens to call it, and the refusal is loud enough to name the route it
should have taken.

Guard the vocabulary, not the English word. The corpus spells these five
ways across 466 segments — `duhrai` (72) and `review_assess` (18) are
revision, `jaiza` is the Urdu label for assessment — and a check written
against the English word misses ninety of them.

`kind` ORs its two sources on purpose. One of them calling this a worksheet is
the whole signal; requiring both to agree is how a segment with a null
`lp_type` slips back through, and `key present but null` counts as ABSENT
everywhere (the skill says so in as many words).

Pure: no imports, no I/O, no environment. The escape hatch is a parameter the
caller passes, so the rule stays testable and the decision to override it is
visible at the call site instead of in an env var nobody reads.
"""

# جائزہ. `skills.ALIAS` renders Urdu assessment under this key, so a segment
# could legitimately carry it as its own skill_type.
ASSESSMENT = {"assessment", "jaiza"}

# دہرائی, and Science's own word for the same day.
REVISION = {"revision", "duhrai", "review_assess"}

WORKSHEET_ROUTE = (
    "a 995 is a STUDENT WORKSHEET plus a separate ANSWER KEY, not a 4-page "
    "teacher LP: build it with d0_worksheet (8-12 questions with variety, "
    "per-question mark badges, a total, real space to write) and emit "
    "<stem>_ANSWER_KEY as its own artefact carrying the answer, the marking "
    "guidance and the common errors")

PANEL_ROUTE = (
    "a 990 is three parallel Beginner / Intermediate / Advanced panels and "
    "legally has NO iDo and NO youDo — it is not a lesson plan with the "
    "teaching removed: build it with d0_panels (a portrait glance page "
    "carrying the grouping note and the three board cards, then three "
    "landscape 4:3 pages — explain, practice, exit — one panel per group, "
    "with every practice answer in a single teacher footnote)")

ROUTES = {"assessment": WORKSHEET_ROUTE, "revision": PANEL_ROUTE}


class WrongRoute(Exception):
    """This artefact is not the one the caller is building."""


def _words(*sources):
    """Every type word the caller gave us, lowercased, nulls dropped.

    A key present but null is ABSENT. It is not a denial, and reading it as
    one is how an assessment with a null `lp_type` renders as a lesson.
    """
    out = []
    for src in sources:
        for key in ("lp_type", "skill_type"):
            v = (src or {}).get(key)
            if v:
                out.append(str(v).strip().lower())
    return out


def kind(enr, segment=None):
    """`content`, `assessment` or `revision` for one lesson.

    Reads the Stage-C envelope and the segment row together. Either saying
    review is enough — see the module note on why this is an OR.
    """
    words = _words(enr, segment)
    if any(w in ASSESSMENT for w in words):
        return "assessment"
    if any(w in REVISION for w in words):
        return "revision"
    return "content"


def assert_content(enr, segment=None, force=False):
    """Refuse to go on unless this segment really is a teaching day.

    `force` is the deliberate escape hatch. It exists for the one case where
    somebody genuinely wants to see what the LP renderer makes of a review
    day; it is a named argument rather than an env var so the override is
    visible where it was decided.
    """
    what = kind(enr, segment)
    if what == "content" or force:
        return what
    raise WrongRoute(
        "%s is a %s segment and must not be rendered as a lesson plan — %s"
        % ((enr or {}).get("lesson_id") or "this segment", what, ROUTES[what]))
