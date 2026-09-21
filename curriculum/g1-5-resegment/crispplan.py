# -*- coding: utf-8 -*-
"""Plan the live matrix migration as deletes, never as a rebuild.

Amena, 2026-09-21: "i think there is alot of redundancy in this sheet ...
remove fde syllabus columns pls". Measured over the 1,923 traced rows before
cutting: `FDE syllabus` was "In FDE syllabus" on every one, `Period (min)`
was "40", `Review status` was "not reviewed", `C Enrichment` was one constant
string, `B Segmentation` restated the row number, seven trace columns were
empty, and `Reading strategy` was "n/a" on all 785 Maths and Science rows.

Stage C wrote 12,655 values onto these tabs. So the migration deletes columns
and renames one; it never rewrites the grid. If the target header is not a
subsequence of the live one, that assumption is broken and this refuses
rather than reaching for a rebuild.
"""
import collections
import re

import tabs

_STAMP = re.compile(r"\s*\(\d{4}-\d{2}-\d{2}\)\s*$")

# The one trace column that ever held an artefact becomes the JSON column.
# Renaming it rather than deleting ten and inserting one keeps the migration
# delete-only and keeps whatever is already in the cells recoverable.
KEPT_TRACE = "A Page truth"

Plan = collections.namedtuple("Plan", "deletes renames")


def unstamped(header):
    """A header without its trailing (YYYY-MM-DD) build stamp."""
    return _STAMP.sub("", str(header or "")).strip()


def plan(live_header, target_header):
    """(deletes highest-index-first, {index: new label}) to reach the target."""
    live = [unstamped(h) for h in live_header]
    renames = {}
    if tabs.TRACES_COLUMN not in live and KEPT_TRACE in live:
        i = live.index(KEPT_TRACE)
        renames[i] = tabs.TRACES_COLUMN
        live[i] = tabs.TRACES_COLUMN

    keep, j = [], 0
    for i, col in enumerate(live):
        if j < len(target_header) and col == target_header[j]:
            keep.append(i)
            j += 1
    if j != len(target_header):
        raise ValueError(
            "the target header is not a subsequence of the live one -- %r is "
            "missing or out of order, so this needs a rebuild and not a "
            "delete" % (target_header[j] if j < len(target_header) else None,))

    kept = set(keep)
    deletes = [i for i in range(len(live)) if i not in kept]
    return Plan(deletes=sorted(deletes, reverse=True),
                renames={i: n for i, n in renames.items() if i in kept})
