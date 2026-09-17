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
"""
import skills

# Canonical keys for a period that consumes a day without teaching a new one.
BOOKKEEPING = frozenset(("duhrai", "jaiza", "revision", "assessment",
                         "review_assess"))

ENGAGE = "engage_hook"
INVESTIGATE = "investigate_handson"
APPLY = "apply_connect"

# Which grades Rule 3 folds, per subject. None means every grade; a subject
# not listed is never folded. The Grade 1 entries pay for the Foundations
# block (foundations.py) and are the ONLY thing standing between the fold and
# the 130 revision periods of Grades 2-5 English and Maths.
FOLDS = {"Urdu": None, "English": frozenset({1}), "Maths": frozenset({1})}

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
    return host


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
        host = dict(segments[teaching[-1]])
        for i in rev:
            _absorb(host, segments[i], note)
            drop.add(i)
            freed += 1
        kept[teaching[-1]] = host

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
