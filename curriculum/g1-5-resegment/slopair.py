# -*- coding: utf-8 -*-
"""Every (SLO code, sentence) pair the subject tabs actually use.

bd-960al. Split out of `slorun`, which had grown past the file limit,
but the seam is the right one anyway: reading the sheet's pairs is a
question with one answer -- "what does this sheet say each code means?"
-- and it is asked by the linking pass, by the drop guard, and by
anything that later wants to resolve bd-i0upq's 171 disagreements.

The key is the PAIR and not the code. A row is read only when its code
count and its sentence count agree; a row where they disagree names an
SLO's meaning by position, which is a guess, so it is reported and left
whole instead.

Pure: reads rows in memory, talks to no sheet.
"""
import collections
import re

import stagec
import tracelinks as tl

#: The header row is row 3 on every subject tab, found by label elsewhere.
HEAD_ROW = 3

#: The row kinds that carry SLOs.
DAY_KINDS = ("day", "assessment", "review")

CODES = "Supporting SLOs"
DESCS = "Supporting SLO descriptions"
PRIMARY = "Primary SLO"
PRIMARY_DESC = "Primary SLO description"

#: How `stageb` joins them: codes with a comma, sentences with a pipe.
CODE_SEP = ", "
DESC_SEP = " | "

_GRADE = re.compile(r"^GRADE\s+(\d+)", re.U)


def _idx(header):
    return dict((tl.unstamped(h), i) for i, h in enumerate(header) if h)


def _cell(row, i):
    return ((row[i] if i is not None and i < len(row) else "") or "").strip()


def _split(text, sep):
    return [x.strip() for x in text.split(sep) if x.strip()]


def pairs_of(header, body, subject):
    """Every (code, sentence) the tab uses, and the rows that disagree.

    The primary columns are read as well as the supporting ones: the
    lookup is the sheet's SLO dictionary, and a code that is primary on
    one row is supporting on 780 others.
    """
    idx = _idx(header)
    seen, bad = collections.OrderedDict(), []
    grade = None
    for n, raw in enumerate(body):
        rowno = HEAD_ROW + 1 + n
        first = _cell(raw, 0)
        m = _GRADE.match(first)
        if m:
            grade = int(m.group(1))
            continue
        if stagec.classify_row(first) not in DAY_KINDS:
            continue
        groups = [([_cell(raw, idx.get(PRIMARY))] if _cell(raw, idx.get(PRIMARY)) else [],
                   [_cell(raw, idx.get(PRIMARY_DESC))] if _cell(raw, idx.get(PRIMARY_DESC)) else []),
                  (_split(_cell(raw, idx.get(CODES)), CODE_SEP),
                   _split(_cell(raw, idx.get(DESCS)), DESC_SEP))]
        for codes, descs in groups:
            if not descs:
                # Codes and no sentences: the shape the assessment and
                # review rows are authored in, where the row echoes every
                # code of the chapter. Nothing to pair, nothing wrong.
                continue
            if len(codes) != len(descs):
                bad.append({"row": rowno, "codes": len(codes),
                            "sentences": len(descs)})
                continue
            for code, desc in zip(codes, descs):
                p = seen.setdefault((code, desc),
                                    {"code": code, "sentence": desc,
                                     "subject": subject, "grades": [],
                                     "days": 0})
                p["days"] += 1
                if grade is not None and grade not in p["grades"]:
                    p["grades"].append(grade)
    return list(seen.values()), bad


def merge(groups):
    """The four tabs' pairs as one list, days and grades added up."""
    out = collections.OrderedDict()
    for pairs in groups:
        for p in pairs:
            key = (p["code"], p["sentence"])
            if key not in out:
                out[key] = dict(p, grades=list(p["grades"]))
                continue
            got = out[key]
            got["days"] += p["days"]
            for g in p["grades"]:
                if g not in got["grades"]:
                    got["grades"].append(g)
    return list(out.values())
