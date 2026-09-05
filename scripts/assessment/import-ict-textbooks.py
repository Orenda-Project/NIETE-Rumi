#!/usr/bin/env python3
"""
Import ICT textbooks for the assessment generator.

Thin on purpose. The general importer in `scripts/lib/textbook_import.py` knows
how to read a Taleemabad book and write our tables; this file knows only which
books ICT means, and is the record of how this feature got its data.

    python3 scripts/assessment/import-ict-textbooks.py --list
    python3 scripts/assessment/import-ict-textbooks.py --grade 1 --subject Eng --dry-run
    python3 scripts/assessment/import-ict-textbooks.py --grade 1 --subject Eng
    python3 scripts/assessment/import-ict-textbooks.py --all --dry-run
    python3 scripts/assessment/import-ict-textbooks.py --all

HISTORY
    2026-09-01  English Grade 1 imported alone (bd-59814). Its chapter ranges
                were stored raw and were three pages late — see the importer's
                docstring on pdf positions vs printed numbers.
    2026-09-02  All 27 books imported to staging with `--all` (bd-60012), English
                Grade 1 re-imported with corrected chapters. Every book was
                surveyed first; the per-book anomalies (repeated pdf pages,
                misread page numbers, a doubled OCR run in Maths G4) are the
                rules the importer now carries. A book that imports cleanly is
                still not the same as a book that generates good questions.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.textbook_import import import_book  # noqa: E402

SCHEMA = "fde_staging"      # the tenant with the OCR; production's book_text is NULL
PROVINCE = "federal"
CURRICULUM = "ict"

# (grade, subject) -> Taleemabad book id. Lifted from the generator this replaces,
# and verified against the source: all 27 ids resolve and carry page arrays.
BOOKS = {
    (1, "Eng"): 1171, (2, "Eng"): 1172, (3, "Eng"): 1173, (4, "Eng"): 1163, (5, "Eng"): 1168,
    (1, "Urdu"): 1169, (2, "Urdu"): 1175, (3, "Urdu"): 1160, (4, "Urdu"): 1170, (5, "Urdu"): 1174,
    (1, "Maths"): 1159, (2, "Maths"): 1165, (3, "Maths"): 1161, (4, "Maths"): 1164, (5, "Maths"): 1167,
    (1, "Islamiat"): 1096, (2, "Islamiat"): 1097, (3, "Islamiat"): 1098,
    (4, "Islamiat"): 1099, (5, "Islamiat"): 1100,
    (4, "Science"): 1166, (5, "Science"): 1162,
    (1, "GenK"): 1058, (2, "GenK"): 1063, (3, "GenK"): 1037,
    (4, "SST"): 1034, (5, "SST"): 1062,
}

# Our canonical subject codes — the values in the `subjects` lookup table, so a
# book can never be filed under both "Maths" and "Mathematics".
SUBJECT_CODE = {
    "Eng": "english", "Urdu": "urdu", "Maths": "maths", "Islamiat": "islamiat",
    "Science": "science", "GenK": "general_knowledge", "SST": "social_studies",
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--grade", type=int)
    ap.add_argument("--subject", choices=sorted(SUBJECT_CODE))
    ap.add_argument("--dry-run", action="store_true",
                    help="read and repair, report what would be written, write nothing")
    ap.add_argument("--target", choices=("staging", "prod"), default="staging",
                    help="which NIETE database to write to. Defaults to staging; "
                         "reaching production is a deliberate act.")
    ap.add_argument("--list", action="store_true", help="show the book map and exit")
    ap.add_argument("--all", action="store_true", help="import every book in the map, in one run")
    args = ap.parse_args()

    if args.list:
        for (g, s), bid in sorted(BOOKS.items(), key=lambda kv: (kv[0][1], kv[0][0])):
            print(f"  grade {g}  {s:9} -> book {bid}  ({SUBJECT_CODE[s]})")
        return 0

    if args.all:
        keys = sorted(BOOKS, key=lambda k: (k[1], k[0]))
    else:
        if args.grade is None or args.subject is None:
            ap.error("--grade and --subject are required (or use --list / --all)")
        keys = [(args.grade, args.subject)]
        if keys[0] not in BOOKS:
            print(f"no ICT book for grade {args.grade} {args.subject}", file=sys.stderr)
            return 1

    failures = 0
    for grade, subject in keys:
        try:
            report = import_book(
                book_id=BOOKS[(grade, subject)], province=PROVINCE, curriculum=CURRICULUM,
                grade=grade, subject=SUBJECT_CODE[subject],
                schema=SCHEMA, dry_run=args.dry_run, target=args.target,
            )
        except Exception as e:  # keep going: one bad book must not hide the other 26
            failures += 1
            print(f"grade {grade} {subject} (book {BOOKS[(grade, subject)]})  FAILED: {e}", flush=True)
            continue
        print_report(report)
    return 1 if failures else 0


def print_report(report: dict) -> None:
    lo, hi = report["page_range"]
    print(f"{report['title']}  (book {report['book_id']})")
    print(f"  grade {report['grade']} {report['subject']}")
    print(f"  pages         {report['pages']} of {report['source_pages']} "
          f"({report['front_matter_skipped']} front matter skipped)")
    print(f"  printed range {lo}-{hi}" + (f"   GAPS: {report['gaps']}" if report["gaps"] else "   no gaps"))
    print(f"  text          {report['chars']:,} characters")
    print(f"  figures       {report['pages_with_figures']} pages carry images")
    print(f"  chapters      {report['chapters']}")
    print(f"  pdf offset    {report['pdf_page_offset']} (printed page 1 = pdf page "
          f"{(report['pdf_page_offset'] or 0) + 1})"
          + (f"   [book row says buffer_pages={report['buffer_pages']}]"
             if (report["buffer_pages"] or 0) != report["pdf_page_offset"] else ""))
    fixes = []
    if report["repeat_pdf_dropped"]:
        fixes.append(f"{report['repeat_pdf_dropped']} repeated pdf pages dropped")
    if report["nonpositive_dropped"]:
        fixes.append(f"{report['nonpositive_dropped']} pages numbered <=0 dropped")
    if report["relabelled"]:
        fixes.append("relabelled " + ", ".join(f"pdf {p}: {a}->{b}" for p, a, b in report["relabelled"]))
    if report["mislabelled_dropped"]:
        fixes.append("dropped mislabelled " + ", ".join(f"pdf {p} ({n})" for p, n in report["mislabelled_dropped"]))
    if fixes:
        print("  repaired      " + "; ".join(fixes))
    if report["chapters_clamped"]:
        print("  clamped       " + ", ".join(f"ch{c} {a}-{b} -> {x}-{y}" for c, a, b, x, y in report["chapters_clamped"]))
    if report["chapters_dropped"]:
        print("  dropped ch    " + ", ".join(f"ch{c} ({a}-{b}: no pages)" for c, a, b in report["chapters_dropped"]))
    if report["pages_after_last_chapter"]:
        print(f"  NOTE          {report['pages_after_last_chapter']} printed pages after the last chapter's end")
    if report["written"]:
        print(f"  target        {report['target'].upper()}")
        print(f"  WROTE         {report['pages_written']} pages, "
              f"{report['chapters_written']} chapters -> textbook {report['textbook_id']}")
    else:
        print(f"  dry run — nothing written (target would be {report['target'].upper()})")


if __name__ == "__main__":
    raise SystemExit(main())
