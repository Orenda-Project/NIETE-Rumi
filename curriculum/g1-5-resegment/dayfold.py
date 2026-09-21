"""Two rules about what a period is SPENT on, not about what it contains.

dayrules.py answers "who owns this SLO, who owns this printed page". These two
answer a different question: given a fixed number of periods in the year, is
each one buying the most teaching it can?

  Rule 3 — a chapter's revision does not need a period of its own.
           Every Urdu chapter of all five books carries one revision day AND
           one assessment day, however long or short the chapter is: 176 of
           646 Urdu rows, 27.2% of the year, spent the same way on an eight-day
           chapter and a three-day one. Folding the revision into the chapter's
           LAST TEACHING DAY frees 88 periods at zero content cost — the SLOs
           and the review work move onto that day, only the separate period
           goes. The assessment keeps its own period; a check that shares a day
           with the teaching it checks is not a check.
           Grade 1 English and Maths take the same fold, for a different
           reason: six weeks of Foundations cost 99 periods against a spare of
           66, and the 27 revision rows (E 12, M 15) are the cheapest thing in
           the book to give up. FOLDS below is the whole gate. Grades 2-5
           English and Maths hold 130 more such rows; folding them is a
           pedagogy decision, filed, not a flag to flip here.

  Rule 4 — a 5E cycle is completed by swapping a period, never by adding one.
           Science is taught on 5E and no chapter runs the whole cycle: Grade 4
           has no Engage day in 8 of its 9 chapters, Grade 5 no Apply-and-
           connect day in 5 of its 9. Both books are already at their period
           ceiling (84 and 83), so the repair retags one Investigate day rather
           than buying a tenth. A chapter always keeps at least one Investigate
           day: a complete cycle with no hands-on period in it is a worse
           lesson than an incomplete one.

THE ALIAS SEAM. `skills.ALIAS` maps the raw Urdu words onto the canonical ones
(`revision` -> `duhrai`, `assessment` -> `jaiza`) and the corpus uses BOTH
spellings — Grades 1-4 write `duhrai`, Grade 5 writes `revision`, and all five
write a raw `assessment`. Every comparison below goes through
`skills.canonical(key, subject)`. A plain `== "duhrai"` here folds four books
and silently skips the fifth, and the freed-period count comes out 16 short
with nothing to show that it is wrong. That class of bug has landed twice in
this codebase already.

  Rule 3 has a caption to keep straight as well. `day_label` is baked at
  split time, before the fold, so dropping the revision leaves the chapter
  counting Day 1 .. Day 9 and then Day 11 -- a hole that reads as a lost
  row rather than a freed period, and was reported as exactly that
  (bd-6kp1a). `renumber_days` closes it AFTER the fold, and only the
  caption: `segsplit.renumber` would have done the job and also renumbered
  `segment_index`, which is half of the key `dayobj` joins objectives on.
"""
import re

import skills

# Canonical keys for a period that consumes a day without teaching a new one.
BOOKKEEPING = frozenset(("duhrai", "jaiza", "revision", "assessment",
                         "review_assess"))

# No chapter_number can equal this, and None is a real one.
_UNSET = object()

ENGAGE = "engage_hook"
INVESTIGATE = "investigate_handson"
APPLY = "apply_connect"

# Which grades Rule 3 folds, per subject. None means every grade; a subject
# not listed is never folded. The Grade 1 entries pay for the Foundations
# block (foundations.py) and are the ONLY thing standing between the fold and
# the 130 revision periods of Grades 2-5 English and Maths.
FOLDS = {"Urdu": None, "English": frozenset({1}), "Maths": frozenset({1})}

# Stored on the host row as well as in `notes`, because `notes` may already
# hold something of its own and the tab shows this one in `Flags`: the fold
# has to be legible to a reviewer who does not know the pipeline ran.
FOLD_NOTE = "دہرائی folded in"
NOTE = {"Urdu": FOLD_NOTE}
PLAIN_NOTE = "Revision folded in"
JOIN = " · "


def _revision_key(subject):
    """The canonical spelling of "revision" in this subject — duhrai in Urdu,
    revision elsewhere. Asking skills.canonical, never comparing a literal."""
    return skills.canonical("revision", subject)


def folds(subject, grade):
    grades = FOLDS.get(subject, frozenset())
    return grades is None or grade in grades


def _key(seg, subject):
    return skills.canonical(seg.get("skill_type"), subject)


def _chapters(segments):
    """chapter_number -> the indices of its segments, in teaching order.

    Order comes from `stageb.order_segments`, which has already put each
    chapter's tail rows where the book teaches them. Nothing re-sorts here.
    """
    out = {}
    for i, seg in enumerate(segments):
        out.setdefault(seg.get("chapter_number"), []).append(i)
    return out


# --------------------------------------------------------------------------
# Rule 3 — fold the revision into the last teaching day
# --------------------------------------------------------------------------

def _absorb(host, revision, note=FOLD_NOTE):
    """The host day takes on the revision's SLOs and its name. Not its pages.

    Pages are deliberately left alone. dayrules Rule 2 says a printed page is
    never reassigned, and the revision row's `pages_printed` is the whole
    chapter's span rather than a page it teaches — unioning it would make the
    last day of every chapter claim every page in the chapter and invent a
    page conflict with each of its own siblings.
    """
    codes = list(host.get("slo_codes") or [])
    descs = list(host.get("slo_descriptions") or [])
    from_rev = revision.get("slo_descriptions") or []
    by_code = dict(zip(revision.get("slo_codes") or [], from_rev))
    for code in revision.get("slo_codes") or []:
        if code in codes:
            continue
        codes.append(code)
        if descs or from_rev:
            descs.append(by_code.get(code, ""))
    host["slo_codes"] = codes
    if descs:
        host["slo_descriptions"] = descs

    topic = (revision.get("topic") or "").strip()
    note = f"{note}: {topic}" if topic else note
    existing = (host.get("notes") or "").strip()
    host["notes"] = f"{existing}{JOIN}{note}" if existing else note
    host["revision_folded"] = True
    prior = (host.get("fold_note") or "").strip()
    host["fold_note"] = f"{prior}{JOIN}{note}" if prior else note
    return host


