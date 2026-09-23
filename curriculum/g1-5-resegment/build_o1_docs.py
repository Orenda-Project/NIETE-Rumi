#!/usr/bin/env python3
"""Gate O1 driver — enrichment + page truth -> the artefact each day IS.

Reads the artefact manifest built from the Curriculum Matrix trace columns and
the R2 objects already downloaded beside it. Renders nothing; measurement is
render_lp.js's job.

A chapter is not one kind of day, and this file used to act as though it were.
It imported one builder, `d0_primary`, and called it once per manifest row --
so every 995 in a batch was handed to the lesson-plan builder and no worksheet
was ever written. That is bd-lidwb, filed against the v5/v6 JS lineage
("generate.js has ZERO reference to worksheet.js ... produced 0 worksheets for
11 assessments") and true here, one language along.

`d0_route` owns the decision and nothing below re-makes it:

  content     -> d0_primary   -> <Subject>_seg<N>.lp.json
  assessment  -> d0_worksheet -> <Subject>_seg<N>.worksheet.json
                              +  <Subject>_seg<N>.answer_key.json
  revision    -> d0_panels    -> <Subject>_seg<N>.panels.json

The key is its own file because the sheet goes to the child and the key stays
with the teacher; one document holding both is a leaked answer, and that is
why `d0_worksheet` splits one authored `questions[]` rather than writing two.

A day the gate already failed is SKIPPED -- Stage C said not to render it. A
day that passed the gate and still could not be printed is FAILED: named, and
the run does not exit 0 on it. One malformed worksheet must not take a batch
down, and a batch that wrote four of forty must not report success.

Usage: python3 build_o1_docs.py <work_dir>
  <work_dir>/manifest.json   per-subject rows (day, topic, pt/enr/gate URLs)
  <work_dir>/{pt,enr,gate}/  the downloaded artefacts
  -> <work_dir>/../o1/docs/
"""
import json
import pathlib
import sys

import d0_panels
import d0_primary as d0
import d0_route
import d0_worksheet


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


def _write(dest, doc):
    dest.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    return dest


def _spread(row, pt):
    """The pages this day covers, or None where the row does not say.

    A 995 spans its chapter and a 990 spans what it revises, but the manifest
    pairs each row with ONE page truth -- so a header taken from that alone
    makes an eleven-page chapter assessment announce itself as page 1. The
    span is read off `pages_printed`, the segment's own field, never invented;
    a row without it keeps the single page, exactly as before.
    """
    got = (row or {}).get("pages_printed") or []
    return [dict(pt, printed_page_number=n) for n in got] or None


def artefacts(enr, pt, row, stem, day=None, total_days=None, seq=None):
    """Every file this one day prints, keyed by the name it prints under.

    Pure: it builds the documents and names them, and writes nothing. The
    route check reads the enrichment envelope AND the manifest row, because
    either may carry the type word and a key present but null is absent.
    """
    what = d0_route.kind(enr, row)
    if what == "assessment":
        pair = d0_worksheet.build(enr, pt, segment=row,
                                  pages=_spread(row, pt))
        return {f"{stem}.worksheet.json": pair["worksheet"],
                f"{stem}.answer_key.json": pair["answer_key"]}
    if what == "revision":
        return {f"{stem}.panels.json": d0_panels.build(
            enr, pt, segment=row, pages=_spread(row, pt))}
    return {f"{stem}.lp.json": d0.to_lp_doc(
        enr, pt, day=day, total_days=total_days, seq=seq,
        topic=(row or {}).get("topic"), segment=row)}


def main(work):
    work = pathlib.Path(work)
    out = work.parent / "o1" / "docs"
    out.mkdir(parents=True, exist_ok=True)
    manifest = _load(work / "manifest.json")

    written, skipped, failed = [], [], []
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
            try:
                docs = artefacts(enr, pt, row, f"{subject}_seg{day}", day=day,
                                 total_days=total,
                                 seq={"previous": prev, "next": nxt})
            except (d0_worksheet.Unfit, d0_panels.Unfit) as exc:
                # It passed Stage C and still cannot be printed. The free lint
                # caught it before a render was paid for, which is the point
                # of the lint -- but this day is now missing from the batch,
                # so it is named and the run says so in its exit code.
                failed.append(f"{subject} day{day}: {exc}")
                continue
            for name, doc in docs.items():
                written.append(_write(out / name, doc))

    print(f"artefacts written: {len(written)}")
    for s in skipped:
        print(f"  SKIPPED {s}")
    for s in failed:
        print(f"  UNPRINTABLE {s}")
    return 0 if written and not failed else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
