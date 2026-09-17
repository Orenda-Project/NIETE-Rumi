"""Calendar (overview) — the three tables the day grid cannot hold.

The Teaching Calendar is a 30px-per-column day grid. These three blocks are
prose and wide numbers: what the conservative period rate buys, where our
calendar and FDE's own documents disagree, and the month view. Stacking them
above the grid forced one set of column widths to serve both, and prose lost —
a paragraph in a 150px WRAP column comes out one word per line.

So they live here, on a tab with no frozen columns and columns wide enough for
the text. Nothing is merged and nothing wraps: the whole tab is OVERFLOW_CELL, so a
long line starting in a column whose neighbours are empty runs across them to
its full length, and no row ever balloons to hold a paragraph.
"""
import schoolyear as sy
from caltab import MONTHS

# Column 0 carries the longest label on the tab — "Our own ramp assumption" —
# and cannot overflow, because column 1 beside it is always occupied. It is
# sized to hold that label outright. Columns 4 and 5 are a pair: a long value
# starts in 4 and runs through 5, so 5 is never filled on the same row.
# Grade/Month · Subject/Days · Weeks · Phase · window(+spill) · the wide one.
# Column 3 holds the longest phase label, "Term 2 · revision & board
# prep", and its right-hand neighbour is filled on the same row.
WIDTHS = [175, 95, 100, 200, 175, 180, 430]
N_COLS = len(WIDTHS)
WIDE = N_COLS - 1

# What the on-ramp actually teaches, for the trade-off sentence below. Named
# here rather than imported from ramp so this stays a rendering module.
ONRAMP_NAME = {"English": "phonics and oral language",
               "Urdu": "arkaan saazi and oral language",
               "Maths": "concrete number work and fluency",
               "Science": "hands-on enquiry"}


def _row(*cells):
    row = [""] * N_COLS
    for i, cell in enumerate(cells):
        row[i] = cell
    return row


def assumption_block(stats):
    """What the conservative rate buys, book by book.

    There was a second budget here — "factual", the FDE-scheduled chapters
    only, against "ideal", the whole book. FDE schedules every chapter, so the
    two budgets are the same number in every row and the column is gone. What
    is left is the only question the block was ever really asking: does the
    whole book fit before 24 December at this rate, and how many periods are
    left over for basics.
    """
    rows = [_row("PERIODS A WEEK — what this calendar assumes, and what it "
                 "buys"),
            _row("Grade", "Subject", "Per wk", "Book needs",
                 "Periods to 24 Dec", "On-ramp + gap-fill",
                 "Does the whole book actually get taught?")]
    for grade, subject, st in stats:
        rate = sy.periods_for(subject, grade)
        # The verdict is read off what allocate() PLACED, never off the
        # budget. Those two answer different questions, and for six months
        # this column asked the easy one: budget minus book length said
        # "20 periods spare" for books the calendar was in fact cutting six
        # periods from. If a period is not in the year, it is not taught.
        short = st["dropped"]
        rows.append(_row(
            f"G{grade}", subject, f"{rate}", st["ideal"], st["budget"],
            f"{st['onramp']} + {st['fill']}",
            f"yes — all {st['placed']} taught, "
            f"{st['budget'] - st['placed']} period"
            f"{'' if st['budget'] - st['placed'] == 1 else 's'} left for "
            f"basics"
            if not short else
            f"NO — {st['placed']} of {st['ideal']} taught, {short} never "
            f"reached at {rate}/wk"))
    rows.append(_row(""))
    for grade, subject, st in stats:
        if st["dropped"] or (st["onramp"] + st["fill"] and st["ideal"]
                             > st["budget"]):
            rows.append(_row(
                "", f"G{grade} {subject}: the {st['onramp'] + st['fill']} "
                f"basics periods are not free — they are book periods spent "
                f"on {ONRAMP_NAME.get(subject, 'basics')} instead. "
                f"{st['dropped']} chapters' worth never gets taught."))
    rows.append(_row(""))
    rows.append(_row(
        "The previous matrix assumed five periods a week for every core "
        "subject and one period per school day. Three books did not fit in "
        "that year at all, which is where the compression of the later "
        "chapters came from."))
    return rows, [0], [1]


