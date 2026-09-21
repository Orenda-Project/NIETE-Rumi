# -*- coding: utf-8 -*-
"""Write the authored day objectives onto the corpus segments.

The objectives are written by hand -- one sentence per teaching day, one
JSON file per book under `corpus/objectives/` -- because no rule derives
them: they are the thing the SLO code fails to say (see dayobj). This
driver is the only path from those files onto a segment, so it is the
only place a wrong one can land.

A COMPLAINT STOPS THE WHOLE BOOK. `dayobj.check` already names every
mismatch; the rule here is that a book writes all of its objectives or
none. A half-written book is worse than an unwritten one: the days that
got a sentence look authored, and the days that did not look deliberate,
and nothing on the row says which.

    python3 dayobjrun.py            # measure, write nothing
    python3 dayobjrun.py --write    # write every clean book
"""
import glob
import io
import json
import os
import sys

import dayobj

SEG_DIR = os.environ.get("SEG_DIR", "corpus/seg")
OBJ_DIR = os.environ.get("OBJ_DIR", "corpus/objectives")


class Result(object):
    """One book: what it would write, and what stopped it."""

    def __init__(self, book, days, authored, applied, complaints):
        self.book = book
        self.days = days
        self.authored = authored
        self.applied = applied
        self.complaints = complaints


def books(obj_dir=OBJ_DIR):
    """The books someone has authored objectives for, by slug.

    The objectives lead. A seg file with no objectives file is a book
    nobody has written for yet, not a book with a problem.
    """
    return sorted(os.path.basename(p)[:-5]
                  for p in glob.glob(os.path.join(obj_dir, "*.json")))


def _read(path):
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def _segments(doc):
    """The corpus holds both shapes -- `{"segments": [...]}` and a bare
    list -- and a driver that assumed one would rewrite the other."""
    return doc["segments"] if isinstance(doc, dict) else doc


def _write(path, doc):
    """Urdu goes out as Urdu, and in the shape the corpus already uses.

    `ensure_ascii` would make the corpus unreadable to the next person
    who opens it. `sort_keys` would reorder every key of all 2,039
    segments to add one -- the seg files are written in insertion order,
    so the objective lands at the end of the row and nothing else moves.
    """
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(doc, ensure_ascii=False, indent=1))


def run(seg_dir=SEG_DIR, obj_dir=OBJ_DIR, write=False):
    """Check every authored book, and write the ones with nothing wrong."""
    out = []
    for book in books(obj_dir):
        authored = _read(os.path.join(obj_dir, book + ".json"))
        seg_path = os.path.join(seg_dir, book + ".json")
        if not os.path.exists(seg_path):
            out.append(Result(book, 0, len(authored), 0,
                              ["%s: objectives written against a book that "
                               "is not in the corpus" % book]))
            continue
        doc = _read(seg_path)
        segments = _segments(doc)
        complaints = dayobj.check(segments, authored)
        if complaints:
            out.append(Result(book, len(dayobj.teaching(segments)),
                              len(authored), 0, complaints))
            continue
        applied = dayobj.apply(segments, authored)
        if write:
            _write(seg_path, doc)
        out.append(Result(book, len(dayobj.teaching(segments)),
                          len(authored), applied, []))
    return out


def main(argv):
    write = "--write" in argv
    rows = run(write=write)
    if not rows:
        print("no objectives authored under %s" % OBJ_DIR)
        return 0
    bad = 0
    for r in rows:
        print("%-18s days %3d  authored %3d  %s"
              % (r.book, r.days, r.authored,
                 ("applied %d" % r.applied) if not r.complaints
                 else "BLOCKED, %d complaints" % len(r.complaints)))
        for c in r.complaints[:10]:
            print("    %s" % c)
        bad += 1 if r.complaints else 0
    print("---")
    print("%d books, %d applied, %d blocked%s"
          % (len(rows), sum(r.applied for r in rows), bad,
             "" if write else "  (dry run, --write to save)"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
