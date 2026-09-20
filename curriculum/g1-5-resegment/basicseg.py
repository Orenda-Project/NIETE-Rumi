"""A segment row for a period the book never claimed.

`basics` names the 366 basics periods. Nothing downstream can act on a name:
Stage C reaches a lesson through `corpus/seg/<book>.json`, so a period with
no row there has no route, no brief and no render. This mints the row.

Two constraints shape it, and they pull against each other.

THE INDEX MUST NOT MOVE. `judgerun` finds an authored artefact by
`<stem>_ch<n>_seg<i>.json`, so the index is the artefact's address. Numbering
basics rows by where they fall in the year would re-address all of them the
next time a chapter is folded, split or re-paced, and authored work would
re-attach to a different day without anything failing. The index is therefore
computed from (skill, ordinal) -- the identity `basics` already guarantees --
inside a band no real day occupies. Measured 20 Sep 2026: no real
`segment_index` exceeds 99, and the only values above it anywhere in the
corpus are the tail sentinels 990 (review) and 995 (assessment), 233 of each.
The band below them is free.

THE SLO IS THE ONE THE LESSON STATES. Amena, 20 Sep 2026: *"slo codes should
cover the SLOs that the lesson states, support slos make sense, objective is
student facing SLO."* A basics period is not free-floating. `_grounding` has
already tied it to ONE teaching day -- the day whose pages it works on -- and
what it rehearses is what that day taught. So the row states that day's codes
and descriptions. Measured the same day, all 366 periods ground on a day that
carries both, and none falls back to the whole chapter.

`supports_slo_codes` stays the chapter union: the wider claim, that the skill
feeds these objectives over the weeks, in the separate field it has always
been in. The objective is the day's own SLO said in the child's voice --
`basicslo` holds that wording, so the rule is arguable on its own.

THE PERIOD SHOWN IS NOT THE CONTENT BUDGET. Amena, same day: *"what we assume
as perfect 40 is too long for teachers, so we make it shorter and show the
teacher 40, something she can practically implement. The opening and
explanation take"* [the rest]. `d0_primary` renders `duration_min` as the
`period_minutes` the teacher reads, so the row says 40 -- her timetabled
period. The steps are authored to `content_min`, the working core left once
settling the class and explaining the task have taken their share. 30 is the
corpus's own dominant authored length (1,635 of 2,039 days), so the split is
the shape the books already have rather than one invented here.
"""

import basicslo

# One 20-wide lane per skill, so an index depends only on (skill, ordinal)
# and never on the year. Adding a skill appends a lane; it never renumbers an
# existing one, which is the property that keeps authored work attached.
SLOT = {
    "number_fluency": 0,
    "concrete": 1,
    "word_problem": 2,
    "communicative": 3,
    "phonics": 4,
    "arkaan_saazi": 5,
    "investigate_handson": 6,
    "engage_hook": 7,
}

NAME = {
    "number_fluency": "Number Fluency",
    "concrete": "Concrete Maths",
    "word_problem": "Word Problems",
    "communicative": "Communicative Language",
    "phonics": "Phonics",
    "arkaan_saazi": "ارکان سازی / Syllables",
    "investigate_handson": "Investigate (hands-on)",
    "engage_hook": "Engage Hook",
}

LANE = 20
BASE = 800
MAX_ORDINAL = LANE - 1          # 1..19; the largest real group is 16

# What the teacher is shown, and what the steps are actually budgeted for.
# See the docstring: the period is hers, the content is shorter than it on
# purpose. Flat for every basics row -- one reusable shape per skill, only
# the numbers changing week to week, is what makes the routine runnable from
# memory by week two. A design decision, not a measurement.
PERIOD_MIN = 40
CONTENT_MIN = 30


def index_of(skill, ordinal):
    """The stable `segment_index` for the nth basics period of one skill."""
    if skill not in SLOT:
        raise KeyError(
            "no index lane for basics skill %r -- add it to basicseg.SLOT; "
            "an invented lane would overlap another skill's" % skill)
    if not 1 <= ordinal <= MAX_ORDINAL:
        raise ValueError(
            "ordinal %d is outside the %d-wide lane for %r. Wrapping it would "
            "collide with the next skill's lane, which is the one failure "
            "nothing downstream would notice" % (ordinal, LANE, skill))
    return BASE + SLOT[skill] * LANE + ordinal


def _pages(rows, key):
    out = sorted({p for r in rows for p in (r.get(key) or [])})
    return out


# The two days at the end of every chapter. Written out rather than imported
# because this module imports nothing -- which is what lets it be tested
# without the corpus, and the corpus is gitignored. `covdata.BOOKKEEPING` is
# the same set, and a test pins the two together so the copy cannot drift.
BOOKKEEPING = {"revision", "assessment", "review_assess", "duhrai", "jaiza"}


def _teaches(row):
    """Is this a day the chapter is taught on, rather than tested on?"""
    return (row.get("skill_type") or "") not in BOOKKEEPING