def _sentences(text):
    """One sentence per row. A row here overflows across the whole tab and
    then stops — there is no eighth column for it to run into — so the budget
    is about 240 characters and a paragraph written as one cell loses its
    tail. Every sentence in this file is under 150.
    """
    out, buf = [], ""
    for word in text.split(" "):
        if buf and len(buf) + 1 + len(word) > 150:
            out.append(buf)
            buf = word
        else:
            buf = f"{buf} {word}".strip()
        if buf.endswith((".", ":")) and len(buf) > 40:
            out.append(buf)
            buf = ""
    if buf:
        out.append(buf)
    return out


def conflict_block():
    """Where the calendar and FDE's own documents disagree, named up front.

    This calendar follows the Basic Calendar of Activities. FDE's seventeen
    syllabus-breakdown documents write different vacation dates, and a school
    pacing off those will be a few days out of step. Better said here than
    discovered in May.

    Two rows per disagreement — the claim, then what we do about it — so each
    line is one sentence starting in column B and overflowing right, instead
    of a paragraph crushed into one cell.
    """
    rows = [_row("WHERE THIS CALENDAR AND FDE'S OWN DOCUMENTS DISAGREE"),
            _row("Source", "The disagreement, and what this calendar does")]
    for window, text in sy.DEVIATIONS:
        rows.append(_row("FDE, against itself", window))
        for i, line in enumerate(_sentences(text)):
            rows.append(_row("", f"→  {line}" if i == 0 else f"    {line}"))
    rows.append(_row("Our own ramp assumption",
                     "Grades 1-2 take the textbook at half rate for six "
                     "weeks, three quarters to week 14, full rate after."))
    for i, line in enumerate(_sentences(
            "⚠ A DESIGN ASSUMPTION, NOT A MEASUREMENT. The RDF quiz results "
            "were checked for it on 16 Sep 2026 and cannot carry it: mastery "
            "sits at 81-85% in every grade 1-5 and the adaptive difficulty "
            "never moves off its starting value. So the instrument shows no "
            "grade signal at all. Change the shape in ramp.RAMP, in one "
            "place.")):
        rows.append(_row("", f"→  {line}" if i == 0 else f"    {line}"))
    return rows, [0], [1]


def month_block():
    """The year by month — days, weeks, term, assessment windows, closures."""
    rows = [_row("MONTH VIEW — how the session divides up"),
            _row("Month", "School days", "Teaching weeks", "Phase",
                 "Official assessment window", "", "Closed")]
    by_month = {}
    for day in sy.school_days():
        by_month.setdefault((day.year, day.month), []).append(day)
    for (year, month), days in sorted(by_month.items()):
        hits = sorted({f"{n} ({g})" for s, e, n, g in sy.ASSESSMENTS
                       if any(s <= d <= e for d in days)})
        closed = [f"{v} {k.day}" for k, v in sy.HOLIDAYS.items()
                  if (k.year, k.month) == (year, month)]
        for start, _end, name in sy.BREAKS:
            if (start.year, start.month) == (year, month):
                closed.append(f"{name} from {start.day}")
        # The assessment window is written in column 4 and left to run into
        # column 5, which stays empty for exactly that reason; the closures
        # go in the wide last column, where they have room of their own.
        rows.append(_row(f"{MONTHS[month]} {year}", len(days),
                         len(sy.weeks(days)), sy.term_of(days[0]),
                         " · ".join(hits) or "—", "",
                         " · ".join(closed) or "—"))
    return rows, [0], [1]


def build(stats):
    """stats: [(grade, subject, allocator stats)] from caltab's plan."""
    rows = [_row("CALENDAR — OVERVIEW"),
            _row("The three tables behind the day grid: what the period rate "
                 "buys, where FDE's own documents disagree with each other, "
                 "and the shape of the year by month. The grid itself is on "
                 "the Teaching Calendar tab.")]
    sections, heads = [], []
    for block in (assumption_block(stats), conflict_block(), month_block()):
        part, secs, hds = block
        rows.append(_row(""))
        base = len(rows)
        sections += [base + r for r in secs]
        heads += [base + r for r in hds]
        rows += part
    return rows, {"n_cols": N_COLS, "widths": WIDTHS, "wide": WIDE,
                  "sections": sections, "heads": heads}
