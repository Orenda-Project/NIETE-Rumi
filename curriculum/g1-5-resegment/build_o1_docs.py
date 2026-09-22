#!/usr/bin/env python3
"""Gate O1 driver — enrichment + page truth -> lp_doc, one file per segment.

Reads the artefact manifest built from the Curriculum Matrix trace columns and
the R2 objects already downloaded beside it. Writes lp_doc v3.0 JSON for the
v9 HTML renderer. Renders nothing; measurement is render_lp.js's job.

Usage: python3 build_o1_docs.py <work_dir>
  <work_dir>/manifest.json   per-subject rows (day, topic, pt/enr/gate URLs)
  <work_dir>/{pt,enr}/       the downloaded artefacts
  -> <work_dir>/../o1/docs/<Subject>_seg<N>.lp.json

A chapter is not all lesson plans. Every one ends with a `_seg995` assessment and a
`_seg990` review, and `d0_route` refuses both -- a worksheet silently rendered as an LP
is exactly the failure it exists to stop. Those days are real work, just a different
artefact, so `triage` sets them aside and names the route rather than letting one of
them raise out of the run and take the rest of the chapter with it (bd-58dss).
"""
import json
import os
import pathlib
import sys

import d0_primary as d0
import d0_route
import mediamap

# The committed snapshot of the `Videos <-> SLOs` map (bd-v2ikv). The driver reads THIS FILE,
# never the sheet: the lessons come off the OLD production sheet's traces and the mapping lives
# in the NEW workbook, so the snapshot is the only thing that crosses between the two and it
# carries its own provenance. Refresh it with `python mediamap.py`.
MEDIA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "videos-by-slo.json")


def _load(path):
    return json.loads(pathlib.Path(path).read_text())


def _artefact(work, stage, subject, ordinal):
    """Files are named <Subject>_seg<row ordinal>_<source stem>.json.

    The ordinal is the row's position on the subject tab, not the enrichment
    stem's own segment number -- spiral/review segments carry ids like _seg990.
    """
    hits = sorted((work / stage).glob(f"{subject}_seg{ordinal}_*.json"))
    if len(hits) != 1:
        raise FileNotFoundError(f"{stage}/{subject}_seg{ordinal}_*: {len(hits)} matches")
    return _load(hits[0])


def triage(rows):
    """(build, routed) -- which loaded rows are lesson plans, and where the rest belong.

    `rows` is (subject, day, enrichment). Classification is delegated to `d0_route.kind`
    and never re-implemented here: it matches on the type WORDS, so the Urdu `jaiza` and
    `duhrai` route exactly like `assessment` and `revision`, which a check written
    against the English spellings would miss on ninety of the corpus's 466 segments.
    """
    build, routed = [], []
    for subject, day, enr in rows:
        what = d0_route.kind(enr)
        if what == "content":
            build.append((subject, day, enr))
            continue
        routed.append({"subject": subject, "day": day, "kind": what,
                       "lesson_id": (enr or {}).get("lesson_id"),
                       "note": d0_route.ROUTES[what]})
    return build, routed


def main(work):
    work = pathlib.Path(work)
    out = work.parent / "o1" / "docs"
    out.mkdir(parents=True, exist_ok=True)
    manifest = _load(work / "manifest.json")
    media = mediamap.load(MEDIA) if os.path.exists(MEDIA) else {}
    if not media:
        print(f"  NOTE no video map at {MEDIA} -- lessons render without a video row")
    videoed = 0

    written, skipped = [], []
    # Load and gate first, then route, then build -- so a 995 anywhere in the chapter
    # costs that one day and nothing after it.
    loaded = []
    for subject, rows in manifest.items():
        for day, row in enumerate(rows, 1):
            enr = _artefact(work, "enr", subject, day)
            # The Stage-C verdict lives in the gate artefact, not the enrichment.
            gate = _artefact(work, "gate", subject, day)["gate"]
            if not gate.get("pass"):
                skipped.append(f"{subject} day{day}: {'; '.join(gate.get('reasons') or ['gate fail'])}")
                continue
            loaded.append((subject, day, enr))

    buildable, routed = triage(loaded)
    for subject, day, enr in buildable:
            rows = manifest[subject]
            total = len(rows)
            row = rows[day - 1]
            pt = _artefact(work, "pt", subject, day)
            nxt = rows[day]["topic"] if day < total else None
            prev = rows[day - 2]["topic"] if day > 1 else None
            # Keyed on SLO, never on day number -- that is what lets one map serve both the
            # new segmentation and the old sheet's traces (spec/05-media.md).
            vid = mediamap.for_slos(media, (enr.get("generated") or {}).get("slo_refs"))
            videoed += 1 if vid else 0
            doc = d0.to_lp_doc(enr, pt, day=day, total_days=total,
                               seq={"previous": prev, "next": nxt},
                               topic=row.get("topic"), media=vid)
            dest = out / f"{subject}_seg{day}.lp.json"
            dest.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
            written.append(dest)

    print(f"lp_docs written: {len(written)}  (with a video: {videoed})")
    for r in routed:
        print(f"  ROUTED  {r['subject']} day{r['day']} {r['lesson_id']} is a {r['kind']} "
              f"segment, not a lesson plan -- {r['note']}")
    for s in skipped:
        print(f"  SKIPPED {s}")
    return 0 if written else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
