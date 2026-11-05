#!/usr/bin/env python3
"""
The grades 6–12 path of the ICT textbook importer (contract 3, corpus-import.md).

    python3 scripts/assessment/import-ict-textbooks.py --source corpus --all --dry-run \
        --corpus-local "<workspace>/08_Grades 6-12 LP Build/languages/corpus"
    python3 scripts/assessment/import-ict-textbooks.py --source corpus --grade 9 --subject physics \
        --corpus-local <dir> --target staging
    python3 scripts/assessment/import-ict-textbooks.py --source corpus --all --verify --corpus-local <dir>

Reached only through `--source corpus`; without it the importer is the G1–5
fde_staging path, unchanged. This file never reads `BOOKS` and never writes a
grade below 6: the map is the registry's core rows (`books-6-12.json`) and every
key is asserted 6..12 before anything is written.

ORDER OF A WRITE (why `meta` is last). The REST writes are not one transaction.
textbooks row (upsert) -> pages (delete-insert) -> TOC (delete-insert) -> `meta`
with the content hash. A run that dies midway leaves an old or absent hash, so
the next run repairs the book and `--verify` reports it.

THE GATE FIRST (N1). A grade appears in the teacher's menu as soon as its
textbooks row exists (`assessment-gen-endpoint.js:78`). So a write refuses unless
the target has an `assessment_grades_6_12` row in `app_settings`. Where the gate
code is deployed but nobody has seeded the row (b-golden ships no seed, and prod
has no row until the operator's go), the COS passes `--i-know-the-gate-is-live`
after checking the deploy; the run says so in its output.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "lib"))
import corpus_reader as cr  # noqa: E402
import textbook_import as ti  # noqa: E402

REGISTRY = HERE / "books-6-12.json"
PROVINCE, CURRICULUM = "federal", "ict"
DEFAULT_CORPUS = HERE.parents[2] / "08_Grades 6-12 LP Build" / "languages" / "corpus"
GATE_KEY = "assessment_grades_6_12"


def load_books_6_12(path=None) -> dict:
    """{(grade, code): book_stem} from the registry's core rows."""
    rows = json.loads(Path(path or REGISTRY).read_text(encoding="utf-8"))["books"]
    books = {}
    for r in rows:
        cr.assert_grade_6_12(r["grade"])
        if r["book_stem"] in cr.EXCLUDED_STEMS:
            raise ValueError(f"{r['book_stem']} must never be in the map")
        books[(r["grade"], r["code"])] = r["book_stem"]
    return books


def select(books: dict, grade, subject, all_: bool) -> list:
    if all_:
        return sorted(books)
    return sorted(k for k in books
                  if (grade is None or k[0] == grade) and (subject is None or k[1] == subject))


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="import-ict-textbooks.py --source corpus",
                                 description="Import grades 6-12 books from the held corpus.")
    ap.add_argument("--grade", type=int)
    ap.add_argument("--subject", help="registry code, e.g. physics, pakistan_studies_ur")
    ap.add_argument("--corpus-local", help="directory holding pages.jsonl and books.jsonl")
    ap.add_argument("--dry-run", action="store_true", help="read and report; no database at all")
    ap.add_argument("--verify", action="store_true", help="SELECT-only check of an imported tier")
    ap.add_argument("--target", choices=("staging", "prod"), default="staging")
    ap.add_argument("--force", action="store_true", help="rewrite even when the content hash matches")
    ap.add_argument("--all", action="store_true", help="every book in the G6-12 map")
    ap.add_argument("--i-know-the-gate-is-live", dest="gate_override", action="store_true",
                    help="write although app_settings has no gate row (COS only, after checking the deploy)")
    ap.add_argument("--report-md", help="dry run: also write the per-book report as markdown")
    return ap


def _validate(ap, args, books) -> None:
    if args.dry_run and args.verify:
        ap.error("--dry-run and --verify cannot be combined")
    if args.grade is not None and not 6 <= args.grade <= 12:
        ap.error("--source corpus takes --grade 6..12 (grades 1-5 use the default source)")
    codes = {c for _, c in books}
    if args.subject is not None and args.subject not in codes:
        ap.error(f"--subject must be a registry code: {', '.join(sorted(codes))}")
    if not args.all and args.grade is None and args.subject is None:
        ap.error("give --grade and/or --subject, or --all")
    if args.verify and not args.corpus_local:
        ap.error("--verify needs --corpus-local (it recomputes the expected rows)")


# ── database steps (all through textbook_import._rest) ───────────────────────

def gate_present(target: str) -> bool:
    return bool(ti._rest("GET", f"/rest/v1/app_settings?select=key&key=eq.{GATE_KEY}", target=target))


def subject_known(code: str, target: str) -> bool:
    return bool(ti._rest("GET", f"/rest/v1/subjects?select=code&code=eq.{code}", target=target))


def find_textbook(grade: int, code: str, target: str):
    found = ti._rest("GET", f"/rest/v1/textbooks?select=id,meta&province=eq.{PROVINCE}"
                            f"&grade=eq.{grade}&subject=eq.{code}", target=target)
    return found[0] if found else None


def write_book(grade: int, code: str, book: dict, title: str, *, target: str, force: bool) -> str:
    cr.assert_grade_6_12(grade)
    if not subject_known(code, target):
        raise LookupError(f"subject {code} not in subjects on {target}; add it first (never inserted here)")
    existing = find_textbook(grade, code, target)
    if (existing and not force
            and (existing.get("meta") or {}).get("content_hash") == book["meta"]["content_hash"]):
        return "unchanged"
    tid = ti.upsert_textbook(province=PROVINCE, curriculum=CURRICULUM, grade=grade, subject=code,
                             filename=title, total_pages=len(book["rows"]),
                             pdf_page_offset=book["offset"], target=target)
    ti.replace_pages(tid, book["rows"], target=target)
    ti.replace_chapters(tid, [{"chapter_number": t["chapter_number"], "title": t["chapter_title"],
                               "start_page": t["page_start"], "end_page": t["page_end"]}
                              for t in book["toc"]],
                        curriculum=CURRICULUM, grade=grade, subject=code, target=target)
    ti._rest("PATCH", f"/rest/v1/textbooks?id=eq.{tid}", {"meta": book["meta"]},
             prefer="return=minimal", target=target)
    return "written"


