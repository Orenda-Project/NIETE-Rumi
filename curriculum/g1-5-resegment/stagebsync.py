# -*- coding: utf-8 -*-
"""Make the Stage-B SLO columns on the matrix say what the build says.

bd-t29rs. The four subject tabs were painted before bd-fkc3a, so they still
carry its defect: 88 Urdu rows print a supporting code with an empty cell
beside it, and 1,059 more codes across English and Urdu print bare. The
corpus and the code are fixed; the sheet is not, and the sheet is what the
reviewer reads.

Repainting is not on offer. `build.py <Subject>` drops the tab and recreates
it -- a new gid, and 12,655 Stage C cells written back as PENDING -- so the
fix has to reach the sheet the way `dayobjsheet` reaches it: one column at a
time, in place, joined by (grade, chapter, day).

Two rules carry the whole file:

  * THE JOIN IS (grade, chapter, day), NEVER THE TOPIC AND NEVER THE ROW
    INDEX. A row index moves the moment a column is inserted or a day is
    folded, and `grade_5_urdu` repeats three topic strings inside itself.
  * A row this build does not own keeps what it holds. A grade banner, a
    chapter header and an assessment tail are not teaching days; blanking
    them to fix a defect they do not have is how a repair becomes damage.

Only the columns Stage B alone writes are in reach -- `Bloom's` was re-rated
on the sheet by `bloomrun` and every Stage C column is enrichment, so
neither is named here and neither can be sent.

Nothing here touches the network. `stagebsend` is the half that does, and
the split is the point: what a column should hold is decided by rules that
can be tested against a fixture, and only then handed to something that can
change a sheet 4,400 people's lessons are built from.
"""
import stagec

#: Sheet column -> the key `stageb.build_rows` writes it from, in header
#: order. Every column Stage B alone owns is here and nothing else is: a
#: chapter that re-folds moves its topic and its pages too, so owning the
#: SLO cells alone would leave a row describing a lesson that no longer
#: exists. `Bloom's` is absent because `bloomrun` re-rated it ON the sheet,
#: `Day objective` because `dayobjsheet` owns it, and every Stage C column
#: because this build writes them as PENDING and would undo the enrichment.
FIELD = [("Day #", "day_label"), ("Topic", "topic"),
         ("Skill type", "skill_type"), ("Pages (printed)", "pages"),
         ("Page overlap", "overlap"), ("Primary SLO", "primary_slo"),
         ("SLO role", "slo_role"),
         ("Primary SLO description", "primary_slo_desc"),
         ("Supporting SLOs", "supporting_slos"),
         ("Supporting SLO descriptions", "supporting_descs"),
         ("Flags", "flags")]

COLUMNS = [c for c, _ in FIELD]
FIELD = dict(FIELD)

#: What a column says about a day nobody has reached yet. `pending` is the
#: word every other day row on the tab uses for a stage that has not run, so
#: a blank cell there would read as "does not apply" instead. These three are
#: blank on purpose: nothing automatic is coming for a day objective or a
#: human reviewer, and `Traces` is filled by the publish, not by a stage.
PENDING = stagec.PENDING
BLANK = (u"Day objective", u"Human reviewer")

HEADER_ROW = 3                      # 1-based; data starts on row 4
SHEET = "14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio"
TABS = [(u"English G1–5", "English"), (u"Urdu G1–5", "Urdu"),
        (u"Maths G1–5", "Maths"), (u"Science G4–5", "Science")]


class Plan(object):
    """One column of values per Stage-B column, and the case for writing it."""

    def __init__(self, values, changed, missing, unplaced, days):
        self.values = values
        self.changed = changed
        self.missing = missing
        self.unplaced = unplaced
        self.days = days

    def dirty(self):
        """The columns whose current cells disagree with the build."""
        return [c for c in COLUMNS if self.changed.get(c)]


def _names(header):
    # Literally, never a prefix: `Pages (printed)` and `Teacher-primary min
    # (of 40)` both carry a parenthetical, and trimming it to be clever
    # about `Traces (2026-09-21)` is how a column lookup finds the wrong
    # column.
    return [u"%s" % h for h in header]


