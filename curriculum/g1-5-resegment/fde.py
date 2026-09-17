"""The FDE syllabus breakdown, read as data.

Each of the 17 breakdown docs is a Google Docs table: Month · Week · Chapter ·
Lesson Plan Topic, one row per teaching week of 2026-27. That makes it two
things at once — the list of chapters FDE actually expects taught, and FDE's
own week-by-week calendar, holidays included. We use both: the chapter list to
mark what the book carries but the syllabus drops, and the calendar to allocate
periods against the same weeks the school is working to.

The docs export with every table cell prefixed by a tab, so splitting on tabs
recovers the cells in reading order.
"""
import os
import re

WEEK = re.compile(r"^week\s*(\d+)", re.I)
MONTH = re.compile(r"^(January|February|March|April|May|June|July|August|"
                   r"September|October|November|December)\s+(20\d\d)", re.I)
# Every doc writes the chapter cell differently: "Chap 1:", "Chap 2",
# "Chapter 2: Summing Superheroes", "Ch 1: Hello World!", "Ch: 1 Pinky's
# Dental Dilemma", and in Science a bare "1. Green Guardians of Earth". One
# regex covers all six because the cell is found by position, not by shape.
CHAP = re.compile(r"^\s*(?:ch(?:ap(?:ter)?)?)?\s*\.?\s*:?\s*(\d+)\s*[:.)\u2013-]?", re.I)
# The Urdu docs switch script mid-table: the same column that reads "Chap 8"
# in one week reads "سبق نمبر 10:" the next, and Urdu-Indic digits appear too.
# Read as English-only this looked like FDE dropping those chapters — it was
# not, they were simply written in Urdu. Both forms are the same cell.
SABAQ = re.compile(r"(?:سبق|باب)\s*(?:نمبر)?\s*[:#]?\s*([\d\u06f0-\u06f9]+)")
URDU_DIGITS = str.maketrans("\u06f0\u06f1\u06f2\u06f3\u06f4"
                            "\u06f5\u06f6\u06f7\u06f8\u06f9", "0123456789")
BREAK = ("holiday", "vacation", "break", "winter", "summer", "eid")
GRADED = ("assessment", "exam", "test", "term")


def cells(path):
    """Every table cell of the doc, in reading order.

    Google Docs exports a table cell-per-line with a leading tab, so splitting
    on tabs recovers the cells. The preamble above the table (each book's
    "IMPORTANT NOTE" describing its section pattern) is dropped by starting at
    the first Week cell.
    """
    with open(path, encoding="utf-8-sig") as fh:
        text = fh.read()
    out = [c.strip() for c in text.split("\t")]
    for i, c in enumerate(out):
        if WEEK.match(c):
            return out[max(0, i - 2):]
    return out


def chapter_number(cell):
    """The chapter number a cell names, or None if it names none.

    Either script. English "Chap 8" and Urdu "سبق نمبر 10" are the same cell
    written two ways, and several Urdu docs use both within one table.
    """
    head = cell.split("\n")[0]
    m = CHAP.match(head)
    if m:
        return int(m.group(1))
    m = SABAQ.search(head)
    return int(m.group(1).translate(URDU_DIGITS)) if m else None


# A line that labels a chapter by name, anywhere in the cell. Unlike CHAP it
# demands the word, because the second and third lines of a chapter cell are
# titles and a title may open with a digit.
# "Chap 14 , 15" and "Chapter 10 & 11: Mass & Capacity" — two chapters taught
# as one week, written as a list after the label. Only the head of the cell,
# up to the colon, is searched, so a title's own numbers are not mistaken for
# chapters.
ALSO = re.compile(r"(?:[,&]|\band\b|\u2013|-)\s*([\d\u06f0-\u06f9]{1,2})\b")
NAMED = re.compile(r"(?:ch(?:ap(?:ter)?)?\s*\.?\s*:?\s*|سبق\s*(?:نمبر)?\s*[:#]?\s*"
                   r"|باب\s*(?:نمبر)?\s*[:#]?\s*)([\d\u06f0-\u06f9]+)", re.I)


