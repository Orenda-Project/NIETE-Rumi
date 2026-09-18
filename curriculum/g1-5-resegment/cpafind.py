"""The Maths CPA ramp as this build teaches it — computed, never written in.

Concrete → Pictorial → Abstract is the spine of primary Maths teaching, and
the pedagogy that matters is the ramp rather than the totals: the early grades
should be heavy on days the child can put their hands on, and the symbol-only
days should arrive later and grow. A child handed symbols they never held is
doing rote, and a child who never reaches the symbol has been left short of
the destination. Either failure shows up as a shape across the grades, which
is why this module reports a per-grade series and a reading of it, not a sum.

This finding has been on the Skill Taxonomy tab once before and it was wrong.
It was prose with the counts typed into it, so the build moved and the
sentence did not: by the time anyone read it the tab said "Concrete is
36 / 6 / 1 / 0 / 33 … Abstract is 0 in every grade" while the live build said
Concrete 36 / 15 / 15 / 11 / 33 and Abstract 11 / 7 / 3 / 16 / 3. Two CPA
fixes had landed at the load door (`cparamp` named the abstract days,
`cpaopen` gave the G3 and G4 chapters a hands-on opening) and the typed
numbers predated both. A stale number in prose is read as a finding, not as a
cache — it was a false pedagogical claim printed in the reviewer's voice
(bd-hlq38).

So two rules hold this module down, and `test_cpafind.py` asserts both.

Every count comes from `skilltaught.counts`, which reads `covdata.prepare` —
the single tally both coverage tabs draw. The Coverage Map already prints
these very numbers per grade, correctly; reusing its tally is what makes this
sentence and that tab incapable of disagreeing. A recount here would be the
same defect wearing a different costume. (`covdata.count` also returns a
keyless `admin` total, which is why this module stays on the two teaching
phases and says nothing about Maths Revision or Assessment — those are the
figures the keyless total cannot break out.)

And no digit may appear in the source below this docstring. The counts arrive
as arguments; the only numbers in the output are the ones the build computed.
Everything here that looks like a threshold — thinning, growing, a rebound —
is a comparison between two of the build's own figures.
"""
import skills
import skilltaught

SUBJECT = "Maths"

# The two ends of the ramp. Pictorial and the bridge sit between them and are
# on the Coverage Map beside these; the question this finding answers is
# whether the child gets to hold something first and reaches the symbol at
# all, and that question is asked of these two.
PHASES = ("concrete", "abstract")
CONCRETE, ABSTRACT = PHASES


def ramp(corpus):
    """{grade: {phase key: teaching days}} for Maths, off the build's own tally.

    `skilltaught.counts` is `covdata.prepare` read per (subject, skill, grade),
    so a count here is the count the Coverage Map prints for the same grade and
    the same chip. The grades are whichever grades the corpus teaches Maths in,
    not a written-down range: a build that loses a book says so.
    """
    live = skilltaught.counts(corpus)
    grades = sorted({int(g) for subject, _key, g in live if subject == SUBJECT})
    return {g: {k: skilltaught.days(live, SUBJECT, k, g) for k in PHASES}
            for g in grades}


def _listed(grades):
    """The grades named, comma-separated, with an `and` before the last.

    The cell is prose and gets quoted into review notes, so it reads as a
    sentence rather than as a tuple. (The rendered shape is pinned in
    `test_cpafind.py`, which is the one place an example may carry a grade
    number without being mistaken for a count.)
    """
    *rest, last = [f"G{g}" for g in grades]
    return (", ".join(rest) + " and " + last) if rest else last


def _tally(ramp, key):
    """Every count written beside the grade that owns it, comma-separated.

    Beside, not as a row of bare figures: a reader who has to count positions
    to learn which grade a number belongs to will eventually miscount, and
    this is the sentence they will quote. The slash-separated series that the
    stale version printed is exactly that trap.
    """
    return ", ".join(f"G{g} {ramp[g][key]}" for g in sorted(ramp))


def _steps(ramp, key):
    """(grade, the count in the grade below it, its own count), grade by grade.

    Every reading below is a fact about these steps, which is how the sentence
    stays honest: nothing here knows what shape the ramp is supposed to be.
    """
    out, previous = [], None
    for grade in sorted(ramp):
        if previous is not None:
            out.append((grade, previous, ramp[grade][key]))
        previous = ramp[grade][key]
    return out


def _up(ramp, key):
    """Grades that teach more of the phase than the grade below them."""
    return [g for g, was, now in _steps(ramp, key) if now > was]


def _down(ramp, key):
    """Grades that teach less of the phase than the grade below them."""
    return [g for g, was, now in _steps(ramp, key) if now < was]


def _heaviest(ramp, key):
    return max(sorted(ramp), key=lambda g: ramp[g][key])


def _lightest(ramp, key):
    return min(sorted(ramp), key=lambda g: ramp[g][key])


def _empty(ramp, key):
    """Grades with none of the phase at all — said plainly, never rounded."""
    return [g for g in sorted(ramp) if not ramp[g][key]]


