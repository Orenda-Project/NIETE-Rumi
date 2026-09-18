"""Teaching Calendar tab — the year laid out day by day, the way ICT reads it.

Same shape as the matrix this replaces: one row per grade-and-subject, one
column per school day, a two-letter code in the cell saying what is taught
that day.

The grid comes FIRST, under five frozen header rows, exactly as the previous
matrix does it. The earlier draft of this tab stacked four prose tables above
the grid, so opening the tab showed a wall of text and the calendar itself was
off screen — and the prose sat in a 150px column set to WRAP, which stacks a
sentence one word per line. The prose tables now live on `Calendar —
assumptions`, whose columns are wide enough to hold them (see calfde.py).

What is left below the grid is the key, and it is a table, not a sentence:
every code, colour and mark gets its own line. Each line puts its code in the
narrow frozen columns and its explanation in the first day column, where
OVERFLOW_CELL lets it run across the empty grid to whatever width it needs.
No merges anywhere on this tab — a merge across the frozen boundary makes the
freeze request fail.

Periods are allocated conservatively — English and Urdu five a week, Maths six,
Science three — with the upper end of the band shown on the overview rather
than assumed. The spare is filled and named: the books are shorter than the
timetable, so every subject has 8-42 periods the textbook does not claim.
"""
import ramp
import schoolyear as sy
import skills

MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
WEEKDAY = "MTWTF"
LEAD = ["Grade", "Subject", "Per wk", "Book", "Basics"]
SUBJECTS = ("English", "Urdu", "Maths", "Science")
# Long text starts here — the first day column, just past the frozen edge —
# so OVERFLOW_CELL can run it across the empty grid. Anything left of this
# boundary is capped at the combined width of the five frozen columns.
WIDE = len(LEAD)
# Where a MARKS swatch is painted: the "Per wk"/"Book"/"Basics" columns,
# which are empty on every key row, and left of WIDE so a background never
# fences in the explanation that overflows rightward out of it.
SW0 = 2


