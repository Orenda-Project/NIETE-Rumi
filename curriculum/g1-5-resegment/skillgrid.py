"""The Skills Map's vocabulary — its columns, its characters, its ordering.

Split out of skillmap so the tab's five blocks stay readable in one file. Only
shape lives here: the nine column roles and their widths, the block characters
a track is drawn in, the first-appearance colour ramp, and the four helpers
every block uses (the keymap lookup, the teaching-ramp sort, the fixed-width
track, and the padded row). Nothing here reads skillsmap.json except `load`,
which does no derivation — the JSON *is* the analysis.
"""
import json
import os

import skills


# The same file build.py reads, and it has to be the same path: the Skills Map
# tab is built from this JSON and the coverage tabs are built from the corpus
# beside it, so two different defaults would let one tab describe a corpus the
# other never saw. `corpus/` is gitignored — restricted-educational-internal.
# Written as one expression on purpose: __all__ here is the whole contract of
# what `from skillgrid import *` hands skilldelta, and a test compares it name
# for name against the module's top-level bindings. A `_HERE` helper would be
# a name that has to be exported to satisfy that test and means nothing on the
# other side of the import.
DEFAULT_PATH = os.environ.get(
    "SKILLSMAP_JSON",
    os.path.join(os.environ.get(
        "CORPUS_DIR",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "corpus")),
        "skillsmap.json"))

BLOCK, HALF, VOID = "█", "▌", "░"
SLICES = 40
SUBJECTS = ("English", "Urdu", "Maths", "Science")

# Column roles. The track is last so the narrow scanning columns stay together.
SKILL_C, CODE_C, GRADE_C, YEAR_C, FIRST_C, PCT_C, CH_C, NOTE_C, TRACK_C = range(9)
N_COLS = 9
WIDTHS = {SKILL_C: 275, CODE_C: 44, GRADE_C: 56, YEAR_C: 64, FIRST_C: 62,
          PCT_C: 66, CH_C: 56, NOTE_C: 290, TRACK_C: 470}

TITLE = ("SKILLS MAP — when in the year each skill appears, and how that "
         "changes across Grades 1–5")
# The tab is 1,383px wide and this line overflows across it with nothing to
# wrap into, so it stops dead at column I. Two earlier drafts were cut
# mid-sentence there; Nastaliq glyphs are wider than Latin, so the Urdu term
# came out too and was dropped. At fontSize 10 a column holds roughly one
# character per 6.5px, so the budget is 1383/6.5 ≈ 212 Latin characters and
# this line is 153. Don't trust the figure — test_skillgrid measures it.
CONVENTION = (
    "Volume is counted in slots, position in day ordinals. Urdu writes "
    "review and revision as ordinary Day N rows, so a day count overstates "
    "it by 12–18 days.")
LEGEND = (f"█ the skill fills half this slice or more   ▌ the skill appears in "
          f"this slice   ░ not in this slice   ·   every track is {SLICES} "
          f"slices wide, whatever the grade's length")

# The frozen row stands over all four sections, each of which puts something
# different in column 7 — a span, a range of grades, a strength, a piece of
# evidence — so it names the column generically and the section head below it
# says which of those this block holds.
HEAD_TOP = ["Skill", "Code", "Grade", "Year days", "First day", "% through",
            "First ch.", "Span or note", "Track"]
HEAD_TL = HEAD_TOP[:7] + [
    "Span", "Left edge = day 1 · 40 slices · █ fills a slice · ▌ appears in it"]
# The Track column is the LAST one on the tab, so a legend written into it
# cannot overflow — it is cut where the column ends, 470px in. This one ran
# 165 characters into a 72-character cell and the export printed it as far as
# "+ = two or more grades share a sl", losing the two marks a reader is most
# likely to look up. What the header cannot hold goes in FA_MARKS below,
# which skilldelta writes on a line of its own where it is free to run right.
HEAD_FA = ["Skill", "Code", "G1", "G2", "G3", "G4", "G5",
           "Earliest and latest grade",
           "Left edge = day 1 · 40 slices · 1–5 = that grade at its % point"]

