"""The periods the book does not claim, given names they can be built against.

`ramp.allocate` returns a year of periods. Most carry a chapter's own day and
have a row in `corpus/seg` behind them, which is how Stage C finds a brief,
a render and a lesson plan. The rest do not. They are the slots where the
timetable is longer than the book — 366 of them, measured 20 Sep 2026 — and
they are where phonics, number fluency, communicative language and concrete
maths are actually taught. They have no row anywhere, so nothing downstream
can see them: the whole authoring path reads `corpus/seg/<book>.json`, and a
period that is not in it does not exist as far as Stage C is concerned.

This module is the first half of fixing that: it turns those slots into
records with stable names. It deliberately stops there. It reads a list of
periods and returns a list of dicts; it opens no file, calls no allocator and
knows nothing about briefs or renders, so it can be tested without the
corpus — which is gitignored, and therefore absent on most clones.

The name is the part worth arguing about. The obvious key is the period's
place in the year, and it is the one key that must not be used. The year gets
rebalanced constantly — a chapter folded, a day split, a subject re-paced —
and every such edit shifts every position after it. Authored work keyed on
position would quietly re-attach to a different day, and nothing would fail
while it did. So identity is (chapter, skill, ordinal within that pair). It
changes only when a chapter's own basics allocation changes, which is exactly
when a rename is the right answer. Position is still reported, because a
teacher needs to know when the day falls; it is simply not the name.
"""

# Deliberately explicit rather than derived from the skill name: a generated
# abbreviation collides the first time two skills share an opening letter, and
# the collision reads as a duplicated lesson rather than as a bug. A new
# basics skill must be added here, and the tests check these stay distinct.
SHORT = {
    "number_fluency": "nf",
    "concrete": "cn",
    "word_problem": "wp",
    "communicative": "cl",
    "phonics": "ph",
    "arkaan_saazi": "as",
    "investigate_handson": "ih",
    "engage_hook": "eh",
}

# A Foundations period is not one of these. It is the six-week Grade 1 block
# (bd-rpe8r), it sits before the book rather than inside a chapter, and
# `_anchor` pointedly refuses to stamp a chapter on it. Building it here would
# build it twice, in two different shapes.
BASICS_KINDS = ("onramp", "fill")


def records(stem, grade, subject, periods):
    """Every basics period in one allocated year, named and ordered.

    `periods` is what `ramp.allocate` returned for this book. Book, omitted
    and foundations periods are passed over. The rest come back in year order
    with an `id` that survives a rebalance and a `position` that does not.
    """
    seen, out = {}, []
    for i, period in enumerate(periods):
        if period.get("kind") not in BASICS_KINDS:
            continue
        skill = period["skill"]
        if skill not in SHORT:
            raise KeyError(
                "no short code for basics skill %r -- add it to basics.SHORT "
                "rather than letting an id be invented for it" % skill)
        chapter = period.get("chapter")
        if chapter is None:
            raise ValueError(
                "%s period %d (%s) has no chapter. ramp._anchor stamps every "
                "non-foundations period, so this is an allocator bug, not a "
                "period to give a chapterless name to" % (stem, i + 1, skill))
        key = (chapter, skill)
        # Counted per (chapter, skill) rather than per run: the allocator
        # interleaves, so a chapter's periods are not contiguous and a run
        # counter would mint the same ordinal twice.
        seen[key] = seen.get(key, 0) + 1
        ordinal = seen[key]
        out.append({
            "id": "%s_ch%d_%s%d" % (stem, chapter, SHORT[skill], ordinal),
            "stem": stem,
            "grade": grade,
            "subject": subject,
            "chapter": chapter,
            "skill": skill,
            "kind": period["kind"],
            # The book day this period sits beside, from `ramp._anchor`. The
            # chapter says where the period falls; this says what it is built
            # from. None where the allocator found no neighbour -- stated
            # rather than absent, because the builder falls back to the whole
            # chapter and that is a decision, not an oversight.
            "near": period.get("near"),
            "ordinal": ordinal,
            "position": i + 1,
            "of": len(periods),
        })
    return out
