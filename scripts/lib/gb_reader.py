#!/usr/bin/env python3
"""
Read one Gilgit-Baltistan (curriculum `nbf_snc`) book from its page truth and turn it
into the rows the textbook importer writes (bd-6nskfq). Pure: the only I/O is
`read_book_dir`, which reads JSON from a local directory.

A GB teacher gets her curriculum's book where one is loaded, ICT's otherwise
(book-curriculum.service, bd-97daxo.4). So loading these 17 books is all GB
assessments need for English, Urdu and Maths G1-5 and Science G4-5; SST, Islamiat,
GK and Science G1-3 already fall through to ICT's books.

WHERE THE ROWS LAND. `textbooks` is UNIQUE(province, grade, subject), and ICT's
rows are ('federal', 'ict'). GB rows use their own province so they can never
overwrite ICT's; the bot reads by curriculum, not province.

PAGE TEXT. A page-truth page is `blocks`, not text. `flatten` walks them and keeps
the book's own words (prose, headings, exercise prompts, picture descriptions and
words printed in pictures). It drops metadata, answer keys and the English/roman
glosses the page-truth agents added: those are not on the printed page.

CHAPTERS. Labels are mixed across books: 1, "1", "L1" and "QAIDA" (Urdu G1's
primer, chapter 0) are chapters. "1b"/"1c" (G4 Maths sub-units) fold into their
parent. Reviews (R*, J*) and glossaries are not chapters; their pages stay in the
book and reachable by page range. A chapter ends the page before the next TOC
entry starts, the last one at the end of the book.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from corpus_reader import content_hash
from textbook_import import clean_page_text, dominant_offset

PROVINCE, CURRICULUM = "gilgit-baltistan", "nbf_snc"

BOOKS = {f"gb_g{g}_{s}": (g, s) for g in range(1, 6) for s in ("english", "urdu", "maths")}
BOOKS.update({"gb_g4_science": (4, "science"), "gb_g5_science": (5, "science")})

_SKIP_KEYS = frozenset({"type", "lang", "note", "pedagogical_role", "grounded_in", "method",
                        "role", "position", "roman", "meaning_en", "layout", "layout_note"})
_SKIP_PREFIX = ("answer", "sample_answer", "count_")
_SKIP_SUFFIX = ("_roman", "_meaning_en")
_CHAPTER = re.compile(r"^L?(\d+)$")


class GbBookError(RuntimeError):
    """A GB book could not be built. The message names the book or label."""


def _keep(key: str) -> bool:
    return (key not in _SKIP_KEYS and not key.startswith(_SKIP_PREFIX)
            and not key.endswith(_SKIP_SUFFIX))


def _strings(node, out: list) -> None:
    if isinstance(node, str):
        if node.strip():
            out.append(node.strip())
    elif isinstance(node, list):
        for v in node:
            _strings(v, out)
    elif isinstance(node, dict):
        for k, v in node.items():
            if _keep(k):
                _strings(v, out)


def flatten(blocks) -> str:
    out: list = []
    _strings(blocks or [], out)
    return "\n".join(out)


def chapter_number(label):
    """The chapter number a TOC label stands for, or None when it is not a chapter."""
    if isinstance(label, int) and not isinstance(label, bool):
        return label
    s = str(label).strip()
    if s.upper() == "QAIDA":
        return 0
    m = _CHAPTER.match(s)
    return int(m.group(1)) if m else None


def _title(entry: dict) -> str:
    return entry.get("title") or entry.get("title_ur") or entry.get("meaning_en") or ""


def build_toc(toc: list, *, max_printed: int) -> list:
    """TOC rows for the chapters. A chapter ends the page before the next entry
    that is not one of its sub-units ("1b" folds into 1), or at max_printed."""
    entries = sorted(toc, key=lambda e: e["printed_start"])
    boundaries = [e["printed_start"] for e in entries if not _is_subunit(e["chapter"])]
    out = []
    for e in entries:
        n = chapter_number(e["chapter"])
        if n is None:
            continue
        if any(t["chapter_number"] == n for t in out):
            raise GbBookError(f"chapter {n} appears twice in the TOC")
        later = [b for b in boundaries if b > e["printed_start"]]
        out.append({"chapter_number": n, "chapter_title": _title(e) or f"Chapter {n}",
                    "page_start": e["printed_start"],
                    "page_end": (min(later) - 1) if later else max_printed})
    return out


def _is_subunit(label) -> bool:
    return bool(re.match(r"^\d+[a-z]$", str(label).strip()))


def _rows(stem: str, pages: list) -> list:
    """One row per numbered page with text, keyed by printed page. The shared
    normaliser is not used: it de-duplicates by pdf index, and a rescanned page's
    index (in the rescan PDF) can equal an original page's."""
    rows = {}
    for p in pages:
        n = p.get("printed_page_number")
        if not isinstance(n, int) or isinstance(n, bool) or n < 1:
            continue                                   # front/back matter
        text = clean_page_text(flatten(p.get("blocks")))
        if not text:
            continue
        if n in rows:
            raise GbBookError(f"{stem}: printed page {n} given twice")
        rows[n] = {"textbook_page_number": n, "pdf_page_index": p.get("pdf_page_index"),
                   "page_content": text, "page_images": [], "content_length": len(text)}
    return [rows[n] for n in sorted(rows)]


def build_book(stem: str, pages: list, toc: list) -> dict:
    """{rows, toc, meta, report, offset} for one book."""
    rows = _rows(stem, pages)
    if not rows:
        raise GbBookError(f"{stem} produced no usable pages")
    offset = dominant_offset([{"book_page_no": r["textbook_page_number"],
                               "pdf_page_no": r["pdf_page_index"]} for r in rows])
    chapters = build_toc(toc, max_printed=rows[-1]["textbook_page_number"])
    meta = {"source": "gb_page_truth", "stem": stem,
            "content_hash": content_hash(rows, chapters)}
    report = {"stem": stem, "records": len(pages), "pages": len(rows),
              "chapters": len(chapters), "offset": offset}
    return {"rows": rows, "toc": chapters, "meta": meta, "report": report, "offset": offset}


def read_book_dir(book_dir) -> tuple:
    """(pages sorted by file name, TOC chapters) from one page-truth book directory."""
    d = Path(book_dir)
    toc = json.loads((d / "_toc.json").read_text(encoding="utf-8"))["chapters"]
    pages = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(d.glob("pg_*.json"))]
    return pages, toc
