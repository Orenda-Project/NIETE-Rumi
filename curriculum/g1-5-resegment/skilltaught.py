"""What the live build actually teaches — the Skills Map's check on its snapshot.

Every other analysis tab is drawn from the corpus this run transformed in
memory. The Skills Map alone is drawn from `skillsmap.json`, written by a
separate pass, and two CPA fixes landed after the snapshot in this tree was
written: `cparamp` put Abstract into the ramp and `cpaopen` gave the Grade 3
and Grade 4 Maths chapters a hands-on opening day. Both transform the corpus
at the load door, so the coverage tabs saw them and the snapshot did not — and
the Skills Map printed "Maths · Abstract · never taught in this subject" under
a heading reading WHAT IS NEVER TAUGHT while the Coverage Map, two tabs away,
counted 16 Abstract days in Grade 4 alone (bd-hlq38).

A false absence is worse than no absence: the never-taught block is the first
thing a reviewer reads and the one that gets quoted to FDE. So no absence on
that tab is decided by the snapshot any more. It is decided here, off
`covdata.count` — the same tally both coverage tabs draw — and the snapshot
only ever narrows what is already true of the live build.

What stays with the snapshot is what this cannot answer. `covdata.count` folds
every non-day row into one `admin` total with no keys, so it cannot tell a
skill with no periods at all from one taught in a chapter-close slot; Maths
Assessment and Revision are exactly that, and calling them never taught would
swap one false absence for two. Position — which day of the year, which
chapter — it cannot answer either, and that is most of the tab.

Grades reach here as ints from the corpus and as strings from the snapshot's
JSON object keys, so every grade goes through `str` on the way in and out.
"""
import covdata
import skills


def counts(corpus):
    """{(subject, canonical key, "4"): teaching days} for the live build.

    Read straight off `covdata.prepare`, so a skill counted here is a skill
    the Coverage Map gives days to — that identity is the whole point, and a
    second count of the same corpus here would let the two tabs disagree
    again by a different route.
    """
    out = {}
    for subject, prepared in covdata.prepare(corpus).items():
        for grade, (per, _by_chapter, _admin) in prepared[3].items():
            for key, n in per.items():
                if n:
                    out[(subject, key, str(grade))] = n
    return out


def days(live, subject, key, grade=None):
    """Days the live build gives this skill in `grade`, or across the subject
    when `grade` is None. Canonicalises first: an aliased Urdu key looked up
    raw finds an empty bucket beside the real one and reads as never taught,
    which is the same class of bug one layer down."""
    key = skills.canonical(key, subject)
    if grade is not None:
        return live.get((subject, key, str(grade)), 0)
    return sum(n for (subj, got, _g), n in live.items()
               if subj == subject and got == key)