def _usable(rows, closer=None):
    """Is there anything here to build a drill from?

    Page numbers are the first question and used to be the only one. The
    second is whether those pages carry anything to drill: measured 20 Sep
    2026, 43 of the 366 periods ground on a chapter's Connect-and-Create tail
    and nothing else -- a materials list and a multi-day instruction, no
    worked content and no keyed exercises. `grade_3_math_ch7_nf1` is the
    clearest: a number-fluency period on tenths and hundredths anchored on
    printed page 137, which prints no numbers at all, while the chapter's own
    practice pages 133 to 136 carry fourteen keyed exercises and go unused.

    `closer(printed_page)` is how the caller lends this module its page truth.
    It is optional and the default is page-blind, because this module imports
    nothing -- that is what lets it be tested without the gitignored corpus.
    A day that merely runs onto the tail page keeps its own pages; only a day
    that is nothing but tail is refused.
    """
    printed = _pages(rows, "pages_printed")
    if not printed and not _pages(rows, "pages_pdf"):
        return False
    if closer is not None and printed and all(closer(p) for p in printed):
        return False
    return True


def _grounding(record, chapter_rows, closer=None):
    """The rows this period is built from: one teaching day where there is one.

    The whole chapter is the fallback, not the intent. Measured 20 Sep 2026 it
    gives a median of 13 pages against a real day's 2, and for a period early
    in a chapter those pages include ones the class has not opened. `near` is
    the book day the allocator anchored this period to.

    It walks past the chapter's own 990 revision and 995 assessment days. They
    are the last periods of a chapter, so the allocator stamps them on 62 of
    the 366 periods; their page spans are the whole chapter, and a drill built
    from the assessment is built from the test rather than from the lesson.
    The nearest teaching day is taken instead, preferring the one before --
    the class has been there.
    """
    near = record.get("near")
    if near is None:
        return chapter_rows, None

    day = [r for r in chapter_rows if r.get("segment_index") == near]
    if not day:
        # The stamp names a day this chapter does not have, so the two
        # disagree. Walking to a "nearest" day would be inventing a neighbour
        # out of an inconsistency; the chapter is broad but it is true.
        return chapter_rows, None
    if _teaches(day[0]) and _usable(day, closer):
        return day, near

    teaching = [r for r in chapter_rows
                if _teaches(r) and r.get("segment_index") is not None
                and _usable([r], closer)]
    if not teaching:
        return chapter_rows, None
    # Distance first, then the earlier day on a tie: a period sitting between
    # two lessons rehearses the one that has already happened.
    pick = min(teaching, key=lambda r: (abs(r["segment_index"] - near),
                                        r["segment_index"]))
    return [pick], pick["segment_index"]


def _slos(ground):
    """The grounding rows' codes and descriptions, paired by position.

    `cbrief._slo` zips the two lists, so a row whose description list is
    shorter than its code list would slide every later description onto the
    wrong code. Measured 20 Sep 2026 eight of the 366 do exactly that, so
    each row is padded to its own length before the next is appended.
    """
    codes, descriptions = [], []
    for r in ground:
        c = list(r.get("slo_codes") or [])
        d = list(r.get("slo_descriptions") or [])[:len(c)]
        codes.extend(c)
        descriptions.extend(d + [""] * (len(c) - len(d)))
    return codes, descriptions


def segment(record, chapter_rows, closer=None):
    """A `corpus/seg`-shaped row for one `basics.records()` entry.

    `chapter_rows` are the real segments of the chapter the period is
    anchored to. They supply the grounding: the pages, the title, and the
    objectives this period feeds.
    """
    skill = record["skill"]
    if not chapter_rows:
        raise ValueError(
            "%s is anchored to chapter %s but that chapter has no segments, "
            "so there are no pages to teach it from. Every basics template "
            "works on the chapter's own words and numbers -- the class never "
            "leaves the book -- so an ungrounded basics row is not buildable"
            % (record["id"], record["chapter"]))

    ground, near = _grounding(record, chapter_rows, closer)
    printed, pdf = _pages(ground, "pages_printed"), _pages(ground, "pages_pdf")
    if not printed and not pdf:
        raise ValueError("%s: chapter %s carries no page numbers at all"
                         % (record["id"], record["chapter"]))

    titles = [r.get("chapter_title") for r in chapter_rows if r.get("chapter_title")]
    codes, descriptions = _slos(ground)

    return {
        "segment_index": index_of(skill, record["ordinal"]),
        "day_label": "%s %d" % (NAME[skill], record["ordinal"]),
        "chapter_number": record["chapter"],
        "chapter_title": titles[0] if titles else "",
        "topic": "%s, anchored in %s" % (NAME[skill],
                                         titles[0] if titles else "this chapter"),
        "skill_type": skill,
        "pages_printed": printed,
        "pages_pdf": pdf,
        # The grounding day's own SLOs -- what this period rehearses. The
        # chapter's wider set is a different claim and lives one line down.
        "slo_codes": codes,
        "slo_descriptions": descriptions,
        "supports_slo_codes": sorted({c for r in chapter_rows
                                      for c in (r.get("slo_codes") or [])}),
        "objective": basicslo.objective(skill, descriptions),
        "duration_min": PERIOD_MIN,
        "content_min": CONTENT_MIN,
        "new_or_revision": "new",
        "prev_segment_id": None,
        "next_segment_id": None,
        "is_basics": True,
        # The book day the pages came from, or None where the row fell back to
        # the whole chapter. Stated so a reader can tell the two apart.
        "basics_near": near,
        "basics_id": record["id"],
        "basics_kind": record["kind"],
    }
