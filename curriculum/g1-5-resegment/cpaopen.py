"""The C in CPA — opening every Maths chapter in children's hands.

Grade 4 ran a whole year without one concrete period: 5-digit place value,
4-digit multiplication and long division, entirely in symbols. Grade 3 had
one. Grade 5 appeared to have 33, which is why this rule was first written to
skip it — and that reading was wrong. Those days were the section heading
"Leap and Learn" read as a page. Not one of the 33 pages puts an object in a
child's hands, and the corpus says as much in its own second column, where
`cpa_phase` calls 28 of them pictorial. cpatrust drops the heading's claim
before this rule runs, so the board-prep year is now reached like any other
(bd-x2su1, correcting bd-wi85y).

The abstract end of the ramp was a labelling artefact and could be renamed
(see cparamp). This end could not. The Grade 1 book opens a topic with
Adventure Begins and Leap and Learn pages that really do put objects in front
of the child, and its page text says so in its own words on 21 of its 36
concrete days: "Deal out real counters one-to-one", "Use a real balance and
counters/stones", "act out buying with play money". From Grade 2 on, those
same sections open with printed prices and place-value tables instead.
Scanning every G2-G5 day for a manipulative to recover turned up nothing real
— the matches were `Disc`overy, cube NUMBERS, and the CUBES word-problem
acronym. There was nothing to rename.

So this rule ADDS a hands-on start where the book gives none. It spends no
period: the chapter's opening day already exists and keeps its pages, its SLO
and its place in the year, which matters because the content has to land by
24 December. What changes is how the day opens — counters and straws before
the printed page. That is the anchoring-in-the-book-while-teaching-basics the
revamp is for, and it matters most here, because hardly any primary teacher
is a subject expert and the concrete stage is where place value, multiplica-
tion and division are actually learned or lost.

Because this is ours and not the book's, every day it touches is marked
`concrete_added` with the manipulative named, and stageb.day_flags surfaces
that in the Flags column. A teacher, a reviewer and the LP writer can all
tell our concrete days from the book's own.

A chapter with no picture or bridge day to convert is left alone. We give a
hands-on start to a day that was going to be taught anyway; we do not turn
the application end of the ramp into its beginning.
"""

CONVERTIBLE = ("pictorial", "pictorial_abstract")
CONCRETE = "concrete"
MARK = "concrete_added"

# What to put in children's hands, by what the day teaches. First match wins,
# so the specific topics come before the general ones — every chapter is
# about numbers, but only some are about fractions.
#
# Decimals come before fractions for the same reason. The two Grade 5
# chapters that convert BETWEEN them name both, and a fraction-first match
# handed them folded paper strips: strips show halves and thirds and cannot
# show a hundredth, which is the whole content of those chapters. A grid
# shaded ten by ten is one thing read three ways, so it also serves the
# chapter that meets percentages (bd-w1r3k).
MANIPULATIVES = (
    (("decimal", "percent", "tenth", "hundredth"),
     "a 10x10 paper grid — shade it before writing the decimal"),
    (("fraction",),
     "folded paper strips — fold and tear the parts before naming them"),
    (("time", "clock", "hour", "calendar"),
     "a geared clock face — turn the hands to each time before reading it"),
    (("money", "currency", "denomination", "rupee", "shopping", "budget"),
     "play money notes and coins — make each amount before writing it"),
    (("mass", "weight", "kilogram", "gram"),
     "a balance and everyday objects — feel which is heavier first"),
    (("capacity", "litre", "volume"),
     "jugs, cups and water — pour it before recording it"),
    (("length", "metre", "centimetre", "distance", "measur"),
     "a metre string and a ruler — measure real objects before converting"),
    (("temperature", "thermometer"),
     "a real thermometer in warm and cold water before reading the scale"),
    (("perimeter", "area", "shape", "geometr", "polygon", "angle", "symmet"),
     "paper shapes, straws and square tiles — build the figure first"),
    (("pattern",),
     "coloured tiles or beads — lay the pattern out before continuing it"),
    (("data", "graph", "tally", "pictograph", "carroll", "chance", "probab"),
     "real objects sorted into a floor pictograph before it is drawn"),
    (("multipl", "times table", "skip count", "array", "repeated addition"),
     "counter arrays — build the rows and columns before writing the fact"),
    (("divi", "factor", "multiple", "shar"),
     "counters shared into equal groups before the algorithm"),
    (("add", "sum", "subtract", "differen", "regroup", "estimat"),
     "counters on a place-value mat — trade ten ones for a ten by hand"),
    (("place value", "digit", "thousand", "round", "roman", "compar",
      "order", "number"),
     "bundles of straws or place-value blocks — build the number first"),
)
DEFAULT = "counters — build the idea with objects before the printed page"


def manipulative(day):
    """What the children hold. The day's own topic decides it; the chapter
    title is the fallback, because a few opening days are named for a method
    rather than for what they teach."""
    for text in (day.get("topic"), day.get("chapter_title")):
        low = (text or "").lower()
        if not low:
            continue
        for words, kit in MANIPULATIVES:
            if any(word in low for word in words):
                return kit
    return DEFAULT


def _chapters(segments):
    """Teaching days per chapter, in order, keyed by chapter number."""
    out = {}
    for i, seg in enumerate(segments):
        if seg.get("day_label"):
            out.setdefault(seg.get("chapter_number"), []).append(i)
    return out


def open_concrete(segments, subject):
    """Give every Maths chapter a hands-on day. Returns (segments, added)."""
    if subject != "Maths":
        return segments, 0
    out, added = list(segments), 0
    for rows in _chapters(segments).values():
        if any(out[i].get("skill_type") == CONCRETE for i in rows):
            continue
        opener = next((i for i in rows
                       if out[i].get("skill_type") in CONVERTIBLE), None)
        if opener is None:
            continue
        seg = out[opener]
        out[opener] = dict(seg, skill_type=CONCRETE, cpa_phase=CONCRETE,
                           **{MARK: manipulative(seg)})
        added += 1
    return out, added
