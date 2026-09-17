"""How the year's periods get filled: the book, then everything the book omits.

Three facts collide here and the calendar has to hold all three at once.

  1. The timetable has more periods than the books have days. English at five
     a week to 24 December is 135 periods; the longest English book is 99.
     Maths at six is 163 against books of 84-119. The spare is not slack, it
     is the only room anyone has ever had for basics.
  2. FDE's syllabus breakdown omits chapters — 157 teaching days across the
     seventeen books, almost all of them Urdu listening and reading lessons.
     Those chapters are still in the book, so they are the *first* claim on
     the spare: teach them if the year allows, drop them from the end if not.
  3. Grades 1 and 2 cannot take the book at full rate from April. Children
     arrive without ECE and the first weeks have to be mostly code and oral
     work, with the textbook rate climbing as the year goes.

So a period is allocated in that order — book, then omitted chapter, then the
basics the book never carried — and the ramp decides how fast the book comes.

⚠ The ramp shape below is a DESIGN ASSUMPTION, not a measurement. The RDF quiz
data was checked for it (2026-09-16) and cannot carry it: mastery sits at
81-85% in every grade from 1 to 5 and the adaptive difficulty never leaves its
starting value, so the instrument shows no grade signal at all. The shape is
stated here so it can be argued with and changed in one place.
"""
import foundations
import schoolyear as sy

# Grades 1-2 only: share of each week's periods that may be textbook, by week
# index from the start of the session. The rest of the week is the on-ramp.
RAMP = [(0, 6, 0.5), (6, 14, 0.75)]        # after week 14, the full rate

# What the on-ramp teaches, and what the leftover spare teaches, per subject.
#
# Both are rotations, and the on-ramp's rotation is the point. It used to be
# one skill — phonics for six months — with communicative language sitting in
# FILL behind it. In Grades 1-2 the on-ramp owns every spare period to week 14
# and the book takes everything after, so FILL never ran at all: Grade 1 and 2
# Urdu got no oral-language period all year, and English got its first in
# February. That is the wrong half of the reading rope to drop. Decoding and
# oral language comprehension have to grow together, and a child arriving
# without ECE needs the talk more than anyone.
#
# So two periods of code work to one of oral language, from April. The order
# of the list is the order taught; the ratio is the list.
ONRAMP = {"English": ["phonics", "phonics", "communicative"],
          "Urdu": ["arkaan_saazi", "arkaan_saazi", "communicative"],
          "Maths": ["concrete", "concrete", "number_fluency"],
          "Science": ["engage_hook", "engage_hook", "investigate_handson"]}
FILL = {"English": ["communicative", "phonics"],
        "Urdu": ["communicative", "arkaan_saazi"],
        "Maths": ["number_fluency", "word_problem"],
        "Science": ["investigate_handson", "apply_connect"]}

# Grade 1's six-week Foundations block — the table and the rule that pays for
# it live in foundations.py. Re-exported because the allocator is where the
# rest of the year is described and a reader looking for the block looks here.
FOUNDATION_WEEKS = foundations.FOUNDATION_WEEKS
FOUNDATION = foundations.FOUNDATION

def run_of(segments, syllabus):
    """The whole book as periods, each tagged book or omitted-by-FDE."""
    out = []
    for s in segments:
        ch = s.get("chapter_number")
        out.append({"chapter": ch,
                    "skill": s.get("skill_type") or "revision",
                    "kind": "omitted" if syllabus is not None
                            and ch not in syllabus else "book"})
    return out


def content_rate(grade, week_index):
    """Share of a week's periods that may be textbook, in [0, 1]."""
    if grade > 2:
        return 1.0
    for lo, hi, share in RAMP:
        if lo <= week_index < hi:
            return share
    return 1.0


def _week_sizes(subject, grade, end=None):
    """Periods available in each teaching week up to the content deadline."""
    per_week = sy.periods_for(subject, grade)
    return [sy.periods_in(days, per_week)
            for _m, days in sy.weeks(sy.school_days(end=end or sy.CONTENT_END))]


def _take_per_week(n_queue, sizes, grade, weeks=None):
    """How many of each week's periods are textbook. Two effects, composed.

    The book is shorter than the year, so it stretches: if 122 book periods
    have to cover 163, three periods in four are textbook and the fourth is
    gap-fill, every week, rather than the book finishing in October and six
    empty weeks sitting at the end. Then for Grades 1-2 the ramp tilts that
    same total towards the back of the year, so April is mostly code and oral
    work and the textbook rate climbs.

    The tilt is what makes this hard to get right. Weight moved to the back
    of the year lands on weeks that are already full — a week has five
    periods whether or not the ramp wants six from it — and an earlier
    version simply capped each week at its size and let the remainder go.
    That silently dropped 41 periods of Grade 1 and 2 content, in the two
    grades the ramp exists to protect, while the overview tab went on
    reporting the year as having room to spare.

    So the share-out is a water-fill instead: hand out the queue in
    proportion to the weights, give each week only what it has room for, and
    put whatever would not fit back in the pot for the weeks that still have
    room. Repeat until the pot is empty or the year is full. The ramp still
    shapes WHERE the book falls; it can no longer decide how much of the book
    gets taught at all.

    `weeks` names the week indices the book may use. None means all of them,
    byte-for-byte the behaviour that predates the parameter. A subset is how
    the Foundations block is expressed: those weeks are not weighted to zero,
    they are absent, so the water-fill has nothing to hand overflow back to.
    """
    weights = [size * content_rate(grade, w) for w, size in enumerate(sizes)]
    takes = [0] * len(sizes)
    live = range(len(sizes)) if weeks is None else weeks
    left = min(n_queue, sum(sizes[w] for w in live))
    open_weeks = [w for w in live if sizes[w] > 0]

    while left > 0 and open_weeks:
        total = sum(weights[w] for w in open_weeks) or 1
        moved = 0
        for w in open_weeks:
            give = min(sizes[w] - takes[w], int(left * weights[w] / total))
            takes[w] += give
            moved += give
        if not moved:
            # Every proportional share rounded down to nothing — the pot is
            # smaller than the number of weeks still open. Hand the last few
            # periods out one at a time, heaviest week first, so the tail of
            # the year keeps the ramp's ordering instead of the list's.
            for w in sorted(open_weeks, key=lambda w: -weights[w]):
                if moved >= left:
                    break
                if sizes[w] - takes[w] > 0:
                    takes[w] += 1
                    moved += 1
        left -= moved
        open_weeks = [w for w in open_weeks if sizes[w] - takes[w] > 0]
    return takes


