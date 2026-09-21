# -*- coding: utf-8 -*-
"""Gather every reason to refuse, then write the tab whole or not at all.

A tab is written whole. Once a range is sent there is no undo that does not
itself involve guessing what was there, so the refusals are gathered before
anything is sent and a refusal sends nothing -- not a partial tab, which is
harder to reason about than an unwritten one.

Two reasons live here rather than in the per-slice gate, because neither is
visible from inside one slice: a slice that failed its own verification, and
a day row no slice claimed. The second is the quiet one. Slices are tiled by
grade, and a tiling that misses a row leaves it at `pending` while every
slice reports success.
"""
import stagec_send
import stagec_verify
import stagec_write

SHOW_UNCOVERED = 10


def check_ready(tab_doc, slice_docs, slice_outputs, subject):
    """Returns (worker cells, reasons not to write). Reasons empty == go.

    Notes are not reasons. A note is a question for a curriculum lead about
    the curriculum, and holding a sound tab hostage to one would push a
    worker to answer it by inventing.
    """
    why = []
    for doc, out in zip(slice_docs, slice_outputs):
        found = stagec_verify.verify_slice(doc, out)
        why += ["%s: %s" % (doc["slice"], f)
                for f in stagec_verify.defects(found)]

    cells = stagec_write.collect_worker_cells(tab_doc["rows"], slice_outputs)
    missing = stagec_write.uncovered(tab_doc["rows"], cells)
    if missing:
        why.append("%d day rows no slice claimed, so they would stay pending "
                   "while every slice reported success: %s"
                   % (len(missing), missing[:SHOW_UNCOVERED]))
    return cells, why


def run(svc, sheet_id, tab_doc, slice_docs, slice_outputs, subject,
        writer=None):
    """Returns (cells updated, findings). A non-empty findings list means
    nothing was written, or the sheet does not hold what was sent."""
    cells, why = check_ready(tab_doc, slice_docs, slice_outputs, subject)
    if why:
        return 0, why

    merged = stagec_write.merge_cells(tab_doc["rows"], subject, cells)
    return stagec_send.write_tab(svc, sheet_id, tab_doc, merged,
                                 tab_doc["columns"], writer=writer)
