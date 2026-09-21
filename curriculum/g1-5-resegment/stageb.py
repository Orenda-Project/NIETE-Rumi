"""Stage B — day-integrity repair and row build for the G1-5 re-segmentation.

Input  : the 17 per-book segmentation JSONs (page-truth derived).
Output : one row per teaching day, with SLO ownership resolved, page ranges made
         disjoint, and every derived field labelled with how it was derived.

Nothing is invented. A field we cannot compute yet is written as "pending"
(see PENDING) rather than filled with a proxy.
"""
import json
import re
from collections import defaultdict

import cpaopen
import cparamp
import cpatrust
import dayfold
import dayrules
import skills

PENDING = "pending"

SUBJECT_OF = {"english": "English", "urdu": "Urdu", "math": "Maths",
              "maths": "Maths", "general_science": "Science"}

LANG_SUBJECTS = {"English", "Urdu"}


def book_meta(stem):
    """grade_4_general_science -> (4, 'Science')."""
    parts = stem.split("_")
    grade = int(parts[1])
    subject = SUBJECT_OF["_".join(parts[2:])]
    return grade, subject


def is_day(seg):
    t = seg.get("lp_type")
    if t is not None:
        return t == "content"
    return str(seg.get("day_label", "")).startswith("Day")


def row_kind(seg):
    """Teaching days, chapter assessments and chapter reviews all consume a
    calendar day, so all three become rows. Only days carry SLO ownership."""
    if is_day(seg):
        return "day"
    label = str(seg.get("day_label", "")).lower()
    t = (seg.get("lp_type") or "").lower()
    if t == "assessment" or "assessment" in label:
        return "assessment"
    return "review"


DASH = "\u2014"
QUOTES = "'\u2018\u2019\"\u201c\u201d"


def _title_from_tail(topic):
    """Chapter tails name their chapter around an em dash:
      "Chapter 3 Assessment Worksheet \u2014 'Pinky's Yummy Tummy Team-Up!' (student...)"
      "Green Guardians of Earth \u2014 Chapter Review (Mastery Challenge)"
    Take the half that is not the tail's own label.
    """
    if DASH not in topic:
        return None
    left, right = [p.strip() for p in topic.split(DASH, 1)]
    part = right if left.lower().startswith("chapter") else left
    part = re.sub(r"\s*\([^)]*\)\s*$", "", part).strip()
    part = re.sub(r"\s*(\u2014\s*)?Chapter Review\s*$", "", part, flags=re.I).strip()
    part = part.strip(QUOTES).strip()
    return part or None


def chapter_titles(segments):
    """chapter_number -> printed chapter name.

    Urdu and Science carry `chapter_title`. English and Maths do not, but their
    chapter assessment rows name the chapter in quotes, which is page truth.
    """
    out = {}
    for seg in segments:
        ch = seg.get("chapter_number")
        if ch is None or ch in out:
            continue
        if seg.get("chapter_title"):
            out[ch] = seg["chapter_title"]
    for seg in segments:
        ch = seg.get("chapter_number")
        if ch is None or ch in out or is_day(seg):
            continue
        name = _title_from_tail(seg.get("topic") or "")
        if name:
            out[ch] = name
    return out


DAY_N = re.compile(r"^Day\s+(\d+)")
TAIL_RANK = {"review": 0, "assessment": 1}   # revise first, then check


def order_segments(segments):
    """A chapter in the order it is taught. Nothing downstream sorts.

    Two inversions live in the source files. Urdu writes its دہرائی
    (revision) and جائزہ (assessment) as ordinary Day rows, and every chapter
    of all five books carries the assessment — the LATER day number — first,
    so the sheet printed day 10 above day 9. English does the same with a
    labelless "Assessment" above its "Day 8 (Review)". Maths and Science name
    neither with a day number and put "Assessment" above "Chapter Review".

    So: chapters keep the order they first appear in; inside a chapter the day
    rows sort on their own day number, and the rows without one follow, revise
    before check. The final index keeps the sort stable, so a book already in
    order is untouched (Maths, Science and Grade 4 English move nothing).
    """
    order = {}
    for seg in segments:
        order.setdefault(seg.get("chapter_number"), len(order))

    def key(pair):
        i, seg = pair
        hit = DAY_N.match(str(seg.get("day_label") or "").strip())
        if hit:
            return (order[seg.get("chapter_number")], 0, int(hit.group(1)), i)
        return (order[seg.get("chapter_number")], 1,
                TAIL_RANK.get(row_kind(seg), 1), i)

    return [seg for _i, seg in sorted(enumerate(segments), key=key)]