def chapter_numbers(cell):
    """Every chapter the cell names, in order.

    The last teaching weeks of several Urdu docs put three chapters in one
    cell — "سبق نمبر 16 … Chap 17 … Chap 18" — because the three are read
    together in one week. Reading only the cell's first line made chapters 17
    and 18 look dropped from the syllabus. They are not; they are in the same
    cell as 16.
    """
    lines = [ln for ln in cell.split("\n") if ln.strip()]
    if not lines:
        return []
    out, first = [], chapter_number(cell)
    if first is not None:
        out.append(first)
        head = lines[0].split(":")[0]
        for m in ALSO.finditer(head[head.find(str(first)):]):
            n = int(m.group(1).translate(URDU_DIGITS))
            if n not in out:
                out.append(n)
    for ln in lines:
        for m in NAMED.finditer(ln):
            n = int(m.group(1).translate(URDU_DIGITS))
            if n not in out:
                out.append(n)
    return out


def chapter_title(cell):
    parts = [p.strip() for p in cell.split("\n") if p.strip()]
    if not parts:
        return ""
    head = SABAQ.sub("", CHAP.sub("", parts[0], count=1), count=1)
    head = head.lstrip(" :\u060c-").strip()
    return (head + " " + " ".join(parts[1:])).strip()


def kind_of(cell):
    low = cell.lower()
    if any(w in low for w in BREAK):
        return "break"
    if any(w in low for w in GRADED):
        return "assessment"
    if "revision" in low or "review" in low:
        return "revision"
    return "teach"


def parse(path):
    """[{month, week, dates, chapter, title, topics, kind}] in reading order.

    The table is Month · Week · Chapter · Lesson Plan Topic, and Month is
    merged down the month's rows, so the columns cannot be recovered by
    counting. They can be recovered by order: a Week cell opens a row, the
    next cell is its Chapter, everything after that is its topics, until the
    next Week cell. That holds for all seventeen docs; matching on the shape
    of the chapter text does not.
    """
    out, month, row, slot = [], "", None, 0
    for cell in cells(path):
        if not cell:
            continue
        if MONTH.match(cell):
            month = cell.split("\n")[0]
            continue
        if WEEK.match(cell):
            if row:
                out.append(row)
            lines = cell.split("\n")
            row = {"month": month, "week": lines[0].strip(),
                   "dates": " ".join(lines[1:]).strip(),
                   "chapter": None, "chapters": [], "title": "",
                   "topics": [], "kind": ""}
            slot = 0
            continue
        if row is None:
            continue
        if slot == 0:
            row["kind"] = kind_of(cell)
            row["title"] = (cell.replace("\n", " ").strip()
                            if row["kind"] != "teach" else chapter_title(cell))
            if row["kind"] == "teach":
                row["chapters"] = chapter_numbers(cell)
                row["chapter"] = (row["chapters"] or [None])[0]
            slot = 1
            continue
        if len(cell) < 90 and kind_of(cell) == "break":
            # A holiday is written as a bare cell between two week rows, not
            # as a week of its own. It closes the row it trails and stands as
            # its own entry, so the calendar can honour the same break FDE does.
            out.append(row)
            out.append(dict(row, week="", dates="", chapter=None, chapters=[],
                            topics=[], kind="break",
                            title=cell.replace("\n", " ").strip()))
            row = None
            continue
        # The last teaching week of several books names its second and third
        # chapters inside the topics cell rather than the chapter cell.
        for ch in chapter_numbers(cell) if NAMED.search(cell) else []:
            if ch not in row["chapters"]:
                row["chapters"].append(ch)
        row["topics"] += [t.strip() for t in cell.split("\n") if t.strip()]
    if row:
        out.append(row)
    return out


def book_chapters(weeks):
    """{chapter number: {title, weeks, topics}} as the syllabus orders them."""
    out = {}
    for w in weeks:
        if w["kind"] != "teach":
            continue
        # A week that names three chapters counts for all three; the week
        # itself is one week, so only the chapter that leads it accrues it.
        for i, ch in enumerate(w.get("chapters") or []):
            rec = out.setdefault(ch, {"title": w["title"] if i == 0 else "",
                                      "weeks": 0, "topics": []})
            rec["weeks"] += 1 if i == 0 else 0
            if i == 0:
                rec["topics"] += w["topics"]
    return out


def load(dirpath, stem):
    path = os.path.join(dirpath, stem_for(stem) + ".txt")
    if not os.path.exists(path):
        return None
    weeks = parse(path)
    return {"weeks": weeks, "chapters": book_chapters(weeks)}


# The page-truth corpus and the FDE docs name the same book differently.
ALIAS = {"math": "maths", "general_science": "science"}


def stem_for(stem):
    for a, b in ALIAS.items():
        if stem.endswith("_" + a):
            return stem[:-len(a)] + b
    return stem