DAY_LABEL = re.compile(r"^Day\s+(\d+)(.*)$")


def _first_days(segments):
    """{chapter: the first `Day N` number written in it}, in book order."""
    first = {}
    for s in segments:
        m = DAY_LABEL.match(str((s or {}).get("day_label") or ""))
        if m:
            first.setdefault((s or {}).get("chapter_number"), int(m.group(1)))
    return first


def numbering_scheme(segments):
    """True where the book restarts its day count at every chapter.

    Call this BEFORE the fold, never after. Grade 1 Maths opens chapters 2
    onward with a revision day captioned `Day 1`; fold that away and the
    chapter appears to start at Day 2, which reads exactly like a book that
    counts straight through. The scheme is a property of how the book was
    written, so it is read off the book as written.

    Four of the five Urdu books and all ten English and Maths books count
    within the chapter. Grade 4 Urdu counts within the BOOK -- its chapters
    open at Day 1, 10, 17, 21, 30, 38, 46, 53, and that is what its tab
    shows today. Imposing one scheme on the other is a change to 95 rows
    that no one asked for; closing the holes is the job here.
    """
    first = _first_days(segments)
    return (not first) or set(first.values()) == {1}


def renumber_days(segments, per_chapter=True):
    """Count the days again with no gaps, and change nothing else.

    Run AFTER a fold, with the scheme `numbering_scheme` read off the book
    BEFORE it. `per_chapter` restarts the count at each chapter; otherwise
    one count runs the length of the book, resuming from whatever number
    the book opened on.

    Only `day_label` is rewritten, and only where it already reads
    `Day N` -- an "Assessment" or "Chapter Review" caption is stepped over
    and keeps its place, the same way `segsplit.renumber` steps over one.

    Two things this must not do. It must not touch `segment_index`, which
    `dayobj.key` joins objectives on: renumbering a caption is not a reason
    to rekey the corpus. And it must not renumber a book into a scheme it
    was not written in -- see `numbering_scheme`.
    """
    first = _first_days(segments)
    start = min(first.values()) - 1 if first else 0
    out, day, chapter = [], start, _UNSET
    for s in segments:
        ch = (s or {}).get("chapter_number")
        if per_chapter and ch != chapter:
            chapter, day = ch, 0
        s = dict(s)
        m = DAY_LABEL.match(str(s.get("day_label") or ""))
        if m:
            day += 1
            s["day_label"] = "Day %d%s" % (day, m.group(2))
        out.append(s)
    return out


def fold_revision(segments, subject, grade=None):
    """(segments without the per-chapter revision rows, periods freed).

    Every Urdu grade; Grade 1 English and Maths (see FOLDS). Science and the
    upper English and Maths books come back exactly as they went in.
    """
    if not folds(subject, grade):
        return segments, 0

    revision, note = _revision_key(subject), NOTE.get(subject, PLAIN_NOTE)
    kept, drop, freed = list(segments), set(), 0
    for _ch, idxs in _chapters(segments).items():
        rev = [i for i in idxs if _key(segments[i], subject) == revision]
        teaching = [i for i in idxs
                    if _key(segments[i], subject) not in BOOKKEEPING]
        if not rev or not teaching:
            # No revision to fold, or a chapter that is nothing but tails —
            # there is no teaching day to carry the review, so the revision
            # keeps its period rather than the content being dropped.
            continue
        # The host is the teaching day the revision SITS BESIDE, not the
        # chapter's last. Almost always those are the same row: Urdu and
        # Grade 1 English write the revision after the teaching. Grade 1
        # Maths chapters 2-4 also open with a "Memory Lane recap" of the
        # previous chapter, printed on the chapter's opening page and
        # carrying the coming chapter's SLOs. Folding that forward would
        # move a prerequisite warm-up to after the learning it prepares,
        # and park an opening page on a day teaching thirty pages later.
        hosts = {}
        for i in rev:
            prior = [t for t in teaching if t < i]
            hosts.setdefault(prior[-1] if prior else teaching[0], []).append(i)
        for at, taken in hosts.items():
            host = dict(segments[at])
            for i in taken:
                _absorb(host, segments[i], note)
                drop.add(i)
                freed += 1
            kept[at] = host

    return [s for i, s in enumerate(kept) if i not in drop], freed


# --------------------------------------------------------------------------
# Rule 4 — complete the 5E cycle by swapping, at a constant period count
# --------------------------------------------------------------------------

def complete_5e(segments, subject):
    """(segments, days retagged). Science only; the length never changes.

    Grades 4-5 General Science is the whole of Science here. A chapter short
    of an Engage day spends its FIRST Investigate period on the phenomenon
    that raises the question; one short of Apply spends its LAST on carrying
    the idea somewhere new. Either way the chapter keeps an Investigate day.
    """
    if subject != "Science":
        return segments, 0

    out, swaps = list(segments), 0
    for _ch, idxs in _chapters(segments).items():
        present = {_key(segments[i], subject) for i in idxs}
        spare = [i for i in idxs if _key(segments[i], subject) == INVESTIGATE]
        for missing, take in ((ENGAGE, 0), (APPLY, -1)):
            if missing in present or len(spare) < 2:
                continue
            i = spare.pop(take)
            out[i] = dict(segments[i], skill_type=missing)
            present.add(missing)
            swaps += 1
    return out, swaps
