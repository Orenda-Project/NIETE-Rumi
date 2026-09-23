"""Day-integrity rules: who owns an SLO, and who owns a printed page.

Two rules decide everything a day row says about itself beyond its own text.

  Rule 1 — every SLO has exactly one introducing day. Later days on the same
           code develop it. A day that introduces more than one SLO in forty
           minutes is not a day, and gets flagged as one to split.
  Rule 2 — printed pages are never reassigned. Where two days both claim a
           page, both keep it and each names the other, so the overlap is a
           visible fact rather than a silent edit.
"""
from collections import defaultdict

import skills

PENDING = "pending"

STRAND_MAP = {
    "RD": "input", "LS": "input", "LC": "input", "TX": "input",
    "WR": "output", "OC": "output", "CO": "output",
    "GR": "language-focus", "VO": "language-focus", "VG": "language-focus",
    "PH": "language-focus", "PA": "language-focus", "EM": "language-focus",
    "LG": "language-focus",
}
# skill_type overrides strand where the skill is explicitly a fluency skill
FLUENCY_SKILLS = {"buland_khwani"}


# --------------------------------------------------------------------------
# Rule 1 — every SLO has one introducing day; later days develop it
# --------------------------------------------------------------------------

#: Row types whose `slo_descriptions` is ONE sentence about the whole day
#: rather than one sentence per code -- an assessment worksheet and a
#: chapter review both write "assesses/consolidates the chapter's SLOs"
#: beside every code the chapter touched.
DAY_LEVEL_TYPES = frozenset(("assessment", "revision"))


def slo_lexicon(days):
    """Every code's own sentence, as this book's teaching days state it.

    A day carries `slo_codes` and `slo_descriptions` as two parallel lists,
    and on 369 of the corpus's segments the second is shorter than the
    first: 346 of them are assessments and chapter reviews carrying one
    day-level sentence beside five codes, and 13 are Grade 5 Urdu days that
    describe the first of two codes. Pairing the lists by position
    therefore truncates, and 2,034 supporting codes reached the Curriculum
    Matrix bare -- a code in one column and an empty cell beside it.

    The sentence is not missing from the book; it is on the ordinary
    teaching day that introduced the code. This collects those, and ONLY
    those: a day-level summary describes no single code, so letting one in
    would print "assesses the chapter's SLOs" beside a phonics code and the
    sheet would look filled while saying nothing.

    Keyed by chapter first, because 77 codes are worded differently in
    different chapters (a vocabulary code names that chapter's new words).
    The day's own chapter wins; the book is the fallback.
    """
    book, by_chapter = {}, {}
    for day in days:
        if (day.get("lp_type") or "") in DAY_LEVEL_TYPES:
            continue
        for code, desc in zip(day.get("slo_codes") or [],
                              day.get("slo_descriptions") or []):
            if desc:
                book.setdefault(code, desc)
                by_chapter.setdefault((day.get("chapter_number"), code), desc)
    return book, by_chapter


def _describe(code, own, chapter, book, by_chapter):
    """What this day says about a code, or what the book says, or nothing.

    Nothing, deliberately, where no teaching day describes it: three codes
    (`E-05-LG-09`, `E-05-WR-27`, `U-05-PH-01 [DERIVED]`) are listed only by
    days that summarise, and an invented sentence on the sheet is worse
    than a visible gap -- the gap is a fact about the curriculum.
    """
    return (own.get(code) or by_chapter.get((chapter, code))
            or book.get(code) or "")


def _taught(day):
    """The codes a day teaches in its own right.

    Everything except what dayfold Rule 3 folded into it from a chapter
    revision: those are spiralled, and a spiral is by definition a second
    sighting even when it is the first one in the book. Excluding them from
    `first_seen` as well as from the primary keeps the introduction where the
    teaching is -- a later day that genuinely teaches the code still gets to
    say `introduces`.
    """
    folded = set(day.get("folded_slo_codes") or [])
    return [c for c in (day.get("slo_codes") or []) if c not in folded]


