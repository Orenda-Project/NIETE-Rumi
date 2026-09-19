"""Split one segment into two, and fix everything the split moved.

`strandspan` finds the rows worth reading. This is what you do to one once a
person has read it and decided it is genuinely two lessons: Grade 1 English
chapter 1 day 5 teaches rhyming off page 8 and days of the week off page 9,
and the book makes that cut itself -- page 8 is Activity 1 Rhyme Match end to
end, page 9 is Activity 2 Calendar Quest.

Deciding that is the easy half. The other half is eight rows of bookkeeping:
the poster day slides from 6 to 7, the review's label moves from "Day 7
(Review)" to "Day 8 (Review)", and every prev/next link either side of the cut
follows. Done by hand it does not fail loudly -- a wrong link still loads,
still renders, and teaches a day twice or skips one.

Two things this deliberately does not normalise:

  The link convention. English and Science books carry string ids
  (`e_g1_ch1_2`); every Maths and Urdu book carries bare integers. Tidying
  that would rewrite eleven books to make six consistent, so the type each
  book already uses is the type it keeps. (The disagreement is real and worth
  fixing; it is not worth fixing inside a split.)

  The tail sentinels. 990 is the review and 995 the assessment -- in both
  books' `chapter_tail_order` -- and those numbers are addresses, not
  positions. Renumbering them to 7 and 8 would break every reference to them.
  They keep their indices; only a `Day N` label on one is recounted.

An SLO is never dropped here. `split` divides the row's fields between the
halves exactly as the caller states them, and the caller is expected to hand
every code to one half or the other.
"""
import copy
import re

# Indices at or above this are addresses (990 review, 995 assessment), not
# positions in the teaching sequence.
SENTINEL = 990

DAY = re.compile(r"^Day\s+(\d+)(.*)$")


def ident(segment, prefix):
    """The id this row is linked by, in the book's own convention.

    `prefix` is the book's id stem (`e_g1`) for a string-linked book, or None
    for one that links by bare integer.
    """
    idx = segment["segment_index"]
    if prefix is None:
        return idx
    return f"{prefix}_ch{segment['chapter_number']}_{idx}"


def prefix_of(segments):
    """The id stem a chapter links by, or None if it links by integer.

    Read off the links already in the rows rather than assumed from the
    subject, so a book that does something unexpected is followed, not
    overruled.
    """
    for s in segments:
        for key in ("next_segment_id", "prev_segment_id"):
            v = s.get(key)
            if isinstance(v, str):
                m = re.match(r"^(.*)_ch\d+_[^_]+$", v)
                if m:
                    return m.group(1)
    return None


def renumber(segments):
    """Give the teaching rows 1..n and recount every `Day N` label.

    The day counter walks the rows in stored order and advances only on a
    label that actually starts with a day number, so "Assessment" is stepped
    over and the review that follows it still lands on the right day.
    """
    out = []
    day = 0
    teaching = 0
    for s in segments:
        s = copy.deepcopy(s)
        if s["segment_index"] < SENTINEL:
            teaching += 1
            s["segment_index"] = teaching
        m = DAY.match(str(s.get("day_label") or ""))
        if m:
            day += 1
            s["day_label"] = f"Day {day}{m.group(2)}"
        out.append(s)
    return out


def relink(segments, prefix=None):
    """Rebuild the prev/next chain over the rows in stored order."""
    ids = [ident(s, prefix) for s in segments]
    out = []
    for i, s in enumerate(segments):
        s = copy.deepcopy(s)
        s["prev_segment_id"] = ids[i - 1] if i else None
        s["next_segment_id"] = ids[i + 1] if i + 1 < len(ids) else None
        out.append(s)
    return out


def split(segments, segment_index, parts):
    """Replace one row with `parts` rows and repair the chapter around it.

    `segments` is one chapter's rows in stored order. `parts` is a list of
    field overrides, one per half; anything a half does not override it
    inherits from the row being split. Returns a new list -- the input is not
    touched.
    """
    if len(parts) < 2:
        raise ValueError(
            "a split makes at least two rows; %d asked for" % len(parts))

    at = None
    for i, s in enumerate(segments):
        if s["segment_index"] == segment_index:
            at = i
            break
    if at is None:
        raise KeyError("no segment %r in this chapter" % (segment_index,))

    halves = []
    for part in parts:
        half = copy.deepcopy(segments[at])
        half.update(copy.deepcopy(part))
        halves.append(half)

    rows = list(segments[:at]) + halves + list(segments[at + 1:])
    return relink(renumber(rows), prefix_of(segments))