def spread_week(n_days, n_periods):
    """How many periods land on each day of a week. Evenly, never bunched.

    Three periods in a five-day week fall Monday, Wednesday, Friday, not on
    the first three days; six periods put the double mid-week, not on Monday.
    """
    if n_days <= 0:
        return []
    if n_periods <= n_days:
        counts = [0] * n_days
        for k in range(n_periods):
            counts[(k * 2 + 1) * n_days // (2 * n_periods)] += 1
        return counts
    base, rem = divmod(n_periods, n_days)
    counts = [base] * n_days
    for k in range(rem):
        counts[(k * 2 + 1) * n_days // (2 * rem)] += 1
    return counts


def day_columns():
    """Every school day of the session, and where a break interrupts them."""
    days = sy.school_days()
    breaks = [i for i in range(1, len(days))
              if (days[i] - days[i - 1]).days > 4]
    return days, breaks


def lay_row(grade, subject, periods, days):
    """One period-per-cell row: (label, chapter, kind) for every school day."""
    cells = [("", None, "")] * len(days)
    index = {d: i for i, d in enumerate(days)}
    i = 0
    for _monday, week_days in sy.weeks([d for d in days
                                        if d <= sy.CONTENT_END]):
        for day, take in zip(week_days,
                             spread_week(len(week_days),
                                         sy.periods_in(week_days,
                                                       sy.periods_for(subject, grade)))):
            chunk = periods[i:i + take]
            i += len(chunk)
            if not chunk:
                continue
            text = "/".join(skills.code(p["skill"], subject) for p in chunk)
            cells[index[day]] = (text, chunk[0]["chapter"], chunk[0]["kind"])
    after = "board_prep" if grade == 5 else "revision"
    for day in days:
        if day > sy.CONTENT_END:
            cells[index[day]] = (skills.code(after, subject), None, "after")
    return cells


def _wide(left, text, n_cols):
    """A row whose long text starts past the frozen edge and overflows right."""
    row = [""] * n_cols
    for i, cell in enumerate(left):
        row[i] = cell
    row[WIDE] = text
    return row


def key_block(n_cols):
    """The legend. Every code, every mark — one line each, and each one shown.

    Returns (rows, chips, sections, over, swatch). A chip is (row, colour) —
    the colour is settled here, where the skill is still in hand, so nothing
    downstream has to read a code back into a skill to tint it.

    The chips carry `skills.colour()` and the grid's codes are drawn in the
    same colour darkened for text (calink). They were neutral for a while,
    because a tinted chip over a grid holding no skill colour sent the reader
    hunting for green cells that were not there — a real contradiction, fixed
    at the wrong end. The background still bands by CHAPTER, so the skill
    colour goes on the glyph and both facts can be seen at once.

    The MARKS lines carry a symbolic swatch name rather than a colour. "Two
    alternating bands" cannot be described, only shown — but naming a hex here
    would make this content module import the painter, so calfmt owns the
    mapping and this file only says which mark goes where.
    """
    rows, chips, sections, over, swatch = [], [], [], [], []

    def add(left, text):
        over.append(len(rows))
        rows.append(_wide(left, text, n_cols))

    sections.append(len(rows))
    add(["KEY"], "How to read this calendar — every code, colour and mark "
                 "that appears in the grid above.")
    add(["Code", "What the day is", "Subject"], "In plain words")
    add(["Note"], "These codes say WHAT is taught on a day, each written in "
                  "its own skill's colour — the colour that skill has here, "
                  "on the Skills Map and on the subject tabs. The CELL behind "
                  "it is the CHAPTER, so a long chapter still reads as a long "
                  "bar (see MARKS below). Where two codes share a cell, the "
                  "colour is the first one's — that period's lead skill.")
    for subject in SUBJECTS:
        for key in skills.ORDER[subject]:
            code = skills.code(key, subject)
            if any(r[0] == code and r[2] == subject for r in rows):
                continue
            chips.append((len(rows), skills.colour(key, subject)))
            add([code, skills.label(key, subject), subject],
                skills.gloss(key, subject))
    chips.append((len(rows), skills.colour("board_prep")))
    add(["BP", skills.label("board_prep"), "Grade 5 only"],
        skills.gloss("board_prep"))

    rows.append([""] * n_cols)
    sections.append(len(rows))
    add(["MARKS"], "The colours, lines and blanks in the grid, and what each "
                   "one means. Each one is shown, not only named.")
    add(["", "Mark", "Shown"], "What it means")   # "Shown" sits over SW0
    for mark, name, text, sw in MARKS:
        if sw == "bands":
            # Both bands side by side: one alone says nothing about the other.
            swatch.append((len(rows), SW0, SW0 + 1, "band0"))
            swatch.append((len(rows), SW0 + 1, WIDE, "band1"))
        elif sw:
            swatch.append((len(rows), SW0, WIDE, sw))
        add([mark, name] + (["PH"] if sw == "italic" else []), text)
    return rows, chips, sections, over, swatch


MARKS = [
    ("C/P", "two codes in a cell",
     "Two periods that day — a double. Only Maths, which runs six periods "
     "against five school days.", None),
    ("", "empty cell",
     "No period for that subject that day. Science has three a week, so two "
     "days a week are blank.", "blank"),
    ("", "alternating bands",
     "The background colour changes at every chapter boundary, so a long "
     "chapter reads as a long bar and you can see where the book's weight "
     "sits without counting anything.", "bands"),
    ("", "pale pink band",
     "A chapter FDE's syllabus breakdown omits, taught here anyway because "
     "the year has room. NONE IN 2026-27 — all 17 breakdown documents "
     "schedule every chapter of their book (verified 16 Sep 2026). The band "
     "is kept for a future syllabus that does drop one. See the "
     "Calendar — assumptions tab.", "omit"),
    ("", "italic code",
     "A basics period — phonics, arkaan saazi, communicative language, "
     "number fluency. The textbook does not carry it, but it is TAUGHT ON "
     "THE CHAPTER THE CLASS IS IN, using that chapter's own words and "
     "numbers, so it keeps the chapter's band. The class does not leave the "
     "book.", "italic"),
    ("", "gold band",
     "Grade 1's first six weeks. The class is not in the book yet \u2014 this is "
     "talking and listening, rhyme, syllables, first sounds, holding a "
     "pencil and counting. Children arrive with no pre-school, so the year "
     "starts by building what the book assumes. It is planned work, NOT A "
     "GAP.", "foundations"),
    ("", "violet column", "An official FDE assessment window.", "assess"),
    ("", "thick red line",
     "24 December 2026 — content must be finished by here. Everything right "
     "of it is revision and Grade 5 board prep.", "rule"),
    ("", "warm grey columns",
     "Every column right of that line — January to March. No new chapter is "
     "taught here; the shading is the revision and board-prep run, not a "
     "missing week.", "after"),
    ("", "thick grey line",
     "A vacation falls between these two columns. Only school days get a "
     "column, so the grid never shows an empty fortnight.", "vac"),
]


def grid_block(plans, days):
    """Three header rows plus one row per grade-and-subject, and the colours."""
    month, dom, wd, seen = [], [], [], None
    for day in days:
        key = (day.year, day.month)
        month.append(f"{MONTHS[day.month]} {day.year % 100}"
                     if key != seen else "")
        seen = key
        dom.append(str(day.day))
        wd.append(WEEKDAY[day.weekday()])
    head = [[""] * len(LEAD) + month,
            [""] * len(LEAD) + dom,
            LEAD + wd]
    head[0][0], head[1][0], head[2][0] = "Month", "Date", LEAD[0]
    body, bands, kinds, last = [], [], [], None
    for grade, subject, cells, st in plans:
        body.append([f"G{grade}" if grade != last else "", subject,
                     sy.periods_for(subject, grade), st["factual"],
                     st["fill"] + st["onramp"] + st["foundations"]]
                    + [c[0] for c in cells])
        bands.append([c[1] for c in cells])
        kinds.append([c[2] for c in cells])
        last = grade
    return head + body, bands, kinds, len(head)


def build(books):
    """books: [(grade, subject, segments, syllabus)], already sorted."""
    days, break_cols = day_columns()
    plans, onsets = [], {}
    for grade, subject, segments, syllabus in books:
        periods, st = ramp.allocate(grade, subject, segments, syllabus)
        # Where each skill first lands IN THE YEAR, as a percentage of the
        # periods to 24 December. The Skills Map used to read this off the
        # book's own day sequence, which says when a skill appears in the
        # TEXTBOOK and knows nothing about the ramp, the basics periods or
        # the calendar. The two answers are far apart: the G1 English book
        # reaches phonics a quarter of the way in, the calendar teaches it
        # from the first week. Only the allocator can answer it, so it is
        # answered here, where the allocated year exists.
        first = {}
        for i, period in enumerate(periods):
            first.setdefault(period["skill"], i)
        onsets[(subject, str(grade))] = {
            skill: {"period": i + 1, "of": len(periods),
                    "pct_through": 100.0 * i / max(1, len(periods) - 1)}
            for skill, i in first.items()}
        plans.append((grade, subject, lay_row(grade, subject, periods, days),
                      st))
    n_cols = len(LEAD) + len(days)
    weeks = len(sy.weeks(sy.school_days(end=sy.CONTENT_END)))

    # Two title rows, then the grid. The subtitle starts past the frozen edge
    # so it can run its full length instead of truncating at 346px.
    rows = [_wide(["TEACHING CALENDAR 2026-27"], "", n_cols),
            _wide([], "Content must land on or before 24 December 2026 — "
                      f"{weeks} teaching weeks to get there. The rest of the "
                      "session is revision and Grade 5 board prep. Period "
                      "budgets, FDE date conflicts and the month view are on "
                      "the Calendar — assumptions tab.", n_cols)]
    grid_top = len(rows)
    grid, bands, kinds, head_rows = grid_block(plans, days)
    rows += grid
    body_top = grid_top + head_rows

    rows.append([""] * n_cols)
    key_top = len(rows)
    key, chips, sections, over, swatch = key_block(n_cols)
    rows += key

    content_cut = len(LEAD) + sum(1 for d in days if d <= sy.CONTENT_END)
    assess = [len(LEAD) + i for i, d in enumerate(days)
              if any(s <= d <= e for s, e, _n, _g in sy.ASSESSMENTS)]
    rows = [r + [""] * (n_cols - len(r)) for r in rows]
    plan = {"n_cols": n_cols, "lead": len(LEAD), "wide": WIDE,
            "grid_top": grid_top, "head_rows": head_rows,
            "body_top": body_top, "body_rows": len(plans),
            "key_top": key_top,
            "sections": [key_top + r for r in sections],
            "chips": [(key_top + r, c) for r, c in chips],
            "swatch": [(key_top + r, c0, c1, n)
                       for r, c0, c1, n in swatch],
            "over": [key_top + r for r in over],
            "bands": bands, "kinds": kinds, "content_cut": content_cut,
            "assessment_cols": assess,
            "break_cols": [len(LEAD) + c for c in break_cols],
            "stats": [(g, s, st) for g, s, _c, st in plans],
            "onsets": onsets}
    return rows, plan
