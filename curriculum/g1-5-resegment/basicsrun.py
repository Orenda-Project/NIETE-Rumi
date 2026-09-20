"""Brief the basics periods of a book, so an author has something to write from.

    python3 basicsrun.py grade_2_math number_fluency
    python3 basicsrun.py --pilot            # the G2 + G3 NF pilot, 36 periods

A basics period has no row in `corpus/seg` -- that is the whole of bd-0gzqf --
so nothing in Stage C can reach it. `basicseg` synthesises the row and `cbrief`
turns the row into a brief; this joins them a book at a time and writes the
result where an author, and then `judgerun`, can find it.

TWO THINGS IT REFUSES TO GET WRONG.

The NAME. `judgerun` looks for `corpus-local/authored/<stem>_ch<N>_seg<I>.json`
and nothing else. The record's own id -- `grade_3_math_ch14_nf3` -- is the
readable name and is not that path, so the brief carries both: `id` to talk
about, `name` to write under. An artefact saved under the readable name is
invisible to the judge, and the judge's answer to a missing file is "no
authored artefact", which reads as work not started rather than work misfiled.

A PERIOD THAT WILL NOT GROUND. Measured 20 Sep 2026, one of the 366 fails:
`grade_3_math_ch14_nf3` resolves to no page, the pdf-257 mislabel tracked as
bd-pglby. A run that raises there delivers nothing; a run that drops it
silently delivers 35 and calls it 36. It carries its reason and is counted as a
failure, so the total is always the count of periods and never the count of
successes.
"""
import glob
import json
import os
import sys

import basics
import basicseg
import buildload
import cbrief
import fde
import pagecheck
import pageres
import ramp
import stageb

BRIEFS = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "corpus-local", "briefs")

# The pilot Amena picked on 20 Sep 2026. Not G1 + G3 as the spec first said:
# `ramp.allocate` schedules zero number-fluency periods in Grade 1 Maths,
# because that book has no slack. G2 15 + G3 21 = 36.
PILOT = (("grade_2_math", "number_fluency"), ("grade_3_math", "number_fluency"))


def artefact(stem, segment):
    """The name `judgerun` looks for. Not the record's readable id."""
    return "%s_ch%d_seg%d" % (stem, segment["chapter_number"],
                              segment["segment_index"])


def wanted(records, skill=None):
    """The records to build, narrowed to one skill if one is named.

    An unnamed skill is an error rather than an empty run: a book that
    allocates none of a real skill is a fact about the book, but a typo that
    returns nothing reads as exactly that fact and there is no way to tell
    them apart afterwards.
    """
    if skill is None:
        return list(records)
    if skill not in basicseg.NAME:
        raise KeyError("%r is not a basics skill. The eight are: %s"
                       % (skill, ", ".join(sorted(basicseg.NAME))))
    return [r for r in records if r["skill"] == skill]


class Period(object):
    """One basics period: briefed, or carrying the reason it was not."""

    def __init__(self, record, name=None, segment=None, brief=None, error=None):
        self.id = record["id"]
        self.skill = record["skill"]
        self.chapter = record["chapter"]
        self.name = name
        self.segment = segment
        self.brief = brief
        self.error = error

    @property
    def ok(self):
        return self.brief is not None

    def line(self):
        return "%-28s %-20s %s" % (self.id, self.skill,
                                   "OK  " + (self.name or "") if self.ok
                                   else self.error)


def one(record, chapter_rows, idx, meta):
    """Brief a single period. Never raises for a period that cannot ground.

    `basicseg` raises ValueError where the chapter has no segments or no page
    numbers; `cbrief` raises Ungrounded where the pages do not resolve. Both
    mean "this period has nothing behind it" and both have to be survivable,
    so both come back as a reason on the Period.

    `meta` is the book, in the keys `cbrief` reads it under -- `stem`, `grade`,
    `subject`. The chapter title is added here rather than passed in because
    one brief is one chapter, and `cbrief` takes it off the book.
    """
    try:
        segment = basicseg.segment(record, chapter_rows)
    except ValueError as exc:
        return Period(record, error=str(exc))
    name = artefact(meta["stem"], segment)
    book = dict(meta, chapter_title=segment.get("chapter_title"))
    try:
        res = pageres.resolve(segment, idx)
        brief = cbrief.context(segment, res.pages, book)
    except (cbrief.Ungrounded, ValueError) as exc:
        return Period(record, name=name, segment=segment, error=str(exc))
    return Period(record, name=name, segment=segment, brief=brief)


def book(stem, skill=None, truth=pagecheck.TRUTH, seg=pagecheck.SEG):
    """Every basics period of one book, briefed."""
    _stem, grade, subject, _meta, segments = stageb.load_book(
        os.path.join(seg, stem + ".json"))
    rec = fde.load(buildload.FDE_DIR, stem)
    periods, _ = ramp.allocate(grade, subject, segments,
                               set(rec["chapters"]) if rec else None)
    idx = pageres.index(pagecheck.load_pages(os.path.join(truth, stem)))
    meta = {"grade": grade, "subject": subject, "stem": stem}
    out = []
    for r in wanted(basics.records(stem, grade, subject, periods), skill):
        rows = [s for s in segments if s.get("chapter_number") == r["chapter"]]
        out.append(one(r, rows, idx, meta))
    return out


def write(periods, out=BRIEFS):
    """Save every brief that exists. A failure writes nothing, on purpose."""
    if not os.path.isdir(out):
        os.makedirs(out)
    for p in periods:
        if p.ok:
            with open(os.path.join(out, p.name + ".json"), "w") as fh:
                json.dump({"id": p.id, "name": p.name, "segment": p.segment,
                           "brief": p.brief}, fh, ensure_ascii=False, indent=2)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["--pilot"]:
        runs = PILOT
    elif argv:
        runs = ((argv[0], argv[1] if len(argv) > 1 else None),)
    else:
        runs = tuple((os.path.basename(p)[:-5], None) for p in
                     sorted(glob.glob(os.path.join(pagecheck.SEG,
                                                   "grade_*.json"))))
    out = []
    for stem, skill in runs:
        out.extend(book(stem, skill))
    for p in out:
        print(p.line())
    write(out)
    bad = [p for p in out if not p.ok]
    print("\n%d periods, %d briefed, %d could not ground"
          % (len(out), len(out) - len(bad), len(bad)))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