def _concrete_clause(ramp):
    """Whether the hands-on days thin out as the grade rises.

    When they do not, where they climb back is the finding, so it is named.
    A hedge — "the ramp is uneven" — is the sentence the previous version of
    this block would have survived writing, and it tells a reviewer nothing
    they can take to a boundary decision.

    Thinning has to be earned by a step that actually falls. Asking only
    whether anything rose reads a flat line, and a one-grade build with no
    steps in it at all, as the healthy shape — an unearned claim hiding in
    the branch nobody tested.
    """
    label = skills.label(CONCRETE)
    if _up(ramp, CONCRETE):
        return (f"{label} does not thin out as the grade rises. It is "
                f"heaviest in G{_heaviest(ramp, CONCRETE)} and lightest in "
                f"G{_lightest(ramp, CONCRETE)}, and it climbs back up in "
                f"{_listed(_up(ramp, CONCRETE))}.")
    if _down(ramp, CONCRETE):
        return (f"{label} thins out as the grade rises, which is the shape "
                "the ramp wants: the youngest children handle the most, and "
                "the handling gives way as the symbols take over.")
    return (f"{label} does not thin out as the grade rises: no grade teaches "
            "less of it than the grade below, so there is no thinning in the "
            "series to read.")


def _abstract_clause(ramp):
    """Whether the symbol arrives at all, and whether it grows once it has.

    A grade with none of it is said in those words. A whole year in which no
    day works in symbols alone is not a rounding error, and the phrasing that
    softens it is the phrasing that gets skipped.

    Growth has to be earned by a step that actually rises, for the same
    reason the thinning does: a flat Abstract line has no destination in it,
    and calling it growth because nothing fell is the claim this whole module
    exists to stop being made on the tab.
    """
    label = skills.label(ABSTRACT)
    missing = _empty(ramp, ABSTRACT)
    if missing:
        opening = (f"{label} is not taught at all in {_listed(missing)} — a "
                   "whole year with no day that works in symbols alone.")
    else:
        opening = (f"{label} does arrive in every grade, so no year asks for "
                   "symbols with no symbolic practice behind them.")
    if _down(ramp, ABSTRACT):
        return (f"{opening} It does not grow as the grade rises: it is "
                f"heaviest in G{_heaviest(ramp, ABSTRACT)} and falls rather "
                f"than rises at {_listed(_down(ramp, ABSTRACT))}.")
    if _up(ramp, ABSTRACT):
        return (f"{opening} And it grows as the grade rises, which is the "
                "destination the ramp exists to reach.")
    return (f"{opening} And it does not grow as the grade rises either: no "
            "grade teaches more of it than the grade below, so the series "
            "climbs towards no symbolic destination.")


def _last_year_clause(ramp):
    """The top grade moving both ways at once, when it does.

    Conditional because it is a claim about this build: printed when the
    figures say it and absent when they do not. It is the sharpest thing the
    series can contain — the last primary year going backwards on both ends
    of the ramp at the same time — so it gets its own sentence rather than
    being left for the reader to spot in the tally.
    """
    top = max(ramp)
    if top in _up(ramp, CONCRETE) and top in _down(ramp, ABSTRACT):
        return (f" In G{top}, the last primary year, the two ends of the ramp "
                "move the wrong way at once: the hands-on days climb while "
                "the symbol-only days fall.")
    return ""


def reading(ramp):
    """The finding: the two series, what they say, and where to check it."""
    if not ramp:
        return ""
    series = " ".join(f"{skills.label(k)}, teaching days per grade: "
                      f"{_tally(ramp, k)}." for k in PHASES)
    return (f"{series} {_concrete_clause(ramp)} {_abstract_clause(ramp)}"
            f"{_last_year_clause(ramp)}"
            " The same days are counted per grade on the COVERAGE MAP tab and "
            "drawn against the year on the SKILLS MAP tab; the figures here "
            "are computed from that same tally while the sheet is written, so "
            "this sentence cannot drift from the build the way a typed-in "
            "count did. The page text has already settled one of these: the "
            "last primary year's concrete count was a section heading read "
            "as a page, not work in children's hands, and is corrected at "
            "the load door. Where the ramp is still not a ramp, that check "
            "comes first — it is as likely to be a label as a boundary.")


def finding(ramp, width):
    """The row for the Skill Taxonomy tab, padded to the width it is given.

    One row, not a grade-by-phase table: the tab is six columns of definitions
    and a second table under the same grid is what the pointer block was split
    out of. The `CPA phase` cell stays empty on purpose — that column names
    the single phase a skill type stands for, and this row is about two phases
    at once, so filling it would put a chip on a sentence.

    An empty ramp returns no rows at all. A caller with no corpus in hand gets
    silence rather than a ramp inferred from a partial build.
    """
    if not ramp:
        return []
    grades = sorted(ramp)
    row = [SUBJECT, "this build's ramp", f"{min(grades)}–{max(grades)}", "",
           reading(ramp),
           "computed at build time from the tally the Coverage Map draws"]
    return [row + [""] * (width - len(row))]
