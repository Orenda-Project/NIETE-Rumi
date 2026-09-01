#!/usr/bin/env python3
"""
Import ICT textbooks for the assessment generator.

Thin on purpose. The general importer in `scripts/lib/textbook_import.py` knows
how to read a Taleemabad book and write our tables; this file knows only which
books ICT means, and is the record of how this feature got its data.

    python3 scripts/assessment/import-ict-textbooks.py --list
    python3 scripts/assessment/import-ict-textbooks.py --grade 1 --subject Eng --dry-run
    python3 scripts/assessment/import-ict-textbooks.py --grade 1 --subject Eng

Scope today is English Grade 1. The other 26 books are listed below and reachable
by the same flags, but each one wants its own look before it is trusted: the books
differ in how complete their OCR is, and a book that imports cleanly is not the
same as a book that generates good questions.
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
    args = ap.parse_args()

    if args.list:
        for (g, s), bid in sorted(BOOKS.items(), key=lambda kv: (kv[0][1], kv[0][0])):
            print(f"  grade {g}  {s:9} -> book {bid}  ({SUBJECT_CODE[s]})")
        return 0

    if args.grade is None or args.subject is None:
        ap.error("--grade and --subject are required (or use --list)")

    key = (args.grade, args.subject)
    if key not in BOOKS:
        print(f"no ICT book for grade {args.grade} {args.subject}", file=sys.stderr)
        return 1

    report = import_book(
        book_id=BOOKS[key], province=PROVINCE, curriculum=CURRICULUM,
        grade=args.grade, subject=SUBJECT_CODE[args.subject],
        schema=SCHEMA, dry_run=args.dry_run, target=args.target,
    )

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
          f"{(report['pdf_page_offset'] or 0) + 1})")
    if report["written"]:
        print(f"  target        {report['target'].upper()}")
        print(f"  WROTE         {report['pages_written']} pages, "
              f"{report['chapters_written']} chapters -> textbook {report['textbook_id']}")
    else:
        print(f"  dry run — nothing written (target would be {report['target'].upper()})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