def verify_book(grade: int, code: str, book: dict, *, target: str) -> list:
    tb = find_textbook(grade, code, target)
    if tb is None:
        return ["textbook absent"]
    pages = ti._rest("GET", f"/rest/v1/textbook_pages?select=textbook_page_number"
                            f"&textbook_id=eq.{tb['id']}", target=target) or []
    toc = ti._rest("GET", f"/rest/v1/textbook_toc?select=chapter_number"
                          f"&textbook_id=eq.{tb['id']}", target=target) or []
    bad = []
    if len(pages) != len(book["rows"]):
        bad.append(f"pages db={len(pages)} expected={len(book['rows'])}")
    if len(toc) != len(book["toc"]):
        bad.append(f"toc db={len(toc)} expected={len(book['toc'])}")
    got = (tb.get("meta") or {}).get("content_hash")
    if got != book["meta"]["content_hash"]:
        bad.append(f"content_hash db={got or 'absent'} expected={book['meta']['content_hash'][:12]}…")
    return bad


# ── reporting ────────────────────────────────────────────────────────────────

def report_line(grade: int, code: str, rep: dict) -> str:
    gaps = f" gaps={rep['gaps']}" if rep["gaps"] else ""
    return (f"grade {grade} {code} <- {rep['stem']}: records {rep['recs']}, pages {rep['emit']} "
            f"(empty skipped {rep['empty']}), flagged {rep['flagged']}, low-conf {rep['low']}, "
            f"chapters {rep['toc']} ({rep['numbering']}){gaps}")


MD_HEAD = ("| grade | code | book_stem | records | pages with text | empty skipped | flagged | "
           "low-conf | poetry to review | chapters | numbering | gaps |\n"
           "|---|---|---|---|---|---|---|---|---|---|---|---|\n")


def markdown(results: list, source: str) -> str:
    rows, tot = [], dict(recs=0, emit=0, empty=0, flagged=0, low=0, poetry_review=0, toc=0)
    for (g, c), rep in results:
        for k in tot:
            tot[k] += rep[k]
        rows.append(f"| {g} | {c} | `{rep['stem']}` | {rep['recs']} | {rep['emit']} | {rep['empty']} | "
                    f"{rep['flagged']} | {rep['low']} | {rep['poetry_review']} | {rep['toc']} | "
                    f"{rep['numbering']} | {len(rep['gaps'])} |")
    ordinal = sum(1 for _, rep in results if rep["numbering"] == "ordinal")
    return (f"Source: `{source}`. Books: {len(results)}. Records {tot['recs']}, pages written "
            f"{tot['emit']}, empty skipped {tot['empty']}, flagged {tot['flagged']}, low-confidence "
            f"{tot['low']}, poetry pages to review {tot['poetry_review']}, chapters {tot['toc']}, "
            f"ordinal-numbered books {ordinal}.\n\n" + MD_HEAD + "\n".join(rows) + "\n")


# ── the run ──────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    books = load_books_6_12()
    _validate(ap, args, books)
    keys = select(books, args.grade, args.subject, args.all)
    for g, _ in keys:
        cr.assert_grade_6_12(g)

    local = args.corpus_local
    if local is None and args.dry_run and DEFAULT_CORPUS.is_dir():
        local = str(DEFAULT_CORPUS)
        print("source=local-default")
    source = local or "r2"
    data = cr.read_local(local, {books[k] for k in keys}) if local else None
    client = None

    writing = not args.dry_run and not args.verify
    if writing and not gate_present(args.target):
        if not args.gate_override:
            print(f"gate not deployed on {args.target}: no {GATE_KEY} row in app_settings. "
                  f"Deploy the gate PR first (or, after checking it is live, pass "
                  f"--i-know-the-gate-is-live).")
            return 1
        print(f"WARNING: no {GATE_KEY} row on {args.target}; writing because "
              f"--i-know-the-gate-is-live was passed")

    failures, results = 0, []
    for grade, code in keys:
        stem = books[(grade, code)]
        try:
            if data is not None:
                if stem not in data:
                    raise cr.CorpusError(f"{stem} not in {local}/pages.jsonl")
                src = data[stem]
            else:
                if client is None:
                    client = cr.make_r2_client()
                src = cr.read_r2(stem, client=client[0], bucket=client[1])
            book = cr.build_book(stem, src["records"])
            rep = book["report"]
            if args.dry_run:
                print(report_line(grade, code, rep) + f"  -> would write ({grade}, {code})")
                results.append(((grade, code), rep))
            elif args.verify:
                bad = verify_book(grade, code, book, target=args.target)
                print(f"grade {grade} {code}: " + ("OK" if not bad else
                      "; ".join(f"MISMATCH {b}" for b in bad)))
                failures += bool(bad)
            else:
                title = (src.get("book") or {}).get("title") or stem
                state = write_book(grade, code, book, title, target=args.target, force=args.force)
                print(report_line(grade, code, rep) + f"  {state} on {args.target}")
        except Exception as e:  # keep going: one bad book must not hide the others
            failures += 1
            print(f"grade {grade} {code} ({stem})  FAILED: {e}", flush=True)
    if args.report_md and results:
        Path(args.report_md).write_text(markdown(results, source), encoding="utf-8")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
