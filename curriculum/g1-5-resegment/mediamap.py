#!/usr/bin/env python3
"""The `Videos <-> SLOs` sheet -> an SLO-keyed index the LP build can look a day up in.

bd-v2ikv. Amena: "I have the videos mapped in the new sheet, how can we bring that in this old
sheet that is live on prod?" This module is that bridge, and the whole bridge is the join key.

spec/05-media.md opens by fixing it: the mapping is keyed on SLO, NEVER on day number. That is
what lets ONE map serve both the new workbook's segmentation and the old production sheet's
existing traces -- a day can move, split or fold, and its SLO still points at the same video.
Measured against the live sheet on 2026-09-21 this is also the tightest key there is: SLO alone
gives 658 distinct keys, grade+subject+SLO gives 659, because an SLO code already carries its
own subject and grade (`M-03-AS-02` is Maths, Grade 3). Adding chapter would buy nothing and
would cost a re-segmented day its video the moment a chapter boundary moved.

The sheet as measured: 2,045 data rows, 1,461 carrying a video, over 1,073 distinct teaching
days -- the header's "1073 of 1657" counts DAYS, this file's 1,461 counts ROWS, and the two
reconcile because "Each row is one teaching day x one video" and 388 rows are marked
"MAPPED (additional)". So an SLO legitimately carries a list, not a single video.

The renderer seats exactly one video (template.js videoRow, on the development section), so the
ORDER of that list is a pedagogical decision and is part of this module's contract: high
confidence first, ties in sheet order, so the operator's own ordering inside the sheet is what
breaks them. Nothing is filtered -- spec/05-media.md: "Low confidence is shown, not hidden."

Resolving a link is deliberately NOT done here. The column holds two shapes (617 http(s) URLs
and 844 bare Taleemabad library keys) and d0_media.resolve_url owns that decision; the harvest
carries the cell raw so one place, and only one place, decides what a link means.
"""
from __future__ import annotations

import datetime
import json
import os
import sys

SHEET_ID = "14-ndk94fkTbqKn0MW4QPhMgLGTesswVj-_GTwe4GYio"
TAB = "Videos ↔ SLOs"
HEADER_ROW = 3          # A1 is the title banner, A2 the standfirst.

# Header name -> the key it becomes. Read by NAME: the sheet is hand-maintained and a column
# inserted upstream would make a positional read harvest the wrong cell and say nothing.
FIELDS = {
    "Primary SLO": "slo",
    "Video — title": "title",
    "Video — source": "source",
    "Video — key / link": "link",
    "Match confidence": "confidence",
    "Why it matches": "why",
    "Language": "language",
    "Status": "status",
    "Grade": "grade",
    "Subject": "subject",
    "Chapter": "chapter",
    "Day #": "day",
}

# High first. An unrecognised or blank confidence sorts last but is still KEPT -- a row the
# operator has not graded yet is not a row to throw away.
_RANK = {"high": 0, "medium": 1, "low": 2}


def _cols(header) -> dict:
    """{field: column index}, matched on the header's own text."""
    out = {}
    for i, name in enumerate(header):
        key = FIELDS.get(str(name).strip())
        if key and key not in out:
            out[key] = i
    return out


def _cell(row, cols, field) -> str:
    i = cols.get(field)
    if i is None or i >= len(row):
        return ""                     # Sheets truncates trailing empty cells.
    return str(row[i] or "").strip()


def parse(values) -> dict:
    """`{slo: [entry, ...]}` from the tab's values, header row included.

    A row with no link is a GAP and produces NO entry: spec/05-media.md says an unmapped day
    says so, and an empty entry would seat a video block with no url, which the renderer would
    print as a blank row -- the same defect this bead exists to remove, in a new costume.
    """
    if not values:
        return {}
    cols = _cols(values[0])
    index: dict[str, list] = {}
    for order, row in enumerate(values[1:]):
        slo = _cell(row, cols, "slo")
        link = _cell(row, cols, "link")
        if not slo or not link:
            continue
        entry = {f: _cell(row, cols, f) for f in FIELDS.values() if f != "slo"}
        entry = {k: v for k, v in entry.items() if v}
        entry["_order"] = order
        index.setdefault(slo, []).append(entry)

    for slo, entries in index.items():
        entries.sort(key=lambda e: (_RANK.get(e.get("confidence", "").lower(), 3), e["_order"]))
        for e in entries:
            del e["_order"]
    return index


def best(index, slo):
    """The one video to seat for this SLO, or None. First candidate = highest confidence."""
    entries = index.get(str(slo or "").strip()) if slo else None
    return entries[0] if entries else None


def for_slos(index, slos):
    """The one video to seat for a lesson, given its `slo_refs`, or None.

    Order matters and it is the LESSON's order, not the map's: `slo_refs[0]` is the day's
    primary SLO, so a medium-confidence video for it beats a high-confidence video for a
    secondary one -- the better-graded video would be about the wrong thing. Confidence only
    ranks candidates WITHIN one SLO, which best() already did at harvest time.
    """
    if not slos:
        return None
    if isinstance(slos, str):
        slos = [slos]
    for code in slos:
        hit = best(index, code)
        if hit:
            return hit
    return None


def snapshot(index, harvested=None) -> dict:
    """The index wrapped with its own provenance, which is what gets committed.

    The harvest reads the NEW workbook; the render reads the OLD production sheet's traces and
    never reaches the new workbook at all -- this file is the only thing that crosses between
    them. That makes it a production input, so it has to say on its face which sheet and tab it
    came from, when, and how much it holds. Without the counts a half-read sheet writes a
    smaller file that still parses cleanly and silently drops videos.
    """
    return {
        "source": {
            "sheet_id": SHEET_ID,
            "tab": TAB,
            "harvested": harvested or datetime.date.today().isoformat(),
            "slos": len(index),
            "videos": sum(len(v) for v in index.values()),
            "note": ("Harvested from the new workbook. The render reads THIS FILE, not the "
                     "sheet. Refresh with `python mediamap.py`; the production matrix "
                     "(1zpRop18Y1kNLbuYr31BU7B1qk_7DFy_LL9in1zTgtws) is never written to."),
        },
        "slos": {k: index[k] for k in sorted(index)},
    }


def load(path) -> dict:
    """The `{slo: [entry, ...]}` index out of a committed snapshot."""
    with open(path, encoding="utf-8") as fh:
        return json.load(fh).get("slos", {})


# ── I/O ──────────────────────────────────────────────────────────────────────

def fetch(svc=None) -> dict:
    """Read the live tab and index it. Kept apart from parse() so the logic tests stay pure."""
    if svc is None:
        import sheetio
        svc = sheetio.client()
    rng = "'%s'!A%d:R5000" % (TAB, HEADER_ROW)
    values = svc.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range=rng).execute().get("values", [])
    return parse(values)


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    out = argv[0] if argv else os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                            "data", "videos-by-slo.json")
    index = fetch()
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(snapshot(index), fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    rows = sum(len(v) for v in index.values())
    print("%d SLOs, %d mapped videos -> %s" % (len(index), rows, out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
