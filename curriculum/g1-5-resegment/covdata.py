"""What the corpus contains, counted — before any column exists.

Both coverage tabs are read off ONE tally. `Coverage Map` draws it as a mix
and a chapter grid; `Coverage — gaps` draws the holes in it. Counting it twice
would let the two tabs disagree about the same book, which is the one thing a
coverage tab may not do.

So the tally lives here and knows nothing about columns, widths or plans: it
takes the corpus and returns days per skill type, days per chapter, and the
bookkeeping total. `covtab` decides where those numbers go; `covfmt` decides
what colour they are. Nothing here may import either.

The vocabulary is per subject and deliberately not parallel (see `skills`), so
every lookup here canonicalises before it counts — an aliased Urdu key counted
raw is a second, empty bucket beside the real one.
"""
import skills

SUBJECTS = ("English", "Urdu", "Maths", "Science")
# Bookkeeping in each subject's vocabulary: never in the bars, never dropped.
BOOKKEEPING = frozenset(("revision", "assessment", "review_assess",
                         "duhrai", "jaiza"))
# A skill every chapter of that subject should carry — missing one is a gap.
EXPECTED = {
    "English": ("reading_comprehension", "vocabulary_grammar", "writing"),
    "Urdu": ("buland_khwani", "tafheem", "alfaaz_maani"),
    "Maths": ("concrete", "pictorial", "word_problem"),
    "Science": ("engage_hook", "investigate_handson", "concept_build")}


def _key_of(subject):
    """Printed skill label -> taxonomy key. ORDER alone is not enough
    (`review_assess` is a live Science label ORDER omits), so fall back to
    SKILL and then to the raw label rather than dropping it."""
    back = {skills.label(k, subject): skills.canonical(k, subject)
            for k in skills.ORDER[subject]}
    for key, spec in skills.SKILL.items():
        back.setdefault(spec[0], key)
    return back


def count(rows, subject):
    """(days by key, {chapter: {key: days}}, bookkeeping days). A review or
    assessment consumes a day without teaching one: totalled, never dropped."""
    per, by_chapter, back, admin = {}, {}, _key_of(subject), 0
    for r in rows:
        if r["kind"] != "day":
            admin += 1
            continue
        # Canonicalise AFTER the label lookup, not instead of it: the
        # corpus writes some days by label and some by raw key, and a
        # raw Urdu `revision` is `duhrai` — two buckets otherwise.
        key = skills.canonical(back.get(r["skill_type"],
                                        r["skill_type"]), subject)
        per[key] = per.get(key, 0) + 1
        if r["chapter"] is not None:
            slot = by_chapter.setdefault(r["chapter"], {})
            slot[key] = slot.get(key, 0) + 1
    admin += sum(n for k, n in per.items() if k in BOOKKEEPING)
    return per, by_chapter, admin


def keys(subject, seen=()):
    """(skill types to show, the ones the taxonomy does not name). A label can
    be live in the data and absent from hand-edited ORDER: appended, marked."""
    order = [skills.canonical(k, subject) for k in skills.ORDER[subject]]
    extra = sorted(k for k in seen
                   if k and k not in order and k not in BOOKKEEPING)
    return [k for k in order if k not in BOOKKEEPING] + extra, set(extra)


def prepare(corpus):
    """{subject: (books, shown keys, off-taxonomy keys, per-book counts)}"""
    out = {}
    for subject in SUBJECTS:
        books = corpus.get(subject, [])
        if not books:
            continue
        counted = {g: count(rows, subject) for g, rows, _st in books}
        seen = {k for g in counted for k in counted[g][0]}
        shown, extra = keys(subject, seen)
        out[subject] = (books, shown, extra, counted)
    return out