def position(header, column):
    names = _names(header)
    if column not in names:
        raise ValueError("no %r column in %r" % (column, names))
    return names.index(column)


def wanted(rows):
    """{(grade, chapter, day): {column: value}} for every teaching day built.

    `day_label` is what column A prints, so the number in it is the same
    number the join reads off the sheet -- the fold renumbers both together
    inside `stageb.load_book`, which is why this reads built rows and never
    the raw corpus.
    """
    out = {}
    for row in rows:
        if row.get("kind") != "day":
            continue
        label = str(row.get("day_label") or "")
        if not label.startswith("Day"):
            continue
        key = (int(row["grade"]), int(row["chapter"]), int(label.split()[1]))
        out[key] = dict((c, row.get(FIELD[c]) or u"") for c in COLUMNS)
    return out


def fresh(header, row):
    """A whole row for a day the tab does not have yet, header-wide.

    Stage B fills what it knows and every other stage says `pending`. The
    alternative -- leaving them empty -- would make an unwritten lesson look
    like a finished one whose columns did not apply, which is the proxy
    "dark stages stay dark" exists to forbid.
    """
    out = []
    for name in _names(header):
        if name in COLUMNS:
            out.append(row.get(name) or u"")
        elif name in BLANK or name.startswith(u"Traces"):
            out.append(u"")
        else:
            out.append(PENDING)
    return out


def _cell(row, at):
    if at < len(row) and row[at] is not None:
        return u"%s" % row[at]
    return u""


def plan(header, rows, want):
    """What each Stage-B column should hold, row for row, nothing left over."""
    at = dict((c, position(header, c)) for c in COLUMNS)
    want = dict(want)
    values = dict((c, []) for c in COLUMNS)
    changed = dict((c, 0) for c in COLUMNS)
    missing, days = [], 0
    grade = chapter = None
    for raw in rows:
        raw = raw or []
        first = str(raw[0]).strip() if raw and raw[0] is not None else ""
        kind = stagec.classify_row(first)
        if kind == "grade_banner":
            grade = int(first.split()[1])
        elif kind == "chapter_header":
            chapter = int(first.split(":")[0].split()[-1])
        if kind != "day":
            # Echoed, not blanked: a banner, a chapter header and a chapter
            # tail are not teaching days, and this build says nothing about
            # them. Writing them back unchanged keeps the column a single
            # contiguous range, which is one API call instead of hundreds.
            for c in COLUMNS:
                values[c].append([_cell(raw, at[c])])
            continue
        days += 1
        key = (grade, chapter, int(first.split()[1]))
        row = want.pop(key, None)
        if row is None:
            missing.append(key)
        for c in COLUMNS:
            now = _cell(raw, at[c])
            new = now if row is None else (row[c] or u"")
            values[c].append([new])
            if new != now:
                changed[c] += 1
    return Plan(values, changed, missing, sorted(want), days)


def inserts(header, rows, want):
    """Where a blank row has to go before every built day has a home.

    Bottom-up, so applying one cannot shift the next. The position comes
    from the day BEFORE the missing one, inside its own chapter: appending
    at the end of the tab would file Chapter 1's new day after Chapter 20's.
    """
    seen, order = {}, []
    grade = chapter = None
    for i, raw in enumerate(rows):
        raw = raw or []
        first = str(raw[0]).strip() if raw and raw[0] is not None else ""
        kind = stagec.classify_row(first)
        if kind == "grade_banner":
            grade = int(first.split()[1])
        elif kind == "chapter_header":
            chapter = int(first.split(":")[0].split()[-1])
            order.append((grade, chapter))
            seen.setdefault((grade, chapter), {"at": i + 1, "days": {}})
        elif kind == "day" and (grade, chapter) in seen:
            block = seen[(grade, chapter)]
            block["days"][int(first.split()[1])] = i
            block["at"] = i + 1
    out = []
    for key in sorted(want):
        g, ch, day = key
        block = seen.get((g, ch))
        if block is None or day in block["days"]:
            continue
        before = block["days"].get(day - 1)
        out.append(((before + 1) if before is not None else block["at"], key))
    return sorted(out, reverse=True)