def _interleave(chunk, size, filler):
    """Book periods spread evenly through the week, not bunched at its front."""
    slots = [None] * size
    for k in range(len(chunk)):
        slots[(k * 2 + 1) * size // (2 * len(chunk))] = chunk[k]
    out, i, f = [], 0, 0
    for slot in slots:
        if slot is not None:
            out.append(slot)
            i += 1
            continue
        out.append(dict(filler(f)))
        f += 1
    return out


def _anchor(periods):
    """Give every basics period the chapter it sits inside.

    Teachers read the calendar for where the class is in the book, and a run
    of chapterless cells reads as the book being put down. It is not: a
    phonics or number-fluency period is taught on the chapter's own text and
    numbers, in the chapter's week. So a basics period carries the chapter of
    the book period before it, or — for the first weeks of Grade 1, before any
    book period has happened — of the one coming next. The band stays
    continuous and the day still says "we are in Chapter 4".
    """
    last = None
    for p in periods:
        if p["chapter"] is not None:
            last = p["chapter"]
        elif last is not None:
            p["chapter"], p["anchored"] = last, True
    ahead = None
    for p in reversed(periods):
        # A Foundations period is NOT "before Chapter 1 in the book": it is
        # a phase the book has no page for, and stamping the coming chapter
        # on it read as six weeks of a chapter nobody had opened.
        if p.get("kind") == "foundations":
            continue
        if p["chapter"] is not None and not p.get("anchored"):
            ahead = p["chapter"]
        elif p["chapter"] is None and ahead is not None:
            p["chapter"], p["anchored"] = ahead, True
    return periods


def allocate(grade, subject, segments, syllabus):
    """One entry per period to 24 December. Returns (periods, stats).

    Grade 1 opens with the Foundations block: six weeks the book may not use,
    already paid for before the segments arrive: dayfold folds every Grade 1
    chapter's revision into its last teaching day at the load door, so the
    allocator places exactly what it is given and never trims. The rest is
    laid in order, chapters FDE omits riding at the end of the queue — taught
    if the year reaches them, reported as dropped if not. Every period the
    book does not claim is named: foundations, then on-ramp to week 14, then
    gap-fill. Named, and anchored — a basics period keeps the chapter number
    of the book period beside it. A Foundations period does not: it sits
    before the book, not inside its first chapter.
    """
    block = FOUNDATION_WEEKS.get(grade, ())
    run = run_of(segments, syllabus)
    factual = [p for p in run if p["kind"] == "book"]
    omitted = [p for p in run if p["kind"] == "omitted"]
    queue = factual + omitted
    sizes = _week_sizes(subject, grade)
    budget = sum(sizes)
    takes = _take_per_week(
        min(len(queue), budget), sizes, grade,
        weeks=([w for w in range(len(sizes)) if w not in block]
               if block else None))

    periods, i, tick = [], 0, [0]
    for w, (size, take) in enumerate(zip(sizes, takes)):
        if w in block:
            skill = FOUNDATION[subject][block.index(w)]
            periods += [{"chapter": None, "skill": skill,
                         "kind": "foundations"} for _ in range(size)]
            continue
        onramp = grade <= 2 and w < RAMP[-1][1]
        chunk, i = queue[i:i + take], i + take

        def filler(_k, _o=onramp):
            # The rotation counts across the whole year, not within the week.
            # `_interleave` restarts its own index every week, so reading the
            # cycle off that would hand out the same first skill every Monday
            # and the third entry of a three-long list would rarely be
            # reached at all.
            cycle = ONRAMP[subject] if _o else FILL[subject]
            tick[0] += 1
            return {"chapter": None, "skill": cycle[(tick[0] - 1) % len(cycle)],
                    "kind": "onramp" if _o else "fill"}

        periods += (_interleave(chunk, size, filler) if chunk
                    else [filler(k) for k in range(size)])
    taught = {p["chapter"] for p in periods
              if p["chapter"] is not None and p["kind"] in ("book", "omitted")}
    _anchor(periods)
    kept = sum(1 for p in periods if p["kind"] == "omitted")
    # `placed` is counted off the built year, not inferred from the budget.
    # Everything the overview tab says about fit now comes from here: the
    # question a reader is asking is "did the book get taught", and only the
    # periods actually in `periods` can answer it.
    placed = sum(1 for p in periods if p["kind"] in ("book", "omitted"))
    return periods, {
        "budget": budget,
        "ideal": len(run),
        "factual": len(factual),
        "omitted": len(omitted),
        "omitted_taught": kept,
        "omitted_dropped": len(omitted) - kept,
        "onramp": sum(1 for p in periods if p["kind"] == "onramp"),
        "fill": sum(1 for p in periods if p["kind"] == "fill"),
        "foundations": sum(1 for p in periods
                           if p["kind"] == "foundations"),
        "chapters_taught": len(taught),
        "placed": placed,
        "dropped": len(run) - placed,
        "short_by": max(0, len(factual) - budget)}
