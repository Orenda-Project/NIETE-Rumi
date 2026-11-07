"""
Load the Gilgit-Baltistan (Moawin) G1-5 books into our textbook tables for the
assessment generator (bd-6nskfq). Source: the GB page-truth folders, one per book
(`_toc.json` + `pg_NNN.json`); judgement lives in scripts/lib/gb_reader.py.

Rows land on province=gilgit-baltistan, curriculum=nbf_snc, so a GB teacher's
paper reads these books and ICT's rows are never touched. Subjects with no GB
book (SST, Islamiat, GK, Science G1-3) keep falling back to ICT's books.

    python3 scripts/assessment/import-ict-textbooks.py --source gb --all --dry-run --page-truth <dir>
    python3 scripts/assessment/import-ict-textbooks.py --source gb --all --page-truth <dir>            # staging
    python3 scripts/assessment/import-ict-textbooks.py --source gb --all --verify --page-truth <dir>
    ... --target prod   only on Amena's explicit go
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "lib"))
import gb_reader as gb  # noqa: E402
import textbook_import as ti  # noqa: E402

ORDER = ("english", "urdu", "maths", "science")


def select(grade, subject) -> list:
    keys = [(g, s, stem) for stem, (g, s) in gb.BOOKS.items()
            if (grade is None or g == grade) and (subject is None or s == subject)]
    return sorted(keys, key=lambda k: (ORDER.index(k[1]), k[0]))


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--page-truth", required=True, help="folder holding one gb_g<N>_<subject>/ per book")
    ap.add_argument("--grade", type=int, choices=range(1, 6))
    ap.add_argument("--subject", choices=ORDER)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="build and report; touch no database")
    ap.add_argument("--verify", action="store_true", help="compare the database with the books; write nothing")
    ap.add_argument("--target", choices=("staging", "prod"), default="staging")
    ap.add_argument("--force", action="store_true", help="rewrite even when content_hash matches")
    return ap


def find_textbook(grade: int, code: str, target: str):
    found = ti._rest("GET", f"/rest/v1/textbooks?select=id,meta&province=eq.{gb.PROVINCE}"
                            f"&grade=eq.{grade}&subject=eq.{code}", target=target)
    return found[0] if found else None


def write_book(grade: int, code: str, book: dict, *, target: str, force: bool) -> str:
    if not ti._rest("GET", f"/rest/v1/subjects?select=code&code=eq.{code}", target=target):
        raise LookupError(f"subject {code} not in subjects on {target}; add it first")
    existing = find_textbook(grade, code, target)
    if (existing and not force
            and (existing.get("meta") or {}).get("content_hash") == book["meta"]["content_hash"]):
        return "unchanged"
    tid = ti.upsert_textbook(province=gb.PROVINCE, curriculum=gb.CURRICULUM, grade=grade,
                             subject=code, filename=book["meta"]["stem"],
                             total_pages=len(book["rows"]), pdf_page_offset=book["offset"],
                             target=target)
    ti.replace_pages(tid, book["rows"], target=target)
    ti.replace_chapters(tid, [{"chapter_number": t["chapter_number"], "title": t["chapter_title"],
                               "start_page": t["page_start"], "end_page": t["page_end"]}
                              for t in book["toc"]],
                        curriculum=gb.CURRICULUM, grade=grade, subject=code, target=target)
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
        bad.append(f"content_hash db={got or 'absent'} expected={book['meta']['content_hash'][:12]}")
    return bad


def main(argv=None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    if not (args.all or args.grade or args.subject):
        ap.error("pick --all, --grade or --subject")
    if args.dry_run and args.verify:
        ap.error("--dry-run and --verify are exclusive")
    root, failures = Path(args.page_truth), 0
    for grade, code, stem in select(args.grade, args.subject):
        try:
            book_dir = root / stem
            if not book_dir.is_dir():
                raise gb.GbBookError(f"no folder {book_dir}")
            book = gb.build_book(stem, *gb.read_book_dir(book_dir))
            line = (f"G{grade} {code} <- {stem}: pages {len(book['rows'])}, "
                    f"chapters {len(book['toc'])}, offset {book['offset']}")
            if args.dry_run:
                print(line + "  (dry run)")
            elif args.verify:
                bad = verify_book(grade, code, book, target=args.target)
                print(f"G{grade} {code}: " + ("OK" if not bad else "; ".join(f"MISMATCH {b}" for b in bad)))
                failures += bool(bad)
            else:
                state = write_book(grade, code, book, target=args.target, force=args.force)
                print(line + f"  {state} on {args.target}")
        except Exception as e:  # keep going: one bad book must not hide the others
            failures += 1
            print(f"G{grade} {code} ({stem})  FAILED: {e}", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
