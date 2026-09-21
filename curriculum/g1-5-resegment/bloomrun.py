# -*- coding: utf-8 -*-
"""Re-rate the `Bloom's` column on the four subject tabs from the SLO text.

The shipped column was a relabel of `Skill type` (see bloom.py for the three
proofs). This driver reads each tab, asks bloom.rate() what the day's own
SLO says, and writes one column back. Non-teaching rows -- banners, chapter
headers, blanks -- are echoed untouched, so the write cannot disturb the
grammar of the tab.

    python3 bloomrun.py            # measure, write nothing
    python3 bloomrun.py --write    # write the column on all four tabs
"""
import collections
import glob
import json
import os
import sys

import bloom
import stagec

SHEET = "14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio"
TABS = [("English", u"English G1–5"), ("Urdu", u"Urdu G1–5"),
        ("Maths", u"Maths G1–5"), ("Science", u"Science G4–5")]
BLOOM = "Bloom's"
HEADER_ROW = 3          # 1-based; data starts on row 4
SEG_DIR = os.environ.get("SEG_DIR", "corpus/seg")


class Plan(object):
    """One column of values, plus the arithmetic that justifies writing it."""

    def __init__(self, column, before, after, changed, unrated, by_source):
        self.column = column
        self.before = before
        self.after = after
        self.changed = changed
        self.unrated = unrated
        self.by_source = by_source

    @property
    def days(self):
        return sum(self.after.values())


def letter(index):
    """0 -> A, 26 -> AA. Sheets ranges are spelled, not numbered."""
    out = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        out = chr(ord("A") + rem) + out
    return out


def skill_index(seg_dir=SEG_DIR):
    """Topic -> skill_type. The sheet shows a display label; the corpus keeps
    the machine one, and bloom.rate() only ever uses it as a tie-break."""
    found = {}
    for path in sorted(glob.glob(os.path.join(seg_dir, "grade_*.json"))):
        with open(path) as handle:
            for seg in json.load(handle).get("segments", []):
                topic = (seg.get("topic") or "").strip()
                if topic:
                    found.setdefault(topic, seg.get("skill_type") or "")
    return found


def plan(header, rows, skills):
    """What the Bloom's column should hold, row for row."""
    names = [str(h).split(" (")[0].strip() for h in header]
    if BLOOM not in names:
        raise ValueError("no %r column in %r" % (BLOOM, names))
    at = dict((n, i) for i, n in enumerate(names) if n)

    def cell(raw, name):
        i = at.get(name)
        if i is None or i >= len(raw) or raw[i] is None:
            return ""
        return str(raw[i]).strip()

    column, before, after = [], collections.Counter(), collections.Counter()
    by_source = collections.Counter()
    changed = unrated = 0
    for raw in rows:
        old = cell(raw, BLOOM)
        if stagec.classify_row(cell(raw, "Day #")) != "day":
            column.append([old])
            continue
        level, why = bloom.rate(cell(raw, "Primary SLO description"),
                                skills.get(cell(raw, "Topic"), ""))
        before[old] += 1
        after[level or "(unrated)"] += 1
        by_source[why] += 1
        if not level:
            unrated += 1
        elif level != old:
            changed += 1
        column.append([level])
    return Plan(column, before, after, changed, unrated, by_source)


def _report(subject, p):
    order = lambda c: "  ".join("%s=%d" % kv for kv in c.most_common())
    print("\n%s  %d teaching days" % (subject, p.days))
    print("  before  %s" % order(p.before))
    print("  after   %s" % order(p.after))
    print("  decided by %s   changed %d (%.0f%%)   left dark %d" % (
        dict(p.by_source), p.changed, 100.0 * p.changed / max(p.days, 1),
        p.unrated))


def main(argv):
    import sheetio
    write = "--write" in argv
    svc = sheetio.client()
    skills = skill_index()
    for subject, tab in TABS:
        values = svc.spreadsheets().values().get(
            spreadsheetId=SHEET, range=u"'%s'!A1:AJ2100" % tab
        ).execute().get("values", [])
        header = values[HEADER_ROW - 1]
        p = plan(header, values[HEADER_ROW:], skills)
        _report(subject, p)
        if not write:
            continue
        col = letter([str(h).split(" (")[0].strip()
                      for h in header].index(BLOOM))
        rng = u"'%s'!%s%d:%s%d" % (tab, col, HEADER_ROW + 1,
                                   col, HEADER_ROW + len(p.column))
        svc.spreadsheets().values().update(
            spreadsheetId=SHEET, range=rng, valueInputOption="USER_ENTERED",
            body={"values": p.column}).execute()
        print("  wrote %s" % rng)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