def assign_slo_roles(days):
    """Name each day's primary SLO and what the day does with it.

    Most books list fewer distinct SLOs than teaching days (G4 English: 23 SLOs
    across 99 days), so "one SLO per day" is not arithmetically available and
    would be a deletion in disguise. What is available, and is what the warm-up
    defect actually needs, is the introduce/develop distinction: the first day
    listing a code teaches it new, every later day builds on it.

    Nothing is dropped. The day's other codes stay in `supporting`.
    """
    first_seen = {}
    for idx, day in enumerate(days):
        for code in _taught(day):
            first_seen.setdefault(code, idx)

    book, by_chapter = slo_lexicon(days)

    out = []
    for idx, day in enumerate(days):
        codes = day.get("slo_codes") or []
        descs = day.get("slo_descriptions") or []
        # A day-level row's `descs` is one sentence about the day, not a
        # list running parallel to `codes`; zipping it pins that sentence to
        # whichever code happens to be listed first. Such a row describes no
        # code of its own, so every code on it is read from the lexicon and
        # the day-level sentence stays where it belongs, in Topic and Notes.
        by_code = ({} if (day.get("lp_type") or "") in DAY_LEVEL_TYPES
                   else dict(zip(codes, descs)))
        chapter = day.get("chapter_number")
        own = _taught(day)
        new = [c for c in own if first_seen.get(c) == idx]
        primary = (new or own or codes or [None])[0]
        said = lambda c: _describe(c, by_code, chapter, book, by_chapter)
        out.append({
            "primary_slo": primary,
            "primary_slo_desc": said(primary) if primary else "",
            "slo_role": "" if primary is None
                        else ("introduces" if new else "develops"),
            "new_codes": new,
            "supporting_slos": [c for c in codes if c != primary],
            "supporting_descs": [said(c) for c in codes if c != primary],
        })
    return out


# --------------------------------------------------------------------------
# Rule 2 — printed pages are left alone; contested pages are named
# --------------------------------------------------------------------------

def page_overlaps(days):
    """Which other days claim this day's printed pages.

    Pages are not reassigned here. A shared page is sometimes real (one poem
    read across three Urdu days) and sometimes the boundary defect (a Maths day
    that starts on the page the previous day finished). Telling them apart needs
    the page text, which is the rebuild pass. This pass names the conflict.
    """
    claims = defaultdict(list)
    for idx, day in enumerate(days):
        for page in day.get("pages_printed") or []:
            claims[page].append(idx)

    out = []
    for idx, day in enumerate(days):
        shared = {}
        for page in day.get("pages_printed") or []:
            others = [i for i in claims[page] if i != idx]
            if others:
                shared[page] = others
        out.append(shared)
    return out


def overlap_label(shared, days):
    if not shared:
        return ""
    parts = []
    for page, others in sorted(shared.items()):
        who = ", ".join(sorted({days[i].get("day_label", "?") for i in others}))
        parts.append(f"p.{page} also {who}")
    return "; ".join(parts)


# --------------------------------------------------------------------------
# Derived fields
# --------------------------------------------------------------------------

def strand_for(primary_slo, skill_type):
    if skill_type in FLUENCY_SKILLS:
        return "fluency"
    if not primary_slo:
        return PENDING
    parts = primary_slo.split("-")
    if len(parts) < 3:
        return PENDING
    return STRAND_MAP.get(parts[2], PENDING)


def pages_label(pages):
    if not pages:
        return ""
    pages = sorted(pages)
    runs, start, prev = [], pages[0], pages[0]
    for p in pages[1:]:
        if p == prev + 1:
            prev = p
            continue
        runs.append((start, prev))
        start = prev = p
    runs.append((start, prev))
    return ", ".join(str(a) if a == b else f"{a}-{b}" for a, b in runs)