def load_book(path):
    """The one door the corpus comes through (build.py calls nothing else).

    Every rule that rewrites a day runs here, after the teaching order is
    settled and before any consumer sees a segment, because `segments` goes
    to build_rows
    AND to the calendar. Applied at either call site instead, the subject tab
    and the calendar would be free to disagree about how many periods the same
    chapter costs — which is exactly what happened when Grade 1's revision
    fold first lived inside the allocator: the calendar counted 98 English
    periods while Coverage and the FDE tab counted 110. The same reasoning
    covers the CPA ramp, which renames rather than folds: a day the calendar
    calls abstract and the subject tab calls the bridge is worse than either.
    The order inside this door is load-bearing too: cpatrust drops a concrete
    label the page does not support, and cpaopen only opens a chapter that has
    no concrete day left, so reversing the two leaves Grade 5 untouched.
    """
    with open(path) as fh:
        doc = json.load(fh)
    stem = doc["_meta"]["book_stem"]
    grade, subject = book_meta(stem)
    segments = order_segments(doc["segments"])
    # Read off the book as written, before the fold removes the Grade 1
    # Maths revision days that open chapters 2 onward captioned `Day 1`.
    scheme = dayfold.numbering_scheme(segments)
    segments, _freed = dayfold.fold_revision(segments, subject, grade)
    # Immediately, and here rather than in the allocator, for the same
    # reason the fold itself lives behind this door: a chapter whose days
    # are numbered differently on the calendar and on the subject tab is
    # worse than either numbering. See bd-6kp1a.
    segments = dayfold.renumber_days(segments, scheme)
    segments, _swaps = dayfold.complete_5e(segments, subject)
    segments, _read = cpatrust.trust_page(segments, subject)
    segments, _opened = cpaopen.open_concrete(segments, subject)
    segments, _named = cparamp.name_abstract(segments, subject)
    return stem, grade, subject, doc["_meta"], segments


REVIEW_SKILLS = {"revision", "duhrai", "assessment", "review_assess"}


def day_flags(day, role, shared):
    flags = []
    if day.get("fold_note"):
        # First, because it explains the row. A day that absorbed a
        # revision carries SLOs its siblings do not, and without this the
        # only evidence on the tab is that the last teaching day of the
        # chapter has four supporting codes for no stated reason.
        flags.append(day["fold_note"])
    if not day.get("slo_codes"):
        flags.append("no SLO in source — human review")
    elif len(role["new_codes"]) > 1 and day.get("skill_type") not in REVIEW_SKILLS:
        flags.append(f"introduces {len(role['new_codes'])} SLOs in one period")
    if "+" in (day.get("topic") or ""):
        flags.append("stapled topic — split candidate")
    pages = day.get("pages_printed") or []
    if pages and len(shared) == len(pages) and day.get("skill_type") not in REVIEW_SKILLS:
        # A shoulder page shared with the next day is normal — one page can
        # legitimately carry three Urdu days. Every page shared is different:
        # the day has no page of its own, so its boundary needs confirming.
        flags.append("all printed pages shared — confirm boundary")
    if day.get(cpatrust.MARK):
        # Before the opener, because on eleven Grade 5 days both fire: the
        # heading's claim was dropped and the day then re-opened honestly.
        # Read in this order the pair is one sentence about one day.
        flags.append(f"skill type re-read — {day[cpatrust.MARK]}")
    if day.get("concrete_added"):
        flags.append(f"concrete opener added — {day['concrete_added']}")
    return " · ".join(flags)


