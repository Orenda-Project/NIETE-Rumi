"""
Load the English-medium General Knowledge (G1-3) and Social Studies (G4-5) books into our
textbook tables for the assessment generator (bd-uam6dh.3). Source: the ICT page-truth
folders, one per book (`_toc.json` + `pg_NNN.json`).

Rows land on ICT (province=federal, curriculum=ict) under their own subject codes,
general_knowledge_en and social_studies_en, so the Urdu-medium books on general_knowledge /
social_studies are never touched. GB teachers reach them through ICT's fallback.

The page text and chapter rules are GB's (scripts/lib/gb_reader.py); only the TOC differs:
entries carry "number", and SST ends on a Glossary entry, which is not a chapter (its pages
stay in the book, reachable by page range).

    python3 scripts/assessment/import-ict-textbooks.py --source en --all --dry-run --page-truth <dir>
    python3 scripts/assessment/import-ict-textbooks.py --source en --all --page-truth <dir>            # staging
    python3 scripts/assessment/import-ict-textbooks.py --source en --all --verify --page-truth <dir>
    ... --target prod   only on Amena's explicit go; the two subjects rows must exist first
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "lib"))
import gb_reader as gb  # noqa: E402
import textbook_import as ti  # noqa: E402

PROVINCE, CURRICULUM = "federal", "ict"
BOOKS = {f"grade_{g}_general_knowledge_en": (g, "general_knowledge_en") for g in (1, 2, 3)}
BOOKS.update({f"grade_{g}_social_studies_en": (g, "social_studies_en") for g in (4, 5)})


def chapters_of(toc: list, back_matter: list = ()) -> list:
    """The TOC in gb_reader's shape: "number" becomes "chapter". A Glossary (in the TOC or in
    back_matter) stays as a non-chapter entry, so the chapter before it ends where it starts."""
    out = []
    for e in toc:
        glossary = str(e.get("title", "")).strip().lower() == "glossary"
        out.append({**e, "chapter": "GLOSSARY" if glossary else e["number"]})
    out += [{"chapter": "BACK", "title": b.get("title", ""), "printed_start": b["printed"]}
            for b in back_matter if isinstance(b.get("printed"), int)]
    return out


def build(book_dir: Path, stem: str) -> dict:
    pages, _ = gb.read_book_dir(book_dir)
    toc = json.loads((book_dir / "_toc.json").read_text(encoding="utf-8"))
    book = gb.build_book(stem, pages, chapters_of(toc["chapters"], toc.get("back_matter") or []))
    book["meta"]["source"] = "en_page_truth"
    return book


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--page-truth", required=True, help="folder holding one grade_<N>_<subject>_en/ per book")
    ap.add_argument("--grade", type=int, choices=range(1, 6))
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="build and report; touch no database")
    ap.add_argument("--verify", action="store_true", help="compare the database with the books; write nothing")
    ap.add_argument("--target", choices=("staging", "prod"), default="staging")
    ap.add_argument("--force", action="store_true", help="rewrite even when content_hash matches")
    return ap


def find_textbook(grade: int, code: str, target: str):
    found = ti._rest("GET", f"/rest/v1/textbooks?select=id,meta&province=eq.{PROVINCE}"
                            f"&grade=eq.{grade}&subject=eq.{code}", target=target)
    return found[0] if found else None


def write_book(grade: int, code: str, book: dict, *, target: str, force: bool) -> str:
    if not ti._rest("GET", f"/rest/v1/subjects?select=code&code=eq.{code}", target=target):
        raise LookupError(f"subject {code} not in subjects on {target}; add it first")
    existing = find_textbook(grade, code, target)
    if (existing and not force
            and (existing.get("meta") or {}).get("content_hash") == book["meta"]["content_hash"]):
        return "unchanged"
    tid = ti.upsert_textbook(province=PROVINCE, curriculum=CURRICULUM, grade=grade,
                             subject=code, filename=book["meta"]["stem"],
                             total_pages=len(book["rows"]), pdf_page_offset=book["offset"],
                             target=target)
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
        bad.append(f"content_hash db={got or 'absent'} expected={book['meta']['content_hash'][:12]}")
    return bad


def main(argv=None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    if not (args.all or args.grade):
        ap.error("pick --all or --grade")
    if args.dry_run and args.verify:
        ap.error("--dry-run and --verify are exclusive")
    root, failures = Path(args.page_truth), 0
    for stem, (grade, code) in sorted(BOOKS.items(), key=lambda kv: kv[1]):
        if args.grade and grade != args.grade:
            continue
        try:
            book_dir = root / stem
            if not book_dir.is_dir():
                raise gb.GbBookError(f"no folder {book_dir}")
            book = build(book_dir, stem)
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
