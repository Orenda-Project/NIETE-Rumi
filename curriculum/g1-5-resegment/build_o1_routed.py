#!/usr/bin/env python3
"""Builds the artefacts `triage` routes away from `build_o1_docs` -- bd-dituw.

A 995/990 segment is real work, just not a lesson plan. Until this module
existed, `build_o1_docs.main()` only PRINTED that fact (a "ROUTED ..." line)
and moved on -- it never called `d0_worksheet.build()`/`d0_panels.build()`,
which already exist, are already tested, and already refuse the wrong shape
with a findings list. So a chapter whose 995/990 could never build looked
identical, in the log and in the exit code, to one that built cleanly. That
silence is the operator complaint measured against: "the assessment and
revision lps havent been rendered either on the sheet."

This module is only the wiring between `triage`'s `routed` list and the two
existing builders, plus a small accounting artefact a judge can read without
re-running anything. It never touches the renderer -- there isn't one for
these doc types yet (see the FIXWAVE report) -- so a built worksheet/panels
JSON sits in `o1/docs/` unrendered until that gap is closed elsewhere.

Deliberately does NOT change `build_o1_docs.main()`'s return code: that
return value already drives `build_render.sh`'s per-chapter gate (`|| {
echo "BUILD FAILED $d"; overall_rc=1; continue; }`), and on the real corpus
today 0 of 98 995/990 enrichments build (a separate, upstream authoring
gap -- see the report). Coupling the exit code to that would make every real
chapter's perfectly good content lessons stop rendering too. Completeness for
the routed half is reported instead in its own manifest -- see `manifest()`.
"""
import json
import pathlib

import d0_panels
import d0_worksheet

BUILDERS = {"assessment": d0_worksheet.build, "revision": d0_panels.build}


def build_one(kind, enr, pt):
    """The builder's own output, keyed by the artefact name(s) it writes.

    `d0_worksheet.build` already returns `{"worksheet": ..., "answer_key":
    ...}`; `d0_panels.build` returns one `revision_pages` doc, wrapped here
    under `"panels"` so both kinds hand back the same shape: a dict of
    filename-suffix -> doc. Raises whatever the builder raises (`Unfit`,
    `d0_route.WrongRoute`) -- the caller decides what that means for the row.
    """
    doc = BUILDERS[kind](enr, pt)
    return doc if kind == "assessment" else {"panels": doc}


def build_routed(routed, pt_loader, out):
    """Attempt every routed row; write what builds, report what does not.

    `routed` is `triage()`'s own list, each row carrying `enr` (bd-dituw
    added this key -- it was not there before, since nothing downstream of
    `triage` ever needed the enrichment itself). `pt_loader(subject, day)`
    loads the page-truth artefact the same way `build_o1_docs._artefact`
    does; passed in rather than imported so this module has no dependency on
    the driver's private helper.

    Returns `(written, failed)`. `written` is the list of Path objects
    produced, named `<Subject>_seg<day>.<suffix>.json` -- deliberately not
    `.lp.json`, so `build_render.sh`'s `*.lp.json` glob does not pick up a
    doc type its vendored renderer has no branch for. `failed` is one dict
    per row that raised: `subject, day, kind, lesson_id, error_type, error`.
    """
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    written, failed = [], []
    for row in routed:
        subject, day, kind = row["subject"], row["day"], row["kind"]
        try:
            pt = pt_loader(subject, day)
            docs = build_one(kind, row["enr"], pt)
        except Exception as e:
            failed.append({"subject": subject, "day": day, "kind": kind,
                            "lesson_id": row.get("lesson_id"),
                            "error_type": type(e).__name__, "error": str(e)})
            continue
        for suffix, doc in docs.items():
            dest = out / f"{subject}_seg{day}.{suffix}.json"
            dest.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
            written.append(dest)
    return written, failed


def manifest(chapter, routed, failed):
    """The routed half's own completeness record -- `render_manifest.json`'s
    shape, one directory over: `expected` is every 995/990 this chapter
    named, `built` is the ones that are not in `failed`, and `complete` is
    false the moment even one is missing. A judge reads this file; it does
    not need to re-run the build to falsify "the chapter's assessments
    rendered."
    """
    failed_ids = {f["lesson_id"] for f in failed}
    expected = [r["lesson_id"] for r in routed]
    built = [lid for lid in expected if lid not in failed_ids]
    return {"chapter": chapter, "expected": expected, "built": built,
            "failed": failed, "complete": not failed}
