"""The FDE Syllabus tab — FDE's own pacing, against ours.

This tab was built to name what FDE leaves out. It turns out FDE leaves out
nothing: all seventeen breakdown documents schedule every chapter of their
book, 233 chapters in all, verified 16 September 2026 against the page-truth
corpus. The first reading of these documents said otherwise, and it was wrong —
the Urdu documents write half their chapter labels in Urdu script ("سبق نمبر 10"
for "Chapter 10") and bundle two or three chapters into one week's cell, and a
parser reading only English and only the first line of a cell reported those
chapters as dropped. They were never dropped.

So what is left to compare is pacing, not coverage:

  FDE's weeks per chapter — how long the syllabus breakdown gives a chapter.
  Our periods per chapter — how long this plan gives it.

Where those two disagree the school will feel it, because FDE's assessment
windows are fixed and a class pacing off our plan has to arrive at the same
place on the same week. The omission machinery below is kept, not deleted: if
a future breakdown does drop a chapter, it is labelled here and on the subject
tabs rather than quietly disappearing.

The breakdown docs are also FDE's own week-by-week calendar, so the last block
here is the break spine — the vacations FDE itself assumes — which is what the
Teaching Calendar allocates around.

Painting this tab lives in fdefmt, beside the same split in calfmt and covfmt.
"""
import stageb

SUBJECT_ORDER = {"English": 0, "Urdu": 1, "Maths": 2, "Science": 3}

INTRO = [
    ["FDE SYLLABUS BREAKDOWN vs THIS PLAN", "", "", "", "", "", "", "", "", ""],
    ["Source: the 17 FDE syllabus-breakdown docs (Month · Week · Chapter · "
     "Lesson Plan Topic) for 2026-27, read as data — one row per teaching "
     "week, chapters matched to the page-truth corpus by number, in both "
     "English and Urdu script.",
     "", "", "", "", "", "", "", "", ""],
    ["✅ VERIFIED 16 Sep 2026: FDE omits no chapter. Every chapter of every "
     "book is scheduled somewhere in its breakdown document. The comparison "
     "worth making is therefore PACE — FDE's weeks per chapter against our "
     "periods per chapter — not coverage.",
     "", "", "", "", "", "", "", "", ""],
    [""] * 10,
]

HEAD = ["Grade", "Subject", "Chapters in book", "Chapters FDE schedules",
        "Not scheduled by FDE", "FDE teaching weeks",
        "FDE revision + assessment weeks", "FDE weeks per chapter",
        "Our periods for the book", "Our periods per chapter"]

DROP_HEAD = ["Grade", "Subject", "Ch.", "Chapter title", "Days in our plan",
             "Kind of chapter", "Status", "", "", ""]


FINDING = (
    "Nothing. All 17 breakdown documents schedule every chapter of their "
    "book — 233 chapters, checked one by one against the page-truth corpus "
    "on 16 Sep 2026, reading chapter labels in both English (“Chap 8”) and "
    "Urdu (“سبق نمبر 8”) and expanding the week cells that name two or "
    "three chapters at once. The omission machinery is kept, not deleted: a "
    "future breakdown that does drop a chapter is named here and red-banded "
    "on its own subject tab.")


def _line(text, ncols=10):
    """A row whose whole content is one sentence in column A, to be merged."""
    return [text] + [""] * (ncols - 1)


# The corpus file names are not consistent about the subject: Maths is
# `maths` in Grade 1 and `math` in Grades 2-5, and Science is
# `general_science`. Rendering the stem verbatim put "G2 Math" beside
# "G1 Maths" and "G4 General" where the book is Grade 4 Science, so the
# subject is looked up, not capitalised.
BOOK_SUBJECT = {"english": "English", "urdu": "Urdu",
                "math": "Maths", "maths": "Maths",
                "science": "Science", "general_science": "Science",
                "general_knowledge": "Gen. Knowledge"}


def book_label(stem):
    """`grade_4_general_science` → `G4 Science`. A list of books should read
    as books, not as the file names the documents were parsed from."""
    parts = stem.split("_")
    tail = "_".join(parts[2:])
    return f"G{parts[1]} {BOOK_SUBJECT.get(tail, tail.capitalize())}"


def _kind(subject, title):
    """What sort of chapter FDE dropped — the pattern matters more than the
    count. Kept against a future breakdown that does drop one; no breakdown
    in 2026-27 does."""
    t = title or ""
    if "سنانے" in t:
        return "سنانے کا سبق · listening/telling lesson"
    if "پڑھنے" in t:
        return "پڑھنے کا سبق · reading lesson"
    if subject == "Maths":
        return "a whole Maths strand"
    return "content chapter"


