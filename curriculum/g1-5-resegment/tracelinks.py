# -*- coding: utf-8 -*-
"""The trace block, built for the stages this build has actually run.

traces.md (operator instruction, 2026-09-14) is binding on every build:
save the traces, publish them, link them from the matrix sheet, stamp the
version. This module is the link half, and it is pure -- no Sheets calls,
no network -- so the decision about what is and is not a trace can be
tested without touching the sheet.

Three stages are linkable on the G1-5 resegmentation:

  A Page truth   the per-page JSON each day was built from. The previous
                 ICT build published 1,712 of these and every URL still
                 resolves, so this is a relink rather than an upload.
  B Segmentation this sheet is the segmentation output.
  C Enrichment   the enrichment is in this row's own columns M-W.

The rest -- the enrichment gate's rationale, the slide scripts, renders,
voicenotes, judge verdicts and the delivered PDF -- have not run at day
scale, and get no cell. traces.md is explicit that a cell pointing at
something that is not there is worse than an empty one.
"""
import re

PAGE_TRUTH = "A Page truth"
SEGMENTATION = "B Segmentation"
ENRICHMENT = "C Enrichment"
LINKED_STAGES = (PAGE_TRUTH, SEGMENTATION, ENRICHMENT)

SEP = u"·"
PREFIX = u"pg "
_RANGE = re.compile(r"^(\d+)\s*[-–]\s*(\d+)$")
_STAMP = re.compile(r"\s*\(\d{4}-\d{2}-\d{2}\)\s*$")

# The corpus names are not consistent: grade_1_maths but grade_2_math, and
# science is published as general_science. Try each, take what exists.
_SLUGS = {
    "English": ("grade_%d_english",),
    "Urdu": ("grade_%d_urdu",),
    "Maths": ("grade_%d_maths", "grade_%d_math"),
    "Science": ("grade_%d_general_science", "grade_%d_science"),
}


def parse_pages(spec):
    """"2, 4-6" -> [2, 4, 5, 6]. A page named twice is listed once."""
    out = []
    for part in str(spec or "").split(","):
        part = part.strip()
        if not part:
            continue
        m = _RANGE.match(part)
        if m:
            lo, hi = int(m.group(1)), int(m.group(2))
            got = range(lo, hi + 1) if lo <= hi else range(hi, lo + 1)
        elif part.isdigit():
            got = [int(part)]
        else:
            continue
        for p in got:
            if p not in out:
                out.append(p)
    return out


def book_slug(subject, grade, published_books):
    for pattern in _SLUGS.get(subject, ()):
        slug = pattern % grade
        if slug in published_books:
            return slug
    return None


def page_truth_cell(pages, book, urlmap):
    """One link per printed page, not one per row.

    A day spans two to four pages and the trace is the page JSON the day
    was built from, so a cell reaching only the first page is a fraction
    of a trace. Pages the previous build never published are still shown,
    unlinked -- the gap names the page that still needs uploading.
    """
    if not book or not pages:
        return None
    text = PREFIX
    runs = []
    for i, p in enumerate(pages):
        if i:
            text += SEP
        start = len(text)
        text += str(p)
        url = urlmap.get((book, p))
        if url:
            runs.append({"start": start, "end": len(text), "uri": url})
    if not runs:
        return None
    return {"text": text, "runs": runs}


def row_anchor(sheet_id, gid, row, column_letter):
    """A link to one cell of this sheet: where the stage left its work."""
    return ("https://docs.google.com/spreadsheets/d/%s/edit#gid=%d&range=%s%d"
            % (sheet_id, gid, column_letter, row))


def unstamped(header):
    """A header without its date, so a second build finds its own block.

    traces.md asks for the block to be re-derived every build and matched
    by label with the trailing (YYYY-MM-DD) stripped. Matching the stamped
    text instead means the first run works and every later one cannot find
    the column it wrote.
    """
    return _STAMP.sub("", str(header or "")).strip()


def stamped(header, date):
    """Re-derived every build, so an old stamp is replaced, never stacked."""
    return "%s (%s)" % (_STAMP.sub("", header), date)
