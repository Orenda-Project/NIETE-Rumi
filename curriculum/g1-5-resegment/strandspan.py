"""How many taught periods carry two strands that do not belong together?

Grade 1 English segment 5 teaches onset-rime rhyming and days of the week in
one 30-minute period. Three judge checks cap at 2 because of it and no
authoring pass moves them, so that row has to be split. bd-4lx8q asks the
obvious next question before anyone splits it by hand: how many others?

The easy answer is wrong twice. 565 of 2,038 segments carry SLO codes from
more than one strand, and neither half of that number survives contact:

  Only the rows the router sends to `d0_primary` become a single taught
  period. A revision row SHOULD sweep a chapter's strands -- that is what
  revision is -- and an assessment row the same. 469 of the 2,038 are one of
  those two, and none of them can hold a segmentation fault.

  Two strands are not two UNRELATED strands. Phonics beside reading, grammar
  beside writing, reading beside vocabulary: one teaching sequence, written as
  two codes. In this corpus those pairings are not the exception, they are the
  norm, and flagging them would bury the real ones.

So the measure is rarity, not multiplicity. A pairing the corpus makes twenty
times is a convention somebody chose; a pairing it makes once is more likely an
accident of where a chapter got cut. Run against all seventeen books this
leaves 29 rows out of 1,569 -- and `PA+VG`, segment 5's own pair, is one of the
singletons. The measure finds the thing it was built from.

Three or more strands is flagged whatever its frequency. Two can be a sequence;
three inside thirty minutes is a load question even when the corpus repeats it.

Every flag is a CANDIDATE FOR REVIEW. This module never calls one a fault and
the word does not appear in what it returns. Which of the 29 are genuinely
mis-cut is a pedagogical judgement made by reading the row, and a three-letter
strand token has no standing to make it.
"""
import collections

# A pair the corpus makes at most this often is rare enough to be worth a
# person's eye. Measured: at 2 the corpus yields 16 two-strand rows across 14
# pairs, against 243 rows sitting on pairings it makes three times or more.
RARE_AT = 2

# Only these rows become one taught period; see the module docstring.
TAUGHT = "content"

THREE = "three-or-more-strands"
RARE = "rare-pair"


class Candidate(object):
    """One row worth reading, and why it came up. Not a verdict."""

    def __init__(self, book, chapter, segment_index, strands, reason, seen):
        self.book = book
        self.chapter = chapter
        self.segment_index = segment_index
        self.strands = strands
        self.reason = reason
        self.seen = seen            # times the corpus makes this pairing

    def line(self):
        pair = "+".join(self.strands)
        seen = "" if self.reason == THREE else f"  seen {self.seen}x"
        return (f"{self.book:<20} ch {self.chapter:<3} day "
                f"{self.segment_index:<3} {pair:<12} {self.reason}{seen}")


def strands(segment):
    """The distinct strand tokens a segment's SLO codes name, sorted.

    Codes are shaped `X-N-X-N` -- `E-01-PA-01` -- and the strand is the third
    token. 5,409 of the corpus's 5,426 codes are exactly that; the rest end in
    a `?` where the source sheet left the number open, which does not change
    where the strand sits. A code too short to carry one is skipped rather than
    guessed at, because a wrong strand would invent a pairing.
    """
    out = set()
    for code in (segment or {}).get("slo_codes") or []:
        parts = str(code).split("-")
        if len(parts) >= 3 and parts[2]:
            out.add(parts[2])
    return tuple(sorted(out))


def pair_counts(rows):
    """How often each two-strand pairing appears among taught periods.

    Counted over taught rows only. A pairing made twenty times in revision is
    still rare as a period somebody has to deliver in thirty minutes.
    """
    counts = collections.Counter()
    for _, segment, kind in rows:
        if kind != TAUGHT:
            continue
        s = strands(segment)
        if len(s) == 2:
            counts[s] += 1
    return counts


def candidates(rows, rare_at=RARE_AT):
    """Rows worth a person reading, loudest reason first.

    `rows` is `(book, segment, kind)`, where `kind` is what `d0_route.kind()`
    returns for that segment. Passing the segment's own `lp_type` instead would
    be wrong: it is unset on 1,446 of the 2,038 rows, so the partition would
    silently drop 71% of the corpus into neither bucket.
    """
    counts = pair_counts(rows)
    out = []
    for book, segment, kind in rows:
        if kind != TAUGHT:
            continue
        s = strands(segment)
        if len(s) > 2:
            reason, seen = THREE, counts[s]
        elif len(s) == 2 and counts[s] <= rare_at:
            reason, seen = RARE, counts[s]
        else:
            continue
        out.append(Candidate(book, segment.get("chapter_number"),
                             segment.get("segment_index"), s, reason, seen))
    out.sort(key=lambda c: (c.reason != THREE, c.book, c.chapter or 0,
                            c.segment_index or 0))
    return out


def survey(rows, rare_at=RARE_AT):
    """The counts, each beside the denominator it is a fraction of.

    A bare "565 segments span two strands" is the number that gets quoted
    without its denominator and read as 565 broken lesson plans. Every figure
    here ships with what it was counted out of, so the honest version is the
    convenient one.
    """
    rows = list(rows)
    taught = [(b, s) for b, s, k in rows if k == TAUGHT]
    spans = [(b, s) for b, s in taught if len(strands(s)) > 1]
    found = candidates(rows, rare_at)
    return {
        "books": len({b for b, _, _ in rows}),
        "segments": len(rows),
        "content": len(taught),
        "content_multi_strand": len(spans),
        "candidates": len(found),
        "three_or_more": sum(1 for c in found if c.reason == THREE),
        "rare_pair": sum(1 for c in found if c.reason == RARE),
        "distinct_pairs": len(pair_counts(rows)),
    }


def corpus_rows(seg_dir=None):
    """`(book, segment, kind)` for every segment of every book. I/O lives here.

    `slo_index.json` shares the directory with the seventeen books and is not
    one -- it has no `segments` key at all.

    A row is named by book, chapter and day together. `segment_index` is the
    day WITHIN its chapter and restarts every chapter -- grade_1_urdu spends
    142 segments on ten distinct indices -- so it names nothing on its own.
    """
    import json
    import os

    import d0_route
    import pagecheck

    seg_dir = seg_dir or pagecheck.SEG
    rows = []
    for fn in sorted(os.listdir(seg_dir)):
        if not fn.endswith(".json") or fn == "slo_index.json":
            continue
        with open(os.path.join(seg_dir, fn)) as fh:
            book = json.load(fh)
        stem = fn[:-5]
        for s in book["segments"]:
            rows.append((stem, s, d0_route.kind(book, s)))
    return rows


def main():
    rows = corpus_rows()
    s = survey(rows)
    print(f"{s['books']} books, {s['segments']} segments, "
          f"{s['content']} taught periods")
    print(f"{s['content_multi_strand']} taught periods span >1 strand "
          f"across {s['distinct_pairs']} distinct pairings")
    print(f"{s['candidates']} worth reading "
          f"({s['three_or_more']} carry 3+ strands, "
          f"{s['rare_pair']} sit on a pairing seen <= {RARE_AT}x)\n")
    for c in candidates(rows):
        print(c.line())
    print("\nThese are candidates for review, not faults. Read the row.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