def _status(subject, title):
    kind = _kind(subject, title)
    if "سنانے" in kind or "پڑھنے" in kind:
        return ("Oral-language and listening work. Dropping it removes the "
                "only listening-comprehension teaching in the book — keep as "
                "enrichment, or fold its oral task into the chapter before it.")
    if kind == "a whole Maths strand":
        return ("A strand, not a topic. If it is skipped the strand is untaught "
                "in that grade and the next grade's chapter on it has no "
                "prerequisite. Teach it or say out loud that it is skipped.")
    return "Not scheduled by FDE. Teach if the calendar allows."


def build(books, breaks):
    """books: [(grade, subject, stats, rows, fde_record)] · breaks: label -> [book]"""
    rows = list(INTRO)
    rows.append(HEAD)
    body_start = len(rows)

    books = sorted(books, key=lambda b: (b[0], SUBJECT_ORDER[b[1]]))
    tot_ch = tot_sched = tot_per = 0
    for grade, subject, st, _rows, rec in books:
        weeks = rec["weeks"] if rec else []
        teach = sum(1 for w in weeks if w["kind"] == "teach")
        rev = sum(1 for w in weeks if w["kind"] in ("revision", "assessment"))
        # Periods, so this tab and the Teaching Calendar count the same
        # thing: a chapter carries its revision and assessment periods.
        periods = st["rows"]
        chapters = st["chapters"]
        omitted = st["omitted_chapters"]
        scheduled = chapters - len(omitted)
        tot_ch += chapters
        tot_sched += scheduled
        tot_per += periods
        rows.append([
            f"Grade {grade}", subject, chapters, scheduled,
            ", ".join(str(c) for c in omitted) or "none",
            teach or "—", rev or "—",
            f"{teach / scheduled:.1f}" if teach and scheduled else "—",
            periods,
            f"{periods / chapters:.1f}" if chapters else "—"])
    rows.append(["ALL", "", tot_ch, tot_sched,
                 "none — FDE omits nothing" if tot_ch == tot_sched else "⚠",
                 "", "", "", tot_per, ""])
    total_row = len(rows) - 1

    rows.append([""] * 10)
    rows.append(_line("WHAT FDE LEAVES OUT"))
    drop_title = len(rows) - 1

    # Collected first, written second: with no real omission the block is a
    # one-sentence FINDING, not a table with a synthetic row in it. A table
    # header over a single "— — —" row paints seven labelled columns and
    # three unlabelled ones, which is how H26:J26 came to be painted and
    # empty on the last export.
    drops = []
    for grade, subject, st, book_rows, _rec in books:
        seen = set()
        for r in book_rows:
            if r.get("fde") != stageb.OMITTED or r["chapter"] in seen:
                continue
            seen.add(r["chapter"])
            days = sum(1 for x in book_rows
                       if x["chapter"] == r["chapter"] and x["kind"] == "day")
            title = r["chapter_title"]
            drops.append([f"Grade {grade}", subject, r["chapter"], title, days,
                          _kind(subject, title), _status(subject, title),
                          "", "", ""])
    if drops:
        rows.append(DROP_HEAD)
        drop_head = len(rows) - 1
        rows += drops
        finding = None
    else:
        drop_head = None
        rows.append(_line(FINDING))
        finding = len(rows) - 1
    drop_end = len(rows)

    rows.append([""] * 10)
    rows.append(["THE BREAKS FDE ITSELF ASSUMES", "", "", "", "", "", "", "",
                 "", ""])
    rows.append(["Written into the breakdown docs as bare cells between week "
                 "rows. The docs do not agree to the day, so the calendar "
                 "takes the earliest start and the latest return — the "
                 "conservative reading.", "", "", "", "", "", "", "", "", ""])
    # Books, then the label, then who writes it. The count is the only short
    # value, so it takes the 80px column; the label is merged across B:E and
    # the book list starts at F and overflows right across the empty tail.
    # The third column was unlabelled before — it is the C31 defect.
    rows.append(["Books", "Break as written in the breakdown documents",
                 "", "", "", "Which books write it that way", "", "", "", ""])
    break_head = len(rows) - 1
    for label, who in sorted(breaks.items(), key=lambda kv: -len(kv[1])):
        rows.append([len(who), label, "", "", "",
                     ", ".join(sorted(book_label(b) for b in who)),
                     "", "", "", ""])
    break_end = len(rows)

    plan = {"body": (body_start, total_row), "total": total_row,
            "drops": (drop_title, drop_end), "drops_head": drop_head,
            "finding": finding, "breaks": break_head,
            "breaks_rows": (break_head, break_end),
            "n_rows": len(rows), "clean": tot_ch == tot_sched}
    return rows, plan