# What the FDE syllabus breakdown says about a chapter the book contains.
IN_SYLLABUS = "In FDE syllabus"
OMITTED = "Omitted by FDE"


def build_rows(stem, grade, subject, segments, syllabus=None):
    """syllabus: the chapter numbers FDE's breakdown teaches, or None if we
    could not read a breakdown for this book. A chapter the book carries and
    the breakdown skips is labelled, never dropped — the deviation is the
    thing worth seeing."""
    days = [s for s in segments if is_day(s)]
    roles = dayrules.assign_slo_roles(days)
    shared_sets = dayrules.page_overlaps(days)
    titles = chapter_titles(segments)
    by_day = {id(d): (r, sh) for d, r, sh in zip(days, roles, shared_sets)}

    rows, cpa_conflicts = [], [0]
    for seg in segments:
        kind = row_kind(seg)
        ch = seg.get("chapter_number")
        base = {
            "kind": kind, "grade": grade, "subject": subject, "book": stem,
            "chapter": ch, "chapter_title": titles.get(ch, ""),
            "day_label": seg.get("day_label") or "",
            "segment_index": seg.get("segment_index"),
            "topic": seg.get("topic") or "",
            "skill_type": skills.label(seg.get("skill_type"), subject),
            "blooms": seg.get("blooms") or "",
            "period_min": 40, "moves": PENDING,
            "pages": dayrules.pages_label(seg.get("pages_printed") or []),
            "notes": seg.get("notes") or "",
            "fde": (PENDING if syllabus is None else
                    IN_SYLLABUS if ch in syllabus else OMITTED),
        }
        if kind != "day":
            base.update({"primary_slo": "", "primary_slo_desc": "",
                         "slo_role": "", "supporting_slos": ", ".join(seg.get("slo_codes") or []),
                         "supporting_descs": "", "overlap": "", "strand": "",
                         "flags": ""})
            rows.append(base)
            continue

        role, shared = by_day[id(seg)]
        skill = seg.get("skill_type")
        derived = skills.CPA_FROM_SKILL.get(skill)
        if subject == "Maths" and derived and seg.get("cpa_phase") \
                and derived != seg.get("cpa_phase"):
            # The source carried both a skill type and a cpa_phase for Maths
            # and they disagreed. Skill type is now the single column and the
            # authority; the count is kept as a data-quality note on the
            # Skill Taxonomy tab rather than as a flag on every day.
            cpa_conflicts[0] += 1
        base.update({
            "primary_slo": role["primary_slo"] or "",
            "primary_slo_desc": role["primary_slo_desc"],
            "slo_role": role["slo_role"],
            "supporting_slos": ", ".join(role["supporting_slos"]),
            "supporting_descs": " | ".join(d for d in role["supporting_descs"] if d),
            "overlap": dayrules.overlap_label(shared, days),
            "strand": dayrules.strand_for(role["primary_slo"], skill)
                      if subject in LANG_SUBJECTS else "",
            "flags": day_flags(seg, role, shared),
        })
        rows.append(base)

    introduces = sum(1 for r in rows if r.get("slo_role") == "introduces")
    omitted = sorted({r["chapter"] for r in rows if r.get("fde") == OMITTED}
                     - {None})
    return rows, {"days": len(days), "rows": len(rows), "chapters": len(titles),
                  "introduces": introduces, "cpa_conflicts": cpa_conflicts[0],
                  "omitted_chapters": omitted,
                  "omitted_days": sum(1 for r in rows
                                      if r.get("fde") == OMITTED and r["kind"] == "day"),
                  # Periods, not teaching days: dropping a chapter drops its
                  # revision and assessment periods with it, and the calendar
                  # allocates in periods. The two tabs have to agree.
                  "omitted_periods": sum(1 for r in rows
                                         if r.get("fde") == OMITTED),
                  "overlapping": sum(1 for s in shared_sets if s)}