# Read after the header, on its own row, so it may overflow the whole tab.
FA_MARKS = ("+ = two or more grades share a slice   ·   — = never taught in "
            "that grade   ·   · = taught, but only in a chapter-close slot, "
            "so it has no day position")
HEAD_CT = ["Subject and grade", "", "Chapters", "Follow", "Deviate", "", "",
           "How strong the template is",
           "Modal chapter template — day rows only, not chapter-close slots"]
HEAD_AB = ["Skill", "Code", "Grade", "", "", "", "", "Evidence", "Absence"]

# First-appearance ramp, 20% a step: green starts the year, red starts it late.
WHEN = ["#D7EBD4", "#E8F0CE", "#FBEFC8", "#F9DCC4", "#F4C7C7"]


def load(path=DEFAULT_PATH):
    """The parsed skillsmap.json. Never re-derived here — it is the analysis."""
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _key(keymap, subject, label):
    return keymap.get((subject, label)) or skills.KEY_BY_LABEL.get(label, label)


def _ordered(keymap, subject, labels):
    """The subject's labels in teaching-ramp order. skills.ORDER is a SORT HINT
    only — what it does not know keeps its place at the end, never vanishes."""
    ramp = skills.ORDER.get(subject, [])

    def rank(label):
        key = skills.canonical(_key(keymap, subject, label), subject)
        return ramp.index(key) if key in ramp else len(ramp)
    return sorted(labels, key=rank)


def listed(keymap, subject, labels, onsets=None):
    """The skills FIRST APPEARANCE prints, as (label, key, from_book) triples.

    The book's labels first, in ramp order — then anything the CALENDAR
    teaches that no book ever carried. Communicative language and number
    fluency are exactly that: they have no day row anywhere, so a list built
    from `labels_seen_in_data` leaves them out, and the one block that knows
    which period they start on said nothing about them at all.

    `from_book` is False for those, because a percentage in a column of
    textbook subjects, with no day row behind it, otherwise reads as a book
    number.
    """
    out = [(lab, _key(keymap, subject, lab))
           for lab in _ordered(keymap, subject, labels)]
    if onsets is None:
        return [(lab, key, True) for lab, key in out]
    seen = {key for _lab, key in out}
    extra = {key for (subj, _g), got in onsets.items() if subj == subject
             for key in got if key not in seen}
    return ([(lab, key, True) for lab, key in out]
            + [(skills.label(key, subject), key, False)
               for key in sorted(extra)])


def track(seq, label, slices=SLICES):
    """A skill's days as a fixed-width run of block characters. Fixed width
    matters: the five grades are stacked and only line up if empty slices are
    as wide as full ones — hence ░, not a space or a dot."""
    n, out = len(seq), ""
    if not n:
        return VOID * slices
    for i in range(slices):
        a = i * n // slices
        win = seq[a:max((i + 1) * n // slices, a + 1)]
        hit = win.count(label)
        out += BLOCK if hit * 2 >= len(win) else HALF if hit else VOID
    return out


def _row(cells):
    """A padded row from {column index: value}."""
    return [cells.get(c, "") for c in range(N_COLS)]


# Keys a subject's vocabulary carries that are deliberately NOT textbook days:
# basics periods the Teaching Calendar allocates inside whatever chapter the
# class is in. Their absence from this file is correct, so they are named as a
# different kind of row rather than counted as a gap.
BASICS = {"communicative", "number_fluency"}

__all__ = ["DEFAULT_PATH", "BLOCK", "HALF", "VOID", "SLICES",
           "SUBJECTS", "N_COLS", "WIDTHS", "TITLE", "CONVENTION",
           "LEGEND", "HEAD_TOP", "HEAD_TL", "HEAD_FA", "FA_MARKS", "HEAD_CT",
           "HEAD_AB", "WHEN", "BASICS", "load", "track",
           "SKILL_C", "CODE_C", "GRADE_C", "YEAR_C", "FIRST_C",
           "PCT_C", "CH_C", "NOTE_C", "TRACK_C",
           "_key", "_ordered", "_row", "listed"]
