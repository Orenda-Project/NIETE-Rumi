#!/usr/bin/env python3
"""Gate O1 driver — enrichment + page truth -> lp_doc, one file per segment.

Reads the artefact manifest built from the Curriculum Matrix trace columns and
the R2 objects already downloaded beside it. Writes lp_doc v3.0 JSON for the
v9 HTML renderer. Renders nothing; measurement is render_lp.js's job.

Usage: python3 build_o1_docs.py <work_dir>
  <work_dir>/manifest.json   per-subject rows (day, topic, pt/enr/gate URLs)
  <work_dir>/{pt,enr}/       the downloaded artefacts
  -> <work_dir>/../o1/docs/<Subject>_seg<N>.lp.json
"""
import json
import pathlib
import sys

import d0_primary as d0


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


def main(work):
    work = pathlib.Path(work)
    out = work.parent / "o1" / "docs"
    out.mkdir(parents=True, exist_ok=True)
    manifest = _load(work / "manifest.json")

    written, skipped = [], []
    for subject, rows in manifest.items():
        total = len(rows)
        for day, row in enumerate(rows, 1):
            enr = _artefact(work, "enr", subject, day)
            pt = _artefact(work, "pt", subject, day)
            # The Stage-C verdict lives in the gate artefact, not the enrichment.
            gate = _artefact(work, "gate", subject, day)["gate"]
            if not gate.get("pass"):
                skipped.append(f"{subject} day{day}: {'; '.join(gate.get('reasons') or ['gate fail'])}")
                continue
            nxt = rows[day]["topic"] if day < total else None
            prev = rows[day - 2]["topic"] if day > 1 else None
            doc = d0.to_lp_doc(enr, pt, day=day, total_days=total,
                               seq={"previous": prev, "next": nxt},
                               topic=row.get("topic"))
            dest = out / f"{subject}_seg{day}.lp.json"
            dest.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
            written.append(dest)

    print(f"lp_docs written: {len(written)}")
    for s in skipped:
        print(f"  SKIPPED {s}")
    return 0 if written else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
